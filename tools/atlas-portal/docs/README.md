# Atlas Portal documentation

Atlas Portal generates a static reader from a conforming Atlas and one publication profile. These guides explain how to run the application from the Atlas repository and use it with any compatible Atlas directory.

All command examples run from the repository root.

## Start here

- [Getting started](getting-started.md) installs Atlas Portal, starts a local portal, builds static output, and previews the result.
- [Command-line reference](cli.md) defines the `dev`, `build`, and `preview` commands and every supported option.
- [Build and publication behavior](build-pipeline.md) explains validation, profile selection, Resource access, link handling, route generation, and static output.
- [Reader framework](framework.md) explains the three-panel interface and how Atlas, Map, Area, Point, Resource, search, and Check destinations appear.
- [Deploy to Cloudflare](cloudflare.md) explains local Wrangler testing, Workers Static Assets deployment, Custom Domains, cache and security headers, and optional Cloudflare controls.

Atlas Portal consumes Atlas specification revision 0.7.0. The validator rejects an Atlas that declares another revision.
