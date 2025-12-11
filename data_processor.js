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
let allRows = [];
let filteredRows = [];
let uniqueDates = [];

let clarityDonutInstance = null;
let driversPieInstance = null;
let cityFarmersChartInstance = null;
let villageAcresChartInstance = null;
let buctrilMap = null;
let loadingSpinner = null;

// Default filter window (will be overridden by CSV if needed)
let FILTER_START_DATE = "2025-11-23";
let FILTER_END_DATE = "2025-12-31";

// ---------- UTIL: DEBOUNCE ----------
function debounce(func, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
}

// ---------- BOOTSTRAP ----------
document.addEventListener("DOMContentLoaded", () => {
  initFilters();
  fillHeroStaticNumbers();
  initChartsStatic();
  loadCSV();
});

// ---------- FILTER UI INITIALISATION ----------
function initFilters() {
  const startEl = document.getElementById("start-date");
  const endEl = document.getElementById("end-date");
  const cityEl = document.getElementById("from-city-filter");

  if (startEl) {
    startEl.value = FILTER_START_DATE;
    startEl.addEventListener(
      "change",
      debounce(e => {
        FILTER_START_DATE = e.target.value;
        applyFilters();
      }, 300)
    );
  }

  if (endEl) {
    endEl.value = FILTER_END_DATE;
    endEl.addEventListener(
      "change",
      debounce(e => {
        FILTER_END_DATE = e.target.value;
        applyFilters();
      }, 300)
    );
  }

  if (cityEl) {
    cityEl.addEventListener(
      "change",
      debounce(() => {
        applyFilters();
      }, 300)
    );
  }
}

