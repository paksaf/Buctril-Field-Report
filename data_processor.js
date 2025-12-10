// ----------------- STATIC CAMPAIGN SUMMARY (for top cards) -----------------
const CAMPAIGN_SUMMARY = {
    period: "Nov–Dec 2025",
    territories: "SKR, RYK, DGK, FSD, GUJ",
    sessions: 19,
    farmers: 567,
    acres: 7265,
    aware: 512,
    awarePct: 90.3,
    usedLastYear: 463,
    usedLastYearPct: 81.7,
    committed: 497,
    committedPct: 87.7,
    estimatedAcres: 6894,
    estimatedAcresPct: 95,
    clarityScore: 2.8,
    clarityMax: 3,
    overallRating: 8.5
};

// ----------------- CONFIG -----------------
let FILTER_START_DATE = "2025-01-05";
let FILTER_END_DATE = "2025-12-31";

let ALLOWED_FROM_CITIES = [];
let ALLOWED_TO_CITIES = [];
let ALLOWED_LOCATIONS = [];

let cityFarmersChartInstance = null;
let villageAcresChartInstance = null;
let uniqueDates = [];
let allRows = [];
let currentFilteredRows = [];

// map marker registry (for click-through from table)
let markerByCoordKey = {};
let buctrilMap = null;

// How many categories to show in charts before grouping to "Others"
const TOP_CATEGORIES_CITY = 6;
const TOP_CATEGORIES_VILLAGE = 6;

document.addEventListener("DOMContentLoaded", () => {
    renderStaticSummary();
    setupFilterListeners();
    loadDashboard();
});

// ----------------- RENDER STATIC SUMMARY -----------------
function renderStaticSummary() {
    const s = CAMPAIGN_SUMMARY;
    setText("summary-period", s.period);
    setText("summary-territories", s.territories);
    setText("summary-sessions", s.sessions);
    setText("summary-farmers", s.farmers.toLocaleString());
    setText("summary-acres", s.acres.toLocaleString() + " acres");
    setText("summary-rating", s.overallRating + "/10");

    setText("kpm-aware", `${s.aware} (${s.awarePct}% )`);
    setText("kpm-used", `${s.usedLastYear} (${s.usedLastYearPct}% )`);
    setText("kpm-committed", `${s.committed} (${s.committedPct}% )`);
    setText("kpm-est-acres", `${s.estimatedAcres.toLocaleString()} (${s.estimatedAcresPct}% of total)` );
    setText("kpm-clarity", `${s.clarityScore}/${s.clarityMax}`);
}

// ----------------- LOAD & NORMALISE CSV -----------------
async function loadDashboard() {
    try {
        const loadingEl = document.getElementById("loading-message");
        if (loadingEl) loadingEl.textContent = "Loading data from sum_sheet.csv…";

        const response = await fetch("sum_sheet.csv?cache=" + Date.now());
        if (!response.ok) {
            throw new Error("Failed to fetch CSV: HTTP " + response.status);
        }
        const csvText = await response.text();

        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                allRows = normalizeRows(results);
                preProcessDates(allRows);
                populateFilterOptions();
                applyFilters();

                if (loadingEl) {
                    loadingEl.textContent =
                        "Data loaded. Use filters to slice the pivot view.";
                }
            },
            error: (err) => {
                console.error("PapaParse error:", err);
                if (loadingEl) {
                    loadingEl.textContent =
                        "Error parsing sum_sheet.csv. Check the file format.";
                }
            },
        });
    } catch (err) {
        console.error("Error loading CSV:", err);
        const loadingEl = document.getElementById("loading-message");
        if (loadingEl) {
            loadingEl.textContent =
                "Failed to load sum_sheet.csv. See browser console for details.";
        }
    }
}

/**
 * CSV structure:
 *   Row 0: technical headers (Summary, Unnamed: 1, ..., etc.)
 *   Row 1: logical headers ("SN", "From City", "City", "Date", "Session Location",
 *                           "Total Farmers", "Total Wheat Acres", "Spot Coordinates", ...)
 *   Row 2+: data rows.
 */
