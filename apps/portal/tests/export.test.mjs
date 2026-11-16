import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportPortal } from '../src/export.mjs';
import { startPortal } from '../src/server.mjs';
import { stateHome, openModel, fingerprint } from '../src/model.mjs';
import { atlas, propose, changes, reason, record, files } from './fixture.mjs';

/** Every file under a folder, as paths relative to it, sorted. */
async function listed(folder, within = '') {
  const found = [];
  for (const entry of await fs.readdir(path.join(folder, within), { withFileTypes: true })) {
    const name = within ? `${within}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listed(folder, name)); else found.push(name);
  }
  return found.sort();
}

/** The relative links of every exported page that do not lead to a written file. */
async function deadLinks(out) {
  const dead = [];
  for (const file of (await listed(out)).filter(name => name.endsWith('.html'))) {
    const html = await fs.readFile(path.join(out, file), 'utf8');
    for (const [, attribute, value] of html.matchAll(/\b(href|src)="([^"]*)"/g)) {
      if (/^https?:\/\//.test(value)) continue;
      assert.doesNotMatch(value, /^\//, `${file}: ${attribute} is not relative: ${value}`);
      let target = path.resolve(path.dirname(path.join(out, file)), value.split('#')[0]);
      if (value.split('#')[0] === '' || value.split('#')[0].endsWith('/')) target = path.join(target, 'index.html');
      try { assert.ok((await fs.stat(target)).isFile()); } catch { dead.push(`${file}: ${value}`); }
    }
  }
  return dead;
}

const pages = ['harbour-base', 'harbour-signal', 'service-base', 'service-claim', 'service-count', 'service-crew', 'service-fog', 'service-refund', 'service-timetable', 'vessel-base', 'vessel-engine', 'vessel-radar'];
const facets = ['service/fog-radar', 'service/gale', 'vessel/crew-seats', 'vessel/radar-duty'];
const written = (points, facetPages, more = []) => ['_/export.json', '_/help/index.html', '_/reader.js', '_/search.js', '_/search.json', '_/sheet.css', ...facetPages.map(key => `_/facet/${key}/index.html`), ...points.map(id => `${id}/index.html`), 'index.html', ...more].sort();

/**
 * A page as the local service serves it, with each link to a source's own page, which only the service has, put back
 * as an export writes it: in a source line the plain name, and in prose the words alone.
 */
const unlinked = html => html.replace(/<li><a href="(?:\.\.\/)*_\/source\/\?uri=[^"]*">([^<]*)<\/a>/g, '<li><span>$1</span>').replace(/<a href="(?:\.\.\/)*_\/source\/\?uri=[^"]*">([^<]*)<\/a>/g, '$1');

test('an export writes the same pages the service serves but for the links to sources, and every link among them leads to a file', async t => {
  const { root, workspace } = await atlas(t);
  const out = path.join(workspace, 'site');
  const result = await exportPortal(root, out, { all: true });
  assert.deepEqual(result, { format: 'atlas.export/2', atlas: 'ferry', identity: result.identity, trees: ['service', 'vessel', 'harbour'], sourceBase: null, status: 'complete', output: out, points: 12, facets: 4, replaced: false });
  assert.match(result.identity, /^[a-f0-9]{64}$/);
  assert.deepEqual(await listed(out), written(pages, facets), 'a page for home, for each Point and for each Facet, the help page, the assets, and the marker: no page of the Style, which is how maintainers write the Atlas');
  assert.deepEqual(await deadLinks(out), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, '_/export.json'), 'utf8')), { format: 'atlas.export/2', atlas: 'ferry', identity: result.identity, trees: ['service', 'vessel', 'harbour'], sourceBase: null, files: await listed(out) });

  const portal = await startPortal(root);
  t.after(() => portal.close());
  for (const [address, file] of [['', 'index.html'], ['service-fog/', 'service-fog/index.html'], ['service-base/', 'service-base/index.html'], ['_/facet/service/fog-radar/', '_/facet/service/fog-radar/index.html'], ['_/facet/service/gale/', '_/facet/service/gale/index.html'], ['_/help/', '_/help/index.html'], ['_/sheet.css', '_/sheet.css'], ['_/reader.js', '_/reader.js'], ['_/search.js', '_/search.js'], ['_/search.json', '_/search.json']]) {
    const answered = await (await fetch(new URL(address, portal.url))).text();
    assert.equal(await fs.readFile(path.join(out, file), 'utf8'), unlinked(answered), `${file} is what the service answers at /${address}, but for the links to sources`);
    if (file === 'service-base/index.html') assert.notEqual(unlinked(answered), answered, 'the service links the sources the grants reach to their own pages');
    if (file === 'service-fog/index.html') assert.ok(answered.includes('recorded in\n<a href="../_/source/?uri=sources%2Flog.md%23week-45#week-45">the crossing log</a>.'), 'and prose that names a file the Atlas cites links it there too');
  }
  const home = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(home, /Written as|_\/style|Plain accounts/, 'home does not name the Style');
  assert.match(await fs.readFile(path.join(out, 'service-fog/index.html'), 'utf8'), /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['atlas.json', 'sources', 'style.md', 'trees'], 'the Atlas is left as it was');
});

test('an export holds the chosen accounts and nothing of the others', async t => {
  const { root, workspace } = await atlas(t);
  const out = path.join(workspace, 'site');
  await propose(root, changes(), reason);
  const result = await exportPortal(root, out, { trees: ['service'] });
  assert.deepEqual(result.trees, ['service']);
  assert.equal(result.points, 7);
  assert.equal(result.facets, 2);
  assert.deepEqual(await listed(out), written(pages.filter(id => id.startsWith('service-')), facets.filter(key => key.startsWith('service/'))), 'no source bodies, no proposed change, no Facet of another Tree');
  assert.deepEqual(await deadLinks(out), []);
  const everything = (await Promise.all((await listed(out)).map(file => fs.readFile(path.join(out, file), 'utf8')))).join('\n');
  for (const words of ['radar reaches', 'One hull carries', 'closes the mouth', 'A red light', 'the set resolves', 'Above force 8', 'What the hull', 'Proposed change', '300 metres', 'Forty crossings, none late']) {
    assert.ok(!everything.includes(words), `nothing of what was not chosen: ${words}`);
  }
  const home = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(home, /Written as|Vessel|Harbour<|_\/style/);
  const fog = await fs.readFile(path.join(out, 'service-fog/index.html'), 'utf8');
  assert.match(fog, /The limit is\nthe radar's reach <span class="says">not in this publication<\/span>, and/, 'a link to a record outside the selection is plain text, and says so');
  assert.match(fog, /<h2 class="cap">Facets seen from a Tree not in this publication<\/h2><ul><li><a class="opens" href="\.\.\/_\/facet\/service\/fog-radar\/" data-open="service:fog-radar">/, 'a Facet through an account outside the selection is marked');
  assert.doesNotMatch(fog, /Refers to|Referred to by/, 'what lies outside the selection is not in the map');
  const facet = await fs.readFile(path.join(out, '_/facet/service/fog-radar/index.html'), 'utf8');
  assert.match(facet, /Service · Facet, seen from a Tree not in this publication/);
  assert.doesNotMatch(facet, /<h2 class="cap">In /, 'the claims it draws on are outside the selection, and are not named');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, '_/search.json'), 'utf8')).records.filter(item => !item.on).map(item => item.id), pages.filter(id => id.startsWith('service-')).sort((left, right) => ['service-base', 'service-timetable', 'service-fog', 'service-refund', 'service-claim', 'service-crew', 'service-count'].indexOf(left) - ['service-base', 'service-timetable', 'service-fog', 'service-refund', 'service-claim', 'service-crew', 'service-count'].indexOf(right)));
});

test('with a source base, local sources and links to local files lead there; how each source stands is read at export time', async t => {
  const { root, workspace } = await atlas(t);
  const out = path.join(workspace, 'site');
  const result = await exportPortal(root, out, { all: true, sourceBase: 'https://example.org/repo/tree/main/atlas' });
  assert.equal(result.sourceBase, 'https://example.org/repo/tree/main/atlas/', 'the base names a folder');
  const base = await fs.readFile(path.join(out, 'service-base/index.html'), 'utf8');
  assert.match(base, /<li><a class="out" href="https:\/\/example\.org\/repo\/tree\/main\/atlas\/sources\/log\.md" target="_blank" rel="noopener noreferrer">Crossing log<\/a><span class="loc"> · Week 45<\/span><span class="file">sources\/log\.md<\/span><\/li>/);
  assert.match(base, /<summary>6 sources<span class="red"> · 1 changed since this was checked · 1 missing<\/span><span class="blue"> · 1 not checked here<\/span><\/summary>/);
  // A stamped source outside the grants stays visible as a limit, in blue, and is not taken for one that was checked.
  assert.match(base, /outside\/policy\.md<\/span><span class="blue flag"><span aria-hidden="true">○ <\/span>not checked here<\/span><\/li>/);
  assert.match(base, /href="https:\/\/example\.org\/repo\/tree\/main\/outside\/policy\.md"/);
  assert.match(base, /Harbour notice<\/a><span class="file">sources\/notice\.md<\/span><span class="red flag"><span aria-hidden="true">△ <\/span>changed since this was checked<\/span><\/li>/);
  assert.match(base, /sources\/gone\.md<\/a><span class="red flag"><span aria-hidden="true">✗ <\/span>missing<\/span><\/li>/);
  assert.match(await fs.readFile(path.join(out, 'service-fog/index.html'), 'utf8'), /<a class="out" href="https:\/\/example\.org\/repo\/tree\/main\/atlas\/sources\/log\.md#week-45" target="_blank" rel="noopener noreferrer">the crossing log<\/a>/);
  for (const sourceBase of ['not a url', 'ftp://example.org/x/', 'https://me:secret@example.org/x/', '/local/folder']) {
    await assert.rejects(exportPortal(root, path.join(workspace, 'other'), { all: true, sourceBase }), { code: 'INVALID_SOURCE_BASE' }, sourceBase);
  }
  await assert.rejects(fs.stat(path.join(workspace, 'other')), { code: 'ENOENT' });
});

test('an export takes the place of a previous one as a whole, and of nothing else', async t => {
  const { root, workspace, write } = await atlas(t);
  const out = path.join(workspace, 'site');
  await exportPortal(root, out, { all: true });
  await fs.writeFile(path.join(out, 'CNAME'), 'ferry.example.org\n');
  await fs.mkdir(path.join(out, 'kept'));
  await fs.writeFile(path.join(out, 'kept/note.txt'), 'not the export\'s\n');
  await write('trees/service/points/crew.md', record({ id: 'service-crew' }, 'Three crew sail every crossing', 'A master and two deckhands.'));
  const again = await exportPortal(root, out, { trees: ['service', 'harbour'] });
  assert.equal(again.replaced, true);
  assert.deepEqual(await listed(out), written(pages.filter(id => !id.startsWith('vessel-')), facets.filter(key => key.startsWith('service/')), ['CNAME', 'kept/note.txt']), 'the earlier pages are gone; what the export did not write stays');
  for (const folder of ['vessel-base', '_/facet/vessel']) await assert.rejects(fs.stat(path.join(out, folder)), { code: 'ENOENT' }, `a folder the earlier export left empty is removed: ${folder}`);
  assert.match(await fs.readFile(path.join(out, 'service-crew/index.html'), 'utf8'), /Three crew sail every crossing/);
  assert.deepEqual(await deadLinks(out), []);
  assert.equal((await listed(workspace)).some(name => name.includes('.atlas-export-')), false, 'nothing is left beside it');

  // A file the previous export did not write stands where a page would go: refused, and nothing changes.
  await fs.mkdir(path.join(out, 'vessel-base'));
  await fs.writeFile(path.join(out, 'vessel-base/index.html'), 'mine\n');
  const before = await listed(out);
  await assert.rejects(exportPortal(root, out, { all: true }), { code: 'EXPORT_CONFLICT' });
  assert.deepEqual(await listed(out), before);
  assert.equal(await fs.readFile(path.join(out, 'vessel-base/index.html'), 'utf8'), 'mine\n');
});

test('an export refuses a folder it must not write into, and a selection it cannot hold', async t => {
  const { root, workspace, write } = await atlas(t);
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const refused = async (out, options, code, why) => {
    await assert.rejects(exportPortal(root, out, options), { code }, why);
  };
  await refused(path.join(root, 'site'), { all: true }, 'EXPORT_OVERLAP', 'inside the Atlas');
  await refused(path.join(root, 'trees/service/site'), { all: true }, 'EXPORT_OVERLAP', 'deep inside the Atlas');
  await refused(workspace, { all: true }, 'EXPORT_OVERLAP', 'a folder that holds the Atlas');
  await fs.symlink(root, path.join(workspace, 'alias'));
  await refused(path.join(workspace, 'alias/site'), { all: true }, 'EXPORT_OVERLAP', 'inside the Atlas by another name');
  await refused(path.join(stateHome(), 'site'), { all: true }, 'EXPORT_OVERLAP', 'inside the private state');
  await refused(path.dirname(stateHome()), { all: true }, 'EXPORT_OVERLAP', 'a folder that holds the private state');
  // Run from this checkout, the Portal refuses its code, apps/ and the Library. Its other folders take an export: these
  // tests keep their fixtures, and write their exports, under its tmp/.
  const application = { code: 'EXPORT_OVERLAP', message: 'The export must be outside the Atlas application.' };
  for (const folder of ['apps/portal/site', 'apps/portal/assets', 'apps/cli/site', 'library/site']) {
    await assert.rejects(exportPortal(root, path.join(repo, folder), { all: true }), application, folder);
  }
  for (const folder of ['apps/portal/site', 'apps/cli/site', 'library/site']) await assert.rejects(fs.stat(path.join(repo, folder)), { code: 'ENOENT' }, folder);

  // What the application is, is told by what the folder that holds apps/ contains, never by the package's name: a copy of
  // the code beside its workspace file is a checkout; without one it is an installed package, whatever it is called.
  const copy = async (folder, name, checkout) => {
    const at = path.join(workspace, folder);
    for (const part of ['library/src', 'apps/portal/src', 'apps/portal/assets']) await fs.cp(path.join(repo, part), path.join(at, part), { recursive: true });
    await fs.writeFile(path.join(at, 'package.json'), JSON.stringify({ name, type: 'module' }));
    if (checkout) await fs.cp(path.join(repo, 'pnpm-workspace.yaml'), path.join(at, 'pnpm-workspace.yaml'));
    return { at, write: (await import(pathToFileURL(path.join(at, 'apps/portal/src/export.mjs')).href)).exportPortal };
  };
  const checkout = await copy('checkout', 'atlas-dev', true);
  for (const folder of ['apps/cli/site', 'apps/portal/site', 'library/site', '']) {
    await assert.rejects(checkout.write(root, path.join(checkout.at, folder), { all: true }), application, `checkout: ${folder || 'the folder that holds its code'}`);
  }
  for (const folder of ['tmp/site', '.local/site']) assert.equal((await checkout.write(root, path.join(checkout.at, folder), { trees: ['harbour'] })).status, 'complete', `checkout: ${folder}`);
  for (const name of ['@neutral/atlas', 'atlas-fork']) {
    const installed = await copy(name.replace(/\W/g, '-'), name, false);
    for (const folder of ['site', 'apps/portal/site', 'library/site', 'tmp/site', '']) {
      await assert.rejects(installed.write(root, path.join(installed.at, folder), { all: true }), application, `${name}: ${folder || 'the package'}`);
    }
    await assert.rejects(fs.stat(path.join(installed.at, 'site')), { code: 'ENOENT' });
    assert.equal((await installed.write(root, `${installed.at}-site`, { trees: ['harbour'] })).points, 2, `${name}: beside it`);
  }

  await fs.mkdir(path.join(workspace, 'taken'));
  await refused(path.join(workspace, 'taken'), { all: true }, 'EXPORT_EXISTS', 'an existing folder, even an empty one');
  await fs.mkdir(path.join(workspace, 'taken/_'));
  await fs.writeFile(path.join(workspace, 'taken/_/export.json'), JSON.stringify({ format: 'atlas.export/2', files: ['../../atlas/atlas.json'] }));
  await refused(path.join(workspace, 'taken'), { all: true }, 'EXPORT_EXISTS', 'a marker that lists a path no export writes');
  await fs.writeFile(path.join(workspace, 'taken/_/export.json'), JSON.stringify({ format: 'atlas.export-selection/1', files: [] }));
  await refused(path.join(workspace, 'taken'), { all: true }, 'EXPORT_EXISTS', 'another format\'s marker');
  await fs.writeFile(path.join(workspace, 'file'), 'a file\n');
  await refused(path.join(workspace, 'file'), { all: true }, 'EXPORT_EXISTS', 'an existing file');
  assert.equal(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'), files().get('atlas.json'), 'a marker cannot point a later export at files outside its folder');

  const out = path.join(workspace, 'site');
  await refused(out, {}, 'SELECTION_REQUIRED', 'no selection');
  await refused(out, { trees: [] }, 'SELECTION_REQUIRED', 'an empty selection');
  await refused(out, { trees: ['service'], all: true }, 'SELECTION_REQUIRED', 'both');
  await refused(out, { trees: ['service', 'service'] }, 'SELECTION_REQUIRED', 'an account named twice');
  await refused(out, { trees: 'service' }, 'SELECTION_REQUIRED', 'not a list');
  await refused(out, { trees: ['service', 'no-such-account'] }, 'SELECTION_UNKNOWN', 'an account the Atlas does not have');
  await refused(out, { trees: ['service-fog'] }, 'SELECTION_UNKNOWN', 'a Point is not a selection');
  await refused(path.join(workspace, 'elsewhere'), { all: true, style: true }, 'INVALID_REQUEST', 'an export writes no page of the Style, and the option is refused, not ignored');
  await refused(out, { trees: ['service'], points: ['service-fog'] }, 'INVALID_REQUEST', 'a single Point is not a selection, and an unknown option is refused, not ignored');
  await refused(out, { trees: ['service'], sources: ['sources/log.md'], includeStyle: true }, 'INVALID_REQUEST', 'the options of the earlier export');
  await refused(out, { all: true, allowedRoots: ['relative'] }, 'INVALID_REQUEST', 'a grant that is not an absolute directory');
  await write('trees/service/points/crew.md', 'not a record');
  await assert.rejects(exportPortal(root, out, { all: true }), error => {
    assert.equal(error.code, 'INVALID_ATLAS');
    assert.deepEqual(error.diagnostics.map(item => `${item.code} ${item.path}`), ['MARKDOWN_HEADER trees/service/points/crew.md', 'POINT_MISSING trees/service/tree.json', 'FACET_TARGET trees/vessel/facets/seats.md']);
    return true;
  });
  await assert.rejects(exportPortal(path.join(workspace, 'outside'), out, { all: true }), { code: 'INVALID_ATLAS' });
  await assert.rejects(fs.stat(out), { code: 'ENOENT' }, 'a refused export writes nothing');
});

test('the candidate folder is never read, served or exported', async t => {
  const { root, workspace } = await atlas(t);
  const plain = await openModel(root);
  // A copy of the records for an agent to edit, as the candidate command writes it, with a claim retitled, one added and a file that is no record.
  const candidate = path.join(root, '.atlas-candidate');
  const put = async (file, content) => { await fs.mkdir(path.dirname(path.join(candidate, file)), { recursive: true }); await fs.writeFile(path.join(candidate, file), content); };
  for (const [file, content] of files()) if (!file.startsWith('sources/')) await put(file, content.replace('below 200 metres', 'below 300 metres'));
  await put('trees/service/points/stray.md', record({ id: 'service-stray' }, 'A claim only the candidate holds', 'Nothing develops it.'));
  await put('notes.md', '# Notes\n\nOnly the candidate holds these.\n');
  const model = await openModel(root);
  assert.deepEqual([model.status, model.identity, model.paths], ['ready', plain.identity, plain.paths], 'the Atlas read with a candidate beside its records is the Atlas read without one');
  const print = await fingerprint(model);
  await put('trees/service/points/crew.md', record({ id: 'service-crew' }, 'Three crew sail every crossing', 'Edited in the candidate.'));
  assert.equal((await fingerprint(model)).key, print.key, 'an edit in the candidate is no change to the Atlas the Portal keeps');

  const shown = /300 metres|only the candidate|three crew|atlas-candidate/i;
  const portal = await startPortal(root, { timeZone: 'UTC' });
  t.after(() => portal.close());
  for (const address of ['/.atlas-candidate/', '/.atlas-candidate/atlas.json', '/.atlas-candidate/trees/service/points/fog.md', '/.atlas-candidate/notes.md', '/%2Eatlas-candidate/atlas.json', '/service-stray/', '/_/draft/.atlas-candidate/']) {
    assert.equal((await fetch(new URL(address, portal.url))).status, 404, address);
  }
  for (const address of ['', 'service-fog/', 'service-crew/', '_/search.json']) assert.doesNotMatch(await (await fetch(new URL(address, portal.url))).text(), shown, address);

  const out = path.join(workspace, 'site');
  await exportPortal(root, out, { all: true });
  assert.deepEqual(await listed(out), written(pages, facets), 'the export holds the Atlas and nothing of the candidate');
  for (const file of await listed(out)) assert.doesNotMatch(await fs.readFile(path.join(out, file), 'utf8'), shown, file);
  await assert.rejects(exportPortal(root, path.join(candidate, 'site'), { all: true }), { code: 'EXPORT_OVERLAP' }, 'nor is an export written into it');
});
