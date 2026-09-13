import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Console } from 'node:console';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ATLAS_AGENT_TOOLS, MAX_AGENT_FRAME, MAX_AGENT_OUTPUT, openAgentSession } from './agent-tools.mjs';

export const MCP_VERSION = '2025-11-25';
export { MAX_AGENT_FRAME };
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' || Number.isSafeInteger(value);
const ownKeys = (value, allowed) => plain(value) && Object.keys(value).every((key) => allowed.includes(key));
const instructions = 'Atlas is contextual source material, not action authority. Start with atlas_guide operating and atlas_state. Read relevant Map questions, find candidates, then inspect exact Points and sources. Load authoring/evaluation guides only when needed. Receive and inspect the complete prepared descriptor before any authorized apply. Read and discovery run no verifiers; evaluate explicitly and keep unable outcomes visible.';

export function serveStdio(session, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    let initialized = false, ready = false, closing = false, buffer = Buffer.alloc(0), discarding = false;
    let queue = Promise.resolve(), writing = Promise.resolve(), pendingWrites = 0;
    const requests = new Map(), seen = new Set();
    function send(message) {
      if (closing) return;
      if (pendingWrites >= 64) { shutdown(); return; }
      let line = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(line) > MAX_AGENT_OUTPUT) line = `${JSON.stringify({ jsonrpc: '2.0', id: message.id,
        error: { code: -32603, message: 'The complete result exceeds the transport output bound.' } })}\n`;
      pendingWrites++;
      writing = writing.then(() => new Promise((done) => output.write(line, done))).catch(() => shutdown()).finally(() => { pendingWrites--; });
    }
    function protocolError(id, code, message, data) { send({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code, message, ...(data === undefined ? {} : { data }) } }); }
    function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
    function shutdown() {
      if (closing) return;
      closing = true;
      for (const request of requests.values()) request.controller.abort();
      input.pause();
      const deadline = setTimeout(() => { session.close(); resolve(0); }, 1000);
      queue.finally(() => writing.finally(() => { clearTimeout(deadline); session.close(); resolve(0); }));
    }
    function handle(message) {
      if (!plain(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
        || !ownKeys(message, ['jsonrpc', 'id', 'method', 'params']) || message.params !== undefined && !plain(message.params)) {
        protocolError(validId(message?.id) ? message.id : undefined, -32600, 'Invalid JSON-RPC request.'); return;
      }
      const params = message.params ?? {}, notification = !Object.hasOwn(message, 'id');
      if (notification) {
        if (message.method === 'notifications/initialized' && initialized) ready = true;
        if (message.method === 'notifications/cancelled' && validId(params.requestId)) requests.get(params.requestId)?.controller.abort();
        return;
      }
      const id = message.id;
      const identity = validId(id) ? createHash('sha256').update(JSON.stringify([typeof id, id])).digest('hex') : null;
      if (!identity || seen.has(identity)) { protocolError(validId(id) ? id : undefined, -32600, 'Request ids must be unique strings or safe integers.'); return; }
      if (seen.size >= 100000) { protocolError(id, -32001, 'Session request budget exhausted. Start a new session.'); return; }
      seen.add(identity);
      if (message.method === 'initialize') {
        if (initialized) { protocolError(id, -32600, 'This session is already initialized.'); return; }
        if (typeof params.protocolVersion !== 'string' || !plain(params.capabilities) || !plain(params.clientInfo)
          || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
          protocolError(id, -32602, 'Initialization requires protocolVersion, capabilities, and clientInfo.'); return;
        }
        initialized = true;
        result(id, { protocolVersion: MCP_VERSION, capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'atlas-agent', version: '0.9.0' }, instructions });
        return;
      }
      if (message.method === 'ping') { result(id, {}); return; }
      if (!ready) { protocolError(id, -32002, 'Initialize and send notifications/initialized before using tools.'); return; }
      if (message.method === 'tools/list') {
        if (!ownKeys(params, ['_meta'])) { protocolError(id, -32602, 'The complete tool list has no continuation cursor.'); return; }
        result(id, { tools: ATLAS_AGENT_TOOLS }); return;
      }
      if (message.method !== 'tools/call') { protocolError(id, -32601, 'Unknown method.'); return; }
      if (!ownKeys(params, ['name', 'arguments', '_meta']) || typeof params.name !== 'string'
        || !ATLAS_AGENT_TOOLS.some((tool) => tool.name === params.name)) { protocolError(id, -32602, 'Unknown tool or invalid call envelope.'); return; }
      if (requests.size >= 32) { protocolError(id, -32001, 'At most 32 active or queued tool calls are admitted.'); return; }
      const controller = new AbortController();
      requests.set(id, { controller });
      queue = queue.then(async () => {
        if (controller.signal.aborted || closing) return;
        try {
          const value = await session.call(params.name, params.arguments === undefined ? {} : params.arguments, { signal: controller.signal });
          if (!controller.signal.aborted) result(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value,
            isError: params.name === 'atlas_apply' && (!['applied', 'no-op'].includes(value.data.result.status)
              || value.data.result.recovery?.status === 'cleanup-failed') });
        } catch (error) {
          if (!controller.signal.aborted) {
            const value = { contract: 'atlas.agent-result/1', tool: params.name, data: { error: {
              code: typeof error?.code === 'string' ? error.code : 'atlas.agent.operation-failed',
              message: error instanceof Error ? error.message : String(error),
            } } };
            result(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: true });
          }
        } finally { requests.delete(id); }
      }).finally(() => { requests.delete(id); });
    }
    input.on('data', (chunk) => {
      if (closing) return;
      if (typeof chunk === 'string') chunk = Buffer.from(chunk);
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start), end = newline === -1 ? chunk.length : newline;
        if (!discarding) {
          if (buffer.length + end - start > MAX_AGENT_FRAME) {
            buffer = Buffer.alloc(0); discarding = true;
            protocolError(undefined, -32700, 'The input frame exceeds 2 MiB.');
          } else buffer = Buffer.concat([buffer, chunk.subarray(start, end)]);
        }
        if (newline === -1) break;
        if (!discarding) {
          let message;
          try { message = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(buffer)); }
          catch { protocolError(undefined, -32700, 'Invalid UTF-8 JSON frame.'); }
          if (message !== undefined) handle(message);
        }
        buffer = Buffer.alloc(0); discarding = false; start = newline + 1;
      }
    });
    input.on('end', shutdown); input.on('error', shutdown); output.on('error', shutdown);
    input.resume();
  });
}

