---
{"id":"sync-policy","type":"decision","status":"selected","sources":[{"uri":"sources/brief.md","role":"evidence"}]}
---
# Require a receipt before reporting delivery

Synchronization retries unacknowledged changes after reconnection. A server receipt
establishes accepted delivery for that revision. Conflict handling and receipt
validation still need implementation evidence.
