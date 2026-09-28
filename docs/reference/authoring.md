# Authoring reference

Authoring prepares an exact candidate, retains a draft for review, and applies
the reviewed revision against its original baseline. Import these operations from
`@neutral/atlas`. See [editing](../editing.md) for the Editor workflow.

## Prepare

| Function | Result |
| --- | --- |
| `prepareChange(view, request)` | An `atlas.change/1` plan from a captured view. |
| `prepareChangeFromDisk(root, request, {view?, observedFiles?}?)` | A plan that also captures existing records in a proposed manifest's Tree scope. |
| `prepareInitialization(view, {id, title})` | A plan for an empty Atlas; requires an absent `atlas.json`. |

The change request contains:

| Field | Contract |
| --- | --- |
| `changes` | Array of `{path, content}`. Paths are normalized Atlas-relative authored records; `null` content proposes deletion. |
| `reason` | Nonblank explanation of the change. |
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
| `saveDraft(root, {plan, id?, expectedRevision?})` | Save privately; return `{id, revision, plan, …}`. Updating an ID requires its current revision. |
| `loadDraft(root, id)` | Read the complete saved draft. |
| `listDrafts(root)` | List draft identities, revisions, reasons, statuses and baselines. |
| `applyDraft(root, id, {expectedRevision, allowedRoots?, onProgress?})` | Apply the exact reviewed revision. |
| `deleteDraft(root, id, {expectedRevision})` | Delete the exact saved revision. |
| `applyChange(root, plan, {allowedRoots?, onProgress?}?)` | Apply a directly supplied plan after the same validation and baseline checks. |

Apply checks the baseline, changed files, observed records, source preconditions
and complete candidate before the first authored write. Paths remain within the
selected Atlas's authored records. A stale draft or unmet precondition is refused.
Saved drafts keep their original baseline across refresh and restart.

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
const plan = prepareInitialization(view, { id: 'notes', title: 'Notes' });
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
