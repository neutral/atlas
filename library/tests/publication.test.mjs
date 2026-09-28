import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tempDirectory } from '../../tests/support/temp.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateFiles } from '../src/model.mjs';
import { preparePublication, readPublicationSources } from '../src/publication.mjs';

const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
function fixture(root = '/tmp/atlas-publication-fixture', extraSources = []) {
  const files = new Map([
    ['atlas.json', JSON.stringify({ format: 'atlas/1', id: 'example', title: 'Example', trees: ['trees/service', 'trees/evidence'] })],
    ['trees/service/tree.json', JSON.stringify({ id: 'service', title: 'Service', scope: 'Service obligations.', base: 'purpose', children: [{ branch: 'participants', title: 'Participants', children: [{ point: 'summary', children: [{ point: 'detail' }] }] }] })],
    ['trees/evidence/tree.json', JSON.stringify({ id: 'evidence', title: 'PRIVATE TREE TITLE', scope: 'PRIVATE SCOPE', base: 'proof', children: [{ branch: 'production', title: 'PRIVATE BRANCH', children: [{ point: 'inputs' }] }] })],
    ['trees/service/points/purpose.md', markdown({ id: 'purpose', sources: [{ uri: 'sources/unselected.md' }] }, 'Service purpose', 'The service has a declared purpose.')],
    ['trees/service/points/summary.md', markdown({ id: 'summary', sources: [{ uri: 'sources/excluded.md' }] }, 'PRIVATE SUMMARY TITLE', 'PRIVATE SUMMARY EXPLANATION')],
    ['trees/service/points/detail.md', markdown({ id: 'detail', type: 'decision', status: 'selected', uncertainty: 'Implementation unverified.', sources: [{ uri: 'sources/public.md', role: 'evidence' }, { uri: 'https://example.test/evidence' }, ...extraSources] }, 'Selected detail', 'This detail records a qualified decision.')],
    ['trees/evidence/points/proof.md', markdown({ id: 'proof' }, 'PRIVATE PROOF TITLE', 'PRIVATE PROOF EXPLANATION')],
    ['trees/evidence/points/inputs.md', markdown({ id: 'inputs' }, 'PRIVATE INPUT TITLE', 'PRIVATE INPUT EXPLANATION')],
    ['trees/service/facets/detail.md', markdown({ id: 'detail', on: { point: 'detail' }, via: 'evidence', targets: [{ point: 'proof' }, { branch: 'production' }, { tree: 'evidence' }] }, 'Evidence qualifies the decision', 'Production remains outside the service account.')],
    ['trees/service/facets/summary.md', markdown({ id: 'summary', on: { point: 'summary' }, via: 'evidence', targets: [{ point: 'proof' }] }, 'PRIVATE FACET TITLE', 'PRIVATE FACET EXPLANATION')],
    ['trees/service/facets/branch.md', markdown({ id: 'branch', on: { branch: 'participants' }, via: 'evidence', targets: [{ point: 'inputs' }] }, 'Branch interpretation', 'Participant duties relate to required inputs.')],
  ]);
  const view = validateFiles(files, { root });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return { view, files };
}

test('publication preserves the selected outline while excluding omitted explanations and targets', () => {
  const { view } = fixture();
  const publication = preparePublication(view, { trees: ['service'], points: ['detail'] });
  assert.equal(publication.status, 'ready');
  assert.equal(publication.atlas.format, 'atlas.publication-data/1');
  assert.equal(publication.atlas.trees.length, 1);
  assert.deepEqual(publication.atlas.trees[0].children, view.atlas.trees[0].children);
  assert.deepEqual(publication.atlas.points.find((point) => point.id === 'summary'), { id: 'summary', tree: 'service', publicationAvailable: false });
  assert.equal(publication.atlas.points.find((point) => point.id === 'detail').status, 'selected');
  assert.ok(publication.atlas.points.find((point) => point.id === 'detail').sources.every((source) => source.publicationAvailable === false));
  assert.deepEqual(publication.atlas.facets.map((facet) => facet.id), ['branch', 'detail']);
  assert.ok(publication.atlas.facets.every((facet) => facet.viaAvailability === 'not-included' && facet.targetAvailability.every((target) => target.availability === 'not-included')));
  assert.equal(publication.atlas.branches.length, 1);
  assert.deepEqual(publication.sources, []);
  const serialized = JSON.stringify(publication);
  for (const excluded of ['PRIVATE', 'sources/excluded.md', 'sources/unselected.md', 'trees/service/points', 'root', '.atlas-state']) assert.ok(!serialized.includes(excluded), excluded);
  publication.atlas.trees[0].children[0].title = 'Changed';
  assert.equal(view.atlas.trees[0].children[0].title, 'Participants');
});

