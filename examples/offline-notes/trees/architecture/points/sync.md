---
{"id":"sync-policy","type":"decision","status":"selected","sources":[{"uri":"sources/brief.md","title":"Fictional product brief","role":"evidence","locator":"Save and delivery states; What remains to be established"}],"uncertainty":"Conflict handling, retry safety and receipt validation still need implementation evidence. A server receipt does not prove another device has received the revision."}
---
# Require a receipt before reporting delivery

Keep changes pending until the server acknowledges the same revision. After
reconnection, retry changes that have no receipt. The receipt establishes server
acceptance for that revision; it is not evidence that another device has already
received it.

This selected rule separates local progress from network progress. A writer can
continue editing locally while delivery waits, and the interface has a specific
condition for changing its status. [Product's receipt interpretation](../../product/facets/delivery.md)
explains the effect on wording without taking ownership of this technical rule.

The [brief](../../../sources/brief.md#save-and-delivery-states) supplies the
decision's basis. The [local restart observation](local.md) does not test this
policy. Retry safety, conflicting revisions and receipt validation remain
unverified.
