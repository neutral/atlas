import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { applyAtlasChange } from 'atlas-reference-validator';
import { discoverProject, exactSelection, managedState, newSelection, prepareInitialization, prepareCache, requireExternalStorage, requireSeparateDirectories, userDataRoot, fail } from './project.mjs';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const usage = `Atlas ${version}
Usage: atlas COMMAND [options]

  open [PROJECT]       Open the local browser Editor (default: current directory)
  discover [PROJECT]   List project collections without writing
  init [PROJECT]       Preview creation; --apply explicitly writes the new Atlas
  export [PROJECT]     Preview publication selection; --apply exports a static site
  connect [PROJECT]    Print agent-host configuration for this fixed selection
  mcp                 Serve MCP stdio for host-selected roots
  validate            Validate Atlas structure (--help for syntax)
  read                Read and search captured Atlas content
  inspect             Inspect an exact Point
  workspace           Read or refresh a configured workspace
  author              Prepare, apply, evaluate, and inspect recovery

Use atlas COMMAND --help for details. --version prints the product version.
Projects, durable drafts, and export destinations remain outside the installation.`;
const openHelp = `atlas open [PROJECT] [--atlas PATH] [--state-directory DIR]
  [--export-dir DIR] [--cache-directory DIR] [--evaluator MODULE]
  [--port NUMBER] [--no-browser] [--bind ADDRESS --origin URL]
  [--preview-port NUMBER --preview-origin URL]
The default project is the current directory. Workspace configuration selects first;
otherwise discovery opens one collection or offers a choice. With none, the Editor
offers creation through preview and explicit apply. Opening writes no authored files.
Drafts and recovery use managed OS user-data storage. --state-directory overrides it.
The service binds 127.0.0.1, prints a protected launch URL, and opens the browser.
Keep this command running; Ctrl-C stops it and preserves drafts. Port 0 is automatic.
--export-dir fixes the explicit Export site destination. Evaluators are trusted code.`;
const commandHelp = {
  open: openHelp,
  discover: 'atlas discover [PROJECT] [--atlas PATH]\nPrint bounded, read-only collection discovery as JSON. Workspace configuration takes precedence.',
  init: 'atlas init [PROJECT] [--atlas PATH] [--id ID] [--title TITLE] [--state-directory DIR] [--apply]\nPrint the complete creation diff. --apply explicitly applies it after stale preflight. The default selection is atlas. Workspace configuration is not created.',
  connect: 'atlas connect [PROJECT] [--atlas PATH] [--state-directory DIR] [--evaluator-module MODULE]\natlas connect --container NAME --repository-root ABS --atlas PATH --state-directory ABS\n  [--container-command ABS] [--container-runtime ABS]\nPrint mcpServers JSON with fixed project, Atlas, and state roots. Container mode produces docker exec -i configuration using exact container paths; it does not discover host paths or contact Docker. Copy into the chosen host; no host settings are edited. Scope grants no publication permission. Preparation, evaluation, and authorized application remain explicit.',
  mcp: 'atlas mcp --repository-root ABS --atlas PATH [--state-directory DIR] [--evaluator-module ABS]\nServe MCP stdio with fixed host-selected roots. Durable state defaults to managed OS storage. Stdout contains protocol traffic only. No shell or default network reader is exposed.',
};
const delegated = { validate: './cli.mjs', read: './read-cli.mjs', inspect: './inspect-cli.mjs', workspace: './workspace-cli.mjs', author: './authoring-cli.mjs' };
function parse(argv, allowed, booleans = []) {
  const flags = {}, positional = [];
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('-')) { positional.push(item); continue; }
    if (!allowed.includes(item) || Object.hasOwn(flags, item)) fail(`Unknown or repeated option: ${item}`);
    if (booleans.includes(item)) flags[item] = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail(`${item} requires a value.`);
      flags[item] = value;
    }
  }
  if (positional.length > 1) fail('Supply one PROJECT directory.');
  return { project: positional[0] ?? '.', flags };
}
async function select(project, explicit, { allowMissing = false } = {}) {
  const result = discoverProject(project, explicit);
  if (result.selections.length === 1) return result.selections[0];
  if (!result.selections.length) {
    if (allowMissing) return newSelection(result.repositoryRoot);
    fail('No Atlas found. Run atlas open to preview creation, or select one with --atlas PATH.', 'atlas.launch.no-atlas');
  }
  const choices = result.selections.map((item, index) => `  ${index + 1}. ${item.atlasPath}`).join('\n');
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail(`Several Atlas collections exist:\n${choices}\nRun atlas open ${JSON.stringify(result.repositoryRoot)} --atlas PATH to choose.`, 'atlas.launch.ambiguous');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question(`Choose an Atlas collection:\n${choices}\nCollection number (blank cancels): `);
    const index = Number(answer) - 1;
    if (!answer || !Number.isInteger(index) || !result.selections[index]) fail('No collection selected. Use --atlas PATH for an exact selection.');
    return result.selections[index];
  } finally { input.close(); }
}
export function agentConfiguration(selection, { stateDirectory, evaluatorModule } = {}) {
  const launcher = process.env.ATLAS_LAUNCHER;
  if (launcher && !path.isAbsolute(launcher)) fail('ATLAS_LAUNCHER must be absolute.');
  const command = launcher ?? process.execPath;
  requireExternalStorage(stateDirectory ? path.resolve(stateDirectory) : managedState(selection, 'agent'));
  const args = [...(launcher ? [] : [fileURLToPath(new URL('../bin/atlas.mjs', import.meta.url))]), 'mcp',
    '--repository-root', selection.repositoryRoot, '--atlas', selection.atlasPath,
    '--state-directory', stateDirectory ? path.resolve(stateDirectory) : managedState(selection, 'agent'),
    ...(evaluatorModule ? ['--evaluator-module', path.resolve(evaluatorModule)] : [])];
  return { mcpServers: { atlas: { command, args, ...(process.env.ATLAS_NODE ? { env: { ATLAS_NODE: process.env.ATLAS_NODE } } : {}) } } };
}
export function containerAgentConfiguration(flags) {
  const container = flags['--container'];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(container ?? '')) fail('Supply an exact container name without shell syntax.');
  const repositoryRoot = flags['--repository-root'], stateDirectory = flags['--state-directory'];
  const launcher = flags['--container-command'] ?? '/opt/atlas/bin/atlas';
  const runtime = flags['--container-runtime'] ?? '/usr/local/bin/node';
  for (const value of [repositoryRoot, stateDirectory, launcher, runtime]) {
    if (typeof value !== 'string' || !path.posix.isAbsolute(value) || /[\x00-\x1f\\]/u.test(value) || path.posix.normalize(value) !== value) fail('Container project, state, command, and runtime must be exact absolute container paths.');
  }
  const atlasPath = exactSelection(flags['--atlas']);
  const atlasRoot = path.posix.resolve(repositoryRoot, atlasPath);
  const inside = (parent, child) => parent === child || child.startsWith(`${parent}/`);
  if ([atlasRoot, path.posix.join(repositoryRoot, 'tmp'), path.posix.join(repositoryRoot, '.git')].some(forbidden => inside(forbidden, stateDirectory) || inside(stateDirectory, forbidden))) fail('Container state must be separate from Atlas, project tmp, and .git.');
  return { mcpServers: { atlas: { command: 'docker', args: ['exec', '-i', '--env', `ATLAS_NODE=${runtime}`, container, launcher, 'mcp',
    '--repository-root', repositoryRoot, '--atlas', atlasPath, '--state-directory', stateDirectory] } } };
}
export async function launchBrowser(url) {
  const command = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  return new Promise(resolve => {
    const child = spawn(command, [url], { stdio: 'ignore' });
    let finished = false;
    const done = value => { if (!finished) { finished = true; clearTimeout(timeout); resolve(value); } };
    const timeout = setTimeout(() => { child.unref(); done(false); }, 5000);
    child.once('error', () => done(false));
    child.once('exit', code => done(code === 0));
  });
}
export async function run(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (['--version', '-v', 'version'].includes(command)) { console.log(version); return 0; }
  if (!command || ['--help', '-h', 'help'].includes(command)) {
    if (command === 'help' && rest.length) return run([rest[0], '--help']);
    console.log(usage); return 0;
  }
  if (Object.hasOwn(delegated, command)) return (await import(delegated[command])).run(rest);
  if (rest.length === 1 && ['--help', '-h'].includes(rest[0]) && commandHelp[command]) { console.log(commandHelp[command]); return 0; }
  if (command === 'export') {
    const args = [...rest], forwarded = [];
    let project = '.', atlasPath, cacheDirectory, sawProject = false;
    const booleans = new Set(['--apply', '--preview', '--help', '-h']);
    for (let index = 0; index < args.length; index++) {
      const item = args[index];
      if (item === '--atlas') { if (atlasPath !== undefined) fail('Repeated --atlas.'); atlasPath = args[++index]; if (!atlasPath) fail('--atlas requires a value.'); }
      else if (item === '--cache-directory') { if (cacheDirectory !== undefined) fail('Repeated --cache-directory.'); cacheDirectory = args[++index]; if (!cacheDirectory) fail('--cache-directory requires a value.'); }
      else if (item.startsWith('-')) { forwarded.push(item); if (!booleans.has(item)) { if (!args[index + 1]) fail(`${item} requires a value.`); forwarded.push(args[++index]); } }
      else { if (sawProject) fail('Supply one PROJECT directory.'); project = item; sawProject = true; }
    }
    const product = await import('atlas-portal/product');
    if (['--help', '-h'].includes(forwarded[0])) { await product.runExport(['--help']); return 0; }
    const selection = await select(project, atlasPath);
    const outputIndex = forwarded.indexOf('--out-dir');
    const outputDirectory = outputIndex >= 0 && forwarded[outputIndex + 1] ? path.resolve(forwarded[outputIndex + 1]) : null;
    if (outputDirectory) requireSeparateDirectories(outputDirectory, userDataRoot(), 'Export output must be separate from managed durable application state.');
    prepareCache(selection, cacheDirectory, outputDirectory ? [outputDirectory] : []);
    await product.runExport(forwarded, selection); return 0;
  }
  if (command === 'mcp') {
    const { flags, project } = parse(rest, ['--repository-root', '--atlas', '--state-directory', '--evaluator-module']);
    if (project !== '.' || !flags['--repository-root'] || !path.isAbsolute(flags['--repository-root']) || !flags['--atlas']) fail('MCP requires --repository-root ABS and --atlas PATH.');
    const selection = await select(flags['--repository-root'], flags['--atlas'], { allowMissing: true });
    const options = ['--repository-root', selection.repositoryRoot, '--atlas', selection.atlasPath,
      '--state-directory', flags['--state-directory'] ? path.resolve(flags['--state-directory']) : managedState(selection, 'agent'),
      ...(flags['--evaluator-module'] ? ['--evaluator-module', path.resolve(flags['--evaluator-module'])] : [])];
    requireExternalStorage(options[5]);
    return (await import('../../agent/src/agent-stdio.mjs')).run(options);
  }
  const allowed = {
    open: ['--atlas', '--state-directory', '--export-dir', '--cache-directory', '--evaluator', '--port', '--no-browser', '--bind', '--origin', '--preview-port', '--preview-origin'],
    discover: ['--atlas'], init: ['--atlas', '--id', '--title', '--state-directory', '--apply'],
    connect: ['--atlas', '--state-directory', '--evaluator-module', '--container', '--repository-root', '--container-command', '--container-runtime'],
  };
  if (!Object.hasOwn(allowed, command)) fail(`Unknown command: ${command}. Run atlas --help.`);
  const { project, flags } = parse(rest, allowed[command], ['--no-browser', '--apply']);
  if (command === 'connect' && flags['--container']) {
    if (project !== '.' || flags['--evaluator-module']) fail('Container configuration uses explicit --repository-root and no local PROJECT or evaluator.');
    console.log(JSON.stringify(containerAgentConfiguration(flags), null, 2)); return 0;
  }
  if (command === 'connect' && ['--repository-root', '--container-command', '--container-runtime'].some(flag => flags[flag])) fail('Container launch options require --container NAME.');
  if (command === 'discover') { console.log(JSON.stringify(discoverProject(project, flags['--atlas']), null, 2)); return 0; }
  const selection = await select(project, flags['--atlas'], { allowMissing: ['open', 'init'].includes(command) });
  if (command === 'connect') {
    console.log(JSON.stringify(agentConfiguration(selection, { stateDirectory: flags['--state-directory'], evaluatorModule: flags['--evaluator-module'] }), null, 2)); return 0;
  }
  if (command === 'init') {
    const plan = prepareInitialization(selection, { id: flags['--id'], title: flags['--title'] });
    console.log(`Create Atlas at ${selection.atlasRoot}\n${plan.changes.map(item => item.diff).join('\n')}\nPlan: ${plan.digest}\nValidation: ${plan.status}`);
    if (!flags['--apply']) { console.log('Preview only. Run again with --apply to explicitly create these files.'); return plan.status === 'ready' ? 0 : 1; }
    const recoveryDirectory = path.join(flags['--state-directory'] ? path.resolve(flags['--state-directory']) : managedState(selection, 'initialization'), 'recovery');
    requireExternalStorage(recoveryDirectory);
    const result = applyAtlasChange(plan, { recoveryDirectory });
    console.log(JSON.stringify(result, null, 2));
    return ['applied', 'no-op'].includes(result.status) && result.recovery?.status !== 'cleanup-failed' ? 0 : 2;
  }
  const stateDirectory = flags['--state-directory'] ? path.resolve(flags['--state-directory']) : managedState(selection);
  requireExternalStorage(stateDirectory);
  const exportDirectory = flags['--export-dir'] ? path.resolve(flags['--export-dir']) : path.join(os.homedir(), 'Documents', 'Atlas Exports',
    `${path.basename(selection.repositoryRoot)}-${selection.atlasPath.replaceAll('/', '-')}-${new Date().toISOString().replaceAll(':', '-')}`);
  requireSeparateDirectories(stateDirectory, exportDirectory, 'Export output must be separate from durable application state.');
  requireSeparateDirectories(userDataRoot(), exportDirectory, 'Export output must be separate from managed durable application state.');
  const cacheDirectory = prepareCache(selection, flags['--cache-directory'], [stateDirectory, exportDirectory]);
  const { startEditor } = await import('atlas-editor');
  const editor = await startEditor({ repositoryRoot: selection.repositoryRoot, atlasPath: selection.atlasPath, stateDirectory, exportDirectory,
    agentConfiguration: agentConfiguration(selection), ...(flags['--evaluator'] ? { evaluatorModule: path.resolve(flags['--evaluator']) } : {}),
    ...(flags['--bind'] ? { bindAddress: flags['--bind'] } : {}), ...(flags['--origin'] ? { publicOrigin: flags['--origin'] } : {}),
    ...(flags['--preview-port'] ? { previewPort: Number(flags['--preview-port']) } : {}), ...(flags['--preview-origin'] ? { previewOrigin: flags['--preview-origin'] } : {}),
    ...(flags['--port'] ? { port: Number(flags['--port']) } : {}) });
  console.log(`Atlas ${version}\nProject: ${selection.repositoryRoot}\nCollection: ${selection.atlasPath}\nDrafts and recovery: ${stateDirectory}\nDisposable cache: ${cacheDirectory}\nOpen: ${editor.url}\nReady: ${JSON.stringify({ event: 'atlas.ready', version, origin: editor.origin, repositoryRoot: selection.repositoryRoot, atlasPath: selection.atlasPath })}\nKeep this terminal open. Ctrl-C stops Atlas and preserves drafts.`);
  const close = async () => { process.off('SIGINT', close); process.off('SIGTERM', close); await editor.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  if (!flags['--no-browser'] && !await launchBrowser(editor.url)) console.error('The browser could not be opened automatically. Open the printed launch URL.');
  return 0;
}
