# Share a selected Atlas

Export a local static site containing the Trees, Points and source files you want
readers to receive. You can then serve or deploy that directory with your chosen
hosting system.

## Choose the destination

Open the project in the Editor. The default destination is `atlas-export` inside
the project, or a sibling folder named `PROJECT-atlas-export` when the project
itself is the Atlas. To choose another destination, launch with:

```sh
atlas open /path/to/project --export-directory /path/to/new-site
```

Use a new destination for each export. Atlas refuses existing output and locations
that would overlap its records, declared source files, private state or installation.

## Select and review

1. Select **Export site** and check the displayed destination.
2. Choose the Trees and Points to include. All are selected initially.
3. Under **Include source files**, select any referenced files readers need. Source
   files start unselected. Select **Include the captured Atlas style in this publication** only if readers should
   receive the complete organizing policy; it starts unselected too.
4. Select **Preview selection**. Inspect the chosen IDs, source-read results and
   unavailable Facet targets. Use **Change selection** to revise the selection.
5. Select **Export this selection** to build the site.

Select only sources referenced by the included material. Permission to read a
folder does not include its contents in an export. Web references stay as links.
If the Atlas or source bytes change after preview, prepare and review the export
again.

## Read the result

The completion message gives the output directory. If Python 3 is installed,
preview the site with:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /path/to/new-site
```

Open [the local preview](http://127.0.0.1:8000) in your browser. Press **Ctrl+C** in
the terminal to stop it. To share the site, deploy the output directory with your
chosen hosting system. Export itself creates local files; hosting is a separate
step.

Readers can **Search Atlas** across the included Points and Facets, open an explanation,
choose **Focus reading**, and follow its detail, Facets and direct citations.
Included Markdown sources have readable pages; the original source files remain
available too.

Selection bounds this experience. Search and citation lists cover the selected
material. Excluded Points appear as unavailable positions, and Facet targets
outside the selection are marked unavailable. References stay visible even when
their source files were excluded. Checks, drafts and recovery records are outside
the exported site.

Before sharing, try a question your reader will bring:

1. Search for it and open the relevant explanation.
2. Follow a Facet into another perspective and return to its host.
3. Read the cited source and check its stated limits.
4. Check that unavailable targets and omitted sources leave an understandable
   account for the intended audience.

The [publication reference](reference/publication.md) specifies the selection and
source rules. The [guided example](../examples/README.md) offers a small Atlas to
practice with.
