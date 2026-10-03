# Portal

The Portal lets a reader find an explanation, see where it belongs and follow
the accounts and sources behind it. **Search Atlas** finds starting Points across
Trees. Select one to read beside its Tree, or expand **Focus reading** for a
longer explanation.

Facets open the interpretation behind a connection, including its owner, host
and targets. Broader Point and Branch context stays distinct from the selected
Point. **Cited by** exposes direct Markdown mentions; cited Markdown sources open
as readable prose with the exact text available alongside it.

In a local session, **Review sources** compares explicitly inspected source bytes
with recorded hashes or prior reads and shows the accounts that cite them. A
changed source prompts review of its significance. See the
[reading guide](../../docs/reading.md) for the full path from discovery to source
inspection.

## Service and export

`startPortal(root, options)` starts an authenticated loopback reader. The launch
URL carries its token in a fragment; API requests require that token and same-origin
access. Source grants are fixed at launch. Markdown executes no HTML or scripts
and loads no referenced images.

`exportPortal(root, output, selection)` creates a static site in a new directory.
Select Trees, optionally Points, and any source URIs explicitly. Referenced
material outside that selection remains unavailable. Serve the directory over HTTP.
Static publications use the same reader and search, with navigation and source
pages limited to the selected material. See the
[publication rules](../../docs/reference/publication.md).
