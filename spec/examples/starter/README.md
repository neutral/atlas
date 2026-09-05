# Start with ordinary files

Read [Working with Atlas](../../OPERATING.md). The [minimal example](../valid/minimal/atlas.md) is enough for a one-Map Atlas. This larger example demonstrates optional cross-Map context; it is not a mandatory project template.

Copy this directory to an authorized project location and replace its fictional source and claims. It contains two Points: a selected session-store decision and an API implementation observation. The operations record is context for the decision, not another Point. Both anchors are summary-only; only the useful recovery membership introduces an Area. No Check catalog, publication profile, runtime, or approval workflow is needed.

From this repository, after installing the locked dependencies, validate the example with:

```sh
corepack pnpm@11.22.0 --dir tools exec atlas-validate ../spec/examples/starter --json
```

Try a precise route: "Where is the session-store decision?" Then try a fuzzy route: "Redis seems risky." The API observation does not answer whether all services migrated. Neither an absent worker Point nor missing evidence proves worker migration failed.

For absorb, add a sourced worker observation only when supplied, keeping it distinct from the decision. Repeating existing meaning without new evidence should leave the files unchanged. Supporting explanations can remain prose; no Point per sentence is required.

Automated tests validate this example and compare the independent reader. They do not measure an agent's interpretation. The separately held review rubric must not be supplied as the tested agent's answer key.
