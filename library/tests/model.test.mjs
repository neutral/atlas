import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink, rm, rename } from 'node:fs/promises';
import { tempDirectory } from '../../tests/support/temp.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openAtlas, validateFiles, getPoint, getTree, getFacet, searchAtlas, compareViews, readSource, validateSource } from '../src/model.mjs';
import { parseStrictJson, parseMarkdown } from '../src/frontmatter.mjs';

const json = value => JSON.stringify(value, null, 2);
const markdown = (header, title, body) => `---\n${json(header)}\n---\n# ${title}\n\n${body}\n`;

function fixture() {
  return new Map([
    ['atlas.json', json({ format: 'atlas/1', id: 'example', title: 'Example', trees: ['trees/service', 'trees/proof'] })],
    ['trees/service/tree.json', json({ id: 'service', title: 'Service', scope: 'Participant duties.', base: 'purpose', children: [{ branch: 'custody', title: 'Custody', children: [{ point: 'holder' }, { point: 'decision', children: [{ point: 'observed' }] }] }] })],
    ['trees/service/points/purpose.md', markdown({ id: 'purpose' }, 'Service purpose', 'Participants retain material for their intended uses.')],
    ['trees/service/points/holder.md', markdown({ id: 'holder', uncertainty: 'Future use may need more material.', sources: [{ uri: 'sources/requirements.md', role: 'evidence' }] }, 'Holder custody', 'Custody preserves evidence for use.')],
    ['trees/service/points/decision.md', markdown({ id: 'decision', type: 'decision', status: 'selected' }, 'Select operator custody', 'This selects the design; it does not establish implementation.')],
    ['trees/service/points/nested/observed.md', markdown({ id: 'observed', type: 'observation', observedAt: '2024-02-29', sources: [{ uri: 'https://example.org/observation#result' }] }, 'Observed result', 'A scoped observation with an explicit date.')],
    ['trees/proof/tree.json', json({ id: 'proof', title: 'Proof', scope: 'Evidence and execution.', base: 'evidence', children: [{ branch: 'inputs', title: 'Inputs', children: [{ point: 'proof-inputs' }] }] })],
    ['trees/proof/points/evidence.md', markdown({ id: 'evidence' }, 'Proof evidence', 'Proofs require sufficient original inputs.')],
    ['trees/proof/points/proof-inputs.md', markdown({ id: 'proof-inputs' }, 'Original proof inputs', 'An accepted receipt does not finish missing source proof.')],
    ['trees/service/facets/holder.md', markdown({ id: 'holder-proof', on: { point: 'holder' }, via: 'proof', targets: [{ point: 'proof-inputs' }, { tree: 'proof' }] }, 'Custody and proof', 'Holder custody cannot substitute for missing proof inputs.')],
    ['trees/service/facets/nested/group.md', markdown({ id: 'group-proof', on: { branch: 'custody' }, via: 'proof', targets: [{ branch: 'inputs' }] }, 'Custody requirements', 'This group depends on sufficient original proof inputs.')],
    ['.checks/evidence.md', markdown({ id: 'evidence-review', status: 'active', level: 'required' }, 'Review evidence', 'Require supporting evidence.\n\n## Requirement\n\nPreserve source limits.\n\n## Verification\n\nInspect the source.\n\n## Failure\n\nReject unsupported claims.')],
  ]);
}

function validate(files = fixture(), options = {}) { return validateFiles(files, { root: '/tmp/atlas-test', ...options }); }
function changeJson(files, file, change) {
  const value = JSON.parse(files.get(file)); change(value); files.set(file, json(value)); return files;
}
function has(view, code) {
  assert.notEqual(view.status, 'ready'); assert.equal(view.atlas, null);
  assert.ok(view.diagnostics.some(item => item.code === code), `${code}: ${JSON.stringify(view.diagnostics)}`);
}
async function diskFixture(t, files = fixture()) {
  const directory = await tempDirectory('atlas-model-');
  const root = path.join(directory, 'atlas');
  await mkdir(root);
  for (const [file, content] of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content); }
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { root, directory };
}

