
/* ══════════════════════════════════════════════════════════════
   1c. Vector geometry from the PDF itself, for snapping
   pdf.js gives us the raw drawing operators. We replay them, keeping
   track of the transform stack, and keep every line segment in a
   uniform grid so the cursor can find nearby geometry quickly.
   ══════════════════════════════════════════════════════════════ */

const VEC = {segs:null, shapes:new Int32Array(0), grid:new Map(), longs:[], cell:32, count:0, ready:false, truncated:false, busy:false};

const Tx = (m1,m2)=>[
  m1[0]*m2[0]+m1[2]*m2[1], m1[1]*m2[0]+m1[3]*m2[1],
  m1[0]*m2[2]+m1[2]*m2[3], m1[1]*m2[2]+m1[3]*m2[3],
  m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5]
];
const Ap = (m,x,y)=>[m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];

const MAX_SEGS = 400000;

async function extractVectors(pg, viewport){
  VEC.segs=null; VEC.grid=new Map(); VEC.longs=[]; VEC.count=0;
  VEC.ready=false; VEC.truncated=false; VEC.busy=true;
  updateVecCell();
  try{
    const list = await pg.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const base = viewport.transform.slice();
    let ctm = base.slice();
    const stack = [];
    const out = [];
    /* Closed outlines, as runs of segments [from, to). A fitting in a
       ceiling is drawn as one (a panel, a grille, a downlight); a dashed
       line, a light-spread fan or a grid line is not. */
    const shapes = [];
    let x=0,y=0,sx=0,sy=0, sub=-1;
    const endSub = closed => {
      const n=out.length/4;
      if(sub>=0 && n-sub>=2 && (closed || (Math.abs(x-sx)<1e-6 && Math.abs(y-sy)<1e-6))) shapes.push(sub, n);
      sub=-1;
    };

    const push=(ax,ay,bx,by)=>{
      if(out.length >= MAX_SEGS*4){ VEC.truncated=true; return; }
      const A=Ap(ctm,ax,ay), B=Ap(ctm,bx,by);
      if(Math.abs(A[0]-B[0])<0.02 && Math.abs(A[1]-B[1])<0.02) return;
      out.push(A[0],A[1],B[0],B[1]);
    };
    const curve=(x0,y0,c1x,c1y,c2x,c2y,ex,ey)=>{
      const N=6; let px=x0, py=y0;
      for(let t=1;t<=N;t++){
        const u=t/N, v=1-u;
        const nx = v*v*v*x0 + 3*v*v*u*c1x + 3*v*u*u*c2x + u*u*u*ex;
        const ny = v*v*v*y0 + 3*v*v*u*c1y + 3*v*u*u*c2y + u*u*u*ey;
        push(px,py,nx,ny); px=nx; py=ny;
      }
    };

    for(let i=0;i<list.fnArray.length;i++){
      const fn=list.fnArray[i], a=list.argsArray[i];
      if(fn===OPS.save){ stack.push(ctm.slice()); }
      else if(fn===OPS.restore){ ctm = stack.pop() || base.slice(); }
      else if(fn===OPS.transform){ ctm = Tx(ctm, a); }
      else if(fn===OPS.paintFormXObjectBegin){ stack.push(ctm.slice()); if(a && a[0]) ctm = Tx(ctm, a[0]); }
      else if(fn===OPS.paintFormXObjectEnd){ ctm = stack.pop() || base.slice(); }
      else if(fn===OPS.constructPath){
        const ops=a[0], co=a[1]; let j=0;
        for(const op of ops){
          if(op===OPS.moveTo){ endSub(false); x=co[j++]; y=co[j++]; sx=x; sy=y; sub=out.length/4; }
          else if(op===OPS.lineTo){ const nx=co[j++], ny=co[j++]; push(x,y,nx,ny); x=nx; y=ny; }
          else if(op===OPS.curveTo){ const a1=co[j++],b1=co[j++],a2=co[j++],b2=co[j++],ex=co[j++],ey=co[j++];
            curve(x,y,a1,b1,a2,b2,ex,ey); x=ex; y=ey; }
          else if(op===OPS.curveTo2){ const a2=co[j++],b2=co[j++],ex=co[j++],ey=co[j++];
            curve(x,y,x,y,a2,b2,ex,ey); x=ex; y=ey; }
          else if(op===OPS.curveTo3){ const a1=co[j++],b1=co[j++],ex=co[j++],ey=co[j++];
            curve(x,y,a1,b1,ex,ey,ex,ey); x=ex; y=ey; }
          else if(op===OPS.closePath){ push(x,y,sx,sy); x=sx; y=sy; endSub(true); }
          else if(op===OPS.rectangle){ const rx=co[j++],ry=co[j++],rw=co[j++],rh=co[j++];
            endSub(false); sub=out.length/4;
            push(rx,ry,rx+rw,ry); push(rx+rw,ry,rx+rw,ry+rh);
            push(rx+rw,ry+rh,rx,ry+rh); push(rx,ry+rh,rx,ry);
            x=rx; y=ry; sx=rx; sy=ry; endSub(true); }
        }
        endSub(false);
      }
    }
    buildVecIndex(out, shapes);
  }catch(err){
    VEC.ready=false;
    console.warn("vector extraction failed", err);
  }
  VEC.busy=false;
  updateVecCell();
  TILE_CACHE.clear();
  // rooms traced before the vectors were ready never got a chance to find
  // a ceiling grid; give them one now
  const pg2=page();
  const wanting=pg2.rooms.filter(r=>isTiled(r) && r.autoLayout!==false && detectTiles(r));
  if(wanting.length && mmPerPx()){
    wanting.forEach(r=>regenerateHeads(r));
    syncPanels();
    toast(`Ceiling grid found in ${wanting.length} room${wanting.length>1?"s":""}; heads re-laid onto it.`);
  }
  draw();
}

