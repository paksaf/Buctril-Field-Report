// data_processor.js
// Reads sum_sheet.csv and drives the map + metrics on index.html

const CSV_FILE = "sum_sheet.csv";

let sessions = [];
let map;
let markers = [];
let routeLine = null;

// -------------- Utility: numeric coercion --------------
function num(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// -------------- Utility: coordinate parser --------------
function parseCoordinate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // Decimal "lat, lng"
  const decimalPattern = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;
  if (decimalPattern.test(s)) {
    const [latStr, lngStr] = s.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }

  // DMS like "30°11'52\"N, 71°28'11\"E"
  function dmsToDecimal(part) {
    if (!part) return null;
    const re = /(\d+)[°\s]+(\d+)?['\s"]*(\d+)?["']?\s*([NSEW])?/i;
    const m = part.match(re);
    if (!m) return null;
    const deg = parseFloat(m[1] || 0);
    const min = parseFloat(m[2] || 0);
    const sec = parseFloat(m[3] || 0);
    let dec = deg + min / 60 + sec / 3600;
    const hemi = (m[4] || "").toUpperCase();
    if (hemi === "S" || hemi === "W") dec = -dec;
    return dec;
  }

  if (s.includes("°")) {
    const parts = s.split(",");
    const latPart = parts[0];
    const lngPart = parts[1] || "";
    const lat = dmsToDecimal(latPart);
    const lng = dmsToDecimal(lngPart);
    if (lat != null && lng != null) return { lat, lng };
  }

  // Fallback: nothing parsed
  return null;
}

// -------------- Detect column keys from header --------------
function detectColumnKeys(row) {
  const keys = Object.keys(row).filter(Boolean);
  const lower = (k) => k.toLowerCase();

  function findKey(fragment) {
    fragment = fragment.toLowerCase();
    return keys.find((k) => lower(k).includes(fragment));
  }

  const snKey = findKey("sn") || "SN";
  const fromCityKey = findKey("from city");
  const cityKey = findKey("city");
  const dateKey = findKey("date");
  const dayKey = findKey("day");
  const locationKey =
    findKey("session location") ||
    findKey("location") ||
    findKey("village") ||
    findKey("spot");

  const farmersKey = keys.find((k) => lower(k).includes("total farmers"));
  const acresKey = keys.find((k) =>
    ["acre", "area"].some((frag) => lower(k).includes(frag))
  );

  const coordKey =
    keys.find((k) =>
      ["coord", "gps"].some((frag) => lower(k).includes(frag))
    ) ||
    keys.find((k) =>
      ["spot", "location"].some((frag) => lower(k).includes(frag))
    );

  return {
    snKey,
    fromCityKey,
    cityKey,
    dateKey,
    dayKey,
    locationKey,
    farmersKey,
    acresKey,
    coordKey,
  };
}

