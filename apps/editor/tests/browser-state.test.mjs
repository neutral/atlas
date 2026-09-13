import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual browser entry's state transitions without a DOM framework.
// These controlled replies qualify races, not browser rendering or human use.
const source = await fs.readFile(new URL('../public/editor.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const state = digest => ({ viewId: digest, view: { status: 'ready', identity: { digest }, validation: {} }, workspace: {}, observations: [] });
const stored = (params, revision = 'r1') => ({ ...params, draftId: params.draftId ?? 'draft-a', revision, savedAt: revision });

async function harness(fetch = async () => { throw new Error('No controlled response.'); }) {
  const elements = new Map(), listeners = new Map(), timers = new Map();
  let timerId = 0;
  const location = { pathname: '/', search: '', hash: '', href: 'http://127.0.0.1:1000/', origin: 'http://127.0.0.1:1000' };
  const bodyClasses = new Set();
  const document = { activeElement: null, body: { classList: { remove(name) { bodyClasses.delete(name); }, contains(name) { return bodyClasses.has(name); }, toggle(name, value) { if (value) bodyClasses.add(name); else bodyClasses.delete(name); } } },
    addEventListener(name, fn) { listeners.set(`document:${name}`, fn); },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', scrollTop: 0, isConnected: true,
        classList: { toggle() {} }, setAttribute() {}, closest() { return null; }, replaceChildren() { this.innerHTML = ''; }, scrollIntoView() {},
        addEventListener(name, fn) { listeners.set(`${selector}:${name}`, fn); },
        focus() { document.activeElement = this; }, id: selector.startsWith('#') ? selector.slice(1) : '' });
      return elements.get(selector);
    },
    getElementById(id) { return elements.get(`#${id}`); }, querySelectorAll() { return [...elements.values()]; },
  };
  const history = { state: {}, replaceState(value) { this.state = value; }, pushState(value, _, href) { this.state = value; location.search = new URL(href, location.origin).search; } };
  const context = vm.createContext({ document, history, location, URL, URLSearchParams, TextDecoder, Uint8Array, fetch,
    getComputedStyle(element) { return { display: element.display ?? 'block' }; },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    window: { addEventListener(name, fn) { listeners.set(`window:${name}`, fn); } },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const api = await vm.runInContext(`(async () => { ${source}
    return { request, showError, contributionContent, makeBuffer, binding, changeText, changeBaseline, saveBuffer, queueBuffer, prepareBuffer, contributionForRoute,
      action, refresh, render, navigate, searchRow, sourceLinks, sharedMapIdentities, comparisonMarkup, rememberHistory, restoreHistory, contributionOperation, allBuffers, draftBuffers, contributionBuffers,
      setRequest(fn) { request = fn; }, setSnapshot(value) { snapshot = value; }, setDrafts(value) { savedDrafts = value; },
      activate(buffer, search = '?kind=edit&path=' + buffer.path) { location.search = search; renderedRoute = routeKey(); activeBuffer = buffer; prepared = buffer.review; },
      getPrepared() { return prepared; }, setRender(fn) { render = fn; }, setRenderedRoute() { renderedRoute = routeKey(); },
    }; })()`, context);
  api.setSnapshot(state('before'));
  return { ...api, document, history, location, elements, listeners, timers };
}

test('contribution forms author document meaning in Markdown and retain only navigation labels in metadata', async () => {
  const h = await harness();
  const point = h.contributionOperation('anchor', { id: 'example', mapId: 'design', body: '# Example\n\nOne canonical idea.\n', extra: '{"posture":"asserted","lifecycle":"active"}' });
  assert.equal(Object.hasOwn(point.set, 'title'), false);
  assert.equal(Object.hasOwn(point.set, 'summary'), false);
  assert.equal(point.body, '# Example\n\nOne canonical idea.\n');
  const mapBody = '# Design\n\nA durable perspective.\n\n## Question\n\nWhich choices govern design?\n';
  const area = h.contributionOperation('area', { id: 'scope', mapId: 'design', title: 'Scope', body: 'The local scope.\n\n### Question\n\nWhere does the boundary end?', extra: '{}' }, { maps: [{ id: 'design', body: mapBody }] });
  assert.equal(area.set.title, 'Scope');
  assert.equal(Object.hasOwn(area.set, 'summary'), false);
  assert.equal(Object.hasOwn(area.set, 'question'), false);
  assert.equal(area.body, `${mapBody.trimEnd()}\n\n## Area: scope\n\nThe local scope.\n\n### Question\n\nWhere does the boundary end?\n`);
});

test('stored contribution forms reject missing and obsolete shapes without rewriting their text', async () => {
  const h = await harness();
  const current = '{"type":"anchor","forms":{"anchor":{"id":"current-point","body":"Exact unfinished text."}}}';
  assert.equal(h.contributionContent(current).forms.anchor.body, 'Exact unfinished text.');
  for (const text of ['{"forms":{}}', '{"type":"anchor","forms":[]}', '{"type":"obsolete","forms":{}}',
    '{"type":"anchor","forms":{},"oldField":true}', '{"type":"anchor","forms":{"anchor":{"body":42}}}']) {
    assert.throws(() => h.contributionContent(text), /unsupported or invalid current shape/u);
  }
});

test('Check contribution preserves separately supplied publisher registration and Markdown', async () => {
  const h = await harness(), registration = { check: 'selected-check', level: 'required', 'applies-to': ['map'], 'x-publisher': 'exact source' };
  const text = '---\n{"type":"check","id":"selected-check","status":"active"}\n---\n# Selected Check\n\nAn exact publisher definition.\n';
  const operation = h.contributionOperation('adopt-check', { id: 'selected-check', body: text, registration: JSON.stringify(registration), uri: 'https://example.com/policy' });
  assert.deepEqual(JSON.parse(JSON.stringify(operation)), { type: 'adopt-check', id: 'selected-check', text, registration, source: { uri: 'https://example.com/policy' } });
});

test('incomplete source keeps a saved draft readable with its baseline and visible state restrictions', async () => {
  const h = await harness();
  const snapshot = { ...state(null), view: { status: 'incomplete', identity: { digest: null }, validation: { diagnostics: [{ code: 'source-unreadable', message: 'The Point cannot be read.' }] } },
    stateStorage: { writable: false, diagnostics: [{ code: 'atlas.editor.state-source-unavailable', message: 'A complete current source observation is required before writing Editor state.' }] } };
  const draft = { path: 'maps/design/points/example.md', draftId: 'saved-draft', revision: 'saved-revision', text: '# Saved draft\n\nExact <unfinished> text: π.\n', baseViewDigest: 'original-baseline', savedAt: 'original-time' };
  h.setSnapshot(snapshot); h.setDrafts([draft]);
  h.setRequest(async method => { throw new Error(`Opening this saved draft must not require ${method}.`); });
  h.location.search = '?kind=edit&path=' + draft.path + '&draftId=' + draft.draftId;
  await h.render();
  assert.equal(h.draftBuffers.get(draft.path).text, draft.text);
  assert.equal(h.draftBuffers.get(draft.path).baseViewDigest, draft.baseViewDigest);
  assert.equal(h.draftBuffers.get(draft.path).revision, draft.revision);
  assert.match(h.document.querySelector('#reader').innerHTML, /Exact &lt;unfinished&gt; text: π/u);
  assert.match(h.document.querySelector('#reader').innerHTML, /original-baseline/u);
  assert.match(h.document.querySelector('#navigation-content').innerHTML, /Stored drafts remain available for inspection/u);
  assert.match(h.document.querySelector('#navigation-content').innerHTML, /Draft saves, discard, application, and report retention are unavailable/u);
  assert.match(h.document.querySelector('#draft-status').textContent, /Stored draft · original-time/u);
});

test('Check discovery displays readable policy and uncertainty during repairs', async () => {
  const h = await harness();
  h.location.search = '?kind=checks';
  h.setSnapshot({ ...state('repair'), view: { ...state('repair').view, status: 'invalid' } });
  const discovery = { status: 'invalid', complete: false, unresolvedCheckIds: ['missing-policy'], limits: [],
    diagnostics: [{ path: '.checks/broken.md', message: 'The Check definition is malformed.' }],
    items: [{ id: 'repair-policy', title: 'Repair policy', summary: 'Inspect repaired source.', path: '.checks/repair-policy.md',
      status: 'active', level: null, appliesTo: null, revision: null, subjects: null, evaluator: null,
      applicability: { status: 'unresolved', reasons: ['The catalog registration is unavailable.'] } }] };
  const calls = [];
  h.setRequest(async method => { calls.push(method); assert.equal(method, 'checks'); return discovery; });
  await h.render();
  const html = h.document.querySelector('#reader').innerHTML;
  assert.match(html, /Repair policy/u);
  assert.match(html, /Atlas observation: invalid\. Check inventory: incomplete/u);
  assert.match(html, /Level unknown/u);
  assert.match(html, /Declared applicability unknown/u);
  assert.match(html, /Applicability unresolved/u);
  assert.match(html, /Applicable subjects are unknown/u);
  assert.match(html, /The catalog registration is unavailable/u);
  assert.match(html, /The Check definition is malformed/u);
  assert.match(html, /Unresolved requested Checks/u);
  assert.match(html, /missing-policy/u);
  assert.match(html, /kind=document&amp;path=\.checks%2Frepair-policy\.md/u);
  assert.doesNotMatch(html, /kind=check&amp;id=repair-policy|0 applicable subjects/u);
  assert.deepEqual(calls, ['checks']);

  discovery.items = [];
  await h.render();
  assert.match(h.document.querySelector('#reader').innerHTML, /No readable Check definitions were recovered\. Discovery is incomplete/u);
  assert.doesNotMatch(h.document.querySelector('#reader').innerHTML, /No local Checks were found/u);
});

test('browser announces streamed queued and running states and refuses incomplete acknowledgements', async () => {
  const chunks = [], waiting = [];
  const stream = { headers: { get() { return 'application/x-ndjson'; } }, body: { getReader() { return { read() {
    if (chunks.length) return Promise.resolve(chunks.shift());
    const next = deferred(); waiting.push(next); return next.promise;
  } }; } } };
  const h = await harness(async () => stream);
  const incomplete = h.request('state'); await tick();
  const emit = value => { const chunk = value === null ? { done: true } : { value: new TextEncoder().encode(value), done: false }; if (waiting.length) waiting.shift().resolve(chunk); else chunks.push(chunk); };
  emit('{"status":"queued"}\n'); await tick();
  assert.match(h.document.querySelector('#operation-status').textContent, /^Queued:/);
  emit('{"status":"running"}\n'); await tick();
  assert.match(h.document.querySelector('#operation-status').textContent, /^Running:/);
  emit(null); await assert.rejects(incomplete, /without a complete result/);
  assert.match(h.document.querySelector('#operation-status').textContent, /without a complete result/);

  const run = h.request('refresh'); await tick();
  emit('{"status":"queued"}\n{"status":"run'); await tick();
  assert.equal(h.document.querySelector('#operation-status').textContent, 'Queued: refresh…');
  emit('ning"}\n{"ok":true,"result":{"saved":"✓"}}\n'); emit(null);
  assert.equal((await run).saved, '✓');
  assert.equal(h.document.querySelector('#operation-status').textContent, 'refresh completed.');
  const failure = h.request('read'); await tick();
  emit('{"status":"queued"}\n{"status":"running"}\n{"ok":false,"error":{"code":"expired","message":"View expired"}}\n'); emit(null);
  await assert.rejects(failure, /View expired/);
  assert.equal(h.document.querySelector('#operation-status').textContent, 'read failed: View expired');
});

function progressResponse() {
  const chunks = [], waiting = [];
  const push = chunk => { if (waiting.length) waiting.shift().resolve(chunk); else chunks.push(chunk); };
  return {
    response: { headers: { get: () => 'application/x-ndjson' }, body: { getReader: () => ({ read() {
      if (chunks.length) return Promise.resolve(chunks.shift());
      const next = deferred(); waiting.push(next); return next.promise;
    } }) } },
    emit(...events) { push({ done: false, value: new TextEncoder().encode(events.map(event => JSON.stringify(event) + '\n').join('')) }); },
    end() { push({ done: true }); },
  };
}
const jsonResponse = value => ({ headers: { get: () => 'application/json' }, json: async () => ({ ok: true, result: value }) });

test('late read and background failures cannot replace newer queued or running evaluation progress', async () => {
  for (const phase of ['queued', 'running']) {
    const old = progressResponse(), current = progressResponse(), background = progressResponse();
    const streams = [old, current, background];
    const h = await harness(async () => streams.shift().response);
    const first = h.request('read').catch(h.showError); await tick();
    old.emit({ status: 'queued' }, { status: 'running' }); await tick();
    const second = h.request('evaluate'); await tick();
    current.emit({ status: 'queued' }, ...(phase === 'running' ? [{ status: 'running' }] : [])); await tick();
    const expected = `${phase === 'queued' ? 'Queued' : 'Running'}: evaluate…`;
    old.emit({ ok: false, error: { code: 'expired', message: 'Old read failed.' } }); old.end();
    await first;
    assert.equal(h.document.querySelector('#operation-status').textContent, expected);
    const quiet = h.request('draft-list', {}, true).catch(h.showError); await tick();
    background.emit({ status: 'queued' }, { status: 'running' }, { ok: false, error: { code: 'drafts', message: 'Background read failed.' } }); background.end();
    await quiet;
    assert.equal(h.document.querySelector('#operation-status').textContent, expected);
    if (phase === 'queued') current.emit({ status: 'running' });
    current.emit({ ok: true, result: { completed: true } }); current.end();
    assert.equal((await second).completed, true);
    assert.equal(h.document.querySelector('#operation-status').textContent, 'evaluate completed.');
  }
});

test('late refresh and apply summaries preserve newer active progress and keep the application receipt', async () => {
  for (const operation of ['refresh', 'apply']) {
    const bookkeeping = deferred(), current = progressResponse(), calls = [];
    const h = await harness(async url => {
      const method = url.slice('/api/'.length); calls.push(method);
      if (method === 'evaluate') return current.response;
      if (operation === 'refresh' && method === 'refresh') return jsonResponse(state('after'));
      if (operation === 'refresh' && method === 'draft-list') return bookkeeping.promise;
      if (operation === 'apply' && method === 'apply') return jsonResponse({ state: state('after'), result: { status: 'applied', written: ['a.md'], pending: [], conflicts: [] } });
      if (operation === 'apply' && method === 'draft-discard') return bookkeeping.promise;
      if (method === 'draft-list') return jsonResponse({ drafts: [], issues: [] });
      throw new Error(`Unexpected ${method}`);
    });
    const buffer = h.makeBuffer({ path: 'a.md', text: 'edited', baseViewDigest: 'before', dirty: true, draftId: 'draft-a', revision: 'r1' });
    buffer.review = { planId: 'plan-a', buffer, captured: h.binding(buffer) };
    h.activate(buffer);
    const older = operation === 'refresh' ? h.refresh() : h.action('apply', {});
    await tick();
    assert.ok(calls.includes(operation === 'refresh' ? 'draft-list' : 'draft-discard'), 'The old operation is waiting for post-request bookkeeping.');
    const newer = h.request('evaluate'); await tick();
    current.emit({ status: 'queued' }, { status: 'running' }); await tick();
    bookkeeping.resolve(jsonResponse(operation === 'refresh' ? { drafts: [], issues: [] } : {}));
    await older;
    assert.equal(h.document.querySelector('#operation-status').textContent, 'Running: evaluate…');
    if (operation === 'apply') {
      assert.match(buffer.receipt, /Files saved/);
      assert.match(h.document.querySelector('#prepared-review').innerHTML, /Files saved/);
      assert.equal(buffer.dirty, false);
    } else {
      assert.equal(buffer.text, 'edited');
      assert.equal(buffer.baseViewDigest, 'before');
    }
    current.emit({ ok: true, result: {} }); current.end(); await newer;
  }
});

test('save tasks serialize through bookkeeping and newer saves retain their queue ownership', async () => {
  const h = await harness(), firstSave = deferred(), list = deferred(), calls = [];
  const buffer = h.makeBuffer({ path: 'atlas.md', text: 'first', baseViewDigest: 'base', dirty: true });
  let saves = 0, lists = 0;
  h.setRequest(async (method, params) => {
    calls.push({ method, params });
    if (method === 'draft-save') return ++saves === 1 ? firstSave.promise : stored(params, `r${saves}`);
    if (method === 'draft-list') return ++lists === 1 ? list.promise : { drafts: [], issues: [] };
    throw new Error(method);
  });
  const first = h.saveBuffer(buffer); await tick();
  h.changeText(buffer, 'second');
  const second = h.saveBuffer(buffer);
  firstSave.resolve(stored({ text: 'first' })); await tick();
  assert.equal(saves, 1, 'a second save cannot run while first bookkeeping remains pending');
  assert.equal(buffer.saving, second);
  list.resolve({ drafts: [], issues: [] });
  await Promise.all([first, second]);
  assert.equal(saves, 2);
  assert.equal(calls.filter(call => call.method === 'draft-save')[1].params.expectedRevision, 'r1');
  assert.equal(buffer.revision, 'r2');
  assert.equal(buffer.dirty, false);
  assert.equal(buffer.saving, null);
});

test('an old save cannot attach its identity after explicit baseline replacement', async () => {
  const h = await harness(), pending = deferred(), requests = [];
  const buffer = h.makeBuffer({ path: 'atlas.md', text: 'text', baseViewDigest: 'old', dirty: true });
  h.setRequest(async (method, params) => {
    if (method === 'draft-list') return { drafts: [], issues: [] };
    requests.push(params);
    return requests.length === 1 ? pending.promise : stored({ ...params, draftId: 'new-draft' }, 'new-revision');
  });
  const old = h.saveBuffer(buffer); await tick();
  h.changeBaseline(buffer, 'new');
  const current = h.saveBuffer(buffer);
  pending.resolve(stored({ draftId: 'old-draft' }));
  await Promise.all([old, current]);
  assert.equal(requests[1].baseViewDigest, 'new');
  assert.equal(requests[1].draftId, undefined);
  assert.equal(buffer.draftId, 'new-draft');
  assert.equal(buffer.revision, 'new-revision');
});

test('navigation during apply never discards or relabels the destination buffer', async () => {
  const h = await harness(), apply = deferred(), discarded = [];
  const a = h.makeBuffer({ path: 'a.md', text: 'a', baseViewDigest: 'before', dirty: false, draftId: 'draft-a', revision: 'ra' });
  const b = h.makeBuffer({ path: 'b.md', text: 'unsaved b', baseViewDigest: 'before', dirty: true, draftId: 'draft-b', revision: 'rb' });
  a.review = { buffer: a, captured: h.binding(a), planId: 'plan-a', plan: { changes: [] } };
  h.activate(a);
  h.setRequest(async (method, params) => {
    if (method === 'apply') return apply.promise;
    if (method === 'draft-discard') { discarded.push(params.draftId); return {}; }
    if (method === 'draft-list') return { drafts: [], issues: [] };
    throw new Error(method);
  });
  const application = h.action('apply', {});
  h.activate(b); h.document.querySelector('#prepared-review').innerHTML = 'B remains visible';
  apply.resolve({ result: { status: 'applied', written: ['a.md'], pending: [], conflicts: [] }, state: state('after') });
  await application;
  assert.deepEqual(discarded, ['draft-a']);
  assert.equal(b.dirty, true); assert.equal(b.draftId, 'draft-b'); assert.equal(b.applied, undefined);
  assert.equal(a.applied, true); assert.match(a.receipt, /a\.md/);
  assert.equal(h.document.querySelector('#prepared-review').innerHTML, 'B remains visible');
});

test('applied source writes keep a visible recovery cleanup failure and inspectable location', async () => {
  const h = await harness(), buffer = h.makeBuffer({ kind: 'document', path: 'atlas.md', text: 'reviewed', baseViewDigest: 'before', dirty: false });
  buffer.review = { planId: 'plan', buffer, captured: h.binding(buffer) };
  h.activate(buffer);
  h.setRequest(async method => {
    if (method === 'apply') return { result: { status: 'applied', written: ['atlas.md'], pending: [], conflicts: [], recovery: { status: 'cleanup-failed' }, recoveryDirectory: '/durable/recovery/operation' }, state: state('after') };
    if (method === 'draft-list') return { drafts: [], issues: [] };
    throw new Error(method);
  });
  await h.action('apply', {});
  assert.equal(buffer.applied, true);
  assert.match(buffer.receipt, /Files saved/u);
  assert.match(buffer.receipt, /\/durable\/recovery\/operation/u);
  assert.match(h.document.querySelector('#operation-status').textContent, /Files applied; recovery cleanup failed/u);
});

test('partial application with recovery cleanup failure preserves the draft and reports no successful application', async () => {
  const h = await harness(), buffer = h.makeBuffer({ kind: 'document', path: 'atlas.md', text: 'reviewed', baseViewDigest: 'before', dirty: false, draftId: 'draft-a', revision: 'r1' });
  buffer.review = { planId: 'plan', buffer, captured: h.binding(buffer) };
  h.activate(buffer);
  h.setRequest(async method => {
    if (method === 'apply') return { result: { status: 'partial', written: [], pending: ['atlas.md'], conflicts: [{ path: 'atlas.md' }], recovery: { status: 'cleanup-failed' }, recoveryDirectory: '/durable/recovery/operation' }, state: state('after') };
    if (method === 'draft-list') return { drafts: [], issues: [] };
    throw new Error(method);
  });
  await h.action('apply', {});
  assert.equal(buffer.applied, undefined);
  assert.equal(buffer.draftId, 'draft-a');
  assert.match(buffer.receipt, /partial/u);
  assert.doesNotMatch(buffer.receipt, /Files saved/u);
  assert.match(h.document.querySelector('#operation-status').textContent, /^Recovery cleanup failed/u);
});

test('typing during apply cleanup stays unsaved and the next draft uses a new identity', async () => {
  const h = await harness(), discard = deferred(), saved = [];
  const buffer = h.makeBuffer({ path: 'atlas.md', text: 'reviewed', baseViewDigest: 'before', dirty: false, draftId: 'old-draft', revision: 'r1' });
  buffer.review = { buffer, captured: h.binding(buffer), planId: 'plan', plan: { changes: [] } };
  h.activate(buffer);
  h.setRequest(async (method, params) => {
    if (method === 'apply') return { result: { status: 'applied', written: ['atlas.md'], pending: [], conflicts: [] }, state: state('after') };
    if (method === 'draft-discard') return discard.promise;
    if (method === 'draft-save') { saved.push(params); return stored(params); }
    if (method === 'draft-list') return { drafts: [], issues: [] };
    throw new Error(method);
  });
  const application = h.action('apply', {}); await tick();
  h.changeText(buffer, 'newer unapplied text');
  discard.resolve({}); await application;
  assert.equal(buffer.text, 'newer unapplied text'); assert.equal(buffer.dirty, true); assert.equal(buffer.applied, false);
  assert.equal(buffer.baseViewDigest, 'before'); assert.equal(buffer.draftId, undefined);
  await h.saveBuffer(buffer);
  assert.equal(saved[0].draftId, undefined); assert.equal(saved[0].text, 'newer unapplied text');
});

test('delayed preparation belongs to its original buffer and changed text rejects the result', async () => {
  const h = await harness(), pending = deferred();
  const a = h.makeBuffer({ path: 'a.md', text: 'a', baseViewDigest: 'before', dirty: false, revision: 'ra' });
  const b = h.makeBuffer({ path: 'b.md', text: 'b', baseViewDigest: 'before', dirty: false, revision: 'rb' });
  h.activate(a); h.setRequest(async method => { assert.equal(method, 'prepare'); return pending.promise; });
  const preparing = h.prepareBuffer(a, [{ type: 'repair-document', path: a.path, text: a.text }]); await tick();
  h.activate(b); h.document.querySelector('#prepared-review').innerHTML = 'B review';
  pending.resolve({ planId: 'plan-a', plan: { changes: [] } }); await preparing;
  assert.equal(a.review.planId, 'plan-a'); assert.equal(b.review, undefined);
  assert.equal(h.document.querySelector('#prepared-review').innerHTML, 'B review');
  const next = deferred(); h.setRequest(async () => next.promise);
  const stale = h.prepareBuffer(a, []); await tick(); h.changeText(a, 'changed');
  next.resolve({ planId: 'obsolete', plan: {} });
  await assert.rejects(stale, /changed during preparation/); assert.equal(a.review, null);
});

test('contribution autosave captures each object across recovery navigation and unload sees all buffers', async () => {
  const h = await harness(), saves = [];
  h.setDrafts([{ kind: 'contribution', draftId: 'draft-b', revision: 'rb', path: 'contribution', baseViewDigest: 'before', text: '{"type":"map","forms":{}}' }]);
  const a = h.contributionForRoute({}), b = h.contributionForRoute({ draftId: 'draft-b' });
  h.setRequest(async (method, params) => {
    if (method === 'draft-list') return { drafts: [], issues: [] };
    saves.push(params); return stored(params);
  });
  h.activate(a, '?kind=new'); h.changeText(a, '{"type":"anchor","forms":{"anchor":{"title":"new A"}}}');
  const autosave = h.timers.get(a.timer);
  h.activate(b, '?kind=new&draftId=draft-b');
  assert.equal(h.contributionForRoute({}), a); assert.notEqual(a, b);
  let warned = false; h.listeners.get('window:beforeunload')({ preventDefault() { warned = true; } });
  assert.equal(warned, true);
  autosave(); await tick(); if (a.saving) await a.saving;
  assert.match(saves[0].text, /new A/); assert.equal(saves[0].draftId, undefined);
  assert.equal(b.revision, 'rb');
});

test('refresh keeps live editing nodes, scroll, selection, focus, and baseline', async () => {
  const h = await harness(), pending = deferred();
  const buffer = h.makeBuffer({ path: 'atlas.md', text: 'edited', baseViewDigest: 'before', dirty: true });
  h.activate(buffer); const textarea = h.document.querySelector('#document-text');
  textarea.selectionStart = 2; textarea.selectionEnd = 4; textarea.focus();
  h.document.querySelector('.reader-pane').scrollTop = 123;
  h.document.querySelector('#reader').innerHTML = 'live editing nodes';
  h.setRender(() => { throw new Error('refresh must not replace active editor DOM'); });
  h.setRequest(async method => method === 'refresh' ? pending.promise : { drafts: [], issues: [] });
  const refreshing = h.refresh(); h.changeText(buffer, 'edited during refresh'); pending.resolve(state('after')); await refreshing;
  assert.equal(h.document.querySelector('#reader').innerHTML, 'live editing nodes');
  assert.equal(h.document.activeElement, textarea); assert.equal(textarea.selectionStart, 2); assert.equal(textarea.selectionEnd, 4);
  assert.equal(h.document.querySelector('.reader-pane').scrollTop, 123); assert.equal(buffer.baseViewDigest, 'before');
});

test('live history listeners record outgoing scroll and named-control selection for restoration', async () => {
  const h = await harness(), buffer = h.makeBuffer({ path: 'atlas.md', text: 'text', baseViewDigest: 'before' });
  h.activate(buffer);
  const input = h.document.querySelector('input[name=title]'); input.id = ''; input.name = 'title'; input.selectionStart = 1; input.selectionEnd = 3;
  input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; }; input.focus();
  h.document.querySelector('.reader-pane').scrollTop = 456;
  h.listeners.get('.reader-pane:scroll')(); h.listeners.get('document:focusin')({ target: input });
  const outgoing = h.history.state;
  assert.equal(outgoing.scroll, 456); assert.equal(outgoing.focusName, 'title');
  h.document.querySelector('.reader-pane').scrollTop = 0; input.selectionStart = 0; input.selectionEnd = 0;
  h.setRender(async () => h.setRenderedRoute()); h.history.state = outgoing; await h.restoreHistory();
  assert.equal(h.document.querySelector('.reader-pane').scrollTop, 456); assert.equal(h.document.activeElement, input);
  assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 3);
});

