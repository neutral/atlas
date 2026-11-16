import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStyle, listStyles } from '../../../library/src/styles.mjs';
import { readGuide, GUIDE_DOCUMENTS, TOOLS } from '../../agent/src/tools.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const commands = ['open', 'locate', 'validate', 'outline', 'inspect', 'search', 'route', 'references', 'read-source', 'stale', 'guide', 'styles', 'init', 'candidate', 'prepare', 'review', 'apply', 'drafts', 'recover', 'move', 'stamp', 'absorb', 'config', 'state', 'mcp', 'export', 'help'];
const removed = ['serve', 'editor', 'style', 'sources', 'source-history', 'source-record', 'draft-review', 'draft-checks', 'inventory', 'discover'];

function run(root, args, { input, grants = [], raw = false } = {}) {
  const result = spawnSync(process.execPath, [cli, ...(raw ? [] : ['--root', root, ...grants.flatMap((grant) => ['--allow-source-root', grant])]), ...args], {
    input, encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr,
    result: result.stdout.startsWith('{') ? JSON.parse(result.stdout) : null,
    error: result.stderr ? JSON.parse(result.stderr) : null };
}

async function fixture(t) {
  const directory = await tempDirectory('atlas-cli-');
  const root = path.join(directory, 'atlas');
  await fs.mkdir(root);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, root };
}

function initialize(root) {
  const prepared = run(root, ['init', '--id', 'example', '--title', 'Example', '--style', 'concise-subjects']);
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.equal(prepared.result.plan.status, 'ready');
  const applied = run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision]);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.status, 'complete');
  return prepared.result;
}

async function manifestChange(root, title) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'));
  return { reason: `Set title to ${title}`, changes: [{ path: 'atlas.json', content: `${JSON.stringify({ ...manifest, title }, null, 2)}\n` }] };
}

test('CLI requires a fixed first root and rejects unknown, removed or extra arguments', async (t) => {
  const { root } = await fixture(t);
  for (const args of [['validate', '--root', root], ['--root', '--allow-source-root', 'validate']]) {
    const result = run(root, args, { raw: true });
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, 'CLI_INVALID_ARGUMENT');
    assert.equal(result.stdout, '');
  }
  for (const args of [['unknown'], ...removed.map(command => [command]), ['validate', '--root', '/tmp'], ['apply', '/tmp/arbitrary-plan.json'], ['open', '--port', '-1'], ['open', '--export-directory', '/tmp/out'],
    ['state', 'unknown'], ['state', 'inspect', 'extra'], ['absorb', 'inspect', '-'], ['absorb', 'prepare', '-'], ['init', '-'], ['prepare', '--from', root], ['stamp', '--everything'], ['export', '--all']]) {
    const result = run(root, args, { input: '{}' });
    assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.error.error.code, 'CLI_INVALID_ARGUMENT', args.join(' '));
    assert.match(result.error.usage, /atlas --root PATH/);
  }
  const input = run(root, ['prepare', '-'], { input: '{"changes":[],"reason":"Nothing","root":"/tmp"}' });
  assert.equal(input.code, 2);
  assert.equal(input.error.error.code, 'INVALID_REQUEST');
  assert.deepEqual(await fs.readdir(root), []);
});

test('CLI bounds JSON files and stdin and rejects invalid encodings and duplicate keys', async (t) => {
  const { directory, root } = await fixture(t);
  for (const [input, code] of [
    ['{"reason":"First","reason":"Second","changes":[]}', 'JSON_DUPLICATE_KEY'],
    [Buffer.from([0xff]), 'CLI_INPUT_ENCODING'],
    [' '.repeat(4 * 1024 * 1024 + 1), 'CLI_INPUT_LIMIT'],
  ]) {
    const result = run(root, ['prepare', '-'], { input });
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.error.error.code, code);
  }
  const oversized = path.join(directory, 'large.json');
  await fs.writeFile(oversized, ' '.repeat(4 * 1024 * 1024 + 1));
  const result = run(root, ['prepare', oversized]);
  assert.equal(result.code, 2);
  assert.equal(result.error.error.code, 'CLI_INPUT_LIMIT');
  assert.deepEqual(await fs.readdir(root), []);
});

