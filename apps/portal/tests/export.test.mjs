import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exportPortal, prepareExport, applyExport } from '../src/export.mjs';
import { stateHome } from '../../../library/src/state.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const example = path.join(repo, 'examples/offline-notes');
async function folder(t) {
  await fs.mkdir(path.join(repo, 'tmp/tests'), { recursive: true });
  const root = await fs.mkdtemp(path.join(repo, 'tmp/tests/export-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('static export includes chosen account and labels excluded targets without copying them', async t => {
  const root = await folder(t), output = path.join(root, 'site');
  const result = await exportPortal(example, output, { trees: ['product'], points: ['delivery-promise'] });
  assert.equal(result.status, 'complete');
  const data = JSON.parse(await fs.readFile(path.join(output, 'data.json')));
  assert.equal(data.editable, false);
  assert.deepEqual(data.atlas.trees.map(tree => tree.id), ['product']);
  assert.equal(data.atlas.points.filter(point => point.publicationAvailable).length, 1);
  assert.equal(data.atlas.points.find(point => point.id === 'product-purpose').body, undefined);
  assert.equal(data.atlas.points.find(point => point.id === 'product-purpose').title, undefined);
  assert(!JSON.stringify(data).includes('The trial did not test interrupted writes or delivery.'));
  assert.equal(data.atlas.points.find(point => point.id === 'delivery-promise').sources[0].publishedPath, undefined);
  assert(result.excludedTargets.length > 0);
  assert.deepEqual((await fs.readdir(output)).sort(), ['app.js', 'data.json', 'index.html', 'selection.json', 'style.css']);
  assert.match(await fs.readFile(path.join(output, 'index.html'), 'utf8'), /data-mode="publication"/u);
  await assert.rejects(exportPortal(example, output, { trees: ['product'] }), { code: 'EXPORT_EXISTS' });
});
test('source bytes need explicit selection and never pull unrelated private files', async t => {
  const root = await folder(t), copied = path.join(root, 'atlas');
  await fs.cp(example, copied, { recursive: true });
  await fs.writeFile(path.join(copied, 'private.txt'), 'PRIVATE CANARY');
  const result = await exportPortal(copied, path.join(root, 'site'), { trees: ['product'], sources: ['sources/brief.md'] });
  assert.equal(result.sources[0].status, 'ready');
  const content = await fs.readFile(path.join(root, 'site', result.sources[0].path), 'utf8');
  assert.match(content, /Fictional product brief/u);
  assert(!content.includes('PRIVATE CANARY'));
  await assert.rejects(exportPortal(copied, path.join(root, 'bad'), { trees: ['product'], sources: ['private.txt'] }), { code: 'INVALID_PUBLICATION' });
  await assert.rejects(exportPortal(copied, path.join(copied, 'site'), { trees: ['product'] }), { code: 'EXPORT_OVERLAP' });
});

test('export preview creates no output and refuses changed authored or selected source bytes', async t => {
  const root = await folder(t), copied = path.join(root, 'atlas'), output = path.join(root, 'not-created/site');
  await fs.cp(example, copied, { recursive: true });
  const options = { trees: ['product'], sources: ['sources/brief.md'] };
  const prepared = await prepareExport(copied, output, options);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.counts.sources, 1);
  await assert.rejects(fs.lstat(path.dirname(output)), { code: 'ENOENT' });
  assert.throws(() => prepared.selection.trees.push('architecture'), TypeError);
  await fs.appendFile(path.join(copied, 'sources/brief.md'), '\nChanged source.\n');
  await assert.rejects(applyExport(prepared), { code: 'EXPORT_STALE' });
  await assert.rejects(fs.lstat(path.dirname(output)), { code: 'ENOENT' });
  const second = await prepareExport(copied, output, options);
  await fs.appendFile(path.join(copied, 'trees/product/points/promise.md'), '\nChanged explanation.\n');
  await assert.rejects(applyExport(second), { code: 'EXPORT_STALE' });
  await assert.rejects(fs.lstat(path.dirname(output)), { code: 'ENOENT' });
  const final = await prepareExport(copied, output, options);
  options.trees.push('architecture');
  const result = await applyExport(final);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.selection.trees, ['product']);
  await assert.rejects(applyExport(final), { code: 'INVALID_EXPORT' });
  await assert.rejects(applyExport(structuredClone(final)), { code: 'INVALID_EXPORT' });
});
test('CLI export invokes the actual static adapter', async t => {
  const root = await folder(t), output = path.join(root, 'site');
  const command = spawnSync(process.execPath, ['apps/cli/src/cli.mjs', '--root', example, 'export', output, '-'], { cwd: repo, input: JSON.stringify({ trees: ['product'] }), encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr + command.stdout);
  assert.equal(JSON.parse(command.stdout).status, 'complete');
  assert.match(await fs.readFile(path.join(output, 'app.js'), 'utf8'), /renderTree/u);
});

test('export refuses unselected local source destinations before creating any output', async t => {
  const root = await folder(t), copied = path.join(root, 'atlas');
  await fs.cp(example, copied, { recursive: true });
  const point = path.join(copied, 'trees/product/points/promise.md');
  await fs.writeFile(point, (await fs.readFile(point, 'utf8')).replace('sources/brief.md', '../unselected%20source/future.md#evidence'));
  const source = path.join(root, 'unselected source');
  for (const output of [source, path.join(source, 'future.md'), path.join(source, 'future.md', 'site')]) {
    await assert.rejects(exportPortal(copied, output, { trees: ['architecture'] }), { code: 'EXPORT_OVERLAP' });
    await assert.rejects(fs.lstat(source), { code: 'ENOENT' });
  }
  await fs.mkdir(source);
  await fs.symlink(source, path.join(root, 'source-alias'));
  await fs.writeFile(point, (await fs.readFile(point, 'utf8')).replace('../unselected%20source/future.md#evidence', '../source-alias/future.md'));
  await assert.rejects(exportPortal(copied, path.join(source, 'future.md'), { trees: ['architecture'] }), { code: 'EXPORT_OVERLAP' });
  assert.deepEqual(await fs.readdir(source), []);
});

test('export refuses the application and installed package while allowing separate data output', async t => {
  await assert.rejects(exportPortal(example, path.join(repo, 'apps/portal/new-site'), { trees: ['product'] }), { code: 'EXPORT_OVERLAP' });
  const root = await folder(t), installed = path.join(root, 'package');
  await fs.mkdir(installed);
  await fs.writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: '@neutral/atlas', type: 'module' }));
  for (const folder of ['library/src', 'apps/portal/src']) {
    await fs.cp(path.join(repo, folder), path.join(installed, folder), { recursive: true });
  }
  const { exportPortal: installedExport } = await import(pathToFileURL(path.join(installed, 'apps/portal/src/export.mjs')).href);
  await assert.rejects(installedExport(example, path.join(installed, 'new-site'), { trees: ['product'] }), { code: 'EXPORT_OVERLAP' });
  await assert.rejects(fs.lstat(path.join(installed, 'new-site')), { code: 'ENOENT' });
});

