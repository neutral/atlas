import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateSource } from './model.mjs';
import { resolveState } from './state.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_REPORT = 4 * 1024 * 1024;
const copy = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requireValue(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'atlas.checks.invalid-argument' });
}
function object(value, fields, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  requireValue(Object.keys(value).every((key) => fields.includes(key)), `Unknown ${label} field.`);
}
function text(value, label, max = 16384) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} must be bounded nonblank text.`);
}
function identities(value, label) {
  requireValue(Array.isArray(value) && value.length <= 1000 && value.every((id) => typeof id === 'string' && ID.test(id)) && new Set(value).size === value.length, `${label} must contain unique Check IDs.`);
}
function outcome(value) {
  object(value, ['outcome', 'reason', 'evidence'], 'verification result');
  requireValue(['pass', 'fail', 'unable'].includes(value.outcome), 'Outcome must be pass, fail or unable.');
  text(value.reason, 'Result reason');
  requireValue(Array.isArray(value.evidence) && value.evidence.length <= 100, 'Evidence must be a bounded array.');
  requireValue(value.outcome === 'unable' || value.evidence.length > 0, 'Pass and fail require evidence.');
  for (const entry of value.evidence) {
    object(entry, ['text', 'source'], 'evidence');
    text(entry.text, 'Evidence text');
    requireValue(entry.source === undefined || validateSource(entry.source).valid, 'Evidence source is invalid.');
  }
  return copy(value);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function summarize(active, results) {
  const required = active.filter((check) => check.level === 'required');
  const requiredResults = required.map((check) => results.find((result) => result.id === check.id));
  const count = (value) => requiredResults.filter((result) => result?.outcome === value).length;
  return { total: required.length, passed: count('pass'), failed: count('fail'), unable: count('unable'),
    unreviewed: requiredResults.filter((result) => !result).length,
    satisfied: requiredResults.every((result) => result?.outcome === 'pass') };
}

/** Execute only explicitly supplied evaluators; Check prose never supplies authority. */
export async function evaluateChecks(view, input = {}) {
  object(input, ['checkIds', 'evaluators', 'manual', 'actor'], 'Check options');
  if (input.checkIds !== undefined) identities(input.checkIds, 'checkIds');
  if (input.actor !== undefined) text(input.actor, 'actor', 1024);
  let evaluators = input.evaluators ?? [], manual = input.manual ?? [];
  for (const [entries, label] of [[evaluators, 'evaluators'], [manual, 'manual']]) {
    requireValue(Array.isArray(entries) && entries.length <= 1000, `${label} must be a bounded array.`);
    const seen = new Set();
    for (const entry of entries) {
      object(entry, label === 'manual' ? ['id', 'revision', 'baseline', 'outcome', 'reason', 'evidence'] : ['id', 'revision', 'evaluate'], label);
      requireValue(typeof entry.id === 'string' && ID.test(entry.id) && !seen.has(entry.id), `${label} require unique Check IDs.`);
      requireValue(typeof entry.revision === 'string' && HASH.test(entry.revision), 'Exact Check revision is required.');
      seen.add(entry.id);
      if (label === 'manual') {
        requireValue(typeof entry.baseline === 'string' && HASH.test(entry.baseline), 'Manual results require an exact baseline.');
        outcome({ outcome: entry.outcome, reason: entry.reason, evidence: entry.evidence });
      } else requireValue(typeof entry.evaluate === 'function', 'Trusted evaluator must be a caller-supplied function.');
    }
  }
  requireValue(!manual.some((entry) => evaluators.some((evaluator) => evaluator.id === entry.id)), 'A Check cannot have both manual and evaluator results.');
  evaluators = evaluators.map(entry => ({ ...entry }));
  manual = copy(manual);
  const result = { format: 'atlas.check-run/1', id: randomUUID(), status: 'unavailable', createdAt: new Date().toISOString(),
    root: view?.root ?? null, baseline: view?.identity ?? null, actor: input.actor ?? null, active: [], selected: [], results: [],
    excluded: [], required: { total: 0, passed: 0, failed: 0, unable: 0, unreviewed: 0, satisfied: false }, requiredSatisfied: false,
    limits: ['Results cover the captured baseline and exact Check revisions only.', 'The Library records evidence supplied by the trusted evaluator or reviewer. Its accuracy requires separate assessment.', 'Check results address adopted requirements. Operational correctness and reader usefulness require their own evidence.'] };
  if (view?.format !== 'atlas.view/1' || view.status !== 'ready' || !view.atlas) return result;
  const active = view.atlas.checks.filter((check) => check.status === 'active');
  result.active = active.map(({ id, revision, level }) => ({ id, revision, level }));
  const requested = input.checkIds ?? active.map((check) => check.id);
  result.excluded = requested.filter((id) => !active.some((check) => check.id === id)).map((id) => ({ id, reason: 'The Check is missing or is not active.' }));
  const checks = active.filter((check) => requested.includes(check.id));
  result.selected = checks.map((check) => check.id);
  const frozenView = freeze(copy(view));
  for (const check of checks) {
    const supplied = manual.find((entry) => entry.id === check.id) ?? evaluators.find((entry) => entry.id === check.id);
    const method = supplied ? ('evaluate' in supplied ? 'evaluator' : 'manual') : 'unavailable';
    let verification;
    if (!supplied) verification = { outcome: 'unable', reason: 'No trusted evaluator or manual review was supplied.', evidence: [] };
    else if (supplied.revision !== check.revision || method === 'manual' && supplied.baseline !== view.identity) {
      verification = { outcome: 'unable', reason: 'The supplied revision or source baseline does not match this observation.', evidence: [] };
    } else {
      try {
        verification = outcome(method === 'manual'
          ? { outcome: supplied.outcome, reason: supplied.reason, evidence: supplied.evidence }
          : await supplied.evaluate({ view: frozenView, check: freeze(copy(check)), baseline: view.identity }));
      } catch (error) {
        verification = { outcome: 'unable', reason: `Verification failed: ${String(error?.message ?? error).slice(0, 2000)}`, evidence: [] };
      }
    }
    result.results.push({ id: check.id, revision: check.revision, level: check.level, baseline: view.identity, method, ...verification });
  }
  result.status = 'complete';
  result.required = summarize(result.active, result.results);
  result.requiredSatisfied = result.required.satisfied && result.excluded.length === 0;
  return result;
}

function validateRun(run) {
  object(run, ['format', 'id', 'status', 'createdAt', 'root', 'baseline', 'actor', 'active', 'selected', 'results', 'excluded', 'required', 'requiredSatisfied', 'limits'], 'Check run');
  requireValue(run.format === 'atlas.check-run/1' && run.status === 'complete' && ID.test(run.id) && HASH.test(run.baseline), 'Only a complete Check run can be retained.');
  text(run.root, 'Root');
  requireValue(typeof run.createdAt === 'string' && Number.isFinite(Date.parse(run.createdAt)), 'Run date is invalid.');
  requireValue(run.actor === null || typeof run.actor === 'string' && run.actor.trim().length > 0 && run.actor.length <= 1024, 'Run actor is invalid.');
  identities(run.selected, 'selected');
  requireValue(Array.isArray(run.active) && run.active.length <= 1000, 'Active Check inventory is invalid.');
  for (const check of run.active) {
    object(check, ['id', 'revision', 'level'], 'active Check');
    requireValue(ID.test(check.id) && HASH.test(check.revision) && ['required', 'advisory'].includes(check.level), 'Active Check identity is invalid.');
  }
  identities(run.active.map((check) => check.id), 'active');
  requireValue(run.selected.every((id) => run.active.some((check) => check.id === id)), 'Selection contains a non-active Check.');
  requireValue(Array.isArray(run.results) && run.results.length === run.selected.length, 'Results do not cover the selection.');
  identities(run.results.map((entry) => entry.id), 'results');
  for (const entry of run.results) {
    object(entry, ['id', 'revision', 'level', 'baseline', 'method', 'outcome', 'reason', 'evidence'], 'Check result');
    const check = run.active.find((item) => item.id === entry.id);
    requireValue(run.selected.includes(entry.id) && check?.revision === entry.revision && check.level === entry.level && entry.baseline === run.baseline && ['manual', 'evaluator', 'unavailable'].includes(entry.method), 'Result does not match the captured Check.');
    outcome({ outcome: entry.outcome, reason: entry.reason, evidence: entry.evidence });
    requireValue(entry.method !== 'unavailable' || entry.outcome === 'unable', 'Unavailable review cannot pass or fail.');
  }
  requireValue(Array.isArray(run.excluded) && run.excluded.length <= 1000, 'Excluded Check inventory is invalid.');
  for (const entry of run.excluded) { object(entry, ['id', 'reason'], 'excluded Check'); requireValue(ID.test(entry.id), 'Excluded Check identity is invalid.'); text(entry.reason, 'Excluded reason'); }
  requireValue(JSON.stringify(run.required) === JSON.stringify(summarize(run.active, run.results)) && run.requiredSatisfied === (run.required.satisfied && run.excluded.length === 0), 'Required summary does not match results.');
  requireValue(Array.isArray(run.limits) && run.limits.length <= 20, 'Run limits are invalid.');
  run.limits.forEach((entry) => text(entry, 'Run limit'));
}

/** Validate recorded evidence; this does not authenticate an actor or authorize a change. */
export function validateCheckRun(value) {
  const run = copy(value);
  validateRun(run);
  return run;
}

async function directory(root, create = false) {
  const state = await resolveState(root, { create });
  const canonical = state.root;
  let current = state.directory;
  for (const name of ['checks']) {
    current = path.join(current, name);
    if (create) await fs.mkdir(current, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    let entry;
    try { entry = await fs.lstat(current); } catch (error) { if (error.code === 'ENOENT' && !create) return { canonical, folder: null }; throw error; }
    requireValue(entry.isDirectory() && !entry.isSymbolicLink(), 'Check state must use regular directories.');
  }
  return { canonical, folder: current };
}

/** Retain an immutable report. Storage integrity is not reviewer authentication. */
export async function retainCheckRun(root, run) {
  run = copy(run);
  validateRun(run);
  const sourceRoot = await fs.realpath(run.root);
  const { canonical, folder } = await directory(root, true);
  requireValue(sourceRoot === canonical, 'Check run belongs to another root.');
  const report = { format: 'atlas.check-report/1', id: run.id, run: copy(run), digest: hash(run) };
  const content = `${JSON.stringify(report)}\n`;
  requireValue(Buffer.byteLength(content) <= MAX_REPORT, 'Check report exceeds the storage bound.');
  const file = await fs.open(path.join(folder, `${run.id}.json`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
  const handle = await fs.open(folder, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  return report;
}

export async function readCheckReport(root, id, options = {}) {
  requireValue(typeof id === 'string' && ID.test(id), 'Invalid report ID.');
  object(options, ['view'], 'report options');
  const { canonical, folder } = await directory(root);
  requireValue(folder !== null, 'Check report does not exist.');
  const handle = await fs.open(path.join(folder, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
  let report;
  try {
    const before = await handle.stat();
    requireValue(before.isFile() && before.nlink === 1 && before.size <= MAX_REPORT, 'Check report is not a bounded regular file.');
    const bytes = await handle.readFile('utf8');
    const after = await handle.stat();
    requireValue(before.size === after.size && before.mtimeMs === after.mtimeMs && Buffer.byteLength(bytes) <= MAX_REPORT, 'Check report changed while reading.');
    report = JSON.parse(bytes);
  } finally { await handle.close(); }
  object(report, ['format', 'id', 'run', 'digest'], 'Check report');
  requireValue(report.format === 'atlas.check-report/1' && report.id === id && report.run?.id === id && report.digest === hash(report.run), 'Check report integrity failed.');
  validateRun(report.run);
  requireValue(await fs.realpath(report.run.root) === canonical, 'Check report belongs to another root.');
  const view = options.view;
  const freshness = !view ? 'unknown' : view.status === 'ready' && view.identity === report.run.baseline && path.resolve(view.root) === path.resolve(root)
    && JSON.stringify(view.atlas.checks.filter((check) => check.status === 'active').map(({ id, revision, level }) => ({ id, revision, level }))) === JSON.stringify(report.run.active) ? 'current' : 'stale';
  return { ...report, freshness };
}

export async function listCheckReports(root) {
  const { folder } = await directory(root);
  if (!folder) return [];
  const names = (await fs.readdir(folder)).sort();
  requireValue(names.length <= 1000, 'Check report inventory exceeds 1000 entries.');
  const results = [];
  for (const name of names) {
    requireValue(name.endsWith('.json') && ID.test(name.slice(0, -5)), 'Unexpected file in Check report storage.');
    const report = await readCheckReport(root, name.slice(0, -5));
    results.push({ id: report.id, createdAt: report.run.createdAt, baseline: report.run.baseline, requiredSatisfied: report.run.requiredSatisfied, required: report.run.required });
  }
  return results;
}
