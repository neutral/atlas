import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, cp, symlink, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { createToolSession } from '../../agent/src/tools.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const detailPath = 'trees/service/points/recovery.md';
const design = (storage, sync = 'Queued edits are sent when the connection returns.') => `# Design\n\nIntroduction.\n\n## Storage\n\n${storage}\n\n## Sync\n\n${sync}\n`;
const section = text => createHash('sha256').update(text).digest('hex');
function run(root, args, input, grants = []) {
  const result = spawnSync(process.execPath, [cli, '--root', root, ...grants.flatMap(grant => ['--allow-source-root', grant]), ...args], { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.signal, null);
  return { code: result.status, value: result.stdout ? JSON.parse(result.stdout) : null, error: result.stderr ? JSON.parse(result.stderr).error : null };
}
function success(result) { assert.equal(result.code, 0, JSON.stringify(result.error ?? result.value)); return result.value; }
function applied(root, draft) { assert.equal(success(run(root, ['apply', draft.id, '--revision', draft.revision])).status, 'complete'); }
async function fixture(t) {
  const directory = await tempDirectory('atlas-cli-reading-'), root = path.join(directory, 'atlas');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = {
    'atlas.json': JSON.stringify({ format: 'atlas/1.2', id: 'work', title: 'Work', trees: ['trees/service', 'trees/evidence'] }),
    'style.md': '# Two accounts\n\nThe service account says what writers can rely on. The evidence account says what was seen.\n',
    'trees/service/tree.json': JSON.stringify({ id: 'service', title: 'Service', scope: 'Editing safely.', base: 'purpose', children: [{ point: 'recovery', children: [{ point: 'drafts' }] }] }),
    'trees/evidence/tree.json': JSON.stringify({ id: 'evidence', title: 'Evidence', scope: 'Observed behavior.', base: 'observed', children: [] }),
    'trees/service/points/purpose.md': markdown({ id: 'purpose' }, 'Writers keep their work', 'Help writers preserve their work. '.repeat(10)),
    [detailPath]: markdown({ id: 'recovery', sources: [{ uri: '../design.md#storage', role: 'evidence' }, { uri: 'https://example.com/spec', role: 'background' }], uncertainty: 'Unsaved text can be lost.' }, 'Saved drafts survive an editor crash', 'Saved drafts survive an editor crash. Read [draft storage](drafts.md).'),
    'trees/service/points/drafts.md': markdown({ id: 'drafts', sources: [{ uri: '../design.md' }] }, 'Saved drafts stay on disk', 'Saved drafts remain on disk for recovery.'),
    'trees/evidence/points/observed.md': markdown({ id: 'observed', type: 'observation', observedAt: '2026-09-27', sources: [{ uri: '../report.md' }], uncertainty: 'One runtime only.' }, 'One saved draft survived a restart', 'One saved draft survived restart.'),
    'trees/service/facets/limits.md': markdown({ id: 'limits', on: 'recovery', via: 'evidence', targets: ['observed'] }, 'The evidence covers one runtime', 'Read the [observation](../../evidence/points/observed.md) before extending the claim.'),
    '.checks/scope.md': markdown({ id: 'scope', status: 'active', level: 'required' }, 'Keep the limit', '## Requirement\n\nRetain the unsaved text limitation.\n\n## Verification\n\nRead the full changed explanation.\n\n## Failure\n\nReject an unqualified recovery claim.'),
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content);
  }
  await writeFile(path.join(directory, 'design.md'), design('Drafts are written to local storage.'));
  await writeFile(path.join(directory, 'report.md'), 'One saved draft survived restart.');
  return { directory, root, original: files[detailPath] };
}

test('CLI summary search and Route continuation round-trip across independent processes', async t => {
  const { root } = await fixture(t);
  const found = success(run(root, ['search', '-'], { query: 'What if my editor crashes?', presentation: 'summary' }));
  assert.equal(found.format, 'atlas.search/1');
  assert.equal(found.results[0].id, 'recovery'); assert.equal(found.results[0].body, undefined);
  // The list says how many matched in all, and how to read the ones left out.
  const many = success(run(root, ['search', '-'], { query: 'saved draft' })), all = many.bounds.available;
  assert.ok(all > 1, JSON.stringify(many.bounds));
  assert.deepEqual([many.bounds, many.next], [{ offset: 0, limit: 20, available: all, returned: all }, null]);
  const one = success(run(root, ['search', '-'], { query: 'saved draft', limit: 1 }));
  assert.deepEqual([one.bounds, one.next], [{ offset: 0, limit: 1, available: all, returned: 1 }, { kinds: ['point', 'facet'], presentation: 'summary', query: 'saved draft', limit: 1, offset: 1 }]);
  const rest = success(run(root, ['search', '-'], one.next));
  assert.deepEqual([rest.results[0].id, rest.bounds.returned], [many.results[1].id, 1]);
  // Each result keeps its standing: an observation its date.
  assert.deepEqual(many.results.filter(result => result.type).map(result => [result.id, result.type, result.observedAt]), [['observed', 'observation', '2026-09-27']]);
  // kinds names one kind or both, each once: anything else is invalid input.
  for (const kinds of [[], ['point', 'point']]) {
    assert.deepEqual([run(root, ['search', '-'], { query: 'draft', kinds }).code, run(root, ['search', '-'], { query: 'draft', kinds }).error.code], [2, 'CLI_INVALID_ARGUMENT'], JSON.stringify(kinds));
    assert.deepEqual([run(root, ['route', '-'], { query: 'draft', kinds }).code, run(root, ['route', '-'], { query: 'draft', kinds }).error.code], [2, 'atlas.route.invalid-argument'], JSON.stringify(kinds));
  }
  const exact = success(run(root, ['route', '-'], { ...found.results[0].selector, orientation: 'compact' }));
  assert.match(exact.selected[0].point.body, /Saved drafts/);
  assert.equal(exact.orientation[0].base.body, undefined);
  assert.equal(exact.facets[0].facet.id, 'limits');
  const first = success(run(root, ['route', '-'], { query: 'saved draft', mode: 'discover', limit: 1 }));
  const second = success(run(root, ['route', '-'], first.next.selected));
  assert.notEqual(first.selected[0].point.id, second.selected[0].point.id);
  assert.deepEqual(second.orientation, []);
  // A continuation of another request is invalid input; one of an Atlas that has changed since is a conflict with it.
  const mismatch = run(root, ['route', '-'], { ...first.next.selected, limit: 2 });
  assert.deepEqual([mismatch.code, mismatch.error.code], [2, 'atlas.route.cursor-mismatch']);
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'Changed purpose', 'An independent correction.'));
  const stale = run(root, ['route', '-'], first.next.selected);
  assert.deepEqual([stale.code, stale.error.code], [3, 'atlas.route.stale-cursor']);
});

