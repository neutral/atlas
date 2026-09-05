# Getting started

Atlas Portal turns one Atlas publication view into a static website. The repository supplies the application, routes, components, styles, search, and responsive behavior.

## Requirements

Atlas Portal requires:

- Node.js 22.23.2 or later;
- pnpm 11.22.0;
- a conforming Atlas for specification revision 0.8.0;
- a publication profile in that Atlas; and
- a portal configuration with an explicit reader name.

Install Atlas Portal from the repository root:

```text
corepack pnpm@11.22.0 --dir tools install --frozen-lockfile
```

## Start an Atlas

Create `/absolute/path/to/project/portal.json`:

```json
{
  "name": "Project Atlas"
}
```

`name` is required and must be a nonempty string. Use `"Atlas"` when the reader should display only Atlas. Optional `copyright` and `license` strings add plain-text footer lines. Omitted values have no defaults. See [Portal configuration](cli.md#portal-configuration) for an example with both lines.

Pass the Atlas directory, publication profile, and configuration explicitly:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json"
```

The Atlas directory is automatically available for selected local Resources stored inside it.

Add a Resource root when selected Resources live elsewhere in the project:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project"
```

Repeat `--resource-root` to authorize more than one directory. A Resource root permits reads under that path. It does not add a Resource to the publication profile.

The `dev` command compiles Atlas inputs when it starts. Restart the command after changing an Atlas record, publication profile, selected Resource, or portal configuration.

The default address is `http://127.0.0.1:4321/`.

## Build static output

Generate a site directory:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal build -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --portal-config "/absolute/path/to/project/portal.json" \
  --resource-root "/absolute/path/to/project" \
  --out-dir "/absolute/path/to/site"
```

Without `--out-dir`, the build writes to `tools/atlas-portal/dist/`.

The generated directory contains complete HTML routes and static assets. Deploy the directory at the root of a static site.

## Preview a build

Serve an existing output directory:

```text
corepack pnpm@11.22.0 --dir tools --filter atlas-portal preview -- \
  --dir "/absolute/path/to/site"
```

Without `--dir`, the command serves `tools/atlas-portal/dist/`. Preview does not validate or rebuild the Atlas.

## Use the generated reader

The Navigation Panel groups Maps according to the Atlas navigation record. Each Map has a separate Area expansion control. The current Map starts expanded. Search remains available at the bottom of the panel.

The Reader Panel opens every destination directly:

- the Atlas landing page introduces the Atlas through Map titles and authored summaries;
- a Map page presents its title, summary, content, and Areas;
- an Area page presents its title, summary, and complete selected Point list;
- a Point page presents available state and selected context grouped by Map;
- a Resource page presents supported document content; and
- search presents matching Maps, Areas, Points, and Resources.

Related context appears within the reader. Point sections retain memberships and material links; relations follow those sections. Underlying internal Markdown filenames are not repeated. Resource uses follow the document. On mobile, the menu opens navigation while search remains available from the header.

Complete Atlas validation includes Check structure and references. Their definitions do not enter the reader payload or appear as portal destinations.

## Understand failures

Atlas Portal exits with a nonzero status when:

- the Atlas path is missing or invalid;
- the portal configuration is missing, invalid, or lacks a nonempty name;
- validation is incomplete or invalid;
- the publication profile does not exist;
- an authorized Resource root cannot resolve;
- a command or option is unknown; or
- Astro cannot start or complete a build.

Validation failures include the reference validator diagnostic codes and messages. Fix the Atlas source and run the command again.

## Continue to deployment

The generated directory can be served by any static host. For the optional Cloudflare-native workflow, continue to [Deploy to Cloudflare](cloudflare.md).
