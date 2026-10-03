import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function run(root, args, { input, grants = [], raw = false } = {}) {
  const result = spawnSync(process.execPath, [cli, ...(raw ? [] : ['--root', root, ...grants.flatMap((grant) => ['--allow-source-root', grant])]), ...args], {
    input, encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr,
    result: result.stdout ? JSON.parse(result.stdout) : null,
    error: result.stderr ? JSON.parse(result.stderr) : null };
}

async function fixture(t) {
  const directory = await tempDirectory('atlas-cli-');
  const root = path.join(directory, 'atlas');
  await fs.mkdir(root);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, root };
}

function initialize(root) {
  const prepared = run(root, ['init', '-'], { input: JSON.stringify({ id: 'example', title: 'Example' }) });
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.equal(prepared.result.plan.status, 'ready');
  const applied = run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision]);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.status, 'complete');
  return prepared.result;
}

async function manifestChange(root, title) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'));
  return { reason: `Set title to ${title}`, changes: [{ path: 'atlas.json', content: `${JSON.stringify({ ...manifest, title }, null, 2)}\n` }] };
}

test('CLI requires a fixed first root and rejects unknown or extra arguments', async (t) => {
  const { root } = await fixture(t);
  for (const args of [['validate', '--root', root], ['--root', '--allow-source-root', 'validate']]) {
    const result = run(root, args, { raw: true });
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, 'CLI_INVALID_ARGUMENT');
    assert.equal(result.stdout, '');
  }
  for (const args of [['unknown'], ['validate', '--root', '/tmp'], ['apply', '/tmp/arbitrary-plan.json'], ['serve', '--port', '-1'], ['state', 'unknown'], ['state', 'inspect', 'extra']]) {
    const result = run(root, args);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.error.error.code, 'CLI_INVALID_ARGUMENT');
  }
  const input = run(root, ['init', '-'], { input: '{"id":"example","title":"Example","root":"/tmp"}' });
  assert.equal(input.code, 2);
  assert.deepEqual(await fs.readdir(root), []);
});

test('CLI bounds JSON files and stdin and rejects invalid encodings and duplicate keys', async (t) => {
  const { directory, root } = await fixture(t);
  for (const [input, code] of [
    ['{"id":"example","id":"other","title":"Example"}', 'JSON_DUPLICATE_KEY'],
    [Buffer.from([0xff]), 'CLI_INPUT_ENCODING'],
    [' '.repeat(4 * 1024 * 1024 + 1), 'CLI_INPUT_LIMIT'],
  ]) {
    const result = run(root, ['init', '-'], { input });
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.error.error.code, code);
  }
  const oversized = path.join(directory, 'large.json');
  await fs.writeFile(oversized, ' '.repeat(4 * 1024 * 1024 + 1));
  const result = run(root, ['init', oversized]);
  assert.equal(result.code, 2);
  assert.equal(result.error.error.code, 'CLI_INPUT_LIMIT');
  assert.deepEqual(await fs.readdir(root), []);
});

test('initialization creates only a durable draft until a separate apply process', async (t) => {
  const { directory, root } = await fixture(t);
  const storage = run(root, ['state', 'inspect']);
  assert.equal(storage.code, 0, storage.stderr);
  assert.equal(storage.result.format, 'atlas.state-inspection/1');
  assert.equal(storage.result.state.exists, false);
  assert.ok(!storage.result.state.directory.startsWith(root + path.sep));
  await assert.rejects(fs.stat(storage.result.state.directory), { code: 'ENOENT' });
  const before = run(root, ['validate']);
  assert.equal(before.code, 1);
  assert.equal(before.result.status, 'invalid');
  assert.ok(before.result.diagnostics.some((item) => item.code === 'FILE_MISSING'));
  const request = path.join(directory, 'init.json');
  await fs.writeFile(request, JSON.stringify({ id: 'example', title: 'Example' }));
  const prepared = run(root, ['init', request]);
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(run(root, ['state']).result.state.exists, true);
  const draft = prepared.result;
  const shown = run(root, ['drafts', 'show', draft.id, '--full']);
  assert.deepEqual(shown.result, draft);
  const listed = run(root, ['drafts']);
  assert.equal(listed.result.drafts[0].id, draft.id);
  assert.equal(listed.result.drafts[0].baseline, draft.plan.baseline.identity);
  const applied = run(root, ['apply', draft.id, '--revision', draft.revision]);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.status, 'complete');
  const validation = run(root, ['validate']);
  assert.equal(validation.code, 0);
  assert.equal(validation.result.status, 'ready');
  assert.deepEqual(run(root, ['drafts', 'show', draft.id, '--full']).result.plan.baseline, draft.plan.baseline);
  const transactions = run(root, ['recover']);
  assert.equal(transactions.result.transactions[0].phase, 'complete');
});

