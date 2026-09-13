# Build and publication behavior

Atlas Portal converts one Atlas publication view into static routes and assets.

```text
Atlas directory + publication profile + portal configuration + Resource roots
  -> Atlas Library opened view with complete validation
  -> publication-profile selection
  -> selected Resource reads through Atlas Library
  -> reader navigation and search derivation
  -> precompiled Astro components and browser assets
  -> static HTML generation
  -> deployable site
```

## Inputs

`atlas export` resolves one project and Atlas. Its required inputs are an exact
publication profile and an explicit absent output destination. Its name defaults
to the Atlas title. The advanced component `dev` or `build` commands name:

- one Atlas directory;
- one publication profile id;
- one portal configuration; and
- zero or more Resource roots.

`build` may also name an output directory. The command resolves every path from the process working directory.

The portal configuration requires a nonempty `name` string and accepts optional `copyright` and `license` strings. Supplied strings are trimmed and must remain nonempty. The component configuration itself has no defaults; `atlas export` supplies the Atlas title when no explicit name or configuration is given. See [Portal configuration](cli.md#portal-configuration) for validation and display behavior. Explicit inputs keep the generated view reproducible and reviewable.

## Complete Atlas validation

Atlas Portal opens the complete Atlas through the public `openAtlas` export
from `atlas-reference-validator`, using specification revision 0.9.0. The
Library assembles local identity headers, `catalog.json`,
`connections.json` and identified Markdown sections. It retains the validation
result and examined local input inventory in one read view.

Generation requires a complete, valid resolved result with normalized output. Atlas Portal creates its own mutable projection copy from that result. It does not parse front matter, reconstruct Point identity, or infer Atlas semantics independently.

Invalid or incomplete input produces no portal build.

## Publication-profile selection

After validation, Atlas Portal locates the requested publication profile and projects its selected reader source units:

- the Atlas record when selected;
- Map records and their authored Areas;
- exact Point records identified by Point id and Map; and
- registered Resources.

Checks participate in complete Atlas validation. They remain authoring policy and are excluded from the reader payload even when the profile selects them. Atlas Portal generates no Check destinations or Check navigation.

Selection does not expand through relationships. A selected Map does not import its Point records. A selected Point record does not import another record of the same Point, a relation target, a Resource, or its containing Map. A selected Resource does not import targets linked from its body.

When a profile selects a Point context without its anchor, Atlas Portal uses the selected context's own Markdown title and preserves only that context. It does not import canonical title, state, relations, or review information from the unselected anchor.

The global JSON files do not become whole publication units. Their entries
follow their logical owners in the assembled model. Resource descriptions
remain with selected Resources, even when the root record is unselected. The
projected root body excludes descriptions of unselected Resources.

Atlas Portal derives routes, navigation, Map overlap, Resource uses, and search
only after applying this selection.

## Local Resource access

The Atlas directory is the first allowed local Resource root. Each `--resource-root` option adds another root.

For every selected local registered Resource, Atlas Portal calls the opened view's public `readSource` operation. Atlas Library:

1. resolves the URI from `atlas.md`;
2. verifies that the target lies inside an allowed root;
3. rejects descendant symbolic links and case or normalization mismatches;
4. verifies the canonical boundary and regular-file target; and
5. reads bounded bytes and detects observed changes during that read.

The Portal requests at most 1,500,000 bytes and classifies the returned content for rendering. Missing targets remain missing Resource destinations. Unrequested, unreadable, stale, or unsupported access produces an unavailable destination.

Additional Resource-root authorization does not publish a file. It permits source loading only for registered Resources selected by the publication profile. The opened view also inventories in-boundary Atlas files; that complete local inventory and captured raw bytes are not projected into the Portal.

Source content is a separate current observation from the retained normalized view. This build does not promise an atomic filesystem snapshot across validation and Resource reads.

## Resource rendering

Atlas Portal renders these text extensions directly when the complete UTF-8 file contains no NUL and is no larger than 1,500,000 bytes:

- Markdown: `.md`;
- plain text: `.txt`;
- style and script text: `.css`, `.js`, `.mjs`, and `.ts`;
- structured text: `.json`, `.yaml`, and `.yml`.

A selected Resource page renders its root-owned description as Markdown. This
explanation remains available when the Resource target is external or cannot
be loaded. Relative links in the description resolve from `atlas.md`.

Markdown target files become formatted document content. Plain text and code
formats appear as source text.

HTTP, HTTPS, and email Resources remain external links. Atlas Portal does not retrieve their content.

Other file types, unsupported text encodings, and larger files receive Resource destinations without an inline reading surface. A truncated source prefix is not presented as a complete document. These bytes are not copied into the generated site.

## Links inside Markdown

Atlas Portal resolves relative Markdown links from the source document’s own path.

Links to selected Atlas records, Maps, Point records, and Resources become portal routes. Fragment and query components remain attached to the rewritten route. Check source links have no reader route.

A local target outside the selected portal remains visible as text but has no working link. This prevents a selected document from creating an accidental route to an unselected repository file.

HTTP and HTTPS links remain navigable and receive `rel="noreferrer"`. Unsupported external schemes do not become browser links.

## Generated destinations

Atlas Portal generates:

- one Atlas landing page;
- one search page;
- one page for each selected Map and its Areas;
- one page for each selected Atlas-wide Point identity; and
- one page for each selected registered Resource.

Point pages group selected records by Map. Area pages use explained memberships to present their Points. Map relationships come from shared selected Points. Resource pages show selected Atlas uses. Point-use metadata retains its Map, record path, and index in the selected Point. Its link targets that record’s existing section. Area and Point uses show their containing Map without importing an unselected Map title. The reader omits redundant internal Markdown path labels while retaining Resource documents and material links.

Search indexes selected Maps, Areas, Points, and Resources. It does not infer new relations from lexical matches.

Each Resource index entry retains the first 120,000 JavaScript string code units of its combined id, title, summary, description Markdown, readable body, and use labels, roles, and notes, joined in that order. This limit applies to the combined entry, not only its body. Text beyond that prefix is absent from search. The Resource reading surface retains the complete available body within the separate 1.5 MB rendering limit. An absent search match does not establish that the full Resource lacks the term.

## Static output

Astro generates complete initial HTML for every route. Ordinary navigation and direct destination URLs do not require a client application runtime.

Small browser scripts compiled from TypeScript provide panel controls, keyboard search focus, URL-backed search terms, search filters, and result rendering. Validation, Point assembly, publication selection, and Resource loading stay out of the browser.

Strict TypeScript checks cover browser source, checked JavaScript modules, and Astro components. Atlas types come from the library's public declarations. The compiler validates the reader payload at its runtime boundary. These checks protect the implementation contract; normative Atlas contracts remain the owners of meaning.

Generated routes assume deployment at the site root. Serve the output directory from `/` on an ordinary static host.

The build also emits `404.html` and copies `public/_headers`. Cloudflare Workers Static Assets uses `404.html` for unmatched requests and interprets `_headers` as response policy. Other static hosts may ignore `_headers` without affecting the generated reader.

The optional [Cloudflare workflow](cloudflare.md) runs this same static build before local Wrangler testing or deployment. It does not create a second rendering pipeline.
