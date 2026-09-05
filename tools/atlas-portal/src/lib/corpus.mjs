import fs from 'node:fs';
import { parseCorpus } from '../core/model.mjs';

export function loadCorpus() {
  const corpusPath = process.env.ATLAS_PORTAL_CORPUS;
  if (!corpusPath || !fs.existsSync(corpusPath)) {
    throw new Error('Atlas portal corpus is missing. Start Astro through the atlas-portal command.');
  }
  const value = /** @type {unknown} */ (JSON.parse(fs.readFileSync(corpusPath, 'utf8')));
  return parseCorpus(value);
}
