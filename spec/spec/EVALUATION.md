# Atlas Evaluation

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns the public evaluator registry, explicit Check execution, and retained evaluation bundles. [Checks](CHECKS.md) owns project-local policy and ordinary evaluation. [Conformance](CONFORMANCE.md) owns compliance claims. [Tools](TOOLS.md) owns captured reading views. [Workspace](WORKSPACE.md) owns process-local workspace reuse.

Evaluation inspects adopted Checks from one captured Atlas view. It MUST NOT adopt catalog Checks, load evaluator modules, grant permissions, execute project commands, or create a report implicitly. An empty registry is the default. Evaluators implement only the Checks explicitly registered by their host; their policy does not govern other Atlases.

## Registration and discovery

`createEvaluatorRegistry(registrations = [])` creates a frozen registry with contract `atlas.evaluator-registry/1`. Each registration contains `id`, `version`, `checks`, optional `capabilities`, and a trusted `verify` callback. Each supported Check has an exact `id` and `revision`. `calculateCheckRevision(bytes, registration)` identifies the exact captured
Markdown bytes and assembled catalog Check registration, including effective Check extensions. It recursively sorts
object keys, preserves array order, and hashes the UTF-8 revision basis
`atlas.check-revision/2\n<unprefixed Markdown SHA-256>\n<canonical registration JSON>`.
The result is `sha256:` followed by the lowercase SHA-256 digest of that basis. A registry MUST reject duplicate evaluator ids and competing registrations for the same Check id and revision. Registry descriptors contain no callback functions.

`discoverChecks(view, options = {})` returns contract `atlas.check-discovery/1`.
Options select an exact `status`, `level`, `appliesTo` kind, `paths`, `checkIds`,
or registry. The result retains the view's `status` and `sourceIdentity`.
Discovery MUST preserve independently readable local Check definitions when an
unrelated record makes the view invalid or incomplete. It MUST use captured
source and MUST NOT reread working files, substitute a newer observation, or
execute Verification.

Each item contains the definition's `id`, `title`, `summary`, `path`, and
`status`. A definition MUST parse and satisfy the local Check document contract
before discovery can return it as an item. Recovery from an invalid or incomplete
view omits malformed, unreadable, or truncated definitions and identifies each
with a diagnostic at its exact path. A ready view uses its already validated
Check definitions even when retained raw-document output is truncated. Captured
raw-document access remains available within the view's byte limits. Discovery
MUST NOT invent an item from a catalog registration alone.

Each item also contains `level`, `appliesTo`, `revision`, `subjects`,
`applicability`, and `evaluator`. A missing, invalid, or ambiguous catalog
registration leaves `level`, `appliesTo`, and `revision` as `null`; discovery
MUST NOT infer defaults or select a competing registration. Duplicate local
Check ids retain separate items by path with these fields unknown. Unresolved
Check-owned extensions can leave valid level and applicability declarations
available while `revision` remains `null`. Invalid unrelated catalog entries
MUST NOT suppress independently recoverable Check registrations or extensions.
An exact revision requires complete captured Markdown identity and the
unambiguous assembled Check registration, including effective Check extensions.
`evaluator` is a matching registry descriptor or `null`. An unknown revision
cannot match an evaluator.

A ready view supplies exact selected `subjects` and
`applicability: { status: "resolved", reasons: [] }`. An invalid or incomplete
view supplies `subjects: null` and
`applicability: { status: "unresolved", reasons: [...] }`, with explicit reasons
for the unavailable resolution. These items MUST NOT expose a normalized model
or synthetic subjects. An empty resolved subject list means no subjects fall
within the declared applicability and selected paths. Unresolved applicability
MUST NOT be represented by that empty list or treated as inapplicability.

The result's `complete` field reports whether discovery recovered all local
Check definitions and their registrations unambiguously before filtering.
Discovery completeness is independent of Atlas validity and subject resolution.
`diagnostics` contains `{ message, path }` entries for missing, malformed,
unreadable, truncated, or ambiguous discovery inputs. Filters MUST NOT erase
these diagnostics or turn incomplete discovery into complete discovery.
Discovery completeness establishes neither Verification nor Check compliance.

The `status`, `level`, and `appliesTo` filters remove only known mismatches.
Unknown registration fields MUST survive their filters. `paths` scopes resolved
subjects; it does not remove unresolved Check candidates. An empty `checkIds`
array selects no items. If discovery is complete, an unknown requested Check id
is invalid usage. Otherwise, requested ids that could not be recovered appear
in `unresolvedCheckIds`. An empty item list with incomplete discovery MUST NOT
establish that no local policy exists.

