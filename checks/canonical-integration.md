---
type: check
id: canonical-integration
title: Integrate source material into canonical context
summary: Require supplied material to be decomposed, accounted for, and placed in canonical, contextual, Resource, or explicit non-integration roles.
status: active
level: required
applies-to:
- atlas
- map
- area
- point-anchor
- point-context
- resource
---

# Integrate source material into canonical context

## Requirement

An atomic change that integrates supplied material must account for every material claim, decision, constraint, question, perspective, and evidence unit needed to preserve the source's meaning. The change must search existing Point identities before it creates an anchor. It must place each unit in one explicit role: an existing Point's canonical anchor core, a Map-local context record, a new Point anchor, a Resource connected through Content or a Reference, an unresolved conflict or question, or a reasoned exclusion.

Integration must preserve source distinctions, conflicts, uncertainty, provenance, and the boundary between Atlas context and referenced material. It must not turn the source into one undifferentiated Point, create a parallel canonical account, repeat an existing contribution, replace a primary document with an Atlas summary, or silently discard material because it does not fit the first selected Map.

## Verification

Inspect the complete supplied source within caller-provided authority. Divide it into independently placeable material units only as far as needed to make integration decisions. For each unit, record its source location, search result, chosen Point identity or Resource, containing Map and Areas when applicable, integration role, and reason. Compare the result with every existing record for the affected identities. Confirm that canonical fields remain in the anchor, perspective-specific meaning remains in context records, direct documents remain Resources connected through Content or References where appropriate, and every exclusion or unresolved conflict is visible in the evaluation evidence.

## Failure

Fail when a material unit has no disposition, an existing identity was not considered, one source is flattened into a generic summary, a contextual contribution competes with the anchor, a conflict or uncertainty disappears, a durable source loses traceability, or incorporated prose claims more than the source supports. Restore the missing disposition or revise the placement before accepting the integration.

## Exceptions

A mechanical change or an original edit that is not presented as source integration does not require a source-unit inventory. The evaluation must identify that limited scope and still apply every other selected Check.
