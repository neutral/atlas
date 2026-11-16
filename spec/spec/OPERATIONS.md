# Atlas operations

The Library owns the behavior used by the CLI, the MCP server and the Portal.
Operations return structured results with explicit scope, evidence and failure
boundaries. Transport success does not imply valid content or successful
application.

## Reading

Opening an Atlas captures its authored records, validation result and content
identity. The Style is part of that capture: its bytes participate in
identity, comparison and validation. Exact inspection returns the requested
record, its owning Tree, the Points above it, its body, its attached Facets,
the Facets of other accounts that target it, and its sources. Checks are
returned with their complete text and their status.

Search is scoped and bounded. Results explain the lexical match and preserve
ownership. Point and Facet results remain distinguishable. A Facet result
retains its host, owning Tree, the Tree it reads through and its targets; it
MUST NOT present the reading as a target Point's own claim. Source bodies are
not searched. Compact discovery MAY return literal body excerpts instead of
full bodies, while retaining identity, Type, standing or date, uncertainty
and an exact follow-up selector. A lexical candidate remains distinct from a
judgment about meaning or source support.

Refresh captures the current files and compares them with the prior
observation. Consumers distinguish captured content from a freshly inspected
state. Missing records, malformed data and inaccessible files remain explicit
diagnostics.

Readers MAY derive direct references from captured Markdown and source
headers. These indexes preserve owner, location, target and missing or
unsupported diagnostics with explicit bounds. They do not change authored
validity or infer semantic relations. Moving a Point or Facet file within its
Tree may prepare repairs to known incoming and outgoing path links; unsafe or
incomplete repairs MUST be refused instead of presented as a complete move.
IDs and Atlas-root-relative source references are unchanged by such a move.

## Route

Route accepts an exact Point, an exact Tree, an exact Facet with its Tree, or
a question, and optional detail, type and result bounds. It returns a suggested reading path with orientation, selected
Points, supporting detail and relevant Facets. It explains inclusion using
exact identity, authored ancestry, text matches or explicit Facet attachment.

Route preserves original explanations, source references and uncertainty. A
decision's standing and an observation's date remain visible. It MUST NOT
infer implementation from selection or turn an authored connection into
proof. Ambiguous matches remain alternatives; lexical ranking is not a
semantic judgment.

Discovery returns compact candidates without expanding their developments.
Reading retains complete selected explanations; orientation MAY use references
to the Points above instead of repeated bodies. Bounded sections expose their
available and returned counts and exact continuation requests. Continuation is
bound to the captured identity and original request; changed inputs require a
new reading path. Summaries of an Atlas or of a draft MAY be bounded. They
MUST make omitted content explicit and provide complete inspection by exact
identity. A compact synopsis cannot replace reading the complete effects
before claiming a proposal was reviewed.

## Sources

Source reads require caller-supplied roots independent of the authored
references. Default local access stays inside the Atlas. Private state and
reserved paths remain excluded even under broader grants. Real-path
containment and symbolic-link checks apply before access. At most 100 roots
can be granted. External URLs are
returned as references and are never fetched. Missing or denied sources remain
explicit limits on the evidence inspected. A read of a stamped reference
reports whether the cited material still matches the stamp.

Stamping records the cited material's current hash in the source references
of selected Points and Facets. It reads only local sources within the
caller's grants and reports every reference it could not read. It prepares an
ordinary change; nothing is stamped until that change is applied. A stamp
records what the maintainer checked the explanation against, so a maintainer
stamps a record after reading it against its sources, not before.

The stale report reads every local source within grants, stamped or not, and
gives each reference one status: `current`, `changed`, `missing`, `denied`, `unstamped`
for a local reference without a stamp, or `remote`. A stamped reference
outside the grants is `denied` whether or not its file exists, since nothing
outside them is looked at. Within the grants, a stamped source that was not
read (not a regular file, over the read limit, or changed during the read) is
`denied`, with a code that says why, and a local reference whose file is
absent, or whose fragment names no heading in a Markdown file, is `missing`
whether or not it is stamped. One report reads at
most 10000 references; beyond that it says how many it did not read and does
not call itself exhaustive. It lists each changed or
missing source once with the records that cite it. It MUST distinguish these
statuses; an unread source is never reported as current. The report rewrites
nothing.

## Absorb

Absorb inspection accepts incoming material and its source identity, then
supplies candidate Points, possible owning Trees and existing Facets that
bear on it. The author makes the semantic decision within the Style: update
the owning explanation, add a development, add a Facet or a reference, record
a conflict, or leave the material out. The reason given with the prepared
change states those decisions.

Changed Points prompt inspection of the Points above them, their attached
Facets and the Facets of other accounts that target them. This review set is
limited to recorded connections. Direct Markdown citers are reported
separately as mentions, without transitive inference. A removal is visible as
a removal, with the references that pointed at the removed record.

## Prepared changes and recovery

