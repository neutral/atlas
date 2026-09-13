import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openAtlas, openWorkspace, retainCheckReport, readCheckReport } from '../src/index.mjs';
import { prepareAtlasChange, applyAtlasChange, evaluatePreparedChange, inspectAtlasRecovery, discardAtlasRecovery, planDigest } from '../src/authoring.mjs';
import { parseFrontMatter } from '../src/frontmatter.mjs';

const examples = fileURLToPath(new URL('../../spec/examples/', import.meta.url));
const anchor = 'maps/architecture/points/edge-authentication.md';
const errorCode = (code) => (error) => error.code === `atlas.authoring.${code}`;
function project(t, fixture = 'valid/cross-map') {
  const repositoryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-authoring-')));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  const atlasRoot = path.join(repositoryRoot, 'atlas');
  if (fixture) fs.cpSync(path.join(examples, fixture), atlasRoot, { recursive: true });
  return { repositoryRoot, atlasRoot, atlasPath: 'atlas', recoveryDirectory: path.join(repositoryRoot, 'recovery') };
}
function prepare(project, operations) {
  return prepareAtlasChange({ repositoryRoot: project.repositoryRoot, atlasPath: project.atlasPath,
    expected: { viewDigest: openAtlas(project.atlasRoot).identity.digest }, operations });
}
function bytes(project, file = anchor) { return fs.readFileSync(path.join(project.atlasRoot, file)); }
function parse(project, file = anchor) { return parseFrontMatter(bytes(project, file).toString('utf8')).value; }
function body(project, file = anchor, { title, summary } = {}) {
  let result = parseFrontMatter(bytes(project, file).toString('utf8')).body;
  if (title) result = result.replace(/^# .+$/mu, `# ${title}`);
  if (summary) result = result.replace(/(^# [^\n]+\n\s*\n)[^\n]+(?:\n(?!\s*\n)[^\n]+)*/mu, `$1${summary}`);
  return result;
}
function writeJson(project, file, edit) {
  const text = bytes(project, file).toString('utf8'), parsed = parseFrontMatter(text);
  edit(parsed.value);
  fs.writeFileSync(path.join(project.atlasRoot, file), `---\n${JSON.stringify(parsed.value, null, 2)}\n---\n${parsed.body}`);
}
const pointFields = { posture: 'asserted', lifecycle: 'active' };
const designBody = '# Design\n\nDesign context.\n\n## Question\n\nWhich choices govern the design?\n';
const checkText = '---\n{"type":"check","id":"source-review","status":"active"}\n---\n\n# Source review\n\nReview source support.\n\n## Requirement\n\nInspect the stated source.\n\n## Verification\n\nCompare the statement with the supplied source and record the result.\n\n## Failure\n\nCorrect the unsupported statement.\n';

test('publication creation previews exact permission selection, preserves source content, and refuses stale or repeated creation', t => {
  const p = project(t);
  const text = `---\n${JSON.stringify({ type: 'publication', id: 'public', selection: { atlas: true, maps: ['architecture'], points: {}, resources: [], checks: [] } }, null, 2)}\n---\n\n# Public site\n\nOnly the explicitly selected source records are eligible.\n`;
  const operation = { type: 'publication', action: 'create', id: 'public', text };
  const plan = prepare(p, [operation]);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].path, '.publication/public.md');
  assert.equal(plan.changes[0].before, null);
  assert.deepEqual(plan.subjects, [{ type: 'publication', id: 'public', path: '.publication/public.md' }]);
  assert.equal(fs.existsSync(path.join(p.atlasRoot, '.publication')), false);
  fs.appendFileSync(path.join(p.atlasRoot, anchor), '\nAn external edit.\n');
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'stale');
  assert.equal(fs.existsSync(path.join(p.atlasRoot, '.publication')), false);
  const fresh = prepare(p, [operation]);
  assert.equal(applyAtlasChange(fresh, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  assert.equal(fs.readFileSync(path.join(p.atlasRoot, '.publication/public.md'), 'utf8'), text);
  assert.throws(() => prepare(p, [operation]), errorCode('invalid-operation'));
  assert.throws(() => prepare(p, [{ ...operation, id: 'other' }]), errorCode('invalid-operation'));
  assert.throws(() => prepare(p, [{ ...operation, id: '../escape' }]), errorCode('invalid-operation'));
});

test('initialization and all structured operation families produce a reviewed valid contribution on real files', async (t) => {
  const p = project(t, null);
  const operations = [
    { type: 'initialize', fields: { id: 'demo' }, body: '# Demo\n\nA standalone authoring demonstration.\n' },
    { type: 'map', action: 'create', id: 'design', directory: 'maps/design', set: { status: 'active', 'x-owner': { team: 'core' } }, body: designBody },
    { type: 'map', action: 'create', id: 'operations', directory: 'maps/operations', set: { status: 'active' }, body: '# Operations\n\nOperational context.\n\n## Question\n\nHow is the system operated?\n' },
    { type: 'area', action: 'create', mapId: 'design', id: 'identity', set: { title: 'Identity', 'x-class': 'stable' }, body: `${designBody}\n## Area: identity\n\nIdentity decisions.\n\n### Question\n\nWhich item retains this identity?\n` },
    { type: 'resource', action: 'create', id: 'source', set: { uri: 'https://example.com/source', title: 'Source', 'x-origin': 'explicit' } },
    { type: 'point', action: 'create', id: 'retain-identity', mapId: 'design', record: 'anchor', set: { ...pointFields, areas: [{ id: 'retain-identity-membership', area: 'identity' }], references: [{ id: 'retain-identity-evidence', resource: 'source', role: 'evidence' }] }, body: '# Keep exact identity\n\nOrdinary edits preserve the selected identity.\n\n## Connection: retain-identity-membership\n\nStable ids keep ordinary edits attached to the same item.\n\n## Connection: retain-identity-evidence\n\nThe source supports this exact statement.\n' },
    { type: 'point', action: 'create', id: 'retain-identity', mapId: 'operations', record: 'context', body: '# Identity during operations\n\nOperations keep the same identity across updates.\n\nOperators use the same identifier while updating the implementation.\n' },
    { type: 'point', action: 'create', id: 'new-identity', mapId: 'design', record: 'anchor', set: { ...pointFields, review: { 'reviewed-at': '2026-09-08', by: ['operator'] } }, body: '# Replace a decision explicitly\n\nReplacement decisions keep explained provenance.\n' },
    { type: 'supersede', sourceId: 'new-identity', targetId: 'retain-identity', note: 'The replacement covers the prior decision with a narrower rule.' },
    { type: 'adopt-check', id: 'source-review', text: checkText, registration: { check: 'source-review', level: 'required', 'applies-to': ['point-anchor'] }, source: { uri: 'https://example.com/check' } },
  ];
  const plan = prepareAtlasChange({ repositoryRoot: p.repositoryRoot, atlasPath: 'atlas', expected: { atlasMissing: true }, operations });
  assert.equal(fs.existsSync(p.atlasRoot), false, 'Preparation must not create directories.');
  assert.equal(plan.status, 'ready');
  assert.equal(plan.validation.after.valid, true);
  assert.ok(Object.isFrozen(plan.changes[0].after));
  assert.equal(plan.changes.length, 9);
  assert.ok(plan.changes.every((change) => change.before === null && change.diff.startsWith('--- /dev/null')));
  assert.equal(plan.pointDecisions.find((decision) => decision.record === 'context').anchor.path, 'maps/design/points/retain-identity.md');
  assert.equal(plan.checks.applicable[0].outcome, 'unable');
  assert.equal(plan.checks.requiredSatisfied, false);
  const evaluated = await evaluatePreparedChange(plan, { actor: { kind: 'tool', id: 'authoring-test' } });
  assert.equal(evaluated.planDigest, plan.digest);
  assert.equal(evaluated.run.requiredSatisfied, false);
  const saved = applyAtlasChange(JSON.parse(JSON.stringify(plan)), { recoveryDirectory: p.recoveryDirectory });
  assert.equal(saved.status, 'applied');
  const view = openAtlas(p.atlasRoot);
  assert.equal(view.status, 'ready');
  assert.equal(view.inspectPoint('retain-identity').point.lifecycle, 'superseded');
  assert.equal(view.inspectPoint('new-identity').point.relations[0].targetPoint, 'retain-identity');
  assert.equal(view.inspectResource('source').uses.length, 1);
  assert.equal(plan.pointDecisions.find(decision => decision.record === 'context').mapQuestion, 'How is the system operated?');
  for (const file of ['atlas.md', 'maps/design/map.md', 'maps/design/points/new-identity.md']) {
    const header = parse(p, file);
    assert.equal(Object.hasOwn(header, 'summary'), false);
    assert.equal(Object.hasOwn(header, 'title'), false);
    assert.equal(Object.hasOwn(header, 'question'), false);
  }
  assert.equal(parse(p, 'maps/design/points/new-identity.md').relations, undefined);
  assert.equal(JSON.parse(bytes(p, 'connections.json')).relations[0].target, 'retain-identity');
  assert.match(body(p, 'maps/design/points/new-identity.md'), /## Connection: relation-new-identity-supersedes-retain-identity\n\nThe replacement covers/u);
  assert.equal(saved.recovery.status, 'removed');
  assert.equal(saved.recoveryDirectory, undefined);
  assert.deepEqual(fs.readdirSync(p.recoveryDirectory), []);
});

test('structured updates preserve questions, explained collection fields, nested extensions, body bytes, and anchor provenance', (t) => {
  const p = project(t);
  const catalog = JSON.parse(bytes(p, 'catalog.json')), connections = JSON.parse(bytes(p, 'connections.json'));
  (catalog.extensions ??= []).push({ owner: { type: 'point', map: 'architecture', point: 'edge-authentication' }, values: { 'x-meta': { owner: 'team', nested: { retained: true } } } });
  connections.memberships.find(item => item.point === 'edge-authentication' && item.map === 'architecture')['x-membership'] = { source: 'review' };
  fs.writeFileSync(path.join(p.atlasRoot, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(p.atlasRoot, 'connections.json'), JSON.stringify(connections));
  const original = bytes(p).toString('utf8').replace(/\n/gu, '\r\n');
  fs.writeFileSync(path.join(p.atlasRoot, anchor), original);
  const mapQuestion = openAtlas(p.atlasRoot).validation.normalized.maps.find(map => map.id === 'architecture').question;
  const plan = prepare(p, [
    { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', set: {
      'x-meta': { newField: 1 }, areas: [{ area: 'boundary' }, { area: 'security' }],
      relations: [{ type: 'supports', point: 'rotate-edge-keys' }],
    } },
    { type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { summary: 'Updated Map summary.' }) },
  ]);
  assert.equal(plan.status, 'ready');
  const proposed = plan.validation.after.normalized;
  const point = proposed.points.find((point) => point.id === 'edge-authentication');
  assert.equal(point.relations[0].note, 'The boundary requires an operational key rotation practice.');
  assert.equal(point.relations[0].extensions['x-origin'], 'architecture-review');
  assert.equal(point.extensions['x-meta'].nested.retained, true);
  assert.equal(point.records[0].areas[0]['x-membership'].source, 'review');
  assert.equal(proposed.maps.find((map) => map.id === 'architecture').question, mapQuestion);
  assert.equal(plan.pointDecisions[0].anchor.sha256, plan.baseline.files.find((change) => change.path === anchor).sha256);
  assert.equal(plan.changes.some(change => change.path === anchor), false, 'Catalog-only metadata edits preserve exact Markdown bytes.');
  const after = bytes(p).toString('utf8');
  assert.equal(after.slice(after.indexOf('\r\n---\r\n') + 7), original.slice(original.indexOf('\r\n---\r\n') + 7));
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
});

test('same authored values return no-op and never rewrite files or create recovery storage', (t) => {
  const p = project(t), original = bytes(p), stat = fs.statSync(path.join(p.atlasRoot, anchor));
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p) }]);
  assert.equal(plan.status, 'no-op');
  assert.deepEqual(plan.changes, []);
  assert.equal(plan.checks.complete, true);
  assert.equal(plan.checks.applicable[0].id, 'point-context');
  assert.equal(plan.checks.requiredSatisfied, false, 'An unchanged proposal has not performed required Verification.');
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'no-op');
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
  assert.deepEqual(bytes(p), original);
  assert.equal(fs.statSync(path.join(p.atlasRoot, anchor)).mtimeMs, stat.mtimeMs);
});

