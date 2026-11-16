# How changes land

The agent that keeps an Atlas does not edit the Atlas's files where they
stand. It writes the change as files elsewhere, Atlas prepares it as a draft,
the owner reads it, and one operation writes it. This page explains why each
step is there. The rules are in the [operations
contract](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery);
the guide gives the agent the same path as instructions ([Change: prepare
whole, review, apply](../../spec/OPERATING.md#change-prepare-whole-review-apply)).

## The agent edits a copy

Two operations write the Atlas's files: applying a draft, and recovering after
an interrupted apply. The guide tells the agent not to edit the Atlas in
place. For anything larger than a small edit, the agent works on a candidate
instead: a folder that holds the whole proposed Atlas.
[`candidate`](../reference/cli.md#candidate) writes a fresh copy of the
Atlas's records into `.atlas-candidate/` at the Atlas root for that, replacing
what the folder held, and records in private state which Atlas it copied. No
reader captures that folder, so what the agent writes there is not part of the
Atlas anyone reads. A copy holds the whole Atlas as it was at one moment, and
what is prepared from it is every difference from the Atlas as it is now: a
copy of an earlier Atlas would propose to undo whatever was applied since. So
preparing from the folder is refused as stale once the Atlas has changed, or
when no record says which Atlas it was copied from, as after a copy that
stopped partway; the agent then takes a fresh copy ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).

The copy lets an agent work with ordinary files and its own tools while the
Atlas stays as it was. It edits the copy, asks
[`validate --from`](../reference/cli.md#validate) what preparing it would
report, and gives the folder to [`prepare`](../reference/cli.md#prepare). A
candidate may also be a folder outside the Atlas and its private state. Files
in it that are not records of an Atlas are not part of the change; those that
differ from the Atlas's own, or have no counterpart there, are reported as left
out, so nothing an author edited disappears without a word.

## A change is prepared whole

A change is prepared whole, validated whole and applied whole, and a candidate
that fails validation is never applied ([Keeping an Atlas
true](../../spec/SPEC.md#keeping-an-atlas-true)). An Atlas is valid or
invalid as a whole: an outline names Points in other files, and a Facet names
a Tree and Points in it. So what is checked is the Atlas as it would stand
after the change. A small edit can be given as explicit file changes instead
of a candidate; either way, preparation writes no authored file ([Prepared
changes and recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).

## A draft holds the change and its reason

Preparation computes the complete content before and after, the identity of
the Atlas it started from and the validation result, and saves them with a
reason as a draft ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).
A draft that does not validate is saved too, so it can be read and repaired,
but it cannot be applied. Drafts survive a restart, and each has a revision
that identifies its complete saved content.

The reason travels with the draft and is what the owner reads first. The guide
asks the agent to state in it what changed, what was removed and where its
meaning now lives, and what was left unresolved.

## The owner reviews by reading

The effects of a draft name every record it adds, changes or removes, and what
else to read because of it, such as the Points above each changed Point and
the Facets that bear on it ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).
These are leads to read, not proof of every consequence. The owner reads them
where they read the Atlas: the local Portal gives each draft a page. When the
candidate validates, the whole Atlas reads as proposed under it, with what
differs marked; when it does not, the page shows its diagnostics and the files
that differ ([The Portal](the-portal.md)).

On a copy of the example in `examples/offline-notes`, a change that adds a
clause to one sentence of "Delivery is reported only after the server
acknowledges the same revision" reads like this. Its page says "Ready to
apply". Under "What differs", Storage and delivery shows that Point marked
"changed". Under "What else to read" stand the Point above it, "Saving on the
device and delivery to the server are separate outcomes", and Product
experience's Facet "The delivery wording depends on the receipt rule", which
draws on the changed Point from the other Tree. The Point's page as proposed
shows the changed paragraph, with its earlier text behind "Before".

## Apply at the revision that was read

Applying works only on the Atlas the caller selected and the exact draft
revision the caller names. It validates the paths, the plan and the complete
candidate again, and checks every affected file against the bytes recorded
when the draft was prepared before it writes the first one. Concurrent writers
are kept apart by an exclusive lock ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).

Two checks keep what was read and what is written the same. If the draft is
not at the revision given, the one that was read, the apply is refused
(`STALE_DRAFT`). If the Atlas changed after the draft was prepared, the apply
is refused too (`STALE`), and the draft's page in the Portal says it is stale;
the agent prepares the change again. A refusal at the start writes nothing. A
change found once the writes have begun stops the apply as interrupted
instead, described below ([Apply](../reference/changes.md#apply)). A completed
apply removes its draft and its journal, and says so when it could not remove
the draft.

## When an apply is interrupted

An apply writes one file at a time, so it is not atomic across files, and
Atlas does not claim that it is. Before the first write it records each
file's original bytes in a journal in private state, and it records its
progress as it goes. An apply that stops partway, because a write failed or a
file changed under it, reports the files it wrote and keeps its draft and its
journal. [`recover`](../reference/cli.md#recover) rolls it back from the
journal. Each file of the change that holds the bytes the change proposed is
given back its original bytes, whoever wrote them; a file that holds
anything else is never overwritten
(`RECOVERY_CONFLICT`; [Recover](../reference/changes.md#recover)).

Until that transaction is recovered, the Atlas takes no other apply, of that
draft or of any other. Recovery restores the Atlas the transaction started
from, so an apply made before it would be undone by it. This holds for a
transaction whose journal lists no file written, too: a process that stopped
may have written a file it did not yet record, and recovery checks every file
of the change, restoring each it finds holding the proposed bytes. A journal
is kept only while its transaction is unfinished: a completed apply removes
it, since nothing is left to recover, and so does a finished rollback. A
rollback is not a completion. Once recovery has restored the Atlas the draft was prepared
against, the draft can be applied again; if another file changed in the
meantime, the draft is stale and is prepared again ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).
[Recover an interrupted apply](../how-to/recover-an-apply.md) gives the steps.

## Why the Portal writes nothing

The Portal presents each draft for reading and offers no way to apply one
([Product adapters](../../spec/spec/OPERATIONS.md#product-adapters)). Its
local service accepts only read requests, and only those addressed to its
loopback name and port ([Project workflow](../../spec/spec/PROJECT.md)),
so nothing done in a browser, by a reader or by another site's page, can
change the Atlas. A change reaches the Atlas's files only through apply, which
validates the whole candidate and checks the revision. Preparing, reviewing,
applying and recovering stay distinct, visible actions. The page of a draft
that can be applied names the command that applies it, for whoever is to run
it.
