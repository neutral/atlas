---
{"id":"delivery-promise","type":"decision","status":"selected","sources":[{"uri":"sources/brief.md#save-and-delivery-states","title":"Fictional product brief","role":"evidence","sha256":"e2994693c925d2678929c7750c8abbf87fb038f30ba74335ebc6940a2c209ff3"},{"uri":"sources/brief.md#what-remains-to-be-established","title":"Fictional product brief","role":"evidence","sha256":"f86c3a8d843ff27ee1d7031ff64d567ea545d97cbfffee8899ec7a8255dc9ab3"}],"uncertainty":"The wording has not been tested with writers. Wording for a failed delivery and for conflicting revisions is still open."}
---
# A note is “Saved on this device” until a server receipt makes it “Sent for sync”

The app says **Saved on this device** once the note is stored locally. It says
**Sent for sync** only after the server has acknowledged that revision. The
brief [selects this wording](../../../sources/brief.md#save-and-delivery-states),
and asks that unsaved work, pending delivery and failed delivery each stay
visible.

The brief also gives the reason. Kept apart, the two states stop a writer from
treating a local save as a backup on another device, which matters most during
[offline work](offline.md). Neither state promises that another device has the
note: what a receipt establishes is [Storage and delivery's
rule](../../architecture/points/sync.md), and [the delivery wording depends on
that rule](../facets/delivery.md). If the rule changes, this decision is read
again.

The decision is selected, not shown to work. Writers have not been asked what
the words mean to them, and the words for a failed delivery or a conflicting
revision are [not chosen yet](../../../sources/brief.md#what-remains-to-be-established).