test('review and drafts show read a chunk at any byte offset of the text, and page the summary up to 100000', async t => {
  const { root, original } = await fixture(t);
  const draft = success(run(root, ['prepare', '-'], { reason: 'A long explanation.', changes: [{ path: detailPath, content: `${original}\n${'Saved drafts survive an editor crash. '.repeat(4000)}\n` }] }));
  for (const args of [['review', draft.id, '-'], ['drafts', 'show', draft.id, '-']]) {
    const whole = success(run(root, args, { part: 'details', maxBytes: 4 }));
    assert.ok(whole.byteLength > 200000, `${args[0]}: ${whole.byteLength}`);
    const late = success(run(root, args, { part: 'details', offset: 150000, maxBytes: 4, expectedSha256: whole.sha256 }));
    assert.deepEqual([late.offset, late.returnedBytes, late.sha256], [150000, 4, whole.sha256], args[0]);
    assert.equal(run(root, args, { offset: 100001 }).code, 2, `${args[0]}: the summary pages up to 100000`);
  }
});

test('CLI read-source reads one source within the grants and prints what atlas_read_source returns', async t => {
  const { directory, root } = await fixture(t);
  const session = createToolSession(root, { allowedRoots: [directory] });
  for (const uri of ['../design.md#storage', '../report.md', '../design.md#no-such-heading', 'https://example.com/spec']) {
    const read = run(root, ['read-source', uri], undefined, [directory]);
    assert.equal(read.code, 0, JSON.stringify(read.error));
    assert.deepEqual(read.value, await session.call('atlas_read_source', { source: { uri } }), uri);
  }
  const section = run(root, ['read-source', '../design.md#storage'], undefined, [directory]).value;
  assert.deepEqual([section.status, section.cited.scope, section.cited.heading, section.stamp], ['ready', 'section', 'storage', 'unstamped'], 'a URI carries no stamp, so none is compared');
  // Outside the grants a source is denied, and a file that is not there is missing: each exits 1.
  const denied = run(root, ['read-source', '../design.md']);
  assert.deepEqual([denied.code, denied.value.status, denied.value.code], [1, 'denied', 'SOURCE_DENIED']);
  const missing = run(root, ['read-source', 'nowhere.md']);
  assert.deepEqual([missing.code, missing.value.status], [1, 'missing']);
  for (const args of [['read-source'], ['read-source', '--full'], ['read-source', 'a.md', 'b.md']]) assert.equal(run(root, args).code, 2, args.join(' '));
});

test('CLI references distinguish links, citers and citations, honor the limit and refuse a mixed selection', async t => {
  const { root } = await fixture(t);
  const index = success(run(root, ['references', '-'], {}));
  assert.equal(index.format, 'atlas.references/1');
  assert.ok(index.references.some(reference => reference.from.id === 'limits' && reference.target.id === 'observed'));
  assert.deepEqual(success(run(root, ['references', '-'], { point: 'drafts' })).citers.map(citer => citer.record.id), ['recovery']);
  assert.equal(success(run(root, ['references', '-'], { uri: '../design.md#storage' })).citations[0].from.id, 'recovery');
  await writeFile(path.join(root, 'trees/service/points/purpose.md'), markdown({ id: 'purpose' }, 'Purpose', 'Read [draft storage](drafts.md).'));
  const limited = success(run(root, ['references', '-'], { point: 'drafts', limit: 1 }));
  assert.equal(limited.citers.length, 1);
  assert.deepEqual(limited.bounds, { available: 2, returned: 1, exhaustive: false }, 'never exhaustive while more remains');
  for (const request of [{ point: 'drafts', uri: '../design.md' }, { tree: 'service' }, { facet: 'limits' }, { point: 'drafts', sources: true }]) {
    const refused = run(root, ['references', '-'], request);
    assert.equal(refused.code, 2, JSON.stringify(request));
  }
});

