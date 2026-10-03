import { readFileSync, existsSync } from 'node:fs';
import { parseMarkdown } from './frontmatter.mjs';

const IDS = ['explanatory-perspectives', 'concise-perspectives', 'explanatory-subjects', 'concise-subjects', 'explanatory-synthesis', 'concise-synthesis'];

/** Curated definitions are read locally; adoption captures these exact bytes. */
export function getStyle(id) {
  if (!IDS.includes(id)) return null;
  const candidates = [new URL(`../../styles-release/${id}.md`, import.meta.url), new URL(`../../styles/${id}.md`, import.meta.url)];
  const file = candidates.find(candidate => existsSync(candidate));
  if (!file) throw Object.assign(new Error(`Curated style ${id} is not installed.`), { code: 'STYLE_UNAVAILABLE' });
  const content = readFileSync(file, 'utf8');
  const { header, title, body } = parseMarkdown(content);
  if (header.id !== id || typeof header.revision !== 'string' || !header.revision.trim()) throw Object.assign(new Error(`Curated style ${id} has invalid metadata.`), { code: 'STYLE_INVALID' });
  return { ...header, title, body, content };
}

export function listStyles() {
  return IDS.map(id => { const { revision, title } = getStyle(id); return { id, revision, title }; });
}
