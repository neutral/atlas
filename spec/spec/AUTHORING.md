# Atlas coordinated authoring

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns prepared file changes and their application. [Working with Atlas](../OPERATING.md) owns absorb decisions. [Format](FORMAT.md) owns authored meaning. [Checks](CHECKS.md) owns verification. [Conformance](CONFORMANCE.md) owns claims. Saving files does not establish Check compliance, source truth, or completion of an authoring task.

Preparation and application use the public Atlas Library. They do not execute project commands, fetch sources, adopt catalog policy automatically, or infer permissions from content. Paths select one exact Atlas within an explicit repository. The implementation does not traverse symbolic links, nested Atlases, or ignored directories for authoring.

## Prepare

`prepareAtlasChange({ repositoryRoot, atlasPath, expected, operations, configuration? })` is synchronous and performs no filesystem writes. The repository root is absolute. The Atlas path is exact and repository-relative; `.` selects the repository. `expected` contains an exact `viewDigest`, or `atlasMissing: true` for initialization. A differing observation fails with `atlas.authoring.stale`.

The optional reading `configuration` uses the workspace rules. It accepts
`specificationRevision` and `maxDocumentBytes`; overrides merge over durable
workspace configuration. The request and plan bind effective configuration and
its source digest for later revalidation. Preparation writes no workspace state.
Obsolete cache options and unsupported plan shapes are rejected without conversion.

Preparation captures complete authorized input bytes and validates a private immutable proposal. It does not use retained prefixes as complete documents. Outside-Atlas local targets remain descriptive paths and are not read. Explicit contained source targets participate in baseline checks; they do not become writable structural destinations.

Operations execute in supplied order. Each operation selects exact ids and explicit create or update intent. There is no upsert, inferred identity merge, or inferred anchor/context conversion.

- `initialize`: `fields` and optional `body`; create format 2 `atlas.md`,
  `catalog.json`, and `connections.json` together.
- `map`: `action: create` or `update`, `id`, creation `directory`, optional
  `set`, `unset`, and `body`.
- `area`: `action`, `id`, `mapId`, optional `set`, `unset`, and `body`; edit one
  catalog Area and optionally replace its complete Map body.
- `point`: `action`, `id`, `mapId`, exact `record: anchor` or `context`, optional
  `set`, `unset`, and `body`. Review and relations belong to the canonical Point.
- `resource`: `action`, `id`, optional `set`, `unset`, and `body`; edit one catalog
  Resource and optionally replace the complete Atlas body.
- `catalog`: optional `set` and `unset`; edit supported catalog declarations.
- `connection`: `action: create` or `update`, `id`, and `collection` selecting
  `memberships`, `relations`, `content`, or `references`; optional `set`, `unset`,
  and `body`. `set` holds the entry fields other than its ID. `body` replaces the
  complete owning Markdown document.
- `supersede`: `sourceId`, `targetId`, and nonblank `note`; add the relation and
  its identified Markdown Connection explanation, and set target lifecycle.
- `adopt-check`: `id`, exact Check `text`, publisher `registration` containing
  `check`, `level`, and `applies-to`, and `source: { uri, sha256? }`. Preserve both
  selected publisher inputs. Existing different bytes or registration require
  an explicit repair.
- `publication`: `action: create`, `id`, and complete profile `text`; create
  `.publication/<id>.md` with an absent identity and destination. The declared
  type and id MUST match. Ordinary publication validation checks the explicit
  selection. The operation grants no publication or Resource-access permission.
  Existing profiles use complete raw repair; creation does not overwrite them.
- `repair-document`: exact structural `path` and complete replacement `text`.
  It can create a missing selected global JSON file. Markdown repair replaces an
  existing document. Invalid drafts remain inspectable.

`set` names logical authored fields. The Library partitions them into local headers, catalog declarations, connections, and Markdown under their owning contract. Titles, summaries, questions, and explanations are edited through `body`; derived fields are not accepted in `set`. Identity discriminators cannot be changed. Omitted fields and bodies remain unchanged. Object updates preserve omitted members. Collection updates preserve omitted fields and extensions on entries with matching authored keys. Collections retain the requested order and membership. `unset` contains explicit top-level names or JSON pointers; it removes the selected value before `set` is applied. Unrequested nested extension loss is rejected. Map and Area questions remain unchanged unless explicitly edited.

Point collection edits can supply explicit connection IDs. Retained entries preserve their IDs; new entries without IDs receive readable collision-safe IDs. File renames do not change selected identities.

Repeated identical values produce no file change. Preparation preserves the original bytes for a no-op. Changed headers use two-space JSON indentation and retain the source newline style; an unchanged body retains its exact bytes.

