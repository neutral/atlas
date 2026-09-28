import { createHash } from 'node:crypto';
import { readSource, validateSource } from './model.mjs';

const copy = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
function requireValue(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.publication.invalid-argument' });
}
function object(value, fields) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Publication options must be an object.');
  requireValue(Object.keys(value).every((key) => fields.includes(key)), 'Unknown publication option.');
}
function list(value, label, validate) {
  requireValue(Array.isArray(value) && value.length <= 10000 && value.every(validate) && new Set(value).size === value.length, `${label} must be a bounded list of unique identities.`);
}
function reserved(uri) {
  if (/^https?:/i.test(uri)) return false;
  return decodeURIComponent(uri.split('#')[0]).replaceAll('\\', '/').split('/').some((part) => part.startsWith('.atlas-'));
}
function cleanRecord(record, selectedSources) {
  const result = copy(record);
  delete result.path;
  if (result.sources) result.sources = result.sources.map((source) => ({ ...source, publicationAvailable: selectedSources.has(source.uri) }));
  return result;
}

/** Select display data without expanding through Facets or source references. */
export function preparePublication(view, input) {
  object(input, ['trees', 'points', 'sources']);
  list(input.trees, 'trees', (value) => typeof value === 'string' && ID.test(value));
  requireValue(input.trees.length > 0, 'Publication requires at least one selected Tree.');
  if (input.points !== undefined) list(input.points, 'points', (value) => typeof value === 'string' && ID.test(value));
  if (input.sources !== undefined) list(input.sources, 'sources', (uri) => typeof uri === 'string' && uri.length <= 16384 && validateSource({ uri }).valid);
  const selection = { trees: [...input.trees], ...(input.points === undefined ? {} : { points: [...input.points] }), sources: [...(input.sources ?? [])] };
  const result = { format: 'atlas.publication/1', status: 'unavailable', identity: view?.identity ?? null, selection,
    atlas: null, sources: [], exclusions: {}, diagnostics: [],
    limits: ['Publication data contains the selected subset in atlas.publication-data/1 format.', 'Facet targets retain their references; inclusion follows the explicit selection.', 'Source availability records selection. Retrieval has its own result and requires separate reading grants.'] };
  if (view?.format !== 'atlas.view/1' || view.status !== 'ready' || !view.atlas) return { ...result, digest: hash(result) };
  const atlas = view.atlas, selectedTrees = new Set(input.trees);
  const diagnostic = (code, id, message) => result.diagnostics.push({ code, id, message });
  for (const id of input.trees) if (!atlas.trees.some((tree) => tree.id === id)) diagnostic('PUBLICATION_TREE_MISSING', id, 'The selected Tree does not exist.');
  const selectedPoints = new Set(input.points ?? atlas.points.filter((point) => selectedTrees.has(point.tree)).map((point) => point.id));
  for (const id of selectedPoints) {
    const point = atlas.points.find((item) => item.id === id);
    if (!point) diagnostic('PUBLICATION_POINT_MISSING', id, 'The selected Point does not exist.');
    else requireValue(selectedTrees.has(point.tree), 'Explicit Points must belong to selected Trees.');
  }
  const trees = atlas.trees.filter((tree) => selectedTrees.has(tree.id)).map((tree) => {
    const result = copy(tree); delete result.path; return result;
  });
  const branches = atlas.branches.filter((branch) => selectedTrees.has(branch.tree)).map(copy);
  const pointRecords = atlas.points.filter((point) => selectedPoints.has(point.id) && selectedTrees.has(point.tree));
  const facets = atlas.facets.filter((facet) => selectedTrees.has(facet.tree) && (facet.on.point ? selectedPoints.has(facet.on.point) : branches.some((branch) => branch.tree === facet.tree && branch.id === facet.on.branch)));
  const references = new Map();
  for (const record of [...pointRecords, ...facets]) for (const source of record.sources ?? []) {
    if (!references.has(source.uri)) references.set(source.uri, []);
    references.get(source.uri).push(copy(source));
  }
  const selectedSources = new Set();
  for (const uri of selection.sources) {
    const refs = references.get(uri);
    if (!refs) {
      diagnostic('PUBLICATION_SOURCE_MISSING', uri, 'The source is not referenced by an included Point or Facet.');
      result.sources.push({ uri, publicationAvailable: false, status: 'not-included', references: [] });
    } else if (reserved(uri)) {
      diagnostic('PUBLICATION_SOURCE_RESERVED', uri, 'Reserved Atlas state is not publishable.');
      result.sources.push({ uri, publicationAvailable: false, status: 'not-included', references: refs });
    } else {
      selectedSources.add(uri);
      result.sources.push({ uri, publicationAvailable: true, status: 'selected', references: refs });
    }
  }
  const points = atlas.points.filter((point) => selectedTrees.has(point.tree)).map((point) => selectedPoints.has(point.id)
    ? { ...cleanRecord(point, selectedSources), publicationAvailable: true }
    : { id: point.id, tree: point.tree, publicationAvailable: false });
  const publishedFacets = facets.map((facet) => ({ ...cleanRecord(facet, selectedSources),
    viaAvailability: selectedTrees.has(facet.via) ? 'included' : 'not-included',
    targetAvailability: facet.targets.map((target) => ({ ...target, availability:
      (target.point ? selectedPoints.has(target.point) && atlas.points.some((point) => point.id === target.point && selectedTrees.has(point.tree))
        : target.branch ? branches.some((branch) => branch.id === target.branch && branch.tree === facet.via)
          : selectedTrees.has(target.tree)) ? 'included' : 'not-included' })) }));
  result.atlas = { format: 'atlas.publication-data/1', id: atlas.id, title: atlas.title, trees, points, branches, facets: publishedFacets, checks: [] };
  result.exclusions = { trees: atlas.trees.length - trees.length, points: atlas.points.length - pointRecords.length,
    facets: atlas.facets.length - facets.length, checks: atlas.checks.length,
    sourceReferences: [...references].filter(([uri]) => !selectedSources.has(uri)).reduce((count, [, refs]) => count + refs.length, 0) };
  result.status = result.diagnostics.length ? 'incomplete' : 'ready';
  return { ...result, digest: hash(result) };
}

