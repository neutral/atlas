# Start with a project

After [installation](install.md), run `atlas open /absolute/path/to/project`.
Atlas opens an unambiguous collection, offers a choice when several exist, and
previews creation when no collection exists. Opening does not write authored files.

Use the local Editor to read sources and prepare changes. Inspect the complete
diff and validation findings before applying. Stale source refuses a write.
Acknowledged drafts and interrupted-write recovery survive a service restart.
Keep the command's terminal open while working; Ctrl-C stops the local service.

Choose **Export site** to review selected content and an explicit destination.
Choose **Connect an agent** to produce fixed-scope MCP configuration for the host.
Source access does not grant publication permission. Configuration generation
leaves actual host settings unchanged.

[Use Atlas](using-from-another-repository.md) explains the complete operations and
recovery boundaries. The [starter collection](../spec/examples/starter/README.md)
shows the same authored files without requiring a runtime.
