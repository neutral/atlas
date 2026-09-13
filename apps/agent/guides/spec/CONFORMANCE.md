# Atlas Conformance

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns conformance claims. Format, Processing, Validation, Checks, and Publication own the underlying rules. An implementation can claim only a class whose complete requirements it satisfies.

An Atlas document set is format-conformant when a conforming validator reports a complete valid resolved result for a declared revision. This establishes format constraints, not semantic truth, completeness, usefulness, Check compliance, or product value.

A validator conforms when it implements structural and resolved profiles, including publication-profile resolution, and agrees with every required fixture. It produces deterministic diagnostics and schema-valid results and normalized output. Invalid or incomplete results expose no normalized model.

An Atlas change is Check-compliant when it is format-conformant and every applicable active required Check has been verified and passed for that change. The claim covers only those requirements; it requires no stored audit artifact. An audited Check-compliance claim additionally requires the report and exact evidence scope defined in [Checks](CHECKS.md#audit-reports). Optional reporting never makes required Verification optional.

An authoring tool conforms when it follows [Working with Atlas](../OPERATING.md), preserves authored Map and Point-identity decisions and extensions, and creates valid records. Before writing a Point record, it exposes the selected exact Point id and record kind, plus anchor provenance for an existing identity. Similarity supplies candidates only; the tool MUST NOT merge ids or decide identity or record kind from similarity alone. It preserves explained memberships and relations when present, evaluates applicable active Checks, validates the result, and infers no authority from content.

A consumer conforms when it preserves Map and Area questions, explained memberships, anchor/context records, primary Map, state, relation notes, Content, References, Resources, Check boundaries, and publication selections. It MUST NOT present context as another identity, merge distinct ids, or erase provenance. Missing relations establish no absence of relationship or impact. Task-specific selection may be partial when it preserves the selected meaning and makes known gaps explicit.

Publication-profile support belongs to format and validator conformance. There is no publication-build, publisher, or portal conformance class. A valid profile does not establish build or serving guarantees.

Independent interoperability requires a second implementation to consume normative schemas and valid fixtures without importing the reference implementation. A read-only processor demonstrates consumer interoperability through schema-valid normalized output matching pinned and reference output. Validator conformance additionally requires agreement on every required invalid-fixture outcome and diagnostic.