test('search routes retain query mode through submission, continuation, history, and refresh', async () => {
  const h = await harness(), calls = [];
  h.setRequest(async (method, params) => {
    calls.push({ method, params });
    if (method === 'refresh') return state('after');
    if (method === 'draft-list') return { drafts: [], issues: [] };
    assert.equal(method, 'find');
    return { total: 2, items: [], nextCursor: 'continued', limits: [] };
  });
  await h.navigate('/?kind=search&query=%22edge%22+AND+keys&mode=fts');
  assert.equal(calls.at(-1).params.options.mode, 'fts');
  assert.equal(h.document.querySelector('#search-mode').value, 'fts');
  assert.equal(h.document.querySelector('#search-input').value, '"edge" AND keys');
  assert.match(h.document.querySelector('#reader').innerHTML, /mode=fts&amp;cursor=continued/);
  await h.navigate('/?kind=search&query=%22edge%22+AND+keys&mode=fts&cursor=continued');
  assert.equal(calls.at(-1).params.options.cursor, 'continued');
  h.document.querySelector('#search-input').value = 'unfinished next query';
  await h.refresh();
  assert.equal(calls.at(-1).params.options.mode, 'fts');
  assert.equal(calls.at(-1).params.options.cursor, 'continued');
  assert.equal(h.document.querySelector('#search-input').value, 'unfinished next query', 'refresh preserves unsubmitted text');
  h.location.search = '?kind=search&query=ordinary+question';
  await h.restoreHistory();
  assert.equal(calls.at(-1).params.options.mode, 'ranked');
  assert.equal(h.document.querySelector('#search-mode').value, 'ranked');
  h.document.querySelector('#search-input').value = 'auth*';
  h.document.querySelector('#search-mode').value = 'fts';
  h.document.querySelector('#search-form').onsubmit({ preventDefault() {} });
  await tick();
  assert.equal(new URLSearchParams(h.location.search).get('mode'), 'fts');
  assert.equal(calls.at(-1).params.query, 'auth*');
});

