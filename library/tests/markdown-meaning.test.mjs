import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFrontMatter } from '../src/frontmatter.mjs';
import { deriveDocumentMeaning } from '../src/markdown-meaning.mjs';
import { validators } from '../src/schemas.mjs';
import { openAtlas, validateAtlas } from '../src/index.mjs';

const document = (fields, body) => `---\n${JSON.stringify(fields, null, 2)}\n---\n${body}\n`;
const anchor = { type: 'point', record: 'anchor', id: 'shared', posture: 'asserted', lifecycle: 'active' };

function atlas(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-markdown-meaning-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, fields, body) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), document(fields, body));
  };
  const global = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
  write('atlas.md', { type: 'atlas', format: 2, id: 'sample' }, '# Sample Atlas\n\nA small authoring boundary.');
  global('catalog.json', { navigation: [{ title: 'Maps', maps: ['one'] }] });
  global('connections.json', {});
  write('maps/one/map.md', { type: 'map', id: 'one', status: 'active' }, '# First Map\n\nLocal decisions.\n\n## Question\n\nWhat must hold?');
  write('maps/one/points/shared.md', anchor, '# Canonical **claim**\n\nA [clear](https://example.com) assertion.');
  return { root, write, global };
}

test('global declarations and Markdown assemble complete meaning without changing local headers', t => {
  const { root, write, global } = atlas(t);
  const pointOwner = { type: 'point', map: 'one', point: 'shared' };
  global('catalog.json', {
    navigation: [{ title: 'Maps', maps: ['one'] }],
    resources: [{ id: 'guide', title: 'Guide', uri: 'https://example.com/guide' }],
    areas: [{ map: 'one', id: 'boundary', title: 'Boundary' }],
    points: [{ point: 'shared', kinds: ['decision'] }],
    extensions: [{ owner: pointOwner, values: { 'x-custom': 'retained' } }],
  });
  global('connections.json', {
    memberships: [{ id: 'local-membership', point: 'shared', map: 'one', area: 'boundary', 'x-reason': 'scope' }],
    relations: [{ id: 'support', source: 'shared', type: 'supports', target: 'other', 'x-edge': 1 }],
    content: [{ id: 'primary', owner: pointOwner, target: { resource: 'guide', selector: 'part' } }],
    references: [
      { id: 'area-evidence', owner: { type: 'area', map: 'one', area: 'boundary' }, target: { resource: 'guide', selector: 'part' }, role: 'evidence' },
      { id: 'point-evidence', owner: pointOwner, target: { resource: 'guide' }, role: 'evidence' },
      { id: 'point-example', owner: pointOwner, target: { resource: 'guide' }, role: 'example' },
    ],
  });
  write('atlas.md', { type: 'atlas', format: 2, id: 'sample' }, '# Sample Atlas\n\nA small authoring boundary.\n\n## Resource: guide\n\nA reusable source.');
  write('maps/one/map.md', { type: 'map', id: 'one', status: 'active' }, '# First Map\n\nLocal decisions.\n\n## Question\n\nWhat must hold?\n\n## Area: boundary\n\nA local boundary.\n\n### Question\n\nWhere does [trust](https://example.com) stop?\n\n### Connection: area-evidence\n\nEvidence for this Area.');
  const body = '# Canonical **claim**\n\nA [clear](https://example.com) assertion.\n\n## Connection: local-membership\n\nThis limits *local* trust.\n\n- Separate responsibilities.\n\n## Connection: support\n\nThe assertion supports `other`.\n\n## Connection: point-evidence\n\nA precise observation.';
  write('maps/one/points/shared.md', anchor, body);
  write('maps/one/points/other.md', { ...anchor, id: 'other' }, '# Other\n\nAnother assertion.');
  const result = validateAtlas(root);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(validators.normalized(result.normalized), true, JSON.stringify(validators.normalized.errors));
  const model = result.normalized, point = model.points.find(item => item.id === 'shared');
  assert.equal(model.format, 2);
  assert.equal(model.atlas.title, 'Sample Atlas');
  assert.equal(model.atlas.resources[0].summary, 'A reusable source.');
  assert.equal(model.maps[0].areas[0].question, 'Where does trust stop?');
  assert.equal(model.maps[0].areas[0].references[0].note, 'Evidence for this Area.');
  assert.equal(point.title, 'Canonical claim');
  assert.deepEqual(point.kinds, ['decision']);
  assert.equal(point.records[0].extensions['x-custom'], 'retained');
  assert.equal(point.records[0].areas[0].id, 'local-membership');
  assert.equal(point.records[0].areas[0].context, 'This limits local trust. Separate responsibilities.');
  assert.equal(point.relations[0].id, 'support');
  assert.equal(point.relations[0].note, 'The assertion supports other.');
  assert.deepEqual(point.relations[0].extensions, { 'x-edge': 1 });
  assert.deepEqual(point.records[0].references.map(reference => reference.note), ['A precise observation.', undefined]);
  assert.equal(point.records[0].body, body + '\n');
  assert.deepEqual(parseFrontMatter(fs.readFileSync(path.join(root, 'maps/one/points/shared.md'), 'utf8')).value, anchor);
  assert.equal(openAtlas(root).find('precise observation').items[0].id, 'shared');
});

