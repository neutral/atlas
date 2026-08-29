# Atlas Specification

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns Atlas purpose and conceptual meaning. It defines what an Atlas, Map, Area, Point, Resource, Content edge, Reference edge, relation, and Check mean independently of one file encoding or implementation.

The specialized contracts own executable detail. Atlas Format owns the authored tree, core fields, vocabularies, and cross-record constraints. Atlas Processing owns algorithms and derived data. Atlas Validation owns profiles, results, diagnostics, and fixtures. Atlas Checks owns authored Check and evaluation contracts. Atlas Publication owns the publication boundary. Atlas Conformance owns conformance claims. A summary here does not create a second definition of an owned rule.

Portal interaction, authoring applications, deployment, and empirical product-study protocols are outside this specification set unless a named contract explicitly defines them.

## Purpose and minimum product contract

Atlas makes the context between project documents explicit, portable, and navigable.

Atlas helps people and software agents connect project documents to the decisions, questions, and perspectives they inform, making that context navigable without moving or duplicating the documents.

It gives those connections stable identity, explained context, explicit state and relations, and deterministic validation.

At minimum, a conforming Atlas supplies one portable source model. A shared consumer can use that model to generate consistent document, Map, Area, Point, relation, and search navigation without project-specific semantic integration or UI development. Existing documents remain direct Resources and keep their own organization.

The Atlas format defines the authored source, validation, and normalized consumer contract for that shared portal. It does not ship a portal implementation or define portal conformance. Those remain separately identified product work rather than implied format behavior.

Atlas context records can:

- state decisions, constraints, questions, observations, proposals, directions, implementations, risks, goals, or practices in their own right;
- retain one identity while several durable subjects add their own context;
- distinguish current, historical, withdrawn, and superseded context;
- relate claims and evidence explicitly;
- give people and software agents a clear place to deposit information; and
- support deterministic consumption without requiring processors to infer semantics from document paths or prose.

## Thesis

Atlas is a portable semantic context layer for projects. Documents remain the primary long-form reading surfaces. Atlas records why documents matter, where records belong, how interpretations change over time, and how records relate. A shared portal can render those authored meanings without requiring each project to invent another data model or interface.

The write path is a first-class design constraint. A person or agent first chooses the Map whose primary question the new information answers or materially affects. It then either establishes a new Point in that Map or adds Map-local context to an existing Point.

## First-principles constraints

1. Maps remain durable semantic and authoring domains. They are not presentation-only views.
2. A Point has one Atlas-wide identity and one primary Map, but no Map has exclusive control over all future context for that Point.
3. One Point can have records in several Maps. Exactly one record is the anchor; the others are Map-local contexts.
4. Every record for one Point uses the same Atlas-wide identity.
5. Areas are Map-local, overlapping memberships. The format has no Layer primitive.
6. Point posture and lifecycle are independent and do not establish evidence strength or implementation maturity.
7. Relations are explicit, directional, explained, and attached to the anchor record.
8. Content identifies primary material. References carry typed supporting roles. The format has no Depth primitive.
9. Processors derive related Maps from shared Point records.
10. Checks govern the write path and remain separate from mapped context.
11. A portable consumer preserves authored meaning and provenance rather than reconstructing them from presentation or filesystem convention.
12. Publication eligibility is an explicit profile decision outside the core Atlas, Map, Area, Point, Resource, and Check records.

## Conceptual model

### Atlas

An Atlas is one portable context boundary and namespace. It contains Maps, Point records, Resources, Checks, and optional publication profiles.

An Atlas can register stable Resource identities, describe collection-wide context, and suggest navigation among its Maps.

### Map

A Map is a durable subject and deposit domain with a stable identifier, primary question, overlapping Area vocabulary, lifecycle status, and Point records that establish or extend context relevant to the Map.

A Map is appropriate when an author can reliably decide that new information answers, constrains, or materially affects its primary question. The question is the Map's durable routing criterion; Atlas Format owns its authored and uniqueness constraints.

### Area

An Area is a non-exclusive Map-local region or concern. Areas can overlap. Each Area states a placement question that helps a human or agent decide whether a Point record belongs there. Atlas Format owns the question's authored and Map-local uniqueness constraints.

