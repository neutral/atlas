import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openAtlas } from 'atlas-reference-validator';
import { errorResult, run } from '../src/read-cli.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = path.join(root, 'spec/examples/valid/cross-map');
const bin = path.join(root, 'apps/cli/bin/atlas-read.mjs');
const invoke = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

function output(args, exitCode = 0) {
  const result = invoke(...args);
  assert.equal(result.status, exitCode, `${args.join(' ')}\n${result.stderr}`);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

function copyAtlas(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-read-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const atlasRoot = path.join(directory, 'atlas');
  fs.cpSync(fixture, atlasRoot, { recursive: true });
  return atlasRoot;
}

test('find CLI returns the public result and continues across separate command invocations', () => {
  const args = [fixture, 'find', 'edge', '--type', 'point', '--limit', '1', '--specification-revision', 'observed-revision'];
  const first = output(args);
  assert.deepEqual(first, openAtlas(fixture, { specificationRevision: 'observed-revision' }).find('edge', { types: ['point'], limit: 1 }));
  const second = output([...args, '--cursor', first.nextCursor]);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(output([fixture, 'find', '', '--type', 'map', '--type', 'point']).total, 4);
  assert.equal(output([fixture, 'find', '--', '--help']).status, 'ready');
});

test('find CLI distinguishes ordinary text from explicit FTS expressions and binds continuation to mode', () => {
  const ranked = output([fixture, 'find', 'How does authentication work?', '--mode', 'ranked', '--type', 'point']);
  assert.ok(ranked.items.some(item => item.id === 'edge-authentication'));
  const expression = '"edge" AND "keys"';
  const fts = output([fixture, 'find', expression, '--mode', 'fts', '--type', 'point']);
  assert.deepEqual(fts, openAtlas(fixture).find(expression, { mode: 'fts', types: ['point'] }));
  assert.ok(fts.items.some(item => item.id === 'rotate-edge-keys'));
  assert.ok(fts.items.every(item => item.matches.some(match => match.path && typeof match.excerpt === 'string')));
  const first = output([fixture, 'find', 'edge', '--mode', 'fts', '--type', 'point', '--limit', '1']);
  const crossed = invoke(fixture, 'find', 'edge', '--mode', 'ranked', '--type', 'point', '--cursor', first.nextCursor);
  assert.equal(crossed.status, 2);
  assert.equal(JSON.parse(crossed.stderr).error.code, 'atlas.tools.invalid-cursor');
});

test('document CLI exposes exact raw source, missing paths, and invalid drafts distinctly', (t) => {
  const atlasRoot = copyAtlas(t);
  const raw = output([atlasRoot, 'document', 'atlas.md']);
  assert.equal(raw.status, 'read');
  assert.equal(raw.text, fs.readFileSync(path.join(atlasRoot, 'atlas.md'), 'utf8'));
  assert.equal(output([atlasRoot, 'document', 'absent.md'], 3).status, 'missing');
  fs.writeFileSync(path.join(atlasRoot, 'atlas.md'), 'An unfinished Atlas draft.\n');
  const draft = output([atlasRoot, 'document', 'atlas.md']);
  assert.equal(draft.status, 'read');
  assert.ok(draft.diagnostics.length > 0);
  assert.equal(output([atlasRoot, 'find', 'edge'], 1).status, 'invalid');
  assert.equal(output([atlasRoot, 'source', '--resource', 'authentication-guide'], 2).status, 'unavailable');
});

test('document byte truncation remains explicit without a failure exit', (t) => {
  const atlasRoot = copyAtlas(t);
  fs.writeFileSync(path.join(atlasRoot, 'docs/large.md'), 'a'.repeat(1024 * 1024 + 1));
  const raw = output([atlasRoot, 'document', 'docs/large.md']);
  assert.equal(raw.status, 'truncated');
  assert.equal(Buffer.from(raw.bytesBase64, 'base64').length, 1024 * 1024);
  assert.equal(raw.input.byteLength, 1024 * 1024 + 1);
});

test('source CLI retains Resource bases, direct owners, current identity, and byte limits', () => {
  const registered = output([fixture, 'source', '--resource', 'authentication-guide']);
  const direct = output([fixture, 'source', '--uri', '../../../docs/authentication.md', '--owner', 'maps/architecture/points/edge-authentication.md']);
  assert.equal(registered.contract, 'atlas.source-read/1');
  assert.equal(registered.status, 'read');
  assert.equal(registered.ownerPath, 'atlas.md');
  assert.equal(registered.resource.id, 'authentication-guide');
  assert.equal(direct.ownerPath, 'maps/architecture/points/edge-authentication.md');
  assert.equal(registered.text, direct.text);
  assert.equal(registered.observation.sha256, direct.observation.sha256);
  const prefix = output([fixture, 'source', '--resource', 'authentication-guide', '--max-bytes', '8']);
  assert.equal(prefix.status, 'truncated');
  assert.equal(prefix.observation.byteLength, 8);
  assert.equal(prefix.observation.complete, false);
});

test('source CLI requires explicit external roots and never supplies a network reader', (t) => {
  const atlasRoot = copyAtlas(t);
  const parent = path.dirname(atlasRoot);
  fs.writeFileSync(path.join(parent, 'outside.md'), 'Explicit external source.\n');
  assert.equal(output([atlasRoot, 'source', '--uri', '../outside.md'], 3).status, 'unrequested');
  const allowed = output([atlasRoot, 'source', '--uri', '../outside.md', '--allow-root', parent, '--allow-root', atlasRoot]);
  assert.equal(allowed.status, 'read');
  assert.equal(allowed.text, 'Explicit external source.\n');
  assert.equal(output([atlasRoot, 'source', '--uri', 'https://example.com/source'], 3).status, 'unrequested');
  assert.equal(output([atlasRoot, 'source', '--resource', 'missing-id'], 3).status, 'missing');
  assert.equal(output([atlasRoot, 'source', '--uri', 'docs/absent.md'], 3).status, 'missing');
  fs.writeFileSync(path.join(atlasRoot, 'docs/binary.bin'), Buffer.from([0, 255, 1]));
  assert.equal(output([atlasRoot, 'source', '--uri', 'docs/binary.bin'], 3).status, 'unsupported');
});

test('compare CLI preserves both views and refuses normalized comparison of invalid input', (t) => {
  const other = copyAtlas(t);
  const file = path.join(other, 'maps/architecture/points/edge-authentication.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# Authenticate at the edge', '# Authenticate at the gateway'));
  const result = output([fixture, 'compare', other, '--specification-revision', 'comparison-revision']);
  assert.equal(result.status, 'compared');
  assert.equal(result.before.specificationRevision, 'comparison-revision');
  assert.equal(result.after.specificationRevision, 'comparison-revision');
  assert.deepEqual(result.records.map((record) => record.key), ['point:edge-authentication']);
  fs.writeFileSync(file, 'Unfinished draft.\n');
  assert.equal(output([fixture, 'compare', other], 2).status, 'unavailable');
});

