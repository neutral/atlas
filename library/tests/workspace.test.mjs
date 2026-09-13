import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AtlasToolError, openAtlas, openWorkspace } from '../src/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const anchorPath = 'maps/architecture/points/edge-authentication.md';

function project(t, { rootAtlas = false } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-workspace-test-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repositoryRoot = path.join(directory, 'project');
  const atlasRoot = rootAtlas ? repositoryRoot : path.join(repositoryRoot, 'atlas');
  fs.cpSync(path.join(root, 'spec/examples/valid/cross-map'), atlasRoot, { recursive: true });
  return { directory, repositoryRoot, atlasRoot };
}
function options(p, overrides = {}) {
  return { repositoryRoot: p.repositoryRoot, atlasPath: path.relative(p.repositoryRoot, p.atlasRoot) || '.', ...overrides };
}
function open(t, selected) {
  const workspace = openWorkspace(selected);
  t.after(() => workspace.close());
  return workspace;
}
function replaceFile(atlasRoot, relative, from, to) {
  const file = path.join(atlasRoot, relative), source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes(from), `Missing replacement text in ${relative}`);
  fs.writeFileSync(file, source.replace(from, to));
}
function meaning(view) {
  return { status: view.status, validation: view.validation.toJSON(),
    points: ['edge-authentication', 'rotate-edge-keys'].map((id) => view.inspectPoint(id)),
    search: view.find('edge', { types: ['point'] }).items, raw: view.readDocument(anchorPath) };
}
function toolError(code) { return (error) => error instanceof AtlasToolError && error.code === code; }
function tree(directory) {
  return fs.readdirSync(directory).sort().flatMap((name) => {
    const file = path.join(directory, name);
    return fs.statSync(file).isDirectory() ? [[name, 'directory'], ...tree(file).map(([entry, bytes]) => [`${name}/${entry}`, bytes])]
      : [[name, fs.readFileSync(file).toString('base64')]];
  });
}

test('direct, reused, refreshed, and reopened observations preserve exact public meaning', (t) => {
  const p = project(t), workspace = open(t, options(p)), first = workspace.read();
  assert.deepEqual(Object.keys(first).sort(), ['contract', 'freshness', 'view']);
  assert.equal(first.contract, 'atlas.workspace-view/2');
  assert.equal(first.view.contract, 'atlas.read-view/2');
  assert.equal(first.view.status, 'ready');
  assert.equal(first.freshness.status, 'fresh');
  assert.ok(Object.isFrozen(first));
  const expected = meaning(first.view), direct = openAtlas(p.atlasRoot);
  assert.deepEqual(meaning(direct), expected);
  assert.deepEqual(direct.identity, first.view.identity);
  assert.strictEqual(workspace.read().view, first.view);
  const refreshed = workspace.refresh();
  assert.notStrictEqual(refreshed.view, first.view);
  assert.deepEqual(meaning(refreshed.view), expected);
  assert.deepEqual(first.view.compare(refreshed.view).sourceChanges, []);
  workspace.close();
  const reopened = open(t, options(p)).read();
  assert.notStrictEqual(reopened.view, first.view);
  assert.deepEqual(meaning(reopened.view), expected);
  assert.deepEqual(reopened.view.identity, first.view.identity);
});

test('reuse rehashes source bytes without parsing structural files again', (t) => {
  const p = project(t), workspace = open(t, options(p)), first = workspace.read();
  const readFile = fs.readFileSync, read = fs.readSync;
  let rehashed = 0;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    assert.notEqual(file, path.join(p.atlasRoot, anchorPath), 'Reuse must retain parsed records.');
    return readFile.call(fs, file, ...args);
  });
  t.mock.method(fs, 'readSync', (...args) => { const bytes = read.call(fs, ...args); rehashed += bytes; return bytes; });
  assert.strictEqual(workspace.read().view, first.view);
  assert.ok(rehashed > 0, 'Reuse must check bytes, not only timestamps.');
  assert.equal(first.view.inspectPoint('rotate-edge-keys').status, 'found');
});

