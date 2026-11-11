/** Session-only preferences. Never writes code or user choices to disk. */
export class AcceptanceMemory {
    private contexts = new Map<string, Map<string, number>>();
    public accepted = 0;

    constructor(private capacity = 256) {}

    public record(key: string, text: string): void {
        if (!key || !text || key.length > 2048 || text.length > 512) return;
        const choices = this.contexts.get(key) ?? new Map<string, number>();
        const previous = choices.get(text) ?? 0;
        choices.delete(text);
        choices.set(text, Math.min(previous + 1, 20));
        if (choices.size > 10) choices.delete(choices.keys().next().value!);
        this.contexts.delete(key);
        this.contexts.set(key, choices);
        if (this.contexts.size > this.capacity) this.contexts.delete(this.contexts.keys().next().value!);
        this.accepted++;
    }

    public rank<T extends { token: string }>(key: string, candidates: T[]): T[] {
        const choices = this.contexts.get(key);
        if (!choices) return candidates;
        // Stable sort preserves the engine's ranking for choices with equal support.
        return [...candidates].sort((a, b) => (choices.get(b.token) ?? 0) - (choices.get(a.token) ?? 0));
    }

    public clear(): void {
        this.contexts.clear();
        this.accepted = 0;
    }

    public get size(): number { return this.contexts.size; }
}
