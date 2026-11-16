// The Portal as a static export: the same pages the local service serves, written as files.
// An export holds the accounts it was asked for and nothing of the others, links only among
// its own pages, and carries a marker that lets a later export take its place.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openModel, sourceStates, searchIndex, searchModule, stateHome, isPrivateStatePath } from './model.mjs';
import { homePage, helpPage, pointPage, facetPage } from './pages.mjs';

const MARKER = '_/export.json';
const FORMAT = 'atlas.export/2';
/** Every path an export writes has one of these shapes; a marker that lists anything else is not ours. */
const WRITTEN = /^(?:index\.html|[a-z0-9][a-z0-9-]{0,99}\/index\.html|_\/(?:facet\/[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9][a-z0-9-]{0,99}\/index\.html|help\/index\.html|sheet\.css|reader\.js|search\.js|search\.json|export\.json))$/;
/** The folder that holds the Portal's `apps/`: a source checkout's root, or an installed package's root. */
const applicationRoot = fileURLToPath(new URL('../../../', import.meta.url));
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const overlaps = (left, right) => inside(left, right) || inside(right, left);
const failure = (code, message, more = {}) => Object.assign(new Error(message), { code, ...more });

/** Where a path leads once the links on the way to it are followed, whether or not it exists yet. */
async function intended(value) {
  let ancestor = path.resolve(value);
  const missing = [];
  while (true) {
    try { return path.join(await fs.realpath(ancestor), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT' || ancestor === path.dirname(ancestor)) throw error;
      missing.push(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}

/**
 * The folders of the application itself, told by what the folder that holds `apps/` contains. A source checkout keeps
 * its workspace file there, which no installed package ships: its code is `apps/` and `library/`, and a folder that
 * holds them holds the code, while its other folders, such as its ignored `tmp/`, are not the application. An installed
 * package, whatever it is called, is the application as a whole, and so is the bundle around it when it runs from one,
 * with its own runtime beside it.
 */
async function applicationFolders() {
  const application = await fs.realpath(applicationRoot);
  if (await fs.access(path.join(application, 'pnpm-workspace.yaml')).then(() => true, () => false)) return ['apps', 'library'].map(folder => path.join(application, folder));
  const folders = [application];
  if (path.dirname(await fs.realpath(process.execPath)) === path.join(path.dirname(application), 'runtime')) folders.push(path.dirname(application));
  return folders;
}

/** The files a previous export wrote into `out`; null when `out` does not exist. Anything else there is refused. */
async function previousExport(out) {
  try { await fs.lstat(out); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const refuse = () => failure('EXPORT_EXISTS', `${out} exists and is not an Atlas export. Choose a new folder, or the folder of a previous export.`);
  let marker;
  try { marker = JSON.parse(await fs.readFile(path.join(out, MARKER), 'utf8')); } catch { throw refuse(); }
  if (marker?.format !== FORMAT || !Array.isArray(marker.files) || marker.files.some(file => typeof file !== 'string' || !WRITTEN.test(file))) throw refuse();
  return marker.files;
}

/**
 * Write the Portal for the Atlas at `root` into the folder `out`.
 *
 * `trees`: the IDs of the accounts to export, or `all: true` for every account. One of the two is required.
 * `sourceBase`: the URL at which the Atlas root can be browsed; local sources then link to it.
 * `allowedRoots`: absolute directories cited local sources may be read from, besides the Atlas root,
 * to see how they stand against what was checked.
 *
 * `out` must not exist, or must be a previous export, whose files are then replaced as a whole.
 * Returns `{ format, atlas, identity, trees, sourceBase, status: 'complete', output, points, facets, replaced }`:
 * what the marker records, where it was written, and how many Point and Facet pages it holds.
 */
export async function exportPortal(root, out, options = {}) {
  const unknown = Object.keys(options).filter(name => !['trees', 'all', 'sourceBase', 'allowedRoots'].includes(name));
  if (unknown.length) throw failure('INVALID_REQUEST', `An export has no option ${unknown.join(', ')}.`);
  const { trees, all = false, sourceBase, allowedRoots } = options;
  if (allowedRoots !== undefined && (!Array.isArray(allowedRoots) || allowedRoots.length > 99 || allowedRoots.some(item => typeof item !== 'string' || !path.isAbsolute(item)))) throw failure('INVALID_REQUEST', 'Source grants must be at most 99 absolute directories.');
  const chosen = Array.isArray(trees) && trees.length > 0 && trees.every(id => typeof id === 'string') && new Set(trees).size === trees.length;
  if (all !== true && all !== false || trees !== undefined && !chosen || chosen === all) throw failure('SELECTION_REQUIRED', 'Name the Trees to export, or ask for all of them, not both.');
  let base = null;
  if (sourceBase !== undefined) {
    try { base = new URL(sourceBase); } catch { /* Refused below. */ }
    if (!base || !['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw failure('INVALID_SOURCE_BASE', 'The source base must be an HTTP(S) URL without credentials.');
    base.search = base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    base = base.href;
  }
  root = await fs.realpath(path.resolve(root));
  out = await intended(out);
  if (overlaps(root, out)) throw failure('EXPORT_OVERLAP', 'The export must be outside the Atlas.');
  if (await isPrivateStatePath(out) || inside(out, await intended(stateHome()))) throw failure('EXPORT_OVERLAP', "The export must be outside Atlas's private state.");
  if ((await applicationFolders()).some(folder => overlaps(folder, out))) throw failure('EXPORT_OVERLAP', 'The export must be outside the Atlas application.');
  const previous = await previousExport(out);

  const model = await openModel(root, { ...(all ? {} : { trees }), sourceBase: base });
  if (model.status === 'absent') throw failure('INVALID_ATLAS', `No Atlas is kept in ${root}.`);
  if (model.status !== 'ready') throw failure('INVALID_ATLAS', 'This Atlas does not validate, so it has no pages to export.', { diagnostics: model.diagnostics });
  const atlas = model.atlas;

  const files = new Map([['index.html', homePage(model)]]);
  // How every written record's sources stand, from the stale report asked about those records.
  const written = [...atlas.points.values(), ...atlas.facets.values()];
  const states = new Map((await sourceStates(model, written, { allowedRoots: [...new Set([root, ...(allowedRoots ?? [])])] })).map((found, index) => [written[index], found]));
  for (const point of atlas.points.values()) files.set(`${point.id}/index.html`, pointPage(model, point.id, { states: states.get(point) }));
  for (const facet of atlas.facets.values()) files.set(`_/facet/${facet.account}/${facet.id}/index.html`, facetPage(model, facet.key, { states: states.get(facet) }));
  files.set('_/help/index.html', helpPage(model));
  files.set('_/sheet.css', await fs.readFile(new URL('../assets/sheet.css', import.meta.url)));
  files.set('_/reader.js', await fs.readFile(new URL('../assets/reader.js', import.meta.url)));
  files.set('_/search.js', await fs.readFile(searchModule));
  files.set('_/search.json', JSON.stringify(searchIndex(model)));
  const record = { format: FORMAT, atlas: atlas.id, identity: model.identity, trees: [...atlas.accounts.keys()], sourceBase: base };
  files.set(MARKER, `${JSON.stringify({ ...record, files: [...files.keys(), MARKER].sort() }, null, 2)}\n`);

  // Everything is written beside the destination first, so a failure leaves the destination as it was.
  await fs.mkdir(path.dirname(out), { recursive: true });
  const staging = path.join(path.dirname(out), `.atlas-export-${randomUUID()}`);
  try {
    for (const [file, content] of files) {
      await fs.mkdir(path.dirname(path.join(staging, file)), { recursive: true });
      await fs.writeFile(path.join(staging, file), content);
    }
    if (previous) {
      const old = new Set(previous);
      for (const file of files.keys()) {
        for (let name = file; name !== '.'; name = path.dirname(name)) {
          const held = await fs.lstat(path.join(out, name)).catch(() => null);
          if (held && (name === file ? !old.has(name) : !held.isDirectory())) throw failure('EXPORT_CONFLICT', `${path.join(out, name)} was not written by the previous export. Move it, or choose a new folder.`);
        }
      }
    } else await fs.mkdir(out);
    try {
      for (const file of previous ?? []) await fs.rm(path.join(out, file), { force: true });
      const folders = new Set();
      for (const file of previous ?? []) for (let folder = path.dirname(file); folder !== '.'; folder = path.dirname(folder)) folders.add(folder);
      for (const folder of [...folders].sort((left, right) => right.length - left.length)) await fs.rmdir(path.join(out, folder)).catch(error => { if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error; });
      for (const file of files.keys()) {
        await fs.mkdir(path.dirname(path.join(out, file)), { recursive: true });
        await fs.rename(path.join(staging, file), path.join(out, file));
      }
    } catch (error) { throw failure('EXPORT_PARTIAL', `The export was interrupted; inspect ${out}. ${error.message}`); }
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  return { ...record, status: 'complete', output: out, points: atlas.points.size, facets: atlas.facets.size, replaced: Boolean(previous) };
}
