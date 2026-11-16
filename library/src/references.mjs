import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { openAtlas, observeSource } from './model.mjs';
import { prepareChange } from './authoring.mjs';
import { parseStrictJson, markdownHeadingIds } from './frontmatter.mjs';

export { markdownHeadingIds };

const MAX = 10000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const clone = value => structuredClone(value);
const LIMITS = ['References identify authored citations, not support, dependence or endorsement.', 'Indexing does not read source files or fetch URLs.'];
const valid = view => view?.status === 'ready' && view.atlas;
const records = atlas => [...atlas.points.map(record => ({ ...record, kind: 'point' })), ...atlas.facets.map(record => ({ ...record, kind: 'facet' }))];
const identity = record => ({ kind: record.kind ?? (record.on ? 'facet' : 'point'), id: record.id, tree: record.tree, ...(record.path ? { path: record.path } : {}) });
function requireValue(condition, message) { if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.references.invalid-argument' }); }
function bounded(value = 1000) { requireValue(Number.isSafeInteger(value) && value >= 1 && value <= MAX, 'limit must be 1..10000.'); return value; }
function split(href) { const index = href.indexOf('#'); return index < 0 ? [href, ''] : [href.slice(0, index), href.slice(index)]; }
function localPath(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || /[\x00-\x1f\\?]/.test(decoded) || decoded.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
    return path.posix.normalize(decoded);
  } catch { return null; }
}
function sourcePath(uri) { return localPath(split(uri)[0]); }

/** Resolve only known authored records and sources declared by this record. No I/O. */
export function resolveReference(view, from, href) {
  requireValue(typeof href === 'string' && href.length <= 16384, 'href must be bounded text.');
  if (!valid(view)) return { status: 'unavailable' };
  if (/^https?:\/\//i.test(href)) {
    try { const url = new URL(href); return url.username || url.password ? { status: 'unsupported' } : { status: 'external', href: url.href }; } catch { return { status: 'unsupported' }; }
  }
  const [raw, fragment] = split(href);
  // A link within the record resolves to the record itself; its fragment is a reference diagnostic, as on any link to a record.
  if (!raw && fragment) return { status: 'resolved', target: { ...identity(from), fragment, ...(from.on ? { on: from.on } : {}) } };
  const decoded = localPath(raw);
  if (!decoded) return { status: 'unsupported' };
  const known = [...view.atlas.points.map(record => ({ ...record, kind: 'point' })), ...view.atlas.facets.map(record => ({ ...record, kind: 'facet' }))];
  const fromPath = from.path ?? known.find(record => record.id === from.id && record.tree === from.tree && record.kind === (from.kind ?? (from.on ? 'facet' : 'point')))?.path;
  const relative = fromPath ? path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), decoded)) : null;
  // File-relative links are canonical; Atlas-root paths remain supported for existing content.
  const citations = (from.sources ?? []).map((source, sourceIndex) => ({ source, sourceIndex }));
  for (const candidate of [...new Set([relative, decoded].filter(Boolean))]) {
    const record = known.find(record => record.path === candidate);
    if (record) return { status: 'resolved', target: { ...identity(record), fragment, ...(record.kind === 'facet' ? { on: record.on } : {}) } };
    const matching = citations.filter(({ source }) => sourcePath(source.uri) === candidate);
    const citation = matching.find(({ source }) => split(source.uri)[1] === fragment) ?? matching.find(({ source }) => !split(source.uri)[1]);
    if (citation) return { status: 'resolved', target: { kind: 'source', source: clone(citation.source), sourceIndex: citation.sourceIndex, path: sourcePath(citation.source.uri), fragment } };
  }
  return { status: 'missing', ...(relative ? { candidatePath: relative } : {}) };
}