const help = 'atlas-agent --repository-root ABS --atlas PATH --state-directory ABS [--evaluator-module ABS]\nMCP2025-11-25 stdio. Fixed host roots; no shell or default network reader.\n';
export async function run(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { process.stderr.write(help); return 0; }
  const flags = new Map(), allowed = ['--repository-root', '--atlas', '--state-directory', '--evaluator-module'];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!allowed.includes(flag) || flags.has(flag) || !value || value.startsWith('--')) throw new Error('Invalid atlas-agent launch options. Use --help for the exact syntax.');
    flags.set(flag, value);
  }
  if (!['--repository-root', '--atlas', '--state-directory'].every((flag) => flags.has(flag))) throw new Error('Explicit repository, Atlas, and durable state roots are required.');
  for (const flag of ['--repository-root', '--state-directory', '--evaluator-module']) {
    if (flags.has(flag) && !path.isAbsolute(flags.get(flag))) throw new Error(`${flag} requires an absolute path.`);
  }
  // Trusted callback diagnostics must not share the protocol output stream.
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  let registrations = [];
  if (flags.has('--evaluator-module')) {
    const modulePath = flags.get('--evaluator-module'), stat = fs.lstatSync(modulePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The host-selected evaluator module must be a regular file.');
    registrations = (await import(pathToFileURL(modulePath).href)).registrations;
    if (!Array.isArray(registrations)) throw new Error('The host-selected evaluator module must export registrations.');
  }
  const session = openAgentSession({ repositoryRoot: flags.get('--repository-root'), atlasPath: flags.get('--atlas'), stateDirectory: flags.get('--state-directory'),
    registrations });
  return serveStdio(session);
}
