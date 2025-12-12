/****************************************************
 * Buctril Super Dashboard – Data Processor (RGN/City/Spot + Per-Session Media)
 * Expects files in SAME FOLDER as index.html:
 * - sum_sheet.csv
 * - tmp.mp4 (optional background)
 * Media naming per session row (Session ID):
 *   1a.jpg / 1a.jpeg / 1a.mp4 ... up to 1f.*
 *   2a.jpg ... 17f.mp4 etc.
 ****************************************************/

// ------------------------- Helpers -------------------------
function safeText(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function safeNumber(val) {
  if (val === null || val === undefined || val === "") return 0;
  // Handles "1,002", "45%", " 12.5 "
  var str = String(val).replace(/,/g, "").trim();
  var m = str.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  var n = parseFloat(m[0]);
  return isNaN(n) ? 0 : n;
}

function formatInt(n) {
  try { return Math.round(n).toLocaleString("en-US"); } catch { return String(n); }
}

function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showErrorModal(message) {
  var existing = document.querySelector(".error-modal");
  if (existing) existing.remove();

  var modal = document.createElement("div");
  modal.className = "error-modal";
  modal.innerHTML = "<p>" + message + "</p><button type='button'>Close</button>";
  document.body.appendChild(modal);
  var btn = modal.querySelector("button");
  if (btn) btn.addEventListener("click", function () { modal.remove(); });
}

function getField(row, candidates) {
  // candidates: array of possible column names
  for (var i = 0; i < candidates.length; i++) {
    var k = candidates[i];
    if (row.hasOwnProperty(k) && safeText(row[k]) !== "") return row[k];
  }
  // try case-insensitive match
  var keys = Object.keys(row);
  for (var j = 0; j < candidates.length; j++) {
    var want = candidates[j].toLowerCase();
    for (var t = 0; t < keys.length; t++) {
      if (keys[t].toLowerCase() === want && safeText(row[keys[t]]) !== "") return row[keys[t]];
    }
  }
  return "";
}

function normalizeCityName(s) {
  return safeText(s).replace(/\s+/g, " ").trim();
}

function isMultanStartPoint(r) {
  // Exclude "Multan" when it's not an engagement session.
  // Conservative rule: if city is Multan AND farmers & acres are zero -> drop.
  var city = normalizeCityName(r.city).toLowerCase();
  return city === "multan" && (r.__farmers === 0) && (r.__acres === 0);
}

function starsFromPct(pct) {
  var s = Math.max(0, Math.min(5, Math.round(pct / 20)));
  return "★".repeat(s) + "☆".repeat(5 - s);
}

// ------------------------- Global State -------------------------
var allRows = [];
var filteredRows = [];

var map = null;
var mapMarkers = [];

var clarityDonut = null;
var definiteDonut = null;
var adoptionChart = null;

// Media letters (a..f)
var MEDIA_LETTERS = ["a","b","c","d","e","f"];

// ------------------------- CSV Load + Parse -------------------------
function loadCSV() {
  var loadingEl = document.getElementById("loading-message");
  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error("sum_sheet.csv not found (" + res.status + ")");
      return res.text();
    })
    .then(function (csvText) {
      // Remove a "Summary..." first line if present
      var lines = csvText.split(/\r?\n/);
      if (lines.length > 0 && /^summary\b/i.test(lines[0].trim())) {
        lines.shift();
        csvText = lines.join("\n");
      }

      if (typeof Papa === "undefined") {
        throw new Error("PapaParse library not loaded (Papa is undefined).");
      }

      var parsed = Papa.parse(csvText, {
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
      });

      if (parsed.errors && parsed.errors.length) {
        console.error("CSV parse errors:", parsed.errors);
        showErrorModal("CSV parsing errors detected. Please verify your CSV formatting (commas inside fields must be quoted).");
      }

      allRows = (parsed.data || [])
        .map(function (row, idx) { return normalizeRow(row, idx); })
        .filter(function (r) { return r && r.__farmers > 0; }) // keep real sessions only
        .filter(function (r) { return !isMultanStartPoint(r); }); // remove Multan start point

      // Initial render
      initCharts();
      initFilters();
      applyFilters();

      if (loadingEl) loadingEl.remove();
    })
    .catch(function (err) {
      console.error(err);
      showErrorModal("Error loading data: " + err.message);
      if (loadingEl) loadingEl.remove();
    });
}

