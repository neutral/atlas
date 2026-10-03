import { searchRecords } from './search.js';

const $ = selector => document.querySelector(selector);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(child => child !== undefined && child !== null));
  return node;
};
const button = (label, action, attrs = {}) => el('button', { type: 'button', onclick: () => run(action), ...attrs }, label);
let state = { data: null, tree: null, selected: null, history: [], scale: 1, x: 30, y: 30, width: 0, height: 0, nodes: [], editor: null };
let noticeTimer;
const publication = document.body.dataset.mode === 'publication';
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('token')) {
  sessionStorage.setItem('atlas-token', fragment.get('token'));
  history.replaceState({}, '', location.pathname + location.search);
}
const token = sessionStorage.getItem('atlas-token');
function notice(message) {
  $('#notice').textContent = message; $('#notice').classList.add('visible');
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('#notice').classList.remove('visible'), 6500);
}
async function run(action) { try { await action(); } catch (error) { notice(error.message); } }
async function api(path, data, method) {
  const response = await fetch(`./api/${path}`, { method: method ?? (data ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? 'Request failed.');
  return value;
}
const atlas = () => state.data?.atlas;
const pointById = id => atlas()?.points.find(point => point.id === id);
const treeById = id => atlas()?.trees.find(tree => tree.id === id);
const branchById = (tree, id) => atlas()?.branches.find(branch => branch.tree === tree && branch.id === id);
const prose = html => { const node = el('div', { class: 'prose' }); node.innerHTML = html ?? ''; return node; };
const readableExcerpt = text => (text ?? '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[^\n]*\/[^\n]*\)\s*/, '').replace(/\]\([^)]*$/g, '').replace(/[\[\]`*_]/g, '').replace(/^#{1,6}\s+/gm, '');
const section = (title, ...children) => el('section', { class: 'section' }, el('h3', {}, title), ...children);
const facetHost = (facet, kind, id, tree) => facet.tree === tree && facet.on[kind] === id;

async function refresh(initial = false) {
  if (state.preview) return;
  state.data = publication ? await (await fetch('./data.json')).json() : await api('view');
  $('#atlas-title').textContent = atlas()?.title ?? (state.data.canInitialize ? 'New Atlas' : 'Atlas needs repair');
  $('#workspace').hidden = !state.data.editable;
  $('#refresh').hidden = publication;
  $('#connect-agent').hidden = !state.data.editable;
  $('#export-site').hidden = !state.data.canExport;
  $('#create-atlas').hidden = !state.data.canInitialize;
  $('#create-tree').hidden = !state.data.editable || !atlas() || atlas().trees.length > 0;
  $('#checks').hidden = !state.data.editable;
  $('#review-sources').hidden = publication || !atlas();
  $('#search-atlas').disabled = !atlas();
  $('#atlas-style').hidden = !atlas()?.style && !(atlas() && state.data.editable);
  $('#exit-preview').hidden = !state.preview;
  $('#reading-start').hidden = !atlas();
  $('#state-notice').hidden = !state.data.stateIssue;
  $('#state-notice').textContent = state.data.stateIssue?.message ?? '';
  $('#mode-label').textContent = state.data.editable ? 'Editor' : publication ? 'Publication' : 'Navigator';
  if (!atlas()) {
    state.selected = null; state.history = []; $('#page').hidden = true; $('#page-content').replaceChildren();
    $('#point-count').textContent = ''; $('#empty').hidden = true;
    $('#tree-title').textContent = state.data.canInitialize ? 'Create an Atlas here' : 'This Atlas needs repair';
    $('#tree-scope').textContent = state.data.canInitialize ? 'Organize this project’s knowledge. Review the draft before creating the Atlas.' : state.data.diagnostics.map(item => `${item.path}: ${item.message}`).join(' ');
    $('#tree-select').replaceChildren(); $('#nodes').replaceChildren(); $('#connections').replaceChildren();
    return;
  }
  $('#tree-select').replaceChildren(...atlas().trees.map(tree => el('option', { value: tree.id }, tree.title)));
  const params = new URLSearchParams(location.search);
  if (initial) { state.tree = params.get('tree'); state.selected = null; $('#page').hidden = true; }
  if (!treeById(state.tree)) state.tree = atlas().trees[0]?.id;
  if (initial && pointById(params.get('point'))) {
    const point = pointById(params.get('point')); state.selected = { kind: 'point', id: point.id, tree: point.tree }; state.tree = point.tree;
  }
  if (initial && branchById(state.tree, params.get('branch'))) state.selected = { kind: 'branch', id: params.get('branch'), tree: state.tree };
  if (state.selected) renderPage();
  renderTree();
  if (initial && params.has('facet')) { const facet = atlas().facets.find(facet => facet.tree === state.tree && facet.id === params.get('facet')); if (facet) select('facet', facet.id, facet.tree, false); }
  if (initial && params.has('source')) {
    const owner = params.has('facet') ? atlas().facets.find(facet => facet.tree === state.tree && facet.id === params.get('facet')) : pointById(params.get('point'));
    const source = owner?.sources?.[Number(params.get('sourceIndex'))];
    if (source?.uri === params.get('source')) await showSource(source, owner ? { kind: params.has('facet') ? 'facet' : 'point', id: owner.id, tree: owner.tree } : undefined, Number(params.get('sourceIndex')), location.hash.slice(1) || undefined);
  }
  if (initial && location.hash) requestAnimationFrame(() => {
    try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: 'start' }); } catch { /* Malformed authored fragments remain inert. */ }
  });
}

function renderTree() {
  const tree = treeById(state.tree);
  $('#tree-select').value = tree?.id ?? '';
  $('#tree-title').textContent = tree?.title ?? 'No Trees yet';
  $('#tree-scope').textContent = tree?.scope ?? 'Create a Tree for a subject you want to explain.';
  $('#reading-start').hidden = !tree;
  const base = pointById(tree?.base);
  $('#read-overview').hidden = !base || base.publicationAvailable === false;
  $('#nodes').replaceChildren(); $('#connections').replaceChildren();
  if (!tree) { $('#point-count').textContent = ''; return; }
  const all = [];
  function walk(item, parent, depth) {
    const kind = item.point ? 'point' : 'branch';
    const id = item.point ?? item.branch;
    const record = kind === 'point' ? pointById(id) : branchById(tree.id, id);
    const node = { id, kind, record, parent, depth, key: `${kind}:${id}`, children: [], title: record?.title ?? 'Not published', base: id === tree.base && kind === 'point' };
    all.push(node);
    node.children = (item.children ?? []).map(child => walk(child, node, depth + 1));
    return node;
  }
  const root = walk({ point: tree.base, children: tree.children }, null, 0);
  const query = $('#filter-text').value.trim().toLocaleLowerCase();
  const type = $('#filter-type').value;
  const filtering = Boolean(query || type);
  const matches = new Set(all.filter(node => node.kind === 'point' && node.record?.publicationAvailable !== false &&
    (!query || `${node.title} ${node.record?.body ?? ''}`.toLocaleLowerCase().includes(query)) &&
    (!type || (node.record?.type ?? 'untyped') === type)).map(node => node.key));
  const included = new Set();
  if (!filtering) all.forEach(node => included.add(node.key));
  else all.filter(node => matches.has(node.key)).forEach(node => { while (node) { included.add(node.key); node = node.parent; } });
  let cursor = 0;
  const vertical = $('#canvas').getBoundingClientRect().width < 650;
  function place(node) {
    if (!included.has(node.key)) return;
    const children = node.children.filter(child => included.has(child.key));
    children.forEach(place);
    const axis = children.length ? (children[0].axis + children.at(-1).axis) / 2 : cursor++;
    node.axis = axis;
    node.x = vertical ? 30 + axis * 260 : 30 + node.depth * 280;
    node.y = vertical ? 30 + node.depth * 135 : 30 + axis * 128;
  }
  place(root);
  state.nodes = all.filter(node => included.has(node.key));
  state.width = Math.max(300, ...state.nodes.map(node => node.x + 250));
  state.height = Math.max(160, ...state.nodes.map(node => node.y + 110));
  $('#stage').style.width = `${state.width}px`; $('#stage').style.height = `${state.height}px`;
  $('#connections').setAttribute('width', state.width); $('#connections').setAttribute('height', state.height);
  for (const node of state.nodes) {
    const facets = atlas().facets.filter(facet => facetHost(facet, node.kind, node.id, tree.id));
    const active = state.selected?.id === node.id && state.selected?.kind === node.kind && state.selected?.tree === tree.id;
    const classes = ['node', node.kind, node.base && 'base', active && 'selected', filtering && !matches.has(node.key) && 'context'].filter(Boolean).join(' ');
    const element = button('', () => select(node.kind, node.id, tree.id), { class: classes, 'aria-label': `${node.base ? 'Base Point' : node.kind === 'point' ? 'Point' : 'Branch'}: ${node.title}`, 'aria-pressed': active });
    element.style.left = `${node.x}px`; element.style.top = `${node.y}px`;
    element.append(el('span', { class: 'node-kind' }, node.base ? 'Base Point' : node.kind === 'branch' ? 'Branch' : node.record?.type ?? 'Point'), el('span', { class: 'node-label' }, node.title));
    if (facets.length) element.append(el('span', { class: 'node-facets', title: `${facets.length} ${facets.length === 1 ? 'Facet' : 'Facets'}` }, `↗ ${facets.length}`));
    element.addEventListener('focus', () => { if (element.matches(':focus-visible')) ensureVisible(node); });
    $('#nodes').append(element);
    if (node.parent && included.has(node.parent.key)) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const x = node.parent.x + (node.parent.kind === 'branch' ? 210 : 225), y = node.parent.y + 43;
      line.setAttribute('d', vertical
        ? `M ${node.parent.x + 110} ${node.parent.y + (node.parent.kind === 'branch' ? 66 : 86)} C ${node.parent.x + 110} ${node.y - 24}, ${node.x + 110} ${node.y - 24}, ${node.x + 110} ${node.y}`
        : `M ${x} ${y} C ${x + 35} ${y}, ${node.x - 35} ${node.y + 43}, ${node.x} ${node.y + 43}`);
      $('#connections').append(line);
    }
  }
  const total = all.filter(node => node.kind === 'point' && node.record?.publicationAvailable !== false).length;
  $('#point-count').textContent = filtering ? `${matches.size} of ${total} Points` : `${total} ${total === 1 ? 'Point' : 'Points'}`;
  $('#empty').hidden = state.nodes.length !== 0;
  const sameTree = state.canvasTree === state.tree; state.canvasTree = state.tree;
  requestAnimationFrame(() => { if (sameTree || state.restoring) transform(); else frameTree(); });
}

