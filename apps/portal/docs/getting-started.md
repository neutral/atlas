# Getting started

Atlas Portal turns one Atlas publication view into a static website. The installed package supplies the application, routes, components, styles, search, and responsive behavior.

## Export a project

Use Node.js 22.23.2 or a later compatible release. Install Atlas with
`npm install --global @neutral/atlas@0.9.0`, then run `atlas open PROJECT`. Choose
Export site. Select a publication profile and inspect its exact content and
destination. Export reviewed selection creates the site; Open local preview
opens its reader. The package includes prebuilt browser assets.

If no profile exists, Preview a publication profile offers a complete editable
starter. It explicitly lists current Atlas, Maps, and Point records. Resources
and Checks remain unselected. Prepare it, inspect the full diff, and explicitly
apply it before exporting.

The command-line equivalent first previews the selection:

```sh
atlas export /absolute/project --profile public --out-dir /absolute/site
```

Apply it explicitly and start its static preview:

```sh
atlas export /absolute/project --profile public --out-dir /absolute/site --apply --preview
```

Choose an absent destination outside the installation and authored sources.
Existing directories are never replaced. The title defaults to the Atlas title.
`--name` supplies a different title. `--portal-config` supplies a title and
optional explicit legal footer lines. No legal terms are inferred.

Selected Resources within the Atlas are readable by default. A selected Resource
outside it requires `--resource-root /absolute/source/root`. Repeat that option
for additional host-authorized roots. A read grant does not add publication
permission or select a Resource.

Static preview reads the exported files. Source edits require a new export to a
new destination. Stop preview with Ctrl+C. Container preview uses explicit
`--bind`, `--port`, and `--origin` options with a host-configured port mapping or
reverse proxy. The public origin has no path prefix.

The advanced Portal component commands and configuration reference live in the
[command-line guide](cli.md). The developer `dev` command recompiles source
observations and restarts its foreground service when selected content changes.
A compilation failure revokes the current corpus until valid input returns.

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

`atlas export` exits with a nonzero status when:

- the Atlas path is missing or invalid;
- a supplied portal configuration is unreadable, invalid, or lacks a nonempty name;
- validation is incomplete or invalid;
- the publication profile does not exist;
- an authorized Resource root cannot resolve;
- the output destination already exists or overlaps protected files;
- a command or option is unknown; or
- site rendering fails.

The source component's `dev` and `build` commands also require an explicit
portal configuration. They fail when Astro cannot start or complete a build.

Validation failures include diagnostic codes and messages. Fix the Atlas source
and run the command again. Inspect incomplete output after a failed export and
choose a new destination before retrying.

## Continue to deployment

The generated directory can be served by any static host. For the optional Cloudflare-native workflow, continue to [Deploy to Cloudflare](cloudflare.md).
