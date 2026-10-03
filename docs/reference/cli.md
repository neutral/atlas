# CLI reference

`atlas` operates on a project or one Atlas. Commands return JSON; errors are JSON
on stderr. `atlas --help` and `atlas --version` work from any directory. In the
development checkout, replace `atlas` with `pnpm atlas`.

## Project commands

```sh
atlas open [PROJECT] [OPTIONS]
atlas discover [PROJECT] [--atlas PATH]
```

`PROJECT` defaults to the working directory. `open` starts the Editor and requests
a browser. `discover` reports candidate Atlas directories without opening one.

| Open option | Effect |
| --- | --- |
| `--atlas PATH` | Select an exact project-relative Atlas directory. `.` selects the project root. |
| `--no-browser` | Print the URL without requesting a browser. |
| `--port PORT` | Use port `0`–`65535`; omission or `0` chooses an available port. |
| `--export-directory PATH` | Set the export destination. |
| `--allow-source-root PATH` | Add a source-reading grant; repeat for additional roots. |
| `--state-home PATH` | Set the private storage directory for this launch. |

Selection precedence is `--atlas`, `atlas.workspace.json`, then discovery. A
workspace file contains `{ "format": 1, "atlasPath": "context" }`. One discovered
Atlas opens directly. Several require a terminal choice or explicit selection.
With none, the Editor offers a creation draft at the project root.

Discovery skips hidden and generated directories, stops at each `atlas.json`,
and is bounded to 20,000 entries and 12 levels. Reaching a bound requires explicit
selection. See the [project contract](../../spec/spec/PROJECT.md) for path
validation and the complete skip list.

Opening grants source access to the project. Export defaults to
`PROJECT/atlas-export`, or the sibling `PROJECT-atlas-export` when the project
itself is the Atlas. Existing output is refused.

## Atlas commands

```sh
atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] COMMAND
```

`--root` must come first and name an existing directory. Launcher options precede
the command. The root and grants stay fixed for the process. Source reads default
to the Atlas; at most 100 distinct roots, including the Atlas root, may be granted.

`INPUT` is an explicit JSON file path or `-` for piped stdin. Inputs are strict
UTF-8 JSON, bounded to 4 MiB. CLI paths resolve from the working directory; authored
source references resolve from the Atlas root.

| Command | Input or result |
| --- | --- |
| `styles [ID]` | List curated Styles, or read one complete definition by ID. |
| `style INPUT` | Explicit `styleId` or `styleContent`, plus `reason`; save a Style adoption or revision draft. |
| `init INPUT` | `id`, `title`, optional `styleId` or `styleContent`; save an `atlas/1.1` initialization draft. |
| `validate` | Captured identity, status and format diagnostics. |
| `inventory [INPUT]` | Bounded record inventory; optional `limit`, `offset`, `section`, `expectedIdentity`, `full`. |
| `inspect` | Compact captured inventory by default; `inspect --full` returns complete records and raw files. |
| `inspect point ID` | One Point, its owner, sources and Facets. |
| `inspect tree ID` | One Tree and its owned records. |
| `inspect style` | The complete captured active Style, including a custom definition. |
| `inspect facet TREE_ID FACET_ID` | One Tree-local Facet and its targets. |
| `search INPUT` | Required `query`; optional `tree`, `type`, `kinds` (`point`, `facet`), `limit` (`1`–`100`), `presentation` (`full` or `summary`); defaults to both kinds and summaries. |
| `route INPUT` | Exactly one `point`, `tree` or `query`; optional `facet` with `tree`, `kinds`, `detail`, `type`, `limit`, `mode`, `orientation`, `cursor`. |
| `references INPUT` | `{}` for the index; select `point`, `facet` plus `tree`, or exact `uri`; optional `limit`. Reads no sources. |
| `sources INPUT` | Optional `uris`, `previous: [{uri, sha256}]`, `limit`, `maxBytes`, `draft: {id, revision}`; explicitly inspect declared source bytes within launch grants. |
| `source-history [INPUT]` | Bounded retained observations, latest inspections and decisions; `--full` returns the complete history. |
| `source-record INPUT` | Explicitly retain `{review?, decisions?, expectedRevision?}`; changed history revisions are refused. |
| `move INPUT` | `point` or `facet` plus `tree`, new `path`, and `reason`; save a same-Tree move with repaired inline path links. |
| `draft-review ID [INPUT]` | Compact saved-draft review; `--full` or chunked `part: "details"` exposes the complete review. |
| `draft-checks INPUT` | `id`, `expectedRevision`, `actor`; optional `checkIds`, `manual`; record candidate evidence and return an updated draft revision. |
| `absorb inspect INPUT` | Required `text`, `source`; optional `tree`, `limit`. |
| `absorb prepare INPUT` | Explicit contribution decisions and changes; returns a proposal and, when applicable, a saved draft. |
| `prepare INPUT` | Required `changes`, `reason`; optional `sourcePreconditions`, explicit `styleChange`. |
| `apply ID --revision REVISION` | Apply the exact saved draft revision. |
| `drafts` or `drafts list` | Saved draft identities, revisions and baselines. |
| `drafts show ID [INPUT]` | Compact saved draft; `--full` or chunked `part: "details"` exposes all exact bytes. |
| `drafts delete ID --revision REVISION` | Delete the exact saved draft revision. |
| `recover` | Transaction journals. |
| `recover ID` | Guarded rollback of an interrupted transaction. |
| `serve [OPTIONS]` | Read-only local Portal. |
| `editor [OPTIONS]` | Local Editor. |
| `mcp` | MCP server over stdin/stdout. |
| `config` | MCP connection settings with absolute launch paths. |
| `export OUTPUT INPUT` | Static publication from an explicit selection. |
| `state inspect` | Private-state location and ownership. |

