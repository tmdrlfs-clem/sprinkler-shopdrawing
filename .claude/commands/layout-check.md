---
description: Lay out a room shape and report whether it obeys every rule
argument-hint: [shape description or corner list in mm]
---
Lay out the room described in $ARGUMENTS and report on it.

Write a throwaway script under the scratchpad directory that uses
`tests/harness.mjs`: build the polygon in millimetres, call `layout()` for
both ELH and OH1, then `analyse()` the result. Report head count, area per
head against the limit, coverage, gaps, furthest wall point against the
limit, and closest head spacing.

If any rule is broken, that is a bug in `src/core/50-layout.js` — find it,
fix it, add the shape to `SHAPES` in `tests/layout.test.mjs`, and run
`npm test` to confirm nothing else regressed.
