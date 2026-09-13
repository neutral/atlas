import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverProject, managedState, prepareCache, userDataRoot } from '../src/project.mjs';
import { agentConfiguration, containerAgentConfiguration } from '../src/atlas-cli.mjs';

const cli = fileURLToPath(new URL('../bin/atlas.mjs', import.meta.url));
function project(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas command spaces ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const invoke = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('one namespace exposes version/help and delegates existing commands', () => {
  assert.equal(invoke(['--version']).stdout.trim(), '0.9.0');
  for (const command of ['open', 'discover', 'init', 'connect', 'mcp', 'read', 'validate', 'workspace', 'author', 'inspect']) {
    const result = invoke([command, '--help']);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.ok(result.stdout.length + result.stderr.length > 0);
  }
  assert.equal(invoke(['unknown']).status, 2);
});

test('discovery honors workspace, explicit selections, nested boundaries and excludes generated paths', t => {
  const root = project(t);
  for (const relative of ['collections/one', 'collections/two', 'node_modules/hidden', 'collections/one/nested']) {
    fs.mkdirSync(path.join(root, relative), { recursive: true });
    fs.writeFileSync(path.join(root, relative, 'atlas.md'), '# Invalid Atlas remains discoverable\n');
  }
  assert.deepEqual(discoverProject(root).selections.map(item => item.atlasPath), ['collections/one', 'collections/two']);
  const ambiguous = invoke(['open', root, '--no-browser']);
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.stderr, /collections\/one/);
  assert.match(ambiguous.stderr, /collections\/two/);
  fs.writeFileSync(path.join(root, 'atlas.workspace.json'), JSON.stringify({ format: 1, atlasPath: 'collections/two' }));
  assert.equal(discoverProject(root).selections[0].atlasPath, 'collections/two');
  assert.equal(discoverProject(root, 'collections/one').selections[0].atlasPath, 'collections/one');
  fs.writeFileSync(path.join(root, 'atlas.workspace.json'), JSON.stringify({ format: 1, atlasPath: 'missing' }));
  assert.equal(discoverProject(root).selections[0].atlasPath, 'missing');
  fs.writeFileSync(path.join(root, 'atlas.workspace.json'), '{"format":99}');
  assert.throws(() => discoverProject(root, 'collections/one'), /configuration/);
});

test('discovery and missing input leave files unchanged; exact paths reject symlinks and aliases', t => {
  const root = project(t);
  assert.deepEqual(discoverProject(root).selections, []);
  assert.equal(invoke(['discover'], root).status, 0);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(invoke(['open', path.join(root, 'missing')]).status, 2);
  fs.mkdirSync(path.join(root, 'Collection'));
  fs.symlinkSync('Collection', path.join(root, 'linked'));
  for (const selection of ['../elsewhere', './Collection', 'collection', 'linked']) assert.throws(() => discoverProject(root, selection));
});

test('discovery orders non-BMP collection paths by Unicode code point', t => {
  const root = project(t);
  for (const name of ['😀', '\uE000']) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'atlas.md'), 'A discoverable draft.\n');
  }
  assert.deepEqual(discoverProject(root).selections.map(item => item.atlasPath), ['\uE000', '😀']);
});

