import type { AtlasView, CheckSubject, DeepReadonly, FreshnessResult, NormalizedCheck, CheckRegistration, ValidationOutput, ViewIdentity } from './index.js';

export type EvaluationActor = { kind: 'human' | 'agent' | 'tool'; id: string };
export type EvaluationSubject = { kind: CheckSubject; path: string; id?: string; map?: string };
export type EvaluationDiagnostic = { message: string; path?: string };
export type CheckRevision = { id: string; revision: string };
export type EvaluatorDescriptor = { id: string; version: string; checks: CheckRevision[]; capabilities: string[] };
export type EvaluatorRegistry = DeepReadonly<{ contract: 'atlas.evaluator-registry/1'; evaluators: EvaluatorDescriptor[] }>;
/** Trusted host functions retain their ambient process permissions. This is not a sandbox. */
export type EvaluationCapability = (...args: unknown[]) => unknown;
export type EvaluatorContext = {
  readonly view: AtlasView;
  readonly check: DeepReadonly<NormalizedCheck & { revision: string }>;
  readonly subjects: readonly DeepReadonly<EvaluationSubject>[];
  readonly actor: DeepReadonly<EvaluationActor>;
  readonly capabilities: Readonly<Record<string, EvaluationCapability>>;
  readonly signal?: AbortSignal;
};
export type VerifierEvidence = string | { summary: string; data: string | Uint8Array; mediaType?: string };
export type VerifierResult = {
  outcome: 'pass' | 'fail' | 'unable'; summary: string;
  evidence: readonly VerifierEvidence[]; diagnostics: readonly (string | EvaluationDiagnostic)[];
};
export type EvaluatorRegistration = {
  id: string; version: string; checks: readonly CheckRevision[]; capabilities?: readonly string[];
  verify(context: EvaluatorContext): VerifierResult | Promise<VerifierResult>;
};
/** Hash exact Markdown bytes and the canonical assembled catalog registration, including Check-owned extensions. */
export function calculateCheckRevision(bytes: string | Uint8Array, registration: CheckRegistration): string;
export function createEvaluatorRegistry(registrations?: readonly EvaluatorRegistration[]): EvaluatorRegistry;

export type CheckSelection = { paths?: readonly string[]; checkIds?: readonly string[]; registry?: EvaluatorRegistry };
export type DiscoverChecksOptions = CheckSelection & {
  status?: 'draft' | 'active' | 'retired'; level?: 'required' | 'advisory'; appliesTo?: CheckSubject;
};
export type DiscoveredCheck = Pick<NormalizedCheck, 'id' | 'title' | 'summary' | 'path' | 'status'> & {
  /** Unknown registration fields remain null; unresolved extensions can independently prevent a revision. */
  level: NormalizedCheck['level'] | null; appliesTo: CheckSubject[] | null; revision: string | null;
  /** Null preserves unavailable subject resolution; an empty array means resolved absence. */
  subjects: EvaluationSubject[] | null;
  applicability: { status: 'resolved' | 'unresolved'; reasons: string[] };
  evaluator: EvaluatorDescriptor | null;
};
export type CheckDiscovery = {
  contract: 'atlas.check-discovery/1'; status: 'ready' | 'invalid' | 'incomplete'; sourceIdentity: ViewIdentity;
  /** Recovery of all local Check definitions and registrations before filtering, independent of Atlas validity. */
  complete: boolean; diagnostics: EvaluationDiagnostic[];
  items: DiscoveredCheck[]; unresolvedPaths: string[]; unresolvedCheckIds: string[]; limits: string[];
};
export function discoverChecks(view: AtlasView, options?: DiscoverChecksOptions): DeepReadonly<CheckDiscovery>;

