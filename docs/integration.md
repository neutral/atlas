# Integrate Atlas with a shared runtime

Atlas can run from its native bundle or a target-specific application payload
with an explicitly selected compatible Node runtime. Both forms expose the same
`atlas` command, version, Editor, export, and MCP interfaces. This guide covers
runtime placement and container integration. It does not describe an implemented
suite, shared account system, or orchestration service.

Use the [npm installation](using-from-another-repository.md) for ordinary local
operation, or install a [native archive](../distribution/bundle/USER-GUIDE.md). [Bundle assembly](../distribution/bundle/README.md) owns artifact
names, runtime compatibility, platform inputs, and manifests.
[Verification](verification.md) describes the evidence required for actual native
and container execution. A container configuration example is not evidence that
its image or target has been tested.

## Runtime placement

A native installation keeps the application beside its pinned runtime:

```text
atlas-version-target/
├── bin/atlas
├── app/
├── runtime/bin/node
├── notices/
└── bundle.json
```

The launcher resolves those paths from its own location. Moving the complete
artifact preserves that relationship. It requires no Node or package manager on
`PATH` and no link to a source checkout.

A payload contains the application, prebuilt browser assets, runtime dependencies,
guides, schemas, and notices. The host supplies Node separately:

```text
shared-runtime/bin/node
atlas-payload/
├── bin/atlas
├── app/
├── notices/
└── payload.json
```

Select the compatible shared runtime explicitly with an absolute `ATLAS_NODE`
path. The payload launcher does not search `PATH` for Node or install dependencies
at startup:

```sh
ATLAS_NODE=/absolute/shared-runtime/bin/node \
  /absolute/atlas-payload/bin/atlas --version
ATLAS_NODE=/absolute/shared-runtime/bin/node \
  /absolute/atlas-payload/bin/atlas open "/absolute/path/to/project"
```

The payload is target-specific because its dependency closure can contain native
code. A macOS payload is not a Linux payload. Match the payload's OS and
architecture to the host and use the runtime compatibility declared in its
manifest. Supported shared runtimes are Node 22.23.2 or later on major 22, and Node 24.
Exact operated versions remain in the qualification record. The shared runtime's owner supplies
its updates and license notices. Updating Atlas does not update that external
runtime.

## Container mounts and launch scope

A container places the selected payload at `/opt/atlas` and a compatible Node 24
runtime at `/usr/local/bin/node`. These paths are deployment choices, not required
project structure. The container's environment selects:

```text
ATLAS_NODE=/usr/local/bin/node
```

Use distinct mounts for source, durable state, disposable cache, and export:

| Container path | Access | Purpose |
| --- | --- | --- |
| `/opt/atlas` | Read-only | The extracted target-specific application payload. |
| `/project` | Read/write for authoring | The selected project, including its Atlas and granted local sources. |
| `/state` | Read/write, persistent | Editor drafts, interrupted writes, and retained agent evidence. |
| `/cache` | Read/write, disposable | Rebuildable tooling state. |
| `/exports` | Read/write | Explicit static-site destinations. |

Create writable mounts with ownership appropriate to the selected container user.
Keep `/state` across container replacement. Removing `/cache` can discard only
rebuildable content; removing `/state` can lose drafts, recovery, and retained
reports. Keep cache outside the whole project and both directories outside the
selected Atlas and its registered source targets. The owning application checks
remain in force inside a container.

Run the payload as the supervised container process:

```sh
/opt/atlas/bin/atlas open /project --atlas atlas \
  --bind 0.0.0.0 --port 4721 --origin http://localhost:4721 --no-browser \
  --state-directory /state/editor --cache-directory /cache \
  --export-dir /exports/site
```

The example assumes `/project/atlas` is the exact selected collection and the
host publishes container port 4721 as `127.0.0.1:4721`. `--bind` selects the
container listener. `--origin` selects the exact browser-visible HTTP or HTTPS
origin. The local default remains loopback with an automatically selected port;
a nonloopback bind requires explicit trusted origin configuration.

If static preview uses another published port, configure both sides explicitly:

```text
--preview-port 4722 --preview-origin http://localhost:4722
```

Publish container port 4722 as `127.0.0.1:4722` for that example. Export still
requires a reviewed publication selection and explicit build. Reading a mounted
Resource does not authorize copying it into the site.

## Origin checks, readiness, and shutdown

The configured origin is exact. Include its externally visible port when it is
nondefault. Do not add a path, credentials, query, fragment, or wildcard. A reverse
proxy preserves that origin's Host header and the browser's matching Origin header.
Forwarding headers do not select another trusted host. API calls still require the
per-launch token, and browser inputs cannot change roots, evaluator modules, or
output destinations.

Startup prints a `Ready:` JSON record with `event: "atlas.ready"`, product version,
origin, repository root, and Atlas selection. It separately prints `Open:` with
the protected launch URL. A supervisor can use that readiness record after the
service starts. There is no unauthenticated repository-health endpoint. Use the
exact launch URL to establish the browser session; service restart issues a new
token.

Send SIGINT or SIGTERM for shutdown. Atlas closes the Editor worker and owned
preview services while preserving durable state. The container supervisor owns
restart policy and signal forwarding. After an unexpected stop, reopen stored
drafts, inspect any uncertain or partial result, and prepare a fresh review before
another apply. Restart does not recreate expired in-memory plans.

## MCP through a running container

Generate host configuration without needing a local `/project` directory:

```sh
atlas connect --container atlas-local --repository-root /project --atlas atlas \
  --state-directory /state/agent --container-command /opt/atlas/bin/atlas \
  --container-runtime /usr/local/bin/node
```

This mode keeps the supplied paths as container paths. It performs no local
project discovery and does not inspect or alter a running container. Review the
name, command, roots, runtime, and durable state before adding the generated
`mcpServers` entry through the host's configuration mechanism. Atlas does not
edit actual agent-host settings.

The generated command has this shape:

```text
docker exec -i --env ATLAS_NODE=/usr/local/bin/node atlas-local \
  /opt/atlas/bin/atlas mcp --repository-root /project --atlas atlas \
  --state-directory /state/agent
```

Use `-i` without a TTY. Docker connects the host's protocol streams directly to
the adapter; stdout remains MCP traffic and diagnostics remain on stderr. The
container must already be running. Docker access and process supervision belong
to the host. MCP needs no published HTTP port.

The agent receives the fixed `/project` grant and exact `atlas` selection.
`/state/agent` stays separate from `/state/editor`. Tool calls cannot widen roots,
load evaluators, fetch network sources, or supply shell commands. Preparation,
authorized application, and explicitly invoked evaluation keep their existing
capability boundaries. A mounted file, source reference, or available tool grants
no publication or write authority.

## Verification boundary

Exercise the exact payload and runtime outside the source checkout. Verify help,
version, browser origin and token checks, explicit creation and application,
restart and recovery, selection and export, readiness and shutdown, and MCP
initialization and tool use. Use paths with spaces and relocate the complete
payload. Container qualification also checks persistent mounts, published ports,
fixed host paths, shared runtime selection, and non-TTY stdio.

The native and payload manifests identify their inputs. Native qualification
cannot establish Linux behavior merely because the launcher uses the same code.
Unexecuted targets and container paths remain untested. Keep original artifact and
runtime identities with each actual observation in the current qualification.
