import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileAtlasPortal } from '../src/core/compile.mjs';
import { renderMarkdown, rewriteLocalResourceHref } from '../src/lib/markdown.mjs';

const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const publicationFixture = path.join(repositoryRoot, 'spec/examples/valid/publication-profile');
const portal = { name: 'Fixture Portal' };
const portalConfigPath = path.join(applicationRoot, 'tests/portal.json');
const crossMapFixture = path.join(repositoryRoot, 'spec/examples/valid/cross-map');

test('compiler projects one explicit publication profile', async () => {
  const corpus = await compileAtlasPortal({ portal,
    atlasDirectory: publicationFixture,
    profileId: 'public',
  });

  assert.equal(corpus.contract, 'neutral.atlas-portal/1');
  assert.equal(corpus.specificationRevision, '0.9.0');
  assert.deepEqual(corpus.portal, portal);
  assert.equal('checks' in corpus, false);
  assert.equal(corpus.routes.some((route) => route.path.startsWith('/checks/')), false);
  assert.deepEqual(corpus.counts, {
    maps: 1,
    areas: 1,
    points: 1,
    pointRecords: 1,
    resources: 1,
  });
  assert.equal(corpus.atlas.title, 'Fixture Atlas');
  assert.deepEqual(corpus.points[0].records.map((record) => record.path), ['maps/one/points/service-boundary.md']);
  assert.equal(corpus.resources[0].body.includes('selected for publication'), true);
  assert.deepEqual(corpus.searchItems.find((item) => item.type === 'point').mapTitles, ['One']);
  for (const [type, source] of [['map', corpus.maps[0]], ['area', corpus.areas[0]]]) {
    const result = corpus.searchItems.find((item) => item.type === type);
    assert.equal(result.summary, source.summary);
    assert.notEqual(result.summary, source.question);
    assert.ok(result.text.includes(source.question), `${type} questions remain searchable`);
    assert.ok(result.text.includes(source.summary), `${type} summaries remain searchable`);
  }
  assert.equal(new Set(corpus.routes.map((route) => route.path)).size, corpus.routes.length);
  assert.equal(JSON.stringify(corpus).includes(repositoryRoot), false);
});

test('compiler rejects an unknown publication profile', async () => {
  await assert.rejects(
    compileAtlasPortal({ portal, atlasDirectory: publicationFixture, profileId: 'missing' }),
    /Publication profile not found: missing/u,
  );
});

test('context-only selection does not expose relations from an unselected anchor', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-partial-'));
  fs.cpSync(crossMapFixture, workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, '.publication'));
  fs.writeFileSync(path.join(workspace, '.publication/context-only.md'), `---
${JSON.stringify({
  type: 'publication',
  id: 'context-only',
  selection: {
    atlas: true,
    maps: ['operations'],
    points: {
      'edge-authentication': ['operations'],
      'rotate-edge-keys': ['operations'],
    },
    resources: ['authentication-guide'],
    checks: [],
  },
}, null, 2)}
---

# Context-only fixture

Select one context record and one related anchor without the context Point anchor.
`);
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const corpus = await compileAtlasPortal({ portal, atlasDirectory: workspace, profileId: 'context-only' });
  const edge = corpus.points.find((point) => point.id === 'edge-authentication');
  const rotation = corpus.points.find((point) => point.id === 'rotate-edge-keys');
  assert.equal(edge.title, edge.records[0].title);
  assert.deepEqual(edge.relations, []);
  assert.deepEqual(edge.incomingRelations.map((relation) => relation.sourcePoint), ['rotate-edge-keys']);
  assert.deepEqual(rotation.incomingRelations, []);
  const outputDirectory = path.join(workspace, 'reader-site');
  const build = spawnSync(process.execPath, [
    path.join(applicationRoot, 'src/cli/index.mjs'), 'build',
    '--atlas', workspace, '--profile', 'context-only', '--portal-config', portalConfigPath, '--out-dir', outputDirectory,
  ], { cwd: applicationRoot, encoding: 'utf8' });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const page = fs.readFileSync(path.join(outputDirectory, 'points/edge-authentication/index.html'), 'utf8');
  assert.doesNotMatch(page, /<dt>Point identity<\/dt>/u);
  assert.equal(page.includes('<dt>Posture</dt>'), false);
  assert.equal(page.includes('<dt>Lifecycle</dt>'), false);
  assert.equal(page.includes('class="reader-footer"'), false);

});

