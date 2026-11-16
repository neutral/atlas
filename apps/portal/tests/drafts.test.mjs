import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openModel } from '../src/model.mjs';
import { listProposals, openProposal, proposedPoint, proposedFacet, proposedStyle, blockDifference } from '../src/drafts.mjs';
import { homePage, proposalPage, proposedPointPage, proposedFacetPage, proposedStylePage } from '../src/pages.mjs';
import { inspectChange, saveDraft } from '../../../library/src/authoring.mjs';
import { prepareStamp } from '../../../library/src/references.mjs';
import { atlas, propose, changes, reason, record, files, check } from './fixture.mjs';

const block = (source, html = `<p>${source}</p>`) => ({ source, html });
const when = iso => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(iso));

test('the difference of two texts is told block by block', () => {
  const before = [block('The ferry leaves on the hour in daylight.'), block('Fog stops it.'), block('Fares are paid aboard.'), block('The last sailing is at dusk.')];
  const after = [block('The ferry leaves on the hour in daylight and at dusk.'), block('Fares are paid aboard.'), block('A dog travels free.'), block('The last sailing is at dusk.')];
  assert.deepEqual(blockDifference(before, after), [
    { html: '<p>The ferry leaves on the hour in daylight and at dusk.</p>', word: null, before: '<p>The ferry leaves on the hour in daylight.</p>' },
    { html: '<p>Fog stops it.</p>', word: 'removed', before: null },
    { html: '<p>Fares are paid aboard.</p>', word: null, before: null },
    { html: '<p>A dog travels free.</p>', word: 'new', before: null },
    { html: '<p>The last sailing is at dusk.</p>', word: null, before: null },
  ]);
  assert.deepEqual(blockDifference([], [block('Only this.')]), [{ html: '<p>Only this.</p>', word: 'new', before: null }]);
  assert.deepEqual(blockDifference([block('Only this.')], []), [{ html: '<p>Only this.</p>', word: 'removed', before: null }]);
  assert.deepEqual(blockDifference([block('One thing entirely.')], [block('Another matter altogether, unrelated.')]).map(item => item.word), ['removed', 'new'], 'blocks that share too few words are not one block changed');
  assert.deepEqual(blockDifference([block('Same.'), block('Same.')], [block('Same.')]).map(item => item.word), [null, 'removed']);
});

test('a proposed change says what differs by account and what else to read', async t => {
  const { root } = await atlas(t);
  const draft = await propose(root, changes(), reason);
  const live = await openModel(root);
  assert.deepEqual(await listProposals(root, live), { unread: [], proposals: [{ id: draft.id, reason, preparedAt: draft.updatedAt, standing: 'ready', creates: false, differs: 4, stamped: { claims: 0, views: 0 }, stampsOnly: false }] });
  const proposal = await openProposal(root, draft.id, live);
  assert.equal(proposal.standing, 'ready');
  assert.equal(proposal.revision, draft.revision);
  assert.equal(proposal.reason, reason);
  assert.equal(proposal.title, 'Harbour ferry');
  assert.equal(proposal.differs, 4);
  assert.deepEqual([...proposal.words.points], [['service-base', 'changed'], ['service-claim', 'removed'], ['service-fog', 'changed'], ['service-notice', 'new']]);
  assert.deepEqual([...proposal.words.facets], [['service:fog-radar', 'changed']]);
  assert.deepEqual(proposal.accounts, [
    { id: 'service', title: 'Service', scope: 'What a passenger can rely on, and where that stops.', word: 'changed', parts: ['outline'], was: { title: null, scope: null },
      points: [
        { id: 'service-base', title: 'The ferry sails on the hour while the harbour is open', word: 'changed' },
        { id: 'service-fog', title: 'Sailings stop in fog below 300 metres', word: 'changed' },
        { id: 'service-notice', title: 'A stopped sailing is announced at both quays', word: 'new' },
        { id: 'service-claim', title: 'A refund is claimed at the quay office', word: 'removed' },
      ],
      facets: [{ key: 'service:fog-radar', title: 'The fog limit is the radar\'s reach', word: 'changed', label: 'Facet, seen from Vessel' }] },
    { id: 'harbour', title: 'Harbour', scope: 'When the harbour authority opens and closes the mouth, and how it says so.', word: 'changed', parts: ['scope'],
      was: { title: null, scope: 'When the harbour authority opens and closes the mouth.' }, points: [], facets: [] },
  ], 'an account whose own outline or scope differs says which');
  assert.deepEqual([proposal.style, proposal.checks], [null, []]);
  assert.deepEqual(proposal.above, ['service-timetable', 'service-refund'], 'the claims above what differs, without what differs itself');
  assert.deepEqual(proposal.drawing, ['vessel:radar-duty'], 'the Facets that draw on what differs');
  assert.equal(proposal.model.atlas.points.get('service-fog').title, 'Sailings stop in fog below 300 metres');
  assert.equal(proposal.before.atlas.points.get('service-fog').title, 'Sailings stop in fog below 200 metres');
  assert.equal(await openProposal(root, 'no-such-draft', live), null);
  assert.equal((await openModel(root)).identity, live.identity, 'reading a proposed change writes nothing');
});

test('a change that only stamps says so: its claim is stamped in blue, not changed, and nothing else is to be read for it', async t => {
  const { root } = await atlas(t);
  const stamp = await prepareStamp(root, { points: ['service-base'], reason: 'Record what the sources of the base say now' });
  assert.deepEqual(stamp.plan.changes.map(change => change.path), ['trees/service/points/base.md']);
  const draft = await saveDraft(root, { plan: stamp.plan });
  const live = await openModel(root);
  const proposal = await openProposal(root, draft.id, live);
  assert.deepEqual([...proposal.words.points], [['service-base', 'stamped']]);
  assert.deepEqual([proposal.differs, proposal.stamped, proposal.stampsOnly, proposal.above, proposal.drawing], [0, { claims: 1, views: 0 }, true, [], []]);
  assert.match(homePage(live, { ...await listProposals(root, live), timeZone: 'UTC' }), /<p class="says">only stamps: 1 Point stamped, nothing they say differs · prepared /);
  const page = proposalPage(proposal, { timeZone: 'UTC' });
  assert.match(page, /<p class="says">Ready to apply · prepared [^<]*<\/p>\n<p class="says">only stamps: 1 Point stamped, nothing they say differs<\/p>/);
  assert.match(page, /<li><span class="blue">stamped<\/span><a href="service-base\/">The ferry sails on the hour while the harbour is open<\/a><\/li>/);
  // Under the strip, which says in red that this is a proposed change, red is only for a difference the reader must attend to.
  const main = html => html.slice(html.indexOf('<main'));
  assert.doesNotMatch(main(page), /class="red"|What else to read/);
  const base = proposedPoint(proposal, 'service-base');
  assert.equal(base.marks.word, 'stamped');
  assert.deepEqual(base.marks.sources.map(item => [item.source.uri, item.word]).filter(([, word]) => word), [['sources/notice.md', 'stamped'], ['sources/chart.md', 'stamped']], 'a stamp written over an earlier one, and a first one');
  const drawn = proposedPointPage(proposal, base);
  assert.match(drawn, /<div class="kind"><span class="blue">stamped<\/span><span class="cap" data-standing>Point<\/span><\/div>/);
  assert.match(drawn, /<li><span>Harbour notice<\/span><span class="file">sources\/notice\.md<\/span><span class="blue">stamped<\/span><\/li>/);
  assert.doesNotMatch(main(drawn), /class="red"/);
  // Beside a change that differs, a stamped claim is counted apart.
  const mixed = await propose(root, [...stamp.plan.changes.map(change => ({ path: change.path, content: change.after })), changes().find(change => change.path === 'trees/service/points/fog.md')], 'Stamp the base and move the fog limit');
  const both = await openProposal(root, mixed.id, live);
  assert.deepEqual([both.differs, both.stamped, both.stampsOnly], [1, { claims: 1, views: 0 }, false]);
  assert.match(homePage(live, { ...await listProposals(root, live), timeZone: 'UTC' }), /<p class="says">1 Point differs · 1 Point stamped · prepared /);
});

