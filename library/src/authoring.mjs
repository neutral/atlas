import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { openAtlas, validateFiles, readSource } from './model.mjs';
import { resolveState } from './state.mjs';

const STATE = '.atlas-state';
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const own = (value, key) => Object.hasOwn(value, key);
const fields = (value, allowed, required = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) {
    throw fail('INVALID_REQUEST', 'Unexpected or missing fields.');
  }
};

function relativePath(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\\\x00-\x1f]/u.test(value) ||
      path.posix.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..') ||
      value.normalize('NFC') !== value || value.split('/').some(p => p.startsWith('.atlas-'))) {
    throw fail('UNSAFE_PATH', 'A change needs a normalized relative record path.');
  }
  return value;
}

function rootsFrom(files) {
  try {
    const value = JSON.parse(files.get('atlas.json'));
    return Array.isArray(value.trees) ? value.trees.filter(v => typeof v === 'string') : [];
  } catch { return []; }
}

function recordPath(value, roots) {
  relativePath(value);
  return value === 'atlas.json' || /^\.checks\/.+\.md$/u.test(value) || roots.some(root =>
    value === `${root}/tree.json` ||
    (value.startsWith(`${root}/points/`) || value.startsWith(`${root}/facets/`)) && value.endsWith('.md'));
}

function captureMap(view) {
  if (!view || !Array.isArray(view.files) || !nonblank(view.identity)) throw fail('INVALID_VIEW', 'A captured view is required.');
  return new Map(view.files.map(file => [file.path, capturedContent(file)]));
}

const capturedContent = file => file.rawBase64 === undefined ? file.content : { rawBase64: file.rawBase64 };
function rawBytes(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_STATE_BYTES / 3) * 4) throw fail('INVALID_PLAN', 'Invalid raw original bytes.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw fail('INVALID_PLAN', 'Raw original bytes require canonical base64.');
  return bytes;
}
const beforeBytes = change => change.beforeBase64 === undefined ? change.before === null ? null : Buffer.from(change.before, 'utf8') : rawBytes(change.beforeBase64);
const afterBytes = change => change.after === null ? null : Buffer.from(change.after, 'utf8');
const sameBytes = (left, right) => left === null || right === null ? left === right : left.equals(right);
const contentBytes = value => value === null ? null : typeof value === 'string' ? Buffer.from(value, 'utf8') : rawBytes(value.rawBase64);

/** Prepare a complete candidate. No filesystem writes occur. */
export function prepareChange(view, request) {
  fields(request, ['changes', 'reason', 'sourcePreconditions'], ['changes', 'reason']);
  if (!Array.isArray(request.changes) || request.changes.length > 1000 || !nonblank(request.reason)) {
    throw fail('INVALID_REQUEST', 'Provide a reason and at most 1000 file changes.');
  }
  const original = captureMap(view);
  const candidateFiles = new Map(original);
  const seen = new Set();
  const changes = [];
  for (const change of request.changes) {
    fields(change, ['path', 'content'], ['path', 'content']);
    relativePath(change.path);
    if (seen.has(change.path) || !(change.content === null || typeof change.content === 'string')) {
      throw fail('INVALID_REQUEST', 'Change paths must be unique; content must be text or null.');
    }
    seen.add(change.path);
    if (change.content !== null && Buffer.byteLength(change.content) > 4 * 1024 * 1024) {
      throw fail('LIMIT_EXCEEDED', 'A changed file exceeds 4 MiB.');
    }
    const originalContent = original.get(change.path) ?? null;
    const before = typeof originalContent === 'object' && originalContent !== null ? null : originalContent;
    if (change.content === null) candidateFiles.delete(change.path);
    else candidateFiles.set(change.path, change.content);
    if (originalContent !== change.content) changes.push({ path: change.path, before, ...(originalContent && typeof originalContent === 'object' ? { beforeBase64: originalContent.rawBase64 } : {}), after: change.content });
  }
  const roots = [...rootsFrom(original), ...rootsFrom(candidateFiles)];
  for (const change of changes) {
    if (!recordPath(change.path, roots)) throw fail('UNSAFE_PATH', `Not an authored record: ${change.path}`);
  }
  const sourcePreconditions = structuredClone(request.sourcePreconditions ?? []);
  if (!Array.isArray(sourcePreconditions) || sourcePreconditions.length > 100) throw fail('INVALID_REQUEST', 'Too many source preconditions.');
  for (const source of sourcePreconditions) {
    fields(source, ['uri', 'sha256'], ['uri', 'sha256']);
    if (!nonblank(source.uri) || !/^[a-f0-9]{64}$/u.test(source.sha256)) throw fail('INVALID_REQUEST', 'Invalid source precondition.');
  }
  const candidate = validateFiles(candidateFiles, { root: view.root });
  return {
    format: 'atlas.change/1',
    status: candidate.status !== 'ready' ? 'invalid' : changes.length ? 'ready' : 'noop',
    reason: request.reason,
    baseline: { identity: view.identity, files: view.files.map(({ path, sha256 }) => ({ path, sha256 })) },
    changes,
    validation: { status: candidate.status, identity: candidate.identity, diagnostics: candidate.diagnostics },
    sourcePreconditions,
    observedFiles: [],
    candidate,
  };
}

