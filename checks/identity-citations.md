---
{"id":"identity-citations","status":"active","level":"required"}
---
# Connections keep their meaning when a Point's scope changes

## Requirement

After a Point is narrowed, broadened, split, merged, removed or replaced,
every known connection to it still means what its author intended: its place
in the outline, the Facets attached to it and targeting it, the records that
link to it, and any publication selection that includes it. This holds even
when IDs and paths stay the same. A removed Point's meaning lives somewhere
the change names, or the change says that it was dropped and why.

## Verification

Compare the former and resulting meanings. Read each affected placement,
Facet and citing passage in its surrounding prose, within granted access, and
record whether the connection was kept, revised or removed. Record every gap
that could not be resolved.

## Failure

Report `fail` when a link or Facet now points at a claim it was not written
about, when a removed claim's meaning disappeared without a statement, or when
a publication selection grew implicitly. Report `unable` when the former
meaning or the citing material is unavailable.

## Exceptions

An edit that keeps a Point's identity and scope needs only confirmation that
this Check's trigger is absent.
