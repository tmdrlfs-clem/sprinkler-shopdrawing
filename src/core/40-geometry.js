
/* ══════════════════════════════════════════════════════════════
   2. Geometry
   ══════════════════════════════════════════════════════════════ */

function polyArea(pts){                       // shoelace, px^2
  let a=0;
  for(let i=0,n=pts.length;i<n;i++){ const p=pts[i], q=pts[(i+1)%n]; a += p.x*q.y - q.x*p.y; }
  return Math.abs(a)/2;
}
function polyCentroid(pts){
  let x=0, y=0;
  for(const p of pts){ x+=p.x; y+=p.y; }
  return {x:x/pts.length, y:y/pts.length};
}
function polyPerimeter(pts){
  let s=0;
  for(let i=0,n=pts.length;i<n;i++){ const p=pts[i], q=pts[(i+1)%n]; s += Math.hypot(q.x-p.x, q.y-p.y); }
  return s;
}
function pointInPoly(pt, pts){
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y;
    if(((yi>pt.y)!==(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function distToSeg(p,a,b){
  const dx=b.x-a.x, dy=b.y-a.y, L=dx*dx+dy*dy;
  if(L===0) return Math.hypot(p.x-a.x,p.y-a.y);
  let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/L; t=Math.max(0,Math.min(1,t));
  return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
}
function distToPoly(p, pts){
  let m=Infinity;
  for(let i=0,n=pts.length;i<n;i++) m=Math.min(m, distToSeg(p, pts[i], pts[(i+1)%n]));
  return m;
}
function convexHull(pts){
  const p=[...pts].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(p.length<3) return p;
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo=[],up=[];
  for(const q of p){ while(lo.length>=2 && cross(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop(); lo.push(q); }
  for(let i=p.length-1;i>=0;i--){ const q=p[i]; while(up.length>=2 && cross(up[up.length-2],up[up.length-1],q)<=0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
const rotTo   = (p,a)=>({x: p.x*Math.cos(a)+p.y*Math.sin(a), y:-p.x*Math.sin(a)+p.y*Math.cos(a)});
const rotFrom = (P,a)=>({x: P.x*Math.cos(a)-P.y*Math.sin(a), y: P.x*Math.sin(a)+P.y*Math.cos(a)});

function minAreaRect(pts){                    // smallest enclosing rectangle, any rotation
  const h = convexHull(pts);
  if(h.length<3){
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
    return {angle:0, cx:(Math.min(...xs)+Math.max(...xs))/2, cy:(Math.min(...ys)+Math.max(...ys))/2,
            w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys)};
  }
  let best=null;
  for(let i=0;i<h.length;i++){
    const p=h[i], q=h[(i+1)%h.length];
    const a=Math.atan2(q.y-p.y, q.x-p.x);
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const t of h){ const r=rotTo(t,a); if(r.x<x0)x0=r.x; if(r.x>x1)x1=r.x; if(r.y<y0)y0=r.y; if(r.y>y1)y1=r.y; }
    const area=(x1-x0)*(y1-y0);
    if(!best || area<best.area) best={area, a, x0,x1,y0,y1};
  }
  const c = rotFrom({x:(best.x0+best.x1)/2, y:(best.y0+best.y1)/2}, best.a);
  return {angle:best.a, cx:c.x, cy:c.y, w:best.x1-best.x0, h:best.y1-best.y0};
}