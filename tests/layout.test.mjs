import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, rectRoom } from "./harness.mjs";

const mm = 12.37;
const P = v => v / mm;
const poly = pts => pts.map(([x, y]) => ({ x: P(x), y: P(y) }));

/* Shapes that have each broken the layout at some point. */
const SHAPES = {
  rectangle: rectRoom(10000, 6000),
  L: poly([[0, 0], [12000, 0], [12000, 4000], [6000, 4000], [6000, 9000], [0, 9000]]),
  U: poly([[0, 0], [11000, 0], [11000, 8000], [9200, 8000], [9200, 3000],
           [1800, 3000], [1800, 7200], [900, 8000], [0, 8000]]),
  T: poly([[0, 0], [14000, 0], [14000, 3000], [7700, 3000], [7700, 12000],
           [6300, 12000], [6300, 3000], [0, 3000]]),
  comb: poly([[0, 0], [12000, 0], [12000, 3000], [10200, 3000], [10200, 10000], [9000, 10000],
              [9000, 3000], [6600, 3000], [6600, 10000], [5400, 10000], [5400, 3000],
              [3000, 3000], [3000, 10000], [1800, 10000], [1800, 3000], [0, 3000]]),
  wedge: poly([[0, 0], [14000, 0], [14000, 2000], [0, 9000]]),
  corridor: rectRoom(20000, 1600),
  notchedOffice: poly([[0, 0], [24000, 0], [24000, 6000], [26000, 6000], [26000, 14000],
                       [24000, 14000], [24000, 20000], [15000, 20000], [15000, 17000],
                       [9000, 17000], [9000, 20000], [0, 20000], [0, 12000],
                       [-2000, 12000], [-2000, 8000], [0, 8000]]),
};

/* Every rule the layout claims to respect, checked against the result. */
function audit(A, room, heads) {
  const rule = A.call("ruleFor", room);
  const ang = A.run(`roomFrame(${JSON.stringify(room)}).ang`);
  const areaM2 = A.call("polyArea", room.polygon) * mm * mm / 1e6;
  const half = rule.maxSpacing * 1000 / mm / 2;
  const model = A.run("covModel()");

  A.ctx.__r = JSON.parse(JSON.stringify(room));
  const S = A.run("roomSamples(__r, page().scale)");
  A.ctx.__h = JSON.parse(JSON.stringify(heads));
  const unc = A.run(`uncoveredSamples(roomSamples(__r, page().scale), __h, ${ang}, ${half}, ${JSON.stringify(model)})`);

  let minNN = Infinity, worstWall = 0;
  for (const a of heads) for (const b of heads)
    if (a !== b) minNN = Math.min(minNN, Math.hypot(a.x - b.x, a.y - b.y) * mm / 1000);

  const pgn = room.polygon;
  for (let i = 0; i < pgn.length; i++) {
    const a = pgn[i], b = pgn[(i + 1) % pgn.length];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (300 / mm)));
    for (let t = 0; t <= n; t++) {
      const q = { x: a.x + (b.x - a.x) * t / n, y: a.y + (b.y - a.y) * t / n };
      let best = Infinity;
      for (const h of heads) {
        const dx = q.x - h.x, dy = q.y - h.y;
        const d = model === "circle" ? Math.hypot(dx, dy) / Math.SQRT2
          : Math.max(Math.abs(dx * Math.cos(ang) + dy * Math.sin(ang)),
                     Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang)));
        best = Math.min(best, d);
      }
      worstWall = Math.max(worstWall, best * mm / 1000);
    }
  }

  let minWall = Infinity;
  for (const h of heads) minWall = Math.min(minWall, A.call("distToPoly", h, pgn) * mm / 1000);

  return {
    coverage: S.pts.length ? 1 - unc.length / S.pts.length : 1,
    perHead: areaM2 / heads.length,
    minSpacing: minNN, worstWall, minWall, rule, areaM2,
  };
}

for (const [name, polygon] of Object.entries(SHAPES)) {
  for (const hazard of ["ELH", "OH1"]) {
    test(`${name} · ${hazard} · covers the room without breaking a rule`, () => {
      const A = loadCore();
      const { room, heads } = A.layout({ hazard, polygon, ceiling: "gib" });
      assert.ok(heads.length > 0, "some heads were placed");

      const r = audit(A, room, heads);
      assert.equal(r.coverage, 1, `coverage ${(r.coverage * 100).toFixed(1)}%`);
      assert.ok(r.perHead <= r.rule.maxAreaPerHead + 1e-6,
        `${r.perHead.toFixed(2)} m² per head over the ${r.rule.maxAreaPerHead} limit`);
      assert.ok(r.minSpacing >= r.rule.minSpacing - 1e-6 || heads.length === 1,
        `heads ${r.minSpacing.toFixed(2)} m apart, under the ${r.rule.minSpacing} minimum`);
      assert.ok(r.worstWall <= r.rule.maxWallDist + 1e-6,
        `a wall point is ${r.worstWall.toFixed(2)} m from cover, over ${r.rule.maxWallDist}`);
      assert.ok(r.minWall >= (r.rule.minWallDist ?? 0.1) - 1e-6,
        `a head sits ${r.minWall.toFixed(3)} m off a wall, under the minimum`);
    });
  }
}

test("a narrow band needs one row of heads, not two", () => {
  for (const depth of [2000, 2600, 3400]) {
    const A = loadCore();
    const { room, heads } = A.layout({ hazard: "ELH", polygon: rectRoom(9000, depth), ceiling: "gib" });
    const rows = new Set(heads.map(h => Math.round(h.y * mm / 100)));
    assert.equal(rows.size, 1, `${depth} mm deep gave ${rows.size} rows of heads`);
    assert.equal(audit(A, room, heads).coverage, 1);
  }
});

test("the layout keeps a head the user placed and locked", () => {
  const A = loadCore();
  const { room } = A.layout({ hazard: "OH1", polygon: rectRoom(12000, 8000), ceiling: "gib" });
  A.ctx.__id = room.id;
  A.run(`page().heads.push({id:"h_pinned", roomId:__id, x:${P(1500)}, y:${P(1500)},
         type:"sp-drop", auto:false, locked:true});
         regenerateHeads(page().rooms.find(r => r.id === __id));`);
  const heads = A.run(`page().heads.filter(h => h.roomId === __id)`);
  assert.ok(heads.some(h => h.id === "h_pinned"), "the pinned head survived a re-lay");
});

test("a room with no scale places nothing rather than guessing", () => {
  const A = loadCore();
  A.mm = null;
  const { heads } = A.layout({ hazard: "OH1", polygon: rectRoom(10000, 6000), ceiling: "gib" });
  assert.equal(heads.length, 0);
});

test("a rotated room is laid out along its own walls when asked", () => {
  const A = loadCore();
  const a = Math.PI / 6;
  const rot = p => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
  const polygon = SHAPES.L.map(rot);
  const { room, heads } = A.layout({ hazard: "ELH", polygon, ceiling: "gib", gridMode: "auto" });
  const ang = A.run(`roomAngle(${JSON.stringify(room)})`);
  assert.ok(Math.abs(ang - a) < 0.02, `grid at ${(ang * 180 / Math.PI).toFixed(1)}°, expected 30°`);
  assert.equal(audit(A, room, heads).coverage, 1);
});
