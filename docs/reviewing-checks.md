# Adopt and review Checks

Checks record review requirements a project chooses to maintain. They can require
evidence for changed claims, source accounting or citation review. Format
validation already checks the Atlas's identities, ownership and structure.

## Adopt a requirement

Read the [optional Check catalog](../checks/README.md) and choose a
definition that serves your project. Copy its Markdown file into the Atlas's
`.checks/` directory, or ask a connected agent to prepare that addition as a
reviewed draft. You can also add the file through **Drafts → Edit records**.

Read and adapt its **Requirement**, **Verification** and **Failure** sections.
Choose `draft`, `active` or `retired` status and `required` or `advisory` level.
Active Checks govern reviews; all active required Checks must pass for a
required-Check summary to be satisfied. Catalog definitions arrive active and
required, so review those choices when adopting them. Each Atlas maintains its
own copy.

Open **Checks** in the Editor to confirm the definition is present. This panel
shows definitions and review gaps. Complete the review with a connected agent or
the Library; opening the panel performs no evaluation.

## Review against evidence

For example, ask a connected agent:

> Refresh this Atlas and review its active Checks. Read each Verification section
> and inspect the evidence it calls for. Record pass, fail or unable with reasons
> and the supporting evidence. Show the complete results, including required
> Checks that could not be reviewed, and retain the report.

Use **pass** when the requirement is supported by the inspected evidence, **fail**
when that evidence shows a violation, and **unable** when the review cannot be
completed. Pass and fail require evidence. The MCP service records the supplied
review outcomes; the reviewer performs the judgment described by each Check.

Inspect individual results before relying on the summary. A completed run can
contain failures or gaps. A zero required count means the Atlas has no active
required Checks. Judge its evidence through the underlying Points and sources.

## Keep a review useful

Retained reports survive restarts in private user storage. They record the exact
Atlas content and Check revisions reviewed. Ask the agent to refresh and inspect
a report's freshness before using it for current work. Changed content or active
definitions require another review.

The [Checks reference](reference/checks.md) describes result fields and retained
reports. The [MCP reference](reference/mcp.md) describes the tools for recording
and reading them.
