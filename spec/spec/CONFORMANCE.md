# Atlas Conformance

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns the conditions and limits of conformance claims. It refers to Atlas Format, Processing, Validation, Checks, and Publication for the underlying rules. It does not restate ownership of those rules. An implementation can claim only a conformance class whose complete requirements it satisfies.

An Atlas document set is format-conformant when a conforming validator reports a complete valid resolved result for a declared revision. Format conformance establishes compliance with Atlas Format under Atlas Processing and Validation. It does not establish semantic truth, completeness, usefulness, Check compliance, or product value.

A validator conforms when it implements the structural and resolved profiles, including publication-profile validation and resolution, and agrees with every required fixture. It produces deterministic results and validates its results and normalized output against the standard output schemas. It withholds normalized output from invalid or incomplete results and does not overclaim processing.

An atomic Atlas change is Check-compliant when it is format-conformant and every applicable active required Check passes for the exact recorded baseline, change set, subjects, Check revisions, evaluator, and evidence. Check compliance does not establish claims outside those recorded requirements.

An authoring tool conforms when it preserves the author's Map and Point-identity decisions and all extensions. It creates valid anchor and context records with explained Area memberships. It evaluates applicable active Checks, validates the result, and does not infer authority from content.

A consumer preserves Maps, Area questions and explained memberships, anchor/context records, primary Map, state, relation notes, Content, References, Resources, Check boundaries, and publication selections. It cannot present a context as another Point identity or erase provenance.

Publication-profile support is part of format and validator conformance. The specification set defines no publication-build, publisher, or portal conformance class. Any such claim requires its own named contract and cannot follow from a valid profile or format conformance.

Independent interoperability requires a second implementation to consume normative schemas and valid fixtures without importing the reference validator implementation. A read-only processor demonstrates consumer interoperability when it produces schema-valid normalized output and agrees exactly with pinned and reference output. It does not claim validator conformance unless it also agrees with every required invalid-fixture outcome and diagnostic.
