# Verify Atlas

Source development uses the versions declared in `package.json`. Install with
`corepack pnpm@11.22.0 install --frozen-lockfile`. Run `npm test` and `npm run check`
from the repository root. Focused component commands remain in `package.json`.
These checks cover code, types, schema and fixture agreement, guides, and assembly
mechanics. They do not establish browser behavior or another platform.

Build the npm archive with `npm run pack:sdk -- --output /absolute/new-npm-artifacts`.
Install that archive in an external ESM project, then run
`node distribution/qualify-npm.mjs /absolute/consumer --fixture spec/examples/valid/publication-profile --output /absolute/new-npm-qualification.json`.
The qualifier exercises installed commands, APIs, browser assets, durable drafts,
site export, and MCP. It performs no frontend build in the consumer.

Build the exact [application](../distribution/bundle/README.md), then run
`node distribution/bundle/qualify.mjs /absolute/extracted-archive`. Set
`ATLAS_BUNDLE=/absolute/extracted-archive npm run test:installed-bundle` for the
installed interruption and recovery cases. Shared-runtime qualification supplies
an explicit compatible Node binary through `--node`.

Exercise browser reading, authoring, navigation, focus, and recovery for changed
interactions. Record source and artifact identities, environment, commands,
results, and remaining limits. Qualify each declared platform using its actual
artifact. A changed artifact requires affected checks again. Existing captures
and source tests do not establish later bytes, hosted CI execution, publication,
or a deployment.

Run `npm run release:check` for the repository release gates. Retain the exact
artifact identities and results for the release under review.
