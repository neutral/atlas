import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openAtlas, getPoint, getTree, getFacet, searchAtlas, compareViews, readSource } from '../../../library/src/model.mjs';
import { prepareChangeFromDisk, prepareInitialization, prepareStyleChange, getSourceReviewHistory, recordSourceReview, inspectChange, applyDraft, recoverChange, saveDraft, loadDraft, listDrafts, deleteDraft, listTransactions } from '../../../library/src/authoring.mjs';
import { listStyles, getStyle } from '../../../library/src/styles.mjs';
import { summarizeAtlas, summarizeDraft, summarizeSourceHistory, readJsonChunk } from '../../../library/src/inventory.mjs';
import { route } from '../../../library/src/route.mjs';
import { inspectAbsorb, prepareAbsorb, reviewChange } from '../../../library/src/absorb.mjs';
import { evaluateChecks, retainCheckRun, listCheckReports, readCheckReport } from '../../../library/src/checks.mjs';

import { referenceIndex, directCiters, sourceCitations, reviewSources, prepareMove } from '../../../library/src/references.mjs';

const text = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength });
const id = { ...text(100), pattern: '^[a-z0-9][a-z0-9-]*$' };
const hash = { ...text(64), pattern: '^[a-f0-9]{64}$' };
const number = (maximum) => ({ type: 'integer', minimum: 1, maximum });
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });
const source = object({ uri: text(), title: text(), role: { enum: ['evidence', 'background', 'example', 'implementation', 'history'] }, revision: text(), locator: text(), sha256: hash }, ['uri']);
const changes = array(object({ path: text(), content: { type: ['string', 'null'], maxLength: 2 * 1024 * 1024 } }, ['path', 'content']));
const request = object({ changes, styleChange: { type: 'boolean' }, reason: text(16384), sourcePreconditions: array(object({ uri: text(), sha256: hash }, ['uri', 'sha256']), 100) }, ['changes', 'reason']);
const destination = object({ point: id, tree: id, facet: id });
const preservation = object({ scope: text(16384), sources: array(source, 100), units: array(object({ id: text(100), source, locator: text(4096), disposition: { enum: ['retained', 'reframed', 'superseded', 'historical', 'non-integration', 'unresolved'] }, rationale: text(16384), destinations: array(destination, 100) }, ['id', 'source', 'locator', 'disposition', 'rationale'])) }, ['scope', 'sources', 'units']);
const proposal = object({ source, contributions: array(object({ disposition: { enum: ['update', 'create', 'facet', 'conflict', 'reference-only', 'non-integration', 'remove'] }, rationale: text(16384), point: id, tree: id, facet: id, destinations: array(destination, 100) }, ['disposition', 'rationale']), 100), changes, rationale: text(16384), unresolved: array(text(16384), 100), preservation, sourcePreconditions: request.properties.sourcePreconditions }, ['source', 'contributions', 'changes', 'rationale']);
const draftTarget = object({ id, revision: hash }, ['id', 'revision']);
const cursor = object({ identity: hash, request: hash, section: { enum: ['selected', 'supporting', 'facets'] }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } }, ['identity', 'request', 'section', 'offset']);
const guides = Object.freeze({ operating: 'OPERATING.md', meaning: 'SPEC.md', format: 'spec/FORMAT.md' });
const manual = array(object({ id, revision: hash, baseline: hash, outcome: { enum: ['pass', 'fail', 'unable'] }, reason: text(16384), evidence: array(object({ text: text(16384), source }, ['text']), 100) }, ['id', 'revision', 'baseline', 'outcome', 'reason', 'evidence']));
const chunk = { offset: { type: 'integer', minimum: 0, maximum: 4 * 1024 * 1024 }, maxBytes: { type: 'integer', minimum: 4, maximum: 128 * 1024 }, expectedSha256: hash };
const inventoryOptions = { limit: number(100), offset: { type: 'integer', minimum: 0, maximum: 100000 }, section: { enum: ['files', 'trees', 'points', 'branches', 'facets', 'checks', 'diagnostics'] }, expectedIdentity: hash, full: { type: 'boolean' } };
const draftOptions = { part: { enum: ['summary', 'details'] }, full: { type: 'boolean' }, limit: number(100), ...chunk };
const kinds = array({ enum: ['point', 'facet'] }, 2);
const sourceDecision = object({ uri: text(), sha256: hash, outcome: { enum: ['needs-review', 'reviewed-unchanged', 'updated'] }, reason: text(16384) }, ['uri', 'sha256', 'outcome', 'reason']);
const definitions = [
  ['atlas_source_history', 'Inspect retained source observations and review decisions across sessions. Defaults to a bounded summary; part=details returns exact JSON chunks.', object({ ...draftOptions, expectedRevision: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' } })],
  ['atlas_record_source_review', 'Explicitly retain a source review produced in this session and/or record decisions for exact observed hashes. Requires the current history revision when it exists.', object({ reviewId: id, decisions: array(sourceDecision, 100), expectedRevision: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' } }), true],
  ['atlas_styles', 'Read curated local Style definitions or the catalog. Adoption captures exact local bytes.', object({ id })],
  ['atlas_prepare_style', 'Prepare an explicit adoption or replacement of the single selected Style for review. This is a deliberate organizing-policy change.', object({ baseline: hash, styleId: id, styleContent: text(2 * 1024 * 1024), reason: text(16384) }, ['baseline', 'reason'])],
  ['atlas_guide', 'Read a packaged operating, meaning, or format guide. Start with operating, then inspect Atlas context. Actions require caller-supplied permission.', object({ topic: { enum: Object.keys(guides) } }, ['topic'])],
  ['atlas_view', 'Inspect the captured Atlas identity, diagnostics, and bounded record index. Follow each section continuation with its exact captured identity; full=true returns all authored bytes.', object(inventoryOptions)],
  ['atlas_refresh', 'Capture current authored files and compare them with the prior observation.', object(inventoryOptions)],
  ['atlas_inspect', 'Inspect one exact Point, Tree, Facet, active Style, or captured authored file. part=details returns bounded exact JSON for large records.', object({ point: id, tree: id, facet: object({ tree: id, id }, ['tree', 'id']), style: { enum: [true] }, path: text(), part: { enum: ['details'] }, ...chunk })],
  ['atlas_search', 'Find typed Point and Facet lexical candidates. Facets retain their host, owner and targets. Defaults to both kinds and concise previews.', object({ query: text(), kinds, offset: { type: 'integer', minimum: 0, maximum: 100000 }, tree: id, type: { enum: ['decision', 'observation', 'untyped'] }, limit: number(100), presentation: { enum: ['full', 'summary'] } }, ['query'])],
  ['atlas_route', 'Suggest a coherent reading path from a Point, Tree, or question.', object({ point: id, tree: id, facet: id, query: text(), kinds, detail: { enum: ['overview', 'standard', 'deep'] }, type: { enum: ['decision', 'observation', 'untyped'] }, limit: number(100), mode: { enum: ['discover', 'read'] }, orientation: { enum: ['compact', 'full'] }, cursor })],
  ['atlas_references', 'Inspect resolved links, direct citers, or citations of an exact source URI without reading sources.', object({ point: id, facet: id, tree: id, uri: text(), limit: number(1000) })],
  ['atlas_review_sources', 'Explicitly inspect declared sources within launch grants and compare observed hashes. References do not authorize fetching URLs.', object({ uris: array(text(), 100), previous: array(object({ uri: text(), sha256: hash }, ['uri', 'sha256']), 100), limit: number(100), maxBytes: number(1024 * 1024), draft: draftTarget })],
  ['atlas_prepare_move', 'Prepare a same-Tree record move and exact path-link repairs for review, preserving its identity.', object({ baseline: hash, point: id, facet: id, tree: id, path: text(), reason: text(16384) }, ['baseline', 'path', 'reason'])],
  ['atlas_review_draft', 'Inspect saved reasoning, affected explanations and Check evidence for an exact saved draft revision. Summary by default; part=details returns exact bounded JSON.', object({ id, expectedRevision: hash, ...draftOptions }, ['id', 'expectedRevision'])],
  ['atlas_attach_draft_check_run', 'Attach a session Check run to the exact candidate draft reviewed. Updates its revision; no authored files change.', object({ id, expectedRevision: hash, runId: id }, ['id', 'expectedRevision', 'runId']), true],
  ['atlas_read_source', 'Read a source within launch-time grants. HTTP(S) URLs are never fetched.', object({ source, maxBytes: number(1024 * 1024) }, ['source'])],
  ['atlas_absorb_inspect', 'Find candidate Points, owning Trees and existing Facets for the author to assess against incoming material.', object({ text: text(1024 * 1024), source, tree: id, limit: number(100) }, ['text', 'source'])],
  ['atlas_absorb_prepare', 'Prepare explicit contribution decisions and file changes against an exact captured baseline.', object({ baseline: hash, proposal }, ['baseline', 'proposal'])],
  ['atlas_checks', 'List Check definitions. Use atlas_inspect path to read each full definition and atlas_evaluate_checks to record its review.', object()],
  ['atlas_evaluate_checks', 'Record explicit manual review against the captured baseline or an exact saved candidate draft. No evaluator code runs; Checks without supplied review remain unable. Returns a run summary; read complete evidence with atlas_check_run.', object({ baseline: hash, actor: text(1024), checkIds: array(id), manual, draft: draftTarget }, ['baseline', 'actor'])],
  ['atlas_check_run', 'Read bounded UTF-8 JSON details and evidence from a session Check run. Follow nextOffset and verify byteLength and sha256.', object({ id, ...chunk }, ['id'])],
  ['atlas_retain_check_run', 'Retain a session-produced Check run in private storage. Storage integrity does not authenticate the manual reviewer.', object({ id }, ['id']), true],
  ['atlas_check_reports', 'List retained Check report summaries without evaluating or changing them.', object()],
  ['atlas_check_report', 'Inspect a retained Check report and its freshness. Select details for bounded JSON evidence; follow nextOffset until complete.', object({ id, part: { enum: ['summary', 'details'] }, ...chunk }, ['id'])],
  ['atlas_prepare_change', 'Preview complete file changes against an exact captured baseline without writing.', object({ baseline: hash, request }, ['baseline', 'request'])],
  ['atlas_init', 'Prepare an empty Atlas for a root with no manifest. Save and apply are separate.', object({ baseline: hash, id, title: text(), styleId: id, styleContent: text(2 * 1024 * 1024) }, ['baseline', 'id', 'title'])],
  ['atlas_save_draft', 'Persist a proposal prepared in this session, retaining its original baseline. Updating an existing draft requires its current revision.', object({ proposalId: id, id, expectedRevision: hash }, ['proposalId']), true],
  ['atlas_apply_draft', 'Apply the exact saved draft revision you reviewed, with complete stale-source and candidate checks.', object({ id, expectedRevision: hash }, ['id', 'expectedRevision']), true],
  ['atlas_recover', 'Roll back an interrupted transaction while refusing foreign edits.', object({ id }, ['id']), true],
  ['atlas_list_state', 'List saved drafts and transactions for the fixed Atlas root.', object()],
  ['atlas_load_draft', 'Read a compact saved draft summary; use part=details for bounded JSON or full=true for every saved byte.', object({ id, ...draftOptions }, ['id'])],
  ['atlas_delete_draft', 'Delete the exact saved draft revision you reviewed without changing authored records.', object({ id, expectedRevision: hash }, ['id', 'expectedRevision']), true],
];

export const TOOLS = definitions.map(([name, description, inputSchema, writes = false]) => ({
  name, description, inputSchema,
  annotations: { readOnlyHint: !writes, destructiveHint: writes, idempotentHint: !writes, openWorldHint: false },
}));

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function validate(schema, value, location = 'arguments') {
  if (schema.enum && !schema.enum.includes(value)) fail('INVALID_ARGUMENT', `${location} has an unsupported value.`);
  const types = schema.type ? Array.isArray(schema.type) ? schema.type : [schema.type] : [];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(kind) && !(kind === 'number' && types.includes('integer') && Number.isSafeInteger(value))) fail('INVALID_ARGUMENT', `${location} has the wrong type.`);
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || schema.pattern && !new RegExp(schema.pattern).test(value))) fail('INVALID_ARGUMENT', `${location} has invalid text or exceeds its bound.`);
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail('INVALID_ARGUMENT', `${location} is outside its bound.`);
  if (kind === 'array') {
    if (value.length > (schema.maxItems ?? 1000)) fail('INVALID_ARGUMENT', `${location} has too many entries.`);
    value.forEach((item, index) => validate(schema.items, item, `${location}[${index}]`));
  }
  if (kind === 'object') {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) fail('INVALID_ARGUMENT', `${location}.${required} is required.`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) fail('INVALID_ARGUMENT', `${location}.${key} is not supported.`);
      validate(schema.properties[key], value[key], `${location}.${key}`);
    }
  }
}

const summary = summarizeAtlas;

function runSummary(run) {
  return { status: run.status, id: run.id, baseline: run.baseline, actor: run.actor, createdAt: run.createdAt, required: run.required, requiredSatisfied: run.requiredSatisfied,
    selected: run.selected, excluded: run.excluded, results: run.results.map(({ id, revision, method, outcome }) => ({ id, revision, method, outcome })), limits: run.limits };
}
function readChunk(value, args) {
  const bytes = Buffer.from(JSON.stringify(value)), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (args.expectedSha256 !== undefined && args.expectedSha256 !== sha256) fail('STALE_REPORT', 'The selected details changed. Start reading again at offset zero.');
  const offset = args.offset ?? 0;
  const continuation = at => at < bytes.length && (bytes[at] & 0xc0) === 0x80;
  if (offset > bytes.length || continuation(offset)) fail('INVALID_ARGUMENT', 'Offset must be within the details at a UTF-8 character boundary. Use nextOffset.');
  let end = Math.min(bytes.length, offset + (args.maxBytes ?? 65536));
  while (continuation(end)) end--;
  return { status: 'ready', encoding: 'utf-8', byteLength: bytes.length, sha256, offset, returnedBytes: end - offset, nextOffset: end < bytes.length ? end : null, complete: end === bytes.length, text: bytes.subarray(offset, end).toString('utf8') };
}

/** One immutable launch scope with an explicit captured-view refresh boundary. */
export function createToolSession(root, { allowedRoots } = {}) {
  root = path.resolve(root);
  if (allowedRoots !== undefined && (!Array.isArray(allowedRoots) || allowedRoots.length > 100 || allowedRoots.some(item => typeof item !== 'string' || !item.trim() || item.length > 4096 || item.includes('\0')))) fail('INVALID_SCOPE', 'Source grants must be at most 100 bounded directory paths.');
  const grants = Object.freeze([...new Set([root, ...(allowedRoots ?? []).map(item => path.resolve(item))])]);
  if (grants.length > 100) fail('INVALID_SCOPE', 'At most 100 distinct source roots, including the Atlas root, may be granted.');
  let captured = null, loading = null, mutationTail = Promise.resolve();
  const proposals = new Map();
  const runs = new Map();
  const runTargets = new Map();
  const sourceReviews = new Map();
  const view = async () => {
    if (!captured) {
      loading ??= openAtlas(root);
      captured = await loading; loading = null;
    }
    return captured;
  };
  function remember(value, kind) {
    if (Buffer.byteLength(JSON.stringify(value)) > 1536 * 1024) fail('RESULT_LIMIT', 'Proposal exceeds the review output bound; use a smaller change.');
    const proposalId = randomUUID();
    if (proposals.size >= 16) proposals.delete(proposals.keys().next().value);
    proposals.set(proposalId, { value, kind });
    return { proposalId, [kind]: value };
  }
  function baseline(current, value) {
    if (value !== current.identity) fail('STALE', 'The requested baseline is not the captured observation. Refresh and review before preparing another change.');
    if (current.status === 'incomplete') fail('INCOMPLETE', 'An incomplete observation cannot establish a preparation baseline.');
  }
  async function mutate(context, action) {
    const prior = mutationTail;
    let release;
    mutationTail = new Promise(resolve => { release = resolve; });
    await prior;
    try {
      if (context.cancelled) fail('CANCELLED', 'Request cancelled before mutation.');
      context.uncancellable = true;
      return await action();
    } finally { release(); }
  }
  return {
    root, allowedRoots: grants,
    async call(name, args, context = {}) {
      const definition = TOOLS.find(tool => tool.name === name);
      if (!definition) fail('UNKNOWN_TOOL', `Unknown tool: ${name}.`);
      validate(definition.inputSchema, args);
      if (name === 'atlas_styles') return args.id ? { status: getStyle(args.id) ? 'ready' : 'missing', style: getStyle(args.id) } : { status: 'ready', styles: listStyles() };
      if (name === 'atlas_guide') return { status: 'ready', topic: args.topic, content: await readFile(new URL(`../../../spec/${guides[args.topic]}`, import.meta.url), 'utf8') };
      const current = await view();
      if (context.cancelled) fail('CANCELLED', 'Request cancelled.');
      switch (name) {
        case 'atlas_view': return summary(current, args);
        case 'atlas_refresh': {
          const next = await openAtlas(root);
          if (context.cancelled) fail('CANCELLED', 'Request cancelled.');
          captured = next;
          return { ...summary(next, args), comparison: compareViews(current, next) };
        }
        case 'atlas_inspect': {
          if (['point', 'tree', 'facet', 'style', 'path'].filter(key => args[key] !== undefined).length !== 1) fail('INVALID_ARGUMENT', 'Select exactly one point, tree, facet, style, or path.');
          const result = args.point ? getPoint(current, args.point) : args.tree ? getTree(current, args.tree) : args.facet ? getFacet(current, args.facet) : args.style ? current.atlas?.style : current.files.find(file => file.path === args.path);
          if (args.part === 'details') return readJsonChunk(result ?? null, args);
          return { status: result ? 'ready' : current.status === 'ready' ? 'missing' : current.status, identity: current.identity, record: result ?? null, diagnostics: current.diagnostics };
        }
        case 'atlas_search': return { status: current.status, identity: current.identity, results: searchAtlas(current, { kinds: ['point', 'facet'], presentation: 'summary', ...args }), diagnostics: current.diagnostics };
        case 'atlas_route': return route(current, args);
        case 'atlas_references': return args.uri !== undefined ? sourceCitations(current, args) : args.point || args.facet ? directCiters(current, args, { limit: args.limit }) : referenceIndex(current, args);
        case 'atlas_review_sources': {
          const { draft: target, ...options } = args;
          const draft = target ? await loadDraft(root, target.id) : null;
          if (draft && draft.revision !== target.revision) fail('STALE_DRAFT', 'Reopen the current draft before reviewing its sources.');
          const review = await reviewSources(draft ? inspectChange(draft.plan).after : current, { ...options, allowedRoots: grants });
          const reviewId = randomUUID();
          if (sourceReviews.size >= 16) sourceReviews.delete(sourceReviews.keys().next().value);
          sourceReviews.set(reviewId, review);
          return { ...review, reviewId };
        }
        case 'atlas_source_history': {
          const history = await getSourceReviewHistory(root);
          if (args.expectedRevision !== undefined) summarizeSourceHistory(history, { expectedRevision: args.expectedRevision });
          return args.part === 'details' ? readJsonChunk(history, args) : summarizeSourceHistory(history, args);
        }
        case 'atlas_record_source_review': {
          const review = args.reviewId ? sourceReviews.get(args.reviewId) : undefined;
          if (args.reviewId && !review) fail('REVIEW_EXPIRED', 'The source review is absent or expired; inspect sources again before retaining it.');
          if (!review && !args.decisions?.length) fail('INVALID_ARGUMENT', 'Supply a session reviewId or explicit review decisions.');
          return mutate(context, async () => summarizeSourceHistory(await recordSourceReview(root, { review, decisions: args.decisions, expectedRevision: args.expectedRevision })));
        }
        case 'atlas_prepare_move': {
          baseline(current, args.baseline);
          const { baseline: _, ...request } = args;
          return remember(prepareMove(current, request), 'plan');
        }
        case 'atlas_review_draft': {
          const draft = await loadDraft(root, args.id);
          if (draft.revision !== args.expectedRevision) fail('STALE_DRAFT', 'The saved draft changed; load its current revision.');
          if (args.part === 'details') return readJsonChunk({ draft: summarizeDraft(draft, { full: true }), impact: reviewChange(draft.plan) }, args);
          return { status: 'ready', draft: summarizeDraft(draft, args), ...(args.full ? { impact: reviewChange(draft.plan) } : {}) };
        }
        case 'atlas_attach_draft_check_run': return mutate(context, async () => {
          const run = runs.get(args.runId), target = runTargets.get(args.runId);
          if (!run || !target || target.id !== args.id || target.revision !== args.expectedRevision) fail('STALE_DRAFT', 'This Check run did not review the exact requested draft revision.');
          const draft = await loadDraft(root, args.id);
          if (draft.revision !== args.expectedRevision) fail('STALE_DRAFT', 'The saved draft changed; review its current candidate.');
          const saved = await saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan: draft.plan, review: draft.review, checkRuns: [...(draft.checkRuns ?? []).slice(-9), run] });
          return { status: 'saved', id: saved.id, revision: saved.revision, candidateIdentity: saved.plan.candidate.identity, run: runSummary(run) };
        });
        case 'atlas_read_source': return readSource(current, args.source, { allowedRoots: grants, maxBytes: args.maxBytes ?? 1024 * 1024 });
        case 'atlas_absorb_inspect': return inspectAbsorb(current, args);
        case 'atlas_absorb_prepare': baseline(current, args.baseline); return remember(prepareAbsorb(current, args.proposal), 'proposal');
        case 'atlas_checks': return { status: current.status, identity: current.identity, complete: current.status === 'ready', diagnostics: current.diagnostics,
          checks: current.atlas?.checks.map(({ id, title, path, status, level, revision }) => ({ id, title, path, status, level, revision, verification: 'not-reviewed' })) ?? [],
          limits: ['This inventory lists Check definitions with verification marked not-reviewed. Read each definition, evaluate it against evidence, and inspect the resulting report. Evaluation reports missing verification as unable.'] };
        case 'atlas_evaluate_checks': {
          const draft = args.draft ? await loadDraft(root, args.draft.id) : null;
          if (draft && draft.revision !== args.draft.revision) fail('STALE_DRAFT', 'The draft changed; review the current revision.');
          const target = draft ? inspectChange(draft.plan).after : current;
          baseline(target, args.baseline);
          const run = await evaluateChecks(target, { actor: args.actor, checkIds: args.checkIds, manual: args.manual });
          if (Buffer.byteLength(JSON.stringify(run)) > 4 * 1024 * 1024) fail('RESULT_LIMIT', 'Check evidence exceeds the report bound; review fewer Checks at a time.');
          if (runs.size >= 8) { const first = runs.keys().next().value; runs.delete(first); runTargets.delete(first); }
          runs.set(run.id, run);
          if (draft) runTargets.set(run.id, { id: draft.id, revision: draft.revision });
          return { ...runSummary(run), ...(draft ? { draft: args.draft } : {}) };
        }
        case 'atlas_check_run': {
          const run = runs.get(args.id);
          if (!run) fail('RUN_EXPIRED', 'This Check run is absent or expired. Read a retained report or explicitly review again.');
          return readChunk(run, args);
        }
        case 'atlas_retain_check_run': {
          const run = runs.get(args.id);
          if (!run) fail('RUN_EXPIRED', 'Only a Check run produced in this session can be retained.');
          return mutate(context, async () => { const report = await retainCheckRun(root, run); return { status: 'retained', id: report.id, digest: report.digest, baseline: run.baseline }; });
        }
        case 'atlas_check_reports': return { status: 'ready', reports: await listCheckReports(root) };
        case 'atlas_check_report': {
          const report = await readCheckReport(root, args.id, { view: current });
          return args.part === 'details' ? readChunk(report, args) : { ...runSummary(report.run), id: report.id, digest: report.digest, freshness: report.freshness };
        }
        case 'atlas_prepare_change': baseline(current, args.baseline); return remember(await prepareChangeFromDisk(root, args.request, { view: current }), 'plan');
        case 'atlas_init': { baseline(current, args.baseline); const { baseline: _, ...request } = args; return remember(prepareInitialization(current, request), 'plan'); }
        case 'atlas_prepare_style': { baseline(current, args.baseline); const { baseline: _, ...request } = args; return remember(prepareStyleChange(current, request), 'plan'); }
        case 'atlas_save_draft': {
          const saved = proposals.get(args.proposalId);
          if (!saved) fail('PROPOSAL_MISSING', 'Proposal is absent or expired; prepare it against an explicit baseline.');
          if (saved.kind === 'proposal' && saved.value.status === 'invalid') fail('INVALID_PROPOSAL', 'An invalid Absorb proposal cannot become an applyable draft.');
          const plan = saved.kind === 'plan' ? saved.value : saved.value.plan;
          return mutate(context, async () => {
            const draft = await saveDraft(root, { ...(args.id && { id: args.id }), plan, expectedRevision: args.expectedRevision, ...(saved.kind === 'proposal' ? { review: saved.value.review } : {}) });
            return { status: 'saved', id: draft.id, revision: draft.revision, baseline: draft.plan.baseline.identity, draftStatus: draft.plan.status };
          });
        }
        case 'atlas_apply_draft': return mutate(context, async () => {
          const result = await applyDraft(root, args.id, { expectedRevision: args.expectedRevision, allowedRoots: grants });
          captured = await openAtlas(root);
          return { ...result, view: summary(captured) };
        });
        case 'atlas_recover': return mutate(context, async () => {
          const result = await recoverChange(root, args.id);
          captured = await openAtlas(root);
          return { ...result, view: summary(captured) };
        });
        case 'atlas_list_state': return { status: 'ready', drafts: await listDrafts(root), transactions: await listTransactions(root) };
        case 'atlas_load_draft': { const draft = await loadDraft(root, args.id); return args.part === 'details' ? readJsonChunk(draft, args) : { status: 'ready', draft: summarizeDraft(draft, args) }; }
        case 'atlas_delete_draft': return mutate(context, () => deleteDraft(root, args.id, { expectedRevision: args.expectedRevision }));
      }
    },
  };
}
