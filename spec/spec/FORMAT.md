# Atlas format

The format identifier is `atlas/1.2`. Readers MUST reject every other
identifier. This document states how an Atlas is encoded, which files a reader
captures, each rule a reader checks with the diagnostic code it reports when
the rule is broken, and the exact shape of what a reader returns. Two readers
that follow it accept the same Atlases, return the same normalized Atlas and
view identity for them, and reject the rest for the same stated reasons.

## Layout

```text
atlas.json
style.md
trees/
  product/
    tree.json
    points/
      purpose.md
      offline-work.md
    facets/
      offline-storage.md
  architecture/
    tree.json
    points/
      local-storage.md
.checks/
  evidence-review.md
```

Directory and file names locate records; IDs identify them. Point and Facet
files MAY use nested directories beneath their `points/` and `facets/` roots,
and Checks beneath `.checks/`. Relative source URIs use the Atlas root as their
base.

## Text and JSON

**Comparison.** Strings are compared by their UTF-16 code units, the order of
JavaScript string comparison; every sorted list in this document uses that
order. NFC is Unicode Normalization Form C. To lowercase is to apply the
Unicode default lowercase mapping (JavaScript `toLowerCase`).

**White space.** White space is U+0009 to U+000D, U+0020, U+00A0, U+1680,
U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. To trim
text is to remove white space from both ends. Nonblank text is a JSON string
that is not empty once trimmed; a field that requires nonblank text and holds
anything else is `TEXT_REQUIRED`.

**Encoding.** Files are UTF-8. A file whose bytes are not valid UTF-8 is
`FILE_UTF8`; it is still captured, as its exact bytes, and remains invalid
until it is replaced or removed. A byte order mark is not removed: it is the
first character of the text. So a JSON file that begins with one is
`JSON_SYNTAX`, a Point, Facet or Check that begins with one is
`MARKDOWN_HEADER`, and in a Style it keeps the line it begins from being a
heading.

**Line endings.** In a Markdown record a line ends at LF, and CRLF reads as LF.
A CR that is not followed by LF is `MARKDOWN_LINE_ENDING`. A JSON file MAY use
any JSON white space, CR included.

**JSON.** JSON is strict RFC 8259 JSON:

- Anything that is not one JSON value, such as an unescaped control character
  in a string, an unknown escape, `NaN` or content after the value, is
  `JSON_SYNTAX`.
- A `\u` escape that is not followed by four hexadecimal digits, or that leaves
  an unpaired surrogate, is `JSON_UNICODE`.
- An object with two keys that are equal once decoded is `JSON_DUPLICATE_KEY`.
- A number whose nearest IEEE 754 binary64 value is not finite, or is an
  integer of magnitude above 2^53 − 1, is `JSON_NUMBER`: `1e400`, `1e300` and
  `9007199254740992` are invalid, and `1.5` and `1e-400`, read as 0, are valid.
- More than 128 nested arrays and objects, or more than 100000 values, is
  `JSON_LIMIT`. Each array element, each object member's value and the
  top-level value count as values; keys do not.
- A JSON or Markdown text of more than 4194304 UTF-16 code units is
  `JSON_LIMIT`. Under the default file bound no file reaches it.

Each record below names its fields. A record that is not a JSON object is
`RECORD_OBJECT`, each field it does not name is `FIELD_UNKNOWN`, and each
required field that is missing is `FIELD_REQUIRED`. A field the record names
holds the value it is given there; one of another JSON type breaks that field's
rule.

**IDs.** An ID is a string that matches `^[a-z0-9][a-z0-9-]*$` and is at most
100 characters; any other value where an ID is required is `ID_INVALID`. Each
kind of record has its own namespace: Tree IDs are unique among the Atlas's
Trees, Point IDs among all its Points, Facet IDs among the Facets of their
owning Tree and Check IDs among its Checks. A Point MAY have the ID of a Tree.

## Record paths

A record path is text that:

- is 1 to 4096 UTF-16 code units long, well-formed (no unpaired surrogate) and in NFC;
- does not begin with `/`;
- contains no `\`, `:`, `#` or `?` and no character U+0000 to U+001F or U+007F;
- consists of components separated by `/`, none of them empty, `.` or `..`;
- has no component that begins with `.atlas-` once lowercased. Such components
  are reserved for Atlas's own files.