Preparation writes no authored file. A change is given either as explicit file
changes or as a complete candidate directory, from which the Library derives
the file changes. Preparation computes the complete before and after content,
the original content identity and the validation result, and saves them as a
draft with a reason; the effects to review are read from the draft. An
adapter returns a bounded summary of the draft and gives its complete content
on request. A candidate directory MUST
lie outside the Atlas and the private state, or be the Atlas's own candidate
folder, `.atlas-candidate` at its root, which no reader captures. Atlas writes
a fresh copy of the Atlas's records into that folder on request, replacing
what it held; it writes nothing else there and nothing else in the Atlas. It
records in private state the identity of the Atlas it copied, once the copy
is whole, and preparing from that folder is refused as stale once the Atlas
has changed or when no such record is there, so an old or partial copy cannot
undo a change applied since.
Symbolic links in a candidate are refused by name, as is a candidate that
contains the Atlas, and a file in a record folder that no record path admits.
Through the MCP server a candidate is the candidate folder or an absolute path
within the launch grants. Files in it that are not
authored records are not part of the change; those that differ from the
Atlas's own, or have no counterpart there, are reported as left out. A change
that alters a valid Style alters nothing else; preparation marks a mixed
change invalid. A Style that does not validate may be repaired together with
the rest of the Atlas, so a broken Atlas can be made whole in one change.
Invalid drafts can be inspected and repaired, but MUST NOT be applied. Initialization follows the same
boundary. Raw repairs expose the original bytes as `beforeBase64`; null text
does not mean the file was absent.

The effects of a draft name every record that is new, changed or removed and,
for a Point, what changed in it (its title, explanation, sources, uncertainty,
placement, type or standing); the Points above each changed Point, the attached and
incoming Facets, direct citers, link diagnostics, and whether the Style or a
Check differs. They are read against the draft's own baseline, so a draft
that creates an Atlas or repairs one that does not validate can be reviewed
like any other. A complete candidate reads through the ordinary reading
operations, visibly separate from the current Atlas, and cannot be applied
through navigation.

Apply operates only on the caller-selected Atlas and the caller's exact draft
revision. It validates paths, the plan and the complete candidate again. All
affected files are checked against their recorded original bytes before the
first write. Stale input fails without authored writes. Concurrent writers use
an exclusive transaction lock. Plan data grants no authority and cannot select
another root, an arbitrary file or an executable operation.

Multi-file writes retain original bytes and durable transaction progress. A
failed or interrupted apply exposes partial state and a guarded recovery
operation, and the Atlas takes no other apply until that transaction is
recovered. Recovery restores the original bytes of each file of the change
that holds its original or its proposed bytes, whoever wrote them, and
refuses to overwrite any other content. Completion and recovered rollback are
distinct outcomes, and a journal is kept only while its transaction is
unfinished.
Cross-file atomicity is not claimed.

Drafts retain their original baseline and survive process restart. A draft's
revision identifies its complete saved content. Applying or deleting a draft
requires the caller's exact revision. A completed apply removes its draft
and its recovery journal, and says so when it could not remove the draft; an apply with nothing to write keeps its draft;
an interrupted one keeps its draft, which can be applied again once recovery
has rolled the change back and restored the Atlas it was prepared against. Drafts and recovery
journals use private
user storage, keyed by the canonical Atlas root and bound to it by ownership
metadata. A trusted launch may choose another state directory. Authored
content and tool requests cannot change that location. Preparing, reviewing,
applying and recovering are distinct visible actions.

## Checks

Opening an Atlas validates each Check's form and exposes every Check with
its complete text and status. Only active Checks govern; retired and draft
Checks do not. Atlas does not
evaluate a Check and never loads or runs an evaluator. A reviewer verifies an
applicable Check against the exact candidate and reports `pass`, `fail` or
`unable` with its evidence to whoever authorizes the change. Structural
validity is not a Check result.

## Product adapters

The Portal presents an Atlas for reading and writes nothing. Each Point and
each Facet has one page at its own address, complete without a script: the
explanation as written, under it its uncertainty and what it rests on, and
beside it where it stands: its Tree's outline around it, the Facets attached
to it, what it refers to in other Trees and what refers to it. A reader can
open what that outline names without leaving the page, go to any page a text
names, reach any Point through the Outline of the whole Atlas, read Help on
the Atlas's words, and, with the script, search. A source whose stamp no longer matches is marked. Keyboard,
narrow-screen and direct-link access are supported. The local service also
presents each draft for reading, with what differs marked and, when the
candidate validates, the complete candidate readable; it offers no way to
apply one.

The CLI and the MCP server expose the reading and changing operations the
guide names, under the same names. The MCP server keeps one captured view per
session: `atlas_open` and `atlas_refresh` capture it, and `atlas_read_source`
reads a cited source within the grants and compares it with the reference's
stamp. The CLI captures afresh on every command, reads a source by its URI
alone with `read-source`, and also serves the Portal, exports, and prints the configuration
that connects an agent host. MCP fixes its root and source grants at launch;
tools cannot expand that scope. Inputs and output sizes are bounded; errors remain structured.

Publication writes the Portal's pages for an explicit selection of Trees,
into a folder outside the Atlas, its private state and the application (an
installed package's folder, or a source checkout's code). It
never expands through Facets or source references. Facet targets and links
into Trees outside the selection are marked as not included. Source bodies are
never copied; a caller MAY supply the address at which the Atlas root can be
browsed, and local source references then link there. Published output
executes no authored HTML or scripts.
