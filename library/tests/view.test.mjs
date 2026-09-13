import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AtlasToolError, localSourceTargets, openAtlas, validateAtlas } from '../src/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const examples = path.join(root, 'spec/examples');
const anchorPath = 'maps/architecture/points/edge-authentication.md';

function copyAtlas(t, fixture = 'valid/cross-map') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-view-'));
  t.after(() => {
    t.mock.restoreAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const atlasRoot = path.join(directory, 'atlas');
  fs.cpSync(path.join(examples, fixture), atlasRoot, { recursive: true });
  return atlasRoot;
}

function replaceFile(atlasRoot, relativePath, from, to) {
  const file = path.join(atlasRoot, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes(from), `Missing replacement text in ${relativePath}`);
  fs.writeFileSync(file, source.replace(from, to));
}

function toolError(code) {
  return (error) => error instanceof AtlasToolError && error.code === code;
}

test('one immutable opened observation serves two exact Points without additional filesystem reads', (t) => {
  const atlasRoot = copyAtlas(t);
  const expected = validateAtlas(atlasRoot).normalized;
  const view = openAtlas(path.join(atlasRoot, anchorPath));
  assert.equal(view.contract, 'atlas.read-view/2');
  assert.equal(view.atlasRoot, atlasRoot);
  assert.equal(view.status, 'ready');
  assert.match(view.identity.digest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(view.validation.normalized, expected);
  const serialized = JSON.stringify(view.validation);
  for (const method of ['lstatSync', 'statSync', 'readdirSync', 'readFileSync', 'openSync', 'readSync', 'fstatSync', 'readlinkSync']) {
    t.mock.method(fs, method, () => { throw new Error(`Unexpected read: ${method}`); });
  }
  for (const id of ['edge-authentication', 'rotate-edge-keys']) {
    const inspection = view.inspectPoint(id);
    assert.equal(inspection.status, 'found');
    assert.deepEqual(inspection.point, expected.points.find((point) => point.id === id));
    assert.ok(Object.isFrozen(inspection.point.records[0].areas));
    assert.throws(() => { inspection.point.records[0].body = 'Changed'; }, TypeError);
  }
  assert.equal(view.find('edge', { types: ['point'] }).total, 2);
  assert.equal(view.readDocument(anchorPath).status, 'read');
  assert.ok(Object.isFrozen(view));
  assert.throws(() => { view.validation.normalized.points.push({}); }, TypeError);
  assert.throws(() => { view.identity.inputs[0].path = 'changed'; }, TypeError);
  assert.equal(JSON.stringify(view.validation), serialized);
});

test('external edits leave captured meaning and raw bytes intact until explicit refresh', (t) => {
  const atlasRoot = copyAtlas(t);
  const view = openAtlas(atlasRoot);
  const captured = view.readDocument(anchorPath);
  replaceFile(atlasRoot, anchorPath, '# Authenticate at the edge', '# Authenticate at the gateway');
  assert.equal(view.inspectPoint('edge-authentication').point.title, 'Authenticate at the edge');
  assert.deepEqual(view.readDocument(anchorPath), captured);
  const freshness = view.freshness();
  assert.equal(freshness.status, 'stale');
  assert.deepEqual(freshness.changes, [{ path: anchorPath, change: 'changed' }]);
  const refreshed = view.refresh();
  assert.equal(refreshed.status, 'ready');
  assert.equal(refreshed.freshness().status, 'fresh');
  assert.equal(refreshed.inspectPoint('edge-authentication').point.title, 'Authenticate at the gateway');
  assert.notEqual(refreshed.identity.digest, view.identity.digest);
  assert.equal(view.inspectPoint('edge-authentication').point.title, 'Authenticate at the edge');
});

test('freshness detects untracked additions, renames, and deletions by inventory and content', (t) => {
  const atlasRoot = copyAtlas(t);
  const initial = openAtlas(atlasRoot);
  fs.writeFileSync(path.join(atlasRoot, 'docs/untracked.md'), 'Untracked source material.\n');
  assert.deepEqual(initial.freshness().changes, [{ path: 'docs/untracked.md', change: 'added' }]);
  const added = initial.refresh();
  assert.equal(added.freshness().status, 'fresh');
  fs.renameSync(path.join(atlasRoot, 'docs/untracked.md'), path.join(atlasRoot, 'docs/renamed.md'));
  assert.deepEqual(added.freshness().changes, [
    { path: 'docs/renamed.md', change: 'added' }, { path: 'docs/untracked.md', change: 'removed' },
  ]);
  const renamed = added.refresh();
  fs.unlinkSync(path.join(atlasRoot, 'docs/renamed.md'));
  assert.deepEqual(renamed.freshness().changes, [{ path: 'docs/renamed.md', change: 'removed' }]);
  const removed = renamed.refresh();
  assert.equal(removed.identity.digest, initial.identity.digest);
  assert.equal(removed.freshness().status, 'fresh');
  fs.utimesSync(path.join(atlasRoot, anchorPath), new Date(0), new Date(0));
  assert.equal(removed.freshness().status, 'fresh', 'Modification time alone must not define content identity');
});

test('input scope excludes ignored directories, nested Atlases, and external Resource bytes', (t) => {
  const atlasRoot = copyAtlas(t, 'valid/nested-atlas-boundary');
  const initial = openAtlas(atlasRoot);
  assert.equal(initial.status, 'ready');
  fs.appendFileSync(path.join(atlasRoot, 'nested/atlas.md'), '\nChanged inside another Atlas.\n');
  fs.mkdirSync(path.join(atlasRoot, 'node_modules'));
  fs.writeFileSync(path.join(atlasRoot, 'node_modules/untracked.md'), 'Ignored dependency content.');
  assert.equal(initial.freshness().status, 'fresh');
  assert.equal(initial.identity.scope.nestedAtlases, 'excluded');
  assert.equal(initial.identity.scope.externalResources, 'not-read');
  assert.equal(initial.readDocument('nested/atlas.md').status, 'missing');
  assert.throws(() => initial.readDocument('../outside.md'), toolError('atlas.tools.invalid-argument'));
  const externalRoot = copyAtlas(t, 'valid/external-local');
  const outside = path.join(externalRoot, '../outside.md');
  fs.writeFileSync(outside, 'External registered source content.');
  const external = openAtlas(externalRoot);
  assert.equal(external.status, 'ready');
  assert.equal(external.inspectPoint('service-boundary').point.records[0].references[0].uri, '../../../../outside.md');
  fs.writeFileSync(outside, 'Changed outside the captured Atlas.');
  assert.equal(external.freshness().status, 'fresh');
});

test('public local target metadata retains missing outside paths in invalid drafts without reading or inventorying them', (t) => {
  const atlasRoot = copyAtlas(t);
  const outside = path.resolve(atlasRoot, '../tmp/atlas/cache.sqlite');
  replaceFile(atlasRoot, 'catalog.json', 'docs/authentication.md', '../tmp/atlas/cache.sqlite');
  replaceFile(atlasRoot, anchorPath, '# Authenticate at the edge', '');
  const expected = validateAtlas(atlasRoot);
  const outsideReads = [];
  for (const method of ['lstatSync', 'statSync', 'readdirSync', 'readFileSync', 'openSync', 'readlinkSync', 'realpathSync']) {
    const original = fs[method];
    t.mock.method(fs, method, (file, ...args) => {
      if (typeof file === 'string' && !path.resolve(file).startsWith(`${atlasRoot}${path.sep}`) && path.resolve(file) !== atlasRoot) {
        outsideReads.push({ method, file });
        throw new Error('Outside target metadata must not trigger a filesystem read.');
      }
      return original.call(fs, file, ...args);
    });
  }
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'invalid');
  assert.equal(view.validation.complete, true);
  assert.equal(view.validation.normalized, undefined);
  assert.deepEqual(view.validation.toJSON(), expected.toJSON());
  assert.deepEqual(localSourceTargets(view), [outside]);
  assert.throws(() => localSourceTargets({ ...view }), toolError('atlas.tools.invalid-argument'));
  assert.notEqual(localSourceTargets(view), localSourceTargets(view));
  assert.throws(() => localSourceTargets(view).push('/another/path'), TypeError);
  assert.deepEqual(view.identity.scope.explicitLocalTargets, []);
  assert.ok(view.identity.inputs.every((input) => !input.path.startsWith('../')));
  assert.equal(view.freshness().status, 'fresh');
  assert.deepEqual(outsideReads, []);
});

test('explicit Resource targets in excluded directories retain exact bytes and detect edit, removal, and repair', async (t) => {
  for (const excluded of ['dist', 'node_modules/package', 'nested']) {
    await t.test(excluded, (t) => {
      const atlasRoot = copyAtlas(t);
      fs.mkdirSync(path.join(atlasRoot, excluded), { recursive: true });
      if (excluded === 'nested') fs.writeFileSync(path.join(atlasRoot, 'nested/atlas.md'), 'A separate Atlas boundary.');
      const sourcePath = `${excluded}/source.md`;
      fs.writeFileSync(path.join(atlasRoot, sourcePath), 'Explicit source material.');
      fs.writeFileSync(path.join(atlasRoot, excluded, 'unselected.md'), 'Unselected sibling.');
      replaceFile(atlasRoot, 'catalog.json', 'docs/authentication.md', sourcePath);
      const open = fs.openSync;
      t.mock.method(fs, 'openSync', (file, ...args) => {
        assert.notEqual(file, path.join(atlasRoot, excluded, 'unselected.md'), 'Excluded siblings must not be read');
        return open.call(fs, file, ...args);
      });
      const initial = openAtlas(atlasRoot);
      assert.equal(initial.status, 'ready');
      assert.deepEqual(initial.identity.scope.explicitLocalTargets, [sourcePath]);
      assert.equal(initial.readDocument(sourcePath).text, 'Explicit source material.');
      assert.equal(initial.readDocument(`${excluded}/unselected.md`).status, 'missing');
      fs.writeFileSync(path.join(atlasRoot, excluded, 'unselected.md'), 'Changed excluded sibling.');
      assert.equal(initial.freshness().status, 'fresh');

      fs.writeFileSync(path.join(atlasRoot, sourcePath), 'Changed explicit source.');
      assert.equal(initial.freshness().status, 'stale');
      const changed = initial.refresh();
      assert.equal(changed.status, 'ready');
      assert.equal(changed.readDocument(sourcePath).text, 'Changed explicit source.');
      assert.deepEqual(initial.compare(changed).records, [], 'Source bytes must not manufacture changed authored records');
      assert.deepEqual(initial.compare(changed).sourceChanges, [{ path: sourcePath, change: 'changed' }]);

      fs.renameSync(path.join(atlasRoot, sourcePath), path.join(atlasRoot, excluded, 'renamed.md'));
      assert.equal(changed.freshness().status, 'stale');
      assert.equal(validateAtlas(atlasRoot).valid, false);
      const missing = changed.refresh();
      assert.equal(missing.status, 'invalid');
      assert.equal(missing.validation.complete, true);
      assert.deepEqual(missing.readDocument(sourcePath).input, { path: sourcePath, kind: 'missing' });
      assert.equal(missing.readDocument(sourcePath).status, 'missing');
      assert.equal(missing.freshness().status, 'fresh');
      fs.writeFileSync(path.join(atlasRoot, sourcePath), 'Repaired source material.');
      assert.equal(missing.freshness().status, 'stale');
      assert.equal(missing.refresh().status, 'ready');
    });
  }
});

test('direct URI targets retain their owner-relative base without recursively reading nested Atlas material', (t) => {
  const atlasRoot = copyAtlas(t);
  fs.mkdirSync(path.join(atlasRoot, 'nested/docs'), { recursive: true });
  fs.writeFileSync(path.join(atlasRoot, 'nested/atlas.md'), 'A separate Atlas boundary.');
  fs.writeFileSync(path.join(atlasRoot, 'nested/docs/source.md'), 'Directly referenced material.');
  replaceFile(atlasRoot, 'connections.json', 'https://example.com/security-model', '../../../nested/docs/source.md');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.identity.scope.explicitLocalTargets, ['docs/authentication.md', 'nested/docs/source.md']);
  assert.equal(view.readDocument('nested/atlas.md').status, 'missing');
  fs.unlinkSync(path.join(atlasRoot, 'nested/docs/source.md'));
  assert.equal(view.freshness().status, 'stale');
  assert.equal(view.refresh().status, 'invalid');
});

