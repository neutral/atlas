import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openAtlas, validateFiles } from '../src/model.mjs';
import { resolveState } from '../src/state.mjs';
import { getStyle, listStyles } from '../src/styles.mjs';
import { summarizeDraft } from '../src/inventory.mjs';
import { prepareChange, prepareChangeFromDisk, prepareInitialization, inspectChange, applyDraft, applyBlocker, listTransactions, recoverChange, saveDraft, loadDraft, listDrafts, deleteDraft } from '../src/authoring.mjs';

/** Applying takes a saved draft and its exact revision: a plan is saved, then applied as a draft. */
async function applyPlan(root, plan, options = {}) {
  const draft = await saveDraft(root, { plan });
  return applyDraft(root, draft.id, { expectedRevision: draft.revision, ...options });
}

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
const check = id => `---\n{"id":"${id}","status":"draft","level":"advisory"}\n---\n# ${id}\n\n## Requirement\n\nA.\n\n## Verification\n\nB.\n\n## Failure\n\nC.\n`;
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
  const result = await applyPlan(root, plan);
  assert.equal(result.status, 'complete');
  assert.equal((await openAtlas(root)).identity, plan.candidate.identity);
  const current = await openAtlas(root);
  const noop = prepareChange(current, { reason: 'Already represented', changes: [{ path: point, content: plan.changes[0].after }] });
  assert.equal((await applyPlan(root, noop)).status, 'noop');
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] }, 'a completed apply removes its journal');
});

test('stale unrelated authored content refuses all writes', async t => {
  const root = await fixture(t);
  const before = await openAtlas(root);
  const plan = edit(before);
  await fs.appendFile(path.join(root, 'trees/architecture/points/sync.md'), '\nExternal correction.\n');
  await assert.rejects(applyPlan(root, plan), { code: 'STALE' });
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), plan.changes[0].before);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
});

test('forged candidate and paths grant no apply authority', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  assert.throws(() => prepareChange(view, { reason: 'Escape', changes: [{ path: '../outside', content: 'bad' }] }), { code: 'UNSAFE_PATH' });
  assert.throws(() => prepareChange(view, { reason: 'Source rewrite', changes: [{ path: 'sources/brief.md', content: 'bad' }] }), { code: 'UNSAFE_PATH' });
  const forged = edit(view);
  forged.changes[0].after = 'not a Point';
  forged.candidate = view;
  await assert.rejects(applyPlan(root, forged), { code: 'INVALID_CANDIDATE' });
  assert.equal((await openAtlas(root)).identity, view.identity);
});

test('a change request is its file changes and a reason; a plan carries nothing else', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const changes = [{ path: point, content: view.files.find(f => f.path === point).content + '\nQualified.\n' }];
  for (const extra of [{ approved: true }, { candidate: {} }, { baseline: view.identity }]) assert.throws(() => prepareChange(view, { reason: 'Unknown field', changes, ...extra }), { code: 'INVALID_REQUEST' });
  assert.throws(() => prepareChange(view, { changes }), { code: 'INVALID_REQUEST' });
  assert.throws(() => prepareChange(view, { reason: ' ', changes }), { code: 'INVALID_REQUEST' });
  assert.throws(() => prepareChange(view, { reason: 'Too many', changes: Array.from({ length: 1001 }, (_, index) => ({ path: `trees/product/points/p${index}.md`, content: 'x' })) }), { code: 'INVALID_REQUEST' });
  const plan = prepareChange(view, { reason: 'Qualify the promise', changes });
  assert.deepEqual(Object.keys(plan), ['format', 'status', 'reason', 'baseline', 'changes', 'validation', 'observedFiles', 'candidate']);
  assert.deepEqual([plan.format, plan.status, plan.observedFiles], ['atlas.change/1', 'ready', []]);
  assert.deepEqual(Object.keys(await saveDraft(root, { plan })), ['format', 'id', 'updatedAt', 'plan', 'revision']);
});

test('the Style changes alone: a change that alters it with another file is invalid, inspectable and never applied', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const policy = view.files.find(file => file.path === 'style.md').content;
  const convention = { path: 'style.md', content: policy + '\n## Conventions\n\nMark what no source states.\n' };
  const check = { path: '.checks/removals.md', content: '---\n{"id":"removals","status":"active","level":"required"}\n---\n# Account for removals\n\n## Requirement\n\nName what was removed.\n\n## Verification\n\nRead the reason.\n\n## Failure\n\nReturn the change.\n' };
  const rule = { code: 'STYLE_CHANGE_ALONE', path: 'style.md', message: 'A change that alters the Style alters no other file. Prepare the Style change and the other changes separately.' };

  const mixed = prepareChange(view, { reason: 'Add a convention and a Check', changes: [convention, check] });
  assert.equal(mixed.status, 'invalid');
  assert.deepEqual(mixed.validation, { status: 'invalid', identity: mixed.candidate.identity, diagnostics: [rule] });
  // The candidate is a valid Atlas by itself; it is the change that breaks the rule.
  assert.deepEqual([mixed.candidate.status, mixed.candidate.diagnostics], ['ready', []]);
  assert.deepEqual(mixed.changes.map(change => change.path), ['style.md', '.checks/removals.md']);
  const sides = inspectChange(mixed);
  assert.deepEqual([sides.before.identity, sides.after.identity], [view.identity, mixed.candidate.identity]);
  await assert.rejects(applyPlan(root, mixed), { code: 'INVALID_CANDIDATE', message: rule.message });
  // A plan that claims another status for the same changes is no plan, and gains nothing at apply.
  const forged = { ...mixed, status: 'ready', validation: { ...mixed.validation, status: 'ready', diagnostics: [] } };
  assert.throws(() => inspectChange(forged), { code: 'INVALID_PLAN' });
  await assert.rejects(applyPlan(root, forged), { code: 'INVALID_CANDIDATE' });
  const draft = await saveDraft(root, { plan: mixed });
  assert.deepEqual((await loadDraft(root, draft.id)).plan.validation.diagnostics, [rule]);
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code: 'INVALID_CANDIDATE' });
  assert.equal((await openAtlas(root)).identity, view.identity);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
  const disk = await prepareChangeFromDisk(root, { reason: 'Add a convention and qualify a promise', changes: [convention, { path: point, content: view.files.find(file => file.path === point).content + '\nQualified.\n' }] });
  assert.deepEqual([disk.status, disk.validation.diagnostics], ['invalid', [rule]]);

  // Each part is ready by itself. A file listed with the bytes it already has is not altered.
  const revised = prepareChange(view, { reason: 'Add a convention', changes: [convention, { path: point, content: view.files.find(file => file.path === point).content }] });
  assert.deepEqual([revised.status, revised.validation.diagnostics, revised.changes.map(change => change.path)], ['ready', [], ['style.md']]);
  assert.ok(revised.candidate.atlas.style.body.endsWith('Mark what no source states.'));
  assert.equal((await applyPlan(root, revised)).status, 'complete');
  const added = prepareChange(await openAtlas(root), { reason: 'Add a Check', changes: [check] });
  assert.equal(added.status, 'ready', JSON.stringify(added.validation.diagnostics));
  assert.equal((await applyPlan(root, added)).status, 'complete');
  const current = await openAtlas(root);
  assert.equal(current.atlas.checks[0].id, 'removals');

  // An Atlas cannot lose its Style, alone or with another change.
  const removed = prepareChange(current, { reason: 'Drop the policy', changes: [{ path: 'style.md', content: null }] });
  assert.equal(removed.status, 'invalid');
  assert.deepEqual(removed.validation.diagnostics.map(item => item.code), ['STYLE_REQUIRED']);
  await assert.rejects(applyPlan(root, removed), { code: 'INVALID_CANDIDATE', message: 'Candidate Atlas is invalid.' });
  const emptied = prepareChange(current, { reason: 'Drop the policy and the Check', changes: [{ path: 'style.md', content: null }, { path: check.path, content: null }] });
  assert.deepEqual([emptied.status, emptied.validation.diagnostics.map(item => item.code)], ['invalid', ['STYLE_CHANGE_ALONE', 'STYLE_REQUIRED']]);
  const headed = prepareChange(current, { reason: 'A headed policy', changes: [{ path: 'style.md', content: `---\n{"id":"custom","revision":"2"}\n---\n${policy}` }] });
  assert.deepEqual(headed.validation.diagnostics.map(item => item.code), ['MARKDOWN_HEADER']);
  assert.throws(() => prepareChange(current, { reason: 'Another policy file', changes: [{ path: 'policy.md', content: policy }] }), { code: 'UNSAFE_PATH' });
  assert.equal((await openAtlas(root)).identity, current.identity);
});

