import { readFileSync, existsSync } from 'node:fs';
import { parsePlainMarkdown } from './frontmatter.mjs';

const IDS = ['explanatory-perspectives', 'concise-perspectives', 'explanatory-subjects', 'concise-subjects', 'explanatory-synthesis', 'concise-synthesis'];

/** A curated definition is its file: the name is its ID, the bytes are what an Atlas adopts. */
export function getStyle(id) {
  if (!IDS.includes(id)) return null;
  const candidates = [new URL(`../../styles-release/${id}.md`, import.meta.url), new URL(`../../styles/${id}.md`, import.meta.url)];
  const file = candidates.find(candidate => existsSync(candidate));
  if (!file) throw Object.assign(new Error(`Curated style ${id} is not installed.`), { code: 'STYLE_UNAVAILABLE' });
  const content = readFileSync(file, 'utf8');
  try { return { id, ...parsePlainMarkdown(content), content }; }
  catch (error) { throw Object.assign(new Error(`Curated style ${id} is not a Style definition: ${error.message}`), { code: 'STYLE_INVALID' }); }
}

export function listStyles() {
  return IDS.map(id => ({ id, title: getStyle(id).title }));
}
