import { scanText, ScanResult } from './lexicalScanner';

interface Entry { version: number; language: string; offset: number; text: string; scan: ScanResult }

/** One cached cursor prefix per document, bounded by both size and document count. */
export class PrefixScanCache {
    private entries = new Map<string, Entry>();
    private characters = 0;
    public hits = 0;
    public misses = 0;

    constructor(private maxCharacters = 300_000, private maxDocuments = 8) {}

    public get(uri: string, version: number, language: string, offset: number, read: () => string): Entry {
        const existing = this.entries.get(uri);
        if (existing && existing.version === version && existing.language === language && existing.offset === offset) {
            this.hits++;
            this.entries.delete(uri);
            this.entries.set(uri, existing);
            return existing;
        }
        this.misses++;
        this.remove(uri);
        const text = read();
        const entry = { version, language, offset, text, scan: scanText(text, language, text.length) };
        if (text.length <= this.maxCharacters) {
            while (this.entries.size >= this.maxDocuments || this.characters + text.length > this.maxCharacters) {
                const oldest = this.entries.keys().next().value;
                if (oldest === undefined) break;
                this.remove(oldest);
            }
            this.entries.set(uri, entry);
            this.characters += text.length;
        }
        return entry;
    }

    public remove(uri: string): void {
        this.characters -= this.entries.get(uri)?.text.length ?? 0;
        this.entries.delete(uri);
    }

    public clear(): void { this.entries.clear(); this.characters = 0; }
    public get size(): number { return this.entries.size; }
}
