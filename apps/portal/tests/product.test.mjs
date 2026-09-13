import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyExport, prepareExport, publicationOptions, startPreview } from '../src/product.mjs';
import { buildBrowserAssets } from '../src/prebuild/build.mjs';

function project(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'Atlas export tests ')));
  const repositoryRoot = path.join(directory, 'Project with spaces');
  fs.cpSync(fileURLToPath(new URL('../../../spec/examples/valid/publication-profile', import.meta.url)), path.join(repositoryRoot, 'Atlas selection'), { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, repositoryRoot, atlasPath: 'Atlas selection', profileId: 'public', outputDirectory: path.join(directory, 'Exported site') };
}

test('publication preview is explicit, complete, and creates no destination', async t => {
  const options = project(t);
  assert.equal(publicationOptions(options).profiles[0].id, 'public');
  await assert.rejects(prepareExport({ ...options, profileId: undefined }), /Select a publication profile/u);
  await assert.rejects(prepareExport({ ...options, profileId: 'missing' }), /not found/u);
  const result = await prepareExport(options);
  assert.deepEqual(result.summary.profile.selection.resources, ['overview']);
  assert.deepEqual(result.summary.omittedChecks, ['review']);
  assert.equal(fs.existsSync(options.outputDirectory), false);
  assert.ok(result.summary.routes.includes('/resources/overview/'));
  assert.equal(result.summary.routes.some(route => route.includes('checks')), false);
});

test('export refuses changed source, source destinations, and existing directories', async t => {
  const options = project(t);
  await assert.rejects(prepareExport({ ...options, outputDirectory: path.join(options.repositoryRoot, options.atlasPath, 'output') }), /intersects/u);
  await assert.rejects(prepareExport({ ...options, outputDirectory: options.directory }), /intersects/u);
  fs.mkdirSync(options.outputDirectory);
  await assert.rejects(prepareExport(options), /already exists/u);
  fs.rmdirSync(options.outputDirectory);
  const prepared = await prepareExport(options);
  fs.appendFileSync(path.join(options.repositoryRoot, options.atlasPath, 'atlas.md'), '\nSource changed after review.\n');
  await assert.rejects(applyExport(prepared), /source changed after preview/u);
  assert.equal(fs.existsSync(options.outputDirectory), false);
});

test('prebuilt renderer exports real pages and assets outside installation with a loopback preview', async t => {
  const options = project(t);
  await buildBrowserAssets();
  const prepared = await prepareExport(options);
  await applyExport(prepared);
  const source = fs.readFileSync(path.join(options.outputDirectory, 'index.html'), 'utf8');
  assert.match(source, /Fixture Atlas/u);
  assert.doesNotMatch(source, /\/Users\/|file:\/\/|atlas-export-pending/u);
  assert.match(source, /href="\/_astro\/portal.css"/u);
  const script = /<script type="module" src="([^"]+)"/u.exec(source)?.[1];
  assert.ok(script?.startsWith('/_astro/'));
  const preview = await startPreview(options.outputDirectory);
  t.after(() => preview.close());
  assert.equal((await fetch(preview.url)).status, 200);
  assert.equal((await fetch(`${preview.origin}${script}`)).status, 200);
  assert.match(await (await fetch(`${preview.origin}/_astro/portal.css`)).text(), /\.portal-shell/u);
  assert.match(await (await fetch(`${preview.origin}/search/`)).text(), /atlas-search-data/u);
  assert.equal((await fetch(`${preview.origin}/.atlas-export-pending`)).status, 404);
  assert.equal((await fetch(preview.url, { method: 'POST' })).status, 404);
  await assert.rejects(applyExport(prepared), /already exists/u);
});

test('export excludes the whole installed bundle, direct Portal package, and aliased destinations', async t => {
  const options = project(t), previous = process.env.ATLAS_LAUNCHER;
  t.after(() => { if (previous === undefined) delete process.env.ATLAS_LAUNCHER; else process.env.ATLAS_LAUNCHER = previous; });
  delete process.env.ATLAS_LAUNCHER;
  const portalRoot = fileURLToPath(new URL('../', import.meta.url));
  await assert.rejects(prepareExport({ ...options, outputDirectory: path.join(portalRoot, 'new-export') }), /intersects/u);
  const installation = path.join(options.directory, 'Installed Atlas');
  fs.mkdirSync(path.join(installation, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(installation, 'bin', 'atlas'), 'launcher fixture');
  fs.symlinkSync(path.join(installation, 'bin', 'atlas'), path.join(options.directory, 'atlas-command'));
  process.env.ATLAS_LAUNCHER = path.join(options.directory, 'atlas-command');
  for (const relative of ['new-site', 'runtime/new-site', 'app/new-site', 'app/node_modules/atlas-editor/new-site']) {
    const destination = path.join(installation, relative);
    await assert.rejects(prepareExport({ ...options, outputDirectory: destination }), /intersects/u);
    assert.equal(fs.existsSync(destination), false);
  }
  const outside = path.join(options.directory, 'Outside'); fs.mkdirSync(outside);
  const alias = path.join(options.directory, 'Alias'); fs.symlinkSync(outside, alias);
  await assert.rejects(prepareExport({ ...options, outputDirectory: path.join(alias, 'site') }), /symbolic links/u);
  const dangling = path.join(options.directory, 'Dangling'); fs.symlinkSync(path.join(options.directory, 'missing'), dangling);
  await assert.rejects(prepareExport({ ...options, outputDirectory: dangling }), /already exists/u);
  assert.equal(fs.existsSync(path.join(outside, 'site')), false);
});

test('export preparation refuses a changed baseline rather than mixing selection observations', async t => {
  const options = project(t);
  const pending = prepareExport(options);
  fs.appendFileSync(path.join(options.repositoryRoot, options.atlasPath, 'atlas.md'), '\nConcurrent source edit during compilation.\n');
  await assert.rejects(pending, /changed during export preparation/u);
  assert.equal(fs.existsSync(options.outputDirectory), false);
});
