import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openAtlas, validateFiles, readSource } from '../../../library/src/model.mjs';
import { prepareInitialization, prepareChangeFromDisk, saveDraft, loadDraft, listDrafts, deleteDraft, applyDraft, listTransactions, recoverChange } from '../../../library/src/authoring.mjs';
import { presentAtlas } from './markdown.mjs';
import { prepareExport, applyExport } from './export.mjs';
import { resolveState } from '../../../library/src/state.mjs';

const assets = fileURLToPath(new URL('../public/', import.meta.url));
const assetTypes = new Map([['index.html', 'text/html'], ['app.js', 'text/javascript'], ['style.css', 'text/css']]);
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
      const input = await body(request); exact(input, ['source'], ['source']);
      return readSource({ root }, input.source, { allowedRoots });
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
    if (method === 'GET' && url.pathname === '/api/drafts') return listDrafts(root);
    if (method === 'GET' && url.pathname.startsWith('/api/drafts/')) return loadDraft(root, url.pathname.slice('/api/drafts/'.length));
    if (method === 'GET' && url.pathname === '/api/transactions') return listTransactions(root);
    const input = await body(request);
    if (method === 'POST' && url.pathname === '/api/initialize') {
      exact(input, ['baseline', 'id', 'title'], ['baseline', 'id', 'title']);
      const baseline = observations.get(input.baseline);
      if (!baseline) throw failure('BASELINE_EXPIRED', 'Reload the Atlas before creating it.');
      const plan = prepareInitialization(baseline, { id: input.id, title: input.title });
      return saveDraft(root, { plan });
    }
    if (method === 'POST' && url.pathname === '/api/publication/prepare') {
      exact(input, ['baseline', 'trees', 'points', 'sources'], ['baseline', 'trees']);
      if (!exportDirectory) throw failure('EXPORT_UNAVAILABLE', 'Choose an export directory when launching the Editor.');
      const prepared = await prepareExport(root, exportDirectory, { trees: input.trees, points: input.points, sources: input.sources, allowedRoots });
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
    if (method === 'POST' && ['/api/prepare', '/api/drafts'].includes(url.pathname)) {
      exact(input, ['baseline', 'changes', 'reason', 'id', 'expectedRevision'], ['changes', 'reason']);
      const previous = input.id ? (await loadDraft(root, input.id)).plan : null;
      const baseline = previous ? draftBaseline(previous, root) : observations.get(input.baseline);
      if (!baseline) throw failure('BASELINE_EXPIRED', 'Reload the Atlas before creating this draft.');
      const changeRequest = { changes: input.changes, reason: input.reason, sourcePreconditions: previous?.sourcePreconditions ?? [] };
      const plan = await prepareChangeFromDisk(root, changeRequest, { view: baseline, observedFiles: previous?.observedFiles ?? [] });
      return url.pathname === '/api/prepare' ? plan : saveDraft(root, { id: input.id, plan, expectedRevision: input.expectedRevision });
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
      response.end(await fs.readFile(path.join(assets, file)));
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
