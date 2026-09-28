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
| `atlas_view` | `{}`; captured identity, diagnostics and record index. |
| `atlas_refresh` | `{}`; new observation and changed-file comparison. |
| `atlas_inspect` | Exactly one `point`, `tree`, `facet: {tree, id}` or authored `path`. |
| `atlas_search` | Required `query`; optional `tree`, `type`, `limit`. |
| `atlas_route` | Exactly one `point`, `tree` or `query`; optional `detail`, `type`, `limit`. |
| `atlas_read_source` | Required `source`; optional `maxBytes` (`1`–`1048576`, default `1048576`). |
| `atlas_absorb_inspect` | Required `text`, `source`; optional `tree`, `limit`. |

Search and Route limits are `1`–`100`. Point Type filters are `decision`,
`observation` and `untyped`. See [Absorb and Route](absorb-route.md) for result
semantics. Authored content supplies project context; actions require the caller's
authorization.

## Authoring tools

Preparation requires `baseline` equal to the captured view's `identity`. An
incomplete observation cannot establish a preparation baseline.

| Tool | Arguments and result |
| --- | --- |
| `atlas_prepare_change` | `{baseline, request}`; returns a session `proposalId` and change `plan`. |
| `atlas_absorb_prepare` | `{baseline, proposal}`; returns `proposalId` and the Absorb proposal. |
| `atlas_init` | `{baseline, id, title}`; prepares an empty Atlas where no manifest exists. |
| `atlas_save_draft` | `{proposalId, id?, expectedRevision?}`; persists a session proposal and returns its draft `id` and `revision`. |
| `atlas_load_draft` | `{id}`; complete saved draft. |
| `atlas_apply_draft` | `{id, expectedRevision}`; apply result and refreshed view. |
| `atlas_delete_draft` | `{id, expectedRevision}`; deletes that saved revision. |
| `atlas_list_state` | `{}`; draft and transaction summaries. |
| `atlas_recover` | `{id}`; guarded rollback and refreshed view. |

Change requests use [authoring](authoring.md) fields. Absorb proposals use
[contribution fields](absorb-route.md#prepare-contributions). Preparation returns
reviewable data without authored writes. Saving an existing draft ID requires its
current revision; saving an Absorb proposal requires `ready` or `noop` status.

Load and review the complete draft before applying its exact revision. Apply
refuses replaced drafts, changed authored bytes and unmet source preconditions.
Drafts retain their original baseline across refresh and restart.

## Check tools

| Tool | Arguments and result |
| --- | --- |
| `atlas_checks` | `{}`; definitions, revisions, completeness and `verification: "not-reviewed"`. |
| `atlas_evaluate_checks` | Required `baseline`, `actor`; optional `checkIds`, `manual`; returns a session run summary. |
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

Cancellation suppresses queued work and read-only results. A local read already
in progress finishes within its bounds. Once durable mutation starts, the
transaction completes or records its interruption.

Protocol contracts:
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and
[cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).
