import { createHash } from 'node:crypto';
import { inspectChange } from './authoring.mjs';

function requireValue(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.inventory.invalid-argument' });
}
const sections = ['files', 'trees', 'points', 'facets', 'checks', 'diagnostics'];
const pick = (record, keys) => Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
function bounds(options) {
  requireValue(options.full === undefined || typeof options.full === 'boolean', 'full must be a boolean.');
  const { limit = 50, offset = 0 } = options;
  requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'limit must be 1..100.');
  requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000, 'offset must be 0..100000.');
  return { limit, offset };
}

/** Bounded authored-record inventory, with exact identity for continuation. */
export function summarizeAtlas(view, options = {}) {
  if (options.expectedIdentity !== undefined && options.expectedIdentity !== view.identity) throw Object.assign(new Error('The Atlas changed; restart inventory from offset zero.'), { code: 'STALE' });
  const { limit, offset } = bounds(options);
  requireValue(options.section === undefined || sections.includes(options.section), 'Unknown inventory section.');
  if (options.full) return view;
  const result = { format: view.format, status: view.status, root: view.root, identity: view.identity, files: [], diagnostics: [], atlas: view.atlas && pick(view.atlas, ['format', 'id', 'title']), bounds: {} };
  if (view.atlas) result.atlas.style = pick(view.atlas.style, ['title', 'path']);
  for (const section of sections) {
    const source = section === 'files' || section === 'diagnostics' ? view[section] : view.atlas?.[section] ?? [];
    const selected = !options.section || options.section === section;
    const page = selected ? source.slice(offset, offset + limit) : [];
    const records = page.map(record => section === 'files' ? pick(record, ['path', 'sha256', 'bytes']) : section === 'diagnostics' ? record : pick(record, ['id', 'tree', 'title', 'scope', 'base', 'path', 'type', 'status', 'observedAt', 'uncertainty', 'on', 'via', 'targets', 'level', 'revision']));
    if (section === 'files' || section === 'diagnostics') result[section] = records;
    else if (result.atlas) result.atlas[section] = records;
    result.bounds[section] = { available: source.length, returned: records.length, offset, next: selected && offset + page.length < source.length ? { section, offset: offset + page.length, limit, expectedIdentity: view.identity } : null };
  }
  return result;
}

/**
 * A saved-draft synopsis omits repeated baseline and candidate file bytes. It carries the plan's validation: the status
 * that decides whether the draft can be applied, and a page of the diagnostics that say why it cannot.
 */
export function summarizeDraft(draft, options = {}) {
  draft = { ...draft, plan: { ...draft.plan, candidate: inspectChange(draft.plan).after } };
  const { limit, offset } = bounds(options);
  if (options.full) return draft;
  const changes = draft.plan.changes, { status, identity, diagnostics } = draft.plan.validation;
  const plan = pick(draft.plan, ['format', 'status', 'reason']);
  plan.baseline = { identity: draft.plan.baseline.identity };
  plan.validation = { status, identity, diagnostics: diagnostics.slice(offset, offset + limit) };
  plan.candidate = summarizeAtlas(draft.plan.candidate, { limit, offset });
  plan.changes = changes.slice(offset, offset + limit).map(change => ({ path: change.path, action: change.after === null ? 'remove' : 'write', bytes: typeof change.after === 'string' ? Buffer.byteLength(change.after) : 0 }));
  return { ...pick(draft, ['format', 'id', 'revision', 'updatedAt']), plan,
    bounds: { changes: { available: changes.length, returned: plan.changes.length, offset, nextOffset: offset + plan.changes.length < changes.length ? offset + plan.changes.length : null },
      validation: { available: diagnostics.length, returned: plan.validation.diagnostics.length, offset } },
    details: { available: true, instruction: 'Request part=details for bounded exact JSON or full=true for the complete saved draft.' },
  };
}

/** Exact UTF-8 chunks permit complete inspection without oversized tool output. */
export function readJsonChunk(value, { offset = 0, maxBytes = 65536, expectedSha256 } = {}) {
  requireValue(Number.isSafeInteger(offset) && offset >= 0, 'offset must be a nonnegative integer.');
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 4 && maxBytes <= 128 * 1024, 'maxBytes must be 4..131072.');
  const bytes = Buffer.from(JSON.stringify(value)), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 !== undefined && expectedSha256 !== sha256) throw Object.assign(new Error('The selected details changed. Restart at offset zero.'), { code: 'STALE_REPORT' });
  const continuation = at => at < bytes.length && (bytes[at] & 0xc0) === 0x80;
  requireValue(offset <= bytes.length && !continuation(offset), 'Use nextOffset at a UTF-8 character boundary within the details.');
  let end = Math.min(bytes.length, offset + maxBytes);
  while (continuation(end)) end--;
  return { status: 'ready', encoding: 'utf-8', byteLength: bytes.length, sha256, offset, returnedBytes: end - offset, nextOffset: end < bytes.length ? end : null, complete: end === bytes.length, text: bytes.subarray(offset, end).toString('utf8') };
}
