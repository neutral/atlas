import { searchAtlas, validateSource } from './model.mjs';
import { prepareChange } from './authoring.mjs';

const copy = (value) => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const accepted = (view) => view?.format === 'atlas.view/1' && view.status === 'ready' && view.atlas;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const DISPOSITIONS = new Set(['update', 'create', 'facet', 'conflict', 'reference-only', 'non-integration']);
const STOP = new Set('a an and are as at be been but by can could for from has have in into is it its may not of on or our should that the their then there these this to was were will with would'.split(' '));
const LIMITS = [
  'Candidates and impact paths support review. The author decides identity and how incoming information changes the account.',
  'Source content requires separate reading and verification. Absorb uses the supplied text and references.',
  'Impact review follows recorded relationships. Additional consequences may require investigation.',
];

function argument(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.absorb.invalid-argument' });
}

function object(value, keys, label) {
  argument(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  argument(Object.keys(value).every((key) => keys.includes(key)), `Unknown ${label} field.`);
}

function text(value, label, maximum = 16384) {
  argument(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, `${label} must be nonblank text of at most ${maximum} characters.`);
}

function source(value) {
  const validation = validateSource(value);
  argument(validation.valid, `Invalid source: ${validation.diagnostics.map((item) => item.message).join(' ')}`);
  return copy(value);
}

function termsFrom(incoming) {
  const frequencies = new Map();
  for (const match of incoming.toLocaleLowerCase('en').matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu)) {
    const term = match[0];
    if (term.length > 1 && term.length <= 100 && !STOP.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  return [...frequencies].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .slice(0, 32).map(([term]) => term);
}

/** Inspect incoming material without making an integration decision or preparing writes. */
export function inspectAbsorb(view, input) {
  object(input, ['text', 'source', 'tree', 'limit'], 'Absorb inspection');
  text(input.text, 'text', 1024 * 1024);
  const incomingSource = source(input.source), limit = input.limit ?? 8;
  argument(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'limit must be an integer from 1 through 100.');
  argument(input.tree === undefined || typeof input.tree === 'string' && ID.test(input.tree), 'tree must be an exact Tree ID.');
  const result = {
    format: 'atlas.absorb-inspection/1', status: 'unavailable', identity: copy(view?.identity ?? null),
    incoming: { text: input.text, source: incomingSource }, candidates: [], owners: [], interpretations: [], limits: [...LIMITS],
  };
  const atlas = accepted(view);
  if (!atlas) return { ...result, diagnostics: copy(view?.diagnostics ?? []), reason: 'A valid normalized Atlas is required.' };
  if (input.tree && !atlas.trees.some((tree) => tree.id === input.tree)) return { ...result, status: 'missing', reason: 'The requested owning Tree does not exist.' };
  const terms = termsFrom(input.text);
  const matches = terms.length ? searchAtlas(view, { query: terms.join(' '), tree: input.tree, limit: 100 }) : [];
  const candidates = matches.slice(0, limit).map(({ score, matches: lexicalMatches, reason, ...point }) => ({
    point: copy(point), reasons: [{ kind: 'lexical-candidate', score, matches: copy(lexicalMatches), explanation: reason }],
  }));
  const candidateIds = new Set(candidates.map(({ point }) => point.id));
  const owners = atlas.trees.flatMap((tree) => {
    if (input.tree && input.tree !== tree.id) return [];
    const fields = { title: tree.title, scope: tree.scope };
    const matches = Object.entries(fields).flatMap(([field, value]) => terms.filter((term) => value.toLocaleLowerCase('en').includes(term)).map((term) => ({ field, term })));
    const pointIds = candidates.filter(({ point }) => point.tree === tree.id).map(({ point }) => point.id);
    const reasons = [];
    if (input.tree) reasons.push({ kind: 'caller-selected-tree' });
    if (matches.length) reasons.push({ kind: 'lexical-tree-scope', matches });
    if (pointIds.length) reasons.push({ kind: 'candidate-ownership', points: pointIds });
    return reasons.length ? [{ tree: copy(tree), base: copy(atlas.points.find((point) => point.id === tree.base)), reasons }] : [];
  });
  const branches = new Set(candidates.flatMap(({ point }) => (point.ancestors ?? [])
    .filter((item) => item.kind === 'branch').map((item) => `${point.tree}/${item.id}`)));
  const interpretations = atlas.facets.flatMap((facet) => {
    const reasons = [];
    if (facet.on.point && candidateIds.has(facet.on.point)) reasons.push({ kind: 'attached-candidate', point: facet.on.point });
    if (facet.on.branch && branches.has(`${facet.tree}/${facet.on.branch}`)) reasons.push({ kind: 'attached-ancestor-branch', branch: facet.on.branch, tree: facet.tree });
    for (const target of facet.targets) if (target.point && candidateIds.has(target.point)) reasons.push({ kind: 'incoming-candidate-reference', point: target.point });
    return reasons.length ? [{ facet: copy(facet), reasons }] : [];
  });
  return {
    ...result, status: candidates.length || owners.length ? 'candidates' : 'no-candidates',
    terms, candidates, owners: owners.slice(0, limit), interpretations: interpretations.slice(0, limit),
    bounds: { limit, searchWindow: 100, candidateWindowCount: matches.length, searchExhaustive: matches.length < 100,
      owners: { available: owners.length, returned: Math.min(owners.length, limit) },
      interpretations: { available: interpretations.length, returned: Math.min(interpretations.length, limit) } },
  };
}

function pointChanges(before, after) {
  if (!before) return ['added'];
  if (!after) return ['removed'];
  const changes = [];
  if (before.type !== after.type) changes.push('type');
  if ((before.type === 'decision' || after.type === 'decision') && before.status !== after.status) changes.push('decision-status');
  if ((before.type === 'observation' || after.type === 'observation') && before.observedAt !== after.observedAt) changes.push('observation-date');
  if (before.tree !== after.tree || before.path !== after.path || !same(before.ancestors, after.ancestors)) changes.push('placement');
  if (before.title !== after.title || before.body !== after.body) changes.push('explanation');
  if (!same(before.sources, after.sources)) changes.push('sources');
  if (before.uncertainty !== after.uncertainty) changes.push('uncertainty');
  return changes;
}

function recordsChanged(before, after, key) {
  const left = new Map(before.map((record) => [key(record), record]));
  const right = new Map(after.map((record) => [key(record), record]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((id) => {
    const old = left.get(id) ?? null, current = right.get(id) ?? null;
    return same(old, current) ? [] : [{ id, before: copy(old), after: copy(current) }];
  });
}

function impactContext(atlas, changedPoints, changedFacets, changedTrees, changedBranches, side) {
  const points = new Map(), branches = new Map(), trees = new Map(), facets = new Map();
  function add(map, key, record, reason) {
    if (!record) return;
    if (!map.has(key)) map.set(key, { record: copy(record), reasons: [] });
    const entry = map.get(key);
    if (!entry.reasons.some((value) => same(value, reason))) entry.reasons.push(reason);
  }
  function point(id, reason) {
    const record = atlas.points.find((item) => item.id === id);
    if (!record) return;
    add(points, id, record, reason);
    add(trees, record.tree, atlas.trees.find((item) => item.id === record.tree), { kind: 'owning-tree', point: id });
    for (const ancestor of record.ancestors ?? []) {
      const why = { kind: 'authored-ancestor', point: id };
      if (ancestor.kind === 'point') add(points, ancestor.id, atlas.points.find((item) => item.id === ancestor.id), why);
      else add(branches, `${record.tree}/${ancestor.id}`, atlas.branches.find((item) => item.tree === record.tree && item.id === ancestor.id), why);
    }
  }
  for (const changed of changedPoints) if (changed[side]) point(changed.id, { kind: 'changed-point', changes: changed.changes });
  for (const changed of changedTrees) if (changed[side]) {
    const tree = changed[side];
    add(trees, tree.id, tree, { kind: 'changed-tree' });
    point(tree.base, { kind: 'changed-tree-base', tree: tree.id });
  }
  for (const changed of changedBranches) if (changed[side]) {
    const branch = changed[side];
    add(branches, `${branch.tree}/${branch.id}`, branch, { kind: 'changed-branch' });
    for (const ancestor of branch.ancestors ?? []) if (ancestor.kind === 'point') point(ancestor.id, { kind: 'changed-branch-ancestor', tree: branch.tree, branch: branch.id });
  }
  for (const changed of changedFacets) if (changed[side]) {
    const facet = changed[side];
    add(facets, `${facet.tree}/${facet.id}`, facet, { kind: 'changed-facet' });
    if (facet.on.point) point(facet.on.point, { kind: 'changed-facet-host', tree: facet.tree, facet: facet.id });
    if (facet.on.branch) add(branches, `${facet.tree}/${facet.on.branch}`, atlas.branches.find((item) => item.tree === facet.tree && item.id === facet.on.branch), { kind: 'changed-facet-host', facet: facet.id });
    for (const target of facet.targets) {
      const why = { kind: 'changed-facet-target', tree: facet.tree, facet: facet.id };
      if (target.point) point(target.point, why);
      if (target.branch) add(branches, `${facet.via}/${target.branch}`, atlas.branches.find((item) => item.tree === facet.via && item.id === target.branch), why);
      if (target.tree) add(trees, target.tree, atlas.trees.find((item) => item.id === target.tree), why);
    }
  }
  // One pass over explicit attachments and targets; there is no transitive closure.
  for (const facet of atlas.facets) {
    const key = `${facet.tree}/${facet.id}`;
    if (facet.on.point && points.has(facet.on.point)) add(facets, key, facet, { kind: 'attached-review-point', point: facet.on.point });
    if (facet.on.branch && branches.has(`${facet.tree}/${facet.on.branch}`)) add(facets, key, facet, { kind: 'attached-review-branch', tree: facet.tree, branch: facet.on.branch });
    for (const target of facet.targets) {
      if (target.point && points.has(target.point)) add(facets, key, facet, { kind: 'incoming-point-reference', point: target.point });
      if (target.branch && branches.has(`${facet.via}/${target.branch}`)) add(facets, key, facet, { kind: 'incoming-branch-reference', tree: facet.via, branch: target.branch });
      if (target.tree && trees.has(target.tree)) add(facets, key, facet, { kind: 'incoming-tree-reference', tree: target.tree });
    }
  }
  return { points: [...points.values()], branches: [...branches.values()], trees: [...trees.values()], facets: [...facets.values()] };
}

/** Report authored paths worth reviewing in both observations, including removed relationships. */
export function reviewImpact(before, after) {
  const result = { format: 'atlas.impact-review/1', status: 'unavailable', beforeIdentity: copy(before?.identity ?? null), afterIdentity: copy(after?.identity ?? null), limits: [...LIMITS,
    'Ancestor and Branch attachments identify context to review. Applying an interpretation to descendants requires judgment; changes to explanations belong in an explicit proposal.'] };
  const left = accepted(before), right = accepted(after);
  if (!left || !right) return { ...result, reason: 'Both observations must have valid normalized Atlases.',
    diagnostics: { before: copy(before?.diagnostics ?? []), after: copy(after?.diagnostics ?? []) } };
  const changedPoints = recordsChanged(left.points, right.points, (point) => point.id)
    .map((entry) => ({ ...entry, changes: pointChanges(entry.before, entry.after) }));
  const changedFacets = recordsChanged(left.facets, right.facets, (facet) => `${facet.tree}/${facet.id}`);
  const changedTrees = recordsChanged(left.trees, right.trees, (tree) => tree.id);
  const changedBranches = recordsChanged(left.branches, right.branches, (branch) => `${branch.tree}/${branch.id}`);
  return { ...result, status: 'ready', changedPoints, changedFacets, changedTrees, changedBranches,
    review: { before: impactContext(left, changedPoints, changedFacets, changedTrees, changedBranches, 'before'),
      after: impactContext(right, changedPoints, changedFacets, changedTrees, changedBranches, 'after') } };
}

function contributions(value, view) {
  argument(Array.isArray(value) && value.length >= 1 && value.length <= 100, 'contributions must contain 1 through 100 explicit decisions.');
  const atlas = accepted(view);
  argument(atlas, 'Absorb preparation requires a valid baseline.');
  const targets = new Set();
  return value.map((item) => {
    object(item, ['disposition', 'rationale', 'point', 'tree', 'facet'], 'contribution');
    argument(DISPOSITIONS.has(item.disposition), 'Unsupported contribution disposition.');
    text(item.rationale, 'contribution rationale');
    for (const field of ['point', 'tree', 'facet']) argument(item[field] === undefined || typeof item[field] === 'string' && ID.test(item[field]), `${field} must be an exact ID.`);
    const noExtra = (...fields) => argument(['point', 'tree', 'facet'].every((field) => fields.includes(field) || item[field] === undefined), 'Contribution has an unrelated target selector.');
    let key;
    if (item.disposition === 'non-integration') noExtra();
    else if (item.disposition === 'facet') {
      noExtra('tree', 'facet');
      argument(item.tree && item.facet, 'A Facet contribution names its owning tree and facet ID.');
      key = `facet:${item.tree}/${item.facet}`;
    } else {
      noExtra(...(item.disposition === 'create' ? ['point', 'tree'] : ['point']));
      argument(item.point, 'This contribution requires a Point ID.');
      const existing = atlas.points.find((point) => point.id === item.point);
      if (item.disposition === 'create') argument(item.tree, 'Creation requires a Point ID and its owning Tree.');
      else argument(existing, `${item.disposition} requires an existing Point.`);
      key = `point:${item.point}`;
    }
    if (key) { argument(!targets.has(key), 'Each contribution target has one decision.'); targets.add(key); }
    return copy(item);
  });
}

/** Validate explicit author decisions, then prepare their exact file changes without writing. */
export function prepareAbsorb(view, input) {
  object(input, ['source', 'contributions', 'changes', 'rationale', 'unresolved'], 'Absorb proposal');
  const incomingSource = source(input.source), decisions = contributions(input.contributions, view);
  text(input.rationale, 'rationale');
  argument(Array.isArray(input.changes), 'changes must be an explicit array.');
  const unresolved = input.unresolved ?? [];
  argument(Array.isArray(unresolved) && unresolved.length <= 100, 'unresolved must be an array of at most 100 questions.');
  unresolved.forEach((item) => text(item, 'unresolved question'));
  if (decisions.every((item) => item.disposition === 'non-integration')) argument(input.changes.length === 0, 'Non-integration alone cannot include file changes.');
  const sourcePreconditions = incomingSource.sha256 && !/^https?:\/\//i.test(incomingSource.uri)
    ? [{ uri: incomingSource.uri, sha256: incomingSource.sha256 }] : [];
  const plan = prepareChange(view, { changes: input.changes, reason: input.rationale, sourcePreconditions });
  const candidate = accepted(plan.candidate), decisionDiagnostics = [];
  if (candidate) for (const decision of decisions) {
    const add = (message) => decisionDiagnostics.push({ code: 'ABSORB_DECISION', point: decision.point ?? null, tree: decision.tree ?? null, facet: decision.facet ?? null, message });
    if (decision.disposition === 'facet') {
      if (!candidate.facets.some((facet) => facet.id === decision.facet && facet.tree === decision.tree)) add('The proposed result does not contain the declared Facet in its owning Tree.');
    } else if (decision.point) {
      const after = candidate.points.find((point) => point.id === decision.point);
      if (!after || decision.tree && after.tree !== decision.tree) add('The proposed result does not contain the declared Point in its owning Tree.');
      if (decision.disposition === 'create' && view.atlas.points.some((point) => point.id === decision.point) && plan.status !== 'noop') {
        add('Creation cannot overwrite an existing identity. Only an identical repeated proposal can return no-op.');
      }
      if (after && decision.disposition === 'reference-only') {
        const before = view.atlas.points.find((point) => point.id === decision.point);
        const { sources: ignoredBefore, ...priorMeaning } = before;
        const { sources: ignoredAfter, ...nextMeaning } = after;
        if (!same(priorMeaning, nextMeaning)) add('A reference-only contribution may change source references, not the Point explanation, type, placement or standing.');
        if ((before.sources ?? []).some((reference) => !(after.sources ?? []).some((retained) => same(reference, retained)))) {
          add('A reference-only addition must preserve existing source references.');
        }
      }
    }
  }
  const impact = reviewImpact(view, plan.candidate);
  if (impact.status === 'ready') {
    for (const point of impact.changedPoints) if (!decisions.some((decision) => decision.point === point.id)) {
      decisionDiagnostics.push({ code: 'ABSORB_DECISION', point: point.id, message: 'This changed Point has no explicit contribution decision.' });
    }
    for (const facet of impact.changedFacets) if (!decisions.some((decision) => `${decision.tree}/${decision.facet}` === facet.id)) {
      decisionDiagnostics.push({ code: 'ABSORB_DECISION', facet: facet.id, message: 'This changed Facet has no explicit contribution decision.' });
    }
  }
  return {
    format: 'atlas.absorb-proposal/1', status: plan.status === 'invalid' || decisionDiagnostics.length ? 'invalid' : plan.status,
    source: incomingSource, contributions: decisions, rationale: input.rationale, unresolved: copy(unresolved),
    plan, decisionDiagnostics, impact, limits: [...LIMITS,
      'Assess source support and unresolved conflicts, then apply the reviewed proposal within the caller’s authorization.'],
  };
}
