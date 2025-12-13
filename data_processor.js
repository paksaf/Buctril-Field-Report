/* Buctril Super Farmer Education Drive – Dashboard Processor
   - Green theme + donut navigation (Cities → Spots) + pivot charts.
   - Reads Buctril_Super_Activations.xlsx (SUM sheet) in-browser (XLSX).
   - No tables; focuses on charts + map + media gallery.

   Files expected in repo root:
     - index.html
     - data_processor.js
     - Buctril_Super_Activations.xlsx
     - media.json
     - Bayer.jpg, Buctril.jpg, Interact.gif
     - (optional) assets/bg.mp4
*/

(function(){
  "use strict";

  // --------------------------
  // DOM helpers
  // --------------------------
  function $(id){ return document.getElementById(id); }

  function safeText(v){
    if(v === null || v === undefined) return "";
    var s = String(v);
    if(s === "undefined" || s === "null") return "";
    return s;
  }

  function norm(s){
    return safeText(s).trim().toLowerCase();
  }

  function toNumber(v){
    var s = safeText(v).replace(/,/g,"").trim();
    if(!s) return 0;
    var n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  function toPercent(v){
    // Accept 0–1 or 0–100 or strings like "76%" etc.
    var s = safeText(v).trim();
    if(!s) return null;
    s = s.replace("%","").replace(/,/g,"").trim();
    var n = Number(s);
    if(!Number.isFinite(n)) return null;
    if(n <= 1) n = n * 100;
    // protect against 10000% issues
    if(n > 200) return null;
    return n;
  }

  function formatInt(n){
    n = Math.round(Number(n)||0);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function format1(n){
    n = Number(n);
    if(!Number.isFinite(n)) return "–";
    return (Math.round(n*10)/10).toFixed(1);
  }

  function formatPct(n){
    n = Number(n);
    if(!Number.isFinite(n)) return "–";
    return Math.round(n) + "%";
  }

  function baseUrl(){
    // Works whether the page is opened with or without trailing slash.
    return new URL(".", window.location.href).toString();
  }

  // --------------------------
  // Colors (multi-color donut segments)
  // --------------------------
  var PALETTE = [
    "#1b5e20","#2e7d32","#388e3c","#43a047","#66bb6a","#81c784",
    "#ff7043","#fb8c00","#fdd835","#26a69a","#1e88e5","#5e35b1",
    "#8e24aa","#6d4c41","#546e7a","#00acc1","#7cb342","#c0ca33"
  ];

  function colorForKey(key){
    var h = 0;
    var s = safeText(key);
    for(var i=0;i<s.length;i++){
      h = (h*31 + s.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
  }

  function lighten(hex, amt){
    // amt: 0..1 (towards white)
    var h = hex.replace("#","");
    if(h.length !== 6) return hex;
    var r = parseInt(h.slice(0,2),16),
        g = parseInt(h.slice(2,4),16),
        b = parseInt(h.slice(4,6),16);
    r = Math.round(r + (255-r)*amt);
    g = Math.round(g + (255-g)*amt);
    b = Math.round(b + (255-b)*amt);
    return "#" + [r,g,b].map(function(x){ return x.toString(16).padStart(2,"0"); }).join("");
  }

  // --------------------------
  // Coordinate parsing (DMS → decimal)
  // --------------------------
  function dmsToDecimal(deg, min, sec, hemi){
    var d = Number(deg) + Number(min)/60 + Number(sec)/3600;
    if(hemi === "S" || hemi === "W") d = -d;
    return d;
  }

  function parseDMSPair(s){
    // Handles variants like:
    // 28°09'13.2"N 69°48'59.7"E
    // 30°11'52"N, 71°28'11"E
    // 28°09'13.2"N,69°48'59.7"E
    var t = safeText(s).replace(/,/g," ").replace(/\s+/g," ").trim();
    if(!t) return null;

    var re = /(\d{1,3})\D+(\d{1,2})\D+(\d{1,2}(?:\.\d+)?)\D*([NSEW])/gi;
    var m, parts=[];
    while((m=re.exec(t)) !== null){
      parts.push({deg:m[1],min:m[2],sec:m[3],hemi:m[4].toUpperCase()});
    }
    if(parts.length < 2) return null;

    var latPart = parts.find(function(p){ return p.hemi==="N" || p.hemi==="S"; });
    var lngPart = parts.find(function(p){ return p.hemi==="E" || p.hemi==="W"; });
    if(!latPart || !lngPart) return null;

    return {
      lat: dmsToDecimal(latPart.deg, latPart.min, latPart.sec, latPart.hemi),
      lng: dmsToDecimal(lngPart.deg, lngPart.min, lngPart.sec, lngPart.hemi)
    };
  }

  // --------------------------
  // App state
  // --------------------------
  var ALL = [];       // all session-rows (expanded)
  var FILTERED = [];  // filtered session-rows

  var state = {
    city: "",
    spot: "",
    q: ""
  };

  // Charts
  var charts = {
    awarenessDonut: null,
    definiteDonut: null,
    drillDonut: null,
    pivotSessionsByCity: null,
    pivotFarmersByCity: null,
    pivotAcresByCity: null,
    pivotRatesByCity: null
  };

  // Map
  var map = null;
  var mapLayer = null;

  // --------------------------
  // Error modal
  // --------------------------
  function showError(msg){
    try{
      var modal = document.createElement("div");
      modal.className = "error-modal";
      modal.innerHTML = '<p>' + msg.replace(/</g,"&lt;") + '</p><button>Close</button>';
      modal.querySelector("button").addEventListener("click", function(){ modal.remove(); });
      document.body.appendChild(modal);
    }catch(e){}
  }

  function setDiagnostics(html, show){
    var el = $("diagnostics");
    if(!el) return;
    el.innerHTML = html || "";
    el.style.display = show ? "block" : "none";
  }

  // --------------------------
  // Load XLSX (SUM sheet)
  // --------------------------
  function findHeaderRow(rows){
    // find row containing SN, City, Session Location
    for(var i=0;i<rows.length;i++){
      var r = rows[i] || [];
      var a = norm(r[0]);
      if(a !== "sn") continue;
      var hasCity = r.some(function(c){ return norm(c) === "city"; });
      var hasLoc = r.some(function(c){ return norm(c) === "session location"; });
      if(hasCity && hasLoc) return i;
    }
    return -1;
  }

  function rowEmpty(r){
    for(var i=0;i<r.length;i++){
      if(safeText(r[i]).trim() !== "") return false;
    }
    return true;
  }

  function readSumSheet(workbook){
    var sheet = workbook.Sheets["SUM"];
    if(!sheet) throw new Error("Sheet 'SUM' not found in XLSX.");
    var rows = XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, defval:"" });
    var hIdx = findHeaderRow(rows);
    if(hIdx < 0) throw new Error("Could not locate header row in SUM sheet.");
    var header = rows[hIdx].map(function(x){ return safeText(x).trim(); });

    function idxOf(name){
      var target = norm(name);
      for(var i=0;i<header.length;i++){
        if(norm(header[i]) === target) return i;
      }
      return -1;
    }

    var I = {
      SN: idxOf("SN"),
      FromCity: idxOf("From City"),
      City: idxOf("City"),
      Date: idxOf("Date"),
      Day: idxOf("Day"),
      Location: idxOf("Session Location"),
      Coords: idxOf("Spot Coordinates"),
      Farmers: idxOf("Total Farmers"),
      WheatFarmers: idxOf("Total Wheat Farmers"),
      Acres: idxOf("Total Wheat Acres"),
      Awareness: idxOf("Awareness Rate"),
      DefiniteRate: idxOf("Definite Use Rate"),
      WillDefinitelyUse: idxOf("Will Definitely Use"),
      Understanding: idxOf("Average Understanding Score"),
      Influencers: idxOf("No. of Key Influencers (Names Highlighted)"),
      TopUse: idxOf("Top Reason to Use (session)"),
      TopNot: idxOf("Top Reason Not to Use (session)"),
      Competitors: idxOf("Competitor Brands Mentioned (Key Influencers)")
    };

    var out = [];
    var cur = { sn:"", fromCity:"", city:"", date:"", day:"" };

    for(var r=hIdx+1; r<rows.length; r++){
      var row = rows[r];
      if(!row || rowEmpty(row)) continue;

      var sn = safeText(row[I.SN]).trim();
      var fromCity = safeText(row[I.FromCity]).trim();
      var city = safeText(row[I.City]).trim();
      var date = safeText(row[I.Date]).trim();
      var day = safeText(row[I.Day]).trim();

      if(sn){
        cur.sn = sn;
        if(fromCity) cur.fromCity = fromCity;
        if(city) cur.city = city;
        if(date) cur.date = date;
        if(day) cur.day = day;
      } else {
        // forward fill
        sn = cur.sn;
        fromCity = fromCity || cur.fromCity;
        city = city || cur.city;
        date = date || cur.date;
        day = day || cur.day;
      }

      var location = safeText(row[I.Location]).trim();
      var coordsRaw = safeText(row[I.Coords]).trim();

      // ignore Multan (explicit requirement)
      if(norm(city) === "multan") continue;

      // minimal signal check
      var farmers = toNumber(row[I.Farmers]) || toNumber(row[I.WheatFarmers]);
      var acres = toNumber(row[I.Acres]);
      var awareness = toPercent(row[I.Awareness]);
      var definite = toPercent(row[I.DefiniteRate]);
      var understanding = toPercent(row[I.Understanding]);
      var influencers = toNumber(row[I.Influencers]);

      if(!location && !coordsRaw && farmers===0 && acres===0 && awareness===null && definite===null && understanding===null){
        continue;
      }

      // derive definite if missing
      if(definite === null){
        var wd = toNumber(row[I.WillDefinitelyUse]);
        if(wd > 0 && farmers > 0) definite = (wd / farmers) * 100;
      }

      if(location === "") location = "(Unlabeled spot)";

      // normalize date: keep as ISO if parseable
      var dateISO = "";
      try{
        var d = new Date(date);
        if(!isNaN(d.getTime())) dateISO = d.toISOString().slice(0,10);
      }catch(e){}

      out.push({
        sn: sn,
        fromCity: fromCity,
        city: city,
        date: dateISO || date,
        day: day,
        spot: location,
        coordsRaw: coordsRaw,
        coords: parseDMSPair(coordsRaw),
        farmers: farmers,
        acres: acres,
        awareness: awareness,
        definite: definite,
        understanding: understanding,
        influencers: influencers,
        topUse: safeText(row[I.TopUse]).trim(),
        topNot: safeText(row[I.TopNot]).trim(),
        competitors: safeText(row[I.Competitors]).trim()
      });
    }

    return out;
  }

  function fetchXlsx(){
    var url = baseUrl() + "Buctril_Super_Activations.xlsx";
    return fetch(url).then(function(res){
      if(!res.ok) throw new Error("XLSX not found at: " + url);
      return res.arrayBuffer();
    }).then(function(buf){
      var wb = XLSX.read(buf, { type:"array" });
      return readSumSheet(wb);
    });
  }

  // --------------------------
  // Filters
  // --------------------------
  function setSelectOptions(selectEl, values, placeholder){
    var cur = selectEl.value;
    selectEl.innerHTML = "";
    var opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder || "All";
    selectEl.appendChild(opt0);

    values.forEach(function(v){
      var o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    });

    // preserve selection if possible
    if(cur && values.indexOf(cur) >= 0) selectEl.value = cur;
  }

  function uniq(arr){
    var m = Object.create(null);
    var out = [];
    arr.forEach(function(v){
      v = safeText(v).trim();
      if(!v) return;
      var k = v.toLowerCase();
      if(m[k]) return;
      m[k] = true;
      out.push(v);
    });
    return out;
  }

  function rebuildFilterOptions(){
    var citySel = $("filter-city");
    var spotSel = $("filter-spot");

    var cities = uniq(ALL.map(function(r){ return r.city; }))
      .sort(function(a,b){ return a.localeCompare(b); });

    setSelectOptions(citySel, cities, "All Cities");

    var base = ALL;
    var city = citySel.value || state.city;
    if(city) base = base.filter(function(r){ return r.city === city; });

    var spots = uniq(base.map(function(r){ return r.spot; }))
      .sort(function(a,b){ return a.localeCompare(b); });

    setSelectOptions(spotSel, spots, "All Spots");
  }

  function applyFilters(){
    var city = $("filter-city").value || "";
    var spot = $("filter-spot").value || "";
    var q = $("filter-search").value || "";

    state.city = city;
    state.spot = spot;
    state.q = q;

    FILTERED = ALL.filter(function(r){
      if(city && r.city !== city) return false;
      if(spot && r.spot !== spot) return false;

      if(q){
        var s = (r.city + " " + r.spot + " " + r.topUse + " " + r.topNot + " " + r.competitors).toLowerCase();
        if(s.indexOf(q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    // keep spot options aligned to selected city
    rebuildFilterOptions();

    renderAll();
  }

  function clearFilters(){
    $("filter-city").value = "";
    $("filter-spot").value = "";
    $("filter-search").value = "";
    state.city = state.spot = state.q = "";
    rebuildFilterOptions();
    applyFilters();
  }

  // --------------------------
  // Aggregations
  // --------------------------
  function sum(arr, fn){
    var t = 0;
    for(var i=0;i<arr.length;i++) t += (fn(arr[i])||0);
    return t;
  }

  function avg(arr, fn){
    var vals = [];
    for(var i=0;i<arr.length;i++){
      var v = fn(arr[i]);
      if(v === null || v === undefined) continue;
      if(!Number.isFinite(v)) continue;
      vals.push(v);
    }
    if(!vals.length) return null;
    return vals.reduce(function(a,b){ return a+b; },0) / vals.length;
  }

  function groupBy(arr, keyFn){
    var m = Object.create(null);
    arr.forEach(function(r){
      var k = keyFn(r);
      if(!k) k = "(Unknown)";
      if(!m[k]) m[k] = [];
      m[k].push(r);
    });
    return m;
  }

  // --------------------------
  // Charts helpers
  // --------------------------
  function destroyChart(c){
    try{ if(c) c.destroy(); }catch(e){}
  }

  function ensureGaugeDonut(canvasId, color){
    var ctx = document.getElementById(canvasId).getContext("2d");
    return new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Value","Remainder"],
        datasets: [{
          data: [0, 100],
          backgroundColor: [color, "#e6e6e6"],
          borderWidth: 0,
          hoverOffset: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: { legend: { display:false }, tooltip: { enabled:false } }
      }
    });
  }

  function setGauge(chart, pct){
    var v = Number(pct);
    if(!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(100, v));
    chart.data.datasets[0].data = [v, 100-v];
    chart.update();
  }

  function ensureBar(canvasId, title){
    var ctx = document.getElementById(canvasId).getContext("2d");
    return new Chart(ctx, {
      type: "bar",
      data: { labels: [], datasets: [{ label: title, data: [] }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display:false } },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true }
        }
      }
    });
  }

  // --------------------------
  // Render
  // --------------------------
  function setProgress(id, pct){
    var el = $(id);
    if(!el) return;
    var v = Number(pct);
    if(!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(100, v));
    el.style.width = v + "%";
  }

  function renderSnapshot(){
    var sessions = FILTERED.length;
    var farmers = sum(FILTERED, function(r){ return r.farmers; });
    var acres = sum(FILTERED, function(r){ return r.acres; });

    var cities = uniq(FILTERED.map(function(r){ return r.city; })).length;

    $("metric-sessions").textContent = formatInt(sessions);
    $("metric-farmers").textContent = formatInt(farmers);
    $("metric-acres").textContent = formatInt(acres);
    $("metric-cities").textContent = formatInt(cities);
  }

  function renderHero(){
    var sessions = ALL.length;
    var farmers = sum(ALL, function(r){ return r.farmers; });
    var days = uniq(ALL.map(function(r){ return r.date; })).filter(Boolean).length;

    $("hero-sessions").textContent = formatInt(sessions);
    $("hero-farmers").textContent = formatInt(farmers);
    $("metric-days").textContent = days ? formatInt(days) : "–";
  }

  function renderPerformance(){
    var a = avg(FILTERED, function(r){ return r.awareness; });
    var d = avg(FILTERED, function(r){ return r.definite; });
    var u = avg(FILTERED, function(r){ return r.understanding; });
    var inf = sum(FILTERED, function(r){ return r.influencers; });

    $("metric-awareness").textContent = a===null ? "–" : formatPct(a);
    $("metric-definite").textContent = d===null ? "–" : formatPct(d);
    $("metric-understanding").textContent = u===null ? "–" : formatPct(u);
    $("metric-influencers").textContent = formatInt(inf);

    setProgress("awareness-progress", a||0);
    setProgress("definite-progress", d||0);
    setProgress("understanding-progress", u||0);
    setProgress("influencers-progress", Math.min(100, FILTERED.length ? (inf / (FILTERED.length*5))*100 : 0));

    $("awareness-main").textContent = a===null ? "–" : formatPct(a);
    $("definite-main").textContent = d===null ? "–" : formatPct(d);

    if(charts.awarenessDonut) setGauge(charts.awarenessDonut, a||0);
    if(charts.definiteDonut) setGauge(charts.definiteDonut, d||0);

    // Adoption estimate
    var est = sum(FILTERED, function(r){
      var pct = (r.definite===null ? 0 : r.definite) / 100;
      return r.farmers * clamp01(pct);
    });
    $("adoption-text").textContent = "Estimated definite-use farmers: " + formatInt(est);
  }

  function renderDrillDonut(){
    var cityGroups = groupBy(FILTERED, function(r){ return r.city; });
    var cityLabels = Object.keys(cityGroups).sort(function(a,b){
      return cityGroups[b].length - cityGroups[a].length;
    });
    var cityCounts = cityLabels.map(function(c){ return cityGroups[c].length; });
    var cityColors = cityLabels.map(function(c){ return colorForKey(c); });

    // Spots depend on selected city if any (prefer state.city from dropdown)
    var base = FILTERED;
    var selectedCity = $("filter-city").value || "";
    if(selectedCity){
      base = base.filter(function(r){ return r.city === selectedCity; });
    }

    var spotGroups = groupBy(base, function(r){ return r.spot; });
    var spotLabels = Object.keys(spotGroups).sort(function(a,b){
      return spotGroups[b].length - spotGroups[a].length;
    }).slice(0, 12); // keep donut readable
    var spotCounts = spotLabels.map(function(s){ return spotGroups[s].length; });

    var baseColor = selectedCity ? colorForKey(selectedCity) : "#2e7d32";
    var spotColors = spotLabels.map(function(_,i){
      return lighten(baseColor, Math.min(0.7, 0.12 + i*0.05));
    });

    $("drill-main").textContent = formatInt(FILTERED.length);
    $("drill-sub").textContent = selectedCity ? ("Spots in " + selectedCity) : "Cities (outer) → Spots (inner)";

    if(!charts.drillDonut){
      var ctx = document.getElementById("drillDonut").getContext("2d");
      charts.drillDonut = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: [], // per-dataset
          datasets: [
            {
              label: "Spots",
              data: [],
              backgroundColor: [],
              borderWidth: 0,
              hoverOffset: 4
            },
            {
              label: "Cities",
              data: [],
              backgroundColor: [],
              borderWidth: 0,
              hoverOffset: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "45%",
          plugins: {
            legend: { position: "bottom" }
          },
          onClick: function(evt){
            var points = charts.drillDonut.getElementsAtEventForMode(evt, "nearest", { intersect:true }, true);
            if(!points || !points.length) return;
            var p = points[0];
            var ds = p.datasetIndex;
            var idx = p.index;

            if(ds === 1){
              // City ring (outer)
              var city = cityLabels[idx];
              $("filter-city").value = city;
              $("filter-spot").value = "";
              $("filter-search").value = $("filter-search").value || "";
              applyFilters();
            } else if(ds === 0){
              // Spot ring (inner)
              var spot = spotLabels[idx];
              $("filter-spot").value = spot;
              applyFilters();
            }
          }
        }
      });
    }

    charts.drillDonut.data.datasets[1].data = cityCounts;
    charts.drillDonut.data.datasets[1].backgroundColor = cityColors;
    charts.drillDonut.data.datasets[1].labels = cityLabels;

    charts.drillDonut.data.datasets[0].data = spotCounts;
    charts.drillDonut.data.datasets[0].backgroundColor = spotColors;
    charts.drillDonut.data.datasets[0].labels = spotLabels;

    // Chart.js legend uses overall labels; we keep it clean by setting labels to cities only.
    charts.drillDonut.data.labels = cityLabels;

    charts.drillDonut.update();
  }

  function renderPivots(){
    var g = groupBy(FILTERED, function(r){ return r.city; });
    var labels = Object.keys(g).sort(function(a,b){ return g[b].length - g[a].length; });

    // sessions
    var sessionsByCity = labels.map(function(c){ return g[c].length; });

    // farmers
    var farmersByCity = labels.map(function(c){
      return sum(g[c], function(r){ return r.farmers; });
    });

    // acres
    var acresByCity = labels.map(function(c){
      return sum(g[c], function(r){ return r.acres; });
    });

    // rates: show two datasets (awareness & definite) as grouped bar
    var awarenessByCity = labels.map(function(c){ return avg(g[c], function(r){ return r.awareness; }) || 0; });
    var definiteByCity = labels.map(function(c){ return avg(g[c], function(r){ return r.definite; }) || 0; });

    if(!charts.pivotSessionsByCity) charts.pivotSessionsByCity = ensureBar("pivotSessionsByCity", "Sessions by City");
    if(!charts.pivotFarmersByCity) charts.pivotFarmersByCity = ensureBar("pivotFarmersByCity", "Farmers by City");
    if(!charts.pivotAcresByCity) charts.pivotAcresByCity = ensureBar("pivotAcresByCity", "Acres by City");

    // Sessions by city
    charts.pivotSessionsByCity.data.labels = labels;
    charts.pivotSessionsByCity.data.datasets[0].data = sessionsByCity;
    charts.pivotSessionsByCity.data.datasets[0].backgroundColor = labels.map(colorForKey);
    charts.pivotSessionsByCity.update();

    // Farmers by city
    charts.pivotFarmersByCity.data.labels = labels;
    charts.pivotFarmersByCity.data.datasets[0].data = farmersByCity;
    charts.pivotFarmersByCity.data.datasets[0].backgroundColor = labels.map(colorForKey);
    charts.pivotFarmersByCity.update();

    // Acres by city
    charts.pivotAcresByCity.data.labels = labels;
    charts.pivotAcresByCity.data.datasets[0].data = acresByCity;
    charts.pivotAcresByCity.data.datasets[0].backgroundColor = labels.map(colorForKey);
    charts.pivotAcresByCity.update();

    // Rates grouped
    if(!charts.pivotRatesByCity){
      var ctx = document.getElementById("pivotRatesByCity").getContext("2d");
      charts.pivotRatesByCity = new Chart(ctx, {
        type: "bar",
        data: {
          labels: [],
          datasets: [
            { label: "Awareness %", data: [] },
            { label: "Definite %", data: [] }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero:true, max:100 } }
        }
      });
    }
    charts.pivotRatesByCity.data.labels = labels;
    charts.pivotRatesByCity.data.datasets[0].data = awarenessByCity;
    charts.pivotRatesByCity.data.datasets[1].data = definiteByCity;
    charts.pivotRatesByCity.update();

    // data quality
    var withCoords = FILTERED.filter(function(r){ return r.coords && Number.isFinite(r.coords.lat) && Number.isFinite(r.coords.lng); }).length;
    $("data-quality").textContent = "Data quality: " + formatInt(FILTERED.length) + " sessions parsed; " + formatInt(withCoords) + " have coordinates.";
  }

  // --------------------------
  // Map
  // --------------------------
  function initMap(){
    if(map) return;
    map = L.map("route-map", { scrollWheelZoom:false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
    map.setView([28.0, 69.5], 7);
  }

  function renderMap(){
    initMap();
    mapLayer.clearLayers();

    var pts = [];
    FILTERED.forEach(function(r){
      if(!r.coords) return;
      var lat = r.coords.lat, lng = r.coords.lng;
      if(!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      pts.push([lat,lng]);

      var popup = "<strong>" + (r.city||"") + "</strong><br/>" +
                  safeText(r.spot).replace(/</g,"&lt;") + "<br/>" +
                  "<span style='color:#666;font-weight:700'>" + safeText(r.date) + "</span><br/>" +
                  "Farmers: " + formatInt(r.farmers) + " &nbsp; Acres: " + formatInt(r.acres);

      L.circleMarker([lat,lng], {
        radius: 6,
        color: colorForKey(r.city),
        weight: 2,
        fillColor: colorForKey(r.city),
        fillOpacity: 0.85
      }).bindPopup(popup).addTo(mapLayer);
    });

    if(pts.length >= 2){
      L.polyline(pts, { color:"#1b5e20", weight:3, opacity:0.7 }).addTo(mapLayer);
      try{
        map.fitBounds(pts, { padding:[18,18] });
      }catch(e){}
    } else if(pts.length === 1){
      map.setView(pts[0], 11);
    }
  }

  // --------------------------
  // Media gallery
  // --------------------------
  function groupIdFromSrc(src){
    var name = safeText(src).split("/").pop() || "";
    name = name.split("?")[0];
    var base = name.replace(/\.[^.]+$/,""); // remove extension
    var m = base.match(/^(\d+)/);
    return m ? m[1] : "misc";
  }

  function safeFetchJson(url){
    return fetch(url).then(function(res){
      if(!res.ok) throw new Error("Not found: " + url);
      return res.json();
    });
  }

  function buildMediaTile(item){
    var tile = document.createElement("div");
    tile.className = "tile";

    var thumb = document.createElement("div");
    thumb.className = "thumb";

    var badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = item.type === "video" ? "VIDEO" : "PHOTO";

    if(item.type === "video"){
      var img = document.createElement("img");
      img.alt = safeText(item.alt) || "Video";
      img.src = "Buctril.jpg"; // placeholder thumb
      thumb.appendChild(img);

      var vid = document.createElement("video");
      vid.src = item.src;
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.preload = "metadata";
      thumb.appendChild(vid);
    } else {
      var im = document.createElement("img");
      im.alt = safeText(item.alt) || "Image";
      im.src = item.src;
      thumb.appendChild(im);
    }

    thumb.appendChild(badge);

    var cap = document.createElement("div");
    cap.className = "cap";
    cap.innerHTML = '<div class="t">' + (safeText(item.caption)||"") + '</div>' +
                    '<div class="s">' + (safeText(item.transcript)||"") + '</div>';

    tile.appendChild(thumb);
    tile.appendChild(cap);

    tile.addEventListener("click", function(){
      openLightbox(item);
    });

    return tile;
  }

  function openLightbox(item){
    var lb = $("lightbox");
    var img = $("lb-img");
    var vid = $("lb-video");
    lb.classList.add("active");

    img.style.display = "none";
    vid.style.display = "none";

    if(item.type === "video"){
      vid.src = item.src;
      vid.style.display = "block";
      vid.play().catch(function(){});
    } else {
      img.src = item.src;
      img.style.display = "block";
    }
  }

  function closeLightbox(){
    var lb = $("lightbox");
    var vid = $("lb-video");
    lb.classList.remove("active");
    try{ vid.pause(); }catch(e){}
    vid.removeAttribute("src");
    vid.load();
  }

  function renderMedia(){
    var container = $("media-gallery");
    if(!container) return;
    container.innerHTML = "";

    var url = baseUrl() + "media.json";
    safeFetchJson(url).then(function(items){
      if(!Array.isArray(items) || !items.length){
        container.innerHTML = '<div class="muted" style="font-weight:900">No media items found in media.json.</div>';
        return;
      }

      // Fix common extension issue: if src endswith .jpeg but actual is .jpg, replace.
      items.forEach(function(it){
        if(it && typeof it.src === "string"){
          it.src = it.src.replace(/\.jpeg(\?|$)/i, ".jpg$1");
        }
      });

      var groups = groupBy(items, function(it){ return groupIdFromSrc(it.src); });
      var keys = Object.keys(groups).sort(function(a,b){
        var na = Number(a), nb = Number(b);
        if(Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.localeCompare(b);
      });

      keys.forEach(function(k){
        var block = document.createElement("div");
        block.className = "sessionBlock";
        block.style.marginBottom = "12px";

        var head = document.createElement("div");
        head.className = "sessionHead";
        head.innerHTML = '<div><strong>Media Group ' + k + '</strong></div>' +
                         '<div class="sessionMeta">' + groups[k].length + ' items</div>';

        var reel = document.createElement("div");
        reel.className = "reel";
        groups[k].forEach(function(item){
          reel.appendChild(buildMediaTile(item));
        });

        block.appendChild(head);
        block.appendChild(reel);
        container.appendChild(block);
      });
    }).catch(function(){
      container.innerHTML = '<div class="muted" style="font-weight:900">media.json not found (or invalid JSON). Place it in repo root.</div>';
    });
  }

  // --------------------------
  // Logos + background video resilience
  // --------------------------
  function tryAltFilenames(imgEl, candidates){
    var i = 0;
    function next(){
      if(i >= candidates.length) return;
      imgEl.src = candidates[i++];
    }
    imgEl.onerror = next;
    next();
  }

  function fixHeaderAssets(){
    tryAltFilenames($("logoBayer"), ["Bayer.jpg", "bayer.jpg", "BAYER.jpg"]);
    tryAltFilenames($("logoBuctril"), ["Buctril.jpg", "buctril.jpg", "BUCTRIL.jpg"]);
    tryAltFilenames($("logoInteract"), ["Interact.gif", "interact.gif", "INTERACT.gif"]);

    var v = $("bgVideo");
    if(!v) return;
    // Show the video only if it loads.
    v.onloadeddata = function(){ v.style.display = "block"; };
    v.onerror = function(){
      // Hide if missing.
      v.style.display = "none";
    };
  }

  // --------------------------
  // Render orchestration
  // --------------------------
  function renderAll(){
    renderSnapshot();
    renderPerformance();
    renderDrillDonut();
    renderPivots();
    renderMap();
  }

  function initCharts(){
    destroyChart(charts.awarenessDonut);
    destroyChart(charts.definiteDonut);

    charts.awarenessDonut = ensureGaugeDonut("awarenessDonut", "#2e7d32");
    charts.definiteDonut = ensureGaugeDonut("definiteDonut", "#ff7043");
  }

  function initUI(){
    fixHeaderAssets();

    $("filter-city").addEventListener("change", function(){
      // reset spot when city changes
      $("filter-spot").value = "";
      applyFilters();
    });
    $("filter-spot").addEventListener("change", applyFilters);
    $("filter-search").addEventListener("input", function(){
      // debounce-ish
      window.clearTimeout(initUI._t);
      initUI._t = window.setTimeout(applyFilters, 150);
    });
    $("btn-clear").addEventListener("click", clearFilters);

    $("lb-close").addEventListener("click", closeLightbox);
    $("lightbox").addEventListener("click", function(e){
      if(e.target && e.target.id === "lightbox") closeLightbox();
    });
    document.addEventListener("keydown", function(e){
      if(e.key === "Escape") closeLightbox();
    });

    initCharts();
    rebuildFilterOptions();
    applyFilters();
    renderMedia();
  }

  // --------------------------
  // Boot
  // --------------------------
  function boot(){
    setDiagnostics("", false);

    fetchXlsx().then(function(rows){
      ALL = rows;
      FILTERED = rows.slice();
      renderHero();

      $("loading").style.display = "none";
      initUI();
    }).catch(function(err){
      $("loading").style.display = "none";
      showError("Error loading XLSX data: " + safeText(err && err.message ? err.message : err));
      setDiagnostics(
        "Could not load <code>Buctril_Super_Activations.xlsx</code> or parse the <code>SUM</code> sheet. " +
        "Confirm the XLSX is in repo root and the GitHub Pages URL ends with a trailing slash.",
        true
      );
    });
  }

  boot();
})();
