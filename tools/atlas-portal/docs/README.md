# Atlas Portal documentation

Atlas Portal generates a static reader from a conforming Atlas, one publication profile, and a required portal configuration. These guides explain how to run the application from the Atlas repository with compatible Atlas source.

All command examples run from the repository root.

## Start here

- [Getting started](getting-started.md) installs Atlas Portal, starts a local portal, builds static output, and previews the result.
- [Command-line reference](cli.md) defines the `dev`, `build`, and `preview` commands and every supported option.
- [Build and publication behavior](build-pipeline.md) explains validation, profile selection, Resource access, link handling, route generation, and static output.
- [Reader framework](framework.md) explains the two-column explorer and its Atlas, Map, Area, Point, Resource, and search destinations.
- [Deploy to Cloudflare](cloudflare.md) explains local Wrangler testing, Workers Static Assets deployment, Custom Domains, cache and security headers, and optional Cloudflare controls.

Atlas Portal validates against Atlas specification revision 0.8.0. Authored Atlases declare `"format": 1`; the validator rejects other format values.

Every generation command requires `--portal-config` with an explicit reader name. Optional copyright and license strings add plain-text reader footer lines. Checks govern authoring and validation. They are absent from the generated reader.

See [Develop and verify](../README.md#develop-and-verify) for the type checks, regression tests, and release gate. The [license](../README.md#license-and-source) applies to Portal source; published Atlas content and dependencies retain their own terms.
