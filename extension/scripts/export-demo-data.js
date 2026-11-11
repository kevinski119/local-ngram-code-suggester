// Public, original example only. Export the real v3.1 project engine's output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectContextModel } = require('../out/projectContextModel');
const { AcceptanceMemory } = require('../out/acceptanceMemory');

const sample = 'client.send_request( payload ).await?;\nclient.reset();';
const model = new ProjectContextModel(6);
model.addDocument({fileName: 'public-demo.rs', languageId: 'rust',
    uri: {toString: () => 'demo:public-rust-example'}, getText: () => sample}, 'public-demo');
const choices = model.generateSequenceSuggestions(['client', '.'], '', ['.rs'], 'public-demo', 12, () => false);
assert.equal(choices[0].token, 'send_request( payload ).await?;');
const preferences = new AcceptanceMemory();
preferences.record('public-context', 'reset();');
assert.equal(preferences.rank('public-context', choices)[0].token, 'reset();');

const data = {version: '3.1', language: 'Rust', prefix: 'client.',
    source: sample.split('\n')[0], completion: choices[0].token,
    maxTokens: 12, mediaType: 'Illustrated demo, not a screen recording',
    verification: 'ProjectContextModel.generateSequenceSuggestions and AcceptanceMemory.rank assertions passed.'};
const output = path.resolve(__dirname, '../assets/marketplace/demo-data-v31.json');
fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(`Verified demo data written to ${output}`);
