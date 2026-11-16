# Examples

Start with a question: **when can a writer trust that an offline note is saved, and
what does that say about other devices?** `offline-notes/` answers it in two
Trees, six Points and two Facets, with every source reference stamped. The
notes app, its brief and its trial are fictional. They are there to show how
meaning, decisions, evidence and uncertainty stay connected.

The example follows [Explanatory perspectives](offline-notes/style.md): Product
experience and Storage and delivery each own their claims about the same notes,
and the Atlas carries the main arguments. [The same material in six
Styles](styles.md) compares it with the other curated Styles.

## Open the example

From a source checkout, with dependencies installed:

```sh
pnpm atlas open examples/offline-notes
```

From an installed package, open the copy inside it. Reading writes nothing, so
the package stays as it was:

```sh
atlas open "$(npm root --global)/@neutral/atlas/examples/offline-notes"
```

For a project-local installation, use
`npx atlas open node_modules/@neutral/atlas/examples/offline-notes`. The Portal
opens in your browser; keep the terminal running, and stop it with `Ctrl+C`.

## Follow the answer

1. On home, under **Product experience**, open the top Point, **Writers can keep
   working on notes when the connection drops**. Its prose links to **Offline work
   stays on the current device**; follow it.
2. Read that Point's **Uncertainty**: only one normal restart has been observed.
   In the margin, under **Facets seen from Storage and delivery**, open **The
   offline promise rests on one normal restart** with its `▸`. It opens under the
   Point as a panel, a Facet: what the other Tree means for this one.
3. In the panel's margin, under **In Storage and delivery**, open **One trial
   reopened an offline note after a normal restart**. It opens inside the panel.
   It is an Observation, dated 20 September 2026, and its uncertainty keeps the
   untested cases. Open **2 sources**: the trial's conditions and its
   limits, each a section of `sources/trial.md`. Read that file: it supports a
   narrow result, not crash recovery or delivery.
4. Press `/` and search for `receipt`. Go to **Delivery is reported only after the
   server acknowledges the same revision**. The line above the title says
   **Decision · selected**: the rule was chosen, which does not mean it was built.
   This Point is where the Atlas states what a receipt establishes.
5. In its margin, under **Referred to by**, open **The delivery wording depends on
   the receipt rule**. Its margin names the Point it is said of, **A note is
   “Saved on this device” until a server receipt makes it “Sent for sync”**. Go
   there to see why the two wordings mean different things.

The answer takes both Trees. A local save, a normal-restart observation and a
server receipt each establish something different. The Facets say what one Tree
means for the other; the sources show the basis. **Outline**, at the top of every
page, shows both Trees whole when you want to jump, and **?** beside the search
field explains these words and the marks.

## Try a change on your own copy

Copy the example first, so the shipped one stays as it is:

```sh
cp -R examples/offline-notes my-notes
atlas --root my-notes candidate
```

Edit a Point in `my-notes/.atlas-candidate/`, then validate the copy and prepare
the change:

```sh
atlas --root my-notes validate --from .atlas-candidate
atlas --root my-notes prepare --from .atlas-candidate --reason "Say what you changed and why."
atlas open my-notes
```

The Portal lists the draft under **Proposed changes**. Its page shows what differs,
what else to read, and the command that applies it. Then edit a section of
`my-notes/sources/brief.md` and run `atlas --root my-notes stale`: the Points that
cite that section, and the two that cite the whole brief, are listed as
`changed`, and the Portal marks the source "changed since this was checked" on
their pages. Points that cite other sections stay current. [Ask your agent for a
change](../docs/how-to/ask-for-a-change.md) and [Keep an Atlas true as the
project changes](../docs/how-to/keep-it-true.md) give the same path step by step.
