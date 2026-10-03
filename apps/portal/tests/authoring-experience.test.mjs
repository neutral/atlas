import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { openAtlas, validateFiles } from '../../../library/src/model.mjs';
import { getStyle } from '../../../library/src/styles.mjs';
import { saveDraft } from '../../../library/src/authoring.mjs';
import { prepareFormChange } from '../src/authoring-forms.mjs';
import { startPortal } from '../src/server.mjs';
import { renderMarkdown } from '../src/markdown.mjs';
import { markdownHeadingIds } from '../../../library/src/references.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
const md = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
async function fixture(t) {
  const root = await tempDirectory('atlas-ux-');
  const files = {
    'atlas.json': json({ format: 'atlas/1.1', id: 'example', title: 'An account', style: 'style.md', trees: ['trees/product', 'trees/system'] }),
    'style.md': getStyle('explanatory-perspectives').content,
    'trees/product/tree.json': json({ id: 'product', title: 'Product', scope: 'The user account.', base: 'purpose', children: [{ branch: 'group', title: 'Important detail', children: [{ point: 'one', children: [{ point: 'detail' }] }] }, { point: 'two' }] }),
    'trees/product/points/base.md': md({ id: 'purpose' }, 'Purpose', 'Read [the first explanation](one.md).'),
    'trees/product/points/one.md': md({ id: 'one', sources: [{ uri: 'report.md#observation', role: 'evidence' }] }, 'First explanation', 'A claim qualified by the report.'),
    'trees/product/points/detail.md': md({ id: 'detail' }, 'Supporting detail', 'A narrower explanation.'),
    'trees/product/points/two.md': md({ id: 'two' }, 'Second explanation', 'The surviving explanation.'),
    'trees/system/tree.json': json({ id: 'system', title: 'System', scope: 'System behavior.', base: 'system-base', children: [] }),
    'trees/system/points/base.md': md({ id: 'system-base' }, 'System behavior', 'Explain operational constraints.'),
    'trees/system/facets/connection.md': md({ id: 'connection', on: { point: 'system-base' }, via: 'product', targets: [{ point: 'one' }] }, 'Recovery constraint', 'The product interpretation must retain this constraint.'),
    'report.md': '# Observation\n\nInitial bytes.\n',
  };
  for (const [file, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  let service = await startPortal(root, { editable: true });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = async (endpoint, data, method) => {
    const response = await fetch(new URL(`/api/${endpoint}`, service.url), { method: method ?? (data ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${service.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, value: await response.json() };
  };
  const restart = async () => { await service.close(); service = await startPortal(root, { editable: true }); };
  return { root, files, request, restart, view: await openAtlas(root) };
}

test('Branch form groups existing explanations atomically; empty grouping is refused', async t => {
  const { view } = await fixture(t);
  const input = { operation: 'branch', tree: 'product', id: 'new-group', title: 'Another grouping', create: true, parent: { kind: 'point', id: 'purpose' }, members: [{ kind: 'point', id: 'two' }], reason: 'Keep related explanations together.' };
  const { plan } = prepareFormChange(view, input);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.candidate.atlas.branches.find(item => item.id === 'new-group').children, [{ point: 'two' }]);
  assert.throws(() => prepareFormChange(view, { ...input, members: [] }), /at least one/);
});

test('moving the final child needs explicit empty-Branch cleanup and preserves all Points', async t => {
  const { view } = await fixture(t);
  const input = { operation: 'place', tree: 'product', id: 'one', kind: 'point', parent: { kind: 'point', id: 'purpose' }, reason: 'Read this explanation directly.' };
  assert.equal(prepareFormChange(view, input).plan.status, 'invalid');
  const { plan } = prepareFormChange(view, { ...input, cleanupEmptyBranches: true });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.candidate.atlas.branches.length, 0);
  assert.equal(plan.candidate.atlas.points.length, view.atlas.points.length);
  assert.throws(() => prepareFormChange(view, { ...input, parent: { kind: 'point', id: 'detail' } }), /descendants/);
});

test('consolidation retains explicit removal and Facet reasoning and repairs direct citations', async t => {
  const { view } = await fixture(t);
  const proposal = prepareFormChange(view, { operation: 'remove', tree: 'product', id: 'one', destination: 'two', destinationBody: 'The combined explanation retains the qualification.', reason: 'The narrower distinction is no longer useful.' });
  assert.equal(proposal.plan.status, 'ready');
  assert.ok(proposal.review.contributions.some(item => item.disposition === 'remove' && item.point === 'one'));
  assert.ok(proposal.review.contributions.some(item => item.disposition === 'facet' && item.facet === 'connection'));
  assert.match(proposal.plan.candidate.atlas.points.find(item => item.id === 'purpose').body, /\(two\.md\)/);
  assert.deepEqual(proposal.plan.candidate.atlas.facets[0].targets, [{ point: 'two' }]);
  assert.equal(proposal.plan.candidate.atlas.points.find(item => item.id === 'detail').ancestors.some(item => item.id === 'one'), false);
});

test('removing a last child can deliberately clean its empty Branch in the reviewed candidate', async t => {
  const { view } = await fixture(t);
  const files = new Map(view.files.map(file => [file.path, file.content]));
  const outline = JSON.parse(files.get('trees/product/tree.json'));
  outline.children = [{ branch: 'last-group', title: 'Last grouping', children: [{ point: 'detail' }] }, { point: 'one' }, { point: 'two' }];
  files.set('trees/product/tree.json', json(outline));
  const original = validateFiles(files, { root: view.root });
  const input = { operation: 'remove', tree: 'product', id: 'detail', reason: 'This narrow observation is obsolete.' };
  assert.throws(() => prepareFormChange(original, input), /children|invalid|Branch/i);
  const proposal = prepareFormChange(original, { ...input, cleanupEmptyBranches: true });
  assert.equal(proposal.plan.status, 'ready');
  assert.equal(proposal.plan.candidate.atlas.branches.length, 0);
  assert.ok(proposal.review.contributions.some(item => item.disposition === 'remove' && item.point === 'detail'));
});

test('candidate preview renders the full exact candidate without applying it or enabling edits', async t => {
  const { root, view, files, request } = await fixture(t);
  const proposal = prepareFormChange(view, { operation: 'branch', tree: 'product', id: 'second-group', title: 'The new grouping', create: true, parent: { kind: 'point', id: 'purpose' }, members: [{ kind: 'point', id: 'two' }], reason: 'Group this explanation.' });
  const draft = await saveDraft(root, proposal);
  const preview = await request(`drafts/${draft.id}/preview`);
  assert.equal(preview.status, 200); assert.equal(preview.value.revision, draft.revision);
  assert.equal(preview.value.after.editable, false);
  assert.ok(preview.value.after.atlas.branches.some(item => item.id === 'second-group'));
  assert.match(preview.value.after.atlas.points[0].html, /<p>/);
  assert.equal(await fs.readFile(path.join(root, 'trees/product/tree.json'), 'utf8'), files['trees/product/tree.json']);
});

test('private typing survives restart and reopens its captured baseline without authored writes', async t => {
  const { view, request, restart, root, files } = await fixture(t);
  const copy = await request('working-copies', { baseline: view.identity, form: { kind: 'point', title: 'Edit Point', context: { captured: { identity: view.identity, files: view.files } }, fields: { controls: [{ value: 'Unfinished exact text' }] } } });
  assert.equal(copy.status, 200);
  await restart();
  const recovered = await request(`working-copies/${copy.value.id}`);
  assert.equal(recovered.value.form.fields.controls[0].value, 'Unfinished exact text');
  const draft = await request('drafts', { baseline: view.identity, changes: [{ path: 'trees/product/points/two.md', content: md({ id: 'two' }, 'Second explanation', 'Recovered and reviewed text.') }], reason: 'Resume preserved typing.' });
  assert.equal(draft.status, 200);
  assert.equal(await fs.readFile(path.join(root, 'trees/product/points/two.md'), 'utf8'), files['trees/product/points/two.md']);
});

test('source review retains unresolved changes across restart and exact-hash review decisions', async t => {
  const { request, restart, root } = await fixture(t);
  await request('sources/review', { uris: ['report.md#observation'] });
  await fs.writeFile(path.join(root, 'report.md'), '# Observation\n\nChanged evidence.\n');
  const changed = await request('sources/review', { uris: ['report.md#observation'] });
  assert.equal(changed.value.results[0].status, 'changed');
  await restart(); await request('sources/review', { uris: ['report.md#observation'] });
  const history = await request('sources/history');
  assert.equal(history.value.observations[0].reviewStatus, 'needs-review');
  const observed = history.value.observations[0];
  const decision = await request('sources/decisions', { expectedRevision: history.value.revision, decisions: [{ uri: observed.uri, sha256: observed.sha256, outcome: 'reviewed-unchanged', reason: 'The claim still describes the same limit.' }] });
  assert.equal(decision.value.observations[0].reviewStatus, 'reviewed-unchanged');
  assert.equal(decision.value.decisions[0].reason, 'The claim still describes the same limit.');
});

test('typed search finds the Facet at its actual owning Tree and supports offsets', async t => {
  const { request } = await fixture(t);
  const result = await request('search', { query: 'Recovery constraint', kinds: ['point', 'facet'], presentation: 'summary', limit: 1 });
  assert.equal(result.status, 200); assert.equal(result.value.results[0].kind, 'facet');
  assert.equal(result.value.results[0].tree, 'system'); assert.equal(result.value.results[0].on.point, 'system-base');
  const page = await request('search', { query: 'explanation', kinds: ['point', 'facet'], presentation: 'summary', offset: 1, limit: 1 });
  assert.equal(page.status, 200); assert.equal(page.value.results.length, 1);
});

test('rendered heading identities match source-review identities for duplicates and Unicode', () => {
  const body = '# A *claim*\n\n## A claim\n\n## Café `result`\n\n## A claim\n';
  const ids = [...renderMarkdown(body, { title: 'Overview', headingPrefix: 'source-' }).matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, markdownHeadingIds(body, { title: 'Overview' }).map(id => `source-${id}`));
});


test('Editor setup accepts a complete custom style and retains it only in an unapplied draft', async t => {
  const root = await tempDirectory('atlas-custom-setup-');
  const service = await startPortal(root, { editable: true });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' };
  const baseline = await (await fetch(new URL('/api/view', service.url), { headers })).json();
  const styleContent = md({ id: 'local-convention', revision: '2026-09' }, 'A local convention', 'Organize Trees around durable subjects. Keep qualifications in their owning explanation.');
  const response = await fetch(new URL('/api/initialize', service.url), { method: 'POST', headers, body: JSON.stringify({ baseline: baseline.identity, id: 'custom-example', title: 'A custom account', styleContent }) });
  const draft = await response.json();
  assert.equal(response.status, 200);
  assert.equal(draft.plan.candidate.atlas.style.id, 'local-convention');
  assert.equal(draft.plan.candidate.atlas.style.revision, '2026-09');
  assert.equal(draft.plan.changes.find(item => item.path === 'style.md').after, styleContent);
  await assert.rejects(fs.readFile(path.join(root, 'atlas.json')), error => error.code === 'ENOENT');
});

test('Editor setup rejects supplied blank Style choices and defaults only when selection is absent', async t => {
  const root = await tempDirectory('atlas-blank-style-setup-');
  const service = await startPortal(root, { editable: true });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' };
  const baseline = await (await fetch(new URL('/api/view', service.url), { headers })).json();
  const prepare = selection => fetch(new URL('/api/initialize', service.url), {
    method: 'POST', headers, body: JSON.stringify({ baseline: baseline.identity, id: 'example', title: 'An account', ...selection }),
  });
  for (const selection of [{ styleContent: '' }, { styleContent: '   ' }, { styleContent: null }, { styleId: '' }, { styleId: '   ' }, { styleId: null }, { styleId: 'concise-subjects', styleContent: '' }]) {
    const response = await prepare(selection);
    assert.equal(response.status, 400, JSON.stringify(selection));
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  }
  const response = await prepare({});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).plan.candidate.atlas.style.id, 'explanatory-perspectives');
  await assert.rejects(fs.readFile(path.join(root, 'atlas.json')), error => error.code === 'ENOENT');
});

test('Editor Style revision keeps supplied blank choices invalid', async t => {
  const { root, request } = await fixture(t);
  const baseline = (await request('view')).value;
  for (const selection of [{ styleContent: '' }, { styleContent: null }, { styleId: '' }, { styleId: null }, { styleId: 'concise-subjects', styleContent: '' }]) {
    const response = await request('style', { baseline: baseline.identity, reason: 'Review a different policy.', ...selection });
    assert.equal(response.status, 400, JSON.stringify(selection));
    assert.equal(response.value.error.code, 'INVALID_REQUEST');
  }
  assert.equal((await openAtlas(root)).identity, baseline.identity);
});
