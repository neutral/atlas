import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AtlasToolError, openAtlas } from '../src/view.mjs';
import { openWorkspace } from '../src/workspace.mjs';
import { calculateCheckRevision, createEvaluatorRegistry, discoverChecks, evaluateChecks } from '../src/evaluation.mjs';
import { readCheckReport, retainCheckReport } from '../src/evaluation-report.mjs';
import { validators } from '../src/schemas.mjs';

const fixture = fileURLToPath(new URL('../../spec/examples/valid/cross-map', import.meta.url));
const actor = { kind: 'tool', id: 'qualification/question-punctuation' };
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const errorCode = (code) => (error) => error instanceof AtlasToolError && error.code === code;

function sample(t) {
  const repositoryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-evaluation-')));
  t.after(() => fs.rmSync(repositoryRoot, { force: true, recursive: true }));
  const atlasRoot = path.join(repositoryRoot, 'atlas');
  fs.cpSync(fixture, atlasRoot, { recursive: true });
  fs.rmSync(path.join(atlasRoot, '.checks'), { recursive: true });
  fs.mkdirSync(path.join(atlasRoot, '.checks'), { recursive: true });
  const catalogPath = path.join(atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  delete catalog.checks; fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  return { repositoryRoot, atlasRoot, directory: path.join(repositoryRoot, 'evidence', 'run') };
}

function check(root, id = 'questions', { status = 'active', level = 'required', appliesTo = ['map'] } = {}) {
  const metadata = { type: 'check', id, status };
  const registration = { check: id, level, 'applies-to': appliesTo };
  const catalogPath = path.join(root, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  catalog.checks = [...(catalog.checks ?? []).filter(item => item.check !== id), registration];
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  const bytes = `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n# Question punctuation ${id}\n\nUse question marks in the selected Map questions.\n\n## Requirement\n\nEvery selected Map question ends with a question mark.\n\n## Verification\n\nRead each selected Map question and inspect its final non-whitespace character. Record the exact question and result.\n\n## Failure\n\nIdentify every selected Map whose question lacks the final question mark.\n`;
  fs.writeFileSync(path.join(root, '.checks', `${id}.md`), bytes);
  return { id, revision: calculateCheckRevision(bytes, registration) };
}

function verifyQuestions({ view, subjects }) {
  const observed = subjects.map((subject) => ({ path: subject.path,
    question: view.validation.normalized.maps.find((map) => map.id === subject.id).question }));
  const failed = observed.filter((item) => !item.question.trimEnd().endsWith('?'));
  return { outcome: failed.length ? 'fail' : 'pass', summary: failed.length ? 'Map questions lack final punctuation.' : 'Every selected Map question ends with a question mark.',
    evidence: [{ summary: 'Exact Map questions and observed final punctuation.', data: JSON.stringify(observed), mediaType: 'application/json' }],
    diagnostics: failed.map((item) => ({ path: item.path, message: 'The Map question does not end with a question mark.' })) };
}

function registry(binding, verify = verifyQuestions, capabilities = []) {
  return createEvaluatorRegistry([{ id: 'question-punctuation', version: '1', checks: Array.isArray(binding) ? binding : [binding], capabilities, verify }]);
}

test('discovery reads adopted exact Check bytes and never executes or adopts an evaluator', async (t) => {
  const { atlasRoot } = sample(t), binding = check(atlasRoot);
  let invocations = 0;
  const registered = registry(binding, (context) => { invocations++; return verifyQuestions(context); });
  const view = openAtlas(atlasRoot), found = discoverChecks(view, { registry: registered, status: 'active', level: 'required', appliesTo: 'map' });
  assert.equal(found.items[0].revision, binding.revision);
  assert.equal(found.items[0].evaluator.id, 'question-punctuation');
  assert.equal(found.items[0].subjects.length, 2);
  assert.equal(invocations, 0);
  assert.ok(Object.isFrozen(found.items[0].evaluator.checks));
  const unsupported = await evaluateChecks(view, { actor });
  assert.equal(unsupported.evaluations[0].outcome, 'unable');
  assert.equal(unsupported.requiredSatisfied, false);
  assert.equal(invocations, 0);
  fs.appendFileSync(path.join(atlasRoot, '.checks/questions.md'), '\nAn authored clarification.\n');
  const changed = await evaluateChecks(view.refresh(), { actor, registry: registered });
  assert.notEqual(changed.evaluations[0].revision, binding.revision);
  assert.equal(changed.evaluations[0].outcome, 'unable');
  assert.equal(invocations, 0);
});

test('trusted verification measures the actual custom Requirement and yields pass and fail on valid inputs', async (t) => {
  const { atlasRoot, directory } = sample(t), binding = check(atlasRoot), registered = registry(binding);
  const view = openAtlas(atlasRoot), run = await evaluateChecks(view, { actor, registry: registered });
  assert.equal(run.status, 'evaluated');
  assert.equal(run.requiredSatisfied, true);
  assert.equal(run.wholeAtlasCompliant, true);
  assert.equal(run.evaluations[0].outcome, 'pass');
  assert.equal(run.evaluations[0].actor.id, actor.id);
  assert.equal(run.evaluations[0].evaluator.invoked, true);
  assert.deepEqual(JSON.parse(Buffer.from(run.evaluations[0].evidence[0].bytesBase64, 'base64')), view.validation.normalized.maps.map((map) => ({ path: map.path, question: map.question })));
  assert.ok(Object.isFrozen(run.validation.normalized.maps[0]));
  assert.throws(() => { run.evaluations[0].subjects[0].path = 'forged'; }, TypeError);
  assert.equal(fs.existsSync(directory), false, 'Ordinary verification creates no retained report.');
  const file = path.join(atlasRoot, 'maps/architecture/map.md');
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, source.replace(/(## Question\n\n[^\n]*)\?/u, '$1.'));
  const failed = await evaluateChecks(view.refresh(), { actor, registry: registered });
  assert.equal(failed.validation.valid, true);
  assert.equal(failed.evaluations[0].outcome, 'fail');
  assert.equal(failed.requiredSatisfied, false);
  assert.deepEqual(failed.evaluations[0].diagnostics.map((item) => item.path), ['maps/architecture/map.md']);
});

test('partial paths and omitted required Checks remain visible and never claim whole Atlas compliance', async (t) => {
  const { atlasRoot } = sample(t), binding = check(atlasRoot), registered = registry(binding), view = openAtlas(atlasRoot);
  const partial = await evaluateChecks(view, { actor, registry: registered, paths: ['maps/architecture/map.md'] });
  assert.equal(partial.requiredSatisfied, true, 'The result explicitly covers selected subjects only.');
  assert.equal(partial.wholeAtlasCompliant, false);
  assert.equal(partial.evaluations[0].subjects.length, 1);
  assert.deepEqual(partial.coverage.uncoveredSubjects[0], { check: 'questions', status: 'active', level: 'required',
    subjects: [{ kind: 'map', id: 'operations', path: 'maps/operations/map.md' }] });
  const omitted = await evaluateChecks(view, { actor, registry: registered, checkIds: [] });
  assert.equal(omitted.requiredSatisfied, false);
  assert.equal(omitted.coverage.omittedChecks[0].id, 'questions');
  const missing = await evaluateChecks(view, { actor, registry: registered, paths: ['removed.md'] });
  assert.equal(missing.requiredSatisfied, false);
  assert.deepEqual(missing.coverage.unresolvedPaths, ['removed.md']);
  await assert.rejects(evaluateChecks(view, { actor, checkIds: ['not-adopted'] }), errorCode('atlas.tools.invalid-argument'));
});

test('advisory inability does not block ordinary required satisfaction but keeps audit completeness conservative', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot);
  check(setup.atlasRoot, 'advisory', { level: 'advisory' });
  check(setup.atlasRoot, 'draft', { status: 'draft' });
  check(setup.atlasRoot, 'retired', { status: 'retired' });
  const view = openAtlas(setup.atlasRoot), run = await evaluateChecks(view, { actor, registry: registry(binding) });
  assert.equal(run.requiredSatisfied, true);
  assert.equal(run.wholeAtlasCompliant, true);
  assert.equal(run.complete, false);
  assert.deepEqual(run.evaluations.map((item) => [item.check, item.outcome]), [
    ['advisory', 'unable'], ['draft', 'not-applicable'], ['questions', 'pass'], ['retired', 'not-applicable'],
  ]);
  const retained = retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot });
  assert.equal(retained.report.complete, false);
  assert.equal(retained.report.compliant, false);
  assert.equal(validators.checkEvaluation(retained.report), true);
});

