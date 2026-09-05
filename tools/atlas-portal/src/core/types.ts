import type { z } from 'zod';
import type { corpusSchema, routeSchema, searchItemSchema } from './model.mjs';

export type PortalCorpus = z.infer<typeof corpusSchema>;
export type PortalRoute = z.infer<typeof routeSchema>;
export type SearchItem = z.infer<typeof searchItemSchema>;
export interface PortalProps { corpus: PortalCorpus; route: PortalRoute }
export type PortalPoint = PortalCorpus['points'][number];
export type PortalMap = PortalCorpus['maps'][number];
export type TargetUse = PortalCorpus['targetUses'][number];
export type TargetSource = TargetUse['source'];
export type UnroutedSource = TargetSource extends infer S ? S extends TargetSource ? Omit<S, 'route'> : never : never;
export type ResourceRegistration = Pick<PortalCorpus['resources'][number], 'id' | 'title' | 'uri' | 'summary' | 'media-type'>;
export type ContentTarget = PortalPoint['records'][number]['content'][number];
export type ReferenceTarget = PortalPoint['records'][number]['references'][number];

// The reference validator owns and validates this normalized input contract.
// This consumer interface describes only fields used by the projection.
export interface NormalizedAtlas {
  format: 1;
  atlas: PortalCorpus['atlas'] & { resources: ResourceRegistration[] };
  maps: PortalMap[];
  points: (PortalPoint & { anchorPath: string })[];
  publicationProfiles: {
    id: string; title: string; summary: string;
    selection: { atlas: boolean; maps: string[]; resources: string[]; points: { id: string; records: { path: string }[] }[] };
  }[];
}
