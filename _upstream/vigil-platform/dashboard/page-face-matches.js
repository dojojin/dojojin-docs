// ============================================================
// Vigil Platform — Face Recognition Match Gallery
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// Face Recognition match gallery — Hikvision FaceRecognition events
// (camera matched a person from its FD Library watchlist).
// Separate from page-face-gallery.js (FaceCapture = stranger analytics).

let _faceMatchesData = [];
let _faceTab2Data = [];
let _faceShowExpr = true;   // FP6 — face_show_expression toggle (set from /api/faces/counts)

// Site filter — own state (not shared with Events/Snapshot/Media's
// _opActiveSiteId), since this page's endpoints (/api/faces, /api/faces/stats,
// /api/face-matches) are entirely separate from /api/events.
let _faceActiveSiteId = null;

function renderFaceSitePills() {
  renderSitePills('faceSitePills', _faceActiveSiteId, 'setFaceActiveSite');
}

// null = no site filter; array (possibly empty) = restrict to these cameras.
function _faceSiteCameraIds() {
  if (!_faceActiveSiteId) return null;
  return cameras.filter(c => c.site_id === _faceActiveSiteId).map(c => c.camera_id);
}

function _faceApplySiteParam(params) {
  const ids = _faceSiteCameraIds();
  if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
}

function setFaceActiveSite(sid) {
  _faceActiveSiteId = sid ? Number(sid) : null;
  renderFaceSitePills();
  _populateFaceFilter2Cameras();  // rescope the search-tab camera picker to the new site
  if (document.getElementById('faceTabPanelOverview') && !document.getElementById('faceTabPanelOverview').classList.contains('hidden')) faceLoadOverview();
  else if (!document.getElementById('faceTabPanelMatches').classList.contains('hidden'))  loadFaceMatches();
  else if (!document.getElementById('faceTabPanelAllFaces').classList.contains('hidden')) _loadFaceTab();
}


// FaceRecognition segment filter for recog tab: 'all' (ทั้งหมด) / 'blackList' (เฝ้าระวัง) / 'whiteList' (รู้จัก) / 'miss' (ไม่พบในระบบ)
let _faceMatchMode = 'all';

// 4 tabs: overview(FP2 shell) · recog(FaceRecognition match+miss + segment) · search(FaceCapture) · settings(FP6 shell)
// Back-compat aliases (external callers): 'capture'/'allFaces'→search, 'match'/'matches'→recog, 'miss'→recog+miss-segment.
function _switchFaceTab(tab) {
  if (tab === 'allFaces' || tab === 'capture') tab = 'search';
  if (tab === 'matches'  || tab === 'match')   tab = 'recog';
  if (tab === 'miss') { tab = 'recog'; _faceMatchMode = 'miss'; }
  // FP6: settings tab moved to main Settings › การตั้งค่าระบบใบหน้า (3 tabs now)
  const PANELS = { overview:'faceTabPanelOverview', recog:'faceTabPanelMatches', search:'faceTabPanelAllFaces' };
  Object.entries(PANELS).forEach(([key, id]) => document.getElementById(id)?.classList.toggle('hidden', key !== tab));
  const BTNS = { overview:'faceTabOverview', recog:'faceTabRecog', search:'faceTabSearch' };
  Object.entries(BTNS).forEach(([key, id]) => { const b = document.getElementById(id); if (b) b.classList.toggle('active', key === tab); });
  if (tab === 'search') { _loadFaceTab(); }
  else if (tab === 'recog') {
    document.querySelectorAll('#faceRecogSeg button').forEach(b => b.classList.toggle('active', b.dataset.seg === _faceMatchMode));
    loadFaceMatches();
  }
  else if (tab === 'overview') { faceLoadOverview(); }
  // settings = static shell, nothing to load
}

// Segment ใน recog tab: all / blackList(เฝ้าระวัง) / whiteList(รู้จัก) / miss(ไม่พบ)
function _faceRecogSeg(seg) {
  _faceMatchMode = seg;
  _faceMatchPage = 1;
  document.querySelectorAll('#faceRecogSeg button').forEach(b => b.classList.toggle('active', b.dataset.seg === seg));
  loadFaceMatches();
}

// Tab count badges (capture / match / miss) — one roundtrip
async function _loadFaceCounts() {
  try {
    const c = await fetch(`${API}/api/faces/counts`).then(r => r.json());
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v != null ? `(${v})` : ''; };
    set('faceCntSearch', c.capture);
    set('faceCntRecog',  (c.match || 0) + (c.miss || 0));
    _faceShowExpr = c.show_expression !== false;   // FP6 — hide expr chart/chips when off
    // FP5 — unacked watch-list alert pill (hidden when 0)
    const alert = document.getElementById('faceWatchAlert');
    if (alert) { alert.textContent = c.unacked_watch > 0 ? c.unacked_watch : ''; alert.style.display = c.unacked_watch > 0 ? '' : 'none'; }
  } catch (e) { console.error('_loadFaceCounts:', e); }
}

// ── FP2 Overview: KPI + charts + recent-watchlist strip ──────────────
let _faceOvPeriod = 'today';
window._faceCharts = window._faceCharts || [];
const _faceTok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function faceSetPeriod(p) {
  _faceOvPeriod = p;
  document.querySelectorAll('#facePeriodBar button').forEach(b => b.classList.toggle('active', b.dataset.p === p));
  const cr = document.getElementById('faceCustomRange');
  if (cr) cr.style.display = (p === 'custom') ? '' : 'none';
  if (p !== 'custom') faceLoadOverview();
}
function faceApplyPeriod() { if (_faceOvPeriod === 'custom') faceLoadOverview(); }

