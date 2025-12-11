// ---------- CONSTANT CAMPAIGN NUMBERS (marketing summary) ----------
const CAMPAIGN = {
  sessionsPlanned: 34,
  sessionsExecuted: 26,
  farmers: 1123,
  acres: 19025,
  clarityScore: 2.9, // out of 3
  clarityPct: 97,
  definiteIntentPct: 88,
  influencers: 201
};

// ---------- STATE ----------
let FILTER_START_DATE = "2025-11-23";
let FILTER_END_DATE = "2025-12-31";

let ALLOWED_FROM_CITIES = [];
let ALLOWED_TO_CITIES = [];
let ALLOWED_LOCATIONS = [];

let allRows = [];
let currentFilteredRows = [];
let uniqueDates = [];

let cityFarmersChartInstance = null;
let villageAcresChartInstance = null;
let driversPieInstance = null;
let clarityDonutInstance = null;

document.addEventListener("DOMContentLoaded", () => {
  initFilters();
  fillHeroStaticNumbers();
  initChartsStatic();
  loadCSV();
});

// ---------- INITIALISATION HELPERS ----------

function initFilters() {
  const startEl = document.getElementById("start-date");
  const endEl = document.getElementById("end-date");

  if (startEl) startEl.value = FILTER_START_DATE;
  if (endEl) endEl.value = FILTER_END_DATE;

  if (startEl) {
    startEl.addEventListener("change", e => {
      FILTER_START_DATE = e.target.value;
    });
  }
  if (endEl) {
    endEl.addEventListener("change", e => {
      FILTER_END_DATE = e.target.value;
    });
  }
  const fromCity = document.getElementById("from-city-filter");
  if (fromCity) {
    fromCity.addEventListener("change", e => {
      ALLOWED_FROM_CITIES = e.target.value ? [e.target.value] : [];
    });
  }
}

function fillHeroStaticNumbers() {
  setText("hero-sessions", `${CAMPAIGN.sessionsExecuted} of ${CAMPAIGN.sessionsPlanned}`);
  setText("hero-farmers", formatNumber(CAMPAIGN.farmers));
  setText("hero-acres", formatNumber(CAMPAIGN.acres));
  setText("hero-influencers", `${CAMPAIGN.influencers} Farmer Captains`);

  setText("snap-sessions", `${CAMPAIGN.sessionsExecuted} / ${CAMPAIGN.sessionsPlanned}`);
  setText("snap-farmers", formatNumber(CAMPAIGN.farmers));
  setText("snap-acres", formatNumber(CAMPAIGN.acres));
  setText("snap-intent", `${CAMPAIGN.definiteIntentPct}%`);

  setBarWidth("snap-sessions-bar", CAMPAIGN.sessionsExecuted / CAMPAIGN.sessionsPlanned);
  // normalise remaining to 0–1 based on convenient max values
  setBarWidth("snap-farmers-bar", Math.min(CAMPAIGN.farmers / 1500, 1));
  setBarWidth("snap-acres-bar", Math.min(CAMPAIGN.acres / 25000, 1));
  setBarWidth("snap-intent-bar", CAMPAIGN.definiteIntentPct / 100);

  setText("clarity-main", `${CAMPAIGN.clarityPct}%`);
}

// ---------- CSV LOADING ----------

function loadCSV() {
  const loadingEl = document.getElementById("loading-message");
  if (loadingEl) loadingEl.textContent = "Loading data from sum_sheet.csv…";

  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(resp => {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.text();
    })
    .then(csvText => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: result => {
          allRows = normalizeRows(result);
          preProcessDates(allRows);
          populateFilterOptions();
          applyFilters();
          if (loadingEl) {
            loadingEl.textContent =
              "Data loaded. Use the filters to slice the fact-sheet dashboard.";
          }
        },
        error: err => {
          console.error("PapaParse error:", err);
          if (loadingEl) loadingEl.textContent = "Error parsing sum_sheet.csv.";
        }
      });
    })
    .catch(err => {
      console.error("Error loading CSV:", err);
      const loadingEl2 = document.getElementById("loading-message");
      if (loadingEl2) loadingEl2.textContent = "Failed to load sum_sheet.csv.";
    });
}

