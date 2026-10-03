---
{"id":"delivery-promise","type":"decision","status":"selected","sources":[{"uri":"sources/brief.md","title":"Fictional product brief","role":"evidence","locator":"Save and delivery states"}],"uncertainty":"The chosen wording has not been tested with users. Delivery-failure and conflict wording are still open."}
---
# Say saved locally until delivery is confirmed

Use **Saved on this device** once local persistence is confirmed. Use **Sent for
sync** only after the server acknowledges that revision. A server receipt does
not show that every other device has downloaded the note, so neither state makes
that promise.

This choice gives writers a useful answer to “where is my work?” during
[offline work](offline.md). The [receipt dependency](../facets/delivery.md)
explains how Product's wording relies on Architecture's delivery rule. If that
rule changes, this decision needs review.

The [brief](../../../sources/brief.md#save-and-delivery-states) records the selected
wording. Selection establishes the intended behavior; implementation and reader
understanding still require evidence.