function markdownLinks(raw, hasHeader) {
  // Normalize line endings while keeping offsets into the original file for reviewed edits.
  let text = '', offsets = [];
  for (let index = 0; index < raw.length; index++) { if (raw[index] === '\r' && raw[index + 1] === '\n') continue; offsets.push(index); text += raw[index]; }
  offsets.push(raw.length);
  const header = hasHeader ? /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text) : null;
  const start = header?.[0].length ?? 0;
  const content = text.slice(start), lines = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') lines.push(i + 1);
  const md = new MarkdownIt({ html: false, linkify: false });
  const original = md.inline.ruler.getRules('').find(rule => rule.name === 'link');
  md.inline.ruler.at('link', (state, silent) => {
    const pos = state.pos, tokenCount = state.tokens.length;
    const labelEnd = state.md.helpers.parseLinkLabel(state, pos, true);
    const accepted = original(state, silent);
    if (accepted && !silent) {
      const token = state.tokens.slice(tokenCount).find(token => token.type === 'link_open');
      if (token) {
        let destination;
        if (!token.meta?.label && state.src[labelEnd + 1] === '(') {
          let dest = labelEnd + 2; while (/\s/.test(state.src[dest] ?? '') && dest < state.src.length) dest++;
          const parsed = md.helpers.parseLinkDestination(state.src, dest, state.src.length);
          if (parsed.ok) destination = { start: dest - pos, end: parsed.pos - pos };
        }
        token.meta = { ...token.meta, captured: { raw: state.src.slice(pos, state.pos), start: pos, destination } };
      }
    }
    return accepted;
  });
  const links = [];
  for (const block of md.parse(content, {})) {
    if (block.type !== 'inline') continue;
    const blockStart = lines[block.map?.[0] ?? 0] ?? 0;
    const blockEnd = lines[block.map?.[1]] ?? content.length;
    // Locate the whole inline input before using parser offsets. Looking for just
    // the link text could instead select identical text inside an earlier code span.
    const inlineStart = block.map ? content.indexOf(block.content, blockStart) : -1;
    const inlineLocated = inlineStart >= blockStart && inlineStart + block.content.length <= blockEnd;
    for (const token of block.children ?? []) {
      if (token.type !== 'link_open') continue;
      const href = token.attrGet('href'), captured = token.meta?.captured;
      const found = captured && inlineLocated ? inlineStart + captured.start : -1;
      const located = found >= blockStart && found + captured.raw.length <= blockEnd && content.slice(found, found + captured.raw.length) === captured.raw;
      const locationStart = start + (located ? found : blockStart);
      const locationEnd = located ? locationStart + captured.raw.length : locationStart;
      const prefix = text.slice(0, locationStart);
      const location = { start: offsets[locationStart], end: offsets[locationEnd], line: prefix.split('\n').length, column: locationStart - prefix.lastIndexOf('\n') };
      const destination = located && captured.destination ? { start: offsets[locationStart + captured.destination.start], end: offsets[locationStart + captured.destination.end] } : undefined;
      links.push({ href, location, ...(destination ? { destination } : {}), syntax: token.meta?.label ? 'reference' : captured ? 'inline' : 'autolink' });
      if (links.length > MAX) return links;
    }
  }
  return links;
}

