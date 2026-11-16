// This Python reader is a separately written implementation of the format
// contract (spec/spec/FORMAT.md and spec/SPEC.md); it imports
// and runs no Library code. Its authors have read the Library, so agreement on
// these fixtures shows that the contract states enough for two readers to
// reach the same view: the same status, captured files, identity and
// normalized Atlas, and diagnostics the Library also reports. It does not
// establish full conformance, source truth, semantic usefulness, or
// independence from shared interpretation errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tempDirectory } from '../support/temp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAtlas, validateFiles } from '../../library/src/model.mjs';

const reader = fileURLToPath(new URL('./independent-reader.py', import.meta.url));
const manifestPath = 'atlas.json';
const stylePath = 'style.md';
const serviceTree = 'trees/service/tree.json';
const proofTree = 'trees/proofs/tree.json';
const purposePath = 'trees/service/points/purpose.md';
const holdingPath = 'trees/service/points/detail/holding.md';
const decisionPath = 'trees/service/points/chosen.md';
const observedPath = 'trees/proofs/points/observed.md';
const serviceFacet = 'trees/service/facets/perspective.md';
const proofFacet = 'trees/proofs/facets/perspective.md';
const checkPath = '.checks/evidence.md';
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const style = '# Local account policy\n\nTrees own durable subjects. Retain the explanation needed to choose a source.\n';
const check = (sections) => markdown({ id: 'evidence', status: 'active', level: 'required' }, 'Evidence review', sections.map(([name, text]) => `## ${name}\n\n${text}`).join('\n\n'));
const checkSections = [['Requirement', 'Changed claims retain their evidence boundary.'], ['Verification', 'Inspect the changed claim and its cited support.'], ['Failure', 'Report unsupported claims as failing.'], ['Exceptions', 'None.']];
const nested = (depth) => JSON.parse('['.repeat(depth) + ']'.repeat(depth));

