import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';

const server = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const markdown = (id, body) => `---\n${JSON.stringify({ id })}\n---\n# ${id}\n\n${body}\n`;
async function fixture(t) {
  const parent = await tempDirectory('atlas-agent-');
  const root = path.join(parent, 'atlas');
  await mkdir(path.join(root, 'trees/service/points'), { recursive: true });
  await writeFile(path.join(root, 'atlas.json'), JSON.stringify({ format: 'atlas/1', id: 'example', title: 'Example', trees: ['trees/service'] }));
  await writeFile(path.join(root, 'trees/service/tree.json'), JSON.stringify({ id: 'service', title: 'Service', scope: 'Offline notes.', base: 'base', children: [{ point: 'note' }] }));
  await writeFile(path.join(root, 'trees/service/points/base.md'), markdown('base', 'Notes remain usable offline.'));
  await writeFile(path.join(root, 'trees/service/points/note.md'), markdown('note', 'Original note.'));
  await writeFile(path.join(root, 'source.txt'), 'Local evidence.');
  await writeFile(path.join(parent, 'external.txt'), 'External evidence.');
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { root, parent };
}

function client(t, root, grants = [], entry = server) {
  const child = spawn(process.execPath, [entry, '--root', root, ...grants.flatMap(grant => ['--allow-source-root', grant])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, buffer = '', stderr = '';
  const pending = new Map(), received = [], queued = [];
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.stderr.on('data', value => { stderr += value; });
  child.stdout.on('data', value => {
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      received.push(message);
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); callback(message); }
      else if (queued.length) queued.shift()(message);
    }
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const wait = id => new Promise(resolve => pending.set(id, resolve));
  function request(method, params = {}) {
    const id = ++sequence, result = wait(id);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return result;
  }
  return {
    child, received, request, stderr: () => stderr,
    raw: bytes => child.stdin.write(bytes),
    next: () => new Promise(resolve => queued.push(resolve)),
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined && { params }) }) + '\n'),
    async init(version = '2025-11-25') {
      const response = await request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      this.notify('notifications/initialized');
      return response;
    },
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    async close() { child.stdin.end(); return exit; },
  };
}
const value = response => response.result.structuredContent;

test('an npm-style executable symlink launches the agent lifecycle and tools', { timeout: 10000 }, async t => {
  const { root, parent } = await fixture(t), entry = path.join(parent, 'atlas-agent');
  await symlink(server, entry);
  const rpc = client(t, root, [], entry);
  assert.equal((await rpc.init()).result.protocolVersion, '2025-11-25');
  assert.equal(value(await rpc.call('atlas_route', { point: 'note' })).selected[0].point.id, 'note');
  assert.equal((await rpc.close()).code, 0);
  assert.equal(rpc.stderr(), '');
});

test('stdio lifecycle, version negotiation, tools, and protocol errors', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root);
  assert.equal((await rpc.request('tools/list')).error.code, -32002);
  assert.equal((await rpc.init('2099-01-01')).result.protocolVersion, '2025-11-25');
  const listed = await rpc.request('tools/list');
  assert.ok(listed.result.tools.some(tool => tool.name === 'atlas_absorb_prepare'));
  assert.ok(listed.result.tools.every(tool => tool.inputSchema.additionalProperties === false));
  assert.equal((await rpc.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).error.code, -32600);
  assert.equal((await rpc.request('unknown')).error.code, -32601);
  assert.equal((await rpc.call('unknown')).error.code, -32602);
  assert.equal((await rpc.request('tools/call', { name: 'atlas_view', arguments: [] })).error.code, -32602);
  const invalid = await rpc.call('atlas_view', { root: '/different-root' });
  assert.equal(invalid.result.isError, true); assert.equal(value(invalid).error.code, 'INVALID_ARGUMENT');
  const view = value(await rpc.call('atlas_view'));
  assert.equal(view.status, 'ready'); assert.equal(view.atlas.points.length, 2);
  assert.ok(view.files.every(file => file.content === undefined));
  assert.equal((await rpc.close()).code, 0); assert.equal(rpc.stderr(), '');
});

