# Atlas Styles

A Style settles the authoring choices that make an Atlas coherent over time:
what belongs together, how explanations develop, what readers learn in Atlas and
what remains in sources. Several policies can produce valid accounts of the same
material. Adopting one gives later authors a shared basis for placement, source
reading and maintenance.

The [core specification](../spec/SPEC.md#style) defines the meanings and
requirements every Atlas respects. Each Style is a complete policy within those
requirements, expressed in four paragraphs covering Tree ownership, Points and
connections, source depth, and evolution.

## The catalogue

The current six Styles make two independent choices: **ownership** and
**explanatory responsibility**. Ownership determines which account develops an
explanation. Explanatory responsibility determines how much of the argument Atlas
carries apart from its sources.

| Tree ownership | Main arguments developed in Atlas | Extended arguments remain in sources |
| --- | --- | --- |
| Distinct perspectives on shared subjects | [Explanatory perspectives](explanatory-perspectives.md) | [Concise perspectives](concise-perspectives.md) |
| Integrated subjects or capabilities | [Explanatory subjects](explanatory-subjects.md) | [Concise subjects](concise-subjects.md) |
| A central synthesis with supporting accounts | [Explanatory synthesis](explanatory-synthesis.md) | [Concise synthesis](concise-synthesis.md) |

The entries describe ways of writing the same knowledge. Each can explain facts,
decisions, observations and unresolved questions. Their differences concern where
that understanding lives and how it is developed.

## Ownership

Perspective policies develop distinct accounts across shared subjects. In a coding
project, Product can explain the intended experience, Architecture its mechanisms,
and Reliability what failures and evidence establish. The same capability matters
to all three, while each account owns different explanations. Facets develop the
consequences between them.

Subject policies bring the relevant perspectives together within a durable subject
or capability. An Offline work Tree can explain its intended experience, storage
choices, failure conditions and evidence together. Its Points preserve the distinct
claims and qualifications; Facets explain consequences involving other subjects.
In knowledge work, an evaluation of several proposals could similarly use economic,
environmental and operational perspectives, or one integrated Tree per proposal.

Synthesis policies assign one central Tree responsibility for the project's
integrated argument. Supporting Trees develop complete arguments within their
scopes, including their own conclusions. The central account explains what follows
from considering those arguments together: combined conclusions, tensions and
unresolved questions. Each Tree's scope and Base make its role explicit. Facets
explain why another account strengthens, limits or challenges a claim, preserving
the target's scope without implying proof or endorsement.

Choose this family when the project needs an integrated argument maintained in one
place. A central assessment could combine mechanisms, reliability evidence and
operating requirements to explain whether a limited pilot is warranted. The
reliability account still owns what its tests establish. A directory of the
supporting accounts would not fulfill the central role. Different responsibilities
belong to this one policy; its depth commitment applies to every account.

Ownership follows the account's scope and explanations. A document can contribute
to several accounts, and a subject name can label a perspective. Summaries retain
the context readers need; the primary explanation provides the maintained home
for its reasoning and sources. Tree titles and source-file boundaries alone do
not decide placement.

## Explanatory responsibility

Explanatory policies develop the main arguments in Atlas: reasons, consequential
alternatives, examples, qualifications and implications. Readers can understand
those arguments before opening the underlying material. Maintaining that synthesis
requires reviewing its meaning when the material changes.

Concise policies retain central meaning, essential reasons and qualifications,
then direct readers to sources for extended arguments. Source reading is an
expected part of understanding the account in depth. Atlas expands when readers
repeatedly need to reconstruct an important connection that belongs in its account.

This choice concerns the explanation Atlas undertakes to provide. It sets no word
count or fixed Tree size. Exact requirements, procedures, code and raw evidence
can retain their source authority under every Style. A concise Point still explains
its claim, and an explanatory account selects the detail needed for understanding.
The [worked comparison](../examples/styles.md) applies all six policies to the
same material and a subsequent finding.

## Establish a policy for a project

Choose the accounts that need to develop together, then decide what readers should
understand before returning to sources. Read the resulting complete definition
against representative questions and incoming material. The
[authoring guide](../docs/organizing-knowledge.md) explains how to develop the
selected account and review an existing Atlas before adoption.

One locally captured definition governs the whole Atlas. Its Trees may differ in
size and shape while following the same policy. Authors use that definition during
ordinary work; revising or replacing it is a deliberate decision that considers
existing accounts. Catalogue updates do not change adopted copies. Users can supply
their own complete policy when the curated entries do not fit.

The intended benefit is continuity: contributors have a repeatable basis for
placing new information, readers know when sources supply the next level of
understanding, and maintainers can trace changes through the owning explanations.
An agent entering the project can read these choices instead of inventing them
again. Sources and review still determine whether the resulting account is sound.

## Curating further Styles

A Style earns a place when it provides a **coherent, repeatable way of writing an
Atlas that the existing entries don't describe adequately**. Its contribution
should be visible in the decisions authors make about placement, development,
source boundaries or maintenance. A worked account and a realistic update make
those differences inspectable.

Ownership and explanatory responsibility explain the six entries here; they do
not exhaust the possible authoring choices or restrict future Styles to these
combinations. The catalogue offers considered starting policies. Their coherence
and worked examples do not by themselves establish comparative reader benefit.
