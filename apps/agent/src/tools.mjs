import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { openAtlas, getPoint, getTree, getFacet, searchAtlasPage, compareViews, readSource } from '../../../library/src/model.mjs';
import { prepareChangeFromDisk, prepareFromCandidate, prepareInitialization, applyDraft, recoverChange, saveDraft, loadDraft, listDrafts, deleteDraft, listTransactions, writeCandidate } from '../../../library/src/authoring.mjs';
import { listStyles, getStyle } from '../../../library/src/styles.mjs';
import { summarizeAtlas, summarizeDraft, readJsonChunk } from '../../../library/src/inventory.mjs';
import { route } from '../../../library/src/route.mjs';
import { inspectAbsorb } from '../../../library/src/absorb.mjs';
import { referenceIndex, directCiters, sourceCitations, prepareMove, staleSources, prepareStamp } from '../../../library/src/references.mjs';
import { stateHome, checkStateLocation } from '../../../library/src/state.mjs';
import { savedDraft, reviewDraft, stampReport } from './drafts.mjs';

const SHIPPED = new URL('../../../spec/', import.meta.url);
/** The documents the guide names, by the name the guide gives each: the specification, the file format, the operations, the project workflow. */
const DOCUMENTS = Object.freeze({ spec: 'SPEC.md', format: 'spec/FORMAT.md', operations: 'spec/OPERATIONS.md', project: 'spec/PROJECT.md' });
export const GUIDE_DOCUMENTS = Object.freeze(Object.keys(DOCUMENTS));
/** "Working with Atlas", the guide both adapters hand to agents, or with a name one of the documents it names, as shipped. */
export const readGuide = (document) => readFile(new URL(document === undefined ? 'OPERATING.md' : DOCUMENTS[document], SHIPPED), 'utf8');

/** The one folder inside an Atlas where a candidate may lie; both adapters accept it by this name, relative to the Atlas root. */
export const CANDIDATE = '.atlas-candidate';
const candidateName = value => value.replace(/\/+$/u, '') === CANDIDATE;
/** A candidate directory as given: the Atlas's own candidate folder by its name, any other directory by its path. */
export const candidateDirectory = (root, value) => candidateName(value) ? path.join(root, CANDIDATE) : path.resolve(value);

/**
 * What a candidate holds that would otherwise surface only once it is prepared or applied, and that does not make it
 * invalid: the link diagnostics review reports, and each local source reference whose file does not exist or whose
 * fragment names no heading, read within `allowedRoots` as the stale report reads it, with the record that cites it.
 * `unreadSources` counts the references that were not read: local ones outside the grants or unreadable, and every one
 * past the bound of one stale report, so that an empty list is not taken for a clean one.
 * Each list holds at most 100 entries; `bounds` says how many there are.
 */
async function unresolved(view, allowedRoots) {
  const limits = ['Link diagnostics and missing sources do not make the candidate invalid: they are what review and stale would report once it is prepared and applied.'];
  if (view.status !== 'ready') return { linkDiagnostics: [], missingSources: [], unreadSources: 0, bounds: { linkDiagnostics: { available: 0, returned: 0 }, missingSources: { available: 0, returned: 0 } },
    limits: [...limits, 'The candidate does not validate, so its links and sources are not read.'] };
  const links = referenceIndex(view, { limit: 10000 }).diagnostics;
  const { references, bounds } = await staleSources(view, { allowedRoots, limit: 10000 });
  const missing = references.filter(item => item.status === 'missing').map(({ from, sourceIndex, source, code, reason }) => ({ from, sourceIndex, uri: source.uri, ...(code ? { code } : {}), reason }));
  const unread = references.filter(item => item.status === 'denied' || item.status === 'unstamped' && item.code).length;
  if (unread) limits.push(`${unread} local source ${unread === 1 ? 'reference was' : 'references were'} not read here, being outside the source roots granted or unreadable, so whether what ${unread === 1 ? 'it cites' : 'they cite'} is there is not known. Grant the directories that hold them to read them.`);
  if (bounds.unread) limits.push(`${bounds.unread} source ${bounds.unread === 1 ? 'reference was' : 'references were'} not read, being past the 10000 references one stale report reads, so a missing source among them is not listed.`);
  return { linkDiagnostics: links.slice(0, 100), missingSources: missing.slice(0, 100), unreadSources: unread + bounds.unread,
    bounds: { linkDiagnostics: { available: links.length, returned: Math.min(links.length, 100) }, missingSources: { available: missing.length, returned: Math.min(missing.length, 100) } }, limits };
}

