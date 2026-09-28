# Editor

The Editor adds local authoring to the Portal's Tree navigator. Start with
[editing an Atlas](../../docs/editing.md) for Point forms, reviewed drafts and
recovery, or [getting started](../../docs/getting-started.md) to create an Atlas.

`startEditor(root, options)` starts the shared Portal service with editing enabled.
The launcher fixes source access and private storage. The
[authoring reference](../../docs/reference/authoring.md) defines draft revisions,
application preconditions and interrupted-write recovery.

The interface also supports [agent connection](../../docs/working-with-agents.md),
[Check inspection](../../docs/reviewing-checks.md) and
[publication](../../docs/publishing.md). Its implementation lives in the shared
[Portal](../portal/README.md) service and browser assets.
