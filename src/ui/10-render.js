
/* ══════════════════════════════════════════════════════════════
   5. Loading and rendering the PDF
   ══════════════════════════════════════════════════════════════ */

const view = document.getElementById("view");
const ctx  = view.getContext("2d");
const stage= document.getElementById("stage");

async function loadPdf(bytes, name){
  state.pdfBytes = bytes.slice(0);
  state.pdf = await pdfjsLib.getDocument({data:bytes.slice(0)}).promise;
  state.pageCount = state.pdf.numPages;
  state.fileName = name || "drawing.pdf";
  state.doc.name = state.fileName;
  state.pageNum = 1;
  document.getElementById("docname").textContent = state.fileName;
  document.getElementById("drop").style.display="none";
  await renderPage();
  fitView();
  state.dirty=false;
  toast("Drawing open. Set the scale to start measuring.");
}

async function renderPage(){
  state.rendering = true;
  const pg = await state.pdf.getPage(state.pageNum);
  const base = pg.getViewport({scale:1});
  const target = 3400;                                  // render resolution across the long edge
  const s = Math.min(6, target / Math.max(base.width, base.height));
  state.renderScale = s;
  const vp = pg.getViewport({scale:s});
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await pg.render({canvasContext:c.getContext("2d"), viewport:vp}).promise;
  if(FILL.on) fillCancel(false);
  detailInvalidate();
  MASK.key=null;
  state.pdfCanvas = c;
  state.pageSizePt = {w:base.width, h:base.height};
  state.selRoom = state.selHead = state.selMeasure = null;
  state.draft = state.mdraft = null; state.calib=null;

  extractVectors(pg, vp);                       // runs in the background
  state.rendering = false;
  state.detected = await detectScales(pg);
  const pgRec = page();
  if(!pgRec.scale){
    const sheet = sheetName(base.width*PT2MM, base.height*PT2MM);
    const res = resolvedScales();
    if(!res.length){
      if(sheet) toast(`No scale printed on this ${sheet} sheet that I can read. Set it under Scale in the status bar.`);
    }else if(!sheet){
      toast(`Found 1:${res[0].eff} on the drawing, but this sheet is ${(base.width*PT2MM).toFixed(0)} × ${(base.height*PT2MM).toFixed(0)} mm, not a standard size. Confirm it under Scale before relying on it.`);
    }else if(res.length===1){
      const d = res[0];
      applyRatio(d.eff, false);
      const converted = d.sheet && d.sheet!==sheet;
      pgRec.scaleSource = converted
        ? `1:${d.ratio} stated for ${d.sheet}, converted to 1:${d.eff} on this ${sheet} sheet`
        : `1:${d.eff} (read from the drawing)`;
      toast(converted
        ? `The drawing says 1:${d.ratio} at ${d.sheet}, but this sheet is ${sheet}, so the scale is set to 1:${d.eff}. Check it against a known dimension.`
        : `Found 1:${d.eff} on this ${sheet} sheet and set the scale. Check it against a known dimension.`);
      setMode("measure");
    }else{
      toast(`This ${sheet} sheet lists ${res.length} scales (${res.map(d=>"1:"+d.eff).join(", ")}). Pick one under Scale in the status bar.`);
    }
  }
  syncPanels(); draw();
}

/* The page is rasterised once at a fixed width, which is plenty for an
   overview but goes soft past 1:1. So whenever the view settles while
   zoomed in, re-render just the visible rectangle straight from the PDF at
   the screen's own resolution and draw that instead. Annotation
   coordinates never move: they stay in base render pixels throughout. */
const DETAIL = {canvas:null, x0:0, y0:0, w:0, h:0, f:0, page:0, task:null, timer:0, busy:false};
const DETAIL_MAX_PX = 36e6;

