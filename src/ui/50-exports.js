
/* ══════════════════════════════════════════════════════════════
   9. Exports
   ══════════════════════════════════════════════════════════════ */

const q = v => `"${String(v??"").replace(/"/g,'""')}"`;
function download(name, content, mime){
  const blob = content instanceof Blob? content : new Blob([content], {type:mime||"text/plain;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name;
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
function exportRoomsCsv(){
  const rows=[["Page","Room","Hazard","Area m2","Bounding W m","Bounding L m","Ceiling m","Ceiling type","Head type","Heads","Min required","Area per head m2","Max spacing m","Min spacing m","Max wall dist m","Coverage %","Issues","Notes"]];
  for(const [k,pg] of Object.entries(state.doc.pages)){
    const saved=state.pageNum; state.pageNum=parseInt(k,10);
    for(const r of pg.rooms){
      const a=analyse(r);
      rows.push([k, r.name, r.hazard, a.areaM2?.toFixed(2)??"", a.wM?.toFixed(2)??"", a.lM?.toFixed(2)??"",
        r.ceilingH, r.ceilingType, r.headType, a.heads, a.required??"", a.perHead?.toFixed(2)??"",
        a.maxSpacing?.toFixed(2)??"", a.minSpacing?.toFixed(2)??"", a.wallDist?.toFixed(2)??"",
        a.coverage!==undefined?(a.coverage*100).toFixed(0):"", a.flags.join(" | "), r.notes]);
    }
    state.pageNum=saved;
  }
  download("room-schedule.csv", "\uFEFF"+rows.map(r=>r.map(q).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}
function exportHeadsCsv(){
  const rows=[["Page","Head","Room","Type","K","X mm","Y mm"]];
  for(const [k,pg] of Object.entries(state.doc.pages)){
    if(!pg.scale){ continue; }
    const o=pg.origin||{x:0,y:0};
    for(const h of pg.heads){
      const room=pg.rooms.find(r=>r.id===h.roomId);
      const t=devOf(h.type);
      rows.push([k, h.id, room?room.name:"", t?t.label:h.type, t?(t.k||""):"",
        ((h.x-o.x)*pg.scale).toFixed(1), ((o.y-h.y)*pg.scale).toFixed(1)]);
    }
  }
  if(rows.length===1){ toast("No page has a scale, so there are no coordinates to export."); return; }
  download("head-coordinates.csv", "\uFEFF"+rows.map(r=>r.map(q).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}
function exportMeasCsv(){
  const rows=[["Page","Name","Segments","Length mm","Length m","Angle deg"]];
  for(const [k,pg] of Object.entries(state.doc.pages)){
    (pg.measures||[]).forEach((m,i)=>{
      let px=0; for(let j=1;j<m.pts.length;j++) px+=Math.hypot(m.pts[j].x-m.pts[j-1].x, m.pts[j].y-m.pts[j-1].y);
      const mm = pg.scale? px*pg.scale : null;
      const ang = m.pts.length===2 ? segAngle(m.pts[0],m.pts[1]).toFixed(1) : "";
      rows.push([k, m.label||("Measurement "+(i+1)), m.pts.length-1,
        mm!==null?mm.toFixed(0):"", mm!==null?(mm/1000).toFixed(3):"", ang]);
    });
  }
  if(rows.length===1){ toast("Nothing measured yet."); return; }
  download("measurements.csv", "\uFEFF"+rows.map(r=>r.map(q).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}
function exportDeviceCsv(){
  const rows=[["Page","Group","Device","Description","K","Qty"]];
  for(const [k,pg] of Object.entries(state.doc.pages)){
    const counts=new Map();
    for(const h of (pg.heads||[])) counts.set(devId(h.type),(counts.get(devId(h.type))||0)+1);
    for(const [id,n] of counts){ const d=devOf(id); rows.push([k, d.group, d.label, d.desc, d.k||"", n]); }
  }
  if(rows.length===1){ toast("No devices placed yet."); return; }
  download("device-schedule.csv", "\uFEFF"+rows.map(r=>r.map(q).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}
function exportPng(){
  if(!state.pdfCanvas) return;
  const c=document.createElement("canvas");
  c.width=state.pdfCanvas.width; c.height=state.pdfCanvas.height;
  const g=c.getContext("2d");
  g.drawImage(state.pdfCanvas,0,0);
  const p=page(), mm=p.scale;
  for(const room of p.rooms){
    g.beginPath(); room.polygon.forEach((q2,i)=> i?g.lineTo(q2.x,q2.y):g.moveTo(q2.x,q2.y)); g.closePath();
    g.fillStyle="rgba(53,184,166,.16)"; g.fill();
    g.strokeStyle="#12857a"; g.lineWidth=3; g.stroke();
    const cx=room.polygon.reduce((a,q2)=>a+q2.x,0)/room.polygon.length;
    const cy=room.polygon.reduce((a,q2)=>a+q2.y,0)/room.polygon.length;
    const area=mm? (polyArea(room.polygon)*mm*mm/1e6).toFixed(1)+" m²" : "";
    g.font="600 22px 'IBM Plex Sans', sans-serif"; g.textAlign="center";
    g.fillStyle="rgba(255,255,255,.9)";
    const label=`${room.name}  ${area}  ${room.hazard}`;
    const w=g.measureText(label).width+16;
    g.fillRect(cx-w/2, cy-18, w, 30);
    g.fillStyle="#0b2b28"; g.fillText(label, cx, cy+3);
  }
  for(const ms of p.measures){
    g.beginPath(); ms.pts.forEach((q2,i)=> i?g.lineTo(q2.x,q2.y):g.moveTo(q2.x,q2.y));
    g.strokeStyle="#2f4fd0"; g.lineWidth=3; g.stroke();
    let px=0; for(let j=1;j<ms.pts.length;j++) px+=Math.hypot(ms.pts[j].x-ms.pts[j-1].x, ms.pts[j].y-ms.pts[j-1].y);
    const txt = mm? Math.round(px*mm).toLocaleString("en-US")+" mm" : px.toFixed(0)+" px";
    const a=ms.pts[ms.pts.length-2], b=ms.pts[ms.pts.length-1];
    const cx2=(a.x+b.x)/2, cy2=(a.y+b.y)/2;
    g.font="600 20px 'IBM Plex Mono', monospace"; g.textAlign="center";
    const w2=g.measureText(txt).width+14;
    g.fillStyle="rgba(255,255,255,.92)"; g.fillRect(cx2-w2/2, cy2-26, w2, 26);
    g.fillStyle="#1a2c7a"; g.fillText(txt, cx2, cy2-7);
  }
  for(const h of p.heads){
    g.beginPath(); g.arc(h.x,h.y,10,0,7); g.strokeStyle="#b5721a"; g.lineWidth=3; g.stroke();
    g.beginPath(); g.moveTo(h.x-10,h.y); g.lineTo(h.x+10,h.y); g.moveTo(h.x,h.y-10); g.lineTo(h.x,h.y+10); g.stroke();
  }
  c.toBlob(b=>download(baseName()+`-p${state.pageNum}-markup.png`, b), "image/png");
}
async function exportPdf(){
  if(!state.pdfBytes){ toast("Open a PDF first."); return; }
  if(typeof PDFLib==="undefined"){ toast("The PDF writer did not load. Check the connection and reload."); return; }
  toast("Writing the PDF…");
  await new Promise(r=>setTimeout(r,30));
  try{
    const {PDFDocument, StandardFonts, rgb} = PDFLib;
    const out = await PDFDocument.load(state.pdfBytes.slice(0));
    const font  = await out.embedFont(StandardFonts.Helvetica);
    const fontB = await out.embedFont(StandardFonts.HelveticaBold);
    const COL = {
      room: rgb(0.07,0.52,0.47), head: rgb(0.60,0.33,0.04),
      dimW: rgb(0.16,0.28,0.60), dimH: rgb(0.62,0.42,0.05),
      meas: rgb(0.12,0.25,0.72), ink: rgb(0.08,0.09,0.10), paper: rgb(1,1,1)
    };
    let pagesDone = 0;

    for(const [k,pg] of Object.entries(state.doc.pages)){
      const idx = parseInt(k,10)-1;
      if(idx<0 || idx>=out.getPageCount()) continue;
      const rooms=pg.rooms||[], heads=pg.heads||[], measures=pg.measures||[];
      if(!rooms.length && !measures.length && !heads.length) continue;

      const jsPage = await state.pdf.getPage(idx+1);
      const base = jsPage.getViewport({scale:1});
      const rs = Math.min(6, 3400/Math.max(base.width, base.height));
      const vp = jsPage.getViewport({scale:rs});
      const P = q => { const t = vp.convertToPdfPoint(q.x, q.y); return {x:t[0], y:t[1]}; };
      const page = out.getPage(idx);

      const sheet = Math.max(base.width, base.height);
      const LW  = Math.max(0.5, sheet/2000);
      const HR  = Math.max(3, sheet/260);
      const FS  = Math.max(5, sheet/280);
      const FSL = Math.max(6, sheet/220);
      const mm  = pg.scale;

      const line = (a,b,color,w,dash) => {
        page.drawLine({start:P(a), end:P(b), thickness:w||LW, color, dashArray:dash});
      };
      const boxedText = (txt, at, size, color, bold) => {
        const f = bold?fontB:font;
        const w = f.widthOfTextAtSize(txt,size)+size*0.6, h = size*1.45;
        const c = P(at);
        page.drawRectangle({x:c.x-w/2, y:c.y-h/2, width:w, height:h,
          color:COL.paper, opacity:0.85, borderColor:color, borderWidth:LW*0.6});
        page.drawText(txt,{x:c.x-w/2+size*0.3, y:c.y-size*0.36, size, font:f, color});
      };

      for(const room of rooms){
        for(let i=0;i<room.polygon.length;i++)
          line(room.polygon[i], room.polygon[(i+1)%room.polygon.length], COL.room, LW*2);
        const cx=room.polygon.reduce((a,q)=>a+q.x,0)/room.polygon.length;
        const cy=room.polygon.reduce((a,q)=>a+q.y,0)/room.polygon.length;
        const area = mm ? (polyArea(room.polygon)*mm*mm/1e6).toFixed(1)+" m2" : "";
        boxedText(room.name, {x:cx, y:cy - FSL*1.1/rs}, FSL, COL.ink, true);
        boxedText(`${area}  ${room.hazard}`, {x:cx, y:cy + FSL*1.1/rs}, FS, COL.room, false);
      }

      if(state.dims!=="off"){
        const saved=state.pageNum; state.pageNum=idx+1;
        for(const room of rooms) for(const h of heads){
          if(h.roomId!==room.id) continue;
          for(const d of headWallDims(h, room)){
            const col = d.isHead? COL.dimH : COL.dimW;
            line(h, d.hit, col, LW*0.8, d.isHead? undefined : [3,2]);
            const txt = mm ? String(Math.round(d.t*mm)) : Math.round(d.t)+"px";
            boxedText(txt, {x:(h.x+d.hit.x)/2, y:(h.y+d.hit.y)/2}, FS, col, false);
          }
        }
        state.pageNum=saved;
      }

      const hexRgb = hx => { const n=parseInt(hx.slice(1),16); return rgb(((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255); };
      const symbol = (c, r, d, lw) => {
        const col = hexRgb(d.color||"#e4573d");
        if(d.shape==="square"){
          const pts=[{x:c.x-r,y:c.y-r},{x:c.x+r,y:c.y-r},{x:c.x+r,y:c.y+r},{x:c.x-r,y:c.y+r}];
          if(d.fill) page.drawRectangle({x:c.x-r, y:c.y-r, width:r*2, height:r*2, color:col});
          else for(let i=0;i<4;i++) page.drawLine({start:pts[i], end:pts[(i+1)%4], thickness:lw, color:col});
        }else if(d.shape==="triangle" || d.shape==="diamond"){
          const pts = d.shape==="triangle"
            ? [{x:c.x,y:c.y+r},{x:c.x+r*0.92,y:c.y-r*0.72},{x:c.x-r*0.92,y:c.y-r*0.72}]
            : [{x:c.x,y:c.y+r},{x:c.x+r,y:c.y},{x:c.x,y:c.y-r},{x:c.x-r,y:c.y}];
          for(let i=0;i<pts.length;i++) page.drawLine({start:pts[i], end:pts[(i+1)%pts.length], thickness:lw, color:col});
        }else{
          if(d.fill) page.drawCircle({x:c.x, y:c.y, size:r, color:col});
          else page.drawCircle({x:c.x, y:c.y, size:r, borderColor:col, borderWidth:lw});
        }
        if(d.dot && !d.fill) page.drawCircle({x:c.x, y:c.y, size:r*0.34, color:col});
        if(d.letter) page.drawText(d.letter, {x:c.x+r*0.8, y:c.y+r*0.45, size:r*0.9, font, color:hexRgb("#2f6fd0")});
      };
      for(const h of heads) symbol(P(h), HR, devOf(h.type), LW*1.6);

      // legend
      if(pg.legend?.show!==false){
        const savedPage=state.pageNum; state.pageNum=idx+1;
        const savedCanvas=state.pdfCanvas;
        state.pdfCanvas={width:vp.width, height:vp.height};
        const G=legendData();
        state.pdfCanvas=savedCanvas; state.pageNum=savedPage;
        if(G.rows.length){
          const S=v=>v/rs;                        // render px to points
          const R=(x,y)=>P({x,y});
          const total=G.rows.reduce((a,r)=>a+r.n,0);
          const box=(x,y,w,h,fill)=>{
            const c0=R(x,y+h), c1=R(x+w,y);
            page.drawRectangle({x:Math.min(c0.x,c1.x), y:Math.min(c0.y,c1.y),
              width:Math.abs(c1.x-c0.x), height:Math.abs(c1.y-c0.y),
              color:fill, borderColor:COL.ink, borderWidth:LW*0.8});
          };
          const txt=(t,x,y,size,f,color)=>page.drawText(String(t), {x:R(x,y).x, y:R(x,y).y, size:S(size), font:f, color});
          box(G.x, G.y, G.w, G.h, rgb(1,1,1));
          box(G.x, G.y, G.w, G.headH, rgb(0.90,0.92,0.94));
          txt(G.L.title||"LEGEND", G.x+G.u*0.5, G.y+G.headH*0.62, G.u*0.78, fontB, COL.ink);
          const qtyR = font.widthOfTextAtSize("QTY", S(G.u*0.62));
          txt("QTY", G.x+G.w-G.u*0.5-qtyR*rs, G.y+G.headH*0.6, G.u*0.62, font, COL.ink);
          let cy=G.y+G.headH;
          for(const r of G.rows){
            const a=R(G.x,cy), b=R(G.x+G.w,cy);
            page.drawLine({start:a, end:b, thickness:LW*0.5, color:COL.ink});
            symbol(R(G.x+G.symW/2, cy+r.h/2), S(G.u*0.62), r.d, LW*0.9);
            r.lines.forEach((ln,i)=> txt(ln, G.x+G.symW+G.u*0.2, cy+G.u*0.95+i*G.lineH, G.u*0.55, font, COL.ink));
            const qw = fontB.widthOfTextAtSize(String(r.n), S(G.u*0.72));
            txt(r.n, G.x+G.w-G.u*0.7-qw*rs, cy+r.h/2+G.u*0.2, G.u*0.72, fontB, COL.ink);
            for(const vx of [G.x+G.symW, G.x+G.symW+G.descW])
              page.drawLine({start:R(vx,cy), end:R(vx,cy+r.h), thickness:LW*0.5, color:COL.ink});
            cy+=r.h;
          }
          page.drawLine({start:R(G.x,cy), end:R(G.x+G.w,cy), thickness:LW*0.9, color:COL.ink});
          txt("TOTAL DEVICES", G.x+G.u*0.5, cy+G.u*1.0, G.u*0.6, fontB, COL.ink);
          const tw = fontB.widthOfTextAtSize(String(total), S(G.u*0.72));
          txt(total, G.x+G.w-G.u*0.7-tw*rs, cy+G.u*1.0, G.u*0.72, fontB, COL.ink);
        }
      }

      for(const ms of measures){
        for(let i=1;i<ms.pts.length;i++) line(ms.pts[i-1], ms.pts[i], COL.meas, LW*1.6);
        let px=0; for(let i=1;i<ms.pts.length;i++) px+=Math.hypot(ms.pts[i].x-ms.pts[i-1].x, ms.pts[i].y-ms.pts[i-1].y);
        const txt = mm ? Math.round(px*mm).toLocaleString("en-US")+" mm" : Math.round(px)+" px";
        const a=ms.pts[ms.pts.length-2], b=ms.pts[ms.pts.length-1];
        boxedText(txt, {x:(a.x+b.x)/2, y:(a.y+b.y)/2}, FS, COL.meas, false);
      }
      pagesDone++;
    }

    if(!pagesDone){ toast("Nothing has been drawn yet, so there is nothing to write."); return; }
    const bytes = await out.save();
    download(baseName()+"-sprinkler.pdf", new Blob([bytes], {type:"application/pdf"}));
    toast(`Saved a marked-up PDF with ${pagesDone} page${pagesDone>1?"s":""} of layout.`);
  }catch(err){
    toast("Could not write the PDF: "+err.message);
  }
}

function exportJson(){
  download(baseName()+"-annotations.json", JSON.stringify({v:1, doc:state.doc}, null, 2), "application/json");
}