test('normalizes ownership, structural ancestry, Facet targets, and Check revisions', () => {
  const view = validate();
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  assert.equal(view.atlas.points.length, 6);
  assert.equal(view.atlas.branches.length, 2);
  assert.deepEqual(getPoint(view, 'observed').ancestors, [
    { kind: 'point', id: 'purpose', tree: 'service' },
    { kind: 'branch', id: 'custody', tree: 'service' },
    { kind: 'point', id: 'decision', tree: 'service' },
  ]);
  assert.equal(getPoint(view, 'purpose').ancestors.length, 0);
  assert.equal(getPoint(view, 'holder').owner.id, 'service');
  assert.equal(getPoint(view, 'holder').facets[0].id, 'holder-proof');
  assert.equal(getPoint(view, 'proof-inputs').incomingFacets[0].id, 'holder-proof');
  assert.equal(getFacet(view, { tree: 'service', id: 'group-proof' }).host.id, 'custody');
  assert.equal(getFacet(view, { tree: 'service', id: 'group-proof' }).resolvedTargets[0].id, 'inputs');
  assert.equal(getTree(view, 'proof').incomingFacets.length, 2);
  assert.equal(view.atlas.checks[0].revision, createHash('sha256').update(fixture().get('.checks/evidence.md')).digest('hex'));
});

test('strict JSON rejects malformed, duplicate decoded, unsafe numeric, and malformed Unicode input', () => {
  for (const value of ['{"a":1,}', '{"a":1,"\\u0061":2}', '[9007199254740992]', '[1e400]', '"\\ud800"', '"\\udc00"', '{"x":01}', '{} extra']) assert.throws(() => parseStrictJson(value));
  assert.deepEqual(parseStrictJson('{"emoji":"\\ud83d\\ude00","n":12.5}'), { emoji: '😀', n: 12.5 });
  const files = fixture(); files.set('atlas.json', '{"id":"a","\\u0069d":"b"}');
  has(validate(files), 'JSON_DUPLICATE_KEY');
});

test('Markdown requires a strict header, one H1, and nonblank explanation', () => {
  assert.throws(() => parseMarkdown('--- \n{}\n---\n# Title\nBody'), { code: 'MARKDOWN_HEADER' });
  assert.throws(() => parseMarkdown('---\n{}\n---\n## Wrong\nBody'), { code: 'MARKDOWN_TITLE' });
  assert.throws(() => parseMarkdown('---\n{}\n---\n# Title\n'), { code: 'MARKDOWN_BODY' });
  assert.throws(() => parseMarkdown('---\n{}\n---\n# Title\nBody\n# Other'), { code: 'MARKDOWN_TITLE' });
  assert.equal(parseMarkdown('---\r\n{}\r\n---\r\n# Title\r\nBody\r\n```md\r\n# Example\r\n```').title, 'Title');
});

test('Markdown explanations use CommonMark content and ignore empty markup', () => {
  for (const body of ['## Heading only', '<!-- comment -->', '```\n```', '[source]: evidence.md', '<div></div>', '> # Quoted heading']) {
    assert.throws(() => parseMarkdown(markdown({ id: 'point' }, 'Title', body)), { code: 'MARKDOWN_BODY' }, body);
  }
  for (const body of ['A concise explanation.', '```js\nconst observed = true;\n```', '![Observed result](result.png)', '> A scoped quotation.']) {
    assert.equal(parseMarkdown(markdown({ id: 'point' }, 'Title', body)).body, body);
  }
  const parsed = parseMarkdown('---\n{"id":"point"}\n---\nAn **exact** &amp; useful title\n===\n\n<!--\n# This is a comment, not a title.\n-->\n\nUseful explanation.');
  assert.equal(parsed.title, 'An exact & useful title');
});

test('rejects unsupported format, unknown fields, and unsafe/unexpected authored paths', () => {
  has(validate(changeJson(fixture(), 'atlas.json', value => { value.format = 'old/1'; })), 'FORMAT_UNSUPPORTED');
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.owner = 'other'; })), 'FIELD_UNKNOWN');
  const files = fixture(); files.set('trees/service/points/holder.md', markdown({ id: 'holder', tree: 'service' }, 'Holder', 'Body.'));
  has(validate(files), 'FIELD_UNKNOWN');
  has(validate(new Map([['../escape.md', 'x']])), 'PATH_UNSAFE');
  const unexpected = fixture(); unexpected.set('unrelated.txt', 'x'); has(validate(unexpected), 'RECORD_UNEXPECTED');
});