function fixture() {
  return new Map([
    [manifestPath, json({ format: 'atlas/1.2', id: 'example', title: 'Service and evidence', trees: ['trees/service', 'trees/proofs'] })],
    [stylePath, style],
    [serviceTree, json({ id: 'service', title: 'Service', scope: 'Participant responsibilities and service continuity.', base: 'purpose', children: [
      { point: 'holding', children: [{ point: 'shutdown' }] },
      { point: 'chosen' },
    ] })],
    [proofTree, json({ id: 'proofs', title: 'Proofs', scope: 'Evidence construction and verification.', base: 'proofs-base', children: [
      { point: 'observed' },
    ] })],
    [purposePath, markdown({ id: 'purpose' }, 'Service purpose', 'The service coordinates participant work. Higher placement does not prove support.')],
    [holdingPath, markdown({ id: 'holding', uncertainty: 'Retention cost has not been measured.', sources: [
      { uri: '../external/source.md#custody', role: 'evidence', title: 'Custody record', revision: 'revision-7', locator: 'Custody section', sha256: 'a'.repeat(64) },
    ] }, 'Holders preserve material', 'Holders preserve receipts for their intended uses. A [link](../chosen.md) adds no structural home.\n\n```markdown\n# An example heading inside code\n```')],
    ['trees/service/points/detail/shutdown.md', markdown({ id: 'shutdown' }, 'Shutdown ends this service', 'Shutdown ends the current service relationship. It does not establish what other uses can continue.')],
    [decisionPath, markdown({ id: 'chosen', type: 'decision', status: 'selected', sources: [{ uri: 'sources/decision.md', role: 'history' }] }, 'Select custody policy', 'The decision selects this policy. Selection does not establish implementation.')],
    ['trees/proofs/points/base.md', markdown({ id: 'proofs-base' }, 'Evidence has construction requirements', 'Proof construction requires the relevant inputs and verified transitions.')],
    [observedPath, markdown({ id: 'observed', type: 'observation', observedAt: '2024-02-29T23:59:59.123Z', sources: [{ uri: 'https://example.test/report#results', role: 'evidence' }] }, 'Observed proof result', 'The recorded observation applies to the measured run. It does not establish continuing validity. Evidence label: α 😀.')],
    [serviceFacet, markdown({ id: 'perspective', on: 'holding', via: 'proofs', targets: ['observed', 'proofs-base'], sources: [{ uri: 'sources/review.md', role: 'background' }] }, 'Custody does not replace proof inputs', 'The service account interprets custody through the evidence account. Retention alone cannot establish that a proof is constructible.')],
    [proofFacet, markdown({ id: 'perspective', on: 'observed', via: 'service', targets: ['shutdown'] }, 'Validation has a service boundary', 'This reading addresses the observed result through the service account. It does not qualify other proofs.')],
    [checkPath, check(checkSections)],
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

function replace(files, filename, from, to) {
  assert.ok(files.get(filename).includes(from), `${filename} holds ${from}`);
  files.set(filename, files.get(filename).replace(from, to));
}

const point = (atlas, id) => atlas.points.find((item) => item.id === id);

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
  const result = spawnSync('python3', [reader, root], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.stderr, '', 'The independent reader must return structured diagnostics rather than a traceback.');
  return { code: result.status, view: JSON.parse(result.stdout) };
}

// FORMAT.md, View identity, followed from its words over the Library's captured files.
function contractIdentity(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = file.content === null ? Buffer.from(file.rawBase64, 'base64') : Buffer.from(file.content, 'utf8');
    hash.update(`${Buffer.byteLength(file.path)}:`).update(file.path).update(`${bytes.length}:`).update(bytes);
  }
  return hash.digest('hex');
}

// Both readers capture the same files, in the same order, under the same identity and status.
function sameView(independent, library) {
  assert.equal(independent.format, library.format);
  assert.equal(independent.status, library.status, JSON.stringify({ independent: independent.diagnostics, library: library.diagnostics }));
  assert.equal(independent.root, library.root);
  assert.deepEqual(independent.files, library.files);
  assert.equal(independent.identity, library.identity);
  assert.equal(contractIdentity(library.files), library.identity);
}

async function agree(root) {
  const { code, view } = independentlyRead(root);
  const library = await openAtlas(root);
  assert.equal(library.status, 'ready', JSON.stringify(library.diagnostics));
  assert.equal(code, 0, JSON.stringify(view.diagnostics));
  sameView(view, library);
  assert.deepEqual(view.diagnostics, []);
  assert.deepEqual(view.atlas, library.atlas);
  return view.atlas;
}

async function rejectedByBoth(root) {
  const { code, view } = independentlyRead(root);
  const library = await openAtlas(root);
  assert.notEqual(library.status, 'ready', 'The Library accepted what the independent reader rejected.');
  assert.equal(code, 1, JSON.stringify(view));
  sameView(view, library);
  assert.equal(view.atlas, null);
  assert.equal(library.atlas, null);
  assert.ok(view.diagnostics.length);
  for (const item of view.diagnostics) {
    assert.ok(library.diagnostics.some((other) => other.code === item.code && other.path === item.path),
      `The Library does not report ${item.code} at ${item.path}: ${JSON.stringify(library.diagnostics)}`);
  }
  return view;
}

test('separately written reader agrees on ownership, ancestry, Facets, Types, sources, the Style and Checks', async (t) => {
  const atlas = await agree(await materialize(t, fixture()));
  assert.deepEqual(point(atlas, 'shutdown').ancestors, [
    { id: 'purpose', tree: 'service' },
    { id: 'holding', tree: 'service' },
  ]);
  assert.deepEqual(point(atlas, 'purpose').ancestors, []);
  assert.equal(atlas.facets.filter((facet) => facet.id === 'perspective').length, 2, 'Facet IDs are Tree-local.');
  assert.deepEqual(atlas.facets.find((facet) => facet.tree === 'service').targets, ['observed', 'proofs-base']);
  assert.equal(atlas.facets.find((facet) => facet.tree === 'proofs').on, 'observed');
  assert.equal(point(atlas, 'holding').sources[0].uri, '../external/source.md#custody');
  assert.equal(point(atlas, 'observed').observedAt, '2024-02-29T23:59:59.123Z');
  assert.deepEqual(atlas.style, { title: 'Local account policy', body: 'Trees own durable subjects. Retain the explanation needed to choose a source.', path: 'style.md' });
  assert.deepEqual(atlas.points.map((item) => item.id), ['chosen', 'holding', 'shutdown', 'purpose', 'proofs-base', 'observed'], 'Points are in reading order.');
});

test('the view identity hashes each path and its bytes, as the contract shows', () => {
  const view = validateFiles(new Map([['atlas.json', '{}']]));
  assert.equal(view.identity, createHash('sha256').update('10:atlas.json2:{}').digest('hex'));
});

test('empty Atlas, CRLF, Setext title, a candidate folder and temporary files agree', async (t) => {
  await agree(await materialize(t, new Map([[manifestPath, json({ format: 'atlas/1.2', id: 'empty', title: 'Empty', trees: [] })], [stylePath, style]])));
  const files = fixture();
  files.set(holdingPath, files.get(holdingPath).replace('# Holders preserve material', 'Holders preserve material\n=========================').replaceAll('\n', '\r\n'));
  files.set(stylePath, style.replaceAll('\n', '\r\n'));
  for (const [filename, content] of fixture()) files.set(`.atlas-candidate/${filename}`, content);
  files.set('.atlas-candidate/trees/service/points/unplaced.md', markdown({ id: 'unplaced' }, 'Unplaced', 'A candidate is not the Atlas.'));
  files.set('trees/service/points/.atlas-write-interrupted', 'Incomplete temporary bytes are excluded.');
  files.set('sources/reference.md', 'Reference material is not an authored Point.');
  await agree(await materialize(t, files));
});

test('a link to a record with a fragment is a reference matter, not a reason to reject the Atlas', async (t) => {
  const files = fixture();
  files.set(holdingPath, files.get(holdingPath).replace('[link](../chosen.md)', '[link](../chosen.md#select-custody-policy)'));
  await agree(await materialize(t, files));
});

const acceptedCases = [
  ['a Point may have the ID of a Tree', (files) => { changeHeader(files, purposePath, (value) => { value.id = 'proofs'; }); changeJson(files, serviceTree, (value) => { value.base = 'proofs'; }); }],
  ['Checks may nest under .checks', (files) => files.set('.checks/nested/other.md', files.get(checkPath).replace('"id":"evidence"', '"id":"other"'))],
  ['text before a Check Requirement', (files) => replace(files, checkPath, '## Requirement', 'Intro text.\n\n## Requirement')],
  ['an empty Exceptions section', (files) => files.set(checkPath, check([...checkSections.slice(0, 3), ['Exceptions', '']]))],
  ['an H3 inside a required section', (files) => replace(files, checkPath, 'evidence boundary.', 'evidence boundary.\n\n### Detail\n\nMore detail.')],
  ['a section title with inline markup', (files) => replace(files, checkPath, '## Requirement', '## *Requirement*')],
  ['a retired Check', (files) => changeHeader(files, checkPath, (value) => { value.status = 'retired'; })],
  ['an empty children array on a placement', (files) => changeJson(files, serviceTree, (value) => { value.children[1].children = []; })],
  ['empty sources on an untyped Point and on a Facet', (files) => { changeHeader(files, purposePath, (value) => { value.sources = []; }); changeHeader(files, serviceFacet, (value) => { value.sources = []; }); }],
  ['a Facet with uncertainty', (files) => changeHeader(files, serviceFacet, (value) => { value.uncertainty = 'Not measured.'; })],
  ['an observation dated with an offset', (files) => changeHeader(files, observedPath, (value) => { value.observedAt = '2024-01-01T10:00:00+05:30'; })],
  ['an observation dated by a day of year 0000', (files) => changeHeader(files, observedPath, (value) => { value.observedAt = '0000-02-29'; })],
  ['an observation dated to nine fraction digits', (files) => changeHeader(files, observedPath, (value) => { value.observedAt = '2024-01-01T10:00:00.123456789-00:00'; })],
  ['sources with a percent-encoded space, an uppercase scheme and an empty fragment', (files) => changeHeader(files, holdingPath, (value) => { value.sources = [{ uri: 'sources/a%20b.md' }, { uri: 'HTTPS://EXAMPLE.TEST/x' }, { uri: 'sources/a.md#' }, { uri: 'sources/café.md#x#y' }]; })],
  ['text and a comment before the title stay in the body', (files) => replace(files, purposePath, '# Service purpose', 'Lead-in sentence.\n\n<!-- note -->\n# Service purpose'),
    (atlas) => assert.equal(point(atlas, 'purpose').body, 'Lead-in sentence.\n\n<!-- note -->\n\nThe service coordinates participant work. Higher placement does not prove support.')],
  ['a two-line Setext title', (files) => replace(files, purposePath, '# Service purpose', 'Service\npurpose\n==='), (atlas) => assert.equal(point(atlas, 'purpose').title, 'Service purpose')],
  ['a Setext title in the Style', (files) => files.set(stylePath, 'Local account policy\n===\n\nTrees own durable subjects.\n'), (atlas) => assert.equal(atlas.style.title, 'Local account policy')],
  ['a title with inline markup and a closing sequence', (files) => replace(files, purposePath, '# Service purpose', '# Service *purpose* `x` ##'), (atlas) => assert.equal(point(atlas, 'purpose').title, 'Service purpose x')],
  ['a title with a reference, escapes, a link, an image and inline HTML', (files) => replace(files, purposePath, '# Service purpose', '# Service &amp; \\*purpose\\* [link](x.md) ![image](x.png) <em>HTML</em> <!-- c -->'),
    (atlas) => assert.equal(point(atlas, 'purpose').title, 'Service & *purpose* link image HTML')],
  ['a title whose delimiters do not all match', (files) => replace(files, purposePath, '# Service purpose', '# Service **purpose* a_b_c'), (atlas) => assert.equal(point(atlas, 'purpose').title, 'Service *purpose a_b_c')],
  ['a header over several lines', (files) => replace(files, purposePath, '{"id":"purpose"}', '{\n  "id": "purpose"\n}')],
  ['a body of one fenced code block', (files) => files.set(purposePath, markdown({ id: 'purpose' }, 'Service purpose', '```\ncode\n```'))],
  ['a body of one autolink', (files) => files.set(purposePath, markdown({ id: 'purpose' }, 'Service purpose', '<https://example.test/policy>'))],
  ['a body with a digit among markup characters', (files) => files.set(purposePath, markdown({ id: 'purpose' }, 'Service purpose', '** 1 __'))],
  ['an H1 inside a list item is not a title', (files) => files.set(purposePath, files.get(purposePath) + '\n- # Listed heading\n')],
  ['a dangling link and a link to a heading in the same record', (files) => replace(files, holdingPath, '[link](../chosen.md)', '[link](../missing.md) [here](#holders-preserve-material)')],
  ['an empty .checks directory', (files) => { files.delete(checkPath); files.set('.checks/.keep-dir/.atlas-write-x', ''); }],
  ['a file named .atlas-candidate at the root', (files) => files.set('.atlas-candidate', 'x')],
  ['an ID of 100 characters', (files) => changeJson(files, manifestPath, (value) => { value.id = 'a'.repeat(100); })],
  ['U+0085 is not white space', (files) => changeJson(files, manifestPath, (value) => { value.title = '\u0085'; })],
  ['a JSON file with CR line endings', (files) => files.set(manifestPath, files.get(manifestPath).replaceAll('\n', '\r'))],
  ['paths sort by UTF-16 code units', (files) => {
    files.set('trees/service/points/\uff21.md', markdown({ id: 'wide' }, 'Wide', 'A full-width letter sorts after a surrogate pair.'));
    files.set('trees/service/points/\u{1f600}.md', markdown({ id: 'smile' }, 'Smile', 'A surrogate pair sorts before U+FF21.'));
    changeJson(files, serviceTree, (value) => { value.children.push({ point: 'wide' }, { point: 'smile' }); });
  }, (atlas) => assert.deepEqual(atlas.points.slice(4, 6).map((item) => item.id), ['smile', 'wide'])],
];

test('both readers accept what the contract allows and normalize it alike', async (t) => {
  for (const [name, mutate, inspect] of acceptedCases) {
    await t.test(name, async (subtest) => {
      const files = fixture();
      mutate(files);
      const atlas = await agree(await materialize(subtest, files));
      inspect?.(atlas);
    });
  }
});

const body = (text) => (files) => files.set(purposePath, markdown({ id: 'purpose' }, 'Service purpose', text));
const date = (text) => (files) => changeHeader(files, observedPath, (value) => { value.observedAt = text; });
const source = (value) => (files) => changeHeader(files, holdingPath, (header) => { header.sources = [value]; });

const invalidCases = [
  ['duplicate decoded JSON key', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","\\u0069d":"other","title":"Example","trees":[]}'), 'JSON_DUPLICATE_KEY'],
  ['unsafe integer', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","title":9007199254740993,"trees":[]}'), 'JSON_NUMBER'],
  ['nonfinite exponent', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","title":1e400,"trees":[]}'), 'JSON_NUMBER'],
  ['an integer-valued exponent above the safe range', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","title":1e300,"trees":[]}'), 'JSON_NUMBER'],
  ['unpaired Unicode escape', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","title":"\\ud800","trees":[]}'), 'JSON_UNICODE'],
  ['a Unicode escape without four hexadecimal digits', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","title":"\\u12g4","trees":[]}'), 'JSON_UNICODE'],
  ['malformed UTF-8', (files) => files.set(manifestPath, Buffer.from([0xff])), 'FILE_UTF8'],
  ['a Point that is not UTF-8', (files) => files.set(purposePath, Buffer.concat([Buffer.from(files.get(purposePath)), Buffer.from([0xff])])), 'FILE_UTF8'],
  ['trailing JSON', (files) => files.set(manifestPath, files.get(manifestPath) + '{}'), 'JSON_SYNTAX'],
  ['NaN', (files) => files.set(manifestPath, '{"format":"atlas/1.2","id":"example","title":NaN,"trees":[]}'), 'JSON_SYNTAX'],
  ['128 nested arrays and objects are read', (files) => changeJson(files, manifestPath, (value) => { value.title = nested(127); }), 'TEXT_REQUIRED'],
  ['129 nested arrays and objects', (files) => changeJson(files, manifestPath, (value) => { value.title = nested(128); }), 'JSON_LIMIT'],
  ['100000 JSON values are read', (files) => changeJson(files, manifestPath, (value) => { value.title = new Array(99993).fill(0); }), 'TEXT_REQUIRED'],
  ['100001 JSON values', (files) => changeJson(files, manifestPath, (value) => { value.title = new Array(99994).fill(0); }), 'JSON_LIMIT'],
  ['unknown manifest field', (files) => changeJson(files, manifestPath, (value) => { value.root = '/elsewhere'; }), 'FIELD_UNKNOWN'],
  ['manifest names a Style', (files) => changeJson(files, manifestPath, (value) => { value.style = 'style.md'; }), 'FIELD_UNKNOWN'],
  ['unknown Tree field', (files) => changeJson(files, serviceTree, (value) => { value.alias = 'legacy'; }), 'FIELD_UNKNOWN'],
  ['unknown Point field', (files) => changeHeader(files, holdingPath, (value) => { value.kind = 'claim'; }), 'FIELD_UNKNOWN'],
  ['unknown Facet field', (files) => changeHeader(files, serviceFacet, (value) => { value.shared = true; }), 'FIELD_UNKNOWN'],
  ['unknown source field', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].trusted = true; }), 'SOURCE_INVALID'],
  ['unknown placement field', (files) => changeJson(files, serviceTree, (value) => { value.children[1].label = 'extra'; }), 'FIELD_UNKNOWN'],
  ['unknown Check field', (files) => changeHeader(files, checkPath, (value) => { value.execute = 'program'; }), 'FIELD_UNKNOWN'],
  ['a Facet with a type', (files) => changeHeader(files, serviceFacet, (value) => { value.type = 'decision'; }), 'FIELD_UNKNOWN'],
  ['a Check with sources', (files) => changeHeader(files, checkPath, (value) => { value.sources = []; }), 'FIELD_UNKNOWN'],
  ['a Branch placement', (files) => changeJson(files, serviceTree, (value) => { value.children[1] = { branch: 'custody', title: 'Custody', children: [{ point: 'chosen' }] }; }), 'FIELD_UNKNOWN'],
  ['a Point file among Facets', (files) => files.set('trees/service/facets/stray.md', markdown({ id: 'stray' }, 'Stray', 'A Point header in a Facet folder.')), 'FIELD_REQUIRED'],
  ['foreign Point ownership', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'observed' }); }), 'POINT_OWNER'],
  ['multiple Point homes', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'holding' }); }), 'POINT_MULTIPLE_HOME'],
  ['unplaced discovered Point', (files) => files.set('trees/service/points/unplaced.md', markdown({ id: 'unplaced' }, 'Unplaced', 'This has no structural home.')), 'POINT_UNPLACED'],
  ['dangling outline Point', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'missing' }); }), 'POINT_MISSING'],
  ['duplicate Point identity', (files) => changeHeader(files, observedPath, (value) => { value.id = 'holding'; }), 'POINT_DUPLICATE'],
  ['foreign Base', (files) => changeJson(files, serviceTree, (value) => { value.base = 'proofs-base'; }), 'POINT_OWNER'],
  ['Base placed again', (files) => changeJson(files, serviceTree, (value) => { value.children.push({ point: 'purpose' }); }), 'POINT_MULTIPLE_HOME'],
  ['Tree children that are not an array', (files) => changeJson(files, serviceTree, (value) => { value.children = {}; }), 'ARRAY_INVALID'],
  ['placement children that are not an array', (files) => changeJson(files, serviceTree, (value) => { value.children[1].children = 'x'; }), 'ARRAY_INVALID'],
  ['foreign Facet host', (files) => changeHeader(files, proofFacet, (value) => { value.on = 'holding'; }), 'FACET_HOST'],
  ['dangling Facet host', (files) => changeHeader(files, proofFacet, (value) => { value.on = 'missing'; }), 'FACET_HOST'],
  ['Facet host as a pointer object', (files) => changeHeader(files, proofFacet, (value) => { value.on = { point: 'observed' }; }), 'ID_INVALID'],
  ['self Facet', (files) => changeHeader(files, serviceFacet, (value) => { value.via = 'service'; }), 'FACET_SELF'],
  ['dangling Facet Tree', (files) => changeHeader(files, serviceFacet, (value) => { value.via = 'missing'; }), 'FACET_TREE'],
  ['dangling Facet Point', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = ['missing']; }), 'FACET_TARGET'],
  ['Facet target in wrong Tree', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = ['holding']; }), 'FACET_TARGET'],
  ['Facet target naming a Tree', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = ['proofs']; }), 'FACET_TARGET'],
  ['Facet target as a pointer object', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = [{ point: 'observed' }]; }), 'ID_INVALID'],
  ['duplicate Facet target', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = ['observed', 'observed']; }), 'TARGET_DUPLICATE'],
  ['empty Facet target list', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = []; }), 'ARRAY_INVALID'],
  ['Facet targets as a string', (files) => changeHeader(files, serviceFacet, (value) => { value.targets = 'observed'; }), 'ARRAY_INVALID'],
  ['duplicate Tree-local Facet', (files) => files.set('trees/service/facets/duplicate.md', files.get(serviceFacet)), 'FACET_DUPLICATE'],
  ['format atlas/1.1', (files) => changeJson(files, manifestPath, (value) => { value.format = 'atlas/1.1'; }), 'FORMAT_UNSUPPORTED'],
  ['format atlas/1', (files) => changeJson(files, manifestPath, (value) => { value.format = 'atlas/1'; }), 'FORMAT_UNSUPPORTED'],
  ['an ID of 101 characters', (files) => changeJson(files, manifestPath, (value) => { value.id = 'a'.repeat(101); }), 'ID_INVALID'],
  ['an ID with an uppercase letter', (files) => changeJson(files, manifestPath, (value) => { value.id = 'Example'; }), 'ID_INVALID'],
  ['an ID that begins with a hyphen', (files) => changeJson(files, manifestPath, (value) => { value.id = '-x'; }), 'ID_INVALID'],
  ['a blank manifest title', (files) => changeJson(files, manifestPath, (value) => { value.title = ' '; }), 'TEXT_REQUIRED'],
  ['a manifest title of U+FEFF and U+3000', (files) => changeJson(files, manifestPath, (value) => { value.title = '\ufeff\u3000'; }), 'TEXT_REQUIRED'],
  ['a numeric manifest title', (files) => changeJson(files, manifestPath, (value) => { value.title = 3; }), 'TEXT_REQUIRED'],
  ['a blank Tree title', (files) => changeJson(files, serviceTree, (value) => { value.title = ''; }), 'TEXT_REQUIRED'],
  ['a blank Tree scope', (files) => changeJson(files, serviceTree, (value) => { value.scope = ' '; }), 'TEXT_REQUIRED'],
  ['a blank uncertainty', (files) => changeHeader(files, holdingPath, (value) => { value.uncertainty = ' '; }), 'TEXT_REQUIRED'],
  ['unsupported Type', (files) => changeHeader(files, holdingPath, (value) => { value.type = 'claim'; }), 'TYPE_UNSUPPORTED'],
  ['decision without status', (files) => changeHeader(files, decisionPath, (value) => { delete value.status; }), 'DECISION_STATUS'],
  ['an unsupported decision status', (files) => changeHeader(files, decisionPath, (value) => { value.status = 'accepted'; }), 'DECISION_STATUS'],
  ['status on untyped Point', (files) => changeHeader(files, holdingPath, (value) => { value.status = 'selected'; }), 'STATUS_TYPE'],
  ['status on an observation', (files) => changeHeader(files, observedPath, (value) => { value.status = 'selected'; }), 'STATUS_TYPE'],
  ['observedAt on untyped Point', (files) => changeHeader(files, holdingPath, (value) => { value.observedAt = '2024-01-01'; }), 'DATE_TYPE'],
  ['invalid observation calendar date', date('2023-02-29'), 'OBSERVATION_DATE'],
  ...['2024-01', '2024-1-01', '2024-01-01T10:00Z', '2024-01-01T10:00:00', '2024-01-01T10:00:00.1234567890Z', '2024-01-01t10:00:00z', '2016-12-31T23:59:60Z', '2024-01-01T24:00:00Z', '2024-01-01T10:00:00+24:00']
    .map((text) => [`the date ${text}`, date(text), 'OBSERVATION_DATE']),
  ['observation without sources', (files) => changeHeader(files, observedPath, (value) => { value.sources = []; }), 'OBSERVATION_SOURCE'],
  ['invalid source stamp', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].sha256 = 'A'.repeat(64); }), 'SOURCE_INVALID'],
  ...['javascript:alert(1)', 'https://user:password@example.test/evidence', '/etc/passwd', '#x', 'sources/a.md?x=1', 'sources/a.md#x?y', 'sources%2fa.md', 'sources%5Ca.md',
    'sources/a b.md', 'http://', 'https://example.test:99999/', 'mailto:a@example.test', 'ftp://example.test/x', 'file:///etc/hosts', 'sources\\a.md', 'C:/a.md', 'C%3a/a.md',
    'sources/%zz.md', 'sources/%c3.md', 'sources/a%00.md']
    .map((uri) => [`the source URI ${uri}`, source({ uri }), 'SOURCE_INVALID']),
  ['a source that is not an object', source('sources/a.md'), 'SOURCE_INVALID'],
  ['a blank source title', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].title = ' '; }), 'SOURCE_INVALID'],
  ['a numeric source title', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].title = 1.5; }), 'SOURCE_INVALID'],
  ['an unknown source role', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].role = 'proof'; }), 'SOURCE_INVALID'],
  ['a blank source revision', (files) => changeHeader(files, holdingPath, (value) => { value.sources[0].revision = ''; }), 'SOURCE_INVALID'],
  ['Check missing Verification H2', (files) => replace(files, checkPath, '## Verification', '### Verification'), 'CHECK_SECTION'],
  ['Check sections out of order', (files) => files.set(checkPath, check([checkSections[1], checkSections[0], checkSections[2]])), 'CHECK_SECTION'],
  ['Check required section without content', (files) => files.set(checkPath, check([checkSections[0], ['Verification', '<!-- to do -->'], checkSections[2]])), 'CHECK_SECTION'],
  ['a Requirement of markup characters alone', (files) => files.set(checkPath, check([['Requirement', '** __'], ...checkSections.slice(1)])), 'CHECK_SECTION'],
  ['a Check with another H2', (files) => files.set(checkPath, check([...checkSections, ['Notes', 'More.']])), 'CHECK_SECTION'],
  ['a lowercase section name', (files) => replace(files, checkPath, '## Requirement', '## requirement'), 'CHECK_SECTION'],
  ['Exceptions before Failure', (files) => files.set(checkPath, check([checkSections[0], checkSections[1], checkSections[3], checkSections[2]])), 'CHECK_SECTION'],
  ['Exceptions twice', (files) => files.set(checkPath, check([...checkSections, checkSections[3]])), 'CHECK_SECTION'],
  ['an unsupported Check level', (files) => changeHeader(files, checkPath, (value) => { value.level = 'optional'; }), 'CHECK_LEVEL'],
  ['an unsupported Check status', (files) => changeHeader(files, checkPath, (value) => { value.status = 'enabled'; }), 'CHECK_STATUS'],
  ['duplicate Check ID', (files) => files.set('.checks/second.md', files.get(checkPath)), 'CHECK_DUPLICATE'],
  ['a file that is not .md among Points', (files) => files.set('trees/service/points/notes.txt', 'notes'), 'RECORD_EXTENSION'],
  ['.DS_Store among Points', (files) => files.set('trees/service/points/.DS_Store', 'x'), 'RECORD_EXTENSION'],
  ['an uppercase .MD extension', (files) => files.set('trees/service/points/extra.MD', 'x'), 'RECORD_EXTENSION'],
  ['a file that is not .md among Checks', (files) => files.set('.checks/README.txt', 'x'), 'RECORD_EXTENSION'],
  ['header delimiter whitespace', (files) => files.set(holdingPath, files.get(holdingPath).replace(/^---/, '--- ')), 'MARKDOWN_HEADER'],
  ['a header that is not an object', (files) => files.set(holdingPath, files.get(holdingPath).replace(/^---\n.*\n---/, '---\n[]\n---')), 'MARKDOWN_HEADER'],
  ['a byte order mark before a header', (files) => files.set(purposePath, '\ufeff' + files.get(purposePath)), 'MARKDOWN_HEADER'],
  ['a byte order mark before the manifest', (files) => files.set(manifestPath, '\ufeff' + files.get(manifestPath)), 'JSON_SYNTAX'],
  ['a byte order mark before the Style title', (files) => files.set(stylePath, '\ufeff' + style), 'MARKDOWN_TITLE'],
  ['lone CR line endings', (files) => files.set(purposePath, files.get(purposePath).replaceAll('\n', '\r')), 'MARKDOWN_LINE_ENDING'],
  ['a lone CR inside a body', (files) => replace(files, purposePath, 'participant work.', 'participant\rwork.'), 'MARKDOWN_LINE_ENDING'],
  ['a lone CR in the Style', (files) => files.set(stylePath, style.replace('subjects.', 'subjects.\r')), 'MARKDOWN_LINE_ENDING'],
  ['empty Point explanation', body('  '), 'MARKDOWN_BODY'],
  ['Point explanation of headings and comments alone', body('## Detail\n\n<!-- to be written -->'), 'MARKDOWN_BODY'],
  ...['![](x.png)', '***', '<div></div>', '** __', '&amp;', '&nbsp;', '> # Quoted heading', '[source]: evidence.md', '```js\n```', '[](https://example.test)']
    .map((text) => [`a body of ${JSON.stringify(text)}`, body(text), 'MARKDOWN_BODY']),
  ['first heading is H2', (files) => replace(files, holdingPath, '# Holders', '## Holders'), 'MARKDOWN_TITLE'],
  ['extra H1', (files) => files.set(holdingPath, files.get(holdingPath) + '\n# Other title\n\nOther text.'), 'MARKDOWN_TITLE'],
  ['a blank H1', (files) => replace(files, holdingPath, '# Holders preserve material', '#'), 'MARKDOWN_TITLE'],
  ['missing Style', (files) => files.delete(stylePath), 'STYLE_REQUIRED'],
  ['a Style of white space', (files) => files.set(stylePath, ' \n\t\n'), 'STYLE_REQUIRED'],
  ['Style with a JSON header', (files) => files.set(stylePath, markdown({ id: 'local-style', revision: '1' }, 'Local account policy', 'Trees own durable subjects.')), 'MARKDOWN_HEADER'],
  ['a Style that begins with a --- line', (files) => files.set(stylePath, '---\n' + style), 'MARKDOWN_HEADER'],
  ['Style without a body', (files) => files.set(stylePath, '# Local account policy\n\n'), 'MARKDOWN_BODY'],
  ['Style of headings alone', (files) => files.set(stylePath, '# Local account policy\n\n## Accounts\n'), 'MARKDOWN_BODY'],
  ['a Style body of a comment alone', (files) => files.set(stylePath, '# Local account policy\n\n<!-- to be written -->\n'), 'MARKDOWN_BODY'],
  ['Style without a title', (files) => files.set(stylePath, 'Trees own durable subjects.\n'), 'MARKDOWN_TITLE'],
  ['a second H1 in the Style', (files) => files.set(stylePath, style + '\n# Another\n\nMore.\n'), 'MARKDOWN_TITLE'],
  ['Tree directory overlap', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/service/nested'); }), 'TREE_OVERLAP'],
  ['a Tree directory listed twice', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/service'); }), 'TREE_OVERLAP'],
  ['case alias', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/SERVICE'); }), 'TREE_OVERLAP'],
  ['non-NFC Tree path', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/cafe\u0301'); }), 'TREE_PATH'],
  ['reserved Tree path', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/.atlas-private'); }), 'TREE_PATH'],
  ['the candidate folder as a Tree', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('.atlas-candidate/trees/service'); }), 'TREE_PATH'],
  ['escaping Tree path', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('../outside'); }), 'TREE_PATH'],
  ['a Tree directory at .checks', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('.checks'); }), 'TREE_PATH'],
  ['a Tree directory inside style.md', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('style.md/x'); }), 'TREE_PATH'],
  ['a Tree path with a colon', (files) => changeJson(files, manifestPath, (value) => { value.trees.push('trees/a:b'); }), 'TREE_PATH'],
  ['a .atlas-write- directory among Points', (files) => files.set('trees/service/points/.atlas-write-x/inner.md', 'x'), 'PATH_UNSAFE'],
  ['a .atlas-candidate folder among Points', (files) => files.set('trees/service/points/.atlas-candidate/x.md', 'x'), 'PATH_UNSAFE'],
  ['a missing tree.json', (files) => files.delete(proofTree), 'FILE_MISSING'],
  ['a missing atlas.json', (files) => files.delete(manifestPath), 'FILE_MISSING'],
];

