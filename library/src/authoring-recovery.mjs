import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest } from './source-inventory.mjs';
import { isWithin, pathContainsSymlink, pathCaseOrNormalizationMismatch } from './util.mjs';
import { authoringError, object, requireAuthoring } from './authoring-operations.mjs';
import { freezeAuthoring, planDigest } from './authoring.mjs';

function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function fileBytes(value, withPath = false) {
  if (!exactKeys(value, ['sha256', 'bytesBase64', 'byteLength', ...(withPath ? ['path'] : [])])
    || !hash(value.sha256) || typeof value.bytesBase64 !== 'string' || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 0 || withPath && typeof value.path !== 'string') return false;
  const bytes = Buffer.from(value.bytesBase64, 'base64');
  return bytes.length === value.byteLength && bytes.toString('base64') === value.bytesBase64 && digest(bytes) === value.sha256;
}
export function validSealedPlan(plan) {
  if (!exactKeys(plan, ['contract', 'repositoryRoot', 'atlasRoot', 'atlasPath', 'request', 'configuration', 'configurationSourceDigest',
    'processorDigest', 'baseline', 'changes', 'pointDecisions', 'subjects', 'adoptedChecks',
    'localTargets', 'validation', 'checks', 'status', 'gaps', 'limits', 'digest'])) return false;
  const baseline = plan.baseline, request = plan.request, checks = plan.checks;
  return plan.contract === 'atlas.change-plan/2' && hash(plan.digest) && planDigest(plan) === plan.digest
    && ['ready', 'invalid', 'no-op'].includes(plan.status) && hash(plan.processorDigest)
    && (plan.configurationSourceDigest === null || hash(plan.configurationSourceDigest))
    && ['repositoryRoot', 'atlasRoot'].every((key) => typeof plan[key] === 'string' && path.isAbsolute(plan[key]))
    && typeof plan.atlasPath === 'string' && strings(plan.gaps) && strings(plan.limits)
    && exactKeys(plan.configuration, ['specificationRevision', 'maxDocumentBytes'])
    && typeof plan.configuration.specificationRevision === 'string'
    && Number.isSafeInteger(plan.configuration.maxDocumentBytes) && plan.configuration.maxDocumentBytes > 0
    && object(request) && ['repositoryRoot', 'atlasPath', 'expected', 'operations'].every((key) => Object.hasOwn(request, key))
    && Object.keys(request).every((key) => ['repositoryRoot', 'atlasPath', 'expected', 'operations', 'configuration'].includes(key))
    && typeof request.repositoryRoot === 'string' && path.isAbsolute(request.repositoryRoot) && request.atlasPath === plan.atlasPath
    && (request.configuration === undefined || object(request.configuration)
      && Object.keys(request.configuration).every((key) => ['specificationRevision', 'maxDocumentBytes'].includes(key))
      && (request.configuration.specificationRevision === undefined || typeof request.configuration.specificationRevision === 'string' && request.configuration.specificationRevision.trim().length > 0)
      && (request.configuration.maxDocumentBytes === undefined || Number.isSafeInteger(request.configuration.maxDocumentBytes) && request.configuration.maxDocumentBytes > 0))
    && object(request.expected) && Object.keys(request.expected).length === 1
    && (typeof request.expected.viewDigest === 'string' || request.expected.atlasMissing === true)
    && Array.isArray(request.operations) && request.operations.length > 0 && request.operations.every(object)
    && exactKeys(baseline, ['identity', 'explicitLocalTargets', 'inputDigest', 'inputs', 'files', 'directories', 'boundaries', 'rootPresent', 'atlasPresent'])
    && (baseline.identity === null || object(baseline.identity)) && hash(baseline.inputDigest)
    && strings(baseline.explicitLocalTargets) && strings(baseline.directories) && strings(baseline.boundaries)
    && typeof baseline.rootPresent === 'boolean' && typeof baseline.atlasPresent === 'boolean'
    && Array.isArray(baseline.inputs) && baseline.inputs.every(object)
    && Array.isArray(baseline.files) && baseline.files.every((file) => fileBytes(file, true))
    && Array.isArray(plan.changes) && plan.changes.every((change) => exactKeys(change, ['path', 'operation', 'before', 'after', 'diff'])
      && typeof change.path === 'string' && ['create', 'update'].includes(change.operation)
      && (change.before === null ? change.operation === 'create' : change.operation === 'update' && fileBytes(change.before))
      && fileBytes(change.after) && typeof change.diff === 'string')
    && ['pointDecisions', 'subjects', 'adoptedChecks'].every((key) => Array.isArray(plan[key]) && plan[key].every(object))
    && exactKeys(plan.localTargets, ['before', 'after'])
    && ['before', 'after'].every((key) => strings(plan.localTargets[key]) && plan.localTargets[key].every((target) => path.isAbsolute(target)))
    && exactKeys(plan.validation, ['before', 'after']) && ['before', 'after'].every((key) => object(plan.validation[key])
      && typeof plan.validation[key].complete === 'boolean' && typeof plan.validation[key].valid === 'boolean' && Array.isArray(plan.validation[key].diagnostics))
    && exactKeys(checks, ['scope', 'complete', 'requiredSatisfied', 'applicable', 'unresolved', 'diagnostics', 'unresolvedCheckIds'])
    && checks.scope === 'whole-proposal' && typeof checks.complete === 'boolean' && typeof checks.requiredSatisfied === 'boolean'
    && ['applicable', 'unresolved', 'diagnostics'].every((key) => Array.isArray(checks[key]) && checks[key].every(object))
    && strings(checks.unresolvedCheckIds);
}
function safeDirectory(directory) {
  requireAuthoring(typeof directory === 'string' && path.isAbsolute(directory) && !directory.includes('\0')
    && !pathContainsSymlink(path.parse(directory).root, directory)
    && !pathCaseOrNormalizationMismatch(path.parse(directory).root, directory)
    && fs.lstatSync(directory).isDirectory(), 'Recovery inspection requires an exact regular directory without path aliases.');
}
function readFile(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  requireAuthoring(stat.isFile() && !stat.isSymbolicLink() && stat.size < BigInt(Number.MAX_SAFE_INTEGER), 'Recovery entries must be complete regular files.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true }), buffer = Buffer.alloc(Number(stat.size) + 1);
    let offset = 0, count;
    while (offset < buffer.length && (count = fs.readSync(fd, buffer, offset, buffer.length - offset, null))) offset += count;
    const after = fs.fstatSync(fd, { bigint: true }), bytes = buffer.subarray(0, offset);
    requireAuthoring(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size && offset === Number(stat.size) && before.size === after.size
      && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'Recovery content changed during inspection.');
    return { bytes, identity: `${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` };
  } finally { fs.closeSync(fd); }
}
function json(bytes) {
  try { return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)); }
  catch { throw authoringError('invalid-recovery', 'Recovery metadata must contain complete UTF-8 JSON.'); }
}
function inactive(bytes) {
  const owner = json(bytes);
  requireAuthoring(exactKeys(owner, ['contract', 'host', 'pid']) && owner.contract === 'atlas.change-owner/1'
    && typeof owner.host === 'string' && Number.isSafeInteger(owner.pid) && owner.pid > 0, 'Unsupported recovery owner metadata.');
  if (owner.host !== os.hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

export function inspectAtlasRecovery(options) {
  requireAuthoring(exactKeys(options, ['repositoryRoot', 'atlasPath', 'recoveryDirectory']), 'Recovery inspection requires exact repositoryRoot, atlasPath, and recoveryDirectory.');
  const { repositoryRoot, atlasPath, recoveryDirectory } = options;
  safeDirectory(repositoryRoot); safeDirectory(recoveryDirectory);
  requireAuthoring(typeof atlasPath === 'string' && (atlasPath === '.' || atlasPath.split('/').every((part) => part && !['.', '..'].includes(part)))
    && !path.isAbsolute(atlasPath) && !/[\\\0]/u.test(atlasPath), 'Recovery inspection requires an exact repository-relative Atlas path.');
  const atlasRoot = path.resolve(repositoryRoot, atlasPath);
  requireAuthoring(isWithin(repositoryRoot, atlasRoot), 'The selected Atlas must be contained in the repository.');
  const files = [];
  for (const entry of fs.readdirSync(recoveryDirectory).sort()) {
    if (entry === 'originals') {
      safeDirectory(path.join(recoveryDirectory, entry));
      for (const original of fs.readdirSync(path.join(recoveryDirectory, entry)).sort()) {
        requireAuthoring(/^(?:0|[1-9][0-9]*)\.bin$/u.test(original), 'Unrecognized recovery original.');
        files.push(`originals/${original}`);
      }
    } else {
      requireAuthoring(['manifest.json', 'plan.json', 'active.json'].includes(entry) || /^event-[0-9]{5,}\.json$/u.test(entry), 'Unrecognized recovery entry.');
      files.push(entry);
    }
  }
  const entries = files.map((relative) => {
    const { bytes, identity } = readFile(path.join(recoveryDirectory, relative));
    return { path: relative, sha256: digest(bytes), bytesBase64: bytes.toString('base64'), identity };
  });
  const content = (name) => {
    const found = entries.find((entry) => entry.path === name);
    if (!found) throw authoringError('invalid-recovery', `Recovery metadata ${name} is missing. Inspect the remaining files directly.`);
    return Buffer.from(found.bytesBase64, 'base64');
  };
  const manifest = json(content('manifest.json')), plan = json(content('plan.json'));
  requireAuthoring(exactKeys(manifest, ['contract', 'repositoryRoot', 'atlasRoot', 'planDigest'])
    && manifest.contract === 'atlas.change-recovery/2' && manifest.repositoryRoot === repositoryRoot && manifest.atlasRoot === atlasRoot,
  'Unsupported recovery metadata or another workspace owns this recovery.');
  requireAuthoring(validSealedPlan(plan) && plan.digest === manifest.planDigest
    && plan.repositoryRoot === repositoryRoot && plan.atlasRoot === atlasRoot && plan.atlasPath === atlasPath
    && object(plan.localTargets)
    && ['before', 'after'].every((key) => Array.isArray(plan.localTargets[key]) && plan.localTargets[key].every((target) => typeof target === 'string' && path.isAbsolute(target))),
  'The complete current recovery plan and its workspace identity are required.');
  requireAuthoring(![atlasRoot, path.join(repositoryRoot, 'tmp'), path.join(repositoryRoot, '.git')].some((root) => isWithin(root, recoveryDirectory) || isWithin(recoveryDirectory, root))
    && ![...plan.localTargets.before, ...plan.localTargets.after].some((target) => isWithin(target, recoveryDirectory) || isWithin(recoveryDirectory, target)), 'Recovery storage intersects a protected source path.');
  const active = entries.find((entry) => entry.path === 'active.json');
  const canDiscard = !active || inactive(Buffer.from(active.bytesBase64, 'base64'));
  return freezeAuthoring({ contract: 'atlas.change-recovery-inspection/1', repositoryRoot, atlasPath, recoveryDirectory,
    planDigest: plan.digest, inactive: canDiscard, digest: digest(Buffer.from(JSON.stringify(entries))), files: entries,
    limits: ['Inspection grants no permission to discard. Discard removes only this operation recovery and never changes Atlas files.',
      'A live or inaccessible process and another host prevent discard. Filesystem checks do not provide a multi-process transaction.'] });
}

export function discardAtlasRecovery(options) {
  requireAuthoring(exactKeys(options, ['repositoryRoot', 'atlasPath', 'recoveryDirectory', 'inspectedDigest'])
    && typeof options.inspectedDigest === 'string' && /^[a-f0-9]{64}$/u.test(options.inspectedDigest), 'Discard requires the exact inspected recovery digest and workspace.');
  const { inspectedDigest, ...selection } = options, inspection = inspectAtlasRecovery(selection);
  if (!inspection.inactive) throw authoringError('recovery-active', 'The recovery owner may still be active. Stop that writer before inspecting and discarding recovery.');
  if (inspection.digest !== inspectedDigest) throw authoringError('stale', 'Recovery changed after inspection. Inspect the complete remaining state again.');
  const removed = [];
  try {
    // Keep the complete plan until its separate originals and progress are removed.
    const last = (entry) => entry.path === 'plan.json' ? 2 : entry.path === 'manifest.json' ? 1 : 0;
    const entries = [...inspection.files].sort((left, right) => last(left) - last(right));
    for (const entry of entries) {
      safeDirectory(selection.recoveryDirectory);
      if (entry.path.startsWith('originals/')) safeDirectory(path.join(selection.recoveryDirectory, 'originals'));
      const current = readFile(path.join(selection.recoveryDirectory, entry.path));
      if (current.identity !== entry.identity || digest(current.bytes) !== entry.sha256) throw authoringError('stale', 'Recovery content changed during discard.');
      fs.unlinkSync(path.join(selection.recoveryDirectory, entry.path)); removed.push(entry.path);
    }
    const originals = path.join(selection.recoveryDirectory, 'originals');
    if (fs.existsSync(originals)) fs.rmdirSync(originals);
    fs.rmdirSync(selection.recoveryDirectory);
    const fd = fs.openSync(path.dirname(selection.recoveryDirectory), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return freezeAuthoring({ contract: 'atlas.change-recovery-discard/1', status: 'discarded', recoveryDirectory: selection.recoveryDirectory, removed, gaps: [] });
  } catch (error) {
    const gaps = [`Recovery cleanup is incomplete: ${error.message}`];
    try {
      safeDirectory(selection.recoveryDirectory);
      for (const name of ['manifest.json', 'plan.json']) {
        if (fs.existsSync(path.join(selection.recoveryDirectory, name))) continue;
        const entry = inspection.files.find((item) => item.path === name);
        const fd = fs.openSync(path.join(selection.recoveryDirectory, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.writeFileSync(fd, Buffer.from(entry.bytesBase64, 'base64')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      const fd = fs.openSync(selection.recoveryDirectory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch { gaps.push('Complete recovery metadata could not be retained; inspect the remaining path directly.'); }
    return freezeAuthoring({ contract: 'atlas.change-recovery-discard/1', status: 'partial', recoveryDirectory: selection.recoveryDirectory,
      removed, gaps });
  }
}
