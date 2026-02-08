import * as vscode from 'vscode';
import { Configuration } from './configuration';
import { ContextManager } from './context-manager';
import { LlamaClient } from './client';
import { CompletionProvider } from './provider';
import { StatusBar } from './status-bar';

export function activate(context: vscode.ExtensionContext) {
	const config = new Configuration();
	const ctxManager = new ContextManager(config);
	const client = new LlamaClient(config, ctxManager);
	const statusBar = new StatusBar();
	const provider = new CompletionProvider(client, config, ctxManager, statusBar);

	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
	);

	// Command: Trigger Inline Completion
	context.subscriptions.push(
		vscode.commands.registerCommand('llama-lite.triggerCompletion', async () => {
			await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
		})
	);

	// Trigger: Save
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(doc => {
			if (doc.uri.scheme === 'file') {
				ctxManager.extractChunk(doc, doc.lineCount, config.ringChunkSize);
			}
		})
	);

	// Trigger: Selection Change (Cursor Move)
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (e.textEditor.document.uri.scheme === 'file') {
				ctxManager.handleCursorChange(e.textEditor.document, e.selections[0].active);
			}
		})
	);

	// Background Heartbeat: KV Cache Priming
	const interval = setInterval(async () => {
		if (ctxManager.processQueue()) {
			// n_predict: 0. Just warm up the cache with new chunks
			await client.request("", "", "", 0, 0);
		}
	}, config.ringUpdateMs);

	context.subscriptions.push({ dispose: () => clearInterval(interval) });
	context.subscriptions.push(statusBar);
}

export function deactivate() { }
