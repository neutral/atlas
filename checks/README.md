# Shipped Checks

A Check is a review requirement an Atlas adopts for its own changes: what must
hold, how a reviewer verifies it, and what failure means. Adopt one by copying
its file into the Atlas's `.checks/` directory. Each Atlas keeps its own
copies and decides which catalogue updates to take.

| Check | Level | It requires |
| --- | --- | --- |
| [`evidence-review`](evidence-review.md) | required | Changed statements agree with the sources they cite, read by someone who did not write them. |
| [`reader-questions`](reader-questions.md) | required | Readers who have only the Atlas can find and answer the questions it is kept for. |
| [`whole-read`](whole-read.md) | advisory | An account read from top to bottom holds together. |
| [`identity-citations`](identity-citations.md) | required | Known connections still mean what they meant after a Point's scope changes. |
| [`source-accounting`](source-accounting.md) | required | Every material unit of supplied source material has a stated disposition. |
| [`editorial-style`](editorial-style.md) | advisory | A change follows the Atlas's own Style. |

Validation establishes that an Atlas is well formed. These Checks ask for the
two things validation cannot establish: that the Atlas agrees with its sources
and that it serves a reader. Atlas lists every Check with its status, and
only active ones govern; it does not evaluate them. A reviewer completes a Check's Verification against the
exact candidate and reports `pass`, `fail` or `unable` with the evidence, to
whoever authorizes the change. [Working with Atlas](../spec/OPERATING.md#keep-it-true)
describes the readers these Checks call for.
