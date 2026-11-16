import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { openAtlas, validateFiles } from './model.mjs';
import { parsePlainMarkdown } from './frontmatter.mjs';
import { resolveState, isPrivateStatePath, stateHome } from './state.mjs';
import { getStyle } from './styles.mjs';

const STATE = '.atlas-state';
const STYLE = 'style.md';
/** The one place inside an Atlas where a candidate may lie. Readers never capture it: `.atlas-*` names are reserved. */
const CANDIDATE = '.atlas-candidate';
/** The identity of the Atlas that `.atlas-candidate/` was last written from, kept in the private state. */
const CANDIDATE_RECORD = `${STATE}/candidate.json`;
const MAX_CHANGES = 1000;
/** The format's bound on one authored file: readers capture no larger one. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const own = (value, key) => Object.hasOwn(value, key);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const fields = (value, allowed, required = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) {
    throw fail('INVALID_REQUEST', 'Unexpected or missing fields.');
  }
};

/** A record path as readers accept one (the model's rule), at most 1000 characters. */
function relativePath(value) {
  if (typeof value !== 'string' || value.length > 1000 || !value.isWellFormed() || /[\\\x00-\x1f\x7f:#?]/u.test(value) ||
      path.posix.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..') ||
      value.normalize('NFC') !== value || value.split('/').some(p => p.toLocaleLowerCase('en').startsWith('.atlas-'))) {
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
  return value === 'atlas.json' || value === STYLE || /^\.checks\/.+\.md$/u.test(value) || roots.some(root =>
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

const STYLE_ALONE = Object.freeze({ code: 'STYLE_CHANGE_ALONE', path: STYLE, message: 'A change that alters the Style alters no other file. Prepare the Style change and the other changes separately.' });
/** Whether text is a Style by the rule readers apply: nonblank Markdown without a header, one H1 and its explanation. */
function validStyle(content) {
  if (typeof content !== 'string' || !content.trim()) return false;
  try { parsePlainMarkdown(content); return true; } catch { return false; }
}
/**
 * A valid Style changes alone. Creating an Atlas where none exists writes the manifest and the Style together, and a
 * Style that does not validate may be repaired together with the rest, so a broken Atlas can be made whole in one change.
 */
const styleAlone = (original, changes) => changes.length < 2 || !original.has('atlas.json') || !validStyle(original.get(STYLE)) || !changes.some(change => change.path === STYLE);
/** What a plan says of its candidate: the candidate's own validity, and whether the change may alter the Style with other files. */
function planValidation(candidate, alone) {
  if (alone) return { status: candidate.status, identity: candidate.identity, diagnostics: candidate.diagnostics };
  return { status: candidate.status === 'ready' ? 'invalid' : candidate.status, identity: candidate.identity,
    diagnostics: [...candidate.diagnostics, STYLE_ALONE].sort((a, b) => compare(a.path, b.path) || compare(a.code, b.code) || compare(a.message, b.message)) };
}

const unreadBack = (names, diagnostics) => Object.assign(fail('INVALID_REQUEST', `The change writes what a reader would not read back: ${names.slice(0, 20).join(', ')}${names.length > 20 ? `, and ${names.length - 20} more` : ''}.`), { diagnostics });
/**
 * A plan holds only a candidate that readers read back as the change writes it: every written file captured whole, and
 * none left out for a bound the candidate exceeds. Otherwise the change is refused with the reader's own diagnostics.
 * A file and a directory cannot share a path, so a change is refused, by both paths, when a path it writes or the
 * Atlas holds lies beneath a file another of them names.
 */
function readBack(candidate, changes, original) {
  const captured = new Set(candidate.files.map(file => file.path));
  const written = changes.filter(change => change.after !== null).map(change => change.path);
  const paths = new Set([...original.keys(), ...captured, ...written]);
  const conflicts = new Set();
  for (const file of paths) {
    const parts = file.split('/');
    for (let length = 1; length < parts.length; length++) {
      const parent = parts.slice(0, length).join('/');
      if (paths.has(parent)) conflicts.add(parent).add(file);
    }
  }
  if (conflicts.size) throw unreadBack([...conflicts].sort(compare), []);
  const dropped = new Set(written.filter(file => !captured.has(file)));
  if (!dropped.size && candidate.status !== 'incomplete') return;
  const diagnostics = candidate.diagnostics.filter(item => dropped.has(item.path) || item.code === 'READ_LIMIT');
  const names = diagnostics.length ? diagnostics.map(item => `${item.path || item.message.replace(/\.$/u, '')} (${item.code})`) : [...dropped];
  throw unreadBack(names, diagnostics);
}

/** Prepare a complete candidate. No filesystem writes occur. */
export function prepareChange(view, request) {
  fields(request, ['changes', 'reason'], ['changes', 'reason']);
  if (!Array.isArray(request.changes) || request.changes.length > MAX_CHANGES || !nonblank(request.reason)) {
    throw fail('INVALID_REQUEST', `Provide a reason and at most ${MAX_CHANGES} file changes.`);
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
    if (change.content !== null && Buffer.byteLength(change.content) > MAX_FILE_BYTES) {
      throw fail('LIMIT_EXCEEDED', `A changed file exceeds 2 MiB (${MAX_FILE_BYTES} bytes).`);
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
  const candidate = validateFiles(candidateFiles, { root: view.root });
  readBack(candidate, changes, original);
  const validation = planValidation(candidate, styleAlone(original, changes));
  return {
    format: 'atlas.change/1',
    status: validation.status !== 'ready' ? 'invalid' : changes.length ? 'ready' : 'noop',
    reason: request.reason,
    baseline: { identity: view.identity, files: view.files.map(({ path, sha256 }) => ({ path, sha256 })) },
    changes,
    validation,
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

/** Readers take every file in these folders for a record: a declared Tree's points/ and facets/, and .checks/. */
const recordFolder = (file, roots) => file.startsWith('.checks/') || roots.some(root => file.startsWith(`${root}/points/`) || file.startsWith(`${root}/facets/`));

/**
 * Sort the entries of a candidate directory without reading file content. Symbolic links, entries
 * that are neither files nor directories, and files in a record folder that no record path admits
 * are refused by name. Any other file that is not a record is left out of the change.
 */
async function candidateEntries(directory, roots) {
  const refused = [], leftOut = [];
  let visited = 0;
  async function walk(relative, depth) {
    if (depth > 64) throw fail('LIMIT_EXCEEDED', 'The candidate directory is nested deeper than 64 levels.');
    const entries = [];
    for await (const entry of await fs.opendir(path.join(directory, relative))) {
      if (++visited > 40000) throw fail('LIMIT_EXCEEDED', 'The candidate directory holds more than 40000 entries.');
      entries.push(entry);
    }
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) refused.push({ code: 'PATH_SYMLINK', path: file, message: 'A candidate holds no symbolic links.' });
      else if (entry.isDirectory()) await walk(file, depth + 1);
      else if (!entry.isFile()) refused.push({ code: 'FILE_KIND', path: file, message: 'A candidate holds regular files only.' });
      else if (!entry.name.startsWith('.atlas-write-')) {
        let record = false, unsafe = false;
        try { record = recordPath(file, roots); } catch { unsafe = true; }
        if (record) continue;
        if (!recordFolder(file, roots)) leftOut.push(file);
        else if (unsafe) refused.push({ code: 'PATH_UNSAFE', path: file, message: 'Authored paths must be NFC normalized relative paths without control characters, \\, :, #, ? or reserved .atlas-* components.' });
        else refused.push({ code: 'RECORD_UNEXPECTED', path: file, message: 'This file is outside the authored record paths the candidate manifest declares.' });
      }
    }
  }
  await walk('', 0);
  return { refused, leftOut };
}

async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Whether the Atlas holds, at the same path and behind no symbolic link, a regular file with the bytes
 * of this candidate file. A file that cannot be read on either side is not known to be the same.
 */
async function heldByAtlas(root, candidate, file) {
  const parts = file.split('/');
  try {
    let target = root, stat;
    for (const part of parts) {
      stat = await fs.lstat(target = path.join(target, part));
      if (stat.isSymbolicLink()) return false;
    }
    const copy = path.join(candidate, ...parts);
    return stat.isFile() && stat.size === (await fs.stat(copy)).size && await fileDigest(target) === await fileDigest(copy);
  } catch (error) { if (typeof error?.code === 'string') return false; throw error; }
}

/**
 * Prepare the change from the current Atlas to a complete candidate directory. No filesystem writes occur.
 * Files of the candidate that are not records are no part of the change. The plan's `ignored` names
 * each one that the Atlas does not hold with the same bytes, so that none is dropped unseen.
 */
export async function prepareFromCandidate(root, candidateDirectory, { reason } = {}) {
  root = await checkedRoot(root);
  if (!nonblank(reason)) throw fail('INVALID_REQUEST', 'Provide a reason for the change.');
  let candidate;
  try {
    const absolute = path.resolve(candidateDirectory), stat = await fs.lstat(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) candidate = await fs.realpath(absolute);
  } catch (error) { if (!['ENOENT', 'ENOTDIR', 'ERR_INVALID_ARG_TYPE'].includes(error.code)) throw error; }
  if (!candidate) throw fail('UNSAFE_PATH', 'The candidate must be an existing directory, not a symbolic link.');
  if (candidate !== path.join(root, CANDIDATE) && (inside(root, candidate) || inside(candidate, root))) throw fail('UNSAFE_PATH', `The candidate directory and the Atlas must lie outside one another; inside the Atlas a candidate lies in ${CANDIDATE} at its root.`);
  if (await isPrivateStatePath(candidate)) throw fail('UNSAFE_PATH', 'The candidate directory must lie outside private Atlas state.');
  // A copy of an earlier Atlas would undo, as its change, whatever was applied since it was written. The folder is the one
  // writeCandidate writes, so a copy that no record names the Atlas of cannot be shown to be fresh. The record and the
  // Atlas are read before the folder is and again after, so that a later Atlas and a fresh copy of it, written while the
  // folder was read, are not taken for the Atlas the copy read was made from.
  const own = candidate === path.join(root, CANDIDATE);
  const earlier = own ? { record: await candidateRecord(root), atlas: await openAtlas(root) } : null;
  const proposed = await openAtlas(candidate);
  const manifest = proposed.files.find(file => file.path === 'atlas.json');
  if (typeof manifest?.content !== 'string') throw fail('INVALID_REQUEST', 'A candidate directory holds the whole proposed Atlas, with atlas.json as a regular UTF-8 file at its top.');
  const { refused, leftOut } = await candidateEntries(candidate, rootsFrom(new Map([['atlas.json', manifest.content]])));
  // A reader passes over a name it does not accept in a record folder, so a record under that name would be dropped unseen.
  for (const item of proposed.diagnostics) {
    if (item.code === 'PATH_UNSAFE' && !refused.some(other => other.path === item.path || other.path.startsWith(`${item.path}/`))) refused.push(item);
  }
  if (refused.length) {
    const names = refused.slice(0, 20).map(item => `${item.path} (${item.code})`).join(', ');
    throw Object.assign(fail('UNSAFE_PATH', `The candidate directory holds ${refused.length === 1 ? 'a path' : `${refused.length} paths`} an Atlas cannot hold: ${names}${refused.length > 20 ? `, and ${refused.length - 20} more` : ''}.`), { diagnostics: refused });
  }
  if (proposed.status === 'incomplete') throw Object.assign(fail('INCOMPLETE', 'Cannot read the candidate directory completely.'), { diagnostics: proposed.diagnostics });
  const binary = proposed.files.filter(file => file.content === null);
  if (binary.length) throw Object.assign(fail('INVALID_CANDIDATE', `Candidate records must be valid UTF-8 text: ${binary.slice(0, 20).map(file => file.path).join(', ')}.`), { diagnostics: proposed.diagnostics.filter(item => item.code === 'FILE_UTF8') });
  const current = await openAtlas(root);
  if (current.status === 'incomplete' || earlier?.atlas.status === 'incomplete') throw fail('INCOMPLETE', 'Cannot read the current Atlas completely.');
  if (own) {
    const record = await candidateRecord(root);
    if (typeof earlier.record?.baseline !== 'string' || typeof record?.baseline !== 'string') throw fail('STALE', 'No record says which Atlas this copy was made from; run candidate again.');
    if (record.baseline !== current.identity || earlier.atlas.identity !== current.identity || record.baseline !== earlier.record.baseline || record.copy !== earlier.record.copy) {
      throw fail('STALE', 'The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.');
    }
  }
  let observedFiles = [];
  if (manifest.content !== current.files.find(file => file.path === 'atlas.json')?.content) {
    const scoped = await openAtlas(root, { overrides: new Map([['atlas.json', manifest.content]]) });
    if (scoped.status === 'incomplete') throw fail('INCOMPLETE', 'Cannot inspect the proposed manifest scope completely.');
    const captured = new Set(current.files.map(file => file.path));
    observedFiles = scoped.files.filter(file => file.path !== 'atlas.json' && !captured.has(file.path))
      .map(({ path, content, rawBase64, sha256 }) => ({ path, content, ...(rawBase64 === undefined ? {} : { rawBase64 }), sha256 }));
  }
  const existing = new Map([...current.files, ...observedFiles].map(file => [file.path, file.content]));
  const wanted = new Map(proposed.files.map(file => [file.path, file.content]));
  const changes = [];
  for (const file of [...new Set([...existing.keys(), ...wanted.keys()])].sort(compare)) {
    // A raw original has null content here and never equals proposed text or a removal.
    if (!wanted.has(file)) changes.push({ path: file, content: null });
    else if (existing.get(file) !== wanted.get(file)) changes.push({ path: file, content: wanted.get(file) });
  }
  if (changes.length > MAX_CHANGES) throw fail('LIMIT_EXCEEDED', `The candidate differs from the Atlas in more than ${MAX_CHANGES} files.`);
  const plan = await prepareChangeFromDisk(root, { changes, reason }, { view: current, observedFiles });
  if (plan.candidate.identity !== proposed.identity) throw fail('INVALID_CANDIDATE', 'The prepared candidate differs from the candidate directory.');
  const ignored = [];
  for (const file of leftOut) if (!await heldByAtlas(root, candidate, file)) ignored.push(file);
  return { ...plan, ignored: ignored.sort(compare) };
}

/** Symbolic links anywhere under a directory, by path relative to the Atlas root, within the bounds a candidate has. */
async function linksUnder(root, relative) {
  const links = [];
  let visited = 0;
  async function walk(directory, depth) {
    if (depth > 64) throw fail('LIMIT_EXCEEDED', `${relative} is nested deeper than 64 levels.`);
    const entries = [];
    for await (const entry of await fs.opendir(path.join(root, directory))) {
      if (++visited > 40000) throw fail('LIMIT_EXCEEDED', `${relative} holds more than 40000 entries.`);
      entries.push(entry);
    }
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const file = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) links.push({ code: 'PATH_SYMLINK', path: file, message: 'The candidate folder holds no symbolic links.' });
      else if (entry.isDirectory()) await walk(file, depth + 1);
    }
  }
  await walk(relative, 0);
  return links;
}

/**
 * Write a fresh copy of the Atlas's records into `.atlas-candidate/` at its root, as their exact bytes, replacing what the
 * folder held: the manifest, style.md, each declared Tree's tree.json, points/ and facets/, and .checks/, as readers capture
 * them. An invalid Atlas is copied too, so that it can be repaired from the copy. Besides the folder it writes only the
 * identity of the Atlas it copied, into the private state, where preparing from the folder finds it; `baseline` is that
 * identity. It refuses when the folder is not a directory or holds a symbolic link, before it removes anything. It holds
 * the Atlas's writer lock throughout.
 */
export async function writeCandidate(root) {
  root = await checkedRoot(root);
  // The Atlas's writer lock is held throughout, so no apply and no other candidate runs meanwhile: the folder, its record
  // and the Atlas they name are one Atlas. A candidate that meets a running writer is refused LOCKED, as an apply is.
  const lock = await acquire(root, randomUUID());
  try {
    const target = path.join(root, CANDIDATE);
    let present = false;
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('UNSAFE_PATH', `${CANDIDATE} must be a directory, not a symbolic link or a file.`);
      present = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) {
      const links = await linksUnder(root, CANDIDATE);
      if (links.length) throw Object.assign(fail('UNSAFE_PATH', `${CANDIDATE} holds ${links.length === 1 ? 'a symbolic link' : `${links.length} symbolic links`}: ${links.slice(0, 20).map(item => item.path).join(', ')}${links.length > 20 ? `, and ${links.length - 20} more` : ''}.`), { diagnostics: links });
    }
    let home = stateHome();
    try { home = await fs.realpath(home); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    if (await isPrivateStatePath(target) || inside(target, path.resolve(home))) throw fail('UNSAFE_PATH', `${CANDIDATE} and private Atlas state must lie outside one another.`);
    const view = await openAtlas(root);
    if (view.status === 'incomplete') throw Object.assign(fail('INCOMPLETE', 'Cannot read the Atlas completely, so a copy would leave records out.'), { diagnostics: view.diagnostics.slice(0, 100) });
    if (!view.files.some(file => file.path === 'atlas.json')) throw fail('NOT_FOUND', 'There is no atlas.json here to copy. Initialize the Atlas first.');
    // The private state must take the record before anything in the folder is removed: a record that names no Atlas
    // replaces the record of an earlier copy first, so a copy left partial names none.
    await lock.held();
    await saveState(root, CANDIDATE_RECORD, { format: 'atlas.candidate-copy/1', baseline: null, copy: randomUUID() });
    await lock.held();
    if (present) await fs.rm(target, { recursive: true });
    // Exclusive creation: a folder or file that reappears meanwhile is refused, never written through.
    await fs.mkdir(target);
    for (const file of view.files) {
      const destination = path.join(target, ...file.path.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, contentBytes(capturedContent(file)), { flag: 'wx' });
    }
    // Recorded once the copy is whole, with a mark of its own, so that one copy is never taken for another of the same Atlas.
    await lock.held();
    await saveState(root, CANDIDATE_RECORD, { format: 'atlas.candidate-copy/1', baseline: view.identity, copy: randomUUID() });
    return { path: target, files: view.files.length, baseline: view.identity };
  } finally { await lock.release(); }
}

const IDENTITY = /^[a-f0-9]{64}$/u;
/**
 * The record of the copy `.atlas-candidate/` last received: `baseline` is the identity of the Atlas copied, or null while
 * a copy is being written, and `copy` marks that one copy. Null when there is no record.
 */
async function candidateRecord(root) {
  let record;
  try { record = await readState(root, CANDIDATE_RECORD); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !['format', 'baseline', 'copy'].includes(key)) ||
      record.format !== 'atlas.candidate-copy/1' || !(record.baseline === null || typeof record.baseline === 'string' && IDENTITY.test(record.baseline)) ||
      !(record.copy === undefined || typeof record.copy === 'string' && ID.test(record.copy))) throw fail('INVALID_STATE', 'Invalid candidate record.');
  return record;
}

/** The caller chooses the Style; nothing here chooses one for them. */
function selectedStyle({ styleId, styleContent }) {
  if ((styleId === undefined) === (styleContent === undefined)) throw fail('INVALID_REQUEST', 'Choose one curated Style by its ID, or supply one complete custom Style.');
  if (styleContent !== undefined) {
    if (!nonblank(styleContent)) throw fail('INVALID_REQUEST', 'Custom Style must contain its complete definition.');
    return styleContent;
  }
  const style = getStyle(styleId);
  if (!style) throw fail('INVALID_REQUEST', 'Unknown curated Style.');
  return style.content;
}

/** Empty Atlas initialization uses the same review/apply path as other changes. */
export function prepareInitialization(view, { id, title, styleId, styleContent }) {
  if (view.files.some(file => file.path === 'atlas.json')) throw fail('ALREADY_EXISTS', 'An Atlas manifest already exists.');
  return prepareChange(view, {
    reason: 'Initialize Atlas with its selected Style',
    changes: [{ path: 'atlas.json', content: `${JSON.stringify({ format: 'atlas/1.2', id, title, trees: [] }, null, 2)}\n` },
      { path: STYLE, content: selectedStyle({ styleId, styleContent }) }],
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

const transactionPath = id => `${STATE}/transactions/${stateId(id)}.json`;
const draftPath = id => `${STATE}/drafts/${stateId(id)}.json`;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/u;
function stateId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw fail('INVALID_REQUEST', 'Invalid state identity.');
  return id;
}
async function saveState(root, relative, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) throw fail('LIMIT_EXCEEDED', 'State exceeds 32 MiB.');
  await atomicWrite(root, relative, bytes, { internal: true });
}
/** Remove one saved file of the private state; one that is not there is already removed. */
async function removeState(root, relative) {
  const filename = await safePath(root, relative, { internal: true });
  try { await fs.unlink(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await syncDirectory(path.dirname(filename));
}
async function readState(root, relative) {
  const bytes = await bytesAt(root, relative, true);
  if (bytes === null) throw fail('NOT_FOUND', 'Saved state does not exist.');
  // Decoded strictly: bytes that are not UTF-8 are malformed state, not text with replacement characters.
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { throw fail('INVALID_STATE', 'Saved state is malformed.'); }
}

async function readContendedLock(root, relative) {
  let value;
  try { value = await readState(root, relative); }
  catch (error) {
    // Exclusive creation precedes metadata writing; release can also win this
    // read. Neither observation permits removing or taking over the lock.
    if (['INVALID_STATE', 'NOT_FOUND'].includes(error.code)) throw fail('LOCKED', 'Lock metadata is unavailable; another writer may be acquiring or releasing it.');
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('LOCKED', 'Invalid lock metadata; inspect saved state.');
  return value;
}

const PHASES = ['prepared', 'applying', 'interrupted', 'complete', 'rolling-back', 'rolled-back'];
const FINISHED = ['complete', 'rolled-back'];
const plainObject = (value, allowed, required) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => allowed.includes(key)) && required.every(key => own(value, key));
/** A change a journal records: a record path, its before and after text or null, and canonical raw original bytes. */
function journalChange(change) {
  if (!plainObject(change, ['path', 'before', 'beforeBase64', 'after'], ['path', 'before', 'after']) ||
      ![change.before, change.after].every(value => value === null || typeof value === 'string')) return false;
  try { relativePath(change.path); if (change.beforeBase64 !== undefined && (change.before !== null || !rawBytes(change.beforeBase64))) return false; }
  catch { return false; }
  return true;
}
/**
 * A journal is one whose file names it, in a phase a transaction has, that records the identities it went between, the
 * changes it makes once each, the paths it wrote among them, and the failure that interrupted it.
 */
function checkedJournal(journal, id) {
  const paths = new Set(Array.isArray(journal?.changes) ? journal.changes.map(change => change?.path) : []);
  if (!plainObject(journal, ['format', 'id', 'phase', 'createdAt', 'baseline', 'result', 'changes', 'written', 'error'], ['format', 'id', 'phase', 'createdAt', 'baseline', 'result', 'changes', 'written']) ||
      journal.format !== 'atlas.transaction/1' || journal.id !== id || !PHASES.includes(journal.phase) || !nonblank(journal.createdAt) ||
      ![journal.baseline, journal.result].every(value => typeof value === 'string' && IDENTITY.test(value)) ||
      !Array.isArray(journal.changes) || journal.changes.length > MAX_CHANGES || !journal.changes.every(journalChange) || paths.size !== journal.changes.length ||
      !Array.isArray(journal.written) || new Set(journal.written).size !== journal.written.length || !journal.written.every(file => paths.has(file)) ||
      journal.error !== undefined && !(plainObject(journal.error, ['code', 'message'], ['code', 'message']) && typeof journal.error.code === 'string' && typeof journal.error.message === 'string')) {
    throw fail('INVALID_STATE', 'Invalid transaction journal.');
  }
  return journal;
}
/** Whether a journal records a transaction that finished: complete, or rolled back by recovery. */
const finishedJournal = (journal, id) => journal?.format === 'atlas.transaction/1' && journal.id === id && FINISHED.includes(journal.phase);

/**
 * What stops the next apply, or null: an Atlas takes no new apply while a transaction of its own has not finished.
 * Recovery puts back what that transaction found, so it would undo a later apply of the same change and refuse to
 * recover after any other. A journal that cannot be read is not known to have finished; a file no transaction identity
 * names is no journal recovery can take, and stops nothing. Nor does an Atlas take an apply while `view`, its current
 * read, is incomplete. A failure of the private state as a whole is thrown.
 */
async function blockerAt(root, view) {
  let names;
  try { names = await stateNames(root, 'transactions'); }
  catch (error) { if (typeof error?.code !== 'string' || STATE_WIDE.includes(error.code)) throw error; return { code: error.code, message: error.message }; }
  for (const name of names) {
    const id = name.slice(0, -5);
    if (!ID.test(id)) continue;
    let journal;
    try { journal = await readState(root, transactionPath(id)); }
    catch (error) {
      if (error?.code === 'NOT_FOUND') continue;
      if (typeof error?.code !== 'string' || STATE_WIDE.includes(error.code)) throw error;
      return { code: error.code, message: `Transaction journal ${id} cannot be read: ${error.message}`, transaction: id };
    }
    try { checkedJournal(journal, id); } catch { return { code: 'INVALID_STATE', message: `Invalid transaction journal: ${id}.`, transaction: id }; }
    if (!FINISHED.includes(journal.phase)) return { code: 'LOCKED', message: `Interrupted transaction ${id} needs recovery.`, transaction: id };
  }
  if (view.status === 'incomplete') return { code: 'INCOMPLETE', message: 'Cannot apply against an incomplete read.' };
  return null;
}

/**
 * The refusal the next apply of any draft gives for the Atlas's transactions and for the Atlas as it reads now, as
 * `{ code, message, transaction? }`, or null.
 */
export async function applyBlocker(root) {
  root = await checkedRoot(root);
  return blockerAt(root, await openAtlas(root));
}

/**
 * Create a lock whole: its metadata is written to a file beside it and linked into place, which fails when a lock is
 * there. A process that stops at any point leaves no lock or a complete one, never a lock without its metadata. Once
 * linked the lock is the caller's, and a failure after that removes it before it is thrown.
 */
async function createLock(filename, metadata) {
  const temporary = path.join(path.dirname(filename), `.atlas-write-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(metadata), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.link(temporary, filename);
  } finally { await fs.unlink(temporary).catch(() => {}); }
  try { await syncDirectory(path.dirname(filename)); }
  catch (error) { await fs.unlink(filename).catch(() => {}); throw error; }
}

/**
 * A lock this process holds: `held` refuses LOCKED (`changed`) unless the lock there is still this one, and every holder
 * asks it before it destroys anything; `release` asks it, then removes the lock.
 */
function heldLock(root, relative, filename, metadata, changed) {
  const held = async () => {
    let current;
    try { current = await readState(root, relative); }
    catch (error) { if (['NOT_FOUND', 'INVALID_STATE'].includes(error.code)) throw fail('LOCKED', changed); throw error; }
    if (JSON.stringify(current) !== JSON.stringify(metadata)) throw fail('LOCKED', changed);
  };
  return { held, release: async () => { await held(); await fs.unlink(filename); await syncDirectory(path.dirname(filename)); } };
}

/**
 * Take a lock: create it whole or, once `stopped` has found its holder stopped, take it over. The stopped holder's lock is
 * claimed by renaming it aside, which only one contender can do; the claim is removed only when it is still the lock
 * found stopped. A live writer's lock claimed in its place is put back, and the claim refused LOCKED (`running`).
 */
async function takeLock(root, relative, metadata, { stopped, running, changed }) {
  const filename = await safePath(root, relative, { internal: true, createState: true });
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await safePath(root, relative, { internal: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await createLock(filename, metadata); return heldLock(root, relative, filename, metadata, changed); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const previous = await readContendedLock(root, relative);
    await stopped(previous);
    const claimed = path.join(path.dirname(filename), `.atlas-write-${randomUUID()}`);
    try { await fs.rename(filename, claimed); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    let found = null;
    try { found = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(claimed))); } catch { /* Not the lock found stopped. */ }
    if (JSON.stringify(found) === JSON.stringify(previous)) { await fs.unlink(claimed); continue; }
    await fs.link(claimed, filename).catch(() => {});
    await fs.unlink(claimed).catch(() => {});
    throw fail('LOCKED', running);
  }
  throw fail('LOCKED', running);
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (probe) { return probe.code !== 'ESRCH'; } };

/** The Atlas writer lock, taken over from a writer that stopped once its transaction finished, or by recovery of it. */
async function acquire(root, transaction, recover = false) {
  return takeLock(root, `${STATE}/lock.json`, { pid: process.pid, transaction }, {
    running: 'Another Atlas writer is running.', changed: 'Writer lock changed.',
    async stopped(previous) {
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw fail('LOCKED', 'Invalid lock; inspect state before recovery.');
      if (alive(previous.pid)) throw fail('LOCKED', 'Another Atlas writer is running.');
      let finished;
      try { finished = finishedJournal(await readState(root, transactionPath(previous.transaction)), previous.transaction); }
      catch (error) { if (error.code === 'NOT_FOUND') finished = true; else throw error; }
      if (!finished && (!recover || previous.transaction !== transaction)) throw fail('LOCKED', `Interrupted transaction ${previous.transaction} needs recovery.`);
    },
  });
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

/** Reconstruct exact before/after observations from a saved plan; supplied models are not authority. */
export function inspectChange(plan) {
  planChanges(plan);
  if (!plan.candidate || !nonblank(plan.candidate.root)) throw fail('INVALID_PLAN', 'A captured candidate is required.');
  const after = validateFiles(captureMap(plan.candidate), { root: plan.candidate.root });
  if (after.identity !== plan.candidate.identity || after.identity !== plan.validation?.identity) throw fail('INVALID_PLAN', 'Candidate bytes do not match the plan identity.');
  const originals = captureMap(after), changedPaths = new Set();
  for (const change of plan.changes) {
    relativePath(change.path);
    if (changedPaths.has(change.path) || !sameBytes(contentBytes(originals.get(change.path) ?? null), afterBytes(change))) throw fail('INVALID_PLAN', 'Candidate differs from the proposed file effects.');
    changedPaths.add(change.path);
    if (change.beforeBase64 !== undefined) originals.set(change.path, { rawBase64: change.beforeBase64 });
    else if (change.before === null) originals.delete(change.path);
    else originals.set(change.path, change.before);
  }
  const validity = planValidation(after, styleAlone(originals, plan.changes)).status;
  for (const observed of plan.observedFiles ?? []) {
    if (!sameBytes(contentBytes(originals.get(observed.path) ?? null), contentBytes(capturedContent(observed)))) throw fail('INVALID_PLAN', 'Observed original bytes differ from the plan.');
    originals.delete(observed.path);
  }
  const before = validateFiles(originals, { root: after.root });
  const inventory = files => [...files].map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (before.identity !== plan.baseline.identity || !Array.isArray(plan.baseline.files) || JSON.stringify(inventory(before.files)) !== JSON.stringify(inventory(plan.baseline.files))) throw fail('INVALID_PLAN', 'Original bytes do not match the captured baseline.');
  const expectedStatus = validity !== 'ready' ? 'invalid' : plan.changes.length ? 'ready' : 'noop';
  if (plan.validation.status !== validity || plan.status !== expectedStatus) throw fail('INVALID_PLAN', 'Plan status does not match its candidate and its changes.');
  return { before, after };
}

/**
 * Apply revalidates the complete candidate and current baseline before writing. Only `applyDraft` calls it: applying
 * takes a saved draft and the exact revision that was reviewed.
 */
async function applyChange(root, plan, { onProgress } = {}) {
  plan = structuredClone(plan);
  const changes = planChanges(plan);
  root = await checkedRoot(root);
  const id = randomUUID();
  const lock = await acquire(root, id);
  let transaction;
  try {
    const current = await openAtlas(root);
    const blocker = await blockerAt(root, current);
    if (blocker) throw fail(blocker.code, blocker.message);
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
    const prepared = prepareChange(workingView, { changes, reason: plan.reason });
    if (prepared.status === 'invalid') throw fail('INVALID_CANDIDATE', prepared.candidate.status === 'ready' ? STYLE_ALONE.message : 'Candidate Atlas is invalid.');
    if (prepared.status === 'noop') return { format: 'atlas.apply/1', status: 'noop', identity: current.identity, transaction: null };
    await lock.held();
    transaction = { format: 'atlas.transaction/1', id, phase: 'prepared', createdAt: new Date().toISOString(), baseline: current.identity, result: prepared.candidate.identity, changes: prepared.changes, written: [] };
    await saveState(root, transactionPath(id), transaction);
    await onProgress?.({ transaction: id, phase: 'prepared', written: [] });
    // Catch changes made while preparing durable state, before the first write.
    if ((await openAtlas(root)).identity !== current.identity) throw fail('STALE', 'Atlas changed before application.');
    await checkObserved();
    for (const change of prepared.changes) {
      if (!sameBytes(await bytesAt(root, change.path), beforeBytes(change))) throw fail('STALE', `Changed before apply: ${change.path}`);
    }
    transaction.phase = 'applying';
    await saveState(root, transactionPath(id), transaction);
    for (const change of prepared.changes) {
      if (!sameBytes(await bytesAt(root, change.path), beforeBytes(change))) throw fail('STALE', `Changed during apply: ${change.path}`);
      await lock.held();
      await atomicWrite(root, change.path, change.after);
      transaction.written.push(change.path);
      await saveState(root, transactionPath(id), transaction);
      await onProgress?.({ transaction: id, phase: 'applying', written: [...transaction.written] });
    }
    const result = await openAtlas(root);
    if (result.status !== 'ready' || result.identity !== prepared.candidate.identity) throw fail('CONCURRENT_CHANGE', 'Atlas changed during application; inspect the transaction.');
    // A completed transaction leaves nothing to recover. Its journal stays, complete, until its draft is removed.
    transaction.phase = 'complete';
    await saveState(root, transactionPath(id), transaction);
    return { format: 'atlas.apply/1', status: 'complete', identity: result.identity, transaction: id };
  } catch (error) {
    if (transaction) {
      transaction.phase = 'interrupted';
      transaction.error = { code: typeof error?.code === 'string' ? error.code : 'WRITE_FAILED', message: typeof error?.message === 'string' ? error.message : String(error) };
      await saveState(root, transactionPath(id), transaction).catch(() => {});
      return { format: 'atlas.apply/1', status: 'interrupted', transaction: id, written: transaction.written, error: transaction.error };
    }
    throw error;
  } finally { await lock.release(); }
}

/** The file names of the saved records in one folder of the private state of a canonical root, sorted. */
async function stateNames(root, directory) {
  const folder = await safePath(root, `${STATE}/${directory}`, { internal: true });
  let names;
  try { names = await fs.readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  // The bound counts the records a listing reads, not a lock or a temporary file beside them.
  const records = names.filter(name => name.endsWith('.json'));
  if (records.length > 10000) throw fail('LIMIT_EXCEEDED', 'Too many saved records.');
  return records.sort();
}

/** Failures that concern the private state as a whole, not one saved file in it. */
const STATE_WIDE = ['INVALID_STATE_HOME', 'STATE_OWNER', 'UNSAFE_STATE'];
/**
 * What `entry` reads from each saved file of one folder, and each file it cannot read, by its name with the code and
 * message, so that no unreadable file hides the others. A file removed since the folder was read is passed over, and a
 * failure of the private state as a whole still refuses.
 */
async function listSaved(root, directory, kind, entry) {
  root = await checkedRoot(root);
  const listed = [], unreadable = [];
  for (const file of await stateNames(root, directory)) {
    const id = file.slice(0, -5);
    try {
      if (!ID.test(id)) throw fail('INVALID_STATE', `The file name is not a ${kind} identity.`);
      listed.push(await entry(root, id));
    } catch (error) {
      if (error?.code === 'NOT_FOUND') continue;
      if (typeof error?.code !== 'string' || STATE_WIDE.includes(error.code)) throw error;
      unreadable.push({ file, code: error.code, message: error.message });
    }
  }
  return { listed, unreadable };
}

/** The transactions whose journals remain: those not finished, and a finished one whose journal could not be removed. */
export async function listTransactions(root) {
  const { listed, unreadable } = await listSaved(root, 'transactions', 'transaction', async (canonical, id) => {
    const { phase, createdAt, baseline, result, written, error } = checkedJournal(await readState(canonical, transactionPath(id)), id);
    return { id, phase, createdAt, baseline, result, written, error };
  });
  return { transactions: listed, unreadable };
}

/**
 * Restore only this transaction's files. Foreign edits are never overwritten. A journal is kept only while its transaction
 * is unfinished: once the rollback is done the journal is removed, and one whose removal fails stays rolled back, which
 * recovering again removes.
 */
export async function recoverChange(root, id) {
  root = await checkedRoot(root);
  stateId(id);
  const lock = await acquire(root, id, true);
  try {
    const transaction = await readState(root, transactionPath(id));
    checkedJournal(transaction, id);
    if (transaction.phase === 'complete') throw fail('ALREADY_COMPLETE', 'A completed transaction is not an interrupted change.');
    if (transaction.phase === 'rolled-back') {
      await removeState(root, transactionPath(id));
      return { format: 'atlas.recovery/1', status: 'rolled-back', transaction: id };
    }
    const current = await openAtlas(root);
    const candidate = captureMap(current);
    const knownRoots = rootsFrom(candidate);
    for (const change of transaction.changes) {
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
      await lock.held();
      await atomicWrite(root, change.path, beforeBytes(change));
    }
    transaction.phase = 'rolled-back';
    await saveState(root, transactionPath(id), transaction);
    await removeState(root, transactionPath(id)).catch(() => {});
    // The baseline is restored when the Atlas reads back whole at the identity the transaction started from.
    const result = await openAtlas(root);
    return { format: 'atlas.recovery/1', status: 'rolled-back', transaction: id, identity: result.identity, baselineRestored: result.status !== 'incomplete' && result.identity === transaction.baseline, diagnostics: result.diagnostics };
  } finally { await lock.release(); }
}

function draftRevision(draft) {
  const { revision, ...content } = draft;
  return sha(JSON.stringify(content));
}

function expectedDraftRevision(revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/u.test(revision)) throw fail('STALE_DRAFT', 'The exact reviewed draft revision is required.');
}

/** Run `action(root, held)` under the draft's lock; it asks `held()` before it saves or removes the draft. */
async function withDraftLock(root, id, action) {
  root = await checkedRoot(root);
  const lock = await takeLock(root, `${STATE}/drafts/${stateId(id)}.lock`, { pid: process.pid, token: randomUUID() }, {
    running: 'Another writer is using this draft.', changed: 'Draft lock changed.',
    async stopped(previous) {
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw fail('LOCKED', 'Invalid draft lock; inspect saved state.');
      if (alive(previous.pid)) throw fail('LOCKED', 'Another writer is using this draft.');
    },
  });
  try { return await action(root, lock.held); }
  finally { await lock.release(); }
}

export async function saveDraft(root, { id = randomUUID(), plan, expectedRevision }) {
  plan = structuredClone(plan);
  planChanges(plan);
  if (expectedRevision !== undefined) expectedDraftRevision(expectedRevision);
  return withDraftLock(root, id, async (canonical, held) => {
    let previous;
    try { previous = await loadDraft(canonical, id); } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    if (previous ? previous.revision !== expectedRevision : expectedRevision !== undefined) throw fail('STALE_DRAFT', 'The saved draft changed or was removed; reload it before saving.');
    if (previous && JSON.stringify(previous.plan.baseline) !== JSON.stringify(plan.baseline)) throw fail('STALE_DRAFT', 'A saved draft must retain its original baseline.');
    const draft = { format: 'atlas.draft/1', id: stateId(id), updatedAt: new Date().toISOString(), plan };
    draft.revision = draftRevision(draft);
    await held();
    await saveState(canonical, draftPath(id), draft);
    return draft;
  });
}
/** A saved draft is one whose file names it, whose revision is its content's, and whose plan is a plan. */
function checkedDraft(draft, id) {
  if (draft?.format !== 'atlas.draft/1' || draft.id !== id) throw fail('INVALID_STATE', 'Invalid draft.');
  if (draft.revision !== draftRevision(draft)) throw fail('INVALID_STATE', 'Saved draft integrity failed.');
  planChanges(draft.plan);
  return draft;
}
export async function loadDraft(root, id) {
  root = await checkedRoot(root);
  return checkedDraft(await readState(root, draftPath(id)), id);
}
/** Every saved draft that loads, and every draft file that does not, by its name with the code and message loading it gives. */
export async function listDrafts(root) {
  const { listed, unreadable } = await listSaved(root, 'drafts', 'draft', async (canonical, id) => {
    const { revision, updatedAt, plan } = checkedDraft(await readState(canonical, draftPath(id)), id);
    return { id, revision, updatedAt, reason: plan.reason, status: plan.status, baseline: plan.baseline.identity };
  });
  return { drafts: listed, unreadable };
}
async function removeDraft(root, id) {
  const filename = await safePath(root, draftPath(id), { internal: true });
  await fs.unlink(filename);
  await syncDirectory(path.dirname(filename));
}
/**
 * A completed apply removes its draft and then its journal; any other outcome keeps the draft: an interrupted one beside
 * its journal until recovery, and a noop one as it was. `draft` says which. The journal goes last, so a crash before
 * either removal is done leaves a complete journal, which says the change was applied. A draft that cannot be removed
 * is reported kept, and its journal stays, complete; so does a journal that cannot be removed. Until an interrupted
 * transaction is recovered, the Atlas takes no apply of any draft (`LOCKED`).
 */
export async function applyDraft(root, id, { expectedRevision, ...options } = {}) {
  expectedDraftRevision(expectedRevision);
  return withDraftLock(root, id, async (canonical, held) => {
    const draft = await loadDraft(canonical, id);
    if (draft.revision !== expectedRevision) throw fail('STALE_DRAFT', 'The draft is not at that revision; review it and give its exact revision.');
    const result = await applyChange(canonical, draft.plan, options);
    if (result.status !== 'complete') return { ...result, draft: 'kept' };
    try { await held(); await removeDraft(canonical, id); } catch { return { ...result, draft: 'kept' }; }
    await removeState(canonical, transactionPath(result.transaction)).catch(() => {});
    return { ...result, draft: 'removed' };
  });
}
export async function deleteDraft(root, id, { expectedRevision } = {}) {
  expectedDraftRevision(expectedRevision);
  return withDraftLock(root, id, async (canonical, held) => {
    const draft = await loadDraft(canonical, id);
    if (draft.revision !== expectedRevision) throw fail('STALE_DRAFT', 'The draft is not at that revision; load it and give its exact revision.');
    await held();
    await removeDraft(canonical, id);
    return { status: 'deleted', id };
  });
}