test('a Style that does not validate is repaired together with other files, and the repaired Style then changes alone', async t => {
  const root = await fixture(t);
  const policy = await fs.readFile(path.join(root, 'style.md'), 'utf8');
  const promise = await fs.readFile(path.join(root, point), 'utf8');
  // A JSON header left from an earlier format, and a Point that no longer parses.
  await fs.writeFile(path.join(root, 'style.md'), `---\n{"id":"custom","revision":"2"}\n---\n${policy}`);
  await fs.writeFile(path.join(root, point), promise.replace('---\n{', '---\n{,'));
  const broken = await openAtlas(root);
  assert.equal(broken.status, 'invalid');
  assert.deepEqual(broken.diagnostics.filter(item => [point, 'style.md'].includes(item.path)).map(item => [item.path, item.code]), [['style.md', 'MARKDOWN_HEADER'], [point, 'JSON_SYNTAX']]);
  // Each repair alone leaves the other file broken; together they make the Atlas whole.
  const styleOnly = prepareChange(broken, { reason: 'Repair the Style', changes: [{ path: 'style.md', content: policy }] });
  assert.equal(styleOnly.status, 'invalid');
  assert.ok(!styleOnly.validation.diagnostics.some(item => item.code === 'STYLE_CHANGE_ALONE'));
  const repair = prepareChange(broken, { reason: 'Repair the Style and the Point', changes: [{ path: 'style.md', content: policy }, { path: point, content: promise }] });
  assert.deepEqual([repair.status, repair.validation.diagnostics], ['ready', []]);
  assert.equal(inspectChange(repair).after.identity, repair.candidate.identity);
  const draft = await saveDraft(root, { plan: repair });
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
  const whole = await openAtlas(root);
  assert.equal(whole.status, 'ready', JSON.stringify(whole.diagnostics));
  // Over a valid Style the rule binds again.
  const mixed = prepareChange(whole, { reason: 'Both again', changes: [{ path: 'style.md', content: `${policy}\nOne more convention.\n` }, { path: point, content: `${promise}\nQualified.\n` }] });
  assert.deepEqual([mixed.status, mixed.validation.diagnostics.map(item => item.code)], ['invalid', ['STYLE_CHANGE_ALONE']]);
  // A Style that is blank or not UTF-8 text does not validate either.
  for (const content of ['  \n', Buffer.from([0xff, 0xfe, 0x23])]) {
    await fs.writeFile(path.join(root, 'style.md'), content);
    const view = await openAtlas(root);
    assert.equal(prepareChange(view, { reason: 'Repair both', changes: [{ path: 'style.md', content: policy }, { path: point, content: `${promise}\nQualified.\n` }] }).status, 'ready');
  }
});

test('symlink replacement is refused without touching its target', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const plan = edit(view);
  const target = path.join(root, 'sources/brief.md');
  const original = await fs.readFile(target, 'utf8');
  await fs.unlink(path.join(root, point));
  await fs.symlink(target, path.join(root, point));
  await assert.rejects(applyPlan(root, plan));
  assert.equal(await fs.readFile(target, 'utf8'), original);
});

