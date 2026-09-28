import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { startPortal } from '../src/server.mjs';
import { renderMarkdown, presentAtlas } from '../src/markdown.mjs';
import { openAtlas } from '../../../library/src/model.mjs';
import { prepareChange, saveDraft } from '../../../library/src/authoring.mjs';
import { preparePublication } from '../../../library/src/publication.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const markdown = (id, title, body) => `---\n${JSON.stringify({ id })}\n---\n# ${title}\n\n${body}\n`;
const basePath = 'trees/service/points/base.md';
const detailPath = 'trees/service/points/detail.md';
const treePath = 'trees/service/tree.json';

async function fixture(t, options = {}) {
  const workspace = await tempDirectory('portal-test-');
  const root = path.join(workspace, 'atlas');
  const files = new Map([
    ['atlas.json', json({ format: 'atlas/1', id: 'example', title: 'Example Atlas', trees: ['trees/service'] })],
    [treePath, json({ id: 'service', title: 'Service', scope: 'Service obligations.', base: 'purpose', children: [{ point: 'detail' }] })],
    [basePath, markdown('purpose', 'Service purpose', 'The service has a declared purpose.')],
    [detailPath, markdown('detail', 'Detailed responsibility', 'The participant retains required material.')],
  ]);
  for (const [name, content] of files) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  const serviceOptions = { ...options, ...(options.exportDirectory === true ? { exportDirectory: path.join(workspace, 'published') } : {}) };
  let portal = await startPortal(root, serviceOptions);
  t.after(async () => { await portal.close(); await fs.rm(workspace, { recursive: true, force: true }); });
  const request = async (endpoint, { method = 'GET', data, token = portal.token, headers = {} } = {}) => {
    return new Promise((resolve, reject) => {
      const request = http.request(new URL(endpoint, portal.url), { method, headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(data)) }), ...headers } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, headers: new Headers(response.headers), value: response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text });
        });
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end(data === undefined ? undefined : JSON.stringify(data));
    });
  };
  const restart = async () => { const old = portal; await old.close(); portal = await startPortal(root, serviceOptions); return old.token; };
  return { root, workspace, files, request, restart };
}

test('HTTP API enforces bearer, same-origin, host and read-only boundaries', async (t) => {
  const { request } = await fixture(t);
  const page = await request('/', { token: null });
  assert.equal(page.status, 200);
  assert.match(page.value, /Tree canvas/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'), /img-src 'none'/);
  for (const token of [null, 'wrong', '']) {
    const result = await request('/api/view', { token });
    assert.equal(result.status, 403);
    assert.equal(result.value.error.code, 'UNAUTHORIZED');
  }
  for (const headers of [{ Origin: 'https://untrusted.example' }, { Host: 'untrusted.example' }]) {
    const result = await request('/api/view', { headers });
    assert.equal(result.status, 403);
    assert.equal(result.value.error.code, 'FORBIDDEN');
  }
  const view = await request('/api/view');
  assert.equal(view.status, 200);
  assert.equal(view.value.editable, false);
  assert.equal(view.value.status, 'ready');
  for (const endpoint of ['/api/files', '/api/drafts', '/api/transactions', '/api/connection', '/api/publication', '/api/state']) assert.equal((await request(endpoint)).value.error.code, 'READ_ONLY');
  assert.equal((await request('/api/apply', { method: 'POST', data: { id: 'anything' } })).value.error.code, 'READ_ONLY');
  assert.equal((await request('/atlas.json')).status, 404);
  assert.equal((await request('/%2e%2e/atlas.json')).status, 404);
});

test('source retrieval cannot expand launch grants and never fetches URLs', async (t) => {
  const { root, workspace, request } = await fixture(t);
  await fs.writeFile(path.join(workspace, 'outside.md'), 'PRIVATE OUTSIDE BYTES');
  await fs.mkdir(path.join(root, 'sources'));
  await fs.writeFile(path.join(root, 'sources/inside.md'), 'Allowed source bytes');
  await fs.symlink('../../outside.md', path.join(root, 'sources/escape.md'));
  const source = async (uri, extra = {}) => request('/api/source', { method: 'POST', data: { source: { uri }, ...extra } });
  assert.equal((await source('sources/inside.md')).value.content, 'Allowed source bytes');
  for (const uri of ['../outside.md', 'sources/escape.md']) {
    const result = await source(uri);
    assert.equal(result.value.status, 'denied');
    assert.equal(result.value.content, undefined);
    assert.ok(!JSON.stringify(result.value).includes('PRIVATE OUTSIDE BYTES'));
  }
  assert.equal((await source('https://127.0.0.1:1/no-fetch')).value.status, 'reference');
  assert.equal((await source('sources/inside.md', { allowedRoots: [workspace] })).value.error.code, 'INVALID_REQUEST');
  assert.equal((await source('sources/inside.md', { root: workspace })).value.error.code, 'INVALID_REQUEST');
  assert.equal((await source('file:///etc/passwd')).value.status, 'invalid');
});

test('invalid drafts persist, expose diagnostics and cannot alter authored records', async (t) => {
  const { root, files, request, restart } = await fixture(t, { editable: true });
  const baseline = (await request('/api/files')).value.identity;
  const saved = await request('/api/drafts', { method: 'POST', data: { baseline, changes: [{ path: detailPath, content: 'Malformed record retained for repair' }], reason: 'Repair this record' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.plan.status, 'invalid');
  assert.ok(saved.value.plan.validation.diagnostics.length);
  const id = saved.value.id;
  await restart();
  assert.equal((await request(`/api/drafts/${id}`)).value.plan.changes[0].after, 'Malformed record retained for repair');
  const rejected = await request('/api/apply', { method: 'POST', data: { id, expectedRevision: saved.value.revision } });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.value.error.code, 'INVALID_CANDIDATE');
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), files.get(detailPath));
  assert.deepEqual((await request('/api/transactions')).value, []);
});

