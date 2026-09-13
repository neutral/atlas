# Atlas Library

This guide serves developers who embed Atlas or operate its command adapters.
Install `@neutral/atlas` from npm to use these APIs and the `atlas` application.
The [distribution guide](../distribution/README.md) also covers native archives.

The Library exports captured reading views, local workspaces, prepared authoring,
explicit Check evaluation, retained reports, and TypeScript declarations.
Command adapters live in `apps/cli/`; the agent adapter and packaged guides live
in `apps/agent/`. The source workspace component is `atlas-reference-validator`.
Distribution exposes its supported interfaces through `@neutral/atlas`.

This package is the reference implementation of the Atlas 0.9.0 structural and resolved profiles. It validates strict text and JSON front matter, structural discovery, anchor/context Point groups, substantive Markdown blocks, explained Area memberships, and unique routing questions. It does not score prose length. Resolved validation covers registered Resources, relation notes, supersession, Checks, publication selections, local path safety, and deterministic normalized output.

A complete valid resolved result establishes format validity only. Atlas-local Check compliance and semantic, evidence, usefulness, or product claims remain separate contracts.

## Install

Use Node.js 22.23.2 or a later compatible release. Install Atlas in an existing
Node project, or create an empty ESM project first:

```sh
npm init --yes
npm pkg set private=true --json
npm pkg set type=module
npm install --save-exact @neutral/atlas@0.9.0
npm exec -- atlas open /absolute/path/to/project
```

Import supported APIs from `@neutral/atlas`. Run local command bins through
`npm exec --`, or configure an agent host with their absolute paths under
`node_modules/.bin/`. The package supplies the command adapters, Editor and
Portal assets, declarations in `src/index.d.ts`, schemas in `schemas/`, and
operating contracts in `guides/`. Start with
[Working with Atlas](../apps/agent/guides/OPERATING.md); load linked details as
needed. Private source modules are not supported imports.

