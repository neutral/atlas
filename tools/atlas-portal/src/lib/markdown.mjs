import MarkdownIt from 'markdown-it';
import path from 'node:path';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  const href = tokens[index].attrGet('href') ?? '';
  const rewritten = rewriteLocalResourceHref(href, environment);
  if (unavailableLocalHref(href, rewritten, environment)) {
    const hrefIndex = tokens[index].attrIndex('href');
    if (hrefIndex >= 0) tokens[index].attrs.splice(hrefIndex, 1);
    tokens[index].attrSet('class', 'unavailable-local-link');
    tokens[index].attrSet('aria-disabled', 'true');
    tokens[index].attrSet('title', 'Not available in this portal');
  } else {
    tokens[index].attrSet('href', rewritten);
  }
  if (/^https?:/iu.test(href)) {
    tokens[index].attrSet('rel', 'noreferrer');
  }
  return defaultLinkOpen(tokens, index, options, environment, self);
};

export function withoutLeadingTitle(source = '') {
  return source.replace(/^\s*#\s+[^\n]+\n+/u, '').trim();
}

export function introductoryMarkdown(source = '', paragraphCount = 2) {
  const blocks = withoutLeadingTitle(source)
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith('#') && !block.startsWith('- '));
  return blocks.slice(0, paragraphCount).join('\n\n');
}

function decodedPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function relativeLocalTarget(href, sourcePath) {
  if (!href || href.startsWith('#') || href.startsWith('?') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith('//')) return null;
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(href);
  if (!match || !match[1]) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(decodedPath(sourcePath)), decodedPath(match[1])));
}

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

export function rewriteLocalResourceHref(href, { sourcePath = '', sourceRoutes = new Map() } = {}) {
  if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith('//')) return href;

  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/u.exec(href);
  if (!match || !match[1]) return href;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(decodedPath(sourcePath)), decodedPath(match[1])));
  const route = sourceRoutes.get(target);
  return route ? `${route}${match[2] ?? ''}${match[3] ?? ''}` : href;
}

export function renderMarkdown(source = '', environment = {}) {
  return markdown.render(source, environment);
}