test('continued draft editing retains prior additions, deletions and original baseline across restart', async (t) => {
  const { root, files, request, restart } = await fixture(t, { editable: true });
  const baseline = (await request('/api/files')).value.identity;
  const newPath = 'trees/service/points/replacement.md';
  const tree = JSON.parse(files.get(treePath)); tree.children = [{ point: 'replacement' }];
  const initial = [
    { path: treePath, content: json(tree) },
    { path: detailPath, content: null },
    { path: newPath, content: markdown('replacement', 'Replacement detail', 'Initial draft explanation.') },
  ];
  const saved = (await request('/api/drafts', { method: 'POST', data: { baseline, changes: initial, reason: 'Replace a detail' } })).value;
  assert.equal(saved.plan.status, 'ready');
  const oldToken = await restart();
  assert.equal((await request('/api/view', { token: oldToken })).status, 403);
  const retained = (await request(`/api/drafts/${saved.id}`)).value;
  const changes = retained.plan.changes.map((change) => ({ path: change.path, content: change.path === newPath ? markdown('replacement', 'Replacement detail', 'Continued draft explanation.') : change.after }));
  const revised = (await request('/api/drafts', { method: 'POST', data: { id: saved.id, expectedRevision: saved.revision, changes, reason: 'Continue the original draft' } })).value;
  assert.equal(revised.plan.baseline.identity, baseline);
  assert.equal(revised.plan.changes.length, 3);
  assert.equal(revised.plan.changes.find((change) => change.path === detailPath).before, files.get(detailPath));
  assert.equal(revised.plan.changes.find((change) => change.path === newPath).before, null);
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), files.get(detailPath));
  const applied = await request('/api/apply', { method: 'POST', data: { id: saved.id, expectedRevision: revised.revision } });
  assert.equal(applied.value.status, 'complete');
  assert.match(await fs.readFile(path.join(root, newPath), 'utf8'), /Continued draft explanation/);
  await assert.rejects(fs.readFile(path.join(root, detailPath)), { code: 'ENOENT' });
  assert.equal((await request('/api/view')).value.status, 'ready');
});