function detailInvalidate(){
  if(DETAIL.task){ try{ DETAIL.task.cancel(); }catch(e){} DETAIL.task=null; }
  clearTimeout(DETAIL.timer);
  DETAIL.canvas=null; DETAIL.f=0; DETAIL.busy=false;
  const el=document.getElementById("stSharp"); if(el) el.textContent="";
}
function detailCovers(){
  if(!DETAIL.canvas || DETAIL.page!==state.pageNum) return false;
  const v=state.view, w=stage.clientWidth, h=stage.clientHeight;
  const a=toWorld({x:0,y:0}), b=toWorld({x:w,y:h});
  return a.x>=DETAIL.x0-0.5 && a.y>=DETAIL.y0-0.5 &&
         b.x<=DETAIL.x0+DETAIL.w+0.5 && b.y<=DETAIL.y0+DETAIL.h+0.5 &&
         DETAIL.f >= v.zoom*(window.devicePixelRatio||1)*0.92;
}
function scheduleDetail(){
  if(!state.pdf || !state.pdfCanvas) return;
  clearTimeout(DETAIL.timer);
  DETAIL.timer = setTimeout(renderDetail, 180);
}
async function renderDetail(){
  if(!state.pdf || !state.pdfCanvas || DETAIL.busy || state.rendering) return;
  const dpr = window.devicePixelRatio||1;
  const v = state.view;
  let f = v.zoom*dpr;
  if(f <= 1.02){ detailInvalidate(); draw(); return; }      // base raster is already sharper
  if(detailCovers()) return;

  const vw=stage.clientWidth, vh=stage.clientHeight;
  const a=toWorld({x:0,y:0}), b=toWorld({x:vw,y:vh});
  const marginX=(b.x-a.x)*0.18, marginY=(b.y-a.y)*0.18;
  let x0=Math.max(0, a.x-marginX), y0=Math.max(0, a.y-marginY);
  let x1=Math.min(state.pdfCanvas.width,  b.x+marginX);
  let y1=Math.min(state.pdfCanvas.height, b.y+marginY);
  let w=x1-x0, h=y1-y0;
  if(w<=1 || h<=1) return;
  f = Math.min(f, 10);
  while(w*f*h*f > DETAIL_MAX_PX) f *= 0.8;                  // keep the canvas sane
  if(f <= 1.02){ detailInvalidate(); return; }

  DETAIL.busy=true;
  const el=document.getElementById("stSharp"); if(el) el.textContent="sharpening…";
  try{
    const pg = await state.pdf.getPage(state.pageNum);
    const vp = pg.getViewport({scale: state.renderScale*f, offsetX: -x0*f, offsetY: -y0*f});
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w*f));
    c.height = Math.max(1, Math.round(h*f));
    const task = pg.render({canvasContext:c.getContext("2d"), viewport:vp});
    DETAIL.task = task;
    await task.promise;
    DETAIL.task=null;
    DETAIL.canvas=c; DETAIL.x0=x0; DETAIL.y0=y0; DETAIL.w=w; DETAIL.h=h; DETAIL.f=f;
    DETAIL.page=state.pageNum;
  }catch(err){
    if(!/cancel/i.test(err?.message||"")) DETAIL.canvas=null;
  }
  DETAIL.busy=false;
  if(el) el.textContent="";
  draw();
  if(!detailCovers()) scheduleDetail();                     // the view moved while rendering
}

