import { searchAtlas } from './model.mjs';
import { createHash } from 'node:crypto';
import { pointSummary, facetSummary } from './search.mjs';

const DETAILS = new Set(['overview', 'standard', 'deep']);
const TYPES = new Set(['decision', 'observation', 'untyped']);
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const pointType = (point) => point.type ?? 'untyped';
const SECTIONS = ['selected', 'supporting', 'facets'];
const HASH = /^[a-f0-9]{64}$/;

function argument(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.route.invalid-argument' });
}

function options(input) {
  argument(input && typeof input === 'object' && !Array.isArray(input), 'Route requires an options object.');
  argument(Object.keys(input).every((key) => ['point', 'tree', 'facet', 'query', 'kinds', 'detail', 'type', 'limit', 'mode', 'orientation', 'cursor'].includes(key)), 'Unknown Route option.');
  const selectors = ['point', 'tree', 'query'].filter((key) => input[key] !== undefined);
  argument(selectors.length === 1, 'Select exactly one Point, Tree or query.');
  argument(input.facet === undefined || selectors[0] === 'tree' && typeof input.facet === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(input.facet), 'A Facet selector requires its owning Tree and exact Facet ID.');
  argument(input.kinds === undefined || Array.isArray(input.kinds) && input.kinds.length > 0 && input.kinds.length <= 2 && new Set(input.kinds).size === input.kinds.length && input.kinds.every(kind => ['point', 'facet'].includes(kind)), 'kinds must select Point, Facet or both without duplicates.');
  const selector = selectors[0];
  argument(typeof input[selector] === 'string' && input[selector].trim().length > 0, `${selector} must be nonblank text.`);
  argument(input[selector].length <= (selector === 'query' ? 4096 : 100), `${selector} exceeds its length bound.`);
  argument(selector === 'query' || /^[a-z0-9][a-z0-9-]{0,99}$/.test(input[selector]), `${selector} must be an exact ID.`);
  const detail = input.detail ?? 'standard', limit = input.limit ?? 8;
  argument(DETAILS.has(detail), 'detail must be overview, standard or deep.');
  argument(input.type === undefined || TYPES.has(input.type), 'type must be decision, observation or untyped.');
  argument(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'limit must be an integer from 1 through 100.');
  argument(input.mode === undefined || ['discover', 'read'].includes(input.mode), 'mode must be discover or read.');
  argument(input.orientation === undefined || ['compact', 'full'].includes(input.orientation), 'orientation must be compact or full.');
  if (input.cursor !== undefined) {
    const cursor = input.cursor;
    argument(cursor && typeof cursor === 'object' && !Array.isArray(cursor) && Object.keys(cursor).length === 4 && Object.keys(cursor).every(key => ['identity', 'request', 'section', 'offset'].includes(key)), 'cursor requires exactly identity, request, section and offset.');
    argument(typeof cursor.identity === 'string' && typeof cursor.request === 'string' && HASH.test(cursor.identity) && HASH.test(cursor.request), 'cursor identity and request must be SHA-256 hashes.');
    argument(SECTIONS.includes(cursor.section) && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0 && cursor.offset <= 1000000, 'cursor section or offset is invalid.');
  }
  return { ...copy(input), detail, limit, mode: input.mode ?? 'read', orientation: input.orientation ?? (input.mode === 'discover' ? 'compact' : 'full') };
}

function requestIdentity(request) {
  return createHash('sha256').update(JSON.stringify({
    point: request.point, tree: request.tree, facet: request.facet, query: request.query, type: request.type, kinds: request.kinds,
    detail: request.detail, limit: request.limit, mode: request.mode, orientation: request.orientation,
  })).digest('hex');
}

function compactReference(record, kind) {
  const result = {};
  for (const key of ['id', 'tree', 'title', 'path', 'type', 'status', 'observedAt', 'uncertainty']) {
    if (record[key] !== undefined) result[key] = copy(record[key]);
  }
  return { ...result, reference: true, ...(kind === 'point' ? { selector: { point: record.id } } : {}) };
}

