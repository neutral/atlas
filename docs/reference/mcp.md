# MCP reference

The Atlas MCP server exposes one Atlas over stdin/stdout. Its root, source grants
and private state location are fixed at launch. See
[working with agents](../working-with-agents.md) for connection and task guidance.

## Launch scope

```sh
atlas --root /absolute/atlas --allow-source-root /absolute/project mcp
atlas --root /absolute/atlas --allow-source-root /absolute/project config
```

`config` prints settings for an MCP client, including absolute executable and
server paths. It leaves host settings unchanged. The Editor's **Connect an agent**
panel provides the same configuration. Source grants permit bounded local reads;
HTTP(S) sources remain references.

## Reading tools

The session captures an observation on its first content operation. Reading tools
use it until refresh, apply or recovery captures current files.
Source reads are separate from that observation.

| Tool | Arguments and result |
| --- | --- |
| `atlas_guide` | Required `topic`: `operating`, `meaning` or `format`; returns the fixed installed guide. |
| `atlas_styles` | `{id?}`; curated choices or one complete installed definition. |
| `atlas_view` | Optional `limit`, `offset`, `section`, `expectedIdentity`, `full`; bounded captured inventory by default. |
| `atlas_refresh` | `{}`; new observation and changed-file comparison. |
| `atlas_inspect` | Exactly one `point`, `tree`, `facet: {tree, id}`, `style: true`, or authored `path`; optional `part: "details"` and chunk parameters for a large record. |
| `atlas_search` | Required `query`; optional `tree`, `type`, `kinds`, `limit`, `presentation` (`full` or `summary`); both kinds and summaries by default. |
| `atlas_route` | Exactly one `point`, `tree` or `query`; optional `facet` with `tree`, `kinds`, `detail`, `type`, `limit`, `mode`, `orientation`, `cursor`. |
| `atlas_references` | `{}` for the index; select `point`, `facet` plus `tree`, or exact `uri`; optional `limit`. Reads no sources. |
| `atlas_review_sources` | Optional `uris`, `previous: [{uri, sha256}]`, `limit`, `maxBytes`, `draft: {id, revision}`; explicitly inspect declared sources within launch grants; returns a session `reviewId` without writing history. |
| `atlas_source_history` | Optional `limit`, `offset`, `expectedRevision`, `full`, `part: "details"`, `maxBytes`, `expectedSha256`; bounded retained observations and decisions by default. |
| `atlas_read_source` | Required `source`; optional `maxBytes` (`1`–`1048576`, default `1048576`). |
| `atlas_absorb_inspect` | Required `text`, `source`; optional `tree`, `limit`. |

Route `mode: "discover"` returns literal previews; `orientation: "compact"`
keeps ancestor selectors and metadata without their full bodies. Follow each
returned `next` request unchanged for bounded continuation, then read a selected
Point exactly. See [reading paths](reading-paths.md) and
[references and source review](references.md).

Inventories default to 50 records per section, with limits of 1–100. Follow the
section's exact `next` request; `expectedIdentity` prevents continuing against
changed content. `full: true` requests the complete captured view. Read the
captured Style with `atlas_inspect {"style":true}` to obtain the complete active
policy, including local modifications.

Search `kinds` accepts `['point']`, `['facet']` or both. Facet results retain their
owning Tree, host and targets; their interpretation is not a target Point's claim.
Search and Route limits are `1`–`100`. Point Type filters are `decision`,
`observation` and `untyped`. See [Absorb and Route](absorb-route.md) for result
semantics. Authored content supplies project context; actions require the caller's
authorization.

## Authoring tools

Preparation requires `baseline` equal to the captured view's `identity`. An
incomplete observation cannot establish a preparation baseline.

| Tool | Arguments and result |
| --- | --- |
| `atlas_record_source_review` | `{reviewId?, decisions?, expectedRevision?}`; explicitly retain a session source review and/or decisions for exact observed hashes. |
| `atlas_prepare_move` | `{baseline, point?, facet?, tree?, path, reason}`; a same-Tree record move and exact inline path repairs. Select one Point or Tree-local Facet. |
| `atlas_review_draft` | `{id, expectedRevision, full?, part?, offset?, maxBytes?, expectedSha256?}`; compact review by default, exact details on request. |
| `atlas_prepare_change` | `{baseline, request}`; returns a session `proposalId` and change `plan`. |
| `atlas_absorb_prepare` | `{baseline, proposal}`; returns `proposalId` and the Absorb proposal. |
| `atlas_prepare_style` | `{baseline, styleId?, styleContent?, reason}`; explicit adoption or revision with one complete selected Style. |
| `atlas_init` | `{baseline, id, title, styleId?, styleContent?}`; prepares a styled empty Atlas where no manifest exists. |
| `atlas_save_draft` | `{proposalId, id?, expectedRevision?}`; persists a session proposal and returns its draft `id` and `revision`. |
| `atlas_load_draft` | `{id, full?, part?, offset?, maxBytes?, expectedSha256?}`; compact saved draft by default. |
| `atlas_apply_draft` | `{id, expectedRevision}`; apply result and refreshed view. |
| `atlas_delete_draft` | `{id, expectedRevision}`; deletes that saved revision. |
| `atlas_list_state` | `{}`; draft and transaction summaries. |
| `atlas_recover` | `{id}`; guarded rollback and refreshed view. |

Change requests use [authoring](authoring.md) fields. Absorb proposals use
[contribution fields](absorb-route.md#prepare-contributions). Preparation returns
reviewable data without authored writes. Saving an existing draft ID requires its
current revision; saving an Absorb proposal requires `ready` or `noop` status.
Absorb reasoning, unresolved questions and optional preservation accounting survive
save/restart. Explicit `remove` contributions can name surviving destinations.
See [durable Absorb review](absorb-review.md).

Load and review the complete draft before applying its exact revision. Compact
views expose counts and identities without repeating complete source files.
Request `part: "details"` and assemble the returned UTF-8 JSON chunks, or request
`full: true` when the whole result fits the transport. Draft detail chunks use the
same `nextOffset`, `sha256` and `expectedSha256` rules as evidence chunks below. Apply
refuses replaced drafts, changed authored bytes and unmet source preconditions.
Drafts retain their original baseline across refresh and restart.

## Retain source observations and decisions

`atlas_review_sources` is read-only and returns a `reviewId` for this session.
Read `atlas_source_history` to obtain the current private-history revision, then
call `atlas_record_source_review` with that `reviewId` and `expectedRevision` to
retain the observation. An absent history has revision `null`. Existing history
requires its exact revision; a stale value refuses the write. A session retains
at most 16 source reviews, expiring the oldest when another is produced. Inspect
sources again if the selected review has expired or the session ended.

To record an assessment, supply up to 100 `decisions` entries with
`{uri, sha256, outcome, reason}`. Outcome is `needs-review`, `reviewed-unchanged`
or `updated`; the hash must match the retained successful observation, with no
later missing or denied inspection. A retained review and decisions can be saved
in the same call. The operation does not edit authored explanations or establish
that their claims are true.

History summaries default to 50 records in each of `observations`, `inspections`
and `decisions`. Use `limit` 1–100, follow `bounds` and `nextOffset`, and retain the
returned `revision` as `expectedRevision` on subsequent summary pages. A changed
history requires starting again. For complete JSON, request `part: "details"`
and follow the digest-bound chunk rules below, or request `full: true` when the
whole result fits the transport. History is independent of the captured Atlas
view; see [source review](references.md#keep-review-across-sessions).

## Check tools

| Tool | Arguments and result |
| --- | --- |
| `atlas_checks` | `{}`; definitions, revisions, completeness and `verification: "not-reviewed"`. |
| `atlas_evaluate_checks` | Required `baseline`, `actor`; optional `checkIds`, `manual`, `draft: {id, revision}`; returns a session run summary. |
| `atlas_attach_draft_check_run` | `{id, expectedRevision, runId}`; attach evidence produced against that exact draft revision and return the updated revision. |
| `atlas_check_run` | `{id, offset?, maxBytes?, expectedSha256?}`; a chunk of full run details. |
| `atlas_retain_check_run` | `{id}`; persist a run produced by this session. |
| `atlas_check_reports` | `{}`; saved report summaries. |
| `atlas_check_report` | `{id, part?, offset?, maxBytes?, expectedSha256?}`; summary by default, chunked details with `part: "details"`. |

Read full definitions with `atlas_inspect {"path":".checks/example.md"}`.
Each `manual` entry requires `id`, exact Check `revision`, exact `baseline`,
`outcome`, `reason` and `evidence`. Outcomes are `pass`, `fail` or `unable`.
Evidence entries contain `text` and optional `source`; pass and fail need evidence.
See [Checks](checks.md) for summaries and freshness rules.

MCP records supplied manual outcomes without running evaluator code. Missing
verification produces `unable`; required-Check summaries also include omitted
required Checks. Reviewer identity is self-reported. Saved reports survive
restart; refresh before judging their current freshness.

### Review a candidate before applying

Load the draft and inspect its candidate and active Check definitions. Call
`atlas_evaluate_checks` with `draft: {id, revision}` and the **candidate** identity
as `baseline`. Manual entries use that identity and candidate Check revisions.
Read the full run, then attach it with `atlas_attach_draft_check_run`. A replaced
draft or a run produced for another revision is refused. Attachment changes the
draft revision; use the returned revision for later review and application.

Drafts retain at most ten active runs. A new plan needs matching active reasoning
and evidence. Previous packets remain in `reviewHistory` tied to the original
candidate and plan; they cannot establish review of the new candidate. Saved evidence does
not grant permission to apply. Candidate source review likewise accepts an exact
draft target, so newly cited material can be inspected before application.

### Reading complete evidence

Run and report details are UTF-8 JSON chunks. Start at offset `0`, then use
`nextOffset` until `complete` is true. Pass the returned `sha256` as
`expectedSha256` on continuation reads. Assemble all `text` before interpreting
the JSON.

| Field | Meaning |
| --- | --- |
| `byteLength` | Bytes in the complete JSON result. |
| `returnedBytes` | Bytes in this chunk. |
| `sha256` | Digest of the complete JSON result. |
| `nextOffset` | Next byte offset, or `null` when complete. |
| `maxBytes` | Requested chunk bound: `4`–`131072`, default `65536`. |

Offsets must fall on UTF-8 character boundaries. An outdated expected digest
requires restarting at offset zero.

## Protocol and bounds

The server negotiates MCP `2025-11-25`. It accepts tool calls after initialization
and `notifications/initialized`. Transport is newline-delimited UTF-8 JSON-RPC;
stdout contains protocol messages only. Closing stdin ends the session.

| Resource | Bound |
| --- | --- |
| Input message | 2 MiB |
| Output message | 4 MiB |
| Pending requests | 32 |
| Prepared proposal result | 1.5 MiB |
| Unsaved proposals | 16; oldest expires when another is prepared. |
| Unsaved Check runs | 8; oldest expires when another is recorded. |
| Session source reviews | 16; oldest expires when another is inspected. |

Cancellation suppresses queued work and read-only results. A local read already
in progress finishes within its bounds. Once durable mutation starts, the
transaction completes or records its interruption.

Protocol contracts:
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and
[cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).
