import path from 'node:path';
import { constants } from 'node:fs';
import { compareCodePoints } from './model.mjs';
import { digest } from './source-inventory.mjs';
import { AtlasToolError, openAtlasFromSource } from './view.mjs';

function requireInput(condition, message) {
  if (!condition) throw new AtlasToolError('atlas.tools.invalid-argument', message);
}

function exactPath(value, allowRoot = false) {
  return typeof value === 'string' && (allowRoot && value === '.'
    || value.length > 0 && !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0')
      && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'));
}

export function openAtlasSnapshot(input, options = {}) {
  const source = createImmutableSource(input);
  return openAtlasFromSource(source.atlasStart, options, source);
}

// This private provider implements only synchronous, read-only operations used
// by Atlas processing. No method falls back to the host filesystem.
export function createImmutableSource(input) {
  requireInput(input !== null && typeof input === 'object' && !Array.isArray(input), 'A snapshot input object is required.');
  requireInput(typeof input.repositoryRoot === 'string' && path.isAbsolute(input.repositoryRoot)
    && !input.repositoryRoot.includes('\0'), 'repositoryRoot must be an absolute namespace path.');
  requireInput(exactPath(input.atlasPath, true), 'atlasPath must be an exact repository-relative path or dot.');
  requireInput(input.revision === undefined || typeof input.revision === 'string' && input.revision.length > 0,
    'revision must be a nonempty string when supplied.');
  requireInput(input.files !== null && typeof input.files === 'object' && !Array.isArray(input.files)
    && [null, Object.prototype].includes(Object.getPrototypeOf(input.files)), 'files must be a plain map of exact paths to strings or Uint8Arrays.');
  requireInput(input.directories === undefined || Array.isArray(input.directories), 'directories must be an array of exact paths.');
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const files = new Map();
  for (const [file, value] of Object.entries(input.files)) {
    requireInput(exactPath(file), `Invalid snapshot file path: ${file}`);
    requireInput(typeof value === 'string' || value instanceof Uint8Array, `Snapshot file ${file} must contain a string or Uint8Array.`);
    files.set(file, Buffer.from(value));
  }
  const directories = new Set(['.']);
  function addDirectory(directory) {
    requireInput(exactPath(directory, true), `Invalid snapshot directory path: ${directory}`);
    const segments = directory === '.' ? [] : directory.split('/');
    for (let length = 1; length <= segments.length; length++) directories.add(segments.slice(0, length).join('/'));
  }
  for (const directory of input.directories ?? []) addDirectory(directory);
  for (const file of files.keys()) addDirectory(path.posix.dirname(file));
  for (const directory of directories) requireInput(!files.has(directory), `Snapshot path is both a file and directory: ${directory}`);

  const sortedFiles = [...files.entries()].sort(([left], [right]) => compareCodePoints(left, right));
  const sortedDirectories = [...directories].sort(compareCodePoints);
  const repositoryDigest = digest(JSON.stringify({
    files: sortedFiles.map(([file, bytes]) => ({ path: file, byteLength: bytes.length, sha256: digest(bytes) })),
    directories: sortedDirectories,
  }));
  const descriptor = {
    kind: 'snapshot', repositoryRoot, revision: input.revision ?? null, repositoryDigest,
  };
  const entries = new Map();
  let nextInode = 1;
  for (const directory of sortedDirectories) entries.set(path.resolve(repositoryRoot, directory), { kind: 'directory', ino: nextInode++ });
  for (const [file, bytes] of sortedFiles) entries.set(path.resolve(repositoryRoot, file), { kind: 'file', bytes, ino: nextInode++ });
  const children = new Map([...entries].filter(([, entry]) => entry.kind === 'directory').map(([directory]) => [directory, []]));
  for (const [file] of entries) {
    if (file === repositoryRoot) continue;
    children.get(path.dirname(file)).push(path.basename(file));
  }
  for (const names of children.values()) names.sort(compareCodePoints);
  const handles = new Map();
  let nextHandle = 1;
  function failure(code, file) {
    return Object.assign(new Error(`${code}: snapshot source ${file}`), { code, path: file });
  }
  function entryAt(file) {
    const absolute = path.resolve(file);
    const entry = entries.get(absolute);
    if (!entry) throw failure('ENOENT', absolute);
    return entry;
  }
  function metadata(entry, options) {
    const number = options?.bigint ? BigInt : Number;
    return {
      ino: number(entry.ino), dev: number(1), size: number(entry.bytes?.length ?? 0),
      mtimeNs: number(0), ctimeNs: number(0),
      isFile: () => entry.kind === 'file', isDirectory: () => entry.kind === 'directory', isSymbolicLink: () => false,
    };
  }
  function handleAt(fd) {
    const handle = handles.get(fd);
    if (!handle) throw failure('EBADF', String(fd));
    return handle;
  }
  const fs = Object.freeze({
    constants,
    lstatSync(file, options) { return metadata(entryAt(file), options); },
    statSync(file, options) { return metadata(entryAt(file), options); },
    realpathSync(file) { entryAt(file); return path.resolve(file); },
    readlinkSync(file) { entryAt(file); throw failure('EINVAL', file); },
    readdirSync(directory, options) {
      if (entryAt(directory).kind !== 'directory') throw failure('ENOTDIR', directory);
      const names = children.get(path.resolve(directory));
      if (!options?.withFileTypes) return [...names];
      return names.map((name) => ({ name, ...metadata(entryAt(path.join(directory, name))) }));
    },
    readFileSync(file, encoding) {
      const entry = entryAt(file);
      if (entry.kind !== 'file') throw failure('EISDIR', file);
      const bytes = Buffer.from(entry.bytes);
      const requestedEncoding = typeof encoding === 'string' ? encoding : encoding?.encoding;
      return requestedEncoding ? bytes.toString(requestedEncoding) : bytes;
    },
    openSync(file, flags = 'r') {
      if (flags !== 'r' && (typeof flags !== 'number' || flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND))) {
        throw failure('EROFS', file);
      }
      const fd = nextHandle++;
      handles.set(fd, { entry: entryAt(file), position: 0 });
      return fd;
    },
    fstatSync(fd, options) { return metadata(handleAt(fd).entry, options); },
    readSync(fd, buffer, offset, length, position) {
      const handle = handleAt(fd);
      if (handle.entry.kind !== 'file') throw failure('EISDIR', String(fd));
      const start = position ?? handle.position;
      const count = Math.max(0, Math.min(length, handle.entry.bytes.length - start));
      handle.entry.bytes.copy(buffer, offset, start, start + count);
      if (position === null || position === undefined) handle.position += count;
      return count;
    },
    closeSync(fd) { handleAt(fd); handles.delete(fd); },
  });
  return { fs, descriptor, atlasStart: path.resolve(repositoryRoot, input.atlasPath) };
}
