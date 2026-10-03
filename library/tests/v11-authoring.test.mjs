import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { openAtlas } from '../src/model.mjs';
import { prepareChange, prepareInitialization, prepareStyleChange, applyChange, saveDraft, loadDraft, saveWorkingCopy, loadWorkingCopy, listWorkingCopies, discardWorkingCopy, getSourceReviewHistory, recordSourceReview } from '../src/authoring.mjs';
import { prepareAbsorb } from '../src/absorb.mjs';
import { reviewSources } from '../src/references.mjs';
import { preparePublication } from '../src/publication.mjs';

async function fixture(t, empty = false) {
  const root = await tempDirectory('atlas-v11-authoring-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (!empty) {
    await fs.mkdir(path.join(root, 'trees/work/points'), { recursive: true });
    await fs.writeFile(path.join(root, 'atlas.json'), JSON.stringify({ format: 'atlas/1', id: 'work', title: 'Work', trees: ['trees/work'] }));
    await fs.writeFile(path.join(root, 'trees/work/tree.json'), JSON.stringify({ id: 'work', title: 'Work', scope: 'Work', base: 'purpose', children: [] }));
    await fs.writeFile(path.join(root, 'trees/work/points/purpose.md'), '---\n{"id":"purpose","sources":[{"uri":"evidence.md"}]}\n---\n# Purpose\n\nExplain the observed result and its limits.\n');
    await fs.writeFile(path.join(root, 'evidence.md'), '# Evidence\n\nOne result.\n');
  }
  return { root, view: await openAtlas(root) };
}

test('new Atlases adopt one complete local Style through reviewed initialization', async t => {
  const { root, view } = await fixture(t, true);
  const plan = prepareInitialization(view, { id: 'new', title: 'New', styleId: 'concise-subjects' });
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  assert.equal(plan.candidate.atlas.format, 'atlas/1.1');
  assert.equal(plan.candidate.atlas.style.id, 'concise-subjects');
  assert.equal(plan.styleChange, true);
  assert.equal((await applyChange(root, plan)).status, 'complete');
  const adopted = await openAtlas(root);
  assert.equal(adopted.atlas.style.id, 'concise-subjects');
  const content = adopted.files.find(file => file.path === 'style.md').content;
  assert.throws(() => prepareChange(adopted, { reason: 'Drop policy', styleChange: true, changes: [
    { path: 'atlas.json', content: JSON.stringify({ format: 'atlas/1', id: 'new', title: 'New', trees: [] }) }, { path: 'style.md', content: null },
  ] }), { code: 'STYLE_REQUIRED' });
  assert.throws(() => prepareChange(adopted, { reason: 'Ordinary update', changes: [{ path: 'style.md', content: content + '\nChanged policy.\n' }] }), { code: 'STYLE_CHANGE_REQUIRED' });
  const revised = prepareStyleChange(adopted, { styleId: 'explanatory-perspectives', reason: 'Adopt distinct perspectives deliberately.' });
  assert.equal(revised.status, 'ready');
  assert.equal((await applyChange(root, revised)).status, 'complete');
});

test('Style selection defaults only when omitted and rejects explicit invalid choices', async t => {
  const { view } = await fixture(t, true);
  const initialize = selection => prepareInitialization(view, { id: 'new', title: 'New', ...selection });
  const defaultPlan = initialize({});
  assert.equal(defaultPlan.candidate.atlas.style.id, 'explanatory-perspectives');
  for (const selection of [
    ...['', '   ', null, false, 0].map(styleId => ({ styleId })),
    ...['', '   ', null, false, 0].map(styleContent => ({ styleContent })),
    { styleId: 'concise-subjects', styleContent: '' },
  ]) {
    assert.throws(() => initialize(selection), { code: 'INVALID_REQUEST' }, JSON.stringify(selection));
    assert.throws(() => prepareStyleChange(defaultPlan.candidate, { reason: 'Review a policy change.', ...selection }), { code: 'INVALID_REQUEST' }, JSON.stringify(selection));
  }
  assert.throws(() => prepareStyleChange(defaultPlan.candidate, { reason: 'No choice supplied.' }), { code: 'INVALID_REQUEST' });
});

test('legacy adoption preserves records and Style publication is explicit', async t => {
  const { root, view } = await fixture(t);
  assert.equal(view.atlas.style, undefined);
  const before = await fs.readFile(path.join(root, 'trees/work/points/purpose.md'), 'utf8');
  const adopted = prepareStyleChange(view, { styleId: 'explanatory-perspectives', reason: 'Keep existing perspectives consistently.' });
  assert.equal((await applyChange(root, adopted)).status, 'complete');
  const current = await openAtlas(root);
  assert.equal(await fs.readFile(path.join(root, 'trees/work/points/purpose.md'), 'utf8'), before);
  assert.equal(preparePublication(current, { trees: ['work'] }).atlas.style, undefined);
  const included = preparePublication(current, { trees: ['work'], includeStyle: true });
  assert.equal(included.atlas.style.id, 'explanatory-perspectives');
  assert.equal(included.atlas.style.path, undefined);
});