function faceLoadOverview() {
  const params = new URLSearchParams({ period: _faceOvPeriod });
  if (_faceOvPeriod === 'custom') {
    const f = getDtValue('facePeriodFrom'), t = getDtValue('facePeriodTo');
    if (f) params.set('from', new Date(f).toISOString());
    if (t) params.set('to', new Date(t).toISOString());
  }
  _faceApplySiteParam(params);
  fetch(`${API}/api/faces/stats?${params}`).then(r => r.json())
    .then(d => { _renderFaceOvKpi(d); _renderFaceOvCharts(d); }).catch(() => {});
  _loadFaceOvWatchStrip();
  _loadFaceOvLatest();
}

function _renderFaceOvKpi(d) {
  const el = document.getElementById('faceOvKpi'); if (!el) return;
  const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const items = [
    { ka:'var(--accent)',     label:I18N.t('fmatch.kpiTotal','ใบหน้าทั้งหมด'),   val:d.total, icon:ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>') },
    { ka:'var(--status-ok)',  label:I18N.t('fmatch.kpiRecog','รู้จัก'),          val:d.recog, icon:ic('<path d="M20 6L9 17l-5-5"/>') },
    { ka:'var(--status-bad)', label:I18N.t('fmatch.kpiWatch','เฝ้าระวังที่พบ'),  val:d.watch, icon:ic('<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>') },
    { ka:'var(--warn)',       label:I18N.t('fmatch.kpiMiss','ไม่พบในระบบ'),      val:d.miss,  icon:ic('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>') },
  ];
  el.innerHTML = items.map(k => `<div class="kpi" style="--ka:${k.ka}"><div class="ki" style="color:${k.ka}">${k.icon}</div><div class="kl">${escapeHtml(k.label)}</div><div class="kv">${(k.val||0).toLocaleString()}</div><div class="ks"></div></div>`).join('');
}

function _renderFaceOvCharts(d) {
  if (typeof Chart === 'undefined') return;
  window._faceCharts.forEach(c => { try { c.destroy(); } catch {} });
  window._faceCharts = [];
  const acc = _faceTok('--accent'), grid = _faceTok('--border-hairline'), dim = _faceTok('--text-secondary'), bad = _faceTok('--status-bad');
  Chart.defaults.color = dim;
  const noLegend = { plugins:{legend:{display:false}}, maintainAspectRatio:false };
  // peak — bar, busiest hour red
  const peak = d.hourly || [];
  const peakIdx = peak.length ? peak.indexOf(Math.max(...peak)) : -1;
  const cP = document.getElementById('faceChPeak');
  if (cP) window._faceCharts.push(new Chart(cP, { type:'bar',
    data:{ labels:Array.from({length:24},(_,i)=>i+':00'), datasets:[{ data:peak, backgroundColor:peak.map((_,i)=>i===peakIdx?bad:acc), borderRadius:3, barPercentage:.8 }] },
    options:{ ...noLegend, scales:{ x:{grid:{display:false},ticks:{maxTicksLimit:8,font:{size:10}}}, y:{grid:{color:grid},ticks:{font:{size:10}},beginAtZero:true} } } }));
  const pn = document.getElementById('facePeakNote');
  if (pn) pn.textContent = (peakIdx >= 0 && peak[peakIdx]) ? `${I18N.t('fmatch.peakNote','พบมากสุด')}: ${peakIdx}:00 (${peak[peakIdx].toLocaleString()})` : '';
  // gender — doughnut
  const cG = document.getElementById('faceChGender');
  if (cG) window._faceCharts.push(new Chart(cG, { type:'doughnut',
    data:{ labels:[I18N.t('face.male','ชาย'),I18N.t('face.female','หญิง'),I18N.t('face.unknown','ไม่ทราบ')], datasets:[{ data:[d.gender?.male||0,d.gender?.female||0,d.gender?.unknown||0], backgroundColor:['#2563eb','#ec4899',dim], borderWidth:0 }] },
    options:{ maintainAspectRatio:false, cutout:'60%', plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10}}}} } }));
  // age — bar
  const cA = document.getElementById('faceChAge');
  if (cA) window._faceCharts.push(new Chart(cA, { type:'bar',
    data:{ labels:[I18N.t('fmatch.ageTeen','≤19'),I18N.t('fmatch.ageYoung','20–39'),I18N.t('fmatch.ageMid','40–59'),I18N.t('fmatch.ageSenior','60+')], datasets:[{ data:[d.age?.teen||0,d.age?.young||0,d.age?.mid||0,d.age?.senior||0], backgroundColor:acc, borderRadius:3, barPercentage:.7 }] },
    options:{ ...noLegend, scales:{ x:{grid:{display:false},ticks:{font:{size:11}}}, y:{grid:{color:grid},ticks:{font:{size:10}},beginAtZero:true} } } }));
  // expression — doughnut (FP6: hidden when face_show_expression off)
  // Color mapped by emotion (demo palette) so each mood keeps its hue regardless of order.
  const ex = d.expression || [];
  const EXPR_COLORS = { 'poker-faced':'#8a93a5', happy:'#22c55e', sad:'#5b8def', angry:'#ef4444', anger:'#ef4444', surprised:'#f59e0b', disgusted:'#a855f7', panic:'#14b8a6', unknown:dim };
  const cE = document.getElementById('faceChExpr');
  // FP6: bind visibility to the stats payload (not the global _faceShowExpr) so it
  // can't race the /api/faces/counts fetch that sets the global.
  const showExpr = d.show_expression !== false;
  const cEcard = cE ? cE.closest('.card') : null;
  if (cEcard) cEcard.style.display = showExpr ? '' : 'none';
  if (cE && showExpr) window._faceCharts.push(new Chart(cE, { type:'doughnut',
    data:{ labels:ex.map(e=> e.name==='unknown'?I18N.t('face.unknown','ไม่ทราบ'):(typeof faceExprLabel==='function'?faceExprLabel(e.name):e.name)), datasets:[{ data:ex.map(e=>e.n), backgroundColor:ex.map(e=>EXPR_COLORS[e.name]||dim), borderWidth:0 }] },
    options:{ maintainAspectRatio:false, cutout:'60%', plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10}}}} } }));
}

