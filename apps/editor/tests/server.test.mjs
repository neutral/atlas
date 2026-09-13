import { calculateCheckRevision } from '../../../library/src/evaluation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startEditor } from '../src/server.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const mapBody = (fixture, summary) => fs.readFileSync(path.join(fixture.atlasRoot, 'maps/architecture/map.md'), 'utf8').split('---').slice(2).join('---').replace(/(^# [^\n]+\n\s*\n)[^\n]+/mu, `$1${summary}`);
const anchorPath = 'maps/architecture/points/edge-authentication.md';

function project(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-editor-service-')));
  const repositoryRoot = path.join(directory, 'project');
  const atlasRoot = path.join(repositoryRoot, 'atlas');
  fs.cpSync(path.join(root, 'spec/examples/valid/cross-map'), atlasRoot, { recursive: true });
  const options = { repositoryRoot, atlasPath: 'atlas', stateDirectory: path.join(directory, 'state') };
  const editors = [];
  t.after(async () => {
    for (const editor of editors) await editor.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, atlasRoot, options, async start(overrides = {}) {
    const editor = await startEditor({ ...options, ...overrides });
    editors.push(editor);
    return editor;
  } };
}

function request(editor, route, { method = 'POST', headers = {}, raw = '{}', authenticated = true, onData } = {}) {
  const url = new URL(editor.origin);
  const token = new URLSearchParams(new URL(editor.url).hash.slice(1)).get('token');
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: url.hostname, port: url.port, path: route, method, agent: false,
      headers: { ...(authenticated ? { Origin: editor.origin, 'X-Atlas-Token': token, 'Content-Type': 'application/json' } : {}), ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => { chunks.push(chunk); onData?.(chunk); });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: response.headers, text,
          body: response.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : null });
      });
    });
    outgoing.on('error', error => reject(new Error(`${method} ${route} (${Buffer.byteLength(raw)} request bytes): ${error.message}`, { cause: error })));
    outgoing.setTimeout(20_000, () => outgoing.destroy(new Error('Editor request did not finish.')));
    outgoing.end(raw);
  });
}

async function rpc(editor, method, params = {}) {
  const response = await request(editor, `/api/${method}`, { raw: JSON.stringify(params) });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.ok, true, response.text);
  return response.body.result;
}

