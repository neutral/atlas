import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseStrictJson, parseMarkdown, markdownSections } from './frontmatter.mjs';
import { isPrivateStatePath } from './state.mjs';

const DEFAULT_BYTES = 2 * 1024 * 1024;
const DEFAULT_FILES = 10000;
const MAX_ENTRIES = 10000;
const MAX_DEPTH = 64;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pathKey = value => value.normalize('NFC').toLocaleLowerCase('en');
const diagnostic = (code, file, message) => ({ code, path: file, message });
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function relativeRecordPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    value.normalize('NFC') === value &&
    !/[\\\x00-\x1f\x7f:#?]/.test(value) && !path.posix.isAbsolute(value) &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !pathKey(part).startsWith('.atlas-'));
}

function optionsBounds(options = {}) {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_FILES;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 100000) {
    throw new TypeError('maxFileBytes must be 1..67108864 and maxFiles must be 1..100000.');
  }
  return { maxFileBytes, maxFiles };
}

function capturedIdentity(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${Buffer.byteLength(file.path)}:`).update(file.path);
    hash.update(`${file.bytes}:`).update(file.rawBase64 === undefined ? file.content : Buffer.from(file.rawBase64, 'base64'));
  }
  return hash.digest('hex');
}

function finishView(root, files, diagnostics, atlas, incomplete = false) {
  files = [...files].sort((a, b) => compare(a.path, b.path));
  diagnostics = [...diagnostics].sort((a, b) => compare(a.path, b.path) || compare(a.code, b.code) || compare(a.message, b.message));
  return freeze({
    format: 'atlas.view/1', status: incomplete ? 'incomplete' : diagnostics.length ? 'invalid' : 'ready',
    root: path.resolve(root), identity: capturedIdentity(files), files, diagnostics,
    atlas: diagnostics.length || incomplete ? null : atlas,
  });
}

function inspectSource(source) {
  if (!object(source)) return 'A source must be an object.';
  const fields = ['uri', 'title', 'role', 'revision', 'locator', 'sha256'];
  if (Object.keys(source).some(key => !fields.includes(key))) return 'A source has an unknown field.';
  if (!nonblank(source.uri) || /[\x00-\x20\x7f\\]/.test(source.uri)) return 'A source URI must be nonblank and contain no whitespace, controls or backslashes.';
  for (const key of ['title', 'revision', 'locator']) {
    if (own(source, key) && !nonblank(source[key])) return `Source ${key} must be nonblank text.`;
  }
  if (own(source, 'role') && !['evidence', 'background', 'example', 'implementation', 'history'].includes(source.role)) return 'Unsupported source role.';
  if (own(source, 'sha256') && (typeof source.sha256 !== 'string' || !HASH.test(source.sha256))) return 'Source sha256 must be 64 lowercase hexadecimal characters.';
  if (/^https?:\/\//i.test(source.uri)) {
    try {
      const url = new URL(source.uri);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return 'Source URLs must be HTTP(S) without credentials.';
    } catch { return 'Malformed source URL.'; }
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source.uri) || source.uri.startsWith('/') || source.uri.includes('?')) return 'Source URI must be HTTP(S) or an Atlas-root-relative path.';
  const local = source.uri.split('#')[0];
  if (!local) return 'A local source URI must identify a path.';
  try {
    const decoded = decodeURIComponent(local);
    if (!decoded || decoded.startsWith('/') || /^[a-z]:/i.test(decoded) || /[\\\x00-\x1f\x7f]/.test(decoded)) return 'Unsafe local source path.';
    if (/%(?:2f|5c)/i.test(local)) return 'Encoded path separators are not allowed.';
  } catch { return 'Malformed percent encoding in source URI.'; }
  return null;
}

export function validateSource(source) {
  const issue = inspectSource(source);
  return { valid: !issue, diagnostics: issue ? [diagnostic('SOURCE_INVALID', '', issue)] : [] };
}

function validDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hh, mm, ss, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  if (hh !== undefined && (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59)) return false;
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return true;
}

/** Validate only supplied authored bytes. No file or source access occurs. */
export function validateFiles(input, options = {}) {
  const root = path.resolve(options.root ?? '.');
  const { maxFileBytes, maxFiles } = optionsBounds(options);
  const diagnostics = [];
  const add = (code, file, message) => diagnostics.push(diagnostic(code, file, message));
  const files = [];
  const map = new Map();
  const pathAliases = new Map();
  let incomplete = false;
  const entries = input instanceof Map ? input.entries() : Array.isArray(input) ? input.map(file => [file.path, file.rawBase64 === undefined ? file.content : { rawBase64: file.rawBase64 }]) : object(input) ? Object.entries(input) : null;
  if (!entries) {
    add('FILES_INPUT', '', 'Files must be a Map, captured file array, or path-to-content object.');
    return finishView(root, files, diagnostics, null);
  }
  let count = 0, totalBytes = 0;
  for (const [file, supplied] of entries) {
    let content = supplied, raw = null;
    if (++count > maxFiles) { add('READ_LIMIT', '', `Authored file count exceeds ${maxFiles}.`); incomplete = true; break; }
    if (typeof file !== 'string') { add('PATH_UNSAFE', String(file), 'Authored paths must be text.'); continue; }
    const parts = file.split('/');
    let aliasFound = false;
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/'), alias = pathKey(prefix);
      if (pathAliases.has(alias) && pathAliases.get(alias) !== prefix) {
        add('PATH_ALIAS', file, `Authored path component aliases ${pathAliases.get(alias)} under case or Unicode normalization.`);
        aliasFound = true; break;
      }
      pathAliases.set(alias, prefix);
    }
    if (aliasFound) continue;
    if (!relativeRecordPath(file)) { add('PATH_UNSAFE', String(file), 'Authored paths must be NFC normalized relative paths inside the Atlas.'); continue; }
    if (map.has(file)) { add('FILE_DUPLICATE', file, 'The captured file path occurs more than once.'); continue; }
    if (object(content) && Object.keys(content).length === 1 && typeof content.rawBase64 === 'string') {
      if (content.rawBase64.length > Math.ceil(maxFileBytes / 3) * 4) { add('READ_LIMIT', file, `File exceeds ${maxFileBytes} bytes.`); incomplete = true; continue; }
      raw = Buffer.from(content.rawBase64, 'base64');
      if (raw.toString('base64') !== content.rawBase64) { add('FILE_CONTENT', file, 'Captured raw bytes require canonical base64.'); continue; }
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
      catch { content = null; add('FILE_UTF8', file, 'File is not valid UTF-8; exact bytes are retained for repair.'); }
    }
    if (content !== null && typeof content !== 'string' || content === null && raw === null) { add('FILE_CONTENT', file, 'Captured content must be UTF-8 text or exact raw bytes.'); continue; }
    if (content !== null && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)) { add('FILE_UNICODE', file, 'Captured content contains an unpaired Unicode surrogate.'); continue; }
    const bytes = raw?.length ?? Buffer.byteLength(content);
    if (bytes > maxFileBytes) { add('READ_LIMIT', file, `File exceeds ${maxFileBytes} bytes.`); incomplete = true; continue; }
    if (totalBytes + bytes > MAX_TOTAL_BYTES) { add('READ_LIMIT', file, `Captured content exceeds ${MAX_TOTAL_BYTES} bytes.`); incomplete = true; break; }
    totalBytes += bytes;
    map.set(file, content);
    files.push({ path: file, content, ...(content === null ? { rawBase64: raw.toString('base64') } : {}), sha256: sha(raw ?? content), bytes });
  }
  function fields(record, allowed, required, file) {
    if (!object(record)) { add('RECORD_OBJECT', file, 'Expected an object.'); return false; }
    for (const key of Object.keys(record)) if (!allowed.includes(key)) add('FIELD_UNKNOWN', file, `Unknown field: ${key}.`);
    for (const key of required) if (!own(record, key)) add('FIELD_REQUIRED', file, `Missing field: ${key}.`);
    return true;
  }
  function id(value, file, field = 'id') {
    if (typeof value !== 'string' || !ID.test(value)) { add('ID_INVALID', file, `${field} must be a lowercase ID of at most 100 characters.`); return false; }
    return true;
  }
  function textField(value, file, field) {
    if (!nonblank(value)) add('TEXT_REQUIRED', file, `${field} must be nonblank text.`);
  }
  function array(value, file, field, nonempty = false) {
    if (!Array.isArray(value) || value.length > MAX_ENTRIES || (nonempty && value.length === 0)) { add('ARRAY_INVALID', file, `${field} must be ${nonempty ? 'a nonempty' : 'an'} array of at most ${MAX_ENTRIES} entries.`); return false; }
    return true;
  }
  function parse(file, markdown = false) {
    if (!map.has(file)) { add('FILE_MISSING', file, 'Required authored file is missing.'); return null; }
    try { return markdown ? parseMarkdown(map.get(file)) : parseStrictJson(map.get(file)); }
    catch (error) { add(error.code ?? 'PARSE_ERROR', file, error.message); return null; }
  }
  function sources(header, file) {
    if (own(header, 'uncertainty')) textField(header.uncertainty, file, 'uncertainty');
    if (!own(header, 'sources')) return;
    if (!array(header.sources, file, 'sources')) return;
    for (const source of header.sources) {
      const issue = inspectSource(source);
      if (issue) add('SOURCE_INVALID', file, issue);
    }
  }

  const manifest = parse('atlas.json');
  if (!manifest || !fields(manifest, ['format', 'id', 'title', 'trees'], ['format', 'id', 'title', 'trees'], 'atlas.json')) return finishView(root, files, diagnostics, null, incomplete);
  if (manifest.format !== 'atlas/1') add('FORMAT_UNSUPPORTED', 'atlas.json', 'Only atlas/1 is supported.');
  id(manifest.id, 'atlas.json'); textField(manifest.title, 'atlas.json', 'title');
  if (!array(manifest.trees, 'atlas.json', 'trees')) return finishView(root, files, diagnostics, null, incomplete);
  const atlas = { format: 'atlas/1', id: manifest.id, title: manifest.title, trees: [], points: [], branches: [], facets: [], checks: [] };
  const directories = [];
  for (const directory of manifest.trees) {
    if (!relativeRecordPath(directory) || pathKey(directory) === '.checks' || pathKey(directory).startsWith('.checks/') || pathKey(directory) === 'atlas.json') { add('TREE_PATH', 'atlas.json', 'Tree folders must be normalized relative directories outside .checks and reserved .atlas-* paths.'); continue; }
    const key = pathKey(directory);
    if (directories.some(existing => key === pathKey(existing) || key.startsWith(pathKey(existing) + '/') || pathKey(existing).startsWith(key + '/'))) { add('TREE_OVERLAP', 'atlas.json', `Tree directories overlap or alias: ${directory}.`); continue; }
    directories.push(directory);
  }
  const recognized = new Set(['atlas.json']);
  const treeById = new Map(), pointById = new Map(), branchByKey = new Map();
  for (const directory of directories) {
    const file = `${directory}/tree.json`;
    recognized.add(file);
    const tree = parse(file);
    if (!tree || !fields(tree, ['id', 'title', 'scope', 'base', 'children'], ['id', 'title', 'scope', 'base', 'children'], file)) continue;
    id(tree.id, file); id(tree.base, file, 'base'); textField(tree.title, file, 'title'); textField(tree.scope, file, 'scope');
    array(tree.children, file, 'children');
    const record = { ...tree, path: file };
    if (treeById.has(tree.id)) add('TREE_DUPLICATE', file, `Duplicate Tree ID: ${tree.id}.`);
    else treeById.set(tree.id, record);
    atlas.trees.push(record);
    for (const sourcePath of [...map.keys()].sort(compare)) {
      const kind = sourcePath.startsWith(`${directory}/points/`) ? 'point' : sourcePath.startsWith(`${directory}/facets/`) ? 'facet' : null;
      if (!kind) continue;
      recognized.add(sourcePath);
      if (!sourcePath.endsWith('.md')) { add('RECORD_EXTENSION', sourcePath, 'Point and Facet records use .md files.'); continue; }
      const parsed = parse(sourcePath, true);
      if (!parsed) continue;
      const { header, title, body } = parsed;
      const allowed = kind === 'point' ? ['id', 'type', 'status', 'observedAt', 'sources', 'uncertainty'] : ['id', 'on', 'via', 'targets', 'sources', 'uncertainty'];
      if (!fields(header, allowed, kind === 'point' ? ['id'] : ['id', 'on', 'via', 'targets'], sourcePath)) continue;
      id(header.id, sourcePath); sources(header, sourcePath);
      const result = { ...header, tree: tree.id, path: sourcePath, title, body };
      if (kind === 'point') {
        result.ancestors = [];
        if (own(header, 'type') && !['decision', 'observation'].includes(header.type)) add('TYPE_UNSUPPORTED', sourcePath, 'Supported Point Types are decision and observation.');
        if (header.type === 'decision') {
          if (!['open', 'proposed', 'selected', 'rejected', 'superseded'].includes(header.status)) add('DECISION_STATUS', sourcePath, 'A decision requires a supported status.');
        } else if (own(header, 'status')) add('STATUS_TYPE', sourcePath, 'Only a decision may have status.');
        if (header.type === 'observation') {
          if (!validDate(header.observedAt)) add('OBSERVATION_DATE', sourcePath, 'An observation requires a valid ISO calendar date or timestamp.');
          if (!Array.isArray(header.sources) || header.sources.length === 0) add('OBSERVATION_SOURCE', sourcePath, 'An observation requires at least one source.');
        } else if (own(header, 'observedAt')) add('DATE_TYPE', sourcePath, 'Only an observation may have observedAt.');
        if (pointById.has(header.id)) add('POINT_DUPLICATE', sourcePath, `Duplicate Point ID: ${header.id}.`);
        else pointById.set(header.id, result);
        atlas.points.push(result);
      } else atlas.facets.push(result);
    }
  }
  const placements = new Map();
  function placePoint(pointId, tree, ancestors) {
    const point = pointById.get(pointId);
    if (!point) { add('POINT_MISSING', tree.path, `Point does not exist: ${pointId}.`); return; }
    if (point.tree !== tree.id) { add('POINT_OWNER', tree.path, `Point ${pointId} belongs to Tree ${point.tree}, not ${tree.id}.`); return; }
    const count = (placements.get(pointId) ?? 0) + 1;
    placements.set(pointId, count);
    if (count > 1) add('POINT_MULTIPLE_HOME', tree.path, `Point ${pointId} has more than one structural home.`);
    else point.ancestors = ancestors;
  }
  let nodeCount = 0;
  function walk(nodes, tree, ancestors, depth) {
    if (!Array.isArray(nodes)) return;
    if (depth > MAX_DEPTH) { add('OUTLINE_LIMIT', tree.path, `Outline depth exceeds ${MAX_DEPTH}.`); return; }
    for (const node of nodes) {
      if (++nodeCount > MAX_ENTRIES) { if (nodeCount === MAX_ENTRIES + 1) add('OUTLINE_LIMIT', tree.path, `Atlas outline exceeds ${MAX_ENTRIES} placements.`); return; }
      if (!object(node) || own(node, 'point') === own(node, 'branch')) { add('PLACEMENT_KIND', tree.path, 'Each placement contains exactly one point or branch.'); continue; }
      if (own(node, 'point')) {
        fields(node, ['point', 'children'], ['point'], tree.path);
        id(node.point, tree.path, 'point');
        placePoint(node.point, tree, ancestors);
        if (own(node, 'children') && array(node.children, tree.path, 'children')) walk(node.children, tree, [...ancestors, { kind: 'point', id: node.point, tree: tree.id }], depth + 1);
      } else {
        fields(node, ['branch', 'title', 'children'], ['branch', 'title', 'children'], tree.path);
        id(node.branch, tree.path, 'branch'); textField(node.title, tree.path, 'title');
        const key = `${tree.id}/${node.branch}`;
        if (branchByKey.has(key)) add('BRANCH_DUPLICATE', tree.path, `Duplicate Branch ID: ${node.branch}.`);
        else {
          const branch = { id: node.branch, tree: tree.id, title: node.title, ancestors, children: node.children };
          branchByKey.set(key, branch); atlas.branches.push(branch);
        }
        if (array(node.children, tree.path, 'children', true)) walk(node.children, tree, [...ancestors, { kind: 'branch', id: node.branch, tree: tree.id }], depth + 1);
      }
    }
  }
  for (const tree of atlas.trees) {
    placePoint(tree.base, tree, []);
    walk(tree.children, tree, [{ kind: 'point', id: tree.base, tree: tree.id }], 0);
  }
  for (const point of atlas.points) if (!placements.has(point.id)) add('POINT_UNPLACED', point.path, `Point ${point.id} has no structural home in its owning Tree.`);
  function pointer(value, kinds, file, field) {
    if (!object(value) || Object.keys(value).length !== 1 || !kinds.includes(Object.keys(value)[0])) { add('POINTER_INVALID', file, `${field} must contain exactly one ${kinds.join(' or ')} ID.`); return null; }
    const kind = Object.keys(value)[0];
    if (!id(value[kind], file, field)) return null;
    return { kind, id: value[kind] };
  }
  const facetIds = new Set();
  for (const facet of atlas.facets) {
    const key = `${facet.tree}/${facet.id}`;
    if (facetIds.has(key)) add('FACET_DUPLICATE', facet.path, `Duplicate Facet ID: ${facet.id}.`);
    facetIds.add(key);
    id(facet.via, facet.path, 'via');
    if (!treeById.has(facet.via)) add('FACET_TREE', facet.path, `Facet Tree does not exist: ${facet.via}.`);
    if (facet.via === facet.tree) add('FACET_SELF', facet.path, 'A Facet interprets through a different Tree.');
    const host = pointer(facet.on, ['point', 'branch'], facet.path, 'on');
    if (host && (host.kind === 'point' ? pointById.get(host.id)?.tree !== facet.tree : !branchByKey.has(`${facet.tree}/${host.id}`))) add('FACET_HOST', facet.path, 'Facet host must exist in its owning Tree.');
    if (array(facet.targets, facet.path, 'targets', true)) {
      for (const value of facet.targets) {
        const target = pointer(value, ['point', 'branch', 'tree'], facet.path, 'target');
        if (!target) continue;
        const valid = target.kind === 'tree' ? target.id === facet.via && treeById.has(target.id) : target.kind === 'point' ? pointById.get(target.id)?.tree === facet.via : branchByKey.has(`${facet.via}/${target.id}`);
        if (!valid) add('FACET_TARGET', facet.path, 'Every Facet target must exist in its via Tree.');
      }
    }
  }
  const checkIds = new Set();
  for (const file of [...map.keys()].sort(compare)) {
    if (!file.startsWith('.checks/')) continue;
    recognized.add(file);
    if (!file.endsWith('.md')) { add('RECORD_EXTENSION', file, 'Check records use .md files.'); continue; }
    const parsed = parse(file, true);
    if (!parsed) continue;
    const { header, title, body } = parsed;
    if (!fields(header, ['id', 'status', 'level'], ['id', 'status', 'level'], file)) continue;
    id(header.id, file);
    if (checkIds.has(header.id)) add('CHECK_DUPLICATE', file, `Duplicate Check ID: ${header.id}.`);
    checkIds.add(header.id);
    if (!['draft', 'active', 'retired'].includes(header.status)) add('CHECK_STATUS', file, 'Unsupported Check status.');
    if (!['required', 'advisory'].includes(header.level)) add('CHECK_LEVEL', file, 'Unsupported Check level.');
    const sections = markdownSections(body);
    const required = ['Requirement', 'Verification', 'Failure'];
    const expected = [...required, ...(sections.length === 4 ? ['Exceptions'] : [])];
    if (sections.length !== expected.length || sections.some((section, index) => section.title !== expected[index])) add('CHECK_SECTION', file, 'Check sections must be Requirement, Verification, Failure, and optional Exceptions, in that order.');
    for (const section of sections) if (required.includes(section.title) && !section.hasExplanation) add('CHECK_SECTION', file, `The ${section.title} section requires explanatory content.`);
    atlas.checks.push({ ...header, path: file, title, body, revision: sha(map.get(file)) });
  }
  for (const file of map.keys()) if (!recognized.has(file)) add('RECORD_UNEXPECTED', file, 'This file is outside the authored record inventory declared by atlas.json.');
  return finishView(root, files, diagnostics, atlas, incomplete);
}

function signature(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

async function noSymlinkPath(absolute, floor) {
  const relative = path.relative(floor, absolute);
  if (!inside(floor, absolute)) throw Object.assign(new Error('Path leaves its allowed root.'), { code: 'PATH_UNSAFE' });
  let current = floor;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const stat = await fs.lstat(current, { bigint: true });
    if (stat.isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not accepted for this read.'), { code: 'PATH_SYMLINK' });
  }
  const expected = path.resolve(await fs.realpath(floor), relative);
  if (await fs.realpath(absolute) !== expected) throw Object.assign(new Error('Path case or Unicode spelling does not match the filesystem.'), { code: 'PATH_ALIAS' });
}

async function captureFile(absolute, floor, maxBytes) {
  await noSymlinkPath(absolute, floor);
  const real = await fs.realpath(absolute);
  const realFloor = await fs.realpath(floor);
  if (!inside(realFloor, real)) throw Object.assign(new Error('Resolved path leaves its allowed root.'), { code: 'PATH_UNSAFE' });
  const expected = await fs.lstat(real, { bigint: true });
  if (!expected.isFile()) throw Object.assign(new Error('Expected a regular file.'), { code: 'FILE_KIND' });
  if (expected.size > BigInt(maxBytes)) throw Object.assign(new Error(`File exceeds ${maxBytes} bytes.`), { code: 'READ_LIMIT' });
  const handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (signature(expected) !== signature(before)) throw Object.assign(new Error('File changed before capture.'), { code: 'READ_CHANGED' });
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, maxBytes - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw Object.assign(new Error(`File exceeds ${maxBytes} bytes.`), { code: 'READ_LIMIT' });
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    await noSymlinkPath(absolute, floor);
    const final = await fs.lstat(absolute, { bigint: true });
    if (signature(before) !== signature(after) || signature(after) !== signature(final) || await fs.realpath(absolute) !== real) throw Object.assign(new Error('File changed during capture.'), { code: 'READ_CHANGED' });
    const bytes = Buffer.concat(chunks);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return { content: null, rawBase64: bytes.toString('base64'), bytes: bytes.length, signature: signature(final) }; }
    return { content, bytes: bytes.length, signature: signature(final) };
  } finally { await handle.close(); }
}

/** Capture declared authored files. Overrides create a preview and never write. */
export async function openAtlas(root, options = {}) {
  root = path.resolve(root);
  const { maxFileBytes, maxFiles } = optionsBounds(options);
  const captured = new Map(), observed = new Map(), diagnostics = [];
  let incomplete = false, traversed = 0, capturedBytes = 0;
  const add = (code, file, message) => { diagnostics.push(diagnostic(code, file, message)); if (!['PATH_SYMLINK', 'PATH_UNSAFE', 'PATH_ALIAS', 'FILE_UTF8', 'FILE_KIND', 'FILE_MISSING', 'OVERRIDES_INVALID'].includes(code)) incomplete = true; };
  async function take(file) {
    if (captured.has(file)) return;
    if (captured.size >= maxFiles) { add('READ_LIMIT', file, `Authored file count exceeds ${maxFiles}.`); return; }
    try {
      if (capturedBytes >= MAX_TOTAL_BYTES) { add('READ_LIMIT', file, `Captured content exceeds ${MAX_TOTAL_BYTES} bytes.`); return; }
      const result = await captureFile(path.join(root, file), root, Math.min(maxFileBytes, MAX_TOTAL_BYTES - capturedBytes));
      capturedBytes += result.bytes;
      captured.set(file, result.rawBase64 === undefined ? result.content : { rawBase64: result.rawBase64 }); observed.set(file, result.signature);
    } catch (error) { add(error.code === 'ENOENT' ? 'FILE_MISSING' : error.code === 'EACCES' || error.code === 'EPERM' ? 'READ_DENIED' : error.code ?? 'READ_ERROR', file, error.message); }
  }
  async function directory(relative, optional = false, depth = 0) {
    if (depth > MAX_DEPTH) { add('READ_LIMIT', relative, `Directory depth exceeds ${MAX_DEPTH}.`); return; }
    const absolute = path.join(root, relative);
    try {
      await noSymlinkPath(absolute, root);
      const before = await fs.lstat(absolute, { bigint: true });
      if (!before.isDirectory()) { add('FILE_KIND', relative, 'Expected an authored record directory.'); return; }
      observed.set(relative + '/', signature(before));
      const entries = [];
      const handle = await fs.opendir(absolute);
      for await (const entry of handle) {
        if (++traversed > maxFiles * 4) { add('READ_LIMIT', relative, 'Authored directory traversal exceeds its entry bound.'); break; }
        entries.push(entry);
      }
      entries.sort((a, b) => compare(a.name, b.name));
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('.atlas-write-')) continue;
        const file = `${relative}/${entry.name}`;
        if (!relativeRecordPath(file)) { add('PATH_UNSAFE', file, 'Unsafe authored record path.'); continue; }
        if (entry.isSymbolicLink()) add('PATH_SYMLINK', file, 'Symbolic links are not accepted for authored records.');
        else if (entry.isDirectory()) await directory(file, false, depth + 1);
        else await take(file);
      }
    } catch (error) {
      if (!(optional && error.code === 'ENOENT')) add(error.code === 'ENOENT' ? 'FILE_MISSING' : error.code ?? 'READ_ERROR', relative, error.message);
    }
  }
  await take('atlas.json');
  let manifest;
  try {
    const manifestText = options.overrides instanceof Map && options.overrides.has('atlas.json')
      ? options.overrides.get('atlas.json') : captured.get('atlas.json');
    manifest = typeof manifestText === 'string' ? parseStrictJson(manifestText) : null;
  } catch { /* Validation reports syntax. */ }
  if (Array.isArray(manifest?.trees) && manifest.trees.length <= MAX_ENTRIES) {
    const seen = new Set();
    for (const folder of manifest.trees) {
      if (!relativeRecordPath(folder) || pathKey(folder) === '.checks' || pathKey(folder).startsWith('.checks/') || seen.has(folder)) continue;
      seen.add(folder);
      await take(`${folder}/tree.json`);
      await directory(`${folder}/points`, true);
      await directory(`${folder}/facets`, true);
    }
  }
  await directory('.checks', true);
  for (const [file, before] of observed) {
    try {
      const absolute = path.join(root, file);
      await noSymlinkPath(absolute, root);
      if (signature(await fs.lstat(absolute, { bigint: true })) !== before) add('READ_CHANGED', file, 'Authored content changed during this reading observation.');
    } catch { add('READ_CHANGED', file, 'Authored content disappeared or changed during this reading observation.'); }
  }
  if (options.overrides !== undefined) {
    if (!(options.overrides instanceof Map) || options.overrides.size > maxFiles) add('OVERRIDES_INVALID', '', 'Overrides must be a bounded Map of relative paths to text or null.');
    else for (const [file, content] of options.overrides) {
      if (!relativeRecordPath(file) || (content !== null && typeof content !== 'string')) { add('OVERRIDES_INVALID', String(file), 'Override paths and content must be valid authored paths and text or null.'); continue; }
      if (content === null) captured.delete(file); else captured.set(file, content);
    }
  }
  const view = validateFiles(captured, { root, maxFileBytes, maxFiles });
  return finishView(root, view.files, [...diagnostics, ...view.diagnostics], view.atlas, incomplete || view.status === 'incomplete');
}

function accepted(view) { return view?.format === 'atlas.view/1' && view.status === 'ready' && view.atlas; }
function targetMatches(facet, kind, id, tree) {
  return facet.via === tree && facet.targets.some(target => target[kind] === id);
}

export function getPoint(view, id) {
  const atlas = accepted(view);
  if (!atlas) return null;
  const point = atlas.points.find(item => item.id === id);
  if (!point) return null;
  return { ...point, owner: atlas.trees.find(tree => tree.id === point.tree), facets: atlas.facets.filter(facet => facet.tree === point.tree && facet.on.point === point.id), incomingFacets: atlas.facets.filter(facet => targetMatches(facet, 'point', id, point.tree)), sources: point.sources ?? [] };
}

export function getTree(view, id) {
  const atlas = accepted(view);
  if (!atlas) return null;
  const tree = atlas.trees.find(item => item.id === id);
  if (!tree) return null;
  return { ...tree, points: atlas.points.filter(point => point.tree === id), branches: atlas.branches.filter(branch => branch.tree === id), facets: atlas.facets.filter(facet => facet.tree === id), incomingFacets: atlas.facets.filter(facet => facet.via === id) };
}

export function getFacet(view, target) {
  const atlas = accepted(view);
  if (!atlas || !target) return null;
  const facet = atlas.facets.find(item => item.id === target.id && item.tree === target.tree);
  if (!facet) return null;
  const resolve = (pointer, tree) => pointer.point ? atlas.points.find(point => point.id === pointer.point && point.tree === tree) : pointer.branch ? atlas.branches.find(branch => branch.id === pointer.branch && branch.tree === tree) : atlas.trees.find(item => item.id === pointer.tree);
  return { ...facet, owner: atlas.trees.find(tree => tree.id === facet.tree), host: resolve(facet.on, facet.tree), viaTree: atlas.trees.find(tree => tree.id === facet.via), resolvedTargets: facet.targets.map(target => resolve(target, facet.via)), sources: facet.sources ?? [] };
}

export function searchAtlas(view, { query, tree, type, limit = 20 } = {}) {
  if (!accepted(view) || typeof query !== 'string' || query.length > 4096 || !query.trim()) return [];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Search limit must be 1..100.');
  const terms = [...new Set(query.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu) ?? [])].slice(0, 64);
  const results = [];
  for (const point of view.atlas.points) {
    if ((tree && point.tree !== tree) || (type && (type === 'untyped' ? point.type !== undefined : point.type !== type))) continue;
    const fields = { id: point.id, title: point.title, body: point.body, uncertainty: point.uncertainty ?? '' };
    const matches = Object.entries(fields).flatMap(([field, value]) => terms.filter(term => value.toLocaleLowerCase('en').includes(term)).map(term => ({ field, term })));
    if (!matches.length) continue;
    const score = matches.reduce((total, match) => total + ({ id: 8, title: 4, body: 1, uncertainty: 1 })[match.field], 0);
    results.push({ ...point, score, matches, reason: 'Lexical matches are candidates, not an identity or relevance judgment.' });
  }
  return results.sort((a, b) => b.score - a.score || compare(a.id, b.id)).slice(0, limit);
}

export function compareViews(before, after) {
  const oldFiles = new Map(before.files.map(file => [file.path, file.sha256]));
  const newFiles = new Map(after.files.map(file => [file.path, file.sha256]));
  return {
    same: before.identity === after.identity,
    before: before.identity, after: after.identity,
    added: [...newFiles.keys()].filter(file => !oldFiles.has(file)).sort(compare),
    removed: [...oldFiles.keys()].filter(file => !newFiles.has(file)).sort(compare),
    changed: [...newFiles.keys()].filter(file => oldFiles.has(file) && oldFiles.get(file) !== newFiles.get(file)).sort(compare),
  };
}

/** Source reads are separate, permission-bounded observations; URLs are never fetched. */
export async function readSource(view, source, { allowedRoots, maxBytes = DEFAULT_BYTES } = {}) {
  const issue = inspectSource(source);
  if (issue) return { status: 'invalid', source, code: 'SOURCE_INVALID', message: issue };
  source = structuredClone(source);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) return { status: 'invalid', source, code: 'READ_LIMIT', message: 'maxBytes must be 1..67108864.' };
  if (/^https?:\/\//i.test(source.uri)) return { status: 'reference', source, message: 'External URL retained as a reference; no network access occurred.' };
  if (!view || typeof view.root !== 'string') return { status: 'invalid', source, code: 'VIEW_INVALID', message: 'A captured view with a root is required.' };
  const roots = allowedRoots ?? [view.root];
  if (!Array.isArray(roots) || roots.length > 100 || roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) return { status: 'invalid', source, code: 'ROOTS_INVALID', message: 'Source grants must be an array of absolute directory paths.' };
  const capturedRoots = [...roots];
  const capturedRoot = view.root;
  try {
    const actualRoot = await fs.realpath(capturedRoot);
    const local = decodeURIComponent(source.uri.split('#')[0]);
    if (local.split('/').some(part => pathKey(part).startsWith('.atlas-'))) return { status: 'denied', source, code: 'SOURCE_RESERVED', message: 'Reserved Atlas state is not source material.' };
    const absolute = path.resolve(actualRoot, local);
    if (await isPrivateStatePath(absolute)) return { status: 'denied', source, code: 'SOURCE_RESERVED', message: 'Private Atlas state is not source material.' };
    const canonicalRoots = [];
    for (const root of capturedRoots) {
      try {
        const canonical = await fs.realpath(root);
        if ((await fs.stat(canonical)).isDirectory()) canonicalRoots.push(canonical);
      } catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
    }
    const permitted = canonicalRoots.filter(root => inside(root, absolute)).sort((a, b) => b.length - a.length);
    if (!permitted.length) return { status: 'denied', source, code: 'SOURCE_DENIED', message: 'Source path is outside the caller-supplied roots.' };
    const result = await captureFile(absolute, permitted[0], maxBytes);
    if (result.content === null) return { status: 'invalid', source, code: 'FILE_UTF8', message: 'Source is not valid UTF-8 text.' };
    const actual = sha(result.content);
    if (source.sha256 && source.sha256 !== actual) return { status: 'invalid', source, path: absolute, code: 'SOURCE_HASH', message: 'Source bytes do not match the declared SHA-256.' };
    return { status: 'ready', source, path: absolute, content: result.content, bytes: Buffer.byteLength(result.content), sha256: actual, message: 'A separate local reading observation; source content is not part of the authored view identity.' };
  } catch (error) {
    const status = error.code === 'ENOENT' ? 'missing' : ['PATH_UNSAFE', 'PATH_SYMLINK', 'EACCES', 'EPERM'].includes(error.code) ? 'denied' : error.code === 'READ_LIMIT' || error.code === 'READ_CHANGED' ? 'incomplete' : 'invalid';
    return { status, source, code: error.code ?? 'READ_ERROR', message: error.message };
  }
}
