# Atlas Format

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns the authored tree, structural files, core Atlas/Map/Point/Resource fields and vocabularies, and cross-record semantic constraints of Atlas format 2. Atlas Checks owns Check-specific fields and bodies. Atlas Publication owns publication-profile fields and selection meaning. Atlas Processing owns the algorithms that discover, parse, resolve, derive, and normalize the authored form, and Atlas Validation owns profiles and diagnostics. This document does not redefine those contracts.

The root `atlas.md` MUST contain `"format": 2`. Other formats MUST be rejected
explicitly. Processors MUST NOT convert unsupported authored input or reinterpret
old headers as current records.

## Directory structure

```text
atlas/
├── atlas.md
├── catalog.json
├── connections.json
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

The same Point filename MAY appear in more than one Map. Exact header IDs determine whether those files record one Atlas-wide Point identity.

Exact authored Point ids determine identity. Distinct Point ids MUST denote distinct Point identities even when their titles, summaries, bodies, Content, References, or relation neighborhoods are similar.

A descendant directory that directly contains `atlas.md` represents a nested Atlas with an independent boundary. Atlas Processing defines discovery across that boundary.

Directory placement establishes only a Map’s physical location, the Map containing a Point record, and the primary Map when that record is the anchor. It does not create Areas, hierarchy, or Resource ownership.

## Structural files

Current structural files are root `atlas.md`, `catalog.json`, `connections.json`,
discovered `map.md`, Point records, direct root `.checks/*.md` files, and direct
root `.publication/*.md` files. The two global JSON files are REQUIRED. An empty
object is valid when no declarations are needed.

Atlas Format reserves these global paths and the root `.publication/` path.
They MUST NOT be selectable Resource targets or cache destinations. Atlas
Publication defines the profile files permitted there.

Structural files MUST be regular files and MUST NOT be symbolic links. Markdown
records use JSON front matter between `---` delimiter lines. Global files contain
one strict JSON object without Markdown delimiters. Atlas Processing owns parsing.

## Local headers

Local headers own identity and authored state:

- Atlas: `type`, `format`, `id`.
- Map: `type`, `id`, `status`.
- Point anchor: `type`, `record`, `id`, `posture`, `lifecycle`.
- Point context: `type`, `record`, `id`.
- Check: `type`, `id`, `status`.

These headers MUST NOT contain any other fields, including extensions. Global
files reference identities without duplicating state or document paths. A
publication profile retains its separately owned header contract.

## Global catalog

`catalog.json` conforms to `urn:atlas:schema:catalog:2`. It contains optional
arrays with these responsibilities:

- `navigation`: groups with short `title` labels and ordered `maps` identities.
- `areas`: Map-local definitions with `map`, `id`, and short `title`.
- `resources`: shared registrations with `id`, `uri`, short `title`, and optional
  `media-type`.
- `points`: one entry per classified or reviewed Point, with `point`, optional
  `kinds`, and optional `review`.
- `checks`: exactly one registration for every discovered Check, with `check`,
  `level`, and `applies-to`. No registration creates an undiscovered Check.
- `extensions`: one entry per exact `owner`, with nonempty `values` containing
  only `x-` fields.

Each registration MUST resolve its declared owner. Duplicate Area identities
within a Map, Resource identities, Point registrations, Check registrations, or
extension owners are invalid. Catalog entries MUST NOT inventory document paths.

## Global connections

`connections.json` conforms to `urn:atlas:schema:connections:2`. Its optional
arrays contain explicitly identified uses and relationships:

- `memberships`: `id`, `point`, `map`, and `area`.
- `relations`: `id`, `source`, `type`, and `target` Point identities.
- `content`: `id`, `owner`, and `target`.
- `references`: `id`, `owner`, `target`, and `role`.

Connection IDs MUST be unique across all four arrays. They remain stable when
an explanation or target changes. A new ID MUST NOT be inferred from paragraph
order or wording.

An owner is exactly one of `{ "type": "atlas" }`,
`{ "type": "map", "map": "<id>" }`,
`{ "type": "area", "map": "<id>", "area": "<id>" }`, or
`{ "type": "point", "map": "<id>", "point": "<id>" }`.
Extension owners additionally permit `{ "type": "check", "check": "<id>" }`.
A Point owner identifies its exact Map-local record. A directional relation
addresses Point identities and belongs to its source anchor.

A target contains exactly `resource` and optional `selector`, or `uri`, with an
optional short `label`. Registered Resource definitions occur once; each Content
or Reference use owns its target selection and role. Existing `x-` extensions
remain opaque on global objects and entries where their schemas permit them.

## Markdown meaning

Every structural document MUST contain one top-level H1 followed by an opening paragraph. The H1 supplies its title. The paragraph supplies its summary. These fields MUST NOT appear in front matter. Point anchor summaries state canonical ideas. Context summaries state local significance. Atlas Processing defines exact extraction and association rules.

Declared sections associate Markdown with exact global entries:

- Map question: `## Question`.
- Area summary: the opening paragraph under `## Area: <area-id>` in its Map.
- Area question: `### Question` inside that Area section.
- Resource description: `## Resource: <resource-id>` in the Atlas root.
- Connection explanation: `## Connection: <connection-id>` in its owning
  document. Area-owned uses have `### Connection: <connection-id>` inside their
  Map's declared Area section.

Map and Area questions, Area summaries, membership explanations, and relation
explanations are REQUIRED. Content and Reference explanations and Resource
descriptions are OPTIONAL. A present entry MUST contain substantive text, resolve
the exact declared object in its owner, and occur once. Arbitrary prose and other
headings MAY provide further explanation without creating a connection.

Membership explanations belong to the exact Point-and-Map record. Relation
explanations belong to the source anchor. A context cannot supply the anchor's
explanation. Similar wording, position, or an old `Area:`, `Relation:`, or
`Reference:` heading in a Point MUST NOT create a format 2 connection association.

```markdown
# Session storage boundary

Session records belong in the shared store so every API instance observes the same state.
```

This body is sufficient for an anchor with no memberships or relations. The corresponding front matter retains type, record designation, id, posture, and lifecycle.

## Identifiers

Identifiers match `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`.

Map and Resource identifiers are unique within one Atlas. Area identifiers are unique within one Map. Point identifiers are Atlas-wide. Point, Check, and publication identities come from local headers. Their filenames MAY change without changing identity. Creation tools can default to `<id>.md`.

## Atlas file

`atlas.md` conforms to `urn:atlas:schema:atlas:2` and requires `"type": "atlas"`, `"format": 2`, `id`. Its local header contains no collection metadata or connections. The Library assembles these from the global files.

Navigation groups contain a title and ordered non-empty Map list. One Map appears at most once across groups. Discovery is independent of navigation.

Each registered Resource contains id, uri, a short title, optional media-type, and extensions. Its optional summary comes from its Markdown Resource entry. Registration creates stable identity, not authority.

## Map file

`map.md` conforms to `urn:atlas:schema:map:2` and requires type, id, and status. Its title, summary, and question come from Markdown. Status is `draft`, `active`, or `archived`. Two discovered Maps MUST NOT use the same exact question value.

Each Area requires its Map id, Area id, and a short title in the catalog and a summary and question in its Markdown entry. Two Areas in one Map MUST NOT use the same exact question value. Areas overlap and do not create hierarchy. Format 2 has no Layers.

## Point records

All Point records conform to `urn:atlas:schema:point:2` and require type, `record`, and id.

### Anchor

An anchor uses `"record": "anchor"`. It requires posture and lifecycle in JSON, a Markdown title and summary, and receives classifications, Area memberships, Content, References, relations, review metadata, and extensions from its global entries. Its containing Map is the primary Map. The opening paragraph states the canonical idea. A heading and one clear paragraph are sufficient when no membership or relation requires explanation. Checks MAY require additional explanation. Format validity does not infer semantic quality from body length.

### Context

A context uses `"record": "context"`. Its opening paragraph states local significance. Its global entries can declare Area memberships, Content, References, and extensions. Its local header MUST NOT declare posture or lifecycle. Classification, relations, and review remain canonical Point metadata. Its local heading does not replace the anchor title.

The context opening paragraph supplies its local contribution. Additional sections explain declared memberships or References when needed. Format validation does not infer semantic quality from body length.

Within one Atlas, every Point identity MUST have exactly one anchor, at most one record in each Map, no context record in its primary Map, and the same exact id across all records. Atlas Processing defines how processors group and resolve those records.

### Area memberships

Each membership names an exact Point, Map, and Area in `connections.json`.
The Point record MUST exist in that Map, and the Area MUST belong to that Map.
Its Markdown Connection entry explains how the record answers, constrains, or
materially affects the Area question. The same Area MUST NOT repeat in one
record. A record MAY omit memberships.

```json
{
  "memberships": [
    { "id": "rotation-audit", "point": "key-rotation", "map": "operations", "area": "auditability" }
  ]
}
```

```markdown
## Connection: rotation-audit

Rotation events must leave evidence for later review.
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

Lifecycle does not require retained ancestry or an audit trail. Retained Points
describe context with a present explanatory purpose. Authors MAY remove an
unnecessary Point and update its declarations and connections in the same change.
Remaining identities stay stable, and remaining references and relations MUST
resolve. Git retains committed earlier versions.

### Relations

Relations are directional from the declaring source Point to the named target Point:

- `supersedes`: the source replaces the target as current context; the target lifecycle is `superseded`.
- `depends-on`: the source requires the target for its validity or realization.
- `supports`: the source provides a reason, evidence, or capability that strengthens the target.
- `contradicts`: accepting the source excludes accepting the target as stated, and vice versa.
- `refines`: the source narrows or adds precision to the target without replacing it.
- `implements`: the source is a concrete realization of the target.

A relation type can also use an `x-` extension. Every relation requires a stable connection ID and a non-blank Markdown explanation associated with that ID. Processors expose that explanation as the relation note. A relation target MUST identify another Point in the same Atlas. A Point cannot relate to itself, relation pairs cannot repeat, and supersession MUST remain acyclic. A `supersedes` source requires its target to have lifecycle `superseded`, and every superseded Point requires an incoming `supersedes` relation. Validation establishes structure and named targets, not the truth of the note.

These supersession constraints explain replacement among retained Points. They
do not require a current Point to retain an otherwise unnecessary predecessor.

The relation graph is open-world: relations record known authored edges. Omitting a relation has no negative or completeness meaning and does not state that no relationship or impact exists.

Review metadata MAY contain `reviewed-at`, `review-after`, and `by`. When both dates exist, `review-after` MUST be later than `reviewed-at`.

## Content and References

Content is primary. Reference roles have these meanings:

- `evidence`: material offered to support the truth of the record.
- `supporting`: explanatory or background material that is relevant but is not offered as direct evidence.
- `implementation`: a concrete realization of the record.
- `historical`: material retained to explain prior state or decisions.
- `example`: an illustration that does not establish authority or general truth.

A target names exactly one registered `resource` or direct `uri`. A registered target may contain a selector; a direct URI may contain its native fragment.

Format 2 has no `depth`, `placements`, `layers`, or `related_maps` field.

## Checks and extensions

Atlas Checks defines Check-specific fields and bodies. Atlas Publication defines publication-profile fields and selection. This document defines only their structural locations within the Atlas tree.

Local headers permit only their listed fields. Global objects and entries permit `x-` fields only where their schema declares extension support. Extensions cannot change standard meaning. Rewriting processors MUST preserve them and MUST NOT copy them back into local headers.

An `x-` field MUST NOT occur both on a Content or Reference connection and on
its `target`. When catalog metadata and `catalog.extensions` address the same
Area, Point anchor, or Check, their `x-` field names MUST be disjoint. Equal values
do not permit duplicate ownership. Point contexts remain separate owners from
their canonical anchor.