test('host capability grants are explicit and snapshotted across asynchronous callbacks', async (t) => {
  const { atlasRoot } = sample(t), a = check(atlasRoot, 'a'), b = check(atlasRoot, 'b');
  let release, started;
  const pending = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  let invoked = 0;
  const registered = registry([a, b], async (context) => {
    invoked++;
    if (invoked === 1) { started(); await pending; }
    assert.equal(await context.capabilities.observe(), 'original');
    assert.equal(Object.hasOwn(context.capabilities, 'unrequested'), false);
    return verifyQuestions(context);
  }, ['observe']);
  const view = openAtlas(atlasRoot), absent = await evaluateChecks(view, { actor, registry: registered });
  assert.equal(absent.evaluations[0].outcome, 'unable');
  assert.equal(absent.evaluations[0].evaluator.invoked, false);
  assert.equal(invoked, 0);
  const capabilities = { observe: () => 'original', unrequested: () => 'not granted' };
  const options = { actor: { kind: 'agent', id: 'host-session' }, registry: registered, capabilities };
  const evaluating = evaluateChecks(view, options);
  await entered;
  capabilities.observe = () => 'mutated';
  options.actor.id = 'mutated';
  release();
  const run = await evaluating;
  assert.equal(run.requiredSatisfied, true);
  assert.equal(run.actor.id, 'host-session');
  assert.equal(invoked, 2);
});

