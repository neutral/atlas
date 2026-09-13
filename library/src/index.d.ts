/** Public Atlas reading types. Private storage and parser state are not model contracts. */
export * from './evaluation-types.js';
export * from '../../apps/agent/src/agent-types.js';

/** Exact recognized local target paths; metadata alone grants no reading or writing authority. */
export function localSourceTargets(view: AtlasView): readonly string[];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Extensions = { [key: `x-${string}`]: JsonValue };
export type ContentTarget = Extensions & ({ resource: string; selector?: string; uri?: never } | { uri: string; resource?: never; selector?: never }) & { label?: string };
export type ReferenceRole = 'evidence' | 'supporting' | 'implementation' | 'historical' | 'example';
/** Derived reference explanations come from Markdown; they are not authored JSON fields. */
export type ContentAssociation = ContentTarget & { id: string; note?: string };
export type Reference = ContentTarget & { id: string; role: ReferenceRole; note?: string };
/** A Resource title remains an authored short label; its optional summary comes from Markdown. */
export type Resource = Extensions & { id: string; uri: string; title: string; summary?: string; 'media-type'?: string };
/** Area labels remain structured; summaries, questions, and membership context come from Markdown. */
export type Area = Extensions & { id: string; title: string; summary: string; question: string; content?: ContentAssociation[]; references?: Reference[] };
export type AreaMembership = Extensions & { id: string; area: string; context: string };
export type NavigationGroup = Extensions & { title: string; maps: string[] };
export type Review = Extensions & { 'reviewed-at'?: string; 'review-after'?: string; by?: string[] };
export type PointKind = 'decision' | 'constraint' | 'observation' | 'question' | 'proposal' | 'direction' | 'implementation' | 'requirement' | 'risk' | 'goal' | 'practice' | `x-${string}`;
export type RelationType = 'supersedes' | 'depends-on' | 'supports' | 'contradicts' | 'refines' | 'implements' | `x-${string}`;
export type CheckSubject = 'atlas' | 'map' | 'area' | 'point-anchor' | 'point-context' | 'resource' | 'check' | 'publication';

export type NormalizedRoot = {
  id: string; title: string; summary: string; navigation: NavigationGroup[];
  resources: Resource[]; content: ContentAssociation[]; references: Reference[];
  extensions: Extensions; body: string;
};
export type NormalizedMap = {
  id: string; title: string; summary: string; question: string;
  status: 'draft' | 'active' | 'archived'; path: string; areas: Area[];
  content: ContentAssociation[]; references: Reference[]; extensions: Extensions; body: string;
  pointIds: string[]; anchorPointIds: string[]; contextPointIds: string[];
};
export type PointRecord = {
  kind: 'anchor' | 'context'; map: string; path: string; title: string; summary: string;
  areas: AreaMembership[]; content: ContentAssociation[]; references: Reference[];
  extensions: Extensions; body: string;
};
export type NormalizedRelation = {
  id: string;
  sourcePoint: string; sourceMap: string; sourcePath: string;
  type: RelationType; targetPoint: string; note: string; extensions: Extensions;
};
export type NormalizedPoint = {
  id: string; title: string; summary: string; kinds: PointKind[];
  posture: 'asserted' | 'open' | 'proposed' | 'intended';
  lifecycle: 'active' | 'historical' | 'superseded' | 'withdrawn';
  primaryMap: string; anchorPath: string; records: PointRecord[];
  relations: NormalizedRelation[]; incomingRelations: NormalizedRelation[];
  review: Review | null; extensions: Extensions;
};
export type CheckRegistration = Extensions & { check: string; level: 'required' | 'advisory'; 'applies-to': CheckSubject[] };
export type NormalizedCheck = {
  registration: CheckRegistration;
  id: string; title: string; summary: string; status: 'draft' | 'active' | 'retired';
  level: 'required' | 'advisory'; appliesTo: CheckSubject[];
  path: string; extensions: Extensions; body: string;
};
export type PublicationSelection = {
  atlas: boolean; maps: string[];
  points: { id: string; records: Pick<PointRecord, 'map' | 'kind' | 'path'>[] }[];
  resources: string[]; checks: string[];
};
export type NormalizedPublicationProfile = {
  id: string; title: string; summary: string; path: string;
  selection: PublicationSelection; extensions: Extensions; body: string;
};
export type RelatedMaps = { maps: [string, string]; pointIds: string[] };
/** Complete valid resolved model conforming to urn:atlas:schema:normalized:2. */
export type NormalizedAtlas = {
  format: 2; atlas: NormalizedRoot; maps: NormalizedMap[]; points: NormalizedPoint[];
  checks: NormalizedCheck[]; publicationProfiles: NormalizedPublicationProfile[]; relatedMaps: RelatedMaps[];
};

