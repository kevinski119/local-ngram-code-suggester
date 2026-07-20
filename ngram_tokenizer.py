"""Comment-safe tokenizer shared by the trainer's language profiles.

The TypeScript runtime uses the same declarative profile file and is held to
the same golden fixtures. Keeping this module dependency-free makes model
training available anywhere Python 3.9+ is installed.
"""

import json
import os
from dataclasses import dataclass


PROFILE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'extension',
    'src',
    'languageProfiles.json',
)
OPERATOR_CHARS = set('+-*/=<>!&|^~%?:')
PUNCTUATION = set(';,.()[]{}')
REGEX_PREFIX_TOKENS = {
    '(', '[', '{', ',', ':', ';', '=', '==', '===', '!', '!=', '!==',
    '&&', '||', '?', 'return', 'case', '=>',
}


with open(PROFILE_PATH, 'r', encoding='utf-8') as profile_file:
    PROFILE_DATA = json.load(profile_file)

TOKENIZER_PROFILE_VERSION = PROFILE_DATA['version']
LANGUAGE_PROFILES = PROFILE_DATA['profiles']


@dataclass(frozen=True)
class Token:
    value: str
    normalized: str
    kind: str
    start: int
    end: int


def get_language_profile(language_id_or_extension=None, text=''):
    key = (language_id_or_extension or '').lower()
    if key:
        extension_key = key if key.startswith('.') else f'.{key}'
        for profile in LANGUAGE_PROFILES:
            if (
                profile['id'] == key
                or key in profile['languageIds']
                or extension_key in profile['extensions']
            ):
                return profile

    if text.startswith('#!'):
        first_line = text.splitlines()[0].lower()
        for profile in LANGUAGE_PROFILES:
            if any(marker in first_line for marker in profile.get('shebangs', [])):
                return profile

    return next(profile for profile in LANGUAGE_PROFILES if profile['id'] == 'typescript')


def _starts_with(text, needle, offset, case_insensitive=False):
    candidate = text[offset:offset + len(needle)]
    return (
        candidate.lower() == needle.lower()
        if case_insensitive
        else candidate == needle
    )


def _find_string_definition(text, offset, profile):
    definitions = sorted(profile['strings'], key=lambda item: len(item['start']), reverse=True)
    for definition in definitions:
        if _starts_with(
            text,
            definition['start'],
            offset,
            definition.get('caseInsensitive', False),
        ):
            return definition
    return None


def _consume_string(text, offset, definition):
    cursor = offset + len(definition['start'])
    while cursor < len(text):
        if not definition.get('multiline') and text[cursor] in '\r\n':
            return cursor
        escape = definition.get('escape')
        if escape and _starts_with(text, escape, cursor):
            cursor += len(escape)
            if escape == '\\' and cursor < len(text):
                cursor += 1
            continue
        if _starts_with(
            text,
            definition['end'],
            cursor,
            definition.get('caseInsensitive', False),
        ):
            return cursor + len(definition['end'])
        cursor += 1
    return cursor


def _consume_javascript_regex(text, offset):
    cursor = offset + 1
    escaped = False
    in_character_class = False
    while cursor < len(text):
        character = text[cursor]
        if character in '\r\n':
            return None
        if escaped:
            escaped = False
        elif character == '\\':
            escaped = True
        elif character == '[':
            in_character_class = True
        elif character == ']':
            in_character_class = False
        elif character == '/' and not in_character_class:
            cursor += 1
            while cursor < len(text) and text[cursor].isalpha():
                cursor += 1
            return cursor
        cursor += 1
    return None


