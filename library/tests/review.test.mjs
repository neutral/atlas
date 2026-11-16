import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { openAtlas, validateFiles } from '../src/model.mjs';
import { reviewChange, reviewImpact } from '../src/absorb.mjs';
import { prepareChange, prepareInitialization, saveDraft, loadDraft } from '../src/authoring.mjs';
import { listStyles } from '../src/styles.mjs';

const json = value => JSON.stringify(value) + '\n';
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const source = { uri: 'sources/report.md', role: 'evidence' };
const detail = 'trees/system/points/detail.md';
const check = '.checks/support.md';
function files() {
  return new Map([
    ['atlas.json', json({ format: 'atlas/1.2', id: 'review', title: 'Review', trees: ['trees/system', 'trees/product'] })],
    ['style.md', '# Perspectives\n\nThe system account owns what was qualified. The product account owns what is promised.\n'],
    ['trees/system/tree.json', json({ id: 'system', title: 'System', scope: 'Qualification', base: 'runtime', children: [{ point: 'detail', children: [{ point: 'linux' }] }, { point: 'summary' }] })],
    ['trees/product/tree.json', json({ id: 'product', title: 'Product', scope: 'Promises', base: 'promise', children: [{ point: 'unrelated' }] })],
    ['trees/system/points/base.md', markdown({ id: 'runtime' }, 'Runtime', 'Observed behavior needs evidence.')],
    [detail, markdown({ id: 'detail', type: 'decision', status: 'proposed', sources: [source] }, 'Qualified runtime', 'The installation passed on macOS; other systems remain untested.')],
    ['trees/system/points/linux.md', markdown({ id: 'linux', type: 'observation', observedAt: '2026-11-01', sources: [source] }, 'Linux was not run', 'No Linux run is recorded.')],
    ['trees/system/points/summary.md', markdown({ id: 'summary' }, 'Scope summary', 'See the [qualification](detail.md) before depending on this support.')],
    ['trees/product/points/base.md', markdown({ id: 'promise' }, 'Promise', 'Users need dependable installation.')],
    ['trees/product/points/unrelated.md', markdown({ id: 'unrelated' }, 'Other work', 'This independent subject is outside the proposed change.')],
    ['trees/product/facets/scope.md', markdown({ id: 'scope', on: 'promise', via: 'system', targets: ['detail'] }, 'Scope limits the promise', 'The macOS observation leaves other systems untested.')],
    ['trees/system/facets/users.md', markdown({ id: 'users', on: 'detail', via: 'product', targets: ['promise'] }, 'Qualification serves the promise', 'A qualified runtime is what the promise depends on.')],
    [check, markdown({ id: 'support', status: 'active', level: 'required' }, 'Bound the support claim', '## Requirement\n\nKeep the platform limit.\n\n## Verification\n\nRead the changed explanation and evidence.\n\n## Failure\n\nReject unqualified support claims.')],
  ]);
}
const view = (changed = files()) => validateFiles(changed, { root: '/tmp/atlas-review' });
function change(requests, reason = 'A reviewed change.') {
  const before = view();
  assert.equal(before.status, 'ready', JSON.stringify(before.diagnostics));
  return prepareChange(before, { reason, changes: requests.map(([file, content]) => ({ path: file, content: typeof content === 'function' ? content(files().get(file)) : content })) });
}

test('a changed title is named apart from a changed explanation', () => {
  const titled = (title, body) => [[detail, markdown({ id: 'detail', type: 'decision', status: 'proposed', sources: [source] }, title, body)]];
  const was = 'The installation passed on macOS; other systems remain untested.';
  const changes = plan => reviewChange(plan).changedPoints.map(point => [point.id, point.changes]);
  assert.deepEqual(changes(change(titled('Qualified on macOS only', was))), [['detail', ['title']]], 'a new H1 alone changes the title');
  assert.deepEqual(changes(change(titled('Qualified runtime', 'The installation passed on macOS and Linux.'))), [['detail', ['explanation']]], 'a new body alone changes the explanation');
  assert.deepEqual(changes(change(titled('Qualified on macOS and Linux', 'The installation passed on macOS and Linux.'))), [['detail', ['title', 'explanation']]]);
  const impact = reviewImpact(view(), view(new Map([...files(), ...titled('Qualified on macOS only', was)])));
  assert.deepEqual(impact.changedPoints.map(point => [point.id, point.changes]), [['detail', ['title']]]);
});

