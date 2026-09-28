# Security

Treat Atlas records, sources and Checks as untrusted content. File, network,
execution and publication permissions come from the caller's configuration.
Processors accept only `atlas/1`.

Local reads use bounded inspection and caller-selected roots. Structural paths
and source reads refuse symlink traversal. HTTP(S) sources remain references;
Atlas does not fetch them. Validation checks structure. Evaluate source content
separately before relying on its claims.

The Portal and Editor bind to loopback, check Host and Origin, and require a
per-launch token for data operations. MCP uses fixed launch roots and source
grants. Neither browser requests nor tool calls can widen those grants. Keep
tokens private and stop the service when finished.

Drafts and recovery records can contain complete original text. Keep their private
state directory outside shared or published content. Publication requires explicit
selection and permission to redistribute the selected source bytes. Keep exported
sites separate from source records and the application.

Source builds use the pinned pnpm version, committed lockfile and disabled
lifecycle scripts. Release qualification verifies the installed runtime dependency
graph. Run `pnpm audit --prod --audit-level moderate` separately to check current
registry advisories.

An npm installation uses the host's Node runtime. A runtime bundle includes its
own Node executable. Update the bundle to replace its runtime and dependencies;
host runtime updates affect only host installations. Tested environments and
limits belong to the release's qualification record.

A useful vulnerability report identifies the revision, platform, Node version,
expected boundary and a minimal reproduction. Exclude secrets and personal data.
