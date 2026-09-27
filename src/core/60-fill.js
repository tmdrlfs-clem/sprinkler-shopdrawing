
/* ══════════════════════════════════════════════════════════════
   3b. Dynamic fill
   Click a point inside a room; flood fill the rendered page across
   everything lighter than the threshold, trace the boundary of what
   was filled, simplify it, and hand back a room polygon.
   ══════════════════════════════════════════════════════════════ */

const MASK = {open:null, w:0, h:0, threshold:160, close:1, bridge:6, key:null, brush:"square", brushPx:18};

function buildMask(){
  const c = state.pdfCanvas;
  let hsh=0;
  for(const ms of page().measures) for(const q of ms.pts) hsh = (hsh*31 + (q.x|0)*7 + (q.y|0)) | 0;
  const key = state.pageNum+":"+MASK.threshold+":"+MASK.close+":"+hsh;
  if(MASK.key===key && MASK.open) return MASK.open;
  const g = c.getContext("2d", {willReadFrequently:true});
  const img = g.getImageData(0,0,c.width,c.height).data;
  const w=c.width, h=c.height;
  let m = new Uint8Array(w*h);
  const th = MASK.threshold;
  for(let i=0,px=0; px<w*h; px++, i+=4){
    const a = img[i+3];
    const L = a<16 ? 255 : (img[i]*0.299 + img[i+1]*0.587 + img[i+2]*0.114);
    m[px] = L < th ? 0 : 1;                      // 0 = wall, 1 = open
  }
  // Measurement lines act as barriers, so a line drawn across a doorway stops the fill.
  for(const ms of page().measures)
    for(let i=1;i<ms.pts.length;i++) burnLine(m,w,h, ms.pts[i-1], ms.pts[i]);

  if(MASK.close>0) m = closeGaps(m,w,h,MASK.close);
  MASK.open=m; MASK.w=w; MASK.h=h; MASK.key=key;
  return m;
}
function burnLine(m,w,h,a,b){
  const n = Math.ceil(Math.hypot(b.x-a.x, b.y-a.y));
  for(let i=0;i<=n;i++){
    const x=Math.round(a.x+(b.x-a.x)*i/n), y=Math.round(a.y+(b.y-a.y)*i/n);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      const px=x+dx, py=y+dy;
      if(px>=0&&py>=0&&px<w&&py<h) m[py*w+px]=0;
    }
  }
}
function closeGaps(m,w,h,r){          // grow the barriers, separable min filter
  const t=new Uint8Array(w*h), o=new Uint8Array(w*h);
  for(let y=0;y<h;y++){ const row=y*w;
    for(let x=0;x<w;x++){
      let v=1;
      for(let k=-r;k<=r;k++){ const xx=x+k; if(xx<0||xx>=w) continue; if(!m[row+xx]){v=0;break;} }
      t[row+x]=v;
    }
  }
  for(let x=0;x<w;x++)
    for(let y=0;y<h;y++){
      let v=1;
      for(let k=-r;k<=r;k++){ const yy=y+k; if(yy<0||yy>=h) continue; if(!t[yy*w+x]){v=0;break;} }
      o[y*w+x]=v;
    }
  return o;
}

function floodRegion(m,w,h,sx,sy,limit){
  if(sx<0||sy<0||sx>=w||sy>=h || !m[sy*w+sx]) return null;
  const fill = new Uint8Array(w*h);
  const stack = [sx,sy];
  let count=0;
  while(stack.length){
    let y=stack.pop(), x=stack.pop();
    let row=y*w;
    if(fill[row+x] || !m[row+x]) continue;
    let l=x; while(l>0   && m[row+l-1] && !fill[row+l-1]) l--;
    let rr=x; while(rr<w-1 && m[row+rr+1] && !fill[row+rr+1]) rr++;
    for(let i=l;i<=rr;i++){
      fill[row+i]=1; count++;
      if(count>limit) return {overflow:true};
      if(y>0){ const u=(y-1)*w+i; if(m[u] && !fill[u]) stack.push(i,y-1); }
      if(y<h-1){ const d=(y+1)*w+i; if(m[d] && !fill[d]) stack.push(i,y+1); }
    }
  }
  return {fill, count};
}

