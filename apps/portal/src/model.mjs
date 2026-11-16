// The Portal's own model of an Atlas: its accounts, their claims in reading order, and what stands
// beside each claim. This is the only module that reads the Library's view; pages, the service and
// the export work from what `present` returns.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openAtlas, readSource } from '../../../library/src/model.mjs';
import { markdownHeadings, withoutHeader } from '../../../library/src/frontmatter.mjs';
import { resolveReference, referenceIndex, staleSources } from '../../../library/src/references.mjs';
import { renderBlocks } from './markdown.mjs';

export { stateHome, isPrivateStatePath } from '../../../library/src/state.mjs';

/** The Library's search module, served to the reader as `_/search.js`. */
export const searchModule = new URL('../../../library/src/search.mjs', import.meta.url);

// ── What is read from the Library ───────────────────────────────────────────────────────────

/** What a decision or an observation adds to a Point. */
const standingOf = point => point.type === 'decision' ? { type: 'decision', status: point.status } : point.type === 'observation' ? { type: 'observation', observedAt: point.observedAt } : null;
/** A source reference: `uri`, optional `title`, `role`, `locator`, and `sha256`, the stamp. */
const sourceFields = source => ({ uri: source.uri, title: source.title ?? null, role: source.role ?? null, locator: source.locator ?? null, stamp: source.sha256 ?? null });
const remote = uri => /^https?:\/\//i.test(uri);

/**
 * Where an authored link leads, by the Library's own rule (`resolveReference`):
 * `{ point: id }`, `{ facet: { tree, id } }`, `{ file }` for any other local path (relative to the Atlas root), or null.
 */
function referenceOf(view, record, href) {
  let found;
  try { found = resolveReference(view, record, href); } catch { return null; }
  const fragment = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  // A link to a record leads to the record's page and drops any fragment: a page's own fragment is the chain of open panels.
  if (found.status === 'resolved' && found.target.kind === 'point') return { point: found.target.id };
  if (found.status === 'resolved' && found.target.kind === 'facet') return { facet: { tree: found.target.tree, id: found.target.id } };
  if (found.status === 'resolved' && found.target.kind === 'source') return { file: found.target.path + fragment };
  if (found.status === 'missing' && found.candidatePath) return { file: found.candidatePath + fragment };
  return null;
}

/**
 * Every link from one Point's prose to another Point, as the Library's reference index lists them:
 * `[{ from, to }]` by Point ID. The index returns at most 10000 references.
 */
function pointLinks(view) {
  return referenceIndex(view, { limit: 10000 }).references
    .filter(reference => reference.from.kind === 'point' && reference.status === 'resolved' && reference.target.kind === 'point')
    .map(reference => ({ from: reference.from.id, to: reference.target.id }));
}

/**
 * What the Library's search ranks of a presented Point or Facet: `id`, `tree`, `title`, `body`, `uncertainty`; a Point's
 * standing as the Library writes it (`type` with `status` or `observedAt`), which its summary keeps; and a Facet's
 * `on`, `via` and `targets`, by which the search tells a Facet from a Point.
 */
const searchRecord = record => ({ id: record.id, tree: record.account, title: record.title, body: record.body, ...(record.uncertainty ? { uncertainty: record.uncertainty } : {}),
  ...(record.on === undefined ? record.standing ?? {} : { on: record.on, via: record.via, targets: record.targets }) });

// ── The presented model ─────────────────────────────────────────────────────────────────────

const failure = (code, message) => Object.assign(new Error(message), { code });

/** A value made when first asked for, then kept. */
function lazy(object, key, make) {
  Object.defineProperty(object, key, {
    enumerable: true, configurable: true,
    get() { const value = make(); Object.defineProperty(object, key, { value, enumerable: true }); return value; },
  });
}

/** A local source path as a reader sees it: the reference without the steps that climb out of the Atlas root. */
const shownPath = uri => uri.replace(/^(?:\.\.\/)+/, '');

/** A decoded local path, written so `new URL` reads it back as the same path. */
const asReference = file => {
  const cut = file.indexOf('#');
  const [local, fragment] = cut < 0 ? [file, ''] : [file.slice(0, cut), file.slice(cut)];
  return local.split('/').map(part => part === '..' ? part : encodeURIComponent(part)).join('/') + fragment;
};

