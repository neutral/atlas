// This Python reader is a separately written implementation derived from the
// written contracts. Its author previously implemented the Library's JSON and
// Markdown helper and saw Library code: this is not blind author independence.
// Agreement on these fixtures does not establish full conformance, source truth,
// semantic usefulness, or independence from shared interpretation errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tempDirectory } from '../support/temp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAtlas } from '../../library/src/model.mjs';

const reader = fileURLToPath(new URL('./independent-reader.py', import.meta.url));
const manifestPath = 'atlas.json';
const serviceTree = 'trees/service/tree.json';
const proofTree = 'trees/proofs/tree.json';
const holdingPath = 'trees/service/points/detail/holding.md';
const decisionPath = 'trees/service/points/chosen.md';
const observedPath = 'trees/proofs/points/observed.md';
const serviceFacet = 'trees/service/facets/perspective.md';
const proofFacet = 'trees/proofs/facets/perspective.md';
const checkPath = '.checks/evidence.md';
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;

function fixture() {
  return new Map([
    [manifestPath, json({ format: 'atlas/1', id: 'example', title: 'Service and evidence', trees: ['trees/service', 'trees/proofs'] })],
    [serviceTree, json({ id: 'service', title: 'Service', scope: 'Participant responsibilities and service continuity.', base: 'purpose', children: [
      { branch: 'custody', title: 'Custody', children: [{ point: 'holding', children: [{ point: 'shutdown' }] }] },
      { point: 'chosen' },
    ] })],
    [proofTree, json({ id: 'proofs', title: 'Proofs', scope: 'Evidence construction and verification.', base: 'proofs-base', children: [
      { branch: 'validation', title: 'Validation', children: [{ point: 'observed' }] },
    ] })],
    ['trees/service/points/purpose.md', markdown({ id: 'purpose' }, 'Service purpose', 'The service coordinates participant work. Higher placement does not prove support.')],
    [holdingPath, markdown({ id: 'holding', uncertainty: 'Retention cost has not been measured.', sources: [
      { uri: '../external/source.md#custody', role: 'evidence', title: 'Custody record', revision: 'revision-7', locator: 'Custody section', sha256: 'a'.repeat(64) },
    ] }, 'Holders preserve material', 'Holders preserve receipts for their intended uses. A [link](../chosen.md) adds no structural home.\n\n```markdown\n# An example heading inside code\n```')],
    ['trees/service/points/detail/shutdown.md', markdown({ id: 'shutdown' }, 'Shutdown ends this service', 'Shutdown ends the current service relationship. It does not establish what other uses can continue.')],
    [decisionPath, markdown({ id: 'chosen', type: 'decision', status: 'selected', sources: [{ uri: 'sources/decision.md', role: 'history' }] }, 'Select custody policy', 'The decision selects this policy. Selection does not establish implementation.')],
    ['trees/proofs/points/base.md', markdown({ id: 'proofs-base' }, 'Evidence has construction requirements', 'Proof construction requires the relevant inputs and verified transitions.')],
    [observedPath, markdown({ id: 'observed', type: 'observation', observedAt: '2024-02-29T23:59:59.123Z', sources: [{ uri: 'https://example.test/report#results', role: 'evidence' }] }, 'Observed proof result', 'The recorded observation applies to the measured run. It does not establish continuing validity. Evidence label: α 😀.')],
    [serviceFacet, markdown({ id: 'perspective', on: { point: 'holding' }, via: 'proofs', targets: [{ point: 'observed' }, { branch: 'validation' }, { tree: 'proofs' }], sources: [{ uri: 'sources/review.md', role: 'background' }] }, 'Custody does not replace proof inputs', 'The service account interprets custody through the evidence account. Retention alone cannot establish that a proof is constructible.')],
    [proofFacet, markdown({ id: 'perspective', on: { branch: 'validation' }, via: 'service', targets: [{ point: 'shutdown' }] }, 'Validation has a service boundary', 'This interpretation addresses the validation Branch as a whole. It does not automatically qualify every descendant.')],
    [checkPath, markdown({ id: 'evidence', status: 'active', level: 'required' }, 'Evidence review', '## Requirement\n\nChanged claims retain their evidence boundary.\n\n## Verification\n\nInspect the changed claim and its cited support.\n\n## Failure\n\nReport unsupported claims as failing.\n\n## Exceptions\n\nNone.')],
  ]);
}

