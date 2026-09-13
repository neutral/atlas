# Atlas CLI

This component owns the `atlas` command namespace and its local project launch
flow. `atlas open` discovers a collection, manages durable application state, and
opens the bundled Editor. `atlas export` delegates selected site generation;
`atlas connect` generates fixed-scope host configuration for `atlas mcp`.

Validation, reading, exact inspection, workspace, and prepared-authoring adapters
call the public Atlas Library API. Existing `atlas-validate`, `atlas-read`,
`atlas-inspect`, `atlas-workspace`, and `atlas-author` entry points share those
implementations. They do not define another format or interpretation.

The `@neutral/atlas` npm package supplies the application and its command
adapters. A [native archive](../../distribution/README.md) also includes its
runtime. Install one of these distributions to use the commands below. Source
lives in `src/`, launchers in `bin/`, and command tests in `tests/`.

## Use

```sh
atlas open "/absolute/path/to/project"
atlas --help
atlas --version
```

The [project guide](../../docs/using-from-another-repository.md) explains creation,
draft recovery, reviewed application, export, and agent connection. The
[Library guide](../../library/README.md) documents advanced SDK command syntax,
results, and exit codes. Start with the shared
[operating guide](../agent/guides/OPERATING.md) for work on authored Atlas content.

## Develop and verify

Run these commands from the repository root:

```sh
corepack pnpm@11.22.0 install --frozen-lockfile
corepack pnpm@11.22.0 --filter atlas-cli-development test
corepack pnpm@11.22.0 exec atlas-validate --fixtures spec/examples/manifest.json
```

Source tests exercise argument handling, public results, and exit codes. Installed
qualification tests separately verify the assembled package and its launchers.
