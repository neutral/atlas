# Atlas Styles

A Style is an Atlas's own statement of how it is written: which accounts it
keeps and what each owns, how much of the argument it carries apart from its
sources, and the conventions its authors follow. Several policies can produce
valid accounts of the same material. Keeping one, in the Atlas, gives every
later author the same basis for placing a claim and for deciding how much to
explain.

The [core specification](../spec/SPEC.md#style-and-checks) defines what
every Atlas respects, and [Working with Atlas](../spec/OPERATING.md)
teaches the craft every account shares: titles that state claims, Points that
read alone, one owner for each statement. A Style holds only what differs from
one Atlas to the next.

## The catalogue

The six curated Styles make two independent choices. **Accounts** decides
which Tree owns an explanation. **Depth** decides how much of the argument the
Atlas carries.

| Accounts | The Atlas carries the main arguments | Extended arguments stay in sources |
| --- | --- | --- |
| Distinct perspectives on the whole project | [Explanatory perspectives](explanatory-perspectives.md) | [Concise perspectives](concise-perspectives.md) |
| One Tree for each durable subject | [Explanatory subjects](explanatory-subjects.md) | [Concise subjects](concise-subjects.md) |
| A central argument with supporting accounts | [Explanatory synthesis](explanatory-synthesis.md) | [Concise synthesis](concise-synthesis.md) |

Each entry is a complete definition in two short sections. All six can explain
facts, decisions, observations and open questions. They differ in where that
understanding lives and how far it is developed.

## Accounts

**Perspectives** divide the project by the questions an account answers. In a
coding project, Product can say what an experience is for, Architecture how it
is built, and Reliability what failures and evidence establish. The same
capability matters to all three, and each owns different claims about it.

**Subjects** keep everything about one durable subject together. An Offline
work Tree can explain the intended experience, the storage choices, the
failure conditions and the evidence in one account. In knowledge work, an
evaluation of several proposals could use economic, environmental and
operational perspectives, or one Tree for each proposal.

**Synthesis** gives one central Tree the project's integrated argument and
lets supporting Trees each make a complete argument of their own. Choose it
when the project needs one place that says what everything amounts to: a
central assessment could combine mechanisms, reliability evidence and
operating requirements to say whether a limited pilot is warranted, while the
reliability account still owns what its tests establish.

In every family a claim is explained in full by one account, and ownership
follows an account's scope and explanations. Tree titles and the boundaries of
source files do not decide placement.

## Depth

**Explanatory** Styles develop the main arguments in the Atlas: reasons,
alternatives that mattered, examples, qualifications and consequences. A
reader can understand an argument before opening a source. Keeping that
argument true costs a reading whenever the material changes.

**Concise** Styles keep each claim, its essential reason and its
qualifications, and send the reader to a named place in a source for the
extended argument. Reading sources is part of understanding in depth.

Depth sets no word count and no Tree size. Exact requirements, procedures,
code and raw evidence keep their source authority under every Style. The
[worked comparison](../examples/styles.md) applies all six to the same
material and to a later finding.

## Adopt one

Choose the accounts that need to develop together, then decide what a reader
should understand before returning to sources. Read the resulting definition
against a few questions a real reader would ask and against material you
expect to arrive. `atlas init` records the chosen definition as the Atlas's
`style.md`.

From then on that file is the Atlas's own. Add a section for the project's
conventions as they settle: its vocabulary, how it marks a statement no source
states, how long a Point may grow. Catalogue updates never change it. Revising
or replacing it is the owner's decision and a change of its own, made with the
existing accounts in view. A project can also write a complete definition of
its own from the start.

## Curating further Styles

A Style earns a place here when it describes a coherent, repeatable way of
writing an Atlas that the existing entries do not. Its difference should show
in decisions an author makes about placement or depth, and a worked account
with a realistic update should make that difference inspectable. The two
choices above explain the six entries; they do not exhaust what a Style can
settle. Coherent definitions and worked examples do not by themselves
establish that readers are better served.