test('the effects of a change name each changed record, what changed in it, and both sides of it', () => {
  const plan = change([
    [detail, markdown({ id: 'detail', type: 'decision', status: 'selected', sources: [source, { uri: 'sources/linux.md' }], uncertainty: 'Windows remains untested.' }, 'Qualified runtime', 'The installation passed on macOS and Linux.')],
    ['trees/system/points/linux.md', markdown({ id: 'linux', type: 'observation', observedAt: '2026-11-14', sources: [source] }, 'Linux was not run', 'No Linux run is recorded.')],
    ['trees/product/facets/scope.md', null],
    ['trees/product/points/new.md', markdown({ id: 'new' }, 'A new claim', 'Added by this change.')],
    ['trees/product/tree.json', json({ id: 'product', title: 'Product', scope: 'Promises', base: 'promise', children: [{ point: 'unrelated', children: [{ point: 'new' }] }] })],
  ]);
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  const review = reviewChange(plan);
  assert.deepEqual(Object.keys(review), ['format', 'status', 'beforeIdentity', 'afterIdentity', 'limits', 'changedPoints', 'changedFacets', 'changedTrees', 'changedChecks', 'changedManifest', 'review', 'mentions', 'linkDiagnostics']);
  assert.equal(review.changedManifest, null);
  assert.deepEqual([review.format, review.status, review.beforeIdentity, review.afterIdentity], ['atlas.impact-review/1', 'ready', plan.baseline.identity, plan.candidate.identity]);
  assert.deepEqual(review.changedPoints.map(point => [point.id, point.changes, point.before === null, point.after === null]), [
    ['detail', ['decision-status', 'explanation', 'sources', 'uncertainty'], false, false],
    ['linux', ['observation-date'], false, false],
    ['new', ['added'], true, false],
  ]);
  assert.equal(review.changedPoints[0].before.status, 'proposed');
  assert.equal(review.changedPoints[0].after.body, 'The installation passed on macOS and Linux.');
  assert.deepEqual(review.changedFacets.map(facet => [facet.id, facet.before?.on, facet.after]), [['product/scope', 'promise', null]]);
  assert.deepEqual(review.changedTrees.map(tree => tree.id), ['product']);
  assert.deepEqual(review.changedChecks, []);
  assert.equal(review.changedStyle, undefined);
  assert.equal(review.limits.length, 3, 'a draft against a valid Atlas has only the limits every review has');
  assert.match(review.limits[0], /^The effects name every record the draft makes new, changes or removes/);
  assert.match(review.limits[1], /leads, not a proof of complete impact/);
  assert.ok(review.limits.every(limit => !/Absorb|proposal/.test(limit)), 'a review speaks of drafts');
  const reordered = change([[detail, markdown({ sources: [source], status: 'proposed', type: 'decision', id: 'detail' }, 'Qualified runtime', 'The installation passed on macOS; other systems remain untested.')]]);
  assert.equal(reordered.changes.length, 1);
  assert.deepEqual(reviewChange(reordered).changedPoints, [], 'a header whose keys only stand in another order changes nothing in the record');
});

test('a draft that creates an Atlas reviews like any other: everything in it is new', () => {
  const empty = validateFiles(new Map(), { root: '/tmp/atlas-review' });
  assert.equal(empty.status, 'invalid');
  const created = reviewChange(prepareChange(empty, { reason: 'Start the Atlas.', changes: [...files()].map(([file, content]) => ({ path: file, content })) }));
  assert.equal(created.status, 'ready');
  assert.deepEqual(created.changedManifest, { title: { before: null, after: 'Review' }, id: { before: null, after: 'review' }, added: ['system', 'product'], removed: [] });
  assert.deepEqual(created.changedStyle.before, null);
  assert.deepEqual(created.changedPoints.map(point => [point.id, point.changes]), ['detail', 'linux', 'promise', 'runtime', 'summary', 'unrelated'].map(id => [id, ['added']]));
  assert.deepEqual([created.changedFacets.map(facet => facet.id), created.changedTrees.map(tree => tree.id), created.changedChecks.map(item => item.id)], [['product/scope', 'system/users'], ['product', 'system'], ['support']]);
  assert.deepEqual(created.review.before, { points: [], trees: [], facets: [] });
  assert.ok(created.review.after.points.length);
  assert.deepEqual(created.limits.slice(3), ['There is no Atlas before this draft, so every record in it is new.']);

  const initialized = reviewChange(prepareInitialization(empty, { id: 'review', title: 'Review', styleId: listStyles()[0].id }));
  assert.deepEqual([initialized.status, initialized.changedManifest, initialized.changedPoints, initialized.changedStyle.after.title],
    ['ready', { title: { before: null, after: 'Review' }, id: { before: null, after: 'review' }, added: [], removed: [] }, [], listStyles()[0].title]);
});