// A preload inherited by the real service worker supplies a portable filesystem
// failure without exposing fault injection through the Editor's launch protocol.
async function unreadableSourceProcess(fixture, program) {
  const preload = path.join(fixture.directory, 'inaccessible-source.mjs'), entry = path.join(fixture.directory, 'reopen-editor.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const open = fs.openSync;
fs.openSync = function(file, ...args) {
  if (file === ${JSON.stringify(path.join(fixture.atlasRoot, anchorPath))}) throw Object.assign(new Error('Controlled unreadable Point'), { code: 'EACCES' });
  return open.call(this, file, ...args);
};\n`);
  fs.writeFileSync(entry, `import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startEditor } from ${JSON.stringify(new URL('../src/server.mjs', import.meta.url).href)};
const options = ${JSON.stringify(fixture.options)}, editors = [];
async function start(overrides = {}) { const editor = await startEditor({ ...options, ...overrides }); editors.push(editor); return editor; }
async function request(editor, method, params = {}) {
  const token = new URLSearchParams(new URL(editor.url).hash.slice(1)).get('token');
  const response = await fetch(editor.origin + '/api/' + method, { method: 'POST', headers: { Origin: editor.origin, 'X-Atlas-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return response.json();
}
try { const result = await (async () => { ${program} })(); process.stdout.write(JSON.stringify(result)); }
finally { for (const editor of editors) await editor.close(); }\n`);
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href, entry], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function stateInventory(directory) {
  return fs.readdirSync(directory, { recursive: true }).sort().map(file => {
    const stat = fs.lstatSync(path.join(directory, file));
    return [file, stat.isFile() ? createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex') : 'directory'];
  });
}

test('state, search, refresh, and restart leave repository files unchanged', async t => {
  const fixture = project(t), before = stateInventory(fixture.options.repositoryRoot);
  let editor = await fixture.start();
  const first = await rpc(editor, 'state');
  assert.equal(first.view.contract, 'atlas.read-view/2');
  assert.deepEqual(Object.keys(first.workspace).sort(), ['atlasPath', 'atlasRoot', 'configuration',
    'configurationDigest', 'configurationSourceDigest', 'repositoryRoot'].sort());
  await rpc(editor, 'find', { viewId: first.viewId, query: 'edge' });
  const refreshed = await rpc(editor, 'refresh');
  assert.equal(refreshed.view.identity.digest, first.view.identity.digest);
  assert.deepEqual(stateInventory(fixture.options.repositoryRoot), before);
  const durable = stateInventory(fixture.options.stateDirectory);
  await editor.close();
  editor = await fixture.start();
  assert.equal((await rpc(editor, 'state')).view.identity.digest, first.view.identity.digest);
  assert.deepEqual(stateInventory(fixture.options.repositoryRoot), before);
  assert.deepEqual(stateInventory(fixture.options.stateDirectory), durable);
});

function evaluator(fixture, { blocking = false } = {}) {
  const checkDirectory = path.join(fixture.atlasRoot, '.checks');
  fs.mkdirSync(checkDirectory, { recursive: true });
  fs.copyFileSync(path.join(root, 'spec/examples/valid/checks/.checks/boundary.md'), path.join(checkDirectory, 'boundary.md'));
  const check = `---\n${JSON.stringify({ type: 'check', id: 'question-punctuation', status: 'active' }, null, 2)}\n---\n\n# End Map questions with a question mark\n\nEach Map question ends with the literal question-mark character.\n\n## Requirement\n\nEvery Map question ends with the literal question-mark character.\n\n## Verification\n\nRead every Map question and inspect its final character. This Check verifies punctuation only.\n\n## Failure\n\nReport each Map whose question lacks the required final character.\n\n## Exceptions\n\nNone.\n`;
  fs.writeFileSync(path.join(checkDirectory, 'question-punctuation.md'), check);
  const registration = { check: 'question-punctuation', level: 'required', 'applies-to': ['map'] };
  const catalogPath = path.join(fixture.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  const boundary = JSON.parse(fs.readFileSync(path.join(root, 'spec/examples/valid/checks/catalog.json'))).checks.find(item => item.check === 'boundary');
  catalog.checks = [...(catalog.checks ?? []).filter(item => !['boundary', registration.check].includes(item.check)), boundary, registration];
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  const revision = calculateCheckRevision(check, registration);
  const invocationFile = path.join(fixture.directory, 'invocations.txt');
  const releaseFile = path.join(fixture.directory, 'release-evaluator');
  const module = path.join(fixture.directory, 'evaluator.mjs');
  fs.writeFileSync(module, `import fs from 'node:fs';
export const registrations = [{ id: 'literal-question-punctuation', version: 'test-1', checks: [{ id: 'question-punctuation', revision: ${JSON.stringify(revision)} }], async verify({ view, subjects }) {
  fs.appendFileSync(${JSON.stringify(invocationFile)}, 'invoked\\n');
  ${blocking ? `const deadline = Date.now() + 10000; while (!fs.existsSync(${JSON.stringify(releaseFile)})) { if (Date.now() > deadline) throw new Error('Qualification release signal was not supplied.'); await new Promise(resolve => setTimeout(resolve, 10)); }` : ''}
  const maps = subjects.map(subject => view.validation.normalized.maps.find(map => map.id === subject.id));
  const failed = maps.filter(map => !map.question.endsWith('?'));
  return { outcome: failed.length ? 'fail' : 'pass', summary: failed.length ? 'Some Map questions lack the required final character.' : 'Every examined Map question ends with a question mark.', evidence: [{ summary: 'Examined Map questions', data: JSON.stringify(maps.map(map => ({ id: map.id, question: map.question }))), mediaType: 'application/json' }], diagnostics: failed.map(map => ({ path: map.path, message: 'Map question does not end with a question mark.' })) };
} }];\n`);
  return { module, invocationFile, releaseFile };
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for the declared qualification condition.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('streamed progress distinguishes admission, worker execution, completion, and processing failure', async t => {
  const fixture = project(t), verifier = evaluator(fixture, { blocking: true });
  const editor = await fixture.start({ evaluatorModule: verifier.module }), state = await rpc(editor, 'state');
  const events = [], queuedEvents = [];
  function stream(method, params, target) {
    let pending = '';
    return request(editor, `/api/${method}`, { raw: JSON.stringify(params), headers: { Accept: 'application/x-ndjson' },
      onData(chunk) {
        pending += chunk.toString('utf8');
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          target.push(JSON.parse(pending.slice(0, newline))); pending = pending.slice(newline + 1);
        }
      } });
  }
  const evaluation = stream('evaluate', { viewId: state.viewId, actor: { kind: 'tool', id: 'progress-test' }, checkIds: ['question-punctuation'] }, events);
  await until(() => fs.existsSync(verifier.invocationFile) && events.some(event => event.status === 'running'));
  const queued = stream('state', {}, queuedEvents);
  await until(() => queuedEvents.length === 1);
  assert.deepEqual(queuedEvents, [{ status: 'queued' }]);
  assert.equal((await request(editor, '/editor.js', { method: 'GET', raw: '' })).status, 200);
  assert.deepEqual(events, [{ status: 'queued' }, { status: 'running' }]);
  fs.writeFileSync(verifier.releaseFile, 'continue');
  const responses = await Promise.all([evaluation, queued]);
  for (const response of responses) { assert.equal(response.status, 200); assert.match(response.headers['content-type'], /^application\/x-ndjson/); }
  for (const sequence of [events, queuedEvents]) {
    assert.deepEqual(sequence.slice(0, 2), [{ status: 'queued' }, { status: 'running' }]);
    assert.equal(sequence.length, 3); assert.equal(sequence[2].ok, true);
  }
  const failures = [];
  const failure = await stream('read', { viewId: 'expired', kind: 'point', id: 'edge-authentication' }, failures);
  assert.equal(failure.status, 200);
  assert.deepEqual(failures.slice(0, 2), [{ status: 'queued' }, { status: 'running' }]);
  assert.equal(failures.length, 3); assert.equal(failures[2].ok, false);
  assert.match(failures[2].error.code, /^atlas\.editor\./);
  const rejected = await request(editor, '/api/state', { headers: { Accept: 'application/x-ndjson' }, authenticated: false });
  assert.equal(rejected.status, 403); assert.match(rejected.headers['content-type'], /^application\/json/);
});

test('launch binds a local capability and fixed assets expose no source or launch token', async t => {
  const fixture = project(t), editor = await fixture.start();
  assert.ok(Object.isFrozen(editor));
  assert.match(editor.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  const token = new URLSearchParams(new URL(editor.url).hash.slice(1)).get('token');
  assert.match(token, /^[a-f0-9]{64}$/u);
  for (const route of ['/', '/?kind=point&id=edge-authentication', '/?kind=document&path=atlas.md', '/editor.js', '/editor.css']) {
    const response = await request(editor, route, { method: 'GET', authenticated: false, raw: '' });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/u);
    assert.ok(!response.text.includes(token));
    assert.ok(!response.text.includes(fixture.options.repositoryRoot));
  }
  for (const route of ['/atlas.md', '/src/server.mjs', '/../atlas.md', '/editor.js?token=ignored', '/api/state']) {
    assert.equal((await request(editor, route, { method: 'GET', raw: '' })).status, 404, route);
  }
  await editor.close();
  await editor.close();
});

test('Host, Origin, token, JSON, and route validation reject requests without filesystem effects', async t => {
  const fixture = project(t), editor = await fixture.start();
  const before = fs.readFileSync(path.join(fixture.atlasRoot, 'atlas.md'));
  const cases = [
    { headers: { Host: 'example.com' }, code: 'atlas.editor.foreign-host', status: 403 },
    { headers: { Host: `localhost:${new URL(editor.origin).port}` }, code: 'atlas.editor.foreign-host', status: 403 },
    { headers: { Origin: 'https://example.com' }, code: 'atlas.editor.unauthorized', status: 403 },
    { headers: { Origin: 'null' }, code: 'atlas.editor.unauthorized', status: 403 },
    { authenticated: false, code: 'atlas.editor.unauthorized', status: 403 },
    { authenticated: false, headers: { Origin: editor.origin, 'Content-Type': 'application/json' }, code: 'atlas.editor.unauthorized', status: 403 },
    { authenticated: false, headers: { 'X-Atlas-Token': new URLSearchParams(new URL(editor.url).hash.slice(1)).get('token'), 'Content-Type': 'application/json' }, code: 'atlas.editor.unauthorized', status: 403 },
    { headers: { 'X-Atlas-Token': '0'.repeat(64) }, code: 'atlas.editor.unauthorized', status: 403 },
    { headers: { 'X-Atlas-Token': 'short' }, code: 'atlas.editor.unauthorized', status: 403 },
    { headers: { 'Content-Type': 'text/plain' }, code: 'atlas.editor.content-type', status: 415 },
    { raw: '{', code: 'atlas.editor.invalid-json', status: 400 },
    { raw: '{"repositoryRoot":"/"}', code: 'atlas.editor.invalid-request', status: 400 },
    { raw: '[]', code: 'atlas.editor.invalid-request', status: 400 },
  ];
  for (const { code, status, ...options } of cases) {
    const response = await request(editor, '/api/state', options);
    assert.equal(response.status, status, response.text);
    assert.equal(response.body.error.code, code, response.text);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  for (const route of ['/api/shell', '/api/state?root=/', `${editor.origin}/api/state`, '//example.com/api/state']) {
    const response = await request(editor, route);
    assert.ok([403, 404].includes(response.status), response.text);
  }
  assert.equal((await request(editor, '/api/state', { method: 'OPTIONS' })).status, 404);
  const oversized = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal((await request(editor, '/api/state', { headers: { 'Transfer-Encoding': 'chunked' }, raw: oversized })).status, 413);
  assert.equal((await request(editor, '/api/state', { headers: { 'Content-Length': Buffer.byteLength(oversized) }, raw: oversized })).status, 413);
  assert.deepEqual(fs.readFileSync(path.join(fixture.atlasRoot, 'atlas.md')), before);
  assert.equal((await rpc(editor, 'state')).view.status, 'ready');
});

test('public reading, search continuation, refresh, and comparison preserve retained observation identity', async t => {
  const fixture = project(t), editor = await fixture.start();
  const first = await rpc(editor, 'state');
  assert.equal(first.view.status, 'ready');
  const point = await rpc(editor, 'read', { viewId: first.viewId, kind: 'point', id: 'edge-authentication' });
  assert.equal(point.status, 'found');
  assert.equal(point.point.title, 'Authenticate at the edge');
  const resource = await rpc(editor, 'read', { viewId: first.viewId, kind: 'resource', id: 'authentication-guide' });
  assert.equal(resource.status, 'found');
  assert.equal(resource.resource.uri, 'docs/authentication.md');
  const raw = await rpc(editor, 'read', { viewId: first.viewId, kind: 'document', path: anchorPath });
  assert.equal(raw.status, 'read');
  assert.equal(raw.text, fs.readFileSync(path.join(fixture.atlasRoot, anchorPath), 'utf8'));
  const found = await rpc(editor, 'find', { viewId: first.viewId, query: 'edge', options: { types: ['point'], limit: 1 } });
  assert.equal(found.items.length, 1);
  assert.ok(found.nextCursor);
  const next = await rpc(editor, 'find', { viewId: first.viewId, query: 'edge', options: { types: ['point'], limit: 1, cursor: found.nextCursor } });
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0].id, found.items[0].id);
  const fts = await rpc(editor, 'find', { viewId: first.viewId, query: '"edge" AND "keys"', options: { mode: 'fts', types: ['point'] } });
  assert.ok(fts.items.some(item => item.id === 'rotate-edge-keys'));
  assert.ok(fts.items.every(item => item.matches.some(match => match.path && typeof match.excerpt === 'string')));
  const file = path.join(fixture.atlasRoot, anchorPath);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Authenticate at the edge', 'Authenticate at the gateway'));
  assert.equal((await rpc(editor, 'freshness', { viewId: first.viewId })).status, 'stale');
  const refreshed = await rpc(editor, 'refresh');
  assert.notEqual(refreshed.viewId, first.viewId);
  assert.notEqual(refreshed.view.identity.digest, first.view.identity.digest);
  assert.equal((await rpc(editor, 'read', { viewId: first.viewId, kind: 'point', id: 'edge-authentication' })).point.title, 'Authenticate at the edge');
  assert.equal((await rpc(editor, 'read', { viewId: refreshed.viewId, kind: 'point', id: 'edge-authentication' })).point.title, 'Authenticate at the gateway');
  const compared = await rpc(editor, 'compare', { beforeViewId: first.viewId, afterViewId: refreshed.viewId });
  assert.equal(compared.status, 'compared');
  assert.ok(compared.records.some(item => item.key === 'point:edge-authentication'));
});

test('source reads preserve owner bases and refuse outside roots, symlinks, network, and browser root overrides', async t => {
  const fixture = project(t), editor = await fixture.start();
  const state = await rpc(editor, 'state');
  const read = target => rpc(editor, 'read', { viewId: state.viewId, kind: 'source', target });
  const registered = await read({ resource: 'authentication-guide' });
  assert.equal(registered.status, 'read');
  assert.equal(registered.text, fs.readFileSync(path.join(fixture.atlasRoot, 'docs/authentication.md'), 'utf8'));
  const direct = await rpc(editor, 'read', { viewId: state.viewId, kind: 'source', target: { uri: '../../../docs/authentication.md' }, ownerPath: anchorPath });
  assert.equal(direct.text, registered.text);
  fs.writeFileSync(path.join(fixture.options.repositoryRoot, 'context.txt'), 'Selected repository context. [Sibling](sibling.md)');
  const contextual = await read({ uri: '../context.txt' });
  assert.equal(contextual.text, 'Selected repository context. [Sibling](sibling.md)');
  assert.ok(contextual.limits.some(limit => limit.includes('Relative links')));
  assert.doesNotMatch(contextual.html, /kind=source/u);
  fs.writeFileSync(path.join(fixture.directory, 'outside.txt'), 'Outside scope secret.');
  const outside = await read({ uri: '../../outside.txt' });
  assert.equal(outside.status, 'unrequested');
  assert.equal(outside.text, undefined);
  assert.equal((await read({ uri: 'https://example.com/source' })).status, 'unrequested');
  fs.symlinkSync(path.join(fixture.directory, 'outside.txt'), path.join(fixture.atlasRoot, 'docs/link.txt'));
  const linked = await read({ uri: 'docs/link.txt' });
  assert.notEqual(linked.status, 'read');
  assert.equal(linked.text, undefined);
  const override = await request(editor, '/api/read', { raw: JSON.stringify({ viewId: state.viewId, kind: 'source', target: { uri: '../../outside.txt' }, allowedRoots: [fixture.directory] }) });
  assert.equal(override.status, 400);
  assert.equal(override.body.error.code, 'atlas.editor.invalid-request');
  const traversal = await request(editor, '/api/read', { raw: JSON.stringify({ viewId: state.viewId, kind: 'document', path: '../outside.txt' }) });
  assert.equal(traversal.body.ok, false);
});

test('complete invalid drafts retain raw diagnostics without a normalized model', async t => {
  const fixture = project(t), editor = await fixture.start();
  await rpc(editor, 'state');
  fs.writeFileSync(path.join(fixture.atlasRoot, anchorPath), 'Unfinished authored source.\n');
  const current = await rpc(editor, 'refresh');
  assert.equal(current.view.status, 'invalid');
  assert.equal(current.view.validation.normalized, undefined);
  const raw = await rpc(editor, 'read', { viewId: current.viewId, kind: 'document', path: anchorPath });
  assert.equal(raw.status, 'read');
  assert.equal(raw.text, 'Unfinished authored source.\n');
  assert.ok(raw.diagnostics.length > 0);
  assert.equal((await rpc(editor, 'find', { viewId: current.viewId, query: 'edge' })).status, 'invalid');
});

test('Check discovery keeps readable repair policy while invalid observations prevent verification', async t => {
  const fixture = project(t), verifier = evaluator(fixture);
  const editor = await fixture.start({ evaluatorModule: verifier.module });
  fs.writeFileSync(path.join(fixture.atlasRoot, 'maps/operations/map.md'), 'An unfinished Map.\n');
  const current = await rpc(editor, 'refresh');
  const discovery = await rpc(editor, 'checks', { viewId: current.viewId });
  assert.equal(discovery.status, 'invalid');
  assert.equal(discovery.complete, true);
  const check = discovery.items.find(item => item.id === 'question-punctuation');
  assert.equal(check.title, 'End Map questions with a question mark');
  assert.equal(check.level, 'required');
  assert.deepEqual(check.appliesTo, ['map']);
  assert.equal(check.subjects, null);
  assert.equal(check.applicability.status, 'unresolved');
  assert.ok(check.applicability.reasons.length > 0);
  const source = await rpc(editor, 'read', { viewId: current.viewId, kind: 'document', path: check.path });
  assert.equal(source.status, 'read');
  assert.match(source.text, /## Verification/u);
  const evaluated = await rpc(editor, 'evaluate', { viewId: current.viewId, actor: { kind: 'tool', id: 'repair-test' } });
  assert.deepEqual(evaluated.run.evaluations, []);
  assert.equal(evaluated.run.requiredSatisfied, false);
  assert.equal(evaluated.run.wholeAtlasCompliant, false);
  assert.equal(fs.existsSync(verifier.invocationFile), false);
});

test('one current draft survives refresh and restart while stale saves and discard stay explicit', async t => {
  const fixture = project(t);
  let editor = await fixture.start();
  const state = await rpc(editor, 'state');
  const original = fs.readFileSync(path.join(fixture.atlasRoot, anchorPath), 'utf8');
  const saved = await rpc(editor, 'draft-save', { path: anchorPath, baseViewDigest: state.view.identity.digest, text: `${original}\nUnapplied draft.\n` });
  assert.equal(saved.sequence, 1);
  assert.match(saved.draftId, /^[a-f0-9-]{36}$/u);
  assert.match(saved.revision, /^[a-f0-9]{64}$/u);
  const updated = await rpc(editor, 'draft-save', { draftId: saved.draftId, expectedRevision: saved.revision, path: anchorPath, baseViewDigest: saved.baseViewDigest, text: `${saved.text}Second revision.\n` });
  assert.equal(updated.sequence, 2);
  assert.deepEqual(fs.readdirSync(path.join(fixture.options.stateDirectory, 'drafts')), [`${saved.draftId}.json`]);
  const stale = await request(editor, '/api/draft-save', { raw: JSON.stringify({ draftId: saved.draftId, expectedRevision: saved.revision, path: anchorPath, baseViewDigest: saved.baseViewDigest, text: 'A racing replacement.' }) });
  assert.equal(stale.body.error.code, 'atlas.editor.stale-draft');
  fs.appendFileSync(path.join(fixture.atlasRoot, anchorPath), '\nExternal source edit.\n');
  await rpc(editor, 'refresh');
  assert.equal((await rpc(editor, 'draft-list')).drafts[0].text, updated.text);
  const previousToken = new URLSearchParams(new URL(editor.url).hash.slice(1)).get('token');
  await editor.close();
  editor = await fixture.start();
  assert.notEqual(new URLSearchParams(new URL(editor.url).hash.slice(1)).get('token'), previousToken);
  assert.equal((await request(editor, '/api/draft-list', { headers: { 'X-Atlas-Token': previousToken } })).status, 403);
  const recovered = await rpc(editor, 'draft-list');
  assert.equal(recovered.issues.length, 0);
  assert.equal(recovered.drafts.length, 1);
  assert.equal(recovered.drafts[0].text, updated.text);
  assert.equal(recovered.drafts[0].baseViewDigest, saved.baseViewDigest);
  assert.equal(recovered.drafts[0].revision, updated.revision);
  const discarded = await rpc(editor, 'draft-discard', { draftId: saved.draftId, expectedRevision: updated.revision });
  assert.deepEqual(discarded, { discarded: true, draftId: saved.draftId });
  assert.deepEqual((await rpc(editor, 'draft-list')).drafts, []);
  assert.deepEqual(fs.readdirSync(path.join(fixture.options.stateDirectory, 'drafts')), []);
  assert.equal(fs.readFileSync(path.join(fixture.atlasRoot, anchorPath), 'utf8'), `${original}\nExternal source edit.\n`);
});

test('unknown draft ids, traversal, and storage failures cannot claim saved drafts', async t => {
  const fixture = project(t), editor = await fixture.start();
  const state = await rpc(editor, 'state');
  for (const params of [
    { path: '../outside.txt', baseViewDigest: state.view.identity.digest, text: 'escape' },
    { path: anchorPath, baseViewDigest: 'forged', text: 'text' },
    { path: anchorPath, baseViewDigest: state.view.identity.digest, text: 'x'.repeat(1024 * 1024 + 1) },
    { draftId: '00000000-0000-0000-0000-000000000000', expectedRevision: 'none', path: anchorPath, baseViewDigest: state.view.identity.digest, text: 'text' },
  ]) {
    const response = await request(editor, '/api/draft-save', { raw: JSON.stringify(params) });
    assert.equal(response.body.ok, false, response.text);
  }
  assert.deepEqual((await rpc(editor, 'draft-list')).drafts, []);
  const drafts = path.join(fixture.options.stateDirectory, 'drafts');
  fs.renameSync(drafts, `${drafts}-original`);
  const outside = path.join(fixture.directory, 'outside-state');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, drafts);
  const failed = await request(editor, '/api/draft-save', { raw: JSON.stringify({ path: anchorPath, baseViewDigest: state.view.identity.digest, text: 'Do not follow storage symlinks.' }) });
  assert.equal(failed.body.ok, false);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('launch refuses state inside source, unknown ownership, and symlinked state paths', async t => {
  const fixture = project(t);
  await assert.rejects(() => fixture.start({ stateDirectory: path.join(fixture.atlasRoot, 'editor-state') }));
  for (const directory of ['tmp', '.git']) {
    const stateDirectory = path.join(fixture.options.repositoryRoot, directory, 'editor-state');
    await assert.rejects(() => fixture.start({ stateDirectory }));
    assert.equal(fs.existsSync(stateDirectory), false);
  }
  assert.equal(fs.existsSync(path.join(fixture.atlasRoot, 'editor-state')), false);
  const unknown = path.join(fixture.directory, 'unknown');
  fs.mkdirSync(unknown);
  fs.writeFileSync(path.join(unknown, 'keep.txt'), 'Preserve existing content.');
  await assert.rejects(() => fixture.start({ stateDirectory: unknown }));
  assert.deepEqual(fs.readdirSync(unknown), ['keep.txt']);
  const actual = path.join(fixture.directory, 'actual');
  fs.mkdirSync(actual);
  const alias = path.join(fixture.directory, 'alias');
  fs.symlinkSync(actual, alias);
  await assert.rejects(() => fixture.start({ stateDirectory: alias }));
  assert.deepEqual(fs.readdirSync(actual), []);
});

test('startup refuses state creation at recognized missing source targets even for complete invalid drafts', async t => {
  for (const invalid of [false, true]) await t.test(invalid ? 'invalid source' : 'valid source', async t => {
    const fixture = project(t), stateDirectory = path.join(fixture.options.repositoryRoot, 'state');
    const atlasFile = path.join(fixture.atlasRoot, 'catalog.json');
    fs.writeFileSync(atlasFile, fs.readFileSync(atlasFile, 'utf8').replace('docs/authentication.md', '../state/workspace.json'));
    if (invalid) fs.writeFileSync(path.join(fixture.atlasRoot, anchorPath), 'An unfinished Point.\n');
    await assert.rejects(fixture.start({ stateDirectory }), { code: 'atlas.editor.state-source-conflict' });
    assert.equal(fs.existsSync(stateDirectory), false, 'No directory or ownership marker may satisfy the missing source target.');
  });
});

test('new source references refuse draft, discard, apply, and retention writes without changing durable state', async t => {
  const fixture = project(t), stateDirectory = path.join(fixture.options.repositoryRoot, 'state');
  const editor = await fixture.start({ stateDirectory }), initial = await rpc(editor, 'state');
  const saved = await rpc(editor, 'draft-save', { path: anchorPath, baseViewDigest: initial.view.identity.digest, text: 'Recoverable draft text.' });
  const proposal = await rpc(editor, 'prepare', { baseViewId: initial.viewId, operations: [{ type: 'map', action: 'update', id: 'architecture', body: mapBody(fixture, 'A reviewed changed summary.') }] });
  const run = await rpc(editor, 'evaluate', { viewId: initial.viewId, actor: { kind: 'tool', id: 'state-source-test' } });
  const inventory = () => fs.readdirSync(stateDirectory, { recursive: true }).sort().filter(file => fs.statSync(path.join(stateDirectory, file)).isFile())
    .map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(stateDirectory, file))).digest('hex')]);
  const before = inventory(), atlasFile = path.join(fixture.atlasRoot, 'catalog.json'), original = fs.readFileSync(atlasFile, 'utf8');
  fs.writeFileSync(atlasFile, original.replace('docs/authentication.md', '../state/drafts/future.json'));
  fs.writeFileSync(path.join(fixture.atlasRoot, anchorPath), 'Complete invalid source still carries recognized Atlas targets.\n');
  for (const [method, params] of [
    ['draft-save', { path: anchorPath, baseViewDigest: saved.baseViewDigest, text: 'New text.' }],
    ['draft-discard', { draftId: saved.draftId, expectedRevision: saved.revision }],
    ['apply', { planId: proposal.planId, mode: 'validated' }], ['retain', { runId: run.runId }],
  ]) {
    const response = await request(editor, `/api/${method}`, { raw: JSON.stringify(params) });
    assert.equal(response.body.error.code, 'atlas.editor.state-source-conflict', method);
    assert.deepEqual(inventory(), before, `${method} changed durable state`);
  }
  assert.equal((await rpc(editor, 'draft-list')).drafts[0].text, saved.text, 'Read-only recovery remains available.');
  fs.writeFileSync(atlasFile, original);
  const invalid = await rpc(editor, 'refresh'); assert.equal(invalid.view.status, 'invalid');
  const repair = await rpc(editor, 'draft-save', { path: anchorPath, baseViewDigest: invalid.view.identity.digest, text: 'A separately stored repair.' });
  assert.equal(repair.text, 'A separately stored repair.', 'Complete invalid observations can still store repair drafts in safe scope.');
});

test('saved drafts survive stop and restart with an unreadable Point without mutating state', async t => {
  const fixture = project(t), editor = await fixture.start(), initial = await rpc(editor, 'state');
  const text = `${fs.readFileSync(path.join(fixture.atlasRoot, anchorPath), 'utf8')}\nUnapplied draft: π and 🧭.\n`;
  const saved = await rpc(editor, 'draft-save', { path: anchorPath, baseViewDigest: initial.view.identity.digest, text });
  await editor.close();
  const before = stateInventory(fixture.options.stateDirectory);
  const result = await unreadableSourceProcess(fixture, `
    const editor = await start(), state = await request(editor, 'state'), drafts = await request(editor, 'draft-list');
    assert.equal(state.ok, true); assert.equal(state.result.view.status, 'incomplete');
    assert.equal(state.result.stateStorage.writable, false);
    assert.equal(editor.info.stateStorage.writable, false);
    assert.ok(state.result.view.validation.diagnostics.length > 0);
    assert.equal(drafts.ok, true);
    for (const [method, params] of ${JSON.stringify([
      ['draft-save', { draftId: saved.draftId, expectedRevision: saved.revision, path: anchorPath, baseViewDigest: saved.baseViewDigest, text: 'Do not store.' }],
      ['draft-discard', { draftId: saved.draftId, expectedRevision: saved.revision }],
      ['apply', { planId: 'expired', mode: 'validated' }], ['retain', { runId: 'expired' }],
    ])}) {
      const response = await request(editor, method, params);
      assert.equal(response.ok, false, method);
      assert.equal(response.error.code, 'atlas.editor.state-source-unavailable', method);
    }
    return { state: state.result, drafts: drafts.result };
  `);
  assert.deepEqual(result.drafts, { drafts: [saved], issues: [] });
  assert.equal(result.state.stateStorage.diagnostics[0].code, 'atlas.editor.state-source-unavailable');
  assert.deepEqual(stateInventory(fixture.options.stateDirectory), before, 'Inspection creates no state files, directories, or revisions.');
  const reopened = await fixture.start(), current = await rpc(reopened, 'state');
  assert.equal(current.stateStorage.writable, true);
  const next = await rpc(reopened, 'draft-save', { draftId: saved.draftId, expectedRevision: saved.revision, path: saved.path, baseViewDigest: saved.baseViewDigest, text: `${saved.text}Source restored.\n` });
  assert.equal(next.sequence, 2);
});

test('incomplete startup refuses absent, unowned, unsafe, and conflicting state without creating storage', async t => {
  const fixture = project(t), editor = await fixture.start();
  await editor.close();
  const stateDirectory = fixture.options.stateDirectory, absent = path.join(fixture.directory, 'absent'), empty = path.join(fixture.directory, 'empty');
  fs.mkdirSync(empty);
  const foreign = path.join(fixture.directory, 'foreign');
  fs.cpSync(stateDirectory, foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'workspace.json'), JSON.stringify({ contract: 'atlas.editor-state/1', repositoryRoot: fixture.options.repositoryRoot, atlasPath: 'another-atlas' }));
  const unsafe = path.join(fixture.directory, 'unsafe');
  fs.cpSync(stateDirectory, unsafe, { recursive: true });
  fs.rmdirSync(path.join(unsafe, 'drafts'));
  fs.symlinkSync(path.join(stateDirectory, 'drafts'), path.join(unsafe, 'drafts'), 'dir');
  const result = await unreadableSourceProcess(fixture, `
    const failures = [];
    for (const stateDirectory of ${JSON.stringify([absent, empty, foreign, unsafe])}) {
      await assert.rejects(() => start({ stateDirectory }), error => { failures.push(error.code); return true; });
    }
    return failures;
  `);
  assert.equal(result[0], 'atlas.editor.state-source-unavailable');
  assert.equal(result[1], 'atlas.editor.state-source-unavailable');
  assert.equal(fs.existsSync(absent), false);
  assert.deepEqual(fs.readdirSync(empty), []);
  const catalogFile = path.join(fixture.atlasRoot, 'catalog.json');
  const relativeState = path.relative(fixture.atlasRoot, path.join(stateDirectory, 'drafts/future.json')).split(path.sep).join('/');
  fs.writeFileSync(catalogFile, fs.readFileSync(catalogFile, 'utf8').replace('docs/authentication.md', relativeState));
  const before = stateInventory(stateDirectory);
  await unreadableSourceProcess(fixture, `await assert.rejects(() => start(), { code: 'atlas.editor.state-source-conflict' }); return true;`);
  assert.deepEqual(stateInventory(stateDirectory), before);
});

