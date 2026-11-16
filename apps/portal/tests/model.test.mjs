import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openModel, sourceStates, searchIndex, fingerprint, searchModule, linkSourcePages } from '../src/model.mjs';
import { renderBlocks } from '../src/markdown.mjs';
import { openAtlas } from '../../../library/src/model.mjs';
import { staleSources, referenceIndex } from '../../../library/src/references.mjs';
import { atlas, sha256, sources, week, policy, record } from './fixture.mjs';

test('the model holds each account in reading order, with every Point placed among the others', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root);
  assert.equal(model.status, 'ready');
  assert.deepEqual(model.diagnostics, []);
  const { accounts, points } = model.atlas;
  assert.equal(model.atlas.title, 'Harbour ferry');
  assert.deepEqual([...accounts.keys()], ['service', 'vessel', 'harbour']);
  assert.deepEqual(accounts.get('service'), { id: 'service', title: 'Service', scope: 'What a passenger can rely on, and where that stops.', base: 'service-base',
    order: ['service-base', 'service-timetable', 'service-fog', 'service-refund', 'service-claim', 'service-crew', 'service-count'] });
  const claim = points.get('service-claim');
  assert.equal(claim.account, 'service');
  assert.equal(claim.parent, 'service-refund');
  assert.deepEqual(claim.above, ['service-base', 'service-timetable', 'service-fog', 'service-refund']);
  assert.deepEqual(claim.children, []);
  assert.equal(claim.next, 'service-crew', 'after a last development, the next sibling of the nearest ancestor that has one');
  assert.deepEqual(points.get('service-base').children, ['service-timetable', 'service-crew', 'service-count']);
  assert.equal(points.get('service-base').next, 'service-timetable', 'the first development');
  assert.equal(points.get('service-crew').next, 'service-count', 'the next sibling');
  assert.equal(points.get('service-count').next, 'vessel-base', 'the end of an account leads on to the top Point of the next');
  assert.equal(points.get('vessel-engine').next, 'harbour-base');
  assert.equal(points.get('harbour-signal').next, null, 'the end of the last account leads nowhere');
  assert.equal(points.get('vessel-base').parent, null);
  assert.deepEqual(points.get('service-fog').standing, { type: 'decision', status: 'selected' });
  assert.deepEqual(points.get('service-count').standing, { type: 'observation', observedAt: '2026-11-03' });
  assert.equal(points.get('service-crew').standing, null);
  assert.equal(points.get('service-fog').uncertainty, 'The 200 metre figure was not measured on this vessel.');
  assert.equal(points.get('service-fog').file, 'trees/service/points/fog.md');
  assert.deepEqual([...points.keys()], ['service-base', 'service-timetable', 'service-fog', 'service-refund', 'service-claim', 'service-crew', 'service-count', 'vessel-base', 'vessel-radar', 'vessel-engine', 'harbour-base', 'harbour-signal']);
  const { style } = model.atlas;
  assert.deepEqual({ ...style }, { title: 'Plain accounts', body: 'Each account states one claim and develops it. See [the rules](https://example.org/rules).', blocks: style.blocks, html: style.html });
  assert.equal(style.html, '<p>Each account states one claim and develops it. See <a class="out" href="https://example.org/rules" target="_blank" rel="noopener noreferrer">the rules</a>.</p>\n');
  assert.deepEqual(style.blocks.map(block => block.html).join(''), style.html);
});

test('a Point knows the Points its prose links to, and those whose prose links to it', async t => {
  const { root } = await atlas(t);
  const { points } = (await openModel(root)).atlas;
  assert.deepEqual(points.get('service-fog').linksTo, ['vessel-radar', 'service-refund', 'harbour-base'], 'in the order the prose first names them; a link to a Facet or to a file is not one');
  assert.deepEqual(points.get('service-fog').linkedFrom, ['service-timetable', 'harbour-signal'], 'in reading order');
  assert.deepEqual(points.get('service-timetable').linkedFrom, ['service-base', 'vessel-engine']);
  assert.deepEqual(points.get('vessel-radar').linkedFrom, ['service-fog'], 'a Facet\'s prose is not a Point\'s');
  assert.deepEqual(points.get('service-crew').linkedFrom, []);
  assert.deepEqual(points.get('service-refund').linksTo, ['service-claim'], 'nothing is left out, not even a development: the page drops what its outline shows');
  const alone = (await openModel(root, { trees: ['service'] })).atlas.points;
  assert.deepEqual(alone.get('service-fog').linksTo, ['service-refund'], 'a Point that a publication does not hold is not listed');
  assert.deepEqual(alone.get('service-fog').linkedFrom, ['service-timetable']);
});

