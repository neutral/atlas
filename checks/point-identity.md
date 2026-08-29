---
type: check
id: point-identity
title: Review Point identity before creation
summary: Require each proposed Point anchor to be distinguished from existing Atlas-wide identities before a new identity is accepted.
status: active
level: required
applies-to:
- point-anchor
- point-context
---

# Review Point identity before creation

## Requirement

Each new anchor must represent a durable subject that is distinct from every existing Point in the Atlas. A contribution to an existing subject must use that Point's id and must follow the anchor-versus-context boundary. Text similarity can identify candidates, but it cannot establish or reject shared identity by itself.

## Verification

List every new anchor and every changed identity decision. Search the complete Atlas by id, title, summary, body, material, and relation neighborhood. Record the nearest existing candidates and explain why the proposed material establishes a new identity, changes the canonical anchor, or adds Map-local context. Inspect all records of a reused identity and confirm that the new record does not redefine anchor-only fields.

## Failure

Fail when a new anchor duplicates or aliases an existing subject, when related material receives a new id without a recorded distinction, or when a context contribution uses a separate identity to evade context constraints. Reuse the existing identity or state the durable distinction that requires a new Point.
