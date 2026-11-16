import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { discoverProject, chooseAtlas, verifySelection } from '../src/project.mjs';
import { stateHome } from '../../../library/src/state.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
async function project(t) {
  const root = await tempDirectory('atlas-project-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function collection(root, relative) {
  const directory = path.join(root, relative);
  await fs.mkdir(path.join(directory, 'trees/notes/points'), { recursive: true });
  await fs.writeFile(path.join(directory, 'atlas.json'), JSON.stringify({ format: 'atlas/1.2', id: 'example', title: 'Example', trees: ['trees/notes'] }));
  await fs.writeFile(path.join(directory, 'style.md'), '# Example style\n\nOne account.\n');
  await fs.writeFile(path.join(directory, 'trees/notes/tree.json'), JSON.stringify({ id: 'notes', title: 'Notes', scope: 'What the notes are for.', base: 'purpose', children: [] }));
  await fs.writeFile(path.join(directory, 'trees/notes/points/purpose.md'), `---\n${JSON.stringify({ id: 'purpose', sources: [{ uri: '../evidence.md', role: 'evidence' }] })}\n---\n# Notes stay readable offline\n\nA reader can open every note without a connection.\n`);
  return directory;
}
function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return { ...result, value: result.stdout ? JSON.parse(result.stdout) : null, problem: result.stderr ? JSON.parse(result.stderr) : null };
}
async function opened(t, args, cwd, launch = []) {
  const child = spawn(process.execPath, [cli, ...launch, 'open', ...args, '--no-browser'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const page = async address => { const response = await fetch(new URL(address, value.url)); return { status: response.status, text: await response.text() }; };
  return { value, page, async stop() { child.kill('SIGTERM'); assert.equal(await closed, 0, errors); } };
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
  assert.equal(version.value.format, 'atlas.version/1');
  assert.equal(version.value.version, (await fs.readFile(new URL('../../../VERSION', import.meta.url), 'utf8')).trim());
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
  const discovered = run(['locate', root], root);
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.deepEqual([discovered.value.format, discovered.value.project, discovered.value.source, discovered.value.candidates], ['atlas.project/1', root, 'discovery', [{ path: 'context', root: path.join(root, 'context') }]]);
  const explicit = run(['locate', '--atlas', 'context/nested'], root);
  assert.deepEqual([explicit.value.source, explicit.value.candidates[0].path, explicit.value.visited], ['explicit', 'context/nested', undefined]);
  assert.equal(run(['locate', root, '--port', '0'], root).status, 2);
  assert.equal(run(['discover', root], root).status, 2, 'the command is locate; discover is a mode of route');
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

test('opening an empty project serves a page that names the command that creates an Atlas, and writes nothing', async t => {
  const root = await project(t);
  const service = await opened(t, [], root);
  assert.deepEqual(Object.keys(service.value), ['format', 'status', 'url', 'browser', 'project', 'atlasPath', 'create', 'shutdown']);
  assert.equal(service.value.format, 'atlas.server/1');
  assert.equal(service.value.status, 'serving');
  assert.equal(service.value.project, root);
  assert.equal(service.value.atlasPath, '.');
  assert.equal(service.value.create, true);
  assert.equal(service.value.browser, 'not-requested');
  assert.match(service.value.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const home = await service.page('/');
  assert.equal(home.status, 200);
  // The tests keep drafts in a state home of their own, so the command names it: the draft it prepares is one this page reads.
  assert.ok(home.text.includes(`atlas --root ${root} --state-home ${stateHome()} init --id ID --title TITLE --style STYLE`));
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

test('open refuses options it does not have before opening a listener', async t => {
  const root = await project(t);
  for (const args of [['--root', root, 'open', '--export-directory', path.join(root, 'out')], ['--root', root, 'open', '--port'], ['--root', root, 'open', '--port', '70000'], ['--root', root, 'open', '--atlas', 'context'],
    ['open', root, '--export-directory', path.join(root, 'out')], ['open', root, '--editable'], ['open', root, '--port', 'http']]) {
    const result = run(args, root);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.problem.error.code, 'CLI_INVALID_ARGUMENT');
  }
});

test('project opening selects the configured Atlas, serves its Points read-only and grants the project for sources', async t => {
  const root = await project(t);
  await collection(root, 'context');
  await fs.writeFile(path.join(root, 'evidence.md'), 'Project evidence.');
  const service = await opened(t, [root, '--atlas', 'context'], root);
  assert.equal(service.value.atlasPath, 'context');
  assert.equal(service.value.create, false);
  const home = await service.page('/');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes('Notes stay readable offline'));
  const point = await service.page('/purpose/');
  assert.equal(point.status, 200);
  assert.ok(point.text.includes('<h1') && point.text.includes('Notes stay readable offline'));
  assert.ok(point.text.includes('A reader can open every note without a connection.'));
  assert.ok(!point.text.includes('missing'), 'the cited project file is readable under the project grant');
  assert.equal((await service.page('/absent/')).status, 404);
  const refused = await fetch(new URL('/purpose/', service.value.url), { method: 'POST', body: '{}' });
  assert.equal(refused.status, 405);
  await service.stop();
});

test('open with --root serves that Atlas without discovery and stops on SIGTERM', async t => {
  const root = await project(t);
  const atlas = await collection(root, 'deep/context');
  await collection(root, 'other');
  const service = await opened(t, [], root, ['--root', atlas]);
  assert.deepEqual(Object.keys(service.value), ['format', 'status', 'url', 'browser', 'shutdown']);
  assert.equal((await service.page('/purpose/')).status, 200);
  await service.stop();
  await assert.rejects(fetch(service.value.url));
});
