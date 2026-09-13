import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const escape = markdown.utils.escapeHtml;
const route = (kind, values) => `/?${new URLSearchParams({ kind, ...values })}`;

function href(value, environment) {
  if (/^(?:https?:|mailto:)/iu.test(value)) return value;
  if (value.startsWith('#')) return value;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('//')) return null;
  if (environment.ownerPath === null) return null;
  return route('source', { uri: value, ownerPath: environment.ownerPath ?? 'atlas.md' });
}

markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  const token = tokens[index];
  const target = href(token.attrGet('href') ?? '', environment);
  if (target === null) { token.attrs = [['aria-disabled', 'true']]; }
  else { token.attrSet('href', target); token.attrSet('rel', 'noreferrer'); }
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.image = (tokens, index, _options, environment) => {
  const token = tokens[index], source = token.attrGet('src') ?? '';
  const target = href(source, environment);
  return target === null ? `[Image: ${escape(token.content)}]`
    : `<a href="${escape(target)}" rel="noreferrer">Image: ${escape(token.content || source)} (open source)</a>`;
};

export function renderMarkdown(text, ownerPath = 'atlas.md', title = null) {
  const environment = { ownerPath };
  const tokens = markdown.parse(text ?? '', environment);
  const slugger = new GithubSlugger();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== 'heading_open') continue;
    tokens[index].attrSet('id', slugger.slug(tokens[index + 1]?.content ?? ''));
    const close = tokens[index + 2];
    if (index === 0 && tokens[index].tag === 'h1' && tokens[index + 1]?.content === title) {
      tokens[index].tag = close.tag = 'span';
      tokens[index + 1].children = []; tokens[index + 1].content = '';
    } else {
      const tag = `h${Math.min(6, Number(tokens[index].tag.slice(1)) + 1)}`;
      tokens[index].tag = close.tag = tag;
    }
  }
  return markdown.renderer.render(tokens, markdown.options, environment);
}
