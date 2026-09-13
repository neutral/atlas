import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AtlasToolError, localSourceTargets } from './view.mjs';
import { freezeEvaluation, checkRevisionForView, requireEvaluationRun, evaluationSourceTargets } from './evaluation.mjs';
import { validators } from './schemas.mjs';

const contract = 'atlas.check-report-provenance/1';
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const sha = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const relative = (value) => text(value) && !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0')
  && (value === '.' || value.split('/').every((part) => part && part !== '.' && part !== '..'));
function fail(code, message) { throw new AtlasToolError(code, message); }
function argument(condition, message) { if (!condition) fail('atlas.tools.invalid-argument', message); }
function keys(value, names) { return plain(value) && Object.keys(value).every((key) => names.includes(key)); }

function absolute(value, name) {
  argument(text(value) && path.isAbsolute(value) && !value.includes('\0'), `${name} must be an absolute path.`);
  return path.resolve(value);
}

// Resolve platform aliases once. Reject a symlink within the requested destination.
function destinationPath(value) {
  let existing = value;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) fail('atlas.evaluation.report-unavailable', 'No existing report destination ancestor.');
    existing = parent;
  }
  const stat = fs.lstatSync(existing);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('atlas.evaluation.report-unavailable', 'The report destination ancestor must be a real directory.');
  }
  return path.join(fs.realpathSync(existing), ...suffix);
}

function protection(directory, run, options) {
  const repositoryRoot = fs.realpathSync(absolute(options.repositoryRoot, 'repositoryRoot'));
  const atlasRoot = destinationPath(run.atlasRoot);
  if (within(atlasRoot, directory) || within(path.join(repositoryRoot, 'tmp'), directory)) {
    fail('atlas.evaluation.unsafe-report-directory', 'Retained reports must be outside the evaluated Atlas and repository tmp.');
  }
  const sourceTargets = evaluationSourceTargets(run).flatMap((target) => [target, path.resolve(atlasRoot, path.relative(run.atlasRoot, target))]);
  if (sourceTargets.some((target) => within(directory, target) || within(target, directory))) {
    fail('atlas.evaluation.unsafe-report-directory', 'Retained reports must not create or replace an authored local source target.');
  }
  return { repositoryRoot };
}

function bytesFile(file, bytes) {
  const descriptor = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }

function auditReport(run, baseline, changeSet) {
  return {
    contract: 'urn:atlas:schema:check-evaluation:1', atlas: run.atlas, baseline, changeSet,
    complete: run.complete, compliant: run.complete && run.wholeAtlasCompliant,
    evaluator: { name: 'atlas-check-evaluator', version: '0.9.0' },
    evaluations: run.evaluations.map((evaluation) => {
      const { check, revision, status, level, subjects, outcome, summary, diagnostics } = evaluation;
      return { check, revision, status, level, subjects, outcome, summary,
        evidence: evaluation.evidence.map((evidence) => evidence.summary), diagnostics };
    }),
  };
}