test('help names exactly the commands of this version, and each command describes itself', async (t) => {
  const { root } = await fixture(t);
  const overview = run(root, ['--help'], { raw: true });
  assert.equal(overview.code, 0, overview.stderr);
  assert.deepEqual(overview.result.commands.map(entry => entry.command), commands);
  assert.deepEqual(Object.keys(overview.result.exit), ['0', '1', '2', '3']);
  for (const option of ['--root PATH', '--allow-source-root PATH', '--state-home PATH']) assert.ok(overview.result.options[option]);
  const text = JSON.stringify(overview.result);
  for (const gone of ['Editor', 'editor', 'serve ', 'source-history', 'draft-checks', 'Branch', '--export-directory']) assert.ok(!text.includes(gone), gone);
  for (const command of commands) {
    const help = run(root, ['help', command], { raw: true });
    assert.equal(help.code, 0, help.stderr);
    assert.equal(help.result.command, command);
    assert.ok(help.result.usage.length && help.result.does && help.result.prints, command);
    const after = run(root, [command, '--help']);
    assert.deepEqual(after.result, help.result, command);
    // Help needs no Atlas: atlas COMMAND --help and atlas COMMAND -h work without --root, for every command.
    for (const asked of ['--help', '-h']) {
      const rootless = run(null, [command, asked], { raw: true });
      assert.equal(rootless.code, 0, `${command} ${asked}: ${rootless.stderr}`);
      assert.deepEqual(rootless.result, help.result, `${command} ${asked}`);
    }
  }
  assert.deepEqual(run(root, ['help', '--help'], { raw: true }).result, run(root, ['help', 'help'], { raw: true }).result);
  for (const command of removed) assert.equal(run(root, ['help', command], { raw: true }).code, 2, command);
  // config has a project form, as open and locate do, with the options that form takes.
  assert.match(overview.result.usage, /^atlas open \[PROJECT\]; atlas locate \[PROJECT\]; atlas config \[PROJECT\]; /);
  assert.match(overview.result.options['--root PATH'], /except open, locate, config, guide, styles, help and --version/);
  const config = run(root, ['help', 'config'], { raw: true }).result;
  assert.deepEqual(Object.keys(config.options), ['--atlas PATH', '--allow-source-root PATH', '--state-home PATH']);
  assert.match(config.does, /its source grants and, when one is set, its state location/);
  // A conflict is what the current state refuses; an apply that meets one once it has begun is interrupted, not refused.
  assert.ok(!overview.result.exit[3].includes('CONCURRENT_CHANGE'));
  assert.match(overview.result.exit[3], /atlas\.route\.stale-cursor/);
  assert.match(run(root, ['help', 'apply'], { raw: true }).result.prints, /identity \(of the Atlas after a complete or noop apply; an interrupted one has none\)/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('every command that takes INPUT says what INPUT is, in atlas --help and in its own help, and its example runs', async (t) => {
  const { directory } = await fixture(t);
  const root = path.join(directory, 'notes');
  await fs.cp(fileURLToPath(new URL('../../../examples/offline-notes', import.meta.url)), root, { recursive: true });
  const overview = run(null, ['--help'], { raw: true }).result;
  assert.match(overview.input, /^INPUT is the path of a JSON file, or - to read the JSON from standard input: .* For example: echo '\{.*\}' \| atlas --root PATH search -$/);
  assert.match(overview.usage, /INPUT is the path of a JSON file, or - to read the JSON from standard input\.$/);
  const taking = overview.commands.filter(entry => entry.usage.some(form => /\bINPUT\b/.test(form))).map(entry => entry.command);
  assert.deepEqual(taking, ['inspect', 'search', 'route', 'references', 'stale', 'prepare', 'review', 'drafts', 'move', 'absorb']);
  assert.deepEqual(overview.commands.filter(entry => entry.INPUT).map(entry => entry.command), taking, 'atlas --help says it beside each, and beside no other');
  const draft = run(root, ['prepare', '-'], { input: '{"reason":"A draft to read.","changes":[]}' }).result;
  for (const command of taking) {
    const help = run(null, ['help', command], { raw: true }).result;
    assert.equal(help.INPUT, overview.commands.find(entry => entry.command === command).INPUT, command);
    const [, json, args] = /^The path of a JSON file, or - to read the JSON from standard input\. For example: echo '(\{.*\})' \| atlas --root PATH (.+)$/.exec(help.INPUT);
    const ran = run(root, args.split(' ').map(word => word === 'ID' ? draft.id : word), { input: json });
    assert.notEqual(ran.code, 2, `${command}: ${ran.stderr}`);
    assert.ok(ran.result, `${command} printed its result`);
    if (!['prepare', 'move'].includes(command)) assert.equal(ran.code, 0, `${command}: ${ran.stderr}`);
    else assert.equal(ran.result.plan.status, 'ready', `${command}: ${JSON.stringify(ran.result.plan.validation?.diagnostics)}`);
  }
});

test('outline gives every Tree, or one, with its scope and one line for each Point as the outline places it', async (t) => {
  const { root } = await fixture(t);
  const example = fileURLToPath(new URL('../../../examples/offline-notes', import.meta.url));
  const all = run(example, ['outline']);
  assert.equal(all.code, 0, all.stderr);
  assert.deepEqual(Object.keys(all.result), ['format', 'status', 'identity', 'trees', 'diagnostics']);
  assert.deepEqual([all.result.format, all.result.status, all.result.trees.map(tree => tree.id)], ['atlas.outline/1', 'ready', ['product', 'architecture']]);
  const product = run(example, ['outline', 'product']).result;
  assert.equal(product.tree, 'product');
  assert.deepEqual(product.trees, [{ id: 'product', title: 'Product experience', scope: 'What note writers can rely on, including the limits of the offline promise.', outline: [
    'product-purpose: Writers can keep working on notes when the connection drops',
    '  offline-work: Offline work stays on the current device',
    '    delivery-promise: A note is “Saved on this device” until a server receipt makes it “Sent for sync” [decision: selected]',
  ] }]);
  assert.deepEqual(product.trees[0], all.result.trees[0], 'one Tree reads as it does among all');
  const missing = run(example, ['outline', 'nowhere']);
  assert.equal(missing.code, 1);
  assert.deepEqual([missing.result.status, missing.result.trees], ['missing', []]);
  assert.equal(run(example, ['outline', 'trees/product']).code, 2, 'a Tree by its ID, not a path');
  assert.equal(run(example, ['outline', 'product', 'architecture']).code, 2);
  const absent = run(root, ['outline']);
  assert.deepEqual([absent.code, absent.result.status], [1, 'unavailable']);
  assert.deepEqual(await fs.readdir(root), []);
  // An Atlas with no Tree has every Tree it has to show; a Tree it does not have is missing.
  initialize(root);
  const empty = run(root, ['outline']);
  assert.deepEqual([empty.code, empty.result.status, empty.result.trees], [0, 'ready', []]);
  const none = run(root, ['outline', 'product']);
  assert.deepEqual([none.code, none.result.status, none.result.tree, none.result.trees], [1, 'missing', 'product', []]);
});

test('every operation the guide names is a CLI command and an MCP tool atlas_<name>', async () => {
  const named = new Set([...(await readGuide()).matchAll(/`([a-z][a-z0-9-]*)`/g)].map(match => match[1]));
  // What else the guide names in backticks, by kind. A word that is none of these is taken for an operation, so a new
  // one fails here until it is an operation of both adapters or is placed in one of these lists.
  const other = {
    fields: ['baseline', 'children', 'id', 'locator', 'next', 'on', 'revision', 'role', 'sha256', 'sources', 'status', 'targets', 'title', 'type', 'uncertainty', 'uri', 'via'],
    values: ['decision', 'observation', 'denied', 'pass', 'fail', 'unable'],
    roles: ['evidence', 'background', 'example', 'implementation', 'history'],
    modes: ['discover', 'read'],
    documents: [...GUIDE_DOCUMENTS],
  };
  const operations = [...named].filter(word => !Object.values(other).flat().includes(word));
  assert.ok(operations.length >= 10, `The guide names too few operations to be read: ${operations.join(', ')}.`);
  const commands = run(null, ['--help'], { raw: true }).result.commands.map(entry => entry.command);
  const tools = TOOLS.map(tool => tool.name);
  assert.deepEqual(operations.filter(name => !commands.includes(name)), [], 'operations the guide names that are no CLI command');
  assert.deepEqual(operations.filter(name => !tools.includes(`atlas_${name}`)), [], 'operations the guide names that are no MCP tool');
});

test('a reader that closes the pipe early ends the command quietly', async () => {
  const { spawn } = await import('node:child_process');
  // Each command prints its result into a pipe whose reading end is already closed, as when the output goes to head.
  for (const args of [['--help'], ['guide'], ['--root', path.join(fileURLToPath(new URL('../../../', import.meta.url)), 'examples/offline-notes'), 'inspect', '--full']]) {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.destroy();
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code, signal] = await new Promise(resolve => child.on('close', (...outcome) => resolve(outcome)));
    assert.deepEqual([code, signal, stderr], [0, null, ''], args.join(' '));
  }
});

test('guide and styles print the shipped documents, with or without a root', async (t) => {
  const { root } = await fixture(t);
  const guide = run(root, ['guide'], { raw: true });
  assert.equal(guide.code, 0, guide.stderr);
  assert.equal(guide.stdout, await readGuide());
  assert.match(guide.stdout, /^# Working with Atlas\n/);
  assert.equal(run(root, ['guide']).stdout, guide.stdout);
  const listed = run(root, ['styles'], { raw: true });
  assert.equal(listed.result.format, 'atlas.styles/1');
  assert.deepEqual(listed.result.styles, listStyles());
  assert.deepEqual(run(root, ['styles']).result, listed.result);
  for (const { id } of listStyles()) assert.equal(run(root, ['styles', 'show', id], { raw: true }).stdout, getStyle(id).content);
  const unknown = run(root, ['styles', 'show', 'invented'], { raw: true });
  assert.equal(unknown.code, 2);
  assert.match(unknown.error.error.message, /concise-subjects/);
  assert.equal(run(root, ['styles', 'concise-subjects'], { raw: true }).code, 2);
  assert.equal(run(root, ['guide', 'operating'], { raw: true }).code, 2);
  // The documents the guide names, each as shipped.
  for (const [name, title] of [['spec', /^# /], ['format', /^# /], ['operations', /^# /], ['project', /^# /]]) {
    const printed = run(root, ['guide', name], { raw: true });
    assert.equal(printed.code, 0, printed.stderr);
    assert.equal(printed.stdout, await readGuide(name), name);
    assert.match(printed.stdout, title, name);
    assert.notEqual(printed.stdout, guide.stdout, name);
    assert.equal(run(root, ['guide', name]).stdout, printed.stdout, name);
  }
  assert.equal(run(root, ['guide', 'format', 'spec'], { raw: true }).code, 2);
  assert.equal(run(root, ['guide', 'OPERATING.md'], { raw: true }).code, 2);
});

test('initialization takes the Style the caller chose and creates only a draft until a separate apply', async (t) => {
  const { directory, root } = await fixture(t);
  const storage = run(root, ['state', 'inspect']);
  assert.equal(storage.code, 0, storage.stderr);
  assert.equal(storage.result.format, 'atlas.state-inspection/1');
  assert.equal(storage.result.state.exists, false);
  assert.ok(!storage.result.state.directory.startsWith(root + path.sep));
  await assert.rejects(fs.stat(storage.result.state.directory), { code: 'ENOENT' });
  const before = run(root, ['validate']);
  assert.equal(before.code, 1);
  assert.equal(before.result.status, 'invalid');
  assert.ok(before.result.diagnostics.some((item) => item.code === 'FILE_MISSING'));
  for (const args of [['init'], ['init', '--id', 'example', '--title', 'Example'], ['init', '--id', 'example', '--title', 'Example', '--style', path.join(directory, 'absent.md')], ['init', '--id', 'Not An ID', '--title', 'Example', '--style', 'concise-subjects']]) {
    const refused = run(root, args);
    assert.equal(refused.code, 2, args.join(' '));
    assert.equal(refused.error.error.code, 'CLI_INVALID_ARGUMENT');
  }
  assert.match(run(root, ['init']).error.error.message, /--style STYLE.*explanatory-perspectives/);
  assert.equal(run(root, ['state']).result.state.exists, false);
  const prepared = run(root, ['init', '--id', 'example', '--title', 'Example', '--style', 'explanatory-subjects']);
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(run(root, ['state']).result.state.exists, true);
  const draft = prepared.result;
  assert.equal(draft.format, 'atlas.draft/1');
  assert.deepEqual(draft.plan.changes.map(change => [change.path, change.action]), [['atlas.json', 'write'], ['style.md', 'write']]);
  assert.deepEqual(Object.keys(draft.plan), ['format', 'status', 'reason', 'baseline', 'validation', 'changes']);
  assert.deepEqual(draft.plan.validation, { status: 'ready', identity: draft.plan.validation.identity, diagnostics: [] });
  assert.deepEqual(draft.bounds, { changes: { available: 2, returned: 2, offset: 0, nextOffset: null }, validation: { available: 0, returned: 0, offset: 0 } });
  const shown = run(root, ['drafts', 'show', draft.id, '--full']);
  assert.equal(shown.result.revision, draft.revision);
  assert.equal(shown.result.plan.changes.find(change => change.path === 'style.md').after, getStyle('explanatory-subjects').content);
  const listed = run(root, ['drafts']);
  assert.deepEqual(Object.keys(listed.result), ['format', 'drafts', 'unreadable']);
  assert.equal(listed.result.drafts[0].id, draft.id);
  assert.equal(listed.result.drafts[0].baseline, draft.plan.baseline.identity);
  const applied = run(root, ['apply', draft.id, '--revision', draft.revision]);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.status, 'complete');
  const validation = run(root, ['validate']);
  assert.equal(validation.code, 0);
  assert.equal(validation.result.status, 'ready');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8')), { format: 'atlas/1.2', id: 'example', title: 'Example', trees: [] });
  assert.equal(run(root, ['inspect', 'style']).result.record.title, getStyle('explanatory-subjects').title);
  // A completed apply removes its journal, so nothing is left to list or to recover.
  assert.deepEqual(run(root, ['recover']).result, { format: 'atlas.transactions/1', transactions: [], unreadable: [] });
  const finished = run(root, ['recover', applied.result.transaction]);
  assert.equal(finished.code, 1);
  assert.deepEqual(finished.error.error, { code: 'NOT_FOUND', message: 'Saved state does not exist.' });
  const again = run(root, ['init', '--id', 'example', '--title', 'Example', '--style', 'concise-subjects']);
  assert.equal(again.code, 1);
  assert.equal(again.error.error.code, 'ALREADY_EXISTS');
});

test('initialization adopts a complete custom Style from a file and keeps an incomplete one from being applied', async (t) => {
  const { directory, root } = await fixture(t);
  const custom = path.join(directory, 'house-style.md'), content = '# House style\n\nOne account for each reader.\n';
  await fs.writeFile(custom, content);
  const prepared = run(root, ['init', '--id', 'house', '--title', 'House', '--style', custom]);
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.equal(run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision]).result.status, 'complete');
  assert.equal(await fs.readFile(path.join(root, 'style.md'), 'utf8'), content);
  const other = path.join(directory, 'other');
  await fs.mkdir(other);
  await fs.writeFile(custom, 'A Style without a title.\n');
  const incomplete = run(other, ['init', '--id', 'other', '--title', 'Other', '--style', custom]);
  assert.equal(incomplete.code, 1);
  assert.equal(incomplete.result.plan.status, 'invalid');
  assert.ok(incomplete.result.plan.validation.diagnostics.some(item => item.path === 'style.md'));
  const refused = run(other, ['apply', incomplete.result.id, '--revision', incomplete.result.revision]);
  assert.equal(refused.code, 1);
  assert.equal(refused.error.error.code, 'INVALID_CANDIDATE');
  assert.deepEqual(await fs.readdir(other), []);
});

test('persisted drafts retain their baseline and stale apply preserves intervening changes', async (t) => {
  const { root } = await fixture(t);
  initialize(root);
  const a = run(root, ['prepare', '-'], { input: JSON.stringify(await manifestChange(root, 'First')) });
  const b = run(root, ['prepare', '-'], { input: JSON.stringify(await manifestChange(root, 'Second')) });
  assert.equal(a.code, 0, a.stderr); assert.equal(b.code, 0, b.stderr);
  assert.equal(a.result.plan.baseline.identity, b.result.plan.baseline.identity);
  assert.equal(run(root, ['review', b.result.id]).result.draft.stale, false);
  assert.equal(run(root, ['apply', a.result.id, '--revision', a.result.revision]).code, 0);
  const stale = run(root, ['apply', b.result.id, '--revision', b.result.revision]);
  assert.equal(stale.code, 3);
  assert.equal(stale.error.error.code, 'STALE');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8')).title, 'First');
  assert.equal(run(root, ['review', b.result.id]).result.draft.stale, true);
  assert.equal(run(root, ['drafts', 'show', b.result.id]).result.revision, b.result.revision);
  const deleted = run(root, ['drafts', 'delete', b.result.id, '--revision', b.result.revision]);
  assert.equal(deleted.code, 0);
  assert.equal(deleted.result.status, 'deleted');
});

test('invalid candidate stays inspectable and cannot be applied', async (t) => {
  const { root } = await fixture(t);
  initialize(root);
  const before = await fs.readFile(path.join(root, 'atlas.json'), 'utf8');
  for (const request of [{ reason: 'Invalid proposal', styleChange: true, changes: [] }, { reason: 'Invalid proposal', sourcePreconditions: [], changes: [] }]) {
    const refused = run(root, ['prepare', '-'], { input: JSON.stringify(request) });
    assert.equal(refused.code, 2);
    assert.equal(refused.error.error.code, 'INVALID_REQUEST');
  }
  const prepared = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'Invalid proposal', changes: [{ path: 'atlas.json', content: '{}' }] }) });
  assert.equal(prepared.code, 1);
  assert.equal(prepared.result.plan.status, 'invalid');
  assert.ok(prepared.result.plan.validation.diagnostics.length);
  assert.equal(prepared.result.bounds.validation.available, prepared.result.plan.validation.diagnostics.length);
  assert.deepEqual(run(root, ['drafts', 'show', prepared.result.id]).result.plan.validation, prepared.result.plan.validation);
  const reviewed = run(root, ['review', prepared.result.id]);
  assert.equal(reviewed.code, 1);
  assert.equal(reviewed.result.status, 'unavailable');
  assert.ok(reviewed.result.effects.diagnostics.after.length);
  assert.deepEqual(reviewed.result.draft.diagnostics, prepared.result.plan.validation.diagnostics);
  const applied = run(root, ['apply', prepared.result.id, '--revision', prepared.result.revision]);
  assert.equal(applied.code, 1);
  assert.equal(applied.error.error.code, 'INVALID_CANDIDATE');
  assert.equal(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'), before);
});

