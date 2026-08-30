import fs from 'node:fs';
import path from 'node:path';

export function loadCorpus() {
  const configuredPath = process.env.ATLAS_PORTAL_CORPUS;
  const corpusPath = configuredPath ?? path.resolve('.cache/portal-corpus.json');
  if (!fs.existsSync(corpusPath)) {
    throw new Error('Atlas portal corpus is missing. Start Astro through the atlas-portal command.');
  }
  return JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
}
