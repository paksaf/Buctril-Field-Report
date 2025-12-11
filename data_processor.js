// =========================
//  GLOBAL STATE + HELPERS
// =========================

var allRows = [];
var filteredRows = [];
var uniqueDates = [];
var citySummary = [];
var colMap = {};            // will be filled from CSV headers
var map = null;
var mapMarkers = [];
var clarityChart = null;
var cityFarmersChart = null;

function safeNumber(val) {
  if (val === null || val === undefined) return 0;
  var n = parseFloat(String(val).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatInt(value) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return Math.round(value).toLocaleString("en-PK");
}

function formatFloat(value, decimals) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  var d = decimals === undefined ? 1 : decimals;
  return value.toFixed(d);
}

function showErrorModal(message) {
  var existing = document.querySelector(".error-modal");
  if (existing) existing.remove();

  var modal = document.createElement("div");
  modal.className = "error-modal";
  modal.innerHTML =
    "<p>" + message + "</p><button type='button'>Close</button>";
  document.body.appendChild(modal);
  var btn = modal.querySelector("button");
  if (btn) btn.addEventListener("click", function () { modal.remove(); });
}

// =========================
//  DATE HANDLING
// =========================

function parseDate(value) {
  if (!value) return null;
  var v = String(value).trim();

  // Try native parsing first
  var parsed = Date.parse(v);
  if (!isNaN(parsed)) return new Date(parsed);

  // Fallback like 23-Nov-25, 23/Nov/2025, 23-11-25, etc.
  var m = v.match(/^(\d{1,2})[-\/](\w+)[-\/](\d{2,4})$/i);
  if (!m) return null;

  var day = parseInt(m[1], 10);
  var monStr = m[2].toLowerCase();
  var yearStr = m[3];
  var months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    "1": 0, "01": 0, "2": 1, "02": 1, "3": 2, "03": 2,
    "4": 3, "04": 3, "5": 4, "05": 4, "6": 5, "06": 5,
    "7": 6, "07": 6, "8": 7, "08": 7, "9": 8, "09": 8,
    "10": 9, "11": 10, "12": 11
  };

  if (!months.hasOwnProperty(monStr)) return null;

  var year = parseInt(yearStr, 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;

  return new Date(year, months[monStr], day);
}

function preProcessDates(rows) {
  uniqueDates = [];
  rows.forEach(function (row) {
    var dateStr = row[colMap.date] || row["Date"] || row["date"] || "";
    var d = parseDate(dateStr);
    row.__date_raw = dateStr;
    row.__date = d;
    if (d && !uniqueDates.find(function (x) { return x.getTime() === d.getTime(); })) {
      uniqueDates.push(d);
    }
  });
  uniqueDates.sort(function (a, b) { return a - b; });

  if (uniqueDates.length) {
    var start = uniqueDates[0].toISOString().slice(0, 10);
    var end = uniqueDates[uniqueDates.length - 1].toISOString().slice(0, 10);
    setText("hero-date-range", start + " → " + end);
  }
}

// =========================
//  COLUMN DETECTION
// =========================

function findField(fields, patterns) {
  var lowered = fields.map(function (f) { return f.toLowerCase(); });
  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i].toLowerCase();
    for (var j = 0; j < lowered.length; j++) {
      var field = lowered[j];
      if (field === p || field.indexOf(p) !== -1) {
        return fields[j]; // return original name
      }
    }
  }
  return null;
}

function detectColumns(fields) {
  // fields: array of header strings
  colMap = {};

  colMap.sn = findField(fields, ["sn", "s.no", "sr", "serial", "id"]);
  colMap.date = findField(fields, ["date", "session date"]);
  colMap.fromCity = findField(fields, ["from city", "start city", "from"]);
  colMap.toCity = findField(fields, ["to city", "destination", "to"]);
  colMap.village = findField(
    fields,
    ["village", "session location", "location", "village / location", "spot"]
  );
  colMap.farmers = findField(
    fields,
    ["total farmers", "farmers reached", "no of farmers", "no. of farmers", "farmers"]
  );
  colMap.acres = findField(
    fields,
    ["total acres", "acres", "wheat acres", "area (acre)", "acres (approx)"]
  );
  colMap.lat = findField(fields, ["latitude", "lat"]);
  colMap.lng = findField(fields, ["longitude", "lon", "lng"]);
  colMap.feedback = findField(
    fields,
    ["feedback/observations", "feedback", "remarks", "observations"]
  );

  // Defensive fallbacks – if something is still null, pick a sane default if present
  colMap.date = colMap.date || "Date";
  colMap.farmers = colMap.farmers || "Farmers";
  colMap.acres = colMap.acres || "Acres";
}

