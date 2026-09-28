import { searchAtlas } from './model.mjs';

const DETAILS = new Set(['overview', 'standard', 'deep']);
const TYPES = new Set(['decision', 'observation', 'untyped']);
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const pointType = (point) => point.type ?? 'untyped';

function argument(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.route.invalid-argument' });
}

function options(input) {
  argument(input && typeof input === 'object' && !Array.isArray(input), 'Route requires an options object.');
  argument(Object.keys(input).every((key) => ['point', 'tree', 'query', 'detail', 'type', 'limit'].includes(key)), 'Unknown Route option.');
  const selectors = ['point', 'tree', 'query'].filter((key) => input[key] !== undefined);
  argument(selectors.length === 1, 'Select exactly one Point, Tree or query.');
  const selector = selectors[0];
  argument(typeof input[selector] === 'string' && input[selector].trim().length > 0, `${selector} must be nonblank text.`);
  argument(input[selector].length <= (selector === 'query' ? 4096 : 100), `${selector} exceeds its length bound.`);
  argument(selector === 'query' || /^[a-z0-9][a-z0-9-]{0,99}$/.test(input[selector]), `${selector} must be an exact ID.`);
  const detail = input.detail ?? 'standard', limit = input.limit ?? 8;
  argument(DETAILS.has(detail), 'detail must be overview, standard or deep.');
  argument(input.type === undefined || TYPES.has(input.type), 'type must be decision, observation or untyped.');
  argument(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'limit must be an integer from 1 through 100.');
  return { ...input, detail, limit };
}

function treeInfo(tree) {
  return copy({ id: tree.id, title: tree.title, scope: tree.scope, base: tree.base, path: tree.path });
}

function orientation(atlas, selected) {
  const trees = new Map();
  for (const { point } of selected) {
    const tree = atlas.trees.find((item) => item.id === point.tree);
    if (!trees.has(tree.id)) trees.set(tree.id, {
      tree: treeInfo(tree), base: copy(atlas.points.find((item) => item.id === tree.base)),
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
      if (record) entry.ancestors.push({ ...copy(ancestor), record: copy(record) });
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
  let matches;
  if (request.point) {
    const point = atlas.points.find((item) => item.id === request.point);
    matches = point && (!request.type || pointType(point) === request.type)
      ? [{ point: copy(point), reasons: [{ kind: 'exact-point', point: point.id }] }] : [];
  } else if (request.tree) {
    const tree = atlas.trees.find((item) => item.id === request.tree);
    matches = tree ? atlas.points.filter((point) => point.tree === tree.id &&
      (request.type ? pointType(point) === request.type : point.id === tree.base))
      .map((point) => ({ point: copy(point), reasons: [{ kind: request.type ? 'exact-tree-type-filter' : 'tree-base', tree: tree.id }] })) : [];
  } else {
    const found = searchAtlas(view, { query: request.query, type: request.type, limit: 100 });
    matches = found.map((item) => ({
      point: copy(atlas.points.find((point) => point.id === item.id)),
      reasons: [{ kind: 'lexical-candidate', matches: copy(item.matches), score: item.score, explanation: item.reason }],
    })).filter((item) => item.point);
  }
  const selected = matches.slice(0, request.limit);
  const details = supporting(atlas, selected, request);
  const chosenDetails = details.slice(0, request.limit);
  const facets = relatedFacets(atlas, [...selected, ...chosenDetails], request);
  return {
    ...result, status: !matches.length ? 'missing' : request.query && matches.length > 1 ? 'ambiguous' : 'ready',
    reason: !matches.length ? 'No Point satisfies the supplied selector and type filter.' : undefined,
    orientation: orientation(atlas, selected), selected, supporting: chosenDetails,
    facets: facets.slice(0, request.limit),
    bounds: {
      limit: request.limit, selected: { available: matches.length, returned: selected.length },
      supporting: { available: details.length, returned: chosenDetails.length },
      facets: { available: facets.length, returned: Math.min(facets.length, request.limit) },
    },
    ...(request.query ? { search: { window: 100, exhaustive: matches.length < 100,
      limit: 'The search window bounds lexical candidates, not semantic relevance or a complete answer.' } } : {}),
  };
}
