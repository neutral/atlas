#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function inventory(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const filename = path.join(directory, name);
    if (entry.isDirectory()) return inventory(directory, name);
    assert.ok(entry.isFile(), `Unexpected npm package link: ${name}`);
    return [{ path: name, sha256: hash(fs.readFileSync(filename)), mode: fs.statSync(filename).mode & 0o777 }];
  });
}

/** Exercise the installed npm product without importing source workspace modules. */
export async function qualifyNpm(consumer, { fixture, output } = {}) {
  consumer = fs.realpathSync(consumer);
  assert.ok(fixture, 'Supply the publication-profile fixture explicitly.');
  const installed = path.join(consumer, 'node_modules/@neutral/atlas');
  const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@neutral/atlas');
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.scripts, undefined, 'The npm product installs without lifecycle builds.');
  assert.equal(manifest.bin.atlas, 'bin/atlas.mjs');
  assert.ok(!Object.values(manifest.dependencies).some(value => value.startsWith('workspace:')));
  for (const relative of ['src/index.mjs', 'src/index.d.ts', 'schemas/atlas.schema.json', 'guides/OPERATING.md',
    'LICENSE', 'LICENSE.CC0-1.0', 'LICENSE.0BSD', 'apps/editor/public/index.html', 'apps/editor/public/editor.js',
    'apps/portal/prebuilt/render.mjs', 'notices/astro/LICENSE', 'notices/@lucide-astro/LICENSE']) {
    assert.ok(fs.statSync(path.join(installed, relative)).isFile(), `Missing npm runtime file: ${relative}`);
  }
  for (const relative of Object.values(manifest.bin)) assert.ok(fs.statSync(path.join(installed, relative)).mode & 0o111, `Nonexecutable npm bin: ${relative}`);
  const owners = JSON.parse(fs.readFileSync(path.join(installed, 'guides/source-owners.json'), 'utf8'));
  for (const [guide, owner] of Object.entries(owners.owners)) assert.equal(hash(fs.readFileSync(path.join(installed, 'guides', guide))), owner.sha256, guide);
  const before = inventory(installed);
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'Atlas installed npm ')));
  const project = path.join(work, 'Project with spaces'), state = path.join(work, 'Durable state'), cache = path.join(work, 'Cache');
  fs.mkdirSync(project);
  fs.cpSync(fixture, path.join(project, 'atlas'), { recursive: true });
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', npm_config_offline: 'true', npm_config_yes: 'false' };
  delete env.ATLAS_LAUNCHER; delete env.ATLAS_NODE;
  const executable = path.join(consumer, 'node_modules/.bin/atlas');
  const checks = [];
  const record = name => checks.push({ name, passed: true });
  const command = (args, expected = 0) => {
    const result = spawnSync(executable, args, { cwd: work, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const stop = async child => {
    if (child.exitCode !== null) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Installed npm service did not stop.')); }, 5000);
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Installed npm service exit ${code}`)); });
      child.kill('SIGTERM');
    });
  };
  const launch = async (args, pattern) => {
    const child = spawn(executable, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; });
    const text = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Installed npm launch timed out: ${stdout}\n${stderr}`)); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Installed npm launch exited ${code}: ${stdout}\n${stderr}`)); });
      child.stdout.on('data', bytes => { stdout += bytes; const match = stdout.match(pattern); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    return { child, text };
  };
  let running;
  try {
    assert.equal(command(['--version']).trim(), manifest.version);
    assert.match(command(['--help']), /open \[PROJECT\]/u);
    for (const bin of Object.keys(manifest.bin)) {
      const result = spawnSync(path.join(consumer, 'node_modules/.bin', bin), ['--help'], { cwd: work, env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, `${bin}: ${result.stderr}`);
    }
    const npm = spawnSync('npm', ['exec', '--offline', '--', 'atlas', '--version'], { cwd: consumer, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(npm.status, 0, npm.stderr); assert.equal(npm.stdout.trim(), manifest.version);
    const api = spawnSync(process.execPath, ['--input-type=module', '-e', `import {openAtlas} from '@neutral/atlas'; const view=openAtlas(process.argv[1]); if(!view.validation.valid || !view.validation.complete) process.exit(1); console.log(view.identity.digest);`, path.join(project, 'atlas')], { cwd: consumer, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(api.status, 0, api.stderr); assert.ok(api.stdout.trim());
    record('Scoped package imports, all installed bins, offline npm exec, executable modes, guide digests, browser assets and original licenses');

    const empty = path.join(work, 'New project'); fs.mkdirSync(empty);
    assert.match(command(['init', empty]), /Preview only/u); assert.deepEqual(fs.readdirSync(empty), []);
    command(['init', empty, '--apply', '--state-directory', path.join(work, 'Initialization state')]);
    assert.equal(JSON.parse(command(['discover', empty])).selections.length, 1);
    record('Initialization preview preserves the empty project; explicit apply creates a discoverable Atlas');

    const args = ['open', project, '--state-directory', state, '--cache-directory', cache, '--no-browser'];
    running = await launch(args, /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+)/u);
    let url = new URL(running.text);
    const rpc = async (method, params = {}) => {
      const response = await fetch(`${url.origin}/api/${method}`, { method: 'POST', headers: {
        Origin: url.origin, 'X-Atlas-Token': new URLSearchParams(url.hash.slice(1)).get('token'), 'Content-Type': 'application/json',
      }, body: JSON.stringify(params), signal: AbortSignal.timeout(10000) });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.ok, true, JSON.stringify(body)); return body.result;
    };
    for (const asset of ['/', '/editor.js', '/editor.css']) {
      const response = await fetch(new URL(asset, url)); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
    }
    assert.notEqual((await fetch(`${url.origin}/api/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    const initial = await rpc('state'); assert.equal(initial.view.status, 'ready');
    const point = await rpc('read', { viewId: initial.viewId, kind: 'point', id: 'service-boundary' }); assert.equal(point.status, 'found');
    const filename = 'maps/one/points/service-boundary.md';
    const original = fs.readFileSync(path.join(project, 'atlas', filename), 'utf8');
    const draft = await rpc('draft-save', { path: filename, baseViewDigest: initial.view.identity.digest, text: `${original}\nUnfinished installed npm draft.\n` });
    const body = `${point.point.records[0].body}\nReviewed installed npm contribution.\n`;
    const prepared = await rpc('prepare', { baseViewId: initial.viewId, operations: [{ type: 'point', action: 'update', id: 'service-boundary', mapId: 'one', record: 'anchor', body }] });
    assert.equal(prepared.plan.status, 'ready'); assert.match(JSON.stringify(prepared.plan.changes), /Reviewed installed npm contribution/u);
    assert.equal(fs.readFileSync(path.join(project, 'atlas', filename), 'utf8'), original);
    assert.equal((await rpc('apply', { planId: prepared.planId, mode: 'validated' })).result.status, 'applied');
    await stop(running.child); running = undefined;
    running = await launch(args, /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+)/u);
    const previousToken = url.hash; url = new URL(running.text); assert.notEqual(url.hash, previousToken);
    assert.equal((await rpc('draft-list')).drafts.find(item => item.draftId === draft.draftId).text, draft.text);
    await stop(running.child); running = undefined;
    record('Real Editor HTTP assets, token protection, Library reads, prepared edit and explicit save, durable draft and restart');

    const destination = path.join(work, 'Exported site');
    const exportArgs = ['export', project, '--profile', 'public', '--out-dir', destination, '--cache-directory', cache];
    assert.equal(JSON.parse(command(exportArgs)).profile.id, 'public'); assert.equal(fs.existsSync(destination), false);
    running = await launch([...exportArgs, '--apply', '--preview'], /Preview: (http:\/\/127\.0\.0\.1:\d+\/)/u);
    const response = await fetch(running.text); assert.equal(response.status, 200); const html = await response.text();
    assert.match(html, /Fixture Atlas/u);
    assert.match(await (await fetch(new URL('/points/service-boundary/', running.text))).text(), /Reviewed installed npm contribution/u);
    const script = html.match(/src="([^"]*\/_astro\/[^" ]+\.js)"/u)?.[1]; assert.ok(script);
    for (const asset of [script, '/_astro/portal.css']) assert.equal((await fetch(new URL(asset, running.text))).status, 200);
    assert.equal(fs.existsSync(path.join(destination, '.atlas-export-pending')), false);
    await stop(running.child); running = undefined;
    command([...exportArgs, '--apply'], 2);
    record('Publication selection preview, explicit prebuilt static export, real served site and browser assets, existing destination refusal');

    const host = JSON.parse(command(['connect', project, '--state-directory', path.join(work, 'Agent state')])).mcpServers.atlas;
    assert.equal(host.command, process.execPath); assert.equal(host.args[0], path.join(installed, 'bin/atlas.mjs'));
    const child = spawn(host.command, host.args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout }); const pending = new Map(); let next = 0;
    lines.on('line', line => { const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id); });
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => reject(new Error(`Installed npm MCP timeout: ${method}`)), 10000);
      pending.set(id, result => { clearTimeout(timer); resolve(result); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    try {
      assert.ok((await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'installed-npm-qualification', version: '1' } })).result);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      assert.ok((await call('tools/list', {})).result.tools.length);
      const guide = await call('tools/call', { name: 'atlas_guide', arguments: { topic: 'operating' } });
      assert.equal(guide.result.isError, false); assert.match(JSON.stringify(guide), /Working with Atlas/u);
    } finally { child.stdin.end(); child.kill(); lines.close(); }
    record('Generated fixed-root agent configuration runs installed MCP initialize, tools/list and canonical guide');
    assert.deepEqual(inventory(installed), before, 'Installed use must preserve all original package bytes and modes.');
    record('Installed operations preserve every original npm package file and mode');
    const report = { contract: 'atlas.npm-qualification/1', name: manifest.name, version: manifest.version, node: process.version,
      platform: `${process.platform}-${process.arch}`, status: 'passed', packageInventorySHA256: hash(JSON.stringify(before)), checks,
      limitations: ['HTTP and CLI checks do not establish a human browser journey or usefulness.', 'This result covers the recorded host platform and Node runtime.'],
      retainedWorkDirectory: output ? work : null };
    if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
    else fs.rmSync(work, { recursive: true, force: true });
    return report;
  } catch (error) { error.message += `\nRetained installed npm work: ${work}`; throw error; }
  finally { if (running) await stop(running.child); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node distribution/qualify-npm.mjs CONSUMER --fixture PUBLICATION_PROFILE_FIXTURE [--output REPORT.json]');
  const options = {};
  for (let index = 3; index < process.argv.length; index += 2) {
    if (!['--fixture', '--output'].includes(process.argv[index]) || !process.argv[index + 1]) throw new Error('Supply --fixture DIRECTORY and optional --output REPORT.json.');
    options[process.argv[index].slice(2)] = process.argv[index + 1];
  }
  console.log(JSON.stringify(await qualifyNpm(process.argv[2], options), null, 2));
}
