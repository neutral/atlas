import { searchAtlas, validateSource, readRecords } from './model.mjs';
import { inspectChange } from './authoring.mjs';
import { referenceIndex } from './references.mjs';

const copy = (value) => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const accepted = (view) => view?.format === 'atlas.view/1' && view.status === 'ready' && view.atlas;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const STOP = new Set('a an and are as at be been but by can could for from has have in into is it its may not of on or our should that the their then there these this to was were will with would'.split(' '));
const LIMITS = [
  'Candidates and impact paths support review. The author decides identity and how incoming information changes the account.',
  'Source content requires separate reading and verification. Absorb uses the supplied text and references.',
  'Impact review follows recorded relationships. Additional consequences may require investigation.',
];
/** What every review of a draft covers and what it does not. */
const REVIEW_LIMITS = [
  'The effects name every record the draft makes new, changes or removes, what changed in each Point, the Points above each changed Point, the Facets attached to it and targeting it, the records that mention it, and link diagnostics.',
  'They are leads, not a proof of complete impact: they follow recorded connections only, and do not say whether the Points beneath a changed Point still hold. Reread the Points above.',
  'A review reads no cited source: whether the draft is true to its sources is checked by reading them.',
];
/** A value as JSON with every object's keys in order, so that records that differ only in key order read the same. */
const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
/** A few of a list's entries, in words, and how many more there are. */
const some = list => list.length <= 20 ? list.join(', ') : `${list.slice(0, 20).join(', ')} and ${list.length - 20} more`;

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
  const interpretations = atlas.facets.flatMap((facet) => {
    const reasons = [];
    if (candidateIds.has(facet.on)) reasons.push({ kind: 'attached-candidate', point: facet.on });
    for (const target of facet.targets) if (candidateIds.has(target)) reasons.push({ kind: 'incoming-candidate-reference', point: target });
    return reasons.length ? [{ facet: copy(facet), reasons }] : [];
  });
  return {
    ...result, status: candidates.length || owners.length ? 'candidates' : 'no-candidates',
    style: copy(atlas.style), terms, candidates, owners: owners.slice(0, limit), interpretations: interpretations.slice(0, limit),
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
  // Only a decision has a status and only an observation a date, so in a valid record these say what they name;
  // an earlier record that does not validate may carry either where it does not belong.
  if (before.status !== after.status) changes.push('decision-status');
  if (before.observedAt !== after.observedAt) changes.push('observation-date');
  // Where the earlier Atlas does not place a Point, or cannot say its Tree, that part of its earlier place is not known and is not compared.
  if (before.path !== after.path || before.tree !== null && before.tree !== after.tree || before.ancestors !== null && !same(before.ancestors, after.ancestors)) changes.push('placement');
  // The title is the H1, the explanation the body beneath it: a sharper title alone changes the title.
  if (before.title !== after.title) changes.push('title');
  if (before.body !== after.body) changes.push('explanation');
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

function impactContext(atlas, changedPoints, changedFacets, changedTrees, side) {
  const points = new Map(), trees = new Map(), facets = new Map();
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
    for (const ancestor of record.ancestors ?? []) add(points, ancestor.id, atlas.points.find((item) => item.id === ancestor.id), { kind: 'authored-ancestor', point: id });
  }
  for (const changed of changedPoints) if (changed[side]) point(changed.id, { kind: 'changed-point', changes: changed.changes });
  for (const changed of changedTrees) if (changed[side]) {
    const tree = changed[side];
    add(trees, tree.id, tree, { kind: 'changed-tree' });
    point(tree.base, { kind: 'changed-tree-base', tree: tree.id });
  }
  for (const changed of changedFacets) if (changed[side]) {
    const facet = changed[side];
    add(facets, `${facet.tree}/${facet.id}`, facet, { kind: 'changed-facet' });
    point(facet.on, { kind: 'changed-facet-host', tree: facet.tree, facet: facet.id });
    for (const target of facet.targets) point(target, { kind: 'changed-facet-target', tree: facet.tree, facet: facet.id });
  }
  // Freeze the affected set: direct references add review context, never graph closure.
  const affected = new Set(points.keys());
  for (const facet of atlas.facets) {
    const key = `${facet.tree}/${facet.id}`;
    if (affected.has(facet.on)) add(facets, key, facet, { kind: 'attached-review-point', point: facet.on });
    for (const target of facet.targets) {
      if (!affected.has(target)) continue;
      add(facets, key, facet, { kind: 'incoming-point-reference', point: target });
      point(facet.on, { kind: 'incoming-facet-host', tree: facet.tree, facet: facet.id });
    }
  }
  return { points: [...points.values()], trees: [...trees.values()], facets: [...facets.values()] };
}

