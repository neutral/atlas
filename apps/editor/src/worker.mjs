import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import * as atlas from 'atlas-reference-validator';
import { EditorError, exactPath, fields, requireValue, validateRequest } from './protocol.mjs';
import { openEditorState } from './state.mjs';
import { renderMarkdown } from './markdown.mjs';

let workspace, storage, info, registry, current;
let portal;
const exports = new Map(), previews = new Map();
async function portalApi() { return portal ??= await import('atlas-portal/product'); }
const observations = new Map(), plans = new Map(), runs = new Map();
const bounded = (map, id, value, limit) => { map.set(id, value); while (map.size > limit) map.delete(map.keys().next().value); };

function retained(map, id, kind) {
  requireValue(typeof id === 'string' && map.has(id), `The ${kind} is unavailable or expired. Open a current observation to continue.`, 'atlas.editor.expired');
  return map.get(id);
}
const view = id => retained(observations, id, 'observation').view;
const contains = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

function stateScope(opened) {
  if (!workspace) {
    if (!fs.existsSync(info.atlasRoot)) return { writable: true, diagnostics: [] };
    workspace = atlas.openWorkspace({ repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath });
  }
  opened ??= workspace.read().view;
  info = workspace.info;
  const directory = path.resolve(workerData.stateDirectory);
  const diagnostics = [];
  if (api('localSourceTargets')(opened).some(target => contains(directory, target) || contains(target, directory))) diagnostics.push({
    code: 'atlas.editor.state-source-conflict', message: 'Editor state storage intersects an authored local source target. Select a separate state directory.' });
  if (opened.status === 'incomplete' || opened.freshness().status !== 'fresh') diagnostics.push({
    code: 'atlas.editor.state-source-unavailable', message: 'A complete current source observation is required before writing Editor state.' });
  return { writable: diagnostics.length === 0, diagnostics };
}
function requireStateScope() {
  const scope = stateScope();
  if (!scope.writable) throw new EditorError(scope.diagnostics[0].code, scope.diagnostics[0].message);
}
const descriptor = value => ({ contract: value.contract, atlasRoot: value.atlasRoot, status: value.status,
  identity: value.identity, validation: value.validation.toJSON(), limits: value.limits });

function take(operation = 'read') {
  if (!workspace) {
    if (!fs.existsSync(info.atlasRoot)) return { viewId: null, view: { status: 'missing' }, workspace: info, observations: [], canInitialize: true,
      stateStorage: stateScope() };
    workspace = atlas.openWorkspace({ repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath });
  }
  const result = workspace[operation]();
  info = workspace.info;
  if (!current || result.view.identity.digest === null || observations.get(current)?.view.identity.digest !== result.view.identity.digest) {
    current = randomUUID();
    bounded(observations, current, { view: result.view, observedAt: new Date().toISOString() }, 8);
  }
  return { viewId: current, view: descriptor(result.view), workspace: info,
    stateStorage: stateScope(result.view),
    freshness: result.freshness,
    canInitialize: !result.view.identity.inputs.some(input => input.path === 'atlas.md' && input.kind === 'file'),
    observations: [...observations].map(([viewId, entry]) => ({ viewId, identity: entry.view.identity, observedAt: entry.observedAt })) };
}

async function initialize() {
  requireValue(typeof workerData.repositoryRoot === 'string' && path.isAbsolute(workerData.repositoryRoot), 'repositoryRoot must be absolute.');
  const repositoryRoot = fs.realpathSync(workerData.repositoryRoot);
  requireValue(fs.statSync(repositoryRoot).isDirectory(), 'repositoryRoot must identify a directory.');
  const options = { repositoryRoot, ...(workerData.atlasPath === undefined ? {} : { atlasPath: workerData.atlasPath }) };
  if (workerData.atlasPath !== undefined && !fs.existsSync(path.resolve(repositoryRoot, workerData.atlasPath))) {
    requireValue(exactPath(workerData.atlasPath), 'A new Atlas requires an exact repository-relative path.');
    info = { ...options, atlasRoot: path.resolve(repositoryRoot, workerData.atlasPath) };
  } else {
    workspace = atlas.openWorkspace(options);
    info = workspace.info;
    // Resolve durable launch configuration once; later configuration reads cannot retarget this Editor.
    workspace.close();
    workspace = atlas.openWorkspace({ ...options, atlasPath: info.atlasPath });
  }
  requireValue(typeof workerData.stateDirectory === 'string' && path.isAbsolute(workerData.stateDirectory), 'An absolute durable stateDirectory is required.');
  const scope = stateScope();
  const conflict = scope.diagnostics.find(item => item.code === 'atlas.editor.state-source-conflict');
  if (conflict) throw new EditorError(conflict.code, conflict.message);
  storage = openEditorState({ ...info, stateDirectory: workerData.stateDirectory }, { create: scope.writable });
  let registrations = [];
  if (workerData.evaluatorModule !== undefined) {
    requireValue(typeof workerData.evaluatorModule === 'string' && path.isAbsolute(workerData.evaluatorModule), 'evaluatorModule must be an absolute host-selected module path.');
    const module = await import(pathToFileURL(workerData.evaluatorModule).href);
    registrations = module.registrations;
    requireValue(Array.isArray(registrations), 'The selected evaluator module must export registrations.');
  }
  registry = api('createEvaluatorRegistry')(registrations);
  return { ...info, stateDirectory: storage.stateDirectory, stateStorage: scope };
}

