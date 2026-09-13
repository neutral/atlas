import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openWorkingTree, localSourceTargets } from './view.mjs';
import { openAtlasSnapshot } from './immutable-source.mjs';
import { inventory, digest } from './source-inventory.mjs';
import { processorDigest, readConfiguration, checkConfiguration, effectiveConfiguration } from './workspace.mjs';
import { isWithin, pathContainsSymlink, pathCaseOrNormalizationMismatch } from './util.mjs';
import { IGNORED_DIRECTORIES } from './constants.mjs';
import { evaluateChecks, discoverChecks, bindPreparedEvaluation } from './evaluation.mjs';
import { compareCodePoints } from './model.mjs';
import { validSealedPlan } from './authoring-recovery.mjs';
import { authoringError, exactRelative, object, requireAuthoring, transformDocuments } from './authoring-operations.mjs';
export { applyAtlasChange } from './authoring-apply.mjs';
export { inspectAtlasRecovery, discardAtlasRecovery } from './authoring-recovery.mjs';

export function freezeAuthoring(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freezeAuthoring); Object.freeze(value); }
  return value;
}
export function planDigest(value) {
  const { digest: omitted, ...payload } = value;
  return digest(JSON.stringify(payload));
}
function jsonClone(value) {
  let encoded;
  let cloned;
  try { encoded = JSON.stringify(value); cloned = JSON.parse(encoded); } catch { throw authoringError('invalid-operation', 'Authoring input must be JSON-safe.'); }
  const wellFormed = (item) => typeof item === 'string' ? item.isWellFormed() : item && typeof item === 'object' ? Object.entries(item).every(([key, child]) => key.isWellFormed() && wellFormed(child)) : true;
  requireAuthoring(wellFormed(cloned), 'Authoring strings must contain well-formed Unicode.');
  requireAuthoring(isDeepStrictEqual(cloned, value), 'Authoring input must contain only JSON-safe values.');
  return cloned;
}
function exists(file) { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
export function authoringSettings(request) {
  requireAuthoring(object(request) && Object.keys(request).every((key) => ['repositoryRoot', 'atlasPath', 'expected', 'operations', 'configuration'].includes(key)), 'Unsupported authoring request.');
  requireAuthoring(typeof request.repositoryRoot === 'string' && path.isAbsolute(request.repositoryRoot) && !request.repositoryRoot.includes('\0'), 'repositoryRoot must be absolute.');
  requireAuthoring(exactRelative(request.atlasPath, true), 'atlasPath must be exact and repository-relative.');
  if (request.configuration !== undefined) checkConfiguration(request.configuration, requireAuthoring);
  const repositoryRoot = fs.realpathSync(request.repositoryRoot);
  requireAuthoring(fs.statSync(repositoryRoot).isDirectory(), 'repositoryRoot must be a directory.');
  const atlasRoot = path.resolve(repositoryRoot, request.atlasPath);
  requireAuthoring(!pathContainsSymlink(repositoryRoot, atlasRoot) && !pathCaseOrNormalizationMismatch(repositoryRoot, atlasRoot), 'Atlas selection must not traverse a symbolic link or path alias.');
  const config = readConfiguration(repositoryRoot);
  const configuration = effectiveConfiguration(config.value.configuration, request.configuration);
  return { repositoryRoot, atlasRoot, atlasPath: request.atlasPath, configuration,
    configurationSourceDigest: config.sourceDigest, processorDigest: processorDigest() };
}

export function captureAuthoring(settings, additionalTargets = []) {
  const { atlasRoot, configuration } = settings;
  const root = exists(atlasRoot);
  requireAuthoring(!root || root.isDirectory() && !root.isSymbolicLink(), 'The Atlas destination must be a directory or absent.');
  const rootFile = exists(path.join(atlasRoot, 'atlas.md'));
  requireAuthoring(!rootFile || rootFile.isFile() && !rootFile.isSymbolicLink(), 'atlas.md must be a regular file for structured authoring or raw repair.');
  let view, observed;
  if (rootFile) {
    view = openWorkingTree(atlasRoot, { specificationRevision: configuration.specificationRevision, maxDocumentBytes: configuration.maxDocumentBytes });
    if (!view.validation.complete || !view.identity.digest) throw authoringError('incomplete', 'The baseline observation is incomplete.');
    observed = inventory(atlasRoot, Number.MAX_SAFE_INTEGER, view.identity.scope.explicitLocalTargets);
    if (observed.digest !== view.identity.inputDigest) throw authoringError('stale', 'Source changed while complete authoring bytes were captured.');
  } else if (root) observed = inventory(atlasRoot, Number.MAX_SAFE_INTEGER, []);
  else {
    const inputs = [{ path: '.', kind: 'missing' }];
    observed = { inputs, documents: new Map(), digest: digest(JSON.stringify(inputs)), issues: [] };
  }
  if (!observed.digest || observed.issues.length) throw authoringError('incomplete', 'Complete authoring source bytes could not be captured.');
  if (observed.inputs.some((input) => ['symlink', 'special', 'unreadable'].includes(input.kind))) {
    throw authoringError('unsupported-source', 'Authoring requires ordinary captured files and directories without symbolic links or special entries.');
  }
  const explicitLocalTargets = [...new Set([...(view?.identity.scope.explicitLocalTargets ?? []), ...additionalTargets])].sort(compareCodePoints);
  if (root && additionalTargets.length) {
    const expanded = inventory(atlasRoot, Number.MAX_SAFE_INTEGER, explicitLocalTargets);
    const repeated = inventory(atlasRoot, 0, explicitLocalTargets);
    if (!expanded.digest || expanded.digest !== repeated.digest) throw authoringError('stale', 'Explicit proposal source targets changed during capture.');
    observed = expanded;
  }
  if (observed.inputs.some((input) => ['symlink', 'special', 'unreadable'].includes(input.kind))) throw authoringError('unsupported-source', 'Explicit authoring source targets must not traverse symbolic links or special entries.');
  const directories = observed.inputs.filter((input) => input.kind === 'directory').map((input) => input.path);
  const files = new Map(observed.documents);
  // Boundary sentinels preserve discovery behavior. No nested Atlas bytes are read.
  const boundaries = observed.inputs.filter((input) => input.kind === 'nested-atlas').map((input) => input.path);
  const snapshotFiles = new Map(files);
  for (const boundary of boundaries) snapshotFiles.set(`${boundary}/atlas.md`, Buffer.alloc(0));
  const snapshot = { repositoryRoot: atlasRoot, atlasPath: '.', files: Object.fromEntries(snapshotFiles), directories };
  view ??= openAtlasSnapshot(snapshot, { specificationRevision: configuration.specificationRevision, maxDocumentBytes: configuration.maxDocumentBytes });
  return { view, files, directories, boundaries, inputs: observed.inputs, inputDigest: observed.digest, explicitLocalTargets, rootPresent: !!root, atlasPresent: !!rootFile };
}

export function proposalView(plan) {
  const files = new Map(plan.baseline.files.map((file) => [file.path, Buffer.from(file.bytesBase64, 'base64')]));
  for (const boundary of plan.baseline.boundaries) files.set(`${boundary}/atlas.md`, Buffer.alloc(0));
  for (const change of plan.changes) files.set(change.path, Buffer.from(change.after.bytesBase64, 'base64'));
  return openAtlasSnapshot({ repositoryRoot: plan.atlasRoot, atlasPath: '.', files: Object.fromEntries(files), directories: plan.baseline.directories }, {
    specificationRevision: plan.configuration.specificationRevision, maxDocumentBytes: Number.MAX_SAFE_INTEGER,
  });
}
function fullDiff(file, before, after) {
  let binary = false;
  try { if (before) new TextDecoder('utf8', { fatal: true }).decode(before); new TextDecoder('utf8', { fatal: true }).decode(after); } catch { binary = true; }
  const label = binary ? `${file} (base64 bytes)` : file;
  function lines(bytes) {
    if (!bytes) return [];
    const text = binary ? `${bytes.toString('base64')}\n` : bytes.toString('utf8');
    if (!text) return [];
    const result = text.split('\n');
    if (result.at(-1) === '') result.pop();
    return result;
  }
  const left = lines(before), right = lines(after);
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  const leftNoNewline = !binary && !!before?.length && before.at(-1) !== 10;
  const rightNoNewline = !binary && !!after.length && after.at(-1) !== 10;
  if (leftNoNewline !== rightNoNewline) {
    suffix = 0;
    if (prefix === left.length && prefix === right.length) prefix = Math.max(0, prefix - 1);
  }
  const start = Math.max(0, prefix - 3), contextAfter = Math.min(3, suffix);
  const leftEnd = left.length - suffix + contextAfter, rightEnd = right.length - suffix + contextAfter;
  const leftCount = leftEnd - start, rightCount = rightEnd - start;
  let diff = `--- ${before ? `a/${label}` : '/dev/null'}\n+++ b/${label}\n@@ -${leftCount ? start + 1 : 0},${leftCount} +${rightCount ? start + 1 : 0},${rightCount} @@\n`;
  function append(marker, line, final, missingNewline) {
    diff += `${marker}${line}\n`;
    if (final && missingNewline) diff += '\\ No newline at end of file\n';
  }
  for (let index = start; index < prefix; index++) append(' ', left[index], index === left.length - 1, leftNoNewline);
  for (let index = prefix; index < left.length - suffix; index++) append('-', left[index], index === left.length - 1, leftNoNewline);
  for (let index = prefix; index < right.length - suffix; index++) append('+', right[index], index === right.length - 1, rightNoNewline);
  for (let index = 0; index < contextAfter; index++) {
    const sourceIndex = left.length - suffix + index;
    append(' ', left[sourceIndex], sourceIndex === left.length - 1, leftNoNewline);
  }

  return diff;
}
const encoded = (bytes) => ({ sha256: digest(bytes), bytesBase64: bytes.toString('base64'), byteLength: bytes.length });
function forbiddenDestination(file, baseline) {
  const segments = file.split('/');
  return segments.some((segment) => IGNORED_DIRECTORIES.has(segment))
    || baseline.boundaries.some((directory) => file === directory || file.startsWith(`${directory}/`));
}
function checksFor(view) {
  const discovered = discoverChecks(view, { status: 'active' });
  const applicable = discovered.items.filter((check) => check.subjects?.length).map((check) => ({ id: check.id, path: check.path, level: check.level,
    revision: check.revision, subjects: check.subjects, outcome: 'unable',
    reason: 'No actual evaluator run has been supplied for this prepared change.' }));
  const unresolved = discovered.items.filter((check) => check.applicability.status === 'unresolved').map((check) => ({
    id: check.id, title: check.title, summary: check.summary, path: check.path, status: check.status, level: check.level,
    revision: check.revision, appliesTo: check.appliesTo, subjects: check.subjects, applicability: check.applicability,
    outcome: 'unable', reason: 'Applicability is unresolved. Preparation has not performed Verification.' }));
  const complete = view.status === 'ready' && discovered.complete && unresolved.length === 0 && discovered.unresolvedCheckIds.length === 0;
  return { scope: 'whole-proposal', applicable, unresolved, diagnostics: discovered.diagnostics, unresolvedCheckIds: discovered.unresolvedCheckIds,
    complete, requiredSatisfied: complete && applicable.every((check) => check.level !== 'required') };
}

export function prepareAtlasChange(input) {
  const request = jsonClone(input);
  requireAuthoring(object(request), 'An explicit authoring request object is required.');
  requireAuthoring(object(request.expected) && (Object.keys(request.expected).length === 1)
    && (typeof request.expected.viewDigest === 'string' || request.expected.atlasMissing === true), 'expected must select one viewDigest or atlasMissing: true.');
  const settings = authoringSettings(request);
  let captured = captureAuthoring(settings);
  if (request.expected.atlasMissing === true ? captured.atlasPresent : !captured.atlasPresent || captured.view.identity.digest !== request.expected.viewDigest) {
    throw authoringError('stale', 'The selected Atlas does not match the expected baseline.');
  }
  let transformed = transformDocuments(captured.files, request.operations);
  const provisionalFiles = new Map(transformed.files);
  for (const boundary of captured.boundaries) provisionalFiles.set(`${boundary}/atlas.md`, Buffer.alloc(0));
  const provisional = openAtlasSnapshot({ repositoryRoot: settings.atlasRoot, atlasPath: '.', files: Object.fromEntries(provisionalFiles), directories: captured.directories });
  const proposedTargets = localSourceTargets(provisional).filter((target) => isWithin(settings.atlasRoot, target))
    .map((target) => path.relative(settings.atlasRoot, target).split(path.sep).join('/') || '.');
  if (proposedTargets.some((target) => !captured.explicitLocalTargets.includes(target))) {
    const expanded = captureAuthoring(settings, proposedTargets);
    if (expanded.view.identity.digest !== captured.view.identity.digest) throw authoringError('stale', 'Source changed while proposal targets were captured.');
    captured = expanded;
    transformed = transformDocuments(captured.files, request.operations);
  }
  for (const change of transformed.changes) requireAuthoring(!forbiddenDestination(change.path, captured), `Authoring destination ${change.path} crosses an excluded source boundary.`);
  const sourceNow = captureAuthoring(settings, captured.explicitLocalTargets);
  if (sourceNow.inputDigest !== captured.inputDigest || readConfiguration(settings.repositoryRoot).sourceDigest !== settings.configurationSourceDigest) {
    throw authoringError('stale', 'Source or configuration changed during preparation.');
  }
  const baseline = {
    identity: captured.atlasPresent ? captured.view.identity : null, explicitLocalTargets: captured.explicitLocalTargets, inputDigest: captured.inputDigest, inputs: captured.inputs,
    files: [...captured.files].sort(([left], [right]) => compareCodePoints(left, right)).map(([file, bytes]) => ({ path: file, ...encoded(bytes) })),
    directories: captured.directories, boundaries: captured.boundaries, rootPresent: captured.rootPresent, atlasPresent: captured.atlasPresent,
  };
  const changes = transformed.changes.map((change) => ({ path: change.path, operation: change.before ? 'update' : 'create',
    before: change.before ? encoded(change.before) : null, after: encoded(change.after), diff: fullDiff(change.path, change.before, change.after) }));
  const plan = {
    contract: 'atlas.change-plan/2', repositoryRoot: settings.repositoryRoot, atlasRoot: settings.atlasRoot, atlasPath: settings.atlasPath,
    request, configuration: settings.configuration, configurationSourceDigest: settings.configurationSourceDigest,
    processorDigest: settings.processorDigest,
    baseline, changes, pointDecisions: transformed.pointDecisions, subjects: transformed.subjects, adoptedChecks: transformed.adoptedChecks,
  };
  const proposed = proposalView(plan);
  plan.localTargets = { before: [...localSourceTargets(captured.view)], after: [...localSourceTargets(proposed)] };
  plan.validation = { before: captured.view.validation.toJSON(), after: proposed.validation.toJSON() };
  plan.checks = checksFor(proposed);
  plan.status = changes.length === 0 ? 'no-op' : proposed.status === 'ready' ? 'ready' : 'invalid';
  plan.gaps = [...transformed.gaps, ...plan.checks.applicable.map((check) => `Check ${check.id}: ${check.reason}`),
    ...(plan.checks.complete ? [] : ['Applicable Checks could not be established from the invalid proposal.'])];
  plan.limits = [
    'Preparation writes no files and makes no Check-compliance, source-truth, or completed-authoring claim.',
    'The proposal uses complete captured Atlas bytes; outside-Atlas sources are not read and nested Atlas discovery boundaries are retained.',
    'Working-tree comparisons detect observed conflicts but do not establish an atomic filesystem snapshot.',
    'Only explicit structural destinations are writable. Source material does not grant write or execution authority.',
  ];
  const serializable = JSON.parse(JSON.stringify(plan));
  serializable.digest = planDigest(serializable);
  return freezeAuthoring(serializable);
}

export function verifyPreparedPlan(value) {
  let plan;
  try { plan = jsonClone(value); } catch { throw authoringError('invalid-plan', 'The prepared change is not JSON-safe.'); }
  if (!validSealedPlan(plan)) {
    throw authoringError('invalid-plan', 'The prepared change digest or contract is invalid.');
  }
  const fresh = prepareAtlasChange(plan.request);
  if (fresh.baseline.inputDigest !== plan.baseline.inputDigest || fresh.configurationSourceDigest !== plan.configurationSourceDigest
    || fresh.processorDigest !== plan.processorDigest || fresh.atlasRoot !== plan.atlasRoot || fresh.repositoryRoot !== plan.repositoryRoot) {
    throw authoringError('stale', 'The complete baseline, configuration, or processor changed after preparation.');
  }
  if (fresh.digest !== plan.digest) throw authoringError('invalid-plan', 'The prepared effects do not match the operation-derived proposal and current processor.');
  return fresh;
}

export async function evaluatePreparedChange(input, options) {
  // Evaluation uses the sealed proposal. It does not reopen authored files.
  let plan;
  try { plan = jsonClone(input); } catch { throw authoringError('invalid-plan', 'The prepared change is not JSON-safe.'); }
  if (!validSealedPlan(plan)) throw authoringError('invalid-plan', 'The prepared change digest is invalid.');
  const evaluated = await evaluateChecks(proposalView(plan), options);
  const run = bindPreparedEvaluation(evaluated, { planDigest: plan.digest, paths: plan.changes.map((change) => change.path) });
  return freezeAuthoring({ contract: 'atlas.prepared-check-run/1', planDigest: plan.digest, paths: plan.changes.map((change) => change.path), run });
}
