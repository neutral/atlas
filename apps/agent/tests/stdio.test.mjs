import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { readGuide, GUIDE_DOCUMENTS } from '../src/tools.mjs';

const server = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const markdown = (id, body) => `---\n${JSON.stringify({ id })}\n---\n# ${id}\n\n${body}\n`;
async function fixture(t) {
  const parent = await tempDirectory('atlas-agent-');
  const root = path.join(parent, 'atlas');
  await mkdir(path.join(root, 'trees/service/points'), { recursive: true });
  await writeFile(path.join(root, 'atlas.json'), JSON.stringify({ format: 'atlas/1.2', id: 'example', title: 'Example', trees: ['trees/service'] }));
  await writeFile(path.join(root, 'style.md'), '# One account\n\nThe service account says what the notes promise.\n');
  await writeFile(path.join(root, 'trees/service/tree.json'), JSON.stringify({ id: 'service', title: 'Service', scope: 'Offline notes.', base: 'base', children: [{ point: 'note' }] }));
  await writeFile(path.join(root, 'trees/service/points/base.md'), markdown('base', 'Notes remain usable offline.'));
  await writeFile(path.join(root, 'trees/service/points/note.md'), markdown('note', 'Original note.'));
  await writeFile(path.join(root, 'source.txt'), 'Local evidence.');
  await writeFile(path.join(parent, 'external.txt'), 'External evidence.');
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { root, parent };
}

/** A server started from a path, as the tests start it, or from the command, arguments and environment a host was given. */
function client(t, root, grants = [], entry = server) {
  const child = typeof entry === 'string'
    ? spawn(process.execPath, [entry, '--root', root, ...grants.flatMap(grant => ['--allow-source-root', grant])], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(entry.command, entry.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...entry.env } });
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

const names = ['atlas_guide', 'atlas_open', 'atlas_refresh', 'atlas_outline', 'atlas_inspect', 'atlas_search', 'atlas_route', 'atlas_references', 'atlas_read_source', 'atlas_stale', 'atlas_validate', 'atlas_absorb', 'atlas_styles',
  'atlas_init', 'atlas_candidate', 'atlas_prepare', 'atlas_review', 'atlas_drafts', 'atlas_apply', 'atlas_recover', 'atlas_move', 'atlas_stamp'];
const note = body => ({ path: 'trees/service/points/note.md', content: markdown('note', body) });

test('stdio lifecycle, version negotiation, tools, and protocol errors', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root);
  assert.equal((await rpc.request('tools/list')).error.code, -32002);
  const initialized = await rpc.init('2099-01-01');
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.match(initialized.result.instructions, /atlas_guide.*atlas_open/);
  const listed = await rpc.request('tools/list');
  assert.deepEqual(listed.result.tools.map(tool => tool.name), names);
  assert.ok(listed.result.tools.every(tool => tool.inputSchema.additionalProperties === false));
  assert.ok(listed.result.tools.every(tool => tool.description.length > 60 && tool.description.length < 400 && !/Editor|Branch|proposal|Check run/.test(tool.description)));
  const hints = Object.fromEntries(listed.result.tools.map(tool => [tool.name, tool.annotations]));
  // The candidate folder is replaced whole, edits not yet prepared included.
  assert.deepEqual(names.filter(name => hints[name].destructiveHint), ['atlas_candidate', 'atlas_drafts', 'atlas_apply', 'atlas_recover']);
  assert.deepEqual(names.filter(name => !hints[name].readOnlyHint && !hints[name].destructiveHint), ['atlas_init', 'atlas_prepare', 'atlas_move', 'atlas_stamp']);
  assert.equal((await rpc.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).error.code, -32600);
  assert.equal((await rpc.request('unknown')).error.code, -32601);
  assert.equal((await rpc.call('unknown')).error.code, -32602);
  for (const gone of ['atlas_view', 'atlas_save_draft', 'atlas_prepare_change', 'atlas_absorb_prepare', 'atlas_evaluate_checks', 'atlas_source_history', 'atlas_prepare_style']) assert.equal((await rpc.call(gone)).error.code, -32602, gone);
  assert.equal((await rpc.request('tools/call', { name: 'atlas_open', arguments: [] })).error.code, -32602);
  const invalid = await rpc.call('atlas_open', { root: '/different-root' });
  assert.equal(invalid.result.isError, true); assert.equal(value(invalid).error.code, 'INVALID_ARGUMENT');
  const view = value(await rpc.call('atlas_open'));
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
  const local = value(await rpc.call('atlas_read_source', { source: { uri: 'source.txt' } }));
  assert.equal(local.content, 'Local evidence.'); assert.equal(local.stamp, 'unstamped');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: 'source.txt', sha256: '0'.repeat(64) } })).stamp, 'changed');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: '../external.txt' } })).status, 'denied');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: '../external.txt' }, allowedRoots: [parent] })).error.code, 'INVALID_ARGUMENT');
  assert.equal(value(await rpc.call('atlas_read_source', { source: { uri: 'http://127.0.0.1:1/no-fetch' } })).status, 'reference');
  await rpc.close();
  const granted = client(t, root, [parent]); await granted.init();
  assert.equal(value(await granted.call('atlas_read_source', { source: { uri: '../external.txt' } })).content, 'External evidence.');
  await granted.close();
});

