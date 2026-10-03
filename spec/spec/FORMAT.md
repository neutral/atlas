# Atlas format

The supported format identifiers are `atlas/1` and `atlas/1.1`. Readers MUST reject
other formats. `atlas/1` retains its existing schema and has no adopted Style.
`atlas/1.1` adds a required locally captured Style; its Tree, Point, Branch, Facet
and Check encodings are unchanged. Existing legacy collections may remain
unstyled, but an adopted Style cannot be removed by downgrading to `atlas/1`.
Files are UTF-8. JSON is strict: duplicate decoded keys,
unsafe integers, malformed Unicode and unknown record fields are invalid. IDs match
`^[a-z0-9][a-z0-9-]*$` and are at most 100 characters.

## Layout

```text
atlas.json
style.md
trees/
  product/
    tree.json
    points/
      purpose.md
      offline-work.md
    facets/
      offline-storage.md
  architecture/
    tree.json
    points/
      local-storage.md
.checks/
  evidence-review.md
```

Directory and file names locate records; IDs identify them. Point and Facet files
MAY use nested directories beneath their respective `points/` and `facets/` roots.
Internal record paths MUST remain within the Atlas. Symbolic links are rejected
for authored records. Paths use NFC; case and Unicode aliases are rejected.
`.atlas-*` path components are reserved. Readers ignore regular `.atlas-write-*`
temporary files. Relative source URIs use the Atlas root as their base.

## Atlas manifest

An `atlas/1` manifest has exactly `format`, `id`, `title`, and `trees`. An
`atlas/1.1` manifest additionally requires `style`. `trees` is an ordered
array of unique relative directory paths, each containing one `tree.json`. Tree
directories MUST NOT overlap. An Atlas MAY initially have no Trees.

`style` is a normalized Atlas-relative path to one Markdown Style record, normally
`style.md`. It MUST remain outside `trees/`, `.checks/` and every declared Tree
directory. The ordinary authored path, alias, symbolic-link and reserved-path
rules apply. A Style is captured authored content, not a source URI or a remote
reference.

```json
{
  "format": "atlas/1.1",
  "id": "example",
  "title": "Example",
  "style": "style.md",
  "trees": ["trees/product", "trees/architecture"]
}
```

## Tree and outline

`tree.json` has exactly `id`, `title`, `scope`, `base`, and `children`. Scope is
nonblank prose. Base references a Point owned by this Tree. `children` is the ordered
development beneath that Base. The Base appears once, in `base`.

A Point placement has `point` and optional `children`. A Branch placement has
`branch`, `title`, and a nonempty `children` array. Children contain either kind of
placement. Branch IDs are unique within the Tree. Every discovered Point appears
exactly once across the Base and placements of its owning Tree. A Point belongs
to the Tree whose `points/` directory contains its file. Point IDs and Tree IDs are
unique within their respective Atlas-wide namespaces.

```json
{
  "id": "product",
  "title": "Product",
  "scope": "User needs and behavior.",
  "base": "purpose",
  "children": [
    {
      "branch": "connectivity",
      "title": "Working offline",
      "children": [{"point": "offline-work", "children": []}]
    }
  ]
}
```

## Markdown records

Points, Facets, Styles and Checks begin with one JSON header between exact `---` delimiter
lines. The first top-level CommonMark heading is one H1 title. The remaining prose
MUST contain a nonblank explanation; headings, comments and empty markup alone do
not supply one. Markdown links provide references; the Tree outline defines
membership. Raw HTML and executable content receive no execution authority.

### Style

The header requires `id` and `revision`. The ID follows ordinary ID rules;
`revision` is a nonblank string identifying the adopted definition. Optional
`derivedFrom` is nonblank plain text recording provenance. It does not load,
inherit or compose another policy. No other header fields are allowed. The H1
names the Style and the nonblank body contains its complete policy.

This encoding example abbreviates the body; adoption requires a complete policy.

