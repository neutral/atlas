# Use Atlas in a project

Install Atlas with Node 22.23.2 or later and npm:

```sh
npm install --global @neutral/atlas
atlas open "/absolute/path/to/project"
```

The project needs no package manifest, tooling directory, or frontend build.
The [distribution guide](../distribution/README.md) also covers building from
source and native archives that include their own Node runtime.
[Working with Atlas](../spec/OPERATING.md) owns the route and absorb
practices; this guide explains the application workflow.

## Open or create a collection

From the project directory, run:

```sh
atlas open
```

An explicit path works from any directory, including a path with spaces:

```sh
atlas open "/absolute/path/to/My Project"
```

Atlas first respects the project's `atlas.workspace.json` selection. Otherwise it
discovers project-contained collections. A single selection opens directly. An
interactive terminal offers a choice when several exist. A noninteractive launch
reports the candidates and requires an exact `--atlas` selection:

```sh
atlas discover "/absolute/path/to/My Project"
atlas open "/absolute/path/to/My Project" --atlas context/architecture
```

`--atlas` is a project-relative path; `.` selects a project that is itself an
Atlas. A malformed workspace configuration is an error. Correct it or select the
intended valid project before reopening. Discovery and opening do not create or
rewrite authored files.

When no collection exists, the Editor offers **Initialize Atlas**. Supply the
initial identity and text, prepare the contribution, inspect its complete changes,
and apply it explicitly. The command-line equivalent also previews before writing:

```sh
atlas init "/absolute/path/to/My Project" --atlas atlas \
  --id project-context --title "Project context"
atlas init "/absolute/path/to/My Project" --atlas atlas \
  --id project-context --title "Project context" --apply
```

Inspect the first command's full proposed changes before running the second. An
existing collection is not an initialization destination. After creation, open it
and add a Map for a useful durable question. The
[starter example](../spec/examples/starter/README.md) illustrates anchors,
local contexts, and source evidence with fictional material.

## Use the local Editor

Launch prints the selected project and a per-launch URL, then opens the browser.
If automatic opening fails, use that exact printed URL. `--no-browser` prints the
URL without asking the operating system to open it. The service selects an
available loopback port by default; `--port NUMBER` requests a specific port.
A port conflict is a launch error rather than a reason to expose another host.

Keep the terminal open during the session. Ctrl-C stops the service and worker.
Restart with `atlas open` and use its new URL. Closing a browser tab does not stop
the terminal service. The URL token authorizes that local session; the service
checks the exact Host, Origin, and token for data requests.

Navigate Map and Area questions, search candidates, then inspect exact Points and
their sources. Candidate rank does not determine identity or source truth. The
Sources view distinguishes registered material from the claims that cite it.
Diagnostics remain available when source is invalid or incomplete.

To edit a document:

1. Open its edit view and change the draft text.
2. Wait for **Stored draft**, or use **Store draft now** and inspect the result.
3. Select **Prepare changes**. Review every diff, identity decision, validation
   result, applicable Check, and unresolved gap.
4. Select **Apply validated changes** to write the reviewed source.

A stored draft is unfinished text, not an authored-file save. Acknowledged draft
storage preserves its current text and original baseline across restart. Text
still marked unsaved exists only in the browser tab. Atlas never silently applies
it. The **Drafts** view reopens stored work and offers explicit discard.

External edits can make a proposal stale. Refresh preserves draft text and its
original baseline. Use **Inspect current source**, reconcile the differences,
explicitly select the current baseline, then prepare and review again. Restart
expires in-memory observations and plans; prepare recovered drafts again before
application. Interrupted application retains originals and reports recovery paths.
Inspect uncertain results before preparing another write.