test('a Facet stands on the Point it is said of and on each Point it draws on', async t => {
  const { root } = await atlas(t);
  const { points, facets } = (await openModel(root)).atlas;
  const facet = facets.get('service:fog-radar');
  assert.deepEqual({ ...facet, blocks: undefined, html: undefined }, { key: 'service:fog-radar', id: 'fog-radar', account: 'service', file: 'trees/service/facets/fog-radar.md',
    title: 'The fog limit is the radar\'s reach', body: facet.body, on: 'service-fog', via: 'vessel', outside: false, targets: ['vessel-radar'],
    uncertainty: 'The radar was last checked in 2025.', sources: [], blocks: undefined, html: undefined });
  assert.deepEqual(points.get('service-fog').attached, ['service:fog-radar']);
  assert.deepEqual(points.get('service-fog').incoming, ['vessel:radar-duty']);
  assert.deepEqual(points.get('vessel-radar').incoming, ['service:fog-radar']);
  assert.deepEqual(points.get('vessel-radar').attached, ['vessel:radar-duty']);
  assert.match(facet.html, /<a href="\.\.\/\.\.\/\.\.\/\.\.\/vessel-radar\/">the radar<\/a>/, 'a Facet\'s links are written from its own page');
  assert.deepEqual(facets.get('vessel:crew-seats').sources, []);
});

test('each source carries what a reader sees of it, and stands against what it cites when asked', async t => {
  const stamp = sha256(policy);
  const { root, workspace, write } = await atlas(t, records => {
    records.set('trees/service/points/claim.md', record({ id: 'service-claim', sources: [{ uri: 'sources/linked.md', sha256: stamp }, { uri: 'sources', sha256: stamp }, { uri: '.atlas-state/drafts/x.json', sha256: stamp }] }, 'A refund is claimed at the quay office', 'The passenger shows the ticket at the quay office.'));
    records.set('trees/service/points/crew.md', record({ id: 'service-crew', sources: [{ uri: 'sources/linked.md' }] }, 'Two crew sail every crossing', 'A master and a deckhand are aboard on every crossing.'));
  });
  const model = await openModel(root);
  const point = id => model.atlas.points.get(id), base = point('service-base'), cited = base.sources;
  assert.deepEqual(cited[0], { uri: 'sources/log.md', title: 'Crossing log', role: 'evidence', locator: 'Week 45', stamp: sha256(sources['sources/log.md']), remote: false, shown: 'sources/log.md', href: null });
  assert.deepEqual(cited[4], { uri: '../outside/policy.md', title: 'Company policy', role: 'history', locator: null, stamp: sha256(policy), remote: false, shown: 'outside/policy.md', href: null });
  assert.deepEqual(cited[5], { uri: 'https://example.org/harbour-rules', title: 'Harbour rules', role: null, locator: null, stamp: null, remote: true, shown: 'https://example.org/harbour-rules', href: 'https://example.org/harbour-rules' });
  assert.deepEqual(await sourceStates(model, [base]), [['current', 'changed', 'missing', 'unstamped', 'denied', 'remote']]);
  assert.deepEqual(await sourceStates(model, [base], { allowedRoots: [root, path.join(workspace, 'outside')] }), [['current', 'changed', 'missing', 'unstamped', 'current', 'remote']], 'a granted folder is read');

  assert.deepEqual(await sourceStates(model, [point('vessel-engine')]), [['missing', 'missing']], 'a file that is not there and a fragment that names no heading are missing, stamped or not');

  // A reference with a fragment that names a heading cites that section, and only a change within it counts.
  const count = point('service-count');
  assert.deepEqual(count.sources.map(source => [source.uri, source.stamp, source.shown]), [['sources/log.md#week-45', sha256(week), 'sources/log.md#week-45']]);
  assert.deepEqual(await sourceStates(model, [count]), [['current']]);
  await write('sources/log.md', `# The crossing log, corrected\n\n${week}`);
  assert.deepEqual((await sourceStates(model, [base, count])).map(states => states[0]), ['changed', 'current'], 'the file changed outside the section');
  await write('sources/log.md', '# Crossing log\n\n## Week 45\n\nForty-one crossings.\n');
  assert.deepEqual(await sourceStates(model, [count]), [['changed']], 'states are read from disk at the time of asking');
  await write('sources/gone.md', 'What it held.\n');
  assert.deepEqual((await sourceStates(model, [base]))[0].slice(0, 3), ['changed', 'changed', 'current']);

  assert.deepEqual(await sourceStates(model, [point('vessel-base'), model.atlas.facets.get('service:gale'), point('vessel-engine')]), [[], ['unstamped'], ['missing', 'missing']],
    'one report answers for several records, a Facet among them, each with its own sources in order');
  await fs.symlink(path.join(workspace, 'outside/policy.md'), path.join(root, 'sources/linked.md'));
  assert.deepEqual(await sourceStates(model, [point('service-claim'), point('service-crew')]), [['denied', 'denied', 'denied'], ['unstamped']],
    'a link that leads out of the grants, a folder and Atlas\'s own state are not read; a reference without a stamp is never read');
});