test('a state location the Library refuses is the refusal of every tool that keeps state or reads sources, and of no other', { timeout: 20000 }, async t => {
  const { root, parent } = await fixture(t);
  await writeFile(path.join(parent, 'a-file'), '');
  // A relative state home, one whose path runs through a regular file, and one inside the Atlas.
  for (const [home, code, message] of [['relative/state', 'INVALID_STATE_HOME', 'ATLAS_STATE_HOME must be an absolute directory.'],
    [path.join(parent, 'a-file', 'state'), 'UNSAFE_STATE', 'Private state requires regular directories without symbolic links.'],
    [path.join(root, 'state'), 'UNSAFE_STATE', 'Private state must be outside the Atlas.']]) {
    const rpc = client(t, root, [], { command: process.execPath, args: [server, '--root', root], env: { ATLAS_STATE_HOME: home } });
    await rpc.init();
    const view = value(await rpc.call('atlas_open'));
    const refusal = { status: 'error', error: { code, message } };
    for (const [name, args] of [['atlas_stale', {}], ['atlas_read_source', { source: { uri: 'source.txt' } }], ['atlas_stamp', { baseline: view.identity, all: true }], ['atlas_validate', { from: '.atlas-candidate' }],
      ['atlas_candidate', {}], ['atlas_prepare', { baseline: view.identity, reason: 'Refused.', changes: [note('Refused.')] }], ['atlas_init', { baseline: view.identity, id: 'other', title: 'Other', styleId: 'concise-subjects' }],
      ['atlas_move', { baseline: view.identity, point: 'note', path: 'trees/service/points/moved.md', reason: 'Refused.' }], ['atlas_review', { id: 'absent' }], ['atlas_drafts', { action: 'list' }],
      ['atlas_apply', { id: 'absent', expectedRevision: '0'.repeat(64) }], ['atlas_recover', {}]]) {
      const refused = await rpc.call(name, args);
      assert.deepEqual([refused.result.isError, value(refused)], [true, refusal], `${message} ${name}`);
    }
    for (const [name, args] of [['atlas_guide', {}], ['atlas_outline', {}], ['atlas_validate', {}], ['atlas_route', { point: 'note' }], ['atlas_inspect', { path: 'atlas.json' }]]) {
      assert.equal((await rpc.call(name, args)).result.isError, false, `${message} ${name}`);
    }
    assert.equal((await rpc.close()).code, 0);
  }
  await assert.rejects(readdir(path.join(root, '.atlas-candidate')), { code: 'ENOENT' });
  await assert.rejects(readdir(path.join(root, 'state')), { code: 'ENOENT' });
});