test('search candidates escape matched record paths and excerpts and show at most three details', async () => {
  const h = await harness();
  const html = h.searchRow({ type: 'point', id: 'edge', title: '<candidate>', summary: 'Summary', path: 'anchor.md', reasons: ['Lexical match'],
    matches: Array.from({ length: 4 }, (_, index) => ({ path: `record-${index}<.md`, mapId: 'map<&', recordKind: 'context', excerpt: `<script>snippet ${index}</script>` })) });
  assert.match(html, /&lt;candidate&gt;/);
  assert.match(html, /record-0&lt;\.md/);
  assert.match(html, /map&lt;&amp; · context/);
  assert.match(html, /&lt;script&gt;snippet 0&lt;\/script&gt;/);
  assert.equal((html.match(/class="search-match"/g) ?? []).length, 3);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('snippet 3'));
});

test('invalid search expressions replace previous results with the attempted query and explicit failure', async () => {
  const h = await harness();
  h.document.querySelector('#reader').innerHTML = 'Previous candidate results';
  h.setRequest(async () => { throw Object.assign(new Error('Unterminated FTS string'), { code: 'atlas.tools.invalid-query' }); });
  await h.navigate('/?kind=search&query=%22unclosed&mode=fts');
  const html = h.document.querySelector('#reader').innerHTML;
  assert.match(html, /Search unavailable/);
  assert.match(html, /&quot;unclosed/);
  assert.match(html, /atlas.tools.invalid-query/);
  assert.match(html, /Unterminated FTS string/);
  assert.ok(!html.includes('Previous candidate results'));
  assert.equal(h.document.querySelector('#search-input').value, '"unclosed');
  assert.equal(h.document.querySelector('#search-mode').value, 'fts');
});

