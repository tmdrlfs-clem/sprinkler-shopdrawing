
/* ══════════════════════════════════════════════════════════════
   1. State model
   Coordinates are always stored in rendered-PDF pixels. Conversion to
   millimetres happens only when something is displayed.
   ══════════════════════════════════════════════════════════════ */

const DEFAULT_RULES = {
  // Placeholders only. Fill these in from the NZS 4541 tables before relying on them.
  ELH: {label:"Extra Light Hazard", maxAreaPerHead:21, maxSpacing:4.6, minSpacing:2.0, maxWallDist:2.3, minWallDist:0.1, color:"#7fd4c1", verified:false},
  LH:  {label:"Light Hazard",       maxAreaPerHead:21, maxSpacing:4.6, minSpacing:2.0, maxWallDist:2.3, minWallDist:0.1, color:"#35b8a6", verified:false},
  OH1: {label:"Ordinary Hazard 1",  maxAreaPerHead:12, maxSpacing:4.0, minSpacing:2.0, maxWallDist:2.0, minWallDist:0.1, color:"#e0b24a", verified:false},
  OH2: {label:"Ordinary Hazard 2",  maxAreaPerHead:12, maxSpacing:4.0, minSpacing:2.0, maxWallDist:2.0, minWallDist:0.1, color:"#e0913a", verified:false},
  OH3: {label:"Ordinary Hazard 3",  maxAreaPerHead:12, maxSpacing:4.0, minSpacing:2.0, maxWallDist:2.0, minWallDist:0.1, color:"#dd7238", verified:false},
  OH4: {label:"Ordinary Hazard 4",  maxAreaPerHead:12, maxSpacing:4.0, minSpacing:2.0, maxWallDist:2.0, minWallDist:0.1, color:"#d45a38", verified:false},
  HH:  {label:"High Hazard",        maxAreaPerHead:9,  maxSpacing:3.7, minSpacing:2.0, maxWallDist:1.85,minWallDist:0.1, color:"#e4573d", verified:false}
};

/* Device library. Each entry is one legend row: a symbol, the wording that
   goes on the drawing, and which group it belongs to. Only the Sprinkler
   group counts towards coverage and spacing. Add fire alarm, gas or any
   other devices here or from the Legend tab. */
const DEFAULT_DEVICES = {
  "sp-drop": {group:"Sprinkler", label:"Dropped pendent, semi-recessed", k:80,
    desc:"DROPPED SPRINKLER HEAD THROUGH THE CEILING. VICTAULIC V2708 15MM SSP QR 68DEG C WHITE WITH TWO PIECE WHITE SEMI RECESSED ESCUTCHEON PLATES.",
    shape:"circle", dot:true, fill:false, letter:"", color:"#e4573d"},
  "sp-conc": {group:"Sprinkler", label:"Concealed flush plate", k:80,
    desc:"DROPPED SPRINKLER HEAD THROUGH THE CEILING, CONCEALED FLUSH PLATE TYPE. VICTAULIC V3402 15MM SSP QR 68DEG C WHITE PLATE.",
    shape:"circle", dot:true, fill:false, letter:"C", color:"#e4573d"},
  "sp-exposed": {group:"Sprinkler", label:"Direct on exposed pipework", k:80,
    desc:"SPRINKLER HEAD DIRECT ON PIPEWORK EXPOSED. VICTAULIC V2708 15MM SSP QR 68DEG C BRASS.",
    shape:"circle", dot:false, fill:false, letter:"", color:"#e4573d"},
  "sp-existing": {group:"Sprinkler", label:"Existing, in ceiling space", k:80,
    desc:"SPRINKLER HEAD DIRECT ON PIPE INSIDE THE CEILING SPACE. VICTAULIC V2707 15MM SSP SR 68DEG C BRASS. THESE ARE EXISTING.",
    shape:"circle", dot:false, fill:true, letter:"", color:"#e4573d"},
  "sp-upright": {group:"Sprinkler", label:"Upright", k:80,
    desc:"UPRIGHT SPRINKLER HEAD ON EXPOSED PIPEWORK.",
    shape:"circle", dot:true, fill:false, letter:"U", color:"#e4573d"},
  "sp-sidewall": {group:"Sprinkler", label:"Sidewall", k:80,
    desc:"SIDEWALL SPRINKLER HEAD.",
    shape:"square", dot:true, fill:false, letter:"", color:"#e4573d"},
  "sp-ec": {group:"Sprinkler", label:"Extended coverage", k:115,
    desc:"EXTENDED COVERAGE SPRINKLER HEAD.",
    shape:"circle", dot:true, fill:false, letter:"EC", color:"#e4573d"},

  "fa-smoke": {group:"Fire alarm", label:"Smoke detector",
    desc:"PHOTOELECTRIC SMOKE DETECTOR, CEILING MOUNTED.",
    shape:"circle", dot:false, fill:false, letter:"S", color:"#2f6fd0"},
  "fa-heat": {group:"Fire alarm", label:"Heat detector",
    desc:"HEAT DETECTOR, CEILING MOUNTED.",
    shape:"circle", dot:false, fill:false, letter:"H", color:"#2f6fd0"},
  "fa-sounder": {group:"Fire alarm", label:"Sounder",
    desc:"ALARM SOUNDER.",
    shape:"diamond", dot:false, fill:false, letter:"", color:"#2f6fd0"},
  "fa-mcp": {group:"Fire alarm", label:"Manual call point",
    desc:"MANUAL CALL POINT, 1200MM AFFL.",
    shape:"square", dot:false, fill:true, letter:"", color:"#2f6fd0"},

  "sv-flow": {group:"Valves and switches", label:"Flow switch",
    desc:"FLOW SWITCH.",
    shape:"square", dot:false, fill:false, letter:"FS", color:"#7a5cc0"},
  "sv-iso": {group:"Valves and switches", label:"Isolating valve, monitored",
    desc:"MONITORED ISOLATING VALVE.",
    shape:"triangle", dot:false, fill:false, letter:"", color:"#7a5cc0"}
};

