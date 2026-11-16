import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { openAtlas, compareViews, readSource } from '../src/model.mjs';
import { resolveState } from '../src/state.mjs';
import { prepareFromCandidate, prepareChangeFromDisk, inspectChange, saveDraft, applyDraft, listTransactions, writeCandidate } from '../src/authoring.mjs';

/** Applying takes a saved draft and its exact revision: a plan is saved, then applied as a draft. */
async function applyPlan(root, plan, options = {}) {
  const draft = await saveDraft(root, { plan });
  return applyDraft(root, draft.id, { expectedRevision: draft.revision, ...options });
}

const repo = fileURLToPath(new URL('../../', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const record = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
function authored() {
  return new Map([
    ['atlas.json', json({ format: 'atlas/1.2', id: 'notes', title: 'Notes', trees: ['trees/product', 'trees/system'] })],
    ['style.md', '# Policy\n\nOne account for each perspective.\n'],
    ['trees/product/tree.json', json({ id: 'product', title: 'Product', scope: 'What writers can rely on.', base: 'purpose', children: [{ point: 'offline' }, { point: 'delivery' }] })],
    ['trees/product/points/purpose.md', record({ id: 'purpose' }, 'Writers keep their notes', 'Notes survive a restart.')],
    ['trees/product/points/offline.md', record({ id: 'offline' }, 'Writers can work offline', 'Edits are kept locally.')],
    ['trees/product/points/delivery.md', record({ id: 'delivery' }, 'Delivery is shown as pending', 'See [offline work](offline.md).')],
    ['trees/product/facets/storage.md', record({ id: 'storage', on: 'offline', via: 'system', targets: ['runtime'] }, 'Offline work rests on the runtime', 'The runtime decides what is kept.')],
    ['trees/system/tree.json', json({ id: 'system', title: 'System', scope: 'How it is built.', base: 'runtime', children: [] })],
    ['trees/system/points/runtime.md', record({ id: 'runtime' }, 'The runtime keeps a local store', 'One store for each device.')],
    ['.checks/removals.md', record({ id: 'removals', status: 'active', level: 'required' }, 'Account for removals', '## Requirement\n\nName what was removed.\n\n## Verification\n\nRead the reason.\n\n## Failure\n\nReturn the change.')],
  ]);
}
async function write(directory, files) {
  for (const [file, content] of files) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), content); }
}
async function fixture(t, files = authored()) {
  const directory = await tempDirectory('atlas-candidate-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'atlas'), candidate = path.join(directory, 'candidate');
  await fs.mkdir(root); await fs.mkdir(candidate);
  await write(root, files); await write(candidate, files);
  return { directory, root, candidate };
}

test('a candidate directory becomes the additions, replacements and removals that turn the Atlas into it', async t => {
  const { root, candidate } = await fixture(t);
  const before = await openAtlas(root);
  assert.equal(before.status, 'ready', JSON.stringify(before.diagnostics));
  const same = await prepareFromCandidate(root, candidate, { reason: 'Nothing differs yet.' });
  assert.deepEqual([same.status, same.changes, same.ignored], ['noop', [], []]);

  const tree = JSON.parse(authored().get('trees/product/tree.json'));
  tree.children = [{ point: 'offline', children: [{ point: 'recovery' }] }];
  await fs.writeFile(path.join(candidate, 'trees/product/tree.json'), json(tree));
  await fs.mkdir(path.join(candidate, 'trees/product/points/offline'));
  await fs.writeFile(path.join(candidate, 'trees/product/points/offline/recovery.md'), record({ id: 'recovery' }, 'A restart restores unsent edits', 'The local store is read on launch.'));
  await fs.rm(path.join(candidate, 'trees/product/points/delivery.md'));
  await fs.appendFile(path.join(candidate, 'trees/product/points/offline.md'), '\nUnsent edits survive a restart.\n');
  await fs.writeFile(path.join(candidate, 'trees/product/points/.atlas-write-0000'), 'An interrupted write, passed over as readers pass over it.');
  const plan = await prepareFromCandidate(root, candidate, { reason: 'Replace the delivery claim with recovery.' });
  assert.deepEqual(Object.keys(plan), ['format', 'status', 'reason', 'baseline', 'changes', 'validation', 'observedFiles', 'candidate', 'ignored']);
  assert.deepEqual([plan.format, plan.status, plan.reason, plan.observedFiles, plan.ignored], ['atlas.change/1', 'ready', 'Replace the delivery claim with recovery.', [], []]);
  assert.deepEqual(plan.baseline, { identity: before.identity, files: before.files.map(({ path: file, sha256 }) => ({ path: file, sha256 })) });
  assert.deepEqual(plan.changes.map(change => [change.path, change.before === null ? 'add' : change.after === null ? 'remove' : 'replace']), [
    ['trees/product/points/delivery.md', 'remove'], ['trees/product/points/offline.md', 'replace'],
    ['trees/product/points/offline/recovery.md', 'add'], ['trees/product/tree.json', 'replace'],
  ]);
  assert.equal(plan.changes[0].before, authored().get('trees/product/points/delivery.md'));
  const proposed = await openAtlas(candidate);
  assert.equal(plan.candidate.identity, proposed.identity);
  assert.equal(plan.candidate.root, root);
  assert.equal(plan.validation.identity, proposed.identity);
  // The same plan the explicit path prepares from the same file changes, and what the candidate held besides.
  const explicit = await prepareChangeFromDisk(root, { reason: plan.reason, changes: plan.changes.map(({ path: file, after }) => ({ path: file, content: after })) });
  assert.deepEqual({ ...explicit, ignored: [] }, plan);
  assert.equal(inspectChange(plan).before.identity, before.identity);
  assert.equal((await openAtlas(root)).identity, before.identity);
  const draft = await saveDraft(root, { plan });
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
  const after = await openAtlas(root);
  assert.equal(after.identity, proposed.identity);
  assert.deepEqual(compareViews(after, proposed), { same: true, before: after.identity, after: proposed.identity, added: [], removed: [], changed: [] });
  assert.equal((await prepareFromCandidate(root, candidate, { reason: 'Already applied.' })).status, 'noop');
});

test('a candidate is validated whole: an invalid one is a reviewable plan that cannot be applied', async t => {
  const { root, candidate } = await fixture(t);
  await fs.rm(path.join(candidate, 'trees/system/points/runtime.md'));
  await fs.rm(path.join(candidate, 'style.md'));
  const plan = await prepareFromCandidate(root, candidate, { reason: 'Remove the runtime account and the policy.' });
  assert.equal(plan.status, 'invalid');
  // What the candidate lacks, and that its change alters the Style together with another file.
  assert.deepEqual(plan.validation.diagnostics.map(({ code, path: file }) => [code, file]), [
    ['STYLE_CHANGE_ALONE', 'style.md'], ['STYLE_REQUIRED', 'style.md'], ['FACET_TARGET', 'trees/product/facets/storage.md'], ['POINT_MISSING', 'trees/system/tree.json'],
  ]);
  assert.deepEqual(plan.candidate.diagnostics.map(item => item.code), ['STYLE_REQUIRED', 'FACET_TARGET', 'POINT_MISSING']);
  assert.deepEqual(plan.changes.map(change => [change.path, change.after]), [['style.md', null], ['trees/system/points/runtime.md', null]]);
  const before = (await openAtlas(root)).identity;
  await assert.rejects(applyPlan(root, plan), { code: 'INVALID_CANDIDATE' });
  assert.equal((await openAtlas(root)).identity, before);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
});

test('Checks change through a candidate like any other record, and the Style changes through one alone', async t => {
  const { root, candidate } = await fixture(t);
  await fs.rm(path.join(candidate, '.checks/removals.md'));
  await fs.mkdir(path.join(candidate, '.checks/review'));
  await fs.writeFile(path.join(candidate, '.checks/review/whole-read.md'), record({ id: 'whole-read', status: 'draft', level: 'advisory' }, 'Read the account whole', '## Requirement\n\nRead from the top claim.\n\n## Verification\n\nName each contradiction.\n\n## Failure\n\nReturn the change.'));
  await fs.appendFile(path.join(candidate, 'style.md'), '\n## Conventions\n\nMark what no source states.\n');
  const before = await openAtlas(root);
  const mixed = await prepareFromCandidate(root, candidate, { reason: 'Revise the policy and the Checks.' });
  assert.deepEqual([mixed.status, mixed.validation.status, mixed.validation.diagnostics.map(({ code, path: file }) => [code, file])], ['invalid', 'invalid', [['STYLE_CHANGE_ALONE', 'style.md']]]);
  assert.deepEqual(mixed.changes.map(change => change.path), ['.checks/removals.md', '.checks/review/whole-read.md', 'style.md']);
  // The candidate is the valid Atlas the directory holds; the plan can be read, and cannot be applied.
  assert.deepEqual([mixed.candidate.status, mixed.candidate.identity], ['ready', (await openAtlas(candidate)).identity]);
  assert.equal(inspectChange(mixed).after.identity, mixed.candidate.identity);
  await assert.rejects(applyPlan(root, mixed), { code: 'INVALID_CANDIDATE' });
  assert.equal((await openAtlas(root)).identity, before.identity);

  // The Checks first, with the Style as the Atlas has it, then the Style by itself.
  const policy = await fs.readFile(path.join(candidate, 'style.md'), 'utf8');
  await fs.writeFile(path.join(candidate, 'style.md'), authored().get('style.md'));
  const checks = await prepareFromCandidate(root, candidate, { reason: 'Revise the Checks.' });
  assert.equal(checks.status, 'ready', JSON.stringify(checks.validation.diagnostics));
  assert.deepEqual(checks.changes.map(change => change.path), ['.checks/removals.md', '.checks/review/whole-read.md']);
  assert.equal((await applyPlan(root, checks)).status, 'complete');
  assert.deepEqual((await openAtlas(root)).atlas.checks.map(check => check.id), ['whole-read']);
  await fs.writeFile(path.join(candidate, 'style.md'), policy);
  const style = await prepareFromCandidate(root, candidate, { reason: 'Revise the policy.' });
  assert.deepEqual([style.status, style.validation.diagnostics, style.changes.map(change => change.path)], ['ready', [], ['style.md']]);
  assert.equal((await applyPlan(root, style)).status, 'complete');
  assert.equal((await openAtlas(root)).identity, (await openAtlas(candidate)).identity);
});

/** The same Atlas as written for atlas/1.1: a manifest that names its Style, a Style with a JSON header, a Facet with pointer objects. */
function earlier() {
  const files = authored();
  files.set('atlas.json', json({ format: 'atlas/1.1', id: 'notes', title: 'Notes', style: 'style.md', trees: ['trees/product', 'trees/system'] }));
  files.set('style.md', `---\n{"id":"custom","revision":"1"}\n---\n${authored().get('style.md')}`);
  files.set('trees/product/facets/storage.md', record({ id: 'storage', on: { point: 'offline' }, via: 'system', targets: [{ point: 'runtime' }] }, 'Offline work rests on the runtime', 'The runtime decides what is kept.'));
  return files;
}

test('a copy of an atlas/1.1 folder is brought to 1.2 in one candidate: the Style is repaired with the rest', async t => {
  const directory = await tempDirectory('atlas-candidate-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'atlas'), candidate = path.join(directory, 'migrated');
  await write(root, earlier()); await write(candidate, authored());
  const before = await openAtlas(root);
  assert.equal(before.status, 'invalid');
  const plan = await prepareFromCandidate(root, candidate, { reason: 'Bring the Atlas to atlas/1.2.' });
  assert.deepEqual([plan.status, plan.validation.diagnostics, plan.ignored], ['ready', [], []]);
  assert.deepEqual(plan.changes.map(change => change.path), ['atlas.json', 'style.md', 'trees/product/facets/storage.md']);
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  assert.equal((await openAtlas(root)).identity, (await openAtlas(candidate)).identity);
});

/** Every file under a directory, by relative path, with its bytes. */
async function listing(directory, skip = () => false) {
  const files = new Map();
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    const file = path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
    if (entry.isFile() && !skip(file)) files.set(file, await fs.readFile(path.join(directory, file)));
  }
  return new Map([...files].sort(([a], [b]) => a < b ? -1 : 1));
}

test('the candidate folder: a fresh copy of the records that prepares as noop, that readers never capture, and that prepares an edit', async t => {
  const { root } = await fixture(t);
  await write(root, new Map([['README.md', '# Notes\n'], ['sources/brief.md', '# Brief\n'], ['trees/product/notes.txt', 'Beside the Tree.\n']]));
  await write(path.join(root, '.atlas-candidate'), new Map([['left/over.md', 'From an earlier copy.\n'], ['atlas.json', '{}']]));
  const before = await openAtlas(root);
  assert.equal(before.status, 'ready', JSON.stringify(before.diagnostics));
  const outside = await listing(root, file => file.startsWith('.atlas-candidate/'));
  const written = await writeCandidate(root);
  assert.deepEqual(written, { path: path.join(root, '.atlas-candidate'), files: before.files.length, baseline: before.identity });
  // Exactly the records, as their bytes; what the folder held before is gone; nothing else was written in the Atlas.
  const copy = await listing(written.path);
  assert.deepEqual([...copy.keys()], before.files.map(file => file.path).sort());
  for (const [file, bytes] of copy) assert.ok(bytes.equals(await fs.readFile(path.join(root, file))), file);
  assert.deepEqual(await listing(root, file => file.startsWith('.atlas-candidate/')), outside);
  // Readers never capture the folder: the Atlas's identity is unchanged, and the copy prepares as nothing to do.
  assert.equal((await openAtlas(root)).identity, before.identity);
  const noop = await prepareFromCandidate(root, written.path, { reason: 'Nothing yet.' });
  assert.deepEqual([noop.status, noop.changes, noop.ignored], ['noop', [], []]);
  // An edit made in the copy with plain file writes is the change.
  const offline = path.join(written.path, 'trees/product/points/offline.md');
  await fs.writeFile(offline, (await fs.readFile(offline, 'utf8')).replace('Edits are kept locally.', 'Edits are kept locally until they are sent.'));
  const plan = await prepareFromCandidate(root, written.path, { reason: 'Say when local edits leave.' });
  assert.deepEqual([plan.status, plan.changes.map(change => change.path), plan.ignored], ['ready', ['trees/product/points/offline.md'], []]);
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  assert.equal((await openAtlas(root)).identity, (await openAtlas(written.path)).identity);
  // The folder itself is the one candidate inside the Atlas: a folder within it, or any other, is still refused.
  for (const target of [path.join(written.path, 'trees'), path.join(root, 'trees')]) await assert.rejects(prepareFromCandidate(root, target, { reason: 'Inside.' }), { code: 'UNSAFE_PATH' }, target);
  await write(path.join(root, '.atlas-other'), authored());
  await assert.rejects(prepareFromCandidate(root, path.join(root, '.atlas-other'), { reason: 'Inside.' }), { code: 'UNSAFE_PATH' });
  await fs.rm(path.join(root, '.atlas-other'), { recursive: true });
  // A second copy replaces the first.
  assert.equal((await writeCandidate(root)).files, before.files.length);
  assert.equal(await fs.readFile(offline, 'utf8'), await fs.readFile(path.join(root, 'trees/product/points/offline.md'), 'utf8'));
});

test('a candidate folder written before the Atlas changed is refused, so that it cannot undo what was applied since', async t => {
  const { root, candidate } = await fixture(t);
  const before = await openAtlas(root);
  const written = await writeCandidate(root);
  assert.equal(written.baseline, before.identity);
  const offline = 'trees/product/points/offline.md', copied = path.join(written.path, offline);
  await fs.appendFile(copied, '\nEdited in the copy.\n');
  // Another change lands first.
  const other = await prepareChangeFromDisk(root, { reason: 'Qualify the delivery claim.', changes: [{ path: 'trees/product/points/delivery.md', content: `${authored().get('trees/product/points/delivery.md')}\nPending until sent.\n` }] });
  assert.equal((await applyPlan(root, other)).status, 'complete');
  const changed = await openAtlas(root);
  const stale = { code: 'STALE', message: 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.' };
  await assert.rejects(prepareFromCandidate(root, written.path, { reason: 'From the old copy.' }), stale);
  await assert.rejects(prepareFromCandidate(root, path.join(root, '.atlas-candidate/'), { reason: 'From the old copy.' }), stale);
  assert.equal((await openAtlas(root)).identity, changed.identity);
  // Any other directory is prepared from as it is: it names no copy of this Atlas.
  await fs.appendFile(path.join(candidate, offline), '\nEdited elsewhere.\n');
  const elsewhere = await prepareFromCandidate(root, candidate, { reason: 'From another directory.' });
  assert.deepEqual(elsewhere.changes.map(change => change.path), ['trees/product/points/delivery.md', offline]);
  // A fresh copy holds what was applied, and the edit made in it is the whole change.
  const fresh = await writeCandidate(root);
  assert.equal(fresh.baseline, changed.identity);
  await fs.appendFile(copied, '\nEdited in the copy.\n');
  const plan = await prepareFromCandidate(root, fresh.path, { reason: 'From the fresh copy.' });
  assert.deepEqual([plan.status, plan.changes.map(change => change.path)], ['ready', [offline]]);
  // Once its own change is applied the folder, too, is a copy of an earlier Atlas.
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  const record = path.join((await resolveState(root)).directory, 'candidate.json');
  await assert.rejects(prepareFromCandidate(root, fresh.path, { reason: 'The folder after its change was applied.' }), stale);
  // A folder that no record names a copy for cannot be shown to be fresh.
  const unrecorded = { code: 'STALE', message: 'No record says which Atlas this copy was made from; run candidate again.' };
  await fs.rm(record);
  await assert.rejects(prepareFromCandidate(root, fresh.path, { reason: 'No record.' }), unrecorded);
  await fs.writeFile(record, '{');
  await assert.rejects(prepareFromCandidate(root, fresh.path, { reason: 'A damaged record.' }), { code: 'INVALID_STATE', message: 'Saved state is malformed.' });
  // A record whose baseline is not an identity is damaged, not a sign that the Atlas changed.
  for (const damaged of [{ format: 'atlas.candidate-copy/1', baseline: 'not-an-identity' }, { format: 'atlas.candidate-copy/1', baseline: ['a'.repeat(64)] }, { format: 'atlas.candidate-copy/1' },
    { format: 'atlas.candidate-copy/1', baseline: (await openAtlas(root)).identity, copy: 7 }, { format: 'atlas.candidate-copy/1', baseline: (await openAtlas(root)).identity, extra: true }]) {
    await fs.writeFile(record, JSON.stringify(damaged));
    await assert.rejects(prepareFromCandidate(root, fresh.path, { reason: 'A damaged record.' }), { code: 'INVALID_STATE', message: 'Invalid candidate record.' }, JSON.stringify(damaged));
  }
  // A byte that is not UTF-8 is malformed state, never a replacement character.
  await fs.writeFile(record, Buffer.concat([Buffer.from(`{"format":"atlas.candidate-copy/1","baseline":"${(await openAtlas(root)).identity}","copy":"`), Buffer.from([0xff]), Buffer.from('"}')]));
  await assert.rejects(prepareFromCandidate(root, fresh.path, { reason: 'A damaged record.' }), { code: 'INVALID_STATE', message: 'Saved state is malformed.' });
  // A copy left partial names no Atlas: a record that names none replaces the earlier one before the folder is touched.
  assert.equal((await writeCandidate(root)).baseline, (await openAtlas(root)).identity);
  const writeFile = fs.writeFile;
  let copies = 0;
  t.mock.method(fs, 'writeFile', async (file, ...rest) => { if (String(file).startsWith(fresh.path + path.sep) && ++copies === 3) throw Object.assign(new Error('Injected write failure'), { code: 'ENOSPC' }); return writeFile(file, ...rest); });
  await assert.rejects(writeCandidate(root), { code: 'ENOSPC' });
  t.mock.restoreAll();
  assert.deepEqual((({ format, baseline }) => [format, baseline])(JSON.parse(await fs.readFile(record, 'utf8'))), ['atlas.candidate-copy/1', null]);
  await assert.rejects(prepareFromCandidate(root, fresh.path, { reason: 'A partial copy.' }), unrecorded);
  // A copy the private state cannot record is refused before anything in the folder is removed.
  assert.equal((await writeCandidate(root)).files, (await openAtlas(root)).files.length);
  const held = await listing(fresh.path);
  await fs.writeFile(path.join(path.dirname(record), 'owner.json'), '{');
  await assert.rejects(writeCandidate(root), { code: 'STATE_OWNER' });
  assert.deepEqual(await listing(fresh.path), held);
});

test('a fresh copy written while the candidate folder is read is not taken for the copy read, so the earlier copy cannot undo a later apply', async t => {
  const { root } = await fixture(t);
  const first = await writeCandidate(root);
  const before = await openAtlas(root);
  const offline = 'trees/product/points/offline.md', delivery = 'trees/product/points/delivery.md';
  await fs.appendFile(path.join(first.path, offline), '\nEdited in the copy.\n');
  const other = await saveDraft(root, { plan: await prepareChangeFromDisk(root, { reason: 'Qualify the delivery claim.', changes: [{ path: delivery, content: `${authored().get(delivery)}\nPending until sent.\n` }] }) });
  // While the folder is read, another writer applies a change and writes a fresh copy of the Atlas it makes.
  const opendir = fs.opendir;
  let interleaved = false;
  t.mock.method(fs, 'opendir', async (directory, ...rest) => {
    if (!interleaved && directory === first.path) {
      interleaved = true;
      assert.equal((await applyDraft(root, other.id, { expectedRevision: other.revision })).status, 'complete');
      assert.notEqual((await writeCandidate(root)).baseline, before.identity);
    }
    return opendir.call(fs, directory, ...rest);
  });
  try {
    await assert.rejects(prepareFromCandidate(root, first.path, { reason: 'From the copy read.' }), { code: 'STALE', message: 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.' });
  } finally { t.mock.restoreAll(); }
  assert.ok(interleaved);
  assert.ok((await fs.readFile(path.join(root, delivery), 'utf8')).includes('Pending until sent.'));
  // The fresh copy holds what was applied meanwhile, and prepares as nothing to do.
  const fresh = await prepareFromCandidate(root, first.path, { reason: 'From the fresh copy.' });
  assert.deepEqual([fresh.status, fresh.changes], ['noop', []]);
  // Another copy of the same Atlas, written while the folder is read, is not the copy read either: each copy has its own mark.
  await fs.appendFile(path.join(first.path, offline), '\nEdited in the copy.\n');
  let rewritten = false;
  t.mock.method(fs, 'opendir', async (directory, ...rest) => {
    if (!rewritten && directory === first.path) { rewritten = true; assert.equal((await writeCandidate(root)).baseline, (await openAtlas(root)).identity); }
    return opendir.call(fs, directory, ...rest);
  });
  try {
    await assert.rejects(prepareFromCandidate(root, first.path, { reason: 'From the copy read.' }), { code: 'STALE', message: 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.' });
  } finally { t.mock.restoreAll(); }
  assert.ok(rewritten);
});

test('candidate holds the Atlas writer lock throughout: no apply and no other candidate runs while it writes, and it waits for no apply', async t => {
  const { root } = await fixture(t);
  await writeCandidate(root);
  const delivery = 'trees/product/points/delivery.md';
  const other = await saveDraft(root, { plan: await prepareChangeFromDisk(root, { reason: 'Qualify the delivery claim.', changes: [{ path: delivery, content: `${authored().get(delivery)}\nPending until sent.\n` }] }) });
  const record = path.join((await resolveState(root)).directory, 'candidate.json');
  const running = { code: 'LOCKED', message: 'Another Atlas writer is running.' };
  // One candidate pauses as it saves the record that names no Atlas; an apply and a second candidate come meanwhile.
  let pause, resume;
  const paused = new Promise(resolve => { pause = resolve; }), resumed = new Promise(resolve => { resume = resolve; });
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === record && JSON.parse(await fs.readFile(from, 'utf8')).baseline === null) { pause(); await resumed; }
    return rename(from, to);
  });
  const first = writeCandidate(root);
  try {
    await paused;
    await assert.rejects(applyDraft(root, other.id, { expectedRevision: other.revision }), running);
    await assert.rejects(writeCandidate(root), running);
  } finally { resume(); t.mock.restoreAll(); }
  const before = await openAtlas(root);
  assert.equal((await first).baseline, before.identity);
  // The folder, its record and the Atlas are one Atlas: the copy prepares as nothing to do, and the draft then applies.
  assert.equal((await prepareFromCandidate(root, path.join(root, '.atlas-candidate'), { reason: 'The copy.' })).status, 'noop');
  assert.equal((await applyDraft(root, other.id, { expectedRevision: other.revision })).status, 'complete');
  // While an apply holds the lock, a candidate is refused and writes nothing.
  const next = await saveDraft(root, { plan: await prepareChangeFromDisk(root, { reason: 'Qualify again.', changes: [{ path: delivery, content: `${authored().get(delivery)}\nPending until sent, then shown as sent.\n` }] }) });
  const held = await listing(path.join(root, '.atlas-candidate'));
  const applied = await applyDraft(root, next.id, { expectedRevision: next.revision, async onProgress(progress) { if (progress.phase === 'prepared') await assert.rejects(writeCandidate(root), running); } });
  assert.equal(applied.status, 'complete');
  assert.deepEqual(await listing(path.join(root, '.atlas-candidate')), held);
  // A copy written once the apply is done names the Atlas it made.
  assert.equal((await writeCandidate(root)).baseline, (await openAtlas(root)).identity);
});

test('an apply and a candidate that take over one stopped writer\'s lock never both hold it, so an old copy is never recorded as a later Atlas', async t => {
  const { root } = await fixture(t);
  await writeCandidate(root);
  const delivery = 'trees/product/points/delivery.md';
  const other = await saveDraft(root, { plan: await prepareChangeFromDisk(root, { reason: 'Qualify the delivery claim.', changes: [{ path: delivery, content: `${authored().get(delivery)}\nPending until sent.\n` }] }) });
  const { directory } = await resolveState(root);
  const lock = path.join(directory, 'lock.json'), record = path.join(directory, 'candidate.json');
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const dead = child.pid;
  await new Promise(resolve => child.once('exit', resolve));
  await fs.writeFile(lock, JSON.stringify({ pid: dead, transaction: 'stopped-candidate' }));
  const running = { code: 'LOCKED', message: 'Another Atlas writer is running.' };
  // The apply pauses as it claims the stopped writer's lock; a candidate takes the lock over meanwhile and pauses on its first record.
  let claim, resumeApply, save, resumeCandidate, claims = 0, saves = 0;
  const claimed = new Promise(resolve => { claim = resolve; }), applyResumed = new Promise(resolve => { resumeApply = resolve; });
  const saved = new Promise(resolve => { save = resolve; }), candidateResumed = new Promise(resolve => { resumeCandidate = resolve; });
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === lock && ++claims === 1) { claim(); await applyResumed; }
    if (to === record && ++saves === 1) { save(); await candidateResumed; }
    return rename(from, to);
  });
  let applying, copying;
  try {
    applying = applyDraft(root, other.id, { expectedRevision: other.revision });
    await claimed;
    copying = writeCandidate(root);
    await saved;
    // The apply's claim finds the candidate's live lock, puts it back and is refused; so is a second candidate.
    resumeApply();
    await assert.rejects(applying, running);
    await assert.rejects(writeCandidate(root), running);
    resumeCandidate();
    assert.equal((await copying).baseline, (await openAtlas(root)).identity);
  } finally { resumeApply(); resumeCandidate(); await Promise.allSettled([applying, copying]); t.mock.restoreAll(); }
  // The copy is of the Atlas its record names; once the change is applied, it is refused as a copy of an earlier one.
  assert.equal((await prepareFromCandidate(root, path.join(root, '.atlas-candidate'), { reason: 'The copy.' })).status, 'noop');
  assert.equal((await applyDraft(root, other.id, { expectedRevision: other.revision })).status, 'complete');
  await assert.rejects(prepareFromCandidate(root, path.join(root, '.atlas-candidate'), { reason: 'The old copy.' }), { code: 'STALE', message: 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.' });
});

test('a candidate whose lock is no longer its own refuses before it empties the folder', async t => {
  const { root } = await fixture(t);
  const written = await writeCandidate(root);
  await fs.appendFile(path.join(written.path, 'trees/product/points/offline.md'), '\nNot yet prepared.\n');
  const held = await listing(written.path);
  const { directory } = await resolveState(root);
  const lock = path.join(directory, 'lock.json'), record = path.join(directory, 'candidate.json');
  const another = JSON.stringify({ pid: process.pid, transaction: 'another-writer' });
  // As the candidate saves its first record, another writer's lock stands where its own was.
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => { if (to === record) await fs.writeFile(lock, another); return rename(from, to); });
  try { await assert.rejects(writeCandidate(root), { code: 'LOCKED', message: 'Writer lock changed.' }); }
  finally { t.mock.restoreAll(); }
  assert.deepEqual(await listing(written.path), held);
  assert.equal(await fs.readFile(lock, 'utf8'), another);
});

test('the candidate folder is left as it was when the private state cannot take the record of a copy', async t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX permissions, which the superuser passes.');
  const { root } = await fixture(t);
  const written = await writeCandidate(root);
  const { directory } = await resolveState(root);
  const record = path.join(directory, 'candidate.json');
  await fs.appendFile(path.join(written.path, 'trees/product/points/offline.md'), '\nNot yet prepared.\n');
  await fs.writeFile(path.join(written.path, 'notes.txt'), 'Kept beside the records.\n');
  const held = await listing(written.path);
  try {
    // With the record of the copy and without it, an owned state folder that takes no file leaves the folder untouched.
    await fs.chmod(directory, 0o500);
    await assert.rejects(writeCandidate(root), { code: 'EACCES' });
    assert.deepEqual(await listing(written.path), held);
    assert.deepEqual((await prepareFromCandidate(root, written.path, { reason: 'The edit kept.' })).changes.map(change => change.path), ['trees/product/points/offline.md']);
    await fs.chmod(directory, 0o700);
    await fs.rm(record);
    await fs.chmod(directory, 0o500);
    await assert.rejects(writeCandidate(root), { code: 'EACCES' });
    assert.deepEqual(await listing(written.path), held);
    await assert.rejects(fs.stat(record), { code: 'ENOENT' });
  } finally { await fs.chmod(directory, 0o700); }
});

