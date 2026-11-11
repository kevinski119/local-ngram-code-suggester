import { getLanguageProfile, LanguageProfile, StringDefinition } from './languageProfiles';

export type TokenKind = 'identifier' | 'keyword' | 'number' | 'string' | 'operator' | 'punctuation';

export interface ScannedToken {
    value: string;
    normalized: string;
    kind: TokenKind;
    start: number;
    end: number;
}

export interface ScanResult {
    tokens: ScannedToken[];
    cursorInComment: boolean;
    cursorInString?: boolean;
    cursorInSupportedRegion: boolean;
    profileId: string;
}

const OPERATOR_CHARS = new Set('+-*/=<>!&|^~%?:');
const PUNCTUATION = new Set(';,.()[]{}');
const REGEX_PREFIX_TOKENS = new Set([
    '(', '[', '{', ',', ':', ';', '=', '==', '===', '!', '!=', '!==',
    '&&', '||', '?', 'return', 'case', '=>'
]);

const preparedProfiles = new WeakMap<LanguageProfile, {
    keywords: Set<string>; strings: StringDefinition[];
    lineComments: string[]; blockComments: LanguageProfile['blockComments'];
}>();

function prepareProfile(profile: LanguageProfile) {
    let prepared = preparedProfiles.get(profile);
    if (!prepared) {
        prepared = {
            keywords: new Set(profile.keywords),
            strings: [...profile.strings].sort((a, b) => b.start.length - a.start.length),
            lineComments: [...profile.lineComments].sort((a, b) => b.length - a.length),
            blockComments: [...profile.blockComments].sort((a, b) => b.start.length - a.start.length)
        };
        preparedProfiles.set(profile, prepared);
    }
    return prepared;
}

function startsWithAt(text: string, needle: string, offset: number, caseInsensitive = false): boolean {
    const candidate = text.slice(offset, offset + needle.length);
    return caseInsensitive
        ? candidate.toLowerCase() === needle.toLowerCase()
        : candidate === needle;
}

function findStringDefinition(
    text: string,
    offset: number,
    strings: StringDefinition[]
): StringDefinition | undefined {
    return strings
        .find(definition => startsWithAt(text, definition.start, offset, definition.caseInsensitive));
}

function consumeString(text: string, offset: number, definition: StringDefinition): { end: number; closed: boolean } {
    let cursor = offset + definition.start.length;
    while (cursor < text.length) {
        if (!definition.multiline && (text[cursor] === '\n' || text[cursor] === '\r')) {
            return { end: cursor, closed: false };
        }
        if (definition.escape && startsWithAt(text, definition.escape, cursor)) {
            cursor += definition.escape.length;
            if (definition.escape === '\\' && cursor < text.length) {
                cursor++;
            }
            continue;
        }
        if (startsWithAt(text, definition.end, cursor, definition.caseInsensitive)) {
            return { end: cursor + definition.end.length, closed: true };
        }
        cursor++;
    }
    return { end: cursor, closed: false };
}

