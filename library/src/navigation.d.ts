import type { AtlasView, Ancestor, Branch, Diagnostic, Facet, Point, PointType, Source, Tree } from './index.js';
import type { ChangePlan, FileChange } from './authoring.js';

export interface InclusionReason {
  kind: string; point?: string; tree?: string; branch?: string; facet?: string;
  pointDepth?: number; score?: number; explanation?: string; limit?: string;
  points?: string[]; changes?: string[]; matches?: Array<{ field: string; term: string }>;
}
export interface ResultBound { available: number; returned: number }
export interface PointReading { point: Point; reasons: InclusionReason[] }
export interface FacetReading { facet: Facet; reasons: InclusionReason[] }
export type RouteSelector = { point: string; tree?: never; query?: never } | { tree: string; point?: never; query?: never } | { query: string; point?: never; tree?: never };
export type RouteOptions = RouteSelector & { detail?: 'overview' | 'standard' | 'deep'; type?: PointType | 'untyped'; limit?: number };
export interface RouteResult {
  format: 'atlas.route/1'; status: 'ready' | 'missing' | 'ambiguous' | 'unavailable'; identity: string | null;
  request: RouteOptions & { detail: 'overview' | 'standard' | 'deep'; limit: number };
  orientation: Array<{ tree: Omit<Tree, 'children'>; base: Point; ancestors: Array<Ancestor & { record: Point | Branch }>; forPoints: string[] }>;
  selected: PointReading[]; supporting: PointReading[]; facets: FacetReading[];
  bounds?: { limit: number; selected: ResultBound; supporting: ResultBound; facets: ResultBound };
  search?: { window: number; exhaustive: boolean; limit: string };
  reason?: string; diagnostics?: Diagnostic[]; limits: string[];
}
export function route(view: AtlasView, options: RouteOptions): RouteResult;
export interface AbsorbInspectionOptions { text: string; source: Source; tree?: string; limit?: number }
export interface AbsorbInspection {
  format: 'atlas.absorb-inspection/1'; status: 'candidates' | 'no-candidates' | 'missing' | 'unavailable'; identity: string | null;
  incoming: { text: string; source: Source }; terms?: string[]; candidates: PointReading[];
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
  changedPoints?: Array<ChangedRecord<Point> & { changes: PointChange[] }>;
  changedFacets?: ChangedRecord<Facet>[]; changedTrees?: ChangedRecord<Tree>[]; changedBranches?: ChangedRecord<Branch>[];
  review?: { before: ImpactContext; after: ImpactContext }; reason?: string;
  diagnostics?: { before: Diagnostic[]; after: Diagnostic[] }; limits: string[];
}
export function reviewImpact(before: AtlasView, after: AtlasView): ImpactReview;
export type AbsorbContribution =
  | { disposition: 'update' | 'conflict' | 'reference-only'; point: string; rationale: string }
  | { disposition: 'create'; point: string; tree: string; rationale: string }
  | { disposition: 'facet'; tree: string; facet: string; rationale: string }
  | { disposition: 'non-integration'; rationale: string };
export interface AbsorbProposalOptions { source: Source; contributions: AbsorbContribution[]; changes: FileChange[]; rationale: string; unresolved?: string[] }
export interface AbsorbProposal {
  format: 'atlas.absorb-proposal/1'; status: 'ready' | 'invalid' | 'noop'; source: Source;
  contributions: AbsorbContribution[]; rationale: string; unresolved: string[]; plan: ChangePlan;
  decisionDiagnostics: Array<{ code: string; message: string; point?: string; facet?: string }>;
  impact: ImpactReview; limits: string[];
}
export function prepareAbsorb(view: AtlasView, options: AbsorbProposalOptions): AbsorbProposal;
