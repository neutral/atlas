import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openModel, sourceStates } from '../src/model.mjs';
import { homePage, pointPage, facetPage, helpPage, diagnosticsPage, absentPage, missingPage, standing, contentPolicy } from '../src/pages.mjs';
import { atlas, files, record } from './fixture.mjs';

/** What every page must be, whatever it shows: one document that carries its own policy, runs nothing inline and links only relatively. */
function wellFormed(html, root) {
  assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/);
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${contentPolicy}">`));
  assert.ok(html.includes('<meta name="color-scheme" content="light">'));
  assert.ok(html.includes(`<link rel="stylesheet" href="${root}_/sheet.css">`));
  assert.deepEqual(html.match(/<script[^>]*>/g), [`<script type="module" src="${root}_/reader.js">`], 'the one script is the reader\'s module');
  assert.match(html, /<script type="module" src="[^"]*"><\/script>/, 'and it holds no code of its own');
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+="|<iframe|<object|<embed|<form|<img|<base|<button|aria-expanded/i, 'nothing inline, nothing embedded, and nothing that only a script could work');
  for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) assert.ok(/^https?:\/\//.test(value) || !value.startsWith('/'), `a link within the Atlas is relative: ${value}`);
  assert.equal((html.match(/<a(?![^>]*\shref=)[\s>]/g) ?? []).length, 0, 'every name is a link that leads somewhere');
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, 'one first heading');
  assert.equal((html.match(/<main[ >]/g) ?? []).length, 1);
  assert.equal((html.match(/<header class="strip"/g) ?? []).length, 1);
}

/** The margin of a page, as its sections. */
const margin = html => html.slice(html.indexOf('<nav class="margin"'), html.indexOf('</nav>')).split('\n').slice(1).filter(Boolean);
const item = (href, token, title) => `<li><a class="opens" href="${href}" data-open="${token}">${title}</a></li>`;

test('home shows the Atlas title and each Tree with its top Point, its scope and its outline', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root);
  const home = homePage(model);
  wellFormed(home, '');
  assert.match(home, /<title>Harbour ferry<\/title>/);
  assert.match(home, /<header class="strip" data-strip><a class="title" href="\.\/">Harbour ferry<\/a><div class="tools"><a class="control help" href="_\/help\/" aria-label="Help">\?<\/a><\/div><\/header>/, 'the strip holds the title and Help; the script adds search; home has no Outline to lead to itself');
  assert.match(home, /<h1>Harbour ferry<\/h1>/);
  assert.match(home, /<ol class="accounts" data-accounts><li><h2 class="tree">Service<\/h2><div><a class="claim" href="service-base\/" data-id="service-base">The ferry sails on the hour while the harbour is open<\/a><p class="scope">What a passenger can rely on, and where that stops\.<\/p><details class="outline map"><summary>6 Points<\/summary>/);
  assert.match(home, /<ul><li><a href="service-timetable\/" data-id="service-timetable">The timetable holds in daylight<\/a><ul><li><a href="service-fog\/" data-id="service-fog">Sailings stop in fog below 200 metres<\/a><span class="std"> · Decision · selected<\/span><ul><li><a href="service-refund\/" data-id="service-refund">A stopped sailing is refunded in full &amp; &quot;at once&quot;<\/a><ul><li><a href="service-claim\/" data-id="service-claim">A refund is claimed at the quay office<\/a><\/li><\/ul><\/li><\/ul><\/li><\/ul><\/li><li><a href="service-crew\/" data-id="service-crew">Two crew sail every crossing<\/a><\/li><li><a href="service-count\/" data-id="service-count">Forty crossings were counted in the first week of November<\/a><span class="std"> · Observation · 3 November 2026<\/span><\/li><\/ul><\/details>/, 'the outline nests as the Tree does, a typed Point with its standing after its title');
  assert.match(home, /<h2 class="tree">Harbour<\/h2><div><a class="claim" href="harbour-base\/" data-id="harbour-base">The harbour authority closes the mouth in a gale<\/a><p class="scope">When the harbour authority opens and closes the mouth\.<\/p><details class="outline map"><summary>1 Point<\/summary>/);
  assert.match(home, /The engine holds &lt; 5 knots at idle/, 'an authored title is text, never markup');
  assert.doesNotMatch(home, /Written as|_\/style|Plain accounts/, 'home names no Style: the Style is how maintainers write the Atlas, and a reader has no page of it');
  assert.doesNotMatch(home, /Proposed changes/);
  assert.equal((home.match(/<details class="outline map">/g) ?? []).length, 3, 'each outline stands behind a native disclosure');

  const alone = await openModel(root, { trees: ['vessel'] });
  const one = homePage(alone);
  assert.match(one, /<summary>2 Points<\/summary>/);
  assert.doesNotMatch(one, /Service|Harbour</);
});

