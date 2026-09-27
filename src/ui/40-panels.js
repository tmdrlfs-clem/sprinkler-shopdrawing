
/* ══════════════════════════════════════════════════════════════
   8. Side panel
   ══════════════════════════════════════════════════════════════ */

document.getElementById("tabs").addEventListener("click", e=>{
  const b=e.target.closest("button"); if(b) setTab(b.dataset.tab);
});
function setTab(t){
  state.tab=t;
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("on", b.dataset.tab===t));
  document.querySelectorAll(".tabpane").forEach(p=>p.classList.toggle("on", p.dataset.pane===t));
  syncPanels();
}
const esc = s => String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function syncPanels(){
  const p=page(), mm=p.scale;
  recomputeAnalysis();
  const res0 = state.pdf ? resolvedScales() : [];
  document.getElementById("stScale").textContent = mm
    ? "1:"+niceRatio(scaleToRatio(mm))
    : (res0.length ? `not set — ${res0.map(d=>"1:"+d.eff).join(" / ")} on the sheet` : "not set");
  document.getElementById("stScale").className = mm? "" : "warn";
  document.getElementById("stPage").textContent = state.pageCount? `${state.pageNum} / ${state.pageCount}` : "—";
  const nav=document.getElementById("pagenav");
  nav.style.display = state.pageCount>0 ? "flex":"none";
  const sel=document.getElementById("pgSelect");
  const want = state.pageCount+"|"+Object.keys(state.doc.pages).map(k=>{
    const pg=state.doc.pages[k];
    return k+":"+(pg.rooms||[]).length+","+(pg.heads||[]).length+","+(pg.measures||[]).length+","+(pg.scale?1:0);
  }).join(";");
  if(sel.dataset.sig!==want){
    sel.dataset.sig=want;
    let html="";
    for(let i=1;i<=state.pageCount;i++){
      const pg=state.doc.pages[String(i)];
      const bits=[];
      if(pg){
        if((pg.rooms||[]).length) bits.push((pg.rooms||[]).length+" rooms");
        if((pg.heads||[]).length) bits.push((pg.heads||[]).length+" heads");
        if((pg.measures||[]).length) bits.push((pg.measures||[]).length+" meas");
        if(!bits.length && pg.scale) bits.push("scale set");
      }
      html+=`<option value="${i}">Page ${i} of ${state.pageCount}${bits.length?"  ·  "+bits.join(", "):""}</option>`;
    }
    sel.innerHTML=html;
  }
  sel.value=String(state.pageNum);
  document.getElementById("pgPrev2").disabled = state.pageNum<=1;
  document.getElementById("pgNext2").disabled = state.pageNum>=state.pageCount;
  renderRooms(); renderProps(); renderMeas(); renderReview(); renderLegend(); renderRules(); renderOut();
  updateLenCell(); updateVecCell();
}

