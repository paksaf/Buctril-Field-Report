// ----------------- CONFIG: DEFAULT FILTERS -----------------
// Dates in the CSV can be "YYYY-MM-DD" or like "23-Nov". We'll normalize them.
let FILTER_START_DATE = "2025-01-05"; // inclusive
let FILTER_END_DATE = "2025-12-31";   // inclusive

// If you want to restrict to particular cities or villages, put names here.
// Leave arrays empty [] to include all values.
let ALLOWED_FROM_CITIES = []; // e.g. ["Multan", "Khanewal"]
let ALLOWED_TO_CITIES = [];   // e.g. ["Chichawatni"]
let ALLOWED_LOCATIONS = [];   // e.g. ["Basti Joriya", "Chak 10"]

let cityFarmersChartInstance = null;
let villageAcresChartInstance = null;
let uniqueDates = [];          // Stores the sorted, unique dates for media naming
let allRows = [];              // Cache all parsed + normalized rows
let currentFilteredRows = [];  // Current filtered data

document.addEventListener("DOMContentLoaded", () => {
    setupFilterListeners();
    loadDashboard();
});

// ----------------- MAIN LOAD -----------------
async function loadDashboard() {
    try {
        const loadingEl = document.getElementById("loading-message");
        if (loadingEl) {
            loadingEl.textContent = "Loading data from sum_sheet.csv…";
        }

        // Fetch CSV with a cache-buster to ensure the latest version is loaded on GitHub Pages
        const response = await fetch("sum_sheet.csv?cache=" + Date.now());
        if (!response.ok) {
            throw new Error("Failed to fetch CSV: HTTP " + response.status);
        }
        const csvText = await response.text();

        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const normalized = normalizeRows(results);
                allRows = normalized || [];

                // Pre-process dates (on all data) so media index (1.jpg, 1.mov, etc.) is stable
                preProcessDates(allRows);

                // Populate filters after data is available
                populateFilterOptions();

                // Initial load with defaults
                applyFilters();

                if (loadingEl) {
                    loadingEl.textContent = "Data loaded. Adjust filters to explore sessions.";
                }
            },
            error: (err) => {
                console.error("PapaParse error:", err);
                if (loadingEl) {
                    loadingEl.textContent = "Error parsing sum_sheet.csv. Check the file format.";
                }
                document.body.innerHTML +=
                    '<div style="color: red; text-align: center;">Error parsing CSV. Ensure sum_sheet.csv is in the repo root.</div>';
            },
        });
    } catch (err) {
        console.error("Error loading CSV:", err);
        const loadingEl = document.getElementById("loading-message");
        if (loadingEl) {
            loadingEl.textContent = "Failed to load data. Check console for details.";
        }
        document.body.innerHTML +=
            '<div style="color: red; text-align: center;">Failed to load data. Check console for details.</div>';
    }
}

// ----------------- CSV NORMALIZATION -----------------
/**
 * Your sum_sheet.csv has:
 * - Real header row in the *first data row* (values: "SN", "From City", "City", "Date", etc.)
 * - "Summary, Unnamed: 1, Unnamed: 2, ..." as technical header names.
 *
 * This function converts that into:
 *   { "SN": "0", "From City": "Multan", "City": "Multan", "Date": "23-Nov", ... }
 */
function normalizeRows(results) {
    const rows = results.data || [];
    const fields = (results.meta && results.meta.fields) || [];

    if (!rows.length || !fields.length) return [];

    const firstRow = rows[0] || {};
    const firstValues = Object.values(firstRow).map((v) =>
        (v || "").toString().toLowerCase()
    );

    // Heuristic: if first data row contains "sn" or "from city" or "session location", treat it as header row
    const looksLikeHeaderRow =
        firstValues.some((v) => v === "sn") ||
        firstValues.some((v) => v.includes("from city")) ||
        firstValues.some((v) => v.includes("session location"));

    if (!looksLikeHeaderRow) {
        // Already in normal "one row per session" shape
        return rows;
    }

    // Build a map: originalFieldName -> "nice" header label from firstRow
    const headerLabels = {};
    fields.forEach((f) => {
        const label = (firstRow[f] || f || "").toString().trim();
        headerLabels[f] = label || f;
    });

    const normalized = [];
    for (let i = 1; i < rows.length; i++) {
        const rawRow = rows[i];
        // Skip completely empty rows
        const isEmpty = fields.every((f) => {
            const val = rawRow[f];
            return val === null || val === undefined || String(val).trim() === "";
        });
        if (isEmpty) continue;

        const obj = {};
        fields.forEach((f) => {
            const label = headerLabels[f];
            if (!label) return;
            obj[label] = rawRow[f];
        });
        normalized.push(obj);
    }

    return normalized;
}

