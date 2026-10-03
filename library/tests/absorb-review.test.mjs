import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { openAtlas, validateFiles } from '../src/model.mjs';
import { prepareAbsorb, reviewChange } from '../src/absorb.mjs';
import { prepareChange, inspectChange, saveDraft, loadDraft, applyDraft } from '../src/authoring.mjs';
import { evaluateChecks } from '../src/checks.mjs';
import { resolveState } from '../src/state.mjs';

const json = value => JSON.stringify(value) + '\n';
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const source = { uri: 'sources/report.md', role: 'evidence' };
const detail = 'trees/system/points/detail.md';
function files() {
  return new Map([
    ['atlas.json', json({ format: 'atlas/1', id: 'review', title: 'Review', trees: ['trees/system', 'trees/product'] })],
    ['trees/system/tree.json', json({ id: 'system', title: 'System', scope: 'Qualification', base: 'runtime', children: [{ point: 'detail' }, { point: 'summary' }] })],
    ['trees/product/tree.json', json({ id: 'product', title: 'Product', scope: 'Promises', base: 'promise', children: [{ point: 'unrelated' }] })],
    ['trees/system/points/base.md', markdown({ id: 'runtime' }, 'Runtime', 'Observed behavior needs evidence.')],
    [detail, markdown({ id: 'detail', sources: [source] }, 'Qualified runtime', 'The installation passed on macOS; other systems remain untested.')],
    ['trees/system/points/summary.md', markdown({ id: 'summary' }, 'Scope summary', 'See the [qualification](detail.md) before depending on this support.')],
    ['trees/product/points/base.md', markdown({ id: 'promise' }, 'Promise', 'Users need dependable installation.')],
    ['trees/product/points/unrelated.md', markdown({ id: 'unrelated' }, 'Other work', 'This independent subject is outside the proposed change.')],
    ['trees/product/facets/scope.md', markdown({ id: 'scope', on: { point: 'promise' }, via: 'system', targets: [{ point: 'detail' }] }, 'Scope limits the promise', 'The macOS observation leaves other systems untested.')],
    ['.checks/support.md', markdown({ id: 'support', status: 'active', level: 'required' }, 'Bound the support claim', '## Requirement\n\nKeep the platform limit.\n\n## Verification\n\nRead the changed explanation and evidence.\n\n## Failure\n\nReject unqualified support claims.')],
  ]);
}
async function fixture(t) {
  const root = await tempDirectory('atlas-absorb-review-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, content] of files()) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  await fs.mkdir(path.join(root, 'sources')); await fs.writeFile(path.join(root, 'sources/report.md'), 'macOS installation passed.');
  const view = await openAtlas(root); assert.equal(view.status, 'ready');
  return { root, view };
}
function proposal(view, extra = {}) {
  return prepareAbsorb(view, { source, contributions: [{ disposition: 'update', point: 'detail', rationale: 'Add an explicit next test without broadening the observed result.' }],
    changes: [{ path: detail, content: view.files.find(file => file.path === detail).content + '\nTest Linux separately before extending the promise.\n' }],
    rationale: 'Clarify the next qualification task.', unresolved: ['Which Linux runtime should the next study exercise?'], ...extra });
}
async function checkRun(candidate) {
  const check = candidate.atlas.checks[0];
  return evaluateChecks(candidate, { actor: 'local-reviewer', manual: [{ id: check.id, revision: check.revision, baseline: candidate.identity,
    outcome: 'pass', reason: 'The macOS limitation remains explicit.', evidence: [{ text: 'Reviewed the complete changed Point and the scope qualification.' }] }] });
}

test('Absorb reasoning, unresolved questions and candidate evidence survive draft save and reopen', async t => {
  const { root, view } = await fixture(t);
  const prepared = proposal(view); const run = await checkRun(prepared.plan.candidate);
  const saved = await saveDraft(root, { plan: prepared.plan, review: prepared.review, checkRuns: [run] });
  const loaded = await loadDraft(root, saved.id);
  assert.deepEqual(loaded.review, prepared.review);
  assert.deepEqual(loaded.checkRuns, [run]);
  assert.match(loaded.review.contributions[0].rationale, /next test/);
  assert.match(loaded.review.unresolved[0], /Linux/);
  assert.equal(loaded.review.candidateIdentity, loaded.plan.candidate.identity);
  assert.equal((await applyDraft(root, loaded.id, { expectedRevision: loaded.revision })).status, 'complete');
});

test('changed plans drop omitted review metadata and reject mismatched supplied evidence', async t => {
  const { root, view } = await fixture(t); const prepared = proposal(view); const run = await checkRun(prepared.plan.candidate);
  const saved = await saveDraft(root, { plan: prepared.plan, review: prepared.review, checkRuns: [run] });
  const revised = prepareChange(view, { changes: [{ path: detail, content: view.files.find(file => file.path === detail).content + '\nA distinct candidate.\n' }], reason: 'A different explanation.' });
  await assert.rejects(saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: revised, review: prepared.review }), /exact plan/);
  await assert.rejects(saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: revised, checkRuns: [run] }), /exact candidate/);
  const changed = await saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: revised });
  assert.equal(changed.review, undefined); assert.equal(changed.checkRuns, undefined);
  assert.deepEqual(changed.reviewHistory[0].checkRuns, [run]);
  assert.deepEqual(changed.reviewHistory[0].review, prepared.review);
  assert.equal(changed.reviewHistory[0].candidate, prepared.plan.candidate.identity);
  assert.notEqual(changed.revision, saved.revision);
  await assert.rejects(applyDraft(root, saved.id, { expectedRevision: saved.revision }), { code: 'STALE_DRAFT' });
});

