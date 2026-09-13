# Manual npm release

Use this workflow to publish the complete `@neutral/atlas` package to the
`neutral` organization on npm. A maintainer runs each step locally. Repository
pushes, tags, and GitHub Actions do not publish the npm package.

## Prerequisites

Begin with the reviewed public source checkout for the intended release. Its
`VERSION`, package metadata, and first changelog entry identify the same version.
Retain the required [qualification](../docs/verification.md) evidence for its
exact source and artifacts. Publication requires a clean committed checkout and
the matching `vVERSION` tag. Rehearsals can use uncommitted source; repeat this
workflow from the release commit before publication.

Use the Node and pnpm versions declared in `package.json`. The npm account must
have permission to publish `@neutral/atlas` in the `neutral` organization. Keep
credentials outside source and release evidence.

Run the command blocks in the same shell from that public checkout. Choose a new
absolute release directory outside it. Stop on any failed command.

```sh
set -eu
atlas_source_root="$PWD"
atlas_release_version=$(cat VERSION)
atlas_release_dir=/absolute/new-npm-release
mkdir "$atlas_release_dir"
git rev-parse HEAD > "$atlas_release_dir/source-commit.txt"
git status --short > "$atlas_release_dir/source-status.txt"
corepack pnpm@11.22.0 install --frozen-lockfile
npm run audit:dependencies
npm run release:check
```

## Build and qualify

Build once and install the resulting archive in a separate consumer. The package
contains the application, browser assets, command adapters, and embedding APIs.
The qualifier exercises those installed surfaces without a frontend build.

```sh
npm run pack:sdk -- --output "$atlas_release_dir/package"
atlas_release_archive="$atlas_release_dir/package/neutral-atlas-$atlas_release_version.tgz"
mkdir "$atlas_release_dir/consumer"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({name:"atlas-release-consumer",private:true,type:"module"}))' "$atlas_release_dir/consumer/package.json"
npm install --prefix "$atlas_release_dir/consumer" --ignore-scripts --save-exact "$atlas_release_archive"
node distribution/qualify-npm.mjs "$atlas_release_dir/consumer" --fixture spec/examples/valid/publication-profile --output "$atlas_release_dir/npm-qualification.json"
npm audit --prefix "$atlas_release_dir/consumer" --omit=dev --audit-level=moderate
node -e 'const fs=require("node:fs"),c=require("node:crypto");fs.writeFileSync(process.argv[2],c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")+"\n")' "$atlas_release_archive" "$atlas_release_dir/archive.sha256"
npm publish "$atlas_release_archive" --registry=https://registry.npmjs.org --access public --ignore-scripts --dry-run
```

Review the archive inventory, package name and version, license material,
qualification report, checksum, and dry-run output. Retain command output beside
the archive. A dry run checks local publication preparation; it does not prove
registry authorization or a completed upload.

## Publish

Use an existing authorized npm session or run
[`npm login`](https://docs.npmjs.com/cli/v11/commands/npm-login/) interactively.
Complete any npm authentication prompt in the local terminal. Confirm the account
with `npm whoami --registry=https://registry.npmjs.org`.

Before publication, confirm that the version is unused on npm. An existing
`@neutral/atlas@VERSION` cannot be overwritten. Verify the clean release commit,
matching tag, qualification result, installed metadata, and archive checksum:

```sh
test ! -s "$atlas_release_dir/source-status.txt"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(cat "$atlas_release_dir/source-commit.txt")"
test "$(git rev-parse HEAD)" = "$(git rev-parse "v$atlas_release_version^{commit}")"
node --input-type=module - "$atlas_release_dir" "$atlas_release_version" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const [directory, version] = process.argv.slice(2);
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(fs.readFileSync('VERSION', 'utf8').trim(), version);
assert.equal(JSON.parse(fs.readFileSync('package.json')).version, version);
assert.equal(fs.readFileSync('CHANGELOG.md', 'utf8').match(/^## (.+)$/m)[1], version);
const report = JSON.parse(fs.readFileSync(`${directory}/npm-qualification.json`));
assert.equal(report.status, 'passed');
assert.equal(report.name, '@neutral/atlas');
assert.equal(report.version, version);
const manifest = JSON.parse(fs.readFileSync(`${directory}/consumer/node_modules/@neutral/atlas/package.json`));
assert.equal(manifest.name, '@neutral/atlas');
assert.equal(manifest.version, version);
const archive = fs.readFileSync(`${directory}/package/neutral-atlas-${version}.tgz`);
assert.equal(createHash('sha256').update(archive).digest('hex'), fs.readFileSync(`${directory}/archive.sha256`, 'utf8').trim());
JS
```

Run the publication command only for an intended release. It uploads the exact
qualified archive, makes `@neutral/atlas@VERSION` public, and sets npm's `latest`
tag. It does not rebuild the package.

```sh
npm publish "$atlas_release_archive" --registry=https://registry.npmjs.org --access public --tag latest --ignore-scripts
```

The [npm publish reference](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
defines registry behavior. This local procedure makes no CI provenance claim.

## Verify the uploaded package

Fetch the exact published version into a separate directory. Compare its bytes
with the qualified archive, then repeat the installed qualifier on that download.

```sh
mkdir "$atlas_release_dir/download"
npm view "@neutral/atlas@$atlas_release_version" version dist.integrity --registry=https://registry.npmjs.org
npm pack "@neutral/atlas@$atlas_release_version" --registry=https://registry.npmjs.org --ignore-scripts --pack-destination "$atlas_release_dir/download"
cmp "$atlas_release_archive" "$atlas_release_dir/download/neutral-atlas-$atlas_release_version.tgz"
mkdir "$atlas_release_dir/download-consumer"
cp "$atlas_release_dir/consumer/package.json" "$atlas_release_dir/download-consumer/package.json"
npm install --prefix "$atlas_release_dir/download-consumer" --ignore-scripts --save-exact "$atlas_release_dir/download/neutral-atlas-$atlas_release_version.tgz"
node "$atlas_source_root/distribution/qualify-npm.mjs" "$atlas_release_dir/download-consumer" --fixture "$atlas_source_root/spec/examples/valid/publication-profile" --output "$atlas_release_dir/download-qualification.json"
```

Retain the source revision, archive, checksum, qualification reports, registry
identity, and original command output. Record the actual tested host and runtime.
Remove disposable consumers only after retaining the required evidence.

## Failure and retry

Stop before publication when a source check, installation, audit, qualification,
or checksum fails. Repair the owning source and repeat the affected checks in a
new release directory. Keep the failed observations.

After an uncertain upload, inspect the exact registry version before retrying.
If its bytes match the qualified archive, complete download verification. If
different bytes occupy that version, stop and investigate; npm cannot replace it.
Do not unpublish or change another release's tags as automatic recovery. Native
archive uploads and GitHub releases have separate publication steps.