test('config prints immutable absolute scope without writing host configuration', async (t) => {
  const { root, directory } = await fixture(t);
  const config = run(root, ['config'], { grants: [directory, directory] });
  assert.equal(config.code, 0);
  assert.deepEqual(Object.keys(config.result), ['mcpServers']);
  const server = config.result.mcpServers.atlas;
  assert.equal(server.command, process.execPath);
  assert.ok(path.isAbsolute(server.args[0]));
  assert.equal(server.args[0], fileURLToPath(new URL('../../agent/src/server.mjs', import.meta.url)));
  assert.deepEqual(server.args.slice(1), ['--root', root, '--allow-source-root', directory]);
  assert.equal(server.env.ATLAS_STATE_HOME, process.env.ATLAS_STATE_HOME);
  const elsewhere = spawnSync(process.execPath, [cli, '--root', root, '--state-home', path.join(directory, 'state'), 'config'], { encoding: 'utf8' });
  assert.equal(JSON.parse(elsewhere.stdout).mcpServers.atlas.env.ATLAS_STATE_HOME, path.join(directory, 'state'));
  assert.deepEqual(await fs.readdir(root), []);
  const override = run(root, ['route', '-'], { input: JSON.stringify({ point: 'purpose', root: directory }) });
  assert.equal(override.code, 2);
});

