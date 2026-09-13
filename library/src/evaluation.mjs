import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { AtlasToolError, localSourceTargets } from './view.mjs';
import { compareCodePoints as compare } from './model.mjs';
import { capturedChecks } from './check-discovery.mjs';

const registries = new WeakMap(), runs = new WeakSet(), sources = new WeakMap();
const kinds = ['atlas', 'map', 'area', 'point-anchor', 'point-context', 'resource', 'check', 'publication'];
const outcomes = ['pass', 'fail', 'unable', 'not-applicable'];
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const message = (error) => error instanceof Error ? error.message : String(error);
const unique = (values) => [...new Set(values)].sort(compare);

function argument(condition, text) {
  if (!condition) throw new AtlasToolError('atlas.tools.invalid-argument', text);
}


function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]));
  return value;
}
/** Exact Markdown bytes and the assembled catalog registration define evaluator support. */
export function calculateCheckRevision(bytes, registration) {
  argument((typeof bytes === 'string' || bytes instanceof Uint8Array) && plain(registration)
    && nonblank(registration.check), 'Check revision requires exact Markdown bytes and its catalog registration.');
  return checkRevisionFromDigest(digest(bytes).slice(7), registration);
}
export function checkRevisionFromDigest(markdownSha256, registration) {
  argument(/^[a-f0-9]{64}$/u.test(markdownSha256) && plain(registration) && nonblank(registration.check), 'Check revision requires complete Markdown and catalog registration identities.');
  return digest(`atlas.check-revision/2\n${markdownSha256}\n${JSON.stringify(canonical(registration))}`);
}
export function checkRevisionForView(view, check) {
  const file = view.identity.inputs.find(input => input.path === check.path && input.kind === 'file');
  return file && check.registration ? checkRevisionFromDigest(file.sha256, check.registration) : null;
}

export function freezeEvaluation(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeEvaluation);
    Object.freeze(value);
  }
  return value;
}

function objectOptions(value, fields) {
  argument(plain(value) && Object.keys(value).every((key) => fields.includes(key)), 'Unsupported evaluation options.');
}

function viewArgument(view) {
  argument(view?.contract === 'atlas.read-view/2' && plain(view.identity) && plain(view.validation)
    && typeof view.readDocument === 'function' && typeof view.freshness === 'function', 'An opened Atlas view is required.');
  localSourceTargets(view);
}

function pathsOption(paths = ['.']) {
  argument(Array.isArray(paths) && paths.length > 0 && paths.every((value) => nonblank(value) && !path.isAbsolute(value)
    && !value.includes('\\') && !value.includes('\0')
    && (value === '.' || value.split('/').every((part) => !['', '.', '..'].includes(part)))), 'paths must contain exact Atlas-relative paths.');
  return paths.includes('.') ? ['.'] : unique(paths);
}

function idsOption(ids) {
  argument(ids === undefined || (Array.isArray(ids) && ids.every(nonblank)), 'checkIds must contain exact Check ids.');
  return ids === undefined ? null : unique(ids);
}

function actorOption(actor) {
  argument(plain(actor) && Object.keys(actor).every((key) => ['kind', 'id'].includes(key))
    && ['human', 'agent', 'tool'].includes(actor.kind) && nonblank(actor.id), 'An explicit human, agent, or tool actor id is required.');
  return freezeEvaluation({ kind: actor.kind, id: actor.id });
}

