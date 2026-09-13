import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { searchRecords } from '../src/fts-search.mjs';

function records(rows) {
  return Object.freeze(rows.map((row, index) => Object.freeze({ type: 'point', id: `point-${index}`, title: '', summary: '', path: '', body: '', ...row })));
}

function positions(result) { return result.items.map(({ index }) => index).sort((a, b) => a - b); }
function invalid(error) { return error.code === 'atlas.tools.invalid-argument'; }

const corpus = records([
  { id: 'edge-authentication', title: 'Authenticate at the edge', body: 'Enforce the boundary before executing commands.' },
  { id: 'background-work', title: 'Background execution', body: 'Execution starts only after explicit approval.' },
  { id: 'key-rotation', title: 'Key rotation', body: 'Rotation preserves an authentication boundary.' },
  { type: 'map', id: 'operations', title: 'Operations', body: 'How does execution reach approval?' },
]);

test('ranked discovery uses FTS normalization and any-token matching for a full question', () => {
  const result = searchRecords(corpus, 'Does execution run in the background?');
  assert.deepEqual(positions(result), [0, 1, 3]);
  assert.equal(result.items[0].index, 1);
  assert.deepEqual(result.query, { mode: 'ranked', expression: '"does" OR "execution" OR "run" OR "in" OR "the" OR "background"' });
  assert.ok(result.items.every(({ score }) => Number.isFinite(score) && score > 0));
  assert.ok(result.items[0].excerpt.includes('⟦'));
  assert.ok(!result.items[0].excerpt.includes('<mark>'));
});

test('ranked mode deduplicates tokens without interpreting FTS operators or column syntax', () => {
  const data = records([{ body: 'alpha beta' }, { body: 'alpha' }, { body: 'OR' }, { body: 'gamma' }]);
  assert.deepEqual(positions(searchRecords(data, 'alpha OR beta')), [0, 1, 2]);
  assert.equal(searchRecords(data, 'alpha ALPHA "alpha"').query.expression, '"alpha"');
  assert.deepEqual(positions(searchRecords(data, 'alpha AND beta', { mode: 'fts' })), [0]);
  assert.deepEqual(positions(searchRecords(data, 'body:gamma')), [3]);
  assert.equal(searchRecords(data, 'body:gamma').query.expression, '"body" OR "gamma"');
});

test('FTS mode provides phrase, prefix, Boolean, proximity, and column expressions', () => {
  const data = records([
    { title: 'edge authentication', body: 'alpha beta gamma' },
    { title: 'edge boundary', body: 'alpha one two beta' },
    { title: 'execution', body: 'alpha delta' },
    { title: 'execute', body: 'beta gamma' },
  ]);
  const find = (query) => positions(searchRecords(data, query, { mode: 'fts' }));
  assert.deepEqual(find('"alpha beta"'), [0]);
  assert.deepEqual(find('exec*'), [2, 3]);
  assert.deepEqual(find('alpha AND beta'), [0, 1]);
  assert.deepEqual(find('alpha NOT beta'), [2]);
  assert.deepEqual(find('alpha OR gamma'), [0, 1, 2, 3]);
  assert.deepEqual(find('NEAR(alpha beta, 0)'), [0]);
  assert.deepEqual(find('NEAR(alpha beta, 2)'), [0, 1]);
  assert.deepEqual(find('title:edge'), [0, 1]);
  assert.deepEqual(find('body:edge'), []);
  assert.deepEqual(find('{title body}: (edge OR delta)'), [0, 1, 2]);
});

test('Point contexts remain independent rows for conjunctions and phrases', () => {
  const data = records([
    { id: 'same-point', mapId: 'first', recordKind: 'anchor', body: 'approval' },
    { id: 'same-point', mapId: 'second', recordKind: 'context', body: 'execution' },
  ]);
  assert.deepEqual(positions(searchRecords(data, 'approval AND execution', { mode: 'fts' })), []);
  assert.deepEqual(positions(searchRecords(data, '"approval execution"', { mode: 'fts' })), []);
  assert.deepEqual(positions(searchRecords(data, 'approval execution')), [0, 1]);
});

test('Unicode61 folds Latin diacritics and case without inventing stemming or CJK segmentation', () => {
  const data = records([
    { body: 'CAFÉ naïve Straße Αθήνα русский 中文搜索 authentication' },
    { body: 'cafe\u0301' },
  ]);
  assert.deepEqual(positions(searchRecords(data, 'cafe')), [0, 1]);
  assert.deepEqual(positions(searchRecords(data, 'NAIVE РУССКИЙ')), [0]);
  assert.deepEqual(positions(searchRecords(data, '中文搜索')), [0]);
  assert.deepEqual(positions(searchRecords(data, '中文')), []);
  assert.deepEqual(positions(searchRecords(data, 'authenticating')), []);
});

