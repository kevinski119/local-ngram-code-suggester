// Compare quality per case; timing varies by hardware and is not a CI gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const actual = JSON.parse(fs.readFileSync(process.env.NGRAM_BENCH_OUTPUT || path.join(__dirname, 'project-latest.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'project-v31.json'), 'utf8'));
assert.equal(actual.schemaVersion, baseline.schemaVersion);
assert.equal(actual.fixtureSha256, baseline.fixtureSha256, 'Fixture changed: review and deliberately refresh the baseline.');
assert.equal(actual.modelSha256, baseline.modelSha256, 'Model changed: report a separate model comparison and refresh the baseline.');
assert.deepEqual(actual.methodology.settings, baseline.methodology.settings, 'Settings must match for a controlled comparison.');
assert.equal(actual.variants.length, baseline.variants.length);
let checked = 0;
for (const prior of baseline.variants) {
    const current = actual.variants.find(item => item.mode === prior.mode && item.maxTokens === prior.maxTokens);
    assert.ok(current, `Missing variant: ${prior.mode}/${prior.maxTokens}`);
    assert.equal(current.cases.length, prior.cases.length);
    for (const old of prior.cases) {
        const row = current.cases.find(item => item.id === old.id);
        const label = `${prior.mode}/${prior.maxTokens}/${old.id}`;
        assert.ok(row, `Missing case: ${label}`);
        assert.equal(row.expected, old.expected, `${label}: expected target changed`);
        if (old.controlPassed !== null) assert.equal(row.controlPassed, true, `${label}: safety control`);
        for (const metric of ['top1Token', 'top3Token', 'top1ExactTokens', 'top3ExactTokens', 'top1ExactText']) {
            if (old[metric]) assert.equal(row[metric], true, `${label}: regressed ${metric}`);
        }
        assert.ok(row.correctPrefixTokens >= old.correctPrefixTokens, `${label}: less correct leading text`);
        if (!old.covered) assert.ok(!row.covered || row.top1Token, `${label}: new incorrect suggestion replaced abstention`);
        checked++;
    }
}
console.log(`Project benchmark regression check passed: ${checked} case/configuration pairs.`);
