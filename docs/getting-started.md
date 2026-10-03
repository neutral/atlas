# Start an Atlas

Open a project, give its knowledge a home, and write an explanation someone else
can use. This walkthrough creates a small Atlas for a fictional notes product.

For a working example first, take the [guided notes-app tour](../examples/README.md).
It follows a question from a product promise through a technical decision to a
qualified observation, using search, Facets and source reading.

## Open your project

[Install Atlas](install.md) and create an empty project folder for this walkthrough.
Open that existing folder:

```sh
atlas open /path/to/empty-project
```

Atlas opens the Editor and offers to create an Atlas in the empty folder. Keep
the terminal running while using the Editor. Press **Ctrl+C** in the terminal to
stop the service; run the same command to reopen the Atlas later.

From a source checkout with dependencies installed, use
`pnpm atlas open /path/to/empty-project` instead.

## Create the collection

If the selected folder has no Atlas, the Editor offers **Create Atlas**. Enter
`notes` as its **Stable ID** and `Notes` as its **Title**. Choose
**Explanatory perspectives** for this walkthrough. Read its organizing principle
and source-depth commitment, then select **Save and review**, inspect the proposed
manifest and local Style definition, and select **Apply draft**.

[Styles](../spec/SPEC.md#style) are complete organizing policies.
**Concise subjects** is the other curated choice, and you can supply a custom
complete definition. The chosen Style governs the whole Atlas until you explicitly
revise or replace it; later catalogue updates leave your adopted copy unchanged.

Opening a project without an existing Atlas offers creation in the project folder
itself. Use `--atlas` with an existing subfolder if you want a separate location.

## Write the first Tree

Select **Create Tree** and enter:

| Field | Example |
| --- | --- |
| Stable ID | `product` |
| Title | Product |
| Subject and scope | Who Notes serves and the experience it promises. |
| Base Point explanation | Notes helps field researchers capture observations when a network is unavailable. This account explains the work they need to complete and the limits of the product's promise. |

Select **Save and review**, then **Apply draft** after checking the result. The Tree
appears with its Base Point. Select that Point to read the explanation.

## Develop one part of the explanation

Open **Drafts**, then **New Point**. Choose Product as the **Owning Tree** and its
Base Point under **Develop beneath**. Enter:

| Field | Example |
| --- | --- |
| Stable ID | `offline-work` |
| Title | Capture observations without a connection |
| Explanation | A researcher needs to write and revise notes while disconnected. The product should make saved work visible and preserve it when the app closes. Synchronizing with other devices is a separate part of the experience. |

Save, review and apply. The new Point appears beneath the Base Point. Stable IDs
keep references usable when you improve titles or wording; choose them for the
subject the Point will continue to explain.

## Read it as someone new to the project

Select **Search Atlas** and search for `offline`. Open the Point you just wrote,
then select **Focus reading**. Can a reader tell what is promised, why it matters
and what remains uncertain? Use **Show Tree** and the breadcrumbs to return to
the overview and check that it introduces the detail well.

As evidence arrives, cite its source and qualify the explanation. When another
perspective changes how the promise should be understood, add a Tree for that
account and a Facet explaining the connection. The [example tour](../examples/README.md)
shows these next steps in a complete, small Atlas.

You now have an overview and a useful detail beneath it. Continue with
[organizing knowledge](organizing-knowledge.md) to decide what deserves another
Point, Branch or Tree, or [editing](editing.md) to add sources and connections.