test('interrupted multi-file apply survives restart and guarded recovery restores bytes', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const files = [point, 'trees/architecture/points/sync.md'];
  const plan = prepareChange(view, { reason: 'Two related clarifications', changes: files.map(file => ({ path: file, content: view.files.find(f => f.path === file).content + '\nReview required.\n' })) });
  const planFile = path.join(root, 'plan.json');
  await fs.writeFile(planFile, JSON.stringify(plan));
  const script = `import { readFile } from 'node:fs/promises'; import { saveDraft, applyDraft } from ${JSON.stringify(new URL('../src/authoring.mjs', import.meta.url).href)}; const plan=JSON.parse(await readFile(process.argv[2],'utf8')); const draft=await saveDraft(process.argv[1],{plan}); await applyDraft(process.argv[1],draft.id,{expectedRevision:draft.revision,onProgress(p){ if(p.written.length===1) process.kill(process.pid,'SIGKILL'); }});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, planFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  const result = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(result.signal, 'SIGKILL', stderr);
  const [transaction] = (await listTransactions(root)).transactions;
  assert.equal(transaction.phase, 'applying');
  assert.equal(transaction.written.length, 1);
  await assert.rejects(applyPlan(root, plan), { code: 'LOCKED' });
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
  const applied = await applyPlan(root, plan, { onProgress(progress) { if (progress.written.length === 1) throw new Error('Injected I/O failure'); } });
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
  assert.equal((await listDrafts(root)).drafts[0].baseline, view.identity);
  await fs.appendFile(path.join(root, point), '\nOther author.\n');
  await assert.rejects(applyDraft(root, saved.id, { expectedRevision: saved.revision }), { code: 'STALE' });
  await deleteDraft(root, saved.id, { expectedRevision: saved.revision });
  assert.deepEqual(await listDrafts(root), { drafts: [], unreadable: [] });
});

test('saved draft revisions bind edits, review, apply and deletion to exact content', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const reviewed = await saveDraft(root, { id: 'reviewed', plan: edit(baseline, '\nReviewed change.\n') });
  const alternate = edit(baseline, '\nAnother author changed the draft.\n');
  await assert.rejects(saveDraft(root, { id: reviewed.id, plan: alternate }), { code: 'STALE_DRAFT' });
  const revised = await saveDraft(root, { id: reviewed.id, plan: alternate, expectedRevision: reviewed.revision });
  assert.notEqual(revised.revision, reviewed.revision);
  assert.equal((await listDrafts(root)).drafts[0].revision, revised.revision);
  await assert.rejects(saveDraft(root, { id: reviewed.id, plan: reviewed.plan, expectedRevision: reviewed.revision }), { code: 'STALE_DRAFT' });
  // A revision the draft is not at is refused for what it is, whether the draft changed since or the revision was mistyped.
  for (const expectedRevision of [reviewed.revision, 'a'.repeat(64)]) {
    await assert.rejects(applyDraft(root, reviewed.id, { expectedRevision }), { code: 'STALE_DRAFT', message: 'The draft is not at that revision; review it and give its exact revision.' });
  }
  await assert.rejects(applyDraft(root, reviewed.id), { code: 'STALE_DRAFT' });
  await assert.rejects(deleteDraft(root, reviewed.id, { expectedRevision: reviewed.revision }), { code: 'STALE_DRAFT', message: 'The draft is not at that revision; load it and give its exact revision.' });
  assert.equal((await openAtlas(root)).identity, baseline.identity);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
  const applied = await applyDraft(root, revised.id, { expectedRevision: revised.revision });
  assert.deepEqual([applied.status, applied.draft], ['complete', 'removed']);
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), alternate.changes[0].after);
  assert.deepEqual(await listDrafts(root), { drafts: [], unreadable: [] }, 'a completed apply removes its draft');
  await assert.rejects(loadDraft(root, revised.id), { code: 'NOT_FOUND' });
});

test('an interrupted apply keeps its draft beside its journal, and a noop apply keeps it as it was', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const interrupted = await applyDraft(root, draft.id, { expectedRevision: draft.revision, onProgress(progress) { if (progress.written.length === 1) throw new Error('Injected I/O failure'); } });
  assert.deepEqual([interrupted.status, interrupted.draft], ['interrupted', 'kept']);
  assert.deepEqual((await listDrafts(root)).drafts.map(item => item.id), [draft.id]);
  assert.deepEqual((await listTransactions(root)).transactions.map(item => [item.id, item.phase]), [[interrupted.transaction, 'interrupted']]);
  // Until recovery the Atlas takes no apply, not even of the kept draft.
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code: 'LOCKED', message: `Interrupted transaction ${interrupted.transaction} needs recovery.` });
  assert.equal((await recoverChange(root, interrupted.transaction)).baselineRestored, true);
  assert.equal((await loadDraft(root, draft.id)).revision, draft.revision, 'after recovery the draft is still there to apply');
  const nothing = await saveDraft(root, { plan: prepareChange(baseline, { reason: 'Nothing to change.', changes: [] }) });
  const noop = await applyDraft(root, nothing.id, { expectedRevision: nothing.revision });
  assert.deepEqual([noop.status, noop.draft], ['noop', 'kept']);
  assert.deepEqual((await listDrafts(root)).drafts.map(item => item.id).sort(), [draft.id, nothing.id].sort());
  const completed = await applyDraft(root, draft.id, { expectedRevision: draft.revision });
  assert.deepEqual([completed.status, completed.draft], ['complete', 'removed']);
  assert.deepEqual((await listDrafts(root)).drafts.map(item => item.id), [nothing.id]);
});

test('an apply interrupted before its first write bars every later apply until recovery, which restores nothing, and the draft then applies', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const other = await saveDraft(root, { plan: prepareChange(baseline, { reason: 'Another change', changes: [{ path: 'trees/architecture/points/sync.md', content: `${baseline.files.find(file => file.path === 'trees/architecture/points/sync.md').content}\nAnother change.\n` }] }) });
  const interrupted = await applyDraft(root, draft.id, { expectedRevision: draft.revision, onProgress(progress) { if (progress.phase === 'prepared') throw Object.assign(new Error('Injected refusal before the first write.'), { code: 'EACCES' }); } });
  assert.deepEqual([interrupted.status, interrupted.written, interrupted.error.code, interrupted.draft], ['interrupted', [], 'EACCES', 'kept']);
  // Applying again before recovery would let recovery undo that apply afterwards; so would any other draft.
  for (const saved of [draft, other]) {
    await assert.rejects(applyDraft(root, saved.id, { expectedRevision: saved.revision }), { code: 'LOCKED', message: `Interrupted transaction ${interrupted.transaction} needs recovery.` });
  }
  assert.equal((await openAtlas(root)).identity, baseline.identity);
  assert.deepEqual((await listTransactions(root)).transactions.map(item => [item.id, item.phase]), [[interrupted.transaction, 'interrupted']]);
  const recovered = await recoverChange(root, interrupted.transaction);
  assert.deepEqual([recovered.status, recovered.identity, recovered.baselineRestored], ['rolled-back', baseline.identity, true]);
  // A journal is kept only while its transaction is unfinished: the rolled-back one is gone.
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
  const applied = await applyDraft(root, draft.id, { expectedRevision: draft.revision });
  assert.deepEqual([applied.status, applied.draft], ['complete', 'removed']);
  assert.equal(await fs.readFile(path.join(root, point), 'utf8'), draft.plan.changes[0].after);
  // Recovering it again finds nothing and leaves the later apply as it is; so does recovering the completed apply.
  for (const transaction of [interrupted.transaction, applied.transaction]) await assert.rejects(recoverChange(root, transaction), { code: 'NOT_FOUND' });
  assert.equal((await openAtlas(root)).identity, draft.plan.candidate.identity);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
});

test('a rolled-back journal that cannot be removed stays rolled back, later applies pass it, and recovering it again removes it', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const interrupted = await applyDraft(root, draft.id, { expectedRevision: draft.revision, onProgress(progress) { if (progress.written.length === 1) throw new Error('Injected I/O failure'); } });
  const { directory } = await resolveState(root);
  const journal = path.join(directory, 'transactions', `${interrupted.transaction}.json`);
  const unlink = fs.unlink;
  t.mock.method(fs, 'unlink', async file => { if (file === journal) throw Object.assign(new Error('Injected removal failure'), { code: 'EACCES' }); return unlink(file); });
  assert.equal((await recoverChange(root, interrupted.transaction)).baselineRestored, true);
  t.mock.restoreAll();
  assert.deepEqual((await listTransactions(root)).transactions.map(item => [item.id, item.phase]), [[interrupted.transaction, 'rolled-back']]);
  const applied = await applyDraft(root, draft.id, { expectedRevision: draft.revision });
  assert.deepEqual([applied.status, applied.draft], ['complete', 'removed']);
  assert.deepEqual(await recoverChange(root, interrupted.transaction), { format: 'atlas.recovery/1', status: 'rolled-back', transaction: interrupted.transaction });
  assert.equal((await openAtlas(root)).identity, draft.plan.candidate.identity);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
  await assert.rejects(recoverChange(root, interrupted.transaction), { code: 'NOT_FOUND' });
});

test('a recovery that leaves the Atlas unreadable whole does not say the baseline is restored', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const interrupted = await applyDraft(root, draft.id, { expectedRevision: draft.revision, onProgress(progress) { if (progress.written.length === 1) throw new Error('Injected I/O failure'); } });
  // A directory past the reader's bound, with no file in it: the Atlas reads back at its baseline identity, but not whole.
  await fs.mkdir(path.join(root, '.checks', ...Array(65).fill('d')), { recursive: true });
  // The unfinished transaction stops the next apply first; once it is rolled back, the Atlas that does not read whole does.
  assert.deepEqual(await applyBlocker(root), { code: 'LOCKED', message: `Interrupted transaction ${interrupted.transaction} needs recovery.`, transaction: interrupted.transaction });
  const recovered = await recoverChange(root, interrupted.transaction);
  assert.deepEqual([recovered.identity, recovered.baselineRestored, recovered.diagnostics.map(item => item.code)], [baseline.identity, false, ['READ_LIMIT']]);
  const incomplete = { code: 'INCOMPLETE', message: 'Cannot apply against an incomplete read.' };
  assert.deepEqual(await applyBlocker(root), incomplete);
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), incomplete);
  // Removing the directory past the bound is all it takes: the same draft at the same revision then applies.
  await fs.rm(path.join(root, '.checks'), { recursive: true });
  assert.equal((await openAtlas(root)).status, 'ready');
  assert.equal(await applyBlocker(root), null);
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
});

test('a completed journal that cannot be removed stays complete, and later applies pass it', async t => {
  const root = await fixture(t);
  const { directory } = await resolveState(root, { create: true });
  const unlink = fs.unlink;
  t.mock.method(fs, 'unlink', async file => { if (file.startsWith(path.join(directory, 'transactions') + path.sep) && file.endsWith('.json')) throw Object.assign(new Error('Injected removal failure'), { code: 'EACCES' }); return unlink(file); });
  const first = await applyPlan(root, edit(await openAtlas(root)));
  assert.equal(first.status, 'complete');
  t.mock.restoreAll();
  assert.deepEqual((await listTransactions(root)).transactions.map(item => [item.id, item.phase]), [[first.transaction, 'complete']]);
  await assert.rejects(recoverChange(root, first.transaction), { code: 'ALREADY_COMPLETE' });
  const second = await applyPlan(root, edit(await openAtlas(root), '\nA second update.\n'));
  assert.equal(second.status, 'complete');
  assert.deepEqual((await listTransactions(root)).transactions.map(item => item.id), [first.transaction]);
});

test('a completed apply removes its draft before its journal, so a crash between them leaves a complete journal and no draft', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  // The process dies as soon as the completed apply has removed its first saved file.
  const script = `import { promises as fs } from 'node:fs'; import { applyDraft } from ${JSON.stringify(new URL('../src/authoring.mjs', import.meta.url).href)}; const unlink = fs.unlink; fs.unlink = async (file, ...rest) => { const result = await unlink(file, ...rest); if (/[\\\\/](drafts|transactions)[\\\\/][^\\\\/]+\\.json$/.test(String(file))) process.kill(process.pid, 'SIGKILL'); return result; }; await applyDraft(process.argv[1], process.argv[2], { expectedRevision: process.argv[3] });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, draft.id, draft.revision], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  const result = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(result.signal, 'SIGKILL', stderr);
  assert.equal((await openAtlas(root)).identity, draft.plan.candidate.identity);
  // The draft is gone and the journal says the change was applied; the gate passes it, and recovery has nothing to undo.
  assert.deepEqual(await listDrafts(root), { drafts: [], unreadable: [] });
  const [transaction] = (await listTransactions(root)).transactions;
  assert.equal(transaction.phase, 'complete');
  assert.equal(await applyBlocker(root), null);
  await assert.rejects(recoverChange(root, transaction.id), { code: 'ALREADY_COMPLETE' });
  const other = await saveDraft(root, { plan: edit(await openAtlas(root), '\nAnother change.\n') });
  const later = await applyDraft(root, other.id, { expectedRevision: other.revision });
  assert.deepEqual([later.status, later.draft], ['complete', 'removed']);
  assert.deepEqual((await listTransactions(root)).transactions.map(item => [item.id, item.phase]), [[transaction.id, 'complete']]);
});

