# Atlas

An Atlas explains a project. A reader, who may be a person or a software agent,
descends from an account's top claim to the detail that supports it. The agents
who keep the Atlas can keep it true. Source documents and code remain
independently useful; an Atlas explains them and leads back to them.

This document owns meaning. [Format](spec/FORMAT.md) owns encoding,
[Operations](spec/OPERATIONS.md) owns reading and changing behavior, and the
[project workflow](spec/PROJECT.md) owns discovery and local setup. Uppercase
MUST, MUST NOT, SHOULD and MAY express normative requirements.

## Atlas and Tree

Within an Atlas, Tree IDs are unique among Trees, Point IDs among Points, Facet
IDs within their Tree and Check IDs among Checks. A Tree owns an
account: one declared subject seen from one declared perspective. Its scope
says what belongs in it and guides placement. A Tree MAY follow a product, a
discipline or a question the project keeps answering.

Each Tree has exactly one Base Point. The Base is an ordinary Point. Its claim
is the account's top claim and its explanation says what the account
establishes as a whole. It MAY stand alone while its account develops. Tree
metadata records identity and scope; the Base explains the subject.

## Point

A Point is one claim and its explanation: project knowledge that is meaningful
on its own and can be referred to. Its title states the claim and its body
explains it. The title SHOULD be a sentence a reader could check or dispute,
so that the titles down a path read as an argument. A Point MUST have exactly
one owning Tree and one place in it. Its ID remains stable through revision
and path changes.

A Point develops into further Points. A development is a claim the Point above
depends on, qualifies or details, and that needs its own reference, assessment
or revision. Placement provides context; support comes from sources and
reasoning. Every level explains: a higher Point says what its developments
establish together, and its claim MUST stay within what they and its sources
support. Knowledge that needs independent reference has one owning Point;
other records refer to it instead of restating it differently. Links provide
references; they leave ownership and placement unchanged.

Every Point MUST keep the scope and uncertainty that limit its claim. A
statement that rests on the account's own reading, not on a source, MUST say
so where it stands.

## Facet

A Facet attaches to a Point and reads that Point's claim through another Tree.
It names that Tree, the Points there that bear on the claim, and what follows
from them, such as a dependency, a qualification, a consequence or a tension.
A Facet earns its place when the other account holds something that changes
how the host claim should be read. A reference alone is a link.

The host account owns this reading. A Facet MUST NOT redefine its targets or
imply their author's endorsement. It transfers no ownership and creates no
second placement. Reverse and transitive consequences are not inferred.
Facets are optional. Material outside the Atlas can support the reading
through source references.

## Sources and Types

A source reference identifies material an explanation rests on or points to.
It preserves the available role, revision and locator. A reference MAY carry a
stamp: the hash of the cited material as it stood when the explanation was
last checked against it. A stamp that no longer matches shows that the
material changed. That is a reason to read the explanation again; it does not
establish that the explanation is false, and a matching stamp does not
establish that it is true.

A reference establishes neither truth nor permission to retrieve the material.
Missing or inaccessible sources MUST remain visible as limits and MUST NOT be
presented as inspected evidence. Indexes derived from links and references
provide navigation and review cues; they MUST NOT be read as authored
dependency, support or endorsement.

Point Types are optional interpretation contracts. The supported Types are
`decision` and `observation`. A decision records its standing: `open` (not
yet decided), `proposed` (put forward, not chosen), `selected` (chosen),
`rejected` (considered and not chosen) or `superseded` (replaced by a later
decision); selection does not establish implementation. An observation records when something was
observed and its source; it does not establish continuing validity. Untyped
Points remain valid.

## Style and Checks

Several ways of organizing an account satisfy this specification. An Atlas
states its own in its Style: which accounts it keeps and what each owns, how
much of the argument it carries apart from its sources, and its own writing
conventions. An Atlas MUST have exactly one Style, kept with it as authored
content. Authors MUST read and apply it when placing, developing and reviewing
knowledge. A Style MUST NOT relax anything in this specification.

Changing the Style is the owner's decision. It MUST be made as a visible
change of its own, with its consequences for the existing accounts reviewed,
and MUST NOT happen as a side effect of other work. A change to a curated
definition elsewhere MUST NOT alter an Atlas's own Style. The
[curated catalogue](../styles/README.md) offers starting definitions.

A Check states a requirement that changes to this Atlas must meet, how to
verify it and what failure means. Checks are optional. A `required` Check
must pass, by the reviewer's report, before whoever authorizes a change
applies it; an `advisory` one informs that decision without deciding it. A reviewer verifies a
Check and reports the outcome with its evidence; Atlas establishes only that
the Check is well formed. The [shipped Checks](../checks/README.md)
offer review requirements a project may adopt.

## Reading

Route selects a starting level and returns a reading path: the claims above,
the selected explanation, its developments, the Facets that bear on it, its
sources and its uncertainty. Search proposes matches; identity and relevance
require comparison of meaning. A missing match or a missing authored
connection does not establish absence. A compact result that stands in for an
explanation MAY reduce repeated reading, but MUST preserve identity, standing,
uncertainty and a path to the complete explanation. A list of results MUST
show each result's standing and say when results were left out, and
continuation boundaries MUST remain explicit.

A presentation of an Atlas MUST keep the account that owns each explanation
visible, MUST distinguish a Facet's reading from its targets' own claims, and
MUST NOT execute authored content.

## Keeping an Atlas true

An Atlas binds nothing in the project it explains, so nothing in that project
tests it. It stays true through how it is changed and how it is read.

A change is prepared whole, validated whole and applied whole. A candidate
that fails validation MUST NOT be applied. Absorb reconciles incoming material
with the identity, ownership and meaning the Atlas already holds: it updates
the owning explanation, adds a development, adds a Facet or a reference,
records a conflict, or leaves the material out. Those judgments are the
author's and MUST be stated with the change. Absorb MUST NOT rewrite a higher
explanation merely because a detail changed, and MUST reread it. A removal
names what goes and where its meaning now lives.

Structural validity, agreement with the sources and usefulness to a reader are
distinct claims with distinct evidence. Validation establishes the first.
The second is established by reading statements against the material they
cite, and the third by readers who have only the Atlas. An author's own
reading of their change establishes neither, and a consumer MUST NOT present
one of these claims as another.

## Authority

Atlas records, source references and Checks grant no file, network,
credential, execution or publication authority. Consumers act only within
caller-supplied permissions.
