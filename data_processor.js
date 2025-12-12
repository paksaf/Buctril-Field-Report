/****************************************************
 * Buctril Field Report – Data Processor
 * Expects files in SAME FOLDER as index.html:
 *   - sum_sheet.csv
 *   - 1.jpeg, 1.mp4, 2.jpeg, 2.mp4, ...
 ****************************************************/

// ---------- BASIC HELPERS ----------
function safeNumber(val) {
  if (val === null || val === undefined) return 0;
  var n = parseFloat(String(val).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
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
  modal.innerHTML =
    "<p>" + message + "</p><button type='button'>Close</button>";
  document.body.appendChild(modal);
  var btn = modal.querySelector("button");
  if (btn) btn.addEventListener("click", function () { modal.remove(); });
}

// ---------- GLOBAL STATE ----------
var allRows = [];
var filteredRows = [];
var uniqueDates = [];
var citySummary = [];
var map = null;
var mapMarkers = [];
var clarityChart = null;
var definiteChart = null;
var cityFarmersChart = null;
var adoptionChart = null;

// ---------- CSV LOAD ----------
function loadCSV() {
  var loadingEl = document.getElementById("loading-message");

  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(function (resp) {
      if (!resp.ok) throw new Error("Failed to load CSV: " + resp.status);
      return resp.text();
    })
    .then(function (text) {
      Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        complete: function (result) {
          try {
            var rows = result.data || [];
            if (!rows.length) {
              if (loadingEl) loadingEl.textContent = "No data found in sum_sheet.csv.";
              showErrorModal("sum_sheet.csv appears to be empty.");
              return;
            }

            // 1) Drop the first BOM + Summary line
            if (rows.length && rows[0].length) {
              var firstCell = rows[0][0] || "";
              var norm = String(firstCell)
                .replace(/^\uFEFF/, "") // remove BOM
                .trim()
                .toLowerCase();
              if (norm === "summary") {
                rows.shift();
              }
            }

            if (!rows.length) {
              if (loadingEl) loadingEl.textContent = "No usable rows in sum_sheet.csv.";
              showErrorModal("sum_sheet.csv does not contain any detail rows.");
              return;
            }

            // 2) Next row is the real header row (SN, From City, City, Date, ...)
            var headerRow = rows.shift();
            var headers = headerRow.map(function (h) {
              if (h === null || h === undefined) return "";
              return String(h).replace(/^\uFEFF/, "").trim();
            });

            // 3) Turn remaining rows into objects keyed by the headers
            allRows = rows.map(function (r, idx) {
              var obj = {};
              headers.forEach(function (h, colIdx) {
                if (!h) return; // ignore blank header cells
                obj[h] = r[colIdx];
              });
              return normalizeRow(obj, idx);
            });

            preProcessDates(allRows);
            populateFilterOptions(allRows);
            applyFilters(); // initial render

            if (loadingEl) {
              var spinner = document.getElementById("spinner");
              if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
              loadingEl.textContent = "Data loaded from sum_sheet.csv – filters are now active.";
            }
          } catch (e) {
            console.error("Processing error:", e);
            if (loadingEl) loadingEl.textContent = "Error processing data.";
            showErrorModal("Error processing sum_sheet.csv – please check file format.");
          }
        },
        error: function (err) {
          console.error("CSV parse error:", err);
          if (loadingEl) loadingEl.textContent = "Error loading data.";
          showErrorModal("Could not parse sum_sheet.csv. Please confirm file format.");
        }
      });
    })
    .catch(function (err) {
      console.error("CSV fetch error:", err);
      if (loadingEl) loadingEl.textContent = "Error loading data.";
      showErrorModal("Could not load sum_sheet.csv. Please confirm it is in the same folder as index.html.");
    });
}

