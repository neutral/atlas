# Authoring reference

Authoring prepares an exact candidate, retains a draft for review, and applies
the reviewed revision against its original baseline. Import these operations from
`@neutral/atlas`. See [editing](../editing.md) for the Editor workflow.

## Prepare

| Function | Result |
| --- | --- |
| `prepareChange(view, request)` | An `atlas.change/1` plan from a captured view. |
| `prepareChangeFromDisk(root, request, {view?, observedFiles?}?)` | A plan that also captures existing records in a proposed manifest's Tree scope. |
| `prepareInitialization(view, {id, title, styleId?, styleContent?})` | A styled empty Atlas; requires an absent `atlas.json`. Select a curated ID or complete custom record. Omission defaults to Explanatory perspectives. |
| `prepareStyleChange(view, {styleId?, styleContent?, reason})` | Explicit adoption, replacement or revision of the complete local Style; requires a valid Atlas and one explicit selection. |

The change request contains:

| Field | Contract |
| --- | --- |
| `changes` | Array of `{path, content}`. Paths are normalized Atlas-relative authored records; `null` content proposes deletion. |
| `reason` | Nonblank explanation of the change. |
| `styleChange` | Must be `true` for an explicit Style adoption or revision; ordinary edits cannot change policy silently. |
| `sourcePreconditions` | Optional array of `{uri, sha256}`; at most 100. Apply requires matching local bytes within caller-granted roots. |

Preparation writes no authored files. The plan contains `baseline`, complete
before/after `changes`, `validation`, `candidate` and source preconditions. Its
status is `ready`, `invalid` or `noop`. Invalid candidates remain inspectable.

Use `prepareChangeFromDisk` when replacing a manifest: records hidden by a broken
manifest must also be observed and checked before application. Optional
`observedFiles` carries additional captured `{path, content, rawBase64?, sha256}`
records as preconditions. Malformed UTF-8
is captured as `content: null` with `rawBase64`; repairs expose `beforeBase64`.
Review those original bytes alongside the replacement.

## Save and apply

| Function | Behavior |
| --- | --- |
| `saveDraft(root, {plan, id?, expectedRevision?, review?, checkRuns?})` | Save privately; return `{id, revision, plan, …}`. Optional Absorb reasoning and candidate Check runs join the exact draft revision. Updating an ID requires its current revision. |
| `loadDraft(root, id)` | Read the complete saved draft. |
| `listDrafts(root)` | List draft identities, revisions, reasons, statuses and baselines. |
| `applyDraft(root, id, {expectedRevision, allowedRoots?, onProgress?})` | Apply the exact reviewed revision. |
| `deleteDraft(root, id, {expectedRevision})` | Delete the exact saved revision. |
| `applyChange(root, plan, {allowedRoots?, onProgress?}?)` | Apply a directly supplied plan after the same validation and baseline checks. |

Apply checks the baseline, changed files, observed records, source preconditions
and complete candidate before the first authored write. Paths remain within the
selected Atlas's authored records. A stale draft or unmet precondition is refused.
Saved drafts keep their original baseline across refresh and restart.