test('Markdown resolves published local links and disables unavailable targets', () => {
  const sourceRoutes = new Map([['docs/overview.md', '/resources/overview/']]);
  assert.equal(
    rewriteLocalResourceHref('docs/overview.md#scope', { sourcePath: 'atlas.md', sourceRoutes }),
    '/resources/overview/#scope',
  );
  assert.equal(
    rewriteLocalResourceHref('../overview.md', { sourcePath: 'maps/one/map.md', sourceRoutes }),
    '../overview.md',
  );
  assert.match(
    renderMarkdown('[Overview](docs/overview.md)', { sourcePath: 'atlas.md', sourceRoutes }),
    /href="\/resources\/overview\/"/u,
  );
  const unavailable = renderMarkdown('[Missing](../missing.md)', { sourcePath: 'maps/one/map.md', sourceRoutes });
  assert.match(unavailable, /class="unavailable-local-link"/u);
  assert.equal(unavailable.includes('href='), false);
});

test('reader chrome uses Atlas terms without implementation mechanics', () => {
  const readerSource = fs.readFileSync(path.join(applicationRoot, 'src/components/ReaderPanel.astro'), 'utf8');
  const contextSource = fs.readFileSync(path.join(applicationRoot, 'src/components/ContextPanel.astro'), 'utf8');
  const navigationSource = fs.readFileSync(path.join(applicationRoot, 'src/components/NavigationPanel.astro'), 'utf8');
  const searchSource = fs.readFileSync(path.join(applicationRoot, 'src/browser/search.ts'), 'utf8');
  for (const label of ['Anchor', 'Context contribution', 'Primary perspective', 'Context from this Map']) {
    assert.equal(readerSource.includes(`>${label}<`), false, `Reader Panel exposes ${label}`);
    assert.equal(contextSource.includes(`>${label}<`), false, `Context Panel exposes ${label}`);
  }
  for (const source of [readerSource, contextSource, searchSource]) {
    assert.equal(/\bsubjects?\b/iu.test(source), false, 'Portal aliases Point as Subject');
  }
  for (const source of [readerSource, contextSource, navigationSource]) {
    assert.equal(source.includes('Perspectives'), false, 'Portal aliases Maps as Perspectives');
    assert.equal(source.includes('>Policy<'), false, 'Portal aliases Checks as Policy');
    assert.equal(source.includes('/policy/'), false, 'Portal exposes a Policy route instead of a Check route');
  }
  assert.equal(readerSource.includes('Areas of attention'), false);
  assert.equal(readerSource.includes('Points in this Area'), true);
  assert.equal(contextSource.includes('<h2>Generation</h2>'), false);
  assert.equal(navigationSource.includes('corpus.profile'), false);
});

