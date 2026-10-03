# Install Atlas

This guide covers version 1.1.0. Its npm installation commands require that
exact version to be published. If it is unavailable, use the source checkout or
a locally qualified tarball. The package and runtime bundle include the Library,
CLI, MCP server, Portal, Editor, guides and optional Checks.

## Source checkout

Use Node.js 22.23.2 or later and pnpm 11.9.0. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm atlas open /path/to/project
```

Use `pnpm atlas` wherever a guide shows `atlas`. The Editor opens in your browser;
keep the terminal running while you work. To explore the included sample, run
`pnpm atlas open examples/offline-notes`.

## npm

These commands require `@neutral/atlas@1.1.0` to have been published. They
select this version explicitly. Use Node.js 22.23.2 or later:

```sh
npm install --global --ignore-scripts @neutral/atlas@1.1.0
atlas --version
atlas open /path/to/project
```

For a project-local installation:

```sh
npm install --save-exact --ignore-scripts @neutral/atlas@1.1.0
npx atlas --version
npx atlas open /path/to/project
```

The package includes its pinned Markdown dependency and supplies `atlas`,
`atlas-cli` and `atlas-agent`. A local installation exposes these through `npx`;
the guides use `atlas` when it is on your command path. A global installation can
be removed with `npm uninstall --global @neutral/atlas`.

## Local npm tarball

Install the exact tarball selected by local qualification, with lifecycle scripts
disabled:

```sh
npm install --offline --ignore-scripts --no-audit /path/to/neutral-atlas-1.1.0.tgz
npx atlas --version
npx atlas open /path/to/project
```

Keep the recorded artifact hash and qualification result with that tarball.

## Runtime bundle

A runtime bundle includes Node. Choose an artifact qualified for the platform and
architecture where it will run, then move the whole bundle together. Availability
of the source checkout does not establish availability of a downloadable bundle.
To run a qualified bundle directly:

```sh
/path/to/bundle/bin/atlas open /path/to/project
```

For a managed installation:

```sh
/path/to/bundle/bin/atlas-manage install /path/to/installation
/path/to/installation/bin/atlas open /path/to/project
```

The installation parent must exist and the destination must be new. Windows
launchers use `.cmd`. Keep project data outside the installation directory.

### Update or remove a managed installation

```sh
/path/to/new-bundle/bin/atlas-manage update /path/to/installation
/path/to/bundle/bin/atlas-manage remove /path/to/installation
```

Update and removal require an intact managed installation. Modified or extra
files cause refusal. The helper manages that directory; shell profiles, MCP host
settings and project data remain under your control.

Drafts, recovery journals and retained reports live in
[private user storage](reference/authoring.md#private-storage) and survive
installation updates. Continue with [getting started](getting-started.md).