export function createEvaluatorRegistry(registrations = []) {
  argument(Array.isArray(registrations), 'Evaluator registrations must be an array.');
  const entries = [], bindings = new Map(), ids = new Set();
  for (const registration of registrations) {
    objectOptions(registration, ['id', 'version', 'checks', 'capabilities', 'verify']);
    argument(nonblank(registration.id) && nonblank(registration.version) && typeof registration.verify === 'function', 'An evaluator requires id, version, and verify callback.');
    argument(!ids.has(registration.id), `Duplicate evaluator id: ${registration.id}`);
    ids.add(registration.id);
    argument(Array.isArray(registration.checks) && registration.checks.length > 0, 'An evaluator must name supported Check revisions.');
    const checks = registration.checks.map((check) => {
      argument(plain(check) && Object.keys(check).every((key) => ['id', 'revision'].includes(key))
        && nonblank(check.id) && /^sha256:[0-9a-f]{64}$/u.test(check.revision), 'Each supported Check requires an exact id and SHA-256 revision.');
      return { id: check.id, revision: check.revision };
    });
    const capabilities = registration.capabilities ?? [];
    argument(Array.isArray(capabilities) && capabilities.every(nonblank), 'Required capability names must be strings.');
    const descriptor = freezeEvaluation({ id: registration.id, version: registration.version, checks, capabilities: unique(capabilities) });
    const entry = { descriptor, verify: registration.verify };
    for (const check of checks) {
      const key = `${check.id}\0${check.revision}`;
      argument(!bindings.has(key), `More than one evaluator claims Check ${check.id} at ${check.revision}.`);
      bindings.set(key, entry);
    }
    entries.push(entry);
  }
  const registry = freezeEvaluation({ contract: 'atlas.evaluator-registry/1', evaluators: entries.map((entry) => entry.descriptor) });
  registries.set(registry, bindings);
  return registry;
}

const emptyRegistry = createEvaluatorRegistry();

function registryOption(registry = emptyRegistry) {
  argument(registries.has(registry), 'An evaluator registry from createEvaluatorRegistry is required.');
  return registries.get(registry);
}

function subjectsFor(check, model) {
  const subjects = [];
  for (const kind of check.appliesTo) {
    if (kind === 'atlas') subjects.push({ kind, id: model.atlas.id, path: 'atlas.md' });
    if (kind === 'map') model.maps.forEach((map) => subjects.push({ kind, id: map.id, path: map.path }));
    if (kind === 'area') model.maps.forEach((map) => map.areas.forEach((area) => subjects.push({ kind, id: area.id, map: map.id, path: map.path })));
    if (kind === 'point-anchor') model.points.forEach((point) => subjects.push({ kind, id: point.id, map: point.primaryMap, path: point.anchorPath }));
    if (kind === 'point-context') model.points.forEach((point) => point.records.filter((record) => record.kind === 'context')
      .forEach((record) => subjects.push({ kind, id: point.id, map: record.map, path: record.path })));
    if (kind === 'resource') model.atlas.resources.forEach((resource) => subjects.push({ kind, id: resource.id, path: 'atlas.md' }));
    if (kind === 'check') model.checks.forEach((item) => subjects.push({ kind, id: item.id, path: item.path }));
    if (kind === 'publication') {
      model.publicationProfiles.forEach((profile) => subjects.push({ kind, id: profile.id, path: profile.path }));
      if (!model.publicationProfiles.length) subjects.push({ kind, path: '.publication' });
    }
  }
  return subjects.sort((left, right) => compare([left.kind, left.map ?? '', left.id ?? '', left.path].join('\0'),
    [right.kind, right.map ?? '', right.id ?? '', right.path].join('\0')));
}

function inScope(subject, paths) {
  return paths.some((selected) => selected === '.' || selected === 'catalog.json' || selected === 'connections.json' || subject.path === selected || subject.path.startsWith(`${selected}/`));
}

function selection(view, options) {
  const bindings = registryOption(options.registry), paths = pathsOption(options.paths), checkIds = idsOption(options.checkIds);
  const model = view.validation.normalized;
  if (!model) return { paths, checkIds, checks: [], omittedChecks: [], uncoveredSubjects: [], unresolvedPaths: paths, inapplicableChecks: [] };
  if (checkIds) argument(checkIds.every((id) => model.checks.some((check) => check.id === id)), 'checkIds contains an unknown Check.');
  const unresolvedPaths = paths.filter((selected) => selected !== '.' && !view.identity.inputs.some((input) => input.path === selected && input.kind !== 'missing'));
  const checks = [], omittedChecks = [], uncoveredSubjects = [], inapplicableChecks = [];
  for (const check of model.checks) {
    const file = view.identity.inputs.find((input) => input.path === check.path && input.kind === 'file');
    argument(file && /^[0-9a-f]{64}$/u.test(file.sha256), 'A Check must have complete captured Markdown source identity.');
    const revision = checkRevisionForView(view, check), allSubjects = subjectsFor(check, model), subjects = allSubjects.filter((subject) => inScope(subject, paths));
    const selected = checkIds === null || checkIds.includes(check.id);
    if (!selected) omittedChecks.push({ id: check.id, revision, status: check.status, level: check.level, subjects });
    const uncovered = allSubjects.filter((subject) => !subjects.includes(subject));
    if (uncovered.length) uncoveredSubjects.push({ check: check.id, status: check.status, level: check.level, subjects: uncovered });
    if (!allSubjects.length || !subjects.length) inapplicableChecks.push({ id: check.id, reason: !allSubjects.length ? 'No subjects of the declared kinds exist.' : 'No subjects fall within the selected paths.' });
    if (selected) checks.push({ check, revision, subjects, allSubjects,
      entry: bindings.get(`${check.id}\0${revision}`) ?? null });
  }
  return { paths, checkIds, checks, omittedChecks, uncoveredSubjects, unresolvedPaths, inapplicableChecks };
}

