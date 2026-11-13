import { CodeModel } from './interfaces/codeModel';
import { getLanguageProfile } from './languageProfiles';
import { ScannedToken, scanText } from './lexicalScanner';
import { serializeContext } from './utils/utils';

/**
 * Local repairs ("Quick Fix") for code that has already been typed.
 *
 * The n-gram model cannot understand intent, but it knows which token
 * sequences are normal. A scored repair is a small edit (quote a run of
 * words, insert/delete/swap one punctuation or operator token) whose result
 * the model finds far more natural than the original. Scoring uses normalized
 * token classes, so identifier names and literal contents do not matter.
 *
 * The model does not keep newlines, so two line-shape repairs (a missing `:`
 * on a Python block header and a bracket left open at the end of a
 * statement) are detected structurally instead.
 */

export interface RepairFix {
    /** Document offsets of the replaced text. */
    start: number;
    end: number;
    replacement: string;
    title: string;
    /** Natural-log likelihood improvement after the edit penalty. */
    gain: number;
}

export interface RepairOptions {
    /** Minimum log-likelihood gain for a fix to be offered. */
    minGain: number;
    /** Lines with more tokens than this are skipped to bound work. */
    maxLineTokens?: number;
    /**
     * Once a line qualifies through `minGain`, further alternatives on it
     * need only this gain (default: `minGain`).
     */
    alternativeMinGain?: number;
    /** Ranked alternatives returned per line (default 3). */
    maxPerLine?: number;
    shouldCancel?: () => boolean;
}

/** ln(12): the edited line must be roughly 12x more likely than the original. */
export const QUICK_FIX_MIN_GAIN = Math.log(12);
/** Alternatives on a line that already has a qualifying fix: about 4x. */
export const ALTERNATIVE_MIN_GAIN = Math.log(4);
/** Hints appear without being asked for, so they need much stronger evidence. */
export const HINT_MIN_GAIN = Math.log(150);
/** Fixed gain for structural repairs: physical layout is evidence the model cannot see. */
const STRUCTURAL_GAIN = Math.log(500);

const EDIT_PENALTY = Math.log(3);
const PROBABILITY_FLOOR = 1e-5;
const RIGHT_CONTEXT_TOKENS = 3;
const CLOSERS = new Set([',', ';', ':', ')', ']', '}']);
const INSERTABLE = [',', ';', ':', ')', ']', '}', '=', '.'];
const SWAPS = lookupTable<string[]>({
    '=': ['==', ':'], '==': ['='], ':': ['=', ';', ','], ';': [',', ':'], ',': [';', '.', ':'],
    '.': [','], '(': ['['], '[': ['('], ')': [']'], ']': [')'], '{': ['('], '}': [')']
});
const OPENERS = lookupTable<string>({ '(': ')', '[': ']', '{': '}' });
const CLOSER_TO_OPENER = lookupTable<string>({ ')': '(', ']': '[', '}': '{' });
/** Only these may be deleted: removing other operators (`*`, `&`, `!`) changes meaning. */
const REMOVABLE = new Set([',', ';', ':', '.', '(', ')', '[', ']', '{', '}', '=', '==']);

/** Token-keyed table without Object.prototype entries such as `toString`. */
function lookupTable<T>(entries: Record<string, T>): Record<string, T | undefined> {
    return Object.assign(Object.create(null) as Record<string, T | undefined>, entries);
}
const PYTHON_BLOCK_KEYWORDS = new Set([
    'if', 'elif', 'else', 'for', 'while', 'def', 'class', 'with', 'try', 'except', 'finally', 'async'
]);
const CONTROL_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'foreach', 'using', 'lock']);

interface ModelSource { model: CodeModel; extensions: string[] }

type ClassCounts = { counts: Map<string, number>; total: number };

/** Probability of the next normalized token class given normalized context. */
export class NgramScorer {
    private readonly keywords: Set<string>;
    private readonly maxOrder: number;
    private readonly minOrder: number;
    private readonly contextCache = new Map<string, ClassCounts | null>();
    private unigram?: ClassCounts;

    constructor(private readonly sources: ModelSource[], profileId: string) {
        this.keywords = new Set(getLanguageProfile(profileId).keywords);
        this.maxOrder = Math.max(...sources.map(s => s.model.max_order ?? s.model.n));
        this.minOrder = Math.min(...sources.map(s => s.model.min_order ?? 2));
    }

    /** Only v3 models with normalized contexts can score token classes. */
    static create(models: CodeModel[], extensions: string[], profileId: string): NgramScorer | undefined {
        const sources = models
            .filter(model => (model.format_version ?? 2) >= 3 && model.normalized_contexts && model.orders)
            .map(model => ({ model, extensions: extensions.filter(ext => model.orders?.[ext]) }))
            .filter(source => source.extensions.length > 0);
        return sources.length ? new NgramScorer(sources, profileId) : undefined;
    }

