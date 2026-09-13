import type { SearchItem } from '../core/types';

function isSearchItem(value: unknown): value is SearchItem {
  if (typeof value !== 'object' || value === null) return false;
  return 'type' in value && typeof value.type === 'string' && ['map', 'area', 'point', 'resource'].includes(value.type)
    && 'title' in value && typeof value.title === 'string'
    && 'text' in value && typeof value.text === 'string'
    && 'route' in value && typeof value.route === 'string' && value.route.startsWith('/') && !value.route.startsWith('//') && !/[\s\\]/u.test(value.route)
    && (!('summary' in value) || typeof value.summary === 'string')
    && 'mapTitles' in value && Array.isArray(value.mapTitles) && value.mapTitles.every((title: unknown) => typeof title === 'string')
    && 'id' in value && typeof value.id === 'string'
    && 'mapIds' in value && Array.isArray(value.mapIds) && value.mapIds.every((id: unknown) => typeof id === 'string');
}

const dataElement = document.querySelector('#atlas-search-data');

if (dataElement) {
  const parsed: unknown = JSON.parse(dataElement.textContent ?? '[]');
  if (!Array.isArray(parsed) || !parsed.every(isSearchItem)) throw new Error('Invalid Atlas search data.');
  const items = parsed;
  const form = document.querySelector<HTMLFormElement>('.reader-search-form');
  const input = document.querySelector<HTMLInputElement>('[data-reader-search]');
  const results = document.querySelector<HTMLElement>('[data-search-results]');
  const status = document.querySelector<HTMLElement>('[data-search-status]');
  const more = document.querySelector<HTMLButtonElement>('[data-more-results]');
  const filters = [...document.querySelectorAll<HTMLInputElement>('[data-search-filter]')];
  if (!form || !input || !results || !status || !more) throw new Error('Incomplete Atlas search controls.');
  const typeLabels = { map: 'Map', area: 'Area', point: 'Point', resource: 'Resource' };
  const pageSize = 60;
  let visibleCount = pageSize;

  const escapeHtml = (value: unknown) => String(value).replace(/[&<>'"]/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);

  const render = () => {
    const term = input.value.trim();
    const query = term.toLocaleLowerCase();
    const selectedTypes = new Set(filters.filter((filter) => filter.checked).map((filter) => filter.value));
    const matches = query
      ? items
          .filter((item) => selectedTypes.has(item.type) && item.text.toLocaleLowerCase().includes(query))
          .map((item) => ({ ...item, score: item.title.toLocaleLowerCase() === query ? 0 : item.title.toLocaleLowerCase().includes(query) ? 1 : 2 }))
          .sort((left, right) => left.score - right.score || left.title.localeCompare(right.title))
      : [];
    const shown = matches.slice(0, visibleCount);
    status.textContent = !query ? 'Enter a term to search this Atlas.'
      : selectedTypes.size === 0 ? 'Select at least one type to search.'
      : matches.length === 0 ? `No results for “${term}”. Try a different term or include more types.`
      : matches.length > shown.length ? `Showing ${shown.length} of ${matches.length} results for “${term}”`
      : `${matches.length} result${matches.length === 1 ? '' : 's'} for “${term}”`;
    more.hidden = matches.length <= shown.length;
    results.innerHTML = shown.map((item) => `
      <article class="search-result">
        <div class="search-result-type">${escapeHtml(typeLabels[item.type] ?? item.type)}</div>
        <h2><a href="${escapeHtml(item.route)}">${escapeHtml(item.title)}</a></h2>
        <p>${escapeHtml(item.summary ?? '')}</p>
        <span>${escapeHtml(item.mapTitles.join(' · '))}</span>
      </article>
    `).join('');
  }

  const updateQuery = () => {
    visibleCount = pageSize;
    const next = new URL(window.location.href);
    const query = input.value.trim();
    if (query) next.searchParams.set('q', query);
    else next.searchParams.delete('q');
    window.history.replaceState({}, '', next);
    render();
  }

  input.value = new URLSearchParams(window.location.search).get('q') ?? '';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    updateQuery();
  });
  input.addEventListener('input', updateQuery);
  for (const filter of filters) filter.addEventListener('change', () => {
    visibleCount = pageSize;
    render();
  });
  more.addEventListener('click', () => {
    const previousCount = results.children.length;
    visibleCount += pageSize;
    render();
    results.children[previousCount]?.querySelector('a')?.focus();
  });
  render();
}
