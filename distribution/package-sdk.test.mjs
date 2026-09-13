import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sdkFiles } from './package-sdk.mjs';

test('the scoped npm application supplies internal runtime targets and public entrypoints', () => {
  const { files, version } = sdkFiles();
  const manifest = JSON.parse(files.get('package.json').contents);
  assert.equal(manifest.name, '@neutral/atlas');
  assert.equal(manifest.version, version);
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.repository.url, 'git+https://github.com/neutral/atlas.git');
  assert.equal(manifest.publishConfig.access, 'public');
  for (const relative of [manifest.types, manifest.exports['.'].default, ...Object.values(manifest.bin)]) {
    assert.ok(files.has(relative.replace(/^\.\//u, '')), relative);
  }
  for (const name of Object.keys(manifest.dependencies)) assert.doesNotMatch(manifest.dependencies[name], /workspace:/u, name);
  assert.match(files.get('src/atlas-cli.mjs').contents.toString(), /import\('\.\.\/apps\/editor\/src\/server\.mjs'\)/u);
  assert.match(files.get('src/atlas-cli.mjs').contents.toString(), /import\('\.\.\/apps\/portal\/src\/product\.mjs'\)/u);
  assert.match(files.get('apps/editor/src/worker.mjs').contents.toString(), /import\('\.\.\/\.\.\/portal\/src\/product\.mjs'\)/u);
  for (const relative of ['apps/editor/src/worker.mjs', 'apps/portal/src/product.mjs', 'apps/portal/src/core/compile.mjs']) {
    assert.doesNotMatch(files.get(relative).contents.toString(), /['"]atlas-reference-validator['"]/u, relative);
  }
  for (const asset of ['index.html', 'editor.js', 'editor.css']) assert.ok(files.has(`apps/editor/public/${asset}`));
  assert.doesNotMatch(files.get('README.md').contents.toString(), /SDK alone|no.*browser application|unpublished|source candidate/u);
});

test('npm assembly includes explicit prebuilt renderer bytes and their original notices', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-npm-assets-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => sdkFiles({ browserDirectory: directory }), /requires the prebuilt Portal renderer/u);
  fs.writeFileSync(path.join(directory, 'render.mjs'), 'export const prebuilt = true;\n');
  const { files } = sdkFiles({ browserDirectory: directory });
  assert.equal(files.get('apps/portal/prebuilt/render.mjs').contents.toString(), 'export const prebuilt = true;\n');
  for (const name of ['astro', '@lucide-astro']) assert.ok(files.get(`notices/${name}/LICENSE`).contents.length > 100);
});
