// Run after npm run compile. Optional argument: an older release's out directory.
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const path = require('node:path');
const { scanText } = require('../extension/out/lexicalScanner');
const { PrefixScanCache } = require('../extension/out/prefixScanCache');
const baseline = process.argv[2] ? require(path.resolve(process.argv[2], 'lexicalScanner.js')).scanText : null;
function measure(run, count = 60) {
    for (let i = 0; i < 12; i++) run();
    const samples = [];
    for (let i = 0; i < count; i++) {
        const start = performance.now(); run(); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[Math.floor(count / 2)], p95Ms: samples[Math.ceil(count * 0.95) - 1] };
}
const results = { note: 'Synthetic scanner microbenchmark; not end-to-end editor latency.', languages: {} };
for (const [language, line] of [
    ['typescript', 'const result = service.load(value); // comment\n'],
    ['rust', 'let result = client.send_request(payload).await?; // comment\n']
]) {
    const text = line.repeat(800);
    if (baseline) assert.deepEqual(scanText(text, language), baseline(text, language));
    const cache = new PrefixScanCache();
    cache.get('test', 1, language, text.length, () => text);
    results.languages[language] = {
        characters: text.length,
        ...(baseline ? { v3_0: measure(() => baseline(text, language)) } : {}),
        v3_1: measure(() => scanText(text, language)),
        cached: measure(() => cache.get('test', 1, language, text.length, () => text), 1000)
    };
}
console.log(JSON.stringify(results, null, 2));
