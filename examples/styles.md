# The same material in six Styles

The [offline-notes example](README.md) adopts **Explanatory perspectives**. Its
fictional [brief](offline-notes/sources/brief.md) distinguishes local saving from
server acceptance and delivery to another device. Its
[trial](offline-notes/sources/trial.md) reports a note reopening after a normal
restart on one device. That result establishes neither crash recovery nor
cross-device delivery. The selected receipt policy is not evidence of its
implementation. Every Style preserves these boundaries.

The comparisons below describe separate whole Atlases over that material. The
included example retains its complete [local Style](offline-notes/style.md).

| Style | Ownership | Explanation carried in Atlas |
| --- | --- | --- |
| [Explanatory perspectives](../styles/explanatory-perspectives.md) | Product and Architecture own distinct accounts of shared subjects. | The main arguments, consequential examples and qualifications. |
| [Concise perspectives](../styles/concise-perspectives.md) | The same perspective boundaries can remain. | Central meaning, essential reasons and qualifications; sources carry extended arguments. |
| [Explanatory subjects](../styles/explanatory-subjects.md) | Offline notes combines experience, mechanisms and evidence. | The main arguments, consequential examples and qualifications. |
| [Concise subjects](../styles/concise-subjects.md) | The same subject boundary can remain. | Central meaning, essential reasons and qualifications; sources carry extended arguments. |
| [Explanatory synthesis](../styles/explanatory-synthesis.md) | A central account owns the project's integrated conclusions; supporting accounts own complete scoped arguments. | The main arguments within each account and the reasoning connecting them. |
| [Concise synthesis](../styles/concise-synthesis.md) | The same central and supporting roles can remain. | Central meaning, essential connections and qualifications; sources carry extended arguments. |

## Explanatory perspectives

Product owns the writer's experience and the wording of its promises. Architecture
owns the local-persistence observation and selected receipt policy. Product's
Facets explain how those technical claims qualify its promises. Each account has
its own reasoning and can change independently.

```text
Product experience
└─ Keep writing when the connection drops
   └─ Working without a connection                  Branch
      ├─ Facet: Editing availability has limited evidence
      └─ Offline work stays on the current device
         └─ Say saved locally until delivery is confirmed
            └─ Facet: The delivery promise depends on a receipt
Storage and delivery
└─ Persistence and delivery are separate outcomes
   ├─ The trial reopened an offline note
   └─ Require a receipt before reporting delivery
```

The Points develop why these states differ and why the wording matters. A note
can reopen locally while no server or other device has received it. A receipt
for the same revision establishes server acceptance, which permits the selected
wording **Sent for sync** but still says nothing about another device downloading
it. Keeping that reasoning beside the promise prevents a local save from being
mistaken for a backup elsewhere. The trial's full sequence stays in its source;
its conditions and consequences remain in the account.

## Concise perspectives

Product and Architecture can retain those same boundaries. Product still owns the
promise, Architecture the observation and receipt policy, and the Facets their
consequences for Product. The Branch still labels a coherent group; Points carry
explanations. Concision changes the amount retained, without requiring the two
perspectives to merge or independently referable Points to vanish.

A concise receipt Point could say: “The selected policy permits **Sent for sync**
only after a server receipt for the same revision. This confirms server acceptance;
another device's receipt of that revision and the policy's implementation remain
unestablished.” It links to the brief for the fuller rationale and remaining
questions. The local observation retains its date, normal-restart conditions and
untested crash behavior. Readers use the sources for extended explanation while
Atlas keeps the distinctions needed to choose and interpret those sources.

## Explanatory subjects

One **Offline notes** Tree combines the experience, mechanism and evidence for
that capability. Its Base explains the relationship between saving and delivery.
**Local saving is limited to this device** develops the offline promise and its
limits; beneath it, **The trial reopened an offline note** remains independently
referable evidence. **Delivery requires a receipt** develops the selected policy,
its wording and the distinction between server acceptance and another device's
copy. Those explanations carry the same substantial reasoning as the explanatory
perspective account, with ownership organized around the capability.

No Facet is needed to move between experience, mechanism and evidence within this
Tree. Branches can label useful groups as the subject develops, without becoming
separate accounts. If another Tree later owns **Shared workspaces**, a Facet can
explain how delivery affects that separate capability. Exact requirements and
trial records retain their source owners; the subject account develops their
reasons, consequences and limits together.

## Concise subjects

The same **Offline notes** Tree can carry a shorter account. Its local-saving
Point explains that a normal restart preserved one note on the same device and
that unexpected termination remains untested. Its delivery Point retains the
concise receipt explanation above. A dated observation can still have its own
Point when it needs independent assessment or reference. The Base provides enough
context to understand why saving and delivery are different outcomes.

Extended rationale and the complete trial sequence remain in the sources. The
Tree integrates relevant experience, mechanism and evidence; Branches and Facets
serve the same subject organization as in Explanatory subjects. A pair of source
titles with no explanation would fail the core requirement for meaningful Points.
These short sources make the depth difference modest; a longer source argument
would make the distinction more visible.

## Explanatory synthesis

