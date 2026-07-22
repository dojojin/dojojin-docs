// ============================================================
// Vigil Platform — Frontend
// CCTV Analytics & Management Suite
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ============================================================
// Features:
// - Camera groups (create/edit/delete + tabs)
// - Map: heatmap toggle + hover popup + offline cache
// - Stats: KPI + Timeline (Total + Alerts) + Breakdown table + 3D Pie
// 🔐 With User Authentication
// ============================================================

// Chart.js's own default font ('Helvetica Neue'/Arial) has no Thai glyphs —
// canvas text doesn't inherit page CSS, so every chart was silently falling
// back through the browser's own font substitution for Thai labels. That
// substitution is inconsistent between the font used to MEASURE label width
// (layout) and the font actually used to DRAW it, especially on iOS Safari —
// symptom: Thai y-axis labels clipped to ~2 characters while Latin labels
// (e.g. "Toyota") in the same chart render fine. Point Chart.js at the same
// self-hosted stack the page itself uses (index.css --ui-font-family) so
// measurement and draw agree. Must run before any chart is created —
// Chart.js loads before this file (index.html), so this covers every page.
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'Noto Sans Thai', 'Noto Sans', -apple-system, 'Segoe UI', system-ui, sans-serif";
}

// 🔐 Token storage helper (Safari ITP fallback)
const TOKEN_KEY = 'bosch_session_token';
function getStoredToken() {
  // ลอง localStorage ก่อน → sessionStorage → null
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    if (v) return v;
  } catch {}
  try {
    const v = sessionStorage.getItem(TOKEN_KEY);
    if (v) return v;
  } catch {}
  return null;
}
function setStoredToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// 🆕 รับ token จาก URL hash (จากการ redirect หลัง login) — กัน Safari ITP
(function importTokenFromHash() {
  if (window.location.hash && window.location.hash.startsWith('#t=')) {
    const token = decodeURIComponent(window.location.hash.slice(3));
    if (token) {
      setStoredToken(token);
      console.log('🔐 Token imported from URL hash → localStorage');
    }
    // Clean URL — ลบ hash ออก (สำคัญ: ห้าม token อยู่ใน URL bar)
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
})();

// 🔍 Auditor (read-only) flag — set at login. The fetch wrapper below
// short-circuits write attempts client-side for instant feedback; the
// server enforces it for real (403 read_only) regardless.
let _isAuditor = false;

// 🔐 Global fetch wrapper — auto include credentials + Authorization + handle 401 + timeout
const _origFetch = window.fetch;

// A 401 during an api-server restart / DB warm-up is transient — the session is
// still valid, the origin was just briefly unreachable. The dashboard fires many
// concurrent polls, so previously EVERY one that 401'd called location.href,
// flickering the login page rapidly on each deploy. Guard: at most one redirect,
// and only after a single re-check against /api/auth/me confirms the session is
// genuinely dead (uses _origFetch so it isn't re-wrapped / recursive).
let _authRedirecting = false;
async function _handle401() {
  if (_authRedirecting) return;                 // one redirect max — kills the rapid flicker
  _authRedirecting = true;
  try {
    const check = await _origFetch('/api/auth/me', { credentials: 'include' });
    if (check.ok) { _authRedirecting = false; return; }   // session still valid → spurious 401, stay put
  } catch {
    _authRedirecting = false; return;           // origin unreachable → transient, don't log the user out
  }
  console.warn('🔐 session invalid — redirecting to login');
  setStoredToken(null);
  window.location.href = '/login.html';
}
window.fetch = (url, opts = {}) => {
  // Auditor — block writes before they leave the browser (server also rejects).
  const _m = (opts.method || 'GET').toUpperCase();
  if (_isAuditor && _m !== 'GET' && _m !== 'HEAD'
      && !String(url).includes('/api/auth/')) {
    if (typeof showToast === 'function') {
      showToast({ icon: '🔍', title: I18N.t('aux.auditorToastTitle'), sub: I18N.t('aux.auditorToastSub') });
    }
    return Promise.resolve(new Response(
      JSON.stringify({ error: 'read_only', message: 'auditor read-only' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }));
  }
  // เพิ่ม timeout สำหรับ Safari ที่บางทีค้าง
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  // เพิ่ม Authorization header ถ้ามี token ใน localStorage
  const headers = new Headers(opts.headers || {});
  const token = getStoredToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return _origFetch(url, {
    credentials: 'include',
    signal: opts.signal || controller.signal,
    ...opts,
    headers,
  })
  .then(res => {
    clearTimeout(timeoutId);
    if (res.status === 401 && !String(url).includes('/api/auth/')) {
      _handle401();   // dedupe + re-validate before logging out (transient-restart tolerant)
    }
    // Phase 8.0 — surface license-required errors immediately. When the
    // backend's write-blocking middleware refuses a write because the
    // license is expired/invalid, pop the License modal so the operator
    // can paste a fresh key without hunting through menus.
    if (res.status === 403 && !String(url).includes('/api/license/')) {
      res.clone().json().then(body => {
        if (body && body.error === 'license_required') {
          // license is a Settings section now — navigate there (idempotent)
          sessionStorage.removeItem(_LICENSE_AUTO_POPUP_KEY);
          if (typeof openLicenseModal === 'function') openLicenseModal();
        }
      }).catch(() => {});
    }
    return res;
  })
  .catch(err => {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('🔐 Request timeout:', url);
    }
    throw err;
  });
};

const API = '';

// Design token helper — reads CSS custom property at call time
// so Chart.js + OpenLayers colours stay in sync with the token system.
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function setTheme(t) {
  try { localStorage.setItem('dashboard_theme', t); } catch(e) {}
  location.reload();
}

// Shared Chart.js tooltip defaults — keeps all charts visually consistent
// without repeating 4 hardcoded colours per chart.
const chartTooltip = () => ({
  backgroundColor: token('--surface-elevated'),
  titleColor:      token('--text-primary'),
  bodyColor:       token('--text-primary'),
  borderColor:     token('--accent') + '4d',
  borderWidth: 1,
});

let currentUser = null;
let cameras = [];
let allEvents = [];
let groups = [];
let activeGroupId = 'all';
let map = null;
let mapLayers = {};
let mapShowHeat = true;
let mapShowCams = true;
let mapPopupTimer = null;
let hiddenGroupIds = new Set();
const _mapPulseState = new Map(); // camera_id → { el, lastAt, bumpCount, timeoutId }
let _mapPulseOn = JSON.parse(localStorage.getItem('mapLivePulseOn') ?? 'true');
let _mapPulseDebounceMs = parseInt(localStorage.getItem('mapLivePulseDebounceMs') || '15000', 10);
const _mapFaceCardList = []; // [{ el, camera_id, timeoutId }]
let _mapFaceOn = JSON.parse(localStorage.getItem('mapFaceOverlayOn') ?? 'true');
const _mapLprCardList = []; // plate-read plaques in the left side list
let _mapLprOn = JSON.parse(localStorage.getItem('mapLprOverlayOn') ?? 'true');
let _faceJumpCamera = null; // set by map face card click; consumed by loadFaces()
let _mapWallOn = JSON.parse(localStorage.getItem('mapWallMode') ?? 'false');
let tlChart = null;
// Per-camera bar charts. Keyed map (not loose vars) because the matching
// <canvas id> elements get auto-exposed on window in browsers, which would
// otherwise shadow `window.peopleCamChart` etc. with the DOM node.
const _camChartReg = { people: null, vehicle: null };
let currentStatsRange = '1d';
let currentEventTab = 'all';
let currentSnapView = 'grid';
let snapshots = [];
let currentReportData = null;

// Group editor state
let editingGroupId = null;
let editorSelectedCams = new Set();

// ============================================================
// Pagination helper (Phase 6.1.7)
// ────────────────────────────────────────────────────────────
// Reusable paginator for any list page (Snapshot, Media, Events,
// Alert Logs). Server returns X-Total-Count header; frontend
// renders [‹ Prev] [1] [2] [3] ... [N] [Next ›] + range label.
//
// Strategy: page size 20, no hard cap — DB index keeps OFFSET fast.
// Soft hint when total > 1000 nudges user to narrow filters.
// ============================================================

const PAGE_SIZE = 20;

// Compute the ellipsis-style page list:
// 1 of 5  → [1] [2] [3] [4] [5]
// 1 of 50 → [1] [2] [3] [4] [5] ... [50]
// 25/50   → [1] ... [23] [24] [25] [26] [27] ... [50]
function _paginationItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items = [1];
  const start = Math.max(2, current - 2);
  const end   = Math.min(total - 1, current + 2);
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
}

