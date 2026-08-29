# Reusable Atlas Checks

This directory contains optional reusable Check records published alongside the [Atlas specification](../spec/spec/CHECKS.md).

Adopt a Check by copying its Markdown file into an Atlas at `.checks/<check-id>.md`. Copy only the policies the project intends to enforce. Review each Check's Requirement, applicability, evidence needs, and evaluator support before adoption.

Checks supplement format validation with project-local authoring policy. They do not establish semantic truth, change the Atlas format, or grant access, retrieval, execution, publication, or deployment authority.

## Inventory

- [Preserve the authority boundary](authority-boundary.md): Prevent Atlas context, References, Checks, and publication selections from being treated as permission to operate.
- [Integrate source material into canonical context](canonical-integration.md): Require supplied material to be decomposed, accounted for, and placed in canonical, contextual, Resource, or explicit non-integration roles.
- [Require distinct explained context](context-quality.md): Require changed Point records and semantic edges to add specific meaning without repeating existing contributions.
- [Review Point identity before creation](point-identity.md): Require each proposed Point anchor to be distinguished from existing Atlas-wide identities before a new identity is accepted.
- [Keep routing questions usable](routing-quality.md): Require changed Map and Area questions to distinguish durable deposit choices rather than repeat categories or placeholders.
- [Align standing with recorded support](standing-and-evidence.md): Require changed claims, posture, lifecycle, relations, Content, and References to match the support available at the evaluated baseline.

## Local adaptation

A project can adapt a published Check to its local policy. It should retain the published id only while the Requirement keeps the same meaning. Project-specific evidence, exceptions, and evaluator behavior belong in the adopting Atlas.
