---
{"id":"source-accounting","status":"active","level":"required"}
---
# Every unit of supplied source material has a disposition

## Requirement

For the declared source scope, every material claim, decision, constraint,
question and piece of evidence is accounted for. Each unit either updates an
owning explanation, becomes a new Point, becomes a Facet, is recorded as a
conflict, is added as a reference only, or is left out for a stated reason.
Source locations, uncertainty and conflicting meanings are kept.

## Verification

Read the complete declared source within granted access. For each material
unit record its location in the source, the Points or Facets it went to, its
disposition and the reason. Compare the result with the affected Points, the
Points above them and their Facets. Report every source that was not read and
every unit without a settled disposition.

## Failure

Report `fail` when a material unit disappears, duplicates an existing
statement, loses its source boundary or has no defensible disposition. Report
`unable` when the required source cannot be read.

## Exceptions

For an original edit or a mechanical change, record the limited scope instead
of a source inventory.