test('malformed, oversized, duplicate-key, and invalid UTF-8 frames do not poison a session', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  for (const frame of ['not-json\n', '[]\n', '{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}\n', Buffer.from([0xc3, 0x28, 10]), 'x'.repeat(2 * 1024 * 1024 + 10) + '\n']) {
    const next = rpc.next(); rpc.raw(frame);
    assert.ok([-32700, -32600].includes((await next).error.code));
  }
  assert.deepEqual((await rpc.request('ping')).result, {});
  assert.equal((await rpc.close()).code, 0);
});

test('source grants are immutable and local URLs are not fetched', { timeout: 10000 }, async t => {
  const { root, parent } = await fixture(t), rpc = client(t, root); await rpc.init();
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: 'source.txt' } })).content, 'Local evidence.');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: '../external.txt' } })).status, 'denied');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: '../external.txt' }, allowedRoots: [parent] })).error.code, 'INVALID_ARGUMENT');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: 'http://127.0.0.1:1/no-fetch' } })).status, 'reference');
  await rpc.close();
  const granted = client(t, root, [parent]); await granted.init();
  assert.equal(value(await granted.call('atlas_read_source', { source: { uri: '../external.txt' } })).content, 'External evidence.');
  await granted.close();
});

test('oversized serialized output returns a bounded error and preserves the session', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  await writeFile(path.join(root, 'escaped.txt'), '\0'.repeat(400000));
  const response = await rpc.call('atlas_read_source', { source: { uri: 'escaped.txt' } });
  assert.equal(response.error.code, -32001);
  assert.ok(JSON.stringify(response).length < 1000);
  assert.deepEqual((await rpc.request('ping')).result, {});
  await rpc.close();
});

test('draft persistence across restart and stale apply preserve the original baseline', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  const baseline = value(await rpc.call('atlas_view')).identity;
  const prepared = value(await rpc.call('atlas_prepare_change', { baseline, request: { reason: 'Clarify note.', changes: [{ path: 'trees/service/points/note.md', content: markdown('note', 'Revised note.') }] } }));
  assert.equal(prepared.plan.status, 'ready');
  assert.equal(value(await rpc.call('atlas_save_draft', { proposalId: prepared.proposalId, id: 'first' })).status, 'saved');
  await rpc.close();
  const restarted = client(t, root); await restarted.init();
  const saved = value(await restarted.call('atlas_load_draft', { full: true, id: 'first' })).draft;
  assert.equal(saved.plan.baseline.identity, baseline);
  assert.equal(value(await restarted.call('atlas_apply_draft', { id: 'first', expectedRevision: saved.revision })).status, 'complete');
  const newView = value(await restarted.call('atlas_view'));
  const stale = value(await restarted.call('atlas_prepare_change', { baseline: newView.identity, request: { reason: 'Clarify again.', changes: [{ path: 'trees/service/points/note.md', content: markdown('note', 'Proposed again.') }] } }));
  const staleSaved = value(await restarted.call('atlas_save_draft', { proposalId: stale.proposalId, id: 'stale' }));
  const foreign = markdown('note', 'Independent edit.'); await writeFile(path.join(root, 'trees/service/points/note.md'), foreign);
  const refused = await restarted.call('atlas_apply_draft', { id: 'stale', expectedRevision: staleSaved.revision });
  assert.equal(refused.result.isError, true); assert.equal(value(refused).error.code, 'STALE');
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), foreign);
  const refreshed = value(await restarted.call('atlas_refresh'));
  assert.equal(refreshed.comparison.same, false);
  assert.equal(value(await restarted.call('atlas_prepare_change', { baseline: newView.identity, request: { reason: 'Wrong baseline.', changes: [] } })).error.code, 'STALE');
  await restarted.close();
});

