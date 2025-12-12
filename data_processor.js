/****************************************************
 * Buctril Super Dashboard – Drilldown Donut (Cities outer ring, Spots inner ring)
 *
 * This build FIXES your current CSV schema:
 * Your file has columns like:
 * - Total Farmers
 * - Estimated Buctril Acres from this Session
 * - Definite Use Rate
 * - Awareness Rate
 * - Average Understanding Score
 * - Coorrdinates / Spot Coordinates (lat,lng as text)
 *
 * Files expected in SAME folder:
 * - index.html
 * - data_processor.js
 * - sum_sheet.csv   (or Sum_Sheet.csv / SUM_SHEET.csv)
 *
 * Media:
 * - Per session: 1.jpg/1.jpeg + 1.mp4
 * - Or multi-media per session: 1a…1f (jpg/jpeg/mp4)
 ****************************************************/

function safeText(v){ return (v===null||v===undefined) ? "" : String(v).trim(); }
function safeNumber(val){
  if(val===null||val===undefined||val==="") return 0;
  var str = String(val).replace(/,/g,"").trim();
  var m = str.match(/-?\d+(?:\.\d+)?/);
  if(!m) return 0;
  var n = parseFloat(m[0]);
  return isNaN(n) ? 0 : n;
}
function formatInt(n){ try{return Math.round(n).toLocaleString("en-US");}catch(e){return String(n);} }
function setText(id, v){ var el=document.getElementById(id); if(el) el.textContent=v; }

function showErrorModal(msg){
  var existing=document.querySelector(".error-modal"); if(existing) existing.remove();
  var modal=document.createElement("div"); modal.className="error-modal";
  modal.innerHTML="<p>"+msg+"</p><button type='button'>Close</button>";
  document.body.appendChild(modal);
  modal.querySelector("button").addEventListener("click", function(){ modal.remove(); });
}

function showDiagnostics(html){
  var el=document.getElementById("diagnostics");
  if(!el) return;
  el.innerHTML=html;
  el.style.display="block";
}
function hideDiagnostics(){
  var el=document.getElementById("diagnostics");
  if(!el) return;
  el.style.display="none";
  el.innerHTML="";
}

