// The Atlas reader's script. Every page is complete without it: every name is a link to a page.
// With it, a name in a margin (drawn with ▸) opens what it names here instead, as a panel in the
// main column under the Point whose margin named it, with its own margin and its own Close; the
// Outline button lays the Trees and their outlines over the page, and the Help button what the help
// page says; and a search field ranks the Points and the Facets. Every other name stays a link and
// goes to its page.
const find = (selector, within = document) => within.querySelector(selector);
const all = (selector, within = document) => [...within.querySelectorAll(selector)];
const make = html => Object.assign(document.createElement('template'), { innerHTML: html }).content.firstElementChild;
const escape = text => text.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
const plain = event => !(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

/** Another page of this Atlas, parsed, with its links made absolute so its parts can stand on this page. */
async function fetched(address) {
  const response = await fetch(address.split('#')[0]);
  if (!response.ok) throw new Error(`${response.status} ${address}`);
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  for (const link of all('a[href]', page)) link.setAttribute('href', new URL(link.getAttribute('href'), response.url).href);
  return page;
}

// ── Panels ──────────────────────────────────────────────────────────────────────────────────
// A holder is the page or a panel: a row (a Point or a Facet beside its margin) and, under it, at
// most one panel, which the one open item of that margin names.

const doc = find('.doc');
const items = holder => all(':scope > .row > .margin a.opens', holder);
const opener = holder => items(holder).find(item => item.getAttribute('aria-expanded') === 'true');
const named = holder => holder === doc ? find('[data-point]', doc)?.dataset.point : holder.dataset.panel;

/** Write the chain of opened things, outermost first, as the address's fragment. */
function record() {
  const chain = [];
  for (let holder = doc, item; (item = opener(holder)); holder = find(':scope > .panel', holder)) chain.push(item.dataset.open);
  history.replaceState(null, '', chain.length ? `#${chain.join('/')}` : location.pathname + location.search);
}

/** Close what a holder's margin has open, and everything opened under it. */
function shut(holder) {
  find(':scope > .panel', holder)?.remove();
  for (const item of items(holder)) item.setAttribute('aria-expanded', 'false');
}

/** A fetched page as a panel: its Tree and kind, its title as a link to it, its prose, its foot, and its own margin. */
function panelOf(page, item, holder) {
  const take = selector => find(selector, page);
  const kind = [take('[data-account]')?.textContent, take('[data-standing]')?.textContent].filter(Boolean).join(' · ');
  const panel = make(`<section class="panel"><div class="row"><article class="point"><p class="kind"><span class="cap">${escape(kind)}</span><button class="close" type="button">Close</button></p><h2><a href="${item.href}">${take('h1').innerHTML}</a></h2><div class="body">${take('[data-prose]').innerHTML}</div></article><div class="margin"></div></div></section>`);
  const foot = take('[data-foot]'), develops = take('[data-develops]'), margin = find('.margin', panel);
  if (foot) find('.point', panel).append(foot);
  if (develops) {
    const section = make('<section class="map"><h2 class="cap">Develops into</h2></section>');
    section.append(develops);
    margin.append(section);
  }
  // A Facet opened from the Point it is said of does not say so again.
  margin.append(...all('[data-part]', page).filter(part => !part.dataset.said || part.dataset.said !== named(holder)));
  for (const label of all('h2.cap', panel)) {
    const lower = document.createElement('h3');
    lower.className = 'cap';
    lower.append(...label.childNodes);
    label.replaceWith(lower);
  }
  for (const inner of all('a.opens', panel)) inner.setAttribute('aria-expanded', 'false');
  if (!margin.children.length) margin.remove();
  panel.dataset.panel = item.dataset.open;
  return panel;
}

/** Open what a margin item names under the Point its margin belongs to; an item that is open closes. */
async function open(item, jump = true) {
  const holder = item.closest('.panel') ?? doc;
  const wasOpen = item.getAttribute('aria-expanded') === 'true';
  shut(holder);
  if (wasOpen) { record(); return null; }
  let page;
  try { page = await fetched(item.href); } catch { location.assign(item.href); return null; }
  if (!holder.isConnected) return null;
  shut(holder);
  const panel = holder.appendChild(panelOf(page, item, holder));
  item.setAttribute('aria-expanded', 'true');
  record();
  if (jump) panel.scrollIntoView({ block: 'start' });
  return panel;
}

/** Close a panel, and give the focus back to the item that opened it. */
function close(panel) {
  const holder = panel.parentElement, item = opener(holder);
  shut(holder);
  record();
  item?.focus({ preventScroll: true });
  item?.scrollIntoView({ block: 'nearest' });
}

if (doc) {
  for (const item of items(doc)) item.setAttribute('aria-expanded', 'false');
  doc.addEventListener('click', event => {
    if (!plain(event)) return;
    const button = event.target.closest('.close'), item = event.target.closest('a.opens');
    if (button) close(button.closest('.panel'));
    else if (item) { event.preventDefault(); open(item); }
  });
  addEventListener('keydown', event => {
    const innermost = all('.panel', doc).at(-1);
    if (event.key === 'Escape' && innermost && !find('dialog[open]')) close(innermost);
  });
}

// ── Outline and Help: a part of another page, laid over this one ────────────────────────────
// Each is a link in the strip, to home or to the help page, until the script puts a button in its place. The button
// fetches that page and lays the part `take` finds in it over this page, in a native dialog that closes on Escape, on
// Close or on a click outside, and gives the focus back to the button.

function layer(link, kind, take, place = () => null) {
  if (!link) return;
  const name = link.getAttribute('aria-label') ?? link.textContent;
  const button = make(`<button class="${link.className}" type="button" aria-haspopup="dialog">${link.innerHTML}</button>`);
  if (link.hasAttribute('aria-label')) button.setAttribute('aria-label', name);
  link.replaceWith(button);
  button.addEventListener('click', async () => {
    let page;
    try { page = await fetched(link.href); } catch { location.assign(link.href); return; }
    const dialog = make(`<dialog class="layer ${kind}" aria-labelledby="layer-title"><header><span class="title">${find('.strip .title').innerHTML}</span><h2 class="cap" id="layer-title">${escape(name)}</h2><button class="close" type="button">Close</button></header><div class="home ${kind}"></div></dialog>`);
    find('.home', dialog).append(take(page));
    const near = place(dialog);
    dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('.close')) dialog.close(); });
    // The browser gives the focus back to the button as the dialog closes; the close event comes later, so it gives the
    // focus back only if nothing has taken it since, and never takes it from where the reader has already gone.
    dialog.addEventListener('close', () => {
      const active = document.activeElement;
      dialog.remove();
      if (!active || active === document.body || dialog.contains(active)) button.focus();
    });
    document.body.append(dialog);
    dialog.showModal();
    near?.scrollIntoView({ block: 'center' });
  });
}

