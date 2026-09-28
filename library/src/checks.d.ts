import type { AtlasView, Check, Source } from './index.js';

export interface CheckEvidence { text: string; source?: Source }
export interface CheckVerification { outcome: 'pass' | 'fail' | 'unable'; reason: string; evidence: CheckEvidence[] }
export interface CheckEvaluator {
  id: string; revision: string;
  evaluate(context: { view: Readonly<AtlasView>; check: Readonly<Check>; baseline: string }): CheckVerification | Promise<CheckVerification>;
}
export interface ManualCheckResult extends CheckVerification { id: string; revision: string; baseline: string }
export interface CheckOptions { checkIds?: string[]; evaluators?: CheckEvaluator[]; manual?: ManualCheckResult[]; actor?: string }
export interface ActiveCheck { id: string; revision: string; level: 'required' | 'advisory' }
export interface CheckResult extends ActiveCheck, CheckVerification { baseline: string; method: 'manual' | 'evaluator' | 'unavailable' }
export interface RequiredCheckSummary { total: number; passed: number; failed: number; unable: number; unreviewed: number; satisfied: boolean }
export interface CheckRun {
  format: 'atlas.check-run/1'; id: string; status: 'complete' | 'unavailable'; createdAt: string; root: string | null; baseline: string | null;
  actor: string | null; active: ActiveCheck[]; selected: string[]; results: CheckResult[];
  excluded: Array<{ id: string; reason: string }>; required: RequiredCheckSummary; requiredSatisfied: boolean; limits: string[];
}
export function evaluateChecks(view: AtlasView, options?: CheckOptions): Promise<CheckRun>;
export interface CheckReport { format: 'atlas.check-report/1'; id: string; run: CheckRun; digest: string }
export interface CheckReportInspection extends CheckReport { freshness: 'current' | 'stale' | 'unknown' }
export interface CheckReportSummary { id: string; createdAt: string; baseline: string; requiredSatisfied: boolean; required: RequiredCheckSummary }
export function retainCheckRun(root: string, run: CheckRun): Promise<CheckReport>;
export function readCheckReport(root: string, id: string, options?: { view?: AtlasView }): Promise<CheckReportInspection>;
export function listCheckReports(root: string): Promise<CheckReportSummary[]>;
