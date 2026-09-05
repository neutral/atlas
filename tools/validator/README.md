# Atlas reference validator

The Atlas reference validator implements the structural and resolved profiles for Atlas 0.8.0. It validates strict UTF-8 and JSON front matter, structural discovery, Atlas-wide Point identity, anchor and context records, substantive Markdown, explained Area memberships, routing questions, registered Resources, relations, supersession, Checks, publication selections, local path safety, and deterministic normalized output.

A complete valid resolved result establishes format validity only. Atlas-local Check compliance and semantic, evidence, usefulness, or product claims remain separate contracts.

Install the validator from the repository root:

```text
corepack pnpm@11.22.0 --dir tools install --frozen-lockfile
```

Validate an Atlas:

```text
corepack pnpm@11.22.0 --dir tools exec atlas-validate "/absolute/path/to/project/atlas" \
  --profile neutral.atlas-validator.resolved \
  --json
```

Validate the published fixture matrix:

```text
corepack pnpm@11.22.0 --dir tools exec atlas-validate \
  --fixtures ../spec/examples/manifest.json
```

The CLI reports specification revision `0.8.0` by default. Use `--specification-revision` to record a more specific immutable revision when required. Reproducible claims identify the immutable specification and processor revisions.

The CLI exits with `0` for a complete valid result or matching fixture matrix, `1` for a complete invalid result or fixture mismatch, and `2` for invalid usage or an incomplete result. JSON output conforms to the schemas packaged in `schemas/` and published under [`../../spec/schemas/`](../../spec/schemas/).

## Inspect one Point

`atlas-inspect` assembles an exact Point identity for local reading:

```sh
corepack pnpm@11.22.0 --dir tools exec atlas-inspect "/absolute/path/to/project/atlas" \
  --point edge-authentication
```

The command prints JSON. It validates the complete Atlas with the resolved
profile before selecting the Point. Similar wording and partial ids never select
another identity. `--specification-revision REVISION` records an immutable source
revision when supplied.

A found result includes the complete normalized Point: canonical state, anchor
path, every context record, explained memberships, incoming and outgoing relation
notes, Content, References, and extensions. It also includes each containing
Map's metadata, the member Areas, and the registered Resources used by those
Point records and Areas. References retain their evidence roles and selectors.

The output contract is `atlas.point-inspection/1`. Its `status` is `found`,
`not-found`, `invalid`, or `incomplete`. Every result contains `atlasRoot`,
`pointId`, `validation`, and `limits`. The validation summary retains the
profile, completeness, validity, revision, implementation, and diagnostic counts
by severity. Invalid or incomplete validation also includes ordered diagnostics.
Use `atlas-validate --json` for complete diagnostics after successful validation.
Only `found` adds `atlas`,
`point`, `maps`, and `resources`. This selected view is separate from the
normalized-model and validation-result schemas.

An Atlas directory or a path inside it selects the nearest containing Atlas.
Paths are relative to that discovered `atlasRoot`. Registered Resource URIs are based at
`atlas.md`; direct URIs are based at the owning Point-record or Map path.
Source contents are not fetched. Atlas and Map prose and material, unrelated
Areas, other Point bodies, Checks, and publication profiles remain outside the
view. Relation endpoints remain exact ids without recursive expansion.

Inspection applies no publication profile and can include locally available
unselected records. Use the publication tooling for public output. A found Point
does not establish source truth, task completeness, or Check compliance. The
command reduces output selection work; it still parses the complete Atlas.

Exit codes are `0` for a found Point, `1` for invalid input, `2` for invalid
usage or incomplete validation, and `3` for an exact id absent from a valid
Atlas. Invalid usage writes an error to stderr. Other outcomes print JSON.

The package exports `inspectPoint(atlasPath, pointId, { specificationRevision })`
with the same result. It performs resolved validation on every call.