export type DiagnosticSeverity = 'error' | 'warning' | 'information';
export type DiagnosticLocation = { path?: string; pointer?: string; line?: number; column?: number; details?: JsonValue };
export class Diagnostic {
  constructor(code: string, severity: DiagnosticSeverity, message: string, location?: DiagnosticLocation);
  code: string; severity: DiagnosticSeverity; message: string;
  path?: string; pointer?: string; line?: number; column?: number; details?: JsonValue;
}
export type Implementation = { name: string; version: string; status: 'working' | 'stable' };
export type ValidationOutput = {
  profile: string; complete: boolean; valid: boolean; specificationRevision: string;
  implementation: Implementation; diagnostics: Diagnostic[];
  /** Present only on a complete valid resolved result. */
  normalized?: NormalizedAtlas;
};
export class ValidationResult implements ValidationOutput {
  constructor(options: { profile: string; specificationRevision?: string; complete?: boolean; diagnostics?: Diagnostic[]; normalized?: NormalizedAtlas | null });
  profile: string; complete: boolean; valid: boolean; specificationRevision: string;
  implementation: Implementation; diagnostics: Diagnostic[]; normalized?: NormalizedAtlas;
  toJSON(): ValidationOutput;
}
export const STRUCTURAL_PROFILE: 'neutral.atlas-validator.structural';
export const RESOLVED_PROFILE: 'neutral.atlas-validator.resolved';
export const SUPPORTED_PROFILES: Set<typeof STRUCTURAL_PROFILE | typeof RESOLVED_PROFILE>;
export type ValidationOptions = { profile?: string; specificationRevision?: string };
export function validateAtlas(atlasPath: string, options?: ValidationOptions): ValidationResult;
export function compareCodePoints(left: unknown, right: unknown): number;
export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number;

export type InspectionValidation = Omit<ValidationOutput, 'normalized' | 'diagnostics'> & {
  diagnosticCounts: Record<DiagnosticSeverity, number>;
  /** Full diagnostics are included when validation is invalid or incomplete. */
  diagnostics?: Diagnostic[];
};
export type InspectedMap = Pick<NormalizedMap, 'id' | 'title' | 'summary' | 'question' | 'status' | 'path' | 'areas' | 'extensions'>;
export type PointInspectionBase = {
  contract: 'atlas.point-inspection/1'; atlasRoot: string; pointId: string;
  validation: InspectionValidation; limits: string[];
};
export type PointInspection = PointInspectionBase & (
  | { status: 'found'; atlas: { id: string; title: string; path: 'atlas.md' }; point: NormalizedPoint; maps: InspectedMap[]; resources: Resource[] }
  | { status: 'not-found' | 'invalid' | 'incomplete' }
);
export type OpenAtlasOptions = { specificationRevision?: string; maxDocumentBytes?: number };
export function inspectPoint(atlasPath: string, pointId: string, options?: OpenAtlasOptions): DeepReadonly<PointInspection>;
/** Opened observations and every returned nested model are immutable. */
export type DeepReadonly<T> = T extends readonly [unknown, ...unknown[]]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends (...args: infer A) => infer R ? (...args: A) => DeepReadonly<R>
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export class AtlasToolError extends Error {
  constructor(code: string, message: string);
  name: 'AtlasToolError';
  code: string;
}
export type FileInput = { path: string; kind: 'file'; byteLength: number; sha256: string };
export type ViewInput = FileInput
  | { path: string; kind: 'symlink'; target: string }
  | { path: string; kind: 'directory' | 'nested-atlas' | 'special' }
  | { path: string; kind: 'missing' }
  | { path: string; kind: 'unreadable'; error: string };