function renderRooms(){
  const el=document.getElementById("paneRooms"), p=page();
  const totalArea = p.scale? p.rooms.reduce((a,r)=>a+polyArea(r.polygon)*p.scale*p.scale/1e6,0) : null;
  let h="";
  if(!p.scale) h+=`<div class="banner">No scale set. Areas and spacing checks stay empty until you set one.</div>`;
  h+=`<h3 class="sec">${p.rooms.length} rooms on this page${totalArea!==null?`, ${totalArea.toFixed(1)} m² total`:""}, ${p.heads.length} heads</h3>`;
  if(!p.rooms.length){
    h+=`<div class="block"><p style="margin:0;color:var(--dim)">No rooms yet. Pick the <b>Room</b> tool on the left and click around a room to close a polygon.</p></div>`;
  }else{
    h+=`<div class="roomlist">`;
    for(const r of p.rooms){
      const a=cached(r);
      const cls = !a.heads? "none" : (a.flags.length? "bad":"");
      h+=`<div class="roomrow ${state.selRoom===r.id?"on":""}" data-room="${r.id}">
        <span class="dot ${cls}"></span>
        <span class="nm">${esc(r.name)}</span>
        <span class="meta num">${a.areaM2!==null?a.areaM2.toFixed(1)+" m²":"—"} · ${r.hazard} · ${a.heads}H</span>
      </div>`;
    }
    h+=`</div>`;
    h+=`<div class="rowbtns"><button class="btn" id="regenAll">Re-lay every room</button></div>`;
  }
  h+=`<h3 class="sec">Dynamic fill</h3>
    <div class="block">
      <p style="margin:0 0 8px;color:var(--dim)">Pick the <b>Fill</b> tool, then press and hold inside a room. The fill spreads out from the cursor and stops at walls; drag to add more areas. Release to pause, press again to keep going. <b>Shift+drag</b> paints straight over anything the spread cannot cross, such as a hatch edge or a furniture line, and the spread carries on from there. <b>Ctrl+drag</b> rubs filled area back out. <b>Ctrl+Z</b> undoes the last stroke. Apply or Enter turns the filled area into a single room, so bridge any separate patches with Shift+drag before applying. Outside the fill tool, Ctrl+Z undoes rooms, heads and measurements.</p>
      <div class="field"><label>Line threshold</label><input type="range" id="fTh" min="60" max="240" step="5" value="${MASK.threshold}"><span class="unit num" id="fThV">${MASK.threshold}</span></div>
      <div class="field"><label>Close gaps</label><input type="range" id="fCl" min="0" max="4" step="1" value="${MASK.close}"><span class="unit num" id="fClV">${MASK.close} px</span></div>
      <div class="field"><label>Brush</label><select id="fBs" style="flex:none;width:88px">
          <option value="square" ${MASK.brush!=="round"?"selected":""}>square</option>
          <option value="round" ${MASK.brush==="round"?"selected":""}>round</option>
        </select><input type="range" id="fBz" min="6" max="60" step="2" value="${MASK.brushPx}"><span class="unit num" id="fBzV">${MASK.brushPx} px</span></div>
      <div class="field"><label>Join across</label><input type="range" id="fBr" min="0" max="16" step="1" value="${MASK.bridge}"><span class="unit num" id="fBrV">${MASK.bridge} px</span></div>
      <p class="hint">Raise the threshold to treat faint hatching as a wall, lower it to ignore it. Close gaps thickens every line, which seals small openings but pulls the outline in slightly. Join across is applied when you Apply: any line up to that thickness running through the filled area is ignored, so everything you filled becomes one room. A doorway that leaks can be blocked with a length line drawn across it.</p>
    </div>

    <h3 class="sec">Head dimensions</h3>
    <div class="block">
      <div class="field" style="margin:0"><label style="width:auto;flex:1">Show for</label>
        <select id="dimSel" style="flex:none;width:110px">
          <option value="selected" ${state.dims==="selected"?"selected":""}>selected room</option>
          <option value="all" ${state.dims==="all"?"selected":""}>every room</option>
          <option value="off" ${state.dims==="off"?"selected":""}>off</option>
        </select></div>
      <p class="hint">Dimensions and the head grid run square to the page by default, so figures read up, down, left and right; switch a room to "along the main walls" in the Room tab if it genuinely sits at an angle. Each head is dimensioned four ways along those directions. In each direction the figure runs to the next head in line if there is one (shown amber) and to the wall only where there is none (blue). Click a head to highlight its figures and see the coverage it provides.</p>
    </div>`;

  el.innerHTML=h;
  el.querySelectorAll(".roomrow").forEach(row=>row.onclick=()=>{ selectRoom(row.dataset.room); setTab("props"); });
  const fTh=document.getElementById("fTh");
  if(fTh) fTh.oninput=e=>{ MASK.threshold=+e.target.value; MASK.key=null; document.getElementById("fThV").textContent=MASK.threshold; };
  const fCl=document.getElementById("fCl");
  if(fCl) fCl.oninput=e=>{ MASK.close=+e.target.value; MASK.key=null; document.getElementById("fClV").textContent=MASK.close+" px"; };
  const fBs=document.getElementById("fBs");
  if(fBs) fBs.onchange=e=>{ MASK.brush=e.target.value; draw(); };
  const fBz=document.getElementById("fBz");
  if(fBz) fBz.oninput=e=>{ MASK.brushPx=+e.target.value; document.getElementById("fBzV").textContent=MASK.brushPx+" px"; draw(); };
  const fBr=document.getElementById("fBr");
  if(fBr) fBr.oninput=e=>{ MASK.bridge=+e.target.value; document.getElementById("fBrV").textContent=MASK.bridge+" px"; };
  const dS=document.getElementById("dimSel");
  if(dS) dS.onchange=e=>{ state.dims=e.target.value; document.getElementById("stDims").textContent=state.dims; draw(); };
  const rb=document.getElementById("regenAll");
  if(rb) rb.onclick=()=>{
    snapshot();
    p.rooms.forEach(r=>{ r.autoLayout=true; regenerateHeads(r); });
    syncPanels(); draw();
    let gaps=0; for(const r of p.rooms){ const a=cached(r); gaps+=(a.gaps||[]).length; }
    toast(gaps? `Heads re-laid. ${gaps} uncovered area${gaps>1?"s":""} remain — see Review.` : "Heads re-laid. Every room is fully covered.");
  };
}

