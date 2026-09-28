# Work with an agent

A connected agent can navigate an Atlas, inspect permitted sources and prepare
changes for review. You supply the task and decide what the resulting knowledge
should say.

## Connect

Open the project in the Editor and select **Connect an agent**. Choose **Copy
configuration**, then add it to your agent application's MCP settings and connect
the server there. Atlas generates the configuration; you install it in the host.

The configuration selects this Atlas and its permitted source folders. Project
opening permits sources within the project. To add another folder, relaunch with:

```sh
atlas open /path/to/project --allow-source-root /path/to/source-folder
```

Copy the updated configuration. A source reference alone grants no access to its
file. Web sources remain references; Atlas does not fetch them.

Start by asking the agent to read Atlas's operating guide and inspect the selected
Atlas. The [MCP reference](reference/mcp.md) lists connection details and tools.

## Ask for an explanation

Route assembles relevant Points, their context, supporting detail and Facets. For
example:

> Use Atlas to explain the offline-work promise. Start with Product, follow any
> relevant technical Facets, and distinguish the stated promise from what the
> available evidence establishes. Read the cited sources needed for that judgment.

Review the returned scope. Search can produce several candidates, and results
have limits. Ask the agent to inspect the intended Point or continue into a
specific Tree when the first result leaves a gap. Source reads are separate from
Route; a returned reference has not necessarily been inspected.

## Integrate new material

Absorb helps the agent place incoming material and prepare an explicit proposal:

> Inspect this test report for Atlas. Identify which Points it changes, which
> claims it contradicts, and what remains uncertain. Prepare a draft with source
> references and explain any consequences for higher Points or connected Trees.
> Show me the complete changes before applying them.

The agent chooses among updating, creating, recording a conflict, adding a
reference or Facet, and leaving material unintegrated. Review those choices and
their reasons. A changed detail may require revising an overview or a promise in
another Tree; the author must judge those consequences.

## Review and apply

Ask the agent to save the proposal as a draft and show its complete changes,
validation results and unresolved questions. Have it apply the exact revision you
reviewed when ready. A changed Atlas, replaced draft or changed required source
stops application and requires another review.

The agent reads a captured view of the Atlas. Ask it to refresh before assessing
new work or the current freshness of a saved report. Saved drafts retain their
original baseline after refresh. See [editing](editing.md) for draft recovery and
[reviewing Checks](reviewing-checks.md) for recording project-specific reviews.
