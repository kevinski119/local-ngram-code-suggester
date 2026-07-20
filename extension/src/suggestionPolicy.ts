const STRONG_TRIGGER_CHARACTERS = new Set([
    '.', '=', '(', '[', '{', ':', ','
]);

/**
 * Deterministic frequency policy for automatic ghost text. This is deliberately
 * separate from confidence: confidence controls quality, while frequency
 * controls how often a qualified suggestion is allowed to appear.
 */
export function shouldOfferAutomaticSuggestion(
    linePrefix: string,
    configuredFrequency: number
): boolean {
    const frequency = Math.max(0, Math.min(100, configuredFrequency));
    if (frequency === 0) return false;
    if (frequency >= 90) return true;

    const lastCharacter = linePrefix.slice(-1);
    if (STRONG_TRIGGER_CHARACTERS.has(lastCharacter)) {
        return true;
    }

    const activeIdentifier = linePrefix.match(/[A-Za-z_$][A-Za-z0-9_$]*$/)?.[0] ?? '';
    if (frequency >= 65) {
        return activeIdentifier.length >= 2 || lastCharacter === ' ';
    }
    if (frequency >= 35) {
        return activeIdentifier.length >= 3;
    }
    return false;
}