function changeJson(files, filename, update) {
  const value = JSON.parse(files.get(filename));
  update(value);
  files.set(filename, json(value));
}

function changeHeader(files, filename, update) {
  const lines = files.get(filename).split('\n');
  const header = JSON.parse(lines[1]);
  update(header);
  lines[1] = JSON.stringify(header);
  files.set(filename, lines.join('\n'));
}

async function materialize(t, files) {
  const root = await tempDirectory('atlas-independent-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [filename, content] of files) {
    const target = path.join(root, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

function independentlyRead(root) {
  const result = spawnSync('python3', [reader, root], { encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.stderr, '', 'The independent reader must return structured diagnostics rather than a traceback.');
  return { code: result.status, value: JSON.parse(result.stdout) };
}

function normative(atlas) {
  // format belongs to the enclosing Library record. Check revision is a derived
  // Library observation field, outside the independent reader's normalized API.
  const { format: _format, ...result } = structuredClone(atlas);
  result.checks = result.checks.map(({ revision: _revision, ...check }) => check);
  for (const kind of ['points', 'branches', 'facets', 'checks']) {
    result[kind].sort((left, right) => {
      const a = `${left.tree ?? ''}/${left.id}`, b = `${right.tree ?? ''}/${right.id}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return result;
}

async function rejectedByBoth(root) {
  const independent = independentlyRead(root);
  const library = await openAtlas(root);
  assert.equal(independent.code, 1);
  assert.ok(['invalid', 'incomplete'].includes(independent.value.status));
  assert.ok(independent.value.diagnostics.length);
  assert.equal(Object.hasOwn(independent.value, 'points'), false, 'Rejected observations expose no accepted normalized Atlas.');
  assert.notEqual(library.status, 'ready');
  assert.equal(library.atlas, null);
  return independent.value;
}

test('separately written reader agrees on ownership, ancestry, Facets, Types, sources and Checks', async (t) => {
  const root = await materialize(t, fixture());
  const independent = independentlyRead(root);
  const library = await openAtlas(root);
  assert.equal(independent.code, 0, JSON.stringify(independent.value));
  assert.equal(library.status, 'ready', JSON.stringify(library.diagnostics));
  assert.deepEqual(independent.value, normative(library.atlas));
  assert.deepEqual(independent.value.points.find((point) => point.id === 'shutdown').ancestors, [
    { kind: 'point', id: 'purpose', tree: 'service' },
    { kind: 'branch', id: 'custody', tree: 'service' },
    { kind: 'point', id: 'holding', tree: 'service' },
  ]);
  assert.equal(independent.value.facets.filter((facet) => facet.id === 'perspective').length, 2, 'Facet IDs are Tree-local.');
  assert.equal(independent.value.points.find((point) => point.id === 'holding').sources[0].uri, '../external/source.md#custody');
  assert.equal(independent.value.points.find((point) => point.id === 'observed').observedAt, '2024-02-29T23:59:59.123Z');
});

test('empty Atlas, CRLF, Setext title and ignored editor state agree', async (t) => {
  const empty = await materialize(t, new Map([[manifestPath, json({ format: 'atlas/1', id: 'empty', title: 'Empty', trees: [] })]]));
  assert.deepEqual(independentlyRead(empty).value, normative((await openAtlas(empty)).atlas));
  const files = fixture();
  files.set(holdingPath, files.get(holdingPath).replace('# Holders preserve material', 'Holders preserve material\n=========================').replaceAll('\n', '\r\n'));
  files.set('.atlas-state/drafts/not-authored.json', 'This is not an authored record.');
  files.set('trees/service/points/.atlas-write-interrupted', 'Incomplete temporary bytes are excluded.');
  files.set('sources/reference.md', 'Reference material is not an authored Point.');
  const root = await materialize(t, files);
  const independent = independentlyRead(root);
  const library = await openAtlas(root);
  assert.equal(independent.code, 0, JSON.stringify(independent.value));
  assert.equal(library.status, 'ready', JSON.stringify(library.diagnostics));
  assert.deepEqual(independent.value, normative(library.atlas));
});

const invalidCases = [
  ['duplicate decoded JSON key', (files) => files.set(manifestPath, '{"format":"atlas/1","id":"example","\\u0069d":"other","title":"Example","trees":[]}'), 'I_JSON_DUPLICATE'],
  ['unsafe integer', (files) => files.set(manifestPath, '{"format":"atlas/1","id":"example","title":9007199254740993,"trees":[]}'), 'I_JSON_NUMBER'],
  ['nonfinite exponent', (files) => files.set(manifestPath, '{"format":"atlas/1","id":"example","title":1e400,"trees":[]}'), 'I_JSON_NUMBER'],
  ['unpaired Unicode escape', (files) => files.set(manifestPath, '{"format":"atlas/1","id":"example","title":"\\ud800","trees":[]}'), 'I_JSON_UNICODE'],
  ['malformed UTF-8', (files) => files.set(manifestPath, Buffer.from([0xff])), 'I_UTF8'],
  ['trailing JSON', (files) => files.set(manifestPath, files.get(manifestPath) + '{}'), 'I_JSON_SYNTAX'],
  ['unknown manifest field', (files) => changeJson(files, manifestPath, (value) => { value.root = '/elsewhere'; })],
  ['unknown Tree field', (files) => changeJson(files, serviceTree, (value) => { value.alias = 'legacy'; })],
  ['unknown Point field', (files) => changeHeader(files, holdingPath, (value) => { value.kind = 'claim'; })],
  ['unknown Facet field', (files) => changeHeader(files, serviceFacet, (value) => { value.shared = true; })],
  ['unknown source field', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].trusted = true; })],
  ['unknown placement field', (files) => changeJson(files, serviceTree, (value) => { value.children[1].label = 'extra'; })],
  ['unknown Check field', (files) => changeHeader(files, checkPath, (value) => { value.execute = 'program'; })],
  ['foreign Point ownership', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'observed' }); })],
  ['multiple Point homes', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'holding' }); })],
  ['unplaced discovered Point', (files) => files.set('trees/service/points/unplaced.md', markdown({ id: 'unplaced' }, 'Unplaced', 'This has no structural home.'))],
  ['dangling outline Point', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'missing' }); })],
  ['duplicate Point identity', (files) => changeHeader(files, observedPath, (value) => { value.id = 'holding'; })],
  ['duplicate Branch identity', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ branch: 'custody', title: 'Other', children: [{ point: 'chosen' }] }); })],
  ['foreign Base', (files) => changeJson(files, serviceTree, (value) => { value.base = 'proofs-base'; })],
  ['Base placed again', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'purpose' }); })],
  ['empty Branch', (files) => changeJson(files, serviceTree, (value) => { value.children[0].children = []; })],
  ['foreign Facet host', (files) => changeHeader(files, proofFacet, (value) => { value.on = { point: 'holding' }; })],
  ['self Facet', (files) => changeHeader(files, serviceFacet, (value) => { value.via = 'service'; })],
  ['dangling Facet Tree', (files) => changeHeader(files, serviceFacet, (value) => { value.via = 'missing'; })],
  ['dangling Facet Point', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = [{ point: 'missing' }]; })],
  ['Facet target in wrong Tree', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = [{ point: 'holding' }]; })],
  ['Facet Tree target mismatch', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = [{ tree: 'service' }]; })],
  ['ambiguous Facet pointer', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = [{ point: 'observed', branch: 'validation' }]; })],
  ['empty Facet target list', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = []; })],
  ['duplicate Tree-local Facet', (files) => files.set('trees/service/facets/duplicate.md', files.get(serviceFacet))],
  ['unsupported format', (files) => changeJson(files, manifestPath, (value) => { value.format = 'atlas/0'; })],
  ['unsupported Type', (files) => changeHeader(files, holdingPath, (value) => { value.type = 'claim'; })],
  ['decision without status', (files) => changeHeader(files, decisionPath, (value) => { delete value.status; })],
  ['status on untyped Point', (files) => changeHeader(files, holdingPath, (value) => { value.status = 'selected'; })],
  ['invalid observation calendar date', (files) => changeHeader(files, observedPath, (value) => { value.observedAt = '2023-02-29'; })],
  ['observation without sources', (files) => changeHeader(files, observedPath, (value) => { value.sources = []; })],
  ['Check missing Verification H2', (files) => files.set(checkPath, files.get(checkPath).replace('## Verification', '### Verification'))],
  ['header delimiter whitespace', (files) => files.set(holdingPath, files.get(holdingPath).replace(/^---/, '--- '))],
  ['empty Point explanation', (files) => files.set(holdingPath, markdown({ id: 'holding' }, 'Holders preserve material', '  '))],
  ['first heading is H2', (files) => files.set(holdingPath, files.get(holdingPath).replace('# Holders', '## Holders'))],
  ['extra H1', (files) => files.set(holdingPath, files.get(holdingPath) + '\n# Other title\n\nOther text.')],
  ['Tree directory overlap', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/service/nested'); })],
  ['case alias', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/SERVICE'); })],
  ['non-NFC Tree path', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/cafe\u0301'); })],
  ['reserved Tree path', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/.atlas-private'); })],
  ['escaping Tree path', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('../outside'); })],
  ['executable source URI', (files) => changeHeader(files, holdingPath, (value) => { value.sources = [{ uri: 'javascript:alert(1)' }]; })],
  ['source URL credentials', (files) => changeHeader(files, holdingPath, (value) => { value.sources = [{ uri: 'https://user:password@example.test/evidence' }]; })],
];

test('both readers reject malformed records and invalid structural relationships', async (t) => {
  for (const [name, mutate, diagnostic] of invalidCases) {
    await t.test(name, async (subtest) => {
      const files = fixture();
      mutate(files);
      const root = await materialize(subtest, files);
      const result = await rejectedByBoth(root);
      if (diagnostic) assert.equal(result.diagnostics[0].code, diagnostic);
      assert.deepEqual(independentlyRead(root).value, result, 'Independent diagnostics must be deterministic.');
    });
  }
});

test('both readers reject authored symlinks and oversized authored files', async (t) => {
  const root = await materialize(t, fixture());
  const original = path.join(root, holdingPath);
  const retained = path.join(root, 'holding-source.md');
  await fs.rename(original, retained);
  await fs.symlink(retained, original);
  assert.equal((await rejectedByBoth(root)).diagnostics[0].code, 'I_SYMLINK');
  await fs.unlink(original);
  await fs.rename(retained, original);
  await fs.writeFile(original, markdown({ id: 'holding' }, 'Holders preserve material', 'x'.repeat(2 * 1024 * 1024)));
  assert.equal((await rejectedByBoth(root)).status, 'incomplete');
});

test('independent reader agrees on a captured Atlas 1.1 Style and rejects missing or conflicting selection', async t => {
  const files = fixture();
  changeJson(files, 'atlas.json', manifest => { manifest.format = 'atlas/1.1'; manifest.style = 'style.md'; });
  files.set('style.md', markdown({ id: 'local-style', revision: '1', derivedFrom: 'concise-subjects revision 1' }, 'Local account policy', 'Trees own durable subjects. Retain the explanation needed to choose a source.'));
  const root = await materialize(t, files);
  const independent = independentlyRead(root), library = await openAtlas(root);
  assert.equal(independent.code, 0, JSON.stringify(independent.value));
  assert.equal(library.status, 'ready', JSON.stringify(library.diagnostics));
  assert.deepEqual(independent.value.style, library.atlas.style);
  await fs.rm(path.join(root, 'style.md'));
  await rejectedByBoth(root);
  await fs.writeFile(path.join(root, 'style.md'), files.get('style.md'));
  for (const style of ['trees/service/style.md', '.checks/style.md', '../style.md', 'style.json']) {
    const manifest = JSON.parse(files.get('atlas.json')); manifest.style = style;
    await fs.writeFile(path.join(root, 'atlas.json'), json(manifest));
    await rejectedByBoth(root);
  }
});

test('independent manifest dispatch rejects non-objects without an implementation traceback', async t => {
  const root = await materialize(t, fixture());
  for (const content of ['[]', 'null', '"atlas/1.1"', '1', 'false', '0', '""']) {
    await fs.writeFile(path.join(root, 'atlas.json'), content);
    await rejectedByBoth(root);
  }
});


test('declared Tree records reject falsy JSON instead of disappearing from the normalized Atlas', async t => {
  const root = await materialize(t, new Map([['atlas.json', json({ format: 'atlas/1', id: 'example', title: 'Example', trees: ['trees/empty'] })], ['trees/empty/tree.json', 'null']]));
  for (const content of ['null', 'false', '0', '""']) {
    await fs.writeFile(path.join(root, 'trees/empty/tree.json'), content);
    await rejectedByBoth(root);
  }
});
