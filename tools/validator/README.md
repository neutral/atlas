# Atlas reference validator

The Atlas reference validator implements the structural and resolved profiles for Atlas 0.7.0. It validates strict text and YAML, structural discovery, Atlas-wide Point identity, anchor and context records, substantive Markdown, explained Area memberships, routing questions, registered Resources, relations, supersession, Checks, publication selections, local path safety, and deterministic normalized output.

A complete valid resolved result establishes format validity only. Atlas-local Check compliance and semantic, evidence, usefulness, or product claims remain separate contracts.

Install the validator from the repository root:

```text
corepack enable
pnpm --dir tools install --frozen-lockfile
```

Validate an Atlas:

```text
pnpm --dir tools exec atlas-validate <atlas-path> \
  --profile neutral.atlas-validator.resolved \
  --json
```

Validate the published fixture matrix:

```text
pnpm --dir tools exec atlas-validate \
  --fixtures spec/examples/manifest.json
```

The CLI reports specification revision `0.7.0` by default. Use `--specification-revision` to record a more specific immutable revision when required.

The CLI exits with `0` for a complete valid result or matching fixture matrix, `1` for a complete invalid result or fixture mismatch, and `2` for invalid usage or an incomplete result. JSON output conforms to the schemas packaged in `schemas/` and published under [`../../spec/schemas/`](../../spec/schemas/).
