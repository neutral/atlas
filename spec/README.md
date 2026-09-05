# Atlas format 1 specification

Start with [Working with Atlas](OPERATING.md), the compact absorb and route contract for people and agents. Load reference detail only when the task needs it.

Each requirement has one owner:

- `OPERATING.md` owns the shared operating rules. It requires no runtime or edit workflow.
- `SPEC.md` owns purpose and conceptual meaning, including Point identity and independent change.
- `GLOSSARY.md` indexes the terminology.
- `spec/FORMAT.md` owns authored files, fields, vocabularies, and cross-record constraints.
- `spec/PROCESSING.md` owns discovery, parsing, resolution, normalization, and ordering.
- `spec/VALIDATION.md` owns profiles, diagnostics, results, and fixtures.
- `spec/CHECKS.md`, `spec/PUBLICATION.md`, and `spec/CONFORMANCE.md` own their named contracts.

[`schemas/`](schemas/README.md) contains JSON Schema Draft 2020-12 contracts. [`examples/`](examples/README.md) supplies executable format evidence and a [copyable starter](examples/starter/README.md). Structural validation does not establish semantic usefulness.

Revision 0.8.0 defines format 1 with JSON front matter and Markdown bodies. Immutable specification and processor revisions identify the exact contract. Other formats remain outside this contract.