test('both readers reject malformed records and invalid structural relationships for the same stated reason', async (t) => {
  for (const [name, mutate, diagnostic] of invalidCases) {
    await t.test(name, async (subtest) => {
      const files = fixture();
      mutate(files);
      const root = await materialize(subtest, files);
      const result = await rejectedByBoth(root);
      assert.ok(result.diagnostics.some((item) => item.code === diagnostic), JSON.stringify(result.diagnostics));
      assert.deepEqual(independentlyRead(root).view, result, 'Independent diagnostics must be deterministic.');
    });
  }
});

test('both readers reject authored symlinks and oversized authored files', async (t) => {
  const root = await materialize(t, fixture());
  for (const relative of [holdingPath, stylePath]) {
    const original = path.join(root, relative);
    const retained = path.join(root, 'retained-source.md');
    await fs.rename(original, retained);
    await fs.symlink(retained, original);
    assert.ok((await rejectedByBoth(root)).diagnostics.some((item) => item.code === 'PATH_SYMLINK' && item.path === relative));
    await fs.unlink(original);
    await fs.rename(retained, original);
  }
  await fs.writeFile(path.join(root, holdingPath), markdown({ id: 'holding' }, 'Holders preserve material', 'x'.repeat(2 * 1024 * 1024)));
  const oversized = await rejectedByBoth(root);
  assert.equal(oversized.status, 'incomplete');
  assert.ok(oversized.diagnostics.some((item) => item.code === 'READ_LIMIT' && item.path === holdingPath));
});

test('independent manifest dispatch rejects non-objects without an implementation traceback', async t => {
  const root = await materialize(t, fixture());
  for (const content of ['[]', 'null', '"atlas/1.2"', '1', 'false', '0', '""']) {
    await fs.writeFile(path.join(root, 'atlas.json'), content);
    assert.ok((await rejectedByBoth(root)).diagnostics.some((item) => item.code === 'RECORD_OBJECT'));
  }
});

test('declared Tree records reject falsy JSON instead of disappearing from the normalized Atlas', async t => {
  const root = await materialize(t, new Map([['atlas.json', json({ format: 'atlas/1.2', id: 'example', title: 'Example', trees: ['trees/empty'] })], [stylePath, style], ['trees/empty/tree.json', 'null']]));
  for (const content of ['null', 'false', '0', '""']) {
    await fs.writeFile(path.join(root, 'trees/empty/tree.json'), content);
    assert.ok((await rejectedByBoth(root)).diagnostics.some((item) => item.code === 'RECORD_OBJECT'));
  }
});