Every captured file and every Tree directory MUST have a record path, so record
paths remain within the Atlas. A file found while capturing whose path is not a record
path is `PATH_UNSAFE` and is not read. Two paths are aliases when they are
equal once in NFC and lowercased but are spelled differently. A path whose
spelling differs from the names its directories hold, as a case-insensitive or
normalizing file system allows, is `PATH_ALIAS` and is not read. So is a path
whose first one or more components alias the same number of components of an
earlier captured path; that file is not captured. A symbolic link, or a path
through one, is `PATH_SYMLINK` and is not read. An entry that is neither a
regular file nor a directory, and a `points/`, `facets/` or `.checks/` that is
not a directory, is `FILE_KIND`.

## Atlas manifest

`atlas.json` is an object with exactly `format`, `id`, `title` and `trees`; it
is required (`FILE_MISSING`), and a manifest that is not an object is
`RECORD_OBJECT`. `format` is `atlas/1.2` (`FORMAT_UNSUPPORTED`). `id` is an ID.
`title` is nonblank text. `trees` is an ordered array of at most 10000 Tree
directories (`ARRAY_INVALID`); an Atlas MAY have no Trees. A manifest that is
not an object, or whose `trees` breaks this rule, is not read further.

Each Tree directory is a record path that, once in NFC and lowercased, is not
`atlas.json`, `style.md` or `.checks` and does not begin with one of them
followed by `/` (`TREE_PATH`). Compared the same way, it MUST NOT equal,
contain or lie inside an earlier Tree directory (`TREE_OVERLAP`). Both rules
report `atlas.json`, and a directory that breaks one is not read further. Each
Tree directory holds one `tree.json` (`FILE_MISSING`).

```json
{
  "format": "atlas/1.2",
  "id": "example",
  "title": "Example",
  "trees": ["trees/product", "trees/architecture"]
}
```

## Tree and outline

`tree.json` is an object with exactly `id`, `title`, `scope`, `base` and
`children`. `id` is an ID, unique among Trees (`TREE_DUPLICATE`). `title` and
`scope` are nonblank text; the scope is prose. `base` is an ID naming a Point
owned by this Tree. `children` is an array of at most 10000 placements
(`ARRAY_INVALID`): the ordered development beneath that Base. A `tree.json`
that is not an object is not read further.

A placement is an object (`RECORD_OBJECT`) with `point`, an ID, and optional
`children`, an array of at most 10000 placements (`ARRAY_INVALID`), which MAY
be empty. The Base and each placement name a Point that exists
(`POINT_MISSING`) and belongs to this Tree (`POINT_OWNER`). A Point is named at
most once across the Base and all placements (`POINT_MULTIPLE_HOME`), and every
Point is named (`POINT_UNPLACED`). The outline rules report the Tree's
`tree.json`; `POINT_UNPLACED` reports the Point's file. All the Atlas's
outlines together hold at most 10000 placements (`OUTLINE_LIMIT`); their depth
is bounded by the JSON nesting limit.

Every file under the Tree's `points/` directory is a Point and every file under
its `facets/` directory is a Facet, and each belongs to that Tree: the Tree is
its owner, and its normalized `tree` is that Tree's ID. Each file's name ends
in `.md` (`RECORD_EXTENSION`), so a stray file such as `.DS_Store` makes the
Atlas invalid.

```json
{
  "id": "product",
  "title": "Product",
  "scope": "User needs and behavior.",
  "base": "purpose",
  "children": [
    {"point": "offline-work", "children": [{"point": "sync-after-reconnect"}]}
  ]
}
```

## Markdown records

Points, Facets, Checks and the Style are Markdown records. Markdown is
CommonMark.

**Header.** Points, Facets and Checks begin with one JSON header. The first
line is exactly `---`, and the header ends at the next line that is exactly
`---`; without either, the record is `MARKDOWN_HEADER`. The lines between,
joined with LF, are one strict JSON value, which MAY span several lines and is
an object (`MARKDOWN_HEADER`). The record's Markdown is the lines after the
closing delimiter. The Style has no header, and it MUST NOT begin with a `---`
line: a `style.md` whose first line is exactly `---` is `MARKDOWN_HEADER`, so a
Style written with a header is caught by name. The Style's Markdown is the whole
file.