export function retainCheckReport(run, options = {}) {
  try { return retain(run, options); }
  catch (error) {
    if (error instanceof AtlasToolError) throw error;
    fail('atlas.evaluation.report-unavailable', `Report retention failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function retain(run, options) {
  requireEvaluationRun(run);
  argument(keys(options, ['directory', 'repositoryRoot', 'baseline', 'changeSet']), 'Unsupported report retention options.');
  if (!run.atlas || !run.sourceIdentity.digest || !run.validation.complete || !run.validation.valid) {
    fail('atlas.evaluation.unretainable-run', 'Invalid or incomplete structural observations remain validation results; no synthetic Check audit is written.');
  }
  const baseline = options.baseline ?? `sha256:${run.sourceIdentity.digest}`;
  argument(sha(baseline) || /^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseline), 'baseline must be an immutable sha256 or full git object identifier.');
  const suppliedChangeSet = options.changeSet ?? { id: run.id, paths: run.scope.paths };
  argument(keys(suppliedChangeSet, ['id', 'paths']) && text(suppliedChangeSet.id)
    && Array.isArray(suppliedChangeSet.paths) && suppliedChangeSet.paths.length > 0 && suppliedChangeSet.paths.every(relative)
    && new Set(suppliedChangeSet.paths).size === suppliedChangeSet.paths.length, 'changeSet requires an id and unique exact Atlas-relative paths.');
  const changeSet = { id: suppliedChangeSet.id, paths: [...suppliedChangeSet.paths] };
  const directory = destinationPath(absolute(options.directory, 'directory'));
  const roots = protection(directory, run, options);
  const report = auditReport(run, baseline, changeSet);
  argument(validators.checkEvaluation(report), 'The evaluation cannot form a conforming Check audit report.');
  const reportBytes = jsonBytes(report), evidenceFiles = [];
  for (const [evaluationIndex, evaluation] of run.evaluations.entries()) {
    for (const [evidenceIndex, evidence] of evaluation.evidence.entries()) {
      const extension = evidence.mediaType.startsWith('text/') ? 'txt' : 'bin';
      const file = `evidence/${evaluationIndex + 1}-${evidenceIndex + 1}.${extension}`;
      evidenceFiles.push({ evaluationIndex, evidenceIndex, file, summary: evidence.summary, mediaType: evidence.mediaType,
        byteLength: evidence.byteLength, sha256: evidence.sha256, bytes: Buffer.from(evidence.bytesBase64, 'base64') });
    }
  }
  const provenance = {
    contract, run: { id: run.id, actor: run.actor, startedAt: run.startedAt, completedAt: run.completedAt,
      atlasRoot: run.atlasRoot, sourceIdentity: run.sourceIdentity, status: run.status, scope: run.scope,
      coverage: run.coverage, requiredSatisfied: run.requiredSatisfied, wholeAtlasCompliant: run.wholeAtlasCompliant,
      complete: run.complete, freshness: run.freshness, ...(run.preparedChange ? { preparedChange: run.preparedChange } : {}) },
    report: { file: 'report.json', byteLength: reportBytes.length, sha256: hash(reportBytes) },
    baseline: { value: baseline, origin: options.baseline === undefined ? 'captured-source-identity' : 'caller-declared' },
    changeSet: { value: changeSet, origin: options.changeSet === undefined ? 'evaluation-scope' : 'caller-declared' },
    receipts: run.evaluations.map(({ check, revision, path: checkPath, actor, evaluator }) => ({ check, revision, path: checkPath, actor, evaluator })),
    evidence: evidenceFiles.map(({ bytes, ...entry }) => entry),
    retainedAt: new Date().toISOString(), repositoryRoot: roots.repositoryRoot,
    limits: ['Hashes establish retained byte integrity, not actor authentication or semantic truth.',
      'Caller-declared baseline and change-set metadata are recorded without resolving Git or proving a diff.',
      'Retention does not run Verification. Reading a report does not re-run an evaluator or fetch external evidence.'],
  };
  const provenanceBytes = jsonBytes(provenance);
  argument(reportBytes.length <= 16 * 1024 * 1024 && provenanceBytes.length <= 16 * 1024 * 1024,
    'Retained report or provenance exceeds the 16 MiB file limit.');
  try {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    // Exclusive ownership of a new directory prevents replacement of an earlier report.
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.mkdirSync(path.join(directory, 'evidence'), { mode: 0o700 });
    for (const evidence of evidenceFiles) bytesFile(path.join(directory, evidence.file), evidence.bytes);
    bytesFile(path.join(directory, 'report.json'), reportBytes);
    // This is the completion record. Interrupted partial bundles have no readable provenance.
    bytesFile(path.join(directory, 'provenance.json'), provenanceBytes);
    return freezeEvaluation({ status: 'retained', directory, report, provenance });
  } catch (error) {
    fail('atlas.evaluation.report-unavailable', `Report retention failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRegular(directory, file, limit) {
  if (!relative(file) || file === '.') fail('atlas.evaluation.invalid-report', 'Invalid retained file path.');
  const target = path.join(directory, file);
  let current = directory;
  for (const component of file.split('/')) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) fail('atlas.evaluation.invalid-report', 'Retained report files must not traverse symlinks.');
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.size > limit) fail('atlas.evaluation.invalid-report', 'Retained report file has an invalid kind or size.');
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size !== stat.size || before.ino !== stat.ino || before.dev !== stat.dev) fail('atlas.evaluation.invalid-report', 'Retained file changed while opening.');
    const buffer = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const next = fs.readSync(descriptor, buffer, count, buffer.length - count, null);
      if (next === 0) break;
      count += next;
    }
    const bytes = buffer.subarray(0, count);
    const after = fs.fstatSync(descriptor);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('atlas.evaluation.invalid-report', 'Retained file changed while reading.');
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function validateProvenance(value, report) {
  const invalid = () => fail('atlas.evaluation.invalid-report', 'Retained provenance is malformed or inconsistent with the audit report.');
  const actor = (item) => keys(item, ['kind', 'id']) && ['human', 'agent', 'tool'].includes(item.kind) && text(item.id);
  const date = (item) => text(item) && Number.isFinite(Date.parse(item));
  if (!keys(value, ['contract', 'run', 'report', 'baseline', 'changeSet', 'receipts', 'evidence', 'retainedAt', 'repositoryRoot', 'limits'])
    || value.contract !== contract || !keys(value.run, ['id', 'actor', 'startedAt', 'completedAt', 'atlasRoot', 'sourceIdentity', 'status', 'scope', 'coverage',
      'requiredSatisfied', 'wholeAtlasCompliant', 'complete', 'freshness', 'preparedChange']) || !plain(value.report) || !actor(value.run.actor)
    || !text(value.run.id) || !date(value.run.startedAt) || !date(value.run.completedAt) || !date(value.retainedAt)
    || !plain(value.run.sourceIdentity) || !/^[a-f0-9]{64}$/u.test(value.run.sourceIdentity.digest)
    || !Array.isArray(value.run.sourceIdentity.inputs) || !path.isAbsolute(value.run.atlasRoot ?? '')
    || !keys(value.run.scope, ['paths', 'checkIds']) || !Array.isArray(value.run.scope.paths) || !value.run.scope.paths.length
    || !value.run.scope.paths.every(relative) || !(value.run.scope.checkIds === null || Array.isArray(value.run.scope.checkIds) && value.run.scope.checkIds.every(text))
    || !keys(value.run.coverage, ['wholeAtlas', 'omittedChecks', 'uncoveredSubjects', 'unresolvedPaths', 'inapplicableChecks'])
    || typeof value.run.coverage.wholeAtlas !== 'boolean'
    || !['omittedChecks', 'uncoveredSubjects', 'unresolvedPaths', 'inapplicableChecks'].every((key) => Array.isArray(value.run.coverage[key]))
    || !value.run.coverage.unresolvedPaths.every(relative)
    || !plain(value.run.freshness) || !['fresh', 'stale', 'unavailable'].includes(value.run.freshness.status)
    || !['evaluated', 'stale', 'incomplete'].includes(value.run.status)
    || !['requiredSatisfied', 'wholeAtlasCompliant', 'complete'].every((key) => typeof value.run[key] === 'boolean')
    || value.run.complete !== report.complete || (value.run.complete && value.run.wholeAtlasCompliant) !== report.compliant
    || value.baseline?.value !== report.baseline || !['captured-source-identity', 'caller-declared'].includes(value.baseline?.origin)
    || JSON.stringify(value.changeSet?.value) !== JSON.stringify(report.changeSet) || !['evaluation-scope', 'caller-declared'].includes(value.changeSet?.origin)
    || value.report.file !== 'report.json' || !sha(value.report.sha256) || !Number.isSafeInteger(value.report.byteLength)
    || !Array.isArray(value.receipts) || value.receipts.length !== report.evaluations.length || !Array.isArray(value.evidence)
    || !text(value.repositoryRoot) || !path.isAbsolute(value.repositoryRoot) || !Array.isArray(value.limits) || !value.limits.every(text)) invalid();
  const identity = value.run.sourceIdentity;
  if (!text(identity.inputDigest) || !/^[a-f0-9]{64}$/u.test(identity.inputDigest) || !plain(identity.scope)
    || !['working-tree', 'snapshot'].includes(identity.scope.kind) || identity.scope.root !== value.run.atlasRoot
    || !['checked-working-tree', 'immutable-snapshot'].includes(identity.consistency)
    || !text(identity.specificationRevision) || !plain(identity.implementation) || !text(identity.implementation.name) || !text(identity.implementation.version)
    || !plain(identity.configuration) || !Number.isSafeInteger(identity.configuration.maxDocumentBytes) || identity.configuration.maxDocumentBytes < 1) invalid();
  const inputPaths = new Set();
  for (const input of identity.inputs) {
    if (!plain(input) || !relative(input.path) || inputPaths.has(input.path)
      || !['file', 'directory', 'missing', 'nested-atlas', 'symlink', 'special', 'unreadable'].includes(input.kind)) invalid();
    if (input.kind === 'file' && (!/^[a-f0-9]{64}$/u.test(input.sha256) || !Number.isSafeInteger(input.byteLength) || input.byteLength < 0)) invalid();
    if (input.kind === 'symlink' && typeof input.target !== 'string' || input.kind === 'unreadable' && !text(input.error)) invalid();
    inputPaths.add(input.path);
  }
  if (value.run.preparedChange !== undefined && (!keys(value.run.preparedChange, ['planDigest', 'paths'])
    || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value.run.preparedChange.planDigest)
    || !Array.isArray(value.run.preparedChange.paths) || !value.run.preparedChange.paths.every(relative))) invalid();
  for (const [index, receipt] of value.receipts.entries()) {
    const evaluation = report.evaluations[index];
    if (!keys(receipt, ['check', 'revision', 'path', 'actor', 'evaluator']) || receipt.check !== evaluation.check
      || receipt.revision !== evaluation.revision || !relative(receipt.path) || !actor(receipt.actor)
      || JSON.stringify(receipt.actor) !== JSON.stringify(value.run.actor)) invalid();
    if (receipt.evaluator !== null && (!keys(receipt.evaluator, ['id', 'version', 'capabilities', 'startedAt', 'completedAt', 'invoked'])
      || !text(receipt.evaluator.id) || !text(receipt.evaluator.version) || !Array.isArray(receipt.evaluator.capabilities)
      || !receipt.evaluator.capabilities.every(text) || !date(receipt.evaluator.startedAt) || !date(receipt.evaluator.completedAt)
      || typeof receipt.evaluator.invoked !== 'boolean')) invalid();
  }
  const seen = new Set(), files = new Set();
  for (const evidence of value.evidence) {
    if (!keys(evidence, ['evaluationIndex', 'evidenceIndex', 'file', 'summary', 'mediaType', 'byteLength', 'sha256'])
      || !Number.isSafeInteger(evidence.evaluationIndex) || !Number.isSafeInteger(evidence.evidenceIndex)
      || !/^evidence\/[1-9][0-9]*-[1-9][0-9]*\.(?:txt|bin)$/u.test(evidence.file)
      || !text(evidence.summary) || !text(evidence.mediaType) || !Number.isSafeInteger(evidence.byteLength)
      || evidence.byteLength < 0 || !sha(evidence.sha256)
      || report.evaluations[evidence.evaluationIndex]?.evidence[evidence.evidenceIndex] !== evidence.summary) invalid();
    const key = `${evidence.evaluationIndex}:${evidence.evidenceIndex}`;
    if (seen.has(key) || files.has(evidence.file)) invalid();
    seen.add(key); files.add(evidence.file);
  }
  if (seen.size !== report.evaluations.reduce((count, evaluation) => count + evaluation.evidence.length, 0)
    || value.evidence.reduce((count, evidence) => count + evidence.byteLength, 0) > 8 * 1024 * 1024) invalid();
}

