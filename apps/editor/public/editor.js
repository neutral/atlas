const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const json = value => escape(JSON.stringify(value, null, 2));
const url = (kind, values = {}) => `/?${new URLSearchParams({ kind, ...values })}`;
const link = (kind, values, label, className = '') => `<a class="${className}" href="${escape(url(kind, values))}">${escape(label)}</a>`;
const detail = (title, value) => `<details><summary>${escape(title)}</summary><pre>${json(value)}</pre></details>`;
const limits = values => values?.length ? `<ul class="limits">${values.map(value => `<li>${escape(value)}</li>`).join('')}</ul>` : '';
const heading = (type, title, summary = '') => `<p class="eyebrow">${escape(type)}</p><h1>${escape(title)}</h1>${summary ? `<p class="summary">${escape(summary)}</p>` : ''}`;
const empty = text => `<p class="empty">${escape(text)}</p>`;
const button = (action, label, attributes = '', className = '') => `<button data-action="${action}" ${attributes} class="${className}">${escape(label)}</button>`;
const draftBuffers = new Map();
const contributionBuffers = new Map(), allBuffers = new Set();
let activeBuffer, renderedRoute = '', historyTransition = 0, restoringHistory = false, draftListSequence = 0;
let exportReview = null;
let snapshot, savedDrafts = [], draftIssues = [], prepared, latestRun, routeSequence = 0;
let token = sessionStorage.getItem('atlas-editor-token');
if (location.hash.startsWith('#token=')) {
  token = location.hash.slice(7);
  history.replaceState({}, '', `${location.pathname}${location.search}`);
  sessionStorage.setItem('atlas-editor-token', token);
}

