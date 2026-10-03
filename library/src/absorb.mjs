import { searchAtlas, validateSource } from './model.mjs';
import { prepareChange, inspectChange, changePlanIdentity } from './authoring.mjs';
import { referenceIndex } from './references.mjs';

const copy = (value) => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const accepted = (view) => view?.format === 'atlas.view/1' && view.status === 'ready' && view.atlas;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const DISPOSITIONS = new Set(['update', 'create', 'facet', 'conflict', 'reference-only', 'non-integration', 'remove']);
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
    ...(atlas.style ? { style: copy(atlas.style) } : {}),
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
  // Freeze the affected set: direct references add review context, never graph closure.
  const affectedPoints = new Set(points.keys()), affectedBranches = new Set(branches.keys()), affectedTrees = new Set(trees.keys());
  for (const facet of atlas.facets) {
    const key = `${facet.tree}/${facet.id}`;
    if (facet.on.point && affectedPoints.has(facet.on.point)) add(facets, key, facet, { kind: 'attached-review-point', point: facet.on.point });
    if (facet.on.branch && affectedBranches.has(`${facet.tree}/${facet.on.branch}`)) add(facets, key, facet, { kind: 'attached-review-branch', tree: facet.tree, branch: facet.on.branch });
    for (const target of facet.targets) {
      let reason;
      if (target.point && affectedPoints.has(target.point)) reason = { kind: 'incoming-point-reference', point: target.point };
      if (target.branch && affectedBranches.has(`${facet.via}/${target.branch}`)) reason = { kind: 'incoming-branch-reference', tree: facet.via, branch: target.branch };
      if (target.tree && affectedTrees.has(target.tree)) reason = { kind: 'incoming-tree-reference', tree: target.tree };
      if (reason) {
        add(facets, key, facet, reason);
        const hostReason = { kind: 'incoming-facet-host', tree: facet.tree, facet: facet.id };
        if (facet.on.point) point(facet.on.point, hostReason);
        if (facet.on.branch) add(branches, `${facet.tree}/${facet.on.branch}`, atlas.branches.find(item => item.tree === facet.tree && item.id === facet.on.branch), hostReason);
      }
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
  const contexts = { before: impactContext(left, changedPoints, changedFacets, changedTrees, changedBranches, 'before'),
    after: impactContext(right, changedPoints, changedFacets, changedTrees, changedBranches, 'after') };
  const mentions = {}, indexes = {};
  for (const [side, view] of [['before', before], ['after', after]]) {
    const index = indexes[side] = referenceIndex(view, { limit: 10000 });
    const cited = new Map();
    for (const reference of index.references) {
      if (reference.status !== 'resolved' || !['point', 'facet'].includes(reference.target?.kind)) continue;
      const targetKey = reference.target.kind === 'point' ? `point:${reference.target.id}` : `facet:${reference.target.tree}/${reference.target.id}`;
      if (!cited.has(targetKey)) cited.set(targetKey, new Map());
      const owners = cited.get(targetKey), ownerKey = `${reference.from.kind}/${reference.from.tree}/${reference.from.id}`;
      if (!owners.has(ownerKey)) owners.set(ownerKey, { record: reference.from, references: [] });
      owners.get(ownerKey).references.push(reference);
    }
    const targets = [...changedPoints.filter(item => item[side]).map(item => ({ point: item.id })),
      ...changedFacets.filter(item => item[side]).map(item => ({ facet: item[side].id, tree: item[side].tree }))];
    mentions[side] = targets.map(target => {
      const key = target.point ? `point:${target.point}` : `facet:${target.tree}/${target.facet}`;
      const citers = [...(cited.get(key)?.values() ?? [])];
      return { target, format: 'atlas.citers/1', status: index.status, identity: index.identity,
        citers: citers.slice(0, 100), bounds: { available: citers.length, returned: Math.min(citers.length, 100), exhaustive: index.bounds.exhaustive }, limits: [...index.limits] };
    });
  }
  return { ...result, status: 'ready', changedPoints, changedFacets, changedTrees, changedBranches,
    ...(same(left.style, right.style) ? {} : { changedStyle: { before: copy(left.style ?? null), after: copy(right.style ?? null) } }),
    review: contexts, mentions, linkDiagnostics: indexes.after.diagnostics };
}

/** Recompute impact from exact draft bytes, including a deleted record's former links. */
export function reviewChange(plan) {
  const { before, after } = inspectChange(plan);
  return reviewImpact(before, after);
}

function destinations(value, label, { required = false } = {}) {
  argument(Array.isArray(value) && value.length <= 100 && (!required || value.length > 0), `${label} must contain ${required ? '1 through' : 'at most'} 100 destinations.`);
  const seen = new Set();
  return value.map(item => {
    object(item, ['point', 'tree', 'facet'], 'destination');
    const key = item.point !== undefined && item.tree === undefined && item.facet === undefined ? `point:${item.point}`
      : item.point === undefined && item.tree && item.facet ? `facet:${item.tree}/${item.facet}` : null;
    argument(key && Object.values(item).every(id => typeof id === 'string' && ID.test(id)) && !seen.has(key), 'A destination names one unique Point or Tree-local Facet.');
    seen.add(key); return copy(item);
  });
}
function destinationExists(atlas, target) {
  return target.point ? atlas.points.some(point => point.id === target.point) : atlas.facets.some(facet => facet.id === target.facet && facet.tree === target.tree);
}

function contributions(value, view) {
  argument(Array.isArray(value) && value.length >= 1 && value.length <= 100, 'contributions must contain 1 through 100 explicit decisions.');
  const atlas = accepted(view);
  argument(atlas, 'Absorb preparation requires a valid baseline.');
  const targets = new Set();
  return value.map(item => {
    object(item, ['disposition', 'rationale', 'point', 'tree', 'facet', 'destinations'], 'contribution');
    argument(DISPOSITIONS.has(item.disposition), 'Unsupported contribution disposition.');
    text(item.rationale, 'contribution rationale');
    for (const field of ['point', 'tree', 'facet']) argument(item[field] === undefined || typeof item[field] === 'string' && ID.test(item[field]), `${field} must be an exact ID.`);
    const noExtra = (...fields) => argument(['point', 'tree', 'facet'].every(field => fields.includes(field) || item[field] === undefined), 'Contribution has an unrelated target selector.');
    let key;
    if (item.disposition === 'non-integration') noExtra();
    else if (item.disposition === 'facet' || item.disposition === 'remove' && item.facet !== undefined) {
      noExtra('tree', 'facet');
      argument(item.tree && item.facet, 'A Facet contribution names its owning tree and facet ID.');
      if (item.disposition === 'remove') argument(atlas.facets.some(facet => facet.tree === item.tree && facet.id === item.facet), 'Removal requires an existing Facet.');
      key = `facet:${item.tree}/${item.facet}`;
    } else {
      noExtra(...(item.disposition === 'create' ? ['point', 'tree'] : ['point']));
      argument(item.point, 'This contribution requires a Point ID.');
      const existing = atlas.points.find(point => point.id === item.point);
      if (item.disposition === 'create') argument(item.tree, 'Creation requires a Point ID and its owning Tree.');
      else argument(existing, `${item.disposition} requires an existing Point.`);
      key = `point:${item.point}`;
    }
    argument(item.destinations === undefined || item.disposition === 'remove', 'Only removal can declare surviving destinations.');
    if (item.destinations !== undefined) destinations(item.destinations, 'Removal destinations');
    if (key) { argument(!targets.has(key), 'Each contribution target has one decision.'); targets.add(key); }
    return copy(item);
  });
}

function preservationReview(value) {
  if (value === undefined) return undefined;
  object(value, ['scope', 'sources', 'units'], 'preservation review');
  text(value.scope, 'preservation scope');
  argument(Array.isArray(value.sources) && value.sources.length >= 1 && value.sources.length <= 100, 'Preservation scope needs 1 through 100 sources.');
  const sources = value.sources.map(source);
  argument(new Set(sources.map(item => JSON.stringify(item))).size === sources.length, 'Preservation sources must be unique.');
  argument(Array.isArray(value.units) && value.units.length <= 1000, 'Preservation review allows at most 1000 declared units.');
  const ids = new Set();
  const units = value.units.map(unit => {
    object(unit, ['id', 'source', 'locator', 'disposition', 'rationale', 'destinations'], 'preservation unit');
    argument(typeof unit.id === 'string' && ID.test(unit.id) && !ids.has(unit.id), 'Preservation units need unique IDs.'); ids.add(unit.id);
    const unitSource = source(unit.source);
    argument(sources.some(item => same(item, unitSource)), 'Each unit source must match a source in the declared scope.');
    text(unit.locator, 'unit locator'); text(unit.rationale, 'unit rationale');
    argument(['retained', 'reframed', 'superseded', 'historical', 'non-integration', 'unresolved'].includes(unit.disposition), 'Unknown preservation disposition.');
    const required = ['retained', 'reframed'].includes(unit.disposition);
    if (required || unit.destinations !== undefined) destinations(unit.destinations, 'Unit destinations', { required });
    return copy(unit);
  });
  return { scope: value.scope, sources, units };
}

/** Validate explicit author decisions, then prepare their exact file changes without writing. */
export function prepareAbsorb(view, input) {
  object(input, ['source', 'contributions', 'changes', 'rationale', 'unresolved', 'preservation', 'sourcePreconditions'], 'Absorb proposal');
  const incomingSource = source(input.source), decisions = contributions(input.contributions, view);
  const preservation = preservationReview(input.preservation);
  text(input.rationale, 'rationale');
  argument(Array.isArray(input.changes), 'changes must be an explicit array.');
  const unresolved = input.unresolved ?? [];
  argument(Array.isArray(unresolved) && unresolved.length <= 100, 'unresolved must be an array of at most 100 questions.');
  unresolved.forEach((item) => text(item, 'unresolved question'));
  if (decisions.every((item) => item.disposition === 'non-integration')) argument(input.changes.length === 0, 'Non-integration alone cannot include file changes.');
  const sourcePreconditions = copy(input.sourcePreconditions ?? []);
  argument(Array.isArray(sourcePreconditions), 'Source preconditions must be an array.');
  if (incomingSource.sha256 && !/^https?:\/\//i.test(incomingSource.uri)) {
    const existing = sourcePreconditions.find(item => item?.uri === incomingSource.uri);
    argument(!existing || existing.sha256 === incomingSource.sha256, 'Incoming source hash conflicts with a source precondition.');
    if (!existing) sourcePreconditions.push({ uri: incomingSource.uri, sha256: incomingSource.sha256 });
  }
  const plan = prepareChange(view, { changes: input.changes, reason: input.rationale, sourcePreconditions });
  const candidate = accepted(plan.candidate), decisionDiagnostics = [];
  if (candidate) for (const decision of decisions) {
    const add = (message) => decisionDiagnostics.push({ code: 'ABSORB_DECISION', point: decision.point ?? null, tree: decision.tree ?? null, facet: decision.facet ?? null, message });
    if (decision.disposition === 'remove') {
      const exists = decision.point ? candidate.points.some(point => point.id === decision.point) : candidate.facets.some(facet => facet.tree === decision.tree && facet.id === decision.facet);
      if (exists) add('The removed identity still exists in the proposed result.');
      for (const destination of decision.destinations ?? []) if (!destinationExists(candidate, destination)) add('A surviving destination is absent from the proposed result.');
    } else if (decision.disposition === 'facet') {
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
  if (candidate && preservation) for (const unit of preservation.units) {
    for (const destination of unit.destinations ?? []) if (!destinationExists(candidate, destination)) {
      decisionDiagnostics.push({ code: 'ABSORB_PRESERVATION', message: `Preservation unit ${unit.id} names a destination absent from the candidate.` });
    }
  }
  const status = plan.status === 'invalid' || decisionDiagnostics.length ? 'invalid' : plan.status;
  const review = status === 'invalid' ? undefined : {
    format: 'atlas.absorb-review/1', baseline: view.identity, candidateIdentity: plan.candidate.identity, planIdentity: changePlanIdentity(plan),
    source: incomingSource, contributions: decisions, rationale: input.rationale, unresolved: copy(unresolved), ...(preservation ? { preservation } : {}),
  };
  return {
    format: 'atlas.absorb-proposal/1', status,
    source: incomingSource, contributions: decisions, rationale: input.rationale, unresolved: copy(unresolved),
    plan, decisionDiagnostics, impact, ...(review ? { review } : {}), ...(preservation ? { preservation } : {}), limits: [...LIMITS,
      'Assess source support and unresolved conflicts, then apply the reviewed proposal within the caller’s authorization.'],
  };
}

/** Revalidate a review packet against exact draft bytes; no field can claim approval. */
export function validateAbsorbReview(plan, value) {
  object(value, ['format', 'baseline', 'candidateIdentity', 'planIdentity', 'source', 'contributions', 'rationale', 'unresolved', 'preservation'], 'Absorb review');
  const { before, after } = inspectChange(plan);
  argument(value.format === 'atlas.absorb-review/1' && value.baseline === before.identity && value.candidateIdentity === after.identity && value.planIdentity === changePlanIdentity(plan), 'Absorb review does not match this exact plan.');
  argument((plan.observedFiles ?? []).length === 0, 'Absorb review requires a complete captured baseline.');
  const replay = prepareAbsorb(before, { source: value.source, contributions: value.contributions, rationale: value.rationale,
    unresolved: value.unresolved, ...(value.preservation ? { preservation: value.preservation } : {}),
    sourcePreconditions: plan.sourcePreconditions, changes: plan.changes.map(({ path, after }) => ({ path, content: after })) });
  argument(replay.status !== 'invalid' && replay.review?.planIdentity === value.planIdentity && same(replay.review, value), 'Absorb decisions do not describe this plan.');
  return copy(replay.review);
}