test('omitted Point selection includes owned Points; explicit empty selection includes none', () => {
  const { view } = fixture();
  const all = preparePublication(view, { trees: ['service', 'evidence'] });
  assert.equal(all.atlas.points.filter((point) => point.publicationAvailable).length, 5);
  assert.ok(all.atlas.facets.every((facet) => facet.targetAvailability.every((target) => target.availability === 'included')));
  const empty = preparePublication(view, { trees: ['service'], points: [] });
  assert.ok(empty.atlas.points.every((point) => !point.publicationAvailable));
  assert.deepEqual(empty.atlas.facets.map((facet) => facet.id), ['branch']);
  assert.throws(() => preparePublication(view, { trees: [] }), /at least one/);
  assert.throws(() => preparePublication(view, { trees: ['service'], points: ['proof'] }), /selected Trees/);
  assert.throws(() => preparePublication(view, { trees: ['service'], includeAllSources: true }), /Unknown/);
  const missing = preparePublication(view, { trees: ['service', 'missing'], points: ['missing'] });
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.diagnostics.length, 2);
});

test('source bytes require explicit selection and an independent caller grant', async () => {
  const parent = await tempDirectory('atlas-publication-');
  const root = path.join(parent, 'atlas');
  await fs.mkdir(path.join(root, 'sources'), { recursive: true });
  try {
    await fs.writeFile(path.join(root, 'sources/public.md'), 'Public source bytes');
    await fs.writeFile(path.join(root, 'sources/excluded.md'), 'EXCLUDED SOURCE BYTES');
    await fs.writeFile(path.join(parent, 'external.md'), 'Granted external bytes');
    const { view } = fixture(root, [{ uri: '../external.md' }]);
    const selection = { trees: ['service'], points: ['detail'], sources: ['sources/public.md', '../external.md', 'https://example.test/evidence'] };
    const publication = preparePublication(view, selection);
    assert.ok(!JSON.stringify(publication).includes('Public source bytes'));
    assert.ok(publication.atlas.points.find((point) => point.id === 'detail').sources.every((source) => source.publicationAvailable));
    await assert.rejects(readPublicationSources(view, publication), /Explicit source roots/);
    const restricted = await readPublicationSources(view, publication, { allowedRoots: [root] });
    assert.deepEqual(restricted.map((entry) => entry.status), ['ready', 'denied', 'reference']);
    assert.equal(restricted[0].content, 'Public source bytes');
    const granted = await readPublicationSources(view, publication, { allowedRoots: [parent] });
    assert.equal(granted[1].content, 'Granted external bytes');
    assert.equal(granted[2].content, undefined);
    assert.deepEqual(await readPublicationSources(view, preparePublication(view, { trees: ['service'] }), { allowedRoots: [parent] }), []);
    const excluded = preparePublication(view, { trees: ['service'], points: ['detail'], sources: ['sources/excluded.md'] });
    assert.equal(excluded.status, 'incomplete');
    assert.equal((await readPublicationSources(view, excluded, { allowedRoots: [parent] }))[0].status, 'denied');
    const tampered = structuredClone(publication); tampered.sources.push({ uri: 'sources/excluded.md', publicationAvailable: true });
    await assert.rejects(readPublicationSources(view, tampered, { allowedRoots: [parent] }), /changed after preparation/);
    const stale = structuredClone(view); stale.identity = '0'.repeat(64);
    await assert.rejects(readPublicationSources(stale, publication, { allowedRoots: [parent] }), /baseline/);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});

test('publication refuses reserved state, conflicting source hashes and source symlinks', async () => {
  const root = await tempDirectory('atlas-publication-');
  try {
    const { view } = fixture(root, [{ uri: '.atlas-state/report.json' }, { uri: 'sources/public.md', sha256: '0'.repeat(64) }, { uri: 'sources/public.md', sha256: '1'.repeat(64) }]);
    const publication = preparePublication(view, { trees: ['service'], points: ['detail'], sources: ['.atlas-state/report.json', 'sources/public.md'] });
    assert.equal(publication.status, 'incomplete');
    const result = await readPublicationSources(view, publication, { allowedRoots: [root] });
    assert.deepEqual(result.map((entry) => entry.code), ['PUBLICATION_SOURCE_NOT_INCLUDED', 'PUBLICATION_SOURCE_CONFLICT']);
    await fs.mkdir(path.join(root, 'sources'));
    await fs.writeFile(path.join(root, 'private.md'), 'Private');
    await fs.symlink('../private.md', path.join(root, 'sources/public.md'));
    const clean = fixture(root).view;
    const prepared = preparePublication(clean, { trees: ['service'], sources: ['sources/public.md'] });
    assert.equal((await readPublicationSources(clean, prepared, { allowedRoots: [root] }))[0].status, 'denied');
    await fs.unlink(path.join(root, 'sources/public.md'));
    await fs.writeFile(path.join(root, 'sources/public.md'), 'Expected bytes');
    const hashed = fixture(root, [{ uri: 'sources/public.md', sha256: createHash('sha256').update('Different bytes').digest('hex') }]).view;
    const mismatch = await readPublicationSources(hashed, preparePublication(hashed, { trees: ['service'], sources: ['sources/public.md'] }), { allowedRoots: [root] });
    assert.equal(mismatch[0].status, 'invalid');
    assert.equal(mismatch[0].content, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