function renderProps(){
  const el=document.getElementById("paneProps"), p=page();
  const room=p.rooms.find(r=>r.id===state.selRoom);
  if(!room){ el.innerHTML=`<div class="block"><p style="margin:0;color:var(--dim)">Select a room to see its properties and compliance checks.</p></div>`; return; }
  const a=cached(room);
  const r=ruleFor(room);
  const opts = Object.entries(state.doc.rules).map(([k,v])=>`<option value="${k}" ${room.hazard===k?"selected":""}>${k} — ${esc(v.label)}</option>`).join("");
  const htOpts = Object.entries(devices()).filter(([,d])=>d.group==="Sprinkler")
    .map(([id,d])=>`<option value="${id}" ${devId(room.headType)===id?"selected":""}>${esc(d.label)}</option>`).join("");

  el.innerHTML=`
  <div class="block">
    <div class="field"><label>Room name</label><input id="pName" value="${esc(room.name)}"></div>
    <div class="field"><label>Hazard class</label><select id="pHaz">${opts}</select></div>
    <div class="field"><label>Head type</label><select id="pType">${htOpts}</select></div>
    <div class="field"><label>Ceiling height</label><input type="number" id="pCh" step="0.05" value="${room.ceilingH}"><span class="unit">m</span></div>
    <div class="field"><label>Ceiling</label><select id="pCt">
      <option value="flat" ${room.ceilingType==="flat"?"selected":""}>Flat</option>
      <option value="sloped" ${room.ceilingType==="sloped"?"selected":""}>Sloped</option>
      <option value="exposed" ${room.ceilingType==="exposed"?"selected":""}>Exposed structure</option>
    </select></div>
    <div class="field" style="align-items:flex-start"><label>Notes</label><textarea id="pNotes" rows="2">${esc(room.notes)}</textarea></div>
  </div>

  <h3 class="sec">Dimensions</h3>
  <div class="block">
    <div class="stat"><span>Area</span><b>${a.areaM2!==null?a.areaM2.toFixed(2)+" m²":"scale needed"}</b></div>
    <div class="stat"><span>Bounding rectangle</span><b>${a.wM?`${a.wM.toFixed(2)} × ${a.lM.toFixed(2)} m`:"—"}</b></div>
    <div class="stat"><span>Perimeter</span><b>${a.perimM?a.perimM.toFixed(2)+" m":"—"}</b></div>
    <div class="stat"><span>Corners</span><b>${room.polygon.length}</b></div>
  </div>

  ${(()=>{ const t=detectTiles(room); const mm=mmPerPx();
    const on = isTiled(room);
    const fr = (room.tileFractions&&room.tileFractions.length)? room.tileFractions : TILE.fractions;
    const hs = page().heads.filter(h=>h.roomId===room.id && isSprinkler(h));
    const al = hs.filter(h=>h.tile).length;
    return `<h3 class="sec">Ceiling</h3>
    <div class="block">
      <div class="field"><label>Ceiling</label>
        <div style="display:flex;gap:6px;flex:1">
          <button class="btn ${on?"primary":""}" data-ceil="tile" style="flex:1">Tile ceiling</button>
          <button class="btn ${!on?"primary":""}" data-ceil="gib" style="flex:1">GIB ceiling</button>
        </div></div>
      ${!on? `<p class="hint" style="margin:4px 0 0">GIB is continuous, so heads follow the room grid only and nothing is snapped to ceiling lines.</p>` : ""}
      ${on? `<div class="stat"><span>Grid found</span><b class="${t?"good":""}">${t? `${t.u.sizeMm} × ${t.v.sizeMm} mm${t.manual?" (set by hand)":""}` : (VEC.busy? "still reading the page…" : VEC.ready? "none detected" : "no vectors in this PDF")}</b></div>
      ${t&&!t.manual?`<div class="stat"><span>Confidence</span><b>${(Math.min(t.u.strength,t.v.strength)*100).toFixed(0)}% · ${t.u.lines}×${t.v.lines} lines</b></div>`:""}
      ${(()=>{ if(t) return ""; const d=tileDiag(room); if(!d) return "";
        const one=(lbl,x)=>`<div class="stat"><span>${lbl}</span><b>${x.lines||0} lines${x.best?` · best ${x.best.sizeMm} mm at ${(x.best.strength*100).toFixed(0)}%, ${x.best.lines} apart`:""}</b></div>`;
        return one("Across, candidates", d.across)+one("Down, candidates", d.down)+
          `<p class="hint" style="margin:6px 0 0">Needs at least ${TILE.minLines} evenly pitched lines each way at ${(TILE.strength*100).toFixed(0)}% regularity. If the ceiling grid is not drawn on this sheet, set it by hand below.</p>`; })()}

      <div class="field" style="margin-top:8px"><label>Set by hand</label>
        <input type="number" id="pTilePU" step="50" min="50" value="${room.tileManual?room.tileManual.pu:600}" style="width:60px">
        <span class="unit">×</span>
        <input type="number" id="pTilePV" step="50" min="50" value="${room.tileManual?room.tileManual.pv:1200}" style="width:60px">
        <span class="unit">mm</span></div>
      <div class="rowbtns" style="margin-top:4px">
        <button class="btn ${room.tileManual?"primary":""}" id="pTilePick">Pick a tile corner</button>
        ${room.tileManual?`<button class="btn" id="pTileAuto">Back to auto</button>`:""}
      </div>
      <div class="stat"><span>Heads on a tile point</span><b class="${al===hs.length&&hs.length?"good":""}">${al} of ${hs.length}</b></div>
      <div class="field" style="margin-top:7px"><label style="width:auto;flex:1">Along the long side of the tile</label></div>
      <div class="rowbtns" style="margin-top:2px">
        ${[["1/3",1/3],["1/2",1/2],["2/3",2/3],["edge",0]].map(([lbl,f])=>
          `<button class="btn ${fr.some(x=>Math.abs(x-f)<1e-4)?"primary":""}" data-frac="${f}">${lbl}</button>`).join("")}
      </div>
      <div class="field" style="margin:7px 0 0"><label style="width:auto;flex:1">Add a row if that makes it fit</label><input type="checkbox" id="pTileX" ${room.tileExtra!==false?"checked":""} style="flex:none;width:auto"></div>
      <p class="hint">Heads sit on the centreline of the tile's short side, and at a third, half or two thirds along the long side — a third by preference. Square tiles are centred both ways. Nothing moves if it would cost coverage, spacing or wall clearance.</p>` : ""}
    </div>`; })()}

  <h3 class="sec">Head layout</h3>
  <div class="block">
    <div class="field"><label>Auto grid</label><input type="checkbox" id="pAuto" ${room.autoLayout!==false?"checked":""} style="flex:none;width:auto"><span class="unit">off keeps only hand-placed heads</span></div>
    <div class="field"><label>Grid runs</label><select id="pGMode">
      <option value="ortho" ${(room.gridMode||"ortho")==="ortho"?"selected":""}>square to the page</option>
      <option value="auto" ${room.gridMode==="auto"?"selected":""}>along the main walls</option>
      <option value="bbox" ${room.gridMode==="bbox"?"selected":""}>along the tightest box</option>
    </select></div>
    <div class="field"><label>Grid rotation</label><input type="range" id="pAng" min="-45" max="45" step="1" value="${room.gridAngle||0}"><span class="unit num" id="pAngV">${room.gridAngle||0}°</span></div>
    <div class="stat"><span>Heads placed</span><b>${a.heads}</b></div>
    <div class="stat"><span>Minimum by rule</span><b>${a.required??"—"}</b></div>
    <div class="stat"><span>Area per head</span><b class="${a.perHead>r.maxAreaPerHead?"bad":"good"}">${a.perHead?a.perHead.toFixed(2)+" m²":"—"}</b></div>
    <div class="stat"><span>Widest spacing</span><b class="${a.maxSpacing>r.maxSpacing?"bad":"good"}">${a.maxSpacing?a.maxSpacing.toFixed(2)+" m":"—"}</b></div>
    <div class="stat"><span>Closest spacing</span><b class="${a.minSpacing&&a.minSpacing<r.minSpacing?"bad":""}">${a.minSpacing?a.minSpacing.toFixed(2)+" m":"—"}</b></div>
    <div class="stat"><span>Coverage</span><b class="${a.coverage!==undefined&&a.coverage<0.999?"bad":"good"}">${a.coverage!==undefined?(a.coverage*100).toFixed(1)+"%":"—"}</b></div>
    <div class="stat"><span>Uncovered areas</span><b class="${a.gaps&&a.gaps.length?"bad":"good"}">${a.gaps? (a.gaps.length? `${a.gaps.length} · ${a.gapArea.toFixed(2)} m²` : "none") : "—"}</b></div>
    <div class="stat"><span>Grid direction</span><b>${(roomAngle(room)*180/Math.PI).toFixed(1)}°</b></div>
    <div class="stat"><span>Placed by</span><b>${(()=>{ const hs=page().heads.filter(h=>h.roomId===room.id && isSprinkler(h)); const g=hs.filter(h=>h.src==="grid").length, rp=hs.filter(h=>h.src==="repair").length, m=hs.filter(h=>!h.auto).length; return `grid ${g} · repair ${rp} · manual ${m}`; })()}</b></div>
    <div class="rowbtns">
      <button class="btn" id="pRegen">Re-lay</button>
      <button class="btn" id="pClear">Clear heads</button>
    </div>
  </div>

  ${(()=>{ const h=page().heads.find(x=>x.id===state.selHead && x.roomId===room.id); if(!h) return "";
    const opts=Object.entries(devices()).map(([id,d])=>`<option value="${id}" ${devId(h.type)===id?"selected":""}>${esc(d.group)} — ${esc(d.label)}</option>`).join("");
    return `<h3 class="sec">Selected device</h3>
    <div class="block">
      <div class="field" style="margin:0"><label>Type</label><select id="hType">${opts}</select></div>
      <p class="hint">Changing one device here does not touch the rest of the room. Non-sprinkler devices are counted in the legend but ignored by the coverage checks.</p>
    </div>`; })()}

  <h3 class="sec">Checks</h3>
  <ul class="flags">
    ${a.flags.map(f=>`<li>${esc(f)}</li>`).join("")}
    ${a.pass.map(f=>`<li class="pass">${esc(f)}</li>`).join("")}
  </ul>

  <div class="rowbtns"><button class="btn" id="pDel">Delete room</button></div>
  <p class="hint">These checks only test the figures entered in this tool. Obstructions, beams, light fittings and ceiling exceptions are not considered — the designer signs it off.</p>`;

  const bind=(id,ev,fn)=>{const n=document.getElementById(id); if(n) n.addEventListener(ev,fn);};
  bind("pName","input",e=>{room.name=e.target.value; save(); renderRooms(); draw();});
  bind("pHaz","change",e=>{room.hazard=e.target.value; state.lastHazard=e.target.value; regenerateHeads(room); syncPanels(); draw();});
  bind("pType","change",e=>{room.headType=e.target.value;
    page().heads.filter(h=>h.roomId===room.id && isSprinkler(h)).forEach(h=>h.type=e.target.value);
    save(); syncPanels(); draw();});
  bind("pCh","input",e=>{room.ceilingH=parseFloat(e.target.value)||0; save();});
  bind("pCt","change",e=>{room.ceilingType=e.target.value; save();});
  bind("pNotes","input",e=>{room.notes=e.target.value; save();});
  bind("pAuto","change",e=>{room.autoLayout=e.target.checked; regenerateHeads(room); syncPanels(); draw();});
  bind("pTilePick","click",()=>{
    const M = room.tileManual || (room.tileManual={pu:600, pv:1200, ou:0, ov:0});
    M.pu = parseFloat(document.getElementById("pTilePU").value)||600;
    M.pv = parseFloat(document.getElementById("pTilePV").value)||1200;
    setMode("tile");
    toast("Now click a corner of the ceiling grid inside this room.");
  });
  bind("pTileAuto","click",()=>{ room.tileManual=null; TILE_CACHE.delete(room.id); regenerateHeads(room); syncPanels(); draw(); });
  bind("pTilePU","change",e=>{ if(room.tileManual){ room.tileManual.pu=parseFloat(e.target.value)||600; regenerateHeads(room); syncPanels(); draw(); } });
  bind("pTilePV","change",e=>{ if(room.tileManual){ room.tileManual.pv=parseFloat(e.target.value)||1200; regenerateHeads(room); syncPanels(); draw(); } });
  bind("pTileX","change",e=>{ room.tileExtra=e.target.checked; regenerateHeads(room); syncPanels(); draw(); });
  document.querySelectorAll("#paneProps [data-ceil]").forEach(b=>b.onclick=()=>{
    if(ceilingOf(room)===b.dataset.ceil) return;
    snapshot();
    setCeiling(room, b.dataset.ceil);
  });
  document.querySelectorAll("#paneProps [data-frac]").forEach(b=>b.onclick=()=>{
    const f=parseFloat(b.dataset.frac);
    let fr=(room.tileFractions&&room.tileFractions.length)? [...room.tileFractions] : [...TILE.fractions];
    fr = fr.some(x=>Math.abs(x-f)<1e-4) ? fr.filter(x=>Math.abs(x-f)>=1e-4) : [...fr, f].sort((a,b)=>a-b);
    if(!fr.length) fr=[0.5];
    room.tileFractions=fr;
    regenerateHeads(room); syncPanels(); draw();
  });
  bind("pGMode","change",e=>{ room.gridMode=e.target.value; ANGLE_CACHE.delete(room.id); regenerateHeads(room); syncPanels(); draw(); });
  bind("pAng","input",e=>{
    room.gridAngle=parseInt(e.target.value,10);
    document.getElementById("pAngV").textContent=room.gridAngle+"°";
    regenerateHeads(room); draw();
  });
  bind("pAng","change",()=>syncPanels());
  bind("pRegen","click",()=>{room.autoLayout=true; regenerateHeads(room); syncPanels(); draw();});
  bind("pClear","click",()=>{const p2=page(); p2.heads=p2.heads.filter(h=>h.roomId!==room.id); room.autoLayout=false; save(); syncPanels(); draw();});
  bind("hType","change",e=>{
    const h=page().heads.find(x=>x.id===state.selHead);
    if(h){ snapshot(); h.type=e.target.value; h.auto=false; h.locked=true; save(); syncPanels(); draw(); }
  });
  bind("pDel","click",()=>deleteRoom(room.id));
}

