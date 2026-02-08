import * as vscode from 'vscode';
import { LlamaClient } from './client';
import { Configuration } from './configuration';
import { ContextManager } from './context-manager';
import { Utils } from './utils';
import { LRUCache } from './lru-cache';
import { StatusBar } from './status-bar';

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
    private cache: LRUCache;
    private activeAbortController: AbortController | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private client: LlamaClient,
        private config: Configuration,
        private ctxManager: ContextManager,
        private statusBar: StatusBar
    ) {
        this.cache = new LRUCache(250);
    }

    async provideInlineCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        ctx: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        console.log('triggered completion request')
        // Cancel any previous in-flight request immediately
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        const lineText = doc.lineAt(pos.line).text;
        const lineSuffix = lineText.substring(pos.character);

        // Quick reject: cursor in the middle of a long line
        if (ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
            lineSuffix.length > this.config.maxLineSuffix) {
            return undefined;
        }

        // Quick reject: inside a word (not at a word boundary)
        const charBefore = pos.character > 0 ? lineText[pos.character - 1] : '';
        const charAfter = lineSuffix[0] || '';
        if (/\w/.test(charBefore) && /\w/.test(charAfter)) {
            return undefined;
        }

        // Build context (cheap - do before debounce)
        const prefixLines = Utils.getPrefixLines(doc, pos, this.config.nPrefix);
        const suffixLines = Utils.getSuffixLines(doc, pos, this.config.nSuffix);

        // Use smaller fingerprint window for cache key stability
        // This makes completions survive minor edits to distant code
        const cachePrefix = prefixLines.slice(-30).join('\n');  // Last 30 lines
        const cacheSuffix = suffixLines.slice(0, 10).join('\n'); // Next 10 lines

        const inputPrefix = prefixLines.join('\n') + '\n';
        const inputSuffix = lineSuffix + '\n' + suffixLines.join('\n') + '\n';

        // "prompt" is the text on the current line before cursor
        const prompt = lineText.substring(0, pos.character);

        // Handle indentation stripping
        let spacesToRemove = 0;
        if (prompt.trim() === "") {
            spacesToRemove = prompt.length;
        }

        // --- Try cache FIRST (instant, no debounce needed) ---
        const cachedContent = this.lookupCache(cachePrefix, cacheSuffix, prompt);
        if (cachedContent !== undefined) {
            this.statusBar.showCached();

            const lines = cachedContent.split('\n');
            Utils.stripTrailingNewLines(lines);
            if (Utils.shouldDiscardSuggestion(lines, doc, pos, prompt, lineSuffix)) {
                return undefined;
            }

            const cleanContent = Utils.truncateToSingleLine(Utils.updateSuggestion(lines, lineSuffix));
            const displayContent = Utils.removeLeadingSpaces(cleanContent, spacesToRemove);
            if (!displayContent || displayContent.trim() === '') return undefined;

            return [new vscode.InlineCompletionItem(displayContent, new vscode.Range(pos, pos))];
        }

        // --- Debounce before network request ---
        const shouldProceed = await new Promise<boolean>(resolve => {
            this.debounceTimer = setTimeout(() => resolve(true), this.config.delayBeforeRequest);
            token.onCancellationRequested(() => resolve(false));
        });

        if (!shouldProceed || token.isCancellationRequested) return undefined;

        // --- Network request ---
        this.ctxManager.lastComplStartTime = Date.now();
        this.statusBar.showThinking();

        const abortController = new AbortController();
        this.activeAbortController = abortController;
        token.onCancellationRequested(() => abortController.abort());

        try {
            const nIndent = lineText.length - lineText.trimStart().length;

            const finalContent = await this.client.request(
                inputPrefix,
                inputSuffix,
                prompt,
                nIndent,
                this.config.nPredict,
                abortController.signal
            );

            // Check if we were superseded by a newer request
            if (this.activeAbortController !== abortController) return undefined;
            if (token.isCancellationRequested) return undefined;
            if (!finalContent) return undefined;

            const lines = finalContent.split('\n');
            Utils.stripTrailingNewLines(lines);

            if (Utils.shouldDiscardSuggestion(lines, doc, pos, prompt, lineSuffix)) {
                return undefined;
            }

            const cleanContent = Utils.truncateToSingleLine(Utils.updateSuggestion(lines, lineSuffix));
            const displayContent = Utils.removeLeadingSpaces(cleanContent, spacesToRemove);
            if (!displayContent || displayContent.trim() === '') return undefined;

            // Cache the result using the stable cache key
            const fullHash = Utils.fastHash(`${cachePrefix}|${cacheSuffix}|${prompt}`);
            this.cache.put(fullHash, [cleanContent]);

            // Speculative pre-fetch (fire-and-forget, own abort controller)
            this.speculativePrefetch(cachePrefix, cacheSuffix, inputPrefix, inputSuffix, prompt, cleanContent);

            this.statusBar.showReady();
            return [new vscode.InlineCompletionItem(displayContent, new vscode.Range(pos, pos))];

        } catch (e) {
            if (abortController.signal.aborted) return undefined; // Expected
            this.statusBar.showError();
            return undefined;
        } finally {
            if (this.activeAbortController === abortController) {
                this.activeAbortController = null;
            }
        }
    }

    private lookupCache(cachePrefix: string, cacheSuffix: string, prompt: string): string | undefined {
        // Try exact match first, then progressively shorter prompts
        const maxBacktrack = Math.min(prompt.length, 32); // Don't search too far back

        for (let i = prompt.length; i >= prompt.length - maxBacktrack; i--) {
            const subPrompt = prompt.slice(0, i);
            const remainder = prompt.slice(i);

            const hashKey = Utils.fastHash(`${cachePrefix}|${cacheSuffix}|${subPrompt}`);
            const cached = this.cache.get(hashKey);

            if (cached && cached.length > 0 && cached[0].startsWith(remainder)) {
                return cached[0].slice(remainder.length);
            }
        }
        return undefined;
    }

    private speculativePrefetch(
        cachePrefix: string,
        cacheSuffix: string,
        inputPrefix: string,
        inputSuffix: string,
        prompt: string,
        accepted: string
    ) {
        const futurePrompt = prompt + accepted;
        const futureHash = Utils.fastHash(`${cachePrefix}|${cacheSuffix}|${futurePrompt}`);
        if (this.cache.get(futureHash)) return; // Already cached

        // Use a separate abort controller, low priority
        const specAbort = new AbortController();

        this.client.request(
            inputPrefix, inputSuffix, futurePrompt,
            0, this.config.nPredict, specAbort.signal
        ).then(content => {
            if (content) {
                this.cache.put(futureHash, [content]);
            }
        }).catch(() => { /* ignore */ });

        // Cancel speculative work if new real request arrives within 5s
        setTimeout(() => specAbort.abort(), 5000);
    }
}
