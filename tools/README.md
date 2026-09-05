# Atlas tools

This directory contains the executable tools published with Atlas:

- [`atlas-portal/`](atlas-portal/) validates a selected publication view and generates a static reader.
- [`validator/`](validator/) implements structural and resolved validation and exact Point inspection.

`tools/` contains the optional Node.js tooling for Atlas. The specification and Atlas files can be used without installing it.

## Install

Run commands from the repository root:

```text
corepack pnpm@11.22.0 --dir tools install --frozen-lockfile
```

## Test

```text
corepack pnpm@11.22.0 --dir tools test
```

This checks Atlas Portal types and runs the validator and Atlas Portal suites against the specification fixtures shipped in the repository.

Check the installed dependencies:

```text
corepack pnpm@11.22.0 --dir tools audit:dependencies
```

## Use the tools

Validate an Atlas:

```text
corepack pnpm@11.22.0 --dir tools exec atlas-validate "/absolute/path/to/atlas" --json
```

Create a Portal configuration file, for example `/absolute/path/to/portal.json`:

```json
{ "name": "Atlas" }
```

Start Atlas Portal:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/portal.json"
```

Each tool documents its complete command surface in its own README.

Inspect an exact Point with its anchor, contexts, and source metadata:

```text
corepack pnpm@11.22.0 --dir tools exec atlas-inspect "/absolute/path/to/atlas" --point exact-point-id
```

Inspection reads the local Atlas without applying a publication profile.
