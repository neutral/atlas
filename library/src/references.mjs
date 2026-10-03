import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { readSource } from './model.mjs';
import { prepareChange } from './authoring.mjs';

const MAX = 10000;
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

/** Identical heading identity rules to the Portal's Markdown renderer. */
export function markdownHeadingIds(content, { title } = {}) {
  const used = new Set(), ids = [];
  const text = tokens => tokens.map(token => token.children ? text(token.children) : token.content).join('');
  const add = value => {
    const stem = value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    let slug = stem, suffix = 0;
    while (used.has(slug)) slug = `${stem}-${++suffix}`;
    used.add(slug); ids.push(slug);
  };
  if (title !== undefined) add(title);
  const tokens = new MarkdownIt({ html: false, linkify: false, typographer: false }).parse(content, {});
  for (let index = 0; index < tokens.length; index++) if (tokens[index].type === 'heading_open') add(text(tokens[index + 1]?.children ?? []));
  return ids;
}

function headingObservation(record, fragment) {
  if (!fragment) return {};
  if (typeof record?.body !== 'string') return { heading: { fragment, status: 'uninspected', reason: 'The authored explanation is unavailable in this view.' } };
  let decoded;
  try { decoded = decodeURIComponent(fragment.slice(1)); } catch { return { heading: { fragment, status: 'missing-heading', reason: 'The fragment has malformed percent encoding.' } }; }
  const found = markdownHeadingIds(record.body, { title: record.title }).includes(decoded);
  return { heading: { fragment, status: found ? 'resolved' : 'missing-heading', reason: found ? 'The authored heading is present under Portal heading rules.' : 'The authored explanation has no matching heading.' } };
}

/** Resolve only known authored records and sources declared by this record. No I/O. */
export function resolveReference(view, from, href, { pointPaths = view.atlas?.points ?? [], facetPaths = view.atlas?.facets ?? [] } = {}) {
  requireValue(typeof href === 'string' && href.length <= 16384, 'href must be bounded text.');
  if (!valid(view)) return { status: 'unavailable' };
  if (/^https?:\/\//i.test(href)) {
    try { const url = new URL(href); return url.username || url.password ? { status: 'unsupported' } : { status: 'external', href: url.href }; } catch { return { status: 'unsupported' }; }
  }
  const [raw, fragment] = split(href);
  if (!raw && fragment) {
    const actual = from.body !== undefined ? from : records(view.atlas).find(record => record.id === from.id && record.tree === from.tree && record.kind === (from.kind ?? (from.on ? 'facet' : 'point')));
    return { status: 'resolved', target: { ...identity(from), fragment, ...(from.on ? { on: clone(from.on) } : {}) }, ...headingObservation(actual, fragment) };
  }
  const decoded = localPath(raw);
  if (!decoded) return { status: 'unsupported' };
  const known = [...pointPaths.map(record => ({ ...record, kind: 'point' })), ...facetPaths.map(record => ({ ...record, kind: 'facet' }))];
  const fromPath = from.path ?? known.find(record => record.id === from.id && record.tree === from.tree && record.kind === (from.kind ?? (from.on ? 'facet' : 'point')))?.path;
  const relative = fromPath ? path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), decoded)) : null;
  // File-relative links are canonical; Atlas-root paths remain supported for existing content.
  const citations = (from.sources ?? []).map((source, sourceIndex) => ({ source, sourceIndex }));
  for (const candidate of [...new Set([relative, decoded].filter(Boolean))]) {
    const record = known.find(record => record.path === candidate);
    if (record) {
      const actual = (record.kind === 'point' ? view.atlas.points : view.atlas.facets).find(item => item.id === record.id && item.tree === record.tree);
      if (!actual || actual.publicationAvailable === false) return { status: 'excluded' };
      return { status: 'resolved', target: { ...identity(record), fragment, ...(record.kind === 'facet' ? { on: clone(actual.on) } : {}) }, ...headingObservation(actual, fragment) };
    }
    const matching = citations.filter(({ source }) => sourcePath(source.uri) === candidate);
    const citation = matching.find(({ source }) => split(source.uri)[1] === fragment) ?? matching.find(({ source }) => !split(source.uri)[1]);
    if (citation) {
      const published = view.atlas.format === 'atlas.publication-data/1';
      if (published && (!citation.source.publicationAvailable || !citation.source.publishedPath)) return { status: 'excluded' };
      return { status: 'resolved', target: { kind: 'source', source: clone(citation.source), sourceIndex: citation.sourceIndex, path: sourcePath(citation.source.uri), fragment } };
    }
  }
  return { status: view.atlas.format === 'atlas.publication-data/1' ? 'excluded' : 'missing', ...(relative ? { candidatePath: relative } : {}) };
}

