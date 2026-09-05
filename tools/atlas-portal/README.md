# Atlas Portal

Atlas Portal generates a dense static reader from an Atlas directory, a publication profile, and an explicit portal configuration. It validates the source before generation. Projects can use the supplied interface without maintaining an Astro application.

Documents remain the primary long-form reading surfaces. Atlas Portal connects them to the Maps, Areas, Points, relations, and explanations that establish their project context.

## What Atlas Portal provides

Each generated portal includes:

- direct routes for the Atlas, Maps, Areas, Points, Resources, and search;
- navigation through Map and Area titles and authored summaries;
- one assembled destination for each selected Atlas-wide Point;
- explained Area memberships and Point relations;
- direct reading surfaces for supported Resources;
- local search across Maps, Areas, Points, and Resources;
- a reader help dialog with navigation guidance, Atlas terms, and Point state definitions;
- complete initial HTML for every destination; and
- responsive desktop and mobile navigation.

The explorer uses a compact Navigation Panel and one wide Reader Panel. The navigation groups Maps and expands their Areas. The reader presents complete selected memberships, exact Point identities, sources, and related context alongside the material they explain.

Desktop and tablet layouts show both columns. Mobile layouts keep the reader on screen and open navigation in a keyboard-accessible drawer. Search filters remain beside the search field at every width.

The question-mark button opens a quick reference without leaving the current page. It sits at the top right on desktop and beside search on mobile. Help explains how Maps, Areas, Points, relations, and sources connect, and how to interpret posture and lifecycle.

## Run Atlas Portal from this repository

Install Atlas Portal from the repository root:

```text
corepack pnpm@11.22.0 --dir tools install --frozen-lockfile
```

Create a portal configuration outside the authored Atlas, such as `/absolute/path/to/project/portal.json`:

```json
{
  "name": "Atlas",
  "copyright": "© 2026 Project authors",
  "license": "Original project content: CC0-1.0 OR 0BSD."
}
```

`name` is required. It supplies the home heading, navigation brand, breadcrumbs, and page-title suffix. Optional `copyright` and `license` strings appear as separate plain-text lines in the reader footer. Omit either field to omit its line. All supplied strings must be nonempty after trimming. Unknown fields are rejected.

Atlas Portal supplies no default name or legal text. The footer displays builder-supplied wording; it does not change Resource licenses or infer terms from source metadata. See [Portal configuration](docs/cli.md#portal-configuration) for the complete contract.

Start a local portal with all three inputs:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project"
```

Atlas Portal serves the site at `http://127.0.0.1:4321/` by default.

The Atlas directory is always an allowed Resource root. Add `--resource-root` only when a selected Resource resolves outside that directory. Repeat the option when several roots are required.

## Build a static portal

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal build -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

The output contains static HTML and assets. It can be served from an ordinary static host without a Node.js application server.

Preview an existing build:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal preview -- \
  --dir "/absolute/path/to/site"
```

## Run on Cloudflare

Atlas Portal includes an optional Cloudflare-native path based on Workers Static Assets. It keeps the same static Astro output and does not add a server runtime.

Build and run the Cloudflare configuration through the local Wrangler runtime:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal cloudflare:dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project"
```

Wrangler serves the site at `http://127.0.0.1:8787/` by default. Validate a deployment without uploading it:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal cloudflare:deploy:dry-run -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project" \
  --name project-atlas
```

See [Deploy to Cloudflare](docs/cloudflare.md) for deployment, authentication, Custom Domain, caching, security-header, and service guidance.

`--portal-config` sets the reader name and optional footer lines. Cloudflare `--config` selects a Wrangler file, and `--name` sets the Worker name. These options have separate responsibilities.

## Publication behavior

Atlas Portal validates the complete Atlas before generation. It then applies the requested publication profile before deriving routes, navigation, Resource uses, Map overlap, or search data.

The profile remains an exact allowlist. Selecting one source unit does not select related units automatically. Selected local Resources outside the Atlas require an explicit Resource root. Links to available Atlas destinations become portal links. Other local targets remain readable as link text but cannot be opened from the generated portal.

Checks remain authoring policy. Complete Atlas validation includes their structure and references. Atlas Portal excludes their definitions from its payload, destinations, navigation, and search. Point records and internal Resource documents remain readable without repeating their underlying Markdown filenames.

## Develop and verify

Run the Portal checks from the repository root:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal check
corepack pnpm@11.22.0 --dir tools --filter atlas-portal test
```

The Portal uses strict TypeScript checks for its browser code, checked JavaScript modules, and Astro components. Runtime validation checks the compiled reader data before rendering. These checks complement tests for selection boundaries, input handling, and reader behavior.

Before a release, run `corepack pnpm@11.22.0 --dir tools test` and `corepack pnpm@11.22.0 --dir tools audit:dependencies`. Build the intended publication view and exercise the Cloudflare dry run when using that deployment path. Review a generated portal in a browser after changing navigation or presentation. Passing this gate establishes the checked build and regression cases; it does not establish universal usability, accessibility conformance, or a successful live deployment.

## License and source

Atlas Portal is available under `CC0-1.0 OR 0BSD`. The release includes both license texts. Third-party dependencies retain their own licenses. Generated Atlas content retains its source terms.

The [reader framework](docs/framework.md) identifies implementation responsibilities. The [Cloudflare guide](docs/cloudflare.md#official-cloudflare-references) links the platform documentation for deployment behavior. Local build evidence describes the tested source and output; platform documentation does not establish that a specific Atlas deployment succeeded.

## Documentation

- [Documentation guide](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Command-line reference](docs/cli.md)
- [Build and publication behavior](docs/build-pipeline.md)
- [Reader framework](docs/framework.md)
- [Deploy to Cloudflare](docs/cloudflare.md)