test('restarted draft preparation does not silently rebase or overwrite foreign changes', async (t) => {
  const { root, files, request, restart } = await fixture(t, { editable: true });
  const baseline = (await request('/api/files')).value.identity;
  const change = { path: detailPath, content: markdown('detail', 'Detailed responsibility', 'Proposed revision.') };
  const saved = (await request('/api/drafts', { method: 'POST', data: { baseline, changes: [change], reason: 'Revise a detail' } })).value;
  await restart();
  const foreign = files.get(basePath).replace('declared purpose', 'externally revised purpose');
  await fs.writeFile(path.join(root, basePath), foreign);
  const updated = (await request('/api/drafts', { method: 'POST', data: { id: saved.id, expectedRevision: saved.revision, changes: [{ ...change, content: change.content.replace('Proposed', 'Continued') }], reason: 'Continue from the saved baseline' } })).value;
  assert.equal(updated.plan.baseline.identity, baseline);
  const apply = await request('/api/apply', { method: 'POST', data: { id: saved.id, expectedRevision: updated.revision } });
  assert.equal(apply.status, 409);
  assert.equal(apply.value.error.code, 'STALE');
  assert.equal(await fs.readFile(path.join(root, basePath), 'utf8'), foreign);
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), files.get(detailPath));
});

test('continued drafts preserve evidence preconditions prepared by another shared-library adapter', async (t) => {
  const { root, files, request } = await fixture(t, { editable: true });
  await fs.mkdir(path.join(root, 'sources'));
  const evidencePath = path.join(root, 'sources/evidence.md');
  await fs.writeFile(evidencePath, 'Observed evidence bytes');
  const sourcePreconditions = [{ uri: 'sources/evidence.md', sha256: createHash('sha256').update('Observed evidence bytes').digest('hex') }];
  const change = { path: detailPath, content: files.get(detailPath).replace('required material', 'additional required material') };
  const plan = prepareChange(await openAtlas(root), { changes: [change], reason: 'Source-backed change', sourcePreconditions });
  const draft = await saveDraft(root, { plan });
  const continued = (await request('/api/drafts', { method: 'POST', data: { id: draft.id, expectedRevision: draft.revision, changes: [change], reason: 'Continue the source-backed change' } })).value;
  assert.deepEqual(continued.plan.sourcePreconditions, sourcePreconditions);
  await fs.writeFile(evidencePath, 'Changed evidence bytes');
  const applied = await request('/api/apply', { method: 'POST', data: { id: draft.id, expectedRevision: continued.revision } });
  assert.notEqual(applied.status, 200);
  assert.equal(applied.value.error.code, 'STALE_SOURCE');
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), files.get(detailPath));
});

test('repair uses captured malformed record bytes and restores a valid Atlas', async (t) => {
  const { root, files, request } = await fixture(t, { editable: true });
  await fs.writeFile(path.join(root, detailPath), 'Broken frontmatter');
  const view = await request('/api/view');
  assert.equal(view.value.status, 'invalid');
  assert.equal(view.value.atlas, null);
  const captured = (await request('/api/files')).value;
  assert.equal(captured.files.find((file) => file.path === detailPath).content, 'Broken frontmatter');
  const saved = (await request('/api/drafts', { method: 'POST', data: { baseline: captured.identity, changes: [{ path: detailPath, content: files.get(detailPath) }], reason: 'Repair malformed Point' } })).value;
  assert.equal(saved.plan.status, 'ready');
  assert.equal((await request('/api/apply', { method: 'POST', data: { id: saved.id, expectedRevision: saved.revision } })).value.status, 'complete');
  assert.equal((await request('/api/view')).value.status, 'ready');
});

