import path from 'node:path';
import { findAtlasRoot } from './discovery.mjs';
import { RESOLVED_PROFILE, validateAtlas } from './validator.mjs';

// This local reading view is separate from the normalized-model contract.
export function inspectPoint(atlasPath, pointId, options = {}) {
  if (typeof pointId !== 'string' || !pointId.trim()) {
    throw new Error('An exact Point id is required.');
  }
  let atlasRoot = path.resolve(atlasPath);
  try {
    atlasRoot = findAtlasRoot(atlasRoot) ?? atlasRoot;
  } catch {
    // The validator owns discovery failure diagnostics and completeness.
  }
  const validation = validateAtlas(atlasRoot, {
    profile: RESOLVED_PROFILE,
    specificationRevision: options.specificationRevision ?? '0.8.0',
  });
  const { normalized, diagnostics, ...validationSummary } = validation;
  validationSummary.diagnosticCounts = { error: 0, warning: 0, information: 0 };
  for (const diagnostic of diagnostics) validationSummary.diagnosticCounts[diagnostic.severity]++;
  if (!validation.complete || !validation.valid) validationSummary.diagnostics = diagnostics;
  const result = {
    contract: 'atlas.point-inspection/1',
    status: !validation.complete ? 'incomplete' : !validation.valid ? 'invalid' : 'not-found',
    atlasRoot,
    pointId,
    validation: validationSummary,
    limits: [
      'Local inspection includes all records of the exact Point; no publication profile is applied.',
      'Atlas and Map prose and material, unrelated Areas, other Points, Checks, and publication profiles are omitted.',
      'Resource metadata is included only for structured Content and References on the Point records and included Areas.',
      'Source contents are not fetched. Registered URIs are based at atlas.md; direct URIs are based at their owning record or Map path.',
      'Validation establishes format validity only. Source truth, Check compliance, and task completeness remain unverified.',
      'Successful validation summarizes full-corpus diagnostics; atlas-validate --json provides their complete details.',
    ],
  };
  if (!normalized) return result;
  const point = normalized.points.find((candidate) => candidate.id === pointId);
  if (!point) return result;

  const memberships = new Map(point.records.map((record) => [
    record.map, new Set(record.areas.map((membership) => membership.area)),
  ]));
  const maps = normalized.maps.filter((map) => memberships.has(map.id)).map((map) => ({
    id: map.id,
    title: map.title,
    summary: map.summary,
    question: map.question,
    status: map.status,
    path: map.path,
    areas: map.areas.filter((area) => memberships.get(map.id).has(area.id)),
    extensions: map.extensions,
  }));
  const resourceIds = new Set();
  for (const owner of [...point.records, ...maps.flatMap((map) => map.areas)]) {
    for (const target of [...(owner.content ?? []), ...(owner.references ?? [])]) {
      if (target.resource) resourceIds.add(target.resource);
    }
  }
  return {
    ...result,
    status: 'found',
    atlas: { id: normalized.atlas.id, title: normalized.atlas.title, path: 'atlas.md' },
    point,
    maps,
    resources: normalized.atlas.resources.filter((resource) => resourceIds.has(resource.id)),
  };
}
