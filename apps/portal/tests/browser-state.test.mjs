import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { searchRecords } from '../../../library/src/search.mjs';

const source = (await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace("import { searchRecords } from './search.js';", '');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const draft = (revision = 'a'.repeat(64)) => ({ id: 'saved', revision, plan: { status: 'ready', reason: 'Reviewed change', baseline: { identity: 'original' }, changes: [], candidate: { files: [] }, validation: { diagnostics: [] } } });

// Exercise the shipped browser code with controlled replies and retained editing nodes.
// Layout and native dialog behavior are checked separately in the actual browser.
async function harness() {
  const nodes = new Map(), windowListeners = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = new Map(); this.style = {}; this.value = ''; this.checked = false; this.hidden = false; this.open = false; this.className = ''; this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    get classList() { return { add: name => { this.className += ` ${name}`; }, remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); }, contains: name => this.className.split(' ').includes(name) }; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
    scrollIntoView() {}
    getBoundingClientRect() { return { width: 900, height: 600 }; }
    find(label) { return this.children.find(item => item?.tagName === 'button' && item.children.includes(label)) ?? this.children.map(item => item?.find?.(label)).find(Boolean); }
  }
  const document = { body: { dataset: {} }, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }, getElementById: id => nodes.get(`#${id}`) };
  let reply = async endpoint => {
    if (endpoint === 'view') return { identity: 'original', editable: true, atlas: null, diagnostics: [], canInitialize: true };
    throw new Error(`Unexpected request: ${endpoint}`);
  };
  const requests = [], confirmations = [];
  let confirm = false;
  const location = { pathname: '/', search: '', hash: '' };
  const context = vm.createContext({ searchRecords, document, location, URLSearchParams, URL,
    window: { addEventListener: (name, callback) => windowListeners.set(name, callback), confirm: message => { confirmations.push(message); return confirm; } },
    history: { replaceState() {}, pushState() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {},
    fetch: async (url, options) => {
      const endpoint = url.replace('./api/', '');
      const body = options?.body ? JSON.parse(options.body) : undefined;
      requests.push({ endpoint, body });
      const result = await reply(endpoint, body);
      return { ok: true, json: async () => result };
    },
  });
  const api = await vm.runInContext(`(async () => { ${source}\nreturn { styleDialog, semanticComparison, recoverWorkingCopy, sourceVersionControls, showSource, reviewCandidateChecks, el, edited, editDialog, openDialog, closeDialog, saveForReview, reviewDraft, editRecords, refresh, get editor() { return state.editor; } }; })()`, context);
  return { ...api, get editor() { return api.editor; }, nodes, requests, confirmations, windowListeners,
    setReply: value => { reply = value; }, confirm: value => { confirm = value; },
    content: () => document.querySelector('#draft-content'), dialog: () => document.querySelector('#draft-dialog') };
}

test('Close, Escape, replacement and unload preserve unfinished text unless discard is explicit', async () => {
  const h = await harness(), text = h.el('textarea', { value: 'Exact unfinished text' });
  h.editDialog('Edit', [text]); h.edited();
  h.closeDialog();
  assert.equal(h.dialog().open, true); assert.equal(h.content().children[0], text);
  h.nodes.get('#keep-editing').listeners.get('click')();
  assert.equal(h.nodes.get('#unsaved-warning').hidden, true);
  assert.equal(h.content().children[0], text); assert.equal(h.editor.dirty, true);
  assert.equal(h.openDialog('Other', 'Other content'), false);
  let prevented = false;
  h.dialog().listeners.get('cancel')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.content().children[0], text);
  const unload = { preventDefault() { this.prevented = true; } };
  h.windowListeners.get('beforeunload')(unload);
  assert.equal(unload.prevented, true); assert.equal(unload.returnValue, '');
  h.nodes.get('#discard-edits').listeners.get('click')();
  assert.equal(h.dialog().open, false); assert.equal(h.editor, null);
  const safe = { preventDefault() { throw new Error('No unfinished edits remain.'); } };
  h.windowListeners.get('beforeunload')(safe);
});

