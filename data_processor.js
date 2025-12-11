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
let citySummary = [];
let villageSummary = [];
let mediaMeta = [];
let clarityChart;
let driversChart;
let cityFarmersChart;
let villageAcresChart;
let map;
let mapMarkers = [];
let loadingSpinner = null;

// ---------- UTILITIES ----------
function formatInt(value) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return Math.round(value).toLocaleString("en-PK");
}

function formatFloat(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) return "–";
  return value.toFixed(decimals);
}

function safeNumber(val) {
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBarWidth(id, pct) {
  const bar = document.getElementById(id);
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, pct));
  bar.style.width = clamped + "%";
}

function debounce(fn, delay = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// ---------- FILTERS ----------
function setupFilterListeners() {
  const startEl = document.getElementById("start-date");
  const endEl = document.getElementById("end-date");
  const cityEl = document.getElementById("from-city-filter");

  const handler = debounce(() => {
    applyFilters();
  }, 300);

  if (startEl) startEl.addEventListener("change", handler);
  if (endEl) endEl.addEventListener("change", handler);

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

  // FIXED LINE: close template literal correctly
  setText("clarity-main", `${CAMPAIGN.clarityPct}%`);
}

// ---------- CSV LOAD & NORMALISATION ----------
function loadCSV() {
  const loadingEl = document.getElementById("loading-message");
  if (loadingEl && !loadingSpinner) {
    loadingSpinner = document.createElement("span");
    loadingSpinner.className = "spinner";
    loadingEl.appendChild(loadingSpinner);
  }

  fetch("sum_sheet.csv?cache=" + Date.now())
    .then(resp => {
      if (!resp.ok) {
        throw new Error("Failed to load CSV: " + resp.status);
      }
      return resp.text();
    })
    .then(csvText => {
      Papa.parse(csvText, {
        header: true,
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
              "Data loaded from sum_sheet.csv • Use filters above to see specific date ranges or cities.";
          }
        },
        error: err => {
          console.error("Error parsing CSV:", err);
          if (loadingEl) loadingEl.textContent = "Error loading data.";
        }
      });
    })
    .catch(err => {
      console.error("Error fetching CSV:", err);
      showErrorModal("Could not load sum_sheet.csv. Please check file name and path on GitHub.");
      if (loadingEl) loadingEl.textContent = "Error loading data.";
    });
}

function normalizeRows(result) {
  const rows = result.data || [];
  return rows.map((row, index) => {
    const obj = { ...row };

    // Trim keys & values
    Object.keys(obj).forEach(k => {
      const trimmedKey = k.trim();
      if (trimmedKey !== k) {
        obj[trimmedKey] = obj[k];
        delete obj[k];
      }
      if (typeof obj[trimmedKey] === "string") {
        obj[trimmedKey] = obj[trimmedKey].trim();
      }
    });

    // Attempt to normalise some core columns
    const farmers = safeNumber(obj["Total Farmers"] || obj["Farmers"] || obj["farmers"]);
    const acres = safeNumber(obj["Total Acres"] || obj["Acres"] || obj["acres"]);
    const sn = obj["SN"] || obj["Sn"] || obj["sn"] || (index + 1);

    obj.__sn = sn;
    obj.__farmers = farmers;
    obj.__acres = acres;

    return obj;
  });
}

function preProcessDates(rows) {
  uniqueDates = [];
  rows.forEach(row => {
    const dateStr = row["Date"] || row["date"] || "";
    const parsed = parseDate(dateStr);
    row.__date_raw = dateStr;
    row.__date = parsed;
    if (parsed && !uniqueDates.find(d => d.getTime() === parsed.getTime())) {
      uniqueDates.push(parsed);
    }
  });

  uniqueDates.sort((a, b) => a - b);
}

