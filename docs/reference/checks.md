# Checks reference

`evaluateChecks(view, options)` evaluates active Check definitions against a
captured valid view. Import it from `@neutral/atlas`. See
[reviewing Checks](../reviewing-checks.md) for the review workflow and
[Check format](../../spec/spec/FORMAT.md#check) for definitions.

## Evaluation input

| Option | Contract |
| --- | --- |
| `checkIds` | Optional unique IDs; omission selects all active Checks. At most 1,000. |
| `actor` | Optional nonblank reviewer label, up to 1,024 characters. |
| `evaluators` | `{id, revision, evaluate}` entries with caller-trusted functions. |
| `manual` | `{id, revision, baseline, outcome, reason, evidence}` entries. |

Each Check can use one verification method per call. Exact Check revisions are
required. A manual result also names the exact captured `baseline`. Draft and
retired Checks are excluded from evaluation.

A trusted evaluator receives `{view, check, baseline}`, with `view` and `check`
frozen, and returns or resolves to:

```js
{
  outcome: 'pass', // 'pass', 'fail' or 'unable'
  reason: 'The reviewed records satisfy the stated requirement.',
  evidence: [{ text: 'Describe the inspected evidence.', source: { uri: 'evidence.md' } }]
}
```

`reason` is nonblank. `evidence` contains at most 100 entries with nonblank `text`
and an optional source reference. Pass and fail require evidence. The caller
supplies evaluator functions; authored content cannot load or execute them.

Missing verification, mismatched revisions, stale manual baselines, evaluator
exceptions and malformed evaluator results produce `unable`. Malformed request
fields are rejected before evaluation.

## Evaluation result

The `atlas.check-run/1` result contains the baseline, active definitions,
selected IDs, individual results and required-Check summary.

| Field | Meaning |
| --- | --- |
| `status` | `complete` when evaluation finished; `unavailable` for an unusable view. |
| `results` | Each selected Check's revision, method, outcome, reason and evidence. |
| `excluded` | Requested IDs that were missing or inactive. |
| `required` | Counts of all active required Checks: passed, failed, unable and unreviewed. |
| `requiredSatisfied` | Every active required Check passed, with no missing or inactive requested IDs. |

Required Checks omitted from `checkIds` remain unreviewed in the summary. A zero
required count means the Atlas has no active required Checks. Results cover the
recorded baseline and definitions; evidence accuracy remains the reviewer's
responsibility.

## Retained reports

| Function | Behavior |
| --- | --- |
| `retainCheckRun(root, run)` | Save a complete run as an immutable report in private storage. |
| `listCheckReports(root)` | Return report summaries. |
| `readCheckReport(root, id, {view}?)` | Return the full report with freshness relative to the supplied view. |

Freshness is `current` when the baseline, Atlas root and active Check definitions
match; `stale` when they differ; `unknown` when no view is supplied. Refresh the
view before judging current state.

Reports survive restart. Storage rejects symlinks, conflicting IDs, changed bytes
and inconsistent summaries. Reports are bounded to 4 MiB and inventories to 1,000
entries. A digest detects storage changes; reviewer identity is self-reported.
See [private storage](authoring.md#private-storage).