test('source edits, additions, renames, and deletions replace the current observation only', (t) => {
  const p = project(t), workspace = open(t, options(p));
  let last = workspace.read();
  const initial = last;
  replaceFile(p.atlasRoot, anchorPath, 'Authenticate at the edge', 'Authenticate at the gateway');
  assert.equal(initial.view.freshness().status, 'stale');
  last = workspace.read();
  assert.equal(last.view.inspectPoint('edge-authentication').point.title, 'Authenticate at the gateway');
  assert.equal(initial.view.inspectPoint('edge-authentication').point.title, 'Authenticate at the edge');
  for (const mutate of [
    () => fs.writeFileSync(path.join(p.atlasRoot, 'docs/untracked.md'), 'New source.\n'),
    () => fs.renameSync(path.join(p.atlasRoot, 'docs/untracked.md'), path.join(p.atlasRoot, 'docs/renamed.md')),
    () => fs.unlinkSync(path.join(p.atlasRoot, 'docs/renamed.md')),
  ]) {
    mutate();
    assert.equal(last.view.freshness().status, 'stale');
    const next = workspace.read();
    assert.notStrictEqual(next.view, last.view);
    assert.notEqual(next.view.identity.inputDigest, last.view.identity.inputDigest);
    assert.equal(next.freshness.status, 'fresh');
    last = next;
  }
});

