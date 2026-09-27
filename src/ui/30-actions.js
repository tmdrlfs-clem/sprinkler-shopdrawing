
/* ══════════════════════════════════════════════════════════════
   7. Actions
   ══════════════════════════════════════════════════════════════ */

function setMode(m){
  state.mode=m;
  if(m!=="room") state.draft=null;
  if(m!=="calibrate") state.calib=null;
  document.querySelectorAll(".tool").forEach(b=>b.classList.toggle("on", b.dataset.mode===m));
  if(m!=="measure"){ state.mdraft=null; }
  if(m!=="fill" && FILL.on) fillCancel(false);
  view.classList.toggle("drawing", m==="room"||m==="calibrate"||m==="origin"||m==="head"||m==="measure"||m==="fill"||m==="tile");
  updateLenCell();
  const hints={
    pan:"Click a head to see its coverage and wall offsets, drag it to move. C shows every head's coverage at once",
    calibrate:"Click both ends of a dimension you know the real length of",
    measure:"Click two points for a length. Shift locks to horizontal or vertical, Alt+click deletes",
    fill:"Hold to spread · Shift+drag paints over gaps · Ctrl+drag erases · Ctrl+Z undoes · Enter applies",
    room:"Click to add corners, click the first point or press Enter to close, Esc to cancel",
    vertex:"Drag the corners of the selected room",
    head:"Click inside a room to add a head, drag to move it, Alt+click to delete",
    origin:"Click the point your CAD coordinates are measured from",
    tile:"Click a corner of the ceiling grid in the selected room to set it by hand"
  };
  document.getElementById("stHint").textContent=hints[m];
  draw();
}
document.getElementById("tools").addEventListener("click", e=>{
  const b=e.target.closest(".tool"); if(b) setMode(b.dataset.mode);
});

function finishRoom(){
  if(!state.draft || state.draft.length<3){ state.draft=null; draw(); return; }
  const poly = state.draft;
  askCeiling(kind=>createRoom(poly, kind), ()=>{ state.draft=null; draw(); });
}
function createRoom(poly, kind){
  state.draft = poly;
  snapshot();
  const n = page().rooms.length+1;
  const room={
    id:uid("r_"), name:"Room "+String(n).padStart(2,"0"), polygon:state.draft,
    hazard:"OH1", headType:"sp-drop", ceilingH:2.7, ceilingType:"flat",
    autoLayout:true, gridAngle:0, gridDx:0, gridDy:0, notes:"",
    ceiling:kind, tileSnap:kind==="tile"
  };
  page().rooms.push(room);
  state.draft=null; state.selRoom=room.id;
  setMode("pan"); setTab("props");
  setCeiling(room, kind);
}
function setCeiling(room, kind){
  room.ceiling = kind;
  room.tileSnap = kind==="tile";
  TILE_CACHE.delete(room.id);
  regenerateHeads(room);
  state.lastCeiling = kind;
  syncPanels(); draw();
  if(kind==="tile" && !detectTiles(room)){
    // nothing drawn to snap to: go straight to picking a corner
    state.selRoom = room.id;
    room.tileManual = room.tileManual || {pu:600, pv:1200, ou:0, ov:0};
    setMode("tile");
    toast("Tile ceiling, but no grid is drawn in this room. Click one tile corner and the heads will line up to it.");
  }
}

/* After a room outline is made, ask what the ceiling is before laying
   heads, because that decides whether they follow a tile grid. */
function askCeiling(onPick, onCancel){
  const bar=document.getElementById("ceilbar");
  const last=state.lastCeiling||"tile";
  bar.style.display="flex";
  document.getElementById("cbTile").className = "btn "+(last==="tile"?"primary":"");
  document.getElementById("cbGib").className  = "btn "+(last==="gib"?"primary":"");
  const done=()=>{ bar.style.display="none"; ASK=null; };
  ASK = {
    pick:k=>{ done(); onPick(k); },
    cancel:()=>{ done(); if(onCancel) onCancel(); },
    last
  };
}
let ASK=null;