test('review packet changes participate in revision and cannot claim approval or conceal forged effects', async t => {
  const { root, view } = await fixture(t); const prepared = proposal(view);
  const saved = await saveDraft(root, { plan: prepared.plan, review: prepared.review });
  const revised = proposal(view, { unresolved: ['A newly identified qualification question.'] });
  assert.equal(revised.review.planIdentity, prepared.review.planIdentity);
  const changed = await saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: revised.plan, review: revised.review });
  assert.notEqual(changed.revision, saved.revision);
  await assert.rejects(saveDraft(root, { plan: prepared.plan, review: { ...prepared.review, approved: true } }), /Unknown Absorb review field/);
  const forged = structuredClone(prepared.plan); forged.candidate.atlas.points.find(point => point.id === 'detail').body = 'Unsupported forged accepted content';
  // Reconstructed bytes, not a client-supplied normalized model, govern review.
  const fromBytes = inspectChange(forged); assert.notEqual(fromBytes.after.atlas.points.find(point => point.id === 'detail').body, 'Unsupported forged accepted content');
  const canonical = await saveDraft(root, { plan: forged, review: prepared.review });
  assert.deepEqual(canonical.plan.candidate, fromBytes.after);
  const forgedBytes = structuredClone(prepared.plan); forgedBytes.candidate.files.find(file => file.path === detail).content += '\nUnreviewed mutation.\n';
  await assert.rejects(saveDraft(root, { plan: forgedBytes, review: prepared.review }), /Candidate bytes/);
  const badDecision = structuredClone(prepared.review); badDecision.contributions[0].disposition = 'reference-only';
  await assert.rejects(saveDraft(root, { plan: prepared.plan, review: badDecision }), /decisions/);
});

test('candidate runs validate summaries, root, definitions and outcome provenance without implying approval', async t => {
  const { root, view } = await fixture(t); const prepared = proposal(view); const run = await checkRun(prepared.plan.candidate);
  const falseSummary = structuredClone(run); falseSummary.required.total = 0;
  await assert.rejects(saveDraft(root, { plan: prepared.plan, checkRuns: [falseSummary] }), /summary/);
  const wrongRoot = structuredClone(run); wrongRoot.root += '-other';
  await assert.rejects(saveDraft(root, { plan: prepared.plan, checkRuns: [wrongRoot] }), /exact candidate/);
  const wrongDefinition = structuredClone(run); wrongDefinition.active[0].revision = 'a'.repeat(64); wrongDefinition.results[0].revision = 'a'.repeat(64);
  await assert.rejects(saveDraft(root, { plan: prepared.plan, checkRuns: [wrongDefinition] }), /exact candidate/);
  await assert.rejects(saveDraft(root, { plan: prepared.plan, checkRuns: [run, run] }), /exact candidate/);
  const unavailable = await evaluateChecks(prepared.plan.candidate);
  const saved = await saveDraft(root, { plan: prepared.plan, checkRuns: [unavailable] });
  assert.equal(saved.checkRuns[0].requiredSatisfied, false);
  assert.equal(saved.checkRuns[0].results[0].outcome, 'unable');
});

