# Reader framework

Atlas Portal supplies one reusable reading application driven by Atlas source, a publication profile, and an explicit portal configuration. Atlas Portal provides validation, compilation, routes, layout, search, responsive behavior, and static output. Successful builds establish behavior for the tested inputs; they do not establish universal corpus coverage or reader benefit.

The project does not need an Astro configuration, route tree, component library, search implementation, or custom reader.

## Application model

Atlas Portal separates Atlas meaning from website generation:

```text
Atlas source
  -> reference validation and normalized Atlas model
  -> publication-profile selection
  -> portal navigation and route data
  -> Astro reader
  -> static site
```

The validator owns Atlas parsing and semantic constraints. The portal compiler owns publication selection and reader derivation. Astro owns routes, HTML, styles, assets, development serving, and static generation.

Astro components receive compiled data. They do not scan the Atlas filesystem or infer Atlas semantics from paths and prose.

The required portal configuration supplies the reader name. Its `name` appears in navigation, the home heading, breadcrumbs, and page titles. The authored Atlas title remains source metadata. It is not a fallback brand.

Optional `copyright` and `license` strings appear as separate plain-text lines in the reader footer. Builders supply the complete wording. Omitted lines stay absent. This presentation does not change source terms or Resource licenses. The [configuration contract](cli.md#portal-configuration) defines accepted values.

## Explorer layout

The desktop explorer has a Navigation Panel and one Reader Panel. A white reading surface keeps the authored material central. Related information appears within the reader at the relevant destination.

The Navigation Panel keeps the Atlas home, search, and footer available while its grouped Maps scroll. Each Map links directly to its page. A separate control expands its Areas. The current Map starts expanded. Selected Maps absent from authored groups appear under `Other Maps`.

The Reader Panel owns document scrolling. Breadcrumbs identify the current destination type and containing Map where applicable. Every destination has a stable direct URL. Ordinary links preserve browser history, opening in another tab, and copied URLs.

## Destination behavior

### Atlas

The overview presents the configured reader name, authored Atlas summary, selected counts, and Maps grouped by authored navigation. Rows pair each Map title and authored summary with Area and Point counts. Atlas Portal omits the root Atlas body and its About section from every generated overview.

### Map

A Map page presents its title, authored summary, and Areas. Each Area includes its authored summary, selected Point count, and a short Point sample. Its link opens the complete membership list. The complete Map body remains available under `About this Map`.

Related Maps appear below the main content. Their counts reflect shared selected Points.

### Area

An Area page presents its title, authored summary, and complete selected Point membership list. Each Point retains the authored explanation for its membership. The navigation marks the current Area.

### Point

A Point page presents one Atlas-wide destination with available authored posture and lifecycle. Point identity remains in the URL and source. Selected records appear in sections named by Map. A section index links to each section when more than one record is selected and to any relations.

Explained Area memberships and labeled Content and Reference links remain with their records. The reader does not repeat each record's underlying Markdown filename. Incoming and outgoing relations follow the record sections. Canonical fields remain absent when the publication omits the anchor.

### Resource

A Resource page presents its registered title, summary, and identity. Supported text opens directly in the Reader Panel without repeating its local filename. All selected Atlas, Map, Area, and Point uses follow the document with their Content or Reference roles. A header link jumps to these uses when present. Point and Area uses identify their containing Map in visible context and accessible link names. Point uses link directly to the selected record section.

### Search

Search matches selected Map, Area, Point, and Resource text. Long Resource text can exceed the indexed excerpt; an absent match does not establish absence from the document. Type filters remain beside the search field at every viewport size. Results retain Atlas types and Map titles. Typing updates the query URL; filters remain local to the current page.

Map and Area results display authored summaries. Their organizing questions remain searchable.

Search reports the full result count. It initially displays up to 60 results. `Show more results` adds the next group and focuses its first result. Empty queries, unmatched terms, and an empty type selection have distinct guidance. Status changes use a live region.

Lexical matches do not create identity, Area membership, relations, or Map overlap.

## Reader help

The question-mark button opens a quick reference from every destination. It sits at the top right on desktop and beside search in the mobile header. Help introduces navigation and search, defines the Atlas terms used by the reader, and explains Point posture and lifecycle. It distinguishes an assertion from verification and an intended state from implementation.

Help uses a native modal dialog. Opening it moves focus to its close button and makes the page behind it inactive. Tab reaches the help text for keyboard scrolling. The close button, backdrop, and Escape dismiss it and return focus to the opening button, or the visible help button after a layout change. Opening help preserves the current destination and reading position.

## Responsive and keyboard behavior

Desktop and tablet widths show the Navigation Panel beside the Reader Panel. At 760 pixels or narrower, a compact header offers navigation, search, and help. The navigation button opens a drawer. The background and hidden drawer cannot receive keyboard focus. Tab and Shift+Tab remain inside an open drawer. Closing it with its button, backdrop, or Escape returns focus to the navigation button.

The `/` shortcut focuses search when help is closed and no text field is active. On a mobile destination without a reader search field, it opens the drawer before focusing search. Resizing clears the drawer state and restores access to the appropriate layout. Reduced-motion preferences disable panel transitions and smooth scrolling.

## Static and browser behavior

Astro generates complete HTML for every destination. Content, headings, links, authored body disclosures, and document structure exist before JavaScript runs. Search requires JavaScript and exposes that requirement when scripts are disabled.

Markdown headings retain source-document section links. Heading slugs follow GitHub conventions, including duplicate headings and inline formatting. The reader prefixes their IDs to separate authored headings from portal controls and other Point records. Local document and section links use the matching prefix. A source title omitted from visible prose retains its fragment target.

TypeScript browser modules handle Area expansion, the mobile drawer, reader help, keyboard focus, query URLs, type filters, and search results. Astro emits browser JavaScript from those modules. The application does not require React, Vue, or another client application framework.

## Semantic boundary

Atlas Portal preserves authored Atlas meaning. It does not merge Point identities, invent relations, import unselected source units, or widen a publication profile. Presentation can arrange selected information for reading. It cannot change the model that supplied that information.

Reader introductions use existing authored summaries. Organizing and placement questions remain in Atlas source. The build does not rewrite questions or generate descriptive claims. Atlas maintenance owns summary wording. Publication profiles own selection.

Checks remain part of complete Atlas validation. Their definitions are excluded from the compiled reader payload, routes, navigation, and search. Authoring policy does not become a separate reader destination.

## Run the framework

- [Getting started](getting-started.md)
- [Command-line reference](cli.md)
- [Build and publication behavior](build-pipeline.md)