test('explicit identity, record-kind, question, and extension boundaries reject ambiguous or lossy operations', (t) => {
  const p = project(t);
  const selected = { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor' };
  for (const operation of [
    { ...selected, action: 'create', set: pointFields }, { ...selected, record: 'context' },
    { ...selected, set: { id: 'another' } }, { ...selected, set: { relations: [] } },
    { type: 'map', action: 'create', id: 'architecture', directory: 'maps/other', set: {} },
    { type: 'map', action: 'create', id: 'outside', directory: '../outside', set: {} },
    { type: 'map', action: 'update', id: 'architecture', directory: 'maps/other' },
  ]) assert.throws(() => prepare(p, [operation]), errorCode('invalid-operation'));
  const explicit = prepare(p, [{ ...selected, unset: ['/relations/0/x-origin'], set: { relations: [] } }]);
  assert.equal(explicit.status, 'invalid', 'An explanation for a removed connection remains invalid until removed explicitly.');
  const removed = prepare(p, [{ ...selected, unset: ['relations'], body: body(p).replace(/\n## Connection: architecture-edge-authentication-supports-rotate-edge-keys\n[\s\S]*?(?=\n## |$)/u, '') }]);
  assert.equal(removed.status, 'ready');
});

test('legacy explanation fields are invalid frontmatter and body edits supply registered meaning', (t) => {
  const p = project(t);
  for (const set of [{ title: 'Legacy title' }, { summary: 'Legacy summary.' }, { areas: [{ area: 'boundary', context: 'Legacy context.' }] },
    { relations: [{ type: 'supports', point: 'rotate-edge-keys', note: 'Legacy note.' }] }]) {
    assert.equal(prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', set }]).status, 'invalid');
  }
  const resourceBody = `${body(p, 'atlas.md').trimEnd()}\n\n## Resource: additional-source\n\nA registered source explanation.\n`;
  const resourcePlan = prepare(p, [{ type: 'resource', action: 'create', id: 'additional-source', set: { title: 'Additional source', uri: 'https://example.com/additional' }, body: resourceBody }]);
  assert.equal(resourcePlan.status, 'ready');
  assert.equal(resourcePlan.validation.after.normalized.atlas.resources.find(resource => resource.id === 'additional-source').summary, 'A registered source explanation.');
  const catalogChange = resourcePlan.changes.find(change => change.path === 'catalog.json');
  const parsed = JSON.parse(Buffer.from(catalogChange.after.bytesBase64, 'base64'));
  assert.equal(Object.hasOwn(parsed.resources.find(resource => resource.id === 'additional-source'), 'summary'), false);
});

test('invalid containing Map metadata retains proposal diagnostics and unresolved Checks during Point repair', async (t) => {
  const p = project(t);
  writeJson(p, 'maps/architecture/map.md', record => { record.areas = 42; });
  const plan = prepare(p, [{ type: 'repair-document', path: anchor, text: `${bytes(p).toString('utf8')}\nA reviewed clarification.\n` }]);
  assert.equal(plan.status, 'invalid');
  assert.ok(plan.validation.after.diagnostics.some(diagnostic => diagnostic.code === 'atlas.frontmatter.schema'));
  assert.equal(plan.pointDecisions[0].mapQuestion, undefined);
  assert.equal(plan.checks.complete, false);
  assert.equal(plan.checks.requiredSatisfied, false);
  assert.deepEqual(plan.checks.applicable, []);
  assert.equal(plan.checks.unresolved[0].id, 'point-context');
  assert.equal(plan.checks.unresolved[0].level, 'required');
  assert.equal(plan.checks.unresolved[0].subjects, null);
  assert.equal(plan.checks.unresolved[0].applicability.status, 'unresolved');
  assert.ok(plan.checks.unresolved[0].applicability.reasons.length > 0);
  assert.equal(plan.checks.unresolved[0].outcome, 'unable');
  const evaluated = await evaluatePreparedChange(plan, { actor: { kind: 'tool', id: 'repair-test' } });
  assert.deepEqual(evaluated.run.evaluations, []);
  assert.equal(evaluated.run.requiredSatisfied, false);
});

test('an invalid catalog leaves readable active proposal Checks visible with unknown registration', (t) => {
  const p = project(t);
  const plan = prepare(p, [{ type: 'repair-document', path: 'catalog.json', text: '{' }]);
  assert.equal(plan.status, 'invalid');
  assert.equal(plan.checks.complete, false);
  assert.equal(plan.checks.requiredSatisfied, false);
  assert.deepEqual(plan.checks.applicable, []);
  const candidate = plan.checks.unresolved.find(check => check.id === 'point-context');
  assert.equal(candidate.path, '.checks/point-context.md');
  assert.equal(candidate.title, 'Require meaningful Point context');
  assert.equal(candidate.status, 'active');
  assert.equal(candidate.level, null);
  assert.equal(candidate.appliesTo, null);
  assert.equal(candidate.revision, null);
  assert.equal(candidate.subjects, null);
  assert.equal(candidate.outcome, 'unable');
  assert.ok(plan.checks.diagnostics.some(diagnostic => diagnostic.path === 'catalog.json'));
});

test('supersession updates its Markdown explanation once and preserves unrelated fenced examples', (t) => {
  const p = project(t);
  const operation = { type: 'supersede', sourceId: 'rotate-edge-keys', targetId: 'edge-authentication', note: 'This replacement narrows the decision.' };
  const initial = prepare(p, [operation]);
  assert.equal(applyAtlasChange(initial, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  assert.equal(prepare(p, [operation]).status, 'no-op');
  const source = 'maps/operations/points/rotate-edge-keys.md';
  fs.appendFileSync(path.join(p.atlasRoot, source), '\n## Example\n\n```md\n## Relation: supersedes edge-authentication\n\nAn inert example.\n```\n');
  const updated = prepare(p, [{ ...operation, note: 'The reviewed replacement explains the changed boundary.' }]);
  assert.equal(updated.status, 'ready');
  const record = updated.validation.after.normalized.points.find(point => point.id === 'rotate-edge-keys');
  assert.equal(record.relations.find(relation => relation.type === 'supersedes').note, 'The reviewed replacement explains the changed boundary.');
  assert.match(record.records[0].body, /An inert example/u);
});

test('authoring shares process-local reading configuration with a root Atlas workspace', (t) => {
  const p = project(t), configuration = { specificationRevision: '0.9.0', maxDocumentBytes: 128 };
  const workspace = openWorkspace({ repositoryRoot: p.atlasRoot, atlasPath: '.', configuration });
  const baseline = workspace.read();
  assert.equal(baseline.view.status, 'ready');
  const plan = prepareAtlasChange({ repositoryRoot: p.atlasRoot, atlasPath: '.', configuration,
    expected: { viewDigest: baseline.view.identity.digest }, operations: [
      { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'A complete independent source boundary' }) },
    ] });
  assert.equal(plan.contract, 'atlas.change-plan/2');
  assert.equal(Object.hasOwn(plan, 'excludedDirectories'), false);
  assert.equal(Object.hasOwn(plan, 'cacheDirectory'), false);
  assert.deepEqual(plan.configuration, configuration);
  assert.ok(plan.baseline.files.find((file) => file.path === anchor).byteLength > 128, 'Plans retain complete bytes beyond the view prefix.');
  workspace.close();
  const saved = applyAtlasChange(JSON.parse(JSON.stringify(plan)), { recoveryDirectory: p.recoveryDirectory });
  assert.equal(saved.status, 'applied');
  const reopened = openWorkspace({ repositoryRoot: p.atlasRoot, atlasPath: '.', configuration });
  t.after(() => reopened.close());
  assert.equal(reopened.read().view.inspectPoint('edge-authentication').point.title, 'A complete independent source boundary');
});

test('JSON-safe authoring overrides preserve the workspace durable configuration', (t) => {
  const p = project(t), configuration = { specificationRevision: '0.9.0', maxDocumentBytes: 128 };
  fs.writeFileSync(path.join(p.repositoryRoot, 'atlas.workspace.json'), JSON.stringify({ format: 1, atlasPath: p.atlasPath, configuration }));
  const overrides = { specificationRevision: undefined, maxDocumentBytes: undefined };
  const workspace = openWorkspace({ repositoryRoot: p.repositoryRoot, configuration: overrides });
  t.after(() => workspace.close());
  const request = { repositoryRoot: p.repositoryRoot, atlasPath: p.atlasPath, configuration: {},
    expected: { viewDigest: workspace.read().view.identity.digest }, operations: [
      { type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { title: 'The durable reading configuration remains exact' }) },
    ] };
  assert.throws(() => prepareAtlasChange({ ...request, configuration: overrides }), errorCode('invalid-operation'));
  const plan = prepareAtlasChange(request);
  assert.deepEqual(plan.configuration, configuration);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
});

test('authoring rejects obsolete options and plans without hiding or rewriting existing cache files', async (t) => {
  const p = project(t), formerCache = path.join(p.atlasRoot, 'storage/cache');
  fs.mkdirSync(formerCache, { recursive: true });
  const marker = '{"contract":"atlas.cache-directory/1"}\n';
  fs.writeFileSync(path.join(formerCache, '.atlas-cache.json'), marker);
  fs.writeFileSync(path.join(formerCache, 'cache.sqlite'), 'Existing disposable storage is not interpreted.');
  const request = { repositoryRoot: p.repositoryRoot, atlasPath: p.atlasPath,
    expected: { viewDigest: openAtlas(p.atlasRoot).identity.digest }, operations: [
      { type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { title: 'Explicit update' }) },
    ] };
  assert.throws(() => prepareAtlasChange({ ...request, cacheDirectory: formerCache }), errorCode('invalid-operation'));
  assert.throws(() => prepareAtlasChange({ ...request, configuration: { evaluatorRevision: 'obsolete' } }), errorCode('invalid-operation'));
  const plan = prepareAtlasChange(request);
  assert.ok(plan.baseline.files.some((file) => file.path === 'storage/cache/cache.sqlite'));
  for (const altered of [{ ...plan, contract: 'atlas.change-plan/1' }, { ...plan, cacheDirectory: formerCache },
    { ...plan, request: { ...plan.request, configuration: { evaluatorRevision: 'obsolete' } } }]) {
    altered.digest = planDigest(altered);
    assert.throws(() => applyAtlasChange(altered, { recoveryDirectory: p.recoveryDirectory }), errorCode('invalid-plan'));
    await assert.rejects(evaluatePreparedChange(altered, { actor: { kind: 'tool', id: 'current-contract-test' } }), errorCode('invalid-plan'));
  }
  assert.equal(fs.readFileSync(path.join(formerCache, '.atlas-cache.json'), 'utf8'), marker);
  fs.writeFileSync(path.join(formerCache, 'new-source.txt'), 'An observed source addition.');
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'stale');
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
});

test('prepared evaluator receipts retain genuine run and exact sealed plan provenance', async (t) => {
  const p = project(t);
  const plan = prepare(p, [{ type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { title: 'Proposal only' }) }]);
  fs.appendFileSync(path.join(p.atlasRoot, 'maps/architecture/map.md'), '\nLater live edit.\n');
  const receipt = await evaluatePreparedChange(plan, { actor: { kind: 'human', id: 'proposal-reviewer' } });
  assert.deepEqual(receipt.run.preparedChange, { planDigest: plan.digest, paths: ['maps/architecture/map.md'] });
  const directory = path.join(p.repositoryRoot, 'retained-report');
  retainCheckReport(receipt.run, { directory, repositoryRoot: p.repositoryRoot });
  const retained = readCheckReport(directory);
  assert.deepEqual(retained.provenance.run.preparedChange, receipt.run.preparedChange);
  assert.equal(retained.provenance.run.sourceIdentity.digest, receipt.run.sourceIdentity.digest);
});

test('new explicit contextual targets under ignored directories are fully captured without their siblings', (t) => {
  const p = project(t);
  fs.mkdirSync(path.join(p.atlasRoot, 'dist'));
  fs.writeFileSync(path.join(p.atlasRoot, 'dist/source.md'), 'Exact source bytes beyond discovery.');
  fs.writeFileSync(path.join(p.atlasRoot, 'dist/ignored.md'), 'An unrelated sibling.');
  const plan = prepare(p, [{ type: 'resource', action: 'update', id: 'authentication-guide', set: { uri: 'dist/source.md' } }]);
  assert.equal(plan.status, 'ready');
  assert.ok(plan.baseline.files.some((file) => file.path === 'dist/source.md'));
  assert.ok(!plan.baseline.files.some((file) => file.path === 'dist/ignored.md'));
  fs.appendFileSync(path.join(p.atlasRoot, 'dist/source.md'), '\nChanged after review.');
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'stale');
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
});

test('stale edits, additions, deletion, and configuration changes refuse all effects before recovery creation', (t) => {
  for (const alteration of ['edit', 'addition', 'deletion', 'configuration']) {
    const p = project(t);
    const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'Reviewed replacement title' }) }]);
    if (alteration === 'edit') fs.appendFileSync(path.join(p.atlasRoot, anchor), '\nExternal edit.');
    if (alteration === 'addition') fs.writeFileSync(path.join(p.atlasRoot, 'untracked.md'), 'Untracked authoring addition.');
    if (alteration === 'deletion') fs.unlinkSync(path.join(p.atlasRoot, 'docs/authentication.md'));
    if (alteration === 'configuration') fs.writeFileSync(path.join(p.repositoryRoot, 'atlas.workspace.json'), JSON.stringify({ format: 1, atlasPath: 'atlas', configuration: { maxDocumentBytes: 129 } }));
    const result = applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory });
    assert.equal(result.status, 'stale', alteration);
    assert.deepEqual(result.written, []);
    assert.equal(fs.existsSync(p.recoveryDirectory), false);
  }
});

