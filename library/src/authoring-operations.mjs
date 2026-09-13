import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AtlasToolError } from './view.mjs';
import { parseFrontMatter, parseJsonObject } from './frontmatter.mjs';
import { digest } from './source-inventory.mjs';
import { compareCodePoints } from './model.mjs';
import { parseMarkdown } from './markdown.mjs';
import { deriveDocumentMeaning } from './markdown-meaning.mjs';
import { validators } from './schemas.mjs';

export const authoringError = (code, message) => new AtlasToolError(`atlas.authoring.${code}`, message);
export function requireAuthoring(condition, message) {
  if (!condition) throw authoringError('invalid-operation', message);
}
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function exactRelative(value, root = false) {
  return typeof value === 'string' && (root && value === '.' || value.length > 0 && !path.isAbsolute(value)
    && !/[\\\u0000-\u001f]/u.test(value) && value.split('/').every((part) => !['', '.', '..'].includes(part)));
}
const identifier = (value) => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value);
const clone = (value) => structuredClone(value);

function document(bytes, file) {
  let text;
  try { text = new TextDecoder('utf8', { fatal: true }).decode(bytes); }
  catch { throw authoringError('repair-required', `Document ${file} is not UTF-8; use raw repair.`); }
  const parsed = parseFrontMatter(text);
  requireAuthoring(!parsed.error && !parsed.errors.length && object(parsed.value), `Document ${file} needs raw repair before a structured edit.`);
  const lines = [...text.matchAll(/^---\r?$/gmu)];
  const closing = lines[1];
  requireAuthoring(closing !== undefined, `Document ${file} has no closing delimiter.`);
  const end = closing.index + closing[0].length;
  const body = text.slice(end + (text.slice(end, end + 2) === '\r\n' ? 2 : text[end] === '\n' ? 1 : 0));
  return { value: parsed.value, body, eol: text.startsWith('---\r\n') ? '\r\n' : '\n' };
}

function key(value) {
  if (!object(value)) return undefined;
  if (typeof value.area === 'string') return `area:${value.area}`;
  if (typeof value.point === 'string' && typeof value.type === 'string') return `relation:${value.type}\0${value.point}`;
  if (typeof value.resource === 'string' || typeof value.uri === 'string') return JSON.stringify([value.role, value.resource, value.selector, value.uri]);
  if (typeof value.id === 'string' && typeof value.map === 'string') return `area-registration:${value.map}\0${value.id}`;
  if (typeof value.id === 'string') return `id:${value.id}`;
  if (typeof value.point === 'string') return `point:${value.point}`;
  if (typeof value.check === 'string') return `check:${value.check}`;
  if (object(value.owner)) return `owner:${JSON.stringify(Object.fromEntries(Object.keys(value.owner).sort().map(key => [key, value.owner[key]])))}`;
  if (typeof value.title === 'string' && Array.isArray(value.maps)) return `navigation:${value.title}`;
  return undefined;
}

// Preserve omitted authored details on an explicitly retained collection entry.
function merge(before, supplied) {
  if (Array.isArray(supplied)) {
    const old = Array.isArray(before) ? before : [];
    return supplied.map((item) => {
      const selected = key(item);
      const previous = selected === undefined ? undefined : old.find((candidate) => key(candidate) === selected);
      return merge(previous, item);
    });
  }
  if (object(supplied)) {
    const result = object(before) ? clone(before) : {};
    for (const [name, value] of Object.entries(supplied)) Object.defineProperty(result, name, { value: merge(result[name], value), enumerable: true, writable: true, configurable: true });
    return result;
  }
  return clone(supplied);
}

