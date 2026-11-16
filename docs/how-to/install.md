# Install Atlas

Use this guide before you use Atlas.

This guide covers version 1.2.0. Its npm commands name that exact
version, so they need it to be published; if it is not, use the source checkout
or a tarball.

Atlas is the npm package `@neutral/atlas`. Installed as a package, from npm, a
tarball or a runtime bundle, it gives you three commands: `atlas`, the command
the guides use; `atlas-cli`, the same command under a second name; and
`atlas-agent`, the MCP server an agent host starts. A source checkout gives you
`pnpm atlas` instead. Every way needs Node.js 22.23.2 or later, except a
runtime bundle, which carries its own Node.

Each way ends with `atlas --version`, which prints the version you installed:

```text
  "version": "1.2.0"
```

## npm

Install Atlas for your user:

```sh
npm install --global --ignore-scripts @neutral/atlas@1.2.0
atlas --version
```

`--ignore-scripts` keeps npm from running install scripts. Atlas needs none.

## In one project

To keep Atlas with one project, install it in the project's folder and run it
through `npx`:

```sh
npm install --save-exact --ignore-scripts @neutral/atlas@1.2.0
npx atlas --version
```

`--save-exact` records the exact version in the project's `package.json`. Type
`npx atlas` wherever a guide shows `atlas`.

## From the source checkout

Use pnpm 11.9.0. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm atlas --version
```

Type `pnpm atlas` in the repository root wherever a guide shows `atlas`: from
the folder of one of its packages, such as `apps/cli`, pnpm does not find the
command. It runs from the repository root, so give every path in full:
`pnpm atlas open PROJECT`, with `PROJECT` the project's full path, not
`pnpm atlas open` from inside the project.

## From a tarball

A tarball holds the package together with its one dependency, `markdown-it`,
so installing it needs no network. Install it in a project's folder:

```sh
npm install --offline --ignore-scripts --no-audit /path/to/neutral-atlas-1.2.0.tgz
npx atlas --version
```

To install it for your user instead:

```sh
npm install --global --offline --ignore-scripts --no-audit /path/to/neutral-atlas-1.2.0.tgz
atlas --version
```

## From a runtime bundle

A runtime bundle is a folder that holds Node and the package together, built
for one platform and one architecture. Use one built for yours, and move the
whole folder, never part of it. A source checkout does not mean a bundle exists
for your platform. `BUNDLE` stands for the bundle's folder. Run it in place:

```sh
BUNDLE/bin/atlas --version
```

Or install it into a directory of its own, `INSTALL`, whose parent exists and
which itself does not:

```sh
BUNDLE/bin/atlas-manage install INSTALL
INSTALL/bin/atlas --version
```

On Windows the launchers end in `.cmd`. Keep your projects and their Atlases
outside the installation.

## Update or remove

To update, install the new version the way you installed this one, in the same
place. In a source checkout, bring its files up to date and run
`pnpm install --frozen-lockfile --ignore-scripts` again. A managed
installation, `INSTALL`, is updated by the helper of the new bundle,
`NEW_BUNDLE`:

```sh
NEW_BUNDLE/bin/atlas-manage update INSTALL
```

To remove Atlas installed for your user:

```sh
npm uninstall --global @neutral/atlas
```

In a project's folder, `npm uninstall @neutral/atlas` removes it from that
project. A managed installation is removed by the helper of a bundle,
`BUNDLE`:

```sh
BUNDLE/bin/atlas-manage remove INSTALL
```

`atlas-manage update` and `remove` refuse an installation whose files were
changed or added to. The helper manages that one directory: your shell
profile, your agent host's settings and your projects stay as they are.

An update or a removal leaves an Atlas and its drafts alone while the state
home lies outside the installation, as the default one does. An Atlas is a
folder in your project. Its drafts and recovery journals are kept in your user
state directory ([Private state](../reference/configuration.md#private-state)),
and `atlas --root ATLAS state`, with `ATLAS` the Atlas's folder, names the
directory. A state home you set inside an installation, with `--state-home` or
`ATLAS_STATE_HOME`, goes with it. The configuration you gave an agent host
names Node and the MCP server by their paths: when either moves, print the
configuration again and replace it ([Connect an agent](connect-an-agent.md)).

After an update, `atlas --version` prints the new version, and
`atlas --root ATLAS drafts` lists the drafts it listed before.
