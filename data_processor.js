/* Buctril Dashboard – XLSX-first processor (GitHub Pages safe)
   Fixes:
   1) Removes the noisy "no matching labels detected" table and replaces it with donut/pivot summaries.
   2) Reads Buctril_Super_Activations.xlsx directly (fallback if sum_sheet.csv is wrong/missing).
   3) Loads media.json with .jpg paths; supports root OR assets/gallery path.
   4) Makes relative paths stable by redirecting to trailing-slash URL when needed.
*/

(function(){
  "use strict";

  const APP = {};
  window.BUCTRIL_APP = APP;

  // --------------------------
  // DOM helpers
  // --------------------------
  const $ = (id) => document.getElementById(id);

  function setStatus(msg, isError){
    const el = $("status");
    if(!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  function fmtInt(n){
    const x = Number(n||0);
    if(!isFinite(x)) return "–";
    return x.toLocaleString();
  }
  function fmtPct(n){
    const x = Number(n||0);
    if(!isFinite(x)) return "–";
    return x.toFixed(0) + "%";
  }

  function safeStr(v){
    if(v===null || v===undefined) return "";
    return String(v).trim();
  }

  function toLower(v){ return safeStr(v).toLowerCase(); }

  function baseHref(){
    // Always produce a URL that ends with "/" for consistent relative fetches.
    const u = new URL(window.location.href);
    if(!u.pathname.endsWith("/") && !u.pathname.endsWith(".html")){
      u.pathname = u.pathname + "/";
    }
    // If user opens repo without slash, this normalizes our internal base.
    return u.href.replace(/[^\/]*$/, ""); // up to last slash
  }

  function ensureTrailingSlash(){
    const p = window.location.pathname;
    if(!p.endsWith("/") && !p.endsWith(".html")){
      const target = p + "/" + window.location.search + window.location.hash;
      window.location.replace(target);
      return true;
    }
    return false;
  }

  async function fetchFirstOk(paths){
    const base = baseHref();
    for(const p of paths){
      try{
        const url = new URL(p, base).href;
        const r = await fetch(url, {cache:"no-store"});
        if(r.ok) return {url, resp:r};
      }catch(e){}
    }
    return null;
  }

  // --------------------------
  // XLSX parsing (SheetJS)
  // --------------------------
  function sheetToGrid(workbook, sheetName){
    const ws = workbook.Sheets[sheetName];
    if(!ws) return null;
    // header:1 returns 2D array
    return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
  }

  function findCell(grid, re){
    if(!grid) return null;
    for(let r=0;r<grid.length;r++){
      const row = grid[r] || [];
      for(let c=0;c<row.length;c++){
        const v = row[c];
        if(typeof v === "string" && re.test(v.trim())){
          return {r,c,v:v.trim()};
        }
      }
    }
    return null;
  }

  function firstNonEmptyRight(grid, r, c, maxSteps=10){
    const row = grid[r] || [];
    for(let k=1;k<=maxSteps;k++){
      const v = row[c+k];
      if(v!==null && v!==undefined && String(v).trim()!==""){
        return v;
      }
    }
    return null;
  }

  function firstNonEmptyBelow(grid, r, c, maxSteps=10){
    for(let k=1;k<=maxSteps;k++){
      const row = grid[r+k] || [];
      const v = row[c];
      if(v!==null && v!==undefined && String(v).trim()!==""){
        return v;
      }
    }
    return null;
  }

  function num(v){
    if(v===null || v===undefined) return 0;
    if(typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v).replace(/[, ]+/g,"").replace(/%/g,"").trim();
    const x = Number(s);
    return isFinite(x) ? x : 0;
  }

  function parseDMS(dms){
    // Example: 30°01'07.0"N 71°07'10.7"E
    const s = safeStr(dms);
    if(!s) return null;
    const re = /(\d{1,3})\D+(\d{1,2})\D+(\d{1,2}(?:\.\d+)?)\D*([NS])\D+(\d{1,3})\D+(\d{1,2})\D+(\d{1,2}(?:\.\d+)?)\D*([EW])/i;
    const m = s.match(re);
    if(!m) return null;
    const degLat = Number(m[1]), minLat = Number(m[2]), secLat = Number(m[3]), hemLat = m[4].toUpperCase();
    const degLon = Number(m[5]), minLon = Number(m[6]), secLon = Number(m[7]), hemLon = m[8].toUpperCase();
    let lat = degLat + (minLat/60) + (secLat/3600);
    let lon = degLon + (minLon/60) + (secLon/3600);
    if(hemLat==="S") lat = -lat;
    if(hemLon==="W") lon = -lon;
    if(!isFinite(lat) || !isFinite(lon)) return null;
    return {lat, lon};
  }

  function extractReasons(grid){
    // Reads the "Reasons to USE" table: Reason text + Count
    // Typical layout:
    // Row with "Reasons to USE" then next rows include [#, Reason, , Count]
    const reasons = [];
    if(!grid) return reasons;

    const anchor = findCell(grid, /reasons\s+to\s+use/i);
    if(!anchor) return reasons;

    // Scan next ~12 rows for "Reason" text + numeric count in same row
    const start = anchor.r + 1;
    for(let r=start; r<Math.min(grid.length, start+20); r++){
      const row = grid[r] || [];
      // detect a reason-like cell (usually col1 or col2) with a count (usually col3 or col4)
      let reason = "";
      let count = 0;

      // choose longest string cell in row as reason candidate
      for(let c=0;c<row.length;c++){
        if(typeof row[c]==="string"){
          const t = row[c].trim();
          if(t.length >= 6 && !/^(reason|count|supervisor|don)/i.test(t)){
            if(t.length > reason.length) reason = t;
          }
        }
      }
      // choose largest numeric cell in row as count
      for(let c=0;c<row.length;c++){
        const v = row[c];
        if(typeof v === "number") count = Math.max(count, v);
        else if(typeof v === "string" && v.trim() !== ""){
          const x = num(v);
          if(x>0) count = Math.max(count, x);
        }
      }

      // heuristics: ignore header rows
      if(reason && count > 0 && !/total/i.test(reason)){
        reasons.push({reason, count});
      }
    }
    return reasons;
  }

  function extractSessionRecord(sheetName, grid){
    // Skip empty/template sheets
    const title = findCell(grid, /wheat\s+farmer\s+session\s+quick\s+report/i);
    if(!title) return null;

    // Date / Day
    const dateCell = findCell(grid, /^date\b/i);
    const dayCell  = findCell(grid, /^day:/i);

    const dateVal = dateCell ? firstNonEmptyRight(grid, dateCell.r, dateCell.c) : null;
    const dayVal  = dayCell ? firstNonEmptyRight(grid, dayCell.r, dayCell.c) : null;

    // Basic location fields from the first row of session table (usually row under "Sessopm/Session")
    // Find header "Tehsil / District" then read below
    const distHead = findCell(grid, /tehsil\s*\/\s*district/i);
    const villageHead = findCell(grid, /village/i);
    const coordHead = findCell(grid, /location\s*coordinate/i);

    const district = distHead ? safeStr(firstNonEmptyBelow(grid, distHead.r, distHead.c)) : "";
    const village  = villageHead ? safeStr(firstNonEmptyBelow(grid, villageHead.r, villageHead.c)) : "";
    const coordStr = coordHead ? safeStr(firstNonEmptyBelow(grid, coordHead.r, coordHead.c)) : "";
    const latlon = parseDMS(coordStr);

    // Metrics by labels
    const totalFarmersCell = findCell(grid, /total\s+farmers\s+present/i);
    const wheatFarmersCell = findCell(grid, /total\s+wheat\s+farmers/i);
    const acresCell = findCell(grid, /wheat\s+acres\s+represented/i);
    const knowCell = findCell(grid, /already\s+know\b.*buctril/i);
    const usedCell = findCell(grid, /used\b.*last\s+year/i);
    const definiteCell = findCell(grid, /definitely\s+use/i);
    const maybeCell = findCell(grid, /maybe\b/i);
    const noCell = findCell(grid, /not\s+interested/i);
    const estAcresCell = findCell(grid, /estimated\s+acres.*sprayed.*buctril/i);

    const totalFarmers = totalFarmersCell ? num(firstNonEmptyRight(grid, totalFarmersCell.r, totalFarmersCell.c)) : 0;
    const wheatFarmers = wheatFarmersCell ? num(firstNonEmptyRight(grid, wheatFarmersCell.r, wheatFarmersCell.c)) : 0;
    const wheatAcres = acresCell ? num(firstNonEmptyRight(grid, acresCell.r, acresCell.c)) : 0;
    const knowBuctril = knowCell ? num(firstNonEmptyRight(grid, knowCell.r, knowCell.c)) : 0;
    const usedLastYear = usedCell ? num(firstNonEmptyRight(grid, usedCell.r, usedCell.c)) : 0;
    const definite = definiteCell ? num(firstNonEmptyRight(grid, definiteCell.r, definiteCell.c)) : 0;
    const maybe = maybeCell ? num(firstNonEmptyRight(grid, maybeCell.r, maybeCell.c)) : 0;
    const notInterested = noCell ? num(firstNonEmptyRight(grid, noCell.r, noCell.c)) : 0;
    const estBuctrilAcres = estAcresCell ? num(firstNonEmptyRight(grid, estAcresCell.r, estAcresCell.c)) : 0;

    // Understanding score: find "Message Understanding" then next row with multiple 1–3 scores, avg them
    let clarityPct = 0;
    const mu = findCell(grid, /message\s+understanding/i);
    if(mu){
      for(let rr=mu.r+1; rr<Math.min(grid.length, mu.r+6); rr++){
        const row = grid[rr] || [];
        const scores = row.map(v => num(v)).filter(x => x>0 && x<=3.5);
        if(scores.length >= 3){
          const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
          clarityPct = (avg/3)*100;
          break;
        }
      }
    }

    // Commercial intent section (repeat/new definite + committed acres)
    const repeatCell = findCell(grid, /repeat\s+users\s+committing/i);
    const newDefCell = findCell(grid, /new\s+farmers.*definitely\s+use/i);
    const committedAcresCell = findCell(grid, /committed\s+acres/i);

    const repeatUsers = repeatCell ? num(firstNonEmptyRight(grid, repeatCell.r, repeatCell.c)) : 0;
    const newDefiniteFarmers = newDefCell ? num(firstNonEmptyRight(grid, newDefCell.r, newDefCell.c)) : 0;
    const committedAcres = committedAcresCell ? num(firstNonEmptyRight(grid, committedAcresCell.r, committedAcresCell.c)) : 0;

    // Demo plot mention (counts as "mentioned")
    let demoMention = false;
    for(let r=0;r<grid.length;r++){
      const row = grid[r] || [];
      for(let c=0;c<row.length;c++){
        const v = row[c];
        if(typeof v==="string" && /demo\s*plot/i.test(v)){
          demoMention = true;
        }
      }
    }

    // "What worked best" (top benefit proxy)
    const workedBestCell = findCell(grid, /what\s+worked\s+best/i);
    const topBenefit = workedBestCell ? safeStr(firstNonEmptyRight(grid, workedBestCell.r, workedBestCell.c)) : "";

    // Spot (sometimes filled) - try to locate "Spot:" row and read right value if present
    let spot = "";
    const spotCell = findCell(grid, /^spot:/i);
    if(spotCell){
      const v = firstNonEmptyRight(grid, spotCell.r, spotCell.c);
      const s = safeStr(v);
      if(s && /dealer|field|dera|other/i.test(s)) spot = s;
    }
    if(!spot) spot = "Unknown";

    // Derived rates
    const awarePct = totalFarmers>0 ? (knowBuctril/totalFarmers)*100 : 0;
    const defPct = wheatFarmers>0 ? (definite/wheatFarmers)*100 : 0;

    // Top reason to USE
    const reasons = extractReasons(grid);
    const topReason = reasons.length ? reasons.sort((a,b)=>b.count-a.count)[0].reason : "";

    return {
      sheet: sheetName,
      date: dateVal ? String(dateVal).slice(0,10) : "",
      day: num(dayVal),
      city: district || "Unknown",
      spot,
      village,
      totalFarmers,
      wheatFarmers,
      wheatAcres,
      estBuctrilAcres,
      knowBuctril,
      usedLastYear,
      definite,
      maybe,
      notInterested,
      awarePct,
      defPct,
      clarityPct,
      repeatUsers,
      newDefiniteFarmers,
      committedAcres,
      demoMention,
      topBenefit: topBenefit || topReason || "—",
      topReason,
      lat: latlon ? latlon.lat : null,
      lon: latlon ? latlon.lon : null,
      reasonsUse: reasons
    };
  }

  // --------------------------
  // Charts
  // --------------------------
  let cityChart=null, spotChart=null, intentChart=null, demoChart=null, reasonsChart=null;

  function destroy(chart){
    if(chart && typeof chart.destroy==="function"){
      chart.destroy();
    }
  }

  function makeDonut(ctx, labels, values, onClick){
    return new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, borderWidth: 0, hoverOffset: 8 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: "#cfe0f5" } },
          tooltip: { callbacks: { label: (t)=> `${t.label}: ${fmtInt(t.parsed)}` } }
        },
        onClick: onClick || undefined
      }
    });
  }

  function makeBar(ctx, labels, values){
    return new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Count", data: values, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display:false },
          tooltip: { callbacks: { label: (t)=> `${fmtInt(t.parsed.y)}` } }
        },
        scales: {
          x: { ticks: { color:"#cfe0f5" }, grid: { color:"rgba(255,255,255,.06)" } },
          y: { ticks: { color:"#cfe0f5" }, grid: { color:"rgba(255,255,255,.06)" } }
        }
      }
    });
  }

  // --------------------------
  // Media gallery
  // --------------------------
  function openLightbox(title, node){
    $("lbTitle").textContent = title || "Media";
    const body = $("lbBody");
    body.innerHTML = "";
    body.appendChild(node);
    $("lightbox").classList.add("open");
    $("lightbox").setAttribute("aria-hidden","false");
  }
  function closeLightbox(){
    $("lightbox").classList.remove("open");
    $("lightbox").setAttribute("aria-hidden","true");
    $("lbBody").innerHTML = "";
  }

  function renderGallery(items){
    const el = $("gallery");
    el.innerHTML = "";
    if(!items || !items.length){
      el.innerHTML = `<div class="muted">No media items found. Ensure <code>media.json</code> exists and assets are present.</div>`;
      return;
    }

    const base = baseHref();
    items.forEach((it) => {
      const card = document.createElement("div");
      card.className = "mediaCard";

      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = it.caption || it.alt || "";

      if(it.type === "video"){
        const v = document.createElement("video");
        v.className = "thumb";
        v.src = new URL(it.src, base).href;
        v.muted = true;
        v.playsInline = true;
        v.preload = "metadata";

        // Not autoplaying by default (better for bandwidth); click opens full player
        card.appendChild(v);
        card.appendChild(cap);

        card.addEventListener("click", () => {
          const vv = document.createElement("video");
          vv.src = v.src;
          vv.controls = true;
          vv.playsInline = true;
          vv.autoplay = true;
          openLightbox(it.caption || it.alt || "Video", vv);
        });

      }else{
        const img = document.createElement("img");
        img.className = "thumb";
        img.loading = "lazy";
        img.alt = it.alt || "";
        img.src = new URL(it.src, base).href;

        card.appendChild(img);
        card.appendChild(cap);

        card.addEventListener("click", () => {
          const ii = document.createElement("img");
          ii.alt = img.alt;
          ii.src = img.src;
          openLightbox(it.caption || it.alt || "Image", ii);
        });
      }

      el.appendChild(card);
    });
  }

  async function loadMediaManifest(){
    const res = await fetchFirstOk(["media.json","assets/gallery/media.json"]);
    if(!res) return [];
    try{
      const json = await res.resp.json();
      if(Array.isArray(json)) return json;
      return [];
    }catch(e){
      return [];
    }
  }

  // --------------------------
  // Main render flow
  // --------------------------
  let ALL = [];
  let SKIPPED = [];

  function uniqueSorted(arr){
    const s = Array.from(new Set(arr.filter(Boolean)));
    s.sort((a,b)=>a.localeCompare(b));
    return s;
  }

  function applyFilters(){
    const city = $("fCity").value || "ALL";
    const spot = $("fSpot").value || "ALL";
    const q = toLower($("fSearch").value || "");

    let rows = ALL.slice();

    if(city !== "ALL") rows = rows.filter(r => r.city === city);
    if(spot !== "ALL") rows = rows.filter(r => r.spot === spot);

    if(q){
      rows = rows.filter(r => (
        toLower(r.village).includes(q) ||
        toLower(r.city).includes(q) ||
        toLower(r.spot).includes(q) ||
        toLower(r.topBenefit).includes(q) ||
        toLower(r.sheet).includes(q)
      ));
    }
    return rows;
  }

  function sum(rows, key){
    return rows.reduce((a,r)=>a + (Number(r[key]||0) || 0), 0);
  }

  function avg(rows, key){
    if(!rows.length) return 0;
    return sum(rows, key) / rows.length;
  }

  function updateKPIs(rows){
    $("kSessions").textContent = fmtInt(rows.length);
    $("kSessionsSub").textContent = `Skipped sheets: ${fmtInt(SKIPPED.length)}`;

    const wheatFarmers = sum(rows, "wheatFarmers");
    const acres = sum(rows, "wheatAcres");
    const buctrilAcres = sum(rows, "estBuctrilAcres");

    $("kWheatFarmers").textContent = fmtInt(wheatFarmers);
    $("kWheatFarmersSub").textContent = `Avg awareness: ${fmtPct(avg(rows,"awarePct"))}`;

    $("kAcres").textContent = fmtInt(acres);
    $("kAcresSub").textContent = `Avg clarity: ${fmtPct(avg(rows,"clarityPct"))}`;

    $("kBuctrilAcres").textContent = fmtInt(buctrilAcres);
    $("kBuctrilAcresSub").textContent = `Avg definite: ${fmtPct(avg(rows,"defPct"))}`;
  }

  function updateDataQuality(){
    const parsed = ALL.length;
    const skipped = SKIPPED.length;
    const msg = `Data quality: ${parsed} parsed session sheets, ${skipped} skipped (blank/template or missing quick report title).`;
    $("dqBox").textContent = msg;
    $("dqBox").classList.toggle("error", parsed===0);
  }

  function updateCharts(rows){
    // City donut = sum wheat farmers by city
    const byCity = new Map();
    rows.forEach(r => {
      const k = r.city || "Unknown";
      byCity.set(k, (byCity.get(k)||0) + (r.wheatFarmers||0));
    });
    const cityLabels = Array.from(byCity.keys()).sort((a,b)=>a.localeCompare(b));
    const cityValues = cityLabels.map(k => byCity.get(k));

    destroy(cityChart);
    cityChart = makeDonut(
      $("cityDonut").getContext("2d"),
      cityLabels,
      cityValues,
      (evt, elems) => {
        if(!elems || !elems.length) return;
        const idx = elems[0].index;
        const selectedCity = cityLabels[idx];
        $("fCity").value = selectedCity;
        refresh();
      }
    );

    // Spot donut = sum wheat farmers by spot (filtered by selected city if any)
    const citySelected = $("fCity").value || "ALL";
    const baseRows = (citySelected==="ALL") ? rows : rows.filter(r=>r.city===citySelected);
    const bySpot = new Map();
    baseRows.forEach(r => {
      const k = r.spot || "Unknown";
      bySpot.set(k, (bySpot.get(k)||0) + (r.wheatFarmers||0));
    });
    const spotLabels = Array.from(bySpot.keys()).sort((a,b)=>a.localeCompare(b));
    const spotValues = spotLabels.map(k => bySpot.get(k));

    destroy(spotChart);
    spotChart = makeDonut($("spotDonut").getContext("2d"), spotLabels, spotValues, (evt, elems)=>{
      if(!elems || !elems.length) return;
      const idx = elems[0].index;
      const selectedSpot = spotLabels[idx];
      $("fSpot").value = selectedSpot;
      refresh();
    });

    // Intent donut
    const def = sum(rows,"definite");
    const may = sum(rows,"maybe");
    const no  = sum(rows,"notInterested");
    destroy(intentChart);
    intentChart = makeDonut($("intentDonut").getContext("2d"), ["Definite","Maybe","Not Interested"], [def, may, no]);

    // Demo donut
    const demoYes = rows.filter(r=>r.demoMention).length;
    const demoNo  = Math.max(0, rows.length - demoYes);
    destroy(demoChart);
    demoChart = makeDonut($("demoDonut").getContext("2d"), ["Demo plot mentioned","Not mentioned"], [demoYes, demoNo]);

    // Reasons pivot (aggregate counts)
    const reasonTotals = new Map();
    rows.forEach(r=>{
      (r.reasonsUse||[]).forEach(x=>{
        const k = x.reason;
        reasonTotals.set(k, (reasonTotals.get(k)||0) + (x.count||0));
      });
    });
    const top = Array.from(reasonTotals.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const rLabels = top.map(x=>x[0]);
    const rVals = top.map(x=>x[1]);

    destroy(reasonsChart);
    reasonsChart = makeBar($("reasonsBar").getContext("2d"), rLabels, rVals);
  }

  function updateFilterOptions(){
    const cities = uniqueSorted(ALL.map(r=>r.city));
    const spots  = uniqueSorted(ALL.map(r=>r.spot));

    const citySel = $("fCity");
    const spotSel = $("fSpot");

    const prevCity = citySel.value || "ALL";
    const prevSpot = spotSel.value || "ALL";

    citySel.innerHTML = `<option value="ALL">All Cities</option>` + cities.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    spotSel.innerHTML = `<option value="ALL">All Spots</option>` + spots.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");

    // restore if possible
    if(cities.includes(prevCity)) citySel.value = prevCity; else citySel.value = "ALL";
    if(spots.includes(prevSpot)) spotSel.value = prevSpot; else spotSel.value = "ALL";
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  function refresh(){
    const rows = applyFilters();
    updateKPIs(rows);
    updateDataQuality();
    updateCharts(rows);
  }

  async function loadXlsx(){
    const res = await fetchFirstOk(["Buctril_Super_Activations.xlsx"]);
    if(!res) throw new Error("Buctril_Super_Activations.xlsx not found in repo root.");
    const buf = await res.resp.arrayBuffer();
    const wb = XLSX.read(buf, {type:"array"});
    return wb;
  }

  async function buildFromXlsx(){
    setStatus("Loading XLSX (Buctril_Super_Activations.xlsx)…");
    const wb = await loadXlsx();

    const sheetNames = wb.SheetNames || [];
    const sessionSheets = sheetNames.filter(n => /^D\d+S\d+$/i.test(n));

    const records = [];
    const skipped = [];

    for(const name of sessionSheets){
      const grid = sheetToGrid(wb, name);
      const rec = extractSessionRecord(name, grid);
      if(rec) records.push(rec);
      else skipped.push(name);
    }

    ALL = records;
    SKIPPED = skipped;

    // Mode indicator
    $("dataMode").textContent = `Data: XLSX (${records.length} sessions)`;
    setStatus(`Loaded ${records.length} session sheets from XLSX.`, records.length===0);

    updateFilterOptions();
    refresh();
  }

  async function initLogos(){
    // If logos fail (case mismatch), try a few alternates.
    async function trySet(imgId, candidates){
      const img = $(imgId);
      if(!img) return;
      const base = baseHref();
      for(const c of candidates){
        try{
          const url = new URL(c, base).href;
          const r = await fetch(url, {method:"GET", cache:"no-store"});
          if(r.ok){
            img.src = url;
            return;
          }
        }catch(e){}
      }
    }
    await trySet("logoBayer", ["Bayer.jpg","bayer.jpg","BAYER.jpg","Bayer.jpeg","bayer.jpeg"]);
    await trySet("logoBuctril", ["Buctril.jpg","buctril.jpg","BUCTRIL.jpg","Buctril.jpeg","buctril.jpeg"]);
    await trySet("logoInteract", ["Interact.gif","interact.gif","INTERACT.gif"]);
  }

  APP.init = async function(){
    if(ensureTrailingSlash()) return;

    $("lbClose").addEventListener("click", closeLightbox);
    $("lightbox").addEventListener("click", (e)=>{
      if(e.target && e.target.id==="lightbox") closeLightbox();
    });

    $("fCity").addEventListener("change", refresh);
    $("fSpot").addEventListener("change", refresh);
    $("fSearch").addEventListener("input", refresh);
    $("btnClear").addEventListener("click", ()=>{
      $("fCity").value="ALL";
      $("fSpot").value="ALL";
      $("fSearch").value="";
      refresh();
    });

    await initLogos();

    // Build from XLSX (primary)
    try{
      await buildFromXlsx();
    }catch(err){
      setStatus(err.message || String(err), true);
      $("dataMode").textContent = "Data: ERROR";
    }

    // Media (independent from data)
    const media = await loadMediaManifest();
    renderGallery(media);
  };

})();