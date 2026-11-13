import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, StyleChoices, comparisonBlocks } from '../ui/store.ts';
import { layoutTree, readerSearch } from '../ui/model.ts';

// Drive the Portal's behavior with controlled service replies. The drawing of these
// states, keyboard paths and accessibility are checked in the browser (portal.browser.spec.mjs).
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const draft = (revision = 'a'.repeat(64)) => ({ id: 'saved', revision, plan: { status: 'ready', reason: 'Reviewed change', baseline: { identity: 'original' }, changes: [], candidate: { files: [] }, validation: { diagnostics: [] } } });
const form = { kind: 'newTree', files: { identity: 'original', files: [] } };
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ search = '' } = {}) {
  const requests = [], pushed = [], replaced = [];
  let reply = async endpoint => {
    if (endpoint === 'view') return { identity: 'original', editable: true, atlas: null, diagnostics: [], canInitialize: true };
    throw new Error(`Unexpected request: ${endpoint}`);
  };
  const host = {
    publication: false,
    api: async (endpoint, body, method) => { requests.push({ endpoint, body, method }); return reply(endpoint, body); },
    readPublication: async () => { throw new Error('Not a publication.'); },
    location: () => ({ pathname: '/', search, hash: '', href: `http://127.0.0.1/${search}`, origin: 'http://127.0.0.1' }),
    history: { push: (state, url) => pushed.push({ state, url }), replace: (state, url) => replaced.push({ state, url }), back() {} },
    later: () => 1, cancel() {}, frame() {},
  };
  const store = new Store(host);
  return { store, requests, pushed, replaced, setReply: value => { reply = value; } };
}

test('Close, Escape, replacement and unload preserve unfinished text unless discard is explicit', async () => {
  const { store } = harness();
  store.editDialog('Edit', form); store.edited();
  const dialog = store.state.dialog;
  assert.equal(store.closeDialog(), false);
  assert.equal(store.state.dialog, dialog); assert.equal(store.state.unsaved, true);
  store.keepEditing();
  assert.equal(store.state.unsaved, false); assert.equal(store.state.dialog, dialog); assert.equal(store.editor.dirty, true);
  assert.equal(store.openDialog('Other', { kind: 'checks' }), false);
  // Escape reaches the store as a request to close the dialog, and is refused the same way.
  assert.equal(store.closeDialog(), false); assert.equal(store.state.dialog, dialog);
  const unload = { preventDefault() { this.prevented = true; } };
  store.beforeUnload(unload);
  assert.equal(unload.prevented, true); assert.equal(unload.returnValue, '');
  store.discardEdits();
  assert.equal(store.state.dialog, null); assert.equal(store.editor, null); assert.equal(store.state.unsaved, false);
  store.beforeUnload({ preventDefault() { throw new Error('No unfinished edits remain.'); } });
});

test('typing during a save keeps newer text and binds the next save to the acknowledged revision', async () => {
  const h = harness(), { store } = h, saving = deferred();
  store.editDialog('Edit', form); store.edited();
  const dialog = store.state.dialog;
  h.setReply(async endpoint => { assert.equal(endpoint, 'drafts'); return saving.promise; });
  const first = store.saveForReview('original', [{ path: 'atlas.json', content: 'First version' }], 'First');
  assert.equal(store.closeDialog(), false); assert.equal(store.state.dialog, dialog);
  assert.equal(store.state.notice.message, 'Wait for this draft save to finish before leaving.');
  store.edited();
  saving.resolve(draft()); await first;
  assert.equal(store.state.dialog, dialog, 'the form holding the newer text stays open');
  assert.equal(store.editor.dirty, true); assert.equal(store.editor.draftId, 'saved'); assert.equal(store.editor.revision, 'a'.repeat(64));
  assert.match(store.state.notice.message, /newer changes are still unsaved/u);
  h.setReply(async () => draft('b'.repeat(64)));
  await store.saveForReview('original', [{ path: 'atlas.json', content: 'Newer version' }], 'Second');
  const request = h.requests.at(-1).body;
  assert.equal(request.baseline, 'original'); assert.equal(request.id, 'saved'); assert.equal(request.expectedRevision, 'a'.repeat(64));
  assert.equal(request.changes[0].content, 'Newer version'); assert.equal(store.editor, null);
  assert.equal(store.state.dialog.view.kind, 'review');
});

