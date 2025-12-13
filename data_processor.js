/* Buctril Dashboard (Rev3)
 * Fixes:
 * - XLSX library missing: auto-load fallback CDNs when XLSX is undefined.
 * - Wrong pivots (e.g., phone numbers summed): pivots are COUNT-based from SUM sheet reason columns.
 * - Unknown donut: reads City + Session Location from SUM sheet.
 * - Missing bg.mp4: checks common locations and hides video if not present.
 * - Media not loading: retries path and .jpeg/.jpg variations.
 *
 * Expected repo root files:
 * - index.html
 * - data_processor.js
 * - Buctril_Super_Activations.xlsx
 * - media.json  (optional but recommended)
 * - Bayer.jpg, Buctril.jpg, Interact.gif (optional)
 * - bg.mp4 or assets/bg.mp4 (optional)
 */

(function(){
  "use strict";

  // ---------- Small utilities ----------
  function $(id){ return document.getElementById(id); }
  function text(el, v){ if(el) el.textContent = (v===null||v===undefined) ? "–" : String(v); }
  function safeText(v){ return (v===null||v===undefined) ? "" : String(v).trim(); }
  function safeNumber(v){
    if(v===null||v===undefined||v==="") return 0;
    if(typeof v === "number" && isFinite(v)) return v;
    var s = String(v).replace(/,/g,"").trim();
    var m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? (parseFloat(m[0]) || 0) : 0;
  }
  function fmtInt(n){ try { return Math.round(n).toLocaleString("en-US"); } catch(e){ return String(Math.round(n)); } }
  function fmtPct(p){ if(!isFinite(p)) return "–"; return (Math.round(p*10)/10).toFixed(1) + "%"; }
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }
  function normHeader(h){
    return safeText(h).replace(/^\ufeff/,"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim().toLowerCase();
  }

  // Deterministic city colors (stable between reloads)
  function hashHue(s){
    var str = (safeText(s).toLowerCase());
    var h = 0;
    for(var i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function cityColor(city){ return "hsl(" + hashHue(city) + ", 70%, 55%)"; }
  function spotColor(city, i){
    var h = hashHue(city);
    var l = 72 - (i % 7) * 6;
    return "hsl(" + h + ", 70%, " + l + "%)";
  }

  function setBar(id, pct){
    var el = $(id);
    if(!el) return;
    var p = clamp01((pct||0)/100)*100;
    el.style.width = p.toFixed(1) + "%";
  }

  function showDQ(msg){
    var el = $("dqBox");
    if(!el) return;
    el.style.display = "block";
    el.innerHTML = msg;
  }
  function hideDQ(){
    var el = $("dqBox");
    if(!el) return;
    el.style.display = "none";
    el.innerHTML = "";
  }

  function setStatus(msg){
    var el = $("dataStatus");
    if(el) el.textContent = msg;
  }

  // ---------- Dynamic lib loader (for Safari / CDN blocking) ----------
  function loadScript(url){
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = function(){ resolve(true); };
      s.onerror = function(){ reject(new Error("Failed to load " + url)); };
      document.head.appendChild(s);
    });
  }
  async function ensureGlobal(name, urls){
    if(window[name]) return true;
    for(var i=0;i<urls.length;i++){
      try{
        await loadScript(urls[i]);
        if(window[name]) return true;
      }catch(e){}
    }
    return !!window[name];
  }

  // ---------- Background video existence check ----------
  async function trySetBgVideo(){
    var v = document.getElementById("bgVideo");
    if(!v) return;
    var candidates = ["bg.mp4", "assets/bg.mp4"];
    for(var i=0;i<candidates.length;i++){
      try{
        var res = await fetch(candidates[i], { method:"HEAD", cache:"no-store" });
        if(res && res.ok){
          v.src = candidates[i] + "?v=" + Date.now();
          v.style.display = "block";
          return;
        }
      }catch(e){}
    }
    // leave hidden if none
  }

  // ---------- XLSX loading + parsing ----------
  async function fetchArrayBuffer(path){
    var res = await fetch(path + "?v=" + Date.now(), { cache:"no-store" });
    if(!res.ok) throw new Error("Fetch failed for " + path + " (" + res.status + ")");
    var buf = await res.arrayBuffer();

    // Detect Git LFS pointer (rare but common cause)
    try{
      var head = new TextDecoder("utf-8").decode(buf.slice(0, 200));
      if(head && head.indexOf("git-lfs.github.com/spec") >= 0){
        throw new Error("XLSX appears to be a Git LFS pointer file. Upload the actual .xlsx binary (disable LFS for this file).");
      }
    }catch(e2){
      // ignore decoder issues
    }
    return buf;
  }

  function findHeaderRow(sheet, want){
    // Look in first 10 rows for a cell matching want (e.g., "City")
    for(var r=0;r<10;r++){
      var row = sheet[r] || [];
      for(var c=0;c<row.length;c++){
        if(normHeader(row[c]) === want) return r;
      }
    }
    return -1;
  }

  function sheetToMatrix(ws){
    // array of arrays; keep empty as ""
    return XLSX.utils.sheet_to_json(ws, { header:1, raw:true, blankrows:false, defval:"" });
  }

  function buildRowsFromSUM(wb){
    var sheetName = "SUM";
    if(!wb.Sheets[sheetName]){
      // sometimes renamed
      var alt = Object.keys(wb.Sheets).find(function(n){ return normHeader(n) === "sum"; });
      if(alt) sheetName = alt;
    }
    var ws = wb.Sheets[sheetName];
    if(!ws) throw new Error("Could not find SUM sheet in workbook.");

    var matrix = sheetToMatrix(ws);
    var headerRowIdx = findHeaderRow(matrix, "city");
    if(headerRowIdx < 0) throw new Error("Could not detect header row in SUM sheet (expected a 'City' column).");

    var headers = matrix[headerRowIdx].map(function(h){ return safeText(h); });
    var hnorm = headers.map(function(h){ return normHeader(h); });
    var rows = [];

    function idxOf(headerName){
      var want = headerName.toLowerCase();
      for(var i=0;i<hnorm.length;i++){
        if(hnorm[i] === want) return i;
      }
      return -1;
    }

    // Required fields
    var iCity = idxOf("city");
    var iSpot = idxOf("session location");
    var iDate = idxOf("date");
    var iDay  = idxOf("day");
    var iFarm = idxOf("total farmers");
    var iAcres = idxOf("total wheat acres");
    var iKnow = idxOf("know buctril");
    var iDef  = idxOf("will definitely use");
    var iMaybe= idxOf("maybe");
    var iNot  = idxOf("not interested");
    var iEst  = idxOf("estimated buctril acres from this session");

    var scoreNames = [
      "score understood: yield loss 20-40%",
      "score understood: golden period",
      "score understood: buctril broadleaf",
      "score understood combine benefit: buctril+atlantis",
      "score: safety ppe"
    ];
    var scoreIdx = scoreNames.map(idxOf);

    // Reason columns
    var reasonUseIdx = [];
    var reasonNotIdx = [];
    var reasonUseLabels = [];
    var reasonNotLabels = [];

    for(var i=0;i<headers.length;i++){
      var nh = hnorm[i];
      var h = headers[i];
      if(!nh) continue;
      if(nh.indexOf("reason") === 0){
        if(nh.indexOf("reason to  use:") === 0 || nh.indexOf("reason to use:") === 0 || nh.indexOf("reason to use") === 0){
          if(nh.indexOf("reason not") === 0) continue;
          if(nh.indexOf("top reason") === 0) continue;
          reasonUseIdx.push(i);
          reasonUseLabels.push(h.replace(/^Reason\s*to\s*Use\s*:?\s*/i,"").replace(/^Reason\s*to\s*Use\s*/i,"").trim());
        }
        if(nh.indexOf("reason not to use:") === 0 || nh.indexOf("reason not to use") === 0){
          reasonNotIdx.push(i);
          reasonNotLabels.push(h.replace(/^Reason\s*Not\s*to\s*Use\s*:?\s*/i,"").replace(/^Reason\s*Not\s*to\s*Use\s*/i,"").trim());
        }
      }
    }

    for(var r=headerRowIdx+1;r<matrix.length;r++){
      var row = matrix[r];
      if(!row || !row.length) continue;

      var city = safeText(row[iCity]);
      var spot = safeText(row[iSpot]);
      var total = safeNumber(row[iFarm]);

      // Ignore non-session rows (Total Farmers empty/0)
      if(!city || total <= 0) continue;

      // Exclude Multan as requested
      if(city.trim().toLowerCase() === "multan") continue;

      var acres = safeNumber(row[iAcres]);
      var know = safeNumber(row[iKnow]);
      var def  = safeNumber(row[iDef]);
      var may  = safeNumber(row[iMaybe]);
      var notI = safeNumber(row[iNot]);
      var estA = safeNumber(row[iEst]);

      // Excel date can be a number serial or a string
      var dateRaw = row[iDate];
      var dateStr = "";
      if(typeof dateRaw === "number"){
        var d = XLSX.SSF.parse_date_code(dateRaw);
        if(d) dateStr = String(d.y).padStart(4,"0")+"-"+String(d.m).padStart(2,"0")+"-"+String(d.d).padStart(2,"0");
      } else {
        dateStr = safeText(dateRaw);
      }

      var day = safeText(row[iDay]);

      var scores = [];
      for(var si=0;si<scoreIdx.length;si++){
        var idx = scoreIdx[si];
        if(idx >= 0){
          var sc = safeNumber(row[idx]);
          if(sc > 0) scores.push(sc);
        }
      }
      var clarityPct = 0;
      if(scores.length){
        var avg = scores.reduce(function(a,b){return a+b;},0) / scores.length;
        clarityPct = (avg / 3) * 100;
      }

      // reasons (counts)
      var useCounts = {};
      for(var u=0;u<reasonUseIdx.length;u++){
        var cidx = reasonUseIdx[u];
        var label = reasonUseLabels[u] || ("Use " + (u+1));
        var n = safeNumber(row[cidx]);
        if(n > 0) useCounts[label] = (useCounts[label]||0) + n;
      }
      var notCounts = {};
      for(var n2=0;n2<reasonNotIdx.length;n2++){
        var cidx2 = reasonNotIdx[n2];
        var label2 = reasonNotLabels[n2] || ("NotUse " + (n2+1));
        var nn = safeNumber(row[cidx2]);
        if(nn > 0) notCounts[label2] = (notCounts[label2]||0) + nn;
      }

      rows.push({
        city: city || "Unknown",
        spot: spot || "Unknown",
        date: dateStr,
        day: day,
        totalFarmers: total,
        wheatAcres: acres,
        knowBuctril: know,
        willDefinite: def,
        maybe: may,
        notInterested: notI,
        estBuctrilAcres: estA,
        clarityPct: clarityPct,
        useCounts: useCounts,
        notCounts: notCounts
      });
    }

    return rows;
  }

  // ---------- Filtering ----------
  var state = {
    all: [],
    filtered: [],
    city: "",
    spot: "",
    search: ""
  };

  function applyFilters(){
    var city = state.city.trim().toLowerCase();
    var spot = state.spot.trim().toLowerCase();
    var q = state.search.trim().toLowerCase();

    state.filtered = state.all.filter(function(r){
      if(city && r.city.toLowerCase() !== city) return false;
      if(spot && r.spot.toLowerCase() !== spot) return false;

      if(q){
        var hay = (r.city + " " + r.spot + " " + (r.day||"") + " " + (r.date||"")).toLowerCase();
        if(hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function unique(list){
    var seen = {};
    var out = [];
    for(var i=0;i<list.length;i++){
      var v = list[i];
      var k = safeText(v);
      if(!k) continue;
      if(seen[k]) continue;
      seen[k]=true;
      out.push(k);
    }
    return out;
  }

  function buildFilterOptions(){
    var cities = unique(state.all.map(function(r){ return r.city; })).sort(function(a,b){ return a.localeCompare(b); });

    var citySel = $("filter-city");
    if(citySel){
      citySel.innerHTML = '<option value="">All Cities</option>' + cities.map(function(c){
        return '<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>';
      }).join("");
      citySel.value = state.city || "";
    }

    buildSpotOptions();
  }

  function buildSpotOptions(){
    var base = state.city ? state.all.filter(function(r){ return r.city === state.city; }) : state.all;
    var spots = unique(base.map(function(r){ return r.spot; })).sort(function(a,b){ return a.localeCompare(b); });

    var spotSel = $("filter-spot");
    if(spotSel){
      spotSel.innerHTML = '<option value="">All Spots</option>' + spots.map(function(s){
        return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';
      }).join("");
      spotSel.value = state.spot || "";
    }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  // ---------- Metrics ----------
  function sum(list, fn){
    var t = 0;
    for(var i=0;i<list.length;i++) t += fn(list[i]) || 0;
    return t;
  }

  function computeDateRange(rows){
    var dates = rows.map(function(r){ return safeText(r.date); }).filter(Boolean);
    // Expect YYYY-MM-DD strings
    var parsed = dates.map(function(d){
      var m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
      if(!m) return null;
      return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    }).filter(Boolean);
    if(!parsed.length) return {days:null, from:"–", to:"–"};
    parsed.sort(function(a,b){ return a-b; });
    var from = parsed[0];
    var to = parsed[parsed.length-1];
    var diff = Math.round((to - from) / (24*3600*1000)) + 1;
    return {
      days: diff,
      from: from.toISOString().slice(0,10),
      to: to.toISOString().slice(0,10)
    };
  }

  // ---------- Charts ----------
  var drillChart=null, intentChart=null, useChart=null, notChart=null;

  function destroyChart(ch){ try{ if(ch) ch.destroy(); }catch(e){} }

  function buildDrillData(rows){
    // Outer ring: city by farmers
    var cityMap = {};
    rows.forEach(function(r){
      cityMap[r.city] = (cityMap[r.city]||0) + (r.totalFarmers||0);
    });
    var cities = Object.keys(cityMap).sort(function(a,b){ return cityMap[b]-cityMap[a]; });

    // Inner ring: spots for selected city, else top spots overall
    var innerBase = rows;
    var selectedCity = state.city || "";
    if(selectedCity){
      innerBase = rows.filter(function(r){ return r.city === selectedCity; });
    }
    var spotMap = {};
    innerBase.forEach(function(r){
      var key = r.spot || "Unknown";
      spotMap[key] = (spotMap[key]||0) + (r.totalFarmers||0);
    });
    var spots = Object.keys(spotMap).sort(function(a,b){ return spotMap[b]-spotMap[a]; }).slice(0, 10);

    var cityValues = cities.map(function(c){ return cityMap[c]; });
    var cityColors = cities.map(cityColor);

    var spotValues = spots.map(function(s){ return spotMap[s]; });
    var spotColors = spots.map(function(_,i){ return spotColor(selectedCity || "all", i); });

    return {
      outerLabels: cities,
      outerValues: cityValues,
      outerColors: cityColors,
      innerLabels: spots,
      innerValues: spotValues,
      innerColors: spotColors
    };
  }

  function buildIntent(rows){
    var def = sum(rows, function(r){ return r.willDefinite; });
    var may = sum(rows, function(r){ return r.maybe; });
    var notI = sum(rows, function(r){ return r.notInterested; });
    return { labels:["Definite","Maybe","Not interested"], values:[def, may, notI] };
  }

  function aggReasons(rows, key){
    var out = {};
    rows.forEach(function(r){
      var obj = r[key] || {};
      Object.keys(obj).forEach(function(k){
        out[k] = (out[k]||0) + safeNumber(obj[k]);
      });
    });
    var pairs = Object.keys(out).map(function(k){ return {k:k, v:out[k]}; })
      .filter(function(p){ return p.v > 0; })
      .sort(function(a,b){ return b.v - a.v; })
      .slice(0, 10);
    return { labels: pairs.map(function(p){return p.k;}), values: pairs.map(function(p){return p.v;}) };
  }

  function renderCharts(){
    if(!window.Chart){
      showDQ("Charts failed to load (Chart.js missing).");
      return;
    }

    // Drill donut (two rings in one doughnut chart)
    var drill = buildDrillData(state.filtered);
    var drillCtx = $("drillDonut").getContext("2d");
    destroyChart(drillChart);
    drillChart = new Chart(drillCtx, {
      type:"doughnut",
      data:{
        labels: drill.outerLabels,
        datasets:[
          { // outer ring
            label:"Cities",
            data: drill.outerValues,
            backgroundColor: drill.outerColors,
            borderColor: "rgba(255,255,255,.9)",
            borderWidth: 2,
            hoverOffset: 6,
            weight: 2
          },
          { // inner ring
            label: state.city ? ("Spots in " + state.city) : "Top spots",
            data: drill.innerValues,
            backgroundColor: drill.innerColors,
            borderColor: "rgba(255,255,255,.9)",
            borderWidth: 2,
            hoverOffset: 6,
            weight: 1
          }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ position:"bottom", labels:{ boxWidth:18, font:{weight:"700"} } },
          tooltip:{
            callbacks:{
              label: function(ctx){
                var v = ctx.parsed || 0;
                var label = ctx.label || "";
                return " " + label + ": " + fmtInt(v);
              }
            }
          }
        },
        onClick: function(evt, elems){
          if(!elems || !elems.length) return;
          var el = elems[0];
          var datasetIndex = el.datasetIndex;
          var index = el.index;

          // datasetIndex 0 = city ring
          if(datasetIndex === 0){
            var city = drill.outerLabels[index];
            state.city = (state.city === city) ? "" : city;
            // when city changes, reset spot filter
            state.spot = "";
            buildSpotOptions();
            applyFilters();
            renderAll();
          }
          // datasetIndex 1 = inner ring (spot)
          if(datasetIndex === 1){
            var spot = drill.innerLabels[index];
            state.spot = (state.spot === spot) ? "" : spot;
            var spotSel = $("filter-spot");
            if(spotSel) spotSel.value = state.spot;
            applyFilters();
            renderAll();
          }
        }
      }
    });

    // Intent donut
    var intent = buildIntent(state.filtered);
    var intentCtx = $("intentDonut").getContext("2d");
    destroyChart(intentChart);
    intentChart = new Chart(intentCtx, {
      type:"doughnut",
      data:{
        labels:intent.labels,
        datasets:[{
          data:intent.values,
          backgroundColor:["#2e7d32","#ffb300","#b71c1c"],
          borderColor:"rgba(255,255,255,.9)",
          borderWidth:2,
          hoverOffset:6
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:"bottom" } }
      }
    });

    // Reasons (bars)
    var use = aggReasons(state.filtered, "useCounts");
    var notU = aggReasons(state.filtered, "notCounts");

    destroyChart(useChart);
    useChart = new Chart($("useBar").getContext("2d"), {
      type:"bar",
      data:{ labels: use.labels, datasets:[{ label:"Count", data: use.values, borderWidth:0 }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales:{
          x:{ ticks:{ font:{weight:"700"} } },
          y:{ beginAtZero:true }
        }
      }
    });

    destroyChart(notChart);
    notChart = new Chart($("notUseBar").getContext("2d"), {
      type:"bar",
      data:{ labels: notU.labels, datasets:[{ label:"Count", data: notU.values, borderWidth:0 }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales:{
          x:{ ticks:{ font:{weight:"700"} } },
          y:{ beginAtZero:true }
        }
      }
    });
  }

  function renderMetrics(){
    var rows = state.filtered;

    var sessions = rows.length;
    var farmers = sum(rows, function(r){ return r.totalFarmers; });
    var acres = sum(rows, function(r){ return r.wheatAcres; });
    var est = sum(rows, function(r){ return r.estBuctrilAcres; });
    var cities = unique(rows.map(function(r){ return r.city; })).length;

    var know = sum(rows, function(r){ return r.knowBuctril; });
    var def = sum(rows, function(r){ return r.willDefinite; });

    var awareness = farmers ? (know / farmers * 100) : 0;
    var definite = farmers ? (def / farmers * 100) : 0;

    // Weighted average clarity by farmers
    var clarityNum = sum(rows, function(r){ return (r.clarityPct||0) * (r.totalFarmers||0); });
    var clarityDen = sum(rows, function(r){ return (r.totalFarmers||0); });
    var clarity = clarityDen ? (clarityNum / clarityDen) : 0;

    text($("metric-sessions"), fmtInt(sessions));
    text($("metric-farmers"), fmtInt(farmers));
    text($("metric-acres"), fmtInt(acres));
    text($("metric-cities"), fmtInt(cities));
    text($("metric-buctril-acres"), fmtInt(est));

    text($("metric-awareness"), fmtPct(awareness));
    text($("metric-definite"), fmtPct(definite));
    text($("metric-clarity"), fmtPct(clarity));

    setBar("awareness-bar", awareness);
    setBar("definite-bar", definite);
    setBar("clarity-bar", clarity);

    // Hero KPIs (unfiltered overall)
    var allFarmers = sum(state.all, function(r){ return r.totalFarmers; });
    text($("hero-farmers"), fmtInt(allFarmers));
    text($("hero-sessions"), fmtInt(state.all.length));

    // Campaign days + range
    var dr = computeDateRange(state.all);
    text($("metric-days"), dr.days ? fmtInt(dr.days) : "–");
    text($("metric-daterange"), (dr.from && dr.to && dr.from!=="–") ? (dr.from + " → " + dr.to) : "–");
  }

  function renderAll(){
    if(!state.filtered.length){
      showDQ("No rows match your current filters. Clear filters to see data.");
    } else {
      hideDQ();
    }
    renderMetrics();
    renderCharts();
  }

  // ---------- Media ----------
  function buildCandidateSrc(src){
    var s = safeText(src);
    if(!s) return [];
    var out = [];

    // as-is
    out.push(s);

    // swap .jpeg/.jpg
    if(s.toLowerCase().endsWith(".jpeg")) out.push(s.slice(0,-5)+".jpg");
    if(s.toLowerCase().endsWith(".jpg")) out.push(s.slice(0,-4)+".jpeg");

    // if in assets/gallery, try root
    if(s.indexOf("assets/gallery/") === 0){
      out.push(s.replace("assets/gallery/",""));
    } else {
      // try adding prefix
      out.push("assets/gallery/" + s.replace(/^\/+/,""));
    }

    // also try gallery/
    if(s.indexOf("gallery/") === 0){
      out.push(s.replace("gallery/",""));
    } else {
      out.push("gallery/" + s.replace(/^\/+/,""));
    }

    // de-dup
    var seen = {};
    return out.filter(function(x){
      if(seen[x]) return false;
      seen[x]=true;
      return true;
    });
  }

  function setMediaWithFallback(el, src, isVideo){
    var cand = buildCandidateSrc(src);
    var i = 0;

    function tryNext(){
      if(i >= cand.length){
        // final placeholder
        if(isVideo){
          el.removeAttribute("src");
          el.poster = "";
        } else {
          el.removeAttribute("src");
        }
        return;
      }
      var s = cand[i++] + (cand[i-1].indexOf("?")>=0 ? "" : ("?v=" + Date.now()));
      if(isVideo){
        el.src = s;
        el.load();
      } else {
        el.src = s;
      }
    }

    el.addEventListener("error", function(){
      tryNext();
    }, { once:false });

    tryNext();
  }

  async function loadMediaList(){
    var candidates = ["media.json", "assets/gallery/media.json"];
    for(var i=0;i<candidates.length;i++){
      try{
        var res = await fetch(candidates[i] + "?v=" + Date.now(), { cache:"no-store" });
        if(!res.ok) continue;
        return await res.json();
      }catch(e){}
    }
    return [];
  }

  function openLightbox(item){
    var lb = $("lightbox");
    var body = $("lbBody");
    var title = $("lbTitle");
    if(!lb || !body || !title) return;

    body.innerHTML = "";
    title.textContent = item.caption || item.alt || "Media";

    if(item.type === "video"){
      var v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.autoplay = true;
      v.muted = false;
      setMediaWithFallback(v, item.src, true);
      body.appendChild(v);
    } else {
      var img = document.createElement("img");
      img.alt = item.alt || "image";
      setMediaWithFallback(img, item.src, false);
      body.appendChild(img);
    }

    lb.classList.add("active");
    lb.setAttribute("aria-hidden", "false");
  }

  function closeLightbox(){
    var lb = $("lightbox");
    var body = $("lbBody");
    if(!lb || !body) return;
    lb.classList.remove("active");
    lb.setAttribute("aria-hidden", "true");
    body.innerHTML = "";
  }

  async function renderGallery(){
    var g = $("gallery");
    if(!g) return;
    g.innerHTML = "";

    var items = await loadMediaList();
    if(!items || !items.length){
      var div = document.createElement("div");
      div.className = "muted";
      div.style.padding = "10px 4px";
      div.textContent = "No media.json found (or it is empty). Upload media.json and your assets (assets/gallery/*).";
      g.appendChild(div);
      return;
    }

    items.slice(0, 80).forEach(function(item){
      var tile = document.createElement("div");
      tile.className = "tile";

      var thumb = document.createElement("div");
      thumb.className = "thumb";

      if(item.type === "video"){
        var v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "metadata";
        setMediaWithFallback(v, item.src, true);

        // add a simple poster frame via first frame if available
        // (browser handles it)

        thumb.appendChild(v);
        var b = document.createElement("div");
        b.className = "badge";
        b.textContent = "Video";
        thumb.appendChild(b);
      } else {
        var img = document.createElement("img");
        img.alt = item.alt || "image";
        setMediaWithFallback(img, item.src, false);
        thumb.appendChild(img);
        var b2 = document.createElement("div");
        b2.className = "badge";
        b2.textContent = "Photo";
        thumb.appendChild(b2);
      }

      var cap = document.createElement("div");
      cap.className = "cap";
      var t = document.createElement("div");
      t.className = "t";
      t.textContent = item.alt || "Media";
      var s = document.createElement("div");
      s.className = "s";
      s.textContent = item.caption || "";
      cap.appendChild(t);
      cap.appendChild(s);

      tile.appendChild(thumb);
      tile.appendChild(cap);

      tile.addEventListener("click", function(){ openLightbox(item); });

      g.appendChild(tile);
    });

    var closeBtn = $("lbClose");
    if(closeBtn) closeBtn.onclick = closeLightbox;
    var lb = $("lightbox");
    if(lb){
      lb.addEventListener("click", function(e){
        if(e.target === lb) closeLightbox();
      });
    }
  }

  // ---------- Wire events ----------
  function wireUI(){
    var citySel = $("filter-city");
    var spotSel = $("filter-spot");
    var search = $("filter-search");
    var clear = $("btn-clear");

    if(citySel){
      citySel.addEventListener("change", function(){
        state.city = citySel.value;
        state.spot = "";
        buildSpotOptions();
        applyFilters();
        renderAll();
      });
    }
    if(spotSel){
      spotSel.addEventListener("change", function(){
        state.spot = spotSel.value;
        applyFilters();
        renderAll();
      });
    }
    if(search){
      var t=null;
      search.addEventListener("input", function(){
        clearTimeout(t);
        t = setTimeout(function(){
          state.search = search.value;
          applyFilters();
          renderAll();
        }, 150);
      });
    }
    if(clear){
      clear.addEventListener("click", function(){
        state.city = ""; state.spot = ""; state.search = "";
        if(citySel) citySel.value = "";
        if(spotSel) spotSel.value = "";
        if(search) search.value = "";
        buildSpotOptions();
        applyFilters();
        renderAll();
      });
    }
  }

  // ---------- Init ----------
  async function init(){
    try{
      setStatus("Initializing libraries…");
      hideDQ();

      // Make bg optional
      trySetBgVideo();

      // Ensure Chart and XLSX exist (fallback if CDN blocked)
      var chartOk = await ensureGlobal("Chart", [
        "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
        "https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
      ]);

      var xlsxOk = await ensureGlobal("XLSX", [
        "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
        "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
      ]);

      if(!chartOk) showDQ("Chart.js could not be loaded (network/CDN blocked). Charts will not render.");
      if(!xlsxOk) throw new Error("Can't find variable: XLSX (xlsx library failed to load).");

      setStatus("Loading XLSX…");

      // Load workbook
      var xlsxPathCandidates = ["Buctril_Super_Activations.xlsx", "buctril_super_activations.xlsx"];
      var buf=null, usedPath=null;
      for(var i=0;i<xlsxPathCandidates.length;i++){
        try{
          buf = await fetchArrayBuffer(xlsxPathCandidates[i]);
          usedPath = xlsxPathCandidates[i];
          break;
        }catch(e){}
      }
      if(!buf) throw new Error("Could not load Buctril_Super_Activations.xlsx from repo root.");

      var u8 = new Uint8Array(buf);
      var wb = XLSX.read(u8, { type:"array" });

      state.all = buildRowsFromSUM(wb);

      if(!state.all.length){
        throw new Error("Workbook loaded, but no session rows were detected in SUM sheet. Verify 'Total Farmers' is filled for session rows.");
      }

      // Populate filters
      buildFilterOptions();
      wireUI();

      // First render
      applyFilters();

      setStatus("Loaded " + state.all.length + " sessions from " + usedPath + " (SUM sheet).");
      renderAll();

      // Media render (non-blocking)
      renderGallery();

      // Hide loading
      var loading = document.getElementById("loading");
      if(loading) loading.style.display = "none";

    }catch(err){
      var loading = document.getElementById("loading");
      if(loading) loading.style.display = "block";

      setStatus("Data load failed.");
      showDQ(
        "Data load error: <code>" + escapeHtml(err.message || String(err)) + "</code><br><br>" +
        "Checklist:<br>" +
        "1) Ensure <code>Buctril_Super_Activations.xlsx</code> is in repo root (same folder as index.html).<br>" +
        "2) Ensure GitHub Pages is serving the latest files (hard refresh: add <code>?v=3</code> to URL).<br>" +
        "3) If using Git LFS, upload the real .xlsx binary instead of a pointer.<br>" +
        "4) If <code>XLSX</code> still missing, your browser/network is blocking CDNs—upload a local <code>xlsx.full.min.js</code> and include it in index.html."
      );
      var loadEl = document.getElementById("loading");
      if(loadEl) loadEl.textContent = "Error: " + (err.message || String(err));
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();