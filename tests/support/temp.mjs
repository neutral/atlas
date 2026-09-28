import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../tmp/tests/', import.meta.url));

export async function tempDirectory(prefix) {
  if (!/^[a-z0-9-]+$/.test(prefix)) throw new TypeError('Use a simple fixture prefix.');
  await mkdir(root, { recursive: true });
  return realpath(await mkdtemp(path.join(root, prefix)));
}
import './state-env.mjs';