test('one limit on source grants at launch, of distinct directories with the Atlas root', { timeout: 10000 }, async t => {
  const { root, parent } = await fixture(t);
  const launch = grants => spawnSync(process.execPath, [server, '--root', root, ...grants.flatMap(grant => ['--allow-source-root', grant])], { input: '', encoding: 'utf8', timeout: 5000 });
  const distinct = count => Array.from({ length: count }, (_, index) => path.join(parent, `grant-${index}`));
  assert.deepEqual([launch(distinct(99)).status, launch(distinct(99)).stderr], [0, '']);
  assert.deepEqual([launch(distinct(100)).status, launch(distinct(100)).stderr], [1, 'At most 100 distinct source roots, including the Atlas root, may be granted.\n']);
  assert.deepEqual([launch(Array(150).fill(parent)).status, launch(Array(150).fill(parent)).stderr], [0, ''], 'a directory given many times is one grant');
  const paths = 'Source grants must be directory paths of at most 4096 characters, without NUL characters.\n';
  for (const grant of [`/${'a'.repeat(4096)}`, '   ']) assert.deepEqual([launch([grant]).status, launch([grant]).stderr], [1, paths], JSON.stringify(grant.slice(0, 8)));
  assert.deepEqual([launch(['']).status, launch(['']).stderr], [1, 'Only launch-time --allow-source-root PATH grants are accepted.\n']);
  // A grant is measured as it is used, resolved from the working directory.
  const from = (cwd, grant) => spawnSync(process.execPath, [server, '--root', root, '--allow-source-root', grant], { cwd, input: '', encoding: 'utf8', timeout: 5000 });
  const short = 'a'.repeat(4096 - parent.length), long = `${'./'.repeat(2100)}x`;
  assert.ok(short.length <= 4096 && path.resolve(parent, short).length > 4096 && long.length > 4096 && path.resolve(parent, long).length < 4096);
  assert.deepEqual([from(parent, short).status, from(parent, short).stderr], [1, paths], 'a short grant that resolves past 4096 characters');
  assert.deepEqual([from(parent, long).status, from(parent, long).stderr], [0, ''], 'a long grant that resolves short');
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

test('preparing saves a draft that survives a restart, and a stale apply preserves the files and the baseline', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  const baseline = value(await rpc.call('atlas_open')).identity;
  const prepared = value(await rpc.call('atlas_prepare', { baseline, reason: 'Clarify note.', changes: [note('Revised note.')] }));
  assert.equal(prepared.format, 'atlas.draft/1'); assert.equal(prepared.plan.status, 'ready');
  assert.match(prepared.id, /^[a-f0-9-]{36}$/); assert.match(prepared.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(prepared.plan.changes.map(change => [change.path, change.action, change.after]), [['trees/service/points/note.md', 'write', undefined]]);
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), markdown('note', 'Original note.'));
  await rpc.close();
  const restarted = client(t, root); await restarted.init();
  assert.deepEqual(value(await restarted.call('atlas_drafts', { action: 'list' })).drafts.map(draft => [draft.id, draft.revision, draft.baseline]), [[prepared.id, prepared.revision, baseline]]);
  const saved = value(await restarted.call('atlas_drafts', { action: 'load', id: prepared.id, full: true })).draft;
  assert.equal(saved.plan.baseline.identity, baseline);
  assert.equal(saved.plan.changes[0].after, markdown('note', 'Revised note.'));
  const applied = value(await restarted.call('atlas_apply', { id: prepared.id, expectedRevision: prepared.revision }));
  assert.deepEqual([applied.status, applied.draft], ['complete', 'removed']);
  assert.deepEqual(value(await restarted.call('atlas_drafts', { action: 'list' })).drafts, [], 'a completed apply removes its draft');
  const newView = value(await restarted.call('atlas_open'));
  assert.deepEqual(applied.view, { status: 'ready', identity: newView.identity });
  assert.notEqual(newView.identity, baseline);
  const stale = value(await restarted.call('atlas_prepare', { baseline: newView.identity, reason: 'Clarify again.', changes: [note('Proposed again.')] }));
  const foreign = markdown('note', 'Independent edit.'); await writeFile(path.join(root, 'trees/service/points/note.md'), foreign);
  assert.equal(value(await restarted.call('atlas_review', { id: stale.id })).draft.stale, true);
  const refused = await restarted.call('atlas_apply', { id: stale.id, expectedRevision: stale.revision });
  assert.equal(refused.result.isError, true); assert.equal(value(refused).error.code, 'STALE');
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), foreign);
  const refreshed = value(await restarted.call('atlas_refresh'));
  assert.equal(refreshed.comparison.same, false);
  assert.deepEqual(refreshed.comparison.changed, ['trees/service/points/note.md']);
  assert.equal(value(await restarted.call('atlas_prepare', { baseline: newView.identity, reason: 'Wrong baseline.', changes: [] })).error.code, 'STALE');
  // The completed apply removed its journal as it removed its draft.
  assert.deepEqual(value(await restarted.call('atlas_recover')), { format: 'atlas.transactions/1', status: 'ready', transactions: [], unreadable: [] });
  const recovered = await restarted.call('atlas_recover', { id: applied.transaction });
  assert.deepEqual([recovered.result.isError, value(recovered).error], [true, { code: 'NOT_FOUND', message: 'Saved state does not exist.' }]);
  await restarted.close();
});

