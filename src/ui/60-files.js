
/* ══════════════════════════════════════════════════════════════
   10. Files
   Nothing is kept between sessions on purpose: opening the app gives
   you a clean sheet. Use Save work file to keep a job, which stores
   the drawing and everything drawn on it in one file.
   ══════════════════════════════════════════════════════════════ */

function save(){ state.dirty = true; }        // marks unsaved work, nothing is written

window.addEventListener("beforeunload", e=>{
  if(!state.dirty) return;
  e.preventDefault(); e.returnValue = "";
});

function bytesToB64(buf){
  const a=new Uint8Array(buf); let out=""; const CH=0x8000;
  for(let i=0;i<a.length;i+=CH) out += String.fromCharCode.apply(null, a.subarray(i, i+CH));
  return btoa(out);
}
function b64ToBytes(b64){
  const bin=atob(b64); const a=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i);
  return a.buffer;
}

function exportWork(){
  if(!state.pdfBytes){ toast("Open a PDF first."); return; }
  const payload = {
    app:"sprinkler-shop-drawing-drafter", v:2,
    fileName: state.fileName,
    pdf: bytesToB64(state.pdfBytes),
    doc: state.doc
  };
  download(baseName()+".sdd.json", JSON.stringify(payload), "application/json");
  state.dirty = false;
  toast("Work file saved. It contains the drawing as well, so it opens on its own.");
}

async function importWork(json){
  if(json.app!=="sprinkler-shop-drawing-drafter" || !json.pdf){
    // an older annotations-only file
    if(json.doc){ state.doc=json.doc; RECT_CACHE.clear(); syncPanels(); draw();
      toast("Annotations loaded. Open the matching PDF to see them on the drawing."); return; }
    toast("That file is not a work file for this tool."); return;
  }
  state.doc = json.doc;
  await loadPdf(b64ToBytes(json.pdf), json.fileName || "drawing.pdf");
  state.doc = json.doc;                       // loadPdf only touches the name
  RECT_CACHE.clear(); SAMPLE_CACHE.clear(); ANGLE_CACHE.clear(); TILE_CACHE.clear(); syncPanels(); draw();
  state.dirty = false;
  toast("Work file opened.");
}

function baseName(){
  return (state.fileName||"drawing").replace(/\.pdf$/i,"").replace(/\.sdd$/i,"");
}

document.getElementById("btnOpen").onclick=()=>document.getElementById("filePdf").click();
document.getElementById("btnOpen2").onclick=()=>document.getElementById("filePdf").click();
document.getElementById("filePdf").onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  if(state.dirty && !confirm("You have unsaved work. Open a different drawing anyway?")){ e.target.value=""; return; }
  state.doc={name:f.name, rules:state.doc.rules, devices:state.doc.devices, pages:{}};
  RECT_CACHE.clear(); SAMPLE_CACHE.clear(); ANGLE_CACHE.clear(); TILE_CACHE.clear(); UNDO.length=0; state.dirty=false;
  await loadPdf(await f.arrayBuffer(), f.name);
  e.target.value="";
};
let pendingImport="doc";
document.getElementById("btnImport").onclick=()=>{ pendingImport="doc"; document.getElementById("fileJson").click(); };
document.getElementById("btnExportJson").onclick=exportWork;
document.getElementById("btnSavePdf").onclick=exportPdf;
document.getElementById("fileJson").onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const j=JSON.parse(await f.text());
    if(pendingImport==="rules"){ state.doc.rules={...state.doc.rules, ...j}; toast("Rules loaded."); save(); syncPanels(); draw(); }
    else await importWork(j);
  }catch(err){ toast("Could not read that file: "+err.message); }
  e.target.value="";
};

