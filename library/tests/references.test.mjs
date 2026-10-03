import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateFiles } from '../src/model.mjs';
import { referenceIndex, directCiters, sourceCitations, prepareMove, reviewSources, resolveReference } from '../src/references.mjs';

const record = (id, body, extra = {}) => `---\n${JSON.stringify({id,...extra})}\n---\n# ${id}\n\n${body}\n`;
function fixture(body = '[detail](detail.md#scope) and [facet](../facets/meaning.md).', root = '/tmp/atlas-reference-fixture') {
  const files = new Map([
    ['atlas.json', JSON.stringify({format:'atlas/1',id:'example',title:'Example',trees:['trees/a','trees/b']})],
    ['trees/a/tree.json',JSON.stringify({id:'a',title:'A',scope:'First account',base:'base',children:[{point:'detail'}]})],
    ['trees/b/tree.json',JSON.stringify({id:'b',title:'B',scope:'Other account',base:'other',children:[]})],
    ['trees/a/points/base.md',record('base',body,{sources:[{uri:'../evidence.md',role:'evidence'},{uri:'../evidence.md#limits',role:'background',locator:'Limits'}]})],
    ['trees/a/points/detail.md',record('detail','A detail.\n\n## Scope\n\nIts exact scope. [Base](base.md)')],
    ['trees/b/points/other.md',record('other','An independent account.')],
    ['trees/a/facets/meaning.md',record('meaning','A consequence of [detail](../points/detail.md).',{on:{point:'base'},via:'b',targets:[{point:'other'}]})],
  ]);
  const view=validateFiles(files,{root});assert.equal(view.status,'ready');return view;
}

test('derived references retain exact identities, direct citers and source citation distinctions',()=>{
 const view=fixture('[detail](./detail.md#scope) and [facet](../facets/meaning.md); [source](../../../..//evidence.md).');
 const index=referenceIndex(view); assert.equal(index.status,'ready');assert.equal(view.status,'ready');
 const links=index.references.filter(x=>x.from.id==='base');assert.equal(links[0].target.id,'detail');assert.equal(links[0].target.fragment,'#scope');assert.equal(links[1].target.kind,'facet');
 assert.equal(links[0].location.line,6); const raw=view.files.find(f=>f.path===links[0].from.path).content;assert.equal(raw.slice(links[0].destination.start,links[0].destination.end),'./detail.md#scope');
 assert.deepEqual(directCiters(view,{point:'detail'}).citers.map(x=>x.record.id),['base','meaning']);
 assert.equal(sourceCitations(view,{uri:'../evidence.md'}).citations.length,1);assert.equal(sourceCitations(view,{uri:'../evidence.md#limits'}).citations[0].source.locator,'Limits');
 assert.equal(sourceCitations(view,{uri:'../evidence.md#missing'}).citations.length,0);
});

test('reference diagnostics do not invalidate content and respect exact case, URI escaping and unsupported paths',()=>{
 const view=fixture('[wrong](Detail.md) [percent](%64etail.md) [dot](nested/../detail.md) [bad](%zz.md) [network](//host/file) [code](https://example.com).\n\n`[ignored](absent.md)`\n\n```md\n[also ignored](absent.md)\n```');
 const index=referenceIndex(view);const links=index.references.filter(x=>x.from.id==='base');
 assert.deepEqual(links.map(x=>x.status),['missing','resolved','resolved','missing','unsupported','external']);
 assert.equal(index.diagnostics.length,3);assert.equal(view.status,'ready');
 const owner=view.atlas.points.find(p=>p.id==='base');assert.equal(resolveReference(view,owner,'bad%00.md').status,'unsupported');assert.equal(resolveReference(view,owner,'https://user:password@example.com').status,'unsupported');
 const bounded=referenceIndex(view,{limit:1});assert.equal(bounded.references.length,1);assert.ok(bounded.bounds.references.available>1);
});

