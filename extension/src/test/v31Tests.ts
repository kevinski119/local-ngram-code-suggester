import * as assert from 'node:assert/strict';
import { AcceptanceMemory } from '../acceptanceMemory';
import { PrefixScanCache } from '../prefixScanCache';
import { ProjectSequences } from '../projectSequences';
import { scanText } from '../lexicalScanner';

function sequences(text: string) { return new ProjectSequences(text, scanText(text, 'rust').tokens); }
const never = () => false;

export const v31Tests = [
    { name: 'retrieves actual project sequences with original internal spacing', run: () => {
        const matches = sequences('client.send_request( payload ).await?;').find(['client', '.'], '', 12, never);
        assert.equal(matches[0].text, 'send_request( payload ).await?;');
        assert.equal(matches[0].tokenCount, 8);
    } },
    { name: 'sequence retrieval matches exact receivers and prefix', run: () => {
        const index = sequences('client.send_request(payload);\nother.clear();');
        assert.deepEqual(index.find(['unknown', '.'], '', 12, never), []);
        assert.equal(index.find(['client', '.'], 'send_', 12, never)[0].text, 'send_request(payload);');
        assert.deepEqual(index.find(['client', '.'], 'clear', 12, never), []);
    } },
    { name: 'sequence retrieval cannot bridge lines or comments', run: () => {
        assert.deepEqual(sequences('client.\nclear();').find(['client', '.'], '', 12, never), []);
        assert.deepEqual(sequences('client. /* note */ clear();').find(['client', '.'], '', 12, never), []);
        assert.deepEqual(sequences('client /* note */ .clear();').find(['client', '.'], '', 12, never), []);
    } },
    { name: 'sequence retrieval excludes literals and stops at statement boundaries', run: () => {
        const matches = sequences('client.send("secret"); client.clear(); unrelated();').find(['client', '.'], '', 12, never);
        assert.ok(matches.every(match => !match.text.includes('secret') && !match.text.includes('unrelated')));
        assert.ok(matches.some(match => match.text === 'clear();'));
    } },
    { name: 'retrieval honors cancellation token and length limits', run: () => {
        const index = sequences('client.send_request(payload).await?;');
        assert.deepEqual(index.find(['client', '.'], '', 12, () => true), []);
        assert.equal(index.find(['client', '.'], '', 1, never)[0].text, 'send_request');
        assert.equal(index.find(['client', '.'], '', 5, never)[0].text, 'send_request(payload)');
    } },
    { name: 'sequence lookup bounds repetitive-file results', run: () => {
        const index = sequences('client.flush();\n'.repeat(500));
        assert.equal(index.find(['client', '.'], '', 12, never).length, 128);
    } },
    { name: 'session preferences promote accepted choices only in their context', run: () => {
        const memory = new AcceptanceMemory();
        const choices = [{token: 'first'}, {token: 'second'}];
        memory.record('project-a/context', 'second');
        assert.equal(memory.rank('project-a/context', choices)[0].token, 'second');
        assert.equal(memory.rank('project-b/context', choices)[0].token, 'first');
        assert.equal(choices[0].token, 'first');
        assert.equal(memory.accepted, 1);
    } },
    { name: 'acceptance preferences are bounded and resettable', run: () => {
        const memory = new AcceptanceMemory(2);
        for (const key of ['one', 'two', 'three']) memory.record(key, 'second');
        assert.equal(memory.size, 2);
        assert.equal(memory.rank('one', [{token: 'first'}, {token: 'second'}])[0].token, 'first');
        memory.clear();
        assert.equal(memory.size, 0);
        assert.equal(memory.accepted, 0);
    } },
    { name: 'acceptance storage rejects oversized or empty inputs', run: () => {
        const memory = new AcceptanceMemory();
        memory.record('', 'text');
        memory.record('x'.repeat(2049), 'text');
        memory.record('key', 'x'.repeat(513));
        assert.equal(memory.accepted, 0);
    } },
    { name: 'prefix scan cache reuses work without rereading a document', run: () => {
        const cache = new PrefixScanCache();
        const first = cache.get('one', 1, 'rust', 3, () => 'let');
        const second = cache.get('one', 1, 'rust', 3, () => { throw new Error('unexpected read'); });
        assert.equal(first, second);
        assert.equal(cache.hits, 1);
        assert.equal(cache.misses, 1);
    } },
    { name: 'prefix scans invalidate on version language and cursor changes', run: () => {
        const cache = new PrefixScanCache();
        cache.get('one', 1, 'rust', 3, () => 'let');
        const comment = cache.get('one', 2, 'rust', 3, () => '//x');
        assert.equal(comment.scan.cursorInComment, true);
        cache.get('one', 2, 'python', 3, () => '# x');
        cache.get('one', 2, 'python', 1, () => '#');
        assert.equal(cache.misses, 4);
        assert.equal(cache.hits, 0);
        cache.remove('one');
        assert.equal(cache.size, 0);
    } },
    { name: 'prefix cache evicts by size and document count', run: () => {
        const cache = new PrefixScanCache(6, 2);
        cache.get('one', 1, 'rust', 3, () => 'let');
        cache.get('two', 1, 'rust', 3, () => 'let');
        cache.get('three', 1, 'rust', 3, () => 'let');
        assert.equal(cache.size, 2);
        cache.get('long', 1, 'rust', 7, () => 'let foo');
        assert.equal(cache.size, 2, 'oversized results should not be retained');
        cache.clear();
        assert.equal(cache.size, 0);
    } }
];
