
/* ══════════════════════════════════════════════════════════════
   6. Pointer and keyboard
   ══════════════════════════════════════════════════════════════ */

const HIT = 10;
function headAt(sp){
  for(const h of page().heads){ const q=toScreen(h); if(Math.hypot(q.x-sp.x,q.y-sp.y)<=HIT) return h; }
  return null;
}
function roomAt(wp){
  const rs=page().rooms;
  for(let i=rs.length-1;i>=0;i--) if(pointInPoly(wp, rs[i].polygon)) return rs[i];
  return null;
}
function vertexAt(sp, room){
  for(let i=0;i<room.polygon.length;i++){ const q=toScreen(room.polygon[i]); if(Math.hypot(q.x-sp.x,q.y-sp.y)<=HIT) return i; }
  return -1;
}
const localPt = e => { const r=view.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; };

view.addEventListener("pointerdown", e=>{
  if(!state.pdfCanvas) return;
  const sp=localPt(e), wp=toWorld(sp);
  view.setPointerCapture(e.pointerId);

  if(state.mode==="pan" && e.button===0 && state.pdfCanvas && page().legend?.show!==false){
    const G=legendData();
    if(G.rows.length){
      const a=toScreen({x:G.x,y:G.y}), b=toScreen({x:G.x+G.w, y:G.y+G.h});
      if(sp.x>=a.x && sp.x<=b.x && sp.y>=a.y && sp.y<=b.y){
        state.drag={kind:"legend", dx:G.x-wp.x, dy:G.y-wp.y};
        return;
      }
    }
  }
  if(state.mode==="pan" && e.button===0){
    const hh = headAt(sp);
    if(hh){
      snapshot();
      state.selRoom=hh.roomId; state.selHead=hh.id;
      state.drag={kind:"head", head:hh, dx:hh.x-wp.x, dy:hh.y-wp.y};
      syncPanels(); draw(); return;
    }
    const r = roomAt(wp);
    if(r){ selectRoom(r.id); }
    else if(state.selHead){ state.selHead=null; syncPanels(); draw(); }
  }

  if(state.mode==="calibrate"){
    const cp = snapPoint(sp);
    if(!state.calib) state.calib={a:cp};
    else { state.calib.b = orthoSnap(cp, state.calib.a); openScaleDialog(); }
    draw(); return;
  }
  if(state.mode==="measure" && e.button===0){
    if(!state.mdraft){
      const hit = measureAt(sp);
      if(hit && e.altKey){ deleteMeasure(hit.id); return; }
      if(hit && !e.shiftKey){ state.selMeasure=hit.id; updateLenCell(); syncPanels(); draw(); return; }
    }
    const wp2 = snapPoint(sp);
    if(!state.mdraft){ state.mdraft=[wp2]; state.selMeasure=null; }
    else{
      const last = state.mdraft[state.mdraft.length-1];
      state.mdraft.push(orthoSnap(wp2, last));
      if(!state.chain && state.mdraft.length>=2) finishMeasure();
    }
    updateLenCell(); draw(); return;
  }
  if(state.mode==="fill" && e.button===0){
    const erase = e.ctrlKey || e.metaKey;
    const paint = !erase && e.shiftKey;
    const brush = erase? "erase" : paint? "paint" : "grow";
    if(!FILL.on){
      if(erase){ toast("Nothing filled yet."); return; }
      toast("Reading the page…");
      // the first mask build blocks for a moment; let the toast paint first
      setTimeout(()=>{
        fillBegin(); strokeBegin(brush);
        FILL.pressed=true; FILL.last=wp;
        if(paint){ fillPaintDisc(wp.x,wp.y); draw(); fillBar(true); }
        else { fillSeed(wp.x,wp.y); if(!FILL.raf) fillTick(); }
      }, 20);
    }else{
      strokeBegin(brush);
      FILL.pressed=true; FILL.last=wp;
      if(erase){ fillEraseDisc(wp.x, wp.y); draw(); fillBar(true); }
      else if(paint){ fillPaintDisc(wp.x, wp.y); draw(); fillBar(true); }
      else { fillSeed(wp.x,wp.y); if(!FILL.raf) fillTick(); }
    }
    return;
  }
  if(state.mode==="tile"){
    if(e.button!==0) return;
    const room = page().rooms.find(r=>r.id===state.selRoom) || roomAt(wp);
    if(!room){ toast("Select a room first, then click a tile corner inside it."); return; }
    const mm=mmPerPx();
    if(!mm){ toast("Set the scale first."); return; }
    snapshot();
    state.selRoom=room.id;
    room.ceiling="tile"; room.tileSnap=true; state.lastCeiling="tile";
    const M = room.tileManual || (room.tileManual={pu:600, pv:1200, ou:0, ov:0});
    const q = snapPoint(sp);
    const r = rotTo(q, roomAngle(room));
    M.ou = ((r.x*mm % M.pu) + M.pu) % M.pu;
    M.ov = ((r.y*mm % M.pv) + M.pv) % M.pv;
    TILE_CACHE.delete(room.id);
    regenerateHeads(room);
    setMode("pan"); setTab("props"); syncPanels(); draw();
    const hs=page().heads.filter(h=>h.roomId===room.id && isSprinkler(h));
    toast(`Tile grid set: ${M.pu} × ${M.pv} mm. ${hs.filter(h=>h.tile).length} of ${hs.length} heads on a tile point.`);
    return;
  }
  if(state.mode==="origin"){
    page().origin = snapPoint(sp); save(); draw(); syncPanels();
    toast("Coordinate origin set."); return;
  }
  if(state.mode==="room"){
    if(e.button!==0) return;
    if(!state.draft) state.draft=[];
    const first=state.draft[0];
    if(first && state.draft.length>=3){
      const fq=toScreen(first);
      if(Math.hypot(fq.x-sp.x, fq.y-sp.y)<=HIT){ finishRoom(); return; }
    }
    const rp = snapPoint(sp);
    const prev = state.draft[state.draft.length-1];
    state.draft.push(prev? orthoSnap(rp,prev) : rp);
    draw(); return;
  }
  if(state.mode==="vertex" && state.selRoom){
    const room=page().rooms.find(r=>r.id===state.selRoom);
    if(room){
      const vi=vertexAt(sp, room);
      if(vi>=0){ snapshot(); state.drag={kind:"vertex", room, vi}; return; }
    }
  }
  if(state.mode==="head"){
    const h=headAt(sp);
    if(h){
      if(e.altKey){ removeHead(h); return; }
      snapshot();
      state.selHead=h.id; state.drag={kind:"head", head:h, dx:h.x-wp.x, dy:h.y-wp.y};
      syncPanels(); draw(); return;
    }
    const r=roomAt(wp);
    if(r){
      snapshot();
      const nh={id:uid("h_"), roomId:r.id, x:wp.x, y:wp.y, type:r.headType||"pend", auto:false, locked:true};
      page().heads.push(nh); state.selHead=nh.id; state.selRoom=r.id;
      save(); syncPanels(); draw(); return;
    }
    // clicking outside a room just pans
  }
  if(state.mode==="obst" && e.button===0){
    if(e.altKey){
      const o=[...page().obstacles].reverse().find(o=>pointInPoly(wp, o.polygon));
      if(o){ snapshot(); removeObstacle(o); }
      return;
    }
    state.drag={kind:"obst", a:wp, b:wp, sp};
    return;
  }
  // default: pan
  state.drag={kind:"pan", sx:sp.x, sy:sp.y, tx:state.view.tx, ty:state.view.ty};
  view.classList.add("panning");
});

