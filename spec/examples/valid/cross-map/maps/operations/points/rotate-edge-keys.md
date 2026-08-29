---
type: point
record: anchor
id: rotate-edge-keys
title: Rotate edge keys
summary: Canonical context for rotate edge keys.
kinds:
- decision
posture: asserted
lifecycle: active
areas:
- area: runtime
  context: "This record affects Runtime because canonical context for rotate edge keys."
- area: security
  context: "This record affects Security because canonical context for rotate edge keys."
relations:
- type: depends-on
  point: edge-authentication
  note: Rotation exists to preserve the edge boundary.
---

# Rotate edge keys

This anchor record states a substantive project decision in its own right. It explains the governing boundary, the reason that the boundary exists, and the consequences that readers and software agents must preserve when they change related documents or implementation. The body is intentionally long enough to satisfy the deterministic anchor substance rule without relying on headings or link destinations.
