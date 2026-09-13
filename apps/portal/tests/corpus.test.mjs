import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileAtlasPortal } from '../src/core/compile.mjs';
import { parseCorpus } from '../src/core/model.mjs';
import { loadCorpus } from '../src/lib/corpus.mjs';

const atlasDirectory = fileURLToPath(new URL('../../../spec/examples/valid/publication-profile', import.meta.url));

async function fixtureCorpus() {
  return compileAtlasPortal({ atlasDirectory, profileId: 'public', portal: {
    name: 'Fixture Atlas', copyright: 'Copyright Fixture Authors', license: 'Custom terms',
  } });
}

test('the cache boundary preserves compiled reader content and rejects malformed nested data', async () => {
  const corpus = JSON.parse(JSON.stringify(await fixtureCorpus()));
  assert.deepEqual(parseCorpus(corpus), corpus);
  const malformed = structuredClone(corpus);
  malformed.points[0].records[0].body = { unexpected: 'object' };
  assert.throws(() => parseCorpus(malformed), /body/u);
  assert.throws(() => parseCorpus({ ...corpus, checks: [] }), /checks/u);
  assert.throws(() => parseCorpus({ ...corpus, portal: { ...corpus.portal, license: 0 } }), /license/u);
  const unsafe = structuredClone(corpus);
  unsafe.routes[0].path = '//outside.example/';
  assert.throws(() => parseCorpus(unsafe), /local Portal route/u);
});

test('the reader requires its invocation cache and validates it before exposing props', async (t) => {
  const original = process.env.ATLAS_PORTAL_CORPUS;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-corpus-test-'));
  t.after(() => {
    if (original === undefined) delete process.env.ATLAS_PORTAL_CORPUS;
    else process.env.ATLAS_PORTAL_CORPUS = original;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  delete process.env.ATLAS_PORTAL_CORPUS;
  assert.throws(() => loadCorpus(), /corpus is missing/u);
  process.env.ATLAS_PORTAL_CORPUS = path.join(directory, 'corpus.json');
  fs.writeFileSync(process.env.ATLAS_PORTAL_CORPUS, JSON.stringify(await fixtureCorpus()));
  assert.equal(loadCorpus().portal.name, 'Fixture Atlas');
  fs.writeFileSync(process.env.ATLAS_PORTAL_CORPUS, '{"contract":"outdated"}');
  assert.throws(() => loadCorpus(), /contract/u);
});