function treeInfo(tree) {
  return copy({ id: tree.id, title: tree.title, scope: tree.scope, base: tree.base, path: tree.path });
}

function facetContext(atlas, reading) {
  const { facet } = reading;
  const host = facet.on.point ? atlas.points.find(point => point.id === facet.on.point) : atlas.branches.find(branch => branch.id === facet.on.branch && branch.tree === facet.tree);
  const targetRecord = pointer => pointer.point ? atlas.points.find(point => point.id === pointer.point) : pointer.branch ? atlas.branches.find(branch => branch.id === pointer.branch && branch.tree === facet.via) : atlas.trees.find(tree => tree.id === pointer.tree);
  return { ...reading, owner: treeInfo(atlas.trees.find(tree => tree.id === facet.tree)), viaTree: treeInfo(atlas.trees.find(tree => tree.id === facet.via)),
    host: { ...compactReference(host, facet.on.point ? 'point' : 'branch'), kind: facet.on.point ? 'point' : 'branch' },
    targets: facet.targets.map(pointer => {
      const record = targetRecord(pointer), kind = pointer.point ? 'point' : pointer.branch ? 'branch' : 'tree';
      return kind === 'tree' ? { ...treeInfo(record), kind, reference: true, selector: { tree: record.id } } : { ...compactReference(record, kind), kind };
    }),
  };
}

function orientation(atlas, selected, representation) {
  const recordFor = (record, kind) => representation === 'compact' ? compactReference(record, kind) : copy(record);
  const trees = new Map();
  for (const { point } of selected) {
    const tree = atlas.trees.find((item) => item.id === point.tree);
    if (!trees.has(tree.id)) trees.set(tree.id, {
      tree: treeInfo(tree), base: recordFor(atlas.points.find((item) => item.id === tree.base), 'point'),
      ancestors: [], forPoints: [],
    });
    const entry = trees.get(tree.id);
    entry.forPoints.push(point.id);
    for (const ancestor of point.ancestors ?? []) {
      if (ancestor.kind === 'point' && ancestor.id === tree.base) continue;
      if (entry.ancestors.some((item) => item.kind === ancestor.kind && item.id === ancestor.id)) continue;
      const record = ancestor.kind === 'point'
        ? atlas.points.find((item) => item.id === ancestor.id)
        : atlas.branches.find((item) => item.id === ancestor.id && item.tree === point.tree);
      if (record) entry.ancestors.push({ ...copy(ancestor), record: recordFor(record, ancestor.kind) });
    }
  }
  return [...trees.values()];
}

function supporting(atlas, selected, request) {
  if (request.detail === 'overview') return [];
  const selectedIds = new Set(selected.map(({ point }) => point.id));
  const order = new Map();
  function walk(nodes) {
    for (const node of nodes) {
      if (node.point) order.set(node.point, order.size);
      walk(node.children ?? []);
    }
  }
  for (const tree of atlas.trees) { order.set(tree.base, order.size); walk(tree.children); }
  return atlas.points.flatMap((point) => {
    if (selectedIds.has(point.id) || request.type && pointType(point) !== request.type) return [];
    const reasons = [];
    for (const { point: parent } of selected) {
      if (parent.tree !== point.tree) continue;
      const ancestors = point.ancestors ?? [];
      const index = ancestors.findIndex((item) => item.kind === 'point' && item.id === parent.id);
      if (index < 0) continue;
      const pointDepth = ancestors.slice(index + 1).filter((item) => item.kind === 'point').length + 1;
      if (request.detail === 'standard' && pointDepth > 1) continue;
      reasons.push({ kind: 'authored-descendant', point: parent.id, pointDepth });
    }
    return reasons.length ? [{ point: copy(point), reasons }] : [];
  }).sort((left, right) => order.get(left.point.id) - order.get(right.point.id));
}

