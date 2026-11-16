# Reading

This page states what the reading operations return: `inspect`, `outline`,
`search` and `route`. Each is the same operation in the CLI and in the MCP
server. How each is invoked, its options and its exit codes are in
[The atlas command](cli.md) and [The MCP server](mcp.md). `references`, which
lists links and citations, is in [Sources and stamps](sources.md). The rules
these operations keep are the
[specification's](../../spec/SPEC.md#reading) and the
[operations contract's](../../spec/spec/OPERATIONS.md#route).

## The captured view

Every reading operation answers from one captured view of the Atlas: its
authored files, their validation and the view's identity, as the
[format](../../spec/spec/FORMAT.md#validation-and-captured-views)
defines them.

- The CLI captures the Atlas afresh for each command.
- The MCP server keeps one capture for a session: the first tool that needs
  the Atlas takes it, `atlas_refresh` takes it again, and apply and recovery
  take it again after they write. The reading tools answer from it. When the
  capture is taken is in [Session](mcp.md#session).

Each result, except a chunk of details ([Details in chunks](#details-in-chunks)),
names its format and carries `identity`, the
[view identity](../../spec/spec/FORMAT.md#view-identity) it was read
from, and `status`. When the Atlas does not validate, a record, an outline, a
search and a route have status `unavailable` and nothing to return; the view's
diagnostics are in `diagnostics`, each `{ code, path, message }`.

The records returned whole are records of the
[normalized view](../../spec/spec/FORMAT.md#normalized-view): a Point is
the fields of its header, `tree`, `path`, `title`, `body` and `ancestors`; a
Facet the fields of its header, `tree`, `path`, `title` and `body`.

## Inspect

### The summary

The CLI's [`atlas inspect`](cli.md#inspect), and MCP's
[`atlas_open`](mcp.md#atlas_open) and [`atlas_refresh`](mcp.md#atlas_refresh),
return a bounded summary of the Atlas. `atlas_refresh` adds `comparison`,
what changed since the previous capture:
`{ same, before, after, added, removed, changed }`, the two identities and the
paths of the files added, removed and changed.

| Key | Holds |
| --- | --- |
| `format` | `atlas.view/1` |
| `status` | `ready`, `invalid` or `incomplete` |
| `root` | the Atlas directory |
| `identity` | the view identity |
| `files` | `{ path, sha256, bytes }` of each captured file |
| `diagnostics` | `{ code, path, message }` |
| `atlas` | `null` unless the Atlas is valid; else `format`, `id`, `title`, `style`, `trees`, `points`, `facets`, `checks` |
| `bounds` | for each section, `{ available, returned, offset, next }` |

The records in `atlas` hold no text:

| Section | Each entry |
| --- | --- |
| `style` | `title`, `path` |
| `trees` | `id`, `title`, `scope`, `base`, `path` |
| `points` | `id`, `tree`, `title`, `path`; `type` and `status` or `observedAt` for a typed Point; `uncertainty` when it has one |
| `facets` | `id`, `tree`, `title`, `path`, `on`, `via`, `targets`; `uncertainty` when it has one |
| `checks` | `id`, `title`, `path`, `status`, `level`, `revision` |

The sections are `files`, `trees`, `points`, `facets`, `checks` and
`diagnostics`, each in the view's order: files by path, Trees in the order of
`atlas.json`, Points and Facets Tree by Tree and by file path within a Tree,
Checks by path, diagnostics by path, then code, then message.

Paging:

| Field | Values |
| --- | --- |
| `limit` | 1 to 100, default 50: entries listed in each section |
| `offset` | 0 to 100000, default 0, applied to each section listed |
| `section` | one of the sections: list only that one; the others list nothing and keep their counts |
| `expectedIdentity` | the identity a continuation belongs to |
| `full` | `true`: the whole captured view instead, every file with its content |

`next` is the request that continues a section, or `null` when nothing in it
remains or it was not listed:

```json
{ "section": "points", "offset": 2, "limit": 2, "expectedIdentity": "bee2cc7f…" }
```

A request whose `expectedIdentity` is not the view's is refused with `STALE`:
"The Atlas changed; restart inventory from offset zero."

### A record

`atlas inspect point ID`, `tree ID`, `facet TREE ID`, `style` or `checks`, and
[`atlas_inspect`](mcp.md#atlas_inspect) with exactly one of `point`, `tree`,
`facet` (`{ tree, id }`), `style`, `checks` or `path`, return one record
whole:

| Key | Holds |
| --- | --- |
| `format` | `atlas.inspection/1` |
| `status` | `ready`; `missing` when nothing has that ID or path; `unavailable` when the Atlas does not validate |
| `identity` | the view identity |
| `kind` | `point`, `tree`, `facet`, `style`, `checks` or `path` |
| `record` | the record, or `null` |
| `diagnostics` | the view's diagnostics |

| Kind | `record` holds |
| --- | --- |
| `point` | the Point; `owner`, its Tree; `facets`, the Facets of its Tree said of it; `incomingFacets`, the Facets of other Trees that target it; `sources` (`[]` when it has none). `ancestors` names the Points above it, each `{ id, tree }`, its Tree's Base first. |
| `tree` | the Tree's fields and `path`; `points`, its Points; `facets`, its Facets; `incomingFacets`, the Facets of other Trees that read through it |
| `facet` | the Facet; `owner`, its Tree; `host`, the Point it is said of; `viaTree`, the Tree it reads through; `resolvedTargets`, the Points it draws on; `sources` |
| `style` | `{ title, body, path }` |
| `path` | one captured file exactly as captured, `{ path, content, sha256, bytes }`; a file that is not UTF-8 has `content: null` and `rawBase64`, its exact bytes. Returned even when the Atlas does not validate. MCP only. |

`checks` returns `records` in place of `record`: every Check with its complete
text (the fields of its header, `path`, `title`, `body` and `revision`), and
`limits`:

- "Only Checks whose status is active govern."
- "Atlas does not evaluate a Check. A reviewer verifies each applicable Check
  against the exact candidate and reports pass, fail or unable with its
  evidence."

### Details in chunks

MCP only. `atlas_inspect` with `part: "details"` returns the record, or the
Checks, as exact JSON text in chunks:

| Field | Values |
| --- | --- |
| `maxBytes` | 4 to 131072, default 65536: bytes in this chunk |
| `offset` | the byte to start at: 0, then `nextOffset` |
| `expectedSha256` | the `sha256` of the text being continued |

The result is `{ status: "ready", encoding: "utf-8", byteLength, sha256,
offset, returnedBytes, nextOffset, complete, text }`. A chunk ends on a UTF-8
character boundary; `nextOffset` is `null` with the last one. An offset inside
a character is refused. A continuation whose `expectedSha256` differs is
refused with `STALE_REPORT`: "The selected details changed. Restart at offset
zero."

## Outline

[`atlas outline [TREE]`](cli.md#outline) and
[`atlas_outline`](mcp.md#atlas_outline) return every Tree, or the one TREE
names, with its outline and no explanation.

| Key | Holds |
| --- | --- |
| `format` | `atlas.outline/1` |
| `status` | `ready`; `missing` when no Tree has the ID; `unavailable` |
| `identity` | the view identity |
| `tree` | the Tree asked for, when one was |
| `trees` | `{ id, title, scope, outline }`, in the order of `atlas.json` |
| `diagnostics` | the view's diagnostics |

`outline` holds one line for each Point, in the order the Tree places them: the
Base first, each development under the Point it develops, two spaces
deeper. A line is `ID: title`, and for a typed Point ` [decision: STATUS]` or
` [observation: DATE]`, the date as written:

```text
product-purpose: Writers can keep working on notes when the connection drops
  offline-work: Offline work stays on the current device
    delivery-promise: A note is “Saved on this device” until a server receipt makes it “Sent for sync” [decision: selected]
```

## Search

[`atlas search INPUT`](cli.md#search) and
[`atlas_search`](mcp.md#atlas_search) find Points and Facets whose words
contain the words of a query, and rank them lexically. A match is a candidate,
not an answer, and no match does not show that the Atlas says nothing. The
Portal's search field uses the same search ([The Portal](portal.md#search)).

| Field | Values |
| --- | --- |
| `query` | required: 1 to 4096 characters |
| `kinds` | `["point"]`, `["facet"]` or both; default both |
| `tree` | only records of this Tree |
| `type` | `decision`, `observation` or `untyped`: only Points of this Type; no Facet is searched |
| `limit` | 1 to 100, default 20 |
| `offset` | 0 to 100000, default 0 |
| `presentation` | `summary` (default) or `full` |

### Matching

- The searched fields of each record are its ID, title, body and uncertainty.
  Sources are not searched.
- The query and each field are read as words: normalized (NFKC) and
  lowercased, cut at Unicode word boundaries, and cut again at `-` and `_`.
- The query keeps its first 64 distinct words. Common English words are dropped
  from it, unless they are all it holds: `a an and are as at be been being but
  by can could did do does for from had has have how i if in into is it its may
  me my of on or our should that the their them then there these they this
  those to was we were what when where which who why will with would you your`.
- A word of letters `a` to `z` matches its plural: a final `ies` reads as `y`
  in words over four letters; a final `ches`, `shes`, `xes`, `zes` or `sses`
  loses its `es`; a final `s` is dropped from words over three letters that do
  not end in `ss`, `us` or `is`.
- A record matches when a query word matches a word of one of its fields, or
  when the whole query, trimmed, is its ID.

### Ranking

Each matching record is scored:

- 1000 when the whole query is its ID;
- plus 12 times the share of the query's words it matches;
- plus, for each field and each query word that matches in it, the field's
  weight times `1 + log2((N + 1) / (n + 1))`, where N is the number of records
  searched and n the number that match that word. The weights are ID 8, title
  4, body 1, uncertainty 1.

The score is rounded to three decimals. Results are ordered by exact ID first,
then by score, highest first, then by ID, kind and Tree. N is the set searched
after `tree`, `type` and `kinds`, so a score compares records within one result
only.

### Results

| Key | Holds |
| --- | --- |
| `format` | `atlas.search/1` |
| `status` | `ready` or `unavailable` |
| `identity` | the view identity |
| `request` | the request, with `kinds` and `presentation` filled in |
| `results` | this page of results |
| `bounds` | `{ offset, limit, available, returned }`; `available` is how many records matched in all |
| `next` | the request for the next page, or `null` when none was left out |
| `diagnostics` | the view's diagnostics |

Every result has `score`, `matches` (each `{ field, term }`) and `reason`,
which reads "Exact Point ID with lexical context; identity does not establish
relevance or source support." (or "Exact Facet ID …") for an exact ID, and
otherwise "Word matches, query coverage and corpus frequency rank lexical
candidates; the reader assesses meaning."

A `summary` result holds no body:

| Key | Holds |
| --- | --- |
| `id`, `tree`, `title`, `path` | as in the record |
| `type`, `status`, `observedAt` | for a typed Point |
| `uncertainty` | when it has one |
| `kind` | `point` or `facet` |
| `summary` | `true` |
| `snippet` | `{ text, start, end, totalLength }`, counted in UTF-16 code units: the body from 70 units before its first matching word, or from its start, for 240 units or to the body's end, each end moved back one unit where it would split a surrogate pair |
| `sourceCount` | how many sources it cites |
| `on`, `via`, `targets` | for a Facet |
| `selector` | `{ point }`, or `{ tree, facet }` for a Facet: the selector that reads it through `route` |

A `full` result is the complete record with `kind`.

## Route

[`atlas route INPUT`](cli.md#route) and [`atlas_route`](mcp.md#atlas_route)
return a reading path: the Points above, the selected explanation, what it
develops into and the Facets that bear on it.
Inclusion follows exact identity, the outline, lexical matches or a Facet's
attachment; it does not judge relevance.

| Field | Values |
| --- | --- |
| `point` | an exact Point ID |
| `tree` | an exact Tree ID |
| `facet` | an exact Facet ID, with `tree` |
| `query` | a question, 1 to 4096 characters |
| `mode` | `read` (default) or `discover` |
| `detail` | `overview`, `standard` (default) or `deep` |
| `orientation` | `full` or `compact`; default `full` in read mode, `compact` in discover mode |
| `kinds` | with `query`: `["point"]`, `["facet"]` or both; default `["point"]` in read mode, both in discover mode |
| `type` | `decision`, `observation` or `untyped`: selects and develops only Points of this Type; with `query`, no Facet is found |
| `limit` | 1 to 100, default 8 |
| `cursor` | set by a `next` request |

Give exactly one of `point`, `tree` and `query`. A request that breaks these
rules is refused with `atlas.route.invalid-argument`; the MCP server refuses an
unknown field or a value its input schema does not admit first, with its own
`INVALID_ARGUMENT`.

### Selection

| Request | Selected | Reason |
| --- | --- | --- |
| `point` | that Point; with `type`, only when it has that Type | `exact-point` |
| `tree` | its Base | `tree-base` |
| `tree` and `type` | every Point of that Tree with that Type | `exact-tree-type-filter` |
| `tree` and `facet` | nothing; the Facet stands first in `facets`; with `type`, nothing at all | `exact-facet` |
| `query` | the Points the search finds, among its first 100 candidates of `kinds`; the Facets it finds stand first in `facets` | `lexical-candidate`, `lexical-facet-candidate`, each with `matches`, `score` and `explanation` |

`status` is `missing` when nothing is selected, with `reason` "No record
satisfies the supplied selector and filters."; `ambiguous` when a query found
more than one Point or Facet; `unavailable`, with `reason` and `diagnostics`,
when the Atlas does not validate; otherwise `ready`.

### Modes and detail

In read mode, `selected` holds each Point whole, and the selection is
developed:

| Detail | `supporting` holds |
| --- | --- |
| `overview` | nothing |
| `standard` | the developments one level beneath each selected Point |
| `deep` | every development beneath each selected Point, at every depth |

With `type`, `supporting` holds only Points of that Type. Its Points stand in
outline order, Tree by Tree, each with the reason `authored-descendant`:
`{ point, pointDepth }`, the selected Point above it and how many levels below
that Point it stands.

`facets` then adds the Facets that bear on the selected and supporting Points,
each with its reasons:

| Reason | The Facet |
| --- | --- |
| `attached-point` | is said of one of them |
| `attached-ancestor-point` | is said of a Point above one of them, with `limit`: "The interpretation belongs to the higher explanation. Applying it to a descendant requires separate judgment." |
| `incoming-point-reference` | draws on one of them |
| `incoming-ancestor-point-reference` | draws on a Point above one of them |

In read mode each Facet is whole, with `owner` and `viaTree` (each a Tree's
`{ id, title, scope, base, path }`), `host` and `targets` as references.

In discover mode nothing is developed: `selected` holds summaries in the shape
of a search summary without `kind`, `supporting` is empty, and `facets` holds
only the Facet selected or the Facets the query found, as summaries, each with
`kind: "facet"`.

The supporting Points, the Facets and the orientation are those of the first
`limit` selected records.

### What it returns

| Key | Holds |
| --- | --- |
| `format` | `atlas.route/1` |
| `status`, `reason` | as above |
| `identity` | the view identity |
| `request` | the request, with `detail`, `limit`, `mode` and `orientation` filled in |
| `orientation` | one entry for each Tree of the selected Points; with a `facet` selector, one for the Point that Facet is said of. Facets a query finds bring none. |
| `selected`, `supporting`, `facets` | `{ point, reasons }` or `{ facet, reasons, … }` |
| `limits` | three fixed sentences on what the path does not establish |
| `bounds` | `limit`, and for each section `{ available, returned, offset }`; a section a continuation leaves out has no `offset` |
| `next` | for each section with more, the request that continues it; `{}` when nothing remains |
| `search` | after a query: `window` 100, `available` (how many matched in all), `exhaustive` (`true` when no more than 100 matched) and a `limit` sentence |
| `page` | on a continuation: `{ section, offset }` |

An orientation entry is `{ tree, base, ancestors, forPoints }`: the Tree; its
Base; the Points above the selected ones other than the Base, each
`{ id, tree, record }`; and the IDs of the selected Points in that Tree. With
`orientation: "full"` the Base and each `record` are whole; with
`"compact"` they are references.

A reference holds `id`, `tree`, `title`, `path`, `type`, `status` or
`observedAt` for a typed Point, `uncertainty` when it has one, `reference:
true` and `selector: { point }`.

### Bounds and continuation

`limit` bounds each section separately: `selected`, `supporting` and `facets`.
`next` holds, for each section with more to give, the complete request with a
`cursor`:

```json
{ "query": "delivery receipt", "limit": 2, "detail": "standard", "mode": "read", "orientation": "full",
  "cursor": { "identity": "bee2cc7f…", "request": "754dd2f3…", "section": "selected", "offset": 2 } }
```

`identity` is the view the path was read from and `request` the SHA-256 of the
request's fields. Pass the whole `next` value as the request. A continuation
returns that section's next page, the other sections empty with their
`available` counts, `orientation` empty, and `page`.

| Refusal | When |
| --- | --- |
| `atlas.route.stale-cursor` | the Atlas changed since the path was read: "The captured Atlas changed. Start a new Route before continuing." |
| `atlas.route.cursor-mismatch` | the request differs from the one the cursor belongs to: "The continuation belongs to a different Route request. Use its complete next request." |
| `atlas.route.invalid-argument` | the cursor's offset lies beyond its section |

Through MCP, the view is the session's capture: a continuation after
`atlas_refresh` that found the Atlas changed is stale.

## References

[`atlas references`](cli.md#references) and
[`atlas_references`](mcp.md#atlas_references) list links and citations as
authored, without reading a source:
[The reference index](sources.md#the-reference-index).