test('manifest repair discovers existing records and preserves them through draft continuation', async (t) => {
  const { root, files, request, restart } = await fixture(t, { editable: true });
  await fs.writeFile(path.join(root, 'atlas.json'), '{ malformed manifest');
  const captured = (await request('/api/files')).value;
  assert.deepEqual(captured.files.map((file) => file.path), ['atlas.json']);
  const saved = await request('/api/drafts', { method: 'POST', data: { baseline: captured.identity, changes: [{ path: 'atlas.json', content: files.get('atlas.json') }], reason: 'Repair the manifest' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.plan.status, 'ready');
  assert.equal(saved.value.plan.baseline.identity, captured.identity);
  assert.deepEqual(saved.value.plan.observedFiles.map((file) => file.path).sort(), [treePath, basePath, detailPath].sort());
  await restart();
  const retained = (await request(`/api/drafts/${saved.value.id}`)).value;
  const changes = retained.plan.changes.map((change) => ({ path: change.path, content: change.after }));
  changes.push({ path: detailPath, content: files.get(detailPath).replace('required material', 'the declared material') });
  const continued = (await request('/api/drafts', { method: 'POST', data: { id: saved.value.id, expectedRevision: saved.value.revision, changes, reason: 'Refine the repaired account' } })).value;
  assert.equal(continued.plan.baseline.identity, captured.identity);
  assert.equal(continued.plan.changes.find((change) => change.path === detailPath).before, files.get(detailPath));
  assert.deepEqual(continued.plan.observedFiles, retained.plan.observedFiles);
  const applied = await request('/api/apply', { method: 'POST', data: { id: saved.value.id, expectedRevision: continued.revision } });
  assert.equal(applied.value.status, 'complete', JSON.stringify(applied.value));
  assert.equal(await fs.readFile(path.join(root, basePath), 'utf8'), files.get(basePath));
  assert.equal(await fs.readFile(path.join(root, treePath), 'utf8'), files.get(treePath));
  assert.match(await fs.readFile(path.join(root, detailPath), 'utf8'), /the declared material/);
  assert.equal((await request('/api/view')).value.status, 'ready');
});

test('manifest repair checks discovered records before any authored write', async (t) => {
  const { root, files, request } = await fixture(t, { editable: true });
  const malformed = '{ malformed manifest';
  await fs.writeFile(path.join(root, 'atlas.json'), malformed);
  const baseline = (await request('/api/files')).value.identity;
  const draft = (await request('/api/drafts', { method: 'POST', data: { baseline, changes: [{ path: 'atlas.json', content: files.get('atlas.json') }], reason: 'Repair the manifest' } })).value;
  assert.equal(draft.plan.status, 'ready');
  const foreign = files.get(detailPath).replace('required material', 'material revised by another author');
  await fs.writeFile(path.join(root, detailPath), foreign);
  const applied = await request('/api/apply', { method: 'POST', data: { id: draft.id, expectedRevision: draft.revision } });
  assert.equal(applied.status, 409);
  assert.equal(applied.value.error.code, 'STALE');
  assert.equal(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'), malformed);
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), foreign);
  assert.deepEqual((await request('/api/transactions')).value, []);
});

test('continuing an invalid manifest draft discovers records when the manifest becomes valid', async (t) => {
  const { root, files, request, restart } = await fixture(t, { editable: true });
  await fs.writeFile(path.join(root, 'atlas.json'), '{ broken manifest');
  const baseline = (await request('/api/files')).value.identity;
  const invalid = (await request('/api/drafts', { method: 'POST', data: { baseline, changes: [{ path: 'atlas.json', content: '{}' }], reason: 'Manifest repair in progress' } })).value;
  assert.equal(invalid.plan.status, 'invalid');
  await restart();
  const corrected = await request('/api/drafts', { method: 'POST', data: { id: invalid.id, expectedRevision: invalid.revision, changes: [{ path: 'atlas.json', content: files.get('atlas.json') }], reason: 'Complete the manifest repair' } });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.value.plan.status, 'ready', JSON.stringify(corrected.value.plan.validation));
  assert.equal(corrected.value.plan.baseline.identity, baseline);
  assert.equal(corrected.value.plan.observedFiles.length, 3);
  assert.equal((await request('/api/apply', { method: 'POST', data: { id: invalid.id, expectedRevision: corrected.value.revision } })).value.status, 'complete');
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), files.get(detailPath));
});

