# Atlas Editor

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns the local Atlas Editor application, its service boundary, and its reading and authoring interactions. [Reading tools](TOOLS.md), [Local workspace](WORKSPACE.md), [Coordinated authoring](AUTHORING.md), [Explicit evaluation](EVALUATION.md), and [Checks](CHECKS.md) own the underlying operations. [Working with Atlas](../OPERATING.md) owns absorb decisions. The Editor MUST use public Atlas Library interfaces for Atlas meaning, source access, prepared changes, application, and Check evaluation.

Atlas Editor opens an explicitly selected local repository and Atlas. It presents full reading, navigation, source inspection, current-observation comparison, diagnostics, draft recovery, authoring, and explicit Check evaluation. The same application presents Portal as Export site. Its output remains a selected, read-only static publication. Portal selection MUST NOT restrict Editor reading or become an editing or evaluation service.

The application component belongs to `apps/editor/`. It contains a Node service,
a Node worker, and packaged HTML, CSS, and browser JavaScript. It does not require
the source checkout, a build server, Astro, or a separately installed browser
framework at runtime. Git history support remains outside this interface.
Measured responsiveness and successful human journeys require their own
observations.

## Trusted launch scope

`startEditor({ repositoryRoot, atlasPath, stateDirectory, evaluatorModule, port, exportDirectory, agentConfiguration, bindAddress, publicOrigin, previewPort, previewOrigin })` starts one local service. `repositoryRoot` is an explicit absolute directory. `atlasPath` is an exact repository-relative selection; `.` selects that directory itself. Workspace configuration retains its owning contract. `stateDirectory` is a required absolute durable directory outside the selected Atlas. It holds separate recovery, reports, and drafts subdirectories.

The host fixes the repository, Atlas, state directory, and optional evaluator module at launch. A selection resolved from durable workspace configuration stays fixed for that service instance. A later configuration edit does not retarget its drafts or recovery storage. Browser requests MUST NOT supply replacement filesystem roots, module paths, shell commands, or evaluator callbacks. A selected module is a trusted host installation that exports evaluator registrations. Authored Check text does not load modules or grant execution capability. Without a registered evaluator, an unavailable Check remains unable to verify.

The service binds to `127.0.0.1` by default. An explicit `bindAddress` can
select another IPv4 address. A nonloopback bind MUST include `publicOrigin`, an
exact HTTP or HTTPS origin without credentials, path, query, or fragment.
`publicOrigin` identifies the browser-facing origin of a host-configured port
mapping or reverse proxy. The service itself speaks HTTP. The host owns proxy
routing and TLS termination. Prefix routing and wildcard host authorization are
unsupported. Native launch requires no proxy configuration. An omitted port or port `0` requests an available ephemeral port. Startup produces a launch URL with a cryptographically random per-launch token in its fragment. The host intentionally displays that URL to the local operator. The token MUST NOT appear in a request URL, resource URL, referrer, or access log. The browser removes the launch fragment immediately and retains the token in tab-scoped session storage for reload. A restarted service has a new token.

The asynchronous launcher returns a frozen object with `origin`, `url`, `info`, and `close()`. `origin` is the exact service origin. `url` is the launch URL. `info` identifies the selected workspace. `close()` stops the service and worker; closing again has no further effect. In-memory objects do not survive service closure.

The state directory is durable application storage, not authored Atlas content or a publication output. It also stays outside repository `tmp/` and `.git/`. The selected directory and its ancestors cannot traverse symbolic links. An existing directory must be empty or carry the exact workspace ownership marker. It can retain complete source bytes in drafts and recovery records. The application does not detect secrets in those bytes. Closing the Editor releases reading observations but MUST NOT remove drafts, interrupted recovery, or retained reports. Source writes occur only through an explicit application action.

Before creating state directories or their marker, the Editor opens a complete
current workspace observation and obtains recognized local target metadata through
the public Library interface. State storage MUST NOT intersect a recognized
target, including a missing target outside the Atlas. The Editor repeats this
check before draft saves, draft discard, application, and report retention.
An incomplete or stale observation refuses state mutation. Complete invalid source
can still be repaired after this placement check. A missing Atlas has no authored
target inventory and can use the explicit initialization path. These checks detect
observed conflicts; they do not establish an atomic transaction with external writers.