function normalizeRow(row, idx) {
  // Determine stable Session ID for media mapping
  var sid = safeText(getField(row, ["SN","Sr No","Sr. No","Session ID","SessionID","ID","Id","S#","S.No","S No"]));
  var sessionId = sid !== "" ? safeNumber(sid) : (idx + 1);

  var rgn = safeText(getField(row, ["RGN","Region","REGION","Rgn"]));
  var city = normalizeCityName(getField(row, ["City","To City","To","District","District/City"]));
  var fromCity = normalizeCityName(getField(row, ["From City","From","Starting City","Start City"]));
  var spot = normalizeCityName(getField(row, ["Session Location","Village / Mauza","Village/Mauza","Spot","Location","Venue","Mauza","Village"]));
  var dateStr = safeText(getField(row, ["Date","Activity Date","Day","Session Date"]));

  // numbers
  var farmers = safeNumber(getField(row, ["No of Farmer Participate","Farmers","Farmers Engaged","No of Farmers","No. of Farmers","No of farmer","Participants","Attendees"]));
  var acres = safeNumber(getField(row, ["Acres","Acres Covered","Total Acres"]));

  // campaign metrics
  var clarity = safeNumber(getField(row, ["Message Clarity %","Message Clarity","Clarity %","Clarity","Msg Clarity"]));
  var definite = safeNumber(getField(row, ["Definite Use %","Definite Use","Definite Use %","Use Intent %","Use Intent","Definite"]));
  var influencers = safeNumber(getField(row, ["Influencers","No of Influencers","Influencers Identified"]));
  var awareness = safeNumber(getField(row, ["Awareness %","Awareness","Awareness Rate"]));

  // geo
  var lat = safeNumber(getField(row, ["Latitude","Lat"]));
  var lon = safeNumber(getField(row, ["Longitude","Lng","Long","Lon"]));

  return {
    __raw: row,
    id: sessionId,              // displayed session id + used for media file prefixes
    rgn: rgn,
    city: city,
    from: fromCity,
    spot: spot,
    date: dateStr,

    __farmers: farmers,
    __acres: acres,

    __messageClarity: clarity,
    __definiteUseRate: definite,
    __influencers: influencers,
    __awarenessRate: awareness,

    latitude: lat,
    longitude: lon
  };
}

// ------------------------- Filters -------------------------
function initFilters() {
  var rgnSel = document.getElementById("filter-rgn");
  var citySel = document.getElementById("filter-city");
  var spotSel = document.getElementById("filter-spot");
  var searchEl = document.getElementById("filter-search");

  if (!rgnSel || !citySel || !spotSel) return;

  // Attach listeners
  rgnSel.addEventListener("change", function () {
    // When region changes, rebuild city/spot options to match region
    rebuildCityAndSpotOptions();
    applyFilters();
  });

  citySel.addEventListener("change", function () {
    // When city changes, rebuild spot options to match region+city
    rebuildSpotOptions();
    applyFilters();
  });

  spotSel.addEventListener("change", applyFilters);

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      // keep city/spot options but apply filtering live
      applyFilters();
    });
  }

  rebuildRegionOptions();
  rebuildCityAndSpotOptions();
}

function rebuildRegionOptions() {
  var rgnSel = document.getElementById("filter-rgn");
  if (!rgnSel) return;

  var current = rgnSel.value || "";
  rgnSel.innerHTML = "<option value=''>All Regions</option>";

  var set = new Set();
  allRows.forEach(function (r) {
    var v = safeText(r.rgn);
    if (v) set.add(v);
  });
  Array.from(set).sort().forEach(function (v) {
    var opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    rgnSel.appendChild(opt);
  });

  // restore selection if still present
  if (current) rgnSel.value = current;
}

