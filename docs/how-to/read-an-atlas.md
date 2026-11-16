# Read an Atlas

Use this guide when you want to understand a project from its Atlas.

The steps follow the question the shipped example answers: when can a writer
trust that an offline note is saved, and what does that say about other
devices? The [example's README](../../examples/README.md) follows the same
answer. [The Portal](../explanation/the-portal.md) explains why the Portal is
built as it is, and the [Portal reference](../reference/portal.md) gives every
page, label, address and key.

## Open the Portal

Run `atlas open` with `PROJECT`, the project's directory:

```sh
atlas open PROJECT
```

Atlas finds the project's Atlas, serves the Portal on your machine and opens
it in your browser. The terminal prints its address:

```text
  "url": "http://127.0.0.1:PORT/",
```

Keep the terminal running while you read; `Ctrl+C` stops the Portal. Reading
writes nothing. From a source checkout the command is `pnpm atlas`, run from
the repository root ([Install Atlas](install.md#from-the-source-checkout)).

Open it through the project, as above, rather than with
`atlas --root ATLAS open`, `ATLAS` being the Atlas's own directory. Through
the project, the Portal may read the project's files the Atlas cites, so it
can tell you whether they changed
([Check what a Point rests on](#check-what-a-point-rests-on)).
When the project holds several Atlases, `atlas open` asks which one; the
options are in [`open`](../reference/cli.md#open).

To follow these steps on the example, open the copy inside the installed
package; reading it writes nothing there:

```sh
atlas open "$(npm root --global)/@neutral/atlas/examples/offline-notes"
```

With Atlas installed in one project, run from that project:

```sh
npx atlas open "$(npm root)/@neutral/atlas/examples/offline-notes"
```

From a source checkout, run `pnpm atlas open examples/offline-notes` from the
repository root.

## Start from the top or a question

Home lists each Tree: its title, its top Point, which states the claim the
whole Tree makes, the Tree's scope, and a line such as "2 Points" that opens
the Tree's outline.

To read an account from its top claim down, choose its top Point. In the
example, under Product experience, choose "Writers can keep working on notes
when the connection drops".

To start from a question, search. Press `/` and type a word of your question.
Each result shows its Tree and kind, its title and an excerpt; choose by the
title, and read the excerpt only as a lead. Searching for `receipt` lists
"Delivery is reported only after the server acknowledges the same revision"
fourth, as "Storage and delivery · Decision · selected". Search matches
words, so finding nothing does not mean the Atlas says nothing about it. Search
needs the page's script; without it, use [Outline](#jump-with-outline).

## Read a Point

A Point's page holds, from the top:

- The kind line: "Point", or a typed Point's Type and standing.
  "Decision · selected" records a choice, which does not mean it was built.
  "Observation · 20 September 2026" records what was seen on that date, which
  does not mean it still holds.
- The title: the claim the Point makes.
- The prose that explains it. An underlined name in it goes to its page; a
  name marked `↗` leaves the Atlas.
- "Uncertainty": what limits the claim.
- The sources, behind a line such as "3 sources"
  ([Check what a Point rests on](#check-what-a-point-rests-on)).
- "Next": the next Point in reading order, or at the end of a Tree "Next, in"
  and the next Tree's title.

In the example, open "Offline work stays on the current device" and read its
Uncertainty: only one normal restart has been observed. Its prose links to
the wording decision and to the Facet that says what that limit means.

## Follow the margin

Beside the prose, or under it on a narrow screen, the margin shows where the
Point stands:

- The Tree's title, then its outline around this Point: up to three Points
  above it, the Points beside it, this Point (not a link) and the Points it
  develops into.
- "Facets seen from" and another Tree's title: what that Tree holds that
  changes how this Point is read.
- "Refers to": the Points this Point's prose links to, in any Tree.
- "Referred to by": the Points whose prose links to this one, and the Facets
  of other Trees that draw on it.

"Refers to" and "Referred to by" leave out what the outline above already
shows.

Every name in the margin but the current Point carries `▸` and opens here.
Choose one and what it names opens under the prose as a panel, with its own
margin and "Close"; its mark turns to `▾`. A name in a panel's margin opens a panel inside that one.
Escape closes the innermost panel. The address in your browser names what is
open, so a link to it opens the same panels. To go to the page instead, choose
the panel's title, or click the name with a modifier key.

In the example, on "Offline work stays on the current device":

1. Under "Facets seen from Storage and delivery", open "The offline promise
   rests on one normal restart". Its panel reads "Product experience · Facet,
   seen from Storage and delivery": Product's reading of its own claim
   through the other Tree.
2. In the panel's margin, under "In Storage and delivery", open "One trial
   reopened an offline note after a normal restart". It opens inside the
   first panel as "Observation · 20 September 2026", and the address ends in
   `#product:local-evidence-limit/local-persistence`.

## Jump with Outline

"Outline", in the strip at the top of the Atlas's pages other than home, and
not under a proposed change, lays every Tree
whole over the page, with the current Point marked and its Tree open. Choose
any title to go to its page. Escape, "Close" or a click outside closes it.
Without the script, "Outline" is a link to home, which holds the same
outlines.

"?", at the right end of the strip, opens Help: what an Atlas, a Tree, a
Point, a Decision, an Observation and a Facet are, how to move around, and
every mark.

## Check what a Point rests on

Open the sources line at the foot of the prose. The sources stand in groups by
their role: "Evidence", "Background", "Examples", "Implementation", "History",
and "Sources" for those with none. Each line names the source, its locator
when it has one, the path of a local file, and a mark when one applies. The
name of a web address links to it, marked `↗`. On the Portal that `atlas open`
serves, the name of a cited local file within the directories the Portal may
read goes to a page of that file as it is now, "Source, as it is now", opened
at the cited section. Its margin, "Cited by", lists every Point and Facet that
cites the file.

A mark says what Atlas found when it read the cited source: whether it is
there, and whether it still matches its stamp, the record of the source as it
stood when the Point was last checked against it. The sources line counts the
marks, as in "3 sources · 1 changed since this was checked".

- `△ changed since this was checked`: the cited material changed after the
  Point was checked against it. Read both before you rely on either; it is a
  reason to read again, not proof of an error. [Keep an Atlas true as the
  project changes](keep-it-true.md) has the owner's side.
- `✗ missing`: the cited file is not there, or the section it names is not in
  it.
- `○ not checked here`: the Portal could not compare the source, because it
  lies outside the directories it may read or could not be read. Open the
  project with `atlas open PROJECT`, or grant the directory with
  `--allow-source-root` ([`open`](../reference/cli.md#open)).

A source without a mark matches its stamp, or carries none, or is a web
address, which is never fetched. When none of a page's stamps could be
compared, its sources line says "not checked here" once and no source is
marked. Help also lists "new", "changed", "removed"
and "stamped": those mark what differs under a
[proposed change](ask-for-a-change.md#read-the-proposed-change), not a source.

In the example, open "One trial reopened an offline note after a normal
restart" and its "2 sources": the trial's conditions and its limits, both in
`sources/trial.md`. Choose the second to read the Limits section: the run
did not interrupt a write, cut power or reconnect, so it supports a narrow
result, not crash recovery or delivery.

You have the example's answer from Points in both Trees: a local save, one
observed normal restart and a server receipt each establish something
different, and none of them says that another device has the note. Each
statement carries the limits its Point keeps and the sources it rests on.
