# Organize knowledge

Start with an account someone needs to understand: how a product should behave,
why a system is built a certain way or what a team can promise its customers.
Choose a real question and write enough context for another person to answer it.

An Atlas is a collection of Trees. Each Tree develops one account through Points
at increasing levels of detail. Branches group related developments, and Facets
explain connections to other Trees. Source references lead back to the material
behind an explanation.

## Follow the selected Style

Start by reading the Atlas's adopted Style. It settles both what Trees represent
and how much understanding the Atlas carries apart from sources. Several choices
can produce a coherent Atlas. The [catalogue](../styles/README.md)
explains their theory and provides six complete policies:

| Style | What a Tree owns | What readers understand in Atlas |
| --- | --- | --- |
| [Explanatory perspectives](../styles/explanatory-perspectives.md) | One perspective across shared subjects | The main argument, including reasons, alternatives and consequences |
| [Concise perspectives](../styles/concise-perspectives.md) | One perspective across shared subjects | Central meaning, essential reasons and limits, with fuller arguments in sources |
| [Explanatory subjects](../styles/explanatory-subjects.md) | One subject or capability with its relevant perspectives together | The main argument, including reasons, alternatives and consequences |
| [Concise subjects](../styles/concise-subjects.md) | One subject or capability with its relevant perspectives together | Central meaning, essential reasons and limits, with fuller arguments in sources |
| [Explanatory synthesis](../styles/explanatory-synthesis.md) | The integrated argument in one central Tree; complete scoped arguments in supporting Trees | The main arguments and why they support or qualify the integrated conclusions |
| [Concise synthesis](../styles/concise-synthesis.md) | The integrated argument in one central Tree; complete scoped arguments in supporting Trees | Essential reasoning between the accounts, with extended arguments in sources |

Choose ownership according to which accounts need to develop and change together.
Separate Product and Architecture Trees can each explain their perspective across
several capabilities. An Offline notes Tree can instead bring that capability's
experience, mechanisms and evidence together. A shared claim has one home under
either policy; other Trees explain its consequences through Facets. Within a
subject Tree, distinct claims, disagreements and dated observations retain their
own explanations as needed.

Use a synthesis policy when one account should maintain the project's integrated
conclusions. State that central role in its scope and Base, and give supporting
Trees their own scopes, arguments and conclusions. The central account must explain
how the arguments combine and which tensions remain. Facets expose the relevant
connections without assigning the supporting accounts agreement with the central
interpretation. A changed supporting finding prompts review of the affected
integrated conclusion; it does not require rewriting either account to make them
agree.

Choose depth according to the understanding readers need before opening sources.
Explanatory policies bring the important argument into Atlas. Concise policies
expect readers to consult sources for extended arguments while retaining the
reasons and qualifications needed to understand the account. Both can use a short
Point or develop a large Tree. Each complete definition also settles when to
separate Points, how to group and connect them, and when to reconsider structure.
The [same-source example](../examples/styles.md) shows each policy's placement,
depth and response to an update.

One complete Style governs the Atlas and stays selected during ordinary work.
Trees can vary in size and shape within it. Users can revise or replace the local
definition deliberately, reviewing the effect on existing accounts; an update to
the curated catalogue does not silently change it. A legacy Atlas remains usable
without a Style and can adopt one in a reviewed migration.

A custom Style settles the same authoring choices in one complete definition.
Use one when the needed policy differs from the curated choices. Its ownership,
development, source-depth and maintenance rules govern the whole Atlas just as a
curated definition does.

Before adopting a Style for an existing Atlas, inspect the questions and claims
each Tree owns and the source reading its users need. Similar Tree titles can
support different policies. Accounts of machine promises, execution, evidence
and operations can develop several perspectives on one service; a subject account
can develop each capability with its mechanisms and evidence together. Adoption
can preserve the current outline when it already fits the selected policy.
Restructuring needs a concrete reading or maintenance reason.

## Choose a Tree's scope

Give each Tree a subject and perspective. Its Base Point explains that scope and
the main things a reader should understand before following the detail.

A Tree can follow a product area or a discipline. For a notes application,
**Offline work** could cover the complete capability. In a larger project,
**Product** might explain the required experience while **Architecture** develops
storage and synchronization. The selected Style resolves that organizing choice.
Choose boundaries within it that give each contribution a clear home and let the
account develop coherently; do not alternate policies whenever a new document
arrives.

Split a Tree when the resulting accounts each need their own overview, reasoning
and ongoing maintenance. Develop a subject inside its existing Tree while that
perspective explains it well. A small Atlas can begin with one Tree and its Base
Point.

## Develop Points from overview to detail

Write a Point when an explanation deserves its own reference or revision. Give it
a title that says what the reader will learn. Include the scope, reasoning,
sources and uncertainty needed to understand it independently. A useful summary
or orientation can deserve a Point. It need not invent a conclusion beyond its
sources to justify its existence.

A useful outline might be:

```text
Product
└─ Notes remain useful without a connection       Base Point
   ├─ Writers can create and edit offline         Point
   │  └─ Show whether changes are saved locally   Point
   └─ Collaboration resumes after reconnecting    Point
```

The higher Point explains the significance of the details beneath it. Sources
and reasoning establish support for that explanation. Review the higher account
when a detail changes its meaning.

