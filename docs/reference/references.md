# References and source review

Atlas derives references from existing Markdown links and source headers. These
operations add no authored record fields and do not change format validity.
A citation means that one record refers to another; it does not establish support,
dependence or endorsement. Import the operations from `@neutral/atlas`.

## Inspect links and direct citers

```js
referenceIndex(view, { limit: 1000 })
directCiters(view, { point: 'credible-comparison' }, { limit: 100 })
directCiters(view, { facet: 'review', tree: 'product' })
sourceCitations(view, { uri: '../spec/SPEC.md', limit: 100 })
```

`referenceIndex` returns `atlas.references/1` with captured identity, `references`,
`citations`, `diagnostics` and `bounds`. Each reference retains its referring record,
original parsed `href`, file location, resolved target identity and status. File
locations use one-based lines and columns; `start` and `end` are zero-based
JavaScript string offsets into the captured file. Safely located inline
`destination` ranges identify only the Markdown destination text. Reference-style
links resolve for reading but do not currently support automatic move repairs.

File-relative paths are preferred. Existing Atlas-root paths also resolve against
known record paths. Dot segments and URI encoding are resolved; case and Unicode
identity are not guessed. Point and Facet links resolve to their exact identities.
Source links must correspond to a source declared by their owning Point or Facet.
Remote HTTP(S) links remain external references. Unsupported schemes or unresolved
local links produce diagnostics, without invalidating the Atlas itself. Code
blocks and inline code do not create links.

Point and Facet fragments are checked against the Portal's Markdown heading IDs.
A resolved record can still have `heading.status: "missing-heading"`, reported as
`REFERENCE_HEADING_MISSING`; that does not make the record itself absent. A
successful explicit Markdown source review similarly returns `fragments` results
for cited or linked headings. Missing, denied or non-Markdown source contents
leave heading verification `uninspected`. Heading presence is a navigation check,
not evidence that the destination supports the claim.

`directCiters` returns distinct referring records with their exact reference
occurrences. It follows one authored link, not transitive consequences.
`sourceCitations` matches the exact declared URI, including its fragment, and keeps
each occurrence's role, locator, revision and expected hash. It performs no read.

Results accept limits of 1–10,000, with defaults of 1,000 for the index and 100
for lookup operations. The scan stops after 10,000 references or citations and
reports `bounds.exhaustive: false`; counts then describe observed entries, not a
complete inventory. Requested output limits can also omit results even when the
scan is exhaustive. Check both returned counts and bounds before claiming coverage.

## Prepare a file move

```js
const plan = prepareMove(view, {
  point: 'credible-comparison',
  path: 'trees/product/points/evaluation/comparison.md',
  reason: 'Group evaluation explanations without changing their meaning.',
})
```

For a Facet, replace `point` with `facet` and its owning `tree`. The destination
must stay within the existing Tree's corresponding `points/` or `facets/` folder.
The operation preserves the record ID, changes its path and repairs captured
incoming and outgoing inline path links. Source-header URIs remain Atlas-root
relative and do not change merely because the record moved.

The result is an ordinary `atlas.change/1` plan. Inspect its complete effects,
validate and apply through [authoring](authoring.md) under existing permissions.
Preparation performs no writes. The move refuses destination aliases, incomplete
reference scans, unresolved affected links, and reference-style or complex links
whose exact destination cannot safely be located. It never returns a partially
repaired move as successful. Repair unsupported cases explicitly first.

## Review declared sources

```js
const review = await reviewSources(view, {
  uris: ['../spec/SPEC.md'],
  allowedRoots: ['/absolute/project'],
  previous: [{ uri: '../spec/SPEC.md', sha256: earlierObservedHash }],
  limit: 100,
})
```

`uris` is optional; omission selects distinct declared URIs. `allowedRoots` is
required and supplies the explicit local read grants. An empty list grants no
local source access. `previous` optionally supplies earlier observed URI/hash
pairs; it is caller-supplied comparison evidence, not authenticated history.
`maxBytes` has the same bounds as `readSource`.

The `atlas.source-review/1` result records an observation time and bounded `results`:

| Status | Meaning |
| --- | --- |
| `current` | The read succeeded and matches available declared and prior hashes. With none, this establishes a first observation only. |
| `changed` | Observed bytes differ from at least one declared hash or supplied previous observation. |
| `missing` | An authorized local target was not found. |
| `denied` | Source grants, private-state restrictions or filesystem protections prevented reading. |
| `uninspected` | The URI is remote or is not declared by this captured account. No retrieval occurred. |
| `incomplete` | A read limit or observed concurrent change prevented a complete read. |
| `invalid` | Source syntax or content prevented an accepted reading observation. |

Entries preserve the citations, observed `sha256` and byte count when available,
expected hashes, mismatches and the previous observed hash when supplied. They
return no source contents. Conflicting declared hashes remain visible separately;
review does not pick a winning claim or replace authored hashes. Remote URLs are
never fetched, and private state remains excluded under broad grants.

A source change prompts interpretation; it does not prove that a cited explanation
is false or obsolete. Dated observations may intentionally cite earlier bytes.
The Atlas's authored identity also remains unchanged by a source-only edit.
After inspecting the result, an author may explicitly select an observed local
`{uri, sha256}` as an apply precondition for an edit that relies on those bytes.
Source review does not add preconditions or authorize edits automatically.

## Keep review across sessions

The Editor retains successful observations and later inspection outcomes in
private storage, so a source can be compared after restarting the application.
The authored Atlas remains unchanged. `getSourceReviewHistory` and
`recordSourceReview` provide the same retained history to trusted Library callers;
see [authoring](authoring.md#styles-working-copies-and-retained-source-review).

CLI `sources` and MCP `atlas_review_sources` remain read-only. Their explicit
retention operations are `source-record` and `atlas_record_source_review`; read
`source-history` or `atlas_source_history` for the current revision before saving.
MCP retention names a `reviewId` produced in that session. The
[CLI](cli.md#retain-source-review-across-sessions) and
[MCP](mcp.md#retain-source-observations-and-decisions) references give complete
inputs and continuation rules.

A disposition names the exact observed hash and a reason: `needs-review`,
`reviewed-unchanged` or `updated`. New bytes do not inherit a prior disposition.
A missing or denied read stays visible even if an older successful observation is
retained. Review history supplies a work record, not an authenticated audit log,
a truth judgment or evidence that every citing claim was checked.

## Reader links

The Portal uses the same resolver for Point, Facet and declared-source links.
Facet destinations identify their owning Tree, host and Facet. Source destinations
retain the owning citation index, including its locator and expected hash.
Published links use only selected records and sources whose bytes were actually
retrieved for the publication. Missing publication targets stay unavailable;
resolving a link never enlarges the selected corpus.

Selected Markdown sources include a rendered HTML reading page and the exact raw
text. The page renders headings, tables and code while escaping authored HTML,
keeping images inert and leaving undeclared local links unavailable. Explicit
HTTP(S) links can be opened by the reader; rendering fetches no remote content.
