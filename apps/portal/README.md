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

## Export from Atlas

Use Node.js 22.23.2 or a later compatible release and install Atlas with
`npm install --global @neutral/atlas@0.9.0`. Open a project with
`atlas open PROJECT` and choose Export site, or use the corresponding command:

```sh
atlas export /absolute/project --profile public --out-dir /absolute/site
atlas export /absolute/project --profile public --out-dir /absolute/site --apply --preview
```

The first command prints the exact publication selection and destination without
creating output. `--apply` creates the reviewed static site. `--preview` serves
that completed site until Ctrl+C. Existing destinations are refused. The site
name defaults to the Atlas title; `--name` or `--portal-config` supplies an
explicit alternative. Legal footer text has no default.

An Atlas without publication profiles can create a starter from Export site.
The ordinary authoring flow previews its complete profile and diff before
explicit application. The starter lists structural records and excludes
Resources and Checks. Read grants never imply publication selection.

The npm package and [native archive](../../distribution/README.md) contain
precompiled Portal components and browser assets. Export renders selected
content outside the installation. Source components can compile in disposable
storage. The same npm package exposes Library APIs for embedding.

## Build from source

The commands below run the Portal source component directly. Use the repository
checkout with Node.js 22.23.2 or a later compatible release and pnpm 11.22.0.
Install from the repository root:

```sh
pnpm install --frozen-lockfile
```

Run the following commands from that root. Use absolute paths for project inputs
and outputs. The npm application uses `atlas export` for ordinary site export.

## Run Atlas Portal

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
pnpm --filter atlas-portal exec node src/cli/index.mjs dev \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project"
```

Atlas Portal serves the site at `http://127.0.0.1:4321/` by default.

The Atlas directory is always an allowed Resource root. Add `--resource-root` only when a selected Resource resolves outside that directory. Repeat the option when several roots are required.

## Build a static portal

```text
pnpm --filter atlas-portal exec node src/cli/index.mjs build \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

The output contains static HTML and assets. It can be served from an ordinary static host without a Node.js application server.

Preview an existing build:

```text
pnpm --filter atlas-portal exec node src/cli/index.mjs preview \
  --dir "/absolute/path/to/site"
```

## Run on Cloudflare

Atlas Portal includes an optional Cloudflare-native path based on Workers Static Assets. It keeps the same static Astro output and does not add a server runtime. Static generation requires no Wrangler or Cloudflare account. The `dev` and `deploy` Cloudflare helpers require pnpm 11.22.0 on `PATH`.
The frozen source workspace installation supplies Wrangler 4.125.0. Follow the [optional setup](docs/cloudflare.md#installed-prerequisites) before these commands.

Build and run the Cloudflare configuration through the local Wrangler runtime:

```text
pnpm --filter atlas-portal exec node src/cloudflare/cli.mjs dev \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --config "/absolute/path/to/project/wrangler.jsonc" \
  --out-dir "/absolute/path/to/project/dist" \
  --resource-root "/absolute/path/to/project"
```

Wrangler serves the site at `http://127.0.0.1:8787/` by default. Validate a deployment without uploading it:

```text
pnpm --filter atlas-portal exec node src/cloudflare/cli.mjs deploy --dry-run \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --config "/absolute/path/to/project/wrangler.jsonc" \
  --out-dir "/absolute/path/to/project/dist" \
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

The following commands require the source checkout. They are not installed-consumer prerequisites. Install the workspace dependencies from the repository root:

```text
pnpm install --frozen-lockfile
```

Run the Portal checks from that repository root:

```text
pnpm --filter atlas-portal check
pnpm --filter atlas-portal test
```

The Portal uses strict TypeScript checks for its browser code, checked JavaScript modules, and Astro components. Runtime validation checks the compiled reader data before rendering. These checks complement tests for selection boundaries, input handling, and reader behavior.

Before a release, run the checks in the [verification guide](../../docs/verification.md). Review a generated portal in a browser after changing navigation or presentation. Passing this gate establishes the checked build and regression cases; it does not establish universal usability, accessibility conformance, or a successful live deployment.

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
