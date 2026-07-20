import { CodeModel } from './interfaces/codeModel';
import { Suggestion } from './interfaces/suggestion';
import { serializeContext } from './utils/utils';

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