Incomplete or stale source capture permits startup for existing-state inspection.
Startup MUST reject recognized target conflicts and establish the existing
directory's safe ancestry and exact repository and Atlas ownership marker before
reading stored drafts or reports. It MUST NOT create directories or a marker to
enable inspection while source prerequisites remain unavailable. Missing, unsafe,
or unowned state refuses startup. Safely readable current drafts remain available
with their original text and baseline. Source diagnostics and state mutation
restrictions remain explicit. A later complete current observation can restore
state mutation after the same placement and ownership checks.

## HTTP and worker boundary

The HTTP service serves only an explicit allowlist of packaged assets. The root pathname accepts navigation query parameters and returns the same data-free application shell for deep-link reload. Script and stylesheet asset requests require their exact paths without query parameters. The service MUST NOT expose a repository directory, generic file server, proxy, arbitrary import, or shell route. Asset requests contain no repository data.

Every request requires the exact browser-facing `Host`, including a nondefault port. It comes from `publicOrigin` when configured and from the bound loopback origin otherwise. Absolute-form request targets and alternate hosts are rejected. Forwarding headers do not redefine the service origin. Every JSON API request additionally requires the exact service `Origin` and an `X-Atlas-Token` header matching the launch token. Missing, null, and foreign origins are rejected. Token comparison MUST avoid a content-dependent comparison path. The service supplies no CORS authorization.

API requests use `POST /api/{method}` with `Content-Type: application/json`, optionally with UTF-8 charset. No `GET` request changes workspace, draft, report, or source state. Unknown routes, methods, fields, and operation variants are rejected. JSON bodies are limited to 2 MiB. The service permits at most 32 pending worker requests and 64 connections. Request and header timeouts are 15 and 10 seconds. These limits bound admission; they do not bound evaluator duration. An oversized body stops accumulation and is drained within the request timeout before the service completes its error response. A rejected request does not become a queued operation.

Successful operation responses contain `{ ok: true, result }`. Errors contain `{ ok: false, error: { code, message, details? } }` with an appropriate HTTP status. An operation's own invalid, incomplete, stale, or unable result remains distinct from failure to process the HTTP request.

The browser requests `Accept: application/x-ndjson`. After admission, this response uses HTTP 200 and newline-delimited JSON. It first reports `{ status: "queued" }`, then `{ status: "running" }` when the worker starts the operation, then one terminal success or error object in the same shape as an ordinary JSON response. Admission errors remain ordinary JSON with the appropriate HTTP status. A terminal stream error does not change the already sent HTTP status. A disconnected or incomplete stream leaves the operation outcome uncertain and MUST NOT trigger an automatic retry. While the latest foreground request remains active, its status has priority over older replies, background work, and delayed action summaries. Once it finishes, other action summaries may appear. Local receipts and buffer state retain their own outcomes.

The response headers disable caching for repository data and the application shell, disable MIME sniffing, and suppress referrers. A content security policy restricts scripts, styles, and connections to packaged same-origin assets and API requests. It forbids framing, plugins, and replacement base URLs. Markdown rendering disables embedded HTML. Source text MUST NOT trigger scripts, automatic external retrieval, or navigation with execution-capable URL schemes. External links require an explicit user action.

A Node worker owns workspace handles, read views, prepared plans, and evaluator runs. The HTTP process communicates with it through a fixed operation protocol. Effects execute in a bounded FIFO sequence. The browser receives JSON-safe descriptors and opaque ids, not Library objects or private serialized views. The service MUST NOT import Library-private files to bypass public contracts.

Workspace reuse stays in worker memory and creates no workspace cache files.
A worker separates synchronous Library processing from the HTTP event loop. It does not sandbox trusted evaluator code or restrict that code's ambient host permissions. This architecture alone does not establish latency, throughput, cancellation, or responsiveness under a particular workload. Queued, running, completed, and failed work MUST remain distinguishable in the interface. The application MUST NOT report cancellation as a rollback of a started file application.

## Application operations

The following method names form the service operation surface. Request validation supplies the exact accepted fields. Repository paths and ids retain the Library's exact-selection rules.