test('adopted Check and explicit local Resource changes invalidate reuse with distinct comparisons', (t) => {
  const p = project(t);
  fs.cpSync(path.join(root, 'spec/examples/valid/checks/.checks'), path.join(p.atlasRoot, '.checks'), { recursive: true });
  const catalogFile = path.join(p.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  catalog.checks.push(...JSON.parse(fs.readFileSync(path.join(root, 'spec/examples/valid/checks/catalog.json'), 'utf8')).checks);
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  fs.mkdirSync(path.join(p.atlasRoot, 'dist'));
  fs.writeFileSync(path.join(p.atlasRoot, 'dist/source.md'), 'Initial Resource.');
  fs.writeFileSync(path.join(p.atlasRoot, 'dist/unselected.md'), 'Unselected sibling.');
  replaceFile(p.atlasRoot, 'catalog.json', 'docs/authentication.md', 'dist/source.md');
  const workspace = open(t, options(p)), initial = workspace.read();
  assert.equal(initial.view.status, 'ready');
  assert.ok(!initial.view.identity.inputs.some((entry) => entry.path === 'dist/unselected.md'));
  fs.appendFileSync(path.join(p.atlasRoot, '.checks/boundary.md'), '\nAn amended verification explanation.\n');
  const changedCheck = workspace.read();
  assert.notStrictEqual(changedCheck.view, initial.view);
  assert.ok(initial.view.compare(changedCheck.view).records.some((entry) => entry.key.includes('boundary')));
  fs.writeFileSync(path.join(p.atlasRoot, 'dist/source.md'), 'Changed Resource.');
  const changedSource = workspace.read();
  assert.notStrictEqual(changedSource.view, changedCheck.view);
  assert.deepEqual(changedCheck.view.compare(changedSource.view).records, []);
  assert.deepEqual(changedCheck.view.compare(changedSource.view).sourceChanges, [{ path: 'dist/source.md', change: 'changed' }]);
});

test('complete invalid drafts are reused while incomplete reads never fall back to a previous view', (t) => {
  const p = project(t), workspace = open(t, options(p)), initial = workspace.read();
  replaceFile(p.atlasRoot, anchorPath, '# Authenticate at the edge', '');
  const invalid = workspace.read();
  assert.equal(invalid.view.status, 'invalid');
  assert.equal(invalid.view.validation.normalized, undefined);
  assert.equal(invalid.view.readDocument(anchorPath).status, 'read');
  assert.strictEqual(workspace.read().view, invalid.view);
  const openFile = fs.openSync;
  const controlled = t.mock.method(fs, 'openSync', (file, ...args) => {
    if (file === path.join(p.atlasRoot, anchorPath)) throw Object.assign(new Error('Controlled read failure'), { code: 'EIO' });
    return openFile.call(fs, file, ...args);
  });
  const incomplete = workspace.read(), repeated = workspace.read();
  assert.equal(incomplete.view.status, 'incomplete');
  assert.equal(incomplete.view.validation.normalized, undefined);
  assert.equal(incomplete.view.inspectPoint('edge-authentication').status, 'incomplete');
  assert.notStrictEqual(repeated.view, incomplete.view);
  controlled.mock.restore();
  const recovered = workspace.read();
  assert.equal(recovered.view.status, 'invalid');
  assert.notStrictEqual(recovered.view, invalid.view);
  assert.equal(initial.view.inspectPoint('edge-authentication').status, 'found');
});

test('exact root selection rejects aliases and ancestor discovery without constraining root Atlases', (t) => {
  const p = project(t, { rootAtlas: true }), workspace = open(t, options(p));
  assert.equal(workspace.read().view.atlasRoot, p.repositoryRoot);
  const nested = open(t, options(p, { atlasPath: 'maps/architecture' }));
  assert.throws(() => nested.read(), toolError('atlas.workspace.invalid-configuration'));
  fs.symlinkSync(path.join(p.atlasRoot, 'maps'), path.join(p.atlasRoot, 'alias'));
  assert.throws(() => openWorkspace(options(p, { atlasPath: 'alias/architecture' })), toolError('atlas.workspace.invalid-configuration'));
  for (const atlasPath of ['../outside', '/absolute', 'maps//architecture', 'maps/../maps', 'maps\\architecture']) {
    assert.throws(() => openWorkspace(options(p, { atlasPath })), toolError('atlas.tools.invalid-argument'));
  }
  assert.throws(() => openWorkspace({ repositoryRoot: p.repositoryRoot }), toolError('atlas.workspace.invalid-configuration'));
});

test('configuration reloads exact bytes, merges overrides, and replaces selected roots', (t) => {
  const p = project(t), file = path.join(p.repositoryRoot, 'atlas.workspace.json');
  const config = { format: 1, atlasPath: 'atlas', configuration: { specificationRevision: '0.9.0', maxDocumentBytes: 90 } };
  fs.writeFileSync(file, JSON.stringify(config));
  const workspace = open(t, { repositoryRoot: p.repositoryRoot }), initial = workspace.read(), oldInfo = workspace.info;
  assert.equal(initial.view.readDocument(anchorPath).status, 'truncated');
  const unspecified = open(t, { repositoryRoot: p.repositoryRoot, configuration: { specificationRevision: undefined, maxDocumentBytes: undefined } });
  assert.deepEqual(unspecified.info.configuration, config.configuration);
  assert.equal(unspecified.read().view.readDocument(anchorPath).status, 'truncated');
  assert.deepEqual(unspecified.read().view.identity.configuration, { maxDocumentBytes: 90 });
  fs.appendFileSync(file, '\n');
  const reformatted = workspace.read();
  assert.notStrictEqual(reformatted.view, initial.view);
  assert.notEqual(workspace.info.configurationDigest, oldInfo.configurationDigest);
  assert.notEqual(workspace.info.configurationSourceDigest, oldInfo.configurationSourceDigest);
  assert.deepEqual(reformatted.view.validation.normalized, initial.view.validation.normalized);
  const explicit = { maxDocumentBytes: 100_000 };
  const override = open(t, { repositoryRoot: p.repositoryRoot, atlasPath: 'atlas', configuration: explicit });
  explicit.maxDocumentBytes = 1;
  assert.equal(override.read().view.readDocument(anchorPath).status, 'read');
  assert.equal(override.info.configuration.specificationRevision, '0.9.0');
  fs.cpSync(p.atlasRoot, path.join(p.repositoryRoot, 'other'), { recursive: true });
  config.atlasPath = 'other'; config.configuration.maxDocumentBytes = 120;
  fs.writeFileSync(file, JSON.stringify(config));
  assert.equal(workspace.refresh().view.atlasRoot, path.join(p.repositoryRoot, 'other'));
  assert.equal(workspace.info.configuration.maxDocumentBytes, 120);
  assert.equal(oldInfo.configuration.maxDocumentBytes, 90);
  assert.ok(Object.isFrozen(workspace.info.configuration));
  assert.equal(override.read().view.atlasRoot, p.atlasRoot);
  assert.equal(override.info.configuration.maxDocumentBytes, 100_000);
});

test('malformed and obsolete configuration fails explicitly and clears a remembered view', (t) => {
  const p = project(t), file = path.join(p.repositoryRoot, 'atlas.workspace.json');
  const workspace = open(t, options(p)), initial = workspace.read();
  for (const invalid of ['{', JSON.stringify({ format: 2, atlasPath: 'atlas' }),
    JSON.stringify({ format: 1, atlasPath: '../outside' }), JSON.stringify({ format: 1, atlasPath: 'atlas', cacheDirectory: 'cache' }),
    JSON.stringify({ format: 1, atlasPath: 'atlas', configuration: { evaluatorRevision: 'obsolete' } })]) {
    fs.writeFileSync(file, invalid);
    assert.throws(() => workspace.read(), toolError('atlas.workspace.invalid-configuration'));
    assert.throws(() => openWorkspace(options(p)), toolError('atlas.workspace.invalid-configuration'));
  }
  fs.unlinkSync(file);
  assert.notStrictEqual(workspace.read().view, initial.view);
  for (const extra of [{ cacheDirectory: '/obsolete' }, { lockTimeoutMs: 100 }, { configuration: { evaluatorRevision: 'obsolete' } }]) {
    assert.throws(() => openWorkspace(options(p, extra)), toolError('atlas.tools.invalid-argument'));
  }
});

test('configuration changes during a reused observation refuse mixed identities and allow a fresh retry', (t) => {
  const p = project(t), configFile = path.join(p.repositoryRoot, 'atlas.workspace.json');
  fs.writeFileSync(configFile, JSON.stringify({ format: 1, atlasPath: 'atlas', configuration: { maxDocumentBytes: 90 } }));
  const workspace = open(t, { repositoryRoot: p.repositoryRoot }), initial = workspace.read();
  const openFile = fs.openSync;
  let changed = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (!changed && file === path.join(p.atlasRoot, anchorPath)) {
      changed = true;
      fs.writeFileSync(configFile, JSON.stringify({ format: 1, atlasPath: 'atlas', configuration: { maxDocumentBytes: 120 } }));
    }
    return openFile.call(fs, file, ...args);
  });
  assert.throws(() => workspace.read(), toolError('atlas.workspace.configuration-changed'));
  assert.equal(changed, true);
  const retried = workspace.read();
  assert.notStrictEqual(retried.view, initial.view);
  assert.equal(workspace.info.configuration.maxDocumentBytes, 120);
});