test('invalid Absorb decisions cannot retain an applyable draft', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  const baseline = value(await rpc.call('atlas_view')).identity;
  const response = await rpc.call('atlas_absorb_prepare', { baseline, proposal: {
    source: { uri: 'source.txt' }, rationale: 'Candidate correction.',
    contributions: [{ disposition: 'update', point: 'base', rationale: 'Declares the wrong changed Point.' }],
    changes: [{ path: 'trees/service/points/note.md', content: markdown('note', 'Changed note without a contribution decision.') }],
  } });
  const prepared = value(response);
  assert.equal(prepared.proposal.status, 'invalid'); assert.equal(prepared.proposal.plan.status, 'ready'); assert.equal(response.result.isError, true);
  const refused = await rpc.call('atlas_save_draft', { proposalId: prepared.proposalId, id: 'invalid' });
  assert.equal(value(refused).error.code, 'INVALID_PROPOSAL');
  assert.deepEqual(value(await rpc.call('atlas_list_state')).drafts, []);
  await rpc.close();
});

test('packaged guides are exact, bounded choices independent of authored Atlas content', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  for (const [topic, file] of [['operating', 'OPERATING.md'], ['meaning', 'SPEC.md'], ['format', 'spec/FORMAT.md']]) {
    const guide = value(await rpc.call('atlas_guide', { topic }));
    assert.equal(guide.status, 'ready');
    assert.equal(guide.content, await readFile(new URL(`../../../spec/${file}`, import.meta.url), 'utf8'));
  }
  assert.equal(value(await rpc.call('atlas_guide', { topic: '../../../private' })).error.code, 'INVALID_ARGUMENT');
  assert.equal(value(await rpc.call('atlas_guide', { topic: 'operating', root })).error.code, 'INVALID_ARGUMENT');
  await rpc.close();
});

test('agent save, apply and discard cannot replace a different reviewed draft revision', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  const baseline = value(await rpc.call('atlas_view')).identity;
  const prepare = async body => value(await rpc.call('atlas_prepare_change', { baseline, request: { reason: 'Revise note', changes: [{ path: 'trees/service/points/note.md', content: markdown('note', body) }] } }));
  const first = await prepare('First proposal');
  const firstSaved = value(await rpc.call('atlas_save_draft', { id: 'shared', proposalId: first.proposalId }));
  const later = await prepare('Later proposal');
  assert.equal(value(await rpc.call('atlas_save_draft', { id: 'shared', proposalId: later.proposalId })).error.code, 'STALE_DRAFT');
  const laterSaved = value(await rpc.call('atlas_save_draft', { id: 'shared', proposalId: later.proposalId, expectedRevision: firstSaved.revision }));
  assert.notEqual(firstSaved.revision, laterSaved.revision);
  for (const name of ['atlas_apply_draft', 'atlas_delete_draft']) {
    assert.equal(value(await rpc.call(name, { id: 'shared', expectedRevision: firstSaved.revision })).error.code, 'STALE_DRAFT');
  }
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), markdown('note', 'Original note.'));
  assert.equal(value(await rpc.call('atlas_apply_draft', { id: 'shared', expectedRevision: laterSaved.revision })).status, 'complete');
  assert.match(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), /Later proposal/);
  await rpc.close();
});

