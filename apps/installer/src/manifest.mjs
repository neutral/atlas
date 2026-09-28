import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 4096 && value.normalize('NFC') === value &&
    !/[\\\x00-\x1f\x7f:]/.test(value) && !path.posix.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
}
async function installedBin(root, relative) {
  if (!/(?:^|\/)node_modules\/\.bin\/[^/]+$/.test(relative)) return false;
  const absolute = path.join(root, relative), target = await fs.realpath(absolute);
  if (!target.startsWith(path.resolve(root) + path.sep)) return false;
  let directory = path.dirname(target);
  while (directory.startsWith(path.resolve(root) + path.sep)) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      const bins = typeof metadata.bin === 'string' ? { [metadata.name.split('/').at(-1)]: metadata.bin } : metadata.bin ?? {};
      return Object.entries(bins).some(([name, file]) => name === path.basename(relative) && path.resolve(directory, file) === target);
    } catch (error) { if (error.code !== 'ENOENT') return false; }
    directory = path.dirname(directory);
  }
  return false;
}
export async function inventory(root, { installed = false } = {}) {
  const files = [];
  async function walk(relative = '') {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => order(a.name, b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (installed && entry.isSymbolicLink() && await installedBin(root, name)) continue;
      if (!safeRelative(name) || entry.isSymbolicLink()) throw new Error(`Unsafe distribution path: ${name}`);
      if (name === 'manifest.json' || name === '.atlas-install.json') continue;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        if (files.length >= 100000) throw new Error('Distribution file count exceeds its bound.');
        const absolute = path.join(root, name), stat = await fs.stat(absolute);
        if (stat.size > 256 * 1024 * 1024) throw new Error(`Distribution file is too large: ${name}`);
        const mode = (stat.mode & 0o7777).toString(8);
        if (!['644', '755'].includes(mode)) throw new Error(`Unsupported distribution file mode ${mode}: ${name}`);
        files.push({ path: name, bytes: stat.size, sha256: digest(await fs.readFile(absolute)), mode });
      } else throw new Error(`Unsupported distribution entry: ${name}`);
    }
  }
  await walk();
  return files.sort((a, b) => order(a.path, b.path));
}
export async function writeManifest(root, metadata) {
  const value = { format: 'atlas.manifest/1', ...metadata, files: await inventory(root) };
  const manifest = { ...value, identity: digest(JSON.stringify(value)) };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.chmod(path.join(root, 'manifest.json'), 0o644);
  return manifest;
}
export async function verifyManifest(root, { installed = false } = {}) {
  const target = path.resolve(root);
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Distribution root must be a real directory.');
  const manifestPath = path.join(target, 'manifest.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 32 * 1024 * 1024 || (manifestStat.mode & 0o7777) !== 0o644) throw new Error('Manifest must be a bounded regular file with mode 0644.');
  const raw = await fs.readFile(manifestPath, 'utf8');
  if (Buffer.byteLength(raw) > 32 * 1024 * 1024) throw new Error('Manifest exceeds its bound.');
  const manifest = JSON.parse(raw), { identity, ...content } = manifest;
  if (manifest.format !== 'atlas.manifest/1' || !['package', 'bundle'].includes(manifest.kind) || !Array.isArray(manifest.files) || manifest.files.some(file => !safeRelative(file.path) || !['644', '755'].includes(file.mode)) || digest(JSON.stringify(content)) !== identity) throw new Error('Invalid distribution manifest.');
  const actual = await inventory(target, { installed });
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Distribution contents differ from their manifest.');
  return manifest;
}
