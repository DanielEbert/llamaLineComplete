import { Configuration } from './configuration';
import { ContextManager } from './context-manager';

export class LlamaClient {
    constructor(private config: Configuration, private ctx: ContextManager) { }

    private async post(body: any, signal?: AbortSignal) {
        try {
            const res = await fetch(`${this.config.endpoint}/infill`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify(body),
                signal
            });
            if (!res.ok) throw new Error(`Status: ${res.status}`);
            return await res.json();
        } catch (e) {
            // Suppress connection errors for cleaner logs
            return null;
        }
    }

    // Speculative Execution & Cache Priming
    // If n_predict > 0, we are generating future text to store in LRU
    public async request(
        prefix: string,
        suffix: string,
        prompt: string,
        nIndent: number,
        nPredict: number, // 0 for priming, >0 for generation
        signal?: AbortSignal
    ): Promise<string | null> {

        const payload = {
            input_prefix: prefix,
            input_suffix: suffix,
            input_extra: this.ctx.chunks.map(c => ({ filename: c.filename, text: c.text })),
            prompt: prompt,
            n_predict: nPredict,
            n_indent: nIndent,
            cache_prompt: true, // Key to KV Cache reuse
            stream: false,
            t_max_prompt_ms: 500,
            t_max_predict_ms: nPredict === 0 ? 1 : 2500
        };

        const data: any = await this.post(payload, signal);
        return data ? data.content : null;
    }
}
