/** Build one edit for both IntelliSense and ghost text, preserving existing suffixes. */
export function completionEdit(text: string, prefix: string, right: string): {
    text: string; before: number; after: number;
} | undefined {
    if (!text || (prefix && !text.startsWith(prefix))) return undefined;
    const wordSuffix = right.match(/^[A-Za-z0-9_$]+/)?.[0] ?? '';
    let after = 0;
    if (wordSuffix) {
        // Only replace the rest of a word when it agrees with the prediction.
        const firstWord = text.match(/^[A-Za-z0-9_$]+/)?.[0] ?? '';
        if (!prefix || !firstWord.slice(prefix.length).endsWith(wordSuffix)) return undefined;
        after = wordSuffix.length;
    }
    const remaining = right.slice(after);
    for (let length = Math.min(remaining.length, text.length - prefix.length); length > 0; length--) {
        const overlap = remaining.slice(0, length);
        if (/^[\s)\]};,]+$/.test(overlap) && text.endsWith(overlap)) {
            after += length;
            break;
        }
    }
    if (text === prefix + right.slice(0, after)) return undefined;
    return { text, before: prefix.length, after };
}
