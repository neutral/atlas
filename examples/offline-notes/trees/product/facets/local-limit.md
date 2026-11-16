---
{"id":"local-evidence-limit","on":"offline-work","via":"architecture","targets":["local-persistence"],"sources":[{"uri":"sources/trial.md#limits","title":"Fictional normal-restart trial","role":"evidence","sha256":"145813f0994f8119d31fdac0fe123b7a18cbc5aa1318299b17b091de97a9bd96"}]}
---
# The offline promise rests on one normal restart

Read through Storage and delivery, [offline work](../points/offline.md) has one
piece of evidence: [one trial](../../architecture/points/local.md) reopened a
saved note after a normal restart. The [trial's
limits](../../../sources/trial.md#limits) leave an interrupted write, a forced
close and lost power untested.

Product can use the result for that narrow case. It cannot turn it into a
promise that no writing is ever lost offline. The result says nothing about
[the delivery wording](../points/promise.md) either: the trial never
reconnected.
