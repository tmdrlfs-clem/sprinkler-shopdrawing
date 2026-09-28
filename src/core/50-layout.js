
/* ══════════════════════════════════════════════════════════════
   3. Automatic head layout
   Build a grid aligned to the room's smallest enclosing rectangle, then
   keep only the grid points that fall inside the polygon.
   ══════════════════════════════════════════════════════════════ */

const RECT_CACHE = new Map();
function roomRect(room){
  let sig = room.polygon.length;
  for(const q of room.polygon) sig += q.x + q.y*1.7;
  const hit = RECT_CACHE.get(room.id);
  if(hit && Math.abs(hit.sig-sig) < 1e-6) return hit.rect;
  const rect = minAreaRect(room.polygon);
  RECT_CACHE.set(room.id, {sig, rect});
  return rect;
}

function ruleFor(room){
  const r = state.doc.rules[room.hazard] || Object.values(state.doc.rules)[0];
  if(r && r.minWallDist===undefined) r.minWallDist = 0.1;
  return r;
}
function covModel(){ return state.doc.coverage || "rect"; }
function hazColor(room){ const r=ruleFor(room); return (r && r.color) || "#35b8a6"; }

function gridCounts(lenM, rule){
  // Fewest divisions that satisfy both the spacing limit and the wall distance limit
  let n = Math.max(1, Math.ceil(lenM / rule.maxSpacing));
  let guard = 0;
  while(guard++ < 200){
    const s = lenM / n;
    if(s/2 <= rule.maxWallDist + 1e-9) break;
    n++;
  }
  return n;
}

/* The smallest enclosing rectangle can be tipped by one short diagonal
   edge, which sends the whole grid sideways. Take the direction the walls
   actually run instead: bin every edge by angle modulo 90 degrees, weight
   it by edge length, and use the heaviest bin. Near-square rooms then sit
   square to the page, which is what setting out expects. */
const ANGLE_CACHE = new Map();
function dominantAngle(poly){
  const bins = new Float64Array(360);                 // quarter-degree bins over 0..90
  // A traced outline is full of one- and two-pixel stair steps. They are
  // short but numerous, so ignore anything below a fraction of the
  // perimeter and weight what is left by length squared: a long wall then
  // outvotes a crowd of little jags.
  let perim=0;
  for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length]; perim+=Math.hypot(b.x-a.x,b.y-a.y); }
  const mmpp = mmPerPx()||1;
  const minLen = Math.max(250/mmpp, perim*0.02);
  for(let pass=0; pass<2; pass++){
    const cut = pass? 0 : minLen;
    let any=false;
    bins.fill(0);
    for(let i=0;i<poly.length;i++){
      const a=poly[i], b=poly[(i+1)%poly.length];
      const len=Math.hypot(b.x-a.x, b.y-a.y);
      if(len<=cut || len<1e-9) continue;
      any=true;
      let deg=Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI;
      deg=((deg%90)+90)%90;
      bins[Math.round(deg*4)%360]+=len*len;
    }
    if(any) break;
  }
  let best=0, bv=-1;
  for(let i=0;i<360;i++){
    let v=0;
    for(let k=-6;k<=6;k++) v += bins[(i+k+360)%360]*(1-Math.abs(k)/8);
    if(v>bv){ bv=v; best=i; }
  }
  let deg=best/4;
  if(deg>45) deg-=90;                                  // keep it in -45..45
  if(Math.abs(deg)<8) deg=0;                           // near-square rooms sit square to the page
  return deg*Math.PI/180;
}
function roomAngle(room){
  const mode = room.gridMode || "ortho";        // up/down/left/right unless told otherwise
  let base;
  if(mode==="ortho") base = 0;
  else if(mode==="bbox") base = roomRect(room).angle;
  else{
    let sig=room.polygon.length;
    for(const q of room.polygon) sig += q.x + q.y*1.7;
    const hit=ANGLE_CACHE.get(room.id);
    if(hit && Math.abs(hit.sig-sig)<1e-6) base=hit.a;
    else { base=dominantAngle(room.polygon); ANGLE_CACHE.set(room.id,{sig,a:base}); }
  }
  return base + (room.gridAngle||0)*Math.PI/180;
}

function roomFrame(room){
  const ang = roomAngle(room);
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const p of room.polygon){ const r=rotTo(p,ang); if(r.x<x0)x0=r.x; if(r.x>x1)x1=r.x; if(r.y<y0)y0=r.y; if(r.y>y1)y1=r.y; }
  return {ang,x0,x1,y0,y1};
}

/* Does a head protect a point? The rules assume each head covers S/2 in
   each grid direction (a square), so that is the default. The circle
   option treats anything within the square's corner radius as covered. */
function headCovers(px,py,h,ang,half,model){
  const dx=px-h.x, dy=py-h.y;
  if(model==="circle") return dx*dx+dy*dy <= 2*half*half;
  const du =  dx*Math.cos(ang) + dy*Math.sin(ang);
  const dv = -dx*Math.sin(ang) + dy*Math.cos(ang);
  return Math.abs(du)<=half && Math.abs(dv)<=half;
}

