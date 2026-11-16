# Configuration

What a launch of Atlas fixes: where private state lives, which directories
cited sources may be read from, which Atlas a project selects, and the
configuration that connects an agent host. Nothing in an Atlas changes any of
these. Why is in [What Atlas may read and write](../explanation/access.md). The
rules for selecting an Atlas are the
[project workflow's](../../spec/spec/PROJECT.md).

## Private state

Each Atlas's drafts and recovery journals are kept outside it, under one state
home for the user.

| Platform | State home |
| --- | --- |
| macOS | `~/Library/Application Support/Atlas` |
| Windows | `%LOCALAPPDATA%\Atlas` when `LOCALAPPDATA` is an absolute path, else `AppData\Local\Atlas` in the user's home directory |
| Any other | `$XDG_STATE_HOME/atlas` when `XDG_STATE_HOME` is an absolute path, else `~/.local/state/atlas` |

`ATLAS_STATE_HOME` names another state home. It must be an absolute path; an
empty or relative value is refused with `INVALID_STATE_HOME`: "ATLAS_STATE_HOME
must be an absolute directory." The CLI's `--state-home PATH` sets it for one
command, PATH taken from the working directory. It is given after `--root PATH`,
or after PROJECT for `open` and `config`. The MCP server takes the state home
from `ATLAS_STATE_HOME` alone; [`atlas config`](#agent-configuration) writes it
into the configuration's `env` when one is set.

Within the state home, each Atlas has the folder `atlases/<hash>`, where
`<hash>` is the SHA-256, in lowercase hexadecimal, of the real path of the
Atlas root. The folder holds `owner.json`,
`{ "format": "atlas.state/1", "root": ROOT }`, which binds it to that root. It
is created when it is first needed, with the folders on its path, each with
mode `0700`. `owner.json`, `candidate.json` and every draft, journal and lock
file in it have mode `0600`; the folders that hold drafts and journals are
made with the default mode, inside the `0700` folder. What it holds is in
[Changes](changes.md#private-state).

| Refusal | When |
| --- | --- |
| `UNSAFE_STATE` | the state home lies inside the Atlas: "Private state must be outside the Atlas." |
| `UNSAFE_STATE` | a folder on the path to the Atlas's folder, from the filesystem root, is a symbolic link or not a directory: "Private state requires regular directories without symbolic links." On macOS this refuses a state home under `/tmp`, which is a symbolic link. |
| `STATE_OWNER` | `owner.json` names another root or another format, or the folder has no `owner.json`; only an empty folder is adopted, when state is first written |
| `STATE_OWNER` | `owner.json` is not UTF-8 JSON, an empty file included: "Private state has invalid ownership metadata." |

Every command and tool that keeps private state or reads sources checks the
state location before it reads anything, creating nothing, and refuses with
`INVALID_STATE_HOME` or a code above; the others run. The CLI checks at
launch, the MCP server once as its session starts, and its tools then refuse.
Which commands and tools they are is in [Conventions](cli.md#conventions) and
[Launch](mcp.md#launch). The Library's `checkStateLocation(root)` makes the
same check and returns the location as `state` reports it below.

[`atlas state`](cli.md#state) reports where the Atlas's state is and creates
nothing:

```json
{
  "format": "atlas.state-inspection/1",
  "state": {
    "root": "ROOT",
    "directory": "HOME/atlases/28892dec…",
    "exists": true,
    "owner": { "format": "atlas.state/1", "root": "ROOT" }
  }
}
```

`exists` is `false` and `owner` `null` until the folder has been made.

Private state is never source material, and it cannot hold a candidate or an
export.

## Source grants

A source grant is a directory from which the local sources an Atlas cites may
be read. The Atlas root is always granted. Grants are fixed at launch:

| Launch | Granted |
| --- | --- |
| `atlas --root PATH --allow-source-root DIR ... COMMAND` | the Atlas root and each DIR |
| `atlas open [PROJECT]`, `atlas config [PROJECT]` | the selected Atlas root, the project directory, and each `--allow-source-root DIR` |
| the MCP server, `--root PATH --allow-source-root DIR ...` | the Atlas root and each DIR, for the whole session |

`--allow-source-root` is repeatable. In the first form it stands after
`--root PATH` and before the command, in any order with `--state-home`. Each
DIR is taken from the working directory.

At most 100 distinct directories are granted, the Atlas root among them, and
a directory given more than once is one grant: 99 more after `--root`, and 98
more in the project form when the Atlas is not the project directory itself.
More is refused with "At most 100 distinct source roots, including the Atlas
root, may be granted.": by the CLI, `atlas mcp` included, with
`CLI_INVALID_ARGUMENT`; by `atlas-agent`, the MCP server's own program, on
standard error with exit code 1 and no code. A grant longer than 4096
characters, as resolved, is refused at launch with "Source grants must be
directory paths of at most 4096 characters, without NUL characters.": by every
CLI command, `atlas mcp` included, with `INVALID_SCOPE` and exit code 1; by
`atlas-agent` on standard error with exit code 1. A grant of white space only
is refused by the CLI, for every command, with `CLI_INVALID_ARGUMENT`, and by
`atlas-agent` with the same message as a long one ([Launch](mcp.md#launch)).

A grant permits these reads and nothing else: `read-source`, `stale`, `stamp`
and the sources `validate --from` checks, their MCP tools, the source marks and
source pages of the Portal, and the marks of an export. `atlas mcp` passes the
grants to the server, and `atlas config` writes them into the configuration.
Through the MCP server a grant also admits a candidate directory: a candidate
must be `.atlas-candidate` or an absolute path within a grant
(`CANDIDATE_DENIED`). A source is read within the grant that holds it:

- by its real path, and never through a symbolic link;
- outside every grant, it is not read (`SOURCE_DENIED`);
- in private state, or on a path with a component that begins `.atlas-`, it is
  not read even inside a grant (`SOURCE_RESERVED`);
- a grant that does not exist grants nothing;
- an HTTP(S) source is never fetched.

How each source then stands is in
[The stale report](sources.md#the-stale-report).

## The workspace file

A project can name its Atlas in `atlas.workspace.json` at the project root:

```json
{ "format": 1, "atlasPath": "context" }
```

- The name is exact: a file whose name differs only in case is refused.
- It is a regular file, not a symbolic link, of at most 64 KiB.
- It is strict UTF-8 JSON, without duplicate keys.
- It holds exactly `format`, which is `1`, and `atlasPath`.
- `atlasPath` is `.` for the project itself, or a project-relative directory
  path: NFC, with no `\`, `:` or control characters, not absolute, and no part
  empty, `.` or `..`. Each part must exist with that exact spelling, as a
  directory and not a symbolic link.

Every breach is refused with `PROJECT_INVALID`. A file that changes while it
is read is refused with `PROJECT_CHANGED`. The file is read and its form
checked even when `--atlas` selects another path.

## Discovery

[`atlas locate [PROJECT] [--atlas PATH]`](cli.md#locate) reports which Atlas a
project selects. `open` and `config` select the same way. PROJECT defaults to
the working directory. The selection is, in order:

1. `--atlas PATH`, a path with the rules of `atlasPath`: source `explicit`;
2. `atlas.workspace.json`: source `workspace`;
3. discovery: source `discovery`.

Discovery walks the project from its root, each directory's entries in name
order:

- A directory that holds `atlas.json` is a candidate, and nothing under it is
  searched. An explicit path can select an Atlas nested under another.
- An `atlas.json` spelled in another case, or one that is not a regular file,
  is refused with `PROJECT_INVALID`: "Unsafe or incorrectly spelled atlas.json
  in DIR."
- It enters only directories. It skips every name that begins with `.`,
  `node_modules`, `vendor`, `dist`, `build`, `coverage`, `tmp` and `temp`, and
  every symbolic link.
- It lists at most 20000 entries in all, and enters directories down to 12
  levels below the project. Reaching either limit is refused with
  `PROJECT_DISCOVERY_LIMIT`. `--atlas PATH` selects an Atlas without
  discovery.

`locate` prints:

| Key | Holds |
| --- | --- |
| `format` | `atlas.project/1` |
| `project` | the project directory's real path |
| `source` | `explicit`, `workspace` or `discovery` |
| `candidates` | `{ path, root }` for each Atlas found: its project-relative path and its absolute path |
| `visited` | after a discovery, how many entries it listed |

`locate` lists every candidate and chooses none. `open` and `config` go on:

- One candidate is selected.
- No candidate selects the project directory itself. `open` then serves it,
  and the Portal names the command that creates an Atlas.
- Several candidates are put to a choice when standard input and standard
  error are terminals: "Choose an Atlas:", the numbered paths, then
  "Selection: ". Otherwise they are refused with `PROJECT_AMBIGUOUS`: "Choose
  an Atlas with --atlas PATH:" and the paths.

After the choice the project, the workspace file and the chosen directory are
checked again. A change is refused with `PROJECT_CHANGED`: "Project or Atlas
selection changed; retry opening."

## Agent configuration

[`atlas config`](cli.md#config) prints the configuration that connects an agent
host to an Atlas through the MCP server, to install through that host. It
writes nothing and changes no host settings.

| Form | `--root` | Grants |
| --- | --- | --- |
| `atlas config [PROJECT] [--atlas PATH] [--allow-source-root PATH]... [--state-home PATH]` | the Atlas the project selects, as `open` selects it; the project directory when discovery finds none | the project directory, unless it is the Atlas root, then each PATH |
| `atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] config` | PATH | each `--allow-source-root` |

It prints `mcpServers.atlas`:

| Key | Holds |
| --- | --- |
| `command` | the path of the Node that ran `atlas config` |
| `args` | the MCP server's script, `--root` and the Atlas root, and `--allow-source-root` with each grant other than the root |
| `env` | `ATLAS_STATE_HOME`, as an absolute path, only when a state home was set by `--state-home` or the environment |

```json
{
  "mcpServers": {
    "atlas": {
      "command": "NODE",
      "args": ["PACKAGE/apps/agent/src/server.mjs", "--root", "PROJECT/context", "--allow-source-root", "PROJECT"],
      "env": { "ATLAS_STATE_HOME": "HOME" }
    }
  }
}
```

## Environment variables

| Variable | Read by | Effect |
| --- | --- | --- |
| `ATLAS_STATE_HOME` | the CLI, the MCP server, the Portal, the Library | the state home; absolute, or refused. `--state-home` sets it. When it is set, the commands the Portal prints name `--state-home`. |
| `XDG_STATE_HOME` | the Library, outside macOS and Windows | the parent of the default state home, when absolute |
| `LOCALAPPDATA` | the Library, on Windows | the parent of the default state home, when absolute |
| `NODE_OPTIONS`, `NODE_PATH` | the launchers in a runtime bundle's `bin/` | cleared before the bundled Node starts |
