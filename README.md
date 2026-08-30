# Atlas

> Portable, navigable project context for people and software agents · CC0 1.0 Universal

Atlas makes the context between project documents explicit, portable, and navigable.

Atlas helps people and software agents connect project documents to the decisions, questions, and perspectives they inform. It makes that context navigable without moving or duplicating the documents.

It gives those connections stable identity, explained context, explicit state and relations, and deterministic validation.

This repository publishes the Atlas specification, reusable Checks, the reference validator, and Atlas Portal. The current public release is **v0.7.0**. It is a pre-1.0 working release and defines Atlas format 1.

## Portable context model

- An **Atlas** is one portable boundary and namespace.
- A **Map** is a question-led semantic and authoring domain.
- An **Area** is an overlapping Map-local question. Each membership explains how a Point record affects that question.
- A **Point** combines exactly one anchor record with optional same-named context records under one Atlas-wide identity.
- A **Resource** identifies addressable project material without moving or duplicating it.
- **Checks** define Atlas-local write policy.
- A **publication profile** selects the Atlas records and registered Resources eligible for publication.

Atlas Portal uses this validated model to generate document, Map, Area, Point, relation, Check, and search navigation without project-specific UI development.

## Repository layout

- [`spec/`](spec/) contains the normative specification, schemas, and fixtures.
- [`checks/`](checks/) contains optional reusable Checks.
- [`tools/atlas-portal/`](tools/atlas-portal/) contains the static reader and site generator.
- [`tools/validator/`](tools/validator/) contains the reference validator.
- [`tools/`](tools/) contains Atlas Portal and the reference validator.

The specification and Atlas files can be used without installing these tools.

## Specification

Start with:

- the [conceptual specification](spec/SPEC.md);
- the [glossary](spec/GLOSSARY.md);
- the [authored format](spec/spec/FORMAT.md);
- the [processing contract](spec/spec/PROCESSING.md);
- the [validation contract](spec/spec/VALIDATION.md);
- the [Checks contract](spec/spec/CHECKS.md);
- the [publication-profile contract](spec/spec/PUBLICATION.md); and
- the [conformance contract](spec/spec/CONFORMANCE.md).

## Build an Atlas Portal

Atlas Portal validates one Atlas, applies one publication profile, and generates a complete static reader.

Install the optional tools:

```text
corepack enable
pnpm --dir tools install --frozen-lockfile
```

Start a local portal:

```text
pnpm --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project"
```

The site opens at `http://127.0.0.1:4321/` by default. See the [Atlas Portal guide](tools/atlas-portal/README.md) for static builds, previews, Cloudflare deployment, and the complete command surface.

## Validate an Atlas

The reference validator implements the structural and resolved validation profiles:

```text
pnpm --dir tools exec atlas-validate "/absolute/path/to/project/atlas" \
  --profile neutral.atlas-validator.resolved \
  --json
```

See the [validator guide](tools/validator/README.md) for fixture and exit-status behavior.

## Status

The specification documents have Working status. Breaking changes remain possible before 1.0.0. The [changelog](CHANGELOG.md) records public releases.

## Contributing

Read the [contribution guide](CONTRIBUTING.md) before proposing a change. Contact [info@neutral.dev](mailto:info@neutral.dev) with questions.

## License

The original material in this repository is dedicated under [CC0 1.0 Universal](LICENSE).
