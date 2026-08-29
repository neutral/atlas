# Atlas Publication

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns publication-profile location, authored fields, selection meaning, reference resolution, and normalized representation. A publication profile consolidates the Atlas source records and registered documents that may be published.

This document does not define a compiler, rendered projection, index, search corpus, publisher, portal, deployment target, or conformance class for any of them. Those implementations own enforcement of the selected boundary across every output channel.

## Publication profiles

A publication profile is one regular Markdown file directly inside the optional root `.publication/` directory. The directory MUST NOT contain symbolic links, nested directories, or non-Markdown files. Each filename is the profile id followed by `.md`; the front-matter `id` MUST match that filename.

An Atlas MAY contain several profiles. Each profile is independent and MUST have a unique id. Profiles do not include or modify one another. When no profile is selected by a caller, the Atlas declares no material eligible for publication.

Profile front matter conforms to `urn:atlas:schema:publication:1` and requires `type`, `id`, `title`, `summary`, and `selection`. The body MAY explain the intended audience or editorial boundary. It does not select material.

```yaml
type: publication
id: public
title: Public Atlas
summary: Records and documents approved for the public Atlas.
selection:
  atlas: true
  maps:
  - architecture
  points:
    edge-authentication:
    - architecture
    - operations
  resources:
  - architecture-overview
  checks:
  - context-quality
```

Every selection category is required, including when its value is `false`, an empty array, or an empty object. This makes the complete boundary visible in one file.

## Selection units

Selection is an allowlist over authored source units:

- `atlas` selects the root Atlas record when `true`.
- `maps` selects exact Map records by id. A Map record includes its authored Areas.
- `points` maps each Point id to the containing Map ids of the exact Point records selected for that identity.
- `resources` selects exact registered Resources by id, including the registration and the document or artifact it addresses.
- `checks` selects exact Check records by id.

Every named Map, Point, Point-record Map, Resource, and Check MUST resolve within the same Atlas. Point-record selection uses the pair of Point id and containing Map id because one Point can have several authored records.

Selection does not expand. Selecting an Atlas does not select its Maps or Resources. Selecting a Map does not select its Point records. Selecting a Point record does not select another record of the same Point, a relation target, a referenced Resource, or a containing Map. Selecting a Resource does not follow links inside its target. Every source unit that may be published must appear in its own selection category.

A profile selects source units, not fields or excerpts within them. Identifiers, links, and prose authored inside a selected unit remain part of that unit. The profile does not define how a build projects, filters, indexes, or renders selected source.

## Processing and normalized representation

Structural processing discovers every direct profile file, applies the publication schema, verifies filename identity, and rejects invalid entries or duplicate profile ids.

Resolved processing verifies every selected identifier and Point-record pair. A complete valid resolved result normalizes profiles in id order. Within each profile, Map, Resource, and Check ids sort by Unicode code point. Point selections sort by Point id; each selected record sorts by Map id and includes its resolved `kind` and source `path`.

Normalized profiles appear in `publicationProfiles` under `urn:atlas:schema:normalized:1`. An invalid or incomplete result exposes no normalized model.

## Implementation boundary

The profile is the complete Atlas-authored publication decision. It contains no deployment credentials, targets, retrieval policy, copy policy, rendering options, or claims about whether a downstream system enforced it.

A portal or build pipeline can consume the resolved selection as input to a separately specified publication build. Preventing unselected records or documents from appearing in pages, navigation, indexes, search, machine routes, diagnostics, caches, or other generated channels is the responsibility of that build and serving system, not an authored profile field.
