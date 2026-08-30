# Build and publication behavior

Atlas Portal converts one Atlas publication view into static routes and assets.

```text
Atlas directory + publication profile + Resource roots
  -> complete Atlas validation
  -> publication-profile selection
  -> selected Resource resolution
  -> reader navigation and search derivation
  -> Astro static generation
  -> deployable site
```

## Inputs

Every `dev` or `build` command names:

- one Atlas directory;
- one publication profile id; and
- zero or more Resource roots.

`build` may also name an output directory. The command resolves every path from the process working directory.

Atlas Portal does not choose a default Atlas or profile. Explicit inputs keep the generated view reproducible and reviewable.

## Complete Atlas validation

Atlas Portal validates the complete Atlas with `atlas-reference-validator` and specification revision 0.7.0.

Generation requires a complete, valid resolved result with normalized output. Atlas Portal does not parse front matter, reconstruct Point identity, or infer Atlas semantics independently.

Invalid or incomplete input produces no portal build.

## Publication-profile selection

After validation, Atlas Portal locates the requested publication profile and selects the exact authored source units named by that profile:

- the Atlas record when selected;
- Map records and their authored Areas;
- exact Point records identified by Point id and Map;
- registered Resources; and
- Checks.

Selection does not expand through relationships. A selected Map does not import its Point records. A selected Point record does not import another record of the same Point, a relation target, a Resource, or its containing Map. A selected Resource does not import targets linked from its body.

When a profile selects a Point context without its anchor, Atlas Portal preserves only the selected context. It does not import canonical title, state, relations, or review information from the unselected anchor.

Atlas Portal derives routes, navigation, Map overlap, Resource uses, and search only after applying this selection.

## Local Resource access

The Atlas directory is the first allowed local Resource root. Each `--resource-root` option adds another root.

For every selected registered Resource, Atlas Portal:

1. resolves the local target;
2. resolves symbolic links to the canonical target;
3. verifies that the target remains inside an allowed root;
4. verifies that the target is a regular file; and
5. classifies the Resource for rendering.

Root authorization does not publish a file. It only permits Atlas Portal to read a Resource already selected by the publication profile.

## Resource rendering

Atlas Portal renders these text extensions directly when the file is no larger than 1.5 MB:

- Markdown: `.md`;
- plain text: `.txt`;
- style and script text: `.css`, `.js`, `.mjs`, and `.ts`;
- structured text: `.json`, `.yaml`, and `.yml`.

Markdown becomes formatted document content. Plain text and code formats appear as source text.

HTTP, HTTPS, and email Resources remain external links. Atlas Portal does not retrieve their content.

Other file types and larger files receive Resource destinations without an inline reading surface. Their bytes are not copied into the generated site.

## Links inside Markdown

Atlas Portal resolves relative Markdown links from the source document’s own path.

Links to selected Atlas records, Maps, Point records, Resources, and Checks become portal routes. Fragment and query components remain attached to the rewritten route.

A local target outside the selected portal remains visible as text but has no working link. This prevents a selected document from creating an accidental route to an unselected repository file.

HTTP and HTTPS links remain navigable and receive `rel="noreferrer"`. Unsupported external schemes do not become browser links.

## Generated destinations

Atlas Portal generates:

- one Atlas landing page;
- one search page;
- one Check index;
- one page for each selected Map and its Areas;
- one page for each selected Atlas-wide Point identity;
- one page for each selected registered Resource; and
- one page for each selected Check.

Point pages group selected records by Map. Area pages use explained memberships to present their Points. Map relationships come from shared selected Points. Resource pages show selected Atlas uses.

Search indexes selected Maps, Areas, Points, and Resources. It does not infer new relations from lexical matches.

## Static output

Astro generates complete initial HTML for every route. Ordinary navigation and direct destination URLs do not require a client application runtime.

Small browser scripts provide panel controls, keyboard search focus, URL-backed search terms, search filters, and result rendering. Validation, Point assembly, publication selection, and Resource loading stay out of the browser.

Generated routes assume deployment at the site root. Serve the output directory from `/` on an ordinary static host.

The build also emits `404.html` and copies `public/_headers`. Cloudflare Workers Static Assets uses `404.html` for unmatched requests and interprets `_headers` as response policy. Other static hosts may ignore `_headers` without affecting the generated reader.

The optional [Cloudflare workflow](cloudflare.md) runs this same static build before local Wrangler testing or deployment. It does not create a second rendering pipeline.