export type InputIssue = { path: string; code: string; message: string };
export type InputChange = { path: string; change: 'added' | 'removed' | 'changed' };
export type ViewIdentity = {
  digest: string | null; inputDigest: string | null; inputs: ViewInput[];
  configuration: { maxDocumentBytes: number };
  scope: {
    root: string; ignoredDirectories: string[];
    nestedAtlases: 'excluded'; explicitLocalTargets: string[];
  } & (
    | { kind: 'working-tree'; externalResources: 'not-read' }
    | { kind: 'snapshot'; externalResources: 'not-fetched'; repositoryRoot: string; repositoryDigest: string; revision: string | null }
  );
  specificationRevision: string; implementation: Implementation;
  consistency: 'checked-working-tree' | 'immutable-snapshot';
};
export type ResourceUseOwner =
  | { type: 'atlas'; path: 'atlas.md' }
  | { type: 'map'; path: string; mapId: string; question: string }
  | { type: 'area'; path: string; mapId: string; areaId: string; question: string }
  | { type: 'point-record'; path: string; mapId: string; pointId: string; recordKind: 'anchor' | 'context' };
export type ResourceUse = { owner: ResourceUseOwner } & (
  | { use: 'content'; target: Extract<ContentTarget, { resource: string }> }
  | { use: 'reference'; target: Extract<Reference, { resource: string }> }
);
export type ResourceInspection = {
  contract: 'atlas.resource-inspection/1'; atlasRoot: string; resourceId: string;
  identity: ViewIdentity; limits: string[];
} & (
  | { status: 'found'; resource: Resource; uses: ResourceUse[] }
  | { status: 'not-found' | 'invalid' | 'incomplete' }
);
export type SearchType = 'map' | 'area' | 'point' | 'resource' | 'check';
export type SearchMode = 'ranked' | 'fts';
export type FindOptions = { limit?: number; types?: readonly SearchType[]; cursor?: string; mode?: SearchMode };
export type SearchIdentity = Pick<ViewIdentity, 'digest' | 'inputDigest' | 'specificationRevision' | 'consistency'> & {
  scope: Pick<ViewIdentity['scope'], 'kind' | 'root'>;
};
export type SearchMatch = { path: string; mapId?: string; recordKind?: 'anchor' | 'context'; excerpt: string; score: number };
export type SearchCandidate = {
  id: string; title: string; summary?: string; path: string; score: number; reasons: string[];
  exactMatch: boolean; matchCount: number; matches: SearchMatch[];
} & (
  | { type: 'map' | 'check' }
  | { type: 'area'; mapId: string }
  | { type: 'point'; mapIds: string[] }
  | { type: 'resource'; uri: string }
);
export type FindResult = {
  status: 'ready' | 'invalid' | 'incomplete'; identity: SearchIdentity;
  query: { mode: SearchMode; expression: string | null };
  items: SearchCandidate[]; total: number; nextCursor: string | null; limits: string[];
};
export type DocumentReadResult = {
  path: string; viewDigest: string | null; diagnostics: Diagnostic[];
} & (
  | { status: 'missing'; input?: Extract<ViewInput, { kind: 'missing' }> }
  | { status: 'unreadable' | 'unsupported'; input: Exclude<ViewInput, FileInput> }
  | { status: 'read' | 'truncated' | 'unsupported'; input: FileInput; bytesBase64: string; text?: string; truncated: boolean }
);
export type ComparedRecord = NormalizedRoot | NormalizedMap | NormalizedPoint | Resource | NormalizedCheck | NormalizedPublicationProfile;
export type RecordChange = { key: string; change: 'added' | 'removed' | 'changed'; before: ComparedRecord | null; after: ComparedRecord | null };
export type ComparisonResult = {
  status: 'compared' | 'unavailable'; before: ViewIdentity; after: ViewIdentity;
  sourceChanges: InputChange[]; records: RecordChange[]; limits: string[];
};
export type FreshnessResult = {
  status: 'fresh' | 'stale' | 'unavailable'; expectedInputDigest: string | null;
  currentInputDigest: string | null; changes: InputChange[]; issues: InputIssue[];
};
export type SourceTarget = ContentTarget | Reference;
export type SourceReaderRequest = { uri: string; selector: string | null; maxBytes: number };
export type SourceReaderOutput = {
  bytes: Uint8Array; selectorApplied?: boolean; complete?: boolean;
  provenance?: string; mediaType?: string;
};
export type SourceReadOptions = {
  ownerPath?: string; allowedRoots?: readonly string[]; maxBytes?: number;
  reader?: (request: SourceReaderRequest) => SourceReaderOutput | Promise<SourceReaderOutput>;
};
export type SourceObservation = {
  observedAt: string; sha256: string; byteLength: number;
  digestScope: 'returned-bytes'; complete: boolean;
} & (
  | { kind: 'local-file'; path: string; totalByteLength: number }
  | { kind: 'immutable-file'; path: string; totalByteLength: number; repositoryDigest: string; revision: string | null }
  | { kind: 'caller-reader'; uri: string; provenance?: string; mediaType?: string }
);
export type SourceReadResult = {
  contract: 'atlas.source-read/1'; viewDigest: string | null; target: SourceTarget;
  uri?: string; ownerPath?: string; resource?: Resource; limits: string[];
} & (
  | { status: 'unavailable' | 'missing' | 'unrequested' | 'unsupported' | 'unreadable' | 'stale'; reason: string }
  | { status: 'read' | 'truncated' | 'unsupported'; text?: string; bytesBase64: string; truncated: boolean; observation: SourceObservation }
);
export type AtlasView = {
  readonly contract: 'atlas.read-view/2';
  readonly atlasRoot: string;
  readonly status: 'ready' | 'invalid' | 'incomplete';
  readonly identity: DeepReadonly<ViewIdentity>;
  readonly validation: DeepReadonly<ValidationResult>;
  readonly limits: readonly string[];
  readonly inspectPoint: (pointId: string) => DeepReadonly<PointInspection>;
  readonly inspectResource: (resourceId: string) => DeepReadonly<ResourceInspection>;
  readonly readDocument: (relativePath: string) => DeepReadonly<DocumentReadResult>;
  readonly readSource: (target: SourceTarget, options?: SourceReadOptions) => Promise<DeepReadonly<SourceReadResult>>;
  readonly find: (query: string, options?: FindOptions) => DeepReadonly<FindResult>;
  readonly compare: (other: AtlasView) => DeepReadonly<ComparisonResult>;
  readonly freshness: () => DeepReadonly<FreshnessResult>;
  readonly refresh: () => AtlasView;
};
export function openAtlas(atlasPath: string, options?: OpenAtlasOptions): AtlasView;