/**
 * CSV structure:
 *   Row 0: technical headers
 *   Row 1: display headers (SN, From City, City, Date, ...)
 *   Row 2+: data
 */
function normalizeRows(result) {
  const rows = result.data || [];
  const fields = (result.meta && result.meta.fields) || [];
  if (!rows.length || !fields.length) return [];

  const headerRow = rows[0];
  const headerLabels = {};
  fields.forEach(f => {
    const raw = headerRow[f];
    const label = raw == null ? "" : String(raw).trim();
    headerLabels[f] = label || f;
  });

  const normalized = [];
  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    let hasValue = false;
    const obj = {};
    fields.forEach(f => {
      const label = headerLabels[f];
      if (!label) return;
      const v = rawRow[f];
      if (v != null && String(v).trim() !== "") hasValue = true;
      obj[label] = v;
    });
    if (hasValue) normalized.push(obj);
  }
  return normalized;
}

// ---------- FILTERING ----------

function populateFilterOptions() {
  const select = document.getElementById("from-city-filter");
  if (!select) return;

  while (select.options.length > 1) select.remove(1);

  const cities = [
    ...new Set(
      allRows
        .map(r => (r["From City"] || "").toString().trim())
        .filter(Boolean)
    )
  ].sort();

  cities.forEach(city => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    select.appendChild(opt);
  });
}

function applyFilters() {
  currentFilteredRows = filterRows(allRows);
  updateMetrics(currentFilteredRows);
  updateSessionTable(currentFilteredRows);
  updateCitySummary(currentFilteredRows);
  updateVillageSummary(currentFilteredRows);
  buildCityVillageCharts(currentFilteredRows);
  initMap(currentFilteredRows);
  updateMediaGallery();
}

function resetFilters() {
  FILTER_START_DATE = "2025-11-23";
  FILTER_END_DATE = "2025-12-31";
  ALLOWED_FROM_CITIES = [];
  ALLOWED_TO_CITIES = [];
  ALLOWED_LOCATIONS = [];

  const startEl = document.getElementById("start-date");
  const endEl = document.getElementById("end-date");
  const fromEl = document.getElementById("from-city-filter");
  if (startEl) startEl.value = FILTER_START_DATE;
  if (endEl) endEl.value = FILTER_END_DATE;
  if (fromEl) fromEl.value = "";

  applyFilters();
}

function filterRows(rows) {
  const start = parseDateFlexible(FILTER_START_DATE);
  const end = parseDateFlexible(FILTER_END_DATE);

  return rows.filter(r => {
    const dateStr = (r["Date"] || "").toString().trim();
    const rowDate = parseDateFlexible(dateStr);

    if (start && end && rowDate) {
      if (rowDate < start || rowDate > end) return false;
    }

    const fromCity = (r["From City"] || "").toString().trim();
    const toCity = (r["To City"] || r["City"] || "").toString().trim();
    const loc = (r["Session Location"] || r["Village / Mauza"] || "")
      .toString()
      .trim();

    if (ALLOWED_FROM_CITIES.length && !ALLOWED_FROM_CITIES.includes(fromCity))
      return false;
    if (ALLOWED_TO_CITIES.length && !ALLOWED_TO_CITIES.includes(toCity))
      return false;
    if (ALLOWED_LOCATIONS.length && !ALLOWED_LOCATIONS.includes(loc))
      return false;

    return true;
  });
}

// ---------- DATE HELPERS ----------

function parseDateFlexible(str) {
  if (!str) return null;
  const trimmed = str.toString().trim();
  if (!trimmed) return null;

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  // dd-MMM
  const m = trimmed.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monStr = m[2].toLowerCase();
    const months = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11
    };
    if (months.hasOwnProperty(monStr)) {
      const year = 2025;
      const d2 = new Date(year, months[monStr], day);
      return isNaN(d2.getTime()) ? null : d2;
    }
  }

  const d3 = new Date(trimmed);
  return isNaN(d3.getTime()) ? null : d3;
}

