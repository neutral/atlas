import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { calculateCheckRevision, createEvaluatorRegistry, discoverChecks, evaluateChecks, openAtlas, openWorkspace } from '../src/index.mjs';
import { openAtlasFromSource } from '../src/view.mjs';

const fixture = fileURLToPath(new URL('../../spec/examples/valid/cross-map', import.meta.url));
const actor = { kind: 'tool', id: 'qualification/check-recovery' };

function sample(t) {
  const repositoryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-check-recovery-')));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  const atlasRoot = path.join(repositoryRoot, 'atlas');
  fs.cpSync(fixture, atlasRoot, { recursive: true });
  fs.rmSync(path.join(atlasRoot, '.checks'), { recursive: true });
  fs.mkdirSync(path.join(atlasRoot, '.checks'));
  editCatalog(atlasRoot, catalog => { catalog.checks = []; });
  return { repositoryRoot, atlasRoot };
}

function editCatalog(root, edit) {
  const file = path.join(root, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(file));
  edit(catalog);
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2));
}

function addCheck(root, id = 'questions', { status = 'active', level = 'required', appliesTo = ['map'] } = {}) {
  const registration = { check: id, level, 'applies-to': appliesTo };
  const bytes = `---\n${JSON.stringify({ type: 'check', id, status })}\n---\n\n# Question punctuation ${id}\n\nInspect final Map question punctuation.\n\n## Requirement\n\nEach Map question ends with a question mark.\n\n## Verification\n\nRead each Map question and inspect its final character.\n\n## Failure\n\nIdentify Map questions without a final question mark.\n`;
  const checkPath = `.checks/${id}.md`;
  fs.writeFileSync(path.join(root, checkPath), bytes);
  editCatalog(root, catalog => { catalog.checks.push(registration); });
  return { id, path: checkPath, bytes, registration, revision: calculateCheckRevision(bytes, registration) };
}

function malformedMap(root) {
  fs.writeFileSync(path.join(root, 'maps/architecture/map.md'), 'A Map under repair.\n');
}

function unavailableSource(root, unavailablePath, operation) {
  const unavailable = path.join(root, unavailablePath);
  const sourceFs = new Proxy(fs, { get(target, name) {
    if (name !== operation) return target[name];
    return (file, ...args) => {
      if (file === unavailable) throw Object.assign(new Error('Fixture read is unavailable.'), { code: 'EACCES' });
      return target[name](file, ...args);
    };
  } });
  return openAtlasFromSource(root, {}, { fs: sourceFs, descriptor: { kind: 'working-tree' } });
}

function assertUnresolved(check) {
  assert.equal(check.subjects, null);
  assert.equal(check.applicability.status, 'unresolved');
  assert.ok(check.applicability.reasons.length > 0);
}

test('an unrelated malformed Map preserves exact Check discovery without enabling evaluation', async t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  let invocations = 0;
  const registry = createEvaluatorRegistry([{ id: 'never-invoked', version: '1', checks: [{ id: binding.id, revision: binding.revision }],
    verify() { invocations++; throw new Error('Discovery must not execute verification.'); } }]);
  malformedMap(atlasRoot);
  const view = openAtlas(atlasRoot), discovery = discoverChecks(view, { registry, paths: ['maps/operations'] });
  assert.equal(view.status, 'invalid');
  assert.equal(view.validation.normalized, undefined);
  assert.equal(discovery.status, 'invalid');
  assert.equal(discovery.complete, true);
  assert.equal(discovery.items.length, 1);
  const recovered = discovery.items[0];
  assert.equal(recovered.id, binding.id);
  assert.equal(recovered.title, 'Question punctuation questions');
  assert.equal(recovered.summary, 'Inspect final Map question punctuation.');
  assert.equal(recovered.path, binding.path);
  assert.equal(recovered.status, 'active');
  assert.equal(recovered.level, 'required');
  assert.deepEqual(recovered.appliesTo, ['map']);
  assert.equal(recovered.revision, binding.revision);
  assert.equal(recovered.evaluator.id, 'never-invoked');
  assertUnresolved(recovered);
  assert.equal(view.readDocument(recovered.path).text, binding.bytes);
  const run = await evaluateChecks(view, { actor, registry });
  assert.equal(run.status, 'invalid');
  assert.deepEqual(run.evaluations, []);
  assert.equal(run.requiredSatisfied, false);
  assert.equal(run.wholeAtlasCompliant, false);
  assert.equal(invocations, 0);
});