test('unfamiliar paths, request scope changes and replaced record symlinks fail closed', async (t) => {
  const { root, workspace, files, request } = await fixture(t, { editable: true });
  const baseline = (await request('/api/files')).value.identity;
  for (const target of ['../outside.md', 'private.md', '.atlas-state/override.json']) {
    const response = await request('/api/prepare', { method: 'POST', data: { baseline, changes: [{ path: target, content: 'Unauthorized bytes' }], reason: 'Invalid target' } });
    assert.equal(response.status, 400);
    assert.equal(response.value.error.code, 'UNSAFE_PATH');
  }
  const scope = await request('/api/prepare', { method: 'POST', data: { baseline, changes: [], reason: 'Scope injection', root: workspace } });
  assert.equal(scope.value.error.code, 'INVALID_REQUEST');
  const saved = (await request('/api/drafts', { method: 'POST', data: { baseline, changes: [{ path: detailPath, content: files.get(detailPath).replace('required material', 'additional required material') }], reason: 'Change a detail' } })).value;
  await fs.writeFile(path.join(workspace, 'outside.md'), 'Foreign bytes');
  await fs.unlink(path.join(root, detailPath));
  await fs.symlink('../../../../outside.md', path.join(root, detailPath));
  const applied = await request('/api/apply', { method: 'POST', data: { id: saved.id, expectedRevision: saved.revision } });
  assert.notEqual(applied.status, 200);
  assert.equal(await fs.readFile(path.join(workspace, 'outside.md'), 'utf8'), 'Foreign bytes');
  assert.equal(await fs.readFile(path.join(root, basePath), 'utf8'), files.get(basePath));
});

test('Markdown keeps HTML, executable links, images and unknown local references inert', () => {
  const text = '<script>alert(1)</script>\n\n[script](javascript:alert(1)) [external](https://example.test/path) [credential](https://user:password@example.test) [local](private.md) ![sample](https://example.test/image.png)';
  const rendered = renderMarkdown(text);
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('<img'));
  assert.ok(!rendered.includes('href="javascript:'));
  assert.ok(!rendered.includes('href="private.md"'));
  assert.ok(!rendered.includes('href="https://user:password'));
  assert.match(rendered, /href="https:\/\/example.test\/path" target="_blank" rel="noopener noreferrer"/);
  assert.match(rendered, /Image: sample/);
  assert.match(rendered, /&lt;script&gt;/);
  assert.equal((rendered.match(/<a /g) ?? []).length, (rendered.match(/<\/a>/g) ?? []).length);
  assert.equal((rendered.match(/<span /g) ?? []).length, (rendered.match(/<\/span>/g) ?? []).length);
});

test('normalized Point titles remain separate from body HTML and known links resolve deliberately', async (t) => {
  const { root } = await fixture(t);
  const view = await openAtlas(root);
  const point = view.atlas.points.find((item) => item.id === 'detail');
  assert.ok(!point.body.startsWith('# '));
  const presentation = presentAtlas(view);
  const rendered = presentation.atlas.points.find((item) => item.id === 'detail');
  assert.equal(rendered.title, 'Detailed responsibility');
  assert.ok(!rendered.html.includes('<h1>'));
  assert.match(rendered.html, /participant retains required material/);
  const internal = renderMarkdown('[Detail](trees/service/points/detail.md)', { resolveLink: (href) => href === detailPath ? '?tree=service&point=detail' : null });
  assert.match(internal, /href="\?tree=service&amp;point=detail"/);
  assert.ok(!internal.includes('target="_blank"'));
});

test('publication rendering resolves included Point links without restoring excluded paths or prose', async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, detailPath), markdown('detail', 'Detailed responsibility', `[Same Point](detail.md) and [Excluded Base](${basePath}).`));
  const view = await openAtlas(root);
  const detail = view.atlas.points.find((point) => point.id === 'detail');
  const publication = preparePublication(view, { trees: ['service'], points: ['detail'] });
  const data = presentAtlas({ ...view, atlas: publication.atlas }, { pointPaths: [detail] });
  const point = data.atlas.points.find((record) => record.id === 'detail');
  assert.match(point.html, /href="\?tree=service&amp;point=detail"/);
  assert.ok(!point.html.includes('point=purpose'));
  assert.match(point.html, /Reference not included/);
  const placeholder = data.atlas.points.find((record) => record.id === 'purpose');
  assert.equal(placeholder.title, undefined);
  assert.equal(placeholder.body, undefined);
  assert.equal(placeholder.html, '');
  assert.equal(point.path, undefined);
});