test('an absent exact target remains complete-invalid and detects a later parent-directory creation', (t) => {
  const atlasRoot = copyAtlas(t);
  replaceFile(atlasRoot, 'catalog.json', 'docs/authentication.md', 'dist/not-yet-created/source.md');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'invalid');
  assert.equal(view.validation.complete, true);
  assert.ok(view.identity.inputs.some((entry) => entry.path === 'dist' && entry.kind === 'missing'));
  assert.equal(view.freshness().status, 'fresh');
  fs.mkdirSync(path.join(atlasRoot, 'dist/not-yet-created'), { recursive: true });
  fs.writeFileSync(path.join(atlasRoot, 'dist/not-yet-created/source.md'), 'New material.');
  assert.equal(view.freshness().status, 'stale');
  assert.equal(view.refresh().status, 'ready');
});

test('replacing an explicit target ancestor with a symlink reports stale without reading its target', (t) => {
  const atlasRoot = copyAtlas(t);
  const outside = path.join(atlasRoot, '../outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'source.md'), 'Outside source must not be read.');
  fs.mkdirSync(path.join(atlasRoot, 'dist'));
  fs.writeFileSync(path.join(atlasRoot, 'dist/source.md'), 'Initial contained source.');
  replaceFile(atlasRoot, 'catalog.json', 'docs/authentication.md', 'dist/source.md');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready');
  fs.rmSync(path.join(atlasRoot, 'dist'), { recursive: true });
  fs.symlinkSync(outside, path.join(atlasRoot, 'dist'), 'dir');
  const open = fs.openSync;
  const readDirectory = fs.readdirSync;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    assert.notEqual(file, path.join(atlasRoot, 'dist/source.md'));
    assert.notEqual(file, path.join(outside, 'source.md'));
    return open.call(fs, file, ...args);
  });
  t.mock.method(fs, 'readdirSync', (directory, ...args) => {
    assert.notEqual(directory, path.join(atlasRoot, 'dist'), 'A symlinked directory must not be traversed');
    assert.notEqual(directory, outside);
    return readDirectory.call(fs, directory, ...args);
  });
  assert.equal(view.freshness().status, 'stale');
  const refreshed = view.refresh();
  assert.equal(refreshed.status, 'invalid');
  assert.ok(refreshed.validation.diagnostics.some((diagnostic) => diagnostic.code === 'atlas.reference.symlink'));
  assert.equal(refreshed.readDocument('dist/source.md').status, 'missing');
});

