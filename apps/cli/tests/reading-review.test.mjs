import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const detailPath = 'trees/service/points/recovery.md';
const source = { uri: 'report.md', role: 'evidence' };
function run(root, args, input) {
  const result = spawnSync(process.execPath, [cli, '--root', root, ...args], { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error); assert.equal(result.signal, null);
  return { code: result.status, value: result.stdout ? JSON.parse(result.stdout) : null, error: result.stderr ? JSON.parse(result.stderr).error : null };
}
function success(result) { assert.equal(result.code, 0, JSON.stringify(result)); return result.value; }
async function fixture(t) {
  const root = await tempDirectory('atlas-cli-reading-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'atlas.json': JSON.stringify({ format: 'atlas/1', id: 'work', title: 'Work', trees: ['trees/service'] }),
    'trees/service/tree.json': JSON.stringify({ id: 'service', title: 'Service', scope: 'Editing safely.', base: 'purpose', children: [{ point: 'recovery' }, { point: 'drafts' }] }),
    'trees/service/points/purpose.md': markdown({ id: 'purpose' }, 'Purpose', 'Help writers preserve their work. '.repeat(10)),
    [detailPath]: markdown({ id: 'recovery', sources: [source], uncertainty: 'Unsaved text can be lost.' }, 'Editor crash recovery', 'Saved drafts survive an editor crash. Read [draft storage](drafts.md).'),
    'trees/service/points/drafts.md': markdown({ id: 'drafts' }, 'Saved drafts', 'Saved drafts remain on disk for recovery.'),
    '.checks/scope.md': markdown({ id: 'scope', status: 'active', level: 'required' }, 'Keep the limit', '## Requirement\n\nRetain the unsaved text limitation.\n\n## Verification\n\nRead the full changed explanation.\n\n## Failure\n\nReject an unqualified recovery claim.'),
    'report.md': 'A saved draft survived restart.',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content);
  }
  return { root, original: files[detailPath] };
}

test('CLI summary search and Route continuation round-trip across independent processes', async t => {
  const { root } = await fixture(t);
  const found = success(run(root, ['search', '-'], { query: 'What if my editor crashes?', presentation: 'summary' }));
  assert.equal(found.results[0].id, 'recovery'); assert.equal(found.results[0].body, undefined);
  const exact = success(run(root, ['route', '-'], { ...found.results[0].selector, orientation: 'compact' }));
  assert.match(exact.selected[0].point.body, /Saved drafts/);
  assert.equal(exact.orientation[0].base.body, undefined);
  const first = success(run(root, ['route', '-'], { query: 'saved draft', mode: 'discover', limit: 1 }));
  const second = success(run(root, ['route', '-'], first.next.selected));
  assert.notEqual(first.selected[0].point.id, second.selected[0].point.id);
  assert.deepEqual(second.orientation, []);
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'Changed purpose', 'An independent correction.'));
  assert.equal(run(root, ['route', '-'], first.next.selected).error.code, 'atlas.route.stale-cursor');
});

test('CLI references and explicit source review distinguish links, citations and changed bytes', async t => {
  const { root } = await fixture(t);
  assert.deepEqual(success(run(root, ['references', '-'], { point: 'drafts' })).citers.map(citer => citer.record.id), ['recovery']);
  assert.equal(success(run(root, ['references', '-'], { uri: source.uri })).citations[0].from.id, 'recovery');
  const review = success(run(root, ['sources', '-'], { uris: [source.uri] }));
  assert.equal(review.results[0].status, 'current'); assert.equal(review.results[0].content, undefined);
  await writeFile(path.join(root, 'report.md'), 'The report has changed.');
  const changed = success(run(root, ['sources', '-'], { uris: [source.uri], previous: review.results.map(({ uri, sha256 }) => ({ uri, sha256 })) }));
  assert.equal(changed.results[0].status, 'changed');
});

test('CLI direct-citer lookup honors its requested result limit', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'Purpose', 'Read [draft storage](drafts.md).'));
  const result = success(run(root, ['references', '-'], { point: 'drafts', limit: 1 }));
  assert.equal(result.citers.length, 1);
  assert.equal(result.bounds.returned, 1);
  assert.equal(result.bounds.available, 2);
});

