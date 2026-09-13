# Start with ordinary files

Read [Working with Atlas](../../OPERATING.md). The
[minimal example directory](../valid/minimal/) is enough for a one-Map Atlas.
This larger example demonstrates optional cross-Map context; it is not a
mandatory project template.

Copy the complete directory, including `atlas.md`, `catalog.json`,
`connections.json`, and `maps/`, to an authorized project location. Replace its
fictional source and claims before using it as project context. It contains two
Points: a selected session-store decision and an API implementation observation.
The operations record is context for the decision, not another Point. Each
anchor states its idea in a heading and opening paragraph. The implementation
anchor adds its relation explanation; the operations context explains its
recovery membership. No Check catalog, publication profile, runtime, or approval
workflow is needed.

From this repository, after installing the locked dependencies, validate the
example with:

```sh
node apps/cli/bin/atlas-validate.mjs spec/examples/starter --json
```

The [project reading walkthrough](../../../docs/using-from-another-repository.md#follow-one-question-to-its-source)
operates this example from a target repository.

Try a precise route: "Where is the session-store decision?" Then try a fuzzy
route: "Redis seems risky." The API observation does not answer whether all
services migrated. Neither an absent worker Point nor missing evidence proves
worker migration failed.

For absorb, add a sourced worker observation only when supplied, keeping it
distinct from the decision. Repeating existing meaning without new evidence
should leave the files unchanged. Supporting explanations can remain prose;
no Point per sentence is required.

Automated tests validate this example and compare the independent reader. They
do not measure an agent's interpretation. The separately held review rubric
must not be supplied as the tested agent's answer key.
