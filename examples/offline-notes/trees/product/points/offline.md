---
{"id":"offline-work","sources":[{"uri":"sources/brief.md","title":"Fictional product brief","role":"evidence","locator":"Offline work"}],"uncertainty":"The intended offline experience has only a fictional normal-restart observation. Unexpected termination and power loss remain untested."}
---
# Offline work stays on the current device

A writer should be able to create and revise notes without a connection. The
interface must show whether those changes have reached local storage before the
writer closes the app. An offline note remains work on this device; the product
must not imply that it has reached a server or another device.

[The wording decision](promise.md) develops how to express that distinction.
The surrounding editing account also has an [evidence qualification](../facets/local-limit.md):
one normal restart gives us a starting observation, while crash and power-loss
behavior remain open. That qualification matters whenever a reader interprets
“saved” as a stronger durability promise.

The [brief's offline-work section](../../../sources/brief.md#offline-work) records
the requirement. It does not establish that the full experience is implemented.