    /** Map a model's raw prediction key to the normalized class used in contexts. */
    classify(token: string): string {
        if (token.startsWith('<') && token.endsWith('>') && token.length > 2) return token;
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) return this.keywords.has(token) ? token : '<ID>';
        if (/^[0-9]/.test(token)) return '<NUM>';
        return token;
    }

    probability(context: readonly string[], next: string): number {
        let weighted = 0;
        let weights = 0;
        for (let order = this.maxOrder; order >= this.minOrder; order--) {
            if (context.length < order - 1) continue;
            const entry = this.lookup(order, context.slice(context.length - (order - 1)));
            if (!entry) continue;
            // Trust contexts seen often; a context seen once says little.
            const weight = Math.pow(0.65, this.maxOrder - order) * entry.total / (entry.total + 3);
            weighted += weight * (entry.counts.get(next) ?? 0) / entry.total;
            weights += weight;
        }
        const unigram = this.unigramCounts();
        const background = unigram.total > 0 ? (unigram.counts.get(next) ?? 0) / unigram.total : 0;
        const conditional = weights > 0 ? weighted / weights : background;
        return Math.max(PROBABILITY_FLOOR, 0.92 * conditional + 0.08 * background);
    }

    /** Sum of log-probabilities of `tokens[from..to)`, each given up to maxOrder-1 preceding tokens. */
    logLikelihood(tokens: readonly string[], from: number, to: number): number {
        let total = 0;
        for (let index = from; index < to; index++) {
            const context = tokens.slice(Math.max(0, index - (this.maxOrder - 1)), index);
            total += Math.log(this.probability(context, tokens[index]));
        }
        return total;
    }

    private lookup(order: number, context: readonly string[]): ClassCounts | null {
        const key = serializeContext([...context]);
        const cacheKey = `${order}|${key}`;
        const cached = this.contextCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const counts = new Map<string, number>();
        let total = 0;
        for (const { model, extensions } of this.sources) {
            for (const extension of extensions) {
                const raw = model.orders?.[extension]?.[String(order)]?.[key];
                if (!raw) continue;
                for (const [token, count] of Object.entries(raw)) {
                    const cls = this.classify(token);
                    counts.set(cls, (counts.get(cls) ?? 0) + count);
                    total += count;
                }
            }
        }
        const result = total > 0 ? { counts, total } : null;
        if (this.contextCache.size > 20000) this.contextCache.clear();
        this.contextCache.set(cacheKey, result);
        return result;
    }

    private unigramCounts(): ClassCounts {
        if (this.unigram) return this.unigram;
        const counts = new Map<string, number>();
        let total = 0;
        for (const { model, extensions } of this.sources) {
            for (const extension of extensions) {
                for (const [token, count] of Object.entries(model.token_frequencies?.[extension] ?? {})) {
                    const cls = this.classify(token);
                    counts.set(cls, (counts.get(cls) ?? 0) + count);
                    total += count;
                }
            }
        }
        this.unigram = { counts, total };
        return this.unigram;
    }
}

interface LineContext {
    text: string;
    tokens: ScannedToken[];
    tokenLines: number[];
    /** Token indices [first, last) on this line. */
    first: number;
    last: number;
    profileId: string;
    indent: number;
    /** Indentation of the next line holding code, or -1 at end of file. */
    nextIndent: number;
}

interface Candidate {
    /** Token indices [first, last) replaced in the document token list. */
    first: number;
    last: number;
    tokens: string[];
    start: number;
    end: number;
    replacement: string;
    title: string;
}

/**
 * Find repairs on each requested line, best first, at most `maxPerLine` per
 * line. `lines` are zero-based line numbers; when omitted every line is
 * examined.
 */