/* Drag and drop */
const dropEl=document.getElementById("drop");
["dragenter","dragover"].forEach(t=>stage.addEventListener(t,e=>{e.preventDefault(); dropEl.classList.add("active"); dropEl.style.display="flex";}));
["dragleave","drop"].forEach(t=>stage.addEventListener(t,e=>{e.preventDefault(); dropEl.classList.remove("active"); if(state.pdfCanvas) dropEl.style.display="none";}));
stage.addEventListener("drop", async e=>{
  const f=[...e.dataTransfer.files].find(f=>/pdf$/i.test(f.name)||f.type==="application/pdf");
  if(!f){
    const w=[...e.dataTransfer.files].find(f=>/\.json$/i.test(f.name));
    if(w){ try{ await importWork(JSON.parse(await w.text())); }catch(err){ toast("Could not read that work file: "+err.message); } return; }
    toast("Drop a PDF drawing, or a work file saved from this tool."); return;
  }
  if(state.dirty && !confirm("You have unsaved work. Open a different drawing anyway?")) return;
  state.doc={name:f.name, rules:state.doc.rules, devices:state.doc.devices, pages:{}};
  RECT_CACHE.clear(); SAMPLE_CACHE.clear(); ANGLE_CACHE.clear(); TILE_CACHE.clear(); UNDO.length=0; state.dirty=false;
  await loadPdf(await f.arrayBuffer(), f.name);
});

/* Page navigation */
async function gotoPage(n){
  n=Math.max(1, Math.min(state.pageCount||1, n));
  if(n===state.pageNum || !state.pdf) return;
  state.pageNum=n;
  await renderPage();
  fitView();
}
document.getElementById("pgPrev").onclick=()=>gotoPage(state.pageNum-1);
document.getElementById("pgNext").onclick=()=>gotoPage(state.pageNum+1);
document.getElementById("pgPrev2").onclick=()=>gotoPage(state.pageNum-1);
document.getElementById("pgNext2").onclick=()=>gotoPage(state.pageNum+1);
document.getElementById("pgSelect").onchange=e=>gotoPage(parseInt(e.target.value,10));
document.getElementById("btnFit").onclick=fitView;

/* Snap status */
function updateVecCell(){
  const el=document.getElementById("stVec");
  const btn=document.getElementById("btnSnap");
  if(!el) return;
  el.textContent = VEC.busy ? "reading…"
    : VEC.ready ? VEC.count.toLocaleString("en-US")+" lines"+(VEC.truncated?" (capped)":"")
    : "none";
  btn.style.background = state.snap? "#2a2318" : "";
  btn.style.borderColor = state.snap? "#d9a441" : "";
  btn.style.color = state.snap? "#d9a441" : "";
}
document.getElementById("fbTile").onclick=()=>fillApply("tile");
document.getElementById("fbGib").onclick=()=>fillApply("gib");
document.getElementById("cbTile").onclick=()=>ASK&&ASK.pick("tile");
document.getElementById("cbGib").onclick=()=>ASK&&ASK.pick("gib");
document.getElementById("cbCancel").onclick=()=>ASK&&ASK.cancel();
document.getElementById("fbReset").onclick=fillReset;
document.getElementById("fbCancel").onclick=()=>fillCancel();
function setCoverageView(on){
  state.showCov = on;
  const b=document.getElementById("stCov");
  if(b) b.textContent = on? "on":"off";
  const btn=document.getElementById("btnCov");
  if(btn){
    btn.style.background = on? "#2a2318":""; btn.style.borderColor = on? "#d9a441":""; btn.style.color = on? "#d9a441":"";
  }
  const cb=document.getElementById("rvCov"); if(cb) cb.checked=on;
  const tb=document.getElementById("rvCovBtn"); if(tb) tb.textContent=(on?"Hide":"Show")+" all coverage";
  draw();
}
function setReview(on){
  state.review=on;
  document.getElementById("stReview").textContent = on? "on":"off";
  const b=document.getElementById("btnReview");
  b.style.background = on? "#33201c":""; b.style.borderColor = on? "#e4573d":""; b.style.color = on? "#f2b7ab":"";
  if(on) setTab("review");
  draw();
}
document.getElementById("btnReview").onclick=()=>setReview(!state.review);
document.getElementById("btnCov").onclick=()=>setCoverageView(!state.showCov);
document.getElementById("btnDims").onclick=()=>{
  state.dims = state.dims==="selected" ? "all" : state.dims==="all" ? "off" : "selected";
  document.getElementById("stDims").textContent = state.dims;
  draw();
};
document.getElementById("btnSnap").onclick=()=>{
  state.snap=!state.snap; state.snapHit=null;
  updateVecCell(); syncPanels(); draw();
};

/* Toast */
let toastT=null;
function toast(msg){
  const t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"), 3200);
}

/* Startup */
(function init(){
  state.doc = {name:"", rules:structuredClone(DEFAULT_RULES), devices:structuredClone(DEFAULT_DEVICES), pages:{}};
  syncPanels(); setMode("pan"); resize();
})();