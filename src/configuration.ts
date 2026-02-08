import * as vscode from 'vscode';

export class Configuration {
    get config() { return vscode.workspace.getConfiguration("llama-lite"); }
    get endpoint() { return this.config.get<string>("endpoint", "http://127.0.0.1:8012"); }
    get apiKey() { return this.config.get<string>("api_key", ""); }
    get nPrefix() { return this.config.get<number>("n_prefix", 256); }
    get nSuffix() { return this.config.get<number>("n_suffix", 64); }
    get nPredict() { return this.config.get<number>("n_predict", 128); }
    get ringNChunks() { return this.config.get<number>("ring_n_chunks", 16); }
    get ringChunkSize() { return 64; }
    get ringUpdateMs() { return 1000; }

    // for filtering and throttling
    get maxLineSuffix() { return this.config.get<number>("max_line_suffix", 8); }
    get delayBeforeRequest() { return 150; } // Debounce ms
    get ringUpdateMinTimeLastCompl() { return 3000; } // Throttle context updates if typing
}