// Render pagination control + range/total label into a container.
//   container — DOM element (or id) where the control mounts
//   currentPage — 1-based
//   totalCount — total rows server-side
//   pageSize — typically PAGE_SIZE
//   onPage(page) — callback when user clicks a page
//   label — optional Thai noun ("snapshot", "clip", "event")
// ── Searchable combobox (Phase C.7) ────────────────────────────
// Progressive enhancement for a native <select>: wraps it with a styled
// button + a popup containing a search input and a filtered options
// list. Underlying <select> stays in the DOM (visually hidden) as the
// source of truth so existing code reading .value / .selectedIndex /
// listening for 'change' is untouched. MutationObserver re-syncs the
// label whenever the caller rebuilds the options (the common pattern is
// `select.innerHTML = '...'` inside renderXxx).
function enhanceSelectSearchable(selectEl, opts = {}) {
  if (!selectEl || selectEl.dataset.enhanced) return;
  selectEl.dataset.enhanced = '1';
  const placeholder = opts.placeholder || I18N.t('aux.searchPlaceholder');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:100%';
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);
  // Visually hide but keep accessible — same trick as a screen-reader-only
  // utility class. The <select> is still focusable and form-submittable.
  selectEl.style.cssText += ';position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'form-input';
  btn.style.cssText = 'width:100%;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px';
  btn.innerHTML = '<span class="cmb-label">…</span><span style="color:var(--text-secondary);font-size:10px">▼</span>';
  wrapper.appendChild(btn);

  const drop = document.createElement('div');
  drop.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:200;display:none';
  drop.innerHTML =
    `<input type="search" class="cmb-search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"
       style="width:100%;border:none;border-bottom:1px solid var(--border-hairline);background:transparent;padding:8px 12px;color:var(--text-primary);font-size:13px;box-sizing:border-box;outline:none">
     <div class="cmb-list" style="max-height:280px;overflow-y:auto"></div>`;
  wrapper.appendChild(drop);

  const labelEl  = btn.querySelector('.cmb-label');
  const searchEl = drop.querySelector('.cmb-search');
  const listEl   = drop.querySelector('.cmb-list');

  function refreshLabel() {
    const opt = selectEl.options[selectEl.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : '—';
  }
  function renderList(q) {
    q = (q || '').trim().toLowerCase();
    const items = [];
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      const text = opt.textContent || '';
      if (q && !text.toLowerCase().includes(q)) continue;
      const isSel = i === selectEl.selectedIndex;
      items.push(
        `<div class="cmb-opt" data-i="${i}" style="padding:8px 12px;cursor:pointer;font-size:13px;${
          isSel ? 'background:rgba(91,141,239,0.15);color:var(--accent)' : ''
        }">${escapeHtml(text)}</div>`);
    }
    listEl.innerHTML = items.length
      ? items.join('')
      : `<div style="padding:14px;color:var(--text-secondary);font-size:12px;text-align:center">${escapeHtml(I18N.t('aux.noMatchItems'))}</div>`;
  }
  function open()  { drop.style.display = 'block'; searchEl.value = ''; renderList(''); setTimeout(() => searchEl.focus(), 10); }
  function close() { drop.style.display = 'none'; }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    drop.style.display === 'none' ? open() : close();
  });
  searchEl.addEventListener('input', () => renderList(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus(); }
  });
  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.cmb-opt');
    if (!item) return;
    const idx = parseInt(item.dataset.i, 10);
    if (!Number.isFinite(idx)) return;
    selectEl.selectedIndex = idx;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    refreshLabel();
    close();
  });
  document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) close(); });

  // Keep label in sync when caller code rebuilds options (`select.innerHTML
  // = '...'`) — the most common pattern in this dashboard.
  new MutationObserver(refreshLabel).observe(selectEl, { childList: true, subtree: true });
  selectEl.addEventListener('change', refreshLabel);
  refreshLabel();
}

// Apply searchable combobox to every camera-related dropdown that can grow
// long on a 100+ camera deployment. Called once at startup; the helper is
// idempotent (dataset.enhanced gate) so re-calls during nav are safe.
function enhanceCameraDropdowns() {
  ['evtFilterCam', 'snapFilterCam', 'mediaFilterCam', 'occTlCamRule', 'occHmCamRule']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) enhanceSelectSearchable(el, { placeholder: I18N.t('aux.searchCamRule') });
    });
}

function renderPagination(container, currentPage, totalCount, pageSize, onPage, label = I18N.t('aux.paginationLabel')) {
  const el = (typeof container === 'string') ? document.getElementById(container) : container;
  if (!el) return;
  const total = Math.max(0, totalCount | 0);
  const ps = pageSize || PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const cp = Math.min(Math.max(1, currentPage | 0), totalPages);
  const from = total === 0 ? 0 : (cp - 1) * ps + 1;
  const to   = Math.min(cp * ps, total);

  if (total === 0) { el.innerHTML = ''; return; }

  const btn = (page, text) => {
    const dis = page === cp;
    const cls = dis ? 'pg-btn pg-current' : 'pg-btn';
    return `<button class="${cls}" ${dis ? 'disabled' : ''} data-action="pgGo" data-pg="${el.id}" data-page="${page}">${text}</button>`;
  };
  // Stash callback under a global so dispatcher can reach it
  window._pgHandlers = window._pgHandlers || {};
  window._pgHandlers[el.id] = onPage;

  const items = _paginationItems(cp, totalPages);
  const itemsHtml = items.map(i =>
    i === '…' ? `<span class="pg-dot">…</span>` :
    btn(i, String(i))
  ).join('');

  const hint = total > 1000
    ? `<span style="color:var(--warn);font-size:10px;margin-left:8px" title="${escapeHtml(I18N.t('aux.manyResultsTip'))}">${escapeHtml(I18N.t('aux.manyResults'))}</span>` : '';

  el.innerHTML = `
    <div class="pg-bar">
      <div class="pg-controls">
        <button class="pg-btn" ${cp === 1 ? 'disabled' : ''} data-action="pgGo" data-pg="${el.id}" data-page="${cp - 1}">‹ Prev</button>
        ${itemsHtml}
        <button class="pg-btn" ${cp === totalPages ? 'disabled' : ''} data-action="pgGo" data-pg="${el.id}" data-page="${cp + 1}">Next ›</button>
      </div>
      <div class="pg-range">${from.toLocaleString()}-${to.toLocaleString()} / ${total.toLocaleString()} ${label}${hint}</div>
    </div>`;
}

// ============================================================
// Flatpickr — locked 24h datetime picker
// ────────────────────────────────────────────────────────────
// Why: Chromium on Windows ignores the input's `lang` attribute
// for <input type="datetime-local"> and falls back to the OS
// "Short time" format (which is 12h on most Thai installs).
// Air Datepicker replaces the browser-native picker with a controlled
// widget that renders 24h time regardless of OS/browser locale.
// ────────────────────────────────────────────────────────────
// Machine values are read via getDtValue() — wall-clock strings without
// timezone offset. Display format (dateFormat) is for the visible input only.
// ============================================================
// Inputs grouped by what kind of picker each needs.
// All three groups share setDtValue/getDtValue helpers.
// ⚠️ EVERY datetime input on the dashboard must be listed here so
// initDateTimePickers() enhances it with AirDatepicker — never leave a
// raw <input type="datetime-local"> (Chromium-on-Windows renders it
// 12h, ignoring lang). Add a new id here the moment you add the input.
const _DT_DATETIME_IDS = ['evtFilterFrom', 'evtFilterTo', 'snapFilterFrom', 'snapFilterTo', 'crFrom', 'crTo', 'reportFrom', 'reportTo', 'hrRangeFrom', 'hrRangeTo', 'mediaFilterFrom', 'mediaFilterTo', 'faceFilterFrom', 'faceFilterTo', 'faceFilterFrom2', 'faceFilterTo2', 'fmatchFilterFrom', 'fmatchFilterTo', 'lprFilterFrom', 'lprFilterTo', 'lprPeriodFrom', 'lprPeriodTo', 'facePeriodFrom', 'facePeriodTo', 'lprNoReadFrom', 'lprNoReadTo'];
const _DT_DATE_IDS     = ['reportDate', 'reportWeekDate', 'rbFrom', 'rbTo', 'rptLprFrom', 'rptLprTo', 'rptFaceFrom', 'rptFaceTo', 'rptHrFrom', 'rptHrTo'];
const _DT_MONTH_IDS    = ['reportMonth'];

function initDateTimePickers() {
  if (typeof AirDatepicker === 'undefined') {
    console.warn('AirDatepicker not loaded — datetime inputs fall back to native picker');
    return;
  }
  const lang = (typeof I18N !== 'undefined' && I18N.getLang()) || 'th';
  const locale = lang === 'th' ? _ADP_LOCALE_TH : _ADP_LOCALE_EN;
  // isMobile:true on ≤768px → ADP renders as modal overlay (handles keyboard + viewport clipping).
  const _adpMobile = window.innerWidth <= 768;
  const baseOpts = { ...(locale ? { locale } : {}), isMobile: _adpMobile, position: 'bottom left' };

  // 1) Datetime inputs (filter from/to, custom range, report custom, health report)
  for (const id of _DT_DATETIME_IDS) {
    const el = document.getElementById(id);
    if (!el || el._adp) continue;
    el._adp = new AirDatepicker(el, {
      ...baseOpts,
      timepicker: true,
      dateFormat: 'dd/MM/yyyy',
      timeFormat: 'HH:mm',
    });
  }

  // 2) Date-only inputs (Report Daily / Weekly anchor date)
  for (const id of _DT_DATE_IDS) {
    const el = document.getElementById(id);
    if (!el || el._adp) continue;
    el._adpDateOnly = true;
    el._adp = new AirDatepicker(el, {
      ...baseOpts,
      dateFormat: 'dd/MM/yyyy',
    });
  }

  // 3) Month picker (Report Monthly) — view:'months' keeps it at month level
  for (const id of _DT_MONTH_IDS) {
    const el = document.getElementById(id);
    if (!el || el._adp) continue;
    el._adpIsMonth = true;
    el._adp = new AirDatepicker(el, {
      ...baseOpts,
      view: 'months',
      minView: 'months',
      dateFormat: 'MM/yyyy',
    });
  }
}

// Setter helper — keeps the visible input in sync with the AirDatepicker instance.
// Plain el.value assignment is the native-input fallback.
function setDtValue(idOrEl, date) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return;
  if (el._adp) {
    if (date == null || date === '') el._adp.clear();
    else el._adp.selectDate(date instanceof Date ? date : new Date(date), { silent: true });
    return;
  }
  // Fallback (AirDatepicker not yet loaded): write naive ISO-local string
  if (date == null || date === '') { el.value = ''; return; }
  const d = (date instanceof Date) ? date : new Date(date);
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  el.value = z.toISOString().slice(0, 16);
}
function clearDtValue(idOrEl) { setDtValue(idOrEl, ''); }