function selectRoom(id){ state.selRoom=id; state.selHead=null; syncPanels(); draw(); }
function deleteRoom(id){
  const p=page();
  snapshot();
  const r=p.rooms.find(x=>x.id===id);
  if(r && !confirm(`Delete "${r.name}" and its heads? This cannot be undone.`)) return;
  p.rooms=p.rooms.filter(r=>r.id!==id);
  p.heads=p.heads.filter(h=>h.roomId!==id);
  if(state.selRoom===id) state.selRoom=null;
  save(); syncPanels(); draw();
}
function deleteMeasure(id){
  snapshot();
  const p=page(); p.measures=p.measures.filter(m=>m.id!==id);
  if(state.selMeasure===id) state.selMeasure=null;
  save(); updateLenCell(); syncPanels(); draw();
}
function removeHead(h){
  snapshot();
  const p=page(); p.heads=p.heads.filter(x=>x!==h);
  if(state.selHead===h.id) state.selHead=null;
  save(); syncPanels(); draw();
}

/* Two-point scale dialog */
const dlg=document.getElementById("dlgScale");
function openScaleDialog(){
  document.getElementById("inScaleLen").value="";
  dlg.showModal();
  setTimeout(()=>document.getElementById("inScaleLen").focus(),30);
}
document.getElementById("scaleCancel").onclick=()=>{ dlg.close(); state.calib=null; draw(); };
document.getElementById("scaleOk").onclick=()=>{
  const v=parseFloat(document.getElementById("inScaleLen").value);
  const mult=parseFloat(document.getElementById("inScaleUnit").value);
  if(!(v>0)){ toast("Enter the real distance."); return; }
  const px=Math.hypot(state.calib.b.x-state.calib.a.x, state.calib.b.y-state.calib.a.y);
  if(px<2){ toast("Those two points are too close together. Try again."); dlg.close(); state.calib=null; draw(); return; }
  page().scale = (v*mult)/px;
  dlg.close(); state.calib=null;
  page().rooms.forEach(r=>{ if(r.autoLayout!==false) regenerateHeads(r); });
  page().scaleSource = "measured from two points";
  save(); syncPanels(); draw(); setMode("measure");
  toast("Scale set. You can measure straight away.");
};
dlg.addEventListener("close", ()=>{ state.calib=null; draw(); });

