import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openEditorState } from '../src/state.mjs';

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-editor-current-state-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repositoryRoot = path.join(directory, 'project');
  const options = { repositoryRoot, atlasRoot: path.join(repositoryRoot, 'atlas'), atlasPath: 'atlas',
    stateDirectory: path.join(directory, 'state') };
  return { options, state: openEditorState(options) };
}
const input = text => ({ kind: 'document', path: 'atlas.md', text, baseViewDigest: 'a'.repeat(64) });
const update = (draft, text) => ({ ...input(text), draftId: draft.draftId, expectedRevision: draft.revision });

function fault(t, method, replacement) {
  const original = fs[method];
  fs[method] = (...args) => replacement(original, ...args);
  const restore = () => { fs[method] = original; };
  t.after(restore);
  return restore;
}

test('repeated saves retain one exact current record and discard removes only the selected content', t => {
  const { options, state } = fixture(t);
  let current = state.saveDraft(input('Original unfinished text.'));
  const other = state.saveDraft(input('Independent unsaved draft.'));
  for (let count = 0; count < 125; count++) current = state.saveDraft(update(current, `Current ${count}: π 🧭\r\n\0\t`));
  const names = [`${current.draftId}.json`, `${other.draftId}.json`].sort();
  assert.deepEqual(fs.readdirSync(path.join(state.stateDirectory, 'drafts')).sort(), names);
  assert.equal(current.sequence, 126);
  assert.deepEqual(openEditorState(options).drafts().drafts.sort((a, b) => a.draftId.localeCompare(b.draftId)), [current, other].sort((a, b) => a.draftId.localeCompare(b.draftId)));
  const bytes = fs.readFileSync(path.join(state.stateDirectory, 'drafts', `${current.draftId}.json`), 'utf8');
  assert.ok(!bytes.includes('Original unfinished text.'));
  assert.equal(JSON.parse(bytes).text, current.text);
  assert.deepEqual(state.discardDraft({ draftId: current.draftId, expectedRevision: current.revision }), { discarded: true, draftId: current.draftId });
  assert.deepEqual(fs.readdirSync(path.join(state.stateDirectory, 'drafts')), [`${other.draftId}.json`]);
  assert.deepEqual(state.drafts().drafts, [other]);
});

test('exact revisions refuse stale updates and discard across independently opened state handles', t => {
  const { options, state } = fixture(t), second = openEditorState(options);
  const original = state.saveDraft(input('First text.'));
  const current = second.saveDraft(update(original, 'Second text.'));
  assert.throws(() => state.saveDraft(update(original, 'Stale text.')), { code: 'atlas.editor.stale-draft' });
  assert.throws(() => state.discardDraft({ draftId: original.draftId, expectedRevision: original.revision }), { code: 'atlas.editor.stale-draft' });
  assert.deepEqual(state.drafts().drafts, [current]);
  second.discardDraft({ draftId: current.draftId, expectedRevision: current.revision });
  assert.throws(() => state.saveDraft(update(current, 'Resurrection.')), { code: 'atlas.editor.stale-draft' });
});

test('unsupported revisions, missing current fields, renamed ids, and invalid baselines stay untouched as issues', t => {
  const { options, state } = fixture(t), current = state.saveDraft(input('Recoverable current text.'));
  const variants = [
    value => ({ ...value, contract: 'atlas.editor-draft/1', discarded: false }),
    ({ kind, ...value }) => value,
    value => ({ ...value, baseViewDigest: 'not-a-digest' }),
    value => ({ ...value, discarded: false }),
    value => ({ ...value, kind: null }),
    value => ({ ...value, text: 'x'.repeat(1024 * 1024 + 1) }),
    value => ({ ...value, draftId: randomUUID() }),
  ];
  const paths = [];
  for (const change of variants) {
    const draftId = randomUUID(), file = path.join(state.stateDirectory, 'drafts', `${draftId}.json`);
    const { revision, ...record } = current;
    const bytes = Buffer.from(JSON.stringify(change({ ...record, draftId })));
    fs.writeFileSync(file, bytes); paths.push({ file, bytes });
  }
  const recovered = openEditorState(options).drafts();
  assert.deepEqual(recovered.drafts, [current]);
  assert.equal(recovered.issues.length, variants.length);
  assert.ok(recovered.issues.every(issue => /Unsupported or invalid current draft/u.test(issue.message)));
  for (const { file, bytes } of paths) assert.deepEqual(fs.readFileSync(file), bytes);
});

