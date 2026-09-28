import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseStrictJson } from '../../../library/src/frontmatter.mjs';

const excluded = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'tmp', 'temp']);
const failure = (code, message) => Object.assign(new Error(message), { code });
const invalid = message => { throw failure('PROJECT_INVALID', message); };
const discoveries = new WeakMap();
const directoryIdentity = stat => `${stat.dev}:${stat.ino}`;
const changed = () => { throw failure('PROJECT_CHANGED', 'Project or Atlas selection changed; retry opening.'); };

async function entries(directory, limit = 20000) {
  const result = [];
  for await (const entry of await fs.opendir(directory)) {
    result.push(entry);
    if (result.length > limit) throw failure('PROJECT_DISCOVERY_LIMIT', 'Directory exceeds the discovery entry limit.');
  }
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function selection(value) {
  if (value === '.') return value;
  if (typeof value !== 'string' || !value || value.normalize('NFC') !== value || /[\\:\x00-\x1f\x7f]/u.test(value) || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) invalid('Atlas selection must be an exact project-relative path, or .');
  return value;
}

async function exactDirectory(project, relative) {
  let current = project;
  for (const part of relative === '.' ? [] : relative.split('/')) {
    if (!(await entries(current)).some(entry => entry.name === part)) invalid(`Atlas directory does not exist with exact spelling: ${relative}`);
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid('Atlas selection must stay inside the project without symlinks.');
  }
  return current;
}

async function workspace(project) {
  const names = (await entries(project)).map(entry => entry.name);
  const aliases = names.filter(name => name.toLowerCase() === 'atlas.workspace.json');
  if (!aliases.length) return null;
  if (aliases.length !== 1 || aliases[0] !== 'atlas.workspace.json') invalid('Use the exact filename atlas.workspace.json.');
  const file = path.join(project, aliases[0]);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) invalid('Workspace selection must be a regular JSON file of at most 64 KiB.');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 64 * 1024) invalid('Workspace selection must be a bounded regular file.');
    const buffer = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    bytes = buffer.subarray(0, size);
    const after = await handle.stat(), current = await fs.lstat(file);
    if (current.isSymbolicLink() || before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw failure('PROJECT_CHANGED', 'Workspace selection changed while reading; retry opening.');
  } finally { await handle.close(); }
  if (bytes.length > 64 * 1024) invalid('Workspace selection exceeds 64 KiB.');
  let value;
  try { value = parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { invalid('Workspace selection must contain strict UTF-8 JSON.'); }
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !['format', 'atlasPath'].includes(key)) || value.format !== 1) invalid('Workspace selection requires format: 1 and atlasPath; other fields are unsupported.');
  return { atlasPath: selection(value.atlasPath), identity: createHash('sha256').update(bytes).digest('hex') };
}

/** Discover project-contained collections without writing or following symlinks. */
export async function discoverProject(directory, { atlasPath, maxEntries = 20000, maxDepth = 12 } = {}) {
  const project = await fs.realpath(path.resolve(directory));
  const projectStat = await fs.stat(project);
  if (!projectStat.isDirectory()) invalid('Project must be a directory.');
  const configured = await workspace(project);
  const chosen = atlasPath === undefined ? configured?.atlasPath : selection(atlasPath);
  const candidateIdentities = new Map();
  async function finish(result) {
    const record = { project, identity: directoryIdentity(projectStat), workspace: configured?.identity, candidates: candidateIdentities };
    await verifyProject(record);
    discoveries.set(result, record);
    return result;
  }
  if (chosen !== null && chosen !== undefined) {
    const root = await exactDirectory(project, chosen);
    candidateIdentities.set(chosen, directoryIdentity(await fs.stat(root)));
    return finish({ format: 'atlas.project/1', project, source: atlasPath === undefined ? 'workspace' : 'explicit', candidates: [{ path: chosen, root }] });
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 0) invalid('Invalid discovery bounds.');
  const candidates = [];
  let visited = 0;
  async function walk(relative, depth) {
    const directory = path.join(project, relative);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('PROJECT_CHANGED', 'A project directory changed during discovery.');
    const children = await entries(directory, maxEntries - visited);
    visited += children.length;
    if (visited > maxEntries) throw failure('PROJECT_DISCOVERY_LIMIT', 'Discovery exceeded its entry limit. Select the Atlas with --atlas PATH.');
    const roots = children.filter(entry => entry.name.toLowerCase() === 'atlas.json');
    if (roots.length) {
      if (roots.length !== 1 || roots[0].name !== 'atlas.json' || !roots[0].isFile()) invalid(`Unsafe or incorrectly spelled atlas.json in ${relative || '.'}.`);
      candidates.push({ path: relative || '.', root: path.join(project, relative) });
      candidateIdentities.set(relative || '.', directoryIdentity(stat));
      return;
    }
    for (const entry of children) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      if (depth >= maxDepth) throw failure('PROJECT_DISCOVERY_LIMIT', 'Discovery exceeded its depth limit. Select the Atlas with --atlas PATH.');
      await walk(relative ? `${relative}/${entry.name}` : entry.name, depth + 1);
    }
  }
  await walk('', 0);
  if (!candidates.length) candidateIdentities.set('.', directoryIdentity(projectStat));
  return finish({ format: 'atlas.project/1', project, source: 'discovery', candidates, visited });
}

async function verifyProject(record) {
  if (await fs.realpath(record.project) !== record.project || directoryIdentity(await fs.stat(record.project)) !== record.identity) changed();
  if ((await workspace(record.project))?.identity !== record.workspace) changed();
}

/** Recheck the selected directories and configuration after a possible user choice. */
export async function verifySelection(discovery, selected) {
  const record = discoveries.get(discovery);
  if (!record || !record.candidates.has(selected.path)) invalid('Selection does not belong to this discovery.');
  await verifyProject(record);
  const root = await exactDirectory(record.project, selected.path);
  if (selected.root !== root || await fs.realpath(root) !== root || directoryIdentity(await fs.stat(root)) !== record.candidates.get(selected.path)) changed();
  return { path: selected.path, root, create: !(await entries(root)).some(entry => entry.name.toLowerCase() === 'atlas.json') };
}

export async function chooseAtlas(discovery, { input = process.stdin, output = process.stderr } = {}) {
  if (discovery.candidates.length === 1) return discovery.candidates[0];
  if (!discovery.candidates.length) return { path: '.', root: discovery.project, create: true };
  if (!input.isTTY || !output.isTTY) throw failure('PROJECT_AMBIGUOUS', `Choose an Atlas with --atlas PATH: ${discovery.candidates.map(candidate => candidate.path).join(', ')}`);
  output.write(`Choose an Atlas:\n${discovery.candidates.map((candidate, index) => `${index + 1}. ${candidate.path}`).join('\n')}\n`);
  const reader = createInterface({ input, output });
  try {
    const answer = await reader.question('Selection: ');
    if (!/^[1-9][0-9]*$/.test(answer) || Number(answer) > discovery.candidates.length) invalid('Choose one listed number, or relaunch with --atlas PATH.');
    return discovery.candidates[Number(answer) - 1];
  } finally { reader.close(); }
}

export async function launchBrowser(url) {
  const destination = new URL(url);
  if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1') invalid('The browser launcher accepts only the local Atlas service.');
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    const timer = setTimeout(() => { child.unref(); resolve('requested'); }, 2000);
    child.once('error', () => { clearTimeout(timer); resolve('unavailable'); });
    child.once('exit', code => { clearTimeout(timer); resolve(code === 0 ? 'requested' : 'unavailable'); });
  });
}