// ---------- HERO STATIC (from CAMPAIGN object) ----------
function fillHeroStaticNumbers() {
  setText("hero-sessions", `${CAMPAIGN.sessionsExecuted} of ${CAMPAIGN.sessionsPlanned}`);
  setText("hero-farmers", formatInt(CAMPAIGN.farmers));
  setText("hero-acres", formatInt(CAMPAIGN.acres));
  setText("hero-influencers", `${CAMPAIGN.influencers} Farmer Captains`);

  setText("snap-sessions", `${CAMPAIGN.sessionsExecuted} / ${CAMPAIGN.sessionsPlanned}`);
  setText("snap-farmers", formatInt(CAMPAIGN.farmers));
  setText("snap-acres", formatInt(CAMPAIGN.acres));
  setText("snap-intent", `${CAMPAIGN.definiteIntentPct}%`);

  const pSessions = (CAMPAIGN.sessionsExecuted / CAMPAIGN.sessionsPlanned) * 100;
  setBarWidth("snap-sessions-bar", pSessions);
  setBarWidth("snap-farmers-bar", 100); // treat as full scale
  setBarWidth("snap-acres-bar", 100);
  setBarWidth("snap-intent-bar", CAMPAIGN.definiteIntentPct);

  setText("clarity-main", `${CAMPAIGN.clarityPct}%");
}

// ---------- CSV LOAD & NORMALISATION ----------
function loadCSV() {
  const loadingEl = document.getElementById("loading-message");
  if (loadingEl) {
    loadingEl.textContent = "Loading data from sum_sheet.csv…";
    loadingSpinner = document.createElement("span");
    loadingSpinner.className = "spinner";
    loadingEl.appendChild(loadingSpinner);
  }

  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(resp => {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.text();
    })
    .then(csvText => {
      Papa.parse(csvText, {
        header: true, // first physical row is technical header (Summary / Unnamed / …)
        skipEmptyLines: true,
        complete: result => {
          allRows = normalizeRows(result);
          preProcessDates(allRows);
          populateFilterOptions(allRows);
          applyFilters(); // initial render

          if (loadingSpinner && loadingSpinner.parentNode) {
            loadingSpinner.parentNode.removeChild(loadingSpinner);
            loadingSpinner = null;
          }

          if (loadingEl) {
            loadingEl.textContent =
              "Data loaded. Use the filters to slice the fact-sheet dashboard.";
          }
        },
        error: err => {
          console.error("PapaParse error:", err);

          if (loadingSpinner && loadingSpinner.parentNode) {
            loadingSpinner.parentNode.removeChild(loadingSpinner);
            loadingSpinner = null;
          }
          if (loadingEl) {
            loadingEl.textContent = "Error parsing sum_sheet.csv.";
          }
          showErrorModal("Error parsing CSV: " + (err && err.message ? err.message : "Unknown error"));
        }
      });
    })
    .catch(err => {
      console.error("Error loading CSV:", err);

      if (loadingSpinner && loadingSpinner.parentNode) {
        loadingSpinner.parentNode.removeChild(loadingSpinner);
        loadingSpinner = null;
      }
      if (loadingEl) {
        loadingEl.textContent = "Failed to load sum_sheet.csv.";
      }
      showErrorModal("Failed to load CSV: " + (err && err.message ? err.message : "Unknown error"));
    });
}

/**
 * CSV structure:
 *   Line 0: technical headers (Summary, Unnamed:1, …)
 *   Line 1 (data[0]): display headers (SN, From City, City, Date, …)
 *   Line 2+ (data[1..]): actual data rows
 *
 * We map the technical headers to the human-readable headers using the row
 * where each column value is "SN", "From City", etc.
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

  const normalised = [];
  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    const obj = {};
    let hasValue = false;

    fields.forEach(f => {
      const label = headerLabels[f];
      if (!label) return;
      const v = rawRow[f];
      if (v != null && String(v).trim() !== "") hasValue = true;
      obj[label] = v;
    });

    if (hasValue) normalised.push(obj);
  }

  return normalised;
}

// ---------- DATES & FILTER OPTIONS ----------

function preProcessDates(rows) {
  const dateSet = new Set();

  rows.forEach(r => {
    const d =
      (r["Date"] || r["Activity Date"] || "")
        .toString()
        .trim();
    if (d) dateSet.add(d);
  });

  uniqueDates = Array.from(dateSet).sort((a, b) => {
    const da = parseDateFlexible(a);
    const db = parseDateFlexible(b);
    if (da && db) return da - db;
    return a.localeCompare(b);
  });

  // Use min/max from data to prefill filters if possible
  if (uniqueDates.length) {
    const minDate = parseDateFlexible(uniqueDates[0]);
    const maxDate = parseDateFlexible(uniqueDates[uniqueDates.length - 1]);
    if (minDate) FILTER_START_DATE = toInputDate(minDate);
    if (maxDate) FILTER_END_DATE = toInputDate(maxDate);

    const startEl = document.getElementById("start-date");
    const endEl = document.getElementById("end-date");
    if (startEl) startEl.value = FILTER_START_DATE;
    if (endEl) endEl.value = FILTER_END_DATE;
  }
}

function populateFilterOptions(rows) {
  const select = document.getElementById("from-city-filter");
  if (!select) return;

  // keep first option ("All")
  while (select.options.length > 1) {
    select.remove(1);
  }

  const cities = [
    ...new Set(
      rows
        .map(r => (r["From City"] || "").toString().trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  cities.forEach(city => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    select.appendChild(opt);
  });
}

// ---------- FILTER APPLY / RESET ----------

function applyFilters() {
  if (!allRows.length) return;

  const startInput = document.getElementById("start-date");
  const endInput = document.getElementById("end-date");
  const cityInput = document.getElementById("from-city-filter");

  const start = startInput && startInput.value ? new Date(startInput.value) : null;
  const end = endInput && endInput.value ? new Date(endInput.value) : null;
  const selectedCity =
    cityInput && cityInput.value ? cityInput.value.toString().trim() : "";

  filteredRows = allRows.filter(r => {
    const dateStr = (r["Date"] || r["Activity Date"] || "").toString().trim();
    const rowDate = parseDateFlexible(dateStr);

    if (start && rowDate && rowDate < start) return false;
    if (end && rowDate && rowDate > end) return false;

    const fromCity = (r["From City"] || "").toString().trim();
    if (selectedCity && fromCity !== selectedCity) return false;

    return true;
  });

  // Update dashboard sections
  updateMetrics(filteredRows);
  updateSessionTable(filteredRows);
  updateCitySummary(filteredRows);
  updateVillageSummary(filteredRows);
  buildCityVillageCharts(filteredRows);
  initMap(filteredRows);
  updateMediaGallery();
}

function resetFilters() {
  const startEl = document.getElementById("start-date");
  const endEl = document.getElementById("end-date");
  const cityEl = document.getElementById("from-city-filter");

  if (uniqueDates.length) {
    const minDate = parseDateFlexible(uniqueDates[0]);
    const maxDate = parseDateFlexible(uniqueDates[uniqueDates.length - 1]);
    FILTER_START_DATE = minDate ? toInputDate(minDate) : FILTER_START_DATE;
    FILTER_END_DATE = maxDate ? toInputDate(maxDate) : FILTER_END_DATE;
  }

  if (startEl) startEl.value = FILTER_START_DATE;
  if (endEl) endEl.value = FILTER_END_DATE;
  if (cityEl) cityEl.value = "";

  applyFilters();
}

// expose to inline HTML handlers
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;

// ---------- METRIC HELPERS FROM CSV ----------

function getNumber(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null) {
      const num = toNumber(row[key]);
      if (!isNaN(num)) return num;
    }
  }
  return 0;
}

function getFarmers(row) {
  // Prefer Total Wheat Farmers, then Total Farmers
  return getNumber(row, ["Total Wheat Farmers", "Total Farmers"]);
}

function getCropArea(row) {
  return getNumber(row, [
    "Total Wheat Acres",
    "Estimated Buctril Acres from this Session"
  ]);
}

function getCoords(row) {
  const val = (row["Spot Coordinates"] || "").toString().trim();
  return val;
}

function getFeedback(row) {
  const remarks = (row["Remarks"] || "").toString().trim();
  const reasonUse = (row["Top Reason to Use (session)"] || "")
    .toString()
    .trim();
  const reasonNot = (row["Top Reason Not to Use (session)"] || "")
    .toString()
    .trim();

  const parts = [];
  if (remarks) parts.push(remarks);
  if (reasonUse) parts.push("Use: " + reasonUse);
  if (reasonNot) parts.push("Not use: " + reasonNot);

  return parts.join(" • ");
}

// ---------- METRICS PANEL ----------
function updateMetrics(rows) {
  const totalSessions = rows.length;
  const uniqueSN = new Set();
  const cities = new Set();
  const villages = new Set();
  let totalFarmers = 0;
  let totalAcres = 0;
  let sessionsWithCoords = 0;

  rows.forEach(r => {
    const sn = (r["SN"] || "").toString().trim();
    if (sn) uniqueSN.add(sn);

    const fromCity = (r["From City"] || "").toString().trim();
    const toCity = (r["City"] || "").toString().trim();
    if (fromCity) cities.add(fromCity);
    if (toCity) cities.add(toCity);

    const loc =
      (r["Session Location"] || r["Village / Mauza"] || "")
        .toString()
        .trim();
    if (loc) villages.add(loc);

    const farmers = getFarmers(r);
    const acres = getCropArea(r);
    totalFarmers += farmers;
    totalAcres += acres;

    if (getCoords(r)) sessionsWithCoords += 1;
  });

  const farmersPerSession =
    totalSessions > 0 ? (totalFarmers / totalSessions).toFixed(1) : "–";
  const acresPerSession =
    totalSessions > 0 ? (totalAcres / totalSessions).toFixed(1) : "–";

  setText("metric-total-sessions", totalSessions || "0");
  setText("metric-unique-sn", uniqueSN.size || "0");
  setText("metric-total-farmers", formatInt(totalFarmers));
  setText("metric-farmers-per-session", farmersPerSession);
  setText("metric-total-acres", formatInt(totalAcres));
  setText("metric-acres-per-session", acresPerSession);
  setText("metric-villages", villages.size || "0");
  setText("metric-cities", cities.size || "0");
  setText("metric-sessions-with-coords", sessionsWithCoords || "0");

  // Tooltips for metrics
  const sessionsEl = document.getElementById("metric-total-sessions");
  if (sessionsEl)
    sessionsEl.title = "Number of field sessions in the current filter range";

  const farmersEl = document.getElementById("metric-total-farmers");
  if (farmersEl)
    farmersEl.title = "Total farmers reached across filtered sessions";

  const farmersPerEl = document.getElementById("metric-farmers-per-session");
  if (farmersPerEl)
    farmersPerEl.title = "Average number of farmers per filtered session";

  const acresEl = document.getElementById("metric-total-acres");
  if (acresEl)
    acresEl.title = "Total wheat acres represented by filtered sessions";

  const acresPerEl = document.getElementById("metric-acres-per-session");
  if (acresPerEl)
    acresPerEl.title = "Average acres per filtered session";

  const villagesEl = document.getElementById("metric-villages");
  if (villagesEl)
    villagesEl.title = "Unique villages / locations visited";

  const citiesEl = document.getElementById("metric-cities");
  if (citiesEl)
    citiesEl.title = "Unique cities covered (from and to)";

  const gpsEl = document.getElementById("metric-sessions-with-coords");
  if (gpsEl)
    gpsEl.title = "Sessions where GPS coordinates were captured";
}

// ---------- SESSION TABLE ----------
function updateSessionTable(rows) {
  const tbody = document.getElementById("session-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  rows.forEach(r => {
    const dateStr = (r["Date"] || r["Activity Date"] || "")
      .toString()
      .trim();
    const dateIndex = uniqueDates.indexOf(dateStr) + 1;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r["SN"] || "")}</td>
      <td>${escapeHtml(dateStr)}</td>
      <td>${escapeHtml(r["From City"] || "")}</td>
      <td>${escapeHtml(r["City"] || "")}</td>
      <td>${escapeHtml(
        r["Session Location"] || r["Village / Mauza"] || ""
      )}</td>
      <td>${escapeHtml(formatInt(getFarmers(r)))}</td>
      <td>${escapeHtml(formatInt(getCropArea(r)))}</td>
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
    const city =
      (r["From City"] || r["City"] || "Unknown").toString().trim() ||
      "Unknown";

    if (!summary[city]) {
      summary[city] = { sessions: 0, farmers: 0, acres: 0 };
    }

    summary[city].sessions += 1;
    summary[city].farmers += getFarmers(r);
    summary[city].acres += getCropArea(r);
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
      <td>${escapeHtml(data.sessions)}</td>
      <td>${escapeHtml(formatInt(data.farmers))}</td>
      <td>${escapeHtml(formatInt(data.acres))}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateVillageSummary(rows) {
  const tbody = document.getElementById("village-rows");
  if (!tbody) return;

  const summary = {};

  rows.forEach(r => {
    const village =
      (r["Session Location"] || r["Village / Mauza"] || "Unknown")
        .toString()
        .trim() || "Unknown";

    if (!summary[village]) {
      summary[village] = { sessions: 0, farmers: 0, acres: 0 };
    }

    summary[village].sessions += 1;
    summary[village].farmers += getFarmers(r);
    summary[village].acres += getCropArea(r);
  });

  const entries = Object.entries(summary).sort(
    (a, b) => b[1].acres - a[1].acres
  );

  tbody.innerHTML = "";

  entries.slice(0, 10).forEach(([village, data], idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(village)}</td>
      <td>${escapeHtml(data.sessions)}</td>
      <td>${escapeHtml(formatInt(data.farmers))}</td>
      <td>${escapeHtml(formatInt(data.acres))}</td>
    `;
    tbody.appendChild(tr);
  });
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
        animation: {
          duration: 1500,
          easing: "easeOutBounce"
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              label: ctxInner => `${ctxInner.label}: ${ctxInner.raw}%`
            }
          }
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
        animation: {
          duration: 1200,
          easing: "easeOutCubic"
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } },
          tooltip: {
            enabled: true,
            callbacks: {
              label: ctxInner => `${ctxInner.label}: ${ctxInner.raw}%`
            }
          }
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
    const city =
      (r["From City"] || r["City"] || "Unknown").toString().trim() ||
      "Unknown";
    const farmers = getFarmers(r);
    if (!cityTotals[city]) cityTotals[city] = 0;
    cityTotals[city] += farmers;
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
              "#1b5e20",
              "#2e7d32",
              "#66bb6a",
              "#81c784",
              "#a5d6a7",
              "#c5e1a5",
              "#dce775"
            ],
            borderWidth: 0
          }
        ]
      },
      options: {
        animation: {
          duration: 1200,
          easing: "easeOutCubic"
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } },
          tooltip: {
            enabled: true,
            callbacks: {
              label: ctxInner =>
                `${ctxInner.label}: ${Number(ctxInner.raw).toLocaleString()}`
            }
          }
        }
      }
    });
  }

  // Village – acres
  const villageTotals = {};
  rows.forEach(r => {
    const village =
      (r["Session Location"] || r["Village / Mauza"] || "Unknown")
        .toString()
        .trim() || "Unknown";
    const acres = getCropArea(r);
    if (!villageTotals[village]) villageTotals[village] = 0;
    villageTotals[village] += acres;
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
        animation: {
          duration: 1200,
          easing: "easeOutCubic"
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } },
          tooltip: {
            enabled: true,
            callbacks: {
              label: ctxInner =>
                `${ctxInner.label}: ${Number(ctxInner.raw).toLocaleString()}`
            }
          }
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

  const top = entries.slice(0, topN);
  const others = entries.slice(topN);
  const otherTotal = others.reduce((acc, [, v]) => acc + v, 0);

  return {
    labels: [...top.map(e => e[0]), "Others"],
    data: [...top.map(e => e[1]), otherTotal]
  };
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
    img.alt = `Session day ${index}`;
    thumbWrap.appendChild(img);

    const video = document.createElement("video");
    video.src = `${index}.mp4`;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    thumbWrap.appendChild(video);

    // Hover preview on desktop
    thumbWrap.addEventListener("mouseenter", () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });
    thumbWrap.addEventListener("mouseleave", () => {
      video.pause();
      video.currentTime = 0;
    });

    // Click -> open lightbox
    const open = () => openLightbox(index, date);
    thumbWrap.addEventListener("click", open);
    card.addEventListener("click", open);

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

