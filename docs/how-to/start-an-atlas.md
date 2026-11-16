# Start an Atlas

Use this guide when a project has no Atlas yet.

You choose where the Atlas lives and how it is written. Atlas prepares it as a
draft and writes nothing until you have read the draft and applied it. Here
`PROJECT` is your project's directory. From a source checkout the command is
`pnpm atlas`, run from the repository root
([Install Atlas](install.md#from-the-source-checkout)).

## Decide where it lives

An Atlas is a folder of plain files. Keep it in a folder of its own in the
project, such as `atlas/`:

```sh
mkdir PROJECT/atlas
```

From here on `ATLAS` stands for that folder, `PROJECT/atlas`.

Once the folder holds an Atlas, `atlas open PROJECT` finds it by searching the
project. The search skips hidden folders and folders such as `node_modules`,
`dist` and `tmp` ([Discovery](../reference/configuration.md#discovery)). To
name the folder instead, write `atlas.workspace.json` at the project's root:

```json
{ "format": 1, "atlasPath": "atlas" }
```

`atlas locate PROJECT` says which folder the project selects, and how:

```text
  "source": "workspace",
```

`"atlasPath": "."` makes the project's folder itself the Atlas. The file's
rules are in [The workspace file](../reference/configuration.md#the-workspace-file),
and the order in which a project selects its Atlas in the
[project workflow](../../spec/spec/PROJECT.md).

## Choose a Style

The Style is the Atlas's own statement of how it is written: which accounts the
Atlas keeps and what each owns, and how much of the argument it carries apart
from its sources.
Your agent follows it in every change, and no Style is chosen for you. Why an
Atlas keeps one is in [Styles](../explanation/styles.md).

List the curated Styles, then read one:

```sh
atlas styles
atlas styles show explanatory-perspectives
```

`atlas styles` lists each Style's `id` and title. `atlas styles show`, given
an `id`, prints the exact text the Atlas adopts as its `style.md`. The
[catalogue](../../styles/README.md) explains the two choices, and the
[worked comparison](../../examples/styles.md) applies all six Styles to the same
material.

## Prepare it

Choose the Atlas's ID and title, and give the Style's ID:

```sh
atlas --root ATLAS init --id notes-app --title "Notes app" --style explanatory-perspectives
```

This saves a draft and writes nothing in `ATLAS`. The draft's `id` and
`revision` stand at the top of what it prints; they are `ID` and `REV` below:

```text
  "id": "fbb6f0c5-40f7-4345-bd52-77188ecfecd9",
  "revision": "094ff0a8fae0ce31233f073d2da595ebdb7f623e91a8fa81312d8a349e2fabe9",
```

The draft writes two files, `atlas.json` and `style.md`. A Style of your own is
given as the path of its file; see [`init`](../reference/cli.md#init).

## Read it and apply it

Open the Portal on the new Atlas, and keep it running (Ctrl+C stops it).
`--root` names its folder, since until the draft is applied the project holds
no Atlas for `atlas open PROJECT` to find:

```sh
atlas --root ATLAS open
```

Until the draft is applied the folder holds no Atlas, so home says "No Atlas
here". Under "Proposed changes" it lists the draft, "Initialize Atlas with its
selected Style", and under it "a new Atlas · prepared" and the moment. With a
workspace file, `atlas open PROJECT` shows the same.

The draft's page says "Ready to apply". Under "What differs", "This Atlas" is
marked new, and "How this Atlas is written" names the Style, whose page shows
its text. Under "To apply" stands the command that applies the draft.
`atlas --root ATLAS review ID` prints the same effects as JSON.

Apply it:

```sh
atlas --root ATLAS apply ID --revision REV
```

```text
  "status": "complete",
```

`ATLAS` now holds `atlas.json` and `style.md`, and the draft is gone. Why a
change waits as a draft and is applied at the revision you read is in
[How changes land](../explanation/how-changes-land.md).

Check the Atlas:

```sh
atlas --root ATLAS validate
```

```text
  "status": "ready",
```

`atlas open PROJECT` now shows the Atlas's home, with its title, "Notes app",
and no Trees yet.

## Next

Your agent writes the Atlas's Trees and Points. [Connect it](connect-an-agent.md),
then [ask it for the first Tree](ask-for-a-change.md): what the Atlas is for,
who will read it, and which of the project's files to read.
