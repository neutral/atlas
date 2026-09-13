import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../src/markdown.mjs';

test('authored HTML is displayed as text without executable elements or attributes', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n<iframe src="https://example.com"></iframe>\n\n<form action="/api/apply"><button>Apply</button></form>');
  assert.doesNotMatch(html, /<(?:script|img|iframe|form|button)\b/iu);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /&lt;img/u);
});

test('active, file, and protocol-relative Markdown destinations do not become navigable links', () => {
  for (const destination of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x73;cript:alert(1)', 'data:text/html,hello', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'blob:https://example.com/id', '//example.com/remote']) {
    const html = renderMarkdown(`[Open](${destination})`);
    assert.doesNotMatch(html, /\bhref\s*=/iu, destination);
    assert.doesNotMatch(html, /<(?:script|img|iframe)\b/iu, destination);
  }
});

test('images require an explicit source action and never create an automatic retrieval element', () => {
  const html = renderMarkdown('![Remote](https://example.com/track.png)\n\n![Local](docs/image.png)\n\n![Inline](data:image/png;base64,AAAA)\n\n![Protocol relative](//example.com/track.png)', 'maps/architecture/map.md');
  assert.doesNotMatch(html, /<(?:img|picture|source|iframe|object)\b/iu);
  assert.match(html, /Image: Remote \(open source\)/u);
  assert.match(html, /href="https:\/\/example\.com\/track\.png" rel="noreferrer"/u);
  assert.match(html, /kind=source/u);
  assert.doesNotMatch(html, /href="(?:data:|\/\/)/iu);
});

test('local source links preserve the authored target and owning record without filesystem access', () => {
  const html = renderMarkdown('[Guide](../../../docs/authentication.md#details)', 'maps/architecture/points/edge-authentication.md');
  const match = html.match(/href="([^"]+)"/u);
  assert.ok(match);
  const url = new URL(match[1].replaceAll('&amp;', '&'), 'http://127.0.0.1:1234');
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('kind'), 'source');
  assert.equal(url.searchParams.get('uri'), '../../../docs/authentication.md#details');
  assert.equal(url.searchParams.get('ownerPath'), 'maps/architecture/points/edge-authentication.md');
});

test('explicit web and mail links retain no-referrer navigation and heading ids are stable', () => {
  const input = '# Auth & scope\n\n# Auth & scope\n\n[Web](https://example.com/path?q=1&x=2) [Mail](mailto:atlas@example.com) [Section](#auth--scope)';
  const html = renderMarkdown(input);
  assert.match(html, /id="auth--scope"/u);
  assert.match(html, /id="auth--scope-1"/u);
  assert.match(html, /href="https:\/\/example\.com\/path\?q=1&amp;x=2" rel="noreferrer"/u);
  assert.match(html, /href="mailto:atlas@example\.com" rel="noreferrer"/u);
  assert.match(html, /href="#auth--scope" rel="noreferrer"/u);
  assert.equal(renderMarkdown(input), html);
});

test('a source without a captured Atlas owner cannot invent a base for relative links', () => {
  const html = renderMarkdown('[Sibling](sibling.md)\n\n![Local image](picture.png)\n\n[Web](https://example.com/guide)', null);
  assert.match(html, /<a aria-disabled="true">Sibling<\/a>/u);
  assert.doesNotMatch(html, /kind=source/u);
  assert.match(html, /href="https:\/\/example\.com\/guide"/u);
  assert.doesNotMatch(html, /<img\b/u);
});