// Overview watchlist strip — compact horizontal alarm-cards (demo parity), clickable.
let _faceOvWatchData = [];
function _loadFaceOvWatchStrip() {
  const strip = document.getElementById('faceOvWatchStrip'); if (!strip) return;
  const params = new URLSearchParams({ list_type: 'blackList', limit: '8' });
  _faceApplySiteParam(params);
  fetch(`${API}/api/face-matches?${params}`).then(r => r.json()).then(rows => {
    _faceOvWatchData = Array.isArray(rows) ? rows : [];
    if (!_faceOvWatchData.length) { strip.innerHTML = `<div class="alarm-empty">${escapeHtml(I18N.t('fmatch.ovEmpty','ยังไม่พบบุคคลเฝ้าระวังในช่วงนี้'))}</div>`; return; }
    strip.innerHTML = _faceOvWatchData.map(m => {
      const av = m.snapshot ? `<img src="${API}/snapshots/${encodeURIComponent(m.snapshot)}" loading="lazy" decoding="async" alt="" data-err="face-noimg">` : '';
      const t = m.event_time ? new Date(m.event_time).toLocaleString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
      const name = m.person_name ? escapeHtml(m.person_name) : escapeHtml(I18N.t('fmatch.noMatch','ไม่พบรายชื่อ'));
      const sim = m.similarity != null ? `${(m.similarity*100).toFixed(0)}% · ` : '';
      return `<div class="alarm-card" style="--gc:var(--status-bad)" data-action="openFaceMatchModal" data-id="${m.id}">
        <div class="alarm-av">${av}</div>
        <div class="alarm-info">
          <div class="alarm-row1"><span class="alarm-grp">${escapeHtml(m.fd_lib_name||'')}</span><span class="alarm-time">${t}</span></div>
          <div class="alarm-name">${name}</div>
          <div class="alarm-meta">${sim}${escapeHtml(m.camera_id||'')}</div>
        </div>
      </div>`;
    }).join('');
  }).catch(() => {});
}

// Overview "ดูทั้งหมด →" → recog tab, watch segment.
function faceGotoWatch() { _faceMatchMode = 'blackList'; _faceMatchPage = 1; _switchFaceTab('recog'); }

function _faceTabFilterParams() {
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const params = new URLSearchParams();
  const gender      = val('faceFilterGender2');
  const age         = val('faceFilterAge2');
  const expr        = val('faceFilterExpr2');
  const glass       = val('faceFilterGlass2');
  const mask        = val('faceFilterMask2');
  const hat         = val('faceFilterHat2');
  const cams        = (typeof MultiPicker !== 'undefined') ? MultiPicker.values('faceFilterCamera2') : [];
  const topColor    = val('faceFilterTopColor2');
  const bottomColor = val('faceFilterBottomColor2');
  const topType     = val('faceFilterTopType2');
  const bottomType  = val('faceFilterBottomType2');
  const from        = getDtValue('faceFilterFrom2');
  const to          = getDtValue('faceFilterTo2');
  if (gender)      params.set('gender', gender);
  if (expr)        params.set('expression', expr);
  if (glass)       params.set('glass', glass);
  if (mask)        params.set('mask', mask);
  if (hat)         params.set('hat', hat);
  if (cams.length) params.set('cameras', cams.join(','));
  else _faceApplySiteParam(params);
  if (topColor)    params.set('top_color', topColor);
  if (bottomColor) params.set('bottom_color', bottomColor);
  if (topType)     params.set('top_type', topType);
  if (bottomType)  params.set('bottom_type', bottomType);
  if (age)         { const [min, max] = age.split('-'); params.set('age_min', min); params.set('age_max', max); }
  if (from)        params.set('from', new Date(from).toISOString());
  if (to)          params.set('to',   new Date(to).toISOString());
  // Search = "all face images" (FaceCapture + FaceRecognition) so FaceReg/HKT
  // cameras show up, not just the FaceCapture cam.
  params.set('include_recog', '1');
  return params;
}

let _faceTab2Page = 1;
const _FACE_TAB_PER = 24;

// Fresh load (search / reset / tab open) → always back to page 1.
async function _loadFaceTab() { _faceTab2Page = 1; await _fetchFaceTab(); }

function _faceTabGoPage(pg) {
  const n = parseInt(pg, 10);
  if (!n || n === _faceTab2Page) return;
  _faceTab2Page = n;
  _fetchFaceTab();
  document.getElementById('faceGrid2')?.scrollIntoView({ block:'start', behavior:'smooth' });
}

