# Security

Atlas processors must treat every Atlas document set as untrusted input.

## Supported revision

Security fixes apply to revision 0.9.0, format 2, and the included processors.
Other formats are not supported compatibility targets. For an npm installation,
update `@neutral/atlas` and keep the host's Node runtime current within the
supported versions. The native bundle includes its pinned runtime and dependencies.
Update the bundle to replace those components; updating the host's Node does not
update the bundled runtime.

## Processing boundary

The reference validator processes local files. It does not execute Atlas content
or grant operation authority from mapped context.

The format and validator enforce these boundaries:

- Structural front matter follows the [JSON parsing profile](spec/spec/PROCESSING.md#text-and-json), including duplicate-name, numeric, and Unicode checks.
- Structural files and local reference paths must not traverse symbolic links.
- Processors resolve local references within the Atlas before inspecting a target.
- Processors report references outside the Atlas and do not read them.
- Processors reject ordinary content references to structural, Check, Point, and publication-profile targets.
- External URIs identify targets. Validation does not retrieve them.
- Incomplete file-system inspection yields an incomplete result instead of a conformance claim.
- Publication profiles are explicit source allowlists. Validation resolves them;
  the Portal compiler separately enforces selection across generated output.

A publication build must enforce its selected profile across rendered documents, navigation, indexes, search, machine-readable routes, diagnostics, caches, and every other generated channel. That build and its serving environment own non-disclosure guarantees; the profile contains no credentials or deployment authority.

Applications that embed an Atlas processor must also set suitable file-size, memory, CPU, and execution-time limits for their environment.

## Local application and agent scope

`atlas open` defaults to a service bound to `127.0.0.1`. A trusted host can select
an explicit container bind address and exact browser-visible origin. Nonloopback
binding requires that origin; forwarding headers do not widen it. The per-launch
fragment token and exact Host and Origin checks protect data operations. Browser requests cannot
replace the selected project, Atlas, durable state, evaluator module, or export
destination. The launcher selects those paths under trusted host configuration.
The service exposes packaged assets and bounded operations, not a directory
server, proxy, or shell. Closing the terminal service ends that launch.

The MCP adapter receives fixed host-selected roots through `atlas mcp`.
Configuration generation does not modify the host's actual settings. Tool calls
cannot enlarge source grants or load executable modules. Stdout carries protocol
traffic only. Optional evaluator modules are trusted local code; a worker is not
a sandbox for their ambient permissions.

Drafts, interrupted-write originals, and retained reports can contain complete
source bytes. Managed state remains separate from authored content, disposable
cache, and exported sites. Updates and removal preserve that state. A source grant
permits reading and supplies no permission to disclose its bytes. The Editor and
agent contracts own state placement, stale-write refusal, and recovery checks.

## Dependency installation

Source builds use the repository's exact pnpm version and committed lockfile.
Direct registry dependencies use exact versions. New package releases must age
for seven days before resolution.

The repository configuration disables npm lifecycle scripts. pnpm rejects
unreviewed dependency builds and permits only the reviewed `esbuild` and
`workerd` builds. Astro requires `esbuild`; local Cloudflare testing requires
Wrangler's `workerd` runtime. The configuration rejects exotic transitive sources,
missing registry release timestamps, trust downgrades, incompatible engines,
and invalid peers. Locked registry dependencies retain integrity evidence.

From the repository root, run
`corepack pnpm@11.22.0 install --frozen-lockfile`, then
`npm run audit:dependencies` to check current registry advisories. An advisory at
moderate severity or higher fails the audit. npm consumers use their host
project's dependency policy; installing Atlas does not adopt the repository's
pnpm configuration.

## Report a vulnerability

Send focused vulnerability feedback to [info@neutral.dev](mailto:info@neutral.dev).
Follow [Contributing](CONTRIBUTING.md), including its required statement and
submission limits. Do not send secrets or personal data.

Include the affected revision, operating system, Node.js version, the expected
boundary, and a description of the observed result.
