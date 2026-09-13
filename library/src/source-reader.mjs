import nodeFs from 'node:fs';
import path from 'node:path';
import { validUri } from './resolved.mjs';
import { isWithin, pathContainsSymlink, pathCaseOrNormalizationMismatch } from './util.mjs';
import { digest } from './source-inventory.mjs';
import { AtlasToolError } from './view.mjs';

function argument(condition, message) {
  if (!condition) throw new AtlasToolError('atlas.tools.invalid-argument', message);
}

export async function readSource(view, target, options, source = { fs: nodeFs, descriptor: { kind: 'working-tree' } }) {
  const fs = source.fs;
  const immutable = source.descriptor.kind === 'snapshot';
  argument(options !== null && typeof options === 'object' && !Array.isArray(options), 'readSource options must be an object.');
  argument(target && typeof target === 'object' && !Array.isArray(target)
    && (Object.hasOwn(target, 'resource') !== Object.hasOwn(target, 'uri'))
    && (typeof target.resource === 'string' ? target.resource.length > 0 : typeof target.uri === 'string'),
    'readSource requires exactly one Resource id or direct URI.');
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  argument(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'maxBytes must be a positive safe integer.');
  const allowedRoots = options.allowedRoots ?? [];
  argument(Array.isArray(allowedRoots) && allowedRoots.every((root) => typeof root === 'string' && path.isAbsolute(root)),
    'allowedRoots must contain absolute paths.');
  argument(options.reader === undefined || typeof options.reader === 'function', 'reader must be a function.');
  let request;
  try { request = structuredClone(target); } catch { throw new AtlasToolError('atlas.tools.invalid-argument', 'The source target must contain cloneable data.'); }
  const base = { contract: 'atlas.source-read/1', viewDigest: view.identity.digest, target: request,
    limits: [immutable ? 'Local source bytes come from the sealed repository snapshot. External reader content remains a separate observation.'
      : 'Source bytes are a separate current observation, not bytes validated with the opened Atlas view.',
      'A source read establishes neither source truth nor permission to redistribute it.'] };
  let uri = request.uri, ownerPath = options.ownerPath ?? 'atlas.md', resource;
  if (request.resource !== undefined) {
    if (!view.validation.normalized) return { ...base, status: 'unavailable', reason: 'A valid registry is required to resolve a Resource id.' };
    resource = view.validation.normalized.atlas.resources.find((item) => item.id === request.resource);
    if (!resource) return { ...base, status: 'missing', reason: 'Resource id is absent from this view.' };
    uri = resource.uri;
    ownerPath = 'atlas.md';
  }
  argument(typeof ownerPath === 'string' && view.identity.inputs.some((input) => input.path === ownerPath && input.kind === 'file'),
    'ownerPath must identify an exact observed file within this Atlas.');
  argument(validUri(uri), 'The source URI must satisfy the Atlas URI-reference contract.');
  const descriptor = { ...base, uri, ownerPath, ...(resource ? { resource } : {}) };
  const external = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri) || uri.startsWith('//');
  if (external) {
    if (!options.reader) return { ...descriptor, status: 'unrequested', reason: 'No caller-provided external source reader was supplied.' };
    try {
      const result = await options.reader({ uri, selector: request.selector ?? null, maxBytes });
      if (!result || !(result.bytes instanceof Uint8Array)) return { ...descriptor, status: 'unsupported', reason: 'The source reader did not return bytes.' };
      if (request.selector && result.selectorApplied !== true) return { ...descriptor, status: 'unsupported', reason: 'The source reader did not apply the requested selector.' };
      return content(descriptor, Buffer.from(result.bytes), maxBytes, {
        kind: 'caller-reader', uri, observedAt: new Date().toISOString(),
        ...(typeof result.provenance === 'string' ? { provenance: result.provenance } : {}),
        ...(typeof result.mediaType === 'string' ? { mediaType: result.mediaType } : {}),
      }, result.complete !== false);
    } catch (error) {
      return { ...descriptor, status: 'unreadable', reason: error instanceof Error ? error.message : String(error) };
    }
  }
  if (request.selector) return { ...descriptor, status: 'unsupported', reason: 'Opaque Resource selectors require a reader that supports their meaning.' };
  const part = uri.split(/[?#]/u)[0];
  if (!part) return { ...descriptor, status: 'unsupported', reason: 'A source URI must identify material outside its structural record.' };
  let decoded;
  try { decoded = decodeURIComponent(part); } catch { return { ...descriptor, status: 'unsupported', reason: 'The source path has invalid percent encoding.' }; }
  const file = path.resolve(view.atlasRoot, path.dirname(ownerPath), decoded);
  const roots = [view.atlasRoot, ...allowedRoots].filter((root) => isWithin(root, file));
  if (!roots.length) return { ...descriptor, status: 'unrequested', reason: 'The local source is outside the explicitly allowed roots.' };
  try {
    const root = roots.find((candidate) => !pathContainsSymlink(candidate, file, fs) && !pathCaseOrNormalizationMismatch(candidate, file, fs));
    if (!root) return { ...descriptor, status: 'unsupported', reason: 'The local source traverses a symlink or differs in case or normalization.' };
    // The root itself is an explicit caller-selected capability. Its canonical
    // location bounds this read; descendant symlinks remain unsupported.
    const canonicalRoot = fs.realpathSync(root), canonicalFile = fs.realpathSync(file);
    if (!isWithin(canonicalRoot, canonicalFile)) return { ...descriptor, status: 'unrequested', reason: 'The resolved source is outside the allowed root.' };
    const fd = fs.openSync(canonicalFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      if (!before.isFile()) return { ...descriptor, status: 'unsupported', reason: 'The source is not a regular file.' };
      const bytes = Buffer.alloc(Math.min(Number(before.size), maxBytes + 1));
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
        if (!count) break;
        length += count;
      }
      const after = fs.fstatSync(fd, { bigint: true });
      const current = fs.statSync(canonicalFile, { bigint: true });
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || current.dev !== after.dev || current.ino !== after.ino
        || fs.realpathSync(file) !== canonicalFile) return { ...descriptor, status: 'stale', reason: 'The source changed while being read.' };
      return content(descriptor, bytes.subarray(0, length), maxBytes,
        { kind: immutable ? 'immutable-file' : 'local-file', path: canonicalFile, totalByteLength: Number(before.size),
          ...(immutable ? { repositoryDigest: source.descriptor.repositoryDigest, revision: source.descriptor.revision } : {}),
          observedAt: new Date().toISOString() }, length === Number(before.size));
    } finally { fs.closeSync(fd); }
  } catch (error) {
    return { ...descriptor, status: ['ENOENT', 'ENOTDIR'].includes(error?.code) ? 'missing' : 'unreadable', reason: error instanceof Error ? error.message : String(error) };
  }
}

function content(descriptor, bytes, maxBytes, observation, complete) {
  const selected = bytes.subarray(0, maxBytes);
  const truncated = !complete || bytes.length > maxBytes;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(selected, { stream: truncated }); } catch { /* Unsupported text remains explicit. */ }
  if (text?.includes('\0')) text = undefined;
  return { ...descriptor, status: text === undefined ? 'unsupported' : truncated ? 'truncated' : 'read',
    ...(text !== undefined ? { text } : {}), bytesBase64: selected.toString('base64'), truncated,
    observation: { ...observation, sha256: digest(selected), byteLength: selected.length, digestScope: 'returned-bytes', complete: !truncated },
  };
}
