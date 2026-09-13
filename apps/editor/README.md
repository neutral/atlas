# Atlas Editor

Atlas Editor is a local repository application for full Atlas reading, navigation, source inspection, current-observation comparison, diagnostics, authoring, and explicit Check evaluation. The packaged Library guide `guides/spec/EDITOR.md` owns its application and security boundaries. Export site presents Portal in the same application. Generated sites remain selected, read-only publications.

The package contains a Node HTTP service, a Node worker, and packaged HTML, CSS, and browser JavaScript. The worker uses public Atlas Library interfaces. Reading and editing require no source checkout, Astro, or browser framework. The `@neutral/atlas` npm package includes this application.

## Open Atlas

Use Node.js 22.23.2 or a later compatible release, then install and open Atlas:

```sh
npm install --global @neutral/atlas@0.9.0
atlas open /absolute/project
```

The npm package includes application dependencies, browser assets, and operating
guides. A [native archive](../../distribution/README.md) also includes its pinned
Node runtime. Opening Atlas requires no separate frontend or state-directory
choice. Project discovery follows the workspace configuration.
A unique Atlas opens directly; multiple candidates require selection. An empty
project offers creation with a complete preview and explicit application.
Opening a directory writes no authored files.

The command opens the browser and prints its protected URL as a fallback. Stop
it with Ctrl+C. Drafts remain in managed operating-system user-data storage.
`--state-directory` selects an advanced durable-state override;
`--cache-directory` selects disposable compilation storage. Their locations stay
separate from authored sources and site exports.

Export site previews an explicit publication profile and destination before
export. Connect an agent shows the fixed project scope and produces MCP stdio
host configuration. Copying the configuration does not edit host settings.

## Developer launch scope

The source component also has a direct service launcher. From the repository
root after the frozen workspace installation:

```sh
pnpm --filter atlas-editor exec node bin/atlas-editor.mjs /absolute/project \
  --state-directory /absolute/editor-state --atlas atlas
```

Its command syntax is:

```text
atlas-editor REPOSITORY --state-directory DIRECTORY [--atlas PATH]
  [--evaluator MODULE] [--port NUMBER]
```

Repository, state, and evaluator arguments can be relative to the current directory. The CLI resolves them to absolute paths. `--atlas` remains an exact repository-relative path. It can be omitted when `atlas.workspace.json` selects the Atlas. The default port is ephemeral. `--help` prints usage. Startup prints a local launch URL without opening a browser automatically. Launch failures exit with code `2` and structured JSON on stderr.

The host selects one absolute repository root and an exact repository-relative Atlas path. A required absolute state directory stays outside the selected Atlas, repository `tmp/`, and `.git/`. The service derives separate recovery, reports, and drafts directories beneath it.

The service binds to `127.0.0.1` by default. Explicit container launch uses
`atlas open --bind 0.0.0.0 --port PORT --origin http://HOST:PORT --no-browser`.
The origin is exact and has no path prefix. A proxy preserves its Host and Origin;
forwarding headers never grant access. The host configures routing and TLS.
Separate `--preview-port` and `--preview-origin` configure exported-site previews. The launch URL carries a per-launch token in its fragment. The browser removes that fragment and keeps the token in tab-scoped session storage for reload. Every API call requires the exact Host, Origin, and token. Browser requests cannot replace roots, choose output paths, load modules, or execute shell commands.

An optional evaluator module is selected by the trusted host at launch. It exports evaluator registrations. Atlas text cannot register executable code. A Check without an available evaluator remains unable to verify.

Evaluator modules are trusted local code with the host process's permissions. The worker isolates processing from the HTTP event loop; it is not a code sandbox.

## Operating flow

1. Open the selected Atlas and inspect its validation and freshness.
2. Navigate Maps, Areas, Points, Resources, adopted Checks, and raw source. Search and source access follow the public Library contracts.
3. Edit complete source bytes in a draft. Durable draft storage preserves the current text and original baseline across reload and restart. Draft storage success is distinct from an authored file save.
4. Prepare the change and inspect its complete diff, validation, identity decisions, applicable Checks, and gaps.
5. Explicitly apply the retained plan. Stale or partial results preserve the draft and expose conflicts and recovery information.
6. Explicitly run available Checks against an observation or prepared plan. Retain a report as a separate action when needed. Retained reports remain available for inspection after restart.