test('Astro builds a complete static reader from the fixture', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-build-'));
  const sourceDirectory = path.join(workspace, 'atlas');
  const outputDirectory = path.join(workspace, 'site');
  fs.cpSync(publicationFixture, sourceDirectory, { recursive: true });
  const pointPath = path.join(sourceDirectory, 'maps/one/points/service-boundary.md');
  const pointSource = fs.readFileSync(pointPath, 'utf8');
  const pointMetadata = JSON.parse(pointSource.split('---')[1]);
  const connectionPath = path.join(sourceDirectory, 'connections.json');
  const connections = JSON.parse(fs.readFileSync(connectionPath, 'utf8'));
  connections.content ??= [];
  connections.content.push({ id: 'primary-overview', owner: { type: 'point', map: 'one', point: 'service-boundary' }, target: { resource: 'overview' } });
  const catalogPath = path.join(sourceDirectory, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const pointBody = pointSource.split('---').slice(2).join('---');
  fs.writeFileSync(pointPath, `---\n${JSON.stringify(pointMetadata)}\n---\n${pointBody}\n## Scope\n\nThe service boundary is fixed at the public API. [Other context](../../two/points/service-boundary.md#scope).\n`);
  const profilePath = path.join(sourceDirectory, '.publication/public.md');
  const profileMetadata = JSON.parse(fs.readFileSync(profilePath, 'utf8').split('---')[1]);
  fs.mkdirSync(path.join(sourceDirectory, 'maps/two'), { recursive: true });
  const otherMap = fs.readFileSync(path.join(sourceDirectory, 'maps/one/map.md'), 'utf8')
    .replace('"id": "one"', '"id": "two"').replace('# One', '# Two')
    .replace('What context belongs in the one fixture Map?', 'What other context belongs in a separate Map?');
  fs.writeFileSync(path.join(sourceDirectory, 'maps/two/map.md'), otherMap);
  catalog.areas.push(...catalog.areas.filter(area => area.map === 'one').map(area => ({ ...area, map: 'two' })));
  profileMetadata.selection.maps.push('two');
  fs.mkdirSync(path.join(sourceDirectory, 'maps/two/points'));
  const contextMetadata = {
    type: 'point', record: 'context', id: 'service-boundary',

  };
  fs.writeFileSync(path.join(sourceDirectory, 'maps/two/points/service-boundary.md'), `---\n${JSON.stringify(contextMetadata)}\n---\n\n# Service boundary in Two\n\nThe same service boundary has a separate consequence in Two.\n\n## Connection: second-scope\n\nThis boundary constrains the second Map scope.\n\n## Scope\n\nThe second Map keeps this boundary visible. [This section](#scope).\n`);
  profileMetadata.selection.points['service-boundary'].push('two');
  connections.memberships.push({ id: 'second-scope', point: 'service-boundary', map: 'two', area: 'scope' });
  connections.references ??= [];
  connections.references.push({ id: 'second-overview', owner: { type: 'point', map: 'two', point: 'service-boundary' }, target: { resource: 'overview' }, role: 'supporting' });

  for (let index = 2; index <= 18; index += 1) {
    const id = `boundary-${index}`;
    const metadata = { ...pointMetadata, id };
    const member = connections.memberships.find(item => item.point === 'service-boundary' && item.map === 'one');
    const memberId = `boundary-${index}-scope`;
    connections.memberships.push({ ...member, id: memberId, point: id });
    connections.content.push({ id: `boundary-${index}-overview`, owner: { type: 'point', map: 'one', point: id }, target: { resource: 'overview' } });
    fs.writeFileSync(path.join(sourceDirectory, `maps/one/points/${id}.md`), `---\n${JSON.stringify(metadata)}\n---\n${pointBody.replace('# Service boundary', `# Boundary ${index}`).replace(`Connection: ${member.id}`, `Connection: ${memberId}`)}\nBoundary ${index} remains selected.\n`);
    profileMetadata.selection.points[id] = ['one'];
  }
  fs.writeFileSync(connectionPath, JSON.stringify(connections, null, 2));
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  fs.writeFileSync(profilePath, `---\n${JSON.stringify(profileMetadata)}\n---\n\n# Public fixture\n\nSelect the reader exercise.\n`);
  fs.appendFileSync(path.join(sourceDirectory, 'atlas.md'), '\n\nFourth paragraph.\n\nFifth paragraph.\n\nRetained final Atlas paragraph.\n');
  fs.appendFileSync(path.join(sourceDirectory, 'docs/overview.md'), '\n\n## Resource uses\n\n[First record](../maps/one/points/service-boundary.md#scope).\n\n</script><script>globalThis.portalLeak = true</script>\n');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const corpus = await compileAtlasPortal({ portal, atlasDirectory: sourceDirectory, profileId: 'public' });
  const uses = corpus.resources.find((resource) => resource.id === 'overview').uses
    .filter((use) => use.source.pointId === 'service-boundary');
  assert.deepEqual(uses.map((use) => ({ map: use.source.mapId, path: use.source.recordPath, route: use.source.route })), [
    { map: 'one', path: 'maps/one/points/service-boundary.md', route: '/points/service-boundary/#record-0' },
    { map: 'two', path: 'maps/two/points/service-boundary.md', route: '/points/service-boundary/#record-1' },
  ]);

  const noticeConfigPath = path.join(workspace, 'portal.json');
  fs.writeFileSync(noticeConfigPath, JSON.stringify({
    ...portal,
    copyright: 'Copyright 2026 <Example> & Contributors',
    license: 'License: <script>globalThis.noticeLeak = true</script>',
  }));
  const result = spawnSync(process.execPath, [
    path.join(applicationRoot, 'src/cli/index.mjs'),
    'build',
    '--atlas', sourceDirectory,
    '--profile', 'public',
    '--portal-config', noticeConfigPath,
    '--out-dir', outputDirectory,
  ], {
    cwd: applicationRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const rootPage = fs.readFileSync(path.join(outputDirectory, 'index.html'), 'utf8');
  const mapPage = fs.readFileSync(path.join(outputDirectory, 'maps/one/index.html'), 'utf8');
  const areaPage = fs.readFileSync(path.join(outputDirectory, 'maps/one/areas/scope/index.html'), 'utf8');
  const pointPage = fs.readFileSync(path.join(outputDirectory, 'points/service-boundary/index.html'), 'utf8');
  const resourcePage = fs.readFileSync(path.join(outputDirectory, 'resources/overview/index.html'), 'utf8');
  const searchPage = fs.readFileSync(path.join(outputDirectory, 'search/index.html'), 'utf8');
  assert.equal(fs.existsSync(path.join(outputDirectory, 'checks')), false);
  const notFoundPage = fs.readFileSync(path.join(outputDirectory, '404.html'), 'utf8');
  const cloudflareHeaders = fs.readFileSync(path.join(outputDirectory, '_headers'), 'utf8');
  for (const page of [rootPage, mapPage, areaPage, pointPage, resourcePage, searchPage, notFoundPage]) {
    assert.match(page, /<dialog id="portal-help" class="help-dialog" aria-labelledby="portal-help-title" aria-describedby="portal-help-intro">/u);
    assert.equal((page.match(/data-open-help/g) ?? []).length, 2);
    const footer = page.match(/<footer\b[^>]*>(.*?)<\/footer>/u)?.[1];
    assert.ok(footer, 'Every destination includes the configured notices');
    assert.match(footer, /Copyright 2026 &lt;Example&gt; &amp; Contributors/u);
    assert.match(footer, /License: &lt;script&gt;globalThis.noticeLeak = true&lt;\/script&gt;/u);
    assert.equal(footer.includes('<script>'), false);
  }
  assert.match(rootPage, /Navigation Panel/u);
  assert.match(rootPage, /Reader Panel/u);
  assert.equal(rootPage.includes('Context Panel'), false);
  assert.match(rootPage, /aria-label="Breadcrumb"/u);
  assert.match(rootPage, /data-toggle-areas/u);
  assert.equal(rootPage.includes('Questions this Atlas can answer'), false);
  assert.match(mapPage, />Areas</u);
  assert.match(areaPage, /Points in this Area/u);
  assert.equal((areaPage.match(/class="connection-row"/gu) ?? []).length, 18);
  assert.match(areaPage, /Boundary 18/u);
  assert.equal((areaPage.match(/class="area-navigation-link active"/gu) ?? []).length, 1);
  assert.match(areaPage, /class="area-navigation-link" href="\/maps\/two\/areas\/scope\/"/u);
  assert.match(rootPage, /Other Maps/u);
  const mapMetadata = corpus.maps.find(map => map.id === 'one');
  assert.ok(rootPage.includes(mapMetadata.summary));
  assert.equal(rootPage.includes(mapMetadata.question), false);
  assert.ok(mapPage.includes(mapMetadata.areas[0].summary));
  assert.equal(mapPage.includes(mapMetadata.areas[0].question), true, 'About this Map retains the authored Markdown meaning.');
  for (const [page, question] of [[mapPage, mapMetadata.question], [areaPage, mapMetadata.areas[0].question]]) {
    assert.equal(page.includes(question), page === mapPage);
    assert.equal(page.includes('<summary>Scope</summary>'), false);
  }
  assert.match(resourcePage, /Boundary 18/u);
  assert.match(resourcePage, /href="\/points\/service-boundary\/#record-0" aria-label="Service boundary in One">Service boundary<\/a><p><span>In One · <\/span>Primary material/u);
  assert.match(resourcePage, /href="\/points\/service-boundary\/#record-1" aria-label="Service boundary in Two">Service boundary<\/a><p><span>In Two · <\/span>supporting/u);
  assert.match(pointPage, /id="record-0"/u);
  assert.match(pointPage, /id="record-1"/u);
  assert.match(pointPage, /id="record-0-content-scope"/u);
  assert.match(pointPage, /id="record-1-content-scope"/u);
  assert.match(pointPage, /href="\/points\/service-boundary\/#record-1-content-scope"/u);
  assert.match(pointPage, /href="#record-1-content-scope"/u);
  assert.match(resourcePage, /href="\/points\/service-boundary\/#record-0-content-scope"/u);
  assert.match(resourcePage, /id="content-resource-uses"/u);
  assert.equal((resourcePage.match(/id="resource-uses"/gu) ?? []).length, 1);
  assert.doesNotMatch(rootPage, /About this Atlas|Retained final Atlas paragraph/u);
  assert.match(mapPage, /About this Map/u);
  assert.doesNotMatch(pointPage, /<dt>Point identity<\/dt>/u);
  assert.equal(pointPage.includes('Record source'), false);
  assert.equal(pointPage.includes('maps/one/points/service-boundary.md'), false);
  assert.equal(areaPage.includes('How subjects affect this question'), false);
  assert.match(pointPage, /Service boundary/u);
  assert.match(resourcePage, /selected for publication/u);
  assert.equal(rootPage.includes('href="/checks/"'), false);
  assert.match(rootPage, /<h1>Fixture Portal<\/h1>/u);
  assert.match(rootPage, /<title>Fixture Portal<\/title>/u);
  assert.equal(rootPage.includes('Fixture Atlas'), false);
  assert.equal(rootPage.includes('Public fixture'), false);
  assert.equal(rootPage.includes('<h2>Generation</h2>'), false);
  assert.equal(pointPage.includes('<p>Anchor</p>'), false);
  assert.equal(pointPage.includes('Primary perspective:'), false);
  assert.equal(searchPage.includes('</script><script>globalThis.portalLeak'), false);
  assert.match(searchPage, /\\u003c\/script>/u);
  assert.match(notFoundPage, /Page not found/u);
  assert.match(cloudflareHeaders, /X-Content-Type-Options: nosniff/u);
  assert.match(cloudflareHeaders, /Cache-Control: public, max-age=31536000, immutable/u);
  assert.equal(`${rootPage}${pointPage}${resourcePage}`.includes(repositoryRoot), false);
});


test('long Resources retain readable bodies beyond the bounded search prefix', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-search-prefix-'));
  fs.cpSync(publicationFixture, workspace, { recursive: true });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.writeFileSync(path.join(workspace, 'docs/overview.md'), `# Overview\n\nindexed-prefix-marker ${'x'.repeat(120_000)} absent-tail-marker\n`);
  const corpus = await compileAtlasPortal({ portal, atlasDirectory: workspace, profileId: 'public' });
  const resource = corpus.resources.find((item) => item.id === 'overview');
  const search = corpus.searchItems.find((item) => item.id === 'resource:overview');
  assert.equal(search.text.length, 120_000);
  assert.match(search.text, /indexed-prefix-marker/u);
  assert.equal(search.text.includes('absent-tail-marker'), false);
  assert.match(resource.body, /absent-tail-marker/u);
});

test('Resource roots admit ordinary dot-prefixed names and require explicit outside access', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-resource-roots-'));
  const source = path.join(directory, 'source');
  fs.cpSync(publicationFixture, source, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(source, '..docs'));
  fs.writeFileSync(path.join(source, '..docs/overview.md'), 'Inside the Atlas root.');
  const atlasPath = path.join(source, 'catalog.json');
  const original = fs.readFileSync(atlasPath, 'utf8');
  fs.writeFileSync(atlasPath, original.replace('docs/overview.md', '..docs/overview.md'));
  const inside = await compileAtlasPortal({ atlasDirectory: source, profileId: 'public', portal });
  assert.equal(inside.resources[0].body, 'Inside the Atlas root.');
  fs.writeFileSync(path.join(directory, 'outside.md'), 'Explicitly authorized outside material.');
  fs.writeFileSync(atlasPath, original.replace('docs/overview.md', '../outside.md'));
  const denied = await compileAtlasPortal({ atlasDirectory: source, profileId: 'public', portal });
  assert.equal(denied.resources[0].availability, 'unavailable');
  assert.equal(denied.resources[0].body, null);
  const allowed = await compileAtlasPortal({ atlasDirectory: source, profileId: 'public', portal, resourceRoots: [directory] });
  assert.equal(allowed.resources[0].body, 'Explicitly authorized outside material.');
});

test('global publication projects full Resource prose without selecting its root or other Resources', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-global-publication-'));
  const source = path.join(workspace, 'atlas');
  fs.mkdirSync(path.join(source, '.publication'), { recursive: true });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const write = (file, header, body) => fs.writeFileSync(path.join(source, file), `---\n${JSON.stringify(header)}\n---\n${body}`);
  const selectedDescription = '\nPublished **description** has its own meaning.\n\n- First retained item.\n- Second retained item.\n\n```text\n## Resource: private\nLiteral example stays inside the selected description.\n```\n\n';
  write('atlas.md', { type: 'atlas', format: 2, id: 'logical-publication' },
    '# Root title\n\nroot-only-marker must stay with the root.\n\n## Resource: public\n' + selectedDescription
    + '## Resource: private\n\nprivate-description-marker must never appear in public output.\n');
  fs.writeFileSync(path.join(source, 'catalog.json'), JSON.stringify({ resources: [
    { id: 'public', uri: 'https://example.com/public', title: 'Public source' },
    { id: 'private', uri: 'https://example.com/private', title: 'private-label-marker' },
  ] }));
  fs.writeFileSync(path.join(source, 'connections.json'), '{}');
  const selection = { atlas: false, maps: [], points: {}, resources: ['public'], checks: [] };
  write('.publication/resource.md', { type: 'publication', id: 'resource', selection }, '# Resource only\n\nPublish the selected source and its explanation.\n');
  write('.publication/root.md', { type: 'publication', id: 'root', selection: { ...selection, atlas: true, resources: [] } }, '# Root only\n\nPublish the root without its Resource registrations.\n');
  const resourceOnly = await compileAtlasPortal({ portal, atlasDirectory: source, profileId: 'resource' });
  assert.equal(resourceOnly.resources[0].description, selectedDescription);
  assert.equal(resourceOnly.atlas.body, '');
  assert.doesNotMatch(JSON.stringify(resourceOnly), /root-only-marker|private-description-marker|private-label-marker/u);
  assert.match(resourceOnly.searchItems.find(item => item.id === 'resource:public').text, /First retained item/u);
  const rootOnly = await compileAtlasPortal({ portal, atlasDirectory: source, profileId: 'root' });
  assert.match(rootOnly.atlas.body, /root-only-marker/u);
  assert.doesNotMatch(JSON.stringify(rootOnly), /private-description-marker|private-label-marker|Published \*\*description\*\*/u);
  const output = path.join(workspace, 'site');
  const build = spawnSync(process.execPath, [path.join(applicationRoot, 'src/cli/index.mjs'), 'build',
    '--atlas', source, '--profile', 'resource', '--portal-config', portalConfigPath, '--out-dir', output],
  { cwd: applicationRoot, encoding: 'utf8' });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const resourcePage = fs.readFileSync(path.join(output, 'resources/public/index.html'), 'utf8');
  assert.match(resourcePage, /Published <strong>description<\/strong>/u);
  assert.match(resourcePage, /<li>First retained item\.<\/li>/u);
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? visit(file) : [file];
  });
  for (const file of visit(output).filter(file => /\.(?:html|json|js)$/u.test(file))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /root-only-marker|private-description-marker|private-label-marker/u, file);
  }
});