function parseDate(value) {
  if (!value) return null;
  const v = String(value).trim();

  // Try ISO or dd/mm/yyyy etc via Date.parse first
  const parsed = Date.parse(v);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed);
  }

  // Try some manual patterns (e.g., "23-Nov-25")
  const m = v.match(/^(\d{1,2})[-\/](\w+)[-\/](\d{2,4})$/i);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const monStr = m[2].toLowerCase();
  const yearStr = m[3];

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
  if (!Object.prototype.hasOwnProperty.call(months, monStr)) {
    return null;
  }
  let year = parseInt(yearStr, 10);
  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }
  return new Date(year, months[monStr], day);
}

// ---------- FILTER APPLICATION ----------
function applyFilters() {
  if (!allRows || !allRows.length) return;

  const startEl = document.getElementById("start-date");
  const endEl = document.getElementById("end-date");
  const cityEl = document.getElementById("from-city-filter");

  const startDate = startEl && startEl.value ? new Date(startEl.value + "T00:00:00") : null;
  const endDate = endEl && endEl.value ? new Date(endEl.value + "T23:59:59") : null;
  const cityFilter = cityEl && cityEl.value ? cityEl.value.trim().toLowerCase() : "";

  filteredRows = allRows.filter(row => {
    const d = row.__date;
    if (startDate && (!d || d < startDate)) return false;
    if (endDate && (!d || d > endDate)) return false;

    if (cityFilter) {
      const fromCity = (row["From City"] || row["From"] || "").toLowerCase();
      if (!fromCity.includes(cityFilter)) return false;
    }
    return true;
  });

  // Rebuild summaries and redraw
  buildCitySummary(filteredRows);
  buildVillageSummary(filteredRows);
  buildMediaMeta(filteredRows);

  updateHeroFromFiltered(filteredRows);
  updateKeyMetrics(filteredRows);
  updateSessionTable(filteredRows);
  updateCityTable();
  updateVillageTable();
  updateCharts();
  initMap(filteredRows);
}

// ---------- POPULATE FILTER OPTIONS ----------
function populateFilterOptions(rows) {
  const cityEl = document.getElementById("from-city-filter");
  if (!cityEl) return;

  const citiesSet = new Set();
  rows.forEach(row => {
    const c = (row["From City"] || row["From"] || "").trim();
    if (c) citiesSet.add(c);
  });

  const cities = Array.from(citiesSet).sort((a, b) => a.localeCompare(b));

  // Keep "All" as first option
  while (cityEl.options.length > 1) {
    cityEl.remove(1);
  }

  cities.forEach(city => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    cityEl.appendChild(opt);
  });
}

// ---------- SUMMARY BUILDERS ----------
function buildCitySummary(rows) {
  const mapByCity = new Map();
  rows.forEach(row => {
    const city = (row["From City"] || row["From"] || "Unknown").trim() || "Unknown";
    const farmers = row.__farmers || 0;
    const acres = row.__acres || 0;

    if (!mapByCity.has(city)) {
      mapByCity.set(city, { city, sessions: 0, farmers: 0, acres: 0 });
    }
    const item = mapByCity.get(city);
    item.sessions += 1;
    item.farmers += farmers;
    item.acres += acres;
  });

  citySummary = Array.from(mapByCity.values()).sort((a, b) => b.farmers - a.farmers);
}

function buildVillageSummary(rows) {
  const mapByVillage = new Map();
  rows.forEach(row => {
    const v = (row["Village"] || row["Session Location"] || row["Location"] || "Unknown").trim() || "Unknown";
    const farmers = row.__farmers || 0;
    const acres = row.__acres || 0;

    if (!mapByVillage.has(v)) {
      mapByVillage.set(v, { village: v, sessions: 0, farmers: 0, acres: 0 });
    }
    const item = mapByVillage.get(v);
    item.sessions += 1;
    item.farmers += farmers;
    item.acres += acres;
  });

  villageSummary = Array.from(mapByVillage.values()).sort((a, b) => b.acres - a.acres);
}