test('modified serialized plans cannot alter effects even when their checksum is recomputed', (t) => {
  const p = project(t), original = bytes(p);
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'Prepared title' }) }]);
  for (const rehash of [false, true]) {
    const tampered = structuredClone(plan);
    tampered.changes[0].after.bytesBase64 = Buffer.from('Unreviewed content.').toString('base64');
    if (rehash) tampered.digest = planDigest(tampered);
    assert.throws(() => applyAtlasChange(tampered, { recoveryDirectory: p.recoveryDirectory }), errorCode('invalid-plan'));
  }
  assert.deepEqual(bytes(p), original);
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
});

test('invalid drafts can be previewed, repaired, or explicitly saved with honest validation and no normalized model', (t) => {
  const p = project(t);
  const original = bytes(p).toString('utf8');
  fs.writeFileSync(path.join(p.atlasRoot, anchor), original.replace('"id":', '"id" BROKEN:'));
  const repaired = prepare(p, [{ type: 'repair-document', path: anchor, text: original }]);
  assert.equal(repaired.validation.before.valid, false);
  assert.equal(repaired.validation.before.normalized, undefined);
  assert.equal(repaired.validation.after.valid, true);
  assert.equal(applyAtlasChange(repaired, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  const draft = prepare(p, [{ type: 'repair-document', path: anchor, text: 'An unfinished draft without front matter.\n' }]);
  assert.equal(draft.status, 'invalid');
  assert.throws(() => applyAtlasChange(draft, { recoveryDirectory: p.recoveryDirectory }), errorCode('invalid-operation'));
  const saved = applyAtlasChange(draft, { recoveryDirectory: p.recoveryDirectory, mode: 'draft' });
  assert.equal(saved.status, 'applied');
  assert.equal(saved.validation.valid, false);
  assert.equal(saved.validation.normalized, undefined);
});

test('a real failure between replacements retains originals and later external edits without automatic rollback', (t) => {
  const p = project(t);
  const second = 'maps/operations/map.md';
  const beforeFirst = bytes(p, 'maps/architecture/map.md');
  const beforeSecond = bytes(p, second);
  const plan = prepare(p, [
    { type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { summary: 'Prepared architecture summary.' }) },
    { type: 'map', action: 'update', id: 'operations', body: body(p, 'maps/operations/map.md', { summary: 'Prepared operations summary.' }) },
  ]);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    const value = rename.call(fs, from, to);
    if (to === path.join(p.atlasRoot, 'maps/architecture/map.md')) fs.appendFileSync(path.join(p.atlasRoot, second), '\nA later external edit must survive.\n');
    return value;
  });
  const result = applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.written, ['maps/architecture/map.md']);
  assert.deepEqual(result.pending, [second]);
  assert.match(bytes(p, second).toString(), /later external edit/u);
  assert.deepEqual(fs.readFileSync(path.join(result.recoveryDirectory, 'originals/0.bin')), beforeFirst);
  assert.deepEqual(fs.readFileSync(path.join(result.recoveryDirectory, 'originals/1.bin')), beforeSecond);
  assert.ok(fs.readdirSync(result.recoveryDirectory).some((file) => file.startsWith('event-')));
});