test('invalid arguments and stale cursors emit structured stderr without stdout', (t) => {
  const atlasRoot = copyAtlas(t);
  const invalid = [
    [], [atlasRoot], [atlasRoot, 'inspect'], [atlasRoot, 'find'],
    [atlasRoot, 'find', 'edge', 'extra'], [atlasRoot, 'find', 'edge', '--type', 'workflow'],
    [atlasRoot, 'find', 'edge', '--limit', '0'], [atlasRoot, 'find', 'edge', '--limit', '201'],
    [atlasRoot, 'find', 'edge', '--limit', '1.5'], [atlasRoot, 'find', 'edge', '--limit', '1', '--limit', '2'],
    [atlasRoot, 'find', 'edge', '--mode', 'semantic'], [atlasRoot, 'find', 'edge', '--mode', 'fts', '--mode', 'ranked'],
    [atlasRoot, 'find', 'edge', '--limit'], [atlasRoot, 'find', 'edge', '--profile', 'public'],
    [atlasRoot, 'document', '../outside.md'], [atlasRoot, 'document', 'atlas.md', '--limit', '1'],
    [atlasRoot, 'source'], [atlasRoot, 'source', '--resource', 'one', '--uri', 'docs/file.md'],
    [atlasRoot, 'source', '--resource', 'one', '--owner', 'atlas.md'],
    [atlasRoot, 'source', '--uri', 'docs/file.md', '--allow-root', 'relative'],
    [atlasRoot, 'source', '--uri', 'docs/file.md', '--max-bytes', '9007199254740992'],
    [atlasRoot, 'source', '--uri', 'docs/file.md', '--reader', 'curl'],
    [atlasRoot, 'compare'], [atlasRoot, 'compare', fixture, 'extra'],
    [atlasRoot, 'find', 'edge', '--specification-revision', 'one', '--specification-revision', 'two'],
  ];
  for (const args of invalid) {
    const result = invoke(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
    const error = JSON.parse(result.stderr).error;
    assert.equal(error.code, 'atlas.tools.invalid-argument', args.join(' '));
    assert.ok(error.message.length > 0);
  }
  const { nextCursor } = output([atlasRoot, 'find', 'edge', '--type', 'point', '--limit', '1']);
  fs.writeFileSync(path.join(atlasRoot, 'docs/added.md'), 'Changed inventory.\n');
  const stale = invoke(atlasRoot, 'find', 'edge', '--type', 'point', '--cursor', nextCursor);
  assert.equal(stale.status, 2);
  assert.equal(stale.stdout, '');
  assert.equal(JSON.parse(stale.stderr).error.code, 'atlas.tools.invalid-cursor');
});

test('incomplete observations produce JSON with exit two', async (t) => {
  const atlasRoot = copyAtlas(t);
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (file, ...args) => {
    if (file === atlasRoot) throw Object.assign(new Error('Controlled denied read'), { code: 'EACCES' });
    return lstat.call(fs, file, ...args);
  });
  const messages = [];
  t.mock.method(console, 'log', (message) => messages.push(JSON.parse(message)));
  assert.equal(await run([atlasRoot, 'find', 'edge']), 2);
  assert.equal(messages[0].status, 'incomplete');
  assert.deepEqual(messages[0].items, []);
});

test('source replacement detected during reading exits three instead of reporting success', async (t) => {
  const atlasRoot = copyAtlas(t);
  const target = fs.realpathSync(path.join(atlasRoot, 'docs/authentication.md'));
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (file, options) => {
    const result = stat.call(fs, file, options);
    if (file === target && options?.bigint) return { ...result, ino: result.ino + 1n };
    return result;
  });
  const messages = [];
  t.mock.method(console, 'log', (message) => messages.push(JSON.parse(message)));
  assert.equal(await run([atlasRoot, 'source', '--resource', 'authentication-guide']), 3);
  assert.equal(messages[0].status, 'stale');
});

test('help describes the installed interface and unexpected failures have stable structured errors', () => {
  const help = invoke('--help');
  assert.equal(help.status, 0);
  assert.equal(help.stderr, '');
  assert.match(help.stdout, /atlas-read <atlas-path> source/u);
  assert.match(help.stdout, /never fetch websites or execute commands/u);
  assert.match(help.stdout, /--mode ranked\|fts/u);
  assert.match(help.stdout, /SQLite/u);
  assert.deepEqual(errorResult(new Error('Unexpected failure')), { error: { code: 'atlas.tools.unexpected-error', message: 'Unexpected failure' } });
});