/**
 * Turn an opened view into what the Portal shows.
 *
 * `trees`: the account IDs a publication holds; omitted, every account.
 * `sourceBase`: the URL at which the Atlas root can be browsed, ending in `/`; local sources then link there.
 *
 * Returns `{ status, identity, root, paths, diagnostics, view, atlas }`, and `sourcePages` once `linkSourcePages` has run.
 *   status       'ready', 'invalid' (diagnostics say why) or 'absent' (no Atlas at this root)
 *   view         the Library's view it was presented from, which the stale report reads
 *   atlas        null unless ready, else `{ id, title, style, accounts, points, facets }`
 *     style      `{ title, body, blocks, html }`, its text as a Point's is; its links lead only outside the Atlas
 *     accounts   Map of id to `{ id, title, scope, base, order }`; `order` is its Point IDs in reading order
 *     points     Map of id to `{ id, account, file, title, body, standing, uncertainty, sources, parent, children,
 *                above, next, attached, incoming, linksTo, linkedFrom, blocks, html }`,
 *                the accounts in the Atlas's order and each account's Points in reading order
 *                  parent     the ID of the claim it develops, or null for the top claim of its account
 *                  above      the IDs of the claims above, the top claim first, the parent last
 *                  children   the IDs of its developments, in outline order
 *                  next       the next Point in reading order: within the account, then the top claim of the
 *                             next account held; null at the end of the last
 *                  attached   keys of the Facets said of it; incoming: keys of other accounts' Facets that draw on it
 *                  linksTo    the IDs of the Points its prose links to, in the order the prose first names them;
 *                             linkedFrom: the IDs of the Points whose prose links to it, in the order of `points`.
 *                             Neither leaves anything out: a page drops what its outline already shows.
 *                  sources    `{ uri, title, role, locator, stamp, remote, shown, href }`
 *                  blocks     the prose as top-level blocks `{ source, html }`; html: the blocks joined.
 *                             Its links are written from the Point's own page, `/<id>/`
 *     facets     Map of key (`<tree>:<id>`) to `{ key, id, account, file, title, body, on, via, outside, targets,
 *                uncertainty, sources, blocks, html }`; `outside` is true when the account it draws on is not
 *                held, and `targets` then is empty. Its prose's links are written from its own page,
 *                `/_/facet/<tree>/<id>/`
 */