view.addEventListener("pointermove", e=>{
  const sp=localPt(e); state.cursor=sp;
  const wp=toWorld(sp), mm=mmPerPx();
  const org=page().origin;
  const ox = org?org.x:0, oy = org?org.y:0;
  document.getElementById("stCursor").textContent = mm
    ? `${((wp.x-ox)*mm).toFixed(0)}, ${((oy-wp.y)*mm).toFixed(0)} mm`
    : `${wp.x.toFixed(0)}, ${wp.y.toFixed(0)} px`;

  if(FILL.on && FILL.pressed && state.mode==="fill"){
    if(FILL.brush==="erase") fillErasePath(FILL.last||wp, wp);
    else if(FILL.brush==="paint") fillPaintPath(FILL.last||wp, wp);
    else fillSeedPath(FILL.last||wp, wp);
    FILL.last=wp;
  }
  if(FILL.on && state.mode==="fill" && !FILL.pressed) draw();
  if(!state.drag && (state.mode==="measure"||state.mode==="room"||state.mode==="calibrate"||state.mode==="origin")) snapPoint(sp);

  const d=state.drag;
  if(d){
    if(d.kind==="pan"){ state.view.tx=d.tx+(sp.x-d.sx); state.view.ty=d.ty+(sp.y-d.sy); }
    else if(d.kind==="vertex"){ d.room.polygon[d.vi]={x:wp.x,y:wp.y}; }
    else if(d.kind==="head"){ d.head.x=wp.x+d.dx; d.head.y=wp.y+d.dy; d.head.auto=false; d.head.locked=true; }
    else if(d.kind==="legend"){ const L=page().legend; L.x=wp.x+d.dx; L.y=wp.y+d.dy; }
    else if(d.kind==="obst"){ d.b=wp; }
  }
  if(state.mdraft) updateLenCell();
  if(d || state.draft || state.calib || state.mdraft || state.snapHit) draw();
});