test('a change readers would not read back is refused before a draft exists, and so are ownership metadata that is not JSON', async t => {
  const { root } = await fixture(t);
  assert.deepEqual(run(root, ['validate']).result.diagnostics.map(item => [item.code, item.path]), [['FILE_MISSING', 'atlas.json']], 'a missing atlas.json is reported once');
  initialize(root);
  const style = await fs.readFile(path.join(root, 'style.md'), 'utf8');
  const large = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'Too large.', changes: [{ path: 'style.md', content: `${style}${'x'.repeat(2 * 1024 * 1024)}\n` }] }) });
  assert.deepEqual([large.code, large.result, large.error.error], [1, null, { code: 'LIMIT_EXCEEDED', message: 'A changed file exceeds 2 MiB (2097152 bytes).' }]);
  const check = `---\n${JSON.stringify({ id: 'keep', status: 'active', level: 'required' })}\n---\n# Keep\n\n## Requirement\n\nKeep it.\n\n## Verification\n\nRead it.\n\n## Failure\n\nReject it.\n`;
  const alias = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'An alias.', changes: [{ path: '.checks/keep.md', content: check }, { path: '.checks/Keep.md', content: check }] }) });
  assert.deepEqual([alias.code, alias.error.error.code, alias.error.error.diagnostics.map(item => [item.code, item.path])], [2, 'INVALID_REQUEST', [['PATH_ALIAS', '.checks/Keep.md']]]);
  assert.equal(alias.error.error.message, 'The change writes what a reader would not read back: .checks/Keep.md (PATH_ALIAS).');
  const colon = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'A colon.', changes: [{ path: '.checks/a:b.md', content: style }] }) });
  assert.deepEqual([colon.code, colon.error.error], [2, { code: 'UNSAFE_PATH', message: 'A change needs a normalized relative record path.' }]);
  assert.deepEqual(run(root, ['drafts']).result.drafts, [], 'nothing refused was saved');
  const state = run(root, ['state']).result.state.directory;
  await fs.writeFile(path.join(state, 'owner.json'), '{');
  for (const args of [['state'], ['drafts']]) {
    const refused = run(root, args);
    assert.deepEqual([refused.code, refused.error.error], [1, { code: 'STATE_OWNER', message: 'Private state has invalid ownership metadata.' }], args.join(' '));
  }
});