/** Discover existing records named by a proposed manifest without rebasing the draft. */
export async function prepareChangeFromDisk(root, request, { view, observedFiles = [] } = {}) {
  root = await checkedRoot(root);
  view ??= await openAtlas(root);
  if (await fs.realpath(view.root) !== root) throw fail('INVALID_VIEW', 'The captured view belongs to another Atlas.');
  const originalBaseline = { identity: view.identity, files: view.files.map(({ path, sha256 }) => ({ path, sha256 })) };
  planChanges({ format: 'atlas.change/1', baseline: originalBaseline, changes: [], observedFiles });
  const combined = captureMap(view);
  for (const file of observedFiles) {
    if (combined.has(file.path)) throw fail('INVALID_PLAN', 'Observed files must be outside the original captured scope.');
    combined.set(file.path, capturedContent(file));
  }
  const preliminary = prepareChange(validateFiles(combined, { root }), request);
  preliminary.baseline = originalBaseline;
  preliminary.observedFiles = observedFiles;
  const manifest = request.changes.find(change => change.path === 'atlas.json');
  if (!manifest || manifest.content === null) return preliminary;
  for (const file of observedFiles) if (!sameBytes(await bytesAt(root, file.path), contentBytes(capturedContent(file)))) throw fail('STALE', `Observed record changed: ${file.path}`);
  const proposed = await openAtlas(root, { overrides: new Map([['atlas.json', manifest.content]]) });
  if (proposed.status === 'incomplete') throw fail('INCOMPLETE', 'Cannot inspect the proposed manifest scope completely.');
  const current = await openAtlas(root);
  if (current.status === 'incomplete' || current.identity !== view.identity) throw fail('STALE', 'Atlas changed during preparation.');
  const discovered = proposed.files.filter(file => file.path !== 'atlas.json' && !combined.has(file.path));
  if (!discovered.length) return preliminary;
  const extended = validateFiles(new Map([...combined, ...discovered.map(file => [file.path, capturedContent(file)])]), { root });
  const plan = prepareChange(extended, request);
  plan.baseline = preliminary.baseline;
  plan.observedFiles = [...observedFiles, ...discovered.map(({ path, content, rawBase64, sha256 }) => ({ path, content, ...(rawBase64 === undefined ? {} : { rawBase64 }), sha256 }))];
  return plan;
}

/** Empty Atlas initialization uses the same review/apply path as other changes. */
export function prepareInitialization(view, { id, title }) {
  if (view.files.some(file => file.path === 'atlas.json')) throw fail('ALREADY_EXISTS', 'An Atlas manifest already exists.');
  return prepareChange(view, {
    reason: 'Initialize Atlas',
    changes: [{ path: 'atlas.json', content: `${JSON.stringify({ format: 'atlas/1', id, title, trees: [] }, null, 2)}\n` }],
  });
}

async function checkedRoot(root) {
  const absolute = path.resolve(root);
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_PATH', 'Atlas root must be a directory, not a symlink.');
  return fs.realpath(absolute);
}

