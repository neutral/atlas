# Atlas tools

This directory contains the executable tools published with Atlas:

- [`atlas-portal/`](atlas-portal/) validates a selected publication view and generates a static reader.
- [`validator/`](validator/) implements the Atlas structural and resolved validation profiles.

`tools/` contains the optional Node.js tooling for Atlas. The specification and Atlas files can be used without installing it.

## Install

Run commands from the repository root:

```text
corepack enable
pnpm --dir tools install --frozen-lockfile
```

## Test

```text
pnpm --dir tools test
```

This runs the validator and Atlas Portal suites against the specification fixtures shipped in the repository.

Check the installed dependencies:

```text
pnpm --dir tools audit:dependencies
```

## Use the tools

Validate an Atlas:

```text
pnpm --dir tools exec atlas-validate "/absolute/path/to/atlas" --json
```

Start Atlas Portal:

```text
pnpm --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/atlas" \
  --profile public
```

Each tool documents its complete command surface in its own README.