const LEGACY_TYPE = {pend:"sp-drop", conc:"sp-conc", up:"sp-upright", side:"sp-sidewall", ec:"sp-ec"};
function devices(){ return state.doc.devices || (state.doc.devices = structuredClone(DEFAULT_DEVICES)); }
function devOf(id){ const D=devices(); return D[LEGACY_TYPE[id]||id] || D["sp-drop"] || Object.values(D)[0]; }
function devId(id){ const D=devices(); const k=LEGACY_TYPE[id]||id; return D[k]? k : "sp-drop"; }
function isSprinkler(h){ const d=devOf(h.type); return !d || d.group==="Sprinkler"; }

const state = {
  pdf:null, pdfBytes:null, fileName:"",
  pageNum:1, pageCount:0,
  pdfCanvas:null,            // offscreen render of the current page
  renderScale:1,             // PDF points to rendered pixels
  rendering:false,
  view:{zoom:1, tx:0, ty:0},
  mode:"pan",
  doc:{ name:"", rules:structuredClone(DEFAULT_RULES), devices:structuredClone(DEFAULT_DEVICES), pages:{} },
  selRoom:null, selHead:null,
  draft:null,                // polygon being drawn
  mdraft:null,               // measurement being drawn
  selMeasure:null,
  chain:false,               // chained multi-segment measuring
  dims:"all",                // head dimension chains: off | selected | all
  lastHazard:"OH1",
  lastCeiling:"tile",
  dirty:false,
  review:false,
  showCov:false,
  snap:true,
  snapHit:null,
  pageSizePt:null,           // current page size in PDF points
  detected:[],               // scale ratios found in the drawing text
  calib:null,                // two-point scale in progress
  drag:null,
  cursor:null,
  tab:"rooms"
};

/* Undo. Snapshot the page data before anything that changes it. */
const UNDO=[];
function snapshot(){
  try{
    UNDO.push({pages: structuredClone(state.doc.pages), sel: state.selRoom, selM: state.selMeasure});
    if(UNDO.length>40) UNDO.shift();
  }catch(e){ /* if a page cannot be cloned, undo just skips this step */ }
}
function undoDoc(){
  if(!UNDO.length){ toast("Nothing to undo."); return; }
  const u=UNDO.pop();
  state.doc.pages = u.pages;
  state.selRoom = u.sel; state.selMeasure = u.selM; state.selHead=null;
  RECT_CACHE.clear(); SAMPLE_CACHE.clear(); ANGLE_CACHE.clear(); TILE_CACHE.clear(); MASK.key=null;
  save(); syncPanels(); draw();
  toast("Undone.");
}

function page(){
  const k = String(state.pageNum);
  if(!state.doc.pages[k]) state.doc.pages[k] = {scale:null, scaleSource:null, origin:null, rooms:[], heads:[], measures:[]};
  const pg = state.doc.pages[k];
  if(!pg.measures) pg.measures = [];          // older saved files
  if(!pg.rooms) pg.rooms = [];
  if(!pg.heads) pg.heads = [];
  return pg;
}
const mmPerPx = () => page().scale;          // null when no scale is set
const uid = p => p + Math.random().toString(36).slice(2,8);