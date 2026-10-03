import type { AtlasView, Source, HostPointer } from './index.js';
import type { ChangePlan } from './authoring.js';
export interface ReferenceOwner { kind: 'point' | 'facet'; id: string; tree: string; path?: string }
export interface ReferenceLocation { start: number; end: number; line: number; column: number }
export interface RecordReferenceTarget extends ReferenceOwner { fragment: string; on?: HostPointer }
export interface SourceReferenceTarget { kind: 'source'; source: Source & { publicationAvailable?: boolean; publishedPath?: string; publishedHtmlPath?: string }; sourceIndex: number; path: string; fragment: string }
export interface ReferenceResolution {
  status: 'resolved' | 'missing' | 'excluded' | 'unsupported' | 'unavailable' | 'external';
  heading?: HeadingObservation; target?: RecordReferenceTarget | SourceReferenceTarget; href?: string; candidatePath?: string;
}
export interface AuthoredReference extends ReferenceResolution {
  from: ReferenceOwner; href: string; location: ReferenceLocation;
  destination?: { start: number; end: number }; syntax: 'inline' | 'reference' | 'autolink';
}
export interface SourceCitation { from: ReferenceOwner; source: Source }
export interface ReferenceDiagnostic { code: string; path: string; line?: number; column?: number; message: string }
export interface ReferenceBounds { available: number; returned: number; exhaustive?: boolean }
export interface ReferenceIndex {
  format: 'atlas.references/1'; status: 'ready' | 'unavailable'; identity: string | null;
  references: AuthoredReference[]; citations: SourceCitation[]; diagnostics: ReferenceDiagnostic[];
  bounds: { limit: number; references: ReferenceBounds; citations: ReferenceBounds; exhaustive: boolean }; limits: string[];
}
export function referenceIndex(view: AtlasView, options?: { limit?: number }): ReferenceIndex;
export type ReferencePath = { id: string; tree: string; path: string };
export function resolveReference(view: AtlasView, from: ReferenceOwner & { sources?: Source[]; on?: HostPointer }, href: string, options?: { pointPaths?: ReferencePath[]; facetPaths?: ReferencePath[] }): ReferenceResolution;
export function referenceHref(resolved: ReferenceResolution, from: ReferenceOwner & { on?: HostPointer }): string | null;
export type CitationTarget = { point: string; facet?: never; tree?: never } | { point?: never; facet: string; tree: string };
export interface DirectCiters {
  format: 'atlas.citers/1'; status: 'ready' | 'unavailable'; identity: string | null;
  citers: Array<{ record: ReferenceOwner; references: AuthoredReference[] }>; bounds: ReferenceBounds; limits: string[];
}
export function directCiters(view: AtlasView, target: CitationTarget, options?: { limit?: number }): DirectCiters;
export interface SourceCitations {
  format: 'atlas.source-citations/1'; status: 'ready' | 'unavailable'; identity: string | null;
  uri: string; citations: SourceCitation[]; bounds: ReferenceBounds; limits: string[];
}
export function sourceCitations(view: AtlasView, options: { uri: string; limit?: number }): SourceCitations;
export function prepareMove(view: AtlasView, input: CitationTarget & { path: string; reason: string }): ChangePlan;
export function markdownHeadingIds(content: string, options?: { title?: string }): string[];
export interface HeadingObservation { fragment: string; status: 'resolved' | 'missing-heading' | 'uninspected'; reason: string }
export interface SourceObservation { uri: string; sha256: string }
export interface SourceReviewEntry {
  uri: string; status: 'current' | 'changed' | 'missing' | 'denied' | 'uninspected' | 'incomplete' | 'invalid';
  citations: SourceCitation[]; fragments?: HeadingObservation[]; fragment?: HeadingObservation; sha256?: string; bytes?: number; previousSha256?: string;
  expectedHashes?: string[]; mismatchedHashes?: string[]; code?: string; reason: string;
}
export interface SourceReview {
  format: 'atlas.source-review/1'; status: 'ready' | 'unavailable'; identity: string | null; observedAt: string;
  results: SourceReviewEntry[]; bounds: ReferenceBounds; limits: string[];
}
export function reviewSources(view: AtlasView, options: { uris?: string[]; allowedRoots: string[]; previous?: SourceObservation[]; limit?: number; maxBytes?: number }): Promise<SourceReview>;