/**
 * What preparing from a candidate directory would say, without saving anything: its validation (the candidate's own
 * diagnostics and those of the change, such as STYLE_CHANGE_ALONE), the files that differ from the Atlas, and the files
 * left out of the change; and what would otherwise surface only after it is applied (`unresolved`), read within
 * `allowedRoots`. A candidate that cannot be prepared is refused as preparing refuses it.
 */
export async function validateCandidate(root, directory, allowedRoots = [root]) {
  const plan = await prepareFromCandidate(root, directory, { reason: 'Validate the candidate; nothing is saved.' });
  const { status, identity, diagnostics } = plan.validation;
  return { format: 'atlas.validation/1', status, identity, diagnostics, candidate: directory,
    changes: plan.changes.map(change => ({ path: change.path, action: change.after === null ? 'remove' : 'write' })), ignored: plan.ignored,
    ...await unresolved(plan.candidate, allowedRoots) };
}

const text = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength });
const id = { ...text(100), pattern: '^[a-z0-9][a-z0-9-]*$' };
const hash = { ...text(64), pattern: '^[a-f0-9]{64}$' };
const number = maximum => ({ type: 'integer', minimum: 1, maximum });
const from = maximum => ({ type: 'integer', minimum: 0, maximum });
const flag = { type: 'boolean' };
const only = { enum: [true] };
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });
const source = object({ uri: text(), title: text(), role: { enum: ['evidence', 'background', 'example', 'implementation', 'history'] }, revision: text(), locator: text(), sha256: hash }, ['uri']);
const changes = array(object({ path: text(1000), content: { type: ['string', 'null'], maxLength: 2 * 1024 * 1024 } }, ['path', 'content']));
const cursor = object({ identity: hash, request: hash, section: { enum: ['selected', 'supporting', 'facets'] }, offset: from(1000000) }, ['identity', 'request', 'section', 'offset']);
// A chunk offset reaches the end of any text a chunk is read from; the text's own byteLength is the real bound. A review
// repeats what its draft holds, each record once per side as changed and once as context, so it reaches about twice the
// 32 MiB a saved draft may hold, beside the reasons, links and diagnostics it adds, which only the reader's bounds limit:
// 1 GiB lies past any of them.
const chunk = { offset: from(1024 * 1024 * 1024), maxBytes: { type: 'integer', minimum: 4, maximum: 128 * 1024 }, expectedSha256: hash };
const inventoryOptions = { limit: number(100), offset: from(100000), section: { enum: ['files', 'trees', 'points', 'facets', 'checks', 'diagnostics'] }, expectedIdentity: hash, full: flag };
const draftOptions = { part: { enum: ['summary', 'details'] }, full: flag, limit: number(100), ...chunk };
const kinds = { ...array({ enum: ['point', 'facet'] }, 2), minItems: 1, uniqueItems: true };
const type = { enum: ['decision', 'observation', 'untyped'] };
const reason = text(16384);

