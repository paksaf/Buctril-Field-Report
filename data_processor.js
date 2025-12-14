/* AgriVista dashboard logic (Leaflet + Chart.js + XLSX)
   - Reads: Buctril_Super_Activations.xlsx (sheet: SUM; session sheets: D#S#)
   - Reads: media.json (A_compact or flat array)
   - Updates: KPIs, charts, map (acre bubbles), sessions table, gallery, showcases
   - Best-match parsing enabled for inconsistent header names.
*/
(() => {
  'use strict';

  const CFG = Object.freeze({
    xlsx: 'Buctril_Super_Activations.xlsx',
    media: 'media.json',
    heroVideo: 'assets/bg.mp4',           // optional; if missing it will be hidden automatically
    mapCenter: [30.3753, 69.3451],        // Pakistan
    mapZoom: 5,
    maxGallery: 72,
    maxShowcase: 10,
    maxReasons: 10,
    routeLine: true,
    // Bubble sizing:
    // Use true-area circles (meters). 1 acre = 4046.86 m^2.
    // Optional clamp (meters) to keep visuals sane if acres are very large.
    bubbleClampMeters: 5000,
  });

  // --- DOM helpers (IDs preserved from index.html) ---
  const $ = (id) => document.getElementById(id);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = val;
  }

  function setNotice(msg, isErr = false) {
    const nb = $('noticeBox');
    if (!nb) return;
    nb.innerHTML = `<strong>${isErr ? 'Error' : 'Status'}:</strong> ${escapeHtml(String(msg))}`;
    nb.style.borderColor = isErr ? 'rgba(251,113,133,.55)' : 'rgba(255,255,255,.14)';
  }

  function logDiag(line) {
    const el = $('diagBox');
    if (!el) return;
    const ts = new Date().toISOString().split('T')[1].replace('Z', '');
    el.textContent = `[${ts}] ${line}\n` + el.textContent;
  }

  // --- Formatting ---
  const fmtInt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';
  const fmt1 = (n) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString() : '—';
  const fmtPct = (p) => Number.isFinite(p) ? `${Math.round(p)}%` : '—';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  // --- Normalization / parsing ---
  function norm(s) {
    return String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w% ]/g, '');
  }

  function asNum(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).replace(/[,]/g, '').trim();
    if (!s) return NaN;
    const n = Number(s.replace(/[ %]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function asDate(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;

    // Excel serial date (best effort)
    if (typeof v === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const dc = XLSX.SSF.parse_date_code(v);
      if (dc && dc.y && dc.m && dc.d) return new Date(dc.y, dc.m - 1, dc.d);
    }

    const dt = new Date(String(v));
    return isNaN(dt.getTime()) ? null : dt;
  }

  function fmtDate(d) {
    if (!d) return '—';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function pct(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return NaN;
    return (a / b) * 100;
  }

  function avg(nums) {
    const xs = nums.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((s, n) => s + n, 0) / xs.length;
  }

  function uniq(arr) {
    return Array.from(new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim() !== '')));
  }

  // --- Coordinate parsing: supports "lat,lon" or DMS with N/E/S/W ---
  function dmsToDd(deg, min, sec, dir) {
    let dd = Math.abs(deg) + (min || 0) / 60 + (sec || 0) / 3600;
    if (dir === 'S' || dir === 'W') dd = -dd;
    return dd;
  }

  function parseOneCoord(part) {
    // decimal degrees
    const dec = part.match(/-?\d+(?:\.\d+)?/);
    if (dec && !/[NSEW]/i.test(part)) return Number(dec[0]);

    // DMS like 31°23'28.5"N or 31 23 28.5 N
    const m = part.match(/(-?\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)?\D*(\d+(?:\.\d+)?)?\D*([NSEW])/i);
    if (!m) return NaN;
    const deg = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    const se = m[3] ? Number(m[3]) : 0;
    const dir = (m[4] || '').toUpperCase();
    return dmsToDd(deg, mi, se, dir);
  }

  function parseCoord(s) {
    if (!s) return {lat: NaN, lon: NaN};
    const raw = String(s).trim();
    if (!raw) return {lat: NaN, lon: NaN};

    // "lat, lon"
    if (raw.includes(',')) {
      const [a, b] = raw.split(',').map(t => t.trim());
      const lat = Number(a);
      const lon = Number(b);
      return {lat: Number.isFinite(lat) ? lat : NaN, lon: Number.isFinite(lon) ? lon : NaN};
    }

    // Try to find two coordinates with N/S and E/W
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) {
      // Heuristic: join into two halves if needed
      const join = (arr) => arr.join(' ');
      // If it already looks like "31°..N 73°..E"
      const latPart = join(parts.slice(0, Math.ceil(parts.length / 2)));
      const lonPart = join(parts.slice(Math.ceil(parts.length / 2)));
      let lat = parseOneCoord(latPart);
      let lon = parseOneCoord(lonPart);

      // If failed, try the first token as lat and second as lon
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        lat = parseOneCoord(parts[0]);
        lon = parseOneCoord(parts[1]);
      }

      return {lat, lon};
    }

    return {lat: NaN, lon: NaN};
  }

  // --- Best-match header lookup ---
  function findHeaderRow(mat, mustHaveAny) {
    const must = mustHaveAny.map(norm);
    for (let r = 0; r < mat.length; r++) {
      const row = (mat[r] || []).map(norm);
      const hits = must.filter(k => row.includes(k));
      if (hits.length >= Math.min(3, must.length)) return r; // usually City/Date/Spot/Farmers
    }
    return -1;
  }

  function findCol(headersNorm, candidates) {
    const cands = candidates.map(norm);

    // 1) exact match
    for (const c of cands) {
      const i = headersNorm.indexOf(c);
      if (i >= 0) return i;
    }

    // 2) substring match (header contains candidate)
    for (let i = 0; i < headersNorm.length; i++) {
      const h = headersNorm[i];
      for (const c of cands) {
        if (h && c && h.includes(c)) return i;
      }
    }

    return -1;
  }

  function sheetToMatrix(ws) {
    return XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, blankrows: false});
  }

  // --- State ---
  const state = {
    wb: null,
    sessions: [],
    farmers: [],
    media: [],
    filtered: [],
    filter: { city: '', spot: '', q: '', from: null, to: null },
    charts: { city: null, intent: null, trend: null },
    map: { obj: null, base: null, layer: null, route: null, selectedKey: '' },
  };

  // --- Tabs ---
  function initTabs() {
    const btns = qa('.tabBtn');
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(bb => bb.classList.toggle('active', bb === b));
      qa('.tabPanel').forEach(p => p.classList.toggle('active', p.id === b.dataset.tab));
      if (b.dataset.tab === 'tab-map' && state.map.obj) state.map.obj.invalidateSize();
    }));
  }

  // --- Lightbox ---
  function initLightbox() {
    const lb = $('lightbox');
    const close = () => { lb.style.display = 'none'; };
    const nav = (delta) => {
      if (!state._lb || !state._lb.items.length) return;
      state._lb.idx = (state._lb.idx + delta + state._lb.items.length) % state._lb.items.length;
      renderLightbox();
    };

    $('lbClose')?.addEventListener('click', close);
    $('lbPrev')?.addEventListener('click', () => nav(-1));
    $('lbNext')?.addEventListener('click', () => nav(1));
    lb?.addEventListener('click', e => { if (e.target === lb) close(); });

    document.addEventListener('keydown', e => {
      if (!lb || lb.style.display !== 'flex') return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') nav(-1);
      if (e.key === 'ArrowRight') nav(1);
    });
  }

  function openLightbox(items, startIdx = 0) {
    state._lb = { items, idx: startIdx };
    renderLightbox();
    $('lightbox').style.display = 'flex';
  }

  function renderLightbox() {
    const item = state._lb.items[state._lb.idx];
    const box = $('lbMedia');
    if (!item || !box) return;

    box.innerHTML = '';
    if (item.type === 'video') {
      const v = document.createElement('video');
      v.src = item.src;
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'metadata';
      box.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.alt || item.caption || 'image';
      box.appendChild(img);
    }

    setText('lbCaption', item.caption || '—');
    setText('lbTranscript', item.transcript || '—');
  }

  // --- Filters ---
  function initFilters() {
    const citySel = $('filter-city');
    const spotSel = $('filter-district'); // visible spot selector
    const spotCompat = $('filter-spot');  // hidden compat selector
    const q = $('filter-search');
    const from = $('filter-date-from');
    const to = $('filter-date-to');
    const reset = $('btn-reset');
    const exportBtn = $('btn-export');

    const apply = () => {
      state.filter.city = citySel.value || '';
      state.filter.spot = spotSel.value || '';
      state.filter.q = (q.value || '').trim();
      state.filter.from = from.value ? new Date(from.value + 'T00:00:00') : null;
      state.filter.to = to.value ? new Date(to.value + 'T23:59:59') : null;

      // keep compat spot in sync
      if (spotCompat) spotCompat.value = spotSel.value;

      updateSpotOptions();
      applyFilters();
    };

    citySel.addEventListener('change', apply);
    spotSel.addEventListener('change', apply);
    q.addEventListener('input', debounce(apply, 120));
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);

    reset.addEventListener('click', () => {
      citySel.value = '';
      spotSel.value = '';
      if (spotCompat) spotCompat.value = '';
      q.value = '';
      from.value = '';
      to.value = '';
      state.filter = { city: '', spot: '', q: '', from: null, to: null };
      updateSpotOptions(true);
      applyFilters();
    });

    exportBtn.addEventListener('click', exportFilteredCsv);
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function buildFilterOptions() {
    const citySel = $('filter-city');
    // reset (keep "All")
    citySel.innerHTML = '<option value="">All</option>';
    const cities = uniq(state.sessions.map(s => s.city)).sort((a,b) => a.localeCompare(b));
    for (const c of cities) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      citySel.appendChild(opt);
    }
    updateSpotOptions(true);
  }

  function updateSpotOptions(forceReset = false) {
    const spotSel = $('filter-district');
    if (!spotSel) return;
    const cur = forceReset ? '' : (spotSel.value || '');
    spotSel.innerHTML = '<option value="">All</option>';

    const spots = uniq(
      state.sessions
        .filter(s => !state.filter.city || s.city === state.filter.city)
        .map(s => s.spot)
    ).sort((a,b) => a.localeCompare(b));

    for (const sp of spots) {
      const opt = document.createElement('option');
      opt.value = sp;
      opt.textContent = sp;
      spotSel.appendChild(opt);
    }

    // Keep selection if still valid
    if (cur && spots.includes(cur)) spotSel.value = cur;
  }

  function matchesText(session, q) {
    if (!q) return true;
    const hay = [
      session.city, session.spot, session.reasonsUse, session.reasonsNo, session.sessionCode
    ].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function applyFilters() {
    const { city, spot, q, from, to } = state.filter;

    state.filtered = state.sessions.filter(s => {
      if (city && s.city !== city) return false;
      if (spot && s.spot !== spot) return false;
      if (from && s.date && s.date < from) return false;
      if (to && s.date && s.date > to) return false;
      if (q && !matchesText(s, q)) return false;
      return true;
    });

    // If nothing matches, still render empty state without crashing.
    renderAll();
  }

  // --- Workbook loading ---
  async function loadWorkbook() {
    logDiag(`fetch: ${CFG.xlsx}`);
    const res = await fetch(CFG.xlsx);
    if (!res.ok) throw new Error(`Failed to load ${CFG.xlsx} (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();

    // Git LFS pointer detection (common on GitHub if LFS not configured on Pages)
    const head = new TextDecoder().decode(buf.slice(0, 140));
    if (head.includes('git-lfs.github.com/spec/v1')) {
      throw new Error(`Your XLSX appears to be a Git LFS pointer. GitHub Pages will not serve the real binary unless LFS is properly published. Upload the actual XLSX (non-LFS) to the Pages branch/folder.`);
    }

    state.wb = XLSX.read(buf, { type: 'array' });
    state.sessions = buildSessions(state.wb);
    state.farmers = buildFarmers(state.wb);
    logDiag(`workbook: sheets=${state.wb.SheetNames.length}, sessions=${state.sessions.length}, farmers=${state.farmers.length}`);
  }

  function buildSessions(wb) {
    const sumWs = wb.Sheets['SUM'] || wb.Sheets['Sum'] || wb.Sheets['sum'];
    if (!sumWs) throw new Error('Missing SUM sheet');

    const mat = sheetToMatrix(sumWs);
    const hRow = findHeaderRow(mat, ['City', 'Date', 'Session Location', 'Total Farmers']);
    if (hRow < 0) throw new Error('Could not find a header row in SUM (expected City/Date/Session Location/Total Farmers)');

    const rawHeaders = (mat[hRow] || []).map(v => String(v ?? '').trim());
    const headersNorm = rawHeaders.map(norm);

    // Required (best-match)
    const iCity = findCol(headersNorm, ['city', 'district', 'tehsil']);
    const iDate = findCol(headersNorm, ['date', 'session date', 'event date']);
    const iSpot = findCol(headersNorm, ['session location', 'spot', 'location', 'session spot', 'spot name', 'village', 'place']);
    const iFarmers = findCol(headersNorm, ['total farmers', 'farmers', 'farmers gathered', 'attendees', 'total attendance']);
    const iAcres = findCol(headersNorm, ['total wheat acres', 'wheat acres', 'crop area', 'acres', 'wheat area']);
    const iDef = findCol(headersNorm, ['will definitely use', 'definite', 'definitely use', 'definitely']);
    const iMay = findCol(headersNorm, ['maybe']);
    const iNo = findCol(headersNorm, ['not interested', 'no', 'no intent', 'not']);
    const iKnow = findCol(headersNorm, ['know buctril', 'awareness', 'know about buctril', 'already using', 'heard of']);
    const iCoords = findCol(headersNorm, ['spot coordinates', 'coordinates', 'lat', 'latitude', 'gps']);
    const iReasonUse = findCol(headersNorm, ['top reason to use', 'reason to use', 'top use reason', 'use reason']);
    const iReasonNo = findCol(headersNorm, ['top reason not to use', 'reason not to use', 'no reason', 'not use reason']);

    const iSn = findCol(headersNorm, ['sn', 'sno', 'session no', 'session number', 'sr']);

    // Clarity score columns: all columns that contain "score understood" or "understood:" or "clarity"
    const clarityCols = [];
    headersNorm.forEach((h, idx) => {
      if (h.includes('score understood') || h.includes('understood') || h.includes('clarity score') || h.includes('message clarity')) {
        clarityCols.push(idx);
      }
    });

    if (iCity < 0 || iDate < 0 || iSpot < 0 || iFarmers < 0) {
      logDiag(`SUM mapping: city=${iCity}, date=${iDate}, spot=${iSpot}, farmers=${iFarmers}. (Some required columns not detected.)`);
    } else {
      logDiag(`SUM mapping: city=${rawHeaders[iCity]}, date=${rawHeaders[iDate]}, spot=${rawHeaders[iSpot]}, farmers=${rawHeaders[iFarmers]}`);
    }

    const sessions = [];
    for (let r = hRow + 1; r < mat.length; r++) {
      const row = mat[r] || [];
      const city = iCity >= 0 ? String(row[iCity] ?? '').trim() : '';
      const spot = iSpot >= 0 ? String(row[iSpot] ?? '').trim() : '';
      const farmers = iFarmers >= 0 ? asNum(row[iFarmers]) : NaN;

      // Skip empty rows
      if (!city && !spot && !Number.isFinite(farmers)) continue;

      const date = iDate >= 0 ? asDate(row[iDate]) : null;
      const acres = iAcres >= 0 ? asNum(row[iAcres]) : NaN;

      const def = iDef >= 0 ? asNum(row[iDef]) : NaN;
      const may = iMay >= 0 ? asNum(row[iMay]) : NaN;
      const no = iNo >= 0 ? asNum(row[iNo]) : NaN;

      const knowRaw = iKnow >= 0 ? asNum(row[iKnow]) : NaN;
      // awareness heuristic: if <= farmers => count, else if <=100 assume percent
      const awareness = (Number.isFinite(knowRaw) && Number.isFinite(farmers) && farmers > 0)
        ? (knowRaw <= farmers ? pct(knowRaw, farmers) : (knowRaw <= 100 ? knowRaw : NaN))
        : NaN;

      const clarity = clarityCols.length
        ? avg(clarityCols.map(ci => asNum(row[ci])).filter(n => Number.isFinite(n) && n <= 100))
        : NaN;

      const coordStr = iCoords >= 0 ? String(row[iCoords] ?? '').trim() : '';
      const { lat, lon } = parseCoord(coordStr);

      const reasonsUse = iReasonUse >= 0 ? String(row[iReasonUse] ?? '').trim() : '';
      const reasonsNo = iReasonNo >= 0 ? String(row[iReasonNo] ?? '').trim() : '';

      const sn = iSn >= 0 ? asNum(row[iSn]) : NaN;

      // Optional day/session code if present (D#S#) in SUM
      const sessionCode = (() => {
        // Scan the row for tokens like D1S1 (useful for cross-linking)
        const joined = row.map(v => String(v ?? '')).join(' ');
        const m = joined.match(/\bD\d+S\d+\b/i);
        return m ? m[0].toUpperCase() : '';
      })();

      sessions.push({
        sn: Number.isFinite(sn) ? Math.round(sn) : null,
        date,
        city,
        spot,
        farmers: Number.isFinite(farmers) ? farmers : NaN,
        acres: Number.isFinite(acres) ? acres : NaN,
        def: Number.isFinite(def) ? def : NaN,
        may: Number.isFinite(may) ? may : NaN,
        no: Number.isFinite(no) ? no : NaN,
        defPct: (Number.isFinite(def) && Number.isFinite(farmers) && farmers > 0) ? pct(def, farmers) : NaN,
        awareness,
        clarity,
        lat, lon,
        reasonsUse,
        reasonsNo,
        sessionCode,
      });
    }

    // Sort by date then city/spot
    sessions.sort((a, b) => {
      const ad = a.date ? a.date.getTime() : 0;
      const bd = b.date ? b.date.getTime() : 0;
      if (ad !== bd) return ad - bd;
      const c = (a.city || '').localeCompare(b.city || '');
      if (c) return c;
      return (a.spot || '').localeCompare(b.spot || '');
    });

    return sessions;
  }

  function buildFarmers(wb) {
    const farmers = [];
    for (const sh of wb.SheetNames) {
      if (!/^D\d+S\d+$/i.test(sh)) continue;
      const ws = wb.Sheets[sh];
      const mat = sheetToMatrix(ws);
      const hRow = findHeaderRow(mat, ['name', 'mobile']);
      if (hRow < 0) continue;

      const rawHeaders = (mat[hRow] || []).map(v => String(v ?? '').trim());
      const headersNorm = rawHeaders.map(norm);

      const iName = findCol(headersNorm, ['name', 'farmer name']);
      const iPhone = findCol(headersNorm, ['mobile', 'mobile whatsapp', 'phone', 'mobile / whatsapp', 'mobilewhatsapp']);

      for (let r = hRow + 1; r < mat.length; r++) {
        const row = mat[r] || [];
        const name = iName >= 0 ? String(row[iName] ?? '').trim() : '';
        const phone = iPhone >= 0 ? String(row[iPhone] ?? '').trim() : '';
        if (!name && !phone) continue;
        farmers.push({ session: sh.toUpperCase(), name, phone });
      }
    }
    return farmers;
  }

  // --- Media loading ---
  async function loadMedia() {
    logDiag(`fetch: ${CFG.media}`);
    try {
      const res = await fetch(CFG.media, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.media = expandMedia(data);
      logDiag(`media: items=${state.media.length}`);
    } catch (e) {
      state.media = [];
      logDiag(`media: failed (${e.message})`);
    }
  }

  function expandMedia(data) {
    // Flat legacy: [{type, src, caption, ...}]
    if (Array.isArray(data)) return data.map(m => normalizeMediaItem(m)).filter(Boolean);

    // A_compact:
    // {format:"A_compact", basePath:"assets/gallery/", defaults:{...}, sessions:[{id,caption,city,spot,date}]}
    if (!data || data.format !== 'A_compact' || !Array.isArray(data.sessions)) return [];

    const base = String(data.basePath || '');
    const d = data.defaults || {};
    const mainVideoExt = d.mainVideoExt || 'mp4';
    const mainImageExt = d.mainImageExt || 'jpg';
    const variantImageExt = d.variantImageExt || 'jpg';
    const variantVideoExt = d.variantVideoExt || 'mp4';
    const variants = Array.isArray(d.variants) ? d.variants : ['a','b','c','d','e','f'];

    const items = [];
    for (const s of data.sessions) {
      const sid = s.id;
      const sessionId = Number.isFinite(Number(sid)) ? Number(sid) : null;
      const stem = `${base}${sid}`;

      // Main media
      items.push(normalizeMediaItem({
        type: 'video',
        src: `${stem}.${mainVideoExt}`,
        caption: s.caption ? `${s.caption} (Video)` : `Session ${sid} (Video)`,
        transcript: s.transcript || '',
        sessionId,
        city: s.city || '',
        spot: s.spot || '',
        date: s.date || '',
      }));
      items.push(normalizeMediaItem({
        type: 'image',
        src: `${stem}.${mainImageExt}`,
        caption: s.caption ? `${s.caption} (Photo)` : `Session ${sid} (Photo)`,
        transcript: '',
        sessionId,
        city: s.city || '',
        spot: s.spot || '',
        date: s.date || '',
      }));

      // Variants
      for (const v of variants) {
        items.push(normalizeMediaItem({
          type: 'image',
          src: `${stem}${v}.${variantImageExt}`,
          caption: s.caption ? `${s.caption} (Photo ${String(v).toUpperCase()})` : `Session ${sid} (Photo ${String(v).toUpperCase()})`,
          transcript: '',
          sessionId,
          city: s.city || '',
          spot: s.spot || '',
          date: s.date || '',
        }));
        items.push(normalizeMediaItem({
          type: 'video',
          src: `${stem}${v}.${variantVideoExt}`,
          caption: s.caption ? `${s.caption} (Video ${String(v).toUpperCase()})` : `Session ${sid} (Video ${String(v).toUpperCase()})`,
          transcript: '',
          sessionId,
          city: s.city || '',
          spot: s.spot || '',
          date: s.date || '',
        }));
      }
    }

    return items.filter(Boolean);
  }

  function normalizeMediaItem(m) {
    if (!m || !m.src) return null;
    const type = (m.type === 'video') ? 'video' : 'image';
    const caption = String(m.caption || '').trim();
    const alt = String(m.alt || caption || 'media').trim();
    const transcript = String(m.transcript || '').trim();

    let sessionId = null;
    if (Number.isFinite(Number(m.sessionId))) sessionId = Number(m.sessionId);

    // Parse from caption "Session 12"
    if (!sessionId && caption) {
      const mm = caption.match(/\b(?:session|sess)\s*(\d+)\b/i);
      if (mm) sessionId = Number(mm[1]);
    }
    // Parse from filename
    if (!sessionId) {
      const mm = String(m.src).match(/\/(\d+)[a-z]?\.(jpg|jpeg|png|webp|mp4|mov)$/i);
      if (mm) sessionId = Number(mm[1]);
    }

    return {
      type,
      src: String(m.src),
      caption: caption || (sessionId ? `Session ${sessionId}` : 'Media'),
      alt,
      transcript,
      sessionId,
      city: String(m.city || ''),
      spot: String(m.spot || ''),
      date: String(m.date || ''),
    };
  }

  // --- Render pipeline ---
  function renderAll() {
    renderFilterSummary();
    renderKpis();
    renderSnapshotText();
    renderCharts();
    renderMap();
    renderSessionsTable();
    renderShowcases();
    renderGallery();
  }

  function computeTotals(rows) {
    const sessions = rows.length;
    const farmers = rows.reduce((a, s) => a + (Number.isFinite(s.farmers) ? s.farmers : 0), 0);
    const acres = rows.reduce((a, s) => a + (Number.isFinite(s.acres) ? s.acres : 0), 0);
    const def = rows.reduce((a, s) => a + (Number.isFinite(s.def) ? s.def : 0), 0);
    const may = rows.reduce((a, s) => a + (Number.isFinite(s.may) ? s.may : 0), 0);
    const no = rows.reduce((a, s) => a + (Number.isFinite(s.no) ? s.no : 0), 0);
    const defPct = pct(def, farmers);

    const dates = rows.map(s => s.date).filter(Boolean).sort((a,b) => a - b);
    const dateFrom = dates.length ? dates[0] : null;
    const dateTo = dates.length ? dates[dates.length - 1] : null;

    return { sessions, farmers, acres, def, may, no, defPct, dateFrom, dateTo };
  }

  function renderFilterSummary() {
    const sum = computeTotals(state.filtered);
    const fs = $('filterSummary');
    const city = state.filter.city || 'All Cities';
    const spot = state.filter.spot || 'All Spots';
    const dateLabel = (sum.dateFrom && sum.dateTo)
      ? (fmtDate(sum.dateFrom) === fmtDate(sum.dateTo) ? fmtDate(sum.dateFrom) : `${fmtDate(sum.dateFrom)} → ${fmtDate(sum.dateTo)}`)
      : '—';

    if (fs) {
      fs.innerHTML = `<b>Selection:</b> ${escapeHtml(city)} • ${escapeHtml(spot)}<br/>` +
                     `<b>Sessions:</b> ${fmtInt(sum.sessions)} • <b>Farmers:</b> ${fmtInt(sum.farmers)} • <b>Acres:</b> ${fmtInt(sum.acres)}<br/>` +
                     `<b>Date:</b> ${escapeHtml(dateLabel)}`;
    }

    // Map banner (defaults to aggregated view unless a specific marker is selected)
    if (!state.map.selectedKey) {
      setText('mapSelTitle', `${city} • ${spot}`);
      setText('mapSelFarmers', fmtInt(sum.farmers));
      setText('mapSelAcres', fmtInt(sum.acres));
      setText('mapSelDate', dateLabel);
    }
  }

  function renderKpis() {
    const sum = computeTotals(state.filtered);

    setText('kpi-sessions', fmtInt(sum.sessions));
    setText('kpi-farmers', fmtInt(sum.farmers));
    setText('kpi-acres', fmtInt(sum.acres));
    setText('kpi-demo', Number.isFinite(sum.defPct) ? `${Math.round(sum.defPct)}% definite` : '—');

    // Bars: scale relative to full dataset (not filtered) for a stable sense of size
    const all = computeTotals(state.sessions);
    const pctSessions = all.sessions ? (sum.sessions / all.sessions) * 100 : 0;
    const pctFarmers = all.farmers ? (sum.farmers / all.farmers) * 100 : 0;
    const pctAcres = all.acres ? (sum.acres / all.acres) * 100 : 0;
    const pctDemo = Number.isFinite(sum.defPct) ? Math.max(0, Math.min(100, sum.defPct)) : 0;

    const setBar = (id, p) => {
      const el = $(id);
      if (el) el.style.width = `${Math.max(0, Math.min(100, p))}%`;
    };
    setBar('bar-sessions', pctSessions);
    setBar('bar-farmers', pctFarmers);
    setBar('bar-acres', pctAcres);
    setBar('bar-demo', pctDemo);
  }

  function renderSnapshotText() {
    const sum = computeTotals(state.filtered);
    const city = state.filter.city || 'All Cities';
    const spot = state.filter.spot || 'All Spots';
    const dateLabel = (sum.dateFrom && sum.dateTo)
      ? (fmtDate(sum.dateFrom) === fmtDate(sum.dateTo) ? fmtDate(sum.dateFrom) : `${fmtDate(sum.dateFrom)} → ${fmtDate(sum.dateTo)}`)
      : '—';

    const topUse = topCounts(state.filtered.map(s => s.reasonsUse).filter(Boolean), CFG.maxReasons);
    const topNo = topCounts(state.filtered.map(s => s.reasonsNo).filter(Boolean), CFG.maxReasons);

    $('snapshot').textContent =
      `${city} • ${spot} • Date: ${dateLabel}. ` +
      `Sessions: ${fmtInt(sum.sessions)}, Farmers: ${fmtInt(sum.farmers)}, Acres: ${fmtInt(sum.acres)}. ` +
      (Number.isFinite(sum.defPct) ? `Definite intent: ${Math.round(sum.defPct)}%. ` : '') +
      (topUse.length ? `Top reason to use: "${topUse[0][0]}" (${topUse[0][1]}). ` : '') +
      (topNo.length ? `Top reason not to use: "${topNo[0][0]}" (${topNo[0][1]}).` : '');

    renderReasons('reasonUse', topUse);
    renderReasons('reasonNo', topNo);
  }

  function topCounts(values, maxN) {
    const m = new Map();
    for (const v of values) {
      const k = String(v).trim();
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a,b) => b[1] - a[1]).slice(0, maxN);
  }

  function renderReasons(tbodyId, pairs) {
    const tb = $(tbodyId);
    if (!tb) return;
    tb.innerHTML = '';
    if (!pairs.length) {
      tb.innerHTML = `<tr><td class="muted">—</td><td>—</td></tr>`;
      return;
    }
    for (const [k, v] of pairs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmtInt(v)}</td>`;
      tb.appendChild(tr);
    }
  }

  // --- Charts ---
  function ensureChart(prev, canvasEl, type, data, options) {
    if (!canvasEl) return null;
    if (prev) prev.destroy();
    return new Chart(canvasEl, { type, data, options: options || {} });
  }

  function renderCharts() {
    // City distribution (by sessions count)
    const cityCounts = new Map();
    for (const s of state.filtered) {
      const k = s.city || 'Other';
      cityCounts.set(k, (cityCounts.get(k) || 0) + 1);
    }
    const cityLabels = Array.from(cityCounts.keys()).sort((a,b) => a.localeCompare(b));
    const cityData = cityLabels.map(l => cityCounts.get(l));

    state.charts.city = ensureChart(
      state.charts.city,
      $('chartCity'),
      'doughnut',
      {
        labels: cityLabels,
        datasets: [{ data: cityData }]
      },
      { responsive: true, plugins: { legend: { position: 'right' } } }
    );

    // Intent split (by counts)
    const sum = computeTotals(state.filtered);
    state.charts.intent = ensureChart(
      state.charts.intent,
      $('chartIntent'),
      'pie',
      {
        labels: ['Definite', 'Maybe', 'Not Interested'],
        datasets: [{ data: [sum.def, sum.may, sum.no] }]
      },
      { responsive: true, plugins: { legend: { position: 'right' } } }
    );

    // Trend: by date (sum farmers, sum acres)
    const byDate = new Map();
    for (const s of state.filtered) {
      const d = s.date ? fmtDate(s.date) : 'Unknown';
      const cur = byDate.get(d) || { farmers: 0, acres: 0 };
      cur.farmers += Number.isFinite(s.farmers) ? s.farmers : 0;
      cur.acres += Number.isFinite(s.acres) ? s.acres : 0;
      byDate.set(d, cur);
    }
    const tLabels = Array.from(byDate.keys()).sort();
    const tFarmers = tLabels.map(d => byDate.get(d).farmers);
    const tAcres = tLabels.map(d => byDate.get(d).acres);

    state.charts.trend = ensureChart(
      state.charts.trend,
      $('chartTrend'),
      'line',
      {
        labels: tLabels,
        datasets: [
          { label: 'Farmers', data: tFarmers, tension: 0.25 },
          { label: 'Acres', data: tAcres, tension: 0.25 }
        ]
      },
      { responsive: true, scales: { y: { beginAtZero: true } } }
    );
  }

  // --- Map ---
  function initMapIfNeeded() {
    if (state.map.obj) return;

    const mapEl = $('map');
    if (!mapEl) return;

    state.map.obj = L.map(mapEl).setView(CFG.mapCenter, CFG.mapZoom);
    state.map.base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(state.map.obj);

    state.map.layer = L.layerGroup().addTo(state.map.obj);
    logDiag('map: initialized');
  }

  function acresToRadiusMeters(acres) {
    if (!Number.isFinite(acres) || acres <= 0) return 150; // fallback
    const area = acres * 4046.86;
    const r = Math.sqrt(area / Math.PI);
    return Math.max(80, Math.min(CFG.bubbleClampMeters, r));
  }

  function sessionKey(s) {
    // Prefer SN; fallback to city|spot|date
    if (Number.isFinite(Number(s.sn))) return `sn:${s.sn}`;
    return `k:${s.city}|${s.spot}|${fmtDate(s.date)}`;
  }

  function renderMap() {
    initMapIfNeeded();
    if (!state.map.obj || !state.map.layer) return;

    state.map.layer.clearLayers();
    if (state.map.route) {
      state.map.route.remove();
      state.map.route = null;
    }

    const rows = state.filtered.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!rows.length) {
      $('mapLegend').textContent = 'No valid coordinates for the current selection. (Coordinates are optional; ensure SUM has a Spot Coordinates column.)';
      return;
    }

    const latlngs = [];
    for (const s of rows) {
      const key = sessionKey(s);
      const rMeters = acresToRadiusMeters(s.acres);

      const circle = L.circle([s.lat, s.lon], {
        radius: rMeters,
        color: 'rgba(134,239,172,.95)',
        weight: 2,
        fillColor: 'rgba(125,211,252,.35)',
        fillOpacity: 0.55
      });

      circle.bindPopup(
        `<b>${escapeHtml(s.spot || 'Spot')}</b><br/>` +
        `${escapeHtml(s.city || '')}<br/>` +
        `Farmers: ${fmtInt(s.farmers)}<br/>` +
        `Wheat acres: ${fmtInt(s.acres)}<br/>` +
        `Date: ${escapeHtml(fmtDate(s.date))}`
      );

      circle.on('click', () => selectMapSession(s));
      circle.addTo(state.map.layer);

      // center marker (for crisp point)
      L.circleMarker([s.lat, s.lon], {
        radius: 4,
        color: 'rgba(231,237,247,.95)',
        weight: 1,
        fillOpacity: 1
      }).addTo(state.map.layer);

      latlngs.push([s.lat, s.lon]);
    }

    // Optional route polyline (chronological)
    if (CFG.routeLine && rows.length > 1) {
      const ordered = rows.slice().sort((a,b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
      const pts = ordered.map(s => [s.lat, s.lon]);
      state.map.route = L.polyline(pts, { color: 'rgba(251,191,36,.85)', weight: 2, dashArray: '6, 8' }).addTo(state.map.layer);
    }

    // Fit bounds
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) state.map.obj.fitBounds(bounds, { padding: [30, 30] });

    // Keep map banner aggregated unless a selection is pinned
    state.map.selectedKey = state.map.selectedKey || '';
  }

  function selectMapSession(s) {
    const key = sessionKey(s);
    state.map.selectedKey = key;

    setText('mapSelTitle', `${s.city || '—'} • ${s.spot || '—'}`);
    setText('mapSelFarmers', fmtInt(s.farmers));
    setText('mapSelAcres', fmtInt(s.acres));
    setText('mapSelDate', fmtDate(s.date));

    const rel = relatedMediaForSession(s);
    renderShowcase('mapShowcase', rel);

    // Also update sidebar summary line to reflect "pinned" selection
    const fs = $('filterSummary');
    if (fs) {
      const pinned = `<br/><b>Pinned:</b> ${escapeHtml(s.city || '')} • ${escapeHtml(s.spot || '')} • ${escapeHtml(fmtDate(s.date))}`;
      if (!fs.innerHTML.includes('Pinned:')) fs.innerHTML += pinned;
      else fs.innerHTML = fs.innerHTML.replace(/<br\/><b>Pinned:<\/b>[\s\S]*$/i, pinned);
    }
  }

  function relatedMediaForSession(s) {
    // Priority order:
    // 1) exact sessionId match (SN)
    // 2) city/spot tag match in media.json
    // 3) caption contains spot/city text
    const sid = Number.isFinite(Number(s.sn)) ? Number(s.sn) : null;

    const bySid = sid ? state.media.filter(m => m.sessionId === sid) : [];
    if (bySid.length) return bySid;

    const city = (s.city || '').toLowerCase();
    const spot = (s.spot || '').toLowerCase();

    const byTags = state.media.filter(m => {
      if (m.city && city && m.city.toLowerCase() === city) return true;
      if (m.spot && spot && m.spot.toLowerCase() === spot) return true;
      return false;
    });
    if (byTags.length) return byTags;

    const byCaption = state.media.filter(m => {
      const cap = (m.caption || '').toLowerCase();
      return (spot && cap.includes(spot)) || (city && cap.includes(city));
    });
    return byCaption;
  }

  // --- Sessions table ---
  function renderSessionsTable() {
    const tb = $('tblSessions');
    if (!tb) return;
    tb.innerHTML = '';

    const rows = state.filtered.slice().sort((a,b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="8" class="muted">No sessions match the current filters.</td></tr>`;
      return;
    }

    for (const s of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(fmtDate(s.date))}</td>
        <td>${escapeHtml(s.city || '—')}</td>
        <td>${escapeHtml(s.spot || '—')}</td>
        <td>${fmtInt(s.farmers)}</td>
        <td>${fmtInt(s.acres)}</td>
        <td>${fmtPct(s.defPct)}</td>
        <td>${fmtPct(s.awareness)}</td>
        <td>${fmtPct(s.clarity)}</td>
      `;
      tr.addEventListener('click', () => {
        const rel = relatedMediaForSession(s);
        if (rel.length) openLightbox(rel, 0);
        // also pin on map if possible
        if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) selectMapSession(s);
      });
      tb.appendChild(tr);
    }
  }

  // --- Gallery + showcases ---
  function renderShowcases() {
    // Snapshot showcase: pick first N media matching filter (or general)
    const items = filteredMedia().slice(0, CFG.maxShowcase);
    renderShowcase('snapshotShowcase', items);
  }

  function renderShowcase(id, items) {
    const sc = $(id);
    if (!sc) return;
    sc.innerHTML = '';
    if (!items.length) return;

    items.slice(0, CFG.maxShowcase).forEach((item, idx) => {
      const it = document.createElement('div');
      it.className = 'showItem';

      const prev = document.createElement(item.type === 'video' ? 'video' : 'img');
      prev.src = item.src;
      prev.loading = 'lazy';
      if (item.type === 'video') {
        prev.muted = true;
        prev.playsInline = true;
        prev.preload = 'metadata';
      } else {
        prev.alt = item.alt || item.caption || 'media';
      }
      prev.addEventListener('error', () => it.classList.add('broken'));
      it.appendChild(prev);

      it.title = item.caption || '';
      it.addEventListener('click', () => openLightbox(items, idx));
      sc.appendChild(it);
    });
  }

  function filteredMedia() {
    // If we can join by sessionId (SN), do it. Otherwise fall back to city/spot.
    const { city, spot, q } = state.filter;
    const rows = state.filtered;

    const sids = new Set(rows.map(s => s.sn).filter(n => Number.isFinite(Number(n))));
    let items = state.media;

    if (sids.size) {
      items = items.filter(m => m.sessionId && sids.has(m.sessionId));
    } else if (city || spot) {
      const c = (city || '').toLowerCase();
      const sp = (spot || '').toLowerCase();
      items = items.filter(m => {
        const mc = (m.city || '').toLowerCase();
        const ms = (m.spot || '').toLowerCase();
        const cap = (m.caption || '').toLowerCase();
        return (!city || mc === c || cap.includes(c)) && (!spot || ms === sp || cap.includes(sp));
      });
    }

    if (q) {
      const qq = q.toLowerCase();
      items = items.filter(m => (m.caption || '').toLowerCase().includes(qq));
    }

    return items;
  }

  function renderGallery() {
    const gg = $('galleryGrid');
    if (!gg) return;
    gg.innerHTML = '';

    const items = filteredMedia().slice(0, CFG.maxGallery);
    if (!items.length) {
      gg.innerHTML = `<div class="muted">No media matched the current filters.</div>`;
      return;
    }

    items.forEach((item, i) => {
      const tile = document.createElement('div');
      tile.className = 'mediaTile';

      const prev = document.createElement(item.type === 'video' ? 'video' : 'img');
      prev.src = item.src;
      prev.loading = 'lazy';
      if (item.type === 'video') {
        prev.muted = true;
        prev.playsInline = true;
        prev.preload = 'metadata';
      } else {
        prev.alt = item.alt || item.caption || 'media';
      }
      prev.addEventListener('error', () => tile.classList.add('broken'));
      tile.appendChild(prev);

      const tag = document.createElement('div');
      tag.className = 'mediaTag';
      tag.textContent = item.caption || (item.sessionId ? `Session ${item.sessionId}` : 'Media');
      tile.appendChild(tag);

      tile.addEventListener('click', () => openLightbox(items, i));
      gg.appendChild(tile);
    });
  }

  // --- Export ---
  function exportFilteredCsv() {
    const rows = state.filtered;
    if (!rows.length) {
      setNotice('Nothing to export (no rows in the current filter).', true);
      return;
    }

    const header = ['Date','City','Spot','Farmers','Acres','Definite','Maybe','NotInterested','DefinitePct','AwarenessPct','ClarityPct'];
    const lines = [header.join(',')];
    for (const s of rows) {
      const vals = [
        fmtDate(s.date),
        csvSafe(s.city),
        csvSafe(s.spot),
        safeNum(s.farmers),
        safeNum(s.acres),
        safeNum(s.def),
        safeNum(s.may),
        safeNum(s.no),
        safeNum(s.defPct),
        safeNum(s.awareness),
        safeNum(s.clarity),
      ];
      lines.push(vals.join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AgriVista_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function safeNum(n) {
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
  }
  function csvSafe(s) {
    const v = String(s ?? '');
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  // --- Hero video (optional) ---
  function initHeroVideo() {
    const v = $('heroVideo');
    if (!v) return;
    v.src = CFG.heroVideo;
    v.addEventListener('error', () => {
      v.classList.add('hide');
      logDiag(`heroVideo: not found (${CFG.heroVideo})`);
    });
  }

  // --- Init ---
  async function init() {
    setText('buildStamp', 'v' + (new Date().toISOString().slice(0,10)));
    initTabs();
    initLightbox();
    initFilters();
    initHeroVideo();

    setNotice('Loading workbook and media…');
    logDiag('init: start');

    try {
      await loadWorkbook();
      await loadMedia();

      buildFilterOptions();
      state.filtered = state.sessions.slice();
      renderAll();

      setNotice('Ready.');
      logDiag('init: ready');
    } catch (e) {
      setNotice(e.message || String(e), true);
      logDiag(`init: error: ${e.message || e}`);
      // still attempt to render empty UI (so the page looks "alive")
      state.sessions = state.sessions || [];
      state.filtered = [];
      renderAll();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