test('a transaction journal that cannot be read is not known to have finished, and bars applying', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const draft = await saveDraft(root, { plan: edit(baseline) });
  const { directory } = await resolveState(root);
  await fs.mkdir(path.join(directory, 'transactions'));
  const journal = path.join(directory, 'transactions/damaged.json');
  // The apply gate is applyBlocker's answer: each refusal below is the one it gives.
  const blocked = async (code, message, label) => {
    assert.deepEqual(await applyBlocker(root), { code, message, transaction: 'damaged' }, label);
    await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code, message }, label);
  };
  const malformed = 'Transaction journal damaged cannot be read: Saved state is malformed.';
  for (const contents of ['{', Buffer.from('{"format":"atlas.transaction/1","id":"damaged","note":"\xff"}', 'latin1')]) {
    await fs.writeFile(journal, contents);
    await blocked('INVALID_STATE', malformed, String(contents));
    assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [{ file: 'damaged.json', code: 'INVALID_STATE', message: 'Saved state is malformed.' }] });
  }
  // A journal is whole: in a phase a transaction has, with the summary fields, each change in its shape, once, and what was written among them.
  const whole = { format: 'atlas.transaction/1', id: 'damaged', phase: 'interrupted', createdAt: '2026-11-15T00:00:00.000Z', baseline: baseline.identity, result: baseline.identity,
    changes: [{ path: point, before: 'Before.', after: 'After.' }], written: [point], error: { code: 'EIO', message: 'Injected.' } };
  const { createdAt, baseline: _, result, ...missing } = whole;
  for (const contents of [null, [], { ...whole, id: 'other' }, { format: 'atlas.transaction/1', id: 'damaged', phase: 'complete' }, missing,
    { ...whole, changes: [{}] }, { ...whole, changes: [null] }, { ...whole, phase: 'unknown' }, { ...whole, baseline: 'not-an-identity' }, { ...whole, extra: true },
    { ...whole, changes: [{ path: '../outside.md', before: null, after: 'x' }], written: [] }, { ...whole, changes: [...whole.changes, ...whole.changes] },
    { ...whole, changes: [{ path: point, before: 'Before.', beforeBase64: '/w==', after: null }] }, { ...whole, written: ['trees/product/points/other.md'] },
    { ...whole, error: { code: 'EIO' } }]) {
    await fs.writeFile(journal, JSON.stringify(contents));
    await blocked('INVALID_STATE', 'Invalid transaction journal: damaged.', JSON.stringify(contents));
    assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [{ file: 'damaged.json', code: 'INVALID_STATE', message: 'Invalid transaction journal.' }] }, JSON.stringify(contents));
    await assert.rejects(recoverChange(root, 'damaged'), { code: 'INVALID_STATE', message: 'Invalid transaction journal.' }, JSON.stringify(contents));
  }
  // A whole journal of an unfinished transaction is one recovery takes, and the listing shows it beside what it cannot read.
  await fs.writeFile(journal, JSON.stringify(whole));
  await fs.writeFile(path.join(directory, 'transactions/broken.json'), '{');
  assert.deepEqual(await applyBlocker(root), { code: 'INVALID_STATE', message: 'Transaction journal broken cannot be read: Saved state is malformed.', transaction: 'broken' });
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code: 'INVALID_STATE', message: 'Transaction journal broken cannot be read: Saved state is malformed.' });
  await fs.rm(path.join(directory, 'transactions/broken.json'));
  await blocked('LOCKED', 'Interrupted transaction damaged needs recovery.');
  // A file that no transaction identity names is no journal: applying passes it, and the listing names it.
  await fs.rename(journal, path.join(directory, 'transactions/Not A Journal.json'));
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [{ file: 'Not A Journal.json', code: 'INVALID_STATE', message: 'The file name is not a transaction identity.' }] });
  assert.equal(await applyBlocker(root), null);
  assert.equal((await openAtlas(root)).identity, baseline.identity);
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
  // A journal that reads is listed beside one that does not.
  await fs.writeFile(journal, JSON.stringify(whole));
  await fs.writeFile(path.join(directory, 'transactions/broken.json'), '{');
  assert.deepEqual(await listTransactions(root), {
    transactions: [{ id: 'damaged', phase: 'interrupted', createdAt: whole.createdAt, baseline: baseline.identity, result: baseline.identity, written: [point], error: whole.error }],
    unreadable: [{ file: 'Not A Journal.json', code: 'INVALID_STATE', message: 'The file name is not a transaction identity.' }, { file: 'broken.json', code: 'INVALID_STATE', message: 'Saved state is malformed.' }],
  });
  // A finished journal stops nothing, and an Atlas without transactions has nothing to stop.
  await fs.rm(path.join(directory, 'transactions/broken.json'));
  await fs.writeFile(journal, JSON.stringify({ ...whole, phase: 'complete' }));
  assert.equal(await applyBlocker(root), null);
  await fs.rm(path.join(directory, 'transactions'), { recursive: true });
  assert.equal(await applyBlocker(root), null);
});

test('applyBlocker refuses as the private state refuses, and names the folder that holds too many journals', async t => {
  const root = await fixture(t);
  const { directory } = await resolveState(root, { create: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'transactions'));
  const fill = async extension => {
    for (let start = 0; start < 10001; start += 250) {
      await Promise.all(Array.from({ length: Math.min(250, 10001 - start) }, (_, index) => fs.writeFile(path.join(directory, 'transactions', `n${start + index}${extension}`), '')));
    }
  };
  // The bound counts the records the gate and the listing read: files that are not .json records count for nothing.
  await fill('.txt');
  assert.equal(await applyBlocker(root), null);
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
  await fill('.json');
  assert.deepEqual(await applyBlocker(root), { code: 'LIMIT_EXCEEDED', message: 'Too many saved records.' });
  await assert.rejects(applyPlan(root, edit(await openAtlas(root))), { code: 'LIMIT_EXCEEDED', message: 'Too many saved records.' });
  await fs.writeFile(path.join(directory, 'owner.json'), '{');
  await assert.rejects(applyBlocker(root), { code: 'STATE_OWNER' });
  await assert.rejects(applyBlocker(path.join(root, 'absent')), { code: 'ENOENT' });
});

test('a changed file over the format\'s 2 MiB bound is refused before any draft exists', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const content = view.files.find(file => file.path === point).content;
  const padded = bytes => content + 'x'.repeat(bytes - Buffer.byteLength(content));
  assert.throws(() => prepareChange(view, { reason: 'Too large', changes: [{ path: point, content: padded(2097153) }] }), { code: 'LIMIT_EXCEEDED', message: 'A changed file exceeds 2 MiB (2097152 bytes).' });
  await assert.rejects(prepareChangeFromDisk(root, { reason: 'Too large', changes: [{ path: point, content: padded(2097153) }] }), { code: 'LIMIT_EXCEEDED' });
  assert.deepEqual(await listDrafts(root), { drafts: [], unreadable: [] });
  // At the bound the file is captured whole: the plan is ready, saved, summarized and applied.
  const plan = prepareChange(view, { reason: 'At the bound', changes: [{ path: point, content: padded(2097152) }] });
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  const draft = await saveDraft(root, { plan });
  assert.equal(summarizeDraft(draft).plan.status, 'ready');
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
});