test('recovery storage and authoring destinations cannot cross Atlas, temporary storage, symlink, or nested boundaries', (t) => {
  const p = project(t);
  const plan = prepare(p, [{ type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { summary: 'A reviewed edit.' }) }]);
  for (const recoveryDirectory of [p.atlasRoot, p.repositoryRoot, path.join(p.repositoryRoot, 'tmp/atlas/recovery'), path.join(p.repositoryRoot, '.git/recovery')]) {
    assert.throws(() => applyAtlasChange(plan, { recoveryDirectory }), errorCode('invalid-operation'));
  }
  fs.mkdirSync(path.join(p.atlasRoot, 'nested'));
  fs.writeFileSync(path.join(p.atlasRoot, 'nested/atlas.md'), 'Separate Atlas.');
  assert.throws(() => prepare(p, [{ type: 'map', action: 'create', id: 'nested-map', directory: 'nested/map', set: { status: 'draft' }, body: '# N\n\nN\n\n## Question\n\nWhich nested question?\n' }]), errorCode('invalid-operation'));
  fs.symlinkSync(path.join(p.repositoryRoot, 'outside'), path.join(p.atlasRoot, 'link'));
  assert.throws(() => prepare(p, [{ type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { summary: 'Another edit.' }) }]), errorCode('unsupported-source'));
});

