# Assemble the Atlas application

This workflow builds one versioned archive with the `atlas` command, pinned Node
runtime, the shared Library, Editor and Portal components, browser assets,
schemas, agent guides, and original dependency notices. The
[end-user guide](USER-GUIDE.md) owns installation, opening, export, agent
connection, updates, and removal. The `@neutral/atlas` npm package exposes the
same application and embedding APIs. Its [assembly command](../package-sdk.mjs)
shares [Library assembly](../assemble-library.mjs) with the native archive.

The same assembly emits `atlas-payload-VERSION-TARGET.tar.gz` without the Node
runtime or native installers. Its application files and `applicationSHA256`
match the native bundle. An explicit `ATLAS_NODE=/absolute/path/to/node` selects
a compatible shared runtime through the same `bin/atlas` launcher. The launcher
accepts Node 22.23.2 or later on major 22, and Node 24. The
[integration guide](../../docs/integration.md) covers runtime ownership, container
mounts, origins, readiness, shutdown, and MCP without introducing another
application implementation. Native dependencies make the payload target-specific.

## Build

Run from the repository root after the frozen workspace installation:

```sh
corepack pnpm@11.22.0 install --frozen-lockfile
node distribution/bundle/assemble.mjs --output /absolute/new-artifacts
```

Assembly runs on the target platform. It downloads the official Node.js
22.23.2 archive and verifies the committed SHA-256 from
[Node's checksum list](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt).
An existing download is reused only after the same verification. The output
directory can already contain downloads; an existing assembled bundle refuses
replacement.

Assembly reuses `assembleLibrary`, copies the installed locked production
dependency closure, and retains distinct resolved peer instances. Every package
link resolves within the bundle. The runtime contains the Node binary and its
original license; npm and pnpm are absent. Normal operation uses the bundled
binary even when another Node installation exists.

The archive records sorted paths, fixed timestamps and ownership, file modes,
relative links, and deterministic gzip output. Reassembly of unchanged source,
the same installed lock resolution, and the same pinned runtime produces the
same archive bytes. `bundle.json` records every distributed file and link;
the adjacent archive JSON records its SHA-256 and byte length.

## Platform matrix

| Target | Prerequisites | Evidence boundary |
| --- | --- | --- |
| `darwin-arm64` | macOS 26, Apple silicon | Native artifact can be exercised on the current host. Its exact observation identifies performed operations. Earlier macOS versions remain unqualified. |
| `linux-x64` | Linux x64, glibc 2.28 or later | Local container qualification uses amd64 emulation on ARM64 macOS. Its report identifies the exact artifact. Native Linux x64 hardware and hosted CI remain unobserved. |

`targets.json` owns runtime downloads and checksums. The
[bundle CI](../../.github/workflows/bundle.yml) installs the frozen workspace,
builds on each declared platform, and runs the installed bundle gate. Native
dependencies are selected and exercised on that platform. A successful mock or
cross-platform manifest check does not qualify another platform. Archives are
unsigned. No installer adds a service or performs an automatic update.

## Verification

```sh
node --test distribution/bundle/bundle.test.mjs
node distribution/bundle/qualify.mjs /absolute/artifacts/atlas-0.9.0-darwin-arm64
node distribution/bundle/qualify.mjs /absolute/artifacts/atlas-payload-0.9.0-darwin-arm64 --node /absolute/node24
npm run release:check
```

The unit tests exercise archive reproducibility and safe installation effects.
The installed gate runs outside the checkout with an empty executable PATH,
tests relocation and paths with spaces, and exercises the actual bundled runtime.
Browser interaction and platform claims require their own observed runs.

The existing attribution collector inventories the complete copied production
closure. Original package manifests, licenses, attribution files, and the Node
license remain in the bundle. Coverage or retention failures stop assembly.
Missing license metadata remains explicit in `notices/inventory.json`; it does
not establish license compatibility or complete rights clearance.
