import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./harness.mjs";

const A = loadCore();
const PT2MM = 25.4 / 72;

/* Put a sheet of a given size in front of the app, then hand it the scale
   ratios a title block would have yielded. */
function sheet(wmm, hmm, text) {
  A.run(`state.pageSizePt = {w: ${wmm / PT2MM}, h: ${hmm / PT2MM}};
         state.renderScale = 1;`);
  A.ctx.__text = text;
  A.run(`state.detected = (() => {
    const found = new Map();
    const re = /(^|[^\\d.])1\\s*[:\\/]\\s*(\\d{1,5})(?![\\d.])\\s*[(\\[]?\\s*(?:@|AT|ON)?\\s*(A[0-4]|ARCH\\s?E1|ARCH\\s?[CDE]|ANSI\\s?[CDE])?/gi;
    let m;
    while ((m = re.exec(__text))) {
      const v = parseInt(m[2], 10);
      if (!SCALE_CANDIDATES.has(v) || v <= 1) continue;
      const sh = m[3] ? m[3].toUpperCase().replace(/\\s+/g, " ").trim() : null;
      const key = v + "|" + (sh || "");
      const prev = found.get(key) || {ratio: v, sheet: sh, count: 0};
      prev.count++; found.set(key, prev);
    }
    return [...found.values()].sort((a, b) => b.count - a.count || a.ratio - b.ratio);
  })()`);
  return { name: A.run("currentSheet()"), resolved: A.run("resolvedScales()") };
}

test("standard sheet sizes are recognised in either orientation", () => {
  assert.equal(A.call("sheetName", 841, 594), "A1");
  assert.equal(A.call("sheetName", 594, 841), "A1");
  assert.equal(A.call("sheetName", 420, 297), "A3");
  assert.equal(A.call("sheetName", 1189, 841), "A0");
  assert.equal(A.call("sheetName", 700, 500), null);
});

test("a plain ratio on its own sheet applies as written", () => {
  const { resolved } = sheet(841, 594, "113_A310 REFLECTED CEILING PLAN 1 : 50");
  assert.equal(resolved.length, 1, "one choice, so it auto-applies");
  assert.equal(resolved[0].eff, 50);
});

test("repeated spellings of one scale are a single choice", () => {
  const { resolved } = sheet(841, 594, "SCALE 1:50 @ A1   GROUND FLOOR PLAN 1 : 50");
  assert.equal(resolved.length, 1, "qualified and bare mentions fold together");
  assert.equal(resolved[0].eff, 50);
  assert.ok(resolved[0].count >= 2);
});

test("an A1 drawing reissued at A3 is read at half the printed scale", () => {
  const { name, resolved } = sheet(420, 297, "SCALE 1:50 @ A1   REFLECTED CEILING PLAN 1 : 50");
  assert.equal(name, "A3");
  assert.equal(resolved.length, 1, "the bare ratio folds into the sheet-qualified one");
  assert.equal(resolved[0].eff, 100);
  assert.equal(resolved[0].sheet, "A1");
});

test("A-series conversion is exact, not rounded paper sizes", () => {
  A.run(`state.pageSizePt = {w: ${420 / PT2MM}, h: ${297 / PT2MM}}`);
  assert.equal(A.call("niceRatio", A.call("ratioForThisSheet", 20, "A1")), 40);   // not 40.05
  assert.equal(A.call("niceRatio", A.call("ratioForThisSheet", 50, "A1")), 100);
  assert.equal(A.call("niceRatio", A.call("ratioForThisSheet", 100, "A3")), 100);
});

test("a detail view at another scale stays a separate choice", () => {
  const { resolved } = sheet(841, 594, "PLAN 1 : 50   DETAIL A 1 : 20");
  assert.equal(resolved.length, 2, "two real scales, so the user is asked");
  assert.deepEqual(resolved.map(r => r.eff).sort((a, b) => a - b), [20, 50]);
});

test("revisions and dates are not mistaken for scales", () => {
  const { resolved } = sheet(841, 594, "REV 1.1 DATE 12/05/2026 DRAWN BY MJC RATIO 11:500");
  assert.equal(resolved.length, 0);
});

test("a ratio maps to millimetres per rendered pixel and back", () => {
  A.run("state.renderScale = 1.4262");
  const mm = A.call("ratioToScale", 100);
  assert.ok(Math.abs(A.call("scaleToRatio", mm) - 100) < 1e-9);
});