A Point record names an Area through an explained membership. The membership identifies the Area and states how or why the record affects the Area question. It is a semantic edge, not a bare routing tag.

Areas do not imply hierarchy, ownership, exclusivity, geometric containment, or directory placement.

### Point

A Point is an Atlas-wide context identity represented by one or more authored records.

Every Point has exactly one anchor record, one primary Map established by that anchor, zero or more context records in other Maps, and one shared identity across all records. Atlas Format defines the physical identity and filename constraints.

The anchor record states the Point’s canonical core: title, summary, kinds, posture, lifecycle, explained primary-Map Area memberships, Content, References, relations with notes, review metadata, and substantive body.

A context record adds Map-local meaning through a local summary, explained Area memberships, Content, References, and optional substantive body. It does not redefine the Point’s title, posture, lifecycle, kinds, relations, or review state. One explained Area membership is a substantive context contribution and can support a bodyless context record.

The primary Map anchors identity and provenance. It does not create an exclusive authoring boundary. Another Map can add context through its own same-named Point file.

### Point record

A Point record is one authored contribution for a Point in one Map. Atlas Format defines its physical representation.

The anchor record establishes the Point and its primary Map.

A context record extends that Point in another Map through a local contribution rather than an unexplained duplicate.

### Posture

Posture records how the Atlas author presents a Point: as applicable, unresolved, still a candidate, or selected as a future direction. Posture remains independent of lifecycle and does not establish truth, evidence strength, or implementation maturity. Atlas Format owns the exact vocabulary and field constraints.

### Lifecycle

Lifecycle records a Point's temporal standing: whether it participates in current context, explains prior context, yields to a replacement, or no longer applies. Lifecycle remains independent of posture. Atlas Format owns the exact vocabulary and replacement constraints. Atlas Processing owns graph resolution.

### Point kinds

Kinds are non-exclusive classifications of what a Point states. They help consumers distinguish such roles as decisions, observations, questions, implementations, requirements, and risks without turning that classification into posture, lifecycle, or evidence strength. Atlas Format owns the exact vocabulary and extension rule.

### Relations

Relations are directional, explained edges between Atlas-wide Point identities. The anchor record declares them so their meaning has one canonical source. Atlas Format owns the relation vocabulary and graph constraints. Atlas Processing owns resolution and reverse indexes. A relation does not grant authority, ownership, truth, or causality beyond its explained edge.

### Resource

A Resource is an addressable document or artifact. The Atlas can register a stable Resource identifier separately from its URI.

### Content and References

Content identifies primary material. References use typed roles to distinguish evidence, background, implementation, history, and examples. Atlas Format owns the exact role vocabulary.

### Derived Map relationships

A processor derives Map overlap when one Point has records in more than one Map. The result records symmetric shared context and no other relationship.

### Check

A Check is project-defined authoring policy outside mapped context. Checks can constrain an authorized write process but cannot grant operational authority or convert a policy result into semantic truth. Atlas Checks owns their authored and evaluation contracts; Atlas Conformance owns the scope of a Check-compliance claim.

### Publication profile

A publication profile is an explicit allowlist of Atlas source records and registered documents that may be published. It is separate from the core context model: Atlas, Map, Area, Point, Resource, relation, and Check records contain no publication field and do not imply eligibility.

Profiles select exact units without expanding through containment, shared Point identity, relations, or References. Atlas Publication owns the authored and resolved selection contract. Publication builds and portals separately own projection, non-disclosure, serving, and deployment behavior.

## Product and conformance boundary

The baseline product proposition is reusable generation: one shared portal implementation can consume any conforming Atlas without project-specific semantic mapping or UI development. This specification supplies the portable input and normalized consumer meaning needed to test that proposition. It does not define portal behavior or establish that a portal has achieved reusable generation.

Format conformance, Check compliance, self-hosting, and processor interoperability establish only their named technical claims. Reader, author, agent, accessibility, performance, maintenance-cost, or comparative-benefit claims require separately designed and recorded evidence. Those evidence protocols may inform future specification changes, but they are not themselves format requirements.