/** Shared browser destinations. Source routes retain the exact owning citation. */
export function referenceHref(resolved, from) {
  if (resolved.status === 'external') return resolved.href;
  if (resolved.status !== 'resolved') return null;
  const target = resolved.target;
  if (target.kind === 'source') {
    if (target.source.publishedPath) return (target.source.publishedHtmlPath ?? target.source.publishedPath) + (target.fragment && target.source.publishedHtmlPath ? `#source-${target.fragment.slice(1)}` : target.fragment);
    const params = new URLSearchParams({ tree: from.tree });
    if (from.on) { const kind = from.on.point ? 'point' : 'branch'; params.set(kind, from.on[kind]); params.set('facet', from.id); }
    else params.set('point', from.id);
    params.set('source', target.source.uri); params.set('sourceIndex', String(target.sourceIndex));
    return `?${params}${target.fragment ? `#source-${target.fragment.slice(1)}` : ''}`;
  }
  const params = new URLSearchParams({ tree: target.tree });
  if (target.kind === 'facet') { const kind = target.on?.point ? 'point' : 'branch'; params.set(kind, target.on?.[kind]); params.set('facet', target.id); }
  else params.set('point', target.id);
  return `?${params}${target.fragment ? `#${target.kind}-${target.id}-${target.fragment.slice(1)}` : ''}`;
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
  const files = new Map((view.files ?? []).map(file => [file.path, file.content]));
  for (const record of records(view.atlas)) {
    const from = identity(record);
    for (const source of record.sources ?? []) {
      result.bounds.citations.available++;
      if (result.citations.length < limit) result.citations.push({ from, source: clone(source) });
      if (result.bounds.citations.available > MAX) { result.bounds.exhaustive = false; break; }
    }
    const raw = files.get(record.path);
    for (const link of markdownLinks(typeof raw === 'string' ? raw : record.body ?? '', typeof raw === 'string')) {
      result.bounds.references.available++;
      const resolution = resolveReference(view, record, link.href);
      if (result.references.length < limit) result.references.push({ from, ...link, ...resolution });
      if (['missing', 'unsupported'].includes(resolution.status) && result.diagnostics.length < limit) result.diagnostics.push({ code: resolution.status === 'missing' ? 'REFERENCE_MISSING' : 'REFERENCE_UNSUPPORTED', path: record.path, line: link.location.line, column: link.location.column, message: `${resolution.status === 'missing' ? 'Unresolved' : 'Unsupported'} Markdown reference: ${link.href}` });
      if (resolution.heading?.status === 'missing-heading' && result.diagnostics.length < limit) result.diagnostics.push({ code: 'REFERENCE_HEADING_MISSING', path: record.path, line: link.location.line, column: link.location.column, message: `Reference record exists, but its heading is missing: ${link.href}` });
      if (result.bounds.references.available > MAX) { result.bounds.exhaustive = false; break; }
    }
    if (!result.bounds.exhaustive) break;
  }
  result.bounds.references.returned = result.references.length; result.bounds.citations.returned = result.citations.length;
  if (!result.bounds.exhaustive) result.diagnostics.push({ code: 'REFERENCE_LIMIT', path: '', message: 'Reference scan reached its 10000-entry bound; results are incomplete.' });
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
  return { format: 'atlas.citers/1', status: index.status, identity: index.identity, citers: [...grouped.values()].slice(0, limit), bounds: { available: grouped.size, returned: Math.min(grouped.size, limit), exhaustive: index.bounds.exhaustive }, limits: [...LIMITS] };
}

