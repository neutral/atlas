# Atlas Checks

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns project-local write policy and optional audit reports. Format owns file placement; Processing owns structural inspection; Validation owns diagnostics; Conformance owns compliance claims.

Core defines identity, canonical fields, state, explained edges, and authority boundaries. Checks add local demands such as mandatory Area placement, evidence, substantive prose, review, or extension classifications. Checks MUST NOT redefine core meaning or grant authority. A catalog Check governs only after adoption in an Atlas.

## Authored Check contract

A Check MUST conform to `urn:atlas:schema:check:2`. Its local JSON requires only type, id, and status. Exactly one `catalog.json` Check registration owns its level and `applies-to`. A missing registration is invalid; no defaults are inferred. Its H1 and opening paragraph supply title and summary under the shared Format rules.

Status is `draft`, `active`, or `retired`. Level is `required` or `advisory`. Applicability values are `atlas`, `map`, `area`, `point-anchor`, `point-context`, `resource`, `check`, and `publication`.

The body MUST contain exactly these level-two headings in order: `Requirement`, `Verification`, `Failure`, and optional `Exceptions`. Required sections MUST contain actionable, non-blank content. State additional policy rather than repeating format constraints.

## Ordinary evaluation

Evaluate applicable active Checks against the actual change. Draft and retired Checks do not govern. Report `pass` only after completing Verification with evidence supporting the exact Requirement. Report `fail` when the Requirement fails and `unable` when evidence, capability, or authority is insufficient. Do not use `not-applicable` to bypass an applicable active Check.

Every applicable active required Check MUST pass before a Check-compliance claim. Advisory outcomes remain visible but do not block by themselves. An unverified Check cannot be treated as passed. Proxy measurements establish only the measured property, not truth, completeness, usefulness, or product value.

Ordinary evaluation requires no stored report, baseline artifact, approval process, or change workflow. A Check can require specific evidence or review. This does not make that requirement universal.

## Audit reports

When an audit report is requested or required by local policy, it MUST conform to `urn:atlas:schema:check-evaluation:1`.

A report records Atlas and Check identities, Check revision, status, level, immutable baseline, atomic change set and paths, exact subjects, evidence, diagnostics, outcome, and evaluator. Outcomes are `pass`, `fail`, `unable`, and `not-applicable`. Draft and retired Checks use `not-applicable`. Failed or unable outcomes require diagnostics; passing and not-applicable outcomes contain none. Passing outcomes require supporting evidence.

An audited compliance claim covers only the recorded baseline, change set, subjects, Check revisions, evaluator, and evidence.

## Reusable Check metadata

A reusable Check package supplies its exact Markdown definition and a separately
authored catalog registration. Adoption copies the selected Markdown bytes and
registration into their local owners. The registration MUST name the adopted
Check id. Upstream changes never silently replace local policy.

A Check revision identifies its exact Markdown bytes together with the canonical
selected catalog registration and effective Check extensions. A level or applicability change therefore changes
the Check revision even when its document bytes remain unchanged. Evaluator
support and report reinspection MUST account for both inputs.