test('confirmed application cleans only its recovery and reports cleanup failure with the complete plan', (t) => {
  const p = project(t), sentinel = path.join(p.recoveryDirectory, 'unrelated-user-recovery');
  fs.mkdirSync(sentinel, { recursive: true });
  fs.writeFileSync(path.join(sentinel, 'draft.txt'), 'An unrelated active draft.');
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'Confirmed source' }) }]);
  const unlink = fs.unlinkSync;
  const mock = t.mock.method(fs, 'unlinkSync', (file) => {
    if (file.endsWith('/originals/0.bin')) throw Object.assign(new Error('Controlled cleanup failure'), { code: 'EIO' });
    return unlink(file);
  });
  const result = applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory });
  assert.equal(result.status, 'applied');
  assert.equal(result.recovery.status, 'cleanup-failed');
  assert.match(result.gaps.join('\n'), /Controlled cleanup failure/u);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.recoveryDirectory, 'plan.json'))).digest, plan.digest);
  assert.equal(fs.readFileSync(path.join(sentinel, 'draft.txt'), 'utf8'), 'An unrelated active draft.');
  mock.mock.restore();
  const selection = { repositoryRoot: p.repositoryRoot, atlasPath: p.atlasPath, recoveryDirectory: result.recoveryDirectory };
  const inspection = inspectAtlasRecovery(selection);
  assert.equal(inspection.inactive, true);
  assert.ok(inspection.files.some((file) => file.path === 'plan.json'));
  const source = bytes(p);
  assert.equal(discardAtlasRecovery({ ...selection, inspectedDigest: inspection.digest }).status, 'discarded');
  assert.deepEqual(bytes(p), source);
  assert.deepEqual(fs.readdirSync(p.recoveryDirectory), ['unrelated-user-recovery']);
});