async function _fetchFaceTab() {
  _populateFaceFilter2Cameras();
  const params = _faceTabFilterParams();
  params.set('limit',  String(_FACE_TAB_PER));
  params.set('offset', String((_faceTab2Page - 1) * _FACE_TAB_PER));
  try {
    const res  = await fetch(`${API}/api/faces?${params}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    _faceTab2Data = list;
    const total = parseInt(res.headers.get('X-Total-Count') || list.length, 10) || 0;
    const countEl = document.getElementById('faceCount2');
    if (countEl) countEl.textContent = total;
    _renderFaceGrid2(list);
    renderPagination('facePagination2', _faceTab2Page, total, _FACE_TAB_PER, pg => _faceTabGoPage(pg));
  } catch (e) {
    console.error('_loadFaceTab:', e);
  }
}

// Single FaceCapture card — shared by the search grid and the overview gallery.
function _faceCardHtml(f) {
  const noImg = escapeHtml(I18N.t('face.noImage'));
  const img = f.snapshot
    ? `<img src="${API}/snapshots/${encodeURIComponent(f.snapshot)}" loading="lazy" decoding="async" alt="" data-err="face-noimg">`
    : `<div class="face-noimg">${noImg}</div>`;
  // Burst badge (2026-07-15) — only set when fetched with group=burst_spatial
  // (the "ใบหน้าล่าสุด" overview widget); other /api/faces callers never send
  // that param so f.burst_count is undefined there and this is a no-op.
  const burstBadge = f.burst_count > 1
    ? `<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;backdrop-filter:blur(4px)">${escapeHtml(I18N.t('snap.burstMore').replace('{n}', f.burst_count - 1))}</span>`
    : '';
  const t = f.event_time
    ? new Date(f.event_time).toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false })
    : '—';
  const wear = [];
  if (f.glass === 'sunglasses') wear.push(I18N.t('face.wearSunglasses', 'แว่นกันแดด'));
  else if (f.glass === 'yes')   wear.push(I18N.t('face.wearGlasses', 'แว่นตา'));
  if (f.mask === 'yes') wear.push(I18N.t('face.mask', 'หน้ากาก'));
  if (f.hat === 'yes')  wear.push(I18N.t('face.hat', 'หมวก'));
  const wearHtml = (wear.length ? wear : [I18N.t('face.notWorn', 'ไม่สวมใส่')]).map(w => `<span class="f-chip">${escapeHtml(w)}</span>`).join('');
  const expr = (_faceShowExpr && f.expression) ? (typeof faceExprLabel === 'function' ? faceExprLabel(f.expression) : f.expression) : '';
  // Gender badge color matches the overview gender chart (male=blue, female=pink, unknown=gray).
  const gCls = f.gender === 'male' ? 'g-male' : f.gender === 'female' ? 'g-female' : 'g-unknown';
  return `<div class="f-card" data-action="openFaceModal" data-id="${f.id}">
    <div class="f-thumb" style="position:relative">${img}${burstBadge}</div>
    <div class="f-body">
      <div class="f-demo">${t} · ${escapeHtml(f.camera_id || '')}</div>
      <div class="f-chips">
        <span class="f-chip ${gCls}">${escapeHtml(faceGenderLabel(f.gender))}</span>
        <span class="f-chip">${escapeHtml(faceAgeBucket(f.age))}</span>
        ${expr ? `<span class="f-chip">${escapeHtml(expr)}</span>` : ''}
        ${wearHtml}
      </div>
    </div>
  </div>`;
}

function _renderFaceGrid2(faces) {
  const grid = document.getElementById('faceGrid2');
  if (!grid) return;
  if (!faces.length) {
    grid.innerHTML = `<div class="face-empty">${escapeHtml(I18N.t('face.empty'))}</div>`;
    return;
  }
  grid.innerHTML = faces.map(_faceCardHtml).join('');
}

// Overview "ใบหน้าล่าสุด" gallery — latest FaceCapture, loads on overview open.
// Rows are kept so openFaceModal (page-face-gallery.js) can look them up by id.
let _faceOvLatestData = [];
function _loadFaceOvLatest() {
  const wall = document.getElementById('faceOvLatest'); if (!wall) return;
  const params = new URLSearchParams({ limit: '24', include_recog: '1', group: 'burst_spatial' });
  _faceApplySiteParam(params);
  fetch(`${API}/api/faces?${params}`).then(r => r.json()).then(rows => {
    const list = Array.isArray(rows) ? rows : [];
    _faceOvLatestData = list;
    wall.innerHTML = list.length
      ? list.map(_faceCardHtml).join('')
      : `<div class="face-empty">${escapeHtml(I18N.t('face.empty'))}</div>`;
  }).catch(() => {});
}

function resetFaceTab2() {
  ['faceFilterGender2','faceFilterAge2','faceFilterExpr2','faceFilterGlass2',
   'faceFilterMask2','faceFilterHat2',
   'faceFilterTopColor2','faceFilterBottomColor2','faceFilterTopType2','faceFilterBottomType2']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // camera = MultiPicker → deselect all + refresh summary
  const camSel = document.getElementById('faceFilterCamera2');
  if (camSel) { [...camSel.options].forEach(o => o.selected = false); if (typeof MultiPicker !== 'undefined') MultiPicker.refresh('faceFilterCamera2'); }
  clearDtValue('faceFilterFrom2');
  clearDtValue('faceFilterTo2');
  _loadFaceTab();
}

// ── Recog feed (demo parity): segment + name search + server pagination ──
let _faceMatchSearch = '';
let _faceMatchPage = 1;
const _FACE_MATCH_PER = 10;

