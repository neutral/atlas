---
type: point
record: anchor
id: service-boundary
title: Service boundary
summary: Canonical context for service boundary.
kinds:
- decision
posture: asserted
lifecycle: active
areas:
- area: scope
  context: The public API fixes the supported operating surface.
- area: scope
  context: Internal modules remain outside the supported operating surface.
---

# Service boundary

The service boundary is fixed at the public API.
