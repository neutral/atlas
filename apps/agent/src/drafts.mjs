// What the CLI and the MCP server both say about a saved draft: what preparing saved, and
// what applying it would affect. Both are bounded by default and name what they leave out.
import { inspectChange } from '../../../library/src/authoring.mjs';
import { reviewImpact } from '../../../library/src/absorb.mjs';
import { summarizeDraft, readJsonChunk } from '../../../library/src/inventory.mjs';

const pick = (record, keys) => Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
/** The Style as the summary names it. */
const styleReference = record => pick(record, ['title', 'path']);

/**
 * What preparing a change returns: the saved draft's identity and revision, its status and reason,
 * its validation and the changed paths, without file bytes or the candidate's record lists.
 * A draft prepared from a candidate directory also names the files of that directory that were left out
 * of the change. Each list holds at most 100 entries; `bounds` says how many there are.
 */
export function savedDraft(draft) {
  const { plan: { candidate, ...plan }, bounds, details, ...head } = summarizeDraft(draft, { limit: 100 });
  const { ignored } = draft.plan;
  return { ...head, plan: { ...plan, ...(ignored ? { ignored: ignored.slice(0, 100) } : {}) },
    bounds: { ...bounds, ...(ignored ? { ignored: { available: ignored.length, returned: Math.min(ignored.length, 100) } } : {}) } };
}

/**
 * A stamp report without its plan. Each of `stamped`, `current` and `skipped` holds at most
 * `limit` entries; `counts` and `bounds` give the totals.
 */
export function stampReport({ plan, ...report }, limit = 100) {
  const bounds = {};
  for (const list of ['stamped', 'current', 'skipped']) {
    bounds[list] = { available: report[list].length, returned: Math.min(limit, report[list].length) };
    report[list] = report[list].slice(0, limit);
  }
  return { ...report, bounds, limits: [...report.limits, 'Each list is bounded; bounds gives how many entries there are. The stale report gives every reference its status, page by page.'] };
}

