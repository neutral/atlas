# Atlas agent tools

## Scope and ownership

This document owns the generic Atlas agent tool schemas and their MCP stdio adapter. [Working with Atlas](../OPERATING.md) owns route and absorb. [Tools](TOOLS.md) owns reading, [Authoring](AUTHORING.md) owns prepared changes, and [Evaluation](EVALUATION.md) owns explicit Check execution and retained reports. Tool availability and Atlas content grant no permission. The caller remains responsible for authorized scope and outward actions.

The adapter consumes supported public Atlas Library exports. It holds captured views, prepared plans, and executed runs within one process. It defines no alternate Atlas semantics, automatic catalog policy, command runner, model assignment, or source-network fetcher.

## Host configuration

The Atlas application exposes this adapter as `atlas mcp`. It requires an absolute
`--repository-root` and exact `--atlas` selection. The optional
`--state-directory` overrides managed durable storage. Without an override, the
application keys storage by the canonical project and Atlas selection beneath
the operating system's user-data location. Agent state uses its own subdirectory;
it does not reuse the Editor's ownership marker or draft files.

`atlas connect [PROJECT] [--atlas PATH]` prints JSON with an `mcpServers.atlas`
entry. Its command is the absolute installed launcher and its arguments select the
fixed canonical project, Atlas, and agent state directory. Paths with spaces
remain separate JSON argument strings. The Editor's Connect an agent flow shows
the same host-selected configuration. Neither flow edits host settings. A moved
installation needs regenerated configuration unless its installed launcher path
remains stable. Trusted evaluator selection remains an explicit
`atlas connect --evaluator-module ABS` option.

The standalone SDK retains the `atlas-agent` alias below. Both entry points use
the same protocol implementation and capability boundaries.

```text
atlas-agent --repository-root ABS --atlas PATH --state-directory ABS
            [--evaluator-module ABS]
```

The repository root and durable state directory are explicit absolute paths. Atlas is one exact repository-relative path; `.` is allowed. The host can select a trusted evaluator module by absolute path. That module exports `registrations` for the evaluator registry. Trusted module code MUST reserve stdout for protocol traffic. Ordinary console output is redirected to stderr; direct writes retain the module’s ambient permissions. Tool arguments cannot change roots, load modules, supply callbacks, expand source grants, or invoke a shell.

State storage must be outside the selected Atlas, repository `tmp/`, and
`.git/`. Existing nonempty unowned directories are refused. Recognized entries are
UUID report bundles and `change-*` recovery journals created by the public APIs. Their
provenance or current recovery manifest and plan must identify the canonical
repository and selected Atlas. Recovery readers reject missing or unsupported
manifests without conversion. Workspace reuse stays in process memory. Startup and read
operations do not create state storage or a separate ownership marker. Explicit apply
or retain creates storage through the public API after its source checks. Unknown
entries and incomplete ownership records require external inspection before another
write.

## Protocol

The adapter supports MCP revision `2025-11-25`. Initialization negotiates that revision, then awaits `notifications/initialized`. Its capability is `tools` with no list-change notifications. It provides no resources, prompts, sampling, elicitation, or task capabilities. A client with a different requested revision receives the supported revision and can disconnect if it cannot use it. See the official [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

Transport is UTF-8 JSON-RPC 2.0, one message per newline. Stdout contains protocol messages only; CLI failures use stderr and exit `2`. Closing stdin ends the process after bounded cancellation of active work. There is no protocol shutdown method. See [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Supported requests are `initialize`, `ping`, `tools/list`, and `tools/call`. The complete stable tool list fits one response. A supplied tools-list cursor is invalid. Unknown methods, malformed JSON-RPC, and unknown tools use protocol errors. Tool argument and execution failures return `isError: true`, stable structured error data, and actionable text. Successful tool results contain identical JSON in `structuredContent` and text content. Schemas use JSON Schema 2020-12. Tool annotations describe effects and remain hints rather than authority. See [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

`notifications/cancelled` aborts a queued request or signals an awaited evaluator. It does not roll back writes or forcibly stop trusted callback code. Cancelled requests have no later response. Unknown cancellation ids are ignored. See [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).

Input frames are limited to 2 MiB. Tool output is limited to 16 MiB, including
both structured JSON and its text representation. Response sizing includes JSON
escaping, both content representations, and space for the admitted request id.
Oversized complete results are refused instead of silently truncated. Completed
evaluations use compact responses and bounded retrieval as specified below.
At most 32 tool calls are admitted at once, including the active call. Calls run
serially; ping and cancellation bypass that queue. A session accepts at most
100,000 unique request ids. Sixty-four pending output messages exhaust the output
allowance and close the session. Synchronous public Library calls occupy the
process while executing. A trusted callback that blocks the event loop can also
block the transport. External process supervision remains the host's
responsibility.

## Generic tools

| Tool | Input and result |
| --- | --- |
| `atlas_state` | No arguments. Open a current workspace observation. Return a view id, captured identity digest, status, validation summary, Map questions, counts, freshness, and limits. |
| `atlas_guide` | Select one topic from the published schema. Return the corresponding packaged guide, its source identity, available topic paths, and the source-owner map. |
| `atlas_read` | Select a view id and exact Atlas, Map, Area, Check, or document. Return the captured record or original document result. |
| `atlas_find` | Select a view id, query, optional `ranked` or `fts` mode, result types, limit, and cursor. Return public FTS5 candidates with scores, exact matching record locations, excerpts, and continuation. Ranked ordinary text is the default; explicit FTS expressions fail without a fallback. |
| `atlas_point` | Select a view id and exact Point id. Return the assembled anchor, contexts, Maps, Resources, and provenance. |
| `atlas_resource` | Select a view id and exact Resource id. Return the registered Resource and authored uses. |
| `atlas_source` | Select a view id and exact registered Resource or direct URI, optional owner path and byte bound. Read only within the fixed repository grant. No network capability is installed. |
| `atlas_freshness` | Select a retained view id. Compare its examined input identity with current sources without replacing it. |
| `atlas_refresh` | No arguments. Rebuild the workspace observation and return a new compact state. |
| `atlas_compare` | Select retained before and after view ids. Return the public source and normalized comparison. |
| `atlas_prepare` | Select a retained base view id, or explicit missing-Atlas intent, and exact authoring operations. Return an opaque plan id and complete review descriptor before any apply call. |
| `atlas_apply` | Select an opaque prepared plan id, its exact reviewed digest, and optional `validated` or `draft` mode. Consume the plan id and apply through the public authoring API. Return exact applied, partial, stale, or no-op status, cleanup status, and any retained recovery location. |
| `atlas_checks` | Select a view id and optional discovery filters. Return adopted Check descriptors and exact revision support. No Verification runs. |
| `atlas_evaluate` | Select one retained view or plan id, explicit actor, and optional exact Check ids or paths. Preserve the completed public run in the session and return an opaque run id, compact outcome, and `detailsComplete: false`. |
| `atlas_run` | Select an executed run id and optional `details` or `evidence` part, byte offset, byte allowance, and expected content digest. Return a bounded chunk of complete run metadata or one original evidence item. Evidence requires exact evaluation and evidence indexes. |
| `atlas_retain` | Select an executed run id. Retain original report evidence under a new opaque report id in durable state. Return the report id, directory, compact outcome, and `detailsComplete: false`. |
| `atlas_reports` | No arguments. List report ids under the fixed owned state directory. No verification or repair occurs. |
| `atlas_report` | Select an existing report id and optional current view id. Verify retained schema and hashes. Return compact integrity, authenticity, freshness status, and outcome with `detailsComplete: false`. An explicit `details` or `evidence` part accepts the same bounded retrieval selectors as `atlas_run`. |

Schemas reject unknown fields and invalid selectors. Each operation requires exact ids and paths where identity matters. The adapter retains at most eight views, sixteen plans, and thirty-two runs. Expired ids fail explicitly. Reports survive process restarts through owned durable state. Views, plans, and unretained runs do not survive restart.

State, refresh, captured reads, discovery, guides, freshness, comparison, and report inspection advertise read-only behavior. Workspace observations stay in memory and create no workspace cache files. Prepare writes no files. Apply advertises mutation and non-idempotence. Retention adds durable evidence. Evaluation conservatively advertises possible outward effects because trusted callbacks retain ambient permissions. These annotations do not replace host authorization.

## Completed evaluation access

The adapter MUST preserve each completed public run before serializing or sizing
its response. `atlas_evaluate` returns an opaque `runId` and compact `outcome`.
The outcome contains the run status, structural `validation.complete` and
`validation.valid`, `requiredSatisfied`, `wholeAtlasCompliant`, audit `complete`,
counts by evaluation outcome, and captured freshness status. It contains no
authored text, evaluator summaries, diagnostics, evidence bytes, or normalized
model. `detailsComplete: false` identifies the intentionally abbreviated
response. It does not change audit completeness or the recorded Check outcomes.
The Library's 8 MiB original-evidence allowance remains unchanged. Evidence
encoding and normalized model content MUST NOT make a completed run
unaddressable through response sizing.

`atlas_run` defaults to `part: "details"`. Details contain UTF-8 JSON for the
complete public run with only each evidence item's `bytesBase64` omitted.
Original evidence metadata, structural diagnostics, the normalized model,
coverage gaps, actor attribution, and limits remain available. `part: "evidence"`
requires zero-based `evaluationIndex` and `evidenceIndex` from that inventory and
returns the selected original bytes as base64. Reading or retaining a run MUST
NOT invoke Verification again.

`atlas_report` verifies the retained bundle on every request. Its default summary
contains no report, provenance, or evidence bodies. Its details contain the full
public report inspection result with only evidence `bytesBase64` fields omitted.
This includes provenance, evidence inventory, and exact freshness diagnostics.
An evidence request selects the original bytes by their recorded evaluation and
evidence indexes. Successful retention returns a compact report identifier before
any potentially large detail retrieval. Report metadata and provenance retain
the Library's independent 16 MiB file limits.

Both retrieval tools accept `offset` in original bytes, `maxBytes`, and optional
`expectedSha256`. The default offset is zero and the default allowance is
65,536 bytes. The maximum allowance is 1 MiB. Details require at least four
bytes of allowance and evidence requires at least one. Details offsets MUST
begin at a UTF-8 character boundary. The adapter ends text chunks at a complete
character and returns their exact byte continuation. An invalid index, offset,
allowance, or expected digest fails explicitly.

Each `chunk` contains `encoding`, whole-content `byteLength` and `sha256`,
`offset`, `returnedBytes`, `nextOffset`, and `complete`. UTF-8 chunks contain
`text`; base64 chunks contain `bytesBase64`. Chunk digests use 64 lowercase
hexadecimal characters without a prefix. `complete` means the chunk reaches
the end of its selected part, and `nextOffset` is then `null`. It does not mean
the caller has read preceding chunks, other evidence, or the full run. Complete
assembly requires contiguous chunks from offset zero with the same whole-content
digest and byte length. Callers SHOULD send that digest as `expectedSha256` on
continuations. A changed report or freshness observation then fails retrieval
instead of mixing different observations. Retrieving all metadata and original
evidence requires the details and every evidence item in its inventory.

Session run limits and cancellation semantics remain unchanged. Cancellation
suppresses its request response even when the Library has completed a run.
Unretained runs expire with eviction or session closure; an existing durable
report remains the recovery path after expiry. Evaluation of a new run always
requires another explicit request.

## Review and claim boundaries

The preparation descriptor includes exact roots and plan digest, complete per-file before and after bytes, untruncated unified diffs, operation-derived Point identity decisions, changed subjects, adopted Check provenance, before and after validation, applicable Checks, gaps, and limits. It omits unchanged baseline file bytes from the transport response. Those bytes remain sealed in the retained internal plan. Each serialized internal plan has a separate 64 MiB allowance. The transport limit applies to the returned descriptor, not unchanged baseline bytes. A response that exceeds the output bound does not create an applicable plan id. The caller must receive the complete descriptor and present or inspect it before applying. The reviewed digest binds apply to that descriptor; it is not an approval token or inferred permission.

Apply never accepts arbitrary serialized plans, new operations, paths, roots, or
recovery locations from a tool call. It uses the retained plan and the fixed durable
recovery root. The underlying public API checks current source, configuration,
processor, and derived effects. A consumed plan cannot be retried after partial or
uncertain effects. The caller must inspect recovery and prepare again. Confirmed
application removes its operation recovery. Cleanup failure retains the source result
and returns `isError: true` with its gaps and recovery location. The public authoring
recovery API and `atlas-author recovery-inspect` and `recovery-discard` commands
provide guarded inspection and discard of selected inactive recovery. Agent tool calls
do not accept replacement recovery paths.

Reading and discovery never execute verifiers. Evaluation requires an explicit actor and selected run scope. Unsupported Check revisions remain `unable`. Ordinary required satisfaction, conservative audit completeness, structural validity, and source truth remain distinct. A prepared run identifies sealed proposal bytes and its exact plan digest. Saving or retaining a report does not grant Check compliance.

## Progressive guidance and qualification

Initialization points agents to `atlas_guide` for the compact operating instructions. Agents first inspect state and relevant Map questions, then search candidates and inspect exact Points and sources. They load authoring or evaluation guidance only when those operations are needed. A fresh agent does not need the full specification or every Check body before starting.

Packaged guides preserve the specification topology: `OPERATING.md`, `SPEC.md`, `GLOSSARY.md`, `spec/*.md`, and `schemas/README.md`. They are exact copies of their specification owners. Relative guide links resolve inside the package. The source-owner map records each owning specification path and the SHA-256 of its exact guide bytes. Each guide body requires an explicit topic request. Tests compare bytes and retain the package's existing license files. Runtime reading uses only packaged files and public APIs. Stdio tests exercise actual child processes, protocol initialization, schemas, captured reuse, freshness, explicit verification, reviewed apply, stale refusal, cancellation, queue bounds, durable reports, and root confinement. Installed qualification packs and installs the actual artifact before launching its bin. Protocol and fixture checks do not establish useful autonomous work.