test('recovery discard refuses changed inspection, live owners, unsupported state, and workspace mismatches', (t) => {
  const p = project(t);
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'A partial edit' }) }]);
  const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('Controlled replacement failure'); });
  const result = applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory });
  rename.mock.restore();
  assert.equal(result.status, 'partial');
  const selection = { repositoryRoot: p.repositoryRoot, atlasPath: p.atlasPath, recoveryDirectory: result.recoveryDirectory };
  const inspection = inspectAtlasRecovery(selection);
  const planFile = path.join(result.recoveryDirectory, 'plan.json'), manifestFile = path.join(result.recoveryDirectory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, contract: 'atlas.change-recovery/1' }));
  assert.throws(() => inspectAtlasRecovery(selection), errorCode('invalid-operation'));
  assert.equal(fs.existsSync(path.join(result.recoveryDirectory, 'originals/0.bin')), true);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  for (const alter of [
    (value) => { value.contract = 'atlas.change-plan/1'; },
    (value) => { delete value.request; },
    (value) => { delete value.baseline.files; },
    (value) => { value.changes[0].before.bytesBase64 = 'unsupported bytes'; },
    (value) => { value.baseline.files[0].sha256 = '0'.repeat(64); },
  ]) {
    const malformed = JSON.parse(JSON.stringify(plan)); alter(malformed); malformed.digest = planDigest(malformed);
    fs.writeFileSync(planFile, JSON.stringify(malformed));
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, planDigest: malformed.digest }));
    assert.throws(() => inspectAtlasRecovery(selection), errorCode('invalid-operation'));
  }
  fs.writeFileSync(planFile, JSON.stringify(plan)); fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const eventPath = path.join(result.recoveryDirectory, 'event-00000.json');
  fs.appendFileSync(eventPath, '\n');
  assert.throws(() => discardAtlasRecovery({ ...selection, inspectedDigest: inspection.digest }), errorCode('stale'));
  assert.throws(() => inspectAtlasRecovery({ ...selection, atlasPath: 'different' }), errorCode('invalid-operation'));
  const activePath = path.join(result.recoveryDirectory, 'active.json');
  fs.writeFileSync(activePath, JSON.stringify({ contract: 'atlas.change-owner/1', host: os.hostname(), pid: process.pid }));
  const active = inspectAtlasRecovery(selection);
  assert.equal(active.inactive, false);
  assert.throws(() => discardAtlasRecovery({ ...selection, inspectedDigest: active.digest }), errorCode('recovery-active'));
  fs.unlinkSync(activePath);
  fs.writeFileSync(path.join(result.recoveryDirectory, 'unowned.txt'), 'Unrecognized user content.');
  assert.throws(() => inspectAtlasRecovery(selection), errorCode('invalid-operation'));
  fs.unlinkSync(path.join(result.recoveryDirectory, 'unowned.txt'));
  fs.unlinkSync(path.join(result.recoveryDirectory, 'manifest.json'));
  assert.throws(() => inspectAtlasRecovery(selection), errorCode('invalid-recovery'));
  assert.equal(fs.existsSync(path.join(result.recoveryDirectory, 'originals/0.bin')), true);
});

test('late recovery removal failure restores durable complete metadata for a fresh inspected discard', (t) => {
  const p = project(t), original = bytes(p);
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'Confirmed late cleanup' }) }]);
  const rmdir = fs.rmdirSync;
  const mock = t.mock.method(fs, 'rmdirSync', (directory) => {
    if (/\/change-[^/]+$/u.test(directory)) throw Object.assign(new Error('Controlled late cleanup failure'), { code: 'EIO' });
    return rmdir(directory);
  });
  const result = applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory });
  mock.mock.restore();
  assert.equal(result.status, 'applied');
  assert.equal(result.recovery.status, 'cleanup-failed');
  assert.match(result.gaps.join('\n'), /Controlled late cleanup failure/u);
  assert.deepEqual(fs.readdirSync(result.recoveryDirectory).sort(), ['manifest.json', 'plan.json']);
  const selection = { repositoryRoot: p.repositoryRoot, atlasPath: p.atlasPath, recoveryDirectory: result.recoveryDirectory };
  const inspection = inspectAtlasRecovery(selection);
  const savedPlan = JSON.parse(Buffer.from(inspection.files.find((file) => file.path === 'plan.json').bytesBase64, 'base64'));
  assert.deepEqual(Buffer.from(savedPlan.changes[0].before.bytesBase64, 'base64'), original);
  const savedSource = bytes(p);
  assert.equal(discardAtlasRecovery({ ...selection, inspectedDigest: inspection.digest }).status, 'discarded');
  assert.deepEqual(bytes(p), savedSource);
});


