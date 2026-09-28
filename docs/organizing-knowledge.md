# Organize knowledge

Start with an account someone needs to understand: how a product should behave,
why a system is built a certain way or what a team can promise its customers.
Choose a real question and write enough context for another person to answer it.

An Atlas is a collection of Trees. Each Tree develops one account through Points
at increasing levels of detail. Branches group related developments, and Facets
explain connections to other Trees. Source references lead back to the material
behind an explanation.

## Choose a Tree's scope

Give each Tree a subject and perspective. Its Base Point explains that scope and
the main things a reader should understand before following the detail.

A Tree can follow a product area or a discipline. For a notes application,
**Offline work** could cover the complete capability. In a larger project,
**Product** might explain the required experience while **Architecture** develops
storage and synchronization. Choose the boundary that gives each contribution a
clear home and lets the account develop coherently.

Split a Tree when the resulting accounts each need their own overview, reasoning
and ongoing maintenance. Develop a subject inside its existing Tree while that
perspective explains it well. A small Atlas can begin with one Tree and its Base
Point.

## Develop Points from overview to detail

Write a Point when an explanation deserves its own reference or revision. Give it
a title that says what the reader will learn. Include the scope, reasoning,
sources and uncertainty needed to understand it independently.

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
affected higher explanations and connected accounts. [Work with an agent](working-with-agents.md)
describes how Absorb supports that review; the [specification](../spec/SPEC.md)
defines the model precisely.
