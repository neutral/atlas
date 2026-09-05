# Atlas

> Portable, navigable project context for people and software agents · CC0 1.0 Universal or Zero-Clause BSD

Atlas connects project material to the decisions, questions, and perspectives it informs without moving or duplicating that material. Stable identities, explained connections, and explicit state support both absorption and routing.

This repository publishes the Atlas specification, reusable Checks, the reference validator, and Atlas Portal. The current public release is **v0.8.0**. It defines Atlas format 1.

## Work with Atlas

Start with [Working with Atlas](spec/OPERATING.md), then the [copyable example](spec/examples/starter/README.md). The [minimal Atlas](spec/examples/valid/minimal/atlas.md) is sufficient for a one-Map start. Load field details and local Checks only when needed.

Atlas records use JSON front matter between `---` delimiter lines and Markdown bodies. Absorb makes the smallest useful contribution, including no edit for repeated meaning. Route returns relevant context and sources. Neither needs a runtime, publication setup, or a mandatory Check catalog.

## Portable context model

- An **Atlas** is one portable boundary and namespace.
- A **Map** is a question-led semantic and authoring domain.
- An **Area** is an overlapping Map-local question. Each membership explains how a Point record affects that question.
- A **Point** combines one anchor with optional same-named context records under one Atlas-wide identity. Shared subject matter alone is not shared identity.
- A **Resource** identifies addressable project material without moving or duplicating it.
- **Checks** add adopted local write requirements without redefining meaning or granting authority.
- A **publication profile** selects the Atlas records and registered Resources eligible for publication.

Atlas Portal uses this validated model to generate document, Map, Area, Point, relation, and search navigation without project-specific UI development.

## Repository layout

- [`spec/`](spec/) contains the normative specification, schemas, and fixtures.
- [`checks/`](checks/) contains optional reusable Checks.
- [`tools/atlas-portal/`](tools/atlas-portal/) contains the static reader and site generator.
- [`tools/validator/`](tools/validator/) contains the reference validator.
- [`tools/`](tools/) contains Atlas Portal and the reference validator.

The specification and Atlas files can be used without installing these tools.

## Specification

Load these reference contracts as needed:

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
corepack pnpm@11.22.0 --dir tools install --frozen-lockfile
```

Create a Portal configuration file, for example `/absolute/path/to/portal.json`:

```json
{ "name": "Atlas" }
```

Start a local portal:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/portal.json" \
  --resource-root "/absolute/path/to/project"
```

The site opens at `http://127.0.0.1:4321/` by default. See the [Atlas Portal guide](tools/atlas-portal/README.md) for static builds, previews, Cloudflare deployment, and the complete command surface.

## Validate an Atlas

The reference validator implements the structural and resolved validation profiles:

```text
corepack pnpm@11.22.0 --dir tools exec atlas-validate "/absolute/path/to/project/atlas" \
  --profile neutral.atlas-validator.resolved \
  --json
```

See the [validator guide](tools/validator/README.md) for fixture and exit-status behavior.

## Status

The specification documents have Released status. Breaking changes remain possible before 1.0.0. The [changelog](CHANGELOG.md) records public releases.

## Contributing

Read the [contribution guide](CONTRIBUTING.md) before proposing a change. Contact [info@neutral.dev](mailto:info@neutral.dev) with questions.

## License

The original material in this repository is available under [CC0 1.0 Universal or Zero-Clause BSD](LICENSE), at the recipient’s option. [Third-party material](THIRD_PARTY.md) retains its own terms.