export function findRepairs(
    text: string,
    languageId: string,
    scorer: NgramScorer | undefined,
    options: RepairOptions,
    lines?: Iterable<number>
): RepairFix[] {
    const scan = scanText(text, languageId);
    const tokens = scan.tokens;
    if (tokens.length === 0) return [];
    const normalized = tokens.map(token => token.normalized);
    const lineStarts = computeLineStarts(text);
    const tokenLines = tokens.map(token => lineOf(token.start, lineStarts));

    const byLine = new Map<number, number[]>();
    tokenLines.forEach((line, index) => {
        const list = byLine.get(line);
        if (list) list.push(index); else byLine.set(line, [index]);
    });

    const wanted = lines ? Array.from(new Set(lines)) : Array.from(byLine.keys());
    const maxLineTokens = options.maxLineTokens ?? 60;
    const maxPerLine = options.maxPerLine ?? 3;
    const fixes: RepairFix[] = [];
    for (const line of wanted) {
        if (options.shouldCancel?.()) break;
        const indices = byLine.get(line);
        if (!indices || indices.length > maxLineTokens) continue;
        // A token that starts on an earlier line (multi-line string) belongs to that line.
        if (tokens[indices[0]].start < lineStarts[line]) continue;
        const context: LineContext = {
            text, tokens, tokenLines,
            first: indices[0], last: indices[indices.length - 1] + 1,
            profileId: scan.profileId,
            indent: indentAt(text, lineStarts[line]),
            nextIndent: nextCodeLineIndent(text, lineStarts, line, byLine)
        };
        const ranked = [
            ...structuralRepairs(context),
            ...(scorer ? scoredRepairs(context, normalized, scorer) : [])
        ].sort((a, b) => b.gain - a.gain);
        if (!ranked.length || ranked[0].gain < options.minGain) continue;
        const floor = Math.min(options.minGain, options.alternativeMinGain ?? options.minGain);
        const seen = new Set<string>();
        for (const fix of ranked) {
            const key = `${fix.start}:${fix.end}:${fix.replacement}`;
            if (fix.gain < floor) break;
            if (seen.has(key)) continue;
            seen.add(key);
            fixes.push(fix);
            if (seen.size >= maxPerLine) break;
        }
    }
    return fixes;
}

function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '\n') starts.push(index + 1);
    }
    return starts;
}

function lineOf(offset: number, lineStarts: number[]): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= offset) low = mid; else high = mid - 1;
    }
    return low;
}

function indentAt(text: string, offset: number): number {
    let width = 0;
    while (text[offset + width] === ' ' || text[offset + width] === '\t') width++;
    return width;
}

function nextCodeLineIndent(text: string, lineStarts: number[], line: number, byLine: Map<number, number[]>): number {
    for (let next = line + 1; next < lineStarts.length; next++) {
        if (byLine.has(next)) return indentAt(text, lineStarts[next]);
    }
    return -1;
}

/** Brackets opened on this line and not closed on it, outermost first. */
function unclosedBrackets(tokens: ScannedToken[], first: number, last: number): ScannedToken[] | undefined {
    const stack: ScannedToken[] = [];
    for (let index = first; index < last; index++) {
        const token = tokens[index];
        if (OPENERS[token.value]) {
            stack.push(token);
        } else if (CLOSER_TO_OPENER[token.value]) {
            // A closer for a bracket opened on an earlier line: not ours to judge.
            if (!stack.length || stack[stack.length - 1].value !== CLOSER_TO_OPENER[token.value]) return undefined;
            stack.pop();
        }
    }
    return stack;
}

function structuralRepairs(line: LineContext): RepairFix[] {
    const { tokens, first, last, profileId } = line;
    const fixes: RepairFix[] = [];
    const lastToken = tokens[last - 1];
    const stack = unclosedBrackets(tokens, first, last);
    if (!stack) return fixes;
    const nextIsIndented = line.nextIndent > line.indent;

    if (profileId === 'python' && PYTHON_BLOCK_KEYWORDS.has(tokens[first].value) &&
        lastToken.value !== ':' && stack.length === 0 &&
        (nextIsIndented || ['else', 'try', 'finally'].includes(lastToken.value))) {
        fixes.push({ start: lastToken.end, end: lastToken.end, replacement: ':', title: 'Insert `:`', gain: STRUCTURAL_GAIN });
    }

    let insertAt: number;
    if (lastToken.value === '{' && stack[stack.length - 1] === lastToken) {
        // `if (ready {` → `if (ready) {`: a block brace after an unbalanced condition.
        stack.pop();
        const open = stack[stack.length - 1];
        const keyword = open ? tokens[tokens.indexOf(open) - 1] : undefined;
        if (stack.length !== 1 || !keyword || !CONTROL_KEYWORDS.has(keyword.value)) return fixes;
        insertAt = tokens[last - 2].end;
    } else {
        if (stack.length === 0 || OPENERS[lastToken.value] || lastToken.value === ',' ||
            (lastToken.kind === 'operator' && lastToken.value !== ':')) {
            return fixes;
        }
        // The statement ends here unless the next line is indented further
        // (wrapped arguments) or starts with a closer or continuation.
        const nextToken = tokens[last];
        if (nextIsIndented || (nextToken && /^[)\]}.,]/.test(nextToken.value))) return fixes;
        if (stack.some(open => open.value === '{')) return fixes;
        const beforeTerminator = lastToken.value === ';' || (lastToken.value === ':' && profileId === 'python');
        if (beforeTerminator && last - 2 < first) return fixes;
        insertAt = beforeTerminator ? tokens[last - 2].end : lastToken.end;
    }
    const closers = stack.slice().reverse().map(open => OPENERS[open.value] ?? '').join('');
    fixes.push({ start: insertAt, end: insertAt, replacement: closers, title: `Insert \`${closers}\``, gain: STRUCTURAL_GAIN });
    return fixes;
}