function rebuildCityAndSpotOptions() {
  rebuildCityOptions();
  rebuildSpotOptions();
}

function rebuildCityOptions() {
  var rgnSel = document.getElementById("filter-rgn");
  var citySel = document.getElementById("filter-city");
  if (!citySel) return;

  var region = rgnSel ? (rgnSel.value || "") : "";
  var currentCity = citySel.value || "";

  citySel.innerHTML = "<option value=''>All Cities</option>";

  var set = new Set();
  allRows.forEach(function (r) {
    if (region && safeText(r.rgn) !== region) return;
    var c = safeText(r.city);
    if (!c) return;
    if (c.toLowerCase() === "multan") return; // extra safety
    set.add(c);
  });

  Array.from(set).sort().forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    citySel.appendChild(opt);
  });

  if (currentCity && Array.from(set).includes(currentCity)) {
    citySel.value = currentCity;
  } else {
    citySel.value = "";
  }
}

function rebuildSpotOptions() {
  var rgnSel = document.getElementById("filter-rgn");
  var citySel = document.getElementById("filter-city");
  var spotSel = document.getElementById("filter-spot");
  if (!spotSel) return;

  var region = rgnSel ? (rgnSel.value || "") : "";
  var city = citySel ? (citySel.value || "") : "";
  var currentSpot = spotSel.value || "";

  spotSel.innerHTML = "<option value=''>All Spots</option>";

  var set = new Set();
  allRows.forEach(function (r) {
    if (region && safeText(r.rgn) !== region) return;
    if (city && safeText(r.city) !== city) return;
    var s = safeText(r.spot);
    if (s) set.add(s);
  });

  Array.from(set).sort().forEach(function (s) {
    var opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    spotSel.appendChild(opt);
  });

  if (currentSpot && Array.from(set).includes(currentSpot)) {
    spotSel.value = currentSpot;
  } else {
    spotSel.value = "";
  }
}

function applyFilters() {
  var rgnVal = safeText(document.getElementById("filter-rgn")?.value);
  var cityVal = safeText(document.getElementById("filter-city")?.value);
  var spotVal = safeText(document.getElementById("filter-spot")?.value);
  var searchVal = safeText(document.getElementById("filter-search")?.value).toLowerCase();

  filteredRows = allRows.filter(function (r) {
    if (rgnVal && safeText(r.rgn) !== rgnVal) return false;
    if (cityVal && safeText(r.city) !== cityVal) return false;
    if (spotVal && safeText(r.spot) !== spotVal) return false;

    if (searchVal) {
      var hay = (safeText(r.rgn) + " " + safeText(r.city) + " " + safeText(r.spot) + " " + safeText(r.from)).toLowerCase();
      if (!hay.includes(searchVal)) return false;
    }
    return true;
  });

  // update UI
  updateMetrics(filteredRows);
  updateDonuts(filteredRows);
  updateAdoptionChart(filteredRows);
  updateSessionTable(filteredRows);
  updateMap(filteredRows);
  updateMediaGallery(filteredRows);
}

