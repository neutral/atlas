import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';import {fileURLToPath} from 'node:url';
import {RESOLVED_PROFILE,STRUCTURAL_PROFILE,validateAtlas,validateFixtureManifest} from '../src/index.mjs';
import { splitFrontMatter } from '../src/frontmatter.mjs';
const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url)),examples=path.join(repositoryRoot,'spec','examples');const validate=(relative,profile=RESOLVED_PROFILE)=>validateAtlas(path.join(examples,relative),{profile,specificationRevision:'test'}),codes=result=>result.diagnostics.map(item=>item.code);
function temporaryDirectory(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-validator-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function updateJson(file, edit) { const value = JSON.parse(fs.readFileSync(file, 'utf8')); edit(value); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
test('every registered fixture matches exactly',()=>{const results=validateFixtureManifest(path.join(examples,'manifest.json'),{specificationRevision:'test'});assert.deepEqual(results.filter(x=>!x.pass).map(x=>({path:x.fixture.path,expected:x.fixture.diagnostics,actual:x.actualCodes,complete:x.result.complete,valid:x.result.valid,normalizedMatches:x.normalizedMatches})),[]);});
test('cross-map fixture assembles one Point identity',()=>{const result=validate('valid/cross-map');assert.equal(result.valid,true);const point=result.normalized.points.find(x=>x.id==='edge-authentication');assert.equal(point.primaryMap,'architecture');assert.deepEqual(point.records.map(x=>[x.kind,x.map]),[['anchor','architecture'],['context','operations']]);assert.equal(point.relations[0].note,'The boundary requires an operational key rotation practice.');assert.deepEqual(result.normalized.relatedMaps,[{maps:['architecture','operations'],pointIds:['edge-authentication']}]);assert.equal(result.normalized.checks[0].id,'point-context');});
test('exact authored ids remain distinct despite identical prose',()=>{const result=validate('valid/similar-distinct-points');assert.equal(result.valid,true);assert.deepEqual(result.normalized.points.map(x=>x.id),['edge-cache-policy','regional-cache-policy']);assert.equal(new Set(result.normalized.points.map(x=>x.title)).size,1);assert.equal(new Set(result.normalized.points.map(x=>x.summary)).size,1);assert.equal(new Set(result.normalized.points.map(x=>x.records[0].body)).size,1);});
test('relation graph contains only authored edges and direct reverse entries',()=>{const result=validate('valid/nontransitive-relations');assert.equal(result.valid,true);const point=id=>result.normalized.points.find(x=>x.id===id),client=point('client-delivery'),gateway=point('edge-gateway'),network=point('regional-network');assert.deepEqual(client.relations.map(x=>[x.type,x.targetPoint]),[['depends-on','edge-gateway']]);assert.deepEqual(client.incomingRelations.map(x=>[x.type,x.sourcePoint]),[]);assert.deepEqual(gateway.relations.map(x=>[x.type,x.targetPoint]),[['depends-on','regional-network']]);assert.deepEqual(gateway.incomingRelations.map(x=>[x.type,x.sourcePoint]),[['depends-on','client-delivery']]);assert.deepEqual(network.relations.map(x=>[x.type,x.targetPoint]),[]);assert.deepEqual(network.incomingRelations.map(x=>[x.type,x.sourcePoint]),[['depends-on','edge-gateway']]);assert.equal(client.relations.some(x=>x.targetPoint==='regional-network'),false);});
test('an explained Area membership uses a Markdown section',()=>{const result=validate('valid/explained-area-context');assert.equal(result.valid,true);const context=result.normalized.points[0].records[1];assert.equal(context.kind,'context');assert.match(context.body,/## Connection: two-shared-area-local/u);assert.deepEqual(context.areas,[{id:'two-shared-area-local',area:'local',context:'The shared boundary changes which local responsibilities belong in this Map.'}]);});
test('publication profiles resolve exact source units',()=>{const result=validate('valid/publication-profile');assert.equal(result.valid,true);assert.deepEqual(result.normalized.publicationProfiles[0].selection,{atlas:true,maps:['one'],points:[{id:'service-boundary',records:[{map:'one',kind:'anchor',path:'maps/one/points/service-boundary.md'}]}],resources:['overview'],checks:['review']});});
test('concise Markdown anchors are valid',()=>{const result=validate('valid/minimal');assert.equal(result.valid,true);assert.match(result.normalized.points[0].records[0].body,/^\s*# Service boundary\n\nThe service boundary/u);assert.equal(result.normalized.points[0].summary,'The service boundary is fixed at the public API.');});
test('structural profile does not require local target resolution',()=>{const result=validate('invalid/missing-local-target',STRUCTURAL_PROFILE);assert.equal(result.complete,true);assert.equal(result.valid,true);assert.deepEqual(codes(result),[]);});
test('invalid results never expose normalized output',()=>{for(const name of ['empty-anchor-body','missing-anchor','unknown-resource','supersession-cycle']){const result=validate(`invalid/${name}`);assert.equal(result.valid,false);assert.equal(result.normalized,undefined);}});
test('missing root is complete invalid input',t=>{const result=validateAtlas(temporaryDirectory(t),{profile:RESOLVED_PROFILE});assert.equal(result.complete,true);assert.equal(result.valid,false);assert.deepEqual(codes(result),['atlas.discovery.root-not-found']);});
test('root inspection failure is incomplete',t=>{const directory=temporaryDirectory(t),original=fs.lstatSync;t.mock.method(fs,'lstatSync',(target,...arguments_)=>{if(path.resolve(target)===path.resolve(directory)){const error=new Error('inspection denied');error.code='EACCES';throw error;}return original.call(fs,target,...arguments_);});const result=validateAtlas(directory,{profile:RESOLVED_PROFILE});assert.equal(result.complete,false);assert.equal(result.valid,false);assert.deepEqual(codes(result),['atlas.processing.io']);});
test('unsupported profile is incomplete',()=>{const result=validateAtlas(path.join(examples,'valid/minimal'),{profile:'atlas.unsupported'});assert.equal(result.complete,false);assert.deepEqual(codes(result),['atlas.validation.unknown-profile']);});
test('publication profile identifiers are unique', t => {
  const directory = temporaryDirectory(t);
  fs.cpSync(path.join(examples, 'valid/minimal'), directory, { recursive: true });
  fs.mkdirSync(path.join(directory, '.publication'));
  const profile = {
    type: 'publication', id: 'public',
    selection: { atlas: true, maps: [], points: {}, resources: [], checks: [] },
  };
  for (const name of ['public', 'other']) {
    fs.writeFileSync(path.join(directory, '.publication', `${name}.md`), `---\n${JSON.stringify(profile, null, 2)}\n---\n\n# Public fixture\n\nExplicit fixture source selection.\n`);
  }
  const result = validateAtlas(directory, { profile: RESOLVED_PROFILE });
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes('atlas.publication.duplicate-id'));
  assert.equal(codes(result).includes('atlas.publication.filename-mismatch'), false);
});
test('symlink targets are rejected', t => {
  if (process.platform === 'win32') return;
  const directory = temporaryDirectory(t);
  fs.cpSync(path.join(examples, 'valid/minimal'), directory, { recursive: true });
  fs.mkdirSync(path.join(directory, 'docs'));
  fs.writeFileSync(path.join(directory, 'outside.md'), '# outside\n');
  fs.symlinkSync('../outside.md', path.join(directory, 'docs/linked.md'));
  updateJson(path.join(directory, 'connections.json'), value => {
    value.references = [{ id: 'linked-source', owner: { type: 'point', map: 'one', point: 'service-boundary' },
      target: { uri: '../../../docs/linked.md' }, role: 'supporting' }];
  });
  const result = validateAtlas(directory, { profile: RESOLVED_PROFILE });
  assert.ok(codes(result).includes('atlas.reference.symlink'));
});
test('each registered Resource target is resolved once even when reused', t => {
  const directory = temporaryDirectory(t);
  fs.cpSync(path.join(examples, 'valid/minimal'), directory, { recursive: true });
  updateJson(path.join(directory, 'catalog.json'), value => {
    value.resources = [{ id: 'outside', uri: '../outside.md', title: 'Outside' }];
  });
  updateJson(path.join(directory, 'connections.json'), value => {
    value.content = [{ id: 'outside-content', owner: { type: 'atlas' }, target: { resource: 'outside' } }];
    value.references = [{ id: 'outside-reference', owner: { type: 'atlas' }, target: { resource: 'outside' }, role: 'supporting' }];
  });
  const result = validateAtlas(directory, { profile: RESOLVED_PROFILE });
  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.filter(item => item.code === 'atlas.reference.external-local').length, 1);
});

// Every Point body carries its title and canonical opening paragraph.
for (const [label, body, expectedCodes] of [
  ['omitted', '', ['atlas.markdown.summary', 'atlas.markdown.title']],
  ['whitespace-only', '\n  \n', ['atlas.markdown.summary', 'atlas.markdown.title']],
  ['paragraph without heading', '\nThe public API defines the boundary.\n', ['atlas.markdown.summary', 'atlas.markdown.title']],
  ['heading-only', '\n# Boundary\n', ['atlas.markdown.summary']],
  ['heading and paragraph', '\n# Boundary\n\nThe public API defines the boundary.\n', []],
  ['comment after heading', '\n# Boundary\n\n<!-- no context -->\n', ['atlas.markdown.summary']],
]) {
  test(`anchor body ${label} has the expected result in both profiles`, t => {
    const directory = temporaryDirectory(t);
    fs.cpSync(path.join(examples, 'valid/minimal'), directory, { recursive: true });
    const file = path.join(directory, 'maps/one/points/service-boundary.md');
    const parsed = splitFrontMatter(fs.readFileSync(file, 'utf8'));
    const metadata = JSON.parse(parsed.frontMatter);
    const connectionsFile = path.join(directory, 'connections.json');
    const connections = JSON.parse(fs.readFileSync(connectionsFile, 'utf8'));
    connections.memberships = [];
    fs.writeFileSync(connectionsFile, JSON.stringify(connections));
    fs.writeFileSync(file, `---\n${JSON.stringify(metadata, null, 2)}\n---\n${body}`);
    for (const profile of [STRUCTURAL_PROFILE, RESOLVED_PROFILE]) {
      const result = validateAtlas(directory, { profile, specificationRevision: 'test' });
      assert.equal(result.complete, true);
      assert.equal(result.valid, expectedCodes.length === 0, JSON.stringify(result.diagnostics));
      assert.deepEqual(codes(result), expectedCodes);
      if (result.valid && profile === RESOLVED_PROFILE) {
        assert.equal(result.normalized.points[0].records[0].body, body);
        assert.equal(result.normalized.points[0].summary, 'The public API defines the boundary.');
      } else assert.equal(result.normalized, undefined);
    }
  });
}
test('an anchor requires an opening Markdown paragraph', t => {
  const directory = temporaryDirectory(t);
  fs.cpSync(path.join(examples, 'valid/minimal'), directory, { recursive: true });
  const file = path.join(directory, 'maps/one/points/service-boundary.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('The service boundary is fixed at the public API.', ''));
  const result = validateAtlas(directory, { profile: RESOLVED_PROFILE });
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes('atlas.markdown.summary'));
  assert.equal(result.normalized, undefined);
});
test('a concise anchor does not bypass review-window validation', t => {
  const directory = temporaryDirectory(t);
  fs.cpSync(path.join(examples, 'valid/minimal'), directory, { recursive: true });
  updateJson(path.join(directory, 'catalog.json'), value => {
    value.points = [{ point: 'service-boundary', review: { 'reviewed-at': '2026-09-04', 'review-after': '2026-09-03' } }];
  });
  const result = validateAtlas(directory, { profile: RESOLVED_PROFILE });
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes('atlas.point.invalid-review-window'));
  assert.equal(result.normalized, undefined);
});
