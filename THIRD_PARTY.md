# Third-party material

Atlas's [CC0 1.0 Universal or Zero-Clause BSD license](LICENSE) covers its original
material. It does not relicense dependencies, referenced sources, external
standards, names or marks. A reference grants no redistribution permission.

Assembled packages retain each runtime dependency's original package metadata
and files. `dependency-inventory.json` records every copied package instance,
version, declared license metadata and conventional notice files at its package
root. The content manifest hashes those retained bytes. Missing metadata remains
explicit; the inventory is not a rights-clearance or license-compatibility claim.

The Portal's browser script, `apps/portal/public/app.js`, and the prerenderer an
export runs, `apps/portal/public/prerender.mjs`, are built from development
dependencies and bundle third-party code: React, react-dom and scheduler (MIT);
React Aria Components, react-aria, react-stately and `@internationalized/date`,
`number` and `string` (Apache-2.0); and clsx, use-sync-external-store and
client-only (MIT). The build writes each bundled package's name, version, declared
license and license text to `apps/portal/public/licenses.txt`, which ships beside
the script and is copied into every exported site.

Runtime bundles also retain Node's notices in `runtime/LICENSE`. Other development
dependencies, host system libraries and external Atlas source material are outside
the package inventory. Their terms remain their own.
