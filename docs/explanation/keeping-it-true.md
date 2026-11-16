# Keeping an Atlas true

An Atlas is worth reading only while what it says agrees with the project it
explains. This page explains why keeping it so takes work of its own, what
Atlas can and cannot tell about it, and the means it offers: stamps on what
was read, a report of what went stale, readers who were not there, and Checks.

## Nothing in the project tests an Atlas

An Atlas binds nothing in the project it explains, so nothing in that project
tests it. It stays true through how it is changed and how it is read ([Keeping
an Atlas true](../../spec/SPEC.md#keeping-an-atlas-true)). When a Point
drifts from the document it explains, nothing in the project fails, and the
wrong Point stays wrong until a reader finds it ([Keep it
true](../../spec/OPERATING.md#keep-it-true)).

## Three claims, three kinds of evidence

Structural validity, agreement with the sources and usefulness to a reader are
distinct claims, each with its own evidence. Validation establishes the first.
The second is established by reading statements against the material they
cite, and the third by readers who have only the Atlas. An author's own reading
of their change establishes neither of the last two, and nothing may present
one of these claims as another ([Keeping an Atlas
true](../../spec/SPEC.md#keeping-an-atlas-true)).

Atlas itself establishes only the first. A candidate that validates is well
formed, and that says nothing yet about whether it is true or useful ([Change:
prepare whole, review,
apply](../../spec/OPERATING.md#change-prepare-whole-review-apply)).

## Stamps and the stale report

A source reference may carry a stamp: the hash of the cited material as it
stood when the explanation was last checked against it. A stamp that no longer
matches shows that the material changed. That is a reason to read the
explanation again. It does not establish that the explanation is false, and a
matching stamp does not establish that it is true ([Sources and
Types](../../spec/SPEC.md#sources-and-types)). For a local Markdown file
cited with a fragment, the cited material is the named section, so a reference
to a section goes stale only when that section changes ([Source
reference](../../spec/spec/FORMAT.md#source-reference)).

[`stamp`](../reference/cli.md#stamp) prepares an ordinary change that records
the current hashes; nothing is stamped until it is applied. A stamp records
what the maintainer checked the explanation against, so a maintainer stamps a
Point after reading it against its sources, not before
([Sources](../../spec/spec/OPERATIONS.md#sources)).

[`stale`](../reference/cli.md#stale) reads the local sources within the grants
and gives each reference one status: `current`, `changed`, `missing`,
`denied`, `unstamped` or `remote`. It lists each changed or missing source
once, with the records that cite it, and rewrites nothing. One report reads at
most 10000 references and says how many it left unread. A stamped local source
that could not be read, for example because it lies outside the grants, is
`denied`, never `current` ([Sources](../../spec/spec/OPERATIONS.md#sources)),
and that says nothing about whether it changed. The Portal marks a `changed`,
`missing` or `denied` source on each page, and no other ([Marks come with
words](the-portal.md#marks-come-with-words)).

In the example in `examples/offline-notes`, all thirteen source references are
stamped and current. On a copy, a few words added to one sentence of the
brief's "Offline work" section put three of them in the report as `changed`:
the one that cites that section, from "Offline work stays on the current
device", and the two that cite the whole brief, from the Base Points of both
Trees. The other ten stay `current`. The report names three Points to read
again, not the whole Atlas.

## Readers who were not there

An author cannot see the gaps in their own explanation, so the guide asks for
separate readers, each with one job: an auditor who reads the changed Points
against their sources, question readers who have only the Atlas, and a whole
reader who reads one account from top to bottom ([Keep it
true](../../spec/OPERATING.md#keep-it-true)). The auditor gives the
second of the three claims its evidence, and the question readers the third.
Readers are wrong too, and findings do not reach zero, so the guide has each
finding checked against the files and each round decide in advance what ends
it. [Check an Atlas with fresh readers](../how-to/check-with-fresh-readers.md)
gives the steps.

## Checks

A Check states a requirement that changes to the Atlas must meet, how to verify
it and what failure means. Checks are optional. A `required` Check must pass, by
the reviewer's report, before whoever authorizes a change applies it; an
`advisory` one informs that decision without deciding it ([Style and
Checks](../../spec/SPEC.md#style-and-checks)). Only active Checks
govern. The reviewer verifies an applicable Check against the exact candidate
and reports `pass`, `fail` or `unable` with its evidence to whoever authorizes
the change ([Checks](../../spec/spec/OPERATIONS.md#checks)).

Atlas establishes only that a Check is well formed. It lists every Check with
its complete text and status, and never evaluates one or runs an evaluator.
That fits the three claims: whether a change agrees with its sources, or serves
a reader, is a reader's finding, which validation cannot establish.

The [shipped Checks](../../checks/README.md) ask for those two
findings, and a project adopts one by copying its file into the Atlas's
`.checks/` folder. `evidence-review` requires that every changed statement
stay within the material it cites, read by someone who did not write the
change; `reader-questions` requires that readers with only the Atlas can answer
the questions it is kept to answer. The shipped example keeps no Checks.
