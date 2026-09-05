---
{
  "type": "check",
  "id": "anchor-body",
  "title": "Require explanatory anchor bodies",
  "summary": "Require changed anchors to include a substantive Markdown body beyond their canonical summary.",
  "status": "active",
  "level": "required",
  "applies-to": [
    "point-anchor"
  ]
}
---

# Require explanatory anchor bodies

## Requirement

Every changed anchor must include at least one substantive Markdown block beyond front matter. The body should explain the idea rather than repeat its summary. A single useful sentence can satisfy this policy; no minimum length is required.

## Verification

Inspect each changed anchor using the format's body-inspection rules. Confirm that an included block remains after normalization, then read it for an explanation beyond the summary. Record the inspected paths and the supporting passage. Do not execute linked material or treat body presence as evidence of truth.

## Failure

Fail when the body is absent, contains only headings or excluded material, or merely repeats the summary. Add the missing explanation without padding. This adopted policy is stricter than format validity; it does not redefine Point identity.
