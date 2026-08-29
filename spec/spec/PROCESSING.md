# Atlas Processing

> Status: Working

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns deterministic parsing, discovery, body inspection, cross-file resolution, derivation, normalization, and ordering. Atlas Format owns the authored constraints and field meanings that these algorithms consume. Atlas Validation owns profiles, result states, and diagnostic codes. Atlas Checks owns Check syntax and evaluation, and Atlas Publication owns publication behavior. A processing rule does not redefine those contracts. Normative prose has precedence over schemas.

## Text and YAML

Processors decode structural text as strict UTF-8 and reject a byte-order mark or NUL. Front matter opens and closes with a line exactly equal to `---` and contains one YAML 1.2 Core Schema document.

Processors reject duplicate keys, non-string keys, explicit tags, anchors, aliases, merge keys, recursive values, non-finite numbers, and non-JSON-compatible values.

Bodies use CommonMark 0.31.2.

## Discovery

Root search selects the nearest ancestor that contains an `atlas.md` file entry. Validity requires a regular, non-symbolic-link `atlas.md`. Discovery reports a symbolic-link candidate so validation can reject it explicitly.

Discovery does not follow symbolic links, ignores `.git`, package caches and build outputs, stops at nested Atlases, discovers all descendant Maps independently of navigation, and recognizes `.checks` and `.publication` only at root. The two root policy directories contain direct regular Markdown files only.

A Map directly contains `map.md`. Its `points/` directory is direct and contains regular `.md` files only. A `type: point` file outside is invalid.

## Point grouping

After schema validation, processors group Point records by exact id and evaluate the group constraints owned by Atlas Format. The explicit `record` field selects the anchor; discovery order never does. The containing Map of that anchor becomes the primary Map, and every accepted context retains its own containing Map and source path.

## Body inspection

Processors exclude front matter and headings; include text from paragraphs, lists, block quotes, code, link labels, and image descriptions; omit destinations and raw HTML tags; decode entities; collapse whitespace; and trim.

The extracted body is substantive when at least one included block remains after normalization. Processors use that result to evaluate the anchor and authored-context body constraints owned by Atlas Format. They do not use a prose-length threshold as evidence of semantic substance.

## Check processing

Processors inspect CommonMark level-two headings and substantive section bodies to evaluate the Check shape defined by Atlas Checks. Structural processing does not execute a Check’s Requirement or Verification and does not infer a policy outcome from valid Check syntax.

## URI references

URI values are RFC 3986 references. Processors reject controls, spaces, backslashes, invalid percent encoding, encoded separators or NUL, case/normalization mismatches, and local paths that traverse symlinks.

Processors do not retrieve external references. Direct local URIs resolve from the containing structural file. Every registered Resource URI resolves once from `atlas.md` during resolved validation, independent of how many records use that Resource. Core targets cannot resolve to structural files, Point records, Checks, or reserved publication files.

## Resolution

Resolved processing joins navigation to Maps and records to their containing Maps. It joins contexts to anchors and Area memberships to Areas in the containing Map. It also joins Resource ids to the root registry, relations to Point anchors, local URIs to exact contained regular files, superseded Points to incoming `supersedes` relations, and publication selectors to their exact source units.

Processors build the directed relation graph after Point grouping. They evaluate self-links, duplicate type-and-target pairs, target existence, supersession lifecycle consistency, replacement coverage, and supersession cycles against the constraints owned by Atlas Format.

## Derived Map overlap

For each resolved Point, processors form the set of Maps containing its accepted anchor or context records. Every unordered pair in that set becomes one related-Map entry supported by the Point id. Processors deduplicate pair identity and supporting Point ids before canonical ordering.

## Determinism

Canonical ordering uses Unicode code points, never locale collation.

Maps, Points, Checks, and publication profiles sort by id. Point records place the anchor first, then contexts by Map id and path. Areas and relations preserve authored order. Related Map pairs and supporting Point ids sort by id. Publication selections use the ordering defined by Atlas Publication. Atlas Validation owns diagnostic ordering.

## Normalized model

A normalized Point contains canonical anchor fields, `primaryMap`, `anchorPath`, ordered records, relations, incoming relations, review, and extensions. Each record contains kind, Map, path, summary, explained Area memberships, Content, References, extensions, and body. Each outgoing and incoming relation contains its required note and preserves its authored extensions. Maps contain `anchorPointIds`, `contextPointIds`, and all `pointIds`. Related-Map entries contain the two Map ids and their ordered supporting Point ids.

A normalized result also contains ordered publication profiles with exact resolved Point-record kinds and paths. It MUST conform to `urn:atlas:schema:normalized:1`. Atlas Validation owns whether a validation result may expose that normalized model.

## Trust boundary

Atlas content is informational input. It does not grant tool authority, credentials, or instruction priority. Core Atlas records do not express publication eligibility; only an explicit publication profile does so.