function buildVecIndex(flat, shapes){
  VEC.segs = new Float64Array(flat);
  VEC.shapes = new Int32Array(shapes || []);
  const n = flat.length/4;
  const span = Math.max(state.pdfCanvas? state.pdfCanvas.width:2000, state.pdfCanvas? state.pdfCanvas.height:2000);
  const cell = Math.max(12, Math.round(span/240));
  VEC.cell = cell; VEC.grid = new Map(); VEC.longs = [];
  for(let i=0;i<n;i++){
    const x1=VEC.segs[i*4], y1=VEC.segs[i*4+1], x2=VEC.segs[i*4+2], y2=VEC.segs[i*4+3];
    const c0=Math.floor(Math.min(x1,x2)/cell), c1=Math.floor(Math.max(x1,x2)/cell);
    const r0=Math.floor(Math.min(y1,y2)/cell), r1=Math.floor(Math.max(y1,y2)/cell);
    if((c1-c0+1)*(r1-r0+1) > 48){ VEC.longs.push(i); continue; }
    for(let c=c0;c<=c1;c++) for(let r=r0;r<=r1;r++){
      const k = c*100000 + r;
      let arr = VEC.grid.get(k);
      if(!arr){ arr=[]; VEC.grid.set(k, arr); }
      arr.push(i);
    }
  }
  VEC.count = n; VEC.ready = n>0;
}

function segNearest(px,py, x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1, L=dx*dx+dy*dy;
  if(L===0) return {x:x1,y:y1,t:0};
  let t=((px-x1)*dx+(py-y1)*dy)/L; t=Math.max(0,Math.min(1,t));
  return {x:x1+t*dx, y:y1+t*dy, t};
}
function segIntersect(x1,y1,x2,y2, x3,y3,x4,y4){
  const d=(x2-x1)*(y4-y3)-(y2-y1)*(x4-x3);
  if(Math.abs(d)<1e-9) return null;
  const t=((x3-x1)*(y4-y3)-(y3-y1)*(x4-x3))/d;
  const u=((x3-x1)*(y2-y1)-(y3-y1)*(x2-x1))/d;
  if(t<-0.02||t>1.02||u<-0.02||u>1.02) return null;
  return {x:x1+t*(x2-x1), y:y1+t*(y2-y1)};
}

/* Find the strongest snap under the cursor. Screen point in, world point out. */
function vectorSnap(sp){
  if(!VEC.ready || !state.snap) return null;
  const wp = toWorld(sp);
  const R = 13/state.view.zoom;
  const cell = VEC.cell, S = VEC.segs;
  const cand = [];
  const c0=Math.floor((wp.x-R)/cell), c1=Math.floor((wp.x+R)/cell);
  const r0=Math.floor((wp.y-R)/cell), r1=Math.floor((wp.y+R)/cell);
  for(let c=c0;c<=c1 && cand.length<260;c++)
    for(let r=r0;r<=r1 && cand.length<260;r++){
      const arr = VEC.grid.get(c*100000+r);
      if(arr) for(const i of arr){ if(cand.indexOf(i)<0) cand.push(i); }
    }
  for(const i of VEC.longs){
    const n = segNearest(wp.x,wp.y, S[i*4],S[i*4+1],S[i*4+2],S[i*4+3]);
    if(Math.hypot(n.x-wp.x, n.y-wp.y) <= R && cand.indexOf(i)<0) cand.push(i);
  }
  if(!cand.length) return null;

  let best=null;
  const consider=(x,y,type,bonus)=>{
    const d=Math.hypot(x-wp.x, y-wp.y);
    if(d>R) return;
    const score = d - bonus*R;
    if(!best || score<best.score) best={x,y,type,score};
  };
  for(const i of cand){
    const x1=S[i*4], y1=S[i*4+1], x2=S[i*4+2], y2=S[i*4+3];
    consider(x1,y1,"end",0.60); consider(x2,y2,"end",0.60);
    consider((x1+x2)/2,(y1+y2)/2,"mid",0.30);
    const n = segNearest(wp.x,wp.y,x1,y1,x2,y2);
    consider(n.x,n.y,"edge",0);
  }
  const lim = Math.min(cand.length, 36);
  for(let a=0;a<lim;a++) for(let b=a+1;b<lim;b++){
    const i=cand[a], j=cand[b];
    const p = segIntersect(S[i*4],S[i*4+1],S[i*4+2],S[i*4+3], S[j*4],S[j*4+1],S[j*4+2],S[j*4+3]);
    if(p) consider(p.x,p.y,"int",0.50);
  }
  return best;
}