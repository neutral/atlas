import type { AtlasView, Branch, Facet, Point, Source, SourceReadResult, TargetPointer, Tree } from './index.js';

export interface PublicationOptions { trees: string[]; points?: string[]; sources?: string[]; includeStyle?: boolean }
export interface PublicationSourceReference extends Source { publicationAvailable: boolean }
export interface PublishedPoint extends Omit<Point, 'path' | 'sources'> { publicationAvailable: true; sources?: PublicationSourceReference[] }
export interface PointPlaceholder { id: string; tree: string; publicationAvailable: false }
export interface PublishedFacet extends Omit<Facet, 'path' | 'sources'> {
  sources?: PublicationSourceReference[]; viaAvailability: 'included' | 'not-included';
  targetAvailability: Array<TargetPointer & { availability: 'included' | 'not-included' }>;
}
export interface PublicationData {
  format: 'atlas.publication-data/1'; id: string; title: string;
  style?: { id: string; revision: string; title: string; body: string; derivedFrom?: string };
  trees: Array<Omit<Tree, 'path'>>; points: Array<PublishedPoint | PointPlaceholder>; branches: Branch[]; facets: PublishedFacet[]; checks: [];
}
export interface PublicationSourceSelection { uri: string; publicationAvailable: boolean; status: 'selected' | 'not-included'; references: Source[] }
export interface Publication {
  format: 'atlas.publication/1'; status: 'ready' | 'incomplete' | 'unavailable'; identity: string | null; digest: string;
  selection: PublicationOptions & { sources: string[] }; atlas: PublicationData | null; sources: PublicationSourceSelection[];
  exclusions: { trees?: number; points?: number; facets?: number; checks?: number; sourceReferences?: number };
  diagnostics: Array<{ code: string; id: string; message: string }>; limits: string[];
}
export function preparePublication(view: AtlasView, options: PublicationOptions): Publication;
export function readPublicationSources(view: AtlasView, publication: Publication, options: { allowedRoots: string[] }): Promise<Array<SourceReadResult & { uri: string }>>;
