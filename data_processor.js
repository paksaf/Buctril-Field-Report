// ----------------- CONFIG -----------------
let FILTER_START_DATE = "2025-01-05";
let FILTER_END_DATE = "2025-12-31";

let ALLOWED_FROM_CITIES = [];
let ALLOWED_TO_CITIES = [];
let ALLOWED_LOCATIONS = [];

// Executive campaign summary (static from marketing analysis)
const CAMPAIGN_SUMMARY = {
    period: "Nov 23 – Dec 8, 2025",
    territories: "Ghotki/Ubaro, Muzaffar Ghar, Mianwali, Sargodha, Phalia & others",

    sessionsExecuted: 26,
    sessionsPlanned: 34,
    sessionsCompletionPct: 76, // 26/34
    farmers: 1123,
    acres: 19025,

    clarityScore: 2.9,
    clarityMax: 3.0,
    clarityPct: 97,
    definiteIntentPct: 88,

    influencers: 201,
    overallRating: 8.5
};

let cityFarmersChartInstance = null;
let villageAcresChartInstance = null;
let kpiFunnelChartInstance = null;
let ratingChartInstance = null;

let uniqueDates = [];
let allRows = [];
let currentFilteredRows = [];

// How many categories to show in charts before grouping to "Others"
const TOP_CATEGORIES_CITY = 6;
const TOP_CATEGORIES_VILLAGE = 6;

