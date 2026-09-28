import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, rectRoom } from "./harness.mjs";

const mm = 12.37;
const P = v => v / mm;

/* Draw a ceiling grid over a whole floor plate, the way a reflected ceiling
   plan does: the lines run right across the sheet, so a single room is only
   ever a slice of them. */
function plateWithGrid({ W = 40000, H = 26000, pu = 600, pv = 1200, ou = 150, ov = 300, clutter = 800 } = {}) {
  const segs = [];
  if (pu) for (let x = ou; x <= W; x += pu) segs.push(P(x), P(0), P(x), P(H));
  if (pv) for (let y = ov; y <= H; y += pv) segs.push(P(0), P(y), P(W), P(y));
  for (let i = 0; i < clutter; i++) {
    const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI;
    segs.push(P(x), P(y), P(x + Math.cos(a) * 200), P(y + Math.sin(a) * 200));
  }
  return segs;
}

test("a grid spanning the whole plate is found inside one room", () => {
  const A = loadCore();
  A.setVectors(plateWithGrid());
  const room = { hazard: "OH1", polygon: rectRoom(12000, 8000, mm, 2000, 1500), ceiling: "tile" };
  const t = A.call("detectTiles", { ...room, id: "r1", gridAngle: 0, gridMode: "ortho" });
  assert.ok(t, "no grid detected");
  assert.deepEqual([t.u.sizeMm, t.v.sizeMm].sort((a, b) => a - b), [600, 1200]);
  assert.ok(Math.min(t.u.strength, t.v.strength) > 0.9);
});

test("random linework is not mistaken for a ceiling grid", () => {
  const A = loadCore();
  A.setVectors(plateWithGrid({ pu: 0, pv: 0, clutter: 1500 }));
  const t = A.call("detectTiles", { id: "r2", hazard: "OH1", gridAngle: 0, gridMode: "ortho",
                                    polygon: rectRoom(12000, 8000) });
  assert.equal(t, null);
});

test("heads centre on the tile's short side and take thirds along the long side", () => {
  const A = loadCore();
  A.setVectors(plateWithGrid({ W: 14000, H: 9000, pu: 1200, pv: 600, ou: 0, ov: 0, clutter: 150 }));
  const { room, heads } = A.layout({ hazard: "ELH", ceiling: "tile", gridMode: "ortho",
                                     polygon: rectRoom(12000, 7200) });
  const t = A.call("detectTiles", room);
  assert.ok(t, "grid not found");
  assert.ok(heads.length > 0);
  assert.ok(heads.every(h => h.tile), `${heads.filter(h => !h.tile).length} heads off the grid`);

  const ang = A.run(`roomFrame(${JSON.stringify(room)}).ang`);
  const frac = (v, g) => ((v - g.origin) / g.P % 1 + 1) % 1;
  for (const h of heads) {
    const r = A.call("rotTo", h, ang);
    const long = t.u.sizeMm > t.v.sizeMm ? frac(r.x, t.u) : frac(r.y, t.v);
    const short = t.u.sizeMm > t.v.sizeMm ? frac(r.y, t.v) : frac(r.x, t.u);
    assert.ok(Math.abs(short - 0.5) < 0.02, `short side at ${short.toFixed(3)}, expected the centre`);
    assert.ok([1 / 3, 0.5, 2 / 3].some(f => Math.abs(long - f) < 0.02),
      `long side at ${long.toFixed(3)}, expected a third, half or two thirds`);
  }
});

test("a GIB ceiling ignores any lines in the drawing", () => {
  const A = loadCore();
  A.setVectors(plateWithGrid({ W: 14000, H: 9000, pu: 1200, pv: 600, ou: 0, ov: 0, clutter: 150 }));
  const { heads } = A.layout({ hazard: "ELH", ceiling: "gib", gridMode: "ortho",
                               polygon: rectRoom(12000, 7200) });
  assert.ok(heads.length > 0);
  assert.equal(heads.filter(h => h.tile).length, 0, "GIB should never snap to a tile grid");
});

test("a grid set by hand works with no vectors at all", () => {
  const A = loadCore();
  A.setVectors([]);
  const { room, heads } = A.layout({
    hazard: "ELH", ceiling: "tile", gridMode: "ortho", polygon: rectRoom(12000, 7200),
    tileManual: { pu: 1200, pv: 600, ou: 0, ov: 0 },
  });
  const t = A.call("detectTiles", room);
  assert.ok(t && t.manual, "the hand-set grid was not used");
  assert.ok(heads.every(h => h.tile), "heads should sit on the hand-set grid");
});

test("snapping to tiles never costs coverage or breaks spacing", () => {
  for (const [pu, pv] of [[600, 1200], [1200, 600], [600, 600]]) {
    const A = loadCore();
    A.setVectors(plateWithGrid({ W: 20000, H: 14000, pu, pv, ou: 100, ov: 200, clutter: 300 }));
    const polygon = rectRoom(16000, 11000, mm, 500, 400);
    const { room, heads } = A.layout({ hazard: "OH1", ceiling: "tile", gridMode: "ortho", polygon });
    const a = A.analyse(room.id);
    const rule = A.call("ruleFor", room);
    assert.equal(a.gaps.length, 0, `${pu}x${pv}: ${a.gaps.length} gaps`);
    assert.ok(a.coverage > 0.999, `${pu}x${pv}: coverage ${(a.coverage * 100).toFixed(2)}%`);
    assert.ok(a.minSpacing >= rule.minSpacing - 1e-6,
      `${pu}x${pv}: heads ${a.minSpacing.toFixed(2)} m apart, minimum is ${rule.minSpacing}`);
    const hard = a.flags.filter(f => !/marked as checked/.test(f));
    assert.deepEqual(hard, [], `${pu}x${pv}: ${hard.join(" | ")}`);
  }
});