test('configuration becoming malformed during a new observation reports the observation race', (t) => {
  const p = project(t), file = path.join(p.repositoryRoot, 'atlas.workspace.json');
  fs.writeFileSync(file, JSON.stringify({ format: 1, atlasPath: 'atlas' }));
  const workspace = open(t, { repositoryRoot: p.repositoryRoot }), openFile = fs.openSync;
  let changed = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    if (!changed && target === path.join(p.atlasRoot, anchorPath)) { changed = true; fs.writeFileSync(file, '{'); }
    return openFile.call(fs, target, ...args);
  });
  assert.throws(() => workspace.read(), toolError('atlas.workspace.configuration-changed'));
  assert.equal(changed, true);
});

test('all workspace operations write no files and preserve existing storage as ordinary bytes', (t) => {
  const p = project(t, { rootAtlas: true });
  for (const [relative, bytes] of [
    ['tmp/atlas/.atlas-cache.json', '{"contract":"atlas.cache-directory/1"}\n'], ['tmp/atlas/cache.sqlite', 'Old storage.'],
    ['reports/result.txt', 'Attributed evidence.'], ['recovery/plan.json', 'Caller recovery.'], ['drafts/change.txt', 'Unsaved contribution.'],
  ]) {
    const file = path.join(p.repositoryRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  }
  replaceFile(p.atlasRoot, 'catalog.json', 'docs/authentication.md', 'tmp/atlas/cache.sqlite');
  const before = tree(p.repositoryRoot), openFile = fs.openSync;
  const mocks = ['writeFileSync', 'appendFileSync', 'writeSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'truncateSync', 'linkSync']
    .map((method) => t.mock.method(fs, method, () => assert.fail(`Workspace attempted ${method}.`)));
  mocks.push(t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    const writing = typeof flags === 'string' ? /[wa+]/u.test(flags) : flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND);
    assert.equal(Boolean(writing), false, `Workspace attempted a writable open: ${file}`);
    return openFile.call(fs, file, flags, ...args);
  }));
  try {
    const workspace = openWorkspace(options(p)), first = workspace.read();
    assert.equal(first.view.status, 'ready');
    assert.equal(first.view.readDocument('tmp/atlas/cache.sqlite').text, 'Old storage.');
    assert.equal(Object.hasOwn(first.view.identity.scope, 'excludedDirectories'), false);
    assert.strictEqual(workspace.read().view, first.view);
    workspace.refresh(); workspace.close();
    const reopened = openWorkspace(options(p)); reopened.read(); reopened.close();
  } finally { mocks.forEach((mock) => mock.mock.restore()); }
  assert.deepEqual(tree(p.repositoryRoot), before);
});