// Each entry: name, what the tool does and when to use it, its input, and what it touches:
// 'reads' nothing but the Atlas and granted sources, 'saves' a draft in private state, or 'writes' authored files or deletes a draft.
const definitions = [
  ['atlas_guide', 'Returns "Working with Atlas", the guide to reading an Atlas, writing one and keeping it true, or with document one of the texts it names: spec, format, operations or project. Read the guide once before you read or change this Atlas, and a document when the guide sends you to its exact rules.', object({ document: { enum: GUIDE_DOCUMENTS } }), 'reads'],
  ['atlas_open', 'Returns the Atlas as captured for this session: its identity, whether it is valid, its diagnostics, and bounded lists of its Trees, Points, Facets, Checks and files without their text. Use it first; its identity is the baseline that preparing a change requires.', object(inventoryOptions), 'reads'],
  ['atlas_refresh', 'Captures the files as they are on disk now and reports what changed since the previous capture. Use it when the files may have changed outside this session; every other reading tool answers from the last capture.', object(inventoryOptions), 'reads'],
  ['atlas_outline', 'Returns every Tree, or the one tree names, with its title, its scope and its outline: one line for each Point, nested as the outline places it, with its ID, its title and its standing when it has a Type. Use it to see a Tree whole before you choose what to read; it holds no explanation, so read the Point you choose with atlas_route or atlas_inspect.', object({ tree: id }), 'reads'],
  ['atlas_inspect', 'Returns one record whole: a Point with the Points above it, its Facets, the Facets that target it and its sources; a Tree; a Facet; the Style; every Check with its text; or one authored file exactly as written. Use it when you know which record you need, and use path to get the text of a file you will change.', object({ point: id, tree: id, facet: object({ tree: id, id }, ['tree', 'id']), style: only, checks: only, path: text(1000), part: { enum: ['details'] }, ...chunk }), 'reads'],
  ['atlas_search', 'Finds Points and Facets whose ID, title, text or uncertainty contain the words of a query, ranked lexically, and says how many matched in all. Use it to find candidates for a question; a match is not yet an answer, and no match is not proof that the Atlas says nothing.', object({ query: text(), kinds, offset: from(100000), tree: id, type, limit: number(100), presentation: { enum: ['full', 'summary'] } }, ['query']), 'reads'],
  ['atlas_route', 'Returns a reading path for one Point, one Tree, one Facet of a Tree or a question: the Points above, the complete explanation, what it develops into and the Facets that bear on it. Use mode discover to compare results, then read the one you chose by its exact ID.', object({ point: id, tree: id, facet: id, query: text(), kinds, detail: { enum: ['overview', 'standard', 'deep'] }, type, limit: number(100), mode: { enum: ['discover', 'read'] }, orientation: { enum: ['compact', 'full'] }, cursor }), 'reads'],
  ['atlas_references', 'Lists Markdown links and source citations as authored, without reading any source: all of them, the records whose text links to one Point or Facet, or the records that cite one source URI. Use it to find what mentions a record before you change or move it.', object({ point: id, facet: id, tree: id, uri: text(16384), limit: number(1000) }), 'reads'],
  ['atlas_read_source', 'Reads one cited local source within the source roots granted at launch and says whether it still matches its stamp; an HTTP(S) URL is returned as a reference and never fetched. Use it when a task turns on the exact words of a source.', object({ source, maxBytes: number(1024 * 1024) }, ['source']), 'reads'],
  ['atlas_stale', 'Reads every local source within the grants, up to 10000 references, counts those current, changed, missing, denied, unstamped or remote and any not read, and lists each changed or missing source once with the records that cite it; full adds every reference with its status. Use it to find the explanations to read again after the project changed.', object({ limit: number(1000), offset: from(10000), expectedIdentity: hash, full: flag }), 'reads'],
  ['atlas_validate', 'Returns the status and diagnostics of the Atlas as captured, or with from of a candidate directory as preparing it would report them, with the files that differ, the files left out, its broken links and the sources it cites that are not there, and saves nothing. Use it on .atlas-candidate after you edit the copy and before atlas_prepare.', object({ from: text() }), 'reads'],
  ['atlas_absorb', 'Shows where incoming material may belong: the Points it matches, the Trees that could own it and the Facets that bear on those Points. Use it before you write a change from new material; it prepares nothing, and you decide what the material changes.', object({ text: text(1024 * 1024), source, tree: id, limit: number(100) }, ['text', 'source']), 'reads'],
  ['atlas_styles', 'Lists the curated Styles, or returns one with its complete text. Use it to choose the Style of a new Atlas.', object({ id }), 'reads'],
  ['atlas_init', 'Prepares a new Atlas in a root that has none, as a saved draft: a manifest and the Style you choose, by curated ID or as complete text. Use it once to start an Atlas; nothing is written to the root until the draft is applied.', object({ baseline: hash, id, title: text(), styleId: id, styleContent: text(2 * 1024 * 1024) }, ['baseline', 'id', 'title']), 'saves'],
  ['atlas_candidate', 'Writes a fresh copy of the Atlas\'s records into .atlas-candidate at the Atlas root, replacing everything that folder held, and returns its path and the baseline to prepare it against. Use it before a change larger than a few files, edit the copy with your own file tools, and run it again to discard those edits or once the Atlas has changed, since a copy of an earlier Atlas is refused.', object(), 'writes'],
  ['atlas_prepare', 'Prepares a change and saves it as a draft without writing any authored file, and returns the id and revision of the draft, its status, its validation and the changed paths. Use changes for a small edit, and for anything larger a candidate: .atlas-candidate, or another directory that holds the whole proposed Atlas.', object({ baseline: hash, reason, changes, candidate: text() }, ['baseline', 'reason']), 'saves'],
  ['atlas_review', 'Returns the effects of a saved draft as a summary to read whole: each record that is new, changed or removed by its ID with what changed, the Points above it, the Facets that bear on it and what mentions it, the counts and link diagnostics; full gives the complete records. Read it, and read the Points above again, before you ask for the draft to be applied.', object({ id, expectedRevision: hash, full: flag, part: { enum: ['details'] }, limit: number(1000), ...chunk }, ['id']), 'reads'],
  ['atlas_drafts', 'Lists the saved drafts, loads one, or deletes one by its exact revision. Use it to find a draft prepared earlier, to read its changed files, or to discard it.', object({ action: { enum: ['list', 'load', 'delete'] }, id, expectedRevision: hash, ...draftOptions }, ['action']), 'writes'],
  ['atlas_apply', 'Writes a saved draft to the Atlas and removes the draft once the apply completes; it refuses when the Atlas changed since the draft was prepared, when the draft is not at the revision given, when its candidate is invalid, and while an earlier apply awaits recovery. Use it only on the owner\'s word, with the exact revision that was reviewed.', object({ id, expectedRevision: hash }, ['id', 'expectedRevision']), 'writes'],
  ['atlas_recover', 'Lists the apply transactions whose journals remain, or with an id rolls back an interrupted one, refusing when a file of the change holds bytes that are neither its original nor its proposed ones. Use it after atlas_apply reports interrupted, or refuses LOCKED because an earlier apply is unfinished; a rollback is not a completion.', object({ id }), 'writes'],
  ['atlas_move', 'Prepares the move of one Point or Facet file within its Tree, with the path links to and from it repaired, and saves it as a draft. Use it instead of writing the move by hand; IDs do not change.', object({ baseline: hash, point: id, facet: id, tree: id, path: text(1000), reason }, ['baseline', 'path', 'reason']), 'saves'],
  ['atlas_stamp', 'Prepares a change that records what the sources of the selected Points, of one Tree or of every record cite now, and saves it as a draft. Use it after you have read those records against their sources, never before.', object({ baseline: hash, points: array(id), tree: id, all: only, reason, limit: number(100) }, ['baseline']), 'saves'],
];

