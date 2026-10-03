import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { createToolSession } from '../src/tools.mjs';
import { openAtlas } from '../../../library/src/model.mjs';
import { prepareChange, saveDraft } from '../../../library/src/authoring.mjs';
import { getStyle } from '../../../library/src/styles.mjs';

const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const detailPath = 'trees/service/points/recovery.md';
const source = { uri: 'report.md', role: 'evidence' };
async function fixture(t) {
  const root = await tempDirectory('atlas-agent-reading-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'atlas.json': JSON.stringify({ format: 'atlas/1', id: 'work', title: 'Work', trees: ['trees/service', 'trees/evidence'] }),
    'trees/service/tree.json': JSON.stringify({ id: 'service', title: 'Service', scope: 'Editing safely.', base: 'purpose', children: [{ point: 'recovery', children: [{ point: 'drafts' }] }] }),
    'trees/evidence/tree.json': JSON.stringify({ id: 'evidence', title: 'Evidence', scope: 'Observed behavior.', base: 'observed', children: [] }),
    'trees/service/points/purpose.md': markdown({ id: 'purpose' }, 'Purpose', 'Help writers understand the limits of their tools. '.repeat(10)),
    [detailPath]: markdown({ id: 'recovery', uncertainty: 'Unsaved text can be lost.' }, 'Editor crash recovery', 'Saved drafts survive an editor crash. [Draft storage](drafts.md) explains how. [Evidence meaning](../facets/limits.md) qualifies this claim.'),
    'trees/service/points/drafts.md': markdown({ id: 'drafts' }, 'Saved drafts', 'Saved drafts retain the reviewed candidate on disk.'),
    'trees/evidence/points/observed.md': markdown({ id: 'observed', type: 'observation', observedAt: '2026-09-27', sources: [source], uncertainty: 'One runtime only.' }, 'Observed saved draft', 'One saved draft survived restart.'),
    'trees/service/facets/limits.md': markdown({ id: 'limits', on: { point: 'recovery' }, via: 'evidence', targets: [{ point: 'observed' }] }, 'Evidence limits', 'Read the [observation](../../evidence/points/observed.md) before extending the claim.'),
    '.checks/scope.md': markdown({ id: 'scope', status: 'active', level: 'required' }, 'Keep the limit', '## Requirement\n\nRetain the unsaved text limitation.\n\n## Verification\n\nRead the full changed explanation.\n\n## Failure\n\nReject an unqualified recovery claim.'),
    'report.md': 'One saved draft survived restart.',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return { root, original: files[detailPath], session: createToolSession(root) };
}

test('agent discovery selectors and continuations preserve the captured view until explicit refresh', async t => {
  const { root, session } = await fixture(t);
  const summary = await session.call('atlas_search', { query: 'What if my editor crashes?', presentation: 'summary' });
  assert.equal(summary.results[0].id, 'recovery');
  assert.equal(summary.results[0].summary, true);
  assert.equal(summary.results[0].body, undefined);
  const exact = await session.call('atlas_route', { ...summary.results[0].selector, orientation: 'compact' });
  assert.match(exact.selected[0].point.body, /Saved drafts/);
  assert.equal(exact.selected[0].point.uncertainty, 'Unsaved text can be lost.');
  assert.equal(exact.orientation[0].base.body, undefined);
  const first = await session.call('atlas_route', { query: 'saved draft', mode: 'discover', limit: 1 });
  assert.ok(first.next.selected);
  const second = await session.call('atlas_route', first.next.selected);
  assert.notEqual(second.selected[0].point.id, first.selected[0].point.id);
  assert.deepEqual(second.orientation, []);
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'New purpose', 'An independently changed explanation.'));
  assert.deepEqual(await session.call('atlas_route', first.next.selected), second);
  await session.call('atlas_refresh', {});
  await assert.rejects(session.call('atlas_route', first.next.selected), { code: 'atlas.route.stale-cursor' });
  await assert.rejects(session.call('atlas_route', { query: 'draft', mode: 'invented' }), { code: 'INVALID_ARGUMENT' });
});

test('agent references expose Facet links and declared sources without implicit source reads', async t => {
  const { root, session } = await fixture(t);
  const references = await session.call('atlas_references', {});
  assert.ok(references.references.some(reference => reference.from.id === 'recovery' && reference.target?.kind === 'facet' && reference.target.id === 'limits'));
  assert.deepEqual((await session.call('atlas_references', { point: 'observed' })).citers.map(citer => citer.record.id), ['limits']);
  assert.equal((await session.call('atlas_references', { uri: 'report.md' })).citations[0].from.id, 'observed');
  const inspected = await session.call('atlas_review_sources', { uris: ['report.md'] });
  assert.equal(inspected.results[0].status, 'current');
  assert.equal(inspected.results[0].content, undefined);
  await writeFile(path.join(root, 'report.md'), 'The evidence now contains a correction.');
  const changed = await session.call('atlas_review_sources', { uris: ['report.md'], previous: inspected.results.map(({ uri, sha256 }) => ({ uri, sha256 })) });
  assert.equal(changed.results[0].status, 'changed');
  assert.equal((await session.call('atlas_references', { uri: 'report.md' })).citations[0].source.sha256, undefined);
});

