# Examples

Start with a question: **When can a writer trust that an offline note is saved,
and what does that say about other devices?** `offline-notes/` develops the answer
through two Trees, six Points, one Branch and two Facets. The notes app, brief and
trial are fictional. Their purpose is to show how meaning, decisions, evidence
and uncertainty stay connected.

The example adopts [Explanatory perspectives](offline-notes/style.md), captured
locally in its `atlas/1.1` collection. Product and Architecture develop distinct
accounts while the important reasoning and qualifications remain readable in
Atlas. [The same material in six Styles](styles.md) compares explanatory and
concise accounts organized by perspectives, subjects, or a central synthesis with
complete supporting accounts. Each is a complete policy for a separate Atlas;
the included example retains its captured definition.

## Open the example

From an Atlas source checkout with dependencies installed:

```sh
pnpm atlas --root examples/offline-notes serve
```

For an installed package that includes this example, point the same read-only
command at its `examples/offline-notes` folder. A project-local npm installation
uses:

```sh
npx atlas --root node_modules/@neutral/atlas/examples/offline-notes serve
```

Open the printed URL and keep the terminal running. To edit the example, copy
`offline-notes/` to your own project folder and run `atlas open` on that copy.
Keep authored work outside the installed package.

## Follow the answer

1. Choose **Product experience**, then **Read overview** to open **Keep writing
   when the connection drops** (`product-purpose`). Follow its
   **Offline work** link. The Tree shows where the detail belongs; the link takes
   you directly to the explanation.
2. In **Offline work stays on the current device** (`offline-work`), select
   **Focus reading**. Read the uncertainty beside the claim, then follow
   **evidence qualification**. This opens the exact Facet, **Editing availability
   has limited evidence**, attached to the broader **Working without a
   connection** Branch.
3. Follow that Facet's **local observation** link into **Storage and delivery**.
   **The trial reopened an offline note** (`local-persistence`) is a dated
   observation, with the normal-restart conditions intact. Follow **trial record**
   to read the source as prose; **Exact source text** shows the original Markdown. The
   source supports a narrow result, not crash recovery or delivery.
4. Close the source document, select **Search Atlas** and search for `receipt`. Open
   **Require a receipt before reporting delivery** (`sync-policy`). Its
   **selected** decision status records the chosen rule. Its uncertainty keeps
   implementation and cross-device delivery questions visible.
5. Under **Referenced by other accounts**, open **The delivery promise depends
   on a receipt**. The incoming Facet explains Product's interpretation and
   identifies its host, **Say saved locally until delivery is confirmed**
   (`delivery-promise`). Follow the host to see why **Saved on this device** and
   **Sent for sync** mean different things.

The answer requires both perspectives. A local save, a normal-restart observation
and a server receipt each establish something different. Facets explain the
consequences between accounts; source links let you inspect their basis. **Cited
by** also exposes direct mentions as leads for further reading, without turning
every mention into a dependency.

## Try a review on your own copy

In the Editor, open **Review sources**, select the fictional brief and inspect it.
Make a small change to your copy of `sources/brief.md`, then inspect the same
source again in that browser session. The source review reports changed bytes and
shows which explanations cite them. Read those explanations before deciding what
needs revision; a changed file alone does not say which claim became wrong.

Edit a Point and select **Save and review** to see its surrounding explanations,
direct citers and file changes together. Leave the draft saved if you want to
return later. [Editing](../docs/editing.md) explains applying a reviewed change;
[working with an agent](../docs/working-with-agents.md) covers proposals that also
retain Absorb reasoning and unresolved questions.
