import type { Atlas, AtlasView, CitedMaterial, Source } from './index.js';
import type { ChangePlan } from './authoring.js';
export interface ReferenceOwner { kind: 'point' | 'facet'; id: string; tree: string; path?: string }
export interface ReferenceLocation { start: number; end: number; line: number; column: number }
export interface RecordReferenceTarget extends ReferenceOwner { fragment: string; on?: string }
export interface SourceReferenceTarget { kind: 'source'; source: Source; sourceIndex: number; path: string; fragment: string }
export interface ReferenceResolution {
  status: 'resolved' | 'missing' | 'unsupported' | 'unavailable' | 'external';
  target?: RecordReferenceTarget | SourceReferenceTarget; href?: string; candidatePath?: string;
}
export interface AuthoredReference extends ReferenceResolution {
  from: ReferenceOwner; href: string; location: ReferenceLocation;
  destination?: { start: number; end: number }; syntax: 'inline' | 'reference' | 'autolink';
}
export interface SourceCitation { from: ReferenceOwner; source: Source }
/** `REFERENCE_MISSING`, `REFERENCE_UNSUPPORTED`, `REFERENCE_FRAGMENT` (a link to a record, or within one, that carries a fragment) or `REFERENCE_LIMIT`. */
export interface ReferenceDiagnostic { code: string; path: string; line?: number; column?: number; message: string }
export interface ReferenceBounds { available: number; returned: number; exhaustive?: boolean }
export interface ReferenceIndex {
  format: 'atlas.references/1'; status: 'ready' | 'unavailable'; identity: string | null;
  references: AuthoredReference[]; citations: SourceCitation[]; diagnostics: ReferenceDiagnostic[];
  bounds: { limit: number; references: ReferenceBounds; citations: ReferenceBounds; exhaustive: boolean }; limits: string[];
}
export function referenceIndex(view: AtlasView, options?: { limit?: number }): ReferenceIndex;
/** Resolves against a captured view: a record it holds, or a source the linking record declares. */
export function resolveReference(view: { status: AtlasView['status']; atlas: Atlas | null }, from: ReferenceOwner & { sources?: Source[]; on?: string; title?: string; body?: string }, href: string): ReferenceResolution;
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

/** A citing record. A Facet names the Point it attaches to. */
export interface Citer extends ReferenceOwner { path: string; on?: string }
export type StaleStatus = 'current' | 'changed' | 'missing' | 'denied' | 'unstamped' | 'remote';
/** `code` says why a reference is `denied`, and is `'SOURCE_HEADING_MISSING'` on a `missing` one whose file is there but whose fragment names no heading in it. */
export interface StaleReference {
  from: Citer; sourceIndex: number; source: Source; status: StaleStatus;
  cited?: CitedMaterial; code?: string; reason: string;
}
export interface StaleSource { uri: string; status: 'changed' | 'missing'; code?: string; citers: Citer[] }
export interface StaleContinuation { offset: number; limit: number; expectedIdentity: string; records?: CitationTarget[]; references?: false }
export interface StaleReport {
  format: 'atlas.stale/1'; status: 'ready' | 'unavailable'; identity: string | null;
  counts: { references: number } & Record<StaleStatus, number>;
  /** Absent when the report was asked for without the entry of each reference (`references: false`). */
  references?: StaleReference[]; summary: StaleSource[];
  /**
   * `unread` counts the references not read past the bound of 10000 in one report; `exhaustive` is true only when nothing
   * remains past this page and none was left unread; `next` pages the references, or the summary alone without them.
   */
  bounds: { limit: number; offset: number; references?: ReferenceBounds; summary: ReferenceBounds; unread: number; exhaustive: boolean; next: StaleContinuation | null };
  limits: string[];
}
/** With `records`, only those Points and Facets are read and reported; an unknown record is `INVALID_REQUEST`. With `references: false`, the report is its counts and its summary. */
export function staleSources(view: AtlasView, options?: { allowedRoots?: string[]; limit?: number; offset?: number; expectedIdentity?: string; records?: CitationTarget[]; references?: boolean }): Promise<StaleReport>;

export interface StampReference { from: Citer; sourceIndex: number; uri: string }
export interface StampOptions { points?: string[]; tree?: string; all?: true; reason?: string; allowedRoots?: string[] }
export interface StampResult {
  format: 'atlas.stamp/1'; status: ChangePlan['status']; identity: string;
  selection: { points: string[] } | { tree: string } | { all: true };
  counts: { records: number; stamped: number; current: number; skipped: number };
  stamped: Array<StampReference & { scope: CitedMaterial['scope']; sha256: string; previous?: string }>;
  current: Array<StampReference & { scope: CitedMaterial['scope']; sha256: string }>;
  skipped: Array<StampReference & { status: 'remote' | 'missing' | 'denied'; code?: string; reason: string }>;
  plan: ChangePlan; limits: string[];
}
export function prepareStamp(root: string, options: StampOptions): Promise<StampResult>;