test('an invalid candidate is saved for inspection, reported as an error and never applied', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  const baseline = value(await rpc.call('atlas_open')).identity;
  const response = await rpc.call('atlas_prepare', { baseline, reason: 'Break the note.', changes: [{ path: 'trees/service/points/note.md', content: 'No header.\n' }] });
  const prepared = value(response);
  assert.equal(response.result.isError, true);
  assert.equal(prepared.plan.status, 'invalid');
  assert.ok(prepared.plan.validation.diagnostics.some(item => item.path === 'trees/service/points/note.md'));
  assert.deepEqual(value(await rpc.call('atlas_drafts', { action: 'list' })).drafts.map(draft => draft.status), ['invalid']);
  const review = await rpc.call('atlas_review', { id: prepared.id, expectedRevision: prepared.revision });
  assert.equal(review.result.isError, true); assert.equal(value(review).status, 'unavailable');
  assert.equal(value(await rpc.call('atlas_apply', { id: prepared.id, expectedRevision: prepared.revision })).error.code, 'INVALID_CANDIDATE');
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), markdown('note', 'Original note.'));
  for (const args of [{ baseline, reason: 'Neither.' }, { baseline, reason: 'Both.', changes: [], candidate: root }, { reason: 'No baseline.', changes: [] }, { baseline, reason: 'Old field.', changes: [], styleChange: true }, { baseline, request: { reason: 'Old shape.', changes: [] } }]) {
    assert.equal(value(await rpc.call('atlas_prepare', args)).error.code, 'INVALID_ARGUMENT', JSON.stringify(args));
  }
  await rpc.close();
});

