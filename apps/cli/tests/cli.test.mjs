import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const bin=path.join(root,'apps','cli','bin','atlas-validate.mjs');
const examples=path.join(root,'spec','examples');
function run(args){return spawnSync(process.execPath,[bin,...args],{cwd:root,encoding:'utf8'});}

test('CLI exits 0 for complete valid input',()=>{
  const result=run([path.join(examples,'valid/minimal'),'--json']);
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);
  assert.equal(output.valid,true);
  assert.equal(output.specificationRevision,'0.9.0');
  assert.deepEqual(output.implementation,{name:'atlas-reference-validator',version:'0.9.0',status:'stable'});
});

test('CLI exits 1 for complete invalid input and fixture mismatch',t=>{
  const invalid=run([path.join(examples,'invalid/empty-anchor-body'),'--json']);
  assert.equal(invalid.status,1,invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).complete,true);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-cli-fixture-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const manifestPath=path.join(directory,'manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify({format:1,profile:'neutral.atlas-validator.resolved',fixtures:[{path:path.join(examples,'valid/minimal'),complete:true,valid:false,description:'Deliberate fixture mismatch.',diagnostics:['atlas.markdown.summary']}]}));
  const mismatch=run(['--fixtures',manifestPath]);
  assert.equal(mismatch.status,1,mismatch.stderr);
});

test('CLI exits 2 for incomplete validation and usage errors',()=>{
  const incomplete=run([path.join(examples,'valid/minimal'),'--profile','neutral.atlas-validator.unsupported','--json']);
  assert.equal(incomplete.status,2,incomplete.stderr);
  assert.equal(JSON.parse(incomplete.stdout).complete,false);
  const usage=run([]);
  assert.equal(usage.status,2,usage.stderr);
});
