import process from 'node:process';
import { inspectPoint } from 'atlas-reference-validator';

const usage = 'Usage: atlas-inspect <atlas-path> --point <exact-id> [--specification-revision REVISION]';

export function run(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log(`${usage}\n\nPrint one Point, its contexts, and source metadata as JSON. Local inspection applies no publication profile.`);
      return 0;
    }
    if (argument === '--point' || argument === '--specification-revision') {
      const key = argument === '--point' ? 'pointId' : 'specificationRevision';
      if (options[key] !== undefined) throw new Error(`${argument} can be supplied only once.`);
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.`);
      options[key] = value;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (options.atlasPath !== undefined) {
      throw new Error('Only one Atlas path can be supplied.');
    } else {
      options.atlasPath = argument;
    }
  }
  if (!options.atlasPath || !options.pointId) throw new Error(usage);
  const result = inspectPoint(options.atlasPath, options.pointId, options);
  console.log(JSON.stringify(result, null, 2));
  return { found: 0, invalid: 1, incomplete: 2, 'not-found': 3 }[result.status];
}