/** Read only the explicit selected references. Caller roots grant retrieval, not selection. */
export async function readPublicationSources(view, publication, options = {}) {
  object(options, ['allowedRoots']);
  requireValue(Array.isArray(options.allowedRoots) && options.allowedRoots.length > 0 && options.allowedRoots.length <= 100 && options.allowedRoots.every((root) => typeof root === 'string' && root.length > 0), 'Explicit source roots are required.');
  requireValue(publication?.format === 'atlas.publication/1' && publication.identity === view?.identity && view?.status === 'ready', 'Publication must match a valid captured baseline.');
  const expected = preparePublication(view, publication.selection);
  requireValue(expected.status !== 'unavailable' && expected.digest === publication.digest && hash({ ...publication, digest: undefined }) === hash({ ...expected, digest: undefined }), 'Publication was changed after preparation.');
  const results = [];
  for (const entry of expected.sources) {
    if (!entry.publicationAvailable) {
      results.push({ uri: entry.uri, source: { uri: entry.uri }, status: 'denied', code: 'PUBLICATION_SOURCE_NOT_INCLUDED', message: 'The source is outside this publication selection.' });
      continue;
    }
    const hashes = new Set(entry.references.flatMap((reference) => reference.sha256 ? [reference.sha256] : []));
    if (hashes.size > 1) {
      results.push({ uri: entry.uri, source: { uri: entry.uri }, status: 'invalid', code: 'PUBLICATION_SOURCE_CONFLICT', message: 'Selected references specify conflicting source hashes.' });
      continue;
    }
    const source = { ...entry.references[0], ...(hashes.size ? { sha256: [...hashes][0] } : {}) };
    results.push({ uri: entry.uri, ...await readSource(view, source, options) });
  }
  return results;
}
