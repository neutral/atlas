# Atlas operations

The Library owns the behavior used by CLI, MCP and browser adapters. Operations
return structured results with explicit scope, evidence and failure boundaries.
Transport success does not imply valid content or successful application.

## Reading

Opening an Atlas captures its authored records, validation result and content
identity. Exact inspection returns the requested identity, its owning Tree,
structural ancestry, body, attached Facets, incoming Facet references and sources.
Search is scoped and bounded. Results explain the match and preserve ownership.

Refresh captures the current files and compares them with the prior observation.
Consumers distinguish captured content from a freshly inspected state. Missing
records, malformed data and inaccessible files remain explicit diagnostics.

Source reads require caller-supplied roots independent of the authored references.
Default local access stays inside the Atlas. Managed private state and reserved
editing-state paths remain excluded even under broader source grants. Real-path
containment and symlink checks apply before access. External URLs are returned as
references and are never automatically fetched. Missing or denied sources remain
explicit limits on the evidence inspected.

## Route

Route accepts an exact Point, Tree, or question and optional detail, type and
result bounds. It returns a suggested reading path with orientation, selected
Points, supporting detail and relevant Facets. It explains inclusion using exact
identity, authored ancestry, text matches or explicit Facet attachment.

Route preserves original explanations, source references and uncertainty. A
decision's status and an observation's date remain visible. It MUST NOT infer
implementation from selection or turn an authored connection into proof. Ambiguous
matches remain alternatives; lexical ranking is not a semantic judgment.

## Absorb

Absorb inspection accepts incoming material and source identity, then supplies
candidate Points, possible owning Trees and relevant existing interpretations.
The agent or author makes the semantic decision.

An absorption proposal identifies its source, contribution decisions, proposed
file changes, rationale and unresolved questions. A contribution is an update,
creation, Facet, conflict, reference-only addition or explicit non-integration.
The complete proposed result is validated before application. Repeating an
identical proposal against its resulting content can produce a justified no-op.

Changed Points prompt inspection of structural ancestors, attached Facets and
known incoming cross-Tree references. This review set is limited to recorded
connections. Changes to explanations require explicit judgment. Decision status
changes and observation dates receive explicit handling.

## Prepared changes and recovery

Preparation writes no authored source. It returns the complete before/after
changes, original content identity, validation result and effects to review.
Invalid drafts can be inspected and repaired, but MUST NOT be applied as accepted
changes. Initialization follows the same visible create/review/apply boundary.
Raw repairs expose the original bytes as `beforeBase64`; null text does not mean
the file was absent. Preconditions and recovery preserve those exact bytes.

Apply operates only on the caller-selected Atlas. It validates paths, the plan and
the complete candidate content again. All affected and observed source preconditions
are checked before the first write. Stale input fails without source writes.
Concurrent writers use an exclusive transaction lock. Plan data grants no authority
and cannot select another root, arbitrary file or executable operation.

Multi-file writes retain original bytes and durable transaction progress. A failed
or interrupted apply exposes partial state and a guarded recovery operation.
Recovery refuses to overwrite bytes changed outside that transaction. Completion
and recovered rollback are distinct outcomes. Cross-file atomicity is not claimed.

Editor drafts retain their original baseline and survive process restart. Draft
revisions identify their complete saved content. Updating, applying or deleting a
saved draft requires the caller's exact revision; stale requests fail without
authored writes. Drafts, recovery journals and retained Check reports use private
user storage, keyed by the canonical Atlas root and bound to it by ownership
metadata. A trusted launch may choose another state directory. Authored content
and browser or tool requests cannot change that location.
Editing, review, apply and recovery are distinct visible actions.

## Checks

Applicable active Checks can be evaluated by explicitly trusted caller-provided
evaluators or recorded manual review. Results name the exact definition revision,
source baseline, evidence and `pass`, `fail`, or `unable`. Retired and draft Checks
do not govern. Required Checks need actual verification for a compliance claim.
No evaluator is loaded or executed merely because an Atlas references it.

## Product adapters

The Portal displays one selected Tree on one canvas. Structural nodes distinguish
Points from Branch groupings. Point selection opens its page beside the canvas.
Filters preserve enough ancestry to explain remaining results. Facets provide
deliberate cross-Tree navigation. Keyboard, narrow-screen and direct-link access
remain supported. The Editor adds durable draft and safe authoring operations.

MCP fixes its root and source grants at launch. Tools cannot expand that scope.
It provides structured Route, Absorb, inspection, preparation, application and
recovery results. Inputs and output sizes are bounded; errors remain structured.

Publication uses an explicit selection. It never expands through Facets or source
references automatically. Reading a source does not authorize publishing it.
Missing selections produce diagnostics; excluded Facet targets are marked as
not included.
Published output executes no authored HTML or scripts.