test('a state location the Library refuses is refused by every command that keeps state or reads sources, before it reads', async t => {
  const { directory } = await fixture(t);
  const root = path.join(directory, 'notes');
  await fs.cp(fileURLToPath(new URL('../../../examples/offline-notes', import.meta.url)), root, { recursive: true });
  assert.equal(run(root, ['candidate']).code, 0);
  const under = home => (args, cwd = directory) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15000, env: { ...process.env, ATLAS_STATE_HOME: home } });
    return { code: result.status, result: result.stdout.startsWith('{') ? JSON.parse(result.stdout) : null, error: result.stderr ? JSON.parse(result.stderr) : null };
  };
  const relative = under('state');
  // Three state homes the Library refuses: a relative one, one whose path runs through a regular file, one inside the Atlas.
  await fs.writeFile(path.join(directory, 'a-file'), '');
  const homes = [[relative, { code: 'INVALID_STATE_HOME', message: 'ATLAS_STATE_HOME must be an absolute directory.' }],
    [under(path.join(directory, 'a-file', 'state')), { code: 'UNSAFE_STATE', message: 'Private state requires regular directories without symbolic links.' }],
    [under(path.join(root, 'state')), { code: 'UNSAFE_STATE', message: 'Private state must be outside the Atlas.' }]];
  for (const [launch, refusal] of homes) {
    for (const args of [['stale'], ['read-source', 'trees/product/tree.json'], ['stamp', '--all'], ['validate', '--from', '.atlas-candidate'], ['state'], ['drafts'], ['recover'], ['config'],
      ['init', '--id', 'other', '--title', 'Other', '--style', 'concise-subjects'], ['candidate'], ['export', path.join(directory, 'site'), '--all']]) {
      const refused = launch(['--root', root, ...args]);
      assert.deepEqual([refused.code, refused.result, refused.error?.error], [1, null, refusal], `${refusal.message} ${args.join(' ')}`);
    }
    for (const args of [['config', root], ['open', root, '--no-browser']]) assert.deepEqual(launch(args).error?.error, refusal, `${refusal.message} ${args.join(' ')}`);
    for (const args of [['outline'], ['validate']]) assert.equal(launch(['--root', root, ...args]).code, 0, `${refusal.message} ${args.join(' ')}`);
  }
  await assert.rejects(fs.stat(path.join(root, 'state')), { code: 'ENOENT' }, 'nothing was created');
  // What reads only the Atlas needs no state location; --state-home resolves a relative path from the working directory.
  for (const args of [['outline'], ['validate'], ['inspect', 'point', 'sync-policy']]) assert.equal(relative(['--root', root, ...args]).code, 0, args.join(' '));
  assert.equal(relative(['locate', root]).code, 0);
  const resolved = relative(['--root', root, '--state-home', 'elsewhere', 'config']);
  assert.equal(resolved.result.mcpServers.atlas.env.ATLAS_STATE_HOME, path.join(await fs.realpath(directory), 'elsewhere'));
});

