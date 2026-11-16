import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink, rm, rename } from 'node:fs/promises';
import { tempDirectory } from '../../tests/support/temp.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openAtlas, validateFiles, getPoint, getTree, getFacet, searchAtlas, compareViews, readSource, validateSource } from '../src/model.mjs';
import { parseStrictJson, parseMarkdown, parsePlainMarkdown } from '../src/frontmatter.mjs';

const json = value => JSON.stringify(value, null, 2);
const markdown = (header, title, body) => `---\n${json(header)}\n---\n# ${title}\n\n${body}\n`;
const style = '# Team policy\n\nOwn durable accounts and retain their reasons.\n';

function fixture() {
  return new Map([
    ['atlas.json', json({ format: 'atlas/1.2', id: 'example', title: 'Example', trees: ['trees/service', 'trees/proof'] })],
    ['style.md', style],
    ['trees/service/tree.json', json({ id: 'service', title: 'Service', scope: 'Participant duties.', base: 'purpose', children: [{ point: 'holder' }, { point: 'decision', children: [{ point: 'observed' }] }] })],
    ['trees/service/points/purpose.md', markdown({ id: 'purpose' }, 'Service purpose', 'Participants retain material for their intended uses.')],
    ['trees/service/points/holder.md', markdown({ id: 'holder', uncertainty: 'Future use may need more material.', sources: [{ uri: 'sources/requirements.md', role: 'evidence' }] }, 'Holder custody', 'Custody preserves evidence for use.')],
    ['trees/service/points/decision.md', markdown({ id: 'decision', type: 'decision', status: 'selected' }, 'Select operator custody', 'This selects the design; it does not establish implementation.')],
    ['trees/service/points/nested/observed.md', markdown({ id: 'observed', type: 'observation', observedAt: '2024-02-29', sources: [{ uri: 'https://example.org/observation#result' }] }, 'Observed result', 'A scoped observation with an explicit date.')],
    ['trees/proof/tree.json', json({ id: 'proof', title: 'Proof', scope: 'Evidence and execution.', base: 'evidence', children: [{ point: 'proof-inputs' }] })],
    ['trees/proof/points/evidence.md', markdown({ id: 'evidence' }, 'Proof evidence', 'Proofs require sufficient original inputs.')],
    ['trees/proof/points/proof-inputs.md', markdown({ id: 'proof-inputs' }, 'Original proof inputs', 'An accepted receipt does not finish missing source proof.')],
    ['trees/service/facets/holder.md', markdown({ id: 'holder-proof', on: 'holder', via: 'proof', targets: ['proof-inputs', 'evidence'] }, 'Custody and proof', 'Holder custody cannot substitute for missing proof inputs.')],
    ['trees/service/facets/nested/purpose.md', markdown({ id: 'purpose-proof', on: 'purpose', via: 'proof', targets: ['evidence'] }, 'Service duties rest on proof', 'The service account depends on sufficient original proof inputs.')],
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

test('normalizes the Style, ownership, Point ancestry, Facet hosts and targets, and Check revisions', () => {
  const view = validate();
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  assert.deepEqual(Object.keys(view.atlas), ['format', 'id', 'title', 'style', 'trees', 'points', 'facets', 'checks']);
  assert.equal(view.atlas.format, 'atlas/1.2');
  assert.deepEqual(view.atlas.style, { title: 'Team policy', body: 'Own durable accounts and retain their reasons.', path: 'style.md' });
  assert.equal(view.atlas.points.length, 6);
  assert.deepEqual(getPoint(view, 'observed').ancestors, [
    { id: 'purpose', tree: 'service' },
    { id: 'decision', tree: 'service' },
  ]);
  assert.equal(getPoint(view, 'purpose').ancestors.length, 0);
  assert.equal(getPoint(view, 'holder').owner.id, 'service');
  assert.deepEqual(getPoint(view, 'holder').facets.map(facet => facet.id), ['holder-proof']);
  assert.deepEqual(getPoint(view, 'evidence').incomingFacets.map(facet => facet.id), ['holder-proof', 'purpose-proof']);
  const facet = getFacet(view, { tree: 'service', id: 'holder-proof' });
  assert.equal(facet.on, 'holder'); assert.equal(facet.via, 'proof'); assert.deepEqual(facet.targets, ['proof-inputs', 'evidence']);
  assert.equal(facet.host.title, 'Holder custody');
  assert.deepEqual(facet.resolvedTargets.map(point => point.title), ['Original proof inputs', 'Proof evidence']);
  assert.equal(facet.viaTree.base, 'evidence');
  const tree = getTree(view, 'proof');
  assert.deepEqual(Object.keys(tree), ['id', 'title', 'scope', 'base', 'children', 'path', 'points', 'facets', 'incomingFacets']);
  assert.equal(tree.incomingFacets.length, 2);
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
  for (const text of ['---\n{}\n---\nLead\r# Title\n\nBody', '---\n{}\n---\n# Title\rmore\n\nBody', '---\n{}\n---\n# Title\n\nBody\rmore', '---\r{}\r---\r# Title\r\rBody']) {
    assert.throws(() => parseMarkdown(text), { code: 'MARKDOWN_LINE_ENDING' }, JSON.stringify(text));
  }
  assert.throws(() => parsePlainMarkdown('# Policy\n\nOne\rtwo'), { code: 'MARKDOWN_LINE_ENDING' });
});

test('Markdown explanations use CommonMark content and ignore empty markup', () => {
  for (const body of ['## Heading only', '<!-- comment -->', '```\n```', '```js\n```', '[source]: evidence.md', '<div></div>', '> # Quoted heading', '** __', '***', '&amp;', '&nbsp;', '[](https://example.test)', '![](result.png)']) {
    assert.throws(() => parseMarkdown(markdown({ id: 'point' }, 'Title', body)), { code: 'MARKDOWN_BODY' }, body);
  }
  for (const body of ['A concise explanation.', '```js\nconst observed = true;\n```', '![Observed result](result.png)', '> A scoped quotation.', '** 1 __', '<https://example.test>', 'Ω']) {
    assert.equal(parseMarkdown(markdown({ id: 'point' }, 'Title', body)).body, body);
  }
  const files = fixture();
  files.set('.checks/evidence.md', files.get('.checks/evidence.md').replace('Preserve source limits.', '** __'));
  const check = validate(files);
  has(check, 'CHECK_SECTION');
  assert.deepEqual(check.diagnostics.map(item => [item.code, item.path, item.message]), [['CHECK_SECTION', '.checks/evidence.md', 'The Requirement section requires explanatory content.']]);
  const parsed = parseMarkdown('---\n{"id":"point"}\n---\nAn **exact** &amp; useful title\n===\n\n<!--\n# This is a comment, not a title.\n-->\n\nUseful explanation.');
  assert.equal(parsed.title, 'An exact & useful title');
});

test('a record without a header is one H1 and a nonblank explanation, and refuses a header', () => {
  assert.deepEqual(parsePlainMarkdown('# Policy\r\n\r\nKeep one owner for each claim.\r\n\r\n## Depth\r\n\r\nCarry the main argument.\r\n'), { title: 'Policy', body: 'Keep one owner for each claim.\n\n## Depth\n\nCarry the main argument.' });
  assert.throws(() => parsePlainMarkdown('---\n{"id":"custom"}\n---\n# Policy\n\nA complete policy.'), { code: 'MARKDOWN_HEADER' });
  assert.throws(() => parsePlainMarkdown('## Policy\n\nA complete policy.'), { code: 'MARKDOWN_TITLE' });
  assert.throws(() => parsePlainMarkdown('# Policy\n\n# Another\n\nA complete policy.'), { code: 'MARKDOWN_TITLE' });
  assert.throws(() => parsePlainMarkdown('# Policy\n\n## Only a heading\n'), { code: 'MARKDOWN_BODY' });
  assert.throws(() => parsePlainMarkdown(null), { code: 'MARKDOWN_HEADER' });
});

test('atlas/1.2 is the only format and the manifest has exactly four fields', () => {
  for (const format of ['atlas/1', 'atlas/1.1', 'atlas/2', 'old/1', 1.2]) {
    const view = validate(changeJson(fixture(), 'atlas.json', value => { value.format = format; }));
    has(view, 'FORMAT_UNSUPPORTED');
    assert.equal(view.diagnostics.find(item => item.code === 'FORMAT_UNSUPPORTED').message, 'The supported format is atlas/1.2.');
  }
  const styled = validate(changeJson(fixture(), 'atlas.json', value => { value.style = 'style.md'; }));
  has(styled, 'FIELD_UNKNOWN');
  assert.deepEqual(styled.diagnostics.map(({ code, path: file, message }) => [code, file, message]), [['FIELD_UNKNOWN', 'atlas.json', 'Unknown field: style.']]);
  has(validate(changeJson(fixture(), 'atlas.json', value => { delete value.title; })), 'FIELD_REQUIRED');
});

test('the Style is style.md at the Atlas root: required, plain Markdown, part of the identity', async t => {
  const view = validate();
  const missing = fixture(); missing.delete('style.md');
  assert.deepEqual(validate(missing).diagnostics, [{ code: 'STYLE_REQUIRED', path: 'style.md', message: 'An Atlas keeps its Style in style.md: one H1 title and its complete policy.' }]);
  for (const blank of ['', ' \n\t\n']) { const files = fixture(); files.set('style.md', blank); has(validate(files), 'STYLE_REQUIRED'); }
  for (const [content, code] of [
    ['---\n{"id":"custom","revision":"1"}\n---\n# Policy\n\nA complete policy.\n', 'MARKDOWN_HEADER'],
    ['Policy without a title.\n', 'MARKDOWN_TITLE'],
    ['## Policy\n\nA second-level title.\n', 'MARKDOWN_TITLE'],
    ['# Policy\n\n## Only a heading\n', 'MARKDOWN_BODY'],
  ]) {
    const files = fixture(); files.set('style.md', content);
    const invalid = validate(files); has(invalid, code);
    assert.equal(invalid.diagnostics.find(item => item.code === code).path, 'style.md');
  }
  const changed = fixture(); changed.set('style.md', style + '\n');
  assert.notEqual(validate(changed).identity, view.identity);
  for (const elsewhere of ['policy.md', 'trees/service/style.md', '.checks/style.md']) {
    const files = fixture(); files.set(elsewhere, files.get('style.md')); files.delete('style.md');
    has(validate(files), 'STYLE_REQUIRED');
  }
  for (const reserved of ['style.md', 'style.md/account', 'STYLE.md', 'atlas.json', '.checks/account']) has(validate(changeJson(fixture(), 'atlas.json', value => { value.trees.push(reserved); })), 'TREE_PATH');
  const { root } = await diskFixture(t);
  const captured = await openAtlas(root);
  assert.equal(captured.status, 'ready', JSON.stringify(captured.diagnostics));
  assert.equal(captured.identity, view.identity);
  assert.ok(captured.files.some(file => file.path === 'style.md'));
  await rm(path.join(root, 'style.md'));
  const absent = await openAtlas(root);
  assert.equal(absent.status, 'invalid');
  assert.deepEqual(absent.diagnostics.map(item => item.code), ['STYLE_REQUIRED']);
  await writeFile(path.join(root, 'style.md'), Buffer.from([0xff, 0xfe]));
  const binary = await openAtlas(root);
  assert.deepEqual(binary.diagnostics.map(item => item.code), ['FILE_UTF8']);
  assert.equal(binary.atlas, null);
});

test('a directory without a manifest captures no Style of its own', async t => {
  const { root } = await diskFixture(t, new Map([['style.md', style]]));
  const view = await openAtlas(root);
  assert.deepEqual(view.files, []);
  // The missing manifest is named once, without the path of the directory read.
  assert.deepEqual(view.diagnostics, [{ code: 'FILE_MISSING', path: 'atlas.json', message: 'Required authored file is missing.' }]);
  const proposed = await openAtlas(root, { overrides: new Map([['atlas.json', json({ format: 'atlas/1.2', id: 'new', title: 'New', trees: [] })]]) });
  assert.deepEqual(proposed.files.map(file => file.path), ['atlas.json', 'style.md']);
  assert.deepEqual(proposed.diagnostics.map(({ code, path: file }) => [code, file]), [['FILE_MISSING', 'atlas.json']]);
  assert.equal(validateFiles(proposed.files, { root }).atlas.style.title, 'Team policy');
});

test('rejects unknown fields and unsafe or unexpected authored paths', () => {
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
  has(validate(changeJson(fixture(), 'atlas.json', value => { value.trees.push('trees/service/child'); })), 'TREE_OVERLAP');
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

test('a placement is a Point with optional developments and nothing else', () => {
  const codes = change => validate(changeJson(fixture(), 'trees/service/tree.json', change)).diagnostics.map(({ code, message }) => `${code} ${message}`);
  // A placement without a Point is refused where it stands; its developments are still read, so nothing else is reported.
  assert.deepEqual(codes(value => { value.children = [{ group: 'custody', title: 'Custody', children: value.children }]; }),
    ['FIELD_REQUIRED Missing field: point.', 'FIELD_UNKNOWN Unknown field: group.', 'FIELD_UNKNOWN Unknown field: title.']);
  assert.deepEqual(codes(value => { value.children[0].title = 'Holder'; }), ['FIELD_UNKNOWN Unknown field: title.']);
  assert.deepEqual(codes(value => { value.children.push('holder'); }), ['RECORD_OBJECT Expected an object.']);
  assert.deepEqual(codes(value => { value.children[0].children = 'observed'; }), ['ARRAY_INVALID children must be an array of at most 10000 entries.']);
  assert.deepEqual(codes(value => { value.children[0].point = 'Holder'; }), ['POINT_UNPLACED Point holder has no structural home in its owning Tree.', 'ID_INVALID point must be a lowercase ID of at most 100 characters.', 'POINT_MISSING Point does not exist: Holder.']);
});

test('a Facet attaches to one Point of its Tree and targets unique Points of its via Tree', () => {
  const cases = [
    [{ on: 'proof-inputs', via: 'proof', targets: ['proof-inputs'] }, 'FACET_HOST', 'A Facet attaches to a Point of its owning Tree.'],
    [{ on: 'absent', via: 'proof', targets: ['proof-inputs'] }, 'FACET_HOST', 'A Facet attaches to a Point of its owning Tree.'],
    [{ on: { point: 'holder' }, via: 'proof', targets: ['proof-inputs'] }, 'ID_INVALID', 'on must be a lowercase ID of at most 100 characters.'],
    [{ on: 'holder', via: 'proof', targets: ['decision'] }, 'FACET_TARGET', 'Every Facet target is a Point of its via Tree.'],
    [{ on: 'holder', via: 'proof', targets: ['absent'] }, 'FACET_TARGET', 'Every Facet target is a Point of its via Tree.'],
    [{ on: 'holder', via: 'proof', targets: ['proof'] }, 'FACET_TARGET', 'Every Facet target is a Point of its via Tree.'],
    [{ on: 'holder', via: 'proof', targets: [{ point: 'proof-inputs' }] }, 'ID_INVALID', 'target must be a lowercase ID of at most 100 characters.'],
    [{ on: 'holder', via: 'proof', targets: [{ tree: 'proof' }] }, 'ID_INVALID', 'target must be a lowercase ID of at most 100 characters.'],
    [{ on: 'holder', via: 'proof', targets: ['proof-inputs', 'evidence', 'proof-inputs'] }, 'TARGET_DUPLICATE', 'Duplicate Facet target: proof-inputs.'],
    [{ on: 'holder', via: 'proof', targets: [] }, 'ARRAY_INVALID', 'targets must be a nonempty array of at most 10000 entries.'],
    [{ on: 'holder', via: 'proof', targets: 'proof-inputs' }, 'ARRAY_INVALID', 'targets must be a nonempty array of at most 10000 entries.'],
    [{ on: 'holder', via: 'service', targets: ['decision'] }, 'FACET_SELF', 'A Facet interprets through a different Tree.'],
    [{ on: 'holder', via: 'missing', targets: ['proof-inputs'] }, 'FACET_TREE', 'Facet Tree does not exist: missing.'],
    [{ on: 'holder', targets: ['proof-inputs'] }, 'FIELD_REQUIRED', 'Missing field: via.'],
  ];
  for (const [fields, code, message] of cases) {
    const files = fixture(); files.set('trees/service/facets/holder.md', markdown({ id: 'holder-proof', ...fields }, 'Facet', 'Explains a consequence.'));
    const view = validate(files); has(view, code);
    assert.ok(view.diagnostics.some(item => item.code === code && item.message === message && item.path === 'trees/service/facets/holder.md'), `${code}: ${JSON.stringify(view.diagnostics)}`);
  }
  const duplicate = fixture(); duplicate.set('trees/service/facets/again.md', markdown({ id: 'holder-proof', on: 'decision', via: 'proof', targets: ['evidence'] }, 'Again', 'A second record with the same ID.'));
  has(validate(duplicate), 'FACET_DUPLICATE');
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
  const files = fixture(); files.set('trees/service/points/holder.md', markdown({ id: 'holder', sources: [{ uri: 'source.md', sha256: 'BAD' }] }, 'Holder', 'Body.'));
  has(validate(files), 'SOURCE_INVALID');
});

test('Check definitions have bounded state, policy sections, and exact revision', () => {
  const files = fixture(); files.set('.checks/evidence.md', markdown({ id: 'evidence-review', status: 'active', level: 'required', evaluator: 'run.sh' }, 'Check', '## Requirement\nRule.\n## Verification\nInspect.'));
  const view = validate(files); has(view, 'FIELD_UNKNOWN'); has(view, 'CHECK_SECTION');
  for (const [fields, code] of [[{ status: 'enabled' }, 'CHECK_STATUS'], [{ level: 'blocking' }, 'CHECK_LEVEL']]) {
    const invalid = fixture(); invalid.set('.checks/evidence.md', markdown({ id: 'evidence-review', status: 'active', level: 'required', ...fields }, 'Check', '## Requirement\n\nRule.\n\n## Verification\n\nInspect.\n\n## Failure\n\nReject.'));
    has(validate(invalid), code);
  }
  const duplicate = fixture(); duplicate.set('.checks/again.md', fixture().get('.checks/evidence.md')); has(validate(duplicate), 'CHECK_DUPLICATE');
  const text = fixture(); text.set('.checks/notes.txt', 'Not a record.'); has(validate(text), 'RECORD_EXTENSION');
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

test('every Check record is listed with its complete text, whatever its status', () => {
  const files = fixture();
  const body = '## Requirement\n\nName every removed claim.\n\n## Verification\n\nRead the reason.\n\n## Failure\n\nReturn the change.\n\n## Exceptions\n\nA typo correction.';
  files.set('.checks/removals.md', markdown({ id: 'removals', status: 'draft', level: 'advisory' }, 'Account for removals', body));
  files.set('.checks/retired/old.md', markdown({ id: 'old', status: 'retired', level: 'required' }, 'An earlier rule', body));
  const view = validate(files);
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  assert.deepEqual(view.atlas.checks.map(({ id, status, level, path: file, title }) => [id, status, level, file, title]), [
    ['evidence-review', 'active', 'required', '.checks/evidence.md', 'Review evidence'],
    ['removals', 'draft', 'advisory', '.checks/removals.md', 'Account for removals'],
    ['old', 'retired', 'required', '.checks/retired/old.md', 'An earlier rule'],
  ]);
  assert.equal(view.atlas.checks[1].body, body);
  assert.deepEqual(Object.keys(view.atlas.checks[1]), ['id', 'status', 'level', 'path', 'title', 'body', 'revision']);
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
  assert.throws(() => { view.atlas.style.body = 'Replacement'; }, TypeError);
  assert.throws(() => { point.owner.scope = 'Changed scope'; }, TypeError);
  assert.throws(() => { point.sources[0].uri = 'other.md'; }, TypeError);
  assert.throws(() => { point.facets[0].targets[0] = 'other'; }, TypeError);
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
    for (let index = 0; index < 70; index++) child = { point: `level-${index}`, children: [child] };
    value.children = [child];
  });
  const bounded = validate(files);
  assert.notEqual(bounded.status, 'ready');
  assert.ok(bounded.diagnostics.some(item => ['JSON_LIMIT', 'OUTLINE_LIMIT'].includes(item.code)));
  const wide = validate(changeJson(fixture(), 'trees/service/tree.json', value => { value.children = Array.from({ length: 10001 }, () => ({ point: 'holder' })); }));
  assert.equal(wide.diagnostics.filter(item => item.code === 'OUTLINE_LIMIT').length, 1);
});

test('supplied files are read as a reader reads a folder: 64 directory levels below each record folder, and no deeper', async t => {
  const levels = count => Array.from({ length: count }, () => 'd').join('/');
  const files = fixture();
  const check = files.get('.checks/evidence.md').replace('evidence-review', 'deep-review');
  files.set(`.checks/${levels(65)}/deep.md`, check);
  files.set(`.checks/${levels(70)}/deeper.md`, check.replace('deep-review', 'deeper-review'));
  files.set(`trees/service/points/${levels(65)}/far.md`, markdown({ id: 'far' }, 'Far', 'Past the bound.'));
  // At the bound a file is read like any other.
  files.set(`trees/service/facets/${levels(64)}/near.md`, markdown({ id: 'near', on: 'purpose', via: 'proof', targets: ['evidence'] }, 'Near', 'At the bound.'));
  const supplied = validate(files);
  assert.equal(supplied.status, 'incomplete');
  assert.deepEqual(supplied.diagnostics.filter(item => item.code === 'READ_LIMIT'), [
    { code: 'READ_LIMIT', path: `.checks/${levels(65)}`, message: 'Directory depth exceeds 64.' },
    { code: 'READ_LIMIT', path: `trees/service/points/${levels(65)}`, message: 'Directory depth exceeds 64.' },
  ]);
  assert.ok(supplied.files.some(file => file.path.endsWith('/near.md')));
  assert.ok(!supplied.files.some(file => /\/(deep|deeper|far)\.md$/u.test(file.path)));
  // The same files on disk read to the same view.
  const { root } = await diskFixture(t, files);
  const read = await openAtlas(root);
  assert.deepEqual([read.status, read.identity, read.diagnostics], [supplied.status, supplied.identity, supplied.diagnostics]);
  // A reader lists four times its file bound of directory entries in all, so the directories the paths imply count too.
  const small = new Map([['atlas.json', json({ format: 'atlas/1.2', id: 'small', title: 'Small', trees: ['trees/a'] })], ['style.md', style]]);
  for (const [extra, maxFiles] of [[[[`.checks/${levels(13)}/check.md`, check]], 3], [[[`.checks/a/${levels(12)}/check.md`, check], [`trees/a/points/${levels(3)}/p.md`, markdown({ id: 'p' }, 'P', 'A Point.')]], 4], [[[`.checks/${levels(11)}/check.md`, check]], 3]]) {
    const supplied = new Map([...small, ...extra]);
    const view = validate(supplied, { maxFiles });
    const { root: disk } = await diskFixture(t, supplied);
    const opened = await openAtlas(disk, { maxFiles });
    assert.deepEqual([view.status, view.identity, view.files.map(file => file.path), view.diagnostics], [opened.status, opened.identity, opened.files.map(file => file.path), opened.diagnostics], JSON.stringify([...supplied.keys()]));
    assert.equal(view.diagnostics.some(item => item.message === 'Authored directory traversal exceeds its entry bound.'), extra.length > 1 || extra[0][0].includes(levels(13)));
  }
  // A path that is not well-formed Unicode is no record path.
  for (const file of ['.checks/\ud800.md', '.checks/a\udfffb.md']) assert.deepEqual(validate(new Map([...fixture(), [file, check]])).diagnostics.map(item => [item.code, item.path]), [['PATH_UNSAFE', file]]);
});

test('opening captures only authored inventory and refresh retains prior observation', async t => {
  const { root } = await diskFixture(t);
  await mkdir(path.join(root, '.atlas-drafts')); await writeFile(path.join(root, '.atlas-drafts', 'draft.md'), 'not authored');
  await writeFile(path.join(root, 'trees/service/points/.atlas-write-interrupted'), 'incomplete temporary replacement');
  await mkdir(path.join(root, 'sources')); await writeFile(path.join(root, 'sources', 'requirements.md'), 'Source content.');
  await writeFile(path.join(root, 'README.md'), 'Not an authored record.');
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
  const repaired = validateFiles(new Map([['atlas.json', json({ format: 'atlas/1.2', id: 'new', title: 'New', trees: [] })], ['style.md', style]]), { root });
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
  const restyled = await openAtlas(root, { overrides: new Map([['style.md', '# Another policy\n\nKeep each claim brief.\n']]) });
  assert.equal(restyled.atlas.style.title, 'Another policy');
  has(await openAtlas(root, { overrides: new Map([['style.md', null]]) }), 'STYLE_REQUIRED');
  assert.equal(await readFile(path.join(root, 'style.md'), 'utf8'), style);
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
  const { root: root3, directory: directory3 } = await diskFixture(t);
  await writeFile(path.join(directory3, 'policy.md'), '# Outside policy\n\nNot this Atlas.\n');
  await rm(path.join(root3, 'style.md')); await symlink(path.join(directory3, 'policy.md'), path.join(root3, 'style.md'));
  const linked = await openAtlas(root3);
  has(linked, 'PATH_SYMLINK'); has(linked, 'STYLE_REQUIRED');
  assert.ok(!linked.files.some(file => file.path === 'style.md'));
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
  assert.deepEqual(missing.diagnostics.filter(item => item.code === 'FILE_MISSING'), [{ code: 'FILE_MISSING', path: 'trees/proof/tree.json', message: 'Required authored file is missing.' }]);
});

test('source reads apply independent grants, real paths, and byte limits', async t => {
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
  assert.equal((await readSource(view, { uri: 'sources/requirements.md', sha256: '0'.repeat(64) })).stamp, 'changed');
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