test('valid discovery keeps exact scoped subjects and distinguishes an empty scope from unresolved applicability', t => {
  const { atlasRoot } = sample(t);
  addCheck(atlasRoot);
  const view = openAtlas(atlasRoot), discovery = discoverChecks(view, { paths: ['maps/operations'] });
  assert.equal(discovery.status, 'ready');
  assert.equal(discovery.complete, true);
  assert.deepEqual(discovery.diagnostics, []);
  assert.deepEqual(discovery.unresolvedCheckIds, []);
  assert.deepEqual(discovery.items[0].subjects, [{ kind: 'map', id: 'operations', path: 'maps/operations/map.md' }]);
  assert.deepEqual(discovery.items[0].applicability, { status: 'resolved', reasons: [] });
  const empty = discoverChecks(view, { paths: ['missing/path'] });
  assert.deepEqual(empty.items[0].subjects, []);
  assert.equal(empty.items[0].applicability.status, 'resolved');
  assert.deepEqual(empty.unresolvedPaths, ['missing/path']);
});

test('broken catalog declarations preserve local Check metadata with explicit unknown registration', async t => {
  for (const [name, change] of [
    ['malformed JSON', root => fs.writeFileSync(path.join(root, 'catalog.json'), '{')],
    ['invalid UTF-8', root => fs.writeFileSync(path.join(root, 'catalog.json'), Buffer.from([0xff, 0xfe]))],
    ['missing catalog', root => fs.rmSync(path.join(root, 'catalog.json'))],
    ['missing registration', root => editCatalog(root, catalog => { catalog.checks = []; })],
    ['duplicate registration', root => editCatalog(root, catalog => { catalog.checks.push({ ...catalog.checks[0], level: 'advisory' }); })],
    ['invalid registration', root => editCatalog(root, catalog => { catalog.checks[0]['applies-to'] = ['unknown-kind']; })],
  ]) await t.test(name, child => {
    const { atlasRoot } = sample(child), binding = addCheck(atlasRoot);
    change(atlasRoot);
    const view = openAtlas(atlasRoot), found = discoverChecks(view, { level: 'required', appliesTo: 'map', paths: ['not/a/subject'] });
    assert.equal(found.items.length, 1);
    assert.equal(found.complete, false);
    assert.ok(found.diagnostics.some(item => item.path === 'catalog.json' || item.path === binding.path));
    assert.equal(found.items[0].id, binding.id);
    assert.equal(found.items[0].status, 'active');
    assert.equal(found.items[0].level, null);
    assert.equal(found.items[0].appliesTo, null);
    assert.equal(found.items[0].revision, null);
    assert.equal(found.items[0].evaluator, null);
    assertUnresolved(found.items[0]);
    assert.deepEqual(discoverChecks(view, { status: 'retired' }).items, []);
  });
});

test('a malformed Check never hides another readable Check and remains a visible discovery gap', async t => {
  for (const [name, damage] of [
    ['malformed header', bytes => bytes.replace('"type":"check"', '"type":')],
    ['missing title', bytes => bytes.replace('# Question punctuation broken\n\n', '')],
    ['missing required section', bytes => bytes.replace('## Verification', '## Inspection')],
  ]) await t.test(name, child => {
    const { atlasRoot } = sample(child), good = addCheck(atlasRoot), broken = addCheck(atlasRoot, 'broken');
    fs.writeFileSync(path.join(atlasRoot, broken.path), damage(broken.bytes));
    const view = openAtlas(atlasRoot), found = discoverChecks(view, { checkIds: [good.id] });
    assert.deepEqual(found.items.map(item => item.id), [good.id]);
    assert.equal(found.complete, false, 'Filters cannot hide a discovery gap.');
    assert.ok(found.diagnostics.some(item => item.path === broken.path));
    assertUnresolved(found.items[0]);
    const unresolved = discoverChecks(view, { checkIds: ['unknown', broken.id, 'unknown'] });
    assert.deepEqual(unresolved.items, []);
    assert.deepEqual(unresolved.unresolvedCheckIds, [broken.id, 'unknown']);
  });
});

test('only a complete Check inventory can reject an unknown Check id', t => {
  const { atlasRoot } = sample(t);
  addCheck(atlasRoot);
  malformedMap(atlasRoot);
  const view = openAtlas(atlasRoot);
  assert.throws(() => discoverChecks(view, { checkIds: ['unknown'] }), { code: 'atlas.tools.invalid-argument' });
  assert.deepEqual(discoverChecks(view, { checkIds: [] }).items, []);
});

test('unrelated invalid catalog metadata does not obscure a valid Check registration', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  editCatalog(atlasRoot, catalog => { catalog.resources = [{ id: 'broken-resource', uri: 42 }]; });
  const view = openAtlas(atlasRoot), found = discoverChecks(view);
  assert.equal(view.status, 'invalid');
  assert.equal(found.complete, true);
  assert.equal(found.items[0].revision, binding.revision);
  assert.equal(found.items[0].level, 'required');
  assert.deepEqual(found.items[0].appliesTo, ['map']);
  assertUnresolved(found.items[0]);
});