test('a state home that runs through a regular file refuses the copy with UNSAFE_STATE and leaves the folder, and reads no source as private state', async t => {
  const { directory, root } = await fixture(t);
  const written = await writeCandidate(root);
  await fs.appendFile(path.join(written.path, 'trees/product/points/offline.md'), '\nNot yet prepared.\n');
  const held = await listing(written.path);
  await write(root, new Map([['sources/brief.md', '# Brief\n']]));
  await fs.writeFile(path.join(directory, 'a-file'), 'Not a directory.\n');
  const previous = process.env.ATLAS_STATE_HOME;
  process.env.ATLAS_STATE_HOME = path.join(directory, 'a-file/home');
  try {
    await assert.rejects(writeCandidate(root), { code: 'UNSAFE_STATE', message: 'Private state requires regular directories without symbolic links.' });
    assert.deepEqual(await listing(written.path), held);
    assert.equal((await readSource(await openAtlas(root), { uri: 'sources/brief.md' })).status, 'ready');
  } finally { process.env.ATLAS_STATE_HOME = previous; }
});

test('the candidate folder is refused when it is a link, a file, or holds a link, and nothing in it is removed', async t => {
  const { directory, root } = await fixture(t);
  const target = path.join(root, '.atlas-candidate');
  await writeCandidate(root);
  await fs.symlink(path.join(directory, 'candidate/style.md'), path.join(target, 'trees/product/points/linked.md'));
  const held = await listing(target);
  await assert.rejects(writeCandidate(root), error => error.code === 'UNSAFE_PATH' && JSON.stringify(error.diagnostics) === JSON.stringify([{ code: 'PATH_SYMLINK', path: '.atlas-candidate/trees/product/points/linked.md', message: 'The candidate folder holds no symbolic links.' }]));
  assert.deepEqual(await listing(target), held);
  await assert.rejects(prepareFromCandidate(root, target, { reason: 'A link.' }), { code: 'UNSAFE_PATH' });
  await fs.rm(target, { recursive: true });
  await fs.symlink(path.join(directory, 'candidate'), target);
  await assert.rejects(writeCandidate(root), { code: 'UNSAFE_PATH' });
  await assert.rejects(prepareFromCandidate(root, target, { reason: 'A linked folder.' }), { code: 'UNSAFE_PATH' });
  assert.ok((await fs.lstat(path.join(directory, 'candidate/style.md'))).isFile());
  await fs.rm(target);
  await fs.writeFile(target, 'A file.\n');
  await assert.rejects(writeCandidate(root), { code: 'UNSAFE_PATH' });
  assert.equal(await fs.readFile(target, 'utf8'), 'A file.\n');
  // A directory that holds no Atlas has nothing to copy.
  const empty = path.join(directory, 'empty');
  await fs.mkdir(empty);
  await assert.rejects(writeCandidate(empty), { code: 'NOT_FOUND' });
  await assert.rejects(fs.lstat(path.join(empty, '.atlas-candidate')), { code: 'ENOENT' });
});

