---
{"id":"sync-policy","type":"decision","status":"selected","sources":[{"uri":"sources/brief.md#save-and-delivery-states","title":"Fictional product brief","role":"evidence","sha256":"e2994693c925d2678929c7750c8abbf87fb038f30ba74335ebc6940a2c209ff3"},{"uri":"sources/brief.md#what-remains-to-be-established","title":"Fictional product brief","role":"evidence","sha256":"f86c3a8d843ff27ee1d7031ff64d567ea545d97cbfffee8899ec7a8255dc9ab3"}],"uncertainty":"Conflict handling, safe retries and receipt validation have no implementation evidence."}
---
# Delivery is reported only after the server acknowledges the same revision

A change stays pending until the server acknowledges that exact revision.
After the connection returns, the app retries every change that has no
receipt. The brief [selects this rule](../../../sources/brief.md#save-and-delivery-states).

A receipt establishes one thing: the server accepted that revision. It does
not establish that another device has downloaded it.

The rule keeps local progress apart from network progress. A writer goes on
editing while delivery waits, and the interface has one exact condition for
changing a note's state. Product reads the rule in [the delivery wording
depends on the receipt rule](../../product/facets/delivery.md). [The restart
trial](local.md) does not test it. Safe retries, conflicting revisions and
receipt validation are [still to be
established](../../../sources/brief.md#what-remains-to-be-established).
