---
{
  "type": "check",
  "id": "anchor-body",
  "status": "active"
}
---

# Require explanatory anchor bodies

Require changed anchors to include a substantive Markdown body beyond their canonical summary.

## Requirement

Every changed anchor must include at least one substantive Markdown block beyond its opening summary paragraph. That additional prose should explain the idea rather than repeat the summary. A single useful sentence can satisfy this policy; no minimum length is required.

## Verification

Inspect each changed anchor using the format's body-inspection rules. Exclude the opening summary paragraph, confirm that an included block remains after normalization, then read it for an additional explanation. Record the inspected paths and the supporting passage. Do not execute linked material or treat body presence as evidence of truth.

## Failure

Fail when the body is absent, contains only headings or excluded material, or merely repeats the summary. Add the missing explanation without padding. This adopted policy is stricter than format validity; it does not redefine Point identity.
