# Atlas documentation

An Atlas is an explanation of a project, kept in plain files beside it. Each of
its Trees owns one account of the project: a top claim and the Points that
develop it, down to the documents and code they cite. A Point states one
claim in its title and explains it beneath. A Point may be a Decision, which
says where a choice stands (open, proposed, selected, rejected or superseded),
or an Observation, which records what was observed and when. A Facet says
what another Tree changes about how a Point reads. Readers read the Atlas in the
Portal. An agent keeps it, and the project's owner reads each change the agent
proposes and says apply.

These pages say how to do things with Atlas, why it works as it does, and what
each command, tool and page holds. They bind nothing: where a page and the
specification differ, the specification holds.

## How-to guides

| Guide | When |
| --- | --- |
| [Install Atlas](how-to/install.md) | Before you use Atlas |
| [Start an Atlas](how-to/start-an-atlas.md) | A project has no Atlas yet |
| [Connect an agent](how-to/connect-an-agent.md) | An agent should read or keep an Atlas |
| [Read an Atlas](how-to/read-an-atlas.md) | You want to understand a project from its Atlas |
| [Ask your agent for a change](how-to/ask-for-a-change.md) | The Atlas should say something new or different |
| [Keep an Atlas true as the project changes](how-to/keep-it-true.md) | The project's documents or code changed |
| [Check an Atlas with fresh readers](how-to/check-with-fresh-readers.md) | Before you rely on an Atlas, or after a large change |
| [Change the Style](how-to/change-the-style.md) | The Atlas's Trees or depth no longer fit |
| [Publish an Atlas](how-to/publish.md) | People outside your machine should read it |
| [Recover an interrupted apply](how-to/recover-an-apply.md) | An apply stopped before it finished |
| [Use the Library from code](how-to/use-the-library.md) | You build a tool on Atlas |

## Explanation

- [What an Atlas is for](explanation/what-an-atlas-is.md): the reader and the
  maintainer, and what an Atlas leaves to the project's own sources.
- [Trees, Points and Facets](explanation/trees-points-facets.md): one claim for
  each Point, every level explaining, one owner for each statement.
- [Styles](explanation/styles.md): why an Atlas states how it is written, and
  the two choices a Style makes.
- [How changes land](explanation/how-changes-land.md): a copy edited, a change
  prepared whole, read by the owner and applied at one revision.
- [Keeping an Atlas true](explanation/keeping-it-true.md): stamps, the stale
  report, fresh readers and Checks.
- [The Portal](explanation/the-portal.md): one page for each Point, the margin
  as a map, and pages complete without a script.
- [What Atlas may read and write](explanation/access.md): what the launch
  grants, and what nothing in an Atlas can.

## Reference

- [The atlas command](reference/cli.md): every command, its options, its input,
  what it prints and how it exits.
- [The MCP server](reference/mcp.md): the launch, the session and every tool.
- [The Portal](reference/portal.md): its pages and addresses, labels and marks,
  keys, the service and the export folder.
- [Changes](reference/changes.md): the candidate folder, drafts, the review,
  apply, recovery and the refusal codes.
- [Reading](reference/reading.md): inspect, outline, search, Route and
  references.
- [Sources and stamps](reference/sources.md): reading a source, stamping, the
  stale report and moving a file.
- [Configuration](reference/configuration.md): where state lives, environment
  variables, source grants, the workspace file and discovery.

## The rules

Each rule has one owner, and these pages link it:

- [Working with Atlas](../spec/OPERATING.md), the guide every agent is
  handed: reading an Atlas, writing a Point worth reading and keeping an Atlas
  true.
- The specification: [meaning](../spec/SPEC.md), [file
  format](../spec/spec/FORMAT.md),
  [operations](../spec/spec/OPERATIONS.md) and the [project
  workflow](../spec/spec/PROJECT.md).
- The [curated Styles](../styles/README.md), with a [worked
  comparison](../examples/styles.md).
- The [shipped Checks](../checks/README.md).
- The [example](../examples/README.md): a small Atlas for a fictional notes app,
  with one question followed from the top down to the sources.