test('CLI inspect prints a record, the Style and every Check whole, and pages the summary', async t => {
  const { root } = await fixture(t);
  const point = success(run(root, ['inspect', 'point', 'recovery']));
  assert.deepEqual(Object.keys(point), ['format', 'status', 'identity', 'kind', 'record', 'diagnostics']);
  assert.equal(point.record.owner.id, 'service');
  assert.deepEqual(point.record.ancestors.map(ancestor => ancestor.id), ['purpose']);
  assert.deepEqual(point.record.facets.map(facet => facet.id), ['limits']);
  assert.equal(success(run(root, ['inspect', 'point', 'observed'])).record.incomingFacets[0].id, 'limits');
  assert.equal(success(run(root, ['inspect', 'tree', 'service'])).record.base, 'purpose');
  const facet = success(run(root, ['inspect', 'facet', 'service', 'limits']));
  assert.equal(facet.record.host.id, 'recovery'); assert.equal(facet.record.resolvedTargets[0].id, 'observed');
  const style = success(run(root, ['inspect', 'style']));
  assert.deepEqual(style.record, { title: 'Two accounts', body: 'The service account says what writers can rely on. The evidence account says what was seen.', path: 'style.md' });
  const checks = success(run(root, ['inspect', 'checks']));
  assert.equal(checks.kind, 'checks');
  assert.equal(checks.records.length, 1);
  assert.match(checks.records[0].body, /Retain the unsaved text limitation/);
  assert.equal(checks.records[0].status, 'active');
  const missing = run(root, ['inspect', 'point', 'absent']);
  assert.equal(missing.code, 1); assert.equal(missing.value.status, 'missing');
  for (const args of [['inspect', 'branch', 'x'], ['inspect', 'style', 'extra'], ['inspect', 'checks', 'scope'], ['inspect', 'point']]) assert.notEqual(run(root, args).code, 0, args.join(' '));
  const summary = success(run(root, ['inspect']));
  assert.equal(summary.atlas.points.length, 4); assert.equal(summary.atlas.points[0].body, undefined);
  assert.deepEqual(summary.atlas.style, { title: 'Two accounts', path: 'style.md' });
  const page = success(run(root, ['inspect', '-'], { section: 'points', limit: 1 }));
  assert.equal(page.atlas.points.length, 1);
  const next = success(run(root, ['inspect', '-'], page.bounds.points.next));
  assert.notEqual(next.atlas.points[0].id, page.atlas.points[0].id);
  assert.equal(run(root, ['inspect', '-'], { section: 'branches' }).code, 2);
  const full = success(run(root, ['inspect', '--full']));
  assert.ok(full.files.every(file => typeof file.content === 'string'));
});