async function safePath(root, relative, { internal = false, createState = false } = {}) {
  if (!internal) relativePath(relative);
  else if (!relative.startsWith(`${STATE}/`) || relative.split('/').some(p => !p || p === '..' || p === '.')) throw fail('UNSAFE_PATH', 'Invalid state path.');
  if (internal) {
    root = (await resolveState(root, { create: createState })).directory;
    relative = relative.slice(STATE.length + 1);
  }
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || i < parts.length - 1 && !stat.isDirectory()) throw fail('UNSAFE_PATH', `Unsafe path: ${relative}`);
      if (i === parts.length - 1 && !stat.isFile() && !stat.isDirectory()) throw fail('UNSAFE_PATH', `Not a regular path: ${relative}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(root, relative, content, { internal = false } = {}) {
  const target = await safePath(root, relative, { internal, createState: internal });
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  await safePath(root, relative, { internal });
  if (content === null) {
    await fs.unlink(target);
    await syncDirectory(parent);
    return;
  }
  const temporary = path.join(parent, `.atlas-write-${randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await safePath(root, relative, { internal });
    await fs.rename(temporary, target);
    await syncDirectory(parent);
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function bytesAt(root, relative, internal = false) {
  const target = await safePath(root, relative, { internal });
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_STATE_BYTES) throw fail('LIMIT_EXCEEDED', 'File is not a bounded regular file.');
    return await fs.readFile(target);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function contentAt(root, relative, internal = false) {
  return (await bytesAt(root, relative, internal))?.toString('utf8') ?? null;
}

const transactionPath = id => `${STATE}/transactions/${stateId(id)}.json`;
const draftPath = id => `${STATE}/drafts/${stateId(id)}.json`;
function stateId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(id)) throw fail('INVALID_REQUEST', 'Invalid state identity.');
  return id;
}
async function saveState(root, relative, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) throw fail('LIMIT_EXCEEDED', 'State exceeds 32 MiB.');
  await atomicWrite(root, relative, bytes, { internal: true });
}
async function readState(root, relative) {
  const value = await contentAt(root, relative, true);
  if (value === null) throw fail('NOT_FOUND', 'Saved state does not exist.');
  try { return JSON.parse(value); } catch { throw fail('INVALID_STATE', 'Saved state is malformed.'); }
}

async function acquire(root, transaction, recover = false) {
  const filename = await safePath(root, `${STATE}/lock.json`, { internal: true, createState: true });
  await fs.mkdir(path.dirname(filename), { recursive: true });
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await readState(root, `${STATE}/lock.json`);
    let alive = true;
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw fail('LOCKED', 'Invalid lock; inspect state before recovery.');
    try { process.kill(previous.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
    let finished = false;
    if (!alive) {
      try {
        const journal = await readState(root, transactionPath(previous.transaction));
        finished = journal.format === 'atlas.transaction/1' && journal.id === previous.transaction && ['complete', 'rolled-back'].includes(journal.phase);
      } catch (error) { if (error.code === 'NOT_FOUND') finished = true; else throw error; }
    }
    if (alive || !finished && (!recover || previous.transaction !== transaction)) {
      throw fail('LOCKED', alive ? 'Another Atlas writer is running.' : `Interrupted transaction ${previous.transaction} needs recovery.`);
    }
    await fs.unlink(filename);
    handle = await fs.open(filename, 'wx', 0o600);
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, transaction }), 'utf8');
    await handle.sync();
    await syncDirectory(path.dirname(filename));
  } finally { await handle.close(); }
  return async () => {
    const current = await readState(root, `${STATE}/lock.json`);
    if (current.transaction !== transaction || current.pid !== process.pid) throw fail('LOCKED', 'Writer lock changed.');
    await fs.unlink(filename);
    await syncDirectory(path.dirname(filename));
  };
}

function planChanges(plan) {
  if (!plan || plan.format !== 'atlas.change/1' || !Array.isArray(plan.changes) || !plan.baseline || !nonblank(plan.baseline.identity)) {
    throw fail('INVALID_PLAN', 'An Atlas change plan is required.');
  }
  for (const change of plan.changes) {
    fields(change, ['path', 'before', 'beforeBase64', 'after'], ['path', 'before', 'after']);
    if (![change.before, change.after].every(v => v === null || typeof v === 'string')) throw fail('INVALID_PLAN', 'Invalid change bytes.');
    if (change.beforeBase64 !== undefined) { if (change.before !== null) throw fail('INVALID_PLAN', 'Raw originals have no decoded before text.'); rawBytes(change.beforeBase64); }
  }
  if (!Array.isArray(plan.observedFiles ?? []) || (plan.observedFiles ?? []).length > 10000) throw fail('INVALID_PLAN', 'Invalid observed file preconditions.');
  const observedPaths = new Set();
  for (const file of plan.observedFiles ?? []) {
    fields(file, ['path', 'content', 'rawBase64', 'sha256'], ['path', 'content', 'sha256']);
    relativePath(file.path);
    if (file.rawBase64 === undefined ? typeof file.content !== 'string' : file.content !== null) throw fail('INVALID_PLAN', 'Invalid observed file content.');
    const bytes = contentBytes(capturedContent(file));
    if (observedPaths.has(file.path) || bytes.length > 2 * 1024 * 1024 || sha(bytes) !== file.sha256) throw fail('INVALID_PLAN', 'Invalid observed file bytes.');
    observedPaths.add(file.path);
  }
  return plan.changes.map(({ path, after }) => ({ path, content: after }));
}