test('a source stands as the Library\'s stale report says it does', async t => {
  const { root, workspace, write } = await atlas(t);
  await write('sources/log.md', `# The crossing log, corrected\n\n${week}`);
  for (const allowedRoots of [[root], [root, path.join(workspace, 'outside')]]) {
    const model = await openModel(root);
    const report = await staleSources(await openAtlas(root), { allowedRoots, limit: 10000 });
    assert.deepEqual([report.bounds.exhaustive, report.bounds.next], [true, null]);
    const stands = new Map(report.references.map(reference => [`${reference.from.kind} ${reference.from.tree} ${reference.from.id} ${reference.sourceIndex}`, reference.status]));
    const held = [...[...model.atlas.points.values()].map(point => ['point', point.account, point]), ...[...model.atlas.facets.values()].map(facet => ['facet', facet.account, facet])];
    let compared = 0;
    for (const [kind, tree, record] of held) for (const [index, state] of (await sourceStates(model, [record], { allowedRoots }))[0].entries()) {
      assert.equal(state, stands.get(`${kind} ${tree} ${record.id} ${index}`), `${record.id} source ${index}`);
      compared++;
    }
    assert.equal(compared, report.counts.references);
    if (allowedRoots.length === 1) assert.deepEqual(Object.entries(report.counts).filter(([, found]) => !found), [], 'the fixture holds a source of every standing');
  }
});