/* The fill spreads diagonally, but a boundary walk cannot cross a corner
   contact, so it would close early and return only the first blob. Widen
   every diagonal pinch into a proper 4-connected join first. */
function closeDiagonals(f,w,h){
  let changed=0;
  for(let pass=0; pass<3; pass++){
    let hits=0;
    for(let y=0;y<h-1;y++){
      const r=y*w, r2=r+w;
      for(let x=0;x<w-1;x++){
        const a=f[r+x], b=f[r+x+1], c=f[r2+x], d=f[r2+x+1];
        if(a&&d&&!b&&!c){ f[r+x+1]=1; hits++; }
        else if(b&&c&&!a&&!d){ f[r+x]=1; hits++; }
      }
    }
    changed+=hits;
    if(!hits) break;
  }
  return changed;
}

/* Anything enclosed by the region (hatch dots, furniture, text) is part of
   the room, so flood the outside and promote whatever it never reached. */
function fillHoles(f,w,h){
  const outside=new Uint8Array(w*h);
  const st=[];
  const seed=(x,y)=>{ const i=y*w+x; if(!f[i] && !outside[i]){ outside[i]=1; st.push(i); } };
  for(let x=0;x<w;x++){ seed(x,0); seed(x,h-1); }
  for(let y=0;y<h;y++){ seed(0,y); seed(w-1,y); }
  while(st.length){
    const i=st.pop(), y=(i/w)|0, x=i-y*w;
    if(x>0){ const j=i-1; if(!f[j]&&!outside[j]){outside[j]=1;st.push(j);} }
    if(x<w-1){ const j=i+1; if(!f[j]&&!outside[j]){outside[j]=1;st.push(j);} }
    if(y>0){ const j=i-w; if(!f[j]&&!outside[j]){outside[j]=1;st.push(j);} }
    if(y<h-1){ const j=i+w; if(!f[j]&&!outside[j]){outside[j]=1;st.push(j);} }
  }
  let n=0;
  for(let i=0;i<w*h;i++) if(!f[i] && !outside[i]){ f[i]=1; n++; }
  return n;
}

/* Lines that cut across the fill (walls, hatch edges, text) leave thin
   unfilled gaps that split it into pieces. Grow the region by r pixels so
   those gaps close, fill anything enclosed, then shrink it back so the
   outer edge returns to where it was. Only the gaps stay bridged. */
