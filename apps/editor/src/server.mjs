import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { EditorError, fields, requireValue, requests, validateRequest } from './protocol.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
  ['/editor.css', ['editor.css', 'text/css; charset=utf-8']],
]);
const MAX_BODY = 2 * 1024 * 1024;
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
};

function json(response, status, value) {
  if (response.destroyed) return;
  if (response.headersSent) {
    response.end(`${JSON.stringify(value)}\n`);
    return;
  }
  response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, oversized = Number(request.headers['content-length'] ?? 0) > MAX_BODY;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', failed); request.off('aborted', aborted); };
    const failed = error => { cleanup(); reject(error); };
    const aborted = () => failed(new EditorError('atlas.editor.interrupted-request', 'The request was interrupted.'));
    const data = chunk => {
      size += chunk.length;
      if (oversized || size > MAX_BODY) {
        oversized = true;
        chunks.length = 0;
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      // Finish draining within the HTTP request timeout before ending a 413 response.
      // Ending it during a large client write can reset the socket before the error arrives.
      if (oversized) {
        reject(new EditorError('atlas.editor.request-too-large', 'JSON requests are limited to 2 MiB.', 413));
        return;
      }
      try { resolve(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new EditorError('atlas.editor.invalid-json', 'Expected a UTF-8 JSON object.')); }
    };
    request.on('data', data); request.once('end', end); request.once('error', failed); request.once('aborted', aborted);
  });
}

function storageIdentity(directory, name) {
  requireValue(typeof directory === 'string' && path.isAbsolute(directory), `${name} must be absolute.`);
  const resolved = path.resolve(directory);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  requireValue(fs.statSync(ancestor).isDirectory(), `${name} must use directory ancestors.`);
  return path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
}
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Start one Editor over host-selected roots and explicit networking. The launch URL is a local capability. */
export async function startEditor(options) {
  fields(options, ['repositoryRoot', 'atlasPath', 'stateDirectory', 'evaluatorModule', 'port', 'exportDirectory', 'agentConfiguration', 'bindAddress', 'publicOrigin', 'previewPort', 'previewOrigin'], ['repositoryRoot', 'stateDirectory']);
  if (options.exportDirectory !== undefined) {
    const state = storageIdentity(options.stateDirectory, 'stateDirectory');
    const output = storageIdentity(options.exportDirectory, 'exportDirectory');
    requireValue(!contains(state, output) && !contains(output, state), 'Export output and durable Editor state must use separate locations.');
  }
  requireValue(options.port === undefined || (Number.isInteger(options.port) && options.port >= 0 && options.port <= 65535), 'port must be between 0 and 65535.');
  const bindAddress = options.bindAddress ?? '127.0.0.1';
  requireValue(typeof bindAddress === 'string' && isIP(bindAddress) === 4, 'bindAddress must be an explicit IPv4 address.');
  requireValue(bindAddress === '127.0.0.1' || options.publicOrigin !== undefined, 'A nonloopback bindAddress requires an explicit publicOrigin.');
  let configuredOrigin;
  if (options.publicOrigin !== undefined) {
    try { configuredOrigin = new URL(options.publicOrigin); } catch { requireValue(false, 'publicOrigin must be an exact HTTP or HTTPS origin.'); }
    requireValue(['http:', 'https:'].includes(configuredOrigin.protocol) && configuredOrigin.origin === options.publicOrigin, 'publicOrigin must be an exact HTTP or HTTPS origin without credentials, path, query, or fragment.');
  }
  requireValue(options.previewPort === undefined || Number.isInteger(options.previewPort) && options.previewPort >= 0 && options.previewPort <= 65535, 'previewPort must be between 0 and 65535.');
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(token);
  const pending = new Map();
  let nextId = 0, workerFailure = null, origin = null, stopped = false;
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: options });
  function failWorker(error) {
    workerFailure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  worker.on('error', failWorker);
  worker.on('exit', code => failWorker(new EditorError('atlas.editor.worker-stopped', `The local worker stopped (${code}). Restart the service to continue.`, 503)));
  worker.on('message', message => {
    const request = pending.get(message.id);
    if (!request) return;
    if (message.status === 'running') { request.progress?.('running'); return; }
    pending.delete(message.id);
    if (message.error) request.reject(Object.assign(new EditorError(message.error.code, message.error.message, message.error.status), { details: message.error.details }));
    else request.resolve(message.value);
  });
  function call(method, params = {}, progress) {
    if (workerFailure) return Promise.reject(workerFailure);
    if (pending.size >= 32) return Promise.reject(new EditorError('atlas.editor.busy', 'The local service queue is full. Retry after the pending operation.', 503));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, progress });
      progress?.('queued');
      worker.postMessage({ id, method, params });
    });
  }
  let info;
  try { info = await call('initialize'); }
  catch (error) { await worker.terminate(); throw error; }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host || !request.url?.startsWith('/') || request.url.startsWith('//')) {
        throw new EditorError('atlas.editor.foreign-host', 'The request Host must match this local Editor.', 403);
      }
      const assetPath = request.url.startsWith('/?') ? '/' : request.url;
      if (request.method === 'GET' && assets.has(assetPath)) {
        const [name, type] = assets.get(assetPath);
        const bytes = fs.readFileSync(new URL(`../public/${name}`, import.meta.url));
        response.writeHead(200, { ...headers, 'Content-Type': type });
        response.end(bytes);
        return;
      }
      const method = request.url?.startsWith('/api/') ? request.url.slice(5) : '';
      if (request.method !== 'POST' || !Object.hasOwn(requests, method)) {
        throw new EditorError('atlas.editor.unknown-route', 'Unknown Editor route or method.', 404);
      }
      const supplied = request.headers['x-atlas-token'];
      if (request.headers.origin !== origin || typeof supplied !== 'string'
        || Buffer.byteLength(supplied) !== tokenBytes.length || !timingSafeEqual(Buffer.from(supplied), tokenBytes)) {
        throw new EditorError('atlas.editor.unauthorized', 'Open the launch URL for this Editor session.', 403);
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '')) {
        throw new EditorError('atlas.editor.content-type', 'Use application/json.', 415);
      }
      const params = await body(request);
      validateRequest(method, params);
      const progress = request.headers.accept === 'application/x-ndjson' ? status => {
        if (response.destroyed) return;
        if (!response.headersSent) response.writeHead(200, { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        response.write(`${JSON.stringify({ status })}\n`);
      } : undefined;
      json(response, 200, { ok: true, result: await call(method, params, progress) });
    } catch (error) {
      request.resume();
      json(response, error.status ?? 400, { ok: false, error: {
        code: error.code ?? 'atlas.editor.operation-failed', message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 64;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, bindAddress, resolve);
    });
  } catch (error) { await worker.terminate(); throw error; }
  origin = configuredOrigin?.origin ?? `http://${bindAddress}:${server.address().port}`;
  return Object.freeze({ origin, url: `${origin}/#token=${token}`, info,
    async close() {
      if (stopped) return;
      stopped = true;
      const closing = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await worker.terminate();
      await closing;
    },
  });
}
