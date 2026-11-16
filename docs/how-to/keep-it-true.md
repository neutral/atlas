# Keep an Atlas true as the project changes

Use this guide when the project's documents or code changed.

A source reference can carry a stamp: the hash of what it cites, taken when
the Point was last checked against it. A stamp that no longer matches is a
reason to read the Point again, not proof that it is wrong. Why, and what
Atlas can and cannot tell, is in
[Keeping an Atlas true](../explanation/keeping-it-true.md); every status and
field is in [Sources and stamps](../reference/sources.md).

## See what went stale

Run the stale report, with `ATLAS` the Atlas's directory:

```sh
atlas --root ATLAS stale
```

From a source checkout the command is `pnpm atlas`, run from the repository
root ([Install Atlas](install.md#from-the-source-checkout)). When the Atlas
cites files outside its own directory, grant the project too, with `PROJECT`
the project's directory:

```sh
atlas --root ATLAS --allow-source-root PROJECT stale
```

A stamped source outside the grants is reported `denied`, and an unstamped
one `unstamped` with the `code` `SOURCE_DENIED`: neither was read, which says
nothing about whether it changed
([Source grants](../reference/configuration.md#source-grants)). Give the same
grant to `read-source` and `stamp` below: without it, `read-source` reports
such a source `denied`, and `stamp` lists it under `skipped` and leaves its
stamp as it was.

Read three things in the report:

- `counts`: how many source references are `current`, `changed`, `missing`,
  `denied`, `unstamped` or `remote`. An `unstamped` reference is never
  reported `changed`: stamp a Point once it has been read against its sources
  ([Stamp what was read](#stamp-what-was-read)).
- `summary`: each changed or missing source once, by its `uri`.
- `citers` under each: the Points and Facets that cite it. These are what to
  read again.

The summary holds 100 sources by default. When `bounds.exhaustive` is
`false`, there is more: give `bounds.next` back as INPUT,
`echo 'NEXT' | atlas --root ATLAS stale -` with `NEXT` that object, for the
next page, and look at `bounds.unread`, the references past the report's
bound that it did not read
([The stale report](../reference/sources.md#the-stale-report)).

On a copy of the shipped example, after a clause was added to one sentence of
the brief's "Offline work" section:

```text
  "counts": {
    "references": 13,
    "current": 10,
    "changed": 3,
```

```text
      "uri": "sources/brief.md#offline-work",
      "status": "changed",
      "citers": [
        {
          "kind": "point",
          "id": "offline-work",
```

```text
      "uri": "sources/brief.md",
      "status": "changed",
      "citers": [
        {
          "kind": "point",
          "id": "product-purpose",
```

The section changed, so the Point that cites it is listed; so are the two
Points that cite the whole brief, `product-purpose` and `storage-purpose`.
The ten other references stay `current`.

The Portal marks the same on each Point's page: the sources line of "Offline
work stays on the current device" reads "3 sources · 1 changed since this was
checked", and the source's line carries `△ changed since this was checked`
([Read an Atlas](read-an-atlas.md#check-what-a-point-rests-on)).

## Have the agent read again

Ask your agent: "Read each Point and Facet the stale report lists, and the
Facets attached to those Points, against their sources, and prepare a change
wherever one no longer holds." The attached Facets are read too because the
stamp below records them as well. For each record, the agent reads it and what
it cites now:

```sh
atlas --root ATLAS inspect point offline-work
atlas --root ATLAS read-source 'sources/brief.md#offline-work'
```

It then prepares a change for each record that no longer holds, or tells you
that it still does. You read the change and apply it as in
[Ask your agent for a change](ask-for-a-change.md).

In the example, the added clause asks that saved work survive a forced close
as well. "Offline work stays on the current device" did not say so, and the
agent prepared a change that says it, and that no trial has tested it. The two
top Points, and the Facet attached to "Offline work stays on the current
device", still held, and needed no change.

Apply each correction before you stamp. A stamp is prepared against the Atlas
as it stands, so a stamp draft prepared before a correction is applied is
refused with `STALE` afterwards.

## Stamp what was read

Once the agent has read the records and every correction is applied, stamp
them, naming each Point that was read:

```sh
atlas --root ATLAS stamp --point offline-work --point product-purpose --point storage-purpose
```

```text
  "counts": {
    "records": 4,
    "stamped": 3,
    "current": 3,
```

Stamping prepares a draft; nothing is stamped until it is applied. A stamp
records that the record was checked against that material, so stamp only what
was read. `--point` also stamps the Facets attached to each Point, which is
why four records count here. `--tree ID` and `--all` stamp every Point and
Facet of a Tree or of the Atlas; use them only when every one was read
([`stamp`](../reference/cli.md#stamp)). When every stamp is already current,
`stamp` answers `"status": "noop"` with `"draft": null`, and there is nothing
to apply.

The draft's `id` and `revision` are under `draft` in what `stamp` printed.
Home lists it under "Proposed changes" as "only stamps: 3 Points stamped,
nothing they say differs", and its page marks each Point "stamped". Apply it
with that ID and revision:

```sh
atlas --root ATLAS apply ID --revision REV
```

```text
  "status": "complete",
```

`atlas --root ATLAS stale`, with `--allow-source-root PROJECT` when you gave
it above, now reports `"status": "ready"`, with `changed`, `missing` and
`denied` all 0 in `counts` and an empty `summary`, and no sources line in the
Portal carries a mark.
