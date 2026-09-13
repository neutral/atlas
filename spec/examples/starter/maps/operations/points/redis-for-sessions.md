---
{
  "type": "point",
  "record": "context",
  "id": "redis-for-sessions"
}
---

# Redis is the selected session store

The selected store makes session recovery depend on Redis availability.

## Connection: operations-redis-for-sessions-area-recovery

Recovery planning must account for session loss during a Redis failure.