function renderMeas(){
  const el=document.getElementById("paneMeas"), p=page();
  const rows = p.measures.map((m,i)=>{
    const seg = m.pts.length-1;
    return `<div class="roomrow ${state.selMeasure===m.id?"on":""}" data-meas="${m.id}" style="border-left-color:#7b9cff">
      <span class="nm">${esc(m.label||("Measurement "+String(i+1).padStart(2,"0")))}</span>
      <span class="meta num">${fmtLen(segLenPx(m.pts))}${seg>1?` · ${seg} segments`:""}</span>
    </div>`;
  }).join("");

  el.innerHTML = `
    ${p.scale? "" : `<div class="banner">Without a scale, lengths show in pixels. Set one with <b>Set</b> in the status bar.</div>`}
    <div class="block">
      <div class="field"><label style="width:auto;flex:1">Chain segments and total them</label><input type="checkbox" id="mChain" ${state.chain?"checked":""} style="flex:none;width:auto"></div>
      <div class="field" style="margin:0"><label style="width:auto;flex:1">Snap to drawing lines and placed points</label><input type="checkbox" id="mSnap" ${state.snap?"checked":""} style="flex:none;width:auto"></div>
    </div>
    <h3 class="sec">${p.measures.length} measurements</h3>
    ${p.measures.length? `<div class="roomlist">${rows}</div>` :
      `<div class="block"><p style="margin:0;color:var(--dim)">Pick the <b>Length</b> tool and click two points to leave a dimension. Shift locks horizontal or vertical, Alt+click deletes.</p></div>`}
    ${p.measures.length? `<div class="rowbtns">
      <button class="btn" id="mCsv">Measurements CSV</button>
      <button class="btn" id="mClear">Clear all</button></div>` : ""}
    ${state.selMeasure? renderMeasDetail() : ""}`;

  el.querySelectorAll("[data-meas]").forEach(r=>r.onclick=()=>{
    state.selMeasure=r.dataset.meas; setMode("measure"); syncPanels(); draw();
  });
  const c=document.getElementById("mChain"); if(c) c.onchange=e=>{ state.chain=e.target.checked; };
  const sn=document.getElementById("mSnap"); if(sn) sn.onchange=e=>{ state.snap=e.target.checked; state.snapHit=null; updateVecCell(); draw(); };
  const cs=document.getElementById("mCsv"); if(cs) cs.onclick=exportMeasCsv;
  const cl=document.getElementById("mClear"); if(cl) cl.onclick=()=>{
    if(!confirm("Clear every measurement on this page?")) return;
    page().measures=[]; state.selMeasure=null; save(); syncPanels(); draw();
  };
  const nm=document.getElementById("mName");
  if(nm) nm.oninput=e=>{ const m=page().measures.find(x=>x.id===state.selMeasure); if(m){ m.label=e.target.value; save(); } };
  const dl=document.getElementById("mDel"); if(dl) dl.onclick=()=>deleteMeasure(state.selMeasure);
}
function renderMeasDetail(){
  const m=page().measures.find(x=>x.id===state.selMeasure);
  if(!m) return "";
  const segs=[];
  for(let i=1;i<m.pts.length;i++) segs.push(`<div class="stat"><span>Segment ${i}</span><b>${fmtLen(segLenPx([m.pts[i-1],m.pts[i]]))} · ${segAngle(m.pts[i-1],m.pts[i]).toFixed(1)}°</b></div>`);
  return `<h3 class="sec">Selected measurement</h3>
    <div class="block">
      <div class="field"><label>Name</label><input id="mName" value="${esc(m.label||"")}" placeholder="e.g. to core wall"></div>
      ${segs.join("")}
      <div class="stat"><span>Total</span><b>${fmtLen(segLenPx(m.pts))}</b></div>
      <div class="rowbtns"><button class="btn" id="mDel">Delete</button></div>
    </div>`;
}