export function readCheckReport(directory, options = {}) {
  argument(keys(options, ['view']), 'Unsupported report reading options.');
  directory = absolute(directory, 'directory');
  const view = options.view;
  argument(view === undefined || (view?.contract === 'atlas.read-view/2' && typeof view.freshness === 'function'), 'view must be an opened Atlas view.');
  if (view !== undefined) localSourceTargets(view);
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('atlas.evaluation.invalid-report', 'A retained report must be a real directory.');
    directory = fs.realpathSync(directory);
    const provenance = JSON.parse(readRegular(directory, 'provenance.json', 16 * 1024 * 1024));
    const reportBytes = readRegular(directory, 'report.json', 16 * 1024 * 1024), report = JSON.parse(reportBytes);
    if (!validators.checkEvaluation(report)) fail('atlas.evaluation.invalid-report', 'The retained audit report does not conform to check-evaluation:1.');
    validateProvenance(provenance, report);
    if (reportBytes.length !== provenance.report.byteLength || hash(reportBytes) !== provenance.report.sha256) fail('atlas.evaluation.invalid-report', 'The audit report hash does not match retained provenance.');
    const evidence = provenance.evidence.map((entry) => {
      const bytes = readRegular(directory, entry.file, 8 * 1024 * 1024);
      if (bytes.length !== entry.byteLength || hash(bytes) !== entry.sha256) fail('atlas.evaluation.invalid-report', `Retained evidence failed integrity verification: ${entry.file}`);
      return { ...entry, bytesBase64: bytes.toString('base64') };
    });
    let freshness = { status: 'unavailable', reason: 'No current Atlas view was supplied.' };
    if (view) {
      const observed = view.freshness();
      const sourceMatches = isDeepStrictEqual(view.identity, provenance.run.sourceIdentity);
      const checkChanges = provenance.receipts.filter((receipt) => {
        const check = view.validation.normalized?.checks.find(item => item.id === receipt.check);
        return !check || checkRevisionForView(view, check) !== receipt.revision;
      }).map((receipt) => receipt.check);
      freshness = { status: observed.status === 'unavailable' || !view.identity.digest ? 'unavailable'
        : observed.status === 'fresh' && sourceMatches && checkChanges.length === 0 ? 'fresh' : 'historical',
      sourceMatches, checkChanges, observed };
    }
    return freezeEvaluation({ status: 'read', integrity: 'verified', authenticity: 'not-authenticated', directory,
      report, provenance, evidence, freshness });
  } catch (error) {
    if (error instanceof AtlasToolError) throw error;
    fail('atlas.evaluation.invalid-report', `The retained report could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
