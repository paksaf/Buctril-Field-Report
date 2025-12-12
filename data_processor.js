/****************************************************
 * Buctril Field Report – Data Processor
 * Expects files in SAME FOLDER as index.html:
 * - sum_sheet.csv
 * - 1.jpeg, 1.mp4, 2.jpeg, 2.mp4, ...
 ****************************************************/

// ---------- BASIC HELPERS ----------
function safeNumber(val) {
  if (val === null || val === undefined) return 0;
  var n = parseFloat(String(val).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function formatInt(val) {
  return val.toLocaleString("en-US");
}

function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showErrorModal(message) {
  var existing = document.querySelector(".error-modal");
  if (existing) existing.remove();

  var modal = document.createElement("div");
  modal.className = "error-modal";
  modal.innerHTML =
    "<p>" + message + "</p><button type='button'>Close</button>";
  document.body.appendChild(modal);
  var btn = modal.querySelector("button");
  if (btn) btn.addEventListener("click", function () { modal.remove(); });
}

// ---------- GLOBAL STATE ----------
var allRows = [];
var filteredRows = [];
var uniqueDates = [];
var citySummary = [];
var map = null;
var mapMarkers = [];
var clarityChart = null;
var cityFarmersChart = null;
var adoptionChart = null;

// ---------- CSV LOAD ----------
function loadCSV() {
  var loadingEl = document.getElementById("loading-message");

  fetch("sum_sheet.csv")
    .then(function (response) {
      if (!response.ok) {
        throw new Error("CSV file not found or failed to load: " + response.statusText);
      }
      return response.text();
    })
    .then(function (csvText) {
      // Use PapaParse (assumed to be loaded in index.html)
      var parsed = Papa.parse(csvText, {
        header: true,
        dynamicTyping: false, // Keep as strings initially
        skipEmptyLines: true,
      });

      if (parsed.errors.length > 0) {
        console.error("CSV Parsing Errors:", parsed.errors);
        showErrorModal("Error loading data: CSV file has parsing errors. Please check the console for details.");
        return;
      }

      allRows = parsed.data.map(function (row, index) {
        // Renaming and sanitizing key fields
        var r = {};
        // Unique ID for media files
        r.id = index + 1;

        // Key Metrics
        r.date = row.Date ? row.Date.trim() : "";
        r.city = row.City ? row.City.trim() : "";
        r.location = row["Session Location"] ? row["Session Location"].trim() : "";
        r.from = row["From City"] ? row["From City"].trim() : "";

        // Raw numbers
        r.__farmers = safeNumber(row["No of Farmer Participate"]);
        r.__acres = safeNumber(row["Acres"]);

        // Campaign Metrics
        r.__messageClarity = safeNumber(row["Message Clarity %"]);
        r.__definiteUseRate = safeNumber(row["Definite Use %"]);
        r.__influencers = safeNumber(row["Influencers"]);
        r.__awarenessRate = safeNumber(row["Awareness %"]);

        // Geo and Route
        r.latitude = safeNumber(row.Latitude);
        r.longitude = safeNumber(row.Longitude);

        // Date processing for filters
        if (r.date) {
          try {
            var parts = r.date.split("-").map(function(p) { return p.trim(); });
            // Assuming date is in DD-Mon format (e.g., 12-Dec), need to infer year for sorting
            // This is a hacky assumption for report dates in 2023/2024
            var year = 2024; 
            var d = new Date(parts[1] + " " + parts[0] + ", " + year);
            if (!isNaN(d.getTime())) {
                r.dateObj = d;
            } else {
                r.dateObj = null;
            }
          } catch(e) {
            r.dateObj = null;
          }
        } else {
            r.dateObj = null;
        }

        return r;
      }).filter(r => r.__farmers > 0); // Filter out rows with 0 farmers

      // Populate unique dates for filter
      var dateSet = new Set(allRows.map(r => r.date).filter(Boolean));
      uniqueDates = Array.from(dateSet).sort(function(a, b) {
        // Simple sort, assuming string format is good enough or use dateObj
        var dateA = allRows.find(r => r.date === a)?.dateObj;
        var dateB = allRows.find(r => r.date === b)?.dateObj;
        if (dateA && dateB) return dateA.getTime() - dateB.getTime();
        return a.localeCompare(b);
      });

      // Populate filters and apply initial filter
      initFilters();
      applyFilters();

      if (loadingEl) loadingEl.remove();
    })
    .catch(function (error) {
      console.error("Fetch error:", error);
      showErrorModal("Error loading data: " + error.message);
      if (loadingEl) loadingEl.remove();
    });
}

// ---------- FILTER & INITIALIZATION ----------
function initFilters() {
  var cityFilter = document.getElementById("filter-city");
  var dateFilter = document.getElementById("filter-date");

  // City Filter
  var uniqueCities = Array.from(new Set(allRows.map(r => r.city).filter(Boolean))).sort();
  uniqueCities.forEach(function (city) {
    var option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    cityFilter.appendChild(option);
  });

  // Date Filter
  uniqueDates.forEach(function (date) {
    var option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    dateFilter.appendChild(option);
  });

  // Attach event listeners
  cityFilter.addEventListener("change", applyFilters);
  dateFilter.addEventListener("change", applyFilters);
}

function applyFilters() {
  var cityFilter = document.getElementById("filter-city").value;
  var dateFilter = document.getElementById("filter-date").value;
  var searchInput = (document.getElementById("filter-search").value || "").toLowerCase();

  filteredRows = allRows.filter(function (row) {
    var cityMatch = cityFilter === "" || row.city === cityFilter;
    var dateMatch = dateFilter === "" || row.date === dateFilter;
    var searchMatch = searchInput === "" ||
      row.city.toLowerCase().includes(searchInput) ||
      row.location.toLowerCase().includes(searchInput) ||
      row.from.toLowerCase().includes(searchInput);

    return cityMatch && dateMatch && searchMatch;
  });

  // Update all sections
  buildCitySummary(filteredRows);
  updateHeroAndSnapshot(filteredRows);
  updateKeyMetrics(filteredRows);
  updateCampaignMetrics(filteredRows); // NEW
  updateSessionTable(filteredRows);
  updateCityTable();
  updateCharts();
  initMap(filteredRows);
  initMediaGallery(filteredRows);
}

// ---------- KEY METRICS ----------
function updateKeyMetrics(rows) {
  var totalSessions = rows.length;
  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var totalAcres = rows.reduce(function (s, r) { return s + (r.__acres || 0); }, 0);
  var uniqueCities = new Set(rows.map(r => r.city)).size;
  var totalUniqueDates = new Set(rows.map(r => r.date)).size;

  setText("metric-sessions", formatInt(totalSessions));
  setText("metric-farmers", formatInt(totalFarmers));
  setText("metric-acres", formatInt(totalAcres));
  setText("metric-cities", formatInt(uniqueCities));
  setText("metric-days", formatInt(totalUniqueDates));

  // Update Hero Section
  setText("hero-farmers", formatInt(totalFarmers));
  setText("hero-sessions", formatInt(totalSessions));
}

// ---------- CAMPAIGN METRICS ----------
function updateCampaignMetrics(rows) {
  var totalSessions = rows.length;
  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var totalAcres = rows.reduce(function (s, r) { return s + (r.__acres || 0); }, 0);

  // Calculate metrics
  var avgClarity = 0;
  var avgDefiniteUse = 0;
  var totalInfluencers = 0;
  var avgAwareness = 0;
  var totalDefiniteFarmers = 0;

  if (rows.length > 0) {
    avgClarity = rows.reduce(function (s, r) { return s + (r.__messageClarity || 0); }, 0) / rows.length;
    avgDefiniteUse = rows.reduce(function (s, r) { return s + (r.__definiteUseRate || 0); }, 0) / rows.length;
    totalInfluencers = rows.reduce(function (s, r) { return s + (r.__influencers || 0); }, 0);
    avgAwareness = rows.reduce(function (s, r) { return s + (r.__awarenessRate || 0); }, 0) / rows.length;

    totalDefiniteFarmers = rows.reduce(function (s, r) {
      // Estimated definite-use farmers: farmers * (definiteUseRate / 100)
      return s + Math.round((r.__farmers || 0) * (r.__definiteUseRate || 0) / 100);
    }, 0);
  }

  // Update text values
  setText("metric-clarity", Math.round(avgClarity) + "%");
  setText("metric-definite", Math.round(avgDefiniteUse) + "%");
  setText("metric-influencers", formatInt(totalInfluencers));
  setText("metric-awareness", Math.round(avgAwareness) + "%");

  // Update progress bars
  var clarityProgress = document.getElementById("clarity-progress");
  var definiteProgress = document.getElementById("definite-progress");
  var influencersProgress = document.getElementById("influencers-progress");
  var awarenessProgress = document.getElementById("awareness-progress");
  var clarityStars = document.getElementById("clarity-stars");

  if (clarityProgress) clarityProgress.style.width = Math.round(avgClarity) + "%";
  if (definiteProgress) definiteProgress.style.width = Math.round(avgDefiniteUse) + "%";
  if (influencersProgress) {
    // 201 = rough max influencers from earlier data (scale to 0-100%)
    influencersProgress.style.width =
      Math.min(100, Math.round((totalInfluencers / 201) * 100)) + "%";
  }
  if (awarenessProgress) awarenessProgress.style.width = Math.round(avgAwareness) + "%";

  // Star rating for clarity (5-star scale)
  if (clarityStars) {
    var stars = Math.round(avgClarity / 20); // 0-100 → 0-5 stars
    clarityStars.innerHTML = "★".repeat(stars) + "☆".repeat(5 - stars);
  }

  // Also update the adoption text here so it stays consistent with the donut
  var adoptionText = document.getElementById("adoption-text");
  if (adoptionText) {
    var defPct = totalFarmers > 0
      ? Math.round((totalDefiniteFarmers / totalFarmers) * 100)
      : Math.round(avgDefiniteUse); // fallback

    adoptionText.textContent =
      "Estimated definite-use farmers: " +
      formatInt(totalDefiniteFarmers) +
      " (" + defPct + "%)";
  }
}

// ---------- CHARTS & SNAPSHOTS ----------
function updateHeroAndSnapshot(rows) {
  var totalFarmers = rows.reduce(function (s, r) { return s + (r.__farmers || 0); }, 0);
  var totalAcres = rows.reduce(function (s, r) { return s + (r.__acres || 0); }, 0);

  // Calculate the definite use farmers (for the adoption donut/bar)
  var definiteFarmers = rows.reduce(function (s, r) {
    return s + Math.round((r.__farmers || 0) * (r.__definiteUseRate || 0) / 100);
  }, 0);

  // Update Charts
  updateAdoptionChart(totalFarmers, definiteFarmers);
  // Other chart updates would go here if they relied on specific metrics
}

function updateAdoptionChart(totalFarmers, definiteFarmers) {
  if (adoptionChart) {
    adoptionChart.data.datasets[0].data = [totalFarmers - definiteFarmers, definiteFarmers];
    adoptionChart.update();
  }
  // Text is handled in updateCampaignMetrics
}

// ... [The rest of the functions: updateCharts, initAdoptionChart, initClarityChart, 
// buildCitySummary, updateCityTable, updateSessionTable, initMap, initMediaGallery, 
// openLightbox, closeLightbox, etc. remain here but are omitted for brevity] ...

// [START OF OMITTED CODE BLOCK]
// The user provided the full implementation of the helper function, 
// the campaign metrics function, and the call sites.
// The omitted code here would include the remaining functions 
// from the original data_processor.js file which were not modified 
// (e.g., updateCharts, buildCitySummary, initMap, initMediaGallery, etc.)
// For this response, I will include only the modified/new parts 
// as requested to keep the output concise.

function updateCharts() {
  if (!clarityChart) initClarityChart();
  if (!cityFarmersChart) initCityFarmersChart();

  // 1. Message Clarity Bar Chart
  var clarityData = filteredRows
    .filter(r => r.city && r.__messageClarity > 0)
    .sort((a, b) => b.__messageClarity - a.__messageClarity)
    .slice(0, 5); // Top 5
  
  clarityChart.data.labels = clarityData.map(r => r.city);
  clarityChart.data.datasets[0].data = clarityData.map(r => r.__messageClarity);
  clarityChart.update();

  // 2. City Farmers Bar Chart
  var cityData = citySummary
    .sort((a, b) => b.totalFarmers - a.totalFarmers)
    .slice(0, 5); // Top 5
  
  cityFarmersChart.data.labels = cityData.map(s => s.city);
  cityFarmersChart.data.datasets[0].data = cityData.map(s => s.totalFarmers);
  cityFarmersChart.update();
}

function initAdoptionChart() {
  var ctx = document.getElementById("adoption-donut");
  if (!ctx) return;
  adoptionChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Potential Use", "Definite Use"],
      datasets: [
        {
          label: "Farmers",
          data: [1, 0], // Initial dummy data
          backgroundColor: ["#e0e0e0", "#66bb6a"],
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '80%',
      plugins: {
        legend: {
          position: "bottom",
        },
        title: {
          display: true,
          text: "Definite use intent (filtered view)",
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              var label = context.label || "";
              if (label) {
                label += ": ";
              }
              if (context.parsed !== null) {
                label += formatInt(context.parsed);
              }
              return label;
            },
          },
        },
      },
    },
  });
}

