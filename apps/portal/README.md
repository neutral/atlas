# Portal

The Portal displays a Tree canvas and pages for its Points and Branches. The
[reading guide](../../docs/reading.md) covers navigation, filtering, Facets and
sources. The same browser assets serve local sessions and static publications.

## Service and export

`startPortal(root, options)` starts an authenticated loopback reader. The launch
URL carries its token in a fragment; API requests require that token and same-origin
access. Source grants are fixed at launch. Markdown executes no HTML or scripts
and loads no referenced images.

`exportPortal(root, output, selection)` creates a static site in a new directory.
Select Trees, optionally Points, and any source URIs explicitly. Referenced
material outside that selection remains unavailable. Serve the directory over HTTP.
[Publication rules](../../docs/reference/publication.md).
