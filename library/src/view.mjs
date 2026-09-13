import path from 'node:path';
import nodeFs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { findAtlasRoot } from './discovery.mjs';
import { IGNORED_DIRECTORIES, RESOLVED_PROFILE } from './constants.mjs';
import { Diagnostic, ValidationResult, compareCodePoints } from './model.mjs';
import { validateObservedAtlas } from './validator.mjs';
import { assemblePoint } from './point-view.mjs';
import { digest, inventory, inputChanges, observeInventory } from './source-inventory.mjs';
import { readSource } from './source-reader.mjs';
import { isWithin } from './util.mjs';
import { searchRecords } from './fts-search.mjs';

const CONTRACT = 'atlas.read-view/2';
const TYPES = ['map', 'area', 'point', 'resource', 'check'];
const views = new WeakSet();
const targetsByView = new WeakMap();

export class AtlasToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AtlasToolError';
    this.code = code;
  }
}

function requireArgument(condition, message) {
  if (!condition) throw new AtlasToolError('atlas.tools.invalid-argument', message);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function openAtlas(start, options = {}) {
  return openWorkingTree(start, options);
}

export function openWorkingTree(start, options = {}) {
  return openAtlasFromSource(start, options, { fs: nodeFs, descriptor: { kind: 'working-tree' } });
}

export function openAtlasFromSource(start, options = {}, source) {
  requireArgument(typeof start === 'string' && start.trim().length > 0, 'An Atlas path is required.');
  requireArgument(options !== null && typeof options === 'object' && !Array.isArray(options), 'openAtlas options must be an object.');
  const specificationRevision = options.specificationRevision ?? '0.9.0';
  const maxDocumentBytes = options.maxDocumentBytes ?? 1024 * 1024;
  requireArgument(typeof specificationRevision === 'string' && specificationRevision.length > 0, 'A specification revision is required.');
  requireArgument(Number.isSafeInteger(maxDocumentBytes) && maxDocumentBytes > 0, 'maxDocumentBytes must be a positive safe integer.');
  const sourceFs = source.fs;
  const immutable = source.descriptor.kind === 'snapshot';
  let atlasRoot = path.resolve(start);
  try { atlasRoot = findAtlasRoot(atlasRoot, sourceFs) ?? atlasRoot; } catch { /* Validation owns discovery diagnostics. */ }
  const observation = observeInventory(atlasRoot, maxDocumentBytes, sourceFs);
  const localTargets = new Set(), allTargets = new Set();
  let validation = validateObservedAtlas(atlasRoot, { profile: RESOLVED_PROFILE, specificationRevision }, (target) => {
    allTargets.add(target);
    if (!isWithin(atlasRoot, target)) return;
    const relativePath = path.relative(atlasRoot, target).split(path.sep).join('/') || '.';
    if (localTargets.has(relativePath)) return;
    localTargets.add(relativePath);
    observation.includeTarget(relativePath);
  }, sourceFs);
  const explicitLocalTargets = [...localTargets].sort(compareCodePoints);
  const before = observation.snapshot();
  const after = inventory(atlasRoot, maxDocumentBytes, explicitLocalTargets, sourceFs);
  const changed = before.digest !== after.digest;
  const issues = [...before.issues, ...after.issues];
  // Preserve validator diagnostics when validation itself could not complete.
  if (validation.complete && (changed || issues.length) && !validation.diagnostics.some((item) => item.code === 'atlas.discovery.root-not-found')) {
    validation = new ValidationResult({
      profile: RESOLVED_PROFILE, specificationRevision, complete: false,
      diagnostics: [...validation.diagnostics, new Diagnostic('atlas.processing.io', 'error',
        changed ? 'Atlas inputs changed while the read view was opening.' : 'Atlas input identity could not be examined completely.')],
    });
  }
  freeze(validation);
  const identity = freeze({
    digest: before.digest && !changed && !issues.length ? digest(JSON.stringify({
      contract: CONTRACT, atlasRoot, specificationRevision, implementation: validation.implementation,
      inputDigest: before.digest, maxDocumentBytes,
      ...(immutable ? { repositoryDigest: source.descriptor.repositoryDigest, revision: source.descriptor.revision } : {}),
    })) : null,
    inputDigest: before.digest,
    inputs: before.inputs,
    scope: {
      kind: immutable ? 'snapshot' : 'working-tree', root: atlasRoot, ignoredDirectories: [...IGNORED_DIRECTORIES].sort(compareCodePoints),
      nestedAtlases: 'excluded', externalResources: immutable ? 'not-fetched' : 'not-read',
      explicitLocalTargets,
      ...(immutable ? { repositoryRoot: source.descriptor.repositoryRoot, repositoryDigest: source.descriptor.repositoryDigest,
        revision: source.descriptor.revision } : {}),
    },
    specificationRevision,
    configuration: { maxDocumentBytes },
    implementation: validation.implementation,
    consistency: immutable ? 'immutable-snapshot' : 'checked-working-tree',
  });
  const status = !validation.complete ? 'incomplete' : !validation.valid ? 'invalid' : 'ready';
  const limits = freeze([
    immutable ? 'This observation uses a complete sealed caller-supplied repository snapshot. No host filesystem fallback is performed.'
      : 'This is a retained working-tree observation. Before/after comparisons do not establish an atomic or immutable filesystem snapshot.',
    'Freshness is explicit. Reading this view never refreshes it or executes project commands.',
    'No publication selection is applied. External Resource contents are not part of this view.',
    `Raw document bytes retain at most ${maxDocumentBytes} bytes per file. Search includes authored Atlas text, not Resource contents.`,
    'Validation does not establish Check compliance, source truth, retrieval effectiveness, or task completeness.',
  ]);
  return createRetainedView({ atlasRoot, identity, validation, limits, before, source,
    options: { specificationRevision, maxDocumentBytes }, allLocalTargets: [...allTargets].sort(compareCodePoints) });
}

function createRetainedView(state) {
  const { atlasRoot, identity, validation, limits, before, source, options } = state;
  const status = !validation.complete ? 'incomplete' : !validation.valid ? 'invalid' : 'ready';
  const explicitLocalTargets = identity.scope.explicitLocalTargets;
  const searchItems = freeze(validation.normalized ? candidates(validation.normalized) : []);
  const view = {
    contract: CONTRACT, atlasRoot, identity, validation, status, limits,
    inspectPoint(pointId) {
      requireArgument(typeof pointId === 'string' && pointId.trim().length > 0, 'An exact Point id is required.');
      return freeze(assemblePoint(validation, atlasRoot, pointId));
    },
    inspectResource(resourceId) {
      requireArgument(typeof resourceId === 'string' && resourceId.trim().length > 0, 'An exact Resource id is required.');
      const result = {
        contract: 'atlas.resource-inspection/1', atlasRoot, resourceId, identity,
        status: status === 'ready' ? 'not-found' : status,
        limits: [
          'Uses include exact registered Resource ids across the captured Atlas; no publication selection is applied.',
          'Matching direct URIs, prose links, and other Resource ids do not establish uses of this Resource identity.',
          'Owners retain paths and organizing questions where authored. Owner bodies and source contents are omitted.',
          'Uses preserve Content and Reference targets, selectors, roles, notes, labels, and extensions in authored order within each owner.',
          'Inspection performs no filesystem reads or Check evaluation and establishes neither source truth nor publication authority.',
        ],
      };
      const model = validation.normalized;
      if (!model) return freeze(result);
      const resource = model.atlas.resources.find((item) => item.id === resourceId);
      if (!resource) return freeze(result);
      const uses = [];
      const add = (owner, record) => {
        for (const [field, use] of [['content', 'content'], ['references', 'reference']]) {
          for (const target of record[field] ?? []) {
            if (target.resource === resourceId) uses.push({ use, owner, target });
          }
        }
      };
      add({ type: 'atlas', path: 'atlas.md' }, model.atlas);
      for (const map of model.maps) {
        add({ type: 'map', path: map.path, mapId: map.id, question: map.question }, map);
        for (const area of map.areas) {
          add({ type: 'area', path: map.path, mapId: map.id, areaId: area.id, question: area.question }, area);
        }
      }
      for (const point of model.points) {
        for (const record of point.records) {
          add({ type: 'point-record', path: record.path, mapId: record.map, pointId: point.id, recordKind: record.kind }, record);
        }
      }
      return freeze({ ...result, status: 'found', resource, uses });
    },
    readSource(target, sourceOptions = {}) {
      return Promise.resolve(readSource(view, target, sourceOptions, source)).then(freeze);
    },
    readDocument(relativePath) {
      requireArgument(typeof relativePath === 'string' && relativePath !== '' && !path.isAbsolute(relativePath)
        && relativePath.split(/[\\/]/u).every((part) => part !== '..' && part !== '.' && part !== ''),
      'readDocument requires an exact Atlas-relative path without traversal.');
      const input = before.inputs.find((entry) => entry.path === relativePath);
      const result = { path: relativePath, viewDigest: identity.digest, diagnostics: validation.diagnostics.filter((item) => item.path === relativePath) };
      if (!input || input.kind === 'missing') return freeze({ ...result, status: 'missing', ...(input ? { input } : {}) });
      if (input.kind !== 'file') return freeze({ ...result, status: input.kind === 'unreadable' ? 'unreadable' : 'unsupported', input });
      const bytes = before.documents.get(relativePath);
      const truncated = bytes.length < input.byteLength;
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated }); } catch { /* Bytes remain available for repair. */ }
      return freeze({ ...result, status: truncated ? 'truncated' : text === undefined ? 'unsupported' : 'read', input,
        bytesBase64: bytes.toString('base64'), ...(text !== undefined ? { text } : {}), truncated });
    },
    find(query, findOptions = {}) {
      requireArgument(typeof query === 'string', 'find requires a string query.');
      requireArgument(findOptions !== null && typeof findOptions === 'object' && !Array.isArray(findOptions), 'find options must be an object.');
      requireArgument(Object.keys(findOptions).every((key) => ['types', 'limit', 'cursor', 'mode'].includes(key)), 'Unsupported find option.');
      const limit = findOptions.limit ?? 30;
      const types = findOptions.types ?? TYPES;
      const mode = findOptions.mode ?? 'ranked';
      requireArgument(['ranked', 'fts'].includes(mode), 'find mode must be ranked or fts.');
      requireArgument(query.length <= 4096, 'find query must not exceed 4096 UTF-16 code units.');
      requireArgument(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'find limit must be between 1 and 200.');
      requireArgument(Array.isArray(types) && types.every((type) => TYPES.includes(type)), 'find types must name map, area, point, resource, or check.');
      const selectedTypes = [...new Set(types)].sort(compareCodePoints);
      const normalizedQuery = mode === 'ranked' ? query.trim().toLowerCase() : query.trim();
      const selection = { view: identity.digest, query: normalizedQuery, mode, types: selectedTypes, search: 'atlas.fts5/1' };
      let offset = 0;
      if (findOptions.cursor !== undefined) {
        try {
          const cursor = JSON.parse(Buffer.from(findOptions.cursor, 'base64url').toString('utf8'));
          if (!isDeepStrictEqual(cursor.selection, selection) || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error();
          offset = cursor.offset;
        } catch { throw new AtlasToolError('atlas.tools.invalid-cursor', 'The cursor does not belong to this view, query, and type selection.'); }
      }
      const searchIdentity = { digest: identity.digest, inputDigest: identity.inputDigest,
        specificationRevision: identity.specificationRevision, consistency: identity.consistency,
        scope: { kind: identity.scope.kind, root: identity.scope.root } };
      const searchLimits = [...limits,
        'FTS5 searches each Point record separately and groups candidates by exact identity. Scores do not establish semantic relevance or answer completeness.',
        'At most three matching records are shown per candidate. matchCount counts all matching records; excerpts describe indexed text and may omit surrounding material.',
        'The full captured input inventory remains available through view.identity. Search returns a compact observation reference.'];
      if (status !== 'ready') return freeze({ status, identity: searchIdentity, query: { mode, expression: null }, items: [], total: 0, nextCursor: null, limits: searchLimits });
      let found;
      try { found = searchRecords(searchItems, normalizedQuery, { mode, types: selectedTypes }); }
      catch (error) {
        if (error?.code === 'atlas.tools.invalid-argument') throw new AtlasToolError(error.code, error.message);
        throw error;
      }
      const grouped = new Map();
      for (const hit of found.items) {
        const record = searchItems[hit.index], candidate = record.candidate;
        const key = `${candidate.type}\0${candidate.id}\0${candidate.mapId ?? ''}`;
        const match = { path: record.path, ...(record.mapId ? { mapId: record.mapId } : {}),
          ...(record.recordKind ? { recordKind: record.recordKind } : {}), excerpt: hit.excerpt, score: hit.score };
        const current = grouped.get(key);
        if (current) { current.matches.push(match); current.score = Math.max(current.score, hit.score); }
        else grouped.set(key, { ...candidate, score: hit.score, exactMatch: mode === 'ranked' && normalizedQuery.length > 0 && candidate.id.toLowerCase() === normalizedQuery, matches: [match] });
      }
      const matching = [...grouped.values()].map((item) => {
        item.matches.sort((a, b) => b.score - a.score || compareCodePoints(a.path, b.path));
        return { ...item, matchCount: item.matches.length, matches: item.matches.slice(0, 3),
          reasons: [item.exactMatch ? 'Exact authored id.' : normalizedQuery ? 'SQLite FTS5 match ranked by BM25.' : 'Listed from the captured Atlas.'] };
      }).sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch) || b.score - a.score
        || compareCodePoints(`${a.type}\0${a.id}\0${a.mapId ?? ''}`, `${b.type}\0${b.id}\0${b.mapId ?? ''}`));
      const end = offset + limit;
      return freeze({ status: 'ready', identity: searchIdentity, query: found.query, items: matching.slice(offset, end), total: matching.length,
        nextCursor: end < matching.length ? Buffer.from(JSON.stringify({ selection, offset: end })).toString('base64url') : null,
        limits: searchLimits });
    },
    compare(other) {
      requireArgument(views.has(other), 'compare requires another opened Atlas view.');
      const sourceChanges = inputChanges(identity.inputs, other.identity.inputs);
      const result = { before: identity, after: other.identity, sourceChanges, limits };
      if (status !== 'ready' || other.status !== 'ready') return freeze({ ...result, status: 'unavailable', records: [] });
      const left = records(validation.normalized), right = records(other.validation.normalized);
      const changes = [...new Set([...left.keys(), ...right.keys()])].sort(compareCodePoints).flatMap((key) => {
        const old = left.get(key), next = right.get(key);
        if (isDeepStrictEqual(old, next)) return [];
        return [{ key, change: !old ? 'added' : !next ? 'removed' : 'changed', before: old ?? null, after: next ?? null }];
      });
      return freeze({ ...result, status: 'compared', records: changes });
    },
    freshness() {
      const current = source.descriptor.kind === 'snapshot' ? before : inventory(atlasRoot, 0, explicitLocalTargets, source.fs);
      return freeze({ status: !identity.digest || !current.digest ? 'unavailable' : before.digest === current.digest ? 'fresh' : 'stale',
        expectedInputDigest: before.digest, currentInputDigest: current.digest,
        changes: inputChanges(before.inputs, current.inputs), issues: current.issues });
    },
    refresh() { return openAtlasFromSource(atlasRoot, options, source); },
  };
  views.add(view);
  targetsByView.set(view, state.allLocalTargets);
  return freeze(view);
}