test('explicit target changes during resolved validation invalidate the opened observation', (t) => {
  const atlasRoot = copyAtlas(t);
  fs.mkdirSync(path.join(atlasRoot, 'dist'));
  const target = path.join(atlasRoot, 'dist/source.md');
  fs.writeFileSync(target, 'Before resolution.');
  replaceFile(atlasRoot, 'catalog.json', 'docs/authentication.md', 'dist/source.md');
  const stat = fs.statSync;
  let changed = false;
  t.mock.method(fs, 'statSync', (file, ...args) => {
    if (file === target && !changed) {
      changed = true;
      fs.writeFileSync(target, 'Changed during resolved target verification.');
    }
    return stat.call(fs, file, ...args);
  });
  const view = openAtlas(atlasRoot);
  assert.equal(changed, true);
  assert.equal(view.status, 'incomplete');
  assert.equal(view.identity.digest, null);
  assert.equal(view.validation.normalized, undefined);
  assert.ok(view.validation.diagnostics.some((diagnostic) => diagnostic.code === 'atlas.processing.io'));
});

test('invalid drafts expose captured source and diagnostics without normalized or assembled meaning', (t) => {
  const atlasRoot = copyAtlas(t);
  const draft = '---\n{"type": "point", invalid JSON}\n---\n\nAn unfinished draft.\n';
  fs.writeFileSync(path.join(atlasRoot, anchorPath), draft);
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'invalid');
  assert.equal(view.validation.complete, true);
  assert.equal(Object.hasOwn(view.validation, 'normalized'), false);
  const raw = view.readDocument(anchorPath);
  assert.equal(raw.status, 'read');
  assert.equal(raw.text, draft);
  assert.equal(Buffer.from(raw.bytesBase64, 'base64').toString('utf8'), draft);
  assert.ok(raw.diagnostics.length > 0);
  const inspection = view.inspectPoint('edge-authentication');
  assert.equal(inspection.status, 'invalid');
  assert.equal(Object.hasOwn(inspection, 'point'), false);
  assert.deepEqual(view.find('edge').items, []);
});

