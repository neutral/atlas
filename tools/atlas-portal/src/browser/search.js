const dataElement = document.querySelector('#atlas-search-data');

if (dataElement) {
  const items = JSON.parse(dataElement.textContent ?? '[]');
  const form = document.querySelector('.reader-search-form');
  const input = document.querySelector('[data-reader-search]');
  const results = document.querySelector('[data-search-results]');
  const status = document.querySelector('[data-search-status]');
  const filters = [...document.querySelectorAll('[data-search-filter]')];
  const typeLabels = { map: 'Map', area: 'Area', point: 'Point', resource: 'Resource' };

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);

  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const selectedTypes = new Set(filters.filter((filter) => filter.checked).map((filter) => filter.value));
    const matches = query
      ? items
          .filter((item) => selectedTypes.has(item.type) && item.text.toLocaleLowerCase().includes(query))
          .map((item) => ({ ...item, score: item.title.toLocaleLowerCase() === query ? 0 : item.title.toLocaleLowerCase().includes(query) ? 1 : 2 }))
          .sort((left, right) => left.score - right.score || left.title.localeCompare(right.title))
          .slice(0, 60)
      : [];

    status.textContent = query ? `${matches.length} result${matches.length === 1 ? '' : 's'} for “${input.value.trim()}”` : 'Enter a term to search this Atlas.';
    results.innerHTML = matches.map((item) => `
      <article class="search-result">
        <div class="search-result-type">${escapeHtml(typeLabels[item.type] ?? item.type)}</div>
        <h2><a href="${escapeHtml(item.route)}">${escapeHtml(item.title)}</a></h2>
        <p>${escapeHtml(item.summary)}</p>
        <span>Matched ${escapeHtml(typeLabels[item.type] ?? item.type)} text${item.mapTitles.length ? ` · ${escapeHtml(item.mapTitles.join(', '))}` : ''}</span>
      </article>
    `).join('');
  }

  const parameters = new URLSearchParams(window.location.search);
  input.value = parameters.get('q') ?? '';
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = new URL(window.location.href);
    next.searchParams.set('q', input.value.trim());
    window.history.replaceState({}, '', next);
    render();
  });
  input?.addEventListener('input', render);
  for (const filter of filters) filter.addEventListener('change', render);
  render();
}
