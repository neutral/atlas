import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectPoint, validateAtlas, validateFixtureManifest } from '../src/index.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const examples = path.join(repositoryRoot, 'spec/examples');

test('packaged schemas match the published schemas', () => {
  for (const name of [
    'atlas',
    'check-evaluation',
    'check',
    'common',
    'fixture-manifest',
    'frontmatter',
    'map',
    'normalized',
    'point',
    'publication',
    'validation-result',
  ]) {
    assert.equal(
      fs.readFileSync(path.join(packageRoot, `schemas/${name}.schema.json`), 'utf8'),
      fs.readFileSync(path.join(repositoryRoot, `spec/schemas/${name}.schema.json`), 'utf8'),
      name,
    );
  }
});

test('published fixtures match the reference validator', () => {
  const results = validateFixtureManifest(path.join(examples, 'manifest.json'));
  assert.deepEqual(results.filter((result) => !result.pass).map((result) => result.fixture.path), []);
});

test('resolved validation exposes normalized output only for valid input', () => {
  const valid = validateAtlas(path.join(examples, 'valid/publication-profile'));
  const invalid = validateAtlas(path.join(examples, 'invalid/empty-anchor-body'));
  assert.equal(valid.complete, true);
  assert.equal(valid.valid, true);
  assert.ok(valid.normalized);
  assert.equal(invalid.complete, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.normalized, undefined);
});

test('published CLI resolves documented paths from the tools directory', () => {
  const toolsRoot = path.join(repositoryRoot, 'tools');
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'bin/atlas-validate.mjs'),
    '../spec/examples/valid/minimal',
    '--json',
  ], { encoding: 'utf8', cwd: toolsRoot });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);

  const fixtures = spawnSync(process.execPath, [
    path.join(packageRoot, 'bin/atlas-validate.mjs'),
    '--fixtures', '../spec/examples/manifest.json',
    '--json',
  ], { encoding: 'utf8', cwd: toolsRoot });
  assert.equal(fixtures.status, 0, fixtures.stderr);
  const outcomes = JSON.parse(fixtures.stdout).fixtures;
  assert.ok(outcomes.length > 0);
  assert.ok(outcomes.every((fixture) => fixture.pass));
});

test('published Point inspection preserves contexts through the installed command', () => {
  const toolsRoot = path.join(repositoryRoot, 'tools');
  const fixture = path.join(examples, 'valid/cross-map');
  const output = spawnSync(process.execPath, [
    path.join(packageRoot, 'bin/atlas-inspect.mjs'),
    '../spec/examples/valid/cross-map', '--point', 'edge-authentication',
  ], { encoding: 'utf8', cwd: toolsRoot });
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.deepEqual(result, inspectPoint(fixture, 'edge-authentication'));
  assert.equal(result.point.records.length, 2);
  assert.equal(result.resources[0].id, 'authentication-guide');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['atlas-inspect'], 'bin/atlas-inspect.mjs');
});
