// data_processor.js
// Reads sum_sheet.csv and drives the map, KPIs, charts and table.

const CSV_FILE = "sum_sheet.csv";

let allSessions = [];
let map;
let markers = [];
let routeLine = null;
let charts = {};

/* ---------- Helpers ---------- */

function numFromStr(value) {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function percentFromStr(value) {
  if (!value) return NaN;
  const cleaned = String(value).replace(/[%\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? NaN : n;
}

function parseCoords(text) {
  if (!text) return null;
  const matches = String(text).match(/-?\d+(\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  return [parseFloat(matches[0]), parseFloat(matches[1])];
}

/* ---------- Map setup ---------- */

function initMap() {
  map = L.map("map").setView([28.0, 69.0], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
}

function clearMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
}

function refreshMarkers() {
  const dayFilter = document.getElementById("dayFilter").value;
  const metricFilter = document.getElementById("metricFilter").value;

  clearMarkers();

  const filtered =
    dayFilter === "all"
      ? allSessions
      : allSessions.filter((s) => s.dayKey === dayFilter);

  const coordsForRoute = [];

  filtered.forEach((session) => {
    if (!session.lat || !session.lng) return;

    let radius = 8;
    if (metricFilter === "farmers") {
      radius = Math.max(4, Math.sqrt(session.totalFarmers) * 1.8);
    } else if (metricFilter === "acres") {
      radius = Math.max(4, Math.sqrt(session.totalWheatAcres) * 0.9);
    }

    let fillColor = "#3498db";
    let rate = session.awarenessRate;

    if (metricFilter === "definite") {
      rate = session.definiteUseRate;
    }
    if (!isNaN(rate)) {
      if (rate >= 80) fillColor = "#2ecc71";
      else if (rate >= 60) fillColor = "#f1c40f";
      else if (rate >= 40) fillColor = "#e67e22";
      else fillColor = "#e74c3c";
    }

    const marker = L.circleMarker([session.lat, session.lng], {
      radius,
      fillColor,
      color: "#123456",
      weight: 2,
      opacity: 0.9,
      fillOpacity: 0.7,
    }).addTo(map);

    const popupHtml = `
      <strong>${session.sessionLocation || "Session"}</strong><br/>
      City: ${session.city || "-"}<br/>
      Date: ${session.activityDate || "-"}<br/>
      Farmers: ${session.totalFarmers}<br/>
      Wheat acres: ${session.totalWheatAcres.toLocaleString()}<br/>
      Awareness: ${
        isNaN(session.awarenessRate) ? "N/A" : session.awarenessRate + "%"
      }<br/>
      Definite use: ${
        isNaN(session.definiteUseRate) ? "N/A" : session.definiteUseRate + "%"
      }
    `;

    marker.bindPopup(popupHtml);
    markers.push(marker);
    coordsForRoute.push([session.lat, session.lng]);
  });

  // Optionally update travel route polyline if "Show Travel Route" already clicked
  if (routeLine && coordsForRoute.length > 1) {
    routeLine.setLatLngs(coordsForRoute);
  }
}

/* ---------- Data loading & shaping ---------- */

function processCsvRows(rows) {
  if (!rows || rows.length < 2) return;

  const headerRow = rows[1]; // first row is "Summary", second is header
  const colIndex = {};
  headerRow.forEach((h, idx) => {
    colIndex[h.trim()] = idx;
  });

  function get(row, colName) {
    const idx = colIndex[colName];
    if (idx === undefined) return "";
    return row[idx];
  }

  const dataRows = rows.slice(2).filter((row) =>
    row.some((c) => c !== null && c !== undefined && String(c).trim() !== "")
  );

  allSessions = dataRows.map((row) => {
    const coordStr = get(row, "Spot Coordinates");
    const coords = parseCoords(coordStr);

    return {
      sn: get(row, "SN"),
      fromCity: get(row, "From City"),
      city: get(row, "City"),
      dateText: get(row, "Date"),
      roadDay: get(row, "Day"),
      sessionLocation: get(row, "Session Location"),
      activityDate: get(row, "Activity Date"),
      activityDay: get(row, "Day"), // same name, later in header, but OK
      salesRep: get(row, "Sales Rep Name"),
      tehsil: get(row, "Tehsil / District"),
      coordinatesRaw: coordStr,
      totalFarmers: numFromStr(get(row, "Total Farmers")),
      totalWheatFarmers: numFromStr(get(row, "Total Wheat Farmers")),
      totalWheatAcres: numFromStr(get(row, "Total Wheat Acres")),
      awarenessRate: percentFromStr(get(row, "Awareness Rate")),
      usedLastYearRate: percentFromStr(get(row, "Used Last Year Rate")),
      definiteUseRate: percentFromStr(get(row, "Definite Use Rate")),
      maybeRate: percentFromStr(get(row, "Maybe Rate")),
      notInterestedRate: percentFromStr(get(row, "Not Interested Rate")),
      estBuctrilAcres: numFromStr(
        get(row, "Estimated Buctril Acres from this Session")
      ),
      topReasonUse: get(row, "Top Reason Use"),
      topReasonNotUse: get(row, "Top Reason Not to Use in past"),
      distanceKm: numFromStr(get(row, "Approximate Distance (km)")),
      lat: coords ? coords[0] : null,
      lng: coords ? coords[1] : null,
    };
  });

  // Day key used in dropdown (Activity Date + City)
  allSessions.forEach((s) => {
    const label =
      (s.activityDate || s.dateText || "") +
      (s.city ? " – " + s.city : "");
    s.dayLabel = label.trim() || "Day " + s.sn;
    s.dayKey = s.dayLabel;
  });
}

/* ---------- KPIs, sessions list, table ---------- */

function updateKpis() {
  if (!allSessions.length) return;

  const totalFarmers = allSessions.reduce(
    (sum, s) => sum + (s.totalFarmers || 0),
    0
  );
  const totalAcres = allSessions.reduce(
    (sum, s) => sum + (s.totalWheatAcres || 0),
    0
  );

  const awarenessVals = allSessions
    .map((s) => s.awarenessRate)
    .filter((x) => !isNaN(x));
  const definiteVals = allSessions
    .map((s) => s.definiteUseRate)
    .filter((x) => !isNaN(x));

  const avgAwareness =
    awarenessVals.length > 0
      ? awarenessVals.reduce((a, b) => a + b, 0) / awarenessVals.length
      : NaN;
  const avgDefinite =
    definiteVals.length > 0
      ? definiteVals.reduce((a, b) => a + b, 0) / definiteVals.length
      : NaN;

  document.getElementById("totalFarmers").textContent =
    totalFarmers.toLocaleString();
  document.getElementById("totalAcres").textContent =
    totalAcres.toLocaleString() + " acres";
  document.getElementById("avgAwareness").textContent = isNaN(avgAwareness)
    ? "N/A"
    : avgAwareness.toFixed(1) + "%";
  document.getElementById("definiteUse").textContent = isNaN(avgDefinite)
    ? "N/A"
    : avgDefinite.toFixed(1) + "%";

  const kpiContainer = document.getElementById("kpiMetrics");
  const sessionsWithRepeat = allSessions.filter(
    (s) => !isNaN(s.usedLastYearRate) && s.usedLastYearRate > 0
  ).length;
  const maybeHeavy = allSessions.filter(
    (s) => !isNaN(s.maybeRate) && s.maybeRate > 30
  ).length;
  const avgAcPerFarmer =
    totalFarmers > 0 ? (totalAcres / totalFarmers).toFixed(1) : "0.0";

  kpiContainer.innerHTML = `
    <div class="kpi-item">
      <div class="kpi-value">${allSessions.length}</div>
      <div class="kpi-label">Sessions held</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${totalFarmers.toLocaleString()}</div>
      <div class="kpi-label">Farmers reached</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${avgAcPerFarmer}</div>
      <div class="kpi-label">Avg acres / farmer</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${sessionsWithRepeat}</div>
      <div class="kpi-label">Sessions with strong repeat usage</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${maybeHeavy}</div>
      <div class="kpi-label">High “Maybe” sessions (follow-up)</div>
    </div>
  `;
}

function updateSessionList() {
  const container = document.getElementById("sessionList");
  const group = {};

  allSessions.forEach((s) => {
    const key = s.dayLabel;
    if (!group[key]) group[key] = [];
    group[key].push(s);
  });

  let html = "";
  Object.entries(group).forEach(([dayLabel, sessions]) => {
    const farmers = sessions.reduce(
      (sum, s) => sum + (s.totalFarmers || 0),
      0
    );
    const acres = sessions.reduce(
      (sum, s) => sum + (s.totalWheatAcres || 0),
      0
    );
    const locs = sessions
      .map((s) => s.sessionLocation)
      .filter(Boolean)
      .join(", ");

    html += `
      <div class="session-item">
        <strong>${dayLabel}</strong>
        <p>Sessions: ${sessions.length}</p>
        <p>Farmers: ${farmers}</p>
        <p>Wheat acres: ${acres.toLocaleString()}</p>
        <p>Locations: ${locs || "-"}</p>
      </div>
    `;
  });

  container.innerHTML = html;
}

function updateTable() {
  const table = document.getElementById("dataTable");
  if (!allSessions.length) {
    table.innerHTML = "<tbody><tr><td>No data</td></tr></tbody>";
    return;
  }

  const headers = [
    "SN",
    "Date",
    "City",
    "Session Location",
    "Tehsil / District",
    "Total Farmers",
    "Total Wheat Acres",
    "Awareness Rate",
    "Definite Use Rate",
    "Maybe Rate",
    "Top Reason Use",
    "Top Reason Not Use",
  ];

  let html = "<thead><tr>";
  headers.forEach((h) => {
    html += `<th>${h}</th>`;
  });
  html += "</tr></thead><tbody>";

  allSessions.slice(0, 25).forEach((s) => {
    html += "<tr>";
    html += `<td>${s.sn || ""}</td>`;
    html += `<td>${s.activityDate || s.dateText || ""}</td>`;
    html += `<td>${s.city || ""}</td>`;
    html += `<td>${s.sessionLocation || ""}</td>`;
    html += `<td>${s.tehsil || ""}</td>`;
    html += `<td>${s.totalFarmers}</td>`;
    html += `<td>${s.totalWheatAcres.toLocaleString()}</td>`;
    html += `<td>${
      isNaN(s.awarenessRate) ? "" : s.awarenessRate.toFixed(1) + "%"
    }</td>`;
    html += `<td>${
      isNaN(s.definiteUseRate) ? "" : s.definiteUseRate.toFixed(1) + "%"
    }</td>`;
    html += `<td>${
      isNaN(s.maybeRate) ? "" : s.maybeRate.toFixed(1) + "%"
    }</td>`;
    html += `<td>${s.topReasonUse || ""}</td>`;
    html += `<td>${s.topReasonNotUse || ""}</td>`;
    html += "</tr>";
  });

  html += "</tbody>";
  table.innerHTML = html;
}

/* ---------- Charts ---------- */

function buildCharts() {
  // Destroy old charts if any (for hot reloads)
  Object.values(charts).forEach((c) => c && c.destroy());
  charts = {};

  const ctxEng = document.getElementById("engagementChart").getContext("2d");
  const ctxConv = document.getElementById("conversionChart").getContext("2d");
  const ctxReasons = document.getElementById("reasonsChart").getContext("2d");
  const ctxDist = document.getElementById("distanceChart").getContext("2d");

  const dayLabels = [...new Set(allSessions.map((s) => s.dayLabel))];

  const farmersByDay = dayLabels.map((day) =>
    allSessions
      .filter((s) => s.dayLabel === day)
      .reduce((sum, s) => sum + (s.totalFarmers || 0), 0)
  );

  const acresByDay = dayLabels.map((day) =>
    allSessions
      .filter((s) => s.dayLabel === day)
      .reduce((sum, s) => sum + (s.totalWheatAcres || 0), 0)
  );

  charts.engagement = new Chart(ctxEng, {
    type: "bar",
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: "Farmers engaged",
          data: farmersByDay,
          backgroundColor: "#2780e3",
        },
        {
          label: "Wheat acres",
          data: acresByDay,
          backgroundColor: "#2ecc71",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Daily engagement overview",
        },
        legend: {
          position: "bottom",
        },
      },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 45 } },
      },
    },
  });

  // Conversion trend
  const convByDay = dayLabels.map((day) => {
    const vals = allSessions
      .filter((s) => s.dayLabel === day)
      .map((s) => s.definiteUseRate)
      .filter((v) => !isNaN(v));
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  charts.conversion = new Chart(ctxConv, {
    type: "line",
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: "Definite use rate (%)",
          data: convByDay,
          borderColor: "#e74c3c",
          backgroundColor: "rgba(231, 76, 60, 0.15)",
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Conversion trend" },
        legend: { display: false },
      },
      scales: {
        y: { beginAtZero: true, max: 100 },
      },
    },
  });

  // Reasons pie
  const reasonCounts = {};
  allSessions.forEach((s) => {
    if (s.topReasonUse) {
      reasonCounts[s.topReasonUse] =
        (reasonCounts[s.topReasonUse] || 0) + 1;
    }
  });

  const reasonLabels = Object.keys(reasonCounts);
  const reasonValues = Object.values(reasonCounts);

  charts.reasons = new Chart(ctxReasons, {
    type: "pie",
    data: {
      labels: reasonLabels,
      datasets: [
        {
          data: reasonValues,
          backgroundColor: [
            "#2780e3",
            "#2ecc71",
            "#9b59b6",
            "#e67e22",
            "#e74c3c",
            "#f1c40f",
            "#1abc9c",
          ],
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "Top adoption reasons" },
      },
    },
  });

  // Distance radar – just show top 8 days by distance
  const distByDay = dayLabels.map((day) =>
    allSessions
      .filter((s) => s.dayLabel === day)
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );

  charts.distance = new Chart(ctxDist, {
    type: "radar",
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: "Travel distance (km)",
          data: distByDay,
          borderColor: "#f39c12",
          backgroundColor: "rgba(243, 156, 18, 0.2)",
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "Travel distance per day" },
      },
    },
  });
}

