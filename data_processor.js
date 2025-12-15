/* AgriVista dashboard logic (Leaflet + Chart.js + XLSX)
   - Reads: Buctril_Super_Activations.xlsx (sheet: SUM; session sheets: D#S#)
   - Reads: media.json (A_compact or flat array)
   - Updates: KPIs, charts, map (acre bubbles), sessions table, gallery, showcases
   - Best-match header parsing for inconsistent headers.
   - IMPORTANT: Must be served via HTTP(S) (GitHub Pages/local server), not file://
*/
(() => {
  'use strict';

  const CFG = Object.freeze({
    xlsx: 'Buctril_Super_Activations.xlsx',
    media: 'media.json',
    heroVideo: 'assets/bg.mp4', // optional; hides automatically if missing
    mapCenter: [30.3753, 69.3451],
    mapZoom: 5,
    maxGallery: 72,
    maxShowcase: 10,
    maxReasons: 10,
    bubbleClampMeters: 6000,     // clamp map circles
    routeLine: false,            // optional route line
    depTimeoutMs: 12000,
  });

  // ---- DOM helpers (IDs preserved) ----
  const $ = (id) => document.getElementById(id);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = val;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  function setNotice(msg, isErr = false) {
    const nb = $('noticeBox');
    if (!nb) return;
    nb.innerHTML = `<strong>${isErr ? 'Error' : 'Status'}:</strong> ${escapeHtml(String(msg))}`;
    nb.style.borderColor = isErr ? 'rgba(251,113,133,.55)' : 'rgba(255,255,255,.14)';
  }

  function showError(message, details = '') {
    const ec = $('errorContainer');
    if (ec) {
      ec.style.display = 'block';
      ec.innerHTML = `
        <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(message)}</div>
        ${details ? `<div style="opacity:.92; margin-bottom:8px;">${escapeHtml(details)}</div>` : ''}
        <div style="opacity:.85;">
          <div style="margin-bottom:6px;">Checklist:</div>
          <ul style="margin-left:18px; line-height:1.45;">
            <li><code>${escapeHtml(CFG.xlsx)}</code> is in the same folder as <code>index.html</code></li>
            <li>If you used Git LFS, GitHub Pages may serve a pointer file (not the real XLSX)</li>
            <li>Open DevTools Console to see the exact failing request</li>
            <li>Do not open via <code>file://</code>; use GitHub Pages or a local server</li>
          </ul>
        </div>
      `;
    }
    setNotice(message, true);
    logDiag(`ERROR: ${message}${details ? ' — ' + details : ''}`);
  }

  function updateLoadingStatus(status) {
    const el = $('loadingStatus');
    if (el) el.textContent = status;
  }

  function logDiag(line) {
    const el = $('diagBox');
    if (!el) return;
    const ts = new Date().toISOString().split('T')[1].replace('Z', '');
    el.textContent = `[${ts}] ${line}\n` + el.textContent;
  }

  // ---- Formatting ----
  const fmtInt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';
  const fmtPct = (p) => Number.isFinite(p) ? `${Math.round(p)}%` : '—';

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

  // ---- Normalization / matching ----
  function norm(s) {
    return String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w% ]/g, '');
  }

  function sheetToMatrix(ws) {
    // raw:true keeps numbers as numbers; strings as strings
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  }

  function findHeaderRow(mat, mustHaveAny) {
    const must = mustHaveAny.map(norm);
    for (let r = 0; r < mat.length; r++) {
      const row = (mat[r] || []).map(norm);
      const hits = must.filter(k => row.includes(k));
      if (hits.length >= Math.min(3, must.length)) return r;
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
    // 2) substring match
    for (let i = 0; i < headersNorm.length; i++) {
      const h = headersNorm[i];
      for (const c of cands) {
        if (h && c && h.includes(c)) return i;
      }
    }
    return -1;
  }

  // ---- Coordinates: supports "lat,lon" or DMS with N/E/S/W ----
  function dmsToDd(deg, min, sec, dir) {
    let dd = Math.abs(deg) + (min || 0) / 60 + (sec || 0) / 3600;
    if (dir === 'S' || dir === 'W') dd = -dd;
    return dd;
  }

  function parseOneCoord(part) {
    // decimal degrees (heuristic: no NSEW in token)
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
    if (!s) return { lat: NaN, lon: NaN };
    const raw = String(s).trim();
    if (!raw) return { lat: NaN, lon: NaN };

    // "lat, lon"
    if (raw.includes(',')) {
      const [a, b] = raw.split(',').map(t => t.trim());
      const lat = Number(a);
      const lon = Number(b);
      return { lat: Number.isFinite(lat) ? lat : NaN, lon: Number.isFinite(lon) ? lon : NaN };
    }

    // Try to detect two parts (lat then lon)
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) {
      // First try token 0, token 1
      let lat = parseOneCoord(parts[0]);
      let lon = parseOneCoord(parts[1]);

      // If failed, split into halves and parse joined
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const mid = Math.ceil(parts.length / 2);
        lat = parseOneCoord(parts.slice(0, mid).join(' '));
        lon = parseOneCoord(parts.slice(mid).join(' '));
      }
      return { lat, lon };
    }

    return { lat: NaN, lon: NaN };
  }

  // ---- State ----
  const state = {
    wb: null,
    sessions: [],
    farmers: [],
    media: [],
    filtered: [],
    filter: { city: '', spot: '', q: '', from: null, to: null },
    charts: { city: null, intent: null, trend: null },
    map: { obj: null, layer: null, route: null, pinnedKey: '' },
    lightbox: { items: [], idx: -1 },
  };

  // ---- Tabs ----
  function initTabs() {
    const btns = qa('.tabBtn');
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(bb => bb.classList.toggle('active', bb === b));
      qa('.tabPanel').forEach(p => p.classList.toggle('active', p.id === b.dataset.tab));
      if (b.dataset.tab === 'tab-map' && state.map.obj) state.map.obj.invalidateSize();
    }));
  }

  // ---- Lightbox ----
  function initLightbox() {
    const lb = $('lightbox');
    if (!lb) return;

    const close = () => { lb.style.display = 'none'; };
    const nav = (delta) => {
      if (!state.lightbox.items.length) return;
      state.lightbox.idx = (state.lightbox.idx + delta + state.lightbox.items.length) % state.lightbox.items.length;
      renderLightbox();
    };

    $('lbClose')?.addEventListener('click', close);
    $('lbPrev')?.addEventListener('click', () => nav(-1));
    $('lbNext')?.addEventListener('click', () => nav(1));
    lb.addEventListener('click', e => { if (e.target === lb) close(); });

    document.addEventListener('keydown', e => {
      if (lb.style.display !== 'flex') return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') nav(-1);
      if (e.key === 'ArrowRight') nav(1);
    });
  }

  function openLightbox(items, startIdx = 0) {
    state.lightbox.items = items;
    state.lightbox.idx = startIdx;
    renderLightbox();
    $('lightbox').style.display = 'flex';
  }

  function renderLightbox() {
    const item = state.lightbox.items[state.lightbox.idx];
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

  // ---- Filters ----
  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function initFilters() {
    const citySel = $('filter-city');
    const spotSel = $('filter-district');
    const spotCompat = $('filter-spot'); // hidden compat selector
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
      state.map.pinnedKey = '';
      updateSpotOptions(true);
      applyFilters();
    });

    exportBtn.addEventListener('click', exportFilteredCsv);
  }

  function buildFilterOptions() {
    const citySel = $('filter-city');
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

    renderAll();
  }

  // ---- Workbook loading + parsing ----
  async function loadWorkbook() {
    updateLoadingStatus('Loading workbook…');
    const url = new URL(CFG.xlsx, document.baseURI).toString();
    logDiag(`fetch: ${url}`);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to load workbook (HTTP ${res.status}). Missing file?`);
    }
    const buf = await res.arrayBuffer();

    // Git LFS pointer detection (very small file that is plain text)
    if (buf.byteLength < 2048) {
      const head = new TextDecoder().decode(buf.slice(0, Math.min(200, buf.byteLength)));
      if (head.includes('git-lfs.github.com/spec/v1')) {
        throw new Error('Workbook is a Git LFS pointer (not the real XLSX). GitHub Pages cannot serve LFS objects. Commit the real XLSX (or export to CSV/JSON).');
      }
    }
    if (buf.byteLength < 100) throw new Error(`Workbook file is too small (${buf.byteLength} bytes).`);

    state.wb = XLSX.read(buf, { type: 'array' });
    if (!state.wb.SheetNames || !state.wb.SheetNames.length) throw new Error('Workbook has no sheets.');
    return true;
  }

  function buildSessions(wb) {
    // Locate SUM sheet (case-insensitive)
    const sumName = wb.SheetNames.find(n => String(n).trim().toLowerCase() === 'sum') || wb.SheetNames[0];
    const sumWs = wb.Sheets[sumName];
    if (!sumWs) throw new Error('SUM sheet missing and no fallback sheet found.');
    logDiag(`SUM sheet: ${sumName}`);

    const mat = sheetToMatrix(sumWs);
    let hRow = findHeaderRow(mat, ['City', 'Date', 'Session Location', 'Total Farmers']);
    if (hRow < 0) hRow = 0;

    const rawHeaders = (mat[hRow] || []).map(v => String(v ?? '').trim());
    const headersNorm = rawHeaders.map(norm);

    const iCity = findCol(headersNorm, ['city', 'district', 'tehsil']);
    const iDate = findCol(headersNorm, ['date', 'session date', 'event date']);
    const iSpot = findCol(headersNorm, ['session location', 'spot', 'location', 'session spot', 'spot name', 'village', 'place']);
    const iFarmers = findCol(headersNorm, ['total farmers', 'farmers', 'farmers gathered', 'attendees', 'total attendance']);
    const iAcres = findCol(headersNorm, ['total wheat acres', 'wheat acres', 'crop area', 'acres', 'wheat area']);
    const iDef = findCol(headersNorm, ['will definitely use', 'definite', 'definitely use', 'definitely']);
    const iMay = findCol(headersNorm, ['maybe']);
    const iNo = findCol(headersNorm, ['not interested', 'no', 'no intent', 'not']);
    const iKnow = findCol(headersNorm, ['know buctril', 'awareness', 'know about buctril', 'already using', 'heard of']);
    const iCoords = findCol(headersNorm, ['spot coordinates', 'coordinates', 'gps', 'lat', 'latitude']);
    const iReasonUse = findCol(headersNorm, ['top reason to use', 'reason to use', 'top use reason', 'use reason']);
    const iReasonNo = findCol(headersNorm, ['top reason not to use', 'reason not to use', 'not use reason']);
    const iSn = findCol(headersNorm, ['sn', 'sno', 'session no', 'session number', 'sr', 'serial']);

    // Clarity score columns
    const clarityCols = [];
    headersNorm.forEach((h, idx) => {
      if (h.includes('score understood') || h.includes('clarity') || h.includes('message') && h.includes('score')) clarityCols.push(idx);
    });

    logDiag(`SUM mapping: city=${iCity}, date=${iDate}, spot=${iSpot}, farmers=${iFarmers}, acres=${iAcres}, coords=${iCoords}, sn=${iSn}`);

    const sessions = [];
    for (let r = hRow + 1; r < mat.length; r++) {
      const row = mat[r] || [];
      const city = iCity >= 0 ? String(row[iCity] ?? '').trim() : '';
      const spot = iSpot >= 0 ? String(row[iSpot] ?? '').trim() : '';
      const farmers = iFarmers >= 0 ? asNum(row[iFarmers]) : NaN;

      // Skip fully empty lines
      if (!city && !spot && !Number.isFinite(farmers)) continue;

      const date = iDate >= 0 ? asDate(row[iDate]) : null;
      const acres = iAcres >= 0 ? asNum(row[iAcres]) : NaN;

      const def = iDef >= 0 ? asNum(row[iDef]) : NaN;
      const may = iMay >= 0 ? asNum(row[iMay]) : NaN;
      const no = iNo >= 0 ? asNum(row[iNo]) : NaN;

      const knowRaw = iKnow >= 0 ? asNum(row[iKnow]) : NaN;
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

      // Detect D#S# token anywhere in row for linking
      const joined = row.map(v => String(v ?? '')).join(' ');
      const m = joined.match(/\bD\d+S\d+\b/i);
      const sessionCode = m ? m[0].toUpperCase() : '';

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

    sessions.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
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
      const iPhone = findCol(headersNorm, ['mobile', 'mobile / whatsapp', 'phone', 'whatsapp']);

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

  // ---- Media loading ----
  async function loadMedia() {
    updateLoadingStatus('Loading media…');
    const url = new URL(CFG.media, document.baseURI).toString();
    logDiag(`fetch: ${url}`);

    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        logDiag(`media: HTTP ${res.status} — using empty array`);
        state.media = [];
        return;
      }
      const data = await res.json();
      state.media = expandMedia(data);
      logDiag(`media: items=${state.media.length}`);
    } catch (e) {
      state.media = [];
      logDiag(`media: failed (${e.message})`);
    }
  }

  function normalizeMediaItem(m) {
    if (!m || !m.src) return null;
    const type = (String(m.type || '').toLowerCase() === 'video') ? 'video' : 'image';
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
    // Parse from filename ".../12a.jpg"
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

  function expandMedia(data) {
    if (Array.isArray(data)) return data.map(normalizeMediaItem).filter(Boolean);

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
      const stem = `${base}${sid}`;

      items.push(normalizeMediaItem({
        type: 'video', src: `${stem}.${mainVideoExt}`,
        caption: s.caption ? `${s.caption} (Video)` : `Session ${sid} (Video)`,
        transcript: s.transcript || '',
        sessionId: Number(sid),
        city: s.city || '', spot: s.spot || '', date: s.date || '',
      }));
      items.push(normalizeMediaItem({
        type: 'image', src: `${stem}.${mainImageExt}`,
        caption: s.caption ? `${s.caption} (Photo)` : `Session ${sid} (Photo)`,
        transcript: '',
        sessionId: Number(sid),
        city: s.city || '', spot: s.spot || '', date: s.date || '',
      }));

      for (const v of variants) {
        items.push(normalizeMediaItem({
          type: 'image', src: `${stem}${v}.${variantImageExt}`,
          caption: s.caption ? `${s.caption} (Photo ${String(v).toUpperCase()})` : `Session ${sid} (Photo ${String(v).toUpperCase()})`,
          sessionId: Number(sid), city: s.city || '', spot: s.spot || '', date: s.date || '',
        }));
        items.push(normalizeMediaItem({
          type: 'video', src: `${stem}${v}.${variantVideoExt}`,
          caption: s.caption ? `${s.caption} (Video ${String(v).toUpperCase()})` : `Session ${sid} (Video ${String(v).toUpperCase()})`,
          sessionId: Number(sid), city: s.city || '', spot: s.spot || '', date: s.date || '',
        }));
      }
    }
    return items.filter(Boolean);
  }

  // ---- Derived computations ----
  function computeTotals(rows) {
    const sessions = rows.length;
    const farmers = rows.reduce((a, s) => a + (Number.isFinite(s.farmers) ? s.farmers : 0), 0);
    const acres = rows.reduce((a, s) => a + (Number.isFinite(s.acres) ? s.acres : 0), 0);
    const def = rows.reduce((a, s) => a + (Number.isFinite(s.def) ? s.def : 0), 0);
    const may = rows.reduce((a, s) => a + (Number.isFinite(s.may) ? s.may : 0), 0);
    const no = rows.reduce((a, s) => a + (Number.isFinite(s.no) ? s.no : 0), 0);
    const defPct = pct(def, farmers);

    const dates = rows.map(s => s.date).filter(Boolean).sort((a,b) => a - b);
    const dateFrom = dates.length ? dates[dates.length - 1] : null; // sessions sorted desc; but keep min/max reliably:
    const dateTo = dates.length ? dates[0] : null;
    const minD = dates.length ? dates[0] : null;
    const maxD = dates.length ? dates[dates.length - 1] : null;

    return { sessions, farmers, acres, def, may, no, defPct, dateFrom: minD, dateTo: maxD };
  }

  function dateRangeLabel(minD, maxD) {
    if (!minD || !maxD) return '—';
    const a = fmtDate(minD);
    const b = fmtDate(maxD);
    return a === b ? a : `${a} → ${b}`;
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

  // ---- Rendering ----
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

  function renderFilterSummary() {
    const sum = computeTotals(state.filtered);
    const city = state.filter.city || 'All Cities';
    const spot = state.filter.spot || 'All Spots';
    const dateLabel = dateRangeLabel(sum.dateFrom, sum.dateTo);

    const fs = $('filterSummary');
    if (fs) {
      fs.innerHTML =
        `<b>Selection:</b> ${escapeHtml(city)} • ${escapeHtml(spot)}<br/>` +
        `<b>Sessions:</b> ${fmtInt(sum.sessions)} • <b>Farmers:</b> ${fmtInt(sum.farmers)} • <b>Acres:</b> ${fmtInt(sum.acres)}<br/>` +
        `<b>Date:</b> ${escapeHtml(dateLabel)}`;
    }

    // If not pinned, map banner reflects aggregate selection
    if (!state.map.pinnedKey) {
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

    // Bars relative to full dataset
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
    const dateLabel = dateRangeLabel(sum.dateFrom, sum.dateTo);

    const topUse = topCounts(state.filtered.map(s => s.reasonsUse).filter(Boolean), CFG.maxReasons);
    const topNo = topCounts(state.filtered.map(s => s.reasonsNo).filter(Boolean), CFG.maxReasons);

    const snap = $('snapshot');
    if (snap) {
      snap.textContent =
        `${city} • ${spot} • Date: ${dateLabel}. ` +
        `Sessions: ${fmtInt(sum.sessions)}, Farmers: ${fmtInt(sum.farmers)}, Acres: ${fmtInt(sum.acres)}. ` +
        (Number.isFinite(sum.defPct) ? `Definite intent: ${Math.round(sum.defPct)}%. ` : '') +
        (topUse.length ? `Top reason to use: "${topUse[0][0]}" (${topUse[0][1]}). ` : '') +
        (topNo.length ? `Top reason not to use: "${topNo[0][0]}" (${topNo[0][1]}).` : '');
    }

    renderReasons('reasonUse', topUse);
    renderReasons('reasonNo', topNo);
  }

  function renderReasons(tbodyId, pairs) {
    const tb = $(tbodyId);
    if (!tb) return;
    tb.innerHTML = '';
    if (!pairs.length) {
      tb.innerHTML = `<tr><td class="muted">—</td><td class="muted">—</td></tr>`;
      return;
    }
    for (const [k, v] of pairs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmtInt(v)}</td>`;
      tb.appendChild(tr);
    }
  }

  // ---- Charts ----
  function ensureChart(prev, canvasEl, type, data, options) {
    if (!canvasEl || !window.Chart) return null;
    if (prev) prev.destroy();
    try {
      return new Chart(canvasEl, {
        type,
        data,
        options: Object.assign({
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right' } }
        }, options || {})
      });
    } catch (e) {
      logDiag(`chart error: ${e.message}`);
      return null;
    }
  }

  function palette(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = Math.round((360 * i) / Math.max(1, n));
      out.push(`hsla(${h}, 70%, 55%, 0.75)`);
    }
    return out;
  }

  function renderCharts() {
    // City distribution (count of sessions)
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
      { labels: cityLabels, datasets: [{ data: cityData, backgroundColor: palette(cityLabels.length) }] }
    );

    // Intent split
    const sum = computeTotals(state.filtered);
    state.charts.intent = ensureChart(
      state.charts.intent,
      $('chartIntent'),
      'pie',
      { labels: ['Definite', 'Maybe', 'Not Interested'], datasets: [{ data: [sum.def, sum.may, sum.no], backgroundColor: ['rgba(134,239,172,.75)','rgba(251,191,36,.75)','rgba(251,113,133,.75)'] }] }
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
          { label: 'Farmers', data: tFarmers, tension: 0.25, borderWidth: 2, pointRadius: 2 },
          { label: 'Acres', data: tAcres, tension: 0.25, borderWidth: 2, pointRadius: 2 },
        ]
      },
      { scales: { y: { beginAtZero: true } } }
    );
  }

  // ---- Map (Leaflet) ----
  function initMapIfNeeded() {
    if (state.map.obj) return;
    if (!window.L) throw new Error('Leaflet not available.');

    const mapEl = $('map');
    if (!mapEl) return;

    state.map.obj = L.map(mapEl).setView(CFG.mapCenter, CFG.mapZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(state.map.obj);

    state.map.layer = L.layerGroup().addTo(state.map.obj);
    logDiag('map: initialized');
  }

  function acresToRadiusMeters(acres) {
    if (!Number.isFinite(acres) || acres <= 0) return 150;
    const area = acres * 4046.86; // m^2
    const r = Math.sqrt(area / Math.PI);
    return Math.max(120, Math.min(CFG.bubbleClampMeters, r));
  }

  function groupForMap(rows) {
    // Group by city+spot to reflect "spot-level coverage"
    const m = new Map();
    for (const s of rows) {
      const key = `${s.city || ''}||${s.spot || ''}`.trim();
      if (!key.replace(/\|/g,'').trim()) continue;
      const g = m.get(key) || {
        key, city: s.city || '', spot: s.spot || '',
        sessions: [],
        farmers: 0, acres: 0,
        def: 0, may: 0, no: 0,
        latSum: 0, lonSum: 0, coordN: 0,
        minD: null, maxD: null,
        sns: new Set(),
      };
      g.sessions.push(s);
      if (Number.isFinite(s.farmers)) g.farmers += s.farmers;
      if (Number.isFinite(s.acres)) g.acres += s.acres;
      if (Number.isFinite(s.def)) g.def += s.def;
      if (Number.isFinite(s.may)) g.may += s.may;
      if (Number.isFinite(s.no)) g.no += s.no;
      if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) {
        g.latSum += s.lat; g.lonSum += s.lon; g.coordN += 1;
      }
      if (s.date) {
        if (!g.minD || s.date < g.minD) g.minD = s.date;
        if (!g.maxD || s.date > g.maxD) g.maxD = s.date;
      }
      if (Number.isFinite(Number(s.sn))) g.sns.add(Number(s.sn));
      m.set(key, g);
    }

    const groups = Array.from(m.values()).map(g => {
      const lat = g.coordN ? (g.latSum / g.coordN) : NaN;
      const lon = g.coordN ? (g.lonSum / g.coordN) : NaN;
      const defPct = pct(g.def, g.farmers);
      return Object.assign(g, { lat, lon, defPct });
    });

    // Stable ordering (largest acres first)
    groups.sort((a,b) => (b.acres || 0) - (a.acres || 0));
    return groups;
  }

  function renderMap() {
    if (!window.L) {
      showError('Map library not loaded', 'Leaflet failed to load from CDN.');
      return;
    }

    try {
      initMapIfNeeded();
    } catch (e) {
      showError('Failed to initialize map', e.message);
      return;
    }

    const layer = state.map.layer;
    layer.clearLayers();

    const groups = groupForMap(state.filtered).filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lon));
    if (!groups.length) {
      const legend = $('mapLegend');
      if (legend) legend.textContent = 'No valid coordinates for the current selection. Ensure SUM has a Spot Coordinates column (decimal or DMS).';
      return;
    }

    const latlngs = [];
    for (const g of groups) {
      const rMeters = acresToRadiusMeters(g.acres);

      const circle = L.circle([g.lat, g.lon], {
        radius: rMeters,
        color: 'rgba(134,239,172,.95)',
        weight: 2,
        fillColor: 'rgba(125,211,252,.35)',
        fillOpacity: 0.55
      });

      const dLabel = dateRangeLabel(g.minD, g.maxD);
      circle.bindPopup(
        `<b>${escapeHtml(g.spot || 'Spot')}</b><br/>` +
        `${escapeHtml(g.city || '')}<br/>` +
        `Farmers: ${fmtInt(g.farmers)}<br/>` +
        `Wheat acres: ${fmtInt(g.acres)}<br/>` +
        `Date: ${escapeHtml(dLabel)}`
      );
      circle.on('click', () => pinMapGroup(g));
      circle.addTo(layer);

      L.circleMarker([g.lat, g.lon], {
        radius: 4,
        color: 'rgba(231,237,247,.95)',
        weight: 1,
        fillOpacity: 1
      }).addTo(layer);

      latlngs.push([g.lat, g.lon]);
    }

    // Fit bounds
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) state.map.obj.fitBounds(bounds, { padding: [30, 30] });
  }

  function pinMapGroup(g) {
    state.map.pinnedKey = g.key;

    setText('mapSelTitle', `${g.city || '—'} • ${g.spot || '—'}`);
    setText('mapSelFarmers', fmtInt(g.farmers));
    setText('mapSelAcres', fmtInt(g.acres));
    setText('mapSelDate', dateRangeLabel(g.minD, g.maxD));

    // Showcase: prefer media by sessionId (SN)
    const sns = Array.from(g.sns || []);
    const rel = relatedMediaBySessionIds(sns);
    renderShowcase('mapShowcase', rel);

    if (rel.length) {
      // Keep pinned selection; do not auto-open lightbox
      logDiag(`map: pinned ${g.city} / ${g.spot} (media=${rel.length})`);
    } else {
      logDiag(`map: pinned ${g.city} / ${g.spot} (no media match)`);
    }
  }

  // ---- Sessions table ----
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
        // Pin map to this session's spot (group)
        const key = `${s.city || ''}||${s.spot || ''}`.trim();
        const groups = groupForMap(state.filtered);
        const g = groups.find(x => x.key === key);
        if (g) pinMapGroup(g);

        // Lightbox for this session by SN
        const sid = Number.isFinite(Number(s.sn)) ? Number(s.sn) : null;
        const rel = sid ? relatedMediaBySessionIds([sid]) : [];
        if (rel.length) openLightbox(rel, 0);
      });

      tb.appendChild(tr);
    }
  }

  // ---- Media: filtering + rendering ----
  function relatedMediaBySessionIds(ids) {
    const set = new Set((ids || []).filter(x => Number.isFinite(Number(x))).map(Number));
    if (!set.size) return [];

    const items = state.media.filter(m => m.sessionId && set.has(m.sessionId));
    return items;
  }

  function filteredMedia() {
    const rows = state.filtered;
    const ids = rows.map(s => s.sn).filter(n => Number.isFinite(Number(n))).map(Number);
    const set = new Set(ids);

    let items = state.media;
    if (set.size) items = items.filter(m => m.sessionId && set.has(m.sessionId));

    // search filter
    const q = (state.filter.q || '').toLowerCase();
    if (q) items = items.filter(m => (m.caption || '').toLowerCase().includes(q));

    return items;
  }

  function renderShowcases() {
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
      prev.className = 'showPrev';
      prev.src = item.src;
      prev.loading = 'lazy';
      if (item.type === 'video') {
        prev.muted = true;
        prev.playsInline = true;
        prev.preload = 'metadata';
      } else {
        prev.alt = item.alt || item.caption || 'media';
      }
      prev.addEventListener('error', () => {
        // Replace broken image with inline placeholder
        if (item.type !== 'video') {
          prev.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
               <rect width="640" height="480" fill="#0f1a2e"/>
               <text x="50%" y="50%" font-family="Arial" font-size="18" fill="#9fb0ca" text-anchor="middle" dy=".3em">Missing image</text>
             </svg>`
          );
        }
      });

      it.title = item.caption || '';
      it.appendChild(prev);
      it.addEventListener('click', () => openLightbox(items, idx));
      sc.appendChild(it);
    });
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
      prev.className = 'mediaPrev';
      prev.src = item.src;
      prev.loading = 'lazy';
      if (item.type === 'video') {
        prev.muted = true;
        prev.playsInline = true;
        prev.preload = 'metadata';
      } else {
        prev.alt = item.alt || item.caption || 'media';
      }
      prev.addEventListener('error', () => {
        if (item.type !== 'video') {
          prev.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
               <rect width="640" height="480" fill="#0f1a2e"/>
               <text x="50%" y="50%" font-family="Arial" font-size="18" fill="#9fb0ca" text-anchor="middle" dy=".3em">Missing image</text>
             </svg>`
          );
        }
      });

      const tag = document.createElement('div');
      tag.className = 'mediaTag';
      tag.textContent = item.caption || (item.sessionId ? `Session ${item.sessionId}` : 'Media');

      tile.appendChild(prev);
      tile.appendChild(tag);

      tile.addEventListener('click', () => openLightbox(items, i));
      gg.appendChild(tile);
    });
  }

  // ---- Export ----
  function exportFilteredCsv() {
    const rows = state.filtered;
    if (!rows.length) {
      setNotice('Nothing to export (no rows in the current filter).', true);
      return;
    }

    const header = ['Date','City','Spot','Farmers','Acres','Definite','Maybe','NotInterested','DefinitePct','AwarenessPct','ClarityPct','SN','SessionCode'];
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
        safeNum(s.sn),
        csvSafe(s.sessionCode),
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

  // ---- Hero video (optional) ----
  function initHeroVideo() {
    const v = $('heroVideo');
    if (!v) return;
    v.src = new URL(CFG.heroVideo, document.baseURI).toString();
    v.addEventListener('error', () => {
      v.style.display = 'none';
      logDiag(`heroVideo: not found (${CFG.heroVideo})`);
    });
  }

  // ---- Dependency wait ----
  function waitForDependencies() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (window.L && window.Chart && window.XLSX) return resolve();
        if (Date.now() - start > CFG.depTimeoutMs) {
          return reject(new Error('Dependencies did not load (Leaflet / Chart.js / XLSX). Check internet/CDN access.'));
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  // ---- Init ----
  async function init() {
    const loadingOverlay = $('loadingOverlay');
    const shell = document.querySelector('.shell');

    setText('buildStamp', 'v' + new Date().toISOString().slice(0,10));
    setNotice('Initializing…');

    try {
      updateLoadingStatus('Loading libraries…');
      await waitForDependencies();

      updateLoadingStatus('Setting up UI…');
      initTabs();
      initLightbox();
      initFilters();
      initHeroVideo();

      updateLoadingStatus('Loading workbook…');
      await loadWorkbook();

      updateLoadingStatus('Parsing workbook…');
      state.sessions = buildSessions(state.wb);
      state.farmers = buildFarmers(state.wb);
      logDiag(`workbook: sheets=${state.wb.SheetNames.length}, sessions=${state.sessions.length}, farmers=${state.farmers.length}`);

      updateLoadingStatus('Loading media…');
      await loadMedia();

      updateLoadingStatus('Building filters…');
      buildFilterOptions();

      state.filtered = state.sessions.slice();
      renderAll();

      setNotice('Ready.');
      logDiag('init: ready');

    } catch (e) {
      console.error(e);
      showError('Dashboard failed to initialize', e.message || String(e));
      // Render minimal empty UI to avoid blank page
      state.sessions = state.sessions || [];
      state.filtered = state.sessions.slice();
      renderAll();
    } finally {
      // Show UI even if there were errors (so user can see diagnostics)
      if (shell) shell.style.display = 'grid';
      if (loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 280);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
