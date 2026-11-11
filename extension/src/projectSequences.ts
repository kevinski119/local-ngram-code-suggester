import { ScannedToken } from './lexicalScanner';

export interface SequenceMatch { text: string; matchedTokens: number; tokenCount: number; leadingSpace: boolean }

/** Retrieve real single-line continuations, preserving source spacing. */
export class ProjectSequences {
    private positions = new Map<string, number[]>();

    constructor(private text: string, private tokens: ScannedToken[]) {
        for (let next = 2; next < tokens.length; next++) {
            const pair = tokens.slice(next - 2, next);
            if (!pair.some(token => token.kind === 'identifier')) continue;
            if (pair.some(token => token.kind === 'string')) continue;
            if (!/^[ \t]*$/.test(text.slice(pair[0].end, pair[1].start))) continue;
            const key = JSON.stringify(pair.map(token => token.value));
            const offsets = this.positions.get(key) ?? [];
            offsets.push(next);
            this.positions.set(key, offsets);
        }
    }

    public find(context: string[], prefix: string, maxTokens: number, shouldStop: () => boolean): SequenceMatch[] {
        if (context.length < 2 || maxTokens < 1) return [];
        const result: SequenceMatch[] = [];
        const positions = this.positions.get(JSON.stringify(context.slice(-2))) ?? [];
        // Recent occurrences first; never scan every occurrence in a repetitive file.
        for (const next of positions.slice(-128).reverse()) {
            if (shouldStop()) break;
            const first = this.tokens[next];
            if (prefix && (!first.value.startsWith(prefix) || first.value === prefix)) continue;
            let matched = 2;
            while (matched < Math.min(6, context.length, next)) {
                const previous = this.tokens[next - matched - 1];
                if (previous.value !== context[context.length - matched - 1] || previous.kind === 'string') break;
                if (!/^[ \t]*$/.test(this.text.slice(previous.end, this.tokens[next - matched].start))) break;
                matched++;
            }
            let end = next;
            let previousEnd = this.tokens[next - 1].end;
            let safeEnd = next;
            for (; end < Math.min(this.tokens.length, next + Math.min(12, maxTokens)); end++) {
                const token = this.tokens[end];
                if (token.kind === 'string' || !/^[ \t]*$/.test(this.text.slice(previousEnd, token.start))) break;
                if (token.end - first.start > 160) break;
                previousEnd = token.end;
                if (!['.', '::', ',', '(', '[', '->', '=>'].includes(token.value) && token.kind !== 'operator') safeEnd = end + 1;
                if ([';', '{', '}'].includes(token.value)) break;
            }
            if (safeEnd === next) continue;
            const text = this.text.slice(first.start, this.tokens[safeEnd - 1].end);
            if (text === prefix) continue;
            result.push({ text, matchedTokens: matched, tokenCount: safeEnd - next,
                leadingSpace: first.start > this.tokens[next - 1].end });
        }
        return result;
    }
}
