# Read an Atlas

Use the Portal to move from an overview to the detail behind it. The Editor uses
the same navigator and adds authoring controls.

## Open the Portal

For a local Atlas folder, start the read-only service:

```sh
atlas --root /path/to/atlas serve
```

Open the printed URL and keep the terminal running. If someone gave you an
exported site, open its hosted URL instead. An export contains the material its
author selected at export time.

## Follow an explanation

Choose a **Tree**, then select its **Base Point** for the subject and overview.
Select a lower Point or a development in the reading pane to read more detail. The breadcrumbs above its explanation
lead back through its context. A Branch opens a list of its children.

Use **Fit** to frame the Tree, the zoom buttons to change scale, and drag the canvas
to move around. The canvas accepts arrow keys; Points and Branches can be reached
as keyboard buttons. Narrow windows show a vertical Tree and a page drawer.

**Find in this Tree** filters Point titles and explanations in the current Tree.
**Type** narrows them to decisions, observations or untyped Points. Ancestors stay
visible so matches retain their context. Clear filters to see the complete Tree.

**Search Atlas** searches Point and Facet explanations and uncertainty across
all Trees. Results distinguish Points from interpretations and preserve a Facet's
owning Tree, host and targets. It returns literal excerpts with standing and dates
where applicable; select a result to read its full context. Source file contents
require a separate read. Exact IDs take precedence. **Focus reading** expands the explanation; **Show Tree**
restores navigation.

## Follow a connection

**Through another Tree** shows Facets attached to the selected Point or Branch.
Read why the connection matters, then follow a target to its account. Use **Back**
to return. A Facet on a surrounding Branch describes that larger group; assess how
its explanation applies to the Point you are reading.

**From the broader explanation** exposes Facets on ancestor Points separately
from those attached directly to the selected Point. Their scope remains explicit.

**Referenced by other accounts** opens the incoming Facet itself, with its owner,
host, interpretation and targets. **Cited by** lists direct Markdown mentions.
These are leads for understanding consequences, not proof of dependency.

## Inspect support

Read any uncertainty, decision status or observation date alongside the claim.
Under **Sources**, inspect the source's role, revision and locator when supplied.
Choose **Read** for a local source or **Open ↗** for a web reference. Local
Markdown sources open as readable prose; **Exact source text** retains exact text.
Included Markdown in an exported site has a readable page and a raw-text copy.

A local read may report that the source is missing, outside the permitted folders,
or different from its recorded hash. Treat that as a gap in available support.
The launcher controls source access; the [CLI reference](reference/cli.md) explains
how to permit an additional folder.

An exported site marks excluded Points and Facet targets as **Not published** and
excluded source files as **Source not included**. A visible citation does not mean
the source bytes were included. Ask for the relevant material when you need it.

**Review sources** lets you explicitly inspect selected declared sources within
the launch grants. Results distinguish current, changed, missing, denied and
uninspected bytes. The comparison uses recorded content hashes and any prior read
retained in private project storage across sessions. A changed source identifies its citing explanations for
review; it does not automatically invalidate or rewrite them. Remote sources
remain uninspected. Record whether the inspected bytes need review, leave the
explanation unchanged after review, or led to an update, along with the reason.
A later source change requires a new assessment; prior review is not proof of truth.

Use **Refresh** to reload the local Atlas after changes. To assemble reading around
a specific question across Trees, [ask a connected agent to Route](working-with-agents.md#ask-for-an-explanation).
