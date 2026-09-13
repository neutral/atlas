# Atlas reading tools

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns the public reusable reading interface. [Processing](PROCESSING.md) owns discovery, parsing, resolution, and normalized meaning. [Validation](VALIDATION.md) owns validator profiles and diagnostics. [Conformance](CONFORMANCE.md) owns consumer preservation. [Publication](PUBLICATION.md) owns exact publication selection. [Local workspace](WORKSPACE.md) owns durable configuration and in-memory observation reuse.

[Coordinated authoring](AUTHORING.md) owns preparation and application against identified source. [Explicit evaluation](EVALUATION.md) owns adopted Check discovery, registered Verification, and retained evidence. Reading alone performs neither effect.

The `atlas.read-view/2` contract supplies one observed Atlas through Atlas
Library. The source is a checked working tree or a sealed caller-supplied file
map. Atlas Tools and Atlas Portal consume the same public interpretation. The
source workspace component is `atlas-reference-validator`; the npm package
`@neutral/atlas` exposes its public interfaces.

This reading interface performs no authoring or Check evaluation. Opening or querying a view MUST NOT execute project commands or infer permissions from Atlas content. The workspace retains observations through a separate public interface. [Atlas Editor](EDITOR.md) and [agent tools](AGENT-TOOLS.md) consume public operations under separate application contracts. File watching remains outside this interface.

## Opened observations

`openAtlas(path, options)` discovers the nearest containing Atlas and performs resolved validation once for that observation. A reusable view serves subsequent queries from its captured result. It does not revalidate the complete Atlas for every exact Point inspection.

Opening and captured-view operations are synchronous. `readSource` returns a promise. `path` is a nonempty local path. `options.specificationRevision` defaults to `0.9.0`. `options.maxDocumentBytes` is a positive safe integer and defaults to 1,048,576 bytes. This option bounds retained raw bytes per file; it does not truncate hashing or validation.

| View property | Meaning |
| --- | --- |
| `contract` | The literal `atlas.read-view/2`. |
| `atlasRoot` | The absolute discovered root in the selected source namespace, or attempted path when discovery fails. |
| `identity` | The examined inventory, content digests, scope, and version coordinates. |
| `validation` | The captured complete validator result, including ordered diagnostics and normalized output only when permitted. |
| `status` | `ready`, `invalid`, or `incomplete`. |
| `limits` | Explicit restrictions on observation, selection, raw bytes, retrieval, and supported claims. |

The view and its returned object values are deeply frozen. A caller MUST NOT treat the result as mutable authoring state.

A view identifies its Atlas root, examined input scope, source identity, specification revision, implementation, validation result, and completeness. `ready` means complete valid resolved input. `invalid` means complete invalid input. `incomplete` means the observation or required processing could not complete.

Only a ready view exposes normalized output. Invalid and incomplete views MUST NOT expose a normalized model or an assembled Point. Raw-document access and diagnostics remain separate so a malformed draft can be inspected without being presented as valid Atlas meaning.

