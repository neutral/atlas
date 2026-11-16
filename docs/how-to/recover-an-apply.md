# Recover an interrupted apply

Use this guide when an apply stopped before it finished.

An apply writes the files of a draft one at a time, and records each file's
earlier bytes in a journal before the first write. When it stops partway, the
Atlas may hold some of the change, the journal stays and the draft is kept.
Until you roll that transaction back, the Atlas takes no apply of any draft.
You roll it back from the journal, then apply the draft again. Why it works
this way is in
[How changes land](../explanation/how-changes-land.md#when-an-apply-is-interrupted).
Here `ATLAS` is the Atlas's folder. From a source checkout the command is
`pnpm atlas`, run from the repository root
([Install Atlas](install.md#from-the-source-checkout)).

## See what happened

An apply that fails partway says so. It prints `"status": "interrupted"`, its
transaction, the files it wrote and the error, and exits 1:

```text
  "status": "interrupted",
  "transaction": "c0885b92-40b4-4e82-a773-e5e6cb47b6ad",
  "written": [
    "trees/architecture/points/sync.md"
  ],
  "error": {
    "code": "EACCES",
```

When it saved its journal before it stopped, as it does before its first
write, every apply of the Atlas from then on, of this draft or any other, is
refused with `LOCKED` and exit 3 until that transaction is rolled back:

```text
    "code": "LOCKED",
    "message": "Interrupted transaction c0885b92-40b4-4e82-a773-e5e6cb47b6ad needs recovery."
```

The Portal says the same of every draft that is not invalid: "Blocked: an
interrupted apply needs recovery first", and under "To recover" the command
that lists what to recover in place of the one that applies it. When the
apply could not save its journal at all, as when the folder of journals
cannot be written, it wrote nothing, nothing is listed and nothing is
locked.

An apply whose process was stopped, by a crash or a kill, prints nothing.
Stopped after it saved its journal and before it set it `complete`, it leaves
its transaction unfinished, with the same refusal. Stopped before it saved a
journal, or once it had set it `complete`, it locks nothing; in the second
case the change is in the Atlas, and the `complete` journal stays unless the
apply had removed it.

List the transactions:

```sh
atlas --root ATLAS recover
```

Each transaction has an `id`, its `phase` and the files `written`, and an
`error` when one was recorded. The one to roll back is in phase
`interrupted`, `applying` or `prepared`, or `rolling-back` when a rollback
itself stopped; its `id` is `TRANSACTION` below. Roll it back whatever it
wrote, even when `written` is empty. A completed apply and a finished rollback
each remove their journal, so neither is listed. One listed `rolled-back` was
rolled back already: `recover` with its ID removes it. One listed `complete`
is an apply that completed; it stops no apply and needs no recovery, and its
draft, if it is still listed, is checked as below. `written` is
not an exact account: a process that died right after a write leaves that
file changed and not yet listed, so do not take a file's absence from
`written` to mean it holds its old bytes. Recovery checks every file of the
change itself.

When the list holds no transaction to roll back and nothing under
`unreadable`, no journal stops an apply, but the list does not say whether
the apply wrote anything: one that could save no journal wrote nothing, and
one stopped once complete may have removed its journal and left the change in
the Atlas. When `atlas --root ATLAS drafts` no
longer lists the draft, the apply completed. Otherwise read
`atlas --root ATLAS review ID`. With `"stale": false` the Atlas is still what
the draft was prepared against: [apply the draft again](#apply-again). With
`"stale": true` it is not: read the Points the draft changes, in the Portal or
with `atlas --root ATLAS inspect point POINT`. When they say what the draft
proposes, the change is in the Atlas, so delete the draft
(`atlas --root ATLAS drafts delete ID --revision REV`); otherwise ask your
agent to prepare the change again
([Ask your agent for a change](ask-for-a-change.md)).
[Apply](../reference/changes.md#apply) says when an apply saves a journal and
when it removes one.

A journal that cannot be read is listed under `unreadable`, by its `file`, and
every apply is refused, naming it: with `INVALID_STATE` for one that is not
JSON or not a whole journal, and with the code of the failure otherwise, such
as `UNSAFE_PATH` for a symbolic link. A file listed there as "The file name is
not a transaction identity." stops no apply. `recover` cannot roll back a
transaction whose journal it cannot read, since it cannot read what that
transaction changed.
Check the Atlas's files yourself: `atlas --root ATLAS validate`, and
`review ID` for the draft you meant to apply. Then remove that file from the
`transactions` folder of the directory that `atlas --root ATLAS state` names
as `state.directory`, and apply again.

Before you roll back, remove the cause the error names, here a folder the
apply could not write to: recovery writes to the same files.

## Roll it back

```sh
atlas --root ATLAS recover TRANSACTION
```

```text
  "status": "rolled-back",
  "transaction": "c0885b92-40b4-4e82-a773-e5e6cb47b6ad",
  "identity": "bee2cc7ff0e77e53e29af6e8dc0923f42f832ceca55563d39249b1f5c5ca6237",
  "baselineRestored": true,
```

Recovery puts back the earlier bytes of each file of the change that holds
the bytes the change proposed, whoever wrote them, leaves a file that holds
its earlier bytes as it is, writes nothing else, and removes the journal. So
even after an apply that wrote nothing, a file set by hand to what the change
proposed is put back. Read `baselineRestored`. `true` says the Atlas reads
back whole and is again exactly what the apply started from. `false` says it
is not. Read `atlas --root ATLAS validate` first:

- When it reports `"status": "incomplete"`, the Atlas does not read back
  whole, and every apply is refused with `INCOMPLETE` until it does. Fix what
  its diagnostics name: a file that cannot be read (`READ_DENIED`, such as
  one whose permissions changed), or folders left too deep or too many
  (`READ_LIMIT`, such as "Directory depth exceeds 64."). Then apply the same
  draft at the same revision. While a file cannot be read, `review` can
  report `"stale": true` for a draft that is not stale.
- When the Atlas reads whole and `atlas --root ATLAS review ID` reports
  `"stale": true`, a file outside the change was edited meanwhile. That edit
  stays, and the change is to be prepared again
  ([Ask your agent for a change](ask-for-a-change.md)).

A rollback is not a completion: the change is not in the Atlas until you
apply it again.

Before it writes anything, recovery checks every file of the change, written
or not, and refuses with `RECOVERY_CONFLICT` when one holds neither its
earlier bytes nor the ones the change proposed, as after an edit by someone
else, naming the file:

```text
    "code": "RECOVERY_CONFLICT",
    "message": "Foreign edits prevent recovery: trees/architecture/points/sync.md"
```

Undo that edit, so the file holds what it held before the apply or what the
change proposed, then run the same `recover` again. A rollback
that stops partway leaves its transaction in `rolling-back`; once the cause is
removed, the same `recover TRANSACTION` finishes it. The journal and each
refusal are in [Recover](../reference/changes.md#recover).

## Apply again

The draft is kept, with its `id` and `revision` (`ID` and `REV`, from
`atlas --root ATLAS drafts`). Its page in the Portal says "Ready to apply"
again, and `atlas --root ATLAS review ID` reports `"stale": false`. Apply it:

```sh
atlas --root ATLAS apply ID --revision REV
```

```text
  "status": "complete",
```

If the Atlas is not what the draft was prepared against, as after an edit to
a file outside the change, the apply is refused with `STALE`: the draft no
longer matches, so ask your agent to prepare the change again
([Ask your agent for a change](ask-for-a-change.md)). If the Atlas does not
read whole, it is refused with `INCOMPLETE` until you fix what
`atlas --root ATLAS validate` names.

`atlas --root ATLAS recover` now lists neither the transaction you rolled
back nor the new apply: a rollback removes its journal, and so does a
completed apply.
