---
{"id":"local-persistence","type":"observation","observedAt":"2026-09-20","sources":[{"uri":"sources/trial.md#conditions-and-result","title":"Fictional normal-restart trial","role":"evidence","sha256":"908029ed3380d6aecf5a2088eb0790097e053af9bfcfb32275f6b5609747d5a4"},{"uri":"sources/trial.md#limits","title":"Fictional normal-restart trial","role":"evidence","sha256":"145813f0994f8119d31fdac0fe123b7a18cbc5aa1318299b17b091de97a9bd96"}],"uncertainty":"One fictional run on one device. Durability after a crash, a forced close or power loss needs its own evidence."}
---
# One trial reopened an offline note after a normal restart

In one fictional run with no network, a writer created a note, waited for the
local-save indication, closed the app normally and reopened it on the same
device. The note's text was there. The [trial
record](../../../sources/trial.md#conditions-and-result) gives these
conditions.

The result supports the normal-restart part of [saving on the
device](purpose.md), under exactly those conditions. The trial [did not
test](../../../sources/trial.md#limits) an interrupted write, a forced close,
lost storage or lost power, and it never reconnected, so it says nothing about
delivery. [The receipt rule](sync.md) needs evidence of its own.

Product reads this observation as a [limit on its offline
promise](../../product/facets/local-limit.md). That Facet owns the consequence
for the product; this Point keeps the observation and its limits.