test('a Tree of one Point has no outline to open', async t => {
  const { root } = await atlas(t, records => {
    records.set('trees/harbour/tree.json', records.get('trees/harbour/tree.json').replace(/"children": \[[^]*\]/, '"children": []'));
    records.delete('trees/harbour/points/signal.md');
  });
  const home = homePage(await openModel(root));
  assert.match(home, /<h2 class="tree">Harbour<\/h2><div><a class="claim" href="harbour-base\/" data-id="harbour-base">The harbour authority closes the mouth in a gale<\/a><p class="scope">[^<]*<\/p><\/div><\/li>/);
});

test('a Point\'s main column holds its standing, its title, its prose as written, then its uncertainty, its sources and the next Point', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root);
  const page = pointPage(model, 'service-fog');
  wellFormed(page, '../');
  assert.match(page, /<title>Sailings stop in fog below 200 metres · Harbour ferry<\/title>/);
  assert.match(page, /<header class="strip" data-strip><a class="title" href="\.\.\/">Harbour ferry<\/a><div class="tools"><a class="control" href="\.\.\/" data-outline>Outline<\/a><a class="control help" href="\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/div><\/header>/, 'the strip: the Atlas title and Outline, both links to home without the script, then Help, a link to its page, and nothing else');
  assert.match(page, /<main class="doc">\n<div class="row">\n<article class="point" data-point="service-fog">\n<div class="kind"><span class="cap" data-standing>Decision · selected<\/span><\/div>\n<h1>Sailings stop in fog below 200 metres<\/h1>\n<div class="body" data-prose><p>The master stops sailing when the far quay cannot be seen\. The limit is\n<a href="\.\.\/vessel-radar\/">the radar's reach<\/a>, and the choice is explained in\n<a href="\.\.\/_\/facet\/service\/fog-radar\/">how the limit follows the radar<\/a>\.<\/p>/, 'no band stands above the title; a link in the prose is a plain link to a page');
  assert.match(page, /<a class="out" href="https:\/\/example\.org\/harbour-rules" target="_blank" rel="noopener noreferrer">harbour rules<\/a> and recorded in\nthe crossing log\.<\/p>/, 'an address outside opens apart; a local file is not a page');
  assert.match(page, /<p>&lt;script&gt;alert\('authored'\)&lt;\/script&gt;<\/p>\n<p>&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt;<\/p>/, 'authored HTML is shown, never run');
  assert.match(page, /<span class="image">\[Image: Chart of the harbour mouth\]<\/span> and a \[bad link\]\(javascript:alert\(1\)\)\./);
  assert.match(page, /<table>\n<thead>\n<tr>\n<th>Visibility<\/th>/);
  assert.match(page, /<pre><code>fog &lt; 200 m: stop\n<\/code><\/pre>\n<\/div>\n<footer class="foot" data-foot><div class="unsure"><h2 class="cap">Uncertainty<\/h2><p>The 200 metre figure was not measured on this vessel\.<\/p><\/div><\/footer>\n<p class="onward"><span class="cap">Next<\/span><a href="\.\.\/service-refund\/">A stopped sailing is refunded in full &amp; &quot;at once&quot;<\/a><\/p>\n<\/article>/, 'under the prose: the uncertainty, no sources here, then the next Point');

  const base = model.atlas.points.get('service-base');
  const rests = pointPage(model, 'service-base', { states: (await sourceStates(model, [base]))[0] });
  assert.ok(rests.includes('<footer class="foot" data-foot><div class="unsure"><h2 class="cap">Uncertainty</h2><p>Whether the hourly sailing holds in winter is not recorded.</p></div>'
    + '<details class="rests"><summary>6 sources<span class="red"> · 1 changed since this was checked · 1 missing</span><span class="blue"> · 1 not checked here</span></summary>'
    + '<h2 class="cap">Evidence</h2><ul class="sources"><li><span>Crossing log</span><span class="loc"> · Week 45</span><span class="file">sources/log.md</span></li></ul>'
    + '<h2 class="cap">Background</h2><ul class="sources"><li><span>Harbour notice</span><span class="file">sources/notice.md</span><span class="red flag"><span aria-hidden="true">△ </span>changed since this was checked</span></li></ul>'
    + '<h2 class="cap">Examples</h2><ul class="sources"><li><span>sources/gone.md</span><span class="red flag"><span aria-hidden="true">✗ </span>missing</span></li></ul>'
    + '<h2 class="cap">Implementation</h2><ul class="sources"><li><span>sources/chart.md</span></li></ul>'
    + '<h2 class="cap">History</h2><ul class="sources"><li><span>Company policy</span><span class="file">outside/policy.md</span><span class="blue flag"><span aria-hidden="true">○ </span>not checked here</span></li></ul>'
    + '<h2 class="cap">Sources</h2><ul class="sources"><li><a class="out" href="https://example.org/harbour-rules" target="_blank" rel="noopener noreferrer">Harbour rules</a></li></ul></details></footer>'),
  'the sources stand behind a native disclosure, grouped by role in a fixed order, and its closed line says how many no longer match and, in blue, how many stamps could not be checked here');
  assert.ok(pointPage(model, 'service-base').includes('<summary>6 sources</summary>'), 'nothing is said of a source that was not read');
  const unstamped = pointPage(model, 'service-base', { states: ['unstamped', 'unstamped', 'unstamped', 'unstamped', 'unstamped', 'remote'] });
  assert.ok(unstamped.includes('<summary>6 sources</summary>') && !unstamped.includes('not checked here'), 'an unstamped source outside the grants keeps no mark: nothing was checked of it to be taken for checked');
  // When no stamp of a page could be checked, the closed line says so once and no source is marked.
  const none = pointPage(model, 'service-base', { states: ['denied', 'denied', 'denied', 'unstamped', 'denied', 'remote'] });
  assert.ok(none.includes('<summary>6 sources<span class="blue"> · not checked here</span></summary>'), 'none checked, beside unstamped and remote sources: said once');
  assert.doesNotMatch(none, /class="blue flag"|○/, 'and no line is marked');
  const missing = pointPage(model, 'service-base', { states: ['denied', 'denied', 'missing', 'unstamped', 'denied', 'remote'] });
  assert.ok(missing.includes('<summary>6 sources<span class="red"> · 1 missing</span><span class="blue"> · 3 not checked here</span></summary>'), 'a stamped source found missing was looked for: the others are counted and marked');
  const some = pointPage(model, 'service-base', { states: ['current', 'denied', 'unstamped', 'unstamped', 'denied', 'remote'] });
  assert.ok(some.includes('<summary>6 sources<span class="blue"> · 2 not checked here</span></summary>'), 'some checked: the line counts the others');
  assert.equal((some.match(/<span class="blue flag"><span aria-hidden="true">○ <\/span>not checked here<\/span>/g) ?? []).length, 2, 'and each is marked');
  // In the local service a source the grants reach is a link to its own page; the export gives none (see the export test).
  const served = pointPage(model, 'service-base', { states: (await sourceStates(model, [base]))[0], served: [true, true, true, true, false, false] });
  assert.ok(served.includes('<li><a href="../_/source/?uri=sources%2Flog.md">Crossing log</a><span class="loc"> · Week 45</span><span class="file">sources/log.md</span></li>'));
  assert.ok(served.includes('<li><span>Company policy</span><span class="file">outside/policy.md</span>'), 'one the grants do not reach is not');
  assert.ok(served.includes('<a class="out" href="https://example.org/harbour-rules" target="_blank" rel="noopener noreferrer">Harbour rules</a>'), 'a remote one leads where it always did');
  assert.ok(pointPage(model, 'service-count', { states: ['current'], served: [true] }).includes('<a href="../_/source/?uri=sources%2Flog.md%23week-45#week-45">sources/log.md#week-45</a>'), 'a cited section is the page\'s fragment too, so the reader lands on it');

  const last = pointPage(model, 'service-count', { states: ['current'] });
  assert.match(last, /<span class="cap" data-standing>Observation · 3 November 2026<\/span>/);
  assert.match(last, /<footer class="foot" data-foot><details class="rests"><summary>1 source<\/summary><h2 class="cap">Evidence<\/h2><ul class="sources"><li><span>sources\/log\.md#week-45<\/span><\/li><\/ul><\/details><\/footer>\n<p class="onward"><span class="cap">Next, in Vessel<\/span><a href="\.\.\/vessel-base\/">One hull carries sixty passengers<\/a><\/p>\n<\/article>/,
    'no uncertainty, one source, and at the end of a Tree the top Point of the next, under the name of its Tree');
  assert.doesNotMatch(pointPage(model, 'harbour-signal'), /class="onward"/, 'the end of the last Tree leads nowhere');
  const plain = pointPage(model, 'service-crew');
  assert.match(plain, /<div class="kind"><span class="cap" data-standing>Point<\/span><\/div>\n<h1>Two crew sail every crossing<\/h1>/, 'a Point without a Type is named a Point');
  assert.doesNotMatch(plain, /<footer|class="onward"[^]*class="onward"/, 'a Point without uncertainty or sources has none of those parts');
  assert.match(pointPage(model, 'vessel-engine'), /<title>The engine holds &lt; 5 knots at idle · Harbour ferry<\/title>/);
  assert.match(pointPage(model, 'vessel-engine'), /<h1>The engine holds &lt; 5 knots at idle<\/h1>/);
});