/* Sample lattice over the room interior, about 150 mm apart, cached. */
const SAMPLE_CACHE = new Map();
function roomSamples(room, mm){
  let sig = room.polygon.length + mm*1e-3;
  for(const q of room.polygon) sig += q.x + q.y*1.7;
  const hit = SAMPLE_CACHE.get(room.id);
  if(hit && Math.abs(hit.sig-sig)<1e-6) return hit.S;
  const areaPx = polyArea(room.polygon);
  let step = 150/mm;
  if(areaPx/(step*step) > 40000) step = Math.sqrt(areaPx/40000);
  const xs=room.polygon.map(p=>p.x), ys=room.polygon.map(p=>p.y);
  const xmin=Math.min(...xs), xmax=Math.max(...xs), ymin=Math.min(...ys), ymax=Math.max(...ys);
  const pts=[], ci=[], cj=[];
  let j=0;
  for(let y=ymin+step/2; y<ymax; y+=step, j++){
    let i=0;
    for(let x=xmin+step/2; x<xmax; x+=step, i++){
      if(pointInPoly({x,y}, room.polygon)){ pts.push({x,y}); ci.push(i); cj.push(j); }
    }
  }
  const S={pts, ci, cj, step};
  SAMPLE_CACHE.set(room.id, {sig, S});
  return S;
}

/* Checking every point against every head is quadratic, and a big floor
   plate has tens of thousands of points and a hundred heads. A head can
   only protect what is within its own reach, so bin the heads into cells of
   that size and look at the nine cells around a point instead of the lot. */
function headIndex(heads, reach){
  const cell = Math.max(reach, 1e-6);
  const map = new Map();
  for(const h of heads){
    const k = Math.floor(h.x/cell)*100000 + Math.floor(h.y/cell);
    let a = map.get(k); if(!a){ a=[]; map.set(k,a); }
    a.push(h);
  }
  return {cell, map};
}
function coveredAt(idx, x, y, ang, r, model){
  const cx = Math.floor(x/idx.cell), cy = Math.floor(y/idx.cell);
  const span = Math.max(1, Math.ceil(r/idx.cell));
  for(let dx=-span; dx<=span; dx++) for(let dy=-span; dy<=span; dy++){
    const a = idx.map.get((cx+dx)*100000 + (cy+dy));
    if(!a) continue;
    for(const h of a) if(headCovers(x,y,h,ang,r,model)) return true;
  }
  return false;
}

function uncoveredSamples(S, heads, ang, half, model){
  const idx = headIndex(heads, half);
  const out=[];
  for(let i=0;i<S.pts.length;i++){
    const p=S.pts[i];
    if(!coveredAt(idx, p.x, p.y, ang, half, model)) out.push(i);
  }
  return out;
}

/* Group uncovered samples into connected gaps, largest first. */
function gapClusters(S, unc, mm){
  const idx=new Map();
  for(const i of unc) idx.set(S.ci[i]*100000+S.cj[i], i);
  const seen=new Set(), gaps=[];
  for(const i of unc){
    if(seen.has(i)) continue;
    const q=[i], members=[]; seen.add(i);
    while(q.length){
      const a=q.pop(); members.push(a);
      const ci=S.ci[a], cj=S.cj[a];
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const j=idx.get((ci+dx)*100000+(cj+dy));
        if(j!==undefined && !seen.has(j)){ seen.add(j); q.push(j); }
      }
    }
    let cx=0, cy=0; for(const m of members){ cx+=S.pts[m].x; cy+=S.pts[m].y; }
    gaps.push({x:cx/members.length, y:cy/members.length, n:members.length,
               area: members.length*S.step*S.step*mm*mm/1e6, pts: members.map(m=>S.pts[m])});
  }
  gaps.sort((a,b)=>b.area-a.area);
  return gaps;
}

/* Greedy repair: keep adding the head that covers the most still-uncovered
   samples, preferring positions on the existing grid lines, until nothing
   worthwhile is left. Never breaks minimum spacing or wall clearance. */
