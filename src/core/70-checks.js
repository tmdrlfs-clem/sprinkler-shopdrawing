
/* ══════════════════════════════════════════════════════════════
   4. Compliance checks
   ══════════════════════════════════════════════════════════════ */

const ANALYSIS = new Map();                   // roomId to result, so the draw loop never recomputes
function recomputeAnalysis(){
  ANALYSIS.clear();
  for(const r of page().rooms) ANALYSIS.set(r.id, analyse(r));
}
const cached = room => ANALYSIS.get(room.id) || analyse(room);

function analyse(room){
  const mm = mmPerPx();
  const heads = page().heads.filter(h=>h.roomId===room.id && isSprinkler(h));
  const r = ruleFor(room);
  const res = {heads:heads.length, flags:[], pass:[], areaM2:null};
  if(!mm){ res.flags.push("No scale set, so nothing can be checked."); return res; }

  const areaM2 = polyArea(room.polygon)*mm*mm/1e6;
  res.areaM2 = areaM2;
  const fr0 = roomFrame(room);
  const rect = {w:fr0.x1-fr0.x0, h:fr0.y1-fr0.y0};
  res.wM = rect.w*mm/1000; res.lM = rect.h*mm/1000;
  res.perimM = polyPerimeter(room.polygon)*mm/1000;

  res.required = Math.max(1, Math.ceil(areaM2 / r.maxAreaPerHead));
  if(!heads.length){
    // still work out what is uncovered: the whole room, as one gap
    res.flags.push("No heads placed.");
    const S0 = roomSamples(room, mm);
    const unc0 = S0.pts.map((_,i)=>i);
    res.coverage = 0; res.gaps = gapClusters(S0, unc0, mm); res.gapArea = areaM2; res.sampleStep = S0.step;
    res.tightHeads = [];
    return res;
  }
  res.perHead  = areaM2 / heads.length;
  if(res.perHead > r.maxAreaPerHead + 1e-6)
    res.flags.push(`Area per head ${res.perHead.toFixed(1)} m² exceeds the ${r.maxAreaPerHead} m² limit — at least ${res.required} heads needed`);
  else res.pass.push(`Area per head ${res.perHead.toFixed(1)} m² within ${r.maxAreaPerHead} m²`);

  // nearest-neighbour spacing
  let maxNN=0, minNN=Infinity;
  for(const a of heads){
    let d=Infinity;
    for(const b of heads) if(a!==b) d=Math.min(d, Math.hypot(a.x-b.x,a.y-b.y)*mm/1000);
    if(d<Infinity){ maxNN=Math.max(maxNN,d); minNN=Math.min(minNN,d); }
  }
  res.maxSpacing = maxNN||0; res.minSpacing = (minNN===Infinity?0:minNN);
  if(heads.length>1){
    if(maxNN > r.maxSpacing + 1e-6) res.flags.push(`Widest head spacing ${maxNN.toFixed(2)} m exceeds ${r.maxSpacing} m`);
    else res.pass.push(`Widest head spacing ${maxNN.toFixed(2)} m within ${r.maxSpacing} m`);
    if(minNN < r.minSpacing - 1e-6) res.flags.push(`Closest head spacing ${minNN.toFixed(2)} m is under ${r.minSpacing} m — risk of skipping`);
  }

  const ang = roomFrame(room).ang;
  const half = r.maxSpacing*1000/mm/2, model=covModel();
  const minWall = (r.minWallDist??0.1)*1000/mm;

  // heads sitting too close to a wall to install
  const tight = heads.filter(h => distToPoly(h, room.polygon) < minWall - 1e-6);
  res.tightHeads = tight.map(h=>h.id);
  if(tight.length) res.flags.push(`${tight.length} head${tight.length>1?"s":""} closer than ${(r.minWallDist??0.1)} m to a wall`);

  // wall distance: every boundary point must be within a head's reach
  const stepPx = 300/mm;
  let worstWall=0;
  const reach = (px,py) => {
    let best=Infinity;
    for(const h of heads){
      const dx=px-h.x, dy=py-h.y;
      const d = model==="circle" ? Math.hypot(dx,dy)/Math.SQRT2
        : Math.max(Math.abs(dx*Math.cos(ang)+dy*Math.sin(ang)), Math.abs(-dx*Math.sin(ang)+dy*Math.cos(ang)));
      if(d<best) best=d;
    }
    return best;
  };
  for(let i=0,n=room.polygon.length;i<n;i++){
    const a=room.polygon[i], b=room.polygon[(i+1)%n];
    const len=Math.hypot(b.x-a.x,b.y-a.y), k=Math.max(1,Math.round(len/stepPx));
    for(let t=0;t<=k;t++) worstWall=Math.max(worstWall, reach(a.x+(b.x-a.x)*t/k, a.y+(b.y-a.y)*t/k)*mm/1000);
  }
  res.wallDist = worstWall;
  if(worstWall > r.maxWallDist + 1e-6)
    res.flags.push(`Furthest wall point is ${worstWall.toFixed(2)} m from a head, over the ${r.maxWallDist} m limit`);
  else res.pass.push(`Furthest wall point ${worstWall.toFixed(2)} m, within ${r.maxWallDist} m`);

  // coverage: same sample lattice and model the layout engine uses
  const S = roomSamples(room, mm);
  const unc = uncoveredSamples(S, heads, ang, half, model);
  res.coverage = S.pts.length ? 1-unc.length/S.pts.length : 1;
  res.gaps = gapClusters(S, unc, mm).filter(g=>g.area>=0.05);
  res.gapArea = res.gaps.reduce((a,g)=>a+g.area,0);
  res.sampleStep = S.step;
  if(res.gaps.length)
    res.flags.push(`${res.gaps.length} uncovered ${res.gaps.length>1?"areas":"area"}, ${res.gapArea.toFixed(2)} m² in total (largest ${res.gaps[0].area.toFixed(2)} m²)`);
  else res.pass.push(`Coverage complete (${model==="rect"?"S×S square":"corner-radius circle"} rule)`);

  if(!r.verified) res.flags.push("The rule figures for this hazard class have not been marked as checked.");
  return res;
}