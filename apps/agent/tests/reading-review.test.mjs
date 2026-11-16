import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { createToolSession, TOOLS } from '../src/tools.mjs';
import { openAtlas } from '../../../library/src/model.mjs';
import { prepareChange, saveDraft } from '../../../library/src/authoring.mjs';
import { resolveState } from '../../../library/src/state.mjs';
import { getStyle } from '../../../library/src/styles.mjs';

const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const detailPath = 'trees/service/points/recovery.md';
const report = result => `# Report\n\n## Result\n\n${result}\n\n## Method\n\nOne laptop, one restart.\n`;
async function fixture(t, grant = true) {
  const parent = await tempDirectory('atlas-agent-reading-'), root = path.join(parent, 'atlas');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const files = {
    'atlas.json': JSON.stringify({ format: 'atlas/1.2', id: 'work', title: 'Work', trees: ['trees/service', 'trees/evidence'] }),
    'style.md': '# Two accounts\n\nThe service account says what writers can rely on. The evidence account says what was seen.\n',
    'trees/service/tree.json': JSON.stringify({ id: 'service', title: 'Service', scope: 'Editing safely.', base: 'purpose', children: [{ point: 'recovery', children: [{ point: 'drafts' }] }] }),
    'trees/evidence/tree.json': JSON.stringify({ id: 'evidence', title: 'Evidence', scope: 'Observed behavior.', base: 'observed', children: [] }),
    'trees/service/points/purpose.md': markdown({ id: 'purpose' }, 'Writers keep their work', 'Help writers understand the limits of their tools. '.repeat(10)),
    [detailPath]: markdown({ id: 'recovery', uncertainty: 'Unsaved text can be lost.' }, 'Saved drafts survive an editor crash', 'Saved drafts survive an editor crash. [Draft storage](drafts.md) explains how. [Evidence meaning](../facets/limits.md) qualifies this claim.'),
    'trees/service/points/drafts.md': markdown({ id: 'drafts' }, 'Saved drafts stay on disk', 'Saved drafts retain the reviewed candidate on disk.'),
    'trees/evidence/points/observed.md': markdown({ id: 'observed', type: 'observation', observedAt: '2026-09-27', sources: [{ uri: '../report.md#result', role: 'evidence' }], uncertainty: 'One runtime only.' }, 'One saved draft survived a restart', 'One saved draft survived restart.'),
    'trees/service/facets/limits.md': markdown({ id: 'limits', on: 'recovery', via: 'evidence', targets: ['observed'] }, 'The evidence covers one runtime', 'Read the [observation](../../evidence/points/observed.md) before extending the claim.'),
    '.checks/scope.md': markdown({ id: 'scope', status: 'active', level: 'required' }, 'Keep the limit', '## Requirement\n\nRetain the unsaved text limitation.\n\n## Verification\n\nRead the full changed explanation.\n\n## Failure\n\nReject an unqualified recovery claim.'),
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  await writeFile(path.join(parent, 'report.md'), report('One saved draft survived restart.'));
  const session = createToolSession(root, grant ? { allowedRoots: [parent] } : {});
  return { root, parent, original: files[detailPath], session, baseline: async () => (await session.call('atlas_open', {})).identity };
}

test('agent discovery selectors and continuations preserve the captured view until explicit refresh', async t => {
  const { root, session } = await fixture(t);
  const summary = await session.call('atlas_search', { query: 'What if my editor crashes?', presentation: 'summary' });
  assert.deepEqual(Object.keys(summary), ['format', 'status', 'identity', 'request', 'results', 'bounds', 'next', 'diagnostics']);
  assert.equal(summary.results[0].id, 'recovery');
  assert.equal(summary.results[0].summary, true);
  assert.equal(summary.results[0].body, undefined);
  // A list of results says when some were left out, and how to read them.
  const page = await session.call('atlas_search', { query: 'saved draft', limit: 2 });
  assert.ok(page.bounds.available > 2, JSON.stringify(page.bounds));
  assert.deepEqual([page.bounds, page.next], [{ offset: 0, limit: 2, available: page.bounds.available, returned: 2 }, { kinds: ['point', 'facet'], presentation: 'summary', query: 'saved draft', limit: 2, offset: 2 }]);
  const rest = await session.call('atlas_search', page.next);
  assert.deepEqual([rest.bounds.offset, rest.bounds.returned, rest.next], [2, page.bounds.available - 2, null]);
  assert.deepEqual([...page.results, ...rest.results].filter(result => result.type).map(result => [result.id, result.observedAt]), [['observed', '2026-09-27']], 'an observation keeps its date');
  const exact = await session.call('atlas_route', { ...summary.results[0].selector, orientation: 'compact' });
  assert.match(exact.selected[0].point.body, /Saved drafts/);
  assert.equal(exact.selected[0].point.uncertainty, 'Unsaved text can be lost.');
  assert.equal(exact.orientation[0].base.body, undefined);
  const first = await session.call('atlas_route', { query: 'saved draft', mode: 'discover', limit: 1 });
  assert.ok(first.next.selected);
  // Discovery says what it left out: each section's count and its continuation, and how many matched in all.
  assert.deepEqual([first.bounds.selected.returned, first.bounds.selected.available > 1, first.search.available, first.search.exhaustive], [1, true, page.bounds.available, true]);
  const second = await session.call('atlas_route', first.next.selected);
  assert.notEqual(second.selected[0].point.id, first.selected[0].point.id);
  assert.deepEqual(second.orientation, []);
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'New purpose', 'An independently changed explanation.'));
  assert.deepEqual(await session.call('atlas_route', first.next.selected), second);
  const refreshed = await session.call('atlas_refresh', {});
  assert.deepEqual(refreshed.comparison.changed, ['trees/service/points/purpose.md']);
  await assert.rejects(session.call('atlas_route', first.next.selected), { code: 'atlas.route.stale-cursor' });
  await assert.rejects(session.call('atlas_route', { query: 'draft', mode: 'invented' }), { code: 'INVALID_ARGUMENT' });
  // kinds names one kind or both, each once; the schema refuses anything else before the operation runs.
  for (const name of ['atlas_search', 'atlas_route']) {
    await assert.rejects(session.call(name, { query: 'draft', kinds: [] }), { code: 'INVALID_ARGUMENT', message: 'arguments.kinds has too few entries.' }, name);
    await assert.rejects(session.call(name, { query: 'draft', kinds: ['point', 'point'] }), { code: 'INVALID_ARGUMENT', message: 'arguments.kinds repeats an entry.' }, name);
  }
  const found = await session.call('atlas_search', { query: 'extending', kinds: ['facet'] });
  assert.equal(found.results[0].kind, 'facet');
  const read = await session.call('atlas_route', found.results[0].selector);
  assert.match(read.facets[0].facet.body, /extending/);
});

