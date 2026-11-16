# Atlas CLI

`atlas` is the command line of Atlas. It reads an Atlas and prints JSON,
prepares changes as drafts and applies them at the revision that was reviewed,
serves the Portal for reading (`atlas open`), prints the configuration that
connects an agent host (`atlas config`), runs the MCP server (`atlas mcp`) and
exports the Portal as static pages (`atlas export`). The command is
`src/cli.mjs`, with locating a project's Atlas (`atlas locate`, and what
`open` and `config` select) in `src/project.mjs`; the operations it
runs are the [Library](../../library/README.md)'s.

## Run it

In a checkout of the repository, prepared as
[Install Atlas](../../docs/how-to/install.md#from-the-source-checkout) describes, run the file itself or the
`atlas` script, which runs it:

```sh
node apps/cli/src/cli.mjs --help
pnpm atlas --version
```

The package `@neutral/atlas` installs the same CLI as the `atlas` command, and
also as `atlas-cli`:

```sh
atlas open PROJECT
atlas --root PATH COMMAND
```

`atlas --help` lists every command. `atlas help COMMAND`, or
`atlas COMMAND --help`, prints one command with its options, its INPUT fields
and what it prints; neither needs `--root`. Where a command takes INPUT, both say what it
is, the path of a JSON file or `-` to read the JSON from standard input, with
an example:

```sh
echo '{"query":"offline delivery","limit":3}' | atlas --root PATH search -
```

The [atlas command reference](../../docs/reference/cli.md) gives every command
exactly: its forms, options, INPUT fields, output, exit codes and refusals.