test('saved draft updates, application and deletion require the exact revision reviewed', async t => {
  const { root, files, request } = await fixture(t, { editable: true });
  const baseline = (await request('/api/files')).value.identity;
  const change = { path: detailPath, content: files.get(detailPath).replace('required material', 'first proposed material') };
  const first = (await request('/api/drafts', { method: 'POST', data: { baseline, changes: [change], reason: 'First review' } })).value;
  const newer = (await request('/api/drafts', { method: 'POST', data: { id: first.id, expectedRevision: first.revision, changes: [{ ...change, content: change.content.replace('first proposed', 'newer proposed') }], reason: 'A later review' } })).value;
  assert.notEqual(first.revision, newer.revision);
  for (const [endpoint, method, data] of [
    ['/api/apply', 'POST', { id: first.id, expectedRevision: first.revision }],
    ['/api/drafts', 'DELETE', { id: first.id, expectedRevision: first.revision }],
    ['/api/drafts', 'POST', { id: first.id, expectedRevision: first.revision, changes: [change], reason: 'An old editor' }],
  ]) {
    const result = await request(endpoint, { method, data });
    assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(result.value.error.code, 'STALE_DRAFT');
  }
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), files.get(detailPath));
  assert.equal((await request('/api/apply', { method: 'POST', data: { id: first.id } })).value.error.code, 'INVALID_REQUEST');
  assert.equal((await request('/api/apply', { method: 'POST', data: { id: newer.id, expectedRevision: newer.revision } })).value.status, 'complete');
  assert.match(await fs.readFile(path.join(root, detailPath), 'utf8'), /newer proposed material/);
});

test('empty-project creation previews a durable draft before applying its reviewed revision', async t => {
  const { root, request } = await fixture(t, { editable: true });
  await fs.rm(path.join(root, 'trees'), { recursive: true }); await fs.unlink(path.join(root, 'atlas.json'));
  const view = (await request('/api/view')).value;
  assert.equal(view.canInitialize, true);
  const prepared = (await request('/api/initialize', { method: 'POST', data: { baseline: view.identity, id: 'new-atlas', title: 'A new Atlas' } })).value;
  assert.equal(prepared.plan.status, 'ready'); assert.deepEqual(await fs.readdir(root), []);
  const applied = await request('/api/apply', { method: 'POST', data: { id: prepared.id, expectedRevision: prepared.revision } });
  assert.equal(applied.value.status, 'complete');
  const created = (await request('/api/view')).value;
  assert.equal(created.canInitialize, false); assert.equal(created.atlas.id, 'new-atlas');
});

test('publication preview and agent connection keep destinations and launch scope fixed', async t => {
  const configuration = { mcpServers: { atlas: { command: 'trusted-launcher', args: ['mcp', '--root', '/fixed-root'] } } };
  const { workspace, request } = await fixture(t, { editable: true, exportDirectory: true, agentConfiguration: configuration });
  assert.deepEqual((await request('/api/connection')).value, configuration);
  const available = (await request('/api/publication')).value;
  assert.equal(available.output, path.join(workspace, 'published'));
  const selected = { baseline: available.identity, trees: ['service'], points: ['detail'], sources: [] };
  assert.equal((await request('/api/publication/prepare', { method: 'POST', data: { ...selected, output: path.join(workspace, 'untrusted') } })).value.error.code, 'INVALID_REQUEST');
  const preview = (await request('/api/publication/prepare', { method: 'POST', data: selected })).value;
  assert.equal(preview.status, 'ready'); assert.equal(preview.counts.points, 1);
  await assert.rejects(fs.stat(available.output), { code: 'ENOENT' });
  const exported = (await request('/api/publication/apply', { method: 'POST', data: { id: preview.id } })).value;
  assert.equal(exported.status, 'complete'); assert.equal(exported.output, available.output);
  assert.equal((await request('/api/publication/apply', { method: 'POST', data: { id: preview.id } })).value.error.code, 'EXPORT_EXPIRED');
  await fs.stat(path.join(available.output, 'index.html'));
});

