---
{"id":"delivery-dependency","on":{"point":"delivery-promise"},"via":"architecture","targets":[{"point":"sync-policy"}],"sources":[{"uri":"sources/brief.md","title":"Fictional product brief","role":"evidence","locator":"Save and delivery states"}]}
---
# The delivery promise depends on a receipt

Product's [wording decision](../points/promise.md) depends on Architecture's
[receipt policy](../../architecture/points/sync.md). The product can say **Sent
for sync** once that revision has a server receipt. Before then, the wording
continues to describe the local save. Neither state establishes receipt by every
other device.

This interpretation belongs to Product: it explains what the technical condition
allows the interface to tell a writer. The [brief's chosen states](../../../sources/brief.md#save-and-delivery-states)
support that interpretation. If Architecture changes what a receipt guarantees,
review this Facet and the wording together. The dependency alone does not show
that either decision has been implemented.
