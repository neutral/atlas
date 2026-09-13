# Atlas local workspace

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns local workspace configuration and in-memory observation reuse. [Reading tools](TOOLS.md) owns opened observations and public reading operations. [Processing](PROCESSING.md) and [Validation](VALIDATION.md) own Atlas interpretation and validator outcomes. A workspace retains reading work without changing authored meaning.

Atlas Library exposes the workspace through the `@neutral/atlas` npm package.
Its source workspace component is `atlas-reference-validator`. Applications
consume its public operations. Workspace reads MUST NOT execute project
commands, evaluate Checks, write files, or infer authority from Atlas content.
Authored records, workspace configuration, adopted Checks, saved drafts,
authoring recovery, and retained reports remain ordinary durable files under
their owning contracts.

## Durable configuration

`atlas.workspace.json` is the sole workspace configuration filename. It belongs directly to the explicitly selected repository root. That root is a local project directory; it need not be a Git repository. It is distinct from the selected Atlas root and the installed package location.

```json
{
  "format": 1,
  "atlasPath": "atlas",
  "configuration": {
    "specificationRevision": "0.9.0",
    "maxDocumentBytes": 1048576
  }
}
```

`format` is exactly `1`. `atlasPath` selects one contained Atlas using a normalized repository-relative path. `.` selects the repository root itself. Absolute paths, traversal segments, backslashes, and path aliases are rejected. `configuration` is optional. Its only fields are an optional nonblank `specificationRevision` string and an optional positive safe integer `maxDocumentBytes`. Their defaults follow the reading contract. Unknown fields are rejected.

An explicit API `atlasPath` overrides the file's selection. Explicit `configuration` values override the file by individual field. Unspecified fields retain their file value or default. A malformed present file MUST NOT be silently ignored. Without a configuration file, the caller supplies an explicit Atlas selection.

The workspace reads configuration without creating or rewriting it. Reading has no evaluator revision, cache location, lock timeout, or disk-storage setting. Source credentials and application secrets remain outside the selected Atlas and its explicit contextual sources. Reading neither discovers host credentials nor detects secrets in source content.

## Workspace interface

`openWorkspace({ repositoryRoot, atlasPath, configuration })` opens a local workspace. `repositoryRoot` is an explicit absolute local directory. `atlasPath` and `configuration` follow the durable configuration rules. Unknown options are rejected.

The workspace canonicalizes the repository root. The selected Atlas directory must be exact and contained without symbolic-link traversal or case or normalization mismatch. A workspace does not use a containing ancestor Atlas when the selected directory lacks its own root.

Opening and workspace methods are synchronous. Filesystem observation and validation can block the calling thread. A consumer that needs a responsive event loop runs this work in its own supported execution context.

The `info` getter returns the latest frozen metadata. Opening, `read()`, and `refresh()` load the durable configuration and replace this snapshot. Explicit options continue to override corresponding fields.

| Field | Meaning |
| --- | --- |
| `repositoryRoot` | The canonical selected project directory. |
| `atlasRoot` | The exact selected Atlas directory. |
| `atlasPath` | The effective repository-relative selection. |
| `configuration` | The effective specification revision and raw-document byte limit. |
| `configurationDigest` | SHA-256 identity of the roots, effective configuration, and configuration source digest. |
| `configurationSourceDigest` | SHA-256 of the durable configuration bytes, or `null` when absent. |

An operation captures configuration bytes before observing source and checks them again before returning. Changed or newly unreadable configuration fails with `atlas.workspace.configuration-changed`. The caller retries against a new configuration observation.

| Operation | Result |
| --- | --- |
| `read()` | Rehash examined inputs and reuse the current view when source and configuration remain exact; otherwise open a new observation. |
| `refresh()` | Open and validate a new observation even when the current view remains fresh. |
| `close()` | Release the workspace's retained view and prevent further reads or refreshes. |

`read()` and `refresh()` return an immutable `atlas.workspace-view/2` envelope:

| Field | Meaning |
| --- | --- |
| `contract` | The literal `atlas.workspace-view/2`. |
| `view` | The frozen public `atlas.read-view/2` observation. |
| `freshness` | The reading contract's freshness result for that observation. |

## Retention and freshness

Each workspace retains at most one current view. Reuse requires unchanged configuration bytes and effective values, a complete observation, and an exact current inventory and content rehash. Reuse avoids rebuilding parsed records, normalized meaning, diagnostics, and captured raw documents. It still reads source bytes to establish freshness. A modification time or file count alone MUST NOT establish reuse.

A new workspace opens and validates source independently. Closing the workspace or ending its process discards its retained observation. Separate workspaces and processes share no workspace state, database, lock, or generation history. No background process or watcher is required.

A complete invalid observation can be retained and reused. It exposes current diagnostics and captured raw documents without normalized output. A prior valid view MUST NOT conceal a newer invalid draft.

