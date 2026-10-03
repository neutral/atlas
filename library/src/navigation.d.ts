import type { AtlasView, Ancestor, Branch, Diagnostic, Facet, Point, PointType, PointSummary, FacetSummary, AtlasStyle, Source, Tree } from './index.js';
import type { ChangePlan, FileChange, SourcePrecondition } from './authoring.js';
import type { DirectCiters, ReferenceDiagnostic } from './references.js';

export interface InclusionReason {
  kind: string; point?: string; tree?: string; branch?: string; facet?: string;
  pointDepth?: number; score?: number; explanation?: string; limit?: string;
  points?: string[]; changes?: string[]; matches?: Array<{ field: string; term: string }>;
}
export interface ResultBound { available: number; returned: number; offset?: number }
export interface PointReference {
  id: string; tree: string; title: string; path?: string; type?: PointType;
  status?: Point['status']; observedAt?: string; uncertainty?: string;
  reference: true; selector?: { point: string };
}
export interface PointReading<T = Point> { point: T; reasons: InclusionReason[] }
export interface FacetReading<F = Facet> { facet: F; reasons: InclusionReason[]; owner?: Omit<Tree, 'children'>; viaTree?: Omit<Tree, 'children'>; host?: PointReference & { kind: 'point' | 'branch' }; targets?: Array<PointReference & { kind: 'point' | 'branch' } | Omit<Tree, 'children'> & { kind: 'tree'; reference: true; selector: { tree: string } }> }
export type RouteSelector = { point: string; tree?: never; query?: never } | { tree: string; facet?: string; point?: never; query?: never } | { query: string; point?: never; tree?: never };
export type RouteSection = 'selected' | 'supporting' | 'facets';
export interface RouteCursor { identity: string; request: string; section: RouteSection; offset: number }
export type RouteOptions = RouteSelector & {
  detail?: 'overview' | 'standard' | 'deep'; type?: PointType | 'untyped'; limit?: number;
  kinds?: Array<'point' | 'facet'>; mode?: 'read' | 'discover'; orientation?: 'full' | 'compact'; cursor?: RouteCursor;
};
export interface RouteResult<P = Point, O = Point | Branch, F = Facet> {
  format: 'atlas.route/1'; status: 'ready' | 'missing' | 'ambiguous' | 'unavailable'; identity: string | null;
  request: RouteOptions & { detail: 'overview' | 'standard' | 'deep'; limit: number; mode: 'read' | 'discover'; orientation: 'full' | 'compact' };
  orientation: Array<{ tree: Omit<Tree, 'children'>; base: O extends PointReference ? PointReference : Point; ancestors: Array<Ancestor & { record: O }>; forPoints: string[] }>;
  selected: PointReading<P>[]; supporting: PointReading[]; facets: FacetReading<F>[];
  bounds?: { limit: number; selected: ResultBound; supporting: ResultBound; facets: ResultBound };
  next?: Partial<Record<RouteSection, RouteOptions>>; page?: { section: RouteSection; offset: number };
  search?: { window: number; exhaustive: boolean; limit: string };
  reason?: string; diagnostics?: Diagnostic[]; limits: string[];
}
export function route(view: AtlasView, options: RouteOptions & { mode: 'discover' }): RouteResult<PointSummary, PointReference | Point | Branch, FacetSummary>;
export function route(view: AtlasView, options: RouteOptions & { mode?: 'read'; orientation: 'compact' }): RouteResult<Point, PointReference>;
export function route(view: AtlasView, options: RouteOptions & { mode?: 'read'; orientation?: 'full' }): RouteResult;
export function route(view: AtlasView, options: RouteOptions): RouteResult<Point | PointSummary, Point | Branch | PointReference, Facet | FacetSummary>;
export interface AbsorbInspectionOptions { text: string; source: Source; tree?: string; limit?: number }
export interface AbsorbInspection {
  format: 'atlas.absorb-inspection/1'; status: 'candidates' | 'no-candidates' | 'missing' | 'unavailable'; identity: string | null;
  style?: AtlasStyle; incoming: { text: string; source: Source }; terms?: string[]; candidates: PointReading[];
  owners: Array<{ tree: Tree; base: Point; reasons: InclusionReason[] }>; interpretations: FacetReading[];
  bounds?: { limit: number; searchWindow: number; candidateWindowCount: number; searchExhaustive: boolean; owners: ResultBound; interpretations: ResultBound };
  reason?: string; diagnostics?: Diagnostic[]; limits: string[];
}
export function inspectAbsorb(view: AtlasView, options: AbsorbInspectionOptions): AbsorbInspection;
export interface ChangedRecord<T> { id: string; before: T | null; after: T | null }
export type PointChange = 'added' | 'removed' | 'type' | 'decision-status' | 'observation-date' | 'placement' | 'explanation' | 'sources' | 'uncertainty';
export interface ReviewRecord<T> { record: T; reasons: InclusionReason[] }
export interface ImpactContext { points: ReviewRecord<Point>[]; branches: ReviewRecord<Branch>[]; trees: ReviewRecord<Tree>[]; facets: ReviewRecord<Facet>[] }
export interface ImpactReview {
  format: 'atlas.impact-review/1'; status: 'ready' | 'unavailable'; beforeIdentity: string | null; afterIdentity: string | null;
  changedStyle?: { before: AtlasStyle | null; after: AtlasStyle | null };
  changedPoints?: Array<ChangedRecord<Point> & { changes: PointChange[] }>;
  changedFacets?: ChangedRecord<Facet>[]; changedTrees?: ChangedRecord<Tree>[]; changedBranches?: ChangedRecord<Branch>[];
  review?: { before: ImpactContext; after: ImpactContext }; reason?: string;
  mentions?: { before: Array<DirectCiters & { target: ReviewDestination }>; after: Array<DirectCiters & { target: ReviewDestination }> };
  linkDiagnostics?: ReferenceDiagnostic[];
  diagnostics?: { before: Diagnostic[]; after: Diagnostic[] }; limits: string[];
}
export function reviewImpact(before: AtlasView, after: AtlasView): ImpactReview;
export function reviewChange(plan: ChangePlan): ImpactReview;
export type ReviewDestination = { point: string; tree?: never; facet?: never } | { tree: string; facet: string; point?: never };
export type AbsorbContribution =
  | { disposition: 'update' | 'conflict' | 'reference-only'; point: string; rationale: string }
  | { disposition: 'create'; point: string; tree: string; rationale: string }
  | { disposition: 'facet'; tree: string; facet: string; rationale: string }
  | { disposition: 'non-integration'; rationale: string }
  | ({ disposition: 'remove'; rationale: string; destinations?: ReviewDestination[] } & ReviewDestination);