test('missing contextual targets are never created and outside targets are never read', (t) => {
  const p = project(t), external = path.join(p.repositoryRoot, 'source.txt');
  fs.writeFileSync(external, 'Outside source.');
  replaceFile(p.atlasRoot, 'catalog.json', 'docs/authentication.md', '../source.txt');
  const openFile = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    assert.notEqual(file, external, 'Outside contextual targets remain descriptive.');
    return openFile.call(fs, file, ...args);
  });
  const workspace = open(t, options(p));
  assert.equal(workspace.read().view.identity.scope.externalResources, 'not-read');
  replaceFile(p.atlasRoot, 'catalog.json', '../source.txt', 'tmp/atlas/cache.sqlite');
  workspace.refresh();
  assert.equal(fs.existsSync(path.join(p.atlasRoot, 'tmp')), false);
});

test('close rejects future reading while caller-held views remain immutable and usable', (t) => {
  const p = project(t), workspace = open(t, options(p)), view = workspace.read().view;
  workspace.close(); workspace.close();
  for (const method of ['read', 'refresh']) assert.throws(() => workspace[method](), toolError('atlas.workspace.closed'));
  assert.equal(workspace.reset, undefined);
  assert.equal(workspace.cacheStatus, undefined);
  assert.equal(view.inspectPoint('edge-authentication').status, 'found');
  assert.equal(view.freshness().status, 'fresh');
  assert.throws(() => { view.validation.normalized.points.push({}); }, TypeError);
});

test('workspace CLI opens fresh processes, preserves files, and reports ready, invalid, incomplete, and usage exits', (t) => {
  const p = project(t), binary = fileURLToPath(new URL('../../apps/cli/bin/atlas-workspace.mjs', import.meta.url));
  const cli = (args, status, nodeOptions = []) => {
    const result = spawnSync(process.execPath, [...nodeOptions, binary, ...args], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.error, undefined); assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
    return result;
  };
  const args = (operation, ...flags) => [p.repositoryRoot, operation, '--atlas', 'atlas', ...flags];
  const before = tree(p.repositoryRoot), first = JSON.parse(cli(args('read'), 0).stdout);
  assert.deepEqual(Object.keys(first).sort(), ['contract', 'freshness', 'view']);
  assert.equal(first.contract, 'atlas.workspace-view/2');
  for (const operation of ['read', 'refresh']) assert.deepEqual(JSON.parse(cli(args(operation), 0).stdout).view.identity, first.view.identity);
  assert.deepEqual(tree(p.repositoryRoot), before);
  assert.equal(JSON.parse(cli(args('read', '--max-document-bytes', '90'), 0).stdout).view.identity.configuration.maxDocumentBytes, 90);
  const interrupted = path.join(p.directory, 'interrupted-read.mjs');
  fs.writeFileSync(interrupted, `import fs from 'node:fs';
const original = fs.openSync;
fs.openSync = function(file, ...args) {
  if (file === ${JSON.stringify(path.join(p.atlasRoot, anchorPath))}) throw Object.assign(new Error('Controlled input failure'), { code: 'EIO' });
  return original.call(fs, file, ...args);
};
`);
  assert.equal(JSON.parse(cli(args('read'), 2, ['--import', interrupted]).stdout).view.status, 'incomplete');
  replaceFile(p.atlasRoot, anchorPath, '# Authenticate at the edge', '');
  assert.equal(JSON.parse(cli(args('read'), 1).stdout).view.status, 'invalid');
  for (const invalid of [[], args('status'), args('reset'), args('find'), args('read', '--atlas', 'atlas'),
    args('read', '--cache-directory', '/obsolete'), args('read', '--lock-timeout-ms', '100'), args('read', '--evaluator-revision', 'old'),
    args('read', '--max-document-bytes', '1.5'), args('read', '--execute', 'anything')]) {
    const result = cli(invalid, 2);
    assert.equal(result.stdout, ''); assert.equal(JSON.parse(result.stderr).error.code, 'atlas.tools.invalid-argument');
  }
  assert.match(cli(['--help'], 0).stdout, /read\|refresh/u);
});
