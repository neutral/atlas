# Atlas Validation

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns validator profiles, result states, diagnostic codes, fixture expectations, and reference CLI behavior. Atlas Format owns the validated constraints, and Atlas Processing owns the algorithms that inspect and resolve them. A diagnostic description identifies the failed condition without becoming a second definition of that condition.

## Results and profiles

A result contains profile, complete, valid, specificationRevision, implementation, ordered diagnostics, and optional normalized output. It MUST contain normalized output only for a complete valid resolved result and MUST omit normalized output in every other state. Invalid input can still be complete; unsupported profiles and implementation failures are incomplete.

`neutral.atlas-validator.structural` reports failures available after bounded discovery, parsing, schema validation, structural-location checks, body inspection, Check-shape inspection, identifier checks, and within-file duplicate checks.

`neutral.atlas-validator.resolved` additionally reports failures available after navigation, Point-group, Area, Resource, relation, supersession, publication-selection, and local-target resolution. It produces derived overlap and normalized output only when processing is complete and valid.

General Check evaluation is separate from validator profiles. Publication profiles use the same structural and resolved validation stages as the rest of the authored Atlas.

## Output contracts

Publication profile front matter conforms to `urn:atlas:schema:publication:1`. The normalized Atlas conforms to `urn:atlas:schema:normalized:1`. A validator result conforms to `urn:atlas:schema:validation-result:1`. The executable fixture manifest conforms to `urn:atlas:schema:fixture-manifest:1`. Project Check evaluation can use `urn:atlas:schema:check-evaluation:1` without becoming a generic validator profile.

The reference CLI MUST exit with `0` for a complete valid result or matching fixture matrix, `1` for a complete invalid result or fixture mismatch, and `2` for invalid usage or an incomplete result.

The working reference implementation identifies itself as version `0.7.0` with status `working`. Its default specification revision is `0.7.0`; callers MAY supply a more specific immutable revision identifier.

## Standard diagnostics

### Discovery and locations

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.discovery.root-not-found` | error | No regular Atlas root exists. |
| `atlas.discovery.nested-atlas-boundary` | information | Discovery stops at a nested Atlas. |
| `atlas.discovery.symbolic-link` | error | A structural or reserved structural location is a symlink. |
| `atlas.processing.io` | error | Required inspection could not complete. |
| `atlas.map.invalid-location` | error | Map structural file is outside its location. |
| `atlas.map.duplicate-id` | error | Map id repeats. |
| `atlas.map.unlisted` | information | Discovered Map is absent from navigation. |
| `atlas.point.invalid-location` | error | Point record or points entry is invalid. |
| `atlas.point.filename-mismatch` | error | Point id and filename differ. |
| `atlas.check.invalid-location` | error | Check entry or location is invalid. |
| `atlas.check.filename-mismatch` | error | Check id and filename differ. |
| `atlas.check.duplicate-id` | error | Check id repeats. |
| `atlas.publication.invalid-location` | error | Publication directory or entry is outside its permitted direct root location or shape. |
| `atlas.publication.filename-mismatch` | error | Publication profile id and filename differ. |
| `atlas.publication.duplicate-id` | error | Publication profile id repeats. |
| `atlas.validation.unknown-profile` | error | Requested profile is unsupported. |

### Text, YAML, and schema

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.text.invalid-utf8` | error | Text is not valid UTF-8. |
| `atlas.text.bom` | error | Structural text begins with BOM. |
| `atlas.text.nul` | error | Structural text contains NUL. |
| `atlas.frontmatter.missing` | error | Front matter is absent. |
| `atlas.frontmatter.unclosed` | error | Front matter is unclosed. |
| `atlas.frontmatter.invalid-yaml` | error | YAML violates the profile. |
| `atlas.frontmatter.schema` | error | Object fails schema. |
| `atlas.format.unsupported` | error | Root format is not 2. |

### Point records

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.point.anchor-body-empty` | error | Anchor body has no substantive block. |
| `atlas.point.context-body-empty` | error | Authored context body has no substantive block. |
| `atlas.point.context-empty` | error | Context contributes nothing. |
| `atlas.point.missing-anchor` | error | Context group has no anchor. |
| `atlas.point.multiple-anchors` | error | Point has several anchors. |
| `atlas.point.context-in-primary-map` | error | Context occurs in primary Map. |
| `atlas.point.duplicate-map-record` | error | Point has several records in one Map. |
| `atlas.point.invalid-review-window` | error | Review window is invalid. |

### Navigation and Areas

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.navigation.unknown-map` | error | Navigation names unknown Map. |
| `atlas.navigation.duplicate-map` | error | Map repeats across navigation. |
| `atlas.map.duplicate-question` | error | Two Maps use the same exact question. |
| `atlas.area.duplicate-id` | error | Area id repeats in one Map. |
| `atlas.area.duplicate-question` | error | Two Areas in one Map use the same exact question. |
| `atlas.area.duplicate-membership` | error | A Point record names one Area more than once. |
| `atlas.area.unknown` | error | Record names unknown containing-Map Area. |

### Relations and lifecycle

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.relation.unknown-point` | error | Relation target is unknown. |
| `atlas.relation.self` | error | Point relates to itself. |
| `atlas.relation.duplicate` | error | Relation pair repeats. |
| `atlas.relation.supersedes-cycle` | error | Supersession cycle exists. |
| `atlas.lifecycle.superseded-without-replacement` | error | Superseded Point has no replacement. |
| `atlas.lifecycle.supersedes-target-not-superseded` | error | Supersedes target is not superseded. |

### Resources

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.resource.duplicate-id` | error | Resource id repeats. |
| `atlas.reference.duplicate` | error | Target repeats in one list. |
| `atlas.reference.invalid-uri` | error | URI is invalid or prohibited. |
| `atlas.reference.unknown-resource` | error | Resource id is unknown. |
| `atlas.reference.missing-local-target` | error | Local target is missing. |
| `atlas.reference.path-case-mismatch` | error | Path differs by case/normalization. |
| `atlas.reference.symlink` | error | Target path traverses a symlink. |
| `atlas.reference.prohibited-target` | error | Core target is structural/policy/reserved. |
| `atlas.reference.external-local` | information | A direct target or one registered Resource target leaves Atlas and is not read. |

### Checks

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.check.required-section` | error | Required Check heading absent/repeated. |
| `atlas.check.section-order` | error | Check headings are out of order or unsupported. |
| `atlas.check.section-empty` | error | Required section is empty. |

### Publication profiles

| Code | Severity | Condition |
| --- | --- | --- |
| `atlas.publication.unknown-map` | error | Profile selects an unknown Map. |
| `atlas.publication.unknown-point` | error | Profile selects an unknown Point. |
| `atlas.publication.unknown-point-record` | error | Profile selects no record for the Point in the named Map. |
| `atlas.publication.unknown-resource` | error | Profile selects an unknown Resource. |
| `atlas.publication.unknown-check` | error | Profile selects an unknown Check. |

Diagnostics MUST sort by Unicode code-point order over path, line, column, code, and message. The fixture manifest pins complete, valid, exact ordered codes, and optional normalized output. Omission of an expected normalized snapshot disables only that comparison; it does not require normalized output to be absent from a complete valid resolved result.