For example, replace `POINT_ID` with an existing Point ID:

```sh
printf '%s\n' '{"point":"POINT_ID","detail":"deep"}' |
  atlas --root /path/to/atlas route -
```

The result includes selected and supporting Points, orientation, Facets and
inclusion reasons. Use `mode: "discover"` for literal Point and Facet previews and
`orientation: "compact"` to omit repeated ancestor bodies. Follow the exact
`next.selected`, `next.supporting` or `next.facets` request for continuation; changed
content or a changed request invalidates that cursor. See [Absorb and Route](absorb-route.md) for request semantics.

## Drafts

`init` and `prepare` save drafts in [private storage](authoring.md#private-storage).
Review their complete `plan` before applying the returned `id` and `revision`.
Default inventories and saved-draft views omit repeated file bodies. Use `--full`
for complete output or a draft inspection input such as
`{"part":"details","offset":0,"maxBytes":65536}`. Follow `nextOffset` with the
returned `sha256` supplied as `expectedSha256`, then assemble the exact UTF-8 JSON
before interpreting it. A compact synopsis alone is not a full review.

Inventory limits are 1–100, default 50. Each section has bounds and a complete
`next` request naming `expectedIdentity`; changed content requires a fresh inventory.
Sections are `files`, `trees`, `points`, `branches`, `facets`, `checks`, and
`diagnostics`. Style metadata identifies the locally captured policy; inspect its
file to read the complete definition.
Absorb drafts retain contribution reasons, unresolved questions and optional
[preservation accounting](absorb-review.md). `draft-review` also exposes direct
citations and link diagnostics as review leads.

Each change is `{ "path": "…", "content": "…" }`; `content: null` deletes a file.
Unchanged proposals can return `noop`.

General invalid drafts remain inspectable but cannot apply. Invalid Absorb
proposals return `draft: null`. Changed Atlas bytes, source preconditions or draft
revisions require another review. Apply accepts a saved ID and revision; it does
not accept a plan file or rebase the draft. See [authoring](authoring.md) for
concurrency and recovery behavior.

For candidate Checks, use the draft candidate identity as each manual result's
`baseline`, with the exact candidate Check revision, outcome, reason and evidence.
`draft-checks` returns a new saved revision; use that revision for subsequent
review/application. Evidence never supplies approval. See [Checks](checks.md).

The [reference index](references.md) separates local body links from declared
source citations. Source review compares explicit reads with authored hashes or
caller-supplied prior observations. `current` describes inspected bytes; it does
not establish that a claim is still true. Remote references remain uninspected.

## Retain source review across sessions

`sources INPUT` inspects bytes and remains read-only. To retain that observation,
pass its result as `review` in a separate `source-record` request. Read
`source-history` first and include its current `revision` as `expectedRevision`
when saving; for an absent history, omit the field or use `null`. A stale revision
is refused without replacing the saved history.

A `decisions` entry is `{uri, sha256, outcome, reason}`, with outcome
`needs-review`, `reviewed-unchanged` or `updated`. It must name successfully
observed bytes still represented by the latest successful inspection. A later
missing or denied inspection prevents recording a disposition for unavailable
bytes. Decisions record the author's assessment; they neither prove truth nor
update Atlas explanations.

`source-history` defaults to 50 records per section, with `limit` 1–100 and
`offset` for continuation. Supply its `revision` as `expectedRevision` when
continuing summary pages. Sections report `available`, `returned` and
`nextOffset`. Use `{"part":"details","offset":0,"maxBytes":65536}` for exact
JSON chunks, following `nextOffset` and supplying the returned `sha256` as
`expectedSha256`; `--full` returns all retained content at once. See
[source review](references.md#keep-review-across-sessions) for evidence boundaries.

## Services and export

`serve` and `editor` accept `--port PORT` and `--export-directory PATH` after the
command. They print a local URL and run until SIGINT or SIGTERM. MCP stdout carries
protocol messages only. `config` prints settings for the user to install.

Export input requires a nonempty `trees` array of IDs. Omitted `points` includes
all owned Points in those Trees. Optional `sources` explicitly selects source
URIs for retrieval. Optional `includeStyle: true` selects the complete adopted
Style; it is excluded by default. See [publication](publication.md) for inclusion rules and
source-reading requirements.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed; inspect the returned status and bounds. |
| `1` | Failed, invalid, incomplete, unavailable, missing, denied or interrupted result. |
| `2` | Invalid command or request input. |
| `3` | Stale state, writer lock, changed project selection or recovery conflict. |