function initClarityChart() {
  var ctx = document.getElementById("clarity-bar");
  if (!ctx) return;
  clarityChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Avg. Message Clarity (%)",
          data: [],
          backgroundColor: "#42a5f5",
          borderColor: "#2196f3",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Top 5 Cities by Message Clarity" },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + Math.round(c.parsed.y) + "%"; } } },
      },
      scales: { y: { beginAtZero: true, max: 100 } },
    },
  });
}

function initCityFarmersChart() {
  var ctx = document.getElementById("city-farmers-bar");
  if (!ctx) return;
  cityFarmersChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Total Farmers",
          data: [],
          backgroundColor: "#ff7043",
          borderColor: "#ff5722",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Top 5 Cities by Farmer Count" },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + formatInt(Math.round(c.parsed.y)); } } },
      },
      scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return formatInt(v); } } } },
    },
  });
}

function buildCitySummary(rows) {
  var summaryMap = {};
  rows.forEach(function (r) {
    var city = r.city;
    if (!summaryMap[city]) {
      summaryMap[city] = {
        city: city,
        totalSessions: 0,
        totalFarmers: 0,
        totalAcres: 0,
        totalClarity: 0,
        totalClarityCount: 0,
      };
    }
    summaryMap[city].totalSessions += 1;
    summaryMap[city].totalFarmers += r.__farmers || 0;
    summaryMap[city].totalAcres += r.__acres || 0;
    if (r.__messageClarity > 0) {
      summaryMap[city].totalClarity += r.__messageClarity;
      summaryMap[city].totalClarityCount += 1;
    }
  });

  citySummary = Object.values(summaryMap).map(s => {
    s.avgClarity = s.totalClarityCount > 0 ? s.totalClarity / s.totalClarityCount : 0;
    return s;
  });
}