test('an invalid Atlas is copied as it is, so it can be repaired from the copy: an atlas/1.1 folder brought to 1.2', async t => {
  const directory = await tempDirectory('atlas-candidate-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'atlas');
  await write(root, earlier());
  const before = await openAtlas(root);
  assert.equal(before.status, 'invalid');
  const written = await writeCandidate(root);
  assert.equal(written.files, earlier().size);
  for (const [file, content] of earlier()) assert.equal(await fs.readFile(path.join(written.path, file), 'utf8'), content, file);
  await write(written.path, authored());
  const plan = await prepareFromCandidate(root, written.path, { reason: 'Bring the Atlas to atlas/1.2.' });
  assert.deepEqual([plan.status, plan.changes.map(change => change.path)], ['ready', ['atlas.json', 'style.md', 'trees/product/facets/storage.md']]);
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  assert.equal((await openAtlas(root)).status, 'ready');
  assert.equal((await openAtlas(root)).identity, (await openAtlas(written.path)).identity);
});

test('a candidate lies outside the Atlas and private state, and is a real directory', async t => {
  const { directory, root, candidate } = await fixture(t);
  const refuse = async (target, code = 'UNSAFE_PATH') => { await assert.rejects(prepareFromCandidate(root, target, { reason: 'Refused.' }), { code }, target); };
  await refuse(root);
  await refuse(path.join(root, 'trees/product'));
  await write(path.join(root, 'proposal'), authored());
  await refuse(path.join(root, 'proposal'));
  await fs.rm(path.join(root, 'proposal'), { recursive: true });
  await refuse(directory);
  await refuse(path.join(directory, 'absent'));
  await refuse(path.join(candidate, 'atlas.json'));
  await fs.symlink(candidate, path.join(directory, 'linked'));
  await refuse(path.join(directory, 'linked'));
  await refuse(undefined);
  const state = await resolveState(root, { create: true });
  await write(path.join(state.directory, 'proposal'), authored());
  await refuse(path.join(state.directory, 'proposal'));
  await fs.rm(path.join(state.directory, 'proposal'), { recursive: true });
  await write(path.join(process.env.ATLAS_STATE_HOME, 'candidate-in-state-home'), authored());
  t.after(() => fs.rm(path.join(process.env.ATLAS_STATE_HOME, 'candidate-in-state-home'), { recursive: true, force: true }));
  await refuse(path.join(process.env.ATLAS_STATE_HOME, 'candidate-in-state-home'));
  for (const reason of [undefined, '', '  ']) await assert.rejects(prepareFromCandidate(root, candidate, { reason }), { code: 'INVALID_REQUEST' });
  await assert.rejects(prepareFromCandidate(root, candidate), { code: 'INVALID_REQUEST' });
  await fs.rm(path.join(candidate, 'atlas.json'));
  await refuse(candidate, 'INVALID_REQUEST');
  await fs.writeFile(path.join(candidate, 'atlas.json'), Buffer.from([0xff, 0xfe]));
  await refuse(candidate, 'INVALID_REQUEST');
  await assert.rejects(prepareFromCandidate(path.join(directory, 'absent-atlas'), candidate, { reason: 'No Atlas root.' }), { code: 'ENOENT' });
});

test('a plain copy of an Atlas folder is a candidate: the example with its sources', async t => {
  const directory = await tempDirectory('atlas-candidate-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [folder, extra, point] of [['examples/offline-notes', 'sources/brief.md', 'trees/product/points/promise.md']]) {
    const root = path.join(repo, folder), copy = path.join(directory, path.basename(folder));
    const before = await openAtlas(root);
    assert.equal(before.status, 'ready', JSON.stringify(before.diagnostics));
    await fs.cp(root, copy, { recursive: true });
    const plain = await prepareFromCandidate(root, copy, { reason: 'A plain copy.' });
    assert.deepEqual([plain.status, plain.changes, plain.ignored, plain.candidate.identity], ['noop', [], [], before.identity], folder);
    // An edit to a file that is not a record is named and left out. The edit to a record beside it is the change.
    await fs.appendFile(path.join(copy, extra), '\nEdited in the copy.\n');
    assert.deepEqual((({ status, changes, ignored }) => [status, changes, ignored])(await prepareFromCandidate(root, copy, { reason: 'Only a file that is not a record.' })), ['noop', [], [extra]], folder);
    await fs.appendFile(path.join(copy, point), '\nQualified in the copy.\n');
    const edited = await prepareFromCandidate(root, copy, { reason: 'Qualify a claim.' });
    assert.deepEqual([edited.status, edited.changes.map(change => change.path), edited.ignored], ['ready', [point], [extra]], JSON.stringify(edited.validation.diagnostics));
    // A symbolic link is refused by name, wherever it is.
    await fs.symlink(path.join(copy, extra), path.join(copy, `${extra}.link`));
    await assert.rejects(prepareFromCandidate(root, copy, { reason: 'Refused whole.' }), { code: 'UNSAFE_PATH', message: `The candidate directory holds a path an Atlas cannot hold: ${extra}.link (PATH_SYMLINK).` });
    assert.equal((await openAtlas(root)).identity, before.identity);
  }
});

test('files in a candidate that are not records are no part of the change; the plan names those the Atlas does not hold with the same bytes', async t => {
  const { directory, root, candidate } = await fixture(t);
  const besides = [['README.md', 'Notes about this Atlas.\n'], ['sources/brief.md', 'A source kept beside the records.\n'], ['sources/data/trace.bin', Buffer.from([0xff, 0x00, 0xfe])],
    ['trees/product/outline.md', 'Beside tree.json.\n'], ['.atlas-state/draft.json', '{}'], ['notes', 'Kept beside the records.\n'], ['linked.md', 'Kept beside the records.\n']];
  await write(root, besides); await write(candidate, besides);
  assert.deepEqual((({ status, changes, ignored }) => [status, changes, ignored])(await prepareFromCandidate(root, candidate, { reason: 'A plain copy.' })), ['noop', [], []]);

  await fs.writeFile(path.join(candidate, 'sources/brief.md'), 'A source edited in the candidate.\n');
  await fs.writeFile(path.join(candidate, 'sources/data/trace.bin'), Buffer.from([0xff, 0x00, 0xfd]));
  await fs.writeFile(path.join(candidate, 'sources/new.md'), 'A source the Atlas does not have.\n');
  await fs.writeFile(path.join(candidate, '.atlas-state/draft.json'), '{"edited":true}');
  await fs.mkdir(path.join(candidate, 'trees/unlisted/points'), { recursive: true });
  await fs.writeFile(path.join(candidate, 'trees/unlisted/points/stray.md'), record({ id: 'stray' }, 'Stray', 'In a Tree the manifest does not declare.'));
  await fs.mkdir(path.join(candidate, 'empty/directories/are/nothing'), { recursive: true });
  await fs.rm(path.join(candidate, 'README.md'));
  // In the Atlas, a directory or a symbolic link at the same path is no counterpart, whatever it leads to.
  await fs.rm(path.join(root, 'notes')); await fs.mkdir(path.join(root, 'notes'));
  await fs.writeFile(path.join(directory, 'outside.md'), 'Kept beside the records.\n');
  await fs.rm(path.join(root, 'linked.md')); await fs.symlink(path.join(directory, 'outside.md'), path.join(root, 'linked.md'));
  await fs.appendFile(path.join(candidate, 'trees/product/points/offline.md'), '\nUnsent edits survive a restart.\n');
  const before = await openAtlas(root);
  const plan = await prepareFromCandidate(root, candidate, { reason: 'Say what offline work keeps.' });
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  assert.deepEqual(plan.changes.map(change => change.path), ['trees/product/points/offline.md']);
  assert.deepEqual(plan.ignored, ['.atlas-state/draft.json', 'linked.md', 'notes', 'sources/brief.md', 'sources/data/trace.bin', 'sources/new.md', 'trees/unlisted/points/stray.md']);
  assert.equal(plan.baseline.identity, before.identity);
  assert.equal(plan.candidate.identity, (await openAtlas(candidate)).identity);
  assert.equal(inspectChange(plan).before.identity, before.identity);

  // The draft keeps the list. Applying it writes the record and leaves every other file as the Atlas had it.
  const draft = await saveDraft(root, { plan });
  assert.deepEqual(draft.plan.ignored, plan.ignored);
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
  assert.equal(await fs.readFile(path.join(root, 'sources/brief.md'), 'utf8'), 'A source kept beside the records.\n');
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'Notes about this Atlas.\n');
  await assert.rejects(fs.stat(path.join(root, 'sources/new.md')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, 'trees/unlisted')), { code: 'ENOENT' });
  const again = await prepareFromCandidate(root, candidate, { reason: 'Already applied.' });
  assert.deepEqual([again.status, again.ignored], ['noop', plan.ignored]);
});