/* ---------- UI wiring ---------- */

function populateDayFilter() {
  const select = document.getElementById("dayFilter");
  const existing = new Set(
    Array.from(select.options).map((o) => o.value)
  );

  allSessions.forEach((s) => {
    if (!existing.has(s.dayKey)) {
      const opt = document.createElement("option");
      opt.value = s.dayKey;
      opt.textContent = s.dayLabel;
      select.appendChild(opt);
      existing.add(s.dayKey);
    }
  });
}

function attachControlHandlers() {
  document
    .getElementById("dayFilter")
    .addEventListener("change", refreshMarkers);

  document
    .getElementById("metricFilter")
    .addEventListener("change", refreshMarkers);

  document.getElementById("btnReset").addEventListener("click", () => {
    map.setView([28.0, 69.0], 6);
    refreshMarkers();
  });

  document.getElementById("btnRoute").addEventListener("click", () => {
    const coords = allSessions
      .filter((s) => s.lat && s.lng)
      .map((s) => [s.lat, s.lng]);

    if (coords.length < 2) {
      alert("Not enough coordinates to draw route.");
      return;
    }

    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(coords, {
      color: "#ff7a3c",
      weight: 3,
    }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
  });

  document.getElementById("btnHeatMap").addEventListener("click", () => {
    alert(
      "Heat map layer is not implemented yet – but this is where engagement density would be visualised."
    );
  });
}

/* ---------- CSV load ---------- */

function loadCsvAndBuild() {
  Papa.parse(CSV_FILE, {
    download: true,
    skipEmptyLines: true,
    complete: (results) => {
      try {
        processCsvRows(results.data);
        populateDayFilter();
        updateKpis();
        updateSessionList();
        updateTable();
        refreshMarkers();
        buildCharts();
      } catch (err) {
        console.error("Error processing CSV:", err);
        alert(
          "Error reading CSV data. Please check that sum_sheet.csv is present and not modified."
        );
      }
    },
    error: (err) => {
      console.error("Error loading CSV:", err);
      alert("Could not load sum_sheet.csv – check file name and location.");
    },
  });
}

/* ---------- Bootstrap ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  attachControlHandlers();
  loadCsvAndBuild();
});
