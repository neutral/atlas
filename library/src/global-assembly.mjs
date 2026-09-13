import fs from 'node:fs';
import { validUri } from './resolved.mjs';
import path from 'node:path';
import { Diagnostic } from './model.mjs';
import { parseJsonObject } from './frontmatter.mjs';
import { schemaErrors, validators } from './schemas.mjs';
import { UTF8, UTF8_BOM } from './constants.mjs';
import { extensionFields, ioDiagnostic, relative } from './util.mjs';

// Authored globals are joined by identity. This is a reading projection, never a header writer.
export function assembleGlobals(state, diagnostics, { assemble = true } = {}) {
  state.authoredLocations = [];
  for (const name of ['catalog', 'connections']) readGlobal(state, name, diagnostics);
  observeDeclaredTargets(state);
  if (!assemble || !state.catalog.schemaValid || !state.connections.schemaValid) return;
  const catalog = state.catalog.value, connections = state.connections.value;
  const maps = state.maps.filter(item => item.schemaValid);
  const points = state.pointRecords.filter(item => item.schemaValid);
  const checks = state.checks.filter(item => item.schemaValid);
  const byDirectory = new Map(maps.map(item => [item.directory, item]));
  const mapId = item => byDirectory.get(item.mapDirectory)?.frontMatter.id;
  const report = (code, message, file, pointer) => diagnostics.push(new Diagnostic(code, 'error', message, { path: file, pointer }));
  function locate(item, pointer, file, sourcePointer) {
    state.authoredLocations.push({ path: relative(state.root, item.file), pointer, sourcePath: file, sourcePointer });
  }
  function one(items, message, file, pointer) {
    if (items.length !== 1) report('atlas.global.owner', `${message} resolves to ${items.length} records; exactly one is required.`, file, pointer);
    return items.length === 1 ? items[0] : null;
  }
  function owner(value, file, pointer) {
    let item;
    if (value.type === 'atlas') item = state.atlas.schemaValid ? state.atlas : null;
    if (value.type === 'map' || value.type === 'area') item = one(maps.filter(item => item.frontMatter.id === value.map), `Map ${value.map}`, file, pointer);
    if (value.type === 'point') item = one(points.filter(item => item.frontMatter.id === value.point && mapId(item) === value.map), `Point ${value.point} in Map ${value.map}`, file, pointer);
    if (value.type === 'check') item = one(checks.filter(item => item.frontMatter.id === value.check), `Check ${value.check}`, file, pointer);
    if (!item) return null;
    if (value.type !== 'area') return { item, container: item.frontMatter, prefix: '' };
    const areas = item.frontMatter.areas ?? [];
    const area = one(areas.filter(area => area.id === value.area), `Area ${value.area} in Map ${value.map}`, file, pointer);
    return area ? { item, container: area, prefix: `/areas/${areas.indexOf(area)}` } : null;
  }
  function append(resolved, field, value, file, pointer) {
    if (!resolved) return;
    const { item, container, prefix = '' } = resolved;
    const list = container[field] ??= [];
    locate(item, `${prefix}/${field}/${list.length}`, file, pointer);
    list.push(value);
  }
  function entries(source, name, file, identity, consume) {
    const seen = new Set();
    for (const [index, entry] of (source[name] ?? []).entries()) {
      const pointer = `/${name}/${index}`, key = identity?.(entry);
      if (key !== undefined && seen.has(key)) report('atlas.global.duplicate', `Duplicate ${name} declaration: ${key}.`, file, pointer);
      if (key !== undefined) seen.add(key);
      consume(entry, pointer);
    }
  }
  if (state.catalog.schemaValid) {
    if (state.atlas.schemaValid) {
      state.atlas.frontMatter.navigation = structuredClone(catalog.navigation ?? []);
      locate(state.atlas, '/navigation', 'catalog.json', '/navigation');
      entries(catalog, 'resources', 'catalog.json', entry => entry.id, (entry, pointer) => append({ item: state.atlas, container: state.atlas.frontMatter }, 'resources', structuredClone(entry), 'catalog.json', pointer));
    }
    entries(catalog, 'areas', 'catalog.json', entry => `${entry.map}/${entry.id}`, (entry, pointer) => {
      const resolved = owner({ type: 'map', map: entry.map }, 'catalog.json', `${pointer}/map`);
      const { map, ...area } = entry;
      append(resolved, 'areas', structuredClone(area), 'catalog.json', pointer);
    });
    entries(catalog, 'points', 'catalog.json', entry => entry.point, (entry, pointer) => {
      const anchor = one(points.filter(item => item.frontMatter.id === entry.point && item.frontMatter.record === 'anchor'), `Point anchor ${entry.point}`, 'catalog.json', `${pointer}/point`);
      if (!anchor) return;
      for (const field of ['kinds', 'review', ...Object.keys(extensionFields(entry))]) if (Object.hasOwn(entry, field)) {
        anchor.frontMatter[field] = structuredClone(entry[field]);
        locate(anchor, `/${field}`, 'catalog.json', `${pointer}/${field}`);
      }
    });
    entries(catalog, 'checks', 'catalog.json', entry => entry.check, (entry, pointer) => {
      const resolved = owner({ type: 'check', check: entry.check }, 'catalog.json', `${pointer}/check`);
      if (!resolved) return;
      for (const field of ['level', 'applies-to', ...Object.keys(extensionFields(entry))]) {
        resolved.container[field] = structuredClone(entry[field]);
        locate(resolved.item, `/${field}`, 'catalog.json', `${pointer}/${field}`);
      }
    });
    for (const check of checks) if (!(catalog.checks ?? []).some(entry => entry.check === check.frontMatter.id)) report('atlas.catalog.check-missing', `Check ${check.frontMatter.id} requires level and applicability in the catalog.`, 'catalog.json', '/checks');
    entries(catalog, 'extensions', 'catalog.json', entry => ownerKey(entry.owner), (entry, pointer) => {
      const resolved = owner(entry.owner, 'catalog.json', `${pointer}/owner`);
      if (!resolved) return;
      for (const [key, value] of Object.entries(entry.values)) {
        if (Object.hasOwn(resolved.container, key)) report('atlas.global.duplicate', `Extension ${key} already has an authored value.`, 'catalog.json', `${pointer}/values/${key}`);
        else { Object.defineProperty(resolved.container, key, { value: structuredClone(value), enumerable: true, writable: true, configurable: true }); locate(resolved.item, `${resolved.prefix}/${key}`, 'catalog.json', `${pointer}/values/${key}`); }
      }
    });
  }
  if (!state.connections.schemaValid) return;
  const connectionIds = new Set();
  for (const kind of ['memberships', 'relations', 'content', 'references']) entries(connections, kind, 'connections.json', null, (entry, pointer) => {
    if (connectionIds.has(entry.id)) report('atlas.connection.duplicate-id', `Connection identifier ${entry.id} repeats.`, 'connections.json', `${pointer}/id`);
    connectionIds.add(entry.id);
    if (kind === 'memberships') {
      const resolved = owner({ type: 'point', point: entry.point, map: entry.map }, 'connections.json', pointer);
      append(resolved, 'areas', { id: entry.id, area: entry.area, ...extensionFields(entry) }, 'connections.json', pointer);
    } else if (kind === 'relations') {
      const anchor = one(points.filter(item => item.frontMatter.id === entry.source && item.frontMatter.record === 'anchor'), `Relation source Point anchor ${entry.source}`, 'connections.json', `${pointer}/source`);
      if (anchor) {
        const index = (anchor.frontMatter.relations ?? []).length;
        append({ item: anchor, container: anchor.frontMatter }, 'relations', { id: entry.id, type: entry.type, point: entry.target, ...extensionFields(entry) }, 'connections.json', pointer);
        locate(anchor, `/relations/${index}/point`, 'connections.json', `${pointer}/target`);
      }
    } else {
      for (const key of Object.keys(extensionFields(entry))) if (Object.hasOwn(entry.target, key)) report('atlas.global.duplicate', `Extension ${key} occurs on both the connection and its target.`, 'connections.json', `${pointer}/${key}`);
      const resolved = owner(entry.owner, 'connections.json', `${pointer}/owner`);
      const index = resolved?.container[kind]?.length ?? 0;
      append(resolved, kind, { ...structuredClone(entry.target), ...extensionFields(entry), id: entry.id, ...(kind === 'references' ? { role: entry.role } : {}) }, 'connections.json', pointer);
      if (resolved) for (const key of Object.keys(entry.target)) locate(resolved.item, `${resolved.prefix}/${kind}/${index}/${key}`, 'connections.json', `${pointer}/target/${key}`);
    }
  });
}

