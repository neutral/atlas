import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles } from '../../../library/src/model.mjs';
import { preparePublication } from '../../../library/src/publication.mjs';
import { presentAtlas } from '../src/markdown.mjs';
import { referenceHref } from '../../../library/src/references.mjs';
const record=(header,title,body)=>`---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
function fixture(){
 return validateFiles(new Map([
 ['atlas.json',JSON.stringify({format:'atlas/1',id:'a',title:'Example',trees:['trees/a','trees/b']})],
 ['trees/a/tree.json',JSON.stringify({id:'a',title:'Account A',scope:'First',base:'base',children:[{point:'detail'}]})],
 ['trees/b/tree.json',JSON.stringify({id:'b',title:'Account B',scope:'Other',base:'other',children:[]})],
 ['trees/a/points/base.md',record({id:'base',sources:[{uri:'../evidence.md',sha256:'a'.repeat(64)}]},'Base','[Facet](../facets/meaning.md) [Source](../../../../evidence.md) [Detail](detail.md#scope).')],
 ['trees/a/points/detail.md',record({id:'detail'},'Detail','Read the [Base](base.md).\n\n## Scope\n\nA scoped explanation.')],
 ['trees/b/points/other.md',record({id:'other'},'Hidden other title','Private explanation citing [Base](../../a/points/base.md).')],
 ['trees/a/facets/meaning.md',record({id:'meaning',on:{point:'base'},via:'b',targets:[{point:'other'}],sources:[{uri:'../evidence.md',locator:'Facet locator'}]},'Meaning','Interpret [Detail](../points/detail.md) and [Source](../../../../evidence.md).')],
 ]),{root:'/tmp/atlas-render-references'});
}
test('renderer navigates exact Facets and declared sources with owning citation index',()=>{
 const view=fixture();assert.equal(view.status,'ready');const shown=presentAtlas(view);
 const base=shown.atlas.points.find(p=>p.id==='base');assert.match(base.html,/href="\?tree=a&amp;point=base&amp;facet=meaning"/);
 assert.match(base.html,/source=..%2Fevidence.md&amp;sourceIndex=0/);assert.match(base.html,/point=detail#point-detail-scope/);
 const facet=shown.atlas.facets[0];assert.match(facet.html,/facet=meaning&amp;source=..%2Fevidence.md&amp;sourceIndex=0/);
 assert.deepEqual(base.citers.map(x=>x.id),['detail','other']);assert.equal('path' in base.citers[0],false);
});
test('publication resolution and backlinks use only selected records and successfully retrieved declared sources',()=>{
 const view=fixture(), pub=preparePublication(view,{trees:['a'],points:['base'],sources:['../evidence.md']});
 const pointPaths=view.atlas.points.filter(p=>p.id==='base'),facetPaths=view.atlas.facets;
 const pending=presentAtlas({...view,atlas:pub.atlas},{pointPaths,facetPaths});const base=pending.atlas.points.find(p=>p.id==='base');
 assert.match(base.html,/facet=meaning/);assert.ok(!base.html.includes('source='));assert.ok(!base.html.includes('point=detail'));assert.deepEqual(base.citers,[]);
 for(const item of [...pub.atlas.points,...pub.atlas.facets])for(const source of item.sources??[])source.publishedPath='sources/selected.txt';
 const ready=presentAtlas({...view,atlas:pub.atlas},{pointPaths,facetPaths});assert.match(ready.atlas.points.find(p=>p.id==='base').html,/href="sources\/selected.txt"/);
 const serialized=JSON.stringify(ready);assert.ok(!serialized.includes('Hidden other title'));assert.ok(!serialized.includes('Private explanation'));assert.ok(!serialized.includes('trees/b/points/other.md'));
 assert.equal(ready.atlas.points.find(p=>p.id==='detail').html,'');
});

test('rendering distinguishes unresolved authored paths from excluded publication targets and retains source heading routes',()=>{
 const view=structuredClone(fixture());view.atlas.points[0].body+=' [Missing](absent.md)';
 assert.match(presentAtlas(view).atlas.points[0].html,/Reference target is missing or undeclared/);
 const pub=preparePublication(view,{trees:['a'],points:['base']});
 assert.match(presentAtlas({...view,atlas:pub.atlas},{pointPaths:view.atlas.points,facetPaths:view.atlas.facets}).atlas.points[0].html,/Reference not included/);
 assert.equal(referenceHref({status:'resolved',target:{kind:'source',source:{publishedPath:'sources/a.txt',publishedHtmlPath:'sources/a.html'},fragment:'#scope'}},{}),'sources/a.html#source-scope');
 assert.equal(referenceHref({status:'resolved',target:{kind:'source',source:{uri:'../report.md'},sourceIndex:0,fragment:'#scope'}},{tree:'a',id:'base'}),'?tree=a&point=base&source=..%2Freport.md&sourceIndex=0#source-scope');
});

test('body-only backlink indexing does not mistake thematic breaks for authored frontmatter',()=>{
 const initial=fixture();const files=new Map(initial.files.map(file=>[file.path,file.content]));
 files.set('trees/a/points/base.md',record({id:'base'},'Base','---\n\nRead [Detail](detail.md).\n\n---\n\nThe breaks are explanation content.'));
 const view=validateFiles(files,{root:initial.root});assert.equal(view.status,'ready');
 const shown=presentAtlas(view);assert.ok(shown.atlas.points.find(point=>point.id==='detail').citers.some(citer=>citer.id==='base'));
 const publication=preparePublication(view,{trees:['a']});
 const published=presentAtlas({...view,atlas:publication.atlas},{pointPaths:view.atlas.points,facetPaths:view.atlas.facets});
 assert.ok(published.atlas.points.find(point=>point.id==='detail').citers.some(citer=>citer.id==='base'));
});
