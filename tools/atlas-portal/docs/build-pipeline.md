# Build and publication behavior

Atlas Portal converts one Atlas publication view into static routes and assets.

```text
Atlas directory + publication profile + portal configuration + Resource roots
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
- one publication profile id;
- one portal configuration; and
- zero or more Resource roots.

`build` may also name an output directory. The command resolves every path from the process working directory.

The portal configuration requires a nonempty `name` string and accepts optional `copyright` and `license` strings. Supplied strings are trimmed and must remain nonempty. No fields have defaults. See [Portal configuration](cli.md#portal-configuration) for validation and display behavior. Explicit inputs keep the generated view reproducible and reviewable.

## Complete Atlas validation

Atlas Portal validates the complete Atlas with `atlas-reference-validator` and specification revision 0.8.0.

Generation requires a complete, valid resolved result with normalized output. Atlas Portal does not parse front matter, reconstruct Point identity, or infer Atlas semantics independently.

Invalid or incomplete input produces no portal build.

## Publication-profile selection

After validation, Atlas Portal locates the requested publication profile and projects its selected reader source units:

- the Atlas record when selected;
- Map records and their authored Areas;
- exact Point records identified by Point id and Map; and
- registered Resources.

Checks participate in complete Atlas validation. They remain authoring policy and are excluded from the reader payload even when the profile selects them. Atlas Portal generates no Check destinations or Check navigation.

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

Each Resource index entry retains the first 120,000 JavaScript string code units of its combined id, title, summary, readable body, and use labels, roles, and notes, joined in that order. This limit applies to the combined entry, not only its body. Text beyond that prefix is absent from search. The Resource reading surface retains the complete available body within the separate 1.5 MB rendering limit. An absent search match does not establish that the full Resource lacks the term.

## Static output

Astro generates complete initial HTML for every route. Ordinary navigation and direct destination URLs do not require a client application runtime.

Small browser scripts compiled from TypeScript provide panel controls, keyboard search focus, URL-backed search terms, search filters, and result rendering. Validation, Point assembly, publication selection, and Resource loading stay out of the browser.

Strict TypeScript checks cover browser source, checked JavaScript modules, and Astro components. The compiler validates the reader payload at its runtime boundary. These checks protect the implementation contract; the Atlas reference validator remains the owner of Atlas meaning.

Generated routes assume deployment at the site root. Serve the output directory from `/` on an ordinary static host.

The build also emits `404.html` and copies `public/_headers`. Cloudflare Workers Static Assets uses `404.html` for unmatched requests and interprets `_headers` as response policy. Other static hosts may ignore `_headers` without affecting the generated reader.

The optional [Cloudflare workflow](cloudflare.md) runs this same static build before local Wrangler testing or deployment. It does not create a second rendering pipeline.
