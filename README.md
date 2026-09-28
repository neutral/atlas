# Atlas

Atlas makes the context around a project navigable, helping agents and people
build a better understanding.

Atlas organizes that context into Trees. Each Tree owns its Points. A Base
Point explains the subject; Branches organize detail; Facets explain connections
to other Trees. People and agents work with the same portable files.

This source tree is version 1.0.0.

## Install

With Node.js installed, install Atlas globally and open a project:

```sh
npm install --global --ignore-scripts @neutral/atlas
atlas open /path/to/project
```

See the [installation guide](docs/install.md) for other installation options.

## Start from source

Use Node.js 22.23.2 or later and pnpm 11.9.0. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm atlas open examples/offline-notes
```

The Editor opens in your browser. It shows one Tree on a canvas with Point pages
beside it. Review drafts before applying them; use Export or Connect agent for
publication and agent setup. Stop the server with Ctrl+C.

Open another project with `pnpm atlas open /path/to/project`. Atlas finds its
collection or offers creation. For a read-only Portal:

```sh
pnpm atlas --root examples/offline-notes serve
```

Use Absorb to review incoming information and propose updates. Use Route to find
an explanation, follow its detail and inspect its sources. Agents use MCP to
read context and prepare changes for review. Drafts and recovery files live in
private user storage.

Continue with [getting started](docs/getting-started.md), choose a task in the
[documentation](docs/README.md), or embed the [Library](library/README.md).

## Repository

| Path | Responsibility |
| --- | --- |
| `spec/` | Meaning, file format and operation contracts |
| `library/` | Validation, reading, Absorb, Route and safe authoring |
| `apps/cli/` | Command-line application |
| `apps/agent/` | MCP server |
| `apps/portal/` | Human Tree canvas and Point pages |
| `apps/editor/` | Local authoring interface |
| `apps/installer/` | Runtime-bundle installer and integrity checks |
| `checks/` | Optional project Checks |
| `tests/` | Source test support and separate-reader checks |
| `docs/` | User guides and technical references |
| `examples/` | Runnable sample Atlas |

Atlas readers accept `atlas/1`. For development, read the
[specification](spec/SPEC.md) and [tests](tests/README.md).

Original material is available under [CC0 1.0 Universal or 0BSD](LICENSE).
[Feedback and submission policy](CONTRIBUTING.md) explains how to send questions.
[Third-party material](THIRD_PARTY.md) retains its own terms. Read
[Security](SECURITY.md) for processing boundaries and reporting.
