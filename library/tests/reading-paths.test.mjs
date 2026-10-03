import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles, searchAtlas, getPoint } from '../src/model.mjs';
import { searchPoints } from '../src/search.mjs';
import { route } from '../src/route.mjs';

const text = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
function fixture() {
  const files = new Map([
    ['atlas.json', JSON.stringify({ format: 'atlas/1', id: 'work', title: 'Work', trees: ['trees/design', 'trees/evidence'] })],
    ['trees/design/tree.json', JSON.stringify({ id: 'design', title: 'Design', scope: 'User experience.', base: 'purpose', children: [
      { point: 'editor-recovery', children: [{ point: 'draft-storage' }, { point: 'unsaved-text' }, { point: 'restart-review' }] },
      { point: 'qualification' }, { point: 'international' },
    ] })],
    ['trees/evidence/tree.json', JSON.stringify({ id: 'evidence', title: 'Evidence', scope: 'Dated results.', base: 'observed', children: [] })],
    ['trees/design/points/purpose.md', text({ id: 'purpose' }, 'Writing safely', 'The account explains how writers preserve work. '.repeat(30))],
    ['trees/design/points/editor-recovery.md', text({ id: 'editor-recovery', uncertainty: 'A process failure can lose unsaved text.' }, 'Recover from an editor crash', 'An editor crash retains saved drafts. Unsaved text needs separate recovery. '.repeat(8))],
    ['trees/design/points/draft-storage.md', text({ id: 'draft-storage' }, 'Keep saved drafts', 'Saved drafts remain on disk for recovery.')],
    ['trees/design/points/unsaved-text.md', text({ id: 'unsaved-text' }, 'Unsaved text needs care', 'A crash can lose recent typing. Its recovery has not been demonstrated.')],
    ['trees/design/points/restart-review.md', text({ id: 'restart-review' }, 'Review after restart', 'Review whether the recovered draft still matches its original baseline.')],
    ['trees/design/points/qualification.md', text({ id: 'qualification' }, 'Qualification records', 'The tested package has a measured size.')],
    ['trees/design/points/international.md', text({ id: 'international' }, '日本語の保存とcafé', '文章を保存する。Le café accueille les lecteurs.')],
    ['trees/evidence/points/observed.md', text({ id: 'observed', type: 'observation', observedAt: '2026-09-27', uncertainty: 'Only one tested workload.', sources: [{ uri: 'report.md', role: 'evidence' }] }, 'Observed draft recovery', 'One saved draft survived a restart. '.repeat(20))],
    ...['editor-recovery', 'draft-storage', 'restart-review'].map((host, index) => [`trees/design/facets/proof-${index}.md`, text({ id: `proof-${index}`, on: { point: host }, via: 'evidence', targets: [{ point: 'observed' }] }, 'Recovery has bounded evidence', `The ${host} account must respect the observed workload.`)]),
  ]);
  const view = validateFiles(files, { root: '/tmp/atlas-reading-paths' });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return { files, view };
}

test('question search uses words, meaningful coverage and exact identity rather than substrings', () => {
  const { view } = fixture();
  const questions = ['editor crash', 'What happens if my editor crashes?'];
  for (const query of questions) {
    const found = searchAtlas(view, { query });
    assert.equal(found[0].id, 'editor-recovery');
    assert.ok(!found.some(point => point.id === 'qualification'));
    assert.ok(!found.flatMap(point => point.matches).some(match => ['if', 'my', 'what'].includes(match.term)));
  }
  assert.deepEqual(searchAtlas(view, { query: 'cat' }), []);
  assert.equal(searchAtlas(view, { query: 'editor-recovery' })[0].id, 'editor-recovery');
  assert.ok(searchAtlas(view, { query: 'draft' }).some(point => point.id === 'draft-storage'));
  assert.deepEqual(searchAtlas(view, { query: 'draft', tree: 'evidence' }).map(point => point.id), ['observed']);
  assert.equal(searchAtlas(view, { query: 'draft', type: 'observation' })[0].observedAt, '2026-09-27');
});

