# Sources and stamps

This page gives the exact inputs, results, limits and codes of the operations
that read what an Atlas cites, record stamps, report stale sources, index
links and citations, and move a record's file. The rules every implementation
keeps are in [Sources](../../spec/spec/OPERATIONS.md#sources) and
[Reading](../../spec/spec/OPERATIONS.md#reading); why stamps and the
stale report exist is in
[Keeping an Atlas true](../explanation/keeping-it-true.md). Each command's
options and exit codes are in [The atlas command](cli.md), each tool's input
schema in [The MCP server](mcp.md), and the source grants and their limit in
[Configuration](configuration.md). Stamps and moves are saved as drafts, which
are reviewed and applied as in [Changes](changes.md).

The examples show the shape of a result; `…` stands for the values and
entries left out.

| Job | CLI | MCP | Library |
| --- | --- | --- | --- |
| Read one source | `read-source URI` | `atlas_read_source` | `readSource`, `observeSource`, `citedMaterial` |
| Stamp what was read | `stamp` | `atlas_stamp` | `prepareStamp` |
| Report stale sources | `stale` | `atlas_stale` | `staleSources` |
| Index links and citations | `references` | `atlas_references` | `referenceIndex`, `resolveReference`, `directCiters`, `sourceCitations` |
| Move a Point or Facet file | `move` | `atlas_move` | `prepareMove` |
| Check one source reference | none | none | `validateSource` |
| Name a Markdown text's headings | none | none | `markdownHeadingIds` |

| Operation | Reads sources | Compares stamps | Saves a draft |
| --- | --- | --- | --- |
| `read-source` | The one named, within the grants | Through MCP, when the reference given carries `sha256` | No |
| `stamp` | Every local reference of the selected records, within the grants | Yes | Yes, unless nothing needs a stamp |
| `stale` | Every local reference, within the grants, up to 10000 references ([The stale report](#the-stale-report)) | Yes | No |
| `references` | None | No | No |
| `move` | None | No | Yes |
| `validate --from` | The candidate's local references, within the grants, up to 10000 references, as `stale` reads them ([Changes](changes.md#validate-a-candidate)) | No | No |

## Source references

A source reference is an entry of a Point's or a Facet's `sources`. Its
fields, its roles and the rules for its URI are in
[Source reference](../../spec/spec/FORMAT.md#source-reference); a
reference that breaks them is `SOURCE_INVALID` on its record. A result names a
reference by the record that holds it (`from`) and its position in that
record's `sources` (`sourceIndex`, from 0).

- A URI that begins with `http://` or `https://` is **remote**. It is never
  fetched, and a stamp on it is carried and never compared.
- Every other URI is **local**: a path relative to the Atlas root, with an
  optional `#fragment`. It may leave the Atlas, and is read only within the
  [source grants](configuration.md#source-grants).
- What a local reference cites, its cited material, how a fragment names a
  heading, and the stamp `sha256` taken of that material are in
  [Source reference](../../spec/spec/FORMAT.md#source-reference).

## Read a source

`read-source URI` reads one local source by its URI, written as the Atlas
cites it, within the grants, up to 1 MiB. A URI carries no stamp, so the CLI
compares none. `atlas_read_source` takes a whole source reference as `source`,
and compares the cited material with its `sha256` when it has one; `maxBytes`
bounds the read, up to and by default 1 MiB.

A read resolves the path against the Atlas root's real path and reads it only
within a grant, as [Source grants](configuration.md#source-grants) says, and
only when it is spelled as the file system spells it, is a regular file within
the bound, and does not change while it is read.

| Key | Value |
| --- | --- |
| `status` | `ready`, `missing`, `denied`, `incomplete`, `invalid`, or `reference` for a remote URI. |
| `source` | The reference as given. |
| `code` | When not `ready`, the reason (below); when `ready`, `SOURCE_HEADING_MISSING` if the fragment names no heading. Absent for `reference`. |
| `message` | Prose. |
| `path` | Ready: the file's absolute path. |
| `content` | Ready: the whole file's text. |
| `bytes`, `sha256` | Ready: the whole file's size in bytes and its SHA-256. |
| `cited` | Ready: the cited material, `{ scope, heading?, start, end, bytes, sha256 }`, where `scope` is `file` or `section`, `heading` the section's heading name, `start` and `end` byte offsets in the file, and `sha256` the material's hash; `null` when the fragment names no heading. |
| `stamp` | Ready: `current` (the cited material matches `sha256`), `changed` (it does not), `unstamped` (the reference carries no `sha256`, as every CLI read), or `missing` (it cites nothing). |

A changed source is still read and returned; it is not an error.

| `status` | `code` | The source |
| --- | --- | --- |
| `reference` | none | is remote; nothing is fetched. |
| `denied` | `SOURCE_RESERVED` | has a path component beginning with `.atlas-`, or lies in private state. |
| `denied` | `SOURCE_DENIED` | lies outside every granted root. |
| `denied` | `PATH_SYMLINK` | is a symbolic link or is reached through one. |
| `denied` | `PATH_UNSAFE` | leaves its granted root once resolved. |
| `denied` | `EACCES`, `EPERM` | cannot be read for lack of permission. |
| `missing` | `ENOENT`, `ENOTDIR` | lies within the grants and does not exist, or its path runs through a regular file. |
| `incomplete` | `READ_LIMIT` | is larger than the bound. |
| `incomplete` | `READ_CHANGED` | changed while it was read. |
| `invalid` | `SOURCE_INVALID` | breaks the rules of a source reference. |
| `invalid` | `PATH_ALIAS` | is spelled otherwise than the file system spells it, such as in another case. |
| `invalid` | `FILE_KIND` | is not a regular file, such as a directory. |
| `invalid` | `FILE_UTF8` | is not valid UTF-8 text. |
| `invalid` | another platform code | could not be read for another reason. |
| `ready` | `SOURCE_HEADING_MISSING` | is read, but the fragment names no heading in it: `cited` is `null` and `stamp` is `missing`. |

A Library caller can also get `invalid` with `VIEW_INVALID` (no captured view),
`ROOTS_INVALID` (grants that are not at most 100 absolute paths) or
`READ_LIMIT` (`maxBytes` outside 1 to 67108864).

```text
atlas --root PATH read-source 'sources/trial.md#limits'
{
  "status": "ready",
  "source": { "uri": "sources/trial.md#limits" },
  "path": "…/sources/trial.md",
  "content": "…",
  "bytes": …,
  "sha256": "…",
  "cited": { "scope": "section", "heading": "limits", "start": …, "end": …, "bytes": …, "sha256": "…" },
  "stamp": "unstamped",
  "message": "…"
}
```

`stamp` and `stale` observe sources the same way, with two differences: they
read up to 64 MiB, and they do not decode the file, so a file that is not
UTF-8 is hashed whole. A fragment into such a `.md` file names no heading.
Each distinct URI is read once per report.

## Stamps

`stamp` (`atlas_stamp`) prepares a change that writes into the source
references of the selected records the hash of what each one cites now, and
saves it as a draft. Nothing is stamped until that draft is applied
([Sources](../../spec/spec/OPERATIONS.md#sources)).

**Selection**, exactly one of:

| Option | MCP | Records |
| --- | --- | --- |
| `--point ID`, repeatable | `points` | Those Points, and the Facets attached to them. |
| `--tree ID` | `tree` | Every Point and Facet the Tree owns. |
| `--all` | `all: true` | Every Point and Facet. |

The reason of the draft defaults to `Record the sources as read`. The Atlas is
read from disk; through MCP it must be the one the session captured.

**Each reference** of each selected record, in record order, lands in one
list:

| List | When | Entry |
| --- | --- | --- |
| `stamped` | The cited material was read and differs from the stamp, or there was none. | `{ from, sourceIndex, uri, scope, sha256, previous? }`, `previous` being the stamp it replaces. |
| `current` | The cited material was read and matches the stamp. | `{ from, sourceIndex, uri, scope, sha256 }` |
| `skipped` | The reference is remote, its file is absent, it cites nothing, or it could not be read. It keeps the stamp it had. | `{ from, sourceIndex, uri, status, code?, reason }`, `status` being `remote`, `missing` or `denied` as in [the stale report](#the-stale-report). |

**What it writes.** Only the `sha256` members of the records' headers: a stamp
is replaced in place, or added after the last member of its reference. Every
other byte of the header and the whole body stay as authored. Should that edit
not parse to the intended header, the header is written again as JSON, on one
line or with two-space indentation as it was.

| Key | Value |
| --- | --- |
| `format` | `atlas.stamp/1` |
| `status` | `ready`, or `noop` when no reference needs a stamp. |
| `identity` | The identity of the Atlas read. |
| `selection` | `{ points }`, `{ tree }` or `{ all: true }`. |
| `counts` | `{ records, stamped, current, skipped }`. |
| `stamped`, `current`, `skipped` | As above, at most 100 entries each by default; through MCP, at most `limit`. |
| `bounds` | `stamped`, `current` and `skipped`, each `{ available, returned }`. |
| `limits` | What a stamp does not establish. |
| `draft` | The saved draft, as `prepare` prints it ([Drafts](changes.md#drafts)), or `null` when the status is `noop`. |

```text
atlas --root PATH stamp --point local-persistence
{
  "format": "atlas.stamp/1",
  "status": "ready",
  …
  "counts": { "records": 1, "stamped": 1, "current": 1, "skipped": 0 },
  "stamped": [
    {
      "from": { "kind": "point", "id": "local-persistence", "tree": "architecture", "path": "trees/architecture/points/local.md" },
      "sourceIndex": 1,
      "uri": "sources/trial.md#limits",
      "scope": "section",
      "sha256": "…",
      "previous": "…"
    }
  ],
  …
}
```

| Refusal | Code |
| --- | --- |
| Not exactly one selection; an empty or repeated list of Points; a blank reason | `atlas.references.invalid-argument` |
| A Point or Tree that does not exist | `atlas.references.invalid-argument` |
| The Atlas does not validate | `INVALID_VIEW` |
| More than 1000 records need a stamp | `LIMIT_EXCEEDED` |
| A record its stamps take over 2 MiB (2097152 bytes), or a change a reader would not read back ([Change requests](changes.md#change-requests)) | `LIMIT_EXCEEDED`, `INVALID_REQUEST` |
| MCP: the Atlas on disk is not the one the session captured | `STALE` |

## The stale report

`stale` (`atlas_stale`) reads every local source within the grants, stamped
or not, and gives each source reference of every Point and Facet one status.
It rewrites nothing.

| Status | The reference |
| --- | --- |
| `current` | is local and stamped, and its cited material was read and matches the stamp. |
| `changed` | is local and stamped, and its cited material was read and differs from the stamp. |
| `missing` | is local, lies within the grants, and its file does not exist, or its fragment names no heading in a `.md` file (`code` `SOURCE_HEADING_MISSING`), stamped or not. |
| `denied` | is local and stamped, and was not read; `code` says why, as in [Read a source](#read-a-source): `SOURCE_DENIED`, `SOURCE_RESERVED`, `PATH_SYMLINK`, `PATH_UNSAFE`, `PATH_ALIAS`, `FILE_KIND`, `READ_LIMIT`, `READ_CHANGED` or a platform code. A reference outside the grants is `denied` whether or not its file exists. |
| `unstamped` | is local without a stamp. It was read to learn whether what it cites is there; when it could not be read it carries the `code` that says why, and whether it cites anything is not known. |
| `remote` | is remote, and was not read. |

An unread source is never reported `current`.

**The summary**, the default, holds the counts and each changed or missing
source once, with the records whose reference to it is changed or missing:

| Key | Value |
| --- | --- |
| `format` | `atlas.stale/1` |
| `status` | `ready`, or `unavailable` when the Atlas does not validate; the counts are then 0 and the lists empty. |
| `identity` | The identity of the Atlas read. |
| `counts` | `references` (how many references the report gave a status) and one count for each status. |
| `summary` | `{ uri, status, code?, citers }` for each changed or missing source, in the order the records first cite it as changed or missing; `status` is `changed` or `missing`, and `citers` are `{ kind, id, tree, path, on? }`, `on` for a Facet. |
| `bounds` | `limit`, `offset`, `summary` (`{ available, returned }`), `unread`, `exhaustive` and `next`. |
| `limits` | What the statuses do not establish. |

**The full form**, with `--full` (`full: true`), adds `references`, every
reference with its status, as
`{ from, sourceIndex, source, status, cited?, code?, reason }`: `from` as a
citer, `source` the reference as authored, and `cited` the cited material
read, for `current` and `changed`. `bounds` then also has `references`
(`{ available, returned }`).

**Bounds.** One report reads at most 10000 references; `bounds.unread` says
how many it did not read past that bound. `limit` and `offset` page the
summary, and with the full form the references too, at the same offset.
`bounds.next` is the INPUT of the next page, `{ offset, limit, expectedIdentity }`
with `full: true` for the full form, or `null`. A continuation whose
`expectedIdentity` is not the Atlas's identity is refused with `STALE`.
`bounds.exhaustive` is `true` only when nothing remains past this page and no
reference was left unread. The Library's `staleSources` also takes `records`,
a list of `{ point }` or `{ tree, facet }`, to read only those records'
references.

```text
atlas --root PATH stale
{
  "format": "atlas.stale/1",
  "status": "ready",
  "identity": "…",
  "counts": { "references": …, "current": …, "changed": …, "missing": …, "denied": …, "unstamped": …, "remote": … },
  "summary": [
    {
      "uri": "sources/trial.md#limits",
      "status": "changed",
      "citers": [
        { "kind": "point", "id": "local-persistence", "tree": "architecture", "path": "trees/architecture/points/local.md" },
        { "kind": "facet", "id": "local-evidence-limit", "tree": "product", "path": "trees/product/facets/local-limit.md", "on": "offline-work" }
      ]
    }
  ],
  "bounds": { "limit": 100, "offset": 0, "summary": { "available": 1, "returned": 1 }, "unread": 0, "exhaustive": true, "next": null },
  …
}
```

## The reference index

`references` (`atlas_references`) reports the Markdown links in Points and
Facets and their declared source references, as authored. It reads no source
and fetches nothing. Its INPUT selects one of three results; `tree` goes only
with `facet`, and more than one selection is `INVALID_REQUEST`.

| INPUT | Result |
| --- | --- |
| `{}` | `atlas.references/1`: every link and every citation. |
| `{ point }`, or `{ facet, tree }` | `atlas.citers/1`: the records whose text links to that record. |
| `{ uri }` | `atlas.source-citations/1`: the records that cite that exact URI. |

Each result has `status`, `ready` or `unavailable` when the Atlas does not
validate, and `identity`. Its `limits` say that references identify authored
citations, not support, dependence or endorsement.

### Links

`atlas.references/1` has these keys:

| Key | Value |
| --- | --- |
| `references` | Each link: `{ from, href, location, destination?, syntax, status, target?, href?, candidatePath? }`. |
| `citations` | Each source reference: `{ from, source }`. |
| `diagnostics` | `{ code, path, line, column, message }`, below. |
| `bounds` | `limit`, `references` and `citations` (each `{ available, returned }`), and `exhaustive`. |

In each link, `from` is `{ kind, id, tree, path }`; `location` is
`{ start, end, line, column }`, the offsets in the file's text and the line
and column where the link begins; `destination` is `{ start, end }`, the
offsets of the link's destination, present when it could be located;
`syntax` is `inline`, `reference` or `autolink`. Raw HTML is not read for
links.

A link resolves in this order. A link to `http://` or `https://` is
`external`, with `href` its normalized URL, or `unsupported` when it carries a
user name or password or does not parse. A link of a fragment alone, `#…`,
resolves to the record itself. Any other link is decoded; one that holds a
scheme, a `?`, a `\`, a control character or a leading `/` is `unsupported`.
Its path is then tried relative to the linking file, then relative to the
Atlas root. At each, a record at that path is the `target`, and otherwise a
source the same record cites at that path, with the same fragment or with
none. A link that resolves to neither is `missing`, with `candidatePath` the
path relative to the linking file
([Markdown records](../../spec/spec/FORMAT.md#markdown-records), under
Links).

`target` is `{ kind, id, tree, path, fragment, on? }` for a Point or a Facet,
`on` for a Facet, and `{ kind: "source", source, sourceIndex, path, fragment }`
for a source. `fragment` is `""` or the `#…` the link carries.

| Diagnostic | The link |
| --- | --- |
| `REFERENCE_MISSING` | resolves to no record and to no source the record cites. |
| `REFERENCE_UNSUPPORTED` | is a kind Atlas does not resolve. |
| `REFERENCE_FRAGMENT` | goes to a record and carries a fragment, or is a fragment alone. |
| `REFERENCE_LIMIT` | is not a link: the scan passed its bound; `path` is `""` and there is no `line` or `column`. |

Reference diagnostics come from this index, kept apart from the view: they
never appear among a view's diagnostics and never change its status.

**Bounds.** The scan counts links and citations apart, each up to 10000, so
10000 of each is still a complete scan. The entry that passes either bound is
counted, so `available` can be 10001, and is listed when its list has room.
The scan then stops: at once for a link, and after the links of the record
being read for a citation. It is then not exhaustive, and `REFERENCE_LIMIT` is
added after the other diagnostics. `limit`, by default 1000, caps
`references`, `citations` and the other diagnostics, so `diagnostics` can hold
`limit` + 1 entries. `exhaustive` is `true` only when the scan was complete and
`references` and `citations` hold all it found.

### Direct citers

`atlas.citers/1` has `citers`, each `{ record, references }`: `record` the
linking record as `{ kind, id, tree, path }`, `references` its links to the
target, as above. A record that links to itself, by a fragment alone, is
among its citers. `bounds` is `{ available, returned, exhaustive }`; `limit`,
by default 100, caps `citers`, and each citer's `references` is whole. A
record that does not exist has no citers. The result has no `diagnostics`: a
scan past its bound shows only as `exhaustive: false`.

```text
echo '{"point":"sync-policy"}' | atlas --root PATH references -
{
  "format": "atlas.citers/1",
  "status": "ready",
  …
  "citers": [
    {
      "record": { "kind": "point", "id": "delivery-promise", "tree": "product", "path": "trees/product/points/promise.md" },
      "references": [
        {
          "from": { … },
          "href": "../../architecture/points/sync.md",
          "location": { "start": …, "end": …, "line": …, "column": … },
          "destination": { "start": …, "end": … },
          "syntax": "inline",
          "status": "resolved",
          "target": { "kind": "point", "id": "sync-policy", "tree": "architecture", "path": "trees/architecture/points/sync.md", "fragment": "" }
        }
      ]
    },
    …
  ],
  "bounds": { "available": …, "returned": …, "exhaustive": true },
  …
}
```

### Citations of a source

`atlas.source-citations/1` has `uri` and `citations`, each `{ from, source }`,
for every source reference whose URI is exactly the one given. `bounds` is
`{ available, returned, exhaustive }`; `limit` defaults to 100. The result has
no `diagnostics`: a scan past its bound shows only as `exhaustive: false`.

## Move a file

`move` (`atlas_move`) prepares the move of one Point or Facet file to another
path within its Tree, with the path links to and from it repaired, and saves
it as a draft. Its INPUT is `{ point, path, reason }` or
`{ facet, tree, path, reason }`. IDs do not change, the Tree's outline names
Points by ID and is not touched, and source references are relative to the
Atlas root and stay as they are
([Reading](../../spec/spec/OPERATIONS.md#reading)).

The new `path` is relative to the Atlas root, under the owning Tree's
`points/` for a Point or `facets/` for a Facet, ends in `.md`, is normalized
and in NFC, and has no `\` and no `.atlas-` component. A `path` equal to the
current one gives a noop draft.

**What it repairs.** Every link to the moved record from any Point or Facet,
and every link in the moved file except those to `http://` or
`https://` and those of a fragment alone. Each is rewritten as the path from
the linking file to its target, each component percent-encoded (`'`, `(` and
`)` included), with its fragment kept. The plan writes each repaired file,
writes the new path and removes the old one.

```text
echo '{"point":"sync-policy","path":"trees/architecture/points/delivery/sync.md","reason":"Group the delivery notes."}' | atlas --root PATH move -
{
  "format": "atlas.draft/1",
  …
  "plan": {
    …
    "changes": [
      { "path": "trees/product/points/promise.md", "action": "write", "bytes": … },
      …
      { "path": "trees/architecture/points/sync.md", "action": "remove", "bytes": 0 },
      { "path": "trees/architecture/points/delivery/sync.md", "action": "write", "bytes": … }
    ]
  },
  …
}
```

In its review the moved Point's `changes` holds `placement`, and each record
whose links were repaired holds `explanation` ([Review](changes.md#review)).

**What it refuses.** Nothing refused is saved. Like every change, a move is
refused with `LIMIT_EXCEEDED` when a file it writes, the moved file or one
whose links it repairs, would be over 2 MiB (2097152 bytes), and with
`INVALID_REQUEST` when a reader would not read the result back
([Change requests](changes.md#change-requests)). Its own refusals are all
`atlas.references.invalid-argument`:

- an Atlas that does not validate;
- not exactly one Point, or one Facet with its Tree; a missing `path` or a
  blank `reason`; a record that does not exist;
- a `path` in another Tree or of another kind, or not a normalized `.md`
  path as above;
- a move that changes only the case of the path;
- a `path` that already exists or aliases an authored path;
- a reference scan that is not exhaustive, before or after the move;
- a link to or from the moved file that is not resolved, or that is a
  reference-style link or an autolink, or whose destination cannot be
  located; the message names its file and line;
- a destination that would change what any link in the Atlas resolves to.
