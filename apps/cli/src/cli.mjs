#!/usr/bin/env node
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from '../../../library/src/frontmatter.mjs';
import { openAtlas, getPoint, getTree, getFacet, searchAtlas } from '../../../library/src/model.mjs';
import {
  prepareInitialization, prepareChangeFromDisk, applyDraft, recoverChange, listTransactions,
  saveDraft, loadDraft, listDrafts, deleteDraft,
} from '../../../library/src/authoring.mjs';
import { route } from '../../../library/src/route.mjs';
import { inspectAbsorb, prepareAbsorb } from '../../../library/src/absorb.mjs';
import { resolveState } from '../../../library/src/state.mjs';
import { discoverProject, chooseAtlas, verifySelection, launchBrowser } from './project.mjs';

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const commands = [
  'init INPUT', 'validate', 'inspect [point ID | tree ID | facet TREE_ID FACET_ID]',
  'search INPUT', 'route INPUT', 'absorb inspect INPUT', 'absorb prepare INPUT',
  'prepare INPUT', 'apply DRAFT_ID --revision REVISION', 'recover [TRANSACTION_ID]',
  'drafts [list | show ID | delete ID --revision REVISION]', 'serve [--port PORT]', 'editor [--port PORT]',
  'mcp', 'config', 'export OUTPUT INPUT', 'state [inspect]', 'help',
];
const usage = 'atlas open [PROJECT] [--atlas PATH] [--no-browser]; atlas discover [PROJECT]; atlas --root PATH [--allow-source-root PATH]... COMMAND; INPUT is a JSON file or - for stdin.';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = (message) => fail('CLI_INVALID_ARGUMENT', message);
const emit = (value, stream = process.stdout) => stream.write(`${JSON.stringify(value, null, 2)}\n`);

function count(args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) invalid('Unexpected or missing command arguments.');
}

function nonblank(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) invalid(`${name} must be nonblank text without NUL characters.`);
  return value;
}

function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) invalid('Expected an exact lowercase identity, not a file path.');
  return value;
}

function reviewedRevision(args) {
  if (args.length !== 2 || args[0] !== '--revision' || !/^[a-f0-9]{64}$/.test(args[1])) invalid('Supply --revision with the exact saved draft revision you reviewed.');
  return args[1];
}

function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    invalid('Input has unexpected or missing fields.');
  }
  return value;
}

function launcher(argv) {
  if (argv.length < 3 || argv[0] !== '--root' || argv[1].startsWith('--')) invalid('Supply --root PATH first, followed by one command.');
  const root = path.resolve(nonblank(argv[1], 'root'));
  const allowedRoots = [];
  let index = 2;
  while (['--allow-source-root', '--state-home'].includes(argv[index])) {
    const option = argv[index];
    if (++index >= argv.length || argv[index].startsWith('--')) invalid(`${option} requires a directory path.`);
    const directory = path.resolve(nonblank(argv[index++], 'directory'));
    if (option === '--state-home') process.env.ATLAS_STATE_HOME = directory;
    else allowedRoots.push(directory);
    if (allowedRoots.length > 100) invalid('At most 100 source roots may be granted.');
  }
  const command = argv[index++];
  if (!command || command.startsWith('-')) invalid('Supply one command after the launcher options.');
  return Object.freeze({ root, allowedRoots: Object.freeze([...new Set(allowedRoots)]), command, args: argv.slice(index) });
}

async function inputJson(filename) {
  nonblank(filename, 'input');
  if (filename.startsWith('--')) invalid('Input must be an explicit JSON file path or -.');
  const chunks = [];
  let size = 0;
  const accept = (chunk) => {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) fail('CLI_INPUT_LIMIT', 'JSON input exceeds 4 MiB.');
    chunks.push(chunk);
  };
  if (filename === '-') {
    if (process.stdin.isTTY) invalid('Pipe JSON to stdin when using -.');
    for await (const chunk of process.stdin) accept(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  } else {
    const handle = await fs.open(path.resolve(filename), constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) invalid('JSON input must be a regular file.');
      if (stat.size > MAX_INPUT_BYTES) fail('CLI_INPUT_LIMIT', 'JSON input exceeds 4 MiB.');
      while (true) {
        const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - size));
        const { bytesRead } = await handle.read(buffer);
        if (!bytesRead) break;
        accept(buffer.subarray(0, bytesRead));
      }
    } finally { await handle.close(); }
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size)); }
  catch { fail('CLI_INPUT_ENCODING', 'JSON input must be valid UTF-8.'); }
  return parseStrictJson(text);
}

