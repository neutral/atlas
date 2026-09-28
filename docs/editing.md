# Edit and review knowledge

Open the project with `atlas open /path/to/project`. The Editor saves proposed
changes as drafts so you can review the complete result before applying it.

## Change an explanation

Select a Point, then **Edit Point**. Update its title, explanation or uncertainty
and give a reason for the change. A decision also shows **Decision status**; an
observation shows **Observed at**.

Select **Save and review**. Read the **Before** and **After** content for every
changed file and resolve any validation errors. Check that the explanation stays
within its evidence and that its surrounding context still makes sense. Select
**Apply draft** when the result is ready. The navigator refreshes after application.

## Add detail or a connection

Open **Drafts** and choose **New Point** or **New Tree**. A new Point needs an
**Owning Tree** and a position under **Develop beneath**. Use
[organizing knowledge](organizing-knowledge.md) to choose its scope and placement.

To connect an existing Point to another Tree, select **Attach a Facet**. Choose
**Through this Tree** and a **Relevant Point**, then explain **Why the connection
matters**. Save and review the connection before applying it. This form requires
at least two Trees.

For source references, Types, Branches, rearrangement or deletion, use
**Drafts → Edit records**. It edits the Markdown records and Tree outlines directly.
The [format reference](../spec/spec/FORMAT.md) defines their fields; a
[connected agent](working-with-agents.md) can also prepare these changes for review.

## Resume a draft

**Drafts** lists saved work. **Review** opens its proposal; **Continue editing**
opens its records; **Discard** deletes that saved draft. Saved drafts survive a
restart and retain the Atlas version against which they were prepared.

Save explicitly before leaving. The Editor warns about unsaved form changes, but
a browser or process crash can lose text that has not been saved. If you type while
a save is running, save again to include the newer text.

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
