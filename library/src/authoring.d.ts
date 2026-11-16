import type { AtlasView, Diagnostic } from './index.js';

export interface FileChange { path: string; content: string | null }
export interface PreparedFileChange { path: string; before: string | null; beforeBase64?: string; after: string | null }
export interface ChangeRequest { changes: FileChange[]; reason: string }
export interface ObservedFile { path: string; content: string | null; rawBase64?: string; sha256: string }
/**
 * `validation` is the candidate's own validity and, with the code `STYLE_CHANGE_ALONE`, the rule that a
 * change which alters an existing style.md alters no other file. `candidate` is the candidate as it validates by itself.
 */
export interface ChangePlan {
  format: 'atlas.change/1'; status: 'ready' | 'invalid' | 'noop'; reason: string;
  baseline: { identity: string; files: Array<{ path: string; sha256: string }> };
  changes: PreparedFileChange[];
  validation: { status: AtlasView['status']; identity: string; diagnostics: Diagnostic[] };
  observedFiles: ObservedFile[]; candidate: AtlasView;
  /** On a plan prepared from a candidate directory: the files there that are not records, are no part of the change, and are absent from the Atlas or differ from its own. Sorted paths. */
  ignored?: string[];
}
/**
 * Refuses, before any plan exists, a path readers do not accept (`UNSAFE_PATH`), an unpaired surrogate in it included, a
 * file over 2 MiB (`LIMIT_EXCEEDED`), and a change whose candidate readers would not read back as it is written
 * (`INVALID_REQUEST`, with the readers' diagnostics): a path that aliases another, text that is not well-formed Unicode,
 * a directory more than 64 levels below `points/`, `facets/` or `.checks/`, more than 40000 directory entries listed in
 * those folders, more than 10000 files or 64 MiB in all; and,
 * with no diagnostics, a path written or held beneath one that is a file, named with that file.
 */
export function prepareChange(view: AtlasView, request: ChangeRequest): ChangePlan;
export function prepareChangeFromDisk(root: string, request: ChangeRequest, options?: { view?: AtlasView; observedFiles?: ObservedFile[] }): Promise<ChangePlan>;
/**
 * The candidate lies outside the Atlas and the private state, or is the Atlas's own `.atlas-candidate` folder at its root.
 * That folder is refused `STALE` when the Atlas is no longer the one `writeCandidate` last copied into it, or when no
 * record names the Atlas it was copied from. The record and the Atlas are read before the folder and again after it,
 * and the folder is refused `STALE` unless both reads agree and the record names that Atlas. A record that is not one
 * is `INVALID_STATE`.
 */
export function prepareFromCandidate(root: string, candidateDirectory: string, options: { reason: string }): Promise<ChangePlan & { ignored: string[] }>;
/**
 * Writes a fresh copy of the Atlas's records into `.atlas-candidate` at its root, replacing what it held. `path` is absolute;
 * `files` counts the files written; `baseline` is the identity of the Atlas copied, which the private state records, so that
 * preparing from the folder once the Atlas has changed is refused `STALE`. Before it touches the folder it saves a record
 * that names no Atlas; when the private state cannot take it, the folder is left as it was. It holds the Atlas's writer
 * lock throughout, as an apply does, so no apply and no other candidate runs meanwhile: one that meets a running writer
 * is refused `LOCKED` ("Another Atlas writer is running."), and one that meets the lock of a writer that stopped in an
 * unfinished transaction is refused `LOCKED` ("Interrupted transaction ID needs recovery."). A candidate whose lock is no
 * longer its own refuses `LOCKED` ("Writer lock changed.") before it empties the folder or saves a record.
 */
