import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, rectRoom } from "./harness.mjs";

const mm = 12.37;
const P = v => v / mm;
const PU = 600, PV = 1200, OU = 150, OV = 300;

/* Linework the way the vector reader hands it over: segments, plus the runs
   of them that form a closed outline. */
function drawing() {
  const segs = [], shapes = [];
  const d = {
    segs, shapes,
    line(x1, y1, x2, y2) { segs.push(P(x1), P(y1), P(x2), P(y2)); return d; },
    closed(pts) {
      const a = segs.length / 4;
      pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; d.line(p[0], p[1], q[0], q[1]); });
      shapes.push(a, segs.length / 4);
      return d;
    },
    rect(x0, y0, x1, y1) { return d.closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); },
    grid(W = 40000, H = 26000) {
      for (let x = OU; x <= W; x += PU) d.line(x, 0, x, H);
      for (let y = OV; y <= H; y += PV) d.line(0, y, W, y);
      return d;
    },
    // a light fitting as a reflected ceiling plan draws one: a panel with a stroke across it
    fitting(i, j) {
      const x0 = OU + i * PU + 100, x1 = OU + (i + 1) * PU - 100;
      const y0 = OV + j * PV + 450, y1 = OV + j * PV + 750;
      return d.rect(x0, y0, x1, y1).line(x0, y0, x1, y1);
    },
  };
  return d;
}

const room = { hazard: "OH1", polygon: rectRoom(12000, 8000, mm, 2000, 1500), ceiling: "tile", gridMode: "ortho" };
const tileOf = (A, t, h) => A.call("tileCell", h, t).key;
const occupancy = (A, r) => A.call("tileOccupancy", r);

test("heads keep out of tiles with a fitting drawn in them", () => {
  const A = loadCore();
  A.setVectors(drawing().grid().segs);
  const first = A.layout({ ...room, id: "r1" });
  const t = A.call("detectTiles", first.room);
  const used = [...new Set(first.heads.map(h => tileOf(A, t, h)))];
  assert.ok(used.length >= 4);

  // put a light in every tile a head chose, and lay the room out again
  const d = drawing().grid();
  for (const k of used) { const [i, j] = k.split(",").map(Number); d.fitting(i, j); }
  A.setVectors(d.segs, d.shapes);
  A.clearCaches();
  const again = A.layout({ ...room, id: "r1" });

  const occ = occupancy(A, again.room);
  assert.equal(occ.patterned, false);
  assert.deepEqual(new Set(used), new Set(occ.taken), "exactly the tiles with a light are taken");
  for (const h of again.heads)
    assert.ok(!used.includes(tileOf(A, t, h)), `head in a tile with a light, ${tileOf(A, t, h)}`);

  const res = A.analyse(again.room.id);
  assert.deepEqual(res.blockedHeads, []);
  assert.ok(!res.flags.some(f => /uncovered|exceeds|over the/.test(f)), res.flags.join("; "));
});

test("open linework is never a fitting", () => {
  const A = loadCore();
  const d = drawing().grid();
  const y = OV + 3 * PV + 600;
  d.line(0, y, 40000, y);                                       // a building grid line mid-tile
  for (let x = 2000; x < 9000; x += 450) d.line(x, 5000, x + 300, 5000);   // a dashed outline overhead
  for (let x = 2000; x < 9000; x += 450) d.line(x, 7000, x + 300, 7000);
  for (let v = 5000; v < 7000; v += 450) d.line(2000, v, 2000, v + 300);
  for (let k = -3; k <= 3; k++) d.line(6000, 3000, 6000 + k * 500, 4400);  // a light spread fan
  A.setVectors(d.segs, d.shapes);
  const occ = occupancy(A, { ...room, id: "r2" });
  assert.equal(occ.found, 0);
});

test("a grid drawn tile by tile is the grid, not a room full of fittings", () => {
  const A = loadCore();
  const d = drawing();
  for (let i = 0; i < 60; i++) for (let j = 0; j < 20; j++)
    d.rect(OU + i * PU, OV + j * PV, OU + (i + 1) * PU, OV + (j + 1) * PV);
  A.setVectors(d.segs, d.shapes);
  const occ = occupancy(A, { ...room, id: "r3" });
  assert.ok(occ, "the grid is still found");
  assert.equal(occ.found, 0);
});

test("a symbol in every tile is a pattern, and is set aside", () => {
  const A = loadCore();
  const d = drawing().grid();
  for (let i = 0; i < 60; i++) for (let j = 0; j < 20; j++) {
    const x = OU + i * PU + 200, y = OV + j * PV + 500;
    d.rect(x, y, x + 200, y + 200);
  }
  A.setVectors(d.segs, d.shapes);
  const { room: r, heads } = A.layout({ ...room, id: "r4" });
  const occ = occupancy(A, r);
  assert.equal(occ.patterned, true);
  assert.equal(occ.taken.size, 0);
  assert.ok(heads.length > 0);
});

test("a fitting across two tiles takes both", () => {
  const A = loadCore();
  const d = drawing().grid();
  const x0 = OU + 8 * PU + 100, y0 = OV + 3 * PV + 450;
  d.rect(x0, y0, x0 + 1000, y0 + 300);                // 1000 long over tiles 8 and 9
  A.setVectors(d.segs, d.shapes);
  const occ = occupancy(A, { ...room, id: "r5" });
  assert.deepEqual([...occ.taken].sort(), ["8,3", "9,3"]);
});

test("the designer's marks on a tile override what was read", () => {
  const A = loadCore();
  const d = drawing().grid().fitting(8, 3);
  A.setVectors(d.segs, d.shapes);
  const r = { ...room, id: "r6", tileMarks: { "8,3": false, "10,4": true } };
  const occ = occupancy(A, r);
  assert.deepEqual([...occ.taken], ["10,4"]);
});

test("heads keep their distance from a marked obstruction", () => {
  const A = loadCore();
  const gib = { hazard: "OH1", polygon: room.polygon, ceiling: "gib", id: "r7", gridMode: "ortho" };
  // a plant box dropped right where a head went
  const h0 = A.layout(gib).heads[0];
  const box = rectRoom(1000, 1000, mm, h0.x * mm - 500, h0.y * mm - 500);
  A.run(`page().obstacles = [{id:"o1", polygon:${JSON.stringify(box)}}]`);
  const { room: r, heads } = A.layout(gib);
  const clear = A.run("obstacleClearMm()");
  for (const h of heads) {
    const d = A.call("distToPoly", h, box) * mm;
    assert.ok(!A.call("pointInPoly", h, box) && d >= clear - 1, `head ${d.toFixed(0)} mm from the box`);
  }
  const res = A.analyse(r.id);
  assert.deepEqual(res.blockedHeads, []);
  assert.ok(!res.flags.some(f => /uncovered|exceeds|over the/.test(f)), res.flags.join("; "));
});

test("a head moved onto an obstruction is flagged", () => {
  const A = loadCore();
  const box = rectRoom(1000, 1000, mm, 6000, 4000);
  A.run(`page().obstacles = [{id:"o1", polygon:${JSON.stringify(box)}}]`);
  const { room: r } = A.layout({ hazard: "OH1", polygon: room.polygon, ceiling: "gib", id: "r8", gridMode: "ortho" });
  A.run(`(() => { const h = page().heads.find(h => h.roomId === "r8");
    h.x = ${P(6500)}; h.y = ${P(4500)}; h.auto = false; h.locked = true; })()`);
  const res = A.analyse(r.id);
  assert.equal(res.blockedHeads.length, 1);
  assert.ok(res.flags.some(f => /marked obstruction/.test(f)));
});