export const TOOLS = definitions.map(([name, description, inputSchema, effect]) => ({
  name, description, inputSchema,
  annotations: { readOnlyHint: effect === 'reads', destructiveHint: effect === 'writes', idempotentHint: effect === 'reads', openWorldHint: false },
}));

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function validate(schema, value, location = 'arguments') {
  if (schema.enum && !schema.enum.includes(value)) fail('INVALID_ARGUMENT', `${location} has an unsupported value.`);
  const types = schema.type ? Array.isArray(schema.type) ? schema.type : [schema.type] : [];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(kind) && !(kind === 'number' && types.includes('integer') && Number.isSafeInteger(value))) fail('INVALID_ARGUMENT', `${location} has the wrong type.`);
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || schema.pattern && !new RegExp(schema.pattern).test(value))) fail('INVALID_ARGUMENT', `${location} has invalid text or exceeds its bound.`);
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail('INVALID_ARGUMENT', `${location} is outside its bound.`);
  if (kind === 'array') {
    if (value.length > (schema.maxItems ?? 1000)) fail('INVALID_ARGUMENT', `${location} has too many entries.`);
    if (value.length < (schema.minItems ?? 0)) fail('INVALID_ARGUMENT', `${location} has too few entries.`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail('INVALID_ARGUMENT', `${location} repeats an entry.`);
    value.forEach((item, index) => validate(schema.items, item, `${location}[${index}]`));
  }
  if (kind === 'object') {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) fail('INVALID_ARGUMENT', `${location}.${required} is required.`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) fail('INVALID_ARGUMENT', `${location}.${key} is not supported.`);
      validate(schema.properties[key], value[key], `${location}.${key}`);
    }
  }
}

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
/** A result whose lists hold at most 100 entries each, with `bounds` giving how many there are, beside any bounds it had. */
function bounded(result, lists = ['diagnostics', 'changes', 'ignored']) {
  const bounds = { ...result.bounds };
  for (const list of lists) if (Array.isArray(result[list])) {
    bounds[list] = { available: result[list].length, returned: Math.min(result[list].length, 100) };
    result = { ...result, [list]: result[list].slice(0, 100) };
  }
  return { ...result, bounds };
}
const CHECK_LIMITS = ['Only Checks whose status is active govern.', 'Atlas does not evaluate a Check. A reviewer verifies each applicable Check against the exact candidate and reports pass, fail or unable with its evidence.'];

