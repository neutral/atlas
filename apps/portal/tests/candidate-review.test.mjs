import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { openAtlas } from '../../../library/src/model.mjs';
import { prepareChange, saveDraft } from '../../../library/src/authoring.mjs';
import { startPortal } from '../src/server.mjs';

const markdown = (header, body) => `---\n${JSON.stringify(header)}\n---\n# Recovery\n\n${body}\n`;
const pointPath = 'trees/service/points/recovery.md';
async function fixture(t, editable = true) {
  const workspace = await tempDirectory('portal-candidate-');
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, 'atlas');
  const files = {
    'atlas.json': JSON.stringify({ format: 'atlas/1', id: 'example', title: 'Example', trees: ['trees/service'] }),
    'trees/service/tree.json': JSON.stringify({ id: 'service', title: 'Service', scope: 'Recovery.', base: 'recovery', children: [] }),
    [pointPath]: markdown({ id: 'recovery' }, 'Saved drafts survive restart. Unsaved text can be lost.'),
    '.checks/scope.md': markdown({ id: 'scope', status: 'active', level: 'required' }, '## Requirement\n\nRetain the unsaved text limit.\n\n## Verification\n\nRead the candidate.\n\n## Failure\n\nThe limit is absent.'),
    'next-report.md': 'A newly cited report.',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content);
  }
  await writeFile(path.join(workspace, 'private.md'), 'Outside the launch grant.');
  const view = await openAtlas(root);
  const content = markdown({ id: 'recovery', sources: [{ uri: 'next-report.md' }, { uri: '../private.md' }] }, 'Read the next report while retaining the unsaved text limit.');
  const plan = structuredClone(prepareChange(view, { changes: [{ path: pointPath, content }], reason: 'Review candidate citations.' }));
  const actualCheckBody = plan.candidate.atlas.checks[0].body;
  plan.candidate.atlas.checks[0].body = 'An invented requirement that is absent from captured bytes.';
  plan.candidate.atlas.points[0].body = 'An invented explanation that is absent from captured bytes.';
  const saved = await saveDraft(root, { plan });
  const service = await startPortal(root, { editable });
  t.after(() => service.close());
  const request = async (endpoint, data) => {
    const result = await fetch(new URL(`/api/${endpoint}`, service.url), { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${service.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: result.status, value: await result.json() };
  };
  return { root, plan, saved, request, actualCheckBody, original: files[pointPath] };
}

test('Editor review shows canonical candidate explanations and Check definitions for plain saved drafts', async t => {
  const { saved, request, actualCheckBody } = await fixture(t);
  const reviewed = await request(`drafts/${saved.id}`);
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.value.revision, saved.revision);
  assert.equal(reviewed.value.plan.candidate.atlas.checks[0].body, actualCheckBody);
  assert.match(reviewed.value.plan.candidate.atlas.points[0].body, /unsaved text limit/);
  assert.ok(reviewed.value.impact.changedPoints.some(point => point.id === 'recovery'));
});

test('candidate source review reads newly declared citations, retains launch grants, and rejects stale revisions', async t => {
  const { root, plan, saved, request, original } = await fixture(t);
  const target = { id: saved.id, revision: saved.revision };
  const current = await request('sources/review', { uris: ['next-report.md'] });
  assert.equal(current.value.results[0].status, 'uninspected');
  const candidate = await request('sources/review', { draft: target, uris: ['next-report.md', '../private.md'] });
  assert.equal(candidate.status, 200);
  assert.equal(candidate.value.identity, plan.candidate.identity);
  assert.equal(candidate.value.results[0].status, 'current');
  assert.match(candidate.value.results[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(candidate.value.results[0].citations[0].from.id, 'recovery');
  assert.equal(candidate.value.results[1].status, 'denied');
  assert.equal(candidate.value.results[1].sha256, undefined);
  assert.equal(await readFile(path.join(root, pointPath), 'utf8'), original);
  await saveDraft(root, { id: saved.id, expectedRevision: saved.revision, plan: { ...plan, reason: 'Another review intent.' } });
  const stale = await request('sources/review', { draft: target, uris: ['next-report.md'] });
  assert.equal(stale.status, 409);
  assert.equal(stale.value.error.code, 'STALE_DRAFT');
});

test('read-only Portal does not expose private candidate source review', async t => {
  const { saved, request } = await fixture(t, false);
  const result = await request('sources/review', { draft: { id: saved.id, revision: saved.revision }, uris: ['next-report.md'] });
  assert.equal(result.status, 403);
  assert.equal(result.value.error.code, 'READ_ONLY');
});
