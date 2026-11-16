# Connect an agent

Use this guide when an agent should read or keep an Atlas.

The agent reaches the Atlas through Atlas's MCP server, which its host starts
for that one Atlas. You print the configuration that starts it, add it to the
host and ask the agent what it sees. Here `PROJECT` is the project's directory
and `ATLAS` the Atlas's folder in it. From a source checkout the command is
`pnpm atlas`, run from the repository root
([Install Atlas](install.md#from-the-source-checkout)).

## Print the configuration

```sh
atlas config PROJECT
```

It prints one MCP server entry, `mcpServers.atlas`, with `command`, `args` and,
when you set a state location, `env`. The lines that matter are in `args`:
`--root` names the Atlas the project selects, as `atlas open` selects it, and
`--allow-source-root` grants the project's directory, so the agent can read the
files the Atlas cites:

```text
        "--root",
        "PROJECT/atlas",
        "--allow-source-root",
        "PROJECT"
```

Every path is printed absolute. `command` is the Node that ran `atlas config`,
and the first of `args` is the MCP server's file in your installation. Nothing
is written, and no host setting changes.

To let the agent read another directory the Atlas cites, add
`--allow-source-root DIR` after `PROJECT`. To grant the Atlas alone, run
`atlas --root ATLAS config`. When the Atlas or the project moves, or Node or
your installation of Atlas moves to another path, print the configuration
again and replace the entry. What a launch
grants, and why nothing in an Atlas can widen it, is in
[What Atlas may read and write](../explanation/access.md); the options are in
[`config`](../reference/cli.md#config), and each field in
[Agent configuration](../reference/configuration.md#agent-configuration).

## Add it to your agent host

A host starts a local MCP server from an entry of three parts: the command, its
arguments and its environment. Copy `command`, `args` and `env` into the host's
entry for a local (stdio) server named `atlas`. A host whose settings hold an
`mcpServers` map takes the printed `atlas` entry into that map; the whole
printed object, `{ "mcpServers": { "atlas": … } }`, goes in as it is only
where the settings have no such map yet.

Two hosts add the entry with one command. Below, `NODE` is the printed
`command` and `SERVER` the first of `args`; the rest of `args` follows in
order.

- **Claude Code.** Run it in `PROJECT`: the entry then belongs to that project,
  for you alone.

  ```sh
  claude mcp add atlas -- NODE SERVER --root PROJECT/atlas --allow-source-root PROJECT
  ```

  When the configuration has `env`, add `-e ATLAS_STATE_HOME=VALUE` after
  `atlas`. `claude mcp list` shows the entry and whether it connects.

- **Codex.**

  ```sh
  codex mcp add atlas -- NODE SERVER --root PROJECT/atlas --allow-source-root PROJECT
  ```

  When the configuration has `env`, add `--env ATLAS_STATE_HOME=VALUE` after
  `atlas`. Codex keeps the entry in `~/.codex/config.toml`, for every project,
  so give each Atlas's entry a name of its own. `codex mcp list` shows it.

If the host starts its servers only when a session begins, start a new
session.

## Check the connection

Ask the agent:

> Read the Atlas guide, then open the Atlas. Tell me which Atlas tools you
> have, and the Atlas's title, its Style and its Trees.

The agent reads the guide with `atlas_guide` and opens the Atlas with
`atlas_open`, as the server's own instructions tell it. It should name 22 tools
whose names begin with `atlas_`, and report what `atlas_open` returned: the
status `ready`, the title (`"title": "Notes app"` for the Atlas started in
[Start an Atlas](start-an-atlas.md)), its Style and its Trees. For each Tree,
`atlas_outline` gives the outline of its Points by title. For an Atlas with no
Trees yet, `atlas_outline` reports `ready` with `"trees": []`.

If the agent names no `atlas_` tool, the host has not started the server, has
not finished connecting it, or does not offer its tools: look at the entry and
its state in the host's list of servers, check the paths in it, and check
whether the host's permissions allow the server's tools. Every tool is in
[The MCP server](../reference/mcp.md).

## Without MCP

An agent that works in a shell can run the `atlas` command instead. The
commands are the same operations under the same names
([The tools and the CLI](../reference/mcp.md#the-tools-and-the-cli)). Print the
guide it is to read, [Working with Atlas](../../spec/OPERATING.md):

```sh
atlas guide
```

Hand the agent that text, and tell it to name the Atlas first in every
command, as `atlas --root ATLAS COMMAND`. Each command is a launch of its own
and reads only what its own command line grants: where the Atlas cites files
elsewhere in the project, the commands that read sources (`read-source`,
`stale`, `stamp`, `validate --from`) also need `--allow-source-root PROJECT`
after `--root ATLAS`.

Ask the agent the same question as above. It reads the title with
`atlas --root ATLAS inspect`:

```text
    "title": "Notes app",
```

You now have an agent that reports the Atlas's title, Style and Trees as the
Atlas holds them. Every command is in [The atlas command](../reference/cli.md).
