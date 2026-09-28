import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tempDirectory } from '../../tests/support/temp.mjs';
import path from 'node:path';
import { validateFiles } from '../src/model.mjs';
import { evaluateChecks, retainCheckRun, listCheckReports, readCheckReport } from '../src/checks.mjs';
import { resolveState } from '../src/state.mjs';

function fixture(root = '/tmp/atlas-check-fixture') {
  const files = new Map([['atlas.json', JSON.stringify({ format: 'atlas/1', id: 'example', title: 'Example', trees: [] })]]);
  for (const [id, status, level] of [['required', 'active', 'required'], ['advisory', 'active', 'advisory'], ['draft', 'draft', 'required'], ['retired', 'retired', 'required']]) {
    files.set(`.checks/${id}.md`, `---\n${JSON.stringify({ id, status, level })}\n---\n# ${id}\n\n## Requirement\nExplain the evidence boundary.\n\n## Verification\nReview the explanations.\n\n## Failure\nIdentify missing qualifications.\n`);
  }
  const view = validateFiles(files, { root });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return { view, files };
}
const evidence = [{ text: 'Reviewed all captured explanations against the declared requirement.', source: { uri: 'review.md', role: 'evidence' } }];
const verification = { outcome: 'pass', reason: 'The review found the required boundaries.', evidence };
const manual = (view, id = 'required', extra = {}) => ({ id, revision: view.atlas.checks.find((check) => check.id === id).revision, baseline: view.identity, ...verification, ...extra });

test('active-only evaluation binds trusted callbacks to immutable exact revisions', async () => {
  const { view } = fixture();
  let called = 0;
  const evaluators = view.atlas.checks.map((check) => ({ id: check.id, revision: check.revision, evaluate: async (context) => {
    called++;
    assert.equal(context.baseline, view.identity);
    assert.equal(context.check.status, 'active');
    assert.throws(() => { context.check.body = 'changed'; });
    assert.throws(() => { context.view.atlas.checks.push({}); });
    return verification;
  } }));
  const run = await evaluateChecks(view, { evaluators, actor: 'test reviewer' });
  assert.equal(called, 2);
  assert.equal(run.requiredSatisfied, true);
  assert.equal(run.required.total, 1);
  assert.deepEqual(run.selected, ['advisory', 'required']);
  assert.equal(run.results[0].method, 'evaluator');
  assert.equal(view.atlas.checks.length, 4);
});

test('unreviewed requirements, stale manual evidence and wrong evaluator revisions cannot qualify', async () => {
  const { view } = fixture();
  const partial = await evaluateChecks(view, { checkIds: ['advisory'], manual: [manual(view, 'advisory')] });
  assert.equal(partial.requiredSatisfied, false);
  assert.equal(partial.required.unreviewed, 1);
  const stale = await evaluateChecks(view, { manual: [manual(view, 'required', { baseline: '0'.repeat(64) })] });
  assert.equal(stale.results.find((result) => result.id === 'required').outcome, 'unable');
  assert.equal(stale.requiredSatisfied, false);
  let called = false;
  const wrongRevision = await evaluateChecks(view, { evaluators: [{ id: 'required', revision: '0'.repeat(64), evaluate() { called = true; return verification; } }] });
  assert.equal(called, false);
  assert.equal(wrongRevision.required.unable, 1);
  const noAuthority = await evaluateChecks(view);
  assert.ok(noAuthority.results.every((result) => result.outcome === 'unable'));
  const excluded = await evaluateChecks(view, { checkIds: ['draft', 'retired', 'missing'] });
  assert.deepEqual(excluded.results, []);
  assert.equal(excluded.excluded.length, 3);
});