/** Derive bounded references and source citations without changing format validity. */
export function referenceIndex(view, { limit = 1000 } = {}) {
  limit = bounded(limit);
  const result = { format: 'atlas.references/1', status: valid(view) ? 'ready' : 'unavailable', identity: view?.identity ?? null, references: [], citations: [], diagnostics: [], bounds: { limit, references: { available: 0, returned: 0 }, citations: { available: 0, returned: 0 }, exhaustive: true }, limits: [...LIMITS] };
  if (!valid(view)) return result;
  // `exhaustive` holds while the scan reads every link and citation; it is set false below when the lists hold fewer than were found.
  let complete = true;
  const files = new Map((view.files ?? []).map(file => [file.path, file.content]));
  for (const record of records(view.atlas)) {
    const from = identity(record);
    for (const source of record.sources ?? []) {
      result.bounds.citations.available++;
      if (result.citations.length < limit) result.citations.push({ from, source: clone(source) });
      if (result.bounds.citations.available > MAX) { complete = false; break; }
    }
    const raw = files.get(record.path);
    for (const link of markdownLinks(typeof raw === 'string' ? raw : record.body ?? '', typeof raw === 'string')) {
      result.bounds.references.available++;
      const resolution = resolveReference(view, record, link.href);
      if (result.references.length < limit) result.references.push({ from, ...link, ...resolution });
      if (['missing', 'unsupported'].includes(resolution.status) && result.diagnostics.length < limit) result.diagnostics.push({ code: resolution.status === 'missing' ? 'REFERENCE_MISSING' : 'REFERENCE_UNSUPPORTED', path: record.path, line: link.location.line, column: link.location.column, message: `${resolution.status === 'missing' ? 'Unresolved' : 'Unsupported'} Markdown reference: ${link.href}` });
      // A record is read whole and a reader's address names the record alone, so a link to a record carries no fragment.
      if (resolution.status === 'resolved' && resolution.target.kind !== 'source' && resolution.target.fragment && result.diagnostics.length < limit) result.diagnostics.push({ code: 'REFERENCE_FRAGMENT', path: record.path, line: link.location.line, column: link.location.column, message: `A link to a record names the record's file and carries no fragment: ${link.href}` });
      if (result.bounds.references.available > MAX) { complete = false; break; }
    }
    if (!complete) break;
  }
  result.bounds.references.returned = result.references.length; result.bounds.citations.returned = result.citations.length;
  // Never exhaustive while more remains: past the scan's bound, or beyond the lists' limit.
  result.bounds.exhaustive = complete && result.references.length === result.bounds.references.available && result.citations.length === result.bounds.citations.available;
  if (!complete) result.diagnostics.push({ code: 'REFERENCE_LIMIT', path: '', message: 'Reference scan reached its 10000-entry bound; results are incomplete.' });
  return result;
}

export function directCiters(view, target, { limit = 100 } = {}) {
  limit = bounded(limit);
  requireValue(target && (typeof target.point === 'string' && target.facet === undefined || typeof target.facet === 'string' && typeof target.tree === 'string' && target.point === undefined), 'Select a Point or a Facet and its Tree.');
  const index = referenceIndex(view, { limit: MAX }), grouped = new Map();
  for (const reference of index.references) {
    const match = reference.status === 'resolved' && (target.point ? reference.target.kind === 'point' && reference.target.id === target.point : reference.target.kind === 'facet' && reference.target.id === target.facet && reference.target.tree === target.tree);
    if (!match) continue;
    const key = `${reference.from.kind}/${reference.from.tree}/${reference.from.id}`;
    if (!grouped.has(key)) grouped.set(key, { record: reference.from, references: [] });
    grouped.get(key).references.push(reference);
  }
  return { format: 'atlas.citers/1', status: index.status, identity: index.identity, citers: [...grouped.values()].slice(0, limit), bounds: { available: grouped.size, returned: Math.min(grouped.size, limit), exhaustive: index.bounds.exhaustive && grouped.size <= limit }, limits: [...LIMITS] };
}

export function sourceCitations(view, { uri, limit = 100 } = {}) {
  limit = bounded(limit); requireValue(typeof uri === 'string' && uri.length > 0 && uri.length <= 16384, 'An exact source URI is required.');
  const index = referenceIndex(view, { limit: MAX });
  const citations = index.citations.filter(citation => citation.source.uri === uri);
  return { format: 'atlas.source-citations/1', status: index.status, identity: index.identity, uri, citations: citations.slice(0, limit), bounds: { available: citations.length, returned: Math.min(citations.length, limit), exhaustive: index.bounds.exhaustive && citations.length <= limit }, limits: [...LIMITS] };
}

