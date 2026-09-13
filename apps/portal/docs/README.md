# Atlas Portal documentation

Atlas Portal generates a static reader from a conforming Atlas and one
publication profile. These guides cover `atlas export`, the source component,
and optional Cloudflare deployment.

Use the installed `atlas` command for site export. Advanced component and
Cloudflare commands run from the source repository after its frozen workspace
installation.

## Start here

- [Getting started](getting-started.md) installs Atlas from npm, exports selected
  content, and previews the generated reader.
- [Command-line reference](cli.md) defines installed export, source component
  commands, and their supported options.
- [Build and publication behavior](build-pipeline.md) explains validation, profile selection, Resource access, link handling, route generation, and static output.
- [Reader framework](framework.md) explains the two-column explorer and its Atlas, Map, Area, Point, Resource, and search destinations.
- [Deploy to Cloudflare](cloudflare.md) explains local Wrangler testing, Workers Static Assets deployment, Custom Domains, cache and security headers, and optional Cloudflare controls.

Atlas Portal validates against Atlas specification revision 0.9.0. Authored Atlases declare `"format": 2`; the validator rejects other format values.

The source component's `dev` and `build` commands require `--portal-config`
with an explicit reader name. Installed `atlas export` defaults to the Atlas
title and accepts an optional `--name` or `--portal-config`. Optional copyright
and license strings add plain-text reader footer lines. Checks govern authoring
and validation. They are absent from the generated reader.

See [Develop and verify](../README.md#develop-and-verify) for the type checks, regression tests, and release gate. The [license](../README.md#license-and-source) applies to Portal source; published Atlas content and dependencies retain their own terms.