Before a Point write, the plan exposes the selected exact id, record kind, Map question, and anchor provenance for an existing identity. Provenance includes the anchor path, Map id, source hash, and `origin: baseline` or `proposal`. The latter identifies an anchor created earlier in the same prepared change. Similarity is not an identity decision. Raw repair that cannot establish prior identity reports that gap and cannot claim conforming Point authoring.

The frozen JSON-safe result has contract `atlas.change-plan/2`, a digest, status `ready`, `no-op`, or `invalid`, exact roots, the request, processor and reading configuration, a complete baseline, file changes, Point decisions, changed subjects, adopted Check provenance, before/after validation, applicable Checks, gaps, and limits. `localTargets.before` and `localTargets.after` retain exact absolute local target paths for safe storage placement, including outside-Atlas paths; recording them performs no source reads. Global-only changes participate in changed-subject analysis and complete baseline checks. Every file change includes expected absence or complete before bytes and hash, complete after bytes and hash, and an untruncated unified diff. An invalid UTF-8 source uses an explicitly labelled base64 diff so every original byte remains reviewable. The digest identifies the plan; it grants no authority.

## Apply and recovery

`applyAtlasChange(plan, { recoveryDirectory, mode })` is synchronous. Mode defaults to `validated`, which requires complete valid proposed validation. Explicit `draft` mode permits only `repair-document` operations. Draft saving retains diagnostics and makes no valid-model or completion claim.

Application checks the plan contract, digest, processor, configuration, operation-derived proposal, complete baseline, and destination identities before writing. These checks use current source bytes and do not depend on workspace process lifetime. A stale preflight returns `stale` without creating recovery files or changing Atlas files. No-op plans return `no-op` without writes.

The caller supplies an absolute durable recovery directory separate from the Atlas,
repository `tmp/`, and `.git/`. Recovery storage MUST NOT contain or
be contained by those paths. It must not intersect a local source target retained from
either the baseline or proposal. Before the first Atlas mutation, application creates
an exclusive operation directory containing the complete plan, original bytes, and
progress. Recovery storage is not an audit report or an automatic commit. Failed
recovery preparation prevents Atlas writes.

Each destination is checked again immediately before replacement. New files use exclusive creation semantics. Updates use an exclusive temporary file and atomic per-file replacement. Missing parent directories can be created within the authorized Atlas. Application refuses symbolic links and case or normalization aliases throughout the path.

The result has contract `atlas.change-application/1` and status `applied`,
`no-op`, `stale`, or `partial`. It identifies the plan, written and pending paths,
conflicts, validation when observed, gaps, and limits. A created recovery has
`recovery.status: removed`, `retained`, or `cleanup-failed`. The result includes
`recoveryDirectory` when recovery remains or cleanup cannot be confirmed.
No-op and stale preflight results have no recovery state.

After all replacements, application compares the complete source, configuration,
and validation with the proposal. Confirmed application MUST remove its own
operation recovery. Cleanup does not remove separately selected CLI plan files,
other operations, drafts, or Check reports. A cleanup failure preserves the
`applied` source result and reports `cleanup-failed` with the remaining location
and exact gaps. Callers MUST NOT present cleanup failure as complete cleanup.

Partial application MUST retain the complete plan and original bytes needed to
inspect and recover the interrupted edit. The plan also contains each original
byte sequence, so failed cleanup can retain inspectable source even after a
separate original file was removed. Recovery removal keeps that plan until other
content is removed and attempts to preserve complete metadata after a cleanup
failure. Any failure to preserve it remains explicit. Application does not
roll back over later external edits automatically.

Each current operation has exact workspace metadata with contract
`atlas.change-recovery/2`. A live operation also has an `atlas.change-owner/1`
record with its host and process id. Completion releases that owner before
cleanup. Unsupported metadata and journals without the current manifest are
refused; readers MUST NOT default, convert, or rewrite them. A recovery directory
with an unsupported plan remains available for direct file inspection; this API
does not remove it.

`inspectAtlasRecovery({ repositoryRoot, atlasPath, recoveryDirectory })` reads
one exact operation. It returns contract `atlas.change-recovery-inspection/1`,
the complete current file bytes and identities, the plan digest, an inspection
`digest`, and `inactive`. It checks exact workspace ownership, plan integrity,
known file names, regular paths, and protected source boundaries. Missing or
unsupported metadata requires direct inspection outside this API. Inspection
performs no write and grants no authority to discard.

`discardAtlasRecovery` takes the same selection and `inspectedDigest`. It
explicitly removes that inspected inactive operation.
The caller MUST inspect the complete recovery and decide that its content is
unneeded before authorizing discard. Discard MUST reject a changed inspection
or an owner whose inactivity cannot be established. A live or inaccessible
process, or an owner on another host, prevents discard. A recorded process that
has exited permits it. Reused process ids conservatively prevent discard.
Discard checks each file again and removes only recognized selected recovery
content. It never restores or changes Atlas files. Its
`atlas.change-recovery-discard/1` result reports `discarded` or `partial`, removed
paths, and gaps. A partial cleanup requires another inspection; it does not
authorize a broad directory deletion.