test('a draft that repairs an Atlas that does not validate reviews like any other, and its limits say what the broken Atlas leaves unknown', () => {
  const broken = files();
  broken.set(detail, broken.get(detail).replace('"status":"proposed"', '"status":"perhaps"'));
  broken.set('trees/system/points/summary.md', 'not a record');
  broken.set('trees/product/tree.json', '{ "id": "product",');
  const before = view(broken);
  assert.equal(before.status, 'invalid');
  const repaired = files();
  repaired.set('trees/system/tree.json', json({ id: 'system', title: 'System', scope: 'Qualification', base: 'runtime', children: [{ point: 'detail', children: [{ point: 'linux' }] }] }));
  repaired.delete('trees/system/points/summary.md');
  const plan = prepareChange(before, { reason: 'Repair the Atlas.', changes: [detail, 'trees/system/tree.json', 'trees/product/tree.json', 'trees/system/points/summary.md']
    .map(file => ({ path: file, content: repaired.get(file) ?? null })) });
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  const review = reviewChange(plan);
  assert.equal(review.status, 'ready');
  assert.deepEqual(review.changedPoints.map(point => [point.id, point.changes]), [['detail', ['decision-status']]],
    'a record that reads before is compared field by field; the Points of an outline that does not parse are not moved by it');
  assert.equal(review.changedPoints[0].before.status, 'perhaps');
  assert.deepEqual(review.changedFacets.map(facet => [facet.id, facet.before === null]), [['product/scope', true]], 'a Facet whose Tree cannot be read before is new');
  assert.deepEqual(review.changedTrees.map(tree => [tree.id, tree.before === null]), [['product', true], ['system', false]]);
  assert.deepEqual(review.review.before.points.map(entry => entry.record.id), ['detail', 'runtime']);
  assert.deepEqual(review.mentions.before.map(entry => entry.status), ['unavailable'], 'what mentioned it before is not read');
  assert.deepEqual(review.limits.slice(3), [
    'The Atlas before this draft does not validate. Its records are read as far as their files allow, and the records that mentioned them there are not read.',
    'These files of the Atlas before this draft hold no record that can be read, so a record the draft holds in one of them is reported as new: trees/product/facets/scope.md, trees/product/tree.json, trees/system/points/summary.md.',
  ]);

  // A Point the earlier outline does not place: its earlier place is not known, and the limits name it.
  const unplaced = files();
  unplaced.set('trees/product/tree.json', json({ id: 'product', title: 'Product', scope: 'Promises', base: 'promise', children: 'unrelated' }));
  const moved = reviewChange(prepareChange(view(unplaced), { reason: 'Place the other work.', changes: [
    { path: 'trees/product/tree.json', content: files().get('trees/product/tree.json') },
    { path: 'trees/product/points/unrelated.md', content: files().get('trees/product/points/unrelated.md').replace('This independent', 'The independent') },
  ] }));
  assert.deepEqual(moved.changedPoints.map(point => [point.id, point.changes, point.before.ancestors]), [['unrelated', ['explanation'], null]]);
  assert.equal(moved.limits.at(-1), 'The outline of the Atlas before this draft does not place these Points, so where they stood there and the Points above them are not known: unrelated.');

  // A repair that only takes out a field a record may not carry is a change too, named where the review has a word for it.
  const stray = files();
  stray.set('trees/product/points/base.md', markdown({ id: 'promise', status: 'selected' }, 'Promise', 'Users need dependable installation.'));
  stray.set('trees/product/points/unrelated.md', markdown({ id: 'unrelated', observedAt: '2026-11-01' }, 'Other work', 'This independent subject is outside the proposed change.'));
  stray.set('trees/system/points/summary.md', markdown({ id: 'summary', note: 'stray' }, 'Scope summary', 'See the [qualification](detail.md) before depending on this support.'));
  assert.deepEqual(view(stray).diagnostics.map(item => item.code).sort(), ['DATE_TYPE', 'FIELD_UNKNOWN', 'STATUS_TYPE']);
  const cleaned = reviewChange(prepareChange(view(stray), { reason: 'Take out the stray fields.', changes: ['trees/product/points/base.md', 'trees/product/points/unrelated.md', 'trees/system/points/summary.md']
    .map(file => ({ path: file, content: files().get(file) })) }));
  assert.deepEqual(cleaned.changedPoints.map(point => [point.id, point.changes]), [['promise', ['decision-status']], ['summary', []], ['unrelated', ['observation-date']]],
    'a field the review has no word for still makes the Point changed, with no word');
});

