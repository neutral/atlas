/** @import {PortalCorpus, PortalRoute, PortalPoint, TargetUse, UnroutedSource, ResourceRegistration, ContentTarget, ReferenceTarget} from './types' */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RESOLVED_PROFILE, validateAtlas } from 'atlas-reference-validator';
import { validatePortalConfig } from './config.mjs';

const textExtensions = new Set(['.css', '.js', '.json', '.md', '.mjs', '.txt', '.ts', '.yaml', '.yml']);

/** @template T @param {T[]} values */
function unique(values) {
  return [...new Set(values)];
}

/** @param {string} candidate @param {string} root */
function within(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** @param {string} uri */
function isExternalUri(uri) {
  return /^[a-z][a-z0-9+.-]*:/iu.test(uri) || uri.startsWith('//');
}

/** @param {string} uri */
function safeExternalHref(uri) {
  return /^(?:https?:|mailto:)/iu.test(uri) ? uri : null;
}

/** @param {UnroutedSource} source */
function routeForSource(source) {
  if (source.kind === 'atlas') return '/';
  if (source.kind === 'map') return `/maps/${source.mapId}/`;
  if (source.kind === 'area') return `/maps/${source.mapId}/areas/${source.areaId}/`;
  if (source.kind === 'point-record') return `/points/${source.pointId}/#record-${source.recordIndex}`;
  return '/';
}

/** @param {ResourceRegistration} registration @param {string} atlasDirectory @param {string[]} allowedRoots
 * @returns {Pick<PortalCorpus["resources"][number], "availability" | "format" | "href" | "body" | "byteLength">} */
function readSelectedResource(registration, atlasDirectory, allowedRoots) {
  const uri = registration.uri;
  if (isExternalUri(uri)) {
    return { availability: 'external', format: 'external', href: safeExternalHref(uri), body: null };
  }

  const relativeTarget = decodeURIComponent(uri.split('#')[0] ?? uri);
  const target = path.resolve(atlasDirectory, relativeTarget);
  let canonicalTarget;
  try {
    canonicalTarget = fs.realpathSync(target);
  } catch {
    return { availability: 'missing', format: 'unknown', href: null, body: null };
  }
  if (!allowedRoots.some((root) => within(canonicalTarget, root))) {
    return { availability: 'unavailable', format: 'unknown', href: null, body: null };
  }

  const stat = fs.statSync(canonicalTarget);
  if (!stat.isFile()) return { availability: 'unavailable', format: 'unknown', href: null, body: null };

  const extension = path.extname(canonicalTarget).toLowerCase();
  if (!textExtensions.has(extension) || stat.size > 1_500_000) {
    return { availability: 'attachment', format: 'binary', href: null, body: null, byteLength: stat.size };
  }

  const body = fs.readFileSync(canonicalTarget, 'utf8');
  const format = extension === '.md' ? 'markdown' : extension === '.txt' ? 'text' : 'code';
  return { availability: 'readable', format, href: null, body, byteLength: stat.size };
}

/** @param {TargetUse[]} collection @param {UnroutedSource} source @param {ContentTarget[]} [content] @param {ReferenceTarget[]} [references] */
function addTargetUses(collection, source, content = [], references = []) {
  for (const item of content) {
    collection.push({
      use: 'content',
      source: { ...source, route: routeForSource(source) },
      resource: item.resource ?? null,
      uri: item.uri ?? null,
      label: item.label ?? null,
      selector: item.selector ?? null,
      role: null,
      note: null,
    });
  }
  for (const item of references) {
    collection.push({
      use: 'reference',
      source: { ...source, route: routeForSource(source) },
      resource: item.resource ?? null,
      uri: item.uri ?? null,
      label: item.label ?? null,
      selector: item.selector ?? null,
      role: item.role,
      note: item.note ?? null,
    });
  }
}

/** @param {Pick<PortalCorpus,"maps" | "areas" | "points" | "resources">} input
 * @returns {PortalCorpus["searchItems"]} */
function createSearchItems({ maps, areas, points, resources }) {
  /** @type {PortalCorpus["searchItems"]} */
  const items = [];
  const mapTitleById = new Map(maps.map((map) => [map.id, map.title]));
  /** @param {string[]} mapIds */
  const mapTitles = (mapIds) => mapIds.map((id) => mapTitleById.get(id) ?? id);
  for (const map of maps) {
    items.push({
      id: `map:${map.id}`,
      type: 'map',
      title: map.title,
      summary: map.summary,
      route: `/maps/${map.id}/`,
      mapIds: [map.id],
      mapTitles: [map.title],
      text: [map.id, map.title, map.summary, map.question, map.body].join('\n'),
    });
  }
  for (const area of areas) {
    items.push({
      id: `area:${area.mapId}:${area.id}`,
      type: 'area',
      title: area.title,
      summary: area.summary,
      route: `/maps/${area.mapId}/areas/${area.id}/`,
      mapIds: [area.mapId],
      mapTitles: mapTitles([area.mapId]),
      text: [area.id, area.title, area.summary, area.question, ...area.memberships.map((item) => item.context)].join('\n'),
    });
  }
  for (const point of points) {
    const mapIds = unique(point.records.map((record) => record.map));
    items.push({
      id: `point:${point.id}`,
      type: 'point',
      title: point.title,
      summary: point.summary,
      route: `/points/${point.id}/`,
      mapIds,
      mapTitles: mapTitles(mapIds),
      text: [
        point.id,
        point.title,
        point.summary,
        point.kinds.join(' '),
        point.posture,
        point.lifecycle,
        ...point.records.flatMap((record) => [record.summary, record.body, ...record.areas.map((area) => area.context)]),
        ...point.relations.map((relation) => `${relation.type} ${relation.targetPoint} ${relation.note}`),
      ].join('\n'),
    });
  }
  for (const resource of resources) {
    const mapIds = unique(resource.uses.map((use) => ('mapId' in use.source ? use.source.mapId : undefined)).filter((id) => id !== undefined));
    items.push({
      id: `resource:${resource.id}`,
      type: 'resource',
      title: resource.title,
      summary: resource.summary,
      route: `/resources/${resource.id}/`,
      mapIds,
      mapTitles: mapTitles(mapIds),
      text: [resource.id, resource.title, resource.summary, resource.body ?? '', ...resource.uses.map((use) => `${use.label ?? ''} ${use.role ?? ''} ${use.note ?? ''}`)].join('\n').slice(0, 120_000),
    });
  }
  return items;
}

/** @param {PortalPoint[]} points */
function buildRelatedMaps(points) {
  /** @type {Map<string, PortalCorpus['relatedMaps'][number]>} */
  const pairs = new Map();
  for (const point of points) {
    const mapIds = unique(point.records.map((record) => record.map)).sort();
    for (const [index, left] of mapIds.entries()) {
      for (const right of mapIds.slice(index + 1)) {
        const key = `${left}\u0000${right}`;
        const pair = pairs.get(key) ?? { maps: [left, right], pointIds: [] };
        pair.pointIds.push(point.id);
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.values()].sort((left, right) => right.pointIds.length - left.pointIds.length || left.maps.join('/').localeCompare(right.maps.join('/')));
}

/** @param {{atlasDirectory: string, profileId: string, portal: PortalCorpus['portal'], resourceRoots?: string[]}} options
 * @returns {Promise<PortalCorpus>} */
export async function compileAtlasPortal({ atlasDirectory, profileId, portal, resourceRoots = [] }) {
  const portalConfig = validatePortalConfig(portal);
  const result = validateAtlas(atlasDirectory, {
    profile: RESOLVED_PROFILE,
    specificationRevision: '0.8.0',
  });
  if (!result.complete || !result.valid || !result.normalized) {
    const diagnostics = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n');
    throw new Error(`Atlas validation failed.\n${diagnostics}`);
  }

  const normalized = result.normalized;
  const profile = normalized.publicationProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Publication profile not found: ${profileId}`);

  const selectedMapIds = new Set(profile.selection.maps);
  const pointSelections = new Map(profile.selection.points.map((item) => [item.id, new Set(item.records.map((record) => record.path))]));
  const selectedResourceIds = new Set(profile.selection.resources);
  const selectedAnchorPointIds = new Set(normalized.points
    .filter((point) => pointSelections.get(point.id)?.has(point.anchorPath))
    .map((point) => point.id));

  const points = normalized.points
    .filter((point) => pointSelections.has(point.id))
    .map((point) => {
      const selectedPaths = pointSelections.get(point.id);
      const records = point.records.filter((record) => selectedPaths?.has(record.path));
      const anchorSelected = records.some((record) => record.kind === 'anchor');
      return {
        id: point.id,
        title: anchorSelected ? point.title : point.id,
        summary: anchorSelected ? point.summary : records[0]?.summary ?? point.id,
        kinds: anchorSelected ? point.kinds : [],
        posture: anchorSelected ? point.posture : 'unavailable',
        lifecycle: anchorSelected ? point.lifecycle : 'unavailable',
        primaryMap: anchorSelected ? point.primaryMap : null,
        records,
        relations: anchorSelected ? point.relations : [],
        incomingRelations: point.incomingRelations.filter((relation) => selectedAnchorPointIds.has(relation.sourcePoint)),
        review: anchorSelected ? point.review : null,
      };
    });

  const selectedPointIds = new Set(points.map((point) => point.id));
  const maps = normalized.maps
    .filter((map) => selectedMapIds.has(map.id))
    .map((map) => ({
      ...map,
      pointIds: map.pointIds.filter((id) => selectedPointIds.has(id) && points.find((point) => point.id === id)?.records.some((record) => record.map === map.id)),
      anchorPointIds: map.anchorPointIds.filter((id) => selectedPointIds.has(id) && points.find((point) => point.id === id)?.records.some((record) => record.map === map.id && record.kind === 'anchor')),
      contextPointIds: map.contextPointIds.filter((id) => selectedPointIds.has(id) && points.find((point) => point.id === id)?.records.some((record) => record.map === map.id && record.kind === 'context')),
    }));

  const areas = maps.flatMap((map) => map.areas.map((area) => {
    const memberships = points.flatMap((point) => point.records
      .filter((record) => record.map === map.id)
      .flatMap((record) => record.areas
        .filter((membership) => membership.area === area.id)
        .map((membership) => ({ pointId: point.id, pointTitle: point.title, recordKind: record.kind, context: membership.context }))));
    return { ...area, mapId: map.id, mapTitle: map.title, memberships, pointIds: unique(memberships.map((item) => item.pointId)) };
  }));

  /** @type {TargetUse[]} */
  const targetUses = [];
  if (profile.selection.atlas) {
    addTargetUses(targetUses, { kind: 'atlas', title: normalized.atlas.title }, normalized.atlas.content, normalized.atlas.references);
  }
  for (const map of maps) {
    addTargetUses(targetUses, { kind: 'map', mapId: map.id, title: map.title }, map.content, map.references);
    for (const area of map.areas) {
      addTargetUses(targetUses, { kind: 'area', mapId: map.id, areaId: area.id, title: area.title }, area.content, area.references);
    }
  }
  for (const point of points) {
    for (const [recordIndex, record] of point.records.entries()) {
      addTargetUses(targetUses, { kind: 'point-record', pointId: point.id, mapId: record.map, recordIndex, recordPath: record.path, title: point.title }, record.content, record.references);
    }
  }

  const allowedRoots = unique([path.resolve(atlasDirectory), ...resourceRoots.map((root) => path.resolve(root))])
    .map((root) => fs.realpathSync(root));
  const resources = normalized.atlas.resources
    .filter((resource) => selectedResourceIds.has(resource.id))
    .map((resource) => ({
      ...resource,
      ...readSelectedResource(resource, path.resolve(atlasDirectory), allowedRoots),
      uses: targetUses.filter((use) => use.resource === resource.id),
    }));

  const relatedMaps = buildRelatedMaps(points);
  const projectedAtlas = profile.selection.atlas
    ? { ...normalized.atlas, resources: resources.map(({ body, uses, ...resource }) => resource) }
    : { id: profile.id, title: profile.title, summary: profile.summary, navigation: [], body: '', content: [], references: [] };

  /** @type {PortalRoute[]} */
  const routes = [
    { kind: 'atlas', path: '/', title: portalConfig.name },
    { kind: 'search', path: '/search/', title: 'Search' },
    ...maps.map(/** @returns {PortalRoute} */ (map) => ({ kind: 'map', path: `/maps/${map.id}/`, title: map.title, mapId: map.id })),
    ...areas.map(/** @returns {PortalRoute} */ (area) => ({ kind: 'area', path: `/maps/${area.mapId}/areas/${area.id}/`, title: area.title, mapId: area.mapId, areaId: area.id })),
    ...points.map(/** @returns {PortalRoute} */ (point) => ({ kind: 'point', path: `/points/${point.id}/`, title: point.title, pointId: point.id })),
    ...resources.map(/** @returns {PortalRoute} */ (resource) => ({ kind: 'resource', path: `/resources/${resource.id}/`, title: resource.title, resourceId: resource.id })),
  ];

  /** @satisfies {Omit<PortalCorpus, "searchItems" | "generation">} */
  const corpus = {
    contract: 'neutral.atlas-portal/1',
    specificationRevision: '0.8.0',
    portal: portalConfig,
    profile: { id: profile.id, title: profile.title, summary: profile.summary },
    atlas: projectedAtlas,
    maps,
    areas,
    points,
    resources,
    targetUses,
    relatedMaps,
    routes,
    counts: {
      maps: maps.length,
      areas: areas.length,
      points: points.length,
      pointRecords: points.reduce((sum, point) => sum + point.records.length, 0),
      resources: resources.length,
    },
  };
  const indexed = { ...corpus, searchItems: createSearchItems(corpus) };
  const generation = crypto.createHash('sha256').update(JSON.stringify(indexed)).digest('hex').slice(0, 16);
  return { ...indexed, generation };
}
