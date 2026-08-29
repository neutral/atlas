---
type: check
id: point-context
title: Require meaningful Point context
summary: Context records must materially answer their containing Map question.
status: active
level: required
applies-to:
- point-context
---

# Require meaningful Point context

## Requirement

Every context record must add a distinct local consequence, Area membership, Content target, Reference, or explanation to the same Point identity.

## Verification

Inspect the Point anchor and every changed context record, then confirm that the context answers the containing Map question without redefining canonical fields.

## Failure

Do not accept an unexplained copy. Remove it, rewrite it as substantive local context, or establish a different Point identity.
