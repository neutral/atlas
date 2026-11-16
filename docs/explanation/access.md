# What Atlas may read and write

Which Atlas, which sources and which state Atlas may touch are decided by
whoever starts it, and nothing written in an Atlas can widen that. This page
explains why, where Atlas writes, and what leaves in an export.

## The launch decides

Three things are fixed when Atlas starts: the Atlas root, the directories
from which cited sources may be read, and the location of the private state.
Requests cannot expand them ([Project
workflow](../../spec/spec/PROJECT.md)). Each CLI command is such a
launch; the MCP server fixes its root and grants for the whole session, and no
tool can change them ([Product
adapters](../../spec/spec/OPERATIONS.md#product-adapters)).

The CLI, the MCP server and the Portal always grant the Atlas root, so by
default sources are read only inside the Atlas; the Library grants what its
caller passes, the root by default ([Atlas
Library](../../library/README.md)). Any other directory is granted by name, up
to 100 roots in all.
Real paths and symbolic links are checked before any read, and the private
state and reserved paths stay out of reach under any grant. An external URL is
never fetched ([Sources](../../spec/spec/OPERATIONS.md#sources)).

When [`open`](../reference/cli.md#open) is given a project rather than an
Atlas root, it grants the project directory, so the sources the Atlas cites
elsewhere in the project can be read. [`config`](../reference/cli.md#config)
does the same for an agent host: it prints the configuration, with the root
and the grants written out, and the state location when one was chosen, for
you to install through the host. Neither changes the host's settings ([Project
workflow](../../spec/spec/PROJECT.md)).

The example in `examples/offline-notes` keeps its sources inside the Atlas, so
a launch with the Atlas root alone reads all thirteen of its references. On a
copy rearranged so that the Atlas sits in a `context/` folder and cites
`../sources/brief.md`, the stale report with only the Atlas root granted calls
all thirteen `denied`: not read, which says nothing about whether they
changed, and the Portal calls those stamps "not checked here". Granting the
project directory makes them current again.

## Nothing in an Atlas grants authority

Atlas records, source references and Checks grant no file, network,
credential, execution or publication authority. Consumers act only within the
permissions their caller gives ([Authority](../../spec/SPEC.md#authority)).
A reference establishes neither truth nor permission to retrieve what it cites
([Sources and Types](../../spec/SPEC.md#sources-and-types)). A relative
source path may lead outside the Atlas, and reading it still needs a grant; an
absolute path, credentials in a URL and executable URL schemes are invalid
([Source reference](../../spec/spec/FORMAT.md#source-reference)).

A draft's plan grants no authority either, and cannot select another root, an
arbitrary file or an executable operation ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).
A Check says how a reviewer verifies it, and Atlas never loads or runs an
evaluator ([Checks](../../spec/spec/OPERATIONS.md#checks)). A
presentation never executes authored content
([Reading](../../spec/SPEC.md#reading)), so the Portal shows authored
HTML as text and never runs it.

Together these rules mean that what an Atlas says cannot change what Atlas
may do: a sentence in a Point cannot widen what is read, and a draft cannot
choose where it is written. That is left to the launch.

## What Atlas writes

Atlas writes authored files only to apply a draft, or to roll back an
interrupted apply ([Change: prepare whole, review,
apply](../../spec/OPERATING.md#change-prepare-whole-review-apply)). It
writes each file beside its destination and renames it into place; readers
skip such a file while it is there
([Capture](../../spec/spec/FORMAT.md#capture)). Otherwise it writes
inside the Atlas only the candidate folder `.atlas-candidate`, on request
([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).
An export writes a folder outside the Atlas, the private state and the
application, which is an installed package's folder or a source checkout's
code ([The export folder](../reference/portal.md#the-export-folder)).
The Portal writes nothing ([Product
adapters](../../spec/spec/OPERATIONS.md#product-adapters)).

## Private state

Drafts, recovery journals and the record of which Atlas the candidate folder
was copied from are kept in private user storage, not in the Atlas. They are
keyed by the Atlas's canonical root and bound to it by ownership metadata. A trusted launch may choose another state directory;
authored content and tool requests cannot change it ([Prepared changes and
recovery](../../spec/spec/OPERATIONS.md#prepared-changes-and-recovery)).

Kept outside, a draft is not part of the Atlas: no reader captures it, and it
does not travel with the Atlas's files when they are copied or published.
Keyed to the root, one Atlas's drafts are not read as another's.
[`state`](../reference/cli.md#state) says where an Atlas's state is kept; the
[configuration reference](../reference/configuration.md) gives the locations.

## What leaves in an export

Publication writes the Portal's pages for an explicit selection of Trees. It
never expands through Facets or source references: Facet targets and links
into Trees outside the selection are marked as not included. Source bodies are
never copied; local source references can link to an address the caller gives
for the Atlas root ([Product
adapters](../../spec/spec/OPERATIONS.md#product-adapters)).

What does leave is the text of the chosen Trees: a page for each of their
Points and Facets, home, Help, the assets, a search index of those Points and
Facets, and a marker that records the Atlas's ID and identity, the Trees
chosen, the source base and the files written. Each source line names its
source, with its locator when it has one, and a local path is written without
its leading `../` steps. The sources keep the marks the Portal gave them when
the export was made ([Marks come with
words](the-portal.md#marks-come-with-words)). The
other Trees, proposed changes, the Style, the local
service's pages of cited sources and private state stay behind.

Exporting only Product experience from the example writes three Point pages
and two Facet pages. Both Facets read through Storage and delivery, so each
says "a Tree not in this publication" in that Tree's place, and a link to the
trial Point is plain text followed by "not in this publication". Choosing the
Trees is the act of publication, and nothing in an Atlas makes that choice.
[Publish an Atlas](../how-to/publish.md) gives the steps, and
[`export`](../reference/cli.md#export) the options.