// -------------- Leaflet map setup --------------
function initMap() {
  if (map) return;

  map = L.map("map").setView([29.5, 70.0], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function clearMap() {
  if (!map) return;
  markers.forEach((m) => m.remove());
  markers = [];
  if (routeLine) {
    routeLine.remove();
    routeLine = null;
  }
}

// -------------- Render map markers from sessions --------------
function renderMap() {
  initMap();
  clearMap();

  const bounds = L.latLngBounds([]);
  const routePoints = [];

  sessions.forEach((session) => {
    if (!session.lat || !session.lng) return;

    const latlng = [session.lat, session.lng];

    // circle radius based on farmers if we have it
    let radius = 6;
    if (session.totalFarmers && session.totalFarmers > 0) {
      radius = Math.min(18, 4 + Math.sqrt(session.totalFarmers) * 0.8);
    }

    const marker = L.circleMarker(latlng, {
      radius,
      color: "#f97316",
      weight: 1,
      fillColor: "#fffbeb",
      fillOpacity: 0.85,
    }).addTo(map);

    const popupHtml = `
      <strong>${session.sessionLocation || "Session"}</strong><br/>
      ${session.city || ""}${session.city && session.fromCity ? " · " : ""}${
      session.fromCity || ""
    }<br/>
      <small>${session.date || ""} ${session.day || ""}</small><br/>
      Farmers: ${session.totalFarmers ?? "-"} | Acres: ${session.totalAcres ??
      "-"}
    `;

    marker.bindPopup(popupHtml);
    markers.push(marker);
    bounds.extend(latlng);
    routePoints.push(latlng);
  });

  if (!bounds.isValid()) {
    map.setView([29.5, 70.0], 6);
  } else {
    map.fitBounds(bounds, { padding: [30, 30] });
  }

  if (routePoints.length >= 2) {
    routeLine = L.polyline(routePoints, {
      color: "#38bdf8",
      weight: 3,
      opacity: 0.8,
    }).addTo(map);
  }
}

// -------------- Metrics + table --------------
function updateSummaryAndTable() {
  const totalSessions = sessions.length;

  const totalFarmers = sessions.reduce(
    (sum, s) => sum + (s.totalFarmers || 0),
    0
  );
  const totalAcres = sessions.reduce((sum, s) => sum + (s.totalAcres || 0), 0);

  const locationSet = new Set();
  const citySet = new Set();
  sessions.forEach((s) => {
    if (s.sessionLocation) locationSet.add(s.sessionLocation);
    if (s.city) citySet.add(s.city);
  });

  // Summary boxes
  const elSessions = document.getElementById("total-sessions");
  const elFarmers = document.getElementById("total-farmers");
  const elAcres = document.getElementById("total-acres");
  const elLocs = document.getElementById("total-locations");
  const elAvgFarmers = document.getElementById("avg-farmers-per-session");
  const elAvgAcres = document.getElementById("avg-acres-per-session");
  const elCityVillage = document.getElementById("city-village-breakdown");

  if (elSessions) elSessions.textContent = totalSessions || "–";
  if (elFarmers) elFarmers.textContent = totalFarmers || "–";
  if (elAcres) elAcres.textContent = totalAcres || "–";
  if (elLocs) elLocs.textContent = locationSet.size || "–";

  if (elAvgFarmers) {
    if (totalSessions > 0 && totalFarmers > 0) {
      const avg = (totalFarmers / totalSessions).toFixed(1);
      elAvgFarmers.textContent = `Avg ${avg} farmers per session`;
    } else {
      elAvgFarmers.textContent = "–";
    }
  }

  if (elAvgAcres) {
    if (totalSessions > 0 && totalAcres > 0) {
      const avg = (totalAcres / totalSessions).toFixed(1);
      elAvgAcres.textContent = `Avg ${avg} acres per session`;
    } else {
      elAvgAcres.textContent = "–";
    }
  }

  if (elCityVillage) {
    elCityVillage.textContent = `${citySet.size} cities · ${locationSet.size} locations/villages`;
  }

  // Table
  const tbody = document.getElementById("session-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  sessions.forEach((s) => {
    const tr = document.createElement("tr");

    const coordLabel =
      s.coordRaw && s.lat && s.lng
        ? s.coordRaw
        : s.coordRaw
        ? s.coordRaw
        : "-";

    tr.innerHTML = `
      <td>${s.sn ?? ""}</td>
      <td>${s.date ?? ""}</td>
      <td>${s.fromCity ?? ""}</td>
      <td>${s.city ?? ""}</td>
      <td>${s.sessionLocation ?? ""}</td>
      <td>${s.totalFarmers ?? ""}</td>
      <td>${s.totalAcres ?? ""}</td>
      <td><span class="tag">${coordLabel}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------- CSV loading & main pipeline --------------
function loadCsvAndInit() {
  Papa.parse(CSV_FILE, {
    download: true,
    header: true,
    skipEmptyLines: "greedy",
    complete: function (results) {
      const rows = results.data || [];
      if (!rows.length) {
        console.error("No rows found in CSV");
        return;
      }

      // Filter out summary/top row if needed (SN not numeric)
      const filtered = rows.filter((row) => {
        const snRaw = row["SN"] || row["sn"] || row["Sn"];
        const snNumber = parseInt(String(snRaw).replace(/[^\d]/g, ""), 10);
        return !isNaN(snNumber);
      });

      if (!filtered.length) {
        console.error("No data rows (with numeric SN) found in CSV");
        return;
      }

      const keys = detectColumnKeys(filtered[0]);
      sessions = filtered.map((row) => {
        const snRaw = row[keys.snKey];
        const snNumber = parseInt(String(snRaw).replace(/[^\d]/g, ""), 10);

        const coordRaw = keys.coordKey ? row[keys.coordKey] : null;
        const parsedCoord = parseCoordinate(coordRaw);

        return {
          sn: !isNaN(snNumber) ? snNumber : null,
          fromCity: keys.fromCityKey ? row[keys.fromCityKey] : null,
          city: keys.cityKey ? row[keys.cityKey] : null,
          date: keys.dateKey ? row[keys.dateKey] : null,
          day: keys.dayKey ? row[keys.dayKey] : null,
          sessionLocation: keys.locationKey ? row[keys.locationKey] : null,
          totalFarmers: keys.farmersKey ? num(row[keys.farmersKey]) : 0,
          totalAcres: keys.acresKey ? num(row[keys.acresKey]) : 0,
          coordRaw: coordRaw || "",
          lat: parsedCoord ? parsedCoord.lat : null,
          lng: parsedCoord ? parsedCoord.lng : null,
        };
      });

      // Sort by SN if available
      sessions.sort((a, b) => {
        if (a.sn == null || b.sn == null) return 0;
        return a.sn - b.sn;
      });

      renderMap();
      updateSummaryAndTable();
    },
    error: function (err) {
      console.error("Error parsing CSV:", err);
    },
  });
}

document.addEventListener("DOMContentLoaded", loadCsvAndInit);