test('failed save retains the form, original baseline and unfinished-text warning', async () => {
  const h = harness(), { store } = h;
  store.editDialog('Edit', form, draft()); store.edited();
  const dialog = store.state.dialog;
  h.setReply(async () => { throw new Error('Storage unavailable'); });
  await assert.rejects(store.saveForReview('original', [], 'Keep me'), /Storage unavailable/);
  assert.equal(store.state.dialog, dialog); assert.equal(store.editor.dirty, true); assert.equal(store.editor.saving, false);
  assert.equal(h.requests.at(-1).body.expectedRevision, 'a'.repeat(64));
});

test('late application cannot close or relabel a newly opened editing buffer', async () => {
  const h = harness(), { store } = h, applied = deferred();
  h.setReply(async endpoint => endpoint === 'apply' ? applied.promise : { identity: 'updated', editable: true, atlas: null, diagnostics: [] });
  store.reviewDraft(draft());
  const applying = store.applyDraft(store.state.dialog.view.draft);
  store.editDialog('Edit another record', form); store.edited();
  const dialog = store.state.dialog;
  applied.resolve({ status: 'complete' }); await applying;
  assert.equal(store.state.dialog, dialog); assert.equal(store.state.dialog.title, 'Edit another record'); assert.equal(store.editor.dirty, true);
  assert.equal(h.requests.find(item => item.endpoint === 'apply').body.expectedRevision, 'a'.repeat(64));
});

test('overview opens the current Tree base and is unavailable for an excluded publication base', async () => {
  const h = harness(), { store } = h;
  const view = { diagnostics: [], atlas: {
    title: 'Project', trees: [{ id: 'experience', title: 'Experience', scope: 'The writer’s account.', base: 'purpose', children: [], path: 'trees/experience/tree.json' }],
    points: [{ id: 'purpose', tree: 'experience', title: 'Keep writing offline', body: 'Explain the promise.', html: '<p>Explain the promise.</p>', path: 'p.md' }],
    branches: [], facets: [],
  } };
  h.setReply(async () => view);
  await store.refresh();
  assert.equal(store.overview?.title, 'Keep writing offline');
  store.readOverview();
  assert.deepEqual(store.state.selected, { kind: 'point', id: 'purpose', tree: 'experience' });
  assert.equal(h.pushed.at(-1).url, '/?tree=experience&point=purpose');
  view.atlas.points[0].publicationAvailable = false;
  await store.refresh();
  assert.equal(store.overview, undefined);
  h.setReply(async () => ({ atlas: null, canInitialize: true, diagnostics: [] }));
  await store.refresh();
  assert.equal(store.state.tree, null); assert.equal(store.state.selected, null);
});

test('source inspection requires explicit selection and never silently replaces required bytes', async () => {
  const h = harness(), { store } = h;
  store.editDialog('Edit', form);
  const controls = store.byteRequirements([{ uri: 'report.md' }]);
  assert.equal(controls.canRequire('report.md'), false);
  h.setReply(async (endpoint, body) => { assert.equal(endpoint, 'sources/review'); assert.deepEqual(body.uris, ['report.md']); return { results: [{ uri: 'report.md', status: 'current', sha256: 'a'.repeat(64), reason: 'Read explicit source.' }] }; });
  await controls.inspect('report.md');
  assert.equal(controls.canRequire('report.md'), true); assert.equal(controls.selected().length, 0);
  controls.toggle('report.md', true);
  assert.equal(controls.selected()[0].sha256, 'a'.repeat(64));
  h.setReply(async () => ({ results: [{ uri: 'report.md', status: 'changed', sha256: 'b'.repeat(64), reason: 'Changed bytes.' }] }));
  await controls.inspect('report.md');
  assert.equal(controls.selected()[0].sha256, 'a'.repeat(64));
  assert.match(controls.status.get('report.md'), /differs from the selected bytes/u);
  controls.toggle('report.md', false);
  await controls.inspect('report.md');
  controls.toggle('report.md', true);
  assert.equal(controls.selected()[0].sha256, 'b'.repeat(64));
});

test('a late source read cannot replace an editing buffer opened after it', async () => {
  const h = harness(), { store } = h, reading = deferred();
  h.setReply(async () => reading.promise);
  const pending = store.showSource({ uri: 'report.md' });
  store.editDialog('Edit', form); store.edited();
  const dialog = store.state.dialog;
  reading.resolve({ status: 'ready', content: '# Report', html: '<h1>Report</h1>' });
  await pending; await settle();
  assert.equal(store.state.dialog, dialog); assert.equal(store.editor.dirty, true);
});

