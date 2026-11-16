import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tempDirectory } from '../../tests/support/temp.mjs';
import { openAtlas, validateFiles, citedMaterial, readSource, observeSource } from '../src/model.mjs';
import { staleSources, prepareStamp } from '../src/references.mjs';
import { saveDraft, applyDraft } from '../src/authoring.mjs';

/** Applying takes a saved draft and its exact revision: a plan is saved, then applied as a draft. */
async function applyPlan(root, plan, options = {}) {
  const draft = await saveDraft(root, { plan });
  return applyDraft(root, draft.id, { expectedRevision: draft.revision, ...options });
}

const sha = value => createHash('sha256').update(value).digest('hex');
const record = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const design = '# Design\n\nIntroduction.\n\n## Storage\n\nNotes stay in local files.\n\n### Format\n\nOne JSON line for each edit.\n\n## Sync\n\nDelivery comes later.\n';
const storage = '## Storage\n\nNotes stay in local files.\n\n### Format\n\nOne JSON line for each edit.\n\n';
const trace = Buffer.from([0xff, 0x00, 0x01, 0xfe]);

function authored(stamps = {}) {
  const source = (uri, extra = {}) => ({ uri, ...extra, ...(stamps[uri] ? { sha256: stamps[uri] } : {}) });
  return new Map([
    ['atlas.json', JSON.stringify({ format: 'atlas/1.2', id: 'notes', title: 'Notes', trees: ['trees/product', 'trees/system'] })],
    ['style.md', '# Policy\n\nCite the part that was read.\n'],
    ['trees/product/tree.json', JSON.stringify({ id: 'product', title: 'Product', scope: 'What writers can rely on.', base: 'purpose', children: [{ point: 'offline' }] })],
    ['trees/system/tree.json', JSON.stringify({ id: 'system', title: 'System', scope: 'How it is built.', base: 'runtime', children: [] })],
    ['trees/product/points/purpose.md', record({ id: 'purpose', sources: [source('docs/design.md#storage', { role: 'evidence', locator: 'Storage' }), source('https://example.org/spec')] }, 'Writers keep their notes', 'Notes survive a restart.')],
    ['trees/product/points/offline.md', record({ id: 'offline', sources: [source('docs/design.md'), source('docs/missing.md'), source('../outside.md')] }, 'Writers can work offline', 'Edits are kept locally.')],
    ['trees/product/facets/reading.md', record({ id: 'reading', on: 'offline', via: 'system', targets: ['runtime'], sources: [source('docs/design.md#storage')] }, 'Offline work rests on the runtime', 'The runtime decides what is kept.')],
    ['trees/system/points/runtime.md', record({ id: 'runtime', sources: [source('data/trace.bin', { role: 'evidence' })] }, 'The runtime writes a trace', 'One recorded run.')],
  ]);
}