**Title.** A top-level heading is an ATX or Setext heading that is not inside a
block quote or a list item. The first top-level heading of the Markdown is an
H1 whose title is nonblank, and no other top-level heading is an H1
(`MARKDOWN_TITLE`). The title is that heading's text content, trimmed.

**Body.** The body is the Markdown's lines without the title heading's lines
(the ATX line, or the Setext text lines and underline), joined with LF and
trimmed. Text before the title stays in the body.

**Text content.** The text content of inline Markdown is its text as CommonMark
parses it, with backslash escapes and entity and numeric character references
decoded. It keeps the content of code spans, the text of links and autolinks
and the descriptions of images. It removes the delimiters of emphasis and
strong emphasis, the backticks of code spans, the brackets, destinations and
titles of links and images, and the closing sequence of an ATX heading. In raw
HTML it removes each comment from `<!--` to the next `-->`, then each run from
`<` to the next `>`, and keeps the rest. A line break reads as one space.
Delimiter characters that CommonMark does not parse as markup stay as text.
`` # Service *purpose* `x` ## `` has the title `Service purpose x`, and `# **a*`
has the title `*a`.

**Explanation.** The body contains an explanation (`MARKDOWN_BODY`): at least
one letter or digit, a character of Unicode general category L or N, in the
text content of a block that is not a heading. Heading text at any depth, HTML
comments and tags, link destinations, link reference definitions, code fence
info strings and markup characters supply none. The content of a code block,
the description of an image and the text of raw HTML outside its tags do. So a
body of `** __`, `&amp;`, `***`, `<div></div>`, `![](x.png)`,
`[source]: evidence.md` or `> # Quoted heading` is invalid, and a body of one
fenced code block with code in it is valid.

**Links.** Markdown links provide references; the Tree outline defines
membership. A link to a record names the record's file and carries no
fragment: a record is read whole, and a reader's address names the record
alone. A fragment on a link to a record, or a link to a heading within the same
record, is the reference diagnostic `REFERENCE_FRAGMENT`. A link to a source
file MAY carry a fragment naming a heading there; a link to a local file that
is not a record resolves only to a source the same record cites, and is
otherwise the reference diagnostic `REFERENCE_MISSING`. Reference diagnostics come
from an index of links kept apart from the view: they never appear among a
view's diagnostics and never change its status, so an Atlas whose links are
dangling or carry fragments is still accepted. Raw HTML and executable content
receive no execution authority.

### Style

The Style is the file `style.md` in the Atlas root. It is required: a Style
that is absent or holds only white space is `STYLE_REQUIRED`. It is a Markdown
record without a header. Its H1 names the Style and its body is the Atlas's
complete policy. Its exact local bytes are authoritative: a title shared with a
curated definition is a label, not a reference to it.

```markdown
# Subjects, briefly

Each Tree keeps one durable capability whole: what it is for, how it works,
where it fails and what shows that. A Point says enough for a reader to find
the claim, its conditions and the source that holds the detail.
```

### Point

The header is an object with `id` and optional `type`, `status`, `observedAt`,
`sources` and `uncertainty`. `id` is an ID, unique among the Atlas's Points
(`POINT_DUPLICATE`, reported on the later file in reading order). `uncertainty`
is nonblank text. `sources` is an array of at most 10000 source references
(`ARRAY_INVALID`), which MAY be empty except on an observation.

Supported Types are limited to `decision` and `observation`; any other `type`
is `TYPE_UNSUPPORTED`. `type: "decision"` requires `status`: `open`,
`proposed`, `selected`, `rejected` or `superseded` (`DECISION_STATUS`).
`type: "observation"` requires a date in `observedAt` (`OBSERVATION_DATE`) and
at least one source (`OBSERVATION_SOURCE`). `status` on a Point that is not a
decision is `STATUS_TYPE`, and `observedAt` on a Point that is not an
observation is `DATE_TYPE`.

A date is `YYYY-MM-DD`, or that followed by `THH:MM:SS`, an optional `.` with
1 to 9 digits, and a zone: `Z`, `+HH:MM` or `-HH:MM`. Digits are ASCII and `T`
and `Z` are uppercase. The date is a day of the Gregorian calendar, years 0000
to 9999 with its leap years; hours are 00 to 23, minutes 00 to 59 and seconds
00 to 59, so there is no leap second; a zone's hours are 00 to 23 and its
minutes 00 to 59. `2024-02-29`, `2024-01-01T10:00:00.123456789Z` and
`2024-01-01T10:00:00+05:30` are dates; `2024-01`, `2024-01-01T10:00Z`,
`2024-01-01T10:00:00` and `2016-12-31T23:59:60Z` are not.