test('symbolic links anywhere in a candidate, and files in its record folders that are not records, are refused by name', async t => {
  const { directory, root, candidate } = await fixture(t);
  await fs.writeFile(path.join(directory, 'outside.md'), record({ id: 'linked' }, 'Linked', 'Outside the candidate.'));
  await fs.writeFile(path.join(candidate, 'README.md'), 'Notes about the candidate.');
  await fs.mkdir(path.join(candidate, 'sources')); await fs.symlink(path.join(directory, 'outside.md'), path.join(candidate, 'sources/linked.md'));
  await fs.symlink(path.join(directory, 'outside.md'), path.join(candidate, 'trees/product/points/linked.md'));
  await fs.symlink(path.join(directory), path.join(candidate, 'trees/product/facets/elsewhere'));
  await fs.writeFile(path.join(candidate, 'trees/product/points/notes.txt'), 'Not a record.');
  await fs.writeFile(path.join(candidate, '.checks/notes.txt'), 'Not a record.');
  await fs.mkdir(path.join(candidate, 'trees/product/points/.atlas-state')); await fs.writeFile(path.join(candidate, 'trees/product/points/.atlas-state/draft.md'), '{}');
  // A record under a name that readers pass over would be dropped unseen, so it is refused as well.
  await fs.writeFile(path.join(candidate, 'trees/product/points/draft#2.md'), record({ id: 'draft' }, 'A second draft', 'Named with a mark no reader accepts.'));
  const before = (await openAtlas(root)).identity;
  const refusal = await prepareFromCandidate(root, candidate, { reason: 'Refused whole.' }).then(() => null, error => error);
  assert.equal(refusal.code, 'UNSAFE_PATH');
  assert.deepEqual(refusal.diagnostics.map(({ code, path: file }) => [file, code]), [
    ['.checks/notes.txt', 'RECORD_UNEXPECTED'], ['sources/linked.md', 'PATH_SYMLINK'], ['trees/product/facets/elsewhere', 'PATH_SYMLINK'],
    ['trees/product/points/.atlas-state/draft.md', 'PATH_UNSAFE'], ['trees/product/points/draft#2.md', 'PATH_UNSAFE'], ['trees/product/points/linked.md', 'PATH_SYMLINK'],
    ['trees/product/points/notes.txt', 'RECORD_UNEXPECTED'],
  ]);
  assert.ok(refusal.diagnostics.every(item => typeof item.message === 'string' && item.message));
  assert.equal(refusal.message, 'The candidate directory holds 7 paths an Atlas cannot hold: .checks/notes.txt (RECORD_UNEXPECTED), sources/linked.md (PATH_SYMLINK), trees/product/facets/elsewhere (PATH_SYMLINK), trees/product/points/.atlas-state/draft.md (PATH_UNSAFE), trees/product/points/draft#2.md (PATH_UNSAFE), trees/product/points/linked.md (PATH_SYMLINK), trees/product/points/notes.txt (RECORD_UNEXPECTED).');
  for (const file of ['sources', '.checks/notes.txt', 'trees/product/points/notes.txt', 'trees/product/points/.atlas-state', 'trees/product/points/linked.md', 'trees/product/facets/elsewhere', 'trees/product/points/draft#2.md']) await fs.rm(path.join(candidate, file), { recursive: true });
  await fs.symlink(path.join(directory, 'outside.md'), path.join(candidate, 'style.md.link'));
  const one = await prepareFromCandidate(root, candidate, { reason: 'Refused whole.' }).then(() => null, error => error);
  assert.equal(one.message, 'The candidate directory holds a path an Atlas cannot hold: style.md.link (PATH_SYMLINK).');
  await fs.rm(path.join(candidate, 'style.md.link'));
  await fs.writeFile(path.join(candidate, 'trees/product/points/offline.md'), Buffer.concat([Buffer.from(authored().get('trees/product/points/offline.md')), Buffer.from([0xff])]));
  const binary = await prepareFromCandidate(root, candidate, { reason: 'Refused whole.' }).then(() => null, error => error);
  assert.deepEqual([binary.code, binary.message, binary.diagnostics.map(item => [item.code, item.path])], ['INVALID_CANDIDATE', 'Candidate records must be valid UTF-8 text: trees/product/points/offline.md.', [['FILE_UTF8', 'trees/product/points/offline.md']]]);
  await fs.writeFile(path.join(candidate, 'trees/product/points/offline.md'), authored().get('trees/product/points/offline.md'));
  // What is left is the Atlas's records and a README, which is no part of a change and is never refused.
  const clean = await prepareFromCandidate(root, candidate, { reason: 'Clean again.' });
  assert.deepEqual([clean.status, clean.ignored], ['noop', ['README.md']]);
  assert.equal((await openAtlas(root)).identity, before);
});