function outcome(value) {
  const status = value?.status ?? value?.plan?.status;
  if (['invalid', 'incomplete', 'unavailable', 'missing', 'interrupted', 'denied'].includes(status)) process.exitCode = 1;
  emit(value);
}

function inspection(view, args) {
  if (!args.length) return view;
  const [kind, id, facetId] = args;
  if (kind === 'facet') count(args, 3);
  else if (kind === 'point' || kind === 'tree') count(args, 2);
  else invalid('Inspect accepts point ID, tree ID, or facet TREE_ID FACET_ID.');
  identifier(id);
  if (facetId !== undefined) identifier(facetId);
  const record = kind === 'point' ? getPoint(view, id) : kind === 'tree' ? getTree(view, id) : getFacet(view, { tree: id, id: facetId });
  return {
    format: 'atlas.inspection/1', status: view.status !== 'ready' ? 'unavailable' : record ? 'ready' : 'missing',
    identity: view.identity, kind, record, diagnostics: view.diagnostics,
  };
}

function searchInput(value) {
  object(value, ['query', 'tree', 'type', 'limit'], ['query']);
  nonblank(value.query, 'query');
  if (value.query.length > 4096) invalid('Search query exceeds 4096 characters.');
  if (value.tree !== undefined) identifier(value.tree);
  if (value.type !== undefined && !['decision', 'observation', 'untyped'].includes(value.type)) invalid('Unknown Point Type.');
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)) invalid('Search limit must be 1 through 100.');
  return value;
}

function serverOptions(args) {
  let port = 0;
  let exportDirectory;
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i], value = args[i + 1];
    if (!['--port', '--export-directory'].includes(option) || seen.has(option) || !value || value.startsWith('--')) invalid('Use --port NUMBER or --export-directory PATH once each.');
    seen.add(option);
    if (option === '--port') {
      if (!/^[0-9]+$/.test(value) || Number(value) > 65535) invalid('Port must be 0 through 65535.');
      port = Number(value);
    } else exportDirectory = path.resolve(nonblank(value, 'export directory'));
  }
  return { port, exportDirectory };
}

function agentConfiguration(root, allowedRoots) {
  const server = fileURLToPath(new URL('../../agent/src/server.mjs', import.meta.url));
  return { mcpServers: { atlas: {
    command: process.execPath,
    args: [server, '--root', root, ...allowedRoots.filter(directory => directory !== root).flatMap(directory => ['--allow-source-root', directory])],
    ...(process.env.ATLAS_STATE_HOME ? { env: { ATLAS_STATE_HOME: path.resolve(process.env.ATLAS_STATE_HOME) } } : {}),
  } } };
}

