import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
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
  const context = vm.createContext({ document, location, URLSearchParams, URL,
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
  const api = await vm.runInContext(`(async () => { ${source}\nreturn { el, edited, editDialog, openDialog, closeDialog, saveForReview, reviewDraft, editRecords, refresh, get editor() { return state.editor; } }; })()`, context);
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
