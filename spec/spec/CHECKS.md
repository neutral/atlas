# Atlas Checks

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns Check-specific fields, body structure, and evaluation meaning. Atlas Format owns Check placement in the authored tree and the identifier-to-filename constraint. Atlas Processing owns structural inspection. Atlas Validation owns diagnostics for malformed Checks. Atlas Conformance owns Check-compliance claims. A Check's project-specific Requirement remains outside generic format semantics.

## Purpose

Projects define Checks as authoring policy for evaluation before an Atlas change is committed. Checks are part of the write system, not mapped context, and cannot grant authority.

## Authored Check contract

Atlas Format defines the structural location and file constraints for Checks. A Check that satisfies those structural rules MUST conform to `urn:atlas:schema:check:1`.

It MUST declare type, id, title, summary, status, level, and `applies-to`.

Status is `draft`, `active`, or `retired`.

Level is `required` or `advisory`.

Applicability values are `atlas`, `map`, `area`, `point-anchor`, `point-context`, `resource`, `check`, and `publication`.

## Body contract

The body MUST contain exactly these level-two headings in order: `Requirement`, `Verification`, `Failure`, and optional `Exceptions`. Each required section MUST contain actionable, non-blank content.

## Evaluation contract

An evaluation conforms to `urn:atlas:schema:check-evaluation:1`. It records Atlas identity, Check identity, content revision, status, and level. It also records an immutable baseline, an atomic change set and its paths, exact applicable subjects, evidence, outcome, diagnostics, and evaluator identity. Outcome is `pass`, `fail`, `unable`, or `not-applicable`.

An evaluator MUST use `not-applicable` for draft and retired Checks. It MUST NOT use `not-applicable` to bypass an active Check. It MUST use `unable` when it lacks the authority or evidence needed to complete the stated Verification. A failed or unable evaluation MUST include at least one diagnostic. A passing or not-applicable evaluation MUST contain no diagnostics.

An evaluator MUST report `pass` only after it completes the stated Verification. A passing evaluation MUST contain evidence that supports the exact Requirement for the recorded baseline, change set, and subjects. An evaluator MUST NOT present a proxy measurement as proof of semantic truth, completeness, usefulness, or product value unless the Requirement claims only that measurement.

An active required Check MUST have outcome `pass` before a Check-compliance claim. The claim covers only the recorded baseline, atomic change set, subjects, Check revisions, evaluator, and evidence. Evaluators report active advisory Checks, but those Checks do not block by themselves. Draft and retired Checks do not govern.

Checks can govern Map quality, Point substance and context integrity, Area placement, state transitions, relations, evidence, contract synchronization, terminology, confidentiality, and publication-profile maintenance. Passing Checks do not convert format validity into a general semantic-quality claim. Checks cannot redefine standard fields or grant access.