function repairCoverage(room, placed, rule, mm, ang, cands){
  const half = rule.maxSpacing*1000/mm/2, model=covModel();
  const halfWall = Math.min(half, rule.maxWallDist*1000/mm);
  const minSp = rule.minSpacing*1000/mm;
  const minWall = (rule.minWallDist??0.1)*1000/mm;
  const S = roomSamples(room, mm);

  /* Two kinds of point have to end up protected, and they are not the same
     kind of problem. An interior point left out is a hole in the coverage; a
     point on the wall left out breaks the wall-distance limit outright. So
     the wall points carry the tighter radius and are mandatory: the greedy
     loop below stops short for slivers of floor, never for a wall. */
  const pts=[], rad=[], must=[];
  for(const q of S.pts){ pts.push(q); rad.push(half); must.push(false); }
  const bstep = Math.max(250/mm, S.step);
  for(let i=0,n=room.polygon.length;i<n;i++){
    const a=room.polygon[i], b=room.polygon[(i+1)%n];
    const len=Math.hypot(b.x-a.x,b.y-a.y), k=Math.max(1,Math.round(len/bstep));
    for(let t=0;t<k;t++){
      pts.push({x:a.x+(b.x-a.x)*t/k, y:a.y+(b.y-a.y)*t/k});
      rad.push(halfWall); must.push(true);
    }
  }

  const uncSet=new Set();
  const idx0=headIndex(placed, half);
  for(let i=0;i<pts.length;i++)
    if(!coveredAt(idx0, pts[i].x, pts[i].y, ang, rad[i], model)) uncSet.add(i);
  if(!uncSet.size) return [];

  const valid = p => pointInPoly(p, room.polygon) && distToPoly(p, room.polygon) >= minWall;
  // an uncovered point is also somewhere a head could go, so offer them
  let step=0;
  for(const i of uncSet){
    if(step++ % 2) continue;
    const p=pts[i];
    if(valid(p)) cands.push({x:p.x, y:p.y, tier:3});
    else if(must[i]){
      // a wall point cannot take a head itself; offer the spot just inside it
      const c=polyCentroid(room.polygon);
      const dx=c.x-p.x, dy=c.y-p.y, d=Math.hypot(dx,dy)||1;
      const q={x:p.x+dx/d*minWall*1.5, y:p.y+dy/d*minWall*1.5};
      if(valid(q)) cands.push({x:q.x, y:q.y, tier:3});
    }
  }

  const W = {1:1.0, 2:0.95, 3:0.8};
  const cell = Math.max(2*half, 1);
  const bucket=new Map();
  for(const i of uncSet){
    const k=Math.floor(pts[i].x/cell)*100000+Math.floor(pts[i].y/cell);
    let a=bucket.get(k); if(!a){a=[];bucket.set(k,a);} a.push(i);
  }
  const sampleArea = S.step*S.step*mm*mm/1e6;
  const minGain = Math.max(2, Math.ceil(0.05/sampleArea));
  const mustLeft = () => { for(const i of uncSet) if(must[i]) return true; return false; };

  const added=[];
  let guard=0;
  while(uncSet.size && guard++<300){
    const urgent = mustLeft();
    let best=null;
    for(const c of cands){
      let blocked=false;
      for(const h of placed){ if(Math.hypot(h.x-c.x,h.y-c.y) < minSp){ blocked=true; break; } }
      if(blocked) continue;
      let cnt=0, hitMust=0;
      const cx=Math.floor(c.x/cell), cy=Math.floor(c.y/cell);
      for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
        const arr=bucket.get((cx+dx)*100000+(cy+dy)); if(!arr) continue;
        for(const i of arr){
          if(!uncSet.has(i)) continue;
          if(headCovers(pts[i].x,pts[i].y,c,ang,rad[i],model)){ cnt++; if(must[i]) hitMust++; }
        }
      }
      if(!cnt) continue;
      if(!hitMust && cnt<minGain) continue;          // a sliver of floor can wait
      const score=(cnt + hitMust*4)*W[c.tier];       // a wall point is worth reaching for
      if(!best || score>best.score) best={c,cnt,hitMust,score};
    }
    if(!best) break;
    if(urgent && !best.hitMust && best.cnt<minGain) break;
    placed.push(best.c); added.push(best.c);
    for(const i of [...uncSet])
      if(headCovers(pts[i].x,pts[i].y,best.c,ang,rad[i],model)) uncSet.delete(i);
  }
  return added;
}

/* ──────────────────────────────────────────────────────────────
   Head position dimensions: from every head, along the room's wall
   directions, to the nearest wall on each of the four sides.
   That is what the installer needs to set the head out on site.
   ────────────────────────────────────────────────────────────── */
function rayHit(o, dir, poly){
  let best=Infinity;
  for(let i=0,n=poly.length;i<n;i++){
    const a=poly[i], b=poly[(i+1)%n];
    const ex=b.x-a.x, ey=b.y-a.y;
    const den = dir.x*ey - dir.y*ex;
    if(Math.abs(den)<1e-9) continue;
    const dx=a.x-o.x, dy=a.y-o.y;
    const t=(dx*ey - dy*ex)/den;
    const u=(dx*dir.y - dy*dir.x)/den;
    if(t>0.5 && u>=-1e-6 && u<=1+1e-6 && t<best) best=t;
  }
  return best;
}
/* In each direction, measure to the next head along that line if there is
   one, otherwise to the wall. A head-to-wall figure past another head is
   no use for setting out. "Along that line" allows a lateral tolerance,
   so a head one row over does not count. */