// Returns the selected date as a machine-format wall-clock string — never a
// timezone-shifted toISOString(). Reads _adp.selectedDates[0]; falls back to
// el.value for native inputs (AirDatepicker not yet loaded). "" = nothing selected.
function getDtValue(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return '';
  if (el._adp) {
    const d = el._adp.selectedDates?.[0];
    if (!d) return '';
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (el._adpIsMonth)   return `${d.getFullYear()}-${mo}`;
    if (el._adpDateOnly)  return `${d.getFullYear()}-${mo}-${dd}`;
    return `${d.getFullYear()}-${mo}-${dd}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return (el.value || '').trim();
}

// Page titles are i18n keys now — see page.* in i18n.js. showPage()
// resolves the topbar title via I18N.t('page.' + name).

// Vendor display labels — shared by the camera settings list + status pages.
const VENDOR_LABEL = { bosch: 'Bosch', hikvision: 'Hikvision', dahua: 'Dahua', onvif: 'ONVIF' };

const COLORS = ['#5b8def', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#06b6d4', '#ec4899', '#10b981', '#f97316', '#8b5cf6'];

// Bosch camera-side analytics events — these fire AUTOMATICALLY when the
// camera detects a condition (over-bright frame, blur, scene change, I/O
// trigger), so they carry no rule_name and event_type.split('/').pop()
// would just give the useless "&1" suffix. Map the first path segment of
// event_type to a Thai display label.
const EVENT_TYPE_LABELS = {
  ImageTooBright:    I18N.t('etl.ImageTooBright'),
  ImageTooBlurry:    I18N.t('etl.ImageTooBlurry'),
  ImageTooDark:      I18N.t('etl.ImageTooDark'),
  GlobalSceneChange: I18N.t('etl.GlobalSceneChange'),
  // Digital I/O triggers — wording kept generic; what they mean depends on
  // what the operator has physically wired to each input/relay.
  'Trigger/DigitalInput': I18N.t('etl.TriggerDigitalInput'),
  'Trigger/Relay':        I18N.t('etl.TriggerRelay'),
  anprAlarm:              I18N.t('etl.anprAlarm'),
};

function eventTypeLabel(eventType) {
  if (!eventType) return '—';
  const head = eventType.split('/')[0];
  // Trigger/* needs two segments to disambiguate Input vs Relay
  const twoSeg = eventType.split('/').slice(0, 2).join('/');
  return EVENT_TYPE_LABELS[twoSeg]
      || EVENT_TYPE_LABELS[head]
      || eventType.split('/').pop()
      || '—';
}

function eventDisplayName(ev) {
  if (ev.rule_name && ev.rule_name.trim()) return ev.rule_name;
  return eventTypeLabel(ev.event_type);
}

// Get cameras in active group
function getActiveGroupCameras() {
  if (activeGroupId === 'all') return cameras;
  const g = groups.find(x => x.id === activeGroupId);
  if (!g) return cameras;
  return cameras.filter(c => g.cameraIds.includes(c.camera_id));
}

function getActiveGroupCameraIds() {
  return getActiveGroupCameras().map(c => c.camera_id);
}

// Site-scope a camera list for the per-page picker dropdowns — so a camera from
// another site never appears while a site is selected (the query params are
// already site-filtered; this keeps the DROPDOWN consistent). null site = no
// restriction. Composes with whatever list is passed (group/role pre-filtered).
function siteScopedCams(list, siteId) {
  return siteId ? list.filter(c => c.site_id === siteId) : list;
}

// (Re)fill a camera <select> from `list`. opts.allOption prepends a "ทั้งหมด"
// entry (native single-selects); opts.multiPicker refreshes the MultiPicker
// after. Rebuilds innerHTML each call — used both on first populate and on site
// change (a fresh site resets the camera selection, which is the intent).
function fillCameraSelect(selId, list, opts = {}) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const all = opts.allOption ? `<option value="">${I18N.t('common.all')}</option>` : '';
  sel.innerHTML = all + list.map(c => `<option value="${escapeHtml(c.camera_id)}">${escapeHtml(c.camera_name || c.camera_id)}</option>`).join('');
  if (opts.multiPicker && typeof MultiPicker !== 'undefined') MultiPicker.refresh(selId);
}

// ── Site filter — shared across Events/Snapshot/Media, same "one state
// reflected everywhere" model as activeGroupId (unlike Map/Face/Appearance,
// which each keep their own independent site state). Composes with the
// group filter: both narrow the same cameras= list sent to the backend. ──
let _opActiveSiteId = null;

function renderOpSitePills() {
  ['opSitePillsEvents', 'opSitePillsSnap', 'opSitePillsMedia'].forEach(id => {
    renderSitePills(id, _opActiveSiteId, 'setOpActiveSite');
  });
}

// Returns null (no restriction), or an array of camera_ids — possibly
// empty when the group+site combination matches no camera. Callers must
// treat an empty (but non-null) array as "match nothing", not "no filter".
function getActiveScopedCameraIds() {
  let ids = activeGroupId !== 'all' ? getActiveGroupCameraIds() : null;
  if (_opActiveSiteId) {
    const siteIds = cameras.filter(c => c.site_id === _opActiveSiteId).map(c => c.camera_id);
    ids = ids ? ids.filter(id => siteIds.includes(id)) : siteIds;
  }
  return ids;
}

function setOpActiveSite(sid) {
  _opActiveSiteId = sid ? Number(sid) : null;
  renderOpSitePills();
  // Rescope the camera dropdowns to the new site (resets camera selection to
  // "ทั้งหมด"; leaves category/rule filters untouched).
  const camList = siteScopedCams(getActiveGroupCameras(), _opActiveSiteId);
  fillCameraSelect('evtFilterCam',   camList, { allOption: true });
  fillCameraSelect('snapFilterCam',  camList, { allOption: true });
  fillCameraSelect('mediaFilterCam', camList, { allOption: true });
  const activePage = document.querySelector('.page.active')?.id.replace('page-', '');
  if (activePage === 'events')    loadEvents();
  if (activePage === 'snapshots') loadSnapshots();
  if (activePage === 'media')     loadMedia();
}

// ============================================================
// Page routing
// ============================================================

function showPage(name, navItem) {
  if (name === 'alerts') name = 'history';
  if (name !== 'map') { _clearAllMapPulseCards(); _clearAllMapFaceCards(); document.body.classList.remove('map-wall-mode'); }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (navItem) navItem.classList.add('active');
  document.getElementById('pageTitle').textContent = I18N.t('page.' + name, name);
  closeSidebar(); // auto-close on mobile after nav

  renderGroupBars();

  if (name === 'map') {
    if (!map) initMap();
    setTimeout(() => {
      document.body.classList.toggle('map-wall-mode', _mapWallOn);
      document.getElementById('btnWallMode')?.classList.toggle('active', _mapWallOn);
      if (map) map.updateSize();
      // อัพเดทปุ่ม style + source + provider ให้ตรงกับ state ปัจจุบัน
      const styleBtn = document.getElementById('togStyle');
      if (styleBtn && mapLayers._currentStyle) {
        setMapToggleLabel(styleBtn, 'icon-layers', mapLayers._currentStyle === 'streets' ? 'STREETS' : 'LIGHT');
      }
      const srcBtn = document.getElementById('togSource');
      if (srcBtn && mapLayers._currentSource) {
        setMapToggleLabel(srcBtn, 'icon-globe', mapLayers._currentSource === 'online' ? 'ONLINE' : 'OFFLINE');
      }
      const provBtn = document.getElementById('togProvider');
      if (provBtn && mapLayers._currentProvider) {
        setMapToggleLabel(provBtn, 'icon-layers', mapLayers._currentProvider === 'carto' ? 'CARTO' : 'MAPBOX');
      }
      renderMapLegend();
      renderMapSiteFilter();
      refreshMap();
      // Sync pulse controls with persisted state.
      const pulseBtn = document.getElementById('btnMapPulse');
      if (pulseBtn) { pulseBtn.setAttribute('aria-pressed', String(_mapPulseOn)); pulseBtn.classList.toggle('active', _mapPulseOn); }
      const pulseSel = document.getElementById('selMapPulseDebounce');
      if (pulseSel) pulseSel.value = String(_mapPulseDebounceMs);
      const faceBtn = document.getElementById('btnMapFace');
      if (faceBtn) { faceBtn.setAttribute('aria-pressed', String(_mapFaceOn)); faceBtn.classList.toggle('active', _mapFaceOn); }
    }, 50);
  }
  if (name === 'stats') {
    setTimeout(() => loadStats(), 100);
  }
  if (name === 'reports') {
    initReportsRedesign();
    onReportTypeChange();              // sets default date for active type + shows the right field group
    initReportCategoryFilter();        // load categories into filter dropdown
  }
  if (name === 'events') { populateEventFilters(); loadEvents(); clearNavBadge('events'); }
  if (name === 'snapshots') { populateSnapFilters(); loadSnapshots(); }
  if (name === 'media') { populateMediaFilters(); loadMedia(); }
  if (name === 'face-matches') { _loadFaceCounts(); _switchFaceTab('overview'); clearNavBadge('face-matches'); }
  if (name === 'appearance') {
    clearNavBadge('appearance');
    _initAppCamDropdown(); _initAppDatePickers();
    setAppTab('overview', document.querySelector('#page-appearance .tabs .tab'));
    // Set today default range on first enter (pickers must exist before selectDate)
    const defBtn = document.querySelector('#page-appearance .per-btn[data-range="today"]');
    setAppRange('today', defBtn);
  }
  if (name === 'lpr') { _lprInitPage(); clearNavBadge('lpr'); }
  if (name === 'cameras') { loadCameras(); refreshTodayCounts(); startTodayCountsAutoRefresh(); }
  if (name === 'map') startMapAutoRefresh(); else stopMapAutoRefresh();
  if (name === 'summary') {
    _summaryMapCentered = false;   // re-focus newest camera on each page-enter
    _summaryHideMapPopup();
    loadSummary();
    startSummaryAutoRefresh();
    // OpenLayers may have cached 0×0 if the page was display:none at init.
    // Force a remeasure once the layout has settled.
    setTimeout(() => _summaryMapInstance && _summaryMapInstance.updateSize(), 80);
  } else {
    stopSummaryAutoRefresh();
  }
  if (name === 'history') {
    document.querySelector('.history-wrap')?.classList.remove('sw-detail');
    historyNav('alerts', null, { noDrill: true });
  }
  if (name === 'health') { loadHealth(); startHealthAutoRefresh(); }
  else { stopHealthAutoRefresh(); }
  if (name === 'settings') {
    // mobile drill-down: always land on the rail (list), not a section
    document.querySelector('#page-settings .settings-wrap')?.classList.remove('sw-detail');
    settingsNav('cameras', null, { noDrill: true });
  }
}

// ============================================================
// History Workspace — consolidated logs and history sections.
// ============================================================
function historyNav(key, el, opts) {
  opts = opts || {};
  const wrap = document.querySelector('.history-wrap');
  const sec = document.getElementById('hist-' + key);
  if (!sec) return;

  document.querySelectorAll('.history-rail .srail-item').forEach(n => n.classList.remove('active'));
  (el || document.querySelector(`.history-rail .srail-item[data-hist="${key}"]`))?.classList.add('active');
  document.querySelectorAll('.history-section').forEach(s => s.classList.remove('active'));
  sec.classList.add('active');
  if (wrap && !opts.noDrill) wrap.classList.add('sw-detail');

  if (key === 'alerts') loadAlertLogs();
  else if (key === 'reports') loadReportHistory(0);
  else if (key === 'camera-status') {
    if (!cameras.length) loadCameras().finally(() => setCameraStatusTab('current'));
    else setCameraStatusTab('current');
  } else if (key === 'audit') {
    loadAuditLog().catch(() => {});
  } else if (key === 'sessions') {
    loadSessions().catch(() => {});
  }
}

function historyBack() {
  document.querySelector('.history-wrap')?.classList.remove('sw-detail');
}

// ============================================================
// Settings Workspace — left sub-nav rail (Stage 1).
// Sections with an inline #set-<key> div show in the content area;
// the rest still open as their legacy modal until later stages
// migrate them inline. On mobile (<=768px) the rail + content are a
// drill-down: tapping a section enters the detail view (.sw-detail),
// settingsBack() returns to the rail list.
// ============================================================
function settingsNav(key, el, opts) {
  opts = opts || {};
  // Groups is now a sub-tab under Cameras — redirect transparently
  if (key === 'groups') {
    settingsNav('cameras', document.querySelector('#page-settings .srail-item[data-sec="cameras"]'), opts);
    camerasSubTab('groups', document.getElementById('camSubTabGroups'));
    return;
  }
  const wrap = document.querySelector('#page-settings .settings-wrap');
  const sec = document.getElementById('set-' + key);
  if (sec) {
    document.querySelectorAll('#page-settings .settings-rail .srail-item').forEach(n => n.classList.remove('active'));
    (el || document.querySelector(`#page-settings .srail-item[data-sec="${key}"]`))?.classList.add('active');
    document.querySelectorAll('#page-settings .settings-section').forEach(s => s.classList.remove('active'));
    sec.classList.add('active');
    if (wrap && !opts.noDrill) wrap.classList.add('sw-detail');   // mobile: into detail
    // populate the section's data (each loader targets IDs preserved
    // from the old modal, so the render code is unchanged)
    if      (key === 'cameras')    { camerasSubTab('cameras'); }
    else if (key === 'system')     { loadSystemSettings().catch(e => alert(I18N.t('aux.loadSettingsFailed') + e.message)); }
    else if (key === 'users')      { loadUsers().catch(() => {}); }
    else if (key === 'categories') { loadCategories().catch(e => alert(I18N.t('aux.loadCategoriesFailed') + e.message)); }
    else if (key === 'license')    {
      const lb = document.getElementById('licenseModalBody');
      if (lb) lb.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
      refreshLicenseStatus().then(s => renderLicenseModalContent(s)).catch(() => {});
    }
    else if (key === 'audit')      { loadAuditLog().catch(() => {}); }
    else if (key === 'sessions')   { loadSessions().catch(() => {}); }
    else if (key === 'backup')     { loadBackups().catch(() => {}); }
    else if (key === 'map')        { onShowMapSettings().catch(() => {}); }
    else if (key === 'alerts')     { switchAlertTab('rules'); _reflectNotifyPrefs(); }
    else if (key === 'lpr')        { loadLprSettings().catch(() => {}); }
    return;
  }
  // Not yet inlined — open the legacy window (rail highlight unchanged).
}