// Normalize each row, trim keys/values, and compute helper fields
function normalizeRow(row, index) {
  var obj = {};
  Object.keys(row).forEach(function (k) {
    var key = (k || "").trim();
    var val = row[k];
    if (typeof val === "string") val = val.trim();
    obj[key] = val;
  });

  // Farmers (be liberal with header names)
  var farmers = safeNumber(
    obj["Total Farmers"] ||
      obj["Farmers"] ||
      obj["No of Farmer Participate"] ||
      obj["No of Farmers"] ||
      obj["No. of Farmers"] ||
      obj["Farmers Engaged"] ||
      obj["Farmers engaged"] ||
      obj["farmers"]
  );

  // Acres (be liberal with header names)
  var acres = safeNumber(
    obj["Total Wheat Acres"] ||
      obj["Estimated Buctril Acres from this Session"] ||
      obj["Wheat acres (approx.)"] ||
      obj["Wheat acres"] ||
      obj["Total Acres"] ||
      obj["Acres"] ||
      obj["acres"]
  );

  // Campaign / perception metrics (optional columns)
  var clarity = safeNumber(
    obj["Message Clarity %"] ||
      obj["Message Clarity"] ||
      obj["Clarity %"] ||
      obj["Clarity"] ||
      obj["Message clarity"]
  );
  var definiteUse = safeNumber(
    obj["Definite Use %"] ||
      obj["Definite Use"] ||
      obj["Definite Use Intent %"] ||
      obj["Definite Use Intent"] ||
      obj["Use Intent %"] ||
      obj["Use Intent"] ||
      obj["Definite Use Rate"]
  );
  var influencers = safeNumber(
    obj["Influencers"] ||
      obj["Influencers Identified"] ||
      obj["Influencer"] ||
      obj["Key Influencers"]
  );
  var awareness = safeNumber(
    obj["Awareness %"] ||
      obj["Awareness"] ||
      obj["Awareness Rate %"] ||
      obj["Awareness Rate"]
  );

  // Clamp percentages
  if (!isNaN(clarity)) clarity = Math.max(0, Math.min(100, clarity));
  if (!isNaN(definiteUse)) definiteUse = Math.max(0, Math.min(100, definiteUse));
  if (!isNaN(awareness)) awareness = Math.max(0, Math.min(100, awareness));

  // Serial number
  var sn = obj["SN"] || obj["Sn"] || obj["sn"] || (index + 1);

  obj.__sn = sn;
  obj.__farmers = farmers;
  obj.__acres = acres;

  obj.__messageClarity = clarity;
  obj.__definiteUseRate = definiteUse;
  obj.__influencers = influencers;
  obj.__awarenessRate = awareness;

  return obj;
}


// ---------- DATES ----------
function parseDate(value) {
  if (!value) return null;
  var v = String(value).trim();

  // Try built-in parsing first (covers e.g. 2024-11-23)
  var parsed = Date.parse(v);
  if (!isNaN(parsed)) return new Date(parsed);

  // pattern: 23-Nov-25 or 23/Nov/2025
  var m = v.match(/^(\d{1,2})[-\/](\w+)[-\/](\d{2,4})$/i);
  var months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  if (m) {
    var day = parseInt(m[1], 10);
    var monStr = m[2].toLowerCase();
    var yearStr = m[3];
    if (!months.hasOwnProperty(monStr)) return null;
    var year = parseInt(yearStr, 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return new Date(year, months[monStr], day);
  }

  // pattern: 23-Nov (no year) – assume current year
  var m2 = v.match(/^(\d{1,2})[-\/](\w+)$/i);
  if (m2) {
    var day2 = parseInt(m2[1], 10);
    var monStr2 = m2[2].toLowerCase();
    if (!months.hasOwnProperty(monStr2)) return null;
    var nowYear = new Date().getFullYear();
    return new Date(nowYear, months[monStr2], day2);
  }

  return null;
}

function preProcessDates(rows) {
  uniqueDates = [];
  rows.forEach(function (row) {
    var dateStr = row["Activity Date"] || row["Date"] || row["date"] || "";
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

// ---------- FILTERS ----------
function populateFilterOptions(rows) {
  var cityEl = document.getElementById("from-city-filter");
  if (!cityEl) return;
  var citiesSet = new Set();
  rows.forEach(function (row) {
    var c = (row["From City"] || row["From"] || "").trim();
    if (c) citiesSet.add(c);
  });
  var cities = Array.from(citiesSet).sort(function (a, b) {
    return a.localeCompare(b);
  });

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
      var fromCity = (row["From City"] || row["From"] || "").toLowerCase();
      if (!fromCity.includes(cityFilter)) return false;
    }
    return true;
  });

  buildCitySummary(filteredRows);
  updateHeroAndSnapshot(filteredRows);
  updateKeyMetrics(filteredRows);
  updateCampaignMetrics(filteredRows);
  updateSessionTable(filteredRows);
  updateCityTable();
  updateCharts();
  initMap(filteredRows);
  initMediaGallery(filteredRows);
}

// ---------- SUMMARY BUILDERS ----------
function buildCitySummary(rows) {
  var mapByCity = new Map();
  rows.forEach(function (row) {
    // Use destination City primarily; fall back to From City
    var city =
      (row["City"] || row["From City"] || row["From"] || "Unknown").trim() || "Unknown";
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

// ---------- HERO + SNAPSHOT ----------
function formatInt(value) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return Math.round(value).toLocaleString("en-PK");
}

function formatFloat(value, decimals) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  var d = decimals === undefined ? 1 : decimals;
  return value.toFixed(d);
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

  var cities = new Set();
  var villages = new Set();
  rows.forEach(function (row) {
    var city = (row["City"] || row["From City"] || row["From"] || "").trim();
    var v = (row["Village / Mauza"] || row["Session Location"] || row["Location"] || "").trim();
    if (city) cities.add(city);
    if (v) villages.add(v);
  });
  setText("snap-locations", cities.size + " cities / " + villages.size + " villages");
}

// ---------- KEY METRICS ----------
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
    var c = (row["City"] || row["From City"] || row["From"] || "").trim();
    var v = (row["Village / Mauza"] || row["Session Location"] || row["Location"] || "").trim();
    if (c) cities.add(c);
    if (v) villages.add(v);
    var coordsObj = extractLatLng(row);
    if (coordsObj.lat && coordsObj.lng) sessionsWithCoords += 1;
  });

  setText("metric-cities", cities.size || "–");
  setText("metric-villages", villages.size || "–");
  setText("metric-sessions-with-coords", sessionsWithCoords || "–");
  setText(
    "metric-coverage",
    (cities.size || 0) + " cities • " + (villages.size || 0) + " villages"
  );
}