test('a Point as proposed carries each difference from the Atlas it was prepared against', async t => {
  const { root } = await atlas(t);
  const draft = await propose(root, changes(), reason);
  const proposal = await openProposal(root, draft.id, await openModel(root));

  const fog = proposedPoint(proposal, 'service-fog');
  assert.equal(fog.asItIs, true);
  assert.equal(fog.atlas, proposal.model.atlas);
  assert.equal(fog.point.title, 'Sailings stop in fog below 300 metres');
  assert.equal(fog.marks.word, 'changed');
  assert.equal(fog.marks.title, 'Sailings stop in fog below 200 metres');
  assert.deepEqual(fog.marks.standing, { word: 'changed', before: { type: 'decision', status: 'selected' } });
  assert.equal(fog.marks.place, null);
  assert.deepEqual(fog.marks.uncertainty, { word: 'changed', before: 'The 200 metre figure was not measured on this vessel.' });
  assert.equal(fog.marks.sources, null);
  assert.deepEqual(fog.marks.blocks.map(item => [item.word, item.before === null ? null : 'before']), [[null, 'before'], ['new', null], [null, null], [null, null], [null, null], [null, null], [null, null], ['removed', null]]);
  assert.match(fog.marks.blocks[0].html, /cannot be seen from the bridge\./);
  assert.match(fog.marks.blocks[0].before, /cannot be seen\. The limit is/);
  assert.equal(fog.marks.blocks[1].html, '<p>The mate may also stop a sailing when the master is ashore.</p>\n');
  assert.equal(fog.marks.blocks[7].html, '<pre><code>fog &lt; 200 m: stop\n</code></pre>\n');
  assert.equal(fog.marks.words, proposal.words, 'the names around it take their words from the proposal');
  assert.deepEqual(fog.marks.gone, { beneath: [], beside: [], facets: [] });

  const base = proposedPoint(proposal, 'service-base');
  assert.deepEqual(base.marks.uncertainty, { word: 'removed', before: 'Whether the hourly sailing holds in winter is not recorded.' });
  assert.equal(base.marks.blocks, null, 'the prose is the same');
  assert.deepEqual(base.marks.sources.map(item => [item.source.uri, item.word ?? null, item.before?.locator ?? null]), [
    ['sources/log.md', 'changed', 'Week 45'],
    ['sources/notice.md', 'stamped', null],
    ['sources/log.md#week-45', 'new', null],
    ['sources/chart.md', null, null],
    ['../outside/policy.md', null, null],
    ['https://example.org/harbour-rules', null, null],
    ['sources/gone.md', 'removed', null],
  ]);

  const refund = proposedPoint(proposal, 'service-refund');
  assert.equal(refund.marks.word, null);
  assert.deepEqual(refund.marks.gone.beneath, [{ id: 'service-claim', title: 'A refund is claimed at the quay office' }], 'a development the proposal removes');
  assert.deepEqual(refund.marks.gone.beside, []);

  const added = proposedPoint(proposal, 'service-notice');
  assert.equal(added.marks.word, 'new');
  assert.equal(added.asItIs, false);
  assert.equal(added.marks.blocks, null);
  assert.deepEqual(added.marks.gone.beside, [{ id: 'service-claim', title: 'A refund is claimed at the quay office' }], 'a claim the proposal removes from beside it');

  const claim = proposedPoint(proposal, 'service-claim');
  assert.equal(claim.marks.word, 'removed');
  assert.equal(claim.atlas, proposal.before.atlas, 'a removed Point is drawn from the Atlas that held it');
  assert.deepEqual(claim.point.above, ['service-base', 'service-timetable', 'service-fog', 'service-refund']);
  assert.deepEqual(claim.marks.blocks, [{ html: '<p>The passenger shows the ticket at the quay office.</p>\n', word: 'removed', before: null }]);
  assert.equal(proposedPoint(proposal, 'no-such-point'), null);

  const facet = proposedFacet(proposal, 'service:fog-radar');
  assert.equal(facet.marks.word, 'changed');
  assert.equal(facet.asItIs, true);
  assert.equal(facet.marks.title, null);
  assert.deepEqual(facet.marks.blocks.map(item => Boolean(item.before)), [true]);
  assert.match(facet.marks.blocks[0].html, /the harbour authority now asks for 300 metres/);
  assert.equal(proposedFacet(proposal, 'vessel:radar-duty').marks.word, null, 'a Facet that does not differ reads as proposed too');
  assert.equal(proposedFacet(proposal, 'service:no-such-facet'), null);
});

test('a Point that moves, a Facet that goes and an account that comes are each told', async t => {
  const { root } = await atlas(t);
  const records = files();
  const service = JSON.parse(records.get('trees/service/tree.json'));
  service.children[0].children[0].children = [];
  service.children.push({ point: 'service-refund', children: [{ point: 'service-claim' }] });
  const draft = await propose(root, [
    { path: 'trees/service/tree.json', content: `${JSON.stringify(service, null, 2)}\n` },
    { path: 'trees/service/facets/fog-radar.md', content: null },
    { path: 'atlas.json', content: records.get('atlas.json').replace('"trees/harbour"', '"trees/harbour",\n    "trees/crew"') },
    { path: 'trees/crew/tree.json', content: `${JSON.stringify({ id: 'crew', title: 'Crew', scope: 'Who sails.', base: 'crew-base', children: [] }, null, 2)}\n` },
    { path: 'trees/crew/points/base.md', content: record({ id: 'crew-base' }, 'A master holds a harbour ticket', 'The master is licensed for this harbour.') },
  ], 'Move refunds up, and give the crew an account');
  const proposal = await openProposal(root, draft.id, await openModel(root));
  assert.deepEqual(proposal.accounts.map(account => [account.id, account.word, account.points.map(item => `${item.id} ${item.word}`), account.facets.map(item => `${item.key} ${item.word}`)]), [
    ['service', 'changed', ['service-refund changed', 'service-claim changed'], ['service:fog-radar removed']],
    ['crew', 'new', ['crew-base new'], []],
  ]);
  assert.deepEqual(proposal.accounts.map(account => [account.parts, account.was, account.scope]), [[['outline'], { title: null, scope: null }, 'What a passenger can rely on, and where that stops.'], [[], { title: null, scope: null }, 'Who sails.']]);
  const refund = proposedPoint(proposal, 'service-refund');
  assert.deepEqual(refund.marks.place, { account: 'Service', claims: [{ id: 'service-base', title: 'The ferry sails on the hour while the harbour is open', word: null },
    { id: 'service-timetable', title: 'The timetable holds in daylight', word: null }, { id: 'service-fog', title: 'Sailings stop in fog below 200 metres', word: null }] });
  assert.equal(refund.marks.blocks, null);
  const moved = proposedPointPage(proposal, refund);
  assert.match(moved, /<h2 class="cap"><span data-account>Service<\/span><\/h2><ul><li><a class="opens" href="\.\.\/service-base\/" data-open="service-base">[^<]*<\/a><ul><li><a class="opens" href="\.\.\/service-timetable\/"[^]*?<li class="here"><span aria-current="page">A stopped sailing is refunded in full &amp; &quot;at once&quot;<span class="red">changed<\/span><\/span>/, 'the outline shows where it now stands');
  assert.match(moved, /<\/section>\n<section class="map"><h2 class="cap"><span class="red">Before<\/span> in Service, under<\/h2><ul><li><a class="opens" href="\.\.\/service-base\/" data-open="service-base">The ferry sails on the hour while the harbour is open<\/a><ul><li><a class="opens" href="\.\.\/service-timetable\/" data-open="service-timetable">The timetable holds in daylight<\/a><ul><li><a class="opens" href="\.\.\/service-fog\/" data-open="service-fog">Sailings stop in fog below 200 metres<\/a><\/li><\/ul><\/li><\/ul><\/li><\/ul><\/section>/, 'and where it stood before follows, as names that open; nothing in a margin opens there');
  assert.doesNotMatch(moved.slice(moved.indexOf('<nav class="margin"'), moved.indexOf('</nav>')), /<details/);
  const fog = proposedPoint(proposal, 'service-fog');
  assert.deepEqual(fog.marks.gone.facets, [{ key: 'service:fog-radar', title: 'The fog limit is the radar\'s reach', label: 'Facets seen from Vessel' }]);
  assert.deepEqual(proposal.model.atlas.points.get('service-fog').attached, []);
  const gone = proposedFacet(proposal, 'service:fog-radar');
  assert.equal(gone.marks.word, 'removed');
  assert.equal(gone.atlas, proposal.before.atlas, 'a removed Facet is drawn from the Atlas that held it');
  assert.deepEqual(gone.marks.blocks.map(item => item.word), ['removed']);
});

