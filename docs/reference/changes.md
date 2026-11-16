# Changes

This page gives the exact inputs, results, limits and refusals of the
operations that change an Atlas: preparing a change, keeping it as a draft,
reviewing it, applying it and recovering an interrupted apply. The rules every
implementation keeps are in
[Prepared changes and recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery);
why changes work this way is in [How changes land](../explanation/how-changes-land.md).
Each command's options and exit codes are in [The atlas command](cli.md), each
tool's input schema and result envelope in [The MCP server](mcp.md). Stamps and
moves are prepared the same way; their own rules are in
[Sources and stamps](sources.md).

The examples show the shape of a result; `…` stands for the values and
entries left out.

| Job | CLI | MCP | Library |
| --- | --- | --- | --- |
| Write the candidate folder | `candidate` | `atlas_candidate` | `writeCandidate` |
| Validate a candidate, saving nothing | `validate --from DIR` | `atlas_validate` with `from` | `prepareFromCandidate` |
| Prepare from file changes | `prepare INPUT` | `atlas_prepare` with `changes` | `prepareChange`, `prepareChangeFromDisk` |
| Prepare from a candidate | `prepare --from DIR --reason TEXT` | `atlas_prepare` with `candidate` | `prepareFromCandidate` |
| Prepare a new Atlas | `init` | `atlas_init` | `prepareInitialization` |
| Keep drafts | `drafts` | `atlas_drafts` | `saveDraft`, `loadDraft`, `listDrafts`, `deleteDraft`, `summarizeDraft` |
| Review a draft | `review ID` | `atlas_review` | `reviewChange`, `reviewImpact`, `inspectChange` |
| Apply a draft | `apply ID --revision REVISION` | `atlas_apply` | `applyDraft`, `applyBlocker` |
| Recover an interrupted apply | `recover [TRANSACTION_ID]` | `atlas_recover` | `listTransactions`, `recoverChange` |
| Locate private state | `state` | none | `stateHome`, `resolveState`, `checkStateLocation`, `isPrivateStatePath` |

Only apply and recovery write authored files. The candidate folder is written
only by `candidate`. Preparing (`prepare`, `init`, `move`, `stamp`) writes only
a draft in private state.

## Change requests

A change is given in one of two forms.

**Explicit file changes.** A JSON object with exactly these fields:

| Field | Value |
| --- | --- |
| `changes` | Required. An array of at most 1000 entries, each exactly `{ path, content }`. |
| `changes[].path` | A normalized record path relative to the Atlas root, at most 1000 characters ([Record paths](../../spec/spec/FORMAT.md#record-paths)). It names a file that is an authored record of the Atlas before or after the change: `atlas.json`, `style.md`, a Check under `.checks/`, or a declared Tree's `tree.json` or a `.md` file under its `points/` or `facets/`. Any other path is refused with `UNSAFE_PATH`. |
| `changes[].content` | The complete new text of the file, at most 2 MiB (2097152 bytes) as UTF-8, or `null` to remove the file. |
| `reason` | Required. Nonblank text that travels with the draft. |

Paths are unique within one request. An entry whose content equals the file's
current text is dropped, so it is not among the plan's `changes`. When
`atlas.json` is changed and declares a Tree directory the Atlas does not yet
declare, the files already on disk there are read and recorded in the plan as
`observedFiles` ([Plans](#plans)).

Every change, however it is prepared (`prepare`, `init`, `move` and `stamp`
included), is held to two more rules before anything is saved. A changed file
over 2 MiB is refused with `LIMIT_EXCEEDED`: "A changed file exceeds 2 MiB
(2097152 bytes)." And the Atlas the change makes is read as a reader reads it.
The change is refused with `INVALID_REQUEST`, "The change writes what a reader
would not read back:" and what it names, when:

- a file it writes would not be captured, such as one whose path aliases
  another under case or Unicode normalization, one whose text holds an
  unpaired surrogate, or one more than 64 folders below `points/`, `facets/`
  or `.checks/` (`READ_LIMIT`); or the candidate passes the reader's bounds of
  10000 files, 64 MiB, and 40000 directory entries listed under those folders
  (`READ_LIMIT`, "Authored directory traversal exceeds its entry bound.").
  The message names each as `PATH (CODE)`, and
  `diagnostics` holds the reader's diagnostics.
- a path would be a file and a folder at once: a path it writes, or the Atlas
  holds, lies beneath one that is a file. The message names both paths, and
  `diagnostics` is empty.

Read-back counts the directory entries that the paths of the Atlas's files
imply, not empty folders already on disk. An Atlas whose record folders
already hold close to 40000 entries can therefore pass read-back and still
have its apply interrupted by that bound.

```json
{"reason":"Drop the note on the local limit.","changes":[{"path":"trees/product/facets/local-limit.md","content":null}]}
```

**A candidate.** A directory that holds the whole proposed Atlas: the
Atlas's own [candidate folder](#the-candidate-folder), or another directory
([Candidate directories](#candidate-directories)). The file changes are derived
from it: every authored record that differs from the Atlas's is written, every
record the Atlas holds that the candidate lacks is removed. With a candidate
the reason is given beside it (`--reason TEXT`, or `reason` in
`atlas_prepare`).

Through MCP, `atlas_prepare` takes exactly one of `changes` and `candidate`,
and a `baseline` that must be the identity the session captured
([The MCP server](mcp.md)).

## The candidate folder

The candidate folder is `.atlas-candidate` at the Atlas root. No reader
captures it, since `.atlas-` names are reserved
([Capture](../../spec/spec/FORMAT.md#capture)).

`candidate` (`atlas_candidate`) takes the Atlas's writer lock and holds it
while it works, as apply and recovery do, so none of them runs at the same
time; taking the lock makes the Atlas's [private state](#private-state) folder
and its `owner.json` when they are missing, even for a candidate then refused
with `NOT_FOUND`, `UNSAFE_PATH` or `INCOMPLETE` (not for an MCP `STALE` found
before the copy). It first saves there a record of its copy that names no Atlas
(`candidate.json`, with `baseline` `null` and a `copy` ID of its own). It then
removes everything the folder
holds, edits not yet prepared included, and writes a fresh copy of the Atlas's
captured files as their exact bytes: `atlas.json`, `style.md`, each declared
Tree's `tree.json`, `points/` and `facets/`, and `.checks/`. An Atlas that
does not validate is copied as it is, a file that is not UTF-8 included. Once
the copy is whole, it saves the record again, with the identity of the Atlas
it copied as `baseline` and a new `copy` ID. It writes nothing else, in the
folder or anywhere in the Atlas. Preparing from the folder is refused unless
that record names the Atlas as it is
([Candidate directories](#candidate-directories)).

| Key | Value |
| --- | --- |
| `format` | `atlas.candidate/1` |
| `status` | `ready` |
| `path` | The folder's absolute path. |
| `files` | How many files were written. |
| `baseline` | The identity of the Atlas copied, as recorded. Through MCP it is also the session's capture, which `atlas_prepare` then takes. |

The refusals below leave the folder as it was, except an MCP `STALE` found
once the copy is written. When the private state cannot take the first record,
the command fails with the system's code, such as `EACCES`, and the folder is
left as it was too. A failure after that, while the folder is emptied or the
copy is written, leaves a partial copy whose record names no Atlas.

| Refusal | Code |
| --- | --- |
| `.atlas-candidate` is a symbolic link, or is not a directory | `UNSAFE_PATH` |
| The folder holds a symbolic link at any depth; the error's `diagnostics` name each as `PATH_SYMLINK`. Nothing is removed. | `UNSAFE_PATH` |
| The folder and the private state lie one inside the other | `UNSAFE_PATH` |
| The folder is nested deeper than 64 levels, or holds more than 40000 entries | `LIMIT_EXCEEDED` |
| The Atlas cannot be read completely; `diagnostics` holds the first 100 | `INCOMPLETE` |
| The root holds no `atlas.json` | `NOT_FOUND` |
| Another writer holds the writer lock, an apply, a recovery or another `candidate`: "Another Atlas writer is running."; a writer that stopped during an unfinished transaction left the lock: "Interrupted transaction ID needs recovery."; the lock's metadata cannot be read; or the lock is no longer this `candidate`'s before it saves the record or empties the folder: "Writer lock changed." | `LOCKED` |
| The private state is refused: by the CLI and the MCP server before the command or tool reads anything, by the Library when the lock is taken ([Private state](configuration.md#private-state)) | `STATE_OWNER`, `UNSAFE_STATE`, `INVALID_STATE_HOME` |
| MCP: the Atlas on disk is not the one the session captured, before or after the copy | `STALE` |

## Candidate directories

A candidate directory, the candidate folder included, is read as follows.

**Where it may lie.** It is an existing directory, not a symbolic link. It is
the candidate folder, or it lies outside the Atlas, does not contain the
Atlas, and lies outside private state. The CLI takes `.atlas-candidate`,
which names the folder at the Atlas root, or any other path, taken from the
working directory. Through MCP it is
`.atlas-candidate` or an absolute path within a source root granted at launch
([Configuration](configuration.md)).

**What it must hold.** `atlas.json` as a regular UTF-8 file at its top. The
candidate's own manifest decides which files are records: `style.md`, each
Tree it declares with that Tree's `tree.json`, `points/` and `facets/`, and
`.checks/`. These folders are the record folders.

**What is refused by name.** Every entry of the directory, at any depth, is
sorted by its name and kind. A candidate that holds any of these is refused
with `UNSAFE_PATH`; the error's `diagnostics` name each such entry, and its
message the first 20:

| Entry | Diagnostic |
| --- | --- |
| A symbolic link, anywhere | `PATH_SYMLINK` |
| Anything that is neither a regular file nor a directory, anywhere | `FILE_KIND` |
| A file in a record folder whose name no record path admits, such as one with a `.atlas-` component | `PATH_UNSAFE` |
| A file in a record folder that is not a record, such as `points/.DS_Store` or `points/notes.txt` | `RECORD_UNEXPECTED` |

**What is left out.** A file outside the record folders that is not a record,
such as a `README.md` or a `sources/` folder, is not part of the change. The
plan's `ignored` lists, sorted, each such file that the Atlas does not hold at
the same path with the same bytes, so a plain copy of the Atlas folder lists
none of its sources. A regular file whose name begins with `.atlas-write-` is
passed over.

**What else refuses it.**

| Refusal | Code |
| --- | --- |
| The directory does not exist, is a symbolic link, or is not a directory | `UNSAFE_PATH` |
| It lies inside the Atlas other than as `.atlas-candidate`, or contains the Atlas | `UNSAFE_PATH` |
| It lies inside private state | `UNSAFE_PATH` |
| It has no `atlas.json` at its top as a regular UTF-8 file | `INVALID_REQUEST` |
| It is nested deeper than 64 levels, or holds more than 40000 entries | `LIMIT_EXCEEDED` |
| It differs from the Atlas in more than 1000 files | `LIMIT_EXCEEDED` |
| It cannot be read completely, a record in it changing while it is read among them; the error's `diagnostics` hold the candidate's diagnostics, such as `READ_CHANGED` | `INCOMPLETE` |
| The current Atlas, or the scope a new manifest declares, cannot be read completely | `INCOMPLETE` |
| A record in it is not valid UTF-8; `diagnostics` name each as `FILE_UTF8` | `INVALID_CANDIDATE` |
| It is `.atlas-candidate`, and the Atlas is no longer the one `candidate` copied, or the record or the Atlas read before the folder differs from the one read after it, as when `candidate` writes another copy meanwhile: "The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy." | `STALE` |
| It is `.atlas-candidate`, and private state holds no record of a whole copy, none at all or one whose `baseline` is `null`: "No record says which Atlas this copy was made from; run candidate again." | `STALE` |
| It is `.atlas-candidate`, and the record of its copy is not one, such as a `baseline` that is not an identity: "Invalid candidate record." | `INVALID_STATE` |
| The change derived from it, applied to the Atlas, does not give the identity of the candidate as captured | `INVALID_CANDIDATE` |
| MCP: not `.atlas-candidate` and not an absolute path | `INVALID_ARGUMENT` |
| MCP: an absolute path outside every source root granted at launch | `CANDIDATE_DENIED` |

Only the candidate folder is checked against a record: a directory outside the
Atlas has none. A candidate that reads but does not validate is not refused:
the plan is saved with status `invalid`.

## Validate a candidate

`validate --from DIR` (`atlas_validate` with `from`) reports what
`prepare --from DIR` would report of that candidate and saves nothing. A
candidate that preparing would refuse is refused the same way. Without
`--from`, `validate` reports the Atlas itself: `format`, `status`, `identity`
and `diagnostics`.

| Key | Value |
| --- | --- |
| `format` | `atlas.validation/1` |
| `status` | The plan's validation status: `ready`, `invalid` or `incomplete`. |
| `identity` | The candidate's view identity. |
| `diagnostics` | The candidate's own diagnostics, and `STYLE_CHANGE_ALONE` when the change breaks [the Style rule](#the-style-changes-alone). |
| `candidate` | The candidate directory's absolute path. |
| `changes` | `{ path, action }` for each file that differs, `action` `write` or `remove`. |
| `ignored` | The files left out of the change ([Candidate directories](#candidate-directories)). |
| `linkDiagnostics` | The link diagnostics review would report: `{ code, path, line, column, message }` ([The reference index](sources.md#the-reference-index)). |
| `missingSources` | Each local source reference whose file does not exist or whose fragment names no heading: `{ from, sourceIndex, uri, code?, reason }`, with `code` `SOURCE_HEADING_MISSING` for a missing heading. |
| `unreadSources` | How many source references were not read: local ones outside the grants or unreadable, and every one past the 10000 references one [stale report](sources.md#the-stale-report) reads. `limits` says which. |
| `bounds` | `linkDiagnostics` and `missingSources`, each `{ available, returned }`. |
| `limits` | What the result does not establish. |

Link diagnostics and missing sources leave the status as it is: they are what
review and the [stale report](sources.md#the-stale-report) would show once the
candidate is applied. Sources are read within the source grants and resolve
against the Atlas root, as the Atlas would cite them. When the candidate does
not validate, its links and sources are not read: both lists are empty and
`limits` says so. `linkDiagnostics` and `missingSources` hold at most 100
entries each; through MCP `diagnostics`, `changes` and `ignored` do too, with
a `bounds` entry each.

```text
atlas --root PATH validate --from .atlas-candidate
{
  "format": "atlas.validation/1",
  "status": "ready",
  …
  "linkDiagnostics": [
    { "code": "REFERENCE_MISSING", "path": "trees/product/points/offline.md", "line": …, "column": …, "message": "…" }
  ],
  "missingSources": [
    {
      "from": { "kind": "point", "id": "offline-work", "tree": "product", "path": "trees/product/points/offline.md" },
      "sourceIndex": 0,
      "uri": "sources/brief.md#offline",
      "code": "SOURCE_HEADING_MISSING",
      "reason": "…"
    }
  ],
  "unreadSources": 0,
  …
}
```

## Plans

Preparing computes a plan, `atlas.change/1`, and writes no authored file. The
CLI and the MCP server save every plan as a new draft; in the Library a plan
is a value until `saveDraft` saves it.

| Key | Value |
| --- | --- |
| `format` | `atlas.change/1` |
| `status` | `ready`; `invalid` when `validation.status` is not `ready`; `noop` when the candidate validates and nothing differs. |
| `reason` | The reason as given. |
| `baseline` | `{ identity, files }`: the identity of the Atlas the change was prepared against, and each of its captured files as `{ path, sha256 }`. |
| `changes` | Each file that differs: `{ path, before, after }`, sorted by path for a candidate. `before` is the file's text, or `null` when it did not exist or was not UTF-8; `after` is the new text, or `null` for a removal. |
| `changes[].beforeBase64` | Present when the original file was not UTF-8: its exact bytes in base64. `before` is then `null`, which does not mean the file was absent. |
| `validation` | `{ status, identity, diagnostics }`: the candidate's own validation, with `STYLE_CHANGE_ALONE` added, and the status `invalid`, when [the Style rule](#the-style-changes-alone) is broken. |
| `observedFiles` | Files on disk outside the Atlas's current scope that a changed manifest brings into it: `{ path, content, rawBase64?, sha256 }`. Apply checks that they still hold these bytes. Empty unless the manifest changes. |
| `candidate` | The complete candidate as a view, `atlas.view/1` ([Normalized view](../../spec/spec/FORMAT.md#normalized-view)). |
| `ignored` | From a candidate directory only: the sorted paths left out of the change. |

An invalid plan is saved and can be inspected; it cannot be applied. A noop
plan is saved too; applying it writes nothing.

## Drafts

A draft is a saved plan, `atlas.draft/1`, kept in
[private state](#private-state) as `drafts/<id>.json`. It keeps the baseline it
was prepared against and survives restarts.

| Key | Value |
| --- | --- |
| `format` | `atlas.draft/1` |
| `id` | Through the CLI and the MCP server, a random UUID given when the draft is first saved. The Library's `saveDraft` takes an explicit `id`, an ID of at most 100 characters, and gives a random UUID only when none is given. |
| `updatedAt` | When it was saved, as an ISO 8601 UTC time. |
| `plan` | The plan, whole ([Plans](#plans)). |
| `revision` | The SHA-256, in lowercase hexadecimal, of the draft without `revision` written as compact JSON, its keys in the order `format`, `id`, `updatedAt`, `plan`. It identifies the draft's complete saved content; the saved file itself is indented JSON. |

**Revisions.** Applying and deleting a draft need its exact revision; any other
value is `STALE_DRAFT`. A revision that is missing, or is not 64 lowercase
hexadecimal characters, is `STALE_DRAFT` in the Library. The CLI refuses it
with `CLI_INVALID_ARGUMENT` for `apply` and `drafts delete`, before the Atlas
is opened. The MCP server refuses a missing or malformed `expectedRevision`
with `INVALID_ARGUMENT` for `atlas_apply`, and a malformed one for
`atlas_drafts`, before the Atlas is opened; `atlas_drafts` with
`action: "delete"` and no `expectedRevision` is `STALE_DRAFT`.

The CLI and the MCP server never save over a draft. The Library's `saveDraft(root, { id, plan, expectedRevision })` saves over one only
at its current revision and with the same baseline (`STALE_DRAFT` otherwise),
which gives it a new revision.

**What preparing prints.** `prepare`, `init` and `move`, and the `draft` of a
stamp report, give the saved draft without file bytes:

| Key | Value |
| --- | --- |
| `format`, `id`, `revision`, `updatedAt` | As saved. |
| `plan` | `format`, `status`, `reason`, `baseline.identity`, `validation` (`status`, `identity`, at most 100 `diagnostics`), `changes` as `{ path, action, bytes }` (at most 100; `action` `write` or `remove`; `bytes` the new text's UTF-8 length, 0 for a removal), and `ignored` (at most 100) from a candidate directory. |
| `bounds` | `changes` (`available`, `returned`, `offset`, `nextOffset`), `validation` (`available`, `returned`, `offset`), and `ignored` (`available`, `returned`) from a candidate directory. |

**Listing.** `drafts` (`atlas_drafts` with `action: "list"`) gives
`atlas.drafts/1` with two lists, each sorted by file name:

| Key | Value |
| --- | --- |
| `drafts` | Each saved draft that loads: `{ id, revision, updatedAt, reason, status, baseline }`, `baseline` being the baseline identity. |
| `unreadable` | Each `.json` file in `drafts/` that does not load as a draft: `{ file, code, message }`, its file name and the code and message loading it gives, such as `INVALID_STATE` with "Saved state is malformed.", "Invalid draft.", "Saved draft integrity failed." or "The file name is not a draft identity.", `INVALID_PLAN`, `UNSAFE_PATH` or `LIMIT_EXCEEDED`. A file whose name does not end in `.json` is not listed. |

An unreadable file does not refuse the listing. A failure of the private state
as a whole (`INVALID_STATE_HOME`, `STATE_OWNER`, `UNSAFE_STATE`) does.

**Showing.** `drafts show ID` (`atlas_drafts` with `action: "load"`) gives a
summary: `format`, `id`, `revision`, `updatedAt`; `plan` with `format`,
`status`, `reason`, `baseline.identity`, a page of `validation.diagnostics`,
`candidate` as an Atlas summary (the shape `inspect` prints without a record,
[Reading](reading.md#the-summary)) and a page of `changes` as
`{ path, action, bytes }`; `bounds` (`changes`, `validation`); and `details`.
`--full` (`full: true`) gives the saved draft whole, every byte included;
`part: "details"` gives it as exact JSON text in chunks. The MCP tool wraps the
summary as `{ status, draft }`. Before it summarizes, it checks the plan's
bytes, identities and statuses against one another (`INVALID_PLAN`).

**Deleting.** `drafts delete ID --revision REVISION` (`atlas_drafts` with
`action: "delete"` and `expectedRevision`) removes the draft and gives
`{ status: "deleted", id }`.

| Refusal | Code |
| --- | --- |
| No draft has that ID | `NOT_FOUND` |
| The revision given is not the draft's | `STALE_DRAFT` |
| The saved file is malformed, or its revision no longer matches its content | `INVALID_STATE` |
| Another live process is saving, applying or deleting the same draft: "Another writer is using this draft."; the draft's lock is no longer this process's: "Draft lock changed."; or its metadata cannot be read | `LOCKED` |

## Review

`review ID` (`atlas_review`) gives `atlas.draft-review/1`: the effects of a
saved draft, recomputed from its exact bytes and read against the draft's own
baseline. A draft that creates an Atlas, or repairs one that does not
validate, is reviewed like any other. The review reads no cited source.

| Key | Value |
| --- | --- |
| `format` | `atlas.draft-review/1` |
| `status` | `ready`, or `unavailable` when the candidate does not validate or the Atlas before it cannot be read whole. |
| `draft` | `id`, `revision`, `updatedAt`, `status` (the plan's), `reason`, `baseline`, `candidate` (its identity), `stale` (`true` when the Atlas now differs from the baseline), and `diagnostics` (the first 100 of the plan's validation) when the draft is invalid. |
| `effects` | The summary, `atlas.impact-summary/1`, by default; the full review, `atlas.impact-review/1`, with `--full` (`full: true`). |
| `bounds`, `next`, `details` | With the summary only: one `{ available, returned, offset }` entry per list; the INPUT of the next page (`{ offset, limit }`) or `null`; and how to ask for the rest. |

A draft invalid only by [the Style rule](#the-style-changes-alone) has a
candidate that validates, so its review is `ready` and its `draft` carries
`STYLE_CHANGE_ALONE`. `part: "details"` gives the result with the full review
as exact JSON text in chunks; a continuation whose text changed is
`STALE_REPORT`. Through MCP, `expectedRevision` that is not the draft's is
`STALE_DRAFT`.

### The summary

`atlas.impact-summary/1` names each changed record by its ID, to be read
whole. The lists `points`, `facets`, `trees`, `checks` and `linkDiagnostics`
each hold at most `limit` entries from `offset`. The lists inside an entry
(`changes`, `above`, `aboveBefore`, `facets`, `mentionedBy`, `targets`) and
the lists in `changedManifest` are given whole. A removed record is told as it
stood before.

| Key | Value |
| --- | --- |
| `format`, `status` | `atlas.impact-summary/1`; `ready`. |
| `beforeIdentity`, `afterIdentity` | The baseline's and the candidate's identities. |
| `counts` | `points`, `facets`, `trees` and `checks`, each `{ added, changed, removed }`, and `linkDiagnostics`, a number. |
| `points` | `{ id, tree, changes, above, aboveBefore?, facets, mentionedBy }` for each changed Point. |
| `points[].changes` | [What changed in it](#what-changed-in-a-record). |
| `points[].above` | The IDs of the Points above it, the Base first; `null` for a removed Point the Atlas before did not place. |
| `points[].aboveBefore` | Present when the Points above it changed: the earlier list. |
| `points[].facets` | The Facets attached to it or targeting it, as `TREE/ID`. |
| `points[].mentionedBy` | The records whose text links to it: a Point by its ID, a Facet as `TREE/ID`. |
| `facets` | `{ id, changes, on, targets, mentionedBy }` for each changed Facet, `id` as `TREE/ID`. |
| `trees`, `checks` | `{ id, changes }` for each changed Tree and Check. |
| `changedManifest` | `null` when `atlas.json` has the same bytes; otherwise `title` and `id` (each `{ before, after }`) when they differ, `order` (`{ before, after }`, each side's whole list of Tree IDs) when the Trees both sides hold are in another order, and `added` and `removed`, lists of Tree IDs. Where the Atlas before holds no readable manifest, its title and ID are `null`. |
| `changedStyle` | Present only when `style.md` differs: `{ before, after }`, each `{ title, path }`; `before` is `null` when the earlier Style could not be read. |
| `linkDiagnostics` | The candidate's link diagnostics. |
| `limits` | What the review covers and what it leaves unknown, including, for a draft that creates an Atlas or repairs one, what the earlier files leave unknown. |

```text
atlas --root PATH review ID
{
  "format": "atlas.draft-review/1",
  …
  "effects": {
    "format": "atlas.impact-summary/1",
    …
    "points": [
      {
        "id": "offline-work",
        "tree": "product",
        "changes": ["title", "explanation"],
        "above": ["product-purpose"],
        "facets": ["product/local-evidence-limit"],
        "mentionedBy": ["delivery-promise", "product-purpose", "product/local-evidence-limit"]
      }
    ],
    …
  },
  …
}
```

When the review is `unavailable`, `effects` holds `format`, `status`,
`beforeIdentity`, `afterIdentity`, `reason`, `diagnostics` (`{ before, after }`,
each a page of that side's diagnostics, with bounds `diagnostics.before` and
`diagnostics.after`) and `limits`.

### The full review

`atlas.impact-review/1` holds the complete records and why each related
record was named.

| Key | Value |
| --- | --- |
| `format` | `atlas.impact-review/1` |
| `status`, `beforeIdentity`, `afterIdentity`, `limits` | As in the summary. |
| `changedPoints` | `{ id, before, after, changes }`, each side the complete normalized Point or `null`. |
| `changedFacets` | `{ id, before, after }`, `id` as `TREE/ID`. |
| `changedTrees`, `changedChecks` | `{ id, before, after }`. |
| `changedManifest` | As in the summary. |
| `changedStyle` | Present only when `style.md` differs: `{ before, after }`, each the Style record `{ title, body, path }` or `null`. |
| `review` | `{ before, after }`: on each side, `points`, `trees` and `facets`, each entry `{ record, reasons }`. |
| `mentions` | `{ before, after }`: for each changed Point and Facet on that side, `{ target, format, status, identity, citers, bounds, limits }`, with `format` `atlas.citers/1`, `target` `{ point }` or `{ facet, tree }`, at most 100 `citers`, and `bounds` `{ available, returned, exhaustive }` ([The reference index](sources.md#the-reference-index)). |
| `linkDiagnostics` | The candidate's link diagnostics. |

The related records follow recorded connections only, and these reasons are
every way a record is included. Each reason is an object with `kind`:

| `kind` | The record is named because it |
| --- | --- |
| `changed-point` | is a changed Point; with `changes`. |
| `authored-ancestor` | stands above `point` in its Tree. |
| `owning-tree` | is the Tree that owns `point`. |
| `changed-tree` | is a changed Tree. |
| `changed-tree-base` | is the Base of the changed Tree `tree`. |
| `changed-facet` | is a changed Facet. |
| `changed-facet-host` | is the host of the changed Facet `tree`/`facet`. |
| `changed-facet-target` | is a target of the changed Facet `tree`/`facet`. |
| `attached-review-point` | is a Facet attached to the named Point `point`. |
| `incoming-point-reference` | is a Facet that targets the named Point `point`. |
| `incoming-facet-host` | is the host of the Facet `tree`/`facet`, which targets a named Point. |

### What changed in a record

A Point's `changes` uses these words:

| Word | Meaning |
| --- | --- |
| `added` | The Point is new. |
| `removed` | The Point is gone. |
| `title` | Its title, the claim, differs. |
| `explanation` | Its body differs. |
| `sources` | Its source references differ, stamps included. |
| `uncertainty` | Its `uncertainty` differs. |
| `type` | Its Type differs. |
| `decision-status` | Its decision standing (`status`) differs. |
| `observation-date` | Its `observedAt` differs. |
| `placement` | Its file, its owning Tree or the Points above it differ. Where the Atlas before did not place it, its earlier place is not compared. |

A Point whose header differs only in key order is not changed. A reordering
among siblings alone changes no Point: it shows as the Tree's `children`.

A Facet's, a Tree's and a Check's `changes` is `added`, `removed`, or the names
of the fields of the normalized record that differ: for a Facet `on`, `via`,
`targets`, `sources`, `uncertainty`, `path`, `title`, `body`; for a Tree
`title`, `scope`, `base`, `children`, `path`; for a Check `status`, `level`,
`path`, `title`, `body`, `revision`.

## Apply

`apply ID --revision REVISION` (`atlas_apply` with `id` and `expectedRevision`)
writes a saved draft to the Atlas the caller selected. It takes no source
grant and reads no source. In order, it:

1. checks the revision and takes the draft's lock;
2. takes the writer lock, `lock.json` ([Private state](#private-state));
3. reads the Atlas, and checks, whichever draft is being applied, that every
   transaction of the Atlas has finished, each `.json` file in
   `transactions/` whose name is a transaction ID reading whole as a journal
   in phase `complete` or `rolled-back` ([Recover](#recover)), and then that
   the Atlas read whole. The Library's `applyBlocker(root)` gives this step's
   answer without applying: the refusal as
   `{ code, message, transaction? }`, or `null`;
4. checks that the Atlas's identity is the draft's baseline;
5. checks that the `observedFiles` hold their recorded bytes and that a new
   manifest declares no other files on disk;
6. checks each changed file's bytes on disk against its recorded `before`, and
   that no symbolic link lies on its path;
7. prepares the change again from those bytes and validates the whole
   candidate: an invalid one is refused, and a noop one ends here;
8. saves the journal in phase `prepared`, then checks the Atlas, the observed
   files and the changed files again;
9. sets phase `applying` and writes each file atomically (a temporary
   `.atlas-write-…` file beside it, then a rename), recording each written
   path in the journal;
10. reads the Atlas again and checks that it is the candidate, then sets phase
    `complete`, removes the draft and then the journal. When the draft cannot
    be removed, the journal stays, in phase `complete`, and so does a journal
    that cannot be removed or whose process stops before it is.

A refusal in steps 1 to 7 writes no authored file and leaves no journal. A
failure from step 8 on, saving the first journal included, and before or after
the first write, ends the apply as `interrupted`. When the journal can be
saved, it then keeps the phase `interrupted`, the paths written and the error.
When it cannot, the apply still answers `interrupted`, and leaves no journal,
or one in the last phase it could save.

| Key | Value |
| --- | --- |
| `format` | `atlas.apply/1` |
| `status` | `complete`, `noop` or `interrupted`. |
| `identity` | `complete`: the Atlas's new identity. `noop`: its unchanged identity. Absent when interrupted. |
| `transaction` | The transaction's ID; `null` for a noop. It names a journal only while one remains: an interrupted apply's, when it could be saved, or a completed apply's that was not removed. |
| `written` | Interrupted only: the paths written before it stopped, in order. |
| `error` | Interrupted only: `{ code, message }`. `code` is the failure's code, such as `STALE` when the Atlas or a changed file changed after the journal was saved, or `CONCURRENT_CHANGE` when the Atlas read back after the writes is not the candidate, and `WRITE_FAILED` when the failure has none. |
| `draft` | `removed` when the apply completed and the draft was removed; `kept` otherwise, including a completed apply whose draft could not be removed. |
| `view` | MCP only: `{ status, identity }` of the Atlas captured again after the apply. |

| Refusal | Code |
| --- | --- |
| The revision is not the draft's; in the Library, also one that is missing or malformed | `STALE_DRAFT` |
| CLI: the revision is missing or malformed, refused before the Atlas is opened | `CLI_INVALID_ARGUMENT` |
| MCP: `expectedRevision` is missing or malformed, refused before the Atlas is opened | `INVALID_ARGUMENT` |
| No draft has that ID | `NOT_FOUND` |
| Another live writer holds the writer lock, an apply, a recovery or a `candidate`: "Another Atlas writer is running."; or the draft's: "Another writer is using this draft."; or a lock's metadata cannot be read: "Lock metadata is unavailable; another writer may be acquiring or releasing it."; or a lock is no longer this apply's before it saves the journal, writes a file or removes the draft: "Writer lock changed.", "Draft lock changed." | `LOCKED` |
| A transaction of the Atlas is unfinished, in phase `prepared`, `applying`, `interrupted` or `rolling-back`, or a lock left by a stopped process names one: "Interrupted transaction ID needs recovery." | `LOCKED` |
| A journal in `transactions/` cannot be read: "Transaction journal ID cannot be read:" and the failure's message, with the failure's code: `INVALID_STATE` for one that is not JSON, `UNSAFE_PATH` for a symbolic link. A file whose name is not a transaction ID, or does not end in `.json`, is passed over. | `INVALID_STATE`, `UNSAFE_PATH`, or the failure's code |
| A journal is not whole, or not that of the transaction its file names: "Invalid transaction journal: ID." | `INVALID_STATE` |
| `transactions/` holds more than 10000 `.json` records: "Too many saved records." | `LIMIT_EXCEEDED` |
| The Atlas, an observed file or a changed file differs from what the draft recorded | `STALE` |
| The Atlas does not read whole, whichever draft is applied: "Cannot apply against an incomplete read."; or the scope a new manifest declares cannot be read completely | `INCOMPLETE` |
| The candidate is invalid; for a draft invalid only by the Style rule the message is the Style rule's | `INVALID_CANDIDATE` |
| A changed path runs through a symbolic link, or through or to something that is neither a file nor a directory | `UNSAFE_PATH` |
| A changed path names a directory, or a file over 32 MiB | `LIMIT_EXCEEDED` |
| The saved draft is malformed or fails its integrity check | `INVALID_STATE` |
| The saved plan's changes or observed files are malformed | `INVALID_PLAN` |

A draft is never rebased onto a changed Atlas. An interrupted apply keeps its
draft, which applies again once [recovery](#recover) has rolled the change
back and restored the Atlas's baseline (`baselineRestored: true`).

## Recover

Each apply that reaches step 8 and can save its journal writes one,
`atlas.transaction/1`, in `transactions/<id>.json`. A journal is kept only
while its transaction is unfinished: a completed apply removes it after its
draft, and recovery removes it once the rollback is done. A journal that is
not removed stays, in phase `complete` or `rolled-back`.

| Key | Value |
| --- | --- |
| `format` | `atlas.transaction/1` |
| `id` | The transaction ID. |
| `phase` | See below. |
| `createdAt` | When the journal was first saved, as an ISO 8601 UTC time. |
| `baseline` | The Atlas's identity before the apply. |
| `result` | The candidate's identity, which a completed apply produces. |
| `changes` | Each file change, `{ path, before, beforeBase64?, after }`, as in the plan. |
| `written` | The paths written so far, in order. |
| `error` | `{ code, message }`, once interrupted. |

| Phase | Meaning |
| --- | --- |
| `prepared` | Saved; nothing written yet. |
| `applying` | Writing; `written` says how far it got. |
| `complete` | Every file written and the result checked. Seen only in a journal the completed apply did not remove: its draft or the journal could not be removed, or its process stopped first. |
| `interrupted` | The apply failed and recorded why. A process that stopped without recording leaves `prepared` or `applying`. |
| `rolling-back` | Recovery is restoring the original bytes. |
| `rolled-back` | Recovery restored them. Seen only in a journal recovery did not then remove: the removal failed, or its process stopped first. |

A journal reads whole when it holds exactly these keys, `error` being
optional, in their shapes: `id` the transaction ID its file names, `phase` one
of these phases, `baseline` and `result` identities, each change once with a
record path, and `written` among the changes' paths. Any other is
`INVALID_STATE`, "Invalid transaction journal.".

A transaction in phase `prepared`, `applying`, `interrupted` or
`rolling-back` is unfinished, and while one is, the Atlas takes no apply of
any draft ([Apply](#apply)).

`recover` without an ID (`atlas_recover` without `id`) gives
`atlas.transactions/1` with two lists, each sorted by file name:

| Key | Value |
| --- | --- |
| `transactions` | Each journal that reads whole: `{ id, phase, createdAt, baseline, result, written, error? }`, `error` once interrupted. These are the unfinished transactions, and a finished one, `complete` or `rolled-back`, only when its journal was not removed. |
| `unreadable` | Each `.json` file in `transactions/` that does not read as a journal: `{ file, code, message }`, its file name and the code and message reading it gives, such as `INVALID_STATE` with "Saved state is malformed.", "Invalid transaction journal." or "The file name is not a transaction identity.", `UNSAFE_PATH` for a symbolic link, or `LIMIT_EXCEEDED`. A file whose name does not end in `.json` is not listed. A file whose name is not a transaction ID is listed and stops no apply ([Apply](#apply)). |

An unreadable file does not refuse the listing. A failure of the private state
as a whole (`INVALID_STATE_HOME`, `STATE_OWNER`, `UNSAFE_STATE`) does.

`recover TRANSACTION_ID` (`atlas_recover` with `id`) rolls one transaction
back. It takes the writer lock; a lock left by a process that is no longer
running is taken over when it belongs to this transaction. It checks that
every file of the transaction holds either its `before` or its `after` bytes,
and refuses before writing anything when one holds neither. It then sets phase
`rolling-back` and, last file first, restores each file that holds its
`after` bytes to its `before` bytes (removing a file that did not exist),
whoever wrote those bytes, checking each again as it goes. It sets phase
`rolled-back` and removes the journal. It writes only the transaction's own
files. A transaction whose `written` is empty is rolled back the same way: a
file of the change that holds its `after` bytes is restored, and one that
holds its `before` bytes is left. A rollback is not a completion: the draft is
kept, and applying it again needs the Atlas to be back at its baseline.

| Key | Value |
| --- | --- |
| `format` | `atlas.recovery/1` |
| `status` | `rolled-back` |
| `transaction` | The transaction ID. |
| `identity` | The Atlas's identity after the rollback. |
| `baselineRestored` | `true` when the Atlas reads back whole, not `incomplete`, at the journal's `baseline`. |
| `diagnostics` | The Atlas's diagnostics after the rollback. |
| `view` | MCP only: `{ status, identity }` of the Atlas captured again. |

A journal left in phase `rolled-back` is removed, and the result gives only
`format`, `status` and `transaction`, and `view` through MCP.

| Refusal | Code |
| --- | --- |
| No journal has that ID: there never was one, or it was removed, by a completed apply or by a rollback: "Saved state does not exist." | `NOT_FOUND` |
| The journal is in phase `complete`, left by a completed apply that did not remove it | `ALREADY_COMPLETE` |
| A file holds bytes that are neither its `before` nor its `after`, before or during the rollback | `RECOVERY_CONFLICT` |
| Another live writer holds the writer lock, an apply, a `candidate` or another recovery: "Another Atlas writer is running."; a writer that stopped during another unfinished transaction left the lock; the lock's metadata cannot be read; or the lock is no longer this recovery's before it restores a file: "Writer lock changed." | `LOCKED` |
| The journal is malformed, does not read whole, or names a path that is not a record | `INVALID_STATE` |

## The Style changes alone

A change that alters a valid `style.md` alters no other file
([Style and Checks](../../spec/SPEC.md#style-and-checks)). When the
Atlas before the change has an `atlas.json` and a `style.md` that validates as
a Style, a change to `style.md` together with any other file, a removal
included, gives a plan with status `invalid` and the diagnostic
`STYLE_CHANGE_ALONE` (path `style.md`) in `validation.diagnostics`. The
plan's `candidate` keeps its own validation, so the draft can be reviewed, and
apply refuses it with `INVALID_CANDIDATE`. `validate --from` reports the same
diagnostic.

The rule does not apply where the Atlas before has no `atlas.json` (a change
that creates an Atlas writes its manifest and its Style together), or where its
`style.md` is absent or does not validate (a change may repair the Style
together with other files). A change to `style.md` alone is always allowed.

## Create an Atlas

`init --id ID --title TITLE --style STYLE` (`atlas_init`) prepares a new
Atlas as an ordinary draft, in a root whose capture holds no `atlas.json`
([Project workflow](../../spec/spec/PROJECT.md)). Nothing is written to
the root until the draft is applied. The draft's two changes are:

- `atlas.json`: `{"format": "atlas/1.2", "id": ID, "title": TITLE, "trees": []}`,
  written with two-space indentation and a final newline;
- `style.md`: the exact text of the curated Style chosen by its ID
  (`atlas styles` lists them), or the complete custom Style given (a file path
  for the CLI, `styleContent` for MCP).

Its reason is `Initialize Atlas with its selected Style`. Its baseline is the
root's capture as found. Without `atlas.json` a reader captures only the files
under `.checks/`, so an empty root, or one whose files all lie elsewhere, has
the identity of a capture with no files,
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; a root
that holds a Check has another identity, and the Check is among the baseline's
files. Its review says there is no Atlas before it, so every record is new. A
custom Style that does not validate gives an invalid draft.

| Refusal | Code |
| --- | --- |
| The root's capture holds `atlas.json` | `ALREADY_EXISTS` |
| Neither or both of a curated Style and a custom one; an unknown curated ID; a blank custom Style | `INVALID_REQUEST` |
| A custom Style over 2 MiB | `LIMIT_EXCEEDED` |

## Refusal codes

Every code an operation on this page refuses with. An error carries `code` and
`message`, and `diagnostics` when the refusal names paths; how each adapter
returns it is in [The atlas command](cli.md) and [The MCP server](mcp.md).

| Code | Meaning |
| --- | --- |
| `ALREADY_COMPLETE` | Recovery was asked for a transaction whose journal is complete, which its apply did not remove. |
| `ALREADY_EXISTS` | `init` in a root whose capture holds `atlas.json`. |
| `CANCELLED` | MCP: the request was cancelled before it took effect. |
| `CANDIDATE_DENIED` | MCP: the candidate is not `.atlas-candidate` and lies outside every source root granted at launch. |
| `INCOMPLETE` | A read on which the operation depends was incomplete: the current Atlas, a candidate (one that changed while it was read included), the scope a new manifest declares, or, through MCP, the session's capture taken as a baseline. |
| `INVALID_ARGUMENT` | MCP: the input breaks the tool's schema or a rule of the tool. |
| `INVALID_CANDIDATE` | A candidate record is not UTF-8; the change derived from a candidate does not give the candidate's captured identity; or apply found the candidate invalid. |
| `INVALID_PLAN` | A saved plan's bytes, identities, statuses or observed files disagree with one another. |
| `INVALID_REQUEST` | A change request with unexpected or missing fields, a blank reason, more than 1000 changes, a repeated path or content that is neither text nor `null`; a change that writes what a reader would not read back, or makes a path a file and a folder at once; a candidate without `atlas.json`; an invalid Style choice for `init`; a draft or transaction ID that cannot be one. |
| `INVALID_STATE` | Saved state is malformed, is not a bounded regular file, changed while it was read, or fails its integrity check; a journal that does not read whole, or is not that of the transaction its file names; a record of the candidate folder's copy that is not one. |
| `INVALID_STATE_HOME` | `ATLAS_STATE_HOME` is empty or not absolute ([Private state](configuration.md#private-state)). |
| `INVALID_VIEW` | Library: no captured view was given, or the view belongs to another Atlas. |
| `LIMIT_EXCEEDED` | A changed file over 2 MiB (2097152 bytes), whatever prepares the change; a candidate or candidate folder deeper than 64 levels or over 40000 entries; a candidate differing in more than 1000 files; a file that apply, preparation or recovery reads from the Atlas that is over 32 MiB or not a regular file; a state file over 32 MiB; more than 10000 saved records in one state folder. |
| `LOCKED` | Another live writer, an apply, a recovery or a `candidate`, holds the writer lock, or a process holds the draft's lock; a transaction of the Atlas is unfinished and needs recovery; the lock's metadata cannot be read; or a writer's lock is no longer its own ("Writer lock changed.", "Draft lock changed."). |
| `NOT_FOUND` | No draft or journal has that ID, a journal removed by a completed apply or a rollback included; `candidate` in a root without `atlas.json`. |
| `RECOVERY_CONFLICT` | A file of the transaction holds neither its original nor its proposed bytes. |
| `STALE` | The Atlas, an observed file or a changed file is not what the draft or the request recorded; the candidate folder was copied from an Atlas other than the one there now, or no record says which; through MCP, the baseline is not the session's capture. |
| `STALE_DRAFT` | The revision is not the draft's current one, or, in the Library and `atlas_drafts` delete, is missing; or a save over a draft would change its baseline. |
| `STALE_REPORT` | A chunked continuation (`part: "details"`) whose text changed since `expectedSha256`. |
| `STATE_OWNER` | The Atlas's state folder belongs to another Atlas, lacks its `owner.json`, or holds an `owner.json` that is not JSON ([Private state](configuration.md#private-state)). |
| `UNSAFE_PATH` | A path that is not a normalized relative record path or names no authored record; a candidate that does not exist, lies where it may not lie or holds entries it may not hold; a candidate folder that is a symbolic link, is not a directory or holds a link; an Atlas root that is a symbolic link or not a directory; a write target behind a symbolic link; a journal that is a symbolic link, which stops every apply. |
| `UNSAFE_STATE` | The state home lies inside the Atlas, or a folder on the path to the state is a symbolic link or not a directory ([Private state](configuration.md#private-state)). |
| `atlas.inventory.invalid-argument` | `drafts show`: `limit` outside 1 to 100, `offset` outside 0 to 100000, or a chunk option out of range. |
| `atlas.review.invalid-argument` | `review`: `limit` outside 1 to 1000 or `offset` outside 0 to 100000. |

`STYLE_CHANGE_ALONE` is a diagnostic in a plan's validation, not a refusal.
`CONCURRENT_CHANGE` and `WRITE_FAILED` appear as the `error.code` of an
interrupted apply. The CLI's own input codes (`CLI_*`) are in
[The atlas command](cli.md).

## Private state

Drafts, recovery journals and the record of the candidate folder's copy live
outside the Atlas, in the Atlas's own folder under the state home. Where the
state home is, how a launch sets it, how the folder is bound to its Atlas and
what `state` prints are in [Private state](configuration.md#private-state).
The folder holds:

```text
<state home>/atlases/<SHA-256 of the Atlas root's real path>/
  owner.json                 {"format":"atlas.state/1","root":"<the Atlas root's real path>"}
  candidate.json             the candidate folder's copy: {"format":"atlas.candidate-copy/1","baseline":"<identity>" or null,"copy":"<ID>"}
  drafts/<id>.json           one draft, atlas.draft/1
  drafts/<id>.lock           while a process saves, applies or deletes that draft: {"pid", "token"}
  transactions/<id>.json     one apply journal, atlas.transaction/1
  lock.json                  while a process applies, recovers or writes the candidate folder: {"pid", "transaction"}
```

- The folder and `owner.json` are made the first time anything is written
  there: a draft, the record `candidate` makes, or a lock. `drafts/` and
  `transactions/` are made when first written.
- State files are written with mode `0600`; drafts, journals and
  `candidate.json` through a temporary file and a rename. Each is at most
  32 MiB, and each of `drafts/` and `transactions/` is listed up to 10000
  `.json` records; locks and temporary files beside them are not counted.
- A lock is created whole: its metadata is written to a temporary
  `.atlas-write-…` file beside it, which is then linked into place, so a
  process that stops leaves no lock or a complete one. When the folder cannot
  be synced once the lock is linked, the lock is removed again and the
  failure is refused with its own code. Such a temporary file can be left in
  the state folder or in `drafts/`; it is never listed, and no listing counts
  it.
- A lock whose process is no longer running is taken over: a draft lock
  always; the writer lock when its journal has completed, has rolled back or
  is missing, or by recovery of its own transaction. The contender claims the
  stopped holder's lock by renaming it aside to an `.atlas-write-…` name,
  which one contender alone can do, and then creates its own; a live lock
  claimed in its place is put back. A lock file that is not JSON is never
  taken over: every writer is refused `LOCKED`, "Lock metadata is
  unavailable; another writer may be acquiring or releasing it.", as it is
  for the moment a holder releases its lock.
- A writer checks that its lock is still its own before it writes, saves,
  removes or empties anything, and refuses `LOCKED` when it is not: "Writer
  lock changed." for the writer lock (`candidate`, apply, recovery), "Draft
  lock changed." for a draft's lock (saving, applying or deleting it).
- A draft lock left empty by a crash during an earlier release is not JSON,
  so it stays until it is removed by hand: the file `drafts/<id>.lock` in this
  folder. While it is there, applying or deleting that draft is refused with
  "Lock metadata is unavailable…", and the Portal still shows the draft
  "Ready to apply".
- A completed apply removes its draft, then its journal; recovery removes a
  journal once its rollback is done, and again when asked for one left
  `rolled-back`. Nothing else removes a journal: one left `complete` stays,
  and stops no apply. Deleting a draft removes it. `candidate` saves
  `candidate.json` with `baseline` `null` before it touches the folder, and
  again with the copied Atlas's identity once the copy is whole.