function updateCityTable() {
  var tbody = document.getElementById("city-table-body");
  if (!tbody) return;

  tbody.innerHTML = ""; // Clear existing rows

  // Sort by totalFarmers descending
  var sortedSummary = [...citySummary].sort((a, b) => b.totalFarmers - a.totalFarmers);

  sortedSummary.forEach(function (s) {
    var row = tbody.insertRow();
    row.insertCell().textContent = s.city;
    row.insertCell().textContent = formatInt(s.totalSessions);
    row.insertCell().textContent = formatInt(s.totalFarmers);
    row.insertCell().textContent = formatInt(s.totalAcres);
    row.insertCell().textContent = Math.round(s.avgClarity) + "%";
  });
}

function updateSessionTable(rows) {
  var tbody = document.getElementById("session-table-body");
  if (!tbody) return;

  tbody.innerHTML = ""; // Clear existing rows

  rows.forEach(function (row, index) {
    var d = row.dateObj || { toISOString: () => "N/A" };
    var rowEl = tbody.insertRow();
    
    rowEl.insertCell().textContent = row.id;
    rowEl.insertCell().textContent = row.date;
    rowEl.insertCell().textContent = row.city;
    rowEl.insertCell().textContent = row.location;
    rowEl.insertCell().textContent = formatInt(row.__farmers);
    rowEl.insertCell().textContent = formatInt(row.__acres);
    rowEl.insertCell().textContent = Math.round(row.__messageClarity) + "%";
    rowEl.insertCell().textContent = Math.round(row.__definiteUseRate) + "%";
    rowEl.insertCell().textContent = formatInt(row.__influencers);
  });
}