test('Resource links preserve opaque authored selectors for the source-reader boundary', async () => {
  const h = await harness();
  const html = h.sourceLinks({ content: [{ resource: 'source', selector: 'heading: Exact title' }] }, 'map.md');
  assert.match(html, /selector=heading%3A\+Exact\+title/);
});

test('mobile keyboard search opens its hidden navigation and Escape restores the menu control', async () => {
  const h = await harness(), keydown = h.listeners.get('document:keydown');
  const reader = h.document.querySelector('#reader');
  let prevented = 0;
  keydown({ key: '/', target: reader, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(h.document.body.classList.contains('navigation-open'), true);
  assert.equal(h.document.activeElement, h.document.querySelector('#search-input'));
  keydown({ key: 'Escape', target: h.document.activeElement, preventDefault() {} });
  assert.equal(h.document.body.classList.contains('navigation-open'), false);
  assert.equal(h.document.activeElement, h.document.querySelector('#menu-toggle'));
  h.document.querySelector('#menu-toggle').onclick();
  reader.closest = selector => selector === '.reader-pane' ? reader : null;
  h.listeners.get('document:focusin')({ target: reader });
  assert.equal(h.document.body.classList.contains('navigation-open'), false, 'keyboard focus in the reader cannot remain covered by the drawer');
});

test('Map overlap navigation exposes only exact shared Point identities and the other Map question', async () => {
  const h = await harness();
  const html = h.sharedMapIdentities('a', { maps: [{ id: 'a' }, { id: 'b', title: 'Map B', question: 'What changed?' }, { id: 'c', title: 'Unrelated' }],
    relatedMaps: [{ maps: ['a', 'b'], pointIds: ['exact-id'] }, { maps: ['b', 'c'], pointIds: ['different-id'] }] });
  assert.match(html, /Shared Point identities/); assert.match(html, /What changed\?/); assert.match(html, /kind=point&amp;id=exact-id/);
  assert.doesNotMatch(html, /different-id|Unrelated/);
});

test('comparison summarizes changed values while preserving complete data and inert authored text', async () => {
  const h = await harness();
  const html = h.comparisonMarkup({ status: 'compared', sourceChanges: [{ path: 'removed.md', change: 'removed' }], records: [{ key: 'point:one', change: 'changed',
    before: { title: 'Same title', records: [{ body: 'Before', extensions: { 'x-note': 'Keep' } }], review: { status: 'old' } },
    after: { title: 'Same title', records: [{ body: '<script>unsafe()</script>', extensions: { 'x-note': 'Keep' } }] },
  }], limits: [] });
  assert.match(html, /<summary>records\.0\.body<\/summary>/);
  assert.match(html, /<summary>review<\/summary>/);
  assert.doesNotMatch(html, /<summary>title<\/summary>|<summary>records\.0\.extensions/);
  assert.match(html, /Absent/); assert.match(html, /Complete record comparison/);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|kind=document[^\"]*removed/);
});
