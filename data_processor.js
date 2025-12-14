/* AgriVista dashboard logic (Leaflet + Chart.js + XLSX)
   - Reads: Buctril_Super_Activations.xlsx (sheet: SUM; session sheets: D#S#)
   - Reads: media.json (format A_compact or legacy flat array)
   - Updates: KPIs, charts, map, sessions table, media gallery, showcases
*/
(() => {
  'use strict';

  const CFG = Object.freeze({
    xlsx: 'Buctril_Super_Activations.xlsx',
    media: 'media.json',
    defaultMapCenter: [30.3753, 69.3451], // Pakistan
    defaultMapZoom: 5,
    maxGalleryItems: 60,
    maxShowcaseItems: 10,
    maxReasons: 12,
  });

  const $ = (id) => document.getElementById(id);
  const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '—');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = v;
  }

  function setNotice(msg, isError = false) {
    const nb = $('noticeBox');
    if (!nb) return;
    nb.innerHTML = `<strong>${isError ? 'Error' : 'Status'}:</strong> ${escapeHtml(String(msg))}`;
    nb.style.borderColor = isError ? 'rgba(165,42,42,.28)' : 'rgba(17,41,22,.12)';
  }

  function setDiag(txt) {
    const db = $('diagBox');
    if (!db) return;
    if (!txt) {
      db.style.display = 'none';
      db.textContent = '';
      return;
    }
    db.style.display = 'block';
    db.textContent = txt;
  }

  function escapeHtml(s) {
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function norm(s) {
    return String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w% ]+/g, '');
  }

  function asNumber(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return NaN;
    const s = String(v).trim();
    if (!s) return NaN;
    // handle "12,345" or "65%" or "65 %"
    const cleaned = s.replace(/,/g, '').replace(/%/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function asDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF && XLSX.SSF.parse_date_code) {
      // Excel date serial
      const dc = XLSX.SSF.parse_date_code(v);
      if (dc && dc.y && dc.m && dc.d) return new Date(dc.y, dc.m - 1, dc.d);
    }
    const s = String(v ?? '').trim();
    if (!s) return null;

    // Try yyyy-mm-dd first
    const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    // Try dd-mm-yyyy
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function fmtDate(d) {
    if (!d) return '—';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  function uniq(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function safeUrl(rel) {
    // Robust relative URL resolution on GitHub Pages (handles both / and /index.html)
    return new URL(rel, window.location.href).toString();
  }

  // --- App state ---
  const state = {
    wb: null,
    sessions: [],
    farmers: [],
    mediaItems: [],
    filteredSessions: [],
    filteredFarmers: [],
    filteredMedia: [],
    totals: { sessions: 0, farmers: 0, acres: 0, demo: 0 },
    drill: { city: null }, // donut drill state
    charts: {},
    map: { map: null, markers: null, route: null },
    lightbox: { items: [], idx: 0 },
  };

  // --- Tabs ---
  function initTabs() {
    const buttons = Array.from(document.querySelectorAll('.tabBtn'));
    const panels = new Map();
    for (const b of buttons) {
      const id = b.getAttribute('data-tab');
      if (id) panels.set(id, $(id));
      b.addEventListener('click', () => {
        for (const bb of buttons) bb.setAttribute('aria-selected', bb === b ? 'true' : 'false');
        for (const [pid, p] of panels.entries()) p.classList.toggle('active', pid === id);
      });
    }
  }

  // --- Lightbox ---
  function initLightbox() {
    const lb = $('lightbox');
    const btnClose = $('lbClose');
    const btnPrev = $('lbPrev');
    const btnNext = $('lbNext');

    if (btnClose) btnClose.addEventListener('click', closeLightbox);
    if (btnPrev) btnPrev.addEventListener('click', () => showLightbox(state.lightbox.idx - 1));
    if (btnNext) btnNext.addEventListener('click', () => showLightbox(state.lightbox.idx + 1));

    if (lb) lb.addEventListener('click', (e) => {
      if (e.target === lb) closeLightbox();
    });

    window.addEventListener('keydown', (e) => {
      const open = lb && lb.getAttribute('aria-hidden') === 'false';
      if (!open) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') showLightbox(state.lightbox.idx - 1);
      if (e.key === 'ArrowRight') showLightbox(state.lightbox.idx + 1);
    });
  }

  function openLightbox(items, idx) {
    state.lightbox.items = items || [];
    state.lightbox.idx = clamp(idx ?? 0, 0, Math.max(0, state.lightbox.items.length - 1));
    const lb = $('lightbox');
    if (!lb) return;
    lb.setAttribute('aria-hidden', 'false');
    showLightbox(state.lightbox.idx);
  }

  function closeLightbox() {
    const lb = $('lightbox');
    if (!lb) return;
    lb.setAttribute('aria-hidden', 'true');
    const m = $('lbMedia');
    if (m) m.innerHTML = '';
  }

  function showLightbox(idx) {
    if (!state.lightbox.items.length) return;
    state.lightbox.idx = clamp(idx, 0, state.lightbox.items.length - 1);
    const it = state.lightbox.items[state.lightbox.idx];

    const mediaWrap = $('lbMedia');
    const cap = $('lbCaption');
    const tr = $('lbTranscript');
    if (!mediaWrap) return;

    mediaWrap.innerHTML = '';
    if (it.type === 'video') {
      const v = document.createElement('video');
      v.src = it.src;
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.addEventListener('error', () => {
        v.outerHTML = `<div style="padding:14px;font-weight:800;color:#7a2b2b">Video not found: ${escapeHtml(it.src)}</div>`;
      });
      mediaWrap.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = it.src;
      img.alt = it.caption || 'Media';
      img.addEventListener('error', () => {
        img.outerHTML = `<div style="padding:14px;font-weight:800;color:#7a2b2b">Image not found: ${escapeHtml(it.src)}</div>`;
      });
      mediaWrap.appendChild(img);
    }

    if (cap) cap.textContent = it.caption || '';
    if (tr) tr.textContent = it.transcript || '';
  }

  // --- Filters ---
  function initFilters() {
    const citySel = $('filter-city');
    const distSel = $('filter-district');
    const spotAlias = $('filter-spot'); // hidden alias
    const fromEl = $('filter-date-from');
    const toEl = $('filter-date-to');
    const searchEl = $('filter-search');

    const resetBtn = $('btn-reset');
    const exportBtn = $('btn-export');

    function syncSpotAlias() {
      if (spotAlias && distSel) spotAlias.value = distSel.value;
    }

    if (citySel) citySel.addEventListener('change', () => { state.drill.city = null; applyFilters(); });
    if (distSel) distSel.addEventListener('change', () => { syncSpotAlias(); applyFilters(); });
    if (fromEl) fromEl.addEventListener('change', applyFilters);
    if (toEl) toEl.addEventListener('change', applyFilters);
    if (searchEl) searchEl.addEventListener('input', debounce(applyFilters, 140));

    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (citySel) citySel.value = '__ALL__';
      if (distSel) distSel.value = '__ALL__';
      if (spotAlias) spotAlias.value = '__ALL__';
      if (fromEl) fromEl.value = '';
      if (toEl) toEl.value = '';
      if (searchEl) searchEl.value = '';
      state.drill.city = null;
      applyFilters();
    });

    if (exportBtn) exportBtn.addEventListener('click', exportCSV);

    // initial sync
    syncSpotAlias();
  }

  function populateSelect(el, options, selected) {
    if (!el) return;
    const opts = ['__ALL__', ...options];
    const label = (v) => (v === '__ALL__' ? 'All' : v);
    el.innerHTML = opts.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(label(v))}</option>`).join('');
    if (selected && opts.includes(selected)) el.value = selected;
    else el.value = '__ALL__';
  }

  function getFilter() {
    const city = $('filter-city')?.value || '__ALL__';
    const dist = $('filter-district')?.value || '__ALL__';
    const from = asDate($('filter-date-from')?.value);
    const to = asDate($('filter-date-to')?.value);
    const search = norm($('filter-search')?.value || '');
    return { city, dist, from, to, search };
  }

  function inRange(d, from, to) {
    if (!d) return true;
    const t = d.getTime();
    if (from && t < from.getTime()) return false;
    if (to) {
      // inclusive end-date
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (t > end.getTime()) return false;
    }
    return true;
  }

  function applyFilters() {
    const f = getFilter();

    // Spot list depends on City selection
    const allSpots = uniq(state.sessions
      .filter(r => f.city === '__ALL__' ? true : r.city === f.city)
      .map(r => r.spot));
    populateSelect($('filter-district'), allSpots, f.dist);

    // now get dist again (it might have been reset by populateSelect)
    const dist = $('filter-district')?.value || '__ALL__';

    const filtered = state.sessions.filter(r => {
      if (f.city !== '__ALL__' && r.city !== f.city) return false;
      if (dist !== '__ALL__' && r.spot !== dist) return false;
      if (!inRange(r.date, f.from, f.to)) return false;
      if (f.search && !(r.searchText || '').includes(f.search)) return false;
      return true;
    });

    state.filteredSessions = filtered;

    const sheetSet = new Set(filtered.map(r => r.sessionSheet).filter(Boolean));
    state.filteredFarmers = state.farmers.filter(fr => sheetSet.size ? sheetSet.has(fr.sessionSheet) : true);

    const sessionIdSet = new Set();
    for (const r of filtered) {
      if (Number.isFinite(r.sn)) sessionIdSet.add(r.sn);
      if (Number.isFinite(r.day)) sessionIdSet.add(r.day);
    }
    state.filteredMedia = state.mediaItems.filter(mi => sessionIdSet.size ? sessionIdSet.has(mi.sessionId) : true);

    renderAll();
  }

  // --- Loading ---
  async function loadWorkbook() {
    if (typeof XLSX === 'undefined') throw new Error('XLSX library not available (xlsx.full.min.js failed to load).');

    setText('status-xlsx', 'XLSX: loading…');
    const url = safeUrl(CFG.xlsx);

    let buf;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${CFG.xlsx}`);
      buf = await res.arrayBuffer();
    } catch (e) {
      setText('status-xlsx', 'XLSX: error');
      throw new Error(`Could not load ${CFG.xlsx}. Ensure it is in the same folder as index.html.`);
    }

    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    state.wb = wb;

    const sessions = extractSessionsFromSUM(wb);
    state.sessions = sessions;
    state.totals = calcTotals(sessions);

    const { farmers, coordsBySheet } = extractFarmersAndCoords(wb);
    state.farmers = farmers;

    // Backfill missing coordinates from session-sheet header areas (if present)
    let backfilled = 0;
    for (const s of state.sessions) {
      if ((!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) && s.sessionSheet && coordsBySheet && coordsBySheet.has(s.sessionSheet)) {
        const c = coordsBySheet.get(s.sessionSheet);
        if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
          s.lat = c.lat;
          s.lon = c.lon;
          backfilled++;
        }
      }
    }


    // campaign days
    const dmin = sessions.map(s => s.date).filter(Boolean).sort((a,b) => a - b)[0];
    const dmax = sessions.map(s => s.date).filter(Boolean).sort((a,b) => a - b).slice(-1)[0];
    if (dmin && dmax) setText('campaignDays', `${fmtDate(dmin)} → ${fmtDate(dmax)}`);
    else setText('campaignDays', '—');

    setText('status-xlsx', `XLSX: OK (${wb.SheetNames.length} sheets)`);
  }

  async function loadMedia() {
    setText('status-csv', 'media.json: loading…');

    let manifest;
    try {
      const res = await fetch(safeUrl(CFG.media), { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      manifest = await res.json();
    } catch (e) {
      setText('status-csv', 'media.json: missing');
      state.mediaItems = [];
      return;
    }

    state.mediaItems = expandMediaManifest(manifest);
    setText('status-csv', `media.json: OK (${state.mediaItems.length} items)`);
  }

  function expandMediaManifest(manifest) {
    // Legacy: flat array of items [{type,src,caption,sessionId,...}]
    if (Array.isArray(manifest)) {
      return manifest
        .map((it, idx) => normalizeMediaItem(it, idx))
        .filter(Boolean);
    }

    // Format A_compact (preferred)
    if (manifest && typeof manifest === 'object' && Array.isArray(manifest.sessions)) {
      const base = String(manifest.basePath || '').trim() || 'assets/gallery/';
      const def = manifest.defaults || {};
      const variants = Array.isArray(def.variants) ? def.variants : [];
      const mainV = def.mainVideoExt || 'mp4';
      const mainI = def.mainImageExt || 'jpg';
      const varVI = def.variantVideoExt || 'mp4';
      const varII = def.variantImageExt || 'jpg';

      const out = [];
      for (const s of manifest.sessions) {
        const sid = Number(s.id);
        if (!Number.isFinite(sid)) continue;
        const captionBase = s.caption || `Session ${sid}`;

        // Main video + main image (best-effort)
        out.push(normalizeMediaItem({
          type: 'video',
          src: `${base}${sid}.${mainV}`,
          caption: `${captionBase} — Main video`,
          sessionId: sid,
          role: 'main'
        }, out.length));

        out.push(normalizeMediaItem({
          type: 'image',
          src: `${base}${sid}.${mainI}`,
          caption: `${captionBase} — Main image`,
          sessionId: sid,
          role: 'main'
        }, out.length));

        // Variants (images + videos)
        for (const v of variants) {
          out.push(normalizeMediaItem({
            type: 'image',
            src: `${base}${sid}${v}.${varII}`,
            caption: `${captionBase} — Image ${String(v).toUpperCase()}`,
            sessionId: sid,
            role: 'variant',
            variant: v
          }, out.length));

          out.push(normalizeMediaItem({
            type: 'video',
            src: `${base}${sid}${v}.${varVI}`,
            caption: `${captionBase} — Video ${String(v).toUpperCase()}`,
            sessionId: sid,
            role: 'variant',
            variant: v
          }, out.length));
        }
      }
      return out.filter(Boolean);
    }

    // Unknown format
    return [];
  }

  function normalizeMediaItem(it, idx) {
    if (!it) return null;
    const type = (it.type === 'video' ? 'video' : 'image');
    const src = String(it.src || it.file || '').trim();
    if (!src) return null;
    const sessionId = Number(it.sessionId ?? it.sid ?? it.id);
    return {
      idx,
      type,
      src,
      caption: String(it.caption || it.title || ''),
      transcript: String(it.transcript || ''),
      sessionId: Number.isFinite(sessionId) ? sessionId : null,
      role: it.role || '',
      meta: it.meta || null,
    };
  }

  // --- Extractors (Workbook) ---
  function findSheetName(wb, target) {
    const t = norm(target);
    const exact = wb.SheetNames.find(n => norm(n) === t);
    if (exact) return exact;
    // fuzzy: startsWith/contains
    const cand = wb.SheetNames.find(n => norm(n).includes(t));
    return cand || null;
  }

  function extractSessionsFromSUM(wb) {
    const sumName = findSheetName(wb, 'sum') || wb.SheetNames[0];
    const ws = wb.Sheets[sumName];
    if (!ws) throw new Error('SUM sheet not found in workbook.');

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) throw new Error('Could not detect header row in SUM sheet.');

    const header = rows[headerIdx].map(h => norm(h));
    const col = buildColIndex(header);

    const idxSN = pickCol(col, ['sn', 'sno', 'sr', 'serial']);
    const idxCity = pickCol(col, ['city', 'district city']);
    const idxSpot = pickCol(col, ['spot', 'district', 'area', 'venue', 'location', 'village']);
    const idxDate = pickCol(col, ['date', 'session date', 'activation date']);
    const idxFarmers = pickCol(col, ['farmers', 'participants', 'attendance', 'turnout']);
    const idxAcres = pickCol(col, ['acres', 'acres approx', 'area acres', 'wheat acres', 'acre']);
    const idxDef = pickCol(col, ['definite', 'definite yes', 'yes', 'yes definite', 'ductrl plan yes']);
    const idxMay = pickCol(col, ['maybe', 'maybe plan', 'maybe yes']);
    const idxNo = pickCol(col, ['no', 'not', 'not use', 'no plan']);
    const idxAware = pickCol(col, ['awareness', 'awareness %', 'awareness percent']);
    const idxClarity = pickCol(col, ['clarity', 'clarity %', 'message clarity']);
    const idxDemo = pickCol(col, ['demo plot desire', 'demo plot', 'demo desire']);
    const idxDay = pickCol(col, ['day', 'day no', 'd']);
    const idxSess = pickCol(col, ['session', 'session no', 'session #', 's']);
    const idxLat = pickCol(col, ['lat', 'latitude']);
    const idxLon = pickCol(col, ['lon', 'long', 'longitude']);
    const idxReasonUse = pickCol(col, ['reason to use', 'reasons to use', 'use reasons', 'benefit', 'why use']);
    const idxReasonNo = pickCol(col, ['reason not', 'reasons not', 'not use reason', 'why not', 'objection']);

    const out = [];
    let emptyRun = 0;

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const isEmpty = row.every(c => String(c ?? '').trim() === '');
      if (isEmpty) {
        emptyRun++;
        if (emptyRun >= 6) break;
        continue;
      }
      emptyRun = 0;

      const sn = asNumber(row[idxSN]);
      const city = String(row[idxCity] ?? '').trim();
      const spot = String(row[idxSpot] ?? '').trim();
      const date = asDate(row[idxDate]);
      const farmers = asNumber(row[idxFarmers]);
      const acres = asNumber(row[idxAcres]);
      const def = asNumber(row[idxDef]);
      const may = asNumber(row[idxMay]);
      const no = asNumber(row[idxNo]);
      const awareness = asNumber(row[idxAware]);
      const clarity = asNumber(row[idxClarity]);
      const demo = asNumber(row[idxDemo]);
      const day = asNumber(row[idxDay]);
      const sessNo = asNumber(row[idxSess]);

      let lat = asNumber(row[idxLat]);
      let lon = asNumber(row[idxLon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const ll = tryParseLatLonFromRow(row);
        if (ll) { lat = ll[0]; lon = ll[1]; }
      }

      const sessionSheet = inferSessionSheet(wb, day, sessNo);

      const reasonsUse = String(row[idxReasonUse] ?? '').trim();
      const reasonsNo = String(row[idxReasonNo] ?? '').trim();

      const searchText = norm([
        sn, fmtDate(date), city, spot, reasonsUse, reasonsNo,
        row.join(' ')
      ].join(' '));

      out.push({
        sn: Number.isFinite(sn) ? sn : null,
        city: city || '—',
        spot: spot || '—',
        date,
        farmers: Number.isFinite(farmers) ? farmers : 0,
        acres: Number.isFinite(acres) ? acres : 0,
        def: Number.isFinite(def) ? def : 0,
        may: Number.isFinite(may) ? may : 0,
        no: Number.isFinite(no) ? no : 0,
        awareness: Number.isFinite(awareness) ? awareness : NaN,
        clarity: Number.isFinite(clarity) ? clarity : NaN,
        demo: Number.isFinite(demo) ? demo : NaN,
        day: Number.isFinite(day) ? day : null,
        sessNo: Number.isFinite(sessNo) ? sessNo : null,
        sessionSheet,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        reasonsUse,
        reasonsNo,
        searchText,
      });
    }

    // Populate filter selects now that sessions exist
    populateSelect($('filter-city'), uniq(out.map(r => r.city)), '__ALL__');
    populateSelect($('filter-district'), uniq(out.map(r => r.spot)), '__ALL__');

    return out;
  }

  function detectHeaderRow(rows) {
    const max = Math.min(rows.length, 60);
    for (let i = 0; i < max; i++) {
      const line = rows[i].map(c => norm(c)).join(' | ');
      if (line.includes('city') && (line.includes('date') || line.includes('session') || line.includes('farmers'))) return i;
      if (line.includes('farmer') && line.includes('mobile')) return i;
    }
    return 0; // fallback to first row
  }

  function buildColIndex(headerNorm) {
    const m = new Map();
    for (let i = 0; i < headerNorm.length; i++) {
      const h = headerNorm[i];
      if (!h) continue;
      if (!m.has(h)) m.set(h, i);
    }
    return m;
  }

  function pickCol(colMap, keys) {
    for (const k of keys) {
      const nk = norm(k);
      if (colMap.has(nk)) return colMap.get(nk);
    }
    // fuzzy match
    for (const k of keys) {
      const nk = norm(k);
      for (const [h, idx] of colMap.entries()) {
        if (h.includes(nk) || nk.includes(h)) return idx;
      }
    }
    return -1;
  }

  function tryParseLatLonFromRow(row) {
    const joined = row.map(c => String(c ?? '')).join(' ');
    // capture patterns like "24.8607, 67.0011" or "24.86 67.00"
    const m = joined.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lat, lon];
    return null;
  }

  function inferSessionSheet(wb, day, sessNo) {
    if (!Number.isFinite(day) || !Number.isFinite(sessNo)) return null;
    const target = `D${Math.round(day)}S${Math.round(sessNo)}`;
    const exact = wb.SheetNames.find(n => norm(n) === norm(target));
    if (exact) return exact;

    // fallback: any sheet that includes D{day} and S{sessNo}
    const cand = wb.SheetNames.find(n => {
      const nn = norm(n);
      return nn.includes(`d${Math.round(day)}`) && nn.includes(`s${Math.round(sessNo)}`);
    });
    return cand || null;
  }

  
  function extractFarmersAndCoords(wb) {
    const farmers = [];
    const coordsBySheet = new Map();

    const sheetNames = wb.SheetNames.filter(n => /^d\d+s\d+/i.test(String(n).trim()));
    for (const name of sheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // 1) Try to capture coordinates from the sheet “header” area (first ~40 rows)
      const coord = detectCoordsInSheet(rows);
      if (coord) coordsBySheet.set(name, coord);

      // 2) Farmer table
      const headerIdx = detectFarmerHeader(rows);
      if (headerIdx < 0) continue;

      const header = rows[headerIdx].map(h => norm(h));
      const col = buildColIndex(header);

      const idxName = pickCol(col, ['farmer name', 'name']);
      const idxPhone = pickCol(col, ['mobile', 'whatsapp', 'mobile whatsapp', 'phone']);
      const idxVillage = pickCol(col, ['village', 'area', 'spot']);
      const idxAcres = pickCol(col, ['wheat acres', 'acres', 'acres approx']);
      const idxPlan = pickCol(col, ['ductrl plan', 'plan', 'yesmaybe no']);
      const idxOther = pickCol(col, ['other brands', 'method', 'other brandsmethod']);
      const idxRemarks = pickCol(col, ['remarks', 'comment', 'notes']);

      let emptyRun = 0;
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const nameV = String(row[idxName] ?? '').trim();
        const phoneV = String(row[idxPhone] ?? '').trim();

        const isEmpty = !nameV && !phoneV && row.every(c => String(c ?? '').trim() === '');
        if (isEmpty) {
          emptyRun++;
          if (emptyRun >= 6) break;
          continue;
        }
        emptyRun = 0;

        if (!nameV && !phoneV) continue;

        farmers.push({
          sessionSheet: name,
          name: nameV,
          phone: phoneV,
          village: String(row[idxVillage] ?? '').trim(),
          acres: asNumber(row[idxAcres]),
          plan: String(row[idxPlan] ?? '').trim(),
          other: String(row[idxOther] ?? '').trim(),
          remarks: String(row[idxRemarks] ?? '').trim(),
        });
      }
    }

    return { farmers, coordsBySheet };
  }

  function detectCoordsInSheet(rows) {
    const maxR = Math.min(rows.length, 40);
    for (let r = 0; r < maxR; r++) {
      const row = rows[r] || [];
      const joined = row.map(c => String(c ?? '')).join(' ');
      // patterns: "Latitude: 31.1234 Longitude: 74.5678" or "31.1234, 74.5678"
      const m1 = joined.match(/lat(?:itude)?\s*[:=]?\s*(-?\d{1,2}\.\d{3,}).*?(lon(?:gitude)?|long)\s*[:=]?\s*(-?\d{1,3}\.\d{3,})/i);
      if (m1) {
        const lat = Number(m1[1]);
        const lon = Number(m1[3]);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
      }

      const m2 = joined.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);
      if (m2) {
        const lat = Number(m2[1]);
        const lon = Number(m2[2]);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
      }
    }
    return null;
  }


  function detectFarmerHeader(rows) {
    const max = Math.min(rows.length, 80);
    for (let i = 0; i < max; i++) {
      const line = rows[i].map(c => norm(c)).join(' | ');
      if (line.includes('farmer') && (line.includes('mobile') || line.includes('whatsapp'))) return i;
      if (line.includes('mobile') && line.includes('village')) return i;
    }
    return -1;
  }

  // --- Metrics + Render ---
  function calcTotals(rows) {
    const sessions = rows.length;
    const farmers = rows.reduce((a, r) => a + (Number.isFinite(r.farmers) ? r.farmers : 0), 0);
    const acres = rows.reduce((a, r) => a + (Number.isFinite(r.acres) ? r.acres : 0), 0);

    // Demo desire: prefer percentage average if provided; fallback: NaN
    const demoVals = rows.map(r => r.demo).filter(Number.isFinite);
    const demo = demoVals.length ? (demoVals.reduce((a, x) => a + x, 0) / demoVals.length) : NaN;

    return { sessions, farmers, acres, demo };
  }

  function renderAll() {
    renderKPIs();
    renderDonutsAndTrends();
    renderPerfAndFarmerIntent();
    renderReasons();
    renderMap();
    renderSessionsTable();
    renderMedia();
    renderShowcases();
    renderActionList();
  }

  function renderKPIs() {
    const t = state.totals;
    const f = calcTotals(state.filteredSessions);

    setText('kpi-sessions', fmtInt(f.sessions));
    setText('kpi-farmers', fmtInt(f.farmers));
    setText('kpi-acres', fmtInt(f.acres));
    setText('kpi-demo', Number.isFinite(f.demo) ? `${Math.round(f.demo)}%` : '—');

    setBar('bar-sessions', t.sessions ? (f.sessions / t.sessions) * 100 : 0);
    setBar('bar-farmers', t.farmers ? (f.farmers / t.farmers) * 100 : 0);
    setBar('bar-acres', t.acres ? (f.acres / t.acres) * 100 : 0);
    setBar('bar-demo', Number.isFinite(f.demo) ? clamp(f.demo, 0, 100) : 0);
  }

  function setBar(id, pct) {
    const el = $(id);
    if (!el) return;
    el.style.width = `${clamp(pct, 0, 100).toFixed(1)}%`;
  }

  function renderDonutsAndTrends() {
    if (typeof Chart === 'undefined') {
      setNotice('Chart.js failed to load. Charts are disabled.', true);
      return;
    }

    // --- Cities -> Spots drill donut ---
    const rows = state.filteredSessions;

    let labels = [];
    let values = [];
    let title = '';

    if (state.drill.city && rows.some(r => r.city === state.drill.city)) {
      const city = state.drill.city;
      const bySpot = groupCount(rows.filter(r => r.city === city), r => r.spot);
      labels = Object.keys(bySpot);
      values = Object.values(bySpot);
      title = `Spots within ${city} (click slice to go back)`;
    } else {
      const byCity = groupCount(rows, r => r.city);
      labels = Object.keys(byCity);
      values = Object.values(byCity);
      title = 'Cities (click slice to drill into spots)';
    }

    const citiesCanvas = $('chartCities');
    if (citiesCanvas) {
      const chart = ensureChart('chartCities', citiesCanvas, 'doughnut', {
        labels,
        datasets: [{ data: values }]
      }, {
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: title }
        },
        onClick: (evt, elements) => {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          const clicked = labels[idx];
          if (!clicked) return;
          if (state.drill.city) {
            state.drill.city = null;
          } else {
            state.drill.city = clicked;
          }
          renderDonutsAndTrends();
        }
      });
      state.charts.chartCities = chart;
    }

    // --- Intent donut ---
    const def = rows.reduce((a, r) => a + (Number.isFinite(r.def) ? r.def : 0), 0);
    const may = rows.reduce((a, r) => a + (Number.isFinite(r.may) ? r.may : 0), 0);
    const no = rows.reduce((a, r) => a + (Number.isFinite(r.no) ? r.no : 0), 0);
    const intentLabels = ['Definite', 'Maybe', 'Not'];
    const intentValues = [def, may, no];

    const intentCanvas = $('chartIntent');
    if (intentCanvas) {
      const chart = ensureChart('chartIntent', intentCanvas, 'doughnut', {
        labels: intentLabels,
        datasets: [{ data: intentValues }]
      }, {
        plugins: { legend: { position: 'bottom' } }
      });
      state.charts.chartIntent = chart;
    }

    // --- Trend chart (farmers + acres by date) ---
    const trendCanvas = $('chartTrend');
    if (trendCanvas) {
      const byDate = groupSumByDate(rows);
      const tLabels = byDate.map(x => x.dateLabel);
      const seriesFarmers = byDate.map(x => x.farmers);
      const seriesAcres = byDate.map(x => x.acres);

      const chart = ensureChart('chartTrend', trendCanvas, 'line', {
        labels: tLabels,
        datasets: [
          { label: 'Farmers', data: seriesFarmers, tension: 0.25 },
          { label: 'Acres', data: seriesAcres, tension: 0.25 },
        ]
      }, {
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true }
        }
      });
      state.charts.chartTrend = chart;
    }
  }

  function renderPerfAndFarmerIntent() {
    if (typeof Chart === 'undefined') return;

    const rows = state.filteredSessions;
    const perfCanvas = $('chartPerf');
    if (perfCanvas) {
      // compute averages
      const aware = avg(rows.map(r => r.awareness));
      const clar = avg(rows.map(r => r.clarity));
      const defPct = pct(rows.reduce((a, r) => a + r.def, 0), rows.reduce((a, r) => a + r.def + r.may + r.no, 0));
      const chart = ensureChart('chartPerf', perfCanvas, 'radar', {
        labels: ['Awareness', 'Clarity', 'Definite intent'],
        datasets: [{
          label: 'Average %',
          data: [
            Number.isFinite(aware) ? clamp(aware, 0, 100) : 0,
            Number.isFinite(clar) ? clamp(clar, 0, 100) : 0,
            Number.isFinite(defPct) ? clamp(defPct, 0, 100) : 0,
          ]
        }]
      }, {
        plugins: { legend: { position: 'bottom' } },
        scales: { r: { beginAtZero: true, max: 100 } }
      });
      state.charts.chartPerf = chart;
    }

    const fiCanvas = $('chartBackchecker');
    if (fiCanvas) {
      const farmers = state.filteredFarmers;
      const planCounts = groupCount(farmers, fr => normalizePlan(fr.plan));
      const labels = Object.keys(planCounts);
      const data = Object.values(planCounts);
      const chart = ensureChart('chartBackchecker', fiCanvas, 'bar', {
        labels,
        datasets: [{ label: 'Farmers', data }]
      }, {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      });
      state.charts.chartBackchecker = chart;
    }
  }

  function normalizePlan(p) {
    const s = norm(p);
    if (!s) return 'Unknown';
    if (s.includes('yes') || s.includes('definite')) return 'Yes';
    if (s.includes('maybe')) return 'Maybe';
    if (s === 'no' || s.includes('not')) return 'No';
    return 'Other';
  }

  function renderReasons() {
    const rows = state.filteredSessions;

    const useMap = new Map();
    const noMap = new Map();

    for (const r of rows) {
      for (const item of splitReasons(r.reasonsUse)) useMap.set(item, (useMap.get(item) || 0) + 1);
      for (const item of splitReasons(r.reasonsNo)) noMap.set(item, (noMap.get(item) || 0) + 1);
    }

    fillReasonTable('reasonsUse', useMap);
    fillReasonTable('reasonsNoUse', noMap);
  }

  function splitReasons(s) {
    const t = String(s || '').trim();
    if (!t) return [];
    return t
      .split(/[,;|•\n]+/g)
      .map(x => norm(x))
      .map(x => x.replace(/^\d+\s*/,'').trim())
      .filter(x => x.length >= 3)
      .map(x => x.replace(/\b(benefit|reason|because)\b/g,'').trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  function fillReasonTable(tbodyId, m) {
    const tb = $(tbodyId);
    if (!tb) return;

    const entries = Array.from(m.entries()).sort((a,b) => b[1] - a[1]).slice(0, CFG.maxReasons);
    if (!entries.length) {
      tb.innerHTML = `<tr><td colspan="2" style="color:#4C5B4C;font-weight:800">No “reason” columns found (or empty) in current filtered rows.</td></tr>`;
      return;
    }
    tb.innerHTML = entries.map(([k,v]) => `<tr><td>${escapeHtml(titleCase(k))}</td><td style="font-weight:900">${fmtInt(v)}</td></tr>`).join('');
  }

  function titleCase(s) {
    return String(s).split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
  }

  function renderMap() {
    // Leaflet may be blocked; handle gracefully.
    if (typeof L === 'undefined') {
      setNotice('Leaflet failed to load. Map is disabled.', true);
      return;
    }

    const rows = state.filteredSessions.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    const mapEl = $('map');
    if (!mapEl) return;

    if (!state.map.map) {
      const map = L.map(mapEl, { zoomControl: true });
      state.map.map = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      state.map.markers = L.layerGroup().addTo(map);
      state.map.route = L.polyline([], { weight: 3 }).addTo(map);

      map.setView(CFG.defaultMapCenter, CFG.defaultMapZoom);
    }

    const map = state.map.map;
    state.map.markers.clearLayers();
    state.map.route.setLatLngs([]);

    if (!rows.length) {
      map.setView(CFG.defaultMapCenter, CFG.defaultMapZoom);
      return;
    }

    const pts = [];
    const sorted = rows.slice().sort((a,b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

    for (const r of sorted) {
      const pt = [r.lat, r.lon];
      pts.push(pt);
      const popup = `
        <div style="font-weight:900">${escapeHtml(r.city)} — ${escapeHtml(r.spot)}</div>
        <div style="margin-top:4px;font-weight:700;color:#4C5B4C">
          Date: ${escapeHtml(fmtDate(r.date))}<br/>
          Farmers: ${fmtInt(r.farmers)}<br/>
          Acres: ${fmtInt(r.acres)}
        </div>
      `;
      L.marker(pt).bindPopup(popup).addTo(state.map.markers);
    }

    if (pts.length >= 2) state.map.route.setLatLngs(pts);

    const bounds = L.latLngBounds(pts.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds.pad(0.18));
  }

  function renderSessionsTable() {
    const tb = $('tblSessions');
    if (!tb) return;

    const rows = state.filteredSessions.slice()
      .sort((a,b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="11" style="color:#4C5B4C;font-weight:800">No sessions match current filters.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.slice(0, 220).map(r => {
      const aware = Number.isFinite(r.awareness) ? `${Math.round(r.awareness)}%` : '—';
      const clar = Number.isFinite(r.clarity) ? `${Math.round(r.clarity)}%` : '—';
      const sn = Number.isFinite(r.sn) ? Math.round(r.sn) : '—';
      return `
        <tr data-sn="${escapeHtml(String(sn))}" style="cursor:pointer">
          <td style="font-weight:900">${escapeHtml(String(sn))}</td>
          <td>${escapeHtml(fmtDate(r.date))}</td>
          <td>${escapeHtml(r.city)}</td>
          <td>${escapeHtml(r.spot)}</td>
          <td style="font-weight:900">${fmtInt(r.farmers)}</td>
          <td style="font-weight:900">${fmtInt(r.acres)}</td>
          <td>${fmtInt(r.def)}</td>
          <td>${fmtInt(r.may)}</td>
          <td>${fmtInt(r.no)}</td>
          <td>${escapeHtml(aware)}</td>
          <td>${escapeHtml(clar)}</td>
        </tr>
      `;
    }).join('');

    // Row click opens nearest media item (best-effort by sessionId)
    Array.from(tb.querySelectorAll('tr[data-sn]')).forEach(tr => {
      tr.addEventListener('click', () => {
        const sn = Number(tr.getAttribute('data-sn'));
        if (!Number.isFinite(sn)) return;
        const items = state.filteredMedia.length ? state.filteredMedia : state.mediaItems;
        const idx = items.findIndex(it => it.sessionId === sn);
        if (idx >= 0) openLightbox(items, idx);
      });
    });
  }

  function renderMedia() {
    const grid = $('galleryGrid');
    if (!grid) return;

    const items = (state.filteredMedia.length ? state.filteredMedia : state.mediaItems).slice(0, CFG.maxGalleryItems);

    if (!items.length) {
      grid.innerHTML = `
        <div class="notice" style="grid-column:1/-1">
          <strong>No media items were loaded.</strong><br/>
          Ensure <code>media.json</code> exists in the same folder, and media files exist under <code>assets/gallery/</code>.
        </div>
      `;
      return;
    }

    grid.innerHTML = items.map((it, idx) => renderTile(it, idx)).join('');

    Array.from(grid.querySelectorAll('[data-mi]')).forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-mi'));
        if (!Number.isFinite(idx)) return;
        openLightbox(items, idx);
      });
    });
  }

  function renderTile(it, idx) {
    const cap = it.caption || `Session ${it.sessionId ?? '—'}`;
    const sub = it.type === 'video' ? 'Video' : 'Image';
    const media = it.type === 'video'
      ? `<video src="${escapeHtml(it.src)}" muted playsinline preload="metadata"></video>`
      : `<img src="${escapeHtml(it.src)}" alt="${escapeHtml(cap)}" loading="lazy" />`;

    return `
      <div class="tile" data-mi="${idx}">
        <div class="m">${media}</div>
        <div class="c">
          <div class="t">${escapeHtml(cap)}</div>
          <div class="s">${escapeHtml(sub)} • Session ${escapeHtml(String(it.sessionId ?? '—'))}</div>
        </div>
      </div>
    `;
  }

  function renderShowcases() {
    // Snapshot showcase: media items first
    fillShowcase('snapshotShowcase', state.filteredMedia.length ? state.filteredMedia : state.mediaItems);

    // Charts showcase: same items, but fewer
    fillShowcase('chartsShowcase', state.filteredMedia.length ? state.filteredMedia : state.mediaItems);

    // Map showcase: focus on sessions with coords (if any) -> show callout cards
    fillMapShowcase();

    // Highlights track: callouts (not media)
    fillHighlights();
  }

  function fillShowcase(id, items) {
    const el = $(id);
    if (!el) return;

    const list = (items || []).slice(0, CFG.maxShowcaseItems);
    if (!list.length) {
      el.innerHTML = `<div class="notice" style="min-width:280px"><strong>No showcase media</strong><br/>Add assets/gallery items + media.json.</div>`;
      return;
    }

    el.innerHTML = list.map((it, idx) => {
      const cap = it.caption || `Session ${it.sessionId ?? '—'}`;
      const sub = it.type === 'video' ? 'Video' : 'Image';
      const media = it.type === 'video'
        ? `<video src="${escapeHtml(it.src)}" muted playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(it.src)}" alt="${escapeHtml(cap)}" loading="lazy" />`;

      return `
        <div class="showItem" data-mi="${idx}">
          <div class="media">${media}</div>
          <div class="cap">
            <div class="t">${escapeHtml(cap)}</div>
            <div class="s">${escapeHtml(sub)} • click to open</div>
          </div>
        </div>
      `;
    }).join('');

    Array.from(el.querySelectorAll('[data-mi]')).forEach(node => {
      node.addEventListener('click', () => {
        const idx = Number(node.getAttribute('data-mi'));
        if (!Number.isFinite(idx)) return;
        openLightbox(list, idx);
      });
    });
  }

  function fillMapShowcase() {
    const el = $('mapShowcase');
    if (!el) return;

    const rows = state.filteredSessions
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))
      .slice()
      .sort((a,b) => (b.farmers || 0) - (a.farmers || 0))
      .slice(0, 8);

    if (!rows.length) {
      el.innerHTML = `<div class="notice" style="min-width:280px"><strong>No coordinate rows</strong><br/>Add Latitude/Longitude columns in SUM (or put “lat, lon” in a notes cell).</div>`;
      return;
    }

    el.innerHTML = rows.map(r => {
      const title = `${r.city} — ${r.spot}`;
      const sub = `${fmtDate(r.date)} • Farmers ${fmtInt(r.farmers)} • Acres ${fmtInt(r.acres)}`;
      return `
        <div class="showItem">
          <div class="media" style="height:120px;display:flex;align-items:center;justify-content:center">
            <div style="font-weight:900;color:#163018;text-align:center;padding:12px">
              ${escapeHtml(title)}<br/>
              <span style="color:#4C5B4C;font-weight:800;font-size:12px">${escapeHtml(sub)}</span>
            </div>
          </div>
          <div class="cap">
            <div class="t">Map-highlight</div>
            <div class="s">Lat ${escapeHtml(String(r.lat))}, Lon ${escapeHtml(String(r.lon))}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function fillHighlights() {
    const el = $('highlightsTrack');
    if (!el) return;

    const rows = state.filteredSessions.slice()
      .sort((a,b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      .slice(0, 8);

    if (!rows.length) {
      el.innerHTML = `<div class="notice" style="min-width:280px"><strong>No highlights</strong><br/>Adjust filters or verify SUM sheet has rows.</div>`;
      return;
    }

    el.innerHTML = rows.map(r => {
      const aware = Number.isFinite(r.awareness) ? `${Math.round(r.awareness)}%` : '—';
      const clar = Number.isFinite(r.clarity) ? `${Math.round(r.clarity)}%` : '—';
      const defPct = pct(r.def, r.def + r.may + r.no);
      const defStr = Number.isFinite(defPct) ? `${Math.round(defPct)}%` : '—';

      return `
        <div class="showItem">
          <div class="media" style="height:120px;display:flex;align-items:center;justify-content:center">
            <div style="text-align:center;padding:12px">
              <div style="font-weight:900">${escapeHtml(r.city)}</div>
              <div style="font-weight:800;color:#4C5B4C;font-size:12px;margin-top:4px">${escapeHtml(r.spot)} • ${escapeHtml(fmtDate(r.date))}</div>
            </div>
          </div>
          <div class="cap">
            <div class="t">Farmers ${fmtInt(r.farmers)} • Acres ${fmtInt(r.acres)}</div>
            <div class="s">Awareness ${escapeHtml(aware)} • Clarity ${escapeHtml(clar)} • Definite ${escapeHtml(defStr)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderActionList() {
    const tb = $('actionList');
    if (!tb) return;

    const rows = state.filteredSessions;
    const actions = [];

    // Thresholds (tuned to user's earlier rules)
    const lowAwareness = rows.filter(r => Number.isFinite(r.awareness) && r.awareness < 60);
    const lowClarity = rows.filter(r => Number.isFinite(r.clarity) && r.clarity < 75);
    const lowDefinite = rows.filter(r => {
      const dp = pct(r.def, r.def + r.may + r.no);
      return Number.isFinite(dp) && dp < 70;
    });
    const lowTurnout = rows.filter(r => Number.isFinite(r.farmers) && r.farmers > 0 && r.farmers < 20);

    if (lowAwareness.length) actions.push({
      pr: 'High',
      finding: `Awareness below 60% in ${lowAwareness.length} session(s)`,
      action: 'Strengthen pre-activation dealer touchpoints; include “prior event” checks at the start of sessions.'
    });
    if (lowDefinite.length) actions.push({
      pr: 'High',
      finding: `Definite intent below 70% in ${lowDefinite.length} session(s)`,
      action: 'Improve objection handling and value narrative; add a tighter talk-track on ROI and outcomes.'
    });
    if (lowClarity.length) actions.push({
      pr: 'Medium',
      finding: `Clarity below 75% in ${lowClarity.length} session(s)`,
      action: 'Retrain field team on the 4 key messages; add a “repeat-back” question after each message.'
    });
    if (lowTurnout.length) actions.push({
      pr: 'Medium',
      finding: `Low turnout (<20 farmers) in ${lowTurnout.length} session(s)`,
      action: 'Review venue selection and mobilization; validate dealer invites and morning timing.'
    });

    if (!actions.length) {
      tb.innerHTML = `<tr><td colspan="3" style="color:#4C5B4C;font-weight:800">No action triggers under current filters.</td></tr>`;
      return;
    }

    tb.innerHTML = actions.map(a => `
      <tr>
        <td style="font-weight:900">${escapeHtml(a.pr)}</td>
        <td>${escapeHtml(a.finding)}</td>
        <td>${escapeHtml(a.action)}</td>
      </tr>
    `).join('');
  }

  // --- Export ---
  function exportCSV() {
    const rows = state.filteredSessions;
    if (!rows.length) {
      setNotice('Nothing to export (no sessions match current filters).', true);
      return;
    }
    const header = [
      'SN','Date','City','Spot','Farmers','Acres','Definite','Maybe','Not','Awareness','Clarity','Day','Session','Sheet','Lat','Lon','ReasonsUse','ReasonsNo'
    ];
    const lines = [header.join(',')];

    for (const r of rows) {
      const line = [
        val(r.sn),
        val(fmtDate(r.date)),
        val(r.city),
        val(r.spot),
        val(r.farmers),
        val(r.acres),
        val(r.def),
        val(r.may),
        val(r.no),
        val(Number.isFinite(r.awareness) ? r.awareness : ''),
        val(Number.isFinite(r.clarity) ? r.clarity : ''),
        val(r.day),
        val(r.sessNo),
        val(r.sessionSheet),
        val(r.lat),
        val(r.lon),
        val(r.reasonsUse),
        val(r.reasonsNo),
      ].join(',');
      lines.push(line);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `buctril_sessions_${fmtDate(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setNotice(`Exported ${rows.length} rows.`);
  }

  function val(x) {
    const s = String(x ?? '').replaceAll('"', '""');
    return `"${s}"`;
  }

  // --- Helpers for charts ---
  function ensureChart(key, canvas, type, data, options) {
    if (state.charts[key]) {
      state.charts[key].data = data;
      state.charts[key].options = options || {};
      state.charts[key].update();
      return state.charts[key];
    }
    return new Chart(canvas, { type, data, options: options || {} });
  }

  function groupCount(rows, keyFn) {
    const m = {};
    for (const r of rows) {
      const k = (keyFn(r) ?? '—');
      const kk = String(k);
      m[kk] = (m[kk] || 0) + 1;
    }
    return m;
  }

  function groupSumByDate(rows) {
    // group per YYYY-MM-DD
    const m = new Map();
    for (const r of rows) {
      const d = r.date ? fmtDate(r.date) : '—';
      if (!m.has(d)) m.set(d, { dateLabel: d, farmers: 0, acres: 0, t: r.date ? r.date.getTime() : 0 });
      const rec = m.get(d);
      rec.farmers += Number.isFinite(r.farmers) ? r.farmers : 0;
      rec.acres += Number.isFinite(r.acres) ? r.acres : 0;
      rec.t = r.date ? r.date.getTime() : rec.t;
    }
    return Array.from(m.values()).sort((a,b) => a.t - b.t);
  }

  function avg(arr) {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((a,x) => a + x, 0) / xs.length;
  }

  function pct(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return NaN;
    return (a / b) * 100;
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // --- Init ---
  async function init() {
    initTabs();
    initLightbox();
    initFilters();

    // Background video (optional)
    const bg = $('bgVideo');
    if (bg) {
      bg.src = 'assets/bg.mp4';
      bg.addEventListener('error', () => { bg.style.display = 'none'; });
    }

    setNotice('Loading workbook + media…');

    const diag = [];
    try {
      await loadWorkbook();
      diag.push(`Workbook: ${CFG.xlsx}`);
      diag.push(`Sessions: ${state.sessions.length}`);
      diag.push(`Farmer rows (session sheets): ${state.farmers.length}`);
      const coordCount = state.sessions.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)).length;
      diag.push(`Sessions with coordinates: ${coordCount}`);
    } catch (e) {
      setNotice(e.message || String(e), true);
      setDiag(`Load failed.\n\nCommon fixes:\n- Put ${CFG.xlsx} in the SAME folder as index.html\n- Ensure GitHub Pages is serving the folder (Settings → Pages)\n- Keep file name EXACT: ${CFG.xlsx}\n\nDetails:\n${String(e.stack || e)}`);
      return;
    }

    await loadMedia();
    diag.push(`Media items: ${state.mediaItems.length}`);
    diag.push(`Leaflet: ${typeof L === 'undefined' ? 'missing' : 'OK'}`);
    diag.push(`Chart.js: ${typeof Chart === 'undefined' ? 'missing' : 'OK'}`);
    diag.push(`XLSX: ${typeof XLSX === 'undefined' ? 'missing' : 'OK'}`);
    setDiag(diag.join('\n'));

    // initial filter apply
    applyFilters();

    setNotice('Ready. Use filters or click chart slices to drill down.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