The [project guide](https://github.com/neutral/atlas/blob/main/docs/using-from-another-repository.md)
explains opening, editing, export, and agent connection. The examples below expose
the same reading, source-grant, freshness, and prepared-authoring boundaries for
embedding. Preserve an existing host dependency trust and build policy.

## Validate an Atlas

```sh
npm exec -- atlas-validate "/absolute/path/to/project/atlas" \
  --profile neutral.atlas-validator.resolved \
  --json
```

The CLI reports specification revision `0.9.0` by default. Use `--specification-revision` to record a more specific immutable revision when required.

The CLI exits with `0` for a complete valid result or matching fixture matrix, `1` for a complete invalid result or fixture mismatch, and `2` for invalid usage or an incomplete result. JSON output conforms to the versioned schemas packaged in `schemas/`.

## Inspect one Point

`atlas-inspect` assembles an exact Point identity for local reading:

```sh
npm exec -- atlas-inspect "/absolute/path/to/project/atlas" \
  --point edge-authentication
```

The command prints JSON. It validates the complete Atlas with the resolved
profile before selecting the Point. Similar wording and partial ids never select
another identity. `--specification-revision REVISION` records an immutable source
revision when supplied.

A found result includes the complete normalized Point: canonical state, anchor
path, every context record, explained memberships, incoming and outgoing relation
notes, Content, References, and extensions. It also includes each containing
Map's metadata, the member Areas, and the registered Resources used by those
Point records and Areas. References retain their evidence roles and selectors.

The output contract is `atlas.point-inspection/1`. Its `status` is `found`,
`not-found`, `invalid`, or `incomplete`. Every result contains `atlasRoot`,
`pointId`, `validation`, and `limits`. The validation summary retains the
profile, completeness, validity, revision, implementation, and diagnostic counts
by severity. Invalid or incomplete validation also includes ordered diagnostics.
Use `atlas-validate --json` for complete diagnostics after successful validation.
Only `found` adds `atlas`,
`point`, `maps`, and `resources`. This selected view is separate from the
normalized-model and validation-result schemas.

An Atlas directory or a path inside it selects the nearest containing Atlas.
Paths are relative to that discovered `atlasRoot`. Registered Resource URIs are based at
`atlas.md`; direct URIs are based at the owning Point-record or Map path.
Source contents are not fetched. Atlas and Map prose and material, unrelated
Areas, other Point bodies, Checks, and publication profiles remain outside the
view. Relation endpoints remain exact ids without recursive expansion.

Inspection applies no publication profile and can include locally available
unselected records. Use the publication tooling for public output. A found Point
does not establish source truth, task completeness, or Check compliance. The
command reduces output selection work; it still parses the complete Atlas.

Exit codes are `0` for a found Point, `1` for invalid input, `2` for invalid
usage or incomplete validation, and `3` for an exact id absent from a valid
Atlas. Invalid usage writes an error to stderr. Other outcomes print JSON.

The package exports `inspectPoint(atlasPath, pointId, { specificationRevision })`
with the same result. It performs resolved validation on every call.

## Read through Atlas Tools

`atlas-read` exposes the reusable reading API through the installed command:

```sh
atlas-read "/absolute/path/to/project/atlas" find "authentication" --type point --limit 10
atlas-read "/absolute/path/to/project/atlas" find '"edge authentication" OR rotation' --mode fts --type point
atlas-read "/absolute/path/to/project/atlas" document "maps/architecture/points/edge-authentication.md"
atlas-read "/absolute/path/to/project/atlas" source --resource authentication-guide --max-bytes 4096
atlas-read "/absolute/path/to/project/atlas" source --uri "../../../../docs/authentication.md" \
  --owner "maps/architecture/points/edge-authentication.md" \
  --allow-root "/absolute/path/to/project/docs"
atlas-read "/absolute/path/to/project/atlas" compare "/absolute/path/to/other/atlas"
```

The canonical syntax is `atlas-read <atlas-path> <operation> ...`. In the
development workspace, prefix the command with
`corepack pnpm@11.22.0 exec`. Each invocation opens a captured view.
Comparison opens both paths with the same optional
`--specification-revision REVISION`.

`find` accepts one quoted query. Its default `--mode ranked` uses SQLite FTS5
tokenization and BM25 ranking for ordinary text. It searches for any query term
and places exact id matches first. `--mode fts` accepts explicit SQLite FTS5
phrases, prefixes, Boolean operators, `NEAR`, and column queries. Invalid FTS
expressions fail without a fallback. An empty query lists candidates.
The indexed columns are `id`, `title`, `summary`, `path`, and `body`. Queries
accept at most 4,096 UTF-16 code units and 128 tokenizer occurrences.

Repeat `--type` to select `map`, `area`, `point`, `resource`, or `check`. `--limit`
accepts 1 through 200 and defaults to 30. Pass the returned opaque `nextCursor`
through `--cursor` with the same query, mode, and type set. An edited Atlas
invalidates the cursor. Use `--` before a positional query or document path that
begins with a dash.

`document` returns retained bytes and diagnostics for one exact Atlas-relative
path. It supports invalid drafts. Its `read` or `truncated` result establishes
raw access, not structural validity. The default retained limit is 1,048,576
bytes per file. Complete input hashes still cover the full examined bytes.

`source` requires exactly one `--resource ID` or `--uri URI`. Registered sources
always use `atlas.md` as their base. `--owner PATH` applies only to direct URIs.
Repeat `--allow-root ABS` to authorize additional local roots. `--max-bytes`
sets a positive retained-byte limit and defaults to 1,048,576. The command
supplies no network reader and executes no project commands. A source read is a
separate current observation, not bytes frozen by the opened view.

Operations print their public JSON results to stdout. Invalid arguments and
unexpected failures print only `{"error":{"code":"...","message":"..."}}`
to stderr. Usage errors use `atlas.tools.invalid-argument`; mismatched cursors
use `atlas.tools.invalid-cursor`; unexpected failures use
`atlas.tools.unexpected-error`. `--help` prints usage text.

| Exit | Result |
| --- | --- |
| `0` | `ready`, `read`, `truncated`, `compared`, or help. |
| `1` | `invalid`. |
| `2` | `incomplete`, `unavailable`, `unreadable`, or a usage/unexpected error. |
| `3` | `missing`, `unrequested`, `unsupported`, or `stale`. |

## Keep a local workspace

Create ordinary `atlas.workspace.json` in the selected repository:

```json
{ "format": 1, "atlasPath": "atlas" }
```

Use `"atlasPath": "."` when the repository root is itself the Atlas. The library
does not write this configuration implicitly. The installed workspace command
accepts an absolute repository root:

```sh
atlas-workspace "/absolute/path/to/project" read
atlas-workspace "/absolute/path/to/project" refresh
```

Without a configuration file, supply `--atlas atlas`. Each command opens a new
in-memory workspace and leaves no reading state on disk. Keep a workspace instance
open to reuse its current observation:

```js
import { openWorkspace } from '@neutral/atlas';

const workspace = openWorkspace({ repositoryRoot: '/absolute/path/to/project' });
try {
  const observation = workspace.read();
  console.log(observation.freshness);
  console.log(observation.view.inspectPoint('edge-authentication'));
} finally {
  workspace.close();
}
```

Workspace operations are synchronous. Each read rehashes source inputs and reloads
configuration. Unchanged inputs reuse the current parsed view. Refresh opens a new
view. A new workspace or process validates source independently. Each workspace
retains at most one view; caller-held views remain readable after refresh or close.

The envelope contains the view and its observed freshness. Complete invalid drafts
remain invalid and can be reused. Incomplete reads return their current diagnostics
without substituting an earlier successful view. Reading and refresh write no files.
Saved drafts, authoring recovery, and retained Check reports remain independent
durable state under their owning contracts.

The command exits with `0` for a ready view, `1` for a complete invalid view, and
`2` for incomplete input or an error. The
[workspace contract](../apps/agent/guides/spec/WORKSPACE.md) defines configuration
precedence, exact errors, memory lifetime, and freshness limits.

## Read an immutable supplied tree

`openAtlasSnapshot` copies complete caller-supplied file bytes into a sealed
repository namespace. It never falls back to files at that namespace on the host:

```js
import { openAtlasSnapshot } from '@neutral/atlas';

const view = openAtlasSnapshot({
  repositoryRoot: '/source/project',
  atlasPath: 'atlas',
  files: suppliedFiles,
  revision: 'caller-observation-1',
});
```

`suppliedFiles` maps exact repository-relative paths to strings or `Uint8Array`
values. Parents are inferred; optional `directories` preserve empty directories.
The view hashes the full supplied tree. The optional revision is a caller label,
not proof of a Git commit or source authenticity. Symbolic-link entries are not
supported. Complete supplied bytes remain in memory even when raw-document output
is truncated. Local source reads use those immutable bytes; outside-Atlas roots
still require explicit allowance. External readers remain separate observations.

## Reuse an opened Atlas

An opened view validates once and retains an immutable observation for several
reads. Atlas Portal uses this API before applying its explicit publication
selection. Import supported exports from the package root:

```js
import { openAtlas } from '@neutral/atlas';

const view = openAtlas('/absolute/path/to/project/atlas');
if (view.status === 'ready') {
  const candidates = view.find('authentication', { types: ['point'], limit: 10 });
  for (const candidate of candidates.items) {
    const point = view.inspectPoint(candidate.id);
    console.log(point.point, point.maps, point.resources);
  }
}
console.log(view.freshness());
```

`view.validation` retains the validator result. Invalid and incomplete views
expose diagnostics and captured raw documents without a normalized model.
`view.readDocument('atlas.md')` returns the captured source, its identity, and
diagnostics. Raw bytes are bounded and truncation remains explicit.

`view.readSource({ resource: 'design-note' })` asynchronously reads a registered
source. Direct references supply their owning file through `ownerPath`.
Source reads are separate current observations. External local files require
explicit `allowedRoots`; external URIs require a caller-supplied `reader`.
Opening a view never executes commands or fetches websites.

`view.inspectResource('design-note')` selects one exact registered id and its
authored Content and Reference uses. Each use retains its role, target, and
owner provenance, including the Map or Area question when applicable. Matching
URIs do not infer additional uses. Resource inspection fetches no source bytes
and applies no publication selection.

`view.compare(otherView)` reports source and normalized-record changes.
`view.refresh()` returns a new view without replacing the earlier observation.
Search continuations are bound to the view, mode, normalized input query, and
selected types. `view.find(query, { mode: 'fts' })` selects explicit FTS5 syntax;
the default mode ranks ordinary text. Each Point record is indexed separately,
so a phrase or conjunction cannot join words across an anchor and its contexts.
Point results are grouped by exact id and ranked by their strongest matching
record. Repeated contexts do not add ranking votes. Results include up to three
exact matching record locations and excerpts plus the full `matchCount`.
Candidate pages carry compact observation identity. `view.identity` retains
the complete examined inventory for explicit provenance inspection.

Search uses authored Atlas text and Resource registrations. It does not search
retrieved Resource bodies or establish semantic relevance. Full pagination
enumerates matches to the declared expression within the captured index; it
does not establish complete answers to natural-language questions. This local
Library engine also serves Atlas Tools and Atlas Editor. Atlas Portal keeps its
separate publication-selected browser search.

Before/after input comparisons detect observed changes. They do not establish
an atomic filesystem snapshot. Views report their input identity and limits.
Exact local targets examined by validation remain tracked inside otherwise
excluded directories without recursively importing unrelated files. Their
deletion, later creation, and ancestor replacement affect freshness. External
source contents remain separate observations.
The complete public contract is [Atlas reading tools](../apps/agent/guides/spec/TOOLS.md).

## Prepare and apply a contribution

`prepareAtlasChange` captures a baseline and validates complete proposed bytes
without writing Atlas files. Each Point operation selects an exact id, Map, and
anchor or context record. Inspect its returned identity decisions, anchor
provenance, full changes, validation, and Check gaps before applying.

```js
import { prepareAtlasChange, evaluatePreparedChange, applyAtlasChange } from '@neutral/atlas';

const plan = prepareAtlasChange({
  repositoryRoot: workspace.info.repositoryRoot,
  atlasPath: workspace.info.atlasPath,
  expected: { viewDigest: observation.view.identity.digest },
  operations: proposedOperations,
});
// Review plan.pointDecisions, plan.changes, plan.validation, and plan.checks.
const verification = await evaluatePreparedChange(plan, {
  actor: { kind: 'agent', id: 'the-host-attributed-agent' },
});
// Inspect actual outcomes. An empty registry reports unsupported verification.
const applied = applyAtlasChange(plan, {
  recoveryDirectory: '/absolute/durable/recovery',
});
```

`proposedOperations` is an explicit list of initialization, Map, Area, Point,
Resource, supersession, local Check adoption, or raw-document repair operations.
It does not infer identity from similarity. Unchanged meaning needs no edit.
The [authoring contract](../apps/agent/guides/spec/AUTHORING.md) and public types
own every operation field and its preservation rules.

Application defaults to complete valid output. Raw repair can explicitly select
`mode: 'draft'` for invalid source. Stale preflight returns no writes. Partial
application identifies written and pending paths, conflicts, and durable
originals. Confirmed application removes its operation recovery. A cleanup
failure preserves the applied source result and reports
`recovery.status: 'cleanup-failed'`, the remaining location, and gaps. Per-file replacement is not
a whole-Atlas transaction. Saving is separate from actual Check compliance.

The installed `atlas-author` command accepts an exact JSON request and writes a
new durable plan file for review. It never overwrites an existing plan file.

```sh
atlas-author prepare --request /absolute/request.json --plan /absolute/durable/change.json
atlas-author evaluate --plan /absolute/durable/change.json --actor-kind agent --actor-id reviewing-agent
atlas-author apply --plan /absolute/durable/change.json --recovery /absolute/durable/recovery
```

`inspectAtlasRecovery` reads one retained operation with complete bytes and an
inspection digest. After inspecting the content and confirming it is no longer
needed, `discardAtlasRecovery` takes the same exact workspace and operation
selection plus `inspectedDigest`. It refuses active owners and changed content.
The matching `atlas-author recovery-inspect` and `recovery-discard` commands use
`--repository`, `--atlas`, and `--recovery`; discard also requires
`--inspected-digest`. These operations leave authored files unchanged. Unsupported
recovery formats require direct inspection and are never converted.

## Discover, evaluate, and retain Checks

`discoverChecks(view)` lists readable local Checks without executing them.
An unrelated invalid Map does not hide captured Check definitions. Items retain
their known catalog metadata and show `subjects: null` with explicit
`applicability.reasons` when the view cannot resolve subjects. A missing or
ambiguous registration leaves level, declared applicability, and revision
unknown. Discovery reports inventory `complete` separately from view status,
with diagnostics for definitions or registrations it could not recover.
Unknown metadata survives level and applicability filters. Requested ids that
cannot be recovered from an incomplete inventory remain in `unresolvedCheckIds`.
Use `view.readDocument(item.path)` to read a discovered Check's captured body.

`createEvaluatorRegistry(registrations)` binds trusted host callbacks to exact
Check ids and revisions of the full Markdown bytes and catalog registration.
No catalog or project-specific verifier is registered by default. Callback
declarations do not sandbox their ambient process permissions or grant new
authority.

```js
import { discoverChecks, createEvaluatorRegistry, evaluateChecks,
  retainCheckReport, readCheckReport } from '@neutral/atlas';

const registry = createEvaluatorRegistry(hostSelectedRegistrations);
const discovery = discoverChecks(observation.view, { registry });
// Inspect discovery.status, complete, diagnostics, and each item's applicability.
const run = await evaluateChecks(observation.view, {
  registry, actor: { kind: 'tool', id: 'project-verification' },
});
const retained = retainCheckReport(run, {
  repositoryRoot: workspace.info.repositoryRoot,
  directory: '/absolute/durable/reports/unique-run',
});
const inspected = readCheckReport(retained.directory, { view: workspace.read().view });
```

A verifier returns actual pass, fail, or unable results with original evidence
and diagnostics. Invalid or incomplete views invoke no verifiers, even when
discovery recovers readable policy. Runs preserve actor attribution, selected
subjects, omitted Checks, uncovered subjects, evaluator receipts, source
identity, and freshness.
Partial selection never establishes whole-Atlas compliance. Ordinary required
satisfaction and conservative audit completeness remain separate fields.

Retention is explicit. It preserves report, provenance, and original evidence
outside the evaluated Atlas and repository `tmp/`. Reinspection checks
integrity and historical freshness without rerunning verification. It does not
authenticate the reviewer or prove the assertion merely from matching hashes.
The [evaluation contract](../apps/agent/guides/spec/EVALUATION.md) owns the exact
execution, evidence, retention, and claim boundaries.

## Connect an agent host

The installed MCP stdio adapter uses fixed host-selected roots:

```text
atlas-agent --repository-root /absolute/path/to/project --atlas atlas \
  --state-directory /absolute/path/to/project/atlas-agent-state
```

The host connects stdin and stdout using MCP revision `2025-11-25`. Startup
negotiates initialization; it does not present an interactive terminal prompt.
An optional
`--evaluator-module ABS` loads trusted host code exporting `registrations`.
Tool input cannot change these paths, load modules, or expand source authority.

`atlas_state` returns a compact observation. `atlas_guide` supplies the operating
instructions and reference guides on demand. Exact reading, lexical search,
source inspection, freshness, comparison, Check discovery, evaluation, and
report retention use the public Library. `atlas_prepare` returns the complete
review descriptor; `atlas_apply` requires its retained id and reviewed digest.

`atlas_evaluate` preserves the completed run before returning its id and compact
outcome. `atlas_run` retrieves bounded details and original evidence with explicit
offsets and completeness. Large evidence and model content remain addressable
without another verifier invocation. `atlas_retain` saves that same run, and
`atlas_report` supports bounded inspection of the retained result after restart.

Hosts can embed the same adapter through `openAgentSession(options)` and
`ATLAS_AGENT_TOOLS`. The [agent tools contract](../apps/agent/guides/spec/AGENT-TOOLS.md)
defines schemas, bounded session state, errors, cancellation, source scope,
and durable recovery. Protocol qualification establishes no autonomous-task
usefulness or inferred permission to apply changes.

## Source organization

Shared implementation and public declarations live in `src/`. `schemas/` holds
exact copies of the owning schemas in `spec/schemas/`. Library tests live
in `tests/`; CLI and agent integration tests live beside their adapters. The
[CLI README](../apps/cli/README.md) and [Agent README](../apps/agent/README.md)
define their development commands.

## Development verification

These commands require the source checkout and its fixture corpus. They are not installed-consumer prerequisites:

```sh
corepack pnpm@11.22.0 install --frozen-lockfile
corepack pnpm@11.22.0 exec atlas-validate --fixtures spec/examples/manifest.json
npm run release:check
```

The [verification guide](../docs/verification.md) describes the current checks
and their limits. `guides/source-owners.json` records each installed guide's
owning specification and exact content digest.
