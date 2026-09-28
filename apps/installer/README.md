# Runtime bundle installer

This component owns the installer and file-integrity checks shipped with Atlas
runtime bundles. Bundle assembly places `src/manage.mjs` and `src/manifest.mjs`
beside the bundle manifest and exposes them through `bin/atlas-manage`.

The installer manages one explicitly selected directory. Installation requires a
new destination. Updates and removal verify the existing installation and refuse
modified or extra files. Staging checks the copied bundle before replacing an
installation. Project content and private drafts belong outside that directory.

See [Installation](../../docs/install.md#runtime-bundle) for the installed commands.
From the source repository root, run the component tests with:

```sh
node --test apps/installer/tests/*.test.mjs
```

These tests use temporary fixtures to check manifests, contained executable links,
staging and installation guards. They do not establish a qualified bundle for a
different platform or runtime.
