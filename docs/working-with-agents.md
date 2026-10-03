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
Atlas, including its complete adopted Style. Have it use that policy for placement
and source depth throughout the task. The [MCP reference](reference/mcp.md) lists connection details and tools.

## Ask for an explanation

Route assembles relevant Points, their context, supporting detail and Facets. For
example:

> Use Atlas to explain the offline-work promise. Start with Product, follow any
> relevant technical Facets, and distinguish the stated promise from what the
> available evidence establishes. Read the cited sources needed for that judgment.

Review the returned scope. Search can produce several candidates, and results
have limits. Agents can request compact discovery, follow bounded continuation
requests, and then read an exact Point. Ask the agent to inspect the intended Point or continue into a
specific Tree when the first result leaves a gap. Source reads are separate from
Route; a returned reference has not necessarily been inspected.

## Integrate new material

Absorb helps the agent place incoming material and prepare an explicit proposal:

> Inspect this test report for Atlas. Identify which Points it changes, which
> claims it contradicts, and what remains uncertain. Prepare a draft with source
> references using the adopted Style's ownership and source-depth policy. Explain
> any consequences for higher Points or connected Trees.
> Show me the complete changes before applying them.

The agent chooses among updating, creating, recording a conflict, adding a
reference or Facet, removing or consolidating an obsolete record, and leaving
material unintegrated. A removal names what disappears and may identify surviving
destinations. Review those choices and
their reasons. A changed detail may require revising an overview or a promise in
another Tree; the author must judge those consequences.

## Review and apply

Ask the agent to save the proposal as a draft and show its complete changes,
validation results and unresolved questions. Saved Absorb reasoning survives
restart. For a rebuild, ask for optional preservation accounting that states the
source scope and the disposition and destination of each material unit. Have it apply the exact revision you
reviewed when ready. A changed Atlas, replaced draft or changed required source
stops application and requires another review.

The agent reads a captured view of the Atlas. Ask it to refresh before assessing
new work or the current freshness of a saved report. Saved drafts retain their
original baseline after refresh. See [editing](editing.md) for draft recovery and
[reviewing Checks](reviewing-checks.md) for recording project-specific reviews.

## Ask for a bounded editorial review

State the questions the account should help readers answer. Ask the agent to
identify a concrete problem before proposing a restructure, preserve meaning and
qualifications rather than source wording, and rehearse a realistic update within
the selected Style. A different plausible outline is not sufficient reason to
change it. Following the adopted Style is ordinary authoring; the optional
[editorial Check](../checks/editorial-style.md) adds a recorded assessment.

Require the review to separate structural validity, editorial observations and
reader benefit. Successful validation cannot establish useful explanations, and a
rehearsal by the author cannot establish better unaided comprehension. Stop when
the declared scope has coherent, qualified reading paths and no consequential
defect remains. Record unresolved or inaccessible material without filling it in.