test('agent direct-citer lookup honors its requested result limit', async t => {
  const { root, session } = await fixture(t);
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'Purpose', 'Read [draft storage](drafts.md).'));
  const result = await session.call('atlas_references', { point: 'drafts', limit: 1 });
  assert.equal(result.citers.length, 1);
  assert.equal(result.bounds.returned, 1);
  assert.equal(result.bounds.available, 2);
});

test('agent saved Absorb review survives restart and Check runs attach only to the reviewed candidate revision', async t => {
  const { root, original, session } = await fixture(t);
  const baseline = (await session.call('atlas_view', {})).identity;
  const prepared = await session.call('atlas_absorb_prepare', { baseline, proposal: {
    source, rationale: 'Add the next test while retaining the observed limit.', unresolved: ['Which runtime should be tested next?'],
    contributions: [{ disposition: 'update', point: 'recovery', rationale: 'Name the next qualification step.' }],
    changes: [{ path: detailPath, content: original + '\nTest a second runtime before broadening support.\n' }],
    preservation: { scope: 'The recovery limitation.', sources: [source], units: [{ id: 'limit', source, locator: 'Result paragraph', disposition: 'retained', rationale: 'The unsaved text limitation remains explicit.', destinations: [{ point: 'recovery' }] }] },
  } });
  assert.equal(prepared.proposal.status, 'ready');
  const saved = await session.call('atlas_save_draft', { proposalId: prepared.proposalId, id: 'recovery-review' });
  const restarted = createToolSession(root);
  const reviewed = await restarted.call('atlas_review_draft', { full: true, id: saved.id, expectedRevision: saved.revision });
  assert.deepEqual(reviewed.draft.review, prepared.proposal.review);
  assert.match(reviewed.draft.review.unresolved[0], /runtime/);
  assert.ok(reviewed.impact.changedPoints.some(point => point.id === 'recovery'));
  const candidate = reviewed.draft.plan.candidate;
  const check = candidate.atlas.checks[0];
  const target = { id: saved.id, revision: saved.revision };
  const input = { baseline: candidate.identity, actor: 'reviewer', draft: target, manual: [{ id: check.id, revision: check.revision, baseline: candidate.identity, outcome: 'pass', reason: 'Read the full explanation and its limitation.', evidence: [{ text: 'Unsaved text can still be lost.' }] }] };
  await assert.rejects(restarted.call('atlas_evaluate_checks', { ...input, baseline }), { code: 'STALE' });
  const run = await restarted.call('atlas_evaluate_checks', input);
  assert.equal(run.requiredSatisfied, true);
  assert.equal(run.baseline, candidate.identity);
  const currentRun = await restarted.call('atlas_evaluate_checks', { baseline, actor: 'reviewer' });
  await assert.rejects(restarted.call('atlas_attach_draft_check_run', { id: saved.id, expectedRevision: saved.revision, runId: currentRun.id }), { code: 'STALE_DRAFT' });
  const attached = await restarted.call('atlas_attach_draft_check_run', { id: saved.id, expectedRevision: saved.revision, runId: run.id });
  assert.notEqual(attached.revision, saved.revision);
  await assert.rejects(restarted.call('atlas_attach_draft_check_run', { id: saved.id, expectedRevision: saved.revision, runId: run.id }), { code: 'STALE_DRAFT' });
  await assert.rejects(restarted.call('atlas_review_draft', { full: true, id: saved.id, expectedRevision: saved.revision }), { code: 'STALE_DRAFT' });
  const persisted = await createToolSession(root).call('atlas_review_draft', { full: true, id: saved.id, expectedRevision: attached.revision });
  assert.deepEqual(persisted.draft.review, reviewed.draft.review);
  assert.equal(persisted.draft.checkRuns[0].results[0].outcome, 'pass');
  assert.equal(persisted.draft.checkRuns[0].baseline, candidate.identity);
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), original);
});

