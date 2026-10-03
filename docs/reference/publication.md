# Publication reference

Publication selects authored explanations and source bytes for sharing. Import
the Library operations from `@neutral/atlas`. See [publishing](../publishing.md)
for the Editor workflow.

## Prepare a selection

```js
preparePublication(view, { trees, points, sources, includeStyle })
```

| Field | Contract |
| --- | --- |
| `trees` | Required nonempty array of unique Tree IDs. |
| `points` | Optional unique Point IDs owned by selected Trees. Omission includes all their Points; `[]` includes none. |
| `includeStyle` | Optional boolean, default `false`; explicitly publish the complete adopted Style. |
| `sources` | Optional unique source URIs referenced by included Points or Facets. Default: `[]`. |

Each list is bounded to 10,000 entries. Points outside selected Trees are rejected.
Missing selections produce `incomplete` diagnostics. An unusable captured view
produces `unavailable`; a valid selection produces `ready`.

The `atlas.publication/1` result contains the selection, baseline `identity`,
`digest`, publication data, source selections, exclusions and diagnostics.
Preparation reads no source bytes.

## Included records

| Record | Published form |
| --- | --- |
| Selected Tree | Metadata, Branches and placement IDs. |
| Selected Point | Explanation, Type, uncertainty and references; authored file path removed. |
| Excluded Point in a selected Tree | `{id, tree, publicationAvailable: false}` placeholder. |
| Facet | Included when its host Point is selected or its host Branch is retained. |
| Style | Excluded by default; complete definition without its local path when `includeStyle: true`. |
| Check | Excluded. |

Facet targets retain their IDs. `viaAvailability` and `targetAvailability` mark
included and excluded targets. References do not expand the selection. Excluded
Point titles, bodies, paths and sources are absent, as are editing state and
unrelated files.

The selected data uses `atlas.publication-data/1`. Whole-Atlas validation applies
to the authored collection; this subset preserves excluded IDs as placeholders.

## Retrieve source bytes

```js
await readPublicationSources(view, publication, { allowedRoots })
```

Included records retain their source references. A reference's
`publicationAvailable` flag records URI selection; retrieval has a separate
outcome. Reserved `.atlas-*` state cannot be selected.

`allowedRoots` is required and contains `1`–`100` explicit local source grants.
Only selected URIs are read. Results are `{uri, ...sourceReadResult}` entries;
HTTP(S) URLs remain references. Local reads preserve missing, denied and
hash-mismatch results. Conflicting reference hashes prevent that source read.

The reader checks the prepared publication digest and captured baseline. Bytes
are read at retrieval time; a supplied SHA-256 binds expected content. Exporters
must use safe filenames and inert rendering.

## Editor export

Export previews an explicit selection at a destination fixed by the launch.
Build rechecks Atlas and source identities before writing; changed input requires
another preview. Existing output, Atlas data, declared local sources, private
state and installation paths are refused as destinations. Source-reading grants
permit retrieval; publication still requires an explicit selection.

Published navigation, search and direct citers use only the selected content.
Point, Facet and declared-source body links resolve through that selection; no
link expands it. Hidden bodies and paths stay absent. An included, successfully
retrieved Markdown source gets both an inert readable HTML page and its exact
raw-text copy; omitted, denied or failed source reads get neither. A source page's
local links remain inert and remote links require an explicit reader action.