function _faceMatchFilterParams() {
  const params = new URLSearchParams();
  // Segment drives listType view: all (hits+misses) / blackList(เฝ้าระวัง) / miss(ไม่พบ).
  // whiteList(รู้จัก) segment dropped — recognize = watch (owner decision 2026-06-22).
  if (_faceMatchMode === 'miss')           params.set('misses_only', '1');
  else if (_faceMatchMode === 'blackList') params.set('list_type', 'blackList');
  if (_faceMatchSearch) params.set('person', _faceMatchSearch);
  _faceApplySiteParam(params);
  params.set('limit',  String(_FACE_MATCH_PER));
  params.set('offset', String((_faceMatchPage - 1) * _FACE_MATCH_PER));
  return params;
}

// Quick name search in the recog feed (debounced input wired in page-nav-bindings).
function fmatchSearch(q) { _faceMatchSearch = (q || '').trim(); _faceMatchPage = 1; loadFaceMatches(); }

let _faceCamPickerSite;  // active site the picker was last built for (undefined = never)
function _populateFaceFilter2Cameras() {
  const sel = document.getElementById('faceFilterCamera2');
  if (!sel) return;
  // Rebuild when the site changes; skip if already built for this site (keeps
  // the user's multi-selection across normal reloads).
  if (sel.options.length && _faceCamPickerSite === _faceActiveSiteId) return;
  _faceCamPickerSite = _faceActiveSiteId;
  const base = typeof getActiveGroupCameras === 'function' ? getActiveGroupCameras() : cameras;
  fillCameraSelect('faceFilterCamera2', siteScopedCams(base, _faceActiveSiteId), { multiPicker: true });
}

async function loadFaceMatches() {
  const params = _faceMatchFilterParams();
  try {
    const res = await fetch(`${API}/api/face-matches?${params}`);
    const matches = await res.json();
    _faceMatchesData = Array.isArray(matches) ? matches : [];
    const total = parseInt(res.headers.get('X-Total-Count') || _faceMatchesData.length, 10) || 0;
    const countEl = document.getElementById('faceMatchCount');
    if (countEl) countEl.textContent = `${total} ${I18N.t('fmatch.items','รายการ')}`;
    renderFaceMatchGrid(_faceMatchesData);
    // Shared styled pager (window._pgHandlers dispatch) — replaces the old
    // unstyled pg-info/pg-btns markup that rendered broken.
    renderPagination('faceMatchPager', _faceMatchPage, total, _FACE_MATCH_PER,
      pg => faceMatchGoPage(pg), I18N.t('fmatch.items', 'รายการ'));
  } catch (e) {
    console.error('loadFaceMatches:', e);
  }
}

function faceMatchGoPage(pg) {
  const n = parseInt(pg, 10);
  if (!n || n === _faceMatchPage) return;
  _faceMatchPage = n;
  loadFaceMatches();
  document.getElementById('faceMatchGrid')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function _listTypeBadge(listType, fdLibName) {
  if (!listType) return '';
  const isBlack = listType === 'blackList';
  const label   = fdLibName || I18N.t(isBlack ? 'fmatch.blackList' : 'fmatch.whiteList');
  return `<span style="color:${isBlack ? 'var(--status-bad)' : 'var(--status-ok)'};font-weight:600;font-size:11px">${escapeHtml(label)}</span>`;
}

function _matchBodyChips(m) {
  const chips = [];
  // Hikvision stores camelCase/lowercase ("longSleeve", "gray") — normalize to Title Case
  // so lookups in _APP_TOP/_APP_BOT/_APP_COLOR/_COLOR_HEX (all Title Case) work correctly.
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  // Filter out Hikvision "unknown" color values — not meaningful to display
  const knownColor = c => c && c.toLowerCase() !== 'unknown' ? c : null;
  // Map Hikvision bottom category names to canonical BOSCH names
  const _BOT_NORM = { LongTrousers: 'Trousers', ShortTrousers: 'Shorts', Skirt: 'Skirt', Dress: 'Dress' };
  const normalizeBot = val => { const k = cap(val); return _BOT_NORM[k] || k; };
  const colorLabel = c => {
    if (!c) return '';
    const key = cap(c);
    return (typeof _appLabel === 'function' && _APP_COLOR && _appLabel(_APP_COLOR, key)) || escapeHtml(key);
  };
  const typeLabel = (map, val) => {
    if (!val) return '';
    const key = cap(val);
    const fromMap = typeof _appLabel === 'function' && map && _appLabel(map, key);
    return fromMap || escapeHtml(I18N.t('body.' + val, val));
  };
  if (m.jacket_color || m.jacket_type) {
    const dispColor = knownColor(m.jacket_color);
    const colorPart = dispColor ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(dispColor)}</span>` : '';
    chips.push([I18N.t('body.topColor'), `${_colorChipBg(_colorBgByName(dispColor && cap(dispColor)))}${typeLabel(_APP_TOP, m.jacket_type)}${colorPart}`]);
  }
  if (m.trousers_color || m.trousers_type) {
    const dispColor = knownColor(m.trousers_color);
    const colorPart = dispColor ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(dispColor)}</span>` : '';
    chips.push([I18N.t('body.bottomColor'), `${_colorChipBg(_colorBgByName(dispColor && cap(dispColor)))}${typeLabel(_APP_BOT, normalizeBot(m.trousers_type))}${colorPart}`]);
  }
  if (m.direction) {
    chips.push([I18N.t('body.direction'), escapeHtml(I18N.t('body.' + m.direction, m.direction))]);
  }
  if (m.hair_style) {
    chips.push([I18N.t('snap.appHair'), escapeHtml(I18N.t('body.' + m.hair_style, cap(m.hair_style)))]);
  }
  if (m.bag === 'yes') chips.push([I18N.t('snap.appBag'), '']);
  if (m.things === 'yes') chips.push([I18N.t('body.things'), '']);
  if (m.riding_bike && m.riding_bike !== 'unknown') {
    chips.push([I18N.t('body.ridingBike'), escapeHtml(I18N.t('body.' + m.riding_bike, cap(m.riding_bike)))]);
  }
  if (m.riding_passenger && m.riding_passenger !== 'unknown') {
    chips.push([I18N.t('body.ridingPassenger'), escapeHtml(I18N.t('body.' + m.riding_passenger, cap(m.riding_passenger)))]);
  }
  return chips;
}

