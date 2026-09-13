import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAtlas, prepareAtlasChange, applyAtlasChange } from 'atlas-reference-validator';

const bin = fileURLToPath(new URL('../bin/atlas-author.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../../../spec/examples/valid/cross-map', import.meta.url));
const anchor = 'maps/architecture/points/edge-authentication.md';
function project(t) {
  const repositoryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-author-cli-')));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  const atlasRoot = path.join(repositoryRoot, 'atlas');
  fs.cpSync(fixture, atlasRoot, { recursive: true });
  return { repositoryRoot, atlasRoot, requestPath: path.join(repositoryRoot, 'request.json'),
    planPath: path.join(repositoryRoot, 'plan.json'), recoveryDirectory: path.join(repositoryRoot, 'recovery') };
}
function run(args) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } }); }
function request(p, operations) {
  fs.writeFileSync(p.requestPath, JSON.stringify({ repositoryRoot: p.repositoryRoot, atlasPath: 'atlas',
    expected: { viewDigest: openAtlas(p.atlasRoot).identity.digest }, operations }));
}
const edit = { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: fs.readFileSync(path.join(fixture, anchor), 'utf8').split('---').slice(2).join('---').replace(/^# .+$/mu, '# Reviewed through the public CLI') };
function prepared(p) { return run(['prepare', '--request', p.requestPath, '--plan', p.planPath]); }

test('CLI persists a full portable proposal and applies its exact reviewed effects in a later process', (t) => {
  const p = project(t), original = fs.readFileSync(path.join(p.atlasRoot, anchor));
  request(p, [edit]);
  const result = prepared(p);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout), plan = JSON.parse(fs.readFileSync(p.planPath, 'utf8'));
  assert.equal(receipt.contract, 'atlas.change-plan-file/1');
  assert.equal(receipt.planDigest, plan.digest);
  assert.deepEqual(fs.readFileSync(path.join(p.atlasRoot, anchor)), original, 'Prepare must not edit source.');
  assert.match(plan.changes[0].diff, /Reviewed through the public CLI/u);
  assert.deepEqual(Buffer.from(plan.changes[0].before.bytesBase64, 'base64'), original);
  const applied = run(['apply', '--plan', p.planPath, '--recovery', p.recoveryDirectory]);
  assert.equal(applied.status, 0, applied.stderr);
  const saved = JSON.parse(applied.stdout);
  assert.equal(saved.status, 'applied');
  assert.deepEqual(saved.written, [anchor]);
  assert.equal(saved.recovery.status, 'removed');
  assert.equal(saved.recoveryDirectory, undefined);
  assert.deepEqual(fs.readdirSync(p.recoveryDirectory), []);
  assert.equal(openAtlas(p.atlasRoot).inspectPoint('edge-authentication').point.title, 'Reviewed through the public CLI');
  const repeated = run(['apply', '--plan', p.planPath, '--recovery', p.recoveryDirectory]);
  assert.equal(repeated.status, 2);
  assert.equal(JSON.parse(repeated.stdout).status, 'stale');
});

test('CLI exposes genuine unavailable proposal verification without executing a project command', (t) => {
  const p = project(t), marker = path.join(p.repositoryRoot, 'executed');
  fs.mkdirSync(path.join(p.atlasRoot, '.checks'), { recursive: true });
  fs.writeFileSync(path.join(p.atlasRoot, '.checks/review.md'), '---\n{"type":"check","id":"review","status":"active"}\n---\n\n# Review\n\nReview the source.\n\n## Requirement\n\nReview the source.\n\n## Verification\n\nRun `touch ' + marker + '`.\n\n## Failure\n\nCorrect unsupported claims.\n');
  const catalogPath = path.join(p.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  (catalog.checks ??= []).push({ check: 'review', level: 'required', 'applies-to': ['point-anchor'] });
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  request(p, [edit]);
  assert.equal(prepared(p).status, 0);
  fs.appendFileSync(path.join(p.atlasRoot, anchor), '\nA later working-tree edit.\n');
  const result = run(['evaluate', '--plan', p.planPath, '--actor-kind', 'human', '--actor-id', 'reviewer']);
  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.run.requiredSatisfied, false);
  assert.ok(receipt.run.evaluations.every((entry) => entry.outcome === 'unable'));
  assert.deepEqual(receipt.run.preparedChange, { planDigest: receipt.planDigest, paths: [anchor] });
  assert.equal(fs.existsSync(marker), false);
});

test('CLI inspects exact inactive recovery and discards only the reviewed operation', (t) => {
  const p = project(t), source = fs.readFileSync(path.join(p.atlasRoot, anchor));
  const plan = prepareAtlasChange({ repositoryRoot: p.repositoryRoot, atlasPath: 'atlas',
    expected: { viewDigest: openAtlas(p.atlasRoot).identity.digest }, operations: [edit] });
  const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('Controlled application interruption'); });
  const partial = applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory });
  rename.mock.restore();
  assert.equal(partial.status, 'partial');
  const args = ['--repository', p.repositoryRoot, '--atlas', 'atlas', '--recovery', partial.recoveryDirectory];
  const inspected = run(['recovery-inspect', ...args]);
  assert.equal(inspected.status, 0, inspected.stderr);
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.inactive, true);
  assert.deepEqual(Buffer.from(inspection.files.find((file) => file.path === 'originals/0.bin').bytesBase64, 'base64'), source);
  const stale = run(['recovery-discard', ...args, '--inspected-digest', '0'.repeat(64)]);
  assert.equal(stale.status, 2);
  assert.equal(JSON.parse(stale.stderr).error.code, 'atlas.authoring.stale');
  const discarded = run(['recovery-discard', ...args, '--inspected-digest', inspection.digest]);
  assert.equal(discarded.status, 0, discarded.stderr);
  assert.equal(JSON.parse(discarded.stdout).status, 'discarded');
  assert.deepEqual(fs.readFileSync(path.join(p.atlasRoot, anchor)), source);
  assert.deepEqual(fs.readdirSync(p.recoveryDirectory), []);
});

