import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openAtlas, openWorkspace, prepareAtlasChange, applyAtlasChange } from '../src/index.mjs';
import { parseFrontMatter } from '../src/frontmatter.mjs';

const fixture = fileURLToPath(new URL('../../spec/examples/valid/cross-map/', import.meta.url));
const anchor = 'maps/architecture/points/edge-authentication.md';
function project(t) {
  const repositoryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-global-state-')));
  const atlasRoot = path.join(repositoryRoot, 'atlas');
  fs.cpSync(fixture, atlasRoot, { recursive: true });
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  return { repositoryRoot, atlasRoot, atlasPath: 'atlas' };
}
function edit(p, name, change) {
  const file = path.join(p.atlasRoot, name), value = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(value); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
for (const source of ['catalog.json', 'connections.json']) test(`${source}-only edits change reading data and refuse stale authoring plans`, t => {
  const p = project(t), before = openAtlas(p.atlasRoot);
  const original = fs.readFileSync(path.join(p.atlasRoot, anchor));
  const body = parseFrontMatter(original.toString('utf8')).body;
  const plan = prepareAtlasChange({ repositoryRoot: p.repositoryRoot, atlasPath: 'atlas', expected: { viewDigest: before.identity.digest },
    operations: [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: `${body}\nA reviewed contribution.\n` }] });
  assert.equal(plan.status, 'ready');
  if (source === 'catalog.json') edit(p, source, value => { value.points.find(point => point.point === 'edge-authentication').kinds = ['risk']; });
  else edit(p, source, value => { value.references[0].role = value.references[0].role === 'historical' ? 'supporting' : 'historical'; });
  const after = openAtlas(p.atlasRoot);
  assert.equal(after.status, 'ready');
  assert.equal(before.freshness().status, 'stale');
  assert.deepEqual(before.freshness().changes, [{ path: source, change: 'changed' }]);
  assert.notEqual(after.identity.digest, before.identity.digest);
  const comparison = before.compare(after);
  assert.ok(comparison.records.length > 0, 'Global metadata is part of the affected logical record.');
  assert.deepEqual(comparison.sourceChanges, [{ path: source, change: 'changed' }]);
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: path.join(p.repositoryRoot, 'recovery') }).status, 'stale');
  assert.deepEqual(fs.readFileSync(path.join(p.atlasRoot, anchor)), original);
  assert.equal(before.inspectPoint('edge-authentication').point.kinds[0], 'decision', 'Retained views remain immutable.');
});

test('workspace rebuilds catalog changes and reproduces meaning after reopening', t => {
  const p = project(t);
  const options = { repositoryRoot: p.repositoryRoot, atlasPath: 'atlas' };
  let workspace = openWorkspace(options);
  const before = workspace.read();
  assert.equal(before.view.status, 'ready');
  assert.equal(workspace.read().view, before.view);
  edit(p, 'catalog.json', value => { value.resources[0].title = 'Renamed navigation label'; });
  const changed = workspace.read();
  assert.notEqual(changed.view.identity.inputDigest, before.view.identity.inputDigest);
  assert.equal(changed.view.inspectResource('authentication-guide').resource.title, 'Renamed navigation label');
  workspace.close();
  workspace = openWorkspace(options);
  try { assert.deepEqual(workspace.read().view.validation.normalized, changed.view.validation.normalized); }
  finally { workspace.close(); }
});

for (const name of ['catalog.json', 'connections.json']) test(`${name} is reserved from Resource targets`, t => {
  const p = project(t);
  edit(p, 'catalog.json', value => { value.resources[0].uri = name; });
  const view = openAtlas(p.atlasRoot);
  assert.ok(view.validation.diagnostics.some(diagnostic => diagnostic.code === 'atlas.reference.prohibited-target' && diagnostic.path === 'catalog.json' && diagnostic.pointer === '/resources/0/uri'));
  assert.equal(fs.statSync(path.join(p.atlasRoot, name)).isFile(), true);
});

for (const name of ['catalog', 'connections']) test(`${name}.json requires exact filename case`, t => {
  const p = project(t);
  fs.renameSync(path.join(p.atlasRoot, `${name}.json`), path.join(p.atlasRoot, `${name[0].toUpperCase()}${name.slice(1)}.json`));
  const view = openAtlas(p.atlasRoot);
  assert.ok(view.validation.diagnostics.some(diagnostic => diagnostic.code === 'atlas.global.missing' && diagnostic.path === `${name}.json`));
  assert.equal(view.validation.normalized, undefined);
});
