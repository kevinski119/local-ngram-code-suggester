import { CodeModel } from './interfaces/codeModel';
import { Suggestion } from './interfaces/suggestion';
import { serializeContext } from './utils/utils';

/**
 * A boundary at the end of the current physical line is a signal for the user
 * to move to the next line. Without this guard, a fresh provider request after
 * accepting a completion such as `if ready:` can append the model's next
 * statement directly after the colon.
 */
export function shouldSuppressAfterLineBoundary(
    currentLinePrefix: string,
    finalToken: string | undefined,
    statementBoundaries: readonly string[]
): boolean {
    if (!finalToken || !statementBoundaries.includes(finalToken)) {
        return false;
    }
    return currentLinePrefix.trimEnd().endsWith(finalToken);
}

const ALLOWED_WORDS_AFTER_CLOSING = new Set([
    'and', 'else', 'instanceof', 'or', 'throws'
]);

/**
 * Reject obvious token collisions caused by the compact model not retaining
 * newlines. Operators and punctuation remain valid after a closing expression,
 * but an unrelated word cannot be appended directly after `)` or `]`.
 */
export function isPlausibleTokenTransition(
    previousToken: string | undefined,
    nextToken: string,
    profileId: string
): boolean {
    if (previousToken !== ')' && previousToken !== ']') {
        return true;
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(nextToken)) {
        return true;
    }
    if (ALLOWED_WORDS_AFTER_CLOSING.has(nextToken)) {
        return true;
    }
    return profileId === 'java' && nextToken === 'permits';
}

export function shouldPreferPythonBlockBoundary(
    lineTokens: string[],
    previousToken: string | undefined
): boolean {
    if (previousToken !== ')') return false;
    const controlKeywords = new Set(['class', 'def', 'elif', 'for', 'if', 'while']);
    return lineTokens.some(token => controlKeywords.has(token));
}

export function generateBackoffSuggestions(
    model: CodeModel,
    rawContext: string[],
    normalizedContext: string[],
    languageExtensions: string[],
    minConfidence = 0.01
): Suggestion[] {
    const formatVersion = model.format_version ?? 2;
    const contextTokens = formatVersion >= 3 && model.normalized_contexts
        ? normalizedContext
        : rawContext;
    const scores = new Map<string, Suggestion>();
    const maxOrder = model.max_order ?? model.n;
    const minOrder = model.min_order ?? model.n;

    for (const extension of languageExtensions) {
        for (let order = maxOrder; order >= minOrder; order--) {
            if (contextTokens.length < order - 1) continue;
            const contextKey = serializeContext(contextTokens.slice(-(order - 1)));
            const languageData = formatVersion >= 3
                ? model.orders?.[extension]?.[String(order)]
                : order === model.n
                    ? model.ngrams?.[extension]
                    : undefined;
            const counts = languageData?.[contextKey];
            if (!counts) continue;
            const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
            if (total <= 0) continue;
            const backoffWeight = Math.pow(0.65, maxOrder - order);
            for (const [token, count] of Object.entries(counts)) {
                const contribution = (count / total) * backoffWeight;
                const existing = scores.get(token);
                if (existing) {
                    existing.confidence += contribution;
                    existing.order = Math.max(existing.order ?? order, order);
                } else {
                    scores.set(token, {
                        token,
                        confidence: contribution,
                        source: 'global',
                        order
                    });
                }
            }
        }
    }

    return Array.from(scores.values())
        .filter(suggestion => suggestion.confidence >= minConfidence)
        .sort((a, b) => b.confidence - a.confidence);
}

export function formatTokenSequence(
    tokens: string[],
    display: (token: string) => string
): string {
    let output = '';
    for (const rawToken of tokens) {
        const token = display(rawToken);
        if (!token) continue;
        if (!output) {
            output = token;
        } else if (/^[,.;:)\]}]$/.test(token)) {
            output += token;
        } else if (/^[([{]$/.test(token) || /[.([{]$/.test(output)) {
            output += token;
        } else {
            output += ` ${token}`;
        }
    }
    return output;
}