| Method | Purpose and boundary |
| --- | --- |
| `export-options` | List exact publication profiles, default site title, and the host-fixed export destination. |
| `export-prepare` | Compile one selected profile and retain its exact content-selection preview without creating output. |
| `export-apply` | Export the retained selection to the host-fixed absent destination after current-source checks. |
| `export-preview` | Start a static reader for a completed export using host-selected preview networking. |
| `agent-config` | Return host-generated MCP configuration for this fixed project and Atlas without editing agent-host settings. |
| `state` | Open or read the selected workspace and return its observation id, navigation, validation, freshness, and state storage restrictions. |
| `read` | Read a selected Atlas, Map, Area, Point, Resource, raw document, source, or Check through public reading operations. |
| `find` | Search one retained observation through public FTS5 ranked or explicit-expression mode, result types, limit, and cursor. Return exact matching record locations and excerpts. |
| `freshness` | Observe whether retained input remains current without replacing that observation. |
| `refresh` | Open a new current observation and retain the prior observation while it remains available. |
| `compare` | Compare two retained observations through the public comparison operation. |
| `prepare` | Prepare explicit operations against the selected base observation and retain the complete plan. |
| `apply` | Apply a retained plan id with an explicit supported mode and fixed recovery storage. |
| `checks` | Discover readable local Checks, applicability uncertainty, and evaluator availability for a selected observation. |
| `evaluate` | Explicitly evaluate selected Checks against a retained observation or prepared plan. |
| `retain` | Retain a completed run in the host-fixed reports directory. |
| `report-list` | Read retained report metadata from the host-fixed reports directory. |
| `report-read` | Reinspect a retained report selected by its server-issued report id. |
| `draft-list` | Read available durable draft metadata for this selected workspace. |
| `draft-save` | Replace the current recovery content tied to its buffer, path, and base observation. |
| `draft-discard` | Remove the selected current draft after an exact revision check. |

The service owns opaque observation, plan, run, and buffer ids. It retains at most eight reading observations, 16 prepared plans, and 32 evaluation runs in worker memory. A browser cannot submit a replacement plan for application. Prepare exposes the complete proposed file changes, untruncated diff, validation, applicable Checks, identity decisions, and gaps. Apply uses the retained plan and its original baseline. Report retention chooses a server-owned destination; the browser cannot provide an output path.

An observation id identifies an immutable reading observation, not the current working tree. A new state or refresh result does not rewrite an older view. Missing or expired ids return an explicit unavailable result. The interface MUST NOT substitute another observation or apply another plan under an expired id.

Launch information and state results include `stateStorage` with `writable` and
`diagnostics`. These fields describe observed source prerequisites for state
mutation. Every mutation repeats the source and storage checks. A readable saved
draft does not establish that current source capture is complete or that its
baseline remains current.

Comparison covers retained current observations. Their captured identity and timestamps remain visible. It does not imply a Git commit, complete repository history, or a durable audit trail. Git adapters and history beyond retained observations remain separate work.

## Export site and agent connection

The product launcher supplies an absolute `exportDirectory` outside the Atlas,
recognized local source targets, durable state, and installation. Launch MUST
reject output and state intersections before creating state, including overlaps
through existing ancestor aliases. The browser MUST NOT replace
this destination or provide Resource roots. The Editor grants contextual source
reads within its host-selected repository. These grants MUST NOT broaden the
selected publication profile. The site title defaults to the Atlas title. Legal
footer text has no inferred default.

Export preparation returns the exact profile selection, routes, Resource
availability, excluded Check routes, destination, and content generation. It
retains at most eight in-memory export previews. Export application MUST refuse
an existing destination, changed Atlas observation, or changed selected Resource
content. Failed generation retains explicit incomplete output; retry requires
inspection and a new destination. Disposable compilation files remain outside the
installation and authored content. Export neither applies Editor drafts nor
deploys the generated site.

An Atlas without publication profiles offers a starter profile through the
ordinary authoring flow. The starter explicitly lists current Atlas, Map, and
Point records. Resources and Checks remain unselected. Its complete Markdown and
selection remain editable. Preparation, complete diff review, and explicit
validated application precede use of the new profile.

A static preview serves only completed generated output. It defaults to loopback
and an ephemeral port. Host-selected `previewPort` and `previewOrigin` configure
a separate container-facing preview. A nonloopback preview requires an exact
public origin. It does not share the Editor's authenticated service routes.
Closing the Editor stops its preview services. Source edits require a new export;
static previews do not imply live updates.

`agentConfiguration` contains host-generated MCP stdio configuration. The Editor
shows the fixed project and Atlas scope and offers a copy action. The browser
MUST NOT substitute roots, executable paths, arguments, or evaluator modules.
The configuration MUST preserve stdout for protocol traffic and the agent
adapter's capability boundaries. Display and copy MUST NOT edit real agent-host
settings. Agent and Editor durable state use separate ownership locations.