test('context associations use the exact Point and Map identities across renames', t => {
  const { root, write, global } = atlas(t);
  global('catalog.json', { navigation: [{ title: 'Maps', maps: ['one', 'two'] }], areas: [{ map: 'two', id: 'boundary', title: 'Operations boundary' }] });
  global('connections.json', { memberships: [{ id: 'operations', point: 'shared', map: 'two', area: 'boundary' }] });
  write('maps/two/map.md', { type: 'map', id: 'two', status: 'active' }, '# Operations\n\nOperating context.\n\n## Question\n\nHow does recovery work?\n\n## Area: boundary\n\nThe recovery boundary.\n\n### Question\n\nWhere can recovery fail?');
  write('maps/two/points/different-filename.md', { type: 'point', record: 'context', id: 'shared' }, '# Operating the claim\n\nThe claim constrains recovery.\n\n## Connection: operations\n\nThe local recovery boundary needs this claim.');
  fs.renameSync(path.join(root, 'maps/one/points/shared.md'), path.join(root, 'maps/one/points/renamed-anchor.md'));
  fs.renameSync(path.join(root, 'maps/two'), path.join(root, 'maps/renamed-directory'));
  const result = validateAtlas(root);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const point = result.normalized.points[0];
  assert.equal(point.title, 'Canonical claim');
  assert.deepEqual(point.records.map(record => [record.kind, record.map, record.areas.length]), [['anchor', 'one', 0], ['context', 'two', 1]]);
  assert.equal(point.records[1].areas[0].context, 'The local recovery boundary needs this claim.');
});

test('local headers accept only exact identity and state fields', () => {
  for (const record of [
    { type: 'atlas', format: 2, id: 'sample' },
    { type: 'map', id: 'one', status: 'active' }, anchor,
    { type: 'point', record: 'context', id: 'shared' },
    { type: 'check', id: 'review', status: 'active' },
  ]) {
    assert.equal(validators[record.type](record), true, JSON.stringify(validators[record.type].errors));
    for (const field of ['title','summary','navigation','areas','resources','relations','references','content','kinds','review','level','applies-to','x-custom']) {
      assert.equal(validators[record.type]({ ...record, [field]: 'Invalid local ownership' }), false, `${record.type} ${field}`);
    }
  }
});

test('document meaning uses CommonMark blocks and preserves inline text', () => {
  const source = Object.freeze({ ...anchor });
  const result = deriveDocumentMeaning(source, '# An &amp; **exact** title\n\nA con**tin**uous [claim](https://example.com), `code`, and ![an *image*](image.png).\n\n```md\n# Fake title\n## Area: fake\n```\n\n> ## Relation: supports fake\n> Quoted text.');
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.title, 'An & exact title');
  assert.equal(result.value.summary, 'A continuous claim, code, and an image.');
  assert.equal(source.title, undefined);
  const setext = deriveDocumentMeaning(source, 'Setext title\n============\n\nOpening\nparagraph.');
  assert.deepEqual(setext.errors, []);
  assert.equal(setext.value.summary, 'Opening paragraph.');
});