// Normalize each row: trim keys/values and add computed fields
function normalizeRow(rawRow, index) {
  var row = {};
  Object.keys(rawRow).forEach(function (k) {
    var key = (k || "").trim();
    var val = rawRow[k];
    if (typeof val === "string") val = val.trim();
    row[key] = val;
  });

  var sn = colMap.sn ? row[colMap.sn] : null;
  if (!sn) sn = index + 1;

  var farmers = safeNumber(colMap.farmers ? row[colMap.farmers] : row["Farmers"]);
  var acres = safeNumber(colMap.acres ? row[colMap.acres] : row["Acres"]);

  row.__sn = sn;
  row.__farmers = farmers;
  row.__acres = acres;

  return row;
}

// =========================
//  CSV LOAD
// =========================

function loadCSV() {
  var loadingEl = document.getElementById("loading-message");

  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(function (resp) {
      if (!resp.ok) throw new Error("Failed to load CSV: " + resp.status);
      return resp.text();
    })
    .then(function (text) {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: function (result) {
          try {
            var rows = result.data || [];
            if (!rows.length) throw new Error("CSV has no data rows.");

            // Detect columns using headers from meta or first row
            var fields = result.meta && result.meta.fields && result.meta.fields.length
              ? result.meta.fields.slice()
              : Object.keys(rows[0]);

            detectColumns(fields);

            allRows = rows.map(function (r, idx) {
              return normalizeRow(r, idx);
            });

            preProcessDates(allRows);
            populateFilterOptions(allRows);
            applyFilters();

            if (loadingEl) {
              var spinner = document.getElementById("spinner");
              if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
              loadingEl.textContent =
                "Data loaded from sum_sheet.csv – filters are now active.";
            }
          } catch (e) {
            console.error("Post-parse error:", e);
            if (loadingEl) loadingEl.textContent = "Error processing data.";
            showErrorModal("CSV loaded but could not be processed: " + e.message);
          }
        },
        error: function (err) {
          console.error("CSV parse error:", err);
          if (loadingEl) loadingEl.textContent = "Error parsing data.";
          showErrorModal("Could not parse sum_sheet.csv. Please confirm the file format.");
        }
      });
    })
    .catch(function (err) {
      console.error("CSV fetch error:", err);
      if (loadingEl) loadingEl.textContent = "Error loading data.";
      showErrorModal("Could not load sum_sheet.csv. Make sure it is in the same folder as index.html.");
    });
}

// =========================
//  FILTERS
// =========================

function populateFilterOptions(rows) {
  var cityEl = document.getElementById("from-city-filter");
  if (!cityEl) return;

  var citiesSet = new Set();
  rows.forEach(function (row) {
    var c = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      c = String(row[colMap.fromCity]).trim();
    } else {
      c = String(row["From City"] || row["From"] || "").trim();
    }
    if (c) citiesSet.add(c);
  });

  var cities = Array.from(citiesSet).sort(function (a, b) {
    return a.localeCompare(b);
  });

  // Keep the first "All" option, remove others
  while (cityEl.options.length > 1) cityEl.remove(1);
  cities.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    cityEl.appendChild(opt);
  });
}

function resetFilters() {
  var s = document.getElementById("start-date");
  var e = document.getElementById("end-date");
  var c = document.getElementById("from-city-filter");
  if (s) s.value = "";
  if (e) e.value = "";
  if (c) c.value = "";
  applyFilters();
}

function applyFilters() {
  if (!allRows.length) return;

  var startEl = document.getElementById("start-date");
  var endEl = document.getElementById("end-date");
  var cityEl = document.getElementById("from-city-filter");

  var startDate = startEl && startEl.value ? new Date(startEl.value + "T00:00:00") : null;
  var endDate = endEl && endEl.value ? new Date(endEl.value + "T23:59:59") : null;
  var cityFilter = cityEl && cityEl.value ? cityEl.value.trim().toLowerCase() : "";

  filteredRows = allRows.filter(function (row) {
    var d = row.__date;
    if (startDate && (!d || d < startDate)) return false;
    if (endDate && (!d || d > endDate)) return false;

    if (cityFilter) {
      var fromCity = "";
      if (colMap.fromCity && row[colMap.fromCity]) {
        fromCity = String(row[colMap.fromCity]).toLowerCase();
      } else {
        fromCity = String(row["From City"] || row["From"] || "").toLowerCase();
      }
      if (!fromCity.includes(cityFilter)) return false;
    }
    return true;
  });

  buildCitySummary(filteredRows);
  updateHeroAndSnapshot(filteredRows);
  updateKeyMetrics(filteredRows);
  updateSessionTable(filteredRows);
  updateCityTable();
  updateCharts();
  initMap(filteredRows);
  initMediaGallery(filteredRows);
}