function initMap(rows) {
  var mapContainer = document.getElementById("route-map");
  if (!mapContainer) return;

  // Initialize map if it hasn't been already
  if (map === null) {
    // Default to a central location if no data
    var initialCoords = [30.3753, 69.3451]; // Center of Pakistan
    map = L.map('route-map').setView(initialCoords, 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  // Clear existing markers
  mapMarkers.forEach(marker => map.removeLayer(marker));
  mapMarkers = [];

  var bounds = [];
  var hasMarkers = false;

  rows.forEach(function (row) {
    if (row.latitude !== 0 && row.longitude !== 0) {
      hasMarkers = true;
      var coords = [row.latitude, row.longitude];
      bounds.push(coords);

      var popupContent = `
        <strong>${row.location || row.city || 'Session'}</strong><br>
        ${row.city}<br>
        Date: ${row.date}<br>
        Farmers: ${formatInt(row.__farmers)}<br>
        Acres: ${formatInt(row.__acres)}
      `;

      var marker = L.marker(coords).addTo(map)
        .bindPopup(popupContent);
      
      mapMarkers.push(marker);
    }
  });

  if (hasMarkers) {
    var mapBounds = L.latLngBounds(bounds);
    map.fitBounds(mapBounds, { padding: [20, 20] });
  } else if (rows.length === 0 && mapMarkers.length === 0) {
    // No markers, reset view to initial (if needed, but not required by this logic)
    // map.setView([30.3753, 69.3451], 5);
  }
}

function initMediaGallery(rows) {
  var gallery = document.getElementById("media-gallery");
  if (!gallery) return;

  gallery.innerHTML = ""; // Clear existing cards

  rows.forEach(function (row, globalIndex) {
    var imgSrc = row.id + ".jpeg";
    var vidSrc = row.id + ".mp4";
    var d = row.dateObj || new Date();
    var loc = row.location || "";
    var city = row["From City"] || row.from || row["City"] || "";
    var farmers = row.__farmers || 0;
    var acres = row.__acres || 0;

    var card = document.createElement("div");
    card.className = "media-card";
    card.innerHTML =
      "<div class='media-thumb-wrap hover-video'>" +
      "<img src='" + imgSrc + "' alt='Session photo " + globalIndex + "' onerror=\"this.style.display='none';\" />" +
      "<video muted loop playsinline onerror=\"this.style.display='none';\">" +
      "<source src='" + vidSrc + "' type='video/mp4' />" +
      "</video></div>" +
      "<div class='media-caption'>" +
      "<strong>" + (loc || ("Session " + globalIndex)) + "</strong>" +
      "<span>" + city + " • " + farmers + " farmers • " + acres + " acres</span>" +
      "<span>" + d.toISOString().slice(0, 10) + "</span>" +
      "</div>";

    card.addEventListener("click", function () {
      openLightbox(imgSrc, vidSrc);
    });
    gallery.appendChild(card);
  });
}

function openLightbox(imgSrc, vidSrc) {
  var lb = document.getElementById("lightbox");
  var img = document.getElementById("lb-img");
  var vid = document.getElementById("lb-video");
  if (!lb || !img || !vid) return;

  img.src = imgSrc;
  vid.src = vidSrc;
  vid.load();
  lb.classList.add("active");
  // Set video to play on open if a source is available (simple check)
  if (vidSrc && vidSrc.endsWith(".mp4")) {
    vid.play();
  }
}

function closeLightbox() {
  var lb = document.getElementById("lightbox");
  var vid = document.getElementById("lb-video");
  if (lb) lb.classList.remove("active");
  if (vid) vid.pause();
}

// ---------- RUN ON LOAD ----------
document.addEventListener("DOMContentLoaded", function () {
  loadCSV();

  // Initialize lightbox close behavior
  var lb = document.getElementById("lightbox");
  if (lb) {
    lb.addEventListener("click", function (e) {
      // Only close if clicking the overlay or the close button
      if (e.target === lb || e.target.closest("#lb-close")) {
        closeLightbox();
      }
    });
  }

  // Initialize charts placeholders
  initAdoptionChart();
  initClarityChart();
  initCityFarmersChart();

  // Feedback form handler
  var feedbackForm = document.getElementById("feedback-form");
  if (feedbackForm) {
    feedbackForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = document.getElementById("feedback-status");
      if (!statusEl) return;

      var name = (document.getElementById("fb-name").value || "").trim();
      var phone = (document.getElementById("fb-phone").value || "").trim();
      var email = (document.getElementById("fb-email").value || "").trim();
      var org = (document.getElementById("fb-org").value || "").trim();
      var msg = (document.getElementById("fb-message").value || "").trim();

      if (!msg) {
        statusEl.textContent = "Please add your comment or feedback before submitting.";
        statusEl.classList.remove("success");
        statusEl.classList.add("error");
        return;
      }

      var subject = "Feedback – Buctril Super Farmer Education Drive Dashboard";
      var bodyLines = [];
      if (name) bodyLines.push("Name: " + name);
      if (phone) bodyLines.push("Contact number: " + phone);
      if (email) bodyLines.push("Email: " + email);
      if (org) bodyLines.push("Organization / Role: " + org);
      if (bodyLines.length) bodyLines.push("");
      bodyLines.push("Message:");
      bodyLines.push(msg);

      var body = bodyLines.join("\n");
      var mailtoLink =
        "mailto:interact@paksaf.com?subject=" +
        encodeURIComponent(subject) +
        "&body=" +
        encodeURIComponent(body);

      statusEl.textContent =
        "Opening your email application so you can send this feedback to interact@paksaf.com…";
      statusEl.classList.remove("error");
      statusEl.classList.add("success");

      window.location.href = mailtoLink;
    });
  }
});

// [END OF OMITTED CODE BLOCK]