test('a candidate that declares another Tree replaces what already stands in that folder, and one that drops a Tree removes it', async t => {
  const { root, candidate } = await fixture(t);
  await fs.mkdir(path.join(root, 'trees/evidence/points'), { recursive: true });
  await fs.writeFile(path.join(root, 'trees/evidence/tree.json'), 'An earlier, undeclared outline.');
  await fs.writeFile(path.join(root, 'trees/evidence/points/old.md'), 'An earlier, undeclared record.');
  const before = await openAtlas(root);
  assert.ok(!before.files.some(file => file.path.startsWith('trees/evidence/')));
  const manifest = JSON.parse(authored().get('atlas.json'));
  manifest.trees = ['trees/product', 'trees/evidence'];
  await fs.writeFile(path.join(candidate, 'atlas.json'), json(manifest));
  await fs.rm(path.join(candidate, 'trees/system'), { recursive: true });
  await fs.rm(path.join(candidate, 'trees/product/facets'), { recursive: true });
  await write(candidate, [
    ['trees/evidence/tree.json', json({ id: 'evidence', title: 'Evidence', scope: 'What was observed.', base: 'trial', children: [] })],
    ['trees/evidence/points/trial.md', record({ id: 'trial', type: 'observation', observedAt: '2026-11-14', sources: [{ uri: 'docs/trial.md' }] }, 'One restart kept the notes', 'A single recorded run.')],
  ]);
  const plan = await prepareFromCandidate(root, candidate, { reason: 'Replace the system account with the evidence account.' });
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  assert.deepEqual(plan.observedFiles.map(file => file.path), ['trees/evidence/points/old.md', 'trees/evidence/tree.json']);
  assert.equal(plan.baseline.identity, before.identity);
  assert.deepEqual(plan.changes.map(change => [change.path, change.before === null ? 'add' : change.after === null ? 'remove' : 'replace']), [
    ['atlas.json', 'replace'], ['trees/evidence/points/old.md', 'remove'], ['trees/evidence/points/trial.md', 'add'], ['trees/evidence/tree.json', 'replace'],
    ['trees/product/facets/storage.md', 'remove'], ['trees/system/points/runtime.md', 'remove'], ['trees/system/tree.json', 'remove'],
  ]);
  assert.equal(plan.changes.find(change => change.path === 'trees/evidence/tree.json').before, 'An earlier, undeclared outline.');
  assert.equal(plan.candidate.identity, (await openAtlas(candidate)).identity);
  const sides = inspectChange(plan);
  assert.deepEqual([sides.before.identity, sides.after.identity], [before.identity, plan.candidate.identity]);
  // A record that appears in the proposed scope after preparation stops the apply before any write.
  await fs.writeFile(path.join(root, 'trees/evidence/points/late.md'), 'Written after the plan was prepared.');
  await assert.rejects(applyPlan(root, plan), { code: 'STALE' });
  assert.equal((await openAtlas(root)).identity, before.identity);
  await fs.rm(path.join(root, 'trees/evidence/points/late.md'));
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  const after = await openAtlas(root);
  assert.equal(after.identity, plan.candidate.identity);
  assert.deepEqual(after.atlas.trees.map(tree => tree.id), ['product', 'evidence']);
  await assert.rejects(fs.stat(path.join(root, 'trees/system/tree.json')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, 'trees/evidence/points/old.md')), { code: 'ENOENT' });
});