function openLightbox(index, date) {
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbVideo = document.getElementById("lb-video");
  if (!lb || !lbImg || !lbVideo) return;

  lbImg.src = `${index}.jpeg`;
  lbImg.style.display = "block";

  lbVideo.src = `${index}.mp4`;
  lbVideo.style.display = "block";
  lbVideo.currentTime = 0;

  lb.classList.add("active");

  const closeHandler = e => {
    // Close if background is clicked
    if (e.target === lb) {
      lb.classList.remove("active");
      lbVideo.pause();
      lb.removeEventListener("click", closeHandler);
    }
  };

  lb.addEventListener("click", closeHandler);
}

// ---------- MAP ----------
function initMap(rows) {
  const mapDiv = document.getElementById("route-map");
  if (!mapDiv) return;

  if (buctrilMap) {
    buctrilMap.remove();
    buctrilMap = null;
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

    const lat = parts[0];
    const lon = parts[1];

    points.push({
      lat,
      lon,
      village: (r["Session Location"] || r["Village / Mauza"] || "")
        .toString()
        .trim(),
      farmers: getFarmers(r),
      acres: getCropArea(r),
      date: (r["Date"] || r["Activity Date"] || "").toString().trim()
    });
  });

  if (!points.length) {
    mapDiv.innerHTML =
      '<div style="padding:12px;text-align:center;font-size:12px;color:#607d8b;">No sessions with valid coordinates in the current filter range.</div>';
    return;
  }

  buctrilMap = L.map("route-map", { zoomControl: true });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(buctrilMap);

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
      color: "#2e7d32",
      weight: 1.5
    })
      .addTo(buctrilMap)
      .bindPopup(
        `
        <strong>${escapeHtml(p.village || "Session " + (idx + 1))}</strong><br/>
        Date: ${escapeHtml(p.date || "-")}<br/>
        Farmers: ${escapeHtml(formatInt(p.farmers))}<br/>
        Acres: ${escapeHtml(formatInt(p.acres))}
      `
      );
  });

  if (latLngs.length > 1) {
    L.polyline(latLngs, {
      color: "#2e7d32",
      weight: 2,
      opacity: 0.9
    }).addTo(buctrilMap);
  }

  const bounds = L.latLngBounds(latLngs);
  buctrilMap.fitBounds(bounds, { padding: [20, 20] });
}

