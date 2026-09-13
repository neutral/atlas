# Atlas

Atlas connects project documents to the decisions, questions, and perspectives
they inform. People and agents read and contribute to the same portable files
with stable identities and explained connections.

## Get started

Use Node 22.23.2 or later and npm:

```sh
npx @neutral/atlas --help
npx @neutral/atlas open /absolute/path/to/project
```

Atlas includes command-line tools, a local browser Editor, a static site exporter,
and an MCP adapter. Continue with the [installation guide](docs/install.md) and
[project guide](docs/getting-started.md). Atlas **0.9.0** uses authored format **2**.

The authored format also works directly with ordinary files. Read
[Working with Atlas](spec/OPERATING.md) and the
[starter example](spec/examples/starter/README.md).

## Integrate

Use the [integration guide](docs/integration.md) for the shared-runtime payload,
container operation, and fixed-scope MCP connection. The same
[`@neutral/atlas` package](docs/sdk.md) exposes reading, workspaces, prepared
authoring, Check evaluation, commands, and public types for embedding.

Atlas works independently of Intent and Forge. The
[IntentForge guide](https://github.com/neutral/intentforge/blob/main/README.md)
describes optional composition.

## Repository map

| Path | Purpose |
| --- | --- |
| [spec/](spec/README.md) | Canonical meaning, format, schemas, and conformance fixtures. |
| [docs/](docs/README.md) | Installation, use, integration, and verification. |
| [examples/](examples/README.md) | Copyable examples and an optional custom evaluator. |
| [library/](library/README.md) | Shared runtime and types. |
| [apps/](apps/README.md) | CLI, agent, Editor, and Portal source adapters. |
| [checks/](checks/README.md) | Optional reusable Checks, adopted deliberately. |
| [tests/](tests/README.md) | Public source and installed artifact qualification. |
| [distribution/](distribution/README.md) | npm package and native application assembly. |

## Build from source

Source development uses Node 22.23.2 or later and pnpm 11.22.0. From the
repository root:

```sh
corepack enable
corepack pnpm@11.22.0 install --frozen-lockfile
npm test
npm run check
```

The [distribution guide](distribution/README.md) covers npm and native builds.
Read [CONTRIBUTING](CONTRIBUTING.md) for the feedback policy.

[Security](SECURITY.md) explains supported boundaries and reporting. Original
material uses [CC0 1.0 Universal or Zero-Clause BSD](LICENSE), at the recipient's
choice. [Third-party material](THIRD_PARTY.md) retains its own terms.
