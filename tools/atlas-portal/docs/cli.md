# Command-line reference

Atlas Portal provides three commands: `dev`, `build`, and `preview`.

Run these commands from the repository root:

```text
pnpm --dir tools --filter atlas-portal dev -- <options>
pnpm --dir tools --filter atlas-portal build -- <options>
pnpm --dir tools --filter atlas-portal preview -- <options>
```

The command surface is:

```text
atlas-portal dev --atlas <path> --profile <id> [--resource-root <path>] [--host <host>] [--port <port>]
atlas-portal build --atlas <path> --profile <id> [--resource-root <path>] [--out-dir <path>]
atlas-portal preview [--dir <generated-site>] [--host <host>] [--port <port>]
```

## `dev`

`dev` validates an Atlas, applies one publication profile, compiles the portal, and starts the Astro development server.

Required options:

- `--atlas <path>` identifies the Atlas directory.
- `--profile <id>` identifies one publication profile in that Atlas.

Optional options:

- `--resource-root <path>` authorizes a local root for selected Resources outside the Atlas directory. The option is repeatable.
- `--host <host>` sets the development-server host. The default is `127.0.0.1`.
- `--port <port>` sets the development-server port. Astro uses port `4321` by default when available.

Example:

```text
pnpm --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --host 127.0.0.1 \
  --port 4321
```

`dev` compiles Atlas inputs once at startup. Restart it after changing an Atlas record, publication profile, or selected Resource.

## `build`

`build` performs the same validation and publication-profile projection as `dev`, then generates static HTML and assets.

Required options:

- `--atlas <path>` identifies the Atlas directory.
- `--profile <id>` identifies one publication profile.

Optional options:

- `--resource-root <path>` authorizes a local root for selected Resources outside the Atlas directory. The option is repeatable.
- `--out-dir <path>` sets the generated site directory.

Example:

```text
pnpm --dir tools --filter atlas-portal build -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

Without `--out-dir`, Astro writes to `tools/atlas-portal/dist/`.

## `preview`

`preview` serves an existing static build. It does not read, validate, or compile an Atlas.

Optional options:

- `--dir <generated-site>` identifies the site directory.
- `--host <host>` sets the preview-server host.
- `--port <port>` sets the preview-server port.

Example:

```text
pnpm --dir tools --filter atlas-portal preview -- \
  --dir "/absolute/path/to/site" \
  --host 127.0.0.1 \
  --port 4321
```

Without `--dir`, Astro serves `tools/atlas-portal/dist/`.

## Path behavior

Atlas Portal resolves Atlas, Resource-root, and output paths from the process working directory. Absolute paths make the selected inputs explicit.

The Atlas directory is always an allowed local Resource root. Each `--resource-root` adds another allowed root. Atlas Portal resolves symbolic links before checking whether a selected Resource remains inside an allowed root.

Resource-root authorization and publication selection are separate. Authorization permits access to a local target. The publication profile determines whether the registered Resource enters the generated portal.

## Exit behavior

The command exits with status zero after a successful build or preview session. It exits with a nonzero status for invalid input, failed Atlas validation, an unknown publication profile, an unresolved Resource root, an unknown command or option, or an Astro failure.

An incomplete invocation prints the supported command syntax.

## Cloudflare commands

The optional Cloudflare runner composes the normal Atlas Portal build with a local Wrangler installation:

```text
pnpm --dir tools --filter atlas-portal cloudflare:build -- <options>
pnpm --dir tools --filter atlas-portal cloudflare:dev -- <options>
pnpm --dir tools --filter atlas-portal cloudflare:deploy -- <options>
pnpm --dir tools --filter atlas-portal cloudflare:deploy:dry-run -- <options>
```

All four commands require `--atlas` and `--profile`. They accept repeatable `--resource-root`, `--config`, and `--out-dir` options. `cloudflare:dev` also accepts `--host`, `--port`, and `--name`. Deployment accepts `--name`; the dry-run script adds `--dry-run`.

The runner always performs a fresh Atlas Portal build before starting Wrangler or packaging a deployment. Its default configuration is `tools/atlas-portal/wrangler.jsonc`, and its default output is `tools/atlas-portal/dist/`. A custom configuration and output directory must identify the same asset directory.

`cloudflare:dev` runs Wrangler in local mode. It does not contact Cloudflare. `cloudflare:deploy` uses the current Wrangler authentication and uploads the generated assets. See [Deploy to Cloudflare](cloudflare.md) for the complete operating boundary.
