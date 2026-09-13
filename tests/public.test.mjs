import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateFixtureManifest } from '../library/src/fixtures.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('published fixture matrix retains its complete declared outcomes', () => {
  const result = validateFixtureManifest(path.join(root, 'spec/examples/manifest.json'));
  assert.equal(result.every(item => item.pass), true, JSON.stringify(result.filter(item => !item.pass)));
});
test('packaged schemas and guides retain canonical source bytes', () => {
  for (const name of fs.readdirSync(path.join(root, 'library/schemas'))) assert.deepEqual(fs.readFileSync(path.join(root, 'library/schemas', name)), fs.readFileSync(path.join(root, 'spec/schemas', name)), name);
  const map = JSON.parse(fs.readFileSync(path.join(root, 'apps/agent/guides/source-owners.json')));
  for (const [guide, owner] of Object.entries(map.owners)) {
    const bytes = fs.readFileSync(path.join(root, 'apps/agent/guides', guide));
    assert.equal(owner.owner, `spec/${guide}`);
    assert.equal(owner.sha256, hash(bytes));
    assert.deepEqual(bytes, fs.readFileSync(path.join(root, owner.owner)));
  }
});


test('release metadata identifies one finished version', () => {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  for (const name of ['package.json', 'library/package.json', 'apps/cli/package.json', 'apps/agent/package.json', 'apps/editor/package.json', 'apps/portal/package.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(root, name))).version, version, name);
  assert.equal(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').match(/^## (.+)$/mu)[1], version);
});