[Check discovery](EVALUATION.md#registration-and-discovery) can recover readable
local policy from captured source while the view is invalid or incomplete.
It retains unresolved applicability explicitly and supplies no normalized
subjects. This recovery does not change the view's validation status.

The source identity fingerprints the inspected inventory and content. A branch name, file count, or modification time alone MUST NOT stand in for examined input identity. Input changes during a working-tree observation invalidate the claim that validation and captured source describe one unchanged view.

`identity.inputs` lists examined entries in Unicode code-point path order. Regular files include byte length and a SHA-256 content digest. Directories, symbolic-link targets, nested-Atlas boundaries, missing target paths, special entries, and unreadable entries retain distinct kinds. Working-tree symbolic links are recorded without following their targets. The scope declares ignored build/package directories, nested-Atlas traversal exclusions, and its external Resource boundary. Workspace observations use the same scope rules.

Root `.checks/`, root `.publication/`, and discovered direct `points/` containers examine every direct entry, including names normally excluded from generic traversal. Invalid child directories are recorded without traversing their contents. An `atlas.md` file directly inside one of these containers is a structural entry, not a nested-Atlas boundary. This preserves the legal Point id `atlas` and exposes invalid structural children instead of hiding them behind generic exclusions.

`identity.scope.explicitLocalTargets` lists exact contained paths examined during resolved validation. Registered targets use `atlas.md` as their base; direct targets use their owning record. The inventory examines each target through its path prefixes even when ordinary traversal excludes the containing directory. It records a missing or inaccessible prefix and stops that path. This does not traverse unrelated siblings, discover another Atlas's records, or follow URI or prose links recursively. The same hashing and captured-byte limits apply to these explicit files.

Missing explicit paths have kind `missing`. They affect source identity without turning a complete invalid validation result into incomplete processing. Freshness examines the original view's fixed explicit target set, so target edits, deletion, later creation, and ancestor replacement remain visible. Paths outside the Atlas root remain outside this inventory.

`identity.inputDigest` identifies the examined inventory when it could be read completely; otherwise it is `null`. `identity.digest` additionally includes the contract, absolute root, specification revision, implementation metadata, and `maxDocumentBytes` configuration. Immutable sources also include their repository digest and revision. The view digest is `null` when opening could not establish unchanged, completely examined inputs. These digests describe the declared scope. They do not authenticate source authors, identify fetched external material, or identify an installed package artifact.

An opened view is an immutable observation. External edits do not silently replace its captured model. Callers explicitly inspect freshness or open a refreshed view. A before-and-after filesystem comparison detects observed differences; it does not establish an atomic filesystem snapshot or rule out every concurrent change.

### Local target metadata

`localSourceTargets(view)` returns a frozen array of exact absolute local paths recognized during the view's resolved validation. Paths are unique and sorted in Unicode code-point order. Registered Resource URIs resolve from `atlas.md`; direct targets resolve from their owning structural file. This metadata includes recognized paths outside the Atlas root and missing targets. It is available for complete invalid observations without requiring normalized output.

The helper reads no files and performs no additional resolution. Outside-Atlas paths remain absent from `identity.inputs` and `identity.scope.explicitLocalTargets`; their bytes are not captured or inspected by this helper. Snapshot views return paths in their sealed source namespace. Metadata does not grant access, authenticate a target, prove that it exists, or identify arbitrary paths written in malformed data or prose.

Applications can compare these paths with proposed recovery, report, or draft destinations before creating application state. An application MUST NOT treat an incomplete observation or an empty list alone as proof that a destination is safe. It must also check the view's completeness, freshness, its own placement rules, and caller authority. Working-tree checks remain non-atomic observations. The helper rejects objects that are not Library read views.

## Immutable supplied sources

`openAtlasSnapshot(input, options)` returns the same public read view through a sealed source. Its options match `openAtlas`. The input contains:

| Field | Meaning |
| --- | --- |
| `repositoryRoot` | An absolute lexical namespace for source paths. The directory need not exist on the host. |
| `atlasPath` | An exact repository-relative discovery path, or `.` for the namespace root. |
| `files` | A plain map from exact repository-relative file paths to strings or `Uint8Array` bytes. |
| `directories` | Optional exact directory paths, including empty directories. File parents are inferred. |
| `revision` | An optional nonempty caller-supplied source label. |

File and directory paths reject absolute paths, empty segments, dot or parent segments, backslashes, NUL, and file-directory conflicts. Only `atlasPath` and directory entries can use `.` for the namespace root. Supplied strings become UTF-8 bytes. The reader copies all supplied bytes synchronously and retains them privately. Later caller mutation cannot change the source.

The map is the complete namespace supplied to this reader. Discovery, structural parsing, local resolution, raw-document access, freshness, refresh, and local source reads use that map. They MUST NOT fall back to the host filesystem. The reader supports files and directories; the supplied format does not represent symbolic links or special files. Existing nested-Atlas and structural discovery rules still apply.

The source clones and hashes complete supplied files. `maxDocumentBytes` bounds retained raw-document output, not immutable source bytes or parsing input. This implementation retains the full supplied map in memory and does not claim a total-memory bound. A caller-supplied label does not prove Git provenance, a coherent prior filesystem capture, or the absence of omitted real-world material.

Snapshot identity uses `scope.kind: snapshot`, `consistency: immutable-snapshot`, `scope.repositoryRoot`, `scope.repositoryDigest`, and `scope.revision`. An absent revision becomes `null`. `repositoryDigest` identifies every supplied file's complete bytes and the complete supplied directory set in deterministic order. `inputDigest` continues to identify the narrower examined Atlas inventory. `scope.externalResources: not-fetched` records that no external retrieval occurred during opening.

Local source observations use `kind: immutable-file` and identify the repository digest and revision. A supplied file outside the Atlas root still requires an explicit additional allowed root. A path outside the supplied namespace never resolves through the host, even when an allowed root would permit it there. External URIs retain the caller-reader boundary and remain separate observations.

## Reading operations

| Operation | Preserved boundary |
| --- | --- |
| Exact Point inspection | Select one exact id with its anchor, same-id contexts, containing Map and member Area metadata, relation notes, and directly used Resource registrations. |
| Exact Resource inspection | Select one registered id and its authored Content and Reference uses without matching other registrations by URI. |
| Progressive search | Return ranked or explicit full-text candidates from the captured model with exact record matches, stable ordering, and continuation. Search never creates identity, memberships, or relations. |
| Raw document reading | Expose captured source and relevant diagnostics independently of normalized-model availability. |
| Source reading | Resolve registered Resource targets from `atlas.md` and direct targets from their owning structural file within caller-authorized roots. |
| Comparison | Compare identified observations while preserving exact authored identities and source provenance. |
| Freshness and refresh | Report whether the examined local input still agrees and return a new observation when refreshed. |

Exact Point inspection retains `atlas.point-inspection/1`. Its selected output omits Atlas and Map bodies, unrelated Areas, other Points, Check definitions, and publication profiles. It does not fetch source content or apply a publication selection. Relation endpoints remain authored ids without recursive expansion.

### Resource inspection

`inspectResource(resourceId)` selects an exact nonblank registered id. Whitespace is not trimmed for selection. The `atlas.resource-inspection/1` result contains `status`, `atlasRoot`, `resourceId`, the captured `identity`, and `limits`. Invalid and incomplete views retain those statuses. An absent exact id in a ready view returns `not-found`. Only `found` adds the Resource registration and `uses`.

Each use contains `use: content` or `use: reference`, the complete authored `target`, and its `owner`. Targets preserve selectors, labels, Reference roles and notes, and extensions. The owner identifies its type and source path. Map owners retain `mapId` and their question. Area owners retain `mapId`, `areaId`, and their question. Point-record owners retain `mapId`, `pointId`, and anchor/context `recordKind`. The Atlas owner uses `atlas.md`. An unused registration remains `found` with an empty use list.

Uses begin with the Atlas, followed by Maps in normalized id order. Each Map precedes its Areas in authored order. Points follow in normalized id order and retain their existing anchor/context record order. Each owner lists Content before References in authored order.

Only authored uses of the selected registered id count. A direct URI, prose link, or another registration with the same URI does not become an inferred use. Owner bodies and source contents remain omitted. Inspection reads no filesystem content, fetches no source bytes, and applies no publication selection.

### Search

`find(query, { mode, types, limit, cursor })` searches the captured normalized model through SQLite FTS5. `query` is a string. `mode` selects `ranked` or `fts`; omission selects `ranked`. `types` selects `map`, `area`, `point`, `resource`, and `check`; omission selects all five. An empty type list selects none. `limit` defaults to 30 and accepts integers from 1 through 200. A query containing only whitespace lists candidates.

Queries accept at most 4,096 UTF-16 code units and 128 `unicode61` token occurrences. NUL is rejected. Invalid query arguments or FTS expressions fail with `atlas.tools.invalid-argument`.

Ranked mode accepts ordinary text. SQLite's `unicode61` tokenizer produces distinct query terms. The implementation quotes those terms and combines them with `OR`. Query punctuation and operator-like words cannot inject an FTS expression in this mode. A candidate can match some query terms without matching all of them. Ranked mode does not rewrite the question, add synonyms, infer negation, or retrieve an answer.

FTS mode accepts an explicit [SQLite FTS5 expression](https://sqlite.org/fts5.html#full_text_query_syntax). It supports phrases, prefixes, Boolean operators, `NEAR`, and column selection under that grammar. Expressions execute as query data, not SQL. An invalid expression fails explicitly. The operation MUST NOT silently weaken a failed expression or switch modes.

The indexed columns are `id`, `title`, `summary`, `path`, and `body`. The index contains one row for each Map, Area, Resource registration, Check, and Point record. A Point anchor and each same-id context occupy separate rows. Each Point record contributes its local Markdown title; the anchor title remains canonical for the Point. Each record contributes its own summary, body, explained memberships, References, and outgoing relation notes. Map and Area questions form part of their own searchable text. Resource URI occurs in its registration row's `body` column. Resource search does not retrieve or index Resource bodies. Opening or searching MUST NOT fetch source content or execute a Check.

Point matches are grouped by exact Point id after the expression is evaluated. A phrase or conjunction cannot be satisfied by joining words from different Point records. Area identities retain their containing Map. Other result types retain their exact type and id.

Each Point candidate uses its strongest matching record's BM25 score. Additional matching contexts do not add votes to that score. The returned `score` negates SQLite's BM25 value so higher scores rank ahead of lower scores. Ranked mode places exact id matches before other candidates without changing their returned score. FTS mode uses BM25 order without that preference. Equal ranks use Unicode code-point order over type, exact id, and containing Map id when present. Empty-query candidates score zero. Ranking is relative to the captured index and declared engine. Scores do not promise bit-identical values across runtime or implementation revisions and do not establish semantic relevance or authored identity.

Candidates retain type, exact id, title, summary, canonical source path, relevant Map identity, score, `exactMatch`, and reasons. `matchCount` identifies the full number of matching indexed records. `matches` retains at most the three strongest matches. Each match contains `path`, `excerpt`, and `score`, plus `mapId` when the record belongs to a Map and `recordKind` for a Point anchor or context. SQLite snippets retain at most 24 tokens and mark matching terms with `⟦` and `⟧`. The final excerpt is capped at 320 Unicode code points. An excerpt is a reading aid; the exact record and its sources remain available through inspection and source reading.

A ready result contains `identity`, `query`, `items`, `total`, `nextCursor`, and `limits`. Search returns compact identity: `digest`, `inputDigest`, `specificationRevision`, `consistency`, and `scope` containing `kind` and `root`. The full inventory remains available through `view.identity`. `query` contains the selected `mode` and effective `expression`. Invalid or incomplete views return their status, no items, a zero total, no continuation, and a null expression.

A cursor belongs to the exact view identity, search revision, mode, normalized input query, and selected type set. Ranked input is trimmed and lowercased; FTS input is trimmed without changing case. Token-equivalent queries can still have different cursor selections. Callers MUST treat cursors as opaque. A cursor from a changed selection or observation fails with `atlas.tools.invalid-cursor`.

FTS5 indexes are private in-memory derivatives of retained record rows. The process keeps at most eight such indexes and closes evicted databases. A later query rebuilds an evicted index from the same captured rows. Each view constructs its FTS5 index lazily. Index eviction MUST NOT refresh source or change the public observation.

Complete pagination enumerates the candidates satisfying the selected expression within this index. It does not establish that an unanswered question lacks evidence in unindexed sources or differently worded material. Retrieval quality requires separate measured evidence.

Atlas Library, `atlas-read`, the agent adapter, and the local Editor use this search operation. Atlas Portal retains its separate static browser search and publication-selected index. The local FTS5 implementation does not change the Portal's browser runtime or search contract.

### Captured documents

`readDocument(relativePath)` reads retained bytes from the opened inventory. The path is exact and Atlas-relative. Absolute paths, traversal segments, empty segments, and dot segments are invalid arguments. It does not reread the filesystem or resolve a Resource registration.

Every result includes `path`, `viewDigest`, and validation diagnostics attached to that exact path. `missing` means the path was outside the captured inventory or was an explicitly examined missing target. `unreadable` retains an observed read failure. `unsupported` covers non-file entries or bytes that cannot be decoded as UTF-8. File results include the input identity, `bytesBase64`, and `truncated`. Supported UTF-8 adds `text`; base64 bytes remain available for repair when text decoding fails.

`read` contains the full retained file. `truncated` contains the prefix allowed by `maxDocumentBytes`; its input digest still identifies the entire examined file. A truncated prefix may also lack decoded text. Raw access does not claim that the document is a valid structural record.

### Comparison

`compare(otherView)` accepts another opened view from this library instance. It returns both observation identities, path-level `sourceChanges`, limits, and status. Source changes distinguish `added`, `removed`, and `changed` entries.

When either view is invalid or incomplete, comparison is `unavailable` and returns no normalized records. Two ready views return `compared` and changed normalized records with their keys, change category, and before/after values. Keys cover the Atlas root, Maps, assembled Points, Resources, Checks, and publication profiles. Records sort by key. This is an exact structural comparison; it does not independently judge whether changed wording changes meaning.

### Freshness and refresh

`freshness()` examines the current inventory without replacing the view. It returns `fresh`, `stale`, or `unavailable`, the expected and current input digests, changed paths, and read issues. An unchanged examined inventory is `fresh`. A changed inventory is `stale`. An incomplete inventory comparison is `unavailable`. A freshness result does not change the view's captured validation outcome.

`refresh()` opens a new view at the same root with the same options. Existing references to the earlier view remain unchanged. Neither operation runs Check verification or project commands.

For a sealed source, `freshness()` compares the retained immutable inventory and is `fresh` when its identity is available. It reads no host files. `refresh()` reopens the same sealed source and revision; it does not follow a moving branch or recapture caller data.

### Source reads

`readSource(target, options)` returns an `atlas.source-read/1` result. The target contains exactly one `resource` id or direct `uri`. The result retains the supplied target, including its selector and Content or Reference metadata, and the opened view digest. Reading a registered Resource requires a valid normalized registry. A missing registration returns `missing`; an unavailable registry returns `unavailable`.

Registered URI bases are always `atlas.md`. Direct URI bases use `options.ownerPath`, which defaults to `atlas.md` and must name an exact observed file. A direct reference from a Map or Point record supplies that record's path. The result exposes the resolved URI, owner path, and Resource registration when applicable.

`options.maxBytes` is a positive safe integer and defaults to 1,048,576. The Atlas root is the default allowed local root. `options.allowedRoots` adds caller-authorized absolute roots. A path outside those roots returns `unrequested`. Descendant symbolic links and case or normalization mismatches are unsupported. The explicitly selected root itself supplies the boundary for canonical path checks.

Local reading requires a regular file. The working-tree reader compares file metadata before and after reading and reports `stale` when it observes a conflict. It does not establish an atomic snapshot. The immutable reader uses its sealed file bytes. A local URI's query or fragment remains visible in the result; the local reader returns file bytes without interpreting it as an excerpt selector. Opaque local Resource selectors return `unsupported`.

External URIs return `unrequested` unless the caller supplies `options.reader`. Atlas performs no default network request. The injected reader receives `uri`, `selector`, and `maxBytes`; it returns directly or through a promise. Its result contains `bytes` as a `Uint8Array`, optional `complete`, optional `selectorApplied`, and optional string `provenance` and `mediaType`. A requested selector requires `selectorApplied: true`. Missing bytes or an unapplied selector return `unsupported`. Reader failures return `unreadable`.

| Source result | Meaning |
| --- | --- |
| `read` | Complete returned bytes decode as UTF-8 without NUL. |
| `truncated` | The supported text exceeds the retained byte limit or the caller reader declared incomplete output. |
| `unsupported` | The target, selector, filesystem kind, or text encoding is unsupported. Returned bytes remain available when content was read. |
| `missing` | The Resource id or local file was absent. |
| `unrequested` | The local root was not allowed or no external reader was supplied. |
| `unreadable` | Required source access failed. |
| `stale` | Local input changed during the observed read. |
| `unavailable` | A Resource registration could not be resolved from a valid view. |

Content results include `bytesBase64`, `truncated`, and an `observation`. Supported UTF-8 adds `text`. The observation identifies `local-file`, `immutable-file`, or `caller-reader` origin, observation time, returned byte length, SHA-256 digest, `digestScope: returned-bytes`, and completeness. File observations also retain `totalByteLength` from the examined metadata. Immutable files add `repositoryDigest` and `revision`. The total size does not expand the returned-byte digest to cover unread content. A prefix digest MUST NOT be presented as a full-source digest.

Every working-tree source read is a separate current observation, including for a file also present in the opened inventory. It MUST NOT be described as bytes frozen by the earlier view. Immutable local reads use the sealed source; caller-reader content remains a separate observation for both source kinds. Source reading grants no mutation, execution, or publication authority and establishes neither source truth nor redistribution rights.

The static Portal applies its explicit publication profile before deriving routes, navigation, overlap, Resource uses, and search. Opening a local view exposes local Atlas meaning; it does not make that complete view eligible for static publication.

## Errors

`AtlasToolError` exposes a stable `code` alongside its message. Invalid read-view arguments use `atlas.tools.invalid-argument`. Invalid or mismatched continuations use `atlas.tools.invalid-cursor`. These usage errors are separate from standard validator diagnostics and result status. Existing validation and standalone inspection entry points retain their own usage contracts.

Atlas validation failures retain the [Validation](VALIDATION.md) contract. An observed source conflict or failed required inventory inspection produces an incomplete view with an `atlas.processing.io` diagnostic. A missing Atlas root retains its normal invalid result. Tooling does not turn these failures into an empty valid Atlas.

## Installed reading command

The `atlas-read` command exposes reading operations through the same public view. It accepts these forms:

```text
atlas-read <atlas-path> find <query> [--type TYPE] [--limit N] [--cursor CURSOR]
atlas-read <atlas-path> document <relative-path>
atlas-read <atlas-path> source (--resource ID | --uri URI) [--owner PATH] [--allow-root ABS] [--max-bytes N]
atlas-read <atlas-path> compare <other-atlas-path>
```

`--type` and `--allow-root` can repeat. `--specification-revision REVISION` is available to every operation. Comparison applies the same declared revision to both opened views. Query limits, cursor selection, document paths, URI bases, and allowed-root rules follow the library contract. Document reads use the default captured-byte limit. `--max-bytes` bounds a source read. `--owner` applies only with `--uri`; registered Resources always use `atlas.md`. `--` makes subsequent positional arguments literal, including a query that starts with a dash.

Operation results are JSON on stdout. Usage and API errors are JSON on stderr with the shape `{ "error": { "code": "...", "message": "..." } }`. Expected tool errors retain their library code. Unexpected failures use `atlas.tools.unexpected-error`. `--help` prints plain-text help and exits with zero.

| Exit code | Result |
| --- | --- |
| `0` | `ready`, `read`, `truncated`, or `compared`. |
| `1` | `invalid`. |
| `2` | `incomplete`, `unavailable`, `unreadable`, usage failure, or an unexpected error. |
| `3` | `missing`, `unrequested`, `unsupported`, or `stale`. |

A successful `document` command means raw captured source is accessible. It does not mean the Atlas or that document is valid. Malformed drafts can return raw bytes and diagnostics without exposing normalized meaning.

The command provides no external-network reader flag and executes no project command. Additional local source roots require explicit `--allow-root` arguments. External retrieval remains an injected library capability, not an automatic CLI effect.

## Qualification boundary

Contract tests exercise captured reuse, exact identity, invalid and incomplete refusal, raw-draft inspection, source boundaries, continuation, freshness, and comparison. Installed-consumer tests import supported exports without development-checkout or private-module dependencies. Existing normalized fixtures and independent-reader agreement remain required for unchanged reading semantics.

These checks establish named behavior on tested inputs. They do not prove source truth, Check compliance, useful ranking, an atomic filesystem snapshot, or comparative task benefit.
