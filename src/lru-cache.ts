export class LRUCache {
    private cache: Map<string, string[]>;
    private maxSize: number;

    constructor(maxSize: number) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key: string): string[] | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to front (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    put(key: string, value: string[]): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first item)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}