async function serve(root, allowedRoots, args, editable, projectOptions = {}) {
  const { port, exportDirectory = projectOptions.exportDirectory } = serverOptions(args);
  const { startPortal } = await import('../../portal/src/server.mjs');
  const portal = await startPortal(root, { port, editable, allowedRoots, exportDirectory, agentConfiguration: agentConfiguration(root, allowedRoots) });
  const browser = projectOptions.browser ? await launchBrowser(portal.url) : 'not-requested';
  emit({ format: 'atlas.server/1', status: 'serving', url: portal.url, editable, browser,
    ...(projectOptions.project ? { project: projectOptions.project, atlasPath: projectOptions.atlasPath, create: projectOptions.create ?? false } : {}),
    shutdown: 'Press Ctrl+C in this terminal to stop Atlas.' });
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try { await portal.close(); }
    catch (error) { emit({ error: { code: error.code ?? 'CLI_SERVER_CLOSE', message: error.message } }, process.stderr); process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function projectCommand(command, args) {
  let project = process.cwd(), atlasPath, browser = true;
  const allowedRoots = [], serviceArgs = [], seen = new Set();
  if (args[0] && !args[0].startsWith('-')) project = args.shift();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--no-browser' && command === 'open') { browser = false; continue; }
    const accepted = command === 'discover' ? ['--atlas'] : ['--atlas', '--port', '--export-directory', '--allow-source-root', '--state-home'];
    if (!accepted.includes(option) || (seen.has(option) && option !== '--allow-source-root') || !args[index + 1] || args[index + 1].startsWith('--')) invalid('Invalid project-opening option. Use --help for syntax.');
    seen.add(option);
    const value = args[++index];
    if (option === '--atlas') atlasPath = value;
    else if (option === '--allow-source-root') allowedRoots.push(path.resolve(value));
    else if (option === '--state-home') process.env.ATLAS_STATE_HOME = path.resolve(value);
    else serviceArgs.push(option, value);
  }
  const discovery = await discoverProject(project, { atlasPath });
  if (command === 'discover') return emit(discovery);
  const selected = await verifySelection(discovery, await chooseAtlas(discovery));
  const roots = [...new Set([selected.root, discovery.project, ...allowedRoots])];
  if (roots.length > 100) invalid('At most 100 source roots may be granted.');
  return serve(selected.root, roots, serviceArgs, true, {
    project: discovery.project, atlasPath: selected.path, create: selected.create, browser,
    exportDirectory: selected.path === '.'
      ? path.join(path.dirname(discovery.project), `${path.basename(discovery.project)}-atlas-export`)
      : path.join(discovery.project, 'atlas-export'),
  });
}

async function main(argv) {
  if (!argv.length || ['--help', '-h', 'help'].includes(argv[0])) {
    count(argv, 0, 1);
    return emit({ usage, projectOptions: ['--atlas PATH', '--no-browser', '--port PORT', '--export-directory PATH', '--allow-source-root PATH', '--state-home PATH'], commands });
  }
  if (argv[0] === '--version') {
    count(argv, 1);
    return emit({ format: 'atlas.version/1', version: (await fs.readFile(new URL('../../../VERSION', import.meta.url), 'utf8')).trim() });
  }
  if (['open', 'discover'].includes(argv[0])) return projectCommand(argv[0], argv.slice(1));
  const { root, allowedRoots, command, args } = launcher(argv);
  const sourceRoots = Object.freeze([...new Set([root, ...allowedRoots])]);
  if (sourceRoots.length > 100) invalid('At most 100 distinct source roots, including the Atlas root, may be granted.');
  switch (command) {
    case 'help':
      count(args, 0);
      return emit({ usage, commands });
    case 'config': {
      count(args, 0);
      return emit(agentConfiguration(root, sourceRoots));
    }
    case 'state': {
      if (args.length > 1 || args.length === 1 && args[0] !== 'inspect') invalid('Use state inspect.');
      return emit({ format: 'atlas.state-inspection/1', state: await resolveState(root) });
    }
    case 'validate': {
      count(args, 0);
      const view = await openAtlas(root);
      return outcome({ format: 'atlas.validation/1', status: view.status, identity: view.identity, diagnostics: view.diagnostics });
    }
    case 'inspect':
      return outcome(inspection(await openAtlas(root), args));
    case 'init': {
      count(args, 1);
      const request = object(await inputJson(args[0]), ['id', 'title']);
      identifier(request.id); nonblank(request.title, 'title');
      const plan = prepareInitialization(await openAtlas(root), request);
      return outcome(await saveDraft(root, { plan }));
    }
    case 'prepare': {
      count(args, 1);
      const request = await inputJson(args[0]);
      const plan = await prepareChangeFromDisk(root, request);
      return outcome(await saveDraft(root, { plan }));
    }
    case 'apply': {
      count(args, 3);
      return outcome(await applyDraft(root, identifier(args[0]), { expectedRevision: reviewedRevision(args.slice(1)), allowedRoots: sourceRoots }));
    }
    case 'drafts': {
      count(args, 0, 4);
      if (!args.length || args.length === 1 && args[0] === 'list') return emit({ format: 'atlas.drafts/1', drafts: await listDrafts(root) });
      count(args, args[0] === 'delete' ? 4 : 2);
      const id = identifier(args[1]);
      if (args[0] === 'show') return outcome(await loadDraft(root, id));
      if (args[0] === 'delete') return outcome(await deleteDraft(root, id, { expectedRevision: reviewedRevision(args.slice(2)) }));
      return invalid('Drafts accepts list, show ID, or delete ID.');
    }
    case 'recover':
      count(args, 0, 1);
      return outcome(args.length ? await recoverChange(root, identifier(args[0])) : { format: 'atlas.transactions/1', transactions: await listTransactions(root) });
    case 'search': {
      count(args, 1);
      const request = searchInput(await inputJson(args[0]));
      const view = await openAtlas(root);
      return outcome({ format: 'atlas.search/1', status: view.status === 'ready' ? 'ready' : 'unavailable', identity: view.identity, request, results: searchAtlas(view, request), diagnostics: view.diagnostics });
    }
    case 'route': {
      count(args, 1);
      const request = await inputJson(args[0]);
      return outcome(route(await openAtlas(root), request));
    }
    case 'absorb': {
      count(args, 2);
      if (!['inspect', 'prepare'].includes(args[0])) invalid('Absorb accepts inspect INPUT or prepare INPUT.');
      const request = await inputJson(args[1]);
      const view = await openAtlas(root);
      if (args[0] === 'inspect') return outcome(inspectAbsorb(view, request));
      const proposal = prepareAbsorb(view, request);
      const draft = ['ready', 'noop'].includes(proposal.status) ? await saveDraft(root, { plan: proposal.plan }) : null;
      return outcome({ ...proposal, draft });
    }
    case 'serve':
    case 'editor':
      return serve(root, sourceRoots, args, command === 'editor');
    case 'mcp': {
      count(args, 0);
      const { startAgent } = await import('../../agent/src/server.mjs');
      const agent = startAgent(root, { allowedRoots });
      const stop = () => { agent.close(); process.stdin.destroy(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      await agent.closed;
      return;
    }
    case 'export': {
      count(args, 2);
      const output = path.resolve(nonblank(args[0], 'output'));
      const selection = object(await inputJson(args[1]), ['trees', 'points', 'sources'], ['trees']);
      if (!Array.isArray(selection.trees) || !selection.trees.length) invalid('Export requires an explicit nonempty trees array.');
      for (const tree of selection.trees) identifier(tree);
      if (selection.points !== undefined) {
        if (!Array.isArray(selection.points)) invalid('Export points must be an array.');
        selection.points.forEach(identifier);
      }
      if (selection.sources !== undefined) {
        if (!Array.isArray(selection.sources)) invalid('Export sources must be an array.');
        selection.sources.forEach((source) => nonblank(source, 'source URI'));
      }
      const { exportPortal } = await import('../../portal/src/export.mjs');
      return outcome(await exportPortal(root, output, { ...selection, allowedRoots: sourceRoots }));
    }
    default:
      invalid(`Unknown command: ${command}.`);
  }
}

try { await main(process.argv.slice(2)); }
catch (error) {
  const code = typeof error.code === 'string' ? error.code : error instanceof TypeError ? 'CLI_INVALID_ARGUMENT' : 'CLI_FAILED';
  const invalidInput = code.startsWith('CLI_INPUT_') || code.startsWith('JSON_') || ['CLI_INVALID_ARGUMENT', 'PROJECT_INVALID', 'PROJECT_AMBIGUOUS', 'PROJECT_DISCOVERY_LIMIT', 'INVALID_REQUEST', 'UNSAFE_PATH'].includes(code) || code.endsWith('.invalid-argument');
  const conflict = ['STALE', 'STALE_DRAFT', 'STALE_SOURCE', 'LOCKED', 'PROJECT_CHANGED', 'CONCURRENT_CHANGE', 'RECOVERY_CONFLICT'].includes(code);
  process.exitCode = invalidInput ? 2 : conflict ? 3 : 1;
  emit({ error: { code, message: error.message }, ...(invalidInput ? { usage } : {}) }, process.stderr);
}
