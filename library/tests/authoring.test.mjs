import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openAtlas } from '../src/model.mjs';
import { resolveState } from '../src/state.mjs';
import { prepareChange, prepareChangeFromDisk, prepareInitialization, applyChange, applyDraft, listTransactions, recoverChange, saveDraft, loadDraft, listDrafts, deleteDraft } from '../src/authoring.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const example = path.join(repo, 'examples/offline-notes');
const point = 'trees/product/points/promise.md';
async function fixture(t, empty = false) {
  await fs.mkdir(path.join(repo, 'tmp/tests'), { recursive: true });
  const root = await fs.mkdtemp(path.join(repo, 'tmp/tests/authoring-'));
  if (!empty) await fs.cp(example, root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function edit(view, suffix = '\nA later review is required.\n') {
  return prepareChange(view, { reason: 'Add review qualification', changes: [{ path: point, content: view.files.find(f => f.path === point).content + suffix }] });
}

test('preview does not write; apply validates and repeated content is a no-op', async t => {
  const root = await fixture(t);
  const before = await openAtlas(root);
  assert.equal(before.status, 'ready', JSON.stringify(before.diagnostics));
  const plan = edit(before);
  assert.equal(plan.status, 'ready');
  assert.equal((await openAtlas(root)).identity, before.identity);
  const result = await applyChange(root, plan);
  assert.equal(result.status, 'complete');
  assert.equal((await openAtlas(root)).identity, plan.candidate.identity);
  const current = await openAtlas(root);
  const noop = prepareChange(current, { reason: 'Already represented', changes: [{ path: point, content: plan.changes[0].after }] });
  assert.equal((await applyChange(root, noop)).status, 'noop');
  assert.equal((await listTransactions(root)).length, 1);
});

test('stale unrelated authored content refuses all writes', async t => {
  const root = await fixture(t);
  const before = await openAtlas(root);
  const plan = edit(before);
  await fs.appendFile(path.join(root, 'trees/architecture/points/sync.md'), '\nExternal correction.\n');
  await assert.rejects(applyChange(root, plan), { code: 'STALE' });
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), plan.changes[0].before);
  assert.deepEqual(await listTransactions(root), []);
});

test('forged candidate and paths grant no apply authority', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  assert.throws(() => prepareChange(view, { reason: 'Escape', changes: [{ path: '../outside', content: 'bad' }] }), { code: 'UNSAFE_PATH' });
  assert.throws(() => prepareChange(view, { reason: 'Source rewrite', changes: [{ path: 'sources/brief.md', content: 'bad' }] }), { code: 'UNSAFE_PATH' });
  const forged = edit(view);
  forged.changes[0].after = 'not a Point';
  forged.candidate = view;
  await assert.rejects(applyChange(root, forged), { code: 'INVALID_CANDIDATE' });
  assert.equal((await openAtlas(root)).identity, view.identity);
});

test('symlink replacement is refused without touching its target', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const plan = edit(view);
  const target = path.join(root, 'sources/brief.md');
  const original = await fs.readFile(target, 'utf8');
  await fs.unlink(path.join(root, point));
  await fs.symlink(target, path.join(root, point));
  await assert.rejects(applyChange(root, plan));
  assert.equal(await fs.readFile(target, 'utf8'), original);
});