test('retained review bytes are integrity protected and ordinary legacy drafts remain readable', async t => {
  const { root, view } = await fixture(t); const prepared = proposal(view);
  const legacy = await saveDraft(root, { plan: prepared.plan });
  assert.equal((await loadDraft(root, legacy.id)).format, 'atlas.draft/1');
  assert.equal((await loadDraft(root, legacy.id)).review, undefined);
  const saved = await saveDraft(root, { plan: prepared.plan, review: prepared.review });
  const location = await resolveState(root);
  const filename = path.join(location.directory, 'drafts', `${saved.id}.json`);
  const tampered = JSON.parse(await fs.readFile(filename, 'utf8')); tampered.review.unresolved = [];
  await fs.writeFile(filename, json(tampered));
  await assert.rejects(loadDraft(root, saved.id), { code: 'INVALID_STATE' });
});

test('removal and consolidation are explicit decisions while dangling links remain review diagnostics', () => {
  const original = files(); const view = validateFiles(original, { root: '/tmp/absorb-review' });
  const tree = JSON.parse(original.get('trees/system/tree.json')); tree.children = [{ point: 'summary' }];
  const request = { source, rationale: 'Consolidate duplicate detail in the surviving account.',
    contributions: [{ disposition: 'remove', point: 'detail', rationale: 'Move the useful claim into the summary.', destinations: [{ point: 'summary' }] },
      { disposition: 'remove', tree: 'product', facet: 'scope', rationale: 'The old target is removed; a later interpretation needs fresh judgment.' }],
    changes: [{ path: detail, content: null }, { path: 'trees/system/tree.json', content: json(tree) }, { path: 'trees/product/facets/scope.md', content: null }] };
  const removed = prepareAbsorb(view, request);
  assert.equal(removed.status, 'ready', JSON.stringify(removed.decisionDiagnostics));
  assert.ok(removed.impact.linkDiagnostics.some(item => item.path.endsWith('summary.md') && item.code === 'REFERENCE_MISSING'));
  assert.ok(removed.impact.mentions.before.some(item => item.target.point === 'detail' && item.citers.some(citer => citer.record.id === 'summary')));
  const badDestination = structuredClone(request); badDestination.contributions[0].destinations = [{ point: 'missing' }];
  assert.equal(prepareAbsorb(view, badDestination).status, 'invalid');
  const retained = prepareAbsorb(view, { ...request, changes: [] }); assert.equal(retained.status, 'invalid');
  assert.throws(() => prepareAbsorb(view, { ...request, contributions: [{ disposition: 'remove', point: 'absent', rationale: 'No such original.' }] }), /existing Point/);
});

test('impact distinguishes direct Markdown mentions and exposes incoming Facet hosts without transitive traversal', () => {
  const view = validateFiles(files(), { root: '/tmp/absorb-review' });
  const prepared = proposal(view); const impact = reviewChange(prepared.plan);
  assert.ok(impact.review.after.points.some(item => item.record.id === 'promise' && item.reasons.some(reason => reason.kind === 'incoming-facet-host')));
  assert.ok(!impact.review.after.points.some(item => item.record.id === 'unrelated'));
  assert.ok(!impact.review.after.points.some(item => item.record.id === 'summary'));
  assert.ok(impact.mentions.after.some(item => item.target.point === 'detail' && item.citers.some(citer => citer.record.id === 'summary')));
});

test('optional preservation records bind declared scope and destinations without claiming completeness', () => {
  const view = validateFiles(files(), { root: '/tmp/absorb-review' });
  const preservation = { scope: 'The qualification and its limitations in the supplied report.', sources: [source], units: [
    { id: 'platform-limit', source, locator: 'Results, paragraph 2', disposition: 'retained', rationale: 'The limit remains explicit.', destinations: [{ point: 'detail' }] },
    { id: 'next-platform', source, locator: 'Open work', disposition: 'unresolved', rationale: 'Choose the next supported runtime after review.' },
  ] };
  const prepared = proposal(view, { preservation }); assert.equal(prepared.status, 'ready');
  assert.deepEqual(prepared.review.preservation, preservation);
  const missing = structuredClone(preservation); missing.units[0].destinations = [{ point: 'absent' }];
  assert.equal(proposal(view, { preservation: missing }).status, 'invalid');
  const outside = structuredClone(preservation); outside.units[0].source = { uri: 'other.md' };
  assert.throws(() => proposal(view, { preservation: outside }), /declared scope/);
  const duplicate = structuredClone(preservation); duplicate.units.push(duplicate.units[0]);
  assert.throws(() => proposal(view, { preservation: duplicate }), /unique IDs/);
  assert.equal(proposal(view).review.preservation, undefined);
});