test('a change to atlas.json reports what differs in it: title, ID, the order of the Trees both sides hold, and Trees added or removed', () => {
  const manifest = fields => ['atlas.json', json({ format: 'atlas/1.2', id: 'review', title: 'Review', trees: ['trees/system', 'trees/product'], ...fields })];
  const ops = ['trees/ops/tree.json', json({ id: 'ops', title: 'Operations', scope: 'Running it', base: 'running', children: [] })];
  const running = ['trees/ops/points/base.md', markdown({ id: 'running' }, 'It runs', 'One host runs it.')];
  const renamed = reviewChange(change([manifest({ id: 'reviewed', title: 'Reviewed' })]));
  assert.deepEqual(renamed.changedManifest, { title: { before: 'Review', after: 'Reviewed' }, id: { before: 'review', after: 'reviewed' }, added: [], removed: [] });
  const reordered = reviewChange(change([manifest({ trees: ['trees/product', 'trees/system'] })]));
  assert.deepEqual(reordered.changedManifest, { order: { before: ['system', 'product'], after: ['product', 'system'] }, added: [], removed: [] });
  // A Tree added in the middle leaves the others in their order; the addition is reported as such.
  const added = reviewChange(change([manifest({ trees: ['trees/system', 'trees/ops', 'trees/product'] }), ops, running]));
  assert.deepEqual(added.changedManifest, { added: ['ops'], removed: [] });
  const swapped = reviewChange(change([manifest({ trees: ['trees/product', 'trees/ops', 'trees/system'] }), ops, running]));
  assert.deepEqual(swapped.changedManifest, { order: { before: ['system', 'product'], after: ['product', 'ops', 'system'] }, added: ['ops'], removed: [] });
  // Bytes decide whether the manifest differs: the same fields written otherwise is a change with nothing named.
  const spaced = reviewChange(change([['atlas.json', JSON.stringify(JSON.parse(files().get('atlas.json')), null, 4) + '\n']]));
  assert.deepEqual(spaced.changedManifest, { added: [], removed: [] });
  assert.equal(reviewChange(change([[detail, value => value.replace('macOS', 'macOS 15')]])).changedManifest, null);
  const before = view(), next = files();
  next.set('atlas.json', json({ format: 'atlas/1.2', id: 'review', title: 'Review', trees: ['trees/system'] }));
  for (const file of [...next.keys()]) if (file.startsWith('trees/product/') || file === 'trees/system/facets/users.md') next.delete(file);
  next.set('trees/system/points/summary.md', markdown({ id: 'summary' }, 'Scope summary', 'See the qualification before depending on this support.'));
  const removed = reviewImpact(before, view(next));
  assert.equal(removed.status, 'ready', JSON.stringify(removed.diagnostics));
  assert.deepEqual(removed.changedManifest, { added: [], removed: ['product'] });
});

