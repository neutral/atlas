import fs from 'node:fs';import path from 'node:path';import { isDeepStrictEqual } from 'node:util';
import { Diagnostic } from './model.mjs';import {ALLOWED_CHECK_SECTIONS,REFERENCE_FIELDS,REQUIRED_CHECK_SECTIONS,UTF8,UTF8_BOM} from './constants.mjs';
import {parseFrontMatter} from './frontmatter.mjs';import {checkSections,substantiveBody} from './markdown.mjs';import {schemaErrors,validFullDate,validators} from './schemas.mjs';import {decodeBestEffort,ioDiagnostic,relative,targetKey,uniqueObjectIds,uniqueStructural} from './util.mjs';import {validUri} from './resolved.mjs';

export function parseStructures(state,diagnostics){const structures=[state.atlas,...state.maps,...state.pointRecords,...state.checks,...state.publications];for(const item of structures)parseStructure(state,item,diagnostics);const known=new Set(structures.map(i=>path.resolve(i.file)));for(const file of state.files){if(!file.endsWith('.md')||known.has(path.resolve(file)))continue;let bytes;try{bytes=fs.readFileSync(file);}catch{continue;}const source=decodeBestEffort(bytes);if(!source.startsWith('---'))continue;const parsed=parseFrontMatter(source);const type=parsed.value?.type;if(type==='point')diagnostics.push(new Diagnostic('atlas.point.invalid-location','error','A Point record must live directly inside a Map points directory.',{path:relative(state.root,file)}));else if(type==='map')diagnostics.push(new Diagnostic('atlas.map.invalid-location','error','A Map structural file must be named map.md in a descendant Map directory.',{path:relative(state.root,file)}));else if(type==='check')diagnostics.push(new Diagnostic('atlas.check.invalid-location','error','A Check must live directly inside the root .checks directory.',{path:relative(state.root,file)}));else if(type==='publication')diagnostics.push(new Diagnostic('atlas.publication.invalid-location','error','A publication profile must live directly inside the root .publication directory.',{path:relative(state.root,file)}));}}
function parseStructure(state,item,diagnostics){let m;try{m=fs.lstatSync(item.file);}catch(e){ioDiagnostic(state,diagnostics,item.file,e);return;}if(m.isSymbolicLink()){diagnostics.push(new Diagnostic('atlas.discovery.symbolic-link','error','Structural files must not be symbolic links.',{path:relative(state.root,item.file)}));return;}if(!m.isFile()){ioDiagnostic(state,diagnostics,item.file,new Error('Structural path is not a regular file.'));return;}let bytes;try{bytes=fs.readFileSync(item.file);}catch(e){ioDiagnostic(state,diagnostics,item.file,e);return;}if(bytes.length>=3&&bytes.subarray(0,3).equals(UTF8_BOM)){diagnostics.push(new Diagnostic('atlas.text.bom','error','Structural text must not begin with a UTF-8 byte-order mark.',{path:relative(state.root,item.file)}));return;}let source;try{source=UTF8.decode(bytes);}catch(e){diagnostics.push(new Diagnostic('atlas.text.invalid-utf8','error',e instanceof Error?e.message:String(e),{path:relative(state.root,item.file)}));return;}if(source.includes('\0')){diagnostics.push(new Diagnostic('atlas.text.nul','error','Structural text must not contain NUL.',{path:relative(state.root,item.file)}));return;}const parsed=parseFrontMatter(source);item.body=parsed.body;item.parsed=true;if(parsed.error==='missing'){diagnostics.push(new Diagnostic('atlas.frontmatter.missing','error','Structural file must begin with one YAML front-matter document.',{path:relative(state.root,item.file)}));return;}if(parsed.error==='unclosed'){diagnostics.push(new Diagnostic('atlas.frontmatter.unclosed','error','Opening YAML front matter has no closing delimiter.',{path:relative(state.root,item.file)}));return;}if(parsed.errors.length){diagnostics.push(new Diagnostic('atlas.frontmatter.invalid-yaml','error',parsed.errors[0],{path:relative(state.root,item.file),details:{errors:parsed.errors}}));return;}item.frontMatter=parsed.value;if(!item.frontMatter||typeof item.frontMatter!=='object'||Array.isArray(item.frontMatter)){diagnostics.push(new Diagnostic('atlas.frontmatter.invalid-yaml','error','Front matter must construct a JSON-compatible object.',{path:relative(state.root,item.file)}));return;}if(item.frontMatter.type!==item.expectedType){diagnostics.push(new Diagnostic('atlas.frontmatter.schema','error',`Expected type ${item.expectedType}.`,{path:relative(state.root,item.file),pointer:'/type'}));return;}if(item.expectedType==='atlas'&&item.frontMatter.format!==1){diagnostics.push(new Diagnostic('atlas.format.unsupported','error','The Atlas root must declare format 1.',{path:'atlas.md',pointer:'/format'}));return;}const validate=validators[item.expectedType];item.schemaValid=Boolean(validate?.(item.frontMatter));if(!item.schemaValid){const errors=schemaErrors(validate);diagnostics.push(new Diagnostic('atlas.frontmatter.schema','error',errors[0]?.message??'Front matter does not match its schema.',{path:relative(state.root,item.file),pointer:errors[0]?.pointer??'/',details:{errors}}));}}