function closeRegion(f,w,h,r){
  if(r<=0) return;
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++){ const row=y*w;
    for(let x=0;x<w;x++) if(f[row+x]){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
  if(x1<0) return;
  x0=Math.max(0,x0-r-2); y0=Math.max(0,y0-r-2); x1=Math.min(w-1,x1+r+2); y1=Math.min(h-1,y1+r+2);
  const bw=x1-x0+1, bh=y1-y0+1;
  const a=new Uint8Array(bw*bh), b=new Uint8Array(bw*bh);
  for(let y=0;y<bh;y++) for(let x=0;x<bw;x++) a[y*bw+x]=f[(y+y0)*w+(x+x0)];

  // dilate: any set pixel within r, separable
  for(let y=0;y<bh;y++){ const row=y*bw;
    for(let x=0;x<bw;x++){ let v=0;
      for(let k=Math.max(0,x-r), e=Math.min(bw-1,x+r); k<=e; k++) if(a[row+k]){ v=1; break; }
      b[row+x]=v; } }
  for(let x=0;x<bw;x++)
    for(let y=0;y<bh;y++){ let v=0;
      for(let k=Math.max(0,y-r), e=Math.min(bh-1,y+r); k<=e; k++) if(b[k*bw+x]){ v=1; break; }
      a[y*bw+x]=v; }

  // fill enclosed holes of the dilated shape (flood the outside from the box edge)
  const out=new Uint8Array(bw*bh); const st=[];
  const seed=i=>{ if(!a[i]&&!out[i]){ out[i]=1; st.push(i); } };
  for(let x=0;x<bw;x++){ seed(x); seed((bh-1)*bw+x); }
  for(let y=0;y<bh;y++){ seed(y*bw); seed(y*bw+bw-1); }
  while(st.length){ const i=st.pop(), y=(i/bw)|0, x=i-y*bw;
    if(x>0) seed(i-1); if(x<bw-1) seed(i+1); if(y>0) seed(i-bw); if(y<bh-1) seed(i+bw); }
  for(let i=0;i<bw*bh;i++) if(!a[i]&&!out[i]) a[i]=1;

  // erode back by r: all pixels within r must be set
  for(let y=0;y<bh;y++){ const row=y*bw;
    for(let x=0;x<bw;x++){ let v=1;
      for(let k=Math.max(0,x-r), e=Math.min(bw-1,x+r); k<=e; k++) if(!a[row+k]){ v=0; break; }
      b[row+x]=v; } }
  for(let x=0;x<bw;x++)
    for(let y=0;y<bh;y++){ let v=1;
      for(let k=Math.max(0,y-r), e=Math.min(bh-1,y+r); k<=e; k++) if(!b[k*bw+x]){ v=0; break; }
      f[(y+y0)*w+(x+x0)] = v || f[(y+y0)*w+(x+x0)]; }
}

/* Every closed boundary loop in the region, largest first. One loop per
   connected component once holes are filled and diagonals are closed. */
function traceLoops(f,w,h){
  const K=(x,y)=>x*100000+y;
  const edges=new Map();
  const add=(ax,ay,bx,by)=>{ const k=K(ax,ay); let a=edges.get(k); if(!a){a=[];edges.set(k,a);} a.push(bx,by); };
  for(let y=0;y<h;y++){ const row=y*w;
    for(let x=0;x<w;x++){
      if(!f[row+x]) continue;
      if(y===0   || !f[row-w+x]) add(x,y,     x+1,y);
      if(x===w-1 || !f[row+x+1]) add(x+1,y,   x+1,y+1);
      if(y===h-1 || !f[row+w+x]) add(x+1,y+1, x,  y+1);
      if(x===0   || !f[row+x-1]) add(x,y+1,   x,  y);
    }
  }
  if(edges.size > 3000000) return [];
  const loops=[];
  const maxSteps=4*w*h;
  for(const [k0,arr0] of edges){
    while(arr0.length){
      const sx=Math.floor(k0/100000), sy=k0-sx*100000;
      const pts=[]; let cx=sx, cy=sy, steps=0;
      do{
        pts.push({x:cx,y:cy});
        const a=edges.get(K(cx,cy));
        if(!a || !a.length) break;
        cy = a.pop(); cx = a.pop();          // stored flat as x,y — pop gives y then x
      } while(!(cx===sx && cy===sy) && ++steps<maxSteps);
      if(pts.length>=4) loops.push(pts);
      if(loops.length>20000) return loops;
    }
  }
  loops.sort((a,b)=>polyArea(b)-polyArea(a));
  return loops;
}

function rdp(pts, eps){
  if(pts.length<3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();
    let idx=-1, dmax=0;
    for(let i=a+1;i<b;i++){
      const d=distToSeg(pts[i], pts[a], pts[b]);
      if(d>dmax){ dmax=d; idx=i; }
    }
    if(dmax>eps && idx>0){ keep[idx]=1; stack.push([a,idx],[idx,b]); }
  }
  return pts.filter((_,i)=>keep[i]);
}

function simplifyLoop(loop, mm){
  let outline = loop.length>60000 ? loop.filter((_,i)=> i%2===0) : loop;
  const eps = mm ? Math.min(8, Math.max(1.2, 30/mm)) : 2;
  let poly = rdp(outline, eps);
  let guard=0;
  while(poly.length>800 && guard++<8) poly = rdp(poly, eps*(1+guard*0.6));
  if(poly.length>3){
    const a=poly[0], b=poly[poly.length-1];
    if(Math.hypot(a.x-b.x, a.y-b.y) < eps*2.5) poly.pop();
  }
  return poly.length>=3 ? poly.map(q=>({x:q.x, y:q.y})) : null;
}

function polygonFromFill(f, w, h){
  closeRegion(f,w,h, MASK.bridge);
  fillHoles(f,w,h);
  closeDiagonals(f,w,h);
  const loops = traceLoops(f,w,h);
  if(!loops.length) return {error:"Could not trace a boundary for that region."};
  const mm = mmPerPx();
  const big = polyArea(loops[0]);                 // loops come back largest first
  const poly = simplifyLoop(loops[0], mm);
  if(!poly) return {error:"The traced region was too small to use."};
  // anything else the fill touched but did not connect to the main body
  let stray = 0;
  for(let i=1;i<loops.length;i++){
    const a = polyArea(loops[i]);
    if(a < big*0.02) break;
    if(mm && a*mm*mm/1e6 < 0.15) break;
    stray++;
  }
  return {polygon: poly, stray};
}

/* ── Live fill session ──────────────────────────────────────────
   Hold the mouse and the fill spreads out from the cursor in a near
   circle (chamfer-distance Dijkstra, walls stop it). Drag and every
   point along the way becomes a new seed. Release to pause, press
   again to add more, Enter or Apply to commit, Esc to discard.
   ────────────────────────────────────────────────────────────── */
const FILL = {on:false, pressed:false, dist:null, w:0, h:0, img:null, cvs:null, cx:null,
              buckets:null, cur:0, count:0, limit:0, raf:0, last:null, leaked:false,
              brush:"grow", erasing:false, stroke:null, strokePrev:null, history:[]};
const FILL_INF = 65535;

function fillBegin(){
  buildMask();
  FILL.w=MASK.w; FILL.h=MASK.h;
  FILL.dist=new Uint16Array(FILL.w*FILL.h).fill(FILL_INF);
  FILL.buckets=[]; FILL.cur=0; FILL.count=0; FILL.leaked=false;
  FILL.cvs=document.createElement("canvas"); FILL.cvs.width=FILL.w; FILL.cvs.height=FILL.h;
  FILL.cx=FILL.cvs.getContext("2d");
  FILL.img=FILL.cx.createImageData(FILL.w,FILL.h);
  FILL.limit=Math.floor(FILL.w*FILL.h*0.80);
  FILL.history=[]; FILL.stroke=null; FILL.strokePrev=null; FILL.erasing=false;
  FILL.on=true;
  fillBar(true);
}
function fillSeed(wx,wy){
  if(!FILL.on) return;
  const x=Math.round(wx), y=Math.round(wy);
  if(x<0||y<0||x>=FILL.w||y>=FILL.h) return;
  const i=y*FILL.w+x;
  if(!MASK.open[i]) return;
  if(FILL.dist[i] < FILL_INF) return;
  FILL.dist[i]=FILL.cur;
  (FILL.buckets[FILL.cur] ||= []).push(i);
}
function fillSeedPath(a,b){
  const n=Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/3));
  for(let t=0;t<=n;t++) fillSeed(a.x+(b.x-a.x)*t/n, a.y+(b.y-a.y)*t/n);
}
function fillGrow(stepCost){
  if(!FILL.on || FILL.leaked) return false;
  const target=FILL.cur+stepCost;
  const w=FILL.w, h=FILL.h, d=FILL.dist, open=MASK.open, data=FILL.img.data;
  let x0=Infinity,y0=Infinity,x1=-1,y1=-1, touched=false;
  const relax=(j,nc)=>{ if(nc<FILL_INF && open[j] && d[j]>nc){ d[j]=nc; (FILL.buckets[nc] ||= []).push(j); } };
  for(let c=FILL.cur;c<=target;c++){
    const b=FILL.buckets[c]; if(!b) continue;
    for(let k=0;k<b.length;k++){
      const i=b[k]; if(d[i]!==c) continue;
      const y=(i/w)|0, x=i-y*w, o=i*4;
      if(data[o+3]===0){
        data[o]=70; data[o+1]=205; data[o+2]=130; data[o+3]=150;
        FILL.count++; touched=true;
        if(FILL.stroke) FILL.stroke.push(i);
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        if(FILL.count>FILL.limit){ FILL.leaked=true; }
      }
      if(x>0)     relax(i-1,   c+10); if(x<w-1)   relax(i+1,   c+10);
      if(y>0)     relax(i-w,   c+10); if(y<h-1)   relax(i+w,   c+10);
      if(x>0&&y>0)     relax(i-w-1, c+14); if(x<w-1&&y>0)   relax(i-w+1, c+14);
      if(x>0&&y<h-1)   relax(i+w-1, c+14); if(x<w-1&&y<h-1) relax(i+w+1, c+14);
    }
    FILL.buckets[c]=null;
  }
  FILL.cur=target+1;
  if(touched) FILL.cx.putImageData(FILL.img, 0,0, x0,y0, x1-x0+1, y1-y0+1);
  if(FILL.leaked){ FILL.pressed=false; toast("The fill leaked out of the room. Block the opening with a length line, raise Close gaps, then Reset and try again."); }
  return touched;
}
function strokeBegin(brush){          // "grow" | "paint" | "erase"
  FILL.brush = brush;
  FILL.erasing = brush==="erase";
  FILL.stroke = [];
  FILL.strokePrev = FILL.erasing ? [] : null;
}
function strokeEnd(){
  if(FILL.stroke && FILL.stroke.length){
    FILL.history.push({
      erase: FILL.erasing,
      idx: Int32Array.from(FILL.stroke),
      prev: FILL.strokePrev ? Uint16Array.from(FILL.strokePrev) : null
    });
    if(FILL.history.length>60) FILL.history.shift();
  }
  FILL.stroke=null; FILL.strokePrev=null;
}
function fillPaintDisc(wx,wy){
  const R = Math.max(2, Math.round(MASK.brushPx/state.view.zoom));
  const sq = MASK.brush!=="round";
  const w=FILL.w, h=FILL.h, d=FILL.dist, data=FILL.img.data;
  const cx=Math.round(wx), cy=Math.round(wy);
  let x0=w, y0=h, x1=-1, y1=-1, hit=false;
  for(let y=Math.max(0,cy-R); y<=Math.min(h-1,cy+R); y++){
    const dy=y-cy, span = sq ? R : Math.floor(Math.sqrt(Math.max(0,R*R-dy*dy)));
    for(let x=Math.max(0,cx-span); x<=Math.min(w-1,cx+span); x++){
      const i=y*w+x, o=i*4;
      if(data[o+3]) continue;
      data[o]=70; data[o+1]=205; data[o+2]=130; data[o+3]=150;
      FILL.count++;
      if(FILL.stroke) FILL.stroke.push(i);
      // seed it into the live frontier so the spread can carry on through the bridge
      d[i]=FILL.cur; (FILL.buckets[FILL.cur] ||= []).push(i);
      hit=true;
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
  }
  if(hit) FILL.cx.putImageData(FILL.img, 0,0, x0,y0, x1-x0+1, y1-y0+1);
  return hit;
}
function fillPaintPath(a,b){
  const n=Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/4));
  let hit=false;
  for(let t=0;t<=n;t++) hit = fillPaintDisc(a.x+(b.x-a.x)*t/n, a.y+(b.y-a.y)*t/n) || hit;
  if(hit){ FILL.leaked=false; draw(); fillBar(true); }
}
function fillEraseDisc(wx,wy){
  const R = Math.max(2, Math.round(MASK.brushPx/state.view.zoom));
  const sq = MASK.brush!=="round";
  const w=FILL.w, h=FILL.h, d=FILL.dist, data=FILL.img.data;
  const cx=Math.round(wx), cy=Math.round(wy);
  let x0=w, y0=h, x1=-1, y1=-1, hit=false;
  for(let y=Math.max(0,cy-R); y<=Math.min(h-1,cy+R); y++){
    const dy=y-cy, span = sq ? R : Math.floor(Math.sqrt(Math.max(0,R*R-dy*dy)));
    for(let x=Math.max(0,cx-span); x<=Math.min(w-1,cx+span); x++){
      const i=y*w+x, o=i*4;
      if(!data[o+3]) continue;
      if(FILL.stroke){ FILL.stroke.push(i); FILL.strokePrev.push(d[i]); }
      data[o+3]=0; d[i]=FILL_INF; FILL.count--;
      hit=true;
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
  }
  if(hit) FILL.cx.putImageData(FILL.img, 0,0, x0,y0, x1-x0+1, y1-y0+1);
  return hit;
}
function fillErasePath(a,b){
  const n=Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/4));
  let hit=false;
  for(let t=0;t<=n;t++) hit = fillEraseDisc(a.x+(b.x-a.x)*t/n, a.y+(b.y-a.y)*t/n) || hit;
  if(hit){ FILL.leaked=false; draw(); fillBar(true); }
}
function fillUndoStroke(){
  if(!FILL.history.length){ toast("No fill strokes to undo."); return; }
  const st=FILL.history.pop();
  const data=FILL.img.data, d=FILL.dist;
  for(let k=0;k<st.idx.length;k++){
    const i=st.idx[k], o=i*4;
    if(st.erase){
      if(!data[o+3]){ data[o]=70; data[o+1]=205; data[o+2]=130; data[o+3]=150; FILL.count++; }
      d[i]=st.prev[k];
    }else{
      if(data[o+3]){ data[o+3]=0; FILL.count--; }
      d[i]=FILL_INF;
    }
  }
  // drop the growth frontier so an undone area cannot creep back
  const w=FILL.w, h=FILL.h;
  for(let i=0;i<w*h;i++) d[i] = data[i*4+3] ? 0 : FILL_INF;
  FILL.buckets=[]; FILL.cur=0;
  FILL.cx.putImageData(FILL.img,0,0);
  FILL.leaked=false;
  draw(); fillBar(true);
  toast(st.erase? "Erase undone." : "Fill stroke undone.");
}

