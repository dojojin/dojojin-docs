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
      console.warn('🔐 401 received, clearing token + redirect to login');
      setStoredToken(null);
      window.location.href = '/login.html';
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

// Design token helper (Phase 4) — reads CSS custom property at call time
// so Chart.js + OpenLayers colours stay in sync with the token system.
// design-tokens.js exports the ES-module version for new Phase 1+ code.
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
  btn.innerHTML = '<span class="cmb-label">…</span><span style="color:var(--dim);font-size:10px">▼</span>';
  wrapper.appendChild(btn);

  const drop = document.createElement('div');
  drop.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--panel);border:1px solid var(--border);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:200;display:none';
  drop.innerHTML =
    `<input type="search" class="cmb-search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"
       style="width:100%;border:none;border-bottom:1px solid var(--border);background:transparent;padding:8px 12px;color:var(--text);font-size:13px;box-sizing:border-box;outline:none">
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
      : `<div style="padding:14px;color:var(--dim);font-size:12px;text-align:center">${escapeHtml(I18N.t('aux.noMatchItems'))}</div>`;
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
    ? `<span style="color:var(--amber);font-size:10px;margin-left:8px" title="${escapeHtml(I18N.t('aux.manyResultsTip'))}">${escapeHtml(I18N.t('aux.manyResults'))}</span>` : '';

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
const _DT_DATETIME_IDS = ['evtFilterFrom', 'evtFilterTo', 'snapFilterFrom', 'snapFilterTo', 'crFrom', 'crTo', 'reportFrom', 'reportTo', 'hrRangeFrom', 'hrRangeTo', 'mediaFilterFrom', 'mediaFilterTo', 'faceFilterFrom', 'faceFilterTo'];
const _DT_DATE_IDS     = ['reportDate', 'reportWeekDate'];
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
        styleBtn.textContent = mapLayers._currentStyle === 'streets' ? 'STREETS' : 'LIGHT';
      }
      const srcBtn = document.getElementById('togSource');
      if (srcBtn && mapLayers._currentSource) {
        srcBtn.textContent = mapLayers._currentSource === 'online' ? 'ONLINE' : 'OFFLINE';
      }
      const provBtn = document.getElementById('togProvider');
      if (provBtn && mapLayers._currentProvider) {
        provBtn.textContent = mapLayers._currentProvider === 'carto' ? 'CARTO' : 'MAPBOX';
      }
      renderMapLegend();
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
    onReportTypeChange();              // sets default date for active type + shows the right field group
    initReportCategoryFilter();        // load categories into filter dropdown
  }
  if (name === 'events') { populateEventFilters(); loadEvents(); clearNavBadge('events'); }
  if (name === 'snapshots') { populateSnapFilters(); loadSnapshots(); }
  if (name === 'media') { populateMediaFilters(); loadMedia(); }
  if (name === 'faces') { loadFaces(); clearNavBadge('faces'); }
  if (name === 'appearance') {
    _initAppCamDropdown(); _initAppDatePickers();
    setAppTab('overview', document.querySelector('#page-appearance .tabs .tab'));
    // Set 7d default range on first enter (pickers must exist before selectDate)
    const defBtn = document.querySelector('#page-appearance .per-btn[data-range="7d"]');
    setAppRange('7d', defBtn);
  }
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
      if (lb) lb.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</div>`;
      refreshLicenseStatus().then(s => renderLicenseModalContent(s)).catch(() => {});
    }
    else if (key === 'audit')      { loadAuditLog().catch(() => {}); }
    else if (key === 'sessions')   { loadSessions().catch(() => {}); }
    else if (key === 'backup')     { loadBackups().catch(() => {}); }
    else if (key === 'map')        { onShowMapSettings().catch(() => {}); }
    else if (key === 'alerts')     { switchAlertTab('rules'); }
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
    el.innerHTML = `<div style="padding:18px;color:var(--amber);font-size:12px">${escapeHtml(I18N.t('bk.loadListFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function renderBackupList(backups) {
  const el = document.getElementById('backupList');
  if (!el) return;
  if (!backups.length) {
    el.innerHTML = `<div style="padding:18px;color:var(--dim);font-size:12px">${escapeHtml(I18N.t('bk.noFiles'))}</div>`;
    return;
  }
  el.innerHTML = backups.map(b => {
    const sz = b.size > 1048576 ? (b.size / 1048576).toFixed(1) + ' MB' : Math.round(b.size / 1024) + ' KB';
    const dt = new Date(b.mtime).toLocaleString('th-TH', { hour12: false });
    return `<div class="bk-row">
      <span class="bk-name">${escapeHtml(b.filename)}</span>
      <span style="color:var(--dim)">${dt}</span>
      <span style="color:var(--dim);min-width:62px;text-align:right">${sz}</span>
      <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" data-action="downloadBackup" data-filename="${escapeHtml(b.filename)}">${escapeHtml(I18N.t('bk.download'))}</button>
    </div>`;
  }).join('');
}

async function runBackup() {
  const btn = document.getElementById('backupRunBtn');
  const msg = document.getElementById('backupRunMsg');
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('bk.backingUp'); }
  if (msg) { msg.style.color = 'var(--dim)'; msg.textContent = I18N.t('bk.runningPgDump'); }
  try {
    const res = await fetch(`${API}/api/backups/run`, { method: 'POST' });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || !r.ok) throw new Error(r.error || 'HTTP ' + res.status);
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = I18N.t('bk.backupOk'); }
    await loadBackups();
  } catch (e) {
    if (msg) { msg.style.color = 'var(--amber)'; msg.textContent = I18N.t('bk.backupFail') + e.message; }
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
const _navBadge = { events: 0, faces: 0 };

function renderNavBadge(key) {
  const el = document.getElementById('badge-' + key);
  if (!el) return;
  const n = _navBadge[key] || 0;
  if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.classList.add('show'); }
  else       { el.classList.remove('show'); }
}
function bumpNavBadge(key)  { _navBadge[key] = (_navBadge[key] || 0) + 1; renderNavBadge(key); }
function clearNavBadge(key) { _navBadge[key] = 0; renderNavBadge(key); }

// Toast — throttled: events within a 1s window coalesce into one
// "▲ N เหตุการณ์ใหม่" toast so a burst doesn't flood the stack.
let _toastQueue = [];
let _toastTimer = null;
function queueToast(item) {
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
    + `<div class="tt">${icon || '🔔'} ${escapeHtml(title || '')}</div>`
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
        if (document.getElementById('page-snapshots')?.classList.contains('active')) {
          setTimeout(() => {
            if (document.getElementById('page-snapshots')?.classList.contains('active') && _snapPage === 1) {
              loadSnapshots(1);
            }
          }, 2500);
        }
        // Notification — an incident (event carrying a rule_name)
        // arriving while the user is NOT on the Live page → toast +
        // nav badge. Metric/analytics events have no rule_name → silent.
        if (d.event.rule_name && String(d.event.rule_name).trim() && !onEventsPage) {
          bumpNavBadge('events');
          const _tt = d.event.event_time
            ? new Date(d.event.event_time).toLocaleTimeString('th-TH', { hour12: false })
            : '';
          queueToast({ icon: '🚨', title: d.event.rule_name,
            sub: `${d.event.camera_id || ''}${_tt ? ' · ' + _tt : ''}`, page: 'events' });
        }
        // Map Live Pulse (T2) — additive, independent of corner toast.
        if (d.event.rule_name && String(d.event.rule_name).trim()) _handleMapPulse(d.event);
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
          queueToast({ icon: '🙂', title: I18N.t('aux.toastNewFace'),
            sub: d.event.camera_id || '', page: 'faces' });
        }
        _handleMapFaceCard(d.event);
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
        if (document.getElementById('page-snapshots')?.classList.contains('active')) {
          renderSnapshots();   // refresh badges
        }
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
// Groups Bar (shows on every page)
// ============================================================

function renderGroupBars() {
  const html = renderGroupBarHTML({ includeManager: true });
  ['grpBar', 'grpBarEvents', 'grpBarSnap', 'grpBarMedia', 'grpBarMap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
  const statsEl = document.getElementById('grpBarStats');
  if (statsEl) statsEl.innerHTML = renderGroupBarHTML({ includeManager: false });
}

function renderGroupBarHTML(opts) {
  opts = opts || {};
  const all = `<button class="gtab ${activeGroupId === 'all' ? 'active' : ''}" data-action="setActiveGroup" data-gid="all">
    ALL <span class="tc">${cameras.length}</span></button>`;

  const grps = groups.map(g => {
    const count = g.cameraIds.length;
    const active = activeGroupId === g.id ? 'active' : '';
    const colorBox = g.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color}"></span>` : '';
    return `<button class="gtab ${active}" data-action="setActiveGroup" data-gid="${g.id}">${colorBox} ${escapeHtml(g.name)} <span class="tc">${count}</span></button>`;
  }).join('');

  const mgr = `<button class="gtab mgr" data-action="openGroupManager">${escapeHtml(I18N.t('aux.manageGroups'))}</button>`;

  return all + grps + (opts.includeManager === false ? '' : mgr);
}

function setActiveGroup(gid) {
  activeGroupId = gid;
  renderGroupBars();
  // Re-render current page
  const activePage = document.querySelector('.page.active').id.replace('page-', '');
  if (activePage === 'cameras') { renderCameraGrid(); updateKPIs(); }
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
    el.innerHTML = `<div style="color:var(--dim);font-size:11px;text-align:center;padding:20px">${escapeHtml(I18N.t('grp.noGroups'))}</div>`;
    return;
  }
  el.innerHTML = groups.map(g => {
    const sel = editingGroupId === g.id ? 'sel' : '';
    return `
      <div class="gli ${sel}" data-action="editGroup" data-gid="${g.id}">
        <div>
          <div class="gli-name">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color || 'var(--accent)'};margin-right:6px"></span>
            ${g.name}
          </div>
          <div class="gli-meta">${g.cameraIds.length} cameras</div>
        </div>
        <div class="gli-actions">
          <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" data-action="deleteGroup" data-gid="${g.id}">${escapeHtml(I18N.t('common.delete'))}</button>
        </div>
      </div>`;
  }).join('');
}

function showEditorPlaceholder() {
  document.getElementById('grpEditor').innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:var(--dim)">
      <div style="font-size:32px;opacity:0.3">👥</div>
      <p style="margin-top:10px;font-size:12px">${I18N.t('grp.pickToEdit')}</p>
    </div>`;
}

function newGroup() {
  editingGroupId = '__new__';
  editorSelectedCams = new Set();
  renderGroupList();
  renderGroupEditor('', editorSelectedCams, '#5b8def');
}

function editGroup(gid) {
  const g = groups.find(x => x.id === gid);
  if (!g) return;
  editingGroupId = gid;
  editorSelectedCams = new Set(g.cameraIds || []);
  renderGroupList();
  renderGroupEditor(g.name, editorSelectedCams, g.color || '#5b8def');
}

function renderGroupEditor(name, selectedCams, color) {
  const camList = cameras.map(c => {
    const sel = selectedCams.has(c.camera_id) ? 'sel' : '';
    return `
      <div class="grp-cam-item ${sel}" data-action="toggleCamInGroup" data-cam-id="${c.camera_id}">
        <input type="checkbox" ${selectedCams.has(c.camera_id) ? 'checked' : ''} style="accent-color:var(--accent)">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">${c.camera_name || c.camera_id}</div>
          <div style="font-size:10px;color:var(--dim)">${c.camera_id} · ${c.ip_address || '—'}</div>
        </div>
        <span class="badge ${c.status === 'online' ? 'badge-online' : 'badge-offline'}" style="font-size:9px">${c.status === 'online' ? 'ON' : 'OFF'}</span>
      </div>`;
  }).join('') || `<div style="color:var(--dim);font-size:11px;text-align:center;padding:20px">${escapeHtml(I18N.t('grp.noCameras'))}</div>`;

  const colors = ['#5b8def', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#06b6d4', '#ec4899'];
  const colorPicker = colors.map(c =>
    `<button data-action="setGrpColor" data-color="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};border:2px solid ${color === c ? '#fff' : 'transparent'};cursor:pointer;margin-right:4px"></button>`
  ).join('');

  document.getElementById('grpEditor').innerHTML = `
    <h3 style="font-size:14px;margin-bottom:14px">${editingGroupId === '__new__' ? I18N.t('grp.editorNew') : I18N.t('grp.editorEdit')}</h3>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.fldName'))}</label>
      <input id="grpName" type="text" class="form-input" placeholder="${escapeHtml(I18N.t('grp.namePh'))}" value="${name}">
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.fldColor'))}</label>
      <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
        ${colorPicker}
        <input id="grpColor" type="hidden" value="${color}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">${escapeHtml(I18N.t('grp.pickCameras'))} <span style="color:var(--accent)" id="selCount">(${selectedCams.size}/${cameras.length})</span></label>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:10px" data-action="selectAllCams">${escapeHtml(I18N.t('grp.selectAll'))}</button>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:10px" data-action="clearAllCams">${escapeHtml(I18N.t('grp.clearAll'))}</button>
      </div>
      <div class="grp-cam-list">${camList}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" data-action="saveGroup">${escapeHtml(I18N.t('common.saveBtn'))}</button>
      <button class="btn btn-secondary" data-action="cancelEditGroup">${escapeHtml(I18N.t('common.cancel'))}</button>
    </div>`;
}

function toggleCamInGroup(camId) {
  if (editorSelectedCams.has(camId)) editorSelectedCams.delete(camId);
  else editorSelectedCams.add(camId);
  // Re-render editor only (keep input value)
  const name = document.getElementById('grpName')?.value || '';
  const color = document.getElementById('grpColor')?.value || '#5b8def';
  renderGroupEditor(name, editorSelectedCams, color);
}

function selectAllCams() {
  editorSelectedCams = new Set(cameras.map(c => c.camera_id));
  const name = document.getElementById('grpName')?.value || '';
  const color = document.getElementById('grpColor')?.value || '#5b8def';
  renderGroupEditor(name, editorSelectedCams, color);
}

function clearAllCams() {
  editorSelectedCams = new Set();
  const name = document.getElementById('grpName')?.value || '';
  const color = document.getElementById('grpColor')?.value || '#5b8def';
  renderGroupEditor(name, editorSelectedCams, color);
}

async function saveGroup() {
  const name = document.getElementById('grpName').value.trim();
  const color = document.getElementById('grpColor').value;
  if (!name) { alert(I18N.t('grp.needName')); return; }

  const data = {
    id: editingGroupId === '__new__' ? null : editingGroupId,
    name, color,
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
    toast.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--green);color:white;padding:10px 18px;border-radius:8px;z-index:2000;font-weight:600';
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
}

// ============================================================
// Cameras Page
// ============================================================

async function loadCameras() {
  try {
    const res = await fetch(`${API}/api/cameras`);
    cameras = await res.json();
    document.getElementById('cameraCount').textContent = cameras.length;
    renderGroupBars();
    renderCameraGrid();
    updateKPIs();
  } catch (e) { console.error(e); }
}

function renderCameraGrid() {
  const grid = document.getElementById('cameraGrid');
  const groupList = getActiveGroupCameras();
  // Search filter (case-insensitive across name / id / ip / location). Empty
  // query passes everything through — preserves the existing UX for small
  // fleets while making 100+ camera deployments navigable.
  const q = (document.getElementById('camSearch')?.value || '').trim().toLowerCase();
  const camsList = q
    ? groupList.filter(c =>
        (c.camera_name || '').toLowerCase().includes(q) ||
        (c.camera_id   || '').toLowerCase().includes(q) ||
        (c.ip_address  || '').toLowerCase().includes(q) ||
        (c.location    || '').toLowerCase().includes(q))
    : groupList;

  const countEl = document.getElementById('camSearchCount');
  if (countEl) {
    countEl.textContent = q
      ? I18N.t('cam.ofTotal').replace('{n}', camsList.length).replace('{total}', groupList.length)
      : (groupList.length ? I18N.t('cam.countCameras').replace('{n}', groupList.length) : '');
  }

  if (camsList.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--dim);">
      ${cameras.length === 0 ? I18N.t('cam.noneYet')
        : q ? I18N.t('cam.noMatch').replace('{q}', escapeHtml(q)) : I18N.t('cam.groupEmpty')}
    </div>`;
    return;
  }
  grid.innerHTML = camsList.map(c => {
    const online = c.status === 'online';
    const paused = c.status === 'paused';
    const statusBadge = paused
      ? `<span class="badge badge-paused"><svg width="10" height="10" aria-hidden="true" style="vertical-align:-1px;margin-right:3px"><use href="#icon-pause"/></svg>${escapeHtml(I18N.t('cam.paused'))}</span>`
      : `<span class="badge ${online ? 'badge-online' : 'badge-offline'}">${online ? 'ONLINE' : 'OFFLINE'}</span>`;
    const badges = [statusBadge];
    if (!paused && c.recording) badges.push(`<span class="badge badge-recording">REC</span>`);

    // Use server-side "today" counts (covers all events in TZ, not just the
    // 300-row allEvents cache). Falls back to allEvents if endpoint not loaded yet.
    const tc = _todayCounts.cameras[c.camera_id];
    const camEvents = allEvents.filter(e => e.camera_id === c.camera_id);
    const lastEvent = camEvents[0];
    const evToday      = tc ? tc.total   : camEvents.length;
    const personsToday = tc ? tc.persons : camEvents.filter(e => e.object_class === 'Person').length;
    const lastTimeStr  = (tc && tc.last_event)
      ? new Date(tc.last_event).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',hour12:false})
      : (lastEvent ? new Date(lastEvent.event_time).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',hour12:false}) : '—');

    // loading="lazy" lets the browser defer the snapshot fetch until the card
    // is near the viewport. On a 100-camera deployment that's the difference
    // between 100 simultaneous /api/snapshot/live calls on page load
    // (saturating the api-server's outbound HTTP pool) and ~10-20 visible-
    // viewport fetches. decoding="async" further unblocks layout.
    return `
      <div class="cam-card" data-camera-id="${escapeHtml(c.camera_id)}">
        <div class="cam-card-img">
          ${paused
            ? `<div class="placeholder cam-placeholder-paused" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#111"><svg width="32" height="32" style="color:var(--text-secondary);opacity:.5"><use href="#icon-pause"/></svg><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(I18N.t('cam.maintenance'))}</span></div>`
            : online && c.ip_address
              ? `<img loading="lazy" decoding="async" src="${API}/api/snapshot/live/${c.camera_id}?w=400&t=${Date.now()}" alt="" data-err="cam-placeholder">`
              : `<div class="placeholder">${online ? I18N.t('cam.noIp') : 'Offline'}</div>`}
          <div class="cam-status-badges">${badges.join('')}</div>
        </div>
        <div class="cam-card-body">
          <div class="cam-card-name">${c.camera_name || c.camera_id}</div>
          <div class="cam-card-meta">${c.camera_id} · ${c.ip_address || '—'} · ${c.location || '—'}</div>
          <div class="cam-card-stats">
            <div class="cam-stat"><div class="cam-stat-num cam-stat-events" style="color: var(--accent)">${evToday}</div><div class="cam-stat-label">${I18N.t('cam.eventsTodayShort')}</div></div>
            <div class="cam-stat"><div class="cam-stat-num cam-stat-persons" style="color: var(--green)">${personsToday}</div><div class="cam-stat-label">${I18N.t('cam.people')}</div></div>
            <div class="cam-stat"><div class="cam-stat-num cam-stat-status" style="color: ${online ? 'var(--green)' : 'var(--red)'}">${online ? '✓' : '✗'}</div><div class="cam-stat-label cam-stat-lastseen">${lastTimeStr}</div></div>
          </div>
        </div>
      </div>`;
  }).join('');
  // Attach the delegated click → open detail-modal handler once. Safe to
  // call repeatedly — the inner _camCardClickWired flag short-circuits.
  wireCameraCardClick();
}

// ── EULA viewer + acceptance (Phase 8.1) ──────────────────────
// Minimal markdown→HTML renderer for our EULA file. Handles what the
// EULA actually uses (#/##/### headings, ** bold, > blockquote, ---
// hr, paragraphs, raw <sub>) — not a general MD parser. Keeps the
// dashboard zero-dep on this front.
function _renderEulaMarkdown(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const inline = (s) => s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  while (i < lines.length) {
    const line = lines[i];
    if (/^---\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (line.startsWith('> ')) {
      const bq = [];
      while (i < lines.length && lines[i].startsWith('> ')) { bq.push(lines[i].substring(2)); i++; }
      out.push(`<blockquote>${inline(bq.join('<br>'))}</blockquote>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|---|>\s)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const _eulaCache = {};
async function _loadEulaHtml() {
  const lang = I18N.getLang();
  if (_eulaCache[lang]) return _eulaCache[lang];
  try {
    const r = await fetch(`${API}/api/eula?lang=${encodeURIComponent(lang)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _eulaCache[lang] = _renderEulaMarkdown(await r.text());
    return _eulaCache[lang];
  } catch (e) {
    return `<p style="color:var(--red)">${escapeHtml(I18N.t('aux.eulaLoadFailed'))}${escapeHtml(e.message)}</p>`;
  }
}

function openEulaViewer() {
  const m = document.getElementById('eulaViewerModal');
  const body = document.getElementById('eulaViewerBody');
  m.classList.remove('hidden');
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  _loadEulaHtml().then(html => { body.innerHTML = html; });
}
function closeEulaViewer() {
  document.getElementById('eulaViewerModal').classList.add('hidden');
}

function openEulaAcceptModal() {
  const m = document.getElementById('eulaAcceptModal');
  const body = document.getElementById('eulaAcceptBody');
  const chk = document.getElementById('eulaAcceptCheck');
  const btn = document.getElementById('eulaAcceptBtn');
  const err = document.getElementById('eulaAcceptError');
  const hint = document.getElementById('eulaScrollHint');
  if (chk) { chk.checked = false; chk.disabled = true; }
  if (btn) btn.disabled = true;
  if (err) err.style.display = 'none';
  if (hint) hint.style.display = '';
  m.classList.remove('hidden');
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  _loadEulaHtml().then(html => {
    body.innerHTML = html;
    // Re-scroll to top so the user starts reading from the beginning.
    body.scrollTop = 0;
    _watchEulaAcceptScroll();
  });
}

// Lock the "ยอมรับ" checkbox until the operator has scrolled the EULA
// body to its bottom. Re-checks on every scroll event; also auto-unlocks
// if the rendered content is shorter than the viewport (no scroll needed).
function _watchEulaAcceptScroll() {
  const body = document.getElementById('eulaAcceptBody');
  const chk  = document.getElementById('eulaAcceptCheck');
  const hint = document.getElementById('eulaScrollHint');
  if (!body || !chk) return;
  function update() {
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 10;
    chk.disabled = !atBottom;
    if (hint) hint.style.display = atBottom ? 'none' : '';
  }
  // Replace any previous scroll listener so re-opens don't stack handlers.
  body.onscroll = update;
  // Run once after the layout settles, in case the content already fits.
  setTimeout(update, 50);
}
function closeEulaAcceptModal() {
  document.getElementById('eulaAcceptModal').classList.add('hidden');
}

async function acceptEula() {
  const err = document.getElementById('eulaAcceptError');
  try {
    const r = await fetch(`${API}/api/eula/accept`, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      err.textContent = '❌ ' + (e.error || `HTTP ${r.status}`);
      err.style.display = 'block';
      return;
    }
    closeEulaAcceptModal();
  } catch (e) {
    err.textContent = '❌ ' + e.message;
    err.style.display = 'block';
  }
}

// Boot gate: if EULA hasn't been accepted yet and the current user is
// admin, block usage until they accept. The check uses the public
// /api/eula/status (no auth) so it works even if other endpoints are
// 403'd by the license layer.
async function eulaBootGate() {
  try {
    const r = await fetch(`${API}/api/eula/status`, { cache: 'no-store' });
    if (!r.ok) return;
    const s = await r.json();
    if (s.accepted) return;
    // Admin must accept first; viewers + auditors can't legally bind the
    // deployment, so they skip the blocking modal.
    if (!currentUser || currentUser.role !== 'admin') return;
    openEulaAcceptModal();
  } catch {}
}

// ── License management UI (Phase 8.0 slice 3) ──────────────────
// Modal accessible from User menu (🔐 License). Auto-popups at trial
// expiry / license expiry / invalid state — once per browser session
// so we don't nag a user who's already aware.
const _LICENSE_AUTO_POPUP_KEY = 'dojojin-license-auto-popup-shown';
let _licenseStatusCache = null;
let _licenseAutoCheckTimer = null;

async function refreshLicenseStatus() {
  try {
    const r = await fetch(`${API}/api/license/status`, { cache: 'no-store' });
    if (!r.ok) { _licenseStatusCache = null; return null; }
    _licenseStatusCache = await r.json();
    return _licenseStatusCache;
  } catch { _licenseStatusCache = null; return null; }
}

function openLicenseModal() { openSettings(); settingsNav('license'); }

function closeLicenseModal() { /* license is a Settings Workspace section now — no modal */ }

function _licenseStateMeta(mode) {
  return {
    LICENSED:          { color: '#22c55e', label: '🟢 Activated' },
    TRIAL:             { color: '#f59e0b', label: '🟡 Trial' },
    TRIAL_NOT_STARTED: { color: '#94a3b8', label: '⚪ Not Started' },
    TRIAL_EXPIRED:     { color: '#ef4444', label: '🔴 Trial Expired' },
    GRACE:             { color: '#f97316', label: '🟠 Grace Period' },
    EXPIRED:           { color: '#ef4444', label: '🔴 License Expired' },
    INVALID:           { color: '#ef4444', label: '🔴 Invalid License' },
  }[mode] || { color: '#94a3b8', label: mode || 'Unknown' };
}

function _licenseStateDetailHtml(status) {
  const m = status.mode;
  if (m === 'LICENSED' && status.license_info)
    return I18N.t('lic.detailLicensed').replace('{n}', status.license_info.days_left);
  if (m === 'TRIAL' && status.trial)
    return I18N.t('lic.detailTrial').replace('{n}', status.trial.days_left);
  if (m === 'TRIAL_NOT_STARTED')
    return I18N.t('lic.detailNotStarted');
  if (m === 'TRIAL_EXPIRED')
    return I18N.t('lic.detailTrialExpired');
  if (m === 'GRACE' && status.grace)
    return I18N.t('lic.detailGrace')
      .replace('{over}', status.grace.days_over).replace('{left}', status.grace.grace_left);
  if (m === 'EXPIRED' && status.expired)
    return I18N.t('lic.detailExpired').replace('{n}', status.expired.days_over);
  if (m === 'INVALID') {
    const reasons = {
      machine_mismatch:        I18N.t('lic.reasonMachineMismatch'),
      invalid_signature:       I18N.t('lic.reasonInvalidSig'),
      expired:                 I18N.t('lic.reasonExpired'),
      malformed:               I18N.t('lic.reasonMalformed'),
      no_key:                  I18N.t('lic.reasonNoKey'),
      public_key_not_configured: I18N.t('lic.reasonNoPubKey'),
    };
    const r = status.invalid?.reason;
    return I18N.t('lic.reasonPrefix') + escapeHtml(reasons[r] || r || 'unknown');
  }
  return '';
}

function renderLicenseModalContent(status) {
  const body = document.getElementById('licenseModalBody');
  if (!body) return;
  if (!status) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">${escapeHtml(I18N.t('lic.loadFailed'))}</div>`;
    return;
  }
  const meta = _licenseStateMeta(status.mode);
  const machineId = status.machine_id || '—';

  // 1) Status banner — colored strip at top
  const banner = `
    <div style="background:${meta.color}1a;border-left:4px solid ${meta.color};padding:12px 14px;border-radius:6px;margin-bottom:14px">
      <div style="font-size:14px;color:${meta.color};font-weight:bold;margin-bottom:4px">${meta.label}</div>
      <div style="font-size:12px;color:var(--text);line-height:1.6">${_licenseStateDetailHtml(status)}</div>
    </div>`;

  // 2) License info table — only when activated
  let licenseInfoBlock = '';
  if (status.license_info && status.mode !== 'INVALID') {
    const li = status.license_info;
    const expDate = li.expires_at ? new Date(li.expires_at).toLocaleDateString('th-TH') : '—';
    const issDate = li.issued_at ? new Date(li.issued_at).toLocaleDateString('th-TH') : '—';
    licenseInfoBlock = `
      <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--dim);margin-bottom:8px">License Information</div>
        <table style="font-size:13px;width:100%;border-collapse:collapse">
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0;width:38%">Licensed to</td><td style="padding:4px 0"><strong>${escapeHtml(li.customer || '—')}</strong></td></tr>
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0">Customer ID</td><td style="padding:4px 0;font-family:monospace">${escapeHtml(li.customer_id || '—')}</td></tr>
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0">Tier</td><td style="padding:4px 0"><span style="background:rgba(91,141,239,0.15);color:var(--accent);padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(li.tier || '—')}</span></td></tr>
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0">Max cameras</td><td style="padding:4px 0">${li.max_cameras ?? '—'}</td></tr>
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0">Issued</td><td style="padding:4px 0">${escapeHtml(issDate)}</td></tr>
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0">Valid until</td><td style="padding:4px 0">${escapeHtml(expDate)}</td></tr>
          <tr><td style="color:var(--dim);padding:4px 8px 4px 0">Days left</td><td style="padding:4px 0;font-weight:bold;color:${meta.color}">${li.days_left ?? '—'}</td></tr>
        </table>
      </div>`;
  }

  // 3) Machine ID — always shown
  const machineIdBlock = `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;color:var(--dim);margin-bottom:6px">${escapeHtml(I18N.t('lic.machineIdLabel'))}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <code style="flex:1;font-family:monospace;font-size:13px;padding:7px 10px;background:rgba(0,0,0,0.3);border-radius:4px;letter-spacing:1px;min-width:240px">${escapeHtml(machineId)}</code>
        <button class="btn btn-secondary" style="font-size:11px;padding:7px 14px;white-space:nowrap" data-action="copyMachineId" data-machine-id="${escapeHtml(machineId)}">📋 Copy</button>
      </div>
      <div style="font-size:10px;color:var(--dim);margin-top:6px">${escapeHtml(I18N.t('lic.machineIdHint'))}</div>
    </div>`;

  // 4) Activate / renew form
  const isRenewing = status.mode === 'LICENSED';
  const activateForm = `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:14px">
      <div style="font-size:11px;color:var(--dim);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <span>${isRenewing ? I18N.t('lic.renewHeader') : I18N.t('lic.activateHeader')}</span>
        <a href="#" data-action="openEulaViewer" style="color:var(--accent);text-decoration:none;font-size:11px">${escapeHtml(I18N.t('lic.readEula'))}</a>
      </div>
      ${!isRenewing ? `
      <div style="font-size:11px;color:var(--text);line-height:1.8;margin-bottom:10px;padding:8px 12px;background:rgba(91,141,239,0.08);border-radius:5px">
        ${I18N.t('lic.howToGet')}
      </div>` : ''}
      <textarea id="licenseKeyInput" placeholder="${escapeHtml(I18N.t('lic.keyPlaceholder'))}"
                style="width:100%;min-height:90px;padding:10px;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:5px;color:var(--text);font-family:monospace;font-size:11px;resize:vertical;box-sizing:border-box;line-height:1.4"></textarea>
      <label style="display:flex;align-items:flex-start;gap:8px;margin-top:10px;cursor:pointer;font-size:11px;line-height:1.5">
        <input type="checkbox" id="licenseEulaAccept" data-change="eulaToggle" style="margin-top:2px;flex-shrink:0">
        <span>${escapeHtml(I18N.t('lic.eulaAcceptPre'))} <a href="#" data-action="openEulaViewer" style="color:var(--accent)">${escapeHtml(I18N.t('lic.eulaLinkText'))}</a></span>
      </label>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="licenseActivateBtn" style="flex:1;min-width:140px" data-action="activateLicense" disabled>🔐 ${isRenewing ? I18N.t('lic.btnRenew') : 'Activate License'}</button>
        ${isRenewing ? `<button class="btn btn-secondary" data-action="deactivateLicense" title="${escapeHtml(I18N.t('lic.deactivateTitle'))}">🗑️ Deactivate</button>` : ''}
      </div>
      <div id="licenseActivateError" style="margin-top:10px;font-size:12px;display:none;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:#ef4444"></div>
    </div>`;

  body.innerHTML = banner + licenseInfoBlock + machineIdBlock + activateForm;
}

async function activateLicense() {
  const inputEl = document.getElementById('licenseKeyInput');
  const errEl = document.getElementById('licenseActivateError');
  const key = (inputEl?.value || '').trim();
  errEl.style.display = 'none';
  if (!key) {
    errEl.textContent = I18N.t('lic.needKey');
    errEl.style.display = 'block';
    return;
  }
  try {
    const r = await fetch(`${API}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const reasons = {
        machine_mismatch:  I18N.t('lic.errMachineMismatch').replace('{id}', err.current_machine_id || '—'),
        invalid_signature: I18N.t('lic.errInvalidSig'),
        expired:           I18N.t('lic.errExpired'),
        malformed:         I18N.t('lic.errMalformed'),
      };
      errEl.innerHTML = reasons[err.reason] || ('❌ ' + (err.error || `HTTP ${r.status}`));
      errEl.style.display = 'block';
      return;
    }
    // Success — refresh content
    sessionStorage.removeItem(_LICENSE_AUTO_POPUP_KEY);
    refreshLicenseStatus().then(s => {
      renderLicenseModalContent(s);
      // Brief success feedback at the top
      const body = document.getElementById('licenseModalBody');
      const ok = document.createElement('div');
      ok.style.cssText = 'position:sticky;top:0;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.5);color:#22c55e;padding:10px;border-radius:5px;margin-bottom:12px;text-align:center;font-weight:bold';
      ok.textContent = I18N.t('lic.activateOk');
      body.insertBefore(ok, body.firstChild);
      setTimeout(() => ok.remove(), 3500);
    });
  } catch (e) {
    errEl.textContent = '❌ ' + e.message;
    errEl.style.display = 'block';
  }
}

async function deactivateLicense() {
  if (!confirm(I18N.t('lic.confirmDeactivate'))) return;
  try {
    const r = await fetch(`${API}/api/license/deactivate`, { method: 'POST' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    sessionStorage.removeItem(_LICENSE_AUTO_POPUP_KEY);
    refreshLicenseStatus().then(s => renderLicenseModalContent(s));
  } catch (e) { alert(I18N.t('lic.deactivateFailed') + e.message); }
}

function copyMachineId(id, ev) {
  navigator.clipboard.writeText(id).then(() => {
    const btn = ev?.target?.closest('button');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Copied';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    }
  }).catch(() => {
    // Fallback: select the code so user can ctrl-c
    alert(I18N.t('lic.copyFailed'));
  });
}

// Auto-popup on a "bad" state (once per browser session).
async function licenseAutoCheck() {
  const s = await refreshLicenseStatus();
  if (!s) return;
  if (s.mode === 'LICENSED')          return; // healthy
  if (s.mode === 'TRIAL_NOT_STARTED') return; // pre-setup, no nag
  if (s.mode === 'TRIAL' && (s.trial?.days_left ?? 99) > 1) return; // still ok
  if (sessionStorage.getItem(_LICENSE_AUTO_POPUP_KEY)) return; // already nagged once
  sessionStorage.setItem(_LICENSE_AUTO_POPUP_KEY, '1');
  openLicenseModal();
}

function startLicenseAutoCheck() {
  licenseAutoCheck();
  if (_licenseAutoCheckTimer) clearInterval(_licenseAutoCheckTimer);
  // Re-check every 5 minutes — long-running sessions need to see the
  // state flip from TRIAL → TRIAL_EXPIRED, or LICENSED → GRACE, when
  // they cross the boundary mid-session.
  _licenseAutoCheckTimer = setInterval(licenseAutoCheck, 5 * 60 * 1000);
}

// ── Camera detail modal (Phase C.8) ────────────────────────────
// Click a card on Camera Status → open a focused view for that single
// camera: live snapshot (auto-refreshing while open), key info, today's
// counts, and the 20 most-recent events. Reuses existing endpoints
// (/api/snapshot/live, /api/events, _todayCounts) so no new backend
// surface. Closed via ✕, clicking the backdrop, or pressing Escape.
let _camDetailRefreshTimer = null;
let _camDetailCameraId = null;
let _camCardClickWired = false;

function wireCameraCardClick() {
  if (_camCardClickWired) return;
  const grid = document.getElementById('cameraGrid');
  if (!grid) return;
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.cam-card');
    if (!card || !card.dataset.cameraId) return;
    openCameraDetailModal(card.dataset.cameraId);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _camDetailCameraId) closeCameraDetailModal();
  });
  _camCardClickWired = true;
}

function openCameraDetailModal(cameraId) {
  const c = cameras.find(x => x.camera_id === cameraId);
  if (!c) return;
  _camDetailCameraId = cameraId;
  document.getElementById('camDetailTitle').textContent =
    `📷 ${c.camera_name || c.camera_id}`;
  document.getElementById('cameraDetailModal').classList.remove('hidden');
  renderCameraDetail(c);
  // Auto-refresh every 10s while the modal is open (snapshot + recent
  // events). Cleared in closeCameraDetailModal so it doesn't keep firing
  // after the user closes it.
  if (_camDetailRefreshTimer) clearInterval(_camDetailRefreshTimer);
  _camDetailRefreshTimer = setInterval(() => {
    const cur = cameras.find(x => x.camera_id === _camDetailCameraId);
    if (cur) renderCameraDetail(cur);
  }, 10000);
}

function closeCameraDetailModal() {
  document.getElementById('cameraDetailModal').classList.add('hidden');
  if (_camDetailRefreshTimer) {
    clearInterval(_camDetailRefreshTimer);
    _camDetailRefreshTimer = null;
  }
  _camDetailCameraId = null;
}

async function renderCameraDetail(c) {
  const body = document.getElementById('camDetailBody');
  if (!body) return;

  // Fetch last 20 events for this camera (server-side filter).
  let events = [];
  try {
    const res = await fetch(
      `${API}/api/events?camera=${encodeURIComponent(c.camera_id)}&limit=20`,
      { cache: 'no-store' });
    if (res.ok) events = await res.json();
  } catch {}

  const tc = _todayCounts.cameras[c.camera_id] || { total: 0, persons: 0 };
  const vehiclesToday = events.filter(e =>
    /Vehicle|Car|Truck|Bus|Motor|Van|Bike|Bicycle/.test(e.object_class || ''))
    .length;
  const online = c.status === 'online';
  const isPaused = c.status === 'paused';
  const statusBadge = isPaused
    ? `<span class="badge badge-paused"><svg width="10" height="10" aria-hidden="true" style="vertical-align:-1px;margin-right:3px"><use href="#icon-pause"/></svg>${escapeHtml(I18N.t('cam.paused'))}</span>`
    : (`<span class="badge ${online ? 'badge-online' : 'badge-offline'}">${online ? 'ONLINE' : 'OFFLINE'}</span>`
      + (c.recording ? ' <span class="badge badge-recording">REC</span>' : ''));

  const lastSeenStr = c.last_seen
    ? new Date(c.last_seen).toLocaleString('th-TH',
        { timeZone: 'Asia/Bangkok', hour12: false })
    : '—';

  // Per-rule count from the last-20-events sample. Cheap and immediate;
  // a longer-range version would need a separate query — defer.
  const perRule = {};
  for (const e of events) {
    const r = e.rule_name || '(no rule)';
    perRule[r] = (perRule[r] || 0) + 1;
  }
  const perRuleRows = Object.entries(perRule)
    .sort((a, b) => b[1] - a[1])
    .map(([rule, n]) =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px">
        <span>${escapeHtml(rule)}</span><span style="color:var(--accent);font-weight:bold">${n}</span>
       </div>`).join('');

  // Phase 2 — live-snapshot "view full" (capped per camera; native otherwise)
  const cdCap = camFullViewWidth(c.camera_id);
  const cdLiveFullUrl = `${API}/api/snapshot/live/${encodeURIComponent(c.camera_id)}` + (cdCap ? `?w=${cdCap}` : '');

  body.innerHTML = `
    <div class="cd-hero-grid" style="display:grid;grid-template-columns:minmax(280px,1.2fr) 1fr;gap:16px;margin-bottom:16px">
      <!-- Live snapshot — ?w=640 thumbnail; full image via the button below -->
      <div>
        <div style="background:#000;border-radius:8px;overflow:hidden;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center">
          ${isPaused
            ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:100%;height:100%"><svg width="40" height="40" style="color:var(--text-secondary);opacity:.45"><use href="#icon-pause"/></svg><span style="font-size:12px;color:var(--text-secondary)">${escapeHtml(I18N.t('cam.maintenance'))}</span></div>`
            : online && c.ip_address
              ? `<img src="${API}/api/snapshot/live/${encodeURIComponent(c.camera_id)}?w=640&t=${Date.now()}" alt="" style="width:100%;height:100%;object-fit:contain" data-err="cam-span">`
              : `<span style="color:var(--dim);font-size:13px">${online ? escapeHtml(I18N.t('cam.noIp')) : 'Offline'}</span>`}
        </div>
        ${online && c.ip_address
          ? `<button class="btn btn-secondary" style="font-size:11px;margin-top:8px" data-action="openUrl" data-url="${escapeHtml(cdLiveFullUrl)}">${escapeHtml(I18N.t('snap.viewFull'))}${cdCap ? ` (${cdCap}px)` : ''}</button>`
          : ''}
      </div>
      <!-- Info + KPI -->
      <div>
        <div style="margin-bottom:10px">${statusBadge}</div>
        <table style="font-size:13px;border-collapse:collapse;width:100%">
          <tr><td style="color:var(--dim);padding:3px 8px 3px 0;white-space:nowrap">Camera ID</td><td style="padding:3px 0;font-family:monospace">${escapeHtml(c.camera_id)}</td></tr>
          <tr><td style="color:var(--dim);padding:3px 8px 3px 0">IP Address</td><td style="padding:3px 0;font-family:monospace">${escapeHtml(c.ip_address || '—')}</td></tr>
          <tr><td style="color:var(--dim);padding:3px 8px 3px 0">Location</td><td style="padding:3px 0">${escapeHtml(c.location || '—')}</td></tr>
          <tr><td style="color:var(--dim);padding:3px 8px 3px 0">Last seen</td><td style="padding:3px 0">${escapeHtml(lastSeenStr)}</td></tr>
        </table>
        <div class="cd-kpi-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px">
          <div style="background:rgba(91,141,239,0.1);padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:22px;color:var(--accent);font-weight:bold">${tc.total}</div>
            <div style="font-size:10px;color:var(--dim)">${escapeHtml(I18N.t('cam.eventsTodayShort'))}</div>
          </div>
          <div style="background:rgba(34,197,94,0.1);padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:22px;color:var(--green);font-weight:bold">${tc.persons}</div>
            <div style="font-size:10px;color:var(--dim)">${escapeHtml(I18N.t('cam.people'))}</div>
          </div>
          <div style="background:rgba(245,158,11,0.1);padding:10px;border-radius:6px;text-align:center" title="${escapeHtml(I18N.t('cd.vehiclesTip'))}">
            <div style="font-size:22px;color:var(--amber);font-weight:bold">${vehiclesToday}</div>
            <div style="font-size:10px;color:var(--dim)">${escapeHtml(I18N.t('cd.vehicles'))}</div>
          </div>
        </div>
      </div>
    </div>

    ${perRuleRows ? `
    <h3 style="font-size:14px;margin:16px 0 8px;color:var(--text)">${escapeHtml(I18N.t('cd.perRuleTitle'))}</h3>
    <div style="background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:6px;margin-bottom:16px">${perRuleRows}</div>
    ` : ''}

    <h3 style="font-size:14px;margin:16px 0 8px;color:var(--text)">${escapeHtml(I18N.t('cd.recentEvents').replace('{n}', events.length))}</h3>
    <div style="background:rgba(255,255,255,0.03);border-radius:6px;overflow-x:auto">
      ${events.length === 0
        ? `<div style="text-align:center;padding:30px;color:var(--dim);font-size:13px">${escapeHtml(I18N.t('cd.noEvents'))}</div>`
        : `<table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="background:rgba(0,0,0,0.3)">
              <th style="padding:8px;text-align:left;color:var(--dim);font-weight:normal">${escapeHtml(I18N.t('evt.colTime'))}</th>
              <th style="padding:8px;text-align:left;color:var(--dim);font-weight:normal">Rule</th>
              <th style="padding:8px;text-align:left;color:var(--dim);font-weight:normal">Class</th>
              <th style="padding:8px;text-align:center;color:var(--dim);font-weight:normal">Snap</th>
              <th style="padding:8px;text-align:center;color:var(--dim);font-weight:normal">Clip</th>
            </tr></thead>
            <tbody>${events.map(e => `
              <tr style="border-top:1px solid rgba(255,255,255,0.04)">
                <td style="padding:6px 8px;font-family:monospace;white-space:nowrap">${new Date(e.event_time).toLocaleTimeString('th-TH',{hour12:false,timeZone:'Asia/Bangkok'})}</td>
                <td style="padding:6px 8px">${escapeHtml(e.rule_name || '-')}</td>
                <td style="padding:6px 8px">${escapeHtml(e.object_class || '-')}</td>
                <td style="padding:6px 8px;text-align:center">${e.snapshot_file ? `<a href="${API}/snapshots/${encodeURIComponent(e.snapshot_file)}" target="_blank" style="color:var(--accent);text-decoration:none">📷</a>` : '—'}</td>
                <td style="padding:6px 8px;text-align:center">${e.clip_file && e.clip_status === 'done' ? `<a href="${API}/media/${encodeURIComponent(e.clip_file)}" target="_blank" style="color:var(--accent);text-decoration:none">🎬</a>` : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>`}
    </div>
    <div style="font-size:10px;color:var(--dim);margin-top:8px;text-align:right">${escapeHtml(I18N.t('cd.footnote'))}</div>
  `;
}

// Incremental update of Camera Status cards — patches stats numbers + status
// badge in place without rebuilding the DOM. The full-rebuild path
// (renderCameraGrid) was being called from every WS event and every 60s
// today-counts refresh, which (a) is wasteful at 100+ cards and (b) used
// to silently no-op anyway because the call site referenced a
// `renderCameras` symbol that doesn't exist. Falls through to the full
// render when the visible camera set has changed (add/remove/search/group)
// since structural edits are still cheaper than diffing DOM trees.
function updateCameraGridStats() {
  const grid = document.getElementById('cameraGrid');
  if (!grid || !grid.querySelector('.cam-card')) { renderCameraGrid(); return; }
  const groupList = getActiveGroupCameras();
  const q = (document.getElementById('camSearch')?.value || '').trim().toLowerCase();
  const camsList = q
    ? groupList.filter(c =>
        (c.camera_name || '').toLowerCase().includes(q) ||
        (c.camera_id   || '').toLowerCase().includes(q) ||
        (c.ip_address  || '').toLowerCase().includes(q) ||
        (c.location    || '').toLowerCase().includes(q))
    : groupList;
  const cardById = {};
  for (const card of grid.querySelectorAll('.cam-card[data-camera-id]')) {
    cardById[card.dataset.cameraId] = card;
  }
  const visibleIds = camsList.map(c => c.camera_id);
  // Set mismatch → structural change → fall back to full render.
  if (visibleIds.length !== Object.keys(cardById).length ||
      visibleIds.some(id => !cardById[id])) {
    renderCameraGrid();
    return;
  }
  for (const c of camsList) {
    const card = cardById[c.camera_id];
    if (!card) continue;
    const tc = _todayCounts.cameras[c.camera_id];
    const camEvents = allEvents.filter(e => e.camera_id === c.camera_id);
    const lastEvent = camEvents[0];
    const evToday      = tc ? tc.total   : camEvents.length;
    const personsToday = tc ? tc.persons : camEvents.filter(e => e.object_class === 'Person').length;
    const lastTimeStr  = (tc && tc.last_event)
      ? new Date(tc.last_event).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',hour12:false})
      : (lastEvent ? new Date(lastEvent.event_time).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',hour12:false}) : '—');
    const evEl = card.querySelector('.cam-stat-events');
    const psEl = card.querySelector('.cam-stat-persons');
    const stEl = card.querySelector('.cam-stat-status');
    const lsEl = card.querySelector('.cam-stat-lastseen');
    if (evEl) evEl.textContent = evToday;
    if (psEl) psEl.textContent = personsToday;
    if (lsEl) lsEl.textContent = lastTimeStr;
    const online = c.status === 'online';
    const paused = c.status === 'paused';
    if (stEl) {
      stEl.innerHTML = paused
        ? '<svg width="12" height="12" aria-hidden="true"><use href="#icon-pause"/></svg>'
        : (online ? '✓' : '✗');
      stEl.style.color = paused ? 'var(--text-secondary)' : (online ? 'var(--status-ok)' : 'var(--status-bad)');
    }
    const badge = card.querySelector('.cam-status-badges .badge');
    if (badge) {
      badge.textContent = paused ? I18N.t('cam.paused') : (online ? 'ONLINE' : 'OFFLINE');
      badge.classList.toggle('badge-online',  online && !paused);
      badge.classList.toggle('badge-offline', !online && !paused);
      badge.classList.toggle('badge-paused',  paused);
    }
  }
  // Search counter — same source-of-truth as renderCameraGrid.
  const countEl = document.getElementById('camSearchCount');
  if (countEl) {
    countEl.textContent = q
      ? I18N.t('aux.camCountOf').replace('{n}', camsList.length).replace('{total}', groupList.length)
      : (groupList.length ? I18N.t('map.nCameras').replace('{n}', groupList.length) : '');
  }
}

// Phase 6.1.6 — server-side today-counts (was buggy client-side filter on the
// 300-row allEvents cache). Refresh on Camera page nav + every 60s + on each
// new_event WS message (incremental bump for live feel).
let _todayCounts = { total: 0, cameras: {}, tz: 'Asia/Bangkok' };
let _todayCountsTimer = null;

async function refreshTodayCounts() {
  try {
    const res = await fetch(`${API}/api/stats/today-counts`, { cache: 'no-store' });
    if (res.ok) {
      _todayCounts = await res.json();
      // Re-render Camera page if visible (cards depend on this)
      if (document.getElementById('page-cameras')?.classList.contains('active')) {
        updateCameraGridStats();
        updateKPIs();
      }
    }
  } catch {}
}

function startTodayCountsAutoRefresh() {
  if (_todayCountsTimer) return;
  _todayCountsTimer = setInterval(refreshTodayCounts, 60_000);
}

function stopTodayCountsAutoRefresh() {
  if (_todayCountsTimer) { clearInterval(_todayCountsTimer); _todayCountsTimer = null; }
}

function updateKPIs() {
  const camsList = getActiveGroupCameras();
  const camIds = new Set(camsList.map(c => c.camera_id));
  document.getElementById('kpiCamTotal').textContent = camsList.length;
  document.getElementById('kpiCamOnline').textContent = camsList.filter(c => c.status === 'online').length;
  document.getElementById('kpiCamRecording').textContent = camsList.filter(c => c.recording).length;
  // Sum of server-side per-camera totals scoped to the active group
  let total = 0;
  for (const cid of Object.keys(_todayCounts.cameras || {})) {
    if (camIds.has(cid)) total += _todayCounts.cameras[cid].total || 0;
  }
  document.getElementById('kpiEventsToday').textContent = total.toLocaleString();
}

// ============================================================
// Face gallery (MV.3b) — Hikvision Face Capture events
// ============================================================
// Face helpers — i18n-aware labels for age, gender, expression, duration.
// Age → 10-year band (decision: show a band, not the raw estimate —
// face age estimation carries ±5-10y error). 0-12 / 13-19 / decade / 60+.
function faceAgeBucket(age) {
  const a = parseInt(age, 10);
  if (!Number.isFinite(a)) return I18N.t('face.ageUnknown');
  const yr = I18N.t('face.yrs');
  if (a <= 12) return `0-12${yr}`;
  if (a <= 19) return `13-19${yr}`;
  if (a >= 60) return `60+${yr}`;
  const lo = Math.floor(a / 10) * 10;
  return `${lo}-${lo + 9}${yr}`;
}
function faceGenderLabel(g) {
  return g === 'male' ? I18N.t('face.male') : g === 'female' ? I18N.t('face.female') : '—';
}
function faceExprLabel(e) {
  if (!e) return '—';
  return I18N.t('faceExpr.' + e, e);
}
function faceDurationLabel(ms) {
  const s = Math.round((parseInt(ms, 10) || 0) / 1000);
  if (s < 60) return `${s}${I18N.t('face.sec')}`;
  const m = Math.floor(s / 60), rem = s % 60;
  return rem ? `${m}${I18N.t('face.min')} ${rem}${I18N.t('face.sec')}` : `${m}${I18N.t('face.min')}`;
}

let _facesData = [];

// Collect the Face page filter bar into URLSearchParams — shared by
// the gallery query (/api/faces) and the demographic summary
// (/api/faces/summary) so both always see the same filter set.
function _faceFilterParams() {
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const params = new URLSearchParams();
  const gender = val('faceFilterGender');
  const ageRng = val('faceFilterAge');
  const expr   = val('faceFilterExpr');
  const glass  = val('faceFilterGlass');
  const mask   = val('faceFilterMask');
  const hat    = val('faceFilterHat');
  const from   = getDtValue('faceFilterFrom');
  const to     = getDtValue('faceFilterTo');
  if (gender) params.set('gender', gender);
  if (expr)   params.set('expression', expr);
  if (glass)  params.set('glass', glass);
  if (mask)   params.set('mask', mask);
  if (hat)    params.set('hat', hat);
  if (ageRng) {
    const [lo, hi] = ageRng.split('-');
    params.set('age_min', lo);
    params.set('age_max', hi);
  }
  // datetime-local is naive local time → convert to UTC ISO for TIMESTAMPTZ
  if (from) params.set('from', new Date(from).toISOString());
  if (to)   params.set('to',   new Date(to).toISOString());
  return params;
}

async function loadFaces() {
  const params = _faceFilterParams();
  const jumpCam = _faceJumpCamera;
  _faceJumpCamera = null;
  const extra = jumpCam ? `&camera=${encodeURIComponent(jumpCam)}` : '';
  try {
    const res = await fetch(`${API}/api/faces?${params}${extra}`);
    const faces = await res.json();
    _facesData = Array.isArray(faces) ? faces : [];
    const total = res.headers.get('X-Total-Count') || _facesData.length;
    document.getElementById('faceCount').textContent = total;
    renderFaceGrid(_facesData);
  } catch (e) {
    console.error('loadFaces:', e);
  }
  loadFaceSummary();
}

// Demographic summary bar — gender split, age bands, mask count,
// scoped to the active filters.
async function loadFaceSummary() {
  try {
    const res = await fetch(`${API}/api/faces/summary?${_faceFilterParams()}`);
    renderFaceSummary(await res.json());
  } catch (e) {
    console.error('loadFaceSummary:', e);
  }
}

function renderFaceSummary(s) {
  const el = document.getElementById('faceSummary');
  if (!el) return;
  if (!s || !s.total) { el.innerHTML = ''; return; }
  const pct = (n) => s.total ? Math.round((n / s.total) * 100) : 0;
  const stat = (val, lbl) =>
    `<div class="face-stat"><div class="fs-val">${val}</div><div class="fs-lbl">${lbl}</div></div>`;
  el.innerHTML =
    stat(s.total, I18N.t('face.total')) +
    stat(`${s.male} · ${pct(s.male)}%`,     I18N.t('face.male')) +
    stat(`${s.female} · ${pct(s.female)}%`, I18N.t('face.female')) +
    stat(s.age_teen,   I18N.t('face.ageTeen')) +
    stat(s.age_young,  I18N.t('face.ageYoung')) +
    stat(s.age_mid,    I18N.t('face.ageMid')) +
    stat(s.age_senior, I18N.t('face.ageSenior')) +
    stat(`${s.masked} · ${pct(s.masked)}%`, I18N.t('face.masked'));
}

function renderFaceGrid(faces) {
  const grid = document.getElementById('faceGrid');
  if (!grid) return;
  if (!faces.length) {
    grid.innerHTML = `<div class="face-empty">${escapeHtml(I18N.t('face.empty'))}</div>`;
    return;
  }
  const noImg = escapeHtml(I18N.t('face.noImage'));
  grid.innerHTML = faces.map(f => {
    const img = f.snapshot
      ? `<img src="${API}/snapshots/${encodeURIComponent(f.snapshot)}" loading="lazy" decoding="async" alt="" data-err="face-noimg">`
      : `<div class="face-noimg">${noImg}</div>`;
    const t = f.event_time
      ? new Date(f.event_time).toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false })
      : '—';
    const wear = [];
    // กล้องส่ง glass = no / yes / sunglasses — แยก label แว่นกันแดด
    if (f.glass === 'sunglasses') wear.push(I18N.t('face.wearSunglasses'));
    else if (f.glass === 'yes')   wear.push(I18N.t('face.wearGlasses'));
    if (f.mask  === 'yes') wear.push(I18N.t('face.wearMask'));
    if (f.hat   === 'yes') wear.push(I18N.t('face.wearHat'));
    const wearHtml = wear.length
      ? wear.map(w => `<span class="face-chip">${escapeHtml(w)}</span>`).join('')
      : `<span class="face-chip" style="color:var(--dim)">${escapeHtml(I18N.t('face.nothingWorn'))}</span>`;
    return `<div class="face-card" data-action="openFaceModal" data-id="${f.id}">
      ${img}
      <div class="face-card-body">
        <div style="font-size:10px;color:var(--dim);margin-bottom:3px">${t} · ${escapeHtml(f.camera_id || '')}</div>
        <div>
          <span class="face-chip">${escapeHtml(faceGenderLabel(f.gender))}</span>
          <span class="face-chip">${escapeHtml(faceAgeBucket(f.age))}</span>
          <span class="face-chip">${escapeHtml(faceExprLabel(f.expression))}</span>
        </div>
        <div>${wearHtml}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:5px">
          ⏱ ${escapeHtml(faceDurationLabel(f.stay_duration))} · ${escapeHtml(I18N.t('face.quality'))} ${f.face_score || '—'}%
        </div>
      </div>
    </div>`;
  }).join('');
}

function resetFaceFilters() {
  ['faceFilterGender', 'faceFilterAge', 'faceFilterExpr', 'faceFilterGlass',
   'faceFilterMask', 'faceFilterHat']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // from/to are AirDatepicker-enhanced — clearDtValue clears the picker instance.
  clearDtValue('faceFilterFrom');
  clearDtValue('faceFilterTo');
  loadFaces();
}

// Face detail modal — full-frame background image + every attribute +
// the pre-alarm clip if one was captured. Gallery card click → here.
function openFaceModal(id) {
  // events.id is BIGSERIAL → node-pg returns it as a STRING, but the
  // inline onclick="openFaceModal(24812)" passes a numeric literal —
  // compare as strings so the lookup doesn't silently miss.
  const f = _facesData.find(x => String(x.id) === String(id));
  if (!f) return;
  const fullSrc = f.snapshot_full || f.snapshot;
  const fullImg = fullSrc
    ? `<div style="position:relative"><img id="faceModalFullImg" src="${API}/snapshots/${encodeURIComponent(fullSrc)}" style="width:100%;border-radius:8px;background:#000;display:block" alt="" data-err="dim"></div>`
    : `<div class="face-noimg" style="border-radius:8px">${escapeHtml(I18N.t('face.noFullImg'))}</div>`;
  const cropImg = f.snapshot
    ? `<img src="${API}/snapshots/${encodeURIComponent(f.snapshot)}" style="width:84px;height:104px;object-fit:cover;border-radius:6px;float:right;margin:0 0 6px 8px" alt="">`
    : '';
  const t = f.event_time
    ? new Date(f.event_time).toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'medium' })
    : '—';
  const wear = [];
  if (f.glass === 'sunglasses') wear.push(I18N.t('face.wearSunglasses'));
  else if (f.glass === 'yes')   wear.push(I18N.t('face.wearGlasses'));
  if (f.mask  === 'yes') wear.push(I18N.t('face.wearMask'));
  if (f.hat   === 'yes') wear.push(I18N.t('face.wearHat'));
  const clipHtml = (f.clip_file && f.clip_status === 'done')
    ? `<video src="${API}/media/${encodeURIComponent(f.clip_file)}" controls preload="metadata" style="width:100%;border-radius:8px;background:#000;margin-top:10px"></video>`
    : `<div style="font-size:11px;color:var(--dim);margin-top:8px">${escapeHtml(I18N.t('face.noClip'))}</div>`;
  document.getElementById('faceModalBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px">
      <div>
        ${fullImg}
        ${clipHtml}
      </div>
      <div>
        ${cropImg}
        <table class="face-detail">
          <tr><td>${escapeHtml(I18N.t('evt.colTime'))}</td><td>${escapeHtml(t)}</td></tr>
          <tr><td>${escapeHtml(I18N.t('common.camera'))}</td><td>${escapeHtml(f.camera_id || '—')}</td></tr>
          <tr><td>${escapeHtml(I18N.t('face.gender'))}</td><td>${escapeHtml(faceGenderLabel(f.gender))}</td></tr>
          <tr><td>${escapeHtml(I18N.t('face.age'))}</td><td>${escapeHtml(faceAgeBucket(f.age))}</td></tr>
          <tr><td>${escapeHtml(I18N.t('face.emotion'))}</td><td>${escapeHtml(faceExprLabel(f.expression))}</td></tr>
          <tr><td>${escapeHtml(I18N.t('face.wearing'))}</td><td>${wear.length ? wear.map(w => escapeHtml(w)).join('  ') : escapeHtml(I18N.t('face.nothingWorn'))}</td></tr>
          <tr><td>${escapeHtml(I18N.t('face.duration'))}</td><td>${escapeHtml(faceDurationLabel(f.stay_duration))}</td></tr>
          <tr><td>${escapeHtml(I18N.t('face.quality'))}</td><td>${f.face_score || '—'}%</td></tr>
        </table>
      </div>
    </div>`;
  document.getElementById('faceModal').classList.remove('hidden');

  // faceRect (normalized 0–1) ชี้ตำแหน่งบนรูป full frame เท่านั้น —
  // ถ้า fullSrc fallback เป็น crop (ไม่มี _snapshot_full) ห้ามวาด.
  // กรอบหน้านับเป็น BBox → เคารพ overlay_show_bbox ของกล้อง
  const fr = f.face_rect;
  if (f.snapshot_full && fr && fr.width > 0 && fr.height > 0
      && _camOverlayFlags(f.camera_id).bbox) {
    attachSnapOverlay(document.getElementById('faceModalFullImg'),
      [{ kind: 'box', x1: fr.x, y1: fr.y, x2: fr.x + fr.width, y2: fr.y + fr.height }]);
  }
}

function closeFaceModal() {
  const m = document.getElementById('faceModal');
  if (m) m.classList.add('hidden');
  const v = document.querySelector('#faceModalBody video');
  if (v) v.pause();
}

// ============================================================
// Appearance Search Page (IVA Pro Forensic Search)
// ============================================================

let _appPage = 1, _appTotal = 0;
let _appFromPicker = null, _appToPicker = null;
let _appRange = '7d';

function setAppRange(range, btn) {
  // 'custom' opens the modal; highlight only changes on successful apply
  if (range === 'custom') { openAppCustomModal(); return; }
  _appRange = range;
  document.querySelectorAll('#page-appearance .per-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Drive Air Datepicker instances so visible fields + selectedDates both update
  const now = new Date();
  let from, to = now;
  if (range === 'today') {
    from = new Date(now); from.setHours(0, 0, 0, 0);
  } else if (range === 'yesterday') {
    from = new Date(now); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 1);
    to   = new Date(now); to.setHours(0, 0, 0, 0);   // midnight today = end of yesterday
  } else if (range === '7d') {
    from = new Date(now - 7 * 86400_000);
  } else { // '1m'
    from = new Date(now - 30 * 86400_000);
  }
  if (_appFromPicker) _appFromPicker.selectDate(from, { silent: true });
  if (_appToPicker)   _appToPicker.selectDate(to,   { silent: true });
  loadAppearanceSearch();
}

// ── Custom range modal (Air Datepicker) ──────────────────────
let _appCustomFromPicker = null, _appCustomToPicker = null;

function _initAppCustomPickers() {
  if (typeof AirDatepicker === 'undefined') return;
  const lang = (typeof I18N !== 'undefined' && I18N.getLang()) || 'th';
  const locale = lang === 'th' ? _ADP_LOCALE_TH : _ADP_LOCALE_EN;
  const opts = {
    ...(locale ? { locale } : {}),
    timepicker: true, dateFormat: 'dd/MM/yyyy', timeFormat: 'HH:mm',
    isMobile: window.innerWidth <= 768, position: 'bottom left',
  };
  const fEl = document.getElementById('appCustomFrom');
  const tEl = document.getElementById('appCustomTo');
  if (fEl && !_appCustomFromPicker) _appCustomFromPicker = new AirDatepicker(fEl, opts);
  if (tEl && !_appCustomToPicker)   _appCustomToPicker   = new AirDatepicker(tEl, opts);
}

function openAppCustomModal() {
  _initAppCustomPickers();
  // Seed modal pickers from the current active range
  const f = _appFromPicker?.selectedDates[0], t = _appToPicker?.selectedDates[0];
  if (f && _appCustomFromPicker) _appCustomFromPicker.selectDate(f, { silent: true });
  if (t && _appCustomToPicker)   _appCustomToPicker.selectDate(t, { silent: true });
  const err = document.getElementById('appCustomErr');
  if (err) err.style.display = 'none';
  document.getElementById('appCustomRangeModal')?.classList.remove('hidden');
}

function closeAppCustomModal() {
  document.getElementById('appCustomRangeModal')?.classList.add('hidden');
}

function applyAppCustomRange() {
  const f = _appCustomFromPicker?.selectedDates[0];
  const t = _appCustomToPicker?.selectedDates[0];
  const err = document.getElementById('appCustomErr');
  if (!f || !t) {
    if (err) { err.textContent = I18N.t('app.customErrEmpty'); err.style.display = ''; }
    return;
  }
  if (f > t) {
    if (err) { err.textContent = I18N.t('app.customErrOrder'); err.style.display = ''; }
    return;
  }
  // Write into the source-of-truth pickers + mark custom button active
  if (_appFromPicker) _appFromPicker.selectDate(f, { silent: true });
  if (_appToPicker)   _appToPicker.selectDate(t, { silent: true });
  _appRange = 'custom';
  document.querySelectorAll('#page-appearance .per-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === 'custom'));
  closeAppCustomModal();
  loadAppearanceSearch();
}

const _ADP_LOCALE_TH = {
  name: 'th',
  days: ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'],
  daysShort: ['อา','จ','อ','พ','พฤ','ศ','ส'],
  daysMin: ['อา','จ','อ','พ','พฤ','ศ','ส'],
  months: ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
           'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
  monthsShort: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
  today: 'วันนี้',
  clear: 'ล้าง',
  dateFormat: 'dd/MM/yyyy',
  timeFormat: 'HH:mm',
  firstDay: 0,
};
// AirDatepicker's built-in default locale is Russian — must supply English explicitly.
const _ADP_LOCALE_EN = {
  name: 'en',
  days: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  daysShort: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  daysMin: ['Su','Mo','Tu','We','Th','Fr','Sa'],
  months: ['January','February','March','April','May','June',
           'July','August','September','October','November','December'],
  monthsShort: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  today: 'Today',
  clear: 'Clear',
  dateFormat: 'dd/MM/yyyy',
  timeFormat: 'HH:mm',
  firstDay: 0,
};

function _initAppDatePickers() {
  if (typeof AirDatepicker === 'undefined') return;
  const lang = (typeof I18N !== 'undefined' && I18N.getLang()) || 'th';
  const locale = lang === 'th' ? _ADP_LOCALE_TH : _ADP_LOCALE_EN;
  const baseOpts = {
    ...(locale ? { locale } : {}),
    timepicker: true,
    dateFormat: 'dd/MM/yyyy',
    timeFormat: 'HH:mm',
    isMobile: window.innerWidth <= 768,
    position: 'bottom left',
  };
  const fromEl = document.getElementById('appFilterFrom');
  const toEl   = document.getElementById('appFilterTo');
  if (fromEl && !_appFromPicker) {
    _appFromPicker = new AirDatepicker(fromEl, { ...baseOpts,
      onSelect: ({ date }) => { if (date && _appToPicker && !_appToPicker.selectedDates[0]) _appToPicker.show(); }
    });
  }
  if (toEl && !_appToPicker) {
    _appToPicker = new AirDatepicker(toEl, { ...baseOpts });
  }
}

function _appCamOptions() {
  return cameras.map(c =>
    `<option value="${escapeHtml(c.camera_id)}">${escapeHtml(c.camera_name || c.camera_id)}</option>`
  ).join('');
}

function _initAppCamDropdown() {
  const sel = document.getElementById('appFilterCam');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` + _appCamOptions();
  sel.value = cur;
}

async function loadAppearanceSearch(page = 1) {
  _appPage = page;
  const params = new URLSearchParams();
  const v = id => document.getElementById(id)?.value || '';
  if (v('appFilterCam'))        params.set('camera_id',   v('appFilterCam'));
  if (v('appFilterGender'))     params.set('gender',       v('appFilterGender'));
  if (v('appFilterTop'))        params.set('top',          v('appFilterTop'));
  if (v('appFilterTopColor'))   params.set('upper_color',  v('appFilterTopColor'));
  if (v('appFilterBottom'))     params.set('bottom',       v('appFilterBottom'));
  if (v('appFilterBottomColor'))params.set('lower_color',  v('appFilterBottomColor'));
  if (v('appFilterHair'))       params.set('hair',         v('appFilterHair'));
  if (v('appFilterGlasses'))    params.set('glasses',      v('appFilterGlasses'));
  if (v('appFilterHelmet'))     params.set('helmet',       v('appFilterHelmet'));
  if (v('appFilterBag'))        params.set('bag',          v('appFilterBag'));
  // Read dates from Air Datepicker instances (selectedDates = local Date objects)
  // → .toISOString() converts local→UTC correctly (Advisor: do NOT read el.value)
  const fromDate = _appFromPicker?.selectedDates[0];
  const toDate   = _appToPicker?.selectedDates[0];
  if (fromDate) params.set('from', fromDate.toISOString());
  if (toDate)   params.set('to',   toDate.toISOString());
  params.set('limit',  PAGE_SIZE);
  params.set('offset', (page - 1) * PAGE_SIZE);

  const container = document.getElementById('appResults');
  if (container) container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${I18N.t('common.loading')}</div>`;

  // Load stats panel in parallel with search results
  if (page === 1) _loadAppStats();

  try {
    const r = await fetch(`${API}/api/appearances/search?${params}`);
    if (!r.ok) throw new Error(r.statusText);
    _appTotal = parseInt(r.headers.get('X-Total-Count') || '0', 10);
    const rows = await r.json();
    _renderAppearanceResults(rows);
    document.getElementById('appCount').textContent = _appTotal;
    renderPagination('appPagination', page, _appTotal, PAGE_SIZE, p => loadAppearanceSearch(p));
  } catch (e) {
    if (container) container.innerHTML = `<div style="padding:20px;color:var(--status-bad)">${escapeHtml(e.message)}</div>`;
  }
}

function _renderAppearanceResults(rows) {
  window._appRows = rows;
  const container = document.getElementById('appResults');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-secondary)">${I18N.t('app.noResults')}</div>`;
    return;
  }
  container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
    ${rows.map((ev, idx) => {
      const thumb = ev.snapshot_file
        ? `<img src="${API}/snapshots/${escapeHtml(ev.snapshot_file)}?w=320" style="width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--surface-base);display:block" loading="lazy">`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--surface-elevated);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px">${I18N.t('snap.noImage')}</div>`;
      const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
      const chips = _renderAppearanceChips(ev);
      return `<div style="border-radius:6px;overflow:hidden;border:1px solid var(--border-hairline);background:var(--surface-elevated);cursor:pointer"
                   data-action="showSnapshot" data-source="app" data-idx="${idx}">
        ${thumb}
        <div style="padding:8px">
          <div style="font-size:11px;color:var(--text-secondary)">${escapeHtml(time)}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">${escapeHtml(ev.camera_id)}</div>
          ${chips}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Appearance Stats Panel ────────────────────────────────────
let _appGenderChart = null, _appTopCatChart = null, _appVolChart = null;
let _appBotCatChart = null, _appHairLenChart = null;

const _COLOR_HEX = {
  Black:'#111', White:'#eee', Gray:'#888', Blue:'#3b7fe0',
  Red:'#e03b3b', Green:'#3be06a', Yellow:'#e0d43b', Orange:'#e07a3b',
  Purple:'#7a3be0', Pink:'#e03bba', Brown:'#8b5c2a', Beige:'#d4c49a',
  Magenta:'#e03be0', Blonde:'#b88b50', Auburn:'#b43214',
};

// Tab switch — display-toggle only (keeps Air Datepicker instances alive)
function setAppTab(tab, btn) {
  document.querySelectorAll('#page-appearance .tabs .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const ov = document.getElementById('appTabOverview');
  const se = document.getElementById('appTabSearch');
  if (ov) ov.style.display = tab === 'overview' ? '' : 'none';
  if (se) se.style.display = tab === 'search'   ? '' : 'none';
  // Chart.js renders to 0-height inside a display:none container — resize on reveal
  if (tab === 'overview') {
    [_appGenderChart, _appTopCatChart, _appBotCatChart, _appHairLenChart, _appVolChart]
      .forEach(c => { try { c?.resize(); } catch {} });
  }
}

async function _loadAppStats() {
  const statsCard = document.getElementById('appStatsCard');
  if (!statsCard) return;
  const params = new URLSearchParams();
  const v = id => document.getElementById(id)?.value || '';
  if (v('appFilterCam')) params.set('camera_id', v('appFilterCam'));
  const fromDate = _appFromPicker?.selectedDates[0];
  const toDate   = _appToPicker?.selectedDates[0];
  if (fromDate) params.set('from', fromDate.toISOString());
  if (toDate)   params.set('to',   toDate.toISOString());

  const emptyEl = document.getElementById('appStatsEmpty');
  try {
    const r = await fetch(`${API}/api/appearances/stats?${params}`);
    if (!r.ok) return;
    const d = await r.json();
    if (!d.accessories?.total) {
      statsCard.style.display = 'none';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    statsCard.style.display = '';
    _renderAppStatsCharts(d);
  } catch {
    statsCard.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
  }
}

// Shared horizontal-bar chart factory for category dimensions
function _appCatChart(canvasId, dataObj, prevChart) {
  dataObj = dataObj || {};
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return prevChart;
  if (prevChart) prevChart.destroy();
  const accent = token('--accent'), textSec = token('--text-secondary'), gridColor = token('--border-hairline');
  const labels = Object.keys(dataObj), data = Object.values(dataObj);
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: accent + 'cc', borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}` } } }, scales: { x: { grid: { color: gridColor }, ticks: { color: textSec, font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: textSec, font: { size: 10 } } } }, responsive: true, maintainAspectRatio: false },
  });
}

// Shared color-swatch bar renderer — entries = [[name, count], ...]
function _appColorBars(containerId, entries) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!entries || !entries.length) { el.innerHTML = ''; return; }
  const lang = (typeof I18N !== 'undefined' && I18N.getLang()) || 'th';
  const total = entries.reduce((s, [, n]) => s + n, 0);
  el.innerHTML = entries.map(([name, n]) => {
    const pct = total ? Math.round(n / total * 100) : 0;
    const hex = _COLOR_HEX[name] || '#888';
    const displayName = (_APP_COLOR[name] && _APP_COLOR[name][lang]) || name;
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
      <span style="width:12px;height:12px;border-radius:2px;background:${hex};flex-shrink:0;border:1px solid rgba(255,255,255,.15)"></span>
      <span style="width:60px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(displayName)}</span>
      <div style="flex:1;background:var(--surface-base);border-radius:3px;height:8px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${hex};border-radius:3px"></div>
      </div>
      <span style="color:var(--text-secondary);min-width:28px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');
}

// Re-key a {value:count} object → {localisedLabel:count} via a label map
function _appMapLabels(obj, map) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[_appLabel(map, k) || k] = v;
  return out;
}

function _renderAppStatsCharts(d) {
  const accent = token('--accent'), textSec = token('--text-secondary');
  const gridColor = token('--border-hairline');

  // Gender donut
  const gCtx = document.getElementById('appGenderChart')?.getContext('2d');
  if (gCtx) {
    if (_appGenderChart) _appGenderChart.destroy();
    const gLabels = Object.keys(d.gender).map(k => _appLabel(_APP_GENDER, k) || k);
    _appGenderChart = new Chart(gCtx, {
      type: 'doughnut',
      data: { labels: gLabels, datasets: [{ data: Object.values(d.gender), backgroundColor: [accent, '#e87c7c', '#7cace8'], borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: textSec, font: { size: 11 }, padding: 8 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } } }, cutout: '65%', responsive: true, maintainAspectRatio: false },
    });
  }

  // Category charts (top / bottom / hair length) — labels localised via maps
  _appTopCatChart  = _appCatChart('appTopCatChart',  _appMapLabels(d.top_cat,    _APP_TOP),  _appTopCatChart);
  _appBotCatChart  = _appCatChart('appBotCatChart',  _appMapLabels(d.bottom_cat, _APP_BOT),  _appBotCatChart);
  _appHairLenChart = _appCatChart('appHairLenChart', _appMapLabels(d.hair_length, _APP_HAIR), _appHairLenChart);

  // Color swatch bars (top / bottom / hair)
  _appColorBars('appColorBars',     d.upper_color);
  _appColorBars('appBotColorBars',  d.lower_color);
  _appColorBars('appHairColorBars', d.hair_color);

  // Accessories tiles — bag split into ShoulderBag / Backpack
  const acc = d.accessories;
  const tiles = document.getElementById('appStatsTiles');
  if (tiles) {
    const tileData = [
      { label: I18N.t('app.statsGlasses'),  val: acc.glasses_count  },
      { label: I18N.t('app.statsHelmet'),   val: acc.helmet_count   },
      { label: I18N.t('app.statsShoulder'), val: acc.shoulder_count },
      { label: I18N.t('app.statsBackpack'), val: acc.backpack_count },
    ].filter(t => t.val > 0);
    tiles.innerHTML = tileData.map(t =>
      `<div style="padding:8px 14px;background:var(--surface-base);border:1px solid var(--border-hairline);border-radius:6px;text-align:center">
        <div style="font-size:18px;font-weight:700;color:var(--accent)">${t.val}</div>
        <div style="font-size:10px;color:var(--text-secondary)">${escapeHtml(t.label)}</div>
      </div>`
    ).join('');
  }

  // Volume over time
  const vCtx = document.getElementById('appVolChart')?.getContext('2d');
  if (vCtx && d.volume.length) {
    if (_appVolChart) _appVolChart.destroy();
    const dateLocale = ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB';
    _appVolChart = new Chart(vCtx, {
      type: 'bar',
      data: { labels: d.volume.map(r => new Date(r.day).toLocaleDateString(dateLocale, { month:'short', day:'numeric' })), datasets: [{ data: d.volume.map(r => r.n), backgroundColor: accent + '88', borderRadius: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y}` } } }, scales: { x: { grid: { display: false }, ticks: { color: textSec, font: { size: 9 }, maxRotation: 0 } }, y: { grid: { color: gridColor }, ticks: { color: textSec, font: { size: 9 } } } }, responsive: true, maintainAspectRatio: false },
    });
  }
}

function resetAppearanceFilters() {
  ['appFilterCam','appFilterGender','appFilterTop','appFilterTopColor',
   'appFilterBottom','appFilterBottomColor','appFilterHair',
   'appFilterGlasses','appFilterHelmet','appFilterBag']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Route through setAppRange('7d') so pickers + button highlight + query stay
  // consistent (plain el.value='' left the 7d button lit while sending no dates)
  const defBtn = document.querySelector('#page-appearance .per-btn[data-range="7d"]');
  setAppRange('7d', defBtn);
}

// ============================================================
// Events Page
// ============================================================

// Phase 4 — drill-down filter passed in from the Stats page.
// When set, loadEvents() builds query params from it and shows a banner.
let _drillFilter = null;

function clearDrillFilter() {
  _drillFilter = null;
  document.getElementById('drillBanner').classList.add('hidden');
  loadEvents();
}

function _renderDrillBanner() {
  const banner = document.getElementById('drillBanner');
  const text   = document.getElementById('drillBannerText');
  if (!banner || !text) return;
  if (!_drillFilter) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  text.innerHTML = `🎯 <strong>Filter from Stats:</strong> ${escapeHtml(_drillFilter.label || '')}`;
}

// Public API for drill-down. Pass any subset of filters; from/to default
// to the active stats range so the drill-down respects the current period.
function drillTo(filter) {
  const groupCameras = (activeGroupId !== 'all' && typeof getActiveGroupCameraIds === 'function')
    ? getActiveGroupCameraIds().filter(Boolean)
    : [];
  const scopedCameras = Array.isArray(filter.cameras)
    ? filter.cameras.filter(Boolean)
    : (groupCameras.length ? groupCameras : null);
  _drillFilter = {
    label: filter.label || '',
    category_id: filter.category_id || null,
    camera:      filter.camera      || null,
    cameras:     filter.camera ? null : scopedCameras,
    rule_name:   filter.rule_name   || null,
    cls:         filter.cls         || null,
    from:        filter.from || _statsLastFrom || null,
    to:          filter.to   || _statsLastTo   || null,
    // hour-of-week filter is applied server-side in display_timezone
    // (loadEvents forwards dow + hour to /api/events as query params)
    dow:  filter.dow,
    hour: filter.hour,
  };
  showPage('events');
}

// Phase 6.1.7+8 — Events Live pagination + server-side filters
let _evtPage = 1;
let _evtTotal = 0;
let _evtNewSincePage1 = 0;
let _evtPaused = false;                     // when true, WS prepends are queued, not rendered
let _evtCategories = [];                    // cached from /api/categories
const CLASS_HIERARCHY_UI = {
  Person:  ['Person','Face','HumanFace','HumanBody','Pedestrian'],
  Vehicle: ['Vehicle','Car','Truck','Bus','Motorcycle','Motorbike','Van','Bicycle','Bike'],
  Other:   ['Animal','LicensePlate','Object'],
};

async function populateEventFilters() {
  // Camera dropdown — from active group's camera list
  const camsList = getActiveGroupCameras();
  document.getElementById('evtFilterCam').innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    camsList.map(c => `<option value="${c.camera_id}">${escapeHtml(c.camera_name || c.camera_id)}</option>`).join('');

  // Categories + facets — load once per session, reuse Snapshot/Media cache
  const [cats, facets] = await Promise.all([_loadSnapCategories(), _loadSnapFacets()]);
  _evtCategories = cats || [];

  document.getElementById('evtFilterCategory').innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    _evtCategories.map(c => `<option value="${c.id}">${escapeHtml((c.icon || '') + ' ' + c.name).trim()}</option>`).join('');

  document.getElementById('evtFilterRule').innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    (facets.rule_names || []).map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

  // Object class — 2-tier hierarchy (parents auto-expand to children server-side)
  // <optgroup> shows the grouping; specific subclasses still selectable.
  const seenClasses = new Set(facets.object_classes || []);
  let classHtml = `<option value="">${I18N.t('common.all')}</option>`;
  for (const [parent, children] of Object.entries(CLASS_HIERARCHY_UI)) {
    const presentChildren = children.filter(c => seenClasses.has(c));
    classHtml += `<optgroup label="${parent}${I18N.t('evt.classGroupSuffix')}">`;
    classHtml += `<option value="${parent}">${I18N.t('evt.classGroupAll').replace('{p}', parent).replace('{n}', presentChildren.length || 0)}</option>`;
    presentChildren.forEach(c => { classHtml += `<option value="${c}">${c}</option>`; });
    classHtml += `</optgroup>`;
  }
  // Any classes seen in DB but not in our hierarchy → "Other"
  const orphan = [...seenClasses].filter(c =>
    !Object.values(CLASS_HIERARCHY_UI).flat().includes(c));
  if (orphan.length) {
    classHtml += `<optgroup label="${I18N.t('evt.classOther')}">`;
    orphan.forEach(c => { classHtml += `<option value="${c}">${c}</option>`; });
    classHtml += `</optgroup>`;
  }
  document.getElementById('evtFilterClass').innerHTML = classHtml;
}

function resetEventFilters() {
  ['evtSearch','evtFilterCam','evtFilterCategory','evtFilterClass','evtFilterRule'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearDtValue('evtFilterFrom');
  clearDtValue('evtFilterTo');
  if (_drillFilter) clearDrillFilter();
  loadEvents(1);
}

async function loadEvents(page = 1) {
  _evtPage = page;
  if (page === 1) _evtNewSincePage1 = 0;
  try {
    const offset = (_evtPage - 1) * PAGE_SIZE;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    // Tab → server-side filter (was buggy client-side after pagination)
    if (currentEventTab && currentEventTab !== 'all') params.set('tab', currentEventTab);

    // Filter form values
    const q  = document.getElementById('evtSearch')?.value.trim();
    const cm = document.getElementById('evtFilterCam')?.value;
    const cg = document.getElementById('evtFilterCategory')?.value;
    const oc = document.getElementById('evtFilterClass')?.value;
    const rn = document.getElementById('evtFilterRule')?.value;
    const from = getDtValue('evtFilterFrom');
    const to   = getDtValue('evtFilterTo');
    const toIso = s => s ? new Date(s).toISOString() : '';

    if (q)  params.set('q', q);
    if (cm) params.set('camera', cm);
    if (!cm && activeGroupId !== 'all') {
      const ids = getActiveGroupCameraIds();
      if (ids.length) params.set('cameras', ids.join(','));
    }
    if (cg) params.set('category_id', cg);
    if (oc) params.set('object_classes', oc);
    if (rn) params.set('rule_name', rn);
    if (from) params.set('from', toIso(from));
    if (to)   params.set('to',   toIso(to));

    // Drill filter (from Stats page click) augments — narrows but doesn't replace
    if (_drillFilter) {
      if (_drillFilter.category_id && !cg) params.set('category_id', _drillFilter.category_id);
      if (_drillFilter.camera     && !cm)  params.set('camera',      _drillFilter.camera);
      if (_drillFilter.cameras?.length && !cm && !_drillFilter.camera) {
        params.set('cameras', _drillFilter.cameras.join(','));
      }
      if (_drillFilter.rule_name  && !rn)  params.set('rule_name',   _drillFilter.rule_name);
      if (_drillFilter.cls        && !oc)  params.set('object_classes', _drillFilter.cls);
      if (_drillFilter.from       && !from)params.set('from',        _drillFilter.from);
      if (_drillFilter.to         && !to)  params.set('to',          _drillFilter.to);
      // Hour-of-week (Activity Heatmap drill) — server applies these in
      // display_timezone so the filter survives pagination. Previously
      // attempted client-side after fetch, but the LIMIT 20 page rarely
      // contained the matching events even when they existed in range.
      if (_drillFilter.dow  != null) params.set('dow',  String(_drillFilter.dow));
      if (_drillFilter.hour != null) params.set('hour', String(_drillFilter.hour));
    }

    const res = await fetch(`${API}/api/events?${params.toString()}`, { cache: 'no-store' });
    _evtTotal = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    allEvents = await res.json();
    _renderDrillBanner();
    renderEvents();
    document.getElementById('evtCount').textContent = `${_evtTotal.toLocaleString()} events`;
    renderPagination('eventsPagination', _evtPage, _evtTotal, PAGE_SIZE,
      (p) => loadEvents(p), 'event');
    updateKPIs();
  } catch (e) { console.error(e); }
}

function setEventTab(tab, btn) {
  currentEventTab = tab;
  document.querySelectorAll('#page-events .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadEvents(1);                              // server-side filter — fixes pagination undercount
}

function toggleEventsPause() {
  _evtPaused = !_evtPaused;
  const btn = document.getElementById('evtPauseBtn');
  if (btn) btn.textContent = _evtPaused ? '▶ Resume Live' : '⏸ Pause Live';
}

function exportEventsCsv() {
  if (!allEvents || !allEvents.length) { alert(I18N.t('stats.noData')); return; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const rows = allEvents.map(ev => ({
    id: ev.id,
    event_time: ev.event_time,
    camera_id: ev.camera_id,
    rule_name: ev.rule_name || '',
    event_type: ev.event_type || '',
    object_class: ev.object_class || '',
    likelihood: ev.likelihood ?? '',
    state: ev.state || '',
    has_snapshot: ev.snapshot_file ? 'yes' : 'no',
    has_clip: ev.clip_file ? 'yes' : 'no',
  }));
  _downloadCsv(`events_page${_evtPage}_${stamp}.csv`, rows);
}

// Phase 6.1.8 — derive a category label/color for an event from cached
// _evtCategories (Stats v2 mapping rules). Returns null if no rule matches.
// All-match semantics — first match wins for display purposes (the Stats v2
// engine itself does true all-match aggregation, but UI shows one badge).
function _eventCategoryFor(ev) {
  if (!_evtCategories || !_evtCategories.length) return null;
  // Counter kinds use object_class fallback ("people_counter" → matches Person events)
  // For UI badge, just look for any category whose name matches event characteristics.
  // Heuristic: rule_name match takes priority; else object_class to category mapping.
  // Cheap heuristic since we don't have rules here client-side — backend has the
  // truth via /api/events?category_id=X. UI badge is informational.
  if (!ev.object_class) return null;
  if (ev.object_class === 'Person')
    return _evtCategories.find(c => c.kind === 'people_counter') || null;
  if (['Car','Truck','Vehicle','Bus','Motorcycle','Motorbike','Van','Bicycle','Bike'].includes(ev.object_class))
    return _evtCategories.find(c => c.kind === 'vehicle_counter') || null;
  return null;
}

function renderEvents() {
  // Phase 6.1.8 — all filtering is now server-side. Just render what server
  // returned. The single client-side filter remaining is the hour-of-week
  // (drill-down) which loadEvents already applied.
  const ICONS = {
    'LineDetector/Crossed': '➡️', 'FieldDetector/ObjectIsLoitering': '🟡',
    'FieldDetector/ObjectsInside': '👤', 'CountAggregation/Counter': '🔢',
    'CountAggregation/OccupancyCounter': '👥', 'ObjectDetection/Object': '🎯',
    'ObjectTrack/Aggregation': '🚶', 'Recognition/LicensePlate': '🅿️',
    'GlobalSceneChange': '🔄',
  };

  document.getElementById('eventsList').innerHTML = allEvents.map((ev, idx) => {
    const time = new Date(ev.event_time).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    const icon = ICONS[ev.event_type] || ICONS[ev.event_type?.split('/').pop()] || '📹';
    const hasSnap = !!ev.snapshot_file;
    const cls = ev.object_class || (ev.count != null ? `#${ev.count}` : ev.state || '—');
    const conf = ev.likelihood ? `${(ev.likelihood*100).toFixed(0)}%` : '—';
    const srcCls = ev.snapshot_source === 'mqtt' ? 'src-mqtt' : ev.snapshot_source === 'http' ? 'src-http' : '';
    // Severity color tint by category (subtle)
    const cat = _eventCategoryFor(ev);
    const tintColor = cat?.color || (ev.rule_name ? 'var(--accent)' : 'var(--muted)');
    const catBadge = cat
      ? `<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;background:${cat.color}33;color:${cat.color};margin-right:4px">${cat.icon || ''} ${escapeHtml(cat.name)}</span>`
      : '';
    const clipBadge = ev.clip_file && ev.clip_status === 'done'
      ? `<span style="font-size:9px;color:var(--accent);margin-left:4px" title="${I18N.t('evt.clipTip')}">🎬</span>` : '';
    // SEC-002: fields from MQTT/DB are attacker-controlled — escape before innerHTML
    return `
      <div class="event-row" style="border-left:3px solid ${tintColor}" data-action="showSnapshot" data-source="events" data-idx="${idx}">
        <div class="event-thumb">
          ${hasSnap ? `<img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" data-err="no-img">` : `<div class="no-img">—</div>`}
        </div>
        <span style="font-size:14px">${icon}</span>
        <span class="event-time">${time}</span>
        <div style="overflow:hidden">
          <span style="color:var(--accent);font-weight:600" title="${escapeHtml(ev.event_type || '')}">${escapeHtml(eventDisplayName(ev))}</span>${clipBadge}
          <span style="color:var(--muted);margin-left:6px;font-size:10px">${escapeHtml(ev.camera_id)}</span>
        </div>
        <span class="event-class" style="text-align:center">${catBadge}<span style="font-size:11px">${escapeHtml(cls)}</span></span>
        <span class="event-conf">${conf}</span>
        <span class="event-src ${srcCls}">${escapeHtml(ev.snapshot_source || '—')}</span>
      </div>`;
  }).join('');
}

// Phase 6.1.8 — search-on-Enter for the Events page search box
document.addEventListener('keydown', (e) => {
  if (e.target?.id === 'evtSearch' && e.key === 'Enter') {
    e.preventDefault();
    loadEvents(1);
  }
});

// ============================================================
// Snapshots Page
// ============================================================

// Cached so we only hit the DB-wide facet/category endpoints once per session.
let _snapFacets = null;       // { rule_names: [...], event_types: [...] }
let _snapCategories = null;   // [{ id, name, kind, ... }]

async function _loadSnapFacets() {
  if (_snapFacets) return _snapFacets;
  try {
    const r = await fetch(`${API}/api/events/facets`, { cache: 'no-store' });
    _snapFacets = await r.json();
  } catch { _snapFacets = { rule_names: [], event_types: [] }; }
  return _snapFacets;
}

async function _loadSnapCategories() {
  if (_snapCategories) return _snapCategories;
  try {
    const r = await fetch(`${API}/api/categories`, { cache: 'no-store' });
    _snapCategories = await r.json();
  } catch { _snapCategories = []; }
  return _snapCategories;
}

async function populateSnapFilters() {
  const camsList = getActiveGroupCameras();
  const camSel = document.getElementById('snapFilterCam');
  camSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` + camsList.map(c => `<option value="${c.camera_id}">${c.camera_name || c.camera_id}</option>`).join('');

  // Load DB-wide rules + categories in parallel — fixes the "rules from current session only" bug.
  const [facets, cats] = await Promise.all([_loadSnapFacets(), _loadSnapCategories()]);

  const ruleSel = document.getElementById('snapFilterType');
  const rules = facets.rule_names || [];
  ruleSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    (rules.length
      ? rules.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')
      : `<option value="" disabled>${I18N.t('snap.noRules')}</option>`);

  const catSel = document.getElementById('snapFilterCategory');
  if (catSel) {
    catSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
      (cats || []).map(c => `<option value="${c.id}">${escapeHtml((c.icon || '') + ' ' + c.name).trim()}</option>`).join('');
  }
}

function resetSnapFilters() {
  document.getElementById('snapFilterCam').value = '';
  document.getElementById('snapFilterType').value = '';
  const catSel = document.getElementById('snapFilterCategory');
  if (catSel) catSel.value = '';
  clearDtValue('snapFilterFrom');
  clearDtValue('snapFilterTo');
  _snapPage = 1;
  loadSnapshots();
}

// Phase 6.1.7 — server-side pagination: 20/page, no hard cap
let _snapPage = 1;
let _snapTotal = 0;

async function loadSnapshots(page = 1) {
  _snapPage = page;
  const cam = document.getElementById('snapFilterCam').value;
  const rule = document.getElementById('snapFilterType').value;
  const catSel = document.getElementById('snapFilterCategory');
  const categoryId = catSel ? catSel.value : '';
  const from = getDtValue('snapFilterFrom');
  const to   = getDtValue('snapFilterTo');

  // <input type="datetime-local"> returns naive local strings like "2026-05-08T14:30".
  // Convert to UTC ISO so Postgres TIMESTAMPTZ comparison matches the user's Bangkok wall clock.
  const toIso = s => s ? new Date(s).toISOString() : '';

  const offset = (_snapPage - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    hasSnapshot: 'true',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (cam) params.set('camera', cam);
  if (!cam && activeGroupId !== 'all') {
    const ids = getActiveGroupCameraIds();
    if (ids.length) params.set('cameras', ids.join(','));
  }
  if (rule) params.set('rule_name', rule);
  if (categoryId) params.set('category_id', categoryId);
  if (from) params.set('from', toIso(from));
  if (to)   params.set('to',   toIso(to));

  const container = document.getElementById('snapsContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  document.getElementById('snapCount').textContent = '…';

  try {
    const res = await fetch(`${API}/api/events?${params.toString()}`, { cache: 'no-store' });
    _snapTotal = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    snapshots = await res.json();
    document.getElementById('snapCount').textContent = _snapTotal.toLocaleString();
    renderSnapshots();
    renderPagination('snapPagination', _snapPage, _snapTotal, PAGE_SIZE,
      (p) => loadSnapshots(p), 'snapshot');
  } catch (e) {
    console.error(e);
    if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">${escapeHtml(I18N.t('common.loadFailedShort'))}</div>`;
    document.getElementById('snapCount').textContent = '0';
  }
}

function setSnapView(view, btn) {
  currentSnapView = view;
  document.querySelectorAll('#page-snapshots .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSnapshots();
}

function renderSnapshots() {
  const c = document.getElementById('snapsContainer');
  if (snapshots.length === 0) {
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">${I18N.t('snap.noMatch')}</div>`;
    return;
  }

  if (currentSnapView === 'grid') {
    c.innerHTML = `<div class="snap-grid">${snapshots.map((ev, idx) => {
      const time = new Date(ev.event_time);
      const clipBadge = ev.clip_file && ev.clip_status === 'done'
        ? `<span title="${I18N.t('snap.clipTip')}" data-action="showMediaClip" data-source="snaps" data-idx="${idx}" style="position:absolute;top:6px;right:6px;background:rgba(91,141,239,0.9);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;cursor:pointer;backdrop-filter:blur(4px)">🎬 ${ev.clip_duration_sec ? parseFloat(ev.clip_duration_sec).toFixed(0) + 's' : 'clip'}</span>`
        : '';
      // SEC-002: escape all camera/MQTT-derived fields
      return `
        <div class="snap-item" style="position:relative" data-action="showSnapshot" data-source="snaps" data-idx="${idx}">
          <img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" loading="lazy" data-err="dim">
          ${clipBadge}
          <div class="snap-item-info">
            <div style="font-weight:600;display:flex;justify-content:space-between">
              <span>${escapeHtml(ev.object_class || eventDisplayName(ev))}</span>
              <span style="color:${ev.snapshot_source === 'mqtt' ? 'var(--purple)' : 'var(--amber)'};font-size:8px">${escapeHtml(ev.snapshot_source || '')}</span>
            </div>
            <div style="color:var(--dim);font-size:9px">${escapeHtml(ev.camera_id)} · ${time.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false})}</div>
          </div>
        </div>`;
    }).join('')}</div>`;
  } else {
    c.innerHTML = snapshots.map((ev, idx) => {
      const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
      const clipChip = ev.clip_file && ev.clip_status === 'done'
        ? `<span data-action="showMediaClip" data-source="snaps" data-idx="${idx}" style="display:inline-block;margin-left:8px;background:rgba(91,141,239,0.15);color:var(--accent);font-size:10px;padding:2px 7px;border-radius:3px;cursor:pointer;border:1px solid rgba(91,141,239,0.3)" title="${I18N.t('snap.clipTip')}">🎬 ${ev.clip_duration_sec ? parseFloat(ev.clip_duration_sec).toFixed(0) + 's' : 'clip'}</span>`
        : '';
      // SEC-002: escape all camera/MQTT-derived fields
      return `
        <div style="display:grid;grid-template-columns:100px 1fr;gap:14px;padding:10px;border-bottom:1px solid var(--border);cursor:pointer" data-action="showSnapshot" data-source="snaps" data-idx="${idx}">
          <img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" style="width:100px;height:60px;object-fit:cover;border-radius:4px">
          <div>
            <div style="font-weight:600;font-size:13px">${escapeHtml(eventDisplayName(ev))} · ${escapeHtml(ev.object_class || '—')}${clipChip}</div>
            <div style="color:var(--dim);font-size:11px;margin-top:2px">${escapeHtml(ev.camera_id)}</div>
            <div style="color:var(--muted);font-size:10px;margin-top:2px">${time}</div>
          </div>
        </div>`;
    }).join('');
  }
}

// Phase 2 — per-camera "view full" width cap. The camera-settings form
// stores full_view_width in cameras-config.json; the "ดูภาพเต็ม" button
// requests ?w=<cap>, or the native original when no cap is set.
function camFullViewWidth(cameraId) {
  const list = (typeof cameras !== 'undefined' && Array.isArray(cameras)) ? cameras : [];
  const c = list.find(x => x.camera_id === cameraId);
  const w = c && parseInt(c.full_view_width, 10);
  return (w && w > 0) ? w : null;
}

// ============================================================
// Snapshot overlay — bbox / zone polygon on top of a snapshot <img>.
// Shapes use normalized 0–1 coordinates; the SVG is positioned to the
// image's rendered content box so object-fit:contain letterboxing and
// ?w= server-side resizing don't skew anything.
//   Dahua: BoundingBox [x1,y1,x2,y2] + DetectRegion [[x,y],…] in 0–8192
//   Hikvision face: faceRect {x,y,width,height} already 0–1 (full frame)
//   Hikvision smart events: detectionRegions[].points in 0–1000 grid
//     (normalizedScreenSize, ยืนยันจาก ISAPI จริง 2026-06-11) +
//     targetRect {x,y,width,height} เป็น 0–1 อยู่แล้ว
// ============================================================
// Per-camera display toggles (migration 043) — default on when camera
// record is missing (e.g. cameras[] not loaded yet).
function _camOverlayFlags(cameraId) {
  const c = (typeof cameras !== 'undefined' && Array.isArray(cameras))
    ? cameras.find(x => x.camera_id === cameraId) : null;
  return {
    bbox: c?.overlay_show_bbox !== false,
    zone: c?.overlay_show_zone !== false,
  };
}

function _dahuaSnapShapes(raw) {
  if (raw?.vendor !== 'dahua') return [];
  const d = raw?.data, out = [];
  const reg = d?.DetectRegion;
  if (Array.isArray(reg) && reg.length >= 3) {
    out.push({ kind: 'poly', points: reg.map(p => [p[0] / 8192, p[1] / 8192]) });
  }
  const bb = d?.Object?.BoundingBox;
  if (Array.isArray(bb) && bb.length === 4) {
    out.push({ kind: 'box', x1: bb[0] / 8192, y1: bb[1] / 8192, x2: bb[2] / 8192, y2: bb[3] / 8192 });
  }
  return out;
}

function _hikSnapShapes(raw) {
  if (raw?.vendor !== 'hikvision') return [];
  const out = [];
  for (const r of (Array.isArray(raw?.detectionRegions) ? raw.detectionRegions : [])) {
    // zone polygon (intrusion ≥3 จุด) หรือเส้น line crossing (2 จุด) —
    // <polygon> 2 จุดวาดเป็น segment ได้เลย (fill:none อยู่แล้ว)
    if (Array.isArray(r.points) && r.points.length >= 2) {
      out.push({ kind: 'poly', points: r.points.map(p => [p[0] / 1000, p[1] / 1000]) });
    }
    const tr = r.targetRect;
    if (tr && tr.width > 0 && tr.height > 0) {
      out.push({ kind: 'box', x1: tr.x, y1: tr.y, x2: tr.x + tr.width, y2: tr.y + tr.height });
    }
  }
  return out;
}

function attachSnapOverlay(imgEl, shapes) {
  if (!imgEl || !shapes?.length) return;
  const wrap = imgEl.parentElement;
  if (!wrap) return;
  const draw = () => {
    const iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
    const cw = imgEl.clientWidth,  ch = imgEl.clientHeight;
    if (!iw || !ih || !cw || !ch) return;
    const s = Math.min(cw / iw, ch / ih);
    const w = iw * s, h = ih * s;
    const ox = imgEl.offsetLeft + (cw - w) / 2;
    const oy = imgEl.offsetTop  + (ch - h) / 2;
    let svg = wrap.querySelector(':scope > svg.snap-ovl');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'snap-ovl');
      svg.setAttribute('viewBox', '0 0 1 1');
      svg.setAttribute('preserveAspectRatio', 'none');
      wrap.appendChild(svg);
    }
    svg.style.cssText = `position:absolute;left:${ox}px;top:${oy}px;width:${w}px;height:${h}px;pointer-events:none`;
    svg.innerHTML = shapes.map(sh => sh.kind === 'poly'
      ? `<polygon points="${sh.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" opacity="0.85"/>`
      : `<rect x="${sh.x1}" y="${sh.y1}" width="${sh.x2 - sh.x1}" height="${sh.y2 - sh.y1}" fill="none" stroke="var(--warn)" stroke-width="2" vector-effect="non-scaling-stroke"/>`
    ).join('');
  };
  if (imgEl.complete && imgEl.naturalWidth) draw();
  else imgEl.addEventListener('load', draw, { once: true });
  // Modal width follows the viewport — track it so the overlay stays glued.
  // Observer dies with the img element when the modal body is re-rendered.
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(imgEl);
}

function showSnapshot(ev) {
  window._currentSnapEv = ev;
  const modal = document.getElementById('snapModal');
  const time = new Date(ev.event_time);
  document.getElementById('snapModalTitle').textContent = `${eventDisplayName(ev)} - ${ev.camera_id}`;

  // Phase 2 — the modal shows a medium ?w=640 thumbnail (fast); the
  // full image loads only on the explicit "ดูภาพเต็ม" click.
  const imgHtml = ev.snapshot_file
    ? `<div style="position:relative"><img id="snapModalImg" src="${API}/snapshots/${ev.snapshot_file}?w=640" style="width:100%;max-height:400px;object-fit:contain;background:#000;border-radius:8px;display:block"></div>`
    : `<div style="height:200px;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px;color:var(--dim)">${I18N.t('snap.noImage')}</div>`;

  const fields = [
    [I18N.t('evt.colTime'), time.toLocaleString('th-TH', {hour12:false})],
    [I18N.t('common.camera'), ev.camera_id],
    ['Rule', ev.rule_name || '—'],
    [I18N.t('snap.type'), ev.event_type],
    ev.object_class ? ['Class', ev.object_class] : null,
    ['Confidence', ev.likelihood ? `${(ev.likelihood*100).toFixed(1)}%` : '—'],
    ev.speed       ? [I18N.t('snap.speed'), `${ev.speed} m/s`] : null,
    // Dahua zone events แนบ direction (Enter/Leave) มาใน envelope (Ph.2);
    // ค่าอื่น (เช่น LeftToRight) แสดงดิบเพราะไม่มีคำแปลมาตรฐาน
    ev.raw_json?.direction ? [I18N.t('snap.direction'),
      ['enter','leave'].includes(String(ev.raw_json.direction).toLowerCase())
        ? I18N.t('dir.' + String(ev.raw_json.direction).toLowerCase())
        : escapeHtml(String(ev.raw_json.direction))] : null,
    ['Source', ev.snapshot_source || '—'],
  ].filter(Boolean);

  // Phase 2 — "view full" opens the full-resolution image in a new tab
  // (capped per-camera by full_view_width; native original otherwise).
  let viewFullBtn = '';
  if (ev.snapshot_file) {
    const cap = camFullViewWidth(ev.camera_id);
    const fullUrl = `${API}/snapshots/${ev.snapshot_file}` + (cap ? `?w=${cap}` : '');
    viewFullBtn = `<button class="btn btn-secondary" style="font-size:11px" data-action="viewFullSnap">${I18N.t('snap.viewFull')}${cap ? ` (${cap}px)` : ''}</button>`;
  }
  // Phase 6.1.5 — link to pre-alarm clip if available
  const clipBtn = ev.clip_file && ev.clip_status === 'done'
    ? `<button class="btn btn-primary" style="font-size:11px" data-action="closeAndShowClip">${I18N.t('snap.viewClip')} (${ev.clip_duration_sec ? parseFloat(ev.clip_duration_sec).toFixed(1) + 's' : ''})</button>`
    : '';
  const btnRow = (viewFullBtn || clipBtn)
    ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${viewFullBtn}${clipBtn}</div>`
    : '';

  document.getElementById('snapModalBody').innerHTML = `
    ${imgHtml}
    ${btnRow}
    <div id="snapFieldsGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px">
      ${fields.map(([k, v]) => `<div><div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase">${k}</div><div style="font-size:13px;margin-top:2px">${v}</div></div>`).join('')}
    </div>
    <div id="snapAppearanceSection"></div>`;
  modal.classList.remove('hidden');

  // Dahua zone events — draw BoundingBox + rule DetectRegion on the snapshot.
  // หมายเหตุ: snapshot ถูกเลือกจาก RTSP buffer ใกล้เวลา event — กรอบอาจเหลื่อม
  // จากตัวคนเล็กน้อยเพราะคนละเฟรมกับที่ analytic ตัดสิน
  const ovlFlags = _camOverlayFlags(ev.camera_id);
  attachSnapOverlay(document.getElementById('snapModalImg'),
    [..._dahuaSnapShapes(ev.raw_json), ..._hikSnapShapes(ev.raw_json)]
      .filter(s => s.kind === 'box' ? ovlFlags.bbox : ovlFlags.zone));

  // Lazy-load IVA Pro appearance data — only shown when a record exists
  if (ev.id) {
    fetch(`${API}/api/events/${ev.id}/appearance`)
      .then(r => r.ok ? r.json() : null)
      .then(ap => {
        if (!ap) return;
        const sec = document.getElementById('snapAppearanceSection');
        if (!sec) return;
        sec.innerHTML = _renderAppearanceSection(ap);
      })
      .catch(() => {});
  }

  // Zone dwell duration — lazy, FieldDetector enter events only (server
  // ตรวจ type/state ซ้ำ). ไม่มี object identity → ค่าคือช่วงที่โซนมีคนอยู่
  if (ev.id && ev.event_type === 'FieldDetector/ObjectsInside') {
    fetch(`${API}/api/events/${ev.id}/dwell`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const grid = document.getElementById('snapFieldsGrid');
        // กัน race: ผู้ใช้เปิด event อื่นไปแล้วระหว่างรอ fetch
        if (!grid || window._currentSnapEv !== ev) return;
        const val = d.dwell_sec != null ? _fmtDwell(d.dwell_sec) : I18N.t('snap.dwellOpen');
        const cell = document.createElement('div');
        cell.innerHTML = `<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase">${escapeHtml(I18N.t('snap.dwell'))}</div><div style="font-size:13px;margin-top:2px">${escapeHtml(val)}</div>`;
        grid.appendChild(cell);
      })
      .catch(() => {});
  }
}

// Appearance value label maps (IVA Pro → display text)
const _APP_GENDER = { Male: { th: 'ชาย', en: 'Male' }, Female: { th: 'หญิง', en: 'Female' } };
const _APP_BAG = {
  ShoulderBag: { th: 'กระเป๋าสะพาย', en: 'Shoulder Bag' },
  Backpack:    { th: 'กระเป๋าเป้',   en: 'Backpack'    },
  Briefcase:   { th: 'กระเป๋าเอกสาร', en: 'Briefcase'  },
};
const _APP_COLOR = {
  Black:   { th: 'ดำ',            en: 'Black'   },
  White:   { th: 'ขาว',           en: 'White'   },
  Gray:    { th: 'เทา',           en: 'Gray'    },
  Blue:    { th: 'น้ำเงิน',       en: 'Blue'    },
  Green:   { th: 'เขียว',         en: 'Green'   },
  Red:     { th: 'แดง',           en: 'Red'     },
  Orange:  { th: 'ส้ม',           en: 'Orange'  },
  Yellow:  { th: 'เหลือง',        en: 'Yellow'  },
  Purple:  { th: 'ม่วง',          en: 'Purple'  },
  Brown:   { th: 'น้ำตาล',        en: 'Brown'   },
  Beige:   { th: 'เบจ',           en: 'Beige'   },
  Magenta: { th: 'ชมพูบานเย็น',   en: 'Magenta' },
  Khaki:   { th: 'กากี',          en: 'Khaki'   },
  Blonde:  { th: 'บลอนด์',        en: 'Blonde'  },
  Auburn:  { th: 'น้ำตาลแดง',     en: 'Auburn'  },
};
const _APP_TOP    = {
  ShortSleeve: { th: 'แขนสั้น', en: 'Short Sleeve' }, LongSleeve: { th: 'แขนยาว', en: 'Long Sleeve' },
  Sleeveless:  { th: 'กล้าม', en: 'Sleeveless' },     Jacket:     { th: 'แจ็คเก็ต', en: 'Jacket' },
  Coat:        { th: 'โค้ต', en: 'Coat' },             Vest:       { th: 'เสื้อกั๊ก', en: 'Vest' },
};
const _APP_BOT    = {
  Trousers: { th: 'กางเกงขายาว', en: 'Trousers' }, Shorts: { th: 'กางเกงขาสั้น', en: 'Shorts' },
  Skirt:    { th: 'กระโปรง', en: 'Skirt' },        Dress:  { th: 'ชุดเดรส', en: 'Dress' },
};
const _APP_HAIR   = {
  Short:   { th: 'สั้น', en: 'Short' }, Long:   { th: 'ยาว', en: 'Long' },
  Medium:  { th: 'กลาง', en: 'Medium' }, Bald:  { th: 'หัวล้าน', en: 'Bald' },
};

function _xyzToRgb(xyz) {
  if (!xyz) return null;
  const [r, g, b] = xyz.split(',').map(Number);
  if ([r, g, b].some(isNaN)) return null;
  return `rgb(${r},${g},${b})`;
}

function _appLabel(map, val) {
  const lang = (typeof I18N !== 'undefined' && I18N.getLang()) || 'th';
  return (map[val] && map[val][lang]) || escapeHtml(val) || null;
}

function _colorChip(xyz) {
  const rgb = _xyzToRgb(xyz);
  if (!rgb) return '';
  return `<span style="display:inline-block;width:10px;height:10px;background:${rgb};border-radius:2px;border:1px solid var(--border-hairline);vertical-align:middle;margin-right:4px"></span>`;
}

// Build appearance chips array — shared by modal section and search cards.
// ap may include upper_color/lower_color (named, from lazy-fetch endpoint).
function _buildAppChips(ap) {
  const chips = [];
  const colorLabel = name => name ? (_appLabel(_APP_COLOR, name) || escapeHtml(name)) : '';
  if (ap.gender)          chips.push([I18N.t('snap.appGender'), _appLabel(_APP_GENDER, ap.gender)]);
  if (ap.top_category) {
    const colorPart = ap.upper_color ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(ap.upper_color)}</span>` : '';
    chips.push([I18N.t('snap.appTop'), `${_colorChip(ap.top_color_xyz)}${_appLabel(_APP_TOP, ap.top_category)}${colorPart}`]);
  }
  if (ap.bottom_category) {
    const colorPart = ap.lower_color ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(ap.lower_color)}</span>` : '';
    chips.push([I18N.t('snap.appBottom'), `${_colorChip(ap.bottom_color_xyz)}${_appLabel(_APP_BOT, ap.bottom_category)}${colorPart}`]);
  }
  if (ap.hair_length) {
    const hairColorPart = ap.hair_color ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(ap.hair_color)}</span>` : '';
    chips.push([I18N.t('snap.appHair'), `${_colorChip(ap.hair_color_xyz)}${_appLabel(_APP_HAIR, ap.hair_length)}${hairColorPart}`]);
  }
  if (ap.glasses)         chips.push([I18N.t('snap.appGlasses'), '']);
  if (ap.bag_category)    chips.push([I18N.t('snap.appBag'),     _appLabel(_APP_BAG, ap.bag_category)]);
  if (ap.helmet_wear)     chips.push([I18N.t('snap.appHelmet'),  ap.helmet_subtype ? escapeHtml(ap.helmet_subtype) : '']);
  // Low-fidelity row จากกล้อง IVA non-Pro (migration 041/042): โทนสีรวมทั้งตัว —
  // แสดงครบทุก cluster (สูงสุด 3) เฉพาะเมื่อไม่มี garment attributes
  // (กล้อง Pro มี top/bottom ละเอียดกว่าอยู่แล้ว)
  if (!ap.top_category && !ap.bottom_category) {
    const cl = Array.isArray(ap.color_clusters) && ap.color_clusters.length
      ? ap.color_clusters.slice(0, 3)
      : (ap.overall_color ? [{ xyz: ap.overall_color_xyz, name: ap.overall_color }] : []);
    if (cl.length) {
      chips.push([I18N.t('snap.appOverall'),
        cl.map(c => `${_colorChip(c.xyz)}${colorLabel(c.name)}`).join(' ')]);
    }
  }
  return chips;
}

const _CHIP_STYLE = `display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;background:var(--surface-elevated);border:1px solid var(--border-hairline);font-size:11px`;
function _chipsHtml(chips) {
  return chips.map(([k, v]) =>
    `<span style="${_CHIP_STYLE}"><span style="color:var(--text-secondary)">${k}</span><span style="color:var(--text-primary)">${v}</span></span>`
  ).join('');
}

// Modal variant: includes section header + border-top separator
function _renderAppearanceSection(ap) {
  const chips = _buildAppChips(ap);
  if (!chips.length) return '';
  return `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-hairline)">
      <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;letter-spacing:.06em">${I18N.t('snap.appearance')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${_chipsHtml(chips)}</div>
    </div>`;
}

// Card variant: chips only, no header (used in search results grid)
function _renderAppearanceChips(ap) {
  const chips = _buildAppChips(ap);
  if (!chips.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${_chipsHtml(chips)}</div>`;
}

function closeSnapModal() { document.getElementById('snapModal').classList.add('hidden'); }

// ============================================================
// Media Page (Pre-alarm video clips — Phase 6.1.3)
// ============================================================
//
// Reuses the Snapshot page filter pattern but with /api/events?hasClip=true
// + <video controls> for inline playback. Filters: camera, category (Stats v2),
// rule_name, datetime range. Only shows events where the camera had
// enable_clip_capture=true AND the recorder finished writing the clip.
//
let mediaList = [];

async function populateMediaFilters() {
  const camsList = getActiveGroupCameras();
  const camSel = document.getElementById('mediaFilterCam');
  camSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    camsList.map(c => `<option value="${c.camera_id}">${c.camera_name || c.camera_id}</option>`).join('');

  // Reuse the cached facets/categories from Snapshot page (loaded once per session)
  const [facets, cats] = await Promise.all([_loadSnapFacets(), _loadSnapCategories()]);

  const ruleSel = document.getElementById('mediaFilterType');
  const rules = facets.rule_names || [];
  ruleSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    (rules.length
      ? rules.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')
      : `<option value="" disabled>${I18N.t('snap.noRules')}</option>`);

  const catSel = document.getElementById('mediaFilterCategory');
  if (catSel) {
    catSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
      (cats || []).map(c => `<option value="${c.id}">${escapeHtml((c.icon || '') + ' ' + c.name).trim()}</option>`).join('');
  }
}

function resetMediaFilters() {
  document.getElementById('mediaFilterCam').value = '';
  document.getElementById('mediaFilterType').value = '';
  const catSel = document.getElementById('mediaFilterCategory');
  if (catSel) catSel.value = '';
  clearDtValue('mediaFilterFrom');
  clearDtValue('mediaFilterTo');
  loadMedia(1);
}

// Phase 6.1.7 — server-side pagination: 20/page, no hard cap
let _mediaPage = 1;
let _mediaTotal = 0;

async function loadMedia(page = 1) {
  _mediaPage = page;
  const cam = document.getElementById('mediaFilterCam').value;
  const rule = document.getElementById('mediaFilterType').value;
  const catSel = document.getElementById('mediaFilterCategory');
  const categoryId = catSel ? catSel.value : '';
  const from = getDtValue('mediaFilterFrom');
  const to   = getDtValue('mediaFilterTo');
  const toIso = s => s ? new Date(s).toISOString() : '';

  const offset = (_mediaPage - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    hasClip: 'true',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (cam) params.set('camera', cam);
  if (!cam && activeGroupId !== 'all') {
    const ids = getActiveGroupCameraIds();
    if (ids.length) params.set('cameras', ids.join(','));
  }
  if (rule) params.set('rule_name', rule);
  if (categoryId) params.set('category_id', categoryId);
  if (from) params.set('from', toIso(from));
  if (to)   params.set('to',   toIso(to));

  const container = document.getElementById('mediaContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  document.getElementById('mediaCount').textContent = '…';

  try {
    const res = await fetch(`${API}/api/events?${params.toString()}`, { cache: 'no-store' });
    _mediaTotal = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    mediaList = await res.json();
    document.getElementById('mediaCount').textContent = _mediaTotal.toLocaleString();
    renderMedia();
    renderPagination('mediaPagination', _mediaPage, _mediaTotal, PAGE_SIZE,
      (p) => loadMedia(p), 'clip');
  } catch (e) {
    console.error(e);
    if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">${escapeHtml(I18N.t('common.loadFailedShort'))}</div>`;
    document.getElementById('mediaCount').textContent = '0';
  }
}

function renderMedia() {
  const c = document.getElementById('mediaContainer');
  if (mediaList.length === 0) {
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dim)">
      ${I18N.t('media.noMatch')}<br>
      <span style="font-size:11px">${I18N.t('media.emptyHint')}</span>
    </div>`;
    return;
  }

  c.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${mediaList.map((ev, idx) => {
    const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
    const dur = ev.clip_duration_sec ? `${parseFloat(ev.clip_duration_sec).toFixed(1)}s` : '—';
    return `
      <div class="media-card" style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;overflow:hidden;cursor:pointer" data-action="showMediaClip" data-source="media" data-idx="${idx}">
        <div style="position:relative;background:#000;aspect-ratio:16/9">
          <video src="${API}/media/${ev.clip_file}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:contain"></video>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25);pointer-events:none">
            <div style="background:rgba(0,0,0,0.7);color:#fff;border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:18px">▶</div>
          </div>
          <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;font-family:monospace">${dur}</div>
        </div>
        <div style="padding:10px">
          <div style="font-weight:600;font-size:12px">${escapeHtml(ev.rule_name || eventDisplayName(ev))}</div>
          <div style="color:var(--dim);font-size:10px;margin-top:3px">${escapeHtml(ev.camera_id)} · ${escapeHtml(ev.object_class || '—')}</div>
          <div style="color:var(--muted);font-size:10px;margin-top:2px">${time}</div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

function showMediaClip(ev) {
  window._currentMediaEv = ev;
  const modal = document.getElementById('mediaModal');
  const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
  document.getElementById('mediaModalTitle').textContent = `${ev.rule_name || eventDisplayName(ev)} — ${ev.camera_id}`;
  const dur = ev.clip_duration_sec ? `${parseFloat(ev.clip_duration_sec).toFixed(1)}s` : '—';
  const fields = [
    [I18N.t('evt.colTime'), time],
    [I18N.t('common.camera'), ev.camera_id],
    ['Rule', ev.rule_name || '—'],
    ['Object', ev.object_class || '—'],
    ['Confidence', ev.likelihood ? `${(ev.likelihood*100).toFixed(1)}%` : '—'],
    ['Duration', dur],
  ];
  document.getElementById('mediaModalBody').innerHTML = `
    <video src="${API}/media/${ev.clip_file}" controls autoplay style="width:100%;max-height:560px;background:#000;border-radius:8px"></video>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px">
      ${fields.map(([k, v]) => `<div><div style="font-size:10px;color:var(--dim);text-transform:uppercase">${k}</div><div style="font-size:13px;margin-top:2px">${escapeHtml(String(v))}</div></div>`).join('')}
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <a href="${API}/media/${ev.clip_file}" download class="btn btn-secondary" style="font-size:11px">⬇ Download MP4</a>
      ${ev.snapshot_file ? `<button class="btn btn-secondary" data-action="showSnapFromMedia" style="font-size:11px">${I18N.t('media.viewSnap')}</button>` : ''}
    </div>`;
  modal.classList.remove('hidden');
}

function closeMediaModal() {
  const modal = document.getElementById('mediaModal');
  // Stop playback when closing — otherwise audio keeps going in background
  const v = modal.querySelector('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  modal.classList.add('hidden');
}

// ============================================================
// MAP — with toggle and hover popup
// ============================================================

function initMap() {
  // 🆕 Map providers — Carto (default, free) + Mapbox (POI ละเอียด, ต้อง token)
  const tileUrls = {
    online: {
      carto: {
        streets: 'https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        light:   'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      },
      mapbox: {
        // จะถูก replace ด้วย token จริงตอน apply
        streets: '__MAPBOX_STREETS__',
        light:   '__MAPBOX_LIGHT__',
      },
    },
    offline: {
      carto: {
        streets: '/tiles/carto/streets/{z}/{x}/{y}.png',
        light:   '/tiles/carto/light/{z}/{x}/{y}.png',
      },
      mapbox: {
        streets: '/tiles/mapbox/streets/{z}/{x}/{y}.png',
        light:   '/tiles/mapbox/light/{z}/{x}/{y}.png',
      },
    },
  };

  // โหลดค่าจาก localStorage
  let savedStyle = localStorage.getItem('mapStyle') || 'streets';
  if (savedStyle === 'dark') savedStyle = 'streets';
  const savedSource   = localStorage.getItem('mapSource')   || 'online';
  const savedProvider = localStorage.getItem('mapProvider') || 'carto';

  // เก็บ reference สำหรับ toggle
  mapLayers._tileUrls = tileUrls;
  mapLayers._currentStyle    = savedStyle;
  mapLayers._currentSource   = savedSource;
  mapLayers._currentProvider = savedProvider;
  mapLayers._mapboxAvailable = false;

  // โหลด mapbox availability จาก backend (async) — SEC-017: token stays server-side
  fetch(`${API}/api/config`)
    .then(r => r.json())
    .then(cfg => {
      mapLayers._mapboxAvailable = cfg.mapboxAvailable || false;
      if (cfg.mapboxAvailable) {
        // SEC-017: proxy URLs — token never leaves the server
        tileUrls.online.mapbox.streets = `${API}/api/map/tiles/mapbox/streets/{z}/{x}/{y}.png`;
        tileUrls.online.mapbox.light   = `${API}/api/map/tiles/mapbox/light/{z}/{x}/{y}.png`;
        if (mapLayers._currentProvider === 'mapbox' && mapLayers._currentSource === 'online') {
          applyMapTileSource();
        }
      } else if (savedProvider === 'mapbox') {
        mapLayers._currentProvider = 'carto';
        localStorage.setItem('mapProvider', 'carto');
        applyMapTileSource();
      }
    }).catch(() => {});

  // Helper: get current URL safely (handles mapbox token not loaded yet)
  const getCurrentUrl = () => {
    const url = tileUrls[savedSource][savedProvider]?.[savedStyle];
    // ถ้าเป็น mapbox แต่ token ยังไม่โหลด → ใช้ carto ก่อน
    if (url && url.startsWith('__MAPBOX')) {
      return tileUrls[savedSource].carto[savedStyle];
    }
    return url;
  };

  // สร้าง base layer
  mapLayers.base = new ol.layer.Tile({
    source: new ol.source.XYZ({
      url: getCurrentUrl(),
      crossOrigin: 'anonymous',
      attributions: getAttribution(savedSource, savedProvider),
    })
  });

  map = new ol.Map({
    target: 'map',
    layers: [mapLayers.base],
    view: new ol.View({ center: ol.proj.fromLonLat([100.5018, 13.7563]), zoom: 12 })
  });

  // ปรับ background ของ #map (ทั้ง 2 style พื้นหลังสว่าง)
  document.getElementById('map').style.background = '#f5f5f5';

  // Heatmap layer
  mapLayers.heat = new ol.layer.Heatmap({
    source: new ol.source.Vector(),
    blur: 25,
    radius: 18,
    weight: (f) => f.get('weight') || 0.5,
  });
  map.addLayer(mapLayers.heat);

  // Camera markers layer with clustering — at 100+ cameras in a building
  // the individual markers crowd together and the text labels overlap into
  // unreadable mush. Cluster source groups features within 40 px of each
  // other into a single bubble; zoom in to break them apart. Hover-popup
  // still works on single-feature clusters; clicking a multi-feature
  // cluster zooms the view to the bounding box of its children.
  mapLayers._camRawSrc = new ol.source.Vector();
  const camClusterSrc = new ol.source.Cluster({
    distance: 40,
    source: mapLayers._camRawSrc,
  });
  function camMarkerStyle(feature) {
    const fs = feature.get('features') || [];
    // Multi-feature cluster — fill = online mix; stroke = group color if
    // all features share one group, neutral gray if mixed groups.
    if (fs.length > 1) {
      const onlineN = fs.filter(f => f.get('online')).length;
      const fill = onlineN === fs.length ? token('--status-ok')
                 : onlineN === 0         ? token('--muted')
                                         : token('--warn');
      const groupIdSet = new Set(fs.map(f => f.get('group_id')));
      const strokeColor = groupIdSet.size === 1
        ? (fs[0].get('group_color') || token('--muted'))
        : token('--muted');
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 14 + Math.min(fs.length, 30) * 0.4,
          fill: new ol.style.Fill({ color: fill }),
          stroke: new ol.style.Stroke({ color: strokeColor, width: 3 }),
        }),
        text: new ol.style.Text({
          text: String(fs.length),
          fill: new ol.style.Fill({ color: '#fff' }),
          font: 'bold 13px sans-serif',
        }),
      });
    }
    // Single feature — fill = online/offline status; stroke = group color.
    const f = fs[0] || feature;
    const online = f.get('online');
    const camName = f.get('name') || '';
    const count = f.get('eventCount') || 0;
    const groupColor = f.get('group_color') || token('--muted');
    const label = count > 0 ? `${camName} (${count})` : camName;
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: 9,
        fill: new ol.style.Fill({ color: online ? token('--status-ok') : token('--muted') }),
        stroke: new ol.style.Stroke({ color: groupColor, width: 3 }),
      }),
      text: new ol.style.Text({
        text: label, offsetY: -20,
        fill: new ol.style.Fill({ color: '#fff' }),
        stroke: new ol.style.Stroke({ color: '#0a0e1a', width: 3 }),
        font: 'bold 11px sans-serif',
      }),
    });
  }
  mapLayers.cams = new ol.layer.Vector({ source: camClusterSrc, style: camMarkerStyle });
  map.addLayer(mapLayers.cams);

  // Hover popup — features delivered here are cluster wrappers. Only show
  // the popup when the wrapper holds exactly one underlying feature; for
  // multi-feature clusters, just hide the popup (the count is on the bubble).
  map.on('pointermove', (e) => {
    if (e.dragging) return;
    const pixel = map.getEventPixel(e.originalEvent);
    const feature = map.forEachFeatureAtPixel(pixel, (f, layer) => layer === mapLayers.cams ? f : null);
    const fs = feature ? (feature.get('features') || []) : [];
    if (fs.length === 1) showCamPopup(fs[0], pixel);
    else hidePopup();
  });

  map.on('click', (e) => {
    map.forEachFeatureAtPixel(e.pixel, (f, layer) => {
      if (layer !== mapLayers.cams) return;
      const fs = f.get('features') || [];
      if (fs.length > 1) {
        // Multi-feature cluster — zoom in to spread its children apart.
        const ext = ol.extent.createEmpty();
        fs.forEach(child => ol.extent.extend(ext, child.getGeometry().getExtent()));
        map.getView().fit(ext, { padding: [80, 80, 80, 80], maxZoom: 19, duration: 400 });
      } else if (fs.length === 1 && fs[0].get('camera_id')) {
        // Single — pin popup on click; auto-hide after 3s.
        clearTimeout(mapPopupTimer);
        mapPopupTimer = setTimeout(hidePopup, 3000);
      }
    });
  });
}

function toggleMapLayer(which, btn) {
  if (which === 'heat') {
    mapShowHeat = !mapShowHeat;
    mapLayers.heat.setVisible(mapShowHeat);
  } else {
    mapShowCams = !mapShowCams;
    mapLayers.cams.setVisible(mapShowCams);
  }
  btn.classList.toggle('active');
}

// 🆕 Toggle Streets / Light map style
function toggleMapStyle() {
  if (!map || !mapLayers.base) return;
  const newStyle = mapLayers._currentStyle === 'streets' ? 'light' : 'streets';
  mapLayers._currentStyle = newStyle;
  applyMapTileSource();
  const btn = document.getElementById('togStyle');
  if (btn) btn.textContent = newStyle === 'streets' ? 'STREETS' : 'LIGHT';
  localStorage.setItem('mapStyle', newStyle);
}

// 🆕 Toggle Online / Offline tile source
function toggleMapSource() {
  if (!map || !mapLayers.base) return;
  const newSource = mapLayers._currentSource === 'online' ? 'offline' : 'online';
  mapLayers._currentSource = newSource;
  applyMapTileSource();
  const btn = document.getElementById('togSource');
  if (btn) btn.textContent = newSource === 'online' ? 'ONLINE' : 'OFFLINE';
  localStorage.setItem('mapSource', newSource);
}

// 🆕 Toggle Carto / Mapbox provider
function toggleMapProvider() {
  if (!map || !mapLayers.base) return;
  const current = mapLayers._currentProvider || 'carto';
  const newProvider = current === 'carto' ? 'mapbox' : 'carto';

  if (newProvider === 'mapbox' && !mapLayers._mapboxAvailable) {
    alert(I18N.t('map.noMapboxToken'));
    return;
  }

  mapLayers._currentProvider = newProvider;
  applyMapTileSource();
  const btn = document.getElementById('togProvider');
  if (btn) btn.textContent = newProvider === 'carto' ? 'CARTO' : 'MAPBOX';
  localStorage.setItem('mapProvider', newProvider);
}

// Helper: build attribution string
function getAttribution(source, provider) {
  if (source === 'offline') return 'Offline cache · © OpenStreetMap contributors';
  if (provider === 'mapbox') return '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  return '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>';
}

// Apply current style + source + provider combination to map
function applyMapTileSource() {
  const style    = mapLayers._currentStyle;
  const source   = mapLayers._currentSource;
  const provider = mapLayers._currentProvider || 'carto';

  let url = mapLayers._tileUrls[source][provider]?.[style];
  // Fallback ถ้าไม่มี url (เช่น mapbox token ยังไม่โหลด)
  if (!url || url.startsWith('__MAPBOX')) {
    url = mapLayers._tileUrls[source].carto[style];
  }

  mapLayers.base.setSource(new ol.source.XYZ({
    url,
    crossOrigin: 'anonymous',
    attributions: getAttribution(source, provider),
  }));
}

// Auto-refresh "EVENTS 24H" + heatmap while user is on the map page.
// Without this, the rolling-24h number could be 30+ minutes stale before the
// user navigates away and comes back. 60s matches the today-counts cadence.
let _mapRefreshTimer = null;
function startMapAutoRefresh() {
  if (_mapRefreshTimer) return;
  _mapRefreshTimer = setInterval(() => {
    if (document.getElementById('page-map')?.classList.contains('active')) refreshMap();
  }, 60_000);
}
function stopMapAutoRefresh() {
  if (_mapRefreshTimer) { clearInterval(_mapRefreshTimer); _mapRefreshTimer = null; }
}

async function refreshMap() {
  if (!map) return;

  // Build camera_id → group lookup from groups[] (cameraIds membership).
  // Cameras not in any group get group_id=null (always visible).
  const camGroupMap = {};
  groups.forEach(g => {
    (g.cameraIds || []).forEach(cid => { camGroupMap[cid] = g; });
  });

  // All cameras with coordinates; filter by legend visibility.
  const allCams = cameras.filter(c => c.latitude && c.longitude);
  const visCams = allCams.filter(c => {
    const g = camGroupMap[c.camera_id];
    return !g || !hiddenGroupIds.has(g.id);
  });

  try {
    const res = await fetch(`${API}/api/heatmap?hours=24`);
    const data = await res.json();
    const counts = {};
    data.forEach(d => { counts[d.camera_id] = d.count; });

    const heatSrc = mapLayers.heat.getSource();
    // Features go into the RAW vector source; the Cluster source wraps it
    // and exposes groupings to the layer. Calling .getSource() on the
    // layer would return the Cluster (clearing it isn't supported).
    const camSrc = mapLayers._camRawSrc;
    heatSrc.clear();
    camSrc.clear();

    const maxCount = Math.max(1, ...Object.values(counts));

    visCams.forEach(c => {
      const count = counts[c.camera_id] || 0;
      const coord = ol.proj.fromLonLat([parseFloat(c.longitude), parseFloat(c.latitude)]);
      const grp = camGroupMap[c.camera_id];

      camSrc.addFeature(new ol.Feature({
        geometry: new ol.geom.Point(coord),
        camera_id: c.camera_id,
        name: c.camera_name || c.camera_id,
        ip: c.ip_address,
        location: c.location,
        status: c.status,
        online: c.status === 'online',
        eventCount: count,
        cam: c,
        group_id: grp ? grp.id : null,
        group_color: grp ? (grp.color || '#94a3b8') : '#94a3b8',
      }));

      if (count > 0) {
        const f = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        f.set('weight', Math.max(0.3, count / maxCount));
        heatSrc.addFeature(f);
      }
    });

    if (visCams.length > 0 && !_mapWallOn) {
      const ext = camSrc.getExtent();
      if (ext[0] !== Infinity) {
        map.getView().fit(ext, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 400 });
      }
    }

    document.getElementById('mapCamLabel').textContent =
      I18N.t('map.nCameras').replace('{n}', visCams.length);

    // Stats bar — counts based on visible cameras only.
    const online = visCams.filter(c => c.status === 'online').length;
    const offline = visCams.length - online;
    const totalEvents = visCams.reduce((s, c) => s + (counts[c.camera_id] || 0), 0);
    document.getElementById('mapStatsBar').innerHTML = `
      <div class="ms-item"><div class="ms-dot" style="background:var(--green)"></div><div><div class="ms-txt">ONLINE</div><div class="ms-val" style="color:var(--green)">${online}</div></div></div>
      <div class="ms-item"><div class="ms-dot" style="background:var(--red)"></div><div><div class="ms-txt">OFFLINE</div><div class="ms-val" style="color:var(--red)">${offline}</div></div></div>
      <div class="ms-item" title="${I18N.t('map.events24hTip')}"><div class="ms-dot" style="background:var(--accent)"></div><div><div class="ms-txt">EVENTS 24H (rolling)</div><div class="ms-val" style="color:var(--accent)">${totalEvents}</div></div></div>
    `;
  } catch (e) { console.error('refreshMap:', e); }
}

function renderMapLegend() {
  const el = document.getElementById('mapLegendPanel');
  if (!el) return;
  const grpBar = document.getElementById('grpBarMap');
  if (grpBar) grpBar.style.display = groups.length > 0 ? 'none' : '';

  const N = groups.length;

  // Ungrouped = cameras with coords not in any group
  const groupedCamIds = new Set(groups.flatMap(g => g.cameraIds || []));
  const ungroupedCount = cameras.filter(c => c.latitude && c.longitude && !groupedCamIds.has(c.camera_id)).length;

  if (N === 0 && ungroupedCount === 0) { el.innerHTML = ''; return; }

  // Mode threshold: measure on total N, NOT on search-filtered count
  const mode = N < 6 ? 'compact' : N <= 20 ? 'scroll' : 'drawer';

  const q = (el.dataset.legendQ || '').toLowerCase();
  const collapsed = el.dataset.legendCollapsed === '1';
  const allHidden = N > 0 && groups.every(g => hiddenGroupIds.has(g.id));

  // Search filters chip display only — does NOT affect hiddenGroupIds or refreshMap()
  const visGroups = q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups;

  const chipsHtml = visGroups.map(g => {
    const hidden = hiddenGroupIds.has(g.id);
    const swatch = g.color || '#94a3b8';
    return `<label class="ml-chip${hidden ? ' ml-chip-off' : ''}">
      <input type="checkbox" ${hidden ? '' : 'checked'} data-change="toggleMapGroup" data-gid="${g.id}">
      <span class="ml-swatch" style="background:${swatch}"></span>
      <span class="ml-name">${escapeHtml(g.name)}</span>
    </label>`;
  }).join('');

  const ungroupedChip = ungroupedCount > 0
    ? `<div class="ml-chip ml-chip-ungroup">
        <span class="ml-swatch" style="background:#94a3b8"></span>
        <span class="ml-name">${I18N.t('map.ungrouped')} (${ungroupedCount})</span>
       </div>`
    : '';

  if (mode === 'drawer') {
    // Panel = trigger button only; chips live inside drawer
    el.innerHTML = `<button class="map-legend-drawer-btn" data-action="toggleMapDrawer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      ${I18N.t('map.legendGroups')} (${N})
    </button>`;
    const drawer = document.getElementById('mapLegendDrawer');
    if (drawer) {
      drawer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="ml-title">${I18N.t('map.legendGroups')}</div>
          <button data-action="toggleMapDrawer" style="background:none;border:none;cursor:pointer;color:var(--text);font-size:14px;">&#x2715;</button>
        </div>
        <input class="ml-search" type="search" placeholder="${I18N.t('map.legendSearch')}" value="${escapeHtml(q)}" data-input="legendSearch">
        <div class="ml-controls">
          <button class="ml-hide-all-btn" data-action="${allHidden ? 'legendShowAll' : 'legendHideAll'}">${I18N.t(allHidden ? 'map.legendShowAll' : 'map.legendHideAll')}</button>
        </div>
        <div class="ml-chips-wrap scrollable">${chipsHtml}${ungroupedChip}</div>`;
    }
    return;
  }

  // Overlay modes (compact / scroll)
  const showControls = mode === 'scroll';
  el.innerHTML = `
    <div class="ml-title" style="display:flex;align-items:center;justify-content:space-between;">
      <span>Groups</span>
      ${showControls ? `<button class="ml-collapse-btn" data-action="legendCollapse">${I18N.t(collapsed ? 'map.legendExpand' : 'map.legendCollapse')}</button>` : ''}
    </div>
    ${showControls ? `<input class="ml-search" type="search" placeholder="${I18N.t('map.legendSearch')}" value="${escapeHtml(q)}" data-input="legendSearch">` : ''}
    ${showControls ? `<div class="ml-controls">
      <button class="ml-hide-all-btn" data-action="${allHidden ? 'legendShowAll' : 'legendHideAll'}">${I18N.t(allHidden ? 'map.legendShowAll' : 'map.legendHideAll')}</button>
    </div>` : ''}
    <div class="ml-chips-wrap${mode === 'scroll' ? ' scrollable' : ''}${collapsed ? ' collapsed' : ''}">
      ${chipsHtml}${ungroupedChip}
    </div>`;
}

function toggleMapGroup(gid) {
  if (hiddenGroupIds.has(gid)) hiddenGroupIds.delete(gid);
  else hiddenGroupIds.add(gid);
  renderMapLegend();
  refreshMap();
}

function _legendSearch(q) {
  const el = document.getElementById('mapLegendPanel');
  if (el) { el.dataset.legendQ = q; renderMapLegend(); }
  // NO refreshMap() — search is legend-UI-only, does not affect map markers
}

function _legendHideAll() {
  groups.forEach(g => hiddenGroupIds.add(g.id));
  renderMapLegend();
  refreshMap();
}

function _legendShowAll() {
  hiddenGroupIds.clear();
  renderMapLegend();
  refreshMap();
}

function _legendCollapse() {
  const el = document.getElementById('mapLegendPanel');
  if (!el) return;
  el.dataset.legendCollapsed = el.dataset.legendCollapsed === '1' ? '0' : '1';
  renderMapLegend();
}

function toggleMapDrawer() {
  const drawer = document.getElementById('mapLegendDrawer');
  if (!drawer) return;
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open');
  // Re-render drawer content when opening (picks up latest hiddenGroupIds state)
  if (opening) renderMapLegend();
}

// ── Live Pulse (T2) ──────────────────────────────────────────────────────────

function toggleMapPulse() {
  _mapPulseOn = !_mapPulseOn;
  localStorage.setItem('mapLivePulseOn', JSON.stringify(_mapPulseOn));
  const btn = document.getElementById('btnMapPulse');
  if (btn) { btn.setAttribute('aria-pressed', String(_mapPulseOn)); btn.classList.toggle('active', _mapPulseOn); }
  if (!_mapPulseOn) _clearAllMapPulseCards();
}

function setMapPulseDebounce(ms) {
  _mapPulseDebounceMs = parseInt(ms, 10);
  localStorage.setItem('mapLivePulseDebounceMs', String(_mapPulseDebounceMs));
}

function recenterMap() {
  if (!map || !mapLayers._camRawSrc) return;
  const ext = mapLayers._camRawSrc.getExtent();
  if (ext[0] === Infinity) return;
  map.getView().fit(ext, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 400 });
}

function toggleMapSecondary() {
  const sec = document.getElementById('mapSecondary');
  const btn = document.getElementById('btnMapMore');
  if (!sec) return;
  const open = sec.classList.toggle('open');
  if (btn) {
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  }
}

function toggleWallMode() {
  _mapWallOn = !_mapWallOn;
  localStorage.setItem('mapWallMode', JSON.stringify(_mapWallOn));
  document.body.classList.toggle('map-wall-mode', _mapWallOn);
  document.getElementById('btnWallMode')?.classList.toggle('active', _mapWallOn);
  if (_mapWallOn) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  setTimeout(() => map && map.updateSize(), 50);
}

function _positionPulseCard(el, pixel, wrapper) {
  const mapH = document.getElementById('map')?.offsetHeight || 400;
  const wW = wrapper.offsetWidth || 400;
  const cW = el.offsetWidth || 180;
  const cH = el.offsetHeight || 80;
  const markerR = 9;
  const flipDown = pixel[1] < mapH * 0.2;
  el.style.left = `${Math.max(4, Math.min(pixel[0] - cW / 2, wW - cW - 4))}px`;
  el.style.top  = flipDown ? `${pixel[1] + markerR + 5}px` : `${pixel[1] - cH - markerR - 5}px`;
}

function _removeMapPulseCard(cid) {
  const s = _mapPulseState.get(cid);
  if (!s) return;
  clearTimeout(s.fadeId);
  clearTimeout(s.expireId);
  s.el.remove();
  _mapPulseState.delete(cid);
}

function _clearAllMapPulseCards() {
  for (const cid of [..._mapPulseState.keys()]) _removeMapPulseCard(cid);
}

// ── Map Face Overlay ────────────────────────────────────────────

function _handleMapFaceCard(event) {
  if (!_mapFaceOn || !map) return;
  if (!document.getElementById('page-map')?.classList.contains('active')) return;

  const cid = event.camera_id;
  let feat = null;
  mapLayers._camRawSrc?.forEachFeature(f => { if (f.get('camera_id') === cid) feat = f; });
  if (!feat) return;

  // Strict viewport check — pixel must land within map element bounds.
  const pixel = map.getPixelFromCoordinate(feat.getGeometry().getCoordinates());
  if (!pixel) return;
  const mapEl = document.getElementById('map');
  if (!mapEl || pixel[0] < 0 || pixel[1] < 0 || pixel[0] > mapEl.offsetWidth || pixel[1] > mapEl.offsetHeight) return;

  // Evict oldest card if at capacity.
  if (_mapFaceCardList.length >= 4) {
    const oldest = _mapFaceCardList.shift();
    if (oldest) { clearTimeout(oldest.timeoutId); oldest.el.remove(); }
  }

  const cam = cameras.find(c => c.camera_id === cid);
  const camName = escapeHtml(cam?.camera_name || cid);
  const rj = event.raw_json || {};
  const snapFile = rj._snapshot;
  const snapUrl = snapFile ? `${API}/snapshots/${encodeURIComponent(snapFile)}?w=80` : null;
  const genderTxt = faceGenderLabel(rj.gender);
  const ageTxt = faceAgeBucket(rj.age);
  const attr = [genderTxt, ageTxt].filter(Boolean).join(' · ');

  const thumb = snapUrl
    ? `<img class="mfc-crop" src="${snapUrl}" alt="" data-err="hide">`
    : `<div class="mfc-no-crop"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`;

  const el = document.createElement('div');
  el.className = 'map-face-card';
  el.innerHTML = `${thumb}<div class="mfc-body"><div class="mfc-name">${camName}</div>${attr ? `<div class="mfc-attr">${escapeHtml(attr)}</div>` : ''}</div>`;
  el.addEventListener('click', () => { _faceJumpCamera = cid; showPage('faces'); });

  const stack = document.getElementById('mapFaceStack');
  if (!stack) return;
  stack.insertBefore(el, stack.firstChild); // newest at top

  const entry = { el, camera_id: cid, timeoutId: null };
  entry.timeoutId = setTimeout(() => {
    el.remove();
    const idx = _mapFaceCardList.indexOf(entry);
    if (idx !== -1) _mapFaceCardList.splice(idx, 1);
  }, 8000);
  _mapFaceCardList.push(entry);
}

function _clearAllMapFaceCards() {
  for (const c of _mapFaceCardList) { clearTimeout(c.timeoutId); c.el.remove(); }
  _mapFaceCardList.length = 0;
}

function toggleMapFaceOverlay() {
  _mapFaceOn = !_mapFaceOn;
  localStorage.setItem('mapFaceOverlayOn', JSON.stringify(_mapFaceOn));
  const btn = document.getElementById('btnMapFace');
  if (btn) { btn.setAttribute('aria-pressed', String(_mapFaceOn)); btn.classList.toggle('active', _mapFaceOn); }
  if (!_mapFaceOn) _clearAllMapFaceCards();
}

function _handleMapPulse(event) {
  if (!_mapPulseOn || !map) return;
  if (!document.getElementById('page-map')?.classList.contains('active')) return;

  const cid = event.camera_id;
  // Find the OL feature for this camera in the raw (pre-cluster) source.
  let feat = null;
  mapLayers._camRawSrc?.forEachFeature(f => { if (f.get('camera_id') === cid) feat = f; });
  if (!feat) return;

  const pixel = map.getPixelFromCoordinate(feat.getGeometry().getCoordinates());
  if (!pixel) return;

  const now = Date.now();
  const existing = _mapPulseState.get(cid);

  if (existing && (now - existing.lastAt) < _mapPulseDebounceMs) {
    // Bump: reset both timers; revive card if it has already faded from DOM.
    existing.bumpCount += 1;
    existing.lastAt = now;
    clearTimeout(existing.fadeId);
    clearTimeout(existing.expireId);
    const wrapper = document.querySelector('.map-wrapper');
    if (wrapper && !existing.el.isConnected) {
      wrapper.appendChild(existing.el);
      _positionPulseCard(existing.el, pixel, wrapper);
    }
    const bumpEl = existing.el.querySelector('.mpc-bump');
    if (bumpEl) { bumpEl.style.display = ''; bumpEl.textContent = `+${existing.bumpCount} more`; }
    existing.fadeId   = setTimeout(() => existing.el.remove(), 5000);
    existing.expireId = setTimeout(() => _removeMapPulseCard(cid), _mapPulseDebounceMs);
    return;
  }

  // R7 suppress: skip new cards while camera popup is open (deliberate simplification
  // vs spec's per-overlap check — easier and avoids race with 3s popup auto-close).
  const popup = document.getElementById('mapPopup');
  if (popup && !popup.classList.contains('hidden')) return;

  // Evict oldest entry when at capacity.
  if (_mapPulseState.size >= 6) _removeMapPulseCard(_mapPulseState.keys().next().value);

  // Build card.
  const cam = cameras.find(c => c.camera_id === cid);
  const camName = escapeHtml(cam?.camera_name || cam?.camera_id || cid);
  const loc = cam?.location ? ' · ' + escapeHtml(cam.location) : '';
  const rule = event.rule_name ? `<div class="mpc-rule">${escapeHtml(event.rule_name)}</div>` : '';
  const snapFile = event.snapshot_file || event.snapshot_filename;
  const snapUrl = snapFile
    ? `${API}/snapshots/${encodeURIComponent(snapFile)}?w=80`
    : null;
  const thumb = snapUrl
    ? `<img class="mpc-thumb" src="${snapUrl}" alt="" data-err="hide">`
    : `<div class="mpc-thumb mpc-no-snap"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M2 20c0-3.5 4-6 10-6s10 2.5 10 6"/></svg></div>`;

  const el = document.createElement('div');
  el.className = 'map-pulse-card';
  el.style.cursor = 'pointer';
  el.style.pointerEvents = 'auto';
  el.innerHTML = `${thumb}<div class="mpc-body"><div class="mpc-name">${camName}${loc}</div>${rule}<div class="mpc-bump" style="display:none"></div></div>`;
  el.addEventListener('click', () => showSnapshot(event));

  const wrapper = document.querySelector('.map-wrapper');
  if (!wrapper) return;
  wrapper.appendChild(el);
  _positionPulseCard(el, pixel, wrapper);

  const fadeId   = setTimeout(() => el.remove(), 5000);
  const expireId = setTimeout(() => _removeMapPulseCard(cid), _mapPulseDebounceMs);
  _mapPulseState.set(cid, { el, lastAt: now, bumpCount: 0, fadeId, expireId });
}

async function showCamPopup(feat, pixel) {
  const popup = document.getElementById('mapPopup');
  const cam = feat.get('cam');
  const count = feat.get('eventCount') || 0;
  const camId = cam.camera_id;
  const statusCls = cam.status === 'online' ? 'mp-status-online' : 'mp-status-offline';

  // Show static camera info immediately; rules section filled async below.
  popup.innerHTML = `
    <div class="mp-name" style="display:flex;align-items:center;gap:6px">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;opacity:0.7"><rect x="1" y="8" width="15" height="8" rx="2.5"/><rect x="16" y="10" width="5" height="4" rx="1.5"/><circle cx="21.5" cy="12" r="1.5"/><line x1="7" y1="16" x2="7" y2="22"/><line x1="3" y1="22" x2="11" y2="22"/></svg>
      ${escapeHtml(cam.camera_name || cam.camera_id)}
    </div>
    <div class="mp-row"><span class="mp-label">CAMERA ID</span><span class="mp-val">${escapeHtml(cam.camera_id)}</span></div>
    <div class="mp-row"><span class="mp-label">IP</span><span class="mp-val" style="font-family:monospace">${escapeHtml(cam.ip_address || '—')}</span></div>
    <div class="mp-row"><span class="mp-label">LOCATION</span><span class="mp-val">${escapeHtml(cam.location || '—')}</span></div>
    <div class="mp-row"><span class="mp-label">STATUS</span><span class="mp-val ${statusCls}">${escapeHtml((cam.status || 'unknown').toUpperCase())}</span></div>
    <div class="mp-row"><span class="mp-label">EVENTS 24H</span><span class="mp-val" style="color:var(--accent)">${count} detected</span></div>
    ${count > 0 ? `<div id="mp-rules" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border);color:var(--dim);font-size:10px">...</div>` : ''}`;

  popup.style.display = 'block';
  popup.classList.remove('hidden');
  const popHeight = popup.offsetHeight;
  popup.style.left = `${Math.max(0, pixel[0] - 130)}px`;
  popup.style.top  = `${Math.max(0, pixel[1] - popHeight - 24)}px`;

  if (count === 0) return;

  // Fetch top rules on-demand — avoids dependency on Events page being visited first
  // (previously used allEvents[] which is empty until loadEvents() runs).
  try {
    const to  = new Date().toISOString();
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await fetch(`${API}/api/events?camera=${encodeURIComponent(camId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=50`);
    if (!res.ok) throw new Error('fetch');
    const events = await res.json();

    const rulesEl = document.getElementById('mp-rules');
    if (!rulesEl || popup.classList.contains('hidden')) return;

    const ruleCount = {};
    events.forEach(e => {
      const k = e.rule_name || e.event_type?.split('/').pop() || 'Unknown';
      ruleCount[k] = (ruleCount[k] || 0) + 1;
    });
    const topRules = Object.entries(ruleCount).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (topRules.length === 0) { rulesEl.remove(); return; }

    const maxRule = Math.max(1, ...topRules.map(r => r[1]));
    rulesEl.innerHTML = topRules.map(([rule, cnt], i) => {
      const color = COLORS[i % COLORS.length];
      return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:3px 0">
        <span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(rule)}</span>
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${cnt / maxRule * 100}%;background:${color};border-radius:2px"></div>
        </div>
        <span style="color:${color};font-family:monospace;min-width:24px;text-align:right">${cnt}</span>
      </div>`;
    }).join('');
  } catch (_) {
    const rulesEl = document.getElementById('mp-rules');
    if (rulesEl) rulesEl.remove();
  }
}

function hidePopup() {
  const popup = document.getElementById('mapPopup');
  popup.classList.add('hidden');
  popup.style.display = 'none';
}

// ============================================================
// STATS PAGE — Full features
// ============================================================

// Phase 2: stats v2 — supports presets (1h/1d/7d/30d) + custom range
let _statsCustomFrom = null;  // ISO string when range='custom'
let _statsCustomTo   = null;
let _statsRangeMaxDays = 365;  // refreshed from /api/settings on first load
let _statsFocusCategoryId = null; // null = all categories in Event Overview

function setStatsRange(range, btn) {
  if (range === 'custom') return;  // handled by openCustomRangeModal
  currentStatsRange = range;
  _statsCustomFrom = null;
  _statsCustomTo   = null;
  document.querySelectorAll('#page-stats .per-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadStats();
}

function getRangeQuery() {
  const now = new Date();
  let from, label;
  if (currentStatsRange === 'custom' && _statsCustomFrom && _statsCustomTo) {
    return {
      from: _statsCustomFrom,
      to:   _statsCustomTo,
      label: `${_statsCustomFrom.slice(0, 16).replace('T', ' ')} → ${_statsCustomTo.slice(0, 16).replace('T', ' ')}`,
    };
  }
  switch (currentStatsRange) {
    case '1h':
      // rolling — last 60 minutes
      from = new Date(now - 3600000);
      label = 'LAST HOUR';
      break;
    case '1d':
      // calendar TODAY — from local midnight of the current day
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      label = 'TODAY';
      break;
    case '7d': {
      // calendar THIS WEEK — from Monday 00:00 of the current week
      from = new Date(now);
      const dow = (from.getDay() + 6) % 7;  // Mon=0..Sun=6
      from.setDate(from.getDate() - dow);
      from.setHours(0, 0, 0, 0);
      label = 'THIS WEEK';
      break;
    }
    case '30d':
      // calendar THIS MONTH — from day 1 of the current month
      from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      label = 'THIS MONTH';
      break;
    default:
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      label = 'TODAY';
  }
  return { from: from.toISOString(), to: now.toISOString(), label };
}

async function _ensureStatsSettings() {
  if (_statsRangeMaxDays !== 365) return;  // already loaded (or default kept)
  try {
    const res = await fetch(`${API}/api/settings`);
    if (res.ok) {
      const s = await res.json();
      const v = parseInt(s?.custom_range_max_days?.value, 10);
      if (Number.isFinite(v) && v > 0) _statsRangeMaxDays = v;
    }
  } catch {}
}

async function loadStats() {
  const { from, to, label } = getRangeQuery();
  const camIds   = getActiveGroupCameraIds();
  const camParam = camIds.length ? `&cameras=${encodeURIComponent(camIds.join(','))}` : '';

  // header labels
  const rangeBadge = document.getElementById('statsRangeLabel');
  if (rangeBadge) rangeBadge.textContent = label;
  document.getElementById('tlBadge').textContent  = label;
  document.getElementById('brkBadge').textContent = label;

  await _ensureStatsSettings();

  // Update per-camera-bar badges
  const peopleBadge  = document.getElementById('peopleCamBadge');
  const vehicleBadge = document.getElementById('vehicleCamBadge');
  const dwellBadge   = document.getElementById('dwellBadge');
  if (peopleBadge)  peopleBadge.textContent  = label;
  if (vehicleBadge) vehicleBadge.textContent = label;
  if (dwellBadge)   dwellBadge.textContent   = label;

  try {
    const [catsRes, tlRes, brkRes, peopleRes, vehicleRes, dwellRes] = await Promise.all([
      fetch(`${API}/api/stats/categories?from=${from}&to=${to}${camParam}`),
      fetch(`${API}/api/stats/timeline-by-category?from=${from}&to=${to}${camParam}`),
      fetch(`${API}/api/stats/breakdown-v2?from=${from}&to=${to}${camParam}`),
      fetch(`${API}/api/stats/per-camera-counts?kind=people&from=${from}&to=${to}${camParam}`),
      fetch(`${API}/api/stats/per-camera-counts?kind=vehicle&from=${from}&to=${to}${camParam}`),
      fetch(`${API}/api/stats/dwell?from=${from}&to=${to}`),
    ]);
    if (!catsRes.ok || !tlRes.ok || !brkRes.ok) throw new Error('stats fetch failed');

    const catsBody  = await catsRes.json();
    const tlBody    = await tlRes.json();
    const breakdown = await brkRes.json();
    const peopleBody  = peopleRes.ok  ? await peopleRes.json()  : { per_camera: [] };
    const vehicleBody = vehicleRes.ok ? await vehicleRes.json() : { per_camera: [] };

    // dwell endpoint รับ camera_id เดี่ยว — group filter เป็นหลายตัว จึงกรองฝั่ง client
    let dwellRows = dwellRes.ok ? await dwellRes.json() : [];
    if (camIds.length) dwellRows = dwellRows.filter(r => camIds.includes(r.camera_id));

    renderCategoryKPI(catsBody.categories || []);
    renderTimelineByCategory(tlBody, from, to);
    renderBreakdown(breakdown);
    renderDwell(dwellRows);
    renderCategoryPie(catsBody.categories || []);
    renderPerCameraBar('people',  peopleBody.per_camera  || []);
    renderPerCameraBar('vehicle', vehicleBody.per_camera || []);

    // cache for CSV export
    _lastStats.kpi       = catsBody.categories || [];
    _lastStats.timeline  = tlBody;
    _lastStats.breakdown = breakdown;
    _lastStats.people    = peopleBody.per_camera  || [];
    _lastStats.vehicle   = vehicleBody.per_camera || [];

    // Phase 4 — heatmap + insights run after main panels load
    _statsLastFrom = from;
    _statsLastTo   = to;
    _statsLastCams = camParam;
    populateHeatmapCategoryFilter(catsBody.categories || []);
    loadHeatmap();
    loadInsights();

    // People in Area — live occupancy (independent of the date-range)
    loadOccupancy();

    // Density Over Time — historical occupancy line chart (range-bound)
    loadOccupancyTimeline();

    // Density Heatmap — dow × hour pattern (range-bound)
    loadOccupancyHeatmap();
  } catch (e) {
    console.error('loadStats error:', e);
  }
}

// ============================================================
// People in Area — live occupancy (Bosch CountAggregation/Counter)
// ============================================================
// Server keeps in-memory state via /api/stats/occupancy and pushes
// occupancy_update WS messages on change. We snapshot on Stats page
// load to seed the grid, then track increments live.
const _occupancy = {};   // "cam::rule" -> { camera_id, rule_name, current, raw, last_update }

async function loadOccupancy() {
  try {
    const r = await fetch(`${API}/api/stats/occupancy`);
    if (!r.ok) throw new Error('occupancy fetch failed');
    const body = await r.json();
    (body.cameras || []).forEach(c => {
      _occupancy[`${c.camera_id}::${c.rule_name}`] = c;
    });
    renderOccupancy();
  } catch (e) {
    console.warn('loadOccupancy error:', e);
  }
}

function renderOccupancy() {
  const grid = document.getElementById('occupancyGrid');
  if (!grid) return;
  const items = Object.values(_occupancy)
    .sort((a, b) => (a.camera_id + a.rule_name).localeCompare(b.camera_id + b.rule_name));

  if (items.length === 0) {
    grid.innerHTML = `<div style="color:var(--dim);font-size:13px;padding:14px">
      ${escapeHtml(I18N.t('stats.waitingCount'))}
      <div style="margin-top:6px;font-size:11px">${I18N.t('stats.waitingCountHint')}</div>
    </div>`;
    return;
  }

  grid.innerHTML = items.map(c => {
    const count = (c.current ?? 0);
    const color = count >= 5 ? token('--status-bad') : count >= 2 ? token('--warn') : token('--status-ok');
    const ageSec = c.last_update
      ? Math.floor((Date.now() - new Date(c.last_update).getTime()) / 1000)
      : null;
    const ageLabel = ageSec == null
      ? '—'
      : ageSec < 5 ? I18N.t('stats.nowLabel')
      : ageSec < 60 ? I18N.t('stats.secsAgo').replace('{n}', ageSec)
      : I18N.t('stats.minsAgo').replace('{n}', Math.floor(ageSec / 60));
    return `
      <div class="kpi" style="border-left:3px solid ${color}">
        <div class="kpi-l">${c.camera_id}</div>
        <div class="kpi-v" style="color:${color}">${count}</div>
        <div class="kpi-s" style="font-size:11px">
          ${c.rule_name || '—'}<br>
          <span style="color:var(--dim)">raw=${c.raw ?? '—'} · ${ageLabel}</span>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// Density Over Time — historical occupancy (Phase 1 of crowd-density viz)
// ============================================================
// Fetches /api/stats/occupancy/timeline for the active Stats date range.
// Bucket size is auto-picked server-side (1m / 5m / 1h / 1d) so we plot a
// reasonable number of points regardless of the window length.
let _occTlChart = null;

// Density dropdown population — used by both Density Over Time and
// Density Heatmap. Source is /api/stats/occupancy/sources (DB-scoped to
// the active range); the live in-memory _occupancy tracker is layered on
// top so a counter that just started today (no history in range yet) is
// still selectable. The old code only looked at the live tracker, which
// was empty after every api-server restart and made the dropdown appear
// to have "no cameras to choose" even when DB had thousands of samples.
async function _loadDensitySources(from, to) {
  let dbSources = [];
  try {
    const r = await fetch(`${API}/api/stats/occupancy/sources?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (r.ok) dbSources = (await r.json()).sources || [];
  } catch (e) {
    console.warn('_loadDensitySources error:', e);
  }
  const seen = new Set();
  const merged = [];
  for (const s of dbSources) {
    const key = `${s.camera_id}|${s.rule_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ key, label: `${s.camera_id} · ${s.rule_name}` });
  }
  for (const c of Object.values(_occupancy)) {
    const key = `${c.camera_id}|${c.rule_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ key, label: `${c.camera_id} · ${c.rule_name} (live)` });
  }
  merged.sort((a, b) => a.label.localeCompare(b.label));
  return merged;
}

function _populateDensityDropdown(selectId, sources) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('stats.allCamRule'))}</option>` +
    sources.map(w => `<option value="${escapeHtml(w.key)}">${escapeHtml(w.label)}</option>`).join('');
  if (sources.some(w => w.key === current)) sel.value = current;
}

async function loadOccupancyTimeline() {
  const { from, to, label } = getRangeQuery();
  const badge = document.getElementById('occTlBadge');
  if (badge) badge.textContent = label;

  const sources = await _loadDensitySources(from, to);
  _populateDensityDropdown('occTlCamRule', sources);
  const sel = document.getElementById('occTlCamRule');

  const [camId, ruleName] = (sel?.value || '').split('|');
  const qp = new URLSearchParams({ from, to });
  if (camId)    qp.set('camera_id', camId);
  if (ruleName) qp.set('rule_name', ruleName);

  try {
    const r = await fetch(`${API}/api/stats/occupancy/timeline?${qp}`);
    if (!r.ok) throw new Error('occupancy timeline fetch failed');
    const body = await r.json();
    renderOccupancyTimeline(body);
  } catch (e) {
    console.warn('loadOccupancyTimeline error:', e);
  }
}

function renderOccupancyTimeline(body) {
  const canvas = document.getElementById('occTlChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels = (body.buckets || []).map(b => b.ts);
  const avg    = (body.buckets || []).map(b => b.avg);
  const max    = (body.buckets || []).map(b => b.max);

  if (_occTlChart) _occTlChart.destroy();

  const sub = document.getElementById('occTlSub');
  if (sub) {
    const bucketLabel = body.bucket_sec < 60
      ? `${body.bucket_sec}s`
      : body.bucket_sec < 3600 ? `${body.bucket_sec / 60}m`
      : body.bucket_sec < 86400 ? `${body.bucket_sec / 3600}h`
      : `${body.bucket_sec / 86400}d`;
    sub.textContent = I18N.t('stats.densitySubDynamic')
      .replace('{b}', bucketLabel).replace('{n}', labels.length);
  }

  if (labels.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = token('--text-secondary');
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(I18N.t('stats.noCountData'), canvas.width / 2, canvas.height / 2);
    return;
  }

  _occTlChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: I18N.t('stats.peakOcc'),
          data: max,
          borderColor: token('--warn'),
          backgroundColor: token('--warn') + '1f',
          borderWidth: 1,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
        {
          label: I18N.t('stats.avgOcc'),
          data: avg,
          borderColor: token('--accent'),
          backgroundColor: token('--accent') + '14',
          borderWidth: 2,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].label).toLocaleString(),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: token('--text-secondary'),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            callback: function (val) {
              const d = new Date(this.getLabelForValue(val));
              return body.bucket_sec >= 86400
                ? d.toLocaleDateString()
                : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            },
          },
          grid: { color: 'rgba(148,163,184,0.08)' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0 },
          grid: { color: 'rgba(148,163,184,0.08)' },
        },
      },
    },
  });
}

// ============================================================
// Density Heatmap — Phase 2 of crowd-density viz
// ============================================================
// 7×24 grid (Mon..Sun × 00..23) showing average occupancy per cell.
// Source rows are the same CountAggregation/Counter events the Density
// Over Time chart uses; only the GROUP BY differs (dow × hour vs time).
// Visual style mirrors the existing Activity Heatmap so the page stays
// consistent — amber palette to distinguish "density" from "activity".

async function loadOccupancyHeatmap() {
  const { from, to, label } = getRangeQuery();
  const badge = document.getElementById('occHmBadge');
  if (badge) badge.textContent = label;

  const sources = await _loadDensitySources(from, to);
  _populateDensityDropdown('occHmCamRule', sources);
  const sel = document.getElementById('occHmCamRule');

  const [camId, ruleName] = (sel?.value || '').split('|');
  const qp = new URLSearchParams({ from, to });
  if (camId)    qp.set('camera_id', camId);
  if (ruleName) qp.set('rule_name', ruleName);

  try {
    const r = await fetch(`${API}/api/stats/occupancy/heatmap?${qp}`);
    if (!r.ok) throw new Error('occupancy heatmap fetch failed');
    const body = await r.json();
    renderOccupancyHeatmap(body.cells || []);
  } catch (e) {
    console.warn('loadOccupancyHeatmap error:', e);
    const grid = document.getElementById('occHmGrid');
    if (grid) grid.innerHTML =
      `<tr><td style="padding:20px;text-align:center;color:#ef4444">${escapeHtml(I18N.t('stats.densityHeatmapErr'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderOccupancyHeatmap(cells) {
  const grid = document.getElementById('occHmGrid');
  if (!grid) return;

  // Sparse cells → dense 7×24 matrix. Each cell carries avg + max + samples.
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(null));
  let maxAvg = 0, totalSamples = 0, peak = 0;
  cells.forEach(c => {
    const d = Math.max(0, Math.min(6, c.dow));
    const h = Math.max(0, Math.min(23, c.hour));
    matrix[d][h] = c;
    if (c.avg > maxAvg) maxAvg = c.avg;
    if (c.max > peak)   peak   = c.max;
    totalSamples += c.samples || 0;
  });

  const dayLabel  = I18N.t('stats.dowShort').split(',');
  const hourLabel = h => h.toString().padStart(2, '0');

  let html = '<thead><tr>';
  html += '<th style="text-align:right;padding:3px 8px;color:var(--dim);font-weight:normal"></th>';
  for (let h = 0; h < 24; h++) {
    html += `<th style="text-align:center;padding:3px 0;color:var(--dim);font-weight:normal">${hourLabel(h)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let d = 0; d < 7; d++) {
    html += `<tr><th style="text-align:right;padding:3px 8px;color:var(--dim);font-weight:normal">${dayLabel[d]}</th>`;
    for (let h = 0; h < 24; h++) {
      const cell = matrix[d][h];
      const v = cell?.avg ?? 0;
      const ratio = maxAvg > 0 ? v / maxAvg : 0;
      let bg;
      if (!cell)            bg = 'rgba(245,158,11,0.05)';
      else if (ratio < 0.2) bg = 'rgba(245,158,11,0.25)';
      else if (ratio < 0.5) bg = 'rgba(245,158,11,0.55)';
      else if (ratio < 0.8) bg = 'rgba(245,158,11,0.85)';
      else                  bg = 'rgba(245,158,11,1)';
      const fg = ratio > 0.5 ? '#fff' : 'var(--text)';
      const display = cell
        ? (v >= 10 ? Math.round(v).toString()
                   : v >= 1 ? v.toFixed(1)
                            : v > 0 ? v.toFixed(2).replace(/^0/, '')
                                    : '')
        : '';
      const title = cell
        ? `${dayLabel[d]} ${hourLabel(h)}:00 — avg ${v.toFixed(2)} · peak ${cell.max} · ${cell.samples} samples`
        : `${dayLabel[d]} ${hourLabel(h)}:00 — no data`;
      html += `<td title="${escapeHtml(title)}" style="text-align:center;padding:0;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.04);height:24px;min-width:24px">${display}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  grid.innerHTML = html;

  const totalEl = document.getElementById('occHmTotal');
  if (totalEl) {
    totalEl.textContent = cells.length === 0
      ? I18N.t('stats.noCountData')
      : I18N.t('stats.hmSamplesDyn')
          .replace('{n}', totalSamples.toLocaleString())
          .replace('{peak}', peak)
          .replace('{max}', maxAvg.toFixed(2));
  }
}

// Phase 3: vertical bar chart of counts grouped by camera_id.
// kind = 'people' | 'vehicle'
function renderPerCameraBar(kind, rows) {
  const canvasId = kind === 'people' ? 'peopleCamChart' : 'vehicleCamChart';
  const color    = kind === 'people' ? token('--status-ok') : token('--accent');
  const ctx      = document.getElementById(canvasId);
  if (!ctx) return;

  if (_camChartReg[kind]) { _camChartReg[kind].destroy(); _camChartReg[kind] = null; }

  // Cleanup any prior "no data" message
  const parent = ctx.parentElement;
  parent.style.position = 'relative';
  const oldMsg = parent.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  if (!rows.length) {
    const msg = document.createElement('div');
    msg.className = 'no-data-msg';
    msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--dim);font-size:12px;text-align:center;line-height:1.6';
    msg.innerHTML = `${escapeHtml(I18N.t('stats.noDataYet'))}<br><span style="font-size:10px">${escapeHtml(I18N.t('stats.addMappingRule'))} "${kind === 'people' ? 'People' : 'Vehicle'} Counting"</span>`;
    parent.appendChild(msg);
    return;
  }

  // Cap to top-N bars — past ~20 the labels squash together and the chart
  // stops being readable. /api/stats/per-camera-counts already orders by
  // count DESC so slicing keeps the busiest cameras. A small "+N more"
  // hint replaces the dropped tail so the operator knows there's more data.
  const TOP_N = 20;
  const truncated = rows.length > TOP_N;
  const visible = truncated ? rows.slice(0, TOP_N) : rows;
  const labels = visible.map(r => r.camera_id);
  const values = visible.map(r => r.count);
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'no-data-msg';
    note.style.cssText = 'position:absolute;top:6px;right:8px;color:var(--dim);font-size:10px;background:rgba(0,0,0,0.4);padding:2px 8px;border-radius:10px;pointer-events:none';
    note.textContent = I18N.t('stats.topNote').replace('{n}', TOP_N).replace('{total}', rows.length);
    parent.appendChild(note);
  }

  _camChartReg[kind] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: kind === 'people' ? 'People' : 'Vehicles',
        data: values,
        backgroundColor: color + 'cc',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const i = elements[0].index;
        const cam = labels[i];
        const cls = kind === 'people' ? 'Person' : null;  // vehicle has many classes
        const label = `${kind === 'people' ? '🚶 People' : '🚗 Vehicle'} count · 📷 ${cam}`;
        drillTo({ camera: cam, cls, label });
      },
      onHover: (_evt, els, chart) => {
        chart.canvas.style.cursor = els.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltip(),
          borderColor: color + '55',
          callbacks: { label: c => `${c.parsed.y.toLocaleString()} ${kind === 'people' ? 'persons' : 'vehicles'} · click to drill down` },
        },
      },
      scales: {
        x: {
          ticks: { color: token('--text-secondary'), font: { family: 'monospace', size: 10 }, maxRotation: 35, minRotation: 0 },
          grid:  { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0, font: { family: 'monospace', size: 10 } },
          grid:  { color: 'rgba(91,141,239,0.05)' },
        },
      },
    },
  });
}

// ============================================================
// Phase 4 — Heatmap, Quiet Cameras, Top Rules
// ============================================================

let _statsLastFrom = null;
let _statsLastTo   = null;
let _statsLastCams = '';
const _lastStats = {
  kpi: [], timeline: null, breakdown: [],
  people: [], vehicle: [], heatmap: [],
  topRules: [], quietCameras: [],
};

// ============================================================
// Phase 4 — CSV Export (pure client-side, uses cached data)
// ============================================================
function _csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function _downloadCsv(filename, rows) {
  if (!rows || !rows.length) { alert(I18N.t('stats.noExportData')); return; }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => _csvEscape(r[h])).join(',')),
  ];
  // BOM so Excel reads UTF-8 (Thai text) correctly
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCsv(kind) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  switch (kind) {
    case 'kpi':
      _downloadCsv(`kpi_${stamp}.csv`, _lastStats.kpi.map(c => ({
        category:    c.name,
        kind:        c.kind,
        count:       c.count,
        prev_count:  c.prev_count,
        change_pct:  c.change_pct,
      })));
      break;
    case 'timeline': {
      const rows = [];
      const series = (_lastStats.timeline?.series || [])
        .filter(s => _statsFocusCategoryId == null || s.category?.id === _statsFocusCategoryId);
      series.forEach(s => {
        s.points.forEach(p => rows.push({
          bucket:   p.bucket,
          category: s.category.name,
          count:    p.count,
        }));
      });
      _downloadCsv(`timeline_${stamp}.csv`, rows);
      break;
    }
    case 'breakdown':
      _downloadCsv(`breakdown_${stamp}.csv`, _lastStats.breakdown.map(b => ({
        name:       b.name,
        event_type: b.event_type,
        camera_id:  b.camera_id,
        count:      b.count,
      })));
      break;
    case 'people':
      _downloadCsv(`people_by_camera_${stamp}.csv`, _lastStats.people);
      break;
    case 'vehicle':
      _downloadCsv(`vehicle_by_camera_${stamp}.csv`, _lastStats.vehicle);
      break;
    case 'heatmap': {
      const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const rows = _lastStats.heatmap.map(c => ({
        day:   days[c.dow] || c.dow,
        hour:  c.hour,
        count: c.count,
      }));
      _downloadCsv(`heatmap_${stamp}.csv`, rows);
      break;
    }
    case 'topRules':
      _downloadCsv(`top_rules_${stamp}.csv`, _lastStats.topRules);
      break;
    case 'quietCameras':
      _downloadCsv(`quiet_cameras_${stamp}.csv`, _lastStats.quietCameras);
      break;
  }
}

async function loadHeatmap() {
  if (!_statsLastFrom || !_statsLastTo) return;
  const catSel = document.getElementById('heatmapCatFilter');
  const catId  = catSel?.value || '';
  const url    = `${API}/api/stats/heatmap?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${catId ? `&category_id=${encodeURIComponent(catId)}` : ''}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    _lastStats.heatmap = body.cells || [];
    renderHeatmap(body.cells || []);
  } catch (e) {
    console.error('loadHeatmap:', e);
    document.getElementById('heatmapGrid').innerHTML =
      `<tr><td style="padding:20px;text-align:center;color:#ef4444">${escapeHtml(I18N.t('stats.heatmapErr'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function drillHeatmapCell(dow, hour, count) {
  const catSel = document.getElementById('heatmapCatFilter');
  const catId = catSel?.value || '';
  const catLabel = catId
    ? (catSel?.selectedOptions?.[0]?.textContent || '').trim()
    : '';
  const dayLabel = I18N.t('stats.dowShort').split(',');
  const hourLabel = h => h.toString().padStart(2, '0');
  const labelParts = [
    `${dayLabel[dow] || dow} ${hourLabel(hour)}:00`,
    count != null ? `${Number(count).toLocaleString()} events` : '',
    catLabel,
  ].filter(Boolean);
  drillTo({
    dow,
    hour,
    category_id: catId || null,
    label: labelParts.join(' · '),
  });
}

function renderHeatmap(cells) {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  // Build dense 7×24 matrix (dow 0=Mon..6=Sun)
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0, max = 0;
  cells.forEach(c => {
    const d = Math.max(0, Math.min(6, c.dow));
    const h = Math.max(0, Math.min(23, c.hour));
    matrix[d][h] = c.count;
    total += c.count;
    if (c.count > max) max = c.count;
  });

  const dayLabel = I18N.t('stats.dowShort').split(',');
  const hourLabel = h => h.toString().padStart(2, '0');

  // Build header row + 7 day rows
  let html = '<thead><tr>';
  html += '<th style="text-align:right;padding:3px 8px;color:var(--dim);font-weight:normal"></th>';
  for (let h = 0; h < 24; h++) {
    html += `<th style="text-align:center;padding:3px 0;color:var(--dim);font-weight:normal">${hourLabel(h)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let d = 0; d < 7; d++) {
    html += `<tr><th style="text-align:right;padding:3px 8px;color:var(--dim);font-weight:normal">${dayLabel[d]}</th>`;
    for (let h = 0; h < 24; h++) {
      const v = matrix[d][h];
      const ratio = max > 0 ? v / max : 0;
      // Five-level palette to match the legend swatches
      let bg;
      if (v === 0)         bg = 'rgba(91,141,239,0.05)';
      else if (ratio < 0.2) bg = 'rgba(91,141,239,0.25)';
      else if (ratio < 0.5) bg = 'rgba(91,141,239,0.55)';
      else if (ratio < 0.8) bg = 'rgba(91,141,239,0.85)';
      else                  bg = 'rgba(91,141,239,1)';
      const fg = ratio > 0.5 ? '#fff' : 'var(--text)';
      const cell = v > 0
        ? `<td data-action="drillHeatmapCell" data-d="${d}" data-h="${h}" data-v="${v}" title="${escapeHtml(dayLabel[d])} ${hourLabel(h)}:00 — ${v} events · click to drill down" style="cursor:pointer;text-align:center;padding:0;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.04);height:24px;min-width:24px">${v}</td>`
        : `<td title="${escapeHtml(dayLabel[d])} ${hourLabel(h)}:00 — 0 events" style="text-align:center;padding:0;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.04);height:24px;min-width:24px"></td>`;
      html += cell;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  grid.innerHTML = html;

  document.getElementById('heatmapTotal').textContent = I18N.t('stats.hmTotalDyn')
    .replace('{n}', total.toLocaleString()).replace('{peak}', max);
}

function populateHeatmapCategoryFilter(cats) {
  const sel = document.getElementById('heatmapCatFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All categories</option>'
    + (cats || []).map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  // restore selection if still valid
  if (current && (cats || []).some(c => String(c.id) === current)) sel.value = current;
}

async function loadInsights() {
  if (!_statsLastFrom || !_statsLastTo) return;
  try {
    const [quietRes, topRes] = await Promise.all([
      fetch(`${API}/api/stats/quiet-cameras?since_hours=24`),
      fetch(`${API}/api/stats/top-rules?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}&limit=10`),
    ]);
    if (quietRes.ok) {
      const cams = (await quietRes.json()).cameras || [];
      _lastStats.quietCameras = cams;
      renderQuietCameras(cams);
    }
    if (topRes.ok) {
      const top = (await topRes.json()).top || [];
      _lastStats.topRules = top;
      renderTopRules(top);
    }
  } catch (e) { console.error('loadInsights:', e); }
}

function renderQuietCameras(cams) {
  const el = document.getElementById('quietCamsList');
  if (!el) return;
  if (!cams.length) {
    el.innerHTML = `<div style="padding:18px;text-align:center;color:var(--dim);font-size:11px">${escapeHtml(I18N.t('stats.allCamsActive'))}</div>`;
    return;
  }
  el.innerHTML = cams.map(c => {
    const ago = c.last_seen_ago_sec;
    const agoTxt = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago/60)}m` : `${Math.round(ago/3600)}h`;
    return `<div data-action="drillToCamera" data-camera="${escapeHtml(c.camera_id)}" data-label="${escapeHtml('🔇 ' + (c.camera_name || c.camera_id))}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--border)" title="Click to inspect this camera's events">
      <div>
        <div style="font-weight:600">${escapeHtml(c.camera_name || c.camera_id)}</div>
        <div style="font-size:10px;color:var(--dim)">${escapeHtml(c.camera_id)} · last_seen ${agoTxt} ago</div>
      </div>
      <span style="background:${token('--warn')}30;color:${token('--warn')};padding:3px 8px;border-radius:4px;font-size:10px">0 events</span>
    </div>`;
  }).join('');
}

function renderTopRules(rules) {
  const el = document.getElementById('topRulesList');
  if (!el) return;
  if (!rules.length) {
    el.innerHTML = '<div style="padding:18px;text-align:center;color:var(--dim);font-size:11px">No rule firings in this window</div>';
    return;
  }
  const max = rules[0]?.count || 1;
  el.innerHTML = rules.map((r, i) => {
    const pct  = (r.count / max * 100).toFixed(0);
    return `<div data-action="drillToRule" data-rule-name="${escapeHtml(r.rule_name)}" data-label="${escapeHtml('🏆 Rule: ' + r.rule_name)}" style="cursor:pointer;display:grid;grid-template-columns:24px 1fr 60px 80px;gap:8px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--border);font-size:11px" title="Click to drill down">
      <div style="color:var(--dim);text-align:right">${i + 1}.</div>
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.rule_name)}">${escapeHtml(r.rule_name)}</div>
      <div style="font-size:10px;color:var(--dim)">📷 ${r.cameras_seen}</div>
      <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
        <div style="flex:1;height:5px;background:var(--panel2);border-radius:3px;overflow:hidden">
          <div style="height:100%;background:${token('--accent')};width:${pct}%"></div>
        </div>
        <span style="font-weight:600;color:var(--accent);min-width:30px;text-align:right">${r.count}</span>
      </div>
    </div>`;
  }).join('');
}

// Translate (cur, prev, change_pct) into a human-friendly comparison line.
// Rules tuned for "non-statistician glance":
//   prev=0,cur>0  → "NEW"            (just started showing up)
//   prev=0,cur=0  → "no data"
//   prev>0,cur=0  → "STOPPED"
//   prev small    → show absolute "+N events" (% would be misleading)
//   normal        → "X%"             (capped at >999%)
function formatComparison(cur, prev, changePct) {
  const dim = 'color:var(--dim)';
  const up  = `color:${token('--status-ok')}`;
  const dn  = `color:${token('--status-bad')}`;

  if (prev === 0 && cur === 0) return `<span style="font-size:10px;${dim}">— no data</span>`;
  if (prev === 0 && cur  >  0) return `<span style="font-size:10px;${up}">↑ NEW</span>`;
  if (prev  >  0 && cur === 0) return `<span style="font-size:10px;${dn}">▼ STOPPED</span>`;

  const diff = cur - prev;
  // baseline too small → % is unstable, show count change instead
  if (prev < 5) {
    const sign = diff > 0 ? '▲ +' : '▼ ';
    const col  = diff > 0 ? up : dn;
    return `<span style="font-size:10px;${col}">${sign}${Math.abs(diff)} events</span>`;
  }

  if (diff === 0) return `<span style="font-size:10px;${dim}">— 0% vs prev</span>`;

  // cap to keep big jumps readable
  let pct = Math.abs(changePct ?? ((diff / prev) * 100));
  let cappedPrefix = '';
  if (pct > 999) { pct = 999; cappedPrefix = '>'; }
  const arrow = diff > 0 ? '▲' : '▼';
  const col   = diff > 0 ? up : dn;
  return `<span style="font-size:10px;${col}">${arrow} ${cappedPrefix}${pct.toFixed(1)}% vs prev</span>`;
}

function renderCategoryKPI(cats) {
  // Always show every category (built-in + user-created). Hiding categories
  // that happen to be 0 in the current window would hide configuration
  // mistakes from the user — they need to see "I created this but it's 0"
  // so they can fix the mapping rule.
  const visible = cats || [];
  if (!visible.length) {
    document.getElementById('statsKpi').innerHTML =
      `<div class="stats-kpi-empty">${escapeHtml(I18N.t('stats.noCategories'))}</div>`;
    _statsFocusCategoryId = null;
    return;
  }

  if (_statsFocusCategoryId != null && !visible.some(c => c.id === _statsFocusCategoryId)) {
    _statsFocusCategoryId = null;
  }

  const allChip = `
    <button type="button" class="stats-kpi-chip stats-kpi-all ${_statsFocusCategoryId == null ? 'active' : ''}"
            data-action="setFocusCat" data-cat-id=""
            title="${escapeHtml(I18N.t('stats.focusAllSub'))}">
      <span class="stats-kpi-icon"><svg aria-hidden="true" width="13" height="13"><use href="#icon-stats"/></svg></span>
      <span class="stats-kpi-name">${escapeHtml(I18N.t('stats.focusAll'))}</span>
      <span class="stats-kpi-value">${escapeHtml(I18N.t('stats.focusAll'))}</span>
      <span class="stats-kpi-delta">${escapeHtml(I18N.t('stats.focusAllSub'))}</span>
    </button>`;

  const categoryChips = visible.map(c => {
    const cur  = c.count || 0;
    const prev = c.prev_count || 0;
    const cmp  = formatComparison(cur, prev, c.change_pct);
    const color = c.color || token('--accent');
    const active = _statsFocusCategoryId === c.id ? 'active' : '';
    const focusTitle = I18N.t('stats.focusSub').replace('{name}', c.name);
    return `
      <button type="button" class="stats-kpi-chip ${active}" style="--ka:${color}"
              data-action="setFocusCat" data-cat-id="${c.id}"
              title="${escapeHtml(focusTitle)}">
        <span class="stats-kpi-icon">${escapeHtml(c.icon || '🚨')}</span>
        <span class="stats-kpi-name">${escapeHtml(c.name)}</span>
        <span class="stats-kpi-value">${cur.toLocaleString()}</span>
        <span class="stats-kpi-delta">${cmp}</span>
      </button>
    `;
  }).join('');

  document.getElementById('statsKpi').innerHTML = allChip + categoryChips;
}

function setStatsFocusCategory(categoryId) {
  _statsFocusCategoryId = categoryId == null ? null : Number(categoryId);
  renderCategoryKPI(_lastStats.kpi || []);
  if (_lastStats.timeline && _statsLastFrom && _statsLastTo) {
    renderTimelineByCategory(_lastStats.timeline, _statsLastFrom, _statsLastTo);
  }
}

// ── Custom Range modal handlers ─────────────────────────────
function openCustomRangeModal() {
  const now = new Date();
  const yest = new Date(now.getTime() - 24 * 3600e3);
  setDtValue('crFrom', yest);
  setDtValue('crTo',   now);
  document.getElementById('crErr').style.display = 'none';
  _ensureStatsSettings().then(() => {
    document.getElementById('crCapNote').textContent =
      I18N.t('cr.capNote').replace('{n}', _statsRangeMaxDays);
  });
  document.getElementById('customRangeModal').classList.remove('hidden');
}
function closeCustomRangeModal() {
  document.getElementById('customRangeModal').classList.add('hidden');
}
function crQuick(kind) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from, to;
  if (kind === 'today')        { from = today;                                   to = new Date(); }
  else if (kind === 'yesterday') {
    from = new Date(today.getTime() - 86400e3);
    to   = new Date(today.getTime() - 1);
  }
  else if (kind === 'thisweek')  {
    const dow = (today.getDay() + 6) % 7;  // Mon=0
    from = new Date(today.getTime() - dow * 86400e3);
    to   = new Date();
  }
  else if (kind === 'lastweek')  {
    const dow = (today.getDay() + 6) % 7;
    const monThis = new Date(today.getTime() - dow * 86400e3);
    from = new Date(monThis.getTime() - 7 * 86400e3);
    to   = new Date(monThis.getTime() - 1);
  }
  else if (kind === 'thismonth') {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to   = new Date();
  }
  setDtValue('crFrom', from);
  setDtValue('crTo',   to);
}
function applyCustomRange() {
  const fromStr = getDtValue('crFrom');
  const toStr   = getDtValue('crTo');
  const err     = document.getElementById('crErr');
  if (!fromStr || !toStr) { err.textContent = I18N.t('cr.errBothRequired'); err.style.display = 'block'; return; }
  const from = new Date(fromStr), to = new Date(toStr);
  if (!(from < to)) { err.textContent = I18N.t('cr.errOrder'); err.style.display = 'block'; return; }
  const spanDays = (to - from) / 86400e3;
  if (spanDays > _statsRangeMaxDays) {
    err.textContent = I18N.t('cr.errTooLong').replace('{n}', _statsRangeMaxDays);
    err.style.display = 'block';
    return;
  }
  _statsCustomFrom = from.toISOString();
  _statsCustomTo   = to.toISOString();
  currentStatsRange = 'custom';
  document.querySelectorAll('#page-stats .per-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === 'custom');
  });
  closeCustomRangeModal();
  loadStats();
}

// Phase 2 — accepts {from, to, trunc, buckets}  (legacy, single total + alerts)
function renderTimelineChartV2(body, fromIso, toIso) {
  const data = body?.buckets || [];
  const trunc = body?.trunc || 'hour';
  const granularity = trunc === 'hour' ? 'hour' : trunc === 'week' ? 'day' : 'day';
  return renderTimelineChart(data, granularity, fromIso, toIso);
}

// One coloured line per category (uses each category's own color/icon).
// body shape: { from, to, trunc, tz, series: [{ category, points: [{bucket, count}] }] }
function renderTimelineByCategory(body, fromIso, toIso) {
  const ctx = document.getElementById('tlChart');
  if (!ctx) return;

  const trunc       = body?.trunc || 'hour';
  const granularity = trunc === 'hour' ? 'hour' : 'day';
  const allSeries   = (body?.series || []).filter(s => s.category);
  const focusSeries = _statsFocusCategoryId == null
    ? allSeries
    : allSeries.filter(s => s.category?.id === _statsFocusCategoryId);
  const series      = focusSeries;

  const sub = document.getElementById('tlSub');
  if (sub) {
    const focused = _statsFocusCategoryId == null ? null : allSeries.find(s => s.category?.id === _statsFocusCategoryId);
    sub.textContent = focused
      ? I18N.t('stats.focusSub').replace('{name}', `${focused.category.icon || ''} ${focused.category.name}`.trim())
      : I18N.t('stats.focusAllSub');
  }

  // Build a unified bucket axis from fromIso/toIso (so empty buckets render as 0)
  const fromDate = new Date(fromIso);
  const toDate   = new Date(toIso);
  const allBuckets = [];
  if (granularity === 'hour') {
    const start = new Date(fromDate); start.setMinutes(0, 0, 0);
    while (start < toDate) { allBuckets.push(start.toISOString()); start.setHours(start.getHours() + 1); }
  } else {
    const start = new Date(fromDate); start.setHours(0, 0, 0, 0);
    while (start < toDate) { allBuckets.push(start.toISOString()); start.setDate(start.getDate() + 1); }
  }

  const hasAny = series.some(s => s.points && s.points.length > 0);

  if (tlChart) { tlChart.destroy(); tlChart = null; }

  const parent = ctx.parentElement;
  parent.style.position = 'relative';
  const oldMsg = parent.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  if (!hasAny) {
    const msg = document.createElement('div');
    msg.className = 'no-data-msg';
    msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--dim);font-size:13px;text-align:center';
    msg.innerHTML = `${I18N.t('stats.noDataRange')}<br><span style="font-size:11px">${I18N.t('stats.tryChangeRange')}</span>`;
    parent.appendChild(msg);
    const lgd = document.getElementById('tlLegend');
    if (lgd) lgd.innerHTML = '';
    return;
  }

  const palette = [
    token('--accent'),     token('--status-ok'), token('--warn'),
    token('--status-bad'), '#a855f7',            '#06b6d4',
    '#ec4899',             '#84cc16',            '#f97316', '#14b8a6',
  ];
  const datasets = series.map((s, i) => {
    const c = s.category;
    const color = c.color || palette[i % palette.length];
    const data  = allBuckets.map(b => {
      const point = s.points.find(p => new Date(p.bucket).getTime() === new Date(b).getTime());
      return { x: b, y: point ? point.count : 0 };
    });
    return {
      label:           `${c.icon || '🚨'} ${c.name}`,
      data,
      borderColor:     color,
      backgroundColor: color + '22',
      tension:         0.3,
      fill:            false,
      pointRadius:     2,
      pointHoverRadius: 5,
      pointBackgroundColor: color,
      borderWidth:     2,
    };
  });

  tlChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { unit: granularity, displayFormats: { hour: 'HH:mm', day: 'MMM d' } },
          ticks: { color: token('--text-secondary'), maxRotation: 0, font: { family: 'monospace', size: 10 } },
          grid:  { color: token('--accent') + '0d' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0, font: { family: 'monospace', size: 10 } },
          grid:  { color: token('--accent') + '0d' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...chartTooltip() },
      },
    },
  });

  // Render the legend strip below the chart with per-category colour swatches
  const lgd = document.getElementById('tlLegend');
  if (lgd) {
    lgd.innerHTML = series.map((s, i) => {
      const c = s.category;
      const color = c.color || palette[i % palette.length];
      return `<div class="lgdi"><div class="lgdd" style="background:${escapeHtml(color)}"></div>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</div>`;
    }).join('');
  }
}

// Pie of category counts. Counter-kind categories (People/Vehicle Counting)
// are excluded — they are shown in their own bar charts below and would
// otherwise double-count alongside event-kind categories under all-match.
function renderCategoryPie(cats) {
  const data = (cats || [])
    .filter(c => c.kind === 'event' && (c.count || 0) > 0)
    .map(c => ({ name: c.name, count: c.count, color: c.color || null }));
  return renderPie3D(data);
}

function renderTimelineChart(data, granularity, fromIso, toIso) {
  const ctx = document.getElementById('tlChart');
  if (!ctx) return;

  // Build all buckets
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  const allBuckets = [];
  if (granularity === 'hour') {
    const start = new Date(fromDate);
    start.setMinutes(0, 0, 0);
    while (start < toDate) {
      allBuckets.push(new Date(start).toISOString());
      start.setHours(start.getHours() + 1);
    }
  } else {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    while (start < toDate) {
      allBuckets.push(new Date(start).toISOString());
      start.setDate(start.getDate() + 1);
    }
  }

  const totalData = allBuckets.map(b => {
    const point = data.find(d => new Date(d.bucket).getTime() === new Date(b).getTime());
    return { x: b, y: point ? point.total : 0 };
  });
  const alertsData = allBuckets.map(b => {
    const point = data.find(d => new Date(d.bucket).getTime() === new Date(b).getTime());
    return { x: b, y: point ? point.alerts : 0 };
  });

  const hasAny = data.length > 0;

  if (tlChart) tlChart.destroy();

  // Show "no data" when empty
  if (!hasAny) {
    const parent = ctx.parentElement;
    parent.style.position = 'relative';
    let msg = parent.querySelector('.no-data-msg');
    if (!msg) {
      msg = document.createElement('div');
      msg.className = 'no-data-msg';
      msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--dim);font-size:13px;text-align:center';
      parent.appendChild(msg);
    }
    msg.innerHTML = `${I18N.t('stats.noDataRange')}<br><span style="font-size:11px">${I18N.t('stats.tryChangeRange')}</span>`;
    return;
  } else {
    const oldMsg = ctx.parentElement.querySelector('.no-data-msg');
    if (oldMsg) oldMsg.remove();
  }

  tlChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Total Events',
          data: totalData,
          borderColor: token('--accent'),
          backgroundColor: token('--accent') + '26',
          tension: 0.4, fill: true,
          pointRadius: 4, pointHoverRadius: 7,
          pointBackgroundColor: token('--accent'),
          borderWidth: 2,
        },
        {
          label: 'Alerts',
          data: alertsData,
          borderColor: token('--status-ok'),
          backgroundColor: token('--status-ok') + '1a',
          tension: 0.4, fill: true,
          pointRadius: 4, pointHoverRadius: 7,
          pointBackgroundColor: token('--status-ok'),
          borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { unit: granularity === 'hour' ? 'hour' : 'day', displayFormats: { hour: 'HH:mm', day: 'MMM d' } },
          ticks: { color: token('--text-secondary'), maxRotation: 0, font: { family: 'monospace', size: 10 } },
          grid: { color: token('--accent') + '0d' },
        },
        y: { beginAtZero: true, ticks: { color: token('--text-secondary'), precision: 0, font: { family: 'monospace', size: 10 } }, grid: { color: token('--accent') + '0d' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...chartTooltip() },
      }
    }
  });
}

function renderBreakdown(data) {
  const tbl = document.getElementById('evtTbl');
  if (data.length === 0) {
    tbl.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:30px;color:var(--dim)">${escapeHtml(I18N.t('stats.noEvents'))}</td></tr>`;
    return;
  }
  const max = Math.max(...data.map(d => d.count));
  tbl.innerHTML = `
    <thead><tr><th>EVENT TYPE</th><th>FREQUENCY</th><th style="text-align:right">COUNT</th></tr></thead>
    <tbody>
      ${data.map((d, i) => {
        const color = COLORS[i % COLORS.length];
        const pct = (d.count / max * 100).toFixed(0);
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:7px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span><span>${d.name}</span></div></td>
          <td><div class="ebar-w"><div class="ebar-bg"><div class="ebar-f" style="width:${pct}%;background:${color}"></div></div></div></td>
          <td class="ecnt" style="color:${color}">${d.count}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

// Zone Dwell Time (Data Enrichment Ph.1) — rows from GET /api/stats/dwell
// [{camera_id, rule_name, episodes, avg_sec, max_sec, min_sec, total_sec}]
function _fmtDwell(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

function renderDwell(rows) {
  const tbl = document.getElementById('dwellTbl');
  if (!tbl) return;
  if (!rows.length) {
    tbl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-secondary)">${escapeHtml(I18N.t('stats.dwellNone'))}</td></tr>`;
    return;
  }
  const maxAvg = Math.max(...rows.map(r => r.avg_sec || 0), 1);
  tbl.innerHTML = `
    <thead><tr>
      <th>${escapeHtml(I18N.t('stats.dwellColCamera'))}</th>
      <th>${escapeHtml(I18N.t('stats.dwellColRule'))}</th>
      <th style="text-align:right">${escapeHtml(I18N.t('stats.dwellColEpisodes'))}</th>
      <th>${escapeHtml(I18N.t('stats.dwellColAvg'))}</th>
      <th style="text-align:right">${escapeHtml(I18N.t('stats.dwellColMax'))}</th>
      <th style="text-align:right">${escapeHtml(I18N.t('stats.dwellColTotal'))}</th>
    </tr></thead>
    <tbody>
      ${rows.map((r, i) => {
        const color = COLORS[i % COLORS.length];
        const pct = (r.avg_sec / maxAvg * 100).toFixed(0);
        const camName = (cameras.find(c => c.camera_id === r.camera_id) || {}).camera_name || r.camera_id;
        return `<tr>
          <td>${escapeHtml(camName)}</td>
          <td>${escapeHtml(r.rule_name || '—')}</td>
          <td class="ecnt" style="color:${color}">${r.episodes}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="ebar-w" style="flex:0 0 80px"><div class="ebar-bg"><div class="ebar-f" style="width:${pct}%;background:${color}"></div></div></div><span style="white-space:nowrap">${_fmtDwell(r.avg_sec)}</span></div></td>
          <td style="text-align:right;white-space:nowrap">${_fmtDwell(r.max_sec)}</td>
          <td style="text-align:right;white-space:nowrap;color:var(--text-secondary)">${_fmtDwell(r.total_sec)}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

// 3D Pie chart (canvas drawing)
function renderPie3D(data) {
  const canvas = document.getElementById('pie3d');
  const lgd = document.getElementById('pie3dLgd');
  if (!canvas) return;

  if (data.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = token('--text-secondary');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(I18N.t('stats.noData'), canvas.width/2, canvas.height/2);
    lgd.innerHTML = '';
    return;
  }

  const total = data.reduce((s, d) => s + d.count, 0);
  const segs = data.map((d, i) => ({
    value: d.count,
    color: d.color || COLORS[i % COLORS.length],
    label: d.name,
    pct: d.count/total*100
  }));

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W*0.5, cy = H*0.46, rx = Math.min(W, H)*0.36, ry = rx*0.42, dep = 14;
  let ang = -Math.PI/2;

  const sls = segs.map(s => {
    const sw = (s.value/total) * Math.PI * 2;
    const sl = { ...s, s: ang, e: ang+sw, m: ang+sw/2 };
    ang += sw;
    return sl;
  });

  function darken(hex, f=0.45) {
    const n = parseInt(hex.replace('#',''), 16);
    return `rgb(${Math.floor(((n>>16)&255)*f)},${Math.floor(((n>>8)&255)*f)},${Math.floor((n&255)*f)})`;
  }

  // Draw side walls (sorted by depth)
  const so = [...sls].sort((a,b) => Math.sin(a.m) - Math.sin(b.m));
  so.forEach(sl => {
    if (Math.sin(sl.m) < -0.05) return;
    const st = Math.max(4, Math.ceil((sl.e-sl.s)/0.04));
    const sp = (sl.e-sl.s)/st;
    ctx.beginPath();
    ctx.moveTo(cx + rx*Math.cos(sl.s), cy + ry*Math.sin(sl.s));
    for (let i = 1; i <= st; i++) {
      const a = sl.s + i*sp;
      ctx.lineTo(cx + rx*Math.cos(a), cy + ry*Math.sin(a));
    }
    for (let i = st; i >= 0; i--) {
      const a = sl.s + i*sp;
      ctx.lineTo(cx + rx*Math.cos(a), cy + dep + ry*Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = darken(sl.color, 0.42);
    ctx.fill();
  });

  // Draw top
  sls.forEach(sl => {
    const st = Math.max(4, Math.ceil((sl.e-sl.s)/0.03));
    const sp = (sl.e-sl.s)/st;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = 0; i <= st; i++) {
      const a = sl.s + i*sp;
      ctx.lineTo(cx + rx*Math.cos(a), cy + ry*Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = sl.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,14,26,0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  // Draw % labels
  sls.forEach(sl => {
    if (sl.pct < 5) return;
    const lx = cx + rx*0.58*Math.cos(sl.m);
    const ly = cy + ry*0.58*Math.sin(sl.m);
    ctx.font = `bold 10px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(`${sl.pct.toFixed(1)}%`, lx+0.5, ly+0.5);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${sl.pct.toFixed(1)}%`, lx, ly);
  });

  // Legend
  lgd.innerHTML = sls.map(sl => `
    <div class="pli">
      <div class="psw" style="background:${sl.color};box-shadow:0 0 6px ${sl.color}55"></div>
      <div class="plt"><div class="pln">${sl.label}</div></div>
      <div class="plp" style="color:${sl.color}">${sl.pct.toFixed(1)}%</div>
    </div>`).join('');
}

// ============================================================
// MAP CACHE MANAGER (Offline Tiles)
// ============================================================

let mapMgrPollTimer = null;
let mapMgrPreviewMap = null;


// ============================================================
// Settings › Map (decision #171)
// ============================================================
async function onShowMapSettings() {
  const inp = document.getElementById('fldMapboxToken');
  if (inp) inp.value = '';  // SEC-017: token stays server-side; field shows empty (type a new token to replace)
  await updateOfflineButtonState();
  loadMapMgrPanel();
}

function toggleMapboxTokenVis() {
  const inp = document.getElementById('fldMapboxToken');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const btn = inp.nextElementSibling;
  if (btn) btn.setAttribute('data-i18n', inp.type === 'password' ? 'set.showToken' : 'set.hideToken');
  I18N.apply();
}

async function saveMapboxToken() {
  const inp = document.getElementById('fldMapboxToken');
  const msg = document.getElementById('mapboxTokenMsg');
  if (!inp || !msg) return;
  const val = inp.value.trim();
  msg.textContent = '';
  try {
    const r = await fetch(`${API}/api/settings/map`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapboxToken: val }),
    });
    const j = await r.json();
    if (!r.ok) {
      msg.style.color = 'var(--status-bad)';
      msg.textContent = j.error === 'invalid_token_format'
        ? I18N.t('set.tokenInvalid') : (j.error || 'Error');
      return;
    }
    msg.style.color = 'var(--status-ok)';
    msg.textContent = I18N.t('set.tokenSaved');
    await reloadMapboxTokenFromConfig();
  } catch (e) {
    msg.style.color = 'var(--status-bad)';
    msg.textContent = String(e);
  }
}

async function reloadMapboxTokenFromConfig() {
  try {
    const cfg = await fetch(`${API}/api/config`).then(r => r.json());
    mapLayers._mapboxAvailable = cfg.mapboxAvailable || false;
    if (cfg.mapboxAvailable) {
      mapLayers._tileUrls.online.mapbox.streets = `${API}/api/map/tiles/mapbox/streets/{z}/{x}/{y}.png`;
      mapLayers._tileUrls.online.mapbox.light   = `${API}/api/map/tiles/mapbox/light/{z}/{x}/{y}.png`;
      if (mapLayers._currentProvider === 'mapbox' && mapLayers._currentSource === 'online') {
        applyMapTileSource();
      }
    }
    await updateOfflineButtonState();
  } catch {}
}

async function updateOfflineButtonState() {
  try {
    const { cachedTiles } = await fetch(`${API}/api/map/areas`).then(r => r.json());
    const btn = document.getElementById('togSource');
    if (!btn) return;
    const hasCache = cachedTiles > 0;
    btn.disabled = !hasCache;
    btn.title = hasCache ? I18N.t('map.tipSource') : I18N.t('map.offlineDisabledTooltip');
    if (!hasCache && mapLayers._currentSource === 'offline') {
      mapLayers._currentSource = 'online';
      localStorage.setItem('mapSource', 'online');
      applyMapTileSource();
    }
  } catch {}
}

function loadMapMgrPanel() {
  const panel = document.getElementById('mapMgrPanelContent');
  if (!panel) return;
  // Re-use existing map manager init — target the panel instead of modal
  initMapMgrPreview();
  loadSavedAreas();
  pollDownloadStatus();
  if (!document.getElementById('bboxNorth')?.value) {
    document.getElementById('bboxNorth') && (document.getElementById('bboxNorth').value = 14.0);
    document.getElementById('bboxSouth') && (document.getElementById('bboxSouth').value = 13.5);
    document.getElementById('bboxEast')  && (document.getElementById('bboxEast').value  = 100.85);
    document.getElementById('bboxWest')  && (document.getElementById('bboxWest').value  = 100.30);
    document.getElementById('zoomMin')   && (document.getElementById('zoomMin').value   = 8);
    document.getElementById('zoomMax')   && (document.getElementById('zoomMax').value   = 16);
    setTimeout(() => { updateBboxPreview && updateBboxPreview(); estimateDownload && estimateDownload(); }, 200);
  }
}

function initMapMgrPreview() {
  if (mapMgrPreviewMap) return;
  setTimeout(() => {
    mapMgrPreviewMap = new ol.Map({
      target: 'mapMgrPreview',
      layers: [new ol.layer.Tile({
        source: new ol.source.OSM({
          url: 'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
        })
      })],
      view: new ol.View({ center: ol.proj.fromLonLat([100.5018, 13.7563]), zoom: 9 })
    });
    const vectorSource = new ol.source.Vector();
    mapMgrPreviewMap.addLayer(new ol.layer.Vector({
      source: vectorSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: token('--accent'), width: 2 }),
        fill: new ol.style.Fill({ color: token('--accent') + '33' })
      })
    }));
    mapMgrPreviewMap._bboxSource = vectorSource;

    // Shift+drag เพื่อกำหนด bbox
    let dragStart = null;
    mapMgrPreviewMap.on('pointerdown', (e) => {
      if (!e.originalEvent.shiftKey) return;
      dragStart = ol.proj.toLonLat(e.coordinate);
      e.preventDefault();
    });
    mapMgrPreviewMap.on('pointerup', (e) => {
      if (!dragStart) return;
      const end = ol.proj.toLonLat(e.coordinate);
      document.getElementById('bboxNorth').value = Math.max(dragStart[1], end[1]).toFixed(4);
      document.getElementById('bboxSouth').value = Math.min(dragStart[1], end[1]).toFixed(4);
      document.getElementById('bboxEast').value  = Math.max(dragStart[0], end[0]).toFixed(4);
      document.getElementById('bboxWest').value  = Math.min(dragStart[0], end[0]).toFixed(4);
      dragStart = null;
      updateBboxPreview();
      estimateDownload();
    });

    updateBboxPreview();
  }, 100);
}

function updateBboxPreview() {
  if (!mapMgrPreviewMap || !mapMgrPreviewMap._bboxSource) return;
  const n = parseFloat(document.getElementById('bboxNorth').value);
  const s = parseFloat(document.getElementById('bboxSouth').value);
  const e = parseFloat(document.getElementById('bboxEast').value);
  const w = parseFloat(document.getElementById('bboxWest').value);
  if (isNaN(n) || isNaN(s) || isNaN(e) || isNaN(w)) return;

  const coords = [[w, s], [e, s], [e, n], [w, n], [w, s]].map(c => ol.proj.fromLonLat(c));
  const polygon = new ol.geom.Polygon([coords]);
  const feature = new ol.Feature({ geometry: polygon });
  mapMgrPreviewMap._bboxSource.clear();
  mapMgrPreviewMap._bboxSource.addFeature(feature);
  mapMgrPreviewMap.getView().fit(polygon, { padding: [40, 40, 40, 40], duration: 300 });
}

async function estimateDownload() {
  const bbox = {
    north: parseFloat(document.getElementById('bboxNorth').value),
    south: parseFloat(document.getElementById('bboxSouth').value),
    east:  parseFloat(document.getElementById('bboxEast').value),
    west:  parseFloat(document.getElementById('bboxWest').value),
  };
  const zoomMin = parseInt(document.getElementById('zoomMin').value);
  const zoomMax = parseInt(document.getElementById('zoomMax').value);
  const styles = [];
  if (document.getElementById('styleStreets').checked) styles.push('streets');
  if (document.getElementById('styleLight').checked) styles.push('light');
  const providers = [];
  if (document.getElementById('provCarto')?.checked) providers.push('carto');
  if (document.getElementById('provMapbox')?.checked) providers.push('mapbox');
  if (providers.length === 0) providers.push('carto'); // fallback

  if (isNaN(bbox.north) || styles.length === 0) {
    document.getElementById('estimateInfo').innerHTML =
      `<span style="color:var(--amber)">${I18N.t('mapMgr.needCoordsStyle')}</span>`;
    return;
  }
  try {
    const res = await fetch(`${API}/api/map/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, zoomMin, zoomMax, styles, providers }),
    });
    const data = await res.json();
    const sizeMB = (data.estimatedSize / 1024 / 1024).toFixed(0);
    const sizeGB = (data.estimatedSize / 1024 / 1024 / 1024).toFixed(2);
    const display = data.estimatedSize > 1024*1024*1024 ? `${sizeGB} GB` : `${sizeMB} MB`;
    const minutes = Math.ceil(data.totalTiles / 8 / 60);

    let warning = '';
    if (providers.includes('mapbox') && !data.providers.includes('mapbox')) {
      warning = `<div style="color:var(--amber);font-size:10px;margin-top:4px">${I18N.t('mapMgr.mapboxSkipped')}</div>`;
    }

    document.getElementById('estimateInfo').innerHTML = `
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:11px;">
        <div><span style="color:var(--dim)">Total tiles:</span> <strong style="color:var(--accent)">${data.totalTiles.toLocaleString()}</strong></div>
        <div><span style="color:var(--dim)">Per style:</span> <strong>${data.tilesPerStyle.toLocaleString()}</strong></div>
        <div><span style="color:var(--dim)">Providers:</span> <strong>${data.providers.join(', ')}</strong></div>
        <div><span style="color:var(--dim)">Size:</span> <strong style="color:var(--amber)">${display}</strong></div>
        <div><span style="color:var(--dim)">Time:</span> <strong>~${minutes}${I18N.t('mapMgr.minUnit')}</strong></div>
      </div>${warning}`;
  } catch (e) { console.error(e); }
}

async function startDownload() {
  const name = document.getElementById('areaName').value.trim() ||
               'Bangkok ' + new Date().toLocaleDateString('th-TH');
  const bbox = {
    north: parseFloat(document.getElementById('bboxNorth').value),
    south: parseFloat(document.getElementById('bboxSouth').value),
    east:  parseFloat(document.getElementById('bboxEast').value),
    west:  parseFloat(document.getElementById('bboxWest').value),
  };
  const zoomMin = parseInt(document.getElementById('zoomMin').value);
  const zoomMax = parseInt(document.getElementById('zoomMax').value);
  const styles = [];
  if (document.getElementById('styleStreets').checked) styles.push('streets');
  if (document.getElementById('styleLight').checked) styles.push('light');
  const providers = [];
  if (document.getElementById('provCarto')?.checked) providers.push('carto');
  if (document.getElementById('provMapbox')?.checked) providers.push('mapbox');
  if (styles.length === 0) { alert(I18N.t('mapMgr.pickStyle')); return; }
  if (providers.length === 0) { alert(I18N.t('mapMgr.pickProvider')); return; }

  try {
    const res = await fetch(`${API}/api/map/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bbox, zoomMin, zoomMax, styles, providers }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(I18N.t('mapMgr.downloadFailed') + err.error);
      return;
    }
    pollDownloadStatus();
  } catch (e) { alert('Error: ' + e.message); }
}

async function cancelDownload() {
  if (!confirm(I18N.t('mapMgr.confirmCancel'))) return;
  await fetch(`${API}/api/map/cancel`, { method: 'POST' });
}

function pollDownloadStatus() {
  if (mapMgrPollTimer) clearInterval(mapMgrPollTimer);
  const update = async () => {
    try {
      const res = await fetch(`${API}/api/map/progress`);
      const s = await res.json();
      const progEl = document.getElementById('downloadProgress');
      if (!progEl) return;
      if (s.active) {
        progEl.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:var(--green)">${I18N.t('mapMgr.downloading')}</strong>
            <span style="color:var(--dim);font-size:10px">${s.current || ''}</span>
          </div>
          <div style="background:var(--panel2);border-radius:4px;height:14px;overflow:hidden;margin-bottom:6px;">
            <div style="background:var(--green);height:100%;width:${s.progressPercent}%;transition:width .3s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--dim)">
            <span>${s.done.toLocaleString()} / ${s.total.toLocaleString()} tiles</span>
            <span>${s.progressPercent}%${s.failed > 0 ? ` · ${s.failed} failed` : ''}</span>
          </div>
          <button class="btn btn-danger" style="width:100%;margin-top:8px;padding:5px" data-action="cancelDownload">${I18N.t('mapMgr.cancel')}</button>`;
      } else if (s.startedAt && s.finishedAt) {
        progEl.innerHTML = `
          <div style="color:var(--green);font-size:11px">
            ${I18N.t('mapMgr.doneLabel')} ${s.done.toLocaleString()}/${s.total.toLocaleString()} tiles
            ${s.failed > 0 ? ` (${s.failed} failed)` : ''}
          </div>`;
        loadSavedAreas();
      } else {
        progEl.innerHTML = `<div style="color:var(--dim);font-size:11px">${I18N.t('mapMgr.noDownload')}</div>`;
      }
    } catch (e) { /* ignore */ }
  };
  update();
  mapMgrPollTimer = setInterval(update, 1500);
}

async function loadSavedAreas() {
  try {
    const res = await fetch(`${API}/api/map/areas`);
    const data = await res.json();
    const sizeGB = (data.cacheSize / 1024 / 1024 / 1024).toFixed(2);
    const sizeMB = (data.cacheSize / 1024 / 1024).toFixed(0);
    const sizeStr = data.cacheSize > 1024*1024*1024 ? `${sizeGB} GB` : `${sizeMB} MB`;

    document.getElementById('cacheStats').innerHTML = `
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:11px;">
        <div><span style="color:var(--dim)">Cache Size:</span> <strong style="color:var(--accent)">${sizeStr}</strong></div>
        <div><span style="color:var(--dim)">Cached Tiles:</span> <strong>${data.cachedTiles.toLocaleString()}</strong></div>
      </div>`;

    const areasEl = document.getElementById('savedAreas');
    if (!data.areas || data.areas.length === 0) {
      areasEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--dim);font-size:11px">${I18N.t('mapMgr.noSavedAreas')}</div>`;
      return;
    }
    areasEl.innerHTML = data.areas.map(a => `
      <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:11px">
        <div>
          <div style="font-weight:600">${a.name}</div>
          <div style="color:var(--dim);font-size:10px">
            Z${a.zoomMin}-${a.zoomMax} · ${a.styles.join(', ')} · ${new Date(a.createdAt).toLocaleString('th-TH', {hour12:false})}
          </div>
        </div>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" data-action="deleteArea" data-id="${escapeHtml(a.id)}">${I18N.t('mapMgr.delete')}</button>
      </div>`).join('');
  } catch (e) { console.error(e); }
}

async function deleteArea(id) {
  if (!confirm(I18N.t('mapMgr.confirmDeleteArea'))) return;
  await fetch(`${API}/api/map/areas/${id}`, { method: 'DELETE' });
  loadSavedAreas();
}

async function clearAllCache() {
  if (!confirm(I18N.t('mapMgr.confirmClearCache'))) return;
  await fetch(`${API}/api/map/cache`, { method: 'DELETE' });
  loadSavedAreas();
  if (map && mapLayers._currentSource === 'offline') applyMapTileSource();
}

// Hook input events for live update
document.addEventListener('input', (e) => {
  if (e.target.matches('#bboxNorth, #bboxSouth, #bboxEast, #bboxWest')) {
    updateBboxPreview();
  }
  if (e.target.matches('#bboxNorth, #bboxSouth, #bboxEast, #bboxWest, #zoomMin, #zoomMax')) {
    estimateDownload();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('#styleStreets, #styleLight, #provCarto, #provMapbox')) estimateDownload();
});

// ============================================================
// Reports
// ============================================================

// Phase 5 — Reports built on Stats v2 endpoints (categories / timeline /
// breakdown / per-camera / heatmap / top-rules / quiet-cameras).
// 4 report types share the same renderer; only the [from,to] window differs.

function onReportTypeChange() {
  const type = document.getElementById('reportType').value;
  const fields = ['Daily', 'Weekly', 'Monthly', 'Custom', 'Health'];
  fields.forEach(f => {
    const el = document.getElementById('reportField' + f);
    if (el) el.classList.toggle('hidden', f.toLowerCase() !== type);
  });
  // Ph.3 — health vs analytics: swap button group + hide title/category
  const isHealth = type === 'health';
  document.getElementById('reportBtnsAnalytics')?.classList.toggle('hidden', isHealth);
  document.getElementById('reportBtnsHealth')?.classList.toggle('hidden', !isHealth);
  document.getElementById('reportTitleGroup')?.classList.toggle('hidden', isHealth);
  document.getElementById('reportCategoryGroup')?.classList.toggle('hidden', isHealth);
  if (isHealth) {
    loadHealthRecipients();           // refresh roster each switch
    _hrToggleCustomRange();           // ensure from/to fields toggle is in sync
  }

  // Sensible defaults when switching type
  const today = new Date();
  if (type === 'daily'   && !getDtValue('reportDate'))     setDtValue('reportDate',     today);
  if (type === 'weekly'  && !getDtValue('reportWeekDate')) setDtValue('reportWeekDate', today);
  if (type === 'monthly' && !getDtValue('reportMonth'))    setDtValue('reportMonth',    today);
  if (type === 'custom') {
    const yest = new Date(today.getTime() - 24 * 3600e3);
    if (!getDtValue('reportFrom')) setDtValue('reportFrom', yest);
    if (!getDtValue('reportTo'))   setDtValue('reportTo',   today);
  }

  _refreshReportRangeNote();
}

// Ph.3 — Health report: preview + download + send-now (with range + recipients)

function _getHealthSections() {
  return [...document.querySelectorAll('.hrPreviewSec:checked')].map(c => c.value);
}

function _normalizeHealthSectionsForUi(sections) {
  const raw = Array.isArray(sections) && sections.length ? sections : null;
  if (!raw) return null;
  const out = [];
  raw.forEach(s => {
    if (s === 'cameras') out.push('camera_status', 'camera_uptime');
    else out.push(s);
  });
  return new Set(out);
}

// Build the query-string fragment for range (preset or custom from+to)
function _buildHealthRangeParams() {
  const preset = document.getElementById('hrRangePreset')?.value || '24h';
  if (preset !== 'custom') return `range=${encodeURIComponent(preset)}`;
  const from = getDtValue('hrRangeFrom');
  const to   = getDtValue('hrRangeTo');
  if (!from || !to) return null;  // signal: custom selected but not filled
  return `range=custom&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
}

// POST-body equivalent of the query-string fragment above
function _buildHealthRangeBody() {
  const preset = document.getElementById('hrRangePreset')?.value || '24h';
  if (preset !== 'custom') return { preset };
  const from = getDtValue('hrRangeFrom');
  const to   = getDtValue('hrRangeTo');
  if (!from || !to) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

// Toggle the custom from/to fields based on preset selection
function _hrToggleCustomRange() {
  const isCustom = document.getElementById('hrRangePreset')?.value === 'custom';
  const el = document.getElementById('hrCustomRangeFields');
  if (el) el.classList.toggle('hidden', !isCustom);
  // Sensible defaults: from=now-24h, to=now
  if (isCustom) {
    const now = new Date();
    const yest = new Date(now.getTime() - 24 * 3600e3);
    if (!getDtValue('hrRangeFrom')) setDtValue('hrRangeFrom', yest);
    if (!getDtValue('hrRangeTo'))   setDtValue('hrRangeTo',   now);
  }
}

// Load LINE recipients into the picker (re-render on every type=health switch
// so a roster change in Settings is reflected without a page reload).
async function loadHealthRecipients() {
  const el = document.getElementById('hrRecipientsList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/line-config`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
    const enabled = roster.filter(r => r.enabled);
    if (!enabled.length) {
      el.innerHTML = `<div style="color:var(--amber);padding:6px">${escapeHtml(I18N.t('hr.noRecipients'))}</div>`;
      return;
    }
    el.innerHTML = enabled.map(r => {
      const icon = r.type === 'group' ? '👥' : r.type === 'room' ? '🚪' : '👤';
      const idShort = escapeHtml((r.id || '').slice(0, 8) + '…');
      return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
        <input type="checkbox" class="hrRecipCheck" value="${escapeHtml(r.id)}" checked data-change="updateHrSendBtn">
        <span style="flex:1">${icon} ${escapeHtml(r.name || r.id)} <span style="color:var(--dim);font-size:10px">${idShort}</span></span>
      </label>`;
    }).join('');
    _updateHealthSendBtnLabel();
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);padding:6px">${escapeHtml(I18N.t('hr.recipLoadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function _updateHealthSendBtnLabel() {
  const n = document.querySelectorAll('.hrRecipCheck:checked').length;
  const btns = document.querySelectorAll('#hrSendNowBtn');
  btns.forEach(b => {
    b.textContent = I18N.t('hr.btnSendNowN').replace('{n}', n);
    b.disabled = n === 0;
    b.style.opacity = n === 0 ? 0.5 : 1;
    b.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
  });
}

function _getHealthRecipientIds() {
  return [...document.querySelectorAll('.hrRecipCheck:checked')].map(c => c.value);
}

async function previewHealthReport() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  const preview = document.getElementById('reportPreview');
  preview.innerHTML = `<div style="text-align:center;padding:60px;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  const url = `${API}/api/health/report/preview?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&t=${Date.now()}`;
  const img = new Image();
  img.onload = () => {
    preview.innerHTML = '';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.borderRadius = '6px';
    img.style.border = '1px solid var(--border)';
    preview.appendChild(img);
  };
  img.onerror = () => { preview.innerHTML = `<div style="color:var(--red);padding:30px;text-align:center">${escapeHtml(I18N.t('hr.previewFailed'))}</div>`; };
  img.src = url;
}

function downloadHealthPng() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  window.location = `${API}/api/health/report/preview?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&download=1`;
}

function downloadHealthPdf() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  window.location = `${API}/api/health/report/pdf?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}`;
}

async function sendHealthReportNow() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const range = _buildHealthRangeBody();
  if (range === null) { alert(I18N.t('hr.needCustomRange')); return; }
  const recipients = _getHealthRecipientIds();
  if (recipients.length === 0) { alert(I18N.t('hr.needRecipient')); return; }
  if (!confirm(I18N.t('hr.confirmSendN').replace('{n}', recipients.length))) return;
  try {
    const res = await fetch(`${API}/api/health/report/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections, range, recipients, lang: (I18N.getLang ? I18N.getLang() : 'th') }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    if (j.success) {
      alert(I18N.t('hr.sendOk').replace('{n}', j.sent_count).replace('{t}', j.total_recipients));
    } else {
      alert(I18N.t('hr.sendFailed') + (j.error || 'unknown'));
    }
  } catch (e) { alert(I18N.t('hr.sendFailed') + e.message); }
}

function _computeReportRange() {
  const type = document.getElementById('reportType').value;
  // วันที่บน label ต้องตามภาษา UI — th = พ.ศ./เดือนไทย, en = ค.ศ. (เหมือน convention ใน renderEventsTable)
  const loc  = ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB';
  let from, to, label;

  if (type === 'daily') {
    const dStr = getDtValue('reportDate');
    if (!dStr) return null;
    from = new Date(`${dStr}T00:00:00`);
    to   = new Date(`${dStr}T23:59:59.999`);
    label = I18N.t('rep.dateLabel').replace('{d}',
      new Date(dStr).toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' }));
  } else if (type === 'weekly') {
    const dStr = getDtValue('reportWeekDate');
    if (!dStr) return null;
    const ref = new Date(`${dStr}T00:00:00`);
    const dow = (ref.getDay() + 6) % 7;          // Mon = 0
    from = new Date(ref); from.setDate(from.getDate() - dow);
    to   = new Date(from); to.setDate(to.getDate() + 7); to.setMilliseconds(-1);
    label = `${from.toLocaleDateString(loc)} – ${new Date(to.getTime()).toLocaleDateString(loc)}`;
  } else if (type === 'monthly') {
    const m = getDtValue('reportMonth');
    if (!m) return null;
    const [yr, mo] = m.split('-').map(Number);
    from = new Date(yr, mo - 1, 1, 0, 0, 0, 0);
    to   = new Date(yr, mo, 1, 0, 0, 0, -1);
    label = `${from.toLocaleString(loc, { month: 'long', year: 'numeric' })}`;
  } else { // custom
    const f = getDtValue('reportFrom');
    const t = getDtValue('reportTo');
    if (!f || !t) return null;
    from = new Date(f);
    to   = new Date(t);
    label = `${from.toLocaleString(loc, {hour12:false})} – ${to.toLocaleString(loc, {hour12:false})}`;
  }
  if (!(from < to)) return null;
  return { type, from, to, label };
}

function _refreshReportRangeNote() {
  const r = _computeReportRange();
  const note = document.getElementById('reportRangeNote');
  if (!note) return;
  if (!r) { note.innerHTML = escapeHtml(I18N.t('rep.noRangeSelected')); return; }
  const days = ((r.to - r.from) / 86400e3).toFixed(1);
  note.innerHTML = I18N.t('rep.rangeNote')
    .replace('{label}', escapeHtml(r.label)).replace('{days}', days);
}

let _reportData = null;

async function updateReportPreview() {
  const range = _computeReportRange();
  if (!range) { alert(I18N.t('rep.pickFullRange')); return; }
  const title = document.getElementById('reportTitle').value || I18N.t('rep.fallbackTitle');
  const catId = document.getElementById('reportCategoryFilter')?.value || '';
  const camIds = getActiveGroupCameraIds ? getActiveGroupCameraIds() : [];
  const camParam = camIds.length ? `&cameras=${encodeURIComponent(camIds.join(','))}` : '';

  const fromIso = range.from.toISOString();
  const toIso   = range.to.toISOString();
  const catParam = catId ? `&category_id=${encodeURIComponent(catId)}` : '';

  const preview = document.getElementById('reportPreview');
  preview.innerHTML = `<div style="text-align:center;padding:80px;color:#666">${escapeHtml(I18N.t('rep.loadingData'))}</div>`;

  try {
    const [cats, tl, brk, ppl, veh, heat, top, quiet] = await Promise.all([
      fetch(`${API}/api/stats/categories?from=${fromIso}&to=${toIso}${camParam}`).then(r => r.ok ? r.json() : { categories: [] }),
      fetch(`${API}/api/stats/timeline-by-category?from=${fromIso}&to=${toIso}${camParam}`).then(r => r.ok ? r.json() : { series: [] }),
      fetch(`${API}/api/stats/breakdown-v2?from=${fromIso}&to=${toIso}${camParam}`).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/stats/per-camera-counts?kind=people&from=${fromIso}&to=${toIso}${camParam}`).then(r => r.ok ? r.json() : { per_camera: [] }),
      fetch(`${API}/api/stats/per-camera-counts?kind=vehicle&from=${fromIso}&to=${toIso}${camParam}`).then(r => r.ok ? r.json() : { per_camera: [] }),
      fetch(`${API}/api/stats/heatmap?from=${fromIso}&to=${toIso}${camParam}${catParam}`).then(r => r.ok ? r.json() : { cells: [] }),
      fetch(`${API}/api/stats/top-rules?from=${fromIso}&to=${toIso}${camParam}&limit=10`).then(r => r.ok ? r.json() : { top: [] }),
      fetch(`${API}/api/stats/quiet-cameras?since_hours=24`).then(r => r.ok ? r.json() : { cameras: [] }),
    ]);

    _reportData = { range, title, cats, tl, brk, ppl, veh, heat, top, quiet };
    renderReportPreviewV2();
    // Mobile UX — once the preview lands, scroll the user to it.
    // Otherwise the form sidebar (stacked above the preview on phones)
    // eats the whole viewport and the operator doesn't realise the
    // report just rendered. No-op on wide screens where both panels
    // are visible side-by-side.
    if (window.matchMedia('(max-width: 768px)').matches) {
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    preview.innerHTML = `<div style="text-align:center;padding:80px;color:#c00">${escapeHtml(I18N.t('rep.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

// Populate category filter once when first opening Reports page
async function initReportCategoryFilter() {
  const sel = document.getElementById('reportCategoryFilter');
  if (!sel || sel.options.length > 1) return;  // already populated
  try {
    const r = await fetch(`${API}/api/categories`);
    if (!r.ok) return;
    const cats = await r.json();
    sel.innerHTML = '<option value="">All categories</option>'
      + cats.map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  } catch {}
}

// Print-friendly preview built from Stats v2 data
// The report layout now lives in the shared dashboard/report-template.js
// (window.ReportTemplate) — used by BOTH this interactive page and the
// Puppeteer print page (report-print.html) so the "full" scheduled image
// is byte-for-byte the same report. See Phase 7.3.
function renderReportPreviewV2() {
  const d = _reportData;
  if (!d) return;
  const preview = document.getElementById('reportPreview');
  if (typeof ReportTemplate === 'undefined') {
    preview.innerHTML = '<div style="padding:40px;color:#c00">report-template.js not loaded</div>';
    return;
  }
  preview.innerHTML = ReportTemplate.buildReportHtml(d, _brand);
  const t = ReportTemplate.computeTrendPoints(d);
  if (t.points.length) ReportTemplate.renderReportTrendChart('reportTrendChart', t.points, t.trunc);
}


// PDF download is now server-rendered via GET /api/reports/pdf — which
// goes through Puppeteer page.pdf() on the SAME /report-print.html the
// scheduler uses. So the downloaded PDF byte-for-byte matches the
// interactive report, uses Chromium's real paginator (no mid-element
// cuts on long weekly/monthly reports), and respects 8mm A4 margins.
// The old html2canvas+jsPDF white-rect approach is gone.
async function downloadPDF() {
  if (!_reportData) { alert(I18N.t('rep.loadDataFirst')); return; }
  const btn = document.activeElement;
  const orig = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('rep.generatingPdf'); }
  try {
    const r = _reportData.range;
    const camIds = (typeof getActiveGroupCameraIds === 'function') ? getActiveGroupCameraIds() : [];
    const qp = new URLSearchParams({
      type:     r.type || 'daily',
      from:     r.from.toISOString(),
      to:       r.to.toISOString(),
      title:    _reportData.title || I18N.t('rep.summaryTitle'),
      label:    r.label || '',
      download: '1',
    });
    if (camIds && camIds.length) qp.set('cameras', camIds.join(','));

    const res = await fetch(`${API}/api/reports/pdf?${qp}`, { cache: 'no-store' });
    if (!res.ok) {
      let body = ''; try { body = (await res.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${res.status}${body ? ' · ' + body : ''}`);
    }
    const blob = await res.blob();
    const stamp = r.from.toISOString().slice(0, 10).replace(/-/g, '') + '_'
                + r.to.toISOString().slice(0, 10).replace(/-/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dojojin-report-${r.type || 'custom'}-${stamp}.pdf`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (e) {
    alert(I18N.t('rep.pdfFailed') + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// ============================================================
// 📅 Report Schedules (Phase 7.3 — scheduled report delivery)
// ============================================================
// Commit 1: config layer. CRUD against /api/report-schedules; the
// server-side scheduler fires at send_time and records the run.
// PDF generation + email delivery land in commits 2-3.
const _RS_TYPE_LABEL = {
  daily:   I18N.t('rs.typeDaily'),
  weekly:  I18N.t('rs.typeWeekly'),
  monthly: I18N.t('rs.typeMonthly'),
  health:  I18N.t('hr.typeHealth'),
};
const _RS_LAYOUT_LABEL = {
  compact: I18N.t('rs.layoutCompact'),
  full:    I18N.t('rs.layoutFull'),
};
let _rsRecipients = [];   // LINE recipient roster (from /api/line-config)
const _rsRowMap = new Map(); // id → schedule row (avoids JSON in onclick attrs)

function openReportScheduleModal() {
  document.getElementById('reportScheduleModal').classList.remove('hidden');
  resetReportScheduleForm();
  loadReportScheduleRecipients();
  loadReportSchedules();
}
function closeReportScheduleModal() {
  document.getElementById('reportScheduleModal').classList.add('hidden');
}
function resetReportScheduleForm() {
  document.getElementById('rsId').value = '';
  document.getElementById('rsType').value = 'daily';
  document.getElementById('rsSendTime').value = '08:00';
  document.getElementById('rsLayout').value = 'compact';
  document.getElementById('rsEnabled').checked = true;
  document.getElementById('rsDayOfWeek').value = '';
  _rsRenderDayOfMonthChips('');
  // reset health sections — all checked by default
  document.querySelectorAll('.hrSecCheck').forEach(c => { c.checked = true; });
  _rsToggleTypeFields();
  _rsRenderRecipientsChecklist([]);
}

// Phase 7.4 — show day-of-week select for weekly, day-of-month chips for
// monthly, hide both for daily. Wired to rsType.onchange + called from
// resetReportScheduleForm and editReportSchedule.
function _rsToggleTypeFields() {
  const t = document.getElementById('rsType').value;
  const dowEl     = document.getElementById('rsDayOfWeekGroup');
  const domEl     = document.getElementById('rsDayOfMonthGroup');
  const healthEl  = document.getElementById('rsHealthSectionsGroup');
  const layoutEl  = document.getElementById('rsLayoutGroup');
  if (dowEl)    dowEl.style.display    = (t === 'weekly' || t === 'health') ? 'block' : 'none';
  if (domEl)    domEl.style.display    = (t === 'monthly') ? 'block' : 'none';
  if (healthEl) healthEl.style.display = (t === 'health')  ? 'block' : 'none';
  if (layoutEl) layoutEl.style.display = (t === 'health')  ? 'none'  : '';
}

// Chip grid for day-of-month picker (1..31 + "วันสุดท้าย"). Multi-select
// via toggle. Reads/writes the CSV format the backend expects ("1,15,L").
function _rsRenderDayOfMonthChips(selectedCsv) {
  const el = document.getElementById('rsDayOfMonthChips');
  if (!el) return;
  const sel = new Set(String(selectedCsv || '').split(',').map(x => x.trim()).filter(Boolean));
  const buttons = [];
  for (let i = 1; i <= 31; i++) {
    const active = sel.has(String(i)) ? ' rsDomActive' : '';
    buttons.push(`<button type="button" class="rsDomChip${active}" data-day="${i}">${i}</button>`);
  }
  const lastActive = sel.has('L') ? ' rsDomActive' : '';
  buttons.push(`<button type="button" class="rsDomChip${lastActive}" data-day="L" style="min-width:auto;padding:5px 12px">${escapeHtml(I18N.t('rs.lastDay'))}</button>`);
  el.innerHTML = buttons.join('');
  el.querySelectorAll('.rsDomChip').forEach(b => {
    b.addEventListener('click', () => b.classList.toggle('rsDomActive'));
  });
}
function _rsGetDayOfMonthValue() {
  const active = document.querySelectorAll('#rsDayOfMonthChips .rsDomChip.rsDomActive');
  return [...active].map(b => b.dataset.day).join(',');
}

// LINE recipient roster — reused from line_config (same source the alert
// rule editor uses). Loaded once when the modal opens.
async function loadReportScheduleRecipients() {
  try {
    const r = await fetch(`${API}/api/line-config`);
    const cfg = r.ok ? await r.json() : { recipients: [] };
    _rsRecipients = Array.isArray(cfg.recipients) ? cfg.recipients : [];
  } catch { _rsRecipients = []; }
  _rsRenderRecipientsChecklist([]);
}
function _rsRenderRecipientsChecklist(selectedIds) {
  const el = document.getElementById('rsRecipientsChecklist');
  if (!el) return;
  if (!_rsRecipients.length) {
    el.innerHTML = `<span style="color:var(--dim)">${escapeHtml(I18N.t('rs.noRecipients'))}</span>`;
    return;
  }
  el.innerHTML = _rsRecipients.map(r => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
      <input type="checkbox" class="rsRecipCheck" value="${escapeHtml(r.id)}" ${selectedIds.includes(r.id) ? 'checked' : ''}>
      <span>${escapeHtml(r.name || r.id)}${r.enabled === false ? ` <span style="color:var(--dim)">${escapeHtml(I18N.t('rs.disabledTag'))}</span>` : ''}</span>
    </label>`).join('');
}

async function loadReportSchedules() {
  const el = document.getElementById('rsList');
  try {
    const res = await fetch(`${API}/api/report-schedules`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    renderReportSchedules(list);
  } catch (e) {
    el.innerHTML = `<tr><td style="padding:12px;color:var(--red)">${escapeHtml(I18N.t('rs.loadFailed'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderReportSchedules(list) {
  const el = document.getElementById('rsList');
  _rsRowMap.clear();
  list.forEach(s => _rsRowMap.set(s.id, s));
  if (!list.length) {
    el.innerHTML = `<tr><td style="padding:14px;color:var(--dim);text-align:center">${escapeHtml(I18N.t('rs.noSchedules'))}</td></tr>`;
    return;
  }
  const dowLabel = I18N.t('stats.dowShort').split(',');
  function _formatDayCell(s) {
    if (s.report_type === 'daily') return `<span style="color:var(--dim)">${escapeHtml(I18N.t('rs.everyDay'))}</span>`;
    if (s.report_type === 'weekly') {
      const d = s.send_day_of_week;
      if (d === null || d === undefined) return `<span style="color:var(--amber)" title="${escapeHtml(I18N.t('rs.everyDayWarnTipW'))}">${escapeHtml(I18N.t('rs.everyDayWarn'))}</span>`;
      return escapeHtml(I18N.t('rs.everyPrefix') + (dowLabel[d] || '?'));
    }
    if (s.report_type === 'monthly') {
      if (!s.send_days_of_month) return `<span style="color:var(--amber)" title="${escapeHtml(I18N.t('rs.everyDayWarnTipM'))}">${escapeHtml(I18N.t('rs.everyDayWarn'))}</span>`;
      const tokens = String(s.send_days_of_month).split(',').map(x => x.trim());
      const pretty = tokens.map(t => t === 'L' ? I18N.t('rs.lastDayShort') : t).join(', ');
      return escapeHtml(I18N.t('rs.daysPrefix').replace('{d}', pretty));
    }
    return '—';
  }

  el.innerHTML =
    `<thead><tr>
       <th style="text-align:left">${escapeHtml(I18N.t('rs.fldType'))}</th><th>${escapeHtml(I18N.t('evt.colTime'))}</th><th>${escapeHtml(I18N.t('rs.colSendDay'))}</th>
       <th>${escapeHtml(I18N.t('rs.fldLayout'))}</th><th>${escapeHtml(I18N.t('rs.colStatus'))}</th>
       <th>${escapeHtml(I18N.t('rs.colLastRun'))}</th><th></th>
     </tr></thead><tbody>` +
    list.map(s => {
      const lastRun = s.last_run_at
        ? new Date(s.last_run_at).toLocaleString('th-TH', { hour12: false })
        : '—';
      const statusBadge = !s.last_status ? `<span style="color:var(--dim)">${escapeHtml(I18N.t('rs.notRunYet'))}</span>`
        : s.last_status === 'success' ? `<span style="color:var(--green)">${escapeHtml(I18N.t('rs.statusSuccess'))}</span>`
        : s.last_status === 'pending' ? '<span style="color:var(--amber)" title="' + escapeHtml(s.last_error || '') + '">pending</span>'
        : '<span style="color:var(--red)" title="' + escapeHtml(s.last_error || '') + '">✗ ' + escapeHtml(s.last_status) + '</span>';
      return `<tr>
        <td style="padding:6px 8px">${_RS_TYPE_LABEL[s.report_type] || s.report_type}</td>
        <td style="text-align:center">${String(s.send_time).slice(0,5)}</td>
        <td style="text-align:center;font-size:11px">${_formatDayCell(s)}</td>
        <td style="text-align:center">${_RS_LAYOUT_LABEL[s.image_layout] || s.image_layout}</td>
        <td style="text-align:center">${s.enabled ? escapeHtml(I18N.t('rs.enabledOn')) : escapeHtml(I18N.t('rs.enabledOff'))}</td>
        <td style="text-align:center;font-size:11px">${lastRun}<br>${statusBadge}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="csv-btn" style="font-size:10px" title="${escapeHtml(I18N.t('rh.runNowTip'))}" data-action="runReportNow" data-id="${s.id}">▶</button>
          <button class="csv-btn" style="font-size:10px" data-action="editReportSched" data-id="${s.id}"><svg aria-hidden="true" width="11" height="11"><use href="#icon-edit"/></svg></button>
          <button class="csv-btn" style="font-size:10px;color:var(--red)" data-action="deleteReportSched" data-id="${s.id}"><svg aria-hidden="true" width="11" height="11"><use href="#icon-trash"/></svg></button>
        </td></tr>`;
    }).join('') + '</tbody>';
}

function editReportSchedule(id) {
  const s = _rsRowMap.get(Number(id));
  if (!s) return;
  document.getElementById('rsId').value = s.id;
  document.getElementById('rsType').value = s.report_type;
  document.getElementById('rsSendTime').value = String(s.send_time).slice(0, 5);
  document.getElementById('rsLayout').value = s.image_layout || 'compact';
  document.getElementById('rsEnabled').checked = !!s.enabled;
  // Phase 7.4 — restore day-of-week / day-of-month from the row.
  document.getElementById('rsDayOfWeek').value =
    (s.send_day_of_week === null || s.send_day_of_week === undefined) ? '' : String(s.send_day_of_week);
  _rsRenderDayOfMonthChips(s.send_days_of_month || '');
  // Ph.3 — restore health sections (default all checked if null)
  const savedSections = _normalizeHealthSectionsForUi(s.health_sections);
  document.querySelectorAll('.hrSecCheck').forEach(c => {
    c.checked = savedSections ? savedSections.has(c.value) : true;
  });
  _rsToggleTypeFields();
  const sel = String(s.recipients || '').split(',').map(x => x.trim()).filter(Boolean);
  _rsRenderRecipientsChecklist(sel);
}

async function saveReportSchedule() {
  const id = document.getElementById('rsId').value;
  const type = document.getElementById('rsType').value;
  const isHealth = type === 'health';
  const body = {
    report_type:  type,
    send_time:    document.getElementById('rsSendTime').value,
    image_layout: isHealth ? null : document.getElementById('rsLayout').value,
    enabled:      document.getElementById('rsEnabled').checked,
    recipients:   [...document.querySelectorAll('.rsRecipCheck:checked')].map(c => c.value).join(','),
    // Phase 7.4 — day picker fields. Always sent (even when irrelevant for
    // the type) so the backend can clear stale values from a previous edit
    // where the type was different.
    send_day_of_week:   (type === 'weekly' || type === 'health') ? document.getElementById('rsDayOfWeek').value : null,
    send_days_of_month: type === 'monthly' ? _rsGetDayOfMonthValue() : null,
    // Ph.3 — health sections
    health_sections: isHealth
      ? [...document.querySelectorAll('.hrSecCheck:checked')].map(c => c.value)
      : null,
  };
  if (!body.send_time) { alert(I18N.t('rs.needSendTime')); return; }
  try {
    const res = await fetch(`${API}/api/report-schedules${id ? '/' + id : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    resetReportScheduleForm();
    loadReportSchedules();
  } catch (e) { alert(I18N.t('rs.saveFailed') + e.message); }
}

async function deleteReportSchedule(id) {
  if (!confirm(I18N.t('rs.confirmDelete'))) return;
  try {
    const res = await fetch(`${API}/api/report-schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadReportSchedules();
  } catch (e) { alert(I18N.t('rs.deleteFailed') + e.message); }
}

// Ph.2 — "▶ Run Now" button in schedule list
async function runReportNow(id, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(`${API}/api/report-schedules/${id}/run`, { method: 'POST' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    showToast({ icon: '▶', title: I18N.t('rh.runQueued'), sub: I18N.t('rh.runQueuedSub') });
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
    showToast({ icon: '▶', title: I18N.t('rh.runFailed') + e.message });
  }
}

// ============================================================
// Ph.2 — Report History
// ============================================================

let _rhOffset = 0;
const _RH_LIMIT = 50;

// ── Report History Stats Summary ─────────────────────────────
let _rhStatsWindow = '30d';

async function loadReportHistoryStats(win) {
  if (win) _rhStatsWindow = win;
  const el = document.getElementById('rhStatsSummary');
  if (!el) return;
  el.innerHTML = `<div style="font-size:11px;color:var(--dim);padding:6px 0">${escapeHtml(I18N.t('rh.statLoading'))}</div>`;
  try {
    const res = await fetch(`${API}/api/report-history/stats?window=${_rhStatsWindow}`, { cache: 'no-store' });
    const data = await res.json();
    el.innerHTML = renderReportHistoryStats(data);
  } catch {
    el.innerHTML = `<div style="font-size:11px;color:var(--red);padding:6px 0">${escapeHtml(I18N.t('rh.statError'))}</div>`;
  }
}

function renderReportHistoryStats(d) {
  const rate = d.success_rate != null ? `${d.success_rate}%` : '—';
  const bt = d.by_type || {};

  const card = (color, num, label, sub = '') => `
    <div style="background:var(--panel);border:1px solid ${color};border-radius:8px;padding:10px 14px;min-width:0">
      <div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${num.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text);margin-top:3px">${label}</div>
      ${sub ? `<div style="font-size:10px;color:var(--dim);margin-top:1px">${sub}</div>` : ''}
    </div>`;

  const winBtn = (w, label) => `
    <button data-action="loadRhStats" data-window="${w}"
      style="padding:3px 10px;font-size:10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;
             background:${_rhStatsWindow === w ? 'var(--accent)' : 'var(--panel2)'};
             color:${_rhStatsWindow === w ? '#fff' : 'var(--dim)'};white-space:nowrap">
      ${escapeHtml(label)}
    </button>`;

  const typeChip = (label, count) => count > 0
    ? `<span style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:2px 8px;font-size:10px;white-space:nowrap">${escapeHtml(label)} <strong>${count}</strong></span>`
    : '';

  const typeRow = [
    typeChip('Daily',   bt.daily   || 0),
    typeChip('Weekly',  bt.weekly  || 0),
    typeChip('Monthly', bt.monthly || 0),
    typeChip('Health',  bt.health  || 0),
  ].filter(Boolean).join(' ');

  return `
    <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div style="font-size:11px;font-weight:600;color:var(--dim)">Summary</div>
        <div style="display:flex;gap:5px">
          ${winBtn('30d', I18N.t('rh.win30d'))}
          ${winBtn('90d', I18N.t('rh.win90d'))}
          ${winBtn('all', I18N.t('rh.winAll'))}
        </div>
      </div>
      <div class="rh-stats-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        ${card('var(--green)', d.success || 0, escapeHtml(I18N.t('rh.statSuccess')), `${rate} ${escapeHtml(I18N.t('rh.statSuccessRate'))}`)}
        ${card('var(--red)',   d.failed  || 0, escapeHtml(I18N.t('rh.statFailed')))}
        ${card('var(--accent)',d.total_recipients_sent || 0, escapeHtml(I18N.t('rh.statRecipients')))}
      </div>
      ${typeRow ? `<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        <span style="font-size:10px;color:var(--dim);margin-right:2px">${escapeHtml(I18N.t('rh.statByType'))}:</span>
        ${typeRow}
      </div>` : ''}
    </div>`;
}

async function loadReportHistory(offset) {
  if (!offset) loadReportHistoryStats();
  _rhOffset = offset || 0;
  const el = document.getElementById('rhList');
  if (!el) return;
  el.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('common.loading'))}</td></tr>`;
  try {
    const res = await fetch(`${API}/api/report-history?limit=${_RH_LIMIT}&offset=${_rhOffset}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items, total } = await res.json();
    renderReportHistory(items, total);
  } catch (e) {
    el.innerHTML = `<tr><td colspan="6" style="padding:12px;color:var(--red)">${escapeHtml(I18N.t('rh.loadFailed'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderReportHistory(items, total) {
  const el = document.getElementById('rhList');
  if (!items.length) {
    el.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('rh.noHistory'))}</td></tr>`;
    document.getElementById('rhPager').innerHTML = '';
    return;
  }
  const _RS_TYPE = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly') };
  const _RS_LAYOUT = { compact: I18N.t('rs.layoutCompact'), full: I18N.t('rs.layoutFull') };
  el.innerHTML = items.map(row => {
    const ts = new Date(row.created_at).toLocaleString('th-TH', { hour12: false });
    const statusBadge = row.status === 'success'
      ? `<span style="color:var(--green)">✓ ${escapeHtml(I18N.t('rs.statusSuccess'))}</span>`
      : `<span style="color:var(--red)" title="${escapeHtml(row.error_message || '')}">✗ ${escapeHtml(row.status)}</span>`;
    const pngBtn = row.file_path
      ? `<a href="${API}/api/report-history/${row.id}/image" class="csv-btn" style="font-size:10px;text-decoration:none" title="${escapeHtml(I18N.t('rh.downloadPng'))}">⬇ PNG</a>`
      : `<span style="color:var(--dim);font-size:10px">—</span>`;
    const sentInfo = row.status === 'success'
      ? `${row.sent_count}/${row.total_recipients}`
      : `<span style="color:var(--dim)">—</span>`;
    return `<tr>
      <td style="padding:5px 8px;white-space:nowrap">${escapeHtml(ts)}</td>
      <td style="text-align:center">${escapeHtml(_RS_TYPE[row.report_type] || row.report_type)}</td>
      <td style="text-align:center">${escapeHtml(_RS_LAYOUT[row.image_layout] || row.image_layout || '—')}</td>
      <td style="text-align:center">${sentInfo}</td>
      <td style="text-align:center">${statusBadge}</td>
      <td style="text-align:right">${pngBtn}</td>
    </tr>`;
  }).join('');
  // pager
  const pager = document.getElementById('rhPager');
  const pages = Math.ceil(total / _RH_LIMIT);
  const cur = Math.floor(_rhOffset / _RH_LIMIT);
  pager.innerHTML = `<span style="font-size:11px;color:var(--dim)">${total} ${escapeHtml(I18N.t('rh.rows'))}</span>` +
    (cur > 0 ? `<button class="csv-btn" data-action="loadReportHistory" data-offset="${(cur-1)*_RH_LIMIT}">‹ ${escapeHtml(I18N.t('rh.prev'))}</button>` : '') +
    `<span style="font-size:11px">${cur+1} / ${pages}</span>` +
    (cur < pages-1 ? `<button class="csv-btn" data-action="loadReportHistory" data-offset="${(cur+1)*_RH_LIMIT}">${escapeHtml(I18N.t('rh.next'))} ›</button>` : '');
}

async function exportReportHistoryCsv() {
  try {
    const res = await fetch(`${API}/api/report-history?limit=200&offset=0`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items } = await res.json();
    const header = ['id','created_at','report_type','image_layout','range_from','range_to','status','sent_count','total_recipients','recipients_sent','error_message','file_path'];
    const rows = items.map(r => header.map(k => JSON.stringify(r[k] ?? '')).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_history_${new Date().toLocaleDateString('sv')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert(I18N.t('rh.exportFailed') + e.message); }
}

// ============================================================
// Camera Settings Modal (existing)
// ============================================================

// ── Camera form mini-map (OpenLayers) ───────────────────────
let _camFormMap = null;
let _camFormMarker = null;
const _CAM_FORM_DEFAULT_CENTER = [100.5018, 13.7563]; // Bangkok fallback

function _camFormMapCenter() {
  // Best center: first camera with coords, else Bangkok
  const cam = cameras.find(c => c.latitude && c.longitude);
  return cam ? [parseFloat(cam.longitude), parseFloat(cam.latitude)] : _CAM_FORM_DEFAULT_CENTER;
}

function initCamFormMap(lat, lng) {
  if (_camFormMap) destroyCamFormMap();
  const container = document.getElementById('camFormMapContainer');
  if (!container || typeof ol === 'undefined') return;

  const hasCoord = lat != null && lng != null && lat !== '' && lng !== '';
  const center = hasCoord
    ? ol.proj.fromLonLat([parseFloat(lng), parseFloat(lat)])
    : ol.proj.fromLonLat(_camFormMapCenter());
  const zoom = hasCoord ? 16 : 12;

  const markerFeature = new ol.Feature({ geometry: new ol.geom.Point(center) });
  markerFeature.setId('camFormPin');

  _camFormMarker = new ol.layer.Vector({
    source: new ol.source.Vector({ features: [markerFeature] }),
    style: new ol.style.Style({
      image: new ol.style.Circle({
        radius: 8,
        fill: new ol.style.Fill({ color: token('--accent') }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
      }),
    }),
  });
  if (!hasCoord) _camFormMarker.setVisible(false);

  _camFormMap = new ol.Map({
    target: container,
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM() }),
      _camFormMarker,
    ],
    view: new ol.View({ center, zoom }),
    controls: ol.control.defaults.defaults({ attribution: false, zoom: true, rotate: false }),
  });

  _camFormMap.on('click', function (e) {
    const [lon, lat] = ol.proj.toLonLat(e.coordinate);
    document.getElementById('frmCamLat').value = lat.toFixed(6);
    document.getElementById('frmCamLng').value = lon.toFixed(6);
    _camFormSetMarker(e.coordinate);
  });
}

function _camFormSetMarker(coord) {
  if (!_camFormMarker) return;
  const src = _camFormMarker.getSource();
  src.getFeatureById('camFormPin').setGeometry(new ol.geom.Point(coord));
  _camFormMarker.setVisible(true);
}

function destroyCamFormMap() {
  if (_camFormMap) { _camFormMap.setTarget(null); _camFormMap = null; _camFormMarker = null; }
}

function onCamCoordInput() {
  const lat = parseFloat(document.getElementById('frmCamLat').value);
  const lng = parseFloat(document.getElementById('frmCamLng').value);
  if (!_camFormMap || isNaN(lat) || isNaN(lng)) return;
  const coord = ol.proj.fromLonLat([lng, lat]);
  _camFormSetMarker(coord);
  _camFormMap.getView().setCenter(coord);
}

function camFormUseMyLocation() {
  const msg = document.getElementById('camFormMapMsg');
  if (!navigator.geolocation) { if (msg) { msg.style.color = 'var(--amber)'; msg.textContent = I18N.t('cs.locationDenied'); } return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById('frmCamLat').value = lat;
      document.getElementById('frmCamLng').value = lng;
      if (msg) msg.textContent = '';
      onCamCoordInput();
    },
    () => { if (msg) { msg.style.color = 'var(--amber)'; msg.textContent = I18N.t('cs.locationDenied'); } }
  );
}
// ── end mini-map ─────────────────────────────────────────────

// ── Camera HTTP password show/hide ───────────────────────────
function toggleCamPassVisibility() {
  const inp = document.getElementById('frmCamPass');
  const btn = document.getElementById('frmCamPassToggle');
  if (!inp || !btn) return;
  const showing = inp.type === 'text';
  inp.type = showing ? 'password' : 'text';
  btn.textContent = showing ? I18N.t('cs.showPass') : I18N.t('cs.hidePass');
}

// ── MQTT credentials display (Bosch only) ────────────────────
let _mqttFormCreds = { username: null, password: null };
let _mqttRegenClearTimer = null;
let _mqttPassVisible = false;

function toggleMqttPassVisibility() {
  const span = document.getElementById('mqttCredsPassVal');
  const btn  = document.getElementById('mqttPassToggleBtn');
  if (!span || !btn) return;
  _mqttPassVisible = !_mqttPassVisible;
  span.textContent  = _mqttPassVisible ? (_mqttFormCreds.password || '—') : '••••••••••••••••';
  span.style.color  = _mqttPassVisible ? 'var(--warn)' : 'var(--dim)';
  btn.textContent   = _mqttPassVisible ? I18N.t('cs.hidePass') : I18N.t('cs.showPass');
}

function _resetMqttPassDisplay() {
  _mqttPassVisible = false;
  const span = document.getElementById('mqttCredsPassVal');
  if (span) { span.textContent = '••••••••••••••••'; span.style.color = 'var(--dim)'; }
  const btn = document.getElementById('mqttPassToggleBtn');
  if (btn) btn.textContent = I18N.t('cs.showPass');
}

function _showMqttCreds(cam, brokerHost, pending) {
  const section = document.getElementById('frmMqttCredsSection');
  if (!section) return;
  const isBosch = (cam.vendor || 'bosch').toLowerCase() === 'bosch';
  const hasCreds = isBosch && cam.mqtt_username;
  const showPending = isBosch && !hasCreds && pending;

  // Clear any lingering regen result from a previous form open
  const regenResult = document.getElementById('mqttRegenResult');
  if (regenResult) regenResult.style.display = 'none';
  const regenPassEl = document.getElementById('mqttRegenPassVal');
  if (regenPassEl) regenPassEl.textContent = '';
  if (_mqttRegenClearTimer) { clearTimeout(_mqttRegenClearTimer); _mqttRegenClearTimer = null; }
  _resetMqttPassDisplay();

  if (!hasCreds && !showPending) { section.style.display = 'none'; _mqttFormCreds = { username: null, password: null }; return; }
  section.style.display = '';
  const pendingMsg = document.getElementById('mqttPendingMsg');
  if (pendingMsg) pendingMsg.style.display = showPending ? '' : 'none';
  if (!hasCreds) { _mqttFormCreds = { username: null, password: null }; return; }

  _mqttFormCreds = { username: cam.mqtt_username, password: cam.mqtt_password || null };
  const host = brokerHost || cam.mqtt_broker_host || '?';
  document.getElementById('mqttCredsHost').textContent = `${host} : 1883`;
  document.getElementById('mqttCredsUser').textContent = cam.mqtt_username;
}

function copyMqttCreds(field) {
  const val = field === 'user' ? _mqttFormCreds.username : _mqttFormCreds.password;
  const msg = document.getElementById('mqttCopyMsg');
  if (!val) { if (msg) { msg.style.color = 'var(--amber)'; msg.textContent = '—'; setTimeout(() => { if (msg) msg.textContent = ''; }, 1500); } return; }
  navigator.clipboard.writeText(val).then(() => {
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = I18N.t('cs.mqttCopied'); setTimeout(() => { if (msg) msg.textContent = ''; }, 2000); }
  }).catch(() => {
    if (msg) { msg.style.color = 'var(--amber)'; msg.textContent = val; }
  });
}
async function regenerateMqttPassword() {
  const camId = document.getElementById('frmCamId')?.value?.trim();
  if (!camId) return;
  if (!confirm(I18N.t('cs.mqttRegenConfirm'))) return;

  const btn = document.getElementById('mqttRegenBtn');
  const result = document.getElementById('mqttRegenResult');
  const passEl = document.getElementById('mqttRegenPassVal');
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('cs.mqttRegenWorking'); }
  if (result) result.style.display = 'none';

  try {
    const res = await fetch(`${API}/api/cameras/${encodeURIComponent(camId)}/mqtt/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    if (passEl) passEl.textContent = data.mqtt_password;
    if (result) result.style.display = '';

    if (_mqttRegenClearTimer) clearTimeout(_mqttRegenClearTimer);
    _mqttRegenClearTimer = setTimeout(() => {
      if (passEl) passEl.textContent = '';
      if (result) result.style.display = 'none';
      _mqttRegenClearTimer = null;
    }, 60_000);

    const copyMsg = document.getElementById('mqttCopyMsg');
    if (copyMsg) { copyMsg.style.color = 'var(--status-ok)'; copyMsg.textContent = I18N.t('cs.mqttCopied'); setTimeout(() => { if (copyMsg) copyMsg.textContent = ''; }, 2000); }
  } catch (err) {
    alert(I18N.t('cs.mqttRegenErr') + ': ' + escapeHtml(err.message));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = I18N.t('cs.mqttRegenBtn'); }
  }
}

function copyMqttRegenPass() {
  const val = document.getElementById('mqttRegenPassVal')?.textContent;
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => {
    const msg = document.getElementById('mqttCopyMsg');
    if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('cs.mqttCopied'); setTimeout(() => { if (msg) msg.textContent = ''; }, 2000); }
  });
}

// ── end MQTT creds ────────────────────────────────────────────

// ── Inline field validation ───────────────────────────────────
function _setCamFieldWarn(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
}

function onCamIdBlur() {
  const fld = document.getElementById('frmCamId');
  if (!fld || fld.disabled) return; // edit mode — same ID is valid
  const val = (fld.value || '').trim().toLowerCase();
  if (!val) return _setCamFieldWarn('warnCamId', '');
  const dup = cameras.find(c => c.camera_id.toLowerCase() === val);
  _setCamFieldWarn('warnCamId', dup ? I18N.t('cs.warnDupId').replace('{id}', dup.camera_id) : '');
}

function onCamIpBlur() {
  const ip = (document.getElementById('frmCamIp')?.value || '').trim();
  if (!ip) return _setCamFieldWarn('warnCamIp', '');
  const valid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  _setCamFieldWarn('warnCamIp', valid ? '' : I18N.t('cs.warnBadIp'));
}

function _clearFormExtras() {
  _setCamFieldWarn('warnCamId', '');
  _setCamFieldWarn('warnCamIp', '');
  const tcr = document.getElementById('frmTestConnResult');
  if (tcr) tcr.textContent = '';
  const piw = document.getElementById('frmSnapPreviewImgWrap');
  if (piw) piw.style.display = 'none';
  const pm = document.getElementById('frmSnapPreviewMsg');
  if (pm) pm.textContent = '';
  // reset camera password visibility on every form open/edit
  const pi = document.getElementById('frmCamPass');
  if (pi) pi.type = 'password';
  const pb = document.getElementById('frmCamPassToggle');
  if (pb) pb.textContent = I18N.t('cs.showPass');
}

// ── Test Connection ───────────────────────────────────────────
async function testCameraConnection() {
  const ip     = (document.getElementById('frmCamIp')?.value || '').trim();
  const vendor = document.getElementById('frmCamVendor')?.value || 'bosch';
  const port   = document.getElementById('frmCamHttpPort')?.value || '';
  const user   = (document.getElementById('frmCamUser')?.value || '').trim();
  const pass   = document.getElementById('frmCamPass')?.value || '';
  const btn    = document.getElementById('frmTestConnBtn');
  const result = document.getElementById('frmTestConnResult');
  if (!ip) { alert(I18N.t('cs.probeNeedIp')); return; }
  result.textContent = ''; result.style.color = 'var(--dim)';
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await fetch(`${API}/api/cameras/test-connection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip_address: ip, http_port: port, vendor, username: user, password: pass }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    if (!r.reachable) {
      result.style.color = 'var(--red)';
      result.textContent = I18N.t('cs.connFail');
    } else if (r.auth_status === 'failed') {
      result.style.color = 'var(--amber)';
      result.textContent = I18N.t('cs.connReachAuthFail').replace('{ms}', r.latency_ms);
    } else {
      result.style.color = 'var(--green)';
      result.textContent = I18N.t('cs.connOk').replace('{ms}', r.latency_ms);
    }
  } catch (e) {
    result.style.color = 'var(--red)'; result.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = I18N.t('cs.testConnBtn');
  }
}

// ── Live Snapshot Preview ────────────────────────────────────
async function previewCameraSnapshot() {
  const vendor   = document.getElementById('frmCamVendor')?.value || 'onvif';
  const ip       = (document.getElementById('frmCamIp')?.value || '').trim();
  const port     = document.getElementById('frmCamHttpPort')?.value || '';
  const user     = (document.getElementById('frmCamUser')?.value || '').trim();
  const pass     = document.getElementById('frmCamPass')?.value || '';
  const snapPath = (document.getElementById('frmCamSnapPath')?.value || '').trim();
  const btn      = document.getElementById('frmSnapPreviewBtn');
  const msg      = document.getElementById('frmSnapPreviewMsg');
  const imgWrap  = document.getElementById('frmSnapPreviewImgWrap');
  const img      = document.getElementById('frmSnapPreviewImg');
  if (!ip) { alert(I18N.t('cs.probeNeedIp')); return; }
  btn.disabled = true; btn.textContent = I18N.t('cs.previewing');
  msg.textContent = ''; msg.style.color = 'var(--dim)';
  imgWrap.style.display = 'none';
  try {
    const res = await fetch(`${API}/api/cameras/snapshot-preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor, ip_address: ip, http_port: port, username: user, password: pass, snapshot_path: snapPath }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    if (r.found && r.image_base64) {
      img.src = `data:image/jpeg;base64,${r.image_base64}`;
      imgWrap.style.display = '';
      msg.style.color = 'var(--green)'; msg.textContent = r.snapshot_path || '';
      // Auto-fill snapshot path field if it was empty
      const spFld = document.getElementById('frmCamSnapPath');
      if (spFld && !snapPath && r.snapshot_path) {
        spFld.value = r.snapshot_path; spFld.disabled = false;
        const pmsg = document.getElementById('frmCamProbeMsg');
        if (pmsg) { pmsg.style.color = 'var(--green)'; pmsg.textContent = I18N.t('cs.probeFound').replace('{path}', r.snapshot_path); }
      }
    } else {
      msg.style.color = 'var(--amber)'; msg.textContent = I18N.t('cs.previewNotFound');
    }
  } catch (e) {
    msg.style.color = 'var(--red)'; msg.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = I18N.t('cs.previewBtn');
  }
}
// ── end Idea 4 helpers ───────────────────────────────────────

// The ⚙️ top-bar gear button still calls openSettings() — camera settings
// is now a full SPA page, not a modal, so just navigate there.
function openSettings() {
  const nav = document.querySelector('.nav-item[data-page="settings"]');
  showPage('settings', nav || undefined);
}
function closeSettings() { closeCameraForm(); }

function renderAdminCameras() {
  const host = document.getElementById('adminCameraRows');
  if (!host) return;
  host.innerHTML = cameras.map(c => {
    const v = String(c.vendor || 'bosch').toLowerCase();
    return `
    <div class="cam-list-row">
      <div>
        <div style="font-weight:600">${escapeHtml(c.camera_name || c.camera_id)}</div>
        <div style="font-size:10px;color:var(--dim)">${escapeHtml(c.camera_id)} · ${escapeHtml(c.ip_address || '—')}</div>
      </div>
      <div><span class="vendor-badge v-${v}">${escapeHtml(VENDOR_LABEL[v] || v)}</span></div>
      <div style="font-size:11px">${escapeHtml(c.location || '—')}</div>
      <div>
        ${c.status === 'paused'
          ? `<span class="badge badge-paused"><svg width="10" height="10" aria-hidden="true" style="vertical-align:-1px;margin-right:3px"><use href="#icon-pause"/></svg>${escapeHtml(I18N.t('cam.paused'))}</span>`
          : `<span class="badge ${c.status === 'online' ? 'badge-online' : 'badge-offline'}">${c.status === 'online' ? 'ON' : 'OFF'}</span>`}
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-secondary" style="padding:4px 8px;font-size:10px" data-action="editCamera" data-camera-id="${c.camera_id}">${escapeHtml(I18N.t('common.edit'))}</button>
        <button class="btn ${c.status === 'paused' ? 'btn-secondary' : 'btn-warning'}" style="padding:4px 8px;font-size:10px" data-action="toggleCamPause" data-camera-id="${c.camera_id}" data-pause-state="${c.status !== 'paused'}" title="${c.status === 'paused' ? escapeHtml(I18N.t('cam.resumeBtn')) : escapeHtml(I18N.t('cam.pauseBtn'))}"><svg width="10" height="10" aria-hidden="true"><use href="#icon-pause"/></svg> ${c.status === 'paused' ? escapeHtml(I18N.t('cam.resumeBtn')) : escapeHtml(I18N.t('cam.pauseBtn'))}</button>
        <button class="btn btn-danger" style="padding:4px 8px;font-size:10px" data-action="deleteCamera" data-camera-id="${c.camera_id}">${escapeHtml(I18N.t('common.delete'))}</button>
      </div>
    </div>`;
  }).join('') || `<div style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('cs.noCameras'))}</div>`;
}

// Show/hide vendor-specific field groups in the camera form. ONVIF is
// monitor-only (no Media Capture); VCA overlay is Bosch-only; the
// snapshot-stream selector is Hikvision/Dahua; the snapshot URL path is
// for the generic-HTTP vendors (Dahua/ONVIF).
function onVendorChange() {
  const v = (document.getElementById('frmCamVendor').value || 'bosch').toLowerCase();
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('frmMediaSection',     v !== 'onvif');
  show('frmMonitorNote',      v === 'onvif');
  show('frmVcaOverlayGroup',  v === 'bosch');
  // client-side overlay (migration 043) — มีผลเฉพาะ vendor ที่ส่งพิกัดใน payload
  show('frmOverlayBboxGroup', v === 'hikvision' || v === 'dahua');
  show('frmOverlayZoneGroup', v === 'hikvision' || v === 'dahua');
  show('frmSnapStreamGroup',  v === 'hikvision' || v === 'dahua');
  show('frmCamSnapPathGroup', v === 'dahua' || v === 'onvif');
  _resetSnapProbeUI();
  updateDahuaSnapNote();
}

// Dahua: the event snapshot is extracted from the internal RTSP buffer
// (media-recorder runs it whenever snapshot OR clip is enabled — see
// recorderNeeded() server-side). Surface that so the operator knows
// "Snapshot capture" works WITHOUT also enabling "Pre-alarm Video Clip".
function updateDahuaSnapNote() {
  const vEl = document.getElementById('frmCamVendor');
  const snEl = document.getElementById('frmCamEnableSnapshot');
  const note = document.getElementById('frmDahuaSnapNote');
  if (!vEl || !snEl || !note) return;
  const isDahua = (vEl.value || 'bosch').toLowerCase() === 'dahua';
  note.style.display = (isDahua && snEl.checked) ? '' : 'none';
}

// The Snapshot URL Path field stays LOCKED until either auto-detect fills
// it or the operator unlocks it (on a not-found). An existing camera that
// already has a path opens editable. Called by onVendorChange (covers
// add / edit / vendor-switch).
function _resetSnapProbeUI() {
  const fld = document.getElementById('frmCamSnapPath');
  const msg = document.getElementById('frmCamProbeMsg');
  if (!fld) return;
  fld.disabled = !fld.value;
  if (msg) {
    msg.style.color = 'var(--dim)';
    msg.textContent = fld.value
      ? I18N.t('cs.snapPathCurrent')
      : I18N.t('cs.probeMsg');
  }
}

// Probe the camera for a working snapshot URL. Found → fill + unlock the
// field (so it can be tweaked). Not found → unlock for manual entry +
// amber hint. Reads IP / port / credentials straight from the open form.
async function probeCameraSnapshot() {
  const vendor = document.getElementById('frmCamVendor').value;
  const ip   = document.getElementById('frmCamIp').value.trim();
  const port = document.getElementById('frmCamHttpPort').value || '';
  const user = document.getElementById('frmCamUser').value.trim();
  const pass = document.getElementById('frmCamPass').value;
  const btn = document.getElementById('frmCamProbeBtn');
  const msg = document.getElementById('frmCamProbeMsg');
  const fld = document.getElementById('frmCamSnapPath');
  if (!ip) { alert(I18N.t('cs.probeNeedIp')); return; }
  btn.disabled = true; btn.textContent = I18N.t('cs.probing');
  msg.style.color = 'var(--dim)'; msg.textContent = I18N.t('cs.probingCamera');
  try {
    const res = await fetch(`${API}/api/cameras/probe-snapshot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor, ip_address: ip, http_port: port, username: user, password: pass }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    if (r.found) {
      fld.value = r.snapshot_path;
      fld.disabled = false;
      msg.style.color = 'var(--green)';
      msg.textContent = I18N.t('cs.probeFound').replace('{path}', r.snapshot_path);
    } else {
      fld.disabled = false;
      fld.value = '';
      fld.focus();
      msg.style.color = 'var(--amber)';
      msg.textContent = I18N.t('cs.probeNotFound');
    }
  } catch (e) {
    fld.disabled = false;
    msg.style.color = 'var(--amber)';
    msg.textContent = I18N.t('cs.probeError').replace('{e}', e.message);
  } finally {
    btn.disabled = false; btn.textContent = I18N.t('cs.probeBtn');
  }
}

function openCameraForm() {
  document.getElementById('formTitle').textContent = I18N.t('cs.formAddTitle');
  document.getElementById('cameraForm').classList.remove('hidden');
  ['frmCamId','frmCamName','frmCamIp','frmCamLoc','frmCamUser','frmCamPass','frmCamLat','frmCamLng','frmCamNotes',
   'frmCamHttpPort','frmCamClipStream','frmCamSnapshotStream','frmCamSnapPath','frmCamFullViewWidth']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('frmCamVendor').value = 'bosch';
  // Phase 6.1 — sensible defaults for new camera
  document.getElementById('frmCamEnableSnapshot').checked    = true;
  document.getElementById('frmCamEnableVcaOverlay').checked  = true;
  document.getElementById('frmCamEnableClipCapture').checked = false;
  document.getElementById('frmCamOverlayBbox').checked       = true;
  document.getElementById('frmCamOverlayZone').checked       = true;
  document.getElementById('frmCamClipPre').value  = 10;
  document.getElementById('frmCamClipPost').value = 5;
  document.getElementById('frmCamId').disabled = false;
  // Hide offline alert + MQTT creds sections for new cameras; clear extras
  const oas = document.getElementById('frmOfflineAlertSection');
  if (oas) oas.style.display = 'none';
  _offlineAlertCameraId = null;
  _showMqttCreds({ vendor: 'bosch' }, null, false);
  _clearFormExtras();
  onVendorChange();
  document.getElementById('cameraForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  initCamFormMap(null, null);
}

function editCamera(id) {
  const c = cameras.find(x => x.camera_id === id);
  if (!c) return;
  document.getElementById('formTitle').textContent = I18N.t('cs.formEditTitle').replace('{id}', id);
  document.getElementById('cameraForm').classList.remove('hidden');
  document.getElementById('frmCamId').value = c.camera_id;
  document.getElementById('frmCamId').disabled = true;
  document.getElementById('frmCamName').value = c.camera_name || '';
  document.getElementById('frmCamVendor').value = (c.vendor || 'bosch').toLowerCase();
  document.getElementById('frmCamIp').value = c.ip_address || '';
  document.getElementById('frmCamHttpPort').value = c.http_port || '';
  document.getElementById('frmCamClipStream').value = c.clip_stream || '';
  document.getElementById('frmCamSnapshotStream').value = c.snapshot_stream || '';
  document.getElementById('frmCamSnapPath').value = c.snapshot_path || '';
  document.getElementById('frmCamFullViewWidth').value = c.full_view_width || '';
  document.getElementById('frmCamLoc').value = c.location || '';
  document.getElementById('frmCamUser').value = c.username || '';
  document.getElementById('frmCamPass').value = c.password || '';
  document.getElementById('frmCamLat').value = c.latitude || '';
  document.getElementById('frmCamLng').value = c.longitude || '';
  document.getElementById('frmCamNotes').value = c.notes || '';
  // Phase 6.1 — media capture toggles (default-on for snapshot/overlay, default-off for clip)
  document.getElementById('frmCamEnableSnapshot').checked    = c.enable_snapshot    !== false;
  document.getElementById('frmCamEnableVcaOverlay').checked  = c.enable_vca_overlay !== false;
  document.getElementById('frmCamEnableClipCapture').checked = c.enable_clip_capture === true;
  document.getElementById('frmCamOverlayBbox').checked       = c.overlay_show_bbox  !== false;
  document.getElementById('frmCamOverlayZone').checked       = c.overlay_show_zone  !== false;
  document.getElementById('frmCamClipPre').value  = c.clip_pre_sec  ?? 10;
  document.getElementById('frmCamClipPost').value = c.clip_post_sec ?? 5;
  // Ph.1 — load offline alert config for this camera
  loadCameraOfflineAlert(id);
  // MQTT credentials (Bosch only) + clear extra states
  _showMqttCreds(c, null, false);
  _clearFormExtras();
  onVendorChange();
  document.getElementById('cameraForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  initCamFormMap(c.latitude, c.longitude);
}

function closeCameraForm() {
  document.getElementById('cameraForm').classList.add('hidden');
  const s = document.getElementById('frmOfflineAlertSection');
  if (s) s.style.display = 'none';
  destroyCamFormMap();
}

// ── Camera Settings sub-tabs: Cameras | Groups
function camerasSubTab(key, el) {
  // Deactivate all tabs + hide all panels
  document.querySelectorAll('#camSubTabBar .tab').forEach(t => t.classList.remove('active'));
  const panels = ['camSubPanelCameras', 'camSubPanelGroups'];
  panels.forEach(id => { const p = document.getElementById(id); if (p) p.style.display = 'none'; });

  if (key === 'groups') {
    (el || document.getElementById('camSubTabGroups'))?.classList.add('active');
    const panel = document.getElementById('camSubPanelGroups');
    if (panel) panel.style.display = '';
    renderGroupList(); showEditorPlaceholder();
  } else {
    (el || document.getElementById('camSubTabCameras'))?.classList.add('active');
    const panel = document.getElementById('camSubPanelCameras');
    if (panel) panel.style.display = '';
    closeCameraForm(); renderAdminCameras();
  }
}

// ── Camera Offline Alert config ───────────────────────────────
let _offlineAlertCameraId = null;

async function loadCameraOfflineAlert(cameraId) {
  _offlineAlertCameraId = cameraId;
  const s = document.getElementById('frmOfflineAlertSection');
  if (!s) return;
  s.style.display = '';
  const msg = document.getElementById('frmOfflineAlertMsg');
  if (msg) msg.textContent = I18N.t('co.loadingAlert');
  try {
    const r = await fetch(`${API}/api/camera-offline-alerts/${encodeURIComponent(cameraId)}`);
    if (!r.ok) { if (msg) msg.textContent = ''; return; }
    const cfg = await r.json();
    document.getElementById('frmOfflineEnabled').checked   = !!cfg.enabled;
    document.getElementById('frmOfflineNotifyAfter').value = cfg.notify_after_sec   || 300;
    const once = !!cfg.escalate_once;
    document.getElementById('frmOfflineEscalateOnce').checked = once;
    document.getElementById('frmOfflineEscalateRow').style.display = once ? 'none' : '';
    document.getElementById('frmOfflineEscalate').value    = cfg.escalate_interval_min || 60;
    document.getElementById('frmOfflineQuietFrom').value   = (cfg.quiet_from || '').slice(0, 5);
    document.getElementById('frmOfflineQuietTo').value     = (cfg.quiet_to   || '').slice(0, 5);
    if (msg) msg.textContent = '';
    // Render recipients checklist from approved LINE recipients
    const selected = String(cfg.recipient_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!lineConfigCache) {
      try {
        const lr = await fetch(`${API}/api/line-config`);
        lineConfigCache = await lr.json();
      } catch { lineConfigCache = { recipients: [] }; }
    }
    const roster = Array.isArray(lineConfigCache?.recipients) ? lineConfigCache.recipients : [];
    const cl = document.getElementById('frmOfflineRecipientsChecklist');
    if (cl) {
      cl.innerHTML = roster.length
        ? roster.map(rcp => `
          <label style="display:flex;align-items:center;gap:6px;padding:7px 4px;cursor:pointer;font-size:11px;min-width:0">
            <input type="checkbox" class="offlineRecipCheck" value="${escapeHtml(rcp.id)}" ${selected.includes(rcp.id) ? 'checked' : ''} style="flex-shrink:0">
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${rcp.type === 'group' ? '👥' : '👤'} ${escapeHtml(rcp.name || rcp.id)} <span style="color:var(--dim);font-family:monospace">${escapeHtml(String(rcp.id).slice(0, 12))}…</span></span>
          </label>`).join('')
        : `<div style="color:var(--dim);font-size:11px;padding:6px">${escapeHtml(I18N.t('co.noRecipientsConfig'))}</div>`;
    }
  } catch { if (msg) msg.textContent = ''; }
}

async function saveCameraOfflineAlert() {
  if (!_offlineAlertCameraId) return;
  const msg = document.getElementById('frmOfflineAlertMsg');
  const body = {
    enabled:               document.getElementById('frmOfflineEnabled').checked,
    notify_after_sec:      parseInt(document.getElementById('frmOfflineNotifyAfter').value, 10) || 300,
    escalate_once:         document.getElementById('frmOfflineEscalateOnce').checked,
    escalate_interval_min: parseInt(document.getElementById('frmOfflineEscalate').value, 10)    || 60,
    quiet_from:            document.getElementById('frmOfflineQuietFrom').value || null,
    quiet_to:              document.getElementById('frmOfflineQuietTo').value   || null,
    recipient_ids:         [...document.querySelectorAll('.offlineRecipCheck:checked')].map(c => c.value).join(','),
  };
  try {
    const r = await fetch(`${API}/api/camera-offline-alerts/${encodeURIComponent(_offlineAlertCameraId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (msg) msg.textContent = r.ok ? I18N.t('co.savedAlert') : '❌ ' + ((await r.json()).error || 'Error');
    if (r.ok) setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
  } catch (e) { if (msg) msg.textContent = '❌ ' + e.message; }
}

function toggleEscalateOnce() {
  const once = document.getElementById('frmOfflineEscalateOnce').checked;
  document.getElementById('frmOfflineEscalateRow').style.display = once ? 'none' : '';
}

// ── Status Log ───────────────────────────────────────────────
let _statusLogPage = 1;
let _statusCurrentPage = 1;
let _imageQualityPage = 1;
let _cameraStatusTab = 'current';
const STATUS_CURRENT_LIMIT = 25;

function populateCameraFilter(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel || sel.options.length > 1 || cameras.length === 0) return;
  cameras.forEach(c => {
    const o = document.createElement('option');
    o.value = c.camera_id;
    o.textContent = c.camera_name || c.camera_id;
    sel.appendChild(o);
  });
}

function setCameraStatusTab(tab, el) {
  _cameraStatusTab = tab || 'current';
  document.querySelectorAll('#hist-camera-status [data-camera-status-tab]').forEach(b => b.classList.remove('active'));
  (el || document.querySelector(`#hist-camera-status [data-camera-status-tab="${_cameraStatusTab}"]`))?.classList.add('active');
  document.querySelectorAll('#hist-camera-status .camera-status-pane').forEach(pane => {
    pane.style.display = pane.id === `camera-status-pane-${_cameraStatusTab}` ? '' : 'none';
  });
  if (_cameraStatusTab === 'current') {
    loadStatusCurrent();
  } else if (_cameraStatusTab === 'status-log') {
    loadStatusLog(1);
  } else if (_cameraStatusTab === 'image-quality') {
    loadImageQualityLog(1);
  }
}

function statusDateLabel(value) {
  return value ? new Date(value).toLocaleString('th-TH', { hour12: false }) : '—';
}

function statusDurationLabel(sec) {
  if (sec === null || sec === undefined || Number.isNaN(Number(sec))) return '—';
  const n = Math.max(0, Number(sec));
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`;
}

function setStatusCurrentPage(page) {
  _statusCurrentPage = Math.max(1, parseInt(page, 10) || 1);
  loadStatusCurrent();
}

function resetStatusCurrentPage() {
  _statusCurrentPage = 1;
  loadStatusCurrent();
}

function resetStatusCurrentFilters() {
  const filter = document.getElementById('statusCurrentFilter');
  const search = document.getElementById('statusCurrentSearch');
  if (filter) filter.value = '';
  if (search) search.value = '';
  _statusCurrentPage = 1;
  loadStatusCurrent();
}

function resetStatusLogFilters() {
  const cam = document.getElementById('statusLogCamFilter');
  const status = document.getElementById('statusLogStatusFilter');
  if (cam) cam.value = '';
  if (status) status.value = '';
  _statusCurrentPage = 1;
  loadStatusLog(1);
}

async function loadStatusCurrent() {
  const host = document.getElementById('statusCurrentSummary');
  if (!host) return;
  try {
    const r = await fetch(`${API}/api/cameras/status-current`);
    if (!r.ok) throw new Error('API error');
    const data = await r.json();
    const allRows = data.cameras || [];
    const baseRows = allRows;
    const summary = data.summary || { total: baseRows.length, online: 0, offline: 0 };
    const filterEl = document.getElementById('statusCurrentFilter');
    const defaultFilter = summary.offline > 0 ? 'offline' : 'all';
    const statusFilter = filterEl && filterEl.value ? filterEl.value : defaultFilter;
    const searchRaw = ((document.getElementById('statusCurrentSearch') || {}).value || '').trim();
    const search = searchRaw.toLowerCase();
    let rows = baseRows.slice();
    if (statusFilter !== 'all') rows = rows.filter(c => c.status === statusFilter);
    if (search) {
      rows = rows.filter(c => [
        c.camera_id,
        c.camera_name,
        c.vendor,
      ].some(v => String(v || '').toLowerCase().includes(search)));
    }
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'offline' ? -1 : 1;
      if (a.status === 'offline') return Number(b.offline_for_sec || 0) - Number(a.offline_for_sec || 0);
      return String(a.camera_name || a.camera_id || '').localeCompare(String(b.camera_name || b.camera_id || ''));
    });
    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / STATUS_CURRENT_LIMIT));
    if (_statusCurrentPage > totalPages) _statusCurrentPage = totalPages;
    const pageStart = (_statusCurrentPage - 1) * STATUS_CURRENT_LIMIT;
    const pageRows = rows.slice(pageStart, pageStart + STATUS_CURRENT_LIMIT);

    const cameraRows = pageRows.length
      ? pageRows.map(c => {
        const online = c.status === 'online';
        return `<div class="status-current-grid status-current-row">
          <div class="status-current-camera">
            <div class="status-current-name">${escapeHtml(c.camera_name || c.camera_id)}</div>
            <div class="status-current-id">${escapeHtml(c.camera_id || '')}</div>
          </div>
          <div class="status-current-status ${online ? 'online' : 'offline'}" data-label="${escapeHtml(I18N.t('co.logStatus'))}">${escapeHtml(online ? I18N.t('co.statusOnline') : I18N.t('co.statusOffline'))}</div>
          <div class="status-current-value" data-label="${escapeHtml(I18N.t('co.lastSeen'))}">${escapeHtml(statusDateLabel(c.last_seen_at))}</div>
          <div class="status-current-value" data-label="${escapeHtml(I18N.t('co.offlineFor'))}">${escapeHtml(online ? '—' : statusDurationLabel(c.offline_for_sec))}</div>
          <div class="status-current-value" data-label="${escapeHtml(I18N.t('co.addedAt'))}">${escapeHtml(statusDateLabel(c.created_at))}</div>
          <div class="status-current-value" data-label="${escapeHtml(I18N.t('co.dataUpdatedAt'))}">${escapeHtml(statusDateLabel(c.updated_at))}</div>
          <div class="status-current-value" data-label="${escapeHtml(I18N.t('co.lastEventAt'))}">${escapeHtml(statusDateLabel(c.last_event_at))}</div>
        </div>`;
      }).join('')
      : `<div style="padding:12px;color:var(--dim);font-size:12px">${escapeHtml(I18N.t('co.noCurrentRows'))}</div>`;
    const currentPageInfo = I18N.t('co.currentPageInfo')
      .replace('{page}', _statusCurrentPage)
      .replace('{pages}', totalPages)
      .replace('{total}', totalRows);
    const currentPager = totalRows > STATUS_CURRENT_LIMIT
      ? `<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-secondary" style="font-size:11px" ${_statusCurrentPage <= 1 ? 'disabled' : ''} data-action="setStatusPage" data-page="${_statusCurrentPage - 1}">${escapeHtml(I18N.t('rh.prev'))}</button>
          <span style="font-size:11px;color:var(--dim)">${escapeHtml(currentPageInfo)}</span>
          <button class="btn btn-secondary" style="font-size:11px" ${_statusCurrentPage >= totalPages ? 'disabled' : ''} data-action="setStatusPage" data-page="${_statusCurrentPage + 1}">${escapeHtml(I18N.t('rh.next'))}</button>
        </div>`
      : `<div style="display:flex;justify-content:flex-end;margin-top:10px;font-size:11px;color:var(--dim)">${escapeHtml(currentPageInfo)}</div>`;

    host.innerHTML = `
      <div class="status-current-top">
        <div>
          <h3 style="font-size:14px;margin:0" data-i18n="co.currentTitle">${escapeHtml(I18N.t('co.currentTitle'))}</h3>
          <div style="font-size:11px;color:var(--dim);margin-top:3px">${escapeHtml(I18N.t('co.currentHint'))}</div>
        </div>
        <div class="status-current-badges">
          <span class="badge">${escapeHtml(I18N.t('co.total'))}: ${summary.total || 0}</span>
          <span class="badge badge-online">${escapeHtml(I18N.t('co.online'))}: ${summary.online || 0}</span>
          <span class="badge badge-offline">${escapeHtml(I18N.t('co.offline'))}: ${summary.offline || 0}</span>
        </div>
      </div>
      <div class="status-current-filters">
        <label class="form-label" style="margin:0">${escapeHtml(I18N.t('co.currentShow'))}</label>
        <select class="form-input" id="statusCurrentFilter" data-change="resetStatusPage" style="max-width:170px">
          <option value="offline" ${statusFilter === 'offline' ? 'selected' : ''}>${escapeHtml(I18N.t('co.currentOffline'))}</option>
          <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>${escapeHtml(I18N.t('co.currentAll'))}</option>
          <option value="online" ${statusFilter === 'online' ? 'selected' : ''}>${escapeHtml(I18N.t('co.currentOnline'))}</option>
        </select>
        <label class="form-label" style="margin:0">${escapeHtml(I18N.t('co.currentSearch'))}</label>
        <input class="form-input" id="statusCurrentSearch" value="${escapeHtml(searchRaw)}" placeholder="${escapeHtml(I18N.t('co.currentSearchPh'))}" data-action-enter="resetStatusPage" style="max-width:220px">
        <button class="btn btn-secondary" data-action="resetStatusPage" style="font-size:11px">${escapeHtml(I18N.t('co.currentApply'))}</button>
        <button class="btn btn-secondary" data-action="resetStatusFilts" style="font-size:11px">${escapeHtml(I18N.t('common.reset'))}</button>
      </div>
      <div class="status-current-table">
        <div class="status-current-grid status-current-head">
          <div>${escapeHtml(I18N.t('co.logCamera'))}</div>
          <div>${escapeHtml(I18N.t('co.logStatus'))}</div>
          <div>${escapeHtml(I18N.t('co.lastSeen'))}</div>
          <div>${escapeHtml(I18N.t('co.offlineFor'))}</div>
          <div>${escapeHtml(I18N.t('co.addedAt'))}</div>
          <div>${escapeHtml(I18N.t('co.dataUpdatedAt'))}</div>
          <div>${escapeHtml(I18N.t('co.lastEventAt'))}</div>
        </div>
        ${cameraRows}
      </div>
      ${currentPager}`;
  } catch {
    host.innerHTML = `<div style="padding:18px;color:var(--red);font-size:12px">${escapeHtml(I18N.t('co.currentLoadFailed'))}</div>`;
  }
}

async function loadStatusLog(page) {
  _statusLogPage = page || 1;
  const camId  = (document.getElementById('statusLogCamFilter') || {}).value || '';
  const status = (document.getElementById('statusLogStatusFilter') || {}).value || '';
  const limit  = 50;
  const offset = (_statusLogPage - 1) * limit;
  const qs     = new URLSearchParams({ limit, offset });
  if (camId) qs.set('camera_id', camId);
  if (status) qs.set('status', status);

  populateCameraFilter('statusLogCamFilter');

  const body = document.getElementById('statusLogBody');
  const pager = document.getElementById('statusLogPager');
  if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('co.loadingAlert'))}</td></tr>`;

  try {
    loadStatusCurrent();
    const r = await fetch(`${API}/api/cameras/status-log?${qs}`);
    if (!r.ok) throw new Error('API error');
    const rows  = await r.json();
    const total = parseInt(r.headers.get('X-Total-Count') || '0', 10);
    if (!body) return;
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('co.logEmpty'))}</td></tr>`;
    } else {
      body.innerHTML = rows.map(row => {
        const camName = (cameras.find(c => c.camera_id === row.camera_id) || {}).camera_name || row.camera_id;
        const statusLabel = row.status === 'online' ? I18N.t('co.logOnline') : I18N.t('co.logOffline');
        const dt = new Date(row.changed_at).toLocaleString('th-TH', { hour12: false });
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:7px 12px">${escapeHtml(camName)}</td>
          <td style="padding:7px 12px">${statusLabel}</td>
          <td style="padding:7px 12px;white-space:nowrap">${escapeHtml(dt)}</td>
          <td style="padding:7px 12px;font-size:11px;color:var(--dim)">${escapeHtml(row.reason || '—')}</td>
        </tr>`;
      }).join('');
    }
    renderPagination('statusLogPager', _statusLogPage, total, limit, (p) => loadStatusLog(p));
  } catch {
    if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--red)">Error loading status log</td></tr>`;
  }
}

function imageQualityTypeLabel(type) {
  if (String(type || '').startsWith('ImageTooBright/')) return I18N.t('co.iqBright');
  if (String(type || '').startsWith('ImageTooBlurry/')) return I18N.t('co.iqBlurry');
  if (String(type || '').startsWith('ImageTooDark/')) return I18N.t('co.iqDark');
  if (String(type || '').startsWith('GlobalSceneChange/')) return I18N.t('co.iqSceneChange');
  return type || '—';
}

function resetImageQualityFilters() {
  const cam = document.getElementById('iqCamFilter');
  const type = document.getElementById('iqTypeFilter');
  if (cam) cam.value = '';
  if (type) type.value = '';
  loadImageQualityLog(1);
}

async function loadImageQualityLog(page) {
  _imageQualityPage = page || 1;
  populateCameraFilter('iqCamFilter');
  const camId = (document.getElementById('iqCamFilter') || {}).value || '';
  const type = (document.getElementById('iqTypeFilter') || {}).value || '';
  const limit = 50;
  const offset = (_imageQualityPage - 1) * limit;
  const qs = new URLSearchParams({ limit, offset });
  if (camId) qs.set('camera_id', camId);
  if (type) qs.set('type', type);

  const body = document.getElementById('iqLogBody');
  if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('co.loadingAlert'))}</td></tr>`;

  try {
    const r = await fetch(`${API}/api/cameras/image-quality-log?${qs}`);
    if (!r.ok) throw new Error('API error');
    const rows = await r.json();
    const total = parseInt(r.headers.get('X-Total-Count') || '0', 10);
    if (!body) return;
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('co.iqEmpty'))}</td></tr>`;
    } else {
      body.innerHTML = rows.map(row => {
        const camName = (cameras.find(c => c.camera_id === row.camera_id) || {}).camera_name || row.camera_id;
        const active = row.event_state === true || row.event_state === 'true';
        const stateLabel = active ? I18N.t('co.iqStarted') : I18N.t('co.iqEnded');
        const stateColor = active ? 'var(--amber)' : 'var(--green)';
        const dt = new Date(row.event_time).toLocaleString('th-TH', { hour12: false });
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:7px 12px">${escapeHtml(camName)}</td>
          <td style="padding:7px 12px">${escapeHtml(imageQualityTypeLabel(row.event_type))}</td>
          <td style="padding:7px 12px;color:${stateColor};font-weight:700">${escapeHtml(stateLabel)}</td>
          <td style="padding:7px 12px;white-space:nowrap">${escapeHtml(dt)}</td>
        </tr>`;
      }).join('');
    }
    renderPagination('iqLogPager', _imageQualityPage, total, limit, (p) => loadImageQualityLog(p));
  } catch {
    if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--red)">${escapeHtml(I18N.t('co.iqLoadFailed'))}</td></tr>`;
  }
}

async function saveCamera() {
  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('cs.saving'); }
  const data = {
    camera_id: document.getElementById('frmCamId').value.trim(),
    camera_name: document.getElementById('frmCamName').value.trim(),
    vendor: document.getElementById('frmCamVendor').value,
    ip_address: document.getElementById('frmCamIp').value.trim(),
    http_port: document.getElementById('frmCamHttpPort').value || null,
    clip_stream: document.getElementById('frmCamClipStream').value || null,
    snapshot_stream: document.getElementById('frmCamSnapshotStream').value || null,
    snapshot_path: document.getElementById('frmCamSnapPath').value.trim(),
    full_view_width: document.getElementById('frmCamFullViewWidth').value || null,
    location: document.getElementById('frmCamLoc').value.trim(),
    username: document.getElementById('frmCamUser').value.trim(),
    password: document.getElementById('frmCamPass').value,
    latitude: document.getElementById('frmCamLat').value || null,
    longitude: document.getElementById('frmCamLng').value || null,
    notes: document.getElementById('frmCamNotes').value.trim(),
    // Phase 6.1 — media capture toggles
    enable_snapshot:     document.getElementById('frmCamEnableSnapshot').checked,
    enable_vca_overlay:  document.getElementById('frmCamEnableVcaOverlay').checked,
    enable_clip_capture: document.getElementById('frmCamEnableClipCapture').checked,
    overlay_show_bbox:   document.getElementById('frmCamOverlayBbox').checked,
    overlay_show_zone:   document.getElementById('frmCamOverlayZone').checked,
    clip_pre_sec:        parseInt(document.getElementById('frmCamClipPre').value, 10) || 10,
    clip_post_sec:       parseInt(document.getElementById('frmCamClipPost').value, 10) || 5,
  };
  if (!data.camera_id || !data.ip_address) {
    alert(I18N.t('cs.needIdIp'));
    if (btn) { btn.disabled = false; btn.textContent = I18N.t('common.save'); }
    return;
  }
  await _doSaveCamera(data, btn, /*force=*/false);
}

// Pulled out from saveCamera() so we can re-invoke with force=1 after the
// operator clicks through the warnings dialog. Backend (POST /api/cameras)
// returns 409 + a warnings[] array when the camera_id has invisible
// characters, isn't ASCII, or duplicates an existing IP. We surface those
// warnings + offer "ใช้ ID เดิม" / "ดำเนินการต่อ" / "ยกเลิก" — see decision
// #109 (hardware-replacement should reuse the existing camera_id).
async function _doSaveCamera(data, btn, force) {
  try {
    const url = force ? `${API}/api/cameras?force=1` : `${API}/api/cameras`;
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 409) {
      // Soft-warning path — show them, let operator decide.
      const r = await res.json();
      if (btn) { btn.disabled = false; btn.textContent = I18N.t('common.save'); }
      _showCameraWarnings(r.warnings || [], r.suggested_camera_id, data);
      return;
    }
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    await loadCameras();
    renderAdminCameras();

    // For Bosch cameras: stay in form so operator can copy MQTT credentials.
    // For all others: close as before.
    const savedCam = r.camera || {};
    const isBosch = (savedCam.vendor || 'bosch').toLowerCase() === 'bosch';
    if (isBosch) {
      // Switch form to edit-mode title (camera now exists in config)
      const fTitle = document.getElementById('formTitle');
      if (fTitle) fTitle.textContent = I18N.t('cs.formEditTitle').replace('{id}', savedCam.camera_id);
      const fId = document.getElementById('frmCamId');
      if (fId) fId.disabled = true;
      // Show MQTT credentials (use cameras[] if available, fallback to response body)
      const updatedCam = cameras.find(c => c.camera_id === savedCam.camera_id) || savedCam;
      _showMqttCreds(updatedCam, r.mqtt_broker_host, r.mqtt_status === 'pending');
    } else {
      closeCameraForm();
    }

    // Save offline-alert config in the same operation so the operator
    // doesn't need to click the separate alert-save button.
    if (_offlineAlertCameraId) await saveCameraOfflineAlert();

    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--green);color:white;padding:10px 18px;border-radius:8px;z-index:2000;font-weight:600';
    t.textContent = I18N.t('cs.saved').replace('{id}', data.camera_id);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = I18N.t('common.save'); } }
}

// Render a modal listing the backend's warnings + offer the operator
// three exits: use suggested id (most common — sanitised version),
// proceed anyway (force), or cancel.
function _showCameraWarnings(warnings, suggestedId, dataDraft) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2100;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
  const useExistingId = (warnings.find(w => w.code === 'duplicate_ip') || {}).existing_camera_id;
  const cardHtml = `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;max-width:560px;width:100%;padding:18px;color:var(--text)">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--amber)">${escapeHtml(I18N.t('cs.warnTitle'))}</h3>
      <ul style="margin:0 0 14px 16px;padding:0;font-size:12px;line-height:1.7">
        ${warnings.map(w => `<li>${escapeHtml(w.message_th || w.code)}</li>`).join('')}
      </ul>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${useExistingId ? `<button class="btn btn-primary" id="warnReuseBtn" style="font-size:12px">${escapeHtml(I18N.t('cs.warnReuseId').replace('{id}', useExistingId))}</button>` : ''}
        ${suggestedId && suggestedId !== dataDraft.camera_id ? `<button class="btn btn-secondary" id="warnCleanedBtn" style="font-size:12px">${escapeHtml(I18N.t('cs.warnCleanedId').replace('{id}', suggestedId))}</button>` : ''}
        <button class="btn btn-secondary" id="warnForceBtn" style="font-size:12px">${escapeHtml(I18N.t('cs.warnForce'))}</button>
        <button class="btn btn-secondary" id="warnCancelBtn" style="font-size:12px">${escapeHtml(I18N.t('common.cancel'))}</button>
      </div>
    </div>`;
  overlay.innerHTML = cardHtml;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#warnCancelBtn').onclick = close;
  overlay.querySelector('#warnForceBtn').onclick = () => { close(); _doSaveCamera(dataDraft, null, true); };
  const cleanedBtn = overlay.querySelector('#warnCleanedBtn');
  if (cleanedBtn) cleanedBtn.onclick = () => { close(); _doSaveCamera({ ...dataDraft, camera_id: suggestedId }, null, true); };
  const reuseBtn = overlay.querySelector('#warnReuseBtn');
  if (reuseBtn) reuseBtn.onclick = () => { close(); _doSaveCamera({ ...dataDraft, camera_id: useExistingId }, null, true); };
}

async function toggleCameraPause(id, pauseState) {
  const msg = pauseState ? I18N.t('cam.pauseConfirm') : null;
  if (msg && !confirm(msg)) return;
  try {
    const r = await fetch(`${API}/api/cameras/${encodeURIComponent(id)}/pause`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: pauseState }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Error'); return; }
    await loadCameras();
    renderAdminCameras();
    renderCameraGrid();
  } catch (e) { alert(e.message); }
}

async function deleteCamera(id) {
  if (!confirm(I18N.t('cs.confirmDelete').replace('{id}', id))) return;
  try {
    await fetch(`${API}/api/cameras/${id}`, { method: 'DELETE' });
    await loadGroups(); // groups may have changed
    await loadCameras();
    renderAdminCameras();
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

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
// 🔔 ALERTS PAGE — LINE Notification System
// ============================================================

let alertRulesCache = [];
let lineConfigCache = null;
let alertRuleSuggestions = [];
let pendingRecipientsCache = [];
// usersCache (vigil users) ใช้ร่วมกับ Users tab — define ใน Users section
let _pendingPollTimer = null;

// Sub-tabs inside the Settings › LINE/การแจ้งเตือน section.
// Logs/history are consolidated under the History Workspace.
function switchAlertTab(tab) {
  ['rules', 'config'].forEach(t => {
    document.getElementById(`alertTab${t.charAt(0).toUpperCase() + t.slice(1)}`)?.classList.toggle('active', t === tab);
    const sec = document.getElementById(`alertSection-${t}`);
    if (sec) sec.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'config') {
    loadLineConfig();
    _startPendingPoll();
  } else {
    _stopPendingPoll();
  }
  if (tab === 'rules') loadAlertRules();
}

function _startPendingPoll() {
  _stopPendingPoll();
  _pendingPollTimer = setInterval(() => {
    const sec = document.getElementById('alertSection-config');
    if (sec && sec.style.display !== 'none') { loadPendingRecipients(); loadBlockedRecipients(); }
    else _stopPendingPoll();
  }, 30000);
}

function _stopPendingPoll() {
  if (_pendingPollTimer) { clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
}

// ── Alert Rules CRUD ────────────────────────────────────────
async function loadAlertRules() {
  try {
    const [rulesRes, suggestionsRes, usersRes] = await Promise.all([
      fetch(`${API}/api/alert-rules`),
      fetch(`${API}/api/alert-rules-suggestions`),
      fetch(`${API}/api/users`),   // ใช้ใน rule editor (push dispatch)
    ]);
    alertRulesCache = await rulesRes.json();
    alertRuleSuggestions = await suggestionsRes.json();
    if (usersRes.ok) usersCache = await usersRes.json();
    renderAlertRules();
  } catch (e) { console.error('loadAlertRules:', e); }
}

function renderAlertRules() {
  const el = document.getElementById('alertRulesList');
  if (!alertRulesCache.length) {
    el.innerHTML = `<div style="text-align:center;padding:50px;color:var(--text-secondary);background:var(--surface-elevated);border:1px dashed var(--border-hairline);border-radius:8px">
      <div style="margin-bottom:10px;opacity:.35"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#icon-bell"/></svg></div>
      <div style="font-size:13px">${escapeHtml(I18N.t('ar.noRules'))}</div>
    </div>`;
    return;
  }
  el.innerHTML = alertRulesCache.map(r => {
    const camChips = r.camera_ids?.length ? r.camera_ids.map(c => `<span class="chip accent">${c}</span>`).join('') : '<span class="chip">ALL</span>';
    const ruleChips = r.rule_names?.length ? r.rule_names.map(n => `<span class="chip">${n}</span>`).join('') : '<span class="chip">ALL</span>';
    const recipChips = r.recipient_ids?.length
      ? `<span class="chip">${escapeHtml(I18N.t('ar.recipCount').replace('{n}', r.recipient_ids.length))}</span>`
      : `<span class="chip">${escapeHtml(I18N.t('ar.recipAll'))}</span>`;
    const lastTrig = r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleString('th-TH', {hour12:false}) : '—';
    return `
      <div class="alert-rule-card ${r.enabled ? '' : 'disabled'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div class="rule-toggle ${r.enabled ? 'on' : ''}" data-action="toggleRule" data-id="${r.id}"></div>
              <strong style="font-size:14px">${r.name}</strong>
              <span style="font-size:10px;color:var(--dim)">${escapeHtml(I18N.t('ar.trigCount').replace('{n}', r.trigger_count))}</span>
            </div>
            <div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">CAMS:</span>${camChips}</div>
            <div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">RULES:</span>${ruleChips}</div>
            <div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">SEND TO:</span>${recipChips}</div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:8px">
              Cooldown: ${r.cooldown_seconds}s · Snapshot: ${r.send_snapshot ? '✓' : '✗'} · 📱 ${(r.push_user_ids?.length ?? 0)} · Last: ${lastTrig}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-secondary" style="padding:5px 10px;font-size:11px" data-action="openRuleEditor" data-id="${r.id}">${escapeHtml(I18N.t('common.edit'))}</button>
            <button class="btn btn-danger" style="padding:5px 10px;font-size:11px" data-action="deleteRule" data-id="${r.id}">${escapeHtml(I18N.t('common.delete'))}</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function toggleRule(id) {
  const rule = alertRulesCache.find(r => r.id === id);
  if (!rule) return;
  try {
    await fetch(`${API}/api/alert-rules/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    loadAlertRules();
  } catch (e) { alert('Toggle error: ' + e.message); }
}

async function deleteRule(id) {
  const rule = alertRulesCache.find(r => r.id === id);
  if (!rule || !confirm(I18N.t('ar.confirmDeleteRule').replace('{name}', rule.name))) return;
  try {
    await fetch(`${API}/api/alert-rules/${id}`, { method: 'DELETE' });
    loadAlertRules();
  } catch (e) { alert('Delete error: ' + e.message); }
}

// ── Rule Editor Modal ───────────────────────────────────────
async function openRuleEditor(id) {
  // Load needed data
  if (!alertRuleSuggestions.length) {
    try {
      const r = await fetch(`${API}/api/alert-rules-suggestions`);
      alertRuleSuggestions = await r.json();
    } catch {}
  }
  if (!lineConfigCache) {
    try {
      const r = await fetch(`${API}/api/line-config`);
      lineConfigCache = await r.json();
    } catch { lineConfigCache = { recipients: [] }; }
  }
  if (!cameras.length) await loadCameras();

  document.getElementById('ruleEditorModal').classList.remove('hidden');
  document.getElementById('ruleId').value = id || '';
  document.getElementById('ruleEditorTitle').textContent = id ? I18N.t('ar.editorEdit') : I18N.t('ar.editorAdd');

  const rule = id ? alertRulesCache.find(r => r.id === id) : null;
  document.getElementById('ruleName').value = rule?.name || '';
  document.getElementById('ruleCooldown').value = rule?.cooldown_seconds ?? 60;
  document.getElementById('ruleSendSnapshot').checked = rule?.send_snapshot !== false;
  document.getElementById('ruleEnabled').checked = rule?.enabled !== false;
  // Mobile push dispatch — render checklist + role shortcuts
  _renderPushUsersChecklist(rule?.push_user_ids || []);
  // active_from/active_to come back from pg as "HH:MM:SS" — the <input type=time>
  // wants "HH:MM". Empty string when the rule has no window (24/7).
  document.getElementById('ruleActiveFrom').value = rule?.active_from ? String(rule.active_from).slice(0, 5) : '';
  document.getElementById('ruleActiveTo').value   = rule?.active_to   ? String(rule.active_to).slice(0, 5)   : '';
  document.getElementById('ruleMessageTemplate').value = rule?.message_template ||
    '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}\n👤 {object_class} ({likelihood})';

  // Camera checklist
  const camIds = rule?.camera_ids || [];
  document.getElementById('ruleCameraChecklist').innerHTML = cameras.length ? cameras.map(c => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleCamCheck" value="${c.camera_id}" ${camIds.includes(c.camera_id) ? 'checked' : ''}>
      <span>${c.camera_id} <span style="color:var(--dim)">(${c.name || c.location || ''})</span></span>
    </label>`).join('') : `<div style="color:var(--dim);font-size:11px;padding:6px">${escapeHtml(I18N.t('ar.noCamerasInSystem'))}</div>`;

  // Rule names checklist
  const ruleNames = rule?.rule_names || [];
  document.getElementById('ruleNamesChecklist').innerHTML = alertRuleSuggestions.length ? alertRuleSuggestions.map(n => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleNameCheck" value="${n}" ${ruleNames.includes(n) ? 'checked' : ''}>
      <span>${n}</span>
    </label>`).join('') : `<div style="color:var(--dim);font-size:11px;padding:6px">${escapeHtml(I18N.t('ar.noRuleData'))}</div>`;

  // Recipients checklist
  const recipIds = rule?.recipient_ids || [];
  const recipients = lineConfigCache.recipients || [];
  document.getElementById('ruleRecipientsChecklist').innerHTML = recipients.length ? recipients.map(rcp => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleRecipCheck" value="${rcp.id}" ${recipIds.includes(rcp.id) ? 'checked' : ''}>
      <span><span class="chip" style="font-size:9px;margin-right:4px">${rcp.type === 'group' ? 'GRP' : rcp.type === 'room' ? 'ROOM' : 'USER'}</span>${rcp.name || rcp.id} <span style="color:var(--text-secondary);font-family:monospace">${rcp.id.slice(0, 12)}…</span></span>
    </label>`).join('') : `<div style="color:var(--dim);font-size:11px;padding:6px">${escapeHtml(I18N.t('ar.noRecipientsHint'))}</div>`;
}

function _renderPushUsersChecklist(selectedIds) {
  const checklistEl = document.getElementById('rulePushUsersChecklist');
  const shortcutEl  = document.getElementById('rulePushRoleShortcuts');
  if (!checklistEl || !shortcutEl) return;
  const sel = new Set((selectedIds || []).map(Number));

  // checklist (user รายคน) — เรียง role เพื่ออ่านง่าย
  if (!usersCache.length) {
    checklistEl.innerHTML = `<div style="color:var(--dim);font-size:11px;padding:6px">ยังไม่มีผู้ใช้</div>`;
  } else {
    const sorted = [...usersCache].sort((a, b) => (a.role || '').localeCompare(b.role || '') || a.username.localeCompare(b.username));
    checklistEl.innerHTML = sorted.map(u => `
      <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px;${u.enabled === false ? 'opacity:0.5' : ''}">
        <input type="checkbox" class="rulePushUserCheck" value="${u.id}" ${sel.has(u.id) ? 'checked' : ''} ${u.enabled === false ? 'disabled' : ''}>
        <span>${escapeHtml(u.username)} <span style="color:var(--dim)">(${escapeHtml(u.role || '')})</span></span>
      </label>`).join('');
  }

  // role shortcuts — ปุ่มลัด select all per role + all + none
  const roles = [...new Set(usersCache.map(u => u.role).filter(Boolean))].sort();
  const btn = (label, action) =>
    `<button type="button" class="btn btn-secondary" style="font-size:10px;padding:3px 8px" data-action="pushUsersSelect" data-push-action="${escapeHtml(action)}">${label}</button>`;
  shortcutEl.innerHTML =
    btn('ทั้งหมด', 'all')
    + btn('ล้าง', 'none')
    + roles.map(r => btn(r, `role:${r}`)).join('');
}

function _pushUsersSelect(action) {
  const boxes = document.querySelectorAll('.rulePushUserCheck');
  const userById = new Map(usersCache.map(u => [String(u.id), u]));
  boxes.forEach(b => {
    if (b.disabled) return;
    const u = userById.get(b.value);
    if (action === 'all')         b.checked = true;
    else if (action === 'none')   b.checked = false;
    else if (action.startsWith('role:')) {
      const role = action.slice(5);
      if (u && u.role === role) b.checked = true;
    }
  });
}

function closeRuleEditor() {
  document.getElementById('ruleEditorModal').classList.add('hidden');
}

async function saveRule() {
  const id = document.getElementById('ruleId').value;
  const data = {
    name: document.getElementById('ruleName').value.trim(),
    enabled: document.getElementById('ruleEnabled').checked,
    cooldown_seconds: parseInt(document.getElementById('ruleCooldown').value) || 60,
    send_snapshot: document.getElementById('ruleSendSnapshot').checked,
    push_user_ids: [...document.querySelectorAll('.rulePushUserCheck:checked')].map(c => parseInt(c.value, 10)).filter(Number.isFinite),
    message_template: document.getElementById('ruleMessageTemplate').value,
    camera_ids: [...document.querySelectorAll('.ruleCamCheck:checked')].map(c => c.value),
    rule_names: [...document.querySelectorAll('.ruleNameCheck:checked')].map(c => c.value),
    recipient_ids: [...document.querySelectorAll('.ruleRecipCheck:checked')].map(c => c.value),
    // Quiet hours — empty string → server normalizes to NULL (24/7).
    active_from: document.getElementById('ruleActiveFrom').value || '',
    active_to:   document.getElementById('ruleActiveTo').value   || '',
  };
  if (!data.name) { alert(I18N.t('ar.needName')); return; }

  try {
    const url = id ? `${API}/api/alert-rules/${id}` : `${API}/api/alert-rules`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    closeRuleEditor();
    loadAlertRules();
  } catch (e) { alert('Save error: ' + e.message); }
}

// ── Alert Stats Summary ─────────────────────────────────────
let _alertStatsWindow = '24h';

async function loadAlertStats(win) {
  if (win) _alertStatsWindow = win;
  const el = document.getElementById('alertStatsSummary');
  if (!el) return;
  el.innerHTML = `<div style="font-size:11px;color:var(--dim);padding:6px 0">${escapeHtml(I18N.t('al.statLoading'))}</div>`;
  try {
    const res = await fetch(`${API}/api/alert-logs/stats?window=${_alertStatsWindow}`, { cache: 'no-store' });
    const data = await res.json();
    el.innerHTML = renderAlertStats(data);
  } catch {
    el.innerHTML = `<div style="font-size:11px;color:var(--red);padding:6px 0">${escapeHtml(I18N.t('al.statError'))}</div>`;
  }
}

function renderAlertStats(d) {
  const skipped = (d.cooldown_skip || 0) + (d.quiet_hours_skip || 0) + (d.no_recipients || 0) + (d.disabled || 0);
  const rate = d.success_rate != null ? `${d.success_rate}%` : '—';
  const avgMs = d.avg_duration_ms != null ? `${d.avg_duration_ms} ms` : '—';

  const card = (color, num, label, sub = '') => `
    <div style="background:var(--panel2);border:1px solid ${color};border-radius:8px;padding:10px 14px;min-width:0">
      <div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${num.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text);margin-top:3px">${label}</div>
      ${sub ? `<div style="font-size:10px;color:var(--dim);margin-top:1px">${sub}</div>` : ''}
    </div>`;

  const winBtn = (w, label) => `
    <button data-action="loadAlertStats" data-window="${escapeHtml(w)}"
      style="padding:3px 10px;font-size:10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;
             background:${_alertStatsWindow === w ? 'var(--accent)' : 'var(--panel2)'};
             color:${_alertStatsWindow === w ? '#fff' : 'var(--dim)'};white-space:nowrap">
      ${escapeHtml(label)}
    </button>`;

  return `
    <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div style="font-size:11px;font-weight:600;color:var(--dim)">Summary</div>
        <div style="display:flex;gap:5px">
          ${winBtn('24h', I18N.t('al.win24h'))}
          ${winBtn('7d',  I18N.t('al.win7d'))}
          ${winBtn('30d', I18N.t('al.win30d'))}
        </div>
      </div>
      <div class="al-stats-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${card('var(--green)', d.success || 0,   escapeHtml(I18N.t('al.statSuccess')),  `${rate} ${escapeHtml(I18N.t('al.statSuccessRate'))}`)}
        ${card('var(--red)',   d.failed  || 0,   escapeHtml(I18N.t('al.statFailed')))}
        ${card('var(--amber)', skipped,           escapeHtml(I18N.t('al.statSkipped')))}
        ${card('var(--accent)',d.line_messages_sent || 0, escapeHtml(I18N.t('al.statLineMsg')), `avg ${avgMs}`)}
      </div>
    </div>`;
}

// ── Alert Logs ──────────────────────────────────────────────
async function loadAlertLogs() {
  loadAlertStats();
  try {
    const status = document.getElementById('logFilterStatus')?.value || '';
    const params = status ? `?status=${status}` : '';
    const res = await fetch(`${API}/api/alert-logs${params}`);
    const logs = await res.json();
    renderAlertLogs(logs);
  } catch (e) { console.error('loadAlertLogs:', e); }
}

function renderAlertLogs(logs) {
  const el = document.getElementById('alertLogsList');
  if (!logs.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--dim);font-size:12px">${escapeHtml(I18N.t('al.noLogs'))}</div>`;
    return;
  }
  const statusIcons = { success: '✓', failed: '✗', cooldown_skip: '⏭', quiet_hours_skip: '🕐', no_recipients: '—', disabled: '⊘' };
  const statusColors = { success: 'var(--green)', failed: 'var(--red)', cooldown_skip: 'var(--amber)', quiet_hours_skip: 'var(--dim)', no_recipients: 'var(--dim)' };
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:140px 1fr 130px 130px 80px 80px;gap:10px;padding:10px 14px;background:var(--panel2);font-size:10px;color:var(--dim);font-weight:600;border-bottom:1px solid var(--border)">
      <div>${escapeHtml(I18N.t('evt.colTime'))}</div><div>${escapeHtml(I18N.t('al.colRuleMsg'))}</div><div>${escapeHtml(I18N.t('common.camera'))}</div><div>${escapeHtml(I18N.t('al.colTriggerRule'))}</div><div>${escapeHtml(I18N.t('al.colStatus'))}</div><div>${escapeHtml(I18N.t('al.colTimeMs'))}</div>
    </div>
    ${logs.map(l => `
      <div style="display:grid;grid-template-columns:140px 1fr 130px 130px 80px 80px;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border);font-size:11px;align-items:center">
        <div style="color:var(--dim);font-size:10px">${new Date(l.sent_at).toLocaleString('th-TH', {hour12:false})}</div>
        <div>
          <div style="font-weight:600">${l.rule_name || '—'}</div>
          ${l.message_text ? `<div style="color:var(--dim);font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.message_text.slice(0, 80)}</div>` : ''}
          ${l.error_message ? `<div style="color:var(--red);font-size:10px;margin-top:2px">⚠ ${l.error_message}</div>` : ''}
        </div>
        <div style="font-family:monospace;font-size:10px">${l.camera_id || '—'}</div>
        <div style="color:var(--dim);font-size:10px">${l.triggered_rule || '—'}</div>
        <div style="color:${statusColors[l.status] || 'var(--text)'};font-weight:600">
          ${statusIcons[l.status] || ''} ${l.status}
        </div>
        <div style="color:var(--dim);font-size:10px;text-align:right">${l.duration_ms || 0}</div>
      </div>`).join('')}`;
}

async function clearOldLogs() {
  if (!confirm(I18N.t('al.confirmClear'))) return;
  try {
    const res = await fetch(`${API}/api/alert-logs?olderThanDays=30`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    loadAlertLogs();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ── LINE Config ─────────────────────────────────────────────
async function loadLineConfig() {
  try {
    const res = await fetch(`${API}/api/line-config`);
    lineConfigCache = await res.json();
    document.getElementById('cfgLineToken').placeholder = lineConfigCache._hasToken ? lineConfigCache.channel_access_token : 'paste token from LINE Developers Console';
    document.getElementById('cfgLineToken').value = lineConfigCache._hasToken ? lineConfigCache.channel_access_token : '';
    document.getElementById('cfgLineSecret').value = lineConfigCache._hasSecret ? lineConfigCache.channel_secret : '';
    document.getElementById('cfgImgbbKey').value = lineConfigCache._hasImgbb ? lineConfigCache.imgbb_api_key : '';
    document.getElementById('cfgEnabled').checked = !!lineConfigCache.enabled;
    const basicIdEl = document.getElementById('cfgLineBasicId');
    if (basicIdEl) basicIdEl.value = lineConfigCache.oa_basic_id || '';
    renderRecipients();
    renderOnboardQr(lineConfigCache.oa_basic_id);
    loadPendingRecipients();
    loadBlockedRecipients();
    loadLineQuota();
  } catch (e) { console.error('loadLineConfig:', e); }
}

async function loadLineQuota() {
  const el = document.getElementById('lineQuotaWidget');
  if (!el) return;
  el.innerHTML = `<div style="font-size:10px;color:var(--dim)">กำลังตรวจสอบ quota…</div>`;
  try {
    const res = await fetch(`${API}/api/line-config/quota`);
    const data = await res.json();
    el.innerHTML = renderLineQuotaWidget(data);
  } catch {
    el.innerHTML = renderLineQuotaWidget({ connected: false });
  }
}

function renderLineQuotaWidget(data) {
  const base = 'border-radius:7px;padding:10px 12px;font-size:11px;border:1px solid';
  if (!data.connected) {
    return `<div style="${base} var(--border);background:var(--panel2);color:var(--dim)">
      <span style="color:var(--red)">●</span>&ensp;ไม่สามารถเชื่อมต่อ LINE API ได้ — ตรวจสอบ Channel Access Token
    </div>`;
  }
  if (data.type === 'none') {
    return `<div style="${base} var(--border);background:var(--panel2)">
      <span style="color:var(--green)">●</span>&ensp;
      <strong>Connected</strong>&ensp;·&ensp;แผน Unlimited&ensp;·&ensp;ส่งแล้ว <strong>${data.used.toLocaleString()}</strong> ข้อความเดือนนี้
      <button data-action="loadLineQuota" style="float:right;background:none;border:none;color:var(--dim);font-size:10px;cursor:pointer;padding:0">↻</button>
    </div>`;
  }
  const limit = data.limit ?? 0;
  const used = data.used ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const barColor = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
  const textColor = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--text)';
  return `<div style="${base} var(--border);background:var(--panel2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
      <span><span style="color:var(--green)">●</span>&ensp;<strong>Connected</strong>&ensp;·&ensp;Push quota เดือนนี้</span>
      <span style="color:${textColor};font-weight:700">${used.toLocaleString()} / ${limit.toLocaleString()}</span>
      <button data-action="loadLineQuota" style="background:none;border:none;color:var(--dim);font-size:10px;cursor:pointer;padding:0;margin-left:8px">↻</button>
    </div>
    <div style="height:5px;border-radius:3px;background:var(--border);overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
    </div>
    <div style="margin-top:5px;color:var(--dim);font-size:10px">
      ${pct}% used · เหลือ ${(limit - used).toLocaleString()} ข้อความ · Reply API ไม่นับ quota
    </div>
  </div>`;
}

function toggleOnboardGuide() {
  const body = document.getElementById('onboardGuideBody');
  const chevron = document.getElementById('onboardGuideChevron');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  if (chevron) chevron.textContent = open ? '▲' : '▼';
}

function renderOnboardQr(basicId) {
  const wrap = document.getElementById('onboardQrWrap');
  if (!wrap) return;
  const step2 = document.getElementById('onboardStep2');
  if (!basicId) {
    wrap.innerHTML = `<div style="padding:10px;font-size:11px;color:var(--dim);border:1px dashed var(--border);border-radius:6px">${escapeHtml(I18N.t('ln.onboardNoId'))}</div>`;
    if (step2) step2.dataset.i18nDynamic = I18N.t('ln.onboardStep2').replace('{id}', '');
    return;
  }
  const id = basicId.startsWith('@') ? basicId : '@' + basicId;
  const friendUrl = `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
  if (step2) step2.innerHTML = I18N.t('ln.onboardStep2').replace('{id}', `<strong>${escapeHtml(id)}</strong>`);
  wrap.innerHTML = `
    <img src="${API}/api/line-config/qr" alt="QR" style="width:160px;height:160px;border-radius:8px;border:1px solid var(--border)" data-err="hide">
    <div style="margin-top:8px;font-size:10px;color:var(--dim)">
      <a href="${escapeHtml(friendUrl)}" target="_blank" style="color:var(--accent)">${escapeHtml(id)}</a>
    </div>`;
}

async function loadPendingRecipients() {
  const el = document.getElementById('pendingRecipientsList');
  if (!el) return;
  try {
    el.innerHTML = `<div style="padding:12px;color:var(--dim);font-size:11px">${escapeHtml(I18N.t('common.loading'))}</div>`;
    const res = await fetch(`${API}/api/line/pending`);
    if (!res.ok) throw new Error((await res.json()).error || 'load failed');
    pendingRecipientsCache = await res.json();
    renderPendingRecipients();
  } catch (e) {
    el.innerHTML = `<div style="padding:12px;color:var(--red);font-size:11px">${escapeHtml(I18N.t('ln.pendingLoadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function renderPendingRecipients() {
  const el = document.getElementById('pendingRecipientsList');
  if (!el) return;
  const rows = Array.isArray(pendingRecipientsCache) ? pendingRecipientsCache : [];
  const badge = document.getElementById('pendingBadge');
  if (badge) {
    badge.textContent = rows.length || '';
    badge.style.display = rows.length ? '' : 'none';
  }
  if (!rows.length) {
    el.innerHTML = `<div style="padding:12px;text-align:center;color:var(--dim);font-size:11px;border:1px dashed var(--border);border-radius:7px">${escapeHtml(I18N.t('ln.noPending'))}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const typeChip = r.source_type === 'group' ? '<span class="chip" style="font-size:9px">GRP</span>' : r.source_type === 'room' ? '<span class="chip" style="font-size:9px">ROOM</span>' : '<span class="chip" style="font-size:9px">USER</span>';
    const name = r.display_name || I18N.t('ln.unknownName');
    const avatarFallback = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#icon-user"/></svg>`;
    const avatar = r.avatar_url
      ? `<img src="${escapeHtml(r.avatar_url)}" alt="">`
      : avatarFallback;
    const lastSeen = r.last_message_at ? new Date(r.last_message_at).toLocaleString('th-TH', { hour12:false }) : '—';
    return `
      <div class="line-pending-card">
        <div class="line-pending-avatar">${avatar}</div>
        <div class="line-pending-main">
          <div class="line-pending-name">${typeChip} ${escapeHtml(name)}</div>
          <div class="line-pending-meta">${escapeHtml(r.line_id)} · ${escapeHtml(r.source_type || '')} · ${escapeHtml(I18N.t('ln.msgCount').replace('{n}', r.message_count || 1))}</div>
          <div style="font-size:10px;color:var(--dim);margin-top:2px">${escapeHtml(I18N.t('ln.lastSeen').replace('{time}', lastSeen))}</div>
        </div>
        <div class="line-pending-actions">
          <button class="btn btn-primary" style="padding:5px 10px;font-size:10px" data-action="approvePendingRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.approve'))}</button>
          <button class="btn btn-secondary" style="padding:5px 10px;font-size:10px" data-action="ignorePendingRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.ignore'))}</button>
          <button class="btn btn-danger" style="padding:5px 10px;font-size:10px" data-action="blockRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.block'))}</button>
        </div>
      </div>`;
  }).join('');
}

function renderRecipients() {
  const el = document.getElementById('recipientsList');
  const recipients = lineConfigCache?.recipients || [];
  if (!recipients.length) {
    el.innerHTML = `<div style="padding:14px;text-align:center;color:var(--dim);font-size:11px">${escapeHtml(I18N.t('ar.noRecipients'))}</div>`;
    return;
  }
  el.innerHTML = recipients.map((r, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel2);border-radius:5px;margin-bottom:6px">
      <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} data-change="updateRecipient" data-idx="${i}" data-field="enabled">
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:600"><span class="chip" style="font-size:9px;margin-right:4px">${r.type === 'group' ? 'GRP' : r.type === 'room' ? 'ROOM' : 'USER'}</span>${escapeHtml(r.name || I18N.t('ar.unnamed'))}</div>
        <div style="font-size:9px;color:var(--text-secondary);font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.id}</div>
      </div>
      <button class="btn btn-secondary" style="padding:3px 7px;font-size:9px" data-action="testRecipient" data-id="${escapeHtml(r.id)}">Test</button>
      <button class="btn btn-danger" style="padding:3px 7px;font-size:9px" data-action="removeRecipient" data-idx="${i}">✕</button>
    </div>`).join('');
}

function updateRecipient(idx, field, value) {
  if (!lineConfigCache.recipients[idx]) return;
  lineConfigCache.recipients[idx][field] = value;
}

function addRecipient() {
  const id = prompt(I18N.t('ar.promptId'));
  if (!id || !id.trim()) return;
  const trimmedId = id.trim();
  const type = trimmedId.startsWith('C') ? 'group' : 'user';
  const name = prompt(I18N.t('ar.promptName')) || 'Unnamed';
  if (!lineConfigCache.recipients) lineConfigCache.recipients = [];
  lineConfigCache.recipients.push({ id: trimmedId, type, name, enabled: true });
  renderRecipients();
}

function removeRecipient(idx) {
  if (!confirm(I18N.t('ar.confirmDeleteRecip'))) return;
  lineConfigCache.recipients.splice(idx, 1);
  renderRecipients();
  saveLineConfig({ silent: true });
}

async function testRecipient(id) {
  try {
    const res = await fetch(`${API}/api/line-config/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: id }),
    });
    const data = await res.json();
    alert(data.success ? I18N.t('ar.testOk') : I18N.t('ar.testFail') + data.error);
  } catch (e) { alert('Error: ' + e.message); }
}

async function saveLineConfig({ silent = false } = {}) {
  try {
    const tokenVal = document.getElementById('cfgLineToken').value;
    const secretVal = document.getElementById('cfgLineSecret').value;
    const imgbbVal = document.getElementById('cfgImgbbKey').value;
    const basicIdVal = (document.getElementById('cfgLineBasicId')?.value || '').trim();
    const data = {
      enabled: document.getElementById('cfgEnabled').checked,
      recipients: lineConfigCache?.recipients || [],
      oa_basic_id: basicIdVal || null,
    };
    // ส่ง token เฉพาะถ้าผู้ใช้ใส่ใหม่ (ไม่ใช่ masked value)
    if (tokenVal && !tokenVal.startsWith('••')) data.channel_access_token = tokenVal;
    if (secretVal && !secretVal.startsWith('••')) data.channel_secret = secretVal;
    if (imgbbVal && !imgbbVal.startsWith('••')) data.imgbb_api_key = imgbbVal;

    const res = await fetch(`${API}/api/line-config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    if (!silent) alert(I18N.t('ar.configSaved'));
    loadLineConfig();
  } catch (e) { alert('Save error: ' + e.message); }
}

async function approvePendingRecipient(lineId) {
  try {
    const row = pendingRecipientsCache.find(r => r.line_id === lineId);
    const defaultName = row?.display_name || lineId;
    const name = prompt(I18N.t('ln.promptApproveName'), defaultName);
    if (name === null) return;
    const res = await fetch(`${API}/api/line/pending/${encodeURIComponent(lineId)}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || defaultName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'approve failed');
    await loadLineConfig();
  } catch (e) { alert(I18N.t('ln.approveFailed') + e.message); }
}

async function ignorePendingRecipient(lineId) {
  if (!confirm(I18N.t('ln.confirmIgnore'))) return;
  try {
    const res = await fetch(`${API}/api/line/pending/${encodeURIComponent(lineId)}/ignore`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ignore failed');
    await loadPendingRecipients();
  } catch (e) { alert(I18N.t('ln.ignoreFailed') + e.message); }
}

async function blockRecipient(lineId) {
  if (!confirm(I18N.t('ln.confirmBlock'))) return;
  try {
    const res = await fetch(`${API}/api/line/pending/${encodeURIComponent(lineId)}/block`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'block failed');
    await Promise.all([loadPendingRecipients(), loadBlockedRecipients()]);
  } catch (e) { alert(I18N.t('ln.blockFailed') + e.message); }
}

async function unblockRecipient(lineId) {
  if (!confirm(I18N.t('ln.confirmUnblock'))) return;
  try {
    const res = await fetch(`${API}/api/line/blocked/${encodeURIComponent(lineId)}/unblock`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'unblock failed');
    await loadBlockedRecipients();
  } catch (e) { alert(I18N.t('ln.unblockFailed') + e.message); }
}

let blockedRecipientsCache = [];

async function loadBlockedRecipients() {
  const el = document.getElementById('blockedList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/line/blocked`);
    if (!res.ok) return;
    blockedRecipientsCache = await res.json();
    renderBlockedRecipients();
  } catch { /* silent */ }
}

function renderBlockedRecipients() {
  const el = document.getElementById('blockedList');
  if (!el) return;
  const rows = Array.isArray(blockedRecipientsCache) ? blockedRecipientsCache : [];
  const badge = document.getElementById('blockedBadge');
  if (badge) { badge.textContent = rows.length || ''; badge.style.display = rows.length ? '' : 'none'; }
  if (!rows.length) {
    el.innerHTML = `<div style="padding:10px;text-align:center;color:var(--dim);font-size:11px;border:1px dashed var(--border);border-radius:7px">${escapeHtml(I18N.t('ln.noBlocked'))}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const typeChipB = r.source_type === 'group' ? '<span class="chip" style="font-size:9px;margin-right:4px">GRP</span>' : r.source_type === 'room' ? '<span class="chip" style="font-size:9px;margin-right:4px">ROOM</span>' : '<span class="chip" style="font-size:9px;margin-right:4px">USER</span>';
    const name = r.display_name || I18N.t('ln.unknownName');
    const lastSeen = r.last_message_at ? new Date(r.last_message_at).toLocaleString('th-TH', { hour12: false }) : '—';
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel2);border-radius:6px;margin-bottom:6px;opacity:0.75">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary)">${typeChipB}${escapeHtml(name)}</div>
          <div style="font-size:9px;color:var(--muted);font-family:monospace">${escapeHtml(r.line_id)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHtml(I18N.t('ln.lastSeen').replace('{time}', lastSeen))}</div>
        </div>
        <button class="btn btn-secondary" style="padding:4px 8px;font-size:10px" data-action="unblockRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.unblock'))}</button>
      </div>`;
  }).join('');
}

// ============================================================
// 🔐 USER AUTHENTICATION & MANAGEMENT
// ============================================================

// ── Init: load current user info on page load ───────────────
async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) {
      console.log('🔐 Not authenticated, redirecting...');
      window.location.href = '/login.html';
      return false;
    }
    if (!res.ok) {
      throw new Error(`Auth check failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.user) {
      window.location.href = '/login.html';
      return false;
    }
    currentUser = data.user;

    // Update topbar UI (defensive — DOM อาจยังไม่ render)
    const initial = (currentUser.full_name || currentUser.username).charAt(0).toUpperCase();
    const $ = (id) => document.getElementById(id);
    if ($('userAvatar')) $('userAvatar').textContent = initial;
    if ($('userName')) $('userName').textContent = currentUser.full_name || currentUser.username;
    if ($('userRole')) {
      $('userRole').textContent = currentUser.role;
      $('userRole').classList.toggle('viewer', currentUser.role === 'viewer');
    }
    if ($('ddName')) $('ddName').textContent = currentUser.full_name || currentUser.username;
    if ($('ddEmail')) $('ddEmail').textContent = currentUser.email || I18N.t('aux.noEmail');

    // Apply role-based UI — one explicit class per role (admin / viewer /
    // auditor). admin-only is hidden from role-viewer only, so an auditor
    // sees every page; the auditor write-block is enforced server-side.
    document.body.classList.remove('role-admin', 'role-viewer', 'role-auditor');
    document.body.classList.add('role-' + (currentUser.role || 'viewer'));
    _isAuditor = currentUser.role === 'auditor';

    // Force change password ถ้าเป็นครั้งแรก
    if (currentUser.must_change_password) {
      setTimeout(() => openChangePassword(true), 500);
    }
    return true;
  } catch (e) {
    console.error('🔐 Auth error:', e);
    // Network error, etc — แสดงข้อความให้รู้ ไม่ redirect
    const userName = document.getElementById('userName');
    if (userName) userName.textContent = '❌ Auth error';
    return false;
  }
}

// ── User dropdown ───────────────────────────────────────────
function toggleUserDropdown(e) {
  e?.stopPropagation();
  document.getElementById('userDropdown').classList.toggle('hidden');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('userDropdown')?.classList.add('hidden');
  }
});

// ── Logout ──────────────────────────────────────────────────
async function doLogout() {
  if (!confirm(I18N.t('aux.confirmLogout'))) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  setStoredToken(null);  // 🆕 Clear localStorage token
  sessionStorage.removeItem('disclaimer_accepted');
  window.location.href = '/login.html';
}

// ── Change Password Modal ───────────────────────────────────
function openChangePassword(forced = false) {
  document.getElementById('userDropdown')?.classList.add('hidden');
  document.getElementById('changePasswordModal').classList.remove('hidden');
  document.getElementById('cpForceWarning').style.display = forced ? 'block' : 'none';
  document.getElementById('cpOldPassword').value = '';
  document.getElementById('cpNewPassword').value = '';
  document.getElementById('cpConfirmPassword').value = '';
  setTimeout(() => document.getElementById('cpOldPassword').focus(), 50);
}

function closeChangePassword() {
  // ถ้า must_change_password อยู่ → ห้ามปิด
  if (currentUser?.must_change_password) {
    alert(I18N.t('cp.mustChangeFirst'));
    return;
  }
  document.getElementById('changePasswordModal').classList.add('hidden');
}

async function submitChangePassword() {
  const oldPw = document.getElementById('cpOldPassword').value;
  const newPw = document.getElementById('cpNewPassword').value;
  const conf  = document.getElementById('cpConfirmPassword').value;
  if (!oldPw || !newPw) return alert(I18N.t('cp.fillAll'));
  if (newPw.length < 8) return alert(I18N.t('cp.newPwMin'));
  if (newPw !== conf) return alert(I18N.t('cp.confirmMismatch'));

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (currentUser) currentUser.must_change_password = false;
    alert(I18N.t('cp.changeOk'));
    document.getElementById('changePasswordModal').classList.add('hidden');
  } catch (e) { alert('❌ ' + e.message); }
}

// ── User Manager (admin) ────────────────────────────────────
let usersCache = [];

function openUserManager() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('users');
}
function closeUserManager() { /* users is a Settings Workspace section now — no modal */ }

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error(I18N.t('us.loadFailed'));
    usersCache = await res.json();
    renderUsersList();
  } catch (e) { alert('Error: ' + e.message); }
}

function renderUsersList() {
  document.getElementById('userCount').textContent = usersCache.length;
  const el = document.getElementById('usersList');
  if (!usersCache.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('us.noUsers'))}</div>`;
    return;
  }
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 100px 120px 140px 200px;gap:10px;padding:10px 14px;background:var(--panel2);font-size:10px;color:var(--dim);font-weight:600;border-bottom:1px solid var(--border)">
      <div>Username / Name</div>
      <div>Email</div>
      <div>Role</div>
      <div>Status</div>
      <div>Last Login</div>
      <div style="text-align:right">Actions</div>
    </div>
    ${usersCache.map(u => {
      const isMe = u.id === currentUser?.id;
      const status = !u.enabled ? '<span style="color:var(--red)">🚫 Disabled</span>' :
                     u.locked_until && new Date(u.locked_until) > new Date() ? `<span style="color:var(--amber)">🔒 Locked</span>` :
                     '<span style="color:var(--green)">✓ Active</span>';
      const lastLogin = u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH', {dateStyle:'short', timeStyle:'short', hour12:false}) : '—';
      return `
      <div style="display:grid;grid-template-columns:1fr 1fr 100px 120px 140px 200px;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:11px;align-items:center">
        <div>
          <div style="font-weight:600">${u.username} ${isMe ? '<span style="color:var(--accent);font-size:10px">(YOU)</span>' : ''}</div>
          <div style="color:var(--dim);font-size:10px">${u.full_name || '—'}</div>
        </div>
        <div style="font-size:10px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.email || '—'}</div>
        <div><span class="chip ${u.role === 'admin' ? 'accent' : ''}">${u.role === 'admin' ? 'Admin' : 'Viewer'}</span></div>
        <div>${status}</div>
        <div style="font-size:10px;color:var(--dim)">${lastLogin}<br><span style="font-family:monospace;font-size:9px">${u.last_login_ip || ''}</span></div>
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" style="padding:3px 8px;font-size:10px" data-action="openUserEditor" data-id="${u.id}">${escapeHtml(I18N.t('common.edit'))}</button>
          <button class="btn btn-secondary" style="padding:3px 8px;font-size:10px" data-action="resetUserPassword" data-id="${u.id}">Reset</button>
          ${!isMe ? `<button class="btn btn-danger" style="padding:3px 8px;font-size:10px" data-action="deleteUserConfirm" data-id="${u.id}">${escapeHtml(I18N.t('common.delete'))}</button>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

// ── User Editor ─────────────────────────────────────────────
function openUserEditor(id) {
  const u = id ? usersCache.find(x => x.id === id) : null;
  document.getElementById('userEditorModal').classList.remove('hidden');
  document.getElementById('userEditorTitle').textContent = id ? I18N.t('us.editorEdit') : I18N.t('us.editorAdd');
  document.getElementById('ueUserId').value = id || '';
  document.getElementById('ueUsername').value = u?.username || '';
  document.getElementById('ueUsername').disabled = !!id;  // ห้ามแก้ username
  document.getElementById('uePassword').value = '';
  document.getElementById('uePasswordGroup').style.display = id ? 'none' : '';
  document.getElementById('ueFullName').value = u?.full_name || '';
  document.getElementById('ueEmail').value = u?.email || '';
  document.getElementById('ueRole').value = u?.role || 'viewer';
  document.getElementById('ueEnabled').checked = u?.enabled !== false;
}

function closeUserEditor() {
  document.getElementById('userEditorModal').classList.add('hidden');
}

async function saveUser() {
  const id = document.getElementById('ueUserId').value;
  const data = {
    full_name: document.getElementById('ueFullName').value.trim() || null,
    email: document.getElementById('ueEmail').value.trim() || null,
    role: document.getElementById('ueRole').value,
    enabled: document.getElementById('ueEnabled').checked,
  };
  if (!id) {
    data.username = document.getElementById('ueUsername').value.trim();
    data.password = document.getElementById('uePassword').value;
    if (!data.username) return alert(I18N.t('us.needUsername'));
    if (!data.password || data.password.length < 8) return alert(I18N.t('us.passwordMin'));
  }
  try {
    const url = id ? `/api/users/${id}` : '/api/users';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    closeUserEditor();
    loadUsers();
  } catch (e) { alert('❌ ' + e.message); }
}

async function resetUserPassword(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  const newPw = prompt(I18N.t('us.resetPrompt').replace('{u}', u.username));
  if (!newPw) return;
  if (newPw.length < 8) return alert(I18N.t('us.passwordMin'));
  try {
    const res = await fetch(`/api/users/${id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPw }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    alert(I18N.t('us.resetDone').replace('{u}', u.username).replace('{pw}', newPw));
  } catch (e) { alert('❌ ' + e.message); }
}

async function deleteUserConfirm(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  if (!confirm(I18N.t('us.confirmDelete').replace('{u}', u.username))) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    loadUsers();
  } catch (e) { alert('❌ ' + e.message); }
}

// ── Audit Log Modal ─────────────────────────────────────────
function openAuditLog() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  const nav = document.querySelector('.nav-item[data-page="history"]');
  showPage('history', nav || undefined);
  historyNav('audit');
}
function closeAuditLog() { /* audit log is a History Workspace section now — no modal */ }

async function loadAuditLog() {
  try {
    populateAuditCameraFilter();
    const action = document.getElementById('auditFilterAction').value;
    const cameraId = document.getElementById('auditFilterCamera')?.value || '';
    const qs = new URLSearchParams();
    if (action) qs.set('action', action);
    if (cameraId) qs.set('targetCameraId', cameraId);
    const params = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`/api/audit-log${params}`);
    if (!res.ok) throw new Error(I18N.t('aud.loadFailed'));
    const logs = await res.json();
    renderAuditLog(logs);
  } catch (e) { alert('Error: ' + e.message); }
}

function populateAuditCameraFilter() {
  const sel = document.getElementById('auditFilterCamera');
  if (!sel || sel.dataset.loaded === String((cameras || []).length)) return;
  const selected = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('aud.allCameras'))}</option>`
    + (cameras || []).map(c => {
      const id = c.camera_id || c.id || '';
      const label = c.camera_name || c.name || id;
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)} (${escapeHtml(id)})</option>`;
    }).join('');
  sel.value = selected;
  sel.dataset.loaded = String((cameras || []).length);
}

function renderAuditLog(logs) {
  const el = document.getElementById('auditLogList');
  if (!logs.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('aud.noLogs'))}</div>`;
    return;
  }
  const actionIcons = {
    login_success: '✓', login_failed: '✗', login_locked: '🔒', logout: '🚪',
    password_change: '🔑', password_reset: '🔓',
    user_create: '➕', user_update: '✏️', user_delete: '🗑',
    camera_create: '📷', camera_update: '✏️', camera_delete: '🗑',
    camera_offline_alert_update: '🔔',
    camera_group_assign: '🗂', camera_group_remove: '🗂',
    group_create: '🗂', group_update: '🗂', group_delete: '🗂',
    session_revoke: '🚫',
  };
  const actionColors = {
    login_success: 'var(--green)', login_failed: 'var(--red)', login_locked: 'var(--red)',
    logout: 'var(--dim)', password_change: 'var(--accent)', password_reset: 'var(--amber)',
    user_create: 'var(--green)', user_delete: 'var(--red)',
    camera_create: 'var(--green)', camera_delete: 'var(--red)',
    camera_group_assign: 'var(--accent)', camera_group_remove: 'var(--amber)',
  };
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:160px 130px 1fr 130px 100px;gap:10px;padding:10px 14px;background:var(--panel2);font-size:10px;color:var(--dim);font-weight:600;border-bottom:1px solid var(--border)">
      <div>${escapeHtml(I18N.t('evt.colTime'))}</div><div>User</div><div>Action / Details</div><div>IP</div><div>Target</div>
    </div>
    ${logs.map(l => `
      <div style="display:grid;grid-template-columns:160px 130px 1fr 130px 100px;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border);font-size:11px;align-items:center">
        <div style="font-size:10px;color:var(--dim)">${new Date(l.created_at).toLocaleString('th-TH', {hour12:false})}</div>
        <div style="font-weight:600">${l.username || '—'}</div>
        <div>
          <span style="color:${actionColors[l.action] || 'var(--text)'};font-weight:600">
            ${actionIcons[l.action] || '•'} ${l.action}
          </span>
          ${Object.keys(l.details || {}).length ? `<span style="color:var(--dim);font-size:10px;margin-left:6px">${JSON.stringify(l.details)}</span>` : ''}
        </div>
        <div style="font-family:monospace;font-size:10px;color:var(--dim)">${l.ip_address || '—'}</div>
        <div style="font-size:10px">${escapeHtml(l.target_camera_id || l.target_username || '—')}</div>
      </div>`).join('')}`;
}

// ── Sessions Manager ────────────────────────────────────────
function openSessionManager() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  const nav = document.querySelector('.nav-item[data-page="history"]');
  showPage('history', nav || undefined);
  historyNav('sessions');
}
function closeSessionManager() { /* sessions is a History Workspace section now — no modal */ }

// ── About Modal ─────────────────────────────────────────────
function openAboutModal() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  document.getElementById('aboutModal').classList.remove('hidden');
}
function closeAboutModal() {
  document.getElementById('aboutModal').classList.add('hidden');
}

async function loadSessions() {
  try {
    const res = await fetch('/api/auth/sessions');
    const sessions = await res.json();
    const el = document.getElementById('sessionsList');
    if (!sessions.length) {
      el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('ses.noSessions'))}</div>`;
      return;
    }
    el.innerHTML = sessions.map(s => {
      const ua = s.user_agent || '';
      const browser = ua.includes('Chrome') ? '🌐 Chrome' : ua.includes('Safari') ? '🧭 Safari' : ua.includes('Firefox') ? '🦊 Firefox' : '🖥 Other';
      const os = ua.includes('Mac') ? 'macOS' : ua.includes('Windows') ? 'Windows' : ua.includes('Linux') ? 'Linux' : ua.includes('iPhone') ? 'iOS' : ua.includes('Android') ? 'Android' : '';
      return `
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px">${browser} ${os ? `· ${os}` : ''} ${s.is_current ? '<span style="color:var(--green);font-size:10px">(THIS DEVICE)</span>' : ''}</div>
          <div style="font-size:10px;color:var(--dim);margin-top:3px">
            IP: <span style="font-family:monospace">${s.ip_address || '—'}</span> ·
            Created: ${new Date(s.created_at).toLocaleString('th-TH', {hour12:false})} ·
            Last used: ${new Date(s.last_used_at).toLocaleString('th-TH', {hour12:false})}
          </div>
        </div>
        ${!s.is_current ? `<button class="btn btn-danger" style="padding:5px 12px;font-size:11px" data-action="revokeSession" data-id="${escapeHtml(s.id)}">🚫 Revoke</button>` : ''}
      </div>`;
    }).join('');
  } catch (e) { alert('Error: ' + e.message); }
}

async function revokeSession(id) {
  if (!confirm(I18N.t('ses.confirmRevoke'))) return;
  try {
    await fetch(`/api/auth/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
    loadSessions();
  } catch (e) { alert('Error: ' + e.message); }
}

// ============================================================
// 🎨 Branding (white-label) — applies to sidebar / title / accent
// ============================================================
let _brand = null;

async function loadBrand() {
  try {
    const res = await fetch(`${API}/api/branding`, { cache: 'no-store' });
    if (!res.ok) return;
    _brand = await res.json();
    applyBrandToDom();
  } catch (e) { console.warn('loadBrand:', e.message); }
}

function applyBrandToDom() {
  if (!_brand) return;
  const logoIcon = document.getElementById('brandLogoIcon');
  if (logoIcon) {
    if (_brand.logo_url) {
      const url = `${_brand.logo_url}?v=${Date.now()}`;
      logoIcon.innerHTML = `<img src="${escapeHtml(url)}" alt="logo" style="width:36px;height:36px;object-fit:contain;display:block">`;
    } else {
      logoIcon.innerHTML = '📹';
    }
  }
  const nameEl = document.getElementById('brandName');
  if (nameEl)    nameEl.textContent = _brand.name || 'Vigil Platform';
  const tagEl = document.getElementById('brandTagline');
  if (tagEl)     tagEl.textContent = _brand.tagline || '';
  const footerName = document.getElementById('brandFooterName');
  if (footerName) footerName.textContent = _brand.name || 'Vigil Platform';
  if (_brand.name) document.title = _brand.name;
  if (_brand.primary_color) {
    document.documentElement.style.setProperty('--accent', _brand.primary_color);
  }
  const fav = document.getElementById('brandFavicon');
  if (fav) fav.href = '/favicon.ico?v=' + Date.now();
}

// Upload a new logo file (admin only). The server resizes & saves it.
async function uploadBrandLogo(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert(I18N.t('sys.logoTooBig')); fileInput.value = ''; return; }
  const fd = new FormData();
  fd.append('logo', file);
  try {
    const res = await fetch(`${API}/api/branding/logo`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const body = await res.json();
    await loadBrand();
    // also refresh preview in settings modal
    const prev = document.getElementById('brandLogoPreview');
    if (prev) prev.src = body.logo_url;
  } catch (e) {
    alert(I18N.t('sys.logoUploadFailed') + e.message);
  } finally {
    fileInput.value = '';
  }
}

async function clearBrandLogo() {
  if (!confirm(I18N.t('sys.confirmClearLogo'))) return;
  try {
    const res = await fetch(`${API}/api/branding/logo`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadBrand();
    const prev = document.getElementById('brandLogoPreview');
    if (prev) prev.removeAttribute('src');
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

// ============================================================
// 🏷️ Category Manager (Stats v2 — Phase 1)
// ============================================================

let _categoriesCache = [];

function openCategoryManager() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('categories');
}
function closeCategoryManager() { /* categories is a Settings Workspace section now — no modal */ }

async function loadCategories() {
  try {
    const res = await fetch(`${API}/api/categories`);
    if (!res.ok) throw new Error('Failed to load');
    _categoriesCache = await res.json();
    renderCategoriesList();
  } catch (e) { console.error('loadCategories:', e); }
}

function renderCategoriesList() {
  const cats = _categoriesCache;
  const builtinCount = cats.filter(c => c.is_builtin).length;
  document.getElementById('catCount').textContent = cats.length;
  document.getElementById('catBuiltinCount').textContent = builtinCount;

  const list = document.getElementById('categoriesList');
  if (!cats.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--dim)">${escapeHtml(I18N.t('cat.noCategories'))}</div>`;
    return;
  }
  list.innerHTML = cats.map(c => {
    const lockIcon = c.is_builtin ? `<svg aria-hidden="true" width="10" height="10" style="vertical-align:-1px;margin-right:3px;opacity:.6"><use href="#icon-lock"/></svg>` : '';
    const kindBadge = c.kind === 'people_counter'  ? '<span style="background:#22c55e30;color:#22c55e;padding:2px 6px;border-radius:4px;font-size:10px">PEOPLE</span>'
                    : c.kind === 'vehicle_counter' ? '<span style="background:#5b8def30;color:#5b8def;padding:2px 6px;border-radius:4px;font-size:10px">VEHICLE</span>'
                    : '<span style="background:#ef444430;color:#ef4444;padding:2px 6px;border-radius:4px;font-size:10px">EVENT</span>';
    return `
      <div class="cat-list-row">
        <div style="font-size:22px;line-height:1">${escapeHtml(c.icon || '')}</div>
        <div>
          <div style="font-weight:600;color:var(--text-primary)">${lockIcon}${escapeHtml(c.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary)">sort: ${c.sort_order}</div>
        </div>
        <div class="cat-col-kind">${kindBadge}</div>
        <div class="cat-col-color" style="display:flex;align-items:center;gap:5px">
          <div style="width:14px;height:14px;border-radius:3px;background:${escapeHtml(c.color || '#5b8def')}"></div>
          <span style="font-size:10px;color:var(--text-secondary);font-family:monospace">${escapeHtml(c.color || '')}</span>
        </div>
        <div class="cat-col-rules" style="font-size:11px;color:var(--text-secondary)">${c.rule_count} rules</div>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-secondary" style="font-size:11px;padding:5px 9px" data-action="openCatRules" data-id="${c.id}"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px;margin-right:4px"><use href="#icon-list"/></svg>Rules</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:5px 9px" data-action="openCatEditor" data-id="${c.id}"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px;margin-right:4px"><use href="#icon-edit"/></svg>Edit</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:5px 9px;${c.is_builtin?'opacity:0.4;pointer-events:none':''}" data-action="deleteCat" data-id="${c.id}" aria-label="Delete"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px"><use href="#icon-trash"/></svg></button>
        </div>
      </div>
    `;
  }).join('');
}

const _ICON_PRESETS = ['🚨','⚠️','🚶','🚗','🔥','🚦','📦','👁','🔔','🚧','🛑','🎯'];

function _renderIconPresets(selected) {
  const container = document.getElementById('ceIconPresets');
  if (!container) return;
  container.innerHTML = _ICON_PRESETS.map(e =>
    `<button type="button" class="icon-preset-btn${e === selected ? ' active' : ''}"
       data-action="selectIconPreset" data-preset="${e}" title="${e}">${e}</button>`
  ).join('');
}
function selectIconPreset(emoji) {
  document.getElementById('ceIcon').value = emoji;
  _renderIconPresets(emoji);
}
function syncIconPresets() {
  _renderIconPresets(document.getElementById('ceIcon').value.trim());
}

function openCategoryEditor(id) {
  const c = id ? _categoriesCache.find(x => x.id === id) : null;
  document.getElementById('categoryEditorTitle').textContent = c ? I18N.t('cat.editorEdit') : I18N.t('cat.editorAdd');
  document.getElementById('ceCatId').value = c ? c.id : '';
  document.getElementById('ceCatBuiltin').value = c?.is_builtin ? 'true' : 'false';
  document.getElementById('ceName').value  = c?.name  || '';
  document.getElementById('ceIcon').value  = c?.icon  || '';
  document.getElementById('ceColor').value = (c?.color && /^#[0-9a-f]{6}$/i.test(c.color)) ? c.color : '#5b8def';
  document.getElementById('ceSort').value  = c?.sort_order ?? 0;
  document.getElementById('ceName').disabled = !!c?.is_builtin;
  document.getElementById('ceNameLockNote').style.display = c?.is_builtin ? 'block' : 'none';
  _renderIconPresets(c?.icon || '');
  document.getElementById('categoryEditorModal').classList.remove('hidden');
}
function closeCategoryEditor() {
  document.getElementById('categoryEditorModal').classList.add('hidden');
}

async function saveCategory() {
  const id   = document.getElementById('ceCatId').value;
  const name = document.getElementById('ceName').value.trim();
  const icon = document.getElementById('ceIcon').value.trim();
  const color = document.getElementById('ceColor').value;
  const sort_order = parseInt(document.getElementById('ceSort').value, 10) || 0;
  if (!name) return alert(I18N.t('cat.needName'));
  const body = JSON.stringify({ name, icon, color, sort_order });
  const url    = id ? `${API}/api/categories/${id}` : `${API}/api/categories`;
  const method = id ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    closeCategoryEditor();
    await loadCategories();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

async function deleteCategory(id) {
  const c = _categoriesCache.find(x => x.id === id);
  if (!c) return;
  if (c.is_builtin) return alert(I18N.t('cat.builtinNoDelete'));
  if (!confirm(I18N.t('cat.confirmDelete').replace('{name}', c.name))) return;
  try {
    const res = await fetch(`${API}/api/categories/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await loadCategories();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

// ── Mapping Rules ───────────────────────────────────────────
async function openCategoryRules(catId) {
  const c = _categoriesCache.find(x => x.id === catId);
  document.getElementById('crCatId').value = catId;
  document.getElementById('catRulesTitle').textContent = `Mapping Rules — ${c ? (`${c.icon || ''} ${c.name}`.trim()) : ''}`;
  // populate camera dropdown
  const camSel = document.getElementById('crCamera');
  camSel.innerHTML = '<option value="">* any</option>';
  try {
    const res = await fetch(`${API}/api/cameras`);
    if (res.ok) {
      const cams = await res.json();
      cams.forEach(cam => {
        const opt = document.createElement('option');
        opt.value = cam.camera_id;
        opt.textContent = `${cam.camera_id} (${cam.camera_name || ''})`;
        camSel.appendChild(opt);
      });
    }
  } catch {}
  // reset form
  document.getElementById('crRule').value = '';
  document.getElementById('crEventType').value = '';
  document.getElementById('crObjClass').value = '';
  document.getElementById('crState').value = 'true';
  document.getElementById('crPri').value = 0;
  await Promise.all([loadCategoryRules(), loadFacets()]);
  document.getElementById('categoryRulesModal').classList.remove('hidden');
}

// Populate <datalist> for rule_name + event_type from real DB values.
// Optionally narrow to the camera currently picked in the form.
async function loadFacets() {
  const camId = document.getElementById('crCamera')?.value || '';
  const url = camId
    ? `${API}/api/events/facets?camera_id=${encodeURIComponent(camId)}`
    : `${API}/api/events/facets`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const f = await res.json();
    const fill = (id, items) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
    };
    fill('ruleNamesList',  f.rule_names);
    fill('eventTypesList', f.event_types);
  } catch (e) { console.warn('loadFacets:', e.message); }
}
function closeCategoryRules() {
  document.getElementById('categoryRulesModal').classList.add('hidden');
  loadCategories();  // refresh rule_count badges
}

async function loadCategoryRules() {
  const catId = document.getElementById('crCatId').value;
  const list  = document.getElementById('categoryRulesList');
  if (!list) return;
  if (!catId) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444">${escapeHtml(I18N.t('cat.ruleIdMissing'))}</div>`;
    return;
  }
  try {
    const res = await fetch(`${API}/api/categories/${encodeURIComponent(catId)}/rules?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
    }
    const rules = await res.json();
    console.log(`[Rules] cat=${catId} count=${Array.isArray(rules) ? rules.length : '?'}`, rules);
    if (!Array.isArray(rules)) {
      throw new Error('unexpected response (not an array)');
    }
    if (!rules.length) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--dim)">
        ${escapeHtml(I18N.t('cat.noRules'))}
        <div style="font-size:10px;margin-top:6px;opacity:0.6">category id = ${escapeHtml(catId)}</div>
      </div>`;
      return;
    }
    list.innerHTML = `
      <div class="cat-rule-grid cat-rule-head" style="padding:10px 12px;background:var(--panel2);font-size:10px;color:var(--dim);border-bottom:1px solid var(--border)">
        <div>Camera</div><div>Rule</div><div>Event Type</div><div>Object Class</div><div>State</div><div>Pri</div><div></div>
      </div>
    ` + rules.map(r => {
      const w = v => v == null || v === '' ? '<span style="color:var(--dim)">*</span>' : escapeHtml(v);
      return `
        <div class="cat-rule-grid" style="padding:9px 12px;border-bottom:1px solid var(--border);font-size:11px">
          <div class="cat-rule-list-cell">${w(r.camera_id)}</div>
          <div class="cat-rule-list-cell">${w(r.rule_name)}</div>
          <div class="cat-rule-list-cell">${w(r.event_type)}</div>
          <div class="cat-rule-list-cell">${w(r.object_class)}</div>
          <div class="cat-rule-list-cell">${w(r.match_state)}</div>
          <div class="cat-rule-list-cell">${r.priority}</div>
          <div><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px" data-action="deleteCatRule" data-id="${r.id}">🗑️</button></div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('loadCategoryRules:', e);
    list.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444">
      ${escapeHtml(I18N.t('cat.rulesLoadFailed'))}${escapeHtml(e.message || String(e))}
      <div style="font-size:10px;margin-top:6px;opacity:0.7">category id = ${escapeHtml(catId)}</div>
    </div>`;
  }
}

async function addCategoryRule() {
  const catId = document.getElementById('crCatId').value;
  const btn   = document.querySelector('#categoryRulesModal button.btn-primary');
  const body  = JSON.stringify({
    camera_id:    document.getElementById('crCamera').value,
    rule_name:    document.getElementById('crRule').value.trim(),
    event_type:   document.getElementById('crEventType').value.trim(),
    object_class: document.getElementById('crObjClass').value,
    match_state:  document.getElementById('crState').value,
    priority:     parseInt(document.getElementById('crPri').value, 10) || 0,
  });
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  console.log(`[Rule Add] cat=${catId} body=${body}`);
  try {
    const res = await fetch(`${API}/api/categories/${catId}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    console.log(`[Rule Add] POST status=${res.status}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const created = await res.json().catch(() => null);
    console.log('[Rule Add] created:', created);
    document.getElementById('crRule').value = '';
    document.getElementById('crEventType').value = '';
    await loadCategoryRules();
    invalidateStats();             // refresh KPIs/charts when stats page next opens
    if (btn) { btn.textContent = '✓ Added'; setTimeout(() => { btn.textContent = '+ Add'; btn.disabled = false; }, 900); }
  } catch (e) {
    if (btn) { btn.textContent = '+ Add'; btn.disabled = false; }
    alert(I18N.t('cat.addRuleFailed') + e.message);
  }
}

async function deleteCategoryRule(ruleId) {
  if (!confirm(I18N.t('cat.confirmDeleteRule'))) return;
  try {
    await fetch(`${API}/api/category-rules/${ruleId}`, { method: 'DELETE' });
    await loadCategoryRules();
    invalidateStats();
  } catch (e) { alert('Error: ' + e.message); }
}

// Mark Stats page as needing a refresh — runs immediately if Stats is the
// active page (so the user sees their change reflected without clicking
// a period button), otherwise the refresh happens next time they switch
// to Stats. activePage / loadStats are defined elsewhere in this file.
function invalidateStats() {
  if (typeof activePage !== 'undefined' && activePage === 'stats' && typeof loadStats === 'function') {
    loadStats();
  }
}

// ============================================================
// ⚙️ System Settings
// ============================================================
const SETTING_LABELS = {
  data_retention_days:         { label: I18N.t('sys.dataRetentionLabel'),    input: 'number', min: 1, max: 730, hint: I18N.t('sys.dataRetentionHint') },
  appearances_retention_days:  { label: I18N.t('sys.appRetentionLabel'),     input: 'number', min: 1, max: 730, hint: I18N.t('sys.appRetentionHint') },
  snapshot_retention_days: { label: I18N.t('sys.snapRetentionLabel'), input: 'number',  min: 1, max: 365, hint: I18N.t('sys.snapRetentionHint') },
  clip_retention_days:     { label: I18N.t('sys.clipRetentionLabel'), input: 'number',  min: 1, max: 90,  hint: I18N.t('sys.clipRetentionHint') },
  custom_range_max_days:   { label: I18N.t('sys.customRangeLabel'),   input: 'number',  min: 1, max: 730, hint: I18N.t('sys.customRangeHint') },
  display_timezone:        { label: I18N.t('sys.timezoneLabel'),      input: 'select',  options: ['Asia/Bangkok','UTC','Asia/Tokyo','Asia/Singapore'], hint: I18N.t('sys.timezoneHint') },
  counter_dedup_mode:      { label: I18N.t('sys.dedupLabel'),         input: 'select',  options: ['state','object_window','none'], hint: I18N.t('sys.dedupHint') },
  comparison_mode:         { label: I18N.t('sys.comparisonLabel'),    input: 'select',  options: ['rolling','calendar'], hint: I18N.t('sys.comparisonHint') },
};

function openSystemSettings() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('system');
}
function closeSystemSettings() { /* system is a Settings Workspace section now — no modal */ }

async function loadSystemSettings() {
  try {
    const res = await fetch(`${API}/api/settings`);
    if (!res.ok) throw new Error('failed');
    const settings = await res.json();
    const list = document.getElementById('systemSettingsList');

    // ── Branding section (always shown first) ─────────────────
    const brandName    = settings.brand_name?.value          || 'Vigil Platform';
    const brandTagline = settings.brand_tagline?.value       || '';
    const brandLogo    = settings.brand_logo_path?.value     || '';
    const brandColor   = settings.brand_primary_color?.value || '#5b8def';
    const logoUrl      = brandLogo ? `/branding/${escapeHtml(brandLogo)}?v=${Date.now()}` : '';
    const brandingBlock = `
      <div style="margin-bottom:18px;padding:14px;background:var(--panel2);border:1px solid var(--accent);border-radius:8px">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px">🎨 Branding</div>

        <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px">
          <div style="width:96px;height:96px;background:var(--panel);border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${logoUrl
              ? `<img id="brandLogoPreview" src="${logoUrl}" style="max-width:100%;max-height:100%;object-fit:contain">`
              : `<img id="brandLogoPreview" style="max-width:100%;max-height:100%;object-fit:contain;display:none">
                 <span style="color:var(--dim);font-size:10px">no logo</span>`}
          </div>
          <div style="flex:1">
            <label class="form-label">Logo</label>
            <input type="file" id="brandLogoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="font-size:11px;width:100%" data-change="uploadBrandLogo">
            <div style="font-size:10px;color:var(--dim);margin-top:4px">PNG / JPG / WebP / SVG (max 5MB) — server resize to 256×256</div>
            ${brandLogo ? `<button class="csv-btn" style="margin-top:6px" data-action="clearBrandLogo">🗑️ Remove logo</button>` : ''}
          </div>
        </div>

        <div style="margin-bottom:10px">
          <label class="form-label">Product Name</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" class="form-input" id="ss_brand_name" value="${escapeHtml(brandName)}" maxlength="100" style="font-size:12px">
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="brand_name"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
        </div>

        <div style="margin-bottom:10px">
          <label class="form-label">Tagline</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" class="form-input" id="ss_brand_tagline" value="${escapeHtml(brandTagline)}" maxlength="200" style="font-size:12px">
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="brand_tagline"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
        </div>

        <div>
          <label class="form-label">Accent Color</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" class="form-input" id="ss_brand_primary_color" value="${escapeHtml(brandColor)}" style="height:38px;width:60px;padding:0">
            <input type="text" class="form-input" id="ss_brand_primary_color_text" value="${escapeHtml(brandColor)}" pattern="^#[0-9a-fA-F]{6}$" style="font-size:12px;font-family:monospace;flex:0 0 110px"
              data-input="syncBrandColor">
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveBrandColor"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
          <div style="font-size:10px;color:var(--dim);margin-top:4px">${escapeHtml(I18N.t('sys.accentHint'))}</div>
        </div>

        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--dim)">
          ${escapeHtml(I18N.t('sys.footerLocked'))}
        </div>
      </div>
    `;

    // ── Other settings (using SETTING_LABELS) ────────────────
    const others = Object.entries(SETTING_LABELS).map(([key, def]) => {
      const cur = settings[key]?.value || '';
      let inputHtml;
      if (def.input === 'select') {
        inputHtml = `<select class="form-input" id="ss_${key}" style="font-size:12px">
          ${def.options.map(o => `<option value="${escapeHtml(o)}" ${o===cur?'selected':''}>${escapeHtml(o)}</option>`).join('')}
        </select>`;
      } else {
        inputHtml = `<input type="number" class="form-input" id="ss_${key}" value="${escapeHtml(cur)}" min="${def.min}" max="${def.max}" style="font-size:12px">`;
      }
      return `
        <div style="padding:12px;background:var(--panel2);border-radius:8px">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">${def.label}</div>
          <div style="font-size:10px;color:var(--dim);margin-bottom:8px">${def.hint}</div>
          <div style="display:flex;gap:8px;align-items:center">
            ${inputHtml}
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="${escapeHtml(key)}"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
          <div style="font-size:10px;color:var(--dim);margin-top:5px">key: <code>${key}</code></div>
        </div>
      `;
    }).join('');

    // ── Camera Analytics Events section (Phase 7.1) ───────────
    // These events fire automatically from the camera (not IVA rules).
    // Each checkbox = "show this type in the Events feed". Stored as a CSV
    // in system_settings.analytics_event_display. Default (when the row
    // hasn't been touched) = image-quality + scene-change on, I/O off.
    const analyticsDefault = 'ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange';
    const analyticsEnabled = new Set(
      (settings.analytics_event_display?.value ?? analyticsDefault)
        .split(',').map(s => s.trim()).filter(Boolean)
    );
    const ANALYTICS_OPTS = [
      { key: 'ImageTooBright',        label: I18N.t('sys.optBright') },
      { key: 'ImageTooBlurry',        label: I18N.t('sys.optBlurry') },
      { key: 'ImageTooDark',          label: I18N.t('sys.optDark') },
      { key: 'GlobalSceneChange',     label: I18N.t('sys.optScene') },
      { key: 'Trigger/DigitalInput',  label: I18N.t('sys.optDigitalIn') },
      { key: 'Trigger/Relay',         label: I18N.t('sys.optRelay') },
    ];
    const analyticsBlock = `
      <div style="margin-bottom:14px;padding:12px;background:var(--panel2);border-radius:8px">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">Camera Analytics Events</div>
        <div style="font-size:10px;color:var(--dim);margin-bottom:8px">
          ${escapeHtml(I18N.t('sys.analyticsDesc'))}
        </div>
        ${ANALYTICS_OPTS.map(o => `
          <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer">
            <input type="checkbox" class="ss-analytics-cb" value="${escapeHtml(o.key)}" ${analyticsEnabled.has(o.key) ? 'checked' : ''}>
            <span>${escapeHtml(o.label)}</span>
          </label>`).join('')}
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveAnalyticsDisplay"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          <span style="font-size:10px;color:var(--dim)">key: <code>analytics_event_display</code></span>
        </div>
      </div>`;

    list.innerHTML = brandingBlock + '<div class="ss-grid">' + others + '</div>' + analyticsBlock;

    // Sync color picker with text field
    const colorPicker = document.getElementById('ss_brand_primary_color');
    if (colorPicker) {
      colorPicker.addEventListener('input', () => {
        document.getElementById('ss_brand_primary_color_text').value = colorPicker.value;
      });
    }
  } catch (e) { console.error('loadSystemSettings:', e); }
}

// Save brand_primary_color from either the picker or the hex text input
async function saveBrandColor() {
  const v = document.getElementById('ss_brand_primary_color').value;
  document.getElementById('ss_brand_primary_color_text').value = v;
  try {
    const res = await fetch(`${API}/api/settings/brand_primary_color`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: v }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await loadBrand();    // immediate effect on dashboard accent
  } catch (e) { alert(I18N.t('sys.colorSaveFailed') + e.message); }
}

async function saveSetting(key) {
  const value = document.getElementById('ss_' + key).value;
  try {
    const res = await fetch(`${API}/api/settings/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (key.startsWith('brand_')) await loadBrand();   // live-update sidebar / title / accent
    const btn = document.activeElement;
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = orig, 1500); }
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

// Save the analytics-event display toggles — collects the checked boxes
// into a CSV and PUTs system_settings.analytics_event_display. The server
// validates against its known key list and refreshes its in-memory filter
// set immediately, so the Events feed reflects the change without a reload.
async function saveAnalyticsDisplay() {
  const checked = [...document.querySelectorAll('.ss-analytics-cb:checked')]
    .map(cb => cb.value);
  try {
    const res = await fetch(`${API}/api/settings/analytics_event_display`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: checked.join(',') }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const btn = document.activeElement;
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = orig, 1500); }
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

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

// ============================================================
// 💓 Health Check page
// ============================================================
let _healthTimer = null;

function startHealthAutoRefresh() {
  if (_healthTimer) return;
  _healthTimer = setInterval(loadHealth, 15000);
}
function stopHealthAutoRefresh() {
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
}

function _healthBadge(level, label) {
  const bg = level === 'ok' ? `${token('--status-ok')}26` : level === 'warn' ? `${token('--warn')}26` : `${token('--status-bad')}26`;
  const fg = level === 'ok' ? token('--status-ok') : level === 'warn' ? token('--warn') : token('--status-bad');
  return `<span style="display:inline-block;padding:2px 8px;background:${bg};color:${fg};border-radius:99px;font-size:10px;font-weight:700">${escapeHtml(label)}</span>`;
}

function _healthCard(title, badge, rows) {
  const body = rows.map(([k, v]) =>
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed var(--border);font-size:11px">
      <span style="color:var(--dim)">${escapeHtml(k)}</span>
      <span style="color:var(--text);font-weight:600;text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>
    </div>`
  ).join('');
  return `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700">${escapeHtml(title)}</div>
        ${badge}
      </div>
      ${body}
    </div>`;
}

function _svcCard(svcs) {
  const anyDown = svcs.some(s => s.status !== 'online');
  const overallBadge = _healthBadge(anyDown ? 'warn' : 'ok', anyDown ? 'CHECK' : 'OK');
  const btnBase = `padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid`;
  const rows = svcs.map(s => {
    const lvl = s.status === 'online' ? 'ok' : s.status === 'errored' ? 'err' : 'warn';
    const badge = _healthBadge(lvl, s.status.toUpperCase());
    const uptime = s.uptime_ms != null ? _humanSec(Math.round(s.uptime_ms / 1000)) : '—';
    const restartNote = s.restarts > 0 ? ` <span style="color:var(--warn);font-size:9px">(↺${s.restarts})</span>` : '';
    const svcName = escapeHtml(s.name);
    // api-server stop = dashboard bricks with no UI recovery → restrict to Restart only.
    const canStop  = s.name !== 'api-server' && (s.status === 'online' || s.status === 'launching');
    const canStart = s.name !== 'api-server' && (s.status === 'stopped' || s.status === 'errored');
    const restartBtn = `<button class="admin-only" data-action="svcAction" data-svc="${svcName}" data-svc-cmd="restart" style="${btnBase} var(--accent);color:var(--accent);background:transparent" title="${I18N.t('hlth.svcRestart')}">${I18N.t('hlth.svcRestart')}</button>`;
    const stopBtn   = canStop  ? `<button class="admin-only" data-action="svcAction" data-svc="${svcName}" data-svc-cmd="stop"    style="${btnBase} var(--warn);color:var(--warn);background:transparent"   title="${I18N.t('hlth.svcStop')}">${I18N.t('hlth.svcStop')}</button>` : '';
    const startBtn  = canStart ? `<button class="admin-only" data-action="svcAction" data-svc="${svcName}" data-svc-cmd="start"   style="${btnBase} var(--status-ok);color:var(--status-ok);background:transparent" title="${I18N.t('hlth.svcStart')}">${I18N.t('hlth.svcStart')}</button>` : '';
    // Left col: name + uptime sub-line; right col: badge + buttons.
    // Uptime moved to left col so right col stays ≤180px — fits 280px card.
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 0;border-bottom:1px dashed var(--border)">
      <div style="min-width:0;flex:1;overflow:hidden">
        <div style="font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${svcName}${restartNote}</div>
        <div style="font-size:9px;color:var(--text-secondary)">${uptime}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        ${badge}${restartBtn}${stopBtn}${startBtn}
      </div>
    </div>`;
  }).join('');
  return `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700">${I18N.t('hlth.svcTitle')}</div>
        ${overallBadge}
      </div>
      ${rows || `<div style="font-size:11px;color:var(--dim)">—</div>`}
    </div>`;
}

window._svcAction = async function(name, action) {
  if (action === 'stop') {
    if (!confirm(I18N.t('hlth.svcStopConfirm').replace('{name}', name))) return;
  } else if (action === 'restart' && name === 'api-server') {
    if (!confirm(I18N.t('hlth.svcApiRestartWarn'))) return;
  }
  const grid = document.getElementById('healthGrid');
  try {
    const r = await fetch(`${API}/api/services/${encodeURIComponent(name)}/${encodeURIComponent(action)}`, {
      method: 'POST', credentials: 'include',
    });
    const data = await r.json().catch(() => ({}));
    if (data.expect_reconnect) {
      if (grid) grid.insertAdjacentHTML('afterbegin',
        `<div id="_svcRestartBanner" style="grid-column:1/-1;padding:10px 14px;background:${token('--warn')}26;color:var(--warn);border-radius:8px;font-size:12px;font-weight:600">${I18N.t('hlth.svcRestarting')}</div>`);
      _pollApiServerRecovery();
      return;
    }
    if (!r.ok) { alert(data.error || `Error ${r.status}`); return; }
    setTimeout(loadHealth, 1500);
  } catch (e) {
    if (name === 'api-server') { _pollApiServerRecovery(); return; }
    console.error('svcAction error', e);
  }
};

function _pollApiServerRecovery() {
  let tries = 0;
  const MAX = 30;
  const t = setInterval(async () => {
    tries++;
    try {
      const r = await fetch(`${API}/api/health/details`, { cache: 'no-store', credentials: 'include' });
      if (r.ok) {
        clearInterval(t);
        const banner = document.getElementById('_svcRestartBanner');
        if (banner) banner.remove();
        loadHealth();
      }
    } catch {}
    if (tries >= MAX) { clearInterval(t); loadHealth(); }
  }, 1000);
}

function _humanSec(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 60) return n + 's';
  if (n < 3600) return Math.floor(n / 60) + 'm ' + (n % 60) + 's';
  if (n < 86400) return Math.floor(n / 3600) + 'h ' + Math.floor((n % 3600) / 60) + 'm';
  return Math.floor(n / 86400) + 'd ' + Math.floor((n % 86400) / 3600) + 'h';
}

async function loadHealth() {
  const grid = document.getElementById('healthGrid');
  if (!grid) return;
  try {
    const res = await fetch(`${API}/api/health/details`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const h = await res.json();

    const dbBadge = h.db.ok
      ? _healthBadge('ok', `${h.db.latency_ms}ms`)
      : _healthBadge('err', 'DOWN');
    const mqttLevel = h.mqtt_pipeline.status === 'healthy' ? 'ok'
                    : h.mqtt_pipeline.status === 'idle'    ? 'warn'
                    : h.mqtt_pipeline.status === 'stale'   ? 'err'  : 'warn';
    const camLevel = h.cameras.offline > 0 ? 'warn' : 'ok';
    const memUsedMb = h.server.total_mem_mb - h.server.free_mem_mb;
    const memPct = h.server.total_mem_mb ? Math.round(memUsedMb / h.server.total_mem_mb * 100) : 0;
    const memLevel = memPct > 85 ? 'err' : memPct > 70 ? 'warn' : 'ok';
    const diskPct = (h.storage.disk_total_gb && h.storage.disk_free_gb != null)
      ? Math.round((1 - h.storage.disk_free_gb / h.storage.disk_total_gb) * 100) : null;
    const diskLevel = diskPct == null ? 'warn' : diskPct > 90 ? 'err' : diskPct > 75 ? 'warn' : 'ok';

    const cards = [];

    cards.push(_healthCard('Database (PostgreSQL)', dbBadge, [
      [I18N.t('hlth.rowStatus'), h.db.ok ? '✓ Connected' : '✗ ' + (h.db.error || 'unreachable')],
      ['Latency', h.db.latency_ms != null ? h.db.latency_ms + ' ms' : '—'],
      ['Total events', h.events.total.toLocaleString()],
      ['Events / hr (1h)', h.events.last_hour.toLocaleString()],
      ['Events / day (24h)', h.events.last_24h.toLocaleString()],
    ]));

    cards.push(_healthCard('MQTT Pipeline', _healthBadge(mqttLevel, h.mqtt_pipeline.status.toUpperCase()), [
      ['Last event', h.mqtt_pipeline.last_event_at ? new Date(h.mqtt_pipeline.last_event_at).toLocaleString('th-TH', {hour12:false}) : I18N.t('hlth.noEvent')],
      ['Age', _humanSec(h.mqtt_pipeline.age_sec)],
      [I18N.t('hlth.rowDesc'),
        h.mqtt_pipeline.status === 'healthy' ? I18N.t('hlth.mqttHealthy') :
        h.mqtt_pipeline.status === 'idle'    ? I18N.t('hlth.mqttIdle') :
        h.mqtt_pipeline.status === 'stale'   ? I18N.t('hlth.mqttStale') :
        I18N.t('hlth.mqttNone')],
    ]));

    cards.push(_healthCard('Cameras', _healthBadge(camLevel, `${h.cameras.online}/${h.cameras.total} online`), [
      ['Total cameras', h.cameras.total],
      ['Online (heartbeat <90s)', h.cameras.online],
      ['Offline / unknown', h.cameras.offline],
    ]));

    // Service Management — PM2-backed status + Restart/Stop/Start per service.
    cards.push(_svcCard(h.services || []));

    // Phase 7.1 — camera image-quality diagnostics from auto-analytics events.
    // High counts = a camera that needs attention (dirty lens, focus drift,
    // lighting change, or possible tampering).
    const iq = h.image_quality || [];
    const iqTotal = iq.reduce((s, c) =>
      s + c.too_bright + c.too_blurry + c.too_dark + c.scene_change, 0);
    const iqLevel = iqTotal === 0 ? 'ok' : iqTotal > 20 ? 'warn' : 'ok';
    const iqRows = iq.length === 0
      ? [[I18N.t('hlth.rowStatus'), I18N.t('hlth.iqNoIssues')]]
      : [['', I18N.t('hlth.iqLegend')],
         ...iq.map(c => [
           c.camera_id,
           `Bright:${c.too_bright} Blur:${c.too_blurry} Dark:${c.too_dark} Scene:${c.scene_change}`,
         ])];
    cards.push(_healthCard('Camera Image Quality (24h)',
      _healthBadge(iqLevel, iqTotal + ' events'), iqRows));

    // Phase 7.5 — camera automation triggers (Digital I/O + Relay).
    // These fire from physical wiring (door sensor, alarm contact, relay
    // output), not IVA rules. Filtered out of Stats / Executive Summary
    // by default (analytics_event_display); surfaced here so the operator
    // can confirm "did the relay actually fire today?"
    const at = h.automation_triggers || [];
    const atTotal = at.reduce((s, c) => s + c.digital_input + c.relay, 0);
    const atRows = at.length === 0
      ? [[I18N.t('hlth.rowStatus'), I18N.t('hlth.atNoSignal')]]
      : [['', 'Digital Input / Relay'],
         ...at.map(c => [
           c.camera_id,
           `DI:${c.digital_input}  Relay:${c.relay}  · ${c.last_trigger_at ? new Date(c.last_trigger_at).toLocaleTimeString('th-TH', {hour12:false}) : '—'}`,
         ])];
    cards.push(_healthCard('Camera Automation Triggers (24h)',
      _healthBadge('ok', atTotal + ' events'), atRows));

    cards.push(_healthCard('Storage', _healthBadge(diskLevel, diskPct != null ? diskPct + '% used' : 'unknown'), [
      ['Snapshot files', h.storage.snapshots_files.toLocaleString()],
      ['Snapshot size', h.storage.snapshots_mb + ' MB'],
      ['Clip files', (h.storage.clips_files ?? 0).toLocaleString()],
      ['Clip size', (h.storage.clips_mb ?? 0) + ' MB'],
      ['Clips (24h)', (h.storage.clips_today ?? 0).toLocaleString()],
      ['Oldest clip', h.storage.clips_oldest_at ? new Date(h.storage.clips_oldest_at).toLocaleDateString('th-TH') : '—'],
      ['Disk free', h.storage.disk_free_gb != null  ? h.storage.disk_free_gb + ' GB'  : '—'],
      ['Disk total', h.storage.disk_total_gb != null ? h.storage.disk_total_gb + ' GB' : '—'],
      ['Event retention',    h.storage.retention_days_events    ? h.storage.retention_days_events    + I18N.t('hlth.days') : '—'],
      ['Snapshot retention', h.storage.retention_days_snapshots ? h.storage.retention_days_snapshots + I18N.t('hlth.days') : '—'],
      ['Clip retention',     h.storage.retention_days_clips     ? h.storage.retention_days_clips     + I18N.t('hlth.days') : '—'],
    ]));

    cards.push(_healthCard('API Server', _healthBadge(memLevel, _humanSec(h.server.uptime_sec)), [
      ['Process uptime', _humanSec(h.server.uptime_sec)],
      ['Node version', h.server.node_version],
      ['PID', h.server.pid],
      ['RSS memory', h.server.memory_rss_mb + ' MB'],
      ['Heap used', h.server.memory_heap_mb + ' MB'],
      ['WebSocket clients', h.websocket.clients],
    ]));

    cards.push(_healthCard('Host', _healthBadge('ok', `load ${h.server.load_avg_1m}`), [
      ['Hostname', h.server.hostname],
      ['Platform', h.server.platform],
      ['Total RAM', h.server.total_mem_mb + ' MB'],
      ['Free RAM', h.server.free_mem_mb + ' MB'],
      ['Used', memPct + '%'],
      ['Load avg (1m)', h.server.load_avg_1m],
    ]));

    grid.innerHTML = cards.join('');
    const t = document.getElementById('healthLastUpdate');
    if (t) t.textContent = I18N.t('hlth.lastUpdate') + new Date(h.timestamp).toLocaleTimeString('th-TH', {hour12:false});
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;background:var(--panel);border:1px solid var(--red);border-radius:10px;color:var(--red);font-size:12px">${escapeHtml(I18N.t('hlth.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================
// 📈 Executive Summary page (Phase 7 — SPA merge)
// ============================================================
// Security Morning Briefing (Phase 1 / decision #172)
// ============================================================
// Was "Executive Summary" — persona changed from executive to
// Security Manager (morning check: is the system ok? any alerts?).
// Layout: Status Strip → Attention (alerts + offline cams) →
// Activity 24H + Today vs Yesterday → Site Map + Top Hotspots → Footer.
// Uses semantic tokens (--surface-elevated etc.) — no --es-* namespace.
// Backend: same /api/stats/executive-summary endpoint (no API change).

const _SUMMARY_REFRESH_MS = 30_000;

let _smbActivityChart  = null;
let _summaryMapInstance = null;
let _summaryMapSource   = null;
let _summaryHeatLayer   = null;
let _summaryMarkerLayer = null;
let _summaryShowHeat    = true;
let _summaryMapCentered = false;
let _summaryRefreshTimer = null;
let _summaryHasLoadedOnce = false;

const _summaryFmt = {
  num: n => Number(n || 0).toLocaleString(),
  pct: n => (n > 0 ? '+' : '') + (n ?? 0).toFixed(1) + '%',
  bytes: b => {
    if (!b) return '0 B';
    const units = ['B','KB','MB','GB','TB','PB'];
    let i = 0; let v = b;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
  },
  duration: secs => {
    if (!secs) return '0s';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  },
  timeShort: iso => {
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
  },
  hourLabel: iso => {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':00';
  },
};

async function loadSummary() {
  try {
    const res = await fetch(`${API}/api/stats/executive-summary`, { cache: 'no-store' });
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${res.status}${body ? ' · ' + body : ''}`);
    }
    const data = await res.json();
    _summaryApply(data);
    _summaryHasLoadedOnce = true;
    _summaryHideError();
  } catch (err) {
    console.warn('[summary] API failed:', err);
    _summaryShowError(err, _summaryHasLoadedOnce);
  }
}

function _summaryApply(d) {
  _smbRenderStrip(d.kpis, d.cameras, d.system);
  _smbRenderAttention(d.recent_events, d.cameras);
  _smbRenderActivity(d.events_24h);
  _smbRenderKpis(d.kpis);
  _smbRenderTopCams(d.top_cameras);
  _smbRenderFooter(d.system);
  _summaryInitMap(d.cameras.locations);
}

// 1. Status Strip
function _smbRenderStrip(kpis, cams, sys) {
  const el = document.getElementById('smbStrip');
  if (!el) return;
  const ratio = cams.total ? cams.online / cams.total : 1;
  const healthCls = ratio < 0.70 ? 'smb-bad' : ratio < 0.90 ? 'smb-warn' : 'smb-ok';
  const healthLabel = ratio < 0.70 ? I18N.t('smb.healthCrit') : ratio < 0.90 ? I18N.t('smb.healthWarn') : I18N.t('smb.healthOk');
  const mqttCls = sys.mqtt_connected ? 'smb-ok' : 'smb-bad';
  const mqttLabel = sys.mqtt_connected ? I18N.t('smb.stripMqttLive') : I18N.t('smb.stripMqttOff');
  const diskPct = sys.storage_total_bytes
    ? Math.round(sys.storage_used_bytes / sys.storage_total_bytes * 100) : 0;
  const diskCls = diskPct >= 90 ? 'smb-bad' : diskPct >= 75 ? 'smb-warn' : '';
  el.innerHTML =
    `<span class="${healthCls}">${healthLabel}</span><span class="smb-strip-sep">·</span>` +
    `<span><span style="color:var(--status-ok)">${cams.online}</span>/${cams.total} ${I18N.t('smb.stripCamsOnline')}</span><span class="smb-strip-sep">·</span>` +
    `<span class="${mqttCls}">${mqttLabel}</span><span class="smb-strip-sep">·</span>` +
    `<span class="${diskCls}">${diskPct}% disk</span><span class="smb-strip-sep">·</span>` +
    `<span>up ${_summaryFmt.duration(sys.uptime_seconds)}</span>`;
}

// 2a. Attention — alerts (recent events with rule_name within 4h)
// 2b. Attention — offline cameras
function _smbRenderAttention(recentEvents, cams) {
  const fourHAgo = Date.now() - 4 * 3600 * 1000;
  const alerts = (recentEvents || []).filter(e =>
    e.rule_name && new Date(e.event_time).getTime() >= fourHAgo
  );

  const alertEl = document.getElementById('smbAlerts');
  const countEl = document.getElementById('smbAlertCount');
  if (alertEl) {
    if (!alerts.length) {
      alertEl.innerHTML = `<div class="smb-empty">${escapeHtml(I18N.t('smb.noAlerts4h'))}</div>`;
    } else {
      alertEl.innerHTML = alerts.map(e => {
        const img = e.snapshot_url ? `<img src="${escapeHtml(e.snapshot_url)}?w=120" loading="lazy" alt="">` : '';
        const evJson = escapeHtml(JSON.stringify({
          id:e.id, event_time:e.event_time, camera_id:e.camera_id,
          event_type:e.event_type, rule_name:e.rule_name,
          object_class:e.object_class, snapshot_file:e.snapshot_file||null,
        }));
        return `<div class="smb-alert-row" data-action="summaryOpenEvent" data-event-json="${evJson}">
          <div class="smb-alert-thumb">${img}</div>
          <div class="smb-alert-body">
            <div class="smb-alert-rule">${escapeHtml(e.rule_name)}</div>
            <div class="smb-alert-meta">${escapeHtml(e.camera_id||'')} · ${_summaryFmt.timeShort(e.event_time)}</div>
          </div></div>`;
      }).join('');
    }
  }
  if (countEl) countEl.textContent = alerts.length > 0 ? String(alerts.length) : '';

  const offline = (cams.locations || []).filter(c => !c.online)
    .sort((a, b) => new Date(a.last_seen_at||0) - new Date(b.last_seen_at||0));
  const offEl = document.getElementById('smbOffline');
  const offCountEl = document.getElementById('smbOfflineCount');
  if (offEl) {
    if (!offline.length) {
      offEl.innerHTML = `<div class="smb-empty" style="color:var(--status-ok)">${escapeHtml(I18N.t('smb.allOnline'))}</div>`;
    } else {
      offEl.innerHTML = offline.slice(0, 5).map(c => {
        const dur = c.last_seen_at
          ? _summaryFmt.duration(Math.floor((Date.now() - new Date(c.last_seen_at)) / 1000))
          : '—';
        return `<div class="smb-offline-row">
          <div class="smb-offline-dot"></div>
          <div class="smb-offline-name">${escapeHtml(c.camera_name||c.camera_id)}</div>
          <div class="smb-offline-dur">${escapeHtml(dur)}</div>
        </div>`;
      }).join('');
    }
  }
  if (offCountEl) offCountEl.textContent = offline.length > 0 ? String(offline.length) : '';
}

// Click an alert row → open event in context
function summaryOpenEvent(ev) {
  if (!ev) return;
  if (ev.event_type === 'FaceCapture' || ev.rule_name === 'Face Capture') {
    showPage('faces', document.querySelector('.nav-item[data-page="faces"]'));
    loadFaces().then(() => openFaceModal(ev.id)).catch(() => {});
  } else {
    showSnapshot(ev);
  }
}

// 3a. Activity 24H chart
function _smbRenderActivity(events_24h) {
  const labels = (events_24h||[]).map(e => _summaryFmt.hourLabel(e.hour));
  const data   = (events_24h||[]).map(e => e.count);
  if (_smbActivityChart) {
    _smbActivityChart.data.labels = labels;
    _smbActivityChart.data.datasets[0].data = data;
    _smbActivityChart.update('none');
    return;
  }
  const canvas = document.getElementById('smbActivityChart');
  if (!canvas) return;
  _smbActivityChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: token('--accent') + '99', borderColor: token('--accent'), borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { ...chartTooltip(), displayColors: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: token('--text-secondary'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: token('--accent') + '0d' }, ticks: { color: token('--text-secondary'), precision: 0, font: { size: 10 } } },
      },
    },
  });
}

// 3b. Today vs Yesterday KPIs (Events + Alerts only — Traffic/People cut per #172)
function _smbRenderKpis(kpis) {
  const el = document.getElementById('smbKpis');
  if (!el) return;
  const rows = [
    { label: I18N.t('smb.kpiEvents'), kpi: kpis.total_events },
    { label: I18N.t('smb.kpiAlerts'), kpi: kpis.alerts },
  ];
  el.innerHTML = rows.map(({ label, kpi }) => {
    const pct = kpi.change_pct ?? 0;
    const cls = kpi.trend === 'up' ? 'up' : 'down';
    const arrow = kpi.trend === 'up' ? '▲' : '▼';
    return `<div class="smb-kpi-row">
      <span class="smb-kpi-label">${escapeHtml(label)}</span>
      <span class="smb-kpi-right">
        <span class="smb-kpi-val">${_summaryFmt.num(kpi.value)}</span>
        <span class="smb-kpi-delta ${cls}">${arrow} ${_summaryFmt.pct(pct)}</span>
      </span>
    </div>`;
  }).join('') +
  `<div class="smb-kpi-row" style="margin-top:6px">
    <span class="smb-kpi-label">${escapeHtml(I18N.t('smb.kpiHealth'))}</span>
    <span class="smb-kpi-val" style="font-size:14px;${kpis.system_health.status==='Excellent'||kpis.system_health.status==='Good'?'color:var(--status-ok)':kpis.system_health.status==='Warning'?'color:var(--warn)':'color:var(--status-bad)'}">${escapeHtml(kpis.system_health.status||'—')}</span>
  </div>`;
}

// 4. Top 5 hotspots
function _smbRenderTopCams(cams) {
  const el = document.getElementById('smbTopCams');
  if (!el) return;
  const list = (cams||[]).slice(0,5);
  const maxV = Math.max(...list.map(c => c.total||0), 1);
  if (!list.length) { el.innerHTML = `<div class="smb-empty">${escapeHtml(I18N.t('smb.noDataToday'))}</div>`; return; }
  el.innerHTML = list.map((c, i) => {
    const pct = Math.round((c.total||0) / maxV * 100);
    return `<div class="smb-top-row">
      <span class="smb-top-rank">${i+1}</span>
      <span class="smb-top-name" title="${escapeHtml(c.camera_name||c.camera_id)}">${escapeHtml(c.camera_name||c.camera_id)}</span>
      <div class="smb-top-bar-wrap"><div class="smb-top-bar" style="width:${pct}%"></div></div>
      <span class="smb-top-val">${_summaryFmt.num(c.total)}</span>
    </div>`;
  }).join('');
}

// 5. Footer
function _smbRenderFooter(sys) {
  const el = document.getElementById('smbFooter');
  if (!el) return;
  const diskPct = sys.storage_total_bytes
    ? Math.round(sys.storage_used_bytes / sys.storage_total_bytes * 100) : 0;
  el.innerHTML =
    `<span>${escapeHtml(sys.version||'—')}${sys.version_date?' ('+escapeHtml(sys.version_date)+')':''}</span>` +
    `<span>up ${_summaryFmt.duration(sys.uptime_seconds)}</span>` +
    `<span>${_summaryFmt.num(sys.snapshot_count)} snaps · ${_summaryFmt.bytes(sys.snapshot_size_bytes)}</span>` +
    `<span>${_summaryFmt.num(sys.clip_count||0)} clips · ${_summaryFmt.bytes(sys.clip_size_bytes||0)}</span>` +
    `<span>disk ${diskPct}%</span>`;
}

// Camera map — mirrors the main Map page: CARTO Streets basemap (locked,
// no style picker), camera markers from the DB, click-popup with details,
// and a heatmap layer with a single ON/OFF toggle. Focuses on the most
// recently ADDED camera (locations[0]; endpoint orders by created_at DESC)
// — only on page-enter, not on every 30s background refresh.
function _summaryInitMap(locations) {
  const hasLocations = Array.isArray(locations) && locations.length > 0;
  const features = hasLocations ? locations.map(p => new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat([parseFloat(p.lon), parseFloat(p.lat)])),
    cam: p,                                         // full row → popup reads from this
    heat: Math.min(1, (p.event_count || 0) / 1000),
    online: !!p.online,
  })) : [];

  _summaryToggleMapEmptyState(!hasLocations);

  // Reuse the map across refreshes — just swap the feature source.
  if (_summaryMapInstance) {
    if (_summaryMapSource) {
      _summaryMapSource.clear();
      if (features.length) _summaryMapSource.addFeatures(features);
    }
    // Focus the newest camera only if we haven't centered yet this visit.
    if (hasLocations && !_summaryMapCentered) {
      _summaryFocusNewestCamera(locations);
    }
    setTimeout(() => _summaryMapInstance && _summaryMapInstance.updateSize(), 50);
    return;
  }

  // First-time construction.
  _summaryMapSource = new ol.source.Vector({ features });

  _summaryHeatLayer = new ol.layer.Heatmap({
    source: _summaryMapSource,
    blur: 28, radius: 24,
    weight: (f) => f.get('heat'),
    gradient: ['#00ff00', '#ffff00', '#ff8800', '#ff0000'],
    visible: _summaryShowHeat,
  });
  _summaryMarkerLayer = new ol.layer.Vector({
    source: _summaryMapSource,
    style: (f) => {
      const cam = f.get('cam') || {};
      const count = cam.event_count || 0;
      const camName = cam.camera_name || cam.camera_id || '';
      // Text label above the dot — same pattern as the main Map page
      // (📷 name + 24h event count) so the camera name is visible
      // without clicking.
      const label = count > 0 ? `${camName} (${count})` : camName;
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 7,
          fill: new ol.style.Fill({
            color: !f.get('online') ? '#5a6a85' :
                   f.get('heat') > 0.7 ? token('--status-bad') :
                   f.get('heat') > 0.4 ? token('--warn')       : token('--status-ok'),
          }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 }),
        }),
        text: new ol.style.Text({
          text: label, offsetY: -18,
          fill: new ol.style.Fill({ color: '#ffffff' }),
          stroke: new ol.style.Stroke({ color: '#0a0e1a', width: 3 }),
          font: 'bold 11px sans-serif',
        }),
      });
    },
  });

  const center = hasLocations
    ? ol.proj.fromLonLat([parseFloat(locations[0].lon), parseFloat(locations[0].lat)])
    : ol.proj.fromLonLat([100.5018, 13.7563]);     // Bangkok fallback
  const view = new ol.View({ center, zoom: hasLocations ? 16 : 6 });

  _summaryMapInstance = new ol.Map({
    target: 'smbMap',
    layers: [
      // CARTO Streets (voyager) — locked, same basemap as the main Map
      // page's "STREETS" option. No provider/style toggle here.
      new ol.layer.Tile({
        source: new ol.source.XYZ({
          url: 'https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          attributions: '© OpenStreetMap, © CARTO',
        }),
      }),
      _summaryHeatLayer,
      _summaryMarkerLayer,
    ],
    view,
    controls: ol.control.defaults.defaults({ attribution: false, zoom: true }),
  });

  // Click a marker → popup with camera details (same fields as main Map page).
  _summaryMapInstance.on('singleclick', (evt) => {
    const feat = _summaryMapInstance.forEachFeatureAtPixel(evt.pixel, f => f);
    if (feat && feat.get('cam')) _summaryShowMapPopup(feat.get('cam'), evt.pixel);
    else _summaryHideMapPopup();
  });
  _summaryMapInstance.on('pointermove', (evt) => {
    const hit = _summaryMapInstance.hasFeatureAtPixel(evt.pixel);
    _summaryMapInstance.getTargetElement().style.cursor = hit ? 'pointer' : '';
  });

  if (hasLocations) _summaryMapCentered = true;
  setTimeout(() => _summaryMapInstance && _summaryMapInstance.updateSize(), 100);
}

// Focus (pan + zoom) on the most recently added camera. locations[0] is it —
// the endpoint orders by created_at DESC.
function _summaryFocusNewestCamera(locations) {
  if (!_summaryMapInstance || !locations || !locations.length) return;
  const newest = locations[0];
  _summaryMapInstance.getView().animate({
    center: ol.proj.fromLonLat([parseFloat(newest.lon), parseFloat(newest.lat)]),
    zoom: 16,
    duration: 400,
  });
  _summaryMapCentered = true;
}

// Heatmap ON/OFF toggle — the only map control on the Executive Summary.
function toggleSummaryHeatmap() {
  _summaryShowHeat = !_summaryShowHeat;
  if (_summaryHeatLayer) _summaryHeatLayer.setVisible(_summaryShowHeat);
  const btn = document.getElementById('smbHeatToggle');
  if (btn) {
    btn.classList.toggle('heat-off', !_summaryShowHeat);
    btn.textContent = I18N.t(_summaryShowHeat ? 'smb.heatmapOn' : 'smb.heatmapOff');
  }
}

function _summaryShowMapPopup(cam, pixel) {
  const popup = document.getElementById('summaryMapPopup');
  if (!popup) return;
  const online = !!cam.online;
  const statusCls = online ? 'online' : 'offline';
  const lastSeen = cam.last_seen_at
    ? new Date(cam.last_seen_at).toLocaleString('th-TH', { hour12: false })
    : '—';
  popup.innerHTML = `
    <div class="smp-name">${escapeHtml(cam.camera_name || cam.camera_id)}</div>
    <div class="smp-row"><span class="smp-label">CAMERA ID</span><span class="smp-val">${escapeHtml(cam.camera_id)}</span></div>
    <div class="smp-row"><span class="smp-label">IP</span><span class="smp-val">${escapeHtml(cam.ip_address || '—')}</span></div>
    <div class="smp-row"><span class="smp-label">LOCATION</span><span class="smp-val">${escapeHtml(cam.location || '—')}</span></div>
    <div class="smp-row"><span class="smp-label">STATUS</span><span class="smp-val ${statusCls}">${online ? 'ONLINE' : 'OFFLINE'}</span></div>
    <div class="smp-row"><span class="smp-label">EVENTS 24H</span><span class="smp-val">${cam.event_count || 0}</span></div>
    <div class="smp-row"><span class="smp-label">LAST SEEN</span><span class="smp-val">${escapeHtml(lastSeen)}</span></div>`;
  popup.classList.remove('hidden');
  const h = popup.offsetHeight;
  popup.style.left = `${Math.max(4, pixel[0] - 120)}px`;
  popup.style.top  = `${Math.max(4, pixel[1] - h - 18)}px`;
}

function _summaryHideMapPopup() {
  const popup = document.getElementById('summaryMapPopup');
  if (popup) popup.classList.add('hidden');
}

// Banner overlaid on top of the map when no camera has lat/lon. Tells the
// user how to fix it instead of leaving a featureless dark rectangle.
function _summaryToggleMapEmptyState(empty) {
  const wrap = document.getElementById('smbMap');
  if (!wrap) return;
  let hint = document.getElementById('summaryMapEmptyHint');
  if (empty) {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'summaryMapEmptyHint';
      hint.style.cssText =
        'position:absolute;top:10px;left:10px;right:10px;' +
        'background:var(--surface-elevated);border:1px solid var(--warn);' +
        'color:var(--text-primary);font-size:12px;line-height:1.5;' +
        'padding:8px 12px;border-radius:7px;z-index:10;pointer-events:auto';
      hint.innerHTML =
        '<strong style="color:var(--warn)">No GPS coordinates set</strong> · ' +
        'set lat/lon on each camera in <em>Settings</em> → Camera → edit.';
      wrap.style.position = wrap.style.position || 'relative';
      wrap.appendChild(hint);
    }
    hint.style.display = '';
  } else if (hint) {
    hint.style.display = 'none';
  }
}

function _summaryShowError(err, hadDataBefore) {
  let banner = document.getElementById('summaryErrorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'summaryErrorBanner';
    banner.style.cssText =
      'background:var(--status-bad);color:#fff;padding:10px 14px;font-size:13px;' +
      'border-radius:8px;margin:10px 0 14px;display:flex;align-items:center;' +
      'gap:10px;line-height:1.4';
    const page = document.getElementById('page-summary');
    if (page) page.insertBefore(banner, page.firstChild);
  }
  const detail = (err && err.message) || 'unknown error';
  banner.innerHTML =
    `<span><strong>Live data unavailable.</strong> ` +
    (hadDataBefore
      ? `Showing the most recent successful load. Auto-retrying every 30s. `
      : `No data has loaded yet. Auto-retrying every 30s. `) +
    `<span style="opacity:.85">Reason: ${escapeHtml(detail)}</span></span>`;
  banner.style.display = 'flex';
}

function _summaryHideError() {
  const banner = document.getElementById('summaryErrorBanner');
  if (banner) banner.style.display = 'none';
}

function startSummaryAutoRefresh() {
  if (_summaryRefreshTimer) return;
  _summaryRefreshTimer = setInterval(() => {
    if (!document.hidden &&
        document.getElementById('page-summary')?.classList.contains('active')) {
      loadSummary();
    }
  }, _SUMMARY_REFRESH_MS);
}
function stopSummaryAutoRefresh() {
  if (_summaryRefreshTimer) { clearInterval(_summaryRefreshTimer); _summaryRefreshTimer = null; }
}

// ============================================================
// Static nav-chrome handler bindings (Phase 2 of onclick= → addEventListener migration)
// Replaces onclick= attrs removed from index.html for the sidebar nav + header chrome.
// Called before bootstrapApp so sidebar/hamburger work even before auth resolves.
// ============================================================
function _bindNavChrome() {
  // Main navigation — event delegation on <nav class="nav">
  document.querySelector('.nav')?.addEventListener('click', function(e) {
    const item = e.target.closest('.nav-item[data-page]');
    if (item) showPage(item.dataset.page, item);
  });

  // Sidebar chrome
  document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);
  document.getElementById('hamburgerBtn')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarCollapseBtn')?.addEventListener('click', toggleSidebarCollapsed);

  // User menu
  document.getElementById('userMenuBtn')?.addEventListener('click', function(e) { toggleUserDropdown(e); });
  document.getElementById('ddSettings')?.addEventListener('click', function() {
    showPage('settings', document.querySelector('.nav-item[data-page=settings]'));
  });
  document.getElementById('ddChangePw')?.addEventListener('click', openChangePassword);
  document.getElementById('ddAbout')?.addEventListener('click', openAboutModal);
  document.getElementById('ddLangTh')?.addEventListener('click', function() { I18N.setLang('th'); });
  document.getElementById('ddLangEn')?.addEventListener('click', function() { I18N.setLang('en'); });
  document.getElementById('ddThemeDark')?.addEventListener('click', function() { setTheme('dark'); });
  document.getElementById('ddThemeLight')?.addEventListener('click', function() { setTheme('light'); });
  document.getElementById('ddLogout')?.addEventListener('click', doLogout);
}

function _bindStaticHandlers() {
  function bind(id, fn) { document.getElementById(id)?.addEventListener('click', fn); }
  function delegate(id, sel, fn) {
    document.getElementById(id)?.addEventListener('click', function(e) {
      const el = e.target.closest(sel);
      if (el && this.contains(el)) fn(e, el);
    });
  }
  function backdropClose(id, fn) {
    document.getElementById(id)?.addEventListener('click', function(e) { if (e.target === this) fn(); });
  }

  // ── Summary ────────────────────────────────────────────────────
  bind('smbHeatToggle',    toggleSummaryHeatmap);
  bind('smbViewallHistory', () => showPage('history', document.querySelector('.nav-item[data-page=history]')));
  bind('smbViewallCameras', () => showPage('cameras', document.querySelector('.nav-item[data-page=cameras]')));

  // ── Events ─────────────────────────────────────────────────────
  bind('evtClearDrillBtn', clearDrillFilter);
  bind('evtSearchBtn',     () => loadEvents(1));
  bind('evtResetBtn',      resetEventFilters);
  bind('evtExportCsvBtn',  exportEventsCsv);
  bind('evtPauseBtn',      toggleEventsPause);
  delegate('evtTabBar', '.tab[data-tab]', (e, el) => setEventTab(el.dataset.tab, el));

  // ── Snapshots ──────────────────────────────────────────────────
  bind('snapSearchBtn', () => loadSnapshots(1));
  bind('snapResetBtn',  resetSnapFilters);
  delegate('snapViewBar', '.tab[data-view]', (e, el) => setSnapView(el.dataset.view, el));

  // ── Media ──────────────────────────────────────────────────────
  bind('mediaSearchBtn',  () => loadMedia(1));
  bind('mediaResetBtn',   resetMediaFilters);
  backdropClose('mediaModal', closeMediaModal);
  bind('mediaModalClose', closeMediaModal);

  // ── Faces ──────────────────────────────────────────────────────
  bind('faceSearchBtn',  loadFaces);
  bind('faceResetBtn',   resetFaceFilters);
  backdropClose('faceModal', closeFaceModal);
  bind('faceModalClose', closeFaceModal);

  // ── Appearance ─────────────────────────────────────────────────
  delegate('appTabBar',   '.tab[data-tab]',       (e, el) => setAppTab(el.dataset.tab, el));
  delegate('appRangeBar', '.per-btn[data-range]', (e, el) => setAppRange(el.dataset.range, el));
  bind('appSearchBtn', () => loadAppearanceSearch(1));
  bind('appResetBtn',  resetAppearanceFilters);

  // ── Map ────────────────────────────────────────────────────────
  document.getElementById('selMapPulseDebounce')?.addEventListener('change', function() { setMapPulseDebounce(this.value); });
  bind('mapWallExit',       toggleWallMode);
  bind('togHeat',           function() { toggleMapLayer('heat', this); });
  bind('togCams',           function() { toggleMapLayer('cams', this); });
  bind('btnMapPulse',       toggleMapPulse);
  bind('btnMapFace',        toggleMapFaceOverlay);
  bind('mapRecenterBtn',    recenterMap);
  bind('btnMapMore',        toggleMapSecondary);
  bind('togStyle',          toggleMapStyle);
  bind('togProvider',       toggleMapProvider);
  bind('togSource',         toggleMapSource);
  bind('btnWallMode',       toggleWallMode);
  bind('mapDrawerBackdrop', toggleMapDrawer);

  // ── Stats ──────────────────────────────────────────────────────
  document.getElementById('statsRangeBar')?.addEventListener('click', function(e) {
    const btn = e.target.closest('.per-btn[data-range]');
    if (!btn || !this.contains(btn)) return;
    btn.dataset.range === 'custom' ? openCustomRangeModal() : setStatsRange(btn.dataset.range, btn);
  });
  bind('csvBtnTimeline',     () => exportCsv('timeline'));
  bind('csvBtnBreakdown',    () => exportCsv('breakdown'));
  bind('csvBtnKpi',          () => exportCsv('kpi'));
  bind('csvBtnPeople',       () => exportCsv('people'));
  bind('csvBtnVehicle',      () => exportCsv('vehicle'));
  bind('csvBtnHeatmap',      () => exportCsv('heatmap'));
  bind('csvBtnQuietCameras', () => exportCsv('quietCameras'));
  bind('csvBtnTopRules',     () => exportCsv('topRules'));

  // ── Reports ────────────────────────────────────────────────────
  bind('repLoadBtn',     updateReportPreview);
  bind('repPdfBtn',      downloadPDF);
  bind('hrPreviewBtn',   previewHealthReport);
  bind('hrPdfBtn',       downloadHealthPdf);
  bind('hrPngBtn',       downloadHealthPng);
  bind('hrSendNowBtn',   sendHealthReportNow);
  bind('repScheduleBtn', openReportScheduleModal);

  // ── History srail ──────────────────────────────────────────────
  delegate('historySrail', '.srail-item[data-hist]', (e, el) => historyNav(el.dataset.hist, el));
  bind('historyBackBtn', historyBack);
  bind('alRefreshBtn',   loadAlertLogs);
  bind('alClearOldBtn',  clearOldLogs);
  bind('rhExportCsvBtn', exportReportHistoryCsv);
  delegate('cameraStatusTabBar', '.tab[data-camera-status-tab]',
    (e, el) => setCameraStatusTab(el.dataset.cameraStatusTab, el));
  bind('statusLogResetBtn',   resetStatusLogFilters);
  bind('statusLogRefreshBtn', () => loadStatusLog(1));
  bind('imgQualResetBtn',     resetImageQualityFilters);
  bind('imgQualRefreshBtn',   () => loadImageQualityLog(1));
  bind('auditRefreshBtn',     loadAuditLog);
  bind('healthRefreshBtn',    loadHealth);

  // ── Settings srail ─────────────────────────────────────────────
  delegate('settingsSrail', '.srail-item[data-sec]', (e, el) => settingsNav(el.dataset.sec, el));
  bind('settingsBackBtn', settingsBack);

  // ── Camera form ────────────────────────────────────────────────
  bind('camSubTabCameras',       function() { camerasSubTab('cameras', this); });
  bind('camSubTabGroups',        function() { camerasSubTab('groups',  this); });
  bind('openCameraFormBtn',      openCameraForm);
  bind('frmCamPassToggle',       toggleCamPassVisibility);
  bind('frmTestConnBtn',         testCameraConnection);
  bind('camUseLocationBtn',      camFormUseMyLocation);
  bind('frmCamProbeBtn',         probeCameraSnapshot);
  bind('frmSnapPreviewBtn',      previewCameraSnapshot);
  bind('saveCamOfflineAlertBtn', saveCameraOfflineAlert);
  bind('mqttCopyUserBtn',        () => copyMqttCreds('user'));
  bind('mqttPassToggleBtn',      toggleMqttPassVisibility);
  bind('mqttCopyPassBtn',        () => copyMqttCreds('pass'));
  bind('mqttRegenBtn',           regenerateMqttPassword);
  bind('mqttCopyRegenPassBtn',   copyMqttRegenPass);
  bind('saveCameraBtn',          saveCamera);
  bind('closeCameraFormBtn',     closeCameraForm);
  bind('newGroupBtn',            newGroup);

  // ── Users / Categories / Alerts ────────────────────────────────
  bind('openUserEditorBtn',       () => openUserEditor());
  bind('openCategoryEditorBtn',   () => openCategoryEditor());
  bind('alertTabRules',           () => switchAlertTab('rules'));
  bind('alertTabConfig',          () => switchAlertTab('config'));
  bind('openRuleEditorBtn',       () => openRuleEditor());
  bind('saveLineConfigBtn',       saveLineConfig);
  bind('onboardGuideToggle',      toggleOnboardGuide);
  bind('loadPendingRecipientsBtn',loadPendingRecipients);
  bind('loadBlockedRecipientsBtn',loadBlockedRecipients);
  bind('addRecipientBtn',         addRecipient);
  bind('backupRunBtn',            runBackup);
  bind('mapboxTokenToggleBtn',    toggleMapboxTokenVis);
  bind('saveMapboxTokenBtn',      saveMapboxToken);
  bind('mapDownloadStartBtn',     startDownload);
  bind('mapDownloadEstimateBtn',  estimateDownload);
  bind('mapClearCacheBtn',        clearAllCache);

  // ── Modals ─────────────────────────────────────────────────────
  bind('snapModalClose',           closeSnapModal);
  bind('eulaViewerClose',          closeEulaViewer);
  bind('eulaLogoutBtn',            doLogout);
  bind('eulaAcceptBtn',            acceptEula);
  backdropClose('cameraDetailModal', closeCameraDetailModal);
  bind('cameraDetailModalClose',   closeCameraDetailModal);
  bind('ruleEditorModalClose',     closeRuleEditor);
  bind('ruleActiveClearBtn', function() {
    document.getElementById('ruleActiveFrom').value = '';
    document.getElementById('ruleActiveTo').value   = '';
  });
  bind('ruleEditorCancelBtn',      closeRuleEditor);
  bind('saveRuleBtn',              saveRule);
  backdropClose('reportScheduleModal', closeReportScheduleModal);
  bind('reportScheduleModalClose', closeReportScheduleModal);
  bind('saveReportScheduleBtn',    saveReportSchedule);
  bind('newReportScheduleBtn',     resetReportScheduleForm);
  bind('userEditorModalClose',     closeUserEditor);
  bind('userEditorCancelBtn',      closeUserEditor);
  bind('saveUserBtn',              saveUser);
  bind('changePasswordModalClose', closeChangePassword);
  bind('changePasswordCancelBtn',  closeChangePassword);
  bind('submitChangePasswordBtn',  submitChangePassword);
  bind('aboutModalClose',          closeAboutModal);
  bind('aboutEulaLink', function(e) { e.preventDefault(); closeAboutModal(); openEulaViewer(); });
  bind('appCustomModalClose',      closeAppCustomModal);
  bind('appCustomModalCancelBtn',  closeAppCustomModal);
  bind('applyAppCustomRangeBtn',   applyAppCustomRange);
  bind('customRangeModalClose',    closeCustomRangeModal);
  delegate('crQuickBar', '.btn[data-quick]', (e, el) => crQuick(el.dataset.quick));
  bind('customRangeCancelBtn',     closeCustomRangeModal);
  bind('applyCustomRangeBtn',      applyCustomRange);
  bind('categoryEditorModalClose', closeCategoryEditor);
  bind('categoryEditorCancelBtn',  closeCategoryEditor);
  bind('saveCategoryBtn',          saveCategory);
  bind('categoryRulesModalClose',  closeCategoryRules);
  bind('addCategoryRuleBtn',       addCategoryRule);

  // ── Inline handlers removed from index.html (Pre-Phase-5 gate) ─────────
  // Cameras
  document.getElementById('camSearch')?.addEventListener('input', renderCameraGrid);
  // Stats selects
  document.getElementById('occTlCamRule')?.addEventListener('change', loadOccupancyTimeline);
  document.getElementById('occHmCamRule')?.addEventListener('change', loadOccupancyHeatmap);
  document.getElementById('heatmapCatFilter')?.addEventListener('change', loadHeatmap);
  // Reports
  document.getElementById('reportType')?.addEventListener('change', onReportTypeChange);
  document.getElementById('hrRangePreset')?.addEventListener('change', _hrToggleCustomRange);
  // History / logs
  document.getElementById('logFilterStatus')?.addEventListener('change', () => loadAlertLogs());
  document.getElementById('statusLogCamFilter')?.addEventListener('change', () => loadStatusLog(1));
  document.getElementById('statusLogStatusFilter')?.addEventListener('change', () => loadStatusLog(1));
  document.getElementById('iqCamFilter')?.addEventListener('change', () => loadImageQualityLog(1));
  document.getElementById('iqTypeFilter')?.addEventListener('change', () => loadImageQualityLog(1));
  document.getElementById('auditFilterAction')?.addEventListener('change', () => loadAuditLog());
  document.getElementById('auditFilterCamera')?.addEventListener('change', () => loadAuditLog());
  // Camera form
  document.getElementById('frmCamId')?.addEventListener('blur', onCamIdBlur);
  document.getElementById('frmCamVendor')?.addEventListener('change', onVendorChange);
  document.getElementById('frmCamIp')?.addEventListener('blur', onCamIpBlur);
  document.getElementById('frmCamLat')?.addEventListener('input', onCamCoordInput);
  document.getElementById('frmCamLng')?.addEventListener('input', onCamCoordInput);
  document.getElementById('frmCamEnableSnapshot')?.addEventListener('change', updateDahuaSnapNote);
  document.getElementById('frmOfflineEscalateOnce')?.addEventListener('change', toggleEscalateOnce);
  // EULA viewer checkbox
  document.getElementById('eulaAcceptCheck')?.addEventListener('change', function() {
    const b = document.getElementById('eulaAcceptBtn'); if (b) b.disabled = !this.checked;
  });
  // Report schedule type
  document.getElementById('rsType')?.addEventListener('change', _rsToggleTypeFields);
  // Category editor icon
  document.getElementById('ceIcon')?.addEventListener('input', syncIconPresets);
  // Custom range camera filter
  document.getElementById('crCamera')?.addEventListener('change', loadFacets);
}

// ============================================================
// _bindDynamicHandlers — Global dispatcher for data-action elements
// Replaces inline onclick= generated by render functions (Phase 4).
// Add new actions here as each section is migrated.
// ============================================================
function _bindDynamicHandlers() {
  const ACTION_MAP = {
    // Pagination — reads window._pgHandlers[data-pg] stash set by renderPagination
    pgGo: (el) => {
      const handler = window._pgHandlers?.[el.dataset.pg];
      if (handler) handler(+el.dataset.page);
    },

    // Snapshots / Media / Events — idx-based routing into module-level arrays
    // _currentSnapEv / _currentMediaEv set on modal open for in-modal actions
    showSnapshot: (el) => {
      const SOURCE = { events: allEvents, snaps: snapshots, app: window._appRows || [] };
      const arr = SOURCE[el.dataset.source];
      if (arr) showSnapshot(arr[+el.dataset.idx]);
    },
    showMediaClip: (el) => {
      const SOURCE = { snaps: snapshots, media: mediaList };
      const arr = SOURCE[el.dataset.source];
      if (arr) showMediaClip(arr[+el.dataset.idx]);
    },
    viewFullSnap: () => {
      const ev = window._currentSnapEv;
      if (!ev?.snapshot_file) return;
      const cap = camFullViewWidth(ev.camera_id);
      window.open(`${API}/snapshots/${ev.snapshot_file}${cap ? '?w=' + cap : ''}`, '_blank');
    },
    closeAndShowClip: () => {
      const ev = window._currentSnapEv;
      closeSnapModal();
      if (ev) showMediaClip(ev);
    },
    showSnapFromMedia: () => {
      const ev = window._currentMediaEv;
      if (ev) showSnapshot(ev);
    },
    openUrl: (el) => window.open(el.dataset.url, '_blank'),

    // Groups (renderGroupBarHTML + renderGroupList + renderGroupEditor)
    setActiveGroup:   (el) => setActiveGroup(el.dataset.gid),
    openGroupManager: ()   => openGroupManager(),
    editGroup:        (el) => editGroup(el.dataset.gid),
    deleteGroup:      (el) => deleteGroup(el.dataset.gid),
    toggleCamInGroup: (el) => toggleCamInGroup(el.dataset.camId),
    setGrpColor:      (el) => { const inp = document.getElementById('grpColor'); if (inp) inp.value = el.dataset.color; },
    selectAllCams:    ()   => selectAllCams(),
    clearAllCams:     ()   => clearAllCams(),
    saveGroup:        ()   => saveGroup(),
    cancelEditGroup:  ()   => cancelEditGroup(),

    // Stats / Heatmap / Insights (renderQuietCameras + renderTopRules + heatmap td + renderCategoryKPI)
    drillHeatmapCell: (el) => drillHeatmapCell(+el.dataset.d, +el.dataset.h, +el.dataset.v),
    drillToCamera:    (el) => drillTo({ camera: el.dataset.camera, label: el.dataset.label }),
    drillToRule:      (el) => drillTo({ rule_name: el.dataset.ruleName, label: el.dataset.label }),
    setFocusCat:      (el) => setStatsFocusCategory(el.dataset.catId === '' ? null : +el.dataset.catId),

    // Categories (renderCategories + _renderIconPresets + loadCategoryRules)
    openCatRules:     (el) => openCategoryRules(+el.dataset.id),
    openCatEditor:    (el) => openCategoryEditor(+el.dataset.id),
    deleteCat:        (el) => deleteCategory(+el.dataset.id),
    selectIconPreset: (el) => selectIconPreset(el.dataset.preset),
    deleteCatRule:    (el) => deleteCategoryRule(+el.dataset.id),

    // Reports (renderReportSchedules + loadReportHistoryStats winBtn + loadReportHistory pager)
    runReportNow:      (el) => runReportNow(+el.dataset.id, el),
    editReportSched:   (el) => editReportSchedule(+el.dataset.id),
    deleteReportSched: (el) => deleteReportSchedule(+el.dataset.id),
    loadRhStats:       (el) => loadReportHistoryStats(el.dataset.window),
    loadReportHistory: (el) => loadReportHistory(+el.dataset.offset),

    // Cameras (renderCameraRows)
    editCamera:       (el) => editCamera(el.dataset.cameraId),
    toggleCamPause:   (el) => toggleCameraPause(el.dataset.cameraId, el.dataset.pauseState === 'true'),
    deleteCamera:     (el) => deleteCamera(el.dataset.cameraId),

    // Status Current pager + filter buttons (onclick only; onchange/onkeydown deferred to non-click batch)
    setStatusPage:    (el) => setStatusCurrentPage(+el.dataset.page),
    resetStatusPage:  ()   => resetStatusCurrentPage(),
    resetStatusFilts: ()   => resetStatusCurrentFilters(),

    // Alert Rules (renderAlertRules)
    toggleRule:       (el) => toggleRule(+el.dataset.id),
    openRuleEditor:   (el) => openRuleEditor(+el.dataset.id),
    deleteRule:       (el) => deleteRule(+el.dataset.id),

    // Backup (B8)
    downloadBackup:       (el)    => downloadBackup(el.dataset.filename),

    // License (B8)
    copyMachineId:        (el, e) => copyMachineId(el.dataset.machineId, e),
    openEulaViewer:       ()      => openEulaViewer(),
    activateLicense:      ()      => activateLicense(),
    deactivateLicense:    ()      => deactivateLicense(),

    // Face Recognition (B8)
    openFaceModal:        (el)    => openFaceModal(+el.dataset.id),

    // Map legend + Map Manager (B8)
    toggleMapDrawer:      ()      => toggleMapDrawer(),
    legendShowAll:        ()      => _legendShowAll(),
    legendHideAll:        ()      => _legendHideAll(),
    legendCollapse:       ()      => _legendCollapse(),
    cancelDownload:       ()      => cancelDownload(),
    deleteArea:           (el)    => deleteArea(el.dataset.id),

    // Users + Sessions (B8)
    openUserEditor:       (el)    => openUserEditor(+el.dataset.id),
    resetUserPassword:    (el)    => resetUserPassword(+el.dataset.id),
    deleteUserConfirm:    (el)    => deleteUserConfirm(+el.dataset.id),
    revokeSession:        (el)    => revokeSession(el.dataset.id),

    // Brand / Settings (B8)
    clearBrandLogo:       ()      => clearBrandLogo(),
    saveSetting:          (el)    => saveSetting(el.dataset.key),
    saveBrandColor:       ()      => saveBrandColor(),
    saveAnalyticsDisplay: ()      => saveAnalyticsDisplay(),

    // Services (B8)
    svcAction:            (el)    => _svcAction(el.dataset.svc, el.dataset.svcCmd),

    // Summary (B8)
    summaryOpenEvent:     (el)    => summaryOpenEvent(JSON.parse(el.dataset.eventJson)),

    // LINE config (B7)
    pushUsersSelect:           (el) => _pushUsersSelect(el.dataset.pushAction),
    loadAlertStats:            (el) => loadAlertStats(el.dataset.window),
    loadLineQuota:             ()   => loadLineQuota(),
    approvePendingRecipient:   (el) => approvePendingRecipient(el.dataset.lineId),
    ignorePendingRecipient:    (el) => ignorePendingRecipient(el.dataset.lineId),
    blockRecipient:            (el) => blockRecipient(el.dataset.lineId),
    unblockRecipient:          (el) => unblockRecipient(el.dataset.lineId),
    testRecipient:             (el) => testRecipient(el.dataset.id),
    removeRecipient:           (el) => removeRecipient(+el.dataset.idx),

    // Events nudge link (i18n.js aux.evtNewNudge — was onclick=)
    goEventsPage1:    ()   => loadEvents(1),

    // Non-click batch (B6b) — shared map, keyed by data-change / data-input / data-action-enter values
    eulaToggle:       (el) => { document.getElementById('licenseActivateBtn').disabled = !el.checked; },
    toggleMapGroup:   (el) => toggleMapGroup(el.dataset.gid),
    legendSearch:     (el) => _legendSearch(el.value),
    updateHrSendBtn:  ()   => _updateHealthSendBtnLabel(),
    updateRecipient:  (el) => updateRecipient(+el.dataset.idx, el.dataset.field, el.checked),
    uploadBrandLogo:  (el) => uploadBrandLogo(el),
    syncBrandColor:   (el) => { document.getElementById('ss_brand_primary_color').value = el.value; },
    // resetStatusPage already in map (B6) — reused by data-change on select + data-action-enter on input
  };

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(target, e);
  });

  // change — checkboxes, select, file input; no preventDefault (would cancel native toggle/file-picker)
  document.addEventListener('change', (e) => {
    const target = e.target.closest('[data-change]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.change];
    if (!fn) return;
    fn(target, e);
  });

  // input — text inputs; no preventDefault
  document.addEventListener('input', (e) => {
    const target = e.target.closest('[data-input]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.input];
    if (!fn) return;
    fn(target, e);
  });

  // keydown Enter — data-action-enter avoids double-fire with buttons (which also fire click on Enter)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target.closest('[data-action-enter]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.actionEnter];
    if (!fn) return;
    fn(target, e);
  });

  // img onerror capture — replaces inline onerror= attrs (CSP script-src-attr blocked those).
  // Capture phase required: 'error' does not bubble from <img>.
  // data-err vocab: hide | dim | cam-placeholder | cam-span | face-noimg | no-img
  window.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.dataset.err) return;
    const p = img.parentElement;
    switch (img.dataset.err) {
      case 'hide': img.style.display = 'none'; break;
      case 'dim':  img.style.opacity = '0.3'; break;
      case 'cam-placeholder':
        if (p) p.innerHTML = `<div class="placeholder">${I18N.t('cam.imgErr')}</div>`; break;
      case 'cam-span':
        if (p) p.innerHTML = `<span style="color:var(--dim);font-size:13px">${I18N.t('cam.imgErr')}</span>`; break;
      case 'face-noimg':
        if (p) p.innerHTML = `<div class="face-noimg">${escapeHtml(I18N.t('face.noImage'))}</div>`; break;
      case 'no-img':
        if (p) p.innerHTML = '<div class="no-img">err</div>'; break;
    }
  }, true);
}

// Run after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { _bindNavChrome(); _bindStaticHandlers(); _bindDynamicHandlers(); bootstrapApp(); });
} else {
  _bindNavChrome();
  _bindStaticHandlers();
  _bindDynamicHandlers();
  bootstrapApp();
}