export function discoverChecks(view, options = {}) {
  viewArgument(view);
  objectOptions(options, ['registry', 'status', 'level', 'appliesTo', 'paths', 'checkIds']);
  argument(options.status === undefined || ['draft', 'active', 'retired'].includes(options.status), 'Unsupported Check status.');
  argument(options.level === undefined || ['required', 'advisory'].includes(options.level), 'Unsupported Check level.');
  argument(options.appliesTo === undefined || kinds.includes(options.appliesTo), 'Unsupported Check applicability.');
  let selected, diagnostics = [], unresolvedCheckIds = [];
  if (view.validation.normalized) selected = selection(view, options);
  else {
    const bindings = registryOption(options.registry), paths = pathsOption(options.paths), checkIds = idsOption(options.checkIds);
    const recovered = capturedChecks(view);
    diagnostics = recovered.diagnostics;
    unresolvedCheckIds = checkIds?.filter(id => !recovered.checks.some(check => check.id === id)) ?? [];
    argument(diagnostics.length > 0 || unresolvedCheckIds.length === 0, 'checkIds contains an unknown Check.');
    selected = {
      unresolvedPaths: paths.filter(selected => selected !== '.'
        && !view.identity.inputs.some(input => input.path === selected && input.kind !== 'missing')),
      checks: recovered.checks.filter(check => checkIds === null || checkIds.includes(check.id)).map(check => {
        const revision = check.registration ? checkRevisionFromDigest(check.sha256, check.registration) : null;
        return { check, revision, subjects: null, entry: revision ? bindings.get(`${check.id}\0${revision}`) : null };
      }),
    };
  }
  const items = selected.checks.filter(({ check }) => (options.status === undefined || options.status === check.status)
    && (options.level === undefined || check.level === null || options.level === check.level)
    && (options.appliesTo === undefined || check.appliesTo === null || check.appliesTo.includes(options.appliesTo)))
    .map(({ check, revision, subjects, entry }) => ({ id: check.id, title: check.title, summary: check.summary,
      path: check.path, revision, status: check.status, level: check.level, appliesTo: check.appliesTo, subjects,
      applicability: subjects === null ? { status: 'unresolved', reasons: [...check.reasons,
        `The Atlas view is ${view.status}; exact applicable subjects cannot be resolved.`] } : { status: 'resolved', reasons: [] },
      evaluator: entry ? entry.descriptor : null }));
  return freezeEvaluation({ contract: 'atlas.check-discovery/1', status: view.status, sourceIdentity: view.identity, items,
    complete: diagnostics.length === 0, diagnostics, unresolvedCheckIds,
    unresolvedPaths: selected.unresolvedPaths, limits: ['Discovery reads captured local Checks. It runs no verification and adopts no catalog policy.',
      'Discovery completeness covers local definitions and registrations before filtering. It does not establish resolved applicability, Atlas validity, or Check compliance.',
      'Unresolved subjects are null. Unknown level or declared applicability remains visible through filters; paths do not remove unresolved candidates.',
      'Selecting catalog.json or connections.json conservatively includes all assembled subjects; requested paths remain the declared scope.'] });
}

