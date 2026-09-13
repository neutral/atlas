# Build Atlas distributions

Install the locked root workspace with
`corepack pnpm@11.22.0 install --frozen-lockfile`. The source contains the recipes
for the npm package and native application:

```sh
npm run pack:sdk -- --output /absolute/new-npm-artifacts
npm run bundle:assemble -- --output /absolute/new-native-artifacts
```

The `@neutral/atlas` npm archive includes the command-line tools, browser Editor,
static site exporter, MCP adapter, Library APIs, types, specifications, schemas,
and original license material. It uses the host's Node runtime. Editor and Portal
retain their workspace package names as application components.

[Native assembly](bundle/README.md) builds on the target platform, verifies the
pinned runtime, includes the locked production closure and original notices, and
emits both a complete archive and a shared-runtime payload.
[Verification](../docs/verification.md) covers exact artifact checks and their
platform and browser limits.

## Publish to npm

Follow the [manual npm release procedure](npm-release.md) to build and qualify
an exact archive, review its dry run, publish it as `@neutral/atlas`, and verify
the registry download. A maintainer runs the publication command locally with
an authorized npm account. Repository pushes, tags, and GitHub Actions do not
publish the npm package.

For native archives, dispatch the
[bundle workflow](../.github/workflows/bundle.yml) at the matching release tag.
Attach its qualified platform archives, checksums, and scope to the matching
GitHub release. Native release assets have a separate publication step.