test('interrupted multi-file apply survives restart and guarded recovery restores bytes', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const files = [point, 'trees/architecture/points/sync.md'];
  const plan = prepareChange(view, { reason: 'Two related clarifications', changes: files.map(file => ({ path: file, content: view.files.find(f => f.path === file).content + '\nReview required.\n' })) });
  const planFile = path.join(root, 'plan.json');
  await fs.writeFile(planFile, JSON.stringify(plan));
  const script = `import { readFile } from 'node:fs/promises'; import { applyChange } from ${JSON.stringify(new URL('../src/authoring.mjs', import.meta.url).href)}; const plan=JSON.parse(await readFile(process.argv[2],'utf8')); await applyChange(process.argv[1],plan,{onProgress(p){ if(p.written.length===1) process.kill(process.pid,'SIGKILL'); }});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, planFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  const result = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(result.signal, 'SIGKILL', stderr);
  const [transaction] = await listTransactions(root);
  assert.equal(transaction.phase, 'applying');
  assert.equal(transaction.written.length, 1);
  await assert.rejects(applyChange(root, plan), { code: 'LOCKED' });
  const recovered = await recoverChange(root, transaction.id);
  assert.equal(recovered.status, 'rolled-back');
  assert.equal(recovered.baselineRestored, true);
  assert.equal((await openAtlas(root)).identity, view.identity);
});

test('recovery preflights every file and refuses foreign edits', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const second = 'trees/architecture/points/sync.md';
  const plan = prepareChange(view, { reason: 'Interrupted review', changes: [point, second].map(file => ({ path: file, content: view.files.find(f => f.path === file).content + '\nPending review.\n' })) });
  const applied = await applyChange(root, plan, { onProgress(progress) { if (progress.written.length === 1) throw new Error('Injected I/O failure'); } });
  assert.equal(applied.status, 'interrupted');
  await fs.appendFile(path.join(root, second), '\nForeign edit.\n');
  const partial = await openAtlas(root);
  await assert.rejects(recoverChange(root, applied.transaction), { code: 'RECOVERY_CONFLICT' });
  assert.equal((await openAtlas(root)).identity, partial.identity);
});

test('draft retains original baseline across reload and stale apply refusal', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const plan = edit(view);
  const saved = await saveDraft(root, { plan });
  const loaded = await loadDraft(root, saved.id);
  assert.deepEqual(loaded.plan, plan);
  assert.equal((await listDrafts(root))[0].baseline, view.identity);
  await fs.appendFile(path.join(root, point), '\nOther author.\n');
  await assert.rejects(applyChange(root, loaded.plan), { code: 'STALE' });
  await deleteDraft(root, saved.id, { expectedRevision: saved.revision });
  assert.deepEqual(await listDrafts(root), []);
});

test('saved draft revisions bind edits, review, apply and deletion to exact content', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const reviewed = await saveDraft(root, { id: 'reviewed', plan: edit(baseline, '\nReviewed change.\n') });
  const alternate = edit(baseline, '\nAnother author changed the draft.\n');
  await assert.rejects(saveDraft(root, { id: reviewed.id, plan: alternate }), { code: 'STALE_DRAFT' });
  const revised = await saveDraft(root, { id: reviewed.id, plan: alternate, expectedRevision: reviewed.revision });
  assert.notEqual(revised.revision, reviewed.revision);
  assert.equal((await listDrafts(root))[0].revision, revised.revision);
  await assert.rejects(saveDraft(root, { id: reviewed.id, plan: reviewed.plan, expectedRevision: reviewed.revision }), { code: 'STALE_DRAFT' });
  await assert.rejects(applyDraft(root, reviewed.id, { expectedRevision: reviewed.revision }), { code: 'STALE_DRAFT' });
  await assert.rejects(applyDraft(root, reviewed.id), { code: 'STALE_DRAFT' });
  await assert.rejects(deleteDraft(root, reviewed.id, { expectedRevision: reviewed.revision }), { code: 'STALE_DRAFT' });
  assert.equal((await openAtlas(root)).identity, baseline.identity);
  assert.deepEqual(await listTransactions(root), []);
  assert.equal((await applyDraft(root, revised.id, { expectedRevision: revised.revision })).status, 'complete');
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), alternate.changes[0].after);
  await deleteDraft(root, revised.id, { expectedRevision: revised.revision });
});

test('draft saves refuse rebasing, concurrent overwrite and changed storage', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const replacement = edit(baseline, '\nRevised plan.\n');
  const attempts = await Promise.allSettled([
    saveDraft(root, { id: draft.id, plan: replacement, expectedRevision: draft.revision }),
    saveDraft(root, { id: draft.id, plan: edit(baseline, '\nCompeting plan.\n'), expectedRevision: draft.revision }),
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.ok(['LOCKED', 'STALE_DRAFT'].includes(attempts.find(item => item.status === 'rejected').reason.code));
  const current = await loadDraft(root, draft.id);
  await fs.appendFile(path.join(root, point), '\nAuthored source changed.\n');
  const rebased = edit(await openAtlas(root));
  await assert.rejects(saveDraft(root, { id: draft.id, plan: rebased, expectedRevision: current.revision }), { code: 'STALE_DRAFT' });
  const filename = path.join((await resolveState(root)).directory, 'drafts', `${draft.id}.json`);
  const altered = JSON.parse(await fs.readFile(filename, 'utf8'));
  altered.plan = rebased;
  await fs.writeFile(filename, JSON.stringify(altered));
  await assert.rejects(loadDraft(root, draft.id), { code: 'INVALID_STATE' });
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: current.revision }), { code: 'INVALID_STATE' });
});

test('competing draft and Atlas writers refuse locks whose metadata is not available', async t => {
  for (const kind of ['draft', 'writer']) for (const window of ['before metadata write', 'after release']) {
    await t.test(`${kind}: ${window}`, async t => {
      const root = await fixture(t);
      const baseline = await openAtlas(root);
      const draft = await saveDraft(root, { id: 'contended', plan: edit(baseline) });
      const winnerPlan = edit(baseline, '\nWinning update.\n');
      const contenderPlan = edit(baseline, '\nContending update.\n');
      const state = await resolveState(root);
      const lock = path.join(state.directory, kind === 'draft' ? 'drafts/contended.lock' : 'lock.json');
      const attempt = plan => kind === 'draft'
        ? saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan })
        : applyChange(root, plan);
      let releaseOwner, observeWrite, owner, intercepted = false;
      const canWrite = new Promise(resolve => { releaseOwner = resolve; });
      const writing = new Promise(resolve => { observeWrite = resolve; });
      const originalOpen = fs.open;
      t.mock.method(fs, 'open', async (filename, flags, ...options) => {
        let handle;
        try { handle = await originalOpen(filename, flags, ...options); }
        catch (error) {
          if (filename === lock && flags === 'wx' && error.code === 'EEXIST' && window === 'after release') {
            // The contender has observed the lock, but its metadata inspection
            // happens only after the successful owner removes it.
            releaseOwner();
            await owner;
          }
          throw error;
        }
        if (filename === lock && flags === 'wx' && !intercepted) {
          intercepted = true;
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async (...args) => {
            observeWrite();
            await canWrite;
            return write(...args);
          };
        }
        return handle;
      });
      owner = attempt(winnerPlan);
      let result;
      try {
        await Promise.race([writing, owner.then(() => { throw new Error('The owner did not reach the lock write.'); })]);
        await assert.rejects(attempt(contenderPlan), { code: 'LOCKED' });
      } finally {
        releaseOwner();
        try { result = await owner; } finally { t.mock.restoreAll(); }
      }
      if (kind === 'draft') {
        assert.equal((await loadDraft(root, draft.id)).revision, result.revision);
        assert.deepEqual((await loadDraft(root, draft.id)).plan, winnerPlan);
        assert.equal((await openAtlas(root)).identity, baseline.identity);
      } else {
        assert.equal(result.status, 'complete');
        assert.equal((await openAtlas(root)).identity, winnerPlan.candidate.identity);
        assert.equal((await listTransactions(root)).length, 1);
      }
      await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
    });
  }
});

test('invalid lock values remain locked without masking malformed saved drafts', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { id: 'invalid-lock', plan: edit(baseline) });
  const state = await resolveState(root);
  for (const kind of ['draft', 'writer']) {
    const lock = path.join(state.directory, kind === 'draft' ? 'drafts/invalid-lock.lock' : 'lock.json');
    for (const contents of ['null', '[]', 'false', '"invalid"', '{']) {
      await fs.writeFile(lock, contents);
      const attempt = kind === 'draft'
        ? saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan: edit(baseline) })
        : applyChange(root, edit(baseline));
      await assert.rejects(attempt, { code: 'LOCKED' });
      assert.equal(await fs.readFile(lock, 'utf8'), contents, 'Unusable lock metadata must never authorize removing the lock.');
      assert.equal((await openAtlas(root)).identity, baseline.identity);
      await fs.unlink(lock);
    }
  }
  assert.equal((await loadDraft(root, draft.id)).revision, draft.revision);
  await fs.writeFile(path.join(state.directory, 'drafts/invalid-lock.json'), '{');
  await assert.rejects(loadDraft(root, draft.id), { code: 'INVALID_STATE' });
  await assert.rejects(saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan: edit(baseline) }), { code: 'INVALID_STATE' });
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code: 'INVALID_STATE' });
});

test('applying a reviewed draft excludes concurrent saves until application finishes', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const result = await applyDraft(root, draft.id, { expectedRevision: draft.revision, async onProgress(progress) {
    if (progress.phase === 'prepared') await assert.rejects(saveDraft(root, {
      id: draft.id, plan: edit(baseline, '\nUnreviewed replacement.\n'), expectedRevision: draft.revision,
    }), { code: 'LOCKED' });
  } });
  assert.equal(result.status, 'complete');
  assert.equal((await openAtlas(root)).identity, draft.plan.candidate.identity);
});

test('dead writer locks before preparation or after completion do not strand an Atlas', async t => {
  const root = await fixture(t);
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const deadPid = child.pid;
  await new Promise(resolve => child.once('exit', resolve));
  const state = await resolveState(root, { create: true });
  const lock = path.join(state.directory, 'lock.json');
  await fs.writeFile(lock, JSON.stringify({ pid: deadPid, transaction: 'not-prepared' }));
  const first = await applyChange(root, edit(await openAtlas(root)));
  assert.equal(first.status, 'complete');
  await fs.writeFile(lock, JSON.stringify({ pid: deadPid, transaction: first.transaction }));
  const second = await applyChange(root, edit(await openAtlas(root), '\nAnother reviewed update.\n'));
  assert.equal(second.status, 'complete');
});

test('empty initialization and invalid-source repair use prepared changes', async t => {
  const root = await fixture(t, true);
  const empty = await openAtlas(root);
  const plan = prepareInitialization(empty, { id: 'empty', title: 'Empty Atlas' });
  assert.equal(plan.status, 'ready');
  assert.equal((await applyChange(root, plan)).status, 'complete');
  await fs.writeFile(path.join(root, 'atlas.json'), '{broken');
  const invalid = await openAtlas(root);
  assert.equal(invalid.status, 'invalid');
  const repair = await prepareChangeFromDisk(root, { reason: 'Repair malformed manifest and restore its selected Style', styleChange: true, changes: [{ path: 'atlas.json', content: plan.changes[0].after }] }, { view: invalid });
  assert.equal((await applyChange(root, repair)).status, 'complete');
});

test('a new Tree cannot overwrite uncaptured files after writing the manifest', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const manifest = JSON.parse(view.files.find(f => f.path === 'atlas.json').content);
  manifest.trees.push('trees/new');
  const plan = prepareChange(view, { reason: 'Create new account', changes: [
    { path: 'atlas.json', content: JSON.stringify(manifest) },
    { path: 'trees/new/tree.json', content: JSON.stringify({ id: 'new', title: 'New', scope: 'New account.', base: 'new-base', children: [] }) },
    { path: 'trees/new/points/base.md', content: '---\n{"id":"new-base"}\n---\n# New account\n\nA new account with its own scope.\n' },
  ] });
  assert.equal(plan.status, 'ready');
  await fs.mkdir(path.join(root, 'trees/new'), { recursive: true });
  await fs.writeFile(path.join(root, 'trees/new/tree.json'), 'Uncaptured work');
  await assert.rejects(applyChange(root, plan), { code: 'STALE' });
  assert.equal((await openAtlas(root)).identity, view.identity);
  assert.equal(await fs.readFile(path.join(root, 'trees/new/tree.json'), 'utf8'), 'Uncaptured work');
  assert.deepEqual(await listTransactions(root), []);
});

test('source evidence is rechecked after durable preparation before any source write', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const uri = 'sources/brief.md';
  const evidence = await fs.readFile(path.join(root, uri));
  const plan = prepareChange(view, { reason: 'Evidence-bound revision', changes: [{ path: point, content: view.files.find(f => f.path === point).content + '\nEvidence reviewed.\n' }], sourcePreconditions: [{ uri, sha256: createHash('sha256').update(evidence).digest('hex') }] });
  const result = await applyChange(root, plan, { async onProgress(progress) { if (progress.phase === 'prepared') await fs.appendFile(path.join(root, uri), '\nChanged source.\n'); } });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.error.code, 'STALE_SOURCE');
  assert.deepEqual(result.written, []);
  assert.equal((await openAtlas(root)).identity, view.identity);
});

test('repairing a malformed manifest captures existing Tree records and rejects hidden concurrent additions', async t => {
  const root = await fixture(t);
  const manifest = await fs.readFile(path.join(root, 'atlas.json'), 'utf8');
  await fs.writeFile(path.join(root, 'atlas.json'), '{broken');
  const invalid = await openAtlas(root);
  const request = { reason: 'Repair manifest and restore its selected Style', styleChange: true, changes: [{ path: 'atlas.json', content: manifest }] };
  const plan = await prepareChangeFromDisk(root, request, { view: invalid });
  assert.equal(plan.status, 'ready');
  assert(plan.observedFiles.length > 5);
  assert.equal(plan.baseline.identity, invalid.identity);
  await fs.writeFile(path.join(root, 'trees/product/points/new.md'), 'Uncaptured work');
  await assert.rejects(applyChange(root, plan), { code: 'STALE' });
  assert.equal(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'), '{broken');
  await fs.unlink(path.join(root, 'trees/product/points/new.md'));
  assert.equal((await applyChange(root, plan)).status, 'complete');
  assert.equal((await openAtlas(root)).status, 'ready');
});

test('invalid UTF-8 remains byte-exact through capture, draft review, stale refusal and apply', async t => {
  const root = await fixture(t);
  const original = await fs.readFile(path.join(root, point), 'utf8');
  const broken = Buffer.concat([Buffer.from(original), Buffer.from([0xff, 0xfe])]);
  await fs.writeFile(path.join(root, point), broken);
  const baseline = await openAtlas(root);
  assert.equal(baseline.status, 'invalid');
  const captured = baseline.files.find(file => file.path === point);
  assert.equal(captured.content, null);
  assert.equal(captured.rawBase64, broken.toString('base64'));
  assert.equal(captured.sha256, createHash('sha256').update(broken).digest('hex'));
  const plan = prepareChange(baseline, { reason: 'Repair malformed UTF-8', changes: [{ path: point, content: original }] });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.changes[0].before, null);
  assert.equal(plan.changes[0].beforeBase64, broken.toString('base64'));
  const saved = await saveDraft(root, { plan });
  const loaded = await loadDraft(root, saved.id);
  assert.equal(loaded.plan.changes[0].beforeBase64, broken.toString('base64'));
  const otherBroken = Buffer.concat([Buffer.from(original), Buffer.from([0xfe, 0xff])]);
  await fs.writeFile(path.join(root, point), otherBroken);
  assert.notEqual((await openAtlas(root)).identity, baseline.identity);
  await assert.rejects(applyDraft(root, saved.id, { expectedRevision: saved.revision }), { code: 'STALE' });
  assert.deepEqual(await fs.readFile(path.join(root, point)), otherBroken);
  await fs.writeFile(path.join(root, point), broken);
  assert.equal((await applyDraft(root, saved.id, { expectedRevision: saved.revision })).status, 'complete');
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), original);
});

test('interrupted raw repair recovers invalid original bytes and preserves foreign changes', async t => {
  const root = await fixture(t);
  const original = await fs.readFile(path.join(root, point), 'utf8');
  const broken = Buffer.concat([Buffer.from([0xff]), Buffer.from(original)]);
  await fs.writeFile(path.join(root, point), broken);
  const baseline = await openAtlas(root), second = 'trees/architecture/points/sync.md';
  const plan = prepareChange(baseline, { reason: 'Repair and qualify', changes: [
    { path: point, content: original },
    { path: second, content: baseline.files.find(file => file.path === second).content + '\nReviewed.\n' },
  ] });
  const applied = await applyChange(root, plan, { onProgress(progress) { if (progress.written.length === 1) throw new Error('Interrupted after raw repair.'); } });
  assert.equal(applied.status, 'interrupted');
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), original);
  await fs.appendFile(path.join(root, second), '\nForeign edit.\n');
  await assert.rejects(recoverChange(root, applied.transaction), { code: 'RECOVERY_CONFLICT' });
  await fs.writeFile(path.join(root, second), baseline.files.find(file => file.path === second).content);
  const restarted = await import(`../src/authoring.mjs?raw-restart=${Date.now()}`);
  const recovered = await restarted.recoverChange(root, applied.transaction);
  assert.equal(recovered.baselineRestored, true);
  assert.deepEqual(await fs.readFile(path.join(root, point)), broken);
  assert.equal((await openAtlas(root)).identity, baseline.identity);
});

test('unrepaired raw files keep candidates invalid, and raw deletions are explicit', async t => {
  const root = await fixture(t);
  const extra = 'trees/product/points/broken.md', bytes = Buffer.from([0xff]);
  await fs.writeFile(path.join(root, extra), bytes);
  const baseline = await openAtlas(root);
  assert.equal(edit(baseline).status, 'invalid');
  const deletion = prepareChange(baseline, { reason: 'Remove corrupted unplaced record', changes: [{ path: extra, content: null }] });
  assert.equal(deletion.status, 'ready');
  assert.equal(deletion.changes[0].beforeBase64, bytes.toString('base64'));
  assert.equal((await applyChange(root, deletion)).status, 'complete');
  await assert.rejects(fs.stat(path.join(root, extra)), { code: 'ENOENT' });
});