function normalizeRows(results) {
    const rows = results.data || [];
    const fields = (results.meta && results.meta.fields) || [];
    if (!rows.length || !fields.length) return [];

    const headerRow = rows[0]; // row with SN, From City, ...

    // map original field -> human label from header row
    const headerLabels = {};
    fields.forEach((f) => {
        const rawLabel = headerRow[f];
        const label = rawLabel == null ? "" : String(rawLabel).trim();
        headerLabels[f] = label || f;
    });

    const normalized = [];
    for (let i = 1; i < rows.length; i++) {
        const rawRow = rows[i];
        let hasValue = false;
        const obj = {};

        fields.forEach((f) => {
            const label = headerLabels[f];
            if (!label) return;
            const v = rawRow[f];
            if (v !== null && v !== undefined && String(v).trim() !== "") {
                hasValue = true;
            }
            obj[label] = v;
        });

        if (hasValue) normalized.push(obj);
    }

    return normalized;
}

// ----------------- FILTERS -----------------
function setupFilterListeners() {
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    const fromCitySelect = document.getElementById("from-city-filter");

    if (startInput) {
        startInput.addEventListener("change", (e) => {
            FILTER_START_DATE = e.target.value;
        });
    }
    if (endInput) {
        endInput.addEventListener("change", (e) => {
            FILTER_END_DATE = e.target.value;
        });
    }
    if (fromCitySelect) {
        fromCitySelect.addEventListener("change", (e) => {
            ALLOWED_FROM_CITIES = e.target.value ? [e.target.value] : [];
        });
    }
}

function populateFilterOptions() {
    const select = document.getElementById("from-city-filter");
    if (!select) return;

    // remove previous dynamic options
    while (select.options.length > 1) {
        select.remove(1);
    }

    const cities = [
        ...new Set(
            allRows
                .map((r) => (r["From City"] || "").toString().trim())
                .filter(Boolean)
        ),
    ].sort();

    cities.forEach((city) => {
        const option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        select.appendChild(option);
    });
}

function applyFilters() {
    currentFilteredRows = filterRows(allRows);
    updateMetrics(currentFilteredRows);
    updateSessionTable(currentFilteredRows);
    updateCitySummary(currentFilteredRows);
    updateVillageSummary(currentFilteredRows);
    initMap(currentFilteredRows);
    buildCharts(currentFilteredRows);
    updateMediaGallery();
}

function resetFilters() {
    FILTER_START_DATE = "2025-01-05";
    FILTER_END_DATE = "2025-12-31";
    ALLOWED_FROM_CITIES = [];
    ALLOWED_TO_CITIES = [];
    ALLOWED_LOCATIONS = [];

    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    const fromCitySelect = document.getElementById("from-city-filter");

    if (startInput) startInput.value = FILTER_START_DATE;
    if (endInput) endInput.value = FILTER_END_DATE;
    if (fromCitySelect) fromCitySelect.value = "";

    applyFilters();
}

// ----------------- SHARING -----------------
function shareOnX() {
    const url = window.location.href;
    const text =
        "Buctril Farmer Engagement Summary 2025 – dynamic pivot dashboard of farmer sessions.";
    const intent = `https://twitter.com/intent/tweet?url=${encodeURIComponent(
        url
    )}&text=${encodeURIComponent(text)}`;

    if (navigator.share) {
        navigator
            .share({ title: "Buctril Farmer Engagement Summary 2025", text, url })
            .catch(() => {
                window.open(intent, "_blank");
            });
    } else {
        window.open(intent, "_blank");
    }
}

function copyLink() {
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
            .writeText(url)
            .then(() => alert("Link copied to clipboard!"))
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
    alert("Link copied to clipboard!");
}

// ----------------- DATE HELPERS -----------------
function parseDateFlexible(dateStr) {
    if (!dateStr) return null;
    const trimmed = dateStr.toString().trim();

    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const d = new Date(trimmed);
        return isNaN(d.getTime()) ? null : d;
    }

    // dd-MMM (23-Nov, 05-Dec)
    const m = trimmed.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})$/);
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
            dec: 11,
        };
        if (months.hasOwnProperty(monStr)) {
            const year = new Date().getFullYear();
            const d = new Date(year, months[monStr], day);
            return isNaN(d.getTime()) ? null : d;
        }
    }

    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
}