test('candidate Check form saves its exact revision and preserves later evidence edits', async () => {
  const h = harness(), { store } = h, saving = deferred(), saved = draft();
  saved.plan.candidate.identity = 'c'.repeat(64);
  saved.plan.candidate.atlas = { checks: [{ id: 'scope', title: 'Scope', body: 'Read the evidence.', status: 'active', level: 'required', revision: 'd'.repeat(64) }] };
  store.reviewCandidateChecks(saved);
  const dialog = store.state.dialog;
  store.edited();
  h.setReply(async () => saving.promise);
  const pending = store.saveCheckEvidence(saved, 'Reviewer', [{ check: saved.plan.candidate.atlas.checks[0], outcome: 'unable', reason: 'Source unavailable.', evidence: '' }]);
  store.edited();
  saving.resolve({ ...saved, revision: 'b'.repeat(64) }); await pending;
  assert.equal(store.editor.revision, 'b'.repeat(64)); assert.equal(store.editor.dirty, true); assert.equal(store.state.dialog, dialog);
  const request = h.requests.at(-1).body;
  assert.equal(request.expectedRevision, 'a'.repeat(64)); assert.equal(request.manual[0].baseline, saved.plan.candidate.identity);
  assert.equal(request.manual[0].revision, 'd'.repeat(64));
  await assert.rejects(store.saveCheckEvidence(saved, ' ', []), /Enter a reviewer name/u);
  await assert.rejects(store.saveCheckEvidence(saved, 'Reviewer', [{ check: saved.plan.candidate.atlas.checks[0], outcome: 'unreviewed', reason: '', evidence: '' }]), /Review at least one Check/u);
});

test('recovered Check notes never become evidence for a newer candidate revision', async () => {
  const h = harness(), { store } = h;
  const copy = { id: 'typing', revision: 'c'.repeat(64), baseline: 'original', form: { kind: 'checks', title: 'Candidate review', context: { draftId: 'saved', draftRevision: 'a'.repeat(64) }, fields: { controls: [{ value: 'Earlier semantic evidence' }] } } };
  h.setReply(async endpoint => endpoint === 'working-copies/typing' ? copy : draft('b'.repeat(64)));
  await store.recoverWorkingCopy('typing');
  assert.equal(store.editor, null);
  assert.equal(store.state.dialog.view.kind, 'earlierNotes');
  assert.equal(store.state.dialog.title, 'Earlier candidate review notes');
  assert.match(store.state.dialog.view.text, /Earlier semantic evidence/u);
});

test('recovered typing reopens its own form with its exact fields and private copy', async () => {
  const h = harness(), { store } = h;
  const captured = { identity: 'original', files: [{ path: 'atlas.json', content: '{}' }] };
  const fields = { controls: [{ value: 'demo', checked: false, type: 'text' }, { value: 'Demo', checked: false, type: 'text' }, { value: 'Scope', checked: false, type: 'text' }, { value: 'Body', type: 'textarea' }] };
  const copy = { id: 'typing', revision: 'r1', baseline: 'original', form: { kind: 'new-tree', title: 'New Tree', context: { kind: 'new-tree', captured }, fields } };
  h.setReply(async endpoint => { if (endpoint === 'working-copies/typing') return copy; if (endpoint === 'view') return { identity: 'original', editable: true, diagnostics: [], atlas: { title: 'A', trees: [], points: [], branches: [], facets: [] } }; throw new Error(endpoint); });
  await store.refresh();
  await store.recoverWorkingCopy('typing');
  assert.equal(store.state.dialog.view.kind, 'newTree');
  assert.deepEqual(store.state.dialog.view.recovered, fields);
  assert.equal(store.editor.working, copy); assert.equal(store.editor.dirty, true);
  assert.equal(store.state.autosave.text, 'Recovered private typing. Review it before saving a candidate.');
  assert.equal(h.requests.filter(item => item.endpoint === 'files').length, 0, 'the recovery copy keeps the files it was typed against');
});

test('rendered change review includes the complete captured Style when no Point changes exist', async () => {
  const h = harness(), { store } = h, saved = draft();
  const beforeStyle = { id: 'old-convention', revision: '1', title: 'Original convention', body: 'Earlier scope.', html: '<p>Earlier scope.</p>' };
  const afterStyle = { id: 'local-convention', revision: '2', title: 'Local convention', body: 'Keep each qualification with its owning explanation.', html: '<p>Keep each qualification with its owning explanation.</p>' };
  const preview = { revision: saved.revision, before: { atlas: { style: beforeStyle, points: [], facets: [] } }, after: { atlas: { style: afterStyle, points: [], facets: [] } } };
  h.setReply(async endpoint => { assert.equal(endpoint, 'drafts/saved/preview'); return preview; });
  await store.semanticComparison(saved);
  let [block] = store.state.dialog.view.blocks;
  assert.deepEqual(block.before, { title: 'Original convention', meta: 'old-convention · revision 1', html: beforeStyle.html });
  assert.deepEqual(block.after, { title: 'Local convention', meta: 'local-convention · revision 2', html: afterStyle.html });
  preview.before.atlas = null;
  [block] = comparisonBlocks(preview);
  assert.equal(block.before, null); assert.equal(block.after.html, afterStyle.html);
});

