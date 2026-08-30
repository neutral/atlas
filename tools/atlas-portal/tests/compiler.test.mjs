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
const crossMapFixture = path.join(repositoryRoot, 'spec/examples/valid/cross-map');

test('compiler projects one explicit publication profile', async () => {
  const corpus = await compileAtlasPortal({
    atlasDirectory: publicationFixture,
    profileId: 'public',
  });

  assert.equal(corpus.contract, 'neutral.atlas-portal/1');
  assert.deepEqual(corpus.counts, {
    maps: 1,
    areas: 1,
    points: 1,
    pointRecords: 1,
    resources: 1,
    checks: 1,
  });
  assert.equal(corpus.atlas.title, 'Fixture Atlas');
  assert.deepEqual(corpus.points[0].records.map((record) => record.path), ['maps/one/points/service-boundary.md']);
  assert.equal(corpus.resources[0].body.includes('selected for publication'), true);
  assert.deepEqual(corpus.searchItems.find((item) => item.type === 'point').mapTitles, ['One']);
  assert.equal(new Set(corpus.routes.map((route) => route.path)).size, corpus.routes.length);
  assert.equal(JSON.stringify(corpus).includes(repositoryRoot), false);
});

test('compiler rejects an unknown publication profile', async () => {
  await assert.rejects(
    compileAtlasPortal({ atlasDirectory: publicationFixture, profileId: 'missing' }),
    /Publication profile not found: missing/u,
  );
});

test('context-only selection does not expose relations from an unselected anchor', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-partial-'));
  fs.cpSync(crossMapFixture, workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, '.publication'));
  fs.writeFileSync(path.join(workspace, '.publication/context-only.md'), `---
type: publication
id: context-only
title: Context-only fixture
summary: Select one context record and one related anchor without the context Point anchor.
selection:
  atlas: true
  maps:
  - operations
  points:
    edge-authentication:
    - operations
    rotate-edge-keys:
    - operations
  resources:
  - authentication-guide
  checks: []
---

# Context-only fixture

This profile exercises partial Point selection.
`);
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const corpus = await compileAtlasPortal({ atlasDirectory: workspace, profileId: 'context-only' });
  const edge = corpus.points.find((point) => point.id === 'edge-authentication');
  const rotation = corpus.points.find((point) => point.id === 'rotate-edge-keys');
  assert.equal(edge.title, 'edge-authentication');
  assert.deepEqual(edge.relations, []);
  assert.deepEqual(edge.incomingRelations.map((relation) => relation.sourcePoint), ['rotate-edge-keys']);
  assert.deepEqual(rotation.incomingRelations, []);
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
  const searchSource = fs.readFileSync(path.join(applicationRoot, 'src/browser/search.js'), 'utf8');
  for (const label of ['Anchor', 'Context contribution', 'Primary perspective', 'Context from this Map']) {
    assert.equal(readerSource.includes(label), false, `Reader Panel exposes ${label}`);
    assert.equal(contextSource.includes(label), false, `Context Panel exposes ${label}`);
  }
  for (const source of [readerSource, contextSource, searchSource]) {
    assert.equal(/\bsubjects?\b/iu.test(source), false, 'Portal aliases Point as Subject');
  }
  for (const source of [readerSource, contextSource, navigationSource]) {
    assert.equal(source.includes('Perspectives'), false, 'Portal aliases Maps as Perspectives');
    assert.equal(source.includes('>Policy<'), false, 'Portal aliases Checks as Policy');
    assert.equal(source.includes('/policy/'), false, 'Portal exposes a Policy route instead of a Check route');
  }
  assert.equal(readerSource.includes('<p class="question">{currentArea.question}</p>'), false);
  assert.equal(readerSource.includes('Areas of attention'), false);
  assert.equal(readerSource.includes('Points in this Area'), true);
  assert.equal(contextSource.includes('<h2>Area question</h2>'), true);
  assert.equal(contextSource.includes('<h2>Generation</h2>'), false);
  assert.equal(navigationSource.includes('corpus.profile'), false);
});

test('Astro builds a complete static reader from the fixture', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-build-'));
  const sourceDirectory = path.join(workspace, 'atlas');
  const outputDirectory = path.join(workspace, 'site');
  fs.cpSync(publicationFixture, sourceDirectory, { recursive: true });
  fs.appendFileSync(path.join(sourceDirectory, 'docs/overview.md'), '\n\n</script><script>globalThis.portalLeak = true</script>\n');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [
    path.join(applicationRoot, 'src/cli/index.mjs'),
    'build',
    '--atlas', sourceDirectory,
    '--profile', 'public',
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
  const checkIndexPage = fs.readFileSync(path.join(outputDirectory, 'checks/index.html'), 'utf8');
  const notFoundPage = fs.readFileSync(path.join(outputDirectory, '404.html'), 'utf8');
  const cloudflareHeaders = fs.readFileSync(path.join(outputDirectory, '_headers'), 'utf8');
  assert.match(rootPage, /Navigation Panel/u);
  assert.match(rootPage, /Reader Panel/u);
  assert.match(rootPage, /Context Panel/u);
  assert.equal(rootPage.includes('Questions this Atlas can answer'), false);
  assert.match(mapPage, />Areas</u);
  assert.match(areaPage, /Points in this Area/u);
  assert.equal(areaPage.includes('How subjects affect this question'), false);
  assert.match(pointPage, /Service boundary/u);
  assert.match(resourcePage, /selected for publication/u);
  assert.match(checkIndexPage, /Checks that govern changes/u);
  assert.equal(checkIndexPage.includes('active · required'), false);
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