export type EvaluateChecksOptions = CheckSelection & {
  actor: EvaluationActor; capabilities?: Readonly<Record<string, EvaluationCapability>>; signal?: AbortSignal;
};
export type CapturedEvaluationEvidence = { summary: string; mediaType: string; bytesBase64: string; byteLength: number; sha256: string };
export type EvaluatorReceipt = {
  id: string; version: string; capabilities: string[]; startedAt: string; completedAt: string; invoked: boolean;
};
export type CheckEvaluation = {
  check: string; revision: string; path: string; status: 'draft' | 'active' | 'retired'; level: 'required' | 'advisory';
  subjects: EvaluationSubject[]; actor: EvaluationActor; outcome: 'pass' | 'fail' | 'unable' | 'not-applicable';
  summary: string; evidence: CapturedEvaluationEvidence[]; diagnostics: EvaluationDiagnostic[]; evaluator: EvaluatorReceipt | null;
};
export type EvaluationCoverage = {
  wholeAtlas: boolean;
  omittedChecks: (CheckRevision & { status: 'draft' | 'active' | 'retired'; level: 'required' | 'advisory'; subjects: EvaluationSubject[] })[];
  uncoveredSubjects: { check: string; status: 'draft' | 'active' | 'retired'; level: 'required' | 'advisory'; subjects: EvaluationSubject[] }[];
  unresolvedPaths: string[]; inapplicableChecks: { id: string; reason: string }[];
};
export type PreparedEvaluationBinding = { planDigest: string; paths: string[] };
export type CheckRun = {
  contract: 'atlas.check-run/1'; id: string; startedAt: string; completedAt: string; actor: EvaluationActor;
  atlas: string | null; atlasRoot: string; sourceIdentity: ViewIdentity; validation: ValidationOutput;
  status: 'evaluated' | 'invalid' | 'incomplete' | 'stale'; scope: { paths: string[]; checkIds: string[] | null };
  coverage: EvaluationCoverage; evaluations: CheckEvaluation[]; requiredSatisfied: boolean; wholeAtlasCompliant: boolean;
  complete: boolean; freshness: FreshnessResult; limits: string[]; preparedChange?: PreparedEvaluationBinding;
};
export function evaluateChecks(view: AtlasView, options: EvaluateChecksOptions): Promise<DeepReadonly<CheckRun>>;

export type AuditChangeSet = { id: string; paths: string[] };
/** Existing urn:atlas:schema:check-evaluation:1. Its completeness is conservative when advisory verification is unable. */
export type CheckAuditReport = {
  contract: 'urn:atlas:schema:check-evaluation:1'; atlas: string; baseline: string; changeSet: AuditChangeSet;
  complete: boolean; compliant: boolean; evaluator: { name: string; version: string };
  evaluations: (Omit<CheckEvaluation, 'path' | 'actor' | 'evaluator' | 'evidence'> & { evidence: string[] })[];
};
export type RetainedEvaluationEvidence = Omit<CapturedEvaluationEvidence, 'bytesBase64'> & { evaluationIndex: number; evidenceIndex: number; file: string };
export type CheckReportProvenance = {
  contract: 'atlas.check-report-provenance/1';
  run: Pick<CheckRun, 'id' | 'actor' | 'startedAt' | 'completedAt' | 'atlasRoot' | 'sourceIdentity' | 'status' | 'scope' | 'coverage'
    | 'requiredSatisfied' | 'wholeAtlasCompliant' | 'complete' | 'freshness' | 'preparedChange'>;
  report: { file: 'report.json'; byteLength: number; sha256: string };
  baseline: { value: string; origin: 'captured-source-identity' | 'caller-declared' };
  changeSet: { value: AuditChangeSet; origin: 'evaluation-scope' | 'caller-declared' };
  receipts: Pick<CheckEvaluation, 'check' | 'revision' | 'path' | 'actor' | 'evaluator'>[];
  evidence: RetainedEvaluationEvidence[]; retainedAt: string; repositoryRoot: string; limits: string[];
};
export type RetainCheckReportOptions = {
  directory: string; repositoryRoot: string; baseline?: string;
  changeSet?: { id: string; paths: readonly string[] };
};
export type RetainedCheckReport = { status: 'retained'; directory: string; report: CheckAuditReport; provenance: CheckReportProvenance };
export function retainCheckReport(run: DeepReadonly<CheckRun>, options: RetainCheckReportOptions): DeepReadonly<RetainedCheckReport>;
export type RetainedReportFreshness = { status: 'unavailable'; reason: string }
  | { status: 'fresh' | 'historical' | 'unavailable'; sourceMatches: boolean; checkChanges: string[]; observed: FreshnessResult };
export type ReadCheckReportResult = {
  status: 'read'; integrity: 'verified'; authenticity: 'not-authenticated'; directory: string;
  report: CheckAuditReport; provenance: CheckReportProvenance; evidence: (RetainedEvaluationEvidence & { bytesBase64: string })[];
  freshness: RetainedReportFreshness;
};
export function readCheckReport(directory: string, options?: { view?: AtlasView }): DeepReadonly<ReadCheckReportResult>;
