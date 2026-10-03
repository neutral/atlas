---
{"id":"local-persistence","type":"observation","observedAt":"2026-09-20","sources":[{"uri":"sources/trial.md","title":"Fictional normal-restart trial","role":"evidence","locator":"Conditions and result; Limits"}],"uncertainty":"Evidence covers one fictional normal restart on the same device after the local-save indication. Crash and power-loss durability require separate evidence."}
---
# The trial reopened an offline note

In one fictional run, a note created offline was still available after a normal
app restart on the same device. The writer waited for the local-save indication
before closing the app. The [trial record](../../../sources/trial.md) gives the
conditions and the outcomes it did not test.

This result supports the normal-restart part of the intended experience under
those conditions. It says nothing about an interrupted write, unexpected
termination, power loss or delivery to a server. [The receipt policy](sync.md)
therefore needs separate verification.

Product uses this observation to [qualify the editing account](../../product/facets/local-limit.md).
That Facet explains the consequence for the product promise; this Point retains
the observation and its limits.
