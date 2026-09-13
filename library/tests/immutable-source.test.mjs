import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openAtlasSnapshot } from '../src/immutable-source.mjs';
import { AtlasToolError, localSourceTargets, openAtlas } from '../src/view.mjs';
import { validateAtlas } from '../src/validator.mjs';

const examples = fileURLToPath(new URL('../../spec/examples/', import.meta.url));
const anchor = 'atlas/maps/architecture/points/edge-authentication.md';
const guide = 'atlas/docs/authentication.md';

function fixtureInput(fixture = 'valid/cross-map') {
  const root = path.join(examples, fixture);
  const files = {}, directories = [];
  function visit(directory, prefix) {
    directories.push(prefix);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relativePath = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(file, relativePath);
      else if (entry.isFile()) files[relativePath] = fs.readFileSync(file);
      else throw new Error(`Fixture contains unsupported source entry ${relativePath}`);
    }
  }
  visit(root, 'atlas');
  return { repositoryRoot: '/sealed/atlas-snapshot-test', atlasPath: 'atlas', files, directories, revision: 'example-revision' };
}

function prohibitHostReads(t) {
  const calls = [];
  t.after(() => assert.deepEqual(calls, [], 'Snapshot must not attempt host filesystem reads, even when errors are caught.'));
  for (const method of ['lstatSync', 'statSync', 'readdirSync', 'readFileSync', 'openSync', 'readSync', 'fstatSync', 'readlinkSync', 'realpathSync']) {
    t.mock.method(fs, method, () => { calls.push(method); throw new Error(`Snapshot touched host filesystem: ${method}`); });
  }
}

test('sealed snapshots preserve every registered fixture resolved outcome and normalized model', (t) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(examples, 'manifest.json'), 'utf8'));
  const cases = [...new Set(manifest.fixtures.map((fixture) => fixture.path))].map((fixture) => ({
    fixture, input: fixtureInput(fixture), expected: validateAtlas(path.join(examples, fixture)),
  }));
  prohibitHostReads(t);
  for (const { fixture, input, expected } of cases) {
    const actual = openAtlasSnapshot(input).validation;
    assert.equal(actual.complete, expected.complete, fixture);
    assert.equal(actual.valid, expected.valid, fixture);
    assert.deepEqual(actual.diagnostics.map((diagnostic) => diagnostic.code), expected.diagnostics.map((diagnostic) => diagnostic.code), fixture);
    assert.deepEqual(actual.normalized, expected.normalized, fixture);
  }
});

test('snapshot validation and all reading operations use only cloned bytes without a host filesystem fallback', async (t) => {
  const input = fixtureInput();
  const expected = validateAtlas(path.join(examples, 'valid/cross-map')).normalized;
  const expectedGuide = input.files[guide].toString('utf8');
  prohibitHostReads(t);
  const view = openAtlasSnapshot(input);
  assert.equal(view.status, 'ready');
  assert.equal(view.identity.scope.kind, 'snapshot');
  assert.equal(view.identity.consistency, 'immutable-snapshot');
  assert.equal(view.identity.scope.revision, 'example-revision');
  assert.deepEqual(view.validation.normalized, expected);
  assert.equal(view.inspectPoint('edge-authentication').status, 'found');
  assert.equal(view.inspectResource('authentication-guide').uses.length, 2);
  assert.equal(view.find('edge', { types: ['point'] }).total, 2);
  assert.match(view.readDocument(anchor.slice(6)).text, /Authenticate at the edge/u);
  const source = await view.readSource({ resource: 'authentication-guide' });
  assert.equal(source.status, 'read');
  assert.equal(source.text, expectedGuide);
  assert.equal(source.observation.kind, 'immutable-file');
  assert.equal(source.observation.repositoryDigest, view.identity.scope.repositoryDigest);
  assert.equal(source.observation.revision, 'example-revision');
  assert.equal(view.freshness().status, 'fresh');
  assert.equal(view.refresh().identity.digest, view.identity.digest);
});

test('caller edits cannot mutate snapshot validation, retained documents, full source bytes, or refresh', async (t) => {
  const input = fixtureInput();
  const original = input.files[guide].toString('utf8');
  const view = openAtlasSnapshot(input, { maxDocumentBytes: 8 });
  input.files[guide].fill(0);
  input.files[anchor] = 'An invalid replacement draft.';
  delete input.files['atlas/atlas.md'];
  input.directories.push('atlas/new-empty-directory');
  prohibitHostReads(t);
  assert.equal(view.readDocument('docs/authentication.md').status, 'truncated');
  assert.equal(Buffer.from(view.readDocument('docs/authentication.md').bytesBase64, 'base64').length, 8);
  assert.equal(view.inspectPoint('edge-authentication').point.title, 'Authenticate at the edge');
  assert.equal((await view.readSource({ resource: 'authentication-guide' })).text, original);
  assert.equal((await view.refresh().readSource({ resource: 'authentication-guide' })).text, original);
  assert.equal(view.freshness().status, 'fresh');
});

