/* Buctril dashboard – rev4 (clean)
   - Guaranteed XLSX + Chart.js via fallback loader (Safari-safe)
   - Parses SUM sheet robustly (header discovery + strict reason columns)
   - Donuts + pivot bars (no tables)
   - Media grid always visible; handles missing media; bg.mp4 optional
*/
(function(){
  "use strict";

  const STATUS = document.getElementById("status");
  const citySel = document.getElementById("citySel");
  const spotSel = document.getElementById("spotSel");
  const searchBox = document.getElementById("searchBox");
  const clearBtn = document.getElementById("clearBtn");

  const kSessions = document.getElementById("kSessions");
  const kFarmers = document.getElementById("kFarmers");
  const kAcres = document.getElementById("kAcres");
  const kCities = document.getElementById("kCities");
  const campaignDaysEl = document.getElementById("campaignDays");

  const mediaGrid = document.getElementById("mediaGrid");

  let ALL = [];
  let FILTERED = [];
  let HEADERS = [];
  let REASON_USE_COLS = [];
  let REASON_NOT_COLS = [];

  let charts = { city:null, spot:null, intent:null, use:null, notUse:null };

  function logStatus(msg, isErr=false){
    if (!STATUS) return;
    STATUS.style.display = "block";
    STATUS.classList.toggle("err", !!isErr);
    STATUS.textContent = msg;
  }

  function normalize(s){ return String(s ?? "").trim(); }
  function normKey(s){
    return normalize(s).toLowerCase().replace(/\s+/g," ").replace(/[^a-z0-9 :%/_-]/g,"").trim();
  }
  function isEmpty(v){
    return v===null || v===undefined || String(v).trim()==="";
  }
  function toNum(v){
    if (v===null || v===undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/,/g,"").trim();
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function fmtInt(n){
    if (!Number.isFinite(n)) return "–";
    return Math.round(n).toLocaleString();
  }
  function distinct(arr){ return Array.from(new Set(arr)); }

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src=src;
      s.async=true;
      s.onload=()=>resolve(src);
      s.onerror=()=>reject(new Error("Failed: "+src));
      document.head.appendChild(s);
    });
  }

  async function ensureLibs(){
    if (!window.XLSX){
      const tries=[
        "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
        "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
      ];
      let ok=false, lastErr=null;
      for (const t of tries){
        try{ await loadScript(t); if (window.XLSX){ ok=true; break; } }catch(e){ lastErr=e; }
      }
      if (!ok) throw new Error("XLSX library not available (CDN blocked). " + (lastErr?lastErr.message:""));
    }

    if (!window.Chart){
      const tries=[
        "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
        "https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
      ];
      let ok=false, lastErr=null;
      for (const t of tries){
        try{ await loadScript(t); if (window.Chart){ ok=true; break; } }catch(e){ lastErr=e; }
      }
      if (!ok) throw new Error("Chart.js library not available (CDN blocked). " + (lastErr?lastErr.message:""));
    }
  }

  async function trySetBgVideo(){
    const v = document.getElementById("bgVideo");
    if (!v) return;
    const candidates=["bg.mp4","assets/bg.mp4"];
    for (const c of candidates){
      try{
        const r = await fetch(c, {method:"HEAD"});
        if (r.ok){
          v.src = c;
          v.style.display = "block";
          return;
        }
      }catch(e){}
    }
  }

  async function setLogos(){
    const map = [
      {id:"logoBayer", names:["Bayer.jpg","bayer.jpg","Bayer.jpeg","bayer.jpeg","assets/Bayer.jpg","assets/bayer.jpg"]},
      {id:"logoBuctril", names:["Buctril.jpg","buctril.jpg","Buctril.jpeg","buctril.jpeg","assets/Buctril.jpg","assets/buctril.jpg"]},
      {id:"logoInteract", names:["Interact.gif","interact.gif","Interact.png","interact.png","assets/Interact.gif","assets/interact.gif"]}
    ];
    for (const item of map){
      const img = document.getElementById(item.id);
      if (!img) continue;
      let set=false;
      for (const n of item.names){
        try{
          const r = await fetch(n, {method:"HEAD"});
          if (r.ok){ img.src=n; set=true; break; }
        }catch(e){}
      }
      if (!set) img.alt="—";
    }
  }

  async function fetchWorkbook(){
    const candidates=["Buctril_Super_Activations.xlsx","./Buctril_Super_Activations.xlsx"];
    let lastErr=null;
    for (const c of candidates){
      try{
        const r = await fetch(c, {cache:"no-cache"});
        if (!r.ok) throw new Error("HTTP "+r.status+" for "+c);
        return await r.arrayBuffer();
      }catch(e){ lastErr=e; }
    }
    throw new Error("Could not fetch XLSX. " + (lastErr?lastErr.message:""));
  }

  function findHeaderRow(sheetAOA){
    for (let i=0;i<Math.min(20, sheetAOA.length);i++){
      const row = sheetAOA[i] || [];
      const keys = row.map(normKey);
      const hasCity = keys.includes("city");
      const hasSpot = keys.includes("session location") || keys.includes("spot") || keys.includes("sessionlocation");
      if (hasCity && hasSpot) return i;
    }
    return 1;
  }

  function parseSUM(wb){
    const sumName = (wb.SheetNames||[]).find(s=>String(s).trim().toLowerCase()==="sum") || "SUM";
    const ws = wb.Sheets[sumName];
    if (!ws) throw new Error("SUM sheet not found in workbook.");

    const aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, blankrows:false});
    const hr = findHeaderRow(aoa);
    HEADERS = (aoa[hr] || []).map(h=>normalize(h));
    const rows = aoa.slice(hr+1);

    const idxByKey = {};
    HEADERS.forEach((h,i)=>{ if(h) idxByKey[normKey(h)] = i; });

    REASON_USE_COLS = [];
    REASON_NOT_COLS = [];
    HEADERS.forEach((h,i)=>{
      const hs=normalize(h);
      if (hs.startsWith("Reason to Use:")) REASON_USE_COLS.push({i, label: hs.replace("Reason to Use:","").trim() || "Other"});
      if (hs.startsWith("Reason Not to Use:")) REASON_NOT_COLS.push({i, label: hs.replace("Reason Not to Use:","").trim() || "Other"});
    });

    const col = (k, alts=[])=>{
      const kk = normKey(k);
      if (idxByKey[kk]!==undefined) return idxByKey[kk];
      for (const a of alts){
        const aa=normKey(a);
        if (idxByKey[aa]!==undefined) return idxByKey[aa];
      }
      return -1;
    };

    const cCity = col("City");
    const cSpot = col("Session Location", ["Spot","Location"]);
    const cDate = col("Date");
    const cFarmers = col("Total Farmers", ["Farmers","No. of Farmers","Farmers engaged"]);
    const cAcres = col("Total Wheat Acres", ["Wheat acres","Total Acres","Acres"]);
    const cPlanYes = col("Plan Yes Count", ["Plan Yes"]);
    const cPlanMaybe = col("Plan Maybe Count", ["Plan Maybe"]);
    const cPlanNo = col("Plan No Count", ["Plan No"]);
    const cRemarks = col("Remarks");
    const cNotes = col("Notes", ["Remarks"]);

    const out = [];
    for (const r of rows){
      if (!r || r.length===0) continue;
      const nonEmpty = r.some(v=>!isEmpty(v));
      if (!nonEmpty) continue;

      const city = normalize(r[cCity]);
      const spot = normalize(r[cSpot]);
      if (!city && !spot) continue;

      out.push({
        city: city || "Unknown",
        spot: spot || "Unknown",
        date: r[cDate],
        farmers: toNum(r[cFarmers]),
        acres: toNum(r[cAcres]),
        planYes: toNum(r[cPlanYes]),
        planMaybe: toNum(r[cPlanMaybe]),
        planNo: toNum(r[cPlanNo]),
        remarks: normalize(r[cRemarks]),
        notes: normalize(r[cNotes]),
        _raw: r
      });
    }
    return out;
  }

  function hashColor(label, sat=68, light=58){
    const s = String(label ?? "x");
    let h = 0;
    for (let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; }
    const hue = h % 360;
    return `hsl(${hue} ${sat}% ${light}%)`;
  }

  function computeCampaignDays(rows){
    const dates=[];
    rows.forEach(r=>{
      const v=r.date;
      if (v===null || v===undefined || v==="") return;
      if (typeof v === "number" && Number.isFinite(v)){
        const d = new Date(Date.UTC(1899,11,30) + v*86400000);
        dates.push(d); return;
      }
      const d2 = new Date(v);
      if (!isNaN(d2.getTime())) dates.push(d2);
    });
    if (!dates.length) return "–";
    dates.sort((a,b)=>a-b);
    const min=dates[0], max=dates[dates.length-1];
    const diffDays = Math.max(1, Math.round((max-min)/86400000)+1);
    return String(diffDays);
  }

  function destroyChart(ch){ if (ch){ try{ ch.destroy(); }catch(e){} } }

  function renderKPIs(){
    const sessions = FILTERED.length;
    const farmers = FILTERED.reduce((s,r)=>s+(Number.isFinite(r.farmers)?r.farmers:0),0);
    const acres = FILTERED.reduce((s,r)=>s+(Number.isFinite(r.acres)?r.acres:0),0);
    const cities = distinct(FILTERED.map(r=>r.city)).length;

    kSessions.textContent = fmtInt(sessions);
    kFarmers.textContent = fmtInt(farmers);
    kAcres.textContent = fmtInt(acres);
    kCities.textContent = fmtInt(cities);
  }

  function buildCounts(field, baseRows){
    const m = new Map();
    baseRows.forEach(r=>{
      const key = r[field] || "Unknown";
      m.set(key, (m.get(key)||0) + 1);
    });
    return Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,18);
  }

  function renderDonuts(){
    const cityItems = buildCounts("city", FILTERED);
    const selectedCity = citySel.value || "All";
    const base = (selectedCity!=="All") ? FILTERED.filter(r=>r.city===selectedCity) : FILTERED;
    const spotItems = buildCounts("spot", base);

    const cityLabels = cityItems.map(x=>x[0]);
    const cityVals = cityItems.map(x=>x[1]);
    const cityColors = cityLabels.map(l=>hashColor(l,72,58));

    destroyChart(charts.city);
    charts.city = new Chart(document.getElementById("cityDonut"), {
      type:"doughnut",
      data:{ labels: cityLabels, datasets:[{ data: cityVals, backgroundColor: cityColors, borderColor:"rgba(255,255,255,.20)", borderWidth:1 }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ position:"bottom", labels:{ color:"rgba(255,255,255,.85)", boxWidth:14, font:{weight:"700"} } },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.label}: ${ctx.raw}` } }
        },
        onClick:(evt, els)=>{
          if (!els || !els.length) return;
          const label = cityLabels[els[0].index];
          citySel.value = label;
          updateSpotOptionsForCity();
          applyFilters();
        }
      }
    });

    const spotLabels = spotItems.map(x=>x[0]);
    const spotVals = spotItems.map(x=>x[1]);
    const spotColors = spotLabels.map(l=>hashColor(l,62,54));

    destroyChart(charts.spot);
    charts.spot = new Chart(document.getElementById("spotDonut"), {
      type:"doughnut",
      data:{ labels: spotLabels, datasets:[{ data: spotVals, backgroundColor: spotColors, borderColor:"rgba(255,255,255,.20)", borderWidth:1 }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ position:"bottom", labels:{ color:"rgba(255,255,255,.85)", boxWidth:14, font:{weight:"700"} } },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.label}: ${ctx.raw}` } }
        },
        onClick:(evt, els)=>{
          if (!els || !els.length) return;
          const label = spotLabels[els[0].index];
          spotSel.value = label;
          applyFilters();
        }
      }
    });
  }

  function renderIntent(){
    let yes=0, maybe=0, no=0;
    FILTERED.forEach(r=>{
      if (Number.isFinite(r.planYes)) yes += r.planYes;
      if (Number.isFinite(r.planMaybe)) maybe += r.planMaybe;
      if (Number.isFinite(r.planNo)) no += r.planNo;
    });
    const allZero = [yes,maybe,no].every(v=>!v || v===0);

    destroyChart(charts.intent);
    charts.intent = new Chart(document.getElementById("intentDonut"), {
      type:"doughnut",
      data:{
        labels: allZero ? ["No plan counts found"] : ["Plan Yes","Plan Maybe","Plan No"],
        datasets:[{
          data: allZero ? [FILTERED.length||1] : [yes, maybe, no],
          backgroundColor: allZero ? ["hsl(210 15% 55%)"] : ["hsl(145 70% 48%)","hsl(45 85% 55%)","hsl(0 75% 55%)"],
          borderColor:"rgba(255,255,255,.20)",
          borderWidth:1
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ position:"bottom", labels:{ color:"rgba(255,255,255,.85)", boxWidth:14, font:{weight:"800"} } },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.label}: ${Math.round(ctx.raw||0)}` } }
        }
      }
    });
  }

  function sumReasonCounts(reasonCols){
    const m = new Map();
    reasonCols.forEach(rc=> m.set(rc.label, 0));
    FILTERED.forEach(r=>{
      const row = r._raw || [];
      reasonCols.forEach(rc=>{
        const v = row[rc.i];
        if (isEmpty(v)) return;
        const n = toNum(v);
        const add = Number.isFinite(n) ? n : 1;
        m.set(rc.label, (m.get(rc.label)||0) + add);
      });
    });
    return Array.from(m.entries()).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,10);
  }

  function renderReasonBars(){
    const useItems = sumReasonCounts(REASON_USE_COLS);
    const notItems = sumReasonCounts(REASON_NOT_COLS);

    function makeBar(canvasId, items, refName){
      const labels = items.length ? items.map(x=>x[0]) : ["No reason columns found / no data"];
      const vals = items.length ? items.map(x=>x[1]) : [0];

      destroyChart(charts[refName]);
      charts[refName] = new Chart(document.getElementById(canvasId), {
        type:"bar",
        data:{ labels, datasets:[{ label:"Count", data:vals, backgroundColor:"rgba(100,180,255,.55)", borderColor:"rgba(255,255,255,.22)", borderWidth:1 }]},
        options:{
          responsive:true, maintainAspectRatio:false,
          indexAxis:"y",
          scales:{
            x:{ ticks:{ color:"rgba(255,255,255,.78)" }, grid:{ color:"rgba(255,255,255,.07)" } },
            y:{ ticks:{ color:"rgba(255,255,255,.82)", font:{weight:"800"} }, grid:{ color:"rgba(255,255,255,.06)" } }
          },
          plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=> ` ${Math.round(ctx.raw||0)}` } } }
        }
      });
    }
    makeBar("useBar", useItems, "use");
    makeBar("notUseBar", notItems, "notUse");
  }

  async function loadMediaManifest(){
    const candidates=["media.json","assets/gallery/media.json"];
    for (const c of candidates){
      try{
        const r = await fetch(c, {cache:"no-cache"});
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j)) return j;
      }catch(e){}
    }
    return [];
  }

  function candidateSrcs(src){
    const out = [];
    const s = String(src||"").trim();
    if (!s) return out;
    out.push(s);
    if (s.endsWith(".jpeg")) out.push(s.replace(/\.jpeg$/i,".jpg"));
    if (s.endsWith(".jpg")) out.push(s.replace(/\.jpg$/i,".jpeg"));
    const base = s.split("/").pop();
    if (base && base!==s) out.push(base);
    if (base && s===base) out.push("assets/gallery/"+base);
    return Array.from(new Set(out));
  }

  function addMediaCard(item){
    const card = document.createElement("div");
    card.className="media-card";

    const cap = document.createElement("div");
    cap.className="cap";
    cap.textContent = item.caption || item.alt || item.src || "Media";
    card.appendChild(cap);

    const missing = document.createElement("div");
    missing.className="missing";
    missing.textContent = "Loading…";
    card.appendChild(missing);

    const type = (item.type||"").toLowerCase();
    const srcList = candidateSrcs(item.src);

    let el = null;
    if (type==="video"){
      el = document.createElement("video");
      el.controls = true;
      el.muted = true;
      el.playsInline = true;
      el.preload = "metadata";
    } else {
      el = document.createElement("img");
      el.loading = "lazy";
      el.decoding = "async";
      el.referrerPolicy = "no-referrer";
    }
    card.insertBefore(el, cap);

    let tried=0;
    const tryNext = ()=>{
      if (tried >= srcList.length){
        missing.textContent = "Missing media:\n" + (item.src||"(no src)");
        return;
      }
      const src = srcList[tried++];
      if (type==="video"){
        el.src = src;
        el.onloadeddata = ()=> { if (missing.parentNode) missing.remove(); };
        el.onerror = ()=> { tryNext(); };
      } else {
        el.src = src;
        el.onload = ()=> { if (missing.parentNode) missing.remove(); };
        el.onerror = ()=> { tryNext(); };
      }
    };
    card.addEventListener("click", ()=>{
      const s = el && el.src ? el.src : (item.src||"");
      if (s) window.open(s, "_blank");
    });
    tryNext();
    return card;
  }

  async function renderMedia(){
    if (!mediaGrid) return;
    mediaGrid.innerHTML="";
    const manifest = await loadMediaManifest();
    if (!manifest.length){
      const empty = document.createElement("div");
      empty.style.color="rgba(255,255,255,.75)";
      empty.style.fontWeight="800";
      empty.style.padding="6px 2px";
      empty.textContent = "No media.json found (or invalid JSON). Upload media.json in repo root OR assets/gallery/media.json. Upload your images/videos to assets/gallery/ (recommended).";
      mediaGrid.appendChild(empty);
      return;
    }
    manifest.slice(0,24).forEach(item=> mediaGrid.appendChild(addMediaCard(item)));
  }

  function rebuildDropdowns(){
    const cities = distinct(ALL.map(r=>r.city)).sort((a,b)=>a.localeCompare(b));
    const spots = distinct(ALL.map(r=>r.spot)).sort((a,b)=>a.localeCompare(b));

    function makeOpts(sel, items, allLabel){
      sel.innerHTML="";
      const oAll=document.createElement("option");
      oAll.value="All"; oAll.textContent=allLabel;
      sel.appendChild(oAll);
      for (const it of items){
        const o=document.createElement("option");
        o.value=it; o.textContent=it;
        sel.appendChild(o);
      }
    }
    makeOpts(citySel, cities, "All Cities");
    makeOpts(spotSel, spots, "All Spots");
  }

  function updateSpotOptionsForCity(){
    const city = citySel.value || "All";
    const spots = (city==="All")
      ? distinct(ALL.map(r=>r.spot))
      : distinct(ALL.filter(r=>r.city===city).map(r=>r.spot));
    spots.sort((a,b)=>a.localeCompare(b));

    const current = spotSel.value;
    spotSel.innerHTML="";
    const oAll=document.createElement("option");
    oAll.value="All"; oAll.textContent="All Spots";
    spotSel.appendChild(oAll);

    for (const it of spots){
      const o=document.createElement("option");
      o.value=it; o.textContent=it;
      spotSel.appendChild(o);
    }
    if (current && spots.includes(current)) spotSel.value=current;
  }

  function applyFilters(){
    const city = citySel.value || "All";
    const spot = spotSel.value || "All";
    const q = (searchBox.value || "").trim().toLowerCase();

    FILTERED = ALL.filter(r=>{
      if (city!=="All" && r.city!==city) return false;
      if (spot!=="All" && r.spot!==spot) return false;
      if (q){
        const blob = `${r.city} ${r.spot} ${r.remarks||""} ${r.notes||""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    renderAll();
  }

  function renderAll(){
    renderKPIs();
    renderDonuts();
    renderIntent();
    renderReasonBars();
  }

  function wireUI(){
    citySel.addEventListener("change", ()=>{ updateSpotOptionsForCity(); applyFilters(); });
    spotSel.addEventListener("change", applyFilters);
    searchBox.addEventListener("input", ()=>{
      clearTimeout(searchBox._t);
      searchBox._t = setTimeout(applyFilters, 140);
    });
    clearBtn.addEventListener("click", ()=>{
      citySel.value="All";
      updateSpotOptionsForCity();
      spotSel.value="All";
      searchBox.value="";
      applyFilters();
    });
  }

  async function boot(){
    try{
      await setLogos();
      await trySetBgVideo();
      await ensureLibs();

      logStatus("Loading XLSX…");
      const buf = await fetchWorkbook();
      const wb = XLSX.read(buf, {type:"array"});

      ALL = parseSUM(wb);
      if (!ALL.length){
        throw new Error("Parsed SUM sheet but found 0 usable rows. Confirm SUM has City + Session Location and data rows under headers.");
      }

      rebuildDropdowns();
      updateSpotOptionsForCity();
      wireUI();

      FILTERED = ALL.slice();
      renderAll();

      if (campaignDaysEl) campaignDaysEl.textContent = computeCampaignDays(ALL);

      logStatus(
        `Loaded ${ALL.length} session rows from SUM.\n`+
        `Reason columns found: Use=${REASON_USE_COLS.length}, NotUse=${REASON_NOT_COLS.length}.\n`+
        `If charts are blank: confirm your GitHub Pages URL is correct and XLSX exists in repo root with exact name.`
      );

      await renderMedia();
    }catch(e){
      console.error(e);
      logStatus(String(e && e.message ? e.message : e), true);
      try{ await renderMedia(); }catch(_){}
    }
  }

  boot();
})();
