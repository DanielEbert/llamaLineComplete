import * as vscode from 'vscode';
import { LlamaClient } from './client';
import { Configuration } from './configuration';
import { ContextManager } from './context-manager';
import { Utils } from './utils';
import { LRUCache } from './lru-cache';
import { StatusBar } from './status-bar';

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
    private isBusy = false;
    private cache: LRUCache;

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

        const lineText = doc.lineAt(pos.line).text;
        const lineSuffix = lineText.substring(pos.character);

        // If automatic trigger and cursor is in middle of long line, abort
        if (ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
            lineSuffix.length > this.config.maxLineSuffix) {
            return undefined;
        }

        // Debounce
        while (this.isBusy) {
            await Utils.delay(this.config.delayBeforeRequest);
            if (token.isCancellationRequested) return undefined;
        }

        this.isBusy = true;
        this.ctxManager.lastComplStartTime = Date.now();  // Throttle ring buffer
        this.statusBar.showThinking();

        try {
            // Construct Context
            const prefixLines = Utils.getPrefixLines(doc, pos, this.config.nPrefix);
            const suffixLines = Utils.getSuffixLines(doc, pos, this.config.nSuffix);

            const inputPrefix = prefixLines.join('\n') + '\n';
            const inputSuffix = lineSuffix + '\n' + suffixLines.join('\n') + '\n';

            // "prompt" is the text on the current line before cursor
            const prompt = lineText.substring(0, pos.character);

            // Handle indentation stripping
            let spacesToRemove = 0;
            if (prompt.trim() === "") {
                spacesToRemove = prompt.length;
            }

            // Fuzzy LRU Cache Lookup
            // Iterate backwards: prompt, promp, prom... to find partial matches
            let cachedContent: string | undefined;

            for (let i = prompt.length; i >= 0; i--) {
                const subPrompt = prompt.slice(0, i);
                const remainder = prompt.slice(i);

                const hashKey = Utils.getHash(`${inputPrefix}|${inputSuffix}|${subPrompt}`);
                const cached = this.cache.get(hashKey);

                if (cached && cached.length > 0) {
                    // Check if cache result matches what we typed so far
                    const entry = cached[0];
                    if (entry.startsWith(remainder)) {
                        cachedContent = entry.slice(remainder.length); // Trim what we typed
                        break;
                    }
                }
            }

            let finalContent: string | null = null;

            if (cachedContent) {
                finalContent = cachedContent;
                this.statusBar.showCached();
            } else {
                // Network Request
                const nIndent = lineText.length - lineText.trimStart().length;
                const abortController = new AbortController();
                token.onCancellationRequested(() => abortController.abort());

                finalContent = await this.client.request(
                    inputPrefix,
                    inputSuffix,
                    prompt,
                    nIndent,
                    this.config.nPredict,
                    abortController.signal
                );
            }

            if (!finalContent) return undefined;

            // Quality Filtering
            const lines = finalContent.split('\n');
            Utils.stripTrailingNewLines(lines);

            if (Utils.shouldDiscardSuggestion(lines, doc, pos, prompt, lineSuffix)) {
                return undefined;
            }

            const cleanContent = Utils.updateSuggestion(lines, lineSuffix);
            const displayContent = Utils.removeLeadingSpaces(cleanContent, spacesToRemove);

            // Save to Cache (Exact match)
            const fullHash = Utils.getHash(`${inputPrefix}|${inputSuffix}|${prompt}`);
            this.cache.put(fullHash, [cleanContent]);

            // Speculative Execution
            // Async: Assume user accepts this code. Generate the *next* code now.
            setTimeout(async () => {
                if (!token.isCancellationRequested) {
                    const futurePrompt = prompt + cleanContent;

                    // Check if already cached
                    const futureHash = Utils.getHash(`${inputPrefix}|${inputSuffix}|${futurePrompt}`);
                    if (!this.cache.get(futureHash)) {
                        const futureContent = await this.client.request(
                            inputPrefix,
                            inputSuffix,
                            futurePrompt,
                            0, // nIndent (approx)
                            this.config.nPredict // Actually generate text
                        );

                        if (futureContent) {
                            this.cache.put(futureHash, [futureContent]);
                        }
                    }
                }
            }, 10);

            return [new vscode.InlineCompletionItem(displayContent, new vscode.Range(pos, pos))];

        } catch (e) {
            this.statusBar.showError();
            return undefined;
        } finally {
            this.isBusy = false;
            if (!token.isCancellationRequested) this.statusBar.showReady();
        }
    }
}
