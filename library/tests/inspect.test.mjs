import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectPoint, validateAtlas } from '../src/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const examples = path.join(root, 'spec/examples');
const fixture = (name) => path.join(examples, name);
const bin = path.join(root, 'apps/cli/bin/atlas-inspect.mjs');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });

test('nested starts retain the discovered Atlas root as the source base', () => {
  const atlasPath = fixture('valid/cross-map');
  const expected = inspectPoint(atlasPath, 'edge-authentication');
  for (const start of ['atlas.md', 'maps/architecture', 'maps/operations/points/edge-authentication.md']) {
    assert.deepEqual(inspectPoint(path.join(atlasPath, start), 'edge-authentication'), expected);
  }
  assert.ok(fs.existsSync(path.join(expected.atlasRoot, expected.point.anchorPath)));
});

test('inspection preserves an exact Point across Maps with its evidence and provenance', () => {
  const atlasPath = fixture('valid/cross-map');
  const result = inspectPoint(atlasPath, 'edge-authentication');
  const model = validateAtlas(atlasPath).normalized;
  assert.equal(result.status, 'found');
  assert.equal(result.atlasRoot, atlasPath);
  assert.deepEqual(result.point, model.points.find((point) => point.id === 'edge-authentication'));
  assert.equal(result.point.records.length, 2);
  assert.equal(result.point.relations[0].extensions['x-origin'], 'architecture-review');
  assert.equal(result.point.relations[0].targetPoint, 'rotate-edge-keys');
  assert.deepEqual(result.resources, model.atlas.resources);
  assert.equal(result.point.records[0].references[0].uri, 'https://example.com/security-model');
  for (const map of result.maps) {
    const source = model.maps.find((candidate) => candidate.id === map.id);
    assert.equal(map.question, source.question);
    assert.equal(map.path, source.path);
    for (const area of map.areas) assert.deepEqual(area, source.areas.find((candidate) => candidate.id === area.id));
  }
  assert.equal(result.normalized, undefined);
  assert.equal(result.validation.normalized, undefined);
  assert.match(result.limits.join('\n'), /no publication profile is applied/u);
  assert.match(result.limits.join('\n'), /Checks.*omitted/u);
});

test('inspection never assembles invalid input, including faults outside the requested Point', (t) => {
  const atlasPath = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-inspect-'));
  t.after(() => fs.rmSync(atlasPath, { recursive: true, force: true }));
  fs.cpSync(fixture('valid/cross-map'), atlasPath, { recursive: true });
  const unrelatedPath = path.join(atlasPath, 'maps/operations/points/rotate-edge-keys.md');
  const unrelated = fs.readFileSync(unrelatedPath, 'utf8');
  fs.writeFileSync(unrelatedPath, unrelated.replace(/(---\n[\s\S]*?\n---)[\s\S]*/u, '$1\n# Empty\n'));
  for (const [target, pointId] of [[atlasPath, 'edge-authentication'], [fixture('invalid/empty-anchor-body'), 'service-boundary']]) {
    const result = inspectPoint(target, pointId);
    assert.equal(result.status, 'invalid');
    assert.equal(result.validation.valid, false);
    assert.ok(result.validation.diagnostics.length > 0);
    assert.equal(result.point, undefined);
    assert.equal(result.maps, undefined);
    assert.equal(result.resources, undefined);
  }
});

test('inspection retains direct and registered URI bases without importing source content', () => {
  const atlasPath = fixture('valid/external-local');
  const result = inspectPoint(atlasPath, 'service-boundary');
  const expected = validateAtlas(atlasPath).normalized.points[0];
  assert.equal(result.status, 'found');
  assert.deepEqual(result.point, expected);
  assert.ok(result.validation.diagnosticCounts.information > 0);
  assert.equal(result.validation.diagnostics, undefined);
  assert.match(result.limits.join('\n'), /atlas-validate --json/u);
  assert.match(result.limits.join('\n'), /Registered URIs are based at atlas.md/u);
});

test('discovery failure retains incomplete diagnostics without an assembled Point', (t) => {
  const atlasPath = fixture('valid/minimal');
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (path.resolve(target) === atlasPath) {
      const error = new Error('Inspection denied');
      error.code = 'EACCES';
      throw error;
    }
    return original.call(fs, target, ...args);
  });
  const result = inspectPoint(atlasPath, 'service-boundary');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.validation.complete, false);
  assert.equal(result.validation.diagnosticCounts.error, 1);
  assert.deepEqual(result.validation.diagnostics.map((diagnostic) => diagnostic.code), ['atlas.processing.io']);
  assert.equal(result.point, undefined);
});

test('local inspection includes the whole Point without silently applying a publication selection', () => {
  const atlasPath = fixture('valid/publication-profile');
  const model = validateAtlas(atlasPath).normalized;
  const result = inspectPoint(atlasPath, 'service-boundary');
  assert.equal(result.status, 'found');
  assert.deepEqual(result.point, model.points.find((point) => point.id === 'service-boundary'));
  assert.equal(result.publicationProfiles, undefined);
  assert.match(result.limits.join('\n'), /no publication profile/u);
});

test('similar or partial ids do not select a Point and failed lookups expose no unrelated model', () => {
  const atlasPath = fixture('valid/similar-distinct-points');
  assert.equal(inspectPoint(atlasPath, 'edge-cache-policy').point.id, 'edge-cache-policy');
  for (const id of ['cache-policy', 'Edge-cache-policy', ' edge-cache-policy']) {
    const result = inspectPoint(atlasPath, id);
    assert.equal(result.status, 'not-found');
    assert.equal(result.validation.valid, true);
    assert.equal(result.point, undefined);
    assert.equal(result.resources, undefined);
  }
});

test('CLI is deterministic, records the requested revision, and distinguishes failed lookups', () => {
  const args = [fixture('valid/cross-map'), '--point', 'edge-authentication', '--specification-revision', 'test-revision'];
  const first = run(...args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, run(...args).stdout);
  assert.equal(JSON.parse(first.stdout).validation.specificationRevision, 'test-revision');
  const absent = run(fixture('valid/cross-map'), '--point', 'absent');
  assert.equal(absent.status, 3, absent.stderr);
  assert.equal(JSON.parse(absent.stdout).status, 'not-found');
  const invalid = run(fixture('invalid/empty-anchor-body'), '--point', 'service-boundary');
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).status, 'invalid');
});

test('CLI rejects incomplete, duplicate, and unsupported arguments', () => {
  for (const args of [[], ['sample-atlas'], ['sample-atlas', '--point'],
    ['sample-atlas', '--point', 'one', '--point', 'two'],
    ['sample-atlas', 'other-atlas', '--point', 'one'],
    ['sample-atlas', '--point', 'one', '--profile', 'public']]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.trim());
  }
  assert.equal(run('--help').status, 0);
});