function status(message, error = false, owner = null) {
  if (activeForeground !== null && owner !== activeForeground) return;
  $('#operation-status').textContent = message;
  $('#operation-status').classList.toggle('error', error);
}
let requestSequence = 0, activeForeground = null;
const handledRequestErrors = new WeakSet();
async function request(method, params = {}, quiet = false) {
  const sequence = quiet ? null : ++requestSequence, label = method.replaceAll('-', ' ');
  const startedWith = requestSequence;
  if (!quiet) activeForeground = sequence;
  const announce = (message, error = false) => { if (!quiet && sequence === requestSequence) status(message, error, sequence); };
  announce(`Sending ${label}…`);
  try {
    const response = await fetch(`/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Atlas-Token': token ?? '' }, body: JSON.stringify(params) });
    let value;
    if (response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '';
      while (true) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const event = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
          if (value !== undefined) throw new Error('The local service returned data after its terminal result.');
          if (event.status === 'queued' || event.status === 'running') announce(`${event.status === 'queued' ? 'Queued' : 'Running'}: ${label}…`);
          else if (typeof event.ok === 'boolean') value = event;
          else throw new Error('The local service returned an unknown operation status.');
        }
        if (chunk.done) break;
      }
      if (pending || value === undefined) throw new Error('The local service response ended without a complete result. A started operation may still have taken effect.');
    } else value = await response.json();
    if (!value.ok) throw Object.assign(new Error(value.error.message), { code: value.error.code, details: value.error.details });
    announce(`${label} completed.`);
    return value.result;
  } catch (error) {
    if (error instanceof TypeError) error = new Error('The local service is unavailable. A started operation may still have taken effect. Unacknowledged text remains in this tab. Restart the service and open its new launch URL to recover stored drafts.');
    handledRequestErrors.add(error);
    announce(`${label} failed: ${error.message}`, true);
    if (quiet && startedWith === requestSequence) status(`${label} failed: ${error.message}`, true);
    throw error;
  } finally {
    if (sequence !== null && activeForeground === sequence) activeForeground = null;
  }
}
const selected = () => Object.fromEntries(new URLSearchParams(location.search));
const routeKey = () => `${location.pathname}${location.search}`;
const visibleBuffer = buffer => activeBuffer === buffer && renderedRoute === routeKey();
const makeBuffer = value => { const buffer = { epoch: 0, version: 0, prepareSequence: 0, ...value }; allBuffers.add(buffer); return buffer; };
const binding = buffer => ({ text: buffer.text, baseViewDigest: buffer.baseViewDigest, epoch: buffer.epoch, version: buffer.version });
const matchesBinding = (buffer, captured) => buffer.text === captured.text && buffer.baseViewDigest === captured.baseViewDigest && buffer.epoch === captured.epoch && buffer.version === captured.version;
function invalidateReview(buffer) {
  buffer.review = null; buffer.prepareSequence++;
  if (visibleBuffer(buffer)) { prepared = null; $('#prepared-review')?.replaceChildren(); }
}
function changeText(buffer, text) {
  if (buffer.text === text) return;
  buffer.text = text; buffer.version++; buffer.dirty = true; buffer.applied = false;
  invalidateReview(buffer); draftStatus(buffer);
  clearTimeout(buffer.timer); buffer.timer = setTimeout(() => saveBuffer(buffer).catch(showError), 500);
}
function changeBaseline(buffer, digest) {
  buffer.epoch++; buffer.baseViewDigest = digest; buffer.dirty = true; buffer.applied = false;
  delete buffer.draftId; delete buffer.revision; delete buffer.savedAt;
  invalidateReview(buffer);
}
const model = () => snapshot?.view.validation?.normalized;
function showError(error) {
  if (handledRequestErrors.has(error)) return;
  status(`${error.code ? `${error.code}: ` : ''}${error.message}`, true);
}
function freshnessLabel() {
  if (!snapshot) return '';
  return `${snapshot.view.status} · ${snapshot.view.identity?.digest?.slice(0, 12) ?? 'no observation'}`;
}
function stateStorageNotice() {
  return snapshot?.stateStorage?.writable === false ? `<p class="limits" role="status">Stored drafts remain available for inspection. Draft saves, discard, application, and report retention are unavailable until source prerequisites are established.</p>${limits(snapshot.stateStorage.diagnostics.map(item => item.message))}` : '';
}
function navigation() {
  const m = model(), route = selected();
  const item = (kind, values, title, extra = '') => {
    const current = (route.kind ?? 'atlas') === kind && Object.entries(values).every(([key, value]) => route[key] === value);
    return `<a class="nav-link ${extra}" ${current ? 'aria-current="page"' : ''} href="${escape(url(kind, values))}">${escape(title)}</a>`;
  };
  const groups = m?.atlas.navigation ?? [], included = new Set(groups.flatMap(group => group.maps));
  const groupMarkup = group => `<p class="nav-label">${escape(group.title)}</p>${group.maps.map(id => {
    const map = m.maps.find(value => value.id === id);
    if (!map) return '';
    return item('map', { id }, map.title) + (route.id === id || route.mapId === id ? map.areas.map(area => item('area', { mapId: id, id: area.id }, area.title, 'nav-area')).join('') : '');
  }).join('')}`;
  $('#navigation-content').innerHTML = item('atlas', {}, m?.atlas.title ?? 'Selected Atlas')
    + groups.map(groupMarkup).join('')
    + (m?.maps.some(map => !included.has(map.id)) ? groupMarkup({ title: groups.length ? 'Other Maps' : 'Maps', maps: m.maps.filter(map => !included.has(map.id)).map(map => map.id) }) : '')
    + `<p class="nav-label">Workspace</p>${item('resources', {}, 'Sources')}${item('document', { path: 'catalog.json' }, 'Catalog')}${item('document', { path: 'connections.json' }, 'Connections')}${item('checks', {}, 'Checks')}${item('changes', {}, 'Changes')}${item('diagnostics', {}, `Diagnostics (${snapshot?.view.validation?.diagnostics?.length ?? 0})`)}${item('drafts', {}, `Drafts (${savedDrafts.length})`)}${item('reports', {}, 'Retained reports')}${stateStorageNotice()}`;
  $('#workspace-label').textContent = `${snapshot?.workspace.repositoryRoot ?? ''} / ${snapshot?.workspace.atlasPath ?? ''}`;
  document.title = `${m?.atlas.title ?? 'Atlas'} · Editor`;
}
function pathTools(path) { return `<div class="toolbar">${link('edit', { path }, 'Edit document', 'button')}${link('document', { path }, 'Raw document', 'button quiet')}<code class="muted">${escape(path)}</code></div>`; }
function sourceLinks(record, ownerPath) {
  const render = (target, role) => `<div class="source-link"><span class="pill">${escape(role)}</span>${target.resource
    ? link('resource', { id: target.resource, ...(target.selector ? { selector: target.selector } : {}) }, target.label ?? target.resource)
    : link('source', { uri: target.uri, ownerPath }, target.label ?? target.uri)}${target.selector ? `<code>${escape(target.selector)}</code>` : ''}${target.note ? `<span class="note">${escape(target.note)}</span>` : ''}</div>`;
  return (record.content ?? []).map(target => render(target, 'Content')).join('') + (record.references ?? []).map(target => render(target, target.role)).join('');
}
function diagnostics(values) {
  return values?.length ? values.map(value => `<div class="diagnostic"><strong>${escape(value.code ?? value.severity ?? 'Finding')}</strong> ${escape(value.message)}${value.path ? `<br>${link('document', { path: value.path }, value.path)} ${value.line ? `line ${value.line}` : ''}` : ''}</div>`).join('') : empty('No diagnostics were reported for this observation.');
}
function rows(items, make) { return `<div class="rows">${items.map(make).join('')}</div>`; }
function mapRow(map) { return `<a class="row" href="${escape(url('map', { id: map.id }))}"><h2>${escape(map.title)}</h2><p>${escape(map.question)}</p><small>${map.pointIds.length} Points · ${map.areas.length} Areas · ${escape(map.status)}</small></a>`; }
function pointRow(point) { return `<a class="row" href="${escape(url('point', { id: point.id }))}"><h3>${escape(point.title)}</h3><p>${escape(point.summary)}</p><small>${escape(point.id)} · ${escape(point.posture)} · ${escape(point.lifecycle)}</small></a>`; }
function searchRow(item) {
  return `<a class="row" href="${escape(url(item.type, { id: item.id, ...(item.mapId ? { mapId: item.mapId } : {}) }))}"><small>${escape(item.type)}</small><h2>${escape(item.title)}</h2><p>${escape(item.summary)}</p><small>${escape(item.reasons.join(' '))} · ${escape(item.path)}</small>${(item.matches ?? []).slice(0, 3).map(match => `<div class="search-match"><small><code>${escape(match.path)}</code>${match.mapId ? ` · ${escape(match.mapId)}` : ''}${match.recordKind ? ` · ${escape(match.recordKind)}` : ''}</small><p>${escape(match.excerpt)}</p></div>`).join('')}</a>`;
}
function changedValues(before, after, prefix = '', result = []) {
  if (JSON.stringify(before) === JSON.stringify(after) || result.length >= 128) return result;
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) changedValues(before[key], after[key], prefix ? `${prefix}.${key}` : key, result);
  } else result.push({ path: prefix || 'record', before, after });
  return result;
}
function comparisonMarkup(result) {
  if (result.status !== 'compared') return heading('Comparison', result.status) + detail('Available comparison and diagnostics', result);
  const values = value => value === undefined ? '<p class="muted">Absent</p>' : `<pre>${typeof value === 'string' ? escape(value) : json(value)}</pre>`;
  return `<h2>Source changes</h2>${detail('Before and after identity', { before: result.before, after: result.after })}${rows(result.sourceChanges, item => `<div class="row"><span class="pill">${escape(item.change)}</span> ${item.change === 'removed' ? escape(item.path) : link('document', { path: item.path }, item.path)}</div>`)}${result.sourceChanges.length ? '' : empty('No examined source bytes changed.')}<h2>Record changes</h2>${result.records.map(item => {
    const changes = changedValues(item.before, item.after);
    return `<section class="record"><h3>${escape(item.key)}</h3><p class="muted">${escape(item.change)}</p>${changes.map(value => `<details><summary>${escape(value.path)}</summary><div class="two-columns"><div><h3>Before</h3>${values(value.before)}</div><div><h3>After</h3>${values(value.after)}</div></div></details>`).join('')}${changes.length === 128 ? '<p class="muted">The field summary stops at 128 changed values. The complete record comparison remains below.</p>' : ''}${detail('Complete record comparison', item)}</section>`;
  }).join('')}${result.records.length ? '' : empty('No normalized record values changed.')}<p class="muted">Field paths describe changed values. They do not establish why meaning changed.</p>${limits(result.limits)}`;
}
function sharedMapIdentities(mapId, normalized) {
  const overlaps = (normalized.relatedMaps ?? []).filter(overlap => overlap.maps.includes(mapId));
  return `<h2>Shared Point identities</h2><p class="muted">These Maps contain authored records of the same exact Points.</p>${rows(overlaps, overlap => {
    const otherId = overlap.maps.find(id => id !== mapId), other = normalized.maps.find(map => map.id === otherId);
    return `<div class="row"><h3>${link('map', { id: otherId }, other?.title ?? otherId)}</h3><p>${escape(other?.question ?? '')}</p>${overlap.pointIds.map(id => link('point', { id }, id)).join(' · ')}</div>`;
  })}${overlaps.length ? '' : empty('No other Map shares an authored Point identity in this observation.')}`;
}
function fullRecord(record, path) {
  return `${record.question ? `<p class="question">${escape(record.question)}</p>` : ''}${pathTools(path)}${sourceLinks(record, path)}<div class="prose">${record.html ?? ''}</div>${detail('Assembled reading data', record)}`;
}
function checkRow(check, discovery) {
  const destination = discovery.status === 'ready' ? link('check', { id: check.id }, check.title) : link('document', { path: check.path }, check.title);
  const applicability = check.applicability.status === 'unresolved'
    ? `<p><strong>Applicability unresolved.</strong> Applicable subjects are unknown.</p>${limits(check.applicability.reasons)}`
    : `<p>${check.subjects.length} applicable subjects in the selected scope.</p>`;
  return `<div class="row"><h2>${destination}</h2><p>${escape(check.summary)}</p><small>${escape(check.status)} · ${escape(check.level ?? 'Level unknown')} · ${escape(check.appliesTo?.join(', ') ?? 'Declared applicability unknown')} · ${check.evaluator ? escape(check.evaluator.id) : 'No registered verifier'}</small>${applicability}${link('document', { path: check.path }, 'Read captured Check')}<small> · ${escape(check.path)}</small></div>`;
}

async function render(focus = false) {
  const sequence = ++routeSequence, route = selected(), kind = route.kind ?? 'atlas';
  navigation();
  let html = '', after, editing;
  const m = model();
  if (kind === 'export') {
    const options = await request('export-options');
    html = heading('Publication', 'Export site', 'Review one publication profile, then explicitly create a static site.')
      + `<p>Destination: <code>${escape(options.outputDirectory)}</code></p><p class="muted">Choose another destination with <code>atlas open --export-dir &lt;absolute-path&gt;</code>. Existing directories are never replaced.</p>`
      + `<p>Resource access permits reading. Only the selected publication profile permits inclusion in this site. Export includes applied source files; unfinished drafts remain private application storage.</p>`;
    if (!options.profiles.length) html += `<p class="limits">This Atlas has no publication profiles. Preview a starter profile, inspect its complete selection and file diff, then explicitly apply it. The starter selects current Atlas, Maps, and Point records. Resources and Checks stay unselected.</p>${link('new', { type: 'publication' }, 'Preview a publication profile', 'button primary')}`;
    else html += `<form id="export-form"><label for="export-profile">Publication profile</label><select id="export-profile" name="profileId">${options.profiles.map(profile => `<option value="${escape(profile.id)}">${escape(profile.title)} (${escape(profile.id)})</option>`).join('')}</select><label for="export-name">Site name</label><input id="export-name" name="name" value="${escape(options.name)}">${button('export-prepare', 'Preview selection', '', 'primary')}</form><div id="export-review"></div>`;
  } else if (kind === 'agent') {
    const result = await request('agent-config');
    html = heading('Agent connection', 'Connect an agent', 'Use this configuration in a host that supports MCP over stdio.')
      + `<p>Project: <code>${escape(result.repositoryRoot)}</code><br>Atlas: <code>${escape(result.atlasPath)}</code></p><p>${escape(result.notice)}</p>`
      + `<p>Copy the configuration into the host’s MCP server settings. Restart its connection after updating Atlas. This page does not change any host settings.</p><label for="agent-configuration">Host configuration</label><textarea id="agent-configuration" readonly rows="16">${json(result.configuration)}</textarea>${button('agent-copy', 'Copy configuration')}`;
  } else if (kind === 'atlas') {
    if (!m) html = heading('Atlas', snapshot.view.status === 'missing' ? 'Create an Atlas' : 'Inspect this draft') + empty('A complete valid model is unavailable. Captured documents and diagnostics remain available for repair.')
      + `<div class="toolbar">${link('diagnostics', {}, 'Inspect diagnostics', 'button')}${snapshot.canInitialize ? link('new', { type: 'initialize' }, 'Preview creation', 'button primary') : ''}</div>`;
    else {
      const result = await request('read', { viewId: snapshot.viewId, kind: 'atlas' }, true);
      html = heading('Atlas', m.atlas.title, m.atlas.summary)
        + `<div class="facts"><span><strong>${m.maps.length}</strong> Maps</span><span><strong>${m.points.length}</strong> Points</span><span><strong>${m.atlas.resources.length}</strong> Sources</span><span>${escape(freshnessLabel())}</span></div>`
        + sourceLinks(m.atlas, 'atlas.md') + `<div class="prose">${result.html}</div><h2>Explore a question</h2>${rows(m.maps, mapRow)}${pathTools('atlas.md')}${limits(snapshot.view.limits)}`;
    }
  } else if (['map', 'area', 'point', 'resource', 'check', 'document', 'source'].includes(kind)) {
    const parameters = { viewId: snapshot.viewId, kind };
    if (['map', 'point', 'resource', 'check', 'area'].includes(kind)) parameters.id = route.id;
    if (kind === 'area') parameters.mapId = route.mapId;
    if (kind === 'document') parameters.path = route.path;
    if (kind === 'source') { parameters.target = route.resource ? { resource: route.resource, ...(route.selector ? { selector: route.selector } : {}) } : { uri: route.uri }; parameters.ownerPath = route.ownerPath ?? 'atlas.md'; }
    const result = await request('read', parameters, true);
    if (kind === 'point' && result.status === 'found') {
      const point = result.point;
      html = heading('Point', point.title, point.summary)
        + `<div class="facts"><code>${escape(point.id)}</code><span>${escape(point.posture)} · ${escape(point.lifecycle)}</span><span>${escape(point.kinds.join(', '))}</span><span>Primary Map: ${link('map', { id: point.primaryMap }, point.primaryMap)}</span></div>`
        + point.records.map(record => {
          const map = result.maps.find(value => value.id === record.map);
          return `<section class="record"><p class="eyebrow">${escape(record.kind)} · ${link('map', { id: record.map }, map?.title ?? record.map)}</p><h2>${escape(map?.question ?? record.map)}</h2><p class="summary">${escape(record.summary)}</p>${pathTools(record.path)}<div class="prose">${result.html[record.path]}</div><div class="memberships">${record.areas.map(member => `<p>${link('area', { mapId: record.map, id: member.area }, map?.areas.find(area => area.id === member.area)?.question ?? member.area)}<span>${escape(member.context)}</span></p>`).join('')}</div>${sourceLinks(record, record.path)}${detail('Record fields and extensions', record)}</section>`;
        }).join('') + `<h2>Authored relations</h2>${rows(point.relations, relation => `<div class="row"><span class="pill">${escape(relation.type)}</span> ${link('point', { id: relation.targetPoint }, relation.targetPoint)}<p>${escape(relation.note)}</p></div>`)}<h2>Direct reverse relations</h2>${rows(point.incomingRelations, relation => `<div class="row">${link('point', { id: relation.sourcePoint }, relation.sourcePoint)} <span class="pill">${escape(relation.type)}</span><p>${escape(relation.note)}</p></div>`)}${detail('Review and canonical extensions', { review: point.review, extensions: point.extensions })}${limits(result.limits)}`;
    } else if (kind === 'resource' && result.status === 'found') {
      const resource = result.resource;
      html = heading('Resource', resource.title, resource.summary) + `<p class="muted"><code>${escape(resource.id)}</code> · <code>${escape(resource.uri)}</code></p><div class="toolbar">${link('source', { resource: resource.id, ...(route.selector ? { selector: route.selector } : {}) }, 'Read source', 'button primary')}</div><h2>Exact registered uses</h2>${rows(result.uses, use => `<div class="row"><span class="pill">${escape(use.use === 'reference' ? use.target.role : 'Content')}</span> ${use.owner.pointId ? link('point', { id: use.owner.pointId }, use.owner.pointId) : link('document', { path: use.owner.path }, use.owner.path)}<p>${escape(use.target.note ?? use.owner.question ?? '')}</p><small>${escape(use.owner.path)}${use.owner.recordKind ? ` · ${escape(use.owner.recordKind)}` : ''}</small></div>`)}${detail('Resource fields and provenance', result)}${limits(result.limits)}`;
    } else if (kind === 'document') {
      html = heading('Captured document', route.path) + `<p class="muted">${escape(result.status)} · observation ${escape(result.viewDigest?.slice(0, 12))}</p>`
        + (result.status === 'missing' && ['catalog.json', 'connections.json'].includes(route.path) ? `<div class="toolbar">${link('edit', { path: route.path }, 'Create missing file', 'button primary')}</div>` : result.status === 'read' && result.text !== undefined && !result.truncated ? `<div class="toolbar">${link('edit', { path: route.path }, 'Edit document', 'button primary')}</div>` : empty('Complete editable text is unavailable.'))
        + `<pre>${escape(result.text ?? '')}</pre>${diagnostics(result.diagnostics)}${detail('Document byte identity', result.input)}`;
    } else if (kind === 'source') {
      html = heading('Source', result.resource?.title ?? result.uri ?? route.uri ?? route.resource)
        + `<p class="muted">${escape(result.status)}${result.reason ? ` · ${escape(result.reason)}` : ''}</p>${result.html ? `<div class="prose">${result.html}</div>` : ''}${detail('Raw source and citation', { text: result.text, uri: result.uri, target: result.target, ownerPath: result.ownerPath, observation: result.observation })}${limits(result.limits)}`;
    } else if (result.status === 'found') {
      const record = { ...result.record, html: result.html };
      html = heading(kind, record.title, record.summary) + fullRecord(record, result.path);
      if (kind === 'map') html += `<h2>Areas</h2>${rows(record.areas, area => `<a class="row" href="${escape(url('area', { mapId: record.id, id: area.id }))}"><h3>${escape(area.title)}</h3><p>${escape(area.question)}</p></a>`)}<h2>Points</h2>${rows(m.points.filter(point => record.pointIds.includes(point.id)), pointRow)}${sharedMapIdentities(record.id, m)}`;
      if (kind === 'area') html += `<h2>Explained memberships</h2>${rows(m.points.flatMap(point => point.records.filter(record => record.map === route.mapId).flatMap(record => record.areas.filter(area => area.area === route.id).map(area => ({ point, record, area })))), ({ point, record, area }) => `<div class="row"><h3>${link('point', { id: point.id }, point.title)}</h3><p>${escape(area.context)}</p><small>${escape(record.kind)} · ${escape(record.path)}</small></div>`)}`;
      if (kind === 'check') html += `<div class="facts"><span>${escape(record.status)}</span><span>${escape(record.level)}</span><span>${escape(record.appliesTo.join(', '))}</span></div>${link('checks', {}, 'Discover and run Checks', 'button')}`;
    } else html = heading(kind, route.id ?? route.path ?? 'Unavailable') + empty(`This destination is ${result.status} in the selected observation. Existing draft text is retained.`) + detail('Available result', result);
  } else if (kind === 'resources') html = heading('Sources', 'Source material', 'Registered Resources retain their own identity and exact uses.') + rows(m?.atlas.resources ?? [], resource => `<a class="row" href="${escape(url('resource', { id: resource.id }))}"><h2>${escape(resource.title)}</h2><p>${escape(resource.summary ?? resource.uri)}</p><small>${escape(resource.id)} · ${escape(resource.uri)}</small></a>`);
  else if (kind === 'search') {
    const mode = route.mode ?? 'ranked';
    const guidance = `<p class="muted">${mode === 'fts' ? 'FTS expressions support quoted phrases, prefixes such as auth*, AND, OR, NOT, and NEAR.' : 'Ordinary text finds candidates with matching tokens. Inspect the matched records and original sources to assess relevance.'}</p>`;
    try {
      const result = await request('find', { viewId: snapshot.viewId, query: route.query ?? '', options: { mode, limit: 30, ...(route.cursor ? { cursor: route.cursor } : {}) } });
      html = heading('Search', route.query || 'Find context') + `<p class="muted">${result.total} candidates · ${result.items.length} in this page · ${mode === 'fts' ? 'FTS expression' : 'Ranked text'}</p>` + guidance + rows(result.items, searchRow)
        + (result.nextCursor ? `<div class="toolbar">${link('search', { query: route.query, mode, cursor: result.nextCursor }, 'More results', 'button')}</div>` : '') + limits(result.limits);
    } catch (error) {
      html = heading('Search unavailable', route.query || 'Find context') + diagnostics([{ code: error.code ?? 'Search failed', message: error.message }]) + guidance;
    }
  } else if (kind === 'diagnostics') html = heading('Diagnostics', 'Inspect the current files') + `<p class="muted">${escape(freshnessLabel())}</p>${diagnostics(snapshot.view.validation?.diagnostics)}<h2>Captured documents</h2>${rows((snapshot.view.identity?.inputs ?? []).filter(input => input.kind === 'file'), input => `<div class="row">${link('document', { path: input.path }, input.path)}<small> · ${input.byteLength} bytes</small></div>`)}${limits(snapshot.view.limits)}`;
  else if (kind === 'changes') {
    html = heading('Changes', 'Compare observations', 'Compare exact views retained by this running service. A source refresh creates a new observation when examined bytes change.');
    const observations = snapshot.observations ?? [];
    html += `<form id="compare-form" class="form-grid"><label>Before<select name="before">${observations.map(item => `<option value="${item.viewId}">${escape(item.observedAt)} · ${item.identity.digest?.slice(0, 12)}</option>`).join('')}</select></label><label>After<select name="after">${observations.map(item => `<option value="${item.viewId}" ${item.viewId === snapshot.viewId ? 'selected' : ''}>${escape(item.observedAt)} · ${item.identity.digest?.slice(0, 12)}</option>`).join('')}</select></label><button class="primary">Compare</button></form><div id="comparison"></div>`;
    after = () => { let requested = 0; const target = $('#comparison'); $('#compare-form').onsubmit = async event => { event.preventDefault(); const sequence = ++requested; try { const form = new FormData(event.target); const result = await request('compare', { beforeViewId: form.get('before'), afterViewId: form.get('after') }); if (sequence === requested && target.isConnected) target.innerHTML = comparisonMarkup(result); } catch (error) { showError(error); } }; };
  } else if (kind === 'checks') {
    const discovery = await request('checks', { viewId: snapshot.viewId }, true);
    html = heading('Checks', 'Readable local policy', 'Discovery runs no verification. Invoke the available verifiers explicitly and inspect their actual evidence.')
      + `<p class="muted">Atlas observation: ${escape(discovery.status)}. Check inventory: ${discovery.complete ? 'complete' : 'incomplete'}.</p>`
      + (discovery.status === 'ready' ? '' : empty('Verification requires a complete valid Atlas observation.'))
      + rows(discovery.items, check => checkRow(check, discovery))
      + (discovery.items.length ? '' : empty(discovery.complete ? 'No local Checks were found.' : 'No readable Check definitions were recovered. Discovery is incomplete.'))
      + (discovery.unresolvedCheckIds.length ? `<h2>Unresolved requested Checks</h2>${limits(discovery.unresolvedCheckIds)}` : '')
      + (discovery.diagnostics.length ? `<h2>Discovery diagnostics</h2>${diagnostics(discovery.diagnostics)}` : '')
      + actorForm() + `<div class="toolbar">${button('evaluate', 'Run adopted Checks', '', 'primary')}</div><div id="evaluation-result">${latestRun ? runMarkup(latestRun) : ''}</div>${limits(discovery.limits)}`;
  } else if (kind === 'reports') {
    const result = await request('report-list', {}, true);
    html = heading('Evidence', 'Retained reports', 'Original reports and evidence remain available after the Editor closes.');
    if (route.reportId) html += detail('Retained report, provenance, evidence, and freshness', await request('report-read', { reportId: route.reportId }, true));
    html += rows(result.reportIds, reportId => `<div class="row">${link('reports', { reportId }, reportId)}</div>`);
  } else if (kind === 'drafts') {
    await loadDrafts();
    html = heading('Unfinished work', 'Stored drafts', 'Recovery candidates preserve unfinished text and its original baseline. Their presence does not establish an authored file save.') + rows(savedDrafts, draft => `<div class="row"><h2>${draft.kind === 'contribution' ? link('new', { draftId: draft.draftId }, 'Unfinished contribution') : link('edit', { path: draft.path, draftId: draft.draftId }, draft.path)}</h2><p>Stored ${escape(draft.savedAt)} · baseline ${escape(draft.baseViewDigest?.slice(0, 12) ?? 'Atlas absent')}</p>${button('discard', 'Discard recovery candidate', `data-draft-id="${draft.draftId}"`)}</div>`) + (draftIssues.length ? detail('Draft storage issues', draftIssues) : '');
  } else if (kind === 'edit') {
    const buffer = await editingBuffer(route);
    editing = buffer;
    html = heading('Edit document', route.path) + `<p id="edit-baseline" class="muted">Original baseline <code>${escape(buffer.baseViewDigest)}</code>. The prepared review will expose exact Point identity and provenance before application.</p><label for="document-text">Document text</label><textarea id="document-text" class="editor-text" spellcheck="false">${escape(buffer.text)}</textarea><p id="draft-status" class="draft-state"></p><div class="toolbar">${button('prepare-document', 'Prepare changes', '', 'primary')}${button('save-draft', 'Store draft now')}${button('rebase-draft', 'Inspect current source')}</div><div id="current-source"></div><div id="prepared-review"></div>`;
    after = () => {
      draftStatus(buffer);
      $('#document-text').oninput = event => changeText(buffer, event.target.value);
      showBufferReview(buffer);
    };
  } else if (kind === 'new') {
    editing = contributionForRoute(route);
    html = newMarkup(contributionContent(editing.text).type); after = () => bindNewForm(editing);
  }
  else html = heading('Unavailable', 'Unknown destination');
  if (sequence !== routeSequence) return;
  if (kind === 'search' && renderedRoute !== routeKey()) {
    $('#search-input').value = route.query ?? '';
    $('#search-mode').value = route.mode ?? 'ranked';
  }
  activeBuffer = editing; renderedRoute = routeKey(); prepared = editing?.review ?? null;
  $('#reader').innerHTML = html;
  after?.();
  if (focus) { $('.reader-pane').scrollTop = 0; $('#reader').focus({ preventScroll: true }); }
}

function actorForm() { return `<div class="form-grid"><label>Actor kind<select id="actor-kind"><option value="human">Human</option><option value="agent">Agent</option><option value="tool">Tool</option></select></label><label>Actor id<input id="actor-id" placeholder="Name or exact actor id" required></label></div>`; }
function actor() { const id = $('#actor-id')?.value.trim(); if (!id) throw new Error('Enter the actual actor id before invoking verification.'); return { kind: $('#actor-kind').value, id }; }
function runMarkup(result) {
  const run = result.run;
  return `<section class="panel"><h2>Actual Check results</h2><p class="muted">Run ${escape(result.runId)} · required satisfaction ${escape(run.requiredSatisfied)} · ${escape(run.startedAt ?? '')}</p>${rows(run.evaluations ?? [], item => `<div class="row"><span class="check-outcome ${escape(item.outcome)}">${escape(item.outcome)}</span><h3>${escape(item.check ?? item.id)}</h3><p>${escape(item.summary)}</p>${detail('Subjects, original evidence, and diagnostics', item)}</div>`)}${detail('Run identity, coverage, attribution, and freshness', run)}<div class="toolbar">${button('retain', 'Retain this report', `data-run-id="${result.runId}"`)}</div></section>`;
}
async function loadDrafts() {
  const sequence = ++draftListSequence, result = await request('draft-list', {}, true);
  if (sequence === draftListSequence) { savedDrafts = result.drafts; draftIssues = result.issues; }
}
function contributionForRoute(route) {
  const key = route.draftId ?? `new:${route.type ?? 'anchor'}`;
  if (!contributionBuffers.has(key)) {
    if (route.draftId) {
      const existing = [...allBuffers].find(buffer => buffer.kind === 'contribution' && buffer.draftId === route.draftId);
      const stored = savedDrafts.find(draft => draft.draftId === route.draftId && draft.kind === 'contribution');
      if (!existing && !stored) throw new Error('The contribution draft is unavailable. Inspect stored drafts.');
      contributionBuffers.set(key, existing ?? makeBuffer({ ...stored, dirty: false }));
    } else contributionBuffers.set(key, makeBuffer({ kind: 'contribution', path: 'contribution', baseViewDigest: snapshot.view.identity?.digest ?? null,
      text: JSON.stringify({ type: route.type ?? 'anchor', forms: {} }), dirty: false }));
  }
  return contributionBuffers.get(key);
}
async function editingBuffer(route) {
  if (route.draftId) {
    const stored = savedDrafts.find(draft => draft.draftId === route.draftId);
    if (!stored) throw new Error('This draft is no longer available. Open Drafts to inspect current recovery candidates.');
    if (draftBuffers.get(route.path)?.draftId !== stored.draftId) draftBuffers.set(route.path,
      [...allBuffers].find(buffer => buffer.kind !== 'contribution' && buffer.draftId === stored.draftId) ?? makeBuffer({ ...stored, dirty: false }));
  }
  if (!draftBuffers.has(route.path)) {
    const document = await request('read', { viewId: snapshot.viewId, kind: 'document', path: route.path }, true);
    const missingGlobal = document.status === 'missing' && ['catalog.json', 'connections.json'].includes(route.path);
    if (!missingGlobal && (document.status !== 'read' || document.truncated || document.text === undefined)) throw new Error('Only complete captured text can be edited. Inspect the document status and byte limits.');
    if (!draftBuffers.has(route.path)) draftBuffers.set(route.path, makeBuffer({ kind: 'document', path: route.path, text: missingGlobal ? '{}\n' : document.text, baseViewDigest: document.viewDigest, dirty: false }));
  }
  return draftBuffers.get(route.path);
}
function draftStatus(buffer) {
  if (!visibleBuffer(buffer)) return;
  const target = buffer.kind === 'contribution' ? $('#contribution-draft-status') : $('#draft-status');
  if (!target) return;
  target.textContent = buffer.applied ? 'Applied to Atlas files. New edits begin from this saved observation.' : buffer.dirty ? (buffer.saving ? 'Unsaved text in this tab · storing draft…' : 'Unsaved text in this tab.') : buffer.revision ? `Stored draft · ${buffer.savedAt}. Apply separately to write Atlas files.` : 'Original captured text · no draft changes.';
}
function queueBuffer(buffer, operation) {
  const task = (buffer.saving ?? Promise.resolve()).catch(() => {}).then(operation);
  buffer.saving = task;
  const finished = () => { if (buffer.saving === task) buffer.saving = null; };
  task.then(finished, finished);
  return task;
}
function saveBuffer(buffer) {
  clearTimeout(buffer.timer);
  return queueBuffer(buffer, async () => {
    if (!buffer.dirty && buffer.revision) return;
    const captured = binding(buffer);
    let stored;
    try {
      stored = await request('draft-save', { kind: buffer.kind, path: buffer.path, baseViewDigest: captured.baseViewDigest, text: captured.text,
        ...(buffer.draftId ? { draftId: buffer.draftId, expectedRevision: buffer.revision } : {}) }, true);
    } catch (error) {
      buffer.dirty = true;
      const label = visibleBuffer(buffer) && (buffer.kind === 'contribution' ? $('#contribution-draft-status') : $('#draft-status'));
      if (label) label.textContent = 'Draft storage failed. Text remains unsaved in this tab.';
      throw error;
    }
    // An earlier baseline's acknowledgement remains a recovery candidate, but
    // cannot attach its revision id to a buffer that has since changed baseline.
    if (buffer.epoch === captured.epoch && buffer.baseViewDigest === captured.baseViewDigest) {
      Object.assign(buffer, { draftId: stored.draftId, revision: stored.revision, savedAt: stored.savedAt, dirty: !matchesBinding(buffer, captured) });
    }
    draftStatus(buffer);
    try { await loadDrafts(); navigation(); }
    catch (error) { status(`Draft storage succeeded; the recovery list could not refresh: ${error.message}`, true); }
    return stored;
  });
}
function showBufferReview(buffer) {
  if (!visibleBuffer(buffer)) return;
  prepared = buffer.review ?? null;
  const target = $('#prepared-review');
  if (target) target.innerHTML = buffer.review ? planMarkup(buffer.review) : buffer.receipt ?? '';
}
async function prepareBuffer(buffer, operations, captured = binding(buffer)) {
  const sequence = ++buffer.prepareSequence;
  await saveBuffer(buffer);
  if (!matchesBinding(buffer, captured) || sequence !== buffer.prepareSequence) throw new Error('Text or baseline changed during preparation. Prepare the current buffer again.');
  const review = await request('prepare', { expected: captured.baseViewDigest === null ? { atlasMissing: true } : { viewDigest: captured.baseViewDigest }, operations });
  if (!matchesBinding(buffer, captured) || sequence !== buffer.prepareSequence) throw new Error('Text or baseline changed during preparation. Prepare the current buffer again.');
  buffer.review = { ...review, buffer, captured };
  showBufferReview(buffer);
  if (visibleBuffer(buffer)) $('#prepared-review')?.scrollIntoView({ block: 'start' });
  return buffer.review;
}
function planMarkup(value) {
  const plan = value.plan;
  return `<section class="record"><p class="eyebrow">Prepared review</p><h2>Inspect before applying</h2><p class="muted">Plan ${escape(plan.digest)} · ${escape(plan.status)}. Preparation has not written Atlas files.</p>${(plan.pointDecisions ?? []).map(decision => `<section class="panel"><h3>${escape(decision.pointId)} · ${escape(decision.record)}</h3><p class="muted">Map: ${escape(decision.mapId)} · ${escape(decision.mapQuestion)}</p><p class="muted">${decision.anchor ? `Anchor: <code>${escape(decision.anchor.path)}</code> (${escape(decision.anchor.origin)})` : 'New anchor identity'}</p></section>`).join('')}${detail('Exact Point identity, record kind, and anchor provenance', plan.pointDecisions)}${(plan.changes ?? []).map(change => `<section><h3>${escape(change.path)}</h3><pre class="diff">${escape(typeof change.diff === 'string' ? change.diff : JSON.stringify(change.diff, null, 2))}</pre></section>`).join('')}${detail('Before and after validation', plan.validation)}${detail('Applicable Checks and unresolved verification', plan.checks)}${limits(plan.gaps)}${limits(plan.limits)}${actorForm()}<div class="toolbar">${button('evaluate-plan', 'Run Checks on proposal')}${button('apply', 'Apply validated changes', '', 'primary')}${plan.request?.operations?.every(operation => operation.type === 'repair-document') ? button('apply-draft', 'Apply as invalid draft', '', 'danger') : ''}</div><div id="proposal-evaluation"></div></section>`;
}
function newMarkup(type) {
  const choices = { anchor: 'Point anchor', context: 'Point context', map: 'Map', area: 'Area', resource: 'Resource', supersede: 'Supersession', 'adopt-check': 'Adopt a Check', publication: 'Publication profile', initialize: 'Initialize Atlas' };
  return heading(type === 'initialize' ? 'New collection' : type === 'publication' ? 'Publication' : 'Contribute', type === 'initialize' ? 'Create an Atlas' : type === 'publication' ? 'Create a publication profile' : 'Add useful context', type === 'initialize' ? 'Preview atlas.md, catalog.json, and connections.json, then explicitly apply the reviewed files. Opening this form writes no authored files.' : type === 'publication' ? 'Review every selected record. The starter excludes Resource documents and Checks. Prepare the profile, inspect its full diff, then explicitly apply it.' : 'Inspect plausible identities and Map questions before creating a Point. Similarity supplies candidates; the exact id and record kind remain explicit decisions.')
    + `<label>Contribution type<select id="contribution-type">${Object.entries(choices).map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p id="contribution-draft-status" class="draft-state"></p><form id="contribution-form"><div id="contribution-fields"></div><div class="toolbar"><button type="submit" class="primary">Prepare contribution</button>${button('inspect-contribution-baseline', 'Inspect current Atlas')}</div></form><div id="contribution-baseline"></div><div id="candidate-results"></div><div id="prepared-review"></div>`;
}
function input(name, label, value = '', wide = false) { return `<label class="${wide ? 'wide' : ''}">${escape(label)}<input name="${name}" value="${escape(value)}" required></label>`; }
function contributionOperation(type, data, currentModel) {
  if (type === 'publication') return { type, action: 'create', id: data.id, text: data.body };
  if (type === 'supersede') return { type, sourceId: data.id, targetId: data.targetId, note: data.note };
  if (type === 'adopt-check') return { type, id: data.id, text: data.body, registration: JSON.parse(data.registration), source: { uri: data.uri } };
  const set = JSON.parse(data.extra || '{}');
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw new Error('Additional structured metadata must be a JSON object.');
  for (const key of ['title', 'uri']) if (data[key] !== undefined) set[key] = data[key];
  if (type === 'initialize') return { type, fields: { ...set, id: data.id }, body: data.body };
  if (['anchor', 'context'].includes(type)) return { type: 'point', action: 'create', id: data.id, mapId: data.mapId, record: type, set, body: data.body };
  if (type === 'map') return { type, action: 'create', id: data.id, directory: data.directory, set, body: data.body };
  const parent = type === 'area' ? currentModel?.maps.find(map => map.id === data.mapId) : currentModel?.atlas;
  if (!parent) throw new Error('Inspect the containing Atlas or Map before preparing this contribution.');
  const body = `${parent.body.trimEnd()}\n\n## ${type === 'area' ? 'Area' : 'Resource'}: ${data.id}\n\n${data.body.trim()}\n`;
  return { type, action: 'create', id: data.id, set, ...(type === 'area' ? { mapId: data.mapId } : {}),
    ...(type === 'area' || data.body.trim() ? { body } : {}) };
}
function contributionContent(text) {
  const content = JSON.parse(text), types = ['anchor', 'context', 'map', 'area', 'resource', 'supersede', 'adopt-check', 'publication', 'initialize'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(content) || Object.keys(content).length !== 2 || !types.includes(content.type) || !object(content.forms)
    || !Object.entries(content.forms).every(([type, values]) => types.includes(type) && object(values) && Object.values(values).every(value => typeof value === 'string'))) {
    throw new Error('Stored contribution form has an unsupported or invalid current shape. Inspect its exact stored text before editing.');
  }
  return content;
}
function bindNewForm(buffer) {
  const typeSelect = $('#contribution-type');
  const form = $('#contribution-form'), fieldsTarget = $('#contribution-fields');
  const content = contributionContent(buffer.text);
  let renderedType = content.type;
  const capture = () => {
    content.forms[renderedType] = Object.fromEntries(new FormData(form));
    content.type = typeSelect.value;
    changeText(buffer, JSON.stringify(content));
  };
  const update = () => {
    const type = typeSelect.value;
    let fields = input('id', type === 'context' ? 'Existing exact Point id' : type === 'supersede' ? 'Newer source Point id' : 'Exact id', type === 'publication' ? 'public' : type === 'initialize' ? 'project' : '');
    if (['anchor', 'context', 'area'].includes(type)) fields += `<label>Map<select name="mapId" required>${(model()?.maps ?? []).map(map => `<option value="${escape(map.id)}">${escape(map.title)} · ${escape(map.question)}</option>`).join('')}</select></label>`;
    if (type === 'map') fields += input('directory', 'Repository-local Map directory within Atlas', 'maps/');
    if (['area', 'resource'].includes(type)) fields += input('title', 'Short navigation label');
    if (type === 'resource') fields += input('uri', 'Source URI relative to atlas.md', '', true);
    if (type === 'supersede') fields += input('targetId', 'Older target Point id') + input('note', 'Explanation of replacement', '', true);
    if (type === 'adopt-check') fields += input('uri', 'Provenance URI of the explicitly selected Check', '', true) + `<label class="wide">Publisher Check registration (JSON)<textarea name="registration" rows="5" required spellcheck="false" placeholder='${escape('{"check":"selected-id","level":"required","applies-to":["map"]}')}'></textarea><span class="muted">Copy the exact selected publisher registration. The Markdown and registration are adopted together.</span></label>`;
    if (['anchor', 'context'].includes(type)) fields += `<div class="wide"><p class="muted">Inspect the selected identity and plausible matches before continuing.</p>${button('candidate-search', 'Inspect candidate identities')}</div>`;
    if (type !== 'supersede') {
      const label = type === 'publication' ? 'Complete publication profile Markdown with JSON frontmatter' : type === 'adopt-check' ? 'Complete Check Markdown with JSON frontmatter' : type === 'area' ? 'Area summary and Question in Markdown' : type === 'resource' ? 'Resource explanation in Markdown (optional)' : 'Markdown body';
      const placeholder = type === 'area' ? 'One paragraph explaining this Area.\n\n### Question\n\nWhich local question does this Area ask?' : type === 'resource' || type === 'adopt-check' ? '' : `# Title\n\nOne clear paragraph.${type === 'map' ? '\n\n## Question\n\nWhich durable question does this Map ask?' : ''}`;
      fields += `<label class="wide">${label}<textarea name="body" rows="9" placeholder="${escape(placeholder)}" ${type === 'resource' ? '' : 'required'}></textarea></label>`;
    }
    if (!['supersede', 'adopt-check', 'publication', 'initialize'].includes(type)) fields += `<label class="wide">Additional structured metadata (JSON object)<textarea name="extra" rows="5" spellcheck="false">${escape(type === 'anchor' ? JSON.stringify({ kinds: ['observation'], posture: 'asserted', lifecycle: 'active' }, null, 2) : type === 'map' ? '{"status":"draft"}' : '{}')}</textarea><span class="muted">The Library stores state in the local header and assignments in catalog.json or connections.json. Give new associations explicit ids and explain them with Connection headings in the Markdown body.</span></label>`;
    fieldsTarget.innerHTML = `<div class="form-grid">${fields}</div>`;
    for (const [name, value] of Object.entries(content.forms[type] ?? {})) {
      const element = form.elements.namedItem(name);
      if (element && typeof value === 'string') element.value = value;
    }
    if (type === 'initialize' && !content.forms[type]) form.elements.namedItem('body').value = '# Project Atlas\n\nProject context and its sources.\n';
    if (type === 'publication' && !content.forms[type]) {
      const m = model();
      const selection = { atlas: true, maps: (m?.maps ?? []).map(map => map.id), points: Object.fromEntries((m?.points ?? []).map(point => [point.id, point.records.map(record => record.map)])), resources: [], checks: [] };
      form.elements.namedItem('body').value = '---\n' + JSON.stringify({ type: 'publication', id: 'public', selection }, null, 2) + '\n---\n\n# Public site\n\nSelected Atlas context for the exported site.\n\nThis profile selects the listed structural records. Resource documents and Checks are excluded. Review the selection before publication.\n';
    }
    renderedType = type;
    draftStatus(buffer);
  };
  typeSelect.onchange = () => { capture(); update(); };
  form.oninput = capture;
  update();
  showBufferReview(buffer);
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      capture();
      const captured = binding(buffer);
      const data = Object.fromEntries(new FormData(event.target)), type = typeSelect.value;
      const operation = contributionOperation(type, data, model());
      await prepareBuffer(buffer, [operation], captured);
    } catch (error) { showError(error); }
  };
}

async function refresh() {
  snapshot = await request('refresh');
  await loadDrafts();
  navigation();
  // Keep native textarea/form nodes, selection, focus, and undo history alive.
  if (activeBuffer && visibleBuffer(activeBuffer)) draftStatus(activeBuffer);
  else {
    const destination = routeKey(), scroll = $('.reader-pane').scrollTop;
    await render(false);
    if (routeKey() === destination) $('.reader-pane').scrollTop = scroll;
  }
  status(`Refreshed · ${freshnessLabel()}. Draft text keeps its original baseline.`);
}
async function action(name, element) {
  if (['candidate-search', 'inspect-contribution-baseline', 'accept-contribution-baseline', 'save-draft', 'prepare-document', 'rebase-draft', 'accept-baseline', 'apply', 'apply-draft', 'evaluate-plan'].includes(name)
    && (!activeBuffer || !visibleBuffer(activeBuffer))) throw new Error('Wait for this editing destination to finish opening.');
  if (name === 'refresh') return refresh();
  if (name === 'agent-copy') {
    const text = $('#agent-configuration').value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(text); status('Agent host configuration copied. Host settings remain unchanged.');
    } catch { $('#agent-configuration').focus(); $('#agent-configuration').select(); status('Configuration selected. Use the browser copy command to copy it.'); }
    return;
  }
  if (name === 'export-prepare') {
    const data = new FormData($('#export-form')); const target = $('#export-review');
    exportReview = await request('export-prepare', { profileId: data.get('profileId'), name: data.get('name') });
    if (target !== $('#export-review')) return;
    target.innerHTML = `<h2>Review selected content</h2><p>${escape(exportReview.notice)}</p><p>Destination: <code>${escape(exportReview.outputDirectory)}</code></p><pre>${json(exportReview.profile.selection)}</pre>${detail('Routes and Resource availability', { routes: exportReview.routes, resources: exportReview.resources, omittedChecks: exportReview.omittedChecks })}${button('export-apply', 'Export reviewed selection', '', 'primary')}`; return;
  }
  if (name === 'export-apply') {
    if (!exportReview) throw new Error('Preview a publication selection first.');
    const reviewed = exportReview, target = $('#export-review');
    const result = await request('export-apply', { exportId: reviewed.exportId });
    if (target !== $('#export-review')) return;
    target.innerHTML = `<h2>Site exported</h2><p><code>${escape(result.outputDirectory)}</code></p><p>The static site is ready. No deployment occurred.</p>${button('export-preview', 'Open local preview')}`; return;
  }
  if (name === 'export-preview') {
    if (!exportReview) throw new Error('Export a reviewed selection first.');
    const result = await request('export-preview', { exportId: exportReview.exportId });
    const target = $('#export-review');
    if (target) target.innerHTML += `<p><a href="${escape(result.url)}" target="_blank" rel="noreferrer">Open exported site</a> · <code>${escape(result.url)}</code></p><p>Preview stops when Atlas closes. Re-export source changes to a new destination.</p>`;
    window.open(result.url, '_blank', 'noopener,noreferrer'); return;
  }
  if (name === 'candidate-search') {
    const target = $('#candidate-results'), buffer = activeBuffer, captured = binding(buffer);
    const data = new FormData($('#contribution-form')), query = data.get('id') || data.get('title') || '';
    const result = await request('find', { viewId: snapshot.viewId, query, options: { limit: 12, types: ['point'] } });
    if (visibleBuffer(buffer) && matchesBinding(buffer, captured) && target === $('#candidate-results')) target.innerHTML = `<h2>Plausible identities</h2>${rows(result.items, item => `<div class="row">${link('point', { id: item.id }, item.title)}<p>${escape(item.summary)}</p><code>${escape(item.id)}</code></div>`)}${limits(result.limits)}`; return;
  }
  if (name === 'inspect-contribution-baseline') {
    const buffer = activeBuffer, target = $('#contribution-baseline'), id = new FormData($('#contribution-form')).get('id');
    snapshot = await request('refresh'); navigation();
    const digest = snapshot.view.identity?.digest ?? null;
    const candidate = id && snapshot.viewId ? await request('read', { viewId: snapshot.viewId, kind: 'point', id }, true) : null;
    if (visibleBuffer(buffer) && target === $('#contribution-baseline')) target.innerHTML = `<section class="panel"><h2>Current Atlas and identity</h2><p class="muted">${escape(freshnessLabel())}</p>${rows(model()?.maps ?? [], mapRow)}${candidate ? detail('Exact candidate anchor and contexts', candidate) : ''}<p class="muted">Inspect current context before choosing a new preparation baseline.</p>${button('accept-contribution-baseline', 'Use this current baseline', `data-digest="${escape(digest ?? '')}"`)}</section>`; return;
  }
  if (name === 'accept-contribution-baseline') {
    const buffer = activeBuffer;
    changeBaseline(buffer, element.dataset.digest || null); await saveBuffer(buffer);
    status('The contribution uses the explicitly selected current baseline. Prepare and inspect it before applying.'); return;
  }
  if (name === 'save-draft') return saveBuffer(activeBuffer);
  if (name === 'prepare-document') {
    const buffer = activeBuffer;
    await prepareBuffer(buffer, [{ type: 'repair-document', path: buffer.path, text: buffer.text }]); return;
  }
  if (name === 'rebase-draft') {
    const buffer = activeBuffer, target = $('#current-source');
    snapshot = await request('refresh'); navigation();
    const document = await request('read', { viewId: snapshot.viewId, kind: 'document', path: buffer.path });
    if (visibleBuffer(buffer) && target === $('#current-source')) target.innerHTML = `<h2>Current source</h2><p class="muted">Inspect the current bytes before explicitly preparing the edited text against this new baseline.</p><pre>${escape(document.text ?? document.status)}</pre>${document.status === 'read' && !document.truncated ? button('accept-baseline', 'Use this current baseline', `data-digest="${document.viewDigest}"`) : ''}`; return;
  }
  if (name === 'accept-baseline') {
    const buffer = activeBuffer;
    changeBaseline(buffer, element.dataset.digest); await saveBuffer(buffer); status('The edited text now uses the explicitly selected baseline. Prepare and inspect the complete diff.'); return;
  }
  if (name === 'apply' || name === 'apply-draft') {
    const buffer = activeBuffer, reviewed = buffer.review;
    if (!reviewed || reviewed.buffer !== buffer || !matchesBinding(buffer, reviewed.captured)) throw new Error('Prepare the current text and baseline before applying.');
    if (reviewed.applying) throw new Error('This prepared application is already awaiting its receipt.');
    reviewed.applying = true;
    let response;
    try { response = await request('apply', { planId: reviewed.planId, mode: name === 'apply-draft' ? 'draft' : 'validated' }); }
    finally { reviewed.applying = false; }
    if (buffer.review === reviewed) { buffer.review = null; if (visibleBuffer(buffer)) prepared = null; }
    if (response.state) snapshot = response.state;
    const result = response.result;
    let cleanupWarning = result.recovery?.status === 'cleanup-failed' ? `${result.status === 'applied' ? 'Files applied; recovery' : 'Recovery'} cleanup failed. Inspect the retained recovery directory and application receipt.` : null;
    if (response.state && ['applied', 'no-op'].includes(result.status)) {
      await queueBuffer(buffer, async () => {
        if (!matchesBinding(buffer, reviewed.captured)) return;
        clearTimeout(buffer.timer);
        const draftId = buffer.draftId, revision = buffer.revision;
        if (draftId) {
          try { await request('draft-discard', { draftId, expectedRevision: revision }, true); }
          catch (error) { cleanupWarning = [cleanupWarning, `Files applied; the stored draft still needs inspection: ${error.message}`].filter(Boolean).join(' '); }
        }
        // Discard removes only its exact stored revision. Later edits stay
        // dirty and retain their old baseline, with a new recovery identity.
        if (buffer.draftId === draftId && buffer.revision === revision) {
          delete buffer.draftId; delete buffer.revision; delete buffer.savedAt;
        }
        if (matchesBinding(buffer, reviewed.captured)) {
          buffer.epoch++; buffer.baseViewDigest = response.state.view.identity.digest;
          buffer.dirty = false; buffer.applied = true;
          invalidateReview(buffer);
          if (visibleBuffer(buffer) && $('#edit-baseline')) $('#edit-baseline').innerHTML = `Saved baseline <code>${escape(buffer.baseViewDigest)}</code>. Further changes require a new prepared review.`;
        }
        draftStatus(buffer);
      });
    }
    buffer.receipt = `<section class="panel ${['stale', 'partial'].includes(result.status) ? 'warning' : ''}"><h2>${result.status === 'applied' ? 'Files saved' : escape(result.status)}</h2><p class="muted">${result.written.length} written · ${result.pending.length} pending. Saving does not establish Check compliance.</p>${result.written.map(file => `<p>${link('document', { path: file }, file)}</p>`).join('')}${result.conflicts.length ? detail('Conflicts requiring inspection', result.conflicts) : ''}${result.recoveryDirectory ? `<p class="muted">Recovery originals: <code>${escape(result.recoveryDirectory)}</code></p>` : ''}${detail('Complete application receipt', result)}</section>`;
    showBufferReview(buffer);
    status(`Application returned ${result.status}. ${['stale', 'partial'].includes(result.status) ? 'Edited text is preserved. Inspect conflicts before preparing again.' : 'The receipt records the written files and remaining verification limits.'}`);
    if (cleanupWarning) status(cleanupWarning, true);
    if (response.refreshError) status(`Application returned ${result.status}; refresh failed: ${response.refreshError.message}. Inspect the application receipt before retrying.`, true);
    await loadDrafts(); navigation(); return;
  }
  if (name === 'evaluate' || name === 'evaluate-plan') {
    const target = $(name === 'evaluate-plan' ? '#proposal-evaluation' : '#evaluation-result');
    const reviewed = name === 'evaluate-plan' ? activeBuffer.review : null;
    if (name === 'evaluate-plan' && !reviewed) throw new Error('Prepare the current proposal before evaluating it.');
    const run = await request('evaluate', { ...(reviewed ? { planId: reviewed.planId } : { viewId: snapshot.viewId }), actor: actor() });
    if (!reviewed) latestRun = run;
    if (target?.isConnected && (!reviewed || reviewed.buffer.review === reviewed)) target.innerHTML = runMarkup(run); return;
  }
  if (name === 'retain') {
    const result = await request('retain', { runId: element.dataset.runId });
    element.closest('.toolbar').innerHTML = `${link('reports', { reportId: result.reportId }, 'Inspect retained report', 'button')}<span class="muted">${escape(result.retained?.directory ?? '')}</span>`; return;
  }
  if (name === 'discard') {
    const draft = savedDrafts.find(item => item.draftId === element.dataset.draftId);
    if (!draft) throw new Error('The recovery candidate is no longer available. Refresh Drafts before discarding.');
    const buffer = [...allBuffers].find(value => value.draftId === draft.draftId), captured = buffer && binding(buffer);
    const discard = async () => {
      if (buffer && (buffer.dirty || !matchesBinding(buffer, captured) || buffer.revision !== draft.revision)) throw new Error('This buffer has newer text or a newer stored revision. Store and inspect its current recovery candidate before discarding.');
      await request('draft-discard', { draftId: draft.draftId, expectedRevision: draft.revision });
      if (!buffer) return;
      if (buffer.draftId === draft.draftId && buffer.revision === draft.revision) { delete buffer.draftId; delete buffer.revision; delete buffer.savedAt; }
      if (!matchesBinding(buffer, captured)) return;
      clearTimeout(buffer.timer); allBuffers.delete(buffer);
      for (const [key, value] of draftBuffers) if (value === buffer) draftBuffers.delete(key);
      for (const [key, value] of contributionBuffers) if (value === buffer) contributionBuffers.delete(key);
    };
    if (buffer) await queueBuffer(buffer, discard); else await discard();
    await loadDrafts(); await render(false); status('The selected draft recovery content was removed from the state directory.');
  }
}

