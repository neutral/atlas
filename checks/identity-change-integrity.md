---
{
  "type": "check",
  "id": "identity-change-integrity",
  "status": "active"
}
---

# Preserve meaning after Point identity changes

Review affected context, relations, material, citations, and publication selections when an existing Point's identity or scope changes.

## Requirement

When an existing Point's identity or scope changes, review the connections affected by its former and resulting meaning. This includes narrowing, broadening, splitting, merging, and replacement. The review covers its contexts, incoming and outgoing relations, Content and Reference targets, Reference roles and notes, known citations, and explicit publication selectors.

Preserve supported meaning or explain how each affected connection is remapped, revised, or removed. A retained id or working path does not establish that a citation still reaches the intended claim. Publication selection must remain explicit; a split or merge must not automatically select additional source units.

## Verification

Compare the former and resulting items. Inspect all records for the affected identities. Search the authorized Atlas for their ids, paths, relations, and citations. Inspect known citing material outside the Atlas within granted access. Limit external review to known citations; this Check grants no retrieval or modification authority.

Compare each affected context with its resulting anchor. Review incoming and outgoing relations against the resulting claims, including each type and note. Confirm that material targets, roles, and notes still describe their actual contribution. Read known citations in their surrounding text and verify their intended meaning, not only whether their target exists.

Evaluate affected publication selectors against the resulting records and Resources. Confirm that each selected source unit remains deliberately eligible. Report the reviewed scope, dispositions, and unresolved gaps. No stored audit report or additional change workflow is required.

## Failure

Fail when a context carries a different claim, a relation or material role no longer fits, a known citation silently changes meaning, or publication eligibility expands implicitly. Repair the affected connection or explain its removal, then verify the result.

Report `unable` when the former meaning, required evidence, or inspection authority is insufficient to complete verification. An unresolved verification gap cannot produce `pass`. A known failure remains `fail` even when repair authority is unavailable.

## Exceptions

An edit that preserves existing Point identities and scopes needs only confirmation that this Check's trigger is absent.
