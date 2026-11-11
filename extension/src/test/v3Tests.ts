import * as assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { ProjectContextModel } from '../projectContextModel';
import { completionEdit } from '../completionEdit';
import { scanText } from '../lexicalScanner';
import { formatTokenSequence } from '../ngramEngine';
import { detectExternalLibraries } from '../crossProjectLearningModel';

function document(text: string, key = 'one', language = 'rust'): vscode.TextDocument {
    return {
        fileName: `${key}.${language === 'rust' ? 'rs' : 'ts'}`,
        languageId: language, uri: { toString: () => key }, getText: () => text
    } as vscode.TextDocument;
}

export const v3Tests = [
    { name: 'project prefixes learn real identifiers and stay in their workspace', run: () => {
        const model = new ProjectContextModel(6);
        model.addDocument(document('let local_counter = 1; local_counter += 1;'), 'a');
        assert.equal(model.generatePrefixSuggestions('local_', ['.rs'], 'a')[0].token, 'local_counter');
        assert.deepEqual(model.generatePrefixSuggestions('local_', ['.rs'], 'b'), []);
        assert.deepEqual(model.generatePrefixSuggestions('local_', ['.ts'], 'a'), []);
        model.removeDocument(document('', 'one'));
        assert.deepEqual(model.generatePrefixSuggestions('local_', ['.rs'], 'a'), []);
    } },
    { name: 'project sequences are isolated and removed with their source document', run: () => {
        const model = new ProjectContextModel(6);
        const doc = document('client.send_request( payload );');
        model.addDocument(doc, 'a');
        assert.equal(model.generateSequenceSuggestions(['client', '.'], '', ['.rs'], 'a', 12, () => false)[0].token,
            'send_request( payload );');
        assert.deepEqual(model.generateSequenceSuggestions(['client', '.'], '', ['.rs'], 'b', 12, () => false), []);
        assert.deepEqual(model.generateSequenceSuggestions(['client', '.'], '', ['.ts'], 'a', 12, () => false), []);
        model.removeDocument(doc);
        assert.deepEqual(model.generateSequenceSuggestions(['client', '.'], '', ['.rs'], 'a', 12, () => false), []);
    } },
    { name: 'exact project contexts distinguish receiver member names', run: () => {
        const model = new ProjectContextModel(6);
        model.addDocument(document('screen.height(); player.health(); player.health();'), 'a');
        const suggestions = model.generateProjectSuggestions(['<ID>', '.'], ['.rs'], 5, 0.01, 'a', ['screen', '.']);
        assert.equal(suggestions[0].token, 'height');
        assert.equal(suggestions[0].source, 'project');
    } },
    { name: 'updates remove stale project names including oversized documents', run: () => {
        const model = new ProjectContextModel(6);
        model.addDocument(document('let old_name = 1;'), 'a');
        model.updateDocument(document('let new_name = 1;'), 'a');
        assert.deepEqual(model.generatePrefixSuggestions('old_', ['.rs'], 'a'), []);
        assert.equal(model.generatePrefixSuggestions('new_', ['.rs'], 'a').length, 1);
        model.updateDocument(document('x'.repeat(100_001)), 'a');
        assert.equal(model.getProjectStats().files, 0);
        assert.deepEqual(model.generatePrefixSuggestions('new_', ['.rs'], 'a'), []);
    } },
    { name: 'project vocabulary handles JavaScript prototype property identifiers', run: () => {
        const model = new ProjectContextModel(3);
        const doc = document('thing.__proto__; thing.constructor; thing.toString;', 'one', 'typescript');
        model.addDocument(doc);
        assert.equal(model.generatePrefixSuggestions('__pr', ['.ts'])[0].token, '__proto__');
        model.removeDocument(doc);
        assert.deepEqual(model.generatePrefixSuggestions('__pr', ['.ts']), []);
    } },
    { name: 'project file count is bounded and clearing removes all learning', run: () => {
        const model = new ProjectContextModel(3);
        for (let i = 0; i < 130; i++) model.addDocument(document(`let value_${i} = 1;`, String(i)));
        assert.equal(model.getProjectStats().files, 128);
        assert.deepEqual(model.generatePrefixSuggestions('value_0', ['.rs']), []);
        model.clear();
        assert.equal(model.getProjectStats().files, 0);
        assert.deepEqual(model.generatePrefixSuggestions('value_', ['.rs']), []);
    } },
    { name: 'completion edits preserve prefixes and reuse matching right-hand text', run: () => {
        assert.deepEqual(completionEdit('counter', 'cou', ''), { text: 'counter', before: 3, after: 0 });
        assert.deepEqual(completionEdit('counter', 'cou', 'ter'), { text: 'counter', before: 3, after: 3 });
        assert.deepEqual(completionEdit('value)', '', ')'), { text: 'value)', before: 0, after: 1 });
        assert.deepEqual(completionEdit('counter);', 'cou', 'ter);'), { text: 'counter);', before: 3, after: 5 });
        assert.equal(completionEdit('counter', 'cou', 'nter'), undefined);
        assert.equal(completionEdit('counter', 'cou', 'different'), undefined);
        assert.equal(completionEdit('value', '', 'other'), undefined);
        assert.equal(completionEdit('', '', ''), undefined);
    } },
    { name: 'Rust code is suppressed inside raw strings and nested comments', run: () => {
        assert.equal(scanText('let s = r##"hello //', 'rust').cursorInString, true);
        assert.equal(scanText('let s = r##"hello"##', 'rust').cursorInString, false);
        assert.equal(scanText('/* outer /* inner */ still outer', 'rust').cursorInComment, true);
        assert.equal(scanText("let ch = '\\n'; let s = b\"open", 'rust').cursorInString, true);
    } },
    { name: 'Rust formatting keeps paths macros and ranges intact', run: () => {
        assert.equal(formatTokenSequence(['Vec', '::', 'new', '(', ')'], t => t, 'rust'), 'Vec::new()');
        assert.equal(formatTokenSequence(['println', '!', '(', '""', ')', ';'], t => t, 'rust'), 'println!("");');
        assert.equal(formatTokenSequence(['0', '..=', '10'], t => t, 'rust'), '0..=10');
    } },
    { name: 'Rust dependency namespaces exclude standard and local imports', run: () => {
        assert.deepEqual(detectExternalLibraries('use std::io;\nuse crate::local;\nuse serde::Serialize;\npub use tokio::task;', 'rust'), ['serde', 'tokio']);
    } }
];
