import type { AtlasView, Diagnostic } from './index.js';

export interface FileChange { path: string; content: string | null }
export interface PreparedFileChange { path: string; before: string | null; beforeBase64?: string; after: string | null }
export interface SourcePrecondition { uri: string; sha256: string }
export interface ChangeRequest { changes: FileChange[]; reason: string; sourcePreconditions?: SourcePrecondition[] }
export interface ChangePlan {
  format: 'atlas.change/1'; status: 'ready' | 'invalid' | 'noop'; reason: string;
  baseline: { identity: string; files: Array<{ path: string; sha256: string }> };
  changes: PreparedFileChange[];
  validation: { status: AtlasView['status']; identity: string; diagnostics: Diagnostic[] };
  sourcePreconditions: SourcePrecondition[]; candidate: AtlasView;
  observedFiles: Array<{ path: string; content: string | null; rawBase64?: string; sha256: string }>;
}
export function prepareChange(view: AtlasView, request: ChangeRequest): ChangePlan;
export function prepareChangeFromDisk(root: string, request: ChangeRequest, options?: { view?: AtlasView; observedFiles?: ChangePlan['observedFiles'] }): Promise<ChangePlan>;
export function prepareInitialization(view: AtlasView, request: { id: string; title: string }): ChangePlan;
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
export interface Draft { format: 'atlas.draft/1'; id: string; revision: string; updatedAt: string; plan: ChangePlan }
export function saveDraft(root: string, request: { id?: string; plan: ChangePlan; expectedRevision?: string }): Promise<Draft>;
export function loadDraft(root: string, id: string): Promise<Draft>;
export function listDrafts(root: string): Promise<Array<{ id: string; revision: string; updatedAt: string; reason: string; status: ChangePlan['status']; baseline: string }>>;
export function applyDraft(root: string, id: string, options: ApplyOptions & { expectedRevision: string }): Promise<ApplyResult>;
export function deleteDraft(root: string, id: string, options: { expectedRevision: string }): Promise<{ status: 'deleted'; id: string }>;