function consumeJavaScriptRegex(text: string, offset: number): number | undefined {
    let cursor = offset + 1;
    let escaped = false;
    let inCharacterClass = false;
    while (cursor < text.length) {
        const character = text[cursor];
        if (character === '\n' || character === '\r') return undefined;
        if (escaped) {
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else if (character === '[') {
            inCharacterClass = true;
        } else if (character === ']') {
            inCharacterClass = false;
        } else if (character === '/' && !inCharacterClass) {
            cursor++;
            while (cursor < text.length && /[A-Za-z]/.test(text[cursor])) cursor++;
            return cursor;
        }
        cursor++;
    }
    return undefined;
}

export function scanText(
    text: string,
    languageIdOrExtension?: string,
    cursorOffset = text.length
): ScanResult {
    const key = languageIdOrExtension?.toLowerCase();
    if (key === 'vue' || key === '.vue') {
        return scanVueScriptRegions(text, cursorOffset);
    }
    const profile = getLanguageProfile(languageIdOrExtension, text);
    const prepared = prepareProfile(profile);
    const keywordSet = prepared.keywords;
    const tokens: ScannedToken[] = [];
    let cursor = 0;
    let cursorInComment = false;
    let cursorInString = false;

    while (cursor < text.length) {
        const lineComment = prepared.lineComments
            .find(marker => startsWithAt(text, marker, cursor));
        if (lineComment) {
            const end = text.indexOf('\n', cursor + lineComment.length);
            const commentEnd = end < 0 ? text.length : end;
            if (cursorOffset >= cursor && cursorOffset <= commentEnd) {
                cursorInComment = true;
            }
            cursor = commentEnd;
            continue;
        }

        const blockComment = prepared.blockComments
            .find(definition => startsWithAt(text, definition.start, cursor));
        if (blockComment) {
            let depth = 1;
            let end = cursor + blockComment.start.length;
            while (end < text.length && depth > 0) {
                if (blockComment.nested && startsWithAt(text, blockComment.start, end)) {
                    depth++;
                    end += blockComment.start.length;
                } else if (startsWithAt(text, blockComment.end, end)) {
                    depth--;
                    end += blockComment.end.length;
                } else {
                    end++;
                }
            }
            if (cursorOffset >= cursor && cursorOffset <= end) {
                cursorInComment = true;
            }
            cursor = end;
            continue;
        }

        if (profile.id === 'rust') {
            const rest = text.slice(cursor);
            const rawString = /^(?:br|cr|r)(#{0,255})"/.exec(rest);
            if (rawString) {
                const closing = '"' + rawString[1];
                const closingAt = text.indexOf(closing, cursor + rawString[0].length);
                const end = closingAt < 0 ? text.length : closingAt + closing.length;
                if (cursorOffset > cursor && (cursorOffset < end || (closingAt < 0 && cursorOffset === end))) cursorInString = true;
                tokens.push({ value: '<STR>', normalized: '<STR>', kind: 'string', start: cursor, end });
                cursor = end;
                continue;
            }
            const character = /^(?:b)?'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|[^\r\n])|[^'\\\r\n])'/u.exec(rest);
            const lifetime = /^'(?:r#)?[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
            const rawIdentifier = /^r#[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
            const special = character ?? lifetime ?? rawIdentifier;
            if (special) {
                const value = character ? '<STR>' : special[0];
                const end = cursor + special[0].length;
                tokens.push({ value, normalized: character ? '<STR>' : '<ID>', kind: character ? 'string' : 'identifier', start: cursor, end });
                cursor = end;
                continue;
            }
            const number = /^(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|[0-9][0-9_]*(?:\.(?!\.)[0-9][0-9_]*)?(?:[eE][+-]?[0-9_]+)?)(?:[iu](?:8|16|32|64|128|size)|f(?:32|64))?/.exec(rest);
            if (number) {
                const end = cursor + number[0].length;
                tokens.push({ value: number[0], normalized: '<NUM>', kind: 'number', start: cursor, end });
                cursor = end;
                continue;
            }
            const operator = /^(?:<<=|>>=|\.\.=|::|->|=>|\.\.|&&|\|\||==|!=|<=|>=|<<|>>|[+\-*/%&|^]=|[+\-*/=<>!&|^~%?:#@])/.exec(rest);
            if (operator) {
                const value = operator[0];
                tokens.push({ value, normalized: value, kind: 'operator', start: cursor, end: cursor + value.length });
                cursor += value.length;
                continue;
            }
        }

        const stringDefinition = findStringDefinition(text, cursor, prepared.strings);
        if (stringDefinition) {
            const { end, closed } = consumeString(text, cursor, stringDefinition);
            // Scan the prefix through the cursor: an unfinished literal must not receive code.
            if (cursorOffset > cursor && (cursorOffset < end || (!closed && cursorOffset === end))) cursorInString = true;
            tokens.push({
                value: '<STR>',
                normalized: '<STR>',
                kind: 'string',
                start: cursor,
                end
            });
            cursor = end;
            continue;
        }

        if (
            text[cursor] === '/' &&
            (profile.id === 'javascript' || profile.id === 'typescript') &&
            (tokens.length === 0 || REGEX_PREFIX_TOKENS.has(tokens.at(-1)?.value ?? ''))
        ) {
            const end = consumeJavaScriptRegex(text, cursor);
            if (end) {
                tokens.push({
                    value: '<STR>',
                    normalized: '<STR>',
                    kind: 'string',
                    start: cursor,
                    end
                });
                cursor = end;
                continue;
            }
        }

        const character = text[cursor];
        if (/\s/.test(character)) {
            cursor++;
            continue;
        }

        if (/[A-Za-z_$]/.test(character)) {
            const start = cursor++;
            while (cursor < text.length && /[A-Za-z0-9_$]/.test(text[cursor])) {
                cursor++;
            }
            const value = text.slice(start, cursor);
            const keyword = keywordSet.has(value);
            tokens.push({
                value,
                normalized: keyword ? value : '<ID>',
                kind: keyword ? 'keyword' : 'identifier',
                start,
                end: cursor
            });
            continue;
        }

        if (/[0-9]/.test(character)) {
            const start = cursor++;
            while (cursor < text.length && /[0-9A-Fa-f_xXobOB.n]/.test(text[cursor])) {
                cursor++;
            }
            tokens.push({
                value: text.slice(start, cursor),
                normalized: '<NUM>',
                kind: 'number',
                start,
                end: cursor
            });
            continue;
        }

        if (OPERATOR_CHARS.has(character)) {
            const start = cursor++;
            while (cursor < text.length && OPERATOR_CHARS.has(text[cursor])) {
                cursor++;
            }
            const value = text.slice(start, cursor);
            tokens.push({ value, normalized: value, kind: 'operator', start, end: cursor });
            continue;
        }

        if (PUNCTUATION.has(character)) {
            tokens.push({
                value: character,
                normalized: character,
                kind: 'punctuation',
                start: cursor,
                end: cursor + 1
            });
        }
        cursor++;
    }

    return {
        tokens,
        cursorInComment,
        cursorInString,
        cursorInSupportedRegion: true,
        profileId: profile.id
    };
}

function scanVueScriptRegions(text: string, cursorOffset: number): ScanResult {
    const tokens: ScannedToken[] = [];
    let cursorInComment = false;
    let cursorInSupportedRegion = false;
    let cursorInString = false;
    const openingPattern = /<script\b[^>]*>/gi;
    let opening: RegExpExecArray | null;
    while ((opening = openingPattern.exec(text)) !== null) {
        const contentStart = opening.index + opening[0].length;
        const closingStart = text.toLowerCase().indexOf('</script>', contentStart);
        const contentEnd = closingStart < 0 ? text.length : closingStart;
        const language = /\blang\s*=\s*["']ts["']/i.test(opening[0])
            ? 'typescript'
            : 'javascript';
        const relativeCursor = Math.max(0, Math.min(cursorOffset - contentStart, contentEnd - contentStart));
        const result = scanText(
            text.slice(contentStart, contentEnd),
            language,
            relativeCursor
        );
        tokens.push(...result.tokens.map(token => ({
            ...token,
            start: token.start + contentStart,
            end: token.end + contentStart
        })));
        if (cursorOffset >= contentStart && cursorOffset <= contentEnd) {
            cursorInSupportedRegion = true;
            cursorInComment = result.cursorInComment;
            cursorInString = result.cursorInString ?? false;
        }
        openingPattern.lastIndex = closingStart < 0
            ? text.length
            : closingStart + '</script>'.length;
    }
    return {
        tokens,
        cursorInComment,
        cursorInString,
        cursorInSupportedRegion,
        profileId: 'typescript'
    };
}

export function tokenizeText(text: string, languageIdOrExtension?: string): string[] {
    return scanText(text, languageIdOrExtension).tokens.map(token => token.value);
}

export function tokenizeNormalized(text: string, languageIdOrExtension?: string): string[] {
    return scanText(text, languageIdOrExtension).tokens.map(token => token.normalized);
}

export function normalizeToken(token: string, languageIdOrExtension?: string): string {
    const scanned = scanText(token, languageIdOrExtension).tokens;
    return scanned.length === 1 ? scanned[0].normalized : token;
}
