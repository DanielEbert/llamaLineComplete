import * as vscode from 'vscode';
import { Configuration } from './configuration';
import { Utils } from './utils';

export interface Chunk {
    text: string;
    lines: string[];
    filename: string;
    time: number;
}

export class ContextManager {
    public chunks: Chunk[] = [];
    private queued: Chunk[] = [];
    private lastLinePick = -999;

    // Throttling: Updated by Provider when completion is requested
    public lastComplStartTime = 0;

    constructor(private config: Configuration) { }

    public handleCursorChange(editor: vscode.TextDocument, pos: vscode.Position) {
        const dist = Math.abs(pos.line - this.lastLinePick);
        if (dist > 32) {
            // Expand prefix/suffix scope for cursor moves (Ring Scope logic)
            this.extractChunk(editor, Math.max(0, pos.line - 100), 50); // Previous context
            this.extractChunk(editor, pos.line + 50, 50); // Suffix context
            this.lastLinePick = pos.line;
        }
    }

    public extractChunk(doc: vscode.TextDocument, centerLine: number, size: number) {
        // Dirty Check: Don't read from unsaved buffers to avoid stale/broken context
        if (doc.isDirty) return;

        if (this.config.ringNChunks <= 0) return;

        const start = Math.max(0, centerLine - size / 2);
        const end = Math.min(doc.lineCount, centerLine + size / 2);

        const range = new vscode.Range(start, 0, end, 0);
        const text = doc.getText(range);

        if (text.length < 50) return;

        const lines = text.split('\n');
        this.add(doc.fileName, text, lines);
    }

    private add(filename: string, text: string, lines: string[]) {
        // Check duplication using Jaccard on arrays
        if (this.chunks.some(c => Utils.jaccardSimilarity(c.lines, lines) > 0.9) ||
            this.queued.some(c => Utils.jaccardSimilarity(c.lines, lines) > 0.9)) {
            return;
        }

        this.queued.push({ filename, text, lines, time: Date.now() });
        if (this.queued.length > 5) this.queued.shift(); // Max queue size
    }

    public processQueue(): boolean {
        // Throttling: If user typed recently, don't update context
        if (Date.now() - this.lastComplStartTime < this.config.ringUpdateMinTimeLastCompl) {
            return false;
        }

        if (this.queued.length === 0) return false;

        const chunk = this.queued.shift();
        if (chunk) {
            this.chunks.push(chunk);
            while (this.chunks.length > this.config.ringNChunks) {
                this.chunks.shift();
            }
            return true;
        }
        return false;
    }
}