test('the guide is the shipped text, independent of arguments and of authored Atlas content', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  const guide = value(await rpc.call('atlas_guide'));
  assert.equal(guide.status, 'ready');
  assert.equal(guide.content, await readFile(new URL('../../../spec/OPERATING.md', import.meta.url), 'utf8'));
  assert.match(guide.content, /^# Working with Atlas\n/);
  assert.equal(value(await rpc.call('atlas_guide', { topic: 'format' })).error.code, 'INVALID_ARGUMENT');
  for (const document of GUIDE_DOCUMENTS) {
    const shipped = value(await rpc.call('atlas_guide', { document }));
    assert.deepEqual(shipped, { status: 'ready', document, content: await readGuide(document) });
    assert.match(shipped.content, /^# /);
  }
  assert.deepEqual(GUIDE_DOCUMENTS, ['spec', 'format', 'operations', 'project']);
  assert.equal(value(await rpc.call('atlas_guide', { document: 'OPERATING.md' })).error.code, 'INVALID_ARGUMENT');
  assert.equal(value(await rpc.call('atlas_guide', { root })).error.code, 'INVALID_ARGUMENT');
  await rpc.close();
});

test('apply and delete need the exact revision of the draft, and a new Atlas starts as a draft', { timeout: 10000 }, async t => {
  const { root, parent } = await fixture(t), rpc = client(t, root); await rpc.init();
  const baseline = value(await rpc.call('atlas_open')).identity;
  const first = value(await rpc.call('atlas_prepare', { baseline, reason: 'Revise note', changes: [note('First proposal')] }));
  const later = value(await rpc.call('atlas_prepare', { baseline, reason: 'Revise note', changes: [note('Later proposal')] }));
  assert.notEqual(first.id, later.id);
  for (const [name, args, again] of [['atlas_apply', {}, 'review'], ['atlas_drafts', { action: 'delete' }, 'load'], ['atlas_drafts', { action: 'load' }, 'load'], ['atlas_review', {}, 'review']]) {
    assert.deepEqual(value(await rpc.call(name, { ...args, id: later.id, expectedRevision: first.revision })).error,
      { code: 'STALE_DRAFT', message: `The draft is not at that revision; ${again} it and give its exact revision.` }, name);
  }
  assert.equal(value(await rpc.call('atlas_drafts', { action: 'delete', id: later.id })).error.code, 'STALE_DRAFT');
  assert.equal(value(await rpc.call('atlas_drafts', { action: 'list', id: later.id })).error.code, 'INVALID_ARGUMENT');
  assert.equal(value(await rpc.call('atlas_drafts', { action: 'load' })).error.code, 'INVALID_ARGUMENT');
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), markdown('note', 'Original note.'));
  assert.equal(value(await rpc.call('atlas_drafts', { action: 'delete', id: first.id, expectedRevision: first.revision })).status, 'deleted');
  assert.equal(value(await rpc.call('atlas_apply', { id: later.id, expectedRevision: later.revision })).status, 'complete');
  assert.match(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), /Later proposal/);
  await rpc.close();
  const empty = path.join(parent, 'empty'); await mkdir(empty);
  const fresh = client(t, empty); await fresh.init();
  const none = value(await fresh.call('atlas_open'));
  assert.equal(none.status, 'invalid');
  assert.equal(value(await fresh.call('atlas_init', { baseline: none.identity, id: 'fresh', title: 'Fresh' })).error.code, 'INVALID_REQUEST');
  assert.equal(value(await fresh.call('atlas_init', { baseline: none.identity, id: 'fresh', title: 'Fresh', styleId: 'concise-subjects', styleContent: '# Both\n\nRefused.\n' })).error.code, 'INVALID_REQUEST');
  const created = value(await fresh.call('atlas_init', { baseline: none.identity, id: 'fresh', title: 'Fresh', styleId: 'concise-subjects' }));
  assert.deepEqual(created.plan.changes.map(change => change.path), ['atlas.json', 'style.md']);
  assert.deepEqual(await readdir(empty), []);
  assert.equal(value(await fresh.call('atlas_apply', { id: created.id, expectedRevision: created.revision })).view.status, 'ready');
  // A new Atlas has no Tree yet: the outline of all of them is empty and ready, and a Tree it does not have is missing.
  const outlined = await fresh.call('atlas_outline');
  assert.deepEqual([outlined.result.isError, value(outlined).status, value(outlined).trees], [false, 'ready', []]);
  assert.deepEqual([value(await fresh.call('atlas_outline', { tree: 'service' })).status], ['missing']);
  assert.equal(value(await fresh.call('atlas_inspect', { style: true })).record.title, value(await fresh.call('atlas_styles', { id: 'concise-subjects' })).style.title);
  await fresh.close();
});