test('revised drafts retain original reasoning as historical evidence', async t => {
  const { root, view } = await fixture(t);
  const file = 'trees/work/points/purpose.md';
  const original = view.files.find(item => item.path === file).content;
  const proposal = prepareAbsorb(view, { source: { uri: 'evidence.md' }, rationale: 'Clarify the bounded result.', unresolved: ['Broader trial remains open.'], contributions: [{ disposition: 'update', point: 'purpose', rationale: 'Keep the evidence limit beside the claim.' }], changes: [{ path: file, content: original + '\nOther situations remain untested.\n' }] });
  const saved = await saveDraft(root, { plan: proposal.plan, review: proposal.review });
  const next = prepareChange(view, { reason: 'Change the explanation after review.', changes: [{ path: file, content: original + '\nA different explanation.\n' }] });
  const revised = await saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: next });
  assert.equal(revised.review, undefined);
  assert.equal(revised.reviewHistory.length, 1);
  assert.deepEqual(revised.reviewHistory[0].review, saved.review);
  assert.equal(revised.reviewHistory[0].candidate, saved.plan.candidate.identity);
  assert.notEqual(revised.reviewHistory[0].candidate, revised.plan.candidate.identity);
  assert.deepEqual((await loadDraft(root, saved.id)).reviewHistory, revised.reviewHistory);
});

test('recoverable typing survives reopen without changing authored bytes and refuses stale saves', async t => {
  const { root, view } = await fixture(t);
  const first = await saveWorkingCopy(root, { baseline: view.identity, form: { kind: 'point', title: 'Edit purpose', fields: { body: 'Unsaved explanation.' } } });
  assert.equal((await loadWorkingCopy(root, first.id)).form.fields.body, 'Unsaved explanation.');
  assert.equal((await openAtlas(root)).identity, view.identity);
  assert.equal((await listWorkingCopies(root))[0].id, first.id);
  await assert.rejects(saveWorkingCopy(root, { id: first.id, baseline: view.identity, form: first.form }), { code: 'STALE_DRAFT' });
  const second = await saveWorkingCopy(root, { id: first.id, expectedRevision: first.revision, baseline: view.identity, form: { ...first.form, fields: { body: 'Later typing.' } } });
  await assert.rejects(discardWorkingCopy(root, { id: first.id, expectedRevision: first.revision }), { code: 'STALE_DRAFT' });
  await discardWorkingCopy(root, { id: first.id, expectedRevision: second.revision });
  assert.deepEqual(await listWorkingCopies(root), []);
});

test('source changes remain awaiting review across repeated reads and exact-byte decisions survive sessions', async t => {
  const { root, view } = await fixture(t);
  let history = await getSourceReviewHistory(root);
  assert.equal(history.revision, null);
  const inspect = () => reviewSources(view, { allowedRoots: [root], previous: history.observations.map(({ uri, sha256 }) => ({ uri, sha256 })) });
  history = await recordSourceReview(root, { review: await inspect(), expectedRevision: history.revision });
  assert.equal(history.observations[0].reviewStatus, 'unreviewed');
  await fs.appendFile(path.join(root, 'evidence.md'), '\nA changed observation.\n');
  history = await recordSourceReview(root, { review: await inspect(), expectedRevision: history.revision });
  const changedHash = history.observations[0].sha256;
  assert.equal(history.observations[0].reviewStatus, 'needs-review');
  history = await recordSourceReview(root, { review: await inspect(), expectedRevision: history.revision });
  assert.equal(history.observations[0].status, 'current');
  assert.equal(history.observations[0].reviewStatus, 'needs-review');
  history = await recordSourceReview(root, { expectedRevision: history.revision, decisions: [{ uri: 'evidence.md', sha256: changedHash, outcome: 'reviewed-unchanged', reason: 'The changed evidence leaves this bounded explanation accurate.' }] });
  assert.equal((await getSourceReviewHistory(root)).observations[0].reviewStatus, 'reviewed-unchanged');
  await assert.rejects(recordSourceReview(root, { review: await inspect() }), { code: 'STALE_DRAFT' });
  await fs.unlink(path.join(root, 'evidence.md'));
  history = await recordSourceReview(root, { review: await inspect(), expectedRevision: history.revision });
  assert.equal(history.inspections[0].status, 'missing');
  await assert.rejects(recordSourceReview(root, { expectedRevision: history.revision, decisions: [{ uri: 'evidence.md', sha256: changedHash, outcome: 'updated', reason: 'Unavailable now.' }] }), { code: 'STALE_SOURCE' });
});
