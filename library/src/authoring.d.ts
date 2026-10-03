import type { AtlasView, Diagnostic } from './index.js';
import type { AbsorbReview } from './navigation.js';
import type { CheckRun } from './checks.js';
import type { SourceReview } from './references.js';

export interface FileChange { path: string; content: string | null }
export interface PreparedFileChange { path: string; before: string | null; beforeBase64?: string; after: string | null }
export interface SourcePrecondition { uri: string; sha256: string }
export interface ChangeRequest { changes: FileChange[]; reason: string; sourcePreconditions?: SourcePrecondition[]; styleChange?: boolean }
export interface ChangePlan {
  format: 'atlas.change/1'; status: 'ready' | 'invalid' | 'noop'; reason: string;
  styleChange?: true;
  baseline: { identity: string; files: Array<{ path: string; sha256: string }> };
  changes: PreparedFileChange[];
  validation: { status: AtlasView['status']; identity: string; diagnostics: Diagnostic[] };
  sourcePreconditions: SourcePrecondition[]; candidate: AtlasView;
  observedFiles: Array<{ path: string; content: string | null; rawBase64?: string; sha256: string }>;
}
export function prepareChange(view: AtlasView, request: ChangeRequest): ChangePlan;
export function prepareChangeFromDisk(root: string, request: ChangeRequest, options?: { view?: AtlasView; observedFiles?: ChangePlan['observedFiles'] }): Promise<ChangePlan>;
export function inspectChange(plan: ChangePlan): { before: AtlasView; after: AtlasView };
export function changePlanIdentity(plan: ChangePlan): string;
export function prepareInitialization(view: AtlasView, request: { id: string; title: string; styleId?: string; styleContent?: string }): ChangePlan;
export function prepareStyleChange(view: AtlasView, request: { styleId?: string; styleContent?: string; reason: string }): ChangePlan;
export interface ApplyResult {
  format: 'atlas.apply/1'; status: 'complete' | 'noop' | 'interrupted'; transaction: string | null;
  identity?: string; written?: string[]; error?: { code: string; message: string };
}
export interface ApplyOptions {
  allowedRoots?: string[];
  onProgress?: (progress: { transaction: string; phase: 'prepared' | 'applying'; written: string[] }) => void | Promise<void>;
}
export function applyChange(root: string, plan: ChangePlan, options?: ApplyOptions): Promise<ApplyResult>;
export interface TransactionSummary {
  id: string; phase: 'prepared' | 'applying' | 'interrupted' | 'complete' | 'rolling-back' | 'rolled-back';
  createdAt: string; baseline: string; result: string; written: string[]; error?: { code: string; message: string };
}
export function listTransactions(root: string): Promise<TransactionSummary[]>;
export interface RecoveryResult { format: 'atlas.recovery/1'; status: 'rolled-back'; transaction: string; identity?: string; baselineRestored?: boolean; diagnostics?: Diagnostic[] }
export function recoverChange(root: string, id: string): Promise<RecoveryResult>;
export interface HistoricalReview { revision: string; updatedAt: string; planIdentity: string; candidate: string; reason: string; review?: AbsorbReview; checkRuns?: CheckRun[] }
export interface Draft { format: 'atlas.draft/1'; id: string; revision: string; updatedAt: string; plan: ChangePlan; review?: AbsorbReview; checkRuns?: CheckRun[]; reviewHistory?: HistoricalReview[] }
export function saveDraft(root: string, request: { id?: string; plan: ChangePlan; expectedRevision?: string; review?: AbsorbReview; checkRuns?: CheckRun[] }): Promise<Draft>;
export function loadDraft(root: string, id: string): Promise<Draft>;
export function listDrafts(root: string): Promise<Array<{ id: string; revision: string; updatedAt: string; reason: string; status: ChangePlan['status']; baseline: string }>>;
export function applyDraft(root: string, id: string, options: ApplyOptions & { expectedRevision: string }): Promise<ApplyResult>;
export function deleteDraft(root: string, id: string, options: { expectedRevision: string }): Promise<{ status: 'deleted'; id: string }>;

export interface WorkingForm { kind: string; title: string; context?: unknown; fields: Record<string, unknown> }
export interface WorkingCopy { format: 'atlas.working-copy/1'; id: string; revision: string; updatedAt: string; baseline: string; form: WorkingForm }
export function saveWorkingCopy(root: string, request: { id?: string; expectedRevision?: string; baseline: string; form: WorkingForm }): Promise<WorkingCopy>;
export function loadWorkingCopy(root: string, id: string): Promise<WorkingCopy>;
export function listWorkingCopies(root: string): Promise<Array<{ id: string; revision: string; baseline: string; updatedAt: string; kind: string; title: string }>>;
export function discardWorkingCopy(root: string, request: { id: string; expectedRevision: string }): Promise<{ status: 'deleted'; id: string }>;
export type SourceReviewOutcome = 'needs-review' | 'reviewed-unchanged' | 'updated';
export interface SourceReviewDecision { uri: string; sha256: string; outcome: SourceReviewOutcome; reason: string }
export interface SourceHistory {
  format: 'atlas.source-history/1'; root: string; revision: string | null; updatedAt?: string;
  observations: Array<{ uri: string; sha256: string; observedAt: string; identity: string; status: string; reviewStatus: 'unreviewed' | SourceReviewOutcome; reason?: string }>;
  inspections: Array<{ uri: string; status: string; observedAt: string; identity: string; reason?: string; code?: string }>;
  decisions: Array<SourceReviewDecision & { recordedAt: string; identity: string }>;
}
export function getSourceReviewHistory(root: string): Promise<SourceHistory>;
export function recordSourceReview(root: string, request: { review?: SourceReview; decisions?: SourceReviewDecision[]; expectedRevision?: string | null }): Promise<SourceHistory>;
