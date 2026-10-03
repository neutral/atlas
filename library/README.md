# Atlas Library

The Library supplies Atlas's shared reading and authoring operations. Use it to
find an explanation, assemble its context, inspect references and sources, then
prepare and review a change against a captured version of the Atlas. The
[specification](../spec/SPEC.md) owns their meaning. Node.js 22.23.2 or later
is required.

A styled Atlas captures one complete local policy in `view.atlas.style`. Read it
before authoring: it governs organization and source depth until explicitly
revised or replaced. `listStyles`, `getStyle` and `prepareStyleChange` support
curated or custom adoption. Legacy `atlas/1` collections remain accepted unchanged.

## Find a starting explanation, then read it

```js
import { openAtlas, route } from '@neutral/atlas';

const view = await openAtlas('/path/to/atlas');
if (view.status === 'ready') {
  const discovery = route(view, {
    query: 'offline delivery', mode: 'discover', limit: 5,
  });
  const first = discovery.selected[0];
  if (first) {
    const reading = route(view, {
      ...first.point.selector, orientation: 'compact', limit: 4,
    });
    // Assess the full explanation, supporting Points, Facets and sources.
    // Follow reading.next requests to continue omitted sections.
  }
}
```

Discovery returns literal previews and exact selectors. Reading preserves the
selected explanations; compact orientation keeps ancestry without repeating
ancestor bodies. `searchAtlas` also accepts `presentation: 'summary'` for lexical
candidates; set `kinds: ['point', 'facet']` to include interpretations. Discovery's
`facets` section identifies independently matched Facets with owner, host and
targets; read one with `route(view, {tree, facet})`. See [reading paths](../docs/reference/reading-paths.md) for ranking,
ambiguity and continuation bounds.

## Review a change and its support

`referenceIndex`, `directCiters` and `sourceCitations` expose existing links and
declared source references. `reviewSources` explicitly inspects selected source
bytes within caller grants and identifies their citing accounts. `prepareMove`
keeps a record's identity and supported inline link repairs in one reviewed plan.
See [references and source review](../docs/reference/references.md).

`prepareAbsorb` returns a change plan and a review packet containing contribution
decisions, reasons and unresolved questions. Save both with `saveDraft` to retain
that reasoning. `reviewChange` exposes changed meaning, placement and related
accounts; `inspectChange` reconstructs the candidate for Check evaluation.
Candidate evidence can remain with the draft through restart. When a proposal
changes, `reviewHistory` preserves older packets separately from active evidence.
`summarizeAtlas` and `summarizeDraft` provide bounded inventories; exact inspection,
full output and `readJsonChunk` retain access to every byte needed for review. `applyDraft` checks
the expected saved revision, original authored baseline and any selected source byte
requirements. See [Absorb review](../docs/reference/absorb-review.md) and the
[reviewed-change example](../docs/reference/authoring.md#try-a-reviewed-change).

## Capture and inspection boundaries

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
nesting, and value counts. Search returns at most 100 selected Point/Facet records.

A captured view records a bounded read. The reader checks file identities and
directory metadata for concurrent changes; capture is not an atomic snapshot.
Validation checks structure. Authors assess source support and explanation
quality; Check evaluation records project review outcomes.

See [Absorb and Route](../docs/reference/absorb-route.md) for their shared contract.
Run `npm test` in this directory for Library tests.