test('raw truncation preserves full input identity and exposes the captured byte limit', (t) => {
  const atlasRoot = copyAtlas(t);
  fs.writeFileSync(path.join(atlasRoot, 'docs/large.md'), 'Long supporting source text.\n'.repeat(50));
  const complete = openAtlas(atlasRoot);
  const bounded = openAtlas(atlasRoot, { maxDocumentBytes: 40 });
  assert.equal(bounded.status, 'ready');
  assert.equal(bounded.identity.inputDigest, complete.identity.inputDigest);
  const raw = bounded.readDocument('docs/large.md');
  assert.equal(raw.status, 'truncated');
  assert.equal(raw.truncated, true);
  assert.equal(Buffer.from(raw.bytesBase64, 'base64').length, 40);
  assert.ok(raw.input.byteLength > 40);
});

test('comparison separates raw source edits from changed normalized records', (t) => {
  const atlasRoot = copyAtlas(t);
  const initial = openAtlas(atlasRoot);
  replaceFile(atlasRoot, anchorPath, '"id": "edge-authentication"', '"id" : "edge-authentication"');
  const formatting = initial.refresh();
  const sourceOnly = initial.compare(formatting);
  assert.equal(sourceOnly.status, 'compared');
  assert.deepEqual(sourceOnly.sourceChanges, [{ path: anchorPath, change: 'changed' }]);
  assert.deepEqual(sourceOnly.records, []);
  replaceFile(atlasRoot, anchorPath, '# Authenticate at the edge', '# Authenticate at the gateway');
  const changed = formatting.refresh();
  const semantic = formatting.compare(changed);
  assert.deepEqual(semantic.records.map(({ key, change }) => ({ key, change })), [{ key: 'point:edge-authentication', change: 'changed' }]);
  assert.equal(semantic.records[0].before.title, 'Authenticate at the edge');
  assert.equal(semantic.records[0].after.title, 'Authenticate at the gateway');
  assert.equal(semantic.before.digest, formatting.identity.digest);
  assert.equal(semantic.after.digest, changed.identity.digest);
  fs.writeFileSync(path.join(atlasRoot, anchorPath), 'Unfinished draft.\n');
  const invalid = changed.refresh();
  assert.equal(changed.compare(invalid).status, 'unavailable');
  assert.deepEqual(changed.compare(invalid).records, []);
  assert.throws(() => initial.compare({}), toolError('atlas.tools.invalid-argument'));
});