test('CLI stale apply has zero writes and explicit draft save reports invalid validation', (t) => {
  const p = project(t);
  request(p, [edit]);
  assert.equal(prepared(p).status, 0);
  fs.appendFileSync(path.join(p.atlasRoot, anchor), '\nExternal edit.\n');
  const stale = run(['apply', '--plan', p.planPath, '--recovery', p.recoveryDirectory]);
  assert.equal(stale.status, 2);
  assert.deepEqual(JSON.parse(stale.stdout).written, []);
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
  fs.unlinkSync(p.planPath);
  request(p, [{ type: 'repair-document', path: anchor, text: 'An explicitly retained incomplete draft.\n' }]);
  assert.equal(prepared(p).status, 1);
  const denied = run(['apply', '--plan', p.planPath, '--recovery', p.recoveryDirectory]);
  assert.equal(denied.status, 2);
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
  const saved = run(['apply', '--plan', p.planPath, '--recovery', p.recoveryDirectory, '--draft']);
  assert.equal(saved.status, 1, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).status, 'applied');
  assert.equal(JSON.parse(saved.stdout).validation.valid, false);
});

test('CLI rejects duplicate, unknown, missing, relative, malformed, and symlink input arguments with structured errors', (t) => {
  const p = project(t);
  request(p, [edit]);
  const symlink = path.join(p.repositoryRoot, 'link.json');
  fs.symlinkSync(p.requestPath, symlink);
  const invalidJson = path.join(p.repositoryRoot, 'invalid.json');
  fs.writeFileSync(invalidJson, '{');
  for (const args of [[], ['unknown'], ['prepare'], ['prepare', '--request', p.requestPath, '--plan', p.planPath, '--plan', p.planPath],
    ['prepare', '--request', p.requestPath, '--plan', p.planPath, '--execute'],
    ['prepare', '--request', 'relative.json', '--plan', p.planPath],
    ['prepare', '--request', symlink, '--plan', p.planPath],
    ['prepare', '--request', invalidJson, '--plan', p.planPath]]) {
    const result = run(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.equal(typeof JSON.parse(result.stderr).error.code, 'string');
  }
  assert.equal(fs.existsSync(p.planPath), false);
  assert.equal(run(['--help']).status, 0);
});

test('CLI exclusive plan persistence refuses Atlas, disposable, and authored-source collisions', (t) => {
  const p = project(t);
  request(p, [edit]);
  fs.mkdirSync(path.join(p.repositoryRoot, 'tmp'));
  for (const planPath of [path.join(p.atlasRoot, 'plan.json'), path.join(p.repositoryRoot, 'tmp/plan.json')]) {
    const result = run(['prepare', '--request', p.requestPath, '--plan', planPath]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(fs.existsSync(planPath), false);
  }
  request(p, [{ type: 'resource', action: 'update', id: 'authentication-guide', set: { uri: '../plan.json' } }]);
  const collision = prepared(p);
  assert.equal(collision.status, 2, collision.stderr);
  assert.equal(fs.existsSync(p.planPath), false);
  request(p, [edit]);
  assert.equal(prepared(p).status, 0);
  const bytes = fs.readFileSync(p.planPath);
  assert.equal(prepared(p).status, 2);
  assert.deepEqual(fs.readFileSync(p.planPath), bytes);
});