// Recog feed (demo parity): horizontal alert-row per match. blackList=urgent (red,
// inline ack), whiteList=known (green), miss=gray. Row click opens compare modal;
// inner ack button has its own data-action so closest() dispatches to it, not the row.
function renderFaceMatchGrid(matches) {
  const feed = document.getElementById('faceMatchGrid');
  if (!feed) return;
  if (!matches.length) {
    feed.innerHTML = `<div class="face-empty">${escapeHtml(I18N.t('fmatch.empty'))}</div>`;
    return;
  }
  feed.innerHTML = matches.map(m => {
    const black = m.list_type === 'blackList';
    const white = m.list_type === 'whiteList';
    const gc = black ? 'var(--status-bad)' : white ? 'var(--status-ok)' : 'var(--text-secondary)';
    const badgeTxt = black ? I18N.t('fmatch.blackList', 'เฝ้าระวัง')
      : white ? I18N.t('fmatch.segKnown', 'รู้จัก')
      : I18N.t('fmatch.noMatch', 'ไม่พบ');
    const badge = `<span class="alert-badge" style="background:${gc}">${escapeHtml(badgeTxt)}</span>`;
    const sim = m.similarity != null ? `<span class="alert-sim">${(m.similarity * 100).toFixed(0)}%</span>` : '';
    const name = m.person_name ? escapeHtml(m.person_name) : escapeHtml(I18N.t('fmatch.noMatch', 'ไม่พบในระบบ'));
    const t = m.event_time
      ? new Date(m.event_time).toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false })
      : '—';
    const thumb = m.snapshot
      ? `<img src="${API}/snapshots/${encodeURIComponent(m.snapshot)}" loading="lazy" decoding="async" alt="" data-err="face-noimg">`
      : '';
    const ackBtn = black ? (m.acked_by
      ? `<button class="alert-ack" disabled>${escapeHtml(I18N.t('fmatch.acked', 'รับทราบแล้ว'))}</button>`
      : `<button class="alert-ack" data-action="ackFaceMatch" data-id="${m.id}">${escapeHtml(I18N.t('fmatch.ack', 'รับทราบ'))}</button>`) : '';
    const meta = `${m.fd_lib_name ? escapeHtml(m.fd_lib_name) + ' · ' : ''}${escapeHtml(m.camera_id || '')} · ${t}`;
    return `<div class="alert-row ${black ? 'urgent' : ''}" style="--gc:${gc}${m.acked_by ? ';opacity:.6' : ''}" data-action="openFaceMatchModal" data-id="${m.id}">
      <div class="alert-thumb">${thumb}</div>
      <div class="alert-body">
        <div class="alert-l1">${badge}<span class="alert-name">${name}</span>${sim}</div>
        <div class="alert-l2">${meta}</div>
      </div>
      <div class="alert-side">
        <span class="alert-time">${t}</span>
        ${ackBtn}
      </div>
    </div>`;
  }).join('');
}

