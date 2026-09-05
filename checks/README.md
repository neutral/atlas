# Reusable Atlas Checks

This directory contains optional reusable Check records published alongside the [Atlas specification](../spec/spec/CHECKS.md).

Atlas works without adopted catalog Checks. Adopt a Check by copying its Markdown file into an Atlas at `.checks/<check-id>.md`. Copy only deliberately selected policies; the whole catalog is not a starter requirement.

Catalog files are active and required once adopted. Review each Check's Requirement, applicability, Verification cost, and evaluator support before adoption. In particular, `canonical-integration` requires exhaustive source accounting for its declared integration scope; ordinary absorption does not require that inventory.

Checks supplement format validation with project-local authoring policy. They do not establish semantic truth, change the Atlas format, or grant access, retrieval, execution, publication, or deployment authority.

Verification remains required for an adopted required Check. A stored audit report is needed only when requested or required by local policy.

## Inventory

- [Require explanatory anchor bodies](anchor-body.md): Require changed anchors to include a substantive Markdown body beyond their canonical summary.
- [Preserve the authority boundary](authority-boundary.md): Prevent Atlas context, References, Checks, and publication selections from being treated as permission to operate.
- [Integrate source material into canonical context](canonical-integration.md): Require supplied material to be decomposed, accounted for, and placed in canonical, contextual, Resource, or explicit non-integration roles.
- [Require distinct explained context](context-quality.md): Require changed Point records and semantic edges to add specific meaning without repeating existing contributions.
- [Preserve meaning after Point identity changes](identity-change-integrity.md): Review affected context, relations, material, citations, and publication selections when an existing Point's identity or scope changes.
- [Review Point identity before creation](point-identity.md): Require an explicit distinction from existing Points for each new anchor or changed identity decision.
- [Keep routing questions usable](routing-quality.md): Require changed Map and Area questions to distinguish durable deposit choices rather than repeat categories or placeholders.
- [Align standing with recorded support](standing-and-evidence.md): Require changed claims, posture, lifecycle, relations, Content, and References to match the support available at the evaluated baseline.

## Local adaptation

A project can change an adopted Check's status or level and adapt its local policy. It should retain the published id only while the Requirement keeps the same meaning. Project-specific evidence, exceptions, and evaluator behavior belong in the adopting Atlas.