test('move preserves IDs and repairs incoming/outgoing inline destinations, escapes and CRLF locations',()=>{
 const view=fixture('[escaped](detail\\.md#scope) [angle](<detail.md> "title") [root](trees/a/points/detail.md)');
 // CRLF location calculations must still edit exactly the href bytes.
 const files=new Map(view.files.map(f=>[f.path,f.content.replaceAll('\n','\r\n')]));const crlf=validateFiles(files,{root:view.root});
 const plan=prepareMove(crlf,{point:'detail',path:'trees/a/points/nested/new detail.md',reason:'Move detail without changing meaning.'});
 assert.equal(plan.status,'ready');assert.equal(plan.candidate.atlas.points.find(p=>p.id==='detail').path,'trees/a/points/nested/new detail.md');
 assert.equal(referenceIndex(plan.candidate).diagnostics.length,0);
 const base=plan.changes.find(c=>c.path==='trees/a/points/base.md').after;
 assert.match(base,/nested\/new%20detail.md#scope/);assert.match(base,/nested\/new%20detail.md "title"/);assert.ok(base.includes('\r\n'));
 const moved=plan.changes.find(c=>c.path==='trees/a/points/nested/new detail.md').after;assert.match(moved,/\[Base\]\(\.\.\/base.md\)/);
 assert.equal(prepareMove(view,{point:'detail',path:'trees/a/points/detail.md',reason:'Already here'}).status,'noop');
 assert.throws(()=>prepareMove(view,{point:'detail',path:'trees/b/points/detail.md',reason:'Cross owner'}),/owning Tree/);
 assert.throws(()=>prepareMove(view,{point:'detail',path:'trees/a/points/DETAIL.md',reason:'Case alias'}),/case-only/);
});

test('move refuses partial repairs of reference-style links and follows Facet identity',()=>{
 const referenced=fixture('[Detail][detail]\n\n[detail]: detail.md "A title"');
 assert.equal(referenceIndex(referenced).references[0].target.id,'detail');
 assert.throws(()=>prepareMove(referenced,{point:'detail',path:'trees/a/points/new.md',reason:'Move'}),/Cannot safely repair reference/);
 const view=fixture();const plan=prepareMove(view,{facet:'meaning',tree:'a',path:'trees/a/facets/nested/meaning.md',reason:'Group interpretations.'});
 assert.equal(plan.status,'ready');assert.equal(referenceIndex(plan.candidate).diagnostics.length,0);
 assert.match(plan.changes.find(c=>c.path==='trees/a/points/base.md').after,/facets\/nested\/meaning.md/);
});

test('move edits the parsed destination rather than identical link text inside inline code',()=>{
 const view=fixture('`[detail](detail.md)` and [detail](detail.md).');
 const plan=prepareMove(view,{point:'detail',path:'trees/a/points/renamed.md',reason:'Rename the record file.'});
 assert.equal(plan.status,'ready');
 const base=plan.changes.find(change=>change.path==='trees/a/points/base.md').after;
 assert.match(base,/`\[detail\]\(detail.md\)` and \[detail\]\(renamed.md\)/);
 assert.equal(referenceIndex(plan.candidate).diagnostics.length,0);
 const complex=fixture('> quoted line\n> [detail](detail.md)');
 assert.throws(()=>prepareMove(complex,{point:'detail',path:'trees/a/points/renamed.md',reason:'Rename'}),/Cannot safely repair/);
});

test('move refuses destinations that shadow an unchanged Atlas-root fallback reference',()=>{
 const view=fixture('[Base](trees/a/points/base.md)');
 assert.equal(referenceIndex(view).references[0].target.id,'base');
 assert.throws(()=>prepareMove(view,{point:'detail',path:'trees/a/points/trees/a/points/base.md',reason:'Move the detail.'}),/change another reference target/);
});

test('source review is explicitly granted, observes drift, preserves citation hashes and never fetches URLs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-source-review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const atlasRoot=path.join(root,'atlas');await fs.mkdir(atlasRoot);await fs.writeFile(path.join(root,'evidence.md'),'first bytes');
 let view=fixture('Read the supporting source.',atlasRoot);const sha=createHash('sha256').update('first bytes').digest('hex');
 const base=view.files.find(f=>f.path==='trees/a/points/base.md');const files=new Map(view.files.map(f=>[f.path,f.content]));files.set(base.path,record('base','Read support.',{sources:[{uri:'../evidence.md',sha256:sha},{uri:'../missing.md'},{uri:'https://example.invalid/evidence'},{uri:'../evidence.md#scope',role:'background'}]}));view=validateFiles(files,{root:atlasRoot});
 const denied=await reviewSources(view,{allowedRoots:[atlasRoot],uris:['../evidence.md']});assert.equal(denied.results[0].status,'denied');
 const first=await reviewSources(view,{allowedRoots:[root]});assert.deepEqual(first.results.map(x=>x.status),['current','missing','uninspected','current']);assert.ok(!('content' in first.results[0]));
 await fs.writeFile(path.join(root,'evidence.md'),'changed bytes');
 const changed=await reviewSources(view,{allowedRoots:[root],previous:first.results.filter(x=>x.sha256).map(({uri,sha256})=>({uri,sha256}))});
 assert.equal(changed.results[0].status,'changed');assert.deepEqual(changed.results[0].mismatchedHashes,[sha]);assert.equal(changed.results[3].status,'changed');assert.equal(changed.results[3].mismatchedHashes.length,0);
 assert.equal((await reviewSources(view,{allowedRoots:[root],uris:['../undeclared.md']})).results[0].status,'uninspected');
 assert.equal((await reviewSources(view,{allowedRoots:[root],uris:['../evidence.md'],maxBytes:2})).results[0].status,'incomplete');
 await fs.rm(path.join(root,'evidence.md'));await fs.symlink('/etc/passwd',path.join(root,'evidence.md'));
 assert.equal((await reviewSources(view,{allowedRoots:[root],uris:['../evidence.md']})).results[0].status,'denied');
});