test('reserves editing paths and rejects case or Unicode path aliases', () => {
  const files = fixture();
  files.set('trees/service/points/HOLDER.md', files.get('trees/service/points/holder.md'));
  has(validate(files), 'PATH_ALIAS');
  const unicode = fixture();
  unicode.set('trees/service/points/caf\u00e9.md', markdown({ id: 'accent' }, 'Accent', 'Explanation.'));
  unicode.set('trees/service/points/cafe\u0301.md', markdown({ id: 'accent-other' }, 'Other', 'Explanation.'));
  has(validate(unicode), 'PATH_ALIAS');
  const nonNfc = fixture();
  nonNfc.set('trees/service/points/cafe\u0301.md', markdown({ id: 'accent' }, 'Accent', 'Explanation.'));
  has(validate(nonNfc), 'PATH_UNSAFE');
  has(validate(changeJson(fixture(), 'atlas.json', value => { value.trees.push('.atlas-state'); })), 'TREE_PATH');
  has(validate(changeJson(fixture(), 'atlas.json', value => { value.trees.push('trees/SERVICE'); })), 'TREE_OVERLAP');
  const folders = fixture();
  folders.set('trees/service/points/Part/a.md', markdown({ id: 'a' }, 'A', 'Explanation.'));
  folders.set('trees/service/points/part/b.md', markdown({ id: 'b' }, 'B', 'Explanation.'));
  has(validate(folders), 'PATH_ALIAS');
});

test('rejects missing, duplicate, cross-owner, and unplaced Point identities', () => {
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children.push({ point: 'absent' }); })), 'POINT_MISSING');
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children.push({ point: 'holder' }); })), 'POINT_MULTIPLE_HOME');
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children.push({ point: 'proof-inputs' }); })), 'POINT_OWNER');
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children = []; })), 'POINT_UNPLACED');
  const duplicate = fixture(); duplicate.set('trees/proof/points/duplicate.md', markdown({ id: 'holder' }, 'Duplicate', 'Body.'));
  has(validate(duplicate), 'POINT_DUPLICATE');
});

test('rejects overlapping Trees, duplicate Branches, and mixed placements', () => {
  has(validate(changeJson(fixture(), 'atlas.json', value => { value.trees.push('trees/service/child'); })), 'TREE_OVERLAP');
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children.push({ branch: 'custody', title: 'Again', children: [{ point: 'holder' }] }); })), 'BRANCH_DUPLICATE');
  has(validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children.push({ branch: 'mixed', point: 'holder', title: 'Mixed', children: [] }); })), 'PLACEMENT_KIND');
});

test('Facet attachment and targets resolve within their respective Trees', () => {
  const cases = [
    [{ on: { point: 'proof-inputs' }, via: 'proof', targets: [{ point: 'proof-inputs' }] }, 'FACET_HOST'],
    [{ on: { branch: 'missing' }, via: 'proof', targets: [{ branch: 'inputs' }] }, 'FACET_HOST'],
    [{ on: { point: 'holder' }, via: 'proof', targets: [{ branch: 'custody' }] }, 'FACET_TARGET'],
    [{ on: { point: 'holder' }, via: 'proof', targets: [{ tree: 'service' }] }, 'FACET_TARGET'],
    [{ on: { point: 'holder' }, via: 'service', targets: [{ point: 'holder' }] }, 'FACET_SELF'],
    [{ on: { point: 'holder', branch: 'custody' }, via: 'proof', targets: [{ point: 'proof-inputs' }] }, 'POINTER_INVALID'],
    [{ on: { point: 'holder' }, via: 'missing', targets: [{ tree: 'missing' }] }, 'FACET_TREE'],
  ];
  for (const [fields, code] of cases) {
    const files = fixture(); files.set('trees/service/facets/holder.md', markdown({ id: 'holder-proof', ...fields }, 'Facet', 'Explains a consequence.'));
    has(validate(files), code);
  }
});

test('Point Types preserve valid status/date and reject invalid combinations', () => {
  const cases = [
    [{ type: 'decision' }, 'DECISION_STATUS'],
    [{ type: 'decision', status: 'implemented' }, 'DECISION_STATUS'],
    [{ status: 'selected' }, 'STATUS_TYPE'],
    [{ type: 'observation', observedAt: '2025-02-29', sources: [{ uri: 'source.md' }] }, 'OBSERVATION_DATE'],
    [{ type: 'observation', observedAt: '2024-02-29T25:00:00Z', sources: [{ uri: 'source.md' }] }, 'OBSERVATION_DATE'],
    [{ type: 'observation', observedAt: '2024-02-29' }, 'OBSERVATION_SOURCE'],
    [{ observedAt: '2024-02-29' }, 'DATE_TYPE'],
    [{ type: 'claim' }, 'TYPE_UNSUPPORTED'],
  ];
  for (const [fields, code] of cases) {
    const files = fixture(); files.set('trees/service/points/holder.md', markdown({ id: 'holder', ...fields }, 'Holder', 'Body.'));
    has(validate(files), code);
  }
  const files = fixture(); files.set('trees/service/points/nested/observed.md', markdown({ id: 'observed', type: 'observation', observedAt: '2024-02-29T23:59:59.001+05:30', sources: [{ uri: 'source.md' }] }, 'Observation', 'Body.'));
  assert.equal(validate(files).status, 'ready');
});