test('initialization previews exact files before explicit apply and rejects an existing Atlas', t => {
  const root = project(t), state = path.join(root, 'state');
  const args = ['init', root, '--id', 'demo', '--title', 'Demo Atlas', '--state-directory', state];
  const preview = invoke(args);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /catalog.json/);
  assert.match(preview.stdout, /connections.json/);
  assert.match(preview.stdout, /Demo Atlas/);
  assert.deepEqual(fs.readdirSync(root), []);
  const applied = invoke([...args, '--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(fs.readFileSync(path.join(root, 'atlas/atlas.md'), 'utf8'), /Demo Atlas/);
  assert.equal(invoke(['validate', path.join(root, 'atlas')]).status, 0);
  assert.equal(invoke([...args, '--apply']).status, 2);
});

test('managed roots are canonical selection-specific durable data, separate by adapter', t => {
  const root = project(t), selection = { repositoryRoot: root, atlasPath: 'atlas' };
  const options = { platform: 'darwin', home: root, env: {} };
  assert.match(managedState(selection, 'editor', options), /Library\/Application Support\/Atlas\/projects\/[a-f0-9]{64}\/editor$/);
  assert.notEqual(managedState(selection, 'editor', options), managedState(selection, 'agent', options));
  assert.notEqual(managedState(selection, 'editor', options), managedState({ ...selection, atlasPath: 'another' }, 'editor', options));
  assert.equal(userDataRoot({ platform: 'linux', env: { XDG_DATA_HOME: '/var/data' }, home: root }), '/var/data/atlas');
  const config = agentConfiguration(selection, { stateDirectory: path.join(root, 'agent state') });
  assert.ok(path.isAbsolute(config.mcpServers.atlas.command));
  assert.ok(config.mcpServers.atlas.args.includes(root));
  assert.ok(config.mcpServers.atlas.args.includes(path.join(root, 'agent state')));
  assert.deepEqual(fs.readdirSync(root), []);
});

test('container host configuration preserves exact container paths without contacting the container or editing settings', () => {
  const flags = { '--container': 'atlas-integration', '--repository-root': '/project with spaces', '--atlas': 'atlas', '--state-directory': '/state/agent' };
  const config = containerAgentConfiguration(flags);
  assert.deepEqual(config.mcpServers.atlas, { command: 'docker', args: ['exec', '-i', '--env', 'ATLAS_NODE=/usr/local/bin/node', 'atlas-integration', '/opt/atlas/bin/atlas', 'mcp', '--repository-root', '/project with spaces', '--atlas', 'atlas', '--state-directory', '/state/agent'] });
  assert.throws(() => containerAgentConfiguration({ ...flags, '--state-directory': '/project with spaces/atlas/state' }));
  assert.throws(() => containerAgentConfiguration({ ...flags, '--container': '--privileged' }));
  const command = invoke(['connect', ...Object.entries(flags).flat()]);
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout), config);
});

test('launch refuses overlapping disposable cache, durable drafts, and export destinations before creating storage', t => {
  const root = project(t), selected = path.join(root, 'project'), state = path.join(root, 'state');
  fs.mkdirSync(selected);
  for (const cache of [state, path.join(state, 'cache'), root]) {
    const result = invoke(['open', selected, '--state-directory', state, '--cache-directory', cache, '--no-browser']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /separate/);
    assert.equal(fs.existsSync(state), false);
  }
  const result = invoke(['open', selected, '--state-directory', state, '--export-dir', path.join(state, 'site'), '--cache-directory', path.join(root, 'cache'), '--no-browser']);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(state), false);
  assert.equal(fs.existsSync(path.join(root, 'cache')), false);
});

test('incomplete source defers cache creation so opening recovery does not bootstrap an unknown source target', t => {
  const root = project(t), repositoryRoot = path.join(root, 'project'), cache = path.join(root, 'cache');
  fs.mkdirSync(repositoryRoot);
  assert.equal(invoke(['init', repositoryRoot, '--apply', '--state-directory', path.join(root, 'initial-state')]).status, 0);
  const atlasRoot = path.join(repositoryRoot, 'atlas'), read = fs.readFileSync;
  const previous = process.env.TMPDIR;
  t.after(() => { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; });
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    if (file === path.join(atlasRoot, 'atlas.md')) throw Object.assign(new Error('Controlled unreadable source'), { code: 'EACCES' });
    return read.call(fs, file, ...args);
  });
  assert.equal(prepareCache({ repositoryRoot, atlasPath: 'atlas', atlasRoot }, cache), cache);
  assert.equal(fs.existsSync(cache), false);
});