test('typing during a save keeps newer text and binds the next save to the acknowledged revision', async () => {
  const h = await harness(), text = h.el('textarea', { value: 'First version' }), saving = deferred();
  h.editDialog('Edit', [text]); h.edited();
  h.setReply(async endpoint => { assert.equal(endpoint, 'drafts'); return saving.promise; });
  const first = h.saveForReview('original', [{ path: 'atlas.json', content: 'First version' }], 'First');
  h.closeDialog(); assert.equal(h.dialog().open, true); assert.equal(h.confirmations.length, 0);
  text.value = 'Newer version'; h.edited();
  saving.resolve(draft()); await first;
  assert.equal(h.content().children[0], text); assert.equal(text.value, 'Newer version');
  assert.equal(h.editor.dirty, true); assert.equal(h.editor.draftId, 'saved'); assert.equal(h.editor.revision, 'a'.repeat(64));
  h.setReply(async () => draft('b'.repeat(64)));
  await h.saveForReview('original', [{ path: 'atlas.json', content: text.value }], 'Second');
  const request = h.requests.at(-1).body;
  assert.equal(request.baseline, 'original'); assert.equal(request.id, 'saved'); assert.equal(request.expectedRevision, 'a'.repeat(64));
  assert.equal(request.changes[0].content, 'Newer version'); assert.equal(h.editor, null);
});

test('failed save retains the form, original baseline and unfinished-text warning', async () => {
  const h = await harness(), text = h.el('textarea', { value: 'Must survive failure' });
  h.editDialog('Edit', [text], draft()); h.edited();
  h.setReply(async () => { throw new Error('Storage unavailable'); });
  await assert.rejects(h.saveForReview('original', [], 'Keep me'), /Storage unavailable/);
  assert.equal(h.content().children[0], text); assert.equal(h.editor.dirty, true); assert.equal(h.editor.saving, false);
  assert.equal(h.requests.at(-1).body.expectedRevision, 'a'.repeat(64));
});

test('late application cannot close or relabel a newly opened editing buffer', async () => {
  const h = await harness(), applied = deferred();
  h.setReply(async endpoint => endpoint === 'apply' ? applied.promise : { identity: 'updated', editable: true, atlas: null, diagnostics: [] });
  h.reviewDraft(draft());
  const applying = h.content().find('Apply draft').listeners.get('click')();
  const text = h.el('textarea', { value: 'New editing buffer' }); h.editDialog('Edit another record', [text]); h.edited();
  applied.resolve({ status: 'complete' }); await applying;
  assert.equal(h.dialog().open, true); assert.equal(h.content().children[0], text); assert.equal(h.editor.dirty, true);
  assert.equal(h.requests.find(item => item.endpoint === 'apply').body.expectedRevision, 'a'.repeat(64));
});

const descendants = node => [node, ...(node.children ?? []).flatMap(child => child && typeof child === 'object' ? descendants(child) : [])];

test('overview opens the current Tree base and is unavailable for an excluded publication base', async () => {
  const h = await harness();
  const view = { atlas: {
    title: 'Project', trees: [{ id: 'experience', title: 'Experience', scope: 'The writer’s account.', base: 'purpose', children: [] }],
    points: [{ id: 'purpose', tree: 'experience', title: 'Keep writing offline', body: 'Explain the promise.', html: '<p>Explain the promise.</p>' }],
    branches: [], facets: [],
  } };
  h.setReply(async () => view);
  await h.refresh();
  assert.equal(h.nodes.get('#read-overview').hidden, false);
  h.nodes.get('#read-overview').listeners.get('click')();
  assert.equal(h.nodes.get('#page').hidden, false);
  assert.ok(descendants(h.nodes.get('#page-content')).some(node => node.tagName === 'h2' && node.children.includes('Keep writing offline')));
  view.atlas.points[0].publicationAvailable = false;
  await h.refresh();
  assert.equal(h.nodes.get('#read-overview').hidden, true);
  h.setReply(async () => ({ atlas: null, canInitialize: true }));
  await h.refresh();
  assert.equal(h.nodes.get('#reading-start').hidden, true);
});

