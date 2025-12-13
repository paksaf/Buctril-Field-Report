/* Buctril Super Dashboard (Rev2)
   - Reads per-session Quick Report sheets: D#S#
   - Builds city → spot donut navigation + pivot insights (frequency-based)
   - Media gallery loads media.json with robust fallbacks
   - Background video: assets/bg.mp4 or bg.mp4 (optional)
*/

(() => {
  'use strict';

  const FILE_XLSX_CANDIDATES = [
    'Buctril_Super_Activations.xlsx',
    'Buctril_Super_Activations.XLSX'
  ];

  const MEDIA_JSON_CANDIDATES = [
    'assets/gallery/media.json',
    'media.json',
    'assets/media.json'
  ];

  const BG_VIDEO_CANDIDATES = [
    'assets/bg.mp4',
    'bg.mp4'
  ];

  const LOGO_CANDIDATES = {
    bayer: ['Bayer.jpg', 'Bayer.JPG', 'bayer.jpg', 'bayer.JPG', 'Bayer.png', 'bayer.png'],
    buctril: ['Buctril.jpg', 'Buctril.JPG', 'buctril.jpg', 'buctril.JPG', 'Buctril.png', 'buctril.png'],
    interact: ['Interact.gif', 'Interact.GIF', 'interact.gif', 'interact.GIF', 'Interact.png', 'interact.png']
  };

  const state = {
    sessions: [],
    filtered: [],
    selectedCity: '',
    selectedSpot: '',
    query: ''
  };

  const charts = {
    donutOuter: null,
    donutInner: null,
    donutIntent: null,
    barUse: null,
    barNotUse: null
  };

  const $ = (id) => document.getElementById(id);

  function baseUrl() {
    // Ensure relative fetches always work even if URL is opened without trailing slash.
    return new URL('.', window.location.href).toString();
  }

  function absUrl(rel) {
    return new URL(rel, baseUrl()).toString();
  }

  function fmtInt(x) {
    if (!isFinite(x)) return '—';
    return Math.round(x).toLocaleString();
  }

  function clampNonNeg(n) {
    const x = Number(n);
    return isFinite(x) && x > 0 ? x : 0;
  }

  function normalizeStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function lower(s) { return normalizeStr(s).toLowerCase(); }

  function isLikelyPhoneNumber(n) {
    // Defensive: avoid accidentally aggregating phone numbers as "metrics".
    const s = normalizeStr(n);
    const digits = s.replace(/[^\d]/g, '');
    return digits.length >= 9 && digits.length <= 14;
  }

  function makePalette(n, opts = {}) {
    // Multi-color palette (stable) + green-forward look
    const sat = opts.sat ?? 70;
    const light = opts.light ?? 55;
    const out = [];
    for (let i = 0; i < n; i++) {
      const hue = (i * 360 / Math.max(1, n)) % 360;
      out.push(`hsl(${hue}, ${sat}%, ${light}%)`);
    }
    return out;
  }

  async function fetchFirstOk(candidates, as = 'arrayBuffer') {
    for (const rel of candidates) {
      try {
        const res = await fetch(absUrl(rel), { cache: 'no-store' });
        if (!res.ok) continue;
        if (as === 'json') return await res.json();
        if (as === 'text') return await res.text();
        return await res.arrayBuffer();
      } catch (e) {
        // try next
      }
    }
    throw new Error(`Could not fetch any of: ${candidates.join(', ')}`);
  }

  function setStatus(msg) {
    const el = $('statusLine');
    if (el) el.textContent = msg;
  }

  // ---------- Excel parsing (D#S# quick reports) ----------

  function sheetToRows(wb, name) {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
    return rows || [];
  }

  function findRowIndex(rows, predicate, maxRows = 60) {
    const lim = Math.min(rows.length, maxRows);
    for (let r = 0; r < lim; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (predicate(row[c], r, c, row)) return r;
      }
    }
    return -1;
  }

  function findValueAfterLabel(rows, labelRegex, opts = {}) {
    const maxR = opts.maxR ?? 60;
    const maxC = opts.maxC ?? 16;

    for (let r = 0; r < Math.min(rows.length, maxR); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < Math.min(row.length, maxC); c++) {
        const v = row[c];
        if (typeof v === 'string' && labelRegex.test(v)) {
          // Search right
          for (let cc = c + 1; cc < Math.min(row.length, maxC); cc++) {
            const cand = row[cc];
            if (typeof cand === 'number' && isFinite(cand)) return cand;
            if (typeof cand === 'string' && cand && !isLikelyPhoneNumber(cand)) {
              const num = Number(cand.replace(/,/g, ''));
              if (isFinite(num)) return num;
            }
          }
          // Search down (same column)
          for (let rr = r + 1; rr < Math.min(rows.length, r + 6); rr++) {
            const cand = (rows[rr] || [])[c];
            if (typeof cand === 'number' && isFinite(cand)) return cand;
            if (typeof cand === 'string' && cand && !isLikelyPhoneNumber(cand)) {
              const num = Number(cand.replace(/,/g, ''));
              if (isFinite(num)) return num;
            }
          }
        }
      }
    }
    return null;
  }

  function extractMessageClarity(rows) {
    // Find the "Message Understanding" header row, then read next row numeric scores (usually 5 values)
    const headerR = findRowIndex(rows, (cell) => typeof cell === 'string' && /message understanding/i.test(cell), 50);
    if (headerR < 0) return null;

    // Look for the row that contains the message statements; next row contains scores.
    const msgR = findRowIndex(rows.slice(headerR, headerR + 12), (cell) => typeof cell === 'string' && /weeds can reduce/i.test(cell), 12);
    if (msgR < 0) return null;

    const scoreRow = rows[headerR + msgR + 1] || [];
    const scores = scoreRow
      .map(v => (typeof v === 'number' && isFinite(v) ? v : null))
      .filter(v => v !== null);

    if (!scores.length) return null;
    const take = scores.slice(0, 5);
    const avg = take.reduce((a, b) => a + b, 0) / take.length;
    return avg;
  }

  function extractReasons(rows) {
    // Returns { use: [{reason,count}], notUse: [...] }
    const out = { use: [], notUse: [] };

    const startR = findRowIndex(rows, (cell) => typeof cell === 'string' && /reasons to use/i.test(cell), 80);
    if (startR < 0) return out;

    // Find header row with "Reason" and "Count"
    let hdrR = -1;
    for (let r = startR; r < Math.min(rows.length, startR + 12); r++) {
      const row = rows[r] || [];
      const reasons = row.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
      if (reasons.some(s => /^Reason$/i.test(s)) && reasons.some(s => /^Count$/i.test(s))) {
        hdrR = r;
        break;
      }
    }
    if (hdrR < 0) return out;

    const hdr = rows[hdrR] || [];
    const idxReason = [];
    const idxCount = [];
    for (let c = 0; c < hdr.length; c++) {
      const v = hdr[c];
      if (typeof v === 'string' && /^Reason$/i.test(v.trim())) idxReason.push(c);
      if (typeof v === 'string' && /^Count$/i.test(v.trim())) idxCount.push(c);
    }

    // Expect two pairs: (reason,count) for USE and (reason,count) for NOT USE.
    const useReasonCol = idxReason[0] ?? 1;
    const useCountCol  = idxCount[0] ?? 3;
    const notReasonCol = idxReason[1] ?? 4;
    const notCountCol  = idxCount[1] ?? 7;

    for (let r = hdrR + 1; r < Math.min(rows.length, hdrR + 18); r++) {
      const row = rows[r] || [];
      // Stop if next section starts
      const rowText = row.map(v => (typeof v === 'string' ? v : '')).join(' ');
      if (/key influencers/i.test(rowText) || /^5\./.test(rowText.trim())) break;

      const ur = normalizeStr(row[useReasonCol]);
      const uc = row[useCountCol];
      const nr = normalizeStr(row[notReasonCol]);
      const nc = row[notCountCol];

      if (ur) {
        const c = (typeof uc === 'number' && isFinite(uc)) ? uc : Number(String(uc || '').replace(/,/g, ''));
        if (isFinite(c) && c > 0 && c < 5000) out.use.push({ reason: ur, count: c });
      }
      if (nr) {
        const c = (typeof nc === 'number' && isFinite(nc)) ? nc : Number(String(nc || '').replace(/,/g, ''));
        if (isFinite(c) && c > 0 && c < 5000) out.notUse.push({ reason: nr, count: c });
      }
    }

    return out;
  }

  function extractSessionSummary(rows) {
    // Locate row with "Village / Mauza" and read next row
    const hdrR = findRowIndex(rows, (cell) => typeof cell === 'string' && /village\s*\/\s*mauza/i.test(cell), 20);
    if (hdrR < 0) return null;
    const dataRow = rows[hdrR + 1] || [];
    const village = normalizeStr(dataRow[1]);
    const city = normalizeStr(dataRow[2]);
    const host = normalizeStr(dataRow[3]);
    const contact = normalizeStr(dataRow[4]);
    const spotType = normalizeStr(dataRow[5]);
    const dealer = normalizeStr(dataRow[6]);
    const dealerContact = normalizeStr(dataRow[7]);
    const coord = normalizeStr(dataRow[8]);

    return { village, city, host, contact, spotType, dealer, dealerContact, coord };
  }

  function parseSessionSheet(sheetName, rows) {
    const m = sheetName.match(/^D(\d+)S(\d+)$/i);
    const day = m ? Number(m[1]) : null;
    const sessionNo = m ? Number(m[2]) : null;

    const summary = extractSessionSummary(rows);
    if (!summary) return null;

    const totalFarmers = clampNonNeg(findValueAfterLabel(rows, /total farmers present/i));
    const wheatFarmers = clampNonNeg(findValueAfterLabel(rows, /total wheat farmers/i));
    const acres = clampNonNeg(findValueAfterLabel(rows, /total wheat acres represented/i));
    const know = clampNonNeg(findValueAfterLabel(rows, /already know buctril/i));
    const usedLastYear = clampNonNeg(findValueAfterLabel(rows, /used buctril.*last year/i));
    const definite = clampNonNeg(findValueAfterLabel(rows, /will definitely use/i));
    const maybe = clampNonNeg(findValueAfterLabel(rows, /maybe.*will think/i));
    const estAcres = clampNonNeg(findValueAfterLabel(rows, /estimated acres to be sprayed/i));
    const clarity = extractMessageClarity(rows);

    const reasons = extractReasons(rows);

    const hasSignal = summary.city || summary.village || totalFarmers || acres || definite || maybe;
    if (!hasSignal) return null;

    const safeTotal = totalFarmers || (definite + maybe);
    const other = Math.max(0, safeTotal - definite - maybe);

    return {
      sheet: sheetName,
      day,
      sessionNo,
      ...summary,
      totalFarmers,
      wheatFarmers,
      acres,
      know,
      usedLastYear,
      definite,
      maybe,
      other,
      estAcres,
      clarity,
      reasonsUse: reasons.use,
      reasonsNotUse: reasons.notUse
    };
  }

  async function loadSessionsFromWorkbook() {
    setStatus('Loading workbook…');
    const buf = await fetchFirstOk(FILE_XLSX_CANDIDATES, 'arrayBuffer');
    const wb = XLSX.read(buf, { type: 'array' });

    const sheetNames = wb.SheetNames || [];
    const dSheets = sheetNames.filter(n => /^D\d+S\d+$/i.test(n));

    const sessions = [];
    for (const name of dSheets) {
      const rows = sheetToRows(wb, name);
      const s = parseSessionSheet(name, rows);
      if (s) sessions.push(s);
    }

    // Campaign days from max day number in sheet names
    const maxDay = sessions.reduce((mx, s) => (s.day ? Math.max(mx, s.day) : mx), 0);
    $('campaignDays').textContent = `Campaign Days: ${maxDay || '—'}`;

    return sessions;
  }

  // ---------- Filtering ----------

  function applyFilters() {
    const city = state.selectedCity;
    const spot = state.selectedSpot;
    const q = lower(state.query);

    const filtered = state.sessions.filter(s => {
      if (city && lower(s.city) !== lower(city)) return false;
      if (spot && lower(s.village) !== lower(spot)) return false;
      if (q) {
        const hay = `${s.city} ${s.village} ${s.host} ${s.dealer} ${s.spotType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    state.filtered = filtered;
  }

  function uniqueSorted(arr) {
    return [...new Set(arr.filter(Boolean).map(s => s.trim()))].sort((a,b) => a.localeCompare(b));
  }

  function refreshFiltersUI() {
    const citySel = $('citySel');
    const spotSel = $('spotSel');

    const cities = uniqueSorted(state.sessions.map(s => s.city).filter(Boolean));
    citySel.innerHTML = `<option value="">All Cities</option>` + cities.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    citySel.value = state.selectedCity || '';

    const spotSource = state.selectedCity
      ? state.sessions.filter(s => lower(s.city) === lower(state.selectedCity))
      : state.sessions;

    const spots = uniqueSorted(spotSource.map(s => s.village).filter(Boolean));
    spotSel.innerHTML = `<option value="">All Spots</option>` + spots.map(sp => `<option value="${escapeHtml(sp)}">${escapeHtml(sp)}</option>`).join('');
    spotSel.value = state.selectedSpot || '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // ---------- Aggregations ----------

  function sum(arr, fn) { return arr.reduce((a, x) => a + (fn(x) || 0), 0); }

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  }

  function computeKpis(rows) {
    const sessions = rows.length;
    const farmers = sum(rows, r => r.totalFarmers);
    const acres = sum(rows, r => r.acres);
    const cities = new Set(rows.map(r => normalizeStr(r.city)).filter(Boolean)).size;

    const definite = sum(rows, r => r.definite);
    const maybe = sum(rows, r => r.maybe);
    const other = Math.max(0, farmers - definite - maybe);

    // Clarity: average of session clarity averages
    const clarityVals = rows.map(r => r.clarity).filter(v => typeof v === 'number' && isFinite(v));
    const clarityAvg = clarityVals.length ? (clarityVals.reduce((a,b)=>a+b,0) / clarityVals.length) : null;

    return { sessions, farmers, acres, cities, definite, maybe, other, clarityAvg };
  }

  function aggReasons(rows, kind) {
    // kind = 'reasonsUse' | 'reasonsNotUse'
    const m = new Map();
    for (const s of rows) {
      const list = s[kind] || [];
      for (const it of list) {
        const key = normalizeStr(it.reason);
        const val = Number(it.count);
        if (!key || !isFinite(val)) continue;
        m.set(key, (m.get(key) || 0) + val);
      }
    }
    // sort desc
    const out = [...m.entries()].map(([reason,count]) => ({reason, count}))
      .sort((a,b) => b.count - a.count)
      .slice(0, 12);
    return out;
  }

  // ---------- Charts ----------

  function destroyChart(ch) { try { ch && ch.destroy(); } catch(e) {} }

  function render() {
    applyFilters();

    refreshFiltersUI();
    const rows = state.filtered;

    // Status
    const missingCity = rows.filter(r => !normalizeStr(r.city)).length;
    const missingSpot = rows.filter(r => !normalizeStr(r.village)).length;
    setStatus(`Loaded ${state.sessions.length} session sheets. Filtered: ${rows.length}. Missing city: ${missingCity}. Missing spot: ${missingSpot}.`);

    // KPIs
    const k = computeKpis(rows);
    $('kSessions').textContent = fmtInt(k.sessions);
    $('kFarmers').textContent = fmtInt(k.farmers);
    $('kAcres').textContent = fmtInt(k.acres);
    $('kCities').textContent = fmtInt(k.cities);
    $('kSessionsS').textContent = state.selectedCity ? `City: ${state.selectedCity}` : 'All cities';
    $('kFarmersS').textContent = k.clarityAvg ? `Avg clarity: ${k.clarityAvg.toFixed(2)} / 3` : 'Avg clarity: —';
    $('kAcresS').textContent = 'Wheat acres represented';
    $('kCitiesS').textContent = state.selectedSpot ? `Spot: ${state.selectedSpot}` : 'Unique cities in filter';

    // Donut outer (cities by farmers)
    const cityGroups = groupBy(rows.filter(r => normalizeStr(r.city)), r => normalizeStr(r.city));
    const cityLabels = [...cityGroups.keys()].sort((a,b)=>a.localeCompare(b));
    const cityValues = cityLabels.map(c => sum(cityGroups.get(c), s => s.totalFarmers));

    const cityColors = makePalette(cityLabels.length, { sat: 72, light: 56 });

    destroyChart(charts.donutOuter);
    charts.donutOuter = new Chart($('donutOuter'), {
      type: 'doughnut',
      data: {
        labels: cityLabels,
        datasets: [{
          data: cityValues,
          backgroundColor: cityColors,
          borderColor: 'rgba(255,255,255,.20)',
          borderWidth: 1,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${fmtInt(ctx.raw)} farmers`
            }
          }
        },
        onClick: (evt, els) => {
          if (!els || !els.length) return;
          const idx = els[0].index;
          const city = cityLabels[idx];
          state.selectedCity = city;
          state.selectedSpot = '';
          $('citySel').value = city;
          $('spotSel').value = '';
          render();
        }
      }
    });

    // Donut inner (spots within selected city)
    const spotBase = state.selectedCity
      ? rows.filter(r => lower(r.city) === lower(state.selectedCity))
      : rows;

    const spotGroups = groupBy(spotBase.filter(r => normalizeStr(r.village)), r => normalizeStr(r.village));
    let spotLabels = [...spotGroups.keys()].sort((a,b)=>a.localeCompare(b));
    // Keep inner donut readable: top 12 spots
    spotLabels = spotLabels.slice(0, 12);
    const spotValues = spotLabels.map(sp => sum(spotGroups.get(sp), s => s.totalFarmers));
    const spotColors = makePalette(spotLabels.length, { sat: 55, light: 48 });

    const donutHint = $('donutHint');
    if (donutHint) {
      donutHint.textContent = state.selectedCity
        ? `Showing spots for city: ${state.selectedCity}. Click “Clear filter” to return.`
        : `No city selected. Inner donut shows top spots overall.`;
    }

    destroyChart(charts.donutInner);
    charts.donutInner = new Chart($('donutInner'), {
      type: 'doughnut',
      data: {
        labels: spotLabels,
        datasets: [{
          data: spotValues,
          backgroundColor: spotColors,
          borderColor: 'rgba(255,255,255,.18)',
          borderWidth: 1,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.label}: ${fmtInt(ctx.raw)} farmers` }
          }
        },
        onClick: (evt, els) => {
          if (!els || !els.length) return;
          const idx = els[0].index;
          const spot = spotLabels[idx];
          state.selectedSpot = spot;
          $('spotSel').value = spot;
          render();
        }
      }
    });

    // Intent donut (Definite / Maybe / Other)
    destroyChart(charts.donutIntent);
    const intentLabels = ['Definite', 'Maybe', 'Other'];
    const intentValues = [k.definite, k.maybe, k.other];
    charts.donutIntent = new Chart($('donutIntent'), {
      type: 'doughnut',
      data: {
        labels: intentLabels,
        datasets: [{
          data: intentValues,
          backgroundColor: ['rgba(43,182,115,.95)', 'rgba(43,182,115,.55)', 'rgba(255,255,255,.22)'],
          borderColor: 'rgba(255,255,255,.18)',
          borderWidth: 1,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: 'rgba(234,242,255,.85)', boxWidth: 14 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtInt(ctx.raw)}` } }
        }
      }
    });

    // Bar charts (reasons)
    const use = aggReasons(rows, 'reasonsUse');
    const notUse = aggReasons(rows, 'reasonsNotUse');

    destroyChart(charts.barUse);
    charts.barUse = new Chart($('barUse'), {
      type: 'bar',
      data: {
        labels: use.map(x => x.reason),
        datasets: [{
          label: 'Count',
          data: use.map(x => x.count),
          backgroundColor: 'rgba(43,182,115,.55)',
          borderColor: 'rgba(43,182,115,.95)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `Count: ${fmtInt(ctx.raw)}` } }
        },
        scales: {
          x: { ticks: { color: 'rgba(234,242,255,.75)', maxRotation: 20, minRotation: 20 }, grid: { color: 'rgba(255,255,255,.06)' } },
          y: { ticks: { color: 'rgba(234,242,255,.75)' }, grid: { color: 'rgba(255,255,255,.06)' } }
        }
      }
    });

    destroyChart(charts.barNotUse);
    charts.barNotUse = new Chart($('barNotUse'), {
      type: 'bar',
      data: {
        labels: notUse.map(x => x.reason),
        datasets: [{
          label: 'Count',
          data: notUse.map(x => x.count),
          backgroundColor: 'rgba(43,182,115,.35)',
          borderColor: 'rgba(43,182,115,.95)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `Count: ${fmtInt(ctx.raw)}` } }
        },
        scales: {
          x: { ticks: { color: 'rgba(234,242,255,.75)', maxRotation: 20, minRotation: 20 }, grid: { color: 'rgba(255,255,255,.06)' } },
          y: { ticks: { color: 'rgba(234,242,255,.75)' }, grid: { color: 'rgba(255,255,255,.06)' } }
        }
      }
    });
  }

  // ---------- Media ----------

  function mediaCandidates(src) {
    const s = normalizeStr(src);
    if (!s) return [];
    const out = new Set();

    const add = (x) => { if (x) out.add(x); };

    add(s);

    // Common extension fixes
    if (s.toLowerCase().endsWith('.jpeg')) add(s.slice(0, -5) + '.jpg');
    if (s.toLowerCase().endsWith('.jpg')) add(s.slice(0, -4) + '.jpeg');

    // If path is assets/gallery/... also try root path
    if (s.startsWith('assets/gallery/')) add(s.replace(/^assets\/gallery\//, ''));
    if (s.startsWith('./')) add(s.replace(/^\.\//, ''));

    // Try case variations for assets folder
    add(s.replace(/Assets\//, 'assets/'));

    return [...out];
  }

  function mountMissing(el, original) {
    const box = document.createElement('div');
    box.className = 'missing';
    box.textContent = `Missing file: ${original}`;
    el.replaceWith(box);
  }

  function attachFallbackMedia(el, candidates, original) {
    let i = 0;
    const tryNext = () => {
      i++;
      if (i >= candidates.length) return mountMissing(el, original);
      el.src = absUrl(candidates[i]);
    };
    el.addEventListener('error', tryNext, { once: false });
    el.src = absUrl(candidates[0]);
  }

  async function loadMedia() {
    const grid = $('mediaGrid');
    if (!grid) return;

    let media = [];
    try {
      media = await fetchFirstOk(MEDIA_JSON_CANDIDATES, 'json');
    } catch (e) {
      grid.innerHTML = `<div class="missing" style="grid-column:1/-1">media.json not found. Add media.json (or assets/gallery/media.json) to enable gallery.</div>`;
      return;
    }

    if (!Array.isArray(media) || !media.length) {
      grid.innerHTML = `<div class="missing" style="grid-column:1/-1">media.json loaded but empty.</div>`;
      return;
    }

    grid.innerHTML = '';
    const maxItems = Math.min(media.length, 24); // keep page light
    for (let idx = 0; idx < maxItems; idx++) {
      const it = media[idx] || {};
      const type = normalizeStr(it.type).toLowerCase();
      const src = normalizeStr(it.src);
      const title = normalizeStr(it.alt || it.caption || `Media ${idx + 1}`);
      const caption = normalizeStr(it.caption || '');

      const card = document.createElement('div');
      card.className = 'mcard';

      const head = document.createElement('div');
      head.className = 'mhead';
      head.textContent = title;

      const foot = document.createElement('div');
      foot.className = 'mfoot';
      foot.textContent = caption || src || '';

      const body = document.createElement('div');
      body.className = 'mbody';

      card.appendChild(head);
      card.appendChild(body);
      card.appendChild(foot);

      const candidates = mediaCandidates(src);
      if (!candidates.length) {
        const miss = document.createElement('div');
        miss.className = 'missing';
        miss.textContent = 'Missing src in media.json';
        body.appendChild(miss);
        grid.appendChild(card);
        continue;
      }

      if (type === 'video') {
        const v = document.createElement('video');
        v.controls = true;
        v.preload = 'metadata';
        v.playsInline = true;
        v.muted = true;
        attachFallbackMedia(v, candidates, src);
        body.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.alt = title;
        img.loading = 'lazy';
        attachFallbackMedia(img, candidates, src);
        body.appendChild(img);
      }

      grid.appendChild(card);
    }

    if (media.length > maxItems) {
      const more = document.createElement('div');
      more.className = 'missing';
      more.style.gridColumn = '1/-1';
      more.textContent = `Showing first ${maxItems} items (of ${media.length}).`;
      grid.appendChild(more);
    }
  }

  // ---------- Background + Logos ----------

  function attachFallbackSrc(imgEl, candidates) {
    let i = 0;
    const tryNext = () => {
      i++;
      if (i >= candidates.length) return;
      imgEl.src = absUrl(candidates[i]);
    };
    imgEl.addEventListener('error', tryNext);
    imgEl.src = absUrl(candidates[0]);
  }

  function initLogos() {
    const b = $('logoBayer');
    const bu = $('logoBuctril');
    const inx = $('logoInteract');
    if (b) attachFallbackSrc(b, LOGO_CANDIDATES.bayer);
    if (bu) attachFallbackSrc(bu, LOGO_CANDIDATES.buctril);
    if (inx) attachFallbackSrc(inx, LOGO_CANDIDATES.interact);
  }

  function initBackgroundVideo() {
    const v = $('bgVideo');
    if (!v) return;

    let i = 0;
    const tryNext = () => {
      i++;
      if (i >= BG_VIDEO_CANDIDATES.length) {
        v.removeAttribute('src');
        v.style.display = 'none';
        return;
      }
      v.src = absUrl(BG_VIDEO_CANDIDATES[i]);
      v.load();
      v.play().catch(() => {});
    };

    v.addEventListener('error', tryNext);
    v.src = absUrl(BG_VIDEO_CANDIDATES[i]);
    v.load();
    v.play().catch(() => {});
  }

  // ---------- Events ----------

  function bindEvents() {
    $('citySel').addEventListener('change', (e) => {
      state.selectedCity = e.target.value || '';
      state.selectedSpot = '';
      $('spotSel').value = '';
      render();
    });
    $('spotSel').addEventListener('change', (e) => {
      state.selectedSpot = e.target.value || '';
      render();
    });
    $('q').addEventListener('input', (e) => {
      state.query = e.target.value || '';
      render();
    });
    $('btnClear').addEventListener('click', () => {
      state.selectedCity = '';
      state.selectedSpot = '';
      state.query = '';
      $('citySel').value = '';
      $('spotSel').value = '';
      $('q').value = '';
      render();
    });
  }

  // ---------- Boot ----------

  async function boot() {
    initLogos();
    initBackgroundVideo();
    bindEvents();

    try {
      const sessions = await loadSessionsFromWorkbook();
      state.sessions = sessions;

      // Initial UI selections
      state.selectedCity = '';
      state.selectedSpot = '';
      state.query = '';

      // Default: exclude fully-empty city rows from city filter options, but keep them in dataset for KPIs if needed.
      state.filtered = [...sessions];

      // Build UI + charts
      render();
      loadMedia();
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message}. Ensure Buctril_Super_Activations.xlsx is in repo root and GitHub Pages is serving it.`);
    }
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