test('empty queries enumerate the selected scope in input order; punctuation is not enumeration', () => {
  assert.deepEqual(searchRecords(corpus, ' \n ').items, corpus.map((record, index) => ({ index, score: 0, excerpt: '' })));
  assert.deepEqual(positions(searchRecords(corpus, '', { types: ['map'] })), [3]);
  assert.deepEqual(positions(searchRecords(corpus, 'execution', { types: ['map', 'map'] })), [3]);
  assert.deepEqual(positions(searchRecords(corpus, 'execution', { types: [] })), []);
  assert.deepEqual(positions(searchRecords(corpus, '', { types: [] })), []);
  assert.deepEqual(searchRecords(corpus, '?!!').items, []);
  assert.deepEqual(searchRecords(corpus, '?!!').query, { mode: 'ranked', expression: '' });
});

test('BM25 weights apply to the five declared columns and scores use larger-is-better ordering', () => {
  const data = records([
    { id: 'needle', title: 'other', summary: 'other', path: 'other', body: 'other' },
    { id: 'other', title: 'needle', summary: 'other', path: 'other', body: 'other' },
    { id: 'other', title: 'other', summary: 'needle', path: 'other', body: 'other' },
    { id: 'other', title: 'other', summary: 'other', path: 'needle', body: 'other' },
    { id: 'other', title: 'other', summary: 'other', path: 'other', body: 'needle' },
  ]);
  const result = searchRecords(data, 'needle');
  assert.deepEqual(result.items.map(({ index }) => index), [0, 1, 2, 3, 4]);
  for (const [position, weight] of [8, 5, 2, 1, 1].entries()) {
    const expected = 1e-6 * weight * 2.2 / (weight + 1.2);
    assert.ok(Math.abs(result.items[position].score - expected) < 1e-18);
  }
  assert.deepEqual(searchRecords(data, 'needle').items, result.items);
});

test('excerpts stay within 320 Unicode code points even when a token is very long', () => {
  const data = records([{ body: `needle ${'𝒜'.repeat(10000)}` }]);
  const [{ excerpt }] = searchRecords(data, 'needle').items;
  assert.equal([...excerpt].length, 320);
  assert.match(excerpt, /^⟦needle⟧ /u);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(!excerpt.includes('\uFFFD'));
});

test('invalid arguments and malformed FTS expressions fail without a lexical fallback', () => {
  for (const [query, options] of [
    [null, {}], ['x'.repeat(4097), {}], ['a\0b', {}], ['alpha', { mode: 'semantic' }],
    ['alpha', { types: 'point' }], ['alpha', { types: ['point', "x'); DROP TABLE documents; --"] }],
    ['"unfinished', { mode: 'fts' }], ['alpha AND', { mode: 'fts' }], ['unknown:alpha', { mode: 'fts' }],
    ['alpha AND', { mode: 'fts', types: [] }], ['x '.repeat(129), {}], ['x '.repeat(129), { mode: 'fts' }],
  ]) assert.throws(() => searchRecords(corpus, query, options), invalid);
  assert.throws(() => searchRecords({}, 'alpha'), invalid);
  assert.throws(() => searchRecords(records([]), 'alpha AND', { mode: 'fts' }), invalid);
  assert.throws(() => searchRecords(records([{ type: 'unknown' }]), 'alpha'), invalid);
  assert.throws(() => searchRecords(records([{ body: 1 }]), 'alpha'), invalid);
  assert.equal(searchRecords(corpus, 'x'.repeat(4096)).items.length, 0);
  assert.equal(searchRecords(corpus, 'x '.repeat(128)).items.length, 0);
});

test('bound query and source text cannot execute SQL; later queries retain the index', () => {
  const data = records([{ body: "literal'); DROP TABLE documents; -- alpha" }, { body: 'beta' }]);
  assert.deepEqual(positions(searchRecords(data, "literal'); DROP TABLE documents; --")), [0]);
  assert.throws(() => searchRecords(data, "alpha'); DROP TABLE documents; --", { mode: 'fts' }), invalid);
  assert.deepEqual(positions(searchRecords(data, '"DROP TABLE documents"', { mode: 'fts' })), [0]);
  assert.deepEqual(positions(searchRecords(data, 'beta')), [1]);
});

test('the cache reuses live indexes and closes evicted databases before rebuilding', (t) => {
  const originalClose = DatabaseSync.prototype.close;
  let closed = 0;
  t.mock.method(DatabaseSync.prototype, 'close', function (...args) {
    closed += 1;
    return originalClose.apply(this, args);
  });
  const data = records([{ body: 'retained index' }]);
  const initial = searchRecords(data, 'retained');
  const afterFirstQuery = closed;
  assert.deepEqual(searchRecords(data, 'retained'), initial);
  assert.equal(closed, afterFirstQuery);
  for (let index = 0; index < 8; index += 1) searchRecords(records([{ body: `separate index ${index}` }]), 'separate');
  assert.ok(closed > afterFirstQuery, 'An evicted native database must close while its record array is still live.');
  assert.deepEqual(searchRecords(data, 'retained'), initial);
});
