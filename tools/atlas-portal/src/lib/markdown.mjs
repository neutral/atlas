import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import path from 'node:path';

/** @typedef {import('markdown-it/lib/token.mjs').default} Token */
/** @typedef {{sourcePath?: string, sourceRoutes?: Map<string,string>, portalRoutes?: Set<string>, headingPrefix?: string, sourceHeadingPrefixes?: Map<string,string>, omitLeadingTitle?: boolean}} MarkdownEnvironment */

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

/** @type {import('markdown-it/lib/renderer.mjs').RenderRule} */
const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));

/** @type {import('markdown-it/lib/renderer.mjs').RenderRule} */
const renderLink = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  if (!token) return '';
  const href = token.attrGet('href') ?? '';
  const rewritten = rewriteLocalResourceHref(href, environment);
  if (unavailableLocalHref(href, rewritten, environment)) {
    const hrefIndex = token.attrIndex('href');
    if (hrefIndex >= 0) token.attrs?.splice(hrefIndex, 1);
    token.attrSet('class', 'unavailable-local-link');
    token.attrSet('aria-disabled', 'true');
    token.attrSet('title', 'Not available in this portal');
  } else {
    token.attrSet('href', rewritten);
  }
  if (/^https?:/iu.test(href)) {
    token.attrSet('rel', 'noreferrer');
  }
  return defaultLinkOpen(tokens, index, options, environment, self);
};

markdown.renderer.rules.link_open = renderLink;

export function withoutLeadingTitle(source = '') {
  return source.replace(/^\s*#\s+[^\n]+\n+/u, '').trim();
}

/** @param {string} value */
function decodedPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** @param {string} href @param {string} sourcePath */
function relativeLocalTarget(href, sourcePath) {
  if (!href || href.startsWith('#') || href.startsWith('?') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith('//')) return null;
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(href);
  if (!match || !match[1]) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(decodedPath(sourcePath)), decodedPath(match[1])));
}

/** @param {string} href @param {string} rewritten @param {MarkdownEnvironment} [environment] */
function unavailableLocalHref(href, rewritten, { sourcePath = '', sourceRoutes = new Map(), portalRoutes = new Set() } = {}) {
  if (href.startsWith('/')) {
    const match = /^([^?#]*)(?:[?#].*)?$/u.exec(href);
    const pathname = match?.[1] ?? '';
    const route = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return portalRoutes.size > 0 && !portalRoutes.has(route) && !portalRoutes.has(pathname);
  }
  const target = relativeLocalTarget(href, sourcePath);
  return target !== null && rewritten === href && !sourceRoutes.has(target);
}

/** @param {string} href @param {MarkdownEnvironment} [environment] */
export function rewriteLocalResourceHref(href, { sourcePath = '', sourceRoutes = new Map(), headingPrefix = '', sourceHeadingPrefixes = new Map() } = {}) {
  if (href.startsWith('#')) return href === '#' ? href : `#${headingPrefix}${href.slice(1)}`;
  if (!href || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(href)) return href;

  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(href);
  if (!match || !match[1]) return href;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(decodedPath(sourcePath)), decodedPath(match[1])));
  const route = sourceRoutes.get(target);
  const fragment = match[3] ? `#${sourceHeadingPrefixes.get(target) ?? ''}${match[3].slice(1)}` : '';
  return route ? `${route}${match[2] ?? ''}${fragment}` : href;
}

/** @param {Token[]} tokens @returns {string} */
function headingText(tokens) {
  return tokens.map((token) => {
    if (token.children) return headingText(token.children);
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
    return token.content;
  }).join('');
}

/** @param {string} [source] @param {MarkdownEnvironment} [environment] */
export function renderMarkdown(source = '', environment = {}) {
  const tokens = markdown.parse(source, environment);
  const slugger = new GithubSlugger();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const inline = tokens[index + 1];
    const close = tokens[index + 2];
    if (token?.type !== 'heading_open' || !inline || !close) continue;
    token.attrSet('id', `${environment.headingPrefix ?? ''}${slugger.slug(headingText(inline.children ?? []))}`);
    if (index === 0 && token.tag === 'h1' && environment.omitLeadingTitle) {
      // Keep the source title's fragment target without repeating the reader title.
      token.tag = close.tag = 'span';
      inline.children = [];
      inline.content = '';
    }
  }
  return markdown.renderer.render(tokens, markdown.options, environment);
}
