# Atlas

> Portable, navigable project context for people and software agents · CC0 1.0 Universal

Atlas makes the context between project documents explicit, portable, and navigable.

Atlas helps people and software agents connect project documents to the decisions, questions, and perspectives they inform. It makes that context navigable without moving or duplicating the documents.

It gives those connections stable identity, explained context, explicit state and relations, and deterministic validation.

The current public release is **v0.7.0**. It is a pre-1.0 working release and defines Atlas format 1.

## Portable context model

- An **Atlas** is one portable boundary and namespace.
- A **Map** is a question-led semantic and authoring domain.
- An **Area** is an overlapping Map-local question. Each membership explains how a Point record affects that question.
- A **Point** combines exactly one anchor record with optional same-named context records under one Atlas-wide identity.
- A **Resource** identifies addressable project material without moving or duplicating it.
- **Checks** define Atlas-local write policy.
- A **publication profile** selects the Atlas records and registered Resources eligible for publication.

A shared consumer can use one validated Atlas model to generate document, Map, Area, Point, relation, and search navigation without project-specific semantic integration or UI development. This repository publishes the authored source, validation, and normalized consumer contract. It does not ship a portal implementation or define portal conformance.

## Specification

The [Atlas specification](spec/) defines the conceptual model, authored format, processing rules, validation profiles, Checks, publication profiles, and conformance requirements.

Start with:

- the [conceptual specification](spec/SPEC.md);
- the [glossary](spec/GLOSSARY.md);
- the [authored format](spec/spec/FORMAT.md);
- the [processing contract](spec/spec/PROCESSING.md);
- the [validation contract](spec/spec/VALIDATION.md);
- the [Checks contract](spec/spec/CHECKS.md);
- the [publication-profile contract](spec/spec/PUBLICATION.md); and
- the [conformance contract](spec/spec/CONFORMANCE.md).

Machine-readable schemas and executable valid and invalid fixtures are available under [`spec/`](spec/).

## Status

The specification documents have Working status. Breaking changes remain possible before 1.0.0. The [changelog](CHANGELOG.md) records public releases.

## Contributing

Read the [contribution guide](CONTRIBUTING.md) before proposing a change. Contact [info@neutral.dev](mailto:info@neutral.dev) with questions.

## License

The original material in this repository is dedicated under [CC0 1.0 Universal](LICENSE).