export type AtlasSnapshotInput = {
  repositoryRoot: string; atlasPath: string;
  files: Readonly<Record<string, string | Uint8Array>>;
  directories?: readonly string[]; revision?: string;
};
/** Copy complete supplied bytes into a sealed source with no host filesystem fallback. */
export function openAtlasSnapshot(input: AtlasSnapshotInput, options?: OpenAtlasOptions): AtlasView;

export type WorkspaceConfiguration = OpenAtlasOptions;
export type WorkspaceOptions = {
  repositoryRoot: string; atlasPath?: string; configuration?: WorkspaceConfiguration;
};
export type WorkspaceInfo = {
  repositoryRoot: string; atlasRoot: string; atlasPath: string;
  configuration: Required<WorkspaceConfiguration>; configurationDigest: string;
  configurationSourceDigest: string | null;
};
export type WorkspaceReadResult = {
  contract: 'atlas.workspace-view/2'; view: AtlasView; freshness: DeepReadonly<FreshnessResult>;
};
export type AtlasWorkspace = {
  readonly info: DeepReadonly<WorkspaceInfo>;
  readonly read: () => Readonly<WorkspaceReadResult>;
  readonly refresh: () => Readonly<WorkspaceReadResult>;
  readonly close: () => void;
};
/** Synchronous workspace with one current in-memory observation and no disk state. */
export function openWorkspace(options: WorkspaceOptions): AtlasWorkspace;

