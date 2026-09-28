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
const section = (title, ...children) => el('section', { class: 'section' }, el('h3', {}, title), ...children);
const facetHost = (facet, kind, id, tree) => facet.tree === tree && facet.on[kind] === id;

async function refresh(initial = false) {
  state.data = publication ? await (await fetch('./data.json')).json() : await api('view');
  $('#atlas-title').textContent = atlas()?.title ?? (state.data.canInitialize ? 'New Atlas' : 'Atlas needs repair');
  $('#workspace').hidden = !state.data.editable;
  $('#connect-agent').hidden = !state.data.editable;
  $('#export-site').hidden = !state.data.canExport;
  $('#create-atlas').hidden = !state.data.canInitialize;
  $('#create-tree').hidden = !state.data.editable || !atlas() || atlas().trees.length > 0;
  $('#checks').hidden = !state.data.editable;
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
  if (initial && location.hash) requestAnimationFrame(() => {
    try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: 'start' }); } catch { /* Malformed authored fragments remain inert. */ }
  });
}

function renderTree() {
  const tree = treeById(state.tree);
  $('#tree-select').value = tree?.id ?? '';
  $('#tree-title').textContent = tree?.title ?? 'No Trees yet';
  $('#tree-scope').textContent = tree?.scope ?? 'Create a Tree for a subject you want to explain.';
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
  requestAnimationFrame(frameTree);
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
function select(kind, id, tree, remember = true) {
  if (remember && state.selected) state.history.push({ ...state.selected });
  if (tree !== state.tree) { $('#filter-text').value = ''; $('#filter-type').value = ''; }
  state.tree = tree; state.selected = { kind, id, tree };
  const params = new URLSearchParams({ tree }); params.set(kind, id);
  history[remember ? 'pushState' : 'replaceState']({}, '', `${location.pathname}?${params}`);
  $('#page').hidden = false; renderTree(); renderPage(); $('#page').scrollTop = 0;
}
function renderPage() {
  const selected = state.selected; if (!selected) return;
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
    if (state.data.editable) content.append(el('div', { class: 'edit-actions' }, button('Edit Point', () => editPoint(record), { class: 'quiet' }), button('Attach a Facet', () => newFacet(record), { class: 'quiet' })));
    if (record.sources?.length) content.append(section('Sources', sourceList(record.sources)));
  } else {
    content.append(el('p', { class: 'eyebrow' }, 'BRANCH'), el('h2', {}, record.title));
    const children = el('div', { class: 'facet-targets' });
    for (const child of record.children) {
      const kind = child.point ? 'point' : 'branch'; const id = child.point ?? child.branch;
      const target = kind === 'point' ? pointById(id) : branchById(tree.id, id);
      children.append(button(target?.title ?? 'Not published', () => select(kind, id, tree.id)));
    }
    content.append(children);
  }
  const attached = atlas().facets.filter(facet => facetHost(facet, selected.kind, selected.id, tree.id));
  if (attached.length) content.append(section('Through another Tree', ...attached.map(facetCard)));
  if (selected.kind === 'point') {
    const surrounding = atlas().facets.filter(facet => facet.tree === tree.id && facet.on.branch && (record.ancestors ?? []).some(a => a.kind === 'branch' && a.id === facet.on.branch));
    if (surrounding.length) content.append(section('On the surrounding Branch', ...surrounding.map(facetCard)));
  }
  const incoming = atlas().facets.filter(facet => facet.via === tree.id && facet.targets.some(target => target[selected.kind] === selected.id || (selected.kind === 'point' && selected.id === tree.base && target.tree === tree.id)));
  if (incoming.length) content.append(section('Referenced by other accounts', ...incoming.map(facet => button(`${treeById(facet.tree)?.title ?? facet.tree}: ${facet.title}`, () => select(facet.on.point ? 'point' : 'branch', facet.on.point ?? facet.on.branch, facet.tree), { class: 'quiet' }))));
  content.append(el('p', { class: 'minor section' }, `Reference: ${record.tree}/${record.id}`));
}
function facetCard(facet) {
  const card = el('article', { class: 'facet-card' }, el('h4', {}, facet.title), prose(facet.html));
  if (facet.uncertainty) card.append(el('p', { class: 'minor' }, facet.uncertainty));
  const targets = el('div', { class: 'facet-targets' });
  for (const target of facet.targets) {
    const via = treeById(facet.via);
    const record = target.point ? pointById(target.point) : target.branch ? branchById(facet.via, target.branch) : via;
    const available = via && record && record.publicationAvailable !== false;
    targets.append(button(available ? `${via.title} → ${record.title}` : `${facet.via}/${target.point ?? target.branch ?? target.tree} · not published`, () => select(target.branch ? 'branch' : 'point', target.point ?? target.branch ?? via.base, facet.via), { disabled: !available }));
  }
  card.append(targets);
  if (facet.sources?.length) card.append(sourceList(facet.sources));
  return card;
}
function sourceList(sources) {
  return el('div', { class: 'source-list' }, ...sources.map(source => {
    const info = el('div', { class: 'source-info' }, source.title ?? source.uri, el('small', {}, [source.role, source.revision, source.locator].filter(Boolean).join(' · ')));
    const row = el('div', { class: 'source-row' }, info);
    if (/^https?:\/\//i.test(source.uri)) row.append(el('a', { href: source.uri, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗'));
    else if (publication && source.publishedPath) row.append(el('a', { href: source.publishedPath, target: '_blank', rel: 'noopener noreferrer' }, 'Read'));
    else if (publication) info.append(el('small', {}, 'Source not included'));
    else row.append(button('Read', async () => {
      const result = await api('source', { source });
      const body = result.status === 'ready' ? result.content : `${result.status}: ${result.message}`;
      const existing = row.querySelector('details'); if (existing) existing.remove();
      row.append(el('details', { open: true }, el('summary', {}, result.status === 'ready' ? 'Source content' : 'Source unavailable'), el('pre', { class: 'source-text' }, body)));
    }));
    return row;
  }));
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
  return showDialog(title, children, { dirty: false, saving: false, version: 0, draftId: draft?.id, revision: draft?.revision });
}
function edited() {
  if (!state.editor) return;
  state.editor.dirty = true; state.editor.version++;
}
function closeDialog() {
  if (leaveEditor(closeDialog)) { state.review = null; $('#draft-dialog').close(); }
}
async function drafts() {
  const [saved, transactions] = await Promise.all([api('drafts'), api('transactions')]);
  const actions = el('div', { class: 'draft-actions' }, button('New Point', newPoint, { class: 'primary' }), button('New Tree', newTree), button('Edit records', () => editRecords()));
  const entries = saved.map(draft => el('div', { class: 'draft-entry' }, el('h3', {}, draft.reason), el('p', { class: 'minor' }, `${draft.status} · ${new Date(draft.updatedAt).toLocaleString()}`), el('div', { class: 'draft-actions' }, button('Review', async () => reviewDraft(await api(`drafts/${draft.id}`))), button('Continue editing', () => editRecords(draft.id)), button('Discard', async () => { await api('drafts', { id: draft.id, expectedRevision: draft.revision }, 'DELETE'); await drafts(); }))));
  const interrupted = transactions.filter(item => !['complete', 'rolled-back'].includes(item.phase));
  const recovery = interrupted.map(item => el('div', { class: 'draft-entry' }, el('h3', {}, 'Interrupted change'), el('p', { class: 'minor' }, `${item.written?.length ?? 0} ${item.written?.length === 1 ? 'file' : 'files'} recorded as written. Recovery restores the original files after checking for later edits. It stops if an affected file has changed.`), button('Restore original files', async () => { const result = await api('recover', { id: item.id }); notice(result.baselineRestored ? 'Original Atlas restored.' : 'Affected files restored; other changes remain.'); await refresh(); await drafts(); })));
  openDialog('Drafts and recovery', actions, ...(entries.length ? entries : [el('p', { class: 'minor' }, 'No saved drafts.')]), ...recovery);
}
async function saveForReview(baseline, changes, reason, id) {
  const editor = state.editor;
  if (!editor || editor.saving) return;
  const version = editor.version;
  editor.saving = true;
  try {
    const draftId = editor.draftId ?? id;
    const draft = await api('drafts', { baseline, changes, reason, ...(draftId ? { id: draftId, expectedRevision: editor.revision } : {}) });
    if (state.editor !== editor) return;
    editor.draftId = draft.id; editor.revision = draft.revision;
    if (editor.version !== version) { notice('Draft saved. Your newer changes are still unsaved; save again before reviewing.'); return; }
    editor.dirty = false; editor.saving = false;
    reviewDraft(draft);
  } finally { editor.saving = false; }
}
async function initializeAtlas() {
  const baseline = state.data.identity;
  const id = el('input', { value: 'my-atlas' }), title = el('input', { value: 'My Atlas' });
  recordForm('Create Atlas', [['Stable ID', id], ['Title', title]], async () => {
    const editor = state.editor;
    if (!editor || editor.saving) return;
    const version = editor.version; editor.saving = true;
    try {
      const draft = await api('initialize', { baseline, id: id.value, title: title.value });
      if (state.editor !== editor) return;
      if (editor.version !== version) { notice('Creation draft saved in Drafts. Your newer form changes are still unsaved.'); return; }
      editor.dirty = false; editor.saving = false; reviewDraft(draft);
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
    el('p', { class: 'minor' }, 'Use a connected agent to review these Checks, record supporting evidence and inspect the results.'),
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
  const sourceRows = sources.map(uri => { const input = el('input', { type: 'checkbox' }); sourceInputs.set(uri, input); return el('label', {}, input, uri); });
  openDialog('Export site', el('p', {}, 'Choose the Trees and Points for a local static site. Select any source files to include below. The site will be saved at the destination shown here.'), el('p', { class: 'record-path' }, `Destination: ${available.output}`), ...rows,
    ...(sourceRows.length ? [section('Include source files', ...sourceRows)] : []), button('Preview selection', async () => {
      const trees = [...treeInputs].filter(([, input]) => input.checked).map(([id]) => id);
      const points = [...pointInputs].filter(([, item]) => item.input.checked && trees.includes(item.tree)).map(([id]) => id);
      const sources = [...sourceInputs].filter(([, input]) => input.checked).map(([uri]) => uri);
      const preview = await api('publication/prepare', { baseline: available.identity, trees, points, sources });
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
  showDialog('Review draft', [el('h3', {}, plan.reason), el('p', { class: 'minor' }, `${plan.changes.length} changed ${plan.changes.length === 1 ? 'file' : 'files'} · ${plan.status}. If the Atlas changes, review a new draft before applying.`), diagnostics,
    el('div', { class: 'draft-actions' }, button(plan.status === 'noop' ? 'Confirm no change' : 'Apply draft', async () => {
      const result = await api('apply', { id: draft.id, expectedRevision: draft.revision });
      if (result.status === 'interrupted') { notice(`Change interrupted: ${result.error.message}`); if (state.review === review) await drafts(); return; }
      notice(result.status === 'noop' ? 'No change needed.' : 'Draft applied.');
      if (state.review === review) { state.review = null; $('#draft-dialog').close(); }
      await refresh();
    }, { class: 'primary', disabled: plan.status === 'invalid' }), button('Continue editing', () => editRecords(draft.id)), button('All drafts', drafts)), ...details], null, review);
}
async function editPoint(point) {
  const files = await api('files');
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
  const standing = header.type === 'decision' ? el('select', {}, ...['open', 'proposed', 'selected', 'rejected', 'superseded'].map(value => el('option', { value, selected: value === header.status }, value))) : header.type === 'observation' ? el('input', { value: header.observedAt }) : null;
  const reason = el('input', { value: `Revise ${point.title}` });
  editDialog('Edit Point', [el('label', {}, 'Title', title), el('label', {}, 'Explanation', explanation), ...(standing ? [el('label', {}, header.type === 'decision' ? 'Decision status' : 'Observed at', standing)] : []), el('label', {}, 'Uncertainty', uncertainty), el('label', {}, 'Reason for this change', reason),
    el('div', { class: 'draft-actions' }, button('Save and review', async () => {
      if (header.type === 'decision') header.status = standing.value;
      if (header.type === 'observation') header.observedAt = standing.value;
      if (uncertainty.value.trim()) header.uncertainty = uncertainty.value; else delete header.uncertainty;
      await saveForReview(files.identity, [{ path: point.path, content: `---\n${JSON.stringify(header)}\n---\n# ${title.value}\n\n${explanation.value.trim()}\n` }], reason.value);
    }, { class: 'primary' }))]);
}
async function editRecords(id) {
  const saved = id ? await api(`drafts/${id}`) : null;
  const captured = saved ? { identity: saved.plan.baseline.identity, files: saved.plan.candidate.files } : await api('files');
  const files = new Map(captured.files.map(file => [file.path, file.content]));
  const rawFiles = new Map([
    ...captured.files.filter(file => file.rawBase64 !== undefined).map(file => [file.path, file.rawBase64]),
    ...(saved?.plan.changes ?? []).filter(change => change.beforeBase64 !== undefined).map(change => [change.path, change.beforeBase64]),
  ]);
  const changes = new Map(saved?.plan.changes.map(change => [change.path, change.after]) ?? []);
  const paths = new Set([...files.keys(), ...changes.keys()]);
  const picker = el('select', { class: 'record-picker', 'aria-label': 'Record' }, ...[...paths].sort().map(file => el('option', { value: file }, file)));
  const text = el('textarea', { 'aria-label': 'Record content' });
  const deleted = el('input', { type: 'checkbox' });
  const repair = el('input', { type: 'checkbox' });
  const rawBytes = el('pre', { class: 'source-text' });
  const rawNotice = el('section', { hidden: true, class: 'uncertainty' }, el('p', {}, 'This record contains bytes that are not valid UTF-8. The original bytes remain unchanged until you explicitly replace or delete this record.'), el('details', {}, el('summary', {}, 'Original bytes (Base64)'), rawBytes), el('label', {}, repair, 'Replace unreadable bytes with UTF-8 text'));
  const reason = el('input', { value: saved?.plan.reason ?? 'Revise Atlas records' });
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
  editDialog('Edit records', [el('p', { class: 'minor' }, 'Edit Tree structure, Facets, Checks, or malformed records. Save a draft to review the complete result.'), picker, rawNotice, text, el('label', {}, deleted, 'Delete this record'), el('div', { class: 'edit-actions' }, newPath, button('Add record', () => {
    store(); if (!newPath.value.trim() || paths.has(newPath.value)) throw new Error('Use a new record path.');
    paths.add(newPath.value); changes.set(newPath.value, ''); picker.append(el('option', { value: newPath.value }, newPath.value)); picker.value = newPath.value; load(); edited();
  })), el('label', {}, 'Reason for this change', reason), el('div', { class: 'draft-actions' }, button('Save and review', async () => { store(); await saveForReview(captured.identity, [...changes].map(([path, content]) => ({ path, content })), reason.value, id); }, { class: 'primary' }), button('All drafts', drafts))], saved);
}
function recordForm(title, controls, action) {
  editDialog(title, [...controls.map(([label, control]) => el('label', {}, label, control)), el('div', { class: 'draft-actions' }, button('Save and review', action, { class: 'primary' }))]);
}
const recordText = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body.trim()}\n`;
async function newTree() {
  if (!atlas()) throw new Error('Repair the Atlas records before adding a Tree.');
  const files = await api('files');
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
  const files = await api('files');
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
async function newFacet(point) {
  const others = atlas().trees.filter(tree => tree.id !== point.tree);
  if (!others.length) throw new Error('A Facet needs another Tree.');
  const files = await api('files');
  const via = el('select', {}, ...others.map(tree => el('option', { value: tree.id }, tree.title)));
  const target = el('select');
  const populate = () => target.replaceChildren(...atlas().points.filter(item => item.tree === via.value).map(item => el('option', { value: item.id }, item.title)));
  via.addEventListener('change', populate); populate();
  const id = el('input'), title = el('input'), body = el('textarea');
  recordForm('Attach a Facet', [['Through this Tree', via], ['Relevant Point', target], ['Stable ID', id], ['Title', title], ['Why the connection matters', body]], async () => {
    const folder = treeById(point.tree).path.slice(0, -'/tree.json'.length);
    if (atlas().facets.some(facet => facet.tree === point.tree && facet.id === id.value) || files.files.some(file => file.path === `${folder}/facets/${id.value}.md`)) throw new Error('This Tree already has that Facet. Choose a new ID or use Edit records.');
    await saveForReview(files.identity, [{ path: `${folder}/facets/${id.value}.md`, content: recordText({ id: id.value, on: { point: point.id }, via: via.value, targets: [{ point: target.value }] }, title.value, body.value) }], `Connect ${point.title}`);
  });
}

$('#tree-select').addEventListener('change', () => { state.tree = $('#tree-select').value; state.selected = null; state.history = []; $('#page').hidden = true; $('#filter-text').value = ''; renderTree(); history.replaceState({}, '', `${location.pathname}?tree=${encodeURIComponent(state.tree)}`); });
$('#filter-text').addEventListener('input', renderTree); $('#filter-type').addEventListener('change', renderTree);
$('#clear-filters').addEventListener('click', () => { $('#filter-text').value = ''; $('#filter-type').value = ''; renderTree(); });
$('#fit').addEventListener('click', fit); $('#zoom-in').addEventListener('click', () => zoom(1.2)); $('#zoom-out').addEventListener('click', () => zoom(1 / 1.2));
$('#close-page').addEventListener('click', () => { $('#page').hidden = true; state.selected = null; history.replaceState({}, '', `${location.pathname}?tree=${encodeURIComponent(state.tree)}`); renderTree(); });
$('#back').addEventListener('click', () => { const previous = state.history.pop(); if (previous) select(previous.kind, previous.id, previous.tree, false); });
$('#refresh').addEventListener('click', () => run(() => refresh())); $('#workspace').addEventListener('click', () => run(drafts)); $('#close-drafts').addEventListener('click', closeDialog);
$('#draft-content').addEventListener('input', edited);
$('#draft-content').addEventListener('change', event => { if (!event.target.classList.contains('record-picker')) edited(); });
$('#draft-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
$('#keep-editing').addEventListener('click', () => { state.pendingLeave = null; $('#unsaved-warning').hidden = true; });
$('#discard-edits').addEventListener('click', () => { const action = state.pendingLeave; state.editor = null; state.pendingLeave = null; $('#unsaved-warning').hidden = true; action?.(); });
$('#create-atlas').addEventListener('click', () => run(initializeAtlas));
$('#create-tree').addEventListener('click', () => run(newTree));
$('#checks').addEventListener('click', () => run(showChecks));
$('#connect-agent').addEventListener('click', () => run(connectAgent));
$('#export-site').addEventListener('click', () => run(exportSite));
window.addEventListener('beforeunload', event => {
  if (!state.editor?.dirty && !state.editor?.saving) return;
  event.preventDefault(); event.returnValue = '';
});
let drag;
$('#canvas').addEventListener('pointerdown', event => { if (event.target.closest('button')) return; drag = { x: event.clientX, y: event.clientY, startX: state.x, startY: state.y }; $('#canvas').setPointerCapture(event.pointerId); });
$('#canvas').addEventListener('pointermove', event => { if (!drag) return; state.x = drag.startX + event.clientX - drag.x; state.y = drag.startY + event.clientY - drag.y; transform(); });
$('#canvas').addEventListener('pointerup', () => { drag = null; }); $('#canvas').addEventListener('pointercancel', () => { drag = null; });
$('#canvas').addEventListener('wheel', event => { event.preventDefault(); if (event.ctrlKey || event.metaKey) zoom(event.deltaY < 0 ? 1.07 : 1 / 1.07); else { state.x -= event.deltaX; state.y -= event.deltaY; transform(); } }, { passive: false });
$('#canvas').addEventListener('keydown', event => { if (event.target !== $('#canvas')) return; const offsets = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }; if (offsets[event.key]) { event.preventDefault(); state.x += offsets[event.key][0]; state.y += offsets[event.key][1]; transform(); } });
window.addEventListener('resize', () => { if (atlas()) renderTree(); });
window.addEventListener('popstate', () => run(() => refresh(true)));
await run(() => refresh(true));