/** Apply revalidates the complete candidate and current baseline before writing. */
export async function applyChange(root, plan, { allowedRoots, onProgress } = {}) {
  plan = structuredClone(plan);
  const changes = planChanges(plan);
  root = await checkedRoot(root);
  const id = randomUUID();
  const release = await acquire(root, id);
  let transaction;
  try {
    const current = await openAtlas(root);
    if (current.status === 'incomplete') throw fail('INCOMPLETE', 'Cannot apply against an incomplete read.');
    if (current.identity !== plan.baseline.identity) throw fail('STALE', 'Atlas changed after preparation.');
    const currentFiles = captureMap(current);
    const checkObserved = async () => {
      for (const file of plan.observedFiles ?? []) {
        if (current.files.some(existing => existing.path === file.path) || !sameBytes(await bytesAt(root, file.path), contentBytes(capturedContent(file)))) throw fail('STALE', `Observed record changed: ${file.path}`);
      }
      const manifest = plan.changes.find(change => change.path === 'atlas.json');
      if (typeof manifest?.after === 'string') {
        const scoped = await openAtlas(root, { overrides: new Map([['atlas.json', manifest.after]]) });
        if (scoped.status === 'incomplete') throw fail('INCOMPLETE', 'Cannot inspect proposed Tree scope before writing.');
        const nativePaths = new Set(current.files.map(file => file.path));
        const expected = new Map((plan.observedFiles ?? []).map(file => [file.path, file.sha256]));
        const extras = scoped.files.filter(file => file.path !== 'atlas.json' && !nativePaths.has(file.path));
        if (extras.length !== expected.size || extras.some(file => expected.get(file.path) !== file.sha256)) throw fail('STALE', 'Proposed Tree scope changed after preparation.');
      }
    };
    await checkObserved();
    for (const file of plan.observedFiles ?? []) currentFiles.set(file.path, capturedContent(file));
    for (const change of plan.changes) {
      if (!sameBytes(contentBytes(currentFiles.get(change.path) ?? null), beforeBytes(change))) throw fail('STALE', `Changed baseline: ${change.path}`);
      await safePath(root, change.path);
      if (!sameBytes(await bytesAt(root, change.path), beforeBytes(change))) throw fail('STALE', `Existing or changed target: ${change.path}`);
    }
    const workingView = validateFiles(currentFiles, { root });
    const prepared = prepareChange(workingView, { changes, reason: plan.reason, sourcePreconditions: plan.sourcePreconditions ?? [] });
    if (prepared.status === 'invalid') throw fail('INVALID_CANDIDATE', 'Candidate Atlas is invalid.');
    const checkSources = async () => {
      for (const source of prepared.sourcePreconditions) {
        const result = await readSource(current, { uri: source.uri }, { allowedRoots, maxBytes: 4 * 1024 * 1024 });
        const content = result.content ?? result.text;
        if (result.status !== 'ready' || result.sha256 !== source.sha256 && (typeof content !== 'string' || sha(content) !== source.sha256)) {
          throw fail('STALE_SOURCE', `Source is unavailable or changed: ${source.uri}`);
        }
      }
    };
    await checkSources();
    if (prepared.status === 'noop') return { format: 'atlas.apply/1', status: 'noop', identity: current.identity, transaction: null };
    transaction = { format: 'atlas.transaction/1', id, phase: 'prepared', createdAt: new Date().toISOString(), baseline: current.identity, result: prepared.candidate.identity, changes: prepared.changes, written: [] };
    await saveState(root, transactionPath(id), transaction);
    await onProgress?.({ transaction: id, phase: 'prepared', written: [] });
    // Catch changes made while preparing durable state, before the first write.
    if ((await openAtlas(root)).identity !== current.identity) throw fail('STALE', 'Atlas changed before application.');
    await checkObserved();
    for (const change of prepared.changes) {
      if (!sameBytes(await bytesAt(root, change.path), beforeBytes(change))) throw fail('STALE', `Changed before apply: ${change.path}`);
    }
    await checkSources();
    transaction.phase = 'applying';
    await saveState(root, transactionPath(id), transaction);
    for (const change of prepared.changes) {
      if (!sameBytes(await bytesAt(root, change.path), beforeBytes(change))) throw fail('STALE', `Changed during apply: ${change.path}`);
      await atomicWrite(root, change.path, change.after);
      transaction.written.push(change.path);
      await saveState(root, transactionPath(id), transaction);
      await onProgress?.({ transaction: id, phase: 'applying', written: [...transaction.written] });
    }
    const result = await openAtlas(root);
    if (result.status !== 'ready' || result.identity !== prepared.candidate.identity) throw fail('CONCURRENT_CHANGE', 'Atlas changed during application; inspect the transaction.');
    transaction.phase = 'complete';
    await saveState(root, transactionPath(id), transaction);
    return { format: 'atlas.apply/1', status: 'complete', identity: result.identity, transaction: id };
  } catch (error) {
    if (transaction) {
      transaction.phase = 'interrupted';
      transaction.error = { code: error.code ?? 'WRITE_FAILED', message: error.message };
      await saveState(root, transactionPath(id), transaction).catch(() => {});
      return { format: 'atlas.apply/1', status: 'interrupted', transaction: id, written: transaction.written, error: transaction.error };
    }
    throw error;
  } finally { await release(); }
}