A matching id without the exact revision is unsupported. Changing whitespace, explanatory text, level, applicability, or registration extensions changes the revision. Evaluator authors MUST review and register supported revisions explicitly. An authored module path, command, or extension field grants no registration authority.

## Explicit execution

`await evaluateChecks(view, options)` runs selected Verification callbacks. Options require `actor: { kind, id }`. Kind is `human`, `agent`, or `tool`. Actor ids identify the host-attributed actor; the Library does not authenticate them. Options also accept `registry`, `paths`, `checkIds`, `capabilities`, and an `AbortSignal` as `signal`.

The host supplies capability functions explicitly. A registration names each required capability. A callback receives only those named grants. Missing grants produce `unable` without invoking the callback. The Library snapshots the grant mapping and actor before asynchronous execution. In-process callbacks are trusted host code. Their declared grants do not sandbox ambient filesystem, process, or network access. Hosts MUST select trusted implementations and own external authority decisions.

The callback context contains the immutable `view`, captured `check` with its revision, exact `subjects`, attributed `actor`, granted `capabilities`, and optional `signal`. A callback returns only `outcome`, `summary`, `evidence`, and `diagnostics`. It MUST NOT supply replacement Check identity, subject scope, actor, or evaluator receipts.

Active Check callbacks return `pass`, `fail`, or `unable`. Pass requires supporting evidence and no diagnostics. Fail and unable require diagnostics. A diagnostic is a message string or `{ message, path? }`. Draft and retired Checks produce `not-applicable` without invoking a callback. An active Check MUST NOT use `not-applicable` to bypass Verification. Unsupported revisions, thrown errors, invalid callback results, and interrupted execution produce `unable` with diagnostics.

Evidence is an original text string or `{ summary, data, mediaType? }`, where data is text or `Uint8Array` bytes. Text strings serve as both summary and original text evidence. The Library copies accepted bytes and records their media type, base64 representation, byte length, and SHA-256 digest. A run accepts at most 8 MiB of evidence. It MUST NOT silently truncate evidence or fetch a file named by a summary. Evidence and pass record the attributed verifier conclusion. They do not independently establish truth, usefulness, or completion of work beyond the exact Requirement.

Cancellation is cooperative. An aborted run stops awaiting the callback and records inability. It cannot forcibly terminate trusted code or reverse that code's effects. Callbacks SHOULD honor the signal and return bounded evidence.

## Scope and coverage

Paths are exact Atlas-relative file or directory paths. `.` selects the whole
Atlas and is the default. Traversal, absolute paths, backslashes, and
non-normalized paths are invalid. Check ids select only local Checks; an empty
Check-id array selects none. Evaluation resolves selection only from a ready
view and rejects unknown Check ids there. Discovery preserves unresolved
requested ids when its inventory is incomplete, as specified above.

Subjects come from the captured resolved model and each Check's declared applicability. They retain kind, path, and applicable id or Map id. Selection includes subjects at a requested path or below a requested directory. A missing publication profile is represented by the declared publication subject at `.publication`. Other absent subject kinds are reported as inapplicable coverage without a synthetic evaluation row. A requested path missing from the examined source inventory remains unresolved.

Selecting `catalog.json` or `connections.json` conservatively includes all assembled subjects. Requested paths remain the recorded scope; this does not claim whole-Atlas selection or compliance.

Coverage records omitted Checks, uncovered subjects with Check status and level, unresolved paths, and Checks with no subjects in scope. A run MUST preserve these gaps. It MUST NOT infer that a selected Point path covers every global or related policy subject. Hosts that need a whole-proposal claim MUST evaluate the full proposed Atlas. Exact change paths can accompany that proposal receipt without narrowing its verification scope.

## Run result and claims

The frozen `atlas.check-run/1` envelope contains run id, start and completion timestamps, actor, Atlas identity and root, captured source identity, structural validation, selected scope, coverage, evaluations, freshness, and limits. Each evaluation records exact Check revision, status, level, subjects, outcome, summary, evidence, diagnostics, actor, and a matching evaluator receipt or `null`. A receipt records evaluator id and version, required capability names, timestamps, and whether the callback was invoked.

Invalid and incomplete structural views retain their validation result
separately. They produce no synthetic Check evaluation or normalized model and
invoke no verifier callbacks. Independently discovered policy does not make
such a view executable. The Library checks view freshness after callbacks. A
stale or unavailable source observation prevents a current satisfaction claim
even when a callback returned pass for captured bytes. Immutable proposal views
remain bound to their sealed input identity.