// ============================================================
// Settings › Backup / Restore (Stage 4a)
// ============================================================
async function loadBackups() {
  const el = document.getElementById('backupList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/backups`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { backups } = await res.json();
    renderBackupList(backups || []);
  } catch (e) {
    el.innerHTML = `<div style="padding:18px;color:var(--warn);font-size:12px">${escapeHtml(I18N.t('bk.loadListFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function renderBackupList(backups) {
  const el = document.getElementById('backupList');
  if (!el) return;
  if (!backups.length) {
    el.innerHTML = `<div style="padding:18px;color:var(--text-secondary);font-size:12px">${escapeHtml(I18N.t('bk.noFiles'))}</div>`;
    return;
  }
  el.innerHTML = backups.map(b => {
    const sz = b.size > 1048576 ? (b.size / 1048576).toFixed(1) + ' MB' : Math.round(b.size / 1024) + ' KB';
    const dt = new Date(b.mtime).toLocaleString('th-TH', { hour12: false });
    return `<div class="bk-row">
      <span class="bk-name">${escapeHtml(b.filename)}</span>
      <span style="color:var(--text-secondary)">${dt}</span>
      <span style="color:var(--text-secondary);min-width:62px;text-align:right">${sz}</span>
      <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" data-action="downloadBackup" data-filename="${escapeHtml(b.filename)}">${escapeHtml(I18N.t('bk.download'))}</button>
    </div>`;
  }).join('');
}

async function runBackup() {
  const btn = document.getElementById('backupRunBtn');
  const msg = document.getElementById('backupRunMsg');
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('bk.backingUp'); }
  if (msg) { msg.style.color = 'var(--text-secondary)'; msg.textContent = I18N.t('bk.runningPgDump'); }
  try {
    const res = await fetch(`${API}/api/backups/run`, { method: 'POST' });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || !r.ok) throw new Error(r.error || 'HTTP ' + res.status);
    if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('bk.backupOk'); }
    await loadBackups();
  } catch (e) {
    if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = I18N.t('bk.backupFail') + e.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = I18N.t('bk.runNow'); }
  }
}

// Download via fetch (auth header) → blob — works behind Safari ITP
// where a plain <a href> to an auth-gated route would lose the cookie.
async function downloadBackup(filename) {
  try {
    const res = await fetch(`${API}/api/backups/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { alert(I18N.t('bk.downloadFailed') + e.message); }
}

// Mobile drill-down — return from a section (detail) to the rail (list).
function settingsBack() {
  document.querySelector('#page-settings .settings-wrap')?.classList.remove('sw-detail');
}

// ============================================================
// WebSocket
// ============================================================

// ============================================================
// Notifications — toast (corner popup) + nav badge
// ============================================================
// Surfaces a new incident event while the user is on another page.
// Only events that carry a rule_name (real incidents) fire a toast —
// metric/analytics events never do (would spam).
const _navBadge = { events: 0, faces: 0, 'face-matches': 0, appearance: 0, lpr: 0 };

function renderNavBadge(key) {
  const el = document.getElementById('badge-' + key);
  if (!el) return;
  const n = _navBadge[key] || 0;
  if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.classList.add('show'); }
  else       { el.classList.remove('show'); }
}
function bumpNavBadge(key)  { _navBadge[key] = (_navBadge[key] || 0) + 1; renderNavBadge(key); }
function clearNavBadge(key) { _navBadge[key] = 0; renderNavBadge(key); }

// Pop-up notification preference (per-browser). Gates only the corner toast for
// live events — the nav badge still bumps (passive, non-intrusive) so a user who
// turns pop-ups off still sees unread counts. Action toasts (saved/auditor) use
// showToast directly and are never gated.
// Per-category pop-up toast preferences (localStorage, per-browser). Categories:
// events (general IVA), lpr (plate alerts), faceDetect (new face), faceRecog
// (recognition/blacklist). Lets a busy site silence the noisy categories while
// keeping the important alerts. Migrates the old single popupNotifyOn master.
const _NOTIFY_CATS = ['events', 'lpr', 'faceDetect', 'faceRecog'];
let _notifyPrefs = (() => {
  // lpr = ALL plate reads. anprAlarm events all carry rule_name='License Plate'
  // and there is NO client-visible watchlist/blacklist flag (that match is a
  // server-side JOIN), so read vs alert can't be split here — one category,
  // muted by default because plate reads are high-volume.
  const def = { events: true, lpr: false, faceDetect: true, faceRecog: true };
  try {
    const raw = localStorage.getItem('notifyPrefs');
    if (raw) return { ...def, ...JSON.parse(raw) };
    if (localStorage.getItem('popupNotifyOn') === '0') return { events: false, lpr: false, faceDetect: false, faceRecog: false };
  } catch {}
  return def;
})();
function _reflectNotifyPrefs() {
  document.querySelectorAll('.dd-notify-item input[data-cat]').forEach(cb => {
    const c = cb.dataset.cat; if (c in _notifyPrefs) cb.checked = !!_notifyPrefs[c];
  });
}
function setNotifyPref(el) {
  const c = el.dataset.cat; if (!(c in _notifyPrefs)) return;
  _notifyPrefs[c] = !!el.checked;
  try { localStorage.setItem('notifyPrefs', JSON.stringify(_notifyPrefs)); } catch {}
  _reflectNotifyPrefs();   // keep the menu + Settings copies of these checkboxes in sync
}