test('process interruption after one replacement leaves durable originals, plan, and temporary-file intent', (t) => {
  const p = project(t);
  const first = 'maps/architecture/map.md', second = 'maps/operations/map.md';
  const originalFirst = bytes(p, first), originalSecond = bytes(p, second);
  const request = { repositoryRoot: p.repositoryRoot, atlasPath: 'atlas', expected: { viewDigest: openAtlas(p.atlasRoot).identity.digest }, operations: [
    { type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { summary: 'Saved immediately before interruption.' }) },
    { type: 'map', action: 'update', id: 'operations', body: body(p, 'maps/operations/map.md', { summary: 'Not saved before interruption.' }) },
  ] };
  const moduleUrl = new URL('../src/authoring.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
import fs from 'node:fs';
import { prepareAtlasChange, applyAtlasChange } from ${JSON.stringify(moduleUrl)};
const { request, recoveryDirectory, firstPath } = JSON.parse(fs.readFileSync(0, 'utf8'));
const plan = prepareAtlasChange(request);
const rename = fs.renameSync;
fs.renameSync = (from, to) => { const value = rename(from, to); if (to === firstPath) process.kill(process.pid, 'SIGKILL'); return value; };
applyAtlasChange(plan, { recoveryDirectory });
`], { input: JSON.stringify({ request, recoveryDirectory: p.recoveryDirectory, firstPath: path.join(p.atlasRoot, first) }), encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.notDeepEqual(bytes(p, first), originalFirst);
  assert.deepEqual(bytes(p, second), originalSecond);
  const journal = path.join(p.recoveryDirectory, fs.readdirSync(p.recoveryDirectory)[0]);
  assert.deepEqual(fs.readFileSync(path.join(journal, 'originals/0.bin')), originalFirst);
  assert.deepEqual(fs.readFileSync(path.join(journal, 'originals/1.bin')), originalSecond);
  const savedPlan = JSON.parse(fs.readFileSync(path.join(journal, 'plan.json'), 'utf8'));
  assert.equal(savedPlan.changes.length, 2);
  const events = fs.readdirSync(journal).filter((name) => name.startsWith('event-')).map((name) => JSON.parse(fs.readFileSync(path.join(journal, name), 'utf8')));
  assert.ok(events.some((event) => event.status === 'writing' && event.path === first && event.temporary));
  const selection = { repositoryRoot: p.repositoryRoot, atlasPath: p.atlasPath, recoveryDirectory: journal };
  const inspected = inspectAtlasRecovery(selection);
  assert.equal(inspected.inactive, true);
  const currentFirst = bytes(p, first);
  assert.equal(discardAtlasRecovery({ ...selection, inspectedDigest: inspected.digest }).status, 'discarded');
  assert.deepEqual(bytes(p, first), currentFirst);
  assert.deepEqual(bytes(p, second), originalSecond);
});

test('failed recovery preparation never changes authored files and malformed configuration becomes stale', (t) => {
  const p = project(t), original = bytes(p);
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'Reviewed new title' }) }]);
  const open = fs.openSync;
  const mock = t.mock.method(fs, 'openSync', (file, ...args) => {
    if (typeof file === 'string' && file.startsWith(p.recoveryDirectory) && file.endsWith('/plan.json')) throw Object.assign(new Error('Controlled recovery write failure'), { code: 'EIO' });
    return open.call(fs, file, ...args);
  });
  assert.throws(() => applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }), /Controlled recovery write failure/u);
  assert.deepEqual(bytes(p), original);
  mock.mock.restore();
  fs.writeFileSync(path.join(p.repositoryRoot, 'atlas.workspace.json'), '{invalid');
  const result = applyAtlasChange(plan, { recoveryDirectory: path.join(p.repositoryRoot, 'other-recovery') });
  assert.equal(result.status, 'stale');
  assert.equal(fs.existsSync(path.join(p.repositoryRoot, 'other-recovery')), false);
});


test('recovery never creates an outside local source target or uses repository tmp as durable storage', (t) => {
  const p = project(t);
  const catalog = JSON.parse(bytes(p, 'catalog.json')); catalog.resources[0].uri = '../recovery';
  fs.writeFileSync(path.join(p.atlasRoot, 'catalog.json'), JSON.stringify(catalog));
  const plan = prepare(p, [{ type: 'map', action: 'update', id: 'architecture', body: body(p, 'maps/architecture/map.md', { summary: 'A reviewed edit.' }) }]);
  assert.throws(() => applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }), errorCode('invalid-operation'));
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
  const candidate = prepare(p, [{ type: 'resource', action: 'update', id: 'authentication-guide', set: { uri: '../candidate-recovery' } }]);
  assert.throws(() => applyAtlasChange(candidate, { recoveryDirectory: path.join(p.repositoryRoot, 'candidate-recovery') }), errorCode('invalid-operation'));
  assert.equal(fs.existsSync(path.join(p.repositoryRoot, 'candidate-recovery')), false);
  assert.throws(() => applyAtlasChange(plan, { recoveryDirectory: path.join(p.repositoryRoot, 'tmp/recovery') }), errorCode('invalid-operation'));
});

test('raw repairs retain every invalid UTF-8 byte in the reviewable baseline and labelled diff', (t) => {
  const p = project(t), original = bytes(p).toString('utf8');
  const invalid = Buffer.from([255, 254, 0, 65]);
  fs.writeFileSync(path.join(p.atlasRoot, anchor), invalid);
  const plan = prepare(p, [{ type: 'repair-document', path: anchor, text: original }]);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.changes[0].before.bytesBase64, invalid.toString('base64'));
  assert.match(plan.changes[0].diff, /base64 bytes/u);
  assert.ok(plan.changes[0].diff.includes(invalid.toString('base64')));
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
});


test('unified review diffs retain complete changes with bounded unchanged context', (t) => {
  const p = project(t), original = bytes(p).toString('utf8');
  const plan = prepare(p, [{ type: 'repair-document', path: anchor, text: `${original}\nA newly authored paragraph.\n` }]);
  const diff = plan.changes[0].diff;
  assert.match(diff, /\+A newly authored paragraph\./u);
  assert.ok(!diff.includes('"posture"'), 'Unchanged distant front matter need not be repeated.');
  assert.ok(diff.split('\n').length < 12);
  const withoutFinalNewline = prepare(p, [{ type: 'repair-document', path: anchor, text: original.slice(0, -1) }]);
  assert.match(withoutFinalNewline.changes[0].diff, /No newline at end of file/u);
  const revisedBody = original.replace('"id":', '"id" :').slice(0, -1);
  const both = prepare(p, [{ type: 'repair-document', path: anchor, text: revisedBody }]).changes[0].diff;
  assert.ok(both.includes(`+${revisedBody.split('\n').at(-1)}\n\\ No newline at end of file\n`), 'A concurrent ending-newline edit must not be hidden in shared context.');
});

test('missing and null public requests fail with structured authoring errors', async () => {
  for (const value of [undefined, null]) {
    assert.throws(() => prepareAtlasChange(value), errorCode('invalid-operation'));
    await assert.rejects(evaluatePreparedChange(value, { actor: { kind: 'human', id: 'reviewer' } }), errorCode('invalid-plan'));
  }
});


test('catalog and connection edits are coordinated with their exact Markdown owners and reject global drift', t => {
  const p = project(t), original = bytes(p);
  const operation = { type: 'connection', action: 'create', id: 'reviewed-reference', collection: 'references',
    set: { owner: { type: 'point', map: 'architecture', point: 'edge-authentication' }, target: { uri: 'https://example.com/review' }, role: 'evidence' },
    body: `${body(p).trimEnd()}\n\n## Connection: reviewed-reference\n\nThe reviewed source supports this exact record.\n` };
  const plan = prepare(p, [operation, { type: 'catalog', set: { points: [{ point: 'edge-authentication', kinds: ['decision'] }] } }]);
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.after.diagnostics));
  assert.deepEqual(plan.changes.map(change => change.path).sort(), ['catalog.json', 'connections.json', anchor].sort());
  assert.equal(plan.validation.after.normalized.points.find(point => point.id === 'edge-authentication').records[0].references.find(item => item.id === operation.id).note, 'The reviewed source supports this exact record.');
  fs.appendFileSync(path.join(p.atlasRoot, 'connections.json'), ' ');
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'stale');
  assert.deepEqual(bytes(p), original);
  assert.equal(fs.existsSync(p.recoveryDirectory), false);
});

test('renamed Point and Check files keep identity during structured edits and exact adoption', t => {
  const p = project(t), renamed = 'maps/architecture/points/local-name.md';
  fs.renameSync(path.join(p.atlasRoot, anchor), path.join(p.atlasRoot, renamed));
  const plan = prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, renamed, { title: 'Identity survives file naming' }) }]);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.changes.map(change => change.path), [renamed]);
  assert.equal(plan.pointDecisions[0].anchor.path, renamed);
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  const registration = { check: 'source-review', level: 'required', 'applies-to': ['point-anchor'] };
  const adopted = prepare(p, [{ type: 'adopt-check', id: 'source-review', text: checkText, registration, source: { uri: 'https://example.com/source-review' } }]);
  assert.equal(applyAtlasChange(adopted, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  fs.renameSync(path.join(p.atlasRoot, '.checks/source-review.md'), path.join(p.atlasRoot, '.checks/selected-policy.md'));
  const repeated = prepare(p, [{ type: 'adopt-check', id: 'source-review', text: checkText, registration, source: { uri: 'https://example.com/source-review' } }]);
  assert.equal(repeated.status, 'no-op');
  assert.equal(repeated.adoptedChecks[0].path, '.checks/selected-policy.md');
  assert.deepEqual(repeated.adoptedChecks[0].registration, registration);
});