test('a publication holds only the chosen accounts, and marks what lies outside it', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root, { trees: ['service'], sourceBase: 'https://example.org/repo/atlas/' });
  const { accounts, points, facets } = model.atlas;
  assert.deepEqual([...accounts.keys()], ['service']);
  assert.deepEqual([...points.keys()], ['service-base', 'service-timetable', 'service-fog', 'service-refund', 'service-claim', 'service-crew', 'service-count']);
  assert.deepEqual([...facets.keys()], ['service:fog-radar', 'service:gale']);
  assert.equal(facets.get('service:fog-radar').outside, true);
  assert.deepEqual(facets.get('service:fog-radar').targets, []);
  assert.deepEqual(points.get('service-crew').incoming, [], 'a Facet of an account that is not held is not shown');
  assert.equal(points.get('service-count').next, null, 'the end of the one account held leads nowhere');
  const two = (await openModel(root, { trees: ['harbour', 'service'] })).atlas.points;
  assert.deepEqual([two.get('service-count').next, two.get('harbour-signal').next], ['harbour-base', null], 'the next account held, in the Atlas\'s order');
  const fog = points.get('service-fog').html;
  assert.match(fog, /The limit is\nthe radar's reach <span class="says">not in this publication<\/span>, and/);
  assert.match(fog, /<a href="\.\.\/_\/facet\/service\/fog-radar\/">how the limit follows the radar<\/a>/, 'a link to a Facet leads to the Facet\'s page');
  assert.match(fog, /closing rule <span class="says">not in this publication<\/span>/);
  assert.match(fog, /<a class="out" href="https:\/\/example\.org\/repo\/atlas\/sources\/log\.md#week-45" target="_blank" rel="noopener noreferrer">the crossing log<\/a>/, 'with a source base, a link to a local file leads there');
  assert.equal(points.get('service-base').sources[0].href, 'https://example.org/repo/atlas/sources/log.md');
  assert.equal(points.get('service-base').sources[4].href, 'https://example.org/repo/outside/policy.md');
  assert.doesNotMatch(JSON.stringify([...points.values()].map(item => item.html)), /radar reaches|closes the mouth/, 'no title of an account that is not held appears');
  await assert.rejects(openModel(root, { trees: ['service', 'absent'] }), { code: 'SELECTION_UNKNOWN' });
});

test('an Atlas that does not validate carries its diagnostics, and a folder without one is absent', async t => {
  const { root, write, workspace } = await atlas(t);
  await write('trees/service/points/fog.md', '---\n{"id":"service-fog","type":"decision"}\n---\n# Sailings stop in fog\n\nNo status.\n');
  const invalid = await openModel(root);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.atlas, null);
  assert.deepEqual(invalid.diagnostics, [{ code: 'DECISION_STATUS', path: 'trees/service/points/fog.md', message: 'A decision requires a supported status.' }]);
  assert.equal(await fingerprint(invalid), null);
  const absent = await openModel(path.join(workspace, 'outside'));
  assert.equal(absent.status, 'absent');
  assert.equal(absent.atlas, null);
});

test('the fingerprint holds while the files are untouched and moves with any change to them', async t => {
  const { root, write } = await atlas(t);
  await fs.mkdir(path.join(root, 'trees/vessel/points/later'));
  const model = await openModel(root);
  const first = await fingerprint(model);
  assert.match(first.key, /^[a-f0-9]{64}$/);
  assert.equal(typeof first.newest, 'bigint');
  assert.equal((await fingerprint(model)).key, first.key);
  const moved = async (change, why) => {
    const before = (await fingerprint(model)).key;
    await change();
    assert.notEqual((await fingerprint(model)).key, before, why);
  };
  await moved(() => write('trees/service/points/crew.md', '---\n{"id":"service-crew"}\n---\n# Three crew sail every crossing\n\nA master and two deckhands.\n'), 'a record was rewritten');
  await moved(() => write('trees/vessel/points/later/hull.md', '---\n{"id":"vessel-hull"}\n---\n# The hull is steel\n\nSteel.\n'), 'a file appeared in a folder that held none');
  await moved(() => write('.checks/tone.md', 'A check.\n'), 'a Check appeared');
  await moved(() => write('style.md', '# Plain accounts\n\nRevised.\n'), 'the Style was rewritten');
  await moved(() => fs.rm(path.join(root, 'trees/harbour/points/signal.md')), 'a record was removed');
  const settled = (await fingerprint(model)).key;
  await write('sources/log.md', 'changed');
  assert.equal((await fingerprint(model)).key, settled, 'a cited source is no record: it is read apart, when a page asks how it stands');
  assert.equal(await fingerprint(model, 5), null, 'more entries than the limit: no answer');
});