// Toast — throttled: events within a 1s window coalesce into one
// "▲ N เหตุการณ์ใหม่" toast so a burst doesn't flood the stack.
let _toastQueue = [];
let _toastTimer = null;
function queueToast(item) {
  if (!_notifyPrefs[item.cat || 'events']) return;   // category muted — badge already bumped by caller
  _toastQueue.push(item);
  if (_toastTimer) return;
  _toastTimer = setTimeout(() => {
    const batch = _toastQueue.splice(0);
    _toastTimer = null;
    if (batch.length === 1) { showToast(batch[0]); return; }
    const byPage = {};
    for (const it of batch) byPage[it.page] = (byPage[it.page] || 0) + 1;
    for (const [page, n] of Object.entries(byPage)) {
      showToast({ icon: '▲', title: I18N.t('aux.toastNewEvents').replace('{n}', n),
        sub: page === 'faces' ? I18N.t('nav.faces') : I18N.t('nav.events'), page });
    }
  }, 1000);
}
function showToast({ icon, title, sub, page }) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="tx">✕</span>`
    + `<div class="tt">${icon || '<svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px"><use href="#icon-bell"/></svg>'} ${escapeHtml(title || '')}</div>`
    + (sub ? `<div class="ts">${escapeHtml(sub)}</div>` : '');
  const remove = () => el.remove();
  el.querySelector('.tx').onclick = (e) => { e.stopPropagation(); remove(); };
  el.onclick = () => {
    remove();
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    showPage(page, nav || undefined);
  };
  stack.appendChild(el);
  setTimeout(remove, 5000);
}

// Snapshot page live-refresh, throttled. A burst of events used to reload/re-render
// the grid on every message → constant flicker, unclickable. Coalesce into at most
// one refresh per SNAP_REFRESH_MS; a full data reload wins over a badge re-render.
const SNAP_REFRESH_MS = 20000;
let _snapRefreshTimer = null, _snapRefreshFull = false, _snapLastRefresh = 0;
function _scheduleSnapRefresh(full) {
  if (!document.getElementById('page-snapshots')?.classList.contains('active')) return;
  if (full) _snapRefreshFull = true;
  if (_snapRefreshTimer) return;   // one already pending — coalesce this event into it
  const wait = Math.max(3000, SNAP_REFRESH_MS - (Date.now() - _snapLastRefresh));
  _snapRefreshTimer = setTimeout(() => {
    _snapRefreshTimer = null;
    _snapLastRefresh = Date.now();
    const wantFull = _snapRefreshFull; _snapRefreshFull = false;
    if (!document.getElementById('page-snapshots')?.classList.contains('active')) return;
    if (wantFull && _snapPage === 1) loadSnapshots(1); else renderSnapshots();
  }, wait);
}

let ws = null;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Pass the session token so the server can authenticate the WS handshake
  // — the broadcast stream carries event + face data. A same-origin upgrade
  // also carries the cookie automatically; the ?token= param is the Safari
  // ITP fallback, matching the REST fetch wrapper's Authorization header.
  const _wsTok = getStoredToken();
  const _wsQ = _wsTok ? `/?token=${encodeURIComponent(_wsTok)}` : '/';
  ws = new WebSocket(`${proto}//${location.host}${_wsQ}`);
  ws.onopen = () => {
    document.getElementById('wsBadge').className = 'ws-badge online';
    document.getElementById('wsLabel').textContent = 'LIVE';
  };
  ws.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'new_event') {
        // Increment today-counts for this camera (server reconciles every 60s)
        const cid = d.event.camera_id;
        if (cid) {
          if (!_todayCounts.cameras[cid]) _todayCounts.cameras[cid] = { total: 0, persons: 0, vehicles: 0, last_event: null };
          _todayCounts.cameras[cid].total += 1;
          if (d.event.object_class === 'Person') _todayCounts.cameras[cid].persons += 1;
          if (['Car','Truck','Vehicle','Bicycle'].includes(d.event.object_class)) _todayCounts.cameras[cid].vehicles += 1;
          _todayCounts.cameras[cid].last_event = d.event.event_time;
          _todayCounts.total += 1;
        }
        // Phase 6.1.7+8 — Events page: page 1 prepends live (unless paused);
        // page 2+ shows nudge.
        const onEventsPage = document.getElementById('page-events').classList.contains('active');
        const onLprPage = document.getElementById('page-lpr')?.classList.contains('active');
        if (_evtPage === 1 && !_evtPaused) {
          allEvents.unshift(d.event);
          if (allEvents.length > PAGE_SIZE) allEvents = allEvents.slice(0, PAGE_SIZE);
          _evtTotal += 1;
          if (onEventsPage) {
            renderEvents();
            document.getElementById('evtCount').textContent = `${_evtTotal.toLocaleString()} events`;
            renderPagination('eventsPagination', _evtPage, _evtTotal, PAGE_SIZE,
              (p) => loadEvents(p), 'event');
          }
        } else {
          _evtNewSincePage1 += 1;
          _evtTotal += 1;
          if (onEventsPage) {
            const nudge = document.getElementById('eventsLiveNudge');
            if (nudge) {
              nudge.style.display = '';
              nudge.innerHTML = I18N.t('aux.evtNewNudge').replace('{n}', _evtNewSincePage1);
            }
          }
        }
        if (document.getElementById('page-cameras').classList.contains('active')) {
          updateCameraGridStats();
          updateKPIs();
        }
        // Snapshot page — the event's snapshot is captured ~1s AFTER
        // this WS notify (subscriber notifies before capturing it), so
        // wait, then reload page 1 to pull the new row in with its image.
        _scheduleSnapRefresh(true);   // throttled — a flood of events must not thrash the grid
        // Notification — an incident (event carrying a rule_name)
        // arriving while the user is NOT on the relevant Live page → toast +
        // nav badge. Metric/analytics events have no rule_name → silent.
        // LPR (anprAlarm) events route to the LPR nav badge/page, not Events —
        // otherwise high-volume plate traffic drowns out the general Events badge.
        const isLprEvent = d.event.event_type === 'anprAlarm';
        const eventSuppressed = isLprEvent ? onLprPage : onEventsPage;
        if (d.event.rule_name && String(d.event.rule_name).trim() && !eventSuppressed) {
          bumpNavBadge(isLprEvent ? 'lpr' : 'events');
          const _tt = d.event.event_time
            ? new Date(d.event.event_time).toLocaleTimeString('th-TH', { hour12: false })
            : '';
          queueToast({ icon: '<svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px"><use href="#icon-alert"/></svg>', title: d.event.rule_name,
            sub: `${d.event.camera_id || ''}${_tt ? ' · ' + _tt : ''}`, page: isLprEvent ? 'lpr' : 'events',
            cat: isLprEvent ? 'lpr' : 'events' });
        } else if (isLprEvent && !eventSuppressed) {
          // Plate read with no rule_name — same LPR category, muted by default.
          bumpNavBadge('lpr');
          const _plate = d.event.raw_json?.data?.Object?.Text || '';
          queueToast({ icon: '<svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px"><use href="#icon-alert"/></svg>',
            title: _plate || I18N.t('aux.toastNewLprRead', 'อ่านป้ายทะเบียน'),
            sub: d.event.camera_id || '', page: 'lpr', cat: 'lpr' });
        }
        // Map Live Pulse (T2) — additive, independent of corner toast.
        // Plain plate reads flooded the camera-point pulse → route them to the
        // left LPR list instead; watch-list ALERTS (_lprAlert) keep the pulse.
        if (d.event.event_type === 'anprAlarm') {
          if (d.event._lprAlert) _handleMapPulse(d.event); else _handleMapLprCard(d.event);
        } else if (d.event.rule_name && String(d.event.rule_name).trim()) {
          _handleMapPulse(d.event);
        }
        // Face Recognition match — refresh if on face-matches page, else bump badge + toast
        if (d.event.event_type === 'FaceRecognition') {
          const onFaceMatchPage = document.getElementById('page-face-matches')?.classList.contains('active');
          if (onFaceMatchPage) {
            loadFaceMatches();
          } else {
            bumpNavBadge('face-matches');
            queueToast({ icon: '<svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px"><use href="#icon-face-id"/></svg>',
              title: I18N.t('aux.toastNewFaceMatch'),
              sub: d.event.camera_id || '', page: 'face-matches', cat: 'faceRecog' });
          }
        }
      }
      // Face Capture — its own page + its own WS channel (api-server
      // broadcasts new_face separately from new_event). Live-refresh
      // the gallery + demographic summary so faces appear without a
      // manual reload, same rule as every other event page.
      if (d.type === 'new_face') {
        if (document.getElementById('page-faces')?.classList.contains('active')) {
          loadFaces();
        } else {
          bumpNavBadge('faces');
          queueToast({ icon: '<svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px"><use href="#icon-face"/></svg>', title: I18N.t('aux.toastNewFace'),
            sub: d.event.camera_id || '', page: 'faces', cat: 'faceDetect' });
        }
        // Refresh All Faces tab if currently visible
        const allFacesPanel = document.getElementById('faceTabPanelAllFaces');
        if (allFacesPanel && !allFacesPanel.classList.contains('hidden')) {
          _loadFaceTab();
        }
        // Person Data page — only bump/refresh when the face event actually
        // produced an appearance record (i.e. has gender or glasses data).
        // Cameras that send null attributes don't insert to appearances table.
        const _hasAppearance = d.event?.raw_json?.gender || d.event?.raw_json?.glass;
        if (_hasAppearance) {
          if (document.getElementById('page-appearance')?.classList.contains('active')) {
            _loadAppStats();
          } else {
            bumpNavBadge('appearance');
          }
        }
        _handleMapFaceCard(d.event);
      }
      // Bosch snapshot links ~1s after the event — fill the tile image live
      if (d.type === 'event_snapshot' && d.event_id && d.snapshot_file) {
        const tile = document.querySelector(`[data-event-id="${d.event_id}"] img[data-err]`)
                  || document.querySelector(`[data-event-id="${d.event_id}"] .no-img`);
        if (tile) {
          const imgSrc = `${API}/snapshots/${encodeURIComponent(d.snapshot_file)}?w=400`;
          if (tile.tagName === 'IMG') tile.src = imgSrc;
          else tile.outerHTML = `<img src="${imgSrc}" data-err="no-img">`;
        }
      }
      // 🆕 Handle camera status changes from heartbeat checker
      if (d.type === 'camera_status' && Array.isArray(d.changes)) {
        d.changes.forEach(ch => {
          const cam = cameras.find(c => c.camera_id === ch.camera_id);
          if (cam) cam.status = ch.status;
        });
        if (document.getElementById('page-cameras').classList.contains('active')) {
          updateCameraGridStats();
          updateKPIs();
        }
      }
      // Phase 6.1.5 — Pre-alarm clip ready (pushed via Postgres LISTEN bridge)
      if (d.type === 'clip_done') {
        // Patch the in-memory event row if it exists so the Snapshot page
        // gets the 🎬 badge immediately on next render
        const ev = allEvents.find(e => e.id === d.event_id);
        if (ev) {
          ev.clip_file = d.clip_file;
          ev.clip_status = 'done';
          ev.clip_duration_sec = d.clip_duration_sec;
        }
        // If Media page is currently visible → reload it to show the new clip
        if (document.getElementById('page-media')?.classList.contains('active')) {
          loadMedia();
        }
        _scheduleSnapRefresh(false);   // throttled badge refresh
      }
      // Phase 6.1.12 — Live "People in Area" updates from occupancy tracker
      if (d.type === 'occupancy_update') {
        _occupancy[`${d.camera_id}::${d.rule_name}`] = {
          camera_id: d.camera_id,
          rule_name: d.rule_name,
          current: d.current,
          raw: d.raw,
          last_update: new Date(d.ts).toISOString(),
        };
        if (document.getElementById('page-stats')?.classList.contains('active')) {
          renderOccupancy();
        }
      }
    } catch {}
  };
  ws.onclose = () => {
    document.getElementById('wsBadge').className = 'ws-badge offline';
    document.getElementById('wsLabel').textContent = 'Reconnecting...';
    setTimeout(connectWS, 3000);
  };
}