function transform() {
  $('#stage').style.transform = `translate(${state.x}px,${state.y}px) scale(${state.scale})`;
  $('#zoom-level').textContent = `${Math.round(state.scale * 100)}%`;
}
function fit() {
  const { width, height } = $('#canvas').getBoundingClientRect();
  state.scale = Math.max(.08, Math.min(1, (width - 50) / state.width, (height - 45) / state.height));
  state.x = (width - state.width * state.scale) / 2; state.y = (height - state.height * state.scale) / 2;
  transform();
}
function frameTree() {
  fit();
  if (state.scale >= .85 || !state.nodes.length) return;
  const focus = state.nodes.find(node => state.selected?.tree === state.tree && state.selected.kind === node.kind && state.selected.id === node.id) ?? state.nodes[0];
  const { width, height } = $('#canvas').getBoundingClientRect();
  state.scale = .85;
  state.x = width < 650 || !focus.base ? width / 2 - (focus.x + 112) * state.scale : 30 - focus.x * state.scale;
  state.y = height / 2 - (focus.y + 43) * state.scale;
  transform();
}
function zoom(factor) {
  const rect = $('#canvas').getBoundingClientRect();
  const next = Math.max(.08, Math.min(2.5, state.scale * factor));
  state.x = rect.width / 2 - (rect.width / 2 - state.x) * next / state.scale;
  state.y = rect.height / 2 - (rect.height / 2 - state.y) * next / state.scale;
  state.scale = next; transform();
}
function ensureVisible(node) {
  const rect = $('#canvas').getBoundingClientRect();
  const left = state.x + node.x * state.scale, top = state.y + node.y * state.scale;
  if (left < 0 || left + 225 * state.scale > rect.width || top < 0 || top + 86 * state.scale > rect.height) {
    state.x = rect.width / 2 - (node.x + 112) * state.scale;
    state.y = rect.height / 2 - (node.y + 43) * state.scale;
    transform();
  }
}
function readerSnapshot() {
  return { atlasReader: true, selected: state.selected, tree: state.tree, readingFocus: Boolean(state.readingFocus), scroll: $('#page').scrollTop ?? 0, scale: state.scale, x: state.x, y: state.y, filter: $('#filter-text').value, type: $('#filter-type').value, preview: state.preview ? { id: state.preview.id, revision: state.preview.revision } : null };
}
function rememberReader() {
  const snapshot = readerSnapshot();
  history.replaceState(snapshot, '', location.href ?? `${location.pathname}${location.search}`);
  return snapshot;
}
function readerURL(selected = state.selected) {
  const params = new URLSearchParams({ tree: selected?.tree ?? state.tree });
  if (selected?.kind === 'source') {
    const owner = selected.owner;
    if (owner) params.set(owner.kind, owner.id);
    params.set('source', selected.source.uri); params.set('sourceIndex', String(selected.sourceIndex ?? 0));
  } else if (selected) params.set(selected.kind, selected.id);
  return `${location.pathname}?${params}`;
}
function select(kind, id, tree, remember = true, extra = {}) {
  if (remember) { const previous = rememberReader(); if (state.selected) state.history.push(previous); }
  if (tree !== state.tree) { $('#filter-text').value = ''; $('#filter-type').value = ''; }
  state.tree = tree; state.selected = { kind, id, tree, ...extra };
  $('#page').hidden = false; renderTree(); renderPage(); $('#page').scrollTop = 0;
  history[remember ? 'pushState' : 'replaceState'](readerSnapshot(), '', readerURL());
}
async function restoreReader(snapshot) {
  if (!snapshot?.atlasReader) return refresh(true);
  if (snapshot.preview && (!state.preview || state.preview.id !== snapshot.preview.id)) {
    await previewDraft({ id: snapshot.preview.id, revision: snapshot.preview.revision }, false);
  } else if (!snapshot.preview && state.preview) await exitPreview(false);
  state.restoring = true; state.selected = snapshot.selected ? { ...snapshot.selected, ...(snapshot.selected.kind === 'source' ? { restoreScroll: snapshot.scroll } : {}) } : null; state.tree = snapshot.tree;
  state.scale = snapshot.scale; state.x = snapshot.x; state.y = snapshot.y;
  $('#filter-text').value = snapshot.filter ?? ''; $('#filter-type').value = snapshot.type ?? '';
  setReadingFocus(snapshot.readingFocus); renderTree(); renderPage();
  $('#page').hidden = !state.selected;
  requestAnimationFrame(() => { $('#page').scrollTop = snapshot.scroll ?? 0; transform(); state.restoring = false; });
}
function renderPage() {
  const selected = state.selected; if (!selected) return;
  if (selected.kind === 'source') { renderSourcePage(selected); return; }
  if (selected.kind === 'facet') { renderFacetPage(selected); return; }
  const record = selected.kind === 'point' ? pointById(selected.id) : branchById(selected.tree, selected.id);
  if (!record) { $('#page').hidden = true; state.selected = null; return; }
  $('#page').hidden = false; $('#back').hidden = state.history.length === 0;
  const content = $('#page-content'); content.replaceChildren();
  const tree = treeById(record.tree);
  const crumbs = el('nav', { class: 'breadcrumb', 'aria-label': 'Point ancestry' }, button(tree.title, () => select('point', tree.base, tree.id)));
  for (const ancestor of record.ancestors ?? []) {
    if (ancestor.id === tree.base) continue;
    const target = ancestor.kind === 'point' ? pointById(ancestor.id) : branchById(tree.id, ancestor.id);
    crumbs.append('›', button(target?.title ?? 'Not published', () => select(ancestor.kind, ancestor.id, tree.id)));
  }
  content.append(crumbs);
  if (record.publicationAvailable === false) { content.append(el('h2', {}, 'Not published'), el('p', { class: 'minor' }, 'This Point was excluded from the publication.')); return; }
  if (selected.kind === 'point') {
    const metadata = el('div', { class: 'point-meta' }, el('span', { class: 'badge' }, record.id === tree.base ? 'Base Point' : record.type ?? 'Point'));
    if (record.status) metadata.append(el('span', { class: 'badge' }, record.status));
    if (record.observedAt) metadata.append(el('span', { class: 'badge' }, record.observedAt));
    content.append(metadata, el('h2', {}, record.title), prose(record.html));
    if (record.uncertainty) content.append(el('p', { class: 'uncertainty' }, record.uncertainty));
    if (state.data.editable) content.append(el('div', { class: 'edit-actions' }, button('Edit Point', () => editPoint(record), { class: 'quiet' }), button('Attach a Facet', () => newFacet(record), { class: 'quiet' }), button('Move file', () => moveRecord(record), { class: 'quiet' }), button('Change position', () => positionRecord(record, 'point'), { class: 'quiet' }), ...(record.id !== tree.base ? [button('Remove or consolidate', () => removePoint(record), { class: 'quiet' })] : [])));
    const children = outlineChildren(tree, 'point', record.id);
    if (children.length) content.append(section('Develop this explanation', childLinks(children, tree.id)));
    if (record.sources?.length) content.append(section('Sources', sourceList(record.sources, { kind: 'point', id: record.id, tree: record.tree })));
  } else {
    content.append(el('p', { class: 'eyebrow' }, 'BRANCH'), el('h2', {}, record.title));
    const children = el('div', { class: 'facet-targets' });
    for (const child of record.children) {
      const kind = child.point ? 'point' : 'branch'; const id = child.point ?? child.branch;
      const target = kind === 'point' ? pointById(id) : branchById(tree.id, id);
      children.append(button(target?.title ?? 'Not published', () => select(kind, id, tree.id)));
    }
    content.append(children);
    if (state.data.editable) content.append(el('div', { class: 'edit-actions' }, button('Edit Branch', () => branchForm(record)), button('Change position', () => positionRecord(record, 'branch')), button('Attach a Facet', () => newFacet(record, 'branch'))));
  }
  const attached = atlas().facets.filter(facet => facetHost(facet, selected.kind, selected.id, tree.id));
  if (attached.length) content.append(section('Through another Tree', ...attached.map(facetCard)));
  if (selected.kind === 'point') {
    const surrounding = atlas().facets.filter(facet => facet.tree === tree.id && facet.on.branch && (record.ancestors ?? []).some(a => a.kind === 'branch' && a.id === facet.on.branch));
    if (surrounding.length) content.append(section('On the surrounding Branch', ...surrounding.map(facetCard)));
    const broader = atlas().facets.filter(facet => facet.tree === tree.id && facet.on.point && (record.ancestors ?? []).some(a => a.kind === 'point' && a.id === facet.on.point));
    if (broader.length) content.append(el('details', { class: 'section' }, el('summary', {}, `From the broader explanation (${broader.length})`), el('p', { class: 'minor' }, 'These Facets belong to ancestor Points; their scope remains with those explanations.'), ...broader.map(facetCard)));
  }
  const incoming = atlas().facets.filter(facet => facet.via === tree.id && facet.targets.some(target => target[selected.kind] === selected.id || (selected.kind === 'point' && selected.id === tree.base && target.tree === tree.id)));
  if (incoming.length) content.append(section('Referenced by other accounts', ...incoming.map(facet => button(`${treeById(facet.tree)?.title ?? facet.tree}: ${facet.title}`, () => showFacet(facet), { class: 'quiet' }))));
  if (record.citers?.length) content.append(section('Cited by', ...record.citers.map(citer => button(`${treeById(citer.tree)?.title ?? citer.tree}: ${citer.title}`, () => openCiter(citer), { class: 'quiet' }))));
  content.append(el('p', { class: 'minor section' }, `Reference: ${record.tree}/${record.id}`));
}
function facetCard(facet) {
  const host = facet.on.point ? pointById(facet.on.point) : branchById(facet.tree, facet.on.branch);
  const card = el('article', { class: 'facet-card', id: `facet-${facet.tree}-${facet.id}` }, el('h4', {}, facet.title), el('p', { class: 'minor' }, `${treeById(facet.tree)?.title ?? facet.tree} · attached to ${host?.title ?? 'Not published'}`), prose(facet.html));
  if (facet.uncertainty) card.append(el('p', { class: 'minor' }, facet.uncertainty));
  const targets = el('div', { class: 'facet-targets' });
  for (const target of facet.targets) {
    const via = treeById(facet.via);
    const record = target.point ? pointById(target.point) : target.branch ? branchById(facet.via, target.branch) : via;
    const available = via && record && record.publicationAvailable !== false;
    targets.append(button(available ? `${via.title} → ${record.title}` : `${facet.via}/${target.point ?? target.branch ?? target.tree} · not published`, () => navigateTo(target.branch ? 'branch' : 'point', target.point ?? target.branch ?? via.base, facet.via), { disabled: !available }));
  }
  card.append(targets);
  if (state.data.editable) card.append(button('Edit Facet', () => editFacet(facet), { class: 'quiet' }));
  if (facet.sources?.length) card.append(sourceList(facet.sources, { kind: 'facet', id: facet.id, tree: facet.tree }));
  if (facet.citers?.length) card.append(el('details', {}, el('summary', {}, 'Cited by'), ...facet.citers.map(citer => button(citer.title, () => openCiter(citer)))));
  return card;
}
function outlineChildren(tree, kind, id) {
  if (kind === 'point' && tree.base === id) return tree.children ?? [];
  const find = children => { for (const child of children) { if (child[kind] === id) return child.children ?? []; const nested = find(child.children ?? []); if (nested) return nested; } };
  return find(tree.children ?? []) ?? [];
}
function childLinks(children, tree) {
  return el('div', { class: 'child-explanations' }, ...children.map(child => {
    const kind = child.point ? 'point' : 'branch', id = child.point ?? child.branch;
    const record = kind === 'point' ? pointById(id) : branchById(tree, id);
    return el('article', {}, button(record?.title ?? 'Not published', () => select(kind, id, tree)), el('p', { class: 'minor' }, kind === 'branch' ? 'Branch · grouped detail' : record?.publicationAvailable === false ? 'Not included' : `${record?.type ?? 'Point'} · ${readableExcerpt(record?.body?.slice(0, 180))}${record?.body?.length > 180 ? '…' : ''}`));
  }));
}
function sourceList(sources, owner) {
  return el('div', { class: 'source-list' }, ...sources.map((source, sourceIndex) => {
    const info = el('div', { class: 'source-info' }, source.title ?? source.uri, el('small', {}, [source.role, source.revision, source.locator].filter(Boolean).join(' · ')));
    const row = el('div', { class: 'source-row' }, info);
    if (/^https?:\/\//i.test(source.uri)) row.append(el('a', { href: source.uri, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗'));
    else if (publication && source.publishedPath) row.append(el('a', { href: source.publishedHtmlPath ?? source.publishedPath, target: '_blank', rel: 'noopener noreferrer' }, 'Read'));
    else if (publication) info.append(el('small', {}, 'Source not included'));
    else row.append(button('Read', () => showSource(source, owner, sourceIndex)));
    return row;
  }));
}

function setReadingFocus(enabled) {
  state.readingFocus = enabled;
  $('#app').classList[enabled ? 'add' : 'remove']('reading-focus');
  $('#reading-focus').textContent = enabled ? 'Show Tree' : 'Focus reading';
  $('#reading-focus').setAttribute('aria-pressed', String(enabled));
}
function openCiter(citer) {
  if (citer.kind === 'facet') showFacet(atlas().facets.find(facet => facet.tree === citer.tree && facet.id === citer.id));
  else navigateTo('point', citer.id, citer.tree);
}
function showFacet(facet) {
  if (!facet) return;
  if (closeDialog()) select('facet', facet.id, facet.tree);
}
function renderFacetPage(selected) {
  const facet = atlas().facets.find(item => item.tree === selected.tree && item.id === selected.id);
  if (!facet) { $('#page').hidden = true; return; }
  const hostKind = facet.on.point ? 'point' : 'branch', hostId = facet.on.point ?? facet.on.branch;
  const host = hostKind === 'point' ? pointById(hostId) : branchById(facet.tree, hostId);
  $('#page').hidden = false; $('#back').hidden = state.history.length === 0;
  $('#page-content').replaceChildren(el('nav', { class: 'breadcrumb' }, button(`${treeById(facet.tree)?.title}: ${host?.title}`, () => select(hostKind, hostId, facet.tree))), el('p', { class: 'eyebrow' }, 'FACET · HOST-OWNED INTERPRETATION'), facetCard(facet));
}
async function showSource(source, owner, sourceIndex = 0, heading) {
  if (!closeDialog()) return;
  if (!owner) {
    const selected = state.selected;
    if (selected && ['point', 'facet'].includes(selected.kind)) owner = { kind: selected.kind, id: selected.id, tree: selected.tree };
  }
  select('source', source.uri, owner?.tree ?? state.tree, true, { source, owner, sourceIndex, heading });
}
async function renderSourcePage(selected) {
  $('#page').hidden = false; $('#back').hidden = state.history.length === 0;
  const source = selected.source;
  const context = source?.publishedHtmlPath ?? source?.publishedPath;
  const heading = el('div', {}, ...(selected.owner ? [button('Return to citing explanation', () => select(selected.owner.kind, selected.owner.id, selected.owner.tree))] : []), el('h2', {}, source.title ?? source.uri), el('p', { class: 'record-path' }, source.uri), el('p', { class: 'minor' }, [source.role, source.revision, source.locator].filter(Boolean).join(' · ')));
  if (publication) { $('#page-content').replaceChildren(heading, context ? el('a', { href: context }, 'Read included source') : el('p', {}, 'Source not included.')); return; }
  $('#page-content').replaceChildren(heading, el('p', {}, 'Reading source…'));
  try {
    const result = await api('source', { source, ...(state.preview ? { draft: { id: state.preview.id, revision: state.preview.revision } } : {}) });
    if (state.selected !== selected) return;
    const raw = el('pre', { class: 'source-text' }, result.content ?? `${result.status}: ${result.message ?? ''}`);
    $('#page-content').replaceChildren(heading, result.html ? prose(result.html) : raw, ...(result.sha256 ? [el('details', { class: 'section' }, el('summary', {}, 'Source details'), el('p', { class: 'record-path' }, `SHA-256 ${result.sha256}`))] : []), ...(result.html ? [el('details', { class: 'section' }, el('summary', {}, 'Exact source text'), raw)] : []));
    const fragment = selected.heading ?? (source.uri.includes('#') ? `source-${source.uri.split('#')[1]}` : null);
    if (selected.restoreScroll !== undefined) requestAnimationFrame(() => { $('#page').scrollTop = selected.restoreScroll; delete selected.restoreScroll; });
    else if (fragment && !state.restoring) requestAnimationFrame(() => { let target; try { target = document.getElementById(decodeURIComponent(fragment)); } catch {} if (target) target.scrollIntoView({ block: 'start' }); else notice('The cited heading was not found in these source bytes.'); });
  } catch (error) { if (state.selected === selected) $('#page-content').replaceChildren(heading, el('p', { class: 'uncertainty' }, error.message)); }
}
function searchDialog() {
  const query = el('input', { type: 'search', placeholder: 'Ask a question or enter an ID', 'aria-label': 'Search Points and Facets' });
  const tree = el('select', { 'aria-label': 'Owning Tree' }, el('option', { value: '' }, 'All Trees'), ...atlas().trees.map(item => el('option', { value: item.id }, item.title)));
  const kind = el('select', { 'aria-label': 'Record kind' }, el('option', { value: '' }, 'Points and Facets'), el('option', { value: 'point' }, 'Points'), el('option', { value: 'facet' }, 'Facets'));
  const results = el('div', { class: 'search-results', 'aria-live': 'polite' });
  let offset = 0; const limit = 10;
  const search = () => {
    const records = searchRecords({ points: atlas().points.filter(point => point.publicationAvailable !== false), facets: atlas().facets }, { query: query.value, kinds: kind.value ? [kind.value] : ['point', 'facet'], tree: tree.value || undefined, limit: limit + 1, offset, presentation: 'summary' });
    const page = records.slice(0, limit), more = records.length > limit;
    results.replaceChildren(el('p', { class: 'minor' }, !query.value.trim() ? 'Search by a word, question, Point ID or Facet ID.' : page.length ? `Results ${offset + 1}–${offset + page.length}. Lexical matches; open the owning explanation to assess meaning.` : 'No matches. Try fewer words or another Tree.'), ...page.map(record => el('article', { class: 'search-result' },
      button(record.title, () => record.kind === 'facet' ? showFacet(atlas().facets.find(item => item.tree === record.tree && item.id === record.id)) : navigateTo('point', record.id, record.tree)), el('p', { class: 'minor' }, `${record.kind === 'facet' ? 'Facet interpretation' : record.type ?? 'Point'} · ${treeById(record.tree)?.title ?? record.tree}${record.kind === 'facet' ? ` · host ${record.on.point ?? record.on.branch}` : ''}`), el('p', {}, `${record.snippet.start > 0 ? '…' : ''}${readableExcerpt(record.snippet.text)}${record.snippet.end < record.snippet.totalLength ? '…' : ''}`), ...(record.uncertainty ? [el('p', { class: 'uncertainty' }, record.uncertainty)] : []))), el('div', { class: 'draft-actions' }, button('Previous results', () => { offset = Math.max(0, offset - limit); search(); }, { disabled: offset === 0 }), button('More results', () => { offset += limit; search(); }, { disabled: !more })));
  };
  const reset = () => { offset = 0; search(); };
  query.addEventListener('input', reset); tree.addEventListener('change', reset); kind.addEventListener('change', reset);
  if (openDialog('Search Atlas', el('div', { class: 'search-controls' }, query, tree, kind), results)) { search(); query.focus(); }
}
function sourceOwners(citations) {
  return el('div', { class: 'facet-targets' }, ...citations.map(({ from }) => {
    const record = from.kind === 'facet' ? atlas().facets.find(facet => facet.tree === from.tree && facet.id === from.id) : pointById(from.id);
    return button(`${treeById(from.tree)?.title ?? from.tree}: ${record?.title ?? from.id}`, () => openCiter({ ...from, title: record?.title ?? from.id }));
  }));
}
async function sourceReviewDialog() {
  let history = state.data.editable ? await api('sources/history') : null;
  const sources = [...new Set([...atlas().points, ...atlas().facets].flatMap(record => (record.sources ?? []).map(source => source.uri)))];
  const choices = new Map(sources.map(uri => [uri, el('input', { type: 'checkbox' })]));
  const results = el('div'), prior = el('div');
  const inspection = {};
  const renderHistory = () => {
    if (!history) return;
    prior.replaceChildren(section('Retained source review', el('p', { class: 'minor' }, 'Observed bytes and review decisions persist across sessions. A successful reread leaves an unresolved change awaiting review.'), ...history.observations.map(item => {
      const latest = history.inspections.find(read => read.uri === item.uri);
      const status = el('p', { class: item.reviewStatus === 'needs-review' ? 'uncertainty' : 'minor' }, `${item.reviewStatus} · ${item.observedAt}${latest && !['current', 'changed'].includes(latest.status) ? ` · latest read: ${latest.status}` : ''}`);
      const reason = el('input', { placeholder: 'What did you inspect and conclude?', 'aria-label': `Review reason for ${item.uri}` });
      const decision = outcome => async () => {
        if (!reason.value.trim()) throw new Error('Record the reason for your review decision.');
        history = await api('sources/decisions', { expectedRevision: history.revision, decisions: [{ uri: item.uri, sha256: item.sha256, outcome, reason: reason.value }] });
        if (state.review === inspection) renderHistory();
      };
      const citations = [...atlas().points.map(record => ({ ...record, kind: 'point' })), ...atlas().facets.map(record => ({ ...record, kind: 'facet' }))].filter(record => record.sources?.some(source => source.uri === item.uri)).map(record => ({ from: { kind: record.kind, tree: record.tree, id: record.id } }));
      return el('div', { class: 'draft-entry' }, el('h3', { class: 'record-path' }, item.uri), status, ...(item.reason ? [el('p', {}, item.reason)] : []), sourceOwners(citations), el('details', {}, el('summary', {}, 'Record a review decision'), el('p', { class: 'record-path' }, `Observed SHA-256 ${item.sha256}`), reason, el('div', { class: 'draft-actions' }, button('Reviewed: explanation remains valid', decision('reviewed-unchanged')), button('Explanations updated', decision('updated')), button('Keep awaiting review', decision('needs-review')))));
    })));
  };
  const inspect = button('Review selected sources', async () => {
    const uris = [...choices].filter(([, input]) => input.checked).map(([uri]) => uri);
    if (!uris.length || uris.length > 100) throw new Error('Choose between 1 and 100 sources.');
    inspect.disabled = true;
    try {
      const review = await api('sources/review', { uris });
      if (state.review !== inspection) return;
      results.replaceChildren(el('p', { class: 'minor' }, 'A changed source identifies explanations to review; it does not establish that they are false.'), ...review.results.map(row => section(`${row.status}: ${row.uri}`, el('p', {}, row.reason), ...(row.fragments ?? []).map(fragment => el('p', { class: fragment.status === 'missing-heading' ? 'uncertainty' : 'minor' }, `#${fragment.fragment}: ${fragment.reason}`)), sourceOwners(row.citations))), ...(review.limits ?? []).map(limit => el('p', { class: 'minor' }, limit)));
      if (history) { history = await api('sources/history'); if (state.review === inspection) renderHistory(); }
    } finally { inspect.disabled = false; }
  }, { class: 'primary' });
  if (showDialog('Review source changes', [el('p', {}, 'Choose cited sources to inspect within launch-time source grants. Remote sources remain uninspected.'), el('div', { class: 'draft-actions' }, button(sources.length > 100 ? 'Select first 100' : 'Select all', () => [...choices.values()].forEach((input, index) => { input.checked = index < 100; })), button('Clear selection', () => choices.forEach(input => { input.checked = false; }))), el('details', { open: true }, el('summary', {}, `${sources.length} declared sources`), ...[...choices].map(([uri, input]) => el('label', {}, input, uri))), inspect, results, prior], null, inspection)) renderHistory();
}
function sourceVersionControls(sources, existing = [], draft) {
  const selected = new Map(existing.map(item => [item.uri, item.sha256]));
  const uris = [...new Set([...sources.map(source => source.uri), ...selected.keys()])].filter(uri => !/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('file:'));
  const rows = uris.map(uri => {
    const choice = el('input', { type: 'checkbox', checked: selected.has(uri), disabled: !selected.has(uri) });
    let sha256 = selected.get(uri);
    const status = el('p', { class: 'minor', role: 'status' }, sha256 ? `Required source bytes: ${sha256}` : 'No byte requirement selected.');
    choice.addEventListener('change', () => { if (choice.checked && sha256) selected.set(uri, sha256); else selected.delete(uri); });
    const inspect = button('Inspect source bytes', async () => {
      inspect.disabled = true;
      try {
        const review = await api('sources/review', { uris: [uri], ...(draft ? { draft: { id: draft.id, revision: state.editor?.revision ?? draft.revision } } : {}) });
        const row = review.results[0];
        // A new inspection never silently replaces a previously selected requirement.
        if (selected.has(uri) && row?.sha256 !== selected.get(uri)) { status.textContent = `${row?.status ?? 'unavailable'}: source differs from the selected bytes. Uncheck the requirement before choosing the current bytes.`; return; }
        sha256 = row?.sha256;
        choice.disabled = !sha256;
        status.textContent = `${row?.status ?? 'unavailable'}: ${row?.reason ?? ''}${sha256 ? ` SHA-256 ${sha256}` : ''}`;
      } finally { inspect.disabled = false; }
    });
    return el('div', { class: 'draft-entry' }, el('p', { class: 'record-path' }, uri), inspect, el('label', {}, choice, 'Require these source bytes when applying'), status);
  });
  return { node: el('details', { class: 'section' }, el('summary', {}, `Source byte requirements (${uris.length})`), el('p', { class: 'minor' }, 'Inspect a cited source, then explicitly require its current bytes if this change depends on them. A changed required source will stop application.'), ...rows), selected: () => [...selected].map(([uri, sha256]) => ({ uri, sha256 })) };
}
async function moveRecord(record) {
  const captured = await formCapture('move', { record });
  const destination = el('input', { value: record.path }), reason = el('input', { value: `Move ${record.title}` });
  recordForm('Move Point file', [['New path in the same Tree', destination], ['Reason', reason]], async () => {
    const editor = state.editor;
    if (!editor || editor.saving) return;
    const version = editor.version; editor.saving = true;
    try {
      const saved = await api('move', { baseline: captured.identity, point: record.id, path: destination.value, reason: reason.value });
      if (state.editor !== editor) return;
      if (editor.version !== version) { notice('Move draft saved in Drafts. Newer form changes remain unsaved.'); return; }
      editor.dirty = false; editor.saving = false; await clearWorkingCopy(editor); reviewDraft(saved);
    } finally { editor.saving = false; }
  });
}
function draftReviewDetails(draft) {
  const rows = [], impact = draft.impact;
  if (draft.review) {
    const review = draft.review;
    rows.push(section('Absorb reasoning', el('p', {}, review.rationale), el('p', { class: 'record-path' }, review.source.uri), ...review.contributions.map(item => el('p', {}, `${item.disposition}${item.point || item.facet ? ` · ${item.point ?? `${item.tree}/${item.facet}`}` : ''}: ${item.rationale}${item.destinations?.length ? ` Destination: ${item.destinations.map(target => target.point ?? `${target.tree}/${target.facet}`).join(', ')}` : ''}`))));
    if (review.unresolved.length) rows.push(section('Unresolved', ...review.unresolved.map(item => el('p', { class: 'uncertainty' }, item))));
    if (review.preservation) rows.push(el('details', { class: 'section' }, el('summary', {}, 'Preservation review'), el('p', {}, review.preservation.scope), ...review.preservation.units.map(unit => el('p', {}, `${unit.id} · ${unit.disposition} · ${unit.source.uri} · ${unit.locator}: ${unit.rationale}${unit.destinations?.length ? ` → ${unit.destinations.map(target => target.point ?? `${target.tree}/${target.facet}`).join(', ')}` : ''}`))));
  }
  if (impact?.changedStyle) rows.push(section('Selected Atlas style changes', el('div', { class: 'draft-grid' }, ...['before', 'after'].map(side => el('div', {}, el('h3', {}, side === 'before' ? 'Before' : 'Candidate style'), el('pre', { class: 'source-text' }, impact.changedStyle[side]?.content ?? impact.changedStyle[side]?.body ?? 'No captured style')))), el('p', { class: 'minor' }, 'Review whether the existing Tree boundaries and explanations still follow this style.')));
  if (impact?.status === 'ready') {
    const changed = [...(impact.changedPoints ?? []).map(item => `${item.after?.title ?? item.before?.title}: ${item.changes.join(', ')}`), ...(impact.changedFacets ?? []).map(item => `Facet: ${item.after?.title ?? item.before?.title}`), ...(impact.changedTrees ?? []).map(item => `Tree: ${item.after?.title ?? item.before?.title}`), ...(impact.changedBranches ?? []).map(item => `Branch: ${item.after?.title ?? item.before?.title}`)];
    rows.push(section('Meaning and placement to review', ...changed.map(text => el('p', {}, text))));
    for (const [side, context] of Object.entries(impact.review ?? {})) rows.push(el('details', { class: 'section' }, el('summary', {}, `${side === 'before' ? 'Before' : 'Candidate'}: related explanations`), ...['points', 'branches', 'facets', 'trees'].flatMap(kind => context[kind].map(({ record, reasons }) => el('details', { class: 'draft-entry' }, el('summary', {}, record.title), el('p', { class: 'minor' }, reasons.map(reason => reason.explanation ?? reason.kind).join(' · ')), el('pre', { class: 'source-text' }, record.body ?? record.scope ?? record.title))))));
    const mentions = ['before', 'after'].flatMap(side => (impact.mentions?.[side] ?? []).map(item => el('p', {}, `${side} · ${item.target.point ?? item.target.facet}: ${item.citers.map(citer => citer.record?.title ?? citer.record?.id).join(', ') || 'no direct citers'} (${item.bounds.returned}/${item.bounds.available})`)));
    if (mentions.length) rows.push(el('details', { class: 'section' }, el('summary', {}, 'Direct citations to review'), el('p', { class: 'minor' }, 'Direct mentions are review leads; they do not establish dependency or require an automatic rewrite.'), ...mentions));
    if (impact.linkDiagnostics?.length) rows.push(section('Links needing review', ...impact.linkDiagnostics.map(item => el('p', { class: 'uncertainty' }, `${item.path}${item.line ? `:${item.line}` : ''}: ${item.message}`))));
  }
  if (draft.plan.sourcePreconditions?.length) rows.push(section('Required source bytes', ...draft.plan.sourcePreconditions.map(item => el('p', { class: 'record-path' }, `${item.uri} · ${item.sha256}`))));
  if (draft.reviewHistory?.length) rows.push(el('details', { class: 'section' }, el('summary', {}, `Prior reasoning and evidence (${draft.reviewHistory.length} revisions)`), el('p', { class: 'uncertainty' }, 'Historical context. These records describe earlier candidates and do not verify this one.'), ...draft.reviewHistory.map(item => el('details', {}, el('summary', {}, `${item.reason} · ${item.updatedAt}`), el('p', { class: 'record-path' }, `Prior candidate ${item.candidate}`), ...(item.review ? [el('p', {}, item.review.rationale), ...item.review.contributions.map(contribution => el('p', {}, `${contribution.disposition}: ${contribution.rationale}`))] : []), ...(item.checkRuns ?? []).map(run => el('p', {}, `Previous evidence: ${run.required.passed}/${run.required.total} required Checks passed`))))));
  if (draft.checkRuns?.length) {
    const runs = draft.checkRuns.map(run => {
      const results = run.results.map(result => el('div', { class: 'draft-entry' },
        el('h4', {}, `${result.id}: ${result.outcome}`), el('p', {}, result.reason),
        ...result.evidence.map(item => el('p', {}, `${item.text}${item.source ? ` · ${item.source.uri}` : ''}`))));
      return el('details', {}, el('summary', {}, `${run.required.passed}/${run.required.total} required Checks passed · ${run.actor ?? 'Unknown reviewer'}`),
        el('p', { class: 'minor' }, `Candidate ${run.baseline} · ${run.createdAt}. Evidence does not approve application.`), ...results);
    });
    rows.push(section('Candidate Check evidence', ...runs));
  }
  return rows;
}
function reviewCandidateChecks(draft) {
  state.formContext = { kind: 'checks', draftId: draft.id, draftRevision: draft.revision, baseline: draft.plan.baseline.identity };
  const candidate = draft.plan.candidate;
  const checks = candidate.atlas.checks.filter(check => check.status === 'active');
  const actor = el('input', { placeholder: 'Reviewer name', 'aria-label': 'Reviewer' });
  const controls = checks.map(check => {
    const outcome = el('select', {}, ...['unreviewed', 'pass', 'fail', 'unable'].map(value => el('option', { value }, value)));
    const reason = el('input', { placeholder: 'Reason for this result' }), evidence = el('textarea', { placeholder: 'What did you inspect, and what did it show?', style: 'min-height:90px' });
    return { check, outcome, reason, evidence, node: section(`${check.title} · ${check.level}`, el('pre', { class: 'source-text' }, check.body), el('label', {}, 'Outcome', outcome), el('label', {}, 'Reason', reason), el('label', {}, 'Evidence', evidence)) };
  });
  editDialog('Review candidate Checks', [el('p', {}, 'Review the candidate explanations and the Check definitions below. This records evidence against this exact candidate; it does not apply or approve the draft.'), el('label', {}, 'Reviewer', actor), ...controls.map(item => item.node), button('Save Check evidence', async () => {
    if (!actor.value.trim()) throw new Error('Enter a reviewer name.');
    const manual = controls.filter(item => item.outcome.value !== 'unreviewed').map(({ check, outcome, reason, evidence }) => ({ id: check.id, revision: check.revision, baseline: candidate.identity, outcome: outcome.value, reason: reason.value, evidence: evidence.value.trim() ? [{ text: evidence.value }] : [] }));
    if (!manual.length) throw new Error('Review at least one Check before saving evidence.');
    const editor = state.editor;
    if (!editor || editor.saving) return;
    const version = editor.version; editor.saving = true;
    try {
      const saved = await api('draft-checks', { id: draft.id, expectedRevision: editor.revision, actor: actor.value, checkIds: manual.map(item => item.id), manual });
      if (state.editor !== editor) return;
      editor.revision = saved.revision;
      if (editor.version !== version) { notice('Evidence saved. Newer form changes remain unsaved.'); return; }
      editor.dirty = false; editor.saving = false; await clearWorkingCopy(editor); reviewDraft(saved);
    } finally { editor.saving = false; }
  }, { class: 'primary' })], draft);
}

function leaveEditor(action) {
  const editor = state.editor;
  if (editor?.saving) { notice('Wait for this draft save to finish before leaving.'); return false; }
  if (editor?.dirty) {
    state.pendingLeave = action; $('#unsaved-warning').hidden = false;
    $('#unsaved-warning').scrollIntoView({ block: 'nearest' }); $('#keep-editing').focus();
    return false;
  }
  state.editor = null;
  state.pendingLeave = null; $('#unsaved-warning').hidden = true;
  return true;
}
function showDialog(title, children, editor = null, review = null) {
  if (!leaveEditor(() => showDialog(title, children, editor, review))) return false;
  state.editor = editor; state.review = review;
  $('#draft-dialog h2').textContent = title; $('#draft-content').replaceChildren(...children);
  if (!$('#draft-dialog').open) $('#draft-dialog').showModal();
  return true;
}
function openDialog(title, ...children) { return showDialog(title, children); }
function editDialog(title, children, draft = null) {
  const context = state.formContext; state.formContext = null;
  const status = el('p', { id: 'autosave-status', class: 'minor', role: 'status' }, 'Typing will be saved privately for recovery.');
  return showDialog(title, [...children, status], { dirty: false, saving: false, version: 0, draftId: draft?.id, revision: draft?.revision, title, context });
}
function edited() {
  if (!state.editor) return;
  state.editor.dirty = true; state.editor.version++;
  scheduleWorkingCopy(state.editor);
}
let workingTimer;
async function formCapture(kind, context = {}) {
  const recovery = state.recovery;
  const captured = recovery?.form.context?.captured ?? await api('files');
  state.formContext = { kind, ...context, captured };
  return captured;
}
function formFields() {
  return [...($('#draft-content').querySelectorAll?.('input,select,textarea') ?? [])].map(node => ({ value: node.value, checked: node.checked, type: node.type ?? node.tagName }));
}
function scheduleWorkingCopy(editor) {
  clearTimeout(workingTimer);
  workingTimer = setTimeout(() => run(() => persistWorkingCopy(editor)), 500);
}
async function persistWorkingCopy(editor) {
  if (state.editor !== editor || !editor.dirty || !editor.context) return;
  if (editor.autosaving) { editor.autosaveAgain = true; return; }
  editor.autosaving = true;
  const version = editor.version, fields = formFields();
  const citations = [...($('#draft-content').querySelectorAll?.('.citation-fields') ?? [])].map(row => ({ removed: row.hidden, values: Object.fromEntries([...row.querySelectorAll('input,select')].map(input => [input.dataset.field, input.value])) }));
  const extra = editor.capture?.() ?? {};
  try {
    const copy = await api('working-copies', { ...(editor.working ? { id: editor.working.id, expectedRevision: editor.working.revision } : {}), baseline: editor.context.captured?.identity ?? state.data.identity, form: { kind: editor.context.kind, title: editor.title, context: editor.context, fields: { controls: fields, citations, ...extra } } });
    editor.working = copy;
    if (state.editor === editor) $('#autosave-status').textContent = editor.version === version ? 'Typing saved privately for recovery. Save and review to create a candidate.' : 'Saving newer typing…';
  } catch (error) { if (state.editor === editor) $('#autosave-status').textContent = `Recovery save failed: ${error.message}. Keep this form open.`; }
  finally { editor.autosaving = false; if (editor.clearAfterAutosave) { editor.clearAfterAutosave = false; await clearWorkingCopy(editor); } if (state.editor === editor && (editor.autosaveAgain || editor.version !== version)) { editor.autosaveAgain = false; scheduleWorkingCopy(editor); } }
}
async function clearWorkingCopy(editor) {
  clearTimeout(workingTimer);
  if (editor?.autosaving) { editor.clearAfterAutosave = true; return; }
  if (editor?.working) { await api('working-copies', { id: editor.working.id, expectedRevision: editor.working.revision }, 'DELETE'); editor.working = null; }
}
async function recoverWorkingCopy(id) {
  const copy = await api(`working-copies/${id}`), context = copy.form.context ?? {};
  state.recovery = copy;
  try {
    if (copy.form.kind === 'point') await editPoint(pointById(context.id) ?? context.record);
    else if (copy.form.kind === 'facet') await editFacet(atlas().facets.find(item => item.tree === context.tree && item.id === context.id) ?? context.record);
    else if (copy.form.kind === 'records') await editRecords(context.draftId);
    else if (copy.form.kind === 'new-point') await newPoint();
    else if (copy.form.kind === 'new-tree') await newTree();
    else if (copy.form.kind === 'new-facet') await newFacet(context.record, context.hostKind);
    else if (copy.form.kind === 'branch') await branchForm(context.record);
    else if (copy.form.kind === 'position') await positionRecord(context.record, context.recordKind);
    else if (copy.form.kind === 'remove') await removePoint(context.record);
    else if (copy.form.kind === 'style') await styleDialog();
    else if (copy.form.kind === 'checks') { const draft = await api(`drafts/${context.draftId}`); if (draft.revision !== context.draftRevision) { openDialog('Earlier candidate review notes', el('p', { class: 'uncertainty' }, 'This draft changed after these notes were typed. Keep them as context and review the current candidate afresh.'), el('pre', { class: 'source-text' }, copy.form.fields.controls.map(item => item.value).filter(Boolean).join('\n\n'))); return; } reviewCandidateChecks(draft); }
    else if (copy.form.kind === 'move') await moveRecord(context.record);
    else if (copy.form.kind === 'initialize') await initializeAtlas();
    else throw new Error('Open advanced records and use the retained field text to recover this form.');
    copy.form.fields.controls.forEach((saved, index) => { const node = [...($('#draft-content').querySelectorAll?.('input,select,textarea') ?? [])][index]; if (!node) return; node.value = saved.value; if (saved.checked !== undefined) node.checked = saved.checked; node.dispatchEvent(new Event('change', { bubbles: true })); });
    if (state.editor) { state.editor.working = copy; if (context.draftRevision) state.editor.revision = context.draftRevision; state.editor.dirty = true; $('#autosave-status').textContent = copy.baseline === state.data.identity ? 'Recovered private typing. Review it before saving a candidate.' : 'Recovered against an older Atlas. Applying will require a fresh review if the source changed.'; }
  } finally { state.recovery = null; }
}
function closeDialog() {
  if (!leaveEditor(closeDialog)) return false;
  state.review = null; $('#draft-dialog').close(); return true;
}
function navigateTo(kind, id, tree) {
  if (closeDialog()) select(kind, id, tree);
}
async function drafts() {
  const [saved, transactions, working] = await Promise.all([api('drafts'), api('transactions'), api('working-copies')]);
  const actions = el('div', { class: 'draft-actions' }, button('New Point', newPoint, { class: 'primary' }), button('New Tree', newTree), button('New Branch', () => branchForm()), button('Edit records', () => editRecords()));
  const entries = saved.map(draft => el('div', { class: 'draft-entry' }, el('h3', {}, draft.reason), el('p', { class: 'minor' }, `${draft.status} · ${new Date(draft.updatedAt).toLocaleString()}`), el('div', { class: 'draft-actions' }, button('Review', async () => reviewDraft(await api(`drafts/${draft.id}`))), button('Continue editing', () => editRecords(draft.id)), button('Discard', async () => { await api('drafts', { id: draft.id, expectedRevision: draft.revision }, 'DELETE'); await drafts(); }))));
  const interrupted = transactions.filter(item => !['complete', 'rolled-back'].includes(item.phase));
  const recovery = interrupted.map(item => el('div', { class: 'draft-entry' }, el('h3', {}, 'Interrupted change'), el('p', { class: 'minor' }, `${item.written?.length ?? 0} ${item.written?.length === 1 ? 'file' : 'files'} recorded as written. Recovery restores the original files after checking for later edits. It stops if an affected file has changed.`), button('Restore original files', async () => { const result = await api('recover', { id: item.id }); notice(result.baselineRestored ? 'Original Atlas restored.' : 'Affected files restored; other changes remain.'); await refresh(); await drafts(); })));
  const recoveryTyping = working.map(copy => el('div', { class: 'draft-entry' }, el('h3', {}, copy.form?.title ?? copy.title ?? 'Unfinished typing'), el('p', { class: 'minor' }, 'Private recovery copy · has not been applied'), button('Recover typing', () => recoverWorkingCopy(copy.id)), button('Discard recovery copy', async () => { await api('working-copies', { id: copy.id, expectedRevision: copy.revision }, 'DELETE'); await drafts(); })));
  openDialog('Drafts and recovery', actions, ...recoveryTyping, ...(entries.length ? entries : [el('p', { class: 'minor' }, 'No saved drafts.')]), ...recovery);
}
async function saveForReview(baseline, changes, reason, id, sourcePreconditions, styleChange = false) {
  const editor = state.editor;
  if (!editor || editor.saving) return;
  const version = editor.version;
  editor.saving = true;
  try {
    const draftId = editor.draftId ?? id;
    const draft = await api('drafts', { baseline, changes, reason, ...(styleChange ? { styleChange: true } : {}), ...(sourcePreconditions ? { sourcePreconditions } : {}), ...(draftId ? { id: draftId, expectedRevision: editor.revision } : {}) });
    if (state.editor !== editor) return;
    editor.draftId = draft.id; editor.revision = draft.revision;
    if (editor.version !== version) { notice('Draft saved. Your newer changes are still unsaved; save again before reviewing.'); return; }
    editor.dirty = false; editor.saving = false;
    await clearWorkingCopy(editor);
    reviewDraft(draft);
  } finally { editor.saving = false; }
}
async function initializeAtlas() {
  const captured = await formCapture('initialize');
  const baseline = captured.identity;
  const available = await api('styles');
  const style = el('select', {}, ...available.styles.map(item => el('option', { value: item.id }, item.title)), el('option', { value: 'custom' }, 'Custom style'));
  const customStyle = el('textarea', { 'aria-label': 'Custom style definition', value: '---\n{"id":"my-style","revision":"1"}\n---\n# My authoring style\n\nExplain how this account should choose Tree boundaries, develop Points and use Facets.\n' });
  const customPanel = el('div', { hidden: true }, el('p', { class: 'minor' }, 'Provide a complete Markdown style with JSON metadata, stable id, revision, title and guidance. The reviewed draft captures these exact words.'), customStyle);
  const styleExplanation = el('div'); const showStyle = () => { const chosen = available.styles.find(item => item.id === style.value); customPanel.hidden = style.value !== 'custom'; styleExplanation.replaceChildren(chosen ? prose(chosen.html) : el('p', {}, 'Write the local guidance for this account below.')); }; style.addEventListener('change', showStyle); showStyle();
  const id = el('input', { value: 'my-atlas' }), title = el('input', { value: 'My Atlas' });
  recordForm('Create Atlas', [['Stable ID', id], ['Title', title], ['Authoring style', style], ['Style guidance', styleExplanation], ['', customPanel]], async () => {
    const editor = state.editor;
    if (!editor || editor.saving) return;
    const version = editor.version; editor.saving = true;
    try {
      const draft = await api('initialize', { baseline, id: id.value, title: title.value, ...(style.value === 'custom' ? { styleContent: customStyle.value } : { styleId: style.value }) });
      if (state.editor !== editor) return;
      if (editor.version !== version) { notice('Creation draft saved in Drafts. Your newer form changes are still unsaved.'); return; }
      editor.dirty = false; editor.saving = false; await clearWorkingCopy(editor); reviewDraft(draft);
    } finally { editor.saving = false; }
  });
}
async function connectAgent() {
  const configuration = await api('connection');
  const text = el('textarea', { readOnly: true, value: JSON.stringify(configuration, null, 2), 'aria-label': 'Agent host configuration' });
  const status = el('p', { role: 'status' });
  openDialog('Connect an agent', el('p', {}, 'Copy this configuration into your agent host to connect it to the selected Atlas and source folders.'), text, button('Copy configuration', async () => {
    try { await navigator.clipboard.writeText(text.value); status.textContent = 'Agent configuration copied.'; }
    catch { text.focus(); text.select(); status.textContent = 'Automatic copy is unavailable. The configuration is selected; copy it with your keyboard.'; }
  }), status);
}
function showChecks() {
  const checks = atlas()?.checks ?? [];
  const active = checks.filter(check => check.status === 'active');
  const rows = checks.map(check => section(check.title, el('p', {}, `${check.status} · ${check.level}${check.status === 'active' ? ' · Review not shown' : ' · Inactive'}`), prose(check.html), el('p', { class: 'record-path' }, `Revision: ${check.revision}`)));
  openDialog('Checks', el('p', {}, atlas() ? `${active.filter(check => check.level === 'required').length} active required Checks. This panel lists their definitions.` : 'Repair the Atlas to load its complete set of Checks. Use Edit records to inspect the affected files.'),
    el('p', { class: 'minor' }, 'Use a connected agent to review current content, or open a saved draft and choose Review candidate Checks to record evidence before application.'),
    ...(rows.length ? rows : [el('p', {}, atlas() ? 'No Check definitions are present.' : 'No complete Check inventory is available.') ]));
}
async function exportSite() {
  const available = await api('publication');
  const treeInputs = new Map(), pointInputs = new Map(), sourceInputs = new Map();
  const rows = available.atlas.trees.map(tree => {
    const input = el('input', { type: 'checkbox', checked: true }); treeInputs.set(tree.id, input);
    const points = available.atlas.points.filter(point => point.tree === tree.id).map(point => {
      const included = el('input', { type: 'checkbox', checked: true }); pointInputs.set(point.id, { input: included, tree: tree.id });
      return el('label', {}, included, point.title);
    });
    return el('section', { class: 'draft-entry' }, el('label', {}, input, el('strong', {}, tree.title)), ...points);
  });
  const sources = [...new Set([...available.atlas.points, ...available.atlas.facets].flatMap(record => (record.sources ?? []).map(source => source.uri)))].sort();
  const includeStyle = el('input', { type: 'checkbox' });
  const sourceRows = sources.map(uri => { const input = el('input', { type: 'checkbox' }); sourceInputs.set(uri, input); return el('label', {}, input, uri); });
  openDialog('Export site', el('p', {}, 'Choose the Trees and Points for a local static site. Select any source files to include below. The site will be saved at the destination shown here.'), el('p', { class: 'record-path' }, `Destination: ${available.output}`), ...rows,
    ...(sourceRows.length ? [section('Include source files', ...sourceRows)] : []), el('label', {}, includeStyle, 'Include the captured Atlas style in this publication'), button('Preview selection', async () => {
      const trees = [...treeInputs].filter(([, input]) => input.checked).map(([id]) => id);
      const points = [...pointInputs].filter(([, item]) => item.input.checked && trees.includes(item.tree)).map(([id]) => id);
      const sources = [...sourceInputs].filter(([, input]) => input.checked).map(([uri]) => uri);
      const preview = await api('publication/prepare', { baseline: available.identity, trees, points, sources, includeStyle: includeStyle.checked });
      const sourceStatus = preview.sources.map(source => el('p', {}, `${source.uri}: ${source.status}${source.message ? ` — ${source.message}` : ''}`));
      openDialog('Review publication', el('p', { class: 'record-path' }, `Destination: ${preview.output}`), el('p', {}, `${preview.counts.trees} Trees · ${preview.counts.points} Points · ${preview.counts.facets} Facets · ${preview.counts.sources} source references`), el('pre', {}, JSON.stringify(preview.selection, null, 2)), ...sourceStatus,
        ...(preview.excludedTargets.length ? [section('Unavailable Facet targets', el('pre', {}, JSON.stringify(preview.excludedTargets, null, 2)))] : []),
        el('p', { class: 'minor' }, 'An existing destination or changed source will stop this export. Choose a new destination at launch for a later export.'), button('Export this selection', async () => {
          const result = await api('publication/apply', { id: preview.id });
          openDialog('Site exported', el('p', {}, 'The selected static site is ready. Serve this directory over HTTP to view it.'), el('p', { class: 'record-path' }, result.output));
        }, { class: 'primary' }), button('Change selection', exportSite));
    }, { class: 'primary' }));
}
function reviewDraft(draft) {
  const plan = draft.plan;
  const review = {};
  const details = plan.changes.map(change => el('section', { class: 'draft-entry' }, el('h3', { class: 'record-path' }, change.path), el('div', { class: 'draft-grid' }, el('div', {}, el('p', { class: 'minor' }, 'Before'), el('pre', {}, change.beforeBase64 === undefined ? change.before ?? '(new file)' : `Original non-UTF-8 bytes (Base64):\n${change.beforeBase64}`)), el('div', {}, el('p', { class: 'minor' }, 'After'), el('pre', {}, change.after ?? '(deleted)')))));
  const diagnostics = el('pre', { class: 'diagnostics' }, plan.validation.diagnostics.map(item => `${item.path}: ${item.message}`).join('\n'));
  showDialog('Review draft', [el('h3', {}, plan.reason), el('p', { class: 'minor' }, `${plan.changes.length} changed ${plan.changes.length === 1 ? 'file' : 'files'} · ${plan.status}. If the Atlas changes, review a new draft before applying.`), diagnostics, ...draftReviewDetails(draft),
    el('div', { class: 'draft-actions' }, button(plan.status === 'noop' ? 'Confirm no change' : 'Apply draft', async () => {
      const result = await api('apply', { id: draft.id, expectedRevision: draft.revision });
      if (result.status === 'interrupted') { notice(`Change interrupted: ${result.error.message}`); if (state.review === review) await drafts(); return; }
      notice(result.status === 'noop' ? 'No change needed.' : 'Draft applied.');
      if (state.review === review) { state.review = null; $('#draft-dialog').close(); }
      await refresh();
    }, { class: 'primary', disabled: plan.status === 'invalid' }), button('Read proposed changes', () => semanticComparison(draft), { disabled: !plan.candidate.atlas }), button('Browse complete candidate', () => previewDraft(draft), { disabled: !plan.candidate.atlas }), button('Continue editing', () => editRecords(draft.id)), ...(plan.candidate.atlas?.checks?.some(check => check.status === 'active') ? [button('Review candidate Checks', () => reviewCandidateChecks(draft))] : []), button('All drafts', drafts)), el('details', {}, el('summary', {}, 'File changes'), ...details)], null, review);
}
async function previewDraft(draft, remember = true) {
  const preview = await api(`drafts/${draft.id}/preview`);
  if (draft.revision && preview.revision !== draft.revision) throw new Error('The draft changed. Reopen its review before previewing.');
  if (!closeDialog()) return;
  if (!state.preview) { state.liveData = state.data; state.liveReader = readerSnapshot(); }
  if (remember) rememberReader();
  state.preview = preview; state.data = preview.after;
  $('#mode-label').textContent = 'Candidate preview'; $('#preview-notice').hidden = false;
  $('#preview-notice').textContent = `Candidate: ${preview.reason}. Reading proposed content; nothing has been applied.`;
  $('#exit-preview').hidden = false;
  for (const id of ['workspace', 'connect-agent', 'export-site', 'checks', 'review-sources', 'refresh']) $(`#${id}`).hidden = true;
  $('#tree-select').replaceChildren(...atlas().trees.map(tree => el('option', { value: tree.id }, tree.title)));
  if (!treeById(state.tree)) state.tree = atlas().trees[0]?.id;
  const selected = state.selected;
  if (!selected || selected.kind === 'source' || selected.kind === 'point' && !pointById(selected.id)) state.selected = state.tree ? { kind: 'point', id: treeById(state.tree).base, tree: state.tree } : null;
  renderTree(); renderPage();
  if (remember) history.pushState(readerSnapshot(), '', readerURL());
}
async function exitPreview(remember = true) {
  if (!state.preview) return;
  const previous = state.liveReader;
  state.preview = null; state.data = state.liveData; state.liveData = null;
  $('#preview-notice').hidden = true; $('#exit-preview').hidden = true;
  await refresh();
  await restoreReader(previous);
  if (remember) history.pushState(readerSnapshot(), '', readerURL());
}
async function semanticComparison(draft) {
  const preview = await api(`drafts/${draft.id}/preview`);
  if (preview.revision !== draft.revision) throw new Error('Reopen the current draft before comparing.');
  const blocks = [];
  const beforeStyle = preview.before.atlas?.style ?? null, afterStyle = preview.after.atlas?.style ?? null;
  if (JSON.stringify(beforeStyle) !== JSON.stringify(afterStyle)) {
    const styleSide = (style, title) => el('div', {}, el('p', { class: 'eyebrow' }, title), style
      ? el('div', {}, el('h3', {}, style.title), el('p', { class: 'minor' }, `${style.id} · revision ${style.revision}`), prose(style.html))
      : el('p', { class: 'minor' }, 'No captured style'));
    blocks.push(section('Atlas style', el('div', { class: 'draft-grid semantic-comparison' }, styleSide(beforeStyle, 'BEFORE'), styleSide(afterStyle, 'CANDIDATE'))));
  }
  for (const kind of ['points', 'facets']) {
    const before = preview.before.atlas?.[kind] ?? [], after = preview.after.atlas?.[kind] ?? [];
    const keys = [...new Set([...before, ...after].map(item => `${item.tree}/${item.id}`))];
    for (const key of keys) {
      const old = before.find(item => `${item.tree}/${item.id}` === key), next = after.find(item => `${item.tree}/${item.id}` === key);
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      const side = record => record ? el('div', {}, el('h3', {}, record.title), el('p', { class: 'minor' }, [record.type, record.status, record.observedAt].filter(Boolean).join(' · ')), prose(record.html), ...(record.uncertainty ? [el('p', { class: 'uncertainty' }, record.uncertainty)] : []), el('p', { class: 'minor' }, `Sources: ${(record.sources ?? []).map(item => [item.uri, item.role, item.locator].filter(Boolean).join(' · ')).join('; ') || 'none'}`)) : el('p', { class: 'minor' }, 'Not present');
      blocks.push(section(`${kind === 'facets' ? 'Facet' : 'Point'} · ${key}`, el('div', { class: 'draft-grid semantic-comparison' }, el('div', {}, el('p', { class: 'eyebrow' }, 'BEFORE'), side(old)), el('div', {}, el('p', { class: 'eyebrow' }, 'CANDIDATE'), side(next)))));
    }
  }
  openDialog('Read proposed changes', el('p', { class: 'minor' }, 'Rendered explanations, uncertainty and citations from the exact original and candidate. Structure and file effects remain in the draft review.'), ...blocks, button('Browse the complete candidate', () => previewDraft(draft), { class: 'primary' }), button('Return to draft review', () => reviewDraft(draft)));
}
function citationEditor(sources = []) {
  const rows = [], container = el('div', { class: 'citation-editor' });
  const add = source => {
    const fields = Object.fromEntries(['uri', 'title', 'role', 'revision', 'locator', 'sha256'].map(name => [name, name === 'role' ? el('select', {}, ...['', 'evidence', 'background', 'example', 'implementation', 'history'].map(value => el('option', { value, selected: value === (source.role ?? '') }, value || 'Unclassified'))) : el('input', { value: source[name] ?? '', placeholder: name === 'uri' ? 'sources/report.md#heading' : name })]));
    for (const [name, input] of Object.entries(fields)) input.setAttribute('data-field', name);
    const entry = { fields, removed: false };
    const row = el('fieldset', { class: 'citation-fields' }, el('legend', {}, 'Source citation'), ...Object.entries(fields).map(([name, input]) => el('label', {}, ({ uri: 'Source URI', sha256: 'Expected SHA-256 (optional)' })[name] ?? name, input)), button('Remove citation', () => { entry.removed = true; row.hidden = true; edited(); }));
    entry.row = row; rows.push(entry); container.append(row);
  };
  const recovered = state.recovery?.form.fields.citations;
  (recovered?.length ? recovered.map(item => item.values) : sources).forEach(add);
  if (recovered) recovered.forEach((item, index) => { if (rows[index] && item.removed) { rows[index].removed = true; rows[index].row.hidden = true; } });
  return { node: el('details', { class: 'section', open: sources.length > 0 }, el('summary', {}, 'Sources and evidence boundaries'), el('p', { class: 'minor' }, 'Keep the source role, revision and exact locator with the interpretation they support. Local paths are relative to this Atlas.'), container, button('Add citation', () => { add({}); edited(); })), values: () => rows.filter(row => !row.removed).map(({ fields }) => Object.fromEntries(Object.entries(fields).filter(([name, input]) => name === 'uri' || input.value.trim()).map(([name, input]) => [name, input.value.trim()]))) };
}
async function editFacet(facet) {
  const files = await formCapture('facet', { id: facet.id, tree: facet.tree, record: facet });
  const file = files.files.find(item => item.path === facet.path);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(file?.content ?? '');
  if (!match) throw new Error('Repair the Facet record in Edit records first.');
  const header = JSON.parse(match[1]);
  const title = el('input', { value: facet.title }), body = el('textarea', { value: facet.body }), uncertainty = el('textarea', { value: facet.uncertainty ?? '', class: 'short-text' });
  const host = el('select', {}, ...[...atlas().points.filter(item => item.tree === facet.tree).map(item => ({ ...item, kind: 'point' })), ...atlas().branches.filter(item => item.tree === facet.tree).map(item => ({ ...item, kind: 'branch' }))].map(item => el('option', { value: `${item.kind}:${item.id}`, selected: header.on[item.kind] === item.id }, `${item.kind}: ${item.title}`)));
  const via = el('select', {}, ...atlas().trees.filter(item => item.id !== facet.tree).map(item => el('option', { value: item.id, selected: item.id === facet.via }, item.title)));
  const targets = el('div'); let targetInputs = [];
  const populate = () => {
    const tree = treeById(via.value);
    const records = [{ kind: 'tree', id: tree.id, title: `Whole account: ${tree.title}` }, ...atlas().points.filter(item => item.tree === via.value).map(item => ({ ...item, kind: 'point' })), ...atlas().branches.filter(item => item.tree === via.value).map(item => ({ ...item, kind: 'branch' }))];
    targetInputs = records.map(item => ({ item, input: el('input', { type: 'checkbox', checked: facet.via === via.value && facet.targets.some(target => target[item.kind] === item.id) }) }));
    targets.replaceChildren(...targetInputs.map(({ item, input }) => el('label', {}, input, `${item.kind}: ${item.title}`)));
  };
  via.addEventListener('change', populate); populate();
  const citations = citationEditor(header.sources), reason = el('input', { value: `Revise ${facet.title}` });
  editDialog('Edit Facet', [el('label', {}, 'Title', title), el('label', {}, 'Host in this Tree', host), el('label', {}, 'Through another Tree', via), section('Relevant targets', targets), el('label', {}, 'Why this interpretation matters', body), el('label', {}, 'Uncertainty', uncertainty), citations.node, el('label', {}, 'Reason', reason), button('Save and review', async () => {
    const [kind, id] = host.value.split(':'); header.on = { [kind]: id }; header.via = via.value; header.targets = targetInputs.filter(item => item.input.checked).map(({ item }) => ({ [item.kind]: item.id }));
    header.sources = citations.values(); if (uncertainty.value.trim()) header.uncertainty = uncertainty.value; else delete header.uncertainty;
    await saveForReview(files.identity, [{ path: facet.path, content: recordText(header, title.value, body.value) }], reason.value);
  }, { class: 'primary' })]);
}
async function saveStructure(request) {
  const editor = state.editor; if (!editor || editor.saving) return;
  editor.saving = true; const version = editor.version;
  try {
    const draft = await api('structure', request);
    if (state.editor !== editor) return;
    if (version !== editor.version) { notice('Draft saved. Newer typing remains in this form.'); return; }
    editor.dirty = false; editor.saving = false; await clearWorkingCopy(editor); reviewDraft(draft);
  } finally { editor.saving = false; }
}
function parentChoices(tree, selected) {
  return el('select', {}, ...[...atlas().points.filter(item => item.tree === tree).map(item => ({ ...item, kind: 'point' })), ...atlas().branches.filter(item => item.tree === tree).map(item => ({ ...item, kind: 'branch' }))].map(item => el('option', { value: `${item.kind}:${item.id}`, selected: item.id === selected }, `${item.kind}: ${item.title}`)));
}
async function branchForm(record) {
  const files = await formCapture('branch', { record });
  const tree = record?.tree ?? state.tree; if (!tree) throw new Error('Create a Tree first.');
  const id = el('input', { value: record?.id ?? '', disabled: Boolean(record) }), title = el('input', { value: record?.title ?? '' }), parent = parentChoices(tree, treeById(tree).base), reason = el('input', { value: record ? `Revise ${record.title}` : 'Group related explanations' });
  const members = el('div'); let choices = [];
  const populate = () => { const [kind, id] = parent.value.split(':'); choices = outlineChildren(treeById(tree), kind, id).map(item => { const childKind = item.point ? 'point' : 'branch', childId = item.point ?? item.branch; return { kind: childKind, id: childId, input: el('input', { type: 'checkbox' }) }; }); members.replaceChildren(...choices.map(item => el('label', {}, item.input, (item.kind === 'point' ? pointById(item.id) : branchById(tree, item.id))?.title))); };
  parent.addEventListener('change', populate); populate();
  recordForm(record ? 'Edit Branch' : 'New Branch', [['Stable ID', id], ['Label', title], ...(!record ? [['Place beneath', parent], ['Group existing detail', members]] : []), ['Reason', reason]], async () => {
    const [kind, parentId] = parent.value.split(':');
    await saveStructure({ baseline: files.identity, operation: 'branch', tree, id: id.value, title: title.value, create: !record, members: choices.filter(item => item.input.checked).map(({ kind, id }) => ({ kind, id })), parent: { kind, id: parentId }, reason: reason.value });
  });
}
async function positionRecord(record, kind) {
  const files = await formCapture('position', { record, recordKind: kind });
  const parent = parentChoices(record.tree, record.ancestors?.at(-1)?.id ?? treeById(record.tree).base), before = el('select'), reason = el('input', { value: `Change the position of ${record.title}` });
  const populate = () => { const [parentKind, id] = parent.value.split(':'); before.replaceChildren(el('option', { value: '' }, 'Last in this group'), ...outlineChildren(treeById(record.tree), parentKind, id).filter(item => item[kind] !== record.id).map(item => { const childKind = item.point ? 'point' : 'branch', childId = item.point ?? item.branch; return el('option', { value: `${childKind}:${childId}` }, `Before ${(childKind === 'point' ? pointById(childId) : branchById(record.tree, childId))?.title}`); })); };
  parent.addEventListener('change', populate); populate();
  const cleanup = el('input', { type: 'checkbox' });
  recordForm('Change position', [['Develop beneath', parent], ['Position', before], ['Remove Branches left empty and their attached Facets', cleanup], ['Reason', reason]], async () => {
    const [parentKind, id] = parent.value.split(':'), [beforeKind, beforeId] = before.value.split(':');
    await saveStructure({ baseline: files.identity, operation: 'place', tree: record.tree, id: record.id, kind, cleanupEmptyBranches: cleanup.checked, parent: { kind: parentKind, id }, ...(beforeId ? { before: { kind: beforeKind, id: beforeId } } : {}), reason: reason.value });
  });
}
async function removePoint(record) {
  const files = await formCapture('remove', { record });
  const destination = el('select', {}, el('option', { value: '' }, 'Remove with no surviving destination'), ...atlas().points.filter(item => item.id !== record.id).map(item => el('option', { value: item.id }, `${treeById(item.tree).title}: ${item.title}`)));
  const body = el('textarea'), reason = el('textarea', { class: 'short-text' });
  const populate = () => { body.value = pointById(destination.value)?.body ?? ''; body.disabled = !destination.value; };
  destination.addEventListener('change', populate); populate();
  const cleanup = el('input', { type: 'checkbox' });
  editDialog('Remove or consolidate Point', [el('p', { class: 'uncertainty' }, 'The review will show the removed Point, promoted children, affected Facets and citations. Read and rewrite the surviving explanation if you are consolidating; naming a destination does not preserve meaning by itself.'), el('label', {}, 'Surviving destination', destination), el('label', {}, 'Complete surviving explanation', body), el('label', {}, 'Why this material is removed or how its meaning survives', reason), el('label', {}, cleanup, 'Remove Branches left empty and their attached Facets'), button('Prepare removal for review', () => saveStructure({ baseline: files.identity, operation: 'remove', tree: record.tree, id: record.id, cleanupEmptyBranches: cleanup.checked, reason: reason.value, ...(destination.value ? { destination: destination.value, destinationBody: body.value } : {}) }), { class: 'primary' })]);
}
async function styleDialog() {
  const available = publication || state.preview ? { current: atlas()?.style, styles: [] } : await api('styles');
  const current = available.current;
  if (!state.data.editable) { openDialog('Atlas style', current ? el('div', {}, el('h3', {}, current.title), el('p', { class: 'minor' }, `${current.id} · revision ${current.revision}`), current.html ? prose(current.html) : el('pre', { class: 'source-text' }, current.body)) : el('p', {}, 'The style was not included in this publication.')); return; }
  const files = await formCapture('style');
  const picker = el('select', {}, el('option', { value: '' }, 'Revise the captured style'), ...available.styles.map(item => el('option', { value: item.id }, item.title)));
  const content = el('textarea', { value: files.files.find(item => item.path === current?.path)?.content ?? '' });
  const explanation = el('div'); const reason = el('input', { value: 'Revise the Atlas authoring style' });
  const definitions = new Map([['', content.value]]);
  let choice = '';
  const show = () => {
    definitions.set(choice, content.value);
    choice = picker.value;
    const selected = available.styles.find(item => item.id === choice);
    if (!definitions.has(choice)) definitions.set(choice, selected?.content ?? '');
    content.value = definitions.get(choice);
    explanation.replaceChildren(selected ? prose(selected.html) : el('p', { class: 'minor' }, 'Edit the captured style, including its revision, then review the exact change.'));
  };
  picker.addEventListener('change', show); show();
  editDialog('Atlas style', [el('h3', {}, current?.title ?? 'Choose an Atlas style'), el('p', { class: 'minor' }, current ? `${current.id} · revision ${current.revision}. This captured guidance describes how the account is organized.` : 'This account predates explicit styles. Adopting one is a reviewed change.'), ...(current ? [prose(current.html)] : []), el('details', { class: 'section', open: !current }, el('summary', {}, 'Revise or replace style'), el('p', { class: 'minor' }, 'A style change takes effect only after its draft is reviewed and applied.'), el('label', {}, 'Style to adopt or revise', picker), explanation, el('details', {}, el('summary', {}, 'Edit captured style definition'), content), el('label', {}, 'Reason for the style change', reason), button('Prepare explicit style change', async () => {
    const editor = state.editor; if (!editor || editor.saving) return; editor.saving = true; const version = editor.version;
    try { const draft = await api('style', { baseline: files.identity, styleContent: content.value, reason: reason.value }); if (state.editor !== editor) return; if (version !== editor.version) { notice('Style draft saved. Newer typing remains.'); return; } editor.dirty = false; editor.saving = false; await clearWorkingCopy(editor); reviewDraft(draft); } finally { editor.saving = false; }
  }, { class: 'primary' }))]);
}

async function editPoint(point) {
  const files = await formCapture('point', { id: point.id, tree: point.tree, record: point });
  const file = files.files.find(item => item.path === point.path);
  if (!file) throw new Error('This Point moved or was removed. Refresh the Atlas.');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(file.content);
  if (!match) throw new Error('Use Edit records to repair this Point.');
  const header = JSON.parse(match[1]);
  if (header.id !== point.id) throw new Error('This Point changed identity. Refresh the Atlas.');
  const freshTitle = /^# (.*)(?:\r?\n|$)/u.exec(match[2])?.[1];
  if (!freshTitle) throw new Error('Use Edit records to repair this Point title.');
  const title = el('input', { value: freshTitle, required: true });
  const explanation = el('textarea', { value: match[2].replace(/^# .*(?:\r?\n|$)/u, '').replace(/^\s*\n/u, '') });
  const uncertainty = el('textarea', { value: header.uncertainty ?? '', style: 'min-height:70px' });
  const type = el('select', {}, ...['untyped', 'decision', 'observation'].map(value => el('option', { value, selected: value === (header.type ?? 'untyped') }, value)));
  const standing = el('select', {}, ...['open', 'proposed', 'selected', 'rejected', 'superseded'].map(value => el('option', { value, selected: value === header.status }, value)));
  const observedAt = el('input', { value: header.observedAt ?? '', placeholder: '2026-09-29' });
  const standingLabel = el('label', {}, 'Decision status', standing), observedLabel = el('label', {}, 'Observed at', observedAt);
  const updateType = () => { standingLabel.hidden = type.value !== 'decision'; observedLabel.hidden = type.value !== 'observation'; }; type.addEventListener('change', updateType); updateType();
  const reason = el('input', { value: `Revise ${point.title}` });
  const sourceVersions = sourceVersionControls(header.sources ?? []);
  const citations = citationEditor(header.sources);
  editDialog('Edit Point', [el('label', {}, 'Title', title), el('label', {}, 'Explanation', explanation), el('label', {}, 'Point Type', type), standingLabel, observedLabel, el('label', {}, 'Uncertainty', uncertainty), el('label', {}, 'Reason for this change', reason), citations.node, sourceVersions.node,
    el('div', { class: 'draft-actions' }, button('Save and review', async () => {
      header.sources = citations.values();
      delete header.type; delete header.status; delete header.observedAt;
      if (type.value !== 'untyped') header.type = type.value;
      if (type.value === 'decision') header.status = standing.value;
      if (type.value === 'observation') header.observedAt = observedAt.value;
      if (uncertainty.value.trim()) header.uncertainty = uncertainty.value; else delete header.uncertainty;
      await saveForReview(files.identity, [{ path: point.path, content: `---\n${JSON.stringify(header)}\n---\n# ${title.value}\n\n${explanation.value.trim()}\n` }], reason.value, undefined, sourceVersions.selected());
    }, { class: 'primary' }))]);
}
async function editRecords(id) {
  const saved = id ? await api(`drafts/${id}`) : null;
  const captured = state.recovery?.form.context?.captured ?? (saved ? { identity: saved.plan.baseline.identity, files: saved.plan.candidate.files } : await api('files'));
  state.formContext = { kind: 'records', draftId: id, draftRevision: state.recovery?.form.context?.draftRevision ?? saved?.revision, captured };
  const files = new Map(captured.files.map(file => [file.path, file.content]));
  const rawFiles = new Map([
    ...captured.files.filter(file => file.rawBase64 !== undefined).map(file => [file.path, file.rawBase64]),
    ...(saved?.plan.changes ?? []).filter(change => change.beforeBase64 !== undefined).map(change => [change.path, change.beforeBase64]),
  ]);
  const changes = new Map(state.recovery?.form.fields.changes ?? saved?.plan.changes.map(change => [change.path, change.after]) ?? []);
  const paths = new Set([...files.keys(), ...changes.keys()]);
  const picker = el('select', { class: 'record-picker', 'aria-label': 'Record' }, ...[...paths].sort().map(file => el('option', { value: file }, file)));
  const text = el('textarea', { 'aria-label': 'Record content' });
  const deleted = el('input', { type: 'checkbox' });
  const repair = el('input', { type: 'checkbox' });
  const rawBytes = el('pre', { class: 'source-text' });
  const rawNotice = el('section', { hidden: true, class: 'uncertainty' }, el('p', {}, 'This record contains bytes that are not valid UTF-8. The original bytes remain unchanged until you explicitly replace or delete this record.'), el('details', {}, el('summary', {}, 'Original bytes (Base64)'), rawBytes), el('label', {}, repair, 'Replace unreadable bytes with UTF-8 text'));
  const reason = el('input', { value: saved?.plan.reason ?? 'Revise Atlas records' });
  const styleRepair = el('input', { type: 'checkbox' });
  const candidate = saved?.plan.candidate.atlas ?? atlas();
  const sourceVersions = sourceVersionControls([...(candidate?.points ?? []), ...(candidate?.facets ?? [])].flatMap(record => record.sources ?? []), saved?.plan.sourcePreconditions ?? [], saved);
  let current;
  const store = () => { if (current) { if (rawFiles.has(current) && !repair.checked && !deleted.checked) changes.delete(current); else changes.set(current, deleted.checked ? null : text.value); } };
  const load = () => {
    current = picker.value; const value = changes.has(current) ? changes.get(current) : files.get(current);
    const raw = rawFiles.has(current); rawNotice.hidden = !raw; rawBytes.textContent = rawFiles.get(current) ?? '';
    text.value = value ?? ''; deleted.checked = value === null && (!raw || changes.has(current));
    repair.checked = raw && changes.has(current) && value !== null;
    text.disabled = deleted.checked || raw && !repair.checked;
  };
  picker.addEventListener('change', () => { store(); load(); });
  deleted.addEventListener('change', () => { text.disabled = deleted.checked || rawFiles.has(current) && !repair.checked; });
  repair.addEventListener('change', () => { text.disabled = deleted.checked || !repair.checked; });
  load();
  const newPath = el('input', { placeholder: 'trees/example/points/new-point.md', 'aria-label': 'New record path' });
  editDialog('Edit records', [el('p', { class: 'minor' }, 'Edit Tree structure, Facets, Checks, or malformed records. Save a draft to review the complete result.'), ...(saved?.review || saved?.checkRuns?.length ? [el('p', { class: 'uncertainty' }, 'Saving edits creates a new candidate. Earlier reasoning and Check evidence remain in revision history and do not approve the revised candidate.')] : []), picker, rawNotice, text, el('label', {}, deleted, 'Delete this record'), el('div', { class: 'edit-actions' }, newPath, button('Add record', () => {
    store(); if (!newPath.value.trim() || paths.has(newPath.value)) throw new Error('Use a new record path.');
    paths.add(newPath.value); changes.set(newPath.value, ''); picker.append(el('option', { value: newPath.value }, newPath.value)); picker.value = newPath.value; load(); edited();
  })), el('label', {}, 'Reason for this change', reason), el('label', {}, styleRepair, 'Explicitly restore or change the selected Atlas style'), sourceVersions.node, el('div', { class: 'draft-actions' }, button('Save and review', async () => { store(); await saveForReview(captured.identity, [...changes].map(([path, content]) => ({ path, content })), reason.value, id, sourceVersions.selected(), styleRepair.checked); }, { class: 'primary' }), button('All drafts', drafts))], saved);
  if (state.editor) state.editor.capture = () => { store(); return { changes: [...changes] }; };
}
function recordForm(title, controls, action) {
  editDialog(title, [...controls.map(([label, control]) => el('label', {}, label, control)), el('div', { class: 'draft-actions' }, button('Save and review', action, { class: 'primary' }))]);
}
const recordText = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body.trim()}\n`;
async function newTree() {
  if (!atlas()) throw new Error('Repair the Atlas records before adding a Tree.');
  const files = await formCapture('new-tree');
  const id = el('input', { placeholder: 'product' }), title = el('input'), scope = el('input'), body = el('textarea');
  recordForm('New Tree', [['Stable ID', id], ['Title', title], ['Subject and scope', scope], ['Base Point explanation', body]], async () => {
    const manifest = JSON.parse(files.files.find(file => file.path === 'atlas.json').content);
    const folder = `trees/${id.value}`; const base = `${id.value}-base`;
    manifest.trees.push(folder);
    await saveForReview(files.identity, [
      { path: 'atlas.json', content: JSON.stringify(manifest, null, 2) + '\n' },
      { path: `${folder}/tree.json`, content: JSON.stringify({ id: id.value, title: title.value, scope: scope.value, base, children: [] }, null, 2) + '\n' },
      { path: `${folder}/points/base.md`, content: recordText({ id: base }, title.value, body.value) },
    ], `Create ${title.value}`);
  });
}
async function newPoint() {
  if (!atlas()) throw new Error('Repair the Atlas records before adding a Point.');
  if (!atlas().trees.length) return newTree();
  const files = await formCapture('new-point');
  const treeSelect = el('select', {}, ...atlas().trees.map(tree => el('option', { value: tree.id, selected: tree.id === state.tree }, tree.title)));
  const parent = el('select');
  const populate = () => {
    const tree = treeById(treeSelect.value);
    parent.replaceChildren(el('option', { value: `point:${tree.base}` }, `Base: ${pointById(tree.base).title}`), ...atlas().points.filter(point => point.tree === tree.id && point.id !== tree.base).map(point => el('option', { value: `point:${point.id}` }, point.title)), ...atlas().branches.filter(branch => branch.tree === tree.id).map(branch => el('option', { value: `branch:${branch.id}` }, `Branch: ${branch.title}`)));
  };
  treeSelect.addEventListener('change', populate); populate();
  const id = el('input'), title = el('input'), body = el('textarea');
  recordForm('New Point', [['Owning Tree', treeSelect], ['Develop beneath', parent], ['Stable ID', id], ['Title', title], ['Explanation', body]], async () => {
    const tree = treeById(treeSelect.value); const outline = JSON.parse(files.files.find(file => file.path === tree.path).content);
    const [kind, parentId] = parent.value.split(':');
    const find = children => { for (const child of children) { if (child[kind] === parentId) return child; const nested = find(child.children ?? []); if (nested) return nested; } };
    const host = parentId === outline.base ? outline : find(outline.children);
    (host.children ??= []).push({ point: id.value });
    const folder = tree.path.slice(0, -'/tree.json'.length);
    await saveForReview(files.identity, [{ path: tree.path, content: JSON.stringify(outline, null, 2) + '\n' }, { path: `${folder}/points/${id.value}.md`, content: recordText({ id: id.value }, title.value, body.value) }], `Add ${title.value}`);
  });
}
async function newFacet(point, hostKind = 'point') {
  const others = atlas().trees.filter(tree => tree.id !== point.tree);
  if (!others.length) throw new Error('A Facet needs another Tree.');
  const files = await formCapture('new-facet', { record: point, hostKind });
  const via = el('select', {}, ...others.map(tree => el('option', { value: tree.id }, tree.title)));
  const target = el('select');
  const populate = () => target.replaceChildren(...atlas().points.filter(item => item.tree === via.value).map(item => el('option', { value: item.id }, item.title)));
  via.addEventListener('change', populate); populate();
  const id = el('input'), title = el('input'), body = el('textarea');
  recordForm('Attach a Facet', [['Through this Tree', via], ['Relevant Point', target], ['Stable ID', id], ['Title', title], ['Why the connection matters', body]], async () => {
    const folder = treeById(point.tree).path.slice(0, -'/tree.json'.length);
    if (atlas().facets.some(facet => facet.tree === point.tree && facet.id === id.value) || files.files.some(file => file.path === `${folder}/facets/${id.value}.md`)) throw new Error('This Tree already has that Facet. Choose a new ID or use Edit records.');
    await saveForReview(files.identity, [{ path: `${folder}/facets/${id.value}.md`, content: recordText({ id: id.value, on: { [hostKind]: point.id }, via: via.value, targets: [{ point: target.value }] }, title.value, body.value) }], `Connect ${point.title}`);
  });
}

$('#tree-select').addEventListener('change', () => { setReadingFocus(false); state.tree = $('#tree-select').value; state.selected = null; state.history = []; $('#page').hidden = true; $('#filter-text').value = ''; renderTree(); history.replaceState({}, '', `${location.pathname}?tree=${encodeURIComponent(state.tree)}`); });
$('#filter-text').addEventListener('input', renderTree); $('#filter-type').addEventListener('change', renderTree);
$('#clear-filters').addEventListener('click', () => { $('#filter-text').value = ''; $('#filter-type').value = ''; renderTree(); });
$('#fit').addEventListener('click', fit); $('#zoom-in').addEventListener('click', () => zoom(1.2)); $('#zoom-out').addEventListener('click', () => zoom(1 / 1.2));
$('#close-page').addEventListener('click', () => { setReadingFocus(false); $('#page').hidden = true; state.selected = null; history.replaceState({}, '', `${location.pathname}?tree=${encodeURIComponent(state.tree)}`); renderTree(); });
$('#back').addEventListener('click', () => history.back());
$('#refresh').addEventListener('click', () => run(() => refresh())); $('#workspace').addEventListener('click', () => run(drafts)); $('#close-drafts').addEventListener('click', closeDialog);
$('#draft-content').addEventListener('input', edited);
$('#draft-content').addEventListener('change', event => { if (!event.target.classList.contains('record-picker')) edited(); });
$('#draft-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
$('#keep-editing').addEventListener('click', () => { state.pendingLeave = null; $('#unsaved-warning').hidden = true; });
$('#discard-edits').addEventListener('click', () => { const action = state.pendingLeave; run(() => clearWorkingCopy(state.editor)); state.editor = null; state.pendingLeave = null; $('#unsaved-warning').hidden = true; action?.(); });
$('#create-atlas').addEventListener('click', () => run(initializeAtlas));
$('#create-tree').addEventListener('click', () => run(newTree));
$('#checks').addEventListener('click', () => run(showChecks));
$('#search-atlas').addEventListener('click', () => run(searchDialog));
$('#read-overview').addEventListener('click', () => { const tree = treeById(state.tree); if (tree) select('point', tree.base, tree.id); });
$('#review-sources').addEventListener('click', () => run(sourceReviewDialog));
$('#reading-focus').addEventListener('click', () => setReadingFocus(!state.readingFocus));
$('#connect-agent').addEventListener('click', () => run(connectAgent));
$('#export-site').addEventListener('click', () => run(exportSite));
$('#atlas-style').addEventListener('click', () => run(styleDialog));
$('#exit-preview').addEventListener('click', () => run(() => exitPreview()));
window.addEventListener('beforeunload', event => {
  if (!state.editor?.dirty && !state.editor?.saving) return;
  run(() => persistWorkingCopy(state.editor));
  event.preventDefault(); event.returnValue = '';
});
let drag;
$('#canvas').addEventListener('pointerdown', event => { if (event.target.closest('button')) return; drag = { x: event.clientX, y: event.clientY, startX: state.x, startY: state.y }; $('#canvas').setPointerCapture(event.pointerId); });
$('#canvas').addEventListener('pointermove', event => { if (!drag) return; state.x = drag.startX + event.clientX - drag.x; state.y = drag.startY + event.clientY - drag.y; transform(); });
$('#canvas').addEventListener('pointerup', () => { drag = null; }); $('#canvas').addEventListener('pointercancel', () => { drag = null; });
$('#canvas').addEventListener('wheel', event => { event.preventDefault(); if (event.ctrlKey || event.metaKey) zoom(event.deltaY < 0 ? 1.07 : 1 / 1.07); else { state.x -= event.deltaX; state.y -= event.deltaY; transform(); } }, { passive: false });
$('#canvas').addEventListener('keydown', event => { if (event.target !== $('#canvas')) return; const offsets = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }; if (offsets[event.key]) { event.preventDefault(); state.x += offsets[event.key][0]; state.y += offsets[event.key][1]; transform(); } });
window.addEventListener('resize', () => { if (atlas()) renderTree(); });
window.addEventListener('popstate', event => run(() => restoreReader(event.state)));
$('#page').addEventListener('scroll', () => { if (state.selected && !state.restoring) rememberReader(); }, { passive: true });
document.addEventListener?.('click', event => {
  const anchor = event.target.closest?.('a'); if (!anchor || anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const url = new URL(anchor.href, location.href); if (url.origin !== location.origin || url.pathname !== location.pathname) return;
  const params = url.searchParams;
  if (!params.has('point') && !params.has('facet') && !params.has('branch')) return;
  event.preventDefault(); run(async () => {
    const tree = params.get('tree') ?? state.tree;
    if (params.has('source')) { const owner = params.has('facet') ? { kind: 'facet', id: params.get('facet'), tree } : { kind: 'point', id: params.get('point'), tree }; const record = owner.kind === 'facet' ? atlas().facets.find(item => item.tree === tree && item.id === owner.id) : pointById(owner.id); const index = Number(params.get('sourceIndex')); const source = record?.sources?.[index]; if (source?.uri === params.get('source')) await showSource(source, owner, index, url.hash.slice(1) || undefined); }
    else if (params.has('facet')) showFacet(atlas().facets.find(item => item.tree === tree && item.id === params.get('facet')));
    else navigateTo(params.has('branch') ? 'branch' : 'point', params.get('branch') ?? params.get('point'), tree);
    if (url.hash) requestAnimationFrame(() => { try { document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ block: 'start' }); } catch {} });
  });
});
await run(() => refresh(true));