test('duplicate local Check identities retain both readable paths without claiming an exact registration', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  fs.writeFileSync(path.join(atlasRoot, '.checks/duplicate.md'), binding.bytes);
  const found = discoverChecks(openAtlas(atlasRoot), { checkIds: [binding.id] });
  assert.equal(found.complete, false);
  assert.deepEqual(found.items.map(item => item.path).sort(), ['.checks/duplicate.md', binding.path]);
  assert.deepEqual(found.unresolvedCheckIds, []);
  assert.ok(found.diagnostics.length > 0);
  for (const item of found.items) {
    assert.equal(item.id, binding.id);
    assert.equal(item.level, null);
    assert.equal(item.appliesTo, null);
    assert.equal(item.revision, null);
    assert.equal(item.evaluator, null);
    assertUnresolved(item);
  }
});

test('an absent Check directory is distinguishable from an unreadable directory', t => {
  const { atlasRoot } = sample(t);
  fs.rmSync(path.join(atlasRoot, '.checks'), { recursive: true });
  const absent = discoverChecks(openAtlas(atlasRoot));
  assert.equal(absent.complete, true);
  assert.deepEqual(absent.items, []);
  assert.deepEqual(absent.diagnostics, []);
  fs.mkdirSync(path.join(atlasRoot, '.checks'));
  addCheck(atlasRoot);
  const unreadable = discoverChecks(unavailableSource(atlasRoot, '.checks', 'readdirSync'), { checkIds: ['questions'] });
  assert.equal(unreadable.status, 'incomplete');
  assert.equal(unreadable.complete, false);
  assert.deepEqual(unreadable.items, []);
  assert.deepEqual(unreadable.unresolvedCheckIds, ['questions']);
  assert.ok(unreadable.diagnostics.some(item => item.path === '.checks'));
});

test('a malformed duplicate body cannot conceal an ambiguous local Check identity', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  fs.writeFileSync(path.join(atlasRoot, '.checks/duplicate.md'), binding.bytes.replace('## Verification', '## Inspection'));
  const found = discoverChecks(openAtlas(atlasRoot));
  assert.equal(found.complete, false);
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].path, binding.path);
  assert.equal(found.items[0].revision, null);
  assert.equal(found.items[0].level, null);
  assert.ok(found.items[0].applicability.reasons.some(reason => reason.includes('multiple local documents')));
});

test('catalog registrations without a Check directory remain unresolved without synthetic definitions', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  fs.rmSync(path.join(atlasRoot, '.checks'), { recursive: true });
  const found = discoverChecks(openAtlas(atlasRoot), { checkIds: [binding.id] });
  assert.equal(found.complete, false);
  assert.deepEqual(found.items, []);
  assert.deepEqual(found.unresolvedCheckIds, [binding.id]);
  assert.ok(found.diagnostics.some(item => item.path === 'catalog.json'));
});

test('unreadable and truncated Check bytes remain gaps while readable sibling definitions survive', async t => {
  for (const mode of ['unreadable', 'truncated']) await t.test(mode, child => {
    const { atlasRoot } = sample(child), good = addCheck(atlasRoot), unavailable = addCheck(atlasRoot, 'unavailable');
    const file = path.join(atlasRoot, unavailable.path);
    malformedMap(atlasRoot);
    if (mode === 'truncated') fs.appendFileSync(file, `\n${'Additional policy explanation. '.repeat(500)}`);
    const view = mode === 'unreadable' ? unavailableSource(atlasRoot, unavailable.path, 'openSync') : openAtlas(atlasRoot, { maxDocumentBytes: 2048 });
    const found = discoverChecks(view);
    assert.equal(found.complete, false);
    assert.deepEqual(found.items.map(item => item.id), [good.id]);
    assert.ok(found.diagnostics.some(item => item.path === unavailable.path));
    assert.equal(view.readDocument(unavailable.path).status, mode);
  });
});

test('a truncated captured catalog cannot supply registration or exact evaluator support', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  malformedMap(atlasRoot);
  editCatalog(atlasRoot, catalog => { catalog['x-explanation'] = 'Catalog explanation. '.repeat(500); });
  const view = openAtlas(atlasRoot, { maxDocumentBytes: 2048 });
  assert.equal(view.readDocument('catalog.json').status, 'truncated');
  const found = discoverChecks(view);
  assert.equal(found.complete, false);
  assert.equal(found.items[0].id, binding.id);
  assert.equal(found.items[0].revision, null);
  assert.equal(found.items[0].level, null);
  assert.equal(found.items[0].appliesTo, null);
  assert.equal(found.items[0].evaluator, null);
  assertUnresolved(found.items[0]);
  assert.ok(found.diagnostics.some(item => item.path === 'catalog.json'));
});