/**
 * What differs in the manifest, when its bytes differ: the Atlas's title and ID, the order of the Trees that both sides
 * hold (`order` gives each side's whole list of Tree IDs), and the Trees added and removed. `null` when the bytes are the same.
 * Where the Atlas before holds no manifest that can be read, its title and ID are null.
 */
function manifestChange(before, after, left, right) {
  const bytes = view => view.files.find(file => file.path === 'atlas.json')?.sha256;
  if (bytes(before) === bytes(after)) return null;
  const change = {};
  for (const key of ['title', 'id']) if (left[key] !== right[key]) change[key] = { before: left[key], after: right[key] };
  const was = left.trees.map(tree => tree.id), is = right.trees.map(tree => tree.id);
  const kept = list => list.filter(id => was.includes(id) && is.includes(id)).join('\n');
  if (kept(was) !== kept(is)) change.order = { before: was, after: is };
  return { ...change, added: is.filter(id => !was.includes(id)), removed: was.filter(id => !is.includes(id)) };
}

/**
 * Report authored paths worth reviewing in both observations, including removed relationships. The observation after
 * must validate. The one before need only be read whole: one that does not validate, or holds no Atlas yet, is read
 * as far as its files allow, and `limits` then say what that leaves unknown.
 */
export function reviewImpact(before, after) {
  const result = { format: 'atlas.impact-review/1', status: 'unavailable', beforeIdentity: copy(before?.identity ?? null), afterIdentity: copy(after?.identity ?? null), limits: [...REVIEW_LIMITS] };
  const right = accepted(after);
  if (!right || before?.format !== 'atlas.view/1' || !['ready', 'invalid'].includes(before.status)) return { ...result, reason: 'The Atlas after the change must validate, and the one before it must be read whole.',
    diagnostics: { before: copy(before?.diagnostics ?? []), after: copy(after?.diagnostics ?? []) } };
  const { atlas: left, unread } = readRecords(before);
  // A Point whose record differs only in its header's key order, or in an earlier place that is not known, is not changed.
  const known = (before, after) => ({ ...before, ...(before.tree === null ? { tree: after.tree } : {}), ...(before.ancestors === null ? { ancestors: after.ancestors } : {}) });
  const changedPoints = recordsChanged(left.points, right.points, (point) => point.id)
    .filter(({ before, after }) => !before || !after || canonical(known(before, after)) !== canonical(after))
    .map((entry) => ({ ...entry, changes: pointChanges(entry.before, entry.after) }));
  const changedFacets = recordsChanged(left.facets, right.facets, (facet) => `${facet.tree}/${facet.id}`);
  const changedTrees = recordsChanged(left.trees, right.trees, (tree) => tree.id);
  const changedChecks = recordsChanged(left.checks, right.checks, (check) => check.id);
  const styleBytes = (view) => view.files.find((file) => file.path === right.style.path)?.sha256;
  if (before.status !== 'ready') {
    if (!before.files.some(file => file.path === 'atlas.json')) result.limits.push('There is no Atlas before this draft, so every record in it is new.');
    else {
      result.limits.push('The Atlas before this draft does not validate. Its records are read as far as their files allow, and the records that mentioned them there are not read.');
      if (unread.length) result.limits.push(`These files of the Atlas before this draft hold no record that can be read, so a record the draft holds in one of them is reported as new: ${some(unread)}.`);
      const unplaced = changedPoints.filter(entry => entry.before?.ancestors === null).map(entry => entry.id);
      if (unplaced.length) result.limits.push(`The outline of the Atlas before this draft does not place these Points, so where they stood there and the Points above them are not known: ${some(unplaced)}.`);
    }
  }
  const contexts = { before: impactContext(left, changedPoints, changedFacets, changedTrees, 'before'),
    after: impactContext(right, changedPoints, changedFacets, changedTrees, 'after') };
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
        citers: citers.slice(0, 100), bounds: { available: citers.length, returned: Math.min(citers.length, 100), exhaustive: index.bounds.exhaustive && citers.length <= 100 }, limits: [...index.limits] };
    });
  }
  return { ...result, status: 'ready', changedPoints, changedFacets, changedTrees, changedChecks,
    changedManifest: manifestChange(before, after, left, right),
    ...(styleBytes(before) === styleBytes(after) ? {} : { changedStyle: { before: copy(left.style ?? null), after: copy(right.style) } }),
    review: contexts, mentions, linkDiagnostics: indexes.after.diagnostics };
}

/** Recompute impact from exact draft bytes, including a deleted record's former links. */
export function reviewChange(plan) {
  const { before, after } = inspectChange(plan);
  return reviewImpact(before, after);
}
