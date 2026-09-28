import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openAtlas, getPoint, getTree, getFacet, searchAtlas, compareViews, readSource } from '../../../library/src/model.mjs';
import { prepareChangeFromDisk, prepareInitialization, applyDraft, recoverChange, saveDraft, loadDraft, listDrafts, deleteDraft, listTransactions } from '../../../library/src/authoring.mjs';
import { route } from '../../../library/src/route.mjs';
import { inspectAbsorb, prepareAbsorb } from '../../../library/src/absorb.mjs';
import { evaluateChecks, retainCheckRun, listCheckReports, readCheckReport } from '../../../library/src/checks.mjs';

const text = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength });
const id = { ...text(100), pattern: '^[a-z0-9][a-z0-9-]*$' };
const hash = { ...text(64), pattern: '^[a-f0-9]{64}$' };
const number = (maximum) => ({ type: 'integer', minimum: 1, maximum });
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });
const source = object({ uri: text(), title: text(), role: { enum: ['evidence', 'background', 'example', 'implementation', 'history'] }, revision: text(), locator: text(), sha256: hash }, ['uri']);
const changes = array(object({ path: text(), content: { type: ['string', 'null'], maxLength: 2 * 1024 * 1024 } }, ['path', 'content']));
const request = object({ changes, reason: text(16384), sourcePreconditions: array(object({ uri: text(), sha256: hash }, ['uri', 'sha256']), 100) }, ['changes', 'reason']);
const proposal = object({ source, contributions: array(object({ disposition: { enum: ['update', 'create', 'facet', 'conflict', 'reference-only', 'non-integration'] }, rationale: text(16384), point: id, tree: id, facet: id }, ['disposition', 'rationale'])), changes, rationale: text(16384), unresolved: array(text(16384), 100) }, ['source', 'contributions', 'changes', 'rationale']);
const guides = Object.freeze({ operating: 'OPERATING.md', meaning: 'SPEC.md', format: 'spec/FORMAT.md' });
const manual = array(object({ id, revision: hash, baseline: hash, outcome: { enum: ['pass', 'fail', 'unable'] }, reason: text(16384), evidence: array(object({ text: text(16384), source }, ['text']), 100) }, ['id', 'revision', 'baseline', 'outcome', 'reason', 'evidence']));
const chunk = { offset: { type: 'integer', minimum: 0, maximum: 4 * 1024 * 1024 }, maxBytes: { type: 'integer', minimum: 4, maximum: 128 * 1024 }, expectedSha256: hash };
const definitions = [
  ['atlas_guide', 'Read a packaged operating, meaning, or format guide. Start with operating, then inspect Atlas context. Actions require caller-supplied permission.', object({ topic: { enum: Object.keys(guides) } }, ['topic'])],
  ['atlas_view', 'Inspect the captured Atlas identity, diagnostics, and record index.', object()],
  ['atlas_refresh', 'Capture current authored files and compare them with the prior observation.', object()],
  ['atlas_inspect', 'Inspect one exact Point, Tree, Facet, or captured authored file.', object({ point: id, tree: id, facet: object({ tree: id, id }, ['tree', 'id']), path: text() })],
  ['atlas_search', 'Find bounded lexical Point candidates within the captured Atlas.', object({ query: text(), tree: id, type: { enum: ['decision', 'observation', 'untyped'] }, limit: number(100) }, ['query'])],
  ['atlas_route', 'Suggest a coherent reading path from a Point, Tree, or question.', object({ point: id, tree: id, query: text(), detail: { enum: ['overview', 'standard', 'deep'] }, type: { enum: ['decision', 'observation', 'untyped'] }, limit: number(100) })],
  ['atlas_read_source', 'Read a source within launch-time grants. HTTP(S) URLs are never fetched.', object({ source, maxBytes: number(1024 * 1024) }, ['source'])],
  ['atlas_absorb_inspect', 'Find candidate Points, owning Trees and existing Facets for the author to assess against incoming material.', object({ text: text(1024 * 1024), source, tree: id, limit: number(100) }, ['text', 'source'])],
  ['atlas_absorb_prepare', 'Prepare explicit contribution decisions and file changes against an exact captured baseline.', object({ baseline: hash, proposal }, ['baseline', 'proposal'])],
  ['atlas_checks', 'List Check definitions. Use atlas_inspect path to read each full definition and atlas_evaluate_checks to record its review.', object()],
  ['atlas_evaluate_checks', 'Record explicit manual review against the captured baseline. No evaluator code runs; Checks without supplied review remain unable. Returns a run summary; read complete evidence with atlas_check_run.', object({ baseline: hash, actor: text(1024), checkIds: array(id), manual }, ['baseline', 'actor'])],
  ['atlas_check_run', 'Read bounded UTF-8 JSON details and evidence from a session Check run. Follow nextOffset and verify byteLength and sha256.', object({ id, ...chunk }, ['id'])],
  ['atlas_retain_check_run', 'Retain a session-produced Check run in private storage. Storage integrity does not authenticate the manual reviewer.', object({ id }, ['id']), true],
  ['atlas_check_reports', 'List retained Check report summaries without evaluating or changing them.', object()],
  ['atlas_check_report', 'Inspect a retained Check report and its freshness. Select details for bounded JSON evidence; follow nextOffset until complete.', object({ id, part: { enum: ['summary', 'details'] }, ...chunk }, ['id'])],
  ['atlas_prepare_change', 'Preview complete file changes against an exact captured baseline without writing.', object({ baseline: hash, request }, ['baseline', 'request'])],
  ['atlas_init', 'Prepare an empty Atlas for a root with no manifest. Save and apply are separate.', object({ baseline: hash, id, title: text() }, ['baseline', 'id', 'title'])],
  ['atlas_save_draft', 'Persist a proposal prepared in this session, retaining its original baseline. Updating an existing draft requires its current revision.', object({ proposalId: id, id, expectedRevision: hash }, ['proposalId']), true],
  ['atlas_apply_draft', 'Apply the exact saved draft revision you reviewed, with complete stale-source and candidate checks.', object({ id, expectedRevision: hash }, ['id', 'expectedRevision']), true],
  ['atlas_recover', 'Roll back an interrupted transaction while refusing foreign edits.', object({ id }, ['id']), true],
  ['atlas_list_state', 'List saved drafts and transactions for the fixed Atlas root.', object()],
  ['atlas_load_draft', 'Read a saved draft without refreshing or changing its baseline.', object({ id }, ['id'])],
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

function summary(view) {
  const atlas = view.atlas;
  return {
    format: view.format, status: view.status, root: view.root, identity: view.identity, diagnostics: view.diagnostics,
    files: view.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    atlas: atlas && {
      format: atlas.format, id: atlas.id, title: atlas.title,
      trees: atlas.trees.map(({ id, title, scope, base, path }) => ({ id, title, scope, base, path })),
      points: atlas.points.map(({ id, tree, title, path, type, status, observedAt }) => ({ id, tree, title, path, type, status, observedAt })),
      branches: atlas.branches.map(({ id, tree, title, ancestors }) => ({ id, tree, title, ancestors })),
      facets: atlas.facets.map(({ id, tree, title, path, on, via, targets }) => ({ id, tree, title, path, on, via, targets })),
      checks: atlas.checks.map(({ id, status, level, path, revision }) => ({ id, status, level, path, revision })),
    },
  };
}

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
      if (name === 'atlas_guide') return { status: 'ready', topic: args.topic, content: await readFile(new URL(`../../../spec/${guides[args.topic]}`, import.meta.url), 'utf8') };
      const current = await view();
      if (context.cancelled) fail('CANCELLED', 'Request cancelled.');
      switch (name) {
        case 'atlas_view': return summary(current);
        case 'atlas_refresh': {
          const next = await openAtlas(root);
          if (context.cancelled) fail('CANCELLED', 'Request cancelled.');
          captured = next;
          return { ...summary(next), comparison: compareViews(current, next) };
        }
        case 'atlas_inspect': {
          if (Object.keys(args).length !== 1) fail('INVALID_ARGUMENT', 'Select exactly one point, tree, facet, or path.');
          const result = args.point ? getPoint(current, args.point) : args.tree ? getTree(current, args.tree) : args.facet ? getFacet(current, args.facet) : current.files.find(file => file.path === args.path);
          return { status: result ? 'ready' : current.status === 'ready' ? 'missing' : current.status, identity: current.identity, record: result ?? null, diagnostics: current.diagnostics };
        }
        case 'atlas_search': return { status: current.status, identity: current.identity, results: searchAtlas(current, args), diagnostics: current.diagnostics };
        case 'atlas_route': return route(current, args);
        case 'atlas_read_source': return readSource(current, args.source, { allowedRoots: grants, maxBytes: args.maxBytes ?? 1024 * 1024 });
        case 'atlas_absorb_inspect': return inspectAbsorb(current, args);
        case 'atlas_absorb_prepare': baseline(current, args.baseline); return remember(prepareAbsorb(current, args.proposal), 'proposal');
        case 'atlas_checks': return { status: current.status, identity: current.identity, complete: current.status === 'ready', diagnostics: current.diagnostics,
          checks: current.atlas?.checks.map(({ id, title, path, status, level, revision }) => ({ id, title, path, status, level, revision, verification: 'not-reviewed' })) ?? [],
          limits: ['This inventory lists Check definitions with verification marked not-reviewed. Read each definition, evaluate it against evidence, and inspect the resulting report. Evaluation reports missing verification as unable.'] };
        case 'atlas_evaluate_checks': {
          baseline(current, args.baseline);
          const run = await evaluateChecks(current, { actor: args.actor, checkIds: args.checkIds, manual: args.manual });
          if (Buffer.byteLength(JSON.stringify(run)) > 4 * 1024 * 1024) fail('RESULT_LIMIT', 'Check evidence exceeds the report bound; review fewer Checks at a time.');
          if (runs.size >= 8) runs.delete(runs.keys().next().value);
          runs.set(run.id, run);
          return runSummary(run);
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
        case 'atlas_init': baseline(current, args.baseline); return remember(prepareInitialization(current, { id: args.id, title: args.title }), 'plan');
        case 'atlas_save_draft': {
          const saved = proposals.get(args.proposalId);
          if (!saved) fail('PROPOSAL_MISSING', 'Proposal is absent or expired; prepare it against an explicit baseline.');
          if (saved.kind === 'proposal' && saved.value.status === 'invalid') fail('INVALID_PROPOSAL', 'An invalid Absorb proposal cannot become an applyable draft.');
          const plan = saved.kind === 'plan' ? saved.value : saved.value.plan;
          return mutate(context, async () => {
            const draft = await saveDraft(root, { ...(args.id && { id: args.id }), plan, expectedRevision: args.expectedRevision });
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
        case 'atlas_load_draft': return { status: 'ready', draft: await loadDraft(root, args.id) };
        case 'atlas_delete_draft': return mutate(context, () => deleteDraft(root, args.id, { expectedRevision: args.expectedRevision }));
      }
    },
  };
}
