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

## Style

A Style is the adopted policy for organizing and developing an Atlas. It explains
Tree boundaries and ownership, the use of Points, Branches and Facets, how much
understanding the Atlas carries apart from its sources, and how the account
evolves. Several policies can satisfy the core; the adopted Style settles the
authoring choices that remain open within it. Core requirements always take
precedence. A Style cannot relax identity, ownership, explanation, uncertainty
or source boundaries.

An Atlas using the styled format MUST have exactly one active, locally captured
Style. That complete definition governs the whole Atlas; authors MUST NOT switch
or mix organizing policies during ordinary maintenance. Trees may differ in size
and shape within the same policy. Authors MUST apply the adopted Style when
placing, developing and reviewing knowledge, independently of optional Checks.
Revising or replacing the Style requires an explicit user decision and review of
its consequences for existing accounts. Once adopted, the Atlas MUST retain a
complete active Style; reverting to the legacy unstyled format is not a permitted
Style change. New upstream definitions MUST NOT silently
change an adopted Style. Users MAY adopt, revise or supply their own complete
definition, subject to the same core requirements.

The [curated catalogue](../styles/README.md) offers complete starting
policies and explains the authoring choices they settle.

The legacy format remains valid without a Style; consumers MUST NOT invent a
selected policy for it. Adoption is an explicit change, not an automatic
interpretation of its existing outline.

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
remain visible as limitations, not be presented as inspected evidence. Derived
Markdown references and direct-citer indexes provide navigation and review cues;
they MUST NOT be interpreted as authored dependency, support or endorsement. A
source-only change can warrant review without changing the authored Atlas or
establishing that its explanation is false.

Point Types are optional interpretation contracts. The supported Types are
`decision` and `observation`. A decision records source-backed status; selection
does not establish implementation. An observation records when something was
observed and its source; it does not establish continuing validity. Untyped Points
remain valid.

## Absorb and Route

Absorb reconciles incoming material with existing identity, ownership and meaning.
It identifies an update, a new contribution, useful contextual interpretation,
unresolved conflict or justified non-integration. It considers affected higher
explanations and connected accounts within the adopted Style, when present.
Those judgments MUST remain explicit;
Absorb MUST NOT rewrite ancestors merely because a detail changed. Deliberate
removal and consolidation MUST identify the affected identity and rationale;
optional surviving destinations aid review without creating a permanent
replacement graph. A retained proposal may carry its contribution reasoning,
unresolved questions and explicitly scoped preservation review. Such records
describe the author's decisions; they establish neither completeness nor approval.
Ordinary edits require no universal source-unit inventory.

Route selects an appropriate starting level and returns a coherent reading path.
It exposes explanations, supporting detail, relevant Facets, sources and uncertainty.
Search proposes candidates; identity and relevance require comparison of meaning.
A missing authored connection does not establish absence of impact. Discovery
previews and compact orientation MAY reduce repeated reading, but MUST preserve
identity, uncertainty and a path to the complete authored explanation. Omitted
results and continuation boundaries MUST remain explicit.

## Checks and authority

Atlas defines identity, ownership, organization, Facet interpretation and source
boundaries. A Style selects the organizing and development policy within those
requirements. Optional Checks add project-specific requirements or review depth.
They MAY demand exhaustive source accounting or broader evidence review.

Atlas records, source references and Checks grant no file, network, credential,
execution or publication authority. Consumers act only within caller-supplied
permissions. Structural validity, Check compliance, operational correctness and
reader usefulness are distinct claims with distinct evidence.