test('stamp records what each source cites now, and stale then tells a changed section from an untouched one', async t => {
  const { root, directory, original } = await fixture(t), grants = [directory];
  const before = success(run(root, ['stale'], undefined, grants));
  assert.equal(before.format, 'atlas.stale/1');
  assert.deepEqual(before.counts, { references: 4, current: 0, changed: 0, missing: 0, denied: 0, unstamped: 3, remote: 1 });
  assert.equal(before.references, undefined, 'by default the report is its counts and its summary');
  const denied = success(run(root, ['stamp', '--point', 'recovery']));
  assert.equal(denied.status, 'noop'); assert.equal(denied.draft, null);
  assert.deepEqual(denied.skipped.map(item => [item.uri, item.status]), [['../design.md#storage', 'denied'], ['https://example.com/spec', 'remote']]);
  for (const args of [['stamp'], ['stamp', '--all', '--tree', 'service'], ['stamp', '--point', 'absent'], ['stamp', '--tree', 'absent']]) assert.equal(run(root, args, undefined, grants).code, 2, args.join(' '));
  const stamp = success(run(root, ['stamp', '--tree', 'service', '--reason', 'Read against the design'], undefined, grants));
  assert.equal(stamp.format, 'atlas.stamp/1'); assert.equal(stamp.status, 'ready');
  assert.deepEqual(stamp.counts, { records: 4, stamped: 2, current: 0, skipped: 1 });
  assert.deepEqual(stamp.stamped.map(item => [item.from.id, item.scope]), [['drafts', 'file'], ['recovery', 'section']]);
  assert.equal(stamp.stamped[1].sha256, section('## Storage\n\nDrafts are written to local storage.\n\n'));
  assert.equal(stamp.plan, undefined);
  assert.equal(stamp.draft.plan.reason, 'Read against the design');
  assert.deepEqual(stamp.draft.plan.changes.map(change => change.path), ['trees/service/points/drafts.md', detailPath]);
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), original);
  applied(root, stamp.draft);
  assert.match(await readFile(path.join(root, detailPath), 'utf8'), /"sha256":"[a-f0-9]{64}"/);
  const current = success(run(root, ['stale'], undefined, grants));
  assert.deepEqual(current.counts, { references: 4, current: 2, changed: 0, missing: 0, denied: 0, unstamped: 1, remote: 1 });
  assert.deepEqual(current.summary, []);
  const again = success(run(root, ['stamp', '--tree', 'service'], undefined, grants));
  assert.deepEqual([again.status, again.draft, again.counts.current], ['noop', null, 2]);
  await writeFile(path.join(directory, 'design.md'), design('Drafts are written to local storage.', 'Queued edits are sent in order.'));
  const elsewhere = success(run(root, ['stale', '--full'], undefined, grants));
  assert.deepEqual(elsewhere.references.map(item => [item.from.id, item.status]), [['drafts', 'changed'], ['recovery', 'current'], ['recovery', 'remote'], ['observed', 'unstamped']]);
  assert.deepEqual(elsewhere.summary.map(item => [item.uri, item.status, item.citers.map(citer => citer.id)]), [['../design.md', 'changed', ['drafts']]]);
  await writeFile(path.join(directory, 'design.md'), design('Drafts are written to a local database.', 'Queued edits are sent in order.'));
  const changed = success(run(root, ['stale'], undefined, grants));
  assert.equal(changed.counts.changed, 2);
  assert.deepEqual(changed.summary.map(item => item.uri), ['../design.md', '../design.md#storage']);
  const page = success(run(root, ['stale', '-'], { limit: 1, full: true }, grants));
  assert.equal(page.references.length, 1);
  assert.deepEqual(page.bounds.next, { offset: 1, limit: 1, expectedIdentity: page.identity, full: true });
  assert.equal(success(run(root, ['stale', '-'], page.bounds.next, grants)).references[0].from.id, 'recovery');
  // The summary is paged on its own, and the report is exhaustive only on its last page.
  const summarized = success(run(root, ['stale', '-'], { limit: 1 }, grants));
  assert.deepEqual([summarized.references, summarized.summary.map(item => item.uri), summarized.bounds],
    [undefined, ['../design.md'], { limit: 1, offset: 0, summary: { available: 2, returned: 1 }, unread: 0, exhaustive: false, next: { offset: 1, limit: 1, expectedIdentity: summarized.identity } }]);
  const last = success(run(root, ['stale', '-'], summarized.bounds.next, grants));
  assert.deepEqual([last.summary.map(item => item.uri), last.bounds.exhaustive, last.bounds.next], [['../design.md#storage'], true, null]);
  assert.equal(success(run(root, ['stale'])).counts.denied, 2);
  await writeFile(path.join(directory, 'design.md'), '# Design\n\nThe storage section was folded into the introduction.\n');
  const broken = success(run(root, ['stale', '--full'], undefined, grants));
  assert.deepEqual(broken.references.filter(item => item.from.id === 'recovery').map(item => [item.status, item.code]), [['missing', 'SOURCE_HEADING_MISSING'], ['remote', undefined]]);
  assert.deepEqual(broken.summary.map(item => [item.uri, item.status]), [['../design.md', 'changed'], ['../design.md#storage', 'missing']]);
  const unreadable = success(run(root, ['stamp', '--point', 'recovery'], undefined, grants));
  assert.deepEqual([unreadable.status, unreadable.draft], ['noop', null]);
  assert.deepEqual(unreadable.skipped.map(item => [item.status, item.code]), [['missing', 'SOURCE_HEADING_MISSING'], ['remote', undefined]]);
  assert.deepEqual(unreadable.bounds.skipped, { available: 2, returned: 2 });
  await rm(path.join(directory, 'design.md'));
  assert.equal(success(run(root, ['stale'], undefined, grants)).counts.missing, 2);
  await rm(path.join(directory, 'report.md'));
  assert.deepEqual(success(run(root, ['stale', '--full'], undefined, grants)).references.at(-1).status, 'missing', 'an unstamped reference to an absent file is missing');
  assert.equal(run(root, ['stale', '-'], { uris: ['../design.md'] }, grants).code, 2);
});