Atlas manages state under the operating system's user-data location, keyed by the
canonical project and collection selection. Moving an installation preserves the
same project selection's state. Moving or renaming the project selects a different
key; Atlas does not silently move or discard the earlier state. An advanced
`--state-directory ABSOLUTE_PATH` override selects existing compatible storage
subject to the [Editor's placement and ownership rules](../spec/spec/EDITOR.md#trusted-launch-scope).
Installation, update, and removal preserve durable drafts and project files.

## Export a site

Select **Export site** to inspect publication content and its explicit destination
before building. A publication profile selects exact records and Resources; its
selection does not grow by following relationships, references, or containment.
A source grant permits reading a Resource without granting permission to publish
it. Review the actual selected content and its disclosure rights before applying
the export.

The command-line flow names an existing publication profile and an explicit output
path. This example requires a profile whose authored id is `public`:

```sh
atlas export "/absolute/path/to/My Project" --atlas atlas --profile public \
  --out-dir "/absolute/path/to/My Site"
atlas export "/absolute/path/to/My Project" --atlas atlas --profile public \
  --out-dir "/absolute/path/to/My Site" --apply --preview
```

The first command previews the selection. After review, `--apply` performs the
build and `--preview` starts its local preview. Without a publication profile,
the CLI refuses to infer permission from available content. The Editor offers
**Preview a publication profile**. Its editable starter selects current Atlas,
Map, and Point records, with no Resources or Checks. Inspect that selection and
the complete file diff, then explicitly apply the profile before exporting.
The [Publication format](../spec/spec/PUBLICATION.md#publication-profiles)
owns the stored profile. The [Portal guide](../apps/portal/README.md) explains
output checks and exact refresh behavior.

Output belongs at the chosen directory outside the installation. A built site is
read-only and contains no Editor service. Local preview is not deployment and does
not create a hosted site. Rebuild after source changes before expecting the static
artifact to contain them.

## Connect an agent

Select **Connect an agent** in the Editor, or generate host configuration directly:

```sh
atlas connect "/absolute/path/to/My Project" --atlas atlas
```

The result uses the installed launcher and fixed absolute project paths in a
standard `mcpServers` configuration. Review that scope, then add the generated
entry through the host's own configuration mechanism. Generating the entry does
not edit actual host settings. The host must be able to execute the launcher and
read the configured paths in its own environment.

The corresponding adapter command is:

```sh
atlas mcp --repository-root "/absolute/path/to/My Project" --atlas atlas
```

This command expects MCP stdio traffic, not an interactive terminal conversation.
The host connects stdin and stdout. Diagnostics use stderr; stdout is reserved for
the protocol. Atlas manages durable agent state separately from Editor drafts.
An advanced `--state-directory` override remains available.

A session fixes the project and Atlas roots at startup. Tools can read registered
local sources within the project grant, including sibling `docs/`. They cannot
widen roots, retrieve network sources, execute shell commands, or load evaluators.
An optional evaluator module is trusted code selected by the host at launch. Its
availability does not authorize invocation; unsupported verification remains unable.

For a sourced answer, read `atlas_guide` with the operating topic and open
`atlas_state`. Inspect relevant Map questions, search with `atlas_find`, inspect
exact identities with `atlas_point`, then read needed sources with `atlas_source`.
Report the answer with source paths, state, scope, uncertainty, and missing evidence.
Use `atlas_freshness` and `atlas_refresh` after external changes. A source read is
its own current observation; a retained Atlas view does not freeze outside bytes.

Authoring tools prepare a complete review before explicit apply. Tool availability
and generated configuration supply no permission to change project content.
The [agent contract](../spec/spec/AGENT-TOOLS.md) owns protocol details and
capability boundaries. The [integration guide](integration.md) explains container
paths, persistent mounts, exact browser origins, and MCP through `docker exec -i`.

## Read from the terminal

One namespace retains the existing validation and reading operations:

```sh
atlas validate "/absolute/path/to/My Project/atlas" --json
atlas read "/absolute/path/to/My Project/atlas" find "session storage" --type point --limit 10
atlas inspect "/absolute/path/to/My Project/atlas" --point session-storage
atlas read "/absolute/path/to/My Project/atlas" source --resource session-notes --max-bytes 8192
```

The last two commands require those exact authored identities. Search first when
an id is unknown. Exact inspection follows authored identity and returns related
source metadata without recursively reading every related Point or source. A
truncated source result requires a larger authorized byte bound before claiming
its complete text was read.

Existing documents can stay beside the Atlas. A registered Resource URI such as
`../docs/session-notes.md` resolves from `atlas.md`. A direct URI resolves from its
owning structural record. The CLI grants only the Atlas root by default; a sibling
source needs an explicit additional root:

```sh
atlas read "/absolute/path/to/My Project/atlas" source --resource session-notes \
  --allow-root "/absolute/path/to/My Project/docs" --max-bytes 8192
```

Without that grant, the sibling read is `unrequested`. The
[reading contract](../spec/spec/TOOLS.md#source-reads) owns URI resolution,
byte bounds, statuses, and unsupported targets. A Resource path never grants
access by itself.

## Follow one question to its source

The repository's [fictional starter](../spec/examples/starter/README.md)
provides a concrete reading example. Copy its complete directory only into an
absent, authorized target, then use its actual Atlas path in these commands.
Its question is which session store is selected and what is known about adoption
and recovery:

```sh
atlas read "/absolute/path/to/copied-starter" find "Redis sessions" --type point --limit 10
atlas inspect "/absolute/path/to/copied-starter" --point redis-for-sessions
atlas inspect "/absolute/path/to/copied-starter" --point api-session-migration
atlas read "/absolute/path/to/copied-starter" source --resource session-notes --max-bytes 8192
```

`redis-for-sessions` assembles the architecture anchor and operations context.
The separate `api-session-migration` Point links its API observation to that
decision through an `implements` relation. Follow that exact endpoint because it
addresses adoption; Point inspection does not recursively fetch related Points.

Read the source's Decision, Observed implementation, Recovery implication, and
Evidence gap sections. Registered References retain opaque selectors; the local
reader does not interpret them. Inspect the named sections in the returned text
and respect any truncation.

The example supports a bounded answer: Redis is selected for production sessions;
API release r17 was observed using it; recovery depends on Redis availability and
may involve lost sessions. The notes supply no worker migration result. Neither
the decision nor the API observation establishes that every service migrated.
Return those limits and exact sources with the answer. Fictional starter claims
need replacement before becoming live project context.

`atlas workspace`, `atlas author`, and the other subcommands expose their own help.
The [Library guide](../library/README.md) documents the underlying API and advanced
operations for developers. The npm package also exposes those APIs for embedding.
Atlas requires no other product to preserve identities, context, sources, or
explicit state.
