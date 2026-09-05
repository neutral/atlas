import { z } from 'zod';
import { portalConfigSchema } from './config.mjs';

// This private view schema checks the compiler/cache boundary. Atlas meaning and
// publication selection remain owned by the reference validator.
const strings = z.array(z.string());
const identity = { id: z.string(), title: z.string(), summary: z.string() };
const localRoute = z.string().regex(/^\/(?!\/)[^\s\\]*$/u, 'Expected a local Portal route.');
const target = z.looseObject({
  resource: z.string().optional(), uri: z.string().optional(),
  selector: z.string().optional(), label: z.string().optional(),
});
const reference = target.extend({ role: z.string(), note: z.string().optional() });
const material = { content: z.array(target), references: z.array(reference) };
const area = z.looseObject({
  ...identity, question: z.string(),
  content: z.array(target).optional(), references: z.array(reference).optional(),
});
const membership = z.looseObject({ area: z.string(), context: z.string() });
const record = z.object({
  kind: z.enum(['anchor', 'context']), map: z.string(), path: z.string(),
  summary: z.string(), areas: z.array(membership), ...material, body: z.string(),
  extensions: z.record(z.string(), z.unknown()),
});
const relation = z.object({
  sourcePoint: z.string(), sourceMap: z.string(), sourcePath: z.string(),
  type: z.string(), targetPoint: z.string(), note: z.string(),
  extensions: z.record(z.string(), z.unknown()),
});
const registration = z.looseObject({
  id: z.string(), title: z.string(), uri: z.string(),
  summary: z.string().optional(), 'media-type': z.string().optional(),
});
const resourceBody = {
  availability: z.enum(['external', 'missing', 'unavailable', 'attachment', 'readable']),
  format: z.enum(['external', 'unknown', 'binary', 'markdown', 'text', 'code']),
  href: z.string().nullable(), body: z.string().nullable(), byteLength: z.number().optional(),
};
const sourceBase = { title: z.string(), route: localRoute };
const source = z.discriminatedUnion('kind', [
  z.object({ ...sourceBase, kind: z.literal('atlas') }),
  z.object({ ...sourceBase, kind: z.literal('map'), mapId: z.string() }),
  z.object({ ...sourceBase, kind: z.literal('area'), mapId: z.string(), areaId: z.string() }),
  z.object({
    ...sourceBase, kind: z.literal('point-record'), mapId: z.string(), pointId: z.string(),
    recordIndex: z.number().int().nonnegative(), recordPath: z.string(),
  }),
]);
const targetUse = z.object({
  use: z.enum(['content', 'reference']), source, resource: z.string().nullable(),
  uri: z.string().nullable(), label: z.string().nullable(), selector: z.string().nullable(),
  role: z.string().nullable(), note: z.string().nullable(),
});
const routeBase = { path: localRoute, title: z.string() };
export const routeSchema = z.discriminatedUnion('kind', [
  z.object({ ...routeBase, kind: z.literal('atlas') }),
  z.object({ ...routeBase, kind: z.literal('search') }),
  z.object({ ...routeBase, kind: z.literal('map'), mapId: z.string() }),
  z.object({ ...routeBase, kind: z.literal('area'), mapId: z.string(), areaId: z.string() }),
  z.object({ ...routeBase, kind: z.literal('point'), pointId: z.string() }),
  z.object({ ...routeBase, kind: z.literal('resource'), resourceId: z.string() }),
  z.object({ ...routeBase, kind: z.literal('not-found') }),
]);
export const searchItemSchema = z.object({
  id: z.string(), type: z.enum(['map', 'area', 'point', 'resource']),
  title: z.string(), summary: z.string().optional(), route: localRoute,
  mapIds: strings, mapTitles: strings, text: z.string(),
});
export const corpusSchema = z.strictObject({
  contract: z.literal('neutral.atlas-portal/1'),
  specificationRevision: z.literal('0.8.0'),
  portal: portalConfigSchema,
  profile: z.object(identity),
  atlas: z.object({
    ...identity,
    navigation: z.array(z.looseObject({ title: z.string(), maps: strings })),
    ...material, body: z.string(), resources: z.array(registration).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  }),
  maps: z.array(z.object({
    ...identity, question: z.string(), status: z.string(), path: z.string(),
    areas: z.array(area), ...material, extensions: z.record(z.string(), z.unknown()),
    body: z.string(), pointIds: strings, anchorPointIds: strings, contextPointIds: strings,
  })),
  areas: z.array(area.extend({
    mapId: z.string(), mapTitle: z.string(),
    memberships: z.array(z.object({
      pointId: z.string(), pointTitle: z.string(),
      recordKind: z.enum(['anchor', 'context']), context: z.string(),
    })),
    pointIds: strings,
  })),
  points: z.array(z.object({
    ...identity, kinds: strings, posture: z.string(), lifecycle: z.string(),
    primaryMap: z.string().nullable(), records: z.array(record),
    relations: z.array(relation), incomingRelations: z.array(relation),
    review: z.looseObject({
      'reviewed-at': z.string().optional(), 'review-after': z.string().optional(), by: strings.optional(),
    }).nullable(),
  })),
  resources: z.array(registration.extend({ ...resourceBody, uses: z.array(targetUse) })),
  targetUses: z.array(targetUse),
  relatedMaps: z.array(z.object({ maps: z.tuple([z.string(), z.string()]), pointIds: strings })),
  routes: z.array(routeSchema),
  counts: z.object({
    maps: z.number(), areas: z.number(), points: z.number(),
    pointRecords: z.number(), resources: z.number(),
  }),
  searchItems: z.array(searchItemSchema),
  generation: z.string(),
});

/** @param {unknown} value */
export function parseCorpus(value) {
  return corpusSchema.parse(value);
}