document.addEventListener("DOMContentLoaded", () => {
    setupFilterListeners();
    renderStaticSummary();
    loadDashboard();
});

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
            }
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
 * CSV structure (as used in the Excel summary sheet):
 *   Row 0: technical headers
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

    while (select.options.length > 1) {
        select.remove(1);
    }

    const cities = [
        ...new Set(
            allRows
                .map((r) => (r["From City"] || "").toString().trim())
                .filter(Boolean)
        )
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
            dec: 11
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

        let mediaHtml = "N/A";
        if (dateIndex > 0) {
            const imgName = `${dateIndex}.jpeg`;
            const vidName = `${dateIndex}.mp4`;
            mediaHtml = `
                <a href="${imgName}" target="_blank" class="media-link">🖼️ ${imgName}</a>
                <a href="${vidName}" target="_blank" class="media-link">🎥 ${vidName}</a>
            `;
        }

        const tr = document.createElement("tr");
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
            <td>${escapeHtml(getCoords(r))}</td>
            <td>${escapeHtml(getFeedback(r))}</td>
            <td>${mediaHtml}</td>
        `;
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
        const imgName = `${dateIndex}.jpeg`;
        const vidName = `${dateIndex}.mp4`;

        const div = document.createElement("div");
        div.className = "media-item";
        div.innerHTML = `
            <div class="media-placeholder" role="img" aria-label="Media for ${escapeHtml(
                date
            )}">
                <div class="media-thumb" data-index="${dateIndex}">
                    <img src="${imgName}" alt="Session media ${dateIndex}" loading="lazy" />
                    <video src="${vidName}" muted playsinline loop preload="metadata"></video>
                    <div class="media-thumb-overlay">#${dateIndex}</div>
                </div>
            </div>
            <div class="media-label">Date: ${escapeHtml(date)}</div>
            <div class="media-links">
                <a href="${imgName}" target="_blank" class="media-link">🖼️ Open image</a>
                <a href="${vidName}" target="_blank" class="media-link">🎥 Open video</a>
            </div>
        `;
        gallery.appendChild(div);
    });

    initMediaHoverBehaviour();
}

// Hover / tap behaviour for media thumbnails, plus auto-pause off-screen
function initMediaHoverBehaviour() {
    const thumbs = document.querySelectorAll(".media-thumb");
    if (!thumbs.length) return;

    let observer = null;
    if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const thumb = entry.target;
                if (!entry.isIntersecting && thumb._pauseVideo) {
                    thumb._pauseVideo();
                }
            });
        }, { threshold: 0.1 });
    }

    thumbs.forEach((thumb) => {
        const video = thumb.querySelector("video");
        if (!video) return;

        const img = thumb.querySelector("img");

        const playVideo = () => {
            thumb.classList.add("playing");
            video.muted = true;
            video
                .play()
                .catch(() => {
                    // ignore autoplay issues
                });
        };

        const pauseVideo = () => {
            video.pause();
            video.currentTime = 0;
            thumb.classList.remove("playing");
        };

        thumb._pauseVideo = pauseVideo;

        thumb.addEventListener("mouseenter", playVideo);
        thumb.addEventListener("mouseleave", pauseVideo);

        // Tap / click toggle for mobile
        thumb.addEventListener("click", () => {
            if (video.paused) {
                playVideo();
            } else {
                pauseVideo();
            }
        });

        // If video fails to load, fall back to static image only
        video.addEventListener("error", () => {
            pauseVideo();
            video.style.display = "none";
            if (img) img.style.display = "block";
        });

        if (observer) observer.observe(thumb);
    });
}

// ----------------- MAP -----------------
function initMap(rows) {
    const mapDiv = document.getElementById("route-map");
    if (!mapDiv) return;

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
            village: (
                r["Session Location"] ||
                r["Village / Mauza"] ||
                ""
            )
                .toString()
                .trim(),
            farmers: getFarmers(r),
            acres: getCropArea(r),
            date: (r["Date"] || "").toString().trim()
        });
    });

    if (!points.length) {
        mapDiv.innerHTML =
            '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size:12px;">No sessions with valid coordinates in the current filter range.</div>';
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
        const radiusMeters = 100 + Math.sqrt(acres || 0) * 40;

        L.circle(latLng, {
            radius: radiusMeters,
            fillOpacity: 0.4,
            fillColor: "#6a97ff",
            stroke: true,
            color: "#ffb74d",
            weight: 2
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
        L.polyline(latLngs, { weight: 3, opacity: 0.9, color: "#ffb74d" }).addTo(map);
        map.fitBounds(latLngs, { padding: [32, 32] });
    } else {
        map.setView(latLngs[0], 11);
    }
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
                        data: cityPivot.data
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 10 } } }
                }
            }
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
                        data: villagePivot.data
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 10 } } }
                }
            }
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
            data: entries.map((e) => e[1])
        };
    }

    const top = entries.slice(0, topN - 1);
    const rest = entries.slice(topN - 1);
    const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

    const labels = top.map((e) => e[0]).concat(["Others"]);
    const data = top.map((e) => e[1]).concat([othersValue]);

    return { labels, data };
}

// ----------------- EXECUTIVE SUMMARY RENDERING -----------------
function renderStaticSummary() {
    const s = CAMPAIGN_SUMMARY;

    // Top pills
    setText("summary-period", s.period);
    setText("summary-territories", s.territories);
    setText(
        "summary-sessions",
        `${s.sessionsExecuted} of ${s.sessionsPlanned} planned`
    );
    setText("summary-farmers", `${s.farmers.toLocaleString()} wheat farmers`);
    setText("summary-acres", `${s.acres.toLocaleString()} acres`);
    setText("summary-rating", `${s.overallRating} / 10`);

    // Executive metric table values
    setText(
        "kpm-sessions-val",
        `${s.sessionsExecuted} / ${s.sessionsPlanned} sessions`
    );
    setText(
        "kpm-farmers-val",
        `${s.farmers.toLocaleString()} farmers reached`
    );
    setText(
        "kpm-acres-val",
        `${s.acres.toLocaleString()} acres represented`
    );
    setText(
        "kpm-clarity-val",
        `${s.clarityScore.toFixed(1)} / ${s.clarityMax.toFixed(
            1
        )} (${s.clarityPct}% clarity)`
    );
    setText(
        "kpm-intent-val",
        `${s.definiteIntentPct}% avg. definite use intent`
    );
    setText(
        "kpm-influencers-val",
        `${s.influencers.toLocaleString()} key farmers`
    );

    buildSummaryCharts();
    initMiniBars();
}

function buildSummaryCharts() {
    const s = CAMPAIGN_SUMMARY;

    if (kpiFunnelChartInstance) kpiFunnelChartInstance.destroy();
    if (ratingChartInstance) ratingChartInstance.destroy();

    const funnelCanvas = document.getElementById("kpiFunnelChart");
    if (funnelCanvas) {
        const ctxFunnel = funnelCanvas.getContext("2d");
        kpiFunnelChartInstance = new Chart(ctxFunnel, {
            type: "bar",
            data: {
                labels: ["Message clarity", "Definite use intent"],
                datasets: [
                    {
                        label: "% of farmers",
                        data: [s.clarityPct, s.definiteIntentPct]
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { stepSize: 20 }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    const ratingCanvas = document.getElementById("campaignRatingChart");
    if (ratingCanvas) {
        const ctxRating = ratingCanvas.getContext("2d");
        ratingChartInstance = new Chart(ctxRating, {
            type: "doughnut",
            data: {
                labels: ["Score", "Remaining"],
                datasets: [
                    {
                        data: [s.overallRating, 10 - s.overallRating]
                    }
                ]
            },
            options: {
                responsive: true,
                cutout: "60%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { font: { size: 10 } }
                    }
                }
            }
        });
    }
}

// Animate / set widths for executive-summary bars
function initMiniBars() {
    const fills = document.querySelectorAll(".bar-fill[data-percent]");
    fills.forEach((el) => {
        const pct = parseFloat(el.dataset.percent);
        const clamped = isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
        el.style.width = clamped + "%";
    });
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
