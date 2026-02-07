import * as vscode from 'vscode';

export class StatusBar {
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.show();
        this.showReady();
    }

    showReady(): void {
        this.statusBarItem.text = "$(check) llama";
        this.statusBarItem.tooltip = "Llama Lite Ready";
        this.statusBarItem.backgroundColor = undefined;
    }

    showThinking(): void {
        this.statusBarItem.text = "$(sync~spin) llama";
        this.statusBarItem.tooltip = "Generating completion...";
        this.statusBarItem.backgroundColor = undefined;
    }

    showCached(): void {
        this.statusBarItem.text = "$(database) llama";
        this.statusBarItem.tooltip = "Cached completion";
        this.statusBarItem.backgroundColor = undefined;
    }

    showError(): void {
        this.statusBarItem.text = "$(error) llama";
        this.statusBarItem.tooltip = "Error connecting to llama.cpp server";
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
