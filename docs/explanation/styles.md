# Styles

A Style is an Atlas's own statement of how it is written. This page explains
why every Atlas has exactly one, what it decides, and why changing it is the
owner's decision and a change of its own.

## Why an Atlas says how it is written

Several ways of organizing an account satisfy the specification. An Atlas
states its own in its Style: which accounts it keeps and what each owns, how
much of the argument it carries apart from its sources, and its own writing
conventions. Authors read and apply it when they place, develop and review
knowledge, and a Style cannot relax anything the specification requires
([Style and Checks](../../spec/SPEC.md#style-and-checks)).

Without a Style, every author would settle these questions again, and two
reasonable answers would leave one Atlas organized two ways. With one, each
later author has the same basis for placing a claim and for deciding how much
to explain ([Atlas Styles](../../styles/README.md)). The guide tells an
agent to apply it even when another arrangement also looks reasonable ([Shape:
where a claim belongs](../../spec/OPERATING.md#shape-where-a-claim-belongs)).
The craft every Atlas shares stays in the guide; a Style holds only what
differs from one Atlas to the next.

## Two choices: accounts and depth

The [curated catalogue](../../styles/README.md) offers six Styles, made
of two independent choices.

**Accounts** decides which Tree owns an explanation. Perspectives divide the
project by the questions an account answers, so the same capability appears in
several Trees and each owns different claims about it. Subjects keep everything
about one durable subject in one Tree. Synthesis gives one central Tree the
project's integrated argument, while supporting Trees each make a complete
argument of their own.

**Depth** decides how much of the argument the Atlas carries. An explanatory
Style develops the main arguments in the Atlas, so a reader can understand one
before opening a source; keeping that argument true costs a reading whenever
the material changes. A concise Style keeps each claim, its essential reason
and its qualifications, and sends the reader to a named place in a source for
the extended argument. Depth sets no word count and no Tree size.

These two choices explain the catalogue's six entries; they do not exhaust
what a Style can settle. A project adds its own conventions as they settle,
such as its vocabulary or how it marks a statement no source states.

The example in [`examples/offline-notes`](../../examples/README.md) follows
Explanatory perspectives. Its [`style.md`](../../examples/offline-notes/style.md)
has two sections, Accounts and Depth. Under it, Product experience and Storage
and delivery each own their claims about the same notes, and two Facets say how
the technical claims limit Product's promises. The [worked
comparison](../../examples/styles.md) applies all six Styles to the same
material. Under a subjects Style, one Offline notes Tree holds the experience,
the mechanism and the evidence together, and needs no Facet to move between
them.

## One Style, kept in the Atlas

An Atlas has exactly one Style, kept with it as authored content ([Style and
Checks](../../spec/SPEC.md#style-and-checks)). It is the file `style.md`
at the Atlas root: a title and a body, with no header. Its exact local bytes
are authoritative, and a title shared with a curated Style is a label, not a
reference to it ([Style](../../spec/spec/FORMAT.md#style)). A change to
a curated definition elsewhere cannot alter it. Opening an Atlas captures the
Style with the rest, so its bytes take part in the Atlas's identity,
comparison and validation ([Reading](../../spec/spec/OPERATIONS.md#reading)).

The Style lives in the Atlas because it must be the one the authors applied.
If the Atlas pointed at a catalogue entry instead, an update to the catalogue
would change how the Atlas is written without anyone deciding it.

A new Atlas starts with a curated Style named by its ID, or one written in full
by the project. [`init`](../reference/cli.md#init) prepares it as an ordinary
change, so the choice is visible in the draft before anything is applied. An
application may recommend a Style but may not choose one silently ([Project
workflow](../../spec/spec/PROJECT.md)); [`styles`](../reference/cli.md#styles)
lists the curated ones.

Readers of the Portal do not meet the Style: it has no page in the Atlas as it
is. A proposed change that alters it names it under "How this Atlas is
written" and shows it as proposed, with what differs marked, so the owner can
read that change. An agent reads it with
[`inspect style`](../reference/cli.md#inspect).

## Changed alone, by the owner

Changing the Style is the owner's decision. It is made as a visible change of
its own, with its consequences for the existing accounts reviewed, and never
as a side effect of other work ([Style and
Checks](../../spec/SPEC.md#style-and-checks)).

Preparation holds the "of its own" part. A change that alters a valid Style
alters no other file, and a change that mixes the two is invalid, with the
diagnostic `STYLE_CHANGE_ALONE`. A Style that does not validate may be
repaired together with the rest, so a broken Atlas can be made whole in one
change ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).
That the decision is the owner's is not something Atlas can check. It is the
specification's rule and the guide's instruction to the agent.

Kept alone, a new policy is read by itself, not folded into edits that look
ordinary, and the existing accounts are brought into line by later changes
written to it. [Change the
Style](../how-to/change-the-style.md) gives the steps.