test('a change is refused, before any draft exists, when a reader would not read back what it writes', async t => {
  const root = await fixture(t);
  const view = await openAtlas(root);
  const content = view.files.find(file => file.path === point).content;
  const refused = (changes, diagnostics, message) => assert.throws(() => prepareChange(view, { reason: 'Refused.', changes }), error =>
    error.code === 'INVALID_REQUEST' && error.message === message && JSON.stringify(error.diagnostics) === JSON.stringify(diagnostics));
  // A path that only case or Unicode form tells apart from a captured one.
  refused([{ path: 'trees/product/points/Promise.md', content }],
    [{ code: 'PATH_ALIAS', path: 'trees/product/points/Promise.md', message: `Authored path component aliases ${point} under case or Unicode normalization.` }],
    'The change writes what a reader would not read back: trees/product/points/Promise.md (PATH_ALIAS).');
  // Text that is not well-formed Unicode.
  refused([{ path: point, content: `${content}\ud800` }],
    [{ code: 'FILE_UNICODE', path: point, message: 'Captured content contains an unpaired Unicode surrogate.' }],
    `The change writes what a reader would not read back: ${point} (FILE_UNICODE).`);
  // A path readers refuse is refused as a path, whatever else the change holds: an unpaired surrogate is no file name.
  for (const file of ['trees/product/points/a:b.md', 'trees/product/points/a#b.md', 'trees/product/points/a?b.md', 'trees/product/points/a\x7fb.md', 'trees/product/points/.Atlas-state/a.md', '.checks/\ud800.md', '.checks/a\udc00b.md']) {
    assert.throws(() => prepareChange(view, { reason: 'Refused.', changes: [{ path: file, content }] }), { code: 'UNSAFE_PATH', message: 'A change needs a normalized relative record path.' }, file);
  }
  await assert.rejects(prepareChangeFromDisk(root, { reason: 'Refused.', changes: [{ path: 'trees/product/points/Promise.md', content }] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(prepareChangeFromDisk(root, { reason: 'Refused.', changes: [{ path: '.checks/\ud800.md', content }] }), { code: 'UNSAFE_PATH' });
  assert.equal(prepareChange(view, { reason: 'A paired surrogate is a character.', changes: [{ path: '.checks/😀.md', content: check('emoji') }] }).status, 'ready');
  // A file and a directory cannot share a path: both are named, in either order, and also where the Atlas holds the file.
  for (const changes of [[{ path: '.checks/parent.md', content: check('parent') }, { path: '.checks/parent.md/child.md', content: check('child') }], [{ path: '.checks/parent.md/child.md', content: check('child') }, { path: '.checks/parent.md', content: check('parent') }]]) {
    refused(changes, [], 'The change writes what a reader would not read back: .checks/parent.md, .checks/parent.md/child.md.');
  }
  refused([{ path: `${point}/detail.md`, content }], [], `The change writes what a reader would not read back: ${point}, ${point}/detail.md.`);
  // A reader reads 64 directory levels below .checks/, points/ and facets/, and no deeper.
  const deep = level => `${'d/'.repeat(level)}audit.md`;
  for (const folder of ['.checks', 'trees/product/points']) {
    const past = `${folder}/${'d/'.repeat(65).slice(0, -1)}`;
    refused([{ path: `${folder}/${deep(65)}`, content: check('audit') }], [{ code: 'READ_LIMIT', path: past, message: 'Directory depth exceeds 64.' }], `The change writes what a reader would not read back: ${past} (READ_LIMIT).`);
  }
  assert.equal(prepareChange(view, { reason: 'At the bound.', changes: [{ path: `.checks/${deep(64)}`, content: check('audit') }] }).status, 'ready');
  // A reader lists 40000 directory entries in all: 625 Checks 64 levels deep need 40625, and 615 need 39975.
  const many = count => Array.from({ length: count }, (_, index) => ({ path: `.checks/b${String(index).padStart(4, '0')}/${deep(63)}`, content: check(`audit-${index}`) }));
  assert.throws(() => prepareChange(view, { reason: 'Past the entry bound.', changes: many(625) }), error => error.code === 'INVALID_REQUEST' &&
    error.message.startsWith(`The change writes what a reader would not read back: .checks/b0615/${'d/'.repeat(7).slice(0, -1)} (READ_LIMIT), .checks/b0616 (READ_LIMIT)`) &&
    error.diagnostics.length === 10 && error.diagnostics.every(item => item.code === 'READ_LIMIT' && item.message === 'Authored directory traversal exceeds its entry bound.'));
  assert.equal(prepareChange(view, { reason: 'Within the entry bound.', changes: many(615) }).status, 'ready');
  await assert.rejects(prepareChangeFromDisk(root, { reason: 'Refused.', changes: [{ path: `.checks/${deep(65)}`, content: check('audit') }] }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(await listDrafts(root), { drafts: [], unreadable: [] });
});

test('the read-back of deep paths does work bounded by the reader\'s bounds, not by the paths: 1000 deep changes are refused within a 256 MiB heap', async () => {
  const script = `import { validateFiles } from ${JSON.stringify(new URL('../src/model.mjs', import.meta.url).href)}; import { prepareChange } from ${JSON.stringify(new URL('../src/authoring.mjs', import.meta.url).href)};
    const view = validateFiles(new Map([['atlas.json', JSON.stringify({ format: 'atlas/1.2', id: 'small', title: 'Small', trees: [] })], ['style.md', '# Style\\n\\nWrite clearly.\\n']]));
    const changes = Array.from({ length: 1000 }, (_, index) => ({ path: '.checks/b' + String(index).padStart(4, '0') + '/' + 'd/'.repeat(450) + 'check.md', content: '# Check\\n' }));
    try { prepareChange(view, { reason: 'Deep paths.', changes }); console.log('prepared'); } catch (error) { console.log(JSON.stringify({ code: error.code, limits: error.diagnostics.every(item => item.code === 'READ_LIMIT') })); }`;
  const child = spawn(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const result = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.deepEqual([result.code, result.signal, JSON.parse(stdout)], [0, null, { code: 'INVALID_REQUEST', limits: true }], stderr);
});

test('a change is refused when the candidate it makes exceeds a reader\'s file count or byte total', () => {
  const manifest = ['atlas.json', JSON.stringify({ format: 'atlas/1.2', id: 'bounds', title: 'Bounds', trees: [] })];
  const check = '---\n{"id":"added","status":"draft","level":"advisory"}\n---\n# Added\n\n## Requirement\n\nA.\n\n## Verification\n\nB.\n\n## Failure\n\nC.\n';
  // 10000 files is the most a reader captures: one more leaves a file out.
  const many = validateFiles(new Map([manifest, ['style.md', '# Policy\n\nOne rule.\n'], ...Array.from({ length: 9998 }, (_, index) => [`notes/${index}.txt`, 'x'])]), { root: '/tmp/atlas-bounds' });
  assert.equal(many.files.length, 10000);
  assert.throws(() => prepareChange(many, { reason: 'One file too many.', changes: [{ path: '.checks/added.md', content: check }] }), error =>
    error.code === 'INVALID_REQUEST' && error.message === 'The change writes what a reader would not read back: Authored file count exceeds 10000 (READ_LIMIT).' &&
    JSON.stringify(error.diagnostics) === JSON.stringify([{ code: 'READ_LIMIT', path: '', message: 'Authored file count exceeds 10000.' }]));
  // 64 MiB is the most a reader captures in all; the file that crosses it is named.
  const block = 'x'.repeat(2 * 1024 * 1024);
  const large = validateFiles(new Map([manifest, ['style.md', '# Policy\n\nOne rule.\n'], ...Array.from({ length: 31 }, (_, index) => [`notes/${index}.txt`, block])]), { root: '/tmp/atlas-bounds' });
  assert.equal(large.status, 'invalid');
  assert.throws(() => prepareChange(large, { reason: 'Past the total.', changes: [{ path: '.checks/added.md', content: check + 'x'.repeat(2 * 1024 * 1024 - check.length) }] }), error =>
    error.code === 'INVALID_REQUEST' && error.message === 'The change writes what a reader would not read back: .checks/added.md (READ_LIMIT).' &&
    JSON.stringify(error.diagnostics) === JSON.stringify([{ code: 'READ_LIMIT', path: '.checks/added.md', message: 'Captured content exceeds 67108864 bytes.' }]));
  // Within both bounds a change is a plan.
  assert.equal(prepareChange(many, { reason: 'At the count.', changes: [{ path: 'style.md', content: '# Policy\n\nTwo rules.\n' }] }).candidate.files.length, 10000);
  assert.equal(prepareChange(large, { reason: 'Under the total.', changes: [{ path: '.checks/added.md', content: check }] }).candidate.status, 'invalid');
});

test('listing drafts reports each draft file that does not load by its name, and hides no draft that does', async t => {
  const root = await fixture(t);
  const baseline = await openAtlas(root);
  const good = await saveDraft(root, { id: 'good', plan: edit(baseline) });
  const later = await saveDraft(root, { id: 'later', plan: edit(baseline, '\nA later draft.\n') });
  const { directory } = await resolveState(root);
  const drafts = path.join(directory, 'drafts');
  await fs.writeFile(path.join(drafts, 'broken.json'), '{');
  const altered = JSON.parse(await fs.readFile(path.join(drafts, 'later.json'), 'utf8'));
  await fs.writeFile(path.join(drafts, 'moved.json'), JSON.stringify(altered));
  altered.plan.reason = 'Edited outside the Library.';
  await fs.writeFile(path.join(drafts, 'tampered.json'), JSON.stringify({ ...altered, id: 'tampered' }));
  await fs.writeFile(path.join(drafts, 'Not An Id.json'), JSON.stringify(good));
  await fs.writeFile(path.join(drafts, 'notes.txt'), 'Not a draft file.');
  // A byte that is not UTF-8 is malformed state, never a replacement character that the draft's own revision might match.
  const lossy = { ...good, id: 'lossy', plan: { ...good.plan, reason: 'Reason �' } };
  delete lossy.revision;
  lossy.revision = createHash('sha256').update(JSON.stringify(lossy)).digest('hex');
  const bytes = Buffer.from(JSON.stringify(lossy)), at = bytes.indexOf(Buffer.from('�'));
  await fs.writeFile(path.join(drafts, 'lossy.json'), Buffer.concat([bytes.subarray(0, at), Buffer.from([0xff]), bytes.subarray(at + 3)]));
  const listed = await listDrafts(root);
  assert.deepEqual(Object.keys(listed), ['drafts', 'unreadable']);
  assert.deepEqual(listed.drafts, [good, later].map(({ id, revision, updatedAt, plan }) => ({ id, revision, updatedAt, reason: plan.reason, status: plan.status, baseline: baseline.identity })));
  assert.deepEqual(listed.unreadable, [
    { file: 'Not An Id.json', code: 'INVALID_STATE', message: 'The file name is not a draft identity.' },
    { file: 'broken.json', code: 'INVALID_STATE', message: 'Saved state is malformed.' },
    { file: 'lossy.json', code: 'INVALID_STATE', message: 'Saved state is malformed.' },
    { file: 'moved.json', code: 'INVALID_STATE', message: 'Invalid draft.' },
    { file: 'tampered.json', code: 'INVALID_STATE', message: 'Saved draft integrity failed.' },
  ]);
  await assert.rejects(loadDraft(root, 'lossy'), { code: 'INVALID_STATE', message: 'Saved state is malformed.' });
  // A listed draft is one that loads; an unreadable one is refused as loading refuses it.
  for (const { id } of listed.drafts) assert.equal((await loadDraft(root, id)).id, id);
  await assert.rejects(loadDraft(root, 'broken'), { code: 'INVALID_STATE', message: 'Saved state is malformed.' });
  // A draft removed after the folder was read, as a completed apply removes it, is not listed at all.
  const readdir = fs.readdir;
  t.mock.method(fs, 'readdir', async (folder, ...options) => folder === drafts ? [...await readdir(folder, ...options), 'removed.json'] : readdir(folder, ...options));
  assert.deepEqual(await listDrafts(root), listed);
  t.mock.restoreAll();
  // A failure of the private state as a whole still refuses the listing.
  await fs.writeFile(path.join(directory, 'owner.json'), '{');
  await assert.rejects(listDrafts(root), { code: 'STATE_OWNER' });
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

test('a lock appears whole, so a competing writer never meets one without its metadata, and one whose metadata is gone is not taken over', async t => {
  for (const kind of ['draft', 'writer']) for (const window of ['before the lock is linked', 'after release']) {
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
        : applyPlan(root, plan);
      let reach, resume, owner, ownerLinking = true;
      const reached = new Promise(resolve => { reach = resolve; });
      const proceed = new Promise(resolve => { resume = resolve; });
      const link = fs.link;
      t.mock.method(fs, 'link', async (from, to) => {
        if (to !== lock) return link(from, to);
        if (ownerLinking) {
          ownerLinking = false;
          // The owner's metadata is written beside the lock: it pauses before linking it, or holding the lock it linked.
          if (window === 'before the lock is linked') { reach(); await proceed; return link(from, to); }
          await link(from, to); reach(); await proceed; return;
        }
        try { return await link(from, to); }
        catch (error) {
          // The contender has met the lock, and the owner releases it before the contender reads its metadata.
          if (error.code === 'EEXIST' && window === 'after release') { resume(); await owner.catch(() => {}); }
          throw error;
        }
      });
      owner = attempt(winnerPlan);
      try {
        await Promise.race([reached, owner.then(() => { throw new Error('The owner did not reach its lock.'); })]);
        if (window === 'before the lock is linked') {
          // There is no lock until it is whole: the contender takes the lock and writes, and the owner then finds what it would change changed.
          await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
          const contender = await attempt(contenderPlan);
          resume();
          await assert.rejects(owner, { code: kind === 'draft' ? 'STALE_DRAFT' : 'STALE' });
          if (kind === 'draft') assert.deepEqual((await loadDraft(root, draft.id)).plan, contenderPlan);
          else assert.deepEqual([contender.status, (await openAtlas(root)).identity], ['complete', contenderPlan.candidate.identity]);
        } else {
          await assert.rejects(attempt(contenderPlan), { code: 'LOCKED', message: 'Lock metadata is unavailable; another writer may be acquiring or releasing it.' });
          const result = await owner;
          if (kind === 'draft') {
            assert.equal((await loadDraft(root, draft.id)).revision, result.revision);
            assert.deepEqual((await loadDraft(root, draft.id)).plan, winnerPlan);
            assert.equal((await openAtlas(root)).identity, baseline.identity);
          } else {
            assert.equal(result.status, 'complete');
            assert.equal((await openAtlas(root)).identity, winnerPlan.candidate.identity);
            assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
          }
        }
      } finally {
        resume();
        await owner.catch(() => {});
        t.mock.restoreAll();
      }
      await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
    });
  }
});

test('a stopped writer\'s lock is taken over by one contender only: a live lock claimed in its place goes back, and its holder keeps it', async t => {
  for (const kind of ['draft', 'writer']) {
    await t.test(kind, async t => {
      const root = await fixture(t);
      const baseline = await openAtlas(root);
      const draft = await saveDraft(root, { id: 'contended', plan: edit(baseline) });
      const { directory } = await resolveState(root);
      const lock = path.join(directory, kind === 'draft' ? 'drafts/contended.lock' : 'lock.json');
      const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
      const dead = child.pid;
      await new Promise(resolve => child.once('exit', resolve));
      await fs.writeFile(lock, JSON.stringify(kind === 'draft' ? { pid: dead, token: 'stopped' } : { pid: dead, transaction: 'stopped' }));
      const attempt = plan => kind === 'draft' ? saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan }) : applyPlan(root, plan);
      const running = kind === 'draft' ? 'Another writer is using this draft.' : 'Another Atlas writer is running.';
      // Both contenders find the same stopped holder. The first pauses as it claims that lock; the second claims it, takes the lock, and pauses holding it.
      let reach, resume, hold, release;
      const reached = new Promise(resolve => { reach = resolve; }), proceed = new Promise(resolve => { resume = resolve; });
      const holding = new Promise(resolve => { hold = resolve; }), done = new Promise(resolve => { release = resolve; });
      const rename = fs.rename, link = fs.link;
      let claims = 0, links = 0;
      t.mock.method(fs, 'rename', async (from, to) => { if (from === lock && ++claims === 1) { reach(); await proceed; } return rename(from, to); });
      t.mock.method(fs, 'link', async (from, to) => { const result = await link(from, to); if (to === lock && ++links === 1) { hold(); await done; } return result; });
      const first = attempt(edit(baseline, '\nFirst contender.\n'));
      await reached;
      const second = attempt(edit(baseline, '\nSecond contender.\n'));
      await holding;
      const held = await fs.readFile(lock, 'utf8');
      assert.equal(JSON.parse(held).pid, process.pid);
      resume();
      // The first claims the live lock in place of the stopped one, puts it back as it was, and is refused.
      await assert.rejects(first, { code: 'LOCKED', message: running });
      assert.equal(await fs.readFile(lock, 'utf8'), held);
      release();
      const result = await second;
      t.mock.restoreAll();
      if (kind === 'draft') assert.deepEqual((await loadDraft(root, draft.id)).plan, edit(baseline, '\nSecond contender.\n'));
      else assert.deepEqual([result.status, (await openAtlas(root)).identity], ['complete', edit(baseline, '\nSecond contender.\n').candidate.identity]);
      await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
    });
  }
});

test('a writer whose lock is no longer its own refuses before it writes, and leaves the other lock where it is', async t => {
  for (const kind of ['draft', 'writer']) {
    await t.test(kind, async t => {
      const root = await fixture(t);
      const baseline = await openAtlas(root);
      const draft = await saveDraft(root, { id: 'replaced', plan: edit(baseline) });
      const { directory } = await resolveState(root);
      const lock = path.join(directory, kind === 'draft' ? 'drafts/replaced.lock' : 'lock.json');
      const other = JSON.stringify(kind === 'draft' ? { pid: process.pid, token: 'another' } : { pid: process.pid, transaction: 'another' });
      // Once the lock is taken, another writer's lock stands in its place.
      const link = fs.link;
      t.mock.method(fs, 'link', async (from, to) => { const result = await link(from, to); if (to === lock) await fs.writeFile(lock, other); return result; });
      const changed = { code: 'LOCKED', message: kind === 'draft' ? 'Draft lock changed.' : 'Writer lock changed.' };
      if (kind === 'draft') {
        await assert.rejects(saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan: edit(baseline, '\nUnsaved.\n') }), changed);
        t.mock.restoreAll();
        assert.deepEqual((await loadDraft(root, draft.id)).plan, draft.plan);
      } else {
        await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), changed);
        t.mock.restoreAll();
        assert.equal((await openAtlas(root)).identity, baseline.identity);
        assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
      }
      assert.equal(await fs.readFile(lock, 'utf8'), other);
    });
  }
});