// ---------- UTILITIES ----------
function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value == null ? "" : value;
}

function setBarWidth(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = Math.max(0, Math.min(100, pct || 0));
  el.style.width = v + "%";
}

function formatInt(n) {
  const num = Math.round(n || 0);
  return num.toLocaleString();
}

function toNumber(value) {
  if (value == null) return 0;
  const str = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!str) return 0;
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseDateFlexible(str) {
  if (!str) return null;
  const trimmed = String(str).trim();

  // Pattern like "23-Nov" or "23-Nov."
  const m = trimmed.match(/^(\d{1,2})[-/](\w{3,})\.?$/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const monStr = m[2].slice(0, 3).toLowerCase();
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
    if (Object.prototype.hasOwnProperty.call(months, monStr)) {
      const year = 2025; // your campaign year
      const d = new Date(year, months[monStr], day);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const d2 = new Date(trimmed);
  return isNaN(d2.getTime()) ? null : d2;
}

function toInputDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------- ERROR MODAL ----------
function showErrorModal(message) {
  const modal = document.createElement("div");
  modal.className = "error-modal";
  modal.innerHTML = `
    <p>Error: ${escapeHtml(message)}</p>
    <button type="button">Close</button>
  `;
  const btn = modal.querySelector("button");
  if (btn) {
    btn.addEventListener("click", () => modal.remove());
  }
  modal.addEventListener("click", e => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
}

// ---------- SHARE / COPY ----------
function shareOnX() {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(
    "Buctril Super Farmer Education Drive – Fact Sheet Dashboard"
  );
  const shareUrl = `https://x.com/intent/tweet?text=${text}&url=${url}`;
  window.open(shareUrl, "_blank", "noopener");
}

function copyLink() {
  const url = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).catch(err =>
      console.error("Clipboard copy failed:", err)
    );
  } else {
    window.prompt("Copy this URL:", url);
  }
}

// expose share/copy for header buttons
window.shareOnX = shareOnX;
window.copyLink = copyLink;