function zoomTo(wp, z){
  const w=stage.clientWidth, h=stage.clientHeight;
  state.view.zoom = z || Math.max(state.view.zoom, 1.2);
  state.view.tx = w/2 - wp.x*state.view.zoom;
  state.view.ty = h/2 - wp.y*state.view.zoom;
  draw();
}
function addHeadAt(room, wp){
  const mm=mmPerPx(); const r=ruleFor(room);
  const minWall=(r.minWallDist??0.1)*1000/mm;
  const valid = q => pointInPoly(q, room.polygon) && distToPoly(q, room.polygon) >= minWall;
  let pos = valid(wp)? wp : null;
  if(!pos){
    const stepD=100/mm;
    for(let d=stepD; d<=30*stepD && !pos; d+=stepD)
      for(const q of [{x:wp.x+d,y:wp.y},{x:wp.x-d,y:wp.y},{x:wp.x,y:wp.y+d},{x:wp.x,y:wp.y-d},
                      {x:wp.x+d,y:wp.y+d},{x:wp.x-d,y:wp.y-d},{x:wp.x+d,y:wp.y-d},{x:wp.x-d,y:wp.y+d}])
        if(valid(q)){ pos=q; break; }
  }
  if(!pos){ toast("No installable position near there — it is too tight against the walls."); return; }
  snapshot();
  const nh={id:uid("h_"), roomId:room.id, x:pos.x, y:pos.y, type:devId(room.headType), auto:false, locked:true, src:"manual"};
  page().heads.push(nh); state.selHead=nh.id; state.selRoom=room.id;
  save(); syncPanels(); draw();
}

