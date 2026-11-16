---
{"id":"evidence-review","status":"active","level":"required"}
---
# Changed statements agree with their sources

## Requirement

Every statement a change adds or alters stays within the material it cites.
A decision's standing, an observation and an inspected implementation remain
distinct. A dated claim is read in its stated context. Uncertainty and
contrary evidence that affect use are kept. A statement that rests on the
account's own reading says so. The Points above a corrected Point and the
Facets that bear on it agree with the correction.

## Verification

The audit is done by a reader who did not write the change; where agents do
the work, a different model from the author's finds more. The auditor receives
the changed Points and Facets and their cited sources, reads each changed
statement against the cited material, and lists every statement the material
does not support or contradicts, with the place in the source. Each finding is
checked against the files before it is acted on. After the fixes, the changed
lines are audited once more. The record names the sources read, their revision
or stamp, the sources that could not be read, and the findings left open.

## Failure

Report `fail` when a statement exceeds or contradicts its cited material, when
an inference reads as a citation, or when a Point above or a Facet keeps a
claim the correction removed. Report `unable` when the cited material cannot
be read or no reader other than the author was available.