```markdown
---
{"id":"offline-work","sources":[{"uri":"sources/product-requirements.md#offline","role":"evidence"}]}
---
# Users can keep working while offline

Users can read and edit downloaded documents while offline. Changes
synchronize after the connection returns.
```

### Facet

The header is an object with `id`, `on`, `via` and `targets` and optional
`sources` and `uncertainty`, with `sources` and `uncertainty` as for a Point.
`id` is an ID, unique among the Facets of the owning Tree (`FACET_DUPLICATE`,
on the later file). `on` is the ID of a Point of the owning Tree
(`FACET_HOST`). `via` is the ID of a Tree (`FACET_TREE`) other than the owning
Tree (`FACET_SELF`). `targets` is a nonempty array of at most 10000
(`ARRAY_INVALID`) IDs, each of a Point of `via` (`FACET_TARGET`), none of them
repeated (`TARGET_DUPLICATE`). A Facet about the whole of another account
targets that account's Base. Targets retain their own identity, ownership and
placement.

```markdown
---
{"id":"offline-storage","on":"offline-work","via":"architecture","targets":["local-storage"]}
---
# Offline editing depends on local storage

The offline experience requires documents and pending edits to remain
available between sessions. The Architecture account explains storage and
synchronization.
```

### Source reference

A source reference that breaks any rule of this section is `SOURCE_INVALID`,
reported on the record that holds it.

A source is an object with `uri` and optional `title`, `role`, `revision`,
`locator` and `sha256`, and no other field. `uri`, `title`, `revision` and
`locator` are nonblank text. Role is `evidence`, `background`, `example`,
`implementation` or `history`; omission is an unclassified reference.
`evidence` is material that states what the citing sentence says;
`background` is context the sentence does not rest on; `example` is material a
worked case is drawn from; `implementation` is code or another artifact that
does what the sentence describes; `history` is an earlier state of the project
that the sentence describes as earlier. `uri`
contains no character U+0000 to U+0020, no U+007F and no `\`.

A URI that begins with `http://` or `https://`, in any case, is remote. It
parses as a URL under the WHATWG URL Standard, its host is not empty, and its
user name and password are empty.

Every other URI is an Atlas-root-relative path with an optional fragment. It
does not begin with a scheme (`[A-Za-z][A-Za-z0-9+.-]*:`) or with `/`, and it
contains no `?`, in its fragment either. Its path is the text before its first
`#`, and that path:

- is not empty;
- decodes from percent-encoding as UTF-8: each `%` is followed by two
  hexadecimal digits and the decoded bytes are valid UTF-8;
