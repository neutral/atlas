# Atlas

Atlas opens project context in a local browser, prepares reviewed edits, exports
selected content as a site, and connects an agent to a fixed project scope.
This archive contains its runtime and application. Node, npm, and pnpm are not
installation prerequisites.

## Install and open

Extract the archive for the current platform, enter its directory, and run:

```sh
./install.sh
```

The installer prints the installed command path. Its default launcher is
`~/.local/bin/atlas`. Add `~/.local/bin` to the shell's PATH when needed, or use
the printed absolute command path. The installer does not edit shell profiles.

```sh
atlas --version
atlas open /path/to/project
```

`atlas open` defaults to the current directory. It opens an unambiguous Atlas
selection and lists choices when several exist. A project without an Atlas
offers an initialization preview. Creation and authored edits require explicit
application. The command prints a loopback URL and opens the browser. Keep its
terminal open while editing. Ctrl+C stops the local service.

The Editor stores durable drafts and recovery separately from authored project
files in the operating system's user-data directory. Prepare a change, inspect
its complete differences, then apply it explicitly. A stale source refuses the
write and retains the proposed text. Draft storage survives closing the browser,
restarting Atlas, updating, and removing the application.

## Export a site

Choose **Export site** in the Editor, or run `atlas export --help`. Select a
publication profile, review the selected content, and provide an explicit output
directory. Resource access does not authorize publication. Exported output stays
outside the installation. Local preview serves the resulting static site.

## Connect an agent

Choose **Connect an agent** in the Editor, or run `atlas connect --help` to
generate host configuration. Review the fixed project and Atlas roots before
using the configuration. Atlas does not edit agent-host settings. The host
starts `atlas mcp`; its standard output contains only protocol traffic.

## Update and remove

Run `install.sh` from a new archive to update the current launcher. The installer
retains earlier versions. It refuses an unrelated existing command and refuses
a different build at an occupied version path. Running an earlier version's
installer selects that retained version again.

The installer prints the exact removal command for its selected version:

```sh
/absolute/installed/version/uninstall.sh
```

Removal deletes that installed version and its managed active launcher. It
preserves project files and durable drafts. It leaves other installed versions
in place. Installation and removal accept `--prefix DIRECTORY` and
`--bin-directory DIRECTORY`; use the same values for both operations.

The default installation prefix is
`~/Library/Application Support/Atlas/install` on macOS and
`${XDG_DATA_HOME:-~/.local/share}/atlas/install` on Linux. The executable can also
run directly as `./bin/atlas` from an extracted archive. Moving that entire
directory preserves its relative runtime and dependency links. Run its installer
again to update an installed command after moving an installation.

## Platform and attribution

The native archive targets macOS on Apple silicon. Linux x64 has an assembly and
qualification job; its result must be inspected before claiming support for a
specific archive. Windows and other architectures have no declared bundle.

The bundled runtime is Node.js 22.23.2. `bundle.json` records exact runtime,
dependency-lock, content, and attribution identities. `THIRD_PARTY.md` links the
original dependency and Node notices. Referenced project materials keep their
own terms and publication permissions.

The separately named application payload contains the same application with no
Node runtime or native installers. It starts with
`ATLAS_NODE=/absolute/path/to/node ./bin/atlas`. A shared runtime supports
Node 22.23.2 or later on major 22, or Node 24. The selected runtime remains the
host's responsibility. The native archive needs no runtime selection.
