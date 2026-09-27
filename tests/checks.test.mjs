import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, rectRoom } from "./harness.mjs";

const mm = 12.37;
const P = v => v / mm;

test("a room with no heads reports the whole floor as uncovered", () => {
  const A = loadCore();
  const { room } = A.layout({ hazard: "OH1", polygon: rectRoom(10000, 6000),
                              ceiling: "gib", autoLayout: false });
  const a = A.analyse(room.id);
  assert.equal(a.coverage, 0);
  assert.equal(a.gaps.length, 1);
  assert.ok(Math.abs(a.gapArea - 60) < 1, `${a.gapArea.toFixed(1)} m² reported uncovered`);
  assert.ok(a.flags.some(f => /No heads placed/.test(f)));
});

test("deleting a head in a leg is reported as one gap in the right place", () => {
  const A = loadCore();
  const polygon = [[0, 0], [11000, 0], [11000, 8000], [9200, 8000], [9200, 3000],
                   [1800, 3000], [1800, 8000], [0, 8000]].map(([x, y]) => ({ x: P(x), y: P(y) }));
  const { room, heads } = A.layout({ hazard: "ELH", polygon, ceiling: "gib" });
  assert.equal(A.analyse(room.id).gaps.length, 0, "the full layout should be clean");

  const leg = heads.filter(h => h.x * mm < 1800 && h.y * mm > 3000);
  assert.ok(leg.length, "there should be a head in the left leg");
  A.ctx.__drop = leg.map(h => h.id);
  A.run(`page().heads = page().heads.filter(h => !__drop.includes(h.id))`);

  const a = A.analyse(room.id);
  assert.equal(a.gaps.length, 1, "one hole where the head was");
  assert.ok(a.gaps[0].area > 3, `the gap is only ${a.gaps[0].area.toFixed(2)} m²`);
  assert.ok(a.gaps[0].x * mm < 1800, "the gap is reported in the leg, not elsewhere");
  assert.ok(a.flags.some(f => /over the .* limit/.test(f)), "the wall distance should fail too");
});

test("a head jammed against a wall is flagged as uninstallable", () => {
  const A = loadCore();
  const { room } = A.layout({ hazard: "OH1", polygon: rectRoom(10000, 6000), ceiling: "gib" });
  A.ctx.__id = room.id;
  A.run(`page().heads.push({id:"h_tight", roomId:__id, x:${P(20)}, y:${P(3000)},
         type:"sp-drop", auto:false, locked:true})`);
  const a = A.analyse(room.id);
  assert.ok(a.tightHeads.includes("h_tight"));
  assert.ok(a.flags.some(f => /closer than/.test(f)));
});

test("non-sprinkler devices are counted but left out of the checks", () => {
  const A = loadCore();
  const { room, heads } = A.layout({ hazard: "OH1", polygon: rectRoom(10000, 6000), ceiling: "gib" });
  const before = A.analyse(room.id);
  A.ctx.__id = room.id;
  A.run(`page().heads.push({id:"d_smoke", roomId:__id, x:${P(5000)}, y:${P(3000)},
         type:"fa-smoke", auto:false, locked:true})`);
  const after = A.analyse(room.id);
  assert.equal(after.heads, before.heads, "a smoke detector is not a sprinkler");
  assert.equal(after.coverage, before.coverage);
});

test("head dimensions run to the next head in line, and to the wall only past it", () => {
  const A = loadCore();
  const W = 10000, H = 6000;
  const { room } = A.layout({ hazard: "OH1", polygon: rectRoom(W, H), ceiling: "gib",
                              autoLayout: false, gridMode: "ortho" });
  A.ctx.__id = room.id;
  // a clean 3 x 2 grid: spacing 3333 x 3000, wall offsets 1667 / 1500
  A.run(`
    page().heads = [];
    for(let j=0;j<2;j++) for(let i=0;i<3;i++)
      page().heads.push({id:"h"+i+j, roomId:__id, x:${P(W)}*(i+0.5)/3, y:${P(H)}*(j+0.5)/2,
                         type:"sp-drop", auto:true, src:"grid"});
  `);
  const dims = id => {
    A.ctx.__h = id;
    return A.run(`(() => {
      const r = page().rooms.find(x => x.id === __id);
      const h = page().heads.find(x => x.id === __h);
      return headWallDims(h, r).map(d => ({mm: Math.round(d.t * page().scale), head: d.isHead}));
    })()`);
  };
  const of = (id) => dims(id).map(d => `${d.mm}${d.head ? "H" : "W"}`).sort();

  assert.deepEqual(of("h00"), ["1500W", "1667W", "3000H", "3333H"].sort(),
    "corner head: wall one way on each axis, head the other");
  assert.deepEqual(of("h10"), ["1500W", "3000H", "3333H", "3333H"].sort(),
    "middle of the top row: heads left and right, wall above");
  assert.deepEqual(of("h20"), ["1500W", "1667W", "3000H", "3333H"].sort());
});

test("moving a head updates its dimensions both ways", () => {
  const A = loadCore();
  const W = 10000, H = 6000;
  const { room } = A.layout({ hazard: "OH1", polygon: rectRoom(W, H), ceiling: "gib",
                              autoLayout: false, gridMode: "ortho" });
  A.ctx.__id = room.id;
  A.run(`
    page().heads = [];
    for(let i=0;i<3;i++)
      page().heads.push({id:"h"+i, roomId:__id, x:${P(W)}*(i+0.5)/3, y:${P(H)}/2,
                         type:"sp-drop", auto:true, src:"grid"});
    page().heads.find(h => h.id === "h1").x += ${P(800)};
  `);
  const read = id => {
    A.ctx.__h = id;
    return A.run(`(() => {
      const r = page().rooms.find(x => x.id === __id);
      const h = page().heads.find(x => x.id === __h);
      return headWallDims(h, r).filter(d => d.isHead).map(d => Math.round(d.t * page().scale)).sort((a,b)=>a-b);
    })()`);
  };
  assert.deepEqual(read("h0"), [4133], "the gap to the moved head opened up");
  assert.deepEqual(read("h1"), [2533, 4133], "and closed on the other side");
});

test("the checks warn while a hazard class is still unverified", () => {
  const A = loadCore();
  const { room } = A.layout({ hazard: "OH1", polygon: rectRoom(10000, 6000), ceiling: "gib" });
  assert.ok(A.analyse(room.id).flags.some(f => /not been marked as checked/.test(f)),
    "placeholder rule figures must not pass silently");
  A.run(`state.doc.rules.OH1.verified = true`);
  assert.ok(!A.analyse(room.id).flags.some(f => /not been marked as checked/.test(f)));
});
