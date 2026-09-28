# Absorb and Route reference

Route assembles reading context. Absorb prepares explicit contributions. These
synchronous Library operations accept a captured `atlas.view/1`; source reads and
file changes are separate operations. Import them from `@neutral/atlas`.

## Route

```js
route(view, { point, detail: 'standard', limit: 8 })
```

| Field | Contract |
| --- | --- |
| `point`, `tree`, `query` | Supply exactly one. Point and Tree values are exact IDs; a query is nonblank text up to 4,096 characters. |
| `detail` | `overview`: selected Points; `standard`: one descendant Point level; `deep`: all descendant Point levels. Default: `standard`. |
| `type` | Optional `decision`, `observation` or `untyped` filter. |
| `limit` | Integer `1`–`100`, default `8`. Bounds each of `selected`, `supporting` and `facets`. |

A Tree selector starts at its Base Point. With `type`, it selects matching Points
owned by the Tree. Detail counts Point levels through Branch groupings. Orientation
retains the Base Point and structural ancestors even when a type filter is used.

The `atlas.route/1` result contains orientation, selected Points, supporting
descendants, relevant Facets, inclusion reasons and bounds. Authored text, source
references, decision status and observation dates remain intact.

| Status | Meaning |
| --- | --- |
| `ready` | The selector produced a reading path. |
| `ambiguous` | A query matched several lexical candidates, even if `limit` returns one. |
| `missing` | No matching Point remains under the selector and filter. |
| `unavailable` | The captured view is invalid, incomplete or absent. |

Query search considers at most 100 candidates and reports whether that window was
exhaustive. Inclusion explains structure or lexical matching; the reader assesses
relevance and source support. A Branch Facet addresses its host Branch as a whole.
Applying that interpretation to a descendant requires separate judgment.

## Inspect incoming material

```js
inspectAbsorb(view, { text, source, tree, limit: 8 })
```

`text` and `source` are required. `tree` optionally restricts candidate ownership.
`limit` is `1`–`100`, default `8`. The source follows the
[source-reference format](../../spec/spec/FORMAT.md).

The `atlas.absorb-inspection/1` result retains the incoming text and source,
extracted search terms, candidate Points, possible owning Trees, existing Facets
and bounds. Status is `candidates`, `no-candidates`, `missing` for an absent
requested Tree, or `unavailable` for an unusable view. Candidate search examines
at most 100 results. The author decides whether and where to integrate material.

## Prepare contributions

```js
prepareAbsorb(view, { source, contributions, changes, rationale, unresolved })
```

`source`, `contributions`, `changes` and a nonblank `rationale` are required.
`unresolved` is an optional array of questions. Changes use exact `{path, content}`
records; `content: null` removes a file. Each contribution has a nonblank
`rationale` and these fields:

| `disposition` | Target fields |
| --- | --- |
| `update`, `conflict`, `reference-only` | Existing `point` ID. |
| `create` | New `point` ID and owning `tree` ID. |
| `facet` | Owning `tree` and `facet` IDs. |
| `non-integration` | None. |

Every changed Point or Facet needs an explicit contribution decision.
`reference-only` preserves explanation, standing, placement and existing sources.
`non-integration` alone permits no file changes. Creation cannot overwrite an
existing identity; repeating identical contributions can return `noop`.

The `atlas.absorb-proposal/1` result contains `plan`, `decisionDiagnostics` and
`impact`, with status `ready`, `invalid` or `noop`. Review the outer proposal
status: contribution errors can make a structurally valid plan invalid. Only a
`ready` or `noop` proposal can proceed through [authoring](authoring.md).

An incoming local source with `sha256` becomes an apply precondition. Application
rechecks its bytes within caller-granted roots. HTTP(S) sources remain references.
The author assesses source support and resolves conflicting claims.

## Review impact

`reviewImpact(before, after)` returns `atlas.impact-review/1`. It identifies
changed Points, Trees, Branches and Facets. Point changes distinguish Type,
decision status, observation date, placement, explanation, sources and uncertainty.

The before/after review sets retain ancestors, attachments and known incoming
references, including removed relationships. They identify recorded connections
for the author to assess when deciding which explanations need revision.
