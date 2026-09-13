import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AtlasToolError, prepareAtlasChange, applyAtlasChange, evaluatePreparedChange, inspectAtlasRecovery, discardAtlasRecovery } from 'atlas-reference-validator';

const usage = `Usage:
  atlas-author prepare --request ABS.json --plan ABS.json
  atlas-author apply --plan ABS.json --recovery ABS [--draft]
  atlas-author evaluate --plan ABS.json --actor-kind human|agent|tool --actor-id ID
  atlas-author recovery-inspect --repository ABS --atlas REL --recovery ABS
  atlas-author recovery-discard --repository ABS --atlas REL --recovery ABS --inspected-digest SHA256

Prepare reads the explicit API request and exclusively writes a complete plan.
Apply verifies its expected source and removes recovery after confirmed success.
Recovery discard removes only inspected inactive operation storage.
Evaluate reads the sealed proposal with no default verifier or host capability.
No repository roots, identity decisions, network access, or commands are inferred.
Exit codes: 0 ready/applied/required Checks satisfied; 1 invalid/unverified;
2 stale, partial, incomplete, invalid arguments, or errors.`;
const allowed = {
  prepare: new Set(['--request', '--plan']),
  apply: new Set(['--plan', '--recovery', '--draft']),
  evaluate: new Set(['--plan', '--actor-kind', '--actor-id']),
  'recovery-inspect': new Set(['--repository', '--atlas', '--recovery']),
  'recovery-discard': new Set(['--repository', '--atlas', '--recovery', '--inspected-digest']),
};
function invalid(message) { throw new AtlasToolError('atlas.tools.invalid-argument', message); }
function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) invalid(`${label} must be an absolute path.`);
  return path.resolve(value);
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function parse(argv) {
  if (!Array.isArray(argv) || !argv.every((value) => typeof value === 'string')) invalid('Arguments must be strings.');
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  const [operation, ...rest] = argv;
  if (!Object.hasOwn(allowed, operation)) invalid('An explicit prepare, apply, evaluate, recovery-inspect, or recovery-discard operation is required.');
  if (rest.length === 1 && ['--help', '-h'].includes(rest[0])) return { help: true };
  const flags = new Map();
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index];
    if (!allowed[operation].has(option)) invalid(`Unsupported ${operation} option: ${option}`);
    if (flags.has(option)) invalid(`${option} may appear only once.`);
    if (option === '--draft') { flags.set(option, true); continue; }
    const value = rest[++index];
    if (!value || value.startsWith('--')) invalid(`${option} requires a value.`);
    flags.set(option, value);
  }
  for (const option of allowed[operation]) if (option !== '--draft' && !flags.has(option)) invalid(`${option} is required.`);
  return { operation, flags };
}
function readJson(selected) {
  const file = absolute(selected, 'JSON input');
  let fd;
  try {
    if (!fs.lstatSync(file).isFile()) invalid('JSON inputs must be regular files, not symlinks or directories.');
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd, { bigint: true });
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new AtlasToolError('atlas.authoring.stale', 'The JSON input changed while being read.');
    return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AtlasToolError) throw error;
    throw new AtlasToolError('atlas.authoring.invalid-plan-file', `Cannot read the complete UTF-8 JSON input: ${error.message}`);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function persistPlan(plan, selected) {
  const requested = absolute(selected, 'Plan output');
  let file, fd;
  try {
    const parent = fs.realpathSync(path.dirname(requested));
    if (!fs.statSync(parent).isDirectory()) invalid('The plan parent must be an existing directory.');
    file = path.join(parent, path.basename(requested));
    const protectedRoots = [plan.atlasRoot, path.join(plan.repositoryRoot, 'tmp')];
    if (protectedRoots.some((root) => within(root, file))) invalid('Plan output must be outside the Atlas and repository tmp.');
    const sources = [...plan.localTargets.before, ...plan.localTargets.after];
    if (sources.some((target) => within(target, file) || within(file, target))) invalid('Plan output must not intersect a baseline or proposed local source target.');
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(plan, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    const parentFd = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    return file;
  } catch (error) {
    if (error instanceof AtlasToolError) throw error;
    throw new AtlasToolError('atlas.authoring.plan-output', `The exclusive plan file could not be completed: ${error.message}`);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function errorResult(error) {
  return { error: { code: error instanceof AtlasToolError ? error.code : 'atlas.tools.unexpected-error', message: error instanceof Error ? error.message : String(error) } };
}
export async function run(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.help) { console.log(usage); return 0; }
  const { operation, flags } = parsed;
  if (operation.startsWith('recovery-')) {
    const selection = { repositoryRoot: absolute(flags.get('--repository'), 'Repository root'), atlasPath: flags.get('--atlas'),
      recoveryDirectory: absolute(flags.get('--recovery'), 'Recovery directory') };
    const result = operation === 'recovery-inspect' ? inspectAtlasRecovery(selection)
      : discardAtlasRecovery({ ...selection, inspectedDigest: flags.get('--inspected-digest') });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'partial' ? 2 : 0;
  }
  if (operation === 'prepare') {
    const plan = prepareAtlasChange(readJson(flags.get('--request')));
    const planPath = persistPlan(plan, flags.get('--plan'));
    console.log(JSON.stringify({ contract: 'atlas.change-plan-file/1', planPath, planDigest: plan.digest, status: plan.status }));
    return plan.status === 'invalid' ? 1 : 0;
  }
  const plan = readJson(flags.get('--plan'));
  if (operation === 'apply') {
    const result = applyAtlasChange(plan, { recoveryDirectory: absolute(flags.get('--recovery'), 'Recovery directory'), mode: flags.has('--draft') ? 'draft' : 'validated' });
    console.log(JSON.stringify(result, null, 2));
    if (['stale', 'partial'].includes(result.status) || result.validation?.complete === false || result.recovery?.status === 'cleanup-failed') return 2;
    return result.validation?.valid === false ? 1 : 0;
  }
  const actor = { kind: flags.get('--actor-kind'), id: flags.get('--actor-id') };
  if (!['human', 'agent', 'tool'].includes(actor.kind) || !actor.id.trim()) invalid('Evaluation requires an explicit human, agent, or tool actor id.');
  const result = await evaluatePreparedChange(plan, { actor });
  console.log(JSON.stringify(result, null, 2));
  if (['stale', 'incomplete'].includes(result.run.status)) return 2;
  return result.run.requiredSatisfied ? 0 : 1;
}
