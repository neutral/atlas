import MarkdownIt from 'markdown-it';
import path from 'node:path';

/** Authored Markdown has no HTML, script, image-fetch, or arbitrary local-link authority. */
const headingSlug = text => text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
const headingText = tokens => tokens.map(token => token.children ? headingText(token.children) : token.content).join('');
export function renderMarkdown(text, { resolveLink = () => null, headingPrefix = '', title } = {}) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const used = new Set();
  const uniqueHeading = text => {
    const stem = headingSlug(text); let slug = stem, suffix = 0;
    while (used.has(slug)) slug = `${stem}-${++suffix}`;
    used.add(slug); return `${headingPrefix}${slug}`;
  };
  const titleId = title === undefined ? null : uniqueHeading(title);
  md.renderer.rules.image = (tokens, index) => `<span class="image-reference">[Image: ${md.utils.escapeHtml(tokens[index].content || 'reference')}]</span>`;
  md.renderer.rules.link_open = (tokens, index) => {
    const token = tokens[index];
    const href = token.attrGet('href') ?? '';
    const internal = resolveLink(href) ?? (href.startsWith('#') ? `#${headingPrefix}${href.slice(1)}` : null);
    let target = internal;
    if (!target && /^https?:\/\//i.test(href)) {
      try { const url = new URL(href); if (!url.username && !url.password) target = url.href; } catch { /* Render an inert reference. */ }
    }
    if (!target) return '<span class="unavailable-reference" title="Reference not included">';
    token.meta = { external: !internal };
    return `<a href="${md.utils.escapeHtml(target)}"${internal ? '' : ' target="_blank" rel="noopener noreferrer"'}>`;
  };
  md.renderer.rules.link_close = (tokens, index) => {
    let nesting = 1;
    for (let i = index - 1; i >= 0; i--) {
      if (tokens[i].type === 'link_close') nesting++;
      if (tokens[i].type === 'link_open' && --nesting === 0) return tokens[i].meta ? '</a>' : '</span>';
    }
    return '</span>';
  };
  const tokens = md.parse(text, {});
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type === 'heading_open') tokens[index].attrSet('id', uniqueHeading(headingText(tokens[index + 1]?.children ?? [])));
  }
  return (titleId === null ? '' : `<span id="${md.utils.escapeHtml(titleId)}"></span>`) + md.renderer.render(tokens, md.options, {});
}

export function presentAtlas(view, { editable = false, pointPaths = view.atlas?.points ?? [], facetPaths = view.atlas?.facets ?? [] } = {}) {
  if (!view.atlas) return { format: 'atlas.portal/1', status: view.status, identity: view.identity, diagnostics: view.diagnostics, atlas: null, editable };
  const links = new Map(pointPaths.filter(point => point.path).map(point => [point.path, { href: `?tree=${encodeURIComponent(point.tree)}&point=${encodeURIComponent(point.id)}`, prefix: `point-${point.id}-` }]));
  const render = (record, kind) => ({ ...record, html: typeof record.body === 'string' ? renderMarkdown(record.body, { title: record.title, headingPrefix: `${kind}-${record.id}-`, resolveLink: href => {
    const [target, fragment] = href.split('#');
    if (!target) return null;
    const sourcePath = record.path ?? (kind === 'point' ? pointPaths : facetPaths).find(item => item.id === record.id && item.tree === record.tree)?.path;
    const resolved = links.get(target) ?? (sourcePath && links.get(path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target))));
    return resolved ? `${resolved.href}${fragment === undefined ? '' : `#${resolved.prefix}${fragment}`}` : null;
  } }) : '' });
  return {
    format: 'atlas.portal/1', status: view.status, identity: view.identity, diagnostics: view.diagnostics, editable,
    atlas: { ...view.atlas, points: view.atlas.points.map(record => render(record, 'point')), facets: view.atlas.facets.map(record => render(record, 'facet')), ...(view.atlas.checks ? { checks: view.atlas.checks.map(record => render(record, 'check')) } : {}) },
  };
}
