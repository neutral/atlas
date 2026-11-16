---
{"id":"whole-read","status":"active","level":"advisory"}
---
# An account read from top to bottom holds together

## Requirement

Each account a change touches reads as one argument. Its titles, read down
any path, get more specific and do not contradict one another. No statement
appears twice with a difference. No Point claims more than the Points beneath
it and its sources support. A term means the same thing wherever it is used.

## Verification

A reader who did not write the change reads each affected account from its
top claim to its last Point, in outline order, and reports every
contradiction, every statement repeated with a difference, every claim above
that says more than the claims beneath it, and every term used in two senses,
naming the Points involved. Each finding is checked against the files and
fixed in the Point that owns the statement. The record names the accounts
read and the findings left open.

## Failure

Report `fail` when a contradiction, a diverging repetition or an overstated
higher claim remains. Report `unable` when an affected account was not read in
full.

## Exceptions

A change confined to one Point's wording, with no change to its claim, needs
only that Point and the Points above it to be read.