function normalizeHeader(h){
  return safeText(h)
    .replace(/^\ufeff/,"")
    .replace(/\u00a0/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function getField(row, candidates){
  // Exact match first
  for(var i=0;i<candidates.length;i++){
    var k=candidates[i];
    if(row.hasOwnProperty(k) && safeText(row[k])!=="") return row[k];
  }
  // Case-insensitive exact match
  var keys=Object.keys(row);
  for(var j=0;j<candidates.length;j++){
    var want=candidates[j].toLowerCase();
    for(var t=0;t<keys.length;t++){
      if(keys[t].toLowerCase()===want && safeText(row[keys[t]])!=="") return row[keys[t]];
    }
  }
  return "";
}

function normName(s){ return safeText(s).replace(/\s+/g," ").trim(); }
function clampPct(x){ return Math.max(0, Math.min(100, x)); }
function starsFromPct(p){
  var s = Math.max(0, Math.min(5, Math.round(p/20)));
  return "★".repeat(s) + "☆".repeat(5-s);
}

// Parse "lat,lng" (or "lat lng") inside a single column like "Coorrdinates" or "Spot Coordinates"
function parseLatLon(maybe){
  var s=safeText(maybe);
  if(!s) return {lat:0, lon:0};
  // Replace common separators
  s=s.replace(/[;]/g,",").replace(/\s+/g," ").trim();
  // Try comma-separated first
  var parts=s.split(",");
  if(parts.length>=2){
    var a=safeNumber(parts[0]);
    var b=safeNumber(parts[1]);
    if(Math.abs(a)<=90 && Math.abs(b)<=180) return {lat:a, lon:b};
  }
  // Try space-separated pair
  var m=s.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if(m){
    var lat=parseFloat(m[1]), lon=parseFloat(m[2]);
    if(!isNaN(lat) && !isNaN(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180) return {lat:lat, lon:lon};
  }
  return {lat:0, lon:0};
}

// Stable city colors
function cityHue(city){
  var c=normName(city).toLowerCase();
  var h=0;
  for(var i=0;i<c.length;i++){ h=(h*31 + c.charCodeAt(i)) % 360; }
  return h;
}
function cityColor(city){ return "hsl(" + cityHue(city) + ", 70%, 55%)"; }
function spotColor(city, idx){
  var h=cityHue(city);
  var l=72 - (idx%6)*6;
  return "hsl(" + h + ", 70%, " + l + "%)";
}

var allRows=[], filteredRows=[];
var map=null, mapMarkers=[];
var clarityDonut=null, definiteDonut=null, drillDonut=null;
var MEDIA_LETTERS=["a","b","c","d","e","f"];

var CSV_CANDIDATES=["sum_sheet.csv","Sum_Sheet.csv","SUM_SHEET.csv"];

function fetchFirstAvailableCSV(){
  var i=0;
  function tryNext(){
    if(i>=CSV_CANDIDATES.length){
      throw new Error("CSV not found. Tried: " + CSV_CANDIDATES.join(", "));
    }
    var name=CSV_CANDIDATES[i++];
    return fetch(name + "?cache=" + Date.now()).then(function(res){
      if(res.ok) return res.text();
      return tryNext();
    });
  }
  return tryNext();
}

function isExcludedRow(r){
  var c=(r.city||"").trim().toLowerCase();
  if(c==="multan") return true; // per your instruction
  if(!r.city && !r.spot && !r.date) return true;
  return false;
}

function normalizeRow(row, idx){
  var sid=safeText(getField(row, ["SN","Sr No","Sr. No","Session ID","SessionID","ID","Id","S#","S.No","S No"]));
  var id = sid!=="" ? safeNumber(sid) : (idx+1);

  // Your CSV has: Tehsil / District, Village / Mauza, Spot Coordinates, Coorrdinates (typo)
  var rgn = safeText(getField(row, ["RGN","Region","REGION","Rgn","Tehsil / District","Tehsil/District","District"]));
  var city = normName(getField(row, ["City","To City","To","District/City","Tehsil / District"]));
  var from = normName(getField(row, ["From City","From","Starting City","Start City"]));
  var spot = normName(getField(row, ["Village / Mauza","Village/Mauza","Session Location","Spot","Location","Venue","Mauza","Village"]));
  var date = safeText(getField(row, ["Activity Date","Date","Session Date","Day"]));

  // Key metrics (YOUR schema)
  var farmers = safeNumber(getField(row, [
    "Total Farmers","Total Wheat Farmers","Farmers","No of Farmer Participate","No of Farmers","Participants"
  ]));

  var acres = safeNumber(getField(row, [
    "Estimated Buctril Acres from this Session",
    "Estimated Buctril Acres",
    "Total Wheat Acres",
    "Acres",
    "Acres Covered"
  ]));

  // Performance metrics (YOUR schema)
  var clarity = safeNumber(getField(row, [
    "Average Understanding Score",
    "Message Clarity %",
    "Message Clarity",
    "Clarity %"
  ]));

  var definite = safeNumber(getField(row, [
    "Definite Use Rate",
    "Definite Use %",
    "Definite Use"
  ]));

  // Fallback: if definite not present, compute from plan counts
  if(definite===0 && farmers>0){
    var yesCount = safeNumber(getField(row, ["Plan Yes Count","Will Definitely Use","Yes Count"]));
    if(yesCount>0) definite = (yesCount / farmers) * 100;
  }

  var influencers = safeNumber(getField(row, [
    "No. of Key Influencers (Names Highlighted)",
    "No of Key Influencers (Names Highlighted)",
    "No. of Key Influencers",
    "Influencers",
    "Influencers Identified"
  ]));

  var awareness = safeNumber(getField(row, [
    "Awareness Rate",
    "Awareness %",
    "Awareness"
  ]));

  // Coordinates: either separate lat/lon or combined string
  var lat = safeNumber(getField(row, ["Latitude","Lat"]));
  var lon = safeNumber(getField(row, ["Longitude","Lng","Long","Lon"]));
  if((!lat || !lon) || (lat===0 && lon===0)){
    var combined = getField(row, ["Coorrdinates","Coordinates","Spot Coordinates"]);
    var p = parseLatLon(combined);
    lat = lat || p.lat;
    lon = lon || p.lon;
  }

  // Normalize clarity if it looks like 0-5 or 0-10 scale
  // (If your score is already 0-100, it remains unchanged.)
  if(clarity>0 && clarity<=10){
    clarity = clarity*10; // interpret as 0-10 → 0-100
  } else if(clarity>0 && clarity<=5){
    clarity = clarity*20; // interpret as 0-5 → 0-100
  }

  return {
    __raw: row,
    id:id, rgn:rgn, city:city, from:from, spot:spot, date:date,
    __farmers:farmers, __acres:acres,
    __messageClarity:clarity, __definiteUseRate:definite, __influencers:influencers, __awarenessRate:awareness,
    latitude:lat, longitude:lon
  };
}

function loadCSV(){
  var loading=document.getElementById("loading");

  fetchFirstAvailableCSV()
    .then(function(text){
      var lines=text.split(/\r?\n/);
      if(lines.length && /^summary\b/i.test(lines[0].trim())){
        lines.shift(); text=lines.join("\n");
      }
      if(typeof Papa==="undefined") throw new Error("PapaParse not loaded (Papa is undefined).");

      var parsed=Papa.parse(text, {
        header:true,
        dynamicTyping:false,
        skipEmptyLines:true,
        transformHeader: function(h){ return normalizeHeader(h); }
      });

      var fields=(parsed.meta && parsed.meta.fields) ? parsed.meta.fields : [];

      allRows=(parsed.data||[])
        .map(function(row, idx){ return normalizeRow(row, idx); })
        .filter(function(r){ return r && !isExcludedRow(r); });

      var hasAny = allRows.length>0;
      var farmersSum = allRows.reduce(function(s,r){return s+(r.__farmers||0);},0);
      var acresSum = allRows.reduce(function(s,r){return s+(r.__acres||0);},0);

      if(!hasAny){
        showDiagnostics("CSV loaded but no usable rows were found after filtering. Detected headers:<br><code>"+(fields||[]).join("</code>, <code>")+"</code>");
      } else if(farmersSum===0 && acresSum===0){
        showDiagnostics(
          "Data loaded, but key columns were not recognized (Farmers/Acres). Detected headers:<br><code>" +
          (fields||[]).join("</code>, <code>") + "</code><br>" +
          "Fix: confirm your CSV has numeric values in <code>Total Farmers</code> and <code>Estimated Buctril Acres from this Session</code> (or tell me which columns to use)."
        );
      } else {
        hideDiagnostics();
      }

      initCharts();
      initFilters();
      applyFilters();
      if(loading) loading.remove();
    })
    .catch(function(err){
      console.error(err);
      showErrorModal("Error loading data: " + err.message);
      if(loading) loading.remove();
    });
}

// ---------------- Filters ----------------
function initFilters(){
  var rgnSel=document.getElementById("filter-rgn");
  var citySel=document.getElementById("filter-city");
  var spotSel=document.getElementById("filter-spot");
  var search=document.getElementById("filter-search");
  var clearBtn=document.getElementById("btn-clear");

  rebuildRegionOptions();
  rebuildCityOptions();
  rebuildSpotOptions();

  rgnSel.addEventListener("change", function(){
    rebuildCityOptions(); rebuildSpotOptions(); applyFilters();
  });
  citySel.addEventListener("change", function(){
    rebuildSpotOptions(); applyFilters();
  });
  spotSel.addEventListener("change", applyFilters);
  search.addEventListener("input", applyFilters);

  clearBtn.addEventListener("click", function(){
    rgnSel.value=""; citySel.value=""; spotSel.value=""; search.value="";
    rebuildCityOptions(); rebuildSpotOptions(); applyFilters();
  });
}

function rebuildRegionOptions(){
  var rgnSel=document.getElementById("filter-rgn");
  var cur=rgnSel.value||"";
  rgnSel.innerHTML="<option value=''>All Regions</option>";
  var set=new Set();
  allRows.forEach(function(r){ if(r.rgn) set.add(r.rgn); });
  Array.from(set).sort().forEach(function(v){
    var o=document.createElement("option"); o.value=v; o.textContent=v; rgnSel.appendChild(o);
  });
  if(cur) rgnSel.value=cur;
}
function rebuildCityOptions(){
  var rgnSel=document.getElementById("filter-rgn");
  var citySel=document.getElementById("filter-city");
  var region=rgnSel.value||"";
  var cur=citySel.value||"";
  citySel.innerHTML="<option value=''>All Cities</option>";
  var set=new Set();
  allRows.forEach(function(r){
    if(region && r.rgn!==region) return;
    if(!r.city) return;
    set.add(r.city);
  });
  Array.from(set).sort().forEach(function(c){
    var o=document.createElement("option"); o.value=c; o.textContent=c; citySel.appendChild(o);
  });
  if(cur && set.has(cur)) citySel.value=cur; else citySel.value="";
}
function rebuildSpotOptions(){
  var rgnSel=document.getElementById("filter-rgn");
  var citySel=document.getElementById("filter-city");
  var spotSel=document.getElementById("filter-spot");
  var region=rgnSel.value||"";
  var city=citySel.value||"";
  var cur=spotSel.value||"";
  spotSel.innerHTML="<option value=''>All Spots</option>";
  var set=new Set();
  allRows.forEach(function(r){
    if(region && r.rgn!==region) return;
    if(city && r.city!==city) return;
    if(r.spot) set.add(r.spot);
  });
  Array.from(set).sort().forEach(function(s){
    var o=document.createElement("option"); o.value=s; o.textContent=s; spotSel.appendChild(o);
  });
  if(cur && set.has(cur)) spotSel.value=cur; else spotSel.value="";
}

function applyFilters(){
  var rgnVal=safeText(document.getElementById("filter-rgn").value);
  var cityVal=safeText(document.getElementById("filter-city").value);
  var spotVal=safeText(document.getElementById("filter-spot").value);
  var q=safeText(document.getElementById("filter-search").value).toLowerCase();

  filteredRows=allRows.filter(function(r){
    if(rgnVal && r.rgn!==rgnVal) return false;
    if(cityVal && r.city!==cityVal) return false;
    if(spotVal && r.spot!==spotVal) return false;
    if(q){
      var hay=(safeText(r.rgn)+" "+safeText(r.city)+" "+safeText(r.spot)+" "+safeText(r.from)).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  updateMetrics(filteredRows);
  updateDonuts(filteredRows);
  updateDrillDonut();
  updateSessionTable(filteredRows);
  updateMap(filteredRows);
  updateMedia(filteredRows);
}

// ---------------- Metrics/Donuts ----------------
function updateMetrics(rows){
  var sessions=rows.length;
  var farmers=rows.reduce(function(s,r){return s+(r.__farmers||0);},0);
  var acres=rows.reduce(function(s,r){return s+(r.__acres||0);},0);
  var cities=new Set(rows.map(function(r){return r.city;}).filter(Boolean)).size;
  var days=new Set(rows.map(function(r){return r.date;}).filter(Boolean)).size;

  setText("metric-sessions", formatInt(sessions));
  setText("metric-farmers", formatInt(farmers));
  setText("metric-acres", formatInt(acres));
  setText("metric-cities", formatInt(cities));
  setText("metric-days", formatInt(days));
  setText("hero-farmers", formatInt(farmers));
  setText("hero-sessions", formatInt(sessions));

  var avgCl=0, avgDef=0, avgAw=0, infl=0, defFarmers=0;
  if(rows.length){
    avgCl = rows.reduce(function(s,r){return s+(r.__messageClarity||0);},0)/rows.length;
    avgDef = rows.reduce(function(s,r){return s+(r.__definiteUseRate||0);},0)/rows.length;
    avgAw = rows.reduce(function(s,r){return s+(r.__awarenessRate||0);},0)/rows.length;
    infl  = rows.reduce(function(s,r){return s+(r.__influencers||0);},0);
    defFarmers = rows.reduce(function(s,r){
      return s + Math.round((r.__farmers||0)*(r.__definiteUseRate||0)/100);
    },0);
  }

  avgCl=clampPct(avgCl); avgDef=clampPct(avgDef); avgAw=clampPct(avgAw);

  setText("metric-clarity", Math.round(avgCl)+"%");
  setText("metric-definite", Math.round(avgDef)+"%");
  setText("metric-influencers", formatInt(infl));
  setText("metric-awareness", Math.round(avgAw)+"%");

  var b1=document.getElementById("clarity-progress");
  var b2=document.getElementById("definite-progress");
  var b3=document.getElementById("influencers-progress");
  var b4=document.getElementById("awareness-progress");
  if(b1) b1.style.width=Math.round(avgCl)+"%";
  if(b2) b2.style.width=Math.round(avgDef)+"%";
  if(b4) b4.style.width=Math.round(avgAw)+"%";

  var maxInfl=allRows.reduce(function(m,r){ return Math.max(m, r.__influencers||0); },0) || 1;
  var scaled = Math.min(100, Math.round((infl / (maxInfl * Math.max(1, rows.length/3))) * 100));
  if(b3) b3.style.width=scaled+"%";

  var st=document.getElementById("clarity-stars");
  if(st) st.textContent=starsFromPct(avgCl);

  var at=document.getElementById("adoption-text");
  if(at){
    var pct = farmers>0 ? Math.round((defFarmers/farmers)*100) : Math.round(avgDef);
    at.textContent="Estimated definite-use farmers: " + formatInt(defFarmers) + " ("+pct+"%)";
  }
}

function initCharts(){
  var c1=document.getElementById("clarityDonut");
  var c2=document.getElementById("definiteDonut");
  var c3=document.getElementById("drillDonut");
  if(!c1||!c2||!c3) return;

  clarityDonut=new Chart(c1, {
    type:"doughnut",
    data:{labels:["Clarity","Remaining"],datasets:[{data:[0,100],backgroundColor:["#66bb6a","#e0e0e0"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"80%",plugins:{legend:{display:false}}}
  });

  definiteDonut=new Chart(c2, {
    type:"doughnut",
    data:{labels:["Definite","Remaining"],datasets:[{data:[0,100],backgroundColor:["#ff7043","#e0e0e0"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"80%",plugins:{legend:{display:false}}}
  });

  drillDonut=new Chart(c3, {
    type:"doughnut",
    data:{
      labels:[],
      datasets:[
        {label:"Cities", data:[], backgroundColor:[], borderWidth:0, radius:"100%", cutout:"70%"},
        {label:"Spots", data:[], backgroundColor:[], borderWidth:0, radius:"68%", cutout:"40%"}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            title:function(items){ return items && items.length ? items[0].dataset.label : ""; },
            label:function(ctx){ return (ctx.label||"") + ": " + formatInt(ctx.parsed||0) + " farmers"; }
          }
        }
      },
      onClick:function(evt, elements){
        if(!elements || !elements.length) return;
        var el=elements[0];
        var dsIndex=el.datasetIndex;
        var idx=el.index;

        if(dsIndex===0){
          var city = drillDonut.data.datasets[0]._keys[idx];
          if(city){
            var citySel=document.getElementById("filter-city");
            citySel.value=city;
            rebuildSpotOptions();
            applyFilters();
          }
        } else if(dsIndex===1){
          var spot = drillDonut.data.datasets[1]._keys[idx];
          if(spot){
            var spotSel=document.getElementById("filter-spot");
            spotSel.value=spot;
            applyFilters();
            setTimeout(function(){
              var target=document.querySelector("[data-session-block='true']");
              if(target) target.scrollIntoView({behavior:"smooth", block:"start"});
            }, 100);
          }
        }
      }
    }
  });
}

function updateDonuts(rows){
  if(!clarityDonut || !definiteDonut) return;
  var avgCl=0, avgDef=0;
  if(rows.length){
    avgCl=rows.reduce(function(s,r){return s+(r.__messageClarity||0);},0)/rows.length;
    avgDef=rows.reduce(function(s,r){return s+(r.__definiteUseRate||0);},0)/rows.length;
  }
  avgCl=clampPct(avgCl); avgDef=clampPct(avgDef);

  clarityDonut.data.datasets[0].data=[avgCl, 100-avgCl];
  definiteDonut.data.datasets[0].data=[avgDef, 100-avgDef];
  clarityDonut.update();
  definiteDonut.update();

  setText("clarity-main", Math.round(avgCl)+"%");
  setText("definite-main", Math.round(avgDef)+"%");
}

function summaryByCity(rows){
  var m={};
  rows.forEach(function(r){
    if(!r.city) return;
    if(!m[r.city]) m[r.city]={key:r.city, farmers:0};
    m[r.city].farmers += (r.__farmers||0);
  });
  var arr=Object.values(m);
  arr.sort(function(a,b){return b.farmers-a.farmers;});
  return arr;
}
function summaryBySpot(rows){
  var m={};
  rows.forEach(function(r){
    var k=r.spot||"Unknown";
    if(!m[k]) m[k]={key:k, farmers:0};
    m[k].farmers += (r.__farmers||0);
  });
  var arr=Object.values(m);
  arr.sort(function(a,b){return b.farmers-a.farmers;});
  return arr;
}

function updateDrillDonut(){
  if(!drillDonut) return;

  var rgnVal=safeText(document.getElementById("filter-rgn").value);
  var cityVal=safeText(document.getElementById("filter-city").value);
  var q=safeText(document.getElementById("filter-search").value).toLowerCase();

  var base = allRows.filter(function(r){
    if(rgnVal && r.rgn!==rgnVal) return false;
    if(q){
      var hay=(safeText(r.rgn)+" "+safeText(r.city)+" "+safeText(r.spot)+" "+safeText(r.from)).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  var cities = summaryByCity(base).slice(0, 12);
  var cityLabels = cities.map(function(x){return x.key;});
  var cityData = cities.map(function(x){return Math.round(x.farmers);});
  var cityColors = cityLabels.map(cityColor);

  var innerBase = base;
  var innerTitle = "Top spots (overall)";
  if(cityVal){
    innerBase = base.filter(function(r){ return r.city===cityVal; });
    innerTitle = "Spots in " + cityVal;
  }

  var spots = summaryBySpot(innerBase).slice(0, 10);
  var spotLabels = spots.map(function(x){return x.key;});
  var spotData = spots.map(function(x){return Math.round(x.farmers);});
  var spotColors = spotLabels.map(function(_,i){
    return cityVal ? spotColor(cityVal, i) : "hsl(" + (i*36 % 360) + ", 70%, 65%)";
  });

  drillDonut.data.labels = cityLabels.concat(spotLabels);

  drillDonut.data.datasets[0].data = cityData;
  drillDonut.data.datasets[0].backgroundColor = cityColors;
  drillDonut.data.datasets[0]._keys = cityLabels.slice();

  drillDonut.data.datasets[1].data = spotData;
  drillDonut.data.datasets[1].backgroundColor = spotColors;
  drillDonut.data.datasets[1]._keys = spotLabels.slice();

  drillDonut.update();

  var farmers=filteredRows.reduce(function(s,r){return s+(r.__farmers||0);},0);
  setText("drill-main", farmers ? formatInt(farmers) : "–");
  var sub=document.getElementById("drill-sub");
  if(sub) sub.textContent = "Cities (outer) → " + innerTitle + " (inner)";
}

// ---------------- Table ----------------
function updateSessionTable(rows){
  var tbody=document.getElementById("session-table-body");
  if(!tbody) return;
  tbody.innerHTML="";
  rows.forEach(function(r){
    var tr=document.createElement("tr");
    function td(v){ var x=document.createElement("td"); x.textContent=v; return x; }
    tr.appendChild(td(String(r.id)));
    tr.appendChild(td(r.date||""));
    tr.appendChild(td(r.rgn||""));
    tr.appendChild(td(r.city||""));
    tr.appendChild(td(r.spot||""));
    tr.appendChild(td(formatInt(r.__farmers||0)));
    tr.appendChild(td(formatInt(r.__acres||0)));
    tbody.appendChild(tr);
  });
}

// ---------------- Map ----------------
function ensureMap(){
  var el=document.getElementById("route-map");
  if(!el) return;
  if(!map){
    map=L.map("route-map").setView([30.3753, 69.3451], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
  }
}
function updateMap(rows){
  ensureMap();
  if(!map) return;

  mapMarkers.forEach(function(m){ try{ map.removeLayer(m);}catch(e){} });
  mapMarkers=[];

  var bounds=[];
  rows.forEach(function(r){
    if(!r.latitude || !r.longitude) return;
    if(r.latitude===0 || r.longitude===0) return;
    var coords=[r.latitude, r.longitude];
    bounds.push(coords);

    var html="<strong>"+(r.spot||r.city||"Session")+"</strong><br/>"+
      "RGN: "+(r.rgn||"—")+"<br/>"+
      "City: "+(r.city||"—")+"<br/>"+
      "Date: "+(r.date||"—")+"<br/>"+
      "Farmers: "+formatInt(r.__farmers||0)+"<br/>"+
      "Acres: "+formatInt(r.__acres||0);

    var mk=L.marker(coords).addTo(map).bindPopup(html);
    mapMarkers.push(mk);
  });

  if(bounds.length){
    map.fitBounds(L.latLngBounds(bounds), {padding:[22,22]});
  }
}

// ---------------- Media ----------------
function mediaCandidatesForSession(sessionId){
  var id=String(sessionId);
  var candidates=[ {key:id, img:[id+".jpg", id+".jpeg"], vid:id+".mp4"} ];
  MEDIA_LETTERS.forEach(function(letter){
    var k=id+letter;
    candidates.push({key:k, img:[k+".jpg", k+".jpeg"], vid:k+".mp4"});
  });
  return candidates;
}

function updateMedia(rows){
  var wrap=document.getElementById("media-gallery");
  if(!wrap) return;
  wrap.innerHTML="";

  if(!rows.length){
    var empty=document.createElement("div");
    empty.className="muted";
    empty.style.fontWeight="1000";
    empty.textContent="No sessions match your filters.";
    wrap.appendChild(empty);
    return;
  }

  rows.forEach(function(r){
    var block=document.createElement("div");
    block.className="sessionBlock";
    block.setAttribute("data-session-block","true");

    var head=document.createElement("div");
    head.className="sessionHead";
    head.innerHTML =
      "<div><strong>Session "+r.id+"</strong> — "+(r.city||"")+(r.spot?(" • "+r.spot):"")+"</div>"+
      "<div class='sessionMeta'>"+(r.date||"")+
      " • Farmers "+formatInt(r.__farmers||0)+
      " • Acres "+formatInt(r.__acres||0)+
      "</div>";
    block.appendChild(head);

    var reel=document.createElement("div");
    reel.className="reel";

    var cand=mediaCandidatesForSession(r.id);

    cand.forEach(function(c){
      var tile=document.createElement("div");
      tile.className="tile";
      tile.dataset.noimg="0";
      tile.dataset.novid="0";

      var thumb=document.createElement("div");
      thumb.className="thumb";

      var img=document.createElement("img");
      img.alt="Session "+r.id+" "+c.key;
      img.src=c.img[0];
      img.onerror=function(){
        if(img.src.endsWith(".jpg") && c.img[1]){
          img.src=c.img[1]; return;
        }
        tile.dataset.noimg="1"; maybeRemove();
      };

      var vid=document.createElement("video");
      vid.muted=true; vid.loop=true; vid.playsInline=true; vid.preload="none";
      vid.src=c.vid;
      vid.addEventListener("error", function(){ tile.dataset.novid="1"; maybeRemove(); });

      tile.addEventListener("mouseenter", function(){ try{ vid.play(); }catch(e){} });
      tile.addEventListener("mouseleave", function(){ try{ vid.pause(); }catch(e){} });

      var badge=document.createElement("div");
      badge.className="badge";
      badge.innerHTML="<i class='fas fa-play'></i>";

      thumb.appendChild(img);
      thumb.appendChild(vid);
      thumb.appendChild(badge);

      var cap=document.createElement("div");
      cap.className="cap";
      cap.innerHTML="<div class='t'>"+c.key+"</div><div class='s'>"+(r.city||"")+"</div>";

      tile.appendChild(thumb);
      tile.appendChild(cap);

      tile.addEventListener("click", function(){ openLightbox(img, vid); });

      function maybeRemove(){
        if(tile.dataset.noimg==="1" && tile.dataset.novid==="1"){
          tile.remove();
        }
      }

      reel.appendChild(tile);
    });

    setTimeout(function(){
      if(!reel.children.length){
        var note=document.createElement("div");
        note.className="muted";
        note.style.fontWeight="1000";
        note.textContent="No media found for this session (upload "+r.id+".jpg or "+r.id+"a.jpg etc.).";
        block.appendChild(note);
      }
    }, 600);

    block.appendChild(reel);
    wrap.appendChild(block);
  });
}

// ---------------- Lightbox ----------------
function openLightbox(imgEl, vidEl){
  var lb=document.getElementById("lightbox");
  var lbImg=document.getElementById("lb-img");
  var lbVid=document.getElementById("lb-video");
  if(!lb||!lbImg||!lbVid) return;

  lb.classList.add("active");
  lbImg.style.display="none";
  lbVid.style.display="none";

  var imgSrc=safeText(imgEl && imgEl.src);
  var vidSrc=safeText(vidEl && vidEl.src);

  lbVid.pause();
  lbVid.removeAttribute("src");
  lbVid.load();

  if(vidSrc){
    lbVid.src=vidSrc;
    lbVid.style.display="block";
    lbVid.load();
    var p=lbVid.play();
    if(p && typeof p.catch==="function") p.catch(function(){});
    lbVid.onerror=function(){
      lbVid.style.display="none";
      if(imgSrc){ lbImg.src=imgSrc; lbImg.style.display="block"; }
    };
  } else if(imgSrc){
    lbImg.src=imgSrc;
    lbImg.style.display="block";
  }
}
function closeLightbox(){
  var lb=document.getElementById("lightbox");
  var lbVid=document.getElementById("lb-video");
  if(lb) lb.classList.remove("active");
  if(lbVid) try{ lbVid.pause(); }catch(e){}
}

document.addEventListener("DOMContentLoaded", function(){
  loadCSV();
  var lb=document.getElementById("lightbox");
  if(lb){
    lb.addEventListener("click", function(e){
      if(e.target===lb || e.target.closest("#lb-close")) closeLightbox();
    });
  }
});
