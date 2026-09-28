# Atlas Library

The Library reads, validates and edits [Atlas](../spec/SPEC.md), and provides
Route, Absorb, Checks and publication selection. It requires Node.js 22.23.2 or
later and uses the pinned Markdown parser for record validation.

`openAtlas(root)` captures authored files and returns a content identity,
diagnostics, and an accepted Atlas only when `status` is `ready`. `invalid` means
the captured structure needs repair. `incomplete` means a read limit, denied
access, or concurrent change prevented complete inspection. A missing record is
invalid, so a proposed edit can repair it.

`validateFiles(files, {root})` validates supplied text in memory. `openAtlas` also
accepts an `overrides` Map for previews. Both operations are read-only.
`getPoint`, `getTree`, and `getFacet` inspect captured identities. `searchAtlas`
returns bounded lexical candidates. `compareViews` reports changed captured files.
The [type declarations](src/index.d.ts) define their results.

`readSource(view, source, {allowedRoots})` reads a source separately as UTF-8.
Local reads default to the Atlas root. An explicit root list replaces that grant.
Symlinks are rejected, declared hashes are checked, and HTTP(S) references are
returned without fetching. Source content is outside the authored view identity.

Reads default to 2 MiB per file and 10,000 files. Options can raise these to
64 MiB and 100,000 files. Each capture remains bounded to 64 MiB total. Directory
depth is at most 64; traversal visits at most four times the file limit. Outlines
allow at most 10,000 placements and 64 nested levels. JSON parsing bounds text,
nesting, and value counts. Search returns at most 100 Points.

A captured view records a bounded read. The reader checks file identities and
directory metadata for concurrent changes; capture is not an atomic snapshot.
Validation checks structure. Authors assess source support and explanation
quality; Check evaluation records project review outcomes.

See [Absorb and Route](../docs/reference/absorb-route.md) and the
[reviewed-change example](../docs/reference/authoring.md#try-a-reviewed-change). Run
`npm test` in this directory for Library tests.
