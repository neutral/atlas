# Getting started

Atlas Portal turns one Atlas publication view into a static website. The repository supplies the application, routes, components, styles, search, and responsive behavior.

## Requirements

Atlas Portal requires:

- Node.js 22.23.2 or later;
- pnpm 11.22.0;
- a conforming Atlas for specification revision 0.7.0; and
- a publication profile in that Atlas.

Install Atlas Portal from the repository root:

```text
corepack enable
pnpm --dir tools install --frozen-lockfile
```

## Start an Atlas

Pass the Atlas directory and publication profile explicitly:

```text
pnpm --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public
```

The Atlas directory is automatically available for selected local Resources stored inside it.

Add a Resource root when selected Resources live elsewhere in the project:

```text
pnpm --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project"
```

Repeat `--resource-root` to authorize more than one directory. A Resource root permits reads under that path. It does not add a Resource to the publication profile.

The `dev` command compiles Atlas inputs when it starts. Restart the command after changing an Atlas record, publication profile, or selected Resource.

The default address is `http://127.0.0.1:4321/`.

## Build static output

Generate a site directory:

```text
pnpm --dir tools --filter atlas-portal build -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

Without `--out-dir`, the build writes to `tools/atlas-portal/dist/`.

The generated directory contains complete HTML routes and static assets. Deploy the directory at the root of a static site.

## Preview a build

Serve an existing output directory:

```text
pnpm --dir tools --filter atlas-portal preview -- \
  --dir "/absolute/path/to/site"
```

Without `--dir`, the command serves `tools/atlas-portal/dist/`. Preview does not validate or rebuild the Atlas.

## Use the generated reader

The Navigation Panel groups Maps according to the Atlas navigation record. The current Map expands its Areas. Search and Checks remain available at the bottom of the panel.

The Reader Panel opens every destination directly:

- the Atlas landing page introduces the Atlas and its Map questions;
- a Map page presents its question, summary, content, and Areas;
- an Area page presents its summary and Points;
- a Point page presents selected context grouped by Map;
- a Resource page presents supported document content;
- search presents matching Maps, Areas, Points, and Resources; and
- a Check page presents the authored Check definition.

The Context Panel changes with the current destination. It presents nearby Atlas structure, explained memberships, relations, Resource uses, or Check details.

## Understand failures

Atlas Portal exits with a nonzero status when:

- the Atlas path is missing or invalid;
- validation is incomplete or invalid;
- the publication profile does not exist;
- an authorized Resource root cannot resolve;
- a command or option is unknown; or
- Astro cannot start or complete a build.

Validation failures include the reference validator diagnostic codes and messages. Fix the Atlas source and run the command again.

## Continue to deployment

The generated directory can be served by any static host. For the optional Cloudflare-native workflow, continue to [Deploy to Cloudflare](cloudflare.md).