function headWallDims(h, room){
  const ang = roomAngle(room);
  const c=Math.cos(ang), sn=Math.sin(ang);
  const dirs=[{x:c,y:sn},{x:-c,y:-sn},{x:-sn,y:c},{x:sn,y:-c}];
  const mm = mmPerPx();
  const lateral = mm ? 600/mm : 25;              // within 600 mm of the line counts
  const peers = page().heads.filter(o=>o.roomId===room.id && o.id!==h.id && isSprinkler(o));
  const out=[];
  for(const d of dirs){
    const wall = rayHit(h, d, room.polygon);
    let best = isFinite(wall) ? wall : Infinity, isHead = false;
    for(const o of peers){
      const vx=o.x-h.x, vy=o.y-h.y;
      const along = vx*d.x + vy*d.y;
      if(along <= 1) continue;                    // behind us, or on top of us
      const off = Math.abs(-vx*d.y + vy*d.x);     // perpendicular offset
      if(off > lateral) continue;
      if(along < best){ best = along; isHead = true; }
    }
    if(!isFinite(best)) continue;
    out.push({dir:d, t:best, isHead, hit:{x:h.x+d.x*best, y:h.y+d.y*best}});
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────
   Ceiling tile grid.
   A tiled ceiling shows up in the vectors as two families of parallel
   lines at a steady pitch. Rather than hunt for individual rectangles,
   look along each of the room's own axes and test whether the line
   positions repeat at a tile pitch. A steady period is what separates a
   ceiling grid from hatching or furniture.
   ────────────────────────────────────────────────────────────── */
const TILE = {sizes:[600,1200], fractions:[1/3, 1/2, 2/3],
              prefer:{"0.3333":1, "0.5000":0.6, "0.6667":1},
              tol:0.06, minLines:4, strength:0.55};
const TILE_CACHE = new Map();

function tileLines(room, ang, axis, mm){
  /* Ceiling grid lines usually run right across the floor plate, so their
     midpoint lands in some other room entirely. Judge a line by how much of
     it lies inside this room, not by where its centre happens to be. */
  if(!VEC.ready) return [];
  const xs=room.polygon.map(q=>q.x), ys=room.polygon.map(q=>q.y);
  const bx0=Math.min(...xs), bx1=Math.max(...xs), by0=Math.min(...ys), by1=Math.max(...ys);
  const minInside = 300/mm;
  const want = axis===0 ? ang+Math.PI/2 : ang;
  const out=[];
  const S=VEC.segs, n=VEC.count;
  for(let i=0;i<n && out.length<6000;i++){
    const x1=S[i*4], y1=S[i*4+1], x2=S[i*4+2], y2=S[i*4+3];
    const dx=x2-x1, dy=y2-y1;
    const len=Math.hypot(dx,dy);
    if(len < minInside) continue;
    let d=Math.atan2(dy,dx)-want;
    d=Math.atan2(Math.sin(d), Math.cos(d));
    if(Math.abs(d)>0.09 && Math.abs(Math.abs(d)-Math.PI)>0.09) continue;    // within ~5 degrees
    if(Math.max(x1,x2)<bx0 || Math.min(x1,x2)>bx1 ||
       Math.max(y1,y2)<by0 || Math.min(y1,y2)>by1) continue;                // no overlap at all
    const k=Math.min(24, Math.max(3, Math.round(len/(200/mm))));
    let inside=0, sum=0;
    for(let t=0;t<=k;t++){
      const px=x1+dx*t/k, py=y1+dy*t/k;
      if(!pointInPoly({x:px,y:py}, room.polygon)) continue;
      inside++;
      sum += axis===0 ? rotTo({x:px,y:py}, ang).x : rotTo({x:px,y:py}, ang).y;
    }
    if(!inside) continue;
    const lenInside = len*inside/(k+1);
    if(lenInside < minInside) continue;
    out.push({pos: sum/inside, len: lenInside});
  }
  return out;
}

function bestPeriod(lines, mm, diag){
  // strongest steady pitch among the configured tile sizes
  let best=null;
  if(diag) diag.lines = lines.length;
  for(const sizeMm of TILE.sizes){
    const P=sizeMm/mm;
    let sx=0, sy=0, wsum=0, distinct=new Set();
    for(const l of lines){
      const ph = 2*Math.PI*(l.pos/P);
      const w = Math.min(l.len, P*4);
      sx += Math.cos(ph)*w; sy += Math.sin(ph)*w; wsum += w;
      distinct.add(Math.round(l.pos/P*24));
    }
    if(!wsum) continue;
    const strength = Math.hypot(sx,sy)/wsum;
    if(diag && (!diag.best || strength>diag.best.strength))
      diag.best = {sizeMm, strength, lines: distinct.size};
    if(distinct.size < TILE.minLines || strength < TILE.strength) continue;
    let phase = Math.atan2(sy,sx)/(2*Math.PI);
    if(phase<0) phase+=1;
    const cand = {sizeMm, P, origin: phase*P, strength, lines: distinct.size};
    if(!best || cand.strength*cand.sizeMm > best.strength*best.sizeMm) best=cand;
  }
  return best;
}

/* The ceiling a room has, as the user declared it. A GIB (plasterboard)
   ceiling is continuous, so any lines in it are not a tile grid and are
   never snapped to. Older rooms fall back to the old on/off switch. */
function ceilingOf(room){ return room.ceiling || (room.tileSnap===false ? "gib" : "tile"); }
function isTiled(room){ return ceilingOf(room)==="tile"; }

/* The head each ceiling usually takes, as on the as-built drawings: a
   semi-recessed pendent through a tile, a concealed plate in GIB. Switching
   the ceiling only moves the head with it while the room is still on the
   old ceiling's default; a head the designer picked is left alone. */
const CEILING_HEAD = {tile:"sp-drop", gib:"sp-conc"};
function headForCeiling(room, kind){
  const was = CEILING_HEAD[ceilingOf(room)];
  if(room.headType && devId(room.headType)!==was) return room.headType;
  return devId(CEILING_HEAD[kind] || "sp-drop");
}

function tileDiag(room){ return (TILE_CACHE.get(room.id)||{}).diag || null; }

function detectTiles(room){
  const mm=mmPerPx(); if(!mm) return null;
  const ang=roomAngle(room);

  // a grid set by hand always wins
  if(room.tileManual && room.tileManual.pu>0 && room.tileManual.pv>0){
    const M=room.tileManual;
    return {ang, manual:true,
      u:{sizeMm:M.pu, P:M.pu/mm, origin:(M.ou||0)/mm, strength:1, lines:0},
      v:{sizeMm:M.pv, P:M.pv/mm, origin:(M.ov||0)/mm, strength:1, lines:0}};
  }
  if(!VEC.ready) return null;

  let sig = room.polygon.length + VEC.count*1e-7 + (room.gridMode||"").length;
  for(const q of room.polygon) sig += q.x + q.y*1.7;
  const hit=TILE_CACHE.get(room.id);
  if(hit && Math.abs(hit.sig-sig)<1e-6) return hit.t;

  const du={}, dv={};
  const u=bestPeriod(tileLines(room, ang, 0, mm), mm, du);
  const v=bestPeriod(tileLines(room, ang, 1, mm), mm, dv);
  const t = (u&&v) ? {ang, u, v} : null;
  TILE_CACHE.set(room.id, {sig, t, diag:{across:du, down:dv}});
  return t;
}

/* Allowed positions along one axis: every tile boundary plus the chosen
   fractions across each tile. Preference decides ties, so a 1/3 point wins
   over the centre when both are about equally close. */
function nearestTileStop(val, grid, fracs){
  const P=grid.P, o=grid.origin;
  const k=Math.floor((val-o)/P);
  let best=null;
  for(let kk=k-1; kk<=k+1; kk++)
    for(const f of fracs){
      const pos=o+(kk+f)*P;
      const d=Math.abs(pos-val);
      const w=TILE.prefer[f.toFixed(4)] ?? 0.8;
      const score=d/Math.max(w,0.01);
      if(!best || score<best.score) best={pos, d, score};
    }
  return best;
}

/* In a 600 x 1200 tile the head sits on the centreline of the short side,
   and a third, half or two thirds along the long side. Square tiles are
   centred both ways. */
function axisFracs(grid, other, longFracs){
  if(Math.abs(grid.sizeMm-other.sizeMm) < 1) return [0.5];
  return grid.sizeMm > other.sizeMm ? longFracs : [0.5];
}

/* Is this head sitting on an allowed tile point, within a few millimetres? */
function onTilePoint(h, t, fracs, mm){
  const r=rotTo(h, t.ang);
  const tol=15/mm;
  const near=(val,grid,fr)=>{
    const k=Math.floor((val-grid.origin)/grid.P);
    for(let kk=k-1;kk<=k+1;kk++) for(const f of fr)
      if(Math.abs(grid.origin+(kk+f)*grid.P - val) <= tol) return true;
    return false;
  };
  return near(r.x, t.u, axisFracs(t.u,t.v,fracs)) && near(r.y, t.v, axisFracs(t.v,t.u,fracs));
}

function snapToTiles(room, heads, rule, mm, ang){
  if(!isTiled(room)) return {aligned:0, total:heads.length, grid:null};
  const t=detectTiles(room);
  if(!t) return {aligned:0, total:heads.length, grid:null};
  const fracs = (room.tileFractions && room.tileFractions.length) ? room.tileFractions : TILE.fractions;
  const model=covModel();
  const half=rule.maxSpacing*1000/mm/2;
  const halfWall=Math.min(half, rule.maxWallDist*1000/mm);
  const minSp=rule.minSpacing*1000/mm;
  const minWall=(rule.minWallDist??0.1)*1000/mm;
  const S=roomSamples(room, mm);

  // the points that must stay protected, interior plus boundary
  const pts=[], rad=[];
  for(const q of S.pts){ pts.push(q); rad.push(half); }
  const bstep=Math.max(250/mm, S.step);
  for(let i=0,n=room.polygon.length;i<n;i++){
    const a=room.polygon[i], b=room.polygon[(i+1)%n];
    const len=Math.hypot(b.x-a.x,b.y-a.y), k=Math.max(1,Math.round(len/bstep));
    for(let j=0;j<k;j++) pts.push({x:a.x+(b.x-a.x)*j/k, y:a.y+(b.y-a.y)*j/k}), rad.push(halfWall);
  }
  const covered = list => {
    for(let i=0;i<pts.length;i++){
      let ok=false;
      for(const h of list) if(headCovers(pts[i].x,pts[i].y,h,ang,rad[i],model)){ ok=true; break; }
      if(!ok) return false;
    }
    return true;
  };

  let aligned=0;
  const maxMove = Math.min(t.u.P, t.v.P);          // never shove a head more than one tile
  for(const h of heads){
    if(h.locked && !h.auto) continue;
    const r=rotTo(h, ang);
    const su=nearestTileStop(r.x, t.u, axisFracs(t.u, t.v, fracs));
    const sv=nearestTileStop(r.y, t.v, axisFracs(t.v, t.u, fracs));
    if(!su||!sv) continue;
    if(su.d>maxMove || sv.d>maxMove) continue;
    const w=rotFrom({x:su.pos, y:sv.pos}, ang);
    if(!pointInPoly(w, room.polygon) || distToPoly(w, room.polygon) < minWall) continue;
    const others=heads.filter(o=>o!==h);
    if(others.some(o=>Math.hypot(o.x-w.x,o.y-w.y) < minSp)) continue;
    const trial=[...others, {x:w.x, y:w.y}];
    if(!covered(trial)) continue;                  // alignment never costs coverage
    h.x=w.x; h.y=w.y;
    aligned++;
  }
  return {aligned, total:heads.length, grid:t};
}

/* Sometimes a wall is out of reach and no head can be added to fix it,
   because every position that would cover the wall sits inside another
   head's minimum spacing. A tapering room does this: near the point of a
   wedge there is room for one head, and the even grid puts it slightly too
   far from the sloping wall. A designer would not add a head there, they
   would slide the one that is already there. So: shift the nearest head
   along the grid axes by the least amount that brings the wall into range,
   and keep the move only if nothing else comes uncovered. */
function pullHeads(room, heads, rule, mm, ang){
  const model=covModel();
  const half = rule.maxSpacing*1000/mm/2;
  const halfWall = Math.min(half, rule.maxWallDist*1000/mm);
  const minSp = rule.minSpacing*1000/mm;
  const minWall = (rule.minWallDist??0.1)*1000/mm;
  const S = roomSamples(room, mm);

  const pts=[], rad=[];
  for(const q of S.pts){ pts.push(q); rad.push(half); }
  const bstep = Math.max(250/mm, S.step);
  for(let i=0,n=room.polygon.length;i<n;i++){
    const a=room.polygon[i], b=room.polygon[(i+1)%n];
    const len=Math.hypot(b.x-a.x,b.y-a.y), k=Math.max(1,Math.round(len/bstep));
    for(let t=0;t<k;t++){ pts.push({x:a.x+(b.x-a.x)*t/k, y:a.y+(b.y-a.y)*t/k}); rad.push(halfWall); }
  }
  const allCovered = list => {
    const idx=headIndex(list, half);
    for(let i=0;i<pts.length;i++)
      if(!coveredAt(idx, pts[i].x, pts[i].y, ang, rad[i], model)) return false;
    return true;
  };

  let moved=0, guard=0;
  while(guard++ < 12){
    let bad=null;
    const idxH=headIndex(heads, half);
    for(let i=0;i<pts.length;i++){
      if(!coveredAt(idxH, pts[i].x, pts[i].y, ang, rad[i], model)){ bad={p:pts[i], r:rad[i]}; break; }
    }
    if(!bad) break;

    const B = rotTo(bad.p, ang);
    const options=[];
    /* The least shift that reaches the wall often lands the head right up
       against it, where it cannot be installed. So try that position and a
       few just inboard of it, and take the smallest move that survives every
       check. */
    const nudges=[0, 1, 2, 3, 4].map(k => k*minWall);
    for(const h of heads){
      if(h.locked && !h.auto) continue;
      const H = rotTo(h, ang);
      const du0 = Math.abs(B.x-H.x) > bad.r ? (B.x-H.x) - Math.sign(B.x-H.x)*bad.r : 0;
      const dv0 = Math.abs(B.y-H.y) > bad.r ? (B.y-H.y) - Math.sign(B.y-H.y)*bad.r : 0;
      if(!du0 && !dv0) continue;
      for(const a of nudges) for(const b of nudges){
        for(const sa of (a?[-1,1]:[0])) for(const sb of (b?[-1,1]:[0])){
          const du=du0+sa*a, dv=dv0+sb*b;
          if(Math.abs(B.x-(H.x+du)) > bad.r + 1e-9) continue;   // must still reach
          if(Math.abs(B.y-(H.y+dv)) > bad.r + 1e-9) continue;
          const shift=Math.hypot(du,dv);
          if(shift > half) continue;
          options.push({h, w: rotFrom({x:H.x+du, y:H.y+dv}, ang), shift});
        }
      }
    }
    options.sort((a,b)=>a.shift-b.shift);

    let done=false;
    for(const o of options){
      if(!pointInPoly(o.w, room.polygon) || distToPoly(o.w, room.polygon) < minWall) continue;
      if(heads.some(x=>x!==o.h && Math.hypot(x.x-o.w.x, x.y-o.w.y) < minSp)) continue;
      const old={x:o.h.x, y:o.h.y};
      o.h.x=o.w.x; o.h.y=o.w.y;
      if(allCovered(heads)){ moved++; done=true; break; }
      o.h.x=old.x; o.h.y=old.y;
    }
    if(!done) break;
  }
  return moved;
}

/* Drop any head the layout does not need. A head can go when every point
   it protects is already protected by another head, the area per head stays
   within the rule, and no wall point is left beyond reach. Grid rows that
   only exist because the bounding box was oversized disappear here. */
function pruneHeads(room, heads, rule, mm, ang){
  const model=covModel();
  const half = rule.maxSpacing*1000/mm/2;
  const halfWall = Math.min(half, rule.maxWallDist*1000/mm);
  const areaM2 = polyArea(room.polygon)*mm*mm/1e6;
  const S = roomSamples(room, mm);

  // interior points, plus the boundary so wall reach is respected
  const pts=[], rad=[];
  for(const q of S.pts){ pts.push(q); rad.push(half); }
  const bstep = Math.max(250/mm, S.step);
  for(let i=0,n=room.polygon.length;i<n;i++){
    const a=room.polygon[i], b=room.polygon[(i+1)%n];
    const len=Math.hypot(b.x-a.x,b.y-a.y), k=Math.max(1,Math.round(len/bstep));
    for(let t=0;t<k;t++){ pts.push({x:a.x+(b.x-a.x)*t/k, y:a.y+(b.y-a.y)*t/k}); rad.push(halfWall); }
  }

  const covers = new Array(heads.length);
  const count = new Int32Array(pts.length);
  /* Same trick in reverse: bin the points, then ask each head only about
     the points inside its own reach. */
  const pcell = Math.max(half, 1e-6);
  const pmap = new Map();
  for(let i=0;i<pts.length;i++){
    const k = Math.floor(pts[i].x/pcell)*100000 + Math.floor(pts[i].y/pcell);
    let a = pmap.get(k); if(!a){ a=[]; pmap.set(k,a); }
    a.push(i);
  }
  for(let hi=0;hi<heads.length;hi++){
    const h=heads[hi], list=[];
    const cx=Math.floor(h.x/pcell), cy=Math.floor(h.y/pcell);
    const span=Math.max(1, Math.ceil(half/pcell));
    for(let dx=-span; dx<=span; dx++) for(let dy=-span; dy<=span; dy++){
      const a=pmap.get((cx+dx)*100000+(cy+dy)); if(!a) continue;
      for(const i of a)
        if(headCovers(pts[i].x, pts[i].y, h, ang, rad[i], model)){ list.push(i); count[i]++; }
    }
    covers[hi]=list;
  }

  // try repair heads first, then the ones covering least unique ground
  const order = heads.map((h,i)=>i).sort((a,b)=>
    (heads[a].src==="repair"?0:1)-(heads[b].src==="repair"?0:1) || covers[a].length-covers[b].length);

  const dead=new Set();
  for(const hi of order){
    if(dead.size >= heads.length-1) break;
    const h=heads[hi];
    if(h.locked || !h.auto) continue;
    const left = heads.length-dead.size-1;
    if(left<1 || areaM2/left > rule.maxAreaPerHead + 1e-9) continue;
    let ok=true;
    for(const i of covers[hi]) if(count[i]<2){ ok=false; break; }
    if(!ok) continue;
    dead.add(hi);
    for(const i of covers[hi]) count[i]--;
  }
  return heads.filter((_,i)=>!dead.has(i));
}

/* Full layout: grid, nudge dropped grid points back inside, then repair. */
function autoHeads(room, keep){
  const mm = mmPerPx(); if(!mm) return [];
  keep = keep||[];
  const rule = ruleFor(room);
  const {ang,x0,x1,y0,y1} = roomFrame(room);
  const Wm=(x1-x0)*mm/1000, Lm=(y1-y0)*mm/1000;
  const areaM2 = polyArea(room.polygon)*mm*mm/1e6;
  const minWall = (rule.minWallDist??0.1)*1000/mm;
  const minSp = rule.minSpacing*1000/mm;
  const valid = p => pointInPoly(p, room.polygon) && distToPoly(p, room.polygon) >= minWall;

  // a grid point outside the room is walked back in along the grid axes
  const nudge = P => {
    const w=rotFrom(P,ang); if(valid(w)) return w;
    const maxD=rule.maxWallDist*1000/mm, stepD=100/mm;
    for(let d=stepD; d<=maxD; d+=stepD)
      for(const q of [{x:P.x+d,y:P.y},{x:P.x-d,y:P.y},{x:P.x,y:P.y+d},{x:P.x,y:P.y-d}]){
        const ww=rotFrom(q,ang); if(valid(ww)) return ww;
      }
    return null;
  };

  let nx=gridCounts(Wm,rule), ny=gridCounts(Lm,rule);
  const need=Math.max(1, Math.ceil(areaM2/rule.maxAreaPerHead));

  // Where a ceiling grid is present, put the rows and columns on tile
  // points to begin with. Nudging finished heads never works: a layout that
  // is already at its area limit has no slack to give.
  const tiles = isTiled(room) ? detectTiles(room) : null;
  const fracs = (room.tileFractions && room.tileFractions.length) ? room.tileFractions : TILE.fractions;
  const maxSp = rule.maxSpacing*1000/mm, maxWall = rule.maxWallDist*1000/mm;
  const snapAxis = (vals, grid) => {
    if(!grid) return vals;
    const other = grid===tiles.u ? tiles.v : tiles.u;
    const fr = axisFracs(grid, other, fracs);
    const out = vals.map(v=>{ const st=nearestTileStop(v, grid, fr); return st? st.pos : v; });
    for(let i=1;i<out.length;i++) if(out[i]<=out[i-1]+1e-6) out[i]=vals[i];   // keep them in order
    return out;
  };
  const spacingOk = (vals, lo, hi) => {
    if(!vals.length) return false;
    if(vals[0]-lo > maxWall+1e-6 || hi-vals[vals.length-1] > maxWall+1e-6) return false;
    for(let i=1;i<vals.length;i++) if(vals[i]-vals[i-1] > maxSp+1e-6) return false;
    return true;
  };

  // The even spacing that satisfies the rule rarely lands on tile points on
  // its own. Where it does not, one extra row or column usually creates the
  // slack needed, and more heads can never break the area-per-head limit.
  const extra = room.tileExtra===false ? 0 : 2;
  const evenly=(n,lo,hi)=>{ const v=[]; for(let i=0;i<n;i++) v.push(lo+(i+0.5)*(hi-lo)/n); return v; };
  const fitAxis=(n0, lo, hi, grid)=>{
    if(!grid) return {vals:evenly(n0,lo,hi), n:n0, snapped:false};
    for(let add=0; add<=extra; add++){
      const sn=snapAxis(evenly(n0+add,lo,hi), grid);
      if(spacingOk(sn, lo, hi)) return {vals:sn, n:n0+add, snapped:true};
    }
    return {vals:evenly(n0,lo,hi), n:n0, snapped:false};
  };
  const build=(nx,ny)=>{
    const U=fitAxis(nx, x0, x1, tiles?tiles.u:null);
    const V=fitAxis(ny, y0, y1, tiles?tiles.v:null);
    const out=[];
    for(const rv of V.vals) for(const cu of U.vals){ const w=nudge({x:cu,y:rv}); if(w) out.push(w); }
    return {cols:U.vals, rows:V.vals, out, tiled:U.snapped&&V.snapped, nx:U.n, ny:V.n};
  };
  let g=build(nx,ny), guard=0;
  while(g.out.length<need && guard++<40){ if((x1-x0)/nx >= (y1-y0)/ny) nx++; else ny++; g=build(nx,ny); }

  const placed=[...keep], grid=[];
  for(const w of g.out){
    if(placed.every(h=>Math.hypot(h.x-w.x,h.y-w.y) >= minSp*0.98)){ placed.push(w); grid.push(w); }
  }

  // candidate positions along the grid lines, so repair heads stay aligned
  const cands=[], stepL=250/mm;
  for(const cu of g.cols) for(let v=y0; v<=y1; v+=stepL){ const w=rotFrom({x:cu,y:v},ang); if(valid(w)) cands.push({x:w.x,y:w.y,tier:2}); }
  for(const rv of g.rows) for(let u=x0; u<=x1; u+=stepL){ const w=rotFrom({x:u,y:rv},ang); if(valid(w)) cands.push({x:w.x,y:w.y,tier:2}); }

  const added = repairCoverage(room, placed, rule, mm, ang, cands);
  const mk = (p,src)=>({id:uid("h_"), roomId:room.id, x:p.x, y:p.y, type:devId(room.headType), auto:true, src});
  let list = [...grid.map(p=>mk(p,"grid")), ...added.map(p=>mk(p,"repair"))];
  if(list.length) list = pruneHeads(room, [...keep, ...list], rule, mm, ang).filter(h=>!keep.includes(h));
  if(list.length) pullHeads(room, [...keep, ...list], rule, mm, ang);
  if(list.length) snapToTiles(room, [...keep, ...list], rule, mm, ang);
  if(tiles) for(const h of list) h.tile = onTilePoint(h, tiles, fracs, mm);
  return list;
}

function regenerateHeads(room){
  const p = page();
  const keep = p.heads.filter(h => h.roomId === room.id && !h.auto && h.locked && isSprinkler(h));
  p.heads = p.heads.filter(h => h.roomId !== room.id || (!h.auto && h.locked) || !isSprinkler(h));
  if(room.autoLayout !== false) p.heads.push(...autoHeads(room, keep));
  save();
}