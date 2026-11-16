# Ask your agent for a change

Use this guide when the Atlas should say something new or different.

You tell your agent what you want. It writes the change and prepares it as a
draft. You read the draft and say apply. Nothing in the Atlas changes until a
draft is applied; why it works this way is in
[How changes land](../explanation/how-changes-land.md), and every input,
result and refusal is in the [changes reference](../reference/changes.md).

## Tell the agent what you want

Tell your agent three things:

- What the Atlas should say, or what it says wrongly.
- Where you think it belongs: a Point, or a Tree. The agent places it by the
  Atlas's Style and tells you if it belongs elsewhere.
- The sources: the file and the section that state it.

For example, on a copy of the shipped example: "The Point *Delivery is
reported only after the server acknowledges the same revision* should say
that a failed delivery stays visible to the writer. The brief's section *Save
and delivery states* says so."

Your agent follows the guide it is handed
([Change: prepare whole, review, apply](../../spec/OPERATING.md#change-prepare-whole-review-apply)).
Here is what it runs, with `ATLAS` the Atlas's directory and `PROJECT` the
project's, so you can do the same by hand. From a source checkout the command is `pnpm atlas`, run from the
repository root ([Install Atlas](install.md#from-the-source-checkout)).

1. It writes a fresh copy of the Atlas's records into
   `ATLAS/.atlas-candidate/`:

   ```sh
   atlas --root ATLAS candidate
   ```

2. It edits the copy with its own file tools, in the format the guide gives
   ([The files](../../spec/OPERATING.md#the-files)). A source is cited by
   its path from the Atlas's directory and, for a section, the heading's name,
   such as `../docs/design.md#sharing`.
3. It checks the copy, saving nothing, with the project granted so the check
   can read the files the Atlas cites:

   ```sh
   atlas --root ATLAS --allow-source-root PROJECT validate --from .atlas-candidate
   ```

   It looks for `"status": "ready"`, `"unreadSources": 0`, and empty
   `linkDiagnostics` and `missingSources`, which list broken links and cited
   files or sections that are not there. Without the grant, a source outside
   the Atlas's directory is not read: `unreadSources` counts it, and
   `missingSources` cannot list it.
4. It prepares the copy as a draft, with a reason that says what changed and
   why:

   ```sh
   atlas --root ATLAS prepare --from .atlas-candidate --reason "Say that a failed delivery stays visible, as the brief's delivery states require."
   ```

   The draft's ID and revision head what it prints:

   ```text
     "id": "0780e09f-f45f-4437-8988-4cd14dc23066",
     "revision": "8ae949a0cc0eb22643c3a49500cda9de2caea3c668a4113d58cb28f2fd931234",
   ```

Through the MCP server the same steps are `atlas_candidate`, `atlas_validate`
with `from`, and `atlas_prepare` with `candidate`, `baseline` and `reason`
([The MCP server](../reference/mcp.md#atlas_prepare)). The options are in
[`candidate`](../reference/cli.md#candidate),
[`validate`](../reference/cli.md#validate) and
[`prepare`](../reference/cli.md#prepare).

## Read the proposed change

Open the Portal with `atlas open PROJECT`, `PROJECT` being the project's
directory ([Read an Atlas](read-an-atlas.md#open-the-portal)). Home lists the
draft under "Proposed changes": its reason, and under it what it does and when
it was prepared, such as "1 Point differs · prepared 15 November 2026 at
13:52". A draft that cannot be applied says so first, in red: "Stale · 1 Point
differs · prepared …", "Invalid · …", or "Blocked · …" while no draft can be
applied, as while an interrupted apply awaits recovery. The Portal lists the
drafts kept in its state home, by default the same one your agent uses. If the agent's configuration sets
`ATLAS_STATE_HOME`, give that directory to every command on this page, `open`,
`drafts`, `review`, `apply` and `drafts delete`, with `--state-home` or by
setting `ATLAS_STATE_HOME` where you run them; otherwise they do not find the
draft ([Private state](../reference/configuration.md#private-state)).

Choose the draft's reason to open its page. The page is at `_/draft/ID/` under
the Portal's address, `ID` being the draft's ID, and holds:

- Whether it can be applied: "Ready to apply", or in red "Stale: the Atlas has
  changed since this was prepared", "Invalid: it cannot be applied as it
  stands", with what does not validate, or "Blocked:" and what blocks it,
  such as "Blocked: an interrupted apply needs recovery first"
  ([Recover an interrupted apply](recover-an-apply.md)) or "Blocked: the Atlas
  does not read whole" (run `atlas --root ATLAS validate` to see why).
- "What differs", by Tree: each Point and Facet the change writes, marked
  "new", "changed" or "removed", or "stamped" when only its stamps differ.
  When the Atlas as proposed does not validate, it names the files the change
  writes instead, under "Files".
- "What else to read": "Points above what differs" and "Other Trees' Facets
  that draw on what differs".
- "To apply", on a draft that is ready: the command that applies it. On one
  blocked by an interrupted apply, "To recover" in its place: the command that
  lists what to recover.

Choose a Point under "What differs" to read it as proposed. Each part of its
prose that differs is marked, and when the Atlas the draft was prepared
against validates, a changed part keeps its earlier text behind "Before".
"The Atlas as it is", in the strip, goes to the same Point as it stands now,
or to home for a Point the change adds. Then read what "What else to read"
names: a change beneath a Point
can leave it saying more than what stands under it supports. The draft page of
the example names the Point above, "Saving on the device and delivery to the
server are separate outcomes", and Product experience's Facet "The delivery
wording depends on the receipt rule". What every page of a proposed change
holds is in [A proposed change](../reference/portal.md#a-proposed-change).

From the terminal, `atlas --root ATLAS drafts` lists the drafts with their IDs
and revisions, and `review` prints the same effects as JSON:

```sh
atlas --root ATLAS review ID
```

```text
        "id": "sync-policy",
        "tree": "architecture",
        "changes": [
          "explanation"
        ],
```

## Apply it, or ask again

When the draft says what it should, apply it, with `ID` and `REV` from its
page's "To apply" line, from `atlas --root ATLAS drafts`, or from what
`prepare` printed:

```sh
atlas --root ATLAS apply ID --revision REV
```

```text
  "status": "complete",
```

A completed apply removes the draft and says `"draft": "removed"`. When it
says `"draft": "kept"`, as an apply that changes nothing (`"status": "noop"`)
does, delete the draft as below. The candidate folder stays in the Atlas's
directory until the next `candidate` replaces it; keep it out of version
control. Or tell your agent to apply it: it runs the
same command, or `atlas_apply` with `id` and `expectedRevision`. Either way,
give the revision you read: any other is refused with `STALE_DRAFT`. The other
refusals are in [`apply`](../reference/cli.md#apply).

A source carries no stamp until it is stamped, and the stale report never
calls an unstamped source changed. Once the change is applied, your agent
stamps the Points it read against their sources, as a draft of its own that
you apply the same way ([Stamp what was read](keep-it-true.md#stamp-what-was-read)).
When their stamps are already current, `stamp` answers `"status": "noop"`
and prepares no draft.
From then on the stale report tells you when those sources change.

If the apply is refused with `STALE`, the Atlas changed after the draft was
prepared, for example because another draft was applied. Nothing was written,
and the draft's page says "Stale: the Atlas has changed since this was
prepared". Ask your agent to prepare it again: a fresh `candidate`, the same
edit, `validate --from` and `prepare --from`. Without the fresh `candidate`,
both refuse the old folder with `STALE`: it holds the whole Atlas as it was,
and would undo the change applied in the meantime. Then delete the stale
draft.

To ask for something different, tell your agent what to change. It edits the
candidate folder again, without running `candidate`, which would replace the
folder and its edits, and prepares a new draft. Once the Atlas has changed,
by an applied draft or otherwise, that folder is stale too, and the edit is
made in a fresh `candidate`. The first draft stays as it was. Delete the one
you will not apply, with its ID and revision:

```sh
atlas --root ATLAS drafts delete ID --revision REV
```

```text
  "status": "deleted",
```

You have the change in the Atlas: the Portal shows the Point as you read it
under the draft, and once every draft you will not apply is deleted, home
lists no proposed changes and `atlas --root ATLAS drafts` prints
`"drafts": []`.