function api(name) {
  requireValue(typeof atlas[name] === 'function', `The installed Atlas Library does not provide ${name}.`, 'atlas.editor.unsupported-library');
  return atlas[name];
}

async function read(params) {
  const opened = view(params.viewId), model = opened.validation.normalized;
  const kinds = ['atlas', 'map', 'area', 'point', 'resource', 'document', 'source', 'check'];
  requireValue(kinds.includes(params.kind), 'Unsupported read kind.');
  const allowed = { atlas: [], map: ['id'], area: ['mapId', 'id'], point: ['id'], resource: ['id'], document: ['path'], source: ['target', 'ownerPath'], check: ['id'] };
  fields(params, ['viewId', 'kind', ...allowed[params.kind]], ['viewId', 'kind', ...allowed[params.kind].filter(key => key !== 'ownerPath')]);
  if (params.kind === 'point') {
    const result = opened.inspectPoint(params.id);
    return { ...result, kind: 'point', html: result.status === 'found' ? Object.fromEntries(result.point.records.map(record => [record.path, renderMarkdown(record.body, record.path, result.point.title)])) : {} };
  }
  if (params.kind === 'resource') return { ...opened.inspectResource(params.id), kind: 'resource' };
  if (params.kind === 'document') return { ...opened.readDocument(params.path), kind: 'document' };
  if (params.kind === 'source') {
    const result = await opened.readSource(params.target, { ownerPath: params.ownerPath, allowedRoots: [info.repositoryRoot], maxBytes: 1024 * 1024 });
    let ownerPath = result.ownerPath;
    if (result.observation?.kind === 'local-file') {
      const relative = path.relative(opened.atlasRoot, result.observation.path).split(path.sep).join('/');
      ownerPath = opened.identity.inputs.some(input => input.path === relative && input.kind === 'file') ? relative : null;
    }
    return { ...result, kind: 'source', limits: [...result.limits, ...(ownerPath === null ? ['Relative links in a source outside the captured Atlas are unavailable. The original source path remains in its citation.'] : [])],
      html: result.text === undefined ? null : renderMarkdown(result.text, ownerPath, result.resource?.title) };
  }
  if (!model) return { status: opened.status, kind: params.kind, validation: opened.validation.toJSON() };
  let record, sourcePath;
  if (params.kind === 'atlas') { record = model.atlas; sourcePath = 'atlas.md'; }
  if (params.kind === 'map') { record = model.maps.find(item => item.id === params.id); sourcePath = record?.path; }
  if (params.kind === 'area') {
    const map = model.maps.find(item => item.id === params.mapId);
    record = map?.areas.find(item => item.id === params.id); sourcePath = map?.path;
  }
  if (params.kind === 'check') { record = model.checks.find(item => item.id === params.id); sourcePath = record?.path; }
  return record ? { status: 'found', kind: params.kind, record, path: sourcePath, html: renderMarkdown(record.body, sourcePath, record.title) }
    : { status: 'not-found', kind: params.kind, id: params.id };
}