// ---------- CAMPAIGN PERFORMANCE (CLARITY / INTENT / INFLUENCERS / AWARENESS) ----------
function updateCampaignMetrics(rows) {
  initChartsIfNeeded();

  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);

  var claritySum = 0, clarityCnt = 0;
  var defSum = 0, defCnt = 0;
  var awareSum = 0, awareCnt = 0;
  var totalInfluencers = 0;

  rows.forEach(function (r) {
    if (!isNaN(r.__messageClarity) && r.__messageClarity > 0) { claritySum += r.__messageClarity; clarityCnt += 1; }
    if (!isNaN(r.__definiteUseRate) && r.__definiteUseRate > 0) { defSum += r.__definiteUseRate; defCnt += 1; }
    if (!isNaN(r.__awarenessRate) && r.__awarenessRate > 0) { awareSum += r.__awarenessRate; awareCnt += 1; }
    totalInfluencers += (r.__influencers || 0);
  });

  var avgClarity = clarityCnt ? (claritySum / clarityCnt) : 0;
  var avgDefinite = defCnt ? (defSum / defCnt) : 0;
  var avgAwareness = awareCnt ? (awareSum / awareCnt) : 0;

  var totalDefiniteFarmers = rows.reduce(function (s, r) {
    var pct = isNaN(r.__definiteUseRate) ? 0 : (r.__definiteUseRate || 0);
    return s + Math.round((r.__farmers || 0) * pct / 100);
  }, 0);

  // Update hero numbers shown inside donut cards
  setText("clarity-main", clarityCnt ? (Math.round(avgClarity) + "%") : "–");
  setText("definite-main", defCnt ? (Math.round(avgDefinite) + "%") : "–");

  // Update donut visuals
  if (clarityChart) {
    var cVal = clarityCnt ? Math.round(avgClarity) : 0;
    clarityChart.data.datasets[0].data = [cVal, Math.max(0, 100 - cVal)];
    clarityChart.update();
  }
  if (definiteChart) {
    var dVal = defCnt ? Math.round(avgDefinite) : 0;
    definiteChart.data.datasets[0].data = [dVal, Math.max(0, 100 - dVal)];
    definiteChart.update();
  }

  // Adoption subtitle
  var adoptionText = document.getElementById("adoption-text");
  if (adoptionText) {
    var defPct = totalFarmers ? Math.round((totalDefiniteFarmers / totalFarmers) * 100) : Math.round(avgDefinite);
    adoptionText.textContent =
      "Estimated definite-use farmers: " + formatInt(totalDefiniteFarmers) + " (" + defPct + "%)";
  }

  // Optionally expose totals in console for quick validation
  // console.log({ avgClarity, avgDefinite, avgAwareness, totalInfluencers, totalDefiniteFarmers });
}