// ============================================================
// Site Pills — shared compact site-filter badge (Map/Events/Snapshot/
// Media/Face/Appearance). Each caller owns its own active-site state and
// passes the data-action name to dispatch clicks to; this only renders
// and auto-hides. _sites is populated once by loadCameras() at bootstrap.
// ============================================================

function renderSitePills(containerId, activeSiteId, actionName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!Array.isArray(_sites) || _sites.length <= 1) { el.innerHTML = ''; return; }
  const pill = (sid, label, color, active) => {
    const dot = color ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color}"></span>` : '';
    return `<button class="site-pill${active ? ' active' : ''}" data-action="${actionName}" data-sid="${sid}">${dot}${escapeHtml(label)}</button>`;
  };
  el.innerHTML = pill('', I18N.t('cam.allSites'), null, activeSiteId === null)
    + _sites.map(s => pill(s.id, s.name, s.color, activeSiteId === s.id)).join('');
}

// ============================================================
// Groups Bar (shows on every page)
// ============================================================

function renderGroupBars() {
  const html = renderGroupBarHTML({ includeManager: true });
  ['grpBar', 'grpBarEvents', 'grpBarSnap', 'grpBarMedia', 'grpBarMap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
  const statsEl = document.getElementById('grpBarStats');
  if (statsEl) statsEl.innerHTML = renderGroupBarHTML({ includeManager: false, siteId: typeof _statsSiteId !== 'undefined' ? _statsSiteId : null });
}

function renderGroupBarHTML(opts) {
  opts = opts || {};
  const all = `<button class="gtab ${activeGroupId === 'all' ? 'active' : ''}" data-action="setActiveGroup" data-gid="all">
    ALL <span class="tc">${cameras.length}</span></button>`;

  // Site attribution (badge-A): when more than one site exists, give each group
  // tab a left rail in its owning site's color so identical group names across
  // sites are distinguishable at a glance. The site filter pills already on the
  // page double as the colour→name legend; the site name also rides in title.
  // Inset box-shadow (not border-left) keeps the tab width stable.
  const siteMap = new Map((Array.isArray(_sites) ? _sites : []).map(s => [s.id, s]));
  const multiSite = siteMap.size > 1;
  // When a specific site is selected (opts.siteId), only show groups that
  // actually have a camera in that site — same approach as renderMapLegend()
  // for the map page's site filter. Without this, picking e.g. "หาดใหญ่" still
  // showed VSS/Phuket group tabs, and selecting one silently ANDed a
  // foreign-site group filter with site_id server-side -> empty charts with
  // no visible explanation.
  const siteCamIds = opts.siteId
    ? new Set(cameras.filter(c => c.site_id === opts.siteId).map(c => c.camera_id))
    : null;
  const visibleGroups = siteCamIds
    ? groups.filter(g => (g.cameraIds || []).some(id => siteCamIds.has(id)))
    : groups;
  const grps = visibleGroups.map(g => {
    const count = g.cameraIds.length;
    const active = activeGroupId === g.id ? 'active' : '';
    const colorBox = g.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color}"></span>` : '';
    const site = (multiSite && g.site_id != null) ? siteMap.get(g.site_id) : null;
    const rail = site ? `box-shadow:inset 3px 0 0 ${site.color};` : '';
    const titleAttr = site ? ` title="${escapeHtml(site.name)}"` : '';
    return `<button class="gtab ${active}" style="${rail}" data-action="setActiveGroup" data-gid="${g.id}"${titleAttr}>${colorBox} ${escapeHtml(g.name)} <span class="tc">${count}</span></button>`;
  }).join('');

  const mgr = `<button class="gtab mgr" data-action="openGroupManager">${escapeHtml(I18N.t('aux.manageGroups'))}</button>`;

  return all + grps + (opts.includeManager === false ? '' : mgr);
}

function setActiveGroup(gid) {
  activeGroupId = gid;
  renderGroupBars();
  // Re-render current page
  const activePage = document.querySelector('.page.active').id.replace('page-', '');
  if (activePage === 'cameras') { _camGridPage = 1; renderCameraGrid(); updateKPIs(); }
  if (activePage === 'events') { populateEventFilters(); loadEvents(); }
  if (activePage === 'snapshots') { populateSnapFilters(); loadSnapshots(); }
  if (activePage === 'media') { populateMediaFilters(); loadMedia(); }
  if (activePage === 'map') refreshMap();
  if (activePage === 'stats') loadStats();
}

// ============================================================
// Group Manager Modal
// ============================================================

function openGroupManager() { openSettings(); settingsNav('groups'); }
function closeGroupManager() { /* groups is a Settings Workspace section now — no modal */ }

function renderGroupList() {
  const el = document.getElementById('grpList');
  if (groups.length === 0) {
    el.innerHTML = `<div style="color:var(--text-secondary);font-size:11px;text-align:center;padding:20px">${escapeHtml(I18N.t('grp.noGroups'))}</div>`;
    return;
  }
  const item = (g) => {
    const sel = editingGroupId === g.id ? 'sel' : '';
    return `
      <div class="gli ${sel}" data-action="editGroup" data-gid="${g.id}">
        <div>
          <div class="gli-name">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color || 'var(--accent)'};margin-right:6px"></span>
            ${g.name}
          </div>
          <div class="gli-meta">${g.cameraIds.length} ${escapeHtml(I18N.t('grp.camerasUnit'))}</div>
        </div>
        <div class="gli-actions">
          <button class="gli-icon-btn" title="${escapeHtml(I18N.t('common.edit'))}" data-action="editGroup" data-gid="${g.id}"><svg aria-hidden="true"><use href="#icon-edit"/></svg></button>
          <button class="gli-icon-btn danger" title="${escapeHtml(I18N.t('common.delete'))}" data-action="deleteGroup" data-gid="${g.id}"><svg aria-hidden="true"><use href="#icon-trash"/></svg></button>
        </div>
      </div>`;
  };
  const multiSite = Array.isArray(_sites) && _sites.length > 1;
  if (!multiSite) { el.innerHTML = groups.map(item).join(''); return; }
  // Section groups under their owning site (single-site deploys skip the headers).
  const bySite = new Map();
  for (const g of groups) {
    const k = g.site_id != null ? g.site_id : '__none__';
    if (!bySite.has(k)) bySite.set(k, []);
    bySite.get(k).push(g);
  }
  const header = (label, color) =>
    `<div class="grp-site-hd">${color ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:6px"></span>` : ''}${escapeHtml(label)}</div>`;
  const sections = [];
  for (const s of _sites) {
    const gs = bySite.get(s.id);
    if (gs && gs.length) sections.push(header(s.name, s.color) + gs.map(item).join(''));
  }
  const none = bySite.get('__none__');
  if (none && none.length) sections.push(header(I18N.t('grp.noSite'), null) + none.map(item).join(''));
  el.innerHTML = sections.join('');
}

function showEditorPlaceholder() {
  document.getElementById('grpEditor').innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:var(--text-secondary)">
      <div style="opacity:0.3"><svg aria-hidden="true" width="32" height="32"><use href="#icon-users"/></svg></div>
      <p style="margin-top:10px;font-size:12px">${I18N.t('grp.pickToEdit')}</p>
    </div>`;
}

// Camera-picker filter state (search box + quick filters) — persists across
// renderGroupEditor() rebuilds within one editing session (checkbox clicks,
// select-all/clear, site change), reset when opening a different group.
let _grpCamSearch = '', _grpCamStatusFilter = '', _grpCamTypeFilter = '', _grpShowSelectedOnly = false;
let _grpEditorPickCams = [];   // cameras in scope for the currently-open editor (site-filtered)

