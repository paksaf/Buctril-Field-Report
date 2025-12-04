// ---------- CONFIG ----------
const CSV_FILE = "sum-sheet.csv";

// Map column headers from your CSV.
// EDIT THESE STRINGS to match your actual header row exactly.
const COLS = {
  day: "Day", // e.g. "Day 1", "Day 2"
  city: "City / Tehsil",
  location: "Session Location",
  farmers: "Total Farmers",
  acres: "Total Wheat Acres",
  awareness: "Awareness Rate",
  definite: "Definite Use Rate",
  maybe: "Maybe Rate",
  usedLastYear: "Used Last Year Rate",
  coords: "Spot Coordinates",
  distanceKm: "Approximate Distance (km)"
};
// -----------------------------

let allSessions = [];
let filteredSessions = [];
let map;
let markers = [];
const charts = {};

// Utility
function parseNumber(value) {
  if (value === undefined || value === null) return 0;
  const num = parseFloat(String(value).replace(/,/g, "").trim());
  return isNaN(num) ? 0 : num;
}

function parseRate(value) {
  const num = parseFloat(String(value).toString().replace("%", "").trim());
  return isNaN(num) ? null : num;
}

function extractLatLng(coordText) {
  if (!coordText) return null;
  const match = String(coordText).match(/(-?\d+\.\d+)/g);
  if (match && match.length >= 2) {
    return [parseFloat(match[0]), parseFloat(match[1])];
  }
  return null;
}