function buildMediaMeta(rows) {
  // Each unique date -> index
  const byDate = new Map();
  uniqueDates.forEach((d, idx) => {
    byDate.set(d.getTime(), idx + 1);
  });

  mediaMeta = rows
    .map(row => {
      const d = row.__date;
      if (!d) return null;
      const index = byDate.get(d.getTime());
      if (!index) return null;
      return {
        date: d,
        index,
        title: row["Village"] || row["Session Location"] || row["Location"] || "",
        city: row["From City"] || row["From"] || "",
        farmers: row.__farmers || 0,
        acres: row.__acres || 0
      };
    })
    .filter(Boolean);
}

// ---------- HERO / METRICS FROM FILTERED ----------
function updateHeroFromFiltered(rows) {
  const totalSessions = rows.length;
  const totalFarmers = rows.reduce((sum, r) => sum + (r.__farmers || 0), 0);
  const totalAcres = rows.reduce((sum, r) => sum + (r.__acres || 0), 0);

  setText("metric-total-sessions", formatInt(totalSessions));
  setText("metric-total-farmers", formatInt(totalFarmers));
  setText(
    "metric-farmers-per-session",
    totalSessions ? formatFloat(totalFarmers / totalSessions) : "–"
  );
  setText("metric-total-acres", formatInt(totalAcres));
  setText(
    "metric-acres-per-session",
    totalSessions ? formatFloat(totalAcres / totalSessions) : "–"
  );

  // For hero snapshot cards
  setText("snap-sessions", `${totalSessions} / ${CAMPAIGN.sessionsPlanned}`);
  setText("snap-farmers", formatInt(totalFarmers));
  setText("snap-acres", formatInt(totalAcres));
  setBarWidth(
    "snap-sessions-bar",
    CAMPAIGN.sessionsPlanned ? (totalSessions / CAMPAIGN.sessionsPlanned) * 100 : 0
  );
  setBarWidth("snap-farmers-bar", totalFarmers ? 100 : 0);
  setBarWidth("snap-acres-bar", totalAcres ? 100 : 0);
}

function updateKeyMetrics(rows) {
  const villagesSet = new Set();
  const citiesSet = new Set();
  let sessionsWithCoords = 0;

  rows.forEach(row => {
    const village = (row["Village"] || row["Session Location"] || row["Location"] || "").trim();
    const fromCity = (row["From City"] || row["From"] || "").trim();
    if (village) villagesSet.add(village);
    if (fromCity) citiesSet.add(fromCity);

    const lat = safeNumber(row["Latitude"] || row["lat"]);
    const lng = safeNumber(row["Longitude"] || row["lng"]);
    if (lat !== 0 && lng !== 0) {
      sessionsWithCoords += 1;
    }
  });

  setText("metric-villages", villagesSet.size || "–");
  setText("metric-cities", citiesSet.size || "–");
  setText("metric-sessions-with-coords", sessionsWithCoords || "–");
}

// ---------- TABLE RENDERING ----------
function updateSessionTable(rows) {
  const tbody = document.getElementById("session-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  rows.forEach(row => {
    const tr = document.createElement("tr");

    const date = row.__date
      ? row.__date.toISOString().slice(0, 10)
      : row.__date_raw || "";

    const fromCity = row["From City"] || row["From"] || "";
    const toCity = row["To City"] || row["To"] || "";
    const loc = row["Village"] || row["Session Location"] || row["Location"] || "";
    const farmers = row.__farmers || 0;
    const acres = row.__acres || 0;
    const coords =
      (row["Latitude"] && row["Longitude"])
        ? `${row["Latitude"]}, ${row["Longitude"]}`
        : "";
    const feedback = row["Feedback/Observations"] || row["Feedback"] || row["Observations"] || "";
    const mediaIndex = row.__date ? getMediaIndexForDate(row.__date) : "";

    tr.innerHTML = `
      <td>${row.__sn || ""}</td>
      <td>${date}</td>
      <td>${fromCity}</td>
      <td>${toCity}</td>
      <td>${loc}</td>
      <td>${farmers || ""}</td>
      <td>${acres || ""}</td>
      <td>${coords}</td>
      <td>${feedback}</td>
      <td>${mediaIndex || ""}</td>
    `;

    tbody.appendChild(tr);
  });
}

