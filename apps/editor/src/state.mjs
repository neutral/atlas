import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EditorError, exactPath, requireValue } from './protocol.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const parseJson = bytes => JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

function checkedDirectory(directory, create = false) {
  requireValue(path.isAbsolute(directory), 'Storage paths must be absolute.');
  const parent = path.dirname(directory);
  if (parent !== directory) checkedDirectory(parent, create);
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error_) { if (error_.code !== 'EEXIST') throw error_; }
    stat = fs.lstatSync(directory);
  }
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'Storage must use real directories without symlink traversal.');
}

function durableFile(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  return sha256(bytes);
}

function readRegular(file) {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 7 * 1024 * 1024, 'Application state must be a bounded regular file.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const unchanged = next => next.isFile() && next.dev === stat.dev && next.ino === stat.ino
    && next.size === stat.size && next.mtimeMs === stat.mtimeMs && next.ctimeMs === stat.ctimeMs;
  try {
    requireValue(unchanged(fs.fstatSync(fd)), 'Application state changed before reading.');
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0, count;
    while (size < bytes.length && (count = fs.readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    requireValue(size === stat.size && unchanged(fs.fstatSync(fd)) && unchanged(fs.lstatSync(file)), 'Application state changed while reading.');
    return bytes.subarray(0, size);
  } finally { fs.closeSync(fd); }
}

export function openEditorState({ repositoryRoot, atlasRoot, atlasPath, stateDirectory }, { create = true } = {}) {
  requireValue(typeof stateDirectory === 'string' && path.isAbsolute(stateDirectory), 'An absolute durable stateDirectory is required.');
  const root = path.resolve(stateDirectory);
  for (const forbidden of [atlasRoot, path.join(repositoryRoot, '.git'), path.join(repositoryRoot, 'tmp')]) {
    requireValue(!inside(forbidden, root) && !inside(root, forbidden), 'State storage must remain outside the Atlas, repository tmp, and .git.');
  }
  try { checkedDirectory(root, create); }
  catch (error) {
    if (!create && error.code === 'ENOENT') throw new EditorError('atlas.editor.state-source-unavailable', 'Existing owned Editor state is required while source capture is unavailable.');
    throw error;
  }
  const marker = { contract: 'atlas.editor-state/1', repositoryRoot, atlasPath };
  const markerPath = path.join(root, 'workspace.json');
  if (fs.existsSync(markerPath)) {
    requireValue(JSON.stringify(parseJson(readRegular(markerPath))) === JSON.stringify(marker), 'The state directory belongs to another workspace.');
  } else {
    requireValue(create, 'Existing Editor state with this workspace ownership marker is required while source capture is unavailable.', 'atlas.editor.state-source-unavailable');
    requireValue(fs.readdirSync(root).length === 0, 'An existing state directory must be empty or owned by this Editor workspace.');
    durableFile(markerPath, marker);
  }
  const directories = Object.fromEntries(['drafts', 'reports', 'recovery'].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(directories)) checkedDirectory(directory, create);

  function assertStorage() {
    checkedDirectory(root);
    requireValue(JSON.stringify(parseJson(readRegular(markerPath))) === JSON.stringify(marker), 'The state ownership marker changed.');
    for (const directory of Object.values(directories)) checkedDirectory(directory);
  }

  const writeLock = path.join(directories.drafts, '.write-lock');
  const pendingPath = path.join(writeLock, 'pending.json');
  const draftFile = draftId => path.join(directories.drafts, `${draftId}.json`);
  const maxDrafts = 1000;

  function readDraft(name) {
    const bytes = readRegular(path.join(directories.drafts, name));
    const item = parseJson(bytes);
    const keys = ['contract', 'kind', 'draftId', 'sequence', 'path', 'baseViewDigest', 'text', 'savedAt'];
    requireValue(item !== null && typeof item === 'object' && !Array.isArray(item)
      && Object.keys(item).length === keys.length && keys.every(key => Object.hasOwn(item, key))
      && item.contract === 'atlas.editor-draft/2' && uuid(item.draftId) && name === `${item.draftId}.json`
      && exactPath(item.path) && Number.isSafeInteger(item.sequence) && item.sequence > 0
      && typeof item.text === 'string' && Buffer.byteLength(item.text) <= 1024 * 1024
      && ['document', 'contribution'].includes(item.kind)
      && (typeof item.baseViewDigest === 'string' && /^[a-f0-9]{64}$/u.test(item.baseViewDigest)
        || item.kind === 'contribution' && item.baseViewDigest === null)
      && typeof item.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(item.savedAt)
      && Number.isFinite(Date.parse(item.savedAt)),
    'Unsupported or invalid current draft record. Inspect the stored file; automatic conversion is unavailable.');
    return { ...item, revision: sha256(bytes) };
  }

  function currentDrafts() {
    assertStorage();
    const drafts = [], issues = [];
    const names = fs.readdirSync(directories.drafts);
    requireValue(names.length <= maxDrafts + 1, 'Draft storage exceeds 1,000 current entries. Inspect storage before continuing.');
    for (const name of names.sort()) {
      if (name === '.write-lock') {
        issues.push({ file: name, message: 'A draft write is active or interrupted. Current drafts remain readable. Stop every Editor using this state, inspect this lock and any pending.json, then remove the inspected lock before writing again.' });
        continue;
      }
      if (!uuid(name.slice(0, -5)) || !name.endsWith('.json')) { issues.push({ file: name, message: 'Unrecognized draft entry. Inspect the stored file; it remains unchanged.' }); continue; }
      try { drafts.push(readDraft(name)); }
      catch (error) { issues.push({ file: name, message: error.message }); }
    }
    return { drafts, issues };
  }

  function flushDrafts() {
    const fd = fs.openSync(directories.drafts, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  function withDraftWrite(operation) {
    assertStorage();
    try { fs.mkdirSync(writeLock, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new EditorError('atlas.editor.draft-busy', 'A draft write is active or interrupted. Inspect Draft storage issues before retrying.');
      throw error;
    }
    try { checkedDirectory(writeLock); return operation(); }
    finally {
      try {
        checkedDirectory(writeLock);
        try { fs.unlinkSync(pendingPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        fs.rmdirSync(writeLock);
        flushDrafts();
      } catch (error) {
        throw new EditorError('atlas.editor.draft-storage-failed', `Draft storage cleanup failed; the write outcome requires inspection: ${error.message}`);
      }
    }
  }

  function selectedDraft(draftId, expectedRevision) {
    requireValue(uuid(draftId), 'Unknown draft id.');
    let previous;
    try { previous = readDraft(`${draftId}.json`); }
    catch (error) {
      if (error.code === 'ENOENT') throw new EditorError('atlas.editor.stale-draft', 'The selected draft is unavailable. Inspect stored drafts before continuing.');
      throw error;
    }
    requireValue(previous.revision === expectedRevision, 'The stored draft changed. Recover its current text before saving or discarding.', 'atlas.editor.stale-draft');
    return previous;
  }

  return {
    ...directories, stateDirectory: root, assertStorage,
    drafts: currentDrafts,
    saveDraft(params) {
      const kind = params.kind === undefined ? 'document' : params.kind;
      requireValue(exactPath(params.path) && typeof params.text === 'string' && Buffer.byteLength(params.text) <= 1024 * 1024
        && ['document', 'contribution'].includes(kind)
        && (typeof params.baseViewDigest === 'string' && /^[a-f0-9]{64}$/u.test(params.baseViewDigest)
          || kind === 'contribution' && params.baseViewDigest === null), 'A draft requires an exact path, source digest, and at most 1 MiB of text. A contribution before initialization has a null baseline.');
      return withDraftWrite(() => {
        let previous;
        if (params.draftId !== undefined) {
          previous = selectedDraft(params.draftId, params.expectedRevision);
          requireValue(previous.path === params.path && previous.kind === kind && previous.baseViewDigest === params.baseViewDigest,
            'The draft path, kind, and original baseline cannot change.', 'atlas.editor.stale-draft');
        } else {
          requireValue(params.expectedRevision === undefined, 'A new draft has no expected revision.');
          requireValue(fs.readdirSync(directories.drafts).length <= maxDrafts, 'Draft storage is limited to 1,000 current entries. Discard an inspected draft before creating another.');
        }
        const sequence = (previous?.sequence ?? 0) + 1;
        requireValue(Number.isSafeInteger(sequence), 'The draft sequence cannot advance safely. Inspect and explicitly discard this draft before creating another.');
        const item = { contract: 'atlas.editor-draft/2', kind, draftId: previous?.draftId ?? randomUUID(), sequence,
          path: params.path, baseViewDigest: params.baseViewDigest, text: params.text, savedAt: new Date().toISOString() };
        const revision = durableFile(pendingPath, item), destination = draftFile(item.draftId);
        assertStorage();
        if (previous) {
          selectedDraft(previous.draftId, params.expectedRevision);
          fs.renameSync(pendingPath, destination);
        } else fs.linkSync(pendingPath, destination);
        flushDrafts();
        requireValue(sha256(readRegular(destination)) === revision, 'Draft storage changed before acknowledgement.', 'atlas.editor.stale-draft');
        return { ...item, revision };
      });
    },
    discardDraft({ draftId, expectedRevision }) {
      return withDraftWrite(() => {
        selectedDraft(draftId, expectedRevision);
        fs.unlinkSync(draftFile(draftId));
        flushDrafts();
        return { discarded: true, draftId };
      });
    },
    newReportDirectory() { assertStorage(); return { reportId: randomUUID(), parent: directories.reports }; },
    reportDirectory(reportId) {
      requireValue(uuid(reportId), 'Unknown report id.'); assertStorage();
      const directory = path.join(directories.reports, reportId);
      checkedDirectory(directory);
      return directory;
    },
    reportsList() {
      assertStorage();
      return fs.readdirSync(directories.reports).filter(uuid).filter(id => {
        const stat = fs.lstatSync(path.join(directories.reports, id));
        return stat.isDirectory() && !stat.isSymbolicLink();
      });
    },
  };
}
