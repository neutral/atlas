# Install Atlas

Use Node 22.23.2 or later and npm:

```sh
npm install --global @neutral/atlas
atlas open /absolute/path/to/project
```

Atlas provides the command-line tools, local browser Editor, static site exporter,
and MCP adapter. [Start with a project](getting-started.md) explains opening,
editing, exporting, and connecting an agent.

For use without a global installation, run
`npx @neutral/atlas open /absolute/path/to/project`. A project-local installation
uses `npm install @neutral/atlas` and `npx atlas open /absolute/path/to/project`.

Run `npm update --global @neutral/atlas` to update or
`npm uninstall --global @neutral/atlas` to remove the command. Updates and removal
preserve project files and durable drafts.

## Build from source

From the repository root, install the locked workspace and assemble the native
application:

```sh
corepack enable
corepack pnpm@11.22.0 install --frozen-lockfile
npm run bundle:assemble -- --output /absolute/new-native-artifacts
```

The [distribution guide](../distribution/README.md) covers npm package assembly and the
shared-runtime payload. Source development uses pnpm 11.22.0.

## Native archives

The native archive includes Node and browser assets. Installing it needs no
separate Node, npm, pnpm, or frontend build. Choose the archive for the selected
platform from [Atlas releases](https://github.com/neutral/atlas/releases), or use
the source build above. The declared targets are macOS Apple silicon and Linux
x64; each release record supplies its SHA-256 and qualification scope.

Verify the archive against its recorded SHA-256, extract it, and run
`./install.sh` from the extracted directory. The installer prints the command
path; its default is `~/.local/bin/atlas`. Add that directory to `PATH` when needed.
Then run `atlas open /absolute/path/to/project`.

Run the installer from a newer archive to update. Use the version-specific
uninstall command printed by the installer to remove it. Updates and removal
preserve project files and durable drafts. [Application use](using-from-another-repository.md)
explains state, recovery, and service lifetime.
