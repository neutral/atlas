# Atlas Agent

This component owns the MCP stdio adapter, the embeddable agent session, public
agent declarations, and packaged guides. Source lives in `src/`; the launcher
lives in `bin/`; protocol tests live in `tests/`.

The `@neutral/atlas` npm package and native archive expose this adapter through
`atlas mcp`. `atlas connect` generates fixed-scope host configuration without
editing the host's settings. The package also exposes `atlas-agent`,
`openAgentSession`, and `ATLAS_AGENT_TOOLS` for embedding.

## Use

Start with [Working with Atlas](guides/OPERATING.md). The
[agent contract](guides/spec/AGENT-TOOLS.md) owns protocol and tool behavior.
The [project guide](../../docs/using-from-another-repository.md#connect-an-agent)
documents the installed connection flow and reading sequence. The
[Library guide](../../library/README.md#connect-an-agent-host) documents the
embedding APIs and advanced adapter configuration.

Host-selected roots and trusted evaluators remain fixed for each session. Atlas
content supplies context; it grants no authority to act. Reading, preparation,
evaluation, and application remain explicit operations.

## Develop and verify

Run these commands from the repository root:

```sh
corepack pnpm@11.22.0 install --frozen-lockfile
node apps/agent/scripts/sync-agent-guides.mjs
corepack pnpm@11.22.0 --filter atlas-agent-development test
```

Guide synchronization copies exact specification bytes and records their owning
sources. Edit the owners in `spec/`, then regenerate `guides/`. The
protocol tests verify message handling, fixed scope, reviewed changes, and guide
integrity. Installed qualification separately verifies the assembled package.
