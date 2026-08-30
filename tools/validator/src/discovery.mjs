import fs from 'node:fs';
import path from 'node:path';
import { Diagnostic } from './model.mjs';
import { IGNORED_DIRECTORIES } from './constants.mjs';
import { ioDiagnostic, relative, sortedEntries, structural } from './util.mjs';

export function findAtlasRoot(start) {
  let current = path.resolve(start);
  try { const m=fs.lstatSync(current); if (m.isFile()||m.isSymbolicLink()) current=path.dirname(current); }
  catch (error) {
    if (error.code==='ENOENT'||error.code==='ENOTDIR') return null;
    throw error;
  }
  while (true) {
    const candidate=path.join(current,'atlas.md');
    try { const m=fs.lstatSync(candidate); if (m.isFile()||m.isSymbolicLink()) return current; }
    catch (error) {
      if (error.code!=='ENOENT'&&error.code!=='ENOTDIR') throw error;
    }
    const parent=path.dirname(current); if (parent===current) return null; current=parent;
  }
}

export function discover(root, diagnostics) {
  const state={root,complete:true,files:[],maps:[],pointRecords:[],checks:[],publications:[],pointIdentities:new Map(),atlas:structural(path.join(root,'atlas.md'),'atlas')};
  discoverChecks(state,diagnostics); discoverPublication(state,diagnostics); discoverDirectory(state,root,true,diagnostics); return state;
}

function discoverDirectory(state,directory,isRoot,diagnostics) {
  const entries=readDirectory(state,directory,diagnostics); if(!entries)return;
  if(!isRoot){const nested=entries.find(e=>e.name==='atlas.md'); if(nested){const target=path.join(directory,'atlas.md'); if(nested.isSymbolicLink())diagnostics.push(new Diagnostic('atlas.discovery.symbolic-link','error','A nested Atlas boundary must not be a symbolic link.',{path:relative(state.root,target)})); else if(nested.isFile())diagnostics.push(new Diagnostic('atlas.discovery.nested-atlas-boundary','information','Discovery stopped at a nested Atlas.',{path:relative(state.root,directory)})); return;}}
  let map=null; const mapEntry=entries.find(e=>e.name==='map.md');
  if(mapEntry){const target=path.join(directory,'map.md'); if(isRoot){diagnostics.push(new Diagnostic('atlas.map.invalid-location','error','A Map must be in a descendant directory, not the Atlas root.',{path:'map.md'}));} else if(mapEntry.isSymbolicLink())diagnostics.push(new Diagnostic('atlas.discovery.symbolic-link','error','A map.md file must not be a symbolic link.',{path:relative(state.root,target)})); else if(mapEntry.isFile()){map=structural(target,'map');map.directory=directory;map.pointFiles=[];state.maps.push(map);}}
  const pointsEntry=entries.find(e=>e.name==='points');
  if(pointsEntry){const target=path.join(directory,'points'); if(!map)diagnostics.push(new Diagnostic('atlas.point.invalid-location','error','A points directory must be directly beside a discovered map.md.',{path:relative(state.root,target)})); else if(pointsEntry.isSymbolicLink())diagnostics.push(new Diagnostic('atlas.discovery.symbolic-link','error','A Map points directory must not be a symbolic link.',{path:relative(state.root,target)})); else if(!pointsEntry.isDirectory())diagnostics.push(new Diagnostic('atlas.point.invalid-location','error','A Map points entry must be a directory.',{path:relative(state.root,target)})); else discoverPointRecords(state,map,target,diagnostics);}
  for(const entry of entries){if((!isRoot&&entry.name==='map.md')||entry.name==='points')continue; if(isRoot&&['atlas.md','.checks','.publication','map.md'].includes(entry.name))continue; if(IGNORED_DIRECTORIES.has(entry.name))continue; const target=path.join(directory,entry.name);
    if(entry.name==='.checks'){diagnostics.push(new Diagnostic('atlas.check.invalid-location','error','The only valid .checks directory is directly under the Atlas root.',{path:relative(state.root,target)}));continue;}
    if(entry.name==='.publication'){diagnostics.push(new Diagnostic('atlas.publication.invalid-location','error','The only valid .publication directory is directly under the Atlas root.',{path:relative(state.root,target)}));continue;}
    if(entry.isSymbolicLink())continue; if(entry.isDirectory())discoverDirectory(state,target,false,diagnostics); else if(entry.isFile())state.files.push(target);
  }
}

function discoverPointRecords(state,map,directory,diagnostics){const entries=readDirectory(state,directory,diagnostics);if(!entries)return;for(const entry of entries){const target=path.join(directory,entry.name);if(entry.isSymbolicLink()||entry.isDirectory()||!entry.isFile()||!entry.name.endsWith('.md'))diagnostics.push(new Diagnostic('atlas.point.invalid-location','error','A points directory can contain only direct regular Markdown files.',{path:relative(state.root,target)}));else{const r=structural(target,'point');r.mapDirectory=map.directory;map.pointFiles.push(r);state.pointRecords.push(r);}}}
function discoverChecks(state,diagnostics){const dir=path.join(state.root,'.checks');let m;try{m=fs.lstatSync(dir);}catch(e){if(e.code==='ENOENT')return;ioDiagnostic(state,diagnostics,dir,e);return;}if(m.isSymbolicLink()){diagnostics.push(new Diagnostic('atlas.discovery.symbolic-link','error','The root .checks directory must not be a symbolic link.',{path:'.checks'}));return;}if(!m.isDirectory()){diagnostics.push(new Diagnostic('atlas.check.invalid-location','error','The root .checks path must be a directory.',{path:'.checks'}));return;}const entries=readDirectory(state,dir,diagnostics);if(!entries)return;for(const entry of entries){const target=path.join(dir,entry.name);if(entry.isSymbolicLink()||entry.isDirectory()||!entry.isFile()||!entry.name.endsWith('.md'))diagnostics.push(new Diagnostic('atlas.check.invalid-location','error','The .checks directory can contain only direct regular Markdown files.',{path:relative(state.root,target)}));else state.checks.push(structural(target,'check'));}}
function discoverPublication(state,diagnostics){const dir=path.join(state.root,'.publication');let m;try{m=fs.lstatSync(dir);}catch(e){if(e.code==='ENOENT')return;ioDiagnostic(state,diagnostics,dir,e);return;}if(m.isSymbolicLink()){diagnostics.push(new Diagnostic('atlas.discovery.symbolic-link','error','The root .publication directory must not be a symbolic link.',{path:'.publication'}));return;}if(!m.isDirectory()){diagnostics.push(new Diagnostic('atlas.publication.invalid-location','error','The root .publication path must be a directory.',{path:'.publication'}));return;}const entries=readDirectory(state,dir,diagnostics);if(!entries)return;for(const entry of entries){const target=path.join(dir,entry.name);if(entry.isSymbolicLink()||entry.isDirectory()||!entry.isFile()||!entry.name.endsWith('.md'))diagnostics.push(new Diagnostic('atlas.publication.invalid-location','error','The .publication directory can contain only direct regular Markdown profile files.',{path:relative(state.root,target)}));else state.publications.push(structural(target,'publication'));}}
function readDirectory(state,directory,diagnostics){try{return sortedEntries(directory);}catch(e){ioDiagnostic(state,diagnostics,directory,e);return null;}}
