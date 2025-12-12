/****************************************************
 * Buctril Super Dashboard – Donut-driven City Navigation (multi-color)
 * - Reads sum_sheet.csv (same folder as index.html)
 * - Excludes Multan start-point rows (Multan + 0 farmers + 0 acres)
 * - Filters: RGN → City → Spot + Search
 * - Donuts:
 *    1) Avg Clarity (single-color)
 *    2) Avg Definite (single-color)
 *    3) Farmers by City (multi-color, click segment to filter)
 * - Media:
 *    Supports simple per-session naming: 1.jpg/1.jpeg + 1.mp4
 *    Also supports multi-media per session: 1a…1f (jpg/jpeg/mp4)
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

function getField(row, candidates){
  for(var i=0;i<candidates.length;i++){
    var k=candidates[i];
    if(row.hasOwnProperty(k) && safeText(row[k])!=="") return row[k];
  }
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

function isMultanStartPoint(r){
  var c = normName(r.city).toLowerCase();
  return (c==="multan" && (r.__farmers===0) && (r.__acres===0));
}
function clampPct(x){ return Math.max(0, Math.min(100, x)); }
function starsFromPct(p){
  var s = Math.max(0, Math.min(5, Math.round(p/20)));
  return "★".repeat(s) + "☆".repeat(5-s);
}
function cityColor(city){
  var c = normName(city).toLowerCase();
  var h=0;
  for(var i=0;i<c.length;i++){ h = (h*31 + c.charCodeAt(i)) % 360; }
  return "hsl(" + h + ", 70%, 55%)";
}

var allRows=[], filteredRows=[];
var map=null, mapMarkers=[];
var clarityDonut=null, definiteDonut=null, cityDonut=null;
var MEDIA_LETTERS=["a","b","c","d","e","f"];

function loadCSV(){
  var loading=document.getElementById("loading");
  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(function(res){
      if(!res.ok) throw new Error("sum_sheet.csv not found ("+res.status+")");
      return res.text();
    })
    .then(function(text){
      var lines=text.split(/\r?\n/);
      if(lines.length && /^summary\b/i.test(lines[0].trim())){
        lines.shift();
        text=lines.join("\n");
      }
      if(typeof Papa==="undefined") throw new Error("PapaParse not loaded (Papa is undefined).");

      var parsed=Papa.parse(text, {header:true, dynamicTyping:false, skipEmptyLines:true});
      if(parsed.errors && parsed.errors.length){
        console.error("CSV parse errors:", parsed.errors);
        showErrorModal("CSV parsing errors detected. Ensure commas inside text fields are quoted.");
      }

      allRows=(parsed.data||[])
        .map(function(row, idx){ return normalizeRow(row, idx); })
        .filter(function(r){ return r && (r.__farmers>0); })
        .filter(function(r){ return normName(r.city).toLowerCase() !== "multan"; });

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

function normalizeRow(row, idx){
  var sid = safeText(getField(row, ["SN","Sr No","Sr. No","Session ID","SessionID","ID","Id","S#","S.No","S No"]));
  var id = sid!=="" ? safeNumber(sid) : (idx+1);

  var rgn = safeText(getField(row, ["RGN","Region","REGION","Rgn"]));
  var city = normName(getField(row, ["City","To City","To","District","District/City"]));
  var from = normName(getField(row, ["From City","From","Starting City","Start City"]));
  var spot = normName(getField(row, ["Session Location","Village / Mauza","Village/Mauza","Spot","Location","Venue","Mauza","Village"]));
  var date = safeText(getField(row, ["Date","Activity Date","Day","Session Date"]));

  var farmers = safeNumber(getField(row, ["No of Farmer Participate","Farmers","Farmers Engaged","No of Farmers","No. of Farmers","Participants","Attendees"]));
  var acres = safeNumber(getField(row, ["Acres","Acres Covered","Total Acres"]));

  var clarity = safeNumber(getField(row, ["Message Clarity %","Message Clarity","Clarity %","Clarity","Msg Clarity"]));
  var definite = safeNumber(getField(row, ["Definite Use %","Definite Use","Use Intent %","Use Intent","Definite"]));
  var influencers = safeNumber(getField(row, ["Influencers","No of Influencers","Influencers Identified"]));
  var awareness = safeNumber(getField(row, ["Awareness %","Awareness","Awareness Rate"]));

  var lat = safeNumber(getField(row, ["Latitude","Lat"]));
  var lon = safeNumber(getField(row, ["Longitude","Lng","Long","Lon"]));

  return {
    __raw: row,
    id:id, rgn:rgn, city:city, from:from, spot:spot, date:date,
    __farmers:farmers, __acres:acres,
    __messageClarity:clarity, __definiteUseRate:definite, __influencers:influencers, __awarenessRate:awareness,
    latitude:lat, longitude:lon
  };
}

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
    rebuildCityOptions();
    rebuildSpotOptions();
    applyFilters();
  });
  citySel.addEventListener("change", function(){
    rebuildSpotOptions();
    applyFilters();
  });
  spotSel.addEventListener("change", applyFilters);
  search.addEventListener("input", applyFilters);

  clearBtn.addEventListener("click", function(){
    rgnSel.value="";
    citySel.value="";
    spotSel.value="";
    search.value="";
    rebuildCityOptions();
    rebuildSpotOptions();
    applyFilters();
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
    if(r.city.toLowerCase()==="multan") return;
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
  updateCityDonut(filteredRows);
  updateSessionTable(filteredRows);
  updateMap(filteredRows);
  updateMedia(filteredRows);
}

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
    infl = rows.reduce(function(s,r){return s+(r.__influencers||0);},0);
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
  var c3=document.getElementById("cityDonut");
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

  cityDonut=new Chart(c3, {
    type:"doughnut",
    data:{labels:[],datasets:[{data:[],backgroundColor:[],borderWidth:0}]},
    options:{
      responsive:true,maintainAspectRatio:false,cutout:"74%",
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:function(ctx){
              var label=ctx.label||"";
              var val=ctx.parsed||0;
              return label + ": " + formatInt(val) + " farmers";
            }
          }
        }
      },
      onClick: function(evt, elements){
        if(!elements || !elements.length) return;
        var idx=elements[0].index;
        var city = this.data.labels[idx];
        if(city){
          var citySel=document.getElementById("filter-city");
          citySel.value=city;
          rebuildSpotOptions();
          applyFilters();
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

function buildCitySummary(rows){
  var m={};
  rows.forEach(function(r){
    var c=r.city||"Unknown";
    if(!m[c]) m[c]={city:c, farmers:0, sessions:0, acres:0};
    m[c].farmers += (r.__farmers||0);
    m[c].acres += (r.__acres||0);
    m[c].sessions += 1;
  });
  var arr=Object.values(m).filter(function(x){ return x.city && x.city.toLowerCase()!=="multan"; });
  arr.sort(function(a,b){ return b.farmers-a.farmers; });
  return arr;
}

function updateCityDonut(rows){
  if(!cityDonut) return;

  var sum=buildCitySummary(rows);
  var labels=sum.map(function(s){return s.city;});
  var data=sum.map(function(s){return Math.round(s.farmers);});
  var colors=labels.map(cityColor);

  cityDonut.data.labels=labels;
  cityDonut.data.datasets[0].data=data;
  cityDonut.data.datasets[0].backgroundColor=colors;
  cityDonut.update();

  var total=data.reduce(function(a,b){return a+b;},0);
  setText("city-main", total ? formatInt(total) : "–");
}

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
        if(img.src.endsWith(".jpg") && c.img[1]){ img.src=c.img[1]; return; }
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

      function maybeRemove(){ if(tile.dataset.noimg==="1" && tile.dataset.novid==="1"){ tile.remove(); } }

      reel.appendChild(tile);
    });

    setTimeout(function(){
      if(!reel.children.length){
        var note=document.createElement("div");
        note.className="muted";
        note.style.fontWeight="1000";
        note.textContent="No media files found for this session (upload files like "+r.id+".jpg or "+r.id+"a.jpg).";
        block.appendChild(note);
      }
    }, 600);

    block.appendChild(reel);
    wrap.appendChild(block);
  });
}

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