test('cancellation suppresses queued work and leaves the session usable', { timeout: 10000 }, async t => {
  const { root } = await fixture(t), rpc = client(t, root); await rpc.init();
  rpc.raw(JSON.stringify({ jsonrpc: '2.0', id: 'cancel-me', method: 'tools/call', params: { name: 'atlas_open', arguments: {} } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'cancel-me' } }) + '\n');
  await rpc.request('ping');
  assert.ok(!rpc.received.some(message => message.id === 'cancel-me'));
  const view = value(await rpc.call('atlas_open'));
  assert.equal(view.status, 'ready');
  rpc.raw(JSON.stringify({ jsonrpc: '2.0', id: 'cancel-write', method: 'tools/call', params: { name: 'atlas_prepare', arguments: { baseline: view.identity, reason: 'Prepare a cancel test.', changes: [note('Cancellation leaves this unsaved.')] } } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'cancel-write' } }) + '\n');
  await rpc.request('ping');
  assert.ok(!rpc.received.some(message => message.id === 'cancel-write'));
  assert.deepEqual(value(await rpc.call('atlas_drafts', { action: 'list' })).drafts, []);
  await rpc.close();
});

const cli = fileURLToPath(new URL('../../cli/src/cli.mjs', import.meta.url));
const sha = text => createHash('sha256').update(text).digest('hex');
const design = storage => `# Design\n\n## Storage\n\n${storage}\n\n## Sync\n\nQueued edits are sent later.\n`;
const storage = text => `## Storage\n\n${text}\n\n`;
const record = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;

