import { calculateCheckRevision } from '../../../library/src/evaluation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import MarkdownIt from 'markdown-it';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const executable = path.join(root, 'apps/agent/bin/atlas-agent.mjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mapBody = (setup, summary) => fs.readFileSync(path.join(setup.atlasRoot, 'maps/architecture/map.md'), 'utf8').split('---').slice(2).join('---').replace(/(^# [^\n]+\n\s*\n)[^\n]+/mu, `$1${summary}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function project(t, fixture = 'valid/cross-map') {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repositoryRoot = path.join(directory, 'project'), atlasRoot = path.join(repositoryRoot, 'atlas'), stateDirectory = path.join(directory, 'state');
  fs.mkdirSync(repositoryRoot);
  if (fixture) fs.cpSync(path.join(root, 'spec/examples', fixture), atlasRoot, { recursive: true });
  return { directory, repositoryRoot, atlasRoot, stateDirectory };
}
function launch(t, setup, extra = []) {
  const child = spawn(process.execPath, [executable, '--repository-root', setup.repositoryRoot, '--atlas', 'atlas', '--state-directory', setup.stateDirectory, ...extra],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
  let sequence = 0, output = '', stderr = '', exited = false;
  const pending = new Map(), received = [];
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
    while (output.includes('\n')) {
      const end = output.indexOf('\n'), line = output.slice(0, end); output = output.slice(end + 1);
      assert.ok(Buffer.byteLength(line) + 1 <= 16 * 1024 * 1024, 'Each complete MCP frame remains within the transport allowance.');
      let message;
      try { message = JSON.parse(line); }
      catch { assert.fail(`Non-protocol stdout: ${line}`); }
      received.push(message);
      const current = pending.get(message.id);
      if (current) { clearTimeout(current.timer); pending.delete(message.id); current.resolve(message); }
    }
  });
  const exit = new Promise((resolve) => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  function request(method, params, selectedId = ++sequence) {
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(selectedId); reject(new Error(`Timed out waiting for ${method}: ${stderr}`)); }, 8000);
      pending.set(selectedId, { resolve, reject, timer });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: selectedId, method, ...(params === undefined ? {} : { params }) })}\n`);
    return promise;
  }
  function notify(method, params) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`); }
  async function close() {
    if (!exited) {
      child.stdin.end();
      const result = await Promise.race([exit, pause(1500).then(() => null)]);
      if (!result) child.kill('SIGKILL');
      await exit;
    }
    for (const current of pending.values()) { clearTimeout(current.timer); current.resolve({ cancelled: true }); }
    pending.clear();
  }
  t.after(close);
  return { child, request, notify, received, get stderr() { return stderr; }, close, exit,
    async initialize(version = '2025-11-25') {
      const response = await request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'independent-stdio-test', version: '1' } });
      assert.equal(response.result.protocolVersion, '2025-11-25');
      notify('notifications/initialized');
      return response.result;
    },
    async call(name, args = {}) {
      const response = await request('tools/call', { name: `atlas_${name}`, arguments: args });
      assert.equal(response.error, undefined, JSON.stringify(response));
      assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
      return { ...response.result, data: response.result.structuredContent.data };
    },
    cancel(requestId) { notify('notifications/cancelled', { requestId, reason: 'Controlled cancellation.' }); },
  };
}
async function readChunks(rpc, name, args, maxBytes = 1024 * 1024) {
  const buffers = [];
  let offset = 0, identity;
  while (true) {
    const result = await rpc.call(name, { ...args, offset, maxBytes, ...(identity ? { expectedSha256: identity.sha256 } : {}) });
    assert.equal(result.isError, false, JSON.stringify(result.data));
    const { chunk } = result.data;
    assert.equal(chunk.offset, offset);
    const current = { byteLength: chunk.byteLength, sha256: chunk.sha256 };
    if (!identity) identity = current;
    assert.deepEqual(current, identity, 'Every chunk identifies the same whole content.');
    const bytes = chunk.encoding === 'utf-8' ? Buffer.from(chunk.text) : Buffer.from(chunk.bytesBase64, 'base64');
    assert.equal(bytes.length, chunk.returnedBytes);
    assert.ok(bytes.length <= maxBytes);
    buffers.push(bytes);
    assert.equal(chunk.complete, chunk.nextOffset === null);
    if (chunk.complete) break;
    assert.equal(chunk.nextOffset, offset + bytes.length);
    assert.ok(chunk.nextOffset > offset);
    offset = chunk.nextOffset;
  }
  const bytes = Buffer.concat(buffers);
  assert.equal(bytes.length, identity.byteLength);
  assert.equal(hash(bytes), identity.sha256);
  return bytes;
}
async function readDetails(rpc, name, args) { return JSON.parse(await readChunks(rpc, name, { ...args, part: 'details' })); }
function addEvaluator(setup, { block = false, evidenceBytes = 0, textEvidence = false } = {}) {
  fs.rmSync(path.join(setup.atlasRoot, '.checks'), { recursive: true, force: true });
  fs.mkdirSync(path.join(setup.atlasRoot, '.checks'));
  const text = '---\n{"type":"check","id":"question-mark","status":"active"}\n---\n\n# Question marks\n\nEnd Map questions with a question mark.\n\n## Requirement\n\nEvery Map question ends with a question mark.\n\n## Verification\n\nInspect the final non-whitespace character of every selected Map question and record its exact text.\n\n## Failure\n\nIdentify each Map whose question lacks the final mark.\n';
  fs.writeFileSync(path.join(setup.atlasRoot, '.checks/question-mark.md'), text);
  const registration = { check: 'question-mark', level: 'required', 'applies-to': ['map'] };
  const catalogPath = path.join(setup.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  catalog.checks = [registration]; fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  const module = path.join(setup.directory, 'evaluator.mjs');
  fs.writeFileSync(module, `import fs from 'node:fs';
export const registrations=[{id:'qualification/question-mark',version:'1',checks:[{id:'question-mark',revision:'${calculateCheckRevision(text, registration)}'}],verify:async({view,subjects})=>{
  console.log('explicit evaluator invoked');
  fs.appendFileSync(${JSON.stringify(path.join(setup.directory, 'invocations'))},'invoked\\n');
  ${block ? 'await new Promise(()=>{});' : ''}
  const observations=subjects.map(subject=>({path:subject.path,question:view.validation.normalized.maps.find(map=>map.id===subject.id).question}));
  const failed=observations.filter(item=>!item.question.trimEnd().endsWith('?'));
  const evidence=${evidenceBytes ? textEvidence ? `'e'.repeat(${evidenceBytes})` : `{summary:'Original binary evidence.',data:Buffer.alloc(${evidenceBytes},165),mediaType:'application/octet-stream'}` : "{summary:'Exact Map questions.',data:JSON.stringify(observations),mediaType:'application/json'}"};
  return {outcome:failed.length?'fail':'pass',summary:failed.length?'Question punctuation failed.':'Question punctuation passed.',evidence:[evidence],diagnostics:failed.map(item=>({path:item.path,message:'Missing final question mark.'}))};
}}];`);
  return module;
}

test('actual stdio initializes, negotiates the pinned version, validates schemas, and keeps progressive guides exact', async (t) => {
  const setup = project(t), rpc = launch(t, setup);
  assert.equal((await rpc.request('tools/list')).error.code, -32002);
  assert.deepEqual((await rpc.request('ping')).result, {});
  const initialized = await rpc.initialize('future-client-version');
  assert.deepEqual(initialized.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(initialized.serverInfo, { name: 'atlas-agent', version: JSON.parse(fs.readFileSync(path.join(root, 'apps/agent/package.json'))).version });
  const listed = (await rpc.request('tools/list')).result.tools;
  assert.equal(listed.length, 18);
  const ajv = new Ajv2020({ strict: true });
  for (const tool of listed) { ajv.compile(tool.inputSchema); ajv.compile(tool.outputSchema); }
  assert.equal(listed.find((tool) => tool.name === 'atlas_apply').annotations.destructiveHint, true);
  assert.equal(listed.find((tool) => tool.name === 'atlas_evaluate').annotations.openWorldHint, true);
  assert.equal(listed.find((tool) => tool.name === 'atlas_prepare').annotations.readOnlyHint, true);
  assert.equal(listed.find((tool) => tool.name === 'atlas_state').annotations.readOnlyHint, true);
  assert.equal(listed.find((tool) => tool.name === 'atlas_refresh').annotations.readOnlyHint, true);
  const findTool = listed.find(tool => tool.name === 'atlas_find');
  assert.deepEqual(findTool.inputSchema.properties.mode.enum, ['ranked', 'fts']);
  assert.match(findTool.description, /ordinary text/);
  assert.match(findTool.description, /SQLite FTS5/);
  const topics = listed.find((tool) => tool.name === 'atlas_guide').inputSchema.properties.topic.enum;
  const parser = new MarkdownIt();
  for (const topic of topics) {
    const guide = (await rpc.call('guide', { topic })).data, owner = guide.source;
    const bytes = fs.readFileSync(path.join(root, 'spec', owner));
    assert.equal(guide.text, bytes.toString('utf8'));
    assert.equal(guide.sha256, hash(bytes));
    assert.deepEqual(guide.sourceOwners.owners[owner], { owner: `spec/${owner}`, sha256: hash(bytes) });
    assert.equal(guide.availableGuides[topic], owner);
    for (const token of parser.parse(guide.text, {}).flatMap((block) => block.children ?? [])) {
      if (token.type !== 'link_open') continue;
      const href = token.attrGet('href');
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(href)) continue;
      const target = path.resolve(root, 'apps/agent/guides', path.dirname(owner), href.split('#')[0]);
      assert.ok(target.startsWith(path.join(root, 'apps/agent/guides/')) && fs.existsSync(target), `Broken installed guide link: ${owner} -> ${href}`);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/agent/guides/source-owners.json')));
  assert.equal(Object.keys(manifest.owners).length, topics.length);
  assert.equal(fs.existsSync(setup.stateDirectory), false);
  assert.equal((await rpc.request('tools/list', { cursor: 'invented' })).error.code, -32602);
  assert.equal((await rpc.request('unknown-method')).error.code, -32601);
  assert.equal((await rpc.request('tools/call', { name: 'unknown-tool' })).error.code, -32602);
  assert.equal((await rpc.call('state', { repositoryRoot: '/forged' })).isError, true);
  assert.equal((await rpc.call('read', { viewId: 'invalid', kind: 'map' })).isError, true);
});

test('captured stdio reads inspect two Points, Resources, raw sources, lexical continuation, and explicit freshness', async (t) => {
  const setup = project(t), rpc = launch(t, setup);
  await rpc.initialize();
  const state = (await rpc.call('state')).data, viewId = state.viewId;
  assert.equal(state.status, 'ready');
  assert.equal(state.maps.length, 2);
  assert.equal(state.validation.normalized, undefined, 'State must be compact.');
  for (const id of ['edge-authentication', 'rotate-edge-keys']) assert.equal((await rpc.call('point', { viewId, id })).data.status, 'found');
  const resource = (await rpc.call('resource', { viewId, id: 'authentication-guide' })).data;
  assert.equal(resource.status, 'found');
  assert.ok(resource.uses.length > 0);
  assert.equal((await rpc.call('source', { viewId, target: { resource: 'authentication-guide' }, maxBytes: 12 })).data.status, 'truncated');
  assert.equal((await rpc.call('source', { viewId, target: { uri: 'https://example.com/never-fetch' } })).data.status, 'unrequested');
  assert.equal((await rpc.call('source', { viewId, target: { uri: '../../outside.md' } })).data.status, 'unrequested');
  const found = (await rpc.call('find', { viewId, query: 'edge', types: ['point'], limit: 1 })).data;
  assert.equal(found.items.length, 1);
  assert.ok(found.nextCursor);
  assert.equal((await rpc.call('find', { viewId, query: 'edge', types: ['point'], limit: 1, cursor: found.nextCursor })).data.items.length, 1);
  const fts = (await rpc.call('find', { viewId, query: '"edge" AND "keys"', mode: 'fts', types: ['point'] })).data;
  assert.ok(fts.items.some(item => item.id === 'rotate-edge-keys'));
  assert.ok(fts.items.every(item => item.matches.some(match => match.path && typeof match.excerpt === 'string')));
  assert.equal((await rpc.call('find', { viewId, query: 'edge', mode: 'fts', types: ['point'], cursor: found.nextCursor })).isError, true);
  assert.equal((await rpc.call('find', { viewId, query: 'edge', mode: 'semantic' })).isError, true);
  fs.writeFileSync(path.join(setup.atlasRoot, 'untracked.md'), 'New source after capture.');
  assert.equal((await rpc.call('freshness', { viewId })).data.status, 'stale');
  assert.equal((await rpc.call('point', { viewId, id: 'edge-authentication' })).data.status, 'found');
  const after = (await rpc.call('refresh')).data;
  const compared = (await rpc.call('compare', { beforeViewId: viewId, afterViewId: after.viewId })).data;
  assert.equal(compared.status, 'compared');
  assert.ok(compared.sourceChanges.some((change) => change.path === 'untracked.md'));
  assert.equal((await rpc.call('find', { viewId: after.viewId, query: 'edge', cursor: found.nextCursor })).isError, true);
  assert.equal(fs.existsSync(setup.stateDirectory), false);
});

test('stdio state, search, refresh, and restart create no persistent reading state', async t => {
  const setup = project(t);
  const inventory = () => fs.readdirSync(setup.repositoryRoot, { recursive: true }).sort().map(file => {
    const full = path.join(setup.repositoryRoot, file);
    return [file, fs.lstatSync(full).isFile() ? hash(fs.readFileSync(full)) : 'directory'];
  });
  const before = inventory(), rpc = launch(t, setup);
  await rpc.initialize();
  const first = (await rpc.call('state')).data;
  assert.deepEqual(Object.keys(first.workspace).sort(), ['atlasPath', 'atlasRoot', 'configuration',
    'configurationDigest', 'configurationSourceDigest', 'repositoryRoot'].sort());
  await rpc.call('find', { viewId: first.viewId, query: 'edge' });
  assert.equal((await rpc.call('refresh')).data.identity.digest, first.identity.digest);
  await rpc.close();
  const restarted = launch(t, setup);
  await restarted.initialize();
  assert.equal((await restarted.call('state')).data.identity.digest, first.identity.digest);
  assert.deepEqual(inventory(), before);
  assert.equal(fs.existsSync(setup.stateDirectory), false);
});

test('agent state remains outside the Atlas, repository tmp, and .git', async t => {
  const setup = project(t);
  for (const relative of ['atlas/state', 'tmp/state', '.git/state']) {
    const stateDirectory = path.join(setup.repositoryRoot, relative);
    const rpc = launch(t, { ...setup, stateDirectory });
    assert.equal((await rpc.exit).code, 2);
    assert.equal(fs.existsSync(stateDirectory), false);
  }
});

test('explicit trusted stdio evaluation retains inspectable evidence across restart without running during reads', async (t) => {
  const setup = project(t), evaluator = addEvaluator(setup), rpc = launch(t, setup, ['--evaluator-module', evaluator]);
  await rpc.initialize();
  const viewId = (await rpc.call('state')).data.viewId;
  const discovered = (await rpc.call('checks', { viewId })).data;
  assert.equal(discovered.items[0].evaluator.id, 'qualification/question-mark');
  await rpc.call('read', { viewId, kind: 'check', id: 'question-mark' });
  assert.equal(fs.existsSync(path.join(setup.directory, 'invocations')), false);
  const evaluated = (await rpc.call('evaluate', { viewId, actor: { kind: 'agent', id: 'stdio/actor' } })).data;
  assert.equal(evaluated.outcome.requiredSatisfied, true);
  assert.equal(evaluated.detailsComplete, false);
  const run = await readDetails(rpc, 'run', { runId: evaluated.runId });
  assert.equal(run.evaluations[0].actor.id, 'stdio/actor');
  assert.equal(fs.existsSync(setup.stateDirectory), false);
  const retained = (await rpc.call('retain', { runId: evaluated.runId })).data;
  assert.ok(retained.reportId);
  const read = (await rpc.call('report', { reportId: retained.reportId, viewId })).data;
  assert.equal(read.integrity, 'verified');
  assert.equal(read.freshness.status, 'fresh');
  assert.equal(fs.readFileSync(path.join(setup.directory, 'invocations'), 'utf8'), 'invoked\n');
  await rpc.close();
  assert.match(rpc.stderr, /explicit evaluator invoked/u);
  const reopened = launch(t, setup);
  await reopened.initialize();
  assert.deepEqual((await reopened.call('reports')).data.reportIds, [retained.reportId]);
  assert.equal((await reopened.call('report', { reportId: retained.reportId })).data.freshness.status, 'unavailable');
  const unsupported = (await reopened.call('evaluate', { viewId: (await reopened.call('state')).data.viewId, actor: { kind: 'tool', id: 'no-registry' } })).data;
  assert.equal(unsupported.outcome.evaluations.unable, 1);
  assert.equal(unsupported.outcome.requiredSatisfied, false);
});

for (const evidenceBytes of [4 * 1024 * 1024, 8 * 1024 * 1024]) {
  test(`${evidenceBytes / 1024 / 1024} MiB completed evidence remains addressable, readable, and retainable without rerunning`, { timeout: 60000 }, async (t) => {
    const setup = project(t), evaluator = addEvaluator(setup, { evidenceBytes });
    const rpc = launch(t, setup, ['--evaluator-module', evaluator]);
    await rpc.initialize();
    const viewId = (await rpc.call('state')).data.viewId;
    const evaluated = await rpc.call('evaluate', { viewId, actor: { kind: 'agent', id: 'large-evidence' } });
    assert.equal(evaluated.isError, false);
    assert.ok(Buffer.byteLength(JSON.stringify(evaluated.data)) < 1024);
    assert.equal(evaluated.data.outcome.requiredSatisfied, true);
    assert.equal(evaluated.data.outcome.complete, true);
    assert.equal(evaluated.data.detailsComplete, false);
    const { runId } = evaluated.data;
    const details = await readDetails(rpc, 'run', { runId });
    const inventory = details.evaluations[0].evidence[0];
    assert.equal(inventory.bytesBase64, undefined);
    assert.equal(inventory.byteLength, evidenceBytes);
    const evidenceArgs = { runId, part: 'evidence', evaluationIndex: 0, evidenceIndex: 0 };
    const first = (await rpc.call('run', { ...evidenceArgs, maxBytes: 19 })).data.chunk;
    assert.equal(first.returnedBytes, 19);
    assert.equal(first.nextOffset, 19);
    assert.equal(first.complete, false);
    const evidence = await readChunks(rpc, 'run', evidenceArgs);
    assert.deepEqual(evidence, Buffer.alloc(evidenceBytes, 165));
    assert.equal(`sha256:${hash(evidence)}`, inventory.sha256);
    for (const args of [{ ...evidenceArgs, evidenceIndex: 1 }, { ...evidenceArgs, offset: evidenceBytes + 1 },
      { ...evidenceArgs, maxBytes: 1024 * 1024 + 1 }, { ...evidenceArgs, expectedSha256: '0'.repeat(64) },
      { runId, part: 'details', evaluationIndex: 0 }, { runId, part: 'evidence' }]) {
      assert.equal((await rpc.call('run', args)).isError, true);
    }
    const end = (await rpc.call('run', { ...evidenceArgs, offset: evidenceBytes })).data.chunk;
    assert.equal(end.returnedBytes, 0);
    assert.equal(end.complete, true);
    const retained = await rpc.call('retain', { runId });
    assert.equal(retained.isError, false);
    assert.ok(Buffer.byteLength(JSON.stringify(retained.data)) < 2048);
    assert.equal((await rpc.call('retain', { runId })).isError, false, 'The same genuine run remains retainable after inspection and retention.');
    const { reportId } = retained.data;
    assert.equal((await rpc.call('report', { reportId, viewId })).data.integrity, 'verified');
    await rpc.close();
    const reopened = launch(t, setup);
    await reopened.initialize();
    const report = (await reopened.call('report', { reportId })).data;
    assert.equal(report.outcome.requiredSatisfied, true);
    assert.equal(report.authenticity, 'not-authenticated');
    assert.equal(report.freshness.status, 'unavailable');
    const retainedDetails = await readDetails(reopened, 'report', { reportId });
    assert.equal(retainedDetails.provenance.run.id, details.id);
    assert.equal(retainedDetails.evidence[0].bytesBase64, undefined);
    assert.equal(retainedDetails.freshness.status, 'unavailable');
    assert.ok(retainedDetails.freshness.reason);
    assert.deepEqual(await readChunks(reopened, 'report', { reportId, part: 'evidence', evaluationIndex: 0, evidenceIndex: 0 }), evidence);
    assert.equal(fs.readFileSync(path.join(setup.directory, 'invocations'), 'utf8'), 'invoked\n');
  });
}

test('large text evidence summaries keep evaluation and successful retention responses compact', { timeout: 60000 }, async (t) => {
  const setup = project(t), evidenceBytes = 4 * 1024 * 1024;
  const rpc = launch(t, setup, ['--evaluator-module', addEvaluator(setup, { evidenceBytes, textEvidence: true })]);
  await rpc.initialize();
  const evaluated = await rpc.call('evaluate', { viewId: (await rpc.call('state')).data.viewId, actor: { kind: 'tool', id: 'text-evidence' } });
  assert.equal(evaluated.isError, false);
  assert.ok(Buffer.byteLength(JSON.stringify(evaluated.data)) < 1024);
  const { runId } = evaluated.data, details = await readDetails(rpc, 'run', { runId });
  assert.equal(details.evaluations[0].evidence[0].summary, 'e'.repeat(evidenceBytes));
  const retained = await rpc.call('retain', { runId });
  assert.equal(retained.isError, false);
  assert.ok(Buffer.byteLength(JSON.stringify(retained.data)) < 2048);
  const { reportId } = retained.data;
  assert.equal((await rpc.call('report', { reportId })).isError, false);
  const report = await readDetails(rpc, 'report', { reportId });
  assert.equal(report.provenance.evidence[0].summary, details.evaluations[0].evidence[0].summary);
  assert.equal(Buffer.byteLength(JSON.stringify(report)) > 16 * 1024 * 1024 / 3, true);
  assert.equal(fs.readFileSync(path.join(setup.directory, 'invocations'), 'utf8'), 'invoked\n');
});

test('large model details preserve escaped text and UTF-8 chunk boundaries independently of compact outcomes', { timeout: 60000 }, async (t) => {
  const setup = project(t), evaluator = addEvaluator(setup);
  const point = path.join(setup.atlasRoot, 'maps/architecture/points/edge-authentication.md');
  const authored = `\n\n${'🙂界 "quoted" \\ slash\n'.repeat(280000)}`;
  fs.appendFileSync(point, authored);
  const rpc = launch(t, setup, ['--evaluator-module', evaluator]);
  await rpc.initialize();
  const state = (await rpc.call('state')).data;
  assert.equal(state.status, 'ready');
  const evaluated = await rpc.call('evaluate', { viewId: state.viewId, actor: { kind: 'human', id: 'model-inspection' } });
  assert.equal(evaluated.isError, false);
  assert.equal(evaluated.data.outcome.requiredSatisfied, true);
  assert.ok(Buffer.byteLength(JSON.stringify(evaluated.data)) < 1024);
  const { runId } = evaluated.data;
  const bytes = await readChunks(rpc, 'run', { runId, part: 'details' });
  assert.ok(bytes.length > 16 * 1024 * 1024 / 3);
  const details = JSON.parse(bytes);
  assert.ok(JSON.stringify(details.validation.normalized).includes(JSON.stringify(authored).slice(1, -1)));
  const offset = bytes.indexOf(Buffer.from('🙂'));
  assert.ok(offset > 0);
  const emoji = (await rpc.call('run', { runId, offset, maxBytes: 5 })).data.chunk;
  assert.equal(emoji.text, '🙂');
  assert.equal(emoji.returnedBytes, 4);
  assert.equal(emoji.nextOffset, offset + 4);
  assert.equal((await rpc.call('run', { runId, offset: offset + 1, maxBytes: 4 })).isError, true);
  const retained = await rpc.call('retain', { runId });
  assert.equal(retained.isError, false);
  assert.equal((await rpc.call('report', { reportId: retained.data.reportId })).data.outcome.requiredSatisfied, true);
  assert.equal(fs.readFileSync(path.join(setup.directory, 'invocations'), 'utf8'), 'invoked\n');
});

test('stdio Check discovery preserves readable policy and unresolved scope during Map repair', async (t) => {
  const setup = project(t), evaluator = addEvaluator(setup), rpc = launch(t, setup, ['--evaluator-module', evaluator]);
  fs.writeFileSync(path.join(setup.atlasRoot, 'maps/operations/map.md'), 'An unfinished Map.\n');
  await rpc.initialize();
  const viewId = (await rpc.call('state')).data.viewId;
  const discovery = (await rpc.call('checks', { viewId })).data;
  assert.equal(discovery.status, 'invalid');
  assert.equal(discovery.complete, true);
  const check = discovery.items.find(item => item.id === 'question-mark');
  assert.equal(check.subjects, null);
  assert.equal(check.applicability.status, 'unresolved');
  assert.ok(check.applicability.reasons.length > 0);
  const document = (await rpc.call('read', { viewId, kind: 'document', path: check.path })).data;
  assert.equal(document.status, 'read');
  assert.match(document.text, /## Verification/u);
  const evaluated = (await rpc.call('evaluate', { viewId, actor: { kind: 'agent', id: 'repair-test' } })).data;
  assert.deepEqual((await readDetails(rpc, 'run', { runId: evaluated.runId })).evaluations, []);
  assert.equal(evaluated.outcome.requiredSatisfied, false);
  assert.equal(evaluated.outcome.wholeAtlasCompliant, false);
  assert.equal(fs.existsSync(path.join(setup.directory, 'invocations')), false);
});

test('stdio preparation returns complete review data and applies only retained reviewed digests with stale refusal', async (t) => {
  const setup = project(t), rpc = launch(t, setup);
  await rpc.initialize();
  let viewId = (await rpc.call('state')).data.viewId;
  const operations = [{ type: 'map', action: 'update', id: 'architecture', body: mapBody(setup, 'Reviewed Map summary.') }];
  const prepared = (await rpc.call('prepare', { viewId, operations })).data;
  assert.equal(prepared.plan.status, 'ready');
  assert.equal(prepared.plan.contract, 'atlas.change-plan/2');
  const change = prepared.plan.changes[0];
  assert.deepEqual(Buffer.from(change.before.bytesBase64, 'base64'), fs.readFileSync(path.join(setup.atlasRoot, change.path)));
  assert.ok(Buffer.from(change.after.bytesBase64, 'base64').toString('utf8').includes('Reviewed Map summary.'));
  assert.match(change.diff, /Reviewed Map summary/u);
  assert.equal(prepared.plan.baseline.files, undefined);
  assert.equal(fs.existsSync(setup.stateDirectory), false);
  assert.equal((await rpc.call('apply', { planId: prepared.planId, reviewedDigest: '0'.repeat(64) })).isError, true);
  fs.writeFileSync(path.join(setup.atlasRoot, 'unexpected.md'), 'Untracked source edit.');
  const stale = await rpc.call('apply', { planId: prepared.planId, reviewedDigest: prepared.plan.digest });
  assert.equal(stale.isError, true);
  assert.equal(stale.data.result.status, 'stale');
  assert.equal(fs.existsSync(setup.stateDirectory), false);
  assert.equal((await rpc.call('apply', { planId: prepared.planId, reviewedDigest: prepared.plan.digest })).data.error.code, 'atlas.agent.expired');
  viewId = (await rpc.call('refresh')).data.viewId;
  const next = (await rpc.call('prepare', { viewId, operations })).data;
  const applied = await rpc.call('apply', { planId: next.planId, reviewedDigest: next.plan.digest });
  assert.equal(applied.isError, false);
  assert.equal(applied.data.result.status, 'applied');
  assert.equal(applied.data.result.recovery.status, 'removed');
  assert.equal(applied.data.result.recoveryDirectory, undefined);
  assert.deepEqual(fs.readdirSync(setup.stateDirectory), []);
  assert.equal((await rpc.call('reports')).isError, false);
  assert.match(fs.readFileSync(path.join(setup.atlasRoot, change.path), 'utf8'), /Reviewed Map summary/u);
});

test('unchanged baseline bytes do not consume the review descriptor transport allowance', async (t) => {
  const setup = project(t);
  const original = Buffer.alloc(5 * 1024 * 1024, 'a');
  fs.writeFileSync(path.join(setup.atlasRoot, 'large-unrelated.txt'), original);
  const rpc = launch(t, setup);
  await rpc.initialize();
  const state = (await rpc.call('state')).data;
  const prepared = await rpc.call('prepare', { viewId: state.viewId, operations: [{ type: 'map', action: 'update', id: 'architecture', body: mapBody(setup, 'Small reviewed update.') }] });
  assert.equal(prepared.isError, false, JSON.stringify(prepared.data));
  assert.equal(prepared.data.plan.status, 'ready');
  assert.equal(prepared.data.plan.changes.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(prepared.data)) < 100000);
  assert.equal((await rpc.call('apply', { planId: prepared.data.planId, reviewedDigest: prepared.data.plan.digest })).data.result.status, 'applied');
  assert.deepEqual(fs.readFileSync(path.join(setup.atlasRoot, 'large-unrelated.txt')), original);
  assert.deepEqual((await rpc.call('reports')).data.reportIds, [], 'The larger sealed recovery plan remains inspectable.');
});

test('fixed durable state never bootstraps a declared local source target or overwrites unowned entries', async (t) => {
  const setup = project(t);
  const file = path.join(setup.atlasRoot, 'catalog.json'), original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('docs/authentication.md', '../../state'));
  const rpc = launch(t, setup);
  await rpc.initialize();
  const operations = [{ type: 'map', action: 'update', id: 'architecture', body: mapBody(setup, 'An explicit candidate.') }];
  const viewId = (await rpc.call('state')).data.viewId;
  const prepared = (await rpc.call('prepare', { viewId, operations })).data;
  assert.equal(prepared.plan.status, 'ready');
  const refused = await rpc.call('apply', { planId: prepared.planId, reviewedDigest: prepared.plan.digest });
  assert.equal(refused.isError, true);
  assert.equal(refused.data.error.code, 'atlas.authoring.invalid-operation');
  assert.equal(fs.existsSync(setup.stateDirectory), false);
  assert.ok(!fs.readFileSync(path.join(setup.atlasRoot, 'maps/architecture/map.md'), 'utf8').includes('An explicit candidate.'));
  fs.writeFileSync(file, original);
  const next = (await rpc.call('prepare', { viewId: (await rpc.call('refresh')).data.viewId, operations })).data;
  fs.mkdirSync(setup.stateDirectory);
  fs.writeFileSync(path.join(setup.stateDirectory, 'keep.txt'), 'Unowned source bytes.');
  assert.equal((await rpc.call('apply', { planId: next.planId, reviewedDigest: next.plan.digest })).isError, true);
  assert.deepEqual(fs.readdirSync(setup.stateDirectory), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(setup.stateDirectory, 'keep.txt'), 'utf8'), 'Unowned source bytes.');
});

test('preparation refuses configuration changed after a selected view and old view ids expire explicitly', async (t) => {
  const setup = project(t), rpc = launch(t, setup);
  await rpc.initialize();
  const viewId = (await rpc.call('state')).data.viewId;
  fs.writeFileSync(path.join(setup.repositoryRoot, 'atlas.workspace.json'), JSON.stringify({ format: 1, atlasPath: 'atlas', configuration: { maxDocumentBytes: 2000000 } }));
  const refused = await rpc.call('prepare', { viewId, operations: [{ type: 'map', action: 'update', id: 'architecture', body: mapBody(setup, 'Changed configuration.') }] });
  assert.equal(refused.isError, true);
  assert.equal(refused.data.error.code, 'atlas.agent.stale');
  for (let index = 0; index < 8; index++) assert.equal((await rpc.call('state')).data.status, 'ready');
  assert.equal((await rpc.call('point', { viewId, id: 'edge-authentication' })).data.error.code, 'atlas.agent.expired');
  assert.equal(fs.existsSync(setup.stateDirectory), false);
});

test('stdio can initialize an absent Atlas and preserves invalid raw draft reading without compliance claims', async (t) => {
  const setup = project(t, null), rpc = launch(t, setup);
  await rpc.initialize();
  assert.equal((await rpc.call('state')).data.atlasMissing, true);
  const plan = (await rpc.call('prepare', { atlasMissing: true, operations: [{ type: 'initialize', fields: { id: 'demo' }, body: '# Demo Atlas\n\nAn explicit initialized project.\n' }] })).data;
  assert.equal(plan.plan.status, 'ready');
  assert.equal(fs.existsSync(setup.atlasRoot), false);
  assert.equal((await rpc.call('apply', { planId: plan.planId, reviewedDigest: plan.plan.digest })).data.result.status, 'applied');
  const state = (await rpc.call('refresh')).data;
  const invalid = (await rpc.call('prepare', { viewId: state.viewId, operations: [{ type: 'repair-document', path: 'atlas.md', text: 'An invalid draft.' }] })).data;
  assert.equal(invalid.plan.status, 'invalid');
  const saved = (await rpc.call('apply', { planId: invalid.planId, reviewedDigest: invalid.plan.digest, mode: 'draft' })).data;
  assert.equal(saved.result.status, 'applied');
  const draft = (await rpc.call('refresh')).data;
  assert.equal(draft.status, 'invalid');
  assert.equal((await rpc.call('read', { viewId: draft.viewId, kind: 'document', path: 'atlas.md' })).data.text, 'An invalid draft.');
  const evaluated = (await rpc.call('evaluate', { viewId: draft.viewId, actor: { kind: 'human', id: 'draft-review' } })).data;
  assert.equal(evaluated.outcome.requiredSatisfied, false);
  assert.deepEqual((await readDetails(rpc, 'run', { runId: evaluated.runId })).evaluations, []);
});

test('cancellation and ping bypass an awaited verifier; excess queued calls are refused and cancelled ids emit no response', async (t) => {
  const setup = project(t), rpc = launch(t, setup, ['--evaluator-module', addEvaluator(setup, { block: true })]);
  await rpc.initialize();
  const viewId = (await rpc.call('state')).data.viewId;
  const active = rpc.request('tools/call', { name: 'atlas_evaluate', arguments: { viewId, actor: { kind: 'tool', id: 'blocked' } } }, 1000);
  for (let attempt = 0; attempt < 50 && !fs.existsSync(path.join(setup.directory, 'invocations')); attempt++) await pause(10);
  assert.equal(fs.existsSync(path.join(setup.directory, 'invocations')), true);
  const queued = Array.from({ length: 31 }, (_, index) => rpc.request('tools/call', { name: 'atlas_point', arguments: { viewId, id: 'edge-authentication' } }, 1001 + index));
  assert.equal((await rpc.request('tools/call', { name: 'atlas_state' }, 1032)).error.code, -32001);
  assert.deepEqual((await rpc.request('ping')).result, {});
  for (let id = 1001; id <= 1031; id++) rpc.cancel(id);
  await rpc.request('ping');
  rpc.cancel(1000);
  await pause(50);
  assert.equal(rpc.received.some((response) => response.id >= 1000 && response.id <= 1031), false);
  assert.equal((await rpc.call('state')).data.status, 'ready');
  await rpc.close();
  await Promise.all([active, ...queued]);
});

test('malformed UTF-8 and oversized frames cannot corrupt the next request or leak source content', async (t) => {
  const setup = project(t), rpc = launch(t, setup);
  await rpc.initialize();
  rpc.child.stdin.write(Buffer.from([0xff, 10]));
  rpc.child.stdin.write(`${'x'.repeat(2 * 1024 * 1024 + 1)}\n`);
  assert.deepEqual((await rpc.request('ping')).result, {});
  assert.equal(rpc.received.filter((message) => message.error?.code === -32700).length, 2);
  assert.equal((await rpc.request('ping', undefined, 1)).error.code, -32600);
  rpc.notify('notifications/unknown', { ignored: true });
  assert.deepEqual((await rpc.request('ping')).result, {});
  assert.equal(rpc.stderr.includes('xxxx'), false);
});
