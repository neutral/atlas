---
type: check
id: boundary
title: Preserve Map boundaries
summary: Maps must remain question-led semantic domains.
status: active
level: required
applies-to:
- map
- area
---

# Preserve Map boundaries

## Requirement

Every Map and Area must state a question that a human or software agent can use to route new context reliably.

## Verification

Read each changed question and compare it with the changed Point records, then record whether the routing decision is unambiguous.

## Failure

Do not accept a Map that merely mirrors a folder, team, or sidebar section.

## Exceptions

A draft Map may remain incomplete only while its Check status and review evidence explicitly identify that limitation.