test('callback failure, interruption, missing evidence, and forged authority become unable', async (t) => {
  const { atlasRoot } = sample(t), binding = check(atlasRoot), view = openAtlas(atlasRoot);
  for (const verify of [() => { throw null; }, () => { throw undefined; }, () => ({ outcome: 'pass', summary: 'Claim', evidence: [], diagnostics: [] }),
    () => ({ outcome: 'pass', summary: 'Claim', evidence: ['Claim'], diagnostics: [], actor: { kind: 'human', id: 'forged' } }),
    () => ({ outcome: 'not-applicable', summary: 'Bypass', evidence: [], diagnostics: [] })]) {
    const run = await evaluateChecks(view, { actor, registry: registry(binding, verify) });
    assert.equal(run.evaluations[0].outcome, 'unable');
    assert.equal(run.requiredSatisfied, false);
    assert.equal(run.evaluations[0].actor.id, actor.id);
  }
  const controller = new AbortController();
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const pending = evaluateChecks(view, { actor, registry: registry(binding, () => { started(); return new Promise(() => {}); }), signal: controller.signal });
  await entered;
  controller.abort();
  assert.match((await pending).evaluations[0].diagnostics[0].message, /interrupted/u);
});

test('source changes during verification retain the captured result but prevent current compliance', async (t) => {
  const { atlasRoot } = sample(t), binding = check(atlasRoot), view = openAtlas(atlasRoot);
  const run = await evaluateChecks(view, { actor, registry: registry(binding, (context) => {
    fs.writeFileSync(path.join(atlasRoot, 'untracked.md'), 'New source during Verification.');
    return verifyQuestions(context);
  }) });
  assert.equal(run.evaluations[0].outcome, 'pass');
  assert.equal(run.status, 'stale');
  assert.equal(run.requiredSatisfied, false);
  assert.equal(run.complete, false);
});

test('invalid and incomplete observations expose validation and create no synthetic Check', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot);
  fs.writeFileSync(path.join(setup.atlasRoot, 'maps/architecture/points/edge-authentication.md'), 'An invalid draft.');
  let invoked = 0;
  const registered = registry(binding, () => { invoked++; throw new Error('must not run'); });
  for (const view of [openAtlas(setup.atlasRoot), openAtlas(setup.atlasRoot, { maxDocumentBytes: 1 })]) {
    const run = await evaluateChecks(view, { actor, registry: registered });
    assert.ok(['invalid', 'incomplete'].includes(run.status));
    assert.equal(run.validation.valid, false);
    assert.equal(run.requiredSatisfied, false);
    assert.deepEqual(run.evaluations, []);
    assert.throws(() => retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot }), errorCode('atlas.evaluation.unretainable-run'));
  }
  assert.equal(invoked, 0);
  assert.equal(fs.existsSync(setup.directory), false);
});

