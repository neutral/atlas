# Edit and review knowledge

Open the project with `atlas open /path/to/project`. The Editor saves proposed
changes as drafts so you can review the complete result before applying it.

## Change an explanation

Select a Point, then **Edit Point**. Update its title, explanation or uncertainty
and give a reason for the change. Use the citation controls to add, revise or
remove source references while keeping their roles and evidence limits. A decision also shows **Decision status**; an
observation shows **Observed at**.

Select **Save and review**. Inspect **Meaning and placement to review**, related
explanations, direct citations and any unresolved links. Expand **File changes**
to read the **Before** and **After** content for every changed file and resolve any validation errors. Check that the explanation stays
within its evidence and that its surrounding context still makes sense. Select
**Apply draft** when the result is ready. The navigator refreshes after application.

A draft made through Absorb retains the reasons for each contribution, unresolved
questions and optional preservation accounting. **Review candidate Checks** lets
you record outcomes, reasons and evidence against this candidate before applying.
Those records remain visible when the saved draft is reopened. They do not
approve application.

Use **Read proposed changes** to compare rendered explanations, qualifications
and sources. Use **Browse complete candidate** to follow the proposal in the normal
reader, including its Trees, detail and Facets. The candidate banner distinguishes
this proposed content from the current Atlas; return to the draft review to apply
its exact revision.

Under **Source byte requirements**, inspect a cited local source and explicitly
choose **Require these source bytes when applying** when your change depends on
that version. Inspection alone selects nothing. For a newly added citation, save
first and reopen **Continue editing** to inspect its candidate source. Changed
required bytes stop application without rewriting the explanation.

Select **Move file** on a Point to prepare a move within its owning Tree. Atlas
keeps the ID and repairs safely located inline path links in one draft. Complex
links that cannot be repaired exactly stop preparation for manual review.

## Add detail or a connection

Open **Drafts** and choose **New Point** or **New Tree**. A new Point needs an
**Owning Tree** and a position under **Develop beneath**. Use
[organizing knowledge](organizing-knowledge.md) to choose its scope and placement.

To connect an existing Point to another Tree, select **Attach a Facet**. Choose
**Through this Tree** and a **Relevant Point**, then explain **Why the connection
matters**. Save and review the connection before applying it. This form requires
at least two Trees.

Use **Edit Facet** to revise an existing interpretation and its targets.
**Drafts → New Branch** creates a grouping; an existing Branch offers **Edit Branch**.
**Change position** moves a Point or Branch within its owning Tree and orders it
among siblings. **Remove or consolidate** on a non-Base Point lets you explain
removal and, when appropriate, name a surviving destination. Review the affected
interpretations and citations as part of the complete change.

For Types or advanced repairs, use **Drafts → Edit records**. It edits the Markdown
records and Tree outlines directly.
The [format reference](../spec/spec/FORMAT.md) defines their fields; a
[connected agent](working-with-agents.md) can also prepare these changes for review.

## Resume a draft

**Drafts** lists saved work. **Review** opens its proposal; **Continue editing**
opens its records; **Discard** deletes that saved draft. Saved drafts survive a
restart and retain the Atlas version against which they were prepared. Continuing
to edit creates a new candidate. Earlier Absorb reasoning and Check evidence
remain under **Prior reasoning and evidence**, tied to the earlier proposal.
Revise the active reasoning and review the new candidate again; old evidence does
not verify changed bytes.

The Editor saves unfinished typing privately for recovery and shows its save
status. **Drafts → Recover typing** restores an available working copy, including
its original baseline; inspect any stale conditions before preparing a candidate.
A working copy is not yet a reviewed draft. Very recent input can be lost before
its recovery save completes, so use **Save and review** when a proposal is ready.
If you type while a save is running, save again to include the newer text.

## Handle a changed Atlas

Application stops if the Atlas or saved draft no longer matches the reviewed
version. Refresh, inspect the current content, and prepare a new draft that
accounts for those changes. Review that result before applying it.

Drafts, recovery records and retained Check reports live in private user storage.
Keep that storage private: it may contain complete source text. See
[authoring reference](reference/authoring.md#private-storage) for locations and
storage options.

## Recover an interrupted change

Open **Drafts** and look for **Interrupted change**. Review the affected work before
choosing **Restore original files**. Recovery restores the files' original content
after checking for later edits. It stops if an affected file has changed; inspect
the conflict before making another change. A change spanning several files can
stop partway through, which is why Atlas retains these recovery records.

## Review or change the adopted Style

Open **Style** to read the complete selected policy. In the Editor, revise
its captured definition or choose another complete curated Style, explain the
reason, and prepare the explicit Style change. A legacy Atlas can adopt its first
Style through the same reviewed proposal. Review effects on existing ownership,
source depth and reader paths before applying; software and catalogue updates do
not replace the adopted definition automatically.