test('source URI grammar rejects executable, absolute, ambiguous, and credential references', () => {
  for (const uri of ['javascript:alert(1)', 'file:///tmp/a', '/tmp/a', '//host/a', 'C:\\tmp\\a', 'C:/tmp/a', 'https://user:password@example.org/a', 'x%2fy', '%2Ftmp/a', 'bad%zz', 'with space.md']) assert.equal(validateSource({ uri }).valid, false, uri);
  for (const uri of ['../docs/source.md#section', 'sources/a%20b.md', 'https://example.org/x#y']) assert.equal(validateSource({ uri }).valid, true, uri);
  assert.equal(validateSource({ uri: 'source.md', role: 'unsupported' }).valid, false);
  assert.equal(validateSource({ uri: 'source.md', sha256: 'BAD' }).valid, false);
});

test('Check definitions have bounded state, policy sections, and exact revision', () => {
  const files = fixture(); files.set('.checks/evidence.md', markdown({ id: 'evidence-review', status: 'active', level: 'required', evaluator: 'run.sh' }, 'Check', '## Requirement\nRule.\n## Verification\nInspect.'));
  const view = validate(files); has(view, 'FIELD_UNKNOWN'); has(view, 'CHECK_SECTION');
});

test('Check sections require ordered explanations and accept equivalent CommonMark headings', () => {
  const header = { id: 'evidence-review', status: 'active', level: 'required' };
  for (const body of [
    'Policy.\n## Requirement\n## Verification\n## Failure',
    '## Requirement\n<!-- empty -->\n## Verification\nInspect.\n## Failure\nReject.',
    '## Failure\nReject.\n## Requirement\nRule.\n## Verification\nInspect.',
  ]) {
    const files = fixture(); files.set('.checks/evidence.md', markdown(header, 'Check', body));
    has(validate(files), 'CHECK_SECTION');
  }
  for (const heading of [name => `   ## ${name}`, name => `${name}\n---`, name => `## **${name}**`]) {
    const files = fixture();
    files.set('.checks/evidence.md', markdown(header, 'Check', ['Requirement', 'Verification', 'Failure'].map(name => `${heading(name)}\n\nActionable explanation.`).join('\n\n')));
    assert.equal(validate(files).status, 'ready', JSON.stringify(validate(files).diagnostics));
  }
});

test('captured identity is stable under enumeration order and changes with exact bytes', () => {
  const files = fixture(), original = validate(files);
  const reversed = validate(new Map([...files].reverse()));
  assert.equal(original.identity, reversed.identity);
  files.set('trees/service/points/holder.md', files.get('trees/service/points/holder.md') + '\n');
  const next = validate(files), comparison = compareViews(original, next);
  assert.equal(comparison.same, false);
  assert.deepEqual(comparison.changed, ['trees/service/points/holder.md']);
  assert.equal(original.files.find(file => file.path.endsWith('/holder.md') && file.path.includes('/points/')).content, fixture().get('trees/service/points/holder.md'));
});

test('captured content and inspection references cannot mutate beneath their identity', () => {
  const view = validate();
  const original = JSON.stringify(view);
  const point = getPoint(view, 'holder');
  assert.throws(() => { view.files[0].content = 'Replacement'; }, TypeError);
  assert.throws(() => { view.atlas.points[0].body = 'Replacement'; }, TypeError);
  assert.throws(() => { point.owner.scope = 'Changed scope'; }, TypeError);
  assert.throws(() => { point.sources[0].uri = 'other.md'; }, TypeError);
  assert.throws(() => { point.facets[0].targets[0].point = 'other'; }, TypeError);
  assert.equal(JSON.stringify(view), original);
});

