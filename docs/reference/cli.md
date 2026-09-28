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
| `init INPUT` | `{ "id": "example", "title": "Example" }`; save an initialization draft. |
| `validate` | Captured identity, status and format diagnostics. |
| `inspect` | Complete captured view, including invalid raw records and diagnostics. |
| `inspect point ID` | One Point, its owner, sources and Facets. |
| `inspect tree ID` | One Tree and its owned records. |
| `inspect facet TREE_ID FACET_ID` | One Tree-local Facet and its targets. |
| `search INPUT` | Required `query`; optional `tree`, `type`, `limit` (`1`–`100`). |
| `route INPUT` | Exactly one `point`, `tree` or `query`; optional `detail`, `type`, `limit`. |
| `absorb inspect INPUT` | Required `text`, `source`; optional `tree`, `limit`. |
| `absorb prepare INPUT` | Explicit contribution decisions and changes; returns a proposal and, when applicable, a saved draft. |
| `prepare INPUT` | Required `changes`, `reason`; optional `sourcePreconditions`. |
| `apply ID --revision REVISION` | Apply the exact saved draft revision. |
| `drafts` or `drafts list` | Saved draft identities, revisions and baselines. |
| `drafts show ID` | Complete saved draft. |
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
inclusion reasons. See [Absorb and Route](absorb-route.md) for request semantics.

## Drafts

`init` and `prepare` save drafts in [private storage](authoring.md#private-storage).
Review their complete `plan` before applying the returned `id` and `revision`.
Each change is `{ "path": "…", "content": "…" }`; `content: null` deletes a file.
Unchanged proposals can return `noop`.

General invalid drafts remain inspectable but cannot apply. Invalid Absorb
proposals return `draft: null`. Changed Atlas bytes, source preconditions or draft
revisions require another review. Apply accepts a saved ID and revision; it does
not accept a plan file or rebase the draft. See [authoring](authoring.md) for
concurrency and recovery behavior.

## Services and export

`serve` and `editor` accept `--port PORT` and `--export-directory PATH` after the
command. They print a local URL and run until SIGINT or SIGTERM. MCP stdout carries
protocol messages only. `config` prints settings for the user to install.

Export input requires a nonempty `trees` array of IDs. Omitted `points` includes
all owned Points in those Trees. Optional `sources` explicitly selects source
URIs for retrieval. See [publication](publication.md) for inclusion rules and
source-reading requirements.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed; inspect the returned status and bounds. |
| `1` | Failed, invalid, incomplete, unavailable, missing, denied or interrupted result. |
| `2` | Invalid command or request input. |
| `3` | Stale state, writer lock, changed project selection or recovery conflict. |
