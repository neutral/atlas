import nodeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IGNORED_DIRECTORIES } from './constants.mjs';
import { compareCodePoints } from './model.mjs';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

// Capture bytes for draft inspection while hashing the entire observed input.
// This is a working-tree observation, not an atomic filesystem snapshot.
export function inventory(root, maxDocumentBytes, explicitLocalTargets = [], fs = nodeFs) {
  const observation = observeInventory(root, maxDocumentBytes, fs);
  for (const target of explicitLocalTargets) observation.includeTarget(target);
  return observation.snapshot();
}

// Resolution can disclose exact local targets after the ordinary scan. Capture
// those paths during that same validation pass, without scanning their siblings.
export function observeInventory(root, maxDocumentBytes, fs = nodeFs) {
  const entriesByPath = new Map(), documents = new Map(), issues = [];
  function record(entry) {
    const previous = entriesByPath.get(entry.path);
    if (!previous) entriesByPath.set(entry.path, entry);
    else if (JSON.stringify(previous) !== JSON.stringify(entry)
      && !(previous.kind === 'nested-atlas' && entry.kind === 'directory')) {
      issues.push({ path: entry.path, code: 'SOURCE_CHANGED', message: 'Source changed during input observation.' });
    }
  }
  function visit(target, relativePath, descend = true, allowMissing = false) {
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        record({ path: relativePath, kind: 'symlink', target: fs.readlinkSync(target) });
        return 'symlink';
      } else if (stat.isDirectory()) {
        if (!descend) {
          record({ path: relativePath, kind: 'directory' });
          return 'directory';
        }
        const entries = fs.readdirSync(target).sort(compareCodePoints);
        // These containers inspect every direct entry, including ignored names.
        // Their children never establish nested Atlas discovery boundaries.
        const structuralContainer = relativePath === '.checks' || relativePath === '.publication' || path.posix.basename(relativePath) === 'points';
        if (!structuralContainer && relativePath !== '.' && entries.includes('atlas.md')) {
          record({ path: relativePath, kind: 'nested-atlas' });
          return 'directory';
        }
        record({ path: relativePath, kind: 'directory' });
        for (const entry of entries) {
          const childPath = relativePath === '.' ? entry : `${relativePath}/${entry}`;
          if (!structuralContainer && IGNORED_DIRECTORIES.has(entry)) continue;
          visit(path.join(target, entry), childPath, !structuralContainer);
        }
        return 'directory';
      } else if (stat.isFile()) {
        if (entriesByPath.get(relativePath)?.kind === 'file') return 'file';
        const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const before = fs.fstatSync(fd, { bigint: true });
          const hash = createHash('sha256'), captured = [];
          const chunk = Buffer.alloc(64 * 1024);
          let size = 0, read;
          while ((read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
            hash.update(chunk.subarray(0, read));
            if (size < maxDocumentBytes) captured.push(Buffer.from(chunk.subarray(0, Math.min(read, maxDocumentBytes - size))));
            size += read;
          }
          const after = fs.fstatSync(fd, { bigint: true });
          if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
            throw new Error('Source changed while being read.');
          }
          record({ path: relativePath, kind: 'file', byteLength: size, sha256: hash.digest('hex') });
          documents.set(relativePath, Buffer.concat(captured));
        } finally {
          fs.closeSync(fd);
        }
        return 'file';
      } else {
        record({ path: relativePath, kind: 'special' });
        return 'special';
      }
    } catch (error) {
      if (allowMissing && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
        record({ path: relativePath, kind: 'missing' });
        return 'missing';
      }
      const issue = { path: relativePath, code: error.code ?? 'SOURCE_CHANGED', message: error.message };
      issues.push(issue);
      record({ path: relativePath, kind: 'unreadable', error: issue.code });
      return 'unreadable';
    }
  }
  visit(root, '.');
  return {
    includeTarget(relativePath) {
      const segments = relativePath.split('/');
      if (relativePath === '.') return;
      if (path.isAbsolute(relativePath) || segments.some((segment) => ['', '.', '..'].includes(segment))) {
        throw new Error('Observed local targets must be exact contained relative paths.');
      }
      let directory = root;
      for (const [index, segment] of segments.entries()) {
        const currentPath = segments.slice(0, index + 1).join('/');
        try {
          // Exact spelling matters even on case-insensitive filesystems. A
          // mismatched spelling remains missing; validator diagnostics own why.
          if (!fs.readdirSync(directory).includes(segment)) {
            record({ path: currentPath, kind: 'missing' });
            return;
          }
        } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) record({ path: currentPath, kind: 'missing' });
          else {
            const issue = { path: currentPath, code: error.code ?? 'SOURCE_CHANGED', message: error.message };
            issues.push(issue);
            record({ path: currentPath, kind: 'unreadable', error: issue.code });
          }
          return;
        }
        const target = path.join(directory, segment);
        const kind = visit(target, currentPath, false, true);
        if (index < segments.length - 1 && kind !== 'directory') return;
        directory = target;
      }
    },
    snapshot() {
      const inputs = [...entriesByPath.values()].sort((a, b) => compareCodePoints(a.path, b.path));
      return { inputs, documents, issues, digest: issues.length ? null : digest(JSON.stringify(inputs)) };
    },
  };
}

export function inputChanges(before, after) {
  const left = new Map(before.map((input) => [input.path, input]));
  const right = new Map(after.map((input) => [input.path, input]));
  return [...new Set([...left.keys(), ...right.keys()])].sort(compareCodePoints).flatMap((file) => {
    const old = left.get(file), current = right.get(file);
    if (JSON.stringify(old) === JSON.stringify(current)) return [];
    return [{ path: file, change: !old ? 'added' : !current ? 'removed' : 'changed' }];
  });
}
