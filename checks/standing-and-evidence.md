---
type: check
id: standing-and-evidence
title: Align standing with recorded support
summary: Require changed claims, posture, lifecycle, relations, Content, and References to match the support available at the evaluated baseline.
status: active
level: required
applies-to:
- point-anchor
- point-context
- resource
---

# Align standing with recorded support

## Requirement

Changed Atlas claims must not exceed the evidence available at the evaluated baseline. Anchor posture and lifecycle must agree with the Point body and its current standing. Relation notes must describe only the supported edge. Content targets and Reference roles must reflect how the named material supports the record. Intended, open, historical, superseded, observed, and implemented claims must remain distinguishable in prose even when a project uses no extension vocabulary for those distinctions.

Format validity, a passing Check, self-description, and repeated assertion are not evidence that a claim is true or implemented.

## Verification

Inspect each changed claim, posture, lifecycle, relation note, Content target, and Reference against the available source or observed evidence under caller-provided authority. Record the evidence boundary and any inaccessible source. Compare the claim's wording with what that evidence establishes, and confirm that uncertainty, contrary evidence, and review triggers remain visible where they affect use.

## Failure

Fail when a claim overstates its support, posture or lifecycle contradicts prose, a relation note implies an unsupported effect, Content or a Reference misstates the material's role, or inaccessible evidence is treated as verified. Narrow the claim, correct its posture, lifecycle, or material connection, preserve the uncertainty, or supply the missing evidence.