test('missing, ambiguous, and misplaced document opening blocks are rejected', () => {
  for (const [body, code] of [
    ['', 'atlas.markdown.title'], ['A paragraph only.', 'atlas.markdown.title'],
    ['Intro.\n\n# Title\n\nSummary.', 'atlas.markdown.title'],
    ['# Title\n\nSummary.\n\n# Again\n\nText.', 'atlas.markdown.title'],
    ['# Title\n\n<!-- comment -->\n\nSummary.', 'atlas.markdown.summary'],
    ['# Title\n\n> Summary.', 'atlas.markdown.summary'],
    ['# Title\n\n## Detail\n\nSummary.', 'atlas.markdown.summary'],
    ['# Title\n\n- Summary.', 'atlas.markdown.summary'],
  ]) assert.ok(deriveDocumentMeaning(anchor, body).errors.some(error => error.code === code), body);
});

test('associations require declared connection IDs, unique entries, and explanations', () => {
  const fields = { ...anchor, areas: [{ id: 'membership', area: 'boundary' }], relations: [{ id: 'relation', type: 'supports', point: 'other' }], references: [{ id: 'reference', resource: 'guide', selector: 'part', role: 'evidence' }] };
  const base = '# Claim\n\nA statement.\n\n## Connection: membership\n\nLocal significance.\n\n## Connection: relation\n\nWhy it supports the other claim.\n\n';
  for (const suffix of [
    '## Connection: missing\n\nUnknown.',
    '## Connection: membership\n\nDuplicate.',
    '### Connection: membership\n\nWrong level.',
    '## Connection : membership\n\nMalformed.',
    '## Resource: guide\n\nWrong document type.',
  ]) assert.ok(deriveDocumentMeaning(fields, base + suffix).errors.some(error => error.code === 'atlas.markdown.association'), suffix);
  for (const body of ['# Claim\n\nA statement.', base.replace('Local significance.', '<!-- empty -->'), base.replace('Why it supports the other claim.', '### Heading only')]) {
    assert.ok(deriveDocumentMeaning(fields, body).errors.some(error => error.code === 'atlas.markdown.section'), body);
  }
  assert.ok(deriveDocumentMeaning(fields, base + '## Connection: reference\n\nNote.\n\n## Connection: reference\n\nSecond note.').errors.some(error => error.code === 'atlas.markdown.association'));
});

test('Map and Area questions require substantive sections with exact heading scope', () => {
  const fields = { type: 'map', id: 'one', status: 'active', areas: [{ id: 'boundary', title: 'Boundary' }] };
  const base = '# Map\n\nMap significance.\n\n## Question\n\nWhat holds?\n\n## Area: boundary\n\nBoundary significance.\n\n### Question\n\nWhere does it hold?';
  assert.deepEqual(deriveDocumentMeaning(fields, base).errors, []);
  for (const body of [base.replace('## Question\n\nWhat holds?', ''), base.replace('### Question', '#### Question'), base.replace('Where does it hold?', '<!-- empty -->'), base + '\n\n### Question\n\nA duplicate?', base.replace('Boundary significance.', '- A list is not an opening paragraph.')]) {
    assert.ok(deriveDocumentMeaning(fields, body).errors.some(error => error.code === 'atlas.markdown.section'), body);
  }
  for (const body of [base + '\n\n#### Question\n\nMisplaced question?', base.replace('## Area: boundary', '### Question\n\nOrphan question?\n\n## Area: boundary')]) {
    assert.ok(deriveDocumentMeaning(fields, body).errors.some(error => error.code === 'atlas.markdown.association'), body);
  }
});
