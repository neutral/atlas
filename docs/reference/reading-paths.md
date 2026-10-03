# Choose and continue a reading path

Search proposes lexical candidates. Route assembles an authored reading path.
Use compact discovery when the starting Point is uncertain, then request the
complete explanation for a selected identity. Neither operation decides whether
a candidate answers the question or whether its sources establish its claims.

## Find a starting explanation

```js
import { openAtlas, searchAtlas, route } from '@neutral/atlas';

const view = await openAtlas('/path/to/atlas');
const candidates = searchAtlas(view, {
  query: 'What happens if the editor crashes?',
  presentation: 'summary',
  kinds: ['point', 'facet'],
  limit: 5,
});

const discovery = route(view, {
  query: 'What happens if the editor crashes?',
  mode: 'discover',
  limit: 5,
});
```

Search matches words in selected record IDs, titles, explanations and uncertainty.
Exact IDs rank first. Meaningful query-word coverage and corpus frequency affect
lexical ranking. Common English question words are ignored when the query also
contains other words; a query consisting only of common words can still match
those words exactly. A small English plural equivalence recognizes forms such as
`crash` and `crashes`. Word segmentation also accepts other scripts and preserves
accent distinctions. The matcher does not infer synonyms or semantic relevance.
For example, `if` cannot match inside `qualification`.

The Library's `searchAtlas` defaults to Points for compatibility. Set `kinds` to
`['point', 'facet']` or `['facet']` to include interpretations. CLI, MCP and browser
search include both by default. Mixed results carry `kind: 'point' | 'facet'`;
Facets retain `on`, owning `tree`, `via` and `targets`, with the exact selector
`{tree, facet}`. Do not treat a Facet's words as its target's claim. Source document
contents are not searched. A missing lexical result does not establish absence.

Summary candidates contain identity, owning Tree, title, path, Type and recorded
status/date when present. They retain the complete authored uncertainty and the
number of source references. Their `snippet` is a literal slice of the record's
body, with `start`, `end` and `totalLength`; it is not a generated explanation or
new authored field. `selector: { point: ID }` names an exact follow-up. Search
also returns the matched field/word pairs, score and an explanation of the
ranking boundary.

Default `searchAtlas` results remain complete Point records. Set
`presentation: 'summary'` explicitly to request previews. Search `tree` and
`type` filters and its `limit` of 1–100 still apply before returning candidates.
A Type filter selects Points only. CLI and MCP search default to summaries;
`presentation: 'full'` requests the complete matching records.

Route discovery returns these previews in `selected`, with inclusion reasons,
compact orientation and the existing ambiguity and search-window information.
Independent Facet matches appear in `facets` with their host and target context;
follow their selector through exact Facet inspection or `route(view, {tree, facet})`. Discovery does not expand
Point descendants. A query with
several matches remains `ambiguous` even when `limit: 1` returns only one.

## Read the chosen explanation

```js
const first = discovery.selected[0];
if (first) {
  const reading = route(view, {
    ...first.point.selector,
    detail: 'standard',
    orientation: 'compact',
    limit: 4,
  });
  // Assess the exact Point, supporting explanations, Facets and uncertainty.
}
```

The default Route mode is `read`. Its selected and supporting Points contain
their complete authored explanations, source references, Type, date/status and
uncertainty. Facets retain their complete interpretation and inclusion reasons.
Referenced sources still require a separate authorized read.

`orientation: 'compact'` replaces copied ancestor bodies with references that
retain title, identity, ownership, path, Type, date/status and uncertainty. Point
references provide an exact follow-up selector. The Tree scope and ancestry
remain visible. This avoids repeating a Base's entire explanation when it is
already selected, or several full ancestor explanations when the requested Point
is deep in a Tree. It does not shorten the selected Point itself.

The default orientation remains `full` for read mode and `compact` for discovery.
Set either explicitly when another presentation is useful. An ancestor Facet
describes its own host; its inclusion does not assert that the interpretation
applies to every descendant.

## Continue omitted results

```js
const reading = route(view, {
  point: 'POINT_ID',
  detail: 'deep',
  orientation: 'compact',
  limit: 2,
});

let next = reading.next?.supporting;
while (next) {
  const page = route(view, next);
  // Read page.supporting; these records do not repeat the prior prefix.
  next = page.next?.supporting;
}
```

`bounds` reports the available count, returned count and starting offset for each
included section. When a section has more results, `next.selected`,
`next.supporting` or `next.facets` supplies a complete follow-up request. A
continuation returns only that section; other result arrays and orientation are
empty. `page` identifies the section and offset. Retain the initial orientation
when reading the continuation.

Use `next.selected` to inspect further candidates without repeating earlier ones.
Supporting Points develop the initial selected page. Their order follows the
authored outline, and detail controls Point depth as in ordinary Route. The Facet
section considers all those supporting Points so its membership stays stable
while pages are read; an attachment reason may name a supporting Point on a
different page. After choosing a candidate from a later selected page, use its
exact Point ID to obtain that candidate's own full reading path.

Pass each `next` request unchanged, against the same captured `view`. Its `cursor`
contains the view identity, a hash of the original Route options, the section and
offset. A changed view is rejected with `atlas.route.stale-cursor`; changed
request options are rejected with `atlas.route.cursor-mismatch`. Invalid cursor
fields or out-of-range offsets are invalid arguments. A cursor grants no access
and does not refresh the Atlas. To change the question, limits or captured
observation, start another Route.

These are record-count bounds, not a guarantee of small output for arbitrarily
large authored explanations. Complete exact reads preserve the author's words.
The existing 100-candidate lexical search window remains visible, including
whether it may omit further lexical candidates. Continuation does not turn that
window into a completeness claim.

## Inspect inventories and complete draft details

`summarizeAtlas(view, {limit?, offset?, section?, expectedIdentity?, full?})`
provides a bounded inventory with record identities and paths. Each section exposes
available and returned counts plus an exact `next` request. The default limit is
50 and the maximum is 100. A changed identity requires starting again. Complete
captured records remain available through exact inspection or `full: true`.

`summarizeDraft(draft, {limit?, offset?, full?})` provides a synopsis of file effects,
candidate inventory and retained review. Read the complete saved draft before
claiming its effects were reviewed. `readJsonChunk(value, {offset?, maxBytes?,
expectedSha256?})` supplies exact JSON in UTF-8 chunks, defaulting to 65,536 bytes
and capped at 131,072. Follow `nextOffset` until `complete`, with the returned hash
as `expectedSha256`. Assemble all text before interpreting the JSON; a hash change
requires restarting. These helpers reduce tool output without changing the
underlying authored content or treating omitted detail as unimportant.