test('review prints the effects of a draft as a summary by default and whole with --full', async t => {
  const { root, original } = await fixture(t);
  const draft = success(run(root, ['prepare', '-'], { reason: 'Name the next test.', changes: [
    { path: detailPath, content: original + '\nTest a second runtime before broadening support.\n' },
    { path: '.checks/scope.md', content: null },
  ] }));
  assert.deepEqual(draft.plan.changes.map(change => [change.path, change.action]), [[detailPath, 'write'], ['.checks/scope.md', 'remove']]);
  const review = success(run(root, ['review', draft.id]));
  assert.deepEqual(Object.keys(review), ['format', 'status', 'draft', 'effects', 'bounds', 'next', 'details']);
  assert.equal(review.format, 'atlas.draft-review/1');
  assert.deepEqual(review.draft, { id: draft.id, revision: draft.revision, updatedAt: draft.updatedAt, status: 'ready', reason: 'Name the next test.', baseline: draft.plan.baseline.identity, candidate: draft.plan.validation.identity, stale: false });
  const { effects } = review;
  assert.deepEqual(Object.keys(effects), ['format', 'status', 'beforeIdentity', 'afterIdentity', 'counts', 'points', 'facets', 'trees', 'checks', 'changedManifest', 'linkDiagnostics', 'limits']);
  assert.equal(effects.format, 'atlas.impact-summary/1');
  const none = { added: 0, changed: 0, removed: 0 };
  assert.deepEqual(effects.counts, { points: { ...none, changed: 1 }, facets: none, trees: none, checks: { ...none, removed: 1 }, linkDiagnostics: 0 });
  // Each changed record by its ID: what changed, the Points above it, the Facets that bear on it and what mentions it.
  assert.deepEqual(effects.points, [{ id: 'recovery', tree: 'service', changes: ['explanation'], above: ['purpose'], facets: ['service/limits'], mentionedBy: [] }]);
  assert.deepEqual([effects.facets, effects.trees, effects.checks], [[], [], [{ id: 'scope', changes: ['removed'] }]]);
  assert.equal(effects.changedStyle, undefined);
  assert.equal(effects.changedManifest, null);
  assert.deepEqual(review.bounds.points, { available: 1, returned: 1, offset: 0 });
  assert.equal(review.next, null);
  const full = success(run(root, ['review', draft.id, '--full']));
  assert.deepEqual(Object.keys(full), ['format', 'status', 'draft', 'effects']);
  assert.match(full.effects.changedPoints[0].after.body, /second runtime/);
  assert.match(full.effects.changedChecks[0].before.body, /Retain the unsaved text limitation/);
  let offset = 0, sha256, text = '';
  while (offset !== null) {
    const chunk = success(run(root, ['review', draft.id, '-'], { part: 'details', offset, maxBytes: 4096, ...(sha256 ? { expectedSha256: sha256 } : {}) }));
    text += chunk.text; offset = chunk.nextOffset; sha256 = chunk.sha256;
  }
  assert.deepEqual(JSON.parse(text), full);
  assert.equal(run(root, ['review', draft.id, '-'], { limit: 0 }).code, 2);
  assert.equal(run(root, ['review', draft.id, '-'], { checks: true }).code, 2);
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), original);
  const style = success(run(root, ['prepare', '-'], { reason: 'Say what the accounts are for.', changes: [{ path: 'style.md', content: '# Two accounts\n\nOne account promises, the other reports.\n' }] }));
  assert.deepEqual(success(run(root, ['review', style.id])).effects.changedStyle, { before: { title: 'Two accounts', path: 'style.md' }, after: { title: 'Two accounts', path: 'style.md' } });
  const renamed = success(run(root, ['prepare', '-'], { reason: 'Name the Atlas and put the evidence first.', changes: [{ path: 'atlas.json', content: JSON.stringify({ format: 'atlas/1.2', id: 'work', title: 'Working safely', trees: ['trees/evidence', 'trees/service'] }) }] }));
  assert.deepEqual(success(run(root, ['review', renamed.id])).effects.changedManifest, { title: { before: 'Work', after: 'Working safely' }, order: { before: ['service', 'evidence'], after: ['evidence', 'service'] }, added: [], removed: [] });
  const mixed = run(root, ['prepare', '-'], { reason: 'The Style and a Point together.', changes: [{ path: 'style.md', content: '# Two accounts\n\nChanged with another file.\n' }, { path: detailPath, content: original + '\nAnd a Point.\n' }] });
  assert.equal(mixed.code, 1);
  assert.deepEqual([mixed.value.plan.status, mixed.value.plan.validation.status, mixed.value.plan.validation.diagnostics.map(item => item.code)], ['invalid', 'invalid', ['STYLE_CHANGE_ALONE']]);
  const refusedReview = success(run(root, ['review', mixed.value.id]));
  assert.deepEqual([refusedReview.status, refusedReview.draft.status, refusedReview.draft.diagnostics.map(item => item.code)], ['ready', 'invalid', ['STYLE_CHANGE_ALONE']]);
  const shown = run(root, ['drafts', 'show', mixed.value.id]);
  assert.deepEqual([shown.code, shown.value.plan.validation.diagnostics.map(item => item.code), shown.value.plan.candidate.status], [1, ['STYLE_CHANGE_ALONE'], 'ready']);
  assert.equal(run(root, ['apply', mixed.value.id, '--revision', mixed.value.revision]).error.code, 'INVALID_CANDIDATE');
});