test('a Point\'s margin is the map of where it stands: the outline around it, then what is seen from it, what it refers to and what refers to it', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root);
  assert.deepEqual(margin(pointPage(model, 'service-fog')), [
    '<section class="map"><h2 class="cap"><span data-account>Service</span></h2><ul><li><a class="opens" href="../service-base/" data-open="service-base">The ferry sails on the hour while the harbour is open</a>'
      + '<ul><li><a class="opens" href="../service-timetable/" data-open="service-timetable">The timetable holds in daylight</a>'
      + '<ul><li class="here"><span aria-current="page">Sailings stop in fog below 200 metres</span>'
      + `<ul data-develops>${item('../service-refund/', 'service-refund', 'A stopped sailing is refunded in full &amp; &quot;at once&quot;')}</ul></li></ul></li></ul></li></ul></section>`,
    `<section class="map" data-part><h2 class="cap">Facets seen from Vessel</h2><ul>${item('../_/facet/service/fog-radar/', 'service:fog-radar', 'The fog limit is the radar&#39;s reach')}</ul></section>`,
    `<section class="map" data-part><h2 class="cap">Refers to</h2><ul><li class="acct"><span class="acct-name">Vessel</span><ul>${item('../vessel-radar/', 'vessel-radar', 'The radar reaches 200 metres in fog')}</ul></li>`
      + `<li class="acct"><span class="acct-name">Harbour</span><ul>${item('../harbour-base/', 'harbour-base', 'The harbour authority closes the mouth in a gale')}</ul></li></ul></section>`,
    `<section class="map" data-part><h2 class="cap">Referred to by</h2><ul><li class="acct"><span class="acct-name">Harbour</span><ul>${item('../harbour-signal/', 'harbour-signal', 'A red light at the mole means closed')}</ul></li>`
      + `<li class="acct"><span class="acct-name">Vessel</span><ul>${item('../_/facet/vessel/radar-duty/', 'vessel:radar-duty', 'The radar is kept running for the fog rule')}</ul></li></ul></section>`,
  ], 'the development it refers to and the Point above that refers to it are in the outline, so they are not said again');

  assert.deepEqual(margin(pointPage(model, 'service-crew')), [
    '<section class="map"><h2 class="cap"><span data-account>Service</span></h2><ul><li><a class="opens" href="../service-base/" data-open="service-base">The ferry sails on the hour while the harbour is open</a>'
      + `<ul>${item('../service-timetable/', 'service-timetable', 'The timetable holds in daylight')}<li class="here"><span aria-current="page">Two crew sail every crossing</span></li>${item('../service-count/', 'service-count', 'Forty crossings were counted in the first week of November')}</ul></li></ul></section>`,
    `<section class="map" data-part><h2 class="cap">Referred to by</h2><ul><li class="acct"><span class="acct-name">Vessel</span><ul>${item('../_/facet/vessel/crew-seats/', 'vessel:crew-seats', 'Two of the sixty places are the crew&#39;s')}</ul></li></ul></section>`,
  ], 'the Points beside it stand in order, itself among them and not a link; a part with nothing to show is absent');

  const deep = margin(pointPage(model, 'service-claim'));
  assert.equal(deep.length, 1);
  assert.ok(deep[0].startsWith('<section class="map"><h2 class="cap"><span data-account>Service</span> · 1 more Point above</h2><ul><li><a class="opens" href="../service-timetable/" data-open="service-timetable">The timetable holds in daylight</a><ul><li><a class="opens" href="../service-fog/" data-open="service-fog">'), 'at most three Points stand above; the Tree line says how many more');
  assert.ok(deep[0].endsWith('<ul><li class="here"><span aria-current="page">A refund is claimed at the quay office</span></li></ul></li></ul></li></ul></li></ul></section>'));

  assert.deepEqual(margin(pointPage(model, 'vessel-base')), [
    `<section class="map"><h2 class="cap"><span data-account>Vessel</span></h2><ul><li class="here"><span aria-current="page">One hull carries sixty passengers</span><ul data-develops>${item('../vessel-radar/', 'vessel-radar', 'The radar reaches 200 metres in fog')}${item('../vessel-engine/', 'vessel-engine', 'The engine holds &lt; 5 knots at idle')}</ul></li></ul></section>`,
    `<section class="map" data-part><h2 class="cap">Facets seen from Service</h2><ul>${item('../_/facet/vessel/crew-seats/', 'vessel:crew-seats', 'Two of the sixty places are the crew&#39;s')}</ul></section>`,
  ], 'a Base stands alone at the top of its Tree');
});

