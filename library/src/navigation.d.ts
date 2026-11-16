import type { AtlasView, Ancestor, AtlasStyle, Check, Diagnostic, Facet, Point, PointType, PointSummary, FacetSummary, Source, Tree } from './index.js';
import type { ChangePlan } from './authoring.js';
import type { DirectCiters, ReferenceDiagnostic } from './references.js';

export interface InclusionReason {
  kind: string; point?: string; tree?: string; facet?: string;
  pointDepth?: number; score?: number; explanation?: string; limit?: string;
  points?: string[]; changes?: string[]; matches?: Array<{ field: string; term: string }>;
}
export interface ResultBound { available: number; returned: number; offset?: number }
export interface PointReference {
  id: string; tree: string; title: string; path?: string; type?: PointType;
  status?: Point['status']; observedAt?: string; uncertainty?: string;
  reference: true; selector: { point: string };
}
export interface PointReading<T = Point> { point: T; reasons: InclusionReason[] }
export interface FacetReading<F = Facet> { facet: F; reasons: InclusionReason[]; owner?: Omit<Tree, 'children'>; viaTree?: Omit<Tree, 'children'>; host?: PointReference; targets?: PointReference[] }
export type RouteSelector = { point: string; tree?: never; query?: never } | { tree: string; facet?: string; point?: never; query?: never } | { query: string; point?: never; tree?: never };
export type RouteSection = 'selected' | 'supporting' | 'facets';
export interface RouteCursor { identity: string; request: string; section: RouteSection; offset: number }
export type RouteOptions = RouteSelector & {
  detail?: 'overview' | 'standard' | 'deep'; type?: PointType | 'untyped'; limit?: number;
  kinds?: Array<'point' | 'facet'>; mode?: 'read' | 'discover'; orientation?: 'full' | 'compact'; cursor?: RouteCursor;
};
export interface RouteResult<P = Point, O = Point, F = Facet> {
  format: 'atlas.route/1'; status: 'ready' | 'missing' | 'ambiguous' | 'unavailable'; identity: string | null;
  request: RouteOptions & { detail: 'overview' | 'standard' | 'deep'; limit: number; mode: 'read' | 'discover'; orientation: 'full' | 'compact' };
  orientation: Array<{ tree: Omit<Tree, 'children'>; base: O; ancestors: Array<Ancestor & { record: O }>; forPoints: string[] }>;
  selected: PointReading<P>[]; supporting: PointReading[]; facets: FacetReading<F>[];
  bounds?: { limit: number; selected: ResultBound; supporting: ResultBound; facets: ResultBound };
  next?: Partial<Record<RouteSection, RouteOptions>>; page?: { section: RouteSection; offset: number };
  search?: { window: number; available: number; exhaustive: boolean; limit: string };
  reason?: string; diagnostics?: Diagnostic[]; limits: string[];
}
export function route(view: AtlasView, options: RouteOptions & { mode: 'discover' }): RouteResult<PointSummary, PointReference | Point, FacetSummary>;
export function route(view: AtlasView, options: RouteOptions & { mode?: 'read'; orientation: 'compact' }): RouteResult<Point, PointReference>;
export function route(view: AtlasView, options: RouteOptions & { mode?: 'read'; orientation?: 'full' }): RouteResult;
export function route(view: AtlasView, options: RouteOptions): RouteResult<Point | PointSummary, Point | PointReference, Facet | FacetSummary>;
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
/** A Point as the Atlas before a change holds it. Where that Atlas does not validate, a Point its outline does not place has `ancestors` null, and one in a Tree folder whose tree.json cannot be read has `tree` null too. */
export type EarlierPoint = Omit<Point, 'tree' | 'ancestors'> & { tree: string | null; ancestors: Point['ancestors'] | null };
export type PointChange = 'added' | 'removed' | 'type' | 'decision-status' | 'observation-date' | 'placement' | 'title' | 'explanation' | 'sources' | 'uncertainty';
export interface ReviewRecord<T> { record: T; reasons: InclusionReason[] }
export interface ImpactContext { points: ReviewRecord<Point>[]; trees: ReviewRecord<Tree>[]; facets: ReviewRecord<Facet>[] }
/** What differs in atlas.json. `order` appears when the Trees both sides hold stand in another order, and gives each side's Tree IDs in manifest order. */
export interface ManifestChange {
  /** `before` is null where the Atlas before the change holds no manifest that can be read. */
  title?: { before: string | null; after: string }; id?: { before: string | null; after: string };
  order?: { before: string[]; after: string[] }; added: string[]; removed: string[];
}
export type ReviewTarget ={ point: string; tree?: never; facet?: never } | { tree: string; facet: string; point?: never };
export interface ImpactReview {
  /** `unavailable` when the Atlas after the change does not validate, or the one before it was not read whole. */
  format: 'atlas.impact-review/1'; status: 'ready' | 'unavailable'; beforeIdentity: string | null; afterIdentity: string | null;
  changedPoints?: Array<{ id: string; before: EarlierPoint | null; after: Point | null; changes: PointChange[] }>;
  changedFacets?: ChangedRecord<Facet>[]; changedTrees?: ChangedRecord<Tree>[]; changedChecks?: ChangedRecord<Check>[];
  /** Present on a ready review; `null` when the bytes of atlas.json are the same. */
  changedManifest?: ManifestChange | null;
  /** `before` is null where the Atlas before the change holds no Style that can be read. */
  changedStyle?: { before: AtlasStyle | null; after: AtlasStyle };
  review?: { before: ImpactContext; after: ImpactContext }; reason?: string;
  mentions?: { before: Array<DirectCiters & { target: ReviewTarget }>; after: Array<DirectCiters & { target: ReviewTarget }> };
  linkDiagnostics?: ReferenceDiagnostic[];
  diagnostics?: { before: Diagnostic[]; after: Diagnostic[] }; limits: string[];
}
export function reviewImpact(before: AtlasView, after: AtlasView): ImpactReview;
export function reviewChange(plan: ChangePlan): ImpactReview;
