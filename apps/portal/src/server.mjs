import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openAtlas, validateFiles, readSource } from '../../../library/src/model.mjs';
import { prepareInitialization, inspectChange, prepareChangeFromDisk, saveDraft, loadDraft, listDrafts, deleteDraft, applyDraft, listTransactions, recoverChange } from '../../../library/src/authoring.mjs';
import { presentAtlas, renderMarkdown } from './markdown.mjs';
import { searchAtlas } from '../../../library/src/model.mjs';
import { referenceIndex, directCiters, sourceCitations, reviewSources, prepareMove } from '../../../library/src/references.mjs';
import { reviewChange } from '../../../library/src/absorb.mjs';
import { evaluateChecks } from '../../../library/src/checks.mjs';
import { prepareExport, applyExport } from './export.mjs';
import * as privateAuthoring from '../../../library/src/authoring.mjs';
import { listStyles, getStyle } from '../../../library/src/styles.mjs';
import { prepareFormChange } from './authoring-forms.mjs';
import { resolveState } from '../../../library/src/state.mjs';

const assets = fileURLToPath(new URL('../public/', import.meta.url));
const assetTypes = new Map([['index.html', 'text/html'], ['app.js', 'text/javascript'], ['search.js', 'text/javascript'], ['style.css', 'text/css']]);
const failure = (code, message) => Object.assign(new Error(message), { code });
function exact(value, fields, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw failure('INVALID_REQUEST', 'Unexpected or missing request fields.');
}
async function body(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw failure('INVALID_REQUEST', 'JSON content is required.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw failure('LIMIT_EXCEEDED', 'Request exceeds 8 MiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure('INVALID_REQUEST', 'Malformed JSON request.'); }
}
function equalToken(actual, expected) {
  const value = Buffer.from(actual ?? '');
  const wanted = Buffer.from(`Bearer ${expected}`);
  return value.length === wanted.length && timingSafeEqual(value, wanted);
}
function draftBaseline(plan, root) {
  const files = new Map(plan.candidate.files.map(file => [file.path, file.rawBase64 === undefined ? file.content : { rawBase64: file.rawBase64 }]));
  for (const change of plan.changes) {
    if (change.beforeBase64 !== undefined) files.set(change.path, { rawBase64: change.beforeBase64 });
    else if (change.before === null) files.delete(change.path); else files.set(change.path, change.before);
  }
  const observed = new Set((plan.observedFiles ?? []).map(file => file.path));
  const original = validateFiles([...files].filter(([file]) => !observed.has(file)).reduce((map, [file, content]) => map.set(file, content), new Map()), { root });
  if (original.identity !== plan.baseline.identity) throw failure('INVALID_DRAFT', 'Draft baseline cannot be reconstructed.');
  return original;
}