export function writeCandidate(root: string): Promise<{ path: string; files: number; baseline: string }>;
export function inspectChange(plan: ChangePlan): { before: AtlasView; after: AtlasView };
/** The caller chooses the Style: one curated ID, or one complete custom definition. */
export type StyleChoice = { styleId: string; styleContent?: never } | { styleContent: string; styleId?: never };
export function prepareInitialization(view: AtlasView, request: { id: string; title: string } & StyleChoice): ChangePlan;
export interface ApplyResult {
  format: 'atlas.apply/1'; status: 'complete' | 'noop' | 'interrupted'; transaction: string | null;
  identity?: string; written?: string[]; error?: { code: string; message: string };
}
export interface ApplyOptions {
  onProgress?: (progress: { transaction: string; phase: 'prepared' | 'applying'; written: string[] }) => void | Promise<void>;
}
export interface TransactionSummary {
  id: string; phase: 'prepared' | 'applying' | 'interrupted' | 'complete' | 'rolling-back' | 'rolled-back';
  createdAt: string; baseline: string; result: string; written: string[]; error?: { code: string; message: string };
}
/** A saved file that does not load: its name in its folder of the private state, and the code and message loading it gives. */
export interface UnreadableStateFile { file: string; code: string; message: string }
/**
 * The journals that remain, and each journal file that does not load; one unreadable journal hides no other. Sorted by file
 * name. A journal is kept only while its transaction is unfinished, so these are the unfinished transactions, and a
 * finished one (complete or rolled back) whose journal could not be removed. A journal that is not whole, in a phase
 * of its own and with each change and summary field in its shape, is unreadable (`INVALID_STATE`, "Invalid transaction
 * journal.").
 */
export function listTransactions(root: string): Promise<{ transactions: TransactionSummary[]; unreadable: UnreadableStateFile[] }>;
/** What stops the next apply: its code and message, and the journal it concerns. */
export interface ApplyBlocker { code: string; message: string; transaction?: string }
/**
 * The refusal the next apply of any draft gives for the Atlas's transactions and for the Atlas as it reads now, or null
 * when they let it apply; the apply gate is this answer. The journals are answered first: `LOCKED` ("Interrupted
 * transaction ID needs recovery.") for an unfinished journal; `INVALID_STATE` ("Invalid transaction journal: ID.") for
 * one that is not whole; the code of a journal file that cannot be read ("Transaction journal ID cannot be read:
 * MESSAGE"); without `transaction`, `LIMIT_EXCEEDED` ("Too many saved records.") when the folder holds more than 10000
 * `.json` records (other files, a temporary one included, are not counted), or the code with which the folder cannot be
 * listed. A file whose name is not a transaction ID stops nothing.
 * Then the Atlas: `INCOMPLETE` ("Cannot apply against an incomplete read.") without `transaction` when it does not read
 * whole. A failure of the private state as a whole is thrown, as are a missing root (`ENOENT`) and one that is not a
 * directory (`UNSAFE_PATH`). Another writer running at that moment is not among the answers: the apply then refuses
 * `LOCKED` of its own.
 */
export function applyBlocker(root: string): Promise<ApplyBlocker | null>;
/**
 * `identity`, `baselineRestored` and `diagnostics` are given by the recovery that rolls the transaction back, which then
 * removes its journal. `baselineRestored` is true when the Atlas reads back whole (not `incomplete`) at the identity the
 * transaction started from. Recovering a journal already rolled back, whose removal failed, removes it and gives
 * `{ format, status, transaction }`; a journal that is gone is `NOT_FOUND`.
 */
export interface RecoveryResult { format: 'atlas.recovery/1'; status: 'rolled-back'; transaction: string; identity?: string; baselineRestored?: boolean; diagnostics?: Diagnostic[] }
export function recoverChange(root: string, id: string): Promise<RecoveryResult>;
export interface Draft { format: 'atlas.draft/1'; id: string; revision: string; updatedAt: string; plan: ChangePlan }
export function saveDraft(root: string, request: { id?: string; plan: ChangePlan; expectedRevision?: string }): Promise<Draft>;
export function loadDraft(root: string, id: string): Promise<Draft>;
export interface DraftListing { id: string; revision: string; updatedAt: string; reason: string; status: ChangePlan['status']; baseline: string }
/** Every saved draft that loads, and every draft file that does not; one unreadable draft hides no other. Sorted by file name. */
export function listDrafts(root: string): Promise<{ drafts: DraftListing[]; unreadable: UnreadableStateFile[] }>;
/**
 * A completed apply removes its draft (`draft: 'removed'`) and then its journal; an interrupted or noop one keeps it. A draft
 * that cannot be removed is reported kept, and its journal stays, complete. Until an interrupted transaction is recovered,
 * the Atlas takes no apply of any draft (`LOCKED`; see `applyBlocker`).
 */
export function applyDraft(root: string, id: string, options: ApplyOptions & { expectedRevision: string }): Promise<ApplyResult & { draft: 'removed' | 'kept' }>;
export function deleteDraft(root: string, id: string, options: { expectedRevision: string }): Promise<{ status: 'deleted'; id: string }>;