test('one limit on source grants, of distinct directories with the Atlas root, in each form', async t => {
  const { directory, root } = await fixture(t);
  const grants = count => Array.from({ length: count }, (_, index) => ['--allow-source-root', path.join(directory, `grant-${index}`)]).flat();
  const limit = { code: 'CLI_INVALID_ARGUMENT', message: 'At most 100 distinct source roots, including the Atlas root, may be granted.' };
  assert.equal(spawnSync(process.execPath, [cli, '--root', root, ...grants(99), 'config'], { encoding: 'utf8' }).status, 0, '99 and the Atlas root');
  const over = spawnSync(process.execPath, [cli, '--root', root, ...grants(100), 'config'], { encoding: 'utf8' });
  assert.deepEqual([over.status, JSON.parse(over.stderr).error], [2, limit]);
  const repeated = spawnSync(process.execPath, [cli, '--root', root, ...Array.from({ length: 150 }, () => ['--allow-source-root', directory]).flat(), 'config'], { encoding: 'utf8' });
  assert.deepEqual([repeated.status, JSON.parse(repeated.stdout).mcpServers.atlas.args.slice(-2)], [0, ['--allow-source-root', directory]], 'a directory given many times is one grant');
  // The project form grants the project too: here the Atlas is the project, so 99 more are the limit.
  assert.equal(spawnSync(process.execPath, [cli, 'config', root, ...grants(99)], { encoding: 'utf8' }).status, 0);
  const project = spawnSync(process.execPath, [cli, 'config', root, ...grants(100)], { encoding: 'utf8' });
  assert.deepEqual([project.status, JSON.parse(project.stderr).error], [2, limit]);
  // A grant the MCP server would refuse is refused at launch by every command, so config never writes one.
  const long = path.join(directory, 'a'.repeat(4096));
  const scope = { code: 'INVALID_SCOPE', message: 'Source grants must be directory paths of at most 4096 characters, without NUL characters.' };
  for (const args of [['--root', root, '--allow-source-root', long, 'inspect'], ['--root', root, '--allow-source-root', long, 'stale'], ['--root', root, '--allow-source-root', long, 'config'],
    ['--root', root, '--allow-source-root', long, 'mcp'], ['config', root, '--allow-source-root', long], ['open', root, '--no-browser', '--allow-source-root', long]]) {
    const refused = spawnSync(process.execPath, [cli, ...args], { input: '', encoding: 'utf8' });
    assert.deepEqual([refused.status, refused.stdout, JSON.parse(refused.stderr).error], [1, '', scope], args.join(' ').replace(long, 'LONG'));
  }
  // A grant is measured as it is used and as config writes it: resolved from the working directory.
  const short = 'a'.repeat(4096 - directory.length), dotted = `${'./'.repeat(2100)}x`;
  assert.ok(short.length <= 4096 && path.resolve(directory, short).length > 4096 && dotted.length > 4096);
  const resolvedLong = spawnSync(process.execPath, [cli, '--root', root, '--allow-source-root', short, 'config'], { cwd: directory, encoding: 'utf8' });
  assert.deepEqual([resolvedLong.status, JSON.parse(resolvedLong.stderr).error], [1, scope]);
  const resolvedShort = spawnSync(process.execPath, [cli, '--root', root, '--allow-source-root', dotted, 'config'], { cwd: directory, encoding: 'utf8' });
  assert.deepEqual([resolvedShort.status, JSON.parse(resolvedShort.stdout).mcpServers.atlas.args.slice(-2)], [0, ['--allow-source-root', path.join(directory, 'x')]]);
  const blank = spawnSync(process.execPath, [cli, '--root', root, '--allow-source-root', '   ', 'inspect'], { encoding: 'utf8' });
  assert.deepEqual([blank.status, JSON.parse(blank.stderr).error.code], [2, 'CLI_INVALID_ARGUMENT']);
});