An incomplete or stale observation is returned with its actual outcome and is not retained for later reuse. An operation failure clears the workspace's retained view. The workspace MUST NOT substitute an older successful view for a new incomplete observation.

Previously returned views remain immutable and usable after refresh, configuration changes, or close. Callers that retain those views retain their memory. Closing a workspace does not invalidate caller-held observations. Search maintains its separate bounded in-memory FTS5 indexes under the [reading contract](TOOLS.md#search).

Rehashing establishes an observed freshness result, not an atomic working-tree snapshot. Concurrent source edits retain incomplete or stale outcomes under the reading contract. Reused and newly opened views preserve the same public reading semantics and deterministic ordering.

## File boundaries

Workspace operations create, delete, and modify no files. They require no cache directory or workspace-specific inventory exclusion. Ordinary traversal and exact local targets follow the reading contract. Existing files at a former cache location receive no special ownership, exclusion, cleanup, or recovery treatment. Their inclusion in an observation follows ordinary source rules.

A process restart reconstructs reading state from source. It does not restore unsaved text or historical Check results from workspace memory. [Authoring](AUTHORING.md), [evaluation](EVALUATION.md), and [Editor](EDITOR.md) retain their own explicit durable-state contracts. Workspace refresh and close MUST NOT delete or reconstruct that state.

## Errors

Malformed durable configuration uses `atlas.workspace.invalid-configuration`. Configuration that changes during an operation uses `atlas.workspace.configuration-changed`. Invalid API arguments use `atlas.tools.invalid-argument`. A read or refresh after `close()` uses `atlas.workspace.closed`. Closing again has no further effect. These errors remain distinct from validator diagnostics.

## Application project selection

The Atlas application accepts `atlas open [PROJECT]`. The current directory is
the default project. This adapter resolves a selection before opening the public
workspace; it does not change workspace interpretation or write configuration.

The adapter canonicalizes the project directory. An explicit `--atlas PATH`
overrides a valid `atlas.workspace.json` selection. A present malformed
configuration MUST fail even with an explicit override. A configured missing
collection remains an exact creation selection.

Without configuration or an explicit selection, the adapter searches descendant
directories for a regular `atlas.md`. It skips symbolic links and the processing
contract's ignored directories. Each found Atlas ends that discovery branch.
Candidates are ordered by Unicode code point path order. Discovery stops with an
explicit error after 10,000 directories or depth 64; it MUST NOT choose from a
partial inventory. `--atlas PATH` supplies a bounded exact selection instead.

One candidate opens directly. Multiple candidates require a terminal selection
or an explicit `--atlas PATH`; noninteractive invocation reports every candidate
and exits with code `2`. With no candidate, `atlas open` selects the project-relative
`atlas` directory and offers the Editor's creation preview. Opening a directory
MUST NOT create authored files. `atlas discover [PROJECT]` reports the same
selection discovery as JSON without creating application state.

`atlas init [PROJECT]` previews the complete initialization diff through public
authoring operations. `--atlas`, `--id`, and `--title` select its destination and
content. `--apply` explicitly applies the displayed proposal through ordinary
stale preflight and recovery. Initialization creates no workspace configuration.
An existing Atlas is not reinitialized. The Editor offers the same public
prepare, complete review, and explicit apply sequence in the browser.

## Installed workspace command

The Atlas application exposes `atlas workspace` with the syntax below after the
command name. `atlas-workspace` remains an alias for the same adapter.

```text
atlas-workspace <repository-root> read|refresh [options]
```

The repository root is absolute. `--atlas PATH` supplies a normalized repository-relative Atlas selection. `--specification-revision VALUE` and `--max-document-bytes N` override the corresponding configuration fields. Each option can appear once. Omitted values follow the workspace defaults and durable file.

Each invocation opens its own workspace, calls the matching method, and closes the workspace. Both commands therefore begin with a new in-memory observation. Reuse requires a consumer that keeps its workspace instance open.

Operation results are JSON on stdout. Errors are JSON on stderr with the shape `{ "error": { "code": "...", "message": "..." } }`. Expected tool errors retain their public code; unexpected failures use `atlas.tools.unexpected-error`. `--help` prints plain-text help and exits with zero.

| Exit code | Result |
| --- | --- |
| `0` | A ready view or help. |
| `1` | A complete invalid view. |
| `2` | An incomplete view, usage failure, or error. |

## Qualification boundary

Workspace qualification compares direct, reused, refreshed, and reopened observations on exact inputs. It exercises invalid drafts, external edits, additions, renames, deletions, Check and Resource changes, configuration changes, interrupted reads, and process restart. It checks source and durable-state preservation across reading operations.

Installed tests use public exports outside the source checkout. Existing fixture outcomes, normalized agreement, independent-reader agreement, and Portal publication exclusions remain required where affected.

These tests establish named mechanics on declared inputs and environments. They do not establish useful retrieval, lower authoring effort, measured performance, or successful human recovery.
