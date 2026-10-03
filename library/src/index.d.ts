export interface Diagnostic { code: string; path: string; message: string }
export * from './authoring.js';
export * from './navigation.js';
export * from './checks.js';
export * from './publication.js';
export * from './state.js';
export * from './references.js';
export interface Source {
  uri: string;
  title?: string;
  role?: 'evidence' | 'background' | 'example' | 'implementation' | 'history';
  revision?: string;
  locator?: string;
  sha256?: string;
}
export type PointType = 'decision' | 'observation';
export type DecisionStatus = 'open' | 'proposed' | 'selected' | 'rejected' | 'superseded';
export interface Ancestor { kind: 'point' | 'branch'; id: string; tree: string }
export type Placement = { point: string; children?: Placement[] } | { branch: string; title: string; children: Placement[] };
export interface Tree { id: string; title: string; scope: string; base: string; children: Placement[]; path: string }
export interface Point {
  id: string; tree: string; path: string; title: string; body: string; ancestors: Ancestor[];
  type?: PointType; status?: DecisionStatus; observedAt?: string; sources?: Source[]; uncertainty?: string;
}
export interface Branch { id: string; tree: string; title: string; children: Placement[]; ancestors: Ancestor[] }
export type HostPointer = { point: string } | { branch: string };
export type TargetPointer = HostPointer | { tree: string };
export interface Facet {
  id: string; tree: string; path: string; title: string; body: string;
  on: HostPointer; via: string; targets: TargetPointer[]; sources?: Source[]; uncertainty?: string;
}
export interface Check {
  id: string; status: 'draft' | 'active' | 'retired'; level: 'required' | 'advisory';
  path: string; title: string; body: string; revision: string;
}
export interface AtlasStyle { id: string; revision: string; title: string; body: string; path: string; derivedFrom?: string }
export interface CuratedStyle extends Omit<AtlasStyle, 'path'> { content: string }
export function listStyles(): Array<Pick<AtlasStyle, 'id' | 'revision' | 'title'>>;
export function getStyle(id: string): CuratedStyle | null;
export interface Atlas {
  format: 'atlas/1' | 'atlas/1.1'; id: string; title: string; style?: AtlasStyle;
  trees: Tree[]; points: Point[]; branches: Branch[]; facets: Facet[]; checks: Check[];
}
export interface CapturedFile { path: string; content: string | null; rawBase64?: string; sha256: string; bytes: number }
export type CapturedContent = string | { rawBase64: string };
export interface AtlasView {
  format: 'atlas.view/1'; status: 'ready' | 'invalid' | 'incomplete'; root: string;
  identity: string; files: CapturedFile[]; diagnostics: Diagnostic[]; atlas: Atlas | null;
}
export interface ReadBounds { maxFileBytes?: number; maxFiles?: number }
export interface OpenOptions extends ReadBounds { overrides?: Map<string, string | null> }
export function openAtlas(root: string, options?: OpenOptions): Promise<AtlasView>;
export function validateFiles(files: Map<string, CapturedContent> | Array<Pick<CapturedFile, 'path' | 'content' | 'rawBase64'>> | Record<string, CapturedContent>, options?: ReadBounds & { root?: string }): AtlasView;
export interface PointInspection extends Point { owner: Tree; facets: Facet[]; incomingFacets: Facet[]; sources: Source[] }
export interface TreeInspection extends Tree { points: Point[]; branches: Branch[]; facets: Facet[]; incomingFacets: Facet[] }
export interface FacetInspection extends Facet { owner: Tree; host: Point | Branch; viaTree: Tree; resolvedTargets: Array<Point | Branch | Tree>; sources: Source[] }
export function getPoint(view: AtlasView, id: string): PointInspection | null;
export function getTree(view: AtlasView, id: string): TreeInspection | null;
export function getFacet(view: AtlasView, target: { tree: string; id: string }): FacetInspection | null;
export interface SearchOptions { query: string; tree?: string; type?: PointType | 'untyped'; limit?: number; offset?: number; kinds?: Array<'point' | 'facet'>; presentation?: 'full' | 'summary' }
export interface SearchResult extends Point { kind?: 'point'; score: number; matches: Array<{ field: 'id' | 'title' | 'body' | 'uncertainty'; term: string }>; reason: string }
export interface PointSummary { summary: true; id: string; tree: string; path: string; title: string; type?: PointType; status?: DecisionStatus; observedAt?: string; uncertainty?: string; sourceCount: number; snippet: { text: string; start: number; end: number; totalLength: number }; selector: { point: string } }
export interface FacetSummary extends Omit<PointSummary, 'selector'> { kind: 'facet'; on: HostPointer; via: string; targets: TargetPointer[]; selector: { tree: string; facet: string } }
export type FacetSearchResult = Facet & { kind: 'facet' } & Pick<SearchResult, 'score' | 'matches' | 'reason'>;
export type FacetSearchSummary = FacetSummary & Pick<SearchResult, 'score' | 'matches' | 'reason'>;
export type SearchSummary = PointSummary & Pick<SearchResult, 'score' | 'matches' | 'reason'>;
export function searchAtlas(view: AtlasView, options: SearchOptions & { kinds: Array<'point' | 'facet'>; presentation: 'summary' }): Array<SearchSummary | FacetSearchSummary>;
export function searchAtlas(view: AtlasView, options: SearchOptions & { kinds: Array<'point' | 'facet'>; presentation?: 'full' }): Array<SearchResult | FacetSearchResult>;
export function searchAtlas(view: AtlasView, options: SearchOptions & { presentation: 'summary' }): SearchSummary[];
export function searchAtlas(view: AtlasView, options: SearchOptions & { presentation?: 'full' }): SearchResult[];
export function searchAtlas(view: AtlasView, options: SearchOptions): Array<SearchResult | SearchSummary | FacetSearchResult | FacetSearchSummary>;
export interface ViewComparison { same: boolean; before: string; after: string; added: string[]; removed: string[]; changed: string[] }
export function compareViews(before: AtlasView, after: AtlasView): ViewComparison;
export function validateSource(source: unknown): { valid: boolean; diagnostics: Diagnostic[] };
export interface SourceReadOptions { allowedRoots?: string[]; maxBytes?: number }
export interface SourceReadResult {
  status: 'ready' | 'reference' | 'missing' | 'denied' | 'invalid' | 'incomplete';
  source: Source; message: string; code?: string; path?: string; content?: string; bytes?: number; sha256?: string;
}
export function readSource(view: Pick<AtlasView, 'root'>, source: Source, options?: SourceReadOptions): Promise<SourceReadResult>;

export interface InventoryOptions { limit?: number; offset?: number; section?: 'files' | 'trees' | 'points' | 'branches' | 'facets' | 'checks' | 'diagnostics'; expectedIdentity?: string; full?: boolean }
export function summarizeAtlas(view: AtlasView, options?: InventoryOptions): Record<string, unknown>;
export function summarizeDraft(draft: import('./authoring.js').Draft, options?: Pick<InventoryOptions, 'limit' | 'offset' | 'full'>): Record<string, unknown>;
export function readJsonChunk(value: unknown, options?: { offset?: number; maxBytes?: number; expectedSha256?: string }): { status: 'ready'; encoding: 'utf-8'; byteLength: number; sha256: string; offset: number; returnedBytes: number; nextOffset: number | null; complete: boolean; text: string };
export function summarizeSourceHistory(history: import('./authoring.js').SourceHistory, options?: Pick<InventoryOptions, 'limit' | 'offset' | 'full'> & { expectedRevision?: string | null }): Record<string, unknown>;