/** What differs between two versions of a record, by field; a Point's own classification is kept. */
function differing(before, after) {
  if (!before) return ['added'];
  if (!after) return ['removed'];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

const SUMMARY = 'Each changed record is named by its ID with what changed in it; a Point with the Points above it, the Facets that bear on it and the records that mention it. Request full for the complete records and why each was named, or part=details for the complete result as exact JSON text in chunks.';

/**
 * The Library's review as a summary to read whole: each changed record by its ID with what changed in it, the Points
 * above it, the Facets that bear on it and the records whose text mentions it, the counts, and the link diagnostics.
 * A removed record is told as it stood before. Each list holds at most `limit` entries from `offset`.
 */
function summarized(review, { limit = 100, offset = 0 }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Object.assign(new TypeError('limit must be 1..1000.'), { code: 'atlas.review.invalid-argument' });
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw Object.assign(new TypeError('offset must be 0..100000.'), { code: 'atlas.review.invalid-argument' });
  const bounds = {};
  let more = false;
  const page = (name, list, shape = item => item) => {
    const items = list.slice(offset, offset + limit);
    bounds[name] = { available: list.length, returned: items.length, offset };
    more ||= offset + items.length < list.length;
    return items.map(shape);
  };
  const head = { format: 'atlas.impact-summary/1', ...pick(review, ['status', 'beforeIdentity', 'afterIdentity']) };
  let effects;
  if (review.status !== 'ready') {
    effects = { ...head, reason: review.reason,
      diagnostics: { before: page('diagnostics.before', review.diagnostics.before), after: page('diagnostics.after', review.diagnostics.after) }, limits: review.limits };
  } else {
    const side = entry => entry.after ? 'after' : 'before';
    const named = record => record.kind === 'facet' ? `${record.tree}/${record.id}` : record.id;
    const mentioning = (where, target) => (review.mentions[where].find(item => item.target.point === target.point && item.target.facet === target.facet && item.target.tree === target.tree)?.citers ?? [])
      .map(citer => named(citer.record));
    const above = record => record.ancestors === null || record.ancestors === undefined ? null : record.ancestors.map(ancestor => ancestor.id);
    const bearing = (where, id) => review.review[where].facets
      .filter(entry => entry.reasons.some(reason => ['attached-review-point', 'incoming-point-reference'].includes(reason.kind) && reason.point === id))
      .map(entry => `${entry.record.tree}/${entry.record.id}`);
    const point = entry => {
      const where = side(entry), record = entry[where];
      const moved = entry.before && entry.after && above(entry.before) && JSON.stringify(above(entry.before)) !== JSON.stringify(above(entry.after));
      return { id: entry.id, tree: record.tree, changes: entry.changes, above: above(record), ...(moved ? { aboveBefore: above(entry.before) } : {}),
        facets: bearing(where, entry.id), mentionedBy: mentioning(where, { point: entry.id }) };
    };
    const facet = entry => {
      const where = side(entry), record = entry[where];
      return { id: entry.id, changes: differing(entry.before, entry.after), on: record.on, targets: record.targets, mentionedBy: mentioning(where, { facet: record.id, tree: record.tree }) };
    };
    const kinds = list => {
      const counted = { added: 0, changed: 0, removed: 0 };
      for (const entry of list) counted[!entry.before ? 'added' : !entry.after ? 'removed' : 'changed']++;
      return counted;
    };
    effects = { ...head,
      counts: { points: kinds(review.changedPoints), facets: kinds(review.changedFacets), trees: kinds(review.changedTrees), checks: kinds(review.changedChecks), linkDiagnostics: review.linkDiagnostics.length },
      points: page('points', review.changedPoints, point),
      facets: page('facets', review.changedFacets, facet),
      trees: page('trees', review.changedTrees, entry => ({ id: entry.id, changes: differing(entry.before, entry.after) })),
      checks: page('checks', review.changedChecks, entry => ({ id: entry.id, changes: differing(entry.before, entry.after) })),
      changedManifest: review.changedManifest,
      ...(review.changedStyle ? { changedStyle: { before: review.changedStyle.before && styleReference(review.changedStyle.before), after: styleReference(review.changedStyle.after) } } : {}),
      linkDiagnostics: page('linkDiagnostics', review.linkDiagnostics), limits: review.limits };
  }
  return { effects, bounds, next: more ? { offset: offset + limit, limit } : null, details: { complete: false, instruction: SUMMARY } };
}

/**
 * The effects of a saved draft, recomputed from its exact bytes.
 *
 * `options`: `full` for the Library's complete review; `part: 'details'` with `offset`, `maxBytes` and
 * `expectedSha256` for it in exact chunks; otherwise the summary, with `limit` and `offset` over each of its lists.
 * `current.identity`: the identity of the Atlas now; the result then says whether the draft is stale.
 * An invalid draft carries the first 100 diagnostics of its validation, which say why it cannot be applied.
 */
export function reviewDraft(draft, options = {}, current = {}) {
  const { before, after } = inspectChange(draft.plan);
  const review = reviewImpact(before, after), plan = draft.plan;
  const result = { format: 'atlas.draft-review/1', status: review.status,
    draft: { id: draft.id, revision: draft.revision, updatedAt: draft.updatedAt, status: plan.status, reason: plan.reason,
      baseline: plan.baseline.identity, candidate: plan.validation.identity,
      ...(current.identity === undefined ? {} : { stale: current.identity !== plan.baseline.identity }),
      ...(plan.status === 'invalid' ? { diagnostics: plan.validation.diagnostics.slice(0, 100) } : {}) } };
  if (options.part === 'details') return readJsonChunk({ ...result, effects: review }, options);
  return options.full ? { ...result, effects: review } : { ...result, ...summarized(review, options) };
}