/** One record of a captured view, in the envelope both adapters use. A captured file is returned even when the Atlas is invalid. */
export function inspectRecord(view, kind, selector) {
  const ready = view.status === 'ready';
  const result = (status, body) => ({ format: 'atlas.inspection/1', status, identity: view.identity, kind, ...body, diagnostics: view.diagnostics });
  if (kind === 'checks') return result(ready ? 'ready' : 'unavailable', { records: ready ? view.atlas.checks : [], limits: CHECK_LIMITS });
  if (kind === 'path') {
    const record = view.files.find(file => file.path === selector) ?? null;
    return result(record ? 'ready' : 'missing', { record });
  }
  const record = !ready ? null : kind === 'point' ? getPoint(view, selector) : kind === 'tree' ? getTree(view, selector) : kind === 'facet' ? getFacet(view, selector) : view.atlas.style;
  return result(!ready ? 'unavailable' : record ? 'ready' : 'missing', { record });
}

/** Links and citations as authored: every one, the citers of one record, or the citations of one source URI. */
export function references(view, request) {
  const selectors = ['point', 'facet', 'uri'].filter(key => request[key] !== undefined);
  if (selectors.length > 1 || (request.tree !== undefined) !== (request.facet !== undefined)) fail('INVALID_REQUEST', 'Select nothing, one Point, one Facet with its Tree, or one source URI.');
  if (request.uri !== undefined) return sourceCitations(view, request);
  if (selectors.length) return directCiters(view, request.point !== undefined ? { point: request.point } : { facet: request.facet, tree: request.tree }, request.limit === undefined ? {} : { limit: request.limit });
  return referenceIndex(view, request);
}

/**
 * The stale report as both adapters give it: its counts and its summary, each changed or missing source once with the
 * records that cite it; with `full`, also the entry of each reference. `bounds.next` continues what was asked for.
 */
export async function stale(view, { full = false, ...request }, allowedRoots) {
  const report = await staleSources(view, { ...request, references: full === true, allowedRoots });
  const next = report.bounds.next && (({ references: _, ...rest }) => ({ ...rest, ...(full === true ? { full: true } : {}) }))(report.bounds.next);
  return { ...report, bounds: { ...report.bounds, next } };
}

/** A Point's line in an outline: two spaces for each level below the top claim, its ID, its title, and its standing when it has a Type. */
const outlineLine = (point, depth) => `${'  '.repeat(depth)}${point.id}: ${point.title}${point.type === 'decision' ? ` [decision: ${point.status}]` : point.type === 'observation' ? ` [observation: ${point.observedAt}]` : ''}`;

