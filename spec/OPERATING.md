# Working with Atlas

An Atlas explains a project. Each Tree is one account of it. Each Point is one
claim with its explanation, and develops into the Points beneath it, so a
reader can descend from an account's top claim to the detail that supports
it. A Facet says what another account changes about a claim. The
[specification](SPEC.md) and the [operations contract](spec/OPERATIONS.md)
own the exact rules; this guide says how to read an Atlas, how to write one,
and how to keep one true. The operations named here have the same names in
the CLI (`atlas route`) and in the MCP tools (`atlas_route`). The `guide`
operation returns this text, and with a document name the specification
(`spec`), the file format (`format`), the operations (`operations`) or the
project workflow (`project`).

## Read: find the explanation, then read it whole

Use an exact Point ID when you have one. To see a Tree whole, `outline`
gives its Points as a nested list of titles, the way the Portal's Outline
does. For a question, begin with `route` in `discover` mode or with
`search`. Compare the results' titles, owning
Trees, excerpts and uncertainty before you choose. Search is lexical: no match
is not proof that the Atlas says nothing, and a match is not yet an answer.
Include Facets when the explanation you need may be one account's reading of
another.

Read the chosen Point through `route` in its default `read` mode, or
`inspect` it for the record alone. You get the claims above it, its complete
explanation, what it develops into, the Facets that bear on it, its sources
and its uncertainty. The claims above tell you
what this Point is a part of; read them in full when their meaning matters. A
Facet attached to a Point is that account's reading; a Facet that targets it
is another account's reading of it. Neither is the target's own claim.

Check the bounds of every result. Follow `next` unchanged against the same
captured view when omitted material could matter. An excerpt helps you choose
what to read; it does not stand in for the qualifications in the full text.

An Atlas cites sources; it does not contain them. Read a source within the
access you were given when the task turns on its exact words. Report a source
you could not read as not read: a source reported `denied` was not read (it
lies outside the access you were given, or could not be read whole), and that
says nothing about whether it changed. A stamp
that no longer matches means the cited material changed after the explanation
was last checked: read both before relying on either.

Give back the explanation, its limits and where it came from. Keep a
decision's standing without implying it was built, and an observation's date
without assuming it still holds.

## Write: what makes a Point worth reading

**Write the claim first.** A Point's title is its claim: a sentence a reader
could check or dispute. "Offline editing" is a topic. "Users can keep working
while offline" is a claim. Readers meet titles before prose: in the Points
above a page, in what a Point develops into, in the Outline and in search
results. Read the titles down any path of a Tree. They should read as an
argument that gets more specific. A Point whose title cannot be written as a
sentence does not yet know what it says.

**Make each Point readable alone.** A reader may arrive from a search. State
the claim in full, then why it holds, a worked case when the claim is
abstract, the conditions under which it holds, and where it stops. The first
time a term matters, link it to the Point that owns it instead of explaining
it again. When a Point needs two claims to describe it, it is two Points.

**Give each thing one owner.** A rule, a figure, a list or a definition is
stated in full in one Point. Every other Point links to it or repeats it
exactly. Two statements that almost agree drift apart, and a reader cannot
tell which governs. Search for where a statement already lives before you
write it.

**Keep a higher Point within what stands under it.** A Point that develops
into others says what they establish together. It may not claim more than
they and its sources support: when every development says "under these
conditions", the Point above cannot say "always". When a development changes,
reread the Points above it, and rewrite them only where their meaning changed.

**Say what kind of statement each one is.** Cite what a source states, with a
locator a reader can follow: a heading, a line, a quoted phrase. Mark what you
infer in the sentence itself, and record it in the Point's `uncertainty`. Say
that an unknown is unknown. An inference must never read as a citation.

**Cite the part you read.** Give each source its role: `evidence` for what
states what your sentence says, `background` for context it does not rest on,
`example` for material a worked case is drawn from, `implementation` for code
that does what it describes, `history` for an earlier state of the project
that your sentence describes as earlier. Prefer a section (`design.md#storage`) to a whole
file: the reference is then more use to a reader, and it goes stale only when
that section changes. A passage before a file's first heading can only be
cited as the whole file. Run `validate --from` on a candidate: it names every
cited file or heading that is not there.

**Write a Facet only when another account changes the reading.** A Facet
says: read through that account, this claim depends on, is limited by or
conflicts with these Points there, and this follows. When the text would only
repeat its host or point at something related, an inline link does the work.

**Record decisions and observations as what they are.** A decision says what
was chosen, over what and why, and carries its standing. An observation says
what was seen, when, and in which source.

## Shape: where a claim belongs

Read the Atlas's Style before you place anything. It says which accounts this
Atlas keeps and what each owns, how much of the argument the Atlas carries
apart from its sources, and the conventions its authors follow. Apply it even
when another arrangement also looks reasonable. Changing it is the owner's
decision and a change of its own.

Develop a Point when part of its claim needs its own reference, assessment or
revision. Start a Tree only when a subject needs a sustained account with a
top claim of its own. Before you restructure, name the reader's problem you
are solving and how you will tell that it is solved. Another plausible outline
is not a reason.