view.addEventListener("pointerup", ()=>{
  if(FILL.on){ FILL.pressed=false; FILL.last=null; strokeEnd(); }
  const d=state.drag;
  if(d && (d.kind==="vertex")){ regenerateHeads(d.room); syncPanels(); }
  if(d && d.kind==="head"){ save(); syncPanels(); }
  if(d && d.kind==="legend") save();
  if(d && d.kind==="obst") finishObstacle(d);
  state.drag=null; view.classList.remove("panning"); draw(); scheduleDetail();
});

view.addEventListener("dblclick", ()=>{
  if(state.mode==="room" && state.draft && state.draft.length>=3) finishRoom();
  if(state.mode==="measure") finishMeasure();
});
view.addEventListener("contextmenu", e=>{
  e.preventDefault();
  if(state.mode==="room" && state.draft && state.draft.length>=3) finishRoom();
  if(state.mode==="measure") finishMeasure();
});

view.addEventListener("wheel", e=>{
  e.preventDefault();
  const sp=localPt(e), before=toWorld(sp);
  const f = Math.exp(-e.deltaY*0.0015);
  state.view.zoom = Math.max(0.05, Math.min(14, state.view.zoom*f));
  const after=toWorld(sp);
  state.view.tx += (after.x-before.x)*state.view.zoom;
  state.view.ty += (after.y-before.y)*state.view.zoom;
  draw(); scheduleDetail();
},{passive:false});

let ctrlHeld=false;
document.addEventListener("keydown", e=>{ if(e.key==="Control"||e.key==="Meta"){ctrlHeld=true; if(FILL.on) draw();} });
document.addEventListener("keyup",   e=>{ if(e.key==="Control"||e.key==="Meta"){ctrlHeld=false; if(FILL.on) draw();} });
window.addEventListener("blur", ()=>{ ctrlHeld=false; shiftHeld=false; });

document.addEventListener("keydown", e=>{
  if(/input|select|textarea/i.test(e.target.tagName)) return;
  const k=e.key.toLowerCase();
  if(ASK){
    if(k==="t"){ e.preventDefault(); ASK.pick("tile"); return; }
    if(k==="g"){ e.preventDefault(); ASK.pick("gib"); return; }
    if(k==="enter"){ e.preventDefault(); ASK.pick(ASK.last); return; }
    if(k==="escape"){ e.preventDefault(); ASK.cancel(); return; }
    return;
  }
  if(FILL.on && !e.ctrlKey && !e.metaKey){
    if(k==="t"){ e.preventDefault(); fillApply("tile"); return; }
    if(k==="g"){ e.preventDefault(); fillApply("gib"); return; }
  }
  if((e.ctrlKey||e.metaKey) && k==="z"){
    e.preventDefault();
    if(FILL.on) fillUndoStroke(); else undoDoc();
    return;
  }
  if(k==="escape"){ state.draft=null; state.calib=null; state.mdraft=null; if(FILL.on) fillCancel(); updateLenCell(); draw(); }
  else if(k==="enter" && FILL.on) fillApply(state.lastCeiling||"tile");
  else if(k==="enter" && state.mode==="room" && state.draft && state.draft.length>=3) finishRoom();
  else if(k==="enter" && state.mode==="measure") finishMeasure();
  else if(k==="delete"||k==="backspace"){
    if(state.selMeasure && state.mode==="measure"){ deleteMeasure(state.selMeasure); }
    else if(state.selHead){ const h=page().heads.find(x=>x.id===state.selHead); if(h) removeHead(h); }
    else if(state.selRoom) deleteRoom(state.selRoom);
  }
  else if(k==="v") setMode("pan");
  else if(k==="s") setMode("calibrate");
  else if(k==="l") setMode("measure");
  else if(k==="r") setMode("room");
  else if(k==="f") setMode("fill");
  else if(k==="e") setMode("vertex");
  else if(k==="h") setMode("head");
  else if(k==="o") setMode("origin");
  else if(k==="t") setMode("tile");
  else if(k==="b") setMode("obst");
  else if(k==="0") fitView();
  else if(e.key==="PageUp"){ e.preventDefault(); gotoPage(state.pageNum-1); }
  else if(e.key==="PageDown"){ e.preventDefault(); gotoPage(state.pageNum+1); }
  else if(k==="c") setCoverageView(!state.showCov);
});