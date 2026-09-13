# Changelog

## 0.9.0

- Supply the `atlas` application and public APIs through `@neutral/atlas` on npm.
  Include the local Editor, prebuilt Portal assets, operating guides, schemas,
  and licenses. Native archives also include a pinned Node runtime.
- Add project discovery, explicit initialization, automatic browser launch,
  managed durable drafts, selected site export, and agent-host configuration.
- Introduce authored format 2 with small local headers, global catalogs and
  connections, and Markdown-owned explanations. Preserve record identity across
  filename changes and resolve connections by exact identities.
- Include global declarations in authoring, workspace freshness, Check revisions,
  and exact publication projections. Reject earlier authored formats without
  conversion or compatibility aliases.
- Keep one current workspace observation in memory. Remove persistent workspace
  caches and their configuration while preserving explicit freshness checks,
  independent drafts, interrupted authoring recovery, and retained Check reports.
- Keep readable Checks discoverable during repairs and report unresolved
  applicability when the Atlas cannot establish it.
- Preserve completed agent evaluations before sizing responses. Return compact
  run identifiers and retrieve complete details and evidence in bounded chunks.
- Reopen safely readable saved drafts when source capture is incomplete. Keep
  ownership checks, diagnostics, and write restrictions explicit. Bound draft
  recovery to current text and remove discarded recovery content.
- Remove recovery originals after confirmed authoring application. Retain
  interrupted work and cleanup failures for inspection, with guarded discard of
  inactive recovery. Select exact records before assembling authoring data.
- Present selected Portal content through two-column desktop navigation and a
  mobile drawer, with direct reader routes, search, and contextual help.

### Compatibility and support

Version 0.9.0 uses Atlas format 2. Format 1 input is unsupported. Existing
workspace configuration must omit removed cache settings. Unsupported saved
plans, drafts, and recovery formats remain available for direct file inspection;
Atlas does not convert them.

The npm package requires Node.js 22.23.2 or a later compatible release. Native
archives target macOS arm64 and Linux x64; the distribution guide records their
platform qualification limits. Windows has no native archive. Hosted authoring,
automatic deployment, and measured reader or agent benefits remain outside the
release's supported claims.

## 0.8.0 — 2026-09-05

- Replace YAML front matter with strict JSON while retaining Markdown bodies.
- Clarify Point identity around independent change and simplify authoring and Check guidance.
- Release Atlas Portal with contextual navigation, search, and configurable naming and footer notices.
- Add exact Point inspection and strengthen validation, TypeScript checks, and public-tool synchronization.
- Offer original project material under CC0 1.0 Universal or 0BSD.

## 0.7.0 — 2026-08-29

- Introduce Atlas format 1 with question-led Maps, overlapping Areas, and shared Point identities.
- Define Resources, local Checks, publication profiles, schemas, and deterministic validation.
- Provide a reference validator, independent reader, 68 fixtures, Meta-Atlas, and initial pilot evidence.
