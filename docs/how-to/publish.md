# Publish an Atlas

Use this guide when people outside your machine should read an Atlas.

`atlas export` writes the Portal's pages for the Trees you choose into a
folder, and any web server can serve that folder. Here `ATLAS` is the Atlas's
folder and `OUT` the folder the pages go to. The values shown come from a copy
of the example, `examples/offline-notes`. From a source checkout the command is
`pnpm atlas`, run from the repository root
([Install Atlas](install.md#from-the-source-checkout)).

## Choose the Trees

List the Atlas's Trees:

```sh
atlas --root ATLAS outline
```

Each Tree has an `id` and a `title`:

```text
      "id": "product",
      "title": "Product experience",
```

You publish whole Trees, by ID, or all of them. An export never follows a link
or a Facet into a Tree you leave out. A link to a Point there keeps its words,
followed by "not in this publication", and a Facet that reads through that
Tree says "Facet, seen from a Tree not in this publication". Proposed changes
are never published, and an export takes the Atlas as it stands: apply or
delete the drafts you meant to finish first. What leaves in an export, and why
the choice is yours, is in [What Atlas may read and write](../explanation/access.md).

## Write the pages

```sh
atlas --root ATLAS export OUT --tree product --source-base https://example.org/notes/
```

`OUT` must not exist yet and must lie outside the Atlas. The export prints what
it wrote:

```text
  "points": 3,
  "facets": 2,
```

Give `--tree` once for each Tree, or `--all` for every one.

A source's text is never copied. For each local source a reader sees its title,
its path, its locator when it has one, and its mark as the source stood when
you exported: a source changed since it was stamped reads "△ changed since
this was checked", and the line that counts the page's sources adds it, as in
"2 sources · 1 changed since this was checked". When none of a page's stamped
sources could be checked, that line says "not checked here" once, and no
source carries a mark of its own. The marks are in
[Marks](../reference/portal.md#marks).

`--source-base` is the web address at which the Atlas's folder can be browsed,
such as that folder in your repository's web view. With it, each local
source's title links to its file under that address, marked `↗`; without it,
the title is plain text. A source that is a web address links to its own
address either way. A source outside the Atlas's folder is checked only when
its directory is granted with `--allow-source-root DIR` between `--root ATLAS`
and `export`. Every option and refusal is in
[`export`](../reference/cli.md#export), and what the folder holds in
[The export folder](../reference/portal.md#the-export-folder).

## Put them online

The folder is static. Every page is complete without its script, and every
link between pages is relative, so the folder works at any path. The links
name folders, such as `../offline-work/`, so serve it with a web server that
answers a folder's address with its `index.html`.

To read it on your machine first, serve it locally, here with Python's
built-in server:

```sh
python3 -m http.server 4363 --bind 127.0.0.1 --directory OUT
```

Open `http://127.0.0.1:4363/`. Home shows the Atlas's title and the Trees you
chose. To publish, copy the folder's contents to your web server.

## Publish again

Export into the same folder:

```sh
atlas --root ATLAS export OUT --all --source-base https://example.org/notes/
```

```text
  "replaced": true
```

Atlas knows the folder by its marker, `_/export.json`, which lists every file
the previous export wrote. It removes those files and writes the new ones. A
file you added beside them, such as a `CNAME`, stays.

Two cases are refused, and the folder is left as it was:

- `EXPORT_CONFLICT`: a file you added stands where the new export writes a
  page. Move it, or choose a new folder.
- `EXPORT_EXISTS`: the folder exists and is not an export. Choose a new folder.

The served folder now shows every Tree.