function openFaceMatchModal(id) {
  const m = _faceMatchesData.find(x => String(x.id) === String(id))
         || _faceOvWatchData.find(x => String(x.id) === String(id));
  if (!m) return;

  const t = m.event_time
    ? new Date(m.event_time).toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'medium' })
    : '—';
  const sim = m.similarity != null ? `${(m.similarity * 100).toFixed(1)}%` : '—';

  const wear = [];
  if (m.glass === 'sunglasses') wear.push(I18N.t('face.wearSunglasses'));
  else if (m.glass === 'yes')   wear.push(I18N.t('face.wearGlasses'));
  if (m.mask === 'yes') wear.push(I18N.t('face.wearMask'));
  if (m.hat  === 'yes') wear.push(I18N.t('face.wearHat'));

  // Left column: detected face crop (1:1 square) + full scene below (16:9, enlarged)
  const faceCropBox = m.snapshot
    ? _faceImgBox(m.snapshot, 'face', m)
    : `<div style="width:100%;aspect-ratio:1/1;border-radius:8px;background:#000;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('face.noImage'))}</div>`;

  const fullSceneBox = m.snapshot_full || m.snapshot
    ? _faceImgBox(m.snapshot_full || m.snapshot, 'scene', m)
    : `<div style="width:100%;aspect-ratio:16/9;border-radius:8px;background:#000;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('face.noImage'))}</div>`;

  // Right column: reference image (1:1, same size as crop — no avatar for ref,
  // it's the FD Library registration photo, not the detected person)
  const refImgHtml = m.snapshot_ref
    ? `<img src="${API}/snapshots/${encodeURIComponent(m.snapshot_ref)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;display:block" alt="" data-err="face-noimg">`
    : `<div style="width:100%;aspect-ratio:1/1;border-radius:8px;background:var(--surface-overlay);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px;padding:12px;text-align:center">${escapeHtml(I18N.t('fmatch.noRef'))}</div>`;

  // Data table
  const tableHtml = `<table class="face-detail">
    <tr><td>${escapeHtml(I18N.t('fmatch.person'))}</td><td><strong>${m.person_name ? escapeHtml(m.person_name) : escapeHtml(I18N.t('fmatch.noMatch'))}</strong></td></tr>
    <tr><td>${escapeHtml(I18N.t('fmatch.listType'))}</td><td>${_listTypeBadge(m.list_type, m.fd_lib_name) || '—'}</td></tr>
    <tr><td>${escapeHtml(I18N.t('fmatch.similarity'))}</td><td>${sim}</td></tr>
    <tr><td>${escapeHtml(I18N.t('evt.colTime'))}</td><td>${escapeHtml(t)}</td></tr>
    <tr><td>${escapeHtml(I18N.t('common.camera'))}</td><td>${escapeHtml(m.camera_id || '—')}</td></tr>
    <tr><td>${escapeHtml(I18N.t('face.gender'))}</td><td>${escapeHtml(faceGenderLabel(m.gender))}</td></tr>
    <tr><td>${escapeHtml(I18N.t('face.age'))}</td><td>${escapeHtml(faceAgeBucket(m.age))}</td></tr>
    ${m.age_group ? `<tr><td>${escapeHtml(I18N.t('face.ageGroup'))}</td><td>${escapeHtml(I18N.t('ageGroup.' + m.age_group, m.age_group))}</td></tr>` : ''}
    ${m.expression ? `<tr><td>${escapeHtml(I18N.t('face.emotion'))}</td><td>${escapeHtml(faceExprLabel(m.expression))}</td></tr>` : ''}
    <tr><td>${escapeHtml(I18N.t('face.wearing'))}</td><td>${wear.length ? wear.map(w => escapeHtml(w)).join('  ') : escapeHtml(I18N.t('face.nothingWorn'))}</td></tr>
  </table>`;

  // Body appearance chips
  const bodyChips = _matchBodyChips(m);
  const bodyHtml = bodyChips.length
    ? `<div class="fm-section-label">${escapeHtml(I18N.t('body.title'))}</div>
       <div class="fm-chip-row">${bodyChips.map(([k,v]) => `<div class="fm-chip"><div>${k}</div><div>${v}</div></div>`).join('')}</div>`
    : '';

  // Pre-alarm clip (de-emphasized at bottom)
  const clipHtml = (typeof clipBlock === 'function') ? clipBlock(m) : '';

  // Download button for full scene
  const sceneFile = m.snapshot_full || m.snapshot;
  const dlBtn = sceneFile
    ? `<a class="fm-scene-dl" href="${API}/snapshots/${encodeURIComponent(sceneFile)}" download target="_blank" rel="noopener" title="${escapeHtml(I18N.t('app.downloadFull','ดาวน์โหลดภาพเต็ม'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v13M7 11l5 5 5-5"/><path d="M3 20h18"/></svg></a>`
    : '';

  // Full scene (16:9 main image) — display a w=960 thumbnail (the download
  // button above keeps the full-res link).
  const sceneHtml = sceneFile
    ? `<div class="fm-scene"><span class="fm-scene-inner"><img src="${API}/snapshots/${encodeURIComponent(sceneFile)}?w=960" loading="lazy" decoding="async" alt="" data-err="hide">${dlBtn}</span></div>`
    : '';

  // Data rows (fm-data-grid style)
  const rows = [
    [I18N.t('fmatch.person'), m.person_name ? escapeHtml(m.person_name) : `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('fmatch.noMatch'))}</span>`],
    [I18N.t('fmatch.listType'), _listTypeBadge(m.list_type, m.fd_lib_name) || '—'],
    [I18N.t('fmatch.similarity'), sim],
    [I18N.t('evt.colTime'), escapeHtml(t)],
    [I18N.t('common.camera'), escapeHtml(m.camera_id || '—')],
    [I18N.t('face.gender'), escapeHtml(faceGenderLabel(m.gender))],
    [I18N.t('face.age'), escapeHtml(faceAgeBucket(m.age))],
    ...(m.age_group ? [[I18N.t('face.ageGroup'), escapeHtml(I18N.t('ageGroup.' + m.age_group, m.age_group))]] : []),
    ...(m.expression ? [[I18N.t('face.emotion'), escapeHtml(faceExprLabel(m.expression))]] : []),
    [I18N.t('face.wearing'), wear.length ? wear.map(w => escapeHtml(w)).join('  ') : escapeHtml(I18N.t('face.nothingWorn'))],
  ];
  const dataHtml = `<div class="fm-data-grid">${rows.map(([k, v]) =>
    `<div class="fm-data-row"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`
  ).join('')}</div>`;

  // FP5 — acknowledge (watch-list only). Button moved into the shared bottom
  // footer (next to Save); label shown beside it.
  const isWatch = m.list_type === 'blackList';
  const ackedLbl = m.acked_by
    ? `${escapeHtml(I18N.t('fmatch.ackedBy','รับทราบโดย'))} ${escapeHtml(m.acked_by)} · ${new Date(m.acked_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}`
    : '';
  const ackBtnInline = isWatch
    ? `<button class="btn btn-primary" style="font-size:12px" data-action="ackFaceMatch" data-id="${m.id}"${m.acked_by ? ' disabled' : ''}>${escapeHtml(I18N.t('fmatch.ack','รับทราบ'))}</button>
       <span id="faceAckLabel" style="font-size:11px;color:var(--text-secondary)">${ackedLbl}</span>`
    : '';

  // FP4 — operator note, with ack button folded into the same bottom footer row
  const noteHtml = `<div class="fm-section-label">${escapeHtml(I18N.t('fmatch.opNote','หมายเหตุ (OPERATOR)'))}</div>
    <textarea id="faceNoteInput" data-id="${m.id}" rows="2" placeholder="${escapeHtml(I18N.t('fmatch.opNotePh','เพิ่มหมายเหตุ เช่น การดำเนินการ / รายละเอียดเพิ่มเติม'))}" style="width:100%;box-sizing:border-box;background:var(--surface-base);border:1px solid var(--border-hairline);border-radius:6px;color:var(--text-primary);font-size:13px;padding:8px;resize:vertical;font-family:inherit"></textarea>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:12px" data-action="saveFaceNote" data-id="${m.id}">${escapeHtml(I18N.t('common.save','บันทึก'))}</button>
      <span id="faceNoteSaved" style="font-size:11px;color:var(--text-secondary)"></span>
      ${ackBtnInline}
    </div>`;

  // Face crop (1:1) + Reference (1:1) pair
  const faceBox = m.snapshot
    ? `<div class="fm-img-box"><img src="${API}/snapshots/${encodeURIComponent(m.snapshot)}" alt="" data-err="hide"><div class="fm-img-label">${escapeHtml(I18N.t('fmatch.cropLabel','ที่ตรวจพบ'))}</div></div>`
    : `<div class="fm-img-box"><div class="fm-img-empty">${escapeHtml(I18N.t('face.noImage'))}</div></div>`;
  const refBox = m.snapshot_ref
    ? `<div class="fm-img-box"><img src="${API}/snapshots/${encodeURIComponent(m.snapshot_ref)}" alt="" data-err="face-noimg"><div class="fm-img-label">${escapeHtml(I18N.t('fmatch.refLabel','FD Library'))}</div></div>`
    : `<div class="fm-img-box"><div class="fm-img-empty">${escapeHtml(I18N.t('fmatch.noRef'))}</div></div>`;

  document.getElementById('faceMatchModalBody').innerHTML = `
    <div class="fm-top-grid">
      <div class="fm-col-media">
        <div class="fm-img-pair">${faceBox}${refBox}</div>
        ${sceneHtml}
      </div>
      <div class="fm-col-data">
        ${dataHtml}
        ${bodyHtml}
      </div>
    </div>
    ${clipHtml}
    ${noteHtml}`;
  document.getElementById('faceMatchModal').classList.remove('hidden');

  // Load existing note — set via .value (safe), guard against stale fetch (race).
  fetch(`${API}/api/face-matches/${m.id}/note`)
    .then(r => r.ok ? r.json() : null)
    .then(n => {
      const ta = document.getElementById('faceNoteInput');
      if (!ta || ta.dataset.id !== String(m.id)) return;
      if (n) {
        ta.value = n.note || '';
        const lbl = document.getElementById('faceNoteSaved');
        if (lbl && n.author) lbl.textContent =
          `${I18N.t('fmatch.noteSavedBy','บันทึกโดย')} ${n.author} · ${new Date(n.updated_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}`;
      }
    })
    .catch(() => {});
}