export interface PreservationUnit {
  id: string; source: Source; locator: string; disposition: 'retained' | 'reframed' | 'superseded' | 'historical' | 'non-integration' | 'unresolved';
  rationale: string; destinations?: ReviewDestination[];
}
export interface PreservationReview { scope: string; sources: Source[]; units: PreservationUnit[] }
export interface AbsorbReview {
  format: 'atlas.absorb-review/1'; baseline: string; candidateIdentity: string; planIdentity: string;
  source: Source; contributions: AbsorbContribution[]; rationale: string; unresolved: string[]; preservation?: PreservationReview;
}
export interface AbsorbProposalOptions { source: Source; contributions: AbsorbContribution[]; changes: FileChange[]; rationale: string; unresolved?: string[]; preservation?: PreservationReview; sourcePreconditions?: SourcePrecondition[] }
export interface AbsorbProposal {
  format: 'atlas.absorb-proposal/1'; status: 'ready' | 'invalid' | 'noop'; source: Source;
  contributions: AbsorbContribution[]; rationale: string; unresolved: string[]; plan: ChangePlan;
  decisionDiagnostics: Array<{ code: string; message: string; point?: string; facet?: string }>;
  impact: ImpactReview; review?: AbsorbReview; preservation?: PreservationReview; limits: string[];
}
export function prepareAbsorb(view: AtlasView, options: AbsorbProposalOptions): AbsorbProposal;

export function validateAbsorbReview(plan: ChangePlan, review: AbsorbReview): AbsorbReview;