function _resetGrpCamFilters() {
  _grpCamSearch = ''; _grpCamStatusFilter = ''; _grpCamTypeFilter = ''; _grpShowSelectedOnly = false;
}

function newGroup() {
  editingGroupId = '__new__';
  editorSelectedCams = new Set();
  _resetGrpCamFilters();
  // default to the currently-active site (else first site) so the picker is scoped
  const defSite = (Array.isArray(_sites) && _sites.length)
    ? (_sites.find(s => s.id === _activeSiteId)?.id ?? _sites[0].id) : null;
  renderGroupList();
  renderGroupEditor('', editorSelectedCams, '#5b8def', defSite);
}

function editGroup(gid) {
  const g = groups.find(x => x.id === gid);
  if (!g) return;
  editingGroupId = gid;
  editorSelectedCams = new Set(g.cameraIds || []);
  _resetGrpCamFilters();
  renderGroupList();
  renderGroupEditor(g.name, editorSelectedCams, g.color || '#5b8def', g.site_id != null ? g.site_id : null);
}

// Site changed in the editor → drop any selected cameras that no longer belong
// to the chosen site, then re-render the (now site-scoped) picker.
function setGrpSite() {
  const st = _grpEditorState();
  const inSite = new Set(cameras.filter(c => st.siteId == null || c.site_id === st.siteId).map(c => c.camera_id));
  editorSelectedCams = new Set([...editorSelectedCams].filter(id => inSite.has(id)));
  renderGroupEditor(st.name, editorSelectedCams, st.color, st.siteId);
}

// Current editor field values read back from the DOM (used by the re-render paths).
function _grpEditorState() {
  const sv = document.getElementById('grpSite')?.value;
  return {
    name:  document.getElementById('grpName')?.value  || '',
    color: document.getElementById('grpColor')?.value || '#5b8def',
    siteId: sv ? Number(sv) : null,
  };
}

// One camera row in the group-editor picker — shared by the initial render
// and the filter-only re-render (_grpFilterCamList) so both stay in sync.
function _grpCamItemHtml(c, selectedCams) {
  const sel = selectedCams.has(c.camera_id) ? 'sel' : '';
  return `
      <div class="grp-cam-item ${sel}" data-action="toggleCamInGroup" data-cam-id="${c.camera_id}">
        <input type="checkbox" ${selectedCams.has(c.camera_id) ? 'checked' : ''} style="accent-color:var(--accent)">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">${c.camera_name || c.camera_id}</div>
          <div style="font-size:10px;color:var(--text-secondary)">${c.camera_id} · ${c.ip_address || '—'}</div>
        </div>
        <span class="badge ${c.status === 'online' ? 'badge-online' : 'badge-offline'}" style="font-size:9px">${c.status === 'online' ? 'ON' : 'OFF'}</span>
      </div>`;
}

// Applies the persisted search/status/type/selected-only filters to a camera
// list. Pure — used by both the full render and the search-only re-render.
function _grpApplyCamFilters(list, selectedCams) {
  const q = _grpCamSearch.trim().toLowerCase();
  return list.filter(c => {
    if (q && !`${c.camera_name || ''} ${c.camera_id} ${c.ip_address || ''}`.toLowerCase().includes(q)) return false;
    if (_grpCamStatusFilter && c.status !== _grpCamStatusFilter) return false;
    if (_grpCamTypeFilter && (c.cam_role || 'standard') !== _grpCamTypeFilter) return false;
    if (_grpShowSelectedOnly && !selectedCams.has(c.camera_id)) return false;
    return true;
  });
}

// Re-renders ONLY the camera-list body from current filter-control values —
// keeps the search input's own DOM node alive so typing doesn't lose focus
// (unlike renderGroupEditor(), which rebuilds the whole panel).
function _grpFilterCamList() {
  _grpCamSearch = document.getElementById('grpCamSearch')?.value || '';
  _grpCamStatusFilter = document.getElementById('grpCamStatusFilter')?.value || '';
  _grpCamTypeFilter = document.getElementById('grpCamTypeFilter')?.value || '';
  _grpShowSelectedOnly = !!document.getElementById('grpShowSelectedOnly')?.checked;
  const filtered = _grpApplyCamFilters(_grpEditorPickCams, editorSelectedCams);
  const body = document.getElementById('grpCamListBody');
  if (!body) return;
  body.innerHTML = filtered.map(c => _grpCamItemHtml(c, editorSelectedCams)).join('')
    || `<div style="color:var(--text-secondary);font-size:11px;text-align:center;padding:20px">${escapeHtml(I18N.t(_grpEditorPickCams.length ? 'grp.noMatch' : 'grp.noCameras'))}</div>`;
}

function renderGroupEditor(name, selectedCams, color, siteId) {
  const multiSite = Array.isArray(_sites) && _sites.length > 1;
  // Scope the camera picker to the chosen site so a group stays single-site.
  const pickCams = (multiSite && siteId != null)
    ? cameras.filter(c => c.site_id === siteId)
    : cameras;
  _grpEditorPickCams = pickCams;
  const filteredCams = _grpApplyCamFilters(pickCams, selectedCams);
  const camList = filteredCams.map(c => _grpCamItemHtml(c, selectedCams)).join('')
    || `<div style="color:var(--text-secondary);font-size:11px;text-align:center;padding:20px">${escapeHtml(I18N.t(pickCams.length ? 'grp.noMatch' : 'grp.noCameras'))}</div>`;

  const colors = [
    '#5b8def', '#22c55e', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#ec4899',
    '#84cc16', '#f97316', '#a78bfa', '#14b8a6', '#eab308', '#f43f5e', '#0ea5e9',
    '#64748b', '#d946ef',
  ];
  // Selected swatch: an offset ring (box-shadow, not border) so the indicator
  // reads clearly regardless of the swatch's own hue — a border in the same
  // color family (e.g. dark-on-blue) was too low-contrast to notice.
  const colorPicker = colors.map(c =>
    `<button data-action="setGrpColor" data-color="${c}" style="width:22px;height:22px;border-radius:50%;background:${c};border:none;cursor:pointer;box-shadow:${color === c ? `0 0 0 2px var(--surface-elevated), 0 0 0 4px var(--accent)` : 'none'}"></button>`
  ).join('');

  document.getElementById('grpEditor').innerHTML = `
    <h3 style="font-size:14px;margin-bottom:14px">${editingGroupId === '__new__' ? I18N.t('grp.editorNew') : I18N.t('grp.editorEdit')}</h3>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.fldName'))}</label>
      <input id="grpName" type="text" class="form-input" placeholder="${escapeHtml(I18N.t('grp.namePh'))}" value="${name}">
    </div>
    ${multiSite ? `
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.fldSite'))}</label>
      <select id="grpSite" class="form-input" data-change="setGrpSite">
        ${_sites.map(s => `<option value="${s.id}" ${String(siteId) === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select>
    </div>` : `<input id="grpSite" type="hidden" value="${siteId != null ? siteId : ''}">`}
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.fldColor'))}</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">
        ${colorPicker}
        <input id="grpColor" type="hidden" value="${color}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.pickCameras'))} <span style="color:var(--accent)" id="selCount">(${selectedCams.size}/${pickCams.length})</span></label>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input id="grpCamSearch" type="text" class="form-input" style="flex:1;min-width:140px;font-size:11px;padding:6px 10px" placeholder="${escapeHtml(I18N.t('grp.searchPh'))}" value="${escapeHtml(_grpCamSearch)}" data-input="grpFilterCamList">
        <select id="grpCamStatusFilter" class="form-input" style="width:auto;font-size:11px" data-change="grpFilterCamList">
          <option value="" ${!_grpCamStatusFilter ? 'selected' : ''} data-i18n="cam.statusAll">${escapeHtml(I18N.t('cam.statusAll'))}</option>
          <option value="online" ${_grpCamStatusFilter === 'online' ? 'selected' : ''} data-i18n="cam.statusOnline">${escapeHtml(I18N.t('cam.statusOnline'))}</option>
          <option value="offline" ${_grpCamStatusFilter === 'offline' ? 'selected' : ''} data-i18n="cam.statusOffline">${escapeHtml(I18N.t('cam.statusOffline'))}</option>
        </select>
        <select id="grpCamTypeFilter" class="form-input" style="width:auto;font-size:11px" data-change="grpFilterCamList">
          <option value="" ${!_grpCamTypeFilter ? 'selected' : ''} data-i18n="cam.typeAll">${escapeHtml(I18N.t('cam.typeAll'))}</option>
          <option value="standard" ${_grpCamTypeFilter === 'standard' ? 'selected' : ''} data-i18n="cam.typeStandard">${escapeHtml(I18N.t('cam.typeStandard'))}</option>
          <option value="lpr" ${_grpCamTypeFilter === 'lpr' ? 'selected' : ''} data-i18n="cam.roleLpr">${escapeHtml(I18N.t('cam.roleLpr'))}</option>
          <option value="face" ${_grpCamTypeFilter === 'face' ? 'selected' : ''} data-i18n="cam.roleFace">${escapeHtml(I18N.t('cam.roleFace'))}</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:10px" data-action="selectAllCams">${escapeHtml(I18N.t('grp.selectAll'))}</button>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:10px" data-action="clearAllCams">${escapeHtml(I18N.t('grp.clearAll'))}</button>
        <label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-secondary);margin-left:auto;cursor:pointer">
          <input type="checkbox" id="grpShowSelectedOnly" style="accent-color:var(--accent)" ${_grpShowSelectedOnly ? 'checked' : ''} data-change="grpFilterCamList">
          ${escapeHtml(I18N.t('grp.showSelectedOnly'))}
        </label>
      </div>
      <div class="grp-cam-list" id="grpCamListBody">${camList}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" data-action="saveGroup">${escapeHtml(I18N.t('common.saveBtn'))}</button>
      <button class="btn btn-secondary" data-action="cancelEditGroup">${escapeHtml(I18N.t('common.cancel'))}</button>
    </div>`;
}

function toggleCamInGroup(camId) {
  if (editorSelectedCams.has(camId)) editorSelectedCams.delete(camId);
  else editorSelectedCams.add(camId);
  const st = _grpEditorState();
  renderGroupEditor(st.name, editorSelectedCams, st.color, st.siteId);
}

// Select/clear apply to the currently VISIBLE (filtered) set only, so a
// search/quick-filter narrows what these buttons touch — matches the usual
// "select all" convention in filterable lists, and leaves cameras hidden by
// the filter untouched either way. With no filter active, filtered === the
// full site pool, so behavior is unchanged from before.
function selectAllCams() {
  const st = _grpEditorState();
  const visible = _grpApplyCamFilters(_grpEditorPickCams, editorSelectedCams);
  visible.forEach(c => editorSelectedCams.add(c.camera_id));
  renderGroupEditor(st.name, editorSelectedCams, st.color, st.siteId);
}

function clearAllCams() {
  const st = _grpEditorState();
  const visible = _grpApplyCamFilters(_grpEditorPickCams, editorSelectedCams);
  visible.forEach(c => editorSelectedCams.delete(c.camera_id));
  renderGroupEditor(st.name, editorSelectedCams, st.color, st.siteId);
}

async function saveGroup() {
  const name = document.getElementById('grpName').value.trim();
  const color = document.getElementById('grpColor').value;
  if (!name) { alert(I18N.t('grp.needName')); return; }

  const siteEl = document.getElementById('grpSite');
  const data = {
    id: editingGroupId === '__new__' ? null : editingGroupId,
    name, color,
    site_id: siteEl && siteEl.value ? Number(siteEl.value) : null,
    cameraIds: Array.from(editorSelectedCams),
  };

  try {
    const res = await fetch(`${API}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Save failed');

    await loadGroups();
    renderGroupList();
    renderGroupBars();
    showEditorPlaceholder();
    editingGroupId = null;

    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--status-ok);color:white;padding:10px 18px;border-radius:8px;z-index:2000;font-weight:600';
    toast.textContent = I18N.t('grp.saved').replace('{name}', name);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