test('CLI saved Absorb review and candidate Checks persist while stale reviews cannot update the draft', async t => {
  const { root, original } = await fixture(t);
  const prepared = success(run(root, ['absorb', 'prepare', '-'], {
    source, rationale: 'Document the next qualification step.', unresolved: ['Which runtime should be tested next?'],
    contributions: [{ disposition: 'update', point: 'recovery', rationale: 'Preserve the limitation while planning further evidence.' }],
    changes: [{ path: detailPath, content: original + '\nTest a second runtime before broadening support.\n' }],
    preservation: { scope: 'The recovery limitation.', sources: [source], units: [{ id: 'limit', source, locator: 'Result paragraph', disposition: 'retained', rationale: 'Keep the unsaved text limitation explicit.', destinations: [{ point: 'recovery' }] }] },
  }));
  const reviewed = success(run(root, ['draft-review', prepared.draft.id, '--full']));
  assert.deepEqual(reviewed.review, prepared.review);
  assert.ok(reviewed.impact.changedPoints.some(point => point.id === 'recovery'));
  const candidate = reviewed.plan.candidate, check = candidate.atlas.checks[0];
  const manual = { id: check.id, revision: check.revision, baseline: candidate.identity, outcome: 'pass', reason: 'Read the complete changed explanation.', evidence: [{ text: 'Unsaved text remains explicitly outside the promise.' }] };
  const attached = success(run(root, ['draft-checks', '-'], { id: reviewed.id, expectedRevision: reviewed.revision, actor: 'reviewer', manual: [manual] }));
  assert.notEqual(attached.revision, reviewed.revision);
  assert.equal(attached.checkRuns[0].requiredSatisfied, true);
  assert.equal(attached.checkRuns[0].baseline, candidate.identity);
  assert.deepEqual(attached.review, reviewed.review);
  const stale = run(root, ['draft-checks', '-'], { id: reviewed.id, expectedRevision: reviewed.revision, actor: 'reviewer', manual: [manual] });
  assert.equal(stale.code, 3); assert.equal(stale.error.code, 'STALE_DRAFT');
  const reopened = success(run(root, ['draft-review', reviewed.id, '--full']));
  assert.equal(reopened.revision, attached.revision);
  assert.match(reopened.review.unresolved[0], /runtime/);
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), original);
});

test('CLI source review can target a newly cited candidate without changing the current Atlas', async t => {
  const { root, original } = await fixture(t);
  await writeFile(path.join(root, 'new-report.md'), 'Additional bounded evidence.');
  const content = original.replace('"uri":"report.md"', '"uri":"new-report.md"');
  const draft = success(run(root, ['prepare', '-'], { changes: [{ path: detailPath, content }], reason: 'Inspect a new candidate citation.' }));
  const target = { id: draft.id, revision: draft.revision };
  assert.equal(success(run(root, ['sources', '-'], { uris: ['new-report.md'] })).results[0].status, 'uninspected');
  assert.equal(success(run(root, ['sources', '-'], { draft: target, uris: ['new-report.md'] })).results[0].status, 'current');
  const stale = run(root, ['sources', '-'], { draft: { ...target, revision: '0'.repeat(64) }, uris: ['new-report.md'] });
  assert.equal(stale.code, 3); assert.equal(stale.error.code, 'STALE_DRAFT');
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), original);
});

test('CLI explicitly retains source observations and exact review decisions across processes', async t => {
  const { root } = await fixture(t);
  const review = success(run(root, ['sources', '-'], { uris: ['report.md'] }));
  assert.equal(success(run(root, ['source-history'])).revision, null);
  const retained = success(run(root, ['source-record', '-'], { review, expectedRevision: null }));
  assert.equal(retained.observations[0].sha256, review.results[0].sha256);
  const reread = success(run(root, ['source-history']));
  assert.equal(reread.revision, retained.revision);
  const decision = { uri: 'report.md', sha256: review.results[0].sha256, outcome: 'reviewed-unchanged', reason: 'The explanation preserves the report scope.' };
  const decided = success(run(root, ['source-record', '-'], { expectedRevision: retained.revision, decisions: [decision] }));
  assert.equal(decided.observations[0].reviewStatus, 'reviewed-unchanged');
  assert.notEqual(run(root, ['source-history', '-'], { expectedRevision: retained.revision }).code, 0);
  const staleDetails = run(root, ['source-history', '-'], { expectedRevision: retained.revision, part: 'details', maxBytes: 40 });
  assert.equal(staleDetails.code, 3);
  assert.equal(staleDetails.error.code, 'STALE_HISTORY');
  const full = success(run(root, ['source-history', '--full']));
  assert.equal(full.decisions.length, 1);
});
