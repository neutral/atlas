---
{
  "type": "point",
  "record": "anchor",
  "id": "api-session-migration",
  "title": "API sessions use Redis",
  "summary": "API session storage uses Redis in release r17.",
  "kinds": [
    "implementation"
  ],
  "posture": "asserted",
  "lifecycle": "active",
  "references": [
    {
      "resource": "session-notes",
      "selector": "observed-implementation",
      "role": "evidence"
    }
  ],
  "relations": [
    {
      "type": "implements",
      "point": "redis-for-sessions",
      "note": "The observation covers API adoption only, not migration of every service."
    }
  ]
}
---
