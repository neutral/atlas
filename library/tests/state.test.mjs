import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { resolveState } from '../src/state.mjs';
import { openAtlas, readSource } from '../src/model.mjs';
import { prepareInitialization, saveDraft, loadDraft } from '../src/authoring.mjs';

async function fixture(t) {
  const root = await tempDirectory('atlas-private-state-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('private state uses canonical root identity and leaves authored directories untouched', async t => {
  const root = await fixture(t);
  const initial = await resolveState(root);
  assert.equal(initial.exists, false);
  await assert.rejects(fs.stat(initial.directory), { code: 'ENOENT' });
  const plan = prepareInitialization(await openAtlas(root), { id: 'example', title: 'Example' });
  const draft = await saveDraft(root, { plan });
  const state = await resolveState(root);
  assert.equal(state.exists, true);
  assert.equal(state.owner.root, await fs.realpath(root));
  assert.equal((await resolveState(path.join(root, '.'))).directory, state.directory);
  assert.ok(state.directory.startsWith(process.env.ATLAS_STATE_HOME + path.sep));
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal((await loadDraft(root, draft.id)).revision, draft.revision);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(state.directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(state.directory, 'owner.json'))).mode & 0o777, 0o600);
  }
});

test('state ownership and symbolic links cannot redirect a selected Atlas', async t => {
  const root = await fixture(t), elsewhere = await fixture(t);
  const state = await resolveState(root, { create: true });
  const owner = path.join(state.directory, 'owner.json');
  await fs.writeFile(owner, JSON.stringify({ format: 'atlas.state/1', root: elsewhere }));
  await assert.rejects(resolveState(root), { code: 'STATE_OWNER' });
  await fs.writeFile(owner, JSON.stringify({ format: 'atlas.state/1', root }));
  await fs.symlink(elsewhere, path.join(state.directory, 'drafts'));
  const plan = prepareInitialization(await openAtlas(root), { id: 'example', title: 'Example' });
  await assert.rejects(saveDraft(root, { plan }), { code: 'UNSAFE_PATH' });
  assert.deepEqual(await fs.readdir(elsewhere), []);
});

test('broad source grants cannot read private state belonging to any Atlas', async t => {
  const root = await fixture(t), another = await fixture(t);
  const state = await resolveState(another, { create: true });
  const uri = path.relative(root, path.join(state.directory, 'owner.json')).split(path.sep).join('/');
  const result = await readSource({ root }, { uri }, { allowedRoots: [path.dirname(process.env.ATLAS_STATE_HOME)] });
  assert.equal(result.status, 'denied');
  assert.equal(result.code, 'SOURCE_RESERVED');
  assert.equal(result.content, undefined);
});

test('private state refuses case aliases inside the selected Atlas', async t => {
  const root = await fixture(t);
  const alias = path.join(path.dirname(root), path.basename(root).toUpperCase());
  let aliases;
  try { aliases = await fs.realpath(alias) === await fs.realpath(root); } catch { aliases = false; }
  if (!aliases) return t.skip('Filesystem uses distinct case-sensitive names.');
  const previous = process.env.ATLAS_STATE_HOME;
  try {
    process.env.ATLAS_STATE_HOME = path.join(alias, 'private-state');
    await assert.rejects(resolveState(root, { create: true }), { code: 'UNSAFE_STATE' });
    assert.deepEqual(await fs.readdir(root), []);
  } finally { process.env.ATLAS_STATE_HOME = previous; }
});

test('private state never adopts existing nonempty directories without ownership metadata', async t => {
  const root = await fixture(t);
  const { directory } = await resolveState(root);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'foreign-state.txt'), 'Unowned material.');
  await assert.rejects(resolveState(root, { create: true }), { code: 'STATE_OWNER' });
  assert.deepEqual(await fs.readdir(directory), ['foreign-state.txt']);
  assert.equal(await fs.readFile(path.join(directory, 'foreign-state.txt'), 'utf8'), 'Unowned material.');
});

test('private ownership files are rejected without blocking inspection', { timeout: 2000 }, async t => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO case.');
  const root = await fixture(t);
  const { directory } = await resolveState(root);
  await fs.mkdir(directory, { recursive: true });
  execFileSync('mkfifo', [path.join(directory, 'owner.json')]);
  await assert.rejects(resolveState(root), { code: 'INVALID_STATE' });
});
