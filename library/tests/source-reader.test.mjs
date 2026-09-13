import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openAtlas } from '../src/index.mjs';

const fixture = fileURLToPath(new URL('../../spec/examples/valid/cross-map/', import.meta.url));

function setup(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-source-reader-'));
  const root = path.join(project, 'atlas');
  fs.cpSync(fixture, root, { recursive: true });
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  return { project, root, view: openAtlas(root) };
}

test('registered Resources and direct references preserve distinct bases and roles', async (t) => {
  const { root, view } = setup(t);
  const expected = fs.readFileSync(path.join(root, 'docs/authentication.md'), 'utf8');
  const target = { resource: 'authentication-guide', role: 'evidence', selector: undefined };
  const registered = await view.readSource(target, { ownerPath: 'maps/architecture/map.md' });
  assert.equal(registered.status, 'read');
  assert.equal(registered.ownerPath, 'atlas.md');
  assert.equal(registered.target.role, 'evidence');
  assert.equal(registered.text, expected);
  assert.equal(registered.observation.complete, true);
  const direct = await view.readSource({ uri: '../../docs/authentication.md', role: 'implementation' }, { ownerPath: 'maps/architecture/map.md' });
  assert.equal(direct.status, 'read');
  assert.equal(direct.ownerPath, 'maps/architecture/map.md');
  assert.equal(direct.target.role, 'implementation');
  assert.equal(direct.text, expected);
  assert.equal(direct.observation.sha256, registered.observation.sha256);
});

test('external-local content requires an explicit allowed root and rejects symlinks', async (t) => {
  const { project, root, view } = setup(t);
  const outside = path.join(project, 'outside.txt');
  fs.writeFileSync(outside, 'External source retained under caller authority.');
  const target = { uri: '../outside.txt' };
  assert.equal((await view.readSource(target)).status, 'unrequested');
  const allowed = await view.readSource(target, { allowedRoots: [project] });
  assert.equal(allowed.status, 'read');
  assert.equal(allowed.text, fs.readFileSync(outside, 'utf8'));
  fs.symlinkSync(outside, path.join(root, 'linked.txt'));
  const linked = await view.readSource({ uri: 'linked.txt' }, { allowedRoots: [project] });
  assert.equal(linked.status, 'unsupported');
  assert.equal(linked.text, undefined);
  await assert.rejects(view.readSource(target, { allowedRoots: ['..'] }), { code: 'atlas.tools.invalid-argument' });
});

test('external retrieval never happens without an explicitly supplied reader', async (t) => {
  const { view } = setup(t);
  const target = { uri: 'https://example.com/source' };
  assert.equal((await view.readSource(target)).status, 'unrequested');
  const requests = [];
  const result = await view.readSource(target, {
    reader(request) {
      requests.push(request);
      return { bytes: new TextEncoder().encode('Observed by caller'), provenance: 'Test-controlled retrieval' };
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(result.status, 'read');
  assert.equal(result.observation.kind, 'caller-reader');
  assert.equal(result.observation.provenance, 'Test-controlled retrieval');
  assert.equal(result.observation.digestScope, 'returned-bytes');
  const failed = await view.readSource(target, { reader() { throw new Error('Offline'); } });
  assert.equal(failed.status, 'unreadable');
});

test('source contents remain separate current observations from retained raw documents', async (t) => {
  const { root, view } = setup(t);
  const old = view.readDocument('docs/authentication.md');
  fs.writeFileSync(path.join(root, 'docs/authentication.md'), 'Changed source bytes.');
  const current = await view.readSource({ resource: 'authentication-guide' });
  assert.equal(current.text, 'Changed source bytes.');
  assert.notEqual(current.observation.sha256, old.input.sha256);
  assert.equal(view.readDocument('docs/authentication.md').text, old.text);
  assert.equal(view.freshness().status, 'stale');
  assert.match(current.limits.join(' '), /separate current observation/u);
});

test('pending external reads retain the captured selector when the caller changes its target', async (t) => {
  const { view } = setup(t);
  const target = { uri: 'https://example.com/source', selector: 'required-section' };
  let finish;
  const pending = view.readSource(target, {
    reader(request) {
      assert.equal(request.selector, 'required-section');
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  delete target.selector;
  finish({ bytes: new TextEncoder().encode('Unselected full document') });
  const result = await pending;
  assert.equal(result.status, 'unsupported');
  assert.equal(result.target.selector, 'required-section');
  assert.equal(result.bytesBase64, undefined);
});

test('external readers rejecting non-Error values return unreadable observations', async (t) => {
  const { view } = setup(t);
  for (const failure of [null, undefined, 'offline']) {
    const result = await view.readSource({ uri: 'https://example.com/source' }, {
      reader: () => Promise.reject(failure),
    });
    assert.equal(result.status, 'unreadable');
    assert.equal(result.reason, String(failure));
    assert.equal(result.bytesBase64, undefined);
  }
});

test('size limits and unsupported selectors/content never masquerade as a complete excerpt', async (t) => {
  const { root, view } = setup(t);
  const limited = await view.readSource({ resource: 'authentication-guide' }, { maxBytes: 10 });
  assert.equal(limited.status, 'truncated');
  assert.equal(Buffer.from(limited.bytesBase64, 'base64').length, 10);
  assert.equal(limited.observation.complete, false);
  assert.equal(limited.observation.byteLength, 10);
  const selector = await view.readSource({ resource: 'authentication-guide', selector: 'unknown-section' });
  assert.equal(selector.status, 'unsupported');
  assert.equal(selector.target.selector, 'unknown-section');
  assert.equal(selector.text, undefined);
  fs.writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0xff, 0x00, 0x81]));
  const binary = await view.readSource({ uri: 'binary.dat' });
  assert.equal(binary.status, 'unsupported');
  assert.equal(binary.text, undefined);
  assert.equal((await view.readSource({ uri: 'missing.md' })).status, 'missing');
});

test('conflicting local source reads return stale without exposing a successful body', async (t) => {
  const { view } = setup(t);
  const original = fs.fstatSync;
  let calls = 0;
  t.mock.method(fs, 'fstatSync', (fd, options) => {
    const stat = original(fd, options);
    if (++calls === 2) stat.mtimeNs += 1n;
    return stat;
  });
  const result = await view.readSource({ resource: 'authentication-guide' });
  assert.equal(result.status, 'stale');
  assert.equal(result.text, undefined);
});

test('invalid drafts refuse Resource identity resolution while retaining raw repair access', async (t) => {
  const { root } = setup(t);
  fs.writeFileSync(path.join(root, 'atlas.md'), '---\n{"type":\n---\nBroken draft.');
  const view = openAtlas(root);
  assert.equal(view.validation.normalized, undefined);
  assert.equal((await view.readSource({ resource: 'authentication-guide' })).status, 'unavailable');
  assert.match(view.readDocument('atlas.md').text, /Broken draft/u);
});

test('directory replacement cannot attribute bytes from a displaced file to its current path', async (t) => {
  const { root, view } = setup(t);
  const original = fs.readSync;
  let replaced = false;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = original(...args);
    if (!replaced && count > 0) {
      replaced = true;
      fs.renameSync(path.join(root, 'docs'), path.join(root, 'old-docs'));
      fs.mkdirSync(path.join(root, 'docs'));
      fs.writeFileSync(path.join(root, 'docs/authentication.md'), 'Replacement source.');
    }
    return count;
  });
  const result = await view.readSource({ resource: 'authentication-guide' });
  assert.equal(result.status, 'stale');
  assert.equal(result.text, undefined);
  assert.equal(result.bytesBase64, undefined);
});