test('FTS5 search keeps exact identity, matching records, and deterministic complete pagination', (t) => {
  const view = openAtlas(copyAtlas(t));
  const exact = view.find('edge-authentication', { types: ['point'] });
  assert.equal(exact.items[0].id, 'edge-authentication');
  assert.equal(exact.items[0].exactMatch, true);
  assert.ok(exact.items[0].score > 0);
  assert.equal(exact.identity.digest, view.identity.digest);
  assert.equal(exact.identity.inputs, undefined);
  assert.equal(exact.query.mode, 'ranked');
  const complete = view.find('edge', { types: ['point'] });
  const first = view.find('edge', { types: ['point'], limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = view.find('EDGE', { types: ['point'], limit: 1, cursor: first.nextCursor });
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items], complete.items);
  assert.equal(new Set(complete.items.map((item) => item.id)).size, 2);
  assert.ok(complete.items.every((item) => item.reasons.length > 0));
  const relation = view.find('"operational key rotation practice"', { types: ['point'], mode: 'fts' });
  assert.deepEqual(relation.items.map((item) => item.id), ['edge-authentication']);
  assert.equal(view.inspectPoint('edge').status, 'not-found');
});

test('FTS5 evaluates each Point record separately and preserves matching context provenance', (t) => {
  const atlasRoot = copyAtlas(t);
  const contextPath = 'maps/operations/points/edge-authentication.md';
  fs.appendFileSync(path.join(atlasRoot, anchorPath), '\nquartzmarker authenticates an exact boundary.\n');
  fs.appendFileSync(path.join(atlasRoot, contextPath), '\nzirconmarker schedules operational attention.\n');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready');
  assert.equal(view.find('quartzmarker AND zirconmarker', { mode: 'fts', types: ['point'] }).total, 0);
  const matches = view.find('zirconmarker', { types: ['point'] });
  assert.equal(matches.total, 1);
  assert.equal(matches.items[0].id, 'edge-authentication');
  assert.equal(matches.items[0].matches[0].path, contextPath);
  assert.equal(matches.items[0].matches[0].recordKind, 'context');
  assert.match(matches.items[0].matches[0].excerpt, /zirconmarker/u);
  assert.equal(view.find('zirconmarker?', { types: ['point'] }).total, 1);
});

