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