def scan_text(text, language_id_or_extension=None, cursor_offset=None):
    key = (language_id_or_extension or '').lower()
    if key in {'vue', '.vue'}:
        return _scan_vue_script_regions(text, cursor_offset)
    profile = get_language_profile(language_id_or_extension, text)
    keywords = set(profile['keywords'])
    cursor_offset = len(text) if cursor_offset is None else cursor_offset
    tokens = []
    cursor = 0
    cursor_in_comment = False

    while cursor < len(text):
        line_comment = next(
            (
                marker
                for marker in sorted(profile['lineComments'], key=len, reverse=True)
                if _starts_with(text, marker, cursor)
            ),
            None,
        )
        if line_comment:
            end = text.find('\n', cursor + len(line_comment))
            comment_end = len(text) if end < 0 else end
            if cursor <= cursor_offset <= comment_end:
                cursor_in_comment = True
            cursor = comment_end
            continue

        block_comment = next(
            (
                definition
                for definition in sorted(
                    profile['blockComments'],
                    key=lambda item: len(item['start']),
                    reverse=True,
                )
                if _starts_with(text, definition['start'], cursor)
            ),
            None,
        )
        if block_comment:
            depth = 1
            end = cursor + len(block_comment['start'])
            while end < len(text) and depth > 0:
                if block_comment.get('nested') and _starts_with(
                    text, block_comment['start'], end
                ):
                    depth += 1
                    end += len(block_comment['start'])
                elif _starts_with(text, block_comment['end'], end):
                    depth -= 1
                    end += len(block_comment['end'])
                else:
                    end += 1
            if cursor <= cursor_offset <= end:
                cursor_in_comment = True
            cursor = end
            continue

        string_definition = _find_string_definition(text, cursor, profile)
        if string_definition:
            end = _consume_string(text, cursor, string_definition)
            tokens.append(Token('<STR>', '<STR>', 'string', cursor, end))
            cursor = end
            continue

        if (
            text[cursor] == '/'
            and profile['id'] in {'javascript', 'typescript'}
            and (not tokens or tokens[-1].value in REGEX_PREFIX_TOKENS)
        ):
            end = _consume_javascript_regex(text, cursor)
            if end:
                tokens.append(Token('<STR>', '<STR>', 'string', cursor, end))
                cursor = end
                continue

        character = text[cursor]
        if character.isspace():
            cursor += 1
            continue

        if character.isascii() and (character.isalpha() or character in '_$'):
            start = cursor
            cursor += 1
            while (
                cursor < len(text)
                and text[cursor].isascii()
                and (text[cursor].isalnum() or text[cursor] in '_$')
            ):
                cursor += 1
            value = text[start:cursor]
            keyword = value in keywords
            tokens.append(
                Token(
                    value,
                    value if keyword else '<ID>',
                    'keyword' if keyword else 'identifier',
                    start,
                    cursor,
                )
            )
            continue

        if character.isascii() and character.isdigit():
            start = cursor
            cursor += 1
            while (
                cursor < len(text)
                and text[cursor] in '0123456789ABCDEFabcdef_xXobOB.n'
            ):
                cursor += 1
            tokens.append(Token('<NUM>', '<NUM>', 'number', start, cursor))
            continue

        if character in OPERATOR_CHARS:
            start = cursor
            cursor += 1
            while cursor < len(text) and text[cursor] in OPERATOR_CHARS:
                cursor += 1
            value = text[start:cursor]
            tokens.append(Token(value, value, 'operator', start, cursor))
            continue

        if character in PUNCTUATION:
            tokens.append(Token(character, character, 'punctuation', cursor, cursor + 1))
        cursor += 1

    return {
        'tokens': tokens,
        'cursor_in_comment': cursor_in_comment,
        'cursor_in_supported_region': True,
        'profile_id': profile['id'],
    }


def _scan_vue_script_regions(text, cursor_offset=None):
    import re

    cursor_offset = len(text) if cursor_offset is None else cursor_offset
    tokens = []
    cursor_in_comment = False
    cursor_in_supported_region = False
    opening_pattern = re.compile(r'<script\b[^>]*>', re.IGNORECASE)
    search_offset = 0
    while True:
        opening = opening_pattern.search(text, search_offset)
        if not opening:
            break
        content_start = opening.end()
        closing_start = text.lower().find('</script>', content_start)
        content_end = len(text) if closing_start < 0 else closing_start
        language = (
            'typescript'
            if re.search(r'\blang\s*=\s*["\']ts["\']', opening.group(0), re.IGNORECASE)
            else 'javascript'
        )
        relative_cursor = max(0, min(cursor_offset - content_start, content_end - content_start))
        result = scan_text(
            text[content_start:content_end],
            language,
            relative_cursor,
        )
        tokens.extend(
            Token(
                token.value,
                token.normalized,
                token.kind,
                token.start + content_start,
                token.end + content_start,
            )
            for token in result['tokens']
        )
        if content_start <= cursor_offset <= content_end:
            cursor_in_supported_region = True
            cursor_in_comment = result['cursor_in_comment']
        search_offset = (
            len(text)
            if closing_start < 0
            else closing_start + len('</script>')
        )
    return {
        'tokens': tokens,
        'cursor_in_comment': cursor_in_comment,
        'cursor_in_supported_region': cursor_in_supported_region,
        'profile_id': 'typescript',
    }


def tokenize(text, language_id_or_extension=None):
    return [token.value for token in scan_text(text, language_id_or_extension)['tokens']]


def tokenize_normalized(text, language_id_or_extension=None):
    return [
        token.normalized
        for token in scan_text(text, language_id_or_extension)['tokens']
    ]
