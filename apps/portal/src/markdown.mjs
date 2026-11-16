// Authored Markdown, rendered for reading. Authored HTML is escaped and never runs, an image is
// named and never loaded, and a link goes only where the caller's `link` says a reader may go.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const escape = md.utils.escapeHtml;

md.renderer.rules.image = (tokens, index) => {
  const words = tokens[index].content.trim();
  return `<span class="image">[Image${words ? `: ${escape(words)}` : ''}]</span>`;
};

/** Where one authored link leads: a page of this Atlas, a page outside it, or nowhere a reader can follow. */
function destination(href, link) {
  const found = link?.(href);
  if (found) return found;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    return url.username || url.password ? null : { href: url.href, out: true };
  } catch { return null; }
}

// A heading carries an ID only where the caller names one for the line it starts on.
md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  const id = env.ids?.get(tokens[index].map?.[0]);
  return id === undefined ? self.renderToken(tokens, index, options) : `<${tokens[index].tag} id="${escape(id)}">`;
};

md.renderer.rules.link_open = (tokens, index, options, env) => {
  const to = destination(tokens[index].attrGet('href') ?? '', env.link);
  tokens[index].meta = to;
  if (!to || to.absent) return '';
  return to.out ? `<a class="out" href="${escape(to.href)}" target="_blank" rel="noopener noreferrer">` : `<a href="${escape(to.href)}">`;
};

md.renderer.rules.link_close = (tokens, index) => {
  let depth = 1, opener = index;
  while (depth && --opener >= 0) {
    if (tokens[opener].type === 'link_close') depth++;
    if (tokens[opener].type === 'link_open') depth--;
  }
  const to = tokens[opener]?.meta;
  if (!to) return '';
  return to.absent ? ' <span class="says">not in this publication</span>' : '</a>';
};

/**
 * The top-level blocks of a Markdown text, each with its exact source and its HTML.
 * `link(href)` answers for a link that is not an HTTP(S) address:
 *   { href }              a page of this Atlas
 *   { href, out: true }   an address outside the Atlas
 *   { absent: true }      a record this publication does not hold
 *   null                  nothing a reader can follow: the words stay, the link goes
 * `ids`: a Map from the source line a heading starts on to the ID that heading carries; without it, headings carry none.
 */
export function renderBlocks(text, { link, ids } = {}) {
  const env = { link, ids };
  const tokens = md.parse(text, env);
  const lines = text.split('\n');
  const blocks = [];
  for (let start = 0; start < tokens.length;) {
    let end = start;
    if (tokens[start].nesting === 1) for (let depth = 1; depth;) depth += tokens[++end].nesting;
    const [from, to] = tokens[start].map ?? [0, 0];
    blocks.push({ source: lines.slice(from, to).join('\n').trim(), html: md.renderer.render(tokens.slice(start, end + 1), md.options, env) });
    start = end + 1;
  }
  return blocks;
}
