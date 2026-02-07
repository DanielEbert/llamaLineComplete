import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class Utils {
    static delay(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    static getHash(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    // Optimization: Compare arrays of strings, not raw text strings
    static jaccardSimilarity(lines0: string[], lines1: string[]): number {
        if (lines0.length === 0 && lines1.length === 0) return 1;
        const setA = new Set(lines0);
        const setB = new Set(lines1);
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return intersection.size / union.size;
    }

    // Extract exact line counts for context window
    static getPrefixLines(doc: vscode.TextDocument, pos: vscode.Position, n: number): string[] {
        const start = Math.max(0, pos.line - n);
        return Array.from({ length: pos.line - start }, (_, i) => doc.lineAt(start + i).text);
    }

    static getSuffixLines(doc: vscode.TextDocument, pos: vscode.Position, n: number): string[] {
        const end = Math.min(doc.lineCount - 1, pos.line + n);
        return Array.from({ length: end - pos.line }, (_, i) => doc.lineAt(pos.line + 1 + i).text);
    }

    static getLeadingSpaces(text: string): string {
        return text.match(/^[ \t]*/)?.[0] || "";
    }

    static removeLeadingSpaces(text: string, count: number): string {
        if (count === 0) return text;
        return text.split('\n').map(line => {
            // Count leading spaces/tabs
            let i = 0;
            while (i < line.length && i < count && (line[i] === ' ' || line[i] === '\t')) i++;
            return line.slice(i);
        }).join('\n');
    }

    // Helper to strip empty end lines
    static stripTrailingNewLines(lines: string[]): void {
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
            lines.pop();
        }
    }

    // Aggressive filtering to stop hallucinations/repetitions
    static shouldDiscardSuggestion(
        suggestionLines: string[],
        doc: vscode.TextDocument,
        pos: vscode.Position,
        prefix: string,
        suffix: string
    ): boolean {
        if (suggestionLines.length === 0) return true;

        // 1. Empty single line
        if (suggestionLines.length === 1 && suggestionLines[0].trim() === "") return true;

        // 2. Cursor at end of file logic
        if (pos.line === doc.lineCount - 1) return false;

        // 3. Repeating next lines?
        if (suggestionLines.length > 1 &&
            (suggestionLines[0].trim() === "" || suggestionLines[0].trim() === suffix.trim()) &&
            suggestionLines.slice(1).every((val, idx) => val === doc.lineAt(pos.line + 1 + idx).text)) {
            return true;
        }

        // 4. Exact Suffix Match
        if (suggestionLines.length === 1 && suggestionLines[0] === suffix) return true;

        // 5. Lookahead matching
        let nextLineIdx = pos.line + 1;
        while (nextLineIdx < doc.lineCount && doc.lineAt(nextLineIdx).text.trim() === "") nextLineIdx++;

        if (nextLineIdx < doc.lineCount) {
            const nextLine = doc.lineAt(nextLineIdx).text;
            if ((prefix + suggestionLines[0]) === nextLine) {
                if (suggestionLines.length === 1) return true;
                if (suggestionLines.length > 2 &&
                    suggestionLines.slice(1).every((val, idx) => val === doc.lineAt(nextLineIdx + 1 + idx).text)) {
                    return true;
                }
            }
        }

        return false;
    }

    static updateSuggestion(suggestionLines: string[], lineSuffix: string): string {
        const suffix = lineSuffix.trim();
        if (suffix !== "") {
            if (suggestionLines[0].endsWith(suffix)) return suggestionLines[0].slice(0, -suffix.length);
            if (suggestionLines.length > 1) return suggestionLines[0];
        }
        return suggestionLines.join('\n');
    }
}