test('exact Point identity stays first even when another candidate has a higher lexical score', () => {
  const query = 'aa-bb-cc-dd-ee-ff-gg-hh-ii-jj-kk-ll-mm-nn-oo-pp-qq-rr-ss-tt';
  const points = [
    { id: query, tree: 'design', title: 'Exact record', body: 'Explicit.' },
    { id: `${query}-other`, tree: 'design', title: query, body: query, uncertainty: query },
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `filler-${index}`, tree: 'design', title: 'Unrelated', body: 'Unrelated' })),
  ];
  const found = searchPoints(points, { query, limit: 2 });
  assert.equal(found[0].id, query);
  assert.ok(found[1].score > found[0].score);
  assert.match(found[0].reason, /Exact Point ID/);
});

test('the shared matcher retains multilingual words and precise excerpts without authored summary fields', () => {
  const { view } = fixture();
  for (const query of ['保存', 'CAFÉ', 'cafe\u0301']) assert.equal(searchAtlas(view, { query })[0].id, 'international');
  const options = { query: 'draft recovery', presentation: 'summary' };
  assert.deepEqual(searchAtlas(view, options), searchPoints(view.atlas.points, options));
  const result = searchAtlas(view, { ...options, type: 'observation' })[0];
  const original = getPoint(view, result.id);
  assert.equal(result.summary, true);
  assert.equal(result.body, undefined);
  assert.equal(result.sources, undefined);
  assert.equal(result.uncertainty, original.uncertainty);
  assert.equal(result.observedAt, original.observedAt);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.snippet.text, original.body.slice(result.snippet.start, result.snippet.end));
  assert.equal(result.snippet.totalLength, original.body.length);
  assert.ok(result.snippet.text.length <= 241);
  assert.deepEqual(result.selector, { point: original.id });
  assert.throws(() => searchAtlas(view, { query: 'draft', presentation: 'generated' }));
});

test('discovery offers exact follow-ups while compact reading preserves claims and avoids ancestor bodies', () => {
  const { view } = fixture();
  const discovery = route(view, { query: 'draft recovery', kinds: ['point'], mode: 'discover', limit: 2 });
  assert.equal(discovery.status, 'ambiguous');
  assert.ok(discovery.selected.every(({ point }) => point.summary && !Object.hasOwn(point, 'body')));
  assert.deepEqual(discovery.supporting, []);
  assert.deepEqual(discovery.facets, []);
  assert.ok(discovery.orientation.every(entry => entry.base.reference && !Object.hasOwn(entry.base, 'body')));
  const exact = route(view, { ...discovery.selected[0].point.selector, detail: 'overview', orientation: 'compact' });
  assert.equal(exact.selected[0].point.body, getPoint(view, discovery.selected[0].point.id).body);
  const ordinary = route(view, { point: 'unsaved-text', detail: 'overview' });
  const compact = route(view, { point: 'unsaved-text', detail: 'overview', orientation: 'compact' });
  assert.deepEqual(compact.selected, ordinary.selected);
  assert.deepEqual(compact.facets, ordinary.facets);
  assert.equal(compact.orientation[0].ancestors[0].record.uncertainty, 'A process failure can lose unsaved text.');
  assert.ok(JSON.stringify(compact).length < JSON.stringify(ordinary).length);
});