function renderReview(){
  const el=document.getElementById("paneReview"), p=page(), mm=p.scale;
  if(!mm){ el.innerHTML=`<div class="banner">Set the scale first — coverage cannot be checked without it.</div>`; return; }
  if(!p.rooms.length){ el.innerHTML=`<div class="block"><p style="margin:0;color:var(--dim)">No rooms on this page yet.</p></div>`; return; }
  let totGaps=0, totArea=0, tight=0, spacing=0;
  const rows=[];
  for(const room of p.rooms){
    const a=cached(room);
    const gaps=a.gaps||[];
    totGaps+=gaps.length; totArea+=a.gapArea||0; tight+=(a.tightHeads||[]).length;
    const r=ruleFor(room);
    if(a.maxSpacing>r.maxSpacing || (a.minSpacing && a.minSpacing<r.minSpacing)) spacing++;
    const glist = gaps.map((g,i)=>`
      <div class="stat" style="align-items:center">
        <span><b style="font-family:inherit;color:#e4573d">${i+1}</b> &nbsp;${g.area.toFixed(2)} m²</span>
        <span style="display:flex;gap:5px">
          <button class="pill" data-zoom="${room.id}:${i}">Zoom</button>
          <button class="pill" data-add="${room.id}:${i}">Add head</button>
        </span>
      </div>`).join("");
    rows.push(`
      <div class="block" style="border-left:3px solid ${gaps.length||a.flags.length?"#e4573d":"#5fbf7a"}">
        <div class="stat"><span style="color:var(--text);font-weight:500">${esc(room.name)}</span>
          <b class="${a.coverage<0.999?"bad":"good"}">${(a.coverage*100).toFixed(1)}%</b></div>
        <div class="stat"><span>Heads</span><b>${a.heads}${a.required?` (min ${a.required})`:""}</b></div>
        ${glist}
        ${a.flags.filter(f=>!/uncovered/.test(f)).map(f=>`<div class="stat"><span style="color:#f2b7ab">${esc(f)}</span></div>`).join("")}
        <div class="rowbtns"><button class="btn" data-relay="${room.id}">Re-lay this room</button></div>
      </div>`);
  }
  el.innerHTML=`
    <div class="block" style="margin-bottom:12px">
      <div class="stat"><span>Uncovered areas</span><b class="${totGaps?"bad":"good"}">${totGaps}${totGaps?` · ${totArea.toFixed(2)} m²`:""}</b></div>
      <div class="stat"><span>Heads too close to a wall</span><b class="${tight?"bad":""}">${tight}</b></div>
      <div class="stat"><span>Rooms with spacing issues</span><b class="${spacing?"bad":""}">${spacing}</b></div>
      ${(()=>{ let tt=0, ta=0, any=false;
        for(const room of p.rooms){ if(!isTiled(room)) continue;
          if(!detectTiles(room)) continue; any=true;
          const hs=p.heads.filter(h=>h.roomId===room.id && isSprinkler(h));
          tt+=hs.length; ta+=hs.filter(h=>h.tile).length; }
        return any? `<div class="stat"><span>Heads on a ceiling tile point</span><b class="${ta===tt?"good":""}">${ta} of ${tt}</b></div>` : ""; })()}
      <div class="field" style="margin:8px 0 0"><label style="width:auto;flex:1">Show gaps on the drawing</label><input type="checkbox" id="rvOn" ${state.review?"checked":""} style="flex:none;width:auto"></div>
      <div class="field" style="margin:0"><label style="width:auto;flex:1">Show coverage of every head</label><input type="checkbox" id="rvCov" ${state.showCov?"checked":""} style="flex:none;width:auto"></div>
      <div class="rowbtns"><button class="btn" id="rvCovBtn">${state.showCov?"Hide":"Show"} all coverage</button></div>
      <p class="hint">Coverage draws each head's protected area — the S×S square or the reach circle, whichever rule is set — with the circle always shown dashed so the shape is clear. Red squares are points no head reaches under the coverage rule in Rules. Numbered dots mark each gap. Add head drops a locked head at the gap and keeps it through re-lays; if a gap is a void, duct or alcove that needs nothing, just leave it.</p>
    </div>
    ${rows.join("")}`;
  document.getElementById("rvOn").onchange=e=>setReview(e.target.checked);
  document.getElementById("rvCov").onchange=e=>setCoverageView(e.target.checked);
  document.getElementById("rvCovBtn").onclick=()=>setCoverageView(!state.showCov);
  el.querySelectorAll("[data-zoom]").forEach(b=>b.onclick=()=>{
    const [rid,i]=b.dataset.zoom.split(":"); const room=p.rooms.find(r=>r.id===rid); const g=cached(room).gaps[+i];
    if(g){ state.selRoom=rid; if(!state.review) setReview(true); zoomTo(g, Math.max(state.view.zoom,1.5)); syncPanels(); }
  });
  el.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{
    const [rid,i]=b.dataset.add.split(":"); const room=p.rooms.find(r=>r.id===rid); const g=cached(room).gaps[+i];
    if(g) addHeadAt(room, {x:g.x,y:g.y});
  });
  el.querySelectorAll("[data-relay]").forEach(b=>b.onclick=()=>{
    const room=p.rooms.find(r=>r.id===b.dataset.relay); if(!room) return;
    snapshot(); room.autoLayout=true; regenerateHeads(room); syncPanels(); draw();
    const a=cached(room);
    toast(`${room.name}: ${a.heads} heads, coverage ${(a.coverage*100).toFixed(1)}%${a.gaps.length?`, ${a.gaps.length} gap${a.gaps.length>1?"s":""} left`:""}.`);
  });
}