test('prepare --from derives the change from a candidate folder, and unsafe or invalid candidates are refused', async t => {
  const { root, directory, original } = await fixture(t), candidate = path.join(directory, 'candidate');
  await cp(root, candidate, { recursive: true });
  await writeFile(path.join(candidate, detailPath), original.replace('Read [draft storage]', 'See [draft storage]'));
  await rm(path.join(candidate, 'trees/service/facets/limits.md'));
  await writeFile(path.join(candidate, 'trees/evidence/points/second.md'), markdown({ id: 'second' }, 'A second run agreed', 'The second run also kept the draft.'));
  await writeFile(path.join(candidate, 'trees/evidence/tree.json'), JSON.stringify({ id: 'evidence', title: 'Evidence', scope: 'Observed behavior.', base: 'observed', children: [{ point: 'second' }] }));
  await writeFile(path.join(candidate, 'notes.txt'), 'Working notes that are not part of the Atlas.');
  for (const args of [['prepare', '--from', candidate], ['prepare', '--reason', 'No folder'], ['prepare', '--from', candidate, '--reason', 'Twice', '--from', candidate], ['prepare', '--from', candidate, '--reason', ' ']]) assert.equal(run(root, args).code, 2, args.join(' '));
  assert.equal(success(run(root, ['drafts'])).drafts.length, 0);
  const draft = success(run(root, ['prepare', '--from', candidate, '--reason', 'Record the second run and drop the limit.']));
  assert.equal(draft.plan.status, 'ready');
  assert.deepEqual(draft.plan.changes.map(change => [change.path, change.action]), [
    ['trees/evidence/points/second.md', 'write'], ['trees/evidence/tree.json', 'write'], ['trees/service/facets/limits.md', 'remove'], [detailPath, 'write']]);
  assert.deepEqual([draft.plan.ignored, draft.bounds.ignored], [['notes.txt'], { available: 1, returned: 1 }]);
  const review = success(run(root, ['review', draft.id]));
  assert.deepEqual(review.effects.points.map(point => [point.id, point.changes, point.above]), [['recovery', ['explanation'], ['purpose']], ['second', ['added'], ['observed']]]);
  // A removed record is told as it stood before.
  assert.deepEqual(review.effects.facets, [{ id: 'service/limits', changes: ['removed'], on: 'recovery', targets: ['observed'], mentionedBy: [] }]);
  assert.deepEqual(review.effects.trees, [{ id: 'evidence', changes: ['children'] }]);
  // Each list of the summary is paged, and the next page continues it.
  const paged = success(run(root, ['review', draft.id, '-'], { limit: 1 }));
  assert.deepEqual([paged.effects.points.map(point => point.id), paged.next], [['recovery'], { offset: 1, limit: 1 }]);
  assert.deepEqual(success(run(root, ['review', draft.id, '-'], paged.next)).effects.points.map(point => point.id), ['second']);
  applied(root, draft);
  assert.equal(success(run(root, ['validate'])).identity, success(run(candidate, ['validate'])).identity);
  assert.equal(success(run(root, ['prepare', '--from', candidate, '--reason', 'Nothing more.'])).plan.status, 'noop');

  const inside = path.join(root, 'candidate');
  await cp(candidate, inside, { recursive: true });
  const within = run(root, ['prepare', '--from', inside, '--reason', 'Inside the Atlas.']);
  assert.equal(within.code, 2); assert.equal(within.error.code, 'UNSAFE_PATH');
  await rm(inside, { recursive: true });
  const around = run(root, ['prepare', '--from', directory, '--reason', 'Around the Atlas.']);
  assert.equal(around.code, 2); assert.equal(around.error.code, 'UNSAFE_PATH');
  assert.equal(run(root, ['prepare', '--from', path.join(directory, 'absent'), '--reason', 'No such folder.']).error.code, 'UNSAFE_PATH');
  await symlink(path.join(directory, 'design.md'), path.join(candidate, 'trees/service/points/linked.md'));
  const linked = run(root, ['prepare', '--from', candidate, '--reason', 'A link.']);
  assert.equal(linked.code, 2); assert.equal(linked.error.code, 'UNSAFE_PATH');
  assert.deepEqual(linked.error.diagnostics.map(item => [item.code, item.path]), [['PATH_SYMLINK', 'trees/service/points/linked.md']]);
  await rm(path.join(candidate, 'trees/service/points/linked.md'));

  const drafts = success(run(root, ['drafts'])).drafts.length;
  await writeFile(path.join(candidate, 'trees/service/tree.json'), JSON.stringify({ id: 'service', title: 'Service', scope: 'Editing safely.', base: 'absent', children: [] }));
  const invalid = run(root, ['prepare', '--from', candidate, '--reason', 'A Tree without its Base.']);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.value.plan.status, 'invalid');
  assert.ok(invalid.value.plan.validation.diagnostics.length);
  assert.equal(success(run(root, ['drafts'])).drafts.length, drafts + 1);
  const refused = run(root, ['apply', invalid.value.id, '--revision', invalid.value.revision]);
  assert.equal(refused.code, 1); assert.equal(refused.error.code, 'INVALID_CANDIDATE');
  assert.equal(success(run(root, ['validate'])).status, 'ready');
});

test('validate --from reports the links and sources a candidate breaks, which only review and stale would report later, and they leave it ready', async t => {
  const { root, directory, original } = await fixture(t);
  const written = success(run(root, ['candidate']));
  // The maintainer's probe: a source fragment that names no heading, a source file that is not there, and a link to a record with a fragment.
  await writeFile(path.join(written.path, detailPath), original.replace('../design.md#storage', '../design.md#no-such-heading').replace('(drafts.md)', '(drafts.md#nope)'));
  await writeFile(path.join(written.path, 'trees/service/points/drafts.md'), markdown({ id: 'drafts', sources: [{ uri: '../absent.md' }] }, 'Saved drafts stay on disk', 'Saved drafts remain on disk for recovery.'));
  const checked = run(root, ['validate', '--from', '.atlas-candidate'], undefined, [directory]);
  assert.equal(checked.code, 0, JSON.stringify(checked.value));
  const result = checked.value;
  assert.deepEqual([result.status, result.diagnostics], ['ready', []]);
  assert.deepEqual(result.linkDiagnostics, [{ code: 'REFERENCE_FRAGMENT', path: detailPath, line: result.linkDiagnostics[0].line, column: result.linkDiagnostics[0].column, message: "A link to a record names the record's file and carries no fragment: drafts.md#nope" }]);
  assert.deepEqual(result.missingSources, [
    { from: { kind: 'point', id: 'drafts', tree: 'service', path: 'trees/service/points/drafts.md' }, sourceIndex: 0, uri: '../absent.md', reason: 'The cited file does not exist.' },
    { from: { kind: 'point', id: 'recovery', tree: 'service', path: detailPath }, sourceIndex: 0, uri: '../design.md#no-such-heading', code: 'SOURCE_HEADING_MISSING', reason: 'The fragment names no heading in the cited file, so the reference cites nothing.' },
  ]);
  assert.deepEqual([result.unreadSources, result.bounds], [0, { linkDiagnostics: { available: 1, returned: 1 }, missingSources: { available: 2, returned: 2 } }]);
  // Without the grant the sources outside the Atlas are not read, and the result says how many, so an empty list is not taken for a clean one.
  const ungranted = success(run(root, ['validate', '--from', '.atlas-candidate']));
  assert.deepEqual([ungranted.status, ungranted.missingSources, ungranted.unreadSources, ungranted.linkDiagnostics.length], ['ready', [], 3, 1]);
  assert.match(ungranted.limits.at(-1), /^3 local source references were not read here/);
  // Review reports the same link diagnostics once the candidate is prepared.
  const draft = success(run(root, ['prepare', '--from', '.atlas-candidate', '--reason', 'The probe.']));
  assert.deepEqual(success(run(root, ['review', draft.id])).effects.linkDiagnostics, result.linkDiagnostics);
});

