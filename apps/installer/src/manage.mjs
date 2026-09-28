import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyManifest } from './manifest.mjs';

const marker = '.atlas-install.json';
const contains = (outer, inner) => inner === outer || inner.startsWith(outer + path.sep);
async function realDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('An install path must be a real directory.');
  return fs.realpath(directory);
}
async function managed(target) {
  target = await realDirectory(target);
  const statePath = path.join(target, marker), stat = await fs.lstat(statePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Installation marker must be a bounded regular file.');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const manifest = await verifyManifest(target);
  if (state.format !== 'atlas.install/1' || state.identity !== manifest.identity || manifest.kind !== 'bundle') throw new Error('Target is not a verified Atlas installation.');
  return { target, state, manifest };
}
async function copy(source, target) {
  for (const entry of await fs.readdir(source)) {
    if (entry !== marker) await fs.cp(path.join(source, entry), path.join(target, entry), { recursive: true, force: false, errorOnExist: true });
  }
}

export async function stageBundle(source, parent, expected) {
  const staged = await fs.mkdtemp(path.join(parent, '.atlas-install-'));
  try {
    await copy(source, staged);
    const captured = await verifyManifest(staged);
    if (captured.identity !== expected.identity || captured.platform !== expected.platform || captured.arch !== expected.arch) throw new Error('Bundle changed while preparing installation.');
    return staged;
  } catch (error) {
    await fs.rm(staged, { recursive: true, force: true });
    throw error;
  }
}

/** Manage one selected install directory; Atlas data is never an install target. */
export async function manageInstall(action, target, { bundle = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  if (!['install', 'update', 'remove'].includes(action)) throw new Error('Action must be install, update, or remove.');
  target = path.resolve(target);
  const parent = await realDirectory(path.dirname(target));
  target = path.join(parent, path.basename(target));
  if (target === path.parse(target).root || path.basename(target).startsWith('.atlas-')) throw new Error('Unsafe installation target.');
  let existing;
  if (action !== 'install') existing = await managed(target);
  if (action === 'remove') {
    const moved = path.join(parent, `.atlas-remove-${randomUUID()}`);
    await fs.rename(target, moved);
    try { await managed(moved); await fs.rm(moved, { recursive: true }); }
    catch (error) {
      await fs.rename(moved, target).catch(() => {});
      throw error;
    }
    return { format: 'atlas.install-result/1', status: 'removed', target, identity: existing.manifest.identity };
  }
  bundle = await realDirectory(bundle);
  const manifest = await verifyManifest(bundle);
  if (manifest.kind !== 'bundle' || manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Bundle does not match this platform and architecture.');
  if (contains(bundle, target) || contains(target, bundle)) throw new Error('Bundle and installation directories must not overlap.');
  if (action === 'install') {
    try { await fs.lstat(target); throw new Error('Install target already exists. Use update only for a verified installation.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const staged = await stageBundle(bundle, parent, manifest);
  let backup;
  try {
    await fs.writeFile(path.join(staged, marker), JSON.stringify({ format: 'atlas.install/1', identity: manifest.identity, installedAt: new Date().toISOString() }, null, 2) + '\n');
    if (existing) {
      await managed(target);
      backup = path.join(parent, `.atlas-previous-${randomUUID()}`);
      await fs.rename(target, backup);
    }
    try { await fs.rename(staged, target); }
    catch (error) { if (backup) await fs.rename(backup, target); throw error; }
    if (backup) {
      try { await managed(backup); await fs.rm(backup, { recursive: true }); }
      catch { return { format: 'atlas.install-result/1', status: 'updated', target, identity: manifest.identity, retainedPrevious: backup }; }
    }
    return { format: 'atlas.install-result/1', status: action === 'install' ? 'installed' : 'updated', target, identity: manifest.identity };
  } finally { await fs.rm(staged, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, target, ...rest] = process.argv.slice(2);
    if (!target || rest.length) throw new Error('Usage: atlas-manage install|update|remove TARGET');
    console.log(JSON.stringify(await manageInstall(action, target), null, 2));
  } catch (error) { console.error(JSON.stringify({ status: 'refused', message: error.message })); process.exitCode = 1; }
}