test('agent draft review and candidate source inspection use captured bytes and exact saved revisions', async t => {
  const { root, session } = await fixture(t);
  await writeFile(path.join(root, 'next-report.md'), 'The next report exists before its citation is applied.');
  const view = await openAtlas(root);
  const content = markdown({ id: 'recovery', sources: [{ uri: 'next-report.md' }] }, 'Candidate recovery', 'Keep the unsaved text limitation explicit.');
  const plan = structuredClone(prepareChange(view, { changes: [{ path: detailPath, content }], reason: 'Review a newly cited source.' }));
  const actualCheckBody = plan.candidate.atlas.checks[0].body;
  plan.candidate.atlas.checks[0].body = 'A caller-invented Check requirement.';
  plan.candidate.atlas.points.find(point => point.id === 'recovery').body = 'A caller-invented explanation.';
  const saved = await saveDraft(root, { plan }); // Plain legacy-compatible drafts may contain a supplied normalized model.
  const reviewed = await session.call('atlas_review_draft', { full: true, id: saved.id, expectedRevision: saved.revision });
  assert.equal(reviewed.draft.plan.candidate.atlas.checks[0].body, actualCheckBody);
  assert.match(reviewed.draft.plan.candidate.atlas.points.find(point => point.id === 'recovery').body, /unsaved text/);
  const current = await session.call('atlas_review_sources', { uris: ['next-report.md'] });
  assert.equal(current.results[0].status, 'uninspected');
  const target = { id: saved.id, revision: saved.revision };
  const candidate = await session.call('atlas_review_sources', { uris: ['next-report.md'], draft: target });
  assert.equal(candidate.identity, plan.candidate.identity);
  assert.equal(candidate.results[0].status, 'current');
  assert.match(candidate.results[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(candidate.results[0].citations[0].from.id, 'recovery');
  const changed = await saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: { ...plan, reason: 'Revised review intent.' } });
  assert.notEqual(changed.revision, saved.revision);
  await assert.rejects(session.call('atlas_review_sources', { uris: ['next-report.md'], draft: target }), { code: 'STALE_DRAFT' });
});

test('agent mixed discovery, active Style and compact draft inspection provide explicit full follow-ups', async t => {
  const { root, session, original } = await fixture(t);
  const listed = await session.call('atlas_styles', {});
  assert.deepEqual(listed.styles.map(style => style.id), ['explanatory-perspectives', 'concise-perspectives', 'explanatory-subjects', 'concise-subjects', 'explanatory-synthesis', 'concise-synthesis']);
  for (const { id } of listed.styles) {
    const style = await session.call('atlas_styles', { id });
    assert.equal(style.style.id, id);
    assert.equal(style.style.content, getStyle(id).content);
  }
  const inventory = await session.call('atlas_view', { section: 'points', limit: 1 });
  assert.equal(inventory.atlas.points.length, 1);
  assert.equal(inventory.atlas.points[0].body, undefined);
  const next = await session.call('atlas_view', inventory.bounds.points.next);
  assert.notEqual(next.atlas.points[0].id, inventory.atlas.points[0].id);
  const found = await session.call('atlas_search', { query: 'extending', kinds: ['facet'] });
  assert.equal(found.results[0].kind, 'facet');
  const read = await session.call('atlas_route', found.results[0].selector);
  assert.match(read.facets[0].facet.body, /extending/);
  const plan = prepareChange(await openAtlas(root), { reason: 'Clarify.', changes: [{ path: detailPath, content: original + '\nA scoped clarification.' }] });
  const draft = await saveDraft(root, { plan });
  const summary = await session.call('atlas_load_draft', { id: draft.id });
  assert.equal(summary.draft.plan.changes[0].after, undefined);
  assert.equal(summary.draft.plan.changes[0].action, 'write');
  const chunk = await session.call('atlas_load_draft', { id: draft.id, part: 'details', maxBytes: 400 });
  assert.ok(chunk.nextOffset);
  assert.equal(chunk.text.length <= 400, true);
  const reviewed = await session.call('atlas_review_draft', { id: draft.id, expectedRevision: draft.revision });
  assert.equal(reviewed.draft.plan.candidate.files[0].content, undefined);
  assert.equal(reviewed.impact, undefined);
});

test('agent source review retention is explicit, survives restart and binds decisions to observed hashes', async t => {
  const { root, session } = await fixture(t);
  const review = await session.call('atlas_review_sources', { uris: ['report.md'] });
  assert.equal((await session.call('atlas_source_history', {})).revision, null);
  const retained = await session.call('atlas_record_source_review', { reviewId: review.reviewId, expectedRevision: null });
  assert.equal(retained.observations[0].uri, 'report.md');
  const restarted = createToolSession(root);
  const current = await restarted.call('atlas_source_history', {});
  assert.equal(current.revision, retained.revision);
  assert.equal(current.observations[0].sha256, review.results[0].sha256);
  const decided = await restarted.call('atlas_record_source_review', { expectedRevision: current.revision, decisions: [{ uri: 'report.md', sha256: review.results[0].sha256, outcome: 'reviewed-unchanged', reason: 'The existing explanation retains this observation scope.' }] });
  assert.equal(decided.observations[0].reviewStatus, 'reviewed-unchanged');
  await assert.rejects(restarted.call('atlas_source_history', { expectedRevision: retained.revision }), { code: 'STALE_HISTORY' });
  await assert.rejects(restarted.call('atlas_source_history', { expectedRevision: retained.revision, part: 'details', maxBytes: 40 }), { code: 'STALE_HISTORY' });
  await assert.rejects(restarted.call('atlas_record_source_review', { reviewId: review.reviewId }), { code: 'REVIEW_EXPIRED' });
  const details = await restarted.call('atlas_source_history', { part: 'details', maxBytes: 40 });
  assert.equal(details.complete, false);
});