test('FTS5 indexes Area References in the Area and containing Map document', (t) => {
  const atlasRoot = copyAtlas(t);
  const mapPath = 'maps/architecture/map.md';
  const file = path.join(atlasRoot, 'connections.json');
  const connections = JSON.parse(fs.readFileSync(file, 'utf8'));
  connections.references.push(
    { id: 'map-reference', owner: { type: 'map', map: 'architecture' }, target: { uri: 'https://example.com/mapreference' }, role: 'evidence' },
    { id: 'area-reference', owner: { type: 'area', map: 'architecture', area: 'boundary' }, target: { uri: 'https://example.com/areareference' }, role: 'evidence' },
  );
  fs.writeFileSync(file, JSON.stringify(connections));
  replaceFile(atlasRoot, mapPath, '## Area: security', '### Connection: area-reference\n\nareareferencemarker\n\n## Area: security');
  fs.appendFileSync(path.join(atlasRoot, mapPath), '\n## Connection: map-reference\n\nmapreferencemarker\n');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready');
  for (const [type, id, marker, uriTerm] of [
    ['map', 'architecture', 'mapreferencemarker', 'mapreference'],
    ['area', 'boundary', 'areareferencemarker', 'areareference'],
  ]) {
    const result = view.find(marker, { mode: 'fts', types: [type] });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].type, type);
    assert.equal(result.items[0].id, id);
    assert.equal(result.items[0].matches[0].path, mapPath);
    assert.match(result.items[0].matches[0].excerpt, new RegExp(marker, 'u'));
    assert.equal(view.find(uriTerm, { types: [type] }).total, 1);
  }
  const enclosing = view.find('mapreferencemarker AND areareferencemarker', { mode: 'fts' });
  assert.equal(enclosing.total, 1);
  assert.equal(enclosing.items[0].type, 'map');
  assert.equal(enclosing.items[0].id, 'architecture');
});

