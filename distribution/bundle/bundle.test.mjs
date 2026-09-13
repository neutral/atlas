import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { archiveDirectory } from './archive.mjs';
import { defaultInstallPrefix } from './install.mjs';

test('archive preserves relative links and produces the same bytes after source timestamps change', t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-archive-test-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const source = path.join(work, 'Atlas with spaces');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'command'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.symlinkSync('command', path.join(source, 'alias'));
  archiveDirectory(source, path.join(work, 'one.tar.gz'));
  fs.utimesSync(path.join(source, 'command'), 123456789, 123456789);
  archiveDirectory(source, path.join(work, 'two.tar.gz'));
  assert.deepEqual(fs.readFileSync(path.join(work, 'one.tar.gz')), fs.readFileSync(path.join(work, 'two.tar.gz')));
  const unpacked = path.join(work, 'unpacked'); fs.mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', path.join(work, 'one.tar.gz'), '-C', unpacked]);
  assert.equal(fs.readlinkSync(path.join(unpacked, 'Atlas with spaces/alias')), 'command');
  assert.equal(fs.statSync(path.join(unpacked, 'Atlas with spaces/command')).mode & 0o777, 0o755);
});

test('installation and version selection preserve unrelated files and removal preserves durable state', t => {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-install-test-')));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const source = path.join(work, 'extracted source');
  const prefix = path.join(work, 'installation');
  const bin = path.join(work, 'command directory');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.copyFileSync(new URL('./install.mjs', import.meta.url), path.join(source, 'install.mjs'));
  fs.writeFileSync(path.join(source, 'bin/atlas'), 'fixture executable');
  const marker = { contract: 'atlas.bundle/1', version: '0.9.0', target: `${process.platform}-${process.arch}` };
  fs.writeFileSync(path.join(source, 'bundle.json'), JSON.stringify(marker));
  const args = ['--prefix', prefix, '--bin-directory', bin];
  const run = (...extra) => spawnSync(process.execPath, [path.join(source, 'install.mjs'), ...extra, ...args], { encoding: 'utf8' });
  fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'atlas'), 'unrelated command');
  assert.equal(run().status, 2);
  assert.equal(fs.readFileSync(path.join(bin, 'atlas'), 'utf8'), 'unrelated command');
  fs.unlinkSync(path.join(bin, 'atlas'));
  assert.equal(run().status, 0);
  assert.equal(run().status, 0, 'Exact installed version can be selected again.');
  assert.equal(fs.realpathSync(path.join(bin, 'atlas')), path.join(prefix, `atlas-0.9.0-${marker.target}/bin/atlas`));
  const durable = path.join(work, 'drafts'); fs.mkdirSync(durable); fs.writeFileSync(path.join(durable, 'unfinished'), 'keep');
  const installed = path.join(prefix, `atlas-0.9.0-${marker.target}`);
  assert.equal(spawnSync(process.execPath, [path.join(installed, 'install.mjs'), '--remove', ...args], { encoding: 'utf8' }).status, 0);
  assert.equal(fs.existsSync(installed), false);
  assert.equal(fs.existsSync(path.join(bin, 'atlas')), false);
  assert.equal(fs.readFileSync(path.join(durable, 'unfinished'), 'utf8'), 'keep');
  assert.equal(run('--remove').status, 2, 'A missing marker cannot authorize removal.');
});

test('a runtime-free launcher refuses relative runtime paths and a different target architecture', t => {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-runtime-selection-')));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  fs.mkdirSync(path.join(work, 'bin'));
  const launcher = path.join(work, 'bin/atlas');
  fs.copyFileSync(new URL('./launcher.sh', import.meta.url), launcher); fs.chmodSync(launcher, 0o755);
  fs.writeFileSync(path.join(work, 'payload.json'), JSON.stringify({ target: `${process.platform}-${process.arch === 'arm64' ? 'x64' : 'arm64'}` }));
  const relative = spawnSync(launcher, ['--help'], { env: { ...process.env, ATLAS_NODE: './node' }, encoding: 'utf8' });
  assert.equal(relative.status, 2); assert.match(relative.stderr, /absolute executable path/u);
  const otherTarget = spawnSync(launcher, ['--help'], { env: { ...process.env, ATLAS_NODE: process.execPath }, encoding: 'utf8' });
  assert.equal(otherTarget.status, 2); assert.match(otherTarget.stderr, /application payload requires/u);
});

test('relative XDG data paths cannot redirect installation into the current project', () => {
  assert.equal(defaultInstallPrefix({ platform: 'linux', home: '/user-home', xdgDataHome: 'project-data' }), '/user-home/.local/share/atlas/install');
  assert.equal(defaultInstallPrefix({ platform: 'linux', home: '/user-home', xdgDataHome: '/user-data' }), '/user-data/atlas/install');
  assert.equal(defaultInstallPrefix({ platform: 'darwin', home: '/user-home', xdgDataHome: '/user-data' }), '/user-home/Library/Application Support/Atlas/install');
});