function preProcessDates(rows) {
    const dates = new Set();
    rows.forEach((r) => {
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

function filterRows(rows) {
    const startDateObj = parseDateFlexible(FILTER_START_DATE);
    const endDateObj = parseDateFlexible(FILTER_END_DATE);

    return rows.filter((r) => {
        const dateStr = (r["Date"] || "").toString().trim();
        const rowDateObj = parseDateFlexible(dateStr);

        if (startDateObj && endDateObj && rowDateObj) {
            if (rowDateObj < startDateObj || rowDateObj > endDateObj) {
                return false;
            }
        }

        const fromCity = (r["From City"] || "").toString().trim();
        const toCity = (r["To City"] || r["City"] || "").toString().trim();
        const loc = (
            r["Session Location"] ||
            r["Village / Mauza"] ||
            ""
        )
            .toString()
            .trim();

        if (ALLOWED_FROM_CITIES.length && !ALLOWED_FROM_CITIES.includes(fromCity)) {
            return false;
        }
        if (ALLOWED_TO_CITIES.length && !ALLOWED_TO_CITIES.includes(toCity)) {
            return false;
        }
        if (ALLOWED_LOCATIONS.length && !ALLOWED_LOCATIONS.includes(loc)) {
            return false;
        }
        return true;
    });
}

// ----------------- METRICS -----------------
function updateMetrics(rows) {
    const totalSessions = rows.length;
    const uniqueSN = new Set();
    const cities = new Set();
    const villages = new Set();
    let totalFarmers = 0;
    let totalAcres = 0;
    let sessionsWithCoords = 0;

    rows.forEach((r) => {
        if (r["SN"] !== undefined && r["SN"] !== null && r["SN"] !== "") {
            uniqueSN.add(r["SN"]);
        }

        const fromCity = (r["From City"] || "").toString().trim();
        const toCity = (r["To City"] || r["City"] || "").toString().trim();
        if (fromCity) cities.add(fromCity);
        if (toCity) cities.add(toCity);

        const loc = (
            r["Session Location"] ||
            r["Village / Mauza"] ||
            ""
        )
            .toString()
            .trim();
        if (loc) villages.add(loc);

        const farmers = getFarmers(r);
        const acres = getCropArea(r);
        if (!isNaN(farmers)) totalFarmers += farmers;
        if (!isNaN(acres)) totalAcres += acres;

        const coords = getCoords(r);
        if (coords) sessionsWithCoords += 1;
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

// ----------------- SESSION TABLE -----------------
function updateSessionTable(rows) {
    const tbody = document.getElementById("session-rows");
    if (!tbody) return;
    tbody.innerHTML = "";

    rows.forEach((r) => {
        const dateStr = (r["Date"] || "").toString().trim();
        const dateIndex = uniqueDates.indexOf(dateStr) + 1;

        const coordStr = getCoords(r);
        const coordKey = coordStr ? coordStr.toString().trim() : "";

        let mediaHtml = "N/A";
        if (dateIndex > 0) {
            // Use .jpeg and .mp4 to match uploaded filenames
            const imgName = `${dateIndex}.jpeg`;
            const vidName = `${dateIndex}.mp4`;
            mediaHtml = `
                <a href="${imgName}" target="_blank" class="media-link">🖼️ ${imgName}</a>
                <a href="${vidName}" target="_blank" class="media-link">🎥 ${vidName}</a>
            `;
        }

        const tr = document.createElement("tr");
        tr.className = "session-clickable";
        if (coordKey) {
            tr.dataset.mapId = coordKey;
        }
        tr.innerHTML = `
            <td>${escapeHtml(r["SN"] || "")}</td>
            <td>${escapeHtml(r["Date"] || "")}</td>
            <td>${escapeHtml(r["From City"] || "")}</td>
            <td>${escapeHtml(r["To City"] || r["City"] || "")}</td>
            <td>${escapeHtml(
                r["Session Location"] || r["Village / Mauza"] || ""
            )}</td>
            <td>${escapeHtml(getFarmers(r))}</td>
            <td>${escapeHtml(getCropArea(r))}</td>
            <td>${escapeHtml(coordStr)}</td>
            <td>${escapeHtml(getFeedback(r))}</td>
            <td>${mediaHtml}</td>
        `;
        if (coordKey) {
            tr.addEventListener("click", () => focusOnMap(coordKey));
        }
        tbody.appendChild(tr);
    });
}

// ----------------- CITY & VILLAGE PIVOTS -----------------
function updateCitySummary(rows) {
    const tbody = document.getElementById("city-rows");
    if (!tbody) return;

    const summary = {};
    rows.forEach((r) => {
        const city =
            (r["From City"] || r["City"] || "Unknown").toString().trim() ||
            "Unknown";
        if (!summary[city]) {
            summary[city] = { sessions: 0, farmers: 0, acres: 0 };
        }
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
    rows.forEach((r) => {
        const village =
            (r["Session Location"] || r["Village / Mauza"] || "Unknown")
                .toString()
                .trim() || "Unknown";
        if (!summary[village]) {
            summary[village] = { sessions: 0, farmers: 0, acres: 0 };
        }
        summary[village].sessions += 1;
        const farmers = getFarmers(r);
        const acres = getCropArea(r);
        if (!isNaN(farmers)) summary[village].farmers += farmers;
        if (!isNaN(acres)) summary[village].acres += acres;
    });

    const entries = Object.entries(summary).sort(
        (a, b) => b[1].farmers - a[1].farmers
    );

    // Only top 10 rows to keep mobile display compact
    const topEntries = entries.slice(0, 10);

    tbody.innerHTML = "";
    topEntries.forEach(([village, data], idx) => {
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

// ----------------- MEDIA GALLERY -----------------
function updateMediaGallery() {
    const gallery = document.getElementById("media-gallery");
    if (!gallery) return;

    gallery.innerHTML = "";

    if (!uniqueDates.length) {
        gallery.innerHTML =
            '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">No dates found in the current data.</div>';
        return;
    }

    uniqueDates.forEach((date, idx) => {
        const dateIndex = idx + 1;
        const div = document.createElement("div");
        div.className = "media-item";
        div.innerHTML = `
            <div class="media-placeholder" role="img">${dateIndex}</div>
            <div class="media-label">Date: ${escapeHtml(date)}</div>
            <div class="media-links">
                <a href="${dateIndex}.jpeg" target="_blank" class="media-link">🖼️ ${dateIndex}.jpeg</a>
                <a href="${dateIndex}.mp4"  target="_blank" class="media-link">🎥 ${dateIndex}.mp4</a>
            </div>
        `;
        gallery.appendChild(div);
    });
}

// ----------------- MAP -----------------
function initMap(rows) {
    const mapDiv = document.getElementById("route-map");
    if (!mapDiv) return;

    // reset marker registry
    markerByCoordKey = {};

    if (buctrilMap) {
        buctrilMap.remove();
        buctrilMap = null;
    }

    const points = [];
    rows.forEach((r) => {
        const coord = getCoords(r);
        if (!coord) return;

        let parts = coord
            .split(/[, ]/)
            .map((x) => parseFloat(x.trim()))
            .filter((n) => !isNaN(n));
        if (parts.length < 2) return;

        points.push({
            coordKey: coord.toString().trim(),
            lat: parts[0],
            lon: parts[1],
            village: (
                r["Session Location"] ||
                r["Village / Mauza"] ||
                ""
            )
                .toString()
                .trim(),
            farmers: getFarmers(r),
            acres: getCropArea(r),
            date: (r["Date"] || "").toString().trim(),
        });
    });

    if (!points.length) {
        mapDiv.innerHTML =
            '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size:12px;">No sessions with valid coordinates in the current filter range.</div>';
        return;
    } else {
        mapDiv.innerHTML = ""; // clear "no sessions" text if previously set
    }

    buctrilMap = L.map("route-map", { zoomControl: true });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(buctrilMap);

    const latLngs = [];
    points.forEach((p, idx) => {
        const latLng = L.latLng(p.lat, p.lon);
        latLngs.push(latLng);

        const acres = isNaN(p.acres) ? 0 : p.acres;
        const radiusMeters = 100 + Math.sqrt(acres || 0) * 40;

        L.circle(latLng, {
            radius: radiusMeters,
            fillOpacity: 0.4,
            fillColor: "#6a97ff",
            stroke: true,
            color: "#ffb74d",
            weight: 2,
        }).addTo(buctrilMap);

        const popupHtml = `
            <strong>${escapeHtml(p.village || "Session " + (idx + 1))}</strong><br/>
            Date: ${escapeHtml(p.date)}<br/>
            Farmers: ${formatNumber(p.farmers)}<br/>
            Crop Area: ${formatNumber(acres)} acres
        `;
        const marker = L.marker(latLng).addTo(buctrilMap).bindPopup(popupHtml);

        if (p.coordKey) {
            markerByCoordKey[p.coordKey] = marker;
        }
    });

    if (latLngs.length > 1) {
        L.polyline(latLngs, { weight: 3, opacity: 0.9, color: "#ffb74d" }).addTo(buctrilMap);
        buctrilMap.fitBounds(latLngs, { padding: [32, 32] });
    } else {
        buctrilMap.setView(latLngs[0], 11);
    }
}

// focus from table row
function focusOnMap(coordKey) {
    if (!buctrilMap) return;
    const marker = markerByCoordKey[coordKey];
    if (!marker) return;
    const latLng = marker.getLatLng();
    buctrilMap.setView(latLng, 13);
    marker.openPopup();
}

// ----------------- CHARTS (PIVOT STYLE) -----------------
function buildCharts(rows) {
    if (cityFarmersChartInstance) cityFarmersChartInstance.destroy();
    if (villageAcresChartInstance) villageAcresChartInstance.destroy();

    // City totals
    const cityTotals = {};
    rows.forEach((r) => {
        const city =
            (r["From City"] || r["City"] || "Unknown").toString().trim() ||
            "Unknown";
        const farmers = getFarmers(r);
        if (!cityTotals[city]) cityTotals[city] = 0;
        if (!isNaN(farmers)) cityTotals[city] += farmers;
    });

    const cityPivot = buildTopNWithOthers(cityTotals, TOP_CATEGORIES_CITY);
    const cityCanvas = document.getElementById("cityFarmersChart");
    if (cityCanvas && cityPivot.labels.length) {
        const ctx = cityCanvas.getContext("2d");
        cityFarmersChartInstance = new Chart(ctx, {
            type: "pie",
            data: {
                labels: cityPivot.labels,
                datasets: [
                    {
                        label: "Farmers",
                        data: cityPivot.data,
                    },
                ],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 10 } } },
                },
            },
        });
    }

    // Village totals
    const villageTotals = {};
    rows.forEach((r) => {
        const village =
            (r["Session Location"] || r["Village / Mauza"] || "Unknown")
                .toString()
                .trim() || "Unknown";
        const acres = getCropArea(r);
        if (!villageTotals[village]) villageTotals[village] = 0;
        if (!isNaN(acres)) villageTotals[village] += acres;
    });

    const villagePivot = buildTopNWithOthers(
        villageTotals,
        TOP_CATEGORIES_VILLAGE
    );
    const villageCanvas = document.getElementById("villageAcresChart");
    if (villageCanvas && villagePivot.labels.length) {
        const ctx = villageCanvas.getContext("2d");
        villageAcresChartInstance = new Chart(ctx, {
            type: "pie",
            data: {
                labels: villagePivot.labels,
                datasets: [
                    {
                        label: "Acres",
                        data: villagePivot.data,
                    },
                ],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 10 } } },
                },
            },
        });
    }
}

/**
 * Convert an object { key: value } into top N + Others arrays for charts.
 */
function buildTopNWithOthers(map, topN) {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return { labels: [], data: [] };

    if (entries.length <= topN) {
        return {
            labels: entries.map((e) => e[0]),
            data: entries.map((e) => e[1]),
        };
    }

    const top = entries.slice(0, topN - 1);
    const rest = entries.slice(topN - 1);
    const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

    const labels = top.map((e) => e[0]).concat(["Others"]);
    const data = top.map((e) => e[1]).concat([othersValue]);

    return { labels, data };
}

// ----------------- HELPERS -----------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function parseNumber(value) {
    if (value === undefined || value === null) return NaN;
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
        "crop area",
    ]);
    if (!key) return NaN;
    return parseNumber(row[key]);
}

function getFeedback(row) {
    const key = findField(row, [
        "feedback",
        "observation",
        "remark",
        "comment",
    ]);
    if (!key) return "";
    return (row[key] || "").toString();
}

function getCoords(row) {
    const coordKey = findField(row, ["spot coordinates", "coord", "gps"]);
    if (coordKey && row[coordKey]) {
        return row[coordKey].toString();
    }
    const latKey = findField(row, ["lat"]);
    const lonKey = findField(row, ["lon", "lng", "long"]);
    if (latKey && lonKey && row[latKey] && row[lonKey]) {
        return row[latKey].toString() + ", " + row[lonKey].toString();
    }
    return "";
}

function formatNumber(num) {
    if (isNaN(num)) return "–";
    return Math.round(num).toLocaleString();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
