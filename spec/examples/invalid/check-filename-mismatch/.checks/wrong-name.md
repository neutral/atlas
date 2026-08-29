---
type: check
id: expected-name
title: Require a matching Check filename
summary: A Check identifier must match its Markdown filename.
status: active
level: required
applies-to:
- check
---

# Require a matching Check filename

## Requirement

Check identifiers and filenames must agree exactly so discovery is deterministic.

## Verification

Compare the Check identifier with the filename before accepting the change.

## Failure

Rename the file or correct the identifier before continuing.