// ----------------- DYNAMIC FILTERS -----------------
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

    // Remove any existing dynamic options (keep the first "All")
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

// ----------------- SHARING FUNCTIONS -----------------
function shareOnX() {
    const url = window.location.href;
    const text = "Buctril Farmer Engagement Summary 2025 - Dynamic dashboard of farmer sessions.";
    const shareUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(
        url
    )}&text=${encodeURIComponent(text)}`;

    if (navigator.share) {
        navigator
            .share({
                title: "Buctril Farmer Engagement Summary 2025",
                text: text,
                url: url,
            })
            .catch(() => {
                // If user cancels share, do nothing
            });
    } else {
        window.open(shareUrl, "_blank");
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

// ----------------- DATE UTILITIES -----------------
function parseDateFlexible(dateStr) {
    if (!dateStr) return null;
    const trimmed = dateStr.toString().trim();

    // 1) ISO "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const d = new Date(trimmed);
        return isNaN(d.getTime()) ? null : d;
    }

    // 2) "DD-MMM" e.g. "23-Nov" / "05-Dec"
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
            const year = new Date().getFullYear(); // assume current year for ordering
            const d = new Date(year, months[monStr], day);
            return isNaN(d.getTime()) ? null : d;
        }
    }

    // 3) Fallback: let JS try
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
}

// ----------------- DATE PRE-PROCESSING FOR MEDIA -----------------
function preProcessDates(rows) {
    const dates = new Set();
    rows.forEach((r) => {
        const dateStr = (r["Date"] || "").toString().trim();
        if (dateStr) dates.add(dateStr);
    });

    uniqueDates = Array.from(dates).sort((a, b) => {
        const da = parseDateFlexible(a);
        const db = parseDateFlexible(b);
        if (da && db) return da - db;
        return a.localeCompare(b);
    });
}

// ----------------- FILTERING -----------------
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
        // Some files have "City" instead of "To City"
        const toCity = (
            r["To City"] ||
            r["City"] ||
            ""
        )
            .toString()
            .trim();
        const loc = (r["Session Location"] || r["Village / Mauza"] || "")
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
        const toCity = (
            r["To City"] ||
            r["City"] ||
            ""
        )
            .toString()
            .trim();

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

// ----------------- TABLES -----------------
function updateSessionTable(rows) {
    const tbody = document.getElementById("session-rows");
    if (!tbody) return;
    tbody.innerHTML = "";

    rows.forEach((r) => {
        const dateStr = (r["Date"] || "").toString().trim();
        // Find the 1-based index of this date for file naming (e.g., first date is #1)
        const dateIndex = uniqueDates.indexOf(dateStr) + 1;

        let mediaHtml = "N/A";
        if (dateIndex > 0) {
            const imgName = `${dateIndex}.jpg`;
            const vidName = `${dateIndex}.mov`;
            mediaHtml = `
                <a href="${imgName}" target="_blank" class="media-link" title="View Image ${dateIndex}" aria-label="Image for date ${escapeHtml(dateStr)}">🖼️ ${imgName}</a>
                <a href="${vidName}" target="_blank" class="media-link" title="View Video ${dateIndex}" aria-label="Video for date ${escapeHtml(dateStr)}">🎥 ${vidName}</a>
            `;
        }

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
            <td>${mediaHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updateVillageSummary(rows) {
    const tbody = document.getElementById("village-rows");
    if (!tbody) return;

    const summary = {};
    rows.forEach((r) => {
        const villageRaw =
            (r["Session Location"] || r["Village / Mauza"] || "").toString().trim() ||
            "Unknown";
        const village = villageRaw || "Unknown";

        if (!summary[village]) {
            summary[village] = {
                sessions: 0,
                farmers: 0,
                acres: 0,
                feedbackSamples: [],
            };
        }
        summary[village].sessions += 1;

        const farmers = getFarmers(r);
        const acres = getCropArea(r);
        if (!isNaN(farmers)) summary[village].farmers += farmers;
        if (!isNaN(acres)) summary[village].acres += acres;

        const fb = getFeedback(r);
        if (fb && summary[village].feedbackSamples.length < 3) {
            summary[village].feedbackSamples.push(fb);
        }
    });

    const entries = Object.entries(summary).sort(
        (a, b) => b[1].farmers - a[1].farmers
    );

    tbody.innerHTML = "";
    entries.forEach(([village, data], idx) => {
        const tr = document.createElement("tr");
        const feedbackText =
            data.feedbackSamples.length > 0
                ? data.feedbackSamples.join(" | ")
                : "";
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${escapeHtml(village)}</td>
            <td>${data.sessions}</td>
            <td>${formatNumber(data.farmers)}</td>
            <td>${formatNumber(data.acres)}</td>
            <td>${escapeHtml(feedbackText)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ----------------- MEDIA GALLERY -----------------
function updateMediaGallery() {
    const gallery = document.getElementById("media-gallery");
    if (!gallery) return;

    gallery.innerHTML = "";

    if (uniqueDates.length === 0) {
        gallery.innerHTML =
            '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">No dates found in sum_sheet.csv.</div>';
        return;
    }

    uniqueDates.forEach((date, idx) => {
        const dateIndex = idx + 1;
        const div = document.createElement("div");
        div.className = "media-item";
        div.innerHTML = `
            <div class="media-placeholder" role="img" aria-label="Placeholder for media on ${escapeHtml(
                date
            )}">${dateIndex}</div>
            <div class="media-label">Date: ${escapeHtml(date)}</div>
            <div class="media-links">
                <a href="${dateIndex}.jpg" target="_blank" class="media-link">🖼️ View Image</a>
                <a href="${dateIndex}.mov" target="_blank" class="media-link">🎥 View Video</a>
            </div>
        `;
        gallery.appendChild(div);
    });
}

// ----------------- MAP -----------------
function initMap(rows) {
    const mapDiv = document.getElementById("route-map");
    if (!mapDiv) return;

    // Destroy previous map if exists (for filter changes)
    let map = window.buctrilMap;
    if (map) {
        map.remove();
        map = null;
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
            lat: parts[0],
            lon: parts[1],
            village: (r["Session Location"] || r["Village / Mauza"] || "")
                .toString()
                .trim(),
            farmers: getFarmers(r),
            acres: getCropArea(r),
            date: (r["Date"] || "").toString().trim(),
        });
    });

    if (!points.length) {
        mapDiv.innerHTML =
            '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No sessions with valid coordinates in the current filter range.</div>';
        return;
    }

    map = L.map("route-map", {
        zoomControl: true,
    });
    window.buctrilMap = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const latLngs = [];
    points.forEach((p, idx) => {
        const latLng = L.latLng(p.lat, p.lon);
        latLngs.push(latLng);

        const acres = isNaN(p.acres) ? 0 : p.acres;
        // Scale circle radius based on sqrt(acres) so big sessions stand out without exploding the map
        const radiusMeters = 100 + Math.sqrt(acres || 0) * 40;

        L.circle(latLng, {
            radius: radiusMeters,
            fillOpacity: 0.4,
            fillColor: "#6a97ff",
            stroke: true,
            color: "#ffb74d",
            weight: 2,
        }).addTo(map);

        const popupHtml = `
            <strong>${escapeHtml(p.village || "Session " + (idx + 1))}</strong><br/>
            Date: ${escapeHtml(p.date)}<br/>
            Farmers: ${formatNumber(p.farmers)}<br/>
            Crop Area: ${formatNumber(acres)} acres
        `;
        L.marker(latLng).addTo(map).bindPopup(popupHtml);
    });

    if (latLngs.length > 1) {
        L.polyline(latLngs, { weight: 3, opacity: 0.9, color: "#ffb74d" }).addTo(
            map
        );
        map.fitBounds(latLngs, { padding: [40, 40] });
    } else {
        map.setView(latLngs[0], 12);
    }
}

// ----------------- CHARTS -----------------
function buildCharts(rows) {
    if (cityFarmersChartInstance) cityFarmersChartInstance.destroy();
    if (villageAcresChartInstance) villageAcresChartInstance.destroy();

    // Farmers by From City
    const cityTotals = {};
    rows.forEach((r) => {
        const city = (r["From City"] || "Unknown").toString().trim() || "Unknown";
        const farmers = getFarmers(r);
        if (!cityTotals[city]) cityTotals[city] = 0;
        if (!isNaN(farmers)) cityTotals[city] += farmers;
    });

    const cityLabels = Object.keys(cityTotals);
    const cityData = cityLabels.map((c) => cityTotals[c]);
    const cityCanvas = document.getElementById("cityFarmersChart");
    if (cityCanvas && cityLabels.length) {
        const cityCtx = cityCanvas.getContext("2d");
        cityFarmersChartInstance = new Chart(cityCtx, {
            type: "bar",
            data: {
                labels: cityLabels,
                datasets: [
                    {
                        label: "Farmers Reached",
                        data: cityData,
                        backgroundColor: "rgba(255, 183, 77, 0.7)",
                        borderColor: "rgba(255, 183, 77, 1)",
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: "#e5e9f5" },
                    },
                    x: { ticks: { color: "#e5e9f5" } },
                },
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                },
                animation: { duration: 900 },
            },
        });
    }

    // Acres by Village
    const villageSummary = {};
    rows.forEach((r) => {
        const village = (r["Session Location"] || r["Village / Mauza"] || "Unknown")
            .toString()
            .trim() || "Unknown";
        if (!villageSummary[village]) villageSummary[village] = 0;
        const acres = getCropArea(r);
        if (!isNaN(acres)) villageSummary[village] += acres;
    });

    const villageLabels = Object.keys(villageSummary);
    const villageData = villageLabels.map((v) => villageSummary[v]);
    const villageCanvas = document.getElementById("villageAcresChart");
    if (villageCanvas && villageLabels.length) {
        const villageCtx = villageCanvas.getContext("2d");
        villageAcresChartInstance = new Chart(villageCtx, {
            type: "bar",
            data: {
                labels: villageLabels,
                datasets: [
                    {
                        label: "Crop Area (Acres)",
                        data: villageData,
                        backgroundColor: "rgba(106, 151, 255, 0.7)",
                        borderColor: "rgba(106, 151, 255, 1)",
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: "#e5e9f5" },
                    },
                    x: { ticks: { color: "#e5e9f5" } },
                },
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                },
                animation: { duration: 900 },
            },
        });
    }
}

// ----------------- HELPERS -----------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

function parseNumber(value) {
    if (value === undefined || value === null) return NaN;
    const n = parseFloat(value.toString().replace(/,/g, "").trim());
    return isNaN(n) ? NaN : n;
}

// Find a column whose name contains any of the given keywords (case-insensitive)
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
    const key = findField(row, ["total wheat acres", "acre", "area", "crop area"]);
    if (!key) return NaN;
    return parseNumber(row[key]);
}

function getFeedback(row) {
    const key = findField(row, ["feedback", "observation", "remark", "comment"]);
    if (!key) return "";
    return (row[key] || "").toString();
}

function getCoords(row) {
    // 1) Single column like "Spot Coordinates", "Coordinates", "GPS", etc.
    const coordKey = findField(row, ["coord", "gps"]);
    if (coordKey && row[coordKey]) {
        return row[coordKey].toString();
    }
    // 2) Separate lat / lon columns
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
