import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const MAX_BYTES = 32 * 1024 * 1024;

function defaultHome() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Atlas');
  if (process.platform === 'win32') return path.join(path.isAbsolute(process.env.LOCALAPPDATA ?? '') ? process.env.LOCALAPPDATA : path.join(os.homedir(), 'AppData', 'Local'), 'Atlas');
  return path.join(path.isAbsolute(process.env.XDG_STATE_HOME ?? '') ? process.env.XDG_STATE_HOME : path.join(os.homedir(), '.local', 'state'), 'atlas');
}

export function stateHome() {
  const configured = process.env.ATLAS_STATE_HOME;
  if (configured !== undefined && (!configured || !path.isAbsolute(configured))) throw fail('INVALID_STATE_HOME', 'ATLAS_STATE_HOME must be an absolute directory.');
  return path.resolve(configured ?? defaultHome());
}

export async function isPrivateStatePath(target) {
  let home = stateHome();
  try { home = await fs.realpath(home); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const key = value => path.resolve(value).normalize('NFC').toLocaleLowerCase('en');
  return inside(key(home), key(target));
}

async function canonicalRoot(root) {
  const absolute = path.resolve(root);
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_PATH', 'Atlas root must be a regular directory.');
  return fs.realpath(absolute);
}

async function canonicalDestination(value) {
  let current = path.resolve(value);
  const missing = [];
  while (true) {
    try { return path.join(await fs.realpath(current), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function regularDirectories(directory, create) {
  const parsed = path.parse(directory);
  let current = parsed.root;
  for (const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (!create && error.code === 'ENOENT') return false; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_STATE', 'Private state requires regular directories without symbolic links.');
  }
  return true;
}

async function readRegular(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) throw fail('INVALID_STATE', 'State must be a bounded regular file.');
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_BYTES - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_BYTES) throw fail('INVALID_STATE', 'State exceeds its byte bound.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const signature = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    const after = await handle.stat({ bigint: true });
    const final = await fs.lstat(file, { bigint: true });
    if (signature(before) !== signature(after) || signature(after) !== signature(final)) throw fail('INVALID_STATE', 'State changed during inspection.');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

/** The state-home override is trusted launch configuration, never authored data. */
export async function resolveState(root, { create = false } = {}) {
  root = await canonicalRoot(root);
  const home = stateHome();
  const canonicalHome = await canonicalDestination(home);
  if (inside(root, canonicalHome)) throw fail('UNSAFE_STATE', 'Private state must be outside the Atlas.');
  const directory = path.join(home, 'atlases', hash(root));
  if (inside(root, path.join(canonicalHome, 'atlases', hash(root)))) throw fail('UNSAFE_STATE', 'Private state must be outside the Atlas.');
  const exists = await regularDirectories(directory, false);
  let owner;
  if (exists) {
    try { owner = JSON.parse((await readRegular(path.join(directory, 'owner.json'))).toString('utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (owner && (owner.format !== 'atlas.state/1' || owner.root !== root)) throw fail('STATE_OWNER', 'Private state belongs to another Atlas or has invalid ownership metadata.');
  }
  if (create && !owner) {
    if (exists && (await fs.readdir(directory)).length > 0) throw fail('STATE_OWNER', 'Private state contains unowned files and cannot be adopted.');
    await regularDirectories(directory, true);
    const proposed = { format: 'atlas.state/1', root };
    try {
      const handle = await fs.open(path.join(directory, 'owner.json'), 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(proposed) + '\n'); await handle.sync(); } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    owner = JSON.parse((await readRegular(path.join(directory, 'owner.json'))).toString('utf8'));
    if (owner.format !== 'atlas.state/1' || owner.root !== root) throw fail('STATE_OWNER', 'Private state belongs to another Atlas.');
  } else if (exists && !owner) {
    throw fail('STATE_OWNER', 'Private state is missing its ownership metadata.');
  }
  return { root, directory, exists: Boolean(owner), owner: owner ?? null };
}
