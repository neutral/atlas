import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as library from '../src/index.mjs';
import { validateFiles, summarizeAtlas, summarizeDraft, readJsonChunk, prepareChange, prepareInitialization, listStyles, getStyle } from '../src/index.mjs';

function fixture() {
  const children = Array.from({ length: 120 }, (_, i) => ({ point: `point-${i}` }));
  const files = new Map([
    ['atlas.json', JSON.stringify({ format: 'atlas/1.2', id: 'sample', title: 'Sample', trees: ['trees/account', 'trees/other'] })],
    ['style.md', '# Subjects\n\nOne Tree for each durable subject.\n'],
    ['trees/other/tree.json', JSON.stringify({ id: 'other', title: 'Other', scope: 'A second account.', base: 'other-base', children: [] })],
    ['trees/other/points/base.md', '---\n{"id":"other-base"}\n---\n# Other base\n\nExplain the other account.'],
    ['trees/other/facets/reading.md', '---\n{"id":"reading","on":"other-base","via":"account","targets":["base","point-0"]}\n---\n# A reading\n\nThe other account depends on the first.'],
    ['.checks/whole.md', '---\n{"id":"whole","status":"active","level":"advisory"}\n---\n# Read it whole\n\n## Requirement\n\nRead the account.\n\n## Verification\n\nName each gap.\n\n## Failure\n\nReturn it.'],
    ['trees/account/tree.json', JSON.stringify({ id: 'account', title: 'Account', scope: 'An explanation.', base: 'base', children })],
    ['trees/account/points/base.md', '---\n{"id":"base"}\n---\n# Base\n\nExplain the account.'],
    ...children.map(({ point }) => [`trees/account/points/${point}.md`, `---\n{"id":"${point}"}\n---\n# ${point}\n\n${'A complete explanation. '.repeat(100)}`]),
  ]);
  return validateFiles(files, { root: '/tmp/atlas-inventory' });
}

test('bounded inventory covers every record once and rejects changed identity', () => {
  const view = fixture(), ids = [];
  let page = summarizeAtlas(view, { section: 'points', limit: 17 });
  assert.equal(page.files.length, 0);
  while (true) {
    assert.ok(page.atlas.points.every(point => point.body === undefined));
    ids.push(...page.atlas.points.map(point => point.id));
    if (!page.bounds.points.next) break;
    page = summarizeAtlas(view, page.bounds.points.next);
  }
  assert.equal(ids.length, 122);
  assert.equal(new Set(ids).size, 122);
  assert.throws(() => summarizeAtlas(view, { expectedIdentity: 'a'.repeat(64) }), { code: 'STALE' });
  assert.equal(summarizeAtlas(view, { full: true }), view);
});

test('the inventory names the Style, Trees, Facets and Checks without their prose', () => {
  const summary = summarizeAtlas(fixture(), { limit: 2 });
  assert.deepEqual(Object.keys(summary), ['format', 'status', 'root', 'identity', 'files', 'diagnostics', 'atlas', 'bounds']);
  assert.deepEqual(Object.keys(summary.atlas), ['format', 'id', 'title', 'style', 'trees', 'points', 'facets', 'checks']);
  assert.deepEqual(Object.keys(summary.bounds), ['files', 'trees', 'points', 'facets', 'checks', 'diagnostics']);
  assert.equal(summary.atlas.format, 'atlas/1.2');
  assert.deepEqual(summary.atlas.style, { title: 'Subjects', path: 'style.md' });
  assert.deepEqual(summary.atlas.trees.map(tree => tree.id), ['account', 'other']);
  assert.deepEqual(summary.atlas.facets, [{ id: 'reading', tree: 'other', title: 'A reading', path: 'trees/other/facets/reading.md', on: 'other-base', via: 'account', targets: ['base', 'point-0'] }]);
  assert.deepEqual(summary.atlas.checks.map(({ revision, ...check }) => check), [{ id: 'whole', title: 'Read it whole', path: '.checks/whole.md', status: 'active', level: 'advisory' }]);
  assert.deepEqual(summary.bounds.points, { available: 122, returned: 2, offset: 0, next: { section: 'points', offset: 2, limit: 2, expectedIdentity: summary.identity } });
  for (const section of ['sources', 'style']) assert.throws(() => summarizeAtlas(fixture(), { section }), { code: 'atlas.inventory.invalid-argument' });
  const invalid = summarizeAtlas(validateFiles(new Map([['atlas.json', '{}']]), { root: '/tmp/atlas-inventory' }));
  assert.deepEqual([invalid.status, invalid.atlas, invalid.diagnostics.length > 0], ['invalid', null, true]);
});

