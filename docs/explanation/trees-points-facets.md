# Trees, Points and Facets

An Atlas explains a project with three kinds of record. A Tree is one account
of the project, a Point is one claim and its explanation, and a Facet reads a
Point through another Tree. This page explains why the shape is this one and
holds nothing else.

## A Tree is one account

A Tree owns an account: one declared subject seen from one declared
perspective. Its scope says what belongs in it. Its one Base Point is an
ordinary Point whose claim is the account's top claim and whose explanation
says what the account establishes as a whole ([Atlas and
Tree](../../spec/SPEC.md#atlas-and-tree)). Several Trees let one project
be explained from more than one side; which ones, and what each owns, is the
Style's choice ([Styles](styles.md)). The example in
[`examples/offline-notes`](../../examples/README.md) keeps two: Product
experience and Storage and delivery.

## A Point is one claim

A Point is one claim and its explanation. Its title states the claim and its
body explains it. The title should be a sentence a reader could check or
dispute, so that the titles down a path read as an argument
([Point](../../spec/SPEC.md#point)). A Point has exactly one owning Tree
and one place in it, and its ID stays the same through revision and moves.

Down the Product experience Tree, the titles read: "Writers can keep working on
notes when the connection drops"; "Offline work stays on the current device";
"A note is “Saved on this device” until a server receipt makes it “Sent for
sync”". Read in order, they argue: the promise, where it stops, and the words
that keep the app from promising more.

The shape helps a reader only when each Point is written for it. How to write
a Point worth reading is the guide's subject: [Write: what makes a Point worth
reading](../../spec/OPERATING.md#write-what-makes-a-point-worth-reading).

## Every level explains

A Point develops into the Points its claim depends on, qualifies or details,
where each needs its own reference, assessment or revision. A higher Point
says what its developments establish together, and its claim stays within what
they and its sources support ([Point](../../spec/SPEC.md#point)).

This is what lets a reader stop at any depth: the Point where they stop
explains what lies beneath it and claims no more. It also makes a change below
a reason to read the Points above again. When incoming material changes a
detail, the higher explanation is reread, and not rewritten merely because the
detail changed ([Keeping an Atlas
true](../../spec/SPEC.md#keeping-an-atlas-true)); the review of a draft
names the Points above each changed Point for that reading ([Prepared changes
and recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).

The Base of Storage and delivery, "Saving on the device and delivery to the
server are separate outcomes", says what its two developments amount to: one
is a dated observation of a single normal restart, the other a selected rule
with no implementation evidence yet. Read together, its explanation says, they
show "what the app has shown and what it has only chosen".

## One owner for each statement

Knowledge that needs its own reference has one owning Point. Other records
refer to it instead of restating it differently. A link provides a reference;
it changes neither ownership nor placement
([Point](../../spec/SPEC.md#point)). A statement made twice can be
corrected in one place and left wrong in the other; a statement with one owner
is corrected once, for every Point that links to it.

In the example, what a server receipt establishes is stated once, in Storage
and delivery's "Delivery is reported only after the server acknowledges the
same revision". Product's wording decision does not restate it; it links to
that rule.

## Facets

A Facet attaches to a Point and reads that Point's claim through another Tree.
It names the other Tree, the Points there that bear on the claim, and what
follows from them, such as a dependency, a qualification, a consequence or a
tension. It earns its place when the other account holds something that
changes how the host claim should be read; a reference alone is a link
([Facet](../../spec/SPEC.md#facet)).

The host account owns the reading; a Facet does not redefine its targets or
move their ownership ([Facet](../../spec/SPEC.md#facet)). Because it is
a reading, a presentation must keep it apart from its targets' own claims
([Reading](../../spec/SPEC.md#reading)): the Portal names one as
"Product experience · Facet, seen from Storage and delivery".

"The offline promise rests on one normal restart" is Product experience's
Facet on "Offline work stays on the current device", read through Storage and
delivery, with the trial observation as its target. It adds the consequence
for Product: the result holds for that narrow case and cannot become a promise
that no writing is ever lost offline. The trial's own Point keeps the
observation and its limits.

## Decisions and Observations

A Point may carry a Type. A Decision records its standing: open, proposed,
selected, rejected or superseded, and selected does not establish that it was
built. An Observation records when something was observed and its source, and
does not establish that it still holds. Untyped Points are valid ([Sources and
Types](../../spec/SPEC.md#sources-and-types)). The Type lets a reader
tell a choice and a dated finding from a statement of how things are, and the
reading operations keep the standing and the date visible
([Route](../../spec/spec/OPERATIONS.md#route)). In the example, the
receipt rule is a Decision, selected, and the restart trial an Observation of
20 September 2026.

## Nothing else

A Tree's outline holds only Points. Its `tree.json` names the Base and places
every other Point beneath it, and each placement names one Point ([Tree and
outline](../../spec/spec/FORMAT.md#tree-and-outline)). No record groups
Points without stating a claim. Such a grouping would be a level that does not
explain, and a reader going down through it would meet a label where the
specification asks for an explanation of what lies beneath. Folders under
`points/` only locate files: IDs identify records, and the outline gives each
Point its place in its Tree ([Layout](../../spec/spec/FORMAT.md#layout)).
A Point that matters to another account is reached from it by a link or a
Facet, and keeps its one place.

Beside these records an Atlas keeps one Style and may keep Checks. Neither is
part of the explanation a reader descends: the Style says how the Atlas is
written ([Styles](styles.md)), and a Check states a requirement that changes to
the Atlas must meet ([Keeping an Atlas true](keeping-it-true.md)).
