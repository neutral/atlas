# Atlas Portal

Atlas Portal turns an Atlas into a complete, navigable website. It accepts an Atlas directory and a publication profile, validates the source, and generates a dense static reader. Projects do not need to design a custom interface or maintain an Astro application.

Documents remain the primary long-form reading surfaces. Atlas Portal connects them to the Maps, Areas, Points, relations, and explanations that establish their project context.

## What Atlas Portal provides

Each generated portal includes:

- direct routes for the Atlas, Maps, Areas, Points, Resources, search, and Checks;
- question-led navigation through Maps and Areas;
- one assembled destination for each selected Atlas-wide Point;
- explained Area memberships and Point relations;
- direct reading surfaces for supported Resources;
- local search across Maps, Areas, Points, and Resources;
- complete initial HTML for every destination; and
- responsive desktop and mobile navigation.

The reader uses three panels:

- The **Navigation Panel** presents the Atlas, Maps, and current Areas.
- The **Reader Panel** presents the current destination or document.
- The **Context Panel** presents relevant Maps, Areas, relations, Resource uses, or Check details.

Desktop layouts show all three panels. Mobile layouts open the Navigation Panel and Context Panel with separate buttons.

## Run Atlas Portal from this repository

Install Atlas Portal from the repository root:

```text
corepack enable
pnpm --dir tools install --frozen-lockfile
```

Start a local portal by naming an Atlas and publication profile:

```text
pnpm --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project"
```

Atlas Portal serves the site at `http://127.0.0.1:4321/` by default.

The Atlas directory is always an allowed Resource root. Add `--resource-root` only when a selected Resource resolves outside that directory. Repeat the option when several roots are required.

## Build a static portal

```text
pnpm --dir tools --filter atlas-portal build -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

The output contains static HTML and assets. It can be served from an ordinary static host without a Node.js application server.

Preview an existing build:

```text
pnpm --dir tools --filter atlas-portal preview -- \
  --dir "/absolute/path/to/site"
```

## Run on Cloudflare

Atlas Portal includes an optional Cloudflare-native path based on Workers Static Assets. It keeps the same static Astro output and does not add a server runtime.

Build and run the Cloudflare configuration through the local Wrangler runtime:

```text
pnpm --dir tools --filter atlas-portal cloudflare:dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project"
```

Wrangler serves the site at `http://127.0.0.1:8787/` by default. Validate a deployment without uploading it:

```text
pnpm --dir tools --filter atlas-portal cloudflare:deploy:dry-run -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --name project-atlas
```

See [Deploy to Cloudflare](docs/cloudflare.md) for deployment, authentication, Custom Domain, caching, security-header, and service guidance.

## Publication behavior

Atlas Portal validates the complete Atlas before generation. It then applies the requested publication profile before deriving routes, navigation, Resource uses, Map overlap, or search data.

The profile remains an exact allowlist. Selecting one source unit does not select related units automatically. Selected local Resources outside the Atlas require an explicit Resource root. Links to available Atlas destinations become portal links. Other local targets remain readable as link text but cannot be opened from the generated portal.

## Documentation

- [Documentation guide](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Command-line reference](docs/cli.md)
- [Build and publication behavior](docs/build-pipeline.md)
- [Reader framework](docs/framework.md)
- [Deploy to Cloudflare](docs/cloudflare.md)