test('a ready normalized view keeps exact Check metadata despite bounded raw document capture', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  fs.appendFileSync(path.join(atlasRoot, binding.path), `\n${'Additional policy explanation. '.repeat(500)}`);
  editCatalog(atlasRoot, catalog => { catalog['x-explanation'] = 'Catalog explanation. '.repeat(500); });
  const expected = discoverChecks(openAtlas(atlasRoot)).items[0];
  const bounded = openAtlas(atlasRoot, { maxDocumentBytes: 2048 });
  assert.equal(bounded.status, 'ready');
  assert.equal(bounded.readDocument(binding.path).status, 'truncated');
  assert.equal(bounded.readDocument('catalog.json').status, 'truncated');
  const found = discoverChecks(bounded);
  assert.equal(found.complete, true);
  assert.deepEqual(found.items[0], expected);
});

test('recovery includes effective Check extensions in the exact revision', t => {
  const { atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  editCatalog(atlasRoot, catalog => {
    catalog.checks[0]['x-origin'] = { order: ['first', 'second'], name: 'review' };
    catalog.extensions = [{ owner: { type: 'check', check: binding.id }, values: { 'x-scope': 'Map punctuation' } }];
  });
  const ready = discoverChecks(openAtlas(atlasRoot)).items[0];
  malformedMap(atlasRoot);
  const recovered = discoverChecks(openAtlas(atlasRoot)).items[0];
  const expected = calculateCheckRevision(binding.bytes, { ...binding.registration,
    'x-origin': { order: ['first', 'second'], name: 'review' }, 'x-scope': 'Map punctuation' });
  assert.equal(ready.revision, expected);
  assert.equal(recovered.revision, expected);
  assert.notEqual(recovered.revision, binding.revision);
});

test('ambiguous catalog extensions preserve declarations but cannot bind a verifier', async t => {
  for (const duplicateOwner of [true, false]) await t.test(duplicateOwner ? 'duplicate owner' : 'repeated extension field', child => {
    const { atlasRoot } = sample(child), binding = addCheck(atlasRoot);
    const registry = createEvaluatorRegistry([{ id: 'unsupported', version: '1', checks: [{ id: binding.id, revision: binding.revision }], verify() { throw new Error('must not run'); } }]);
    editCatalog(atlasRoot, catalog => {
      const extension = { owner: { type: 'check', check: binding.id }, values: { 'x-policy': 'review' } };
      catalog.extensions = duplicateOwner ? [extension, extension] : [extension];
      if (!duplicateOwner) catalog.checks[0]['x-policy'] = 'review';
    });
    const found = discoverChecks(openAtlas(atlasRoot), { registry });
    assert.equal(found.complete, false);
    assert.equal(found.items[0].level, 'required');
    assert.deepEqual(found.items[0].appliesTo, ['map']);
    assert.equal(found.items[0].revision, null);
    assert.equal(found.items[0].evaluator, null);
    assert.ok(found.diagnostics.some(item => item.path === 'catalog.json'));
  });
});

test('reused in-memory views read captured Check bytes after the working tree changes', t => {
  const { repositoryRoot, atlasRoot } = sample(t), binding = addCheck(atlasRoot);
  malformedMap(atlasRoot);
  const workspace = openWorkspace({ repositoryRoot, atlasPath: 'atlas' });
  t.after(() => workspace.close());
  const first = workspace.read(), cached = workspace.read();
  assert.equal(cached.view, first.view);
  const expected = discoverChecks(first.view);
  assert.deepEqual(discoverChecks(cached.view), expected);
  fs.writeFileSync(path.join(atlasRoot, binding.path), 'The current working tree is unreadable as a Check.');
  fs.writeFileSync(path.join(atlasRoot, 'catalog.json'), '{');
  for (const view of [first.view, cached.view]) {
    assert.deepEqual(discoverChecks(view), expected);
    assert.equal(view.readDocument(binding.path).text, binding.bytes);
  }
  assert.equal(discoverChecks(openAtlas(atlasRoot)).complete, false);
});

test('recovered output is deterministic and deeply immutable', t => {
  const { atlasRoot } = sample(t);
  addCheck(atlasRoot, 'zebra');
  addCheck(atlasRoot, 'alpha');
  malformedMap(atlasRoot);
  const view = openAtlas(atlasRoot), found = discoverChecks(view);
  assert.deepEqual(found.items.map(item => item.id), ['alpha', 'zebra']);
  assert.deepEqual(discoverChecks(view), found);
  assert.ok(Object.isFrozen(found));
  assert.ok(Object.isFrozen(found.items[0]));
  assert.ok(Object.isFrozen(found.items[0].appliesTo));
  assert.ok(Object.isFrozen(found.items[0].applicability.reasons));
  assert.ok(Object.isFrozen(found.diagnostics));
  assert.ok(Object.isFrozen(found.unresolvedCheckIds));
  assert.throws(() => { found.items[0].applicability.reasons.push('forged'); }, TypeError);
});