function getMediaIndexForDate(date) {
  if (!date) return "";
  const idx = uniqueDates.findIndex(d => d.getTime() === date.getTime());
  return idx >= 0 ? idx + 1 : "";
}

function updateCityTable() {
  const tbody = document.getElementById("city-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  citySummary.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.city}</td>
      <td>${row.sessions}</td>
      <td>${formatInt(row.farmers)}</td>
      <td>${formatInt(row.acres)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateVillageTable() {
  const tbody = document.getElementById("village-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const top = villageSummary.slice(0, 10);
  top.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.village}</td>
      <td>${row.sessions}</td>
      <td>${formatInt(row.farmers)}</td>
      <td>${formatInt(row.acres)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- CHARTS ----------
function initChartsIfNeeded() {
  const clarityCtx = document.getElementById("clarityDonut");
  const driversCtx = document.getElementById("driversPie");
  const cityCtx = document.getElementById("cityFarmersChart");
  const villageCtx = document.getElementById("villageAcresChart");

  if (clarityCtx && !clarityChart) {
    clarityChart = new Chart(clarityCtx, {
      type: "doughnut",
      data: {
        labels: ["Clarity Achieved", "Gap"],
        datasets: [
          {
            data: [CAMPAIGN.clarityPct, 100 - CAMPAIGN.clarityPct],
            backgroundColor: ["#66bb6a", "#e0e0e0"],
            borderWidth: 0
          }
        ]
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

  if (driversCtx && !driversChart) {
    driversChart = new Chart(driversCtx, {
      type: "pie",
      data: {
        labels: ["Trust in Bayer", "Education Clarity", "Dealer Influence", "Peer Word-of-mouth"],
        datasets: [
          {
            data: [45, 30, 15, 10],
            backgroundColor: ["#66bb6a", "#9ccc65", "#c5e1a5", "#aed581"],
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 10 }
          }
        }
      }
    });
  }

  if (cityCtx && !cityFarmersChart) {
    cityFarmersChart = new Chart(cityCtx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "Farmers",
            data: [],
            backgroundColor: "#66bb6a"
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { autoSkip: false },
            grid: { display: false }
          },
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

  if (villageCtx && !villageAcresChart) {
    villageAcresChart = new Chart(villageCtx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "Acres",
            data: [],
            backgroundColor: "#42a5f5"
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { autoSkip: false },
            grid: { display: false }
          },
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
}

function updateCharts() {
  initChartsIfNeeded();

  // City chart – top 6 + others
  if (cityFarmersChart && citySummary.length) {
    const top = citySummary.slice(0, 6);
    const others = citySummary.slice(6);
    const labels = top.map(c => c.city);
    const data = top.map(c => c.farmers);
    if (others.length) {
      labels.push("Others");
      data.push(others.reduce((sum, c) => sum + c.farmers, 0));
    }
    cityFarmersChart.data.labels = labels;
    cityFarmersChart.data.datasets[0].data = data;
    cityFarmersChart.update();
  }

  // Village chart – top 6 + others
  if (villageAcresChart && villageSummary.length) {
    const top = villageSummary.slice(0, 6);
    const others = villageSummary.slice(6);
    const labels = top.map(v => v.village);
    const data = top.map(v => v.acres);
    if (others.length) {
      labels.push("Others");
      data.push(others.reduce((sum, v) => sum + v.acres, 0));
    }
    villageAcresChart.data.labels = labels;
    villageAcresChart.data.datasets[0].data = data;
    villageAcresChart.update();
  }
}

// ---------- MAP ----------
function initMap(rows) {
  const mapEl = document.getElementById("route-map");
  if (!mapEl) return;

  if (!map) {
    map = L.map("route-map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
  }

  // Clear existing markers
  mapMarkers.forEach(mk => mk.remove());
  mapMarkers = [];

  const coords = [];

  rows.forEach(row => {
    const lat = safeNumber(row["Latitude"] || row["lat"]);
    const lng = safeNumber(row["Longitude"] || row["lng"]);
    if (!lat || !lng) return;

    const farmers = row.__farmers || 0;
    const acres = row.__acres || 0;
    const popupText = `
      <strong>${row["Village"] || row["Session Location"] || row["Location"] || "Session"}</strong><br />
      From: ${row["From City"] || row["From"] || ""}<br />
      Farmers: ${farmers || ""}<br />
      Acres: ${acres || ""}
    `;

    const radius = Math.max(4, Math.min(18, acres / 200)); // scaled circle radius

    const circle = L.circleMarker([lat, lng], {
      radius,
      color: "#2e7d32",
      fillColor: "#66bb6a",
      fillOpacity: 0.7
    }).addTo(map);

    circle.bindPopup(popupText);
    mapMarkers.push(circle);
    coords.push([lat, lng]);
  });

  if (coords.length) {
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// ---------- ERROR MODAL ----------
function showErrorModal(message) {
  const existing = document.querySelector(".error-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "error-modal";
  modal.innerHTML = `
    <p>${message}</p>
    <button type="button">Close</button>
  `;
  document.body.appendChild(modal);

  const btn = modal.querySelector("button");
  if (btn) {
    btn.addEventListener("click", () => modal.remove());
  }
}

// ---------- MEDIA GALLERY ----------
function initMediaGallery() {
  const gallery = document.getElementById("media-gallery");
  if (!gallery) return;

  gallery.innerHTML = "";

  // Map each unique date to a media slot
  const byTime = new Map();
  uniqueDates.forEach((d, idx) => {
    byTime.set(d.getTime(), idx + 1);
  });

  const used = new Set();
  mediaMeta.forEach(meta => {
    const key = meta.date.getTime();
    if (used.has(key)) return;
    used.add(key);

    const idx = byTime.get(key);
    const imgSrc = `${idx}.jpeg`;
    const vidSrc = `${idx}.mp4`;

    const card = document.createElement("div");
    card.className = "media-card";

    card.innerHTML = `
      <div class="media-thumb-wrap hover-video">
        <img src="${imgSrc}" alt="Session ${idx} photo" onerror="this.style.display='none';" />
        <video muted loop playsinline onerror="this.style.display='none';">
          <source src="${vidSrc}" type="video/mp4" />
        </video>
      </div>
      <div class="media-caption">
        <strong>${meta.title || "Session " + idx}</strong>
        <span>${meta.city || ""} • ${meta.farmers || 0} farmers • ${meta.acres || 0} acres</span>
      </div>
    `;

    card.addEventListener("click", () => openLightbox(imgSrc, vidSrc));
    gallery.appendChild(card);
  });
}

function openLightbox(imgSrc, vidSrc) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lb-img");
  const vid = document.getElementById("lb-video");
  if (!lb || !img || !vid) return;

  img.src = imgSrc;
  vid.src = vidSrc;
  vid.load();

  lb.classList.add("active");

  lb.onclick = () => {
    lb.classList.remove("active");
    img.src = "";
    vid.pause();
    vid.src = "";
  };
}

// ---------- SHARE / COPY ----------
function shareOnX() {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(
    "Buctril Super Farmer Education Drive – interactive fact sheet dashboard (sessions, acres, engagement & insights)."
  );
  const shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${text}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
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

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", () => {
  fillHeroStaticNumbers();
  setupFilterListeners();
  loadCSV();
  initChartsIfNeeded();
  initMediaGallery();
});