// ------------------------- Metrics + Donuts -------------------------
function updateMetrics(rows) {
  var totalSessions = rows.length;
  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var totalAcres = rows.reduce(function (s, r) { return s + (r.__acres || 0); }, 0);
  var uniqueCities = new Set(rows.map(function (r) { return r.city; }).filter(Boolean)).size;
  var uniqueDays = new Set(rows.map(function (r) { return r.date; }).filter(Boolean)).size;

  setText("metric-sessions", formatInt(totalSessions));
  setText("metric-farmers", formatInt(totalFarmers));
  setText("metric-acres", formatInt(totalAcres));
  setText("metric-cities", formatInt(uniqueCities));
  setText("metric-days", formatInt(uniqueDays));

  setText("hero-farmers", formatInt(totalFarmers));
  setText("hero-sessions", formatInt(totalSessions));

  // campaign metrics
  var avgClarity = 0, avgDef = 0, avgAware = 0, totalInfl = 0, defFarmers = 0;
  if (rows.length > 0) {
    avgClarity = rows.reduce(function (s, r) { return s + (r.__messageClarity || 0); }, 0) / rows.length;
    avgDef = rows.reduce(function (s, r) { return s + (r.__definiteUseRate || 0); }, 0) / rows.length;
    avgAware = rows.reduce(function (s, r) { return s + (r.__awarenessRate || 0); }, 0) / rows.length;
    totalInfl = rows.reduce(function (s, r) { return s + (r.__influencers || 0); }, 0);
    defFarmers = rows.reduce(function (s, r) {
      return s + Math.round((r.__farmers || 0) * (r.__definiteUseRate || 0) / 100);
    }, 0);
  }

  setText("metric-clarity", Math.round(avgClarity) + "%");
  setText("metric-definite", Math.round(avgDef) + "%");
  setText("metric-influencers", formatInt(totalInfl));
  setText("metric-awareness", Math.round(avgAware) + "%");

  var clarityBar = document.getElementById("clarity-progress");
  var defBar = document.getElementById("definite-progress");
  var inflBar = document.getElementById("influencers-progress");
  var awareBar = document.getElementById("awareness-progress");
  var stars = document.getElementById("clarity-stars");

  if (clarityBar) clarityBar.style.width = Math.max(0, Math.min(100, Math.round(avgClarity))) + "%";
  if (defBar) defBar.style.width = Math.max(0, Math.min(100, Math.round(avgDef))) + "%";
  if (awareBar) awareBar.style.width = Math.max(0, Math.min(100, Math.round(avgAware))) + "%";

  // influencers scale: dynamic max by current dataset to avoid always tiny bars
  var maxInfl = allRows.reduce(function (m, r) { return Math.max(m, r.__influencers || 0); }, 0) || 1;
  if (inflBar) inflBar.style.width = Math.round(Math.min(100, (totalInfl / (maxInfl * Math.max(1, rows.length / 3))) * 100)) + "%";

  if (stars) stars.textContent = starsFromPct(avgClarity);

  var adoptionText = document.getElementById("adoption-text");
  if (adoptionText) {
    var pct = totalFarmers > 0 ? Math.round((defFarmers / totalFarmers) * 100) : Math.round(avgDef);
    adoptionText.textContent = "Estimated definite-use farmers: " + formatInt(defFarmers) + " (" + pct + "%)";
  }
}

function updateDonuts(rows) {
  if (!clarityDonut || !definiteDonut) return;

  var avgClarity = 0, avgDef = 0;
  if (rows.length > 0) {
    avgClarity = rows.reduce(function (s, r) { return s + (r.__messageClarity || 0); }, 0) / rows.length;
    avgDef = rows.reduce(function (s, r) { return s + (r.__definiteUseRate || 0); }, 0) / rows.length;
  }
  avgClarity = Math.max(0, Math.min(100, avgClarity));
  avgDef = Math.max(0, Math.min(100, avgDef));

  clarityDonut.data.datasets[0].data = [avgClarity, 100 - avgClarity];
  definiteDonut.data.datasets[0].data = [avgDef, 100 - avgDef];

  clarityDonut.update();
  definiteDonut.update();

  setText("clarity-main", Math.round(avgClarity) + "%");
  setText("definite-main", Math.round(avgDef) + "%");
}