test("a tile ceiling with no grid drawn still lays out and says so", () => {
  const A = loadCore();
  A.setVectors([]);
  const { room, heads } = A.layout({ hazard: "OH1", ceiling: "tile", gridMode: "ortho",
                                     polygon: rectRoom(12000, 8000) });
  assert.equal(A.call("detectTiles", room), null, "nothing to detect");
  assert.ok(heads.length > 0, "the room is still laid out");
  assert.equal(A.analyse(room.id).gaps.length, 0);
});

test("the ceiling picks its usual head, but never overrides the designer's", () => {
  const A = loadCore();
  const r = { headType: "sp-drop", ceiling: "tile" };
  assert.equal(A.call("headForCeiling", r, "gib"), "sp-conc", "GIB takes a concealed head");
  assert.equal(A.call("headForCeiling", { headType: "sp-conc", ceiling: "gib" }, "tile"), "sp-drop");
  assert.equal(A.call("headForCeiling", { headType: "sp-ec", ceiling: "tile" }, "gib"), "sp-ec",
    "a head the designer chose stays when the ceiling changes");
  assert.equal(A.call("headForCeiling", { headType: "pend", ceiling: "tile" }, "gib"), "sp-conc",
    "a legacy id for the default still counts as the default");
});

test("a corridor too narrow to show the grid one way still lands every head on a tile", () => {
  const A = loadCore();
  A.setVectors(plateWithGrid({ clutter: 0 }));
  const cases = [
    { w: 20000, h: 3000, x: 2000, y: 2000, hazard: "OH1" },   // two or three 1200 lines across
    { w: 2400, h: 14000, x: 9000, y: 1000, hazard: "OH1" },   // four 600 lines across
    { w: 16000, h: 3600, x: 5200, y: 4300, hazard: "OH2" },
    { w: 13000, h: 3000, x: 1300, y: 9000, hazard: "ELH" },
  ];
  for (const c of cases) {
    const { room, heads } = A.layout({ id: "c" + c.x, hazard: c.hazard, polygon: rectRoom(c.w, c.h, mm, c.x, c.y), ceiling: "tile", gridMode: "ortho" });
    const t = A.call("detectTiles", room);
    assert.ok(t, `${c.w}x${c.h}: no grid found`);
    assert.deepEqual([t.u.sizeMm, t.v.sizeMm], [600, 1200]);
    assert.equal(heads.filter(h => h.tile).length, heads.length, `${c.w}x${c.h}: heads off the tile points`);
    const res = A.analyse(room.id);
    assert.ok(!res.flags.some(f => /uncovered|exceeds|over the|under/.test(f)), res.flags.join("; "));
  }
});

test("a narrow room does not borrow a neighbour's grid that its own lines disagree with", () => {
  const A = loadCore();
  const segs = [];
  const W = 40000, H = 26000;
  for (let x = 150; x <= W; x += 600) segs.push(P(x), P(0), P(x), P(H));
  // the plate is on one grid, the corridor strip y 8000..11000 on another, 600 out of step
  for (let y = 300; y <= H; y += 1200) {
    if (y > 8000 && y < 11000) continue;
    segs.push(P(0), P(y), P(W), P(y));
  }
  for (let y = 8000 + 900; y < 11000; y += 1200) segs.push(P(0), P(y), P(W), P(y));
  A.setVectors(segs);
  const room = { id: "n1", hazard: "OH1", polygon: rectRoom(14000, 3000, mm, 3000, 8000), ceiling: "tile", gridMode: "ortho" };
  const t = A.call("detectTiles", room);
  if (t) {
    const off = ((8900 / mm - t.v.origin) / t.v.P) % 1;
    assert.ok(Math.min(off, 1 - off) < 0.06, "took the neighbour's rows instead of its own");
  }
});

test("when the nearest tile point breaks a rule the next one is taken", () => {
  const A = loadCore();
  A.setVectors(plateWithGrid({ clutter: 0 }));
  // two heads; the nearest tile point for the second sits under the minimum spacing
  const { heads } = A.layout({ id: "s1", hazard: "OH2", polygon: rectRoom(4381, 3022, mm, 1008, 5179), ceiling: "tile", gridMode: "ortho" });
  assert.equal(heads.filter(h => h.tile).length, heads.length);
});

test("a scale a little off still puts heads on the tiles as drawn", () => {
  for (const err of [-0.015, 0.01]) {
    const A = loadCore({ scale: mm * (1 + err) });           // the designer's two clicks were not exact
    A.setVectors(plateWithGrid({ clutter: 0 }));
    const { room, heads } = A.layout({ id: "d", hazard: "OH1", polygon: rectRoom(14000, 9000, mm, 2000, 2000), ceiling: "tile", gridMode: "ortho", tileOcc: false });
    const t = A.call("detectTiles", room);
    assert.ok(Math.abs(t.u.measuredMm - 600 * (1 + err)) < 3, `measured ${t.u.measuredMm}`);
    for (const h of heads) {
      // where the head is on the drawing, in the drawing's own millimetres
      const x = h.x * mm, y = h.y * mm;
      const du = Math.abs(x - (150 + (Math.round((x - 450) / 600) + 0.5) * 600));
      const dv = Math.min(...[1 / 3, 1 / 2, 2 / 3].map(f => Math.abs(y - (300 + (Math.round((y - 300 - f * 1200) / 1200) + f) * 1200))));
      assert.ok(Math.hypot(du, dv) < 5, `scale ${err * 100}% off: head ${Math.hypot(du, dv).toFixed(0)} mm off the drawn tile point`);
    }
  }
});
