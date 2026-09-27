
/* ══════════════════════════════════════════════════════════════
   1b. Reading the scale printed on the drawing
   PDF coordinates are in 1/72 inch. If the sheet is stored at its true size
   (A1 and so on), one millimetre on paper is (ratio) millimetres in the
   building, so the printed ratio alone is enough to convert.
   ══════════════════════════════════════════════════════════════ */

const PT2MM = 25.4/72;
const SCALE_CANDIDATES = new Set([1,2,5,10,20,25,50,100,200,250,500,1000,1250,2000,2500,5000]);
const SHEETS = [
  ["A0",841,1189],["A1",594,841],["A2",420,594],["A3",297,420],["A4",210,297],
  ["B1",707,1000],["B2",500,707],
  ["ARCH C",457,610],["ARCH D",610,914],["ARCH E",762,1067],["ARCH E1",762,1067],
  ["ANSI C",432,559],["ANSI D",559,864],["ANSI E",864,1118]
];
const SHEET_MM = {A0:1189, A1:841, A2:594, A3:420, A4:297, B1:1000, B2:707,
  "ARCH C":610, "ARCH D":914, "ARCH E":1067, "ARCH E1":1067,
  "ANSI C":559, "ANSI D":864, "ANSI E":1118};
function sheetLongEdge(name){ return SHEET_MM[name] || null; }
function currentSheet(){
  const sz=state.pageSizePt; if(!sz) return null;
  return sheetName(sz.w*PT2MM, sz.h*PT2MM);
}
/* A drawing set out 1:50 on A1 and reissued at A3 is really 1:100 — the
   paper halved but the building did not. Convert a stated ratio from the
   sheet it was written for to the sheet actually in front of us. */
function ratioForThisSheet(ratio, statedSheet){
  const here = currentSheet();
  if(!statedSheet || !here || statedSheet===here) return ratio;
  // Within the A series each step is exactly root 2, so A1 to A3 is exactly
  // double. Using the rounded paper sizes would leave 1:20 as 1:40.05.
  const an = /^A([0-4])$/.exec(statedSheet), bn = /^A([0-4])$/.exec(here);
  if(an && bn) return ratio * Math.pow(2, (+bn[1] - +an[1])/2);
  const a=sheetLongEdge(statedSheet), b=sheetLongEdge(here);
  if(!a || !b) return ratio;
  return ratio * a / b;
}
/* Two title-block entries that mean the same thing here — "1:50" and
   "1:50 @ A1" on an A1 sheet — are one choice, not two. Group by the ratio
   they resolve to, keeping whichever spelling names a sheet. */
function resolvedScales(){
  // "1:50 @ A1" is a statement about the drawing; a bare "1:50" elsewhere on
  // the same sheet is the same statement with the sheet left off. Fold the
  // bare ones into the qualified entry rather than offering both.
  const qualified = new Map();
  for(const d of state.detected) if(d.sheet) qualified.set(d.ratio, d.sheet);
  const map=new Map();
  for(const d of state.detected){
    const sheet = d.sheet || qualified.get(d.ratio) || null;
    const eff = niceRatio(ratioForThisSheet(d.ratio, sheet));
    const e = map.get(eff) || {eff, count:0, ratio:d.ratio, sheet};
    e.count += d.count;
    if(sheet && !e.sheet){ e.sheet=sheet; e.ratio=d.ratio; }
    map.set(eff, e);
  }
  return [...map.values()].sort((a,b)=> b.count-a.count || a.eff-b.eff);
}

function niceRatio(r){
  const round=[1,2,5,10,20,25,40,50,75,100,125,150,200,250,300,400,500,750,1000,1250,2000,2500,5000];
  for(const v of round) if(Math.abs(r-v) < Math.max(0.5, v*0.02)) return v;
  return Math.round(r*100)/100;
}

function sheetName(wmm,hmm){
  for(const [n,a,b] of SHEETS){
    if((Math.abs(wmm-a)<4 && Math.abs(hmm-b)<4) || (Math.abs(wmm-b)<4 && Math.abs(hmm-a)<4)) return n;
  }
  return null;
}
async function detectScales(pg){
  try{
    const tc = await pg.getTextContent();
    const flat = tc.items.map(i=>i.str).join(" ").replace(/\s+/g," ");
    const found = new Map();
    // "1:50", "1 : 50 @ A1", "SCALE 1/100 AT A3", "1:200 (A1)"
    const re = /(^|[^\d.])1\s*[:\/]\s*(\d{1,5})(?![\d.])\s*[(\[]?\s*(?:@|AT|ON)?\s*(A[0-4]|ARCH\s?E1|ARCH\s?[CDE]|ANSI\s?[CDE])?/gi;
    let m;
    while((m = re.exec(flat))){
      const v = parseInt(m[2],10);
      if(!SCALE_CANDIDATES.has(v) || v<=1) continue;
      const sheet = m[3] ? m[3].toUpperCase().replace(/\s+/g," ").trim() : null;
      const key = v+"|"+(sheet||"");
      const prev = found.get(key) || {ratio:v, sheet, count:0};
      prev.count++;
      found.set(key, prev);
    }
    return [...found.values()].sort((a,b)=> b.count-a.count || a.ratio-b.ratio);
  }catch(e){ return []; }
}
function ratioToScale(ratio){          // how many real millimetres one rendered pixel covers
  return PT2MM * ratio / state.renderScale;
}
function scaleToRatio(mmPerPixel){
  return mmPerPixel * state.renderScale / PT2MM;
}
function applyRatio(ratio, allPages){
  const set = pg => { pg.scale = ratioToScale(ratio); pg.scaleSource = "1:"+ratio; };
  if(allPages){ for(const k of Object.keys(state.doc.pages)) set(state.doc.pages[k]); }
  set(page());
  page().rooms.forEach(r=>{ if(r.autoLayout!==false) regenerateHeads(r); });
  save(); syncPanels(); draw();
}