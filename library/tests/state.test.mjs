import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { resolveState, checkStateLocation } from '../src/state.mjs';
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
  const plan = prepareInitialization(await openAtlas(root), { id: 'example', title: 'Example', styleId: 'concise-subjects' });
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
  const plan = prepareInitialization(await openAtlas(root), { id: 'example', title: 'Example', styleId: 'concise-subjects' });
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

test('ownership metadata that is not JSON is invalid ownership metadata, for every use of the state', async t => {
  const root = await fixture(t);
  const plan = prepareInitialization(await openAtlas(root), { id: 'example', title: 'Example', styleId: 'concise-subjects' });
  const draft = await saveDraft(root, { plan });
  const { directory } = await resolveState(root);
  // A byte that is not UTF-8 inside JSON that names this Atlas is no ownership metadata either: it is never read as a replacement character.
  const named = JSON.stringify({ format: 'atlas.state/1', root: await fs.realpath(root), note: '?' });
  const inside = Buffer.concat([Buffer.from(named.slice(0, named.indexOf('?'))), Buffer.from([0xff]), Buffer.from(named.slice(named.indexOf('?') + 1))]);
  for (const contents of ['{', '', Buffer.from([0xff, 0xfe]), inside, 'null']) {
    await fs.writeFile(path.join(directory, 'owner.json'), contents);
    const refusal = contents === 'null' ? 'Private state belongs to another Atlas or has invalid ownership metadata.' : 'Private state has invalid ownership metadata.';
    for (const use of [() => resolveState(root), () => resolveState(root, { create: true }), () => loadDraft(root, draft.id), () => saveDraft(root, { plan })]) {
      await assert.rejects(use(), { code: 'STATE_OWNER', message: refusal }, String(contents));
    }
  }
  assert.deepEqual((await fs.readdir(directory)).sort(), ['drafts', 'owner.json']);
});

test('checkStateLocation says, creating nothing, whether the private state of an Atlas can be used', async t => {
  const root = await fixture(t), elsewhere = await fixture(t);
  const previous = process.env.ATLAS_STATE_HOME;
  t.after(() => { process.env.ATLAS_STATE_HOME = previous; });
  const atHome = async (home, use) => { process.env.ATLAS_STATE_HOME = home; try { return await use(); } finally { process.env.ATLAS_STATE_HOME = previous; } };
  // No state yet: what resolveState gives, and nothing is made.
  const home = path.join(elsewhere, 'home');
  const absent = await atHome(home, () => checkStateLocation(root));
  assert.deepEqual(absent, { root: await fs.realpath(root), directory: path.join(home, 'atlases', path.basename(absent.directory)), exists: false, owner: null });
  await assert.rejects(fs.stat(home), { code: 'ENOENT' });
  // A folder there without owner.json is adopted by the first write when it is empty, and is refused when it holds files.
  await fs.mkdir(absent.directory, { recursive: true });
  assert.equal((await atHome(home, () => checkStateLocation(root))).exists, false);
  await assert.rejects(atHome(home, () => resolveState(root)), { code: 'STATE_OWNER', message: 'Private state is missing its ownership metadata.' });
  await fs.writeFile(path.join(absent.directory, 'stray.txt'), 'Unowned.');
  await assert.rejects(atHome(home, () => checkStateLocation(root)), { code: 'STATE_OWNER', message: 'Private state contains unowned files and cannot be adopted.' });
  await fs.rm(path.join(absent.directory, 'stray.txt'));
  const owned = await atHome(home, () => resolveState(root, { create: true }));
  assert.deepEqual(await atHome(home, () => checkStateLocation(root)), owned);
  for (const contents of ['{', Buffer.from([0xff]), JSON.stringify({ format: 'atlas.state/1', root: elsewhere })]) {
    await fs.writeFile(path.join(owned.directory, 'owner.json'), contents);
    await assert.rejects(atHome(home, () => checkStateLocation(root)), { code: 'STATE_OWNER' }, String(contents));
  }
  // A home that is not absolute, that runs through a regular file or a symbolic link, or that lies inside the Atlas.
  await assert.rejects(atHome('relative/home', () => checkStateLocation(root)), { code: 'INVALID_STATE_HOME' });
  const file = path.join(elsewhere, 'a-file');
  await fs.writeFile(file, 'Not a directory.');
  await fs.symlink(elsewhere, path.join(elsewhere, 'linked'));
  const unsafe = { code: 'UNSAFE_STATE', message: 'Private state requires regular directories without symbolic links.' };
  for (const refused of [file, path.join(file, 'home'), path.join(file, 'deeper/home'), path.join(elsewhere, 'linked/home')]) {
    for (const use of [() => checkStateLocation(root), () => resolveState(root), () => resolveState(root, { create: true })]) await assert.rejects(atHome(refused, use), unsafe, refused);
  }
  await assert.rejects(atHome(path.join(root, 'state'), () => checkStateLocation(root)), { code: 'UNSAFE_STATE', message: 'Private state must be outside the Atlas.' });
  assert.deepEqual(await fs.readdir(root), []);
  // A root that is not there is refused as reading it refuses.
  await assert.rejects(checkStateLocation(path.join(elsewhere, 'absent')), { code: 'ENOENT' });
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
