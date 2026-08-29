# Atlas Specification

This directory contains the complete public Atlas specification for **v0.7.0**.

Each requirement has one owning document. Another document may explain a consequence or processing step without redefining the requirement.

## Documents

- [Atlas Specification](SPEC.md) owns Atlas purpose, conceptual meaning, and the boundary between portable format and product claims.
- [Atlas Glossary](GLOSSARY.md) defines shared terminology.
- [Atlas Format](spec/FORMAT.md) owns the authored tree, core fields and vocabularies, and cross-record semantic constraints.
- [Atlas Processing](spec/PROCESSING.md) owns parsing, discovery, resolution, derivation, normalization, and ordering algorithms.
- [Atlas Validation](spec/VALIDATION.md) owns profiles, result states, diagnostics, fixture expectations, and reference command-line behavior.
- [Atlas Checks](spec/CHECKS.md) owns Check fields, bodies, and evaluation meaning.
- [Atlas Publication](spec/PUBLICATION.md) owns publication-profile fields, selection meaning, resolution, and normalized representation.
- [Atlas Conformance](spec/CONFORMANCE.md) owns conformance classes, claims, and limits.

## Supporting material

- [`schemas/`](schemas/) contains JSON Schema Draft 2020-12 schemas for authored data and generated output.
- [`examples/`](examples/) contains executable positive and negative conformance fixtures.

## Status

The normative specification documents have Working status. This is a pre-1.0 contract, and breaking changes remain possible.

The [public changelog](../CHANGELOG.md) records releases of this specification. Read the [contribution guide](../CONTRIBUTING.md) before proposing a change.