// =========================
//  SUMMARY BUILDERS
// =========================

function buildCitySummary(rows) {
  var mapByCity = new Map();

  rows.forEach(function (row) {
    var city = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      city = String(row[colMap.fromCity]).trim();
    } else {
      city = String(row["From City"] || row["From"] || "Unknown").trim() || "Unknown";
    }

    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;

    if (!mapByCity.has(city)) {
      mapByCity.set(city, { city: city, sessions: 0, farmers: 0, acres: 0 });
    }
    var item = mapByCity.get(city);
    item.sessions += 1;
    item.farmers += farmers;
    item.acres += acres;
  });

  citySummary = Array.from(mapByCity.values()).sort(function (a, b) {
    return b.farmers - a.farmers;
  });
}

function updateHeroAndSnapshot(rows) {
  var totalSessions = rows.length;
  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var totalAcres = rows.reduce(function (s, r) { return s + (r.__acres || 0); }, 0);

  setText("hero-sessions", formatInt(totalSessions));
  setText("hero-farmers", formatInt(totalFarmers));
  setText("hero-acres", formatInt(totalAcres));

  setText("metric-sessions-hero", formatInt(totalSessions));
  setText("metric-farmers-hero", formatInt(totalFarmers));
  setText("metric-acres-hero", formatInt(totalAcres));

  setText("snap-sessions", formatInt(totalSessions));
  setText("snap-farmers", formatInt(totalFarmers));
  setText("snap-acres", formatInt(totalAcres));

  // distinct cities + villages
  var cities = new Set();
  var villages = new Set();
  rows.forEach(function (row) {
    var c = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      c = String(row[colMap.fromCity]).trim();
    } else {
      c = String(row["From City"] || row["From"] || "").trim();
    }

    var v = "";
    if (colMap.village && row[colMap.village]) {
      v = String(row[colMap.village]).trim();
    } else {
      v = String(row["Village"] || row["Session Location"] || row["Location"] || "").trim();
    }

    if (c) cities.add(c);
    if (v) villages.add(v);
  });

  setText("snap-locations", cities.size + " cities / " + villages.size + " villages");
}

function updateKeyMetrics(rows) {
  var totalSessions = rows.length;
  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var totalAcres = rows.reduce(function (s, r) { return s + (r.__acres || 0); }, 0);

  setText("metric-total-sessions", formatInt(totalSessions));
  setText("metric-total-farmers", formatInt(totalFarmers));
  setText(
    "metric-farmers-per-session",
    totalSessions ? formatFloat(totalFarmers / totalSessions, 1) : "–"
  );
  setText("metric-total-acres", formatInt(totalAcres));
  setText(
    "metric-acres-per-session",
    totalSessions ? formatFloat(totalAcres / totalSessions, 1) : "–"
  );

  var cities = new Set();
  var villages = new Set();
  var sessionsWithCoords = 0;

  rows.forEach(function (row) {
    var c = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      c = String(row[colMap.fromCity]).trim();
    } else {
      c = String(row["From City"] || row["From"] || "").trim();
    }

    var v = "";
    if (colMap.village && row[colMap.village]) {
      v = String(row[colMap.village]).trim();
    } else {
      v = String(row["Village"] || row["Session Location"] || row["Location"] || "").trim();
    }

    if (c) cities.add(c);
    if (v) villages.add(v);

    var lat = safeNumber(colMap.lat ? row[colMap.lat] : row["Latitude"]);
    var lng = safeNumber(colMap.lng ? row[colMap.lng] : row["Longitude"]);
    if (lat !== 0 && lng !== 0) sessionsWithCoords += 1;
  });

  setText("metric-cities", cities.size || "–");
  setText("metric-villages", villages.size || "–");
  setText("metric-sessions-with-coords", sessionsWithCoords || "–");
  setText(
    "metric-coverage",
    (cities.size || 0) + " cities • " + (villages.size || 0) + " villages"
  );
}