test('actual failures remain failures; malformed or throwing callbacks are unable', async () => {
  const { view } = fixture();
  const failed = await evaluateChecks(view, { manual: [manual(view, 'required', { outcome: 'fail', reason: 'Required qualification is absent.' })] });
  assert.equal(failed.required.failed, 1);
  assert.equal(failed.requiredSatisfied, false);
  for (const evaluate of [() => ({ outcome: 'pass', reason: 'Unsupported assertion', evidence: [] }), () => { throw new Error('Review service unavailable'); }, () => ({ ...verification, execute: 'script' })]) {
    const run = await evaluateChecks(view, { evaluators: [{ id: 'required', revision: manual(view).revision, evaluate }] });
    assert.equal(run.required.unable, 1);
    assert.equal(run.requiredSatisfied, false);
  }
  await assert.rejects(evaluateChecks(view, { manual: [manual(view, 'required', { evidence: [] })] }), /require evidence/);
  await assert.rejects(evaluateChecks(view, { evaluators: [{ id: 'required', revision: manual(view).revision, evaluate: 'source-owned-code.mjs' }] }), /caller-supplied function/);
  await assert.rejects(evaluateChecks(view, { runSourceCode: true }), /Unknown/);
});

test('asynchronous review retains the caller-selected evaluator registrations', async () => {
  const { view } = fixture();
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  const evaluators = view.atlas.checks.filter(check => check.status === 'active').map(check => ({
    id: check.id, revision: check.revision, evaluate: async () => {
      if (check.id === 'advisory') await pending;
      return verification;
    },
  }));
  const run = evaluateChecks(view, { evaluators });
  evaluators.find(entry => entry.id === 'required').evaluate = () => { throw new Error('Replacement callback'); };
  evaluators.length = 0;
  resume();
  const result = await run;
  assert.equal(result.requiredSatisfied, true);
  assert.equal(result.results.find(entry => entry.id === 'required').outcome, 'pass');
});

test('reports survive module reload, remain baseline-specific and detect changed storage', async () => {
  const root = await tempDirectory('atlas-checks-');
  try {
    const { view, files } = fixture(root);
    const run = await evaluateChecks(view, { manual: [manual(view)] });
    const report = await retainCheckRun(root, run);
    const restarted = await import(`../src/checks.mjs?restart=${Date.now()}`);
    assert.equal((await restarted.readCheckReport(root, report.id, { view })).freshness, 'current');
    assert.equal((await restarted.listCheckReports(root))[0].requiredSatisfied, true);
    const next = new Map(files); next.set('atlas.json', files.get('atlas.json').replace('Example', 'Changed'));
    assert.equal((await readCheckReport(root, report.id, { view: validateFiles(next, { root }) })).freshness, 'stale');
    await assert.rejects(retainCheckRun(root, run), { code: 'EEXIST' });
    const filename = path.join((await resolveState(root)).directory, 'checks', `${report.id}.json`);
    const changed = JSON.parse(await fs.readFile(filename, 'utf8'));
    changed.run.results[0].reason = 'Rewritten evidence';
    await fs.writeFile(filename, JSON.stringify(changed));
    await assert.rejects(readCheckReport(root, report.id), /integrity/);
    await assert.rejects(readCheckReport(root, '../private'), /Invalid report ID/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('report storage refuses symlinks and falsified summaries', async () => {
  const root = await tempDirectory('atlas-checks-');
  const elsewhere = await tempDirectory('atlas-checks-other-');
  try {
    const { view } = fixture(root);
    const run = await evaluateChecks(view);
    await assert.rejects(retainCheckRun(root, { ...run, requiredSatisfied: true }), /summary/);
    const state = await resolveState(root, { create: true });
    await fs.symlink(elsewhere, path.join(state.directory, 'checks'));
    await assert.rejects(retainCheckRun(root, run), /regular directories/);
    assert.deepEqual(await fs.readdir(elsewhere), []);
    await fs.unlink(path.join(state.directory, 'checks'));
    const report = await retainCheckRun(root, run);
    const filename = path.join(state.directory, 'checks', `${report.id}.json`);
    await fs.rename(filename, path.join(elsewhere, 'report.json'));
    await fs.symlink(path.join(elsewhere, 'report.json'), filename);
    await assert.rejects(readCheckReport(root, report.id));
    await assert.rejects(listCheckReports(root));
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(elsewhere, { recursive: true, force: true }); }
});