export function present(view, { trees, sourceBase = null } = {}) {
  const model = { status: 'ready', identity: view.identity, root: view.root, paths: view.files.map(file => file.path), diagnostics: [], view, atlas: null };
  // A view carries an Atlas only when it validates; with no manifest among its files there is no Atlas at this root.
  const source = view.status === 'ready' ? view.atlas : null;
  if (!source) return { ...model, status: view.files.some(file => file.path === 'atlas.json') ? 'invalid' : 'absent', diagnostics: view.diagnostics.map(({ code, path: file, message }) => ({ code, path: file, message })) };

  for (const id of trees ?? []) if (!source.trees.some(tree => tree.id === id)) throw failure('SELECTION_UNKNOWN', `This Atlas has no Tree ${id}.`);
  const held = tree => !trees || trees.includes(tree);
  const records = new Map(source.points.map(point => [point.id, point]));
  const accounts = new Map(), points = new Map(), facets = new Map();
  const facetKey = (tree, id) => `${tree}:${id}`;

  // A record's prose is drawn on its own page, so its links are written from there: `base` leads from that page to home.
  const link = (record, base) => href => {
    const found = referenceOf(view, record, href);
    if (!found) return null;
    if (found.point) return points.has(found.point) ? { href: `${base}${found.point}/` } : { absent: true };
    if (found.facet) return facets.has(facetKey(found.facet.tree, found.facet.id)) ? { href: `${base}_/facet/${found.facet.tree}/${found.facet.id}/` } : { absent: true };
    if (sourceBase) return { href: new URL(asReference(found.file), sourceBase).href, out: true };
    // On the local service, a file the Atlas cites and the service shows (see `linkSourcePages`) has a page of its own.
    const cut = found.file.indexOf('#'), fragment = cut < 0 ? '' : found.file.slice(cut);
    const cited = model.sourcePages?.get(cut < 0 ? found.file : found.file.slice(0, cut));
    return cited ? { href: `${base}_/source/?uri=${encodeURIComponent(cited + fragment)}${fragment}` } : null;
  };
  const prose = (target, record, base) => {
    lazy(target, 'blocks', () => renderBlocks(record.body, { link: link(record, base) }));
    lazy(target, 'html', () => target.blocks.map(block => block.html).join(''));
  };
  // The links between Points are read from the Library's reference index once, when a page first asks for them.
  let between = null;
  const links = () => {
    if (between) return between;
    const order = [...points.keys()], found = new Map(order.map(id => [id, { to: [], from: new Set() }]));
    for (const { from, to } of pointLinks(view)) {
      if (!points.has(from) || !points.has(to)) continue;
      if (!found.get(from).to.includes(to)) found.get(from).to.push(to);
      found.get(to).from.add(from);
    }
    between = new Map(order.map(id => [id, { to: found.get(id).to, from: order.filter(other => found.get(id).from.has(other)) }]));
    return between;
  };
  const cited = record => (record.sources ?? []).map(reference => {
    const fields = sourceFields(reference), far = remote(fields.uri);
    return { ...fields, remote: far, shown: far ? fields.uri : shownPath(fields.uri), href: far ? fields.uri : sourceBase ? new URL(fields.uri, sourceBase).href : null };
  });

  for (const tree of source.trees) {
    if (!held(tree.id)) continue;
    const order = [];
    const place = (id, parent) => {
      const record = records.get(id);
      order.push(id);
      const above = parent === null ? [] : [...points.get(parent).above, parent];
      const point = { id, account: tree.id, file: record.path, title: record.title, body: record.body, standing: standingOf(record), uncertainty: record.uncertainty ?? null,
        sources: cited(record), parent, children: [], above, next: null, attached: [], incoming: [] };
      lazy(point, 'linksTo', () => links().get(id).to);
      lazy(point, 'linkedFrom', () => links().get(id).from);
      prose(point, record, '../');
      points.set(id, point);
      if (parent !== null) points.get(parent).children.push(id);
    };
    const walk = (placements, parent) => {
      for (const placement of placements ?? []) { place(placement.point, parent); walk(placement.children, placement.point); }
    };
    place(tree.base, null);
    walk(tree.children, tree.base);
    order.forEach((id, index) => { points.get(id).next = order[index + 1] ?? null; });
    accounts.set(tree.id, { id: tree.id, title: tree.title, scope: tree.scope, base: tree.base, order });
  }
  // The end of an account leads on to the top claim of the next account held; the last account's end leads nowhere.
  const shown = [...accounts.values()];
  shown.forEach((account, index) => { if (shown[index + 1]) points.get(account.order.at(-1)).next = shown[index + 1].base; });

  for (const record of source.facets) {
    if (!held(record.tree)) continue;
    const outside = !held(record.via);
    const targets = outside ? [] : record.targets;
    const facet = { key: facetKey(record.tree, record.id), id: record.id, account: record.tree, file: record.path, title: record.title, body: record.body,
      on: record.on, via: record.via, outside, targets, uncertainty: record.uncertainty ?? null, sources: cited(record) };
    prose(facet, record, '../../../../');
    facets.set(facet.key, facet);
    points.get(record.on).attached.push(facet.key);
    for (const target of targets) points.get(target).incoming.push(facet.key);
  }

  const style = { title: source.style.title, body: source.style.body };
  lazy(style, 'blocks', () => renderBlocks(style.body));
  lazy(style, 'html', () => style.blocks.map(block => block.html).join(''));
  model.atlas = { id: source.id, title: source.title, style, accounts, points, facets };
  return model;
}

/** Read the Atlas at `root` from disk and present it. */
export async function openModel(root, options) {
  return present(await openAtlas(path.resolve(root)), options);
}

/** How the stale report names a presented Point (`{ point }`) or Facet (`{ tree, facet }`), and how it names a reference of one. */
const selector = record => record.on === undefined ? { point: record.id } : { tree: record.account, facet: record.id };
const referenceKey = (kind, tree, id, index) => `${kind} ${tree} ${id} ${index}`;