test('retention writes original text and binary evidence with verified hashes and no further Verification', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot), view = openAtlas(setup.atlasRoot);
  const binary = Uint8Array.from([0, 255, 13, 10]), original = Buffer.from(binary);
  let invocations = 0;
  const run = await evaluateChecks(view, { actor, registry: registry(binding, (context) => {
    invocations++;
    const result = verifyQuestions(context);
    result.evidence.push({ summary: 'Original callback binary observation.', data: binary });
    return result;
  }) });
  binary.fill(99);
  const retained = retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot });
  assert.equal(retained.report.baseline, `sha256:${view.identity.digest}`);
  assert.deepEqual(retained.report.changeSet.paths, ['.']);
  const read = readCheckReport(setup.directory, { view });
  assert.equal(read.integrity, 'verified');
  assert.equal(read.authenticity, 'not-authenticated');
  assert.equal(read.freshness.status, 'fresh');
  assert.equal(read.report.compliant, true);
  assert.deepEqual(read.report.evaluator, { name: 'atlas-check-evaluator', version: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version });
  assert.deepEqual(Buffer.from(read.evidence[1].bytesBase64, 'base64'), original);
  assert.equal(read.evidence[1].sha256, hash(original));
  assert.equal(invocations, 1);
  assert.throws(() => retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot }), errorCode('atlas.evaluation.report-unavailable'));
  assert.throws(() => retainCheckReport(JSON.parse(JSON.stringify(run)), setup), errorCode('atlas.tools.invalid-argument'));
  assert.equal(readCheckReport(setup.directory).freshness.status, 'unavailable');
});

test('report freshness detects source and exact Check revisions without running an evaluator', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot), view = openAtlas(setup.atlasRoot);
  const run = await evaluateChecks(view, { actor, registry: registry(binding) });
  retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot });
  fs.appendFileSync(path.join(setup.atlasRoot, '.checks/questions.md'), '\nRevision clarification.\n');
  assert.equal(readCheckReport(setup.directory, { view }).freshness.status, 'historical');
  const checked = readCheckReport(setup.directory, { view: view.refresh() });
  assert.equal(checked.freshness.status, 'historical');
  assert.deepEqual(checked.freshness.checkChanges, ['questions']);
  assert.equal(checked.report.evaluations[0].revision, binding.revision);
});

test('retention refuses authored sources, repository tmp, obsolete options, mutable baselines, and existing content', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot);
  const run = await evaluateChecks(openAtlas(setup.atlasRoot), { actor, registry: registry(binding) });
  for (const directory of [path.join(setup.atlasRoot, '.checks/run'), path.join(setup.atlasRoot, 'evidence/run'),
    path.join(setup.repositoryRoot, 'tmp/reports/run')]) {
    assert.throws(() => retainCheckReport(run, { directory, repositoryRoot: setup.repositoryRoot }), errorCode('atlas.evaluation.unsafe-report-directory'));
    assert.equal(fs.existsSync(directory), false);
  }
  assert.throws(() => retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot, cacheDirectory: path.join(setup.repositoryRoot, 'cache') }), errorCode('atlas.tools.invalid-argument'));
  assert.throws(() => retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot, baseline: 'HEAD' }), errorCode('atlas.tools.invalid-argument'));
  fs.mkdirSync(setup.directory, { recursive: true });
  fs.writeFileSync(path.join(setup.directory, 'sentinel'), 'Keep authored evidence.');
  assert.throws(() => retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot }), errorCode('atlas.evaluation.report-unavailable'));
  assert.equal(fs.readFileSync(path.join(setup.directory, 'sentinel'), 'utf8'), 'Keep authored evidence.');
});

