import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { discoverProject, chooseAtlas, verifySelection } from '../src/project.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
async function project(t) {
  const root = await tempDirectory('atlas-project-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function collection(root, relative) {
  const directory = path.join(root, relative);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'atlas.json'), JSON.stringify({ format: 'atlas/1', id: 'example', title: 'Example', trees: [] }));
  return directory;
}
function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return { ...result, value: result.stdout ? JSON.parse(result.stdout) : null, problem: result.stderr ? JSON.parse(result.stderr) : null };
}
async function opened(t, args, cwd) {
  const child = spawn(process.execPath, [cli, 'open', ...args, '--no-browser'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { child.kill('SIGTERM'); await closed; });
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Open timed out: ${errors}`)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Open exited ${code}: ${errors}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      try { const parsed = JSON.parse(output); clearTimeout(timer); resolve(parsed); } catch { /* Wait for the complete JSON result. */ }
    });
  });
  return { value, async stop() { child.kill('SIGTERM'); assert.equal(await closed, 0, errors); } };
}

test('top-level help and version work without a project or Atlas', async t => {
  const root = await project(t);
  for (const args of [[], ['--help'], ['help']]) {
    const result = run(args, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.value.usage, /atlas open/);
  }
  const version = run(['--version'], root);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.value.version, '1.1.0');
  assert.deepEqual(await fs.readdir(root), []);
});

test('discovery stops at Atlas boundaries, skips generated directories and never follows symlinks', async t => {
  const root = await project(t);
  await collection(root, 'context');
  await collection(root, 'context/nested');
  await collection(root, 'node_modules/hidden');
  await collection(root, 'tmp/hidden');
  await fs.symlink(path.join(root, 'context'), path.join(root, 'alias'));
  const found = await discoverProject(root);
  assert.deepEqual(found.candidates.map(item => item.path), ['context']);
  assert.equal((await chooseAtlas(found)).root, path.join(root, 'context'));
  assert.equal((await discoverProject(root, { atlasPath: 'context/nested' })).candidates[0].path, 'context/nested');
});

test('ambiguous discovery requires a choice and incomplete discovery never implies a unique Atlas', async t => {
  const root = await project(t);
  await collection(root, 'a'); await collection(root, 'b');
  await assert.rejects(chooseAtlas(await discoverProject(root), { input: { isTTY: false }, output: { isTTY: false } }), { code: 'PROJECT_AMBIGUOUS' });
  const result = run(['open', root, '--no-browser'], root);
  assert.equal(result.status, 2);
  assert.equal(result.problem.error.code, 'PROJECT_AMBIGUOUS');
  await assert.rejects(discoverProject(root, { maxEntries: 1 }), { code: 'PROJECT_DISCOVERY_LIMIT' });
  await assert.rejects(discoverProject(root, { maxDepth: 0 }), { code: 'PROJECT_DISCOVERY_LIMIT' });
});

test('workspace selection is exact, contained and validated even with an explicit override', async t => {
  const root = await project(t);
  await collection(root, 'first'); await collection(root, 'second');
  const file = path.join(root, 'atlas.workspace.json');
  await fs.writeFile(file, JSON.stringify({ format: 1, atlasPath: 'second' }));
  assert.equal((await discoverProject(root)).candidates[0].path, 'second');
  assert.equal((await discoverProject(root, { atlasPath: 'first' })).candidates[0].path, 'first');
  for (const atlasPath of ['../outside', '/absolute', './first', 'first/../second', 'FIRST', 'first\\child']) {
    await assert.rejects(discoverProject(root, { atlasPath }), { code: 'PROJECT_INVALID' });
  }
  await fs.symlink(path.join(root, 'first'), path.join(root, 'alias'));
  await assert.rejects(discoverProject(root, { atlasPath: 'alias' }), { code: 'PROJECT_INVALID' });
  await fs.writeFile(file, '{broken');
  await assert.rejects(discoverProject(root, { atlasPath: 'first' }), { code: 'PROJECT_INVALID' });
});

test('opening an empty project offers initialization without writing authored files', async t => {
  const root = await project(t);
  const service = await opened(t, [], root);
  assert.equal(service.value.project, root);
  assert.equal(service.value.atlasPath, '.');
  assert.equal(service.value.create, true);
  assert.equal(service.value.browser, 'not-requested');
  const url = new URL(service.value.url), token = new URLSearchParams(url.hash.slice(1)).get('token');
  const response = await fetch(new URL('/api/view', url), { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'invalid');
  await service.stop();
  assert.deepEqual(await fs.readdir(root), []);
});

test('a choice refuses replaced directories or changed workspace selection', async t => {
  const parent = await project(t);
  const root = path.join(parent, 'selected');
  await collection(root, 'context');
  const replacement = path.join(parent, 'replacement');
  await collection(replacement, 'context');
  const found = await discoverProject(root), selected = await chooseAtlas(found);
  await fs.rename(root, path.join(parent, 'original'));
  await fs.symlink(replacement, root);
  await assert.rejects(verifySelection(found, selected), { code: 'PROJECT_CHANGED' });

  const current = await discoverProject(replacement), choice = await chooseAtlas(current);
  await fs.rename(choice.root, path.join(replacement, 'previous'));
  await collection(replacement, 'context');
  await assert.rejects(verifySelection(current, choice), { code: 'PROJECT_CHANGED' });

  const configured = await discoverProject(replacement, { atlasPath: 'context' });
  await fs.writeFile(path.join(replacement, 'atlas.workspace.json'), JSON.stringify({ format: 1, atlasPath: 'previous' }));
  await assert.rejects(verifySelection(configured, configured.candidates[0]), { code: 'PROJECT_CHANGED' });
});

test('service options reject a missing export path before opening a listener', async t => {
  const root = await project(t);
  const result = run(['--root', root, 'editor', '--export-directory', '--port'], root);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.problem.error.code, 'CLI_INVALID_ARGUMENT');
});

test('project opening selects the configured Atlas and fixes source access to that project', async t => {
  const root = await project(t);
  await collection(root, 'context');
  await fs.writeFile(path.join(root, 'evidence.md'), 'Project evidence.');
  const service = await opened(t, [root, '--atlas', 'context'], root);
  assert.equal(service.value.atlasPath, 'context');
  const url = new URL(service.value.url), token = new URLSearchParams(url.hash.slice(1)).get('token');
  const response = await fetch(new URL('/api/source', url), { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: url.origin, 'content-type': 'application/json' }, body: JSON.stringify({ source: { uri: '../evidence.md', role: 'evidence' } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, 'Project evidence.');
  await service.stop();
});