/** The stale report's entry `{ status, code }` for each source of each of `records`, in order, read within `allowedRoots`. */
async function readings(model, records, allowedRoots) {
  const cited = records.filter(record => record.sources.length), stands = new Map();
  for (let start = 0, end; start < cited.length; start = end) {
    let held = cited[start].sources.length;
    for (end = start + 1; end < cited.length && held + cited[end].sources.length <= 10000; end++) held += cited[end].sources.length;
    const report = await staleSources(model.view, { allowedRoots, limit: 10000, records: cited.slice(start, end).map(selector) });
    for (const reference of report.references) stands.set(referenceKey(reference.from.kind, reference.from.tree, reference.from.id, reference.sourceIndex), reference);
  }
  return records.map(record => record.sources.map((source, index) => stands.get(referenceKey(record.on === undefined ? 'point' : 'facet', record.account, record.id, index))));
}

/**
 * How the sources of each of `records` (Points and Facets of the model) stand now, read within `allowedRoots`:
 * for each record, one of 'current', 'changed', 'missing', 'denied', 'unstamped' or 'remote' for each of its
 * sources, in order. The words and the rule are the Library's stale report (`staleSources`), asked about these
 * records alone, so a page reads its own sources and no others. A report reads at most 10000 references, so many
 * records are asked about in as few reports as hold them.
 */
export async function sourceStates(model, records, { allowedRoots = [model.root] } = {}) {
  return (await readings(model, records, allowedRoots)).map(entries => entries.map(entry => entry?.status));
}

/** The Library's refusals of a reference that is not a path the grants reach (outside them, in Atlas's own state, or not a path at all): the service shows no page of it. */
const UNGRANTED = new Set(['SOURCE_DENIED', 'SOURCE_RESERVED', 'SOURCE_INVALID']);
/** Whether the local service shows a source on a page of its own: a local file the grants reach, whether or not it could be read. */
const servable = entry => Boolean(entry) && entry.status !== 'remote' && !UNGRANTED.has(entry.code);

/**
 * As `sourceStates`, and beside each record's states `served`: for each of its sources whether the local service
 * shows it on a page of its own (`sourcePage` reads it). `{ states, served }` for each record.
 */
export async function sourceReadings(model, records, { allowedRoots = [model.root] } = {}) {
  return (await readings(model, records, allowedRoots)).map(entries => ({ states: entries.map(entry => entry?.status), served: entries.map(servable) }));
}

/** A source URI without its fragment: the file it cites. */
export const sourceFile = uri => uri.split('#')[0];

/**
 * Let the prose of `model` link the local files it names to their own pages, as the local service shows them: each
 * file a Point or Facet of the model cites and the grants reach, whichever record cites it. Call it before any prose of
 * the model is drawn; prose drawn without it, as in an export or a proposed change, names such a file in plain words.
 * The files are read once, as the stale report reads them, to learn which the service shows.
 */
export async function linkSourcePages(model, { allowedRoots = [model.root] } = {}) {
  if (!model.atlas || model.sourcePages) return;
  const records = [...model.atlas.points.values(), ...model.atlas.facets.values()], pages = new Map();
  (await sourceReadings(model, records, { allowedRoots })).forEach(({ served }, index) => records[index].sources.forEach((source, at) => {
    const file = sourceFile(source.uri);
    if (served[at] && !pages.has(localPath(file))) pages.set(localPath(file), file);
  }));
  model.sourcePages = pages;
}

/** A local path as an authored link resolves to it: percent-decoded and normalized, relative to the Atlas root. */
const localPath = file => path.posix.normalize(decoded(file));

/** The local files the Points and Facets of a model cite, by any fragment: the only files the service shows. */
export const citedFiles = model => new Set([...model.atlas.points.values(), ...model.atlas.facets.values()].flatMap(record => record.sources.filter(source => !source.remote).map(source => sourceFile(source.uri))));

