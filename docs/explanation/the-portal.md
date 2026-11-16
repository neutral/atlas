# The Portal

The Portal is where an Atlas is read. It turns the Atlas into pages, served on
your machine or written as files for publication, and it never writes an
authored file. This page explains why its pages are built as they are. The
rules are in the [operations
contract](../../spec/spec/OPERATIONS.md#product-adapters); what each
page holds, and every label, is in the [Portal
reference](../reference/portal.md).

## One page for each Point

Each Point and each Facet has one page at its own address. The main column
holds the explanation as its author wrote it, and under it what is not
established and what it rests on: the uncertainty, then the sources behind a
line such as "3 sources" ([Product
adapters](../../spec/spec/OPERATIONS.md#product-adapters)). A record is
read whole, and a link to one names the record and never a part of it
([Markdown records](../../spec/spec/FORMAT.md#markdown-records)). So the
page is the unit: whatever links to a Point leads to all of it.

Above the title, a line says what kind of record this is: "Point", or for a
typed Point its Type and standing, such as "Decision · selected" or
"Observation · 20 September 2026". A Facet's page says whose reading it is:
"Product experience · Facet, seen from Storage and delivery". A presentation
must keep the account that owns each explanation visible and keep a Facet's
reading apart from its targets' own claims
([Reading](../../spec/SPEC.md#reading)); these lines are part of how the
Portal does it.

## The margin is a map

Beside the prose stands where the Point is: its Tree's outline around it, with
up to three Points above, the Points beside it and the Points it develops into;
then the Facets attached to it, the Points its prose links to, and the Points
and Facets that refer to it.

The Points above tell a reader what this Point is a part of. A reader who
arrives from a search or a link sees where the Point stands, what it develops
into and what other accounts say of it, without reading the rest of the Tree
first.

In the example in `examples/offline-notes`, the page of "Offline work stays on
the current device" has a margin headed Product experience: the Base above it,
the wording decision beneath it, and under "Facets seen from Storage and
delivery", "The offline promise rests on one normal restart". The [example's
README](../../examples/README.md) follows that path through both Trees.

## Two patterns

Every name a reader can choose does one of two things. An underlined name goes to
the page of what it names: a link in the prose, or a name on home, in Outline
or in search results. A name with `▸` stands in a margin and opens here: what
it names opens in the main column, under the Point whose margin named it, as a
panel with its own margin and its own Close, and its mark turns to `▾`. One
thing is open per margin. A panel's margin opens further panels inside it, and
the page's address names the chain of what is open.

Because a name is drawn as what it does, a reader can tell before choosing it
whether it will leave the page. Opening in place lets a reader follow a Facet
into another Tree and back without losing the page they were reading.

## Outline and Help

Outline lays every Tree whole over the page, and on a Point's page it marks
that Point. Help, the "?" at the right end of the strip, explains the Atlas's
words: what an Atlas, a Tree, a Point, a Decision, an Observation and a Facet
are. It also says how to move around and what the marks mean. Help is a page
of its own as well, so it is there without the script.

## Complete without a script

Every page is complete as it is served. Every name a reader can choose in a
margin is an ordinary link to the page of what it names. With the script, the
browser fetches that page and shows its parts in place; without it, the link
goes there. The script adds opening in place, Outline and Help over the page,
and search; the content is the same either way.

So an agent that fetches a page reads what a person reads on it, and what a
person opens in place is a page the agent can fetch by its own address. An
agent that works through the CLI or the MCP server meets the reading
operations under the names the guide uses ([Product
adapters](../../spec/spec/OPERATIONS.md#product-adapters)), and
[`outline`](../reference/cli.md#outline) gives a Tree's Points the way Outline
does ([Read: find the explanation, then read it
whole](../../spec/OPERATING.md#read-find-the-explanation-then-read-it-whole)).
Authored content is never executed
([Reading](../../spec/SPEC.md#reading)): authored HTML is shown as text,
and an image is named and not loaded.

## Marks come with words

What Atlas knows about a source is said in words, from the stale report's
status. A source whose stamp no longer matches (`changed`) is marked "changed
since this was checked", and one that is not there (`missing`) "missing", both
in red, the color the Portal keeps for what the reader must attend to. A stamp
that could not be compared with its source where the page is served
(`denied`), because the source lies outside the directories granted or could
not be read, is marked "not checked here" in blue, so that it is not taken for
one that was checked; when no stamp on a page could be, the line that counts
the sources says so once. A current, unstamped or remote source carries no
mark. A missing or unread source must stay visible as a limit and must not be
presented as inspected evidence ([Sources and
Types](../../spec/SPEC.md#sources-and-types)). Help lists every mark.

## A proposed change, read like the Atlas

The local service also presents each draft for reading and offers no way to
apply it ([Product
adapters](../../spec/spec/OPERATIONS.md#product-adapters)). Home lists
the drafts under "Proposed changes". A draft's page states its reason, whether
it can be applied, what differs, what else to read because of it, and, when it
can be applied, the command that applies it, or, while an interrupted apply
holds back every draft, the command that lists what to recover. When the
candidate validates, the whole Atlas reads as proposed under that page, with
the same two patterns; when it does not, the page shows its diagnostics and
names the files the change writes. A part that differs is marked "new", "changed" or "removed", and when
the Atlas the draft was prepared against validates, a changed part keeps its
earlier text behind "Before". A record that differs only in its stamps is
marked "stamped", in blue, since nothing it says differs.

The owner reviews a change by reading it where they read the Atlas, so a
proposed Point looks like a Point and can be read against the Points around
it. An export holds no proposed change. [How changes land](how-changes-land.md)
explains what comes before and after that reading.