test('agent outline gives every account, or one, as one line for each claim, nested as its outline places it', async t => {
  const { session } = await fixture(t);
  const all = await session.call('atlas_outline', {});
  assert.deepEqual(Object.keys(all), ['format', 'status', 'identity', 'trees', 'diagnostics']);
  assert.deepEqual(all.trees, [
    { id: 'service', title: 'Service', scope: 'Editing safely.', outline: ['purpose: Writers keep their work', '  recovery: Saved drafts survive an editor crash', '    drafts: Saved drafts stay on disk'] },
    { id: 'evidence', title: 'Evidence', scope: 'Observed behavior.', outline: ['observed: One saved draft survived a restart [observation: 2026-09-27]'] },
  ]);
  const one = await session.call('atlas_outline', { tree: 'evidence' });
  assert.deepEqual([one.status, one.tree, one.trees], ['ready', 'evidence', [all.trees[1]]]);
  assert.equal(one.identity, all.identity);
  assert.deepEqual([(await session.call('atlas_outline', { tree: 'nowhere' })).status, (await session.call('atlas_outline', { tree: 'nowhere' })).trees], ['missing', []]);
  await assert.rejects(session.call('atlas_outline', { tree: 'trees/service' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(session.call('atlas_outline', { point: 'purpose' }), { code: 'INVALID_ARGUMENT' });
});

test('agent references and inspection return records, the Style, every Check and exact file text', async t => {
  const { session, original } = await fixture(t);
  const references = await session.call('atlas_references', {});
  assert.ok(references.references.some(reference => reference.from.id === 'recovery' && reference.target?.kind === 'facet' && reference.target.id === 'limits'));
  assert.deepEqual((await session.call('atlas_references', { point: 'observed' })).citers.map(citer => citer.record.id), ['limits']);
  assert.deepEqual((await session.call('atlas_references', { facet: 'limits', tree: 'service' })).citers.map(citer => citer.record.id), ['recovery']);
  assert.equal((await session.call('atlas_references', { uri: '../report.md#result' })).citations[0].from.id, 'observed');
  assert.equal((await session.call('atlas_references', { point: 'drafts', limit: 1 })).bounds.returned, 1);
  for (const args of [{ point: 'observed', uri: '../report.md' }, { tree: 'service' }, { facet: 'limits' }]) await assert.rejects(session.call('atlas_references', args), { code: 'INVALID_REQUEST' });
  const point = await session.call('atlas_inspect', { point: 'recovery' });
  assert.deepEqual(Object.keys(point), ['format', 'status', 'identity', 'kind', 'record', 'diagnostics']);
  assert.deepEqual([point.format, point.status, point.kind], ['atlas.inspection/1', 'ready', 'point']);
  assert.deepEqual(point.record.facets.map(facet => facet.id), ['limits']);
  assert.equal((await session.call('atlas_inspect', { facet: { tree: 'service', id: 'limits' } })).record.viaTree.id, 'evidence');
  assert.equal((await session.call('atlas_inspect', { tree: 'evidence' })).record.incomingFacets[0].id, 'limits');
  assert.equal((await session.call('atlas_inspect', { style: true })).record.title, 'Two accounts');
  const checks = await session.call('atlas_inspect', { checks: true });
  assert.deepEqual(checks.records.map(check => [check.id, check.status, check.level]), [['scope', 'active', 'required']]);
  assert.match(checks.records[0].body, /Reject an unqualified recovery claim/);
  assert.equal(checks.limits.length, 2);
  const file = await session.call('atlas_inspect', { path: detailPath });
  assert.equal(file.record.content, original);
  assert.equal((await session.call('atlas_inspect', { path: 'trees/service/points/absent.md' })).status, 'missing');
  assert.equal((await session.call('atlas_inspect', { point: 'absent' })).status, 'missing');
  await assert.rejects(session.call('atlas_inspect', { point: 'recovery', style: true }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(session.call('atlas_inspect', {}), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(session.call('atlas_inspect', { checks: false }), { code: 'INVALID_ARGUMENT' });
  let offset = 0, sha256, text = '';
  while (offset !== null) {
    const chunk = await session.call('atlas_inspect', { point: 'purpose', part: 'details', offset, maxBytes: 200, ...(sha256 ? { expectedSha256: sha256 } : {}) });
    assert.ok(chunk.returnedBytes <= 200); text += chunk.text; offset = chunk.nextOffset; sha256 = chunk.sha256;
  }
  assert.equal(JSON.parse(text).id, 'purpose');
  const listed = await session.call('atlas_styles', {});
  assert.deepEqual(listed.styles.map(style => style.id), ['explanatory-perspectives', 'concise-perspectives', 'explanatory-subjects', 'concise-subjects', 'explanatory-synthesis', 'concise-synthesis']);
  for (const { id } of listed.styles) assert.equal((await session.call('atlas_styles', { id })).style.content, getStyle(id).content);
  const inventory = await session.call('atlas_open', { section: 'points', limit: 1 });
  assert.equal(inventory.atlas.points.length, 1);
  assert.equal(inventory.atlas.points[0].body, undefined);
  const next = await session.call('atlas_open', inventory.bounds.points.next);
  assert.notEqual(next.atlas.points[0].id, inventory.atlas.points[0].id);
  await assert.rejects(session.call('atlas_open', { section: 'branches' }), { code: 'INVALID_ARGUMENT' });
});

test('agent prepares from a candidate directory only within the launch grants and outside the Atlas and private state', async t => {
  const { root, parent, session, original, baseline } = await fixture(t), candidate = path.join(parent, 'candidate');
  await cp(root, candidate, { recursive: true });
  await writeFile(path.join(candidate, detailPath), original.replace('explains how', 'says how'));
  await writeFile(path.join(candidate, 'notes.txt'), 'Working notes that are not part of the Atlas.');
  const identity = await baseline();
  await assert.rejects(session.call('atlas_prepare', { baseline: identity, reason: 'Relative.', candidate: 'candidate' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(session.call('atlas_prepare', { baseline: identity, reason: 'Absent.', candidate: path.join(parent, 'absent') }), { code: 'UNSAFE_PATH' });
  await assert.rejects(session.call('atlas_prepare', { baseline: '0'.repeat(64), reason: 'Another Atlas.', candidate }), { code: 'STALE' });
  const ungranted = createToolSession(root);
  await assert.rejects(ungranted.call('atlas_prepare', { baseline: identity, reason: 'Outside the grants.', candidate }), { code: 'CANDIDATE_DENIED' });
  const inside = path.join(root, 'candidate');
  await cp(candidate, inside, { recursive: true });
  await assert.rejects(session.call('atlas_prepare', { baseline: identity, reason: 'Inside the Atlas.', candidate: inside }), { code: 'UNSAFE_PATH' });
  await assert.rejects(ungranted.call('atlas_prepare', { baseline: identity, reason: 'Inside the Atlas.', candidate: inside }), { code: 'UNSAFE_PATH' });
  await rm(inside, { recursive: true });
  const state = (await resolveState(root, { create: true })).directory, hidden = path.join(state, 'candidate');
  await cp(candidate, hidden, { recursive: true });
  await assert.rejects(createToolSession(root, { allowedRoots: [path.dirname(state)] }).call('atlas_prepare', { baseline: identity, reason: 'Inside private state.', candidate: hidden }), { code: 'UNSAFE_PATH' });
  await rm(hidden, { recursive: true });
  assert.deepEqual((await session.call('atlas_drafts', { action: 'list' })).drafts, []);
  const saved = await session.call('atlas_prepare', { baseline: identity, reason: 'Say how drafts are stored.', candidate });
  assert.equal(saved.plan.status, 'ready');
  assert.deepEqual(saved.plan.changes.map(change => [change.path, change.action]), [[detailPath, 'write']]);
  assert.deepEqual([saved.plan.ignored, saved.bounds.ignored], [['notes.txt'], { available: 1, returned: 1 }]);
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), original);
  assert.equal((await session.call('atlas_apply', { id: saved.id, expectedRevision: saved.revision })).status, 'complete');
  assert.equal((await openAtlas(root)).identity, (await openAtlas(candidate)).identity);
  await writeFile(path.join(root, 'trees/service/points/drafts.md'), markdown({ id: 'drafts' }, 'Saved drafts stay on disk', 'An edit made outside the session.'));
  await assert.rejects(session.call('atlas_prepare', { baseline: await baseline(), reason: 'The Atlas moved on.', candidate }), { code: 'STALE' });
});

test('agent validate of a candidate reports its broken links and the sources it cites that are not there, read within the launch grants', async t => {
  const { root, original, session, baseline } = await fixture(t);
  const candidate = await session.call('atlas_candidate', {});
  assert.equal(candidate.baseline, await baseline());
  await writeFile(path.join(candidate.path, detailPath), original.replace('(drafts.md)', '(drafts.md#nope)'));
  await writeFile(path.join(candidate.path, 'trees/evidence/points/observed.md'), (await readFile(path.join(root, 'trees/evidence/points/observed.md'), 'utf8')).replace('../report.md#result', '../report.md#no-such-heading'));
  const checked = await session.call('atlas_validate', { from: '.atlas-candidate' });
  assert.equal(checked.status, 'ready');
  assert.deepEqual(checked.linkDiagnostics.map(item => [item.code, item.path]), [['REFERENCE_FRAGMENT', detailPath]]);
  assert.deepEqual(checked.missingSources.map(item => [item.from.id, item.uri, item.code]), [['observed', '../report.md#no-such-heading', 'SOURCE_HEADING_MISSING']]);
  assert.deepEqual([checked.unreadSources, checked.bounds.linkDiagnostics, checked.bounds.missingSources], [0, { available: 1, returned: 1 }, { available: 1, returned: 1 }]);
  // A session launched with the Atlas root alone cannot read the source outside it, and says so.
  const { session: narrow } = await fixture(t, false);
  const narrowCandidate = await narrow.call('atlas_candidate', {});
  await writeFile(path.join(narrowCandidate.path, 'trees/evidence/points/observed.md'), (await readFile(path.join(narrowCandidate.path, 'trees/evidence/points/observed.md'), 'utf8')).replace('../report.md#result', '../report.md#no-such-heading'));
  const unread = await narrow.call('atlas_validate', { from: '.atlas-candidate' });
  assert.deepEqual([unread.status, unread.missingSources, unread.unreadSources], ['ready', [], 1]);
});

test('agent review reads the bytes of the saved draft, bounded by default and whole on request', async t => {
  const { root, session, original } = await fixture(t);
  const view = await openAtlas(root);
  const content = markdown({ id: 'recovery', uncertainty: 'Unsaved text can be lost.' }, 'Saved drafts survive an editor crash', 'Keep the unsaved text limitation explicit. [Draft storage](drafts.md) explains how.');
  const plan = structuredClone(prepareChange(view, { changes: [{ path: detailPath, content }], reason: 'Shorten the claim.' }));
  plan.candidate.atlas.points.find(point => point.id === 'recovery').body = 'A caller-invented explanation.';
  const saved = await saveDraft(root, { plan });
  const review = await session.call('atlas_review', { id: saved.id, expectedRevision: saved.revision });
  assert.deepEqual(Object.keys(review), ['format', 'status', 'draft', 'effects', 'bounds', 'next', 'details']);
  assert.deepEqual([review.draft.id, review.draft.revision, review.draft.status, review.draft.stale], [saved.id, saved.revision, 'ready', false]);
  assert.equal(review.effects.format, 'atlas.impact-summary/1');
  assert.deepEqual(review.effects.points.map(point => [point.id, point.changes, point.above, point.facets, point.body]), [['recovery', ['explanation'], ['purpose'], ['service/limits'], undefined]]);
  assert.ok(review.effects.linkDiagnostics.some(item => item.code === 'REFERENCE_MISSING') === false);
  assert.equal(review.details.complete, false);
  const full = await session.call('atlas_review', { id: saved.id, full: true });
  assert.match(full.effects.changedPoints[0].after.body, /unsaved text limitation/);
  assert.match(full.effects.changedPoints[0].before.body, /Evidence meaning/);
  const chunk = await session.call('atlas_review', { id: saved.id, part: 'details', maxBytes: 400 });
  assert.ok(chunk.nextOffset); assert.equal(chunk.text.length <= 400, true);
  await assert.rejects(session.call('atlas_review', { id: saved.id, expectedRevision: '0'.repeat(64) }), { code: 'STALE_DRAFT' });
  await assert.rejects(session.call('atlas_review', { id: 'absent' }), { code: 'NOT_FOUND' });
  const summary = await session.call('atlas_drafts', { action: 'load', id: saved.id });
  assert.equal(summary.draft.plan.changes[0].after, undefined);
  assert.equal(summary.draft.plan.changes[0].action, 'write');
  assert.equal(summary.draft.plan.candidate.files[0].content, undefined);
  const details = await session.call('atlas_drafts', { action: 'load', id: saved.id, part: 'details', maxBytes: 400 });
  assert.ok(details.nextOffset);
  const whole = await session.call('atlas_drafts', { action: 'load', id: saved.id, full: true });
  assert.match(whole.draft.plan.candidate.atlas.points.find(point => point.id === 'recovery').body, /unsaved text limitation/);
  // Without part, offset starts the lists of a summary and stops at 100000, as the other bounds do; with it, it is a byte offset.
  for (const [name, args, returned] of [['atlas_review', { id: saved.id }, value => value.bounds.points.returned], ['atlas_drafts', { action: 'load', id: saved.id }, value => value.draft.bounds.changes.returned]]) {
    await assert.rejects(session.call(name, { ...args, offset: 100001 }), { code: 'INVALID_ARGUMENT', message: 'arguments.offset is outside its bound: at most 100000 without part "details".' }, name);
    assert.equal(returned(await session.call(name, { ...args, offset: 100000 })), 0, name);
    const { byteLength } = await session.call(name, { ...args, part: 'details', maxBytes: 4 });
    await assert.rejects(session.call(name, { ...args, part: 'details', offset: byteLength + 1 }), { code: 'atlas.inventory.invalid-argument' }, name);
  }
});

test('agent reads every chunk of a draft and of its review, past 4 MiB of text, and they join into the text whole', async t => {
  const { root, session } = await fixture(t);
  const view = await openAtlas(root);
  const long = 'Saved drafts survive an editor crash and stay on disk. '.repeat(23000);
  const changes = ['purpose', 'recovery'].map(id => {
    const file = view.files.find(entry => entry.path === `trees/service/points/${id}.md`);
    return { path: file.path, content: `${file.content}\n${long}\n` };
  });
  const saved = await saveDraft(root, { plan: prepareChange(view, { changes, reason: 'Two long explanations.' }) });
  for (const [name, args] of [['atlas_drafts', { action: 'load', id: saved.id }], ['atlas_review', { id: saved.id }]]) {
    const parts = [];
    let offset = 0, sha256, byteLength;
    while (offset !== null) {
      const chunk = await session.call(name, { ...args, part: 'details', offset, maxBytes: 131072, ...(sha256 ? { expectedSha256: sha256 } : {}) });
      assert.equal(chunk.offset, offset, name);
      parts.push(Buffer.from(chunk.text, 'utf8'));
      ({ sha256, byteLength } = chunk);
      offset = chunk.nextOffset;
      if (offset === null) assert.equal(chunk.complete, true, name);
    }
    const text = Buffer.concat(parts);
    assert.ok(byteLength > 4 * 1024 * 1024, `${name}: ${byteLength}`);
    assert.deepEqual([text.length, createHash('sha256').update(text).digest('hex')], [byteLength, sha256], name);
    const whole = JSON.parse(text.toString('utf8'));
    assert.equal(name === 'atlas_review' ? whole.draft.revision : whole.revision, saved.revision, name);
  }
});

test('agent validate of a candidate counts as unread the references past the bound of one stale report', async t => {
  const { root, session } = await fixture(t);
  const written = await session.call('atlas_candidate', {});
  // The first Point read takes the whole bound with remote references, so the observation's source, which names no
  // heading, is never read.
  const sources = Array.from({ length: 10000 }, (_, index) => ({ uri: `https://example.com/${index}`, role: 'background' }));
  await writeFile(path.join(written.path, 'trees/service/points/purpose.md'), markdown({ id: 'purpose', sources }, 'Writers keep their work', 'Help writers understand the limits of their tools.'));
  await writeFile(path.join(written.path, 'trees/evidence/points/observed.md'), (await readFile(path.join(root, 'trees/evidence/points/observed.md'), 'utf8')).replace('../report.md#result', '../report.md#no-such-heading'));
  const checked = await session.call('atlas_validate', { from: '.atlas-candidate' });
  assert.deepEqual([checked.status, checked.missingSources, checked.unreadSources], ['ready', [], 1], JSON.stringify(checked.diagnostics));
  assert.ok(checked.limits.includes('1 source reference was not read, being past the 10000 references one stale report reads, so a missing source among them is not listed.'), JSON.stringify(checked.limits));
});

test('agent stamp saves a draft for what was read, and stale then follows the cited section', async t => {
  const { root, parent, session, baseline } = await fixture(t);
  const before = await session.call('atlas_stale', {});
  assert.deepEqual(before.counts, { references: 1, current: 0, changed: 0, missing: 0, denied: 0, unstamped: 1, remote: 0 });
  await assert.rejects(session.call('atlas_stamp', { baseline: await baseline() }), { code: 'atlas.references.invalid-argument' });
  await assert.rejects(session.call('atlas_stamp', { baseline: '0'.repeat(64), all: true }), { code: 'STALE' });
  await assert.rejects(session.call('atlas_stamp', { all: true }), { code: 'INVALID_ARGUMENT' });
  const nothing = await session.call('atlas_stamp', { baseline: await baseline(), tree: 'service' });
  assert.deepEqual([nothing.status, nothing.draft, nothing.counts.records], ['noop', null, 4]);
  const stamp = await session.call('atlas_stamp', { baseline: await baseline(), points: ['observed'], reason: 'Read against the report' });
  assert.deepEqual([stamp.format, stamp.status, stamp.plan], ['atlas.stamp/1', 'ready', undefined]);
  assert.deepEqual(stamp.stamped.map(item => [item.from.id, item.uri, item.scope]), [['observed', '../report.md#result', 'section']]);
  assert.deepEqual(stamp.bounds, { stamped: { available: 1, returned: 1 }, current: { available: 0, returned: 0 }, skipped: { available: 0, returned: 0 } });
  assert.equal(stamp.draft.plan.reason, 'Read against the report');
  assert.deepEqual(stamp.draft.plan.changes.map(change => change.path), ['trees/evidence/points/observed.md']);
  assert.equal((await session.call('atlas_apply', { id: stamp.draft.id, expectedRevision: stamp.draft.revision })).status, 'complete');
  assert.equal((await session.call('atlas_stale', {})).counts.current, 1);
  await writeFile(path.join(parent, 'report.md'), report('One saved draft survived restart.').replace('One laptop', 'Two laptops'));
  assert.equal((await session.call('atlas_stale', { full: true })).references[0].status, 'current');
  assert.equal((await session.call('atlas_stale', {})).references, undefined, 'by default the report is its counts and its summary');
  await writeFile(path.join(parent, 'report.md'), report('Two saved drafts survived restart.'));
  const changed = await session.call('atlas_stale', {});
  assert.deepEqual(changed.summary.map(item => [item.uri, item.status, item.citers.map(citer => citer.id)]), [['../report.md#result', 'changed', ['observed']]]);
  const source = (await session.call('atlas_inspect', { point: 'observed' })).record.sources[0];
  assert.equal((await session.call('atlas_read_source', { source })).stamp, 'changed');
  const ungranted = createToolSession(root);
  assert.equal((await ungranted.call('atlas_stale', { full: true })).references[0].status, 'denied');
  await assert.rejects(session.call('atlas_stale', { allowedRoots: [parent] }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(session.call('atlas_stale', { expectedIdentity: '0'.repeat(64) }), { code: 'STALE' });
});

test('agent move and absorb prepare a repaired move and inspect incoming material without saving a proposal', async t => {
  const { root, session, baseline } = await fixture(t);
  const moved = await session.call('atlas_move', { baseline: await baseline(), point: 'drafts', path: 'trees/service/points/storage/drafts.md', reason: 'Group the storage Points.' });
  assert.equal(moved.plan.status, 'ready');
  assert.deepEqual(moved.plan.changes.map(change => change.path).sort(), ['trees/service/points/drafts.md', detailPath, 'trees/service/points/storage/drafts.md'].sort());
  await assert.rejects(session.call('atlas_move', { point: 'drafts', path: 'trees/service/points/storage/drafts.md', reason: 'No baseline.' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(session.call('atlas_move', { baseline: await baseline(), point: 'drafts', path: 'trees/evidence/points/drafts.md', reason: 'Another Tree.' }), { code: 'atlas.references.invalid-argument' });
  assert.equal((await session.call('atlas_apply', { id: moved.id, expectedRevision: moved.revision })).status, 'complete');
  assert.match(await readFile(path.join(root, detailPath), 'utf8'), /\[Draft storage\]\(storage\/drafts\.md\)/);
  assert.equal((await session.call('atlas_inspect', { point: 'drafts' })).record.path, 'trees/service/points/storage/drafts.md');
  const drafts = (await session.call('atlas_drafts', { action: 'list' })).drafts.length;
  const inspection = await session.call('atlas_absorb', { text: 'A saved draft survived an editor crash on a second runtime.', source: { uri: 'reports/second.md', role: 'evidence' } });
  assert.equal(inspection.status, 'candidates');
  assert.equal(inspection.candidates[0].point.id, 'recovery');
  assert.ok(inspection.interpretations.some(entry => entry.facet.id === 'limits'));
  assert.equal((await session.call('atlas_drafts', { action: 'list' })).drafts.length, drafts);
  await assert.rejects(session.call('atlas_absorb', { text: 'New material.', source: { uri: 'reports/second.md' }, proposal: {} }), { code: 'INVALID_ARGUMENT' });
  // The completed move removed its journal, so there is nothing to recover.
  assert.deepEqual(await session.call('atlas_recover', {}), { format: 'atlas.transactions/1', status: 'ready', transactions: [], unreadable: [] });
});

test('agent lists each draft and journal it cannot read beside the rest, and holds every apply while one is unfinished', async t => {
  const { root, session, baseline } = await fixture(t);
  const draft = await session.call('atlas_prepare', { baseline: await baseline(), reason: 'Say how drafts are stored.', changes: [{ path: 'trees/service/points/drafts.md', content: markdown({ id: 'drafts' }, 'Saved drafts stay on disk', 'Saved drafts stay on disk until applied.') }] });
  const state = (await resolveState(root)).directory;
  await mkdir(path.join(state, 'transactions'), { recursive: true });
  await writeFile(path.join(state, 'transactions/left-over.json'), JSON.stringify({ format: 'atlas.transaction/1', id: 'left-over', phase: 'interrupted', createdAt: '2026-11-15T00:00:00.000Z',
    baseline: draft.plan.baseline.identity, result: draft.plan.validation.identity, changes: [], written: [], error: { code: 'EACCES', message: 'Permission denied.' } }));
  await writeFile(path.join(state, 'drafts/torn.json'), '{');
  await writeFile(path.join(state, 'transactions/torn.json'), '{');
  const torn = { file: 'torn.json', code: 'INVALID_STATE', message: 'Saved state is malformed.' };
  const listed = await session.call('atlas_drafts', { action: 'list' });
  assert.deepEqual([listed.status, listed.drafts.map(item => item.id), listed.unreadable], ['ready', [draft.id], [torn]]);
  const transactions = await session.call('atlas_recover', {});
  assert.deepEqual([transactions.status, transactions.transactions.map(item => [item.id, item.phase]), transactions.unreadable], ['ready', [['left-over', 'interrupted']], [torn]]);
  await assert.rejects(session.call('atlas_apply', { id: draft.id, expectedRevision: draft.revision }), { code: 'LOCKED', message: 'Interrupted transaction left-over needs recovery.' });
  const recovered = await session.call('atlas_recover', { id: 'left-over' });
  assert.deepEqual([recovered.status, recovered.baselineRestored, recovered.view.identity], ['rolled-back', true, draft.plan.baseline.identity]);
  // The rolled-back journal is removed; the one that cannot be read stays, and holds every apply.
  assert.deepEqual(await session.call('atlas_recover', {}), { format: 'atlas.transactions/1', status: 'ready', transactions: [], unreadable: [torn] });
  await assert.rejects(session.call('atlas_apply', { id: draft.id, expectedRevision: draft.revision }), { code: 'INVALID_STATE', message: 'Transaction journal torn cannot be read: Saved state is malformed.' });
  await rm(path.join(state, 'transactions/torn.json'));
  assert.equal((await session.call('atlas_apply', { id: draft.id, expectedRevision: draft.revision })).status, 'complete');
});

test('agent candidate returns the baseline it recorded, and a copy of an earlier Atlas is refused', async t => {
  const { root, session, original, baseline } = await fixture(t);
  const written = await session.call('atlas_candidate', {});
  assert.equal(written.baseline, await baseline());
  await writeFile(path.join(written.path, detailPath), original.replace('explains how', 'says how'));
  await writeFile(path.join(root, 'trees/service/points/drafts.md'), markdown({ id: 'drafts' }, 'Saved drafts stay on disk', 'An edit made outside the session.'));
  const changed = { code: 'STALE', message: 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.' };
  await assert.rejects(session.call('atlas_validate', { from: '.atlas-candidate' }), changed);
  const refreshed = await session.call('atlas_refresh', {});
  await assert.rejects(session.call('atlas_prepare', { baseline: refreshed.identity, reason: 'Say how.', candidate: '.atlas-candidate' }), changed);
  const fresh = await session.call('atlas_candidate', {});
  assert.equal(fresh.baseline, refreshed.identity);
  await writeFile(path.join(fresh.path, detailPath), original.replace('explains how', 'says how'));
  assert.equal((await session.call('atlas_prepare', { baseline: fresh.baseline, reason: 'Say how.', candidate: '.atlas-candidate' })).plan.status, 'ready');
});

test('every tool says what it does and when to use it in two sentences, and bounds what it accepts', () => {
  assert.equal(TOOLS.length, 22);
  for (const tool of TOOLS) {
    assert.match(tool.name, /^atlas_[a-z_]+$/);
    assert.equal(tool.description.split(/(?<=[.!?])\s+/).length, 2, tool.name);
    const unbounded = [];
    (function walk(schema, location) {
      if (schema.type === 'string' && schema.maxLength === undefined) unbounded.push(location);
      if (schema.type === 'integer' && schema.maximum === undefined) unbounded.push(location);
      if (schema.type === 'array' && schema.maxItems === undefined) unbounded.push(location);
      if (schema.type === 'object' && schema.additionalProperties !== false) unbounded.push(location);
      for (const [key, child] of Object.entries(schema.properties ?? {})) walk(child, `${location}.${key}`);
      if (schema.items) walk(schema.items, `${location}[]`);
    })(tool.inputSchema, tool.name);
    assert.deepEqual(unbounded, []);
  }
});