/** Existing parsing helpers. These do not execute Check verification. */
export type MarkdownToken = {
  type: string; tag: string; attrs: [string, string][] | null; map: [number, number] | null;
  nesting: -1 | 0 | 1; level: number; children: MarkdownToken[] | null;
  content: string; markup: string; info: string; meta: unknown; block: boolean; hidden: boolean;
  attrIndex(name: string): number;
  attrPush(attrData: [string, string]): void;
  attrSet(name: string, value: string): void;
  attrGet(name: string): string | null;
  attrJoin(name: string, value: string): void;
};
export type BodyMeasure = { text: string; scalarCount: number; hasContentBlock: boolean };
export function parseMarkdown(body: string): MarkdownToken[];
export function substantiveBody(body: string): BodyMeasure;
export function checkSections(body: string): (BodyMeasure & { label: string })[];
export function validFullDate(value: string): boolean;
export type Fixture = {
  path: string; profile?: string; complete: boolean; valid: boolean;
  diagnostics?: string[]; expected?: string;
  [key: string]: JsonValue | undefined;
};
export type FixtureResult = { fixture: Fixture; result: ValidationResult; actualCodes: string[]; normalizedMatches: boolean; pass: boolean };
export function validateFixtureManifest(manifestPath: string, options?: OpenAtlasOptions): FixtureResult[];

/** Logical authored metadata partitioned into local headers, catalog, and connections. Prose is supplied only through Markdown bodies. */
export type AuthoringFields = Record<string, JsonValue>;
export type AuthoringPatch = { set?: AuthoringFields; unset?: string[] };
export type AtlasAuthoringOperation =
  | { type: 'initialize'; fields: AuthoringFields; body?: string }
  | ({ type: 'map'; id: string; body?: string } & AuthoringPatch & (
    | { action: 'create'; directory: string }
    | { action: 'update'; directory?: never }
  ))
  | ({ type: 'area'; action: 'create' | 'update'; id: string; mapId: string; body?: string } & AuthoringPatch)
  | ({ type: 'point'; action: 'create' | 'update'; id: string; mapId: string; record: 'anchor' | 'context'; body?: string } & AuthoringPatch)
  | ({ type: 'resource'; action: 'create' | 'update'; id: string; body?: string } & AuthoringPatch)
  | { type: 'supersede'; sourceId: string; targetId: string; note: string }
  | { type: 'catalog'; set?: AuthoringFields; unset?: string[] }
  | ({ type: 'connection'; action: 'create' | 'update'; id: string; collection: 'memberships' | 'relations' | 'content' | 'references'; body?: string } & AuthoringPatch)
  | { type: 'adopt-check'; id: string; text: string; registration: CheckRegistration; source: { uri: string; sha256?: string } }
  | { type: 'publication'; action: 'create'; id: string; text: string }
  | { type: 'repair-document'; path: string; text: string };