// Map init
function initMap() {
  map = L.map("map").setView([28.0, 69.0], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
}

function resetMap() {
  if (map) map.setView([28.0, 69.0], 7);
}

// Load + parse CSV
function loadData() {
  Papa.parse(CSV_FILE, {
    download: true,
    header: true,
    dynamicTyping: false,
    complete: (results) => {
      allSessions = results.data.filter((row) => Object.keys(row).length > 1);
      filteredSessions = allSessions;
      initFilters();
      updateDashboard();
      updateSessionList();
      updateTable();
      initMap();
      updateMap();
      initCharts();
    },
    error: (err) => {
      console.error("Error loading CSV:", err);
    }
  });
}

// Filters
function initFilters() {
  const daySelect = document.getElementById("dayFilter");
  const days = [...new Set(allSessions.map((s) => s[COLS.day]).filter(Boolean))];

  // Add day options
  days.forEach((day) => {
    const opt = document.createElement("option");
    opt.value = day;
    opt.textContent = day;
    daySelect.appendChild(opt);
  });

  daySelect.addEventListener("change", () => {
    const val = daySelect.value;
    filteredSessions =
      val === "all"
        ? allSessions
        : allSessions.filter((s) => s[COLS.day] === val);
    updateEverything();
  });

  document
    .getElementById("metricFilter")
    .addEventListener("change", updateMap);
}

function updateEverything() {
  updateDashboard();
  updateSessionList();
  updateTable();
  updateMap();
  updateCharts();
}

// Dashboard numbers
function updateDashboard() {
  const totalFarmers = filteredSessions.reduce(
    (sum, s) => sum + parseNumber(s[COLS.farmers]),
    0
  );
  const totalAcres = filteredSessions.reduce(
    (sum, s) => sum + parseNumber(s[COLS.acres]),
    0
  );

  const awarenessRates = filteredSessions
    .map((s) => parseRate(s[COLS.awareness]))
    .filter((x) => x !== null);
  const definiteRates = filteredSessions
    .map((s) => parseRate(s[COLS.definite]))
    .filter((x) => x !== null);

  const avgAwareness =
    awarenessRates.length === 0
      ? null
      : awarenessRates.reduce((a, b) => a + b, 0) / awarenessRates.length;
  const avgDefinite =
    definiteRates.length === 0
      ? null
      : definiteRates.reduce((a, b) => a + b, 0) / definiteRates.length;

  document.getElementById("totalFarmers").textContent =
    totalFarmers.toLocaleString();
  document.getElementById("totalAcres").textContent =
    totalAcres.toLocaleString() + " acres";
  document.getElementById("avgAwareness").textContent =
    avgAwareness === null ? "N/A" : avgAwareness.toFixed(1) + "%";
  document.getElementById("definiteUse").textContent =
    avgDefinite === null ? "N/A" : avgDefinite.toFixed(1) + "%";

  const kpiContainer = document.getElementById("kpiMetrics");
  const sessionsHeld = filteredSessions.length;
  const avgAcresPerFarmer =
    totalFarmers === 0 ? 0 : totalAcres / totalFarmers;

  const repeatShare =
    filteredSessions.length === 0
      ? 0
      : (filteredSessions.filter(
          (s) => parseRate(s[COLS.usedLastYear]) > 0
        ).length /
          filteredSessions.length) *
        100;

  const highMaybe =
    filteredSessions.filter((s) => parseRate(s[COLS.maybe]) > 30).length || 0;

  kpiContainer.innerHTML = `
    <div class="kpi-item">
      <div class="kpi-value">${sessionsHeld}</div>
      <div class="kpi-label">Sessions Held</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${avgAcresPerFarmer.toFixed(1)}</div>
      <div class="kpi-label">Avg Acres / Farmer</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${repeatShare.toFixed(0)}%</div>
      <div class="kpi-label">Repeat Users</div>
    </div>
    <div class="kpi-item">
      <div class="kpi-value">${highMaybe}</div>
      <div class="kpi-label">High Potential Sessions</div>
    </div>
  `;
}

// Session cards
function updateSessionList() {
  const container = document.getElementById("sessionList");
  const grouped = {};

  filteredSessions.forEach((s) => {
    const day = s[COLS.day] || "Unknown Day";
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(s);
  });

  let html = "";
  Object.entries(grouped).forEach(([day, sessions]) => {
    const farmers = sessions.reduce(
      (sum, s) => sum + parseNumber(s[COLS.farmers]),
      0
    );
    const acres = sessions.reduce(
      (sum, s) => sum + parseNumber(s[COLS.acres]),
      0
    );
    const locations = [
      ...new Set(
        sessions
          .map((s) => s[COLS.location] || s[COLS.city] || "")
          .filter(Boolean)
      )
    ].join(", ");

    html += `
      <div class="session-item">
        <strong>${day}</strong>
        <p>Sessions: ${sessions.length}</p>
        <p>Farmers: ${farmers}</p>
        <p>Acres: ${acres.toLocaleString()}</p>
        <p>Locations: ${locations}</p>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Table
function updateTable() {
  const table = document.getElementById("dataTable");
  if (!filteredSessions.length) {
    table.innerHTML = "<tbody><tr><td>No data</td></tr></tbody>";
    return;
  }

  const headers = Object.keys(filteredSessions[0]);
  let html = "<thead><tr>";
  headers.forEach((h) => (html += `<th>${h}</th>`));
  html += "</tr></thead><tbody>";

  filteredSessions.forEach((row) => {
    html += "<tr>";
    headers.forEach((h) => {
      html += `<td>${row[h] ?? ""}</td>`;
    });
    html += "</tr>";
  });

  html += "</tbody>";
  table.innerHTML = html;
}

// Map markers
function getColorByAwareness(rateStr) {
  const rate = parseRate(rateStr);
  if (rate === null) return "#95a5a6";
  if (rate >= 80) return "#2ecc71";
  if (rate >= 60) return "#f1c40f";
  if (rate >= 40) return "#e67e22";
  return "#e74c3c";
}

function clearMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
}

function updateMap() {
  if (!map) return;
  clearMarkers();

  const metric = document.getElementById("metricFilter").value;

  filteredSessions.forEach((s) => {
    const coords = extractLatLng(s[COLS.coords]);
    if (!coords) return;

    const farmers = parseNumber(s[COLS.farmers]);
    const acres = parseNumber(s[COLS.acres]);
    const awareness = s[COLS.awareness];
    const definite = s[COLS.definite];

    let radiusBase;
    if (metric === "acres") radiusBase = Math.sqrt(acres);
    else if (metric === "awareness") radiusBase = parseRate(awareness) || 5;
    else if (metric === "definite") radiusBase = parseRate(definite) || 5;
    else radiusBase = Math.sqrt(farmers);

    const radius = Math.min(5 + radiusBase * 0.4, 25);

    const marker = L.circleMarker(coords, {
      radius,
      fillColor: getColorByAwareness(awareness),
      color: "#2c3e50",
      weight: 2,
      opacity: 0.8,
      fillOpacity: 0.7
    }).addTo(map);

    const city = s[COLS.city] || "Unknown";
    marker.bindPopup(
      `<strong>${s[COLS.location] || "Session"}</strong><br/>
       City: ${city}<br/>
       Farmers: ${farmers}<br/>
       Acres: ${acres.toLocaleString()}<br/>
       Awareness: ${awareness || "N/A"}<br/>
       Definite Use: ${definite || "N/A"}`
    );

    markers.push(marker);
  });
}

// Charts
function initCharts() {
  charts.engagement = new Chart(
    document.getElementById("engagementChart").getContext("2d"),
    {
      type: "bar",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: "Daily Engagement Overview" } }
      }
    }
  );

  charts.conversion = new Chart(
    document.getElementById("conversionChart").getContext("2d"),
    {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, max: 100 } },
        plugins: { title: { display: true, text: "Conversion Rate Trend" } }
      }
    }
  );

  charts.reasons = new Chart(
    document.getElementById("reasonsChart").getContext("2d"),
    {
      type: "pie",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: "Adoption / Rejection Signals" }
        }
      }
    }
  );

  charts.distance = new Chart(
    document.getElementById("distanceChart").getContext("2d"),
    {
      type: "radar",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: "Travel Distance per Day" }
        }
      }
    }
  );

  updateCharts();
}

function updateCharts() {
  if (!filteredSessions.length) return;

  const days = [
    ...new Set(filteredSessions.map((s) => s[COLS.day]).filter(Boolean))
  ];

  // Farmers & acres per day
  const farmersByDay = days.map((d) =>
    filteredSessions
      .filter((s) => s[COLS.day] === d)
      .reduce((sum, s) => sum + parseNumber(s[COLS.farmers]), 0)
  );
  const acresByDay = days.map((d) =>
    filteredSessions
      .filter((s) => s[COLS.day] === d)
      .reduce((sum, s) => sum + parseNumber(s[COLS.acres]), 0)
  );

  charts.engagement.data.labels = days;
  charts.engagement.data.datasets = [
    {
      label: "Farmers Engaged",
      data: farmersByDay,
      backgroundColor: "#3498db"
    },
    {
      label: "Wheat Acres",
      data: acresByDay,
      backgroundColor: "#2ecc71"
    }
  ];
  charts.engagement.update();

  // Definite use per day
  const definiteByDay = days.map((d) => {
    const sessions = filteredSessions.filter((s) => s[COLS.day] === d);
    const rates = sessions
      .map((s) => parseRate(s[COLS.definite]))
      .filter((x) => x !== null);
    if (!rates.length) return 0;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  });

  charts.conversion.data.labels = days;
  charts.conversion.data.datasets = [
    {
      label: "Definite Use Rate (%)",
      data: definiteByDay,
      borderColor: "#e74c3c",
      backgroundColor: "rgba(231, 76, 60, 0.15)",
      tension: 0.3,
      fill: true
    }
  ];
  charts.conversion.update();

  // Simple reasons proxy: count of high awareness / high maybe / high price-resistance
  const highAwareness = filteredSessions.filter(
    (s) => parseRate(s[COLS.awareness]) >= 70
  ).length;
  const highMaybe = filteredSessions.filter(
    (s) => parseRate(s[COLS.maybe]) >= 40
  ).length;
  const priceSensitive = filteredSessions.filter(
    (s) => parseRate(s[COLS.definite]) < 40
  ).length;

  charts.reasons.data.labels = [
    "Strong Awareness",
    "High Maybe",
    "Price-Sensitive"
  ];
  charts.reasons.data.datasets = [
    {
      data: [highAwareness, highMaybe, priceSensitive],
      backgroundColor: ["#3498db", "#f1c40f", "#e74c3c"]
    }
  ];
  charts.reasons.update();

  // Distance per day
  const distanceByDay = days.map((d) =>
    filteredSessions
      .filter((s) => s[COLS.day] === d)
      .reduce((sum, s) => sum + parseNumber(s[COLS.distanceKm]), 0)
  );

  charts.distance.data.labels = days;
  charts.distance.data.datasets = [
    {
      label: "Travel Distance (km)",
      data: distanceByDay,
      borderColor: "#f39c12",
      backgroundColor: "rgba(243, 156, 18, 0.2)"
    }
  ];
  charts.distance.update();
}

// Kickoff
document.addEventListener("DOMContentLoaded", loadData);
