import * as vscode from 'vscode';

export class Utils {
    static delay(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    // Fast FNV-1a hash - much faster than SHA-256 for cache keys
    static fastHash(data: string): string {
        // FNV-1a 52-bit hash - much faster than SHA-256, fine for cache keys
        let hash = 0x811c9dc5;
        for (let i = 0; i < data.length; i++) {
            hash ^= data.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        // Use two passes for fewer collisions
        let hash2 = 0x811c9dc5;
        for (let i = data.length - 1; i >= 0; i--) {
            hash2 ^= data.charCodeAt(i);
            hash2 = (hash2 * 0x01000193) >>> 0;
        }
        return `${hash.toString(36)}-${hash2.toString(36)}`;
    }

    // Deprecated: Use fastHash instead
    static getHash(data: string): string {
        return this.fastHash(data);
    }

    // Compare arrays of strings, not raw text strings
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

    static stripTrailingNewLines(lines: string[]): void {
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
            lines.pop();
        }
    }

    // filtering to stop hallucinations/repetitions
    static shouldDiscardSuggestion(
        suggestionLines: string[],
        doc: vscode.TextDocument,
        pos: vscode.Position,
        prefix: string,
        suffix: string
    ): boolean {
        if (suggestionLines.length === 0) return true;

        // Empty single line
        if (suggestionLines.length === 1 && suggestionLines[0].trim() === "") return true;

        // Cursor at end of file logic
        if (pos.line === doc.lineCount - 1) return false;

        // Exact Suffix Match
        if (suggestionLines.length === 1 && suggestionLines[0] === suffix) return true;

        // Repeating next lines?
        if (suggestionLines.length > 1) {
            const firstIsEmpty = suggestionLines[0].trim() === "" || suggestionLines[0].trim() === suffix.trim();
            if (firstIsEmpty) {
                const linesAvailable = doc.lineCount - (pos.line + 1);
                const linesToCheck = Math.min(suggestionLines.length - 1, linesAvailable);
                if (linesToCheck > 0 &&
                    suggestionLines.slice(1, 1 + linesToCheck).every(
                        (val, idx) => pos.line + 1 + idx < doc.lineCount && val === doc.lineAt(pos.line + 1 + idx).text
                    )) {
                    return true;
                }
            }
        }

        // Lookahead matching
        let nextLineIdx = pos.line + 1;
        while (nextLineIdx < doc.lineCount && doc.lineAt(nextLineIdx).text.trim() === "") nextLineIdx++;

        if (nextLineIdx < doc.lineCount) {
            const nextLine = doc.lineAt(nextLineIdx).text;
            if ((prefix + suggestionLines[0]) === nextLine) {
                if (suggestionLines.length === 1) return true;
                if (suggestionLines.length > 2) {
                    const available = doc.lineCount - (nextLineIdx + 1);
                    const toCheck = Math.min(suggestionLines.length - 1, available);
                    if (toCheck > 0 &&
                        suggestionLines.slice(1, 1 + toCheck).every(
                            (val, idx) => nextLineIdx + 1 + idx < doc.lineCount && val === doc.lineAt(nextLineIdx + 1 + idx).text
                        )) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    static updateSuggestion(suggestionLines: string[], lineSuffix: string): string {
        const suffix = lineSuffix.trim();

        if (suffix === "") {
            return suggestionLines.join('\n');
        }

        // Single line: trim overlapping suffix
        if (suggestionLines.length === 1) {
            const line = suggestionLines[0];
            // Find where suffix appears at the end of the suggestion
            const idx = line.lastIndexOf(suffix);
            if (idx !== -1 && idx + suffix.length === line.length) {
                return line.slice(0, idx);
            }
            return line;
        }

        // Multi-line: the first line shares space with lineSuffix
        // Only return the first line's content before the suffix starts
        const firstLine = suggestionLines[0];
        const suffixIdx = firstLine.lastIndexOf(suffix);
        if (suffixIdx !== -1 && suffixIdx + suffix.length === firstLine.length) {
            suggestionLines[0] = firstLine.slice(0, suffixIdx);
        }

        return suggestionLines.join('\n');
    }
}
