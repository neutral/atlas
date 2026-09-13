import process from 'node:process';
import { AtlasToolError, openWorkspace } from 'atlas-reference-validator';

const usage = `Usage:
  atlas-workspace <repository-root> read|refresh [options]

Options:
  --atlas PATH                    Exact repository-relative Atlas root; . is allowed
  --specification-revision VALUE   Override the declared specification revision
  --max-document-bytes N           Bound retained raw document bytes

Print the public workspace result as JSON. Each invocation opens a fresh
in-memory workspace. Reading writes no workspace state and runs no Checks,
project commands, or network retrieval.
Exit codes: 0 ready; 1 invalid; 2 incomplete or usage errors.`;

const operations = new Set(['read', 'refresh']);
const options = new Set(['--atlas', '--specification-revision', '--max-document-bytes']);

function invalid(message) {
  throw new AtlasToolError('atlas.tools.invalid-argument', message);
}

function positiveInteger(value, option, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    invalid(`${option} requires an integer from 1 through ${maximum}.`);
  }
  return Number(value);
}

function parse(argv) {
  if (!Array.isArray(argv) || !argv.every((argument) => typeof argument === 'string')) invalid('Arguments must be strings.');
  if ((argv.length === 1 && ['--help', '-h'].includes(argv[0])) || ['--help', '-h'].includes(argv[1])) return { help: true };
  const [repositoryRoot, operation, ...rest] = argv;
  if (!repositoryRoot || repositoryRoot.startsWith('-')) invalid('A repository root is required before the operation.');
  if (!operations.has(operation)) invalid('The operation must be read or refresh.');
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (['--help', '-h'].includes(flag)) return { help: true };
    if (!options.has(flag)) invalid(`Unsupported option: ${flag}`);
    if (flags.has(flag)) invalid(`${flag} can be supplied only once.`);
    const value = rest[++index];
    if (value === undefined || !value || value.startsWith('-')) invalid(`${flag} requires a value.`);
    flags.set(flag, value);
  }
  const configuration = {};
  if (flags.has('--specification-revision')) configuration.specificationRevision = flags.get('--specification-revision');
  if (flags.has('--max-document-bytes')) configuration.maxDocumentBytes = positiveInteger(flags.get('--max-document-bytes'), '--max-document-bytes');
  return { operation, workspaceOptions: {
    repositoryRoot,
    ...(flags.has('--atlas') ? { atlasPath: flags.get('--atlas') } : {}),
    ...(Object.keys(configuration).length ? { configuration } : {}),
  } };
}

export function errorResult(error) {
  return { error: {
    code: error instanceof AtlasToolError ? error.code : 'atlas.tools.unexpected-error',
    message: error instanceof Error ? error.message : String(error),
  } };
}

export function run(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.help) { console.log(usage); return 0; }
  const workspace = openWorkspace(parsed.workspaceOptions);
  try {
    const result = workspace[parsed.operation]();
    console.log(JSON.stringify(result, null, 2));
    return { ready: 0, invalid: 1, incomplete: 2 }[result.view.status] ?? 2;
  } finally { workspace.close(); }
}