## Reading and navigation

The reader displays Atlas content, authored Map questions, Areas, Point anchors and contexts, relations, registered Resources and their exact uses, adopted Checks, and diagnostics. It preserves exact record provenance and source paths. The interface MUST NOT infer an anchor from a context record or merge Points by similar wording.

Search uses the public Library result ordering and continuation cursors. It preserves the distinction between registered Resource metadata, raw documents, and separately accessed source bytes. The host-selected repository root authorizes contextual local source reads outside the Atlas but inside that repository. Browser requests cannot extend this root. Source access retains the Library's containment, selector, byte-limit, and no-default-network rules. Source responses are limited to 1 MiB. A partial byte result is identified as truncated and MUST NOT become a complete editable document by implication.

Rendered relative links require a captured Atlas owner path. A separately read repository source outside that captured scope retains its citation, but its relative links are unavailable. The reader discloses this limit instead of resolving them against an unrelated Atlas record.

Complete invalid observations expose diagnostics and captured raw documents without fabricating normalized records. Incomplete observations expose their limitation. Syntactic validity, source freshness, Check outcomes, and verification coverage remain separate visible states.

Search uses the Library's ranked ordinary-text mode by default. Explicit FTS mode uses the same retained observation and grammar defined by the [reading contract](TOOLS.md#search). Candidate display preserves matching record paths, Map context, excerpts, and continuation. Search does not fetch Resource bodies or establish complete answers. Atlas Portal's static browser search retains its separate selected index and runtime.

Navigation uses browser history. An explicit destination change creates a history entry; query updates can replace the current entry. Back and forward restore the selected destination and available scroll and focus state. An external refresh preserves the selected destination when possible. A disappeared record becomes an explicit unavailable destination with its existing draft retained.

## Drafts, preparation, and application

Editing begins from an exact source path and complete accessible bytes. A buffer retains its repository, Atlas, path, base digest, and text. The interface shows whether text is unsaved in memory, stored as a draft, prepared, applied, stale, or partially applied. A stored draft is not an authored file save.

Draft storage retains one current record per opaque buffer id. Draft text is
limited to 1 MiB; storage permits at most 1,000 current entries. A first
`draft-save` without `draftId` creates the id. A supplied id MUST already exist.
Each record identifies its kind, exact source path, original base observation,
sequence, save time, and complete text. Updates preserve kind, path, and baseline.
Updates and discard require the exact expected revision digest. A competing
change MUST NOT be silently overwritten or recreated after discard.

The current storage contract is `atlas.editor-draft/2`. Each record uses its exact
`{draftId}.json` filename and complete declared shape. Unsupported contracts,
missing fields, unknown fields, invalid values, and unreadable entries remain
explicit storage issues. The Editor MUST NOT supply old-shape defaults, convert
unsupported records, or rewrite them automatically. Their original files remain
available for direct inspection.

Saves use an exclusive storage lock, a flushed temporary record, and atomic
replacement of the current file. A successful save MUST flush the containing
directory and confirm the stored bytes before acknowledgement. Temporary content
and the lock are removed after a completed operation. A storage or cleanup failure
MUST NOT be acknowledged as a saved draft. The changed file may already exist;
inspection resolves that uncertain outcome. A process interruption can leave one
pending record and a lock. Current records remain readable across reload and
restart. Further mutation requires the operator to stop every Editor using this
state, inspect the lock and any pending content, preserve unfinished work, and
remove only the inspected lock. No age or process-id guess clears it automatically.

Discard removes the selected current file and flushes its directory. It MUST NOT
retain a tombstone or prior draft text. Other drafts and authored source files
remain unchanged. Filesystem deletion does not claim secure media erasure. Draft
recovery does not require the old launch port or token.

A document draft contains complete edited source text. A contribution draft contains the unfinished form and its selected operation kind. The form writes titles, summaries, questions, and explanations into Markdown bodies. JSON retains declared identity, state, labels, targets, and policy selectors. Its storage path is a buffer label, not an authored destination. A contribution started before Atlas initialization has a null baseline. The interface restores the form without treating its stored JSON as an Atlas record or resetting its baseline. Both draft kinds use the same explicit storage acknowledgement and recovery boundary.

Refresh, navigation, and background results MUST NOT replace edited text or silently reset its base digest. A stale baseline exposes the current source and proposed text for an explicit new preparation. The application does not merge or rebase edits by inference. A discard action targets the selected draft and requires an explicit user action.

