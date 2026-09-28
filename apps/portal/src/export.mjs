import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openAtlas } from '../../../library/src/model.mjs';
import { preparePublication, readPublicationSources } from '../../../library/src/publication.mjs';
import { isPrivateStatePath, stateHome } from '../../../library/src/state.mjs';
import { presentAtlas } from './markdown.mjs';

const assets = fileURLToPath(new URL('../public/', import.meta.url));
const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const failure = (code, message) => Object.assign(new Error(message), { code });
const preparedExports = new WeakMap();

async function intendedPath(value) {
  const absolute = path.resolve(value);
  let ancestor = absolute;
  const missing = [];
  while (true) {
    try { return path.join(await fs.realpath(ancestor), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (ancestor === path.dirname(ancestor)) throw error;
      missing.push(path.basename(ancestor)); ancestor = path.dirname(ancestor);
    }
  }
}

async function protectedPaths(view) {
  const roots = [view.root, await fs.realpath(applicationRoot)];
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.name === '@neutral/atlas') {
    const installed = await fs.realpath(packageRoot);
    roots.push(installed);
    const bundle = path.dirname(installed);
    if (path.dirname(await fs.realpath(process.execPath)) === path.join(bundle, 'runtime')) roots.push(bundle);
  }
  for (const record of [...view.atlas.points, ...view.atlas.facets]) {
    for (const source of record.sources ?? []) {
      if (/^https?:/i.test(source.uri)) continue;
      roots.push(await intendedPath(path.resolve(view.root, decodeURIComponent(source.uri.split('#')[0]))));
    }
  }
  return roots;
}

async function inspectExport(root, output, { trees, points, sources, allowedRoots } = {}) {
  root = await fs.realpath(path.resolve(root));
  output = await intendedPath(output);
  if (inside(root, output) || inside(output, root)) throw failure('EXPORT_OVERLAP', 'Publication output must be separate from the Atlas.');
  if (await isPrivateStatePath(output) || inside(output, await intendedPath(stateHome()))) throw failure('EXPORT_OVERLAP', 'Publication output must be separate from private Atlas state.');
  try { await fs.lstat(output); throw failure('EXPORT_EXISTS', 'Choose a new output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const view = await openAtlas(root);
  const publication = preparePublication(view, { trees, ...(points === undefined ? {} : { points }), ...(sources === undefined ? {} : { sources }) });
  if (publication.status !== 'ready') throw failure('INVALID_PUBLICATION', publication.diagnostics.map(item => item.message).join(' ') || 'A valid Atlas and explicit selection are required.');
  if ((await protectedPaths(view)).some(target => inside(target, output) || inside(output, target))) {
    throw failure('EXPORT_OVERLAP', 'Publication output must be separate from the application and every declared local source.');
  }
  const observed = publication.selection.sources.length ? await readPublicationSources(view, publication, { allowedRoots: allowedRoots?.length ? allowedRoots : [root] }) : [];
  const selected = new Set(publication.atlas.points.filter(point => point.publicationAvailable).map(point => point.id));
  const pointPaths = view.atlas.points.filter(point => selected.has(point.id)).map(({ id, tree, path }) => ({ id, tree, path }));
  const facetPaths = view.atlas.facets.filter(facet => publication.atlas.facets.some(item => item.id === facet.id && item.tree === facet.tree)).map(({ id, tree, path }) => ({ id, tree, path }));
  const data = presentAtlas({ ...view, atlas: publication.atlas }, { editable: false, pointPaths, facetPaths });
  const sourceResults = [];
  const sourceFiles = [];
  for (const observation of observed) {
    let filename;
    if (observation.status === 'ready') {
      filename = `sources/${createHash('sha256').update(observation.uri).digest('hex')}.txt`;
      sourceFiles.push({ path: filename, content: observation.content });
      for (const record of [...data.atlas.points, ...data.atlas.facets]) for (const source of record.sources ?? []) {
        if (source.uri === observation.uri) source.publishedPath = filename;
      }
    }
    sourceResults.push({ uri: observation.uri, status: observation.status, ...(filename ? { path: filename, sha256: observation.sha256 } : { message: observation.message }) });
  }
  data.publication = { selection: publication.selection, exclusions: publication.exclusions, sources: sourceResults };
  const excludedTargets = publication.atlas.facets.flatMap(facet => facet.targetAvailability.filter(target => target.availability !== 'included').map(target => ({ facet: facet.id, tree: facet.via, target })));
  const summary = { format: 'atlas.export-preview/1', status: 'ready', output, identity: view.identity,
    selection: publication.selection, excludedTargets, sources: sourceResults,
    counts: { trees: publication.atlas.trees.length, points: selected.size, facets: publication.atlas.facets.length, sources: sourceFiles.length } };
  return { root, output, data, sourceFiles, summary };
}

function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Review selection and observed source bytes without creating output. */
export async function prepareExport(root, output, options = {}) {
  const capturedOptions = structuredClone(options);
  const captured = await inspectExport(root, output, capturedOptions);
  const prepared = freeze(structuredClone(captured.summary));
  preparedExports.set(prepared, { ...captured, options: capturedOptions });
  return prepared;
}

/** Build only the exact prepared observation into the fixed, still-new destination. */
export async function applyExport(prepared) {
  const captured = preparedExports.get(prepared);
  if (!captured) throw failure('INVALID_EXPORT', 'Prepare an export before building it. A preview can be built only once.');
  preparedExports.delete(prepared);
  const current = await inspectExport(captured.root, captured.output, captured.options);
  if (current.summary.identity !== prepared.identity || current.output !== prepared.output ||
      JSON.stringify(current.summary.sources) !== JSON.stringify(prepared.sources)) {
    throw failure('EXPORT_STALE', 'Atlas records or selected sources changed after preview. Review a new preview.');
  }
  const { output, data, sourceFiles } = captured;
  const parent = path.dirname(output);
  await fs.mkdir(parent, { recursive: true });
  const temporary = path.join(parent, `.atlas-export-${randomUUID()}`);
  await fs.mkdir(temporary);
  try {
    let html = await fs.readFile(path.join(assets, 'index.html'), 'utf8');
    html = html.replace('<body>', '<body data-mode="publication">');
    html = html.replace('<meta name="viewport"', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n  <meta name="viewport"');
    await fs.writeFile(path.join(temporary, 'index.html'), html);
    for (const file of ['app.js', 'style.css']) await fs.copyFile(path.join(assets, file), path.join(temporary, file));
    await fs.writeFile(path.join(temporary, 'data.json'), JSON.stringify(data));
    await fs.writeFile(path.join(temporary, 'selection.json'), JSON.stringify({ format: 'atlas.export-selection/1', identity: prepared.identity, ...data.publication }, null, 2) + '\n');
    if (sourceFiles.length) {
      await fs.mkdir(path.join(temporary, 'sources'));
      for (const file of sourceFiles) await fs.writeFile(path.join(temporary, file.path), file.content);
    }
    // Refuse a destination created while preparing the export.
    await fs.mkdir(output);
    try {
      for (const name of await fs.readdir(temporary)) await fs.rename(path.join(temporary, name), path.join(output, name));
    } catch (error) { throw failure('EXPORT_PARTIAL', `Export was interrupted; inspect ${output}. ${error.message}`); }
    return { ...prepared, format: 'atlas.export/1', status: 'complete' };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

/** One-step command adapter over the same preparation and guarded build. */
export async function exportPortal(root, output, options = {}) {
  return applyExport(await prepareExport(root, output, options));
}