test('search filters ownership and Type before bounded lexical ranking', () => {
  const view = validate();
  assert.equal(searchAtlas(view, { query: 'custody', tree: 'service', type: 'decision' })[0].id, 'decision');
  assert.ok(searchAtlas(view, { query: 'custody', type: 'untyped' }).every(point => point.type === undefined));
  assert.equal(searchAtlas(view, { query: 'proof', limit: 1 }).length, 1);
  assert.ok(searchAtlas(view, { query: 'custody' })[0].matches.every(match => match.field && match.term));
  assert.throws(() => searchAtlas(view, { query: 'proof', limit: 101 }));
  assert.deepEqual(searchAtlas(view, { query: '' }), []);
  assert.equal(searchAtlas(view, { query: 'proof?', limit: 1 }).length, 1);
});

test('invalid views expose no accepted lookup or search records', () => {
  const view = validate(new Map([['atlas.json', '{}']]));
  assert.equal(view.atlas, null);
  assert.equal(getPoint(view, 'holder'), null); assert.equal(getTree(view, 'service'), null); assert.equal(getFacet(view, { tree: 'service', id: 'holder-proof' }), null);
  assert.deepEqual(searchAtlas(view, { query: 'custody' }), []);
  assert.ok(view.diagnostics.every(item => typeof item.code === 'string' && typeof item.path === 'string' && typeof item.message === 'string'));
});

test('file size, file count, and outline depth bounds fail closed', () => {
  has(validate(fixture(), { maxFiles: 1 }), 'READ_LIMIT');
  assert.equal(validate(fixture(), { maxFileBytes: 20 }).status, 'incomplete');
  const files = fixture();
  changeJson(files, 'trees/service/tree.json', value => {
    let child = { point: 'holder' };
    for (let index = 0; index < 70; index++) child = { branch: `level-${index}`, title: 'Level', children: [child] };
    value.children = [child];
  });
  const bounded = validate(files);
  assert.notEqual(bounded.status, 'ready');
  assert.ok(bounded.diagnostics.some(item => ['JSON_LIMIT', 'OUTLINE_LIMIT'].includes(item.code)));
});

test('opening captures only authored inventory and refresh retains prior observation', async t => {
  const { root } = await diskFixture(t);
  await mkdir(path.join(root, '.atlas-drafts')); await writeFile(path.join(root, '.atlas-drafts', 'draft.md'), 'not authored');
  await writeFile(path.join(root, 'trees/service/points/.atlas-write-interrupted'), 'incomplete temporary replacement');
  await mkdir(path.join(root, 'sources')); await writeFile(path.join(root, 'sources', 'requirements.md'), 'Source content.');
  const before = await openAtlas(root);
  assert.equal(before.status, 'ready', JSON.stringify(before.diagnostics));
  assert.equal(before.files.length, fixture().size);
  assert.equal(before.identity, validateFiles(fixture(), { root }).identity);
  const file = 'trees/service/points/holder.md';
  await writeFile(path.join(root, file), fixture().get(file).replace('preserves evidence', 'preserves scoped evidence'));
  const after = await openAtlas(root);
  assert.deepEqual(compareViews(before, after).changed, [file]);
  assert.ok(getPoint(before, 'holder').body.includes('preserves evidence'));
  assert.ok(getPoint(after, 'holder').body.includes('preserves scoped evidence'));
});

test('known missing manifest is repairable invalid input, not an incomplete observation', async t => {
  const { root } = await diskFixture(t, new Map());
  const view = await openAtlas(root);
  has(view, 'FILE_MISSING'); assert.equal(view.status, 'invalid');
  const repaired = validateFiles(new Map([['atlas.json', json({ format: 'atlas/1', id: 'new', title: 'New', trees: [] })]]), { root });
  assert.equal(repaired.status, 'ready');
});

test('overrides preview edits without writing and reject broken candidate structure', async t => {
  const { root } = await diskFixture(t);
  const file = 'trees/service/points/holder.md';
  const original = await readFile(path.join(root, file), 'utf8');
  const view = await openAtlas(root, { overrides: new Map([[file, markdown({ id: 'holder' }, 'Revised holder', 'Updated explanation.')]]) });
  assert.equal(view.status, 'ready'); assert.equal(getPoint(view, 'holder').title, 'Revised holder');
  assert.equal(await readFile(path.join(root, file), 'utf8'), original);
  has(await openAtlas(root, { overrides: new Map([[file, null]]) }), 'POINT_MISSING');
  has(await openAtlas(root, { overrides: new Map([['../escape.md', 'bad']]) }), 'OVERRIDES_INVALID');
});