test('a change to the Style, to a Check and to an account\'s title is each told, and the Style reads as proposed', async t => {
  const { root } = await atlas(t, records => {
    records.set('.checks/tone.md', check('tone', 'Every claim is a plain sentence'));
    records.set('.checks/hours.md', check('hours', 'Every sailing has an hour', { level: 'required' }));
  });
  const restyle = { path: 'style.md', content: '# Plain accounts, dated\n\nEach account states one claim and develops it. See [the rules](https://example.org/rules).\n\nEvery observation carries its date.\n' };
  const others = [
    { path: '.checks/tone.md', content: null },
    { path: '.checks/dates.md', content: check('dates', 'Every observation carries its date') },
    { path: '.checks/hours.md', content: check('hours', 'Every sailing has an hour and a quay', { status: 'retired', level: 'required', requirement: 'Each sailing names its hour and its quay.' }) },
    { path: 'trees/vessel/tree.json', content: files().get('trees/vessel/tree.json').replace('"title": "Vessel"', '"title": "The vessel"') },
  ];
  const live = await openModel(root);

  const styled = await openProposal(root, (await propose(root, [restyle], 'Date every observation')).id, live);
  assert.deepEqual([styled.standing, styled.style, styled.checks, styled.accounts, styled.differs], ['ready', 'changed', [], [], 0]);
  assert.match(homePage(live, { ...await listProposals(root, live), timeZone: 'UTC' }), /<p class="says">no Point differs · prepared /);
  const page = proposalPage(styled, { timeZone: 'UTC' });
  assert.match(page, /<h2 class="cap">What differs<\/h2><ol class="accounts"><li><h3 class="tree">How this Atlas is written<\/h3><div><ul class="claims"><li><span class="red">changed<\/span><a href="_\/style\/">Plain accounts, dated<\/a><\/li><\/ul><\/div><\/li><\/ol>/);
  assert.doesNotMatch(page, /What else to read/);
  assert.match(page, /To apply/);
  const style = proposedStyle(styled);
  assert.deepEqual([style.marks.word, style.marks.title], ['changed', 'Plain accounts']);
  assert.deepEqual(style.marks.blocks.map(block => block.word), [null, 'new']);
  const written = proposedStylePage(styled, style);
  assert.match(written, /<title>Plain accounts, dated · Proposed change · Harbour ferry<\/title>/);
  assert.match(written, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  assert.match(written, /<header class="strip"><a class="title" href="\.\.\/\.\.\/">Harbour ferry<\/a><span class="red">Proposed change<\/span><a href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/">The Atlas as it is<\/a><a class="control help" href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/header>/, 'the Style has no page in the Atlas as it is: the way back is home');
  assert.match(written, /<div class="kind"><span class="red">changed<\/span><span class="cap">How this Atlas is written<\/span><\/div>\n<h1>Plain accounts, dated<\/h1><details class="before"><summary>Before<\/summary><p class="was">Plain accounts<\/p><\/details>\n<div class="body"><p>Each account states one claim[^]*?<\/p>\n<div class="added"><span class="red">new<\/span><p>Every observation carries its date\.<\/p>\n<\/div><\/div>/);

  const held = await openProposal(root, (await propose(root, others, 'Hold observations to their dates')).id, live);
  assert.deepEqual([held.standing, held.style], ['ready', null]);
  const text = (requirement = 'It holds.', level = 2) => `<h${level}>Requirement</h${level}>\n<p>${requirement}</p>\n<h${level}>Verification</h${level}>\n<p>A reader looks.</p>\n<h${level}>Failure</h${level}>\n<p>It does not hold.</p>\n`;
  assert.deepEqual(held.checks, [
    { title: 'Every observation carries its date', path: '.checks/dates.md', level: 'advisory', status: 'active', html: text(), word: 'new', was: null },
    { title: 'Every sailing has an hour and a quay', path: '.checks/hours.md', level: 'required', status: 'retired', html: text('Each sailing names its hour and its quay.'), word: 'changed',
      was: { title: 'Every sailing has an hour', path: null, rule: { level: 'required', status: 'active' }, html: text() } },
    { title: 'Every claim is a plain sentence', path: '.checks/tone.md', level: 'advisory', status: 'active', html: text(), word: 'removed', was: null },
  ], 'each Check that differs, with its text as proposed and what it was where that differs');
  assert.deepEqual(held.accounts, [{ id: 'vessel', title: 'The vessel', scope: 'What the hull and its instruments can do.', word: 'changed', parts: ['title'], was: { title: 'Vessel', scope: null }, points: [], facets: [] }]);
  const listed = proposalPage(held, { timeZone: 'UTC' });
  assert.match(listed, /<ol class="accounts"><li><h3 class="tree">The vessel<span class="red">changed<\/span><\/h3><div><p class="says">its title<\/p><details class="before"><summary>Before<\/summary><p class="tree">Vessel<\/p><\/details><\/div><\/li>/);
  const before = html => `<details class="before"><summary>Before</summary>${html}</details>`;
  assert.ok(listed.includes(`<li><h3 class="tree">What this Atlas is held to</h3><div><ul class="claims">${[
    `<li><span class="red">new</span><div class="held"><p class="named">Every observation carries its date</p><span class="file">.checks/dates.md</span><p class="cap">Advisory · active</p><div class="body">${text(undefined, 4)}</div></div></li>`,
    `<li><span class="red">changed</span><div class="held"><p class="named">Every sailing has an hour and a quay</p><span class="file">.checks/hours.md</span><p class="cap">Required · retired</p><div class="body">${text('Each sailing names its hour and its quay.', 4)}</div>${before(`<div><p class="named">Every sailing has an hour</p><p class="cap">Required · active</p><div class="body">${text(undefined, 4)}</div></div>`)}</div></li>`,
    `<li><span class="red">removed</span><div class="held"><p class="named gone">Every claim is a plain sentence</p><span class="file">.checks/tone.md</span><p class="cap gone">Advisory · active</p><div class="body gone">${text(undefined, 4)}</div></div></li>`,
  ].join('')}</ul></div></li></ol>`), 'a Check shows its text as proposed, its sections under the page\'s headings, and under it one Before with whichever of its title, how it binds and its text differ; a removed one is struck through; none is a link');
  assert.equal(proposedStyle(held).marks.word, null, 'a Style that does not differ reads as proposed too');
  const unchanged = proposedStylePage(held, proposedStyle(held));
  assert.doesNotMatch(unchanged, /class="red">(?:new|changed|removed)/);
  assert.match(unchanged, /<main class="doc">\n<div class="row">\n<article class="point">\n<div class="kind"><span class="cap">How this Atlas is written<\/span><\/div>\n<h1>Plain accounts<\/h1>\n<div class="body"><p>Each account states one claim and develops it\. See <a class="out" href="https:\/\/example\.org\/rules" target="_blank" rel="noopener noreferrer">the rules<\/a>\.<\/p>\n<\/div>\n<\/article>\n<\/div>\n<\/main>/, 'it follows a Point\'s page, without a margin');

  // The Style changes alone. With anything else the Library marks the change invalid, and its page says why and still says what differs.
  const mixed = await openProposal(root, (await propose(root, [restyle, ...others], 'Date every observation, and hold the Atlas to it')).id, live);
  assert.equal(mixed.standing, 'invalid');
  assert.deepEqual(mixed.diagnostics, [{ code: 'STYLE_CHANGE_ALONE', path: 'style.md', message: 'A change that alters the Style alters no other file. Prepare the Style change and the other changes separately.' }]);
  const refused = proposalPage(mixed, { timeZone: 'UTC' });
  assert.match(refused, /<p class="red">Invalid: it cannot be applied as it stands · prepared /);
  assert.match(refused, /<ul class="diagnostics"><li><span class="red"><span aria-hidden="true">✗ <\/span>STYLE_CHANGE_ALONE<\/span><p>A change that alters the Style alters no other file\. Prepare the Style change and the other changes separately\.<span class="file">style\.md<\/span><\/p><\/li><\/ul>/);
  assert.match(refused, /What differs[^]*The vessel[^]*How this Atlas is written[^]*What this Atlas is held to/);
  assert.doesNotMatch(refused, /To apply|atlas --root/);
  assert.equal(proposedStyle(mixed).marks.word, 'changed', 'what it proposes validates, so it can still be read');
});

test('a change to the Atlas itself opens what differs: its title, its ID, which Trees it holds and their order', async t => {
  const { root } = await atlas(t);
  const records = files(), manifest = JSON.parse(records.get('atlas.json')), json = value => `${JSON.stringify(value, null, 2)}\n`;
  const live = await openModel(root);
  const renamed = await openProposal(root, (await propose(root, [{ path: 'atlas.json', content: json({ ...manifest, id: 'harbour-ferry', title: 'The harbour ferry', trees: ['trees/vessel', 'trees/service', 'trees/harbour'] }) }], 'Lead with the vessel')).id, live);
  assert.deepEqual(renamed.itself, { word: 'changed', parts: ['title', 'id', 'order'], title: 'The harbour ferry', id: 'harbour-ferry', order: ['Vessel', 'Service', 'Harbour'], was: { title: 'Harbour ferry', id: 'ferry' } });
  assert.deepEqual([renamed.accounts, renamed.differs, renamed.title], [[], 0, 'The harbour ferry']);
  assert.ok(proposalPage(renamed, { timeZone: 'UTC' }).includes('<h2 class="cap">What differs</h2><ol class="accounts"><li><h3 class="tree">This Atlas<span class="red">changed</span></h3><div><p class="says">its title, its ID, the order of its Trees</p>'
    + '<p class="said">The harbour ferry</p><details class="before"><summary>Before</summary><p class="said">Harbour ferry</p></details><p class="tree">harbour-ferry</p><details class="before"><summary>Before</summary><p class="tree">ferry</p></details>'
    + '<ol class="order"><li>Vessel</li><li>Service</li><li>Harbour</li></ol></div></li></ol>'), 'the title and the ID as proposed with what they were, and the accounts in their order as proposed');

  const regrouped = await openProposal(root, (await propose(root, [
    { path: 'atlas.json', content: json({ ...manifest, trees: ['trees/service', 'trees/vessel', 'trees/crew'] }) },
    { path: 'trees/crew/tree.json', content: json({ id: 'crew', title: 'Crew', scope: 'Who sails.', base: 'crew-base', children: [] }) },
    { path: 'trees/crew/points/base.md', content: record({ id: 'crew-base' }, 'A master holds a harbour ticket', 'The master is licensed for this harbour.') },
    ...['trees/harbour/tree.json', 'trees/harbour/points/base.md', 'trees/harbour/points/signal.md', 'trees/service/facets/gale.md'].map(file => ({ path: file, content: null })),
  ], 'Give the crew an account, and leave the harbour to its authority')).id, live);
  assert.deepEqual(regrouped.itself, { word: 'changed', parts: ['accounts'], title: 'Harbour ferry', id: 'ferry', order: null, was: { title: null, id: null } });
  const page = proposalPage(regrouped, { timeZone: 'UTC' });
  assert.match(page, /<ol class="accounts"><li><h3 class="tree">This Atlas<span class="red">changed<\/span><\/h3><div><p class="says">which Trees it holds<\/p><\/div><\/li><li><h3 class="tree">Service<\/h3>[^]*<li><h3 class="tree">Crew<span class="red">new<\/span><\/h3>[^]*<li><h3 class="tree">Harbour<span class="red">removed<\/span><\/h3>/, 'which accounts come and go is said once, by each account');
});

test('a file a change rewrites while nothing in its record differs is named, with its file only', async t => {
  const { root } = await atlas(t, records => records.set('.checks/tone.md', check('tone', 'Every claim is a plain sentence')));
  const records = files(), live = await openModel(root);
  const indented = await openProposal(root, (await propose(root, [
    { path: 'atlas.json', content: `${JSON.stringify(JSON.parse(records.get('atlas.json')), null, 4)}\n` },
    { path: 'trees/vessel/tree.json', content: `${JSON.stringify(JSON.parse(records.get('trees/vessel/tree.json')), null, 4)}\n` },
    { path: 'trees/service/points/crew.md', content: records.get('trees/service/points/crew.md').replace('{"id":"service-crew"}', '{ "id": "service-crew" }') },
    { path: 'trees/vessel/facets/duty.md', content: records.get('trees/vessel/facets/duty.md').replace('{"id":"radar-duty"', '{ "id": "radar-duty"') },
    { path: '.checks/tone.md', content: check('tone', 'Every claim is a plain sentence').replace('{"id":"tone"', '{ "id": "tone"') },
  ], 'Indent the files the other way')).id, live);
  assert.deepEqual([indented.differs, [...indented.words.points], [...indented.words.facets]], [0, [], []], 'nothing in them differs, so no claim is marked anywhere');
  assert.deepEqual(indented.itself, { word: null, parts: ['file'], title: 'Harbour ferry', id: 'ferry', order: null, was: { title: null, id: null } });
  assert.deepEqual(indented.accounts.map(account => [account.id, account.word, account.parts, account.points, account.facets.map(facet => [facet.key, facet.word])]), [
    ['service', null, [], [{ id: 'service-crew', title: 'Two crew sail every crossing', word: null }], []],
    ['vessel', null, ['file'], [], [['vessel:radar-duty', null]]],
  ]);
  const page = proposalPage(indented, { timeZone: 'UTC' });
  assert.ok(page.includes('<li><h3 class="tree">This Atlas</h3><div><p class="says">its file only</p></div></li>'));
  assert.ok(page.includes('<li><h3 class="tree">Service</h3><div><ul class="claims"><li><span></span><span><a href="service-crew/">Two crew sail every crossing</a><span class="says">its file only</span></span></li></ul></div></li>'));
  assert.ok(page.includes('<li><h3 class="tree">Vessel</h3><div><p class="says">its file only</p><ul class="claims"><li><span></span><span><span class="cap">Facet, seen from Service</span><a href="_/facet/vessel/radar-duty/">The radar is kept running for the fog rule</a><span class="says">its file only</span></span></li></ul></div></li>'));
  assert.match(page, /<p class="cap">Advisory · active<\/p><div class="body">[^]*?<\/div><p class="says">its file only<\/p><\/div><\/li>/);
  assert.doesNotMatch(page.slice(page.indexOf('What differs')), /class="red"/, 'a difference in a file alone is no difference the reader must attend to');
  assert.doesNotMatch(proposedPointPage(indented, proposedPoint(indented, 'service-crew')), /class="red">(?:new|changed|removed)/);

  const spaced = await openProposal(root, (await propose(root, [{ path: 'style.md', content: records.get('style.md').replace('# Plain accounts\n', '#  Plain accounts\n') }], 'Space the title of the Style')).id, live);
  assert.equal(spaced.style, 'file');
  assert.ok(proposalPage(spaced, { timeZone: 'UTC' }).includes('<li><h3 class="tree">How this Atlas is written</h3><div><ul class="claims"><li><span></span><span><a href="_/style/">Plain accounts</a><span class="says">its file only</span></span></li></ul></div></li>'));
  assert.equal(proposedStyle(spaced).marks.word, null);
});

test('a proposed change is stale once the Atlas has changed, and invalid when what it proposes does not validate', async t => {
  const { root, write } = await atlas(t);
  const records = files();
  const good = await propose(root, changes(), reason);
  const bad = await propose(root, [{ path: 'trees/service/points/fog.md', content: records.get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"') }], 'Leave the decision open');
  let live = await openModel(root);
  const invalid = await openProposal(root, bad.id, live);
  assert.equal(invalid.standing, 'invalid');
  assert.equal(invalid.model.atlas, null);
  assert.deepEqual(invalid.diagnostics, [{ code: 'DECISION_STATUS', path: 'trees/service/points/fog.md', message: 'A decision requires a supported status.' }]);
  assert.deepEqual(invalid.accounts, []);
  assert.equal(invalid.differs, 1, 'without records to compare, the Point files it writes are counted');
  const listed = async () => (await listProposals(root, live)).proposals.map(item => [item.id, item.standing]).sort();
  assert.deepEqual(await listed(), [[good.id, 'ready'], [bad.id, 'invalid']].sort());

  assert.equal((await openProposal(root, good.id, live)).standing, 'ready');
  await write('trees/vessel/points/base.md', record({ id: 'vessel-base' }, 'One hull carries sixty-two passengers', 'The ferry is a single hull licensed for sixty-two.'));
  live = await openModel(root);
  const stale = await openProposal(root, good.id, live);
  assert.equal(stale.standing, 'stale');
  assert.equal(stale.differs, 4, 'what differs is still told against the Atlas it was prepared for');
  assert.deepEqual(await listed(), [[good.id, 'stale'], [bad.id, 'invalid']].sort(), 'the list holds each one\'s standing as its page has it');
  const page = proposalPage(stale, { timeZone: 'UTC' });
  assert.match(page, /<p class="red">Stale: the Atlas has changed since this was prepared · prepared /);
  assert.doesNotMatch(page, /To apply|atlas --root/);
  // When the Library cannot tell what blocks an apply, its page says why in the Library's words, and names no command.
  const untold = proposalPage({ ...stale, standing: 'blocked', blocker: { code: null, message: 'Private state belongs to another Atlas or has invalid ownership metadata.' } }, { timeZone: 'UTC' });
  assert.match(untold, /<p class="red">Blocked: Private state belongs to another Atlas or has invalid ownership metadata\. · prepared /);
  assert.doesNotMatch(untold, /To recover|To apply|atlas --root/);
  const refused = proposalPage(invalid, { timeZone: 'UTC' });
  assert.match(refused, /<p class="red">Invalid: it cannot be applied as it stands · prepared /);
  assert.match(refused, /<li><span class="red"><span aria-hidden="true">✗ <\/span>DECISION_STATUS<\/span><p>A decision requires a supported status\.<span class="file">trees\/service\/points\/fog\.md<\/span><\/p><\/li>/);
  assert.ok(refused.includes('<section><h2 class="cap">What differs</h2><ol class="accounts"><li><h3 class="tree">Files</h3><div><ul class="claims"><li><span class="red">changed</span><span>Sailings stop in fog below 200 metres<span class="file">trees/service/points/fog.md</span></span></li></ul></div></li></ol></section>'),
    'nothing in it reads as proposed, so each file it writes is named by its path and by what the Atlas as it is calls it; none is a link');
  assert.doesNotMatch(refused, /To apply/);
});

test('a change prepared against an Atlas that does not validate is told like any other, from the records its files held', async t => {
  const { root, write } = await atlas(t, records => records.set('.checks/hours.md', check('hours', 'Every sailing has an hour', { level: 'required' })));
  const records = files();
  await write('trees/service/points/fog.md', records.get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"'));
  const live = await openModel(root);
  assert.equal(live.status, 'invalid');
  const repair = await propose(root, [{ path: 'trees/service/points/fog.md', content: records.get('trees/service/points/fog.md') }], 'Restore the decision');
  const restored = await openProposal(root, repair.id, live);
  assert.equal(restored.standing, 'ready');
  assert.equal(restored.before.atlas, null);
  assert.deepEqual([...restored.words.points], [['service-fog', 'changed']], 'what differs in the record, not that its file was written');
  assert.deepEqual(restored.accounts.map(account => [account.id, account.word, account.points]), [['service', null, [{ id: 'service-fog', title: 'Sailings stop in fog below 200 metres', word: 'changed' }]]]);
  const fog = proposedPoint(restored, 'service-fog');
  assert.equal(fog.marks.word, 'changed');
  assert.equal(fog.marks.blocks, null, 'with no Atlas presented as it was, a claim has no earlier text to show');

  // The same change as against a valid Atlas: what is new, changed and removed, the accounts with what they said before, and a Check.
  const proposal = await openProposal(root, (await propose(root, [...changes(), { path: '.checks/hours.md', content: check('hours', 'Every sailing has an hour and a quay', { level: 'required' }) }], reason)).id, live);
  assert.deepEqual([proposal.standing, proposal.differs], ['ready', 4]);
  assert.deepEqual([...proposal.words.points], [['service-base', 'changed'], ['service-fog', 'changed'], ['service-notice', 'new']]);
  assert.deepEqual([...proposal.words.facets], [['service:fog-radar', 'changed']]);
  assert.deepEqual(proposal.files, [{ path: 'trees/service/points/claim.md', word: 'removed', name: 'A refund is claimed at the quay office' }], 'a claim it removes has no page to be drawn on, so its file is named, with its title');
  assert.deepEqual(proposal.accounts.map(account => [account.id, account.word, account.parts, account.was, account.points.map(point => [point.id, point.word])]), [
    ['service', 'changed', ['outline'], { title: null, scope: null }, [['service-base', 'changed'], ['service-fog', 'changed'], ['service-notice', 'new']]],
    ['harbour', 'changed', ['scope'], { title: null, scope: 'When the harbour authority opens and closes the mouth.' }, []],
  ]);
  assert.deepEqual(proposal.checks.map(item => [item.title, item.word, item.was.title]), [['Every sailing has an hour and a quay', 'changed', 'Every sailing has an hour']]);
  assert.deepEqual(proposal.above, ['service-timetable', 'service-refund']);
  assert.equal(proposedPoint(proposal, 'service-claim'), null);
  const page = proposalPage(proposal, { timeZone: 'UTC' });
  assert.match(page, /<p class="says">Ready to apply · prepared [^<]*<\/p>\n<p class="says">The Atlas it was prepared against does not validate: what differs is read from its files as far as they allow, and no Point or Facet shows what it said before\.<\/p>/);
  assert.ok(page.includes('<li><h3 class="tree">Files</h3><div><ul class="claims"><li><span class="red">removed</span><span><span class="gone">A refund is claimed at the quay office</span><span class="file">trees/service/points/claim.md</span></span></li></ul></div></li>'));
  assert.match(page, /<p class="says">its scope<\/p><p class="scope">When the harbour authority opens and closes the mouth, and how it says so\.<\/p><details class="before"><summary>Before<\/summary><p class="scope">When the harbour authority opens and closes the mouth\.<\/p><\/details>/);
});

test('a change that creates the Atlas is told like any other: the Atlas, its accounts and its claims are new', async t => {
  const { workspace } = await atlas(t);
  const empty = path.join(workspace, 'outside');
  const live = await openModel(empty);
  const created = await openProposal(empty, (await propose(empty, [...files()].filter(([file]) => !file.startsWith('sources/')).map(([file, content]) => ({ path: file, content })), 'Start the harbour ferry')).id, live);
  assert.deepEqual([created.standing, created.before.status, created.before.atlas, created.differs], ['ready', 'absent', null, 12]);
  assert.deepEqual((await listProposals(empty, live)).proposals.map(item => [item.standing, item.creates, item.differs]), [['ready', true, 12]], 'the list says it creates the Atlas');
  assert.deepEqual(created.itself, { word: 'new', parts: [], title: 'Harbour ferry', id: 'ferry', order: null, was: { title: null, id: null } });
  assert.equal(created.style, 'new');
  assert.deepEqual(created.accounts.map(account => [account.id, account.word, account.points.every(point => point.word === 'new')]), [['service', 'new', true], ['vessel', 'new', true], ['harbour', 'new', true]]);
  assert.deepEqual(created.files, []);
  const page = proposalPage(created, { timeZone: 'UTC' });
  assert.match(page, /<li><h3 class="tree">This Atlas<span class="red">new<\/span><\/h3>/);
  assert.match(page, /<li><h3 class="tree">Service<span class="red">new<\/span><\/h3>/);
  assert.doesNotMatch(page, /does not validate/);
  assert.equal(proposedPoint(created, 'service-fog').marks.word, 'new');
});

test('the page of a proposed change states its reason, whether it can be applied, what differs, what else to read and the command', async t => {
  const { root } = await atlas(t);
  const draft = await propose(root, changes(), reason);
  const live = await openModel(root);
  const proposal = await openProposal(root, draft.id, live);
  const page = proposalPage(proposal, { timeZone: 'UTC' });
  assert.match(page, new RegExp(`<title>${reason} · Proposed change · Harbour ferry</title>`));
  assert.match(page, /<header class="strip"><a class="title" href="\.\/">Harbour ferry<\/a><span class="red">Proposed change<\/span><a href="\.\.\/\.\.\/\.\.\/">The Atlas as it is<\/a><a class="control help" href="\.\.\/\.\.\/\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/header>/);
  assert.doesNotMatch(page, /data-strip|data-outline/, 'a page under a proposed change has no search and no Outline');
  assert.doesNotMatch(page, /does not validate/, 'against a valid Atlas, a change says nothing of its validity');
  assert.match(page, new RegExp(`<h1>${reason}</h1>\\n<p class="says">Ready to apply · prepared ${when(draft.updatedAt)}</p>`));
  assert.match(page, /<h2 class="cap">What differs<\/h2><ol class="accounts"><li><h3 class="tree">Service<span class="red">changed<\/span><\/h3><div><p class="says">its outline<\/p><ul class="claims"><li><span class="red">changed<\/span><a href="service-base\/">/, 'an account that differs in itself says in what');
  assert.match(page, /<li><span class="red">changed<\/span><a href="service-fog\/">Sailings stop in fog below 300 metres<\/a><\/li>/);
  assert.match(page, /<li><span class="red">new<\/span><a href="service-notice\/">A stopped sailing is announced at both quays<\/a><\/li>/);
  assert.match(page, /<li><span class="red">removed<\/span><a href="service-claim\/"><span class="gone">A refund is claimed at the quay office<\/span><\/a><\/li>/, 'a removed claim is struck inside its link, which stays underlined');
  assert.match(page, /<li><span class="red">changed<\/span><span><span class="cap">Facet, seen from Vessel<\/span><a href="_\/facet\/service\/fog-radar\/">The fog limit is the radar&#39;s reach<\/a><\/span><\/li>/);
  assert.match(page, /<li><h3 class="tree">Harbour<span class="red">changed<\/span><\/h3><div><p class="says">its scope<\/p><p class="scope">When the harbour authority opens and closes the mouth, and how it says so\.<\/p><details class="before"><summary>Before<\/summary><p class="scope">When the harbour authority opens and closes the mouth\.<\/p><\/details><\/div><\/li><\/ol>/, 'a scope that differs is shown as proposed, with what it said before');
  assert.match(page, /<h2 class="cap">What else to read<\/h2><h3 class="cap">Points above what differs<\/h3><div class="map"><ul><li class="acct"><span class="acct-name">Service<\/span><ul><li><a href="service-timetable\/">The timetable holds in daylight<\/a><\/li><li><a href="service-refund\/">A stopped sailing is refunded in full &amp; &quot;at once&quot;<\/a><\/li><\/ul><\/li><\/ul><\/div>/);
  assert.match(page, /<h3 class="cap">Other Trees&#39; Facets that draw on what differs<\/h3><div class="map"><ul><li class="acct"><span class="acct-name">Vessel<\/span><ul><li><a href="_\/facet\/vessel\/radar-duty\/">The radar is kept running for the fog rule<\/a><\/li><\/ul><\/li><\/ul><\/div>/);
  assert.ok(page.includes(`<h2 class="cap">To apply</h2><pre class="command">atlas --root ${root} apply ${draft.id} --revision ${draft.revision}</pre>`), 'drafts read from the user\'s own state directory need no --state-home');
  assert.ok(proposalPage(proposal, { timeZone: 'UTC', stateHome: '/srv/atlas state' }).includes(`<pre class="command">atlas --root ${root} --state-home &#39;/srv/atlas state&#39; apply ${draft.id} --revision ${draft.revision}</pre>`),
    'drafts read from another state home are applied from it');
  assert.doesNotMatch(page, /class="opens"|<button/, 'every name on it is a link that goes');

  const home = homePage(live, { ...await listProposals(root, live), timeZone: 'UTC' });
  assert.ok(home.includes(`<section class="proposals"><h2 class="cap">Proposed changes</h2><ul><li><a class="claim" href="_/draft/${draft.id}/">${reason}</a><p class="says">4 Points differ · prepared ${when(draft.updatedAt)}</p></li></ul></section><ol class="accounts"`), 'home lists it above the accounts');
});

test('a Point as proposed marks what differs: in its prose block by block, under it, and on each name in its margin', async t => {
  const { root } = await atlas(t);
  const draft = await propose(root, changes(), reason);
  const proposal = await openProposal(root, draft.id, await openModel(root));
  const page = proposedPointPage(proposal, proposedPoint(proposal, 'service-fog'));
  assert.match(page, /<title>Sailings stop in fog below 300 metres · Proposed change · Harbour ferry<\/title>/);
  assert.match(page, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  assert.match(page, /<header class="strip"><a class="title" href="\.\.\/">Harbour ferry<\/a><span class="red">Proposed change<\/span><a href="\.\.\/\.\.\/\.\.\/\.\.\/service-fog\/">The Atlas as it is<\/a><a class="control help" href="\.\.\/\.\.\/\.\.\/\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/header>/);
  assert.match(page, /<div class="kind"><span class="red">changed<\/span><span class="cap" data-standing>Decision · proposed<\/span><details class="before"><summary>Before<\/summary><p class="cap">Decision · selected<\/p><\/details><\/div>\n<h1>Sailings stop in fog below 300 metres<\/h1><details class="before"><summary>Before<\/summary><p class="was">Sailings stop in fog below 200 metres<\/p><\/details>/);
  assert.match(page, /<div class="altered"><p>The master stops sailing when the far quay cannot be seen from the bridge\.[^]*?<details class="before"><summary>Before<\/summary><p>The master stops sailing when the far quay cannot be seen\. /);
  assert.match(page, /<div class="added"><span class="red">new<\/span><p>The mate may also stop a sailing when the master is ashore\.<\/p>\n<\/div>/);
  assert.match(page, /<div class="gone"><span class="red">removed<\/span><pre><code>fog &lt; 200 m: stop\n<\/code><\/pre>\n<\/div>/);
  assert.match(page, /<a href="\.\.\/service-refund\/">refunded<\/a>/, 'links stay under the proposed change');
  assert.match(page, /<div class="unsure"><h2 class="cap">Uncertainty<\/h2><p>The 300 metre figure is the harbour authority&#39;s, not measured on this vessel\.<\/p><details class="before"><summary>Before<\/summary><p>The 200 metre figure was not measured on this vessel\.<\/p><\/details><\/div>/);
  assert.match(page, /<a class="opens" href="\.\.\/service-base\/" data-open="service-base">The ferry sails on the hour while the harbour is open<span class="red">changed<\/span><\/a>/, 'in the outline a claim that differs carries its word');
  assert.match(page, /<li class="here"><span aria-current="page">Sailings stop in fog below 300 metres<span class="red">changed<\/span><\/span>/);
  assert.match(page, /<h2 class="cap">Facets seen from Vessel<\/h2><ul><li><a class="opens" href="\.\.\/_\/facet\/service\/fog-radar\/" data-open="service:fog-radar">The fog limit is the radar&#39;s reach<span class="red">changed<\/span><\/a><\/li><\/ul>/);

  const refund = proposedPointPage(proposal, proposedPoint(proposal, 'service-refund'));
  assert.match(refund, /<ul data-develops><li><a class="opens" href="\.\.\/service-notice\/" data-open="service-notice">A stopped sailing is announced at both quays<span class="red">new<\/span><\/a><\/li><li><a class="opens gone" href="\.\.\/service-claim\/" data-open="service-claim">A refund is claimed at the quay office<span class="red">removed<\/span><\/a><\/li><\/ul>/, 'a removed development stands where it stood, struck, and still opens');
  assert.match(refund, /<div class="kind"><span class="cap" data-standing>Point<\/span><\/div>/, 'a Point that does not differ carries no word of its own, only its kind');

  const base = proposedPointPage(proposal, proposedPoint(proposal, 'service-base'), { states: ['current', 'current', 'current', 'unstamped', 'denied', 'remote'] });
  assert.match(base, /<div class="unsure"><h2 class="cap">Uncertainty<\/h2><p class="gone">Whether the hourly sailing holds in winter is not recorded\.<\/p><span class="red">removed<\/span><\/div><details class="rests" open><summary>6 sources<span class="blue"> · 1 not checked here<\/span><\/summary>/, 'sources that differ are shown open');
  assert.match(base, /<li><span>Crossing log<\/span><span class="loc"> · Weeks 45 and 46<\/span><span class="file">sources\/log\.md<\/span><details class="before"><summary>Before<\/summary><p><span>Crossing log<\/span><span class="loc"> · Week 45<\/span><span class="file">sources\/log\.md<\/span><\/p><\/details><\/li>/);
  assert.match(base, /<li><span>Harbour notice<\/span><span class="file">sources\/notice\.md<\/span><span class="blue">stamped<\/span><\/li>/, 'a source whose stamp alone differs reads the same: it is stamped, in blue, not changed');
  assert.match(base, /<li><span>The week in full<\/span><span class="file">sources\/log\.md#week-45<\/span><span class="red">new<\/span><\/li><li><span class="gone"><span>sources\/gone\.md<\/span><\/span><span class="red">removed<\/span><\/li>/);

  const gone = proposedPointPage(proposal, proposedPoint(proposal, 'service-claim'));
  assert.match(gone, /<div class="kind"><span class="red">removed<\/span><span class="cap" data-standing>Point<\/span><\/div>\n<h1 class="gone">A refund is claimed at the quay office<\/h1>/);
  assert.match(gone, /<div class="body" data-prose><div class="gone"><span class="red">removed<\/span><p>The passenger shows the ticket at the quay office\.<\/p>\n<\/div><\/div>/);
  assert.match(gone, /<a href="\.\.\/\.\.\/\.\.\/\.\.\/service-claim\/">The Atlas as it is<\/a>/);
  assert.match(gone, /<li class="here"><span aria-current="page">A refund is claimed at the quay office<span class="red">removed<\/span><\/span><\/li>/, 'it is drawn where it stood');
  const added = proposedPointPage(proposal, proposedPoint(proposal, 'service-notice'));
  assert.match(added, /<div class="kind"><span class="red">new<\/span><span class="cap" data-standing>Point<\/span><\/div>/);
  assert.match(added, /<a href="\.\.\/\.\.\/\.\.\/\.\.\/">The Atlas as it is<\/a>/, 'a new Point has no page in the Atlas as it is: the way back is home');
  assert.match(added, /<li class="here"><span aria-current="page">A stopped sailing is announced at both quays<span class="red">new<\/span><\/span><\/li><li><a class="opens gone" href="\.\.\/service-claim\/" data-open="service-claim">A refund is claimed at the quay office<span class="red">removed<\/span><\/a><\/li>/);

  const facet = proposedFacetPage(proposal, proposedFacet(proposal, 'service:fog-radar'));
  assert.match(facet, /<title>The fog limit is the radar&#39;s reach · Proposed change · Harbour ferry<\/title>/);
  assert.match(facet, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  assert.match(facet, /<header class="strip"><a class="title" href="\.\.\/\.\.\/\.\.\/\.\.\/">Harbour ferry<\/a><span class="red">Proposed change<\/span><a href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/facet\/service\/fog-radar\/">The Atlas as it is<\/a><a class="control help" href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/header>/);
  assert.match(facet, /<div class="kind"><span class="red">changed<\/span><span class="cap" data-account>Service · Facet, seen from Vessel<\/span><\/div>/);
  assert.match(facet, /<div class="altered"><p>The service stops where <a href="\.\.\/\.\.\/\.\.\/\.\.\/vessel-radar\/">the radar<\/a> stops seeing\. A longer reach would move the limit, and the harbour authority now asks for 300 metres\.<\/p>\n<details class="before">/);
  assert.match(facet, /<a class="opens" href="\.\.\/\.\.\/\.\.\/\.\.\/service-fog\/" data-open="service-fog">Sailings stop in fog below 300 metres<span class="red">changed<\/span><\/a>/);
});

const escaped = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const literal = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** The part of a proposed change's page under "What differs". */
const whatDiffers = page => {
  const at = page.indexOf('<h2 class="cap">What differs</h2>');
  return at < 0 ? '' : page.slice(at, page.indexOf('</section>', at));
};

/**
 * How the page of a proposed change must name each file it writes: by the record the file holds as proposed, or else
 * as it was before; by its path when the Atlas as proposed does not validate, or when neither side holds a record there.
 */
function names(plan) {
  const { before, after } = inspectChange(plan), at = new Map();
  if (after.status === 'ready') for (const view of [before, after]) {
    if (view.status !== 'ready') continue;
    const held = view.atlas;
    at.set('atlas.json', /<h3 class="tree">This Atlas/);
    at.set(held.style.path, /<a href="_\/style\/">/);
    for (const tree of held.trees) at.set(tree.path, new RegExp(`<h3 class="tree">${literal(escaped(tree.title))}(?:<span class="red">(?:new|changed|removed)</span></h3>|</h3><div><p class="says">)`));
    for (const point of held.points) at.set(point.path, new RegExp(`<a href="${point.id}/">`));
    for (const facet of held.facets) at.set(facet.path, new RegExp(`<a href="_/facet/${facet.tree}/${facet.id}/">`));
    for (const item of held.checks) at.set(item.path, new RegExp(`<span class="file">${literal(item.path)}</span>`));
  }
  return plan.changes.map(change => [change.path, at.get(change.path) ?? new RegExp(`<span class="file">${literal(change.path)}</span>`)]);
}

test('the page of a proposed change names every file it writes', async t => {
  const { root, write } = await atlas(t, records => {
    records.set('.checks/tone.md', check('tone', 'Every claim is a plain sentence'));
    records.set('.checks/hours.md', check('hours', 'Every sailing has an hour', { level: 'required' }));
  });
  const records = files(), json = value => `${JSON.stringify(value, null, 2)}\n`, manifest = JSON.parse(records.get('atlas.json'));
  const service = JSON.parse(records.get('trees/service/tree.json'));
  service.children[0].children[0].children[0].children = [];
  const drafts = [
    [reason, changes()],
    ['Rename the Style', [{ path: 'style.md', content: records.get('style.md').replace('# Plain accounts', '# Plain accounts, dated') }]],
    ['Hold the Atlas to dates, retire the hours, and lead with the vessel', [
      { path: '.checks/tone.md', content: null },
      { path: '.checks/dates.md', content: check('dates', 'Every observation carries its date') },
      { path: '.checks/hours.md', content: check('hours', 'Every sailing has an hour and a quay', { status: 'retired', level: 'required', requirement: 'Each sailing names its hour and its quay.' }) },
      { path: 'atlas.json', content: json({ ...manifest, id: 'harbour-ferry', title: 'The harbour ferry', trees: ['trees/vessel', 'trees/service', 'trees/harbour'] }) },
    ]],
    ['Give the crew an account, and leave the harbour to its authority', [
      { path: 'atlas.json', content: json({ ...manifest, trees: ['trees/service', 'trees/vessel', 'trees/crew'] }) },
      { path: 'trees/crew/tree.json', content: json({ id: 'crew', title: 'Crew', scope: 'Who sails.', base: 'crew-base', children: [] }) },
      { path: 'trees/crew/points/base.md', content: record({ id: 'crew-base' }, 'A master holds a harbour ticket', 'The master is licensed for this harbour.') },
      { path: 'trees/crew/facets/watch.md', content: record({ id: 'watch', on: 'crew-base', via: 'service', targets: ['service-crew'] }, 'The master is one of the two crew', 'The ticket holder is [the master](../../service/points/crew.md).') },
      { path: 'trees/harbour/tree.json', content: null },
      { path: 'trees/harbour/points/base.md', content: null },
      { path: 'trees/harbour/points/signal.md', content: null },
      { path: 'trees/service/facets/gale.md', content: null },
      { path: 'trees/vessel/facets/seats.md', content: null },
    ]],
    ['Indent the files the other way', [
      { path: 'atlas.json', content: `${JSON.stringify(manifest, null, 4)}\n` },
      { path: 'trees/vessel/tree.json', content: `${JSON.stringify(JSON.parse(records.get('trees/vessel/tree.json')), null, 4)}\n` },
      { path: 'trees/service/points/crew.md', content: records.get('trees/service/points/crew.md').replace('{"id":"service-crew"}', '{ "id": "service-crew" }') },
      { path: 'trees/vessel/facets/duty.md', content: records.get('trees/vessel/facets/duty.md').replace('{"id":"radar-duty"', '{ "id": "radar-duty"') },
      { path: '.checks/tone.md', content: check('tone', 'Every claim is a plain sentence').replace('{"id":"tone"', '{ "id": "tone"') },
    ]],
    ['Space the title of the Style', [{ path: 'style.md', content: records.get('style.md').replace('# Plain accounts\n', '#  Plain accounts\n') }]],
    ['Leave the decision open, and the engine out', [
      { path: 'trees/service/points/fog.md', content: records.get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"') },
      { path: 'trees/service/points/stray.md', content: record({ id: 'service-stray' }, 'A claim placed nowhere', 'Nothing develops it.') },
      { path: 'trees/vessel/points/engine.md', content: null },
    ]],
  ];
  const saved = [];
  for (const [why, change] of drafts) saved.push([why, await propose(root, change, why)]);
  // A change prepared against an Atlas that does not validate: what it removes can be named only by its file.
  await write('trees/service/points/fog.md', records.get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"'));
  const repair = 'Restore the decision, and drop the quay office';
  saved.push([repair, await propose(root, [
    { path: 'trees/service/points/fog.md', content: records.get('trees/service/points/fog.md') },
    { path: 'trees/service/points/claim.md', content: null },
    { path: 'trees/service/tree.json', content: json(service) },
    { path: 'atlas.json', content: json({ ...manifest, title: 'The harbour ferry' }) },
  ], repair)]);

  const live = await openModel(root), unnamed = [];
  for (const [why, draft] of saved) {
    const differs = whatDiffers(proposalPage(await openProposal(root, draft.id, live), { timeZone: 'UTC' }));
    for (const [file, name] of names(draft.plan)) if (!name.test(differs)) unnamed.push(`${why}: ${file}`);
  }
  assert.deepEqual(unnamed, []);
});