/**
 * One cited local file as the service shows it on a page of its own, read through the Library within `allowedRoots`.
 * `uri` is a source URI as an Atlas cites it, relative to the Atlas root; its fragment, if any, is not read.
 * Returns null when no Point or Facet of the model cites the file, when it lies outside the grants or in Atlas's own
 * state, or when `uri` is not a local path; else `{ file, shown, read, html, text, citers }`:
 *   file     the URI without its fragment; shown: its path as a source line shows it
 *   read     'markdown' (html holds it rendered, each heading carrying the Library's heading name as its ID),
 *            'text' (text holds it), 'missing', 'large', 'binary' or 'unreadable'
 *   citers   the Points and Facets of the model that cite the file, by any fragment, in the order of the model:
 *            `[{ account, title, point }]` or `[{ account, title, facet }]` (a Facet's key)
 */
export async function sourcePage(model, uri, { allowedRoots = [model.root] } = {}) {
  const file = sourceFile(uri);
  if (!file || remote(file)) return null;
  const citers = [];
  for (const point of model.atlas.points.values()) if (point.sources.some(source => sourceFile(source.uri) === file)) citers.push({ account: point.account, title: point.title, point: point.id });
  for (const facet of model.atlas.facets.values()) if (facet.sources.some(source => sourceFile(source.uri) === file)) citers.push({ account: facet.account, title: facet.title, facet: facet.key });
  if (!citers.length) return null;
  const found = await readSource(model.view, { uri: file }, { allowedRoots });
  if (UNGRANTED.has(found.code)) return null;
  const read = found.status === 'ready' ? (/\.md$/i.test(decoded(file)) ? 'markdown' : 'text')
    : found.status === 'missing' ? 'missing' : found.code === 'READ_LIMIT' ? 'large' : found.code === 'FILE_UTF8' ? 'binary' : 'unreadable';
  let html = null;
  if (read === 'markdown') {
    // The headings as the Library names them, by the line each starts on; a record's JSON header is not Markdown.
    const ids = new Map(markdownHeadings(found.content).map(heading => [heading.line, heading.id]));
    html = renderBlocks(withoutHeader(found.content), { ids }).map(block => block.html).join('');
  }
  return { file, shown: shownPath(file), read, html, text: read === 'text' ? found.content : null, citers };
}

/** A local path as the Library reads it: percent-decoded, or as written when it does not decode. */
const decoded = file => { try { return decodeURIComponent(file); } catch { return file; } };

/**
 * What the reader's search ranks: `{ accounts: { id: title }, records: [...] }`, the Points and then the Facets as the
 * Library's `searchPage` takes them. A Facet's `via` may name an account the publication does not hold.
 */
export function searchIndex(model) {
  return {
    accounts: Object.fromEntries([...model.atlas.accounts.values()].map(account => [account.id, account.title])),
    records: [...model.atlas.points.values(), ...model.atlas.facets.values()].map(searchRecord),
  };
}

/**
 * A cheap answer to "are the files this model was read from as they were?": the root, the records
 * at the root, and every file and folder under each top folder that holds a record (and `.checks`),
 * each by size, times and identity. `newest` is the latest time among them, in nanoseconds.
 * Null when the model is not a valid Atlas or the folders hold more than `limit` entries.
 */
export async function fingerprint(model, limit = 20000) {
  if (model.status !== 'ready') return null;
  const tops = new Set(['.checks']), loose = new Set();
  for (const file of model.paths) (file.includes('/') ? tops : loose).add(file.split('/')[0]);
  const hash = createHash('sha256');
  let newest = 0n, count = 0;
  const note = (name, stat) => {
    hash.update(`${name}\0${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}\n`);
    for (const time of [stat.mtimeNs, stat.ctimeNs]) if (time > newest) newest = time;
    return ++count <= limit;
  };
  const walk = async relative => {
    let stat;
    try { stat = await fs.lstat(path.join(model.root, relative), { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
    if (!note(relative, stat)) return false;
    if (!stat.isDirectory()) return true;
    for (const name of (await fs.readdir(path.join(model.root, relative))).sort()) if (!await walk(`${relative}/${name}`)) return false;
    return true;
  };
  try {
    note('', await fs.lstat(model.root, { bigint: true }));
    for (const name of [...loose, ...tops].sort()) if (!await walk(name)) return null;
  } catch { return null; }
  return { key: hash.digest('hex'), newest };
}
