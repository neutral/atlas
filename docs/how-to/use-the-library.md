# Use the Library from code

Use this guide when you build a tool on Atlas.

The Library holds the operations the `atlas` command, the MCP server and the
Portal share. This guide builds one short program, `change.mjs`, that opens an
Atlas, finds and reads a Point, and prepares and applies a change. Every
operation, by job, is in the [Library's README](../../library/README.md); the
inputs and results of each are declared in its types. Here `ATLAS` is the
Atlas's folder; the values shown come from a copy of the example,
`examples/offline-notes`.

## Install it

In your project's folder:

```sh
npm install --save-exact --ignore-scripts @neutral/atlas
```

The Library is the package's main entry, `@neutral/atlas`, and its types come
with it. It is an ES module, so import it from a `.mjs` file or from a package
whose `type` is `module`. It needs Node.js 22.23.2 or later. The other ways to
install the package are in [Install Atlas](install.md).

## Open an Atlas

`openAtlas` reads the Atlas whole and returns a view of it: its `status`, its
`identity` and its `diagnostics`, with every record. It writes nothing.

```js
import { openAtlas, route, prepareChange, saveDraft, applyDraft } from '@neutral/atlas';

const root = process.argv[2];

// Open the Atlas and find a Point.
const view = await openAtlas(root);
```

The Library reads sources only within the directories you grant, the Atlas's
folder by default. Drafts and recovery journals go to your user state
directory, or to the absolute directory `ATLAS_STATE_HOME` names
([Private state](../reference/configuration.md#private-state)).

## Find and read

`route` in `discover` mode ranks the records that match a question and gives
each a `selector`; `route` with that selector reads the Point:

```js
const found = route(view, { query: 'server receipt', mode: 'discover', limit: 1 });
const reading = route(view, found.selected[0].point.selector);
const point = reading.selected[0].point;
console.log(view.status, point.id, point.path);
console.log(point.title);
```

The reading holds the Point's explanation and sources, the Points above it, its
developments and the Facets that bear on it. Its modes and levels are in
[Reading](../reference/reading.md#route).

## Prepare and apply a change

`prepareChange` takes the view, the complete new text of each changed file and
a reason, validates the whole Atlas the change would make, and returns a plan.
`saveDraft` saves it as a draft, which the Portal shows as a proposed change
and `atlas review` reads. `applyDraft` writes it, only at the exact revision
saved:

```js
// Prepare a change to its file and save it as a draft.
const file = view.files.find(entry => entry.path === point.path);
const plan = prepareChange(view, {
  reason: 'Say which revision a receipt names',
  changes: [{ path: point.path, content: file.content + '\nA receipt names the revision it acknowledges.\n' }],
});
const draft = await saveDraft(root, { plan });
console.log(plan.status, draft.id, draft.revision);

// Apply the draft at the revision that was saved.
const applied = await applyDraft(root, draft.id, { expectedRevision: draft.revision });
console.log(applied.status, applied.draft);
```

A tool that keeps an Atlas for its owner applies a draft only once the owner
has read it, as [How changes land](../explanation/how-changes-land.md) explains.
The plan, the draft, apply and their refusals are in
[Changes](../reference/changes.md).

Put the three parts in `change.mjs`, in order, and run it:

```sh
node change.mjs ATLAS
```

```text
ready delivery-promise trees/product/points/promise.md
A note is “Saved on this device” until a server receipt makes it “Sent for sync”
ready 495c393d-f55f-4aae-8465-fc94ba308213 87f7078e76dc5df1753b0f108ab2719f0281fb4a99b5bce185adf065526b1a49
complete removed
```

The Point's file now ends with the new sentence, and
`atlas --root ATLAS validate` reports `"status": "ready"`.