test('the search index is what the Library\'s own search ranks', async t => {
  const { root } = await atlas(t);
  const index = searchIndex(await openModel(root));
  assert.deepEqual(index.accounts, { service: 'Service', vessel: 'Vessel', harbour: 'Harbour' });
  // Every claim, then every view, as each has a page.
  assert.equal(index.records.length, 16);
  assert.deepEqual(Object.keys(index.records[0]), ['id', 'tree', 'title', 'body', 'uncertainty']);
  const byId = id => index.records.find(item => item.id === id);
  assert.deepEqual([byId('service-fog').type, byId('service-fog').status], ['decision', 'selected'], 'a claim carries its standing as the Library writes it');
  assert.deepEqual([byId('service-count').type, byId('service-count').observedAt], ['observation', '2026-11-03']);
  assert.deepEqual(byId('fog-radar'), { id: 'fog-radar', tree: 'service', title: 'The fog limit is the radar\'s reach', body: byId('fog-radar').body, uncertainty: 'The radar was last checked in 2025.', on: 'service-fog', via: 'vessel', targets: ['vessel-radar'] });
  const { searchPage } = await import(searchModule);
  const ranked = searchPage(index.records, { query: 'radar reach', limit: 12, presentation: 'summary' });
  assert.deepEqual(ranked.results.map(found => [found.kind ?? 'point', found.id]).slice(0, 3), [['point', 'vessel-radar'], ['facet', 'fog-radar'], ['facet', 'radar-duty']], 'a view is ranked among the claims, and stays a view');
  assert.deepEqual([ranked.available, searchPage(index.records, { query: 'radar reach', limit: 2 }).available], [ranked.results.length, ranked.results.length], 'and the search says how many matched in all');
  const only = searchIndex(await openModel(root, { trees: ['harbour'] }));
  assert.deepEqual(only.records.map(item => item.id), ['harbour-base', 'harbour-signal']);
  const service = searchIndex(await openModel(root, { trees: ['service'] }));
  assert.deepEqual(service.records.filter(item => item.on).map(item => [item.id, item.via, item.targets]), [['fog-radar', 'vessel', []], ['gale', 'harbour', []]], 'a Facet seen from a Tree not held keeps its name, and draws on nothing here');
});

