# The same material in six Styles

The [offline-notes example](README.md) adopts **Explanatory perspectives**. Its
fictional [brief](offline-notes/sources/brief.md) distinguishes saving a note on
the device from a server accepting it and from another device receiving it. Its
[trial](offline-notes/sources/trial.md) reports a note reopening after a normal
restart on one device. That result establishes neither crash recovery nor
delivery to another device, and the selected receipt rule is not evidence that it
was built. Every Style keeps these limits.

Each [curated Style](../styles/README.md) makes two choices, in two
sections. **Accounts** decides which Tree owns an explanation: one per
perspective, one per durable subject, or a central argument with supporting
accounts. **Depth** decides how much of the argument the Atlas carries:
explanatory Styles carry the main arguments, concise Styles keep each claim with
its essential reason and qualifications and send the reader to a named place in a
source for the rest. The sections below change one choice at a time over the same
material. Each describes a separate whole Atlas; the included example keeps its
own [`style.md`](offline-notes/style.md).

| Style | Accounts over this material | What the Atlas carries |
| --- | --- | --- |
| [Explanatory perspectives](../styles/explanatory-perspectives.md) | Product and Storage and delivery each own their claims about the same notes. | The main arguments, the examples they depend on, and their limits. |
| [Concise perspectives](../styles/concise-perspectives.md) | The same two perspectives. | Each claim, its essential reason and its limits; the sources carry the extended argument. |
| [Explanatory subjects](../styles/explanatory-subjects.md) | One Offline notes account holds experience, mechanism and evidence together. | The main arguments, the examples they depend on, and their limits. |
| [Concise subjects](../styles/concise-subjects.md) | The same one subject. | Each claim, its essential reason and its limits; the sources carry the extended argument. |
| [Explanatory synthesis](../styles/explanatory-synthesis.md) | A central account owns what the material establishes together; supporting accounts own complete arguments of their own. | The main arguments within each account and the reasoning that joins them. |
| [Concise synthesis](../styles/concise-synthesis.md) | The same central and supporting accounts. | Each claim, the essential connections and their limits; the sources carry the extended argument. |

## Explanatory perspectives

This is the shipped example. Product owns the writer's experience and the wording
of its promises. Storage and delivery owns the restart observation and the receipt
rule. Product's two Facets say how those technical claims limit its promises. Each
account keeps its own reasoning and can change on its own.

```text
Product experience
└─ Writers can keep working on notes when the connection drops
   └─ Offline work stays on the current device
      │  Facet, seen from Storage and delivery: The offline promise rests on one normal restart
      └─ A note is “Saved on this device” until a server receipt makes it “Sent for sync”
            Facet, seen from Storage and delivery: The delivery wording depends on the receipt rule
Storage and delivery
└─ Saving on the device and delivery to the server are separate outcomes
   ├─ One trial reopened an offline note after a normal restart
   └─ Delivery is reported only after the server acknowledges the same revision
```

The Points develop why the two states differ and why the wording matters. A note
can reopen on its device while no server or other device has it. A receipt for the
same revision establishes that the server accepted it, which permits **Sent for
sync** and still says nothing about another device downloading it. That limit is
stated once, in the receipt rule; the wording decision and its Facet link to it.
Keeping the reasoning beside the promise stops a local save from being read as a
backup elsewhere. The trial's full sequence stays in its source; its conditions
and consequences stay in the account.

## Concise perspectives

The Accounts section is the same, so the two perspectives and their ownership stay:
Product owns the promise, Storage and delivery the observation and the receipt
rule, and the Facets say what those mean for Product. Only Depth changes: each
Point keeps less, and independently referable Points do not merge or vanish.

A concise receipt Point could say: "A change is reported as **Sent for sync** only
after the server acknowledges that revision. The receipt shows server acceptance;
another device's copy and the rule's implementation are not established." It
links to the brief's [delivery states](offline-notes/sources/brief.md#save-and-delivery-states)
for the rationale and the open questions. The restart observation keeps its date,
its normal-restart conditions and the outcomes the trial did not test. Readers go
to the sources for the extended argument, while the Atlas keeps the distinctions
they need to choose and read those sources.

## Explanatory subjects

Accounts change. One **Offline notes** Tree holds the experience, the mechanism
and the evidence for that capability. Its Base explains why saving and delivery
are different outcomes. **A note saved offline stays on this device** develops the
offline promise and its limits; beneath it, **One trial reopened an offline note
after a normal restart** remains evidence a reader can refer to and assess on its
own. **Delivery is reported only after a server receipt** develops the selected
rule, its wording and the difference between the server's acceptance and another
device's copy. These Points carry the same reasoning as the perspective account,
with ownership organized around the capability.

No Facet is needed to move between experience, mechanism and evidence inside one
Tree. If another Tree later owns **Shared workspaces**, a Facet there can say how
delivery bears on that separate capability. Exact requirements and the trial
record keep their authority in the sources; the subject account develops their
reasons, consequences and limits together.

## Concise subjects