function preserveExtensions(before, after, prefix = '') {
  if (Array.isArray(before)) {
    for (const [index, value] of before.entries()) {
      const selected = key(value);
      const next = Array.isArray(after) ? selected === undefined ? after[index] : after.find((item) => key(item) === selected) : undefined;
      preserveExtensions(value, next, `${prefix}/${index}`);
    }
  } else if (object(before)) {
    for (const [name, value] of Object.entries(before)) {
      const current = `${prefix}/${name.replace(/~/gu, '~0').replace(/\//gu, '~1')}`;
      if (name.startsWith('x-')) requireAuthoring(object(after) && Object.hasOwn(after, name), `Removing extension ${current} requires explicit unset.`);
      preserveExtensions(value, object(after) ? after[name] : undefined, current);
    }
  }
}
function pointerParts(value) {
  requireAuthoring(typeof value === 'string' && value.length > 0, 'unset entries must be field names or JSON pointers.');
  if (!value.startsWith('/')) return [value];
  requireAuthoring(!/~(?:[^01]|$)/u.test(value), 'Invalid JSON pointer escape.');
  return value.slice(1).split('/').map((part) => part.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}
function remove(value, parts) {
  let current = value;
  for (const part of parts.slice(0, -1)) {
    requireAuthoring(current && typeof current === 'object' && Object.hasOwn(current, part), 'unset pointer does not resolve.');
    current = current[part];
  }
  const last = parts.at(-1);
  if (Array.isArray(current)) {
    requireAuthoring(/^(?:0|[1-9][0-9]*)$/u.test(last) && Number(last) < current.length, 'unset array index does not resolve.');
    current.splice(Number(last), 1);
  } else { requireAuthoring(object(current), 'unset parent must be an object.'); delete current[last]; }
}
function applyFields(before, operation, reserved = ['type', 'id', 'record', 'format']) {
  requireAuthoring(operation.set === undefined || object(operation.set), 'set must be an object.');
  requireAuthoring(operation.unset === undefined || Array.isArray(operation.unset), 'unset must be an array.');
  for (const field of Object.keys(operation.set ?? {})) requireAuthoring(!reserved.includes(field), `Identity field ${field} cannot be set.`);
  const removals = (operation.unset ?? []).map(pointerParts);
  for (const parts of removals) requireAuthoring(!reserved.includes(parts[0]), `Identity field ${parts[0]} cannot be removed.`);
  const retained = clone(before);
  for (const parts of removals) remove(retained, parts);
  const after = merge(retained, operation.set ?? {});
  preserveExtensions(retained, after);
  return after;
}

function connectionExplanation(body, id, explanation, eol) {
  const label = `Connection: ${id}`;
  const lines = body.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const headings = parseMarkdown(body).flatMap((token, index, tokens) => token.type === 'heading_open' && token.level === 0
    ? [{ level: Number(token.tag.slice(1)), label: tokens[index + 1]?.content, start: token.map[0], end: token.map[1] }] : []);
  const selected = headings.filter((heading) => heading.level === 2 && heading.label === label);
  requireAuthoring(selected.length <= 1, `Connection ${id} has duplicate Markdown explanations; use body editing or raw repair.`);
  const heading = selected[0];
  const text = explanation.trim().replace(/\r?\n/gu, eol);
  if (!heading) return `${body}${body && !body.endsWith('\n') ? eol : ''}${eol}## ${label}${eol}${eol}${text}${eol}`;
  const end = headings.find((candidate) => candidate.start > heading.start && candidate.level <= 2)?.start ?? lines.length;
  if (lines.slice(heading.end, end).join('').trim() === text) return body;
  return `${lines.slice(0, heading.end).join('')}${eol}${text}${eol}${end < lines.length ? eol : ''}${lines.slice(end).join('')}`;
}

export function transformDocuments(files, operations) {
  requireAuthoring(Array.isArray(operations) && operations.length > 0, 'At least one authoring operation is required.');
  const original = new Map([...files].map(([file, bytes]) => [file, Buffer.from(bytes)]));
  const working = new Map([...original].map(([file, bytes]) => [file, Buffer.from(bytes)]));
  const decisions = [], subjects = [], adoptedChecks = [], gaps = [];
  const touched = new Set(), generatedIds = new Set();
  function addSubject(type, id, file, extra = {}) { subjects.push({ type, id, path: file, ...extra }); }
  function read(file) {
    requireAuthoring(working.has(file), `Missing structural document ${file}.`);
    return assemble(file, document(working.get(file), file));
  }
  function records(type, id) {
    return [...working].flatMap(([file, bytes]) => {
      if (!file.endsWith('.md')) return [];
      try { const parsed = document(bytes, file); return parsed.value.type === type && (id === undefined || parsed.value.id === id) ? [{ file, ...assemble(file, parsed) }] : []; }
      catch { return []; }
    });
  }
  function one(type, id, predicate = () => true) {
    const found = records(type, id).filter((item) => item.value.id === id && predicate(item));
    requireAuthoring(found.length === 1, `Expected exactly one ${type} ${id}; inspect or repair identity before editing.`);
    return found[0];
  }
  function map(id) { return one('map', id, (item) => path.posix.basename(item.file) === 'map.md'); }
  function mapOf(file) {
    const containing = path.posix.dirname(path.posix.dirname(file));
    return records('map').find((item) => path.posix.dirname(item.file) === containing);
  }
  function anchor(id) { return one('point', id, (item) => item.value.record === 'anchor'); }
  function decision(id, record, mapRecord, existingAnchor) {
    decisions.push({ pointId: id, record, mapId: mapRecord.value.id, mapQuestion: validators.map(document(working.get(mapRecord.file), mapRecord.file).value) ? deriveDocumentMeaning(mapRecord.value, mapRecord.body).value.question : undefined,
      anchor: existingAnchor ? { path: existingAnchor.file, mapId: mapOf(existingAnchor.file)?.value.id,
        sha256: digest(original.get(existingAnchor.file) ?? working.get(existingAnchor.file)), origin: original.has(existingAnchor.file) ? 'baseline' : 'proposal' } : null });
  }
  function write(file, value, body, eol = '\n') {
    const before = working.has(file) ? document(working.get(file), file) : null;
    const local = partition(file, value);
    if (before && isDeepStrictEqual(before.value, local) && before.body === body) return;
    const header = JSON.stringify(local, null, 2).replace(/\n/gu, eol);
    working.set(file, Buffer.from(`---${eol}${header}${eol}---${eol}${body}`));
    touched.add(file);
  }
  function edit(file, operation) {
    const before = read(file);
    requireAuthoring(operation.body === undefined || typeof operation.body === 'string', 'body must be a string.');
    write(file, applyFields(before.value, operation), operation.body ?? before.body, before.eol);
  }
  function action(operation) { requireAuthoring(['create', 'update'].includes(operation.action), 'Explicit create or update action is required.'); }
  function structural(file) {
    return ['atlas.md', 'catalog.json', 'connections.json'].includes(file) || path.posix.basename(file) === 'map.md' || /(?:^|\/)points\/[^/]+\.md$/u.test(file)
      || /^\.(?:checks|publication)\/[^/]+\.md$/u.test(file);
  }
  function global(file) {
    requireAuthoring(working.has(file), `Missing ${file}; repair the authored collection before a structured edit.`);
    const bytes = working.get(file);
    let source, parsed;
    try {
      if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error('Unexpected byte-order mark.');
      source = new TextDecoder('utf8', { fatal: true }).decode(bytes);
      if (source.includes('\0')) throw new Error('Unexpected NUL.');
      parsed = parseJsonObject(source);
      if (parsed.errors.length || !object(parsed.value)) throw new Error('Invalid JSON object.');
    } catch { throw authoringError('repair-required', `${file} needs raw repair before structured editing.`); }
    requireAuthoring(validators[file === 'catalog.json' ? 'catalog' : 'connections'](parsed.value), `${file} needs raw repair before structured editing.`);
    uniqueGlobal(file, parsed.value);
    return parsed.value;
  }
  function uniqueGlobal(file, value) {
    const seen = new Set(), ownerKey = owner => JSON.stringify(Object.fromEntries(Object.keys(owner).sort().map(key => [key, owner[key]])));
    const check = key => { if (seen.has(key)) throw authoringError('repair-required', `${file} contains ambiguous repeated declarations; use raw repair.`); seen.add(key); };
    if (file === 'catalog.json') {
      for (const item of value.resources ?? []) check(`resource:${item.id}`);
      for (const item of value.areas ?? []) check(`area:${item.map}\0${item.id}`);
      for (const item of value.points ?? []) check(`point:${item.point}`);
      for (const item of value.checks ?? []) check(`check:${item.check}`);
      for (const item of value.extensions ?? []) check(`extensions:${ownerKey(item.owner)}`);
    } else {
      for (const field of ['memberships', 'relations', 'content', 'references']) for (const item of value[field] ?? []) {
        check(`id:${item.id}`);
        if (field === 'memberships') check(`membership:${item.point}\0${item.map}\0${item.area}`);
        else if (field === 'relations') check(`relation:${item.source}\0${item.type}\0${item.target}`);
        else check(`${field}:${ownerKey(item.owner)}\0${JSON.stringify([item.role, item.target.resource, item.target.uri, item.target.selector])}`);
      }
    }
  }
  function writeGlobal(file, value) {
    if (working.has(file) && isDeepStrictEqual(global(file), value)) return;
    const eol = working.get(file)?.toString('utf8').includes('\r\n') ? '\r\n' : '\n';
    working.set(file, Buffer.from(`${JSON.stringify(value, null, 2).replace(/\n/gu, eol)}${eol}`)); touched.add(file);
  }
  function sameOwner(a, b) { return a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(name => a[name] === b[name]); }
  function owner(file, value) {
    if (value.type === 'atlas') return { type: 'atlas' };
    if (value.type === 'map') return { type: 'map', map: value.id };
    if (value.type === 'check') return { type: 'check', check: value.id };
    if (value.type === 'point') {
      const directory = path.posix.dirname(path.posix.dirname(file));
      const found = [...working].flatMap(([name, bytes]) => {
        if (path.posix.dirname(name) !== directory || path.posix.basename(name) !== 'map.md') return [];
        try { const item = document(bytes, name).value; return item.type === 'map' ? [item] : []; } catch { return []; }
      });
      requireAuthoring(found.length === 1, `Point ${value.id} needs an exact containing Map identity.`);
      return { type: 'point', point: value.id, map: found[0].id };
    }
    return null;
  }
  function material(value, selectedOwner, connections) {
    for (const field of ['content', 'references']) {
      const selected = (connections[field] ?? []).filter(item => sameOwner(item.owner, selectedOwner));
      if (selected.length) value[field] = selected.map(({ id, target, role, owner: omitted, ...extensions }) => ({ id, ...clone(target), ...(role === undefined ? {} : { role }) }));
    }
  }
  function assemble(file, parsed) {
    if (!working.has('catalog.json') || !working.has('connections.json') || parsed.value.type === 'publication') return parsed;
    let catalog, connections;
    try { catalog = global('catalog.json'); connections = global('connections.json'); } catch { return parsed; }
    const value = clone(parsed.value), selectedOwner = owner(file, value);
    if (!selectedOwner) return parsed;
    Object.assign(value, clone((catalog.extensions ?? []).find(item => sameOwner(item.owner, selectedOwner))?.values ?? {}));
    if (value.type === 'atlas') {
      if (catalog.navigation !== undefined) value.navigation = clone(catalog.navigation);
      if (catalog.resources !== undefined) value.resources = clone(catalog.resources);
    }
    if (value.type === 'map') {
      const areas = (catalog.areas ?? []).filter(item => item.map === value.id).map(({ map: omitted, ...area }) => {
        const result = clone(area); material(result, { type: 'area', map: value.id, area: area.id }, connections); return result;
      });
      if (areas.length) value.areas = areas;
    }
    if (value.type === 'point') {
      if (value.record === 'anchor') {
        const metadata = (catalog.points ?? []).find(item => item.point === value.id);
        if (metadata) for (const field of ['kinds', 'review']) if (metadata[field] !== undefined) value[field] = clone(metadata[field]);
        const relations = (connections.relations ?? []).filter(item => item.source === value.id);
        if (relations.length) value.relations = relations.map(({ source: omitted, target, ...entry }) => ({ ...clone(entry), point: target }));
      }
      const memberships = (connections.memberships ?? []).filter(item => item.point === value.id && item.map === selectedOwner.map);
      if (memberships.length) value.areas = memberships.map(({ point: ignored, map: omitted, ...item }) => clone(item));
    }
    if (value.type === 'check') {
      const registration = (catalog.checks ?? []).find(item => item.check === value.id);
      if (registration) for (const field of ['level', 'applies-to']) if (registration[field] !== undefined) value[field] = clone(registration[field]);
    }
    material(value, selectedOwner, connections);
    return { ...parsed, value };
  }
  function connectionId(kind, parts, connections = global('connections.json')) {
    const base = [kind, ...parts].join('-').toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || kind;
    const used = new Set(['memberships', 'relations', 'content', 'references'].flatMap(field => (connections[field] ?? []).map(item => item.id)));
    let id = base, suffix = 2;
    while (used.has(id) || generatedIds.has(id)) id = `${base}-${suffix++}`;
    generatedIds.add(id); return id;
  }
  function replaceScoped(container, field, predicate, entries) {
    const old = container[field] ?? [], selected = old.filter(predicate);
    if (isDeepStrictEqual(selected, entries)) return;
    const next = [], pending = [...entries], last = old.findLastIndex(predicate);
    for (const [index, item] of old.entries()) {
      if (predicate(item)) { if (pending.length) next.push(pending.shift()); }
      else next.push(item);
      if (index === last) next.push(...pending.splice(0));
    }
    if (last < 0) next.push(...pending);
    if (next.length || Object.hasOwn(container, field)) container[field] = next;
  }
  function partition(file, input) {
    if (input.type === 'publication') return input;
    const value = clone(input), selectedOwner = owner(file, value);
    if (!selectedOwner) return value;
    const catalog = global('catalog.json'), connections = global('connections.json');
    const extensions = Object.fromEntries(Object.entries(value).filter(([name]) => name.startsWith('x-')));
    replaceScoped(catalog, 'extensions', item => sameOwner(item.owner, selectedOwner), Object.keys(extensions).length ? [{ owner: selectedOwner, values: extensions }] : []);
    for (const name of Object.keys(extensions)) delete value[name];
    const associate = (field, entries, selected) => {
      const previous = (connections[field] ?? []).filter(item => sameOwner(item.owner, selected));
      const next = (entries ?? []).map(entry => {
        const { id: supplied, role, ...target } = entry;
        const previousEntry = previous.find(item => key({ ...item.target, ...(item.role ? { role: item.role } : {}) }) === key(entry));
        const id = supplied ?? previousEntry?.id ?? connectionId(field === 'references' ? 'reference' : 'content', [selected.type, selected.map ?? '', selected.point ?? selected.area ?? '', role ?? '', target.resource ?? target.uri], connections);
        return { ...previousEntry, id, owner: selected, target, ...(field === 'references' ? { role } : {}) };
      });
      replaceScoped(connections, field, item => sameOwner(item.owner, selected), next);
    };
    for (const field of ['content', 'references']) { associate(field, value[field], selectedOwner); delete value[field]; }
    if (value.type === 'atlas') {
      for (const field of ['navigation', 'resources']) { if (value[field] === undefined) delete catalog[field]; else catalog[field] = value[field]; delete value[field]; }
    }
    if (value.type === 'map') {
      const previousAreas = (catalog.areas ?? []).filter(item => item.map === value.id);
      const areas = (value.areas ?? []).map(area => {
        const copy = clone(area), areaOwner = { type: 'area', map: value.id, area: area.id };
        for (const field of ['content', 'references']) { associate(field, area[field], areaOwner); delete copy[field]; }
        return { map: value.id, ...copy };
      });
      for (const area of previousAreas.filter(item => !areas.some(next => next.id === item.id))) for (const field of ['content', 'references']) associate(field, [], { type: 'area', map: value.id, area: area.id });
      replaceScoped(catalog, 'areas', item => item.map === value.id, areas); delete value.areas;
    }
    if (value.type === 'point') {
      if (value.record === 'anchor') {
        const metadata = { ...(catalog.points ?? []).find(item => item.point === value.id), point: value.id };
        delete metadata.kinds; delete metadata.review;
        for (const field of ['kinds', 'review']) { if (value[field] !== undefined) metadata[field] = value[field]; delete value[field]; }
        replaceScoped(catalog, 'points', item => item.point === value.id, Object.keys(metadata).length > 1 ? [metadata] : []);
      }
      const priorMemberships = (connections.memberships ?? []).filter(item => item.point === value.id && item.map === selectedOwner.map);
      const memberships = (value.areas ?? []).map(entry => ({ id: entry.id ?? priorMemberships.find(item => item.area === entry.area)?.id ?? connectionId('membership', [value.id, selectedOwner.map, entry.area], connections), point: value.id, map: selectedOwner.map, ...entry }));
      replaceScoped(connections, 'memberships', item => item.point === value.id && item.map === selectedOwner.map, memberships); delete value.areas;
      if (value.record === 'anchor') {
        const previous = (connections.relations ?? []).filter(item => item.source === value.id);
        const relations = (value.relations ?? []).map(({ point: target, ...entry }) => ({ id: entry.id ?? previous.find(item => item.type === entry.type && item.target === target)?.id ?? connectionId('relation', [value.id, entry.type, target], connections), source: value.id, target, ...entry }));
        replaceScoped(connections, 'relations', item => item.source === value.id, relations); delete value.relations;
      }
    }
    if (value.type === 'check') {
      const registration = { ...(catalog.checks ?? []).find(item => item.check === value.id), check: value.id };
      delete registration.level; delete registration['applies-to'];
      for (const field of ['level', 'applies-to']) { if (value[field] !== undefined) registration[field] = value[field]; delete value[field]; }
      replaceScoped(catalog, 'checks', item => item.check === value.id, Object.keys(registration).length > 1 ? [registration] : []);
    }
    writeGlobal('catalog.json', catalog); writeGlobal('connections.json', connections);
    return value;
  }
  function connectionOwner(entry, collection) {
    if (collection === 'relations') return anchor(entry.source);
    if (collection === 'memberships') return one('point', entry.point, item => mapOf(item.file)?.value.id === entry.map);
    const selected = entry.owner;
    if (selected?.type === 'atlas') return { file: 'atlas.md', ...read('atlas.md') };
    if (selected?.type === 'map' || selected?.type === 'area') return map(selected.map);
    if (selected?.type === 'point') return one('point', selected.point, item => mapOf(item.file)?.value.id === selected.map);
    throw authoringError('invalid-operation', 'A connection needs an exact declared owner.');
  }
  for (const operation of operations) {
    requireAuthoring(object(operation) && typeof operation.type === 'string', 'An operation object and type are required.');
    const allowed = { initialize: ['fields', 'body'], map: ['action', 'id', 'directory', 'set', 'unset', 'body'], area: ['action', 'id', 'mapId', 'set', 'unset', 'body'], point: ['action', 'id', 'mapId', 'record', 'set', 'unset', 'body'], resource: ['action', 'id', 'set', 'unset', 'body'], supersede: ['sourceId', 'targetId', 'note'], 'adopt-check': ['id', 'text', 'registration', 'source'], publication: ['action', 'id', 'text'], catalog: ['set', 'unset'], connection: ['action', 'id', 'collection', 'set', 'unset', 'body'], 'repair-document': ['path', 'text'] }[operation.type];
    requireAuthoring(allowed && Object.keys(operation).every((field) => field === 'type' || allowed.includes(field)), 'Unsupported operation type or fields.');
    requireAuthoring(operation.body === undefined || typeof operation.body === 'string', 'body must be a string.');
    if (!['initialize', 'supersede', 'repair-document', 'catalog'].includes(operation.type)) requireAuthoring(identifier(operation.id), 'An exact valid id is required.');
    switch (operation.type) {
      case 'initialize': {
        requireAuthoring(!working.has('atlas.md') && object(operation.fields), 'Initialization requires an absent atlas.md and fields.');
        requireAuthoring(!Object.hasOwn(operation.fields, 'type') && !Object.hasOwn(operation.fields, 'format'), 'Initialization supplies type and format.');
        requireAuthoring(operation.body === undefined || typeof operation.body === 'string', 'body must be a string.');
        requireAuthoring(!working.has('catalog.json') && !working.has('connections.json'), 'Initialization requires absent global files.');
        writeGlobal('catalog.json', {}); writeGlobal('connections.json', {});
        write('atlas.md', { type: 'atlas', format: 2, ...clone(operation.fields) }, operation.body ?? '');
        addSubject('atlas', operation.fields.id, 'atlas.md'); break;
      }
      case 'map': {
        action(operation);
        if (operation.action === 'create') {
          requireAuthoring(records('map', operation.id).length === 0, `Map ${operation.id} already exists.`);
          requireAuthoring(exactRelative(operation.directory), 'A new Map requires an exact descendant directory.');
          const file = `${operation.directory}/map.md`;
          requireAuthoring(!working.has(file), `Map destination ${file} exists.`);
          write(file, applyFields({ type: 'map', id: operation.id }, operation), operation.body ?? '');
          addSubject('map', operation.id, file);
        } else {
          requireAuthoring(operation.directory === undefined, 'A Map update cannot select a new directory.');
          const selected = map(operation.id); edit(selected.file, operation); addSubject('map', operation.id, selected.file);
        }
        break;
      }
      case 'area': case 'resource': {
        action(operation);
        const selected = operation.type === 'area' ? map(operation.mapId) : { file: 'atlas.md', ...read('atlas.md') };
        const field = operation.type === 'area' ? 'areas' : 'resources';
        const list = clone(selected.value[field] ?? []), index = list.findIndex((item) => item.id === operation.id);
        requireAuthoring(operation.action === 'create' ? index < 0 : index >= 0, `${operation.type} ${operation.id} does not match its create/update action.`);
        const item = applyFields(index < 0 ? { id: operation.id } : list[index], operation);
        if (index < 0) list.push(item); else list[index] = item;
        write(selected.file, { ...selected.value, [field]: list }, operation.body ?? selected.body, selected.eol);
        addSubject(operation.type, operation.id, selected.file, operation.type === 'area' ? { mapId: operation.mapId } : {}); break;
      }
      case 'point': {
        action(operation);
        requireAuthoring(['anchor', 'context'].includes(operation.record), 'An exact Point record kind is required.');
        const selectedMap = map(operation.mapId);
        const existing = records('point', operation.id);
        const currentRecord = existing.filter(item => mapOf(item.file)?.value.id === operation.mapId);
        requireAuthoring(currentRecord.length <= 1, 'Point record identity is ambiguous in the selected Map.');
        const file = operation.action === 'update' && currentRecord.length ? currentRecord[0].file : `${path.posix.dirname(selectedMap.file)}/points/${operation.id}.md`;
        let existingAnchor = existing.length ? anchor(operation.id) : null;
        if (operation.action === 'create') {
          requireAuthoring(!working.has(file), `Point destination ${file} already exists.`);
          requireAuthoring(operation.record === 'anchor' ? existing.length === 0 : existingAnchor !== null && mapOf(existingAnchor.file)?.value.id !== operation.mapId,
            'A new anchor requires a new exact identity; a context requires an existing anchor in another Map.');
          decision(operation.id, operation.record, selectedMap, existingAnchor);
          write(file, applyFields({ type: 'point', record: operation.record, id: operation.id }, operation), operation.body ?? '');
        } else {
          const selected = read(file);
          requireAuthoring(selected.value.type === 'point' && selected.value.id === operation.id && selected.value.record === operation.record, 'Point update cannot change identity or record kind.');
          requireAuthoring(existingAnchor !== null, 'Existing Point identity requires anchor provenance.');
          decision(operation.id, operation.record, selectedMap, existingAnchor); edit(file, operation);
        }
        addSubject(`point-${operation.record}`, operation.id, file, { mapId: operation.mapId }); break;
      }
      case 'supersede': {
        requireAuthoring(identifier(operation.sourceId) && identifier(operation.targetId) && operation.sourceId !== operation.targetId
          && typeof operation.note === 'string' && operation.note.trim(), 'Supersession requires distinct exact ids and a nonblank note.');
        const source = anchor(operation.sourceId), target = anchor(operation.targetId);
        const relations = clone(source.value.relations ?? []);
        const index = relations.findIndex((item) => item.type === 'supersedes' && item.point === operation.targetId);
        const edge = { ...(index < 0 ? { id: connectionId('relation', [operation.sourceId, 'supersedes', operation.targetId]) } : relations[index]), type: 'supersedes', point: operation.targetId };
        if (index < 0) relations.push(edge); else relations[index] = edge;
        decision(operation.sourceId, 'anchor', mapOf(source.file), source); decision(operation.targetId, 'anchor', mapOf(target.file), target);
        write(source.file, { ...source.value, relations }, connectionExplanation(source.body, edge.id, operation.note, source.eol), source.eol);
        write(target.file, { ...target.value, lifecycle: 'superseded' }, target.body, target.eol);
        addSubject('point-anchor', operation.sourceId, source.file); addSubject('point-anchor', operation.targetId, target.file); break;
      }
      case 'adopt-check': {
        requireAuthoring(typeof operation.text === 'string' && object(operation.source) && typeof operation.source.uri === 'string' && operation.source.uri.trim(), 'Check adoption requires complete text and source attribution.');
        requireAuthoring(object(operation.registration) && operation.registration.check === operation.id, 'Check adoption requires the exact separately supplied publisher registration.');
        const existingCheck = records('check', operation.id);
        requireAuthoring(existingCheck.length <= 1, 'Check identity is ambiguous.');
        const bytes = Buffer.from(operation.text), file = existingCheck[0]?.file ?? `.checks/${operation.id}.md`, parsed = document(bytes, file);
        requireAuthoring(parsed.value.type === 'check' && parsed.value.id === operation.id, 'Adopted Check identity must match its destination.');
        requireAuthoring(operation.source.sha256 === undefined || operation.source.sha256 === digest(bytes), 'Supplied Check source hash does not match.');
        requireAuthoring(!working.has(file) || working.get(file).equals(bytes), 'Adoption cannot overwrite a different local Check; use explicit raw repair.');
        if (!working.has(file)) { working.set(file, bytes); touched.add(file); }
        const catalog = global('catalog.json');
        const previous = (catalog.checks ?? []).find(item => item.check === operation.id);
        requireAuthoring(!previous || isDeepStrictEqual(previous, operation.registration), 'Adoption cannot overwrite a different Check registration; use explicit catalog editing.');
        if (!previous) { catalog.checks = [...(catalog.checks ?? []), clone(operation.registration)]; writeGlobal('catalog.json', catalog); }
        adoptedChecks.push({ id: operation.id, path: file, source: clone(operation.source), sha256: digest(bytes), registration: clone(operation.registration) });
        addSubject('check', operation.id, file); break;
      }
      case 'publication': {
        requireAuthoring(operation.action === 'create' && typeof operation.text === 'string', 'Publication creation requires explicit create intent and complete profile text.');
        const file = `.publication/${operation.id}.md`, bytes = Buffer.from(operation.text);
        requireAuthoring(!working.has(file) && records('publication', operation.id).length === 0, 'Publication creation requires an absent profile identity and destination.');
        const parsed = document(bytes, file);
        requireAuthoring(parsed.value.type === 'publication' && parsed.value.id === operation.id, 'Publication identity must match its destination.');
        working.set(file, bytes); touched.add(file);
        addSubject('publication', operation.id, file); break;
      }
      case 'catalog': {
        const catalog = applyFields(global('catalog.json'), operation, []);
        writeGlobal('catalog.json', catalog);
        addSubject('atlas', records('atlas')[0]?.value.id ?? null, 'atlas.md'); break;
      }
      case 'connection': {
        action(operation);
        requireAuthoring(['memberships', 'relations', 'content', 'references'].includes(operation.collection), 'A connection requires an exact collection.');
        const connections = global('connections.json'), entries = connections[operation.collection] ?? [];
        const index = entries.findIndex(item => item.id === operation.id);
        requireAuthoring(operation.action === 'create' ? index < 0 : index >= 0, 'Connection identity does not match create/update action.');
        const entry = applyFields(index < 0 ? { id: operation.id } : entries[index], operation, ['id']);
        const selected = connectionOwner(entry, operation.collection);
        if (index < 0) entries.push(entry); else entries[index] = entry;
        connections[operation.collection] = entries; writeGlobal('connections.json', connections);
        if (operation.body !== undefined) {
          const current = read(selected.file); write(selected.file, current.value, operation.body, current.eol);
        }
        addSubject(selected.value.type === 'point' ? `point-${selected.value.record}` : selected.value.type, selected.value.id, selected.file);
        break;
      }
      case 'repair-document': {
        requireAuthoring(exactRelative(operation.path) && structural(operation.path) && typeof operation.text === 'string', 'Raw repair requires an exact structural path and complete text.');
        requireAuthoring(working.has(operation.path) || ['catalog.json', 'connections.json'].includes(operation.path), 'Raw repair replaces an existing document or creates an explicitly selected missing global file.');
        if (['catalog.json', 'connections.json'].includes(operation.path)) {
          const bytes = Buffer.from(operation.text);
          if (working.has(operation.path)) {
            let before, after;
            try { before = JSON.parse(working.get(operation.path)); after = JSON.parse(bytes); } catch { /* Invalid drafts retain raw repair. */ }
            if (before && after) preserveExtensions(before, after);
          }
          if (!working.get(operation.path)?.equals(bytes)) { working.set(operation.path, bytes); touched.add(operation.path); }
          addSubject('atlas', records('atlas')[0]?.value.id ?? null, 'atlas.md');
          break;
        }
        let before;
        try { before = read(operation.path); } catch { gaps.push(`Prior identity in ${operation.path} could not be established; raw repair is not an identity decision.`); }
        if (before?.value.type === 'point') {
          let existingAnchor; try { existingAnchor = anchor(before.value.id); } catch { /* Report the unresolved identity below. */ }
          const selectedMap = mapOf(operation.path);
          if (selectedMap && existingAnchor) decision(before.value.id, before.value.record, selectedMap, existingAnchor);
          else gaps.push(`Anchor provenance in ${operation.path} could not be established.`);
        }
        const bytes = Buffer.from(operation.text);
        let after;
        try { after = document(bytes, operation.path); } catch { gaps.push(`Proposed identity in ${operation.path} remains unresolved in the saved draft.`); }
        if (before && after) {
          for (const field of ['type', 'id', 'record']) {
            if (typeof before.value[field] === 'string' && typeof after.value[field] === 'string') requireAuthoring(before.value[field] === after.value[field], `Raw repair cannot convert authored ${field}; inspect and coordinate identity explicitly.`);
          }
          preserveExtensions(document(working.get(operation.path), operation.path).value, after.value);
        }
        if (!working.get(operation.path).equals(bytes)) { working.set(operation.path, bytes); touched.add(operation.path); }
        addSubject(before?.value.type === 'point' ? `point-${before.value.record}` : before?.value.type ?? 'unknown', before?.value.id ?? null, operation.path);
        break;
      }
      default: throw authoringError('invalid-operation', `Unsupported authoring operation ${operation.type}.`);
    }
  }
  const changes = [...touched].sort(compareCodePoints).filter((file) => !original.get(file)?.equals(working.get(file)))
    .map((file) => ({ path: file, before: original.get(file) ?? null, after: working.get(file) }));
  const changedPaths = new Set(changes.map((change) => change.path));
  return { files: working, changes, pointDecisions: decisions, subjects: subjects.filter((subject, index) => changes.length > 0
    && subjects.findIndex((other) => isDeepStrictEqual(other, subject)) === index), adoptedChecks, gaps };
}