test('outside local target metadata prevents report creation without reading those source paths', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot);
  const rootFile = path.join(setup.atlasRoot, 'catalog.json');
  fs.writeFileSync(rootFile, fs.readFileSync(rootFile, 'utf8').replace('docs/authentication.md', '../evidence/run/report.json'));
  const view = openAtlas(setup.atlasRoot);
  assert.equal(view.status, 'ready');
  const run = await evaluateChecks(view, { actor, registry: registry(binding) });
  for (const method of ['readFileSync', 'openSync', 'lstatSync', 'statSync', 'realpathSync']) {
    const original = fs[method];
    t.mock.method(fs, method, (file, ...args) => {
      assert.notEqual(file, path.join(setup.directory, 'report.json'), 'Outside target bytes and metadata must remain unexamined.');
      return original.call(fs, file, ...args);
    });
  }
  assert.throws(() => retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot }), errorCode('atlas.evaluation.unsafe-report-directory'));
  assert.equal(fs.existsSync(setup.directory), false);
});

test('retained corruption, traversal, symlinks, and interrupted bundles never read as verified', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot);
  const run = await evaluateChecks(openAtlas(setup.atlasRoot), { actor, registry: registry(binding) });
  for (const [index, mutate] of [
    (directory) => fs.appendFileSync(path.join(directory, 'report.json'), ' '),
    (directory) => fs.appendFileSync(path.join(directory, 'evidence/1-1.bin'), 'Poison'),
    (directory) => fs.unlinkSync(path.join(directory, 'provenance.json')),
    (directory) => { const file = path.join(directory, 'provenance.json'), data = JSON.parse(fs.readFileSync(file)); data.evidence[0].file = '../atlas/atlas.md'; fs.writeFileSync(file, JSON.stringify(data)); },
    (directory) => { const file = path.join(directory, 'provenance.json'), data = JSON.parse(fs.readFileSync(file)); data.run.coverage.wholeAtlas = 'yes'; fs.writeFileSync(file, JSON.stringify(data)); },
    (directory) => { fs.unlinkSync(path.join(directory, 'evidence/1-1.bin')); fs.symlinkSync(path.join(setup.atlasRoot, 'atlas.md'), path.join(directory, 'evidence/1-1.bin')); },
  ].entries()) {
    const directory = path.join(setup.repositoryRoot, 'evidence', `corruption-${index}`);
    retainCheckReport(run, { directory, repositoryRoot: setup.repositoryRoot });
    mutate(directory);
    assert.throws(() => readCheckReport(directory), errorCode('atlas.evaluation.invalid-report'));
  }
});

test('workspace closure and refresh preserve retained evidence and its source identity', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot);
  const workspace = openWorkspace({ repositoryRoot: setup.repositoryRoot, atlasPath: 'atlas' });
  t.after(() => workspace.close());
  const run = await evaluateChecks(workspace.read().view, { actor, registry: registry(binding) });
  retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot });
  const bytes = fs.readFileSync(path.join(setup.directory, 'provenance.json'));
  workspace.close();
  const reopened = openWorkspace({ repositoryRoot: setup.repositoryRoot, atlasPath: 'atlas' });
  t.after(() => reopened.close());
  const rebuilt = reopened.refresh();
  assert.deepEqual(fs.readFileSync(path.join(setup.directory, 'provenance.json')), bytes);
  assert.equal(readCheckReport(setup.directory, { view: rebuilt.view }).freshness.status, 'fresh');
});

test('public arguments and duplicate exact evaluator claims reject stable misuse', async (t) => {
  const setup = sample(t), binding = check(setup.atlasRoot), view = openAtlas(setup.atlasRoot);
  for (const options of [null, [], { actor: null }, { actor, paths: ['../outside'] }, { actor, registry: {} }, { actor, unknown: true }]) {
    await assert.rejects(evaluateChecks(view, options), errorCode('atlas.tools.invalid-argument'));
  }
  assert.throws(() => discoverChecks(view, null), errorCode('atlas.tools.invalid-argument'));
  assert.throws(() => createEvaluatorRegistry([{ id: 'a', version: '1', checks: [binding], verify: verifyQuestions },
    { id: 'b', version: '1', checks: [binding], verify: verifyQuestions }]), errorCode('atlas.tools.invalid-argument'));
  assert.throws(() => readCheckReport(setup.directory, null), errorCode('atlas.tools.invalid-argument'));
  await assert.rejects(evaluateChecks({ ...view }, { actor }), errorCode('atlas.tools.invalid-argument'));
  assert.throws(() => readCheckReport(setup.directory, { view: { ...view } }), errorCode('atlas.tools.invalid-argument'));
});