test('a candidate can found an Atlas in an empty directory and repair one whose manifest is malformed', async t => {
  const { directory, candidate } = await fixture(t);
  const empty = path.join(directory, 'empty'); await fs.mkdir(empty);
  const founding = await prepareFromCandidate(empty, candidate, { reason: 'Found the Atlas from a complete candidate.' });
  assert.equal(founding.status, 'ready', JSON.stringify(founding.validation.diagnostics));
  assert.equal(founding.changes.length, authored().size);
  assert.ok(founding.changes.every(change => change.before === null));
  assert.equal((await applyPlan(empty, founding)).status, 'complete');
  assert.equal((await openAtlas(empty)).identity, (await openAtlas(candidate)).identity);
  await fs.writeFile(path.join(empty, 'atlas.json'), '{broken');
  const broken = await openAtlas(empty);
  assert.equal(broken.status, 'invalid');
  const repair = await prepareFromCandidate(empty, candidate, { reason: 'Restore the manifest.' });
  assert.deepEqual(repair.changes.map(change => change.path), ['atlas.json']);
  // The malformed view still captured the manifest, the Style and the Checks; the Tree records come into scope with the repair.
  assert.deepEqual(broken.files.map(file => file.path), ['.checks/removals.md', 'atlas.json', 'style.md']);
  assert.deepEqual(repair.observedFiles.map(file => file.path), [...authored().keys()].filter(file => file.startsWith('trees/')).sort());
  assert.equal((await applyPlan(empty, repair)).status, 'complete');
  assert.equal((await openAtlas(empty)).status, 'ready');
});

test('a candidate that differs in more than 1000 files is refused before any plan exists', async t => {
  const { root, candidate } = await fixture(t);
  const tree = JSON.parse(authored().get('trees/system/tree.json'));
  tree.children = Array.from({ length: 1001 }, (_, index) => ({ point: `detail-${index}` }));
  await fs.writeFile(path.join(candidate, 'trees/system/tree.json'), json(tree));
  await Promise.all(tree.children.map(({ point }) => fs.writeFile(path.join(candidate, `trees/system/points/${point}.md`), record({ id: point }, `Detail ${point}`, 'One more claim.'))));
  await assert.rejects(prepareFromCandidate(root, candidate, { reason: 'Too large for one change.' }), { code: 'LIMIT_EXCEEDED' });
});