test('the Points above a changed Point and the Facets attached to it and targeting it are named, without closure', () => {
  const review = reviewChange(change([['trees/system/points/linux.md', content => content.replace('No Linux run is recorded.', 'One Linux run failed.')]]));
  const reasons = side => Object.fromEntries(side.map(({ record, reasons }) => [record.tree ? `${record.tree}/${record.id}` : record.id, reasons]));
  assert.deepEqual(Object.keys(review.review.after), ['points', 'trees', 'facets']);
  assert.deepEqual(reasons(review.review.after.points), {
    'system/linux': [{ kind: 'changed-point', changes: ['explanation'] }],
    'system/runtime': [{ kind: 'authored-ancestor', point: 'linux' }],
    'system/detail': [{ kind: 'authored-ancestor', point: 'linux' }],
    'product/promise': [{ kind: 'incoming-facet-host', tree: 'product', facet: 'scope' }],
  });
  assert.deepEqual(reasons(review.review.after.facets), {
    'system/users': [{ kind: 'attached-review-point', point: 'detail' }],
    'product/scope': [{ kind: 'incoming-point-reference', point: 'detail' }],
  });
  assert.deepEqual(review.review.after.trees.map(({ record }) => record.id), ['system', 'product']);
  assert.ok(!review.review.after.points.some(({ record }) => ['unrelated', 'summary'].includes(record.id)));
  assert.deepEqual(reviewImpact(view(), view()).changedPoints, []);
});

test('a changed Facet names its host and its targets on both sides', () => {
  const retargeted = reviewChange(change([['trees/product/facets/scope.md', markdown({ id: 'scope', on: 'unrelated', via: 'system', targets: ['summary', 'linux'] }, 'Scope limits the promise', 'The macOS observation leaves other systems untested.')]]));
  const reason = (side, id, kind) => side.points.find(({ record }) => record.id === id)?.reasons.find(item => item.kind === kind);
  assert.deepEqual(reason(retargeted.review.before, 'promise', 'changed-facet-host'), { kind: 'changed-facet-host', tree: 'product', facet: 'scope' });
  assert.deepEqual(reason(retargeted.review.before, 'detail', 'changed-facet-target'), { kind: 'changed-facet-target', tree: 'product', facet: 'scope' });
  assert.equal(reason(retargeted.review.before, 'unrelated', 'changed-facet-host'), undefined);
  assert.deepEqual(reason(retargeted.review.after, 'unrelated', 'changed-facet-host'), { kind: 'changed-facet-host', tree: 'product', facet: 'scope' });
  assert.deepEqual(reason(retargeted.review.after, 'summary', 'changed-facet-target'), { kind: 'changed-facet-target', tree: 'product', facet: 'scope' });
  assert.deepEqual(reason(retargeted.review.after, 'linux', 'changed-facet-target'), { kind: 'changed-facet-target', tree: 'product', facet: 'scope' });
  assert.equal(reason(retargeted.review.after, 'detail', 'changed-facet-target'), undefined);
  assert.deepEqual([retargeted.changedFacets[0].before.targets, retargeted.changedFacets[0].after.targets], [['detail'], ['summary', 'linux']]);
});

test('a removal is reported with the records that mentioned the removed one and the links it leaves dangling', () => {
  const tree = JSON.parse(files().get('trees/system/tree.json')); tree.children = [{ point: 'linux' }, { point: 'summary' }];
  const plan = change([[detail, null], ['trees/system/tree.json', json(tree)], ['trees/product/facets/scope.md', null], ['trees/system/facets/users.md', null]], 'Remove the qualification; its claim now lives in the summary.');
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
  const review = reviewChange(plan);
  assert.deepEqual(review.changedPoints.map(point => [point.id, point.changes]), [['detail', ['removed']], ['linux', ['placement']]]);
  assert.deepEqual(review.changedFacets.map(facet => facet.id), ['product/scope', 'system/users']);
  assert.deepEqual(review.linkDiagnostics.map(({ code, path: file, line }) => [code, file, line]), [['REFERENCE_MISSING', 'trees/system/points/summary.md', 6]]);
  const before = review.mentions.before.find(item => item.target.point === 'detail');
  assert.deepEqual(before.citers.map(citer => citer.record.id), ['summary']);
  assert.ok(!review.mentions.after.some(item => item.target.point === 'detail'));
  assert.ok(review.review.before.facets.some(({ record }) => record.id === 'scope'));
  assert.ok(!review.review.after.facets.some(({ record }) => record.id === 'scope'));
});