/** Fixed-root, authenticated loopback service for the Portal and Editor. */
export async function startPortal(root, { port = 0, editable = false, allowedRoots, exportDirectory, agentConfiguration } = {}) {
  root = await fs.realpath(path.resolve(root));
  if (!(await fs.stat(root)).isDirectory()) throw failure('INVALID_ROOT', 'Atlas root must be a directory.');
  if (!Number.isInteger(port) || port < 0 || port > 65535 || typeof editable !== 'boolean') throw failure('INVALID_REQUEST', 'Invalid service options.');
  if (allowedRoots !== undefined && (!Array.isArray(allowedRoots) || allowedRoots.some(item => typeof item !== 'string' || !path.isAbsolute(item)))) throw failure('INVALID_REQUEST', 'Source grants must be absolute directories.');
  allowedRoots = Object.freeze([...new Set([root, ...(allowedRoots ?? [])])]);
  if (exportDirectory !== undefined && (typeof exportDirectory !== 'string' || !path.isAbsolute(exportDirectory))) throw failure('INVALID_REQUEST', 'Export directory must be an absolute launch-time path.');
  const connection = structuredClone(agentConfiguration ?? { mcpServers: { atlas: { command: process.execPath, args: [fileURLToPath(new URL('../../agent/src/server.mjs', import.meta.url)), '--root', root, ...(allowedRoots ?? []).filter(item => item !== root).flatMap(item => ['--allow-source-root', item])], ...(process.env.ATLAS_STATE_HOME ? { env: { ATLAS_STATE_HOME: process.env.ATLAS_STATE_HOME } } : {}) } } });
  const token = randomBytes(32).toString('hex');
  const observations = new Map();
  const publications = new Map();
  let origin;
  let mutation = Promise.resolve();
  async function capture() {
    const view = await openAtlas(root);
    observations.set(view.identity, view);
    if (observations.size > 8) observations.delete(observations.keys().next().value);
    return view;
  }
  const reviewedDraft = draft => {
    const candidate = inspectChange(draft.plan).after;
    return { ...draft, plan: { ...draft.plan, candidate, validation: { ...draft.plan.validation, status: candidate.status, diagnostics: candidate.diagnostics } }, impact: reviewChange(draft.plan) };
  };
  async function operate(request, url) {
    const method = request.method;
    if (method === 'GET' && url.pathname === '/api/view') {
      const view = await capture();
      let canInitialize = false;
      try { await fs.lstat(path.join(root, 'atlas.json')); } catch (error) { if (error.code === 'ENOENT') canInitialize = true; }
      let stateIssue = null;
      if (editable) { try { await resolveState(root); } catch (error) { stateIssue = { code: error.code, message: error.message }; } }
      return { ...presentAtlas(view, { editable }), canInitialize: editable && canInitialize, canExport: editable && Boolean(exportDirectory), stateIssue };
    }
    if (method === 'POST' && url.pathname === '/api/source') {
      const input = await body(request); exact(input, ['source', 'draft'], ['source']);
      let sourceView = { root };
      if (input.draft) {
        if (!editable) throw failure('READ_ONLY', 'Candidate reading requires the Editor.');
        exact(input.draft, ['id', 'revision'], ['id', 'revision']);
        const draft = await loadDraft(root, input.draft.id);
        if (draft.revision !== input.draft.revision) throw failure('STALE_DRAFT', 'Reopen the current candidate.');
        sourceView = inspectChange(draft.plan).after;
        const declared = [...(sourceView.atlas?.points ?? []), ...(sourceView.atlas?.facets ?? [])].some(record => record.sources?.some(source => JSON.stringify(source) === JSON.stringify(input.source)));
        if (!declared) throw failure('INVALID_REQUEST', 'The source is not declared in this candidate.');
      }
      const result = await readSource(sourceView, input.source, { allowedRoots });
      return { ...result, ...(result.status === 'ready' && /\.md(?:#|$)/i.test(input.source.uri) ? { html: renderMarkdown(result.content, { headingPrefix: 'source-' }) } : {}) };
    }
    if (method === 'POST' && url.pathname === '/api/search') {
      const input = await body(request); exact(input, ['query', 'tree', 'type', 'limit', 'offset', 'kinds', 'presentation'], ['query']);
      const view = await capture();
      return { status: view.status, identity: view.identity, results: searchAtlas(view, { ...input, presentation: input.presentation ?? 'summary' }) };
    }
    if (method === 'POST' && url.pathname === '/api/references') {
      const input = await body(request); exact(input, ['point', 'facet', 'tree', 'uri', 'limit']);
      const view = await capture();
      return input.uri !== undefined ? sourceCitations(view, input) : input.point || input.facet ? directCiters(view, input, { limit: input.limit }) : referenceIndex(view, input);
    }
    if (method === 'POST' && url.pathname === '/api/sources/review') {
      const input = await body(request); exact(input, ['uris', 'previous', 'limit', 'maxBytes', 'draft']);
      const { draft: target, ...options } = input;
      let view;
      if (target !== undefined) {
        if (!editable) throw failure('READ_ONLY', 'Candidate source review requires the Editor.');
        exact(target, ['id', 'revision'], ['id', 'revision']);
        const draft = await loadDraft(root, target.id);
        if (draft.revision !== target.revision) throw failure('STALE_DRAFT', 'Reopen the current draft before reviewing its sources.');
        view = inspectChange(draft.plan).after;
      } else view = await capture();
      const history = editable ? await privateAuthoring.getSourceReviewHistory(root) : null;
      const previous = options.previous ?? history?.observations.filter(item => item.sha256).map(({ uri, sha256 }) => ({ uri, sha256 }));
      const review = await reviewSources(view, { ...options, ...(previous ? { previous } : {}), allowedRoots });
      if (editable && !target) await privateAuthoring.recordSourceReview(root, { review, expectedRevision: history.revision });
      return review;
    }
    if (method === 'GET' && url.pathname === '/api/styles') {
      const view = await capture();
      return { current: view.atlas?.style ? { ...view.atlas.style, html: renderMarkdown(view.atlas.style.body) } : null, styles: listStyles().map(item => { const style = getStyle(item.id); return { ...style, html: renderMarkdown(style.body) }; }) };
    }
    if (!editable) throw failure('READ_ONLY', 'This Portal is read-only.');
    if (method === 'GET' && url.pathname === '/api/state') {
      const saved = await resolveState(root);
      return { status: 'ready', directory: saved.directory };
    }
    if (method === 'GET' && url.pathname === '/api/connection') return connection;
    if (method === 'GET' && url.pathname === '/api/publication') {
      if (!exportDirectory) throw failure('EXPORT_UNAVAILABLE', 'Choose an export directory when launching the Editor.');
      const view = await capture();
      if (!view.atlas) throw failure('INVALID_PUBLICATION', 'Repair or create this Atlas before exporting.');
      return { identity: view.identity, output: exportDirectory, atlas: view.atlas };
    }
    if (method === 'GET' && url.pathname === '/api/files') {
      const view = await capture();
      return { identity: view.identity, files: view.files, diagnostics: view.diagnostics };
    }
    if (method === 'GET' && url.pathname === '/api/working-copies') return privateAuthoring.listWorkingCopies(root);
    if (method === 'GET' && url.pathname.startsWith('/api/working-copies/')) {
      const copy = await privateAuthoring.loadWorkingCopy(root, url.pathname.slice('/api/working-copies/'.length));
      const files = copy.form.context?.captured?.files;
      if (files) { const original = validateFiles(new Map(files.map(file => [file.path, file.rawBase64 === undefined ? file.content : { rawBase64: file.rawBase64 }])), { root }); if (original.identity === copy.baseline) observations.set(copy.baseline, original); }
      return copy;
    }
    if (method === 'GET' && url.pathname === '/api/sources/history') return privateAuthoring.getSourceReviewHistory(root);
    if (method === 'GET' && /^\/api\/drafts\/[^/]+\/preview$/.test(url.pathname)) {
      const draft = await loadDraft(root, url.pathname.split('/')[3]);
      const views = inspectChange(draft.plan);
      return { id: draft.id, revision: draft.revision, reason: draft.plan.reason, before: presentAtlas(views.before), after: presentAtlas(views.after) };
    }
    if (method === 'GET' && url.pathname === '/api/drafts') return listDrafts(root);
    if (method === 'GET' && url.pathname.startsWith('/api/drafts/')) return reviewedDraft(await loadDraft(root, url.pathname.slice('/api/drafts/'.length)));
    if (method === 'GET' && url.pathname === '/api/transactions') return listTransactions(root);
    const input = await body(request);
    if (method === 'POST' && url.pathname === '/api/working-copies') {
      exact(input, ['id', 'expectedRevision', 'baseline', 'form'], ['baseline', 'form']);
      return privateAuthoring.saveWorkingCopy(root, input);
    }
    if (method === 'DELETE' && url.pathname === '/api/working-copies') {
      exact(input, ['id', 'expectedRevision'], ['id', 'expectedRevision']);
      return privateAuthoring.discardWorkingCopy(root, input);
    }
    if (method === 'POST' && url.pathname === '/api/sources/decisions') {
      exact(input, ['decisions', 'expectedRevision'], ['decisions', 'expectedRevision']);
      return privateAuthoring.recordSourceReview(root, input);
    }
    if (method === 'POST' && url.pathname === '/api/structure') {
      exact(input, ['baseline', 'operation', 'tree', 'id', 'kind', 'reason', 'title', 'create', 'parent', 'before', 'destination', 'destinationBody', 'members', 'cleanupEmptyBranches'], ['baseline', 'operation', 'tree', 'id', 'reason']);
      const view = observations.get(input.baseline);
      if (!view) throw failure('BASELINE_EXPIRED', 'Reload before preparing this change.');
      return reviewedDraft(await saveDraft(root, prepareFormChange(view, input)));
    }
    if (method === 'POST' && url.pathname === '/api/style') {
      exact(input, ['baseline', 'styleId', 'styleContent', 'reason'], ['baseline', 'reason']);
      const view = observations.get(input.baseline);
      if (!view) throw failure('BASELINE_EXPIRED', 'Reload before preparing this change.');
      const { baseline, ...request } = input;
      return reviewedDraft(await saveDraft(root, { plan: privateAuthoring.prepareStyleChange(view, request) }));
    }
    if (method === 'POST' && url.pathname === '/api/initialize') {
      exact(input, ['baseline', 'id', 'title', 'styleId', 'styleContent'], ['baseline', 'id', 'title']);
      const baseline = observations.get(input.baseline);
      if (!baseline) throw failure('BASELINE_EXPIRED', 'Reload the Atlas before creating it.');
      const { baseline: _, ...request } = input;
      const plan = prepareInitialization(baseline, request);
      return saveDraft(root, { plan });
    }
    if (method === 'POST' && url.pathname === '/api/publication/prepare') {
      exact(input, ['baseline', 'trees', 'points', 'sources', 'includeStyle'], ['baseline', 'trees']);
      if (!exportDirectory) throw failure('EXPORT_UNAVAILABLE', 'Choose an export directory when launching the Editor.');
      const prepared = await prepareExport(root, exportDirectory, { trees: input.trees, points: input.points, sources: input.sources, includeStyle: input.includeStyle, allowedRoots });
      if (prepared.identity !== input.baseline) throw failure('EXPORT_STALE', 'Atlas source changed. Reopen Export site and review its current selection.');
      const id = randomUUID();
      if (publications.size >= 8) publications.delete(publications.keys().next().value);
      publications.set(id, prepared);
      return { id, ...prepared };
    }
    if (method === 'POST' && url.pathname === '/api/publication/apply') {
      exact(input, ['id'], ['id']);
      const prepared = publications.get(input.id);
      if (!prepared) throw failure('EXPORT_EXPIRED', 'Preview this publication again before exporting.');
      publications.delete(input.id);
      return applyExport(prepared);
    }
    if (method === 'POST' && url.pathname === '/api/move') {
      exact(input, ['baseline', 'point', 'facet', 'tree', 'path', 'reason'], ['baseline', 'path', 'reason']);
      const view = observations.get(input.baseline);
      if (!view) throw failure('BASELINE_EXPIRED', 'Reload the Atlas before moving a record.');
      const { baseline, ...move } = input;
      return reviewedDraft(await saveDraft(root, { plan: prepareMove(view, move) }));
    }
    if (method === 'POST' && url.pathname === '/api/draft-checks') {
      exact(input, ['id', 'expectedRevision', 'actor', 'checkIds', 'manual'], ['id', 'expectedRevision', 'actor']);
      const draft = await loadDraft(root, input.id);
      if (draft.revision !== input.expectedRevision) throw failure('STALE_DRAFT', 'The draft changed; reopen it before recording this review.');
      const run = await evaluateChecks(inspectChange(draft.plan).after, { actor: input.actor, checkIds: input.checkIds, manual: input.manual });
      if (run.status !== 'complete') throw failure('INVALID_DRAFT', 'Repair the candidate before recording Check results.');
      return reviewedDraft(await saveDraft(root, { id: draft.id, expectedRevision: draft.revision, plan: draft.plan, review: draft.review, checkRuns: [...(draft.checkRuns ?? []).slice(-9), run] }));
    }
    if (method === 'POST' && ['/api/prepare', '/api/drafts'].includes(url.pathname)) {
      exact(input, ['baseline', 'changes', 'reason', 'id', 'expectedRevision', 'sourcePreconditions', 'styleChange'], ['changes', 'reason']);
      const previous = input.id ? (await loadDraft(root, input.id)).plan : null;
      const baseline = previous ? draftBaseline(previous, root) : observations.get(input.baseline);
      if (!baseline) throw failure('BASELINE_EXPIRED', 'Reload the Atlas before creating this draft.');
      const changeRequest = { changes: input.changes, reason: input.reason, ...(input.styleChange ? { styleChange: true } : {}), sourcePreconditions: input.sourcePreconditions ?? previous?.sourcePreconditions ?? [] };
      const plan = await prepareChangeFromDisk(root, changeRequest, { view: baseline, observedFiles: previous?.observedFiles ?? [] });
      return url.pathname === '/api/prepare' ? plan : reviewedDraft(await saveDraft(root, { id: input.id, plan, expectedRevision: input.expectedRevision }));
    }
    if (method === 'POST' && url.pathname === '/api/apply') {
      exact(input, ['id', 'expectedRevision'], ['id', 'expectedRevision']);
      return applyDraft(root, input.id, { expectedRevision: input.expectedRevision, allowedRoots });
    }
    if (method === 'POST' && url.pathname === '/api/recover') { exact(input, ['id'], ['id']); return recoverChange(root, input.id); }
    if (method === 'DELETE' && url.pathname === '/api/drafts') {
      exact(input, ['id', 'expectedRevision'], ['id', 'expectedRevision']);
      return deleteDraft(root, input.id, { expectedRevision: input.expectedRevision });
    }
    throw failure('NOT_FOUND', 'Unknown operation.');
  }
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin) throw failure('FORBIDDEN', 'Unexpected request origin.');
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (!equalToken(request.headers.authorization, token)) throw failure('UNAUTHORIZED', 'Open the service URL supplied at launch.');
        const run = () => operate(request, url);
        const result = request.method === 'GET' || url.pathname === '/api/source' ? await run() : await (mutation = mutation.catch(() => {}).then(run));
        send(200, result);
        return;
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (request.method !== 'GET' || !assetTypes.has(file)) throw failure('NOT_FOUND', 'Not found.');
      response.writeHead(200, { 'Content-Type': `${assetTypes.get(file)}; charset=utf-8` });
      response.end(await fs.readFile(file === 'search.js' ? new URL('../../../library/src/search.mjs', import.meta.url) : path.join(assets, file)));
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = ['UNAUTHORIZED', 'FORBIDDEN', 'READ_ONLY'].includes(error.code) ? 403 : error.code === 'NOT_FOUND' ? 404 : ['STALE', 'STALE_DRAFT', 'LOCKED', 'RECOVERY_CONFLICT'].includes(error.code) ? 409 : 400;
      send(status, { error: { code: error.code ?? 'REQUEST_FAILED', message: error.message } });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, token, url: `${origin}/#token=${token}`, close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
