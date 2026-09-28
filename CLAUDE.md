# Sprinkler Shop Drawing Drafter

A browser tool for laying out sprinkler heads on a PDF drawing. Open a
reflected ceiling plan, set the scale, trace the rooms, and it places the
heads, dimensions them, checks them against the rules, and writes a
marked-up PDF back out. Everything runs client side; no file is uploaded.

Built for NZS 4541 work, but the rule figures are the designer's to enter —
see **Rule figures are not verified** below.

## Shape of the project

The deliverable is one HTML file. `src/` holds it split into readable
pieces; `build.mjs` concatenates them back, in the order listed in
`src/order.json`, with no bundler, transpile or import graph. The source
files are plain scripts sharing one scope, exactly as they did when they
lived in one file — that is why they declare globals and do not import
each other.

```
src/core/     pure logic: no DOM, no canvas, fully tested
src/ui/       everything that touches the page
src/shell.*   the HTML around the script
build.mjs     concatenate -> dist/
tests/        node:test against the real core, via a vm sandbox
```

`npm run build` writes `dist/sprinkler-shop-drawing-drafter.html`.
`npm test` builds, then runs every test.

## Working on it

**Put logic in `src/core/`.** Anything that computes a position, a
distance, an area or a verdict belongs there, where a test can reach it.
`src/ui/` should only draw and handle input. When a calculation turns out
to be living in a UI file, move it — that is what happened to
`headWallDims`, and it was untested for as long as it stayed put.

**Tests run the shipped code.** `tests/harness.mjs` loads the real
`src/core/*.js` into a `node:vm` sandbox with a thin browser stub. No
algorithm is copied into a test, so a test can only pass if the code the
user opens passes.

**Every fix gets a case.** This tool has been wrong in ways that looked
right on screen — a grid tilted by one diagonal wall, a leg of a room with
no head in it, a fill that stopped at a stray line. Each is now a named
test. Add to them rather than checking by eye.

Run `npm test` before shipping anything. It takes about six seconds.

## How the layout works

Laying out a room happens in five passes, in `src/core/50-layout.js`:

1. **Grid** — rows and columns across the room's bounding frame, spaced to
   satisfy the spacing and wall-distance limits. Where a ceiling grid is
   known, the rows are placed on tile points from the start; nudging
   finished heads does not work, because a layout already at its
   area-per-head limit has no slack to give.
2. **Nudge** — a grid point outside the room walks back in along the grid
   axes until it is inside and clear of the walls.
3. **Repair** — sample the floor and the walls, and greedily add heads
   until nothing is left uncovered. Wall points are mandatory; a sliver of
   floor under 0.05 m² is not worth a head.
4. **Prune** — drop any head whose every point is already covered by
   another, as long as area per head and wall reach still hold.
5. **Pull** — if a wall is still out of reach and no head can be added
   (every position that would cover it sits inside another head's minimum
   spacing), slide the nearest head instead, by the least amount that
   reaches, and keep the move only if nothing else comes uncovered.

Coverage is sampled on a ~150 mm lattice. Head lookups go through
`headIndex`/`coveredAt`, which bin heads by reach — without that, a large
floor plate took five seconds a room instead of half of one.

### Grid direction

Square to the page by default. The smallest enclosing rectangle is a bad
guide: one short diagonal wall tips it, and a fill-traced outline is full
of stair steps that tip it further. A room can be switched to "along the
main walls" (longest-run detection, weighted by length squared) or to the
bounding box, per room.

### Where a head cannot go

`blockedAt` is the one test every placement path uses — grid nudge,
repair, pull and tile snap — and the checks flag any head that fails it.
Two things block a spot:

- **A tile with a fitting in it.** A fitting is a *closed* outline (panel,
  grille, downlight) inside a tile or two; `extractVectors` records which
  runs of segments close, as `VEC.shapes`. Open linework is never a
  fitting: architects' dashed outlines and light-spread fans are open, and
  come through as loose dashes, not as a dash style. An outline that is the
  tile itself is the grid. If over half a room's tiles read as taken, it is
  a pattern and is set aside. Only the fitting itself, plus
  `OBST.fitClearMm`, is out of bounds, so a grille at one end of a 1200
  tile leaves the far third free. The designer's clicks (`room.tileMarks`)
  override what was read, and a tile marked by hand is taken whole.
- **A marked obstruction** (`page().obstacles`), kept clear by
  `obstacleClearMm()`.

This keeps heads off fittings. It does not model a fitting or beam
shadowing the spray.

### Coverage rule

A point counts as covered when it is inside a head's S×S square, S being
the maximum spacing — which is how the spacing and wall limits are
written. A circle option is offered and is looser at the corners. The
layout engine and the compliance checks always use the same one.

## Scale

Read from the drawing's own text where possible. `1:50`, `1 : 50 @ A1`,
`SCALE 1/100 AT A3` all parse, and the sheet a ratio was drawn for is
carried with it: a drawing set out 1:50 on A1 and reissued at A3 is
applied as 1:100. A-series steps convert as exact powers of √2, not by
dividing rounded paper sizes, so 1:20 at A1 becomes 1:40 at A3 and not
1:40.05.

Ratios that mean the same thing on this sheet are one choice, not several,
and a bare ratio folds into a sheet-qualified one. Only a single remaining
choice is applied automatically; anything else asks.

A printed ratio is only right if the sheet is at its original size, so the
app says where a scale came from and suggests checking it against a known
dimension.

## Rule figures are not verified

`DEFAULT_RULES` ships with placeholders. They are not NZS 4541 values and
must not be presented as though they were. The Rules tab makes the
designer enter the real figures and tick each class; until a class is
ticked, every check on it carries a warning. Keep that warning working.

The checks test the figures entered here and nothing else. Heads are kept
off marked obstructions and tiles with a fitting, but spray shadowing by
fittings and beams, and ceiling exceptions, are not modelled, and the tool
says so where a designer will read it. Do not add wording that implies
compliance.

## Things that have bitten before

- **Vector lines are judged by what lies inside the room**, not by where
  their midpoint falls. Ceiling grid lines cross the whole floor plate, so
  their midpoints are usually in some other room. This one silently
  disabled tile detection on every real drawing.
- **Vectors arrive after the first render.** Rooms traced before they load
  get re-laid when they arrive.
- **The fill spreads diagonally but a boundary walk cannot cross a corner
  contact**, so `closeDiagonals` runs before tracing or the outline closes
  early around the first blob.
- **A room is one room.** One fill, one Apply, one room. Unconnected
  patches are reported, never quietly turned into extra rooms.
- **The tile pitch is measured, not assumed.** Taking 600 mm through a
  scale that is 1% out put heads 70 mm off the drawn tiles across a 14 m
  room while the panel said every head was on a tile point. `bestPeriod`
  searches a few percent either side of each size; the size it finds is
  also shown, since it is a check on the scale.
- **A corridor holds too few grid lines to read one way.** Under 1200
  tiles a 3.6 m corridor crosses two or three; detection needs four, and
  the room silently got no grid. That axis is read from the grid around
  the room, if the room's own lines sit on it.
- **Some PDFs carry the architecture as a picture.** An as-built can have
  only the sprinkler layer as vectors, with the ceiling underneath embedded
  as an image. No grid and no fittings can be read from that; the tile
  grid has to be set by hand and fittings marked.
- **Annotation coordinates are base render pixels.** The sharp re-render
  at high zoom is display only; nothing that is measured may depend on it.
