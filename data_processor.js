<<<<<<< HEAD
// data_processor.js
=======
// data_processor.js - Fixed version
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
// Reads sum_sheet.csv and drives the map, KPIs, charts and table.

const CSV_FILE = "sum_sheet.csv";

let allSessions = [];
let map;
let markers = [];
let routeLine = null;
let charts = {};

/* ---------- Helpers ---------- */

function numFromStr(value) {
<<<<<<< HEAD
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
=======
  if (value === undefined || value === null || value === "") return 0;
  const cleaned = String(value).replace(/,/g, "").replace(/\s+/g, "").trim();
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function percentFromStr(value) {
<<<<<<< HEAD
  if (!value) return NaN;
=======
  if (!value || value === "-") return NaN;
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  const cleaned = String(value).replace(/[%\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? NaN : n;
}

<<<<<<< HEAD
function parseCoords(text) {
  if (!text) return null;
  const matches = String(text).match(/-?\d+(\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  return [parseFloat(matches[0]), parseFloat(matches[1])];
}

/* ---------- Map setup ---------- */

function initMap() {
=======
function parseDMS(dms) {
  // Parse DMS format: "28°09'13.2""N" to decimal degrees
  if (!dms) return null;
  
  // Remove extra quotes and clean the string
  const cleanStr = dms.replace(/""/g, '"').trim();
  
  // Match DMS pattern: degrees, minutes, seconds, hemisphere
  const match = cleanStr.match(/(\d+)°(\d+)'([\d\.]+)"([NSEW])/);
  if (!match) return null;
  
  const degrees = parseFloat(match[1]);
  const minutes = parseFloat(match[2]);
  const seconds = parseFloat(match[3]);
  const hemisphere = match[4];
  
  let decimal = degrees + minutes/60 + seconds/3600;
  
  // Adjust for hemisphere
  if (hemisphere === 'S' || hemisphere === 'W') {
    decimal = -decimal;
  }
  
  return decimal;
}

function parseCoords(text) {
  if (!text || text === "-") return null;
  
  try {
    // Split latitude and longitude
    const parts = text.split(/\s+/);
    if (parts.length < 2) return null;
    
    const lat = parseDMS(parts[0]);
    const lng = parseDMS(parts[1]);
    
    if (lat === null || lng === null) return null;
    
    return [lat, lng];
  } catch (e) {
    console.error("Error parsing coordinates:", text, e);
    return null;
  }
}

/* ---------- Map setup ---------- */

function initMap() {
  if (map) {
    map.remove();
  }
  
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  map = L.map("map").setView([28.0, 69.0], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
<<<<<<< HEAD
=======
    maxZoom: 18,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  }).addTo(map);
  
  // Add scale control
  L.control.scale().addTo(map);
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

<<<<<<< HEAD
  const filtered =
    dayFilter === "all"
      ? allSessions
      : allSessions.filter((s) => s.dayKey === dayFilter);

  const coordsForRoute = [];
=======
  const filtered = dayFilter === "all" 
    ? allSessions 
    : allSessions.filter((s) => s.dayKey === dayFilter);

  const coordsForRoute = [];
  const bounds = L.latLngBounds([]);
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681

  filtered.forEach((session) => {
    if (!session.lat || !session.lng) return;

    let radius = 8;
    if (metricFilter === "farmers") {
<<<<<<< HEAD
      radius = Math.max(4, Math.sqrt(session.totalFarmers) * 1.8);
    } else if (metricFilter === "acres") {
      radius = Math.max(4, Math.sqrt(session.totalWheatAcres) * 0.9);
=======
      radius = Math.max(4, Math.sqrt(session.totalFarmers) * 1.5);
    } else if (metricFilter === "acres") {
      radius = Math.max(4, Math.sqrt(session.totalWheatAcres) * 0.8);
    }

    let fillColor = "#3498db";
    let rate = session.awarenessRate;

    if (metricFilter === "awareness") {
      rate = session.awarenessRate;
    } else if (metricFilter === "definite") {
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
      <div style="padding: 5px;">
        <strong>${session.sessionLocation || "Session"}</strong><br/>
        <strong>City:</strong> ${session.city || "-"}<br/>
        <strong>Date:</strong> ${session.activityDate || "-"}<br/>
        <strong>Farmers:</strong> ${session.totalFarmers}<br/>
        <strong>Wheat acres:</strong> ${session.totalWheatAcres.toLocaleString()}<br/>
        <strong>Awareness:</strong> ${isNaN(session.awarenessRate) ? "N/A" : session.awarenessRate.toFixed(1) + "%"}<br/>
        <strong>Definite use:</strong> ${isNaN(session.definiteUseRate) ? "N/A" : session.definiteUseRate.toFixed(1) + "%"}
      </div>
    `;

    marker.bindPopup(popupHtml);
    markers.push(marker);
    coordsForRoute.push([session.lat, session.lng]);
    bounds.extend([session.lat, session.lng]);
  });

  // Fit bounds if we have markers
  if (filtered.length > 0 && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

/* ---------- Data loading & shaping ---------- */

function processCsvRows(rows) {
  if (!rows || rows.length < 2) return;

  // Find header row (skip the first few metadata rows)
  let headerIndex = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (rows[i].some(cell => cell && 
        (cell.includes("Session Location") || cell.includes("Total Farmers")))) {
      headerIndex = i;
      break;
    }
  }

  const headerRow = rows[headerIndex];
  const colIndex = {};
  headerRow.forEach((h, idx) => {
    if (h) {
      colIndex[h.trim()] = idx;
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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

<<<<<<< HEAD
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
=======
  function get(row, colName) {
    const idx = colIndex[colName];
    if (idx === undefined || idx >= row.length) return "";
    const val = row[idx];
    return val === undefined || val === null ? "" : String(val).trim();
  }

  // Filter valid data rows
  const dataRows = rows.slice(headerIndex + 1).filter((row) => {
    // Check if row has essential data
    const location = get(row, "Session Location");
    const farmers = get(row, "Total Farmers");
    const date = get(row, "Activity Date") || get(row, "Date");
    
    return location && location !== "-" && 
           farmers && !isNaN(numFromStr(farmers)) && 
           date && date !== "-";
  });

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
      activityDay: get(row, "Day"),
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
      estBuctrilAcres: numFromStr(get(row, "Estimated Buctril Acres from this Session")),
      topReasonUse: get(row, "Top Reason to Use (session)") || get(row, "Top Reason Use"),
      topReasonNotUse: get(row, "Top Reason Not to Use (session)") || get(row, "Top Reason Not to Use in past"),
      distanceKm: numFromStr(get(row, "Approximate Distance (km)")),
      lat: coords ? coords[0] : null,
      lng: coords ? coords[1] : null,
    };
  });

  // Filter out sessions without coordinates
  allSessions = allSessions.filter(s => s.lat && s.lng && s.totalFarmers > 0);

  // Day key used in dropdown
  allSessions.forEach((s) => {
    const date = s.activityDate || s.dateText || "";
    const city = s.city || "";
    const label = date && city ? `${date} – ${city}` : `Day ${s.sn || "Unknown"}`;
    s.dayLabel = label.trim();
    s.dayKey = s.dayLabel;
  });
}

/* ---------- KPIs, sessions list, table ---------- */

function updateKpis() {
  if (!allSessions.length) {
    document.getElementById("totalFarmers").textContent = "0";
    document.getElementById("totalAcres").textContent = "0 acres";
    document.getElementById("avgAwareness").textContent = "N/A";
    document.getElementById("definiteUse").textContent = "N/A";
    return;
  }

  const totalFarmers = allSessions.reduce((sum, s) => sum + (s.totalFarmers || 0), 0);
  const totalAcres = allSessions.reduce((sum, s) => sum + (s.totalWheatAcres || 0), 0);

  const awarenessVals = allSessions
    .map((s) => s.awarenessRate)
    .filter((x) => !isNaN(x));
  const definiteVals = allSessions
    .map((s) => s.definiteUseRate)
    .filter((x) => !isNaN(x));

  const avgAwareness = awarenessVals.length > 0
    ? awarenessVals.reduce((a, b) => a + b, 0) / awarenessVals.length
    : NaN;
  const avgDefinite = definiteVals.length > 0
    ? definiteVals.reduce((a, b) => a + b, 0) / definiteVals.length
    : NaN;

  document.getElementById("totalFarmers").textContent = totalFarmers.toLocaleString();
  document.getElementById("totalAcres").textContent = totalAcres.toLocaleString() + " acres";
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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
<<<<<<< HEAD
  const avgAcPerFarmer =
    totalFarmers > 0 ? (totalAcres / totalFarmers).toFixed(1) : "0.0";
=======
  const avgAcPerFarmer = totalFarmers > 0 ? (totalAcres / totalFarmers).toFixed(1) : "0.0";
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681

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
<<<<<<< HEAD
      <div class="kpi-label">High “Maybe” sessions (follow-up)</div>
=======
      <div class="kpi-label">High "Maybe" sessions (follow-up)</div>
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    </div>
  `;
}

function updateSessionList() {
  const container = document.getElementById("sessionList");
<<<<<<< HEAD
  const group = {};

=======
  if (!allSessions.length) {
    container.innerHTML = '<div class="session-item">No session data available</div>';
    return;
  }

  const group = {};
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  allSessions.forEach((s) => {
    const key = s.dayLabel;
    if (!group[key]) group[key] = [];
    group[key].push(s);
  });

  let html = "";
  Object.entries(group).forEach(([dayLabel, sessions]) => {
<<<<<<< HEAD
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
=======
    const farmers = sessions.reduce((sum, s) => sum + (s.totalFarmers || 0), 0);
    const acres = sessions.reduce((sum, s) => sum + (s.totalWheatAcres || 0), 0);
    const locs = sessions
      .map((s) => s.sessionLocation)
      .filter(Boolean)
      .slice(0, 2) // Show only first 2 locations
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
      .join(", ");

    html += `
      <div class="session-item">
        <strong>${dayLabel}</strong>
        <p>Sessions: ${sessions.length}</p>
        <p>Farmers: ${farmers}</p>
        <p>Wheat acres: ${acres.toLocaleString()}</p>
<<<<<<< HEAD
        <p>Locations: ${locs || "-"}</p>
=======
        <p>Locations: ${locs || "-"}${sessions.length > 2 ? "..." : ""}</p>
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
      </div>
    `;
  });

  container.innerHTML = html;
}

function updateTable() {
  const table = document.getElementById("dataTable");
  if (!allSessions.length) {
<<<<<<< HEAD
    table.innerHTML = "<tbody><tr><td>No data</td></tr></tbody>";
=======
    table.innerHTML = "<tbody><tr><td>No data available</td></tr></tbody>";
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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

<<<<<<< HEAD
  allSessions.slice(0, 25).forEach((s) => {
=======
  allSessions.slice(0, 20).forEach((s) => {
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    html += "<tr>";
    html += `<td>${s.sn || ""}</td>`;
    html += `<td>${s.activityDate || s.dateText || ""}</td>`;
    html += `<td>${s.city || ""}</td>`;
    html += `<td>${s.sessionLocation || ""}</td>`;
    html += `<td>${s.tehsil || ""}</td>`;
    html += `<td>${s.totalFarmers}</td>`;
    html += `<td>${s.totalWheatAcres.toLocaleString()}</td>`;
<<<<<<< HEAD
    html += `<td>${
      isNaN(s.awarenessRate) ? "" : s.awarenessRate.toFixed(1) + "%"
    }</td>`;
    html += `<td>${
      isNaN(s.definiteUseRate) ? "" : s.definiteUseRate.toFixed(1) + "%"
    }</td>`;
    html += `<td>${
      isNaN(s.maybeRate) ? "" : s.maybeRate.toFixed(1) + "%"
    }</td>`;
=======
    html += `<td>${isNaN(s.awarenessRate) ? "" : s.awarenessRate.toFixed(1) + "%"}</td>`;
    html += `<td>${isNaN(s.definiteUseRate) ? "" : s.definiteUseRate.toFixed(1) + "%"}</td>`;
    html += `<td>${isNaN(s.maybeRate) ? "" : s.maybeRate.toFixed(1) + "%"}</td>`;
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    html += `<td>${s.topReasonUse || ""}</td>`;
    html += `<td>${s.topReasonNotUse || ""}</td>`;
    html += "</tr>";
  });

  html += "</tbody>";
  table.innerHTML = html;
}

/* ---------- Charts ---------- */

function buildCharts() {
<<<<<<< HEAD
  // Destroy old charts if any (for hot reloads)
  Object.values(charts).forEach((c) => c && c.destroy());
  charts = {};

  const ctxEng = document.getElementById("engagementChart").getContext("2d");
  const ctxConv = document.getElementById("conversionChart").getContext("2d");
  const ctxReasons = document.getElementById("reasonsChart").getContext("2d");
  const ctxDist = document.getElementById("distanceChart").getContext("2d");

  const dayLabels = [...new Set(allSessions.map((s) => s.dayLabel))];

=======
  // Destroy old charts
  Object.values(charts).forEach((c) => c && c.destroy());
  charts = {};

  if (!allSessions.length) return;

  // Get chart contexts
  const ctxEng = document.getElementById("engagementChart");
  const ctxConv = document.getElementById("conversionChart");
  const ctxReasons = document.getElementById("reasonsChart");
  const ctxDist = document.getElementById("distanceChart");

  if (!ctxEng || !ctxConv || !ctxReasons || !ctxDist) return;

  const ctxEng2d = ctxEng.getContext("2d");
  const ctxConv2d = ctxConv.getContext("2d");
  const ctxReasons2d = ctxReasons.getContext("2d");
  const ctxDist2d = ctxDist.getContext("2d");

  // Group sessions by day
  const dayLabels = [...new Set(allSessions.map((s) => s.dayLabel))].sort();

>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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

<<<<<<< HEAD
  charts.engagement = new Chart(ctxEng, {
=======
  // Engagement chart
  charts.engagement = new Chart(ctxEng2d, {
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    type: "bar",
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: "Farmers engaged",
          data: farmersByDay,
          backgroundColor: "#2780e3",
<<<<<<< HEAD
=======
          borderColor: "#14508a",
          borderWidth: 1,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
        },
        {
          label: "Wheat acres",
          data: acresByDay,
          backgroundColor: "#2ecc71",
<<<<<<< HEAD
=======
          borderColor: "#27ae60",
          borderWidth: 1,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
        },
      ],
    },
    options: {
      responsive: true,
<<<<<<< HEAD
=======
      maintainAspectRatio: false,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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
<<<<<<< HEAD
        x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 45 } },
=======
        x: {
          ticks: {
            autoSkip: true,
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
        },
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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

<<<<<<< HEAD
  charts.conversion = new Chart(ctxConv, {
=======
  charts.conversion = new Chart(ctxConv2d, {
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    type: "line",
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: "Definite use rate (%)",
          data: convByDay,
          borderColor: "#e74c3c",
          backgroundColor: "rgba(231, 76, 60, 0.15)",
<<<<<<< HEAD
=======
          borderWidth: 2,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
<<<<<<< HEAD
=======
      maintainAspectRatio: false,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
      plugins: {
        title: { display: true, text: "Conversion trend" },
        legend: { display: false },
      },
      scales: {
<<<<<<< HEAD
        y: { beginAtZero: true, max: 100 },
=======
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + "%";
            }
          }
        },
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
      },
    },
  });

<<<<<<< HEAD
  // Reasons pie
  const reasonCounts = {};
  allSessions.forEach((s) => {
    if (s.topReasonUse) {
      reasonCounts[s.topReasonUse] =
        (reasonCounts[s.topReasonUse] || 0) + 1;
=======
  // Reasons pie chart
  const reasonCounts = {};
  allSessions.forEach((s) => {
    if (s.topReasonUse && s.topReasonUse.trim()) {
      reasonCounts[s.topReasonUse] = (reasonCounts[s.topReasonUse] || 0) + 1;
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    }
  });

  const reasonLabels = Object.keys(reasonCounts);
  const reasonValues = Object.values(reasonCounts);

<<<<<<< HEAD
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
=======
  if (reasonLabels.length > 0) {
    charts.reasons = new Chart(ctxReasons2d, {
      type: "pie",
      data: {
        labels: reasonLabels,
        datasets: [
          {
            data: reasonValues,
            backgroundColor: [
              "#2780e3", "#2ecc71", "#9b59b6", "#e67e22", 
              "#e74c3c", "#f1c40f", "#1abc9c", "#34495e"
            ],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: "Top adoption reasons" },
        },
      },
    });
  } else {
    ctxReasons2d.clearRect(0, 0, ctxReasons.width, ctxReasons.height);
    ctxReasons2d.fillText("No reason data available", 10, 50);
  }

  // Distance radar chart
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  const distByDay = dayLabels.map((day) =>
    allSessions
      .filter((s) => s.dayLabel === day)
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );

<<<<<<< HEAD
  charts.distance = new Chart(ctxDist, {
=======
  charts.distance = new Chart(ctxDist2d, {
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    type: "radar",
    data: {
      labels: dayLabels,
      datasets: [
        {
          label: "Travel distance (km)",
          data: distByDay,
          borderColor: "#f39c12",
          backgroundColor: "rgba(243, 156, 18, 0.2)",
<<<<<<< HEAD
=======
          borderWidth: 2,
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
        },
      ],
    },
    options: {
<<<<<<< HEAD
      plugins: {
        title: { display: true, text: "Travel distance per day" },
      },
=======
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "Travel distance per day" },
      },
      scales: {
        r: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + " km";
            }
          }
        }
      },
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    },
  });
}

/* ---------- UI wiring ---------- */

function populateDayFilter() {
  const select = document.getElementById("dayFilter");
<<<<<<< HEAD
  const existing = new Set(
    Array.from(select.options).map((o) => o.value)
  );

=======
  
  // Clear existing options except "All Days"
  while (select.options.length > 1) {
    select.remove(1);
  }

  const existing = new Set(["all"]);
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
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
<<<<<<< HEAD
  document
    .getElementById("dayFilter")
    .addEventListener("change", refreshMarkers);

  document
    .getElementById("metricFilter")
    .addEventListener("change", refreshMarkers);
=======
  document.getElementById("dayFilter").addEventListener("change", refreshMarkers);
  document.getElementById("metricFilter").addEventListener("change", refreshMarkers);
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681

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
<<<<<<< HEAD
    routeLine = L.polyline(coords, {
      color: "#ff7a3c",
      weight: 3,
    }).addTo(map);
=======
    
    routeLine = L.polyline(coords, {
      color: "#ff7a3c",
      weight: 3,
      opacity: 0.7,
    }).addTo(map);
    
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
  });

  document.getElementById("btnHeatMap").addEventListener("click", () => {
<<<<<<< HEAD
    alert(
      "Heat map layer is not implemented yet – but this is where engagement density would be visualised."
    );
=======
    alert("Heat map functionality would require additional data points for density visualization. Currently showing session locations only.");
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
  });
}

/* ---------- CSV load ---------- */

function loadCsvAndBuild() {
  Papa.parse(CSV_FILE, {
    download: true,
    skipEmptyLines: true,
    complete: (results) => {
      try {
<<<<<<< HEAD
        processCsvRows(results.data);
=======
        console.log("CSV loaded, rows:", results.data.length);
        processCsvRows(results.data);
        console.log("Processed sessions:", allSessions.length);
        
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
        populateDayFilter();
        updateKpis();
        updateSessionList();
        updateTable();
        refreshMarkers();
        buildCharts();
<<<<<<< HEAD
      } catch (err) {
        console.error("Error processing CSV:", err);
        alert(
          "Error reading CSV data. Please check that sum_sheet.csv is present and not modified."
=======
        
        // Show success message
        if (allSessions.length === 0) {
          console.warn("No valid session data found in CSV");
        }
      } catch (err) {
        console.error("Error processing CSV:", err);
        alert(
          "Error reading CSV data. Please check the browser console for details."
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
        );
      }
    },
    error: (err) => {
      console.error("Error loading CSV:", err);
<<<<<<< HEAD
      alert("Could not load sum_sheet.csv – check file name and location.");
=======
      alert(`Could not load ${CSV_FILE} – check file name and location.`);
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
    },
  });
}

/* ---------- Bootstrap ---------- */

document.addEventListener("DOMContentLoaded", () => {
<<<<<<< HEAD
  initMap();
  attachControlHandlers();
  loadCsvAndBuild();
});
=======
  console.log("Initializing Buctril Field Report...");
  
  // Initialize map
  initMap();
  
  // Attach control handlers
  attachControlHandlers();
  
  // Load and process data
  loadCsvAndBuild();
  
  console.log("Initialization complete");
});

// Export for debugging
window.appData = {
  allSessions: () => allSessions,
  refreshMarkers: () => refreshMarkers(),
  rebuildCharts: () => buildCharts(),
};
>>>>>>> 77a7ef184bca414e312806e9ef2780b8f3e9f681
