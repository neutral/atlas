# Command-line reference

Ordinary use exposes `atlas export` in the single Atlas command namespace:

```text
atlas export [PROJECT] [--atlas PATH] --profile ID --out-dir ABSOLUTE_PATH
  [--name TITLE | --portal-config PATH] [--resource-root PATH]
  [--apply] [--preview] [--port PORT] [--bind IPV4 --origin ORIGIN]
```

Without `--apply`, the command previews the complete publication selection,
Resource availability, routes, and destination. `--apply` creates an absent
output directory; existing destinations are refused. `--preview` requires
`--apply` and serves the completed site. It stops with Ctrl+C. The title defaults
to the Atlas title, and legal footer lines remain unset unless supplied.
`--resource-root` grants local reads without expanding the publication profile.
A nonloopback preview requires an exact public origin with no path prefix.

The Portal source component also provides `dev`, `build`, and `preview`.
Follow [Build from source](../README.md#build-from-source), then run these
commands from the repository root:

```text
pnpm --filter atlas-portal exec node src/cli/index.mjs dev <options>
pnpm --filter atlas-portal exec node src/cli/index.mjs build <options>
pnpm --filter atlas-portal exec node src/cli/index.mjs preview <options>
```

The command surface is:

```text
atlas-portal dev --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--host <host>] [--port <port>]
atlas-portal build --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--out-dir <path>]
atlas-portal preview [--dir <generated-site>] [--host <host>] [--port <port>]
```

## `dev`

`dev` validates an Atlas, applies one publication profile, compiles the portal, and starts the Astro development server. The command runs its installed Astro dependency with the current Node executable. Its foreground process remains attached until shutdown.

Required options:

- `--atlas <path>` identifies the Atlas directory.
- `--profile <id>` identifies one publication profile in that Atlas.
- `--portal-config <path>` supplies the reader name and optional footer lines from a JSON file.

Optional options:

- `--resource-root <path>` authorizes a local root for selected Resources outside the Atlas directory. The option is repeatable.
- `--host <host>` sets the development-server host. The default is `127.0.0.1`.
- `--port <port>` sets the development-server port. Astro uses port `4321` by default when available.

Example:

```text
pnpm --filter atlas-portal exec node src/cli/index.mjs dev \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project" \
  --host 127.0.0.1 \
  --port 4321
```

`dev` checks Atlas records, the selected profile, selected Resources, and portal
configuration every 750 ms. A changed selected corpus restarts the foreground
Astro service. Invalid source revokes the old corpus and exposes a compilation
error until valid source returns. Requests may briefly fail during restart.
This developer refresh is separate from a static exported-site preview.

## `build`

`build` performs the same validation and publication-profile projection as `dev`, then generates static HTML and assets.

Required options:

- `--atlas <path>` identifies the Atlas directory.
- `--profile <id>` identifies one publication profile.
- `--portal-config <path>` supplies the reader name and optional footer lines from a JSON file.

Optional options:

- `--resource-root <path>` authorizes a local root for selected Resources outside the Atlas directory. The option is repeatable.
- `--out-dir <path>` sets the generated site directory.

Example:

```text
pnpm --filter atlas-portal exec node src/cli/index.mjs build \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

Without `--out-dir`, Astro writes to `apps/portal/dist/` in the source checkout.
An explicit output directory keeps generated files separate from source.

## `preview`

`preview` serves an existing static build. It does not read, validate, or compile an Atlas.

Optional options:

- `--dir <generated-site>` identifies the site directory.
- `--host <host>` sets the preview-server host.
- `--port <port>` sets the preview-server port.

Example:

```text
pnpm --filter atlas-portal exec node src/cli/index.mjs preview \
  --dir "/absolute/path/to/site" \
  --host 127.0.0.1 \
  --port 4321
```

Without `--dir`, Astro serves `apps/portal/dist/` in the source checkout.

## Portal configuration

The required `--portal-config` file contains a JSON object:

```json
{
  "name": "Project Atlas",
  "copyright": "© 2026 Project authors",
  "license": "Original project content: CC0-1.0 OR 0BSD."
}
```

| Field | Required | Display |
| --- | --- | --- |
| `name` | Yes | Home heading, navigation brand, root breadcrumb, and page-title suffix. |
| `copyright` | No | Copyright line in the reader footer. |
| `license` | No | License line in the reader footer. |

Each supplied value must be a string that remains nonempty after trimming. Leading and trailing whitespace is removed. Unknown fields are rejected. Omitted footer fields produce no line. Atlas Portal supplies no default values and does not infer them from Atlas metadata, source files, or deployment settings.

Footer strings render as separate escaped text lines. HTML and Markdown are not interpreted. Builders supply the complete wording, including any copyright symbol or license label. The footer is presentation only; it does not change the licenses of Atlas Resources or third-party material.

`preview` serves an existing build and needs no portal configuration.

## Path behavior

Atlas Portal resolves Atlas, portal-configuration, Resource-root, and output paths from the process working directory. Absolute paths make the selected inputs explicit.

The Atlas directory is always an allowed local Resource root. Each `--resource-root` adds another allowed root. Atlas Portal uses the public Library source reader, which checks exact path spelling and containment and rejects symbolic-link traversal. A link does not grant access to its target.

Resource-root authorization and publication selection are separate. Authorization permits access to a local target. The publication profile determines whether the registered Resource enters the generated portal.

## Exit behavior

The command exits with status zero after a successful build or preview session. It exits with a nonzero status for invalid input, invalid portal configuration, failed Atlas validation, an unknown publication profile, an unresolved Resource root, an unknown command or option, or an Astro failure.

An incomplete invocation prints the supported command syntax.

## Cloudflare commands

The optional Cloudflare runner composes the Atlas Portal build with the
workspace's pinned Wrangler 4.125.0. Its `dev` and `deploy` operations require
pnpm 11.22.0 on `PATH`. The frozen workspace installation supplies Wrangler.
Follow [Installed prerequisites](cloudflare.md#installed-prerequisites):

```text
pnpm --filter atlas-portal exec node src/cloudflare/cli.mjs build <options>
pnpm --filter atlas-portal exec node src/cloudflare/cli.mjs dev <options>
pnpm --filter atlas-portal exec node src/cloudflare/cli.mjs deploy <options>
pnpm --filter atlas-portal exec node src/cloudflare/cli.mjs deploy --dry-run <options>
```

All four commands require `--atlas`, `--profile`, and `--portal-config`. They accept a repeatable `--resource-root` option, plus `--config` and `--out-dir`. Cloudflare `dev` also accepts `--host`, `--port`, and `--name`. Deployment accepts `--name` and `--dry-run`.

`--portal-config` selects the reader configuration. `--config` selects the Wrangler configuration. `--name` overrides the Cloudflare Worker name. Worker settings do not supply or override the reader name.

The runner always performs a fresh Atlas Portal build before starting Wrangler or packaging a deployment. Its default configuration is `apps/portal/wrangler.jsonc` in the source checkout, and its default output is `apps/portal/dist/`. Supply an explicit project-owned configuration and output directory that identify the same asset directory.

Cloudflare `dev` runs Wrangler in local mode. The runner disables remote bindings and telemetry by default. Cloudflare `deploy` uses the current Wrangler authentication and uploads the generated assets. Static installed-build qualification does not qualify optional Cloudflare installation, account configuration, or deployment. See [Deploy to Cloudflare](cloudflare.md) for the complete operating boundary.