function fillTick(){
  FILL.raf=0;
  if(!FILL.on || !FILL.pressed || FILL.brush==="erase") return;
  const stepCost = Math.max(10, Math.round(10*7/state.view.zoom));   // ~7 screen px per frame
  fillGrow(stepCost);
  draw(); fillBar(true);
  FILL.raf=requestAnimationFrame(fillTick);
}
function fillApply(kind){
  if(!FILL.on) return;
  kind = kind || state.lastCeiling || "tile";
  const w=FILL.w, h=FILL.h, data=FILL.img.data;
  const f=new Uint8Array(w*h); let count=0;
  for(let i=0,o=3;i<w*h;i++,o+=4) if(data[o]){ f[i]=1; count++; }
  if(!count){ toast("Nothing filled yet. Hold the mouse inside a room."); return; }
  const r=polygonFromFill(f,w,h);
  if(r.error){ toast(r.error); return; }
  snapshot();
  const mm=mmPerPx();
  const n=page().rooms.length+1;
  const room={
    id:uid("r_"), name:"Room "+String(n).padStart(2,"0"), polygon:r.polygon,
    hazard:state.lastHazard||"OH1", headType:"sp-drop", ceilingH:2.7, ceilingType:"flat",
    autoLayout:true, gridAngle:0, gridDx:0, gridDy:0, notes:"",
    ceiling:kind, tileSnap:kind==="tile"
  };
  page().rooms.push(room);
  state.selRoom = room.id;
  fillCancel(false);
  setTab("props");
  setCeiling(room, kind);

  const area = mm ? polyArea(room.polygon)*mm*mm/1e6 : null;
  let msg = area!==null
    ? `Room created with a ${kind==="tile"?"tile":"GIB"} ceiling: ${area.toFixed(1)} m², ${room.polygon.length} corners.`
    : `Room created with ${room.polygon.length} corners. Set a scale to get its area.`;
  if(r.stray) msg += ` ${r.stray} unconnected patch${r.stray>1?"es were":" was"} left out — fill and apply separately, or bridge with Shift+drag.`;
  toast(msg);
}

function fillReset(){
  if(!FILL.on) return;
  fillBegin();
  draw();
}
function fillCancel(redraw=true){
  if(FILL.raf) cancelAnimationFrame(FILL.raf);
  FILL.on=false; FILL.pressed=false; FILL.dist=null; FILL.buckets=null; FILL.img=null; FILL.cvs=null; FILL.raf=0;
  fillBar(false);
  if(redraw) draw();
}
function fillBar(show){
  const el=document.getElementById("fillbar");
  el.style.display = show? "flex":"none";
  if(!show) return;
  const last=state.lastCeiling||"tile";
  document.getElementById("fbTile").classList.toggle("last", last==="tile");
  document.getElementById("fbGib").classList.toggle("last", last==="gib");
  const mm=mmPerPx();
  document.getElementById("fbArea").textContent = mm ? (FILL.count*mm*mm/1e6).toFixed(1)+" m²" : FILL.count.toLocaleString("en-US")+" px";
}