function capturedEvidence(value) {
  argument(Array.isArray(value), 'Verifier evidence must be an array.');
  return value.map((item) => {
    if (typeof item === 'string') item = { summary: item, data: item, mediaType: 'text/plain' };
    argument(plain(item) && Object.keys(item).every((key) => ['summary', 'data', 'mediaType'].includes(key))
      && nonblank(item.summary) && (typeof item.data === 'string' || item.data instanceof Uint8Array)
      && (item.mediaType === undefined || nonblank(item.mediaType)), 'Evidence requires a summary and original text or bytes.');
    const bytes = Buffer.from(item.data);
    return { summary: item.summary, mediaType: item.mediaType ?? (typeof item.data === 'string' ? 'text/plain' : 'application/octet-stream'),
      bytesBase64: bytes.toString('base64'), byteLength: bytes.length, sha256: digest(bytes) };
  });
}

function verifierResult(value) {
  objectOptions(value, ['outcome', 'summary', 'evidence', 'diagnostics']);
  argument(outcomes.includes(value.outcome) && value.outcome !== 'not-applicable' && nonblank(value.summary), 'An active Check verifier must return pass, fail, or unable and a summary.');
  const evidence = capturedEvidence(value.evidence);
  argument(Array.isArray(value.diagnostics), 'Verifier diagnostics must be an array.');
  const diagnostics = value.diagnostics.map((item) => {
    if (typeof item === 'string') item = { message: item };
    argument(plain(item) && Object.keys(item).every((key) => ['message', 'path'].includes(key)) && nonblank(item.message)
      && (item.path === undefined || nonblank(item.path)), 'Each diagnostic requires a message.');
    return { message: item.message, ...(item.path !== undefined ? { path: item.path } : {}) };
  });
  argument(value.outcome === 'pass' ? evidence.length > 0 && diagnostics.length === 0 : diagnostics.length > 0,
    'Pass requires supporting evidence and no diagnostics; fail and unable require diagnostics.');
  return { outcome: value.outcome, summary: value.summary, evidence, diagnostics };
}