test('a Point that stands too far above to be shown in the outline is still said when the prose refers to it', async t => {
  const { root } = await atlas(t, records => {
    records.set('trees/service/points/claim.md', record({ id: 'service-claim' }, 'A refund is claimed at the quay office', 'The passenger shows the ticket at the quay office, whenever [the ferry sails](base.md) and [fog](fog.md) has not stopped it.'));
  });
  const model = await openModel(root);
  assert.deepEqual(margin(pointPage(model, 'service-claim')).slice(1), [
    `<section class="map" data-part><h2 class="cap">Refers to</h2><ul><li class="acct"><span class="acct-name">Service</span><ul>${item('../service-base/', 'service-base', 'The ferry sails on the hour while the harbour is open')}</ul></li></ul></section>`,
  ], 'the Base is the one Point above that the outline does not show; fog is in the outline');
  assert.match(margin(pointPage(model, 'service-base')).at(-1), /<h2 class="cap">Referred to by<\/h2><ul><li class="acct"><span class="acct-name">Service<\/span><ul><li><a class="opens" href="\.\.\/service-claim\/" data-open="service-claim">/, 'and a Point far beneath is not in the Base\'s outline');
});

test('a Facet has a page: its Trees, title, prose and foot, and in the margin the Point it is said of and the Points it draws on', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root);
  const page = facetPage(model, 'service:fog-radar');
  wellFormed(page, '../../../../');
  assert.match(page, /<title>The fog limit is the radar&#39;s reach · Harbour ferry<\/title>/);
  assert.match(page, /<header class="strip" data-strip><a class="title" href="\.\.\/\.\.\/\.\.\/\.\.\/">Harbour ferry<\/a><div class="tools"><a class="control" href="\.\.\/\.\.\/\.\.\/\.\.\/" data-outline>Outline<\/a><a class="control help" href="\.\.\/\.\.\/\.\.\/\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/div><\/header>/);
  assert.match(page, /<article class="point">\n<div class="kind"><span class="cap" data-account>Service · Facet, seen from Vessel<\/span><\/div>\n<h1>The fog limit is the radar&#39;s reach<\/h1>\n<div class="body" data-prose><p>The service stops where <a href="\.\.\/\.\.\/\.\.\/\.\.\/vessel-radar\/">the radar<\/a> stops seeing\. A longer reach would move the limit\.<\/p>\n<\/div>\n<footer class="foot" data-foot><div class="unsure"><h2 class="cap">Uncertainty<\/h2><p>The radar was last checked in 2025\.<\/p><\/div><\/footer>\n<\/article>/);
  assert.doesNotMatch(page, /class="onward"/, 'a Facet is not in the reading order');
  assert.deepEqual(margin(page), [
    `<section class="map" data-part data-said="service-fog"><h2 class="cap">Said of, in Service</h2><ul>${item('../../../../service-fog/', 'service-fog', 'Sailings stop in fog below 200 metres')}</ul></section>`,
    `<section class="map" data-part><h2 class="cap">In Vessel</h2><ul>${item('../../../../vessel-radar/', 'vessel-radar', 'The radar reaches 200 metres in fog')}</ul></section>`,
  ]);
  assert.match(page, /<nav class="margin" aria-label="Where this stands">/);
  const gale = model.atlas.facets.get('service:gale');
  assert.match(facetPage(model, 'service:gale', { states: (await sourceStates(model, [gale]))[0] }), /<footer class="foot" data-foot><details class="rests"><summary>1 source<\/summary><h2 class="cap">Evidence<\/h2><ul class="sources"><li><span>Harbour notice<\/span><span class="file">sources\/notice\.md<\/span><\/li><\/ul><\/details><\/footer>/, 'a Facet rests on its own sources');

  const alone = await openModel(root, { trees: ['service'] });
  const outside = facetPage(alone, 'service:fog-radar');
  assert.match(outside, /<span class="cap" data-account>Service · Facet, seen from a Tree not in this publication<\/span>/);
  assert.deepEqual(margin(outside), [`<section class="map" data-part data-said="service-fog"><h2 class="cap">Said of, in Service</h2><ul>${item('../../../../service-fog/', 'service-fog', 'Sailings stop in fog below 200 metres')}</ul></section>`], 'the Points it draws on are not in the publication, and are not named');
  assert.match(outside, /The service stops where the radar <span class="says">not in this publication<\/span> stops seeing\./);
  assert.match(margin(pointPage(alone, 'service-fog'))[1], /<h2 class="cap">Facets seen from a Tree not in this publication<\/h2>/);
});

test('a Point\'s Type and standing are told in words', () => {
  assert.equal(standing(null), '');
  assert.equal(standing({ type: 'decision', status: 'superseded' }), 'Decision · superseded');
  assert.equal(standing({ type: 'observation', observedAt: '2026-11-03' }), 'Observation · 3 November 2026');
  assert.equal(standing({ type: 'observation', observedAt: '2026-01-31T23:30:00-08:00' }), 'Observation · 31 January 2026', 'the calendar date the author wrote, whatever the zone');
});

test('where there are no pages, the page says why', async t => {
  const { root, workspace, write } = await atlas(t);
  const model = await openModel(root);
  const missing = missingPage(model, 'No Point has the address <b>.', { root: '../' });
  wellFormed(missing.replace('<main class="home">', '<main class="home"><h1></h1>'), '../');
  assert.match(missing, /<p class="says">No Point has the address &lt;b&gt;\.<\/p>/);
  assert.match(missing, /<a class="control" href="\.\.\/" data-outline>Outline<\/a>/);

  await write('trees/service/points/fog.md', files().get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"<i>perhaps</i>"'));
  const invalid = await openModel(root);
  const page = diagnosticsPage(invalid, { root: '../' });
  wellFormed(page, '../');
  assert.match(page, /<title>Atlas<\/title>/);
  assert.match(page, /<header class="strip"><a class="title" href="\.\.\/">Atlas<\/a><a class="control help" href="\.\.\/_\/help\/" aria-label="Help">\?<\/a><\/header>/, 'no title to show, no Outline and no search; Help still explains the marks');
  assert.match(page, /<h1>This Atlas does not validate<\/h1>/);
  assert.match(page, /<h1>This Atlas does not validate<\/h1>\n<ul class="diagnostics"><li><span class="red"><span aria-hidden="true">✗ <\/span>DECISION_STATUS<\/span><p>A decision requires a supported status\.<span class="file">trees\/service\/points\/fog\.md<\/span><\/p><\/li><\/ul>/, 'each reason: its code, what is wrong, and the file it is in');
  assert.match(missingPage(invalid, 'Nothing has this address.', { root: '' }), /<header class="strip"><a class="title" href="\.\/">Atlas<\/a><a class="control help" href="_\/help\/" aria-label="Help">\?<\/a><\/header>/);

  const empty = path.join(workspace, 'with space');
  const absent = absentPage({ root: empty });
  wellFormed(absent, '');
  assert.match(absent, /<h1>No Atlas here<\/h1>/);
  assert.ok(absent.includes(`<p class="says">This command prepares one in ${empty}, as a proposed change to read here and then apply. Its ID, its title and its Style are yours to choose; atlas styles lists the Styles.</p>\n<pre class="command">atlas --root &#39;${empty}&#39; init --id ID --title TITLE --style STYLE</pre>`), 'a path with a space is quoted for the shell');
});

test('Help has a page: the words, how to move around and the marks, which the strip of every other page links to', async t => {
  const { root } = await atlas(t);
  const model = await openModel(root);
  const help = helpPage(model);
  wellFormed(help, '../../');
  assert.match(help, /<title>Help · Harbour ferry<\/title>/);
  assert.match(help, /<header class="strip" data-strip><a class="title" href="\.\.\/\.\.\/">Harbour ferry<\/a><div class="tools"><a class="control" href="\.\.\/\.\.\/" data-outline>Outline<\/a><\/div><\/header>/, 'the strip has Outline and no Help, which would lead to itself');
  assert.match(help, /<main class="home help">\n<h1>Help<\/h1>\n<div data-help>\n<section><h2 class="cap">The words<\/h2><dl><dt>Atlas<\/dt><dd>/);
  const terms = [...help.matchAll(/<dt>([^<]*)<\/dt>/g)].map(match => match[1]);
  assert.deepEqual(terms, ['Atlas', 'Tree', 'Point', 'Decision', 'Observation', 'Facet', 'An underlined name', 'A name with ▸', 'Next', 'Outline', 'Search', 'Escape',
    'new, changed, removed', 'stamped', '△ changed since this was checked', '✗ missing', '○ not checked here', '↗'], 'each word, each move and each mark, in order');
  assert.deepEqual([...help.matchAll(/<h2 class="cap">([^<]*)<\/h2>/g)].map(match => match[1]), ['The words', 'Moving around', 'The marks']);
  assert.doesNotMatch(help.slice(help.indexOf('<div data-help>')), /claims? (develop|differ)|\bviews?\b|account not|Contents/, 'in the Portal\'s one vocabulary');
  const bare = helpPage({ root, atlas: null });
  wellFormed(bare, '../../');
  assert.match(bare, /<title>Help · Atlas<\/title>/);
  assert.match(bare, /<header class="strip"><a class="title" href="\.\.\/\.\.\/">Atlas<\/a><\/header>/, 'where there is no Atlas, the strip has its title alone');
});
