import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, rectRoom } from "./harness.mjs";

const A = loadCore();
const mm = 12.37;

test("polygon area is exact for a rectangle", () => {
  const px = A.call("polyArea", rectRoom(10000, 6000));
  assert.equal(Math.round(px * mm * mm / 1e6), 60);
});

test("point in polygon handles an L shape", () => {
  const L = [[0, 0], [12, 0], [12, 4], [6, 4], [6, 9], [0, 9]].map(([x, y]) => ({ x, y }));
  assert.equal(A.call("pointInPoly", { x: 3, y: 7 }, L), true);   // in the leg
  assert.equal(A.call("pointInPoly", { x: 9, y: 7 }, L), false);  // in the bite
  assert.equal(A.call("pointInPoly", { x: 9, y: 2 }, L), true);   // in the bar
});

test("minimum enclosing rectangle finds the true angle of a tilted box", () => {
  const a = Math.PI / 6;
  const rot = p => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
  const r = A.call("minAreaRect", [[0, 0], [400, 0], [400, 200], [0, 200]].map(([x, y]) => rot({ x, y })));
  assert.ok(Math.abs(r.w * r.h - 400 * 200) < 400, `area ${(r.w * r.h).toFixed(0)}`);
  assert.ok(Math.abs(Math.abs(r.angle) - a) < 0.01 || Math.abs(Math.abs(r.angle) - (Math.PI / 2 - a)) < 0.01);
});

test("simplification keeps corners and drops noise", () => {
  const line = [];
  for (let x = 0; x <= 100; x++) line.push({ x, y: (x % 2) * 0.4 });   // jittered straight run
  line.push({ x: 100, y: 60 });
  const out = A.call("rdp", line, 2);
  assert.ok(out.length <= 4, `kept ${out.length} points`);
  assert.equal(out[0].x, 0);
  assert.equal(out[out.length - 1].y, 60);
});

test("distance to a polygon edge is measured, not to its corners", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => ({ x, y }));
  assert.equal(A.call("distToPoly", { x: 5, y: 3 }, sq), 3);
});
