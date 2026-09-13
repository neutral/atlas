import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import * as atlas from 'atlas-reference-validator';

export const MAX_AGENT_OUTPUT = 16 * 1024 * 1024;
export const MAX_AGENT_FRAME = 2 * 1024 * 1024;
const MAX_AGENT_PLAN = 64 * 1024 * 1024;
const guides = { operating: 'OPERATING.md', meaning: 'SPEC.md', glossary: 'GLOSSARY.md',
  format: 'spec/FORMAT.md', processing: 'spec/PROCESSING.md', validation: 'spec/VALIDATION.md', checks: 'spec/CHECKS.md',
  publication: 'spec/PUBLICATION.md', conformance: 'spec/CONFORMANCE.md', tools: 'spec/TOOLS.md', workspace: 'spec/WORKSPACE.md',
  authoring: 'spec/AUTHORING.md', evaluation: 'spec/EVALUATION.md', editor: 'spec/EDITOR.md', 'agent-tools': 'spec/AGENT-TOOLS.md', schemas: 'schemas/README.md' };
const object = (properties = {}, required = Object.keys(properties), extra = {}) => ({ type: 'object', properties, required, additionalProperties: false, ...extra });
const string = { type: 'string', minLength: 1, maxLength: 4096 };
const id = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const relative = { type: 'string', pattern: '^(?!/)(?!.*[\\\\\u0000-\u001f])(?!(?:.*/)?\\.\\.?(?:/|$))[^/]+(?:/[^/]+)*$', maxLength: 4096 };
const paths = { type: 'array', minItems: 1, maxItems: 1000, uniqueItems: true, items: { anyOf: [relative, { const: '.' }] } };
const stringArray = { type: 'array', maxItems: 1000, uniqueItems: true, items: string };
const fields = { type: 'object' };
const has = (name) => ({ properties: { [name]: {} }, required: [name] });
const body = { type: 'string', maxLength: 1024 * 1024 };
const action = { enum: ['create', 'update'] };
const update = { action, id: string, set: fields, unset: stringArray, body };
const operations = { type: 'array', minItems: 1, maxItems: 50, items: { oneOf: [
  object({ type: { const: 'initialize' }, fields, body }, ['type', 'fields']),
  object({ type: { const: 'map' }, ...update, directory: relative }, ['type', 'action', 'id']),
  object({ type: { const: 'area' }, ...update, mapId: string }, ['type', 'action', 'id', 'mapId']),
  object({ type: { const: 'point' }, ...update, mapId: string, record: { enum: ['anchor', 'context'] } }, ['type', 'action', 'id', 'mapId', 'record']),
  object({ type: { const: 'resource' }, ...update }, ['type', 'action', 'id']),
  object({ type: { const: 'supersede' }, sourceId: string, targetId: string, note: string }),
  object({ type: { const: 'catalog' }, set: fields, unset: stringArray }, ['type']),
  object({ type: { const: 'connection' }, ...update, collection: { enum: ['memberships', 'relations', 'content', 'references'] } }, ['type', 'action', 'id', 'collection']),
  object({ type: { const: 'adopt-check' }, id: string, text: body, registration: fields, source: object({ uri: string, sha256: string }, ['uri']) }),
  object({ type: { const: 'publication' }, action: { const: 'create' }, id: string, text: body }),
  object({ type: { const: 'repair-document' }, path: relative, text: body }),
] } };
const selector = object({ viewId: id });
const index = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const chunk = { offset: index, maxBytes: { type: 'integer', minimum: 4, maximum: 1024 * 1024 }, expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } };
const evidenceChunk = { ...chunk, maxBytes: { ...chunk.maxBytes, minimum: 1 }, evaluationIndex: index, evidenceIndex: index };
const runRead = object({ runId: id, part: { enum: ['details', 'evidence'] }, ...evidenceChunk }, ['runId'], { oneOf: [
  object({ runId: id, part: { const: 'details' }, ...chunk }, ['runId']),
  object({ runId: id, part: { const: 'evidence' }, ...evidenceChunk }, ['runId', 'part', 'evaluationIndex', 'evidenceIndex']),
] });
const reportRead = object({ reportId: id, viewId: id, part: { enum: ['details', 'evidence'] }, ...evidenceChunk }, ['reportId'], { oneOf: [
  object({ reportId: id, viewId: id }, ['reportId']),
  object({ reportId: id, viewId: id, part: { const: 'details' }, ...chunk }, ['reportId', 'part']),
  object({ reportId: id, viewId: id, part: { const: 'evidence' }, ...evidenceChunk }, ['reportId', 'part', 'evaluationIndex', 'evidenceIndex']),
] });
const outputSchema = object({ contract: { const: 'atlas.agent-result/1' }, tool: string, data: { type: 'object' } });
function tool(name, description, inputSchema, effects = {}) {
  return { name: `atlas_${name}`, description, inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...inputSchema }, outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, ...effects } };
}
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export const ATLAS_AGENT_TOOLS = freeze([
  tool('state', 'Open current Atlas state with Map questions, counts, gaps, freshness, and a captured view id.', object()),
  tool('guide', 'Read one packaged guide and its source-owner map. Start with operating; load linked meaning, format, authoring or evaluation details only when needed.', object({ topic: { enum: Object.keys(guides) } })),
  tool('read', 'Read an exact captured Atlas, Map, Area, Check, or raw document. Invalid documents remain readable with diagnostics.', object({ viewId: id, kind: { enum: ['atlas', 'map', 'area', 'check', 'document'] }, id: string, mapId: string, path: relative }, ['viewId', 'kind'], {
    oneOf: [
      object({ viewId: id, kind: { const: 'atlas' } }),
      object({ viewId: id, kind: { const: 'map' }, id: string }),
      object({ viewId: id, kind: { const: 'area' }, id: string, mapId: string }),
      object({ viewId: id, kind: { const: 'check' }, id: string }),
      object({ viewId: id, kind: { const: 'document' }, path: relative }),
    ],
  })),
  tool('find', 'Find lexical candidates in a captured view. Default ranked mode treats input as ordinary text and ranks token matches. Explicit fts mode accepts SQLite FTS5 phrase, prefix, Boolean, and proximity syntax. Inspect matched records and sources; ranking does not establish relevance, absence, or identity.', object({ viewId: id, query: { type: 'string', maxLength: 4096 }, mode: { enum: ['ranked', 'fts'] },
    types: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['map', 'area', 'point', 'resource', 'check'] } }, limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: string }, ['viewId', 'query'])),
  tool('point', 'Inspect an exact Point id across its anchor and authored contexts, Maps, relations, and provenance.', object({ viewId: id, id: string })),
  tool('resource', 'Inspect an exact registered Resource and authored uses. This does not fetch its URI.', object({ viewId: id, id: string })),
  tool('source', 'Read an explicit Resource or URI within the host-selected repository grant. Network retrieval is not installed.', object({ viewId: id,
    target: { oneOf: [object({ resource: string, selector: string }, ['resource']), object({ uri: string })] }, ownerPath: relative, maxBytes: { type: 'integer', minimum: 1, maximum: 1024 * 1024 } }, ['viewId', 'target'])),
  tool('freshness', 'Check current examined inputs against a captured view without replacing it.', selector),
  tool('refresh', 'Rebuild the workspace observation and return a compact state with a new view id.', object()),
  tool('compare', 'Compare two retained views and preserve source differences separately from normalized differences.', object({ beforeViewId: id, afterViewId: id })),
  tool('prepare', 'Prepare an explicit change without writing. Returns complete per-file before/after bytes, diffs, validation and identity decisions. Inspect the entire descriptor before applying.', object({ viewId: id, atlasMissing: { const: true }, operations }, ['operations'], { oneOf: [{ ...has('viewId'), not: has('atlasMissing') }, { ...has('atlasMissing'), not: has('viewId') }] })),
  tool('apply', 'Apply one already reviewed plan by opaque id and exact reviewed digest. Requires caller authorization. Consumes the id; stale or partial results require fresh preparation.', object({ planId: id, reviewedDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, mode: { enum: ['validated', 'draft'] } }, ['planId', 'reviewedDigest']),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false }),
  tool('checks', 'Discover adopted Check bodies and exact registered evaluator support without running Verification.', object({ viewId: id, status: { enum: ['draft', 'active', 'retired'] }, level: { enum: ['required', 'advisory'] },
    appliesTo: { enum: ['atlas', 'map', 'area', 'point-anchor', 'point-context', 'resource', 'check', 'publication'] }, paths, checkIds: stringArray }, ['viewId'])),
  tool('evaluate', 'Explicitly run trusted host-selected Check evaluators with actor attribution. Return a retained session run id and compact outcome; use atlas_run for complete details and original evidence. No implicit durable report write.', object({ viewId: id, planId: id,
    actor: object({ kind: { enum: ['human', 'agent', 'tool'] }, id: string }), paths, checkIds: stringArray }, ['actor'],
    { oneOf: [{ ...has('viewId'), not: has('planId') }, { ...has('planId'), not: has('viewId') }] }),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }),
  tool('run', 'Read bounded details or original evidence from an executed session run without rerunning Verification. Details are UTF-8 JSON text; evidence uses base64. Follow nextOffset until complete and verify the whole byte length and SHA-256.', runRead),
  tool('retain', 'Retain a genuine executed run and original evidence in fixed durable storage. Retention does not verify a Check.', object({ runId: id }), { readOnlyHint: false, idempotentHint: false }),
  tool('reports', 'List retained report ids in fixed owned state. No repair or Verification occurs.', object()),
  tool('report', 'Verify a retained report and return a compact integrity, freshness, and outcome summary. Select details for bounded report/provenance JSON text or evidence for original base64 bytes. Follow nextOffset until complete. Does not re-run Verification.', reportRead),
]);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const inputValidators = new Map(ATLAS_AGENT_TOOLS.map((item) => [item.name, ajv.compile(item.inputSchema)]));
const validateOutput = ajv.compile(outputSchema);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
function fail(code, message) { throw new atlas.AtlasToolError(`atlas.agent.${code}`, message); }
function requireValue(condition, message) { if (!condition) fail('invalid-argument', message); }
function bounded(value) {
  // Include duplicated MCP content, JSON escaping, newline, and the largest admitted request id.
  const message = { jsonrpc: '2.0', id: null, result: { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false } };
  requireValue(Buffer.byteLength(JSON.stringify(message)) + MAX_AGENT_FRAME + 1 <= MAX_AGENT_OUTPUT, 'The complete tool result exceeds the transport bound. Narrow the request; no content was truncated.');
  return value;
}
function outcome(run, evaluations) {
  const counts = { pass: 0, fail: 0, unable: 0, 'not-applicable': 0 };
  for (const item of evaluations) counts[item.outcome]++;
  return { status: run.status, requiredSatisfied: run.requiredSatisfied, wholeAtlasCompliant: run.wholeAtlasCompliant,
    complete: run.complete, evaluations: counts, freshness: { status: run.freshness.status },
    ...(run.validation ? { validation: { complete: run.validation.complete, valid: run.validation.valid } } : {}) };
}
function readChunk(bytes, args, encoding) {
  const offset = args.offset ?? 0, maxBytes = args.maxBytes ?? 65536;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  requireValue(args.expectedSha256 === undefined || args.expectedSha256 === sha256, 'The selected content changed. Restart retrieval from offset zero and compare its complete content identity.');
  requireValue(offset <= bytes.length, 'Chunk offset exceeds the selected content byte length.');
  let end = Math.min(offset + maxBytes, bytes.length);
  if (encoding === 'utf-8') {
    const continuation = (at) => at < bytes.length && (bytes[at] & 0xc0) === 0x80;
    requireValue(!continuation(offset), 'Details offset must begin at a UTF-8 character boundary. Use the returned nextOffset.');
    while (continuation(end)) end--;
  }
  return { encoding, byteLength: bytes.length, sha256, offset,
    returnedBytes: end - offset, nextOffset: end < bytes.length ? end : null, complete: end === bytes.length,
    ...(encoding === 'utf-8' ? { text: bytes.subarray(offset, end).toString('utf8') } : { bytesBase64: bytes.subarray(offset, end).toString('base64') }) };
}
function runDetails(run) {
  return { ...run, evaluations: run.evaluations.map((evaluation) => ({ ...evaluation,
    evidence: evaluation.evidence.map(({ bytesBase64, ...metadata }) => metadata) })) };
}
function existingDirectory(directory) {
  const parent = path.dirname(directory);
  if (parent !== directory) existingDirectory(parent);
  const stat = fs.lstatSync(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'State paths must use real directories.');
}
function canonicalDestination(selected) {
  requireValue(typeof selected === 'string' && path.isAbsolute(selected) && !selected.includes('\0'), 'stateDirectory must be absolute.');
  let current = path.resolve(selected);
  const missing = [];
  while (!fs.existsSync(current)) { missing.unshift(path.basename(current)); current = path.dirname(current); }
  requireValue(fs.lstatSync(current).isDirectory() && !fs.lstatSync(current).isSymbolicLink(), 'State ancestry must use a directory.');
  return path.join(fs.realpathSync(current), ...missing);
}