test('authored symlink files and directories are rejected without capturing escaped bytes', async t => {
  const { root, directory } = await diskFixture(t);
  const secret = path.join(directory, 'secret.md'); await writeFile(secret, 'private source');
  const authored = path.join(root, 'trees/service/points/holder.md'); await rm(authored); await symlink(secret, authored);
  const view = await openAtlas(root);
  has(view, 'PATH_SYMLINK'); assert.ok(!view.files.some(file => file.content === 'private source'));
  const { root: root2, directory: directory2 } = await diskFixture(t);
  const outside = path.join(directory2, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'holder.md'), 'secret');
  await rm(path.join(root2, 'trees/service/points'), { recursive: true }); await symlink(outside, path.join(root2, 'trees/service/points'));
  has(await openAtlas(root2), 'PATH_SYMLINK');
});

test('filesystem capture refuses case aliases instead of inventing portable record paths', async t => {
  const { root } = await diskFixture(t);
  await rename(path.join(root, 'atlas.json'), path.join(root, 'Atlas.json'));
  const captured = await openAtlas(root);
  assert.notEqual(captured.status, 'ready');
  assert.ok(captured.diagnostics.some(item => ['PATH_ALIAS', 'FILE_MISSING'].includes(item.code)));
  assert.ok(!captured.files.some(file => file.path === 'atlas.json'));
});

test('missing, oversized, and invalid UTF-8 authored records never normalize', async t => {
  const { root } = await diskFixture(t);
  assert.equal((await openAtlas(root, { maxFiles: 1 })).status, 'incomplete');
  assert.equal((await openAtlas(root, { maxFileBytes: 20 })).status, 'incomplete');
  await writeFile(path.join(root, 'trees/service/points/holder.md'), Buffer.from([0xc3, 0x28]));
  has(await openAtlas(root), 'FILE_UTF8');
  await rm(path.join(root, 'trees/proof/tree.json'));
  const missing = await openAtlas(root); has(missing, 'FILE_MISSING'); assert.equal(missing.status, 'invalid');
});

test('source reads apply independent grants, real paths, hash, and byte limits', async t => {
  const { root, directory } = await diskFixture(t);
  await mkdir(path.join(root, 'sources'));
  await writeFile(path.join(root, 'sources/requirements.md'), 'Source content.');
  await writeFile(path.join(directory, 'external.md'), 'External source.');
  await symlink(path.join(directory, 'external.md'), path.join(root, 'sources/link.md'));
  const view = await openAtlas(root);
  assert.equal((await readSource(view, { uri: 'sources/requirements.md' })).status, 'ready');
  assert.equal((await readSource(view, { uri: '../external.md' })).status, 'denied');
  assert.equal((await readSource(view, { uri: '../external.md' }, { allowedRoots: [directory] })).content, 'External source.');
  assert.equal((await readSource(view, { uri: 'sources/link.md' }, { allowedRoots: [directory] })).status, 'denied');
  assert.equal((await readSource(view, { uri: 'sources/requirements.md' }, { allowedRoots: [] })).status, 'denied');
  assert.equal((await readSource(view, { uri: 'sources/missing.md' })).status, 'missing');
  assert.equal((await readSource(view, { uri: 'sources/requirements.md' }, { maxBytes: 2 })).status, 'incomplete');
  assert.equal((await readSource(view, { uri: 'sources/requirements.md', sha256: '0'.repeat(64) })).code, 'SOURCE_HASH');
  assert.equal((await readSource(view, { uri: 'https://127.0.0.1:1/not-fetched' })).status, 'reference');
  const alias = path.join(directory, 'caller-grant');
  await symlink(root, alias);
  assert.equal((await readSource(view, { uri: 'sources/requirements.md' }, { allowedRoots: [alias] })).status, 'ready');
  assert.equal((await readSource(view, { uri: 'sources/link.md' }, { allowedRoots: [alias] })).status, 'denied');
});

test('pending source reads retain the requested reference and caller grants', async t => {
  const { root } = await diskFixture(t);
  await mkdir(path.join(root, 'sources'));
  await writeFile(path.join(root, 'sources/original.md'), 'Original evidence.');
  await writeFile(path.join(root, 'sources/replacement.md'), 'Other evidence.');
  const source = { uri: 'sources/original.md', title: 'Original' };
  const grants = [root];
  const pending = readSource({ root }, source, { allowedRoots: grants });
  source.uri = 'sources/replacement.md';
  source.title = 'Replacement';
  grants.length = 0;
  const result = await pending;
  assert.equal(result.status, 'ready');
  assert.equal(result.content, 'Original evidence.');
  assert.deepEqual(result.source, { uri: 'sources/original.md', title: 'Original' });
});
