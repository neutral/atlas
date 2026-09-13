import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function qualifyBundle(bundle, { output, node } = {}) {
  bundle = fs.realpathSync(bundle);
  const payload = fs.existsSync(path.join(bundle, 'payload.json'));
  const markerPath = path.join(bundle, payload ? 'payload.json' : 'bundle.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (payload && (!node || !path.isAbsolute(node))) throw new Error('Payload qualification requires --node /absolute/shared/runtime.');
  assert.equal(marker.target, `${process.platform}-${process.arch}`);
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'Atlas installed bundle ')));
  const relocated = path.join(work, 'Relocated Atlas application');
  const archive = `${bundle}.tar.gz`;
  if (!fs.existsSync(archive)) throw new Error(`Qualification requires the adjacent assembled archive: ${archive}`);
  const extracted = spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', work], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  fs.renameSync(path.join(work, path.basename(bundle)), relocated);
  assert.equal(hash(fs.readFileSync(path.join(relocated, path.basename(markerPath)))), hash(fs.readFileSync(markerPath)), 'Archive and assembly directory have the same manifest.');
  const launcher = path.join(relocated, 'bin/atlas');
  const emptyPath = path.join(work, 'empty executable path'); fs.mkdirSync(emptyPath);
  const isolatedHome = path.join(work, 'user home'); fs.mkdirSync(isolatedHome);
  const env = { ...process.env, PATH: emptyPath, HOME: isolatedHome, XDG_DATA_HOME: path.join(isolatedHome, 'data'), NODE_OPTIONS: '--eval=throw new Error("ambient options leaked")', NODE_PATH: '/not-an-atlas-installation' };
  delete env.ATLAS_NODE;
  if (node) env.ATLAS_NODE = node;
  const checks = [];
  const record = name => checks.push({ name, passed: true });
  const command = (args, expected = 0, cwd = work) => {
    const result = spawnSync(launcher, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, expected, `atlas ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const stop = async child => {
    if (child.exitCode !== null) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Service did not stop on SIGTERM.')); }, 5000);
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Service exit ${code}`)); });
      child.kill('SIGTERM');
    });
  };
  const launch = async (args, pattern) => {
    const child = spawn(launcher, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; });
    const text = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Launch timed out: ${stderr}\n${stdout}`)); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Launch exited ${code}: ${stderr}\n${stdout}`)); });
      child.stdout.on('data', bytes => { stdout += bytes; const match = stdout.match(pattern); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    return { child, text };
  };
  let running;
  try {
    assert.match(command(['--help']), /open \[PROJECT\]/u);
    assert.equal(command(['--version']).trim(), marker.version);
    assert.equal(fs.existsSync(path.join(relocated, 'runtime/bin/npm')), false);
    record(`Relocated archive with spaces runs help/version using ${payload ? 'explicit shared' : 'bundled'} Node with Node/npm/pnpm absent from PATH and ambient Node settings cleared`);
    const project = path.join(work, 'Project with spaces'); fs.mkdirSync(project);
    assert.deepEqual(JSON.parse(command(['discover'], 0, project)).selections, []);
    command(['open', path.join(work, 'missing project'), '--no-browser'], 2);
    assert.match(command(['init', project]), /Preview only/u);
    assert.deepEqual(fs.readdirSync(project), []);
    command(['init', project, '--apply']);
    assert.ok(fs.existsSync(path.join(project, 'atlas/atlas.md')));
    assert.equal(JSON.parse(command(['discover', project])).selections.length, 1);
    fs.cpSync(path.join(project, 'atlas'), path.join(project, 'second'), { recursive: true });
    assert.match(command(['open', project, '--no-browser'], 2), /^$/u);
    assert.equal(JSON.parse(command(['discover', project])).selections.length, 2);
    record('Default directory discovery, missing project refusal, initialization preview without writes, explicit initialization, and ambiguous selection refusal');
    const authored = path.join(work, 'Editing project'); fs.mkdirSync(authored);
    fs.cpSync(path.join(repository, 'spec/examples/valid/publication-profile'), path.join(authored, 'atlas'), { recursive: true });
    const state = path.join(work, 'Durable editor state');
    const editorArgs = ['open', authored, '--state-directory', state, '--cache-directory', path.join(work, 'Disposable cache'), '--no-browser'];
    running = await launch(editorArgs, /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+)/u);
    let url = new URL(running.text);
    const rpc = async (method, params = {}) => {
      const response = await fetch(`${url.origin}/api/${method}`, { method: 'POST', headers: { Origin: url.origin, 'X-Atlas-Token': new URLSearchParams(url.hash.slice(1)).get('token'), 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.ok, true, JSON.stringify(body)); return body.result;
    };
    const shell = await fetch(url.origin); assert.equal(shell.status, 200); assert.match(await shell.text(), /Atlas/u);
    const denied = await fetch(`${url.origin}/api/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.notEqual(denied.status, 200);
    const first = await rpc('state'); assert.equal(first.view.status, 'ready');
    const point = await rpc('read', { viewId: first.viewId, kind: 'point', id: 'service-boundary' }); assert.equal(point.status, 'found');
    const filename = 'maps/one/points/service-boundary.md';
    const original = fs.readFileSync(path.join(authored, 'atlas', filename), 'utf8');
    const draft = await rpc('draft-save', { path: filename, baseViewDigest: first.view.identity.digest, text: `${original}\nUnfinished native bundle draft.\n` });
    const body = `${point.point.records[0].body}\nReviewed native bundle contribution.\n`;
    const prepared = await rpc('prepare', { baseViewId: first.viewId, operations: [{ type: 'point', action: 'update', id: 'service-boundary', mapId: 'one', record: 'anchor', body }] });
    assert.equal(prepared.plan.status, 'ready'); assert.match(JSON.stringify(prepared.plan.changes), /Reviewed native bundle contribution/u);
    assert.equal(fs.readFileSync(path.join(authored, 'atlas', filename), 'utf8'), original);
    const applied = await rpc('apply', { planId: prepared.planId, mode: 'validated' }); assert.equal(applied.result.status, 'applied'); assert.equal(applied.result.recovery.status, 'removed');
    const stale = await rpc('prepare', { baseViewId: applied.state.viewId, operations: [{ type: 'point', action: 'update', id: 'service-boundary', mapId: 'one', record: 'anchor', body: `${body}\nNever overwrite an external change.\n` }] });
    fs.appendFileSync(path.join(authored, 'atlas', filename), '\nExternal contribution.\n');
    const external = fs.readFileSync(path.join(authored, 'atlas', filename), 'utf8');
    assert.equal((await rpc('apply', { planId: stale.planId, mode: 'validated' })).result.status, 'stale');
    assert.equal(fs.readFileSync(path.join(authored, 'atlas', filename), 'utf8'), external);
    await stop(running.child); running = undefined;
    running = await launch(editorArgs, /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+)/u);
    const oldToken = url.hash; url = new URL(running.text); assert.notEqual(url.hash, oldToken);
    assert.equal((await rpc('draft-list')).drafts.find(item => item.draftId === draft.draftId).text, draft.text);
    await stop(running.child); running = undefined;
    record('Real loopback Editor assets and authentication, exact read, durable draft, prepare/diff without writes, explicit apply and cleanup, stale refusal, restart with new launch token and original draft');
    const destination = path.join(work, 'Exported static site');
    const exportArgs = ['export', authored, '--profile', 'public', '--out-dir', destination, '--cache-directory', path.join(work, 'Disposable cache')];
    const preview = JSON.parse(command(exportArgs)); assert.equal(preview.profile.id, 'public'); assert.equal(fs.existsSync(destination), false);
    running = await launch([...exportArgs, '--apply', '--preview'], /Preview: (http:\/\/127\.0\.0\.1:\d+\/)/u);
    const site = await fetch(running.text); assert.equal(site.status, 200); const html = await site.text(); assert.match(html, /Fixture Atlas/u);
    const publishedPoint = await fetch(new URL('/points/service-boundary/', running.text));
    assert.equal(publishedPoint.status, 200); assert.match(await publishedPoint.text(), /Reviewed native bundle contribution/u);
    const script = html.match(/src="([^"]*\/_astro\/[^" ]+\.js)"/u)?.[1]; assert.ok(script, 'Prebuilt Portal browser script is present.'); assert.equal((await fetch(new URL(script, running.text))).status, 200);
    assert.equal((await fetch(new URL('/_astro/portal.css', running.text))).status, 200);
    assert.equal(fs.existsSync(path.join(destination, '.atlas-export-pending')), false);
    await stop(running.child); running = undefined;
    command([...exportArgs, '--apply'], 2);
    record('Publication selection preview without writes, explicit prebuilt static export outside install, real loopback preview and browser assets, existing destination refusal');
    const config = JSON.parse(command(['connect', authored]));
    const host = config.mcpServers.atlas; assert.equal(host.command, launcher); assert.ok(host.args.includes('mcp'));
    const child = spawn(host.command, host.args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map(); let next = 0, protocolOutput = '';
    child.stdout.on('data', bytes => { protocolOutput += bytes; });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => { const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id); });
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 10000);
      pending.set(id, result => { clearTimeout(timer); resolve(result); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    try {
      assert.ok((await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'installed-bundle-qualification', version: '1' } })).result);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      const guide = await call('tools/call', { name: 'atlas_guide', arguments: { topic: 'operating' } }); assert.equal(guide.result.isError, false); assert.match(JSON.stringify(guide), /Working with Atlas/u);
      assert.ok((await call('tools/list', {})).result.tools.length > 0);
      for (const line of protocolOutput.trim().split('\n')) assert.equal(JSON.parse(line).jsonrpc, '2.0');
    } finally { child.stdin.end(); child.kill(); lines.close(); }
    record('Generated agent configuration selects relocated executable and fixed roots; real MCP initialize, tools/list and guide tool; stdout remains JSON-RPC');
    if (!payload) {
    const prefix = path.join(work, 'Installed versions'), bin = path.join(work, 'User commands');
    const installed = spawnSync(path.join(relocated, 'install.sh'), ['--prefix', prefix, '--bin-directory', bin], { env, encoding: 'utf8' }); assert.equal(installed.status, 0, installed.stderr);
    const linked = spawnSync(path.join(bin, 'atlas'), ['--version'], { env, encoding: 'utf8' }); assert.equal(linked.status, 0, linked.stderr); assert.equal(linked.stdout.trim(), marker.version);
    const linkedConfig = spawnSync(path.join(bin, 'atlas'), ['connect', authored], { env, encoding: 'utf8' });
    assert.equal(linkedConfig.status, 0, linkedConfig.stderr); assert.equal(JSON.parse(linkedConfig.stdout).mcpServers.atlas.command, path.join(bin, 'atlas'));
    assert.equal(spawnSync(path.join(relocated, 'install.sh'), ['--prefix', prefix, '--bin-directory', bin], { env, encoding: 'utf8' }).status, 0);
    const removed = spawnSync(path.join(prefix, `atlas-${marker.version}-${marker.target}/uninstall.sh`), ['--prefix', prefix, '--bin-directory', bin], { env, encoding: 'utf8' }); assert.equal(removed.status, 0, removed.stderr);
    assert.equal(fs.existsSync(path.join(bin, 'atlas')), false); assert.equal(fs.readFileSync(path.join(authored, 'atlas', filename), 'utf8'), external); assert.ok(fs.existsSync(path.join(state, 'drafts', `${draft.draftId}.json`)));
    record('Real per-user install, symlink launcher, exact-version reselection, uninstall preserve authored content and durable drafts');
    } else {
      assert.equal(fs.existsSync(path.join(relocated, 'runtime')), false);
      assert.equal(fs.existsSync(path.join(relocated, 'install.sh')), false);
      record('Runtime-free application payload executes the same product with an explicitly selected shared runtime and no installer');
    }
    for (const entry of marker.contents) {
      const filename = path.join(relocated, entry.path);
      if (entry.link) assert.equal(fs.readlinkSync(filename), entry.link);
      else assert.equal(hash(fs.readFileSync(filename)), entry.sha256, `Installed operation changed bundle content: ${entry.path}`);
    }
    record('Installed operations preserve every original bundle file and relative link');
    const report = { contract: 'atlas.bundle-qualification/1', version: marker.version, target: marker.target, product: payload ? 'payload' : 'native-bundle', applicationSHA256: marker.applicationSHA256, archiveSHA256: hash(fs.readFileSync(archive)), node: node ? spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim() : marker.node.version, bundleManifestSHA256: hash(fs.readFileSync(markerPath)), status: 'passed', checks,
      limitations: ['Mechanical HTTP and CLI observations do not establish a human browser journey or usefulness.', 'Other platforms require their own executed native CI artifact.', 'Interrupted-write fault injection is qualified separately.'], retainedWorkDirectory: output ? work : null };
    if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
    else fs.rmSync(work, { recursive: true, force: true });
    return report;
  } catch (error) { error.message += `\nRetained installed bundle work: ${work}`; throw error; }
  finally { if (running) await stop(running.child); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node distribution/bundle/qualify.mjs BUNDLE_OR_PAYLOAD_DIRECTORY [--output REPORT.json] [--node ABSOLUTE_RUNTIME]');
  const options = {};
  for (let index = 3; index < process.argv.length; index += 2) {
    if (!['--output', '--node'].includes(process.argv[index]) || !process.argv[index + 1]) throw new Error('Expected --output REPORT.json or --node ABSOLUTE_RUNTIME.');
    options[process.argv[index].slice(2)] = process.argv[index + 1];
  }
  console.log(JSON.stringify(await qualifyBundle(process.argv[2], options), null, 2));
}
