# Atlas operations

The Library owns the behavior used by CLI, MCP and browser adapters. Operations
return structured results with explicit scope, evidence and failure boundaries.
Transport success does not imply valid content or successful application.

## Reading

Opening an Atlas captures its authored records, validation result and content
identity. Exact inspection returns the requested identity, its owning Tree,
structural ancestry, body, attached Facets, incoming Facet references and sources.
For the styled format, opening also captures and exposes the complete adopted
Style. Style bytes participate in content identity, comparison, validation and
change preconditions. Consumers MUST NOT substitute a newer curated definition.
Search is scoped and bounded. Results explain the lexical match and preserve
ownership. Point and Facet results remain distinguishable. A Facet result retains
its host, owning Tree, interpreted Tree and targets; it MUST NOT present the
interpretation as a target Point's own claim. Source bodies are not implicitly
searched. Compact discovery MAY return literal body excerpts instead of full
record bodies, while retaining identity, Type, standing/date and uncertainty plus
an exact follow-up selector. A lexical candidate remains distinct from a
judgment about meaning or source support.

Refresh captures the current files and compares them with the prior observation.
Consumers distinguish captured content from a freshly inspected state. Missing
records, malformed data and inaccessible files remain explicit diagnostics.

Source reads require caller-supplied roots independent of the authored references.
Default local access stays inside the Atlas. Managed private state and reserved
editing-state paths remain excluded even under broader source grants. Real-path
containment and symlink checks apply before access. External URLs are returned as
references and are never automatically fetched. Missing or denied sources remain
explicit limits on the evidence inspected. Explicit source review MAY compare
observed bytes with declared or caller-supplied prior hashes and identify referring
records. It MUST distinguish changed, missing, denied and uninspected sources.
Remote URLs remain uninspected references. Private retained observations MAY
support comparisons across sessions. A review disposition MUST name the exact
observed source bytes and its reason; changed bytes require a new assessment.
Missing or denied later reads remain visible even when an earlier successful
observation exists. A source review neither rewrites
claims nor automatically adds source preconditions to a change.

Readers MAY derive direct references from captured Markdown and source headers.
These indexes preserve owner, location, target and missing/unsupported diagnostics
with explicit bounds. They do not change authored validity or infer semantic
relations. Moving a Point or Facet within its owner may prepare repairs to known
incoming and outgoing path links; unsafe or incomplete repairs MUST be refused
rather than presented as a complete move. IDs and Atlas-root-relative source
references remain unchanged by such a path move.

## Route

Route accepts an exact Point, Tree, or question and optional detail, type and
result bounds. It returns a suggested reading path with orientation, selected
Points, supporting detail and relevant Facets. It explains inclusion using exact
identity, authored ancestry, text matches or explicit Facet attachment.

Route preserves original explanations, source references and uncertainty. A
decision's status and an observation's date remain visible. It MUST NOT infer
implementation from selection or turn an authored connection into proof. Ambiguous
matches remain alternatives; lexical ranking is not a semantic judgment.

Discovery returns compact candidates without expanding their descendants. Reading
retains complete selected explanations; orientation MAY use ancestor references
instead of repeated bodies. Bounded sections expose their available and returned
counts and exact continuation requests. Continuation is bound to the captured
identity and original request; changed inputs require a new reading path. It does
not infer that omitted lexical candidates are irrelevant. Discovery MAY expose
independently matched Facet interpretations in its Facet section while preserving
their exact identities and follow-up selectors.

Inventories and draft inspections MAY default to bounded summaries. They MUST
make omitted content explicit and provide complete inspection by exact identity,
including lossless continuation when needed. A compact synopsis cannot replace
reading the complete effects before claiming a proposal was reviewed.

## Absorb

Absorb inspection accepts incoming material and source identity, then supplies
candidate Points, possible owning Trees and relevant existing interpretations.
The agent or author makes the semantic decision.

Before placement or structural review, the author reads the adopted Style when
present and judges the contribution within its organizing and source-depth
policy. Existing valid structure is not a reason to invent a selected Style for
a legacy Atlas. A proposed Style adoption or revision identifies the user's
decision, changed policy and consequences for existing Trees, Points and Facets.
It uses the same complete candidate review and apply boundary as other changes.

An absorption proposal identifies its source, contribution decisions, proposed
file changes, rationale and unresolved questions. A contribution is an update,
creation, Facet, conflict, reference-only addition, explicit removal or
non-integration. Removal identifies an existing Point or Facet that is absent from
the candidate. Optional surviving destinations MUST resolve in the candidate;
they do not establish that all meaning was preserved.
The complete proposed result is validated before application. Repeating an
identical proposal against its resulting content can produce a justified no-op.

Changed Points prompt inspection of structural ancestors, attached Facets and
known incoming cross-Tree references. This review set is limited to recorded
connections. Changes to explanations require explicit judgment. Decision status
changes and observation dates receive explicit handling. Incoming Facet hosts
remain available for review. Direct Markdown citers are reported separately as
mentions, without transitive dependency inference. Both observations preserve
removed references for inspection; candidate link diagnostics remain distinct
from structural invalidity.

An optional preservation review declares its source scope, located material units,
dispositions, rationales and surviving destinations. Unresolved units and source
access limits MUST remain explicit. Structural checks on that record do not
establish semantic coverage. Projects MAY adopt stronger source-accounting Checks
without imposing that inventory on every ordinary edit.

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

A saved draft MAY retain an Absorb review packet and candidate Check runs. The
draft revision covers this metadata as well as the proposed files. Review packets
MUST match the exact original baseline, candidate and plan; callers cannot supply
an alternate normalized candidate or approval field. Candidate Check runs MUST
match the candidate identity, root and exact active definitions. Updating a plan
requires matching new active review metadata. Previous reasoning and Check evidence
MAY remain as historical packets naming their original candidate and plan; they
MUST be visibly distinct from active evidence and cannot establish compliance for
the changed candidate. Omitted metadata is removed from the active packet rather
than silently inherited. Existing drafts without metadata remain usable. Retention
is not an approval or a substitute for the caller's authority to apply.

A complete candidate preview uses the proposed captured records and ordinary
reading behavior. It remains visibly separate from the current authored Atlas and
cannot apply changes through navigation. Private working copies MAY preserve
unfinished form input before a draft is prepared; restoration must retain its
original baseline and expose stale conditions. Saving a working copy does not
create a valid candidate or authorize application.

## Checks

Applicable active Checks can be evaluated by explicitly trusted caller-provided
evaluators or recorded manual review. Results name the exact definition revision,
source baseline, evidence and `pass`, `fail`, or `unable`. Retired and draft Checks
do not govern. Required Checks need actual verification for a compliance claim.
No evaluator is loaded or executed merely because an Atlas references it.
Candidate evaluation uses the reconstructed proposed bytes and remains visibly
distinct from evaluation of the current source. Saved candidate evidence does not
assert that the proposal was applied, authenticate its reviewer, or bypass stale
source and draft checks. Non-passing and incomplete required review remain visible.

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
The adopted Style is excluded from publication unless explicitly selected.
Selection includes its complete definition; no custom policy is disclosed merely
because its Tree is selected. Published output executes no authored HTML or scripts.
