# Atlas

> Atlas has moved to [github.com/methodologies/atlas](https://github.com/methodologies/atlas), and its npm package to [`@methodologies/atlas`](https://www.npmjs.com/package/@methodologies/atlas). This repository is archived; it keeps Atlas's history through 1.2.0.

Atlas makes the context around a project navigable, helping agents and people
build a better understanding.

An Atlas is an explanation of a project, kept in plain files beside it. Each of
its Trees owns one account of the project: a top claim and the Points that
develop it, down to the documents and code they cite. A Point states one
claim in its title and explains it beneath. A Facet says what another Tree
changes about how a Point reads. The Atlas's Style says how it is written.

This source tree is version 1.2.0.

## What you do with it

- **Read it.** `atlas open` serves the Portal on your machine: one page for each
  Point, the Points around it in the margin, its sources under it, Outline for
  the whole Atlas and Help for its words. Reading changes nothing.
- **Have your agent keep it.** Connect your agent through the MCP server. It
  edits a copy of the Atlas and prepares the change whole, as a draft. You read
  the draft in the Portal, with what differs marked, and say apply.
- **Keep it true.** The agent stamps each source it read a Point against. When
  the project changes, `atlas stale` lists the sources that changed and the
  Points and Facets that cite them, and the Portal marks them.
- **Publish it.** `atlas export` writes the pages of the Trees you choose, for
  any web server.

## Install

With Node.js 22.23.2 or later:

```sh
npm install --global --ignore-scripts @neutral/atlas
atlas open /path/to/project
```

[Install Atlas](docs/how-to/install.md) covers an install in one project, the
source checkout, a tarball and a runtime bundle.

## Start from source

Use Node.js 22.23.2 or later and pnpm 11.9.0. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm atlas open examples/offline-notes
```

`atlas open` serves the shipped example, prints its address and asks your
browser to open it; `Ctrl+C` stops it. Type `pnpm atlas` wherever a guide shows
`atlas`. pnpm runs it from the repository root, so give paths from there or in
full.

## Documentation

The [documentation](docs/README.md) has three kinds of page:

- **How-to guides**, for a task: [start an Atlas](docs/how-to/start-an-atlas.md),
  [connect an agent](docs/how-to/connect-an-agent.md), [read an
  Atlas](docs/how-to/read-an-atlas.md), [ask your agent for a
  change](docs/how-to/ask-for-a-change.md), [keep it true as the project
  changes](docs/how-to/keep-it-true.md), [publish it](docs/how-to/publish.md)
  and more.
- **Explanation**, for why Atlas works as it does, from [what an Atlas is
  for](docs/explanation/what-an-atlas-is.md) to [how changes
  land](docs/explanation/how-changes-land.md).
- **Reference**, for looking something up: [the atlas
  command](docs/reference/cli.md), [the MCP server](docs/reference/mcp.md),
  [the Portal](docs/reference/portal.md) and the rest.

The rules are not in the documentation. The [specification](spec/SPEC.md)
owns them, and [Working with Atlas](spec/OPERATING.md) is the guide every
agent is handed.

## Repository

| Path | Holds |
| --- | --- |
| [`spec/`](spec/SPEC.md) | The specification (meaning, file format, operations, project workflow) and [Working with Atlas](spec/OPERATING.md), the guide every agent is handed |
| [`library/`](library/README.md) | The Library: reading, validation, search, Route, the change path, stamps and the stale report |
| [`apps/cli/`](apps/cli/README.md) | The `atlas` command |
| [`apps/agent/`](apps/agent/README.md) | The MCP server |
| [`apps/portal/`](apps/portal/README.md) | The Portal: the reader's pages, served on this machine or exported |
| `apps/installer/` | The installer shipped in runtime bundles |
| [`styles/`](styles/README.md) | The six curated Styles |
| [`checks/`](checks/README.md) | The shipped Checks |
| [`docs/`](docs/README.md) | How-to guides, explanation and reference |
| [`examples/`](examples/README.md) | The shipped example Atlas and the worked comparison of the Styles |
| [`tests/`](tests/README.md) | Test support and the independent reader |

## Licence and policies

Original material is available under [CC0 1.0 Universal or 0BSD](LICENSE), at
your option. [Third-party material](THIRD_PARTY.md) keeps its own terms. The
[feedback and submission policy](CONTRIBUTING.md) says how to send questions, and
[Security](SECURITY.md) gives the processing boundaries and how to report a
problem.
