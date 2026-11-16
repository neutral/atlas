# Check an Atlas with fresh readers

Use this guide before you rely on an Atlas, or after a large change.

Validation shows that an Atlas is well formed. Whether it answers a reader's
questions is shown only by readers who have the Atlas and nothing else, and
not by its author ([Keeping an Atlas true](../explanation/keeping-it-true.md)).
A fresh reader is an agent, or a person, that was not there when the Atlas
was written. The guide your agent is handed names the readers and what each
one does ([Keep it true](../../spec/OPERATING.md#keep-it-true)); this
guide sets up and runs a round of question readers.

## Keep a list of questions

Write down the questions the Atlas is kept to answer, as a reader would ask
them, each with the Points you expect to answer it. Atlas reads no such list
and sets no place or form for it, so where you keep it is your choice.

Keep it as a Markdown file in the project, beside the Atlas's directory and not
inside it, such as `PROJECT/atlas-questions.md`, `PROJECT` being the project's
directory:

```markdown
# Questions the Atlas is kept to answer

## When can a writer trust that an offline note is saved, and what does that say about other devices?

Expected Points: offline-work, delivery-promise, sync-policy, local-persistence.
```

The expected Points are the answers, so a reader must not see them. A reader
whose session holds only the Atlas's directory cannot read a file outside it,
and the Portal shows no file the Atlas does not cite. Inside the Atlas's
directory the file would not be out of reach: that directory is always
granted, so `read-source` reads any file in it. Give the file to the agent
that keeps the Atlas, which needs it to verify the Check below.

## Adopt the Checks

A Check states a requirement that changes to the Atlas must meet, how a
reviewer verifies it and what failure means. Atlas ships six
([Shipped Checks](../../checks/README.md)); two serve this guide.
`reader-questions` requires that readers with only the Atlas can answer the
questions on your list, and `evidence-review` that changed statements agree
with their sources.

A Check is adopted by copying its file into the Atlas's `.checks/` directory,
in a prepared change like any other. Ask your agent to adopt it, or run, with
`ATLAS` the Atlas's directory:

```sh
atlas --root ATLAS candidate
mkdir -p ATLAS/.atlas-candidate/.checks
cp "$(npm root --global)/@neutral/atlas/checks/reader-questions.md" ATLAS/.atlas-candidate/.checks/
atlas --root ATLAS validate --from .atlas-candidate
atlas --root ATLAS prepare --from .atlas-candidate --reason "Adopt the shipped Check reader-questions."
```

With Atlas installed in one project, run the commands there with `npx atlas`
in place of `atlas` and `"$(npm root)"` in place of
`"$(npm root --global)"`. From a source checkout the command is `pnpm atlas`,
run from the repository root
([Install Atlas](install.md#from-the-source-checkout)), and the Check is
`checks/reader-questions.md` there.

The draft's page in the Portal lists the Check under "What this Atlas is held
to", marked "new", with "Required · active" and its text. Read it and apply it
as any other draft ([Ask your agent for a change](ask-for-a-change.md#apply-it-or-ask-again)).
Then list the Atlas's Checks:

```sh
atlas --root ATLAS inspect checks
```

```text
      "id": "reader-questions",
      "status": "active",
      "level": "required",
```

A `required` Check must pass, by the reviewer's report, before a change is
applied, and an `advisory` one informs that decision
([Style and Checks](../../spec/SPEC.md#style-and-checks)). Atlas never
runs one: the reviewer verifies it and reports the result
([Checks](../../spec/spec/OPERATIONS.md#checks)).

## Run a round

Take the questions one at a time. The Check's Verification section says what
to do and what to report; the steps follow it.

1. Search with the question, and see whether an expected Point is among the
   first five results:

   ```sh
   echo '{"query":"When can a writer trust that an offline note is saved, and what does that say about other devices?","limit":5}' | atlas --root ATLAS search -
   ```

   On the shipped example, `offline-work` comes first. An expected Point that
   search does not find fails the question, whatever it says.

2. Give a fresh reader the Atlas and the question, and nothing else. Use a
   new agent session, not the one that wrote the Atlas. Give it the Atlas in
   one of two ways:

   - The Portal: start it with `atlas open PROJECT --no-browser` and give the
     reader the address it prints. Every page is complete without a script,
     so an agent that fetches pages reads what a person reads.
   - The MCP server, with only the Atlas's directory granted:
     `atlas --root ATLAS config` prints that configuration
     ([Connect an agent](connect-an-agent.md)).

   Hand a reader of the Portal this brief, with the address and the question
   filled in; for a reader through the MCP server, name its Atlas tools in
   place of the address:

   ```text
   You have not seen this project before. Its Atlas, an explanation of the
   project, is served as web pages at ADDRESS. Read it there and nowhere else.

   Answer this question from the Atlas alone:

   QUESTION

   Report:
   1. Your answer, with the conditions and limits that the Atlas attaches to it.
   2. The Points you used, each by its title and address.
   3. What you looked for and could not find, or found unclear.
   ```

3. Compare the answer with the expected Points and with the sources, and
   record the result as the Check's Failure section says: `pass`; `fail` when
   an expected Point was not found, or the answer is wrong, drawn from outside
   the Atlas, or misses a condition that would change what a reader does; or
   `unable` when there is no list of questions or no reader but the author.
   Read the Check whole with `atlas --root ATLAS inspect checks`.

On the shipped example, a fresh agent given only the Portal's address used all
four expected Points and kept their limits: one normal restart observed, and a
receipt that shows the server accepted a revision, not that another device has
it. The question passes. The reader also reported that it found no statement of
when another device receives a note.

## Act on what readers found

Check each finding against the files before you act on it: readers are wrong
too. In the example, the brief itself says a receipt does not establish that
other devices have the revision, and the Atlas says the same. The gap is open
in the project, not missing from the Atlas, so nothing changes.

For each finding that holds, ask your agent for a change in the Point that
owns the statement ([Ask your agent for a change](ask-for-a-change.md)), then
have the changed lines read once more. Add a question to your list when a
reader asks one it lacks. Findings do not reach zero: decide before a round
what ends it, and write down what you left.

You have a list of questions kept outside the Atlas, the Checks that
`atlas --root ATLAS inspect checks` lists, and for each question a reader's
report with its result, `pass`, `fail` or `unable`, and the changes it led to.
