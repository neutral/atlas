import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateAtlas, validateFixtureManifest } from '../src/index.mjs';

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

test('published CLI resolves from the isolated tools package', () => {
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'bin/atlas-validate.mjs'),
    path.join(examples, 'valid/minimal'),
    '--json',
  ], { encoding: 'utf8', cwd: repositoryRoot });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
});