async function invoke(entry, context) {
  const { signal } = context;
  if (!signal) return entry.verify(context);
  if (signal.aborted) throw new Error('Evaluation was interrupted.');
  let abort;
  const interrupted = new Promise((resolve, reject) => { abort = () => reject(new Error('Evaluation was interrupted.')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => entry.verify(context)), interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function evaluateChecks(view, options = {}) {
  viewArgument(view);
  objectOptions(options, ['registry', 'actor', 'paths', 'checkIds', 'capabilities', 'signal']);
  const actor = actorOption(options.actor), selected = selection(view, options);
  const suppliedCapabilities = options.capabilities ?? {}, signal = options.signal;
  argument(plain(suppliedCapabilities) && Object.values(suppliedCapabilities).every((value) => typeof value === 'function'), 'Capabilities must be explicit host-provided functions.');
  const capabilities = Object.freeze({ ...suppliedCapabilities });
  argument(signal === undefined || (typeof signal?.addEventListener === 'function' && typeof signal?.removeEventListener === 'function' && typeof signal?.aborted === 'boolean'), 'signal must be an AbortSignal.');
  const startedAt = new Date().toISOString(), id = randomUUID(), evaluations = [];
  const scope = { paths: selected.paths, checkIds: selected.checkIds };
  const coverage = { wholeAtlas: selected.paths.length === 1 && selected.paths[0] === '.' && selected.omittedChecks.length === 0,
    omittedChecks: selected.omittedChecks, uncoveredSubjects: selected.uncoveredSubjects,
    unresolvedPaths: selected.unresolvedPaths, inapplicableChecks: selected.inapplicableChecks };
  let evidenceBytes = 0;
  if (view.status === 'ready') for (const { check, revision, subjects, entry } of selected.checks) {
    if (!subjects.length) continue;
    const base = { check: check.id, revision, path: check.path, status: check.status, level: check.level, subjects, actor };
    let outcome, receipt = null;
    const unable = (reason) => ({ outcome: 'unable', summary: reason, evidence: [], diagnostics: [{ message: reason }] });
    if (check.status !== 'active') outcome = { outcome: 'not-applicable', summary: `${check.status === 'draft' ? 'Draft' : 'Retired'} Check does not govern current work.`, evidence: [], diagnostics: [] };
    else if (!entry) outcome = unable(`No evaluator supports Check ${check.id} at ${revision}.`);
    else {
      const missing = entry.descriptor.capabilities.filter((name) => !Object.hasOwn(capabilities, name));
      const executionStart = new Date().toISOString();
      receipt = { id: entry.descriptor.id, version: entry.descriptor.version, capabilities: entry.descriptor.capabilities,
        startedAt: executionStart, completedAt: executionStart, invoked: false };
      if (missing.length) outcome = unable(`Required host capabilities are unavailable: ${missing.join(', ')}.`);
      else if (signal?.aborted) outcome = unable('Evaluation was interrupted.');
      else {
        receipt.invoked = true;
        try {
          const granted = Object.freeze(Object.fromEntries(entry.descriptor.capabilities.map((name) => [name, capabilities[name]])));
          const result = await invoke(entry, Object.freeze({ view, check: freezeEvaluation({ ...check, revision }),
            subjects: freezeEvaluation(subjects), actor, capabilities: granted, signal }));
          outcome = verifierResult(result);
          const bytes = outcome.evidence.reduce((sum, item) => sum + item.byteLength, 0);
          argument(evidenceBytes + bytes <= 8 * 1024 * 1024, 'Captured evidence exceeds the 8 MiB run limit.');
          evidenceBytes += bytes;
        } catch (error) { outcome = unable(`Verification could not complete: ${message(error)}`); }
      }
      receipt.completedAt = new Date().toISOString();
    }
    evaluations.push({ ...base, ...outcome, evaluator: receipt });
  }
  const freshness = view.freshness();
  const requiredOmitted = selected.omittedChecks.some((check) => check.status === 'active' && check.level === 'required' && check.subjects.length > 0);
  const usable = view.status === 'ready' && freshness.status === 'fresh' && selected.unresolvedPaths.length === 0;
  const requiredSatisfied = usable && !requiredOmitted && evaluations.every((item) => item.status !== 'active' || item.level !== 'required' || item.outcome === 'pass');
  const run = freezeEvaluation({ contract: 'atlas.check-run/1', id, startedAt, completedAt: new Date().toISOString(), actor,
    atlas: view.validation.normalized?.atlas.id ?? null, atlasRoot: view.atlasRoot, sourceIdentity: view.identity,
    validation: view.validation.toJSON(), status: view.status !== 'ready' ? view.status : freshness.status === 'stale' ? 'stale' : freshness.status === 'unavailable' ? 'incomplete' : 'evaluated',
    scope, coverage, evaluations, requiredSatisfied, wholeAtlasCompliant: coverage.wholeAtlas && requiredSatisfied,
    complete: usable && selected.omittedChecks.length === 0 && evaluations.every((item) => item.outcome !== 'unable'), freshness,
    limits: ['Verification is explicit. No default evaluator, catalog adoption, module loading, or durable report write occurs.',
      'Selecting catalog.json or connections.json conservatively includes all assembled subjects. Requested paths remain explicit and do not become a whole-Atlas selection.',
      'In-process callbacks are trusted host code, not sandboxed code. Declared capabilities do not restrict their ambient process permissions.',
      'Pass records the attributed verifier conclusion and supporting evidence, not an independent proof of truth or usefulness.',
      'Cancellation is cooperative and does not forcibly terminate trusted callback code.',
      'Required satisfaction covers selected subjects and refuses omitted applicable required Checks. Uncovered subjects remain visible; partial coverage does not establish whole-Atlas compliance.'] });
  runs.add(run);
  sources.set(run, localSourceTargets(view));
  return run;
}

export function requireEvaluationRun(run) {
  argument(runs.has(run), 'A run returned by evaluateChecks is required.');
  return run;
}

// Private authoring integration. The caller has verified the exact prepared-plan digest.
export function bindPreparedEvaluation(run, preparedChange) {
  requireEvaluationRun(run);
  argument(plain(preparedChange) && typeof preparedChange.planDigest === 'string'
    && /^(?:sha256:)?[a-f0-9]{64}$/u.test(preparedChange.planDigest) && Array.isArray(preparedChange.paths), 'Prepared evaluation binding is invalid.');
  const bound = freezeEvaluation({ ...run, preparedChange: { planDigest: preparedChange.planDigest, paths: [...preparedChange.paths] } });
  runs.add(bound); sources.set(bound, sources.get(run));
  return bound;
}

export function evaluationSourceTargets(run) {
  requireEvaluationRun(run);
  return sources.get(run);
}
