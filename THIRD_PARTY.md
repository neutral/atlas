# Third-party material

Atlas's [CC0 1.0 Universal or Zero-Clause BSD license](LICENSE) covers its original
material. It does not relicense dependencies, referenced sources, external
standards, names or marks. A reference grants no redistribution permission.

Assembled packages retain each runtime dependency's original package metadata
and files. `dependency-inventory.json` records every copied package instance,
version, declared license metadata and conventional notice files at its package
root. The content manifest hashes those retained bytes. Missing metadata remains
explicit; the inventory is not a rights-clearance or license-compatibility claim.

The one runtime dependency is markdown-it 15.0.3 (MIT), with the packages it
depends on: argparse 3.0.4 (declared PSF-2.0), entities 8.1.0 (BSD-2-Clause),
linkify-it 6.1.0, mdurl 2.1.0, punycode.js 2.3.1 and uc.micro 3.0.0 (MIT).
The Portal bundles no third-party code: its sheet and reader script in
`apps/portal/assets/` are Atlas's own and are served and exported as written,
and the search an export carries is the Library's own `library/src/search.mjs`.

Runtime bundles also retain Node's notices in `runtime/LICENSE`. Other development
dependencies, host system libraries and external Atlas source material are outside
the package inventory. Their terms remain their own.