function preProcessDates(rows) {
  const dates = new Set();
  rows.forEach(r => {
    const d = (r["Date"] || "").toString().trim();
    if (d) dates.add(d);
  });
  uniqueDates = Array.from(dates).sort((a, b) => {
    const da = parseDateFlexible(a);
    const db = parseDateFlexible(b);
    if (da && db) return da - db;
    return a.localeCompare(b);
  });
}

// ---------- METRICS ----------

function updateMetrics(rows) {
  const totalSessions = rows.length;
  const uniqueSN = new Set();
  const cities = new Set();
  const villages = new Set();
  let totalFarmers = 0;
  let totalAcres = 0;
  let sessionsWithCoords = 0;

  rows.forEach(r => {
    if (r["SN"] != null && r["SN"] !== "") uniqueSN.add(r["SN"]);

    const fromCity = (r["From City"] || "").toString().trim();
    const toCity = (r["To City"] || r["City"] || "").toString().trim();
    if (fromCity) cities.add(fromCity);
    if (toCity) cities.add(toCity);

    const loc = (r["Session Location"] || r["Village / Mauza"] || "")
      .toString()
      .trim();
    if (loc) villages.add(loc);

    const farmers = getFarmers(r);
    const acres = getCropArea(r);
    if (!isNaN(farmers)) totalFarmers += farmers;
    if (!isNaN(acres)) totalAcres += acres;

    if (getCoords(r)) sessionsWithCoords += 1;
  });

  const farmersPerSession =
    totalSessions > 0 ? (totalFarmers / totalSessions).toFixed(1) : "–";
  const acresPerSession =
    totalSessions > 0 ? (totalAcres / totalSessions).toFixed(1) : "–";

  setText("metric-total-sessions", totalSessions || "0");
  setText("metric-unique-sn", uniqueSN.size || "0");
  setText("metric-total-farmers", formatNumber(totalFarmers));
  setText("metric-farmers-per-session", farmersPerSession);
  setText("metric-total-acres", formatNumber(totalAcres));
  setText("metric-acres-per-session", acresPerSession);
  setText("metric-villages", villages.size || "0");
  setText("metric-cities", cities.size || "0");
  setText("metric-sessions-with-coords", sessionsWithCoords || "0");
}

// ---------- SESSION TABLE ----------

