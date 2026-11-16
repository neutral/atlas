# The atlas command

`atlas` reads an Atlas, prepares changes as drafts and applies them, serves the
Portal, connects an agent host and exports the Portal as static pages. This
page gives every command: its synopsis, options, INPUT fields, what it prints,
its exit codes and its refusals. `atlas help COMMAND` prints the same facts in
short. The rules the commands carry out are owned by the
[specification](../../spec/SPEC.md) and the
[operations](../../spec/spec/OPERATIONS.md); why they work as they do
is in [How changes land](../explanation/how-changes-land.md) and
[What Atlas may read and write](../explanation/access.md). The MCP server's
tools are in [The MCP server](mcp.md).

## Conventions

**Forms.** A command runs in one of two forms.

- The Atlas form names the Atlas directory first:
  `atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] COMMAND [ARGUMENTS]`.
  Every command but `locate` has it.
- The project form finds the Atlas of a project:
  `atlas open|locate|config [PROJECT] [OPTIONS]`. `PROJECT` is a directory,
  by default the working directory, and stands right after the command word.
  The Atlas is selected by `--atlas PATH`, then the project's
  `atlas.workspace.json`, then discovery, as the
  [project workflow](../../spec/spec/PROJECT.md) says. The workspace
  file and the limits of discovery are in [Configuration](configuration.md).

`guide`, `styles`, `help` and `--version` read no Atlas and need neither form;
`guide`, `styles` and `help` are also accepted after `--root PATH`.
`atlas COMMAND --help` prints the help of one command, with or without
`--root PATH`.

**Global options.** They stand before the command, in the Atlas form only.

| Option | Meaning |
| --- | --- |
| `--root PATH` | The Atlas directory. The first argument; its value must not begin with `--`. |
| `--allow-source-root PATH` | One more directory from which cited local sources may be read. Repeatable. The Atlas root is always granted. |
| `--state-home PATH` | Keep drafts and recovery journals under `PATH` instead of the user state directory. It sets `ATLAS_STATE_HOME` for the command. |

`--allow-source-root` and `--state-home` stand between `--root PATH` and the
command, in any order, and their values must not begin with `--`. Written after
the command they are unknown options, except in the project form of `open` and
`config`, where they are options of the command. At most 100 distinct
directories may be granted, the Atlas root among them, and in the project form
the project directory too; a directory given more than once is one grant. More
are refused with `CLI_INVALID_ARGUMENT`:
`At most 100 distinct source roots, including the Atlas root, may be granted.`
Each grant is a directory path of at most 4096 characters once resolved, as
the MCP server takes one; a longer one is refused with `INVALID_SCOPE`, and a
blank one with `CLI_INVALID_ARGUMENT`, by every command, before it reads
anything. The grants are read by `read-source`, `stale`,
`stamp`, `validate --from`, `open` and `export`, and passed to the MCP server
by `config` and `mcp`. Where state lives without `--state-home`, and what a
grant permits, is in [Configuration](configuration.md).

**Arguments.** After the command, an option that takes a value takes the next
argument, even one that begins with `--`. An option that is not repeatable may
be given once. Paths on the command line resolve from the working directory,
except `.atlas-candidate` after `--from`, which names the folder at the Atlas
root; the CLI prints paths absolute. A source URI resolves from the Atlas root,
as the Atlas cites it. An ID is lowercase letters, digits and hyphens, starting
with a letter or a digit, at most 100 characters.

**INPUT.** Where a command takes `INPUT`, it is the path of a JSON file, or `-`
to read the JSON from standard input:

```text
echo '{"query":"offline delivery","limit":3}' | atlas --root PATH search -
```