## The files

An Atlas is a folder of plain files. `guide format` gives every rule; these
are the ones you meet in ordinary work.

```text
atlas.json                      {"format":"atlas/1.2","id":…,"title":…,"trees":["trees/product",…]}
style.md                        the Style: a title and its text, no header
trees/product/tree.json         {"id":"product","title":…,"scope":…,"base":"purpose","children":[…]}
trees/product/points/*.md       one Point per file
trees/product/facets/*.md       one Facet per file
.checks/*.md                    the Atlas's Checks
```

A Point file begins with a JSON header between `---` lines, then
its claim as the only H1, then its explanation:

```markdown
---
{"id":"offline-work","sources":[{"uri":"../docs/design.md#storage","role":"evidence"}],"uncertainty":"Measured on one device."}
---
# Users can keep working while offline

Users can read and edit downloaded documents while offline…
```

The header requires `id`; it may add `type` (`decision` with a `status`, or
`observation` with an `observedAt` date and a source), `sources` (each a `uri`
with an optional `title`, `role`, `locator`, `revision` and the stamp
`sha256`) and `uncertainty`. Source URIs are relative to the Atlas root.

A Point is placed by its Tree's `tree.json`: `children` is the ordered list of
developments under the Base, each `{"point": ID, "children": […]}`. Every Point
in a Tree's `points/` folder appears there exactly once.

A Facet file has the same shape with `on` (the Point it attaches to, in this
Tree), `via` (the other Tree) and `targets` (Points of that Tree):
`{"id":"offline-storage","on":"offline-work","via":"architecture","targets":["local-storage"]}`.

Link to another record by its file's relative path, with no `#fragment`:
`[local storage](../../architecture/points/local-storage.md)`.

## Change: prepare whole, review, apply

1. **Look first.** Search for the claim. For incoming material, `absorb`
   shows the Points it may belong with, the Trees that could own it and the
   Facets that bear on it. Decide what the material does: it updates the
   owning explanation, adds a development, adds a Facet or a reference,
   records a conflict, or stays out.
2. **Write the change as files.** For a small edit, give `prepare` the changed
   files. For anything larger, run `candidate`: it writes a fresh copy of the
   Atlas's records into `.atlas-candidate/` at the Atlas root. Edit the copy
   with your own file tools, `validate` it, and give `prepare` that folder
   (through MCP, with the `baseline` that `candidate` returned). Do not edit
   the Atlas in place: only `apply` writes it, and `recover` after an
   interrupted apply. The folder
   stays until the next `candidate`; keep it out of version control. Change
   the Style in a change of its own.
3. **Give the reason.** It travels with the draft and is what the owner reads
   first. State what changed, what was removed and where its meaning now
   lives, and what you left unresolved.
4. **Read the effects.** `review` lists every record that is new, changed or
   removed, the Points above each changed Point, the Facets attached to it
   and targeting it, the records that mention it, and link diagnostics. These
   are leads, not a proof of complete impact. Reread the Points above.
5. **Let the owner read it.** The Portal shows each draft with its
   differences marked and, when it validates, the whole candidate readable.
   Apply only on the owner's word, with the draft's exact revision. If the
   Atlas changed in the meantime the draft is stale: run `candidate` again,
   make the change in the fresh copy and prepare that. Preparing from the old
   copy is refused, since it would undo what changed. After an interrupted
   apply, `recover` before anything else is applied; a rollback is not a
   completion.

A valid candidate is well formed. That says nothing yet about whether it is
true or useful.

## Keep it true

An Atlas binds nothing in its project, so nothing in the project fails when a
Point drifts from its source. A wrong Point stays wrong until a reader finds
it. Three habits find it sooner.

**Stamp what you checked, and read what went stale.** After you have read a
Point against its sources, `stamp` it: the Atlas then records what that
material looked like. When the project changes, `stale` lists the sources
that changed and the Points that cite them. Read each of those Points against
the new material, correct it or confirm it, and stamp it again. Do not stamp
what you have not read.

**Have it read by readers who were not there.** An author cannot see the gaps
in their own explanation. Use separate readers, fresh agents if no person is
available, and give each one job:

- An auditor receives the changed Points and their sources, and lists every
  statement the sources do not support or contradict, with the place in the
  source. A different model from the author's finds more.
- Question readers receive only the Atlas and a set of questions a real
  reader would ask. Each answers from the Atlas alone and names the Points it
  used. What they cannot find, or answer wrongly, is the finding.
- A whole reader reads one account from its top claim to its last Point and
  reports contradictions, statements that repeat with differences, and claims
  above that say more than the claims beneath them.

Check each finding against the files before you act on it; readers are wrong
too. Fix a finding in the Point that owns the statement. Then have the changed
lines audited once more, because fixes introduce defects of their own.
Findings do not reach zero. Decide before a round what ends it, and record
what you left.

**Verify the Atlas's own Checks.** When the Atlas has active Checks, verify
each one that applies against the exact candidate and report `pass`, `fail` or
`unable` with the evidence. Atlas does not do this for you.

Act within what you were authorized to do. Reading a source, preparing a
change and passing a Check do not authorize applying it.