The implementation does not promise whole-Atlas atomicity, filesystem compare-and-swap, or immunity from a writer racing the final check. Observed stale input is refused. Per-file replacement and retained originals bound recovery; they do not supply a repository transaction.

## Verification boundary

Preparation uses shared Check discovery over the whole proposal, including
invalid repair proposals, and records `scope: whole-proposal`. Actual changed
subjects remain separately listed; conservative policy discovery does not claim
that every unchanged subject was edited.

`checks.applicable` retains active Checks with resolved subjects in scope.
`checks.unresolved` retains readable active Checks whose applicability cannot
be resolved. Each unresolved entry preserves definition, registration, and
applicability fields from discovery,
`outcome: "unable"`, and a reason. `checks.diagnostics` and `checks.unresolvedCheckIds`
preserve discovery gaps. `checks.complete` requires a ready proposal, complete
discovery, and no unresolved candidates or requested ids. An invalid proposal
MUST NOT treat recovered policy as resolved applicability or required
satisfaction.

Missing evaluation remains unavailable verification. Application never converts
saving or valid syntax into a Check pass. `evaluatePreparedChange(plan, options)`
explicitly evaluates the sealed proposal with the evaluator contract's options.
It returns `{ contract: atlas.prepared-check-run/1, planDigest, paths, run }`.
The receipt keeps the genuine evaluator run and exact changed paths; the run
retains its declared evaluation scope and Check revisions. It does not reopen
the unchanged working tree as though it contained proposed edits. Required
outcomes must actually pass before a compliance claim. Failed, advisory, and
unable outcomes remain visible.

Invalid drafts retain raw repair access. Incomplete source capture cannot produce an applicable plan. The supported operations and operated tests do not by themselves establish authoring-tool conformance, useful absorption, a successful human journey, or completion of Atlas Editor.


## Installed authoring command

`atlas-author` uses the public prepare, apply, prepared-evaluation, and recovery
operations:

```text
atlas-author prepare --request ABS.json --plan ABS.json
atlas-author apply --plan ABS.json --recovery ABS [--draft]
atlas-author evaluate --plan ABS.json --actor-kind human|agent|tool --actor-id ID
atlas-author recovery-inspect --repository ABS --atlas REL --recovery ABS
atlas-author recovery-discard --repository ABS --atlas REL --recovery ABS --inspected-digest SHA256
```

File and directory arguments are absolute except `--atlas`, which is the exact
repository-relative Atlas path. Every option appears at most once. The request file
contains the complete `prepareAtlasChange` input object, including exact roots,
expected identity, and operations. The CLI supplies no implicit repository, Atlas,
identity decision, or evaluator registration.

Prepare performs the public read-only preparation before writing the complete JSON plan to the exact selected file with exclusive creation and a file flush. The parent directory must already exist. Plan output must lie outside the Atlas, repository `tmp/`, and baseline or proposed local source targets. Existing output, symlinks, unsupported paths, and source collisions are refused. The CLI does not rewrite the request or automatically apply the plan. Successful output is `{ contract: atlas.change-plan-file/1, planPath, planDigest, status }` on stdout; the complete diff and source bytes remain in the plan file.

Recovery inspection prints the complete public inspection as JSON. Recovery
discard requires its exact digest and the same workspace and operation paths.
Both commands use the public recovery APIs and their guards.

Apply loads the saved JSON plan and calls the public application API. `--draft` selects explicit raw-repair draft saving. The complete application result is JSON on stdout. The mandatory recovery path follows the same durable-storage restrictions as the library.

Evaluate uses the explicit actor and the sealed proposal. The installed command supplies an empty evaluator registry and no host capabilities. It performs no shell, module-loading, network, or credential action. Its real result can report unavailable verification; it cannot manufacture a pass. Host applications register trusted verifiers through the public API.

Exit `0` means a ready or no-op plan file, an applied or no-op change with valid final
validation and completed cleanup, a recovery inspection or completed discard, or an
evaluator result satisfying required Checks. Exit `1` means an invalid prepared/saved
draft or unsatisfied verification. Exit `2` means malformed arguments, a tool error,
stale input, incomplete observation, partial application, or incomplete recovery
cleanup. Expected errors use JSON stderr `{ error: { code, message } }`; unexpected
failures use `atlas.tools.unexpected-error`. `--help` prints plain-text usage and
exits `0`.

Plan-file persistence is a separate explicit CLI effect. Library preparation remains read-only. Neither a plan file nor a successful process exit establishes Check compliance, authorization to publish, or completion of an authoring task.