`requiredSatisfied` means that the usable selected subjects passed every applicable active required Check and no applicable required Check was omitted. It covers only selected subjects. Uncovered subjects remain explicit. Advisory failure or inability does not block this ordinary result by itself.

`wholeAtlasCompliant` additionally requires whole-Atlas path coverage and no omitted Check. Partial selection MUST NOT claim whole-Atlas compliance. `complete` is conservative audit completeness: the structural observation and freshness must be usable, no Check may be omitted, and no recorded outcome may be `unable`. An advisory inability can therefore leave ordinary required satisfaction true while audit completeness remains false. These fields MUST NOT be substituted for each other.

`evaluatePreparedChange` evaluates the complete sealed proposal through this same API. Its `atlas.prepared-check-run/1` result contains the plan digest, exact changed paths, and genuine run. The run also carries `preparedChange: { planDigest, paths }` for retention. Preparation and application do not invoke Verification implicitly. Saving a valid proposal does not establish Check compliance.

## Explicit report retention

`retainCheckReport(run, { directory, repositoryRoot, baseline?, changeSet? })` retains a genuine in-process run returned by evaluation. Deserialized or caller-assembled objects are not accepted as executed runs. Invalid or incomplete structural observations remain validation results and cannot create a synthetic Check audit bundle.

Directory and repository root are absolute. The destination MUST be new and outside the evaluated Atlas and the repository's `tmp/` directory. Obsolete cache options are rejected. The Library refuses destinations that create or replace a captured authored local source target. Keeping reports outside the evaluated Atlas prevents retention from modifying the report's own examined source scope. Repository-root Atlases require a durable destination outside that Atlas.

Retention writes these files without overwriting existing content:

- `report.json` conforms to the existing `urn:atlas:schema:check-evaluation:1` contract.
- `provenance.json` uses `atlas.check-report-provenance/1` and records the run, actor, source identity, scope, coverage, evaluator receipts, optional prepared-plan binding, report hash, evidence inventory, metadata origins, and retention timestamp.
- `evidence/` contains the original accepted evidence bytes. Each entry has an exact path, evaluation and evidence indexes, summary, media type, length, and digest.

The default immutable baseline is the captured view identity with a `sha256:` prefix. An explicit baseline accepts a SHA-256 identifier or a full `git:` object identifier. Explicit baseline metadata is marked caller-declared; retention does not resolve Git or prove the baseline's relationship to a change. The default change set uses the run id and selected paths. Explicit change-set ids and exact paths are also caller-declared. The source identity and prepared-plan binding remain distinct from those declarations.

The audit report preserves its conservative schema semantics. Its compliant field requires both complete audit execution and whole-Atlas compliance. Ordinary evaluation requires no retained report or baseline artifact. Retention MUST NOT run Verification or invent evidence.

Report and provenance files are each limited to 16 MiB. Files are written exclusively and flushed. Provenance is the completion record and is written last. An interrupted partial bundle cannot be read as a complete retained report. Failed retention can leave a partial destination for inspection; it does not delete caller evidence automatically. Workspace refresh, closure, and process exit do not remove retained bundles.

## Reading retained reports

`readCheckReport(directory, { view? } = {})` reads an explicit bundle. It validates the audit schema, provenance structure, correspondence of receipts and evidence, report digest, and every evidence length and digest. It rejects symlinked retained files, traversal, oversized files, inconsistent data, missing completion records, and changed reads.

The result contains `status: "read"`, `integrity: "verified"`, and `authenticity: "not-authenticated"`, plus the report, provenance, evidence bytes, and freshness. Hash verification establishes retained byte integrity. A party able to rewrite the report and its hashes can rewrite its assertions; integrity is not a signature or independent verification of the actor's conclusion.

Without a current view, freshness is `unavailable`. With a view, the Library checks its freshness, exact source identity, and every recorded Check revision. Exact agreement is `fresh`; changed source or Check revisions are `historical`; an unavailable observation is `unavailable`. A historical report remains readable evidence of its recorded execution. Reading MUST NOT re-run an evaluator, fetch external evidence, or convert historical results into current compliance. Captured source freshness does not establish that independently observed external evidence remains current.

## Errors and qualification

Invalid arguments use `atlas.tools.invalid-argument`. Retention and reading use `atlas.evaluation.unretainable-run`, `atlas.evaluation.unsafe-report-directory`, `atlas.evaluation.report-unavailable`, and `atlas.evaluation.invalid-report`. Verification inability is an evaluation outcome, not a fabricated process error or pass.