test('export refuses output in the private state home without a source declaration', async () => {
  const output = path.join(stateHome(), 'unrelated-atlas', 'publication');
  await assert.rejects(prepareExport(example, output, { trees: ['product'] }), { code: 'EXPORT_OVERLAP' });
  await assert.rejects(fs.lstat(output), { code: 'ENOENT' });
});

test('published Markdown links resolve only to included Points', async t => {
  const root = await folder(t), copied = path.join(root, 'atlas');
  await fs.cp(example, copied, { recursive: true });
  await fs.appendFile(path.join(copied, 'trees/product/points/purpose.md'), '\nSee [offline work](offline.md) and [receipt details](trees/architecture/points/sync.md).\n');
  await fs.appendFile(path.join(copied, 'trees/product/facets/delivery.md'), '\nSee [wording](../points/promise.md).\n');
  await exportPortal(copied, path.join(root, 'site'), { trees: ['product'] });
  const data = JSON.parse(await fs.readFile(path.join(root, 'site/data.json')));
  const html = data.atlas.points.find(point => point.id === 'product-purpose').html;
  assert.match(html, /href="\?tree=product&amp;point=offline-work"/u);
  assert.match(html, /unavailable-reference/u);
  assert.match(data.atlas.facets.find(facet => facet.id === 'delivery-dependency').html, /href="\?tree=product&amp;point=delivery-promise"/u);
  assert(!JSON.stringify(data).includes('trees/architecture/points/sync.md"'));
});