function rememberHistory() {
  if (restoringHistory || renderedRoute !== routeKey()) return;
  const focused = document.activeElement;
  history.replaceState({ ...history.state, scroll: $('.reader-pane').scrollTop, focusId: focused?.id ?? '', focusName: focused?.name ?? '',
    selectionStart: focused?.selectionStart, selectionEnd: focused?.selectionEnd, selectionDirection: focused?.selectionDirection }, '', location.href);
}
async function navigate(href) {
  rememberHistory(); history.pushState({}, '', href);
  const transition = ++historyTransition; restoringHistory = true;
  setNavigation(false);
  try { await render(true); }
  finally { if (transition === historyTransition) { restoringHistory = false; rememberHistory(); } }
}
document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (control) { event.preventDefault(); action(control.dataset.action, control).catch(showError); return; }
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const target = new URL(anchor.href);
  if (target.origin === location.origin && target.pathname === '/' && !target.hash) { event.preventDefault(); navigate(`${target.pathname}${target.search}`).catch(showError); }
});
async function restoreHistory() {
  setNavigation(false);
  const state = history.state ?? {}, transition = ++historyTransition; restoringHistory = true;
  try {
    await render(false);
    if (transition !== historyTransition) return;
    $('.reader-pane').scrollTop = state.scroll ?? 0;
    const target = state.focusId && document.getElementById(state.focusId)
      || state.focusName && [...document.querySelectorAll('input,textarea,select')].find(element => element.name === state.focusName);
    (target || $('#reader')).focus({ preventScroll: true });
    if (target?.setSelectionRange && Number.isInteger(state.selectionStart) && Number.isInteger(state.selectionEnd)) {
      try { target.setSelectionRange(state.selectionStart, state.selectionEnd, state.selectionDirection); } catch { /* This input type has no text selection. */ }
    }
  } finally { if (transition === historyTransition) { restoringHistory = false; rememberHistory(); } }
}
window.addEventListener('popstate', () => restoreHistory().catch(showError));
$('.reader-pane').addEventListener('scroll', rememberHistory, { passive: true });
document.addEventListener('focusin', event => {
  rememberHistory();
  if (event.target.closest('.reader-pane')) setNavigation(false);
});
document.addEventListener('selectionchange', rememberHistory);
$('#search-form').onsubmit = event => { event.preventDefault(); navigate(url('search', { query: $('#search-input').value, mode: $('#search-mode').value })).catch(showError); };
const openHelp = () => $('#help-dialog').showModal();
$('#help-open').onclick = openHelp;
$('#help-close').onclick = () => $('#help-dialog').close();
$('#help-dialog').addEventListener('close', () => $('#help-open').focus());
function setNavigation(open) {
  document.body.classList.toggle('navigation-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}
$('#menu-toggle').onclick = () => {
  const open = !document.body.classList.contains('navigation-open');
  setNavigation(open);
  if (open) $('#search-input').focus();
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#help-dialog').open && document.body.classList.contains('navigation-open')) {
    event.preventDefault(); setNavigation(false); $('#menu-toggle').focus(); return;
  }
  if (event.target.closest('input,textarea,select,[contenteditable=true]') || event.metaKey || event.ctrlKey || event.altKey || $('#help-dialog').open) return;
  if (event.key === '/') { event.preventDefault(); if (getComputedStyle($('#menu-toggle')).display !== 'none') setNavigation(true); $('#search-input').focus(); }
  if (event.key === '?') { event.preventDefault(); openHelp(); }
});
window.addEventListener('beforeunload', event => { if ([...allBuffers].some(buffer => buffer.dirty || buffer.saving)) { event.preventDefault(); event.returnValue = ''; } });
try {
  if (!token) throw new Error('Open the launch URL printed by atlas-editor to connect this tab.');
  snapshot = await request('state'); await loadDrafts(); await render(false); rememberHistory(); status(freshnessLabel());
} catch (error) { showError(error); $('#reader').innerHTML = heading('Atlas Editor', 'Connection needs attention') + empty(error.message); }
