import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RESOLVED_PROFILE, STRUCTURAL_PROFILE, validateAtlas } from '../src/index.mjs';
import { parseFrontMatter } from '../src/frontmatter.mjs';

const fixture = fileURLToPath(new URL('../../spec/examples/valid/cross-map/', import.meta.url));

function copyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-format-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  return root;
}

function editHeader(root, relative, edit) {
  const file = path.join(root, relative), parsed = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  edit(parsed.value);
  fs.writeFileSync(file, `---\n${JSON.stringify(parsed.value, null, 2)}\n---\n${parsed.body}`);
}

function sourceFiles(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true })
    .filter(file => fs.lstatSync(path.join(root, file)).isFile()).sort()
    .map(file => [file, fs.readFileSync(path.join(root, file))]));
}

for (const format of [1, 0, 3, '2', undefined]) {
  test(`readers reject unsupported format ${JSON.stringify(format) ?? 'missing'} without rewriting source`, t => {
    const root = copyFixture(t);
    editHeader(root, 'atlas.md', header => {
      if (format === undefined) delete header.format;
      else header.format = format;
    });
    const before = sourceFiles(root);
    for (const profile of [STRUCTURAL_PROFILE, RESOLVED_PROFILE]) {
      const result = validateAtlas(root, { profile });
      assert.equal(result.complete, true);
      assert.equal(result.valid, false);
      assert.equal(result.normalized, undefined);
      assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'atlas.format.unsupported'));
    }
    assert.deepEqual(sourceFiles(root), before);
  });
}

for (const [file, fields] of [
  ['atlas.md', { navigation: [], resources: [] }],
  ['maps/architecture/map.md', { areas: [] }],
  ['maps/architecture/points/edge-authentication.md', { relations: [], references: [], kinds: [] }],
  ['.checks/point-context.md', { level: 'required', 'applies-to': ['point'] }],
]) {
  test(`readers reject obsolete local metadata in ${file} without extracting global data`, t => {
    const root = copyFixture(t);
    editHeader(root, file, header => Object.assign(header, fields));
    const before = sourceFiles(root);
    for (const profile of [STRUCTURAL_PROFILE, RESOLVED_PROFILE]) {
      const result = validateAtlas(root, { profile });
      assert.equal(result.valid, false);
      assert.equal(result.normalized, undefined);
      assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'atlas.frontmatter.schema'));
    }
    assert.deepEqual(sourceFiles(root), before);
  });
}

test('removing an unnecessary predecessor and its connection preserves current Point identity', t => {
  const root = copyFixture(t), connectionsFile = path.join(root, 'connections.json');
  const currentFile = path.join(root, 'maps/architecture/points/edge-authentication.md');
  const predecessorFile = path.join(root, 'maps/architecture/points/retired-boundary.md');
  const currentBytes = fs.readFileSync(currentFile);
  const connections = JSON.parse(fs.readFileSync(connectionsFile, 'utf8'));
  connections.relations.push({ id: 'boundary-replacement', source: 'edge-authentication', type: 'supersedes', target: 'retired-boundary' });
  fs.writeFileSync(connectionsFile, JSON.stringify(connections));
  fs.appendFileSync(currentFile, '\n## Connection: boundary-replacement\n\nThe public boundary replaces the earlier private boundary.\n');
  fs.writeFileSync(predecessorFile, '---\n{"type":"point","record":"anchor","id":"retired-boundary","posture":"asserted","lifecycle":"superseded"}\n---\n\n# Retired boundary\n\nThe private boundary describes the replaced design.\n');
  const retained = validateAtlas(root);
  assert.equal(retained.valid, true, JSON.stringify(retained.diagnostics));
  const retainedPoint = retained.normalized.points.find(point => point.id === 'edge-authentication');
  assert.equal(retainedPoint.relations.find(relation => relation.id === 'boundary-replacement').targetPoint, 'retired-boundary');

  fs.unlinkSync(predecessorFile);
  connections.relations = connections.relations.filter(relation => relation.id !== 'boundary-replacement');
  fs.writeFileSync(connectionsFile, JSON.stringify(connections));
  fs.writeFileSync(currentFile, currentBytes);
  const current = validateAtlas(root);
  assert.equal(current.valid, true, JSON.stringify(current.diagnostics));
  const currentPoint = current.normalized.points.find(point => point.id === 'edge-authentication');
  assert.equal(currentPoint.id, retainedPoint.id);
  assert.equal(currentPoint.anchorPath, retainedPoint.anchorPath);
  assert.equal(currentPoint.lifecycle, retainedPoint.lifecycle);
  assert.deepEqual(currentPoint.relations, retainedPoint.relations.filter(relation => relation.id !== 'boundary-replacement'));
  assert.equal(current.normalized.points.some(point => point.id === 'retired-boundary'), false);
});
