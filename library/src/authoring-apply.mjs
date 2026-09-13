import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { digest } from './source-inventory.mjs';
import { isWithin, pathContainsSymlink, pathCaseOrNormalizationMismatch } from './util.mjs';
import { authoringError, object, requireAuthoring } from './authoring-operations.mjs';
import { authoringSettings, captureAuthoring, freezeAuthoring, verifyPreparedPlan } from './authoring.mjs';
import { inspectAtlasRecovery, discardAtlasRecovery } from './authoring-recovery.mjs';

function safeDestination(root, relative) {
  const target = path.resolve(root, relative);
  requireAuthoring(isWithin(root, target) && target !== root, 'The destination must be a contained Atlas file.');
  if (pathContainsSymlink(path.parse(root).root, target) || pathCaseOrNormalizationMismatch(path.parse(root).root, target)) {
    throw authoringError('stale', `Destination ${relative} traverses a symlink or path alias.`);
  }
  return target;
}
function currentBytes(target) {
  let fd;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return { kind: 'unsupported' };
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd, { bigint: true });
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return { kind: 'changed' };
    return { kind: 'file', sha256: digest(bytes), mode: stat.mode & 0o777 };
  } catch (error) { if (error.code === 'ENOENT') return { kind: 'missing' }; throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function matches(current, expected) { return expected ? current.kind === 'file' && current.sha256 === expected.sha256 : current.kind === 'missing'; }
function durableFile(file, bytes, mode = 0o600) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function recoveryRoot(selected, plan) {
  requireAuthoring(typeof selected === 'string' && path.isAbsolute(selected) && !selected.includes('\0'), 'An absolute durable recoveryDirectory is required.');
  const missing = [];
  let existing = path.resolve(selected);
  while (true) {
    try {
      const stat = fs.lstatSync(existing);
      requireAuthoring(stat.isDirectory() && !stat.isSymbolicLink(), 'Recovery storage must be a regular directory.');
      existing = fs.realpathSync(existing); break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      requireAuthoring(parent !== existing, 'Recovery parent cannot be located.'); existing = parent;
    }
  }
  const directory = path.join(existing, ...missing);
  requireAuthoring(![plan.atlasRoot, path.join(plan.repositoryRoot, 'tmp'), path.join(plan.repositoryRoot, '.git')]
    .some((root) => isWithin(root, directory) || isWithin(directory, root)), 'Recovery storage must be separate from the Atlas, repository tmp, and .git.');
  const sourceTargets = [...plan.localTargets.before, ...plan.localTargets.after];
  requireAuthoring(!sourceTargets.some((target) => isWithin(directory, target) || isWithin(target, directory)), 'Recovery storage must not intersect an authored local source target.');
  return directory;
}
function finalConflict(plan, captured) {
  const expected = new Map(plan.baseline.files.map((file) => [file.path, file.sha256]));
  for (const change of plan.changes) expected.set(change.path, change.after.sha256);
  const actual = new Map([...captured.files].map(([file, bytes]) => [file, digest(bytes)]));
  const conflicts = [...new Set([...expected.keys(), ...actual.keys()])].filter((file) => expected.get(file) !== actual.get(file));
  const expectedDirectories = new Set(plan.baseline.directories);
  for (const change of plan.changes) {
    let directory = path.posix.dirname(change.path);
    while (true) { expectedDirectories.add(directory); if (directory === '.') break; directory = path.posix.dirname(directory); }
  }
  for (const directory of new Set([...expectedDirectories, ...captured.directories])) {
    if (expectedDirectories.has(directory) !== captured.directories.includes(directory)) conflicts.push(directory);
  }
  if (JSON.stringify(captured.boundaries) !== JSON.stringify(plan.baseline.boundaries)) conflicts.push('nested Atlas boundaries');
  return conflicts;
}

export function applyAtlasChange(input, options = {}) {
  requireAuthoring(object(options) && Object.keys(options).every((key) => ['recoveryDirectory', 'mode'].includes(key)), 'Unsupported apply options.');
  const mode = options.mode ?? 'validated';
  requireAuthoring(['validated', 'draft'].includes(mode), 'Apply mode must be validated or draft.');
  const base = { contract: 'atlas.change-application/1', planDigest: input?.digest ?? null, written: [], pending: [], conflicts: [],
    gaps: [], limits: ['Apply does not establish Check compliance or task completion.',
      'Per-file replacement is not a whole-Atlas transaction or filesystem compare-and-swap. Recovery never overwrites later edits automatically.'] };
  let plan;
  try { plan = verifyPreparedPlan(input); }
  catch (error) {
    if (['atlas.authoring.stale', 'atlas.authoring.incomplete', 'atlas.authoring.unsupported-source', 'atlas.workspace.invalid-configuration', 'ENOENT', 'ENOTDIR', 'EIO', 'EACCES'].includes(error.code)) {
      return freezeAuthoring({ ...base, status: 'stale', pending: input?.changes?.map((change) => change.path) ?? [], conflicts: [{ path: null, reason: error.message }] });
    }
    throw error;
  }
  base.pending = plan.changes.map((change) => change.path);
  base.gaps = [...plan.gaps];
  if (mode === 'draft') requireAuthoring(plan.request.operations.every((operation) => operation.type === 'repair-document'), 'Draft mode permits only explicit raw-document repair.');
  else requireAuthoring(plan.validation.after.complete && plan.validation.after.valid, 'Validated application requires a complete valid proposal.');
  if (!plan.changes.length) return freezeAuthoring({ ...base, status: 'no-op', validation: plan.validation.after });
  const directory = recoveryRoot(options.recoveryDirectory, plan);
  const targets = plan.changes.map((change) => ({ change, target: safeDestination(plan.atlasRoot, change.path) }));
  for (const { change, target } of targets) {
    if (!matches(currentBytes(target), change.before)) return freezeAuthoring({ ...base, status: 'stale', conflicts: [{ path: change.path, reason: 'Destination does not match its expected source identity.' }] });
  }
  // No Atlas effect occurs until complete originals and the plan are durable.
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  requireAuthoring(!pathContainsSymlink(path.parse(directory).root, directory), 'Recovery path changed to a symbolic link.');
  const journal = fs.mkdtempSync(path.join(directory, 'change-'));
  fs.chmodSync(journal, 0o700);
  const activePath = path.join(journal, 'active.json');
  try {
    durableFile(activePath, `${JSON.stringify({ contract: 'atlas.change-owner/1', host: os.hostname(), pid: process.pid })}\n`);
    durableFile(path.join(journal, 'manifest.json'), `${JSON.stringify({ contract: 'atlas.change-recovery/2', repositoryRoot: plan.repositoryRoot, atlasRoot: plan.atlasRoot, planDigest: plan.digest })}\n`);
    fs.mkdirSync(path.join(journal, 'originals'), { mode: 0o700 });
    durableFile(path.join(journal, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    for (const [index, change] of plan.changes.entries()) if (change.before) durableFile(path.join(journal, 'originals', `${index}.bin`), Buffer.from(change.before.bytesBase64, 'base64'));
    syncDirectory(path.join(journal, 'originals')); syncDirectory(journal); syncDirectory(directory);
  } catch (error) {
    try { fs.unlinkSync(activePath); syncDirectory(journal); } catch { /* Incomplete preparation remains inspectable. */ }
    throw error;
  }
  const result = { ...base, recoveryDirectory: journal, recovery: { status: 'retained' }, createdDirectories: [] };
  let eventIndex = 0;
  const record = (event) => {
    durableFile(path.join(journal, `event-${String(eventIndex++).padStart(5, '0')}.json`), `${JSON.stringify(event)}\n`);
    syncDirectory(journal);
  };
  let temporary;
  try {
    record({ status: 'prepared', planDigest: plan.digest });
    for (const { change, target } of targets) {
      safeDestination(plan.atlasRoot, change.path);
      const current = currentBytes(target);
      if (!matches(current, change.before)) throw authoringError('stale', `Destination ${change.path} changed after preflight.`);
      const parents = [];
      let parent = path.dirname(target);
      while (true) {
        try { requireAuthoring(fs.lstatSync(parent).isDirectory() && !fs.lstatSync(parent).isSymbolicLink(), 'Destination parent is not a regular directory.'); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; parents.unshift(parent); parent = path.dirname(parent); }
      }
      for (const parent of parents) { fs.mkdirSync(parent); result.createdDirectories.push(path.relative(plan.atlasRoot, parent).split(path.sep).join('/') || '.'); }
      temporary = path.join(path.dirname(target), `.atlas-change-${randomUUID()}.tmp`);
      record({ status: 'writing', path: change.path, temporary });
      durableFile(temporary, Buffer.from(change.after.bytesBase64, 'base64'), current.kind === 'file' ? current.mode : 0o644);
      safeDestination(plan.atlasRoot, change.path);
      if (!matches(currentBytes(target), change.before)) throw authoringError('stale', `Destination ${change.path} changed before replacement.`);
      if (change.before) fs.renameSync(temporary, target);
      else { fs.linkSync(temporary, target); fs.unlinkSync(temporary); }
      temporary = undefined;
      result.written.push(change.path);
      result.pending = result.pending.filter((file) => file !== change.path);
      syncDirectory(path.dirname(target));
      record({ status: 'written', path: change.path, sha256: change.after.sha256 });
    }
    const settings = authoringSettings(plan.request), captured = captureAuthoring(settings, plan.baseline.explicitLocalTargets);
    const conflicts = finalConflict(plan, captured);
    if (settings.configurationSourceDigest !== plan.configurationSourceDigest) conflicts.push('atlas.workspace.json');
    result.validation = captured.view.validation.toJSON();
    if (JSON.stringify(result.validation) !== JSON.stringify(plan.validation.after)) conflicts.push('validation');
    if (conflicts.length) {
      result.conflicts.push(...conflicts.map((file) => ({ path: file, reason: 'Source differs from the complete proposed result.' })));
      result.status = 'partial';
    } else result.status = 'applied';
    record({ status: result.status, written: result.written, conflicts: result.conflicts });
  } catch (error) {
    if (temporary) { try { fs.unlinkSync(temporary); } catch { result.gaps.push(`Temporary file remains inspectable at ${temporary}.`); } }
    result.status = 'partial';
    result.conflicts.push({ path: result.pending[0] ?? null, reason: error.message });
    try { record({ status: 'partial', written: result.written, pending: result.pending, conflicts: result.conflicts }); }
    catch { result.gaps.push('Final progress could not be recorded; original bytes and the plan remain in recovery storage.'); }
  }
  try { fs.unlinkSync(activePath); syncDirectory(journal); }
  catch (error) {
    result.recovery.status = 'cleanup-failed';
    result.gaps.push(`Recovery ownership could not be released: ${error.message}`);
    return freezeAuthoring(result);
  }
  if (result.status === 'applied') {
    try {
      const selection = { repositoryRoot: plan.repositoryRoot, atlasPath: plan.atlasPath, recoveryDirectory: journal };
      const inspection = inspectAtlasRecovery(selection);
      const cleanup = discardAtlasRecovery({ ...selection, inspectedDigest: inspection.digest });
      if (cleanup.status === 'discarded') { result.recovery.status = 'removed'; delete result.recoveryDirectory; }
      else { result.recovery.status = 'cleanup-failed'; result.gaps.push(...cleanup.gaps); }
    } catch (error) {
      result.recovery.status = 'cleanup-failed';
      result.gaps.push(`Application was confirmed, but recovery cleanup failed: ${error.message}`);
    }
  }
  return freezeAuthoring(result);
}