/**
 * Every account of the Atlas, or the one `tree` names, as `{ id, title, scope, outline }`: `outline` holds one line for
 * each of its Points as the Tree places them, the top claim first and each development under the claim it develops.
 * It holds no explanation; the reader chooses a Point from it and reads that Point whole.
 */
export function outline(view, tree) {
  const result = (status, trees) => ({ format: 'atlas.outline/1', status, identity: view.identity, ...(tree === undefined ? {} : { tree }), trees, diagnostics: view.diagnostics });
  if (view.status !== 'ready') return result('unavailable', []);
  const chosen = view.atlas.trees.filter(item => tree === undefined || item.id === tree);
  if (tree !== undefined && !chosen.length) return result('missing', []);
  const points = new Map(view.atlas.points.map(point => [point.id, point]));
  return result('ready', chosen.map(item => {
    const lines = [outlineLine(points.get(item.base), 0)];
    const walk = (placements, depth) => { for (const placement of placements ?? []) { lines.push(outlineLine(points.get(placement.point), depth)); walk(placement.children, depth + 1); } };
    walk(item.children, 1);
    return { id: item.id, title: item.title, scope: item.scope, outline: lines };
  }));
}

/**
 * Lexical candidates of both kinds as summaries, unless the request says otherwise, with how many matched in all:
 * `bounds` says how many were returned of how many, and `next` is the request for the next page, or null.
 */
export function search(view, request) {
  request = { kinds: ['point', 'facet'], presentation: 'summary', ...request };
  const { results, available } = searchAtlasPage(view, request), offset = request.offset ?? 0;
  return { format: 'atlas.search/1', status: view.status === 'ready' ? 'ready' : 'unavailable', identity: view.identity, request, results,
    bounds: { offset, limit: request.limit ?? 20, available, returned: results.length },
    next: offset + results.length < available ? { ...request, offset: offset + results.length } : null, diagnostics: view.diagnostics };
}

/**
 * The tools that keep or read private state, or read sources (a source read leaves private state out, so it needs the
 * state location too), and atlas_validate with from.
 */
const STATEFUL = ['atlas_read_source', 'atlas_stale', 'atlas_init', 'atlas_candidate', 'atlas_prepare', 'atlas_review', 'atlas_drafts', 'atlas_apply', 'atlas_recover', 'atlas_move', 'atlas_stamp'];
/** What the root itself gives when it is not there or not a directory: the tool then meets it as it always does. */
const ROOT_PROBLEMS = ['ENOENT', 'ENOTDIR', 'UNSAFE_PATH'];

/**
 * One immutable launch scope with an explicit captured-view refresh boundary. The state location is checked once, here,
 * as the Library decides it can be used and creating nothing: one it refuses is the refusal of every tool that needs it,
 * before that tool reads anything. A grant is measured as it is used, resolved.
 */