test('direct Markdown mentions are reported apart from recorded connections', () => {
  const review = reviewChange(change([[detail, content => content + '\nTest Linux separately before extending the promise.\n']]));
  assert.ok(review.mentions.after.some(item => item.target.point === 'detail' && item.citers.some(citer => citer.record.id === 'summary')));
  assert.ok(!review.review.after.points.some(item => item.record.id === 'summary'));
  assert.ok(review.review.after.points.some(item => item.record.id === 'promise' && item.reasons.some(reason => reason.kind === 'incoming-facet-host')));
});

test('a change to style.md or to a Check is reported, by its bytes', () => {
  const style = files().get('style.md');
  const restyled = reviewChange(change([['style.md', style.replace('what is promised', 'what is promised and to whom')]]));
  assert.deepEqual(restyled.changedStyle, {
    before: { title: 'Perspectives', body: 'The system account owns what was qualified. The product account owns what is promised.', path: 'style.md' },
    after: { title: 'Perspectives', body: 'The system account owns what was qualified. The product account owns what is promised and to whom.', path: 'style.md' },
  });
  assert.deepEqual([restyled.changedPoints, restyled.changedFacets, restyled.changedTrees, restyled.changedChecks], [[], [], [], []]);
  const spaced = reviewChange(change([['style.md', style + '\n']]));
  assert.deepEqual(spaced.changedStyle.before, spaced.changedStyle.after);
  // A change that alters the Style with another record cannot be applied; its effects are still there to read.
  const mixed = change([['style.md', style + '\n'], [detail, content => content + '\nTest Linux separately.\n']]);
  assert.deepEqual([mixed.status, mixed.validation.diagnostics.map(item => item.code)], ['invalid', ['STYLE_CHANGE_ALONE']]);
  const both = reviewChange(mixed);
  assert.deepEqual([both.status, Object.keys(both.changedStyle), both.changedPoints.map(point => [point.id, point.changes])], ['ready', ['before', 'after'], [['detail', ['explanation']]]]);
  const checked = reviewChange(change([
    [check, content => content.replace('Keep the platform limit.', 'Keep every platform limit.')],
    ['.checks/removals.md', markdown({ id: 'removals', status: 'draft', level: 'advisory' }, 'Account for removals', '## Requirement\n\nName what was removed.\n\n## Verification\n\nRead the reason.\n\n## Failure\n\nReturn the change.')],
  ]));
  assert.equal(checked.changedStyle, undefined);
  assert.deepEqual(checked.changedChecks.map(item => [item.id, item.before?.revision === item.after?.revision, item.before === null, item.after.body.includes('limit')]), [['removals', false, true, false], ['support', false, false, true]]);
  const retired = reviewChange(change([[check, null]]));
  assert.deepEqual(retired.changedChecks.map(item => [item.id, item.before.title, item.after]), [['support', 'Bound the support claim', null]]);
});

test('an invalid candidate has no effects to review, only its diagnostics', () => {
  const plan = change([[detail, 'not a record']]);
  assert.equal(plan.status, 'invalid');
  const review = reviewChange(plan);
  assert.deepEqual([review.status, review.reason, review.diagnostics.before], ['unavailable', 'The Atlas after the change must validate, and the one before it must be read whole.', []]);
  assert.ok(review.diagnostics.after.some(item => item.code === 'MARKDOWN_HEADER' && item.path === detail));
  assert.equal(review.changedPoints, undefined);
});

test('a saved draft reviews from its exact bytes, not from a model it carries', async t => {
  const root = await tempDirectory('atlas-review-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, content] of files()) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  const before = await openAtlas(root);
  const plan = prepareChange(before, { reason: 'Add the next test.', changes: [{ path: detail, content: files().get(detail) + '\nTest Linux separately.\n' }] });
  const draft = await saveDraft(root, { plan });
  const loaded = await loadDraft(root, draft.id);
  assert.deepEqual(reviewChange(loaded.plan), reviewChange(plan));
  const forged = structuredClone(loaded.plan);
  forged.candidate.atlas.points.find(point => point.id === 'detail').body = 'Forged accepted content.';
  assert.equal(reviewChange(forged).changedPoints[0].after.body, reviewChange(plan).changedPoints[0].after.body);
  const tampered = structuredClone(loaded.plan);
  tampered.candidate.files.find(file => file.path === detail).content += '\nUnreviewed.\n';
  assert.throws(() => reviewChange(tampered), { code: 'INVALID_PLAN' });
});