test('mcp command emits protocol output without a CLI banner', async (t) => {
  const { root } = await fixture(t);
  const response = run(root, ['mcp'], { input: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cli-test', version: '1' } },
  }) + '\n' });
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.result.jsonrpc, '2.0');
  assert.equal(response.result.id, 1);
  assert.equal(response.result.result.serverInfo.name, 'atlas');
});

test('CLI application and discard require the exact saved revision from review', async t => {
  const { root } = await fixture(t);
  const prepared = run(root, ['init', '--id', 'reviewed', '--title', 'Reviewed Atlas', '--style', 'concise-synthesis']).result;
  assert.equal(run(root, ['apply', prepared.id]).code, 2);
  const stale = run(root, ['apply', prepared.id, '--revision', '0'.repeat(64)]);
  assert.equal(stale.code, 3);
  assert.deepEqual(stale.error.error, { code: 'STALE_DRAFT', message: 'The draft is not at that revision; review it and give its exact revision.' });
  assert.deepEqual(await fs.readdir(root), []);
  // A draft that creates the Atlas is reviewed like any other: everything in it is new.
  const reviewed = run(root, ['review', prepared.id]);
  assert.equal(reviewed.code, 0, reviewed.stderr);
  assert.deepEqual([reviewed.result.status, reviewed.result.draft.revision], ['ready', prepared.revision]);
  assert.deepEqual(reviewed.result.effects.changedManifest, { title: { before: null, after: 'Reviewed Atlas' }, id: { before: null, after: 'reviewed' }, added: [], removed: [] });
  assert.deepEqual(reviewed.result.effects.changedStyle, { before: null, after: { title: getStyle('concise-synthesis').title, path: 'style.md' } });
  assert.equal(reviewed.result.effects.limits.at(-1), 'There is no Atlas before this draft, so every record in it is new.');
  const applied = run(root, ['apply', prepared.id, '--revision', prepared.revision]);
  assert.deepEqual([applied.code, applied.result.status, applied.result.draft], [0, 'complete', 'removed']);
  assert.deepEqual(run(root, ['drafts']).result.drafts, [], 'a completed apply removes its draft');
  assert.equal(run(root, ['review', prepared.id]).error.error.code, 'NOT_FOUND');
  assert.equal(run(root, ['drafts', 'delete', prepared.id, '--revision', prepared.revision]).error.error.code, 'NOT_FOUND');
  const discarded = run(root, ['prepare', '-'], { input: JSON.stringify(await manifestChange(root, 'Discarded')) }).result;
  const elsewhere = run(root, ['drafts', 'delete', discarded.id, '--revision', '0'.repeat(64)]);
  assert.deepEqual([elsewhere.code, elsewhere.error.error], [3, { code: 'STALE_DRAFT', message: 'The draft is not at that revision; load it and give its exact revision.' }]);
  assert.equal(run(root, ['drafts', 'delete', discarded.id, '--revision', discarded.revision]).result.status, 'deleted');
});