test('source inspection requires explicit selection and never silently replaces required bytes', async () => {
  const h = await harness();
  h.editDialog('Edit', []);
  const controls = h.sourceVersionControls([{ uri: 'report.md' }]);
  const choice = descendants(controls.node).find(node => node.type === 'checkbox');
  const inspect = controls.node.find('Inspect source bytes');
  assert.equal(choice.disabled, true);
  h.setReply(async (endpoint, body) => { assert.equal(endpoint, 'sources/review'); assert.deepEqual(body.uris, ['report.md']); return { results: [{ uri: 'report.md', status: 'current', sha256: 'a'.repeat(64), reason: 'Read explicit source.' }] }; });
  await inspect.listeners.get('click')();
  assert.equal(choice.disabled, false); assert.equal(controls.selected().length, 0);
  choice.checked = true; choice.listeners.get('change')();
  assert.equal(controls.selected()[0].sha256, 'a'.repeat(64));
  h.setReply(async () => ({ results: [{ uri: 'report.md', status: 'changed', sha256: 'b'.repeat(64), reason: 'Changed bytes.' }] }));
  await inspect.listeners.get('click')();
  assert.equal(controls.selected()[0].sha256, 'a'.repeat(64));
  choice.checked = false; choice.listeners.get('change')();
  await inspect.listeners.get('click')();
  choice.checked = true; choice.listeners.get('change')();
  assert.equal(controls.selected()[0].sha256, 'b'.repeat(64));
});

test('a late source read cannot replace an editing buffer opened after it', async () => {
  const h = await harness(), reading = deferred();
  h.setReply(async () => reading.promise);
  const pending = h.showSource({ uri: 'report.md' });
  const text = h.el('textarea', { value: 'New authoring work' }); h.editDialog('Edit', [text]); h.edited();
  reading.resolve({ status: 'ready', content: '# Report', html: '<h1>Report</h1>' });
  await pending;
  assert.equal(h.content().children[0], text); assert.equal(h.editor.dirty, true);
});

test('candidate Check form saves its exact revision and preserves later evidence edits', async () => {
  const h = await harness(), saving = deferred(), saved = draft();
  saved.plan.candidate.identity = 'c'.repeat(64);
  saved.plan.candidate.atlas = { checks: [{ id: 'scope', title: 'Scope', body: 'Read the evidence.', status: 'active', level: 'required', revision: 'd'.repeat(64) }] };
  h.reviewCandidateChecks(saved);
  const fields = descendants(h.content());
  fields.find(node => node.placeholder === 'Reviewer name').value = 'Reviewer';
  fields.find(node => node.tagName === 'select').value = 'unable';
  fields.find(node => node.placeholder === 'Reason for this result').value = 'Source unavailable.';
  h.edited();
  h.setReply(async () => saving.promise);
  const pending = h.content().find('Save Check evidence').listeners.get('click')();
  const evidence = fields.find(node => node.tagName === 'textarea'); evidence.value = 'New evidence arrived during save.'; h.edited();
  saving.resolve({ ...saved, revision: 'b'.repeat(64) }); await pending;
  assert.equal(h.editor.revision, 'b'.repeat(64)); assert.equal(h.editor.dirty, true);
  assert.equal(evidence.value, 'New evidence arrived during save.');
  const request = h.requests.at(-1).body;
  assert.equal(request.expectedRevision, 'a'.repeat(64)); assert.equal(request.manual[0].baseline, saved.plan.candidate.identity);
  assert.equal(request.manual[0].revision, 'd'.repeat(64));
});


test('recovered Check notes never become evidence for a newer candidate revision', async () => {
  const h = await harness();
  const copy = { id: 'typing', revision: 'c'.repeat(64), baseline: 'original', form: { kind: 'checks', title: 'Candidate review', context: { draftId: 'saved', draftRevision: 'a'.repeat(64) }, fields: { controls: [{ value: 'Earlier semantic evidence' }] } } };
  h.setReply(async endpoint => endpoint === 'working-copies/typing' ? copy : draft('b'.repeat(64)));
  await h.recoverWorkingCopy('typing');
  assert.equal(h.editor, null);
  assert.ok(descendants(h.content()).some(node => node.tagName === 'pre' && node.children.includes('Earlier semantic evidence')));
  assert.equal(h.content().find('Save Check evidence'), undefined);
  assert.ok(descendants(h.content()).some(node => node.children?.some(text => typeof text === 'string' && text.includes('review the current candidate afresh'))));
});


test('rendered change review includes the complete captured Style when no Point changes exist', async () => {
  const h = await harness(), saved = draft();
  const beforeStyle = { id: 'old-convention', revision: '1', title: 'Original convention', body: 'Earlier scope.', html: '<p>Earlier scope.</p>' };
  const afterStyle = { id: 'local-convention', revision: '2', title: 'Local convention', body: 'Keep each qualification with its owning explanation.', html: '<p>Keep each qualification with its owning explanation.</p>' };
  const preview = { revision: saved.revision, before: { atlas: { style: beforeStyle, points: [], facets: [] } }, after: { atlas: { style: afterStyle, points: [], facets: [] } } };
  h.setReply(async endpoint => { assert.equal(endpoint, 'drafts/saved/preview'); return preview; });
  await h.semanticComparison(saved);
  let nodes = descendants(h.content());
  assert.ok(nodes.some(node => node.children?.includes('Original convention')));
  assert.ok(nodes.some(node => node.children?.includes('local-convention · revision 2')));
  assert.ok(nodes.some(node => node.innerHTML === beforeStyle.html));
  assert.ok(nodes.some(node => node.innerHTML === afterStyle.html));
  preview.before.atlas = null;
  await h.semanticComparison(saved);
  nodes = descendants(h.content());
  assert.ok(nodes.some(node => node.children?.includes('No captured style')));
  assert.ok(nodes.some(node => node.innerHTML === afterStyle.html));
});

test('Style choices restore their complete definition and retain separate unfinished revisions', async () => {
  const h = await harness();
  const captured = '---\n{"id":"local-policy","revision":"2"}\n---\n# Local policy\n\nKeep the captured qualifications.\n';
  const curated = '---\n{"id":"concise-subjects","revision":"1"}\n---\n# Concise subjects\n\nKeep extended arguments in sources.\n';
  h.setReply(async endpoint => {
    if (endpoint === 'styles') return {
      current: { id: 'local-policy', revision: '2', title: 'Local policy', path: 'style.md', html: '<p>Keep the captured qualifications.</p>' },
      styles: [{ id: 'concise-subjects', title: 'Concise subjects', content: curated, html: '<p>Keep extended arguments in sources.</p>' }],
    };
    if (endpoint === 'files') return { identity: 'original', files: [{ path: 'style.md', content: captured }] };
    if (endpoint === 'style') return draft();
    throw new Error(`Unexpected request: ${endpoint}`);
  });
  await h.styleDialog();
  const fields = descendants(h.content()), picker = fields.find(node => node.tagName === 'select'), content = fields.find(node => node.tagName === 'textarea');
  const choose = value => { picker.value = value; picker.listeners.get('change')(); };
  assert.equal(content.value, captured);
  choose('concise-subjects');
  assert.equal(content.value, curated);
  choose('');
  assert.equal(content.value, captured);
  content.value += '\nA local revision in progress.\n';
  const revisedCaptured = content.value;
  choose('concise-subjects');
  content.value += '\nA separate custom adjustment.\n';
  const revisedCurated = content.value;
  choose('');
  assert.equal(content.value, revisedCaptured);
  choose('concise-subjects');
  assert.equal(content.value, revisedCurated);
  choose('');
  await h.content().find('Prepare explicit style change').listeners.get('click')();
  assert.equal(h.requests.at(-1).endpoint, 'style');
  assert.equal(h.requests.at(-1).body.styleContent, revisedCaptured);
});
