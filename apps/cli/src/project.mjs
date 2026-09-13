import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openWorkspace, openAtlas, localSourceTargets, prepareAtlasChange } from 'atlas-reference-validator';

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache']);
const comparePaths = (left, right) => {
  const a = Array.from(left), b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference) return difference;
  }
  return a.length - b.length;
};
export function fail(message, code = 'atlas.launch.invalid-input') {
  throw Object.assign(new Error(message), { code });
}
export function exactSelection(value) {
  if (typeof value !== 'string' || (value !== '.' && (!value || value.startsWith('/') || /[\\\x00-\x1f]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')))) fail('Atlas selection must be an exact project-relative path.');
  return value;
}
function canonicalSelection(repositoryRoot, atlasPath) {
  exactSelection(atlasPath);
  let current = repositoryRoot;
  for (const part of atlasPath === '.' ? [] : atlasPath.split('/')) {
    if (!fs.existsSync(current)) break;
    const entries = fs.readdirSync(current);
    if (!entries.includes(part) && entries.some(name => name.normalize('NFC').toLowerCase() === part.normalize('NFC').toLowerCase())) fail('Atlas selection differs in case or normalization.');
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Atlas selection must use real directories without symbolic links.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { repositoryRoot, atlasPath, atlasRoot: path.join(repositoryRoot, atlasPath) };
}

/** Discover project selections without parsing a second Atlas format or writing files. */
export function discoverProject(project = '.', atlasPath) {
  const repositoryRoot = fs.realpathSync(path.resolve(project));
  if (!fs.statSync(repositoryRoot).isDirectory()) fail('PROJECT must identify a directory.');
  const configFile = path.join(repositoryRoot, 'atlas.workspace.json');
  let configured = false;
  try { fs.lstatSync(configFile); configured = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (configured) {
    // Validate through the public workspace before resolving a possibly absent collection.
    const workspace = openWorkspace({ repositoryRoot, atlasPath: '.' });
    const info = { ...workspace.info };
    workspace.close();
    const bytes = fs.readFileSync(configFile);
    if (createHash('sha256').update(bytes).digest('hex') !== info.configurationSourceDigest) fail('Workspace configuration changed during discovery. Retry.', 'atlas.workspace.configuration-changed');
    const value = JSON.parse(bytes.toString('utf8'));
    const selection = { ...canonicalSelection(repositoryRoot, atlasPath ?? value.atlasPath), configuration: info.configuration,
      configurationSourceDigest: info.configurationSourceDigest };
    return { repositoryRoot, source: atlasPath === undefined ? 'workspace' : 'explicit', selections: [selection] };
  }
  if (atlasPath !== undefined) return { repositoryRoot, source: 'explicit', selections: [canonicalSelection(repositoryRoot, atlasPath)] };
  const selections = [];
  let visited = 0;
  function visit(directory, relative, depth) {
    if (++visited > 10000 || depth > 64) fail('Project discovery exceeded its bound. Select a collection with --atlas PATH.', 'atlas.launch.discovery-limit');
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name));
    if (entries.some(entry => entry.name === 'atlas.md' && entry.isFile())) {
      selections.push(canonicalSelection(repositoryRoot, relative));
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && !excluded.has(entry.name)) {
      visit(path.join(directory, entry.name), relative === '.' ? entry.name : `${relative}/${entry.name}`, depth + 1);
    }
  }
  visit(repositoryRoot, '.', 0);
  return { repositoryRoot, source: 'discovery', selections };
}

export function userDataRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Atlas');
  if (platform === 'linux') return path.join(env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share'), 'atlas');
  fail(`Atlas bundles do not support ${platform}.`);
}
export function managedState(selection, surface = 'editor', options) {
  const key = createHash('sha256').update(JSON.stringify([selection.repositoryRoot, selection.atlasPath])).digest('hex');
  return path.join(userDataRoot(options), 'projects', key, surface);
}
function destinationIdentity(selected) {
  let current = path.resolve(selected);
  const missing = [];
  while (!fs.existsSync(current)) { missing.unshift(path.basename(current)); current = path.dirname(current); }
  return path.join(fs.realpathSync(current), ...missing);
}
export function requireExternalStorage(directory) {
  if (!process.env.ATLAS_LAUNCHER) return;
  const installation = path.dirname(path.dirname(fs.realpathSync(process.env.ATLAS_LAUNCHER)));
  const inside = (parent, child) => parent === child || child.startsWith(`${parent}${path.sep}`);
  const canonical = destinationIdentity(directory);
  if (inside(installation, canonical) || inside(canonical, installation)) fail('Application state and cache must be separate from the product installation.');
}
export function requireSeparateDirectories(first, second, message) {
  const a = destinationIdentity(first), b = destinationIdentity(second);
  if (a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`)) fail(message);
}
export function prepareCache(selection, selected, protectedDirectories = []) {
  const fallback = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'Atlas')
    : path.join(process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME) ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache'), 'atlas');
  const directory = path.resolve(selected ?? fallback);
  requireExternalStorage(directory);
  for (const protectedDirectory of [userDataRoot(), ...protectedDirectories]) requireSeparateDirectories(directory, protectedDirectory, 'Disposable cache must be separate from durable application state and export destinations.');
  const within = (parent, child) => parent === child || child.startsWith(`${parent}${path.sep}`);
  if (within(selection.repositoryRoot, directory) || within(directory, selection.repositoryRoot)) fail('Cache storage must be separate from the project.');
  let mayCreate = true;
  if (fs.existsSync(path.join(selection.atlasRoot, 'atlas.md'))) {
    const view = openAtlas(selection.atlasRoot);
    if (localSourceTargets(view).some(target => within(target, directory) || within(directory, target))) fail('Cache storage intersects a registered local source.');
    mayCreate = view.validation.complete && view.freshness().status === 'fresh';
  }
  let ancestor = directory;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!fs.statSync(ancestor).isDirectory() || fs.realpathSync(ancestor) !== ancestor) fail('Cache storage must use canonical directories without symbolic links.');
  if (mayCreate) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  else console.error('Source capture is incomplete or stale. Cache creation is deferred; restart after repairing source to enable export. Existing draft recovery remains available.');
  process.env.TMPDIR = directory;
  return directory;
}
export function newSelection(repositoryRoot, atlasPath = 'atlas') { return canonicalSelection(repositoryRoot, atlasPath); }
export function prepareInitialization(selection, { id = 'project', title = 'Project Atlas' } = {}) {
  if (typeof title !== 'string' || !title.trim() || /[\r\n]/u.test(title)) fail('The title must be one nonblank line.');
  return prepareAtlasChange({ repositoryRoot: selection.repositoryRoot, atlasPath: selection.atlasPath,
    expected: { atlasMissing: true }, operations: [{ type: 'initialize', fields: { id }, body: `# ${title}\n\nProject context and its sources.\n` }] });
}