// =========================
//  TABLES
// =========================

function getMediaIndexForDate(date) {
  if (!date) return "";
  var idx = uniqueDates.findIndex(function (d) { return d.getTime() === date.getTime(); });
  return idx >= 0 ? idx + 1 : "";
}

function updateSessionTable(rows) {
  var tbody = document.getElementById("session-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  rows.forEach(function (row) {
    var tr = document.createElement("tr");

    var d = row.__date ? row.__date.toISOString().slice(0, 10) : (row.__date_raw || "");

    var fromCity = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      fromCity = String(row[colMap.fromCity]);
    } else {
      fromCity = String(row["From City"] || row["From"] || "");
    }

    var toCity = "";
    if (colMap.toCity && row[colMap.toCity]) {
      toCity = String(row[colMap.toCity]);
    } else {
      toCity = String(row["To City"] || row["To"] || "");
    }

    var loc = "";
    if (colMap.village && row[colMap.village]) {
      loc = String(row[colMap.village]);
    } else {
      loc = String(row["Village"] || row["Session Location"] || row["Location"] || "");
    }

    var farmers = row.__farmers || "";
    var acres = row.__acres || "";

    var lat = safeNumber(colMap.lat ? row[colMap.lat] : row["Latitude"]);
    var lng = safeNumber(colMap.lng ? row[colMap.lng] : row["Longitude"]);
    var coords = (lat && lng) ? (lat + ", " + lng) : "";

    var feedback = "";
    if (colMap.feedback && row[colMap.feedback]) {
      feedback = String(row[colMap.feedback]);
    } else {
      feedback = String(row["Feedback/Observations"] || row["Feedback"] || row["Observations"] || "");
    }

    var mediaIndex = row.__date ? getMediaIndexForDate(row.__date) : "";

    tr.innerHTML =
      "<td>" + (row.__sn || "") + "</td>" +
      "<td>" + d + "</td>" +
      "<td>" + fromCity + "</td>" +
      "<td>" + toCity + "</td>" +
      "<td>" + loc + "</td>" +
      "<td>" + farmers + "</td>" +
      "<td>" + acres + "</td>" +
      "<td>" + coords + "</td>" +
      "<td>" + feedback + "</td>" +
      "<td>" + mediaIndex + "</td>";
    tbody.appendChild(tr);
  });
}

function updateCityTable() {
  var tbody = document.getElementById("city-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  citySummary.forEach(function (row, i) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + (i + 1) + "</td>" +
      "<td>" + row.city + "</td>" +
      "<td>" + row.sessions + "</td>" +
      "<td>" + formatInt(row.farmers) + "</td>" +
      "<td>" + formatInt(row.acres) + "</td>";
    tbody.appendChild(tr);
  });
}

// =========================
//  CHARTS
// =========================