test('private-state inspection leaves authored files untouched and reports ownership errors', async t => {
  const { root, request } = await fixture(t, { editable: true });
  const files = await fs.readdir(root);
  assert.equal((await request('/api/view')).value.stateIssue, null);
  const state = (await request('/api/state')).value;
  assert.equal(state.status, 'ready');
  assert.ok(!state.directory.startsWith(root + path.sep));
  await assert.rejects(fs.stat(state.directory), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(root), files);
  await fs.mkdir(state.directory, { recursive: true });
  await fs.writeFile(path.join(state.directory, 'owner.json'), json({ format: 'atlas.state/1', root: '/another-atlas' }));
  assert.equal((await request('/api/view')).value.stateIssue.code, 'STATE_OWNER');
  assert.equal((await request('/api/state')).value.error.code, 'STATE_OWNER');
  assert.deepEqual(await fs.readdir(root), files);
});

test('Markdown preserves stable heading fragments and routes them only to included Points', async t => {
  const rendered = renderMarkdown('## **Café** `scope`\n\n[Here](#café-scope)\n\n## Scope\n\n## Scope\n\n## Scope-1', { headingPrefix: 'point-example-', title: 'Scope' });
  for (const slug of ['scope', 'café-scope', 'scope-1', 'scope-2', 'scope-1-1']) assert.ok(rendered.includes(`id="point-example-${slug}"`));
  assert.match(rendered, /href="#point-example-caf%C3%A9-scope"/);
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, basePath), markdown('purpose', 'Service purpose', '[Detail](detail.md#scope)'));
  const view = await openAtlas(root);
  const full = presentAtlas(view).atlas.points.find(point => point.id === 'purpose').html;
  assert.match(full, /href="\?tree=service&amp;point=detail#point-detail-scope"/);
  const publication = preparePublication(view, { trees: ['service'], points: ['purpose'] });
  const subset = presentAtlas({ ...view, atlas: publication.atlas }, { pointPaths: view.atlas.points.filter(point => point.id === 'purpose') });
  assert.ok(!subset.atlas.points.find(point => point.id === 'purpose').html.includes('point-detail-scope'));
});

test('raw-byte repairs retain exact originals through saved draft continuation and restart', async t => {
  const { root, request, restart } = await fixture(t, { editable: true });
  const original = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
  await fs.writeFile(path.join(root, detailPath), original);
  const captured = (await request('/api/files')).value;
  const raw = captured.files.find(file => file.path === detailPath);
  assert.equal(raw.content, null); assert.equal(raw.rawBase64, original.toString('base64'));
  const first = (await request('/api/drafts', { method: 'POST', data: { baseline: captured.identity, changes: [{ path: detailPath, content: markdown('detail', 'Repaired detail', 'First proposed repair.') }], reason: 'Explicit UTF-8 repair' } })).value;
  assert.equal(first.plan.status, 'ready');
  assert.equal(first.plan.changes[0].beforeBase64, original.toString('base64'));
  await restart();
  const nextText = markdown('detail', 'Repaired detail', 'Reviewed repair after restart.');
  const continued = await request('/api/drafts', { method: 'POST', data: { id: first.id, expectedRevision: first.revision, changes: [{ path: detailPath, content: nextText }], reason: 'Continue exact original repair' } });
  assert.equal(continued.status, 200, JSON.stringify(continued.value));
  assert.equal(continued.value.plan.baseline.identity, captured.identity);
  assert.equal(continued.value.plan.changes[0].beforeBase64, original.toString('base64'));
  assert.deepEqual(await fs.readFile(path.join(root, detailPath)), original);
  const applied = await request('/api/apply', { method: 'POST', data: { id: first.id, expectedRevision: continued.value.revision } });
  assert.equal(applied.value.status, 'complete', JSON.stringify(applied.value));
  assert.equal(await fs.readFile(path.join(root, detailPath), 'utf8'), nextText);
});