test('catalog Check registration changes invalidate evaluator support and retained receipts without changing Markdown', async t => {
  const setup = sample(t), binding = check(setup.atlasRoot), view = openAtlas(setup.atlasRoot);
  const run = await evaluateChecks(view, { actor, registry: registry(binding) });
  retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot });
  const checkBytes = fs.readFileSync(path.join(setup.atlasRoot, '.checks/questions.md'));
  const catalogPath = path.join(setup.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  catalog.checks.find(item => item.check === 'questions').level = 'advisory';
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  const current = view.refresh(), changed = await evaluateChecks(current, { actor, registry: registry(binding) });
  assert.equal(changed.evaluations[0].outcome, 'unable');
  assert.notEqual(changed.evaluations[0].revision, binding.revision);
  assert.deepEqual(fs.readFileSync(path.join(setup.atlasRoot, '.checks/questions.md')), checkBytes);
  assert.deepEqual(readCheckReport(setup.directory, { view: current }).freshness.checkChanges, ['questions']);
});

test('Check revision canonicalizes registration object keys while retaining every declared value', () => {
  const first = { check: 'example', level: 'required', 'applies-to': ['map'], 'x-origin': { b: 2, a: 1 } };
  const reordered = { 'x-origin': { a: 1, b: 2 }, 'applies-to': ['map'], level: 'required', check: 'example' };
  assert.equal(calculateCheckRevision('exact bytes', first), calculateCheckRevision('exact bytes', reordered));
  assert.notEqual(calculateCheckRevision('exact bytes', first), calculateCheckRevision('exact bytes\n', first));
  assert.notEqual(calculateCheckRevision('exact bytes', first), calculateCheckRevision('exact bytes', { ...first, 'x-origin': { a: 1, b: 3 } }));
});


test('selecting either shared authoring file conservatively evaluates all assembled subjects without widening the declared scope', async t => {
  const { atlasRoot } = sample(t), binding = check(atlasRoot), view = openAtlas(atlasRoot);
  for (const selected of ['catalog.json', 'connections.json']) {
    const discovery = discoverChecks(view, { paths: [selected] });
    assert.equal(discovery.items[0].subjects.length, 2);
    const run = await evaluateChecks(view, { actor, registry: registry(binding), paths: [selected] });
    assert.equal(run.evaluations[0].subjects.length, 2);
    assert.equal(run.requiredSatisfied, true);
    assert.equal(run.wholeAtlasCompliant, false);
    assert.deepEqual(run.scope.paths, [selected]);
    assert.match(run.limits.join(' '), /conservatively includes all assembled subjects/u);
  }
  const catalogFile = path.join(atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogFile));
  catalog.checks[0]['applies-to'] = ['point-anchor'];
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  const changed = await evaluateChecks(view.refresh(), { actor, registry: registry(binding), paths: ['catalog.json'] });
  assert.equal(changed.evaluations[0].subjects.length, 2);
  assert.equal(changed.evaluations[0].outcome, 'unable');
  assert.equal(changed.requiredSatisfied, false);
});


test('a Check-owned catalog extension changes exact evaluator support and retained freshness', async t => {
  const setup = sample(t), binding = check(setup.atlasRoot), view = openAtlas(setup.atlasRoot);
  const run = await evaluateChecks(view, { actor, registry: registry(binding) });
  retainCheckReport(run, { directory: setup.directory, repositoryRoot: setup.repositoryRoot });
  const catalogFile = path.join(setup.atlasRoot, 'catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogFile));
  (catalog.extensions ??= []).push({ owner: { type: 'check', check: 'questions' }, values: { 'x-review-boundary': 'Whole declared Map question.' } });
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  const current = view.refresh(), revised = await evaluateChecks(current, { actor, registry: registry(binding) });
  assert.equal(current.validation.normalized.checks[0].registration['x-review-boundary'], 'Whole declared Map question.');
  assert.notEqual(revised.evaluations[0].revision, binding.revision);
  assert.equal(revised.evaluations[0].outcome, 'unable');
  assert.deepEqual(readCheckReport(setup.directory, { view: current }).freshness.checkChanges, ['questions']);
});
