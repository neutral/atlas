# Atlas MCP server

The MCP server gives an agent host one Atlas over stdin and stdout. Its 22
tools read the Atlas and its cited sources, prepare changes as drafts, and
apply a draft the owner approved; they run the same Library operations as the
CLI. The Atlas root, the source roots the server may read and its state home
are fixed when it starts, and no tool can change them.

It starts in either form:

```sh
atlas-agent --root PATH [--allow-source-root PATH]...
atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] mcp
```

`atlas-agent` is this package's `src/server.mjs`. It reads the state home from
`ATLAS_STATE_HOME`, and `atlas ... mcp` sets it from `--state-home`. stdout
carries protocol messages only.

To connect a host, print the configuration that starts the server with
`atlas config` and install it through the host; `atlas config` changes no host
settings. See [Connect an agent](../../docs/how-to/connect-an-agent.md). The
[MCP server reference](../../docs/reference/mcp.md) gives the launch, the
transport, and every tool with its input, result, bounds and refusals.