test('persisted drafts retain their baseline and stale apply preserves intervening changes', async (t) => {
  const { root } = await fixture(t);
  initialize(root);
  const a = run(root, ['prepare', '-'], { input: JSON.stringify(await manifestChange(root, 'First')) });
  const b = run(root, ['prepare', '-'], { input: JSON.stringify(await manifestChange(root, 'Second')) });
  assert.equal(a.code, 0, a.stderr); assert.equal(b.code, 0, b.stderr);
  assert.equal(a.result.plan.baseline.identity, b.result.plan.baseline.identity);
  assert.equal(run(root, ['apply', a.result.id, '--revision', a.result.revision]).code, 0);
  const stale = run(root, ['apply', b.result.id, '--revision', b.result.revision]);
  assert.equal(stale.code, 3);
  assert.equal(stale.error.error.code, 'STALE');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8')).title, 'First');
  assert.deepEqual(run(root, ['drafts', 'show', b.result.id, '--full']).result, b.result);
  const deleted = run(root, ['drafts', 'delete', b.result.id, '--revision', b.result.revision]);
  assert.equal(deleted.code, 0);
  assert.equal(deleted.result.status, 'deleted');
});

test('invalid candidate stays inspectable and cannot be applied', async (t) => {
  const { root } = await fixture(t);
  initialize(root);
  const before = await fs.readFile(path.join(root, 'atlas.json'), 'utf8');
  const prepared = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'Invalid proposal', styleChange: true, changes: [{ path: 'atlas.json', content: '{}' }] }) });
  assert.equal(prepared.code, 1);
  assert.equal(prepared.result.plan.status, 'invalid');
  const applied = run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision]);
  assert.equal(applied.code, 1);
  assert.equal(applied.error.error.code, 'INVALID_CANDIDATE');
  assert.equal(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'), before);
});

test('config prints immutable absolute scope without writing host configuration', async (t) => {
  const { root, directory } = await fixture(t);
  const config = run(root, ['config'], { grants: [directory, directory] });
  assert.equal(config.code, 0);
  const server = config.result.mcpServers.atlas;
  assert.equal(server.command, process.execPath);
  assert.ok(path.isAbsolute(server.args[0]));
  assert.deepEqual(server.args.slice(1), ['--root', root, '--allow-source-root', directory]);
  assert.deepEqual(await fs.readdir(root), []);
  const override = run(root, ['route', '-'], { input: JSON.stringify({ point: 'purpose', root: directory }) });
  assert.equal(override.code, 2);
});

test('source preconditions require launcher grants and remain fixed in saved plans', async (t) => {
  const { root, directory } = await fixture(t);
  initialize(root);
  const content = 'External source material.\n';
  await fs.writeFile(path.join(directory, 'source.txt'), content);
  const request = await manifestChange(root, 'Source checked');
  request.sourcePreconditions = [{ uri: '../source.txt', sha256: createHash('sha256').update(content).digest('hex') }];
  const prepared = run(root, ['prepare', '-'], { input: JSON.stringify(request) });
  assert.equal(prepared.code, 0, prepared.stderr);
  const denied = run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision]);
  assert.equal(denied.code, 3);
  assert.equal(denied.error.error.code, 'STALE_SOURCE');
  const allowed = run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision], { grants: [directory] });
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(allowed.result.status, 'complete');
  await fs.writeFile(path.join(root, 'local.txt'), content);
  const localRequest = await manifestChange(root, 'Local source checked');
  localRequest.sourcePreconditions = [{ uri: 'local.txt', sha256: request.sourcePreconditions[0].sha256 }];
  const localDraft = run(root, ['prepare', '-'], { input: JSON.stringify(localRequest) });
  assert.equal(localDraft.code, 0, localDraft.stderr);
  const localApply = run(root, ['apply', localDraft.result.id, '--revision', localDraft.result.revision]);
  assert.equal(localApply.code, 0, localApply.stderr);
});