// Outline: the Trees and their outlines, taken from home, with the reader's place marked: this page's Point, marked;
// on a Facet's page, the Point it is said of, unmarked.
layer(find('[data-outline]'), 'whole', page => find('[data-accounts]', page), dialog => {
  const place = id => id && all('a[data-id]', dialog).find(point => point.dataset.id === id);
  const here = place(find('[data-point]')?.dataset.point), near = here ?? place(find('[data-said]')?.dataset.said);
  here?.setAttribute('aria-current', 'page');
  if (near) find('details', near.closest('[data-accounts] > li'))?.setAttribute('open', '');
  return near;
});
// Help: the words, the moves and the marks, taken from the help page.
layer(find('.strip .help'), 'help', page => find('[data-help]', page));

// ── Search: the Library's own ranking over the Points and Facets, loaded when the field is first used ──
// Each result shows its Tree and its kind, as its panel does: a Point's Type and standing, or Point, or the Tree a Facet
// is seen from; then its title; then the Library's excerpt of its text around the first match, with the marks of
// Markdown that would read as noise taken out, and … where it was cut. When more match than are shown, the list ends by
// saying so.

const plainly = text => text.replace(/\]\([^)]*\)?/g, '').replace(/!?\[|\]|\*+|`|(?<!\w)_+|_+(?!\w)/g, '').replace(/^#+\s*/gm, '').replace(/\||(?<!\S)[-:]{3,}(?!\S)/g, ' ').replace(/\s+/g, ' ').trim();
const excerpt = ({ text, start, end, totalLength }) => `${start ? '… ' : ''}${plainly(text)}${end < totalLength ? ' …' : ''}`;
// A Point's kind in the words its page gives it: "Decision · selected", "Observation · 3 November 2026", "Point".
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dated = iso => { const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return day ? `${Number(day[3])} ${MONTHS[day[2] - 1]} ${day[1]}` : iso; };
const kind = found => found.type === 'decision' ? `Decision · ${found.status}` : found.type === 'observation' ? `Observation · ${dated(found.observedAt)}` : 'Point';
const label = (found, accounts) => `${accounts[found.tree]} · ${found.kind === 'facet' ? `Facet, seen from ${accounts[found.via] ?? 'a Tree not in this publication'}` : kind(found)}`;
const address = found => new URL(found.kind === 'facet' ? `facet/${found.tree}/${found.id}/` : `../${found.id}/`, import.meta.url);

const strip = find('[data-strip]');
if (strip) {
  const ask = make('<div class="ask" role="search"><input type="search" placeholder="Search" aria-label="Search the Points and Facets" autocomplete="off" spellcheck="false"><div class="results" hidden></div></div>');
  const field = find('input', ask), results = find('.results', ask);
  const tools = find('.tools', strip) ?? strip;
  tools.insertBefore(ask, find('.help', tools));
  let index;
  const load = () => index ??= Promise.all([import('./search.js'), fetch(new URL('search.json', import.meta.url)).then(response => response.json())]);
  field.addEventListener('focus', () => { load(); results.hidden = !field.value.trim(); });
  field.addEventListener('input', async () => {
    const query = field.value;
    const [{ searchPage }, { accounts, records }] = await load();
    if (query !== field.value) return;
    const { results: found, available } = searchPage(records, { query, limit: 12, presentation: 'summary' });
    results.hidden = !query.trim();
    results.innerHTML = found.length
      ? `<ol>${found.map(item => `<li><a href="${address(item)}"><span class="cap">${escape(label(item, accounts))}</span><span class="claim">${escape(item.title)}</span><span class="excerpt">${escape(excerpt(item.snippet))}</span></a></li>`).join('')}</ol>${
        available > found.length ? `<p class="says">${found.length} of ${available} shown</p>` : ''}`
      : '<p class="says">No Point or Facet holds those words.</p>';
  });
  ask.addEventListener('keydown', event => {
    const found = all('a', results), at = found.indexOf(document.activeElement);
    if (event.key === 'Escape') { field.value = ''; results.hidden = true; field.blur(); event.stopPropagation(); }
    else if (event.key === 'Enter' && event.target === field) found[0]?.click();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); (found[at + (event.key === 'ArrowDown' ? 1 : -1)] ?? field).focus(); }
  });
  document.addEventListener('click', event => { if (!ask.contains(event.target)) results.hidden = true; });
  addEventListener('keydown', event => {
    if (event.key === '/' && plain(event) && !event.target.closest?.('input, textarea, [contenteditable]')) { event.preventDefault(); field.focus(); }
  });
}

// ── A page loaded with a fragment opens the chain the fragment names ────────────────────────
// A page whose margin opens nothing, such as a source's, keeps its fragment: there it names a section.

if (doc && items(doc).length) {
  let holder = doc;
  for (const token of decodeURIComponent(location.hash.slice(1)).split('/').filter(Boolean)) {
    const item = items(holder).find(candidate => candidate.dataset.open === token);
    holder = item && await open(item, false);
    if (!holder) break;
  }
  all('.panel', doc).at(-1)?.scrollIntoView({ block: 'start' });
  record();
}