function initChartsIfNeeded() {
  var clarityCtx = document.getElementById("clarityDonut");
  var cityCtx = document.getElementById("cityFarmersChart");

  if (clarityCtx && !clarityChart) {
    clarityChart = new Chart(clarityCtx, {
      type: "doughnut",
      data: {
        labels: ["Clarity", "Gap"],
        datasets: [{
          data: [97, 3],
          backgroundColor: ["#66bb6a", "#e0e0e0"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: "70%",
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
  }

  if (cityCtx && !cityFarmersChart) {
    cityFarmersChart = new Chart(cityCtx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Farmers",
          data: [],
          backgroundColor: "#66bb6a"
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { autoSkip: false }, grid: { display: false } },
          y: { beginAtZero: true }
        }
      }
    });
  }
}

function updateCharts() {
  initChartsIfNeeded();
  if (cityFarmersChart && citySummary.length) {
    var top = citySummary.slice(0, 6);
    var others = citySummary.slice(6);
    var labels = top.map(function (c) { return c.city; });
    var data = top.map(function (c) { return c.farmers; });
    if (others.length) {
      labels.push("Others");
      data.push(
        others.reduce(function (s, c) { return s + c.farmers; }, 0)
      );
    }
    cityFarmersChart.data.labels = labels;
    cityFarmersChart.data.datasets[0].data = data;
    cityFarmersChart.update();
  }
}

// =========================
//  MAP
// =========================

function initMap(rows) {
  var mapEl = document.getElementById("route-map");
  if (!mapEl) return;

  if (!map) {
    map = L.map("route-map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
  }

  mapMarkers.forEach(function (mk) { mk.remove(); });
  mapMarkers = [];
  var coords = [];

  rows.forEach(function (row) {
    var lat = safeNumber(colMap.lat ? row[colMap.lat] : row["Latitude"]);
    var lng = safeNumber(colMap.lng ? row[colMap.lng] : row["Longitude"]);
    if (!lat || !lng) return;

    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;

    var loc = "";
    if (colMap.village && row[colMap.village]) {
      loc = String(row[colMap.village]);
    } else {
      loc = String(row["Village"] || row["Session Location"] || row["Location"] || "Session");
    }

    var fromCity = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      fromCity = String(row[colMap.fromCity]);
    } else {
      fromCity = String(row["From City"] || row["From"] || "");
    }

    var radius = Math.max(4, Math.min(18, acres / 200));
    var popup =
      "<strong>" + loc + "</strong><br/>" +
      "From: " + fromCity + "<br/>" +
      "Farmers: " + farmers + "<br/>" +
      "Acres: " + acres;

    var circle = L.circleMarker([lat, lng], {
      radius: radius,
      color: "#2e7d32",
      fillColor: "#66bb6a",
      fillOpacity: 0.7
    }).addTo(map);

    circle.bindPopup(popup);
    mapMarkers.push(circle);
    coords.push([lat, lng]);
  });

  if (coords.length) {
    var bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// =========================
//  MEDIA GALLERY
// =========================

function initMediaGallery(rows) {
  var gallery = document.getElementById("media-gallery");
  if (!gallery) return;
  gallery.innerHTML = "";

  // Map each unique date to index 1..N
  var dateToIndex = new Map();
  uniqueDates.forEach(function (d, idx) {
    dateToIndex.set(d.getTime(), idx + 1);
  });

  // For current filtered rows, pick one row per date
  var byTime = new Map();
  rows.forEach(function (row) {
    var d = row.__date;
    if (!d) return;
    var t = d.getTime();
    if (!byTime.has(t)) byTime.set(t, row);
  });

  var times = Array.from(byTime.keys()).sort(function (a, b) { return a - b; });

  times.forEach(function (t) {
    var row = byTime.get(t);
    var d = new Date(t);
    var idx = dateToIndex.get(t) || 0;
    if (!idx) return;

    var imgSrc = idx + ".jpeg";
    var vidSrc = idx + ".mp4";

    var loc = "";
    if (colMap.village && row[colMap.village]) {
      loc = String(row[colMap.village]);
    } else {
      loc = String(row["Village"] || row["Session Location"] || row["Location"] || "");
    }

    var city = "";
    if (colMap.fromCity && row[colMap.fromCity]) {
      city = String(row[colMap.fromCity]);
    } else {
      city = String(row["From City"] || row["From"] || "");
    }

    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;

    var card = document.createElement("div");
    card.className = "media-card";
    card.innerHTML =
      "<div class='media-thumb-wrap hover-video'>" +
      "<img src='" + imgSrc + "' alt='Session photo " + idx + "' onerror=\"this.style.display='none';\" />" +
      "<video muted loop playsinline onerror=\"this.style.display='none';\">" +
      "<source src='" + vidSrc + "' type='video/mp4' />" +
      "</video></div>" +
      "<div class='media-caption'>" +
      "<strong>" + (loc || "Session " + idx) + "</strong>" +
      "<span>" + city + " • " + farmers + " farmers • " + acres + " acres</span>" +
      "<span>" + d.toISOString().slice(0, 10) + "</span>" +
      "</div>";

    card.addEventListener("click", function () {
      openLightbox(imgSrc, vidSrc);
    });
    gallery.appendChild(card);
  });
}

function openLightbox(imgSrc, vidSrc) {
  var lb = document.getElementById("lightbox");
  var img = document.getElementById("lb-img");
  var vid = document.getElementById("lb-video");
  if (!lb || !img || !vid) return;

  img.src = imgSrc;
  vid.src = vidSrc;
  vid.load();
  lb.classList.add("active");

  lb.onclick = function () {
    lb.classList.remove("active");
    img.src = "";
    vid.pause();
    vid.src = "";
  };
}

// =========================
//  INIT
// =========================

document.addEventListener("DOMContentLoaded", function () {
  // CSV + dashboards
  loadCSV();
  initChartsIfNeeded();
});