export function openAgentSession(options) {
  requireValue(plain(options) && Object.keys(options).every((key) => ['repositoryRoot', 'atlasPath', 'stateDirectory', 'registrations'].includes(key)), 'Unsupported host session options.');
  requireValue(typeof options.repositoryRoot === 'string' && path.isAbsolute(options.repositoryRoot), 'repositoryRoot must be absolute.');
  requireValue(typeof options.atlasPath === 'string' && (options.atlasPath === '.' || new RegExp(relative.pattern, 'u').test(options.atlasPath)), 'atlasPath must be exact and repository-relative.');
  const repositoryRoot = fs.realpathSync(options.repositoryRoot), atlasRoot = path.resolve(repositoryRoot, options.atlasPath);
  requireValue(fs.lstatSync(repositoryRoot).isDirectory(), 'repositoryRoot must be a directory.');
  const workspaceOptions = { repositoryRoot, atlasPath: options.atlasPath };
  let workspace = fs.existsSync(atlasRoot) ? atlas.openWorkspace(workspaceOptions) : null;
  const info = workspace?.info ?? { repositoryRoot, atlasRoot, atlasPath: options.atlasPath };
  const stateDirectory = canonicalDestination(options.stateDirectory);
  for (const forbidden of [info.atlasRoot, path.join(info.repositoryRoot, 'tmp'), path.join(info.repositoryRoot, '.git')]) {
    requireValue(!inside(forbidden, stateDirectory) && !inside(stateDirectory, forbidden), 'State storage must be separate from Atlas, repository tmp, and .git.');
  }
  const registry = atlas.createEvaluatorRegistry(options.registrations ?? []), views = new Map(), plans = new Map(), runs = new Map(), viewConfigurations = new WeakMap();
  let closed = false;
  const keep = (map, key, value, limit) => { map.set(key, value); while (map.size > limit) map.delete(map.keys().next().value); return key; };
  const get = (map, key, kind) => { if (!map.has(key)) fail('expired', kind === 'executed run'
    ? 'Unknown or expired executed run. Inspect its durable report if retained; evaluation requires a new explicit request.'
    : `Unknown or expired ${kind}. Open or prepare it again.`); return map.get(key); };
  function storage() {
    if (!fs.existsSync(stateDirectory)) return [];
    existingDirectory(stateDirectory);
    const entries = fs.readdirSync(stateDirectory);
    requireValue(entries.length <= 10000, 'State storage exceeds 10,000 entries. Inspect current reports and discard unneeded inactive recovery through atlas-author.');
    const reports = [];
    for (const entry of entries) {
      const directory = path.join(stateDirectory, entry);
      existingDirectory(directory);
      if (uuid(entry)) {
        const retained = atlas.readCheckReport(directory);
        requireValue(retained.provenance.repositoryRoot === info.repositoryRoot && retained.provenance.run.atlasRoot === info.atlasRoot, 'A retained report belongs to another selected workspace.');
        reports.push(entry);
      } else if (/^change-[A-Za-z0-9]{6}$/u.test(entry)) {
        requireValue(fs.lstatSync(path.join(directory, 'plan.json')).size <= MAX_AGENT_PLAN, 'The recovery plan exceeds the adapter plan allowance. Inspect it through the public authoring API.');
        atlas.inspectAtlasRecovery({ repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath, recoveryDirectory: directory });
      } else fail('unowned-state', 'The selected state directory contains an unrecognized entry.');
    }
    return reports.sort();
  }
  function state(refresh = false) {
    if (!workspace) {
      if (!fs.existsSync(info.atlasRoot)) return { viewId: null, status: 'missing', atlasMissing: true, workspace: info,
        maps: [], counts: null, limits: ['The selected Atlas is absent. Explicit initialization can prepare new files without writing them.'] };
      workspace = atlas.openWorkspace(workspaceOptions);
    }
    const envelope = workspace[refresh ? 'refresh' : 'read'](), view = envelope.view;
    viewConfigurations.set(view, workspace.info);
    const viewId = keep(views, randomUUID(), view, 8), model = view.validation.normalized;
    return { viewId, status: view.status, atlasMissing: !view.identity.inputs.some((input) => input.path === 'atlas.md' && input.kind === 'file'),
      workspace: workspace.info, identity: { digest: view.identity.digest, inputDigest: view.identity.inputDigest, scope: view.identity.scope, specificationRevision: view.identity.specificationRevision },
      validation: { complete: view.validation.complete, valid: view.validation.valid, diagnostics: view.validation.diagnostics },
      atlas: model ? { id: model.atlas.id, title: model.atlas.title, summary: model.atlas.summary } : null,
      maps: model?.maps.map(({ id, title, summary, question, path: mapPath, areas }) => ({ id, title, summary, question, path: mapPath,
        areas: areas.map(({ id, title, question }) => ({ id, title, question })) })) ?? [],
      counts: model ? { maps: model.maps.length, points: model.points.length, resources: model.atlas.resources.length, checks: model.checks.length } : null,
      freshness: envelope.freshness, limits: view.limits };
  }
  async function operation(name, args, signal) {
    const opened = args.viewId ? get(views, args.viewId, 'view') : null;
    if (name === 'atlas_state') return state();
    if (name === 'atlas_refresh') return state(true);
    if (name === 'atlas_guide') {
      const source = fs.readFileSync(new URL(`../guides/${guides[args.topic]}`, import.meta.url));
      const manifest = JSON.parse(fs.readFileSync(new URL('../guides/source-owners.json', import.meta.url), 'utf8'));
      return { topic: args.topic, text: source.toString('utf8'), sha256: createHash('sha256').update(source).digest('hex'), source: guides[args.topic],
        availableGuides: guides, sourceOwners: manifest };
    }
    if (name === 'atlas_find') { const { viewId, query, ...selected } = args; return opened.find(query, selected); }
    if (name === 'atlas_point') return opened.inspectPoint(args.id);
    if (name === 'atlas_resource') return opened.inspectResource(args.id);
    if (name === 'atlas_source') return opened.readSource(args.target, { ...(args.ownerPath === undefined ? {} : { ownerPath: args.ownerPath }),
      maxBytes: args.maxBytes ?? 65536, allowedRoots: [info.repositoryRoot], signal });
    if (name === 'atlas_freshness') return opened.freshness();
    if (name === 'atlas_compare') return get(views, args.beforeViewId, 'view').compare(get(views, args.afterViewId, 'view'));
    if (name === 'atlas_read') {
      const expected = { atlas: [], map: ['id'], area: ['id', 'mapId'], check: ['id'], document: ['path'] }[args.kind];
      requireValue(Object.keys(args).every((key) => ['viewId', 'kind', ...expected].includes(key)), 'The selected read kind received an unrelated selector.');
      if (args.kind === 'document') return opened.readDocument(args.path);
      const model = opened.validation.normalized;
      if (!model) return { status: opened.status, validation: opened.validation.toJSON() };
      const record = args.kind === 'atlas' ? model.atlas : args.kind === 'map' ? model.maps.find((map) => map.id === args.id)
        : args.kind === 'area' ? model.maps.find((map) => map.id === args.mapId)?.areas.find((area) => area.id === args.id)
          : model.checks.find((check) => check.id === args.id);
      return record ? { status: 'found', kind: args.kind, record, identity: opened.identity } : { status: 'not-found', kind: args.kind, id: args.id };
    }
    if (name === 'atlas_prepare') {
      let configuration;
      if (opened) {
        const current = atlas.openWorkspace({ repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath });
        try {
          configuration = current.info.configuration;
          if (viewConfigurations.get(opened).configurationSourceDigest !== current.info.configurationSourceDigest) fail('stale', 'Workspace configuration changed after the selected observation.');
        } finally { current.close(); }
      }
      const plan = atlas.prepareAtlasChange({ repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath,
        ...(configuration === undefined ? {} : { configuration }), expected: opened ? { viewDigest: opened.identity.digest } : { atlasMissing: true }, operations: args.operations });
      requireValue(Buffer.byteLength(JSON.stringify(plan)) <= MAX_AGENT_PLAN, 'The sealed internal plan exceeds the 64 MiB plan allowance. Use the public authoring API for a larger source inventory.');
      const { baseline, ...descriptor } = plan;
      const planId = randomUUID(), result = bounded({ planId, plan: { ...descriptor, baseline: { identity: baseline.identity, inputDigest: baseline.inputDigest,
        atlasPresent: baseline.atlasPresent, rootPresent: baseline.rootPresent } } });
      keep(plans, planId, plan, 16);
      return result;
    }
    if (name === 'atlas_apply') {
      const plan = get(plans, args.planId, 'prepared plan');
      requireValue(args.reviewedDigest === plan.digest, 'The reviewed digest must match the complete prepared descriptor.');
      storage(); plans.delete(args.planId);
      return { result: atlas.applyAtlasChange(plan, { recoveryDirectory: stateDirectory, ...(args.mode ? { mode: args.mode } : {}) }) };
    }
    if (name === 'atlas_checks') { const { viewId, ...filters } = args; return atlas.discoverChecks(opened, { ...filters, registry }); }
    if (name === 'atlas_evaluate') {
      const options = { registry, actor: args.actor, signal, ...(args.paths === undefined ? {} : { paths: args.paths }), ...(args.checkIds === undefined ? {} : { checkIds: args.checkIds }) };
      const run = args.planId ? (await atlas.evaluatePreparedChange(get(plans, args.planId, 'prepared plan'), options)).run : await atlas.evaluateChecks(opened, options);
      const runId = keep(runs, randomUUID(), run, 32);
      return { runId, outcome: outcome(run, run.evaluations), detailsComplete: false };
    }
    if (name === 'atlas_run') {
      const run = get(runs, args.runId, 'executed run'), part = args.part ?? 'details';
      if (part === 'details') return { runId: args.runId, part, chunk: readChunk(Buffer.from(JSON.stringify(runDetails(run))), args, 'utf-8') };
      const evidence = run.evaluations[args.evaluationIndex]?.evidence[args.evidenceIndex];
      requireValue(evidence !== undefined, 'Unknown evaluation or evidence index. Read run details for the exact evidence inventory.');
      return { runId: args.runId, part, evaluationIndex: args.evaluationIndex, evidenceIndex: args.evidenceIndex,
        chunk: readChunk(Buffer.from(evidence.bytesBase64, 'base64'), args, 'base64') };
    }
    if (name === 'atlas_retain') {
      const run = get(runs, args.runId, 'executed run');
      storage();
      const reportId = randomUUID();
      const retained = atlas.retainCheckReport(run, { directory: path.join(stateDirectory, reportId), repositoryRoot: info.repositoryRoot });
      return { reportId, status: retained.status, directory: retained.directory, outcome: outcome(run, run.evaluations), detailsComplete: false };
    }
    if (name === 'atlas_reports') return { reportIds: storage() };
    if (name === 'atlas_report') {
      requireValue(storage().includes(args.reportId), 'Unknown retained report id.');
      const retained = atlas.readCheckReport(path.join(stateDirectory, args.reportId), opened ? { view: opened } : {});
      if (args.part === 'details') {
        const { evidence, ...details } = retained;
        return { reportId: args.reportId, part: args.part, chunk: readChunk(Buffer.from(JSON.stringify({ ...details,
          evidence: evidence.map(({ bytesBase64, ...metadata }) => metadata) })), args, 'utf-8') };
      }
      if (args.part === 'evidence') {
        const evidence = retained.evidence.find(item => item.evaluationIndex === args.evaluationIndex && item.evidenceIndex === args.evidenceIndex);
        requireValue(evidence !== undefined, 'Unknown evaluation or evidence index. Read report details for the exact evidence inventory.');
        return { reportId: args.reportId, part: args.part, evaluationIndex: args.evaluationIndex, evidenceIndex: args.evidenceIndex,
          chunk: readChunk(Buffer.from(evidence.bytesBase64, 'base64'), args, 'base64') };
      }
      return { reportId: args.reportId, status: retained.status, integrity: retained.integrity, authenticity: retained.authenticity,
        outcome: outcome(retained.provenance.run, retained.report.evaluations), freshness: { status: retained.freshness.status }, detailsComplete: false };
    }
    fail('unknown-tool', 'Unknown Atlas tool.');
  }
  return Object.freeze({ tools: ATLAS_AGENT_TOOLS,
    async call(name, args = {}, { signal } = {}) {
      if (closed) fail('closed', 'The agent session is closed.');
      requireValue(inputValidators.has(name), 'Unknown Atlas tool.');
      const validate = inputValidators.get(name);
      requireValue(validate(args), `Tool arguments do not match ${name}: ${(validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
      const copied = JSON.parse(JSON.stringify(args));
      if (signal?.aborted) fail('cancelled', 'The request was cancelled before execution.');
      const data = await operation(name, copied, signal), result = { contract: 'atlas.agent-result/1', tool: name, data };
      requireValue(validateOutput(result), 'The tool produced an invalid result envelope.');
      return freeze(bounded(result));
    },
    close() { closed = true; workspace?.close(); },
  });
}