async function operation(method, params) {
  if (method === 'initialize') return initialize();
  validateRequest(method, params);
  if (['draft-save', 'draft-discard', 'apply', 'retain'].includes(method)) requireStateScope();
  if (method === 'agent-config') {
    requireValue(workerData.agentConfiguration && typeof workerData.agentConfiguration === 'object', 'Agent connection is available when launched through atlas open.');
    return { configuration: workerData.agentConfiguration, repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath,
      notice: 'This configuration fixes one project and Atlas. The stdio adapter reserves stdout for protocol traffic. Tools retain their read, prepare, explicit apply, and trusted evaluation boundaries. Review host permissions before connecting. This action does not edit host settings.' };
  }
  if (method.startsWith('export-')) {
    requireValue(typeof workerData.exportDirectory === 'string' && path.isAbsolute(workerData.exportDirectory), 'Export site requires an absolute host-selected destination. Launch atlas open --export-dir <absolute-path>.');
    const api = await portalApi();
    if (method === 'export-options') return { ...api.publicationOptions(info), outputDirectory: workerData.exportDirectory };
    if (method === 'export-prepare') {
      requireValue(typeof params.profileId === 'string' && params.profileId.length > 0, 'Select one publication profile.');
      requireValue(params.name === undefined || typeof params.name === 'string', 'Site name must be text.');
      const prepared = await api.prepareExport({ ...info, profileId: params.profileId, name: params.name, outputDirectory: workerData.exportDirectory, resourceRoots: [info.repositoryRoot] });
      bounded(exports, prepared.summary.exportId, prepared, 8);
      return prepared.summary;
    }
    const prepared = retained(exports, params.exportId, 'export preview');
    if (method === 'export-apply') {
      requireValue(!prepared.applied, 'This site was already exported. Its destination is retained.');
      const result = await api.applyExport(prepared); prepared.applied = true; return result;
    }
    requireValue(prepared.applied, 'Explicitly export the reviewed selection before opening its preview.');
    if (!previews.has(params.exportId)) previews.set(params.exportId, await api.startPreview(prepared.summary.outputDirectory, { bindAddress: workerData.bindAddress, port: workerData.previewPort, publicOrigin: workerData.previewOrigin }));
    return { url: previews.get(params.exportId).url, outputDirectory: prepared.summary.outputDirectory };
  }
  if (method === 'state') return take();
  if (method === 'refresh') return take('refresh');
  if (method === 'read') return read(params);
  if (method === 'find') return view(params.viewId).find(params.query, params.options);
  if (method === 'freshness') return view(params.viewId).freshness();
  if (method === 'compare') return view(params.beforeViewId).compare(view(params.afterViewId));
  if (method === 'draft-list') return storage.drafts();
  if (method === 'draft-save') return storage.saveDraft(params);
  if (method === 'draft-discard') return storage.discardDraft(params);
  if (method === 'prepare') {
    requireValue(params.baseViewId === undefined || params.expected === undefined, 'Supply a base observation or explicit recovered baseline, not both.');
    const expected = params.baseViewId !== undefined ? { viewDigest: view(params.baseViewId).identity.digest } : params.expected;
    const configuration = info.configuration;
    const plan = api('prepareAtlasChange')({ repositoryRoot: info.repositoryRoot, atlasPath: info.atlasPath,
      ...(configuration === undefined ? {} : { configuration }), expected, operations: params.operations });
    const planId = randomUUID();
    bounded(plans, planId, plan, 16);
    return { planId, plan };
  }
  if (method === 'apply') {
    const plan = retained(plans, params.planId, 'prepared plan');
    storage.assertStorage();
    const result = api('applyAtlasChange')(plan, { recoveryDirectory: storage.recovery, ...(params.mode === undefined ? {} : { mode: params.mode }) });
    // Any retry must be an explicit new preparation, including partial or uncertain effects.
    plans.delete(params.planId);
    try { return { result, state: take('refresh') }; }
    catch (error) { return { result, state: null, refreshError: { code: error.code ?? 'atlas.editor.refresh-failed', message: error.message } }; }
  }
  if (method === 'checks') return api('discoverChecks')(view(params.viewId), { ...params.filters, registry });
  if (method === 'evaluate') {
    requireValue((params.viewId === undefined) !== (params.planId === undefined), 'Select exactly one observation or plan for evaluation.');
    const options = { registry, actor: params.actor, ...(params.checkIds === undefined ? {} : { checkIds: params.checkIds }) };
    let run, planDigest;
    if (params.planId !== undefined) {
      const evaluated = await api('evaluatePreparedChange')(retained(plans, params.planId, 'prepared plan'), options);
      run = evaluated.run; planDigest = evaluated.planDigest;
    } else run = await api('evaluateChecks')(view(params.viewId), options);
    const runId = randomUUID();
    bounded(runs, runId, { run, planDigest }, 32);
    return { runId, run, ...(planDigest === undefined ? {} : { planDigest }) };
  }
  if (method === 'retain') {
    const { run } = retained(runs, params.runId, 'evaluation run');
    const { reportId, parent } = storage.newReportDirectory();
    const retainedReport = api('retainCheckReport')(run, { directory: path.join(parent, reportId), repositoryRoot: info.repositoryRoot });
    return { reportId, retained: retainedReport };
  }
  if (method === 'report-list') return { reportIds: storage.reportsList() };
  if (method === 'report-read') return api('readCheckReport')(storage.reportDirectory(params.reportId), current ? { view: view(current) } : {});
  throw new EditorError('atlas.editor.unknown-method', 'Unknown Editor operation.');
}

let queue = Promise.resolve();
parentPort.on('message', ({ id, method, params }) => {
  queue = queue.then(async () => {
    parentPort.postMessage({ id, status: 'running' });
    try { parentPort.postMessage({ id, value: await operation(method, params) }); }
    catch (error) { parentPort.postMessage({ id, error: { code: error.code ?? 'atlas.editor.operation-failed', message: error.message,
      status: error.status ?? 400, ...(error.details === undefined ? {} : { details: error.details }) } }); }
  });
});