export type PrepareAtlasChangeRequest = {
  repositoryRoot: string; atlasPath: string; configuration?: WorkspaceConfiguration;
  expected: { viewDigest: string; atlasMissing?: never } | { atlasMissing: true; viewDigest?: never };
  operations: AtlasAuthoringOperation[];
};
export type AuthoringFileBytes = { sha256: string; bytesBase64: string; byteLength: number };
export type AuthoringFileChange = {
  path: string; operation: 'create' | 'update'; before: AuthoringFileBytes | null; after: AuthoringFileBytes; diff: string;
};
export type AuthoringSubject = { type: CheckSubject | 'unknown'; id: string | null; path: string; mapId?: string };
export type AuthoringPointDecision = {
  pointId: string; record: 'anchor' | 'context'; mapId: string; mapQuestion?: string;
  anchor: { path: string; mapId?: string; sha256: string; origin: 'baseline' | 'proposal' } | null;
};
export type AuthoringCheckSubject = { kind: CheckSubject; id?: string; map?: string; path: string };
export type AuthoringCheckDiscovery = {
  scope: 'whole-proposal'; complete: boolean; requiredSatisfied: boolean;
  applicable: { id: string; path: string; level: 'required' | 'advisory'; revision: string;
    subjects: AuthoringCheckSubject[]; outcome: 'unable'; reason: string }[];
  unresolved: { id: string; title: string; summary: string; path: string; status: 'active'; level: 'required' | 'advisory' | null;
    revision: string | null; appliesTo: CheckSubject[] | null; subjects: null;
    applicability: { status: 'unresolved'; reasons: string[] }; outcome: 'unable'; reason: string }[];
  diagnostics: { path?: string; message: string }[]; unresolvedCheckIds: string[];
};
export type AtlasChangePlan = {
  contract: 'atlas.change-plan/2'; digest: string; status: 'ready' | 'no-op' | 'invalid';
  repositoryRoot: string; atlasRoot: string; atlasPath: string; request: PrepareAtlasChangeRequest;
  configuration: Required<WorkspaceConfiguration>; configurationSourceDigest: string | null;
  processorDigest: string;
  baseline: {
    identity: ViewIdentity | null; explicitLocalTargets: string[]; inputDigest: string; inputs: ViewInput[];
    files: (AuthoringFileBytes & { path: string })[]; directories: string[]; boundaries: string[];
    rootPresent: boolean; atlasPresent: boolean;
  };
  changes: AuthoringFileChange[]; pointDecisions: AuthoringPointDecision[]; subjects: AuthoringSubject[];
  adoptedChecks: { id: string; path: string; registration: CheckRegistration; source: { uri: string; sha256?: string }; sha256: string }[];
  localTargets: { before: string[]; after: string[] };
  validation: { before: ValidationOutput; after: ValidationOutput }; checks: AuthoringCheckDiscovery;
  gaps: string[]; limits: string[];
};
export type ApplyAtlasChangeOptions = { recoveryDirectory: string; mode?: 'validated' | 'draft' };
export type AtlasChangeApplication = {
  contract: 'atlas.change-application/1'; planDigest: string | null; status: 'applied' | 'no-op' | 'stale' | 'partial';
  written: string[]; pending: string[]; conflicts: { path: string | null; reason: string }[];
  recoveryDirectory?: string; recovery?: { status: 'removed' | 'retained' | 'cleanup-failed' };
  createdDirectories?: string[]; validation?: ValidationOutput; gaps: string[]; limits: string[];
};
export type AtlasRecoverySelection = { repositoryRoot: string; atlasPath: string; recoveryDirectory: string };
export type AtlasRecoveryInspection = AtlasRecoverySelection & {
  contract: 'atlas.change-recovery-inspection/1'; planDigest: string; inactive: boolean; digest: string;
  files: { path: string; sha256: string; bytesBase64: string; identity: string }[]; limits: string[];
};
export type AtlasRecoveryDiscard = {
  contract: 'atlas.change-recovery-discard/1'; status: 'discarded' | 'partial'; recoveryDirectory: string; removed: string[]; gaps: string[];
};
export type PreparedCheckRun = {
  contract: 'atlas.prepared-check-run/1'; planDigest: string; paths: string[];
  run: import('./evaluation-types.js').CheckRun;
};
/** Preparation captures complete bytes and validates the proposal without writes. */
export function prepareAtlasChange(request: DeepReadonly<PrepareAtlasChangeRequest>): DeepReadonly<AtlasChangePlan>;
/** Application retains recovery before mutation and removes it after confirmed application. */
export function applyAtlasChange(plan: DeepReadonly<AtlasChangePlan>, options: ApplyAtlasChangeOptions): DeepReadonly<AtlasChangeApplication>;
/** Read exact recovery content and process ownership without changing storage or Atlas files. */
export function inspectAtlasRecovery(options: AtlasRecoverySelection): DeepReadonly<AtlasRecoveryInspection>;
/** Explicitly discard the inspected inactive operation; source files are never restored or changed. */
export function discardAtlasRecovery(options: AtlasRecoverySelection & { inspectedDigest: string }): DeepReadonly<AtlasRecoveryDiscard>;
/** Explicit evaluation runs against the sealed proposed source, with plan provenance. */
export function evaluatePreparedChange(plan: DeepReadonly<AtlasChangePlan>, options: import('./evaluation-types.js').EvaluateChecksOptions): Promise<DeepReadonly<PreparedCheckRun>>;
