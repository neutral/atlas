import fs from 'node:fs';
import path from 'node:path';
import { Diagnostic, compareCodePoints } from './model.mjs';
import { UTF8, UTF8_BOM } from './constants.mjs';
export function structural(file,expectedType){return{file,expectedType,frontMatter:null,body:'',parsed:false,schemaValid:false};}
export function sortedEntries(directory){return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>compareCodePoints(a.name,b.name));}
export function relative(root,target){const v=path.relative(root,target).split(path.sep).join('/');return v||'.';}
export function isWithin(root,target){const rel=path.relative(root,target);return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel));}
export function exactCase(root,target){const rel=path.relative(root,target);let current=root;for(const segment of rel.split(path.sep).filter(Boolean)){const entries=fs.readdirSync(current);if(!entries.includes(segment))return false;current=path.join(current,segment);}return true;}
export function pathCaseOrNormalizationMismatch(root,target){const rel=path.relative(root,target);let current=root;for(const segment of rel.split(path.sep).filter(Boolean)){let entries;try{entries=fs.readdirSync(current);}catch{return false;}if(entries.includes(segment)){current=path.join(current,segment);continue;}const key=segment.normalize('NFC').toLowerCase(),match=entries.find(entry=>entry.normalize('NFC').toLowerCase()===key);if(match)return true;return false;}return false;}
export function pathContainsSymlink(root,target){const rel=path.relative(root,target);let current=root;for(const segment of rel.split(path.sep).filter(Boolean)){current=path.join(current,segment);let m;try{m=fs.lstatSync(current);}catch{return false;}if(m.isSymbolicLink())return true;}return false;}
export function ioDiagnostic(state,diagnostics,target,error){state.complete=false;diagnostics.push(new Diagnostic('atlas.processing.io','error',error instanceof Error?error.message:String(error),{path:relative(state.root,target)}));}
export function decodeBestEffort(bytes){const candidate=bytes.length>=3&&bytes.subarray(0,3).equals(UTF8_BOM)?bytes.subarray(3):bytes;try{return UTF8.decode(candidate);}catch{return candidate.toString('utf8');}}
export function uniqueStructural(state,records,key,code,label,diagnostics){const seen=new Map();for(const record of records){const value=key(record);if(seen.has(value))diagnostics.push(new Diagnostic(code,'error',`${label} ${value} repeats.`,{path:relative(state.root,record.file),details:{first:relative(state.root,seen.get(value).file)}}));else seen.set(value,record);}}
export function uniqueObjectIds(records,code,label,source,diagnostics){const seen=new Set();for(const record of records){if(seen.has(record.id))diagnostics.push(new Diagnostic(code,'error',`${label} ${record.id} repeats.`,{path:source}));seen.add(record.id);}}
export function comparePointRecords(a,b){const c=compareCodePoints(a.map?.id??'',b.map?.id??'');return c!==0?c:compareCodePoints(a.file,b.file);}
export function compareRelations(a,b){for(const key of ['type','targetPoint','sourceMap','sourcePath']){const c=compareCodePoints(a[key],b[key]);if(c!==0)return c;}return 0;}
export function targetKey(field,target){const identity='resource'in target?`resource:${target.resource}#${target.selector??''}`:`uri:${target.uri}`;return field==='references'?`${identity}\0${target.role}`:identity;}
export function extensionFields(value){return Object.fromEntries(Object.entries(value??{}).filter(([k])=>k.startsWith('x-')).sort(([a],[b])=>compareCodePoints(a,b)));}
