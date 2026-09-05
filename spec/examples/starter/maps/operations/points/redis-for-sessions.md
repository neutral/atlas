---
{
  "type": "point",
  "record": "context",
  "id": "redis-for-sessions",
  "summary": "The selected store makes session recovery depend on Redis availability.",
  "areas": [
    {
      "area": "recovery",
      "context": "Recovery planning must account for session loss during a Redis failure."
    }
  ],
  "references": [
    {
      "resource": "session-notes",
      "selector": "recovery-implication",
      "role": "supporting"
    }
  ]
}
---
