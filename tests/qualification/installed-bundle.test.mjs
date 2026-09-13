import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selected = process.env.ATLAS_BUNDLE;
const bundle = selected ? fs.realpathSync(selected) : null;
const executable = bundle && path.join(bundle, 'bin/atlas');
const env = { ...process.env, PATH: '/nonexistent-atlas-qualification-path', NODE_PATH: '', NODE_OPTIONS: '' };

test('installed native bundle qualifies ordinary commands and service outside the checkout', { timeout: 240000 }, () => {
  assert.ok(bundle, 'Set ATLAS_BUNDLE to an assembled native bundle. This qualification never silently skips.');
  const result = spawnSync(process.execPath, [path.join(root, 'distribution/bundle/qualify.mjs'), bundle], {
    encoding: 'utf8', timeout: 230000, maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
});

test('a killed installed service retains interrupted originals and durable drafts after restart', { timeout: 60000 }, async t => {
  assert.ok(bundle, 'Set ATLAS_BUNDLE to an assembled native bundle.');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas interrupted bundle ')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'project with spaces'), state = path.join(directory, 'durable state');
  fs.mkdirSync(project);
  fs.cpSync(path.join(root, 'spec/examples/valid/cross-map'), path.join(project, 'atlas'), { recursive: true });
  const first = 'maps/architecture/map.md', second = 'maps/operations/map.md';
  const firstPath = path.join(project, 'atlas', first), secondPath = path.join(project, 'atlas', second);
  const originalFirst = fs.readFileSync(firstPath, 'utf8'), originalSecond = fs.readFileSync(secondPath, 'utf8');
  const evaluator = path.join(directory, 'controlled interruption.mjs');
  // Trusted host instrumentation kills the real worker process after its first authored replacement.
  fs.writeFileSync(evaluator, `import fs from 'node:fs';\nconst rename = fs.renameSync;\nfs.renameSync = function(from, to) { const result = rename.call(fs, from, to); if (to === ${JSON.stringify(firstPath)}) process.kill(process.pid, 'SIGKILL'); return result; };\nexport const registrations = [];\n`);
  const children = [];
  t.after(() => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  async function launch(extra = []) {
    const child = spawn(executable, ['open', project, '--atlas', 'atlas', '--state-directory', state, '--cache-directory', path.join(directory, 'cache'), '--no-browser', ...extra], {
      cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '', errors = '';
    child.stderr.on('data', bytes => { errors += bytes; });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Service startup timed out: ${output}\n${errors}`)), 15000);
      child.stdout.on('data', bytes => {
        output += bytes;
        const match = output.match(/Open: (http:\/\/127\.0\.0\.1:\d+\/#[^\s]+)/u);
        if (match) { clearTimeout(timer); resolve(new URL(match[1])); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); if (!output.includes('Open: ')) reject(new Error(`Service exited (${code}): ${errors}`)); });
    });
    return { child, async rpc(method, params = {}) {
      const response = await fetch(`${url.origin}/api/${method}`, { method: 'POST', headers: {
        Origin: url.origin, 'Content-Type': 'application/json', 'X-Atlas-Token': new URLSearchParams(url.hash.slice(1)).get('token'),
      }, body: JSON.stringify(params), signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.result;
    } };
  }
  let service = await launch(['--evaluator', evaluator]);
  const initial = await service.rpc('state');
  const draft = await service.rpc('draft-save', { path: first, baseViewDigest: initial.view.identity.digest, text: `${originalFirst}\nUnfinished durable draft.\n` });
  const prepared = await service.rpc('prepare', { baseViewId: initial.viewId, operations: [
    { type: 'repair-document', path: first, text: `${originalFirst}\nReviewed first change.\n` },
    { type: 'repair-document', path: second, text: `${originalSecond}\nReviewed second change.\n` },
  ] });
  assert.equal(prepared.plan.changes.length, 2);
  assert.equal(prepared.plan.status, 'ready');
  const died = once(service.child, 'exit');
  await assert.rejects(service.rpc('apply', { planId: prepared.planId, mode: 'validated' }));
  assert.deepEqual(await died, [null, 'SIGKILL']);
  assert.match(fs.readFileSync(firstPath, 'utf8'), /Reviewed first change/);
  assert.equal(fs.readFileSync(secondPath, 'utf8'), originalSecond);
  const recoveryRoot = path.join(state, 'recovery');
  const journals = fs.readdirSync(recoveryRoot).filter(name => name.startsWith('change-'));
  assert.equal(journals.length, 1);
  const journal = path.join(recoveryRoot, journals[0]);
  assert.equal(fs.readFileSync(path.join(journal, 'originals/0.bin'), 'utf8'), originalFirst);
  assert.equal(fs.readFileSync(path.join(journal, 'originals/1.bin'), 'utf8'), originalSecond);
  const inspection = spawnSync(executable, ['author', 'recovery-inspect', '--repository', project, '--atlas', 'atlas', '--recovery', journal], { cwd: directory, env, encoding: 'utf8' });
  assert.equal(inspection.status, 0, inspection.stderr);
  assert.equal(JSON.parse(inspection.stdout).inactive, true);
  service = await launch();
  assert.equal((await service.rpc('draft-list')).drafts.find(item => item.draftId === draft.draftId).text, draft.text);
  assert.equal(fs.existsSync(journal), true, 'Restart must preserve interrupted recovery.');
  const closed = once(service.child, 'exit');
  service.child.kill('SIGTERM');
  assert.deepEqual(await closed, [0, null]);
});