function updateSessionTable(rows) {
  const tbody = document.getElementById("session-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  rows.forEach(r => {
    const dateStr = (r["Date"] || "").toString().trim();
    const dateIndex = uniqueDates.indexOf(dateStr) + 1;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r["SN"] || "")}</td>
      <td>${escapeHtml(r["Date"] || "")}</td>
      <td>${escapeHtml(r["From City"] || "")}</td>
      <td>${escapeHtml(r["To City"] || r["City"] || "")}</td>
      <td>${escapeHtml(r["Session Location"] || r["Village / Mauza"] || "")}</td>
      <td>${escapeHtml(getFarmers(r))}</td>
      <td>${escapeHtml(getCropArea(r))}</td>
      <td>${escapeHtml(getCoords(r))}</td>
      <td>${escapeHtml(getFeedback(r))}</td>
      <td>${dateIndex > 0 ? dateIndex : ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- CITY & VILLAGE SUMMARIES ----------

function updateCitySummary(rows) {
  const tbody = document.getElementById("city-rows");
  if (!tbody) return;

  const summary = {};
  rows.forEach(r => {
    const city = (
      (r["From City"] || r["City"] || "Unknown").toString().trim() || "Unknown"
    );
    if (!summary[city]) summary[city] = { sessions: 0, farmers: 0, acres: 0 };
    summary[city].sessions += 1;
    const farmers = getFarmers(r);
    const acres = getCropArea(r);
    if (!isNaN(farmers)) summary[city].farmers += farmers;
    if (!isNaN(acres)) summary[city].acres += acres;
  });

  const entries = Object.entries(summary).sort(
    (a, b) => b[1].farmers - a[1].farmers
  );

  tbody.innerHTML = "";
  entries.forEach(([city, data], idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(city)}</td>
      <td>${data.sessions}</td>
      <td>${formatNumber(data.farmers)}</td>
      <td>${formatNumber(data.acres)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateVillageSummary(rows) {
  const tbody = document.getElementById("village-rows");
  if (!tbody) return;

  const summary = {};
  rows.forEach(r => {
    const v = (
      (r["Session Location"] || r["Village / Mauza"] || "Unknown")
        .toString()
        .trim() || "Unknown"
    );
    if (!summary[v]) summary[v] = { sessions: 0, farmers: 0, acres: 0 };
    summary[v].sessions += 1;
    const farmers = getFarmers(r);
    const acres = getCropArea(r);
    if (!isNaN(farmers)) summary[v].farmers += farmers;
    if (!isNaN(acres)) summary[v].acres += acres;
  });

  const entries = Object.entries(summary).sort(
    (a, b) => b[1].farmers - a[1].farmers
  );
  const top = entries.slice(0, 10);

  tbody.innerHTML = "";
  top.forEach(([village, data], idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(village)}</td>
      <td>${data.sessions}</td>
      <td>${formatNumber(data.farmers)}</td>
      <td>${formatNumber(data.acres)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- MEDIA GALLERY ----------

function updateMediaGallery() {
  const gallery = document.getElementById("media-gallery");
  if (!gallery) return;
  gallery.innerHTML = "";

  if (!uniqueDates.length) {
    gallery.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;color:#607d8b;">No dates found in CSV.</div>';
    return;
  }

  uniqueDates.forEach((date, idx) => {
    const index = idx + 1;
    const card = document.createElement("div");
    card.className = "media-card";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "media-thumb-wrap hover-video";

    const img = document.createElement("img");
    img.src = `${index}.jpeg`;
    img.alt = `Session media ${index}`;
    thumbWrap.appendChild(img);

    const video = document.createElement("video");
    video.src = `${index}.mp4`;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    thumbWrap.appendChild(video);

    // Hover / tap behaviour
    thumbWrap.addEventListener("mouseenter", () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });
    thumbWrap.addEventListener("mouseleave", () => {
      video.pause();
      video.currentTime = 0;
    });
    // Mobile tap toggle
    thumbWrap.addEventListener("click", () => {
      if (video.paused) {
        video.play().catch(() => {});
        thumbWrap.classList.add("video-active");
      } else {
        video.pause();
        video.currentTime = 0;
        thumbWrap.classList.remove("video-active");
      }
    });

    const caption = document.createElement("div");
    caption.className = "media-caption";
    caption.innerHTML = `
      <strong>Day ${index}</strong>
      <span>Date: ${escapeHtml(date)}</span>
      <span>Files: ${index}.jpeg • ${index}.mp4</span>
    `;

    card.appendChild(thumbWrap);
    card.appendChild(caption);
    gallery.appendChild(card);
  });
}

// ---------- MAP ----------

function initMap(rows) {
  const mapDiv = document.getElementById("route-map");
  if (!mapDiv) return;

  let map = window.buctrilMap;
  if (map) {
    map.remove();
    map = null;
  }

  const points = [];
  rows.forEach(r => {
    const coord = getCoords(r);
    if (!coord) return;
    const parts = coord
      .split(/[, ]/)
      .map(x => parseFloat(x.trim()))
      .filter(n => !isNaN(n));
    if (parts.length < 2) return;
    points.push({
      lat: parts[0],
      lon: parts[1],
      village: (r["Session Location"] || r["Village / Mauza"] || "").toString().trim(),
      farmers: getFarmers(r),
      acres: getCropArea(r),
      date: (r["Date"] || "").toString().trim()
    });
  });

  if (!points.length) {
    mapDiv.innerHTML =
      '<div style="padding:12px;text-align:center;font-size:12px;color:#607d8b;">No sessions with valid coordinates in the current filter range.</div>';
    return;
  }

  map = L.map("route-map", { zoomControl: true });
  window.buctrilMap = map;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const latLngs = [];
  points.forEach((p, idx) => {
    const latLng = L.latLng(p.lat, p.lon);
    latLngs.push(latLng);

    const acres = isNaN(p.acres) ? 0 : p.acres;
    const radiusMeters = 80 + Math.sqrt(acres || 0) * 35;

    L.circle(latLng, {
      radius: radiusMeters,
      fillOpacity: 0.35,
      fillColor: "#66bb6a",
      stroke: true,
      color: "#2e7d32",
      weight: 1.5
    }).addTo(map);

    const popup = `
      <strong>${escapeHtml(p.village || "Session " + (idx + 1))}</strong><br/>
      Date: ${escapeHtml(p.date)}<br/>
      Farmers: ${formatNumber(p.farmers)}<br/>
      Crop area: ${formatNumber(acres)} acres
    `;
    L.marker(latLng).addTo(map).bindPopup(popup);
  });

  if (latLngs.length > 1) {
    L.polyline(latLngs, { weight: 3, color: "#ffb300", opacity: 0.9 }).addTo(map);
    map.fitBounds(latLngs, { padding: [24, 24] });
  } else {
    map.setView(latLngs[0], 11);
  }
}

// ---------- CHARTS ----------

function initChartsStatic() {
  // Hero clarity doughnut
  const clarityCanvas = document.getElementById("clarityDonut");
  if (clarityCanvas) {
    const ctx = clarityCanvas.getContext("2d");
    clarityDonutInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Understood", "Opportunity"],
        datasets: [
          {
            data: [CAMPAIGN.clarityPct, 100 - CAMPAIGN.clarityPct],
            backgroundColor: ["#66bb6a", "#e0e0e0"],
            borderWidth: 0
          }
        ]
      },
      options: {
        cutout: "70%",
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
  }

  // Key success drivers pie (static)
  const driversCanvas = document.getElementById("driversPie");
  if (driversCanvas) {
    const ctx = driversCanvas.getContext("2d");
    driversPieInstance = new Chart(ctx, {
      type: "pie",
      data: {
        labels: ["Brand Trust", "Education Impact", "Network Effect"],
        datasets: [
          {
            data: [40, 35, 25],
            backgroundColor: ["#2e7d32", "#81c784", "#aed581"],
            borderWidth: 0
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } }
        }
      }
    });
  }
}

function buildCityVillageCharts(rows) {
  if (cityFarmersChartInstance) cityFarmersChartInstance.destroy();
  if (villageAcresChartInstance) villageAcresChartInstance.destroy();

  // City – farmers
  const cityTotals = {};
  rows.forEach(r => {
    const city = (
      (r["From City"] || r["City"] || "Unknown").toString().trim() || "Unknown"
    );
    const farmers = getFarmers(r);
    if (!cityTotals[city]) cityTotals[city] = 0;
    if (!isNaN(farmers)) cityTotals[city] += farmers;
  });
  const cityPivot = buildTopNWithOthers(cityTotals, 6);
  const cityCanvas = document.getElementById("cityFarmersChart");
  if (cityCanvas && cityPivot.labels.length) {
    cityFarmersChartInstance = new Chart(cityCanvas.getContext("2d"), {
      type: "pie",
      data: {
        labels: cityPivot.labels,
        datasets: [
          {
            label: "Farmers",
            data: cityPivot.data,
            backgroundColor: [
              "#2e7d32",
              "#66bb6a",
              "#81c784",
              "#a5d6a7",
              "#c5e1a5",
              "#dce775",
              "#fff59d"
            ],
            borderWidth: 0
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } }
        }
      }
    });
  }

  // Village – acres
  const villageTotals = {};
  rows.forEach(r => {
    const village = (
      (r["Session Location"] || r["Village / Mauza"] || "Unknown")
        .toString()
        .trim() || "Unknown"
    );
    const acres = getCropArea(r);
    if (!villageTotals[village]) villageTotals[village] = 0;
    if (!isNaN(acres)) villageTotals[village] += acres;
  });
  const villagePivot = buildTopNWithOthers(villageTotals, 6);
  const villageCanvas = document.getElementById("villageAcresChart");
  if (villageCanvas && villagePivot.labels.length) {
    villageAcresChartInstance = new Chart(villageCanvas.getContext("2d"), {
      type: "pie",
      data: {
        labels: villagePivot.labels,
        datasets: [
          {
            label: "Acres",
            data: villagePivot.data,
            backgroundColor: [
              "#00695c",
              "#00897b",
              "#26a69a",
              "#4db6ac",
              "#80cbc4",
              "#b2dfdb",
              "#e0f2f1"
            ],
            borderWidth: 0
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } }
        }
      }
    });
  }
}

function buildTopNWithOthers(map, topN) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { labels: [], data: [] };
  if (entries.length <= topN) {
    return {
      labels: entries.map(e => e[0]),
      data: entries.map(e => e[1])
    };
  }
  const top = entries.slice(0, topN - 1);
  const rest = entries.slice(topN - 1);
  const othersVal = rest.reduce((sum, [, v]) => sum + v, 0);
  const labels = top.map(e => e[0]).concat(["Others"]);
  const data = top.map(e => e[1]).concat([othersVal]);
  return { labels, data };
}

// ---------- SHARING ----------

function shareOnX() {
  const url = window.location.href;
  const text =
    "Buctril Super Farmer Education Drive – interactive fact-sheet dashboard (sessions, acres, insights).";
  const intent = `https://twitter.com/intent/tweet?url=${encodeURIComponent(
    url
  )}&text=${encodeURIComponent(text)}`;

  if (navigator.share) {
    navigator
      .share({ title: document.title, text, url })
      .catch(() => window.open(intent, "_blank"));
  } else {
    window.open(intent, "_blank");
  }
}

function copyLink() {
  const url = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(url)
      .then(() => alert("Link copied to clipboard"))
      .catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const el = document.createElement("textarea");
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  alert("Link copied to clipboard");
}

// ---------- GENERIC HELPERS ----------

function setText(id, value) {
  const el = document.getElementById(id);
  if (el != null) el.textContent = value;
}

function setBarWidth(id, ratio) {
  const el = document.getElementById(id);
  if (!el) return;
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  el.style.width = (clamped * 100).toFixed(0) + "%";
}

function parseNumber(value) {
  if (value == null) return NaN;
  const n = parseFloat(value.toString().replace(/,/g, "").trim());
  return isNaN(n) ? NaN : n;
}

function findField(row, keywords) {
  const keys = Object.keys(row || {});
  for (const key of keys) {
    const lower = key.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return key;
    }
  }
  return null;
}

function getFarmers(row) {
  const key = findField(row, ["total farmers", "farmers"]);
  if (!key) return NaN;
  return parseNumber(row[key]);
}

function getCropArea(row) {
  const key = findField(row, [
    "total wheat acres",
    "acre",
    "area",
    "crop area"
  ]);
  if (!key) return NaN;
  return parseNumber(row[key]);
}

function getFeedback(row) {
  const key = findField(row, [
    "feedback",
    "observation",
    "remark",
    "comment"
  ]);
  if (!key) return "";
  return (row[key] || "").toString();
}

function getCoords(row) {
  const coordKey = findField(row, ["spot coordinates", "coord", "gps"]);
  if (coordKey && row[coordKey]) return row[coordKey].toString();
  const latKey = findField(row, ["lat"]);
  const lonKey = findField(row, ["lon", "lng", "long"]);
  if (latKey && lonKey && row[latKey] && row[lonKey]) {
    return `${row[latKey]}, ${row[lonKey]}`;
  }
  return "";
}

function formatNumber(n) {
  if (isNaN(n)) return "–";
  return Math.round(n).toLocaleString();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
