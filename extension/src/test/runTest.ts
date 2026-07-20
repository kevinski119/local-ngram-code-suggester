import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
    calculateGlobalTokenFrequency,
    calculateSimilarity,
    serializeContext,
    tokenizeText
} from '../utils/utils';
import { scanText } from '../lexicalScanner';
import { CodeModel } from '../interfaces/codeModel';
import {
    formatTokenSequence,
    generateBackoffSuggestions,
    shouldSuppressAfterLineBoundary
} from '../ngramEngine';
import { computeModelChecksum, verifyModelChecksum } from '../modelIntegrity';
import tokenizerCases from './fixtures/tokenizer_cases.json';

type TestCase = {
    name: string;
    run: () => void;
};

const tests: TestCase[] = [
    {
        name: 'tokenizes identifiers, operators, punctuation, and strings',
        run: () => {
            assert.deepEqual(
                tokenizeText('const answer = call("hello", 42);'),
                ['const', 'answer', '=', 'call', '(', '<STR>', ',', '<NUM>', ')', ';']
            );
        }
    },
    {
        name: 'matches golden comment-safe tokenizer fixtures',
        run: () => {
            for (const fixture of tokenizerCases) {
                const result = scanText(fixture.text, fixture.language);
                assert.deepEqual(
                    result.tokens.map(token => token.value),
                    fixture.tokens,
                    fixture.name
                );
                assert.deepEqual(
                    result.tokens.map(token => token.normalized),
                    fixture.normalized,
                    fixture.name
                );
            }
        }
    },
    {
        name: 'detects cursor comments without confusing strings',
        run: () => {
            assert.equal(
                scanText('const value = 1; // comment', 'typescript').cursorInComment,
                true
            );
            assert.equal(
                scanText('const value = "// not comment";', 'typescript').cursorInComment,
                false
            );
        }
    },
    {
        name: 'produces identical observations with comments removed',
        run: () => {
            const commented = 'const value = 1; /* explanation */ return value; // done';
            const clean = 'const value = 1; return value;';
            assert.deepEqual(
                scanText(commented, 'typescript').tokens.map(token => token.value),
                scanText(clean, 'typescript').tokens.map(token => token.value)
            );
        }
    },
    {
        name: 'serializes model contexts like Python json.dumps',
        run: () => {
            assert.equal(serializeContext(['const', 'answer', '=']), '["const", "answer", "="]');
        }
    },
    {
        name: 'weights matching suffix context',
        run: () => {
            assert.equal(calculateSimilarity(['a', 'b', 'c'], ['x', 'b', 'c']), 2 / 3);
            assert.equal(calculateSimilarity([], []), 0);
        }
    },
    {
        name: 'aggregates token frequencies across contexts',
        run: () => {
            assert.deepEqual(
                calculateGlobalTokenFrequency({
                    first: { value: 2, ';': 1 },
                    second: { value: 3 }
                }),
                { value: 5, ';': 1 }
            );
        }
    },
    {
        name: 'blends variable-order exact backoff without scanning the model',
        run: () => {
            const model: CodeModel = {
                version: '3.0',
                format_version: 3,
                n: 3,
                min_order: 2,
                max_order: 3,
                normalized_contexts: true,
                file_extensions: ['.ts'],
                total_patterns: 20,
                orders: {
                    '.ts': {
                        '3': {
                            '["const", "<ID>"]': { '=': 8, ';': 2 }
                        },
                        '2': {
                            '["<ID>"]': { '=': 2, ';': 8 }
                        }
                    }
                }
            };
            const suggestions = generateBackoffSuggestions(
                model,
                ['const', 'answer'],
                ['const', '<ID>'],
                ['.ts']
            );
            assert.equal(suggestions[0].token, '=');
            assert.equal(suggestions[0].order, 3);
            assert.ok(suggestions[0].confidence > suggestions[1].confidence);
        }
    },
    {
        name: 'falls back to shorter context and formats multi-token output',
        run: () => {
            const model: CodeModel = {
                version: '3.0',
                format_version: 3,
                n: 3,
                min_order: 2,
                max_order: 3,
                normalized_contexts: true,
                file_extensions: ['.ts'],
                total_patterns: 1,
                orders: {
                    '.ts': {
                        '2': {
                            '["return"]': { '<ID>': 1 }
                        }
                    }
                }
            };
            const suggestions = generateBackoffSuggestions(
                model,
                ['return'],
                ['return'],
                ['.ts']
            );
            assert.equal(suggestions[0].token, '<ID>');
            assert.equal(
                formatTokenSequence(['return', 'value', ';'], token => token),
                'return value;'
            );
        }
    },
    {
        name: 'keeps legacy v2 single-order models compatible',
        run: () => {
            const legacy: CodeModel = {
                version: '2.3',
                n: 3,
                file_extensions: ['.py'],
                total_patterns: 1,
                ngrams: {
                    '.py': {
                        '["def", "greet"]': { '(': 1 }
                    }
                }
            };
            const suggestions = generateBackoffSuggestions(
                legacy,
                ['def', 'greet'],
                ['def', '<ID>'],
                ['.py']
            );
            assert.equal(suggestions[0].token, '(');
        }
    },
    {
        name: 'pauses suggestions after a statement boundary on the current line',
        run: () => {
            const boundaries = [':', ';', '{', '}'];
            assert.equal(
                shouldSuppressAfterLineBoundary('    if value.is_integer():', ':', boundaries),
                true
            );
            assert.equal(
                shouldSuppressAfterLineBoundary('    if value.is_integer():   ', ':', boundaries),
                true
            );
            assert.equal(
                shouldSuppressAfterLineBoundary('', ':', boundaries),
                false
            );
            assert.equal(
                shouldSuppressAfterLineBoundary('    return value', ':', boundaries),
                false
            );
        }
    },
    {
        name: 'keeps exact backoff lookup comfortably inside its unit budget',
        run: () => {
            const model: CodeModel = {
                version: '3.0',
                format_version: 3,
                n: 2,
                min_order: 2,
                max_order: 2,
                normalized_contexts: true,
                file_extensions: ['.py'],
                total_patterns: 1,
                orders: { '.py': { '2': { '["return"]': { value: 1 } } } }
            };
            const started = performance.now();
            for (let index = 0; index < 500; index++) {
                generateBackoffSuggestions(model, ['return'], ['return'], ['.py']);
            }
            assert.ok(performance.now() - started < 100);
        }
    },
    {
        name: 'tokenizes a typical changed region within the 5 ms target',
        run: () => {
            const region = Array.from(
                { length: 100 },
                (_, index) => `const value${index} = "text // ${index}"; // comment`
            ).join('\n');
            const started = performance.now();
            for (let index = 0; index < 20; index++) {
                scanText(region, 'typescript');
            }
            const average = (performance.now() - started) / 20;
            assert.ok(average < 5, `average tokenizer latency was ${average.toFixed(2)} ms`);
        }
    },
    {
        name: 'detects corrupt model payloads with the embedded checksum',
        run: () => {
            const model: Record<string, unknown> = {
                format_version: 3,
                version: '3.0',
                n: 2,
                orders: { '.ts': {} }
            };
            model.checksum_sha256 = computeModelChecksum(model);
            assert.equal(verifyModelChecksum(model), true);
            model.n = 3;
            assert.equal(verifyModelChecksum(model), false);
        }
    }
];

let failures = 0;
for (const test of tests) {
    try {
        test.run();
        console.log(`✓ ${test.name}`);
    } catch (error) {
        failures++;
        console.error(`✗ ${test.name}`);
        console.error(error);
    }
}

if (failures > 0) {
    process.exitCode = 1;
} else {
    console.log(`\n${tests.length} tests passed.`);
}
