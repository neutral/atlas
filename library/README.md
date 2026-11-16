# Atlas Library

The Library holds every operation on an Atlas that the CLI, the MCP server and
the Portal share: reading an Atlas, finding and following its Points,
preparing, reviewing and applying a change, reading sources and stamping them,
and selecting Trees for publication. The adapters add transport and output
shapes; what an Atlas means, and what each operation must keep, is owned by the
[specification](../spec/SPEC.md) and the
[operations contract](../spec/spec/OPERATIONS.md). It needs Node.js
22.23.2 or later and has one dependency, `markdown-it`.

## Import it

The package `@neutral/atlas` exports the Library as its main entry:

```js
import { openAtlas, route } from '@neutral/atlas';
```

In this source tree the same entry is [`src/index.mjs`](src/index.mjs), and
[`src/index.d.ts`](src/index.d.ts) declares every operation's inputs and
results. `src/frontmatter.mjs` (the strict JSON and Markdown parsers) and
`src/search.mjs` (lexical search, with no Node imports so the Portal's page can
use it) are imported by path; the entry does not re-export them.

Source files are read only within the directories the caller grants, the
Atlas root by default. Operations that save drafts or journals keep them in
private state, outside the Atlas: set `ATLAS_STATE_HOME` to an absolute
directory to choose where
([Private state](../docs/reference/changes.md#private-state)).

## The operations, by job

| Job | Operations | Reference |
| --- | --- | --- |
| Read | `openAtlas` captures an Atlas as a view with its identity, status and diagnostics; `validateFiles` does the same for files in memory. `getPoint`, `getTree`, `getFacet` read one record with its context. `summarizeAtlas` lists the records in bounded pages; `compareViews` says which files differ between two views; `readJsonChunk` returns a large result as exact JSON text in chunks. `listStyles` and `getStyle` give the curated Styles. | [Reading](../docs/reference/reading.md#inspect) |
| Find | `searchAtlas` ranks Points and Facets lexically. `route` returns a reading path for a Point, a Tree, a Facet or a question, in read or discover mode. | [Reading](../docs/reference/reading.md#search), [Route](../docs/reference/reading.md#route) |
| Change | `writeCandidate` writes the candidate folder. `prepareChange`, `prepareChangeFromDisk`, `prepareFromCandidate`, `prepareInitialization` and `prepareMove` prepare a plan. `inspectChange` reads a plan's two sides; `reviewChange` and `reviewImpact` give its effects. `saveDraft`, `loadDraft`, `listDrafts`, `deleteDraft` and `summarizeDraft` keep and show drafts. `applyDraft` writes a draft at its exact revision, and `applyBlocker` says what would stop the next apply; `listTransactions` and `recoverChange` roll back an interrupted apply. `stateHome`, `resolveState` and `isPrivateStatePath` locate private state, and `checkStateLocation` says whether it can be used. `inspectAbsorb` shows where incoming material may belong. | [Changes](../docs/reference/changes.md); [absorb](../docs/reference/cli.md#absorb) |
| Sources and stamps | `referenceIndex`, `resolveReference`, `directCiters` and `sourceCitations` follow links and citations as authored. `markdownHeadingIds` names a text's headings. `validateSource` checks a source reference; `readSource`, `observeSource` and `citedMaterial` read what it cites within grants. `prepareStamp` prepares stamps; `staleSources` reports how each source stands against its stamp. | [Sources and stamps](../docs/reference/sources.md) |

How Checks are listed is in [Reading](../docs/reference/reading.md#a-record), and how a draft reports them in [Changes](../docs/reference/changes.md#review).
The commands and tools that reach each operation are in the
[atlas command reference](../docs/reference/cli.md) and the
[MCP server reference](../docs/reference/mcp.md).

## An example

From the repository root, find a Point in the shipped example, read it, and
ask how its sources stand:

```js
import { openAtlas, route, staleSources } from './library/src/index.mjs';

const view = await openAtlas('examples/offline-notes');
const found = route(view, { query: 'server receipt', mode: 'discover', limit: 1 });
const reading = route(view, found.selected[0].point.selector);
const stale = await staleSources(view);
console.log(view.status, found.status, reading.selected[0].point.title);
console.log(stale.counts);
```

```text
$ node --input-type=module -e "$(cat example.mjs)"
ready ambiguous A note is “Saved on this device” until a server receipt makes it “Sent for sync”
{
  references: 13,
  current: 13,
  changed: 0,
  missing: 0,
  denied: 0,
  unstamped: 0,
  remote: 0
}
```

`ambiguous` says the query matched more than one record: discovery returns
candidates, and the reader chooses one by its exact selector.

## Tests

`npm test` in this directory runs the Library's tests.
