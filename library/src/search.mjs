// Shared by the Library and the browser; no filesystem or network access.
const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const COMMON = new Set('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its may me my of on or our should that the their them then there these they this those to was we were what when where which who why will with would you your'.split(' '));
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalized = value => value.normalize('NFKC').toLocaleLowerCase('und');

function termKey(term) {
  // A small plural equivalence, not an English-only tokenizer or a synonym model.
  if (/^[a-z]+$/.test(term)) {
    if (term.length > 4 && /ies$/.test(term)) return term.slice(0, -3) + 'y';
    if (/(ches|shes|xes|zes|sses)$/.test(term)) return term.slice(0, -2);
    if (term.length > 3 && /s$/.test(term) && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);
  }
  return term;
}

function words(value) {
  return [...segmenter.segment(normalized(value ?? ''))].filter(part => part.isWordLike)
    .flatMap(part => part.segment.split(/[-_]/u)).filter(Boolean);
}

function termsFor(query) {
  const terms = [...new Set(words(query))].slice(0, 64);
  const informative = terms.filter(term => !COMMON.has(term));
  // Short labels can legitimately consist only of a common word.
  return informative.length ? informative : terms;
}

function snippet(body, matches) {
  const terms = new Set(matches.filter(match => match.field === 'body').map(match => termKey(match.term)));
  const hit = [...segmenter.segment(body)].find(part => part.isWordLike && terms.has(termKey(normalized(part.segment))));
  let start = Math.max(0, (hit?.index ?? 0) - 70);
  let end = Math.min(body.length, start + 240);
  // Keep the excerpt an exact UTF-16 slice without splitting a surrogate pair.
  if (start && /[\uDC00-\uDFFF]/u.test(body[start])) start--;
  if (end < body.length && /[\uDC00-\uDFFF]/u.test(body[end])) end--;
  return { text: body.slice(start, end), start, end, totalLength: body.length };
}

/** A reading preview, never a generated or separately authored summary. */
export function pointSummary(point, matches = []) {
  const result = {};
  for (const key of ['id', 'tree', 'title', 'path', 'type', 'status', 'observedAt', 'uncertainty']) {
    if (point[key] !== undefined) result[key] = point[key];
  }
  return { ...result, ...(point.kind ? { kind: point.kind } : {}), summary: true, snippet: snippet(point.body ?? '', matches), sourceCount: point.sources?.length ?? 0, selector: { point: point.id } };
}

/** A Facet remains an owned interpretation; previews preserve its host and targets. */
export function facetSummary(facet, matches = []) {
  const { selector, ...summary } = pointSummary(facet, matches);
  return { ...summary, kind: 'facet', on: facet.on, via: facet.via, targets: facet.targets,
    selector: { tree: facet.tree, facet: facet.id } };
}

/** Search separate typed records with the same lexical ranking in every consumer. */
export function searchRecords(atlas, options = {}) {
  const kinds = options.kinds ?? ['point', 'facet'];
  if (!Array.isArray(kinds) || !kinds.length || kinds.length > 2 || new Set(kinds).size !== kinds.length || kinds.some(kind => !['point', 'facet'].includes(kind))) throw new TypeError('Search kinds must contain point, facet, or both without duplicates.');
  const records = [
    ...(kinds.includes('point') ? atlas.points.map(point => ({ ...point, kind: 'point' })) : []),
    ...(kinds.includes('facet') && !options.type ? atlas.facets.map(facet => ({ ...facet, kind: 'facet' })) : []),
  ];
  return searchPoints(records, options);
}

/** Deterministic lexical candidates. Shared consumers still assess meaning. */
export function searchPoints(points, { query, tree, type, limit = 20, offset = 0, presentation = 'full' } = {}) {
  if (typeof query !== 'string' || query.length > 4096 || !query.trim()) return [];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Search limit must be 1..100.');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new TypeError('Search offset must be 0..100000.');
  if (!['full', 'summary'].includes(presentation)) throw new TypeError('Search presentation must be full or summary.');
  const terms = termsFor(query);
  if (!terms.length) return [];
  const candidates = points.filter(point => (!tree || point.tree === tree) && (!type || (point.type ?? 'untyped') === type));
  const records = candidates.map(point => {
    const fields = { id: point.id, title: point.title, body: point.body, uncertainty: point.uncertainty ?? '' };
    const matches = Object.entries(fields).flatMap(([field, value]) => {
      const tokens = new Set(words(value).map(termKey));
      return terms.filter(term => tokens.has(termKey(term))).map(term => ({ field, term }));
    });
    return { point, matches, exact: normalized(query.trim()) === normalized(point.id) };
  });
  const frequencies = new Map(terms.map(term => [term, records.filter(record => record.matches.some(match => match.term === term)).length]));
  return records.filter(record => record.exact || record.matches.length).map(({ point, matches, exact }) => {
    const coverage = new Set(matches.map(match => match.term)).size / terms.length;
    const score = Math.round((Number(exact) * 1000 + coverage * 12 + matches.reduce((total, match) => {
      const weight = 1 + Math.log2((candidates.length + 1) / (frequencies.get(match.term) + 1));
      return total + ({ id: 8, title: 4, body: 1, uncertainty: 1 })[match.field] * weight;
    }, 0)) * 1000) / 1000;
    return { exact, result: {
      ...(presentation === 'summary' ? point.on ? facetSummary(point, matches) : pointSummary(point, matches) : point), score, matches,
      reason: exact ? `Exact ${point.on ? 'Facet' : 'Point'} ID with lexical context; identity does not establish relevance or source support.` : 'Word matches, query coverage and corpus frequency rank lexical candidates; the reader assesses meaning.',
    } };
  }).sort((left, right) => Number(right.exact) - Number(left.exact) || right.result.score - left.result.score || compare(left.result.id, right.result.id) || compare(left.result.kind ?? '', right.result.kind ?? '') || compare(left.result.tree, right.result.tree))
    .slice(offset, offset + limit).map(({ result }) => result);
}