test('inspect, search and Route return authored records; invalid Absorb decisions never save applicable drafts', async (t) => {
  const { root } = await fixture(t);
  initialize(root);
  const point = '---\n{"id":"purpose"}\n---\n# Service purpose\n\nCustody preserves evidence.\n';
  const prepare = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'Add service account', changes: [
    { path: 'atlas.json', content: JSON.stringify({ ...JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8')), trees: ['trees/service'] }) },
    { path: 'trees/service/tree.json', content: JSON.stringify({ id: 'service', title: 'Service', scope: 'Service responsibilities.', base: 'purpose', children: [] }) },
    { path: 'trees/service/points/purpose.md', content: point },
  ] }) });
  assert.equal(prepare.code, 0, prepare.stderr);
  assert.equal(run(root, ['apply', prepare.result.id, '--revision', prepare.result.revision]).code, 0);
  assert.equal(run(root, ['inspect', 'point', 'purpose']).result.record.body, 'Custody preserves evidence.');
  assert.equal(run(root, ['inspect', 'tree', 'service']).result.record.base, 'purpose');
  const found = run(root, ['search', '-'], { input: '{"query":"custody"}' });
  assert.equal(found.result.results[0].id, 'purpose');
  const routed = run(root, ['route', '-'], { input: '{"point":"purpose"}' });
  assert.equal(routed.result.status, 'ready');
  assert.equal(routed.result.selected[0].point.id, 'purpose');
  const before = run(root, ['drafts']).result.drafts.length;
  const proposal = run(root, ['absorb', 'prepare', '-'], { input: JSON.stringify({
    source: { uri: 'sources/new.md' }, rationale: 'Review source addition.',
    contributions: [{ disposition: 'reference-only', point: 'purpose', rationale: 'Add a reference.' }],
    changes: [{ path: 'trees/service/points/purpose.md', content: point.replace('Custody preserves evidence.', 'Changed the explanation.') }],
  }) });
  assert.equal(proposal.code, 1, proposal.stderr);
  assert.equal(proposal.result.status, 'invalid');
  assert.equal(proposal.result.draft, null);
  assert.ok(proposal.result.decisionDiagnostics.length);
  assert.equal(run(root, ['drafts']).result.drafts.length, before);
});

test('mcp command emits protocol output without a CLI banner', async (t) => {
  const { root } = await fixture(t);
  const response = run(root, ['mcp'], { input: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cli-test', version: '1' } },
  }) + '\n' });
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.result.jsonrpc, '2.0');
  assert.equal(response.result.id, 1);
  assert.equal(response.result.result.serverInfo.name, 'atlas');
});

test('CLI application and discard require the exact saved revision from review', async t => {
  const { root } = await fixture(t);
  const prepared = run(root, ['init', '-'], { input: JSON.stringify({ id: 'reviewed', title: 'Reviewed Atlas' }) }).result;
  assert.equal(run(root, ['apply', prepared.id]).code, 2);
  const stale = run(root, ['apply', prepared.id, '--revision', '0'.repeat(64)]);
  assert.equal(stale.code, 3); assert.equal(stale.error.error.code, 'STALE_DRAFT');
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(run(root, ['apply', prepared.id, '--revision', prepared.revision]).result.status, 'complete');
  assert.equal(run(root, ['drafts', 'delete', prepared.id, '--revision', '0'.repeat(64)]).error.error.code, 'STALE_DRAFT');
  assert.equal(run(root, ['drafts', 'delete', prepared.id, '--revision', prepared.revision]).result.status, 'deleted');
});

test('serve and editor print usable URLs and close on SIGTERM', async (t) => {
  const { root } = await fixture(t);
  initialize(root);
  for (const command of ['serve', 'editor']) {
    const child = spawn(process.execPath, [cli, '--root', root, command, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    const started = await new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 10000);
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        try { const value = JSON.parse(stdout); clearTimeout(timeout); resolve(value); } catch { /* Await the complete JSON result. */ }
      });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });
    assert.equal(started.status, 'serving');
    assert.equal(started.editable, command === 'editor');
    const url = new URL(started.url);
    assert.equal((await fetch(url)).status, 200);
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    const view = await fetch(new URL('/api/view', url), { headers: { authorization: `Bearer ${token}` } });
    assert.equal(view.status, 200);
    assert.equal((await view.json()).editable, command === 'editor');
    child.kill('SIGTERM');
    assert.deepEqual(await closed, { code: 0, signal: null });
  }
});