function relatedFacets(atlas, readings, request) {
  const points = new Set(readings.map(({ point }) => point.id));
  const ancestors = new Set(readings.flatMap(({ point }) => (point.ancestors ?? [])
    .filter((item) => item.kind === 'point').map((item) => item.id)));
  const branches = new Set(readings.flatMap(({ point }) => (point.ancestors ?? [])
    .filter((item) => item.kind === 'branch').map((item) => `${point.tree}/${item.id}`)));
  return atlas.facets.flatMap((facet) => {
    const reasons = [];
    if (facet.on.point && points.has(facet.on.point)) reasons.push({ kind: 'attached-point', point: facet.on.point });
    else if (facet.on.point && ancestors.has(facet.on.point)) reasons.push({
      kind: 'attached-ancestor-point', point: facet.on.point,
      limit: 'The interpretation belongs to the higher explanation. Applying it to a descendant requires separate judgment.',
    });
    if (facet.on.branch && branches.has(`${facet.tree}/${facet.on.branch}`)) reasons.push({
      kind: 'attached-ancestor-branch', tree: facet.tree, branch: facet.on.branch,
      limit: 'The interpretation addresses its host Branch. Applying it to a descendant requires separate judgment.',
    });
    for (const target of facet.targets) {
      if (target.point && points.has(target.point)) reasons.push({ kind: 'incoming-point-reference', point: target.point });
      else if (target.point && ancestors.has(target.point)) reasons.push({ kind: 'incoming-ancestor-point-reference', point: target.point });
      if (target.branch && branches.has(`${facet.via}/${target.branch}`)) reasons.push({
        kind: 'incoming-ancestor-branch-reference', tree: facet.via, branch: target.branch,
        limit: 'The reference addresses the Branch as a whole. Its implications for descendants require review.',
      });
      if (target.tree && request.tree === target.tree) reasons.push({ kind: 'incoming-tree-reference', tree: target.tree });
    }
    return reasons.length ? [{ facet: copy(facet), reasons }] : [];
  });
}

