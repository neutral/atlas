import MarkdownIt from 'markdown-it';
import { resolveReference, referenceHref, referenceIndex, markdownHeadingIds } from '../../../library/src/references.mjs';

/** Authored Markdown has no HTML, script, image-fetch, or arbitrary local-link authority. */
export function renderMarkdown(text, { resolveLink = () => null, referenceStatus = () => null, headingPrefix = '', title } = {}) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const headings = markdownHeadingIds(text, { title });
  let headingIndex = 0;
  const titleId = title === undefined ? null : `${headingPrefix}${headings[headingIndex++]}`;
  md.renderer.rules.image = (tokens, index) => `<span class="image-reference">[Image: ${md.utils.escapeHtml(tokens[index].content || 'reference')}]</span>`;
  md.renderer.rules.link_open = (tokens, index) => {
    const token = tokens[index];
    const href = token.attrGet('href') ?? '';
    const internal = resolveLink(href) ?? (href.startsWith('#') ? `#${headingPrefix}${href.slice(1)}` : null);
    let target = internal;
    if (!target && /^https?:\/\//i.test(href)) {
      try { const url = new URL(href); if (!url.username && !url.password) target = url.href; } catch { /* Render an inert reference. */ }
    }
    if (!target) {
      const status = referenceStatus(href);
      const message = status === 'missing' ? 'Reference target is missing or undeclared' : status === 'unsupported' ? 'Reference path is unsupported' : 'Reference not included';
      return `<span class="unavailable-reference" title="${message}">`;
    }
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
    if (tokens[index].type === 'heading_open') tokens[index].attrSet('id', `${headingPrefix}${headings[headingIndex++]}`);
  }
  return (titleId === null ? '' : `<span id="${md.utils.escapeHtml(titleId)}"></span>`) + md.renderer.render(tokens, md.options, {});
}

export function presentAtlas(view, { editable = false, pointPaths = view.atlas?.points ?? [], facetPaths = view.atlas?.facets ?? [] } = {}) {
  if (!view.atlas) return { format: 'atlas.portal/1', status: view.status, identity: view.identity, diagnostics: view.diagnostics, atlas: null, editable };
  const visible = [...view.atlas.points.filter(record => record.publicationAvailable !== false).map(record => ({ ...record, kind: 'point' })), ...view.atlas.facets.map(record => ({ ...record, kind: 'facet' }))];
  const paths = new Map([...pointPaths.map(record => [`point/${record.tree}/${record.id}`, record.path]), ...facetPaths.map(record => [`facet/${record.tree}/${record.id}`, record.path])]);
  const withPath = (record, kind) => ({ ...record, path: record.path ?? paths.get(`${kind}/${record.tree}/${record.id}`) });
  const indexed = referenceIndex({ ...view, files: [], atlas: { ...view.atlas, ...(view.atlas.style ? { style: { ...view.atlas.style, html: renderMarkdown(view.atlas.style.body) } } : {}), points: view.atlas.points.map(record => withPath(record, 'point')), facets: view.atlas.facets.map(record => withPath(record, 'facet')) } });
  const citers = (record, kind) => {
    const seen = new Set();
    return indexed.references.flatMap(reference => {
      const target = reference.target, from = reference.from;
      if (reference.status !== 'resolved' || target?.kind !== kind || target.id !== record.id || target.tree !== record.tree) return [];
      const key = `${from.kind}/${from.tree}/${from.id}`;
      if (seen.has(key)) return [];
      const visibleRecord = visible.find(item => item.kind === from.kind && item.tree === from.tree && item.id === from.id);
      if (!visibleRecord) return [];
      seen.add(key);
      return [{ kind: from.kind, id: from.id, tree: from.tree, title: visibleRecord.title }];
    });
  };
  const render = (record, kind) => ({ ...record, ...(typeof record.body === 'string' ? { citers: citers(record, kind) } : {}), html: typeof record.body === 'string' ? renderMarkdown(record.body, {
    title: record.title, headingPrefix: `${kind}-${record.id}-`,
    referenceStatus: href => resolveReference(view, { ...record, kind }, href, { pointPaths, facetPaths }).status,
    resolveLink: href => {
      if (href.startsWith('#')) return null;
      const resolved = resolveReference(view, { ...record, kind }, href, { pointPaths, facetPaths });
      // HTTP links keep the renderer's explicit external-link behavior.
      return resolved.status === 'external' ? null : referenceHref(resolved, record);
    },
  }) : '' });
  return {
    format: 'atlas.portal/1', status: view.status, identity: view.identity, diagnostics: view.diagnostics, editable,
    atlas: { ...view.atlas, ...(view.atlas.style ? { style: { ...view.atlas.style, html: renderMarkdown(view.atlas.style.body) } } : {}), points: view.atlas.points.map(record => render(record, 'point')), facets: view.atlas.facets.map(record => render(record, 'facet')), ...(view.atlas.checks ? { checks: view.atlas.checks.map(record => render(record, 'check')) } : {}) },
  };
}