// Retain recognized targets even when unrelated authoring errors prevent a read model.
// Protective cache/state checks consume these identities without inferring a valid owner.
function observeDeclaredTargets(state) {
  if (!state.observeLocalTarget) return;
  const list = value => Array.isArray(value) ? value : [];
  function observe(uri, file) {
    if (!validUri(uri) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri) || uri.startsWith('//')) return;
    let localPath;
    try { localPath = decodeURIComponent(uri.split(/[?#]/u, 1)[0]); }
    catch { return; }
    state.observeLocalTarget(path.resolve(path.dirname(file), localPath));
  }
  for (const resource of list(state.catalog.value.resources)) observe(resource?.uri, state.atlas.file);
  for (const field of ['content', 'references']) for (const connection of list(state.connections.value[field])) {
    const owner = connection?.owner, uri = connection?.target?.uri;
    if (!owner || !uri) continue;
    if (owner.type === 'atlas') observe(uri, state.atlas.file);
    const maps = state.maps.filter(map => map.frontMatter?.id === owner.map);
    if (owner.type === 'map' || owner.type === 'area') for (const map of maps) observe(uri, map.file);
    if (owner.type === 'point') for (const record of state.pointRecords) if (record.frontMatter?.id === owner.point && maps.some(map => map.directory === record.mapDirectory)) observe(uri, record.file);
  }
}

function ownerKey(owner) { return JSON.stringify([owner.type, owner.map, owner.area, owner.point, owner.check]); }

function readGlobal(state, name, diagnostics) {
  const file = path.join(state.root, `${name}.json`), sourceFs = state.fs ?? fs;
  const item = state[name] ??= { file };
  item.value = {}; item.schemaValid = false;
  const error = (code, message, location = {}) => diagnostics.push(new Diagnostic(code, 'error', message, { path: `${name}.json`, ...location }));
  let bytes;
  try {
    if (!sourceFs.readdirSync(state.root).includes(`${name}.json`)) { error('atlas.global.missing', `Atlas format 2 requires the exact filename ${name}.json.`); return; }
    const stat = sourceFs.lstatSync(file);
    if (stat.isSymbolicLink()) { error('atlas.discovery.symbolic-link', 'Global authoring files must not be symbolic links.'); return; }
    if (!stat.isFile()) { error('atlas.global.invalid-file', 'Global authoring files must be regular files.'); return; }
    bytes = sourceFs.readFileSync(file);
  } catch (cause) {
    if (cause.code === 'ENOENT') error('atlas.global.missing', `Atlas format 2 requires ${name}.json.`);
    else ioDiagnostic(state, diagnostics, file, cause);
    return;
  }
  if (bytes.subarray(0, 3).equals(UTF8_BOM)) { error('atlas.text.bom', 'Global authoring text must not begin with a UTF-8 byte-order mark.'); return; }
  let source;
  try { source = UTF8.decode(bytes); } catch { error('atlas.text.invalid-utf8', 'Global authoring text must be valid UTF-8.'); return; }
  if (source.includes('\0')) { error('atlas.text.nul', 'Global authoring text must not contain NUL.'); return; }
  const parsed = parseJsonObject(source);
  if (parsed.errors.length) { error('atlas.global.invalid-json', parsed.errors[0], { details: { errors: parsed.errors } }); return; }
  item.value = parsed.value;
  const validate = validators[name];
  if (!validate(parsed.value)) {
    const errors = schemaErrors(validate);
    error('atlas.global.schema', errors[0].message, { pointer: errors[0].pointer, details: { errors } }); return;
  }
  item.value = parsed.value; item.schemaValid = true;
}

export function remapAuthoredDiagnostics(state, diagnostics) {
  for (const diagnostic of diagnostics) {
    if (!diagnostic.pointer) continue;
    const match = (state.authoredLocations ?? []).filter(location => location.path === diagnostic.path && (diagnostic.pointer === location.pointer || diagnostic.pointer.startsWith(`${location.pointer}/`))).sort((a, b) => b.pointer.length - a.pointer.length)[0];
    if (match) {
      diagnostic.path = match.sourcePath;
      diagnostic.pointer = match.sourcePointer + diagnostic.pointer.slice(match.pointer.length);
    }
  }
}
