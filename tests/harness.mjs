/* Load the app's real core modules into a sandbox and hand back their
   functions. The app is one browser script sharing a single scope, so the
   tests do the same rather than pretending it is a module graph: no copies
   of the algorithms live here, and a test can only pass if the shipped code
   passes. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Core files in load order. The UI files are left out: they reach for the
   DOM on the way in, and everything worth testing lives here. */
const CORE = [
  "src/core/10-state.js",
  "src/core/20-scale.js",
  "src/core/30-vectors.js",
  "src/core/40-geometry.js",
  "src/core/50-layout.js",
  "src/core/60-fill.js",
  "src/core/70-checks.js",
];

/* The core touches a handful of browser and app-shell names. Standing in for
   them keeps the sandbox honest: anything a test actually exercises has to be
   real code, and the stubs only cover what the browser would have provided. */
function shell() {
  const noop = () => {};
  const canvasStub = () => ({
    width: 0, height: 0,
    getContext: () => new Proxy({}, {
      get: (_, k) => k === "measureText" ? () => ({ width: 10 })
        : k === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
        : k === "getImageData" ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
        : noop,
      set: () => true,
    }),
  });
  return {
    console,
    performance,
    structuredClone,
    setTimeout, clearTimeout, requestAnimationFrame: noop, cancelAnimationFrame: noop,
    document: { createElement: canvasStub, getElementById: () => null },
    window: { devicePixelRatio: 1 },
    pdfjsLib: { GlobalWorkerOptions: {}, OPS: {} },
    // app-shell functions the core calls back into
    toast: noop, draw: noop, save: noop, syncPanels: noop, fillBar: noop,
    buildMask: noop, updateVecCell: noop, setTab: noop, setMode: noop,
    toScreen: p => ({ x: p.x, y: p.y }),
    stage: { clientWidth: 1200, clientHeight: 800 },
  };
}

export function loadCore({ scale = 12.37, coverage = "rect" } = {}) {
  const ctx = vm.createContext(shell());
  for (const f of CORE) {
    vm.runInContext(readFileSync(join(root, f), "utf8"), ctx, { filename: f });
  }

  /* Values crossing out of the sandbox belong to another realm, so an array
     from in there is not an Array out here and strict deep-equal rejects it.
     Copy plain data across the boundary; anything exotic comes back as is. */
  const plain = v => {
    if (v === null || typeof v !== "object") return v;
    try { return structuredClone(v); } catch { return v; }
  };

  /* One page, one document — the same shape the app keeps in memory. */
  const run = code => plain(vm.runInContext(code, ctx));
  run(`
    state.pdfCanvas = {width: 4000, height: 3000};
    state.renderScale = 1;
    state.view = {zoom: 1, tx: 0, ty: 0};
    state.doc = {name:"test", rules: structuredClone(DEFAULT_RULES),
                 devices: structuredClone(DEFAULT_DEVICES),
                 coverage: ${JSON.stringify(coverage)}, pages: {}};
    state.pageNum = 1;
    page().scale = ${scale};
  `);

  const api = {
    ctx, run,
    get mm() { return run("page().scale"); },
    set mm(v) { run(`page().scale = ${v}`); },
    set coverage(v) { run(`state.doc.coverage = ${JSON.stringify(v)}`); },

    /* Feed the sandbox a set of PDF line segments, as the vector reader
       would after parsing a page. Coordinates are render pixels. */
    setVectors(flat) {
      ctx.__flat = Array.from(flat);
      run(`buildVecIndex(__flat); TILE_CACHE.clear();`);
    },
    clearCaches() {
      run(`RECT_CACHE.clear(); ANGLE_CACHE.clear(); SAMPLE_CACHE.clear(); TILE_CACHE.clear();`);
    },

    /* Put a room on the page and lay heads in it, the way the app does. */
    layout(room) {
      ctx.__room = JSON.parse(JSON.stringify(room));
      return run(`
        (() => {
          const r = Object.assign({id:"r_"+Math.random().toString(36).slice(2,8),
            name:"Room", hazard:"OH1", headType:"sp-drop", ceilingH:2.7,
            ceilingType:"flat", autoLayout:true, gridAngle:0, gridDx:0, gridDy:0,
            notes:"", ceiling:"tile"}, __room);
          const p = page();
          p.rooms = p.rooms.filter(x => x.id !== r.id);
          p.rooms.push(r);
          regenerateHeads(r);
          return {room: r, heads: p.heads.filter(h => h.roomId === r.id)};
        })()
      `);
    },
    analyse(roomId) {
      ctx.__id = roomId;
      return run(`analyse(page().rooms.find(r => r.id === __id))`);
    },
    call(fn, ...args) {
      ctx.__args = args.map(a => (a && typeof a === "object") ? JSON.parse(JSON.stringify(a)) : a);
      return run(`${fn}(...__args)`);
    },
  };
  return api;
}

/* Millimetres to render pixels, for writing test geometry in real units. */
export const mmToPx = (v, mm = 12.37) => v / mm;
export const rectRoom = (w, h, mm = 12.37, x = 0, y = 0) =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => ({ x: a / mm, y: b / mm }));