test('permission-denied source permits saved draft recovery after restart and still refuses state writes', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const fixture = project(t);
  let editor = await fixture.start();
  const initial = await rpc(editor, 'state');
  const saved = await rpc(editor, 'draft-save', { path: anchorPath, baseViewDigest: initial.view.identity.digest, text: 'Draft saved before source became unreadable.' });
  await editor.close();
  const before = stateInventory(fixture.options.stateDirectory);
  const file = path.join(fixture.atlasRoot, anchorPath), mode = fs.statSync(file).mode;
  fs.chmodSync(file, 0);
  try {
    editor = await fixture.start();
    const state = await rpc(editor, 'state');
    assert.equal(state.view.status, 'incomplete');
    assert.equal(state.stateStorage.writable, false);
    assert.ok(state.view.validation.diagnostics.length > 0);
    assert.deepEqual((await rpc(editor, 'draft-list')).drafts, [saved]);
    const response = await request(editor, '/api/draft-save', { raw: JSON.stringify({ path: anchorPath, baseViewDigest: initial.view.identity.digest, text: 'Unacknowledged text.' }) });
    assert.equal(response.body.error.code, 'atlas.editor.state-source-unavailable');
    assert.deepEqual(stateInventory(fixture.options.stateDirectory), before);
    const stateDirectory = path.join(fixture.directory, 'new-state');
    await assert.rejects(fixture.start({ stateDirectory }), { code: 'atlas.editor.state-source-unavailable' });
    assert.equal(fs.existsSync(stateDirectory), false);
  } finally { fs.chmodSync(file, mode); }
  assert.equal((await rpc(editor, 'refresh')).stateStorage.writable, true);
  assert.equal((await rpc(editor, 'draft-save', { draftId: saved.draftId, expectedRevision: saved.revision, path: saved.path, baseViewDigest: saved.baseViewDigest, text: `${saved.text}\nContinued after refresh.` })).sequence, 2);
});