function cancelEditGroup() {
  editingGroupId = null;
  showEditorPlaceholder();
  renderGroupList();
}

async function deleteGroup(gid) {
  if (!confirm(I18N.t('grp.confirmDelete'))) return;
  try {
    await fetch(`${API}/api/groups/${gid}`, { method: 'DELETE' });
    if (activeGroupId === gid) activeGroupId = 'all';
    await loadGroups();
    renderGroupList();
    renderGroupBars();
    if (editingGroupId === gid) { editingGroupId = null; showEditorPlaceholder(); }
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

async function loadGroups() {
  try {
    const res = await fetch(`${API}/api/groups`);
    groups = await res.json();
  } catch (e) { groups = []; }
  // A site-scoped viewer's active tab may point at a group that's no longer
  // in-scope (filtered out server-side) — fall back to "ALL" rather than
  // leaving no tab highlighted.
  if (activeGroupId !== 'all' && !groups.some(g => g.id === activeGroupId)) {
    activeGroupId = 'all';
  }
}

// Face Gallery → dashboard/page-face-gallery.js
// ============================================================
// Events Page → dashboard/page-events.js
// ============================================================

// Snapshots Page → dashboard/page-snapshots.js

// Media Page → dashboard/page-media.js

// ============================================================
// ============================================================
// Map Page → dashboard/page-map.js
// ============================================================

// ============================================================
// Stats Page → dashboard/page-stats.js
// ============================================================
// Map Settings Page → dashboard/page-map-settings.js


// ============================================================
// Reports Page → dashboard/page-reports.js
// ============================================================

// ============================================================
// Init — DISABLED, now called from auth bootstrap (ดู bottom of file)
async function _initDashboard() {
  initSidebarCollapsed();
  await loadBrand();   // apply customer's brand (logo, name, tagline, accent) before anything else renders
  await loadGroups();
  // Seed _todayCounts BEFORE loadCameras renders — otherwise the Camera Status
  // page (which is active by default) paints with empty counts. Without this
  // baseline, the page shows "0 events today" for every camera until the user
  // clicks the nav item to trigger refreshTodayCounts(), which looked like
  // "page loads slowly/distorted data" to the user.
  await refreshTodayCounts();
  startTodayCountsAutoRefresh();
  await loadCameras();
  renderOpSitePills();
  renderFaceSitePills();
  renderAppSitePills();
  renderLprSitePills();
  await loadEvents();
  // Phase C.7 — wrap the long camera dropdowns with a searchable combobox.
  // Safe to call after loadEvents (which populates evtFilterCam etc.) AND
  // again later (idempotent via dataset.enhanced gate); the MutationObserver
  // inside the helper handles option-list rebuilds on subsequent loads.
  enhanceCameraDropdowns();
  // Phase 8.0 slice 3 — boot-time license state check + 5-min periodic
  // re-check. Auto-popups the License modal on bad state (once per
  // browser session) so the operator can't miss a trial expiry.
  startLicenseAutoCheck();
  // Phase 8.1 — EULA acceptance gate. Blocks admins from using the
  // dashboard until they've accepted the EULA (per-deployment, recorded
  // once in system_settings). Viewers don't see this — only admins can
  // legally bind the deployment.
  eulaBootGate();
  connectWS();
  setInterval(async () => {
    if (document.getElementById('page-cameras').classList.contains('active')) await loadCameras();
  }, 10000);
  // Navigate to the default page explicitly so loadSummary() fires and nav/content
  // stay in sync on every hard reload (decision #172 made summary the default;
  // the old cameras nav active was never cleaned up — fixed here).
  const _defaultNav = document.querySelector('.nav-item[data-page="summary"]');
  showPage('summary', _defaultNav || undefined);
}

// ============================================================
// Alerts Page → dashboard/page-alerts.js
// ============================================================
// ============================================================
// User Management Page → dashboard/page-user-mgmt.js


// Branding Page → dashboard/page-branding.js

// ============================================================
// Categories Page → dashboard/page-categories.js


// ============================================================
// System Settings Page → dashboard/page-system.js


// Small helper (escapeHtml may already exist; keep guarded)
if (typeof window.escapeHtml !== 'function') {
  window.escapeHtml = function (s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  };
}

// ── Bootstrap auth check on load ────────────────────────────
async function bootstrapApp() {
  console.log('🔐 Bootstrapping app...');
  try {
    const ok = await loadCurrentUser();
    console.log('🔐 Auth check result:', ok ? 'logged in' : 'redirecting to login');
    if (!ok) return;

    // After auth ✓ → init dashboard
    console.log('🚀 Initializing dashboard...');
    await _initDashboard();
    initDateTimePickers();
    console.log('✅ Dashboard ready');

    // Deep-link: /?page=NAME selects a specific page on first load.
    // Used by the Executive Summary sidebar to jump into a dashboard
    // section. Falls back to the default page if the name is unknown.
    try {
      const want = new URLSearchParams(window.location.search).get('page');
      if (want && document.getElementById('page-' + want)) {
        const navItem = document.querySelector(`.nav-item[data-page="${want}"]`);
        showPage(want, navItem || undefined);
        // Strip the query param so a manual refresh doesn't keep replaying
        // the deep-link if the user has since navigated elsewhere.
        history.replaceState(null, '', window.location.pathname);
      }
    } catch {}
  } catch (e) {
    console.error('❌ Bootstrap error:', e);
    // ถ้ามี error ที่ไม่ใช่ auth → แสดง error ให้ user เห็น
    const userName = document.getElementById('userName');
    if (userName) userName.textContent = 'Error: ' + e.message;
  }
}

// ============================================================
// 📱 Mobile sidebar toggle
// ============================================================
const SIDEBAR_COLLAPSED_KEY = 'dashboard_sidebar_collapsed';

function toggleSidebar() {
  document.getElementById('appRoot')?.classList.toggle('sidebar-open');
}
function closeSidebar() {
  document.getElementById('appRoot')?.classList.remove('sidebar-open');
}

function initSidebarCollapsed() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; }
  catch (e) { collapsed = false; }
  setSidebarCollapsed(collapsed, false);
}

function toggleSidebarCollapsed() {
  if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;
  const root = document.getElementById('appRoot');
  setSidebarCollapsed(!root?.classList.contains('sidebar-collapsed'), true);
  closeSidebar();
}

function setSidebarCollapsed(collapsed, persist) {
  const root = document.getElementById('appRoot');
  if (!root) return;
  root.classList.toggle('sidebar-collapsed', !!collapsed);
  if (persist) {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); }
    catch (e) { /* private mode */ }
  }
  syncSidebarCollapsedUi(!!collapsed);
}

function syncSidebarCollapsedUi(collapsed) {
  const btn = document.getElementById('sidebarCollapseBtn');
  const label = I18N.t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar');
  if (btn) {
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    btn.setAttribute('title', label);
    btn.setAttribute('data-i18n-title', collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar');
  }
  document.querySelectorAll('.sidebar .nav-item').forEach(item => {
    const text = item.querySelector('[data-i18n]')?.textContent?.trim();
    if (collapsed && text) item.setAttribute('title', text);
    else item.removeAttribute('title');
  });
}

// Health Check Page → dashboard/page-health.js


// Executive Summary Page → dashboard/page-executive-summary.js

// Nav Bindings (_bindNavChrome / _bindStaticHandlers / _bindDynamicHandlers) → dashboard/page-nav-bindings.js

// Run after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { _bindNavChrome(); _bindStaticHandlers(); _bindDynamicHandlers(); bootstrapApp(); });
} else {
  _bindNavChrome();
  _bindStaticHandlers();
  _bindDynamicHandlers();
  bootstrapApp();
}
