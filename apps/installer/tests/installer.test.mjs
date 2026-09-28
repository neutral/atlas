import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeManifest, verifyManifest } from '../src/manifest.mjs';
import { manageInstall, stageBundle } from '../src/manage.mjs';
import { tempDirectory } from '../../../tests/support/temp.mjs';

async function temporary(t) {
  const directory = await tempDirectory('atlas-installer-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function packageFixture(root, kind = 'package') {
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'entry.mjs'), 'export const version = 1;\n');
  return writeManifest(root, { kind, version: '1.0.0', ...(kind === 'bundle' ? { platform: process.platform, arch: process.arch, runtime: process.version } : {}) });
}

test('content manifests are deterministic and detect bytes, mode, extra files, and symlinks', async t => {
  const directory = await temporary(t), first = path.join(directory, 'first'), second = path.join(directory, 'second');
  const a = await packageFixture(first), b = await packageFixture(second);
  assert.equal(a.identity, b.identity);
  await fs.appendFile(path.join(first, 'entry.mjs'), '// changed\n');
  await assert.rejects(verifyManifest(first), /differ/);
  await fs.chmod(path.join(second, 'entry.mjs'), 0o755);
  await assert.rejects(verifyManifest(second), /differ/);
  await writeManifest(second, { kind: 'package', version: '1.0.0' });
  await fs.chmod(path.join(second, 'entry.mjs'), 0o654);
  await assert.rejects(verifyManifest(second), /mode 654/);
  await fs.chmod(path.join(second, 'entry.mjs'), 0o754);
  await assert.rejects(verifyManifest(second), /mode 754/);
  await fs.chmod(path.join(second, 'entry.mjs'), 0o644);
  await writeManifest(second, { kind: 'package', version: '1.0.0' });
  await fs.chmod(path.join(second, 'manifest.json'), 0o600);
  await assert.rejects(verifyManifest(second), /mode 0644/);
  await fs.chmod(path.join(second, 'manifest.json'), 0o644);
  await fs.writeFile(path.join(second, 'foreign.txt'), 'foreign');
  await assert.rejects(verifyManifest(second), /differ/);
  await fs.rm(path.join(second, 'foreign.txt'));
  await fs.symlink(path.join(first, 'entry.mjs'), path.join(second, 'alias'));
  await assert.rejects(verifyManifest(second), /Unsafe distribution/);
});

test('staging refuses a coherently changed source before replacing an installation', async t => {
  const directory = await temporary(t), bundle = path.join(directory, 'bundle'), target = path.join(directory, 'installed');
  const captured = await packageFixture(bundle, 'bundle');
  await manageInstall('install', target, { bundle });
  await fs.writeFile(path.join(bundle, 'entry.mjs'), 'export const version = 2;\n');
  await writeManifest(bundle, { kind: 'bundle', version: '2.0.0', platform: process.platform, arch: process.arch, runtime: process.version });
  await assert.rejects(stageBundle(bundle, directory, captured), /Bundle changed/);
  assert.equal((await verifyManifest(target)).identity, captured.identity);
  assert.equal((await fs.readdir(directory)).some(entry => entry.startsWith('.atlas-install-')), false);
});

test('installed npm bin links are accepted only when a contained package declares that exact target', async t => {
  const directory = await temporary(t), root = path.join(directory, 'package');
  await fs.mkdir(path.join(root, 'node_modules/example/bin'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ name: 'example', version: '1.0.0', bin: { example: 'bin/tool.mjs' } }));
  await fs.writeFile(path.join(root, 'node_modules/example/bin/tool.mjs'), 'export {};\n');
  await writeManifest(root, { kind: 'package', version: '1.0.0' });
  await fs.mkdir(path.join(root, 'node_modules/.bin'));
  const link = path.join(root, 'node_modules/.bin/example');
  await fs.symlink('../example/bin/tool.mjs', link);
  await verifyManifest(root, { installed: true });
  await assert.rejects(verifyManifest(root), /Unsafe distribution/);
  await fs.rm(link); await fs.writeFile(path.join(directory, 'outside.mjs'), 'outside');
  await fs.symlink(path.join(directory, 'outside.mjs'), link);
  await assert.rejects(verifyManifest(root, { installed: true }), /Unsafe distribution/);
});

test('install helpers refuse ordinary data, modified installs, path overlap, and marker aliases', async t => {
  const directory = await temporary(t), bundle = path.join(directory, 'bundle'), target = path.join(directory, 'installed'), data = path.join(directory, 'data');
  await packageFixture(bundle, 'bundle'); await fs.mkdir(data); await fs.writeFile(path.join(data, 'atlas.json'), 'user Atlas');
  await assert.rejects(manageInstall('install', data, { bundle }), /already exists/);
  await assert.rejects(manageInstall('remove', data, { bundle }));
  await assert.rejects(manageInstall('install', path.join(bundle, 'nested'), { bundle }), /overlap/);
  await manageInstall('install', target, { bundle });
  await fs.appendFile(path.join(target, 'entry.mjs'), '// foreign edit\n');
  await assert.rejects(manageInstall('update', target, { bundle }), /differ/);
  await assert.rejects(manageInstall('remove', target, { bundle }), /differ/);
  await fs.writeFile(path.join(target, 'entry.mjs'), 'export const version = 1;\n');
  await fs.rename(path.join(target, '.atlas-install.json'), path.join(directory, 'marker.json'));
  await fs.symlink(path.join(directory, 'marker.json'), path.join(target, '.atlas-install.json'));
  await assert.rejects(manageInstall('remove', target, { bundle }), /bounded regular file/);
  assert.equal(await fs.readFile(path.join(data, 'atlas.json'), 'utf8'), 'user Atlas');
});
