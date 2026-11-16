# What an Atlas is for

An Atlas is an explanation of a project, kept in plain files beside it. A
reader can descend it from an account's top claim to the detail that supports
it, and the agents who keep it can keep it true
([specification](../../spec/SPEC.md)). This page says who it serves,
what it leaves to the project's own documents and code, and what it means that
it binds nothing in the project.

## An explanation a reader can descend

An Atlas explains its project in Trees; a new Atlas has none until its first is
added. Each Tree owns one account of the project: one
subject seen from one perspective, with the account's top claim in its Base
Point ([Atlas and Tree](../../spec/SPEC.md#atlas-and-tree)). Each Point
states one claim in its title and explains it in its body, and it develops
into the Points that its claim depends on, qualifies or details. A higher Point
says what the Points beneath it establish together
([Point](../../spec/SPEC.md#point)). So a reader can start at the top of
a Tree, or from a question, and go down only as far as they need. Where they
stop, they still have an explanation of what lies beneath.

The shipped example, [`examples/offline-notes`](../../examples/README.md),
explains a fictional notes app in two Trees. Its Product experience Tree opens
with "Writers can keep working on notes when the connection drops". A reader
who wants more goes down to "Offline work stays on the current device", and
from there to the decision on the words the app shows. Each step narrows the
claim above it. [Trees, Points and Facets](trees-points-facets.md) explains
this shape.

## The reader

The reader has come to understand the product or the codebase the Atlas is
kept for, and may be a person or an agent
([specification](../../spec/SPEC.md)). People read in the Portal, where
each Point has a page of its own, complete without a script. An agent can
fetch the same pages, or read the same records through the CLI and the MCP
server, which expose the reading operations under the names the guide uses
([Product adapters](../../spec/spec/OPERATIONS.md#product-adapters)).
Reading changes nothing: the Portal presents an Atlas and writes nothing.
[The Portal](the-portal.md) explains how it is read.

## The maintainer and the owner

The maintainer is an agent, directed by the project's owner. It is handed
[Working with Atlas](../../spec/OPERATING.md), the guide that says how
to read an Atlas, how to write a Point worth reading and how to keep an Atlas
true. It also reads the Atlas's own Style, which says how this Atlas is
written ([Styles](styles.md)).

The agent writes a change as files and prepares it as a draft. A change is
prepared, validated and applied whole, and a change that fails validation is
never applied ([Keeping an Atlas
true](../../spec/SPEC.md#keeping-an-atlas-true)). The owner reads the
proposed change in the Portal, with what differs marked, and decides. Atlas
does not decide who may apply a draft. The guide tells the agent to apply only
on the owner's word ([Change: prepare whole, review,
apply](../../spec/OPERATING.md#change-prepare-whole-review-apply)), and
says that reading a source, preparing a change or passing a Check does not
authorize applying it ([Keep it
true](../../spec/OPERATING.md#keep-it-true)). [How changes
land](how-changes-land.md) explains that path.

## What it leaves to the sources

The project's documents and code stay useful on their own. An Atlas explains
them and leads back to them ([specification](../../spec/SPEC.md)). It
cites them and does not hold them: a source reference names the material an
explanation rests on or points to, with its role and where in it to look
([Sources and Types](../../spec/SPEC.md#sources-and-types)), and the
cited files are not among the Atlas's records. A reference is not proof. It
establishes neither that the explanation is true nor permission to read the
material.

How much of the argument an Atlas carries apart from its sources is its
Style's choice ([Style and Checks](../../spec/SPEC.md#style-and-checks)).
Under every curated Style, exact requirements, procedures, code and raw
evidence keep their authority in the sources
([Atlas Styles](../../styles/README.md)). The Atlas explains them; the
source still says exactly what they are.

In the example, a fictional brief and a fictional trial sit in a `sources/`
folder. The Point "One trial reopened an offline note after a normal restart"
says what the run showed and what it did not test, and cites the two sections
of the trial that state its conditions and its limits. A reader who wants the
record itself opens the source.

## It binds nothing

An Atlas binds nothing in the project it explains, so nothing in that project
tests it ([Keeping an Atlas
true](../../spec/SPEC.md#keeping-an-atlas-true)). Nothing in the project
fails when a Point drifts from its source, and a wrong Point stays wrong until
a reader finds it ([Keep it true](../../spec/OPERATING.md#keep-it-true)).
The specification makes an Atlas stay true through how it is changed and how it
is read. [Keeping an Atlas true](keeping-it-true.md) explains the means: stamps
on what was read, a report of what went stale, readers who were not there, and
the Atlas's own Checks.

Nor does an Atlas carry authority. Its records, source references and Checks
grant no file, network, credential, execution or publication authority
([Authority](../../spec/SPEC.md#authority)). What Atlas may read and
write is set by whoever starts it; [What Atlas may read and write](access.md)
explains how.
