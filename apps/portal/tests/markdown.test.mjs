import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../src/lib/markdown.mjs';

test('Markdown headings retain source fragments through formatting and duplicate titles', () => {
  const source = '# Overview\n\n## **Point** `identity` & [Café](https://example.com/elsewhere)\n\n## Scope\n\n## Scope\n\n## Scope-1\n\n## 中文\n\n## ![Diagram](diagram.svg)\n';
  const html = renderMarkdown(source, { headingPrefix: 'content-', omitLeadingTitle: true });
  assert.match(html, /<span id="content-overview"><\/span>/u);
  assert.doesNotMatch(html, /<h1/u);
  for (const id of ['point-identity--café', 'scope', 'scope-1', 'scope-1-1', '中文', 'diagram']) {
    assert.ok(html.includes(`id="content-${id}"`), `Missing heading fragment ${id}`);
  }
  assert.equal(renderMarkdown(source, { headingPrefix: 'content-', omitLeadingTitle: true }), html);
  assert.match(renderMarkdown('# Scope\n\n## Scope', { omitLeadingTitle: true }), /<h2 id="scope-1">Scope<\/h2>/u);
});

test('Markdown links reach the right document and assembled Point record headings', () => {
  const sourceRoutes = new Map([
    ['docs/overview.md', '/resources/overview/'],
    ['maps/one/points/shared.md', '/points/shared/'],
    ['maps/two/points/shared.md', '/points/shared/'],
  ]);
  const sourceHeadingPrefixes = new Map([
    ['docs/overview.md', 'content-'],
    ['maps/one/points/shared.md', 'record-0-content-'],
    ['maps/two/points/shared.md', 'record-1-content-'],
  ]);
  const environment = { sourceRoutes, sourceHeadingPrefixes };
  const first = renderMarkdown('## Scope\n\n[Here](#scope)\n\n[Other context](../../two/points/shared.md#scope)', {
    ...environment, sourcePath: 'maps/one/points/shared.md', headingPrefix: 'record-0-content-',
  });
  const second = renderMarkdown('## Scope', {
    ...environment, sourcePath: 'maps/two/points/shared.md', headingPrefix: 'record-1-content-',
  });
  assert.match(first, /href="#record-0-content-scope"/u);
  assert.match(first, /href="\/points\/shared\/#record-1-content-scope"/u);
  const ids = [...`${first}${second}`.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(ids, ['record-0-content-scope', 'record-1-content-scope']);

  const links = renderMarkdown('[Overview](../../../docs/overview.md?view=all#scope)\n\n[External](https://example.com/doc#scope)\n\n[Missing](../../../docs/missing.md#scope)', {
    ...environment, sourcePath: 'maps/one/points/shared.md', headingPrefix: 'record-0-content-',
  });
  assert.match(links, /href="\/resources\/overview\/\?view=all#content-scope"/u);
  assert.match(links, /href="https:\/\/example.com\/doc#scope"/u);
  assert.match(links, /<a class="unavailable-local-link" aria-disabled="true" title="Not available in this portal">Missing<\/a>/u);
});