export function sourceCitations(view, { uri, limit = 100 } = {}) {
  limit = bounded(limit); requireValue(typeof uri === 'string' && uri.length > 0 && uri.length <= 16384, 'An exact source URI is required.');
  const index = referenceIndex(view, { limit: MAX });
  const citations = index.citations.filter(citation => citation.source.uri === uri);
  return { format: 'atlas.source-citations/1', status: index.status, identity: index.identity, uri, citations: citations.slice(0, limit), bounds: { available: citations.length, returned: Math.min(citations.length, limit), exhaustive: index.bounds.exhaustive }, limits: [...LIMITS] };
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

/** Explicit bounded source observations, separate from authored validity and authority. */
export async function reviewSources(view, { uris, allowedRoots, previous, limit = 100, maxBytes } = {}) {
  limit = bounded(limit);
  requireValue(Array.isArray(allowedRoots) && allowedRoots.length <= 100 && allowedRoots.every(root => typeof root === 'string' && path.isAbsolute(root)), 'Explicit absolute source roots are required.');
  requireValue(uris === undefined || Array.isArray(uris) && uris.length <= MAX && uris.every(uri => typeof uri === 'string' && uri.length > 0 && uri.length <= 16384) && new Set(uris).size === uris.length, 'uris must be a bounded unique list.');
  requireValue(previous === undefined || Array.isArray(previous) && previous.length <= MAX && previous.every(item => item && typeof item.uri === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)) && new Set(previous.map(item => item.uri)).size === previous.length, 'previous must contain unique exact URI and SHA-256 observations.');
  const index = referenceIndex(view, { limit: MAX });
  const available = [...new Set(index.citations.map(citation => citation.source.uri))];
  const selected = uris ?? available;
  const result = { format: 'atlas.source-review/1', status: index.status, identity: index.identity, observedAt: new Date().toISOString(), results: [], bounds: { available: selected.length, returned: Math.min(selected.length, limit), exhaustive: index.bounds.exhaustive }, limits: ['Source changes suggest review; they do not establish changed claim meaning.', 'current means observed against available expected hashes; it does not establish continuing validity.', 'Remote URLs are not fetched.'] };
  if (!valid(view)) return result;
  for (const uri of selected.slice(0, limit)) {
    const citations = index.citations.filter(citation => citation.source.uri === uri);
    if (!citations.length) { result.results.push({ uri, status: 'uninspected', reason: 'No captured record declares this exact URI.', citations: [] }); continue; }
    const source = clone(citations[0].source); delete source.sha256;
    const read = await readSource(view, source, { allowedRoots, ...(maxBytes === undefined ? {} : { maxBytes }) });
    const old = previous?.find(item => item.uri === uri);
    const expectedHashes = [...new Set(citations.flatMap(citation => citation.source.sha256 ? [citation.source.sha256] : []))];
    const mismatches = read.sha256 ? expectedHashes.filter(hash => hash !== read.sha256) : [];
    const changed = read.status === 'ready' && (mismatches.length > 0 || old && old.sha256 !== read.sha256);
    const status = read.status === 'ready' ? changed ? 'changed' : 'current' : read.status === 'reference' ? 'uninspected' : read.status;
    const fragments = [...new Set([split(uri)[1], ...index.references.filter(reference => reference.target?.kind === 'source' && reference.target.source.uri === uri).map(reference => reference.target.fragment)].filter(Boolean))].map(fragment => {
      if (read.status !== 'ready' || !/\.md$/i.test(split(uri)[0])) return { fragment, status: 'uninspected', reason: read.status !== 'ready' ? `Source content was not inspected (${read.status}).` : 'Heading verification is available for Markdown sources only.' };
      let decoded;
      try { decoded = decodeURIComponent(fragment.slice(1)); } catch { return { fragment, status: 'missing-heading', reason: 'The fragment has malformed percent encoding.' }; }
      const found = markdownHeadingIds(read.content).includes(decoded);
      return { fragment, status: found ? 'resolved' : 'missing-heading', reason: found ? 'The heading is present under Portal heading rules.' : 'The readable Markdown source has no matching heading.' };
    });
    result.results.push({ uri, status, citations, fragments, ...(split(uri)[1] ? { fragment: fragments.find(item => item.fragment === split(uri)[1]) } : {}), ...(read.sha256 ? { sha256: read.sha256, bytes: read.bytes } : {}), ...(old ? { previousSha256: old.sha256 } : {}), expectedHashes, mismatchedHashes: mismatches, ...(read.code ? { code: read.code } : {}), reason: read.message });
  }
  return result;
}