`inspectChange(plan)` reconstructs `{before, after}` from exact plan bytes and
checks their identities; a supplied normalized candidate is not authority.
`changePlanIdentity(plan)` identifies the proposed effects and source preconditions.
[`reviewChange(plan)`](absorb-review.md#review-consequences) uses those observations
to show affected explanations, Facets, direct mentions and link diagnostics.

Optional `review` retains an Absorb packet; `checkRuns` retains up to ten complete
Check runs matching the candidate, root and active definitions. Changed plans need
matching active metadata. Omitting either field removes its active value, so
carry still-current metadata explicitly when adding evidence. Updating a plan
retains previous reasoning and Check runs in `reviewHistory`, each naming its
original draft revision, candidate identity and plan identity. This history is
not active evidence for the changed proposal; at most 100 reviewed revisions
are retained before a new proposal is required. These records
are revision-bound reasoning and evidence, not approval. See
[Absorb draft review](absorb-review.md) for exact examples and removal/consolidation.

Apply returns `atlas.apply/1` with `complete`, `noop` or `interrupted` status and a
transaction ID when applicable. Each file replacement is atomic; a multi-file
change is not. An exclusive writer lock prevents concurrent Atlas transactions.

## Try a reviewed change

After installing `@neutral/atlas`, run `node` in the directory where it is
installed. Paste this into the REPL to prepare a new Atlas in a temporary folder:

```js
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { openAtlas, prepareInitialization, saveDraft, applyDraft } =
  await import('@neutral/atlas');
const scratch = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-example-'))
);
const root = path.join(scratch, 'context');
await fs.mkdir(root);
process.env.ATLAS_STATE_HOME = path.join(scratch, 'state');
const view = await openAtlas(root);
const plan = prepareInitialization(view, { id: 'notes', title: 'Notes', styleId: 'explanatory-perspectives' });
const draft = await saveDraft(root, { plan });
console.log(JSON.stringify(draft, null, 2));
```

Review `plan.changes` and `plan.validation` in the printed draft. When satisfied,
apply its exact revision in the same REPL:

```js
await applyDraft(root, draft.id, { expectedRevision: draft.revision });
(await openAtlas(root)).atlas.title; // 'Notes'
```

Apply returns `status: 'complete'`. The Atlas has no Trees yet. A changed draft or
Atlas requires a new review. To run this example from the development checkout,
replace the package import with `await import('./library/src/index.mjs')`.

## Recovery

`listTransactions(root)` lists journals and their progress. After an interrupted
apply, `recoverChange(root, transactionId)` attempts rollback to the original
bytes. It checks every affected file first and refuses foreign edits or a live
writer's lock. Successful recovery returns `status: 'rolled-back'`, distinct from
successful application.

## Private storage

| Platform | Default state home |
| --- | --- |
| macOS | `~/Library/Application Support/Atlas` |
| Windows | `%LOCALAPPDATA%/Atlas`, falling back to `~/AppData/Local/Atlas` |
| Linux | `$XDG_STATE_HOME/atlas`, falling back to `~/.local/state/atlas` |

A trusted launch can set an absolute `ATLAS_STATE_HOME` outside the Atlas.
`resolveState(root)` reports the location without creating it. Each Atlas has a
directory keyed by its canonical path and bound to that path by ownership metadata.

Drafts, journals and retained Check reports can contain full source text. Keep
this storage private. Installation updates leave it in place.

## Styles, working copies and retained source review

`listStyles()` returns curated `{id, revision, title}` choices. `getStyle(id)`
returns the complete normalized definition and `content`, or `null` for an unknown
ID. Adoption copies exact local bytes; it never stores a remote lookup or silently
replaces an existing definition. Downgrading a styled collection to `atlas/1` is
refused with `STYLE_REQUIRED`; revise or replace its complete policy instead.
Custom `styleContent` is one complete Markdown
Style record. Supplying both `styleId` and `styleContent` is invalid.

Private working copies preserve unfinished forms separately from prepared drafts:
`saveWorkingCopy(root, {id?, expectedRevision?, baseline, form})` records
`form: {kind, title, context?, fields}`. `listWorkingCopies(root)` lists summaries;
`loadWorkingCopy(root, id)` reads a saved form; `discardWorkingCopy(root,
{id, expectedRevision})` removes its exact revision. Working copies retain their
original baseline and require current revisions when updating; they do not imply
candidate validity or approval. Each saved working copy is limited to 4 MiB before
pretty-printed storage; the shared private-state record ceiling is 32 MiB.

`getSourceReviewHistory(root)` returns retained observations and dispositions.
`recordSourceReview(root, {review?, decisions?, expectedRevision?})` saves a source
review and/or decisions. Each decision names `{uri, sha256, outcome, reason}`;
outcome is `needs-review`, `reviewed-unchanged` or `updated`. A disposition applies
only to those observed bytes. History preserves later failed inspections as well
as the last successful observation, so old evidence cannot hide missing or denied
sources. Supply the exact history revision when it exists; an outdated revision
is refused. A request accepts at most 1,000 review results and 1,000 decisions.
History has at most 10,000 observed URIs, 10,000 latest inspection outcomes and
10,000 decisions, subject to the 32 MiB state-record bound. See [source review](references.md) for interpretation boundaries.
