# Atlas Format

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns the authored tree, structural files, core Atlas/Map/Point/Resource fields and vocabularies, and cross-record semantic constraints of Atlas format 1. Atlas Checks owns Check-specific fields and bodies. Atlas Publication owns publication-profile fields and selection meaning. Atlas Processing owns the algorithms that discover, parse, resolve, derive, and normalize the authored form, and Atlas Validation owns profiles and diagnostics. This document does not redefine those contracts.

The root `atlas.md` MUST contain `format: 1`. Other formats are outside the current contract and create no compatibility surface.

## Directory structure

```text
atlas/
├── atlas.md
├── .checks/
│   └── <check-id>.md
├── .publication/
│   └── <profile-id>.md
└── maps/
    ├── architecture/
    │   ├── map.md
    │   └── points/
    │       └── authentication-boundary.md
    └── operations/
        ├── map.md
        └── points/
            └── authentication-boundary.md
```

A descendant directory that directly contains `map.md` represents a Map. A Map MAY contain one direct `points/` directory beside `map.md`. Every regular Markdown file directly inside that directory is a Point record. The directory MUST NOT contain nested directories, symbolic links, or non-Markdown files.

The same Point filename MAY appear in more than one Map. Those files are records of one Atlas-wide Point identity.

A descendant directory that directly contains `atlas.md` represents a nested Atlas with an independent boundary. Atlas Processing defines discovery across that boundary.

Directory placement establishes only a Map’s physical location, the Map containing a Point record, and the primary Map when that record is the anchor. It does not create Areas, hierarchy, or Resource ownership.

## Structural files

Current structural files are root `atlas.md`, discovered `map.md`, Point records, direct root `.checks/*.md` files, and direct root `.publication/*.md` files.

Atlas Format reserves the root `.publication/` path. Atlas Publication defines the profile files permitted there.

Structural files MUST be regular files and MUST NOT be symbolic links. Atlas Processing interprets their text and bodies under its exact parsing and body-inspection rules.

## Identifiers

Identifiers match `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`.

Map and Resource identifiers are unique within one Atlas. Area identifiers are unique within one Map. Point identifiers are Atlas-wide. A Point record id MUST equal its filename without `.md`. A Check id MUST equal its filename.

## Atlas file

`atlas.md` conforms to `urn:atlas:schema:atlas:1` and requires `type: atlas`, `format: 1`, `id`, `title`, and `summary`. It may contain navigation, Resources, Content, References, and extensions.

Navigation groups contain a title and ordered non-empty Map list. One Map appears at most once across groups. Discovery is independent of navigation.

Each registered Resource contains id, uri, title, optional summary and media-type, and extensions. Registration creates stable identity, not authority.

## Map file

`map.md` conforms to `urn:atlas:schema:map:1` and requires type, id, title, summary, question, and status. Status is `draft`, `active`, or `archived`. Two discovered Maps MUST NOT use the same exact question value.

Each Area requires id, title, summary, and question. Two Areas in one Map MUST NOT use the same exact question value. Areas overlap and do not create hierarchy. Format 1 has no Layers.

## Point records

All Point records conform to `urn:atlas:schema:point:1` and require type, `record`, and id.

### Anchor

An anchor uses `record: anchor`. It requires title, summary, posture, and lifecycle and can contain kinds, Area memberships, Content, References, relations, review metadata, and extensions. Its containing Map is the primary Map. Its body MUST contain at least one substantive block. Format validity does not infer semantic quality from body length.

### Context

A context uses `record: context`. It requires summary and can contain Area memberships, Content, References, and extensions. It MUST NOT declare title, posture, lifecycle, kinds, relations, or review metadata.

A context MUST contribute an explained Area membership, Content, References, or a non-empty body. A non-empty body MUST contain at least one substantive block. Format validation does not infer semantic quality from body length.

Within one Atlas, every Point identity MUST have exactly one anchor, at most one record in each Map, no context record in its primary Map, and the same id and filename across all records. Atlas Processing defines how processors group and resolve those records.