// Expose recognized targets without exposing the retained source provider.
export function localSourceTargets(view) {
  requireArgument(views.has(view), 'localSourceTargets requires an opened Atlas view.');
  return Object.freeze([...targetsByView.get(view)]);
}

function candidates(model) {
  const result = [];
  const references = (item) => (item.references ?? []).map((reference) =>
    [reference.note ?? '', reference.uri ?? '', reference.resource ?? ''].join(' '));
  const add = (type, item, extra = {}) => result.push({ type, id: item.id, title: item.title,
    summary: item.summary ?? '', path: extra.path ?? item.path ?? 'atlas.md', ...(extra.mapId ? { mapId: extra.mapId } : {}),
    body: [item.question ?? '', item.body ?? '', item.uri ?? '', ...references(item)].join('\n'),
    candidate: { type, id: item.id, title: item.title, summary: item.summary, path: item.path ?? 'atlas.md', ...extra } });
  for (const map of model.maps) {
    add('map', map);
    for (const area of map.areas) add('area', area, { mapId: map.id, path: map.path });
  }
  for (const point of model.points) {
    const candidate = { type: 'point', id: point.id, title: point.title, summary: point.summary,
      path: point.anchorPath, mapIds: point.records.map((record) => record.map) };
    for (const record of point.records) result.push({ type: 'point', id: point.id,
      title: record.title, summary: record.summary ?? '',
      path: record.path, mapId: record.map, recordKind: record.kind, candidate,
      body: [record.body, ...record.areas.map((area) => area.context),
        ...references(record),
        ...point.relations.filter((relation) => relation.sourcePath === record.path).map((relation) => relation.note)].join('\n') });
  }
  for (const resource of model.atlas.resources) add('resource', resource, { uri: resource.uri });
  for (const check of model.checks) add('check', check);
  return result;
}

function records(model) {
  const entries = [['atlas', model.atlas]];
  for (const [type, list] of [['map', model.maps], ['point', model.points], ['resource', model.atlas.resources], ['check', model.checks], ['publication', model.publicationProfiles]]) {
    for (const item of list) entries.push([`${type}:${item.id}`, item]);
  }
  return new Map(entries);
}
