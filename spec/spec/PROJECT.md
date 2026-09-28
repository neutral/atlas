# Project workflow

`atlas open [PROJECT]` opens the local Editor. PROJECT defaults to the working
directory. Opening discovers or selects an Atlas without writing authored files.
When discovery finds no Atlas, the Editor offers reviewed creation at the project
root.

Selection precedence is `--atlas PATH`, `atlas.workspace.json`, then discovery.
The workspace file is strict UTF-8 JSON: `{ "format": 1, "atlasPath": "context" }`.
Unknown fields are rejected even when an explicit selection overrides the path.
Paths are exact, project-relative directories; `.` selects the project itself.
Absolute paths, traversal, spelling aliases and symlink descendants are refused.

Discovery stops at each `atlas.json` boundary. It skips hidden directories,
`node_modules`, `vendor`, `dist`, `build`, `coverage`, `tmp` and `temp`. Its limits
are 20,000 entries and 12 directory levels. Reaching a limit requires explicit
selection; a partial search cannot establish uniqueness. An explicit path can
select a nested Atlas.

A single result opens directly. Multiple results require a terminal choice or
`--atlas`; noninteractive callers receive the choices and an error. Configuration
and selected directory identities are rechecked after selection. A changed
selection requires another open operation.

The launch fixes the project source grant, additional grants, state location and
export destination. Browser inputs cannot expand them. Creation uses the ordinary
draft/review/apply path. Export previews an explicit selection before building;
Connect agent returns configuration for the user to install through their host.
Neither opening nor configuration generation changes agent-host settings.

The service listens on local loopback and issues a per-launch token. `--no-browser`
prints the launch URL without requesting a browser. SIGINT or SIGTERM stops it.