test('explicit manual Check review preserves unable gaps, exact evidence and report freshness', { timeout: 15000 }, async t => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, '.checks'));
  await writeFile(path.join(root, '.checks/review.md'), '---\n{"id":"review","status":"active","level":"required"}\n---\n# Review evidence\n\n## Requirement\nQualify the account.\n\n## Verification\nInspect its evidence.\n\n## Failure\nRecord the gap.\n');
  const rpc = client(t, root); await rpc.init();
  const inventory = value(await rpc.call('atlas_checks'));
  assert.equal(inventory.complete, true); assert.equal(inventory.checks[0].verification, 'not-reviewed');
  const baseline = inventory.identity, actor = 'agent:test-reviewer';
  assert.deepEqual(value(await rpc.call('atlas_check_reports')).reports, []);
  const unavailable = value(await rpc.call('atlas_evaluate_checks', { baseline, actor }));
  assert.equal(unavailable.required.unable, 1); assert.equal(unavailable.requiredSatisfied, false);
  assert.equal(unavailable.results[0].method, 'unavailable');
  const evidence = [{ text: 'Reviewed the π and 漢字 qualifications.', source: { uri: 'source.txt', role: 'evidence' } }];
  const manual = [{ id: 'review', revision: inventory.checks[0].revision, baseline, outcome: 'pass', reason: 'An explicit manual review found the qualifications.', evidence }];
  assert.equal(value(await rpc.call('atlas_evaluate_checks', { baseline, actor, manual, evaluators: [] })).error.code, 'INVALID_ARGUMENT');
  const incomplete = value(await rpc.call('atlas_evaluate_checks', { baseline, actor, checkIds: [] }));
  assert.equal(incomplete.required.unreviewed, 1); assert.equal(incomplete.requiredSatisfied, false);
  const run = value(await rpc.call('atlas_evaluate_checks', { baseline, actor, manual }));
  assert.equal(run.results[0].method, 'manual'); assert.equal(run.requiredSatisfied, true);
  let offset = 0, sha256, details = '';
  while (offset !== null) {
    const chunk = value(await rpc.call('atlas_check_run', { id: run.id, offset, maxBytes: 257, ...(sha256 ? { expectedSha256: sha256 } : {}) }));
    assert.ok(chunk.returnedBytes <= 257); details += chunk.text; offset = chunk.nextOffset; sha256 = chunk.sha256;
  }
  assert.deepEqual(JSON.parse(details).results[0].evidence, evidence);
  const retained = value(await rpc.call('atlas_retain_check_run', { id: run.id }));
  assert.equal(retained.status, 'retained');
  assert.equal(value(await rpc.call('atlas_check_report', { id: run.id })).freshness, 'current');
  await writeFile(path.join(root, 'trees/service/points/note.md'), markdown('note', 'A later revision.'));
  await rpc.call('atlas_refresh');
  assert.equal(value(await rpc.call('atlas_check_report', { id: run.id })).freshness, 'stale');
  await rpc.close();
  const restarted = client(t, root); await restarted.init();
  assert.equal(value(await restarted.call('atlas_check_reports')).reports[0].id, run.id);
  assert.equal(value(await restarted.call('atlas_check_run', { id: run.id })).error.code, 'RUN_EXPIRED');
  const report = value(await restarted.call('atlas_check_report', { id: run.id, part: 'details', maxBytes: 131072 }));
  assert.equal(report.complete, true); assert.equal(JSON.parse(report.text).run.results[0].method, 'manual');
  await restarted.close();
});

test('cancellation suppresses queued work and leaves the session usable', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  rpc.raw(JSON.stringify({ jsonrpc: '2.0', id: 'cancel-me', method: 'tools/call', params: { name: 'atlas_view', arguments: {} } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'cancel-me' } }) + '\n');
  await rpc.request('ping');
  assert.ok(!rpc.received.some(message => message.id === 'cancel-me'));
  const view = value(await rpc.call('atlas_view'));
  assert.equal(view.status, 'ready');
  const prepared = value(await rpc.call('atlas_prepare_change', { baseline: view.identity, request: { reason: 'Prepare a cancel test.', changes: [{ path: 'trees/service/points/note.md', content: markdown('note', 'Cancellation leaves this unapplied.') }] } }));
  rpc.raw(JSON.stringify({ jsonrpc: '2.0', id: 'cancel-write', method: 'tools/call', params: { name: 'atlas_save_draft', arguments: { proposalId: prepared.proposalId, id: 'cancelled' } } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'cancel-write' } }) + '\n');
  await rpc.request('ping');
  assert.ok(!rpc.received.some(message => message.id === 'cancel-write'));
  assert.deepEqual(value(await rpc.call('atlas_list_state')).drafts, []);
  await rpc.close();
});
