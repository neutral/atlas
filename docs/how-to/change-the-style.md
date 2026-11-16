# Change the Style

Use this guide when the Atlas's Trees or depth no longer fit.

The Style is the file `style.md` at the Atlas's root. It says which accounts
the Atlas keeps and what each owns, and how much of the argument the Atlas
carries apart from its sources. Changing it is the owner's decision, made as
a change of its own ([Style and Checks](../../spec/SPEC.md#style-and-checks)).
Why is in [Styles](../explanation/styles.md).

## Choose the new Style

Read the Style the Atlas has now, with `ATLAS` the Atlas's directory:

```sh
atlas --root ATLAS inspect style
```

```text
    "title": "Explanatory perspectives",
```

From a source checkout the command is `pnpm atlas`, run from the repository
root ([Install Atlas](install.md#from-the-source-checkout)).

List the curated Styles, and print the one you are considering:

```sh
atlas styles
atlas styles show concise-perspectives
```

The [catalogue](../../styles/README.md) explains the two choices they
combine, accounts and depth, and the
[worked comparison](../../examples/styles.md) applies all six to the same
material. A Style of your own is a Markdown file with one H1 title and a body
that states the policy ([Style](../../spec/spec/FORMAT.md#style)).

## Prepare it as a change of its own

Write the new `style.md` into a fresh candidate, check it and prepare it,
with nothing else changed. Ask your agent to do it, or run:

```sh
atlas --root ATLAS candidate
atlas styles show concise-perspectives > ATLAS/.atlas-candidate/style.md
atlas --root ATLAS validate --from .atlas-candidate
atlas --root ATLAS prepare --from .atlas-candidate --reason "Adopt Concise perspectives: keep each claim and its essential reason, and send readers to the sources for the extended argument."
```

For a Style of your own, copy its file to `ATLAS/.atlas-candidate/style.md`
instead. `validate` lists `style.md` alone under `changes`:

```text
  "changes": [
    {
      "path": "style.md",
      "action": "write"
    }
  ],
```

If the candidate changes any other file as well, the change is invalid, with
this diagnostic:

```text
      "code": "STYLE_CHANGE_ALONE",
      "path": "style.md",
      "message": "A change that alters the Style alters no other file. Prepare the Style change and the other changes separately."
```

`prepare` still saves such a draft, so it can be read, and exits with 1. Its
page in the Portal says "Invalid: it cannot be applied as it stands", and
`apply` refuses it with `INVALID_CANDIDATE`. Delete it with
`atlas --root ATLAS drafts delete ID --revision REV`, run `candidate` again,
and write the Style alone. When the current `style.md` does not validate, it
may be repaired together with other files
([The Style changes alone](../reference/changes.md#the-style-changes-alone)).

Read the draft in the Portal ([Ask your agent for a change](ask-for-a-change.md#read-the-proposed-change)).
Under "What differs", "How this Atlas is written" names the new Style's title,
marked "changed". Its page shows the new text, with each part that differs
marked and the earlier text behind "Before". Apply it with the draft's ID and
revision:

```sh
atlas --root ATLAS apply ID --revision REV
```

```text
  "status": "complete",
```

## Bring the Atlas into line

Applying the Style rewrites no Point. The Atlas still says what it said, in
the shape the old Style gave it. Ask your agent to read each Tree against the
new Style and to propose the changes it calls for, as later changes of their
own. Each is prepared, read and applied as in
[Ask your agent for a change](ask-for-a-change.md). With `style.md` out of
them, `STYLE_CHANGE_ALONE` no longer applies; every other rule of validation
still does. Under Concise
perspectives, for example, a Point keeps its claim, its essential reason and
the qualifications that limit it, and names the place in a source that holds
the rest.

Ask for one change per Tree or per concern, so that each reads on its own and
you can see it follows the new Style.

`atlas --root ATLAS inspect style` prints the new title, and each change that
follows it is read against the new Style.
