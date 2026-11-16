---
{"id":"delivery-dependency","on":"delivery-promise","via":"architecture","targets":["sync-policy"],"sources":[{"uri":"sources/brief.md#save-and-delivery-states","title":"Fictional product brief","role":"evidence","sha256":"e2994693c925d2678929c7750c8abbf87fb038f30ba74335ebc6940a2c209ff3"}]}
---
# The delivery wording depends on the receipt rule

Read through Storage and delivery, [the wording decision](../points/promise.md)
holds only as far as [the receipt rule](../../architecture/points/sync.md)
does. The app may say **Sent for sync** once that revision has a receipt, and
not before. Until then it goes on saying the note is saved on this device.

So the wording promises no more than a receipt does: the server accepted the
revision, and nothing about other devices. If Storage and delivery changes what
a receipt means, this reading and the wording are read again together. The
dependency shows that one decision relies on the other; it does not show that
either is built.
