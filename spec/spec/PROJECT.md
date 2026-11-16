# Project workflow

`atlas open [PROJECT]` serves the Portal for the project's Atlas and opens it
in a browser. PROJECT defaults to the working directory. Opening discovers or
selects an Atlas and writes nothing. When discovery finds no Atlas, the Portal
says so and names the command that creates one.

`atlas init` prepares a new Atlas at the selected location through the
ordinary prepared change: a manifest and a Style. The Style is one of the
curated definitions, by name, or a complete definition the caller supplies.
The choice is visible in the draft before anything is applied. An application
MAY recommend a Style from the intended readers and their questions; it MUST
NOT choose one silently.

Selection precedence is `--atlas PATH`, `atlas.workspace.json`, then discovery.
The workspace file is strict UTF-8 JSON: `{ "format": 1, "atlasPath": "context" }`.
Unknown fields are rejected even when an explicit selection overrides the path.
Paths are exact, project-relative directories; `.` selects the project itself.
Absolute paths, traversal, spelling aliases and symbolic-link descendants are
refused.

Discovery stops at each `atlas.json` boundary. It skips hidden directories,
`node_modules`, `vendor`, `dist`, `build`, `coverage`, `tmp` and `temp`. Its
limits are 20,000 entries and 12 directory levels. Reaching a limit requires
explicit selection; a partial search cannot establish uniqueness. An explicit
path can select a nested Atlas.

A single result opens directly. Multiple results require a terminal choice or
`--atlas`; noninteractive callers receive the choices and an error.
Configuration and selected directory identities are rechecked after selection.
A changed selection requires another open operation.

The launch fixes the project source grant, additional grants and the state
location. Requests cannot expand them. `atlas config [PROJECT]` selects the
Atlas as opening does and returns the configuration that connects an agent
host to it, granting the project directory so the agent can read the sources
the Atlas cites, for the user to install through that host. Neither opening
nor generating configuration changes agent-host settings.

The service listens on local loopback, answers only requests addressed to that
loopback name and port, and accepts only read requests. `--no-browser` prints
the address without requesting a browser. SIGINT or SIGTERM stops it.