/** A project with a design document, and its Atlas at `atlas` (a folder of the project) or `.` (the project itself). */
async function project(t, atlasPath) {
  const directory = await tempDirectory('atlas-walk-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, atlasPath), uri = path.posix.join(atlasPath === '.' ? '' : '..', 'docs/design.md#storage');
  const files = {
    'atlas.json': JSON.stringify({ format: 'atlas/1.2', id: 'notes', title: 'Notes', trees: ['trees/service'] }),
    'style.md': '# One account\n\nThe service account says what the notes promise.\n',
    'trees/service/tree.json': JSON.stringify({ id: 'service', title: 'Service', scope: 'Offline notes.', base: 'base', children: [{ point: 'note' }] }),
    'trees/service/points/base.md': record({ id: 'base' }, 'Notes remain usable offline', 'Writers keep working without a connection.'),
    'trees/service/points/note.md': record({ id: 'note', sources: [{ uri, role: 'evidence', sha256: sha(storage('Notes stay on the device.')) }] }, 'Notes stay on the device', 'Each note is kept in local storage.'),
  };
  for (const [file, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content); }
  await mkdir(path.join(directory, 'docs'), { recursive: true });
  await writeFile(path.join(directory, 'docs/design.md'), design('Notes stay on the device.'));
  return { directory, root, uri };
}

/**
 * The server a host starts from what `atlas config` prints: its command, its arguments and its environment. With a
 * `project`, `atlas config` runs in the project and finds the Atlas there, as a maintainer runs it; otherwise it is given
 * the Atlas root and these grants.
 */
function configured(t, root, { grants = [], project } = {}) {
  const printed = project
    ? spawnSync(process.execPath, [cli, 'config'], { cwd: project, encoding: 'utf8', timeout: 15000 })
    : spawnSync(process.execPath, [cli, '--root', root, ...grants.flatMap(grant => ['--allow-source-root', grant]), 'config'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(printed.status, 0, printed.stderr);
  const launch = JSON.parse(printed.stdout).mcpServers.atlas;
  assert.deepEqual(launch.args.slice(0, 3), [server, '--root', root]);
  return client(t, root, [], launch);
}

/**
 * The maintainer's path through MCP alone: the guide, the candidate folder, one Point edited there with plain file
 * writes, validation, preparation, review, apply, and then the stale report once the project's source has changed.
 */
async function walk(t, { directory, root, uri }) {
  const rpc = configured(t, root, { project: directory });
  await rpc.init();
  const guide = value(await rpc.call('atlas_guide'));
  assert.equal(guide.content, await readGuide());
  assert.match(guide.content, /run `candidate`: it writes a fresh copy of the\s+Atlas's records into `\.atlas-candidate\/` at the Atlas root/);

  const candidate = value(await rpc.call('atlas_candidate'));
  assert.deepEqual(Object.keys(candidate), ['format', 'status', 'path', 'files', 'baseline']);
  assert.deepEqual([candidate.format, candidate.status, candidate.path, candidate.files], ['atlas.candidate/1', 'ready', path.join(root, '.atlas-candidate'), 5]);

  // The agent's own file tools: read the copy, write the edit.
  const copy = path.join(candidate.path, 'trees/service/points/note.md');
  const edited = (await readFile(copy, 'utf8')).replace('Each note is kept in local storage.', 'Each note is kept in local storage until it is sent.');
  await writeFile(copy, edited);

  const checked = value(await rpc.call('atlas_validate', { from: '.atlas-candidate' }));
  assert.deepEqual(checked, { format: 'atlas.validation/1', status: 'ready', identity: checked.identity, diagnostics: [], candidate: candidate.path,
    changes: [{ path: 'trees/service/points/note.md', action: 'write' }], ignored: [], linkDiagnostics: [], missingSources: [], unreadSources: 0,
    bounds: { linkDiagnostics: { available: 0, returned: 0 }, missingSources: { available: 0, returned: 0 }, diagnostics: { available: 0, returned: 0 }, changes: { available: 1, returned: 1 }, ignored: { available: 0, returned: 0 } }, limits: checked.limits });

  const draft = value(await rpc.call('atlas_prepare', { baseline: candidate.baseline, reason: 'Say when a note leaves the device.', candidate: '.atlas-candidate' }));
  assert.equal(draft.plan.status, 'ready', JSON.stringify(draft));
  assert.equal(draft.plan.validation.identity, checked.identity);
  assert.deepEqual(draft.plan.changes.map(change => [change.path, change.action]), [['trees/service/points/note.md', 'write']]);

  const review = value(await rpc.call('atlas_review', { id: draft.id }));
  assert.deepEqual([review.status, review.draft.stale, review.effects.changedManifest], ['ready', false, null]);
  assert.deepEqual(review.effects.points.map(point => [point.id, point.changes, point.above]), [['note', ['explanation'], ['base']]]);

  const applied = value(await rpc.call('atlas_apply', { id: draft.id, expectedRevision: draft.revision }));
  assert.deepEqual([applied.status, applied.view.identity], ['complete', checked.identity]);
  assert.equal(await readFile(path.join(root, 'trees/service/points/note.md'), 'utf8'), edited);

  // The project changes under the explanation; the stale report names the Point to read again.
  assert.equal(value(await rpc.call('atlas_stale')).counts.current, 1);
  await writeFile(path.join(directory, 'docs/design.md'), design('Notes stay on the device and in a backup.'));
  const stale = value(await rpc.call('atlas_stale'));
  assert.deepEqual(stale.counts, { references: 1, current: 0, changed: 1, missing: 0, denied: 0, unstamped: 0, remote: 0 });
  assert.deepEqual(stale.summary.map(item => [item.uri, item.status, item.citers.map(citer => citer.id)]), [[uri, 'changed', ['note']]]);
  // The folder is not part of the Atlas the session reads.
  assert.ok(value(await rpc.call('atlas_open')).files.every(file => !file.path.startsWith('.atlas-candidate')));
  assert.equal((await rpc.close()).code, 0);
}

test('the maintainer path through MCP alone, for an Atlas that is a folder of its project', { timeout: 20000 }, async t => {
  const layout = await project(t, 'atlas');
  // Run in the project, `atlas config` grants the project directory, so the stale report can read the project's sources.
  await walk(t, layout);
  // Configured with the Atlas root alone, the server cannot read what the Atlas cites in its project.
  const rpc = configured(t, layout.root);
  await rpc.init();
  const stale = value(await rpc.call('atlas_stale', { full: true }));
  assert.deepEqual([stale.counts.denied, stale.references[0].code], [1, 'SOURCE_DENIED']);
  await rpc.close();
});

test('the maintainer path through MCP alone, for an Atlas that is its project', { timeout: 20000 }, async t => {
  await walk(t, await project(t, '.'));
});