function renderLegend(){
  const el=document.getElementById("paneLegend"), p=page();
  const L = p.legend || (p.legend={x:null,y:null,show:true,cols:46,title:"LEGEND",always:[]});
  const counts=new Map();
  for(const h of p.heads) counts.set(devId(h.type),(counts.get(devId(h.type))||0)+1);
  const D=devices();
  const groups={};
  for(const [id,d] of Object.entries(D)) (groups[d.group||"Other"] ||= []).push([id,d]);

  const block = ([id,d])=>{
    const n=counts.get(id)||0;
    const always=(L.always||[]).includes(id);
    return `<div class="roomrow" style="border-left-color:${d.color||"#e4573d"};align-items:flex-start;cursor:default">
      <canvas class="devsym" data-sym="${id}" width="30" height="30" style="width:30px;height:30px;flex:none"></canvas>
      <span style="flex:1;min-width:0">
        <span class="nm">${esc(d.label)}</span>
        <textarea data-desc="${id}" rows="2" style="width:100%;margin-top:4px;background:#171b20;border:1px solid var(--edge2);border-radius:3px;padding:4px 6px;font-size:11px;color:var(--text)">${esc(d.desc)}</textarea>
        <label style="display:flex;gap:5px;align-items:center;margin-top:4px;color:var(--dimmer);font-size:11px">
          <input type="checkbox" data-always="${id}" ${always?"checked":""} style="width:auto"> list it even when the count is zero</label>
      </span>
      <span class="meta num" style="font-size:14px;color:${n?"var(--text)":"var(--dimmer)"}">${n}</span>
    </div>`;
  };

  el.innerHTML=`
    <div class="block">
      <div class="field" style="margin:0 0 7px"><label style="width:auto;flex:1">Show the legend on the drawing</label><input type="checkbox" id="lgShow" ${L.show!==false?"checked":""} style="flex:none;width:auto"></div>
      <div class="field" style="margin:0 0 7px"><label>Title</label><input id="lgTitle" value="${esc(L.title||"LEGEND")}"></div>
      <div class="field" style="margin:0"><label>Text width</label><input type="range" id="lgCols" min="26" max="70" step="2" value="${L.cols||46}"><span class="unit num" id="lgColsV">${L.cols||46}</span></div>
      <div class="rowbtns"><button class="btn" id="lgReset">Put it back in the corner</button></div>
      <p class="hint">Drag the legend around with the Pan tool. Only devices actually on this page are listed, each with its count, and the same box is written into the PDF.</p>
    </div>
    ${Object.entries(groups).map(([g,items])=>`
      <h3 class="sec">${esc(g)}</h3>
      <div class="roomlist">${items.map(block).join("")}</div>`).join("")}
    <div class="rowbtns"><button class="btn" id="lgAdd">Add device</button></div>
    <p class="hint">New devices join the library for this job and travel in the work file. Anything outside the Sprinkler group — fire alarm, valves — is drawn and counted but left out of the coverage and spacing checks.</p>`;

  el.querySelectorAll("canvas.devsym").forEach(c=>{
    const d=D[c.dataset.sym]; const g=c.getContext("2d");
    g.clearRect(0,0,30,30);
    drawDeviceSymbol(g, 15, 15, 9, d, {lw:1.8, bg:"#1b1f24", letterColor:"#7b9cff"});
  });
  el.querySelectorAll("[data-desc]").forEach(t=>t.oninput=e=>{ D[e.target.dataset.desc].desc=e.target.value; save(); draw(); });
  el.querySelectorAll("[data-always]").forEach(c=>c.onchange=e=>{
    const id=e.target.dataset.always;
    L.always = L.always||[];
    if(e.target.checked){ if(!L.always.includes(id)) L.always.push(id); }
    else L.always = L.always.filter(x=>x!==id);
    save(); draw();
  });
  document.getElementById("lgShow").onchange=e=>{ L.show=e.target.checked; save(); draw(); };
  document.getElementById("lgTitle").oninput=e=>{ L.title=e.target.value; save(); draw(); };
  document.getElementById("lgCols").oninput=e=>{ L.cols=+e.target.value; document.getElementById("lgColsV").textContent=L.cols; save(); draw(); };
  document.getElementById("lgReset").onclick=()=>{ L.x=null; L.y=null; save(); draw(); };
  document.getElementById("lgAdd").onclick=()=>{
    const label=(prompt("Short name for the device, e.g. Beam detector")||"").trim();
    if(!label) return;
    const group=(prompt("Group it belongs to (Sprinkler, Fire alarm, Valves and switches, …)","Fire alarm")||"Other").trim();
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,24)+"-"+Math.random().toString(36).slice(2,5);
    D[id]={group, label, desc:label.toUpperCase()+".", shape:"circle", dot:false, fill:false,
           letter:label.slice(0,1).toUpperCase(), color: group==="Sprinkler"?"#e4573d":"#2f6fd0"};
    save(); syncPanels(); draw();
  };
}