async function listState(root, directory) {
  root = await checkedRoot(root);
  const folder = await safePath(root, `${STATE}/${directory}`, { internal: true });
  let names;
  try { names = await fs.readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (names.length > 10000) throw fail('LIMIT_EXCEEDED', 'Too many saved records.');
  const values = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    stateId(name.slice(0, -5));
    values.push(await readState(root, `${STATE}/${directory}/${name}`));
  }
  return values;
}

export async function listTransactions(root) {
  return (await listState(root, 'transactions')).map(({ id, phase, createdAt, baseline, result, written, error }) => ({ id, phase, createdAt, baseline, result, written, error }));
}

/** Restore only this transaction's files. Foreign edits are never overwritten. */
export async function recoverChange(root, id) {
  root = await checkedRoot(root);
  stateId(id);
  const release = await acquire(root, id, true);
  try {
    const transaction = await readState(root, transactionPath(id));
    if (transaction.format !== 'atlas.transaction/1' || transaction.id !== id || !Array.isArray(transaction.changes) || transaction.changes.length > 1000) throw fail('INVALID_STATE', 'Invalid transaction journal.');
    if (transaction.phase === 'complete') throw fail('ALREADY_COMPLETE', 'A completed transaction is not an interrupted change.');
    if (transaction.phase === 'rolled-back') return { format: 'atlas.recovery/1', status: 'rolled-back', transaction: id };
    const current = await openAtlas(root);
    const candidate = captureMap(current);
    const knownRoots = rootsFrom(candidate);
    for (const change of transaction.changes) {
      fields(change, ['path', 'before', 'beforeBase64', 'after'], ['path', 'before', 'after']);
      if (![change.before, change.after].every(v => v === null || typeof v === 'string')) throw fail('INVALID_STATE', 'Invalid recovery bytes.');
      if (change.beforeBase64 !== undefined) { if (change.before !== null) throw fail('INVALID_STATE', 'Raw originals have no decoded before text.'); rawBytes(change.beforeBase64); }
      if (change.path === 'atlas.json') {
        if (change.before !== null) knownRoots.push(...rootsFrom(new Map([['atlas.json', change.before]])));
        if (change.after !== null) knownRoots.push(...rootsFrom(new Map([['atlas.json', change.after]])));
      }
    }
    const seen = new Set();
    for (const change of transaction.changes) {
      if (seen.has(change.path) || !recordPath(change.path, knownRoots)) throw fail('INVALID_STATE', 'Unsafe recovery record.');
      seen.add(change.path);
      const content = await bytesAt(root, change.path);
      if (!sameBytes(content, beforeBytes(change)) && !sameBytes(content, afterBytes(change))) throw fail('RECOVERY_CONFLICT', `Foreign edits prevent recovery: ${change.path}`);
    }
    transaction.phase = 'rolling-back';
    await saveState(root, transactionPath(id), transaction);
    for (const change of [...transaction.changes].reverse()) {
      const content = await bytesAt(root, change.path);
      if (sameBytes(content, beforeBytes(change))) continue;
      if (!sameBytes(content, afterBytes(change))) throw fail('RECOVERY_CONFLICT', `Changed during recovery: ${change.path}`);
      await atomicWrite(root, change.path, beforeBytes(change));
    }
    transaction.phase = 'rolled-back';
    await saveState(root, transactionPath(id), transaction);
    const result = await openAtlas(root);
    return { format: 'atlas.recovery/1', status: 'rolled-back', transaction: id, identity: result.identity, baselineRestored: result.identity === transaction.baseline, diagnostics: result.diagnostics };
  } finally { await release(); }
}

function draftRevision(draft) {
  const { revision, ...content } = draft;
  return sha(JSON.stringify(content));
}

function expectedDraftRevision(revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/u.test(revision)) throw fail('STALE_DRAFT', 'The exact reviewed draft revision is required.');
}

async function withDraftLock(root, id, action) {
  root = await checkedRoot(root);
  const relative = `${STATE}/drafts/${stateId(id)}.lock`;
  const filename = await safePath(root, relative, { internal: true, createState: true });
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await safePath(root, relative, { internal: true });
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await readState(root, relative);
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw fail('LOCKED', 'Invalid draft lock; inspect saved state.');
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
    if (alive) throw fail('LOCKED', 'Another writer is using this draft.');
    await fs.unlink(filename);
    handle = await fs.open(filename, 'wx', 0o600);
  }
  const token = randomUUID();
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }), 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  try { return await action(root); }
  finally {
    const current = await readState(root, relative);
    if (current.token !== token || current.pid !== process.pid) throw fail('LOCKED', 'Draft lock changed.');
    await fs.unlink(filename);
    await syncDirectory(path.dirname(filename));
  }
}

export async function saveDraft(root, { id = randomUUID(), plan, expectedRevision }) {
  plan = structuredClone(plan);
  planChanges(plan);
  if (expectedRevision !== undefined) expectedDraftRevision(expectedRevision);
  return withDraftLock(root, id, async canonical => {
    let previous;
    try { previous = await loadDraft(canonical, id); } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    if (previous ? previous.revision !== expectedRevision : expectedRevision !== undefined) throw fail('STALE_DRAFT', 'The saved draft changed or was removed; reload it before saving.');
    if (previous && JSON.stringify(previous.plan.baseline) !== JSON.stringify(plan.baseline)) throw fail('STALE_DRAFT', 'A saved draft must retain its original baseline.');
    const draft = { format: 'atlas.draft/1', id: stateId(id), updatedAt: new Date().toISOString(), plan };
    draft.revision = draftRevision(draft);
    await saveState(canonical, draftPath(id), draft);
    return draft;
  });
}
export async function loadDraft(root, id) {
  root = await checkedRoot(root);
  const draft = await readState(root, draftPath(id));
  if (draft.format !== 'atlas.draft/1' || draft.id !== id) throw fail('INVALID_STATE', 'Invalid draft.');
  if (draft.revision !== draftRevision(draft)) throw fail('INVALID_STATE', 'Saved draft integrity failed.');
  planChanges(draft.plan);
  return draft;
}
export async function listDrafts(root) {
  return (await listState(root, 'drafts')).map(draft => {
    if (draft.format !== 'atlas.draft/1' || draft.revision !== draftRevision(draft)) throw fail('INVALID_STATE', 'Saved draft integrity failed.');
    const { id, revision, updatedAt, plan } = draft;
    return { id, revision, updatedAt, reason: plan?.reason, status: plan?.status, baseline: plan?.baseline?.identity };
  });
}
export async function applyDraft(root, id, { expectedRevision, ...options } = {}) {
  expectedDraftRevision(expectedRevision);
  return withDraftLock(root, id, async canonical => {
    const draft = await loadDraft(canonical, id);
    if (draft.revision !== expectedRevision) throw fail('STALE_DRAFT', 'The draft changed after review; review it again before applying.');
    return applyChange(canonical, draft.plan, options);
  });
}
export async function deleteDraft(root, id, { expectedRevision } = {}) {
  expectedDraftRevision(expectedRevision);
  return withDraftLock(root, id, async canonical => {
    const draft = await loadDraft(canonical, id);
    if (draft.revision !== expectedRevision) throw fail('STALE_DRAFT', 'The draft changed before deletion; reload it first.');
    const filename = await safePath(canonical, draftPath(id), { internal: true });
    await fs.unlink(filename);
    await syncDirectory(path.dirname(filename));
    return { status: 'deleted', id };
  });
}
