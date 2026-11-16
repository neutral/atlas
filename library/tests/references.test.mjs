import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles, citedMaterial } from '../src/model.mjs';
import { referenceIndex, directCiters, sourceCitations, prepareMove, resolveReference, markdownHeadingIds } from '../src/references.mjs';
import * as references from '../src/references.mjs';

const record = (id, body, extra = {}) => `---\n${JSON.stringify({id,...extra})}\n---\n# ${id}\n\n${body}\n`;
function fixture(body = '[detail](detail.md) and [facet](../facets/meaning.md).', root = '/tmp/atlas-reference-fixture') {
  const files = new Map([
    ['atlas.json', JSON.stringify({format:'atlas/1.2',id:'example',title:'Example',trees:['trees/a','trees/b']})],
    ['style.md','# Accounts\n\nEach Tree is one account.\n'],
    ['trees/a/tree.json',JSON.stringify({id:'a',title:'A',scope:'First account',base:'base',children:[{point:'detail'}]})],
    ['trees/b/tree.json',JSON.stringify({id:'b',title:'B',scope:'Other account',base:'other',children:[]})],
    ['trees/a/points/base.md',record('base',body,{sources:[{uri:'../evidence.md',role:'evidence'},{uri:'../evidence.md#limits',role:'background',locator:'Limits'}]})],
    ['trees/a/points/detail.md',record('detail','A detail.\n\n## Scope\n\nIts exact scope. [Base](base.md)')],
    ['trees/b/points/other.md',record('other','An independent account.')],
    ['trees/a/facets/meaning.md',record('meaning','A consequence of [detail](../points/detail.md).',{on:'base',via:'b',targets:['other']})],
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
 // A page that leaves links or citations out is not exhaustive; the whole index is.
 assert.equal(bounded.bounds.exhaustive,false);assert.equal(referenceIndex(view).bounds.exhaustive,true);
});

test('move preserves IDs and repairs incoming/outgoing inline destinations, escapes and CRLF locations',()=>{
 const view=fixture('[escaped](detail\\.md#scope) [angle](<detail.md> "title") [root](trees/a/points/detail.md)');
 // CRLF location calculations must still edit exactly the href bytes.
 const files=new Map(view.files.map(f=>[f.path,f.content.replaceAll('\n','\r\n')]));const crlf=validateFiles(files,{root:view.root});
 const plan=prepareMove(crlf,{point:'detail',path:'trees/a/points/nested/new detail.md',reason:'Move detail without changing meaning.'});
 assert.equal(plan.status,'ready');assert.equal(plan.candidate.atlas.points.find(p=>p.id==='detail').path,'trees/a/points/nested/new detail.md');
 // A move repairs the path and keeps the rest of the destination, a fragment included, which stays a diagnostic.
 assert.deepEqual(referenceIndex(plan.candidate).diagnostics.map(d=>d.code),['REFERENCE_FRAGMENT']);
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

test('a link to a record, or within one, carries no fragment: each that does is a reference diagnostic, and a link to a source keeps its own', () => {
  const view = fixture('[good](detail.md#scope) [missing](detail.md#absent) [facet](../facets/meaning.md#meaning) [self](#missing-self) [empty](detail.md#) [plain](detail.md) [source](../evidence.md#limits)');
  const index = referenceIndex(view);
  const links = index.references.filter(reference => reference.from.id === 'base');
  assert.ok(links.every(reference => reference.status === 'resolved' && !('heading' in reference)));
  assert.equal(links[1].target.id, 'detail');
  assert.deepEqual(links[2].target, { kind: 'facet', id: 'meaning', tree: 'a', path: 'trees/a/facets/meaning.md', fragment: '#meaning', on: 'base' });
  assert.deepEqual(links[3].target, { kind: 'point', id: 'base', tree: 'a', path: 'trees/a/points/base.md', fragment: '#missing-self' });
  assert.deepEqual(links[6].target, { kind: 'source', source: { uri: '../evidence.md#limits', role: 'background', locator: 'Limits' }, sourceIndex: 1, path: '../evidence.md', fragment: '#limits' });
  // A heading that exists in the target makes no difference: the record is read whole.
  assert.deepEqual(index.diagnostics, links.slice(0, 5).map(link => ({ code: 'REFERENCE_FRAGMENT', path: 'trees/a/points/base.md', line: 6, column: link.location.column,
    message: `A link to a record names the record's file and carries no fragment: ${link.href}` })));
  assert.deepEqual(links.slice(0, 5).map(link => link.location.column), [1, 25, 53, 91, 113]);
  assert.ok(directCiters(view, { point: 'detail' }).citers.some(citer => citer.record.id === 'base'));
  // Reference diagnostics never change the Atlas's validity.
  assert.equal(view.status, 'ready');
  assert.deepEqual(referenceIndex(fixture('[detail](detail.md) and [facet](../facets/meaning.md).')).diagnostics, []);
});

test('a link from a Facet to itself names the Point the Facet attaches to', () => {
  const view = fixture();
  const facet = view.atlas.facets[0];
  assert.deepEqual(resolveReference(view, facet, '#meaning').target, { kind: 'facet', id: 'meaning', tree: 'a', path: 'trees/a/facets/meaning.md', fragment: '#meaning', on: 'base' });
  assert.equal(resolveReference(validateFiles(new Map([['atlas.json', '{}']]), { root: view.root }), facet, 'detail.md').status, 'unavailable');
});

test('heading identities follow one rule for records and for sources', () => {
  assert.deepEqual(markdownHeadingIds('## Scope\n\nText.\n\n## Scope\n\n### Résumé & **limits**\n\n> ## Quoted\n', { title: 'Scope' }), ['scope', 'scope-1', 'scope-2', 'résumé--limits', 'quoted']);
  assert.deepEqual(markdownHeadingIds('Plain text.'), []);
});

test('a heading is named from its text content, as a title is: raw HTML, markup and escapes removed, a line break read as a space', () => {
  const named = text => markdownHeadingIds(text);
  // The contract's own examples of text content, read as heading names.
  assert.deepEqual(named('# Service *purpose* `x` ##'), ['service-purpose-x']);
  assert.deepEqual(named('# **a*'), ['a'], 'a delimiter CommonMark does not parse stays as text, then goes as a character a name does not keep');
  // Raw HTML: each comment, then each run from < to >, is removed, and the rest is kept.
  assert.deepEqual(named('## <em>Sources</em>'), ['sources']);
  assert.deepEqual(named('## A <!-- a note --> B'), ['a--b']);
  assert.deepEqual(named('## <b></b> Lead'), ['lead'], 'the text content is trimmed, as a title is');
  // Entity and numeric references and backslash escapes are decoded; links and images keep their text and description.
  assert.deepEqual(named('## Fish &amp; chips &#35;1'), ['fish--chips-1']);
  assert.deepEqual(named('## \\*Not emphasis\\*'), ['not-emphasis']);
  assert.deepEqual(named('## [The guide](guide.md "Its title") ![Logo](logo.png)'), ['the-guide-logo']);
  // A line break, soft or hard, reads as one space.
  assert.deepEqual(named('Two\nlines\n---\n\nHard  \nbreak\n==='), ['two-lines', 'hard-break']);
  // A heading is a heading as CommonMark reads one: a line inside an HTML block is not.
  assert.deepEqual(named('<div>\n## Inside a block of HTML\n</div>\n\n## After it'), ['after-it']);
  // A stamp's section is found by the same name.
  const text = '# Notes\n\n## <em>Sources</em>\n\nWhat is cited.\n\n## Next\n\nOther.\n';
  assert.equal(citedMaterial('notes.md#sources', text).start, Buffer.byteLength('# Notes\n\n'));
  assert.equal(citedMaterial('notes.md#emsourcesem', text), null);
});

test('the references module exports its 1.2 operations', () => {
  assert.deepEqual(Object.keys(references).sort(), ['directCiters', 'markdownHeadingIds', 'prepareMove', 'prepareStamp', 'referenceIndex', 'resolveReference', 'sourceCitations', 'staleSources']);
});