test('candidate writes the copy that validate --from and prepare --from take by name, and discovery never takes it for an Atlas', async t => {
  const { root, directory, original } = await fixture(t);
  const before = success(run(root, ['validate']));
  const written = success(run(root, ['candidate']));
  assert.deepEqual(written, { format: 'atlas.candidate/1', status: 'ready', path: path.join(root, '.atlas-candidate'), files: 10, baseline: before.identity });
  assert.equal(success(run(root, ['validate'])).identity, before.identity);
  const unchanged = success(run(root, ['validate', '--from', '.atlas-candidate'], undefined, [directory]));
  assert.deepEqual(unchanged, { format: 'atlas.validation/1', status: 'ready', identity: before.identity, diagnostics: [], candidate: written.path, changes: [], ignored: [],
    linkDiagnostics: [], missingSources: [], unreadSources: 0, bounds: { linkDiagnostics: { available: 0, returned: 0 }, missingSources: { available: 0, returned: 0 } }, limits: unchanged.limits });
  // An edit in the copy with plain file writes; validation names what differs and saves nothing.
  const copy = path.join(written.path, detailPath);
  await writeFile(copy, original.replace('Read [draft storage]', 'See [draft storage]'));
  await writeFile(path.join(written.path, 'notes.txt'), 'Working notes.');
  const checked = success(run(root, ['validate', '--from', '.atlas-candidate']));
  assert.deepEqual([checked.status, checked.changes, checked.ignored], ['ready', [{ path: detailPath, action: 'write' }], ['notes.txt']]);
  // What prepare would refuse, validate reports: the Style changed with another file.
  const style = await readFile(path.join(written.path, 'style.md'), 'utf8');
  await writeFile(path.join(written.path, 'style.md'), `${style}\nOne more rule.\n`);
  const mixed = run(root, ['validate', '--from', `${written.path}/`]);
  assert.equal(mixed.code, 1);
  assert.deepEqual([mixed.value.status, mixed.value.diagnostics.map(item => item.code), mixed.value.changes.map(change => change.path)], ['invalid', ['STYLE_CHANGE_ALONE'], ['style.md', detailPath]]);
  assert.deepEqual(success(run(root, ['drafts'])).drafts, []);
  await writeFile(path.join(written.path, 'style.md'), style);
  const draft = success(run(root, ['prepare', '--from', '.atlas-candidate', '--reason', 'Say see, not read.']));
  assert.deepEqual([draft.plan.status, draft.plan.changes.map(change => change.path), draft.plan.ignored], ['ready', [detailPath], ['notes.txt']]);
  applied(root, draft);
  assert.equal(await readFile(path.join(root, detailPath), 'utf8'), await readFile(copy, 'utf8'));
  // The copy was made from the Atlas before that apply, so it is refused until candidate writes a fresh one; so is a copy
  // that nothing records the Atlas of.
  const changed = 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.';
  for (const args of [['validate', '--from', '.atlas-candidate'], ['prepare', '--from', '.atlas-candidate', '--reason', 'Again.']]) {
    const refused = run(root, args);
    assert.deepEqual([refused.code, refused.value, refused.error], [3, null, { code: 'STALE', message: changed }], args.join(' '));
  }
  const fresh = success(run(root, ['candidate']));
  assert.equal(fresh.baseline, success(run(root, ['validate'])).identity);
  assert.equal(success(run(root, ['validate', '--from', '.atlas-candidate'])).changes.length, 0);
  await rm(path.join(success(run(root, ['state'])).state.directory, 'candidate.json'));
  assert.deepEqual(run(root, ['prepare', '--from', '.atlas-candidate', '--reason', 'Unrecorded.']).error, { code: 'STALE', message: 'No record says which Atlas this copy was made from; run candidate again.' });
  await writeFile(path.join(written.path, 'notes.txt'), 'Working notes.');
  // Another folder inside the Atlas is still no candidate; a link in the copy is refused by name, and nothing is removed.
  await cp(written.path, path.join(root, 'proposal'), { recursive: true });
  assert.equal(run(root, ['validate', '--from', path.join(root, 'proposal')]).error.code, 'UNSAFE_PATH');
  await rm(path.join(root, 'proposal'), { recursive: true });
  await symlink(path.join(directory, 'design.md'), path.join(written.path, 'linked.md'));
  const linked = run(root, ['candidate']);
  assert.deepEqual([linked.code, linked.error.code, linked.error.diagnostics.map(item => item.path)], [2, 'UNSAFE_PATH', ['.atlas-candidate/linked.md']]);
  assert.equal(await readFile(path.join(written.path, 'notes.txt'), 'utf8'), 'Working notes.');
  await rm(path.join(written.path, 'linked.md'));
  assert.equal(success(run(root, ['candidate'])).files, 10);
  await assert.rejects(readFile(path.join(written.path, 'notes.txt')), { code: 'ENOENT' });
  // Locating a project's Atlas passes over the folder, whether the Atlas is a folder of the project or the project itself.
  const discover = project => {
    const result = spawnSync(process.execPath, [cli, 'locate', project], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).candidates.map(candidate => candidate.path);
  };
  assert.deepEqual(discover(directory), ['atlas']);
  assert.deepEqual(discover(root), ['.']);
});

