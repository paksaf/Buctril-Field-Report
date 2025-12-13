/* Buctril Dashboard – CSV + XLSX (Backchecker) Processor
   - Reads sum_sheet.csv (CSV) for operational KPIs, charts, table, and map.
   - Reads Buctril_Super_Activations.xlsx (XLSX) for D* sheet "last rows / sections" insights:
     demo plot desire %, repeat activation %, engagement benefit mix, post-event definite/awareness/clarity, expected sales increase.
   - Includes: DMS coordinate parsing, responsive charts, lazy media, accessible lightbox.
*/

(function(){
  "use strict";

  // --------------------------
  // Helpers
  // --------------------------
  function $(id){ return document.getElementById(id); }

  function safeText(v){
    if(v===null || v===undefined) return "";
    var s=String(v);
    if(s==="undefined" || s==="null") return "";
    return s;
  }

  function normalizeSpace(s){ return safeText(s).replace(/\s+/g," ").trim(); }

  function safeNumber(v){
    if(v===null || v===undefined) return 0;
    if(typeof v==="number" && isFinite(v)) return v;
    var s=safeText(v).trim();
    if(!s) return 0;

    // percentages
    s=s.replace(/%/g,"").replace(/,/g,"").trim();

    // Common placeholders
    if(/^(-|—|–|na|n\/a)$/i.test(s)) return 0;

    var m=s.match(/-?\d+(?:\.\d+)?/);
    if(!m) return 0;
    var n=parseFloat(m[0]);
    return isFinite(n) ? n : 0;
  }

  function clampPct(n){
    n = safeNumber(n);
    if(n<0) n=0;
    if(n>100) n=100;
    return n;
  }

  function formatInt(n){
    n = Math.round(safeNumber(n));
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");
  }

  function formatPct(n){
    return Math.round(clampPct(n)) + "%";
  }

  function uniq(arr){
    var s=new Set();
    arr.forEach(function(x){ if(x!=="" && x!==null && x!==undefined) s.add(x); });
    return Array.from(s);
  }

  function downloadJSON(obj, filename){
    try{
      var blob=new Blob([JSON.stringify(obj,null,2)], {type:"application/json"});
      var url=URL.createObjectURL(blob);
      var a=document.createElement("a");
      a.href=url;
      a.download=filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    }catch(e){}
  }

  // --------------------------
  // Date parsing for dd-MMM formats (no year in CSV)
  // Assumption: campaign year is current year; if future months mismatch, fallback.
  // --------------------------
  function parseDDMMM(dateStr){
    var s=normalizeSpace(dateStr);
    if(!s) return null;

    // Already ISO?
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
      var d=new Date(s+"T00:00:00");
      return isNaN(d.getTime()) ? null : d;
    }

    // dd-MMM (e.g., 23-Nov)
    var m=s.match(/^(\d{1,2})-([A-Za-z]{3,})$/);
    if(!m) return null;

    var dd=parseInt(m[1],10);
    var mon=m[2].slice(0,3).toLowerCase();
    var map={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    if(map[mon]===undefined) return null;

    var now=new Date();
    var year=now.getFullYear();
    var d=new Date(Date.UTC(year, map[mon], dd));
    if(isNaN(d.getTime())) return null;

    // If parsed date is > 60 days in future, assume it belongs to previous year
    var diff=(d.getTime()-now.getTime())/(1000*60*60*24);
    if(diff>60) d=new Date(Date.UTC(year-1, map[mon], dd));
    return d;
  }

  function toISODate(d){
    if(!d) return "";
    var yyyy=d.getUTCFullYear();
    var mm=String(d.getUTCMonth()+1).padStart(2,"0");
    var dd=String(d.getUTCDate()).padStart(2,"0");
    return yyyy+"-"+mm+"-"+dd;
  }

  // --------------------------
  // DMS coordinate parsing
  // Supports:
  //  - "30°11'52\"N, 71°28'11\"E"
  //  - "30 11 52 N 71 28 11 E"
  //  - "30.198, 71.469"
  // --------------------------
  function parseLatLon(input){
    var s=normalizeSpace(input);
    if(!s) return {lat:0, lon:0};

    // Normalize separators
    s=s.replace(/[;]/g,",");
    // Try decimal comma first
    var parts=s.split(",").map(function(x){return normalizeSpace(x);}).filter(Boolean);
    if(parts.length>=2){
      var a=safeNumber(parts[0]);
      var b=safeNumber(parts[1]);
      if(Math.abs(a)<=90 && Math.abs(b)<=180 && (a!==0 || b!==0)) return {lat:a, lon:b};
    }

    function dmsToDec(d, m, sec, hemi){
      var sign = (hemi==="S" || hemi==="W") ? -1 : 1;
      var dec = Math.abs(d) + (m/60) + (sec/3600);
      return sign * dec;
    }

    // DMS pattern e.g. 30°11'52"N 71°28'11"E
    var dms = s.match(/(\d{1,3})\s*[°º]\s*(\d{1,3})\s*['’]\s*(\d{1,3}(?:\.\d+)?)\s*["”]?\s*([NSEW])[\s,]+(\d{1,3})\s*[°º]\s*(\d{1,3})\s*['’]\s*(\d{1,3}(?:\.\d+)?)\s*["”]?\s*([NSEW])/i);
    if(dms){
      var lat=dmsToDec(parseFloat(dms[1]), parseFloat(dms[2]), parseFloat(dms[3]), dms[4].toUpperCase());
      var lon=dmsToDec(parseFloat(dms[5]), parseFloat(dms[6]), parseFloat(dms[7]), dms[8].toUpperCase());
      if(Math.abs(lat)<=90 && Math.abs(lon)<=180) return {lat:lat, lon:lon};
    }

    // Space-separated D M S H ...
    var dms2 = s.match(/(\d{1,3})\s+(\d{1,3})\s+(\d{1,3}(?:\.\d+)?)\s*([NSEW])\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3}(?:\.\d+)?)\s*([NSEW])/i);
    if(dms2){
      var lat2=dmsToDec(parseFloat(dms2[1]), parseFloat(dms2[2]), parseFloat(dms2[3]), dms2[4].toUpperCase());
      var lon2=dmsToDec(parseFloat(dms2[5]), parseFloat(dms2[6]), parseFloat(dms2[7]), dms2[8].toUpperCase());
      if(Math.abs(lat2)<=90 && Math.abs(lon2)<=180) return {lat:lat2, lon:lon2};
    }

    // Decimal space pair
    var m2=s.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    if(m2){
      var lat3=parseFloat(m2[1]), lon3=parseFloat(m2[2]);
      if(isFinite(lat3) && isFinite(lon3) && Math.abs(lat3)<=90 && Math.abs(lon3)<=180) return {lat:lat3, lon:lon3};
    }

    return {lat:0, lon:0};
  }

  // --------------------------
  // CSV loading and normalization
  // --------------------------
  function normalizeCSVRow(row, idx){
    // Basic identity
    var id = safeNumber(row["SN"] || row["Sr No"] || row["Sr. No"] || row["ID"] || row["Id"] || (idx+1));

    var city = normalizeSpace(row["City"] || row["To City"] || "");
    var district = normalizeSpace(row["Tehsil / District"] || row["District"] || row["Tehsil/District"] || "");
    var fromCity = normalizeSpace(row["From City"] || "");

    // Spot/village/location
    var spot = normalizeSpace(row["Session Location"] || row["Village / Mauza"] || row["Spot"] || row["Location"] || "");

    // Date
    var dateStr = normalizeSpace(row["Activity Date"] || row["Date"] || row["Session Date"] || "");
    var dateObj = parseDDMMM(dateStr);
    var dateISO = dateObj ? toISODate(dateObj) : "";

    // Core metrics
    var farmers = safeNumber(row["Total Farmers"] || row["Total Wheat Farmers"] || row["Farmers"] || row["Participants"] || 0);

    var acres = safeNumber(
      row["Estimated Buctril Acres from this Session"] ||
      row["Estimated Buctril Acres"] ||
      row["Total Wheat Acres"] ||
      row["Acres"] || 0
    );

    // Intent counts
    var definiteCount = safeNumber(row["Will Definitely Use"] || row["Plan Yes Count"] || 0);
    var maybeCount = safeNumber(row["Maybe"] || row["Plan Maybe Count"] || 0);
    var noCount = safeNumber(row["Not Interested"] || row["Plan No Count"] || 0);

    // Rates
    var definiteRate = safeNumber((row["Definite Use Rate"]||"").toString().replace(/%/g,""));
    var awareRate = safeNumber((row["Awareness Rate"]||"").toString().replace(/%/g,""));
    var clarityRaw = safeNumber(row["Average Understanding Score"] || row["Message Clarity %"] || row["Message Clarity"] || 0);

    // Convert clarity: if score is 1–3 (per XLSX), convert to percentage
    var clarityPct = clarityRaw;
    if(clarityRaw>0 && clarityRaw<=3.5){
      clarityPct = (clarityRaw/3)*100;
    }else if(clarityRaw>0 && clarityRaw<=10){
      clarityPct = clarityRaw*10;
    }else if(clarityRaw>0 && clarityRaw<=5){
      clarityPct = clarityRaw*20;
    }
    clarityPct = clampPct(clarityPct);

    // Fallback for definite rate
    if(definiteRate===0 && farmers>0 && definiteCount>0){
      definiteRate = (definiteCount/farmers)*100;
    }
    definiteRate = clampPct(definiteRate);

    // Awareness fallback: compute if counts exist
    if(awareRate===0 && farmers>0 && row["Know Buctril"]){
      var awareCount=safeNumber(row["Know Buctril"]);
      if(awareCount>0) awareRate = (awareCount/farmers)*100;
    }
    awareRate = clampPct(awareRate);

    // Coordinates
    var coord = row["Spot Coordinates"] || row["Coorrdinates"] || row["Coordinates"] || "";
    var latlon=parseLatLon(coord);

    // Session validity: must have meaningful row
    var isSession = (farmers>0 || acres>0) && (spot!=="" || city!=="" || district!=="");
    if(!isSession) return null;

    return {
      __raw: row,
      id: id,
      dateISO: dateISO,
      dateLabel: dateStr,
      city: city,
      district: district,
      fromCity: fromCity,
      spot: spot,
      farmers: farmers,
      acres: acres,
      definiteCount: definiteCount,
      maybeCount: maybeCount,
      noCount: noCount,
      definiteRate: definiteRate,
      awareRate: awareRate,
      clarityPct: clarityPct,
      lat: latlon.lat,
      lon: latlon.lon
    };
  }

  function loadCSV(){
    return new Promise(function(resolve, reject){
      Papa.parse("sum_sheet.csv", {
        download: true,
        skipEmptyLines: true,
        complete: function(res){
          try{
            if(!res || !res.data) throw new Error("CSV parse returned no data");
            // If first row starts with "Summary", Papa may treat it as header if header:true not used.
            // We will parse again with a sanitized string approach:
            fetch("sum_sheet.csv")
              .then(function(r){ return r.text(); })
              .then(function(text){
                var lines=text.split(/\r?\n/);
                if(lines.length && /^summary\b/i.test(lines[0].trim())){
                  lines.shift(); // drop the "Summary" row
                  text=lines.join("\n");
                }
                Papa.parse(text, {
                  header: true,
                  skipEmptyLines: true,
                  complete: function(r2){
                    var rows=(r2.data||[]).map(function(row, idx){ return normalizeCSVRow(row, idx); }).filter(Boolean);
                    resolve({rows:rows, fields:r2.meta && r2.meta.fields ? r2.meta.fields : []});
                  },
                  error: function(e){ reject(e); }
                });
              })
              .catch(reject);
          }catch(e){ reject(e); }
        },
        error: function(e){ reject(e); }
      });
    });
  }

  // --------------------------
  // XLSX (Backchecker) parsing
  // --------------------------
  function sheetNameIsSession(name){
    return /^D\d+S\d+$/i.test(String(name||"").trim());
  }

  function gridFromSheet(wb, sheetName){
    var ws = wb.Sheets[sheetName];
    if(!ws) return [];
    // 2D array
    var grid = XLSX.utils.sheet_to_json(ws, {header:1, blankrows:false});
    return (grid||[]).map(function(row){
      return (row||[]).map(function(c){ return c; });
    });
  }

  function findCellPositions(grid, regex){
    var out=[];
    for(var r=0;r<grid.length;r++){
      for(var c=0;c<(grid[r]||[]).length;c++){
        var v=grid[r][c];
        if(typeof v==="string" && regex.test(v)){
          out.push({r:r,c:c,val:v});
        }
      }
    }
    return out;
  }

  function firstNumericInRow(row, startCol){
    if(!row) return 0;
    for(var c=startCol||0;c<row.length;c++){
      var v=row[c];
      var n=safeNumber(v);
      if(n!==0) return n;
      // allow "0%" etc: safeNumber("0%") -> 0 (still 0). keep scanning
      if(typeof v==="string" && /%/.test(v) && safeNumber(v)===0) return 0;
    }
    return 0;
  }

  function bestTextInRow(row, startCol){
    if(!row) return "";
    for(var c=startCol||0;c<row.length;c++){
      var v=row[c];
      if(typeof v==="string" && normalizeSpace(v)!=="") return normalizeSpace(v);
    }
    return "";
  }

  function extractLabeledMetric(grid, labelRegex){
    // Find a label cell, then read a nearby numeric to the right (same row)
    for(var r=0;r<grid.length;r++){
      for(var c=0;c<(grid[r]||[]).length;c++){
        var v=grid[r][c];
        if(typeof v==="string" && labelRegex.test(v)){
          // try right side in same row
          var n=firstNumericInRow(grid[r], c+1);
          if(n!==0) return {value:n, where:"R"+(r+1)+"C"+(c+1)};
          // try next row
          if(grid[r+1]){
            var n2=firstNumericInRow(grid[r+1], c);
            if(n2!==0) return {value:n2, where:"R"+(r+2)+"C"+(c+1)};
          }
        }
      }
    }
    return {value:0, where:""};
  }

  function extractLastNumericItems(grid){
    // Extract rows that look like: [label string, some numeric/percent somewhere]
    var items=[];
    for(var r=0;r<grid.length;r++){
      var row=grid[r]||[];
      // find first decent label
      var label="";
      var labelCol=-1;
      for(var c=0;c<row.length;c++){
        var v=row[c];
        if(typeof v==="string"){
          var t=normalizeSpace(v);
          if(t && t.length>=3){
            label=t; labelCol=c; break;
          }
        }
      }
      if(!label) continue;

      // find any numeric in the row after label col
      var val=0;
      for(var c2=labelCol+1;c2<row.length;c2++){
        var v2=row[c2];
        var n=safeNumber(v2);
        if(n!==0 || (typeof v2==="string" && /%/.test(v2))){
          val=n;
          break;
        }
      }

      // only keep likely "metric" rows: keywords or percent-like
      if(/%|percent|desire|activation|benefit|benefit|follow|discount|demo|plot|often|sales|increase|definite|awareness|clarity/i.test(label)){
        items.push({label:label, value:val, row:r});
      }
    }
    return items;
  }

  function extractBenefitBreakdown(grid){
    // Try to locate a block about "benefited during engagement"
    // Then parse subsequent rows until blank row or next heading.
    var headingPos=null;
    for(var r=0;r<grid.length;r++){
      for(var c=0;c<(grid[r]||[]).length;c++){
        var v=grid[r][c];
        if(typeof v==="string" && /benefit(ed)? during engagement|what benefited|benefited during/i.test(v)){
          headingPos={r:r,c:c};
          break;
        }
      }
      if(headingPos) break;
    }
    if(!headingPos) return {};

    var out={};
    for(var rr=headingPos.r+1; rr<Math.min(grid.length, headingPos.r+40); rr++){
      var row=grid[rr]||[];
      var label=bestTextInRow(row, 0);
      if(!label) break;
      if(/prior event|post event|message|understanding|score|definite|awareness/i.test(label)) break;

      // Look for numeric to the right
      var val=firstNumericInRow(row, 1);
      // If value absent but label is one of known options, treat as 1 if "Yes" etc.
      if(val===0 && typeof row[1]==="string" && /yes/i.test(row[1])) val=1;

      // Normalize common option names
      var key=label
        .replace(/\s+/g," ")
        .replace(/[:,]/g,"")
        .trim();

      out[key]=(out[key]||0) + (val||0);
    }
    return out;
  }

  function topKeyFromDict(d){
    var best={k:"",v:0};
    Object.keys(d||{}).forEach(function(k){
      var v=safeNumber(d[k]);
      if(v>best.v){ best={k:k,v:v}; }
    });
    return best.k || "";
  }

  function extractBackcheckerForSheet(grid){
    // Specific metrics
    var demo = extractLabeledMetric(grid, /demo\s*plot.*desire|desire.*demo\s*plot/i);
    var often = extractLabeledMetric(grid, /activations?.*happen often|happen often.*activation|repeat activations?/i);

    // Post-event metrics (attempt)
    var postDef = extractLabeledMetric(grid, /post event.*definite|definite.*post event|post.*definite/i);
    var postAw  = extractLabeledMetric(grid, /post event.*awareness|awareness.*post event|post.*awareness/i);
    var postCl  = extractLabeledMetric(grid, /post event.*clarity|clarity.*post event|post.*clarity|brand attributes.*clarity/i);

    var salesUp = extractLabeledMetric(grid, /expected increase in sales|sales increase|expected.*sales/i);

    // Benefit breakdown
    var benefit = extractBenefitBreakdown(grid);
    var topBenefit = topKeyFromDict(benefit);

    // Fallback: if demo/often are not found, try last numeric items list
    if(!demo.value || !often.value){
      var items=extractLastNumericItems(grid);
      // pick candidates
      if(!demo.value){
        var d1=items.find(function(x){return /demo\s*plot/i.test(x.label);});
        if(d1) demo.value=d1.value;
      }
      if(!often.value){
        var o1=items.find(function(x){return /often|repeat.*activation|activation.*often/i.test(x.label);});
        if(o1) often.value=o1.value;
      }
    }

    // Clarity may be in 1–3 scale; convert if so
    if(postCl.value>0 && postCl.value<=3.5) postCl.value = (postCl.value/3)*100;

    return {
      demoPlotPct: clampPct(demo.value),
      activationOftenPct: clampPct(often.value),
      topBenefit: topBenefit,
      benefitDict: benefit,
      postDefPct: clampPct(postDef.value),
      postAwarePct: clampPct(postAw.value),
      postClarityPct: clampPct(postCl.value),
      expectedSalesUp: salesUp.value,
      notes: ""
    };
  }

  function loadXLSX(){
    return fetch("Buctril_Super_Activations.xlsx")
      .then(function(r){
        if(!r.ok) throw new Error("XLSX not found (HTTP "+r.status+")");
        return r.arrayBuffer();
      })
      .then(function(buf){
        var wb = XLSX.read(buf, {type:"array"});
        var sessionSheets = (wb.SheetNames||[]).filter(sheetNameIsSession);

        var extracted=[];
        var diag=[];

        sessionSheets.forEach(function(name){
          var grid = gridFromSheet(wb, name);
          if(!grid || !grid.length){
            diag.push(name+": empty sheet grid.");
            return;
          }
          var e = extractBackcheckerForSheet(grid);
          // Minimal validation: if none found, flag
          var foundAny = (e.demoPlotPct>0 || e.activationOftenPct>0 || e.topBenefit!=="" || e.postDefPct>0 || e.postAwarePct>0 || e.postClarityPct>0 || safeNumber(e.expectedSalesUp)>0);
          if(!foundAny){
            diag.push(name+": no matching labels detected (check keywords or sheet layout).");
          }
          extracted.push({sheet:name, data:e});
        });

        return {sheets:extracted, diagnostics:diag};
      });
  }

  // --------------------------
  // UI: Charts & Map
  // --------------------------
  var chartIntent=null, chartPerf=null, chartCities=null, chartTrend=null, chartBackchecker=null, chartBenefit=null;
  var map=null, mapLayer=null;
  var allCSV=[], filteredCSV=[];
  var backchecker={sheets:[], diagnostics:[]};

  function ensureMap(){
    if(map) return;
    map=L.map("map", {scrollWheelZoom:false});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    mapLayer=L.layerGroup().addTo(map);
    map.setView([30.3753, 69.3451], 5); // Pakistan
  }

  function updateMap(rows){
    ensureMap();
    mapLayer.clearLayers();
    var pts=0;
    rows.forEach(function(r){
      if(!r) return;
      if(!r.lat || !r.lon) return;
      if(Math.abs(r.lat)>90 || Math.abs(r.lon)>180) return;
      pts++;
      var label = "<strong>"+(r.spot||"Spot")+"</strong><br/>"+(r.city||"")+(r.district?(" / "+r.district):"")+"<br/>Farmers: "+formatInt(r.farmers);
      L.marker([r.lat, r.lon]).bindPopup(label).addTo(mapLayer);
    });
    if(pts){
      try{
        var bounds=mapLayer.getBounds();
        map.fitBounds(bounds.pad(0.18));
      }catch(e){}
    }
  }

  function buildFilters(rows){
    var cities=uniq(rows.map(function(r){return r.city;})).sort();
    var districts=uniq(rows.map(function(r){return r.district;})).sort();

    function fillSelect(sel, opts, labelAll){
      sel.innerHTML="";
      var o=document.createElement("option");
      o.value=""; o.textContent=labelAll;
      sel.appendChild(o);
      opts.forEach(function(v){
        var oo=document.createElement("option");
        oo.value=v; oo.textContent=v;
        sel.appendChild(oo);
      });
    }

    fillSelect($("filter-city"), cities, "All Cities");
    fillSelect($("filter-district"), districts, "All Districts");
  }

  function applyFilters(){
    var city=normalizeSpace($("filter-city").value);
    var district=normalizeSpace($("filter-district").value);
    var from=$("filter-date-from").value;
    var to=$("filter-date-to").value;

    filteredCSV = allCSV.filter(function(r){
      if(!r) return false;
      if(city && r.city!==city) return false;
      if(district && r.district!==district) return false;
      if(from && r.dateISO && r.dateISO<from) return false;
      if(to && r.dateISO && r.dateISO>to) return false;
      return true;
    });

    updateAll(filteredCSV);
  }

  function resetFilters(){
    $("filter-city").value="";
    $("filter-district").value="";
    $("filter-date-from").value="";
    $("filter-date-to").value="";
    applyFilters();
  }

  function computeKPIs(rows){
    var sessions=rows.length;
    var farmers=rows.reduce(function(s,r){return s + (r.farmers||0);},0);
    var acres=rows.reduce(function(s,r){return s + (r.acres||0);},0);

    var avgDef=0, avgAw=0, avgCl=0;
    if(sessions){
      avgDef = rows.reduce(function(s,r){return s + (r.definiteRate||0);},0)/sessions;
      avgAw  = rows.reduce(function(s,r){return s + (r.awareRate||0);},0)/sessions;
      avgCl  = rows.reduce(function(s,r){return s + (r.clarityPct||0);},0)/sessions;
    }

    // Intent totals (use counts where possible, else infer from farmers and rates)
    var defCount = rows.reduce(function(s,r){return s+(r.definiteCount||0);},0);
    var maybeCount = rows.reduce(function(s,r){return s+(r.maybeCount||0);},0);
    var noCount = rows.reduce(function(s,r){return s+(r.noCount||0);},0);

    // If counts are empty but rates exist, estimate
    if((defCount+maybeCount+noCount)===0 && farmers>0){
      defCount = Math.round(farmers * clampPct(avgDef)/100);
    }
    // Return
    return {sessions:sessions,farmers:farmers,acres:acres,avgDef:avgDef,avgAw:avgAw,avgCl:avgCl,defCount:defCount,maybeCount:maybeCount,noCount:noCount};
  }

  function updateKPIBars(k){
    $("kpi-sessions").textContent = formatInt(k.sessions);
    $("kpi-farmers").textContent = formatInt(k.farmers);
    $("kpi-acres").textContent = formatInt(k.acres);

    // Normalize bars relative to reasonable maxima (adjust as needed)
    $("bar-sessions").style.width = clampPct((k.sessions/60)*100) + "%";
    $("bar-farmers").style.width = clampPct((k.farmers/2000)*100) + "%";
    $("bar-acres").style.width = clampPct((k.acres/25000)*100) + "%";
  }

  function updateHighlights(k, backAgg){
    var cards=[
      {t:"Definite Use", d:"Avg (filtered): "+formatPct(k.avgDef)+" — reinforce talk-track where below threshold."},
      {t:"Awareness", d:"Avg (filtered): "+formatPct(k.avgAw)+" — improve pre-event dealer + village mobilization if low."},
      {t:"Clarity", d:"Avg (filtered): "+formatPct(k.avgCl)+" — retrain anchors on the 4 key messages if low."},
      {t:"Demo Plot Desire", d: backAgg.demoPlotAvg>0 ? ("Avg (overall): "+formatPct(backAgg.demoPlotAvg)) : "Awaiting XLSX extraction (demo plot desire %)."},
      {t:"Repeat Activations", d: backAgg.activationOftenAvg>0 ? ("Avg (overall): "+formatPct(backAgg.activationOftenAvg)) : "Awaiting XLSX extraction (activations happen often %)."},
      {t:"Top Engagement Benefit", d: backAgg.topBenefit ? backAgg.topBenefit : "Awaiting XLSX benefit mix (Q&A / Discussion / Anchor opening / Gifts)."},
      {t:"Sales Uplift (Expected)", d: backAgg.salesUpAvg ? ("Avg: "+Math.round(backAgg.salesUpAvg)) : "Awaiting XLSX expected sales increase fields."},
      {t:"Last 3 Sessions", d:"Always pinned at top of the session table for quick review and follow-up planning."}
    ];

    var track=$("highlightsTrack");
    track.innerHTML="";
    // Create twice for infinite loop
    function addOne(){
      cards.forEach(function(c){
        var div=document.createElement("div");
        div.className="mCard";
        div.innerHTML="<h3>"+c.t+"</h3><p>"+c.d+"</p>";
        track.appendChild(div);
      });
    }
    addOne(); addOne();
  }

  function chartOrUpdate(ctx, existing, config){
    if(existing){
      existing.data=config.data;
      existing.options=config.options;
      existing.update();
      return existing;
    }
    return new Chart(ctx, config);
  }

  function updateCharts(k, rows){
    // Intent donut
    var intentData = {
      labels:["Definite","Maybe","Not Interested"],
      datasets:[{data:[k.defCount||0,k.maybeCount||0,k.noCount||0]}]
    };
    chartIntent = chartOrUpdate($("chartIntent"), chartIntent, {
      type:"doughnut",
      data:intentData,
      options:{
        responsive:true,
        plugins:{legend:{position:"bottom", labels:{color:"#aab4d4"}}}
      }
    });

    // Performance bars (avg)
    var perfData={
      labels:["Clarity","Awareness","Definite"],
      datasets:[{label:"Average %", data:[k.avgCl,k.avgAw,k.avgDef]}]
    };
    chartPerf = chartOrUpdate($("chartPerf"), chartPerf, {
      type:"bar",
      data:perfData,
      options:{
        responsive:true,
        scales:{
          x:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}},
          y:{min:0,max:100,ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}}
        },
        plugins:{legend:{display:false}}
      }
    });

    // Top cities
    var cityAgg={};
    rows.forEach(function(r){
      var c=r.city||"Unknown";
      cityAgg[c]=(cityAgg[c]||0) + (r.farmers||0);
    });
    var cityArr=Object.keys(cityAgg).map(function(c){return {c:c,v:cityAgg[c]};}).sort(function(a,b){return b.v-a.v;}).slice(0,10);
    chartCities = chartOrUpdate($("chartCities"), chartCities, {
      type:"bar",
      data:{
        labels: cityArr.map(function(x){return x.c;}),
        datasets:[{label:"Farmers", data: cityArr.map(function(x){return x.v;})}]
      },
      options:{
        responsive:true,
        scales:{
          x:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}},
          y:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}}
        },
        plugins:{legend:{display:false}}
      }
    });

    // Trend by day (farmers)
    var dayAgg={};
    rows.forEach(function(r){
      var d=r.dateISO || "Unknown";
      dayAgg[d]=(dayAgg[d]||0) + (r.farmers||0);
    });
    var dayArr=Object.keys(dayAgg).sort().map(function(d){return {d:d,v:dayAgg[d]};});
    chartTrend = chartOrUpdate($("chartTrend"), chartTrend, {
      type:"line",
      data:{
        labels: dayArr.map(function(x){return x.d==="Unknown" ? "Unknown" : x.d;}),
        datasets:[{label:"Farmers", data: dayArr.map(function(x){return x.v;})}]
      },
      options:{
        responsive:true,
        scales:{
          x:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}},
          y:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}}
        },
        plugins:{legend:{position:"bottom", labels:{color:"#aab4d4"}}}
      }
    });
  }

  function sortRowsByDateDesc(rows){
    return rows.slice().sort(function(a,b){
      var da=a.dateISO||"", db=b.dateISO||"";
      if(da===db) return (b.id||0)-(a.id||0);
      return db.localeCompare(da);
    });
  }

  function updateSessionTable(rows){
    var tbody=$("tblSessions");
    tbody.innerHTML="";

    var sorted=sortRowsByDateDesc(rows);
    var last3=sorted.slice(0,3);

    function addRow(r, isPinned){
      var tr=document.createElement("tr");
      if(isPinned) tr.style.background="rgba(93,214,255,.06)";
      tr.innerHTML =
        "<td>"+formatInt(r.id)+"</td>"+
        "<td>"+(r.dateISO||r.dateLabel||"")+(isPinned?(" <span class='tag'>Last 3</span>"):"")+"</td>"+
        "<td>"+(r.district||"")+"</td>"+
        "<td>"+(r.city||"")+"</td>"+
        "<td>"+(r.spot||"")+"</td>"+
        "<td>"+formatInt(r.farmers)+"</td>"+
        "<td>"+formatInt(r.acres)+"</td>"+
        "<td>"+formatPct(r.definiteRate)+"</td>"+
        "<td>"+formatPct(r.awareRate)+"</td>"+
        "<td>"+formatPct(r.clarityPct)+"</td>";
      tbody.appendChild(tr);
    }

    // pinned last3
    last3.forEach(function(r){ addRow(r, true); });

    // rest (excluding those exact IDs)
    var pinnedIds=new Set(last3.map(function(r){return r.id;}));
    sorted.forEach(function(r){
      if(pinnedIds.has(r.id)) return;
      addRow(r, false);
    });
  }

  function actionItem(sev, title, detail){
    var div=document.createElement("div");
    div.className="action";
    div.innerHTML =
      "<div class='head'><strong>"+title+"</strong><span class='sev "+sev+"'>"+sev.toUpperCase()+"</span></div>"+
      "<p>"+detail+"</p>";
    return div;
  }

  function updateActions(k, backAgg){
    var list=$("actionList");
    list.innerHTML="";

    // CSV thresholds
    if(k.avgAw < 60){
      list.appendChild(actionItem("bad","Awareness below 60%","Run stronger pre-activation: dealer engagement 48–72 hours prior, village-level invitations, and quick “prior event questions” at gathering to frame the session."));
    }else{
      list.appendChild(actionItem("good","Awareness on track","Maintain current mobilization approach; prioritize low-awareness micro-areas via filters."));
    }

    if(k.avgDef < 70){
      list.appendChild(actionItem("bad","Definite below 70%","Counter objections: reinforce Golden Period, yield-loss framing, and Buctril+Atlantis combined benefit. Add proof-points and a structured closing CTA."));
    }else{
      list.appendChild(actionItem("good","Definite on track","High intent: convert with dealer availability + sales follow-ups in 3–5 days."));
    }

    if(k.avgCl < 75){
      list.appendChild(actionItem("warn","Clarity below 75%","Retrain anchors on the 4 key messages. Use short Q&A checkpoints and repeat-back technique to improve message understanding."));
    }else{
      list.appendChild(actionItem("good","Clarity on track","Keep format; continue prioritizing Q&A and structured recap."));
    }

    // Backchecker-driven
    if(backAgg.demoPlotAvg >= 60){
      list.appendChild(actionItem("warn","High demand for demo plots","Demo plot desire is high. Allocate demo stock + schedule a demo calendar with the sales team for the highest-demand areas."));
    }
    if(backAgg.activationOftenAvg >= 60){
      list.appendChild(actionItem("warn","Strong appetite for more activations","Repeat-activation preference is high. Consider monthly cadence in price-conscious areas with smaller, more frequent gatherings."));
    }

    if(backAgg.topBenefit){
      list.appendChild(actionItem("good","Most beneficial engagement element","Top benefit observed: <strong>"+backAgg.topBenefit+"</strong>. Standardize this as a core module in every session."));
    }

    // Price conscious messaging (from CSV reasons if present)
    // If the CSV has reason counts, user can extend this logic; we keep placeholder text:
    list.appendChild(actionItem("warn","Price-sensitive areas","Where “Price too high” dominates, prepare ROI narrative: cost per acre vs yield loss avoided, plus dealer-backed availability and reasonable discount bundles."));
  }

  // --------------------------
  // Backchecker aggregation + UI
  // --------------------------
  function aggregateBackchecker(sheets){
    var demo=[], often=[], sales=[];
    var benefitAgg={};
    var topBenefit="";

    sheets.forEach(function(s){
      var d=s.data||{};
      if(d.demoPlotPct) demo.push(d.demoPlotPct);
      if(d.activationOftenPct) often.push(d.activationOftenPct);
      if(safeNumber(d.expectedSalesUp)) sales.push(safeNumber(d.expectedSalesUp));

      var bd=d.benefitDict||{};
      Object.keys(bd).forEach(function(k){
        benefitAgg[k]=(benefitAgg[k]||0)+safeNumber(bd[k]);
      });
    });

    topBenefit = topKeyFromDict(benefitAgg);

    function avg(arr){
      if(!arr.length) return 0;
      return arr.reduce(function(a,b){return a+b;},0)/arr.length;
    }

    return {
      demoPlotAvg: clampPct(avg(demo)),
      activationOftenAvg: clampPct(avg(often)),
      salesUpAvg: avg(sales),
      benefitAgg: benefitAgg,
      topBenefit: topBenefit
    };
  }

  function updateBackcheckerUI(back){
    var tbody=$("tblBackchecker");
    tbody.innerHTML="";

    var diag=$("diagBox");
    var diagLines=(back.diagnostics||[]).slice(0,25);
    if(diagLines.length){
      diag.innerHTML = "<strong>Diagnostics:</strong><br/>" + diagLines.map(function(x){return "• "+x;}).join("<br/>");
    }else{
      diag.innerHTML = "<strong>Diagnostics:</strong> No issues detected in D* sheet extraction.";
    }

    // Table
    (back.sheets||[]).forEach(function(s){
      var d=s.data||{};
      var tr=document.createElement("tr");
      tr.innerHTML =
        "<td>"+safeText(s.sheet)+"</td>"+
        "<td>"+(d.demoPlotPct?formatPct(d.demoPlotPct):"–")+"</td>"+
        "<td>"+(d.activationOftenPct?formatPct(d.activationOftenPct):"–")+"</td>"+
        "<td>"+(d.topBenefit?safeText(d.topBenefit):"–")+"</td>"+
        "<td>"+(d.postDefPct?formatPct(d.postDefPct):"–")+"</td>"+
        "<td>"+(d.postAwarePct?formatPct(d.postAwarePct):"–")+"</td>"+
        "<td>"+(d.postClarityPct?formatPct(d.postClarityPct):"–")+"</td>"+
        "<td>"+(d.expectedSalesUp?Math.round(safeNumber(d.expectedSalesUp)):"–")+"</td>"+
        "<td>"+(d.notes?safeText(d.notes):"")+"</td>";
      tbody.appendChild(tr);
    });

    // Charts
    var agg=aggregateBackchecker(back.sheets||[]);
    $("kpi-demo").textContent = agg.demoPlotAvg ? formatPct(agg.demoPlotAvg) : "–";
    $("bar-demo").style.width = agg.demoPlotAvg ? (agg.demoPlotAvg+"%") : "0%";

    // Backchecker averages chart
    chartBackchecker = chartOrUpdate($("chartBackchecker"), chartBackchecker, {
      type:"bar",
      data:{
        labels:["Demo Plot Desire","Repeat Activations","Post Definite","Post Awareness","Post Clarity"],
        datasets:[{
          label:"Average %",
          data:[
            agg.demoPlotAvg,
            agg.activationOftenAvg,
            avgOf(back.sheets,"postDefPct"),
            avgOf(back.sheets,"postAwarePct"),
            avgOf(back.sheets,"postClarityPct")
          ]
        }]
      },
      options:{
        responsive:true,
        scales:{
          x:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}},
          y:{min:0,max:100,ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}}
        },
        plugins:{legend:{display:false}}
      }
    });

    // Benefit chart (top 8)
    var b=agg.benefitAgg||{};
    var arr=Object.keys(b).map(function(k){return {k:k,v:safeNumber(b[k])};}).sort(function(a,b){return b.v-a.v;}).slice(0,8);
    chartBenefit = chartOrUpdate($("chartBenefit"), chartBenefit, {
      type:"bar",
      data:{
        labels: arr.map(function(x){return x.k;}),
        datasets:[{label:"Mentions/Score", data: arr.map(function(x){return x.v;})}]
      },
      options:{
        responsive:true,
        scales:{
          x:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}},
          y:{ticks:{color:"#aab4d4"}, grid:{color:"rgba(255,255,255,.06)"}}
        },
        plugins:{legend:{display:false}}
      }
    });

    return agg;
  }

  function avgOf(sheets, field){
    var vals=[];
    (sheets||[]).forEach(function(s){
      var v=s && s.data ? safeNumber(s.data[field]) : 0;
      if(v) vals.push(v);
    });
    if(!vals.length) return 0;
    return clampPct(vals.reduce(function(a,b){return a+b;},0)/vals.length);
  }

  // --------------------------
  // Media gallery (lazy) + lightbox
  // --------------------------
  var mediaItems=[];
  var lbIndex=0;

  function loadMediaManifest(){
    return fetch("assets/gallery/media.json")
      .then(function(r){
        if(!r.ok) throw new Error("media.json not found");
        return r.json();
      })
      .then(function(j){
        if(!Array.isArray(j)) return [];
        return j;
      })
      .catch(function(){
        // Fallback: use a small default placeholder list; user should replace.
        return [
          {type:"image", src:"assets/gallery/sample1.jpg", alt:"Sample photo 1 (replace in assets/gallery)", caption:"Replace this with your activation image", transcript:""},
          {type:"image", src:"assets/gallery/sample2.jpg", alt:"Sample photo 2 (replace in assets/gallery)", caption:"Replace this with your activation image", transcript:""},
          {type:"video", src:"assets/gallery/sample1.mp4", alt:"Sample activation video (replace)", caption:"Replace this with your activation video", vtt:"", transcript:"Provide a short transcript for accessibility."}
        ];
      });
  }

  function renderGallery(items){
    mediaItems=items||[];
    var grid=$("galleryGrid");
    grid.innerHTML="";

    // IntersectionObserver for video lazy loading (optional)
    var io=null;
    if("IntersectionObserver" in window){
      io=new IntersectionObserver(function(entries){
        entries.forEach(function(ent){
          if(ent.isIntersecting){
            var el=ent.target;
            if(el && el.dataset && el.dataset.src){
              el.src=el.dataset.src;
              delete el.dataset.src;
            }
            io.unobserve(el);
          }
        });
      }, {rootMargin:"200px"});
    }

    mediaItems.forEach(function(it, idx){
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="thumb";
      btn.setAttribute("aria-label", "Open media: "+(it.caption||it.alt||("item "+(idx+1))));
      btn.addEventListener("click", function(){ openLightbox(idx); });

      if(it.type==="video"){
        var v=document.createElement("video");
        v.muted=true;
        v.playsInline=true;
        v.preload="metadata";
        v.setAttribute("aria-label", it.alt || ("Video "+(idx+1)));
        // Lazy: store src in data-src; load when visible
        v.dataset.src = it.src;
        v.poster = it.poster || "";
        if(io) io.observe(v); else v.src=it.src;

        btn.appendChild(v);
        var play=document.createElement("div");
        play.className="play";
        play.textContent="▶";
        play.setAttribute("aria-hidden","true");
        btn.appendChild(play);
      }else{
        var img=document.createElement("img");
        img.src=it.src;
        img.loading="lazy";
        img.alt=it.alt || ("Image "+(idx+1));
        btn.appendChild(img);
      }

      grid.appendChild(btn);
    });

    // If media files missing, avoid console noise
  }

  function openLightbox(idx){
    lbIndex=idx;
    var lb=$("lightbox");
    lb.setAttribute("aria-hidden","false");
    renderLightboxItem();
    // focus close for accessibility
    $("lbClose").focus();
  }

  function closeLightbox(){
    $("lightbox").setAttribute("aria-hidden","true");
    $("lbMedia").innerHTML="";
  }

  function renderLightboxItem(){
    var it=mediaItems[lbIndex];
    if(!it) return;

    $("lbCaption").textContent = it.caption || it.alt || ("Item "+(lbIndex+1));
    $("lbTranscript").innerHTML =
      "<strong>Transcript / Notes:</strong> " + (it.transcript ? safeText(it.transcript) : "Add transcript text in assets/gallery/media.json for accessibility.");

    var box=$("lbMedia");
    box.innerHTML="";

    if(it.type==="video"){
      var v=document.createElement("video");
      v.controls=true;
      v.playsInline=true;
      v.preload="metadata";
      v.src=it.src;
      v.setAttribute("aria-label", it.alt || ("Video "+(lbIndex+1)));
      if(it.vtt){
        var t=document.createElement("track");
        t.kind="captions";
        t.label="English";
        t.srclang="en";
        t.src=it.vtt;
        t.default=true;
        v.appendChild(t);
      }
      box.appendChild(v);
    }else{
      var img=document.createElement("img");
      img.src=it.src;
      img.alt=it.alt || ("Image "+(lbIndex+1));
      box.appendChild(img);
    }
  }

  function nextLB(){
    if(!mediaItems.length) return;
    lbIndex=(lbIndex+1)%mediaItems.length;
    renderLightboxItem();
  }
  function prevLB(){
    if(!mediaItems.length) return;
    lbIndex=(lbIndex-1+mediaItems.length)%mediaItems.length;
    renderLightboxItem();
  }

  // --------------------------
  // Main update pipeline
  // --------------------------
  function updateAll(rows){
    var k=computeKPIs(rows);
    updateKPIBars(k);
    updateCharts(k, rows);
    updateSessionTable(rows);
    updateMap(rows);

    var agg=aggregateBackchecker(backchecker.sheets||[]);
    updateHighlights(k, agg);
    updateActions(k, agg);
  }

  // --------------------------
  // Init
  // --------------------------
  function init(){
    // Buttons
    $("btn-reset").addEventListener("click", resetFilters);
    $("btn-export").addEventListener("click", function(){
      downloadJSON(filteredCSV, "filtered_sessions.json");
    });

    // Filters
    ["filter-city","filter-district","filter-date-from","filter-date-to"].forEach(function(id){
      $(id).addEventListener("change", applyFilters);
    });

    // Lightbox
    $("lbClose").addEventListener("click", closeLightbox);
    $("lbNext").addEventListener("click", nextLB);
    $("lbPrev").addEventListener("click", prevLB);
    $("lightbox").addEventListener("click", function(e){
      // click outside panel closes
      if(e.target===this) closeLightbox();
    });
    document.addEventListener("keydown", function(e){
      var open = $("lightbox").getAttribute("aria-hidden")==="false";
      if(!open) return;
      if(e.key==="Escape") closeLightbox();
      if(e.key==="ArrowRight") nextLB();
      if(e.key==="ArrowLeft") prevLB();
    });

    // Load media
    loadMediaManifest().then(renderGallery);

    // Load CSV
    loadCSV()
      .then(function(res){
        allCSV=res.rows||[];
        $("status-csv").textContent="CSV: loaded ("+formatInt(allCSV.length)+" sessions)";
        buildFilters(allCSV);
        filteredCSV=allCSV.slice();
        updateAll(filteredCSV);
      })
      .catch(function(err){
        $("status-csv").textContent="CSV: error";
        $("noticeBox").innerHTML="<strong>CSV loading failed:</strong> "+safeText(err && err.message ? err.message : err)+
          "<br/>Ensure <code>sum_sheet.csv</code> is in the same folder as <code>index.html</code>.";
      });

    // Load XLSX (optional)
    loadXLSX()
      .then(function(x){
        backchecker=x;
        $("status-xlsx").textContent="XLSX: loaded ("+formatInt((x.sheets||[]).length)+" sheets)";
        var agg=updateBackcheckerUI(backchecker);
        // update actions again with new agg if CSV already loaded
        if(allCSV.length) updateAll(filteredCSV);
      })
      .catch(function(err){
        $("status-xlsx").textContent="XLSX: not found (optional)";
        backchecker={sheets:[], diagnostics:["XLSX not loaded: "+safeText(err && err.message ? err.message : err)]};
        updateBackcheckerUI(backchecker);
        if(allCSV.length) updateAll(filteredCSV);
      });
  }

  // Start
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }

})();