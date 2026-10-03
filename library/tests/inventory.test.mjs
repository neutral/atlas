import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles, summarizeAtlas, summarizeDraft, readJsonChunk, prepareChange, prepareInitialization, listStyles, getStyle } from '../src/index.mjs';

function fixture() {
  const children = Array.from({ length: 120 }, (_, i) => ({ point: `point-${i}` }));
  const files = new Map([
    ['atlas.json', JSON.stringify({ format: 'atlas/1', id: 'sample', title: 'Sample', trees: ['trees/account'] })],
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
  assert.equal(ids.length, 121);
  assert.equal(new Set(ids).size, 121);
  assert.throws(() => summarizeAtlas(view, { expectedIdentity: 'a'.repeat(64) }), { code: 'STALE' });
  assert.equal(summarizeAtlas(view, { full: true }), view);
});

test('draft synopsis states writes and removals without repeating exact file bytes', () => {
  const view = fixture();
  const plan = prepareChange(view, { reason: 'Revise the account.', changes: [{ path: 'trees/account/points/base.md', content: '---\n{"id":"base"}\n---\n# Base\n\nAn improved account.' }] });
  const draft = { format: 'atlas.draft/1', id: 'revision', revision: 'a'.repeat(64), updatedAt: '2026-09-29T00:00:00Z', plan, reviewHistory: [{ revision: 'old' }] };
  const summary = summarizeDraft(draft);
  assert.equal(summary.plan.changes[0].action, 'write');
  assert.equal(summary.plan.changes[0].bytes, Buffer.byteLength(plan.changes[0].after));
  assert.equal(summary.plan.observedFiles, undefined);
  assert.equal(summary.plan.candidate.files[0].content, undefined);
  assert.equal(summary.historyCount, 1);
  assert.deepEqual(summarizeDraft(draft, { full: true }), draft);
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

test('curated Style definitions come from exact packaged Markdown and remain bounded to known IDs', () => {
  assert.deepEqual(listStyles().map(style => style.id), ['explanatory-perspectives', 'concise-perspectives', 'explanatory-subjects', 'concise-subjects', 'explanatory-synthesis', 'concise-synthesis']);
  const empty = validateFiles({}, { root: '/tmp/atlas-style-selection' });
  for (const metadata of listStyles()) {
    const selected = getStyle(metadata.id);
    assert.equal(selected.title, metadata.title);
    const plan = prepareInitialization(empty, { id: 'selection', title: 'Selected policy', styleId: metadata.id });
    assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.diagnostics));
    assert.equal(plan.candidate.atlas.style.id, metadata.id);
    assert.equal(plan.candidate.atlas.style.revision, metadata.revision);
    assert.equal(plan.candidate.atlas.style.body, selected.body);
    assert.equal(plan.changes.find(change => change.path === 'style.md').after, selected.content);
  }
  assert.equal(getStyle('../../unrelated'), null);
});