test('Markdown never runs authored HTML, never loads an image, and links only where it is told', () => {
  const html = renderBlocks('<script>alert(1)</script>\n\n<b onclick="x()">bold</b> ![A chart](https://example.org/c.png) ![](c.png)\n\n[in](a.md) [facet](f.md) [out](https://example.org/x?a=1&b=2) [user](https://me:secret@example.org/) [mail](mailto:a@example.org) [js](javascript:alert(1)) [gone](b.md) [file](c.md) [here](#part)', {
    link: href => ({ 'a.md': { href: '../a/' }, 'f.md': { href: '../_/facet/t/f/' }, 'b.md': { absent: true } })[href] ?? null,
  }).map(block => block.html).join('');
  assert.doesNotMatch(html, /<script|<b |<img|onclick="/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<span class="image">\[Image: A chart\]<\/span> <span class="image">\[Image\]<\/span>/);
  assert.match(html, /<a href="\.\.\/a\/">in<\/a> <a href="\.\.\/_\/facet\/t\/f\/">facet<\/a>/);
  assert.match(html, /<a class="out" href="https:\/\/example\.org\/x\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">out<\/a>/);
  assert.match(html, / user mail \[js\]\(javascript:alert\(1\)\) gone <span class="says">not in this publication<\/span> file here<\/p>/, 'what a reader cannot follow stays as words');
  assert.equal((html.match(/<a /g) ?? []).length, 3);
  assert.equal((html.match(/<\/a>/g) ?? []).length, 3);
  const blocks = renderBlocks('First.\n\n- one\n- two\n\n| a |\n| - |\n| b |\n\n```\ncode\n```\n\nLast [ref].\n\n[ref]: https://example.org/ref\n');
  assert.deepEqual(blocks.map(block => block.source), ['First.', '- one\n- two', '| a |\n| - |\n| b |', '```\ncode\n```', 'Last [ref].']);
  assert.equal(blocks[1].html, '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n');
  assert.match(blocks[4].html, /<a class="out" href="https:\/\/example\.org\/ref"/, 'a reference defined elsewhere in the text still resolves');
});

test('a link to a record leads to the record\'s page and carries no fragment, while a link to a source file keeps its heading', async t => {
  const prose = 'Aboard are a master and a deckhand: see [the refund](refund.md#paid), [this claim](#aboard), [the radar](../../vessel/points/radar.md#reach), [its duty](../../vessel/facets/duty.md#fog) and [the log](../../../sources/log.md#week-45).';
  const { root } = await atlas(t, records => records.set('trees/service/points/crew.md', record({ id: 'service-crew', sources: [{ uri: 'sources/log.md#week-45', role: 'evidence' }] }, 'Two crew sail every crossing', prose)));
  assert.deepEqual(referenceIndex(await openAtlas(root)).diagnostics.filter(item => item.path === 'trees/service/points/crew.md').map(item => item.code), Array(4).fill('REFERENCE_FRAGMENT'), 'the Library says a record link carries no fragment');
  const model = await openModel(root, { sourceBase: 'https://example.org/ferry/' });
  assert.equal(model.status, 'ready');
  assert.equal(model.atlas.points.get('service-crew').html, '<p>Aboard are a master and a deckhand: see <a href="../service-refund/">the refund</a>, <a href="../service-crew/">this claim</a>, <a href="../vessel-radar/">the radar</a>, '
    + '<a href="../_/facet/vessel/radar-duty/">its duty</a> and <a class="out" href="https://example.org/ferry/sources/log.md#week-45" target="_blank" rel="noopener noreferrer">the log</a>.</p>\n',
    'a page\'s fragment is the chain of open panels, so a link to a record drops its own');
});

test('on the local service a link in prose to a file the Atlas cites leads to the file\'s own page, where the service shows one', async t => {
  // The log is cited by this claim and others, the trials by another claim only, the policy outside the Atlas by the top claim, and the note by none.
  const prose = 'See [the log](../../../sources/log.md#week-45), [the trials](../../../sources/trials.md), [the policy](../../../../outside/policy.md) and [a note](../../../sources/note.md).';
  const { root, workspace, write } = await atlas(t, records => records.set('trees/service/points/crew.md', record({ id: 'service-crew', sources: [{ uri: 'sources/log.md#week-45', role: 'evidence' }] }, 'Two crew sail every crossing', prose)));
  await write('sources/note.md', '# A note\n\nCited by nothing.\n');
  const linked = await openModel(root);
  await linkSourcePages(linked);
  assert.equal(linked.atlas.points.get('service-crew').html, '<p>See <a href="../_/source/?uri=sources%2Flog.md%23week-45#week-45">the log</a>, <a href="../_/source/?uri=sources%2Ftrials.md">the trials</a>, the policy and a note.</p>\n',
    'a file the grants do not reach, and one the Atlas does not cite, have no page, so their names stay words');
  const granted = await openModel(root);
  await linkSourcePages(granted, { allowedRoots: [root, workspace] });
  assert.match(granted.atlas.points.get('service-crew').html, /<a href="\.\.\/_\/source\/\?uri=\.\.%2Foutside%2Fpolicy\.md">the policy<\/a> and a note\./, 'a wider grant reaches the policy, written as the Atlas cites it');
  // A Facet's prose is drawn from its own page, three folders deeper.
  const { root: other } = await atlas(t, records => records.set('trees/service/facets/gale.md', records.get('trees/service/facets/gale.md').replace(/\n\n([^\n]+)\n$/, '\n\n$1 See [the log](../../../sources/log.md).\n')));
  const facets = await openModel(other);
  await linkSourcePages(facets);
  assert.match(facets.atlas.facets.get('service:gale').html, /<a href="\.\.\/\.\.\/\.\.\/\.\.\/_\/source\/\?uri=sources%2Flog\.md">the log<\/a>/);
  // Without it, as in an export without a source base, the names stay words.
  assert.equal((await openModel(root)).atlas.points.get('service-crew').html, '<p>See the log, the trials, the policy and a note.</p>\n');
});