```markdown
---
{"id":"project-subjects","revision":"1","derivedFrom":"Concise subjects, revision 1"}
---
# Project subjects

Organize durable capabilities into complete subject accounts. Explain enough for
readers to identify the relevant claim, its conditions and the source for detail.
```

The title, body and exact local bytes are authoritative for this adopted Style;
an ID and revision are labels, not permission to fetch another definition. A
revised policy SHOULD receive a new revision label. Consumers MUST still detect
changed bytes when labels have not changed. Accepted normalized `atlas.style`
exposes `id`, `revision`, `title`, `body`, and `path`, plus `derivedFrom` when
supplied; it is absent for the legacy format.

### Point

The header requires `id`. Optional fields are `type`, `status`, `observedAt`,
`sources` and `uncertainty`. Uncertainty is nonblank text when supplied.

`type: "decision"` requires `status`: `open`, `proposed`, `selected`, `rejected` or
`superseded`. `type: "observation"` requires a valid ISO calendar date or timestamp
in `observedAt` and at least one source. `status` and `observedAt` are otherwise
invalid. Supported Types are limited to `decision` and `observation`.

```markdown
---
{"id":"offline-work","sources":[{"uri":"sources/product-requirements.md","role":"evidence"}]}
---
# Users can keep working offline

Users can read and edit downloaded documents while offline. Changes synchronize
after the connection returns.
```

### Facet

The header requires `id`, `on`, `via` and `targets`. Optional fields are `sources`
and `uncertainty`. Facet IDs are unique within their owning Tree. `on` contains
exactly one `point` or `branch` reference within that Tree. `via` identifies a
different Tree. Targets are a nonempty array of objects containing exactly one
`point`, `branch` or `tree` ID. Every target belongs to `via`; a Tree target equals
`via`. A Base Point is addressed as an ordinary Point.

A Facet file holds the interpretation and references its targets. The same file
format supports attachment to a Point or Branch. Targets retain their own identity,
ownership and placement.

```markdown
---
{"id":"offline-storage","on":{"point":"offline-work"},"via":"architecture","targets":[{"point":"local-storage"}]}
---
# Offline editing depends on local storage

The offline experience requires documents and pending edits to remain available
between sessions. The Architecture account explains storage and synchronization.
```

### Source reference

A source has `uri` and optional `title`, `role`, `revision`, `locator`, and `sha256`.
Role is `evidence`, `background`, `example`, `implementation`, or `history`; omission
is an unclassified reference. SHA-256 is 64 lowercase hexadecimal characters.
Other supplied strings are nonblank. URI is HTTP(S) or an Atlas-root-relative path,
with an optional fragment. Absolute filesystem paths, credentials in URLs and
executable URL schemes are invalid. Relative source paths may leave the Atlas;
reading them still requires an explicit caller grant.

### Check

Checks reside in `.checks/`. Headers require `id`, `status` (`draft`, `active`, or
`retired`), and `level` (`required` or `advisory`). The Markdown has H2 sections
`Requirement`, `Verification`, `Failure`, and optional `Exceptions`, in that order.
Required sections contain explanatory content. A Check defines policy; evaluator
execution requires separate caller authorization.

## Validation and captured views

Readers report deterministic diagnostics with `code`, `path`, and `message`.
Invalid or incomplete input MUST NOT produce an accepted normalized Atlas.
Inspection MAY retain captured raw files and diagnostics for repair. Accepted
normalized output exposes the adopted Style when present, Trees, Points, Branches,
Facets, Checks, original paths,
source references and structural ancestry without duplicating canonical content.
An invalid UTF-8 file retains its exact bytes as `rawBase64`, with `content: null`.
It remains invalid until explicitly replaced or removed. Its hash and the view
identity include those original bytes.

A view's identity hashes the sorted captured relative paths and exact bytes.
Captured files and normalized records are immutable under that identity.
It identifies one reading observation, not an atomic filesystem snapshot. Readers
MUST bound file sizes and traversal, check for observable file changes during
capture, and report detected changes as diagnostics.
Editing state and generated output are excluded from the authored record inventory.