- encodes neither `/` nor `\` (`%2F` and `%5C` in either case);
- once decoded, does not begin with `/` or with an ASCII letter followed by
  `:`, and
  contains no `\` and no character U+0000 to U+001F or U+007F.

So absolute filesystem paths, credentials in URLs and executable URL schemes
are invalid. Relative source paths may leave the Atlas; reading them still
requires an explicit caller grant.

`sha256` is the stamp: 64 lowercase hexadecimal characters, the SHA-256 of the
cited material. A local Markdown file is a local file whose name ends in
`.md`, in any case. For a local Markdown file whose URI fragment names a heading,
the cited material is that section: from the first byte of the heading's first
line to the first byte of the first later heading of the same or a higher
level that is not inside a block quote or a list item, or to the end of the
file. A heading's name is its text content (see Title), lowercased, with every
character that is not a letter, a digit, a combining mark, white space, `_` or
`-` removed and each white space character replaced by `-`; a name already
used earlier in the same file gains `-1`, `-2`, and so on, in order. In a file
that begins with a record header, headings are read from the text after it. A
passage before a file's first heading can be cited only as the whole file. For
every other local reference the cited material is the whole file. A fragment into a local Markdown file
that names no heading there cites nothing; such a reference is broken, not a
reference to the whole file. Remote references are never fetched; a stamp on
one is carried and not verified.

### Check

Every file under `.checks/`, at any depth, is a Check, and its name ends in
`.md` (`RECORD_EXTENSION`). The header is an object with exactly `id`,
`status` (`draft`, `active` or `retired`; `CHECK_STATUS`) and `level`
(`required` or `advisory`; `CHECK_LEVEL`). `id` is an ID, unique among Checks
(`CHECK_DUPLICATE`, on the later file in path order).

A Check's sections are the top-level H2 headings of its body, each with the
content up to the next top-level H2 or the end. Their titles, which are their
text content trimmed and compared exactly, are `Requirement`, `Verification`
and `Failure`, then optionally `Exceptions`, in that order and with no other
top-level H2 (`CHECK_SECTION`). Each of the three required sections contains an
explanation by the rule for a body (`CHECK_SECTION`); `Exceptions` MAY be
empty. Content before `Requirement`, and headings of level 3 or more within a
section, are allowed.

A Check defines a requirement; verifying it is a reviewer's act and requires
that reviewer's own authority.

## Validation and captured views

A reader captures the authored files, validates them and returns a view.
Inspection MAY retain captured raw files and diagnostics for repair.

### Capture

A reader captures these files, in this order, and no others:

1. `atlas.json`.
2. `style.md`, when `atlas.json` was captured as UTF-8 text. Its absence is
   reported once, by the Style's rule.
3. When `atlas.json` is strict JSON for an object whose `trees` is an array of
   at most 10000 entries: for each entry in order that is a record path, that
   the Tree directory rule does not reserve and that is not an earlier entry
   spelled the same, `<directory>/tree.json`, then every file under
   `<directory>/points/`, then every file under `<directory>/facets/`.
4. Every file under `.checks/`.

`atlas.json` and each such `tree.json` are required (`FILE_MISSING`); a
`points/`, `facets/` or `.checks/` directory that is absent holds nothing. To
take every file under a directory is to read its entries in name order and,
for each: skip a regular file whose name begins with exactly `.atlas-write-`;
report an entry whose path is not a record path (`PATH_UNSAFE`) or that is a
symbolic link (`PATH_SYMLINK`), and read neither; enter a directory and take
every file under it before the next entry; and take anything else as a file.
Nothing else
in the Atlas folder is captured: sources, READMEs, temporary files, private
state, generated output and the candidate folder `.atlas-candidate` at the
Atlas root are outside the authored record inventory. Below the root,
`.atlas-candidate` is a reserved component like any other.

Each captured file is `{path, content, sha256, bytes}`: `path` its record path,
`content` its decoded text, `sha256` the SHA-256 of its exact bytes in
lowercase hexadecimal and `bytes` their number. A file that is not UTF-8 has
`content: null` and `rawBase64`, its exact bytes in padded RFC 4648 base64.
A file that fails to be read is not captured.

Validation reads only the captured files. A captured file that is not the
manifest, the Style, a validated Tree's `tree.json`, or a file under a
validated Tree's `points/` or `facets/` or under `.checks/` is
`RECORD_UNEXPECTED`. On disk this happens to the files of a Tree whose
`tree.json` is missing or is not an object, or whose directory overlaps an
earlier one.

### Bounds

A reader MUST bound what it reads:

- each file at 2097152 bytes (2 MiB);
- the capture at 10000 files and at 67108864 bytes (64 MiB) in all;
- the directories under `points/`, `facets/` and `.checks/` at 64 levels below
  them;
- the directory entries listed in one capture at four times the file bound,
  40000 by default.

Each of these is `READ_LIMIT`, and the file or directory that passes the bound
is not read. The same bounds hold for files a reader is given rather than
reads from disk. A caller MAY give a reader another file-size bound, up to
67108864 bytes, or another file bound, up to 100000; readers compared with
each other use the same bounds. The bounds on content (`JSON_LIMIT`,
`ARRAY_INVALID` and `OUTLINE_LIMIT`, stated with their rules above) are fixed.

### Changes during capture

A reader MUST check for observable file changes during capture and report each
change it detects as a diagnostic. A file's signature
is its device, inode, mode, size, and modification and status-change times in
nanoseconds. A reader takes a file's signature without following links before
it opens the file, from the open file before and after reading it, and without
following links again after reading; any difference, or a path that no longer
resolves to the same file, is `READ_CHANGED`. It takes each directory's
signature before listing it. Once capture is done it takes the signature of
every captured file and listed directory again, and a difference or a
disappearance is `READ_CHANGED`, reported at the file's path or at the
directory's path followed by `/`. A file that cannot be read for lack of
permission is `READ_DENIED`; any other failure to read a file or list a
directory is `READ_ERROR`, or the platform's name for the error, such as
`ENOTDIR` or `EACCES`.

### Diagnostics and status

Readers report deterministic diagnostics. A diagnostic is an object with
`code`, `path` and `message`. `code` is the code this document gives the rule
that is broken. `path` is the path that rule names: the file itself, unless the
rule says otherwise, and a directory's own path for a rule about a directory.
`message` is prose for a person, and readers need not agree on it. A view
whose status is not `ready` has at least one diagnostic, and every diagnostic a
reader reports has the code and path given here. A reader MAY stop at the first
broken rule. A file that does not parse reports one diagnostic, for the first
rule it breaks: for JSON, the first error in reading order; for a Markdown
record, in the order text length, line endings, header delimiters, the
header's JSON, the header being an object, title, body. A record that is
missing or does not parse, and a `tree.json` that
is not an object, take no further part in validation, so the rules that refer
to them can report more diagnostics: a placement of a Point whose file does not
parse is `POINT_MISSING`.

The view is `incomplete` when any diagnostic is `READ_LIMIT`, `READ_CHANGED`,
`READ_DENIED`, `READ_ERROR` or a platform's error name; otherwise it is
`invalid` when there is any diagnostic, and `ready` when there is none. Every
other code describes the files as they stand, so it is invalid, not
incomplete: `FILE_MISSING`, `FILE_UTF8`, `FILE_KIND`, `PATH_UNSAFE`,
`PATH_ALIAS` and `PATH_SYMLINK` among them. Invalid or incomplete input MUST
NOT produce an accepted normalized Atlas.

### Normalized view

A view is an object with exactly these fields:

- `format`: `atlas.view/1`.
- `status`: `ready`, `invalid` or `incomplete`.
- `root`: the absolute path of the Atlas directory read, without resolving
  symbolic links.
- `identity`: the view identity.
- `files`: the captured files, sorted by path.
- `diagnostics`: sorted by path, then code, then message.
- `atlas`: the accepted normalized Atlas when the status is `ready`, and `null`
  otherwise.

The accepted Atlas is an object with exactly `format`, `id` and `title`, as the
manifest gives them, and `style`, `trees`, `points`, `facets` and `checks`.
Each record is an object built from what its file holds, with nothing added,
removed or defaulted beyond the fields named here; "as written" means the
decoded JSON values.

- `style` is `{title, body, path}`, with `path` `style.md`.
- Each Tree is the fields of its `tree.json` as written, `children` with its
  placements included, and `path`, its `tree.json` path.
- Each Point is the fields of its header as written, `sources` included, and
  `tree`, the ID of its owning Tree, `path`, `title`, `body` and `ancestors`.
- A Point's `ancestors` are the Points above it in its Tree's outline, each
  `{id, tree}`, from the Base first to its parent last. The Base has none.
- Each Facet is the fields of its header as written and `tree`, `path`,
  `title` and `body`.
- Each Check is the fields of its header as written and `path`, `title`,
  `body` and `revision`, the SHA-256 of the Check file's exact bytes in
  lowercase hexadecimal.

Trees are in manifest order. Points are in reading order: Tree by Tree in
manifest order and, within a Tree, by path; Facets likewise. Checks are by
path.

### View identity

A view's identity is the SHA-256 digest, in lowercase hexadecimal, of the
concatenation, over the captured files in path order, of: the number of bytes
of the path's UTF-8 encoding in ASCII decimal digits, `:`, those bytes, the
number of bytes of the file in ASCII decimal digits, `:`, and the file's exact
bytes. A capture of only `atlas.json` holding `{}` hashes the 17 bytes
`10:atlas.json2:{}`. A file that is not UTF-8 enters with its exact bytes, so
the identity of an Atlas with such a file changes when the file is repaired. An
incomplete view's identity covers only the files it captured.

Captured files and normalized records are immutable under that identity. It
identifies one reading observation, not an atomic filesystem snapshot.