test('move prepares a path move with its link repairs, and absorb only inspects', async t => {
  const { root } = await fixture(t);
  const moved = success(run(root, ['move', '-'], { point: 'drafts', path: 'trees/service/points/storage/drafts.md', reason: 'Group the storage Points.' }));
  assert.deepEqual(moved.plan.changes.map(change => [change.path, change.action]).sort(), [['trees/service/points/drafts.md', 'remove'], [detailPath, 'write'], ['trees/service/points/storage/drafts.md', 'write']].sort());
  applied(root, moved);
  assert.match(await readFile(path.join(root, detailPath), 'utf8'), /\[draft storage\]\(storage\/drafts\.md\)/);
  assert.equal(success(run(root, ['inspect', 'point', 'drafts'])).record.path, 'trees/service/points/storage/drafts.md');
  assert.equal(run(root, ['move', '-'], { point: 'drafts', path: 'trees/evidence/points/drafts.md', reason: 'Another Tree.' }).code, 2);
  const drafts = success(run(root, ['drafts'])).drafts.length;
  const inspection = success(run(root, ['absorb', '-'], { text: 'A saved draft survived an editor crash on a second runtime.', source: { uri: 'reports/second.md', role: 'evidence' } }));
  assert.equal(inspection.format, 'atlas.absorb-inspection/1');
  assert.equal(inspection.status, 'candidates');
  assert.equal(inspection.candidates[0].point.id, 'recovery');
  assert.ok(inspection.owners.some(owner => owner.tree.id === 'service'));
  assert.ok(inspection.interpretations.some(entry => entry.facet.id === 'limits'));
  assert.equal(success(run(root, ['drafts'])).drafts.length, drafts);
  assert.equal(run(root, ['absorb', '-'], { text: 'New material.', source: { uri: 'reports/second.md' }, contributions: [] }).code, 2);
});

test('export writes the pages of a selection, replaces a previous export and refuses a missing selection', async t => {
  const { root, directory } = await fixture(t), out = path.join(directory, 'site');
  for (const args of [['export', out], ['export', out, '--all', '--tree', 'service'], ['export', out, '--tree', 'service', '--tree', 'service']]) {
    const refused = run(root, args);
    assert.equal(refused.code, 2, args.join(' ')); assert.equal(refused.error.code, 'SELECTION_REQUIRED');
    assert.match(refused.error.message, /--tree ID.*--all/);
  }
  const unknown = run(root, ['export', out, '--tree', 'absent']);
  assert.deepEqual([unknown.code, unknown.error.code], [2, 'SELECTION_UNKNOWN']);
  assert.equal(run(root, ['export', out, '--tree', 'Not An ID']).error.code, 'CLI_INVALID_ARGUMENT');
  assert.equal(run(root, ['export', out, '--all', '--source-base', 'ftp://example.com/']).error.code, 'INVALID_SOURCE_BASE');
  assert.equal(run(root, ['export', path.join(root, 'site'), '--all']).error.code, 'EXPORT_OVERLAP');
  await assert.rejects(stat(out), { code: 'ENOENT' });
  const first = success(run(root, ['export', out, '--tree', 'service']));
  assert.equal(first.format, 'atlas.export/2'); assert.equal(first.status, 'complete');
  assert.deepEqual([first.trees, first.points, first.facets, first.replaced, first.output], [['service'], 3, 1, false, out]);
  assert.equal('style' in first, false, 'an export writes no page of the Style, and says nothing of one');
  assert.deepEqual((await readdir(out)).sort(), ['_', 'drafts', 'index.html', 'purpose', 'recovery']);
  const page = await readFile(path.join(out, 'recovery/index.html'), 'utf8');
  assert.ok(page.includes('Saved drafts survive an editor crash') && page.includes('Read <a'));
  await assert.rejects(stat(path.join(out, '_/style')), { code: 'ENOENT' });
  const styled = run(root, ['export', out, '--all', '--style']);
  assert.deepEqual([styled.code, styled.error.code], [2, 'CLI_INVALID_ARGUMENT'], 'export has no --style');
  assert.match(styled.error.message, /^Unexpected argument: --style\. Options: --tree, --all, --source-base\.$/);
  const second = success(run(root, ['export', out, '--all', '--source-base', 'https://example.com/work/atlas']));
  assert.deepEqual([second.trees, second.points, second.replaced, second.sourceBase], [['service', 'evidence'], 4, true, 'https://example.com/work/atlas/']);
  await assert.rejects(stat(path.join(out, '_/style')), { code: 'ENOENT' });
  assert.ok(!(await readFile(path.join(out, 'index.html'), 'utf8')).includes('Two accounts'), 'home does not name the Style');
  assert.ok((await readFile(path.join(out, 'observed/index.html'), 'utf8')).includes('One saved draft survived a restart'));
  const foreign = path.join(directory, 'foreign');
  await mkdir(foreign); await writeFile(path.join(foreign, 'notes.txt'), 'Not an export.');
  const exists = run(root, ['export', foreign, '--all']);
  assert.equal(exists.code, 3); assert.equal(exists.error.code, 'EXPORT_EXISTS');
  assert.deepEqual(await readdir(foreign), ['notes.txt']);
});