async function fixture(t, stamps) {
  const directory = await tempDirectory('atlas-sources-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'atlas');
  for (const [file, content] of authored(stamps)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  await fs.mkdir(path.join(root, 'docs')); await fs.mkdir(path.join(root, 'data'));
  await fs.writeFile(path.join(root, 'docs/design.md'), design);
  await fs.writeFile(path.join(root, 'data/trace.bin'), trace);
  await fs.writeFile(path.join(directory, 'outside.md'), 'Kept beside the Atlas.\n');
  const view = await openAtlas(root);
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return { directory, root, view };
}
const current = { 'docs/design.md#storage': sha(storage), 'docs/design.md': sha(design), 'data/trace.bin': sha(trace), 'docs/missing.md': 'a'.repeat(64), '../outside.md': sha('Kept beside the Atlas.\n') };

test('a fragment into a local Markdown file cites the section of the heading it names, or nothing; every other reference cites the whole file', () => {
  const whole = { scope: 'file', start: 0, end: Buffer.byteLength(design), bytes: Buffer.byteLength(design), sha256: sha(design) };
  assert.deepEqual(citedMaterial('docs/design.md', design), whole);
  assert.deepEqual(citedMaterial('docs/design.md#storage', design), { scope: 'section', heading: 'storage', start: design.indexOf('## Storage'), end: design.indexOf('## Sync'), bytes: Buffer.byteLength(storage), sha256: sha(storage) });
  const format = citedMaterial('docs/design.md#format', design);
  assert.equal(design.slice(format.start, format.end), '### Format\n\nOne JSON line for each edit.\n\n');
  const last = citedMaterial('docs/design.md#sync', design);
  assert.equal(design.slice(last.start, last.end), '## Sync\n\nDelivery comes later.\n');
  assert.equal(last.end, Buffer.byteLength(design));
  assert.deepEqual(citedMaterial('docs/design.md#design', design), { ...whole, scope: 'section', heading: 'design' });
  for (const uri of ['docs/design.txt#storage', 'docs/design.txt#absent', 'https://example.org/design.md#absent']) assert.deepEqual(citedMaterial(uri, design), whole, uri);
  // A fragment that names no heading of the Markdown file is not a reference to the whole file.
  for (const uri of ['docs/design.md#absent', 'docs/design.md#', 'docs/design.md#Storage', 'docs/design.md#%zz', 'docs/DESIGN.MD#absent', 'docs/design%2Emd#absent']) assert.equal(citedMaterial(uri, design), null, uri);
  assert.equal(citedMaterial('docs/design%2Emd#storage', design).scope, 'section');
  assert.equal(citedMaterial('docs/DESIGN.MD#storage', design).scope, 'section');
  assert.deepEqual(citedMaterial('docs/design.md#storage', Buffer.from(design)), citedMaterial('docs/design.md#storage', design));
});

test('a section is exact bytes: line endings, repeated and Unicode headings, setext headings and quoted headings', () => {
  const text = 'Résumé\r\n======\r\n\r\nOpening.\r\n\r\nLimits\r\n------\r\n\r\nFirst limits.\r\n\r\n> ## Quoted\r\n> An aside.\r\n\r\nStill the first limits.\r\n\r\n## Résumé & **scope**\r\n\r\nDetails.\r\n\r\n## Limits\r\n\r\nSecond limits.';
  const bytes = Buffer.from(text);
  const section = uri => { const cited = citedMaterial(uri, bytes); assert.equal(cited.sha256, sha(bytes.subarray(cited.start, cited.end))); assert.equal(cited.bytes, cited.end - cited.start); return bytes.subarray(cited.start, cited.end).toString(); };
  assert.equal(section('notes.md#limits'), 'Limits\r\n------\r\n\r\nFirst limits.\r\n\r\n> ## Quoted\r\n> An aside.\r\n\r\nStill the first limits.\r\n\r\n');
  assert.equal(section('notes.md#limits-1'), '## Limits\r\n\r\nSecond limits.');
  assert.equal(section('notes.md#r%C3%A9sum%C3%A9--scope'), '## Résumé & **scope**\r\n\r\nDetails.\r\n\r\n');
  assert.equal(section('notes.md#quoted'), '> ## Quoted\r\n> An aside.\r\n\r\nStill the first limits.\r\n\r\n');
  assert.equal(section('notes.md#r%C3%A9sum%C3%A9'), text);
  // Bytes that are not text hold no heading: without a fragment they are cited whole, with one they are not cited.
  assert.equal(citedMaterial('notes.md', trace).sha256, sha(trace));
  assert.equal(citedMaterial('notes.md#limits', trace), null);
});

test('a record cited as a source: its header is not a heading, and its sections keep their bytes', () => {
  for (const ending of ['\n', '\r\n']) {
    const text = ['---', '{"id":"whole-read","status":"active","level":"advisory"}', '---', '# Whole read', '', 'Read it whole.', '', '## Scope', '', 'Every Point.', ''].join(ending);
    const bytes = Buffer.from(text);
    // Without the rule, the header line over its closing --- reads as a setext heading.
    assert.equal(citedMaterial('.checks/whole-read.md#idwhole-readstatusactiveleveladvisory', bytes), null, JSON.stringify(ending));
    const scope = citedMaterial('.checks/whole-read.md#scope', bytes);
    assert.equal(scope.start, text.indexOf('## Scope'));
    assert.equal(scope.end, bytes.length);
    assert.equal(scope.sha256, sha(text.slice(text.indexOf('## Scope'))));
    const title = citedMaterial('.checks/whole-read.md#whole-read', bytes);
    assert.equal(title.start, text.indexOf('# Whole read'));
  }
  // A text that begins with a rule and no JSON header keeps its setext heading.
  assert.equal(citedMaterial('notes.md#a-heading', '---\nA heading\n---\n\nText.\n').scope, 'section');
});

test('a source read returns the file, says what the reference cites, and says whether its stamp still matches', async t => {
  const { root, view } = await fixture(t);
  const read = await readSource(view, { uri: 'docs/design.md#storage' });
  assert.deepEqual(Object.keys(read), ['status', 'source', 'path', 'content', 'bytes', 'sha256', 'cited', 'stamp', 'message']);
  assert.deepEqual([read.status, read.content, read.bytes, read.sha256, read.stamp], ['ready', design, Buffer.byteLength(design), sha(design), 'unstamped']);
  assert.deepEqual(read.cited, citedMaterial('docs/design.md#storage', design));
  assert.equal((await readSource(view, { uri: 'docs/design.md#storage', sha256: sha(storage) })).stamp, 'current');
  // The stamp is the section's hash: the whole file's hash does not match a section reference.
  const whole = await readSource(view, { uri: 'docs/design.md#storage', sha256: sha(design) });
  assert.deepEqual([whole.status, whole.stamp, whole.content, whole.cited.sha256], ['ready', 'changed', design, sha(storage)]);
  const later = design.replace('Delivery comes later.', 'Delivery is immediate.');
  await fs.writeFile(path.join(root, 'docs/design.md'), later);
  assert.equal((await readSource(view, { uri: 'docs/design.md#storage', sha256: sha(storage) })).stamp, 'current');
  assert.equal((await readSource(view, { uri: 'docs/design.md', sha256: sha(design) })).stamp, 'changed');
  const rewritten = design.replace('local files', 'a local database');
  await fs.writeFile(path.join(root, 'docs/design.md'), rewritten);
  const changed = await readSource(view, { uri: 'docs/design.md#storage', sha256: sha(storage) });
  assert.deepEqual([changed.status, changed.stamp, changed.content, changed.code], ['ready', 'changed', rewritten, undefined]);
  assert.equal(changed.message, 'The cited material changed after this reference was stamped. A separate local reading observation; source content is not part of the authored view identity.');
  assert.equal(read.message, 'A separate local reading observation; source content is not part of the authored view identity.');
  assert.equal((await readSource(view, { uri: 'data/trace.bin' })).code, 'FILE_UTF8');
  assert.equal((await readSource(view, { uri: 'https://example.org/spec', sha256: 'a'.repeat(64) })).stamp, undefined);
});

test('observing a source reports its current stamp without content or comparison, for any bytes', async t => {
  const { directory, view } = await fixture(t);
  const observed = await observeSource(view, { uri: 'docs/design.md#storage', sha256: '0'.repeat(64) });
  assert.deepEqual(Object.keys(observed), ['status', 'source', 'path', 'cited', 'message']);
  assert.equal(observed.status, 'ready');
  assert.equal(observed.cited.sha256, sha(storage));
  const binary = await observeSource(view, { uri: 'data/trace.bin#storage' });
  assert.deepEqual(binary.cited, { scope: 'file', start: 0, end: 4, bytes: 4, sha256: sha(trace) });
  assert.equal((await observeSource(view, { uri: 'docs/missing.md' })).status, 'missing');
  assert.deepEqual([(await observeSource(view, { uri: '../outside.md' })).status, (await observeSource(view, { uri: '../outside.md' })).code], ['denied', 'SOURCE_DENIED']);
  assert.equal((await observeSource(view, { uri: '../outside.md' }, { allowedRoots: [directory] })).cited.sha256, current['../outside.md']);
  assert.equal((await observeSource(view, { uri: 'docs' })).code, 'FILE_KIND');
  assert.equal((await observeSource(view, { uri: 'docs/design.md' }, { maxBytes: 4 })).status, 'incomplete');
  assert.equal((await observeSource(view, { uri: 'https://example.org/spec' })).status, 'reference');
  assert.equal((await observeSource(view, { uri: '/etc/passwd' })).code, 'SOURCE_INVALID');
});

test('a read of a reference whose fragment names no heading returns the file and says the reference cites nothing', async t => {
  const { root, view } = await fixture(t);
  const uri = 'docs/design.md#storage-engine';
  for (const stamp of [{}, { sha256: sha(design) }, { sha256: sha(storage) }]) {
    const read = await readSource(view, { uri, ...stamp });
    assert.deepEqual(Object.keys(read), ['status', 'source', 'path', 'content', 'bytes', 'sha256', 'cited', 'stamp', 'code', 'message']);
    assert.deepEqual([read.status, read.source, read.content, read.bytes, read.sha256, read.cited, read.stamp, read.code], ['ready', { uri, ...stamp }, design, Buffer.byteLength(design), sha(design), null, 'missing', 'SOURCE_HEADING_MISSING']);
    assert.equal(read.message, 'The fragment names no heading in the cited file, so the reference cites nothing. A separate local reading observation; source content is not part of the authored view identity.');
  }
  assert.deepEqual(await observeSource(view, { uri }), { status: 'ready', source: { uri }, path: path.join(root, 'docs/design.md'), cited: null, code: 'SOURCE_HEADING_MISSING', message: 'The fragment names no heading in the cited file, so the reference cites nothing.' });
  // Only a Markdown file has headings to name: the same fragment into another file cites that file whole.
  await fs.writeFile(path.join(root, 'docs/design.txt'), design);
  const text = await readSource(view, { uri: 'docs/design.txt#storage-engine', sha256: sha(design) });
  assert.deepEqual([text.stamp, text.cited.scope, text.code], ['current', 'file', undefined]);
});

test('the stale report gives every reference one status', async t => {
  const { directory, root, view } = await fixture(t);
  const unstamped = await staleSources(view);
  assert.equal(unstamped.format, 'atlas.stale/1');
  assert.deepEqual(unstamped.counts, { references: 7, current: 0, changed: 0, missing: 1, denied: 0, unstamped: 5, remote: 1 });
  assert.deepEqual(unstamped.references.map(item => [item.from.kind, item.from.id, item.sourceIndex, item.source.uri, item.status]), [
    ['point', 'offline', 0, 'docs/design.md', 'unstamped'], ['point', 'offline', 1, 'docs/missing.md', 'missing'], ['point', 'offline', 2, '../outside.md', 'unstamped'],
    ['point', 'purpose', 0, 'docs/design.md#storage', 'unstamped'], ['point', 'purpose', 1, 'https://example.org/spec', 'remote'],
    ['point', 'runtime', 0, 'data/trace.bin', 'unstamped'], ['facet', 'reading', 0, 'docs/design.md#storage', 'unstamped'],
  ]);
  assert.deepEqual(unstamped.summary, [{ uri: 'docs/missing.md', status: 'missing', citers: [{ kind: 'point', id: 'offline', tree: 'product', path: 'trees/product/points/offline.md' }] }]);
  assert.deepEqual(unstamped.bounds, { limit: 100, offset: 0, references: { available: 7, returned: 7 }, summary: { available: 1, returned: 1 }, unread: 0, exhaustive: true, next: null });

  const stamped = validateFiles(authored(current), { root });
  assert.equal(stamped.status, 'ready', JSON.stringify(stamped.diagnostics));
  const report = await staleSources(stamped);
  assert.deepEqual(report.counts, { references: 7, current: 4, changed: 0, missing: 1, denied: 1, unstamped: 0, remote: 1 });
  const byUri = uri => report.references.find(item => item.source.uri === uri);
  assert.deepEqual(byUri('docs/design.md#storage').cited, citedMaterial('docs/design.md#storage', design));
  assert.equal(byUri('data/trace.bin').status, 'current');
  assert.deepEqual([byUri('docs/missing.md').status, byUri('docs/missing.md').reason, byUri('docs/missing.md').cited], ['missing', 'The cited file does not exist.', undefined]);
  assert.deepEqual([byUri('../outside.md').status, byUri('../outside.md').code], ['denied', 'SOURCE_DENIED']);
  assert.deepEqual(report.references[3].from, { kind: 'point', id: 'purpose', tree: 'product', path: 'trees/product/points/purpose.md' });
  assert.deepEqual(report.references[6].from, { kind: 'facet', id: 'reading', tree: 'product', path: 'trees/product/facets/reading.md', on: 'offline' });
  assert.deepEqual(report.references[3].source, { uri: 'docs/design.md#storage', role: 'evidence', locator: 'Storage', sha256: sha(storage) });
  assert.deepEqual(report.summary, [{ uri: 'docs/missing.md', status: 'missing', citers: [{ kind: 'point', id: 'offline', tree: 'product', path: 'trees/product/points/offline.md' }] }]);
  assert.equal((await staleSources(stamped, { allowedRoots: [directory] })).counts.denied, 0);
  // Without a grant nothing is read, so a missing file is not told apart from a present one.
  assert.deepEqual((await staleSources(stamped, { allowedRoots: [] })).counts, { references: 7, current: 0, changed: 0, missing: 0, denied: 6, unstamped: 0, remote: 1 });

  // A change outside the cited section leaves the section current and the whole file changed.
  await fs.writeFile(path.join(root, 'docs/design.md'), design.replace('Delivery comes later.', 'Delivery is immediate.'));
  const outside = await staleSources(stamped);
  assert.deepEqual(outside.references.map(item => item.status), ['changed', 'missing', 'denied', 'current', 'remote', 'current', 'current']);
  assert.deepEqual(outside.summary.map(item => [item.uri, item.status, item.citers.map(citer => citer.id)]), [['docs/design.md', 'changed', ['offline']], ['docs/missing.md', 'missing', ['offline']]]);
  // A change inside it is reported once, with the Point and the Facet that cite it.
  await fs.writeFile(path.join(root, 'docs/design.md'), design.replace('local files', 'a local database'));
  await fs.writeFile(path.join(root, 'data/trace.bin'), Buffer.from([0x00]));
  const inside = await staleSources(stamped);
  assert.deepEqual(inside.counts, { references: 7, current: 0, changed: 4, missing: 1, denied: 1, unstamped: 0, remote: 1 });
  assert.deepEqual(inside.summary.map(item => [item.uri, item.status, item.citers.map(citer => `${citer.kind}:${citer.id}`)]), [
    ['docs/design.md', 'changed', ['point:offline']], ['docs/missing.md', 'missing', ['point:offline']],
    ['docs/design.md#storage', 'changed', ['point:purpose', 'facet:reading']], ['data/trace.bin', 'changed', ['point:runtime']],
  ]);
  assert.equal(inside.summary[2].citers[1].on, 'offline');
  assert.equal(inside.references[0].reason, 'The cited material differs from the stamp.');
  assert.equal(stamped.identity, validateFiles(authored(current), { root }).identity);
});

test('a reference to a file that is not there is missing whether or not it is stamped', async t => {
  const { directory, root, view } = await fixture(t);
  const from = { kind: 'point', id: 'offline', tree: 'product', path: 'trees/product/points/offline.md' };
  const entry = (report, uri) => report.references.find(item => item.source.uri === uri);
  assert.deepEqual(entry(await staleSources(view), 'docs/missing.md'), { from, sourceIndex: 1, source: { uri: 'docs/missing.md' }, status: 'missing', reason: 'The cited file does not exist.' });
  const stamped = validateFiles(authored({ 'docs/missing.md': 'a'.repeat(64) }), { root });
  assert.deepEqual(entry(await staleSources(stamped), 'docs/missing.md'), { from, sourceIndex: 1, source: { uri: 'docs/missing.md', sha256: 'a'.repeat(64) }, status: 'missing', reason: 'The cited file does not exist.' });
  // Only a read within the grants can tell. Outside them an unstamped reference stays unstamped and a stamped one is denied.
  const unread = entry(await staleSources(view, { allowedRoots: [] }), 'docs/missing.md');
  assert.deepEqual([unread.status, unread.code, unread.reason], ['unstamped', 'SOURCE_DENIED', 'This local reference carries no stamp and was not read: Source path is outside the caller-supplied roots.']);
  assert.equal(entry(await staleSources(stamped, { allowedRoots: [] }), 'docs/missing.md').status, 'denied');
  await fs.rm(path.join(directory, 'outside.md'));
  assert.equal(entry(await staleSources(view), '../outside.md').status, 'unstamped');
  const wider = await staleSources(view, { allowedRoots: [directory] });
  assert.equal(entry(wider, '../outside.md').status, 'missing');
  assert.deepEqual(wider.counts, { references: 7, current: 0, changed: 0, missing: 2, denied: 0, unstamped: 4, remote: 1 });
  assert.deepEqual(wider.summary.map(item => [item.uri, item.status, item.citers.map(citer => citer.id)]), [['docs/missing.md', 'missing', ['offline']], ['../outside.md', 'missing', ['offline']]]);
  // An unstamped reference to a file that is there stays unstamped.
  await fs.writeFile(path.join(root, 'docs/missing.md'), 'Written later.\n');
  assert.equal(entry(await staleSources(view), 'docs/missing.md').status, 'unstamped');
  assert.deepEqual(entry(await staleSources(view), 'docs/design.md'), { from, sourceIndex: 0, source: { uri: 'docs/design.md' }, status: 'unstamped', reason: 'This local reference carries no stamp.' });
  // A path that runs through a regular file names a file that is not there.
  const through = authored();
  through.set('trees/system/points/runtime.md', record({ id: 'runtime', sources: [{ uri: 'docs/design.md/part' }, { uri: 'docs/design.md/part', sha256: 'a'.repeat(64) }] }, 'The runtime writes a trace', 'One recorded run.'));
  const report = await staleSources(validateFiles(through, { root }));
  assert.deepEqual(report.references.filter(item => item.source.uri === 'docs/design.md/part').map(item => [item.status, item.code, item.reason]), [['missing', undefined, 'The cited file does not exist.'], ['missing', undefined, 'The cited file does not exist.']]);
  assert.deepEqual([(await readSource(view, { uri: 'docs/design.md/part' })).status, (await observeSource(view, { uri: 'docs/design.md/part' })).status], ['missing', 'missing']);
});

test('a fragment that names no heading cites nothing: the stale report calls it missing and a stamp leaves it as it was', async t => {
  const { root } = await fixture(t);
  const broken = 'docs/design.md#storage-engine', reason = 'The fragment names no heading in the cited file, so the reference cites nothing.';
  // One broken reference carries the stamp of the whole file, the other none.
  await fs.writeFile(path.join(root, 'trees/product/points/purpose.md'), record({ id: 'purpose', sources: [{ uri: broken, sha256: sha(design) }, { uri: 'docs/design.md#storage' }] }, 'Writers keep their notes', 'Notes survive a restart.'));
  await fs.writeFile(path.join(root, 'trees/product/facets/reading.md'), record({ id: 'reading', on: 'offline', via: 'system', targets: ['runtime'], sources: [{ uri: broken }] }, 'Offline work rests on the runtime', 'The runtime decides what is kept.'));
  const view = await openAtlas(root);
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  const purpose = { kind: 'point', id: 'purpose', tree: 'product', path: 'trees/product/points/purpose.md' };
  const reading = { kind: 'facet', id: 'reading', tree: 'product', path: 'trees/product/facets/reading.md', on: 'offline' };
  const report = await staleSources(view);
  assert.deepEqual(report.references.filter(item => item.source.uri === broken), [
    { from: purpose, sourceIndex: 0, source: { uri: broken, sha256: sha(design) }, status: 'missing', code: 'SOURCE_HEADING_MISSING', reason },
    { from: reading, sourceIndex: 0, source: { uri: broken }, status: 'missing', code: 'SOURCE_HEADING_MISSING', reason },
  ]);
  assert.deepEqual(report.counts, { references: 7, current: 0, changed: 0, missing: 3, denied: 0, unstamped: 4, remote: 0 });
  assert.deepEqual(report.summary, [
    { uri: 'docs/missing.md', status: 'missing', citers: [{ kind: 'point', id: 'offline', tree: 'product', path: 'trees/product/points/offline.md' }] },
    { uri: broken, status: 'missing', code: 'SOURCE_HEADING_MISSING', citers: [purpose, reading] },
  ]);

  const result = await prepareStamp(root, { all: true });
  assert.deepEqual(result.skipped.filter(item => item.uri === broken), [
    { from: purpose, sourceIndex: 0, uri: broken, status: 'missing', code: 'SOURCE_HEADING_MISSING', reason },
    { from: reading, sourceIndex: 0, uri: broken, status: 'missing', code: 'SOURCE_HEADING_MISSING', reason },
  ]);
  assert.ok(![...result.stamped, ...result.current].some(item => item.uri === broken));
  // The reference beside it is stamped. The broken ones keep what they had: an earlier stamp, or none.
  assert.equal(result.plan.changes.find(change => change.path === purpose.path).after,
    record({ id: 'purpose', sources: [{ uri: broken, sha256: sha(design) }, { uri: 'docs/design.md#storage', sha256: sha(storage) }] }, 'Writers keep their notes', 'Notes survive a restart.'));
  assert.ok(!result.plan.changes.some(change => change.path === reading.path));

  // Once the file has that heading, the references are compared like any other.
  await fs.writeFile(path.join(root, 'docs/design.md'), `${design}\n## Storage engine\n\nA log of edits.\n`);
  assert.deepEqual((await staleSources(view)).references.filter(item => item.source.uri === broken).map(item => [item.status, item.code, item.cited?.heading]), [['changed', undefined, 'storage-engine'], ['unstamped', undefined, undefined]]);
});

test('the stale report is bounded, counts everything and continues against the same Atlas', async t => {
  const { root } = await fixture(t);
  const view = validateFiles(authored({ ...current, 'docs/design.md': 'b'.repeat(64), 'data/trace.bin': 'c'.repeat(64) }), { root });
  const first = await staleSources(view, { limit: 3 });
  assert.deepEqual(first.counts, { references: 7, current: 2, changed: 2, missing: 1, denied: 1, unstamped: 0, remote: 1 });
  assert.deepEqual(first.bounds, { limit: 3, offset: 0, references: { available: 7, returned: 3 }, summary: { available: 3, returned: 3 }, unread: 0, exhaustive: false, next: { offset: 3, limit: 3, expectedIdentity: view.identity } });
  const seen = [...first.references];
  let page = first;
  while (page.bounds.next) {
    page = await staleSources(view, page.bounds.next);
    assert.deepEqual(page.counts, first.counts);
    seen.push(...page.references);
  }
  assert.deepEqual(seen.map(item => `${item.from.id}/${item.sourceIndex}`), ['offline/0', 'offline/1', 'offline/2', 'purpose/0', 'purpose/1', 'runtime/0', 'reading/0']);
  assert.deepEqual(page.bounds.summary, { available: 3, returned: 0 });
  assert.deepEqual([page.bounds.exhaustive, page.bounds.next], [true, null], 'only the last page leaves nothing to read');
  // Without the entry of each reference, the report is its counts and its summary, and the summary is paged on its own.
  const summary = await staleSources(view, { limit: 2, references: false });
  assert.deepEqual([summary.references, summary.counts], [undefined, first.counts]);
  assert.deepEqual(summary.bounds, { limit: 2, offset: 0, summary: { available: 3, returned: 2 }, unread: 0, exhaustive: false, next: { offset: 2, limit: 2, expectedIdentity: view.identity, references: false } });
  const rest = await staleSources(view, summary.bounds.next);
  assert.deepEqual([rest.summary.map(item => item.uri), rest.bounds.exhaustive, rest.bounds.next], [[first.summary[2].uri], true, null]);
  assert.deepEqual((await staleSources(view, { references: false })).bounds, { limit: 100, offset: 0, summary: { available: 3, returned: 3 }, unread: 0, exhaustive: true, next: null });
  const narrow = await staleSources(view, { limit: 1 });
  assert.deepEqual(narrow.bounds.summary, { available: 3, returned: 1 });
  assert.equal((await staleSources(view, { limit: 1, offset: 1 })).summary[0].uri, 'docs/missing.md');
  const other = validateFiles(authored(), { root });
  await assert.rejects(staleSources(other, first.bounds.next), { code: 'STALE' });
  for (const options of [{ limit: 0 }, { limit: 10001 }, { offset: -1 }, { offset: 1.5 }, { allowedRoots: ['relative'] }, { allowedRoots: root }, { references: 'no' }]) await assert.rejects(staleSources(view, options), { code: 'atlas.references.invalid-argument' }, JSON.stringify(options));
  const invalid = validateFiles(new Map([['atlas.json', '{}']]), { root });
  const unavailable = await staleSources(invalid);
  assert.deepEqual([unavailable.status, unavailable.references, unavailable.summary, unavailable.counts.references], ['unavailable', [], [], 0]);
});

test('past 10000 references the stale report says how many it did not read and does not call itself exhaustive', async t => {
  const { root } = await fixture(t);
  // 10007 remote references, which are never fetched: 6000 on the top claim, 4007 on its one development.
  const remotes = (from, count) => Array.from({ length: count }, (_, index) => ({ uri: `https://example.org/${from + index}` }));
  const files = new Map([
    ['atlas.json', JSON.stringify({ format: 'atlas/1.2', id: 'many', title: 'Many', trees: ['trees/product'] })],
    ['style.md', '# Policy\n\nCite the part that was read.\n'],
    ['trees/product/tree.json', JSON.stringify({ id: 'product', title: 'Product', scope: 'What writers can rely on.', base: 'purpose', children: [{ point: 'offline' }] })],
    ['trees/product/points/purpose.md', record({ id: 'purpose', sources: remotes(0, 6000) }, 'Writers keep their notes', 'Notes survive a restart.')],
    ['trees/product/points/offline.md', record({ id: 'offline', sources: remotes(6000, 4007) }, 'Writers can work offline', 'Edits are kept locally.')],
  ]);
  const view = validateFiles(files, { root });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  const report = await staleSources(view, { references: false });
  assert.deepEqual(report.counts, { references: 10000, current: 0, changed: 0, missing: 0, denied: 0, unstamped: 0, remote: 10000 });
  assert.deepEqual([report.bounds.unread, report.bounds.exhaustive, report.bounds.next], [7, false, null]);
  // Records are read in path order, so the 4007 of offline.md come first and the last 7 of purpose.md are not read.
  const listed = await staleSources(view, { limit: 10000 });
  assert.deepEqual([listed.references.length, listed.references.at(-1).source.uri, listed.bounds.unread, listed.bounds.exhaustive], [10000, 'https://example.org/5992', 7, false]);
  // Given records alone, the bound and the count cover them alone.
  const one = await staleSources(view, { records: [{ point: 'offline' }], references: false });
  assert.deepEqual([one.counts.references, one.bounds.unread, one.bounds.exhaustive], [4007, 0, true]);
});

test('the stale report for given records reads and reports only their references, and counts and bounds cover them alone', async t => {
  const { root } = await fixture(t);
  const view = validateFiles(authored({ ...current, 'docs/design.md': 'b'.repeat(64) }), { root });
  // A Facet and a Point, given out of record order: the report keeps record order (Points, then Facets).
  const records = [{ tree: 'product', facet: 'reading' }, { point: 'offline' }];
  const report = await staleSources(view, { records });
  assert.deepEqual(report.counts, { references: 4, current: 1, changed: 1, missing: 1, denied: 1, unstamped: 0, remote: 0 });
  assert.deepEqual(report.references.map(item => `${item.from.kind}:${item.from.id}/${item.sourceIndex}:${item.status}`), ['point:offline/0:changed', 'point:offline/1:missing', 'point:offline/2:denied', 'facet:reading/0:current']);
  assert.deepEqual(report.summary.map(item => [item.uri, item.status, item.citers.map(citer => citer.id)]), [['docs/design.md', 'changed', ['offline']], ['docs/missing.md', 'missing', ['offline']]]);
  assert.deepEqual(report.bounds, { limit: 100, offset: 0, references: { available: 4, returned: 4 }, summary: { available: 2, returned: 2 }, unread: 0, exhaustive: true, next: null });
  // A source that no selected record cites is not reported, however it stands now.
  await fs.writeFile(path.join(root, 'data/trace.bin'), Buffer.from([0x00]));
  const runtime = await staleSources(validateFiles(authored({ 'data/trace.bin': sha(trace) }), { root }), { records: [{ point: 'purpose' }] });
  assert.deepEqual(runtime.counts, { references: 2, current: 0, changed: 0, missing: 0, denied: 0, unstamped: 1, remote: 1 });
  // A continuation keeps the selection.
  const first = await staleSources(view, { records, limit: 3 });
  assert.deepEqual(first.bounds.next, { offset: 3, limit: 3, expectedIdentity: view.identity, records });
  const rest = await staleSources(view, first.bounds.next);
  assert.deepEqual([rest.counts, rest.references.map(item => item.from.id)], [first.counts, ['reading']]);
  // An unknown record is an invalid request; a malformed selection is an invalid argument.
  await assert.rejects(staleSources(view, { records: [{ point: 'offline' }, { point: 'nowhere' }] }), { code: 'INVALID_REQUEST', message: 'The Atlas holds no such record: nowhere.' });
  await assert.rejects(staleSources(view, { records: [{ tree: 'system', facet: 'reading' }] }), { code: 'INVALID_REQUEST' });
  for (const records of [[], {}, [{ point: 'offline' }, { point: 'offline' }], [{ point: 'offline', tree: 'product' }], [{ facet: 'reading' }], ['offline']]) {
    await assert.rejects(staleSources(view, { records }), { code: 'atlas.references.invalid-argument' }, JSON.stringify(records));
  }
});

test('stamping prepares one change that records what the readable local sources cite now', async t => {
  const { directory, root, view } = await fixture(t);
  const result = await prepareStamp(root, { all: true });
  assert.equal(result.format, 'atlas.stamp/1');
  assert.deepEqual([result.status, result.identity, result.selection, result.plan.reason], ['ready', view.identity, { all: true }, 'Record the sources as read']);
  assert.deepEqual(result.counts, { records: 4, stamped: 4, current: 0, skipped: 3 });
  assert.deepEqual(result.stamped.map(item => [item.from.kind, item.from.id, item.sourceIndex, item.uri, item.scope, item.sha256, item.previous]), [
    ['point', 'offline', 0, 'docs/design.md', 'file', sha(design), undefined], ['point', 'purpose', 0, 'docs/design.md#storage', 'section', sha(storage), undefined],
    ['point', 'runtime', 0, 'data/trace.bin', 'file', sha(trace), undefined], ['facet', 'reading', 0, 'docs/design.md#storage', 'section', sha(storage), undefined],
  ]);
  assert.deepEqual(result.skipped.map(item => [item.from.id, item.sourceIndex, item.uri, item.status, item.code]), [
    ['offline', 1, 'docs/missing.md', 'missing', undefined], ['offline', 2, '../outside.md', 'denied', 'SOURCE_DENIED'], ['purpose', 1, 'https://example.org/spec', 'remote', undefined],
  ]);
  assert.equal(result.stamped[3].from.on, 'offline');
  assert.deepEqual(result.plan.changes.map(change => change.path).sort(), ['trees/product/facets/reading.md', 'trees/product/points/offline.md', 'trees/product/points/purpose.md', 'trees/system/points/runtime.md']);
  assert.equal(result.plan.changes.find(change => change.path === 'trees/product/points/purpose.md').after,
    record({ id: 'purpose', sources: [{ uri: 'docs/design.md#storage', role: 'evidence', locator: 'Storage', sha256: sha(storage) }, { uri: 'https://example.org/spec' }] }, 'Writers keep their notes', 'Notes survive a restart.'));
  assert.equal((await openAtlas(root)).identity, view.identity);
  assert.equal((await applyPlan(root, result.plan)).status, 'complete');
  const stamped = await openAtlas(root);
  assert.deepEqual((await staleSources(stamped)).counts, { references: 7, current: 4, changed: 0, missing: 1, denied: 0, unstamped: 1, remote: 1 });
  const again = await prepareStamp(root, { all: true, reason: 'Nothing changed since the last reading.' });
  assert.deepEqual([again.status, again.counts, again.plan.changes, again.plan.reason], ['noop', { records: 4, stamped: 0, current: 4, skipped: 3 }, [], 'Nothing changed since the last reading.']);
  // A wider grant stamps what the Atlas root alone could not read; a changed source replaces its stamp.
  await fs.writeFile(path.join(root, 'docs/design.md'), design.replace('local files', 'a local database'));
  const wider = await prepareStamp(root, { points: ['offline'], allowedRoots: [directory] });
  assert.deepEqual(wider.selection, { points: ['offline'] });
  assert.deepEqual(wider.counts, { records: 2, stamped: 3, current: 0, skipped: 1 });
  assert.deepEqual(wider.stamped.map(item => [item.from.kind, item.from.id, item.uri, item.previous]), [
    ['point', 'offline', 'docs/design.md', sha(design)], ['point', 'offline', '../outside.md', undefined], ['facet', 'reading', 'docs/design.md#storage', sha(storage)],
  ]);
  assert.deepEqual(wider.skipped.map(item => [item.uri, item.status, item.reason]), [['docs/missing.md', 'missing', 'The cited file does not exist.']]);
  const tree = await prepareStamp(root, { tree: 'system' });
  assert.deepEqual([tree.selection, tree.counts], [{ tree: 'system' }, { records: 1, stamped: 0, current: 1, skipped: 0 }]);
});

test('a stamp changes only sha256 values: other header bytes and the body stay as authored', async t => {
  const { root } = await fixture(t);
  const pretty = '---\r\n{\r\n  "id": "purpose",\r\n  "uncertainty": "A \\u201cquoted\\u201d limit.",\r\n  "sources": [\r\n    {\r\n      "uri": "docs/design.md#storage",\r\n      "locator": "Storage"\r\n    },\r\n    { "uri": "https://example.org/spec" },\r\n    {"uri":"docs/design.md","sha256":"' + 'd'.repeat(64) + '","role":"background"},\r\n    { "uri": "data/trace.bin" }\r\n  ]\r\n}\r\n---\r\n# Writers keep their notes\r\n\r\nNotes survive a restart.   \r\n\r\n---\r\n\r\nA rule above, and trailing spaces, stay.\r\n';
  await fs.writeFile(path.join(root, 'trees/product/points/purpose.md'), pretty);
  const result = await prepareStamp(root, { points: ['purpose'] });
  assert.deepEqual(result.stamped.map(item => [item.sourceIndex, item.previous]), [[0, undefined], [2, 'd'.repeat(64)], [3, undefined]]);
  const expected = pretty
    .replace('"locator": "Storage"\r\n', `"locator": "Storage",\r\n      "sha256": "${sha(storage)}"\r\n`)
    .replace('d'.repeat(64), sha(design))
    .replace('{ "uri": "data/trace.bin" }', `{ "uri": "data/trace.bin", "sha256": "${sha(trace)}" }`);
  assert.equal(result.plan.changes.length, 1);
  assert.equal(result.plan.changes[0].after, expected);
  assert.equal(result.plan.status, 'ready', JSON.stringify(result.plan.validation.diagnostics));
  assert.equal((await applyPlan(root, result.plan)).status, 'complete');
  assert.equal(await fs.readFile(path.join(root, 'trees/product/points/purpose.md'), 'utf8'), expected);
});

test('a stamp that would take a record over the 2 MiB bound is refused before any draft exists', async t => {
  const { root } = await fixture(t);
  const file = path.join(root, 'trees/product/points/purpose.md');
  const text = await fs.readFile(file, 'utf8');
  // The record is read whole, and the stamp it gains takes it past the bound.
  await fs.writeFile(file, text + 'x'.repeat(2 * 1024 * 1024 - 20 - Buffer.byteLength(text)));
  assert.equal((await openAtlas(root)).status, 'ready');
  await assert.rejects(prepareStamp(root, { points: ['purpose'] }), { code: 'LIMIT_EXCEEDED', message: 'A changed file exceeds 2 MiB (2097152 bytes).' });
});

test('stamping names its selection exactly and needs a valid Atlas', async t => {
  const { root } = await fixture(t);
  for (const options of [{}, { all: false }, { all: true, tree: 'product' }, { points: [] }, { points: ['purpose', 'purpose'] }, { points: 'purpose' }, { points: ['absent'] }, { tree: 'absent' }, { tree: 'Product' }, { all: true, reason: ' ' }, { all: true, allowedRoots: ['relative'] }, { all: true, facet: 'reading' }]) {
    await assert.rejects(prepareStamp(root, options), { code: 'atlas.references.invalid-argument' }, JSON.stringify(options));
  }
  await fs.rm(path.join(root, 'style.md'));
  await assert.rejects(prepareStamp(root, { all: true }), { code: 'INVALID_VIEW' });
});