test('FTS5 mode and syntax stay explicit, with stable public query errors', (t) => {
  const view = openAtlas(copyAtlas(t));
  assert.throws(() => view.find('"unterminated', { mode: 'fts' }), toolError('atlas.tools.invalid-argument'));
  assert.throws(() => view.find('edge', { mode: 'unknown' }), toolError('atlas.tools.invalid-argument'));
  assert.throws(() => view.find('edge', { root: '/' }), toolError('atlas.tools.invalid-argument'));
  assert.throws(() => view.find('x'.repeat(4097)), toolError('atlas.tools.invalid-argument'));
  const first = view.find('edge', { types: ['point'], limit: 1 });
  assert.throws(() => view.find('edge', { mode: 'fts', types: ['point'], cursor: first.nextCursor }), toolError('atlas.tools.invalid-cursor'));
  assert.equal(view.find('edge', { types: [] }).total, 0);
  assert.equal(view.find('"edge"', { mode: 'fts', types: ['point'] }).total, 2);
});

test('search includes explained Area membership context', (t) => {
  const atlasRoot = copyAtlas(t);
  replaceFile(atlasRoot, anchorPath,
    'This record affects Boundary because canonical context for authenticate at the edge.',
    'This membership explains perimetercheckpoint responsibilities.');
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.find('perimetercheckpoint', { types: ['point'] }).items.map((item) => item.id), ['edge-authentication']);
});

test('continuation rejects a changed view, query, type selection, or malformed cursor', (t) => {
  const atlasRoot = copyAtlas(t);
  const view = openAtlas(atlasRoot);
  const { nextCursor } = view.find('edge', { types: ['point'], limit: 1 });
  assert.ok(nextCursor);
  for (const [query, options] of [
    ['different', { types: ['point'], cursor: nextCursor }],
    ['edge', { types: ['map'], cursor: nextCursor }],
    ['edge', { types: ['point'], cursor: 'not-a-cursor' }],
  ]) assert.throws(() => view.find(query, options), toolError('atlas.tools.invalid-cursor'));
  fs.writeFileSync(path.join(atlasRoot, 'docs/new.md'), 'New source.\n');
  assert.throws(() => view.refresh().find('edge', { types: ['point'], cursor: nextCursor }), toolError('atlas.tools.invalid-cursor'));
});

test('null options produce stable public errors instead of incidental JavaScript failures', async (t) => {
  const atlasRoot = copyAtlas(t);
  const view = openAtlas(atlasRoot);
  assert.throws(() => openAtlas(atlasRoot, null), toolError('atlas.tools.invalid-argument'));
  assert.throws(() => view.find('edge', null), toolError('atlas.tools.invalid-argument'));
  await assert.rejects(async () => view.readSource({ resource: 'authentication-guide' }, null), toolError('atlas.tools.invalid-argument'));
});

test('an interrupted source read yields incomplete diagnostics without an identity or normalized output', (t) => {
  const atlasRoot = copyAtlas(t);
  const target = path.join(atlasRoot, anchorPath);
  const open = fs.openSync, read = fs.readSync;
  let targetFd, interrupted = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    const fd = open.call(fs, file, ...args);
    if (file === target) targetFd = fd;
    return fd;
  });
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    if (fd === targetFd && !interrupted) {
      interrupted = true;
      throw Object.assign(new Error('Controlled interrupted read'), { code: 'EIO' });
    }
    return read.call(fs, fd, ...args);
  });
  const view = openAtlas(atlasRoot);
  assert.equal(interrupted, true);
  assert.equal(view.status, 'incomplete');
  assert.equal(view.identity.digest, null);
  assert.equal(Object.hasOwn(view.validation, 'normalized'), false);
  assert.ok(view.validation.diagnostics.some((item) => item.code === 'atlas.processing.io'));
  assert.equal(view.inspectPoint('edge-authentication').status, 'incomplete');
  assert.equal(view.readDocument(anchorPath).status, 'unreadable');
});