// FP4 — save operator note (POST upsert; cookie auth auto-sent, same as other writes).
function saveFaceNote(el) {
  const id = el.dataset.id;
  const ta = document.getElementById('faceNoteInput');
  const lbl = document.getElementById('faceNoteSaved');
  const note = (ta?.value || '').trim();
  if (!note) { if (lbl) lbl.textContent = I18N.t('fmatch.noteEmpty', 'กรอกหมายเหตุก่อนบันทึก'); return; }
  fetch(`${API}/api/face-matches/${id}/note`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note }),
  })
    .then(r => r.ok ? r.json() : Promise.reject(r))
    .then(n => {
      if (lbl) lbl.textContent =
        `${I18N.t('fmatch.noteSavedBy','บันทึกโดย')} ${n.author || ''} · ${new Date(n.updated_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}`;
    })
    .catch(() => { if (lbl) lbl.textContent = I18N.t('common.saveFailed', 'บันทึกไม่สำเร็จ'); });
}

// FP5 — acknowledge a watch-list match (POST upsert). Mutates the in-memory row
// so the feed chip + alert pill update without a full re-fetch.
function ackFaceMatch(el) {
  const id = el.dataset.id;
  const lbl = document.getElementById('faceAckLabel');
  fetch(`${API}/api/face-matches/${id}/ack`, { method: 'POST' })
    .then(r => r.ok ? r.json() : Promise.reject(r))
    .then(a => {
      el.disabled = true;
      if (lbl) lbl.textContent =
        `${I18N.t('fmatch.ackedBy','รับทราบโดย')} ${a.acked_by || ''} · ${new Date(a.acked_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}`;
      const row = _faceMatchesData.find(x => String(x.id) === String(id));
      if (row) { row.acked_by = a.acked_by; row.acked_at = a.acked_at; }
      renderFaceMatchGrid(_faceMatchesData);  // refresh feed chip
      _loadFaceCounts();                       // refresh watch-alert pill
    })
    .catch(() => { if (lbl) lbl.textContent = I18N.t('common.saveFailed', 'บันทึกไม่สำเร็จ'); });
}

function closeFaceMatchModal() {
  document.getElementById('faceMatchModal').classList.add('hidden');
}