test('same-id Point records retain preceding global edits and exact anchor provenance in operation order', t => {
  const p = project(t), context = 'maps/operations/points/edge-authentication.md';
  const unchanged = bytes(p, 'maps/operations/points/rotate-edge-keys.md');
  const plan = prepare(p, [
    { type: 'catalog', set: { extensions: [{ owner: { type: 'point', map: 'architecture', point: 'edge-authentication' }, values: { 'x-order': { earlier: 'catalog' } } }] } },
    { type: 'connection', action: 'update', collection: 'content', id: 'architecture-edge-authentication-content-authentication-guide', set: { target: { label: 'Earlier global edit' } } },
    { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', set: { 'x-order': { later: 'point' } }, body: body(p, anchor, { title: 'Updated canonical decision' }) },
    { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'operations', record: 'context', body: body(p, context, { title: 'Updated operational context' }) },
  ]);
  assert.equal(plan.status, 'ready', JSON.stringify(plan.validation.after.diagnostics));
  const point = plan.validation.after.normalized.points.find(item => item.id === 'edge-authentication');
  assert.deepEqual(point.extensions['x-order'], { earlier: 'catalog', later: 'point' });
  assert.equal(point.records.find(item => item.path === anchor).content[0].label, 'Earlier global edit');
  assert.equal(point.records.find(item => item.path === anchor).title, 'Updated canonical decision');
  assert.equal(point.records.find(item => item.path === context).title, 'Updated operational context');
  assert.deepEqual(plan.pointDecisions.map(item => [item.record, item.anchor.path, item.anchor.origin]), [
    ['anchor', anchor, 'baseline'], ['context', anchor, 'baseline'],
  ]);
  assert.deepEqual(plan.changes.map(item => item.path).sort(), ['catalog.json', 'connections.json', anchor, context].sort());
  assert.deepEqual(bytes(p, 'maps/operations/points/rotate-edge-keys.md'), unchanged);
});

test('selected identity lookup refuses duplicate records and anchors instead of choosing a match', async t => {
  for (const [name, damage] of [
    ['same Map records', p => fs.copyFileSync(path.join(p.atlasRoot, anchor), path.join(p.atlasRoot, 'maps/architecture/points/duplicate.md'))],
    ['anchors across Maps', p => fs.copyFileSync(path.join(p.atlasRoot, anchor), path.join(p.atlasRoot, 'maps/operations/points/edge-authentication.md'))],
    ['Map identities', p => fs.copyFileSync(path.join(p.atlasRoot, 'maps/architecture/map.md'), path.join(p.atlasRoot, 'maps/operations/map.md'))],
  ]) await t.test(name, child => {
    const p = project(child);
    damage(p);
    const original = bytes(p);
    assert.throws(() => prepare(p, [{ type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', body: body(p, anchor, { title: 'Ambiguous edit' }) }]),
      error => errorCode('invalid-operation')(error) && /ambiguous|exactly one/u.test(error.message));
    assert.deepEqual(bytes(p), original);
    assert.equal(fs.existsSync(p.recoveryDirectory), false);
  });
});

test('global raw repair retains invalid drafts and can restore a missing required file', t => {
  const p = project(t), original = bytes(p, 'connections.json');
  const invalid = prepare(p, [{ type: 'repair-document', path: 'connections.json', text: '{' }]);
  assert.equal(invalid.status, 'invalid');
  assert.equal(applyAtlasChange(invalid, { recoveryDirectory: p.recoveryDirectory, mode: 'draft' }).status, 'applied');
  const restored = prepare(p, [{ type: 'repair-document', path: 'connections.json', text: original.toString('utf8') }]);
  assert.equal(restored.status, 'ready');
  assert.equal(applyAtlasChange(restored, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  fs.unlinkSync(path.join(p.atlasRoot, 'connections.json'));
  const recreated = prepare(p, [{ type: 'repair-document', path: 'connections.json', text: original.toString('utf8') }]);
  assert.equal(recreated.status, 'ready');
  assert.equal(recreated.changes[0].operation, 'create');
});

test('new connection IDs are collision-safe and retained entries keep their declared IDs', t => {
  const p = project(t);
  const operation = { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor',
    set: { content: [{ uri: 'https://example.com/a/b' }, { uri: 'https://example.com/a-b' }] } };
  const plan = prepare(p, [operation]);
  assert.equal(plan.status, 'ready');
  const entries = plan.validation.after.normalized.points.find(point => point.id === 'edge-authentication').records[0].content;
  assert.equal(new Set(entries.map(item => item.id)).size, 2);
  assert.equal(applyAtlasChange(plan, { recoveryDirectory: p.recoveryDirectory }).status, 'applied');
  assert.equal(prepare(p, [operation]).status, 'no-op');
});


test('interleaved global owners preserve exact bytes on no-op and unrelated ordering on edits', t => {
  const p = project(t), file = path.join(p.atlasRoot, 'connections.json'), connections = JSON.parse(fs.readFileSync(file));
  const selected = connections.content.find(item => item.owner.type === 'point' && item.owner.point === 'edge-authentication' && item.owner.map === 'architecture');
  const unrelated = { id: 'other-owner-content', owner: { type: 'point', point: 'rotate-edge-keys', map: 'operations' }, target: { uri: 'https://example.com/other' } };
  const second = { id: 'second-selected-content', owner: selected.owner, target: { uri: 'https://example.com/second' } };
  connections.content = [selected, unrelated, second]; fs.writeFileSync(file, JSON.stringify(connections, null, 4) + '\n');
  const original = fs.readFileSync(file);
  const operation = { type: 'point', action: 'update', id: 'edge-authentication', mapId: 'architecture', record: 'anchor', set: {} };
  assert.equal(prepare(p, [operation]).status, 'no-op');
  assert.deepEqual(fs.readFileSync(file), original);
  const edited = prepare(p, [{ ...operation, set: { content: [{ id: selected.id, ...selected.target, label: 'Reviewed label' }, { id: second.id, ...second.target }] } }]);
  assert.equal(edited.status, 'ready');
  const changed = JSON.parse(Buffer.from(edited.changes.find(item => item.path === 'connections.json').after.bytesBase64, 'base64'));
  assert.deepEqual(changed.content.map(item => item.id), [selected.id, unrelated.id, second.id]);
});


test('structured global edits refuse duplicate properties and invalid UTF-8 instead of repairing them silently', t => {
  const p = project(t), file = path.join(p.atlasRoot, 'catalog.json'), original = fs.readFileSync(file);
  for (const source of [Buffer.from('{"x-duplicate":1,"x-duplicate":2}'), Buffer.concat([original, Buffer.from([0xff])]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original])]) {
    fs.writeFileSync(file, source);
    assert.throws(() => prepare(p, [{ type: 'catalog', set: { 'x-added': true } }]), errorCode('repair-required'));
    assert.deepEqual(fs.readFileSync(file), source);
    assert.equal(fs.existsSync(p.recoveryDirectory), false);
  }
});


test('ambiguous global owners cannot be silently collapsed by an unrelated structured edit', t => {
  const p = project(t), file = path.join(p.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(file));
  (catalog.extensions ??= []).push({ owner: { type: 'map', map: 'architecture' }, values: { 'x-one': 'first' } }, { owner: { map: 'architecture', type: 'map' }, values: { 'x-two': 'second' } });
  fs.writeFileSync(file, JSON.stringify(catalog));
  const original = fs.readFileSync(file);
  assert.throws(() => prepare(p, [{ type: 'map', action: 'update', id: 'architecture', set: { status: 'archived' } }]), errorCode('repair-required'));
  assert.deepEqual(fs.readFileSync(file), original);
});