export function createToolSession(root, { allowedRoots } = {}) {
  root = path.resolve(root);
  if (allowedRoots !== undefined && (!Array.isArray(allowedRoots) || allowedRoots.some(item => typeof item !== 'string' || !item.trim() || item.includes('\0') || path.resolve(item).length > 4096))) fail('INVALID_SCOPE', 'Source grants must be directory paths of at most 4096 characters, without NUL characters.');
  const grants = Object.freeze([...new Set([root, ...(allowedRoots ?? []).map(item => path.resolve(item))])]);
  if (grants.length > 100) fail('INVALID_SCOPE', 'At most 100 distinct source roots, including the Atlas root, may be granted.');
  const stateProblem = (async () => { stateHome(); await checkStateLocation(root); })()
    .then(() => null, error => ROOT_PROBLEMS.includes(error.code) ? null : { code: error.code, message: error.message });
  let captured = null, loading = null, mutationTail = Promise.resolve();
  const view = async () => {
    if (!captured) {
      loading ??= openAtlas(root);
      captured = await loading; loading = null;
    }
    return captured;
  };
  function baseline(current, value) {
    if (value !== current.identity) fail('STALE', 'The baseline is not the Atlas captured for this session. Refresh, read what changed, and prepare again.');
    if (current.status === 'incomplete') fail('INCOMPLETE', 'An incomplete capture cannot be the baseline of a change.');
  }
  /** A change prepared from the files on disk must start from the Atlas this session captured. */
  function sameBaseline(current, identity) {
    if (identity !== current.identity) fail('STALE', 'The Atlas changed on disk after it was captured for this session. Refresh, read what changed, and prepare again.');
  }
  async function mutate(context, action) {
    const prior = mutationTail;
    let release;
    mutationTail = new Promise(resolve => { release = resolve; });
    await prior;
    try {
      if (context.cancelled) fail('CANCELLED', 'Request cancelled before mutation.');
      context.uncancellable = true;
      return await action();
    } finally { release(); }
  }
  const save = (context, plan) => mutate(context, async () => savedDraft(await saveDraft(root, { plan })));
  /** A candidate directory is read only where the launch granted reading: the Atlas's own candidate folder, or an absolute path within the grants. */
  async function grantedCandidate(candidate) {
    if (!candidateName(candidate) && !path.isAbsolute(candidate)) fail('INVALID_ARGUMENT', `The candidate directory must be ${CANDIDATE}, relative to the Atlas root, or an absolute path.`);
    candidate = candidateDirectory(root, candidate);
    let directory;
    try { directory = await realpath(candidate); } catch { fail('UNSAFE_PATH', 'The candidate directory does not exist.'); }
    const roots = [];
    for (const grant of grants) { try { roots.push(await realpath(grant)); } catch { /* A grant that does not exist grants nothing. */ } }
    if (!roots.some(grant => inside(grant, directory))) fail('CANDIDATE_DENIED', `The candidate directory must be ${CANDIDATE} at the Atlas root, or lie within a source root granted at launch (--allow-source-root) and outside the Atlas.`);
    return candidate;
  }
  /** Without part, offset starts each list of a summary, which goes up to 100000; with it, offset is a byte offset into the text. */
  function summaryOffset(args) {
    if (args.part !== 'details' && args.offset > 100000) fail('INVALID_ARGUMENT', 'arguments.offset is outside its bound: at most 100000 without part "details".');
  }
  async function recapture(result) {
    captured = await openAtlas(root);
    return { ...result, view: { status: captured.status, identity: captured.identity } };
  }
  return {
    root, allowedRoots: grants,
    async call(name, args, context = {}) {
      const definition = TOOLS.find(tool => tool.name === name);
      validate(definition.inputSchema, args);
      if (STATEFUL.includes(name) || name === 'atlas_validate' && args.from !== undefined) {
        const problem = await stateProblem;
        if (problem) fail(problem.code, problem.message);
      }
      if (name === 'atlas_guide') return { status: 'ready', ...(args.document ? { document: args.document } : {}), content: await readGuide(args.document) };
      if (name === 'atlas_styles') return args.id ? { status: getStyle(args.id) ? 'ready' : 'missing', style: getStyle(args.id) } : { status: 'ready', styles: listStyles() };
      const current = await view();
      if (context.cancelled) fail('CANCELLED', 'Request cancelled.');
      switch (name) {
        case 'atlas_open': return summarizeAtlas(current, args);
        case 'atlas_refresh': {
          const next = await openAtlas(root);
          if (context.cancelled) fail('CANCELLED', 'Request cancelled.');
          captured = next;
          return { ...summarizeAtlas(next, args), comparison: compareViews(current, next) };
        }
        case 'atlas_inspect': {
          const selected = ['point', 'tree', 'facet', 'style', 'checks', 'path'].filter(key => args[key] !== undefined);
          if (selected.length !== 1) fail('INVALID_ARGUMENT', 'Select exactly one of point, tree, facet, style, checks or path.');
          const result = inspectRecord(current, selected[0], args[selected[0]]);
          return args.part === 'details' ? readJsonChunk(result.records ?? result.record, args) : result;
        }
        case 'atlas_outline': return outline(current, args.tree);
        case 'atlas_search': return search(current, args);
        case 'atlas_route': return route(current, args);
        case 'atlas_references': return references(current, args);
        case 'atlas_read_source': return readSource(current, args.source, { allowedRoots: grants, maxBytes: args.maxBytes ?? 1024 * 1024 });
        case 'atlas_stale': return stale(current, args, [...grants]);
        case 'atlas_validate': {
          if (args.from === undefined) return bounded({ format: 'atlas.validation/1', status: current.status, identity: current.identity, diagnostics: current.diagnostics });
          return bounded(await validateCandidate(root, await grantedCandidate(args.from), [...grants]));
        }
        case 'atlas_absorb': return inspectAbsorb(current, args);
        case 'atlas_init': {
          baseline(current, args.baseline);
          const { baseline: _, ...request } = args;
          return save(context, prepareInitialization(current, request));
        }
        case 'atlas_candidate': return mutate(context, async () => {
          // The copy is the baseline of the change prepared from it, so it must be the Atlas this session captured.
          sameBaseline(current, (await openAtlas(root)).identity);
          const written = await writeCandidate(root);
          sameBaseline(current, written.baseline);
          return { format: 'atlas.candidate/1', status: 'ready', path: written.path, files: written.files, baseline: written.baseline };
        });
        case 'atlas_prepare': {
          if ((args.changes === undefined) === (args.candidate === undefined)) fail('INVALID_ARGUMENT', 'Supply either changes or a candidate directory.');
          baseline(current, args.baseline);
          if (args.changes) return save(context, await prepareChangeFromDisk(root, { changes: args.changes, reason: args.reason }, { view: current }));
          const plan = await prepareFromCandidate(root, await grantedCandidate(args.candidate), { reason: args.reason });
          sameBaseline(current, plan.baseline.identity);
          return save(context, plan);
        }
        case 'atlas_review': {
          summaryOffset(args);
          const draft = await loadDraft(root, args.id);
          if (args.expectedRevision !== undefined && draft.revision !== args.expectedRevision) fail('STALE_DRAFT', 'The draft is not at that revision; review it and give its exact revision.');
          return reviewDraft(draft, args, await openAtlas(root));
        }
        case 'atlas_drafts': {
          const { action, id: draft, expectedRevision, ...options } = args;
          if (action === 'list') {
            if (draft !== undefined || expectedRevision !== undefined || Object.keys(options).length) fail('INVALID_ARGUMENT', 'list takes no other argument.');
            return { format: 'atlas.drafts/1', status: 'ready', ...await listDrafts(root) };
          }
          if (draft === undefined) fail('INVALID_ARGUMENT', `${action} requires the id of a draft.`);
          if (action === 'delete') {
            if (Object.keys(options).length) fail('INVALID_ARGUMENT', 'delete takes the id and expectedRevision only.');
            return mutate(context, () => deleteDraft(root, draft, { expectedRevision }));
          }
          summaryOffset(options);
          const loaded = await loadDraft(root, draft);
          if (expectedRevision !== undefined && loaded.revision !== expectedRevision) fail('STALE_DRAFT', 'The draft is not at that revision; load it and give its exact revision.');
          return options.part === 'details' ? readJsonChunk(loaded, options) : { status: 'ready', draft: summarizeDraft(loaded, options) };
        }
        case 'atlas_apply': return mutate(context, async () => recapture(await applyDraft(root, args.id, { expectedRevision: args.expectedRevision })));
        case 'atlas_recover': {
          if (args.id === undefined) return { format: 'atlas.transactions/1', status: 'ready', ...await listTransactions(root) };
          return mutate(context, async () => recapture(await recoverChange(root, args.id)));
        }
        case 'atlas_move': {
          baseline(current, args.baseline);
          const { baseline: _, ...request } = args;
          return save(context, prepareMove(current, request));
        }
        case 'atlas_stamp': {
          baseline(current, args.baseline);
          const { baseline: _, limit = 100, ...selection } = args;
          const result = await prepareStamp(root, { ...selection, allowedRoots: [...grants] });
          sameBaseline(current, result.identity);
          return { ...stampReport(result, limit), draft: result.plan.status === 'noop' ? null : await save(context, result.plan) };
        }
      }
    },
  };
}