Each Point has one owning Tree and one place in its outline. Keep its ID through
ordinary revisions so links continue to reach the same contribution. Create a
separate Point when a claim needs independent assessment or maintenance.

## Add a Branch when a grouping helps

A Branch has a label and a Tree-local ID. Use one when readers benefit from a
named group, such as **Failure and recovery**, containing related Points. Put an
explanation in a Point wherever that level needs a claim, rationale or summary.

Branches and Points can both contain further detail. Choose between them by the
job at that level: grouping related material or explaining it. The
[editing guide](editing.md) covers changes to the outline.

## Explain a connection with a Facet

Add a Facet when another Tree changes how the reader should understand a Point
or Branch. Name the relevant Tree and targets, then explain the connection.

For example, a Product Point promises that notes remain available offline. A
Facet can explain how that promise depends on Architecture's local-storage Point
and its retention limits. Product owns this interpretation; Architecture owns
the technical account. A reader can follow the connection and inspect its basis.

Create the Facet where the connection matters. A Facet on a Branch addresses that
group as a whole. More specific consequences need their own explanation or
connection. A direct link is enough when the reader simply needs another Point.

The [notes-app example](../examples/README.md) makes the distinction concrete.
Product links to its own wording decision so readers can follow the detail.
Its receipt Facet then explains why that wording depends on a rule owned by
Architecture. Architecture keeps the rule's reasoning and uncertainty in its own
Point. Each perspective remains useful on its own, and the connection says why
reading both matters.

## Give readers paths through the explanation

Link to a Point where its explanation helps answer the current question. Link
to a Facet when the reader needs the interpretation itself, and to a declared
source at the claim whose basis they should inspect. Use meaningful link text,
such as **the receipt policy** or **the trial's limits**, so the next step is clear.

In Markdown, record links are relative to the referring file; source headers use
paths relative to the Atlas folder. Declare a source in the owning Point or
Facet's header before linking to it in the body. The [reference guide](reference/references.md)
gives exact path and resolution rules. The Portal opens Point, Facet and declared
source links at their corresponding destinations.

Keep the prose intelligible without following every link. The explanation should
say what the connection contributes; the target provides the detail. **Cited by**
helps readers and authors return along direct mentions. A mention is a navigation
lead whose significance still needs interpretation.

## Decide how much to bring back from sources

Ask what a reader must understand without opening the source, using the selected
Style's commitment. Explanatory Styles bring the important rationale,
tradeoffs and consequences into Atlas. Concise Styles carry central meaning,
essential reasoning and qualifications while directing readers to fuller arguments.
Tree ownership determines where that understanding lives. All six preserve
source authority over exact requirements or procedures; none requires copying
exhaustive procedures, code listings or raw evidence. Explain what a source
contributes and provide a precise path to it.

In either synthesis Style, the central account explains why its conclusions follow
from the supporting arguments. Concise synthesis can leave their extended
development in sources while retaining essential connections and qualifications.
The selected depth policy governs the supporting accounts too.

Preserve meaning rather than wording. A shorter account is sufficient only if
its important conditions and distinctions survive. An unchanged paragraph is not
necessarily well placed just because it appeared in the original document.
Keep examples when they carry an otherwise easy-to-miss distinction, and keep
uncertainty beside the claim it limits.

## Keep sources and uncertainty useful

Reference the document, code, observation or other material behind a Point or
Facet. Include a section or other locator when it helps the reader find the
relevant passage. Retain the revision or a content hash when the particular
version matters. Explain which claim the material supports and any limits on it.

Use the optional **decision** Type for a choice with a recorded status, or
**observation** for a dated finding. A selected decision still needs evidence of
implementation; a dated observation describes what was seen then. Use an untyped
Point for other explanations.

As new material arrives, decide what it updates, contradicts or adds. Review
affected higher explanations and connected accounts. **Review sources** identifies
declared sources whose inspected bytes changed and the records that cite them.
Use that as a starting point for reading; determine which claims, conditions or
decisions are affected before revising their meaning.

When moving a Point's file, use **Move file** to keep its ID and review repaired
links together. When consolidating or removing knowledge, record why it no longer
needs its own place and which surviving explanation, if any, carries it forward.
For a substantial rebuild, an optional preservation review can account for a
chosen set of source material, including unresolved items.

[Work with an agent](working-with-agents.md) describes how Absorb retains those
judgments with a saved proposal. The [editing guide](editing.md) covers reviewing
the effects before applying; the [specification](../spec/SPEC.md) defines
the model precisely.

## Review a concrete problem, then stop

Try representative questions through the full candidate: can someone explain the
choice, follow an important qualification and find the evidence? Rehearse one
realistic update and identify the owning explanation, affected higher Points and
connected interpretations. Record what fails and what remains unexamined. A
successful rehearsal is useful evidence of the reviewed path, not proof that
unfamiliar readers benefit.

Recommend restructuring only with a concrete reading or maintenance problem,
expected benefit within the selected Style and a way to assess it. Another
plausible outline is not a defect. Stop when the intended paths work and no
consequential issue remains in the declared scope. The optional
[editorial review Check](../checks/editorial-style.md) turns this practice
into an explicit review obligation; structural validation alone cannot perform it.