test('prepared file changes remain inspectable without writes and only their retained plan id can be applied', async t => {
  const fixture = project(t), editor = await fixture.start();
  const state = await rpc(editor, 'state');
  const file = path.join(fixture.atlasRoot, anchorPath), original = fs.readFileSync(file, 'utf8');
  const prepared = await rpc(editor, 'prepare', { baseViewId: state.viewId, operations: [
    { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: original.split('---').slice(2).join('---').replace(/^# .+$/mu, '# Authenticate at the gateway') },
  ] });
  assert.equal(prepared.plan.contract, 'atlas.change-plan/2');
  assert.equal(prepared.plan.status, 'ready');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.ok(JSON.stringify(prepared.plan).includes('Authenticate at the gateway'));
  assert.deepEqual(fs.readdirSync(path.join(fixture.options.stateDirectory, 'recovery')), []);
  const forged = await request(editor, '/api/apply', { raw: JSON.stringify({ planId: prepared.planId, plan: prepared.plan }) });
  assert.equal(forged.body.error.code, 'atlas.editor.invalid-request');
  const unknown = await request(editor, '/api/apply', { raw: JSON.stringify({ planId: 'forged-plan', mode: 'validated' }) });
  assert.equal(unknown.body.error.code, 'atlas.editor.expired');
  const applied = await rpc(editor, 'apply', { planId: prepared.planId, mode: 'validated' });
  assert.equal(applied.result.status, 'applied');
  assert.deepEqual(applied.result.written, [anchorPath]);
  assert.equal(applied.state.view.status, 'ready');
  assert.match(fs.readFileSync(file, 'utf8'), /Authenticate at the gateway/u);
  assert.deepEqual(applied.result.recovery, { status: 'removed' });
  assert.equal(applied.result.recoveryDirectory, undefined);
  assert.deepEqual(fs.readdirSync(path.join(fixture.options.stateDirectory, 'recovery')), []);
  const repeated = await request(editor, '/api/apply', { raw: JSON.stringify({ planId: prepared.planId }) });
  assert.equal(repeated.body.error.code, 'atlas.editor.expired');
});

test('stale application preserves external source and durable edited text', async t => {
  const fixture = project(t), editor = await fixture.start();
  const state = await rpc(editor, 'state');
  const file = path.join(fixture.atlasRoot, anchorPath), original = fs.readFileSync(file, 'utf8');
  const text = original.replace('Authenticate at the edge', 'Authenticate at the gateway');
  const draft = await rpc(editor, 'draft-save', { path: anchorPath, baseViewDigest: state.view.identity.digest, text });
  const prepared = await rpc(editor, 'prepare', { baseViewId: state.viewId, operations: [{ type: 'repair-document', path: anchorPath, text }] });
  fs.writeFileSync(file, `${original}\nAn external contribution.\n`);
  const applied = await rpc(editor, 'apply', { planId: prepared.planId, mode: 'validated' });
  assert.equal(applied.result.status, 'stale');
  assert.deepEqual(applied.result.written, []);
  assert.equal(fs.readFileSync(file, 'utf8'), `${original}\nAn external contribution.\n`);
  assert.deepEqual(fs.readdirSync(path.join(fixture.options.stateDirectory, 'recovery')), []);
  assert.equal((await rpc(editor, 'draft-list')).drafts.find(item => item.draftId === draft.draftId).text, text);
});

test('invalid raw repair needs explicit draft mode and reports invalid source after saving', async t => {
  const fixture = project(t), editor = await fixture.start();
  const state = await rpc(editor, 'state');
  const file = path.join(fixture.atlasRoot, anchorPath), original = fs.readFileSync(file, 'utf8');
  const prepared = await rpc(editor, 'prepare', { baseViewId: state.viewId, operations: [{ type: 'repair-document', path: anchorPath, text: 'An unfinished raw draft.\n' }] });
  assert.equal(prepared.plan.status, 'invalid');
  const refused = await request(editor, '/api/apply', { raw: JSON.stringify({ planId: prepared.planId, mode: 'validated' }) });
  assert.equal(refused.body.ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  const saved = await rpc(editor, 'apply', { planId: prepared.planId, mode: 'draft' });
  assert.equal(saved.result.status, 'applied');
  assert.equal(saved.state.view.status, 'invalid');
  assert.equal(saved.state.view.validation.normalized, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), 'An unfinished raw draft.\n');
});

test('explicit host evaluators preserve real pass, fail, unable, partial coverage, and retained historical evidence', async t => {
  const fixture = project(t), verifier = evaluator(fixture);
  let editor = await fixture.start({ evaluatorModule: verifier.module });
  let state = await rpc(editor, 'state');
  await rpc(editor, 'read', { viewId: state.viewId, kind: 'point', id: 'edge-authentication' });
  await rpc(editor, 'find', { viewId: state.viewId, query: 'edge' });
  const discovered = await rpc(editor, 'checks', { viewId: state.viewId });
  assert.equal(discovered.items.find(item => item.id === 'question-punctuation').evaluator.id, 'literal-question-punctuation');
  assert.equal(discovered.items.find(item => item.id === 'boundary').evaluator, null);
  assert.equal(fs.existsSync(verifier.invocationFile), false, 'Reading and discovery must not execute the evaluator.');
  const actor = { kind: 'tool', id: 'atlas-editor-service-test' };
  const first = await rpc(editor, 'evaluate', { viewId: state.viewId, actor });
  assert.equal(first.run.evaluations.find(item => item.check === 'question-punctuation').outcome, 'pass');
  assert.equal(first.run.evaluations.find(item => item.check === 'boundary').outcome, 'unable');
  assert.equal(first.run.wholeAtlasCompliant, false);
  assert.deepEqual(first.run.actor, actor);
  const partial = await rpc(editor, 'evaluate', { viewId: state.viewId, actor, checkIds: ['question-punctuation'] });
  assert.equal(partial.run.evaluations[0].outcome, 'pass');
  assert.equal(partial.run.requiredSatisfied, false, 'An omitted applicable required Check is not satisfied.');
  assert.ok(partial.run.coverage.omittedChecks.some(item => item.id === 'boundary'));
  assert.equal(partial.run.coverage.wholeAtlas, false);
  assert.equal(partial.run.wholeAtlasCompliant, false);
  const retained = await rpc(editor, 'retain', { runId: first.runId });
  assert.ok((await rpc(editor, 'report-list')).reportIds.includes(retained.reportId));
  const report = await rpc(editor, 'report-read', { reportId: retained.reportId });
  assert.equal(report.status, 'read');
  assert.equal(report.integrity, 'verified');
  assert.equal(report.authenticity, 'not-authenticated');
  assert.equal(report.freshness.status, 'fresh');
  const mapFile = path.join(fixture.atlasRoot, 'maps/architecture/map.md');
  const beforeMap = fs.readFileSync(mapFile, 'utf8');
  assert.match(beforeMap, /## Question\n\n[^\n]+\?/u);
  fs.writeFileSync(mapFile, beforeMap.replace(/(## Question\n\n[^\n]+)\?/u, '$1.'));
  state = await rpc(editor, 'refresh');
  assert.equal(state.view.status, 'ready');
  const failed = await rpc(editor, 'evaluate', { viewId: state.viewId, actor, checkIds: ['question-punctuation'] });
  assert.equal(failed.run.evaluations[0].outcome, 'fail');
  assert.equal(failed.run.requiredSatisfied, false);
  await editor.close();
  editor = await fixture.start({ evaluatorModule: verifier.module });
  await rpc(editor, 'state');
  const historical = await rpc(editor, 'report-read', { reportId: retained.reportId });
  assert.equal(historical.integrity, 'verified');
  assert.equal(historical.freshness.status, 'historical');
  assert.deepEqual(historical.report, report.report);
  assert.deepEqual(historical.evidence, report.evidence);
  const redirected = await request(editor, '/api/retain', { raw: JSON.stringify({ runId: first.runId, directory: fixture.atlasRoot }) });
  assert.equal(redirected.body.error.code, 'atlas.editor.invalid-request');
});

test('prepared Check evaluation binds its plan without applying proposed source', async t => {
  const fixture = project(t), verifier = evaluator(fixture), editor = await fixture.start({ evaluatorModule: verifier.module });
  const state = await rpc(editor, 'state');
  const file = path.join(fixture.atlasRoot, 'maps/architecture/map.md'), original = fs.readFileSync(file, 'utf8');
  const prepared = await rpc(editor, 'prepare', { baseViewId: state.viewId, operations: [{ type: 'map', action: 'update', id: 'architecture', body: original.split('---').slice(2).join('---').replace(/(## Question\n\n)[^\n]+/u, '$1This proposed routing text lacks question punctuation.') }] });
  assert.equal(prepared.plan.status, 'ready');
  assert.equal(fs.existsSync(verifier.invocationFile), false);
  const evaluated = await rpc(editor, 'evaluate', { planId: prepared.planId, actor: { kind: 'tool', id: 'editor-proposal-test' }, checkIds: ['question-punctuation'] });
  assert.equal(evaluated.planDigest, prepared.plan.digest);
  assert.equal(evaluated.run.evaluations[0].outcome, 'fail');
  assert.equal(evaluated.run.wholeAtlasCompliant, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(path.join(fixture.options.stateDirectory, 'recovery')), []);
});

test('bounded queued work rejects excess requests while the HTTP service remains available', async t => {
  const fixture = project(t), verifier = evaluator(fixture, { blocking: true });
  const editor = await fixture.start({ evaluatorModule: verifier.module });
  const state = await rpc(editor, 'state');
  const evaluating = request(editor, '/api/evaluate', { raw: JSON.stringify({ viewId: state.viewId, actor: { kind: 'tool', id: 'queue-test' }, checkIds: ['question-punctuation'] }) });
  await until(() => fs.existsSync(verifier.invocationFile));
  const queued = Array.from({ length: 35 }, () => request(editor, '/api/state'));
  let timer;
  try {
    const busy = await Promise.race([
      ...queued.map(promise => promise.then(response => response.status === 503 ? response : new Promise(() => {}))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No bounded queue rejection arrived.')), 5000); }),
    ]);
    assert.equal(busy.body.error.code, 'atlas.editor.busy');
    assert.equal((await request(editor, '/editor.css', { method: 'GET', authenticated: false, raw: '' })).status, 200);
  } finally {
    clearTimeout(timer);
    fs.writeFileSync(verifier.releaseFile, 'Continue the declared evaluator.');
  }
  const results = await Promise.all(queued);
  assert.ok(results.some(result => result.status === 503));
  assert.ok(results.some(result => result.status === 200));
  const completed = await evaluating;
  assert.equal(completed.status, 200, completed.text);
  assert.equal(completed.body.result.run.evaluations[0].outcome, 'pass');
});

test('the launch-selected Atlas remains fixed when durable workspace selection changes', async t => {
  const fixture = project(t);
  fs.cpSync(fixture.atlasRoot, path.join(fixture.options.repositoryRoot, 'other'), { recursive: true });
  const configuration = path.join(fixture.options.repositoryRoot, 'atlas.workspace.json');
  fs.writeFileSync(configuration, JSON.stringify({ format: 1, atlasPath: 'atlas' }));
  const editor = await fixture.start({ atlasPath: undefined });
  const initial = await rpc(editor, 'state');
  assert.equal(initial.workspace.atlasPath, 'atlas');
  fs.writeFileSync(configuration, JSON.stringify({ format: 1, atlasPath: 'other' }));
  const refreshed = await rpc(editor, 'state');
  assert.equal(refreshed.workspace.atlasPath, 'atlas');
  assert.equal(refreshed.view.atlasRoot, fixture.atlasRoot);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.options.stateDirectory, 'workspace.json'), 'utf8')).atlasPath, 'atlas');
});

test('captured document truncation and expired reading observations remain explicit', async t => {
  const fixture = project(t), editor = await fixture.start();
  fs.writeFileSync(path.join(fixture.atlasRoot, 'docs/large.md'), 'x'.repeat(1024 * 1024 + 1));
  const first = await rpc(editor, 'state');
  const raw = await rpc(editor, 'read', { viewId: first.viewId, kind: 'document', path: 'docs/large.md' });
  assert.equal(raw.status, 'truncated');
  assert.equal(raw.input.byteLength, 1024 * 1024 + 1);
  assert.equal(Buffer.from(raw.bytesBase64, 'base64').length, 1024 * 1024);
  let latest;
  for (let index = 0; index < 8; index++) {
    fs.writeFileSync(path.join(fixture.atlasRoot, 'docs/changed.md'), `Observation ${index}.\n`);
    latest = await rpc(editor, 'refresh');
  }
  assert.equal(latest.observations.length, 8);
  assert.ok(!latest.observations.some(item => item.viewId === first.viewId));
  const expired = await request(editor, '/api/read', { raw: JSON.stringify({ viewId: first.viewId, kind: 'document', path: 'atlas.md' }) });
  assert.equal(expired.body.error.code, 'atlas.editor.expired');
  assert.equal((await rpc(editor, 'read', { viewId: latest.viewId, kind: 'document', path: 'atlas.md' })).status, 'read');
});

test('unfinished structured contributions recover before Atlas initialization without becoming authored files', async t => {
  const fixture = project(t);
  let editor = await fixture.start({ atlasPath: 'new-atlas' });
  assert.equal((await rpc(editor, 'state')).canInitialize, true);
  const text = JSON.stringify({ type: 'initialize', fields: { id: 'unfinished' }, body: '# An unfinished contribution' });
  const saved = await rpc(editor, 'draft-save', { kind: 'contribution', path: 'contribution/initialize', baseViewDigest: null, text });
  assert.equal(saved.kind, 'contribution');
  assert.equal(saved.baseViewDigest, null);
  assert.equal(fs.existsSync(path.join(fixture.options.repositoryRoot, 'new-atlas')), false);
  await editor.close();
  editor = await fixture.start({ atlasPath: 'new-atlas' });
  const recovered = (await rpc(editor, 'draft-list')).drafts[0];
  assert.equal(recovered.text, text);
  assert.equal(recovered.kind, 'contribution');
  assert.equal(recovered.baseViewDigest, null);
  const document = await request(editor, '/api/draft-save', { raw: JSON.stringify({ kind: 'document', path: 'atlas.md', baseViewDigest: null, text: 'Not an initialized document.' }) });
  assert.equal(document.body.ok, false);
  const retargeted = await request(editor, '/api/draft-save', { raw: JSON.stringify({ draftId: saved.draftId, expectedRevision: saved.revision, kind: 'document', path: saved.path, baseViewDigest: '0'.repeat(64), text: 'Do not change draft identity.' }) });
  assert.equal(retargeted.body.error.code, 'atlas.editor.stale-draft');
  assert.equal((await rpc(editor, 'draft-list')).drafts[0].text, text);
  assert.equal(fs.existsSync(path.join(fixture.options.repositoryRoot, 'new-atlas')), false);
});

test('Export site and agent connection retain authenticated host-selected boundaries', async t => {
  const fixture = project(t);
  fs.rmSync(fixture.atlasRoot, { recursive: true });
  fs.cpSync(path.join(root, 'spec/examples/valid/publication-profile'), fixture.atlasRoot, { recursive: true });
  const outputDirectory = path.join(fixture.directory, 'Site with spaces');
  const agentConfiguration = { mcpServers: { atlas: { command: '/opt/Atlas/bin/atlas', args: ['mcp', '--repository-root', fixture.options.repositoryRoot, '--atlas', 'atlas'] } } };
  const editor = await fixture.start({ exportDirectory: outputDirectory, agentConfiguration });
  const before = stateInventory(fixture.atlasRoot);
  assert.equal((await request(editor, '/api/export-options', { authenticated: false })).status, 403);
  const options = await rpc(editor, 'export-options');
  assert.equal(options.outputDirectory, outputDirectory);
  assert.deepEqual((await rpc(editor, 'agent-config')).configuration, agentConfiguration);
  for (const method of ['export-options', 'export-prepare', 'export-apply', 'export-preview', 'agent-config']) {
    assert.equal((await request(editor, `/api/${method}`, { raw: JSON.stringify({ repositoryRoot: '/', outputDirectory: '/tmp/escape', command: 'sh' }) })).status, 400);
  }
  const preview = await rpc(editor, 'export-prepare', { profileId: 'public' });
  assert.equal(fs.existsSync(outputDirectory), false);
  assert.deepEqual(preview.profile.selection.resources, ['overview']);
  assert.deepEqual(stateInventory(fixture.atlasRoot), before);
  assert.equal((await request(editor, '/api/export-preview', { raw: JSON.stringify({ exportId: preview.exportId }) })).status, 400);
  fs.appendFileSync(path.join(fixture.atlasRoot, 'atlas.md'), '\nChanged after preview.\n');
  const applied = await request(editor, '/api/export-apply', { raw: JSON.stringify({ exportId: preview.exportId }) });
  assert.equal(applied.status, 400); assert.match(applied.text, /changed after preview/u);
  assert.equal(fs.existsSync(outputDirectory), false);
});

test('explicit container binding requires an exact host-selected public origin', async t => {
  const fixture = project(t);
  await assert.rejects(fixture.start({ bindAddress: '0.0.0.0' }), /requires an explicit publicOrigin/u);
  for (const publicOrigin of ['*', 'http://example.test/path', 'http://example.test/', 'http://user@example.test', 'https://example.test?query']) {
    await assert.rejects(fixture.start({ bindAddress: '0.0.0.0', publicOrigin }), /publicOrigin/u);
  }
  const net = await import('node:net');
  const reserved = net.createServer(); await new Promise(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const port = reserved.address().port; await new Promise(resolve => reserved.close(resolve));
  const publicOrigin = 'https://atlas.example.test';
  const editor = await fixture.start({ bindAddress: '0.0.0.0', port, publicOrigin });
  assert.equal(editor.origin, publicOrigin);
  const token = new URL(editor.url).hash.slice(7);
  async function forwarded(headers) {
    return new Promise((resolve, reject) => {
      const call = http.request({ hostname: '127.0.0.1', port, path: '/api/state', method: 'POST', headers: { Host: 'atlas.example.test', Origin: publicOrigin, 'X-Atlas-Token': token, 'Content-Type': 'application/json', ...headers } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, text }));
      }); call.on('error', reject); call.end('{}');
    });
  }
  assert.equal((await forwarded({})).status, 200);
  assert.equal((await forwarded({ Host: `127.0.0.1:${port}` })).status, 403);
  assert.equal((await forwarded({ Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await forwarded({ 'X-Atlas-Token': '' })).status, 403);
  assert.equal((await forwarded({ Host: 'foreign.test', 'X-Forwarded-Host': 'atlas.example.test' })).status, 403);
});

test('direct Editor launch refuses export destinations intersecting durable state before creating state', async t => {
  const fixture = project(t);
  for (const exportDirectory of [fixture.options.stateDirectory, path.join(fixture.options.stateDirectory, 'site'), fixture.directory]) {
    await assert.rejects(fixture.start({ exportDirectory }), /Export output and durable Editor state must use separate/u);
    assert.equal(fs.existsSync(fixture.options.stateDirectory), false);
  }
  const alias = path.join(fixture.directory, 'alias'); fs.symlinkSync(fixture.directory, alias);
  await assert.rejects(fixture.start({ exportDirectory: path.join(alias, 'state', 'site') }), /Export output and durable Editor state must use separate/u);
  assert.equal(fs.existsSync(fixture.options.stateDirectory), false);
});
