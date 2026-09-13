import process from 'node:process';
import { AtlasToolError, openAtlas } from 'atlas-reference-validator';

const usage = `Usage:
  atlas-read <atlas-path> find <query> [--mode ranked|fts] [--type TYPE] [--limit N] [--cursor CURSOR]
  atlas-read <atlas-path> document <Atlas-relative-path>
  atlas-read <atlas-path> source (--resource ID | --uri URI) [--owner PATH] [--allow-root ABS] [--max-bytes N]
  atlas-read <atlas-path> compare <other-atlas-path>

Every operation accepts --specification-revision REVISION.
--type and --allow-root may repeat. Search types: map, area, point, resource, check.
Search defaults to ranked ordinary-text token matches. --mode fts accepts SQLite
FTS5 phrase, prefix, Boolean, and proximity syntax. Ranking supplies candidates;
it does not establish relevance, identity, or the absence of an answer.
  atlas-read <atlas-path> find 'How does authentication work?'
  atlas-read <atlas-path> find '"edge boundary" OR rotat*' --mode fts
Use -- before a positional argument that begins with a dash.

Print the public reading operation result as JSON. Raw document reads remain
available for invalid drafts. Source reads never fetch websites or execute commands.
Registered sources use atlas.md as their base; --owner supplies a direct URI base.
Exit codes: 0 read/ready/truncated/compared; 1 invalid; 2 incomplete/unavailable/
unreadable/usage errors; 3 missing/unrequested/unsupported/stale.`;

const operationOptions = {
  find: new Set(['--mode', '--type', '--limit', '--cursor']),
  document: new Set(),
  source: new Set(['--resource', '--uri', '--owner', '--allow-root', '--max-bytes']),
  compare: new Set(),
};
const exitCodes = {
  ready: 0, read: 0, truncated: 0, compared: 0,
  invalid: 1,
  incomplete: 2, unavailable: 2, unreadable: 2,
  missing: 3, unrequested: 3, unsupported: 3, stale: 3,
};

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
  const [atlasPath, operation, ...rest] = argv;
  if (!atlasPath || atlasPath.startsWith('-')) invalid('An Atlas path is required before the operation.');
  if (!Object.hasOwn(operationOptions, operation)) invalid('The operation must be find, document, source, or compare.');
  const flags = new Map(), positional = [];
  let literal = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!literal && argument === '--') { literal = true; continue; }
    if (!literal && ['--help', '-h'].includes(argument)) return { help: true };
    if (!literal && argument.startsWith('-')) {
      if (argument !== '--specification-revision' && !operationOptions[operation].has(argument)) invalid(`Unsupported ${operation} option: ${argument}`);
      const value = rest[++index];
      if (value === undefined || !value || value.startsWith('-')) invalid(`${argument} requires a value.`);
      if (flags.has(argument) && argument !== '--type' && argument !== '--allow-root') invalid(`${argument} can be supplied only once.`);
      flags.set(argument, [...(flags.get(argument) ?? []), value]);
    } else positional.push(argument);
  }
  const value = (flag) => flags.get(flag)?.[0];
  if (operation === 'source') {
    if (positional.length !== 0) invalid('source accepts a --resource or --uri option, not a positional target.');
    if (flags.has('--resource') === flags.has('--uri')) invalid('source requires exactly one of --resource or --uri.');
    if (flags.has('--owner') && !flags.has('--uri')) invalid('--owner applies only to a direct --uri source.');
  } else if (positional.length !== 1 || (operation !== 'find' && positional[0] === '')) {
    invalid(`${operation} requires exactly one ${operation === 'find' ? 'query' : operation === 'document' ? 'Atlas-relative document path' : 'other Atlas path'}.`);
  }
  const findOptions = {};
  if (flags.has('--mode')) {
    findOptions.mode = value('--mode');
    if (!['ranked', 'fts'].includes(findOptions.mode)) invalid('--mode must name ranked or fts.');
  }
  if (flags.has('--type')) {
    findOptions.types = flags.get('--type');
    if (!findOptions.types.every((type) => ['map', 'area', 'point', 'resource', 'check'].includes(type))) invalid('--type must name map, area, point, resource, or check.');
  }
  if (flags.has('--limit')) findOptions.limit = positiveInteger(value('--limit'), '--limit', 200);
  if (flags.has('--cursor')) findOptions.cursor = value('--cursor');
  const sourceOptions = {};
  if (flags.has('--owner')) sourceOptions.ownerPath = value('--owner');
  if (flags.has('--allow-root')) sourceOptions.allowedRoots = flags.get('--allow-root');
  if (flags.has('--max-bytes')) sourceOptions.maxBytes = positiveInteger(value('--max-bytes'), '--max-bytes');
  return {
    atlasPath, operation, positional: positional[0], findOptions, sourceOptions,
    openOptions: flags.has('--specification-revision') ? { specificationRevision: value('--specification-revision') } : {},
    target: flags.has('--resource') ? { resource: value('--resource') } : { uri: value('--uri') },
  };
}

export function errorResult(error) {
  return { error: {
    code: error instanceof AtlasToolError ? error.code : 'atlas.tools.unexpected-error',
    message: error instanceof Error ? error.message : String(error),
  } };
}

export async function run(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.help) { console.log(usage); return 0; }
  const view = openAtlas(options.atlasPath, options.openOptions);
  let result;
  switch (options.operation) {
    case 'find': result = view.find(options.positional, options.findOptions); break;
    case 'document': result = view.readDocument(options.positional); break;
    case 'source': result = await view.readSource(options.target, options.sourceOptions); break;
    case 'compare': result = view.compare(openAtlas(options.positional, options.openOptions)); break;
  }
  console.log(JSON.stringify(result, null, 2));
  return exitCodes[result.status] ?? 2;
}
