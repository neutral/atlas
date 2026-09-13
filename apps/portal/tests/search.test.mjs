import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = stripTypeScriptTypes(fs.readFileSync(new URL('../src/browser/search.ts', import.meta.url), 'utf8'));

function searchPage(items, query = '') {
  const elements = new Map();
  let focusedResult = null;
  const element = (properties = {}) => ({
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    ...properties,
  });
  const input = element({ value: '' });
  const status = element({ textContent: '' });
  const more = element({ hidden: true });
  const form = element();
  const filters = ['map', 'area', 'point', 'resource'].map((value) => element({ value, checked: true }));
  const results = element({ children: [] });
  Object.defineProperty(results, 'innerHTML', {
    set(value) {
      this.html = value;
      this.children = [...value.matchAll(/<article class="search-result">/gu)].map((_, index) => ({
        querySelector: () => ({ focus: () => { focusedResult = index; } }),
      }));
    },
  });
  for (const [selector, value] of [
    ['#atlas-search-data', { textContent: JSON.stringify(items) }],
    ['.reader-search-form', form], ['[data-reader-search]', input],
    ['[data-search-results]', results], ['[data-search-status]', status],
    ['[data-more-results]', more],
  ]) elements.set(selector, value);
  let location = new URL(`https://atlas.example/search/?q=${encodeURIComponent(query)}`);
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => elements.get(selector), querySelectorAll: () => filters },
    window: { get location() { return location; }, history: { replaceState(_state, _title, url) { location = new URL(url); } } },
    URL, URLSearchParams,
  });
  return { input, status, results, more, filters, get location() { return location; }, get focusedResult() { return focusedResult; } };
}

const matchingItems = Array.from({ length: 65 }, (_, index) => ({
  id: `point:point-${index}`, mapIds: ['example'], type: 'point', title: `Point ${String(index).padStart(2, '0')}`, text: 'matching text', route: `/points/point-${index}/`, summary: 'A selected Point.', mapTitles: ['Example Map'],
}));

test('search reports all matches and makes the next group reachable', () => {
  const page = searchPage(matchingItems, 'matching');
  assert.match(page.status.textContent, /Showing 60 of 65 results/u);
  assert.equal(page.results.children.length, 60);
  assert.equal(page.more.hidden, false);
  page.more.listeners.click();
  assert.equal(page.results.children.length, 65);
  assert.match(page.status.textContent, /^65 results/u);
  assert.equal(page.more.hidden, true);
  assert.equal(page.focusedResult, 60);
});

test('search keeps typed terms in the URL and distinguishes unavailable results', () => {
  const page = searchPage(matchingItems, 'matching');
  page.input.value = 'no match';
  page.input.listeners.input();
  assert.equal(page.location.searchParams.get('q'), 'no match');
  assert.match(page.status.textContent, /No results.*Try a different term/u);
  page.filters.forEach((filter) => { filter.checked = false; });
  page.filters[0].listeners.change();
  assert.equal(page.status.textContent, 'Select at least one type to search.');
  page.input.value = '';
  page.input.listeners.input();
  assert.equal(page.location.searchParams.has('q'), false);
  assert.equal(page.status.textContent, 'Enter a term to search this Atlas.');
});

test('search renders authored text as text and applies type filters', () => {
  const point = { ...matchingItems[0], title: '<script>alert(1)</script>', summary: '"quoted" & <unsafe>' };
  const resource = { ...matchingItems[0], type: 'resource', title: 'Resource' };
  const page = searchPage([point, resource], 'matching');
  assert.equal(page.results.html.includes('<script>'), false);
  assert.match(page.results.html, /&lt;script&gt;/u);
  page.filters.find((filter) => filter.value === 'point').checked = false;
  page.filters[0].listeners.change();
  assert.equal(page.results.children.length, 1);
  assert.equal(page.results.html.includes('&lt;script&gt;'), false);
});

test('search rejects malformed data and nonlocal result routes before rendering', () => {
  assert.throws(() => searchPage([{ ...matchingItems[0], mapTitles: [42] }]), /Invalid Atlas search data/u);
  assert.throws(() => searchPage([{ ...matchingItems[0], route: '//outside.example/' }]), /Invalid Atlas search data/u);
  assert.throws(() => searchPage([{ ...matchingItems[0], route: '/\\outside.example/' }]), /Invalid Atlas search data/u);
});
