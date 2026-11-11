// Deterministic synthetic coverage: 10 domains x 10 editing scenarios x 5 languages.
// Variants share templates; these are not 500 independent real-world programs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const domains = [
    ['inventory', 'reserveStockBatch', 'stock', 'warehouse'],
    ['mailer', 'dispatchEnvelopeBatch', 'envelope', 'recipient'],
    ['renderer', 'renderSceneFrame', 'scene', 'viewport'],
    ['ledger', 'appendLedgerEntry', 'entry', 'account'],
    ['scheduler', 'enqueueScheduledJob', 'job', 'priority'],
    ['catalog', 'indexCatalogRecord', 'record', 'category'],
    ['storage', 'persistSnapshotBlock', 'block', 'checkpoint'],
    ['telemetry', 'collectTelemetrySample', 'sample', 'timestamp'],
    ['router', 'resolveRouteBinding', 'binding', 'endpoint'],
    ['pipeline', 'transformInputBatch', 'input', 'options']
];
const languages = ['rust', 'typescript', 'python', 'java', 'csharp'];
function generate() {
    const cases = [];
    for (const language of languages) {
        const name = word => ['rust', 'python'].includes(language)
            ? word.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())
            : language === 'csharp' ? word[0].toUpperCase() + word.slice(1) : word;
        const end = language === 'python' ? '' : ';';
        for (const [index, [receiver, rawMethod, argument, second]] of domains.entries()) {
            const method = name(rawMethod);
            const otherMethod = name('clearPendingBatch');
            const chainMethod = name('withAuditContext');
            const call = `${method}(${argument})${end}`;
            const full = `${receiver}.${call}`;
            const add = (scenario, values) => cases.push({ id: `${language}-${scenario}-${receiver}`,
                language, scenario, ...values });
            add('repeat', { group: 'repeated', support: full + '\n', prefix: receiver + '.', expected: call });
            const spaced = `${method}( ${argument}, ${second} )${end}`;
            add('spacing', { group: 'repeated', support: `${receiver}.${spaced}\n`, prefix: receiver + '.', expected: spaced });
            const chain = `${method}(${argument}).${chainMethod}(${second})${end}`;
            add('chain', { group: 'repeated', support: `${receiver}.${chain}\n`, prefix: receiver + '.', expected: chain });
            const prefixLength = Math.floor(method.length / 2);
            add('prefix', { group: 'identifier_prefix', support: full + '\n', prefix: `${receiver}.${method.slice(0, prefixLength)}`,
                expected: call.slice(prefixLength) });
            add('new-argument', { group: 'new_arguments', support: `${receiver}.${method}(old_${argument})${end}\n`,
                prefix: receiver + '.', expected: `${method}(new_${argument})${end}` });
            const alternate = `${otherMethod}()${end}`;
            add('ambiguous', { group: 'ambiguous', support: full + '\n' + `${receiver}.${alternate}\n`,
                prefix: receiver + '.', expected: index % 2 === 0 ? call : alternate });
            add('unseen', { group: 'unseen', support: full + '\n', prefix: receiver + '.',
                expected: `${name('validatePendingState')}(${second})${end}` });
            add('receiver', { group: 'receiver_disambiguation', support: `${receiver}.${call}\nother.${otherMethod}(${second})${end}\n`.repeat(2),
                prefix: receiver + '.', expected: call });
            add('isolation', { group: 'isolation', support: `unrelated.${otherMethod}()${end}\n`,
                foreignSupport: full + '\n', prefix: receiver + '.', expected: call, forbiddenToken: method });
            const comment = language === 'python' ? '# ' : '// ';
            const string = language === 'python' ? 'note = "' : language === 'rust' ? 'let note = r#"'
                : language === 'csharp' ? 'var note = @"' : language === 'java' ? 'String note = "' : 'const note = `';
            add('suppression', { group: 'suppression', support: full + '\n',
                prefix: (index % 2 === 0 ? comment : string) + receiver + '.', expected: '', expectEmpty: true });
        }
    }
    assert.equal(cases.length, 500);
    assert.equal(new Set(cases.map(item => item.id)).size, 500);
    for (const language of languages) assert.equal(cases.filter(item => item.language === language).length, 100);
    return { schemaVersion: 1, description: '500 deterministic synthetic cases: 100 per language. Ten scenario families with ten domain variations each; 80 quality cases and 20 safety controls per language. Related template variants are not independent repository samples.', cases };
}
if (require.main === module) {
    const destination = path.join(__dirname, 'project-500-fixtures.json');
    fs.writeFileSync(destination, JSON.stringify(generate(), null, 2) + '\n');
    console.log(`Wrote 500 cases to ${destination}`);
}
module.exports = { generate, languages };
