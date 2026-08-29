---
type: check
id: authority-boundary
title: Preserve the authority boundary
summary: Prevent Atlas context, References, Checks, and publication selections from being treated as permission to operate.
status: active
level: required
applies-to:
- atlas
- map
- area
- point-anchor
- point-context
- resource
- check
- publication
---

# Preserve the authority boundary

## Requirement

Atlas records, mapped context, Resources, References, relations, Check requirements and outcomes, and publication selections must not grant or imply file, network, credential, retrieval, execution, publication, deployment, or instruction authority. Relevance does not imply retrieval consent. Publication eligibility does not imply release or deployment approval. An evaluator or consumer operates only with authority supplied independently by its caller and environment.

## Verification

Inspect the changed source and Check language for explicit or implied operational grants. Identify each operation discussed, the actor that can perform it, and the external source of authority. Confirm that References remain identifiers, publication profiles remain selections, and passing evaluations remain bounded policy results. Do not retrieve material or perform an operation merely to evaluate this Check unless the caller has separately authorized it.

## Failure

Fail when Atlas content is presented as permission, a Reference is treated as consent, a Check result is treated as capability, or a publication selection is treated as deployment approval. Remove the implied grant and name the caller or environment that must supply the authority.