Refresh preserves edited text and its base observation. A new observation can be compared with an available retained observation. This comparison does not provide Git history. Closing the Editor releases its reading observations. Durable drafts, interrupted recovery, and retained reports remain available after restart.

Invalid source retains diagnostic and raw repair access. A truncated document cannot become a complete editable file implicitly. Saving valid syntax does not establish Check compliance. Partial Check selection does not establish whole-Atlas compliance.

An incomplete source capture can reopen existing owned state for draft inspection.
The Editor exposes source diagnostics and the state storage's write availability.
Recovery reads require the exact workspace ownership marker and safe storage paths.
They create no state files. Draft writes, application, and report retention still
require a complete current source observation and safe state placement.

## Export and connect

Export site shows the host-selected destination. `atlas open --export-dir PATH`
selects another absolute destination. The destination must be absent and outside
Atlas content, registered local sources, durable state, and the installation.
Export applies one
reviewed publication profile. It does not publish drafts or deploy a site.
Resource access never grants permission to publish the Resource.

Without a profile, Preview a publication profile opens an editable starter. It
lists current structural records and excludes Resources and Checks. The ordinary
prepare, full-diff review, and explicit apply flow creates its authored profile.
Export then previews routes and selected Resource availability before application.
Changed source invalidates a preview. A failed build reports incomplete output;
inspect it and choose a new destination before retrying.

The npm package and native archive use precompiled Portal components and browser
assets. Source components compile in disposable storage. Open local preview serves the completed
site and stops with Atlas. Static output does not refresh when source changes.

Connect an agent returns configuration for the launch-selected project and Atlas.
The stdio adapter reserves stdout for protocol messages. Host settings remain
unchanged until the operator installs the configuration in the selected host.
Trusted evaluators require separate explicit host configuration.

## Storage and limits

State storage can contain complete draft text, original source bytes, prepared plans, and retained evidence. It is ordinary durable application storage. It is not a publication boundary or a secret scanner. Workspace reuse remains in process memory and writes no workspace cache files.

Each draft has one current recovery file. Saving replaces that file after an exact
revision check. Discard removes the selected recovery file; it leaves other drafts
and authored files unchanged. Confirmed successful application removes its separate
recovery originals and plan. A cleanup failure exposes the retained location.

Unsupported draft formats and malformed current records remain unchanged and
appear under Draft storage issues. The Editor does not convert them or supply
missing fields. Inspect their files directly. Interrupted writes can leave
`drafts/.write-lock/pending.json`. Current draft files remain readable, but the
lock blocks further mutation. Stop every Editor using this state, inspect the
lock and pending content, preserve needed unfinished text, then remove only that
inspected lock directory. Restart and inspect the current drafts before saving.
An uncertain save must not be retried with a substituted baseline or revision.

The Editor retains eight in-process reading observations, 16 plans, and 32 runs. An expired id is unavailable. Restart does not recreate old in-memory plans or runs from a name alone. Durable drafts and explicitly retained evidence remain independently inspectable. Storage permits 1,000 current drafts, each with at most 1 MiB of text. Authenticated request bodies are limited to 2 MiB. Storage failures remain visible.

Source retrieval has no default network reader. Authored Markdown cannot run scripts or automatically retrieve external content. The application exposes fixed packaged assets and a bounded authenticated operation protocol.

## Develop and verify

Run these commands from the repository root:

```sh
corepack pnpm@11.22.0 install --frozen-lockfile
corepack pnpm@11.22.0 --filter atlas-editor test
```

`src/` owns the HTTP service, worker, and operation protocol. `public/` owns
browser assets. `tests/` covers the service and browser state.

## Qualification

Service tests exercise authentication, request scope, storage, stale plans, and
explicit effects. Installed tests use packed packages outside the source
checkout. The [verification guide](../../docs/verification.md) covers the current
checks and browser review.

Automated checks do not establish attributed human journeys, measured
performance, or reduced authoring effort. Those claims require observations
of the corresponding tasks and artifact.
