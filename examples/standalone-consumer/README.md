# Installed custom Check evaluator example

This example fully verifies one optional local policy: a Point with `active` lifecycle must name at least one registered Resource in its anchor Content. It reads only captured public Library data. It does not fetch sources, judge their support or truth, judge body quality, infer authority, or adopt catalog policy.

## Install and select

Use Node 22.23.2 or later. Create a private ESM project outside the source
checkout. Copy `evaluate.mjs`, `registered-anchor-content.mjs`, and
`registered-anchor-content.md` into that project, then install Atlas:

```sh
npm init --yes
npm pkg set private=true --json
npm pkg set type=module
npm install @neutral/atlas
```

To build from source, follow the [SDK build guide](../../docs/sdk.md#build-from-source),
then install its exact archive with
`npm install --save-exact /absolute/new-sdk-artifacts/neutral-atlas-0.9.0.tgz`.
Preserve an existing host dependency policy. Installed qualification separately
checks the repository's stricter pinned pnpm policy.

Review the complete `registered-anchor-content.md` Requirement and Verification. Adopt it deliberately only if the target project needs this policy, by copying those exact bytes to `<atlas>/.checks/registered-anchor-content.md`. The example never copies a Check automatically. This custom Check is separate from the independently curated optional catalog.

Run the explicit evaluator with the Atlas absolute path and an attributed tool-run id:

```sh
node evaluate.mjs /absolute/project/atlas example-review-001
```

The command requires deliberate adoption of the custom Check, then evaluates all adopted Checks. Its registry supports only the exact custom definition. Unsupported required Checks remain `unable`; a custom Check pass cannot hide them. The result includes selected subjects, captured source identity, verifier receipt, actor, original evidence, and diagnostics. No report is retained automatically. Exit `0` means the full current run satisfies applicable required Checks, `1` means a Check failed, and `2` means missing adoption, invalid, incomplete, stale, unable, or otherwise unresolved evaluation.

For an explicitly selected MCP host module, pass this module's absolute path as `atlas-agent --evaluator-module`. The module exports `registrations`. Loading it grants no authority and adopts no Check.

## Exact behavior

The verifier receives public `point-anchor` subjects and resolves each exact id, Map, and anchor path. It filters by Point lifecycle, independently from posture and Check status. An eligible anchor passes only if at least one of its Content targets names an id in the captured Atlas Resource registry. Context-only Content, References, and direct-URI Content do not satisfy that requirement. Historical and superseded Points are exempt. An all-exempt selected scope records a vacuous pass with the inspected exemptions.

An unknown Resource id makes the Atlas structurally invalid. The Library reports that validation failure separately and does not fabricate a Check failure. A selected path scope remains partial; it cannot establish whole-Atlas compliance.

The module binds a literal SHA-256 revision of the complete included Check file. Any adopted-file byte change is unsupported until the verifier is reviewed against the changed definition and its binding is deliberately updated. The verifier does not derive a new supported revision from arbitrary adopted bytes.

Evidence records exact captured anchor and registry source hashes, inspected Content, lifecycle exemptions, matched ids, Check revision, and actor. A pass establishes this narrow membership policy only. It says nothing about the appropriateness of a Content choice.

## Catalog and qualification boundary

No semantic catalog evaluator is bundled. In particular, the optional `anchor-body` Check also requires explanation beyond a summary. Body presence cannot establish that requirement. An exact adopted `anchor-body` definition remains `unable` under this example registry, even when every anchor has a body.

Release qualification installs the exact SDK in an external consumer, copies these example files, deliberately adopts this Check into a synthetic Atlas, and runs the command. That smoke verifies the copied command and supported import. The [verification guide](../../docs/verification.md) describes broader checks and their limits. No test records a human review outcome.

The original example files use the repository's `CC0-1.0 OR 0BSD` license. The installed Library includes its complete license texts.
