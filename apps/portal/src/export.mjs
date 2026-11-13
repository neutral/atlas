import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openAtlas } from '../../../library/src/model.mjs';
import { preparePublication, readPublicationSources } from '../../../library/src/publication.mjs';
import { isPrivateStatePath, stateHome } from '../../../library/src/state.mjs';
import { presentAtlas, renderMarkdown } from './markdown.mjs';

const assets = fileURLToPath(new URL('../public/', import.meta.url));
const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const failure = (code, message) => Object.assign(new Error(message), { code });
const preparedExports = new WeakMap();
const mono = 'ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace';
// A published Markdown source on the Portal's sheet: the cited text in black, its address and the raw-text link in blue.
const sourcePageStyle = `:root{color-scheme:light}body{max-width:40rem;margin:0 auto;padding:2rem 1.5rem 3rem;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;color:#15191e;background:#fff}body>p:first-child{margin:0 0 1.5rem;padding-bottom:.6rem;font:12px/1.5 ${mono};color:#3d6288;overflow-wrap:anywhere;border-bottom:1px solid #3d6288}a{color:inherit;text-decoration:underline 1px #b9cadb;text-underline-offset:3px}a:hover{text-decoration-color:currentColor}a:focus-visible{outline:2px solid #3d6288;outline-offset:2px}h1,h2,h3{line-height:1.25}code{font-family:${mono};font-size:.88em}pre{overflow:auto;padding:.5rem .75rem;font:13px/1.55 ${mono};border:1px solid #b9cadb}table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse}td,th{padding:.25rem .5rem;text-align:left;vertical-align:top;border:1px solid #b9cadb}blockquote{margin-left:0;padding-left:.75rem;border-left:1px solid #5a7a9b}.unavailable-reference{text-decoration:underline dotted #5a7a9b;text-underline-offset:3px}.image-reference{font:.85em ${mono};color:#3d6288}::selection{background:#edf2f7}`;

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

async function inspectExport(root, output, { trees, points, sources, includeStyle, allowedRoots } = {}) {
  root = await fs.realpath(path.resolve(root));
  output = await intendedPath(output);
  if (inside(root, output) || inside(output, root)) throw failure('EXPORT_OVERLAP', 'Publication output must be separate from the Atlas.');
  if (await isPrivateStatePath(output) || inside(output, await intendedPath(stateHome()))) throw failure('EXPORT_OVERLAP', 'Publication output must be separate from private Atlas state.');
  try { await fs.lstat(output); throw failure('EXPORT_EXISTS', 'Choose a new output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const view = await openAtlas(root);
  const publication = preparePublication(view, { trees, ...(includeStyle === undefined ? {} : { includeStyle }), ...(points === undefined ? {} : { points }), ...(sources === undefined ? {} : { sources }) });
  if (publication.status !== 'ready') throw failure('INVALID_PUBLICATION', publication.diagnostics.map(item => item.message).join(' ') || 'A valid Atlas and explicit selection are required.');
  if ((await protectedPaths(view)).some(target => inside(target, output) || inside(output, target))) {
    throw failure('EXPORT_OVERLAP', 'Publication output must be separate from the application and every declared local source.');
  }
  const observed = publication.selection.sources.length ? await readPublicationSources(view, publication, { allowedRoots: allowedRoots?.length ? allowedRoots : [root] }) : [];
  const selected = new Set(publication.atlas.points.filter(point => point.publicationAvailable).map(point => point.id));
  const pointPaths = view.atlas.points.filter(point => selected.has(point.id)).map(({ id, tree, path }) => ({ id, tree, path }));
  const facetPaths = view.atlas.facets.filter(facet => publication.atlas.facets.some(item => item.id === facet.id && item.tree === facet.tree)).map(({ id, tree, path }) => ({ id, tree, path }));
  const publishedAtlas = structuredClone(publication.atlas);
  const sourceResults = [];
  const sourceFiles = [];
  for (const observation of observed) {
    let filename, htmlFilename;
    if (observation.status === 'ready') {
      filename = `sources/${createHash('sha256').update(observation.uri).digest('hex')}.txt`;
      sourceFiles.push({ path: filename, content: observation.content });
      if (/\.md(?:#|$)/i.test(observation.uri)) {
        htmlFilename = filename.replace(/\.txt$/, '.html');
        const escapedUri = observation.uri.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Published source</title><style>${sourcePageStyle}</style></head><body><p>${escapedUri} · <a href="${path.posix.basename(filename)}">Raw source</a></p>${renderMarkdown(observation.content, { headingPrefix: 'source-' })}</body></html>`;
        sourceFiles.push({ path: htmlFilename, content: html });
      }
      for (const record of [...publishedAtlas.points, ...publishedAtlas.facets]) for (const source of record.sources ?? []) {
        if (source.uri === observation.uri) { source.publishedPath = filename; if (htmlFilename) source.publishedHtmlPath = htmlFilename; }
      }
    }
    sourceResults.push({ uri: observation.uri, status: observation.status, ...(filename ? { path: filename, ...(htmlFilename ? { htmlPath: htmlFilename } : {}), sha256: observation.sha256 } : { message: observation.message }) });
  }
  const data = presentAtlas({ ...view, atlas: publishedAtlas }, { editable: false, pointPaths, facetPaths });
  data.publication = { selection: publication.selection, exclusions: publication.exclusions, sources: sourceResults };
  const excludedTargets = publication.atlas.facets.flatMap(facet => facet.targetAvailability.filter(target => target.availability !== 'included').map(target => ({ facet: facet.id, tree: facet.via, target })));
  const summary = { format: 'atlas.export-preview/1', status: 'ready', output, identity: view.identity,
    selection: publication.selection, excludedTargets, sources: sourceResults,
    counts: { trees: publication.atlas.trees.length, points: selected.size, facets: publication.atlas.facets.length, sources: sourceResults.filter(source => source.status === 'ready').length } };
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
    // The publication's first page is rendered now, from the selected data, so it reads before any script runs.
    const { renderPortal } = await import(pathToFileURL(path.join(assets, 'prerender.mjs')).href);
    const page = await renderPortal(data, true);
    html = html.replace(/<div id="root">[\s\S]*?<\/div><!--\/root-->/u, () => `<div id="root">${page}</div><!--/root-->`);
    html = html.replace('<body>', '<body data-mode="publication">');
    html = html.replace('<meta name="viewport"', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n  <meta name="viewport"');
    await fs.writeFile(path.join(temporary, 'index.html'), html);
    // The reader's bundled third-party code travels with its license texts.
    for (const file of ['app.js', 'style.css', 'licenses.txt']) await fs.copyFile(path.join(assets, file), path.join(temporary, file));
    await fs.copyFile(new URL('../../../library/src/search.mjs', import.meta.url), path.join(temporary, 'search.js'));
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