function renderRules(){
  const el=document.getElementById("paneRules");
  const rows=Object.entries(state.doc.rules).map(([k,v])=>`
    <tr class="${v.verified?"":"unver"}">
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${v.color||"#35b8a6"};margin-right:5px"></span>${k}</td>
      <td><input data-k="${k}" data-f="maxAreaPerHead" value="${v.maxAreaPerHead}"></td>
      <td><input data-k="${k}" data-f="maxSpacing" value="${v.maxSpacing}"></td>
      <td><input data-k="${k}" data-f="minSpacing" value="${v.minSpacing}"></td>
      <td><input data-k="${k}" data-f="maxWallDist" value="${v.maxWallDist}"></td>
      <td><input data-k="${k}" data-f="minWallDist" value="${v.minWallDist??0.1}"></td>
      <td style="text-align:right"><input type="checkbox" data-k="${k}" data-f="verified" ${v.verified?"checked":""}></td>
      <td style="text-align:right"><button class="pill" data-del="${k}" title="Remove this class">×</button></td>
    </tr>`).join("");
  el.innerHTML=`
    <div class="banner"><b>Check these figures first.</b> The values below are placeholders. Enter the real ones from the NZS 4541 tables and tick the last column. Any class left unticked raises a warning in the checks.</div>
    <h3 class="sec">Coverage rule</h3>
    <div class="block">
      <div class="field" style="margin:0"><label style="width:auto;flex:1">A point is covered when it is…</label>
        <select id="covModel" style="flex:none;width:150px">
          <option value="rect" ${covModel()==="rect"?"selected":""}>inside a head's S×S square</option>
          <option value="circle" ${covModel()==="circle"?"selected":""}>within the corner radius</option>
        </select></div>
      <p class="hint">S×S means each head protects half the maximum spacing in every grid direction, which is how the spacing and wall-distance limits are written. The circle option is looser at the corners. Both the layout engine and the checks use whichever you pick.</p>
    </div>
    <h3 class="sec">Layout rules by hazard class</h3>
    <table class="rules">
      <thead><tr><th>Class</th><th>Area/<br>head m²</th><th>Max<br>space m</th><th>Min<br>space m</th><th>Max<br>wall m</th><th>Min<br>wall m</th><th>OK</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="rowbtns">
      <button class="btn" id="rulesAdd">Add class</button>
      <button class="btn" id="rulesReset">Reset</button>
      <button class="btn" id="rulesExport">Export rules</button>
      <button class="btn" id="rulesImport">Import rules</button>
    </div>
    <p class="hint">Min wall is the closest a head may sit to a wall, so it can actually be installed; the layout never places one nearer than that. Do not use this table for sidewall heads, sloped ceilings, or anything else the standard treats separately.</p>`;
  document.getElementById("covModel").onchange=e=>{
    state.doc.coverage=e.target.value;
    page().rooms.forEach(r=>{ if(r.autoLayout!==false) regenerateHeads(r); });
    save(); syncPanels(); draw();
  };
  el.querySelectorAll("input[data-k]").forEach(inp=>{
    inp.addEventListener("change", e=>{
      const k=e.target.dataset.k, f=e.target.dataset.f;
      state.doc.rules[k][f] = f==="verified"? e.target.checked : (parseFloat(e.target.value)||0);
      page().rooms.forEach(r=>{ if(r.hazard===k && r.autoLayout!==false) regenerateHeads(r); });
      save(); syncPanels(); draw();
    });
  });
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.del;
    if(Object.keys(state.doc.rules).length<2){ toast("At least one hazard class has to stay."); return; }
    const used=[];
    for(const pg of Object.values(state.doc.pages)) for(const r of (pg.rooms||[])) if(r.hazard===k) used.push(r.name);
    if(used.length && !confirm(`${used.length} room(s) still use ${k}. Remove it anyway?`)) return;
    delete state.doc.rules[k];
    save(); syncPanels(); draw();
  });
  document.getElementById("rulesAdd").onclick=()=>{
    const code=(prompt("Short code for the class, e.g. OH5 or EHH")||"").trim();
    if(!code) return;
    if(state.doc.rules[code]){ toast("That class already exists."); return; }
    const label=(prompt("Full name for "+code, code)||code).trim();
    const palette=["#7fd4c1","#35b8a6","#e0b24a","#e0913a","#dd7238","#d45a38","#e4573d","#b06fd0","#6f8fd0"];
    state.doc.rules[code]={label, maxAreaPerHead:12, maxSpacing:4.0, minSpacing:2.0, maxWallDist:2.0, minWallDist:0.1,
      minWallDist:0.1, color:palette[Object.keys(state.doc.rules).length % palette.length], verified:false};
    save(); syncPanels(); draw();
  };
  document.getElementById("rulesReset").onclick=()=>{ state.doc.rules=structuredClone(DEFAULT_RULES); save(); syncPanels(); draw(); };
  document.getElementById("rulesExport").onclick=()=>download("sprinkler-rules.json", JSON.stringify(state.doc.rules,null,2), "application/json");
  document.getElementById("rulesImport").onclick=()=>{ pendingImport="rules"; document.getElementById("fileJson").click(); };
}

function renderOut(){
  const el=document.getElementById("paneOut"), p=page();
  const org=p.origin;
  el.innerHTML=`
    <h3 class="sec">Coordinate origin</h3>
    <div class="block">
      <div class="stat"><span>Origin</span><b>${org?`${org.x.toFixed(0)}, ${org.y.toFixed(0)} px`:"top left of page"}</b></div>
      <p class="hint">Click a grid intersection with the Origin tool and head coordinates are exported relative to it. Y increases upward.</p>
    </div>
    <h3 class="sec">Files</h3>
    <div class="block">
      <div class="rowbtns">
        <button class="btn" id="exRooms">Room schedule CSV</button>
        <button class="btn" id="exHeads">Head coordinates CSV</button>
        <button class="btn" id="exDev">Device schedule CSV</button>
      </div>
      <div class="rowbtns">
        <button class="btn primary" id="exPdf">Save marked-up PDF</button>
        <button class="btn" id="exJson2">Save work file</button>
      </div>
      <div class="rowbtns">
        <button class="btn" id="exMeas">Measurements CSV</button>
        <button class="btn" id="exPng">Markup PNG</button>
      </div>
    </div>
    <h3 class="sec">All pages</h3>
    <div class="block">
      ${Object.entries(state.doc.pages).map(([k,pg])=>`
        <div class="stat"><span>Page ${k}</span><b>${(pg.rooms||[]).length} rooms / ${(pg.heads||[]).length} heads / ${(pg.measures||[]).length} measurements ${pg.scale?"":"(no scale)"}</b></div>`).join("") || "<span style='color:var(--dim)'>No pages yet</span>"}
    </div>
    <p class="hint">The marked-up PDF keeps the original drawing as vectors and draws the rooms, heads, dimensions and measurements on top, so it stays sharp and printable. The work file carries the drawing inside it, so it reopens on its own. Nothing is kept between sessions — save before you close.</p>`;
  document.getElementById("exRooms").onclick=exportRoomsCsv;
  document.getElementById("exHeads").onclick=exportHeadsCsv;
  document.getElementById("exDev").onclick=exportDeviceCsv;
  document.getElementById("exMeas").onclick=exportMeasCsv;
  document.getElementById("exPng").onclick=exportPng;
  document.getElementById("exJson2").onclick=exportWork;
  document.getElementById("exPdf").onclick=exportPdf;
}