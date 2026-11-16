# The Portal

The Portal shows an Atlas as pages. The local service, started by
[`atlas open`](cli.md#open), serves them from the files on disk; an export,
written by [`atlas export`](cli.md#export), holds the same pages as files. This
page lists every page, what it holds in order, every label and mark a reader
sees, how a reader moves, the service and the export folder. Why the Portal is
built this way is in [The Portal](../explanation/the-portal.md). What it must do
is in the [operations contract](../../spec/spec/OPERATIONS.md#product-adapters).

## Addresses

| Address | Page | Where |
| --- | --- | --- |
| `/` | [Home](#home) | both |
| `/<point>/` | [A Point](#a-point) | both |
| `/_/facet/<tree>/<facet>/` | [A Facet](#a-facet) | both |
| `/_/help/` | [Help](#help) | both |
| `/_/source/?uri=<uri>` | [A source](#a-source) | local service |
| `/_/draft/<id>/` | [A proposed change](#a-proposed-change) | local service |
| `/_/draft/<id>/<point>/` | a Point as proposed | local service |
| `/_/draft/<id>/_/facet/<tree>/<facet>/` | a Facet as proposed | local service |
| `/_/draft/<id>/_/style/` | the Style as proposed | local service |
| `/_/sheet.css` | the stylesheet | both |
| `/_/reader.js` | the script | both |
| `/_/search.js` | the Library's search module | both |
| `/_/search.json` | what search ranks: `{ "accounts": { ID: title }, "records": [...] }`, the Trees' titles and every Point and Facet | both |

- `<point>`, `<tree>`, `<facet>` and `<id>` are IDs: a lowercase letter or
  digit, then up to 99 lowercase letters, digits and hyphens. `<id>` is a
  draft's ID.
- `<uri>` is a source URI as the Atlas cites it, percent-encoded. When it has a
  fragment, the address repeats the fragment as its own, so the page opens at
  the cited heading: `/_/source/?uri=sources%2Ftrial.md%23limits#limits`.
- The Style has no page in the Atlas as it is. It has one only under a proposed
  change.
- The address of a Point, a Facet, Help, a proposed change or a page under
  one, without its closing slash, answers `301` with the address that has it.
  `/_/source` without its slash is not redirected and has no page.
- Every link between the Portal's own pages is relative, so an export works
  under any path. A link out of the Atlas is absolute.
- A fragment on a page of a Point or a Facet names what is open under it,
  outermost first, separated by `/`: a Point by its ID, a Facet as
  `<tree>:<facet>` (`#product:local-evidence-limit/local-persistence`). See
  [Two patterns](#two-patterns). On a source's page the fragment names a
  heading of the file.

An address with no page answers `404` with the strip and one sentence:

| Sentence | When |
| --- | --- |
| No Point has the address ID. | `/<id>/` and no Point has that ID |
| Nothing has this address. | any other address, and a Facet that does not exist |
| No source this service can show has this address. | `/_/source/` for a file that has no page |
| No proposed change has the address ID. | `/_/draft/<id>/` and no draft has that ID |
| This proposed change has no Point with the address ID. | a Point the change neither holds nor removes, or any Point when the Atlas as proposed does not validate |
| This proposed change has nothing at this address. | a Facet or Style the change does not hold |

A draft that cannot be read answers `500` with "The proposed change ID could
not be read:" and the Library's message. Any other failure answers `500` in
plain text: "The Portal could not answer:" and the message.

## The strip

Every page opens with the strip, a line across the top. It has three forms.

| Pages | The strip holds, left to right |
| --- | --- |
| Home, a Point, a Facet, a source, Help, a missing page | the Atlas's title, a link to home; then "Outline" (not on home), the search field (only with the script) and "?" (not on Help) |
| A proposed change and every page under it | the Atlas's title as proposed, a link to the change's page; "Proposed change" in red; "The Atlas as it is", a link to the same Point or Facet in the Atlas as it is, or to home when it has none there; "?" |
| No Atlas, or an Atlas that does not validate | "Atlas", a link to home; "?" (not on Help) |

"Outline", "?", "Close" and the search field are the only bordered controls.

## Home

Page title: the Atlas's title. In order:

1. The Atlas's title as the heading.
2. On the local service, when drafts are saved for the Atlas, readable or
   not, "Proposed changes": each draft's reason, a link to its page, and under
   it what it does and when it was prepared, latest first. What it does reads "N Points differ"
   ("1 Point differs", "no Point differs"), followed by "· N Points and M
   Facets stamped" when it also stamps; a draft that only stamps reads "only
   stamps: N Points and M Facets stamped, nothing they say differs"; a draft
   prepared where there was no Atlas reads "a new Atlas". A draft that cannot
   be applied starts with its standing in red and " · ", the first of these
   that holds: "Invalid" when what it proposes does not validate or the
   Library refuses the change itself; "Blocked" while the Library's apply
   gate would refuse every draft ([Apply](changes.md#apply), step 3), as for
   an interrupted apply that awaits recovery, a journal that cannot be read or
   an Atlas that does not read whole, or while the Portal cannot tell whether
   it would; "Stale" when the Atlas has changed since the draft was
   prepared. For example "Invalid · 1 Point differs · prepared …",
   "Blocked · no Point differs · prepared …", "Stale · no Point differs ·
   prepared …", "Stale · a new Atlas · prepared …". The moment reads
   "prepared 15 November 2026 at 13:18", in the service machine's time zone.
   Under the list, each `.json` file among the drafts that cannot be read has
   a line of its own in red, "✗ A proposed change could not be read: FILE:
   MESSAGE", FILE being its file name and MESSAGE the Library's words; the
   drafts that can be read are listed all the same. When the private state as a whole cannot be read
   (`INVALID_STATE_HOME`, `STATE_OWNER`, `UNSAFE_STATE`), one line says so,
   with the Library's words and no file name. A completed apply removes its
   draft, and it is no longer listed. A draft whose apply was a noop or was
   interrupted, or whose removal after a completed apply failed, is kept and
   stays listed.
3. Each Tree, in the order of `atlas.json`: its title; its top Point's title
   (the Portal's word for the Tree's Base), a
   link to its page, with the top Point's Type and standing under it when it
   has a Type; the Tree's scope; and a disclosure, closed, whose line counts the
   Points under the top Point ("2 Points", "1 Point") and which holds them as an outline,
   each title a link followed by " · " and its Type and standing when it has
   one. A Tree whose top Point has no developments has no disclosure.

An export's home has no proposed changes.

## A Point

Page title: "TITLE · ATLAS".

The main column, in order:

1. The kind line: "Point", or a typed Point's Type and standing:
   "Decision · selected" (the status as written), "Observation · 20 September
   2026" (the date of `observedAt`).
2. The title, as the heading.
3. The prose as written, rendered from Markdown. Authored HTML is shown as text
   and never run. An image is never loaded: it reads "[Image: WORDS]", or
   "[Image]" when it has no words. A link leads to:
   - a Point or a Facet of the Atlas: its page, without the link's fragment;
   - on the local service, a local file the Atlas cites and the service shows:
     that file's page, at the section the link names;
   - an HTTP(S) address without a user name or password: that address,
     marked `↗`, in a new tab;
   - in an export, a local file when the export has a source base: the file
     under that base, marked `↗`;
   - in an export, a Point or Facet of a Tree it does not hold: nowhere; the
     words stay, followed by "not in this publication";
   - anything else: nowhere; the words stay.
4. The foot:
   - "Uncertainty" and the Point's uncertainty, when it has one;
   - the sources, behind a disclosure that starts closed. Its line counts them
     ("3 sources", "1 source") and adds, in red, " · N changed since this was
     checked" and " · N missing", and in blue " · N not checked here". When
     every stamped source of the page could not be checked, the blue part
     reads " · not checked here", without a number, and those sources carry no
     `○` mark; a missing source keeps its count and its mark.
     Inside, the sources stand in groups, each under its heading, in this
     order: "Evidence", "Background", "Examples", "Implementation", "History",
     and "Sources" for those without a role. Each line holds the source's
     title, or its path or URL when it has none; " · " and its locator, when it
     has one; its path under a title, for a local source; and its
     [mark](#marks).
5. "Next" and the title of the next Point in reading order, a link. Reading
   order is each Tree's outline from its top Point down, Tree by Tree in the
   order of `atlas.json`. The last Point of a Tree leads to the top Point of
   the next Tree held, under "Next, in TREE". The last Point of the last Tree
   has no Next.

A source's name is a link on the local service when the service shows the
file on a page of its own ([A source](#a-source)). An HTTP(S) source links to
its URL, marked `↗`. In an export with a source base, a local source links to
the file under that base, marked `↗`; without one it is plain text.

The margin, named "Where this stands", is the map of where the Point stands.
In order:

1. The Tree's title, and " · N more Points above" ("1 more Point above") when more than three Points
   stand above this one. Under it, an outline: the three nearest Points above,
   each inside the one above it; the Points beside this one, under the same
   Point; this Point, marked as the current page and not a link; and its
   developments under it. The top Point of a Tree shows itself and its
   developments.
2. "Facets seen from TREE", once for each Tree the attached Facets read
   through: each Facet said of this Point. In an export that does not hold that
   Tree: "Facets seen from a Tree not in this publication".
3. "Refers to": the Points this Point's prose links to, under the titles of
   their Trees, leaving out those the outline above already shows.
4. "Referred to by": the Points whose prose links to this Point, and the
   Facets of other Trees that draw on it, under the titles of their Trees,
   leaving out what the outline already shows.

Every name in the margin but the current Point carries `▸`
([Two patterns](#two-patterns)). A part with nothing to list is left out.

## A Facet

Page title: "TITLE · ATLAS".

The main column holds, in order: the kind line "TREE · Facet, seen from VIA"
(its own Tree, then the Tree it reads through; in an export that does not hold
that Tree, "Facet, seen from a Tree not in this publication"); the title; the
prose; and the foot, as on [a Point's page](#a-point). A Facet has no Next.

The margin, "Where this stands":

1. "Said of, in TREE": the Point it is said of.
2. "In VIA": the Points it draws on in the other Tree. An export that does not
   hold that Tree leaves this part out.

## A source

The local service only. Page title: "PATH · ATLAS".

A source has a page when it is a local file that a Point or Facet of the Atlas
as it is cites, by any fragment, and the file lies within the source roots the
service was granted ([Source grants](configuration.md#source-grants)), outside
Atlas's private state and outside any `.atlas-` path. Any other file, and an
HTTP(S) URL, has no page.

The main column holds the kind line "Source, as it is now", the file's path as
the title (as the source line shows it, without leading `../`), and then one of:

- a Markdown file (`.md`), rendered as prose is, its record header left out,
  each heading one level lower than written, and at most level 6, and
  carrying, as its ID, the name the Library gives that heading, so a cited
  section is where the page opens;
- any other text, as it is, in a fixed-width block;
- one sentence: "This file is not there.", "This file is too large to show
  here." (over 2 MiB), "This file is not text, so it is not shown here." or
  "This file could not be read here."

The file is read through the Library when the page is asked for.

The margin, named "What cites it", holds "Cited by": every Point and then every
Facet that cites the file, by any fragment, under the titles of their Trees.
Each is a name that goes to its page, without `▸`: this is the one exception to
[the two patterns](#two-patterns).

## Help

Page title: "Help · ATLAS", or "Help · Atlas" where there is no Atlas. The page
answers whether or not there is an Atlas to read. Under the heading "Help" it
holds three lists of a term and what it means:

- "The words": Atlas, Tree, Point, Decision, Observation, Facet.
- "Moving around": An underlined name, A name with ▸, Next, Outline, Search,
  Escape.
- "The marks": new, changed, removed; stamped; △ changed since this was
  checked; ✗ missing; ○ not checked here; ↗.

"?" at the right end of the strip, named "Help", is a link to this page. With
the script it is a button that lays the three lists over the page in a dialog
with the Atlas's title, "Help" and "Close", which closes as
[Outline](#outline) does.

## A proposed change

The local service only. Each draft saved for the Atlas has a page, read from
private state. Page title: "REASON · Proposed change · ATLAS".

In order:

1. The draft's reason, as the heading.
2. Its standing and when it was prepared: "Ready to apply", or in red, as on
   home, "Invalid: it cannot be applied as it stands", "Stale: the Atlas has
   changed since this was prepared", or "Blocked:" and what blocks it: "an
   interrupted apply needs recovery first" for a transaction that recovery
   rolls back; "the Atlas does not read whole" for an Atlas that does not;
   otherwise the Library's words, such as why a journal cannot be read. Then
   " · prepared" and the moment.
3. When the change stamps sources, what it does, as on home.
4. When the Atlas it was prepared against does not validate: "The Atlas it was
   prepared against does not validate: what differs is read from its files as
   far as they allow, and no Point or Facet shows what it said before."
5. When it is invalid, its diagnostics: for each, "✗" and the code in red, the
   message, and the file.
6. "What differs". Every file the change writes is named in one of these
   groups, in this order:
   - "This Atlas", when the change writes `atlas.json`: which parts differ, of
     "its title", "its ID", "which Trees it holds", "the order of its Trees",
     or "its file only"; the title as proposed with "Before", only when the
     title differs; the ID likewise, only when the ID differs; and the Trees in
     their order as proposed, when the order differs.
   - Each Tree that differs or holds what differs, as proposed, then the Trees
     the change removes. A Tree's own word ("new", "changed", "removed") stands
     beside its title; a changed Tree says which of "its title", "its scope",
     "its outline" differ, or "its file only", shows its scope when it is new
     or changed, and puts what its title and scope said under "Before". Under
     it, one row for each Point and each Facet: its word and its title, a link
     to its page under the change, struck through when removed. A Facet's row
     carries "Facet, seen from VIA" above its title. A row whose file alone
     differs has no word and says "its file only".
   - "How this Atlas is written": the Style's title, a link to its page under
     the change, with its word or "its file only".
   - "What this Atlas is held to": each Check that differs, with its word, its
     title, its file, how it binds ("Required · active", "Advisory · draft"),
     its text as proposed, and one "Before" holding whichever of these
     differed. A removed Check is struck through. A Check has no page.
   - "Files": each file no record stands for, with its word, the name of the
     record it held, when there was one, and its path. When the Atlas as
     proposed does not validate, every file is named here.
7. "What else to read": "Points above what differs" and "Other Trees' Facets
   that draw on what differs", each under the titles of their Trees. A Point or
   Facet that is only stamped adds nothing here.
8. "To apply", only when the change is ready: the command that applies it,
   `atlas --root ROOT apply ID --revision REVISION`. When it is blocked by an
   interrupted apply that recovery rolls back, "To recover" in its place: the
   command that lists what to recover, `atlas --root ROOT recover`. Blocked
   for any other reason, the page names no command. When the service reads drafts from a state
   home it was given (`ATLAS_STATE_HOME`, which `--state-home` sets), each
   command names it after the root:
   `atlas --root ROOT --state-home HOME apply ID --revision REVISION`.

A change that creates the Atlas is told with everything in it new.

### Pages under a proposed change

Under the change's address the whole Atlas reads as proposed, with what
differs marked ([Marks](#marks)). A Point or Facet as proposed has the layout
of its page in the Atlas as it is, with these additions:

- Its own word before the kind line, and beside its name in every margin.
- "Before" under the title, holding the title it had.
- A changed standing: the new one marked "new", or the earlier one under
  "Before"; a removed one struck through and marked "removed".
- In the prose, each top-level block that differs: a new block marked "new"; a
  removed block struck through and marked "removed"; a changed block with
  "Before" holding the block it was. Blocks are paired in order. The likeness
  of two blocks is 2 × shared ÷ (words before + words after), words being runs
  of letters and digits, lowercased and counted with repeats, and shared the
  number the two blocks hold in common. Two blocks may pair when they are the
  same or their likeness is at least 0.5. Of the pairings that keep both
  texts' order, the one with the greatest total likeness is taken, a pair of
  the same block counting 1000. A paired block that is not the same is
  changed; an earlier block left unpaired is removed; a later one is new.
- The uncertainty marked "new" or "removed", or with "Before".
- The sources disclosure open when a source differs, each source that differs
  marked "new", "removed" or "stamped", or with "Before".
- In the margin, the Points and Facets the change removes around it, struck
  through. A Point that moved shows where it stood before, after the Tree's
  outline: "Before in TREE, under" and the Points that stood above it, or
  "Before, the top Point of TREE".
- A Point or Facet the change removes is drawn as it was, without its
  uncertainty and its sources, its prose struck through.

A link in the prose of a page under a change to a local file is plain words. A
source's name links to its page only when the Atlas as it is cites that file.

The Style as proposed (`/_/draft/<id>/_/style/`) holds the kind line "How this
Atlas is written", the Style's title and its text, with what differs marked as
for a Point. It has no margin; its way back is home.

The Portal offers no way to apply a draft. Applying is done through the CLI or
the MCP server ([Apply](changes.md#apply)).

## No pages to show

Where the root holds no Atlas, home is "No Atlas here": any proposed changes
saved for that folder, listed as on [home](#home), then "This command
prepares one in ROOT, as a proposed change to read here and then apply. Its
ID, its title and its Style are yours to choose; atlas styles lists the
Styles." and the command
`atlas --root ROOT init --id ID --title TITLE --style STYLE`, with
`--state-home HOME` after the root as for the apply command.

Where the Atlas does not validate, home is "This Atlas does not validate": any
proposed changes, listed as on home, then each diagnostic as on a proposed
change's page.

In both cases the page title is "Atlas". Help, the pages of proposed changes,
`/_/sheet.css`, `/_/reader.js`, `/_/search.js`, and the `301` answers to an
address without its closing slash answer as usual. Every other address answers
`404` with the same page.

## Marks

A mark is a word, often with a symbol. Red is what a reader must attend to;
blue is what Atlas says that changes nothing a record says.

| Mark | Ink | Where | Means |
| --- | --- | --- | --- |
| new | red | under a proposed change | the change adds it |
| changed | red | under a proposed change | the change alters it |
| removed | red, struck through | under a proposed change | the change removes it |
| Before | red, a disclosure | under a proposed change | holds what a changed part said |
| stamped | blue | under a proposed change | only the stamps of its sources differ; what it says is the same, it is not counted among the Points that differ |
| Proposed change | red | strip | this page reads the Atlas as a draft proposes it |
| `△` changed since this was checked | red | a source line | the cited material no longer matches the stamp |
| `✗` missing | red | a source line | the cited file is not there, or its fragment names no heading in it |
| `○` not checked here | blue | a source line | the stamp could not be compared with the source where this page is served |
| `✗` beside a code | red | diagnostics, home | what does not validate, or what could not be read |
| `↗` | blue | after a link | the link leaves the Atlas and opens in a new tab |
| `▸`, `▾` | blue | margin names, disclosures | opens here; is open |
| not in this publication | blue | an export | the link leads to a Tree the export does not hold |

A source's mark is the status the [stale report](sources.md#the-stale-report) gives it, read
within the grants: `changed` is `△`, `missing` is `✗`, `denied` is `○`. A source
that is `current`, `unstamped` or `remote` carries no mark. The local service
reads a page's sources each time the page is asked for; an export reads them
once, when it is written.

## Two patterns

Every name on every page follows one of two patterns.

- **Go.** An underlined name is a link to the page of what it names: a link in
  the prose, the title of an opened panel, Next, every name on home, in
  Outline, in search results and on a proposed change's page, a source's name,
  and every name under "Cited by".
- **Open.** A name with `▸` stands in a margin. It is a link to the page of
  what it names. With the script, a plain click or Enter opens it here instead:
  as a panel in the main column, under the Point whose margin named it. A click
  with a modifier key, or with another button, follows the link.

A panel holds the kind line, with the Tree's title before a Point's kind, and
"Close"; the title, a link to its page; the prose and the foot; and its own
margin: "Develops into" with a Point's developments, then the parts of its
page's margin after the Tree's outline. A Facet opened from the Point it is
said of leaves out "Said of". A margin has one item open at a time: opening
another closes the first, and opening an open item closes it. `▾` marks the
open item. Panels nest. Each nested panel stands inside the one that opened
it.

The address's fragment names the chain of what is open ([Addresses](#addresses)).
A page loaded with such a fragment opens that chain. When a panel's page cannot
be fetched, the browser goes to the page.

The one exception is a source's page: its margin opens nothing, and its names
go.

## Outline

"Outline" in the strip is a link to home. With the script it is a button that
lays home's list of Trees over the page in a dialog: a header with the Atlas's
title, "Outline" and "Close", then every Tree with its top Point, scope and
outline. On a Point's page that Point is marked as the current page and its
Tree's outline is open. On a Facet's page the Tree of the Point it is said of is
open. The dialog closes on Escape, on "Close" or on a click outside it, and
gives the focus back to the button. Outline is not on home, on a proposed
change or under it, or where there is no Atlas.

## Search

The search field stands in the strip between "Outline" and "?" on the pages of
the Atlas as it is: home, a Point, a Facet, a source, Help and a missing page.
It is not on a proposed change, under one, or where there is no Atlas. It
exists only with the script. Its placeholder is "Search"; its accessible name
is "Search the Points and Facets".

When the field is first focused, the script loads `_/search.js` and
`_/search.json`. Each change to the field ranks the Points and Facets with the
Library's search ([Reading](reading.md#search)), in its summary form, and lists
at most 12. Source files are not searched.

Each result is a link to its page and shows, in order:

- its Tree and kind: "TREE · Point", "TREE · Decision · selected",
  "TREE · Observation · 20 September 2026", or "TREE · Facet, seen from VIA"
  ("a Tree not in this publication" in an export that does not hold it);
- its title;
- the Library's excerpt of its text around the first match, with Markdown
  marks taken out and "…" where it was cut.

When more records match than are listed, the list ends with "12 of 167 shown"
(the real numbers); the line is neither a result nor a link. When none match:
"No Point or Facet holds those words." A click outside the field closes the
list.

## Keyboard

| Key | Where | Does |
| --- | --- | --- |
| Tab | anywhere | moves through links and controls in the order of the page |
| Enter | a link or a margin name | goes; with the script a margin name opens or closes its panel |
| `/` | anywhere but a text field | puts the focus in the search field |
| Enter | the search field | goes to the first result |
| Down, Up | the search field and its results | moves through the results; past either end, back to the field |
| Escape | the search field or its results | empties the field, closes the list and leaves the field |
| Escape | Outline or Help open | closes the dialog |
| Escape | a panel open | closes the innermost panel and gives the focus back to the name that opened it |

## Without the script

Every page is complete as served. Every name in a margin is a link to a real
page, "Outline" is a link to home and "?" a link to the help page, so an agent
that fetches an address reads what a person reads. The script, `_/reader.js`,
adds the panels, the Outline and Help dialogs, the search field, and opening
the chain a fragment names. It adds no content.

Each page carries its Content Security Policy in a `meta` element, the same as
the service's header without `frame-ancestors`.

## The service

[`atlas open`](cli.md#open) starts it; its options are there.

- It listens on `127.0.0.1` only, on the port asked for, or a free one.
- It answers only a request whose `Host` is `127.0.0.1:PORT`, `localhost:PORT`
  or `[::1]:PORT`, in any case, where PORT is the port it listens on; the name
  alone is accepted only on port 80. A request with an `Origin` header must
  name one of those origins over `http`. Any other request is refused with
  `403` and the text "This request does not name the Portal on this machine."
- It accepts `GET` and `HEAD`. Any other method is refused with `405`,
  `Allow: GET, HEAD` and the text "The Portal only reads: GET or HEAD." `HEAD`
  answers with the headers alone.
- It writes nothing. It reads the Atlas, the drafts and apply journals saved
  for it, and the cited sources within its grants.
- It allows 10 seconds for a request's headers and 30 seconds for the whole
  request.
- SIGINT or SIGTERM stops it.

Every answer carries these headers:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `no-store` |
| `Content-Type` | the type, with `charset=utf-8` |

A page reflects the files on disk when it is asked for. A reading of the Atlas
is kept between requests only while every file and folder that holds its
records has the size, times and identity it had, and only once the newest of
them is two seconds old; otherwise the Atlas is read again. How a page's
sources stand is read each time the page is asked for.

## The export folder

[`atlas export`](cli.md#export) writes the pages of the chosen Trees into a
folder; its options and refusals are there. The folder holds static files, and
every link between them is relative. Putting it online is in
[Publish an Atlas](../how-to/publish.md).

An export holds:

| File | Holds |
| --- | --- |
| `index.html` | home |
| `<point>/index.html` | each Point of the chosen Trees |
| `_/facet/<tree>/<facet>/index.html` | each Facet of the chosen Trees |
| `_/help/index.html` | Help |
| `_/sheet.css`, `_/reader.js`, `_/search.js`, `_/search.json` | as on the local service |
| `_/export.json` | the marker |

It holds no page of a source, no proposed change and no source file. It never
expands through Facets or links: what lies in a Tree not chosen is marked "not
in this publication" ([A Point](#a-point), [A Facet](#a-facet)).

The marker is JSON:

```json
{
  "format": "atlas.export/2",
  "atlas": "offline-notes",
  "identity": "bee2cc7f…",
  "trees": ["product"],
  "sourceBase": "https://example.org/notes/",
  "files": ["_/export.json", "_/facet/product/delivery-dependency/index.html", "…", "product-purpose/index.html"]
}
```

`atlas` is the Atlas's ID, `identity` the view identity it was written from,
`trees` the Trees it holds, `sourceBase` the source base or `null`, and `files`
every file it wrote, sorted, the marker among them.

The destination must not exist, or must hold the marker of an earlier export:
format `atlas.export/2`, every file it lists of a shape an export writes.
Otherwise the export is refused with `EXPORT_EXISTS`. Over an earlier export:

- every file the marker lists is removed, and the new files take their place;
- a file the marker does not list is left as it is;
- a file the marker does not list that stands where a new file would go
  refuses the export with `EXPORT_CONFLICT`.

The files are first written into a folder named `.atlas-export-` and a UUID
beside the destination, then moved into place, and that folder is removed. A
failure before the move leaves the destination as it was. An interruption
during the move is refused with `EXPORT_PARTIAL`, which names the destination
to inspect. A destination inside the Atlas or holding it, inside Atlas's
private state, or overlapping the Atlas application is refused with
`EXPORT_OVERLAP`. The application is told by the folder that holds the
Portal's `apps/`. In a source checkout, which keeps `pnpm-workspace.yaml`
there, it is the code, `apps/` and `library/`, and the checkout's other
folders may hold an export. An installed package, whatever its name, is the
application as a whole, and so is the runtime bundle around it when it runs
from one.

The source base is the HTTP(S) address at which the Atlas root can be browsed.
It may carry no user name or password. Its query and fragment are dropped and
a closing `/` is added. With it, every local source and every prose link to a
local file links to that file under the base, marked `↗`. Without it, a source
name is plain text and such a link is plain words.
