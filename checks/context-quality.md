---
type: check
id: context-quality
title: Require distinct explained context
summary: Require changed Point records and semantic edges to add specific meaning without repeating existing contributions.
status: active
level: required
applies-to:
- point-anchor
- point-context
---

# Require distinct explained context

## Requirement

Each changed Point record must contribute meaning specific to its containing Map. Every Area membership must explain how the record affects that Area's question. Every changed relation must explain its directional edge. A context summary, body, Content target, Reference, and Area explanation must not merely repeat the anchor, another context record, the Map summary, or the Area summary.

A bodyless context remains substantive when an explained Area membership, Content, or Reference supplies distinct local meaning.

## Verification

Compare the changed record with its anchor, every other context record for the identity, its containing Map, and its selected Areas. Compare normalized summaries, bodies, Area explanations, Content, References, and relation notes for exact repetition and semantic overlap. Record the distinct local contribution made by each changed element and identify the Map or Area question it helps answer.

## Failure

Fail when a record or edge has no distinct contribution, uses generic placement language, repeats another contribution, or cannot explain why the Point belongs in that Map or Area. Remove the unnecessary record or edge, or replace the repetition with the actual local consequence.