/** Prepare a same-owner path move and all safely located inline path repairs. Never apply. */
export function prepareMove(view, input) {
  requireValue(valid(view) && view.format === 'atlas.view/1', 'A valid captured Atlas is required.');
  requireValue(input && Object.keys(input).every(key => ['point', 'facet', 'tree', 'path', 'reason'].includes(key)) && (typeof input.point === 'string' && input.facet === undefined && input.tree === undefined || typeof input.facet === 'string' && typeof input.tree === 'string' && input.point === undefined), 'Select exactly one Point or a Facet with its Tree.');
  requireValue(input && typeof input.path === 'string' && typeof input.reason === 'string' && input.reason.trim(), 'Provide destination path and reason.');
  const record = input.point ? view.atlas.points.find(point => point.id === input.point) : view.atlas.facets.find(facet => facet.id === input.facet && facet.tree === input.tree);
  requireValue(record, 'The selected record does not exist.');
  const kind = input.point ? 'point' : 'facet';
  if (input.path === record.path) return prepareChange(view, { changes: [], reason: input.reason });
  requireValue(input.path.toLowerCase() !== record.path.toLowerCase(), 'A case-only move aliases the existing record path.');
  const tree = view.atlas.trees.find(tree => tree.id === record.tree), folder = `${path.posix.dirname(tree.path)}/${kind === 'point' ? 'points' : 'facets'}/`;
  requireValue(input.path.startsWith(folder) && input.path.endsWith('.md') && path.posix.normalize(input.path) === input.path && !input.path.includes('\\') && !input.path.split('/').some(part => part.startsWith('.atlas-')) && input.path.normalize('NFC') === input.path, 'Moves must retain the owning Tree and record kind in a normalized Markdown path.');
  const exists = view.files.some(file => file.path.normalize('NFC').toLowerCase() === input.path.toLowerCase() && file.path !== record.path);
  requireValue(!exists, 'The destination already exists or aliases an authored path.');
  const index = referenceIndex(view, { limit: MAX });
  requireValue(index.bounds.exhaustive, 'The reference scan is incomplete; no partial move is prepared.');
  const edits = new Map(), raw = new Map(view.files.map(file => [file.path, file.content]));
  function add(file, destination, replacement) { if (!edits.has(file)) edits.set(file, []); edits.get(file).push({ ...destination, replacement }); }
  for (const link of index.references) {
    if (link.href.startsWith('#')) continue;
    const incoming = link.status === 'resolved' && link.target.kind === kind && link.target.id === record.id && link.target.tree === record.tree;
    const outgoing = link.from.path === record.path && !/^(?:https?:\/\/|#)/i.test(link.href);
    if (!incoming && !outgoing) continue;
    requireValue(link.status === 'resolved' && link.destination, `Cannot safely repair ${link.syntax} reference at ${link.from.path}:${link.location.line}; repair it explicitly before moving.`);
    const targetPath = incoming ? input.path : link.target.path;
    requireValue(targetPath, 'The referenced target has no captured path.');
    const fromPath = link.from.path === record.path ? input.path : link.from.path;
    const relative = path.posix.relative(path.posix.dirname(fromPath), targetPath) || path.posix.basename(targetPath);
    const replacement = relative.split('/').map(component => encodeURIComponent(component).replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29')).join('/') + split(link.href)[1];
    add(link.from.path, link.destination, replacement);
  }
  for (const [file, replacements] of edits) {
    let content = raw.get(file); requireValue(typeof content === 'string', 'The record bytes are unavailable.');
    for (const edit of replacements.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.replacement + content.slice(edit.end);
    raw.set(file, content);
  }
  raw.set(input.path, raw.get(record.path)); if (input.path !== record.path) raw.delete(record.path);
  const originals = new Map(view.files.map(file => [file.path, file.content]));
  const changes = [...new Set([...edits.keys(), input.path, record.path])].filter(file => (raw.get(file) ?? null) !== (originals.get(file) ?? null)).map(file => ({ path: file, content: raw.get(file) ?? null }));
  const plan = prepareChange(view, { changes, reason: input.reason });
  if (plan.status === 'ready') {
    // A new file-relative match can shadow an unchanged Atlas-root fallback.
    // Check every occurrence after repair, not only links to/from the moved file.
    const candidate = referenceIndex(plan.candidate, { limit: MAX });
    requireValue(candidate.bounds.exhaustive, 'The candidate reference scan is incomplete; no partial move is prepared.');
    const key = reference => `${reference.from.kind}/${reference.from.tree}/${reference.from.id}`;
    const meaning = reference => {
      if (reference.status !== 'resolved') return [reference.status, reference.status === 'external' ? reference.href : null];
      const target = reference.target;
      return target.kind === 'source' ? ['source', target.source.uri, target.sourceIndex, target.fragment] : [target.kind, target.tree, target.id, target.fragment];
    };
    const before = new Map(), after = new Map();
    for (const [scanned, groups] of [[index, before], [candidate, after]]) for (const reference of scanned.references) {
      if (!groups.has(key(reference))) groups.set(key(reference), []);
      groups.get(key(reference)).push(meaning(reference));
    }
    requireValue(before.size === after.size && [...before].every(([owner, references]) => JSON.stringify(references) === JSON.stringify(after.get(owner))),
      'The destination would change another reference target or link interpretation; choose another path or repair the ambiguous links explicitly.');
  }
  return plan;
}

const remote = uri => /^https?:\/\//i.test(uri);
const citer = record => ({ ...identity(record), ...(record.on ? { on: record.on } : {}) });

function requireGrants(allowedRoots) {
  requireValue(allowedRoots === undefined || Array.isArray(allowedRoots) && allowedRoots.length <= 100 && allowedRoots.every(root => typeof root === 'string' && path.isAbsolute(root)), 'Source roots must be at most 100 absolute directory paths.');
}

/** Read each distinct reference once per report, within the grants or else the Atlas root. Observations keep no content. */
function sourceObserver(view, allowedRoots) {
  const observed = new Map();
  return uri => {
    if (!observed.has(uri)) observed.set(uri, observeSource(view, { uri }, { allowedRoots, maxBytes: MAX_SOURCE_BYTES }));
    return observed.get(uri);
  };
}

/** A local reference cites nothing when its file is absent or its fragment names no heading in the file. */
const citesNothing = observation => observation.status === 'missing' || observation.status === 'ready' && !observation.cited;

function unread(observation) {
  return observation.status === 'missing' ? { status: 'missing', reason: 'The cited file does not exist.' }
    : observation.status === 'ready' ? { status: 'missing', code: observation.code, reason: observation.message }
    : { status: 'denied', ...(observation.code ? { code: observation.code } : {}), reason: observation.message };
}

const selector = item => item && typeof item === 'object' && !Array.isArray(item) && (
  Object.keys(item).length === 1 && typeof item.point === 'string' ||
  Object.keys(item).length === 2 && typeof item.tree === 'string' && typeof item.facet === 'string');
const selectorKey = item => item.point !== undefined ? `point:${item.point}` : `facet:${item.tree}/${item.facet}`;

/** The records a stale report reads: every Point and Facet, or the given ones, in record order. */
function selectedRecords(atlas, selection) {
  const all = records(atlas);
  if (selection === undefined) return all;
  const wanted = new Set(selection.map(selectorKey));
  const chosen = all.filter(record => wanted.has(record.kind === 'point' ? `point:${record.id}` : `facet:${record.tree}/${record.id}`));
  if (chosen.length < wanted.size) {
    const found = new Set(chosen.map(record => record.kind === 'point' ? `point:${record.id}` : `facet:${record.tree}/${record.id}`));
    const unknown = selection.filter(item => !found.has(selectorKey(item))).slice(0, 20).map(item => item.point ?? `${item.tree}/${item.facet}`);
    throw Object.assign(new Error(`The Atlas holds no such ${unknown.length === 1 ? 'record' : 'records'}: ${unknown.join(', ')}.`), { code: 'INVALID_REQUEST' });
  }
  return chosen;
}

/**
 * Compare the stamped local sources with what they cite now, and say which local references cite nothing: a file that is
 * not there, or a heading the file does not have. With `records`, only the references of those Points and Facets are read
 * and reported, and the counts and bounds cover them alone. With `references: false` the report leaves out the entry of
 * each reference: `limit`, `offset` and `bounds.next` then page the summary alone. One report reads at most 10000
 * references; `bounds.unread` says how many it did not read past that bound. `bounds.exhaustive` is true only when
 * nothing remains to be read past this page and none was left unread. Reads within the grants; rewrites nothing.
 */
export async function staleSources(view, { allowedRoots, limit = 100, offset = 0, expectedIdentity, records: selection, references: listed = true } = {}) {
  limit = bounded(limit);
  requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX, 'offset must be 0..10000.');
  requireGrants(allowedRoots);
  requireValue(selection === undefined || Array.isArray(selection) && selection.length >= 1 && selection.length <= MAX && selection.every(selector) &&
    new Set(selection.map(selectorKey)).size === selection.length, 'records must be 1..10000 distinct entries, each { point } or { tree, facet }.');
  requireValue(typeof listed === 'boolean', 'references must be true or false.');
  if (expectedIdentity !== undefined && expectedIdentity !== view?.identity) throw Object.assign(new Error('The Atlas changed; restart the stale report from offset zero.'), { code: 'STALE' });
  const result = { format: 'atlas.stale/1', status: valid(view) ? 'ready' : 'unavailable', identity: view?.identity ?? null,
    counts: { references: 0, current: 0, changed: 0, missing: 0, denied: 0, unstamped: 0, remote: 0 }, references: [], summary: [],
    bounds: { limit, offset, references: { available: 0, returned: 0 }, summary: { available: 0, returned: 0 }, unread: 0, exhaustive: true, next: null },
    limits: ['A changed source is a reason to read the explanation again. It does not establish that the explanation is false.', 'current means the cited material matches its stamp. It does not establish that the explanation is true.', 'Remote references are not read. An unstamped local reference is read only to learn whether what it cites is there.'] };
  // Without the entry of each reference, the report is its counts and its summary.
  const shaped = report => {
    if (listed) return report;
    const { references: _, ...summarized } = report, { references: __, ...bounds } = report.bounds;
    return { ...summarized, bounds };
  };
  if (!valid(view)) return shaped(result);
  const chosen = selectedRecords(view.atlas, selection);
  const observe = sourceObserver(view, allowedRoots), summary = new Map();
  const cited = chosen.reduce((total, record) => total + (record.sources?.length ?? 0), 0);
  scan: for (const record of chosen) {
    for (const [sourceIndex, source] of (record.sources ?? []).entries()) {
      if (result.counts.references === MAX) break scan;
      let entry;
      if (remote(source.uri)) entry = { status: 'remote', reason: 'Remote references are never fetched.' };
      else {
        const observation = await observe(source.uri);
        if (citesNothing(observation)) entry = unread(observation);
        // An unstamped reference that could not be read says why, so that a reader does not take it for one that was checked.
        else if (!source.sha256) entry = observation.status === 'ready' ? { status: 'unstamped', reason: 'This local reference carries no stamp.' }
          : { status: 'unstamped', ...(observation.code ? { code: observation.code } : {}), reason: `This local reference carries no stamp and was not read: ${observation.message}` };
        else if (observation.status !== 'ready') entry = unread(observation);
        else if (observation.cited.sha256 === source.sha256) entry = { status: 'current', cited: { ...observation.cited }, reason: 'The cited material matches the stamp.' };
        else entry = { status: 'changed', cited: { ...observation.cited }, reason: 'The cited material differs from the stamp.' };
      }
      if (listed && result.counts.references >= offset && result.references.length < limit) result.references.push({ from: citer(record), sourceIndex, source: clone(source), ...entry });
      result.counts.references++; result.counts[entry.status]++;
      if (entry.status !== 'changed' && entry.status !== 'missing') continue;
      if (!summary.has(source.uri)) summary.set(source.uri, { uri: source.uri, status: entry.status, ...(entry.code ? { code: entry.code } : {}), citers: [] });
      const citers = summary.get(source.uri).citers;
      if (!citers.some(item => item.kind === record.kind && item.tree === record.tree && item.id === record.id)) citers.push(citer(record));
    }
  }
  result.summary = [...summary.values()].slice(offset, offset + limit);
  result.bounds.references = { available: result.counts.references, returned: result.references.length };
  result.bounds.summary = { available: summary.size, returned: result.summary.length };
  // Past the bound the report says how many references it did not read; it never calls itself exhaustive then.
  result.bounds.unread = cited - result.counts.references;
  const paged = listed ? result.counts.references : summary.size;
  if (offset + limit < paged) result.bounds.next = { offset: offset + limit, limit, expectedIdentity: view.identity, ...(selection ? { records: clone(selection) } : {}), ...(listed ? {} : { references: false }) };
  result.bounds.exhaustive = result.bounds.unread === 0 && result.bounds.next === null;
  return shaped(result);
}

/** Locate the members and elements of a JSON text that strict parsing has already accepted. */
function jsonSpans(text) {
  let at = 0;
  const space = () => { while (/[\x20\t\r\n]/.test(text[at] ?? '')) at++; };
  const string = () => { const start = at++; while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1; return { start, end: ++at }; };
  function value() {
    space();
    const start = at, opening = text[at];
    if (opening === '"') return string();
    if (opening !== '{' && opening !== '[') { while (at < text.length && !/[\x20\t\r\n,\]}]/.test(text[at])) at++; return { start, end: at }; }
    const items = [];
    at++; space();
    if (text[at] === '}' || text[at] === ']') return { start, end: ++at, items };
    do {
      space();
      const key = opening === '{' ? string() : null;
      if (key) { space(); at++; }
      const item = value();
      items.push(key ? { key: JSON.parse(text.slice(key.start, key.end)), keyStart: key.start, keyEnd: key.end, value: item } : item);
      space();
    } while (text[at++] === ',');
    return { start, end: at, items };
  }
  return value();
}