// ---------- TABLES ----------
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
    var fromCity = (row["From City"] || row["From"] || "").trim();
    var toCity = (row["City"] || row["To City"] || row["To"] || "").trim();
    var loc = (row["Village / Mauza"] || row["Session Location"] || row["Location"] || "").trim();

    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;

    var clarity = row.__messageClarity;
    var definite = row.__definiteUseRate;
    var influencers = row.__influencers;

    tr.innerHTML =
      "<td>" + (row.__sn || "") + "</td>" +
      "<td>" + (d || "") + "</td>" +
      "<td>" + (fromCity || "") + "</td>" +
      "<td>" + (toCity || "") + "</td>" +
      "<td>" + (loc || "") + "</td>" +
      "<td>" + formatInt(farmers) + "</td>" +
      "<td>" + formatInt(acres) + "</td>" +
      "<td>" + (isNaN(clarity) ? "–" : (Math.round(clarity) + "%")) + "</td>" +
      "<td>" + (isNaN(definite) ? "–" : (Math.round(definite) + "%")) + "</td>" +
      "<td>" + formatInt(influencers) + "</td>";

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

// ---------- CHARTS ----------
function initChartsIfNeeded() {
  var clarityCtx = document.getElementById("clarityDonut");
  var definiteCtx = document.getElementById("definiteDonut");
  var cityCtx = document.getElementById("cityFarmersChart");
  var adoptionCtx = document.getElementById("adoptionChart");

  if (clarityCtx && !clarityChart) {
    clarityChart = new Chart(clarityCtx, {
      type: "doughnut",
      data: {
        labels: ["Clarity", "Gap"],
        datasets: [{
          data: [0, 100],
          backgroundColor: ["#66bb6a", "#e0e0e0"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: "70%",
        plugins: { legend: { display: false }, tooltip: { enabled: true } }
      }
    });
  }

  if (definiteCtx && !definiteChart) {
    definiteChart = new Chart(definiteCtx, {
      type: "doughnut",
      data: {
        labels: ["Definite Use", "Gap"],
        datasets: [{
          data: [0, 100],
          backgroundColor: ["#ff7043", "#e0e0e0"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: "70%",
        plugins: { legend: { display: false }, tooltip: { enabled: true } }
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

  if (adoptionCtx && !adoptionChart) {
    adoptionChart = new Chart(adoptionCtx, {
      type: "bar",
      data: {
        labels: ["Total Farmers", "Estimated Definite-use"],
        datasets: [{
          label: "Farmers",
          data: [0, 0],
          backgroundColor: ["#1b5e20", "#ff7043"]
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }
}


function updateCharts() {
  initChartsIfNeeded();

  // Top cities chart
  if (cityFarmersChart && citySummary.length) {
    var top = citySummary.slice(0, 6);
    var others = citySummary.slice(6);
    var labels = top.map(function (c) { return c.city; });
    var data = top.map(function (c) { return c.farmers; });
    if (others.length) {
      labels.push("Others");
      data.push(others.reduce(function (s, c) { return s + c.farmers; }, 0));
    }
    cityFarmersChart.data.labels = labels;
    cityFarmersChart.data.datasets[0].data = data;
    cityFarmersChart.update();
  }

  // Adoption bar chart (total vs estimated definite-use)
  if (adoptionChart) {
    var totalFarmers = filteredRows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
    var definiteFarmers = filteredRows.reduce(function (s, r) {
      var pct = isNaN(r.__definiteUseRate) ? 0 : (r.__definiteUseRate || 0);
      return s + Math.round((r.__farmers || 0) * pct / 100);
    }, 0);

    adoptionChart.data.datasets[0].data = [totalFarmers, definiteFarmers];
    adoptionChart.update();
  }
}


// ---------- MAP & COORD PARSING ----------
function parseDMS(dmsStr) {
  if (!dmsStr) return null;
  var s = String(dmsStr).trim();
  var m = s.match(
    /(\d+(?:\.\d+)?)[°\s]+(\d+(?:\.\d+)?)[\'’]?\s*(\d*(?:\.\d+)?)["”]?\s*([NSEW])/i
  );
  if (!m) return null;
  var deg = parseFloat(m[1]) || 0;
  var min = parseFloat(m[2]) || 0;
  var sec = parseFloat(m[3]) || 0;
  var hemi = m[4].toUpperCase();
  var dec = deg + min / 60 + sec / 3600;
  if (hemi === "S" || hemi === "W") dec = -dec;
  return dec;
}

function extractLatLng(row) {
  var lat = safeNumber(row["Latitude"] || row["lat"]);
  var lng = safeNumber(row["Longitude"] || row["lng"]);
  var original = "";

  if (lat && lng) {
    original = lat + ", " + lng;
    return { lat: lat, lng: lng, original: original };
  }

  var spot = row["Spot Coordinates"] || row["Coordinates"] || "";
  if (spot) {
    var text = String(spot).trim();
    var m = text.match(/([0-9°'".\s]+[NS])[, ]+([0-9°'".\s]+[EW])/i);
    if (m) {
      var latStr = m[1];
      var lngStr = m[2];
      var dLat = parseDMS(latStr);
      var dLng = parseDMS(lngStr);
      if (dLat && dLng) {
        return { lat: dLat, lng: dLng, original: text };
      }
    }
    original = text;
  }

  return { lat: 0, lng: 0, original: original };
}

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
  var coordsArr = [];

  rows.forEach(function (row) {
    var coordsObj = extractLatLng(row);
    var lat = coordsObj.lat;
    var lng = coordsObj.lng;
    if (!lat || !lng) return;

    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;
    var loc =
      row["Village / Mauza"] || row["Session Location"] || row["Location"] || "Session";
    var fromCity = row["From City"] || row["From"] || "";
    var radius = Math.max(4, Math.min(18, acres ? acres / 200 : 6));

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
    coordsArr.push([lat, lng]);
  });

  if (coordsArr.length) {
    var bounds = L.latLngBounds(coordsArr);
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// ---------- MEDIA GALLERY ----------
function initMediaGallery(rows) {
  var gallery = document.getElementById("media-gallery");
  if (!gallery) return;
  gallery.innerHTML = "";

  // Media assets are indexed by unique date order: 1.jpeg / 1.mp4, 2.jpeg / 2.mp4, ...
  var dateToIndex = new Map();
  uniqueDates.forEach(function (d, idx) { dateToIndex.set(d.getTime(), idx + 1); });

  // Pick one representative row per day (avoids duplicate media cards for same date)
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
    var mediaIndex = dateToIndex.get(t) || 0;
    if (!mediaIndex) return;

    var imgSrc = mediaIndex + ".jpeg";
    var vidSrc = mediaIndex + ".mp4";

    var loc = row["Village / Mauza"] || row["Session Location"] || row["Location"] || ("Session " + mediaIndex);
    var city = row["City"] || row["From City"] || row["From"] || "";
    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;

    var card = document.createElement("div");
    card.className = "media-card";
    card.innerHTML =
      "<div class='media-thumb-wrap hover-video'>" +
        "<img src='" + imgSrc + "' alt='Session photo " + mediaIndex + "' onerror=\"this.style.display='none';\" />" +
        "<video muted loop playsinline preload='metadata' onerror=\"this.style.display='none';\">" +
          "<source src='" + vidSrc + "' type='video/mp4' />" +
        "</video>" +
        "<div class='media-overlay'><i class='fa-solid fa-play'></i></div>" +
      "</div>" +
      "<div class='media-caption'>" +
        "<strong>" + (loc || ("Session " + mediaIndex)) + "</strong>" +
        "<span>" + (city || "") + " • " + formatInt(farmers) + " farmers • " + formatInt(acres) + " acres</span>" +
        "<span>" + d.toISOString().slice(0, 10) + "</span>" +
      "</div>";

    // Hover play (helps on browsers that block autoplay)
    var videoEl = card.querySelector("video");
    card.addEventListener("mouseenter", function () {
      if (videoEl) { try { videoEl.play(); } catch (e) {} }
    });
    card.addEventListener("mouseleave", function () {
      if (videoEl) { try { videoEl.pause(); videoEl.currentTime = 0; } catch (e) {} }
    });

    card.addEventListener("click", function () { openLightbox(imgSrc, vidSrc); });
    gallery.appendChild(card);
  });
}


function openLightbox(imgSrc, vidSrc) {
  var lb = document.getElementById("lightbox");
  var img = document.getElementById("lb-img");
  var vid = document.getElementById("lb-video");
  if (!lb || !img || !vid) return;

  // Default: prefer video when available
  img.style.display = "none";
  vid.style.display = "block";

  img.src = imgSrc || "";
  vid.src = vidSrc || "";
  vid.load();

  // If video fails, fall back to image
  vid.onerror = function () {
    vid.style.display = "none";
    img.style.display = "block";
  };

  lb.classList.add("active");

  try { vid.play(); } catch (e) {}

  lb.onclick = function () {
    lb.classList.remove("active");
    img.src = "";
    try { vid.pause(); } catch (e) {}
    vid.src = "";
  };
}


// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", function () {
  loadCSV();
  initChartsIfNeeded();
});