test('Style choices restore their complete definition and retain separate unfinished revisions', async () => {
  const h = harness(), { store } = h;
  const captured = '---\n{"id":"local-policy","revision":"2"}\n---\n# Local policy\n\nKeep the captured qualifications.\n';
  const curated = '---\n{"id":"concise-subjects","revision":"1"}\n---\n# Concise subjects\n\nKeep extended arguments in sources.\n';
  const choices = new StyleChoices(captured, [{ id: 'concise-subjects', content: curated }]);
  let content = captured;
  content = choices.choose('concise-subjects', content); assert.equal(content, curated);
  content = choices.choose('', content); assert.equal(content, captured);
  content += '\nA local revision in progress.\n';
  const revisedCaptured = content;
  content = choices.choose('concise-subjects', content);
  content += '\nA separate custom adjustment.\n';
  const revisedCurated = content;
  content = choices.choose('', content); assert.equal(content, revisedCaptured);
  content = choices.choose('concise-subjects', content); assert.equal(content, revisedCurated);
  content = choices.choose('', content);
  h.setReply(async endpoint => {
    if (endpoint === 'view') return { identity: 'original', editable: true, diagnostics: [], atlas: { title: 'A', trees: [], points: [], branches: [], facets: [], style: { id: 'local-policy' } } };
    if (endpoint === 'styles') return { current: { id: 'local-policy', revision: '2', title: 'Local policy', path: 'style.md', html: '<p>Keep the captured qualifications.</p>' }, styles: [{ id: 'concise-subjects', title: 'Concise subjects', content: curated, html: '<p>Keep extended arguments in sources.</p>' }] };
    if (endpoint === 'files') return { identity: 'original', files: [{ path: 'style.md', content: captured }] };
    if (endpoint === 'style') return draft();
    throw new Error(`Unexpected request: ${endpoint}`);
  });
  await store.refresh();
  await store.styleDialog();
  const view = store.state.dialog.view;
  assert.equal(view.kind, 'style');
  assert.equal(view.files.files[0].content, captured);
  await store.saveStyle(view.files, content, 'Revise the Atlas authoring style');
  assert.equal(h.requests.at(-1).endpoint, 'style');
  assert.equal(h.requests.at(-1).body.styleContent, revisedCaptured);
});

test('addresses reopen the selection, and in-reader links keep the selection in history', async () => {
  const h = harness({ search: '?tree=product&point=detail' }), { store } = h;
  const atlas = {
    title: 'A', trees: [{ id: 'product', title: 'Product', base: 'base', children: [{ point: 'detail' }], path: 'trees/product/tree.json' }],
    points: [{ id: 'base', tree: 'product', title: 'Base', path: 'a.md', sources: [{ uri: 'sources/brief.md' }] }, { id: 'detail', tree: 'product', title: 'Detail', path: 'b.md', ancestors: [{ kind: 'point', id: 'base', tree: 'product' }] }],
    branches: [], facets: [],
  };
  h.setReply(async endpoint => endpoint === 'view' ? { identity: 'x', diagnostics: [], atlas } : { status: 'ready', content: 'Brief' });
  await store.start();
  assert.deepEqual(store.state.selected, { kind: 'point', id: 'detail', tree: 'product' });
  assert.equal(readerSearch({ kind: 'facet', id: 'f', tree: 'product' }), '?tree=product&facet=f');
  assert.equal(store.navigateHref('http://127.0.0.1/?tree=product&point=base&source=sources%2Fbrief.md&sourceIndex=0'), true);
  await settle();
  assert.equal(store.state.selected.kind, 'source'); assert.equal(store.state.selected.owner.id, 'base');
  assert.equal(store.state.backAvailable, true);
  assert.equal(store.navigateHref('https://example.test/?tree=product&point=base'), false, 'other sites are left to the browser');
  const layout = layoutTree(atlas, atlas.trees[0], { query: 'detail' });
  assert.deepEqual(layout.nodes.map(node => [node.id, node.match]), [['base', false], ['detail', true]], 'a match keeps its ancestors, marked as context');
  assert.equal(`${layout.matches} of ${layout.total}`, '1 of 2');
});