/** Suggest authored reading context and lexical candidates for review. */
export function route(view, input) {
  const request = options(input);
  const requestHash = requestIdentity(request);
  if (request.cursor && request.cursor.identity !== view?.identity) throw Object.assign(new Error('The captured Atlas changed. Start a new Route before continuing.'), { code: 'atlas.route.stale-cursor' });
  if (request.cursor && request.cursor.request !== requestHash) throw Object.assign(new Error('The continuation belongs to a different Route request. Use its complete next request.'), { code: 'atlas.route.cursor-mismatch' });
  const result = {
    format: 'atlas.route/1', status: 'unavailable', identity: copy(view?.identity ?? null), request,
    orientation: [], selected: [], supporting: [], facets: [],
    limits: [
      'Inclusion follows exact identity, authored ancestry, lexical matches or explicit Facets. The reader assesses relevance and source support.',
      'Source content requires a separate read. Route returns the authored references.',
      'Decisions retain their recorded status; observations retain their date and source. Implementation and current validity require supporting evidence.',
    ],
  };
  if (view?.format !== 'atlas.view/1' || view.status !== 'ready' || !view.atlas) return { ...result, diagnostics: copy(view?.diagnostics ?? []), reason: 'A valid normalized Atlas is required.' };
  const atlas = view.atlas;
  let matches, facetMatches = [];
  if (request.facet) {
    const facet = atlas.facets.find(item => item.id === request.facet && item.tree === request.tree);
    facetMatches = facet && !request.type ? [{ facet: copy(facet), reasons: [{ kind: 'exact-facet', tree: facet.tree, facet: facet.id }] }] : [];
    matches = [];
  } else if (request.point) {
    const point = atlas.points.find((item) => item.id === request.point);
    matches = point && (!request.type || pointType(point) === request.type)
      ? [{ point: copy(point), reasons: [{ kind: 'exact-point', point: point.id }] }] : [];
  } else if (request.tree) {
    const tree = atlas.trees.find((item) => item.id === request.tree);
    matches = tree ? atlas.points.filter((point) => point.tree === tree.id &&
      (request.type ? pointType(point) === request.type : point.id === tree.base))
      .map((point) => ({ point: copy(point), reasons: [{ kind: request.type ? 'exact-tree-type-filter' : 'tree-base', tree: tree.id }] })) : [];
  } else {
    const found = searchAtlas(view, { query: request.query, type: request.type, limit: 100, kinds: request.kinds ?? (request.mode === 'discover' ? ['point', 'facet'] : ['point']) });
    facetMatches = found.filter(item => item.kind === 'facet').map(item => ({ facet: copy(atlas.facets.find(facet => facet.id === item.id && facet.tree === item.tree)), reasons: [{ kind: 'lexical-facet-candidate', matches: copy(item.matches), score: item.score, explanation: item.reason }] }));
    matches = found.filter(item => item.kind !== 'facet').map((item) => ({
      point: copy(atlas.points.find((point) => point.id === item.id)),
      reasons: [{ kind: 'lexical-candidate', matches: copy(item.matches), score: item.score, explanation: item.reason }],
    })).filter((item) => item.point);
  }
  const initialSelection = matches.slice(0, request.limit);
  const details = request.mode === 'discover' ? [] : supporting(atlas, initialSelection, request);
  // Facets form one stable section across all supporting pages. Their reasons
  // identify an attachment even when that supporting Point is on another page.
  const related = request.mode === 'discover' ? [] : relatedFacets(atlas, [...initialSelection, ...details], request);
  const facets = [...facetMatches, ...related.filter(item => !facetMatches.some(match => match.facet.tree === item.facet.tree && match.facet.id === item.facet.id))];
  const sections = { selected: matches, supporting: details, facets };
  if (request.cursor) argument(request.cursor.offset <= sections[request.cursor.section].length, 'cursor offset exceeds the selected section.');
  const pages = {}, bounds = { limit: request.limit }, next = {};
  for (const section of SECTIONS) {
    const included = !request.cursor || request.cursor.section === section;
    const offset = request.cursor?.section === section ? request.cursor.offset : 0;
    pages[section] = included ? sections[section].slice(offset, offset + request.limit) : [];
    bounds[section] = { available: sections[section].length, returned: pages[section].length, ...(included ? { offset } : {}) };
    const nextOffset = offset + pages[section].length;
    if (included && nextOffset < sections[section].length) {
      const { cursor, ...original } = request;
      next[section] = { ...original, cursor: { identity: view.identity, request: requestHash, section, offset: nextOffset } };
    }
  }
  const selected = request.mode === 'discover' ? pages.selected.map(({ point, reasons }) => ({
    point: pointSummary(point, reasons.flatMap(reason => reason.matches ?? [])), reasons,
  })) : pages.selected;
  const facetHost = request.facet && facetMatches[0]?.facet;
  const orientationSelection = facetHost ? [{ point: atlas.points.find(point => point.id === (facetHost.on.point ?? atlas.trees.find(tree => tree.id === facetHost.tree).base)) }] : initialSelection;
  return {
    ...result, status: !matches.length && !facetMatches.length ? 'missing' : request.query && matches.length + facetMatches.length > 1 ? 'ambiguous' : 'ready',
    reason: !matches.length && !facetMatches.length ? 'No record satisfies the supplied selector and filters.' : undefined,
    orientation: request.cursor ? [] : orientation(atlas, orientationSelection, request.orientation),
    selected, supporting: pages.supporting, facets: request.mode === 'discover' ? pages.facets.map(({ facet, reasons }) => ({ facet: facetSummary(facet, reasons.flatMap(reason => reason.matches ?? [])), reasons })) : pages.facets.map(reading => facetContext(atlas, reading)), bounds, next,
    ...(request.cursor ? { page: { section: request.cursor.section, offset: request.cursor.offset } } : {}),
    ...(request.query ? { search: { window: 100, exhaustive: matches.length + facetMatches.length < 100,
      limit: 'The search window bounds lexical candidates, not semantic relevance or a complete answer.' } } : {}),
  };
}
