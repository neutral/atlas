# Reader framework

Atlas Portal supplies one reusable reading application for any conforming Atlas. A project provides Atlas source and a publication profile. Atlas Portal provides validation, compilation, routes, layout, search, responsive behavior, and static output.

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

## Three-panel reader

The application uses three stable panels.

### Navigation Panel

The Navigation Panel presents the Atlas title, search, authored Map groups, Maps, and the current Map’s Areas. Search and Checks remain available as global destinations.

The panel preserves the Atlas navigation groups when selected Maps remain in those groups. Selected Maps absent from authored groups appear under `Other questions`.

### Reader Panel

The Reader Panel presents the current Atlas destination or Resource. It is the primary reading surface and owns document scrolling.

Each destination has a stable direct URL. Navigation uses ordinary links, so browser history, opening a link in another tab, and copied URLs work without a client router.

### Context Panel

The Context Panel presents information adjacent to the current destination:

- Atlas pages offer Map questions.
- Map pages offer Area questions and related Maps.
- Area pages identify the containing Map and preserve the Area question.
- Point pages present Maps, Areas, and relations.
- Resource pages explain which Atlas records use the Resource.
- Search pages provide type filters and explain the search boundary.
- Check pages present Check metadata and authority boundaries.

The Context Panel supports navigation without competing with the Reader Panel’s primary content.

## Destination behavior

### Atlas

The Atlas page presents the selected Atlas title, summary, introductory body, and Map questions grouped by authored navigation.

### Map

A Map page presents the Map question, summary, introductory body, and Areas. Each Area entry includes its placement question, Point count, and a short Point sample.

The Context Panel presents complete Area-question navigation and related Maps derived from shared selected Points.

### Area

An Area page presents the Area title and summary, followed by `Points in this Area`. Each Point includes the authored explanation for its Area membership.

The Area placement question remains in the Context Panel. This keeps an authoring-routing prompt available without turning it into the main reader headline.

### Point

A Point page presents one Atlas-wide Point destination. Selected Point context appears in sections named by Map. Explained Area memberships remain attached to the relevant Map section.

The page presents Content and Reference material as labeled links. The Context Panel provides Map navigation, Area explanations, and incoming and outgoing relations.

### Resource

A Resource page presents the registered Resource title and summary. Supported text Resources open directly in the Reader Panel.

The Context Panel lists Atlas, Map, Area, or Point records that use the Resource and preserves each Content or Reference role.

### Search

Search matches selected Map, Area, Point, and Resource text. Results retain Atlas types and Map titles. Type filters can narrow the result set without changing the query URL.

Lexical matches do not create Point identity, Area membership, relations, or Map overlap.

### Checks

Checks use a separate `/checks/` surface. The index presents selected Check titles and summaries. A Check page renders its authored Requirement, Verification, Failure, and Exceptions content when present.

Checks remain authoring policy. They do not become Map or Point context and do not claim their own evaluation outcome.

## Desktop and mobile behavior

Desktop layouts show the Navigation Panel, Reader Panel, and Context Panel together. The Context Panel can close to widen the Reader Panel and reopen from a dedicated control.

Mobile layouts keep the Reader Panel on screen. The menu button opens the Navigation Panel. A separate right-side button opens the Context Panel. Each overlay returns focus to its trigger when closed.

The `Escape` key closes an open mobile panel. The `/` shortcut focuses Atlas search when another text field is not active.

## Static and browser behavior

Astro generates complete HTML for every destination. Content, headings, links, and document structure exist before JavaScript runs.

Plain browser JavaScript handles:

- desktop Context Panel state;
- mobile panel overlays and focus return;
- the search keyboard shortcut;
- URL-backed search terms;
- search type filters; and
- local result rendering.

The application does not require React, Vue, or another client application framework.

## Semantic boundary

Atlas Portal preserves authored Atlas meaning. It does not merge Point identities, invent relations, turn lexical matches into semantic edges, import unselected source units, or widen a publication profile.

Presentation can arrange selected information for reading. It cannot change the Atlas model that supplied that information.

## Run the framework

Use the standalone repository commands for local development, static builds, and previews:

- [Getting started](getting-started.md)
- [Command-line reference](cli.md)
- [Build and publication behavior](build-pipeline.md)