The file is a regular file; `-` is refused when standard input is a terminal; a
path that begins with `--` is refused, and a JSON text given in place of the
path is read as a path. The text is strict UTF-8 of at most 4 MiB, and one
strict JSON object without duplicate keys
([Text and JSON](../../spec/spec/FORMAT.md#text-and-json)). A field
the command does not take is refused.

**Output.** A command prints one JSON value on standard output, indented by two
spaces. `guide` and `styles show` print Markdown, `mcp` prints MCP protocol
messages, and `open` prints its JSON value and keeps running. Three keys recur:
`status` is the outcome the command reports; `identity` is the content identity
of the Atlas as the command read it
([View identity](../../spec/spec/FORMAT.md#view-identity)); and
`diagnostics` lists `{ code, path, message }` from validation
([Diagnostics and status](../../spec/spec/FORMAT.md#diagnostics-and-status)).

**Continuation.** A bounded result says in `bounds` how much there is, and
where a list continues it holds the INPUT that continues it, to pass back
unchanged: `bounds.SECTION.next` for `inspect`, `next` for `search` and
`review`, `next.SECTION` for `route`, `bounds.next` for `stale`. `drafts show`
gives `bounds.changes.nextOffset`, passed as `{"offset": N}`. A continuation of
`inspect` or `stale` carries `expectedIdentity`, and one of `route` a
`cursor`: once the Atlas changed, it is refused. Bounds and continuation are in
[Reading](reading.md).

**Chunks.** With `"part": "details"`, `review` and `drafts show` print their
complete result as exact JSON text in chunks:
`{ status, encoding, byteLength, sha256, offset, returnedBytes, nextOffset, complete, text }`.
The next chunk is asked for with `offset` set to `nextOffset` and
`expectedSha256` set to `sha256`, until `complete` is `true`; the `text`
values, joined in order, are the JSON text.

**Errors.** A refusal prints nothing on standard output and one JSON value on
standard error: `error` with `code` and `message`; `error.diagnostics`, at
most 100 entries, when the refusal names paths; and `usage`, the general usage
line, when the exit code is 2.

```json
{
  "error": {
    "code": "CLI_INVALID_ARGUMENT",
    "message": "Supply --root PATH first, followed by one command."
  },
  "usage": "atlas open [PROJECT]; atlas locate [PROJECT]; …"
}
```

**Exit codes.**

| Code | Meaning |
| --- | --- |
| `0` | Done. This includes a `noop` draft or apply, an `ambiguous` route, an absorb inspection with `no-candidates`, and a stale report that finds changed sources. |
| `1` | The printed value's `status`, or its `plan.status`, is `invalid`, `incomplete`, `unavailable`, `missing`, `interrupted` or `denied`; the value is still printed. Or a refusal whose code is in neither list below; a failure without a code is `CLI_FAILED`. |
| `2` | Invalid arguments or input: `CLI_INVALID_ARGUMENT`, every `CLI_INPUT_` code, every `JSON_` code, every code that ends in `.invalid-argument`, `INVALID_REQUEST`, `UNSAFE_PATH`, `PROJECT_INVALID`, `PROJECT_AMBIGUOUS`, `PROJECT_DISCOVERY_LIMIT`, `SELECTION_REQUIRED`, `SELECTION_UNKNOWN`, `INVALID_SOURCE_BASE`, `EXPORT_OVERLAP`, `atlas.route.cursor-mismatch`. |
| `3` | A conflict with the current state: `STALE`, `STALE_DRAFT`, `LOCKED`, `PROJECT_CHANGED`, `RECOVERY_CONFLICT`, `EXPORT_EXISTS`, `EXPORT_CONFLICT`, `atlas.route.stale-cursor`. |

**Refusals every command shares.** Each command below lists only its own.

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | An unknown command; a missing or extra argument; an unknown option, or one given twice; a malformed ID; an INPUT field the command does not take; `-` with a terminal as standard input; more grants than the limit. |
| `CLI_INPUT_LIMIT` | 2 | INPUT over 4 MiB. |
| `CLI_INPUT_ENCODING` | 2 | INPUT that is not UTF-8. |
| `JSON_SYNTAX`, `JSON_DUPLICATE_KEY`, `JSON_NUMBER`, `JSON_UNICODE`, `JSON_LIMIT` | 2 | INPUT that is not strict JSON. |
| `ENOENT` | 1 | An INPUT file or a project that does not exist; an Atlas root that does not exist, where the command needs the directory itself. A reading command reports a missing root as an Atlas that is not valid. |
| `UNSAFE_PATH` | 2 | An Atlas root that is not a directory, or is a symbolic link, where the command needs the directory itself. |
| `INVALID_SCOPE` | 1 | A source grant longer than 4096 characters once resolved, or holding a NUL character (`Source grants must be directory paths of at most 4096 characters, without NUL characters.`), in either form. |
| `INVALID_STATE_HOME` | 1 | `ATLAS_STATE_HOME` is empty or not an absolute path (`ATLAS_STATE_HOME must be an absolute directory.`). `--state-home` resolves a relative `PATH` from the working directory. |
| `UNSAFE_STATE` | 1 | The state location lies inside the Atlas (`Private state must be outside the Atlas.`), or a symbolic link or a regular file lies on its path (`Private state requires regular directories without symbolic links.`). |
| `STATE_OWNER` | 1 | The Atlas's state directory belongs to another Atlas, or has no ownership record while it holds files, or one of another format, or one that is not UTF-8 JSON (`Private state has invalid ownership metadata.`) ([Private state](configuration.md#private-state)). |

Every command that keeps or reads private state, or reads sources, checks the
state location at launch, creating nothing, and refuses with
`INVALID_STATE_HOME`, `UNSAFE_STATE` or `STATE_OWNER` before it reads
anything: `open`, `config`, `state`, `validate --from`, `read-source`,
`stale`, `init`, `candidate`, `prepare`, `review`, `apply`, `drafts`,
`recover`, `move`, `stamp` and `export`. A root that does not exist or is not
a directory is left to the command, as `ENOENT` and `UNSAFE_PATH` say above.
Under `mcp`, the tools refuse it ([Launch](mcp.md#launch)).

## Read

### open

```text
atlas open [PROJECT] [--atlas PATH] [--port N] [--no-browser] [--allow-source-root PATH]... [--state-home PATH]
atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] open [--port N] [--no-browser]
```

Serves the Portal for one Atlas on `127.0.0.1`, asks the system to open it in a
browser, and keeps running until Ctrl+C, SIGINT or SIGTERM. The project form
selects the project's Atlas and grants the project directory; the Atlas form
serves the Atlas at `--root`. A directory that holds no Atlas is served too.
With several Atlases in the project and a terminal, it asks which to serve.

| Option | Meaning |
| --- | --- |
| `--atlas PATH` | Project form: the project-relative directory of the Atlas, or `.` for the project itself. |
| `--port N` | The port, 0 to 65535. Default 0: a free port. |
| `--no-browser` | Print the address without asking for a browser. |
| `--allow-source-root PATH` | Project form: one more directory from which cited local sources may be read. Repeatable. |
| `--state-home PATH` | Project form: read drafts under `PATH` instead of the user state directory. |

**Prints** `atlas.server/1`, then keeps running:

- `status`: `serving`.
- `url`: the Portal's address, `http://127.0.0.1:PORT/`.
- `browser`: `requested`, `unavailable` (no browser could be asked) or
  `not-requested` (`--no-browser`).
- `project`, `atlasPath`, `create`: project form only. The project directory,
  the selected directory relative to it, and `true` when that directory holds
  no `atlas.json`.
- `shutdown`: how to stop the service.

The Portal's pages, addresses and service are in [The Portal](portal.md);
why it writes nothing is in [The Portal](../explanation/the-portal.md).

**Exit.** 0 once a signal stops it.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | A port that is not 0 to 65535; `--atlas`, `--allow-source-root` or `--state-home` after `open` in the Atlas form; `PROJECT` after an option. |
| `PROJECT_INVALID` | 2 | `--atlas` is not an exact project-relative path, or names no directory; the workspace file is not valid; a terminal answer that is not a listed number. |
| `PROJECT_AMBIGUOUS` | 2 | Several Atlases and no terminal; the message lists them. |
| `PROJECT_DISCOVERY_LIMIT` | 2 | Discovery reached its entry or depth limit. |
| `PROJECT_CHANGED` | 3 | The project, its workspace file or the selected directory changed while it was read. |
| `INVALID_ROOT` | 1 | Atlas form: the root is not a directory. |
| `EADDRINUSE` | 1 | The port is taken. |

### locate

```text
atlas locate [PROJECT] [--atlas PATH]
```

Reports which Atlas a project selects, and how, without serving it or reading
it. It is the selection `open` and `config` make. It writes nothing. It has no
Atlas form: `atlas --root PATH locate` is an unknown command.

| Option | Meaning |
| --- | --- |
| `--atlas PATH` | The project-relative directory of the Atlas, or `.` for the project itself. |

**Prints** `atlas.project/1`:

- `project`: the project directory, absolute.
- `source`: how the Atlas was selected: `explicit` (`--atlas`), `workspace`
  (`atlas.workspace.json`) or `discovery`.
- `candidates`: each `{ path, root }`, the directory relative to the project
  and absolute. Several are listed, not refused. Empty when discovery finds no
  Atlas.
- `visited`: after a discovery, how many directory entries it read.

**Exit.** 0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `PROJECT_INVALID` | 2 | `--atlas` is not an exact project-relative path, or names no directory with that exact spelling; the workspace file is not valid. |
| `PROJECT_DISCOVERY_LIMIT` | 2 | Discovery reached its entry or depth limit; select the Atlas with `--atlas`. |
| `PROJECT_CHANGED` | 3 | The project or its workspace file changed while it was read. |

### outline

```text
atlas --root PATH outline [TREE]
```

Prints every Tree, or the one `TREE` names, with its title, its scope and its
outline: one line for each Point, the Base first and each Point two spaces
deeper than the Point it develops. A line is `ID: title`, followed by
` [decision: STATUS]` or ` [observation: DATE]` for a typed Point. It holds no
explanation.

**Prints** `atlas.outline/1`:

- `status`: `ready`, also for an Atlas that has no Tree; `missing` when no
  Tree has the ID `TREE`; `unavailable` when the Atlas is not valid.
- `identity`.
- `tree`: `TREE`, when it was given.
- `trees`: each `{ id, title, scope, outline }`, in the order of `atlas.json`;
  empty for an Atlas that has no Tree, and unless `status` is `ready`.
- `diagnostics`.

**Exit.** 1 unless `status` is `ready`.

**Refusals.** Only those every command shares.

### inspect

```text
atlas --root PATH inspect [INPUT | --full]
atlas --root PATH inspect point ID
atlas --root PATH inspect tree ID
atlas --root PATH inspect facet TREE_ID FACET_ID
atlas --root PATH inspect style
atlas --root PATH inspect checks
```

Without a record, prints a bounded summary of the Atlas: its files, Trees,
Points, Facets, Checks and diagnostics, without their text. With a record,
prints that record whole: a Point, a Tree, a Facet, the Style, or every Check.
The first argument is a record kind when it is `point`, `tree`, `facet`,
`style` or `checks`, and an INPUT path otherwise.

| Option | Meaning |
| --- | --- |
| `--full` | The whole captured view: every file and every record whole. |

| INPUT field | Meaning |
| --- | --- |
| `limit` | 1 to 100, default 50: entries per section. |
| `offset` | 0 to 100000, default 0. |
| `section` | `files`, `trees`, `points`, `facets`, `checks` or `diagnostics`: list only this section; the others keep their counts. |
| `expectedIdentity` | The identity a continuation belongs to. |
| `full` | `true`: as `--full`. |

**Prints**, for the summary, `atlas.view/1`:

- `status`: `ready`, `invalid` or `incomplete`.
- `root`: the Atlas root, absolute.
- `identity`.
- `files`: each `{ path, sha256, bytes }`.
- `diagnostics`.
- `atlas`: `format`, `id`, `title`, `style` (`{ title, path }`) and the
  `trees`, `points`, `facets` and `checks` of the page, without their text.
- `bounds`: for each section, `{ available, returned, offset, next }`.

`--full` prints `atlas.view/1` without `bounds`, with every file and record
whole. A record prints `atlas.inspection/1`: `status` (`ready`, `missing` or
`unavailable`), `identity`, `kind`, `record` and `diagnostics`; for `checks`,
`records` and `limits` in place of `record`. What each record holds is in
[Reading](reading.md).

**Exit.** 1 unless `status` is `ready`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.inventory.invalid-argument` | 2 | `limit`, `offset`, `section` or `full` out of range. |
| `STALE` | 3 | `expectedIdentity` is not the identity of the Atlas now. |
| `ENOENT` | 1 | The first argument is neither a record kind nor a file. A file named like a kind is given as `./point`. |

### search

```text
atlas --root PATH search INPUT
```

Finds Points and Facets whose ID, title, explanation or uncertainty contain the
words of a query, ranked lexically. Source bodies are not searched.

| INPUT field | Meaning |
| --- | --- |
| `query` | Required: nonblank text, at most 4096 characters. |
| `kinds` | `["point"]`, `["facet"]` or both, without repeats. Default both. |
| `tree` | Only records of this Tree. |
| `type` | `decision`, `observation` or `untyped`: only Points of this Type. |
| `limit` | 1 to 100, default 20. |
| `offset` | 0 to 100000, default 0. |
| `presentation` | `summary` (default: an excerpt and a selector) or `full` (complete records). |

**Prints** `atlas.search/1`:

- `status`: `ready`, or `unavailable` when the Atlas is not valid.
- `identity`.
- `request`: the request, with `kinds` and `presentation` filled in when they
  were not given.
- `results`: each record with `score`, `matches` and `reason`; a summary also
  has `selector`, the INPUT that reads the record through `route`.
- `bounds`: `{ offset, limit, available, returned }`; `available` is how many
  records matched in all.
- `next`: the INPUT of the next page, or `null`.
- `diagnostics`.

A result's fields are in [Reading](reading.md).

**Exit.** 1 when `status` is `unavailable`.

**Refusals.** `CLI_INVALID_ARGUMENT`, exit 2, also for a missing or blank
`query`, and for `query`, `kinds`, `tree`, `type`, `limit`, `offset` or
`presentation` out of range.

### route

```text
atlas --root PATH route INPUT
```

Suggests a reading path from one Point, one Tree, one Facet of a Tree, or a
question. Read mode returns the Points above, the complete selected
explanations, their developments and the Facets that bear on them; discover
mode returns compact results to choose from.

| INPUT field | Meaning |
| --- | --- |
| `point` | An exact Point ID. |
| `tree` | An exact Tree ID; with `facet`, one Facet of that Tree. |
| `facet` | An exact Facet ID; needs `tree`. |
| `query` | A question, 1 to 4096 characters. Give exactly one of `point`, `tree` and `query`. |
| `mode` | `read` (default) or `discover`. |
| `detail` | Read mode: `overview`, `standard` (default) or `deep`: none, one level or every level of developments beneath each selected Point. |
| `orientation` | `full` or `compact`. Default `full` in read mode, `compact` in discover mode. |
| `kinds` | With `query`: `["point"]`, `["facet"]` or both. |
| `type` | `decision`, `observation` or `untyped`. |
| `limit` | 1 to 100, default 8. |
| `cursor` | Set by a `next` value: pass the whole `next` value as INPUT. |

**Prints** `atlas.route/1`:

- `status`: `ready`, `ambiguous` (several candidates), `missing` or
  `unavailable`.
- `identity`, and `request` with its defaults.
- `orientation`, `selected`, `supporting`, `facets`: the sections of the path.
- `limits`: what the path does not establish.
- `bounds` and `next`: for each section, its counts and the INPUT of its next
  page; absent when `unavailable`.
- `search`: after a query, `{ window, available, exhaustive, limit }`.
- `page`: on a continuation.
- `reason`: when `missing` or `unavailable`; `diagnostics` when `unavailable`.

The modes, levels and sections are in [Reading](reading.md).

**Exit.** 1 when `status` is `missing` or `unavailable`; `ambiguous` exits 0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.route.invalid-argument` | 2 | An unknown field; not exactly one of `point`, `tree` and `query`; `facet` without `tree`; a value out of range; a malformed `cursor`. |
| `atlas.route.cursor-mismatch` | 2 | The `cursor` belongs to another request. |
| `atlas.route.stale-cursor` | 3 | The Atlas changed since the `next` value was issued. |

### references

```text
atlas --root PATH references INPUT
```

Reports Markdown links and declared source references as authored, without
reading any source. `{}` lists every link and citation; `point`, or `facet`
with `tree`, lists the records whose text links to that record; `uri` lists the
records that cite that exact source URI.

| INPUT field | Meaning |
| --- | --- |
| `point` | A Point ID: the records that link to it. |
| `facet` | A Facet ID, with `tree`: the records that link to it. |
| `tree` | The Tree that owns `facet`. |
| `uri` | An exact source URI, fragment included: the records that cite it. |
| `limit` | 1 to 10000. Default 1000 for `{}`, 100 otherwise. |

**Prints**, each with `status` (`ready`, or `unavailable` when the Atlas is
not valid) and `identity`:

- for `{}`, `atlas.references/1`: `references`, `citations`, `diagnostics`,
  `bounds` and `limits`;
- for `point` or `facet`, `atlas.citers/1`: `citers`, `bounds` and `limits`;
- for `uri`, `atlas.source-citations/1`: `uri`, `citations`, `bounds` and
  `limits`.

A record or URI that nothing cites gives `ready` with an empty list. The
entries are in [The reference index](sources.md#the-reference-index).

**Exit.** 1 when `status` is `unavailable`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `INVALID_REQUEST` | 2 | More than one of `point`, `facet` and `uri`; `facet` without `tree`, or `tree` without `facet`. |
| `atlas.references.invalid-argument` | 2 | `limit` out of range; an empty `uri`. |

### read-source

```text
atlas --root PATH [--allow-source-root PATH]... read-source URI
```

Reads one local source within the grants: the whole file, what `URI` cites in
it (the file, or the section its fragment names), and the hash of that
material. An HTTP(S) URI is returned as a reference and never fetched. A URI
carries no stamp, so the read compares none.

**Prints** the read, without a `format` key:

- `status`: `ready`, `missing`, `denied`, `incomplete`, `invalid`, or
  `reference` for an HTTP(S) URI.
- `source`: `{ uri }`.
- `code` and `message`: why, when not `ready`; a `reference` has `message`
  only.
- When `ready`: `path` (absolute), `content`, `bytes`, `sha256` (of the whole
  file), `cited` (what the URI cites, with its own `sha256`), `stamp` and
  `message`; and `code` `SOURCE_HEADING_MISSING` when the fragment names no
  heading.

A file over 1 MiB is `incomplete`. The statuses and codes are in
[Sources and stamps](sources.md).

**Exit.** 1 when `status` is `missing`, `denied`, `incomplete` or `invalid`.

**Refusals.** `CLI_INVALID_ARGUMENT`, exit 2, also for a URI that begins with
`-`.

### stale

```text
atlas --root PATH [--allow-source-root PATH]... stale [INPUT | --full]
```

Reads every local source within the grants and gives each source reference one
status: `current`, `changed`, `missing`, `denied`, `unstamped` or `remote`. By
default it prints how many references have each status, and each changed or
missing source once with the records that cite it. It rewrites nothing.

| Option | Meaning |
| --- | --- |
| `--full` | Also every reference, with its status and the reason for it. |

| INPUT field | Meaning |
| --- | --- |
| `limit` | 1 to 10000, default 100: summary entries per page, and with `full` references too. |
| `offset` | 0 to 10000, default 0. |
| `expectedIdentity` | The identity a continuation belongs to. |
| `full` | `true`: as `--full`. |

**Prints** `atlas.stale/1`:

- `status`: `ready`, or `unavailable` when the Atlas is not valid.
- `identity`.
- `counts`: `references` and one count for each status.
- `summary`: each changed or missing source as `{ uri, status, code?, citers }`.
- `references`: with `--full`, every reference with its status.
- `bounds`: the page, `unread` (references not read past the bound of 10000),
  `exhaustive`, and `next`, the INPUT of the next page or `null`.
- `limits`: what the statuses do not establish.

The statuses and the entries are in [Sources and stamps](sources.md); what a
changed source means is in
[Keeping an Atlas true](../explanation/keeping-it-true.md).

**Exit.** 0 whatever the report finds; 1 when `status` is `unavailable`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.references.invalid-argument` | 2 | `limit` or `offset` out of range. |
| `STALE` | 3 | `expectedIdentity` is not the identity of the Atlas now. |

### guide

```text
atlas guide
atlas guide spec|format|operations|project
```

Prints [Working with Atlas](../../spec/OPERATING.md), the guide for an
agent that reads or keeps an Atlas, or one of the documents it names, as
shipped: `spec` ([the specification](../../spec/SPEC.md)), `format`
([the format](../../spec/spec/FORMAT.md)), `operations`
([the operations](../../spec/spec/OPERATIONS.md)) or `project`
([the project workflow](../../spec/spec/PROJECT.md)).

**Prints** Markdown, not JSON.

**Exit.** 0.

**Refusals.** `CLI_INVALID_ARGUMENT`, exit 2, also for another name.

### styles

```text
atlas styles
atlas styles show ID
```

Lists the curated Styles, or prints one: the exact text that `init --style ID`
adopts as `style.md`. The Styles are described in the
[catalogue](../../styles/README.md), and why an Atlas keeps one in
[Styles](../explanation/styles.md).

**Prints.** `styles` prints `atlas.styles/1`: `styles`, each `{ id, title }`.
`styles show ID` prints the Style's Markdown, not JSON.

**Exit.** 0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | An ID that is not a curated Style (the message lists them); a word other than `show`. |
| `STYLE_UNAVAILABLE`, `STYLE_INVALID` | 1 | A curated Style file is missing or broken in the installation. |

## Change

A change is prepared and saved as a draft, reviewed, and applied at the exact
revision that was reviewed. Drafts, plans, the review, apply and recovery are
in [Changes](changes.md).

### init

```text
atlas --root PATH init --id ID --title TITLE --style STYLE
```

Prepares a new Atlas at `PATH` as a draft: `atlas.json` and `style.md`.
Nothing is written to `PATH` until the draft is applied. `PATH` is an existing
directory that holds no `atlas.json`. No Style is chosen for you.

| Option | Meaning |
| --- | --- |
| `--id ID` | Required: the ID of the Atlas. |
| `--title TITLE` | Required: its title, nonblank. |
| `--style STYLE` | Required: a curated Style ID (`atlas styles` lists them), or the path of a file that holds a complete Style, one H1 title and a body, of at most 2 MiB. A file whose name is a curated ID is given as `./NAME`. |

**Prints** the saved draft, as [`prepare`](#prepare) prints it. Its
`plan.reason` is `Initialize Atlas with its selected Style`.

**Exit.** 1 when the plan is `invalid`, for example for a Style file without
an H1 title; the draft is saved.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | A missing option (the message lists the curated Styles); a blank title; a `--style` that is neither a curated ID nor a file. |
| `INVALID_REQUEST` | 2 | An empty Style file. |
| `CLI_INPUT_LIMIT`, `CLI_INPUT_ENCODING` | 2 | A Style file over 4 MiB, or not UTF-8. |
| `LIMIT_EXCEEDED` | 1 | A Style file over 2 MiB (2097152 bytes); nothing is saved. |
| `ALREADY_EXISTS` | 1 | `PATH` holds `atlas.json`. |

### candidate

```text
atlas --root PATH candidate
```

Writes a fresh copy of the Atlas's records into `.atlas-candidate/` at the
Atlas root, as their exact bytes, after removing everything the folder held.
An invalid Atlas is copied as it is. Besides the folder it writes only in
the private state. It holds the Atlas's writer lock while it works, as
`apply` and `recover` do, so none of them runs at the same time; taking the
lock makes the private state's folder and `owner.json` when they are
missing, even when the command then refuses with `NOT_FOUND`, `UNSAFE_PATH`
or `INCOMPLETE`. It records the copy there: before it touches the folder, a
record that names no Atlas, and once the copy is whole, the identity of the
Atlas it copied with an ID of that copy. Readers never capture the folder.
The copy is edited with any file tools, then given to
`validate --from .atlas-candidate` and `prepare --from .atlas-candidate`;
both refuse it with `STALE` once the Atlas is no longer the one copied, or
when the folder was written again while they read it.

**Prints** `atlas.candidate/1`: `status` (`ready`), `path` (absolute),
`files` (how many were written) and `baseline` (the identity of the Atlas
copied).

**Exit.** 0.

**Refusals.** Every refusal below comes before anything in the folder is
removed. When the private state cannot take the record, the folder is left as
it was and the refusal carries the system's code, such as `EACCES`. A failure
once the folder is being emptied or copied leaves it partly written, and the
record then names no Atlas, so `validate --from` and `prepare --from` refuse
the folder until `candidate` writes it again.

| Code | Exit | When |
| --- | --- | --- |
| `UNSAFE_PATH` | 2 | The folder is a symbolic link or not a directory; it holds a symbolic link (`error.diagnostics` names each as `PATH_SYMLINK`); it and the private state lie inside one another. |
| `NOT_FOUND` | 1 | The root holds no `atlas.json`. |
| `INCOMPLETE` | 1 | The Atlas cannot be read completely. |
| `LIMIT_EXCEEDED` | 1 | The folder holds more than 40000 entries or is nested deeper than 64 levels. |
| `LOCKED` | 3 | Another writer holds the Atlas: an apply, a recover or another candidate (`Another Atlas writer is running.`); a writer that stopped during an unfinished transaction left its lock (`Interrupted transaction ID needs recovery.`); the lock's metadata cannot be read (`Lock metadata is unavailable; another writer may be acquiring or releasing it.`); or the lock is no longer this command's before it saves the record or empties the folder (`Writer lock changed.`). |

### validate

```text
atlas --root PATH validate
atlas --root PATH [--allow-source-root PATH]... validate --from DIR
```

Reads the Atlas and says whether it is valid. With `--from`, says what
`prepare --from DIR` would report of that candidate, and saves nothing; it
also lists the link diagnostics and the missing local sources that would
surface once the candidate is applied, which leave it `ready`.

| Option | Meaning |
| --- | --- |
| `--from DIR` | The candidate directory: `.atlas-candidate`, or any other directory outside the Atlas and the private state. |

**Prints** `atlas.validation/1`:

- `status`: `ready`, `invalid` or `incomplete`.
- `identity`: of the Atlas, or with `--from` of the Atlas the change would
  make.
- `diagnostics`: every one.
- With `--from`: `candidate` (the directory, absolute), `changes` (each
  `{ path, action }`, `action` `write` or `remove`), `ignored` (files that are
  not records and are left out), `linkDiagnostics`, `missingSources`,
  `unreadSources` (how many source references were not read: local ones
  outside the grants or unreadable, and every one past the 10000 references
  one stale report reads, whose missing sources are not listed), `bounds` (the
  counts of `linkDiagnostics` and `missingSources`, of which at most 100 each
  are listed) and `limits`. `diagnostics`, `changes` and `ignored` are whole.

A root that does not exist or holds no `atlas.json` is `invalid`, with one
`FILE_MISSING`. Validation of a candidate is in [Changes](changes.md).

**Exit.** 1 unless `status` is `ready`.

**Refusals.** With `--from`, those of [`prepare --from`](#prepare).

### prepare

```text
atlas --root PATH prepare INPUT
atlas --root PATH prepare --from DIR --reason TEXT
```

Prepares a change and saves it as a draft. It writes no authored file. INPUT
gives explicit file changes; `--from` gives a candidate directory that holds
the whole proposed Atlas, from which the changes are derived. The change is
validated whole. An invalid draft is saved so that it can be read, and cannot
be applied. A change that changes nothing saves a `noop` draft. A change that
alters a valid `style.md` together with another file is saved `invalid`, with
`STYLE_CHANGE_ALONE`.

| Option | Meaning |
| --- | --- |
| `--from DIR` | The candidate directory: `.atlas-candidate`, or any other directory outside the Atlas and the private state. Files in it that are not records are left out. |
| `--reason TEXT` | Required with `--from`: the reason that travels with the draft. |

| INPUT field | Meaning |
| --- | --- |
| `changes` | Required: at most 1000 entries `{ path, content }`, each path once. `path` is an authored record path relative to the Atlas root; `content` is the complete new text of the file, or `null` to remove it. |
| `reason` | Required, nonblank: what changed, what was removed and where its meaning now lives, and what is unresolved. |

**Prints** `atlas.draft/1`:

- `id`, `revision`, `updatedAt`: the saved draft. `apply` and `drafts delete`
  need the `id` and the exact `revision`.
- `plan`: `format` (`atlas.change/1`), `status` (`ready`, `invalid` or
  `noop`), `reason`, `baseline.identity` (the Atlas the change was prepared
  against), `validation` (`status`, `identity` and `diagnostics` of the Atlas
  the change would make) and `changes` (each `{ path, action, bytes }`); with
  `--from`, `ignored`.
- `bounds`: the counts of `changes` and `validation`, and with `--from` of
  `ignored`; at most 100 entries of each list are printed.

A plan in full is in [Changes](changes.md).

**Exit.** 1 when the plan is `invalid`; the draft is saved.

**Refusals.** Nothing is saved when it refuses.

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | `--from` without `--reason`, or the reverse. |
| `INVALID_REQUEST` | 2 | A missing or unknown INPUT field; more than 1000 `changes`; a path given twice; `content` that is neither text nor `null`; a blank reason; a candidate without `atlas.json` at its top. A change that writes what a reader would not read back: a path that aliases another under case or Unicode normalization, text with an unpaired surrogate, a file more than 64 folders below `points/`, `facets/` or `.checks/`, or more than 40000 directory entries listed under them (`READ_LIMIT`), an Atlas of more than 10000 files or 64 MiB. The message is `The change writes what a reader would not read back: PATH (CODE).`, and `error.diagnostics` holds the reader's diagnostics. A path that the change writes or the Atlas holds beneath a path that is a file: the message names both paths, and `error.diagnostics` is empty. |
| `UNSAFE_PATH` | 2 | A path that is not a normalized relative record path (`A change needs a normalized relative record path.`): one with `:`, `#`, `?`, `\`, a control character, an unpaired surrogate or a component that begins with `.atlas-` in any case; a path that is not an authored record. A candidate that does not exist, is a symbolic link, lies inside the Atlas other than as `.atlas-candidate`, contains the Atlas, or lies inside the private state. A candidate that holds a symbolic link or a file no record path admits; `error.diagnostics` names each. |
| `LIMIT_EXCEEDED` | 1 | A changed file over 2 MiB (`A changed file exceeds 2 MiB (2097152 bytes).`); a candidate that differs from the Atlas in more than 1000 files; a candidate over 40000 entries or 64 levels deep; a draft over 32 MiB. |
| `INCOMPLETE` | 1 | The Atlas or the candidate cannot be read completely. For a candidate, `error.diagnostics` names why, such as a file over 2 MiB (`READ_LIMIT`) or one that changed while it was read (`READ_CHANGED`). |
| `INVALID_CANDIDATE` | 1 | A candidate record that is not UTF-8; a change derived from the candidate that does not make the Atlas read from the directory. |
| `INVALID_STATE` | 1 | The private state's record of the `.atlas-candidate` copy is damaged (`Invalid candidate record.`). |
| `LOCKED` | 3 | The new draft's lock is no longer this command's before it saves the draft (`Draft lock changed.`). |
| `STALE` | 3 | The Atlas changed while the change was prepared. `.atlas-candidate` was copied from an earlier Atlas (`The Atlas changed since candidate wrote this copy; run candidate again and make the change in the fresh copy.`), or nothing records which Atlas it was copied from (`No record says which Atlas this copy was made from; run candidate again.`), or `candidate` wrote it again while it was read (the first message). |

### review

```text
atlas --root PATH review ID [INPUT | --full]
```

Prints the effects of a saved draft, read against the Atlas it was prepared
against: every record that is new, changed or removed and what changed in it,
the Points above each changed Point, the Facets that bear on it, the records
that mention it, link diagnostics, and whether the Style or a Check differs.
By default it prints a summary to read whole; `--full` prints the complete
records and why each related record was named.

| Option | Meaning |
| --- | --- |
| `--full` | The complete effects. |

| INPUT field | Meaning |
| --- | --- |
| `limit` | 1 to 1000, default 100: entries per list of the summary. |
| `offset` | Without `part`: where each list of the summary starts, 0 to 100000, default 0. With `part`: the byte offset of the chunk in the text, 0 to its `byteLength`, default 0. |
| `full` | `true`: as `--full`. |
| `part` | `"details"`: the complete result in [chunks](#conventions). |
| `maxBytes` | With `part`: 4 to 131072 bytes per chunk, default 65536. |
| `expectedSha256` | With `part`: the `sha256` of the text being continued. |

**Prints** `atlas.draft-review/1`:

- `status`: `ready`, or `unavailable` when the Atlas the draft would make is
  not valid.
- `draft`: `id`, `revision`, `updatedAt`, `status`, `reason`, `baseline`,
  `candidate` (the identity the draft would make), `stale` (`true` when the
  Atlas changed since the draft was prepared), and `diagnostics` when the
  draft is invalid.
- `effects`: `atlas.impact-summary/1`; with `--full`, `atlas.impact-review/1`.
  When `unavailable`, its `reason` and `diagnostics`.
- `bounds`, `next` and `details`: the summary's counts, the INPUT of its next
  page or `null`, and how to read the whole. `--full` prints none of them.

With `part`, a chunk. The fields of the effects are in [Changes](changes.md).

**Exit.** 1 when `status` is `unavailable`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.review.invalid-argument` | 2 | `limit` or `offset` out of range. |
| `atlas.inventory.invalid-argument` | 2 | `maxBytes` out of range; a chunk `offset` outside the text or inside a character. |
| `STALE_REPORT` | 1 | `expectedSha256` is not the `sha256` of the text now. |
| `NOT_FOUND` | 1 | No draft has this ID. |
| `INVALID_STATE`, `INVALID_PLAN` | 1 | The saved draft is damaged. |

### apply

```text
atlas --root PATH apply ID --revision REVISION
```

Writes a saved draft to the Atlas, at the exact revision that was reviewed. A
completed apply removes the draft, then its transaction's journal; when the
draft cannot be removed, it is kept and the journal stays, `complete`. A
`noop` or interrupted apply keeps the draft. While a transaction of the Atlas
is unfinished, no draft is applied until `recover` rolls it back, and none is
applied while the Atlas does not read whole.

| Option | Meaning |
| --- | --- |
| `--revision REVISION` | Required: the draft's `revision`, 64 lowercase hexadecimal characters. |

**Prints** `atlas.apply/1`:

- `status`: `complete`, `noop` or `interrupted`.
- `identity`: the Atlas's identity after the apply; absent when `interrupted`.
- `transaction`: the ID of the apply's transaction, which `recover` takes;
  `null` for `noop`.
- `draft`: `removed`, or `kept` (also after a completed apply whose draft
  could not be removed).
- `written` and `error`: when `interrupted`, the paths written and
  `{ code, message }`, such as `STALE` for a file changed after the
  transaction began or `CONCURRENT_CHANGE` when the Atlas read back is not the
  one the draft makes.

The journal and what an interrupted apply leaves are in [Changes](changes.md).

**Exit.** 1 when `status` is `interrupted`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | `--revision` missing, or not 64 hexadecimal characters. |
| `STALE_DRAFT` | 3 | The draft is not at that revision (`The draft is not at that revision; review it and give its exact revision.`). |
| `STALE` | 3 | The Atlas, or a file the draft changes, is not what the draft was prepared against. Nothing is written. |
| `LOCKED` | 3 | Another writer holds the Atlas, an apply, a recover or a candidate (`Another Atlas writer is running.`), or the draft (`Another writer is using this draft.`); a lock's metadata cannot be read (`Lock metadata is unavailable; another writer may be acquiring or releasing it.`); a lock is no longer this command's before it saves the journal, writes a file or removes the draft (`Writer lock changed.`, `Draft lock changed.`). A transaction of the Atlas is unfinished, its journal `prepared`, `applying`, `interrupted` or `rolling-back` (`Interrupted transaction ID needs recovery.`), whatever draft is applied. |
| `INVALID_CANDIDATE` | 1 | The draft's plan is `invalid`: the Atlas it would make is not valid, or it alters the Style together with another file. |
| `NOT_FOUND` | 1 | No draft has this ID. |
| `INVALID_STATE`, `INVALID_PLAN` | 1 | The saved draft is damaged. A transaction journal is not whole, or not the journal of the transaction its file names (`Invalid transaction journal: ID.`), or cannot be read: `Transaction journal ID cannot be read: REASON`, with the code of the reason, such as `INVALID_STATE` for one that is not JSON (`Saved state is malformed.`) or `UNSAFE_PATH` for a symbolic link. A `.json` file whose name is no transaction identity, and any other file, stops nothing. |
| `LIMIT_EXCEEDED` | 1 | The transactions folder holds more than 10000 `.json` records (`Too many saved records.`). |
| `INCOMPLETE` | 1 | The Atlas cannot be read completely (`Cannot apply against an incomplete read.`), whatever draft is applied. |

### drafts

```text
atlas --root PATH drafts [list]
atlas --root PATH drafts show ID [INPUT | --full]
atlas --root PATH drafts delete ID --revision REVISION
```

Lists the saved drafts, prints one, or deletes one by its exact revision. A
draft keeps the baseline it was prepared against and survives restarts.

| Option | Meaning |
| --- | --- |
| `--full` | `show`: the saved draft whole, every byte. |
| `--revision REVISION` | Required for `delete`: the draft's exact `revision`. |

| INPUT field | Meaning |
| --- | --- |
| `limit` | `show`: 1 to 100, default 50: entries per list. |
| `offset` | `show` without `part`: where each list starts, 0 to 100000, default 0. With `part`: the byte offset of the chunk in the text, 0 to its `byteLength`, default 0. |
| `full` | `true`: as `--full`. |
| `part` | `"details"`: the saved draft in [chunks](#conventions). |
| `maxBytes` | With `part`: 4 to 131072 bytes per chunk, default 65536. |
| `expectedSha256` | With `part`: the `sha256` of the text being continued. |

**Prints.**

- `list`: `atlas.drafts/1`, with `drafts`, each
  `{ id, revision, updatedAt, reason, status, baseline }`, every saved draft
  that loads; and `unreadable`, each `{ file, code, message }`, every `.json`
  file of the drafts folder that does not, by its file name with the code and
  message loading it gives (`INVALID_STATE` with `Saved state is malformed.`, `Invalid draft.`,
  `Saved draft integrity failed.` or `The file name is not a draft identity.`;
  `INVALID_PLAN`; `INVALID_REQUEST`; `UNSAFE_PATH`; `LIMIT_EXCEEDED`; a system
  code). Other files are not listed. An unreadable draft leaves the exit 0.
- `show`: `atlas.draft/1`, as [`prepare`](#prepare) prints it without
  `plan.ignored` and `bounds.ignored`, and with `plan.candidate` (a summary of
  the Atlas the change would make, as [`inspect`](#inspect) prints one) and
  `details`. `--full` prints `format`, `id`, `updatedAt`, `plan` and
  `revision`: the saved draft. With `part`, a chunk.
- `delete`: `status` (`deleted`) and `id`.

**Exit.** `show` exits 1 when the plan is `invalid`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | A word other than `list`, `show` and `delete`; `delete` without a valid `--revision`. |
| `atlas.inventory.invalid-argument` | 2 | `limit`, `offset` or `maxBytes` out of range. |
| `STALE_DRAFT` | 3 | `delete` names another revision (`The draft is not at that revision; load it and give its exact revision.`). |
| `LOCKED` | 3 | `delete`: another writer is using the draft (`Another writer is using this draft.`); its lock's metadata cannot be read (`Lock metadata is unavailable; another writer may be acquiring or releasing it.`); or the lock is no longer this command's before it removes the draft (`Draft lock changed.`). |
| `STALE_REPORT` | 1 | `expectedSha256` is not the `sha256` of the text now. |
| `NOT_FOUND` | 1 | No draft has this ID. |
| `INVALID_STATE` | 1 | `show` or `delete`: the saved draft is damaged. |
| `LIMIT_EXCEEDED` | 1 | `list`: more than 10000 `.json` records in the drafts folder; locks and temporary files are not counted. |

### recover

```text
atlas --root PATH recover [TRANSACTION_ID]
```

Without an ID, lists the apply transactions whose journals remain. A journal
is kept only while its transaction is unfinished: a completed apply and a
rollback each remove it. So these are the unfinished transactions, and a
finished one, `complete` or `rolled-back`, whose journal could not be removed.
With an ID, rolls back an interrupted apply: each file of the change that holds
its original or its proposed bytes, whoever wrote them, gets its original
bytes back, and any other content refuses the rollback; then it removes its
journal; a
`rolled-back` journal that was left is removed. A rollback is not a
completion; the draft can be applied again once the rollback has restored the
Atlas it was prepared against (`baselineRestored`).

**Prints.**

- Without an ID, `atlas.transactions/1`: `transactions`, each
  `{ id, phase, createdAt, baseline, result, written, error? }`; and
  `unreadable`, each `{ file, code, message }`, every `.json` file of the
  transactions folder that does not load as a journal, by its file name with
  the code and message reading it gives (`INVALID_STATE` with
  `Saved state is malformed.`, `Invalid transaction journal.` for one that is
  not whole, in a phase of its own and with each change and summary field in
  its shape, or `The file name is not a transaction identity.`;
  `UNSAFE_PATH`; `LIMIT_EXCEEDED`; a system code). Other files are not listed.
- With one, `atlas.recovery/1`: `status` (`rolled-back`), `transaction`,
  `identity`, `baselineRestored` (`true` when the Atlas reads back whole, not
  `incomplete`, at the identity the apply started from) and `diagnostics`. A
  `rolled-back` journal that was left prints `status` and `transaction` only,
  and is removed.

Recovery is in [Changes](changes.md).

**Exit.** 0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `RECOVERY_CONFLICT` | 3 | A file of the change holds neither its original nor its proposed bytes. |
| `LOCKED` | 3 | Another writer holds the Atlas: an apply, a candidate or another recover (`Another Atlas writer is running.`); a writer that stopped during another unfinished transaction left its lock (`Interrupted transaction ID needs recovery.`); the lock's metadata cannot be read; or the lock is no longer this command's before it restores a file (`Writer lock changed.`). |
| `ALREADY_COMPLETE` | 1 | The transaction completed and its journal stayed, as when its draft could not be removed, so there is nothing to roll back. |
| `NOT_FOUND` | 1 | No journal has this ID, as after a completed apply or a rollback, each of which removes its journal (`Saved state does not exist.`). |
| `INVALID_STATE` | 1 | The transaction's journal is damaged, or not whole (`Invalid transaction journal.`). |
| `LIMIT_EXCEEDED` | 1 | Without an ID: more than 10000 `.json` records in the transactions folder. |

### move

```text
atlas --root PATH move INPUT
```

Prepares the move of one Point or Facet file within its Tree, with the path
links to and from it repaired, and saves it as a draft. IDs do not change. The
files whose links are repaired are part of the change. Moving a file is in
[Sources and stamps](sources.md).

| INPUT field | Meaning |
| --- | --- |
| `point` | The Point to move. |
| `facet` | The Facet to move, with `tree`. |
| `tree` | The Tree that owns `facet`. |
| `path` | Required: the new path relative to the Atlas root, in the same Tree folder and of the same kind. |
| `reason` | Required: the reason that travels with the draft. |

**Prints** the saved draft, as [`prepare`](#prepare) prints it.

**Exit.** 1 when the plan is `invalid`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.references.invalid-argument` | 2 | Not exactly one Point, or one Facet with its Tree, or an unknown field; no `path` or `reason`; a record that does not exist; a path outside the record's Tree folder or kind, or not a normalized Markdown path; a destination that exists, or differs from the record's path only in case; a link that cannot be repaired safely (the message names its file and line); an Atlas that is not valid. |
| `LIMIT_EXCEEDED` | 1 | A file whose repaired links would make it larger than 2 MiB. Nothing is saved. |

### stamp

```text
atlas --root PATH [--allow-source-root PATH]... stamp (--point ID... | --tree ID | --all) [--reason TEXT]
```

Prepares a change that writes, into the source references of the selected
records, the hash of the material each one cites now, and saves it as a draft.
Nothing is stamped until the draft is applied. Only local sources readable
within the grants are stamped; the others are reported and keep the stamps
they had.

| Option | Meaning |
| --- | --- |
| `--point ID` | A Point and the Facets attached to it. Repeatable, each Point once. |
| `--tree ID` | Every Point and Facet of one Tree. |
| `--all` | Every record. |
| `--reason TEXT` | The reason of the draft. Default `Record the sources as read`. |

One kind of selection is given: `--point`, `--tree` or `--all`.

**Prints** `atlas.stamp/1`:

- `status`: `ready`, or `noop` when nothing needs a stamp.
- `identity`, and `selection` as given.
- `counts`: `records`, `stamped`, `current` and `skipped`.
- `stamped`, `current`, `skipped`: the references to be stamped, already
  current, and not stamped, at most 100 of each.
- `limits` and `bounds`.
- `draft`: the saved draft, as [`prepare`](#prepare) prints it, or `null`
  when `noop`, in which case nothing is saved.

Stamps are in [Sources and stamps](sources.md); when to stamp, in
[Keeping an Atlas true](../explanation/keeping-it-true.md).

**Exit.** 0 for `ready` and for `noop`.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.references.invalid-argument` | 2 | No selection, or more than one kind; a Point or Tree that does not exist; a Point given twice; a blank reason. |
| `INVALID_VIEW` | 1 | The Atlas is not valid. |
| `LIMIT_EXCEEDED` | 1 | More than 1000 records need a stamp; a record the stamps would make larger than 2 MiB (`A changed file exceeds 2 MiB (2097152 bytes).`). Nothing is saved. |

### absorb

```text
atlas --root PATH absorb INPUT
```

Inspects incoming material against the Atlas: the Points it may belong with,
the Trees that could own it and the Facets that bear on those Points. It
prepares nothing; the author decides what the material changes, as the
[operations](../../spec/spec/OPERATIONS.md#absorb) say.

| INPUT field | Meaning |
| --- | --- |
| `text` | Required: the incoming material, nonblank, at most 1048576 characters. |
| `source` | Required: its source reference, `{ uri, title?, role?, revision?, locator?, sha256? }`. |
| `tree` | Only this Tree. |
| `limit` | 1 to 100, default 8. |

**Prints** `atlas.absorb-inspection/1`:

- `status`: `candidates`, `no-candidates`, `missing` (no Tree has the ID
  `tree`) or `unavailable` (the Atlas is not valid).
- `identity`, and `incoming`: `{ text, source }` as given.
- `candidates`: each `{ point, reasons }`, a Point the material may belong
  with and why it was found.
- `owners`: each `{ tree, base, reasons }`, a Tree that could own it.
- `interpretations`: each `{ facet, reasons }`, a Facet that bears on those
  Points.
- `limits`: what the inspection does not establish.
- `style`: the Atlas's Style, `{ title, body, path }`.
- `terms`: the words of the material that were searched.
- `bounds`: `limit`, `searchWindow`, `candidateWindowCount`,
  `searchExhaustive`, and the counts of `owners` and `interpretations`.
- `reason`: when `missing` or `unavailable`, in place of `style`, `terms` and
  `bounds`; `diagnostics` when `unavailable`.

**Exit.** 1 when `status` is `missing` or `unavailable`; `no-candidates` exits
0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `atlas.absorb.invalid-argument` | 2 | A missing or blank `text`; a missing or invalid `source`; an unknown field; `limit` out of range. |

## Set up and publish

### config

```text
atlas config [PROJECT] [--atlas PATH] [--allow-source-root PATH]... [--state-home PATH]
atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] config
```

Prints the configuration that connects an agent host to an Atlas through the
MCP server, with its root, its source grants and, when one is set, its state
location. The
project form selects the Atlas as `open` does and grants the project
directory; when the project holds no Atlas, the root is the project directory.
The Atlas form grants the Atlas root and the roots given. It changes no host
settings: the configuration is installed through the host, as
[Connect an agent](../how-to/connect-an-agent.md) shows.

| Option | Meaning |
| --- | --- |
| `--atlas PATH` | Project form: the project-relative directory of the Atlas, or `.` for the project itself. |
| `--allow-source-root PATH` | Project form: one more directory the server may read cited sources from. Repeatable. |
| `--state-home PATH` | Project form: the state location the server is given. |

**Prints** `mcpServers.atlas`: `command` (the Node that ran the CLI), `args`
(the MCP server, `--root` and the Atlas root, and `--allow-source-root` with
each other granted directory) and `env.ATLAS_STATE_HOME` when a state location
was set. Each field is in [Configuration](configuration.md).

**Exit.** 0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | An option the form does not take; any argument after `config` in the Atlas form. |
| `PROJECT_INVALID`, `PROJECT_AMBIGUOUS`, `PROJECT_DISCOVERY_LIMIT` | 2 | Project form: as for [`open`](#open). |
| `PROJECT_CHANGED` | 3 | Project form: the selection changed while it was read. |

### state

```text
atlas --root PATH [--state-home PATH] state [inspect]
```

Says where the drafts and recovery journals of this Atlas are kept. It creates
nothing.

**Prints** `atlas.state-inspection/1`: `state`, with `root` (the Atlas root,
absolute), `directory` (the Atlas's state directory), `exists`, and `owner`
(the ownership record, or `null` before the directory exists). What the state
holds is in [Changes](changes.md); where it lives, in
[Configuration](configuration.md).

**Exit.** 0.

**Refusals.** `CLI_INVALID_ARGUMENT`, exit 2, also for a word other than
`inspect`.

### mcp

```text
atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] mcp
```

Runs the MCP server for this Atlas on standard input and output until standard
input closes. The root, the source grants and the state location are fixed for
the session. It is the server `config` configures.

**Prints** MCP protocol messages only. The transport, the session and the
tools are in [The MCP server](mcp.md).

**Exit.** 0 when standard input closes.

**Refusals.** Only those every command shares, before the server starts:
`CLI_INVALID_ARGUMENT` for a blank grant or more grants than the limit, and
`INVALID_SCOPE` for a grant over 4096 characters. Once it runs, a tool's
refusal is a tool result, not an exit code
([Results and errors](mcp.md#results-and-errors)).

### export

```text
atlas --root PATH [--allow-source-root PATH]... export OUT (--tree ID... | --all) [--source-base URL]
```

Writes the Portal as static pages into the folder `OUT` for the selected
Trees. It never expands through Facets or links: targets in Trees outside the
selection are marked as not included. Source bodies are never copied. `OUT`
comes first; it must not exist, or must be a previous export, whose files are
then replaced; a file the previous export did not write is left as it is
([The export folder](portal.md#the-export-folder)).

| Option | Meaning |
| --- | --- |
| `--tree ID` | A Tree to include. Repeatable, each Tree once. |
| `--all` | Every Tree. Give `--tree` or `--all`, not both. |
| `--source-base URL` | The HTTP(S) address at which the Atlas root can be browsed; local source references then link there. |

**Prints** `atlas.export/2`:

- `atlas`: the Atlas's ID; `identity`.
- `trees`: the Trees exported.
- `sourceBase`: the address given, without its query and fragment and with a
  closing `/`; or `null`.
- `status`: `complete`.
- `output`: `OUT`, absolute.
- `points`, `facets`: how many of each were written.
- `replaced`: `true` when a previous export was replaced.

The folder, its marker and its pages are in [The Portal](portal.md).

**Exit.** 0.

**Refusals.**

| Code | Exit | When |
| --- | --- | --- |
| `CLI_INVALID_ARGUMENT` | 2 | No `OUT`, or `OUT` after an option. |
| `SELECTION_REQUIRED` | 2 | Neither `--tree` nor `--all`; both; a Tree named twice. |
| `SELECTION_UNKNOWN` | 2 | A Tree the Atlas does not have. |
| `INVALID_SOURCE_BASE` | 2 | A source base that is not HTTP(S), or carries credentials. |
| `EXPORT_OVERLAP` | 2 | `OUT` inside the Atlas, the private state or the Atlas application. |
| `EXPORT_EXISTS` | 3 | `OUT` exists and is not an export. |
| `EXPORT_CONFLICT` | 3 | A previous export holds, where this export writes, a file it did not write. |
| `INVALID_ATLAS` | 1 | No Atlas is kept at the root; or it does not validate, and `error.diagnostics` lists why. |
| `EXPORT_PARTIAL` | 1 | The export was interrupted while it removed a previous export's files or moved its pages into `OUT`, a first export included. |

## Help

### help

```text
atlas --help
atlas help [COMMAND]
atlas COMMAND --help
atlas --version
```

Prints every command with its usage, or one command with its options, its
INPUT fields and what it prints. `atlas` without arguments prints the same as
`atlas --help`. It needs no `--root`; `help` and `COMMAND --help` are also
accepted after `--root PATH`.

| Option | Meaning |
| --- | --- |
| `--help` | Every command, or after a command that command. `-h` is the same. |
| `--version` | The version. |

**Prints.**

- Every command: `usage`, `options`, `input`, `output`, `exit` and
  `commands`, each `{ command, usage, does }` with `INPUT` where the command
  takes one.
- One command: `command`, `usage`, `does`, and `INPUT`, `options`, `input`
  and `prints` where it has them.
- `--version`: `atlas.version/1`, with `version`.

**Exit.** 0.

**Refusals.** `CLI_INVALID_ARGUMENT`, exit 2, also for a command that does
not exist.
