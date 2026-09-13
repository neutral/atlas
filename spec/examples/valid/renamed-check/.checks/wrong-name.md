---
{
  "type": "check",
  "id": "expected-name",
  "status": "active"
}
---

# Require a matching Check filename

A Check identifier must match its Markdown filename.

## Requirement

Check identifiers and filenames must agree exactly so discovery is deterministic.

## Verification

Compare the Check identifier with the filename before accepting the change.

## Failure

Rename the file or correct the identifier before continuing.