test('a file that changes during inventory is not exposed as a ready view', (t) => {
  const atlasRoot = copyAtlas(t);
  const target = path.join(atlasRoot, anchorPath);
  const open = fs.openSync, stat = fs.fstatSync;
  let targetFd, stats = 0;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    const fd = open.call(fs, file, ...args);
    if (file === target) targetFd = fd;
    return fd;
  });
  t.mock.method(fs, 'fstatSync', (fd, ...args) => {
    const result = stat.call(fs, fd, ...args);
    if (fd === targetFd && ++stats === 2) return { ...result, mtimeNs: result.mtimeNs + 1n };
    return result;
  });
  const view = openAtlas(atlasRoot);
  assert.ok(stats >= 2);
  assert.equal(view.status, 'incomplete');
  assert.equal(view.identity.digest, null);
  assert.equal(view.validation.normalized, undefined);
  assert.equal(view.readDocument(anchorPath).status, 'unreadable');
});

test('a saved edit between inventory and validation invalidates the observed identity', (t) => {
  const atlasRoot = copyAtlas(t);
  const target = path.join(atlasRoot, anchorPath);
  const read = fs.readFileSync;
  let changed = false;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === target && !changed) {
      changed = true;
      const source = read.call(fs, file, 'utf8');
      fs.writeFileSync(file, source.replace('# Authenticate at the edge', '# Authenticate at the gateway'));
    }
    return read.call(fs, file, ...args);
  });
  const view = openAtlas(atlasRoot);
  assert.equal(changed, true);
  assert.equal(view.status, 'incomplete');
  assert.equal(view.identity.digest, null);
  assert.equal(view.validation.normalized, undefined);
  assert.ok(view.validation.diagnostics.some((item) => /changed while/u.test(item.message)));
});


test('special structural containers inventory ignored names that change validation without traversing their children', async (t) => {
  for (const container of ['.checks', '.publication', 'maps/architecture/points']) await t.test(container, (t) => {
    const atlasRoot = copyAtlas(t);
    fs.mkdirSync(path.join(atlasRoot, container), { recursive: true });
    const before = openAtlas(atlasRoot);
    assert.equal(before.status, 'ready');
    const excluded = path.join(atlasRoot, container, '.cache');
    fs.mkdirSync(excluded);
    fs.writeFileSync(path.join(excluded, 'unrelated.md'), 'This invalid child directory need not be traversed.');
    const open = fs.openSync;
    t.mock.method(fs, 'openSync', (file, ...args) => {
      assert.notEqual(file, path.join(excluded, 'unrelated.md'));
      return open.call(fs, file, ...args);
    });
    assert.equal(before.freshness().status, 'stale');
    const after = openAtlas(atlasRoot);
    assert.equal(after.status, 'invalid');
    assert.ok(after.identity.inputs.some((input) => input.path === `${container}/.cache` && input.kind === 'directory'));
  });
});

test('an atlas-named Point is a captured structural record rather than a nested Atlas boundary', (t) => {
  const atlasRoot = copyAtlas(t);
  const file = 'maps/architecture/points/atlas.md';
  const source = '---\n{"type":"point","record":"anchor","id":"atlas","posture":"asserted","lifecycle":"active"}\n---\n\n# Atlas identity\n\nAn exact legal Point id remains a Point.\n';
  fs.writeFileSync(path.join(atlasRoot, file), source);
  const view = openAtlas(atlasRoot);
  assert.equal(view.status, 'ready');
  assert.equal(view.inspectPoint('atlas').status, 'found');
  assert.equal(view.readDocument(file).text, source);
  fs.appendFileSync(path.join(atlasRoot, file), '\nAn explicit update.\n');
  assert.equal(view.freshness().status, 'stale');
});
