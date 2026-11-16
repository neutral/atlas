---
{"id":"reader-questions","status":"active","level":"required"}
---
# Readers with only the Atlas can answer its questions

## Requirement

The project keeps a list of the questions the Atlas is kept to answer, each
with the Points expected to answer it. A reader who has only the Atlas can
find those Points and answer each question correctly, with the conditions
that limit the answer.

## Verification

Run each question through search and confirm that an expected Point is among
the first five results; a Point that cannot be found fails the question whatever it
says. Then give the questions the change could affect to readers who did not
write it and who have only the Atlas, through the Portal or the reading
operations. Each reader answers from the Atlas alone and names the Points
used. Compare the answers with the expected Points and with the sources.
Record every question a reader could not answer, answered wrongly, or answered
without a condition that limits it, and what was changed in response. Add a
question to the list when a reader asks one the list lacks.

## Failure

Report `fail` when an expected Point is not found, or a reader's answer is
wrong, incomplete in a way that would change what they do, or drawn from
outside the Atlas. Report `unable` when there is no list of questions or no
reader other than the author.

## Exceptions

A change that alters no title and no statement, such as a repaired link or a
new stamp, needs only the search step for the Points it touches.