// ------------------------- Charts -------------------------
function initCharts() {
  // Donuts
  var ctx1 = document.getElementById("clarityDonut");
  var ctx2 = document.getElementById("definiteDonut");
  if (!ctx1 || !ctx2) return;

  clarityDonut = new Chart(ctx1, {
    type: "doughnut",
    data: {
      labels: ["Clarity", "Remaining"],
      datasets: [{
        data: [0, 100],
        backgroundColor: ["#66bb6a", "#e0e0e0"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "80%",
      plugins: { legend: { display: false }, tooltip: { enabled: true } }
    }
  });

  definiteDonut = new Chart(ctx2, {
    type: "doughnut",
    data: {
      labels: ["Definite Use", "Remaining"],
      datasets: [{
        data: [0, 100],
        backgroundColor: ["#ff7043", "#e0e0e0"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "80%",
      plugins: { legend: { display: false }, tooltip: { enabled: true } }
    }
  });

  // Adoption bar
  var ctx3 = document.getElementById("adoptionChart");
  if (ctx3) {
    adoptionChart = new Chart(ctx3, {
      type: "bar",
      data: {
        labels: ["Total Farmers", "Estimated Definite-use"],
        datasets: [{
          label: "Farmers",
          data: [0, 0],
          backgroundColor: ["#90caf9", "#66bb6a"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return formatInt(v); } } } }
      }
    });
  }
}

function updateAdoptionChart(rows) {
  if (!adoptionChart) return;

  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var defFarmers = rows.reduce(function (s, r) {
    return s + Math.round((r.__farmers || 0) * (r.__definiteUseRate || 0) / 100);
  }, 0);

  adoptionChart.data.datasets[0].data = [totalFarmers, defFarmers];
  adoptionChart.update();
}

// ------------------------- Session Table -------------------------
function updateSessionTable(rows) {
  var tbody = document.getElementById("session-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  rows.forEach(function (r) {
    var tr = document.createElement("tr");
    function td(v){ var x=document.createElement("td"); x.textContent=v; return x; }

    tr.appendChild(td(String(r.id)));
    tr.appendChild(td(r.date || ""));
    tr.appendChild(td(r.rgn || ""));
    tr.appendChild(td(r.city || ""));
    tr.appendChild(td(r.spot || ""));
    tr.appendChild(td(formatInt(r.__farmers || 0)));
    tr.appendChild(td(formatInt(r.__acres || 0)));
    tr.appendChild(td((Math.round(r.__messageClarity || 0)) + "%"));
    tr.appendChild(td((Math.round(r.__definiteUseRate || 0)) + "%"));
    tr.appendChild(td(formatInt(r.__influencers || 0)));

    tbody.appendChild(tr);
  });
}

// ------------------------- Map -------------------------
function ensureMap() {
  var container = document.getElementById("route-map");
  if (!container) return;

  if (!map) {
    map = L.map("route-map").setView([30.3753, 69.3451], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }
}

function updateMap(rows) {
  ensureMap();
  if (!map) return;

  // clear old
  mapMarkers.forEach(function (m) { try { map.removeLayer(m); } catch(e){} });
  mapMarkers = [];

  var bounds = [];
  rows.forEach(function (r) {
    if (!r.latitude || !r.longitude) return;
    if (r.latitude === 0 || r.longitude === 0) return;

    var coords = [r.latitude, r.longitude];
    bounds.push(coords);

    var html = "<strong>" + (r.spot || r.city || "Session") + "</strong><br/>" +
      "RGN: " + (r.rgn || "—") + "<br/>" +
      "City: " + (r.city || "—") + "<br/>" +
      "Date: " + (r.date || "—") + "<br/>" +
      "Farmers: " + formatInt(r.__farmers || 0) + "<br/>" +
      "Acres: " + formatInt(r.__acres || 0);

    var marker = L.marker(coords).addTo(map).bindPopup(html);
    mapMarkers.push(marker);
  });

  if (bounds.length) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [22, 22] });
  }
  // if no bounds, keep current view
}

// ------------------------- Media (per session row) -------------------------
function updateMediaGallery(rows) {
  var container = document.getElementById("media-gallery");
  if (!container) return;

  container.innerHTML = "";

  if (!rows.length) {
    var empty = document.createElement("div");
    empty.className = "muted";
    empty.style.fontWeight = "800";
    empty.textContent = "No sessions match your current filters.";
    container.appendChild(empty);
    return;
  }

  rows.forEach(function (r) {
    var group = document.createElement("div");
    group.className = "session-group";

    var head = document.createElement("div");
    head.className = "session-head";
    head.innerHTML =
      "<div><strong>Session " + r.id + "</strong> — " + (r.city || "") + (r.spot ? (" • " + r.spot) : "") + "</div>" +
      "<div class='session-meta'>" + (r.date || "") + "</div>";
    group.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "media-gallery";

    // Create placeholders for a..f; hide if missing
    MEDIA_LETTERS.forEach(function (letter) {
      var prefix = String(r.id) + letter;

      var imgSrcJpg = prefix + ".jpg";
      var imgSrcJpeg = prefix + ".jpeg";
      var vidSrc = prefix + ".mp4";

      // Card uses img as thumb, video on hover. We try jpg first, then jpeg if jpg fails.
      var card = document.createElement("div");
      card.className = "media-card";

      var thumb = document.createElement("div");
      thumb.className = "thumb";

      var img = document.createElement("img");
      img.alt = "Session " + r.id + " (" + letter + ")";
      img.src = imgSrcJpg;
      img.onerror = function () {
        // fallback to jpeg
        if (img.src.endsWith(".jpg")) {
          img.src = imgSrcJpeg;
          return;
        }
        // if jpeg also fails, hide entire card (unless video exists later)
        card.dataset.noimg = "1";
        maybeHideCard();
      };

      var video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "none";
      video.style.display = "none";
      video.src = vidSrc;
      video.addEventListener("error", function () {
        card.dataset.novid = "1";
        maybeHideCard();
      });

      var badge = document.createElement("div");
      badge.className = "play-badge";
      badge.innerHTML = "<i class='fas fa-play'></i>";

      thumb.appendChild(img);
      thumb.appendChild(video);
      thumb.appendChild(badge);

      var cap = document.createElement("div");
      cap.className = "caption";
      cap.innerHTML =
        "<div class='t'>Media " + String(r.id) + letter + "</div>" +
        "<div class='s'>" + (r.city || "") + (r.spot ? (" • " + r.spot) : "") + "</div>";

      card.appendChild(thumb);
      card.appendChild(cap);

      // Hover play/pause (best-effort)
      card.addEventListener("mouseenter", function () {
        if (video && video.src) { try { video.play(); } catch(e){} }
      });
      card.addEventListener("mouseleave", function () {
        if (video) { try { video.pause(); } catch(e){} }
      });

      card.addEventListener("click", function () {
        openLightbox(img, video);
      });

      function maybeHideCard() {
        // Hide if BOTH image and video missing
        if (card.dataset.noimg === "1" && card.dataset.novid === "1") {
          card.remove();
        }
      }

      grid.appendChild(card);
    });

    group.appendChild(grid);
    container.appendChild(group);
  });
}

// ------------------------- Lightbox -------------------------
function openLightbox(imgEl, videoEl) {
  var lb = document.getElementById("lightbox");
  var lbImg = document.getElementById("lb-img");
  var lbVid = document.getElementById("lb-video");
  if (!lb || !lbImg || !lbVid) return;

  lb.classList.add("active");

  // Default: show video if it exists and is likely valid; fall back to image
  var vidSrc = videoEl ? safeText(videoEl.src) : "";
  var imgSrc = imgEl ? safeText(imgEl.src) : "";

  lbVid.pause();
  lbVid.removeAttribute("src");
  lbVid.load();

  lbImg.style.display = "none";
  lbVid.style.display = "none";

  if (vidSrc) {
    lbVid.src = vidSrc;
    lbVid.style.display = "block";
    lbVid.load();
    var p = lbVid.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
    // If video fails, fall back to image
    lbVid.onerror = function () {
      lbVid.style.display = "none";
      if (imgSrc) {
        lbImg.src = imgSrc;
        lbImg.style.display = "block";
      }
    };
  } else if (imgSrc) {
    lbImg.src = imgSrc;
    lbImg.style.display = "block";
  }
}

function closeLightbox() {
  var lb = document.getElementById("lightbox");
  var lbVid = document.getElementById("lb-video");
  if (lb) lb.classList.remove("active");
  if (lbVid) { try { lbVid.pause(); } catch(e){} }
}

// ------------------------- Boot -------------------------
document.addEventListener("DOMContentLoaded", function () {
  loadCSV();

  var lb = document.getElementById("lightbox");
  if (lb) {
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.closest("#lb-close")) closeLightbox();
    });
  }
});