/** Write stamps into a record's header. Every other header byte and all body bytes stay as authored. */
function stampedRecord(text, stamps) {
  const opening = /^---\r?\n/.exec(text), closing = /\r?\n---(?:\r?\n|$)/.exec(text.slice(opening[0].length - 1));
  const start = opening[0].length, end = start - 1 + closing.index, header = text.slice(start, end);
  const expected = parseStrictJson(header);
  for (const [index, sha256] of stamps) expected.sources[index].sha256 = sha256;
  const sources = jsonSpans(header).items.find(member => member.key === 'sources').value.items, edits = [];
  for (const [index, sha256] of stamps) {
    const members = sources[index].items, stamp = members.find(member => member.key === 'sha256');
    if (stamp) { edits.push({ start: stamp.value.start, end: stamp.value.end, text: JSON.stringify(sha256) }); continue; }
    const colon = header.slice(members[0].keyEnd, members[0].value.start), lead = header.slice(sources[index].start + 1, members[0].keyStart);
    const separator = members.length > 1 ? header.slice(members.at(-2).value.end, members.at(-1).keyStart) : lead.includes('\n') ? `,${lead}` : colon.endsWith(' ') ? ', ' : ',';
    edits.push({ start: members.at(-1).value.end, end: members.at(-1).value.end, text: `${separator}"sha256"${colon}${JSON.stringify(sha256)}` });
  }
  let stamped = header;
  for (const edit of edits.sort((a, b) => b.start - a.start)) stamped = stamped.slice(0, edit.start) + edit.text + stamped.slice(edit.end);
  let verified = false;
  try { verified = JSON.stringify(parseStrictJson(stamped)) === JSON.stringify(expected); } catch { /* Fall back to a complete header. */ }
  if (!verified) stamped = header.includes('\n') ? JSON.stringify(expected, null, 2).replaceAll('\n', header.includes('\r\n') ? '\r\n' : '\n') : JSON.stringify(expected);
  return text.slice(0, start) + stamped + text.slice(end);
}

/** Prepare a change that records what the readable local sources of the selected records cite now. Never apply. */
export async function prepareStamp(root, input = {}) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['points', 'tree', 'all', 'reason', 'allowedRoots'].includes(key)), 'Unknown stamp option.');
  const { points, tree, all, reason = 'Record the sources as read', allowedRoots } = input;
  requireValue([points, tree, all].filter(value => value !== undefined).length === 1, 'Select Points, one Tree, or all records.');
  requireValue(points === undefined || Array.isArray(points) && points.length > 0 && points.length <= MAX && points.every(id => typeof id === 'string' && ID.test(id)) && new Set(points).size === points.length, 'points must be a nonempty list of unique Point IDs.');
  requireValue(tree === undefined || typeof tree === 'string' && ID.test(tree), 'tree must be an exact Tree ID.');
  requireValue(all === undefined || all === true, 'all must be true when supplied.');
  requireValue(typeof reason === 'string' && reason.trim(), 'reason must be nonblank text.');
  requireGrants(allowedRoots);
  const view = await openAtlas(root);
  if (!valid(view)) throw Object.assign(new Error('A valid Atlas is required before stamping its sources.'), { code: 'INVALID_VIEW' });
  const atlas = view.atlas, observe = sourceObserver(view, allowedRoots);
  for (const id of points ?? []) requireValue(atlas.points.some(point => point.id === id), `Point does not exist: ${id}.`);
  requireValue(tree === undefined || atlas.trees.some(item => item.id === tree), `Tree does not exist: ${tree}.`);
  // A Facet is stamped with the Point it attaches to.
  const selected = records(atlas).filter(record => all || (tree ? record.tree === tree : points.includes(record.on ?? record.id)));
  const stamped = [], current = [], skipped = [], changes = [];
  for (const record of selected) {
    const stamps = new Map();
    for (const [sourceIndex, source] of (record.sources ?? []).entries()) {
      const reference = { from: citer(record), sourceIndex, uri: source.uri };
      if (remote(source.uri)) { skipped.push({ ...reference, status: 'remote', reason: 'Remote references are never fetched.' }); continue; }
      const observation = await observe(source.uri);
      if (observation.status !== 'ready' || !observation.cited) { skipped.push({ ...reference, ...unread(observation) }); continue; }
      const { scope, sha256 } = observation.cited;
      if (source.sha256 === sha256) { current.push({ ...reference, scope, sha256 }); continue; }
      stamps.set(sourceIndex, sha256);
      stamped.push({ ...reference, scope, sha256, ...(source.sha256 ? { previous: source.sha256 } : {}) });
    }
    if (stamps.size) changes.push({ path: record.path, content: stampedRecord(view.files.find(file => file.path === record.path).content, stamps) });
  }
  if (changes.length > 1000) throw Object.assign(new Error('More than 1000 records need a stamp. Stamp one Tree or a set of Points at a time.'), { code: 'LIMIT_EXCEEDED' });
  const plan = prepareChange(view, { changes, reason });
  return { format: 'atlas.stamp/1', status: plan.status, identity: view.identity,
    selection: points ? { points: [...points] } : tree ? { tree } : { all: true },
    counts: { records: selected.length, stamped: stamped.length, current: current.length, skipped: skipped.length }, stamped, current, skipped, plan,
    limits: ['A stamp records what the cited material looked like when this change was prepared. It does not establish that the explanation agrees with it.', 'Nothing is stamped until the prepared change is applied.', 'Remote, missing and denied references keep the stamps they had.'] };
}