test('section continuations enumerate omissions once and refuse a changed observation or request', () => {
  const { view, files } = fixture();
  const first = route(view, { point: 'editor-recovery', detail: 'deep', limit: 1 });
  assert.equal(first.bounds.supporting.available, 3);
  assert.equal(first.bounds.facets.available, 3);
  for (const section of ['supporting', 'facets']) {
    const ids = first[section].map(item => item.point?.id ?? item.facet.id);
    let next = first.next[section];
    while (next) {
      const page = route(view, next);
      assert.deepEqual(page.orientation, []);
      assert.deepEqual(page.selected, []);
      assert.equal(page[section === 'supporting' ? 'facets' : 'supporting'].length, 0);
      ids.push(...page[section].map(item => item.point?.id ?? item.facet.id));
      next = page.next[section];
    }
    assert.equal(ids.length, first.bounds[section].available);
    assert.equal(new Set(ids).size, ids.length);
  }
  const changed = new Map(files);
  changed.set('trees/design/points/purpose.md', text({ id: 'purpose' }, 'Changed orientation', 'A new explanation.'));
  assert.throws(() => route(validateFiles(changed, { root: view.root }), first.next.supporting), { code: 'atlas.route.stale-cursor' });
  assert.throws(() => route(view, { ...first.next.supporting, limit: 2 }), { code: 'atlas.route.cursor-mismatch' });
  assert.throws(() => route(view, { ...first.next.supporting, cursor: { ...first.next.supporting.cursor, offset: 9000 } }), { code: 'atlas.route.invalid-argument' });
  assert.throws(() => route(view, { ...first.next.supporting, cursor: { ...first.next.supporting.cursor, identity: [view.identity] } }), { code: 'atlas.route.invalid-argument' });
});

test('discovery continuations preserve all alternatives and dated limitations without repeated context', () => {
  const { view } = fixture();
  let page = route(view, { query: 'draft recovery', kinds: ['point'], mode: 'discover', limit: 1 });
  const ids = [];
  while (true) {
    ids.push(...page.selected.map(({ point }) => point.id));
    if (!page.next.selected) break;
    page = route(view, page.next.selected);
    assert.deepEqual(page.orientation, []);
    assert.deepEqual(page.supporting, []);
    assert.deepEqual(page.facets, []);
  }
  assert.deepEqual(ids, searchAtlas(view, { query: 'draft recovery', limit: 100 }).map(point => point.id));
  assert.equal(new Set(ids).size, ids.length);
  const observation = route(view, { point: 'observed', mode: 'discover' }).selected[0].point;
  assert.equal(observation.observedAt, '2026-09-27');
  assert.equal(observation.uncertainty, 'Only one tested workload.');
});

test('mixed discovery treats Facets as owned interpretations with complete reading selectors', () => {
  const { view } = fixture();
  const found = searchAtlas(view, { query: 'bounded evidence', kinds: ['point', 'facet'], presentation: 'summary' });
  assert.ok(found.some(result => result.kind === 'facet'));
  const facet = found.find(result => result.kind === 'facet');
  assert.deepEqual(facet.selector, { tree: 'design', facet: facet.id });
  assert.ok(facet.on.point);
  assert.equal(facet.via, 'evidence');
  assert.deepEqual(facet.targets, [{ point: 'observed' }]);
  assert.equal(facet.body, undefined);
  const read = route(view, facet.selector);
  assert.equal(read.status, 'ready');
  assert.equal(read.facets[0].facet.id, facet.id);
  assert.ok(read.facets[0].facet.body);
  const discovery = route(view, { query: 'bounded evidence', mode: 'discover', limit: 1 });
  assert.equal(discovery.facets[0].facet.kind, 'facet');
  assert.ok(discovery.next.facets);
  assert.equal(route(view, discovery.next.facets).facets[0].facet.id !== discovery.facets[0].facet.id, true);
  assert.deepEqual(searchAtlas(view, { query: 'bounded evidence', kinds: ['facet'], type: 'decision' }), []);
  assert.ok(searchAtlas(view, { query: 'bounded evidence' }).every(result => result.on === undefined));
  const combined = searchAtlas(view, { query: 'bounded evidence', kinds: ['facet'], limit: 100 });
  const pages = combined.map((_, offset) => searchAtlas(view, { query: 'bounded evidence', kinds: ['facet'], limit: 1, offset })[0]);
  assert.deepEqual(pages, combined);
  assert.throws(() => searchAtlas(view, { query: 'evidence', kinds: ['invalid'] }));
});
