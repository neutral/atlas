# Atlas

Atlas makes the context around a project navigable, helping agents and people
build a better understanding.

Start with an overview or a question, follow an explanation into its detail,
and inspect the material behind it. Trees organize these accounts; their Points
carry explanations, and Facets show how another Tree's perspective matters.
People and agents work with the same portable files.

This source tree is version 1.1.0.

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

The Editor opens in your browser. Choose a Point to read its explanation beside
the Tree, or use **Search Atlas** to find a starting Point across Trees. Follow
Facets into related accounts, expand **Focus reading**, and open cited Markdown
as readable source material. Stop the server with Ctrl+C.

Open another project with `pnpm atlas open /path/to/project`. Atlas finds its
collection or offers creation. For a read-only Portal:

```sh
pnpm atlas --root examples/offline-notes serve
```

When the underlying material changes, **Review sources** identifies the accounts
that cite it. Prepare a draft, inspect the changed explanation and its surrounding
context, then apply the exact revision you reviewed. Absorb drafts retain the
reason for each contribution, unresolved questions and any candidate Check
evidence. Drafts and recovery files live in private user storage.

Connected agents use Route to discover candidate explanations, read a selected
Point in full and continue through bounded pages of detail. They can prepare the
same reviewable drafts. Use **Connect an agent** for setup and **Export site** to share
a selected reading site.

Continue with [getting started](docs/getting-started.md), choose a task in the
[documentation](docs/README.md), or embed the [Library](library/README.md).

## Repository

| Path | Responsibility |
| --- | --- |
| `spec/` | Meaning, file format and operation contracts |
| `library/` | Validation, reading, Absorb, Route and safe authoring |
| `apps/cli/` | Command-line application |
| `apps/agent/` | MCP server |
| `apps/portal/` | Search, focused reading and selected publications |
| `apps/editor/` | Reviewed authoring and source review |
| `apps/installer/` | Runtime-bundle installer and integrity checks |
| `styles/` | Curated organizing and source-depth policies |
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