A central **Established guarantees** Tree answers: **What offline guarantees are
established?** Its Base explains that one normal-restart run demonstrated local
reopening on one device. This is narrower than establishing the brief's general
requirement that saved work remain available after normal reopening. The selected
receipt rule explains what server acceptance would permit the interface to say;
it does not establish implemented synchronization or delivery. Crash recovery,
power-loss durability and cross-device delivery remain unestablished.

Two supporting Trees develop complete accounts within their own scopes.
**Promises and delivery wording** explains the intended experience, why local
saving and server acceptance need different language, and what the chosen policy
leaves open. **Persistence evidence** explains the trial, what its conditions let
us conclude and what it did not test. These Trees retain their own conclusions
and reasoning; they are not containers for fragments awaiting interpretation by
the central Tree.

```text
Established guarantees                         Central account
└─ A local reopening observation leaves broader promises unsettled
   ├─ One successful run does not establish the general availability promise
   │  └─ Facet: The trial's conditions limit what can be concluded
   └─ A selected receipt policy does not establish delivered behavior
      └─ Facet: Intended wording preserves a distinction still needing evidence
Promises and delivery wording                   Supporting account
└─ Local saving and server acceptance require distinct promises
Persistence evidence                           Supporting account
└─ One normal-restart run reopened the note on its original device
```

The central account explains the inference across requirements, selected policy
and observation. Its contribution is the qualified assessment of what they
jointly establish, rather than a directory of their conclusions. Its Facets
interpret why particular supporting claims strengthen, limit or challenge that
assessment. A supporting account can disagree with the central interpretation;
a Facet neither proves a conclusion automatically nor records the target author's
endorsement.

Each Tree's scope and Base explain its role using the existing model. No new
Tree field or second structural home is needed. Points develop the arguments,
Branches can group related developments, and sources retain exact requirements
and the trial sequence. The different Tree roles belong to one synthesis policy
throughout the Atlas.

## Concise synthesis

The same central and supporting accounts can retain their roles while leaving
extended arguments in the sources. The central Base could say: “One fictional
trial reopened a locally saved note after a normal restart on its original
device. This establishes that bounded observation; the general availability
requirement remains unestablished. The selected receipt rule distinguishes server
acceptance from another device's copy, but neither its implementation nor delivery
was tested.
Crash and power-loss outcomes remain unestablished.”

Supporting Points retain the brief's essential distinctions and the trial's
conditions, with precise paths to fuller explanations. The central account must
still explain why the observation falls short of the broader requirement and why
a selected rule is not evidence of behavior. Those essential connections belong
in Atlas even when extended reasoning stays in sources. Links to two supporting
Trees without this inference would leave the central account's work undone.
Facets preserve the same interpretations and disagreement boundaries as in
Explanatory synthesis.

## Place claims across source boundaries

The brief informs both the product promise and technical receipt policy. The
trial supplies an observation and qualifies what writers can rely on. In either
perspective Style, assigning the entire brief to Product and the entire trial to
Architecture would miss those contributions across accounts. Each claim belongs
where its meaning is maintained; a Facet explains the other account's consequence.
In either subject Style, those contributions develop the Offline notes account
together. In either synthesis Style, the supporting accounts own their scoped
claims and the central account owns the project's integrated assessment. Supporting
accounts can still interpret other accounts where their own arguments need those
connections. The source document's boundary does not determine Point ownership.

Tree titles alone cannot distinguish these policies: **Storage and delivery**
names a subject but develops Architecture's perspective in the included example.
Scope, explanation and ownership make that role clear. Choosing a Style settles
both organization and source depth for the whole Atlas; individual Trees do not
switch policies as new material arrives.

## Rehearse a reading and an update

Ask a reader who did not author the account: “After a normal restart, can the
writer say the note is available on another device?” A sufficient answer keeps
local persistence, server acceptance, delivery and evidence scope distinct and
identifies where to inspect the basis. Record the path and any reconstruction
needed. Compare with competent reading of the same brief and trial, allowing
the source reading expected by each Style. A neat outline alone establishes
no benefit.

Then supply a fictional follow-up report: local reopening failed after a forced
termination, while normal restarts still passed. Under either perspective Style,
review Architecture's local-persistence account, Product's evidence-qualification
Facet and affected higher explanations. Under either subject Style, review the
local-saving account and its Base. Under either synthesis Style, update the
Persistence evidence account first, then inspect the affected Facets and central
conclusions. The assessment may change from an untested forced-termination outcome
to an observed failure under stated conditions; that finding still does not
establish what happens after every termination or during delivery. Reconsider the
central explanation where its meaning changes, without automatically rewriting
every summary. Preserve the earlier observation's date and conditions; the new
failure does not overturn what that normal-restart run saw.
Retain the new finding's conditions and consequences in every version. Explanatory
Styles develop the resulting argument in Atlas; concise Styles retain its central
meaning and essential qualification with a precise source path for more detail.

Follow the reading question through the complete candidate again. Record a
specific reading or maintenance failure before proposing a restructure, and stop
when the selected Style provides a coherent, qualified path. This rehearsal makes
review behavior inspectable; independent reader trials are needed to establish
comparative usefulness.