function resize(){
  const dpr = window.devicePixelRatio||1;
  view.width  = Math.round(stage.clientWidth*dpr);
  view.height = Math.round(stage.clientHeight*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  draw(); scheduleDetail();
}
new ResizeObserver(resize).observe(stage);

function fitView(){
  if(!state.pdfCanvas) return;
  const w=stage.clientWidth, h=stage.clientHeight;
  const z=Math.min(w/state.pdfCanvas.width, h/state.pdfCanvas.height)*0.96;
  state.view={zoom:z, tx:(w-state.pdfCanvas.width*z)/2, ty:(h-state.pdfCanvas.height*z)/2};
  draw(); scheduleDetail();
}
const toScreen = p => ({x:p.x*state.view.zoom+state.view.tx, y:p.y*state.view.zoom+state.view.ty});
const toWorld  = p => ({x:(p.x-state.view.tx)/state.view.zoom, y:(p.y-state.view.ty)/state.view.zoom});

/* ── canvas ── */
function draw(){
  const dpr=window.devicePixelRatio||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,view.width,view.height);
  if(!state.pdfCanvas) return;
  const v=state.view;

  ctx.save();
  ctx.setTransform(dpr*v.zoom,0,0,dpr*v.zoom, dpr*v.tx, dpr*v.ty);
  ctx.imageSmoothingEnabled=true;
  if(detailCovers()){
    ctx.drawImage(DETAIL.canvas, DETAIL.x0, DETAIL.y0, DETAIL.w, DETAIL.h);
  }else{
    ctx.drawImage(state.pdfCanvas,0,0);
  }
  if(FILL.on && FILL.cvs) ctx.drawImage(FILL.cvs,0,0);
  ctx.restore();
  if(FILL.on && state.mode==="fill" && (ctrlHeld||shiftHeld) && state.cursor){
    const R=MASK.brushPx, col = ctrlHeld? "#e4573d" : "#46cd82", lbl = ctrlHeld? "erase" : "paint";
    ctx.save();
    ctx.strokeStyle=col; ctx.lineWidth=1.6; ctx.setLineDash([4,3]);
    ctx.beginPath();
    if(MASK.brush==="round") ctx.arc(state.cursor.x, state.cursor.y, R, 0, 7);
    else ctx.rect(state.cursor.x-R, state.cursor.y-R, R*2, R*2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font="500 11px 'IBM Plex Sans', sans-serif"; ctx.fillStyle=col;
    ctx.fillText(lbl, state.cursor.x+R+4, state.cursor.y-R+2);
    ctx.restore();
  }

  const p=page(), mm=p.scale;

  // rooms
  for(const room of p.rooms){
    const sel = state.selRoom===room.id;
    const pts = room.polygon.map(toScreen);
    ctx.beginPath(); pts.forEach((q,i)=> i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)); ctx.closePath();
    const rc = hazColor(room);
    ctx.fillStyle = sel? "rgba(217,164,65,.16)" : rc+"22";
    ctx.fill();
    ctx.lineWidth = sel?2.4:1.6;
    ctx.strokeStyle = sel? "#d9a441" : rc;
    ctx.stroke();

    if(state.mode==="vertex" && sel){
      for(const q of pts){ ctx.beginPath(); ctx.rect(q.x-4,q.y-4,8,8); ctx.fillStyle="#14171a"; ctx.fill(); ctx.strokeStyle="#d9a441"; ctx.lineWidth=1.6; ctx.stroke(); }
    }
    // label: name, area, and a colour-coded hazard chip
    const cx=pts.reduce((a,q)=>a+q.x,0)/pts.length, cy=pts.reduce((a,q)=>a+q.y,0)/pts.length;
    const area = mm? (polyArea(room.polygon)*mm*mm/1e6) : null;
    const line1 = room.name || "Unnamed";
    const areaTxt = area!==null? area.toFixed(1)+" m²" : "no scale";
    const haz = room.hazard;
    const col = hazColor(room);
    ctx.font="600 12.5px 'IBM Plex Sans', sans-serif";
    const w1=ctx.measureText(line1).width;
    ctx.font="500 11px 'IBM Plex Mono', monospace";
    const wA=ctx.measureText(areaTxt).width;
    ctx.font="600 11px 'IBM Plex Mono', monospace";
    const wH=ctx.measureText(haz).width;
    const chipW = wH+12;
    const row2 = wA + 8 + chipW;
    const bw=Math.max(w1,row2)+16, bh=38;
    ctx.fillStyle="rgba(20,23,26,.88)"; ctx.strokeStyle=sel?"#d9a441":col; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.rect(cx-bw/2, cy-bh/2, bw, bh); ctx.fill(); ctx.stroke();
    ctx.textBaseline="middle";
    ctx.textAlign="center";
    ctx.fillStyle="#e4e8ec"; ctx.font="600 12.5px 'IBM Plex Sans', sans-serif";
    ctx.fillText(line1, cx, cy-9);
    const rx = cx-row2/2;
    ctx.textAlign="left";
    ctx.fillStyle="#8c97a3"; ctx.font="500 11px 'IBM Plex Mono', monospace";
    ctx.fillText(areaTxt, rx, cy+10);
    ctx.fillStyle=col;
    ctx.beginPath(); ctx.rect(rx+wA+8, cy+2, chipW, 16); ctx.fill();
    ctx.fillStyle="#14171a"; ctx.font="600 11px 'IBM Plex Mono', monospace";
    ctx.textAlign="center";
    ctx.fillText(haz, rx+wA+8+chipW/2, cy+10);
    ctx.textAlign="start"; ctx.textBaseline="alphabetic";
  }

  // polygon being drawn
  if(state.draft && state.draft.length){
    const pts=state.draft.map(toScreen);
    ctx.beginPath(); pts.forEach((q,i)=> i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));
    if(state.cursor){ const c = state.snapHit? toScreen(state.snapHit) : state.cursor; ctx.lineTo(c.x, c.y); }
    ctx.strokeStyle="#d9a441"; ctx.lineWidth=1.8; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
    for(const q of pts){ ctx.beginPath(); ctx.arc(q.x,q.y,3.5,0,7); ctx.fillStyle="#d9a441"; ctx.fill(); }
  }

  // measurements
  for(const ms of p.measures) drawMeasure(ms.pts, state.selMeasure===ms.id, false, ms.id);
  if(state.mdraft && state.mdraft.length){
    const pts=[...state.mdraft];
    if(state.cursor) pts.push(orthoSnap(state.snapHit || toWorld(state.cursor), pts[pts.length-1]));
    if(pts.length>=2) drawMeasure(pts, true, true, null);
    else { const q=toScreen(pts[0]); ctx.beginPath(); ctx.arc(q.x,q.y,4,0,7); ctx.fillStyle="#7b9cff"; ctx.fill(); }
  }

  // tiles with a fitting, in the selected room, or everywhere while marking
  if(mm){
    const marking = state.mode==="obst";
    for(const room of p.rooms){
      if(!(marking || state.selRoom===room.id)) continue;
      const o=tileOccupancy(room); if(!o || !o.taken.size) continue;
      ctx.save();
      ctx.fillStyle="rgba(230,140,40,.22)"; ctx.strokeStyle="rgba(230,140,40,.7)"; ctx.lineWidth=1;
      const shade = poly => { const q=poly.map(toScreen);
        ctx.beginPath(); q.forEach((s,i)=> i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y)); ctx.closePath();
        ctx.fill(); ctx.stroke(); };
      const c = OBST.fitClearMm/mm;
      for(const key of o.taken){
        const b=o.boxes.get(key);
        if(o.whole.has(key) || !b){ shade(tileCellPoly(o.t, key)); continue; }
        // just the fitting and the ground around it a head keeps off
        for(const r of b) shade([[r.u0-c,r.v0-c],[r.u1+c,r.v0-c],[r.u1+c,r.v1+c],[r.u0-c,r.v1+c]]
          .map(([x,y])=>rotFrom({x,y}, o.t.ang)));
      }
      ctx.restore();
    }
  }

  // marked obstructions, with the clearance heads keep from them
  if(p.obstacles.length || (state.drag && state.drag.kind==="obst")){
    ctx.save();
    const clear = mm ? obstacleClearMm()/mm*v.zoom : 0;
    const boxes = p.obstacles.map(o=>o.polygon);
    if(state.drag && state.drag.kind==="obst") boxes.push(obstRect(state.drag.a, state.drag.b));
    for(const poly of boxes){
      const q=poly.map(toScreen);
      const path=()=>{ ctx.beginPath(); q.forEach((s,i)=> i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y)); ctx.closePath(); };
      if(clear>0){ path(); ctx.lineJoin="round"; ctx.lineWidth=clear*2; ctx.strokeStyle="rgba(192,90,192,.10)"; ctx.stroke(); }
      path(); ctx.fillStyle="rgba(192,90,192,.22)"; ctx.fill();
      ctx.lineWidth=1.4; ctx.strokeStyle="#c05ac0"; ctx.setLineDash([5,3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(q[0].x,q[0].y); ctx.lineTo(q[2].x,q[2].y); ctx.moveTo(q[1].x,q[1].y); ctx.lineTo(q[3].x,q[3].y);
      ctx.lineWidth=1; ctx.stroke();
    }
    ctx.restore();
  }

  // heads
  const violating = new Set();
  for(const room of p.rooms){
    const a = ANALYSIS.get(room.id);
    if(a && a.flags.length) p.heads.filter(h=>h.roomId===room.id).forEach(h=>violating.add(h.id));
  }
  for(const h of p.heads){
    const q=toScreen(h);
    const r = 8;
    const bad = violating.has(h.id);
    const d = devOf(h.type);
    const sel = state.selHead===h.id;
    drawDeviceSymbol(ctx, q.x, q.y, r, d, {
      lw: sel?2.6:1.7,
      color: sel? "#ffffff" : (bad? "#e4573d" : (d.color||"#d9a441")),
      bg: "rgba(20,23,26,.55)",
      letterColor: sel? "#ffffff" : "#7b9cff"
    });
    if(!h.auto){ ctx.beginPath(); ctx.arc(q.x,q.y,r+3.5,0,7); ctx.strokeStyle="rgba(255,255,255,.6)"; ctx.lineWidth=1; ctx.stroke(); }
  }

  // legend
  if(p.legend?.show!==false && state.pdfCanvas){
    const G=legendData();
    if(G.rows.length){
      G.ox=v.tx; G.oy=v.ty;
      drawLegendOn(ctx, G, v.zoom, {bg:"#ffffff", line:"#333a42", text:"#14171a", headBg:"#e6e9ec", letter:"#2f6fd0"});
    }
  }

  // coverage of every head at once
  if(state.showCov && mm){
    ctx.save();
    const model = covModel();
    for(const room of p.rooms){
      const r = ruleFor(room);
      const half = r.maxSpacing*1000/mm/2 * v.zoom;
      const ang = roomFrame(room).ang;
      const hs = p.heads.filter(h=>h.roomId===room.id && isSprinkler(h));
      if(!hs.length) continue;
      // filled first, so the union reads as one covered blanket
      ctx.fillStyle="rgba(217,164,65,.13)";
      for(const h of hs){
        const q=toScreen(h);
        ctx.beginPath();
        if(model==="circle") ctx.arc(q.x,q.y,half*Math.SQRT2,0,7);
        else{ ctx.save(); ctx.translate(q.x,q.y); ctx.rotate(ang); ctx.rect(-half,-half,half*2,half*2); ctx.restore(); }
        ctx.fill();
      }
      ctx.strokeStyle="rgba(217,164,65,.55)"; ctx.lineWidth=1;
      for(const h of hs){
        const q=toScreen(h);
        ctx.beginPath();
        if(model==="circle") ctx.arc(q.x,q.y,half*Math.SQRT2,0,7);
        else{ ctx.save(); ctx.translate(q.x,q.y); ctx.rotate(ang); ctx.rect(-half,-half,half*2,half*2); ctx.restore(); }
        ctx.stroke();
      }
      // the reach circle, always drawn, so the shape is obvious either way
      if(model!=="circle"){
        ctx.strokeStyle="rgba(217,164,65,.28)"; ctx.setLineDash([4,4]);
        for(const h of hs){ const q=toScreen(h); ctx.beginPath(); ctx.arc(q.x,q.y,half*Math.SQRT2,0,7); ctx.stroke(); }
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // review: everything the heads do not reach, in red
  if(state.review && mm){
    ctx.save();
    for(const room of p.rooms){
      const a=ANALYSIS.get(room.id); if(!a || !a.gaps) continue;
      const sz=Math.max(2, a.sampleStep*v.zoom);
      ctx.fillStyle="rgba(228,87,61,.45)";
      for(const g of a.gaps) for(const q of g.pts){ const t=toScreen(q); ctx.fillRect(t.x-sz/2, t.y-sz/2, sz, sz); }
      a.gaps.forEach((g,i)=>{
        const t=toScreen(g);
        ctx.fillStyle="#e4573d"; ctx.beginPath(); ctx.arc(t.x,t.y,9,0,7); ctx.fill();
        ctx.fillStyle="#fff"; ctx.font="600 11px 'IBM Plex Mono', monospace"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(i+1), t.x, t.y);
      });
      // heads too close to a wall, or on a fitting
      for(const id of [...(a.tightHeads||[]), ...(a.blockedHeads||[])]){
        const h=p.heads.find(x=>x.id===id); if(!h) continue;
        const t=toScreen(h); ctx.strokeStyle="#e4573d"; ctx.lineWidth=2; ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.arc(t.x,t.y,13,0,7); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.textAlign="start"; ctx.textBaseline="alphabetic";
    ctx.restore();
  }

  // the ceiling grid that heads are being snapped to
  if(state.selRoom && mm){
    const room=p.rooms.find(r=>r.id===state.selRoom);
    const t=room && isTiled(room) ? detectTiles(room) : null;
    if(t){
      const xs=room.polygon.map(q=>rotTo(q,t.ang).x), ys=room.polygon.map(q=>rotTo(q,t.ang).y);
      const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
      ctx.save();
      ctx.strokeStyle="rgba(123,156,255,.45)"; ctx.lineWidth=1; ctx.setLineDash([3,4]);
      for(let k=Math.ceil((x0-t.u.origin)/t.u.P); (t.u.origin+k*t.u.P)<=x1; k++){
        const u=t.u.origin+k*t.u.P;
        const a=toScreen(rotFrom({x:u,y:y0},t.ang)), b=toScreen(rotFrom({x:u,y:y1},t.ang));
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
      for(let k=Math.ceil((y0-t.v.origin)/t.v.P); (t.v.origin+k*t.v.P)<=y1; k++){
        const v2=t.v.origin+k*t.v.P;
        const a=toScreen(rotFrom({x:x0,y:v2},t.ang)), b=toScreen(rotFrom({x:x1,y:v2},t.ang));
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // head position dimensions
  if(state.dims!=="off"){
    for(const room of p.rooms){
      if(!(state.dims==="all" || state.selRoom===room.id)) continue;
      for(const h of p.heads) if(h.roomId===room.id && h.id!==state.selHead && isSprinkler(h)) drawHeadDims(h, room, false);
    }
  }
  if(state.selHead){
    const h=p.heads.find(x=>x.id===state.selHead);
    const room=h && p.rooms.find(r=>r.id===h.roomId);
    if(h && room){ drawHeadCoverage(h, room); drawHeadDims(h, room, true); }
  }

  // two-point scale in progress
  if(state.calib){
    const a=toScreen(state.calib.a);
    const b=state.calib.b? toScreen(state.calib.b) : state.cursor;
    if(b){
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle="#7b9cff"; ctx.lineWidth=2; ctx.stroke();
      for(const q of [a,b]){ ctx.beginPath(); ctx.arc(q.x,q.y,4,0,7); ctx.fillStyle="#7b9cff"; ctx.fill(); }
    }
  }

  // coordinate origin
  if(p.origin){
    const o=toScreen(p.origin);
    ctx.strokeStyle="#7b9cff"; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(o.x-12,o.y); ctx.lineTo(o.x+12,o.y); ctx.moveTo(o.x,o.y-12); ctx.lineTo(o.x,o.y+12); ctx.stroke();
    ctx.beginPath(); ctx.arc(o.x,o.y,5,0,7); ctx.stroke();
  }

  if(state.mode==="measure"||state.mode==="room"||state.mode==="calibrate"||state.mode==="origin") drawSnapMarker();

  document.getElementById("stZoom").textContent = Math.round(v.zoom*100)+"%";
}

function drawHeadDims(h, room, emphasis){
  const dims = headWallDims(h, room);
  const mm = mmPerPx();
  const hs = toScreen(h);
  ctx.save();
  ctx.font="500 11px 'IBM Plex Mono', monospace";
  ctx.textAlign="center"; ctx.textBaseline="middle";
  for(const d of dims){
    const e = toScreen(d.hit);
    const len = Math.hypot(e.x-hs.x, e.y-hs.y);
    if(len < 14) continue;
    const col = d.isHead ? (emphasis? "#ffd9a0" : "rgba(217,164,65,.8)")
                         : (emphasis? "#c3d2f5" : "rgba(157,180,232,.75)");
    ctx.strokeStyle = col;
    ctx.lineWidth = emphasis? 1.6 : 1.1;
    ctx.setLineDash(emphasis? [] : [5,4]);
    ctx.beginPath(); ctx.moveTo(hs.x,hs.y); ctx.lineTo(e.x,e.y); ctx.stroke();
    ctx.setLineDash([]);
    const tA=Math.atan2(e.y-hs.y, e.x-hs.x)+Math.PI/2;
    if(!d.isHead){                                  // tick only where it lands on a wall
      ctx.beginPath();
      ctx.moveTo(e.x+Math.cos(tA)*6, e.y+Math.sin(tA)*6);
      ctx.lineTo(e.x-Math.cos(tA)*6, e.y-Math.sin(tA)*6);
      ctx.stroke();
    }
    // figure
    const txt = mm ? String(Math.round(d.t*mm)) : Math.round(d.t)+"px";
    const w = ctx.measureText(txt).width+8;
    if(len < w+10) continue;
    const mx=(hs.x+e.x)/2, my=(hs.y+e.y)/2;
    ctx.fillStyle="rgba(20,23,26,.9)";
    ctx.fillRect(mx-w/2, my-8, w, 16);
    ctx.fillStyle = d.isHead ? (emphasis? "#ffe7b8" : "#e0c489")
                             : (emphasis? "#e6eeff" : "#c3d2f5");
    ctx.fillText(txt, mx, my);
  }
  ctx.textAlign="start"; ctx.textBaseline="alphabetic";
  ctx.restore();
}

/* Coverage of the selected head: the S×S square the rules assume, and
   the corner-rule circle used by the checks. */
function drawHeadCoverage(h, room){
  const mm = mmPerPx(); if(!mm) return;
  const r = ruleFor(room);
  const S = r.maxSpacing*1000/mm;                 // px
  const R = S/2*Math.SQRT2;
  const ang = roomAngle(room);
  const hs = toScreen(h), z=state.view.zoom;
  ctx.save();
  ctx.beginPath(); ctx.arc(hs.x,hs.y,R*z,0,7);
  ctx.fillStyle="rgba(217,164,65,.10)"; ctx.fill();
  ctx.strokeStyle="rgba(217,164,65,.8)"; ctx.lineWidth=1.4; ctx.stroke();
  ctx.translate(hs.x,hs.y); ctx.rotate(ang);
  ctx.setLineDash([6,4]); ctx.strokeStyle="rgba(217,164,65,.55)"; ctx.lineWidth=1;
  ctx.strokeRect(-S/2*z, -S/2*z, S*z, S*z);
  ctx.setLineDash([]);
  ctx.rotate(-ang);
  ctx.font="500 11px 'IBM Plex Sans', sans-serif"; ctx.fillStyle="#ffd9a0";
  ctx.textAlign="center";
  ctx.fillText(`${r.maxSpacing} × ${r.maxSpacing} m · r ${(r.maxSpacing/2*Math.SQRT2).toFixed(2)} m`, 0, R*z+14);
  ctx.restore();
}

/* Legend geometry in page (render pixel) units, so what you see is what
   the PDF gets. Counts come from whatever is actually on the page. */
function legendUnit(){
  const c=state.pdfCanvas;
  return Math.max(6, Math.max(c?c.width:2000, c?c.height:1400)/135);
}
function wrapText(txt, perLine){
  const words=String(txt).split(/\s+/), lines=[]; let cur="";
  for(const w of words){
    if(!cur.length) cur=w;
    else if((cur+" "+w).length<=perLine) cur+=" "+w;
    else { lines.push(cur); cur=w; }
  }
  if(cur.length) lines.push(cur);
  return lines.length?lines:[""];
}
function legendData(){
  const p=page();
  const counts=new Map();
  for(const h of p.heads){ const k=devId(h.type); counts.set(k,(counts.get(k)||0)+1); }
  const L = p.legend || (p.legend = {x:null, y:null, show:true, cols:46, title:"LEGEND"});
  const D = devices();
  const rows=[];
  for(const [id,d] of Object.entries(D)){
    const n = counts.get(id)||0;
    if(!n && !(L.always||[]).includes(id)) continue;
    rows.push({id, d, n, lines: wrapText(d.desc, L.cols||46)});
  }
  rows.sort((a,b)=> (a.d.group||"").localeCompare(b.d.group||"") || a.id.localeCompare(b.id));
  const u=legendUnit();
  const pad=u*0.7, lineH=u*0.92, symW=u*3.0, qtyW=u*3.2;
  const descW=(L.cols||46)*u*0.47;
  const headH=u*1.6;
  let h=headH;
  for(const r of rows){ r.h=Math.max(u*2.0, r.lines.length*lineH+u*0.7); h+=r.h; }
  const totalH = h + (rows.length? u*1.5 : 0);
  return {rows, u, pad, lineH, symW, qtyW, descW, headH,
          w: symW+descW+qtyW, h: totalH,
          x: L.x!=null? L.x : (state.pdfCanvas? state.pdfCanvas.width - (symW+descW+qtyW) - u*2 : 0),
          y: L.y!=null? L.y : u*2,
          L};
}

function drawLegendOn(g, G, scale, colors){
  const {rows,u,lineH,symW,descW,qtyW,headH,x,y,w} = G;
  const S=v=>v*scale;
  const X=x, Y=y;
  const total = rows.reduce((a,r)=>a+r.n,0);
  g.save();
  g.fillStyle=colors.bg; g.strokeStyle=colors.line; g.lineWidth=Math.max(1, S(u*0.09));
  g.beginPath(); g.rect(S(X)+G.ox, S(Y)+G.oy, S(w), S(G.h)); g.fill(); g.stroke();
  // header
  g.fillStyle=colors.headBg;
  g.fillRect(S(X)+G.ox, S(Y)+G.oy, S(w), S(headH));
  g.fillStyle=colors.text;
  g.font=`600 ${S(u*0.78)}px 'IBM Plex Sans', sans-serif`;
  g.textAlign="left"; g.textBaseline="middle";
  g.fillText(G.L.title||"LEGEND", S(X+u*0.5)+G.ox, S(Y+headH/2)+G.oy);
  g.textAlign="right";
  g.font=`500 ${S(u*0.62)}px 'IBM Plex Mono', monospace`;
  g.fillText("QTY", S(X+w-u*0.5)+G.ox, S(Y+headH/2)+G.oy);
  g.textAlign="left";

  let cy=Y+headH;
  for(const r of rows){
    g.strokeStyle=colors.line; g.lineWidth=Math.max(0.6, S(u*0.05));
    g.beginPath(); g.moveTo(S(X)+G.ox, S(cy)+G.oy); g.lineTo(S(X+w)+G.ox, S(cy)+G.oy); g.stroke();
    drawDeviceSymbol(g, S(X+symW/2)+G.ox, S(cy+r.h/2)+G.oy, S(u*0.62), r.d,
      {lw:Math.max(1,S(u*0.11)), bg:colors.bg, letterColor:colors.letter});
    g.fillStyle=colors.text;
    g.font=`400 ${S(u*0.55)}px 'IBM Plex Sans', sans-serif`;
    g.textBaseline="alphabetic";
    r.lines.forEach((ln,i)=> g.fillText(ln, S(X+symW)+G.ox, S(cy+u*0.95+i*lineH)+G.oy));
    g.textAlign="right";
    g.font=`600 ${S(u*0.72)}px 'IBM Plex Mono', monospace`;
    g.fillText(String(r.n), S(X+w-u*0.7)+G.ox, S(cy+r.h/2+u*0.25)+G.oy);
    g.textAlign="left"; g.textBaseline="middle";
    g.strokeStyle=colors.line; g.lineWidth=Math.max(0.6, S(u*0.05));
    g.beginPath(); g.moveTo(S(X+symW)+G.ox, S(cy)+G.oy); g.lineTo(S(X+symW)+G.ox, S(cy+r.h)+G.oy);
    g.moveTo(S(X+symW+descW)+G.ox, S(cy)+G.oy); g.lineTo(S(X+symW+descW)+G.ox, S(cy+r.h)+G.oy); g.stroke();
    cy+=r.h;
  }
  if(rows.length){
    g.strokeStyle=colors.line; g.lineWidth=Math.max(1, S(u*0.09));
    g.beginPath(); g.moveTo(S(X)+G.ox, S(cy)+G.oy); g.lineTo(S(X+w)+G.ox, S(cy)+G.oy); g.stroke();
    g.fillStyle=colors.text;
    g.font=`600 ${S(u*0.6)}px 'IBM Plex Sans', sans-serif`;
    g.textBaseline="middle";
    g.fillText("TOTAL DEVICES", S(X+u*0.5)+G.ox, S(cy+u*0.75)+G.oy);
    g.textAlign="right";
    g.font=`600 ${S(u*0.72)}px 'IBM Plex Mono', monospace`;
    g.fillText(String(total), S(X+w-u*0.7)+G.ox, S(cy+u*0.75)+G.oy);
    g.textAlign="left";
  }
  g.restore();
}

/* One symbol renderer, used on screen, in the legend and in the PDF. */
function drawDeviceSymbol(g, x, y, r, d, opts){
  opts = opts||{};
  const col = opts.color || d.color || "#e4573d";
  g.save();
  g.strokeStyle = col; g.fillStyle = col;
  g.lineWidth = opts.lw || Math.max(1, r*0.22);
  g.beginPath();
  if(d.shape==="square") g.rect(x-r,y-r,r*2,r*2);
  else if(d.shape==="triangle"){ g.moveTo(x,y-r); g.lineTo(x+r*0.92,y+r*0.72); g.lineTo(x-r*0.92,y+r*0.72); g.closePath(); }
  else if(d.shape==="diamond"){ g.moveTo(x,y-r); g.lineTo(x+r,y); g.lineTo(x,y+r); g.lineTo(x-r,y); g.closePath(); }
  else g.arc(x,y,r,0,7);
  if(d.fill) g.fill(); else { if(opts.bg){ g.fillStyle=opts.bg; g.fill(); g.fillStyle=col; } g.stroke(); }
  if(d.dot && !d.fill){ g.beginPath(); g.arc(x,y,r*0.34,0,7); g.fill(); }
  if(d.letter){
    const fs = r*(d.letter.length>1?0.85:1.05);
    g.font=`600 ${fs}px 'IBM Plex Sans', sans-serif`;
    g.textAlign="left"; g.textBaseline="alphabetic";
    g.fillStyle = opts.letterColor || "#2f6fd0";
    g.fillText(d.letter, x+r*0.75, y-r*0.55);
  }
  g.restore();
}

function segLenPx(pts){
  let d=0; for(let i=1;i<pts.length;i++) d+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
  return d;
}
function fmtLen(px){
  const mm = mmPerPx();
  if(!mm) return px.toFixed(0)+" px";
  const v = px*mm;
  return v>=10000 ? (v/1000).toFixed(2)+" m" : Math.round(v).toLocaleString("en-US")+" mm";
}
function segAngle(a,b){
  let d = -Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI;   // screen y grows downward
  if(d<0) d+=360;
  return d;
}
function drawMeasure(worldPts, sel, dashed){
  const S = worldPts.map(toScreen);
  ctx.save();
  ctx.strokeStyle = sel ? "#a9bfff" : "#7b9cff";
  ctx.lineWidth = sel ? 2.4 : 1.8;
  if(dashed) ctx.setLineDash([7,4]);
  ctx.beginPath(); S.forEach((q,i)=> i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)); ctx.stroke();
  ctx.setLineDash([]);
  const tick=(a,b)=>{ const t=Math.atan2(b.y-a.y,b.x-a.x)+Math.PI/2;
    ctx.beginPath(); ctx.moveTo(a.x+Math.cos(t)*7,a.y+Math.sin(t)*7); ctx.lineTo(a.x-Math.cos(t)*7,a.y-Math.sin(t)*7); ctx.stroke(); };
  if(S.length>=2){ tick(S[0],S[1]); tick(S[S.length-1],S[S.length-2]); }
  for(const q of S){ ctx.beginPath(); ctx.arc(q.x,q.y,2.5,0,7); ctx.fillStyle="#7b9cff"; ctx.fill(); }

  const total = fmtLen(segLenPx(worldPts));
  const label = worldPts.length===2
    ? `${total}   ${segAngle(worldPts[0],worldPts[1]).toFixed(1)}°`
    : `${total}  (${worldPts.length-1} segments)`;
  const i0=S.length-2, a=S[i0], b=S[S.length-1];
  const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
  const t=Math.atan2(b.y-a.y,b.x-a.x)+Math.PI/2;
  const lx=mx+Math.cos(t)*15, ly=my+Math.sin(t)*15;
  ctx.font="500 12px 'IBM Plex Mono', monospace";
  const w=ctx.measureText(label).width+12;
  ctx.fillStyle="rgba(20,23,26,.9)"; ctx.strokeStyle="#7b9cff"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.rect(lx-w/2, ly-10, w, 20); ctx.fill(); ctx.stroke();
  ctx.fillStyle="#cdd8ff"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(label, lx, ly);
  ctx.textAlign="start"; ctx.textBaseline="alphabetic";
  ctx.restore();
}

/* Shift locks to horizontal or vertical */
let shiftHeld=false;
document.addEventListener("keydown", e=>{ if(e.key==="Shift"){shiftHeld=true; draw();} });
document.addEventListener("keyup",   e=>{ if(e.key==="Shift"){shiftHeld=false; draw();} });
function orthoSnap(wp, from){
  if(!shiftHeld || !from) return wp;
  return Math.abs(wp.x-from.x) > Math.abs(wp.y-from.y) ? {x:wp.x, y:from.y} : {x:from.x, y:wp.y};
}
function snapPoint(sp){
  const wp = toWorld(sp);
  if(!state.snap){ state.snapHit=null; return wp; }
  // Points the user placed win over raw drawing geometry.
  let best=null, bd=11;
  const consider = q => { const t=toScreen(q); const d=Math.hypot(t.x-sp.x,t.y-sp.y); if(d<bd){bd=d; best=q;} };
  for(const r of page().rooms) r.polygon.forEach(consider);
  for(const m of page().measures) m.pts.forEach(consider);
  for(const h of page().heads) consider(h);
  if(best){ state.snapHit={x:best.x, y:best.y, type:"point"}; return {x:best.x, y:best.y}; }
  const v = vectorSnap(sp);
  state.snapHit = v;
  return v ? {x:v.x, y:v.y} : wp;
}

const SNAP_LABEL = {end:"endpoint", mid:"midpoint", int:"intersection", edge:"on line", point:"placed point"};
function drawSnapMarker(){
  const h = state.snapHit;
  if(!h || !state.snap) return;
  const q = toScreen(h);
  ctx.save();
  ctx.strokeStyle="#ffd166"; ctx.fillStyle="rgba(255,209,102,.18)"; ctx.lineWidth=1.8;
  if(h.type==="end" || h.type==="point"){ ctx.beginPath(); ctx.rect(q.x-6,q.y-6,12,12); ctx.fill(); ctx.stroke(); }
  else if(h.type==="mid"){ ctx.beginPath(); ctx.moveTo(q.x,q.y-7); ctx.lineTo(q.x+7,q.y+5); ctx.lineTo(q.x-7,q.y+5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  else if(h.type==="int"){ ctx.beginPath(); ctx.moveTo(q.x-6,q.y-6); ctx.lineTo(q.x+6,q.y+6); ctx.moveTo(q.x+6,q.y-6); ctx.lineTo(q.x-6,q.y+6); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(q.x,q.y,6,0,7); ctx.fill(); ctx.stroke(); }
  ctx.font="500 11px 'IBM Plex Sans', sans-serif"; ctx.fillStyle="#ffd166";
  ctx.fillText(SNAP_LABEL[h.type]||"", q.x+11, q.y-9);
  ctx.restore();
}
function measureAt(sp){
  for(const m of page().measures){
    for(let i=1;i<m.pts.length;i++){
      const a=toScreen(m.pts[i-1]), b=toScreen(m.pts[i]);
      if(distToSeg(sp,a,b)<=7) return m;
    }
  }
  return null;
}
function finishMeasure(){
  if(state.mdraft && state.mdraft.length>=2){
    snapshot();
    const m={id:uid("m_"), pts:state.mdraft};
    page().measures.push(m); state.selMeasure=m.id; save(); syncPanels();
  }
  state.mdraft=null; updateLenCell(); draw();
}
function updateLenCell(){
  const cell=document.getElementById("cellLen");
  if(state.mdraft && state.mdraft.length){
    const pts=[...state.mdraft];
    if(state.cursor) pts.push(orthoSnap(state.snapHit || toWorld(state.cursor), pts[pts.length-1]));
    cell.style.display="flex";
    document.getElementById("stLen").textContent = pts.length>=2 ? fmtLen(segLenPx(pts)) : "start point";
  } else if(state.selMeasure){
    const m=page().measures.find(x=>x.id===state.selMeasure);
    cell.style.display = m?"flex":"none";
    if(m) document.getElementById("stLen").textContent = fmtLen(segLenPx(m.pts));
  } else cell.style.display="none";
}