The authoring flow is edit, prepare, inspect, and apply. Preparation displays changed files, complete differences, validation, affected Point identity and provenance, applicable Checks, and unavailable verification. The user explicitly selects application after this result is available. A structurally valid plan does not imply Check compliance.

Validated application and raw draft repair remain distinct modes under the authoring contract. Invalid repair requires explicit draft mode. An applied result is acknowledged only after the Library reports it. A stale result preserves edited text. A partial result exposes written and pending paths, conflicts, and the durable recovery location. Confirmed successful application removes its recovery storage under the authoring contract. A cleanup failure remains visible with the retained location and does not hide a successful source write. Interrupted or uncertain application MUST NOT be presented as success or retried as a different plan automatically.

## Check evaluation and retained evidence

Check evaluation is an explicit action. Opening, finding, navigating, preparing, saving a draft, or reading a source MUST NOT execute an evaluator. The interface shows adopted Check status, level, applicability, evaluator availability, actual result, evidence, and limitations. Active applicable required Checks establish compliance only when their required verification actually passes.

Invalid and incomplete observations retain readable local policy through shared
Check discovery. The interface MUST distinguish discovery completeness from
observation status and display unknown registration fields, unresolved
applicability with its reasons, discovery diagnostics, and unresolved requested
ids. It links readable definitions to their captured documents. An unavailable
subject list MUST NOT appear as no applicable Checks. Recovered policy does not
enable evaluation of an invalid or incomplete observation.

A run identifies its source observation or prepared plan, actor, Check revisions, selected scope, coverage, and freshness. Partial selection MUST NOT imply whole-Atlas compliance. Failed, advisory, and unable outcomes remain visible. No registered evaluator means unavailable verification rather than an automatic pass.

Report retention is a separate explicit effect. A retained report preserves the run's provenance and evidence in durable state storage. A report based on an earlier observation does not become current when refreshed source changes. The interface links the retained location and discloses retention failure.

## Keyboard, focus, and qualification

The interface uses labelled controls, navigation and main landmarks, a skip link, visible focus, and announced operation status. Native text editing preserves expected selection and undo behavior. Keyboard shortcuts do not intercept text entry. Dialogs restore focus to their visible trigger. Background refresh preserves active editing focus. An explicit route change provides a useful reading focus target. Motion respects the platform's reduced-motion preference.

Mechanical qualification covers exact request authentication, hostile origin and Host rejection, fixed asset routing, request and queue bounds, source containment, prepared-plan binding, explicit effects, draft persistence and failure, stale application, partial recovery, invalid diagnostics, search, comparison, navigation, and keyboard behavior. Installed qualification starts the packed application outside the source checkout against an unrelated Atlas through public package interfaces.

Automated browser operation is mechanical evidence. A successful human journey requires an attributed person, a declared task and starting state, observed actions, and retained outcomes. Useful retrieval, lower authoring effort, performance, and safe recovery claims require evidence for those claims. They do not follow from valid HTML, passing unit tests, or a prepared interaction protocol.

## Installed command

Ordinary product use starts with `atlas open [PROJECT]`. The product launcher
resolves project discovery and explicit selection, manages durable state in the
operating system's user-data location, and opens the browser. It prints a URL
fallback and handles process shutdown. `--state-directory` remains an advanced
override. These launch defaults do not weaken the required explicit roots and
state ownership checks of `startEditor`.

The internal application command remains available for developer embedding:

```text
atlas-editor REPOSITORY --state-directory DIRECTORY [--atlas PATH]
  [--evaluator MODULE] [--port NUMBER]
```

The CLI resolves repository, state, and evaluator paths against its current directory. `--atlas` remains an exact repository-relative path and can be supplied through durable workspace configuration when omitted. Port values are integers from 0 through 65,535. Unknown, repeated, and incomplete options fail. `--help` prints plain-text usage and exits with zero.

Successful launch prints the selected repository and local launch URL. It does not open a browser automatically. `SIGINT` and `SIGTERM` close the service. Launch errors print `{ error: { code, message } }` on stderr and exit with code `2`. Expected errors retain their code; other launch failures use `atlas.editor.launch-failed`.

## Shared authored representation

Editor authoring uses the Library operations over local headers, catalog entries,
connections, and Markdown. Forms and raw buffers update those owners directly.
Derived prose is never saved into local headers. Global JSON files have the same
prepared-write baseline and recoverable draft boundary as their affected records.