test('a lock whose directory cannot be synced once it is linked is removed, and the draft then applies', async t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX permissions, which the superuser passes.');
  const root = await fixture(t);
  const draft = await saveDraft(root, { plan: edit(await openAtlas(root)) });
  const folder = path.join((await resolveState(root)).directory, 'drafts');
  // Writable and searchable, not readable: the lock is linked, and the directory cannot be opened to sync it.
  await fs.chmod(folder, 0o300);
  try { await assert.rejects(saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan: draft.plan }), { code: 'EACCES' }); }
  finally { await fs.chmod(folder, 0o700); }
  await assert.rejects(fs.stat(path.join(folder, `${draft.id}.lock`)), { code: 'ENOENT' });
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).status, 'complete');
});

test('temporary files beside the drafts count for nothing toward the listing\'s bound', async t => {
  const root = await fixture(t);
  const draft = await saveDraft(root, { plan: edit(await openAtlas(root)) });
  const folder = path.join((await resolveState(root)).directory, 'drafts');
  t.after(() => fs.rm(path.dirname(folder), { recursive: true, force: true }));
  for (let start = 0; start < 10001; start += 250) {
    await Promise.all(Array.from({ length: Math.min(250, 10001 - start) }, (_, index) => fs.writeFile(path.join(folder, `.atlas-write-left-${start + index}`), '')));
  }
  assert.deepEqual((await listDrafts(root)).drafts.map(item => item.id), [draft.id]);
});

