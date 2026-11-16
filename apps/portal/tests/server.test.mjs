import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { startPortal, reading } from '../src/server.mjs';
import { createHash } from 'node:crypto';
import { resolveState, stateHome } from '../../../library/src/state.mjs';
import { openAtlas } from '../../../library/src/model.mjs';
import { prepareInitialization, saveDraft, applyDraft, recoverChange } from '../../../library/src/authoring.mjs';
import { listStyles } from '../../../library/src/styles.mjs';
import { atlas, propose, changes, reason, record, files, check } from './fixture.mjs';

/** One request to a running Portal, with any header set as given (the Host included). */
function ask(portal, address, { method = 'GET', headers = {} } = {}) {
  const { hostname, port } = new URL(portal.url);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path: address, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

async function served(t, change, options = {}) {
  const fixture = await atlas(t, change);
  const portal = await startPortal(fixture.root, { timeZone: 'UTC', ...options });
  t.after(() => portal.close());
  return { ...fixture, portal, get: (address, request) => ask(portal, address, request) };
}

test('each address answers with its page or its asset, and nothing else is served', async t => {
  const { portal, get } = await served(t);
  assert.match(portal.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(home.text, /<h1>Harbour ferry<\/h1>/);
  const page = await get('/service-fog/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Sailings stop in fog below 200 metres<\/h1>/);
  const facet = await get('/_/facet/service/fog-radar/');
  assert.equal(facet.status, 200);
  assert.match(facet.text, /<h1>The fog limit is the radar&#39;s reach<\/h1>/);
  assert.match(facet.text, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  for (const [address, type, words] of [['/_/sheet.css', 'text/css', '--paper: #ffffff'], ['/_/reader.js', 'text/javascript', 'data-outline'], ['/_/search.js', 'text/javascript', 'export function searchPoints'], ['/_/search.json', 'application/json', '"service-fog"']]) {
    const asset = await get(address);
    assert.equal(asset.status, 200, address);
    assert.equal(asset.headers['content-type'], `${type}; charset=utf-8`);
    assert.ok(asset.text.includes(words), address);
  }
  assert.equal((await get('/_/search.js')).text, await fs.readFile(new URL('../../../library/src/search.mjs', import.meta.url), 'utf8'), 'the search module is the Library\'s own, as written');
  assert.deepEqual(Object.keys(JSON.parse((await get('/_/search.json')).text)), ['accounts', 'records']);

  const absent = await get('/no-such-point/');
  assert.equal(absent.status, 404);
  assert.match(absent.text, /<p class="says">No Point has the address no-such-point\.<\/p>/);
  assert.match(absent.text, /<link rel="stylesheet" href="\.\.\/_\/sheet\.css">/, 'a page that names nothing still finds its sheet');
  const unsaid = await get('/_/facet/service/no-such-facet/');
  assert.equal(unsaid.status, 404);
  assert.match(unsaid.text, /<p class="says">Nothing has this address\.<\/p>/);
  // The Style is how maintainers write the Atlas: a reader has no page of it, and home does not name it.
  assert.doesNotMatch(home.text, /Written as|_\/style|Plain accounts/);
  for (const address of ['/_/style/', '/_/style', '/style.md', '/atlas.json', '/trees/service/points/fog.md', '/%2e%2e/atlas.json', '/../atlas.json', '/_/', '/_/reader.mjs', '/_/draft/', '/_/facet/', '/_/facet/service/', '/_/facet/vessel/fog-radar/', '/sources/log.md', '/service-fog/extra/', '/SERVICE-FOG/', '//service-fog/']) {
    assert.equal((await get(address)).status, 404, address);
  }
  const deep = await get('/a/b/c');
  assert.equal(deep.status, 404);
  assert.match(deep.text, /href="\.\.\/\.\.\/_\/sheet\.css"/);

  const slash = await get('/service-fog');
  assert.equal(slash.status, 301);
  assert.equal(slash.headers.location, '/service-fog/');
  assert.equal((await get('/_/facet/service/fog-radar')).headers.location, '/_/facet/service/fog-radar/');
  assert.equal((await get('/_/help')).headers.location, '/_/help/');
  const help = await get('/_/help/');
  assert.equal(help.status, 200);
  assert.match(help.text, /<title>Help · Harbour ferry<\/title>[^]*<h1>Help<\/h1>\n<div data-help>/, 'Help has a page of its own, which the strip of every other page links to');
  assert.equal((await get('/service-fog/?x=1')).status, 200, 'a query changes nothing');
});

test('the service only reads: any method but GET and HEAD is refused', async t => {
  const { get, root } = await served(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const address of ['/', '/service-fog/', '/_/search.json', '/api/apply']) {
      const refused = await get(address, { method });
      assert.equal(refused.status, 405, `${method} ${address}`);
      assert.equal(refused.headers.allow, 'GET, HEAD');
    }
  }
  const head = await get('/service-fog/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength((await get('/service-fog/')).text));
  assert.deepEqual((await fs.readdir(root)).sort(), ['atlas.json', 'sources', 'style.md', 'trees'], 'serving writes nothing into the Atlas');
});

test('a request must name the Portal by a loopback name and its port', async t => {
  const { portal, get } = await served(t);
  const port = new URL(portal.url).port;
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) assert.equal((await get('/', { headers: { Host: host } })).status, 200, host);
  for (const host of ['example.org', `example.org:${port}`, '127.0.0.1', `127.0.0.1:${Number(port) + 1}`, `127.0.0.1.example.org:${port}`, `localhost.example.org:${port}`, `0.0.0.0:${port}`]) {
    const refused = await get('/', { headers: { Host: host } });
    assert.equal(refused.status, 403, host);
    assert.doesNotMatch(refused.text, /Harbour ferry/);
  }
  for (const address of ['/_/search.json', '/_/reader.js', '/service-fog/']) assert.equal((await get(address, { headers: { Host: 'example.org' } })).status, 403, address);
  assert.equal((await get('/', { headers: { Origin: 'https://example.org' } })).status, 403, 'another site\'s page asking');
  assert.equal((await get('/', { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
});

test('every answer carries the policy and the other headers', async t => {
  const { get } = await served(t);
  for (const [address, request] of [['/', {}], ['/service-fog/', {}], ['/_/reader.js', {}], ['/_/search.json', {}], ['/no-such-point/', {}], ['/', { method: 'POST' }], ['/', { headers: { Host: 'example.org' } }], ['/service-fog', {}]]) {
    const { headers } = await get(address, request);
    assert.equal(headers['content-security-policy'], "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", address);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers['access-control-allow-origin'], undefined);
  }
});

test('a cited source has a page of its own: the file as it is now, its sections named as the Library names them, and the claims that cite it', async t => {
  // One more claim cites a record, a table, and files that cannot be shown; nothing cites the chart's neighbour.
  const cites = ['trees/service/points/fog.md', 'sources/table.csv', 'sources/blob.md', 'sources/large.md', 'sources/linked.md'].map(uri => ({ uri, role: 'background' }));
  const { root, workspace, write, get } = await served(t, records => records.set('trees/service/points/crew.md', record({ id: 'service-crew', sources: cites }, 'Two crew sail every crossing', 'A master and a deckhand are aboard on every crossing.')));
  // A cited fragment leads to the file's page, and lands on the section it cites.
  assert.ok((await get('/service-count/')).text.includes('<li><a href="../_/source/?uri=sources%2Flog.md%23week-45#week-45">sources/log.md#week-45</a></li>'));
  const page = await get('/_/source/?uri=sources%2Flog.md%23week-45');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.ok(page.text.includes('<title>sources/log.md · Harbour ferry</title>'));
  assert.ok(page.text.includes('<header class="strip" data-strip><a class="title" href="../../">Harbour ferry</a><div class="tools"><a class="control" href="../../" data-outline>Outline</a><a class="control help" href="../../_/help/" aria-label="Help">?</a></div></header>'), 'the strip, as on every page');
  assert.ok(page.text.includes('<article class="point source">\n<div class="kind"><span class="cap">Source, as it is now</span></div>\n<h1>sources/log.md</h1>\n<div class="body"><h2 id="crossing-log">Crossing log</h2>\n<h3 id="week-45">Week 45</h3>\n<p>Forty crossings, none late.</p>\n</div>\n</article>'),
    'its path is the title, and each heading carries the name the Library gives it, one level down');
  assert.ok(page.text.includes('<nav class="margin" aria-label="What cites it">\n<section class="map cited"><h2 class="cap">Cited by</h2><ul><li class="acct"><span class="acct-name">Service</span><ul><li><a href="../../service-base/">The ferry sails on the hour while the harbour is open</a></li><li><a href="../../service-count/">Forty crossings were counted in the first week of November</a></li></ul></li><li class="acct"><span class="acct-name">Vessel</span><ul><li><a href="../../vessel-engine/">The engine holds &lt; 5 knots at idle</a></li></ul></li></ul></section>\n</nav>'),
    'the claims that cite the file, by any of its sections, each a link to its page');
  assert.doesNotMatch(page.text, /class="opens"|data-open=/, 'nothing in its margin opens here');
  assert.equal((await get('/_/source/?uri=sources%2Flog.md')).text, page.text, 'one page for the file, whichever section is cited');

  // A record is shown without its JSON header; authored HTML is shown, never run; any other text is shown as it is.
  const held = await get('/_/source/?uri=trees%2Fservice%2Fpoints%2Ffog.md');
  assert.equal(held.status, 200);
  assert.match(held.text, /<div class="body"><h2 id="sailings-stop-in-fog-below-200-metres">Sailings stop in fog below 200 metres<\/h2>\n<p>The master stops sailing/);
  assert.doesNotMatch(held.text, /<hr>|&quot;status&quot;/);
  assert.ok(held.text.includes('<p>&lt;script&gt;alert(\'authored\')&lt;/script&gt;</p>'));
  assert.ok(held.text.includes('<section class="map cited"><h2 class="cap">Cited by</h2><ul><li class="acct"><span class="acct-name">Service</span><ul><li><a href="../../service-crew/">Two crew sail every crossing</a></li></ul></li></ul></section>'));
  await write('sources/table.csv', 'crossing,late\n<b>1</b>,0\n');
  assert.ok((await get('/_/source/?uri=sources%2Ftable.csv')).text.includes('<h1>sources/table.csv</h1>\n<div class="body"><pre><code>crossing,late\n&lt;b&gt;1&lt;/b&gt;,0\n</code></pre></div>'));

  // What cannot be shown is said in a sentence.
  await write('sources/blob.md', Buffer.from([0xff, 0xfe, 0x00]));
  await write('sources/large.md', 'x'.repeat(2 * 1024 * 1024 + 1));
  await fs.symlink(path.join(root, 'sources/notice.md'), path.join(root, 'sources/linked.md'));
  for (const [file, words] of [['sources%2Fgone.md', 'This file is not there.'], ['sources%2Fblob.md', 'This file is not text, so it is not shown here.'], ['sources%2Flarge.md', 'This file is too large to show here.'], ['sources%2Flinked.md', 'This file could not be read here.']]) {
    const said = await get(`/_/source/?uri=${file}`);
    assert.equal(said.status, 200, file);
    assert.ok(said.text.includes(`<p class="says">${words}</p>`), file);
  }
  assert.ok((await get('/_/source/?uri=sources%2Fgone.md')).text.includes('<a href="../../service-base/">'), 'a cited file that is not there still names what cites it');

  // Nothing outside the grants, in Atlas's own state, or not a local path has a page; the service still only reads.
  await fs.mkdir(path.join(root, '.atlas-candidate'));
  await fs.writeFile(path.join(root, '.atlas-candidate/atlas.json'), '{}');
  await write('sources/uncited.md', '# Uncited\n\nNo claim cites this.\n');
  for (const address of ['/_/source/?uri=..%2Foutside%2Fpolicy.md', '/_/source/?uri=sources%2Funcited.md', '/_/source/?uri=trees%2Fservice%2Fpoints%2Fcrew.md', '/_/source/?uri=atlas.json', '/_/source/?uri=..%2F..%2F..%2F..%2Fetc%2Fhosts', `/_/source/?uri=${encodeURIComponent(path.join(workspace, 'outside/policy.md'))}`, '/_/source/?uri=.atlas-candidate%2Fatlas.json',
    '/_/source/?uri=https%3A%2F%2Fexample.org%2Fharbour-rules', '/_/source/?uri=', '/_/source/', '/_/source/?url=sources%2Flog.md', '/_/source/sources/log.md', '/_/source?uri=sources%2Flog.md']) {
    const refused = await get(address);
    assert.equal(refused.status, 404, address);
    assert.doesNotMatch(refused.text, /Refunds are paid|<pre>|Forty crossings|No claim cites this|A master and a deckhand/, address);
  }
  assert.doesNotMatch((await get('/service-base/')).text, /uri=\.\.%2Foutside/, 'a source outside the grants is not a link');
  // Under a proposed change, a source only the change cites has no page yet, so its line is not a link.
  await write('sources/new.md', '# New\n\nA new log.\n');
  const draft = await propose(root, [{ path: 'trees/service/points/crew.md', content: record({ id: 'service-crew', sources: [...cites, { uri: 'sources/new.md', role: 'evidence' }] }, 'Two crew sail every crossing', 'A master and a deckhand are aboard on every crossing.') }], 'Cite the new log');
  const proposed = (await get(`/_/draft/${draft.id}/service-crew/`)).text;
  assert.ok(proposed.includes('<li><span>sources/new.md</span><span class="red">new</span></li>'), 'only the change cites it');
  assert.ok(proposed.includes('<a href="../../../../_/source/?uri=sources%2Ftable.csv">sources/table.csv</a>'), 'what the Atlas as it is cites keeps its link, to the page of the Atlas as it is');
  assert.equal((await get('/_/source/?uri=sources%2Fnew.md')).status, 404);
  assert.equal((await get('/_/source/?uri=sources%2Flog.md', { method: 'POST' })).status, 405);
  assert.equal((await get('/_/source/?uri=sources%2Flog.md', { headers: { Host: 'example.org' } })).status, 403);
  const granted = await startPortal(root, { allowedRoots: [path.join(workspace, 'outside')] });
  t.after(() => granted.close());
  const outside = await ask(granted, '/_/source/?uri=..%2Foutside%2Fpolicy.md');
  assert.equal(outside.status, 200, 'granted, it has a page');
  assert.ok(outside.text.includes('<h1>outside/policy.md</h1>\n<div class="body"><h2 id="company-policy">Company policy</h2>\n<p>Refunds are paid the same day.</p>'));
});

test('a page reflects the files on disk at the time of the request', async t => {
  const { get, write, remove } = await served(t);
  assert.match((await get('/service-crew/')).text, /<h1>Two crew sail every crossing<\/h1>/);
  await write('trees/service/points/crew.md', record({ id: 'service-crew' }, 'Three crew sail every crossing', 'A master and two deckhands.'));
  assert.match((await get('/service-crew/')).text, /<h1>Three crew sail every crossing<\/h1>/);
  assert.match((await get('/')).text, /Three crew sail every crossing/);
  assert.match((await get('/_/search.json')).text, /Three crew sail every crossing/);
  // A cited source is read when its page is asked for.
  assert.match((await get('/service-base/')).text, /<a href="\.\.\/_\/source\/\?uri=sources%2Flog\.md">Crossing log<\/a><span class="loc"> · Week 45<\/span><span class="file">sources\/log\.md<\/span><\/li>/);
  await write('sources/log.md', '# Crossing log\n\nRewritten.\n');
  assert.match((await get('/service-base/')).text, /sources\/log\.md<\/span><span class="red flag"><span aria-hidden="true">△ <\/span>changed since this was checked<\/span><\/li>/);
  await remove('sources/log.md');
  assert.match((await get('/service-base/')).text, /sources\/log\.md<\/span><span class="red flag"><span aria-hidden="true">✗ <\/span>missing<\/span><\/li>/);
});

test('a source outside the Atlas is read only when its folder is granted', async t => {
  const { root, workspace, get } = await served(t);
  const marked = /<a href="\.\.\/_\/source\/\?uri=\.\.%2Foutside%2Fpolicy\.md">Company policy<\/a><span class="file">outside\/policy\.md<\/span><span class="red flag">/;
  await fs.rm(path.join(workspace, 'outside/policy.md'));
  assert.doesNotMatch((await get('/service-base/')).text, marked, 'not granted: nothing is said of it');
  const granted = await startPortal(root, { allowedRoots: [path.join(workspace, 'outside')] });
  t.after(() => granted.close());
  assert.match((await ask(granted, '/service-base/')).text, marked);
  await assert.rejects(startPortal(root, { allowedRoots: ['relative/folder'] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(startPortal(root, { port: 70000 }), { code: 'INVALID_REQUEST' });
  await assert.rejects(startPortal(root, { timeZone: 'Nowhere/Never' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(startPortal(root, { editable: true }), { code: 'INVALID_REQUEST', message: 'The Portal has no option editable.' }, 'an option of the earlier service is refused, not ignored');
  await assert.rejects(startPortal(root, { port: 0, exportDirectory: workspace, agentConfiguration: {} }), { code: 'INVALID_REQUEST' });
  await assert.rejects(startPortal(path.join(root, 'atlas.json')), { code: 'INVALID_ROOT' });
});

test('a reading is kept only while the files are as they were', async t => {
  const { root, write } = await atlas(t);
  const fresh = reading(root);
  assert.notEqual(await fresh(), await fresh(), 'files written a moment ago are read again each time');
  await wait(30);
  const current = reading(root, { settle: 0 });
  const first = await current();
  assert.equal(await current(), first, 'untouched files: the same reading');
  await write('trees/service/points/crew.md', record({ id: 'service-crew' }, 'Three crew sail every crossing', 'A master and two deckhands.'));
  const second = await current();
  assert.notEqual(second, first);
  assert.equal(second.atlas.points.get('service-crew').title, 'Three crew sail every crossing');
  await wait(30);
  const third = await current();
  assert.equal(await current(), third);
  await write('trees/service/points/crew.md', 'not a record');
  assert.equal((await current()).status, 'invalid');
  assert.notEqual(await current(), await current(), 'an Atlas that does not validate is read again each time');
});

test('an Atlas that does not validate shows its diagnostics instead of pages', async t => {
  const { get, write } = await served(t);
  await write('trees/service/points/fog.md', files().get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"'));
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<h1>This Atlas does not validate<\/h1>/);
  assert.match(home.text, /<ul class="diagnostics"><li><span class="red"><span aria-hidden="true">✗ <\/span>DECISION_STATUS<\/span><p>A decision requires a supported status\.<span class="file">trees\/service\/points\/fog\.md<\/span><\/p><\/li><\/ul>/);
  assert.doesNotMatch(home.text, /data-strip|data-outline|class="accounts"/);
  const page = await get('/service-crew/');
  assert.equal(page.status, 404, 'no Point has a page');
  assert.match(page.text, /DECISION_STATUS/);
  assert.match(page.text, /href="\.\.\/_\/sheet\.css"/);
  assert.equal((await get('/_/search.json')).status, 404);
  assert.equal((await get('/_/sheet.css')).status, 200);
  assert.match((await get('/_/help/')).text, /<header class="strip"><a class="title" href="\.\.\/\.\.\/">Atlas<\/a><\/header>[^]*<h1>Help<\/h1>/, 'Help answers where there are no pages, since its marks are on this one');
  await write('trees/service/points/fog.md', files().get('trees/service/points/fog.md'));
  assert.match((await get('/')).text, /<h1>Harbour ferry<\/h1>/, 'repaired on disk, it reads again');
});

test('a folder with no Atlas shows the command that prepares one, and the Atlas it prepares reads as a proposed change', async t => {
  const { workspace } = await atlas(t);
  const empty = path.join(workspace, 'outside');
  const portal = await startPortal(empty);
  t.after(() => portal.close());
  const home = await ask(portal, '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<h1>No Atlas here<\/h1>/);
  // The tests keep drafts in a state home of their own, so the commands name it: the draft they prepare is the one read here.
  assert.ok(home.text.includes(`<pre class="command">atlas --root ${empty} --state-home ${stateHome()} init --id ID --title TITLE --style STYLE</pre>`));
  assert.doesNotMatch(home.text, /Proposed changes/);
  assert.equal((await ask(portal, '/service-fog/')).status, 404);
  assert.deepEqual(await fs.readdir(empty), ['policy.md'], 'nothing is created by looking');

  // What the command prepares is a proposed change: it is listed here, and its Style reads as proposed.
  const [style] = listStyles();
  const draft = await saveDraft(empty, { plan: prepareInitialization(await openAtlas(empty), { id: 'yard', title: 'Boat yard', styleId: style.id }) });
  const listed = await ask(portal, '/');
  assert.ok(listed.text.includes(`<h1>No Atlas here</h1>\n<section class="proposals"><h2 class="cap">Proposed changes</h2><ul><li><a class="claim" href="_/draft/${draft.id}/">Initialize Atlas with its selected Style</a><p class="says">a new Atlas · prepared `), 'it creates the Atlas, so it says so in place of a count of Points');
  const page = await ask(portal, `/_/draft/${draft.id}/`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<a class="title" href="\.\/">Boat yard<\/a>/);
  assert.match(page.text, /Ready to apply/);
  assert.ok(page.text.includes(`<li><h3 class="tree">How this Atlas is written</h3><div><ul class="claims"><li><span class="red">new</span><a href="_/style/">${style.title}</a></li></ul></div></li>`));
  assert.ok(page.text.includes(`atlas --root ${empty} --state-home ${stateHome()} apply ${draft.id} --revision ${draft.revision}`));
  const proposed = await ask(portal, `/_/draft/${draft.id}/_/style/`);
  assert.equal(proposed.status, 200);
  assert.ok(proposed.text.includes(`<div class="kind"><span class="red">new</span><span class="cap">How this Atlas is written</span></div>\n<h1>${style.title}</h1>`));
  assert.match(proposed.text, /<a href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/">The Atlas as it is<\/a>/, 'there is no Atlas yet: the way back is home');
  assert.deepEqual(await fs.readdir(empty), ['policy.md'], 'nothing is written by reading it');
});

test('proposed changes are listed on home and read under their own addresses', async t => {
  const { root, get, write } = await served(t);
  assert.doesNotMatch((await get('/')).text, /Proposed changes/);
  const draft = await propose(root, changes(), reason);
  const home = await get('/');
  assert.ok(home.text.includes(`<h2 class="cap">Proposed changes</h2><ul><li><a class="claim" href="_/draft/${draft.id}/">${reason}</a><p class="says">4 Points differ · prepared `));
  const page = await get(`/_/draft/${draft.id}/`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Ready to apply/);
  assert.match(page.text, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  const proposed = await get(`/_/draft/${draft.id}/service-fog/`);
  assert.equal(proposed.status, 200);
  assert.match(proposed.text, /<h1>Sailings stop in fog below 300 metres<\/h1>/);
  assert.match(proposed.text, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  assert.match((await get('/service-fog/')).text, /<h1>Sailings stop in fog below 200 metres<\/h1>/, 'the Atlas as it is stays as it is');
  assert.equal((await get(`/_/draft/${draft.id}/service-claim/`)).status, 200, 'a removed Point reads as removed');
  assert.equal((await get(`/_/draft/${draft.id}/vessel-radar/`)).status, 200, 'a Point that does not differ reads as proposed too');
  const said = await get(`/_/draft/${draft.id}/_/facet/service/fog-radar/`);
  assert.equal(said.status, 200, 'and so do its Facets');
  assert.match(said.text, /the harbour authority now asks for 300 metres/);
  assert.match(said.text, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  assert.doesNotMatch((await get('/_/facet/service/fog-radar/')).text, /300 metres/);
  const unsaid = await get(`/_/draft/${draft.id}/_/facet/service/no-such-facet/`);
  assert.equal(unsaid.status, 404);
  assert.match(unsaid.text, /This proposed change has nothing at this address\./);
  assert.equal((await get(`/_/draft/${draft.id}/_/facet/service/fog-radar`)).headers.location, `/_/draft/${draft.id}/_/facet/service/fog-radar/`);
  const none = await get(`/_/draft/${draft.id}/no-such-point/`);
  assert.equal(none.status, 404);
  assert.match(none.text, /This proposed change has no Point with the address no-such-point\./);
  const style = await get(`/_/draft/${draft.id}/_/style/`);
  assert.equal(style.status, 200, 'and so does the Style');
  assert.match(style.text, /<h1>Plain accounts<\/h1>/);
  assert.match(style.text, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/_\/sheet\.css">/);
  assert.match(style.text, /<a href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/">The Atlas as it is<\/a>/, 'the Style has no page in the Atlas as it is: the way back is home');
  assert.equal((await get(`/_/draft/${draft.id}/_/style`)).headers.location, `/_/draft/${draft.id}/_/style/`);
  assert.equal((await get(`/_/draft/${draft.id}/_/`)).status, 404);
  const unknown = await get('/_/draft/no-such-draft/');
  assert.equal(unknown.status, 404);
  assert.match(unknown.text, /No proposed change has the address no-such-draft\./);
  assert.equal((await get(`/_/draft/${draft.id}`)).headers.location, `/_/draft/${draft.id}/`);
  assert.equal((await get(`/_/draft/${draft.id}/service-fog`)).headers.location, `/_/draft/${draft.id}/service-fog/`);
  assert.equal((await get(`/_/draft/${draft.id}/`, { method: 'POST' })).status, 405);

  // The Atlas changes: the proposed change is stale. The Atlas breaks: home shows the diagnostics, and the proposed change is still listed and read.
  await write('trees/vessel/points/base.md', record({ id: 'vessel-base' }, 'One hull carries sixty-two passengers', 'Licensed for sixty-two.'));
  assert.match((await get(`/_/draft/${draft.id}/`)).text, /Stale: the Atlas has changed since this was prepared/);
  assert.ok((await get('/')).text.includes(`<a class="claim" href="_/draft/${draft.id}/">${reason}</a><p class="says"><span class="red">Stale</span> · 4 Points differ · prepared `), 'home says so too, in red, before what it does');
  await write('trees/vessel/points/base.md', 'not a record');
  const broken = await get('/');
  assert.match(broken.text, /<h1>This Atlas does not validate<\/h1>\n<section class="proposals">/);
  assert.ok(broken.text.includes(`<a class="claim" href="_/draft/${draft.id}/">${reason}</a><p class="says"><span class="red">Stale</span> · 4 Points differ · prepared `), 'and so does the page of an Atlas that does not validate');
  assert.equal((await get(`/_/draft/${draft.id}/service-fog/`)).status, 200);
});

test('an applied change is no longer listed: applying it removed it', async t => {
  const { root, get } = await served(t);
  const draft = await propose(root, changes(), reason);
  assert.match((await get('/')).text, /Proposed changes/);
  assert.equal((await applyDraft(root, draft.id, { expectedRevision: draft.revision })).draft, 'removed');
  const home = await get('/');
  assert.doesNotMatch(home.text, /Proposed changes|Stale/);
  assert.match((await get('/service-fog/')).text, /<h1>Sailings stop in fog below 300 metres<\/h1>/);
  assert.equal((await get(`/_/draft/${draft.id}/`)).status, 404);
});

test('while an interrupted apply awaits recovery no proposed change can be applied: each says it is blocked, and its page names the command that lists what to recover', async t => {
  const { root, get, write } = await served(t);
  const records = files();
  const early = await propose(root, changes(), reason);
  await write('trees/vessel/points/base.md', record({ id: 'vessel-base' }, 'One hull carries sixty-two passengers', 'Licensed for sixty-two.'));
  const crew = await propose(root, [{ path: 'trees/service/points/crew.md', content: record({ id: 'service-crew' }, 'Three crew sail every crossing', 'A master and two deckhands.') }], 'Sail with three');
  const broken = await propose(root, [{ path: 'trees/service/points/fog.md', content: records.get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"') }], 'Leave the decision open');
  const line = async (draft, words) => assert.ok((await get('/')).text.includes(`<a class="claim" href="_/draft/${draft.id}/">${words} · prepared `), words);
  await line(early, `${reason}</a><p class="says"><span class="red">Stale</span> · 4 Points differ`);
  await line(crew, 'Sail with three</a><p class="says">1 Point differs');

  // An apply interrupted before it writes leaves the Atlas as it was and its journal unfinished.
  const stopped = await applyDraft(root, crew.id, { expectedRevision: crew.revision, onProgress(progress) { if (progress.phase === 'prepared') throw Object.assign(new Error('Injected failure before writing'), { code: 'EIO' }); } });
  assert.equal(stopped.status, 'interrupted');
  await assert.rejects(applyDraft(root, crew.id, { expectedRevision: crew.revision }), { code: 'LOCKED' }, 'the Library applies nothing until it is recovered');
  await line(crew, 'Sail with three</a><p class="says"><span class="red">Blocked</span> · 1 Point differs');
  await line(early, `${reason}</a><p class="says"><span class="red">Blocked</span> · 4 Points differ`);
  await line(broken, 'Leave the decision open</a><p class="says"><span class="red">Invalid</span> · 1 Point differs');
  const page = (await get(`/_/draft/${crew.id}/`)).text;
  assert.match(page, /<p class="red">Blocked: an interrupted apply needs recovery first · prepared /);
  assert.ok(page.includes(`<section><h2 class="cap">To recover</h2><pre class="command">atlas --root ${root} --state-home ${stateHome()} recover</pre></section>`), 'in place of the command that applies it, the one that lists what to recover');
  assert.doesNotMatch(page, /To apply|Ready to apply|--revision/);
  assert.doesNotMatch((await get(`/_/draft/${broken.id}/`)).text, /Blocked|To recover/, 'one that is invalid says why, as before');

  // Recovered, each stands as it did: the ready one can be applied again, and the earlier one is stale.
  assert.equal((await recoverChange(root, stopped.transaction)).status, 'rolled-back');
  await line(crew, 'Sail with three</a><p class="says">1 Point differs');
  await line(early, `${reason}</a><p class="says"><span class="red">Stale</span> · 4 Points differ`);
  const ready = (await get(`/_/draft/${crew.id}/`)).text;
  assert.match(ready, /<p class="says">Ready to apply · prepared /);
  assert.ok(ready.includes(`apply ${crew.id} --revision ${crew.revision}</pre>`));
  assert.doesNotMatch(ready, /To recover/);

  // A journal that cannot be read is not known to have finished, so it blocks too; a file no transaction ID names is no
  // journal, and stops nothing. The Portal says what the Library's apply gate decides.
  const journals = path.join((await resolveState(root)).directory, 'transactions');
  await fs.mkdir(journals, { recursive: true });
  await fs.writeFile(path.join(journals, 'unread-journal.json'), 'not a journal\n');
  await line(crew, 'Sail with three</a><p class="says"><span class="red">Blocked</span> · 1 Point differs');
  const unread = (await get(`/_/draft/${crew.id}/`)).text;
  assert.match(unread, /<p class="red">Blocked: Transaction journal unread-journal cannot be read: Saved state is malformed\. · prepared /, 'its page says why in the Library\'s words');
  assert.doesNotMatch(unread, /To recover|To apply/, 'and names no command: recovery cannot take a journal it cannot read');
  await assert.rejects(applyDraft(root, crew.id, { expectedRevision: crew.revision }), { code: 'INVALID_STATE' }, 'and the Library applies nothing');
  await fs.rm(path.join(journals, 'unread-journal.json'));
  await fs.writeFile(path.join(journals, 'Not a journal.json'), 'not a journal\n');
  await line(crew, 'Sail with three</a><p class="says">1 Point differs');
  assert.match((await get(`/_/draft/${crew.id}/`)).text, /<p class="says">Ready to apply · prepared /);
  assert.equal((await applyDraft(root, crew.id, { expectedRevision: crew.revision })).status, 'complete', 'and the Library applies it');
});

test('a proposed change is blocked, and names no command, while the Atlas does not read whole or its journals cannot be listed', async t => {
  const { root, get } = await served(t);
  const draft = await propose(root, changes(), reason);
  const blocked = async (words, why) => {
    assert.ok((await get('/')).text.includes(`<a class="claim" href="_/draft/${draft.id}/">${reason}</a><p class="says">${words} · prepared `), `home: ${why}`);
    const page = (await get(`/_/draft/${draft.id}/`)).text;
    assert.doesNotMatch(page, /To recover|To apply|Ready to apply/, `no command: ${why}`);
    return page;
  };

  // A folder deeper than the Library reads: the Atlas does not read whole, and no draft can be applied against it.
  const made = await fs.mkdir(path.join(root, '.checks', ...Array(65).fill('d')), { recursive: true });
  assert.match(await blocked('<span class="red">Blocked</span> · 4 Points differ', 'incomplete'), /<p class="red">Blocked: the Atlas does not read whole · prepared /);
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code: 'INCOMPLETE' });
  await fs.rm(made, { recursive: true });
  assert.match((await get(`/_/draft/${draft.id}/`)).text, /<p class="says">Ready to apply · prepared /);

  // A file where the journals' folder belongs: no interrupted apply, so nothing to recover; the page says the Library's words.
  const journals = path.join((await resolveState(root)).directory, 'transactions');
  await fs.writeFile(journals, 'not a folder\n');
  assert.match(await blocked('<span class="red">Blocked</span> · 4 Points differ', 'a file in place of the journals'), /<p class="red">Blocked: ENOTDIR: not a directory, scandir &#39;[^<]*transactions&#39; · prepared /);
  await assert.rejects(applyDraft(root, draft.id, { expectedRevision: draft.revision }), { code: 'ENOTDIR' });
});

test('a proposed change that cannot be read is said on home, and the others are still listed', async t => {
  const { root, get } = await served(t);
  const good = await propose(root, changes(), reason);
  const bad = await propose(root, [{ path: 'trees/service/points/crew.md', content: record({ id: 'service-crew' }, 'Three crew sail every crossing', 'A master and two deckhands.') }], 'Sail with three');
  const file = path.join((await resolveState(root)).directory, 'drafts', `${bad.id}.json`);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));

  // A draft carries a model of what it proposes beside the bytes. Only the bytes are read.
  const resave = async content => fs.writeFile(file, `${JSON.stringify({ ...content, revision: createHash('sha256').update(JSON.stringify(content)).digest('hex') }, null, 2)}\n`);
  const { revision, ...content } = structuredClone(saved);
  content.plan.candidate.atlas.points.find(item => item.id === 'service-crew').title = 'Forged in the stored model';
  await resave(content);
  const forged = await get(`/_/draft/${bad.id}/service-crew/`);
  assert.equal(forged.status, 200);
  assert.match(forged.text, /<h1>Three crew sail every crossing<\/h1>/);
  assert.doesNotMatch(forged.text, /Forged/);

  // The draft's candidate no longer holds the bytes the plan was made for; its own record is otherwise sound.
  content.plan.candidate.files.find(item => item.path === 'trees/service/points/crew.md').content += 'and a cat.\n';
  await resave(content);
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes(`<section class="proposals"><h2 class="cap">Proposed changes</h2><ul><li><a class="claim" href="_/draft/${good.id}/">${reason}</a>`), 'the one that can be read is listed');
  assert.ok(home.text.includes(`</li></ul><p class="red"><span aria-hidden="true">✗ </span>A proposed change could not be read: ${bad.id}.json: `), 'under the list, home says which, by its file and in the Library\'s words');
  assert.ok(!home.text.includes('Sail with three'));
  const unread = await get(`/_/draft/${bad.id}/`);
  assert.equal(unread.status, 500);
  assert.match(unread.text, new RegExp(`<p class="says">The proposed change ${bad.id} could not be read: `));
  assert.equal((await get(`/_/draft/${good.id}/`)).status, 200);

  // The file itself is damaged, and another file in the store of drafts is no draft at all: each is named on a line of its own, and neither hides the one that reads.
  await fs.writeFile(file, JSON.stringify(saved).replace('Sail with three', 'Sail with four'));
  await fs.writeFile(path.join(path.dirname(file), 'notes.json'), '{}\n');
  const damaged = await get('/');
  assert.equal(damaged.status, 200);
  const cannot = words => `<p class="red"><span aria-hidden="true">✗ </span>A proposed change could not be read: ${words}</p>`;
  assert.ok(damaged.text.includes(`<section class="proposals"><h2 class="cap">Proposed changes</h2><ul><li><a class="claim" href="_/draft/${good.id}/">${reason}</a>`));
  assert.ok(damaged.text.includes(`</li></ul>${cannot(`${bad.id}.json: Saved draft integrity failed.`)}${cannot('notes.json: Invalid draft.')}</section><ol class="accounts"`), 'one line for each, by its file and in the Library\'s words');
  assert.equal((await get(`/_/draft/${good.id}/`)).status, 200, 'one draft that cannot be read hides no other');
  const damagedPage = await get(`/_/draft/${bad.id}/`);
  assert.equal(damagedPage.status, 500);
  assert.ok(damagedPage.text.includes(`<p class="says">The proposed change ${bad.id} could not be read: Saved draft integrity failed.</p>`));
  assert.equal((await get('/_/draft/notes/')).status, 500);

  // The store of drafts as a whole cannot be read: home says so once, in the Library's words, and the Atlas reads on.
  await fs.writeFile(path.join(path.dirname(path.dirname(file)), 'owner.json'), 'not metadata\n');
  const refused = await get('/');
  assert.equal(refused.status, 200);
  assert.ok(refused.text.includes(`<h2 class="cap">Proposed changes</h2>${cannot('Private state has invalid ownership metadata.')}</section><ol class="accounts"`));
  assert.equal((await get(`/_/draft/${good.id}/`)).status, 500);
  assert.equal((await get('/service-fog/')).status, 200, 'the Atlas as it is reads on');
});

test('without the script every page is complete, and the two patterns hold on each: a name goes to a page, and only a margin item opens', async t => {
  const { root, portal, get } = await served(t, records => records.set('.checks/tone.md', check('tone', 'Every claim is a plain sentence')));
  const draft = await propose(root, changes(), reason);
  // One that alters the Atlas itself and what it is held to.
  const manifest = JSON.parse(files().get('atlas.json'));
  const held = await propose(root, [{ path: 'atlas.json', content: `${JSON.stringify({ ...manifest, title: 'The harbour ferry', trees: ['trees/vessel', 'trees/service', 'trees/harbour'] }, null, 2)}\n` },
    { path: '.checks/tone.md', content: check('tone', 'Every claim is one plain sentence', { requirement: 'Each claim is one sentence.' }) }, { path: '.checks/dates.md', content: check('dates', 'Every observation carries its date') }], 'Lead with the vessel, and hold claims to one sentence');
  const dated = { path: 'style.md', content: '# Plain accounts, dated\n\nEach account states one claim and develops it.\n\nEvery observation carries its date.\n' };
  const restyle = await propose(root, [dated], 'Date every observation');
  // Two that cannot be applied: one alters the Style together with an account, one proposes an Atlas that does not validate.
  const mixed = await propose(root, [dated, { path: 'trees/vessel/tree.json', content: files().get('trees/vessel/tree.json').replace('"title": "Vessel"', '"title": "The vessel"') }], 'Date every observation, and rename an account');
  const broken = await propose(root, [{ path: 'trees/service/points/fog.md', content: files().get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"') }], 'Leave the decision open');
  const text = html => html.replace(/<[^>]*>/g, '');

  // Every address the pages name, from home on: each answers, and each page keeps to the two patterns.
  const pages = new Map(), waiting = ['/'];
  while (waiting.length) {
    const address = waiting.pop();
    if (pages.has(address)) continue;
    const answer = await get(address);
    assert.equal(answer.status, 200, `${address} answers`);
    pages.set(address, answer.text);
    if (!answer.headers['content-type'].startsWith('text/html')) continue;
    const html = answer.text, cut = html.indexOf('<nav class="margin"'), margin = cut < 0 ? '' : html.slice(cut, html.indexOf('</nav>', cut)), rest = html.replace(margin, '');
    for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) if (!/^https?:\/\//.test(value)) {
      const to = new URL(value.replaceAll('&amp;', '&'), new URL(address, portal.url));
      waiting.push(to.pathname + to.search);
    }
    assert.equal((html.match(/<a(?![^>]*\shref="[^"]+")[\s>]/g) ?? []).length, 0, `${address}: every name is a link that leads somewhere`);
    // A source's page lists what cites it; there every item goes to its page, as a name in a list does.
    const item = address.startsWith('/_/source/?') ? /^<a href="(?:\.\.\/)+(?:[a-z0-9-]+|_\/facet\/[a-z0-9-]+\/[a-z0-9-]+)\/">$/ : /^<a class="opens(?: gone)?" href="[^"]+" data-open="[^"]+">$/;
    assert.deepEqual((margin.match(/<a [^>]*>/g) ?? []).filter(link => !item.test(link)), [], `${address}: every item in the margin is a name that opens, and a link to its page; on a source's page, a link to the page of what cites it`);
    assert.doesNotMatch(margin, /<details|<summary|<button|<input/, `${address}: nothing opens inside the margin`);
    assert.doesNotMatch(rest, /class="opens|data-open=/, `${address}: outside a margin a name goes to its page`);
    assert.deepEqual(rest.match(/<[a-z]+ class="(?:control|close)"[^>]*>[^<]*/g) ?? [], /data-strip/.test(html) && address !== '/' ? [`<a class="control" href="${'../'.repeat(address.split('/').length - 2)}" data-outline>Outline`] : [], `${address}: besides Help, the one bordered control a page is served with is Outline, a link to home until the script makes it a button`);
    assert.doesNotMatch(html, /<button|<input|<select|<textarea|<form|role="button"|tabindex=/, `${address}: nothing else is made to be pressed`);
    assert.deepEqual((html.match(/<details[^>]*>(?!<summary>)/g) ?? []), [], `${address}: what opens in place is a native disclosure with its line`);
    assert.deepEqual([...new Set(html.match(/<details[^>]*>/g) ?? [])].filter(tag => !['<details class="rests">', '<details class="rests" open>', '<details class="outline map">', '<details class="before">'].includes(tag)), []);
  }
  const addresses = [...pages.keys()];
  assert.equal(addresses.filter(address => /^\/[a-z0-9-]+\/$/.test(address)).length, 12, 'every Point is reached from home');
  assert.equal(addresses.filter(address => /^\/_\/facet\//.test(address)).length, 4, 'and every Facet');
  assert.deepEqual(addresses.filter(address => address.startsWith('/_/source/')).sort(), ['/_/source/?uri=sources%2Fchart.md', '/_/source/?uri=sources%2Fgone.md', '/_/source/?uri=sources%2Flog.md', '/_/source/?uri=sources%2Flog.md%23week-45', '/_/source/?uri=sources%2Flog.md%23week-46', '/_/source/?uri=sources%2Fnotice.md', '/_/source/?uri=sources%2Ftrials.md'],
    'and every cited source the grants reach, by the URI as cited');
  assert.equal(addresses.filter(address => address.startsWith(`/_/draft/${draft.id}/`)).length, 1 + 13 + 4, 'and under a proposed change its page, every Point it holds or removes, and every Facet');
  assert.ok(pages.has(`/_/draft/${restyle.id}/_/style/`), 'a proposed change to the Style reads on its own page');
  assert.ok(!addresses.some(address => address.startsWith('/_/style')), 'and no page links to a page of the Style as it is, which a reader does not have');
  for (const [refused, code] of [[mixed, 'STYLE_CHANGE_ALONE'], [broken, 'DECISION_STATUS']]) {
    const page = pages.get(`/_/draft/${refused.id}/`);
    assert.match(page, /<p class="red">Invalid: it cannot be applied as it stands · prepared /);
    assert.ok(page.includes(`<span class="red"><span aria-hidden="true">✗ </span>${code}</span>`));
    assert.doesNotMatch(page, /To apply|atlas --root/);
  }
  assert.ok(pages.has(`/_/draft/${mixed.id}/_/style/`), 'a change that is refused for itself proposes an Atlas that validates, and it reads as proposed');
  assert.equal((await get(`/_/draft/${mixed.id}/vessel-base/`)).status, 200);
  assert.match(pages.get(`/_/draft/${broken.id}/`), /What differs<\/h2><ol class="accounts"><li><h3 class="tree">Files<\/h3>[^]*<span>Sailings stop in fog below 200 metres<span class="file">trees\/service\/points\/fog\.md<\/span><\/span>/, 'what it writes is named by its file');
  const altered = pages.get(`/_/draft/${held.id}/`);
  for (const words of ['<h3 class="tree">This Atlas<span class="red">changed</span></h3>', 'its title, the order of its Trees', '<ol class="order"><li>Vessel</li><li>Service</li><li>Harbour</li></ol>', 'What this Atlas is held to', 'Each claim is one sentence.', '<p class="cap">Advisory · active</p>']) assert.ok(altered.includes(words), `a change to the Atlas itself: ${words}`);
  assert.equal((await get(`/_/draft/${broken.id}/service-fog/`)).status, 404, 'an Atlas that does not validate has no pages, proposed or not');

  // Every margin item is a working link: it leads to the page of what it names.
  let items = 0;
  for (const [address, html] of pages) for (const [, href, name] of html.matchAll(/<a class="opens(?: gone)?" href="([^"]+)" data-open="[^"]+">([^<]*)/g)) {
    const target = pages.get(new URL(href, new URL(address, portal.url)).pathname);
    assert.equal(/<h1[^>]*>([^<]*)<\/h1>/.exec(target)[1], name, `${address}: ${name}`);
    items++;
  }
  assert.ok(items > 100, `${items} margin items were followed`);

  // What a reader needs is in the page as served: the prose, the map, the uncertainty, the sources and the links.
  const point = pages.get('/service-base/');
  for (const words of ['A passenger can plan on a sailing every hour.', '<a href="../service-timetable/">The timetable</a>', 'Whether the hourly sailing holds in winter is not recorded.', '6 sources', 'Crossing log', 'sources/notice.md', 'changed since this was checked', 'outside/policy.md', 'href="https://example.org/harbour-rules"',
    '<span aria-current="page">The ferry sails on the hour while the harbour is open</span>', 'data-open="service-timetable">The timetable holds in daylight</a>', 'data-open="service-count"', '<span class="cap">Next</span><a href="../service-timetable/">']) assert.ok(point.includes(words), `a Point: ${words}`);
  const facet = pages.get('/_/facet/service/fog-radar/');
  for (const words of ['Service · Facet, seen from Vessel', 'The service stops where <a href="../../../../vessel-radar/">the radar</a> stops seeing.', 'The radar was last checked in 2025.', 'Said of, in Service', 'data-open="service-fog">Sailings stop in fog below 200 metres</a>', 'In Vessel', 'data-open="vessel-radar">']) assert.ok(facet.includes(words), `a Facet: ${words}`);
  const home = pages.get('/');
  for (const words of ['Proposed changes', reason, '4 Points differ', 'Date every observation', 'no Point differs', 'What a passenger can rely on, and where that stops.', '6 Points', '<a href="service-claim/" data-id="service-claim">A refund is claimed at the quay office</a>', 'Decision · selected', 'Observation · 3 November 2026']) assert.ok(home.includes(words), `home: ${words}`);
  // A change that cannot be applied says so on home, in red, with the word its page uses, before what it does; one that can says only what it does.
  for (const [item, line] of [[draft, `${reason}</a><p class="says">4 Points differ`], [restyle, 'Date every observation</a><p class="says">no Point differs'],
    [mixed, 'Date every observation, and rename an account</a><p class="says"><span class="red">Invalid</span> · no Point differs'], [broken, 'Leave the decision open</a><p class="says"><span class="red">Invalid</span> · 1 Point differs']]) {
    assert.ok(home.includes(`<a class="claim" href="_/draft/${item.id}/">${line} · prepared `), `home: ${line}`);
  }
  assert.doesNotMatch(home, /Written as/, 'home does not name the Style');
  const proposal = pages.get(`/_/draft/${draft.id}/`);
  for (const words of [reason, 'Ready to apply', 'What differs', 'its outline', 'its scope', '<a href="service-fog/">Sailings stop in fog below 300 metres</a>', '<a href="service-claim/"><span class="gone">A refund is claimed at the quay office</span></a>', 'Facet, seen from Vessel', 'What else to read', 'Points above what differs', 'Other Trees&#39; Facets that draw on what differs', '<a href="_/facet/vessel/radar-duty/">', 'To apply', `apply ${draft.id} --revision ${draft.revision}`]) assert.ok(proposal.includes(words), `a proposed change: ${words}`);
  const proposed = pages.get(`/_/draft/${draft.id}/service-fog/`);
  for (const words of ['Proposed change', 'The Atlas as it is', 'Decision · proposed', '<summary>Before</summary>', 'The mate may also stop a sailing when the master is ashore.', 'fog &lt; 200 m: stop', 'data-open="service-refund"', 'data-open="service:fog-radar"']) assert.ok(proposed.includes(words), `a Point as proposed: ${words}`);
  assert.match(text(pages.get(`/_/draft/${restyle.id}/_/style/`)), /changedHow this Atlas is written\s+Plain accounts, datedBeforePlain accounts\s+Each account states one claim and develops it\.[^]*newEvery observation carries its date\./);
});

