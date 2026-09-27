import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./harness.mjs";

const A = loadCore();
const W = 400, H = 300;

const blank = () => new Uint8Array(W * H);
const box = (f, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f[y * W + x] = 1;
  return f;
};
const area = f => f.reduce((a, b) => a + b, 0);

/* Two blobs joined only at a pixel corner: a boundary walk cannot cross
   that contact, so this used to close the loop early and return just the
   first blob. Both halves have to come back as one region. */
test("a region pinched to a corner is traced as one piece", () => {
  const f = blank();
  box(f, 20, 20, 60, 60);
  box(f, 60, 60, 200, 140);
  const whole = 40 * 40 + 140 * 80;

  const loops = A.call("traceLoops", Array.from(f), W, H);
  assert.equal(loops.length, 1, "one region, not two");
  assert.equal(A.call("polyArea", loops[0]), whole);

  const r = A.call("polygonFromFill", Array.from(f), W, H);
  assert.ok(!r.error, r.error);
  assert.equal(r.stray, 0);
  assert.ok(Math.abs(A.call("polyArea", r.polygon) - whole) <= 60,
    `room came out at ${A.call("polyArea", r.polygon)}, expected about ${whole}`);
});

test("hatch dots inside a room do not become holes in it", () => {
  const f = blank();
  box(f, 20, 20, 280, 180);
  for (let y = 22; y < 180; y += 5) for (let x = 22; x < 280; x += 5) f[y * W + x] = 0;
  A.ctx.__f = Array.from(f);
  const promoted = A.run("fillHoles(__f, 400, 300)");
  assert.ok(promoted > 1000, `only ${promoted} hatch pixels reclaimed`);
  const loops = A.call("traceLoops", A.ctx.__f, W, H);
  assert.equal(A.call("polyArea", loops[0]), 260 * 160);
});

test("a line drawn through the fill does not split the room", () => {
  const f = blank();
  box(f, 20, 20, 380, 280);
  for (let y = 20; y < 280; y++) for (let x = 200; x < 203; x++) f[y * W + x] = 0;  // a wall line
  for (let x = 20; x < 380; x++) f[150 * W + x] = 0;                                 // a hatch edge
  const r = A.call("polygonFromFill", Array.from(f), W, H);
  assert.ok(!r.error, r.error);
  assert.equal(r.stray, 0, "the halves should be joined, not reported as leftovers");
  assert.ok(Math.abs(A.call("polyArea", r.polygon) - 360 * 260) < 400);
});

test("two rooms a clear gap apart are not merged", () => {
  const f = blank();
  box(f, 20, 20, 180, 280);
  box(f, 210, 20, 380, 280);
  const r = A.call("polygonFromFill", Array.from(f), W, H);
  assert.ok(!r.error, r.error);
  assert.equal(r.stray, 1, "the second region should be reported, not absorbed");
  assert.ok(Math.abs(A.call("polyArea", r.polygon) - 170 * 260) < 400, "the larger region wins");
});

test("one fill makes one room, with the corners kept", () => {
  const f = blank();
  box(f, 20, 20, 120, 160);
  box(f, 120, 20, 260, 80);
  const r = A.call("polygonFromFill", Array.from(f), W, H);
  assert.ok(!r.error, r.error);
  assert.equal(r.polygon.length, 6, "an L needs six corners");
  assert.ok(Math.abs(A.call("polyArea", r.polygon) - (100 * 140 + 140 * 60)) < 300);
});

test("a speck beside the room is ignored rather than reported", () => {
  const f = blank();
  box(f, 20, 20, 280, 180);
  box(f, 285, 190, 292, 197);
  const r = A.call("polygonFromFill", Array.from(f), W, H);
  assert.equal(r.stray, 0);
});

test("simplification keeps the outline where the pixels were", () => {
  const f = blank();
  box(f, 20, 20, 380, 280);
  const r = A.call("polygonFromFill", Array.from(f), W, H);
  const xs = r.polygon.map(p => p.x), ys = r.polygon.map(p => p.y);
  assert.deepEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    [20, 20, 380, 280]);
});