test('a writer that dies while it takes a lock leaves no lock or a whole one, which the next writer takes over', async t => {
  for (const kind of ['draft', 'writer']) for (const boundary of ['before link', 'after link']) {
    await t.test(`${kind}: ${boundary}`, async t => {
      const root = await fixture(t);
      const draft = await saveDraft(root, { plan: edit(await openAtlas(root)) });
      const lockName = kind === 'draft' ? `${path.sep}${draft.id}.lock` : `${path.sep}lock.json`;
      const script = `import { promises as fs } from 'node:fs'; import { applyDraft } from ${JSON.stringify(new URL('../src/authoring.mjs', import.meta.url).href)}; const [root, id, revision, lock, boundary] = process.argv.slice(1); const link = fs.link; fs.link = async (from, to) => { const mine = String(to).endsWith(lock); if (mine && boundary === 'before link') process.kill(process.pid, 'SIGKILL'); await link(from, to); if (mine) process.kill(process.pid, 'SIGKILL'); }; await applyDraft(root, id, { expectedRevision: revision });`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, draft.id, draft.revision, lockName, boundary], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = ''; child.stderr.on('data', value => { stderr += value; });
      const result = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      assert.equal(result.signal, 'SIGKILL', stderr);
      assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
      assert.equal(await applyBlocker(root), null);
      const applied = await applyDraft(root, draft.id, { expectedRevision: draft.revision });
      assert.deepEqual([applied.status, applied.draft], ['complete', 'removed']);
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
        : applyPlan(root, edit(baseline));
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
  const first = await applyPlan(root, edit(await openAtlas(root)));
  assert.equal(first.status, 'complete');
  await fs.writeFile(lock, JSON.stringify({ pid: deadPid, transaction: first.transaction }));
  const second = await applyPlan(root, edit(await openAtlas(root), '\nAnother reviewed update.\n'));
  assert.equal(second.status, 'complete');
});

test('empty initialization and invalid-source repair use prepared changes', async t => {
  const root = await fixture(t, true);
  const empty = await openAtlas(root);
  const plan = prepareInitialization(empty, { id: 'empty', title: 'Empty Atlas', styleId: 'explanatory-subjects' });
  assert.equal(plan.status, 'ready');
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  await fs.writeFile(path.join(root, 'atlas.json'), '{broken');
  const invalid = await openAtlas(root);
  assert.equal(invalid.status, 'invalid');
  const repair = await prepareChangeFromDisk(root, { reason: 'Repair the malformed manifest', changes: [{ path: 'atlas.json', content: plan.changes[0].after }] }, { view: invalid });
  assert.equal((await applyPlan(root, repair)).status, 'complete');
  assert.equal((await openAtlas(root)).status, 'ready');
});

test('initialization writes an atlas/1.2 manifest and the chosen Style as style.md', async t => {
  const root = await fixture(t, true);
  const empty = await openAtlas(root);
  const plan = prepareInitialization(empty, { id: 'new', title: 'New', styleId: 'concise-subjects' });
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  assert.equal(plan.reason, 'Initialize Atlas with its selected Style');
  assert.deepEqual(plan.changes, [
    { path: 'atlas.json', before: null, after: '{\n  "format": "atlas/1.2",\n  "id": "new",\n  "title": "New",\n  "trees": []\n}\n' },
    { path: 'style.md', before: null, after: getStyle('concise-subjects').content },
  ]);
  assert.deepEqual(plan.candidate.atlas.style, { title: 'Concise subjects', body: getStyle('concise-subjects').body, path: 'style.md' });
  assert.equal((await applyPlan(root, plan)).status, 'complete');
  const adopted = await openAtlas(root);
  assert.equal(adopted.status, 'ready');
  assert.equal(await fs.readFile(path.join(root, 'style.md'), 'utf8'), await fs.readFile(path.join(repo, 'styles/concise-subjects.md'), 'utf8'));
  assert.throws(() => prepareInitialization(adopted, { id: 'again', title: 'Again', styleId: 'concise-subjects' }), { code: 'ALREADY_EXISTS' });
});

test('initialization takes the caller\'s choice of one curated Style ID or one complete custom Style, and never chooses for them', async t => {
  const root = await fixture(t, true);
  const view = await openAtlas(root);
  const initialize = selection => prepareInitialization(view, { id: 'new', title: 'New', ...selection });
  assert.throws(() => initialize({}), { code: 'INVALID_REQUEST', message: 'Choose one curated Style by its ID, or supply one complete custom Style.' });
  for (const { id, title } of listStyles()) {
    const plan = initialize({ styleId: id });
    assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
    assert.equal(plan.candidate.atlas.style.title, title);
  }
  const custom = '# Our policy\n\nOne Tree for each service. Each Point names its owner.\n';
  const own = initialize({ styleContent: custom });
  assert.equal(own.status, 'ready');
  assert.equal(own.changes[1].after, custom);
  assert.deepEqual(own.candidate.atlas.style, { title: 'Our policy', body: 'One Tree for each service. Each Point names its owner.', path: 'style.md' });
  for (const selection of [
    ...['', '   ', null, false, 0, 'unknown-style'].map(styleId => ({ styleId })),
    ...['', '   ', null, false, 0].map(styleContent => ({ styleContent })),
    { styleId: 'concise-subjects', styleContent: custom },
  ]) assert.throws(() => initialize(selection), { code: 'INVALID_REQUEST' }, JSON.stringify(selection));
  const headed = initialize({ styleContent: `---\n{"id":"custom","revision":"1"}\n---\n${custom}` });
  assert.deepEqual([headed.status, headed.validation.diagnostics.map(item => item.code)], ['invalid', ['MARKDOWN_HEADER']]);
  const untitled = initialize({ styleContent: 'A policy without a title.\n' });
  assert.deepEqual([untitled.status, untitled.validation.diagnostics.map(item => item.code)], ['invalid', ['MARKDOWN_TITLE']]);
});

test('initialization refuses to replace a style.md that was already in the directory', async t => {
  const root = await fixture(t, true);
  await fs.writeFile(path.join(root, 'style.md'), '# Someone else\'s file\n\nNot an Atlas Style.\n');
  const plan = prepareInitialization(await openAtlas(root), { id: 'new', title: 'New', styleId: 'concise-synthesis' });
  assert.equal(plan.changes[1].before, null);
  await assert.rejects(applyPlan(root, plan), { code: 'STALE' });
  assert.equal(await fs.readFile(path.join(root, 'style.md'), 'utf8'), '# Someone else\'s file\n\nNot an Atlas Style.\n');
  await assert.rejects(fs.stat(path.join(root, 'atlas.json')), { code: 'ENOENT' });
});

test('where no Atlas exists the manifest and the Style are written together; once it exists, its Style changes alone', async t => {
  const root = await fixture(t, true);
  const manifest = '{\n  "format": "atlas/1.2",\n  "id": "new",\n  "title": "New",\n  "trees": []\n}\n', policy = getStyle('concise-subjects').content;
  const initial = prepareInitialization(await openAtlas(root), { id: 'new', title: 'New', styleId: 'concise-subjects' });
  assert.deepEqual([initial.status, initial.validation.diagnostics, initial.changes.map(change => change.path)], ['ready', [], ['atlas.json', 'style.md']]);
  // Even over a style.md that was already in the directory, when the caller's change says so: there was no Atlas whose Style it could be.
  await fs.writeFile(path.join(root, 'style.md'), '# An earlier file\n\nNot yet an Atlas.\n');
  const founding = await prepareChangeFromDisk(root, { reason: 'Found the Atlas', changes: [{ path: 'atlas.json', content: manifest }, { path: 'style.md', content: policy }] });
  assert.deepEqual([founding.status, founding.validation.diagnostics], ['ready', []]);
  assert.deepEqual(founding.changes.map(change => [change.path, change.before]), [['atlas.json', null], ['style.md', '# An earlier file\n\nNot yet an Atlas.\n']]);
  assert.equal(inspectChange(founding).after.identity, founding.candidate.identity);
  assert.equal((await applyPlan(root, founding)).status, 'complete');
  const view = await openAtlas(root);
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  const later = prepareChange(view, { reason: 'Rename and restyle', changes: [{ path: 'atlas.json', content: manifest.replace('"New"', '"Renamed"') }, { path: 'style.md', content: `${policy}\nOne more rule.\n` }] });
  assert.deepEqual([later.status, later.validation.diagnostics.map(item => item.code)], ['invalid', ['STYLE_CHANGE_ALONE']]);
  // An Atlas without a Style has none to alter: it gains one together with any other repair.
  const bare = await fixture(t, true);
  await fs.writeFile(path.join(bare, 'atlas.json'), manifest);
  const unstyled = await openAtlas(bare);
  assert.deepEqual(unstyled.diagnostics.map(item => item.code), ['STYLE_REQUIRED']);
  const restored = prepareChange(unstyled, { reason: 'Give the Atlas a Style and rename it', changes: [{ path: 'style.md', content: policy }, { path: 'atlas.json', content: manifest.replace('"New"', '"Renamed"') }] });
  assert.deepEqual([restored.status, restored.validation.diagnostics], ['ready', []]);
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
  await assert.rejects(applyPlan(root, plan), { code: 'STALE' });
  assert.equal((await openAtlas(root)).identity, view.identity);
  assert.equal(await fs.readFile(path.join(root, 'trees/new/tree.json'), 'utf8'), 'Uncaptured work');
  assert.deepEqual(await listTransactions(root), { transactions: [], unreadable: [] });
});

test('repairing a malformed manifest captures existing Tree records and rejects hidden concurrent additions', async t => {
  const root = await fixture(t);
  const manifest = await fs.readFile(path.join(root, 'atlas.json'), 'utf8');
  await fs.writeFile(path.join(root, 'atlas.json'), '{broken');
  const invalid = await openAtlas(root);
  const request = { reason: 'Repair the manifest', changes: [{ path: 'atlas.json', content: manifest }] };
  const plan = await prepareChangeFromDisk(root, request, { view: invalid });
  assert.equal(plan.status, 'ready');
  assert(plan.observedFiles.length > 5);
  assert.equal(plan.baseline.identity, invalid.identity);
  await fs.writeFile(path.join(root, 'trees/product/points/new.md'), 'Uncaptured work');
  await assert.rejects(applyPlan(root, plan), { code: 'STALE' });
  assert.equal(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'), '{broken');
  await fs.unlink(path.join(root, 'trees/product/points/new.md'));
  assert.equal((await applyPlan(root, plan)).status, 'complete');
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
  const applied = await applyPlan(root, plan, { onProgress(progress) { if (progress.written.length === 1) throw new Error('Interrupted after raw repair.'); } });
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
  assert.equal((await applyPlan(root, deletion)).status, 'complete');
  await assert.rejects(fs.stat(path.join(root, extra)), { code: 'ENOENT' });
});
