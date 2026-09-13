import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function until(operation, explanation, log) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if (await operation()) return; } catch { /* Startup and rebuild may briefly be unavailable. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${explanation}\n${log()}`);
}

test('real Portal dev refresh replaces source and Resource content and exposes invalidation', { timeout: 70000 }, async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'Atlas live refresh ')));
  const atlas = path.join(directory, 'Atlas source');
  fs.cpSync(fileURLToPath(new URL('../../../spec/examples/valid/publication-profile', import.meta.url)), atlas, { recursive: true });
  const config = path.join(directory, 'portal.json'); fs.writeFileSync(config, JSON.stringify({ name: 'Refresh test' }));
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli/index.mjs', import.meta.url)), 'dev', '--atlas', atlas, '--profile', 'public', '--portal-config', config, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4000).unref(); }); }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  await until(async () => (await fetch(origin)).status === 200, 'Portal did not start.', () => log);
  const rootFile = path.join(atlas, 'atlas.md'), original = fs.readFileSync(rootFile, 'utf8');
  fs.writeFileSync(rootFile, original.replace('Executable Atlas format 2 fixture.', 'A verified refresh marker appears here.'));
  await until(async () => (await (await fetch(origin)).text()).includes('A verified refresh marker appears here.'), 'Root source did not refresh.', () => log);
  const resource = path.join(atlas, 'docs/overview.md');
  fs.appendFileSync(resource, '\nA verified Resource refresh marker.\n');
  await until(async () => (await (await fetch(`${origin}/resources/overview/`)).text()).includes('A verified Resource refresh marker.'), 'Resource source did not refresh.', () => log);
  fs.writeFileSync(rootFile, 'Invalid Atlas source');
  await until(async () => (await fetch(origin)).status !== 200, 'Invalid source kept serving successful stale content.', () => log);
  fs.writeFileSync(rootFile, original);
  await until(async () => { const response = await fetch(origin); return response.status === 200 && !(await response.text()).includes('A verified refresh marker appears here.'); }, 'Valid source did not recover after invalidation.', () => log);
  assert.match(log, /Atlas Portal refreshed/u);
  assert.match(log, /Atlas Portal refresh failed/u);
});
