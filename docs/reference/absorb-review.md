# Review an Absorb draft

An Absorb proposal records why incoming material changes an account. Saving its
optional review packet keeps that reasoning available when another person or
agent resumes the draft. It remains a proposal: stored reasoning and Check
results grant no permission and do not establish approval.

## Prepare and retain the reasoning

`prepareAbsorb(view, input)` returns the ordinary file-change `plan` and, for a
`ready` or `noop` proposal, an `atlas.absorb-review/1` packet in `review`. Invalid
proposals expose diagnostics and impact without an applyable review packet.

```js
const proposal = prepareAbsorb(view, {
  source: { uri: 'sources/review.md', role: 'evidence' },
  contributions: [{
    disposition: 'update',
    point: 'delivery-promise',
    rationale: 'Retain the distinction between local saving and delivery.'
  }],
  changes: [{ path: 'trees/product/points/promise.md', content: revisedRecord }],
  rationale: 'Clarify the promise without broadening the observed support.',
  unresolved: ['Which failure condition should the next user study exercise?']
});

if (proposal.status !== 'invalid') {
  const draft = await saveDraft(root, {
    plan: proposal.plan,
    review: proposal.review
  });
}
```

The packet retains its source, per-contribution decisions and rationales, overall
rationale, unresolved questions and optional preservation review. It identifies
the original baseline, candidate bytes and exact plan, including selected source
preconditions. The saved draft revision covers both the plan and its review.
`loadDraft` returns them together after restart.

Supplied packets are revalidated against reconstructed original and candidate
bytes. Changing a packet cannot make an invalid contribution valid, replace the
candidate, or mark the draft approved. Changing the plan requires a matching new
packet. Updating a draft requires its current `expectedRevision`; the original
baseline cannot be replaced.

`saveDraft` does not automatically carry old metadata forward. Omitting `review`
or `checkRuns` removes it from active review of the saved revision. To retain still-matching review
while adding candidate evidence, supply it explicitly. Ordinary change drafts
need neither field, and earlier `atlas.draft/1` drafts remain readable. On a changed
plan, previous packets remain in `reviewHistory`, explicitly tied to their original
candidate and plan. Revise the active reasoning and rerun affected Checks before
claiming the new candidate has been assessed.

## Remove or consolidate knowledge

Removal is an explicit contribution decision. Remove its record and repair
outlines and explicit references in the same candidate. The resulting Atlas must
remain valid.

```json
{
  "disposition": "remove",
  "point": "old-installation-summary",
  "rationale": "The useful limitation is explained in the current support account.",
  "destinations": [{ "point": "support-boundaries" }]
}
```

A Facet removal uses `tree` and `facet` instead of `point`. Optional destinations
name surviving Points (`{point}`) or Tree-local Facets (`{tree, facet}`); all must
exist in the candidate. A removal requires an existing original identity and an
absent resulting identity. A rationale explains deliberate deletion even when
there is no surviving destination.

Destinations help review a consolidation. They do not create permanent replacement
relations or prove that its reasoning survived. Inspect source and destination
explanations. Broken ordinary Markdown links remain reference diagnostics for
review, distinct from invalid structural references.

## Review consequences

`reviewChange(plan)` reconstructs the exact before and after views, then calls
`reviewImpact`. It reports changed Point explanations, standing, dates, sources,
uncertainty and placement, plus changed Trees, Branches and Facets.

The review set includes ancestors and explicit attachments and incoming Facet
references. Incoming interpretations expose their host Points or Branches so the
reviewer can inspect the account that may need revision. This is a bounded first
step; it does not traverse the whole graph or rewrite ancestors.

`mentions.before` and `mentions.after` separately list direct Markdown citers of
changed Points and Facets. Old references remain inspectable when the target is
removed. These mentions are navigation references, not asserted dependencies.
Their bounds state whether the returned set is complete. `linkDiagnostics` reports
missing or unsupported references in the candidate; no automatic source reads or
network requests occur.

## Review the proposed candidate against Checks

Evaluate adopted Checks against the actual candidate, not merely the current
source. `inspectChange(plan).after` reconstructs that candidate from the plan's
bytes. The Library accepts trusted evaluator callbacks or manual evidence through
[`evaluateChecks`](checks.md).

```js
const { after: candidate } = inspectChange(draft.plan);
const run = await evaluateChecks(candidate, { actor, manual });
const revisedDraft = await saveDraft(root, {
  id: draft.id,
  expectedRevision: draft.revision,
  plan: draft.plan,
  ...(draft.review ? { review: draft.review } : {}),
  checkRuns: [...(draft.checkRuns ?? []), run]
});
```

Manual entries name exact candidate and Check revisions. Saved `checkRuns` contain
at most ten complete runs and must match the candidate's identity, root and active
Check definitions. Malformed summaries, mismatched definitions and duplicate run
IDs are refused. `fail`, `unable` and omitted required reviews remain visible;
retaining a complete run does not require a passing outcome.

These runs concern the candidate, not a claim that the working tree already
contains it. Reviewer identity remains self-reported. Applying still requires the
user's authorization and the exact saved draft revision, and rechecks current
source preconditions. Candidate evidence neither bypasses those checks nor
creates a new universal approval gate.

## Select the sources that the change relies on

An incoming local source with `sha256` becomes an application precondition.
`sourcePreconditions` can add other `{uri, sha256}` pairs explicitly relied on by
the proposal. A conflicting hash for the incoming URI is refused. HTTP(S) sources
remain references, and additional source reads still require caller grants.

Ordinary source citations are not automatically application preconditions. A
reference can remain useful historical context while its file changes. Select
preconditions when the review depends on those exact bytes; inspect source drift
and its meaning rather than treating every changed citation as an invalid claim.

## Optional preservation review

A rebuild can include `preservation` in its Absorb input:

```json
{
  "scope": "The decisions and qualifications in the old installation account.",
  "sources": [{ "uri": "sources/previous-account.md", "role": "history" }],
  "units": [{
    "id": "platform-limit",
    "source": { "uri": "sources/previous-account.md", "role": "history" },
    "locator": "Supported platforms, paragraph 2",
    "disposition": "retained",
    "rationale": "The current account keeps the distinction between recipe and tested platform.",
    "destinations": [{ "point": "support-boundaries" }]
  }]
}
```

A unit has a unique ID, a source exactly matching a declared scope source, a
locator, a disposition and a rationale. Dispositions are `retained`, `reframed`,
`superseded`, `historical`, `non-integration` and `unresolved`. Retained and
reframed units require surviving destinations; the others may name them. The
packet accepts up to 100 sources and 1,000 units. Unknown fields and unavailable
destinations are refused.

An unresolved unit stays unresolved. A packet with zero units or no unresolved
labels does not prove complete source coverage. The author must inspect the
scope and account for omissions. A project's adopted source-accounting Check can
require and evaluate that work. Ordinary edits remain free of a mandatory source
inventory; preservation review is useful when losing prior knowledge would be a
material failure.
