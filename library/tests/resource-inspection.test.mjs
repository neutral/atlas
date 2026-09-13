import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AtlasToolError, openAtlas } from '../src/index.mjs';

const fixture = fileURLToPath(new URL('../../spec/examples/valid/cross-map/', import.meta.url));
const anchorPath = 'maps/architecture/points/edge-authentication.md';
const contextPath = 'maps/operations/points/edge-authentication.md';

function copyAtlas(t) {
  const atlasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-resource-inspection-'));
  fs.cpSync(fixture, atlasRoot, { recursive: true });
  t.after(() => fs.rmSync(atlasRoot, { recursive: true, force: true }));
  return atlasRoot;
}

function editJson(root, relative, edit) {
  const file = path.join(root, relative), value = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(value);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

test('exact Resource inspection retains every owner, target role, selector, question, and extension', (t) => {
  const atlasRoot = copyAtlas(t);
  editJson(atlasRoot, 'connections.json', (connections) => {
    connections.content.push(
      { id: 'root-guide', owner: { type: 'atlas' }, target: { resource: 'authentication-guide', selector: 'introduction', label: 'Read first', 'x-origin': { source: 'root' } } },
      { id: 'boundary-guide', owner: { type: 'area', map: 'architecture', area: 'boundary' }, target: { resource: 'authentication-guide', selector: 'perimeter' } },
    );
    connections.references.push(
      { id: 'architecture-guide', owner: { type: 'map', map: 'architecture' }, target: { resource: 'authentication-guide', selector: 'boundary' }, role: 'supporting' },
      { id: 'boundary-evidence', owner: { type: 'area', map: 'architecture', area: 'boundary' }, target: { resource: 'authentication-guide' }, role: 'evidence' },
    );
  });
  const mapFile = path.join(atlasRoot, 'maps/architecture/map.md');
  const mapSource = fs.readFileSync(mapFile, 'utf8');
  fs.writeFileSync(mapFile, mapSource.replace('## Area: security', '### Connection: boundary-evidence\n\nThis source informs the Area question.\n\n## Area: security')
    + '\n## Connection: architecture-guide\n\nThis source explains the Map boundary.\n');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready', JSON.stringify(view.validation.diagnostics));
  const result = view.inspectResource('authentication-guide');
  assert.equal(result.contract, 'atlas.resource-inspection/1');
  assert.equal(result.status, 'found');
  assert.equal(result.atlasRoot, atlasRoot);
  assert.equal(result.resourceId, 'authentication-guide');
  assert.equal(result.identity, view.identity);
  assert.equal(result.resource, view.validation.normalized.atlas.resources[0]);
  assert.deepEqual(result.uses.map(({ use, owner }) => ({ use, ...owner })), [
    { use: 'content', type: 'atlas', path: 'atlas.md' },
    { use: 'reference', type: 'map', path: 'maps/architecture/map.md', mapId: 'architecture', question: 'What context belongs in the architecture fixture Map?' },
    { use: 'content', type: 'area', path: 'maps/architecture/map.md', mapId: 'architecture', areaId: 'boundary', question: 'Does this record materially affect boundary?' },
    { use: 'reference', type: 'area', path: 'maps/architecture/map.md', mapId: 'architecture', areaId: 'boundary', question: 'Does this record materially affect boundary?' },
    { use: 'content', type: 'point-record', path: anchorPath, mapId: 'architecture', pointId: 'edge-authentication', recordKind: 'anchor' },
    { use: 'content', type: 'point-record', path: contextPath, mapId: 'operations', pointId: 'edge-authentication', recordKind: 'context' },
  ]);
  assert.deepEqual(result.uses[0].target, { id: 'root-guide', resource: 'authentication-guide', selector: 'introduction', label: 'Read first', 'x-origin': { source: 'root' } });
  assert.equal(result.uses[1].target.role, 'supporting');
  assert.equal(result.uses[1].target.selector, 'boundary');
  assert.equal(result.uses[1].target.note, 'This source explains the Map boundary.');
  assert.ok(result.limits.some((limit) => limit.includes('no publication selection')));
  assert.ok(Object.isFrozen(result.uses));
  assert.throws(() => { result.uses[0].target['x-origin'].source = 'changed'; }, TypeError);
  assert.throws(() => { result.uses[1].owner.question = 'changed'; }, TypeError);
});

test('context-only Resource uses remain visible without conflating direct URIs or another registered id', (t) => {
  const atlasRoot = copyAtlas(t);
  editJson(atlasRoot, 'catalog.json', (catalog) => {
    catalog.resources.push({ id: 'separate-guide', title: 'Separate registration', uri: 'docs/authentication.md' });
    catalog.resources.push({ id: 'unused-guide', title: 'Unused registration', uri: 'docs/authentication.md' });
  });
  editJson(atlasRoot, 'connections.json', (connections) => {
    connections.content = connections.content.filter(entry => entry.owner.type !== 'point' || entry.owner.map !== 'architecture');
    connections.content.push({ id: 'separate-content', owner: { type: 'atlas' }, target: { resource: 'separate-guide' } });
    connections.references.push(
      { id: 'root-source', owner: { type: 'atlas' }, target: { uri: 'docs/authentication.md' }, role: 'supporting' },
      { id: 'anchor-source', owner: { type: 'point', map: 'architecture', point: 'edge-authentication' }, target: { uri: '../../../docs/authentication.md' }, role: 'supporting' },
    );
  });
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready', JSON.stringify(view.validation.diagnostics));
  const result = view.inspectResource('authentication-guide');
  assert.equal(result.status, 'found');
  assert.equal(result.uses.length, 1);
  assert.deepEqual(result.uses[0].owner, {
    type: 'point-record', path: contextPath, mapId: 'operations', pointId: 'edge-authentication', recordKind: 'context',
  });
  assert.equal(view.inspectResource('separate-guide').uses.length, 1);
  const unused = view.inspectResource('unused-guide');
  assert.equal(unused.status, 'found');
  assert.deepEqual(unused.uses, []);
  for (const id of ['authentication', 'Authentication-guide', 'authentication-guide ', 'docs/authentication.md']) {
    const absent = view.inspectResource(id);
    assert.equal(absent.status, 'not-found');
    assert.equal(Object.hasOwn(absent, 'resource'), false);
    assert.equal(Object.hasOwn(absent, 'uses'), false);
  }
});

test('Resource inspection reuses the captured model without filesystem reads or source retrieval', (t) => {
  const atlasRoot = copyAtlas(t);
  const view = openAtlas(atlasRoot);
  const expected = view.inspectResource('authentication-guide');
  fs.unlinkSync(path.join(atlasRoot, 'docs/authentication.md'));
  for (const method of ['lstatSync', 'statSync', 'readdirSync', 'readFileSync', 'openSync', 'readSync', 'fstatSync', 'readlinkSync', 'realpathSync']) {
    t.mock.method(fs, method, () => { throw new Error(`Unexpected read: ${method}`); });
  }
  assert.deepEqual(view.inspectResource('authentication-guide'), expected);
  assert.equal(view.inspectResource('missing').status, 'not-found');
  assert.equal(view.inspectPoint('edge-authentication').status, 'found');
});

test('invalid and incomplete observations never expose a Resource registration or uses', (t) => {
  const atlasRoot = copyAtlas(t);
  fs.writeFileSync(path.join(atlasRoot, anchorPath), '---\n{unfinished\n---\nDraft source.\n');
  const invalid = openAtlas(atlasRoot).inspectResource('authentication-guide');
  assert.equal(invalid.status, 'invalid');
  assert.equal(Object.hasOwn(invalid, 'resource'), false);
  assert.equal(Object.hasOwn(invalid, 'uses'), false);

  const read = fs.readSync;
  let interrupted = false;
  t.mock.method(fs, 'readSync', (...args) => {
    if (!interrupted) {
      interrupted = true;
      throw Object.assign(new Error('Controlled source read interruption'), { code: 'EIO' });
    }
    return read.call(fs, ...args);
  });
  const incomplete = openAtlas(atlasRoot).inspectResource('authentication-guide');
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.identity.digest, null);
  assert.equal(Object.hasOwn(incomplete, 'resource'), false);
  assert.equal(Object.hasOwn(incomplete, 'uses'), false);
});

test('Resource inspection rejects nonstring and blank ids with a stable public error', (t) => {
  const view = openAtlas(copyAtlas(t));
  for (const id of [undefined, null, 7, '', '  ']) {
    assert.throws(() => view.inspectResource(id), (error) => error instanceof AtlasToolError && error.code === 'atlas.tools.invalid-argument');
  }
});
