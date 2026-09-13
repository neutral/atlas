# Embed the Atlas SDK

Install `@neutral/atlas` in an ESM project with Node 22.23.2 or later:

```sh
npm install @neutral/atlas
```

The package includes the application and exposes the Library, command adapters,
and public types for embedding:

```js
import { openAtlas } from '@neutral/atlas';
const view = openAtlas('/absolute/project/atlas');
console.log(view.status);
```

For application use, [install the global command](install.md). The
[Library reference](../library/README.md) explains reading, freshness,
prepared authoring, evaluation, and commands.

## Build from source

From the repository root, build the npm archive:

```sh
corepack enable
corepack pnpm@11.22.0 install --frozen-lockfile
npm run pack:sdk -- --output /absolute/new-sdk-artifacts
```

Verify the archive against its adjacent SHA-256 manifest. Install it into an
external ESM consumer:

```sh
npm install --save-exact /absolute/new-sdk-artifacts/neutral-atlas-0.9.0.tgz
```

In the source workspace, `atlas-reference-validator` identifies the Library
component; the assembled package exposes its APIs under `@neutral/atlas`.