function scoredRepairs(line: LineContext, normalized: string[], scorer: NgramScorer): RepairFix[] {
    const { first, last, tokens } = line;
    // Judge an edit by its own line plus a few following tokens, so a fix is
    // not rewarded for making the next line look strange.
    const windowEnd = Math.min(tokens.length, last + RIGHT_CONTEXT_TOKENS);
    const originalLength = windowEnd - first;
    // Compare mean per-token likelihood so deletions are not favored merely
    // for making the line shorter, then scale back to the line's length.
    const original = scorer.logLikelihood(normalized, first, windowEnd) / originalLength;

    const fixes: RepairFix[] = [];
    for (const candidate of generateCandidates(line)) {
        const edited = [
            ...normalized.slice(0, candidate.first),
            ...candidate.tokens,
            ...normalized.slice(candidate.last)
        ];
        const shift = candidate.tokens.length - (candidate.last - candidate.first);
        const editedLength = originalLength + shift;
        if (editedLength <= 0) continue;
        const score = scorer.logLikelihood(edited, first, windowEnd + shift) / editedLength;
        fixes.push({
            start: candidate.start,
            end: candidate.end,
            replacement: candidate.replacement,
            title: candidate.title,
            gain: (score - original) * originalLength - EDIT_PENALTY
        });
    }
    return fixes;
}

function* generateCandidates(line: LineContext): Generator<Candidate> {
    const { text, tokens, tokenLines, first, last } = line;
    yield* quoteRuns(line);

    for (let index = first + 1; index <= last; index++) {
        const previous = tokens[index - 1];
        const next = tokens[index] as ScannedToken | undefined;
        const endOfLine = !next || index === last || tokenLines[index] !== tokenLines[index - 1];
        for (const insert of INSERTABLE) {
            if (endOfLine && !CLOSERS.has(insert)) continue;
            if (CLOSER_TO_OPENER[insert] && !hasUnclosed(tokens, first, index, CLOSER_TO_OPENER[insert], insert)) continue;
            let end = previous.end;
            let replacement = insert;
            if (insert === '.') {
                // `foo bar()` → `foo.bar()`: only across a single space.
                if (!next || next.start !== previous.end + 1 || text[previous.end] !== ' ') continue;
                end = next.start;
            } else if (insert === '=') {
                replacement = text[previous.end] === ' ' ? ' =' : ' = ';
            }
            yield {
                first: index, last: index, tokens: [insert], start: previous.end, end, replacement,
                title: `Insert \`${insert}\``
            };
        }
    }

    for (let index = first; index < last; index++) {
        const token = tokens[index];
        if (!REMOVABLE.has(token.value)) continue;
        const end = text[token.start - 1] === ' ' && text[token.end] === ' ' ? token.end + 1 : token.end;
        yield { first: index, last: index + 1, tokens: [], start: token.start, end, replacement: '', title: `Remove \`${token.value}\`` };
        for (const swap of SWAPS[token.value] ?? []) {
            // `==` inside a condition is right; only a bare statement such as
            // `value == 3` may have meant assignment.
            if (token.value === '==' && tokens.slice(first, index).some(t => t.kind === 'keyword')) continue;
            yield {
                first: index, last: index + 1, tokens: [swap], start: token.start, end: token.end, replacement: swap,
                title: `Replace \`${token.value}\` with \`${swap}\``
            };
        }
    }
}

function hasUnclosed(tokens: ScannedToken[], first: number, before: number, open: string, close: string): boolean {
    let depth = 0;
    for (let index = first; index < before; index++) {
        if (tokens[index].value === open) depth++;
        else if (tokens[index].value === close) depth--;
    }
    return depth > 0;
}

/** Runs of two or more bare words, such as `hello world` in `print(hello world)`. */
function* quoteRuns(line: LineContext): Generator<Candidate> {
    const { text, tokens, first, last, profileId } = line;
    let index = first;
    while (index < last) {
        if (!isWord(tokens[index])) { index++; continue; }
        let end = index + 1;
        while (end < last && isWord(tokens[end])) end++;
        const words = tokens.slice(index, end);
        if (words.filter(word => word.kind === 'identifier').length >= 2) {
            const start = words[0].start;
            const stop = words[words.length - 1].end;
            const body = text.slice(start, stop);
            const quote = !body.includes('"') ? '"' : profileId !== 'rust' && !body.includes("'") ? "'" : '';
            if (quote) {
                yield {
                    first: index, last: end, tokens: ['<STR>'], start, end: stop,
                    replacement: `${quote}${body}${quote}`,
                    title: `Make \`${body}\` a string`
                };
            }
        }
        index = end;
    }
}

function isWord(token: ScannedToken): boolean {
    return token.kind === 'identifier' || token.kind === 'keyword' || token.kind === 'number';
}