test('draft synopsis states writes and removals without repeating exact file bytes', () => {
  const view = fixture();
  const plan = prepareChange(view, { reason: 'Revise the account.', changes: [{ path: 'trees/account/points/base.md', content: '---\n{"id":"base"}\n---\n# Base\n\nAn improved account.' }] });
  const draft = { format: 'atlas.draft/1', id: 'revision', revision: 'a'.repeat(64), updatedAt: '2026-09-29T00:00:00Z', plan };
  const summary = summarizeDraft(draft);
  assert.deepEqual(Object.keys(summary), ['format', 'id', 'revision', 'updatedAt', 'plan', 'bounds', 'details']);
  assert.deepEqual(Object.keys(summary.plan), ['format', 'status', 'reason', 'baseline', 'validation', 'candidate', 'changes']);
  assert.deepEqual(summary.plan.validation, { status: 'ready', identity: plan.candidate.identity, diagnostics: [] });
  assert.deepEqual([summary.plan.status, summary.plan.reason, summary.plan.baseline], ['ready', 'Revise the account.', { identity: view.identity }]);
  assert.equal(summary.plan.changes[0].action, 'write');
  assert.equal(summary.plan.changes[0].bytes, Buffer.byteLength(plan.changes[0].after));
  assert.equal(summary.plan.candidate.files[0].content, undefined);
  assert.equal(summary.plan.candidate.identity, plan.candidate.identity);
  assert.deepEqual(summary.bounds, { changes: { available: 1, returned: 1, offset: 0, nextOffset: null }, validation: { available: 0, returned: 0, offset: 0 } });
  assert.deepEqual(summarizeDraft(draft, { full: true }), draft);
  const removal = prepareChange(view, { reason: 'Remove the Facet.', changes: [{ path: 'trees/other/facets/reading.md', content: null }] });
  assert.deepEqual(summarizeDraft({ ...draft, plan: removal }).plan.changes, [{ path: 'trees/other/facets/reading.md', action: 'remove', bytes: 0 }]);
  // An invalid draft says why: its validation, not its candidate, decides whether it can be applied.
  const style = view.files.find(file => file.path === 'style.md').content;
  const mixed = prepareChange(view, { reason: 'The Style and a Point.', changes: [{ path: 'style.md', content: `${style}\nOne more rule.\n` }, { path: plan.changes[0].path, content: plan.changes[0].after }] });
  const refused = summarizeDraft({ ...draft, plan: mixed }, { limit: 1 });
  assert.deepEqual([refused.plan.status, refused.plan.validation.status, refused.plan.validation.diagnostics.map(item => item.code), refused.plan.candidate.status], ['invalid', 'invalid', ['STYLE_CHANGE_ALONE'], 'ready']);
  assert.deepEqual(refused.bounds.validation, { available: 1, returned: 1, offset: 0 });
  const broken = prepareChange(view, { reason: 'Break the Base.', changes: [{ path: 'trees/account/points/base.md', content: '# No header' }] });
  const page = summarizeDraft({ ...draft, plan: broken }, { limit: 1, offset: 1 });
  assert.deepEqual([page.plan.validation.diagnostics, page.bounds.validation], [broken.validation.diagnostics.slice(1, 2), { available: broken.validation.diagnostics.length, returned: Math.min(1, broken.validation.diagnostics.length - 1), offset: 1 }]);
});

test('exact JSON chunks preserve Unicode and bind continuation to bytes', () => {
  const value = { prose: 'α 😀 漢字'.repeat(100) };
  let page = readJsonChunk(value, { maxBytes: 11 }), content = page.text;
  const digest = page.sha256;
  while (page.nextOffset !== null) {
    page = readJsonChunk(value, { offset: page.nextOffset, maxBytes: 11, expectedSha256: digest });
    content += page.text;
  }
  assert.deepEqual(JSON.parse(content), value);
  assert.throws(() => readJsonChunk({ prose: 'Changed' }, { expectedSha256: digest }), { code: 'STALE_REPORT' });
});

test('the six curated Styles are plain Markdown files, named by their file and adopted byte for byte', () => {
  const ids = ['explanatory-perspectives', 'concise-perspectives', 'explanatory-subjects', 'concise-subjects', 'explanatory-synthesis', 'concise-synthesis'];
  assert.deepEqual(listStyles().map(style => style.id), ids);
  assert.ok(listStyles().every(style => Object.keys(style).join() === 'id,title' && style.title.trim()));
  const empty = validateFiles({}, { root: '/tmp/atlas-style-selection' });
  for (const { id, title } of listStyles()) {
    const selected = getStyle(id);
    assert.deepEqual(Object.keys(selected), ['id', 'title', 'body', 'content']);
    assert.deepEqual([selected.id, selected.title], [id, title]);
    assert.equal(selected.content, readFileSync(new URL(`../../styles/${id}.md`, import.meta.url), 'utf8'));
    assert.ok(selected.content.startsWith(`# ${title}\n`));
    const plan = prepareInitialization(empty, { id: 'selection', title: 'Selected policy', styleId: id });
    assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
    assert.deepEqual(plan.candidate.atlas.style, { title, body: selected.body, path: 'style.md' });
    assert.equal(plan.changes.find(change => change.path === 'style.md').after, selected.content);
  }
  for (const unknown of ['../../unrelated', 'README', 'explanatory-perspectives.md', '', undefined]) assert.equal(getStyle(unknown), null);
});

test('the Library exports exactly its 1.2 operations', () => {
  assert.deepEqual(Object.keys(library).sort(), [
    'applyBlocker', 'applyDraft', 'checkStateLocation', 'citedMaterial', 'compareViews', 'deleteDraft', 'directCiters', 'getFacet', 'getPoint', 'getStyle', 'getTree',
    'inspectAbsorb', 'inspectChange', 'isPrivateStatePath', 'listDrafts', 'listStyles', 'listTransactions', 'loadDraft', 'markdownHeadingIds',
    'observeSource', 'openAtlas', 'prepareChange', 'prepareChangeFromDisk', 'prepareFromCandidate', 'prepareInitialization', 'prepareMove',
    'prepareStamp', 'readJsonChunk', 'readSource', 'recoverChange', 'referenceIndex', 'resolveReference', 'resolveState',
    'reviewChange', 'reviewImpact', 'route', 'saveDraft', 'searchAtlas', 'sourceCitations', 'staleSources', 'stateHome', 'summarizeAtlas',
    'summarizeDraft', 'validateFiles', 'validateSource', 'writeCandidate',
  ]);
});