The same **Offline notes** Tree carries a shorter account. Its local-saving Point
says that a normal restart kept one note on the same device and that an unexpected
termination is untested. Its delivery Point keeps the concise receipt explanation
above. A dated observation still has its own Point when it needs its own reference
or assessment. The Base says enough to show why saving and delivery are different
outcomes.

The extended rationale and the trial's full sequence stay in the sources. A pair
of source titles with no explanation would not be Points worth reading. These short
sources make the difference in depth modest; a longer source argument would make it
plainer.

## Explanatory synthesis

Accounts change again. A central **Established guarantees** Tree answers **What
offline guarantees are established?** Its Base explains that one normal-restart run
showed a note reopening on one device, which is narrower than the brief's general
requirement that saved work stay available after a normal reopening. The selected
receipt rule says what the server's acceptance would let the interface say; it
does not establish that synchronization or delivery was built. Crash recovery,
power-loss durability and delivery to another device remain unestablished.

Two supporting Trees make complete arguments within their own scopes. **Promises and
delivery wording** explains the intended experience, why a local save and the
server's acceptance need different words, and what the chosen rule leaves open.
**Persistence evidence** explains the trial, what its conditions let a reader
conclude and what it did not test. Each keeps its own conclusions; neither is a
container of fragments for the central Tree to interpret.

```text
Established guarantees                          central account
└─ A local reopening leaves the broader promises unsettled
   ├─ One successful run does not establish the general availability promise
   │     Facet, seen from Persistence evidence: The trial's conditions limit what can be concluded
   └─ A selected receipt rule does not establish delivered behavior
         Facet, seen from Promises and delivery wording: The wording keeps a distinction that still needs evidence
Promises and delivery wording                   supporting account
└─ A local save and the server's acceptance need different promises
Persistence evidence                            supporting account
└─ One normal-restart run reopened the note on its own device
```

The central account argues across the requirement, the selected rule and the
observation. What it adds is the qualified judgment of what they establish
together, not a directory of their conclusions. Its Facets say why particular
supporting claims strengthen, limit or challenge that judgment. A supporting
account can disagree with the central reading; a Facet neither proves a
conclusion nor records the supporting author's agreement. Each Tree's scope and
Base state its role, with no field beyond the ordinary model.

## Concise synthesis

The same central and supporting accounts keep their roles and leave the extended
arguments in the sources. The central Base could say: "One fictional trial
reopened a locally saved note after a normal restart on its own device. That
bounded observation is established; the general availability requirement is not.
The selected receipt rule separates the server's acceptance from another device's
copy, but neither its implementation nor delivery was tested. Crash and power-loss
outcomes are unestablished."

Supporting Points keep the brief's essential distinctions and the trial's
conditions, with exact places in the sources for the fuller explanation. The
central account must still say why the observation falls short of the broader
requirement and why a selected rule is not evidence of behavior. Those essential
connections stay in the Atlas even when the extended reasoning stays in the
sources; links to two supporting Trees without that inference would leave the
central account's work undone.

## Place claims across source boundaries

The brief informs both the product promise and the technical receipt rule. The
trial supplies an observation and limits what writers can rely on. Under either
perspective Style, giving the whole brief to Product and the whole trial to Storage
and delivery would miss what each contributes to the other account. Each claim
belongs where its meaning is kept, and a Facet says what it means for the other
account. Under either subject Style, both contributions develop the one Offline
notes account. Under either synthesis Style, the supporting accounts own their
scoped claims and the central account owns the integrated judgment. The boundary
of a source document does not decide where a Point belongs.

Tree titles alone do not tell these Styles apart: **Storage and delivery** names a
subject, but in the shipped example its scope and Base state a perspective. Scope,
explanation and ownership make that role plain. A Style settles both choices for
the whole Atlas; a Tree does not switch Style as new material arrives.

## Rehearse a reading and an update

Ask a reader who did not write the account: "After a normal restart, can the
writer say the note is available on another device?" A sufficient answer keeps
the local save, the server's acceptance, delivery and the evidence's scope apart,
and names where to check the basis. Record the path the reader took and anything
they had to reconstruct. Compare with a competent reading of the brief and the
trial alone, allowing the source reading each Style expects. A neat outline
establishes no benefit by itself.

Then supply a fictional follow-up report: a note failed to reopen after a forced
termination, while normal restarts still passed. Under either perspective Style,
review the restart observation in Storage and delivery, Product's Facet on offline
work, and the claims above them. Under either subject Style, review the
local-saving Point and its Base. Under either synthesis Style, update Persistence
evidence first, then the Facets that draw on it and the central conclusions. The
judgment can move from "forced termination untested" to "an observed failure under
stated conditions"; that finding still does not settle what happens after every
termination or during delivery. Reread the claims above where their meaning
changes, without rewriting every summary. Keep the earlier observation's date and
conditions: the new failure does not overturn what that normal-restart run saw.
Explanatory Styles develop the resulting argument in the Atlas; concise Styles keep
its central meaning and its essential qualification, with an exact place in the
source for more.

Read the reading question through the complete candidate again before applying.
Name a specific reading or upkeep problem before proposing a restructure, and stop
when the Style gives a coherent, qualified path. This rehearsal makes review
behavior inspectable; only trials with independent readers can show that one Style
serves readers better than another.