/* Scale dialog ─────────────────────────────────────────── */
const dlgMain = document.getElementById("dlgScaleMain");
function openScaleMain(){
  const p = page();
  const sz = state.pageSizePt;
  const wmm = sz? sz.w*PT2MM : 0, hmm = sz? sz.h*PT2MM : 0;
  const sheet = sz? sheetName(wmm,hmm) : null;
  const cur = p.scale ? scaleToRatio(p.scale) : null;

  const resolved = resolvedScales();
  const det = resolved.length
    ? resolved.map(d=>{
        const conv = Math.abs(d.eff-d.ratio) > 0.01;
        const on = cur && Math.abs(cur-d.eff)<0.5;
        return `<button class="btn ${on?"primary":""}" data-ratio="${d.eff}" data-src="${d.ratio}|${d.sheet||""}">
          1 : ${d.eff}${conv?` <span style="opacity:.65">(1:${d.ratio} @ ${d.sheet})</span>`:""}${d.count>1?` <span style="opacity:.5">×${d.count}</span>`:""}</button>`;
      }).join("")
    : `<span style="color:var(--dim)">No scale ratio found in the drawing text. If the PDF is a scan there is no text to read, so measure two points instead.</span>`;

  document.getElementById("scaleBody").innerHTML = `
    <div class="stat"><span>Current scale</span><b>${p.scale? `1 : ${cur.toFixed(cur<10?2:0)}  (${(1/p.scale).toFixed(4)} px/mm)` : "not set"}</b></div>
    <div class="stat"><span>Source</span><b style="font-family:inherit">${esc(p.scaleSource||"—")}</b></div>
    <div class="stat"><span>Sheet size</span><b>${sz? `${wmm.toFixed(0)} × ${hmm.toFixed(0)} mm${sheet?` · ${sheet}`:""}` : "—"}</b></div>
    ${sheet? (sheet==="A3"? `<div class="banner" style="margin:10px 0 0">This is an <b>A3</b> sheet. If the drawing was set out on A1 and reduced, the printed ratio is half the real one — 1:50 at A1 prints as 1:100 here. The buttons below convert it for you when the drawing says which sheet it was drawn for.</div>` : "")
      : `<div class="banner" style="margin:10px 0 0">This sheet is not a standard size, so the PDF may have been printed reduced. Do not trust the printed ratio — check it against a known dimension.</div>`}

    <h3 class="sec" style="margin-top:16px">Scales printed on the drawing</h3>
    <div class="rowbtns" id="detBtns" style="margin-top:0">${det}</div>

    <h3 class="sec">Enter it yourself</h3>
    <div class="field"><label>1 :</label><input type="number" id="inRatio" step="1" min="1" value="${cur?Math.round(cur):""}" placeholder="50">
      <span class="unit">stated for</span>
      <select id="inRatioSheet" style="flex:none;width:96px">
        <option value="">this sheet</option>
        ${["A0","A1","A2","A3","A4"].map(n=>`<option value="${n}" ${n===sheet?"selected":""}>${n}</option>`).join("")}
      </select></div>
    <p class="hint" id="ratioHint" style="margin:2px 0 0"></p>

    <h3 class="sec">Same drawing at another size</h3>
    <div class="rowbtns" style="margin-top:0">
      <button class="btn" id="scHalf">A1 original → A3 print (double it)</button>
      <button class="btn" id="scDouble">A3 print → A1 original (halve it)</button>
    </div>

    <div class="field" style="margin-top:10px"><label style="width:auto">Apply to every page</label><input type="checkbox" id="inAllPages" style="flex:none;width:auto"></div>

    <div class="rowbtns">
      <button class="btn" id="scMeasure">Measure two points</button>
      <button class="btn primary" id="scApply">Apply</button>
      <button class="btn ghost" id="scClose">Close</button>
    </div>
    <p class="hint">A printed ratio is only correct if the sheet is stored at its original size. After applying it, measure a dimension you already know to confirm.</p>`;

  const all = ()=>document.getElementById("inAllPages").checked;
  const hintEl = document.getElementById("ratioHint");
  const refreshHint = ()=>{
    const v=parseFloat(document.getElementById("inRatio").value);
    const ref=document.getElementById("inRatioSheet").value;
    if(!(v>0)){ hintEl.textContent=""; return; }
    const eff=niceRatio(ratioForThisSheet(v, ref||null));
    hintEl.innerHTML = (ref && sheet && ref!==sheet)
      ? `1:${v} on ${ref} becomes <b>1:${eff}</b> on this ${sheet} sheet.`
      : `Applies as <b>1:${eff}</b>.`;
  };
  document.getElementById("inRatio").addEventListener("input", refreshHint);
  document.getElementById("inRatioSheet").addEventListener("change", refreshHint);
  refreshHint();

  document.querySelectorAll("#detBtns .btn").forEach(b=>b.onclick=()=>{
    const eff=parseFloat(b.dataset.ratio);
    const [src,ssheet]=(b.dataset.src||"").split("|");
    applyRatio(eff, all());
    page().scaleSource = (ssheet && Math.abs(eff-parseFloat(src))>0.01)
      ? `1:${src} stated for ${ssheet}, applied as 1:${eff} on ${sheet||"this sheet"}`
      : `1:${eff} (printed on drawing)`;
    save(); dlgMain.close(); setMode("measure");
    toast("Scale applied. You can measure straight away.");
  });
  document.getElementById("scApply").onclick=()=>{
    const v=parseFloat(document.getElementById("inRatio").value);
    if(!(v>0)){ toast("Enter a ratio."); return; }
    const ref=document.getElementById("inRatioSheet").value || null;
    const eff=niceRatio(ratioForThisSheet(v, ref));
    applyRatio(eff, all());
    page().scaleSource = (ref && sheet && ref!==sheet)
      ? `1:${v} stated for ${ref}, applied as 1:${eff} on ${sheet}`
      : `1:${eff} (entered by hand)`;
    save(); dlgMain.close(); setMode("measure");
    toast(`Scale applied as 1:${eff}.`);
  };
  const flip = f => {
    if(!p.scale){ toast("Set a scale first."); return; }
    const eff=niceRatio(scaleToRatio(p.scale)*f);
    applyRatio(eff, all());
    page().scaleSource = `1:${eff} (adjusted for sheet size)`;
    save(); dlgMain.close(); setMode("measure");
    toast(`Scale is now 1:${eff}.`);
  };
  document.getElementById("scHalf").onclick=()=>flip(2);
  document.getElementById("scDouble").onclick=()=>flip(0.5);
  document.getElementById("scMeasure").onclick=()=>{ dlgMain.close(); setMode("calibrate"); };
  document.getElementById("scClose").onclick=()=>dlgMain.close();
  dlgMain.showModal();
}
document.getElementById("btnScaleDlg").onclick=()=>{ if(state.pdfCanvas) openScaleMain(); else toast("Open a PDF first."); };