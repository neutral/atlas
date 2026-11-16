# Portal

The Portal is where an Atlas is read. It turns an Atlas into pages: one for home,
one for each Point and one for each Facet. Every page is
complete as it is served, so a person without a script and an agent that fetches
an address read the same thing. The same pages are served from a local service
and written as files by an export; the local service also shows each cited local
source it may read on a page of its own. The Portal only reads: it never writes
an authored file.

## What a reader meets

Two patterns hold on every page.

- **Go.** An underlined name is a link to the page of what it names: a link in
  the prose, the title of an opened thing, "Next", and every name on home, in
  Outline, in search results and on the page of a proposed change; on the
  local service, the name of a source it shows, a link in prose to a file the
  Atlas cites and the service shows, and every Point and Facet under "Cited by"
  on that source's page.
- **Open.** A name with `▸` stands in a margin. It is a link too, and with the
  script it opens what it names here instead: as a panel in the main column,
  under the Point whose margin named it, with its own margin and its own
  "Close". One thing is open per margin. Panels nest, and the address's
  fragment names the chain of what is open.

The only bordered controls are "Outline", "?" (Help), "Close" and the search
field.

The Portal names records as the specification does: an Atlas holds Trees, a
Tree is an outline of Points, and a Facet reads a Point through another Tree.
"?" at the right end of the strip opens Help, which explains those words, how
to move around and the marks; it is also a page, `/_/help/`, which "?" leads to
without the script.

A Point's page holds, in the main column, its kind ("Point", or its Type and
standing: "Decision · selected", "Observation · 3 November 2026"), its title,
its prose as written, its uncertainty, the sources it rests on behind a native
disclosure, and the next Point in reading order: at the end of a Tree, the top
Point of the next Tree held, under "Next, in" and that Tree's title; none at
the end of the last. Its margin is the map of where it stands: the Tree's
outline around it, the Facets said of it ("Facets seen from Model"), the
Points its prose refers to and what refers to it. A source that no longer
matches its stamp is marked "changed since this was checked"; one whose file is
not there, or whose fragment names no heading in it, "missing"; both in red. A
stamp that could not be checked against its source where the page is served
(the source lies outside the source roots granted, or could not be read) is said
in blue, "not checked here", so that it is not taken for one that was checked,
and it is said once: when some of a page's stamps were checked and some were
not, each unchecked source is marked and the closed line counts them ("7 sources · 2 not checked here"); when none could be, no source is marked and
the closed line says it alone ("7 sources · not checked here"). An
unstamped source carries no such mark. How a source stands is what the Library's
stale report says of it.

On the local service, each cited local source within its grants is a link to a
page of its own, at `/_/source/?uri=` followed by the source URI as cited,
percent-encoded, and the cited fragment as the page's fragment. The page has the
strip, the file's path as its title, and the file as it is now, read through the
Library within the grants: a Markdown file rendered as prose is (authored HTML
shown and never run, a record's JSON header left out), each heading carrying the
name the Library gives it as its ID, so that a cited section is where the reader
lands; any other text as it is; or a sentence that says the file is not there,
is not text, is too large (over 2 MiB) or could not be read. Its margin lists
the Points and Facets that cite the file, by any of its sections, under their
Trees, each a name that goes to its page. A file no Point or Facet of the
Atlas as it is cites, a file outside the grants or in Atlas's own state, and a
remote address have no page (404), and such a source line is not a link; under
a proposed change, a source only the change cites is not a link until the
change is applied. A link in the prose of the Atlas as it is to a file the
Atlas cites and the service shows leads to that file's page too, landing on the
section the link names; on the page of a proposed change it is plain words. An
export keeps its source lines and such links as they were: links to the source
base when one is given, otherwise plain.

Home lists the Trees, each with its top Point, its scope and its outline ("26
Points"). "Outline" lays the same outlines over any page, with the
reader's place marked. The search field ranks the Points and the Facets, each
of which has a page, with the Library's own search, and lists at most 12. Each
result shows its Tree and its kind, as its panel does: "Model · Point", "Model ·
Decision · selected", "Model · Observation · 3 November 2026", or for a Facet
"Product · Facet, seen from Model", as its page says; then its title and, under it,
the Library's excerpt of its text around the first match. When more match than
are listed, the list ends with "12 of 40 shown", with the real numbers; the
line is neither a result nor a link.

On the local service, home also lists the proposed changes that are saved for
the Atlas, each by its reason, with how many Points differ and when it was
prepared ("4 Points differ · prepared 14 November 2026 at 17:59"). One that
cannot be applied as it stands says so first, in red, with the word its page
uses: "Invalid" when what it proposes does not validate or the Library refuses
the change itself; else "Blocked" while the Library applies no draft of the
Atlas, as its apply gate decides (`applyBlocker`), or when that cannot be
told; else "Stale" when the Atlas has changed since it was prepared ("Stale ·
4 Points differ · prepared …"). One prepared where there was no Atlas says "a
new Atlas" in place of the count. Each has a page that states its reason,
whether it can be applied, what differs, what else to read and the command
that applies it. Whether it can be applied reads "Ready to apply", or in red
"Invalid: it cannot be applied as it stands", "Stale: the Atlas has changed
since this was prepared", or "Blocked:" with what blocks it:

- an interrupted apply that recovery rolls back: "Blocked: an interrupted apply
  needs recovery first", and under "To recover", in place of the command that
  applies it, the command that lists what to recover, `atlas --root …
  recover`;
- an Atlas that does not read whole: "Blocked: the Atlas does not read whole";
- anything else, such as a journal that cannot be read, a folder of journals
  that cannot be listed, or a blocker the Library cannot tell: "Blocked: "
  followed by the Library's words.

Only the first names a command. What differs
names every file the change writes. It opens with "This Atlas" when the change
alters the Atlas itself: "its title" and "its ID", each as proposed with what it
was, "which Trees it holds", and "the order of its Trees", with the
Trees in their order as proposed. It is then told by Tree: the Points and
the Facets that are new, changed or removed, and for a Tree itself whether
"its title", "its scope" or "its outline" differs. What else to read is "Points
above what differs" and "Other Trees' Facets that draw on what differs". A
change to the Style is named after the Trees, and each Check that differs
under "What this Atlas is held to" with its title, how it binds and its text as
proposed, and under them one "Before" holding whichever of those differed, a
removed one struck through. A file the change rewrites while nothing in it reads
differently is named with "its file only". When the Atlas as proposed does not
validate, "Files" names each file it writes by its path. A change that creates
the Atlas is told with everything in it new. A change prepared against an Atlas
that does not validate is told the same way, from what that Atlas's files held
as far as they can be read: the page says so, a Point that differs shows no
"Before", and a Point or Tree it removes is named under "Files" by its file
and its title. When the Atlas as proposed validates, under that page the whole
Atlas reads as proposed, with what differs marked in red and named: "new", "changed",
"removed", and "Before" for what a changed part said earlier. A Point, Facet or
source that differs only in the stamps of its sources says what it said: it is
marked "stamped" in blue, is not counted among the Points that differ and sends
the reader to nothing else, and a change that only stamps says so on home and on
its page ("only stamps: N Points and M Facets stamped, nothing they say
differs"; beside other differences, "N Points differ · M Points stamped"). A proposed change
that cannot be read is not listed: under the list, in red, home gives each one a
line of its own, by its file in the store of drafts and in the Library's words
("✗ A proposed change could not be read: notes.json: Invalid draft."), so one
that cannot be read hides no other; its page says it could not be read (500).
When the store of drafts as a whole cannot be read, home says so once, in the
Library's words, without a file. An applied change is not listed: applying it removes it. When the service reads
drafts from a state home other than the user's own (`ATLAS_STATE_HOME`, which
`atlas open --state-home` sets), the commands a page prints name it with
`--state-home`.

An Atlas that does not validate shows its diagnostics instead of pages. A folder
with no Atlas shows the command that prepares one, `atlas init`, and lists the
proposed changes saved for that folder, so the Atlas the command prepares can be
read before it is applied.

## Addresses

Every link between the Portal's own pages and files is relative, so an export
works under any path. A link out of the Atlas is absolute: an HTTP(S) address an
author wrote, and, when an export is given a source base, each local source and
each link to a local file, which lead there.

| Address | Holds |
| --- | --- |
| `/` | home |
| `/<point-id>/` | one Point |
| `/_/facet/<tree>/<facet>/` | one Facet |
| `/_/help/` | Help: the words, how to move around and the marks (also where there is no Atlas) |
| `/_/sheet.css`, `/_/reader.js`, `/_/search.js`, `/_/search.json` | the stylesheet, the script, the Library's search module, and what it ranks |
| `/_/source/?uri=<uri>` | a local source the Atlas cites, within the grants (local service only) |
| `/_/draft/<id>/` | a proposed change (local service only) |
| `/_/draft/<id>/<point-id>/`, `/_/draft/<id>/_/facet/<tree>/<facet>/`, `/_/draft/<id>/_/style/` | a Point, a Facet or the Style as proposed (local service only) |

A fragment names what is opened under the page, outermost first, separated by
`/`: a Point by its ID, a Facet as `<tree>:<facet>`. On a source's page it
names a heading of the file.

## Serve

```js
import { startPortal } from './src/server.mjs';

const portal = await startPortal('/path/to/atlas', { port: 4321 });
console.log(portal.url); // http://127.0.0.1:4321/
await portal.close();
```

`startPortal(root, { port, allowedRoots, timeZone })` returns `{ server, url, close }`.
Any other option is refused.

- `port`: the port to listen on. The default, `0`, takes a free one.
- `allowedRoots`: at most 99 absolute directories that cited local sources may
  be read from, besides the Atlas root. A source outside them is listed, never
  read, and has no page.
- `timeZone`: the zone in which the moment a proposed change was prepared is
  written. The default is this machine's.

The service listens on `127.0.0.1` only. It answers `GET` and `HEAD` and refuses
every other method with 405. It refuses with 403 a request whose `Host` is not
`127.0.0.1`, `localhost` or `[::1]` with the listening port, or whose `Origin`
is another site's, so a page elsewhere cannot reach it by name. Every answer
carries a Content Security Policy that allows the Portal's own stylesheet and
script, and requests from the reader's script to the Portal's own origin
(`connect-src 'self'`: the pages a panel opens and the search index), and
nothing else; it is not stored.

A page reflects the files on disk at the time of the request. A reading of the
Atlas is kept between requests only while every file and folder that holds its
records has the size, times and identity it had, and only once the newest of
them is two seconds old; otherwise the Atlas is read again. How a cited source
stands is read each time its page is asked for.

## Export

```js
import { exportPortal } from './src/export.mjs';

await exportPortal('/path/to/atlas', '/path/to/site', {
  all: true,
  sourceBase: 'https://example.org/project/tree/main/atlas/',
});
```

`exportPortal(root, out, { trees, all, sourceBase, allowedRoots })` writes
the pages as `index.html` files (the help page among them), the assets under `_/`, and the marker
`_/export.json`. Serve the folder over HTTP.

- `trees` or `all`: the IDs of the Trees to export, or `all: true`. One of the
  two is required. An export holds nothing of a Tree that was not chosen: a
  link to one of its records is plain text followed by "not in this
  publication", and a Facet through it says "a Tree not in this publication" in
  place of the Tree's name.
- `sourceBase`: the URL at which the Atlas root can be browsed. Local sources,
  and links in the prose to local files, then lead there.
- `allowedRoots`: as for the service. Sources are read once, when the export is
  made.

`out` must not exist, or must hold the marker of a previous export. Then every
file that export wrote is removed and the new ones take their place; a file the
export did not write is left, and the export is refused if one stands where a
page would go. An export is also refused when `out` is inside the Atlas, holds
it, is inside Atlas's private state or overlaps the application. What the
application is, is told by what the folder that holds the Portal's `apps/`
contains, not by the package's name. A source checkout keeps
`pnpm-workspace.yaml` there, which an installed package does not ship: its
application is its code, `apps/` and `library/`, so an export into a
checkout's other folders, such as its ignored `tmp/` or `.local/`, is written.
An installed package, whatever it is called, is the application as a whole,
and so is the bundle around it when it runs from one. It returns
`{ format, atlas, identity, trees, sourceBase, status, output, points, facets, replaced }`.

| Refusal | Code |
| --- | --- |
| an option the export does not have, a grant that is not an absolute directory, or more than 99 grants | `INVALID_REQUEST` |
| no selection, or both `trees` and `all` | `SELECTION_REQUIRED` |
| a Tree the Atlas does not have | `SELECTION_UNKNOWN` |
| a source base that is not an HTTP(S) URL without credentials | `INVALID_SOURCE_BASE` |
| `out` overlaps the Atlas, the private state or the application | `EXPORT_OVERLAP` |
| `out` exists and is not a previous export | `EXPORT_EXISTS` |
| removing the previous export's files or moving the new pages into `out` was interrupted, so `out` may already have changed (the message names `out` to inspect) | `EXPORT_PARTIAL` |
| a file the previous export did not write stands in the way | `EXPORT_CONFLICT` |
| no Atlas, or one that does not validate (`diagnostics` on the error) | `INVALID_ATLAS` |

Proposed changes are never exported, no source file is copied, and an export
holds no page of a source.

## How it is built

There is no framework and no build step. The modules are plain ES modules; the
stylesheet and the script are served as written. The one dependency is
`markdown-it`.

| File | Holds |
| --- | --- |
| [`src/model.mjs`](src/model.mjs) | The Portal's own model of an Atlas, made from the Library's view, and a cited source as its page shows it. The only module that reads the view or a source. |
| [`src/drafts.mjs`](src/drafts.mjs) | A proposed change: what differs, and each Point and Facet as proposed. The only module that reads drafts. |
| [`src/markdown.mjs`](src/markdown.mjs) | Authored Markdown as HTML. Authored HTML is shown and never run; an image is named and never loaded. |
| [`src/pages.mjs`](src/pages.mjs) | Each page as a function from the model to HTML. |
| [`src/server.mjs`](src/server.mjs) | `startPortal`. |
| [`src/export.mjs`](src/export.mjs) | `exportPortal`. |
| [`assets/sheet.css`](assets/sheet.css) | The sheet: white paper, ink for what an author wrote, blue for what Atlas says, red for a difference the reader must attend to. |
| [`assets/reader.js`](assets/reader.js) | Panels, Outline, Help and search. It stays under 6 KB gzipped. |

## Tests

From the repository root:

```sh
node --import ./tests/support/state-env.mjs --test apps/portal/tests/*.test.mjs
pnpm --filter @atlas/portal test:browser
```

The first runs the model, pages, service, export, proposed-change and asset
tests against a small fixture Atlas. One of them follows every address the
served pages name, without the script, and holds each page to the two patterns.
The second walks the reader in headless Chromium with axe at 1440×900 and
375×812, on the fixture and on Meta-Atlas, or on the Atlas that
`ATLAS_BROWSER_ATLAS` names. At each step it fails on any axe violation, any
sideways scroll, any text under 10px, any departure from the two patterns as
drawn, and any console error. Screenshots go to
`tmp/portal-browser/screenshots/`, or to the folder `ATLAS_BROWSER_SHOTS` names.
In the development checkout, the handbook's interface practice says how the
Portal is built and its sheet practice how it is drawn.