test('an interrupted or concurrent writer blocks mutations while current text and pending content remain inspectable', t => {
  const { options, state } = fixture(t), current = state.saveDraft(input('Acknowledged text.'));
  const lock = path.join(state.stateDirectory, 'drafts', '.write-lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'pending.json'), 'Interrupted unsaved content.');
  const restarted = openEditorState(options);
  const recovered = restarted.drafts();
  assert.deepEqual(recovered.drafts, [current]);
  assert.equal(recovered.issues[0].file, '.write-lock');
  assert.throws(() => restarted.saveDraft(update(current, 'Do not overwrite.')), { code: 'atlas.editor.draft-busy' });
  assert.throws(() => restarted.discardDraft({ draftId: current.draftId, expectedRevision: current.revision }), { code: 'atlas.editor.draft-busy' });
  assert.equal(fs.readFileSync(path.join(lock, 'pending.json'), 'utf8'), 'Interrupted unsaved content.');
});

test('failed atomic replacement preserves the acknowledged draft without claiming a save', t => {
  const { state } = fixture(t), current = state.saveDraft(input('Acknowledged text.'));
  fault(t, 'renameSync', (original, from, to) => {
    if (to === path.join(state.stateDirectory, 'drafts', `${current.draftId}.json`)) throw new Error('Controlled replacement failure.');
    return original(from, to);
  });
  assert.throws(() => state.saveDraft(update(current, 'Unacknowledged text.')), /Controlled replacement failure/u);
  assert.deepEqual(state.drafts().drafts, [current]);
  assert.deepEqual(fs.readdirSync(path.join(state.stateDirectory, 'drafts')), [`${current.draftId}.json`]);
});

test('a flush failure after replacement has no save acknowledgement and leaves the new current text recoverable', t => {
  const { options, state } = fixture(t), current = state.saveDraft(input('First acknowledged text.'));
  let replaced = false;
  fault(t, 'renameSync', (original, from, to) => { const result = original(from, to); replaced = true; return result; });
  const restore = fault(t, 'fsyncSync', (original, fd) => {
    if (replaced) throw new Error('Controlled directory flush failure.');
    return original(fd);
  });
  assert.throws(() => state.saveDraft(update(current, 'Exact unacknowledged replacement: π.')), /Controlled directory flush failure/u);
  restore();
  const recovered = openEditorState(options).drafts();
  assert.equal(recovered.drafts[0].text, 'Exact unacknowledged replacement: π.');
  assert.notEqual(recovered.drafts[0].revision, current.revision);
  assert.throws(() => state.saveDraft(update(current, 'Stale retry.')), { code: 'atlas.editor.stale-draft' });
});

test('JSON escaping does not make acknowledged maximum-size text unreadable', t => {
  const { options, state } = fixture(t);
  const text = '\0'.repeat(1024 * 1024);
  const current = state.saveDraft(input(text));
  assert.ok(fs.statSync(path.join(state.stateDirectory, 'drafts', `${current.draftId}.json`)).size > 6 * 1024 * 1024);
  assert.equal(openEditorState(options).drafts().drafts[0].text, text);
});


test('failed discard retains current content and does not acknowledge removal', t => {
  const { state } = fixture(t), current = state.saveDraft(input('Retain this exact unfinished draft.'));
  const selected = path.join(state.stateDirectory, 'drafts', `${current.draftId}.json`);
  fault(t, 'unlinkSync', (original, file) => {
    if (file === selected) throw new Error('Controlled discard failure.');
    return original(file);
  });
  assert.throws(() => state.discardDraft({ draftId: current.draftId, expectedRevision: current.revision }), /Controlled discard failure/u);
  assert.deepEqual(state.drafts().drafts, [current]);
});