### Area memberships

Each Point-record Area membership contains `area` and `context`. `area` resolves to an Area in the containing Map. `context` explains how or why the record answers, constrains, or materially affects that Area question. The same Area MUST NOT repeat in one record, even with different context text. A record MAY omit Area memberships.

```yaml
areas:
- area: incident-response
  context: Key-rotation failure changes the containment and recovery procedure.
- area: auditability
  context: Rotation events must leave evidence for later review.
```

### Kinds

- `decision`: a selected course, boundary, or choice.
- `constraint`: a condition that limits valid choices.
- `observation`: a recorded condition or finding that does not itself prescribe action.
- `question`: an unresolved information need.
- `proposal`: a candidate choice awaiting disposition.
- `direction`: a selected or advocated future course.
- `implementation`: a concrete system or artifact state that realizes context.
- `requirement`: a condition that must be satisfied.
- `risk`: an uncertain condition with a possible adverse consequence.
- `goal`: a desired outcome.
- `practice`: a repeatable way of working.

A kind can also use an `x-` extension. Kinds are non-exclusive and classify what a Point states. They do not establish posture, lifecycle, evidence strength, or implementation maturity.

### Posture

Posture is the Atlas author's stated stance toward the Point. It does not measure confidence, evidence strength, implementation maturity, or objective truth.

- `asserted`: the Atlas presents the Point as currently applicable or believed. This value does not prove truth, evidence strength, or completion.
- `open`: the Point records unresolved uncertainty or inquiry.
- `proposed`: the author presents the Point as a candidate rather than current direction.
- `intended`: the author presents the Point as a selected or desired future state. An intended Point does not establish current implementation.

### Lifecycle

- `active`: the Point participates in current context.
- `historical`: the author retains the Point to explain prior context, but the Point is not current direction.
- `superseded`: another Point replaces this Point through an incoming `supersedes` relation.
- `withdrawn`: the author retracted the Point. Withdrawal imposes no replacement requirement.

Lifecycle describes temporal standing. It does not establish posture, truth, authority, or evidence strength.

### Relations

Relations are directional from the declaring source Point to the named target Point:

- `supersedes`: the source replaces the target as current context; the target lifecycle is `superseded`.
- `depends-on`: the source requires the target for its validity or realization.
- `supports`: the source provides a reason, evidence, or capability that strengthens the target.
- `contradicts`: accepting the source excludes accepting the target as stated, and vice versa.
- `refines`: the source narrows or adds precision to the target without replacing it.
- `implements`: the source is a concrete realization of the target.

A relation type can also use an `x-` extension. Every relation requires a non-blank note that explains the specific source-to-target edge. A relation target MUST identify another Point in the same Atlas. A Point cannot relate to itself, relation pairs cannot repeat, and supersession MUST remain acyclic. A `supersedes` source requires its target to have lifecycle `superseded`, and every superseded Point requires an incoming `supersedes` relation. Validation establishes structure and named targets, not the truth of the note.

Review metadata MAY contain `reviewed-at`, `review-after`, and `by`. When both dates exist, `review-after` MUST be later than `reviewed-at`.

## Content and References

Content is primary. Reference roles have these meanings:

- `evidence`: material offered to support the truth of the record.
- `supporting`: explanatory or background material that is relevant but is not offered as direct evidence.
- `implementation`: a concrete realization of the record.
- `historical`: material retained to explain prior state or decisions.
- `example`: an illustration that does not establish authority or general truth.

A target names exactly one registered `resource` or direct `uri`. A registered target may contain a selector; a direct URI may contain its native fragment.

Format 1 has no `depth`, `placements`, `layers`, or `related_maps` field.

## Checks and extensions

Atlas Checks defines Check-specific fields and bodies. Atlas Publication defines publication-profile fields and selection. This document defines only their structural locations within the Atlas tree.

Authored objects MUST NOT contain unknown fields unless the field name begins with `x-`. Extensions cannot change standard meaning. Rewriting processors MUST preserve them.
