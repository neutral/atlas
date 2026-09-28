# Atlas

Atlas provides portable, navigable project context for people and software agents.
Trees organize that context into coherent accounts. Source documents and code
remain independently useful; Atlas adds context and paths back to them.

This document owns meaning. [Format](spec/FORMAT.md) owns encoding, and
[Operations](spec/OPERATIONS.md) owns reading and authoring behavior. Uppercase
MUST, MUST NOT, SHOULD and MAY express normative requirements.
The [project workflow](spec/PROJECT.md) defines discovery and local setup.

## Atlas and Tree

An Atlas provides one identity namespace for Trees and Points. A Tree owns an
account of a declared subject and perspective. Its scope guides placement. A Tree
MAY follow a product or a discipline.

Each Tree has exactly one Base Point. The Base is an ordinary Point that establishes
the subject, scope and highest-level explanation. It MAY stand alone while its
account develops. Tree metadata records identity and scope; the Base explains
the subject.

## Point and Branch

A Point is independently meaningful and referable project knowledge. A Point MUST
have exactly one owning Tree and one structural home. Its ID remains stable through
ordinary revision and path changes. Separate claims deserve separate Points when
they need independent reference, assessment or revision, even when they share a
subject.

Points hold explanations at all detail levels. Base, summary, reasoning and detail
are roles performed by the same content unit. Higher Points explain the significance
of their developments. Parent-child placement provides context; support comes from
sources and reasoning. Every Point MUST preserve relevant scope and uncertainty.

A Branch organizes a coherent part of its Tree through Points and further Branches.
It has a Tree-local identity and a label; its Points carry the explanations.
The Tree outline records structural membership. Links provide references; they
leave ownership and placement unchanged.

## Facet

A Facet attaches to a Point or Branch and interprets that host's matter through
another Tree. It identifies that Tree, its relevant targets, and the reason the
relationship matters, such as a dependency, qualification, consequence or tension.

The host account owns this interpretation. A Facet MUST NOT redefine its targets
or imply their author's endorsement. It does not transfer ownership, create a
second placement, or automatically assert the same interpretation about every
descendant of a Branch. Reverse and transitive consequences are not inferred.

Facets are optional. Point and Branch targets retain stable identity. Material
outside Atlas can support the interpretation through source references.

## Sources and Types

A source reference identifies supporting or contextual material. It preserves the
available revision, locator and evidence boundary. A reference does not establish
truth or permission to retrieve the material. Missing or inaccessible sources MUST
remain visible as limitations, not be presented as inspected evidence.

Point Types are optional interpretation contracts. The supported Types are
`decision` and `observation`. A decision records source-backed status; selection
does not establish implementation. An observation records when something was
observed and its source; it does not establish continuing validity. Untyped Points
remain valid.

## Absorb and Route

Absorb reconciles incoming material with existing identity, ownership and meaning.
It identifies an update, a new contribution, useful contextual interpretation,
unresolved conflict or justified non-integration. It considers affected higher
explanations and connected accounts. Those judgments MUST remain explicit;
Absorb MUST NOT rewrite ancestors merely because a detail changed.

Route selects an appropriate starting level and returns a coherent reading path.
It exposes explanations, supporting detail, relevant Facets, sources and uncertainty.
Search proposes candidates; identity and relevance require comparison of meaning.
A missing authored connection does not establish absence of impact.

## Checks and authority

Atlas defines identity, ownership, organization, Facet interpretation and source
boundaries. Optional Checks add project-specific requirements or review depth.
They MAY demand exhaustive source accounting or broader evidence review.

Atlas records, source references and Checks grant no file, network, credential,
execution or publication authority. Consumers act only within caller-supplied
permissions. Structural validity, Check compliance, operational correctness and
reader usefulness are distinct claims with distinct evidence.