test('an unfinished apply holds every apply until recover rolls it back, and the lists name each file they cannot read', async t => {
  const { root } = await fixture(t);
  initialize(root);
  const state = run(root, ['state']).result.state.directory;
  const draft = run(root, ['prepare', '-'], { input: JSON.stringify(await manifestChange(root, 'Held')) }).result;
  // What an apply leaves when it stops before its first write, and two files that hold no JSON.
  await fs.mkdir(path.join(state, 'transactions'), { recursive: true });
  await fs.writeFile(path.join(state, 'transactions/left-over.json'), JSON.stringify({ format: 'atlas.transaction/1', id: 'left-over', phase: 'interrupted', createdAt: '2026-11-15T00:00:00.000Z',
    baseline: draft.plan.baseline.identity, result: draft.plan.validation.identity, changes: [], written: [], error: { code: 'EACCES', message: 'Permission denied.' } }));
  await fs.writeFile(path.join(state, 'transactions/torn.json'), '{');
  await fs.writeFile(path.join(state, 'drafts/torn.json'), '{');
  const torn = { file: 'torn.json', code: 'INVALID_STATE', message: 'Saved state is malformed.' };
  const drafts = run(root, ['drafts']);
  assert.deepEqual([drafts.code, drafts.result.drafts.map(item => item.id), drafts.result.unreadable], [0, [draft.id], [torn]]);
  const transactions = run(root, ['recover']);
  assert.deepEqual([transactions.code, transactions.result.transactions.map(item => [item.id, item.phase]), transactions.result.unreadable], [0, [['left-over', 'interrupted']], [torn]]);
  const held = run(root, ['apply', draft.id, '--revision', draft.revision]);
  assert.deepEqual([held.code, held.error.error], [3, { code: 'LOCKED', message: 'Interrupted transaction left-over needs recovery.' }]);
  const recovered = run(root, ['recover', 'left-over']);
  assert.deepEqual([recovered.code, recovered.result.status, recovered.result.baselineRestored], [0, 'rolled-back', true]);
  const unreadable = run(root, ['apply', draft.id, '--revision', draft.revision]);
  assert.deepEqual([unreadable.code, unreadable.error.error], [1, { code: 'INVALID_STATE', message: 'Transaction journal torn cannot be read: Saved state is malformed.' }]);
  await fs.rm(path.join(state, 'transactions/torn.json'));
  const applied = run(root, ['apply', draft.id, '--revision', draft.revision]);
  assert.deepEqual([applied.code, applied.result.status], [0, 'complete']);
  // A journal is kept only while its transaction is unfinished: the rolled-back one went with its recovery.
  assert.deepEqual(run(root, ['recover']).result, { format: 'atlas.transactions/1', transactions: [], unreadable: [] });
  const gone = run(root, ['recover', 'left-over']);
  assert.deepEqual([gone.code, gone.error.error], [1, { code: 'NOT_FOUND', message: 'Saved state does not exist.' }]);
});

test('CLI review reads a draft that repairs an Atlas that does not validate like any other', async t => {
  const { root } = await fixture(t);
  initialize(root);
  const tree = { id: 'notes', title: 'Notes', scope: 'What the notes hold.', base: 'notes-base', children: [{ point: 'notes-kept' }] };
  const point = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'atlas.json'), 'utf8'));
  const grown = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'Add the notes', changes: [
    { path: 'atlas.json', content: `${JSON.stringify({ ...manifest, trees: ['trees/notes'] }, null, 2)}\n` },
    { path: 'trees/notes/tree.json', content: `${JSON.stringify(tree, null, 2)}\n` },
    { path: 'trees/notes/points/base.md', content: point({ id: 'notes-base' }, 'Notes are kept', 'Every note is kept.') },
    { path: 'trees/notes/points/kept.md', content: point({ id: 'notes-kept', type: 'decision', status: 'selected' }, 'A note is kept in its folder', 'Each note has a folder.') },
  ] }) }).result;
  assert.equal(run(root, ['apply', grown.id, '--revision', grown.revision]).result.status, 'complete');
  await fs.writeFile(path.join(root, 'trees/notes/points/kept.md'), point({ id: 'notes-kept', type: 'decision', status: 'perhaps' }, 'A note is kept in its folder', 'Each note has a folder.'));
  assert.equal(run(root, ['validate']).result.status, 'invalid');
  const repair = run(root, ['prepare', '-'], { input: JSON.stringify({ reason: 'Restore the note, and say where it lives', changes: [
    { path: 'trees/notes/points/kept.md', content: point({ id: 'notes-kept', type: 'decision', status: 'selected' }, 'A note is kept in its own folder', 'Each note has a folder.') },
  ] }) });
  assert.equal(repair.result.plan.status, 'ready', repair.stdout);
  const reviewed = run(root, ['review', repair.result.id]);
  assert.equal(reviewed.code, 0, reviewed.stderr);
  assert.equal(reviewed.result.status, 'ready');
  assert.deepEqual(reviewed.result.effects.points.map(entry => [entry.id, entry.changes, entry.above]), [['notes-kept', ['decision-status', 'title'], ['notes-base']]],
    'the record the Atlas before held is read as it was, so the repair reads as what it changes');
  const full = run(root, ['review', repair.result.id, '--full']).result.effects;
  assert.deepEqual(full.changedPoints.map(entry => [entry.before.status, entry.after.status]), [['perhaps', 'selected']]);
  assert.deepEqual(full.review.before.points.map(entry => entry.record.id), ['notes-kept', 'notes-base']);
  assert.ok(reviewed.result.effects.limits.includes('The Atlas before this draft does not validate. Its records are read as far as their files allow, and the records that mentioned them there are not read.'));
  assert.equal(run(root, ['apply', repair.result.id, '--revision', repair.result.revision]).result.draft, 'removed');
  assert.equal(run(root, ['validate']).result.status, 'ready');
});