test('source reading can reach explicitly authorized sealed repository files but never the host or an absent path', async (t) => {
  const input = fixtureInput();
  input.files['outside.md'] = 'Captured outside the Atlas.';
  input.files['atlas/catalog.json'] = input.files['atlas/catalog.json'].toString('utf8').replace('docs/authentication.md', '../outside.md');
  prohibitHostReads(t);
  const view = openAtlasSnapshot(input);
  assert.equal(view.status, 'ready');
  assert.deepEqual(localSourceTargets(view), [path.join(input.repositoryRoot, 'outside.md')]);
  assert.deepEqual(view.identity.scope.explicitLocalTargets, []);
  assert.throws(() => view.readDocument('../outside.md'), (error) => error.code === 'atlas.tools.invalid-argument');
  assert.equal((await view.readSource({ resource: 'authentication-guide' })).status, 'unrequested');
  const outside = await view.readSource({ resource: 'authentication-guide' }, { allowedRoots: [input.repositoryRoot] });
  assert.equal(outside.status, 'read');
  assert.equal(outside.text, 'Captured outside the Atlas.');
  assert.equal(outside.observation.kind, 'immutable-file');
  const hostOnly = await view.readSource({ uri: '/etc/hosts' }, { allowedRoots: ['/'] });
  assert.equal(hostOnly.status, 'missing');
  const external = await view.readSource({ uri: 'https://example.com/source' });
  assert.equal(external.status, 'unrequested');
  const supplied = await view.readSource({ uri: 'https://example.com/source' }, {
    reader: () => ({ bytes: Buffer.from('Separate external observation.'), provenance: 'Caller reader' }),
  });
  assert.equal(supplied.observation.kind, 'caller-reader');
  assert.equal(supplied.text, 'Separate external observation.');
});

test('snapshot namespaces retain exact paths, missing states, empty directories, and nested Atlas boundaries', (t) => {
  const input = fixtureInput();
  input.directories.push('atlas/empty', 'atlas/nested');
  input.files['atlas/nested/atlas.md'] = 'A separate Atlas boundary.';
  input.files['atlas/nested/source.md'] = 'Explicit nested material.';
  input.files['atlas/catalog.json'] = input.files['atlas/catalog.json'].toString('utf8').replace('docs/authentication.md', 'nested/source.md');
  prohibitHostReads(t);
  const view = openAtlasSnapshot(input);
  assert.equal(view.status, 'ready');
  assert.ok(view.identity.inputs.some((entry) => entry.path === 'empty' && entry.kind === 'directory'));
  assert.equal(view.readDocument('nested/atlas.md').status, 'missing');
  assert.equal(view.readDocument('nested/source.md').text, 'Explicit nested material.');
  const invalid = openAtlasSnapshot({ ...input, files: { ...input.files, 'atlas/catalog.json': input.files['atlas/catalog.json'].replace('nested/source.md', 'Missing.md') } });
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.validation.complete, true);
  assert.equal(invalid.readDocument('Missing.md').input.kind, 'missing');
});

test('snapshot bytes and directory identity are deterministic across input-map order and distinguish full source edits', (t) => {
  const input = fixtureInput();
  const original = openAtlasSnapshot(input, { maxDocumentBytes: 4 });
  const reordered = { ...input, files: Object.fromEntries(Object.entries(input.files).reverse()), directories: [...input.directories].reverse() };
  prohibitHostReads(t);
  assert.equal(openAtlasSnapshot(reordered, { maxDocumentBytes: 4 }).identity.digest, original.identity.digest);
  const changed = openAtlasSnapshot({ ...input, files: { ...input.files, [guide]: `${input.files[guide]}\nNew suffix beyond the retained prefix.` } }, { maxDocumentBytes: 4 });
  assert.equal(changed.readDocument('docs/authentication.md').text, original.readDocument('docs/authentication.md').text);
  assert.notEqual(changed.identity.scope.repositoryDigest, original.identity.scope.repositoryDigest);
  assert.notEqual(changed.identity.digest, original.identity.digest);
  assert.deepEqual(original.compare(changed).records, []);
});

test('snapshot creation rejects traversal, aliases, file-directory conflicts, and unsupported entry values', () => {
  const input = fixtureInput();
  for (const file of ['../escape.md', '/absolute.md', 'atlas//alias.md', 'atlas/./alias.md', 'atlas\\alias.md', 'atlas/../alias.md', 'atlas/nul\0.md']) {
    assert.throws(() => openAtlasSnapshot({ ...input, files: { ...input.files, [file]: 'Source.' } }), (error) => error instanceof AtlasToolError && error.code === 'atlas.tools.invalid-argument');
  }
  for (const files of [{ ...input.files, atlas: 'Conflicting file.' }, { ...input.files, 'atlas/link': { type: 'symlink', target: '/outside' } }, []]) {
    assert.throws(() => openAtlasSnapshot({ ...input, files }), (error) => error.code === 'atlas.tools.invalid-argument');
  }
  assert.throws(() => openAtlasSnapshot({ ...input, atlasPath: '../outside' }), (error) => error.code === 'atlas.tools.invalid-argument');
});