export function validateStructural(state,diagnostics){
  const maps=state.maps.filter(i=>i.schemaValid),records=state.pointRecords.filter(i=>i.schemaValid),checks=state.checks.filter(i=>i.schemaValid),publications=state.publications.filter(i=>i.schemaValid);
  uniqueStructural(state,maps,i=>i.frontMatter.id,'atlas.map.duplicate-id','Map identifier',diagnostics);
  uniqueStructural(state,maps,i=>i.frontMatter.question,'atlas.map.duplicate-question','Map question',diagnostics);
  uniqueStructural(state,checks,i=>i.frontMatter.id,'atlas.check.duplicate-id','Check identifier',diagnostics);
  uniqueStructural(state,publications,i=>i.frontMatter.id,'atlas.publication.duplicate-id','Publication profile identifier',diagnostics);
  const resources=state.atlas.schemaValid?state.atlas.frontMatter.resources??[]:[];
  uniqueObjectIds(resources,'atlas.resource.duplicate-id','Resource identifier','atlas.md',diagnostics);
  for(const map of maps){
    map.id=map.frontMatter.id;
    map.areas=new Map();
    const areaQuestions=new Set();
    for(const area of map.frontMatter.areas??[]){
      if(map.areas.has(area.id))diagnostics.push(new Diagnostic('atlas.area.duplicate-id','error',`Area identifier ${area.id} repeats in Map ${map.id}.`,{path:relative(state.root,map.file)}));
      else map.areas.set(area.id,area);
      if(areaQuestions.has(area.question))diagnostics.push(new Diagnostic('atlas.area.duplicate-question','error',`Area question repeats in Map ${map.id}: ${area.question}`,{path:relative(state.root,map.file)}));
      areaQuestions.add(area.question);
      validateTargets(state,area,map.file,diagnostics);
    }
    validateTargets(state,map.frontMatter,map.file,diagnostics);
  }
  if(state.atlas.schemaValid){
    validateTargets(state,state.atlas.frontMatter,state.atlas.file,diagnostics);
    for(const [index,r] of resources.entries())if(!validUri(r.uri))diagnostics.push(new Diagnostic('atlas.reference.invalid-uri','error',`Invalid registered Resource URI: ${r.uri}`,{path:'atlas.md',pointer:`/resources/${index}/uri`}));
  }
  const byDir=new Map(maps.map(m=>[m.directory,m]));
  for(const record of records){
    record.id=record.frontMatter.id;
    record.map=byDir.get(record.mapDirectory)??null;
    const expected=path.basename(record.file,'.md');
    if(record.id!==expected)diagnostics.push(new Diagnostic('atlas.point.filename-mismatch','error',`Point id ${record.id} must match filename ${expected}.`,{path:relative(state.root,record.file),pointer:'/id'}));
    const seenAreas=new Set();
    for(const [index,membership] of (record.frontMatter.areas??[]).entries()){
      if(seenAreas.has(membership.area))diagnostics.push(new Diagnostic('atlas.area.duplicate-membership','error',`Point record ${record.id} repeats Area membership ${membership.area}.`,{path:relative(state.root,record.file),pointer:`/areas/${index}/area`}));
      seenAreas.add(membership.area);
    }
    const substance=substantiveBody(record.body),bodyAuthored=record.body.trim().length>0;
    record.substance=substance;
    if(record.frontMatter.record==='anchor'){
      if(!substance.hasContentBlock)diagnostics.push(new Diagnostic('atlas.point.anchor-body-empty','error','Anchor body must contain at least one substantive block.',{path:relative(state.root,record.file)}));
      validateReview(state,record,diagnostics);
    }else{
      const contribution=(record.frontMatter.areas?.length??0)>0||(record.frontMatter.content?.length??0)>0||(record.frontMatter.references?.length??0)>0||bodyAuthored;
      if(!contribution)diagnostics.push(new Diagnostic('atlas.point.context-empty','error','A context record must contribute an explained Area membership, Content, References, or substantive body context.',{path:relative(state.root,record.file)}));
      if(bodyAuthored&&!substance.hasContentBlock)diagnostics.push(new Diagnostic('atlas.point.context-body-empty','error','An authored context body must contain at least one substantive block.',{path:relative(state.root,record.file)}));
    }
    validateTargets(state,record.frontMatter,record.file,diagnostics);
  }
  for(const check of checks){
    check.id=check.frontMatter.id;
    const expected=path.basename(check.file,'.md');
    if(check.id!==expected)diagnostics.push(new Diagnostic('atlas.check.filename-mismatch','error',`Check id ${check.id} must match filename ${expected}.`,{path:relative(state.root,check.file),pointer:'/id'}));
    validateCheck(state,check,diagnostics);
  }
  for(const publication of publications){
    publication.id=publication.frontMatter.id;
    const expected=path.basename(publication.file,'.md');
    if(publication.id!==expected)diagnostics.push(new Diagnostic('atlas.publication.filename-mismatch','error',`Publication profile id ${publication.id} must match filename ${expected}.`,{path:relative(state.root,publication.file),pointer:'/id'}));
  }
}
function validateCheck(state,check,diagnostics){const sections=checkSections(check.body),labels=sections.map(s=>s.label);for(const required of REQUIRED_CHECK_SECTIONS)if(labels.filter(l=>l===required).length!==1)diagnostics.push(new Diagnostic('atlas.check.required-section','error',`Check must contain exactly one level-two ${required} heading.`,{path:relative(state.root,check.file)}));const counts=REQUIRED_CHECK_SECTIONS.every(r=>labels.filter(l=>l===r).length===1);if(counts&&!(isDeepStrictEqual(labels,REQUIRED_CHECK_SECTIONS)||isDeepStrictEqual(labels,ALLOWED_CHECK_SECTIONS)))diagnostics.push(new Diagnostic('atlas.check.section-order','error','Check level-two sections must be Requirement, Verification, Failure, and optional Exceptions in that order.',{path:relative(state.root,check.file),details:{sections:labels}}));for(const required of REQUIRED_CHECK_SECTIONS){const section=sections.find(s=>s.label===required);if(section&&(!section.hasContentBlock||section.scalarCount===0))diagnostics.push(new Diagnostic('atlas.check.section-empty','error',`Check section ${required} must contain substantive text.`,{path:relative(state.root,check.file)}));}}
function validateReview(state,record,diagnostics){const review=record.frontMatter.review;if(!review)return;for(const f of ['reviewed-at','review-after'])if(review[f]!==undefined&&!validFullDate(review[f]))return;if(review['reviewed-at']&&review['review-after']&&review['review-after']<=review['reviewed-at'])diagnostics.push(new Diagnostic('atlas.point.invalid-review-window','error','review-after must be later than reviewed-at.',{path:relative(state.root,record.file),pointer:'/review/review-after'}));}
function validateTargets(state,container,source,diagnostics){for(const field of REFERENCE_FIELDS){const seen=new Set();for(const [i,target] of (container[field]??[]).entries()){const key=targetKey(field,target);if(seen.has(key))diagnostics.push(new Diagnostic('atlas.reference.duplicate','error',`Duplicate ${field==='content'?'Content':'Reference'} target.`,{path:relative(state.root,source),pointer:`/${field}/${i}`}));seen.add(key);if('uri'in target&&!validUri(target.uri))diagnostics.push(new Diagnostic('atlas.reference.invalid-uri','error',`Invalid URI reference: ${target.uri}`,{path:relative(state.root,source),pointer:`/${field}/${i}/uri`}));}}}