test('declared source links prefer the file-relative citation before an Atlas-root fallback',()=>{
 const view=fixture();const files=new Map(view.files.map(file=>[file.path,file.content]));
 files.set('trees/a/points/base.md',record('base','[Report](report.md#scope)',{sources:[{uri:'report.md#scope',locator:'Root source'},{uri:'trees/a/points/report.md#scope',locator:'Sibling source'}]}));
 const captured=validateFiles(files,{root:view.root});assert.equal(captured.status,'ready');
 const base=captured.atlas.points.find(point=>point.id==='base');
 const local=resolveReference(captured,base,'report.md#scope');
 assert.equal(local.target.source.uri,'trees/a/points/report.md#scope');assert.equal(local.target.sourceIndex,1);
 assert.equal(local.target.source.locator,'Sibling source');
 const root=resolveReference(captured,base,'../../../report.md#scope');
 assert.equal(root.target.source.uri,'report.md#scope');assert.equal(root.target.sourceIndex,0);
 const withLocalSource={...base,sources:[{uri:'trees/a/points/trees/a/points/detail.md',locator:'File-relative source'}]};
 const beforeFallback=resolveReference(captured,withLocalSource,'trees/a/points/detail.md');
 assert.equal(beforeFallback.target.kind,'source');assert.equal(beforeFallback.target.source.locator,'File-relative source');
});

test('source heading review distinguishes readable missing fragments from denied or uninspected sources', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-heading-review-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'atlas'); await fs.mkdir(root);
  await fs.writeFile(path.join(directory, 'evidence.md'), '# Limits\n\nA scoped result.\n\n## Résumé & **scope**\n\nDetails.\n\n## Limits\n\nRepeated heading.');
  const captured = fixture('[missing](../../../../evidence.md#absent) [duplicate](../../../../evidence.md#limits-1) [Unicode](../../../../evidence.md#r%C3%A9sum%C3%A9--scope)', root);
  const denied = await reviewSources(captured, { allowedRoots: [root] });
  assert.equal(denied.results[1].status, 'denied');
  assert.equal(denied.results[1].fragment.status, 'uninspected');
  const read = await reviewSources(captured, { allowedRoots: [directory] });
  assert.equal(read.results[1].fragment.status, 'resolved');
  const fragments = new Map(read.results[0].fragments.map(item => [item.fragment, item.status]));
  assert.equal(fragments.get('#absent'), 'missing-heading');
  assert.equal(fragments.get('#limits-1'), 'resolved');
  assert.equal(fragments.get('#r%C3%A9sum%C3%A9--scope'), 'resolved');
  assert.equal(read.results[0].status, 'current');
});

test('internal fragment diagnostics retain exact Point and Facet destinations', () => {
  const view = fixture('[good](detail.md#scope) [missing](detail.md#absent) [facet](../facets/meaning.md#meaning) [self](#missing-self)');
  const links = referenceIndex(view).references.filter(reference => reference.from.id === 'base');
  assert.ok(links.every(reference => reference.status === 'resolved'));
  assert.deepEqual(links.map(reference => reference.heading.status), ['resolved', 'missing-heading', 'resolved', 'missing-heading']);
  assert.equal(links[1].target.id, 'detail');
  assert.equal(links[2].target.kind, 'facet');
  assert.equal(referenceIndex(view).diagnostics.filter(item => item.code === 'REFERENCE_HEADING_MISSING').length, 2);
  assert.ok(directCiters(view, { point: 'detail' }).citers.some(citer => citer.record.id === 'base'));
  assert.equal(view.status, 'ready');
});
