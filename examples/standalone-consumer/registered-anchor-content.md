---
{
  "type": "check",
  "id": "registered-anchor-content",
  "status": "active"
}
---

# Name registered Content on active anchors

Require each lifecycle-active Point anchor to name at least one registered Resource in its Content.

## Requirement

Every Point anchor whose Point lifecycle is `active` must contain at least one Content target whose `resource` value exactly equals an id in the Atlas Resource registry.

Content on a same-id context does not satisfy the anchor requirement. References and direct-URI Content do not satisfy it. Historical and superseded Points are outside this requirement. Posture does not change applicability.

This is an optional local policy. It does not assess source contents, source availability, semantic support, truth, authority, or body quality.

## Verification

For each selected anchor subject, inspect the captured Point lifecycle, anchor Content, and Atlas Resource registry. Record its exact id and path, source hashes, inspected targets, matched Resource ids, and any lifecycle exemption. Fail each active anchor without a matching registered target. Read no Resource bytes and execute no linked material.

A selected scope with no lifecycle-active anchors satisfies the requirement vacuously. Record the inspected exempt anchors. A result covers only its selected subjects.

## Failure

Identify every active anchor that lacks registered Content. Deliberately add an appropriate registered Content target or reconsider the local policy. Do not move material, alter lifecycle, or invent a Resource merely to obtain a pass.
