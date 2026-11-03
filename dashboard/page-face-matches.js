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

// Resolve camera_id -> the same friendly camera_name shown in the filter
// dropdown (fillCameraSelect) — cards/modals used to show the raw id
// (e.g. "HDY-NVR-03-ch1") while the picker showed the display name (e.g.
// "s.5 Face ขาเข้า"), so the two never matched (reported 2026-07-29).
// Falls back to the id itself if no camera row is found.
function _faceCamName(id) {
  const c = (typeof cameras !== 'undefined' ? cameras : []).find(x => x.camera_id === id);
  return (c && c.camera_name) || id || '';
}

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
  const prev = _faceActiveSiteId;
  _faceActiveSiteId = sid ? Number(sid) : null;
  const siteChanged = prev !== _faceActiveSiteId;
  renderFaceSitePills();
  _populateFaceFilter2Cameras();  // rescope the search-tab camera picker to the new site
  _loadFaceCounts();  // badges (เฝ้าระวัง count etc.) must match the new site scope too
  if (document.getElementById('faceTabPanelOverview') && !document.getElementById('faceTabPanelOverview').classList.contains('hidden')) faceLoadOverview();
  else if (!document.getElementById('faceTabPanelMatches').classList.contains('hidden'))  loadFaceMatches();
  else if (!document.getElementById('faceTabPanelLive')?.classList.contains('hidden')) _loadFaceLive();
  else if (!document.getElementById('faceTabPanelAllFaces').classList.contains('hidden')) {
    // 🔴 เปลี่ยน site = ตัวเลือกกล้องถูกสร้างใหม่ทั้งชุด (กล้องคนละ site กัน)
    // ถ้ายิงค้นหาต่อทันทีจะได้ผลของ "ทุกกล้องใน site ใหม่" ทับผลที่ผู้ใช้เพิ่งค้นไว้
    // ซึ่งอ่านเหมือนระบบ refresh เองแล้วเอากล้องอื่นมาปน (เจ้าของรายงาน 2026-08-11)
    // จึงล้างผลแล้วให้กดค้นหาเอง ดีกว่าตอบคำถามที่ไม่มีใครถาม
    if (siteChanged) _faceSearchStale();
    else _loadFaceTab();
  }
}

// ผลเดิมใช้ไม่ได้แล้วเพราะขอบเขตเปลี่ยน — บอกตรง ๆ แล้วรอให้กดค้นหา
function _faceSearchStale() {
  _faceClearNew();
  _faceTab2Data = [];
  const grid = document.getElementById('faceGrid2');
  if (grid) grid.innerHTML = `<div class="face-empty">${escapeHtml(
    I18N.t('face.scopeChanged', 'ขอบเขต Site เปลี่ยนแล้ว — กด “ค้นหา” เพื่อดูผลของ Site นี้'))}</div>`;
  const countEl = document.getElementById('faceCount2');
  if (countEl) countEl.textContent = '0';
  renderPagination('facePagination2', 1, 0, _FACE_TAB_PER, pg => _faceTabGoPage(pg));
  _faceRenderScope();
}

// แสดงตัวกรองที่ใช้อยู่จริงเหนือผลลัพธ์ — ถ้าตัวเลือกกล้องหลุดไปด้วยเหตุใดก็ตาม
// ผู้ใช้จะเห็นทันทีว่ากำลังดู "ทุกกล้อง" อยู่ ไม่ต้องเดาจากรูปที่โผล่มา
//
// 🔴 ต้องอ่านจาก MultiPicker.values() ซึ่งเป็น **แหล่งเดียวกับที่ query ใช้จริง**
// (_faceTabFilterParams บรรทัด "if (cams.length)") ห้ามอ่านจาก selectedOptions
// ของ <select> ดิบ เพราะสองอันไม่ตรงกันได้ — เจอตอนทดสอบ: select โชว์ว่าเลือก
// กล้องหนึ่ง แต่ query ยิงไปด้วยกล้องทั้ง site แล้วได้ผลของกล้องอื่นมาแสดง
// ถ้าป้ายนี้อ่านคนละแหล่ง มันจะยืนยันสิ่งที่ผิดให้ผู้ใช้เชื่อ ซึ่งแย่กว่าไม่มีป้าย
function _faceScopeCams() {
  if (typeof MultiPicker !== 'undefined') return MultiPicker.values('faceFilterCamera2') || [];
  const sel = document.getElementById('faceFilterCamera2');
  return sel ? [...sel.selectedOptions].map(o => o.value).filter(Boolean) : [];
}

function _faceRenderScope() {
  const el = document.getElementById('faceScopeNote');
  if (!el) return;
  const picked = _faceScopeCams();
  const siteOnly = !picked.length && _faceActiveSiteId;
  const label = picked.length
    ? (picked.length === 1 ? `<b>${escapeHtml(_faceCamName(picked[0]))}</b>` : `<b>${picked.length} กล้อง</b>`)
    : siteOnly ? `<b class="warn">ทุกกล้องใน Site นี้</b>` : `<b class="warn">ทุกกล้อง</b>`;
  el.innerHTML = `${escapeHtml(I18N.t('face.scopeNow', 'กำลังแสดงผลของ'))} ${label}`;
}

// 4 tabs: overview(FP2 shell) · recog(FaceRecognition match+miss + segment) · search(FaceCapture) · settings(FP6 shell)
// Back-compat aliases (external callers): 'capture'/'allFaces'→search, 'match'/'matches'→recog, 'miss'→recog+miss-segment.
function _switchFaceTab(tab) {
  if (tab === 'allFaces' || tab === 'capture') tab = 'search';
  if (tab === 'matches'  || tab === 'match')   tab = 'recog';
  // 'miss' used to be a segment of the alert tab; it lives on Live now.
  if (tab === 'miss') { tab = 'live'; _faceLiveMissOnly = true; }
  // FP6: settings tab moved to main Settings › การตั้งค่าระบบใบหน้า (3 tabs now)
  const PANELS = { overview:'faceTabPanelOverview', live:'faceTabPanelLive', recog:'faceTabPanelMatches', search:'faceTabPanelAllFaces', lab:'faceTabPanelLab' };
  Object.entries(PANELS).forEach(([key, id]) => document.getElementById(id)?.classList.toggle('hidden', key !== tab));
  const BTNS = { overview:'faceTabOverview', live:'faceTabLive', recog:'faceTabRecog', search:'faceTabSearch', lab:'faceTabLab' };
  Object.entries(BTNS).forEach(([key, id]) => { const b = document.getElementById(id); if (b) b.classList.toggle('active', key === tab); });
  if (tab === 'live') { _loadFaceLive(); }
  else if (tab === 'search') { _loadFaceTab(); }
  else if (tab === 'recog') { loadFaceMatches(); }
  else if (tab === 'overview') { faceLoadOverview(); }
  else if (tab === 'lab' && typeof afbInit === 'function') { afbInit(); }
  // settings = static shell, nothing to load
}


// Tab count badges (capture / match / miss) — one roundtrip
async function _loadFaceCounts() {
  try {
    const params = new URLSearchParams();
    _faceApplySiteParam(params);
    const c = await fetch(`${API}/api/faces/counts?${params}`).then(r => r.json());
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v != null ? `(${v})` : ''; };
    set('faceCntSearch', c.capture);
    // Watch-list hits only. Adding misses made the badge read 5,460 when 1,051
    // were actual alerts (measured 2026-08-02) — 81% of it was "recognition ran,
    // nobody matched", which is not something anyone acts on.
    set('faceCntRecog',  c.match);
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
  // เช็ค r.ok — เดิม 500 ถูก render เป็น KPI ศูนย์ ("0 ใบหน้า") แทนที่จะบอกว่าโหลดไม่สำเร็จ (audit 2026-10-02 · D14)
  fetch(`${API}/api/faces/stats?${params}`).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => { _renderFaceOvKpi(d); _renderFaceOvCharts(d); })
    .catch(() => {
      const el = document.getElementById('faceOvKpi');
      if (el) el.innerHTML = `<div style="padding:16px;color:var(--status-bad)">${escapeHtml(I18N.t('common.loadFailedShort', 'โหลดไม่สำเร็จ'))}</div>`;
    });
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
  // with_total=0 — แถบนี้แสดงแค่ 8 การ์ด ไม่เคยอ่าน X-Total-Count เลย
  // การนับยอดรวมทำให้ต้องไล่ทุก partition ย้อนหลังหลายเดือน (วัดได้ 11.5 วิ.ตอนเปิดหน้า)
  const params = new URLSearchParams({ list_type: 'blackList', limit: '8', with_total: '0' });
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
          <div class="alarm-meta">${sim}${escapeHtml(_faceCamName(m.camera_id))}</div>
        </div>
      </div>`;
    }).join('');
  }).catch(() => {});
}

// "ดูทั้งหมด →" on the overview's watch-list card. It used to set the alert
// tab's segment to เฝ้าระวัง as well; that segment bar is gone (see the note
// above #faceTabPanelMatches in index.html) and the assignment it left behind
// was writing to a const — every click threw "Assignment to constant variable"
// and the tab never switched, so the link had been dead since d71f350.
function faceGotoWatch() { _faceMatchPage = 1; _switchFaceTab('recog'); }

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

// ── จำนวนผลลัพธ์ของแท็บค้นหา — ยิงนับแยกหลังตารางขึ้นแล้ว (ท่าเดียวกับหน้า LPR)
// สามสถานะ และทุกสถานะพูดความจริง:
//   กำลังนับ  → "24+ · กำลังนับ…"  ไม่ใช่โชว์เลขมั่ว
//   นับได้ครบ → เลขจริง
//   นับไม่ทัน → "24+" โดย 24 = แถวที่เปิดดูมาแล้วจริง ซึ่งเป็นจริงเสมอ
let _faceTab2Total = null;      // ยอดจริง (null = ยังไม่มี)
let _faceTab2HasMore = false;
let _faceTab2Counting = false;
let _faceTab2Seq = 0;           // กันผลของการค้นหาเก่ามาทับผลใหม่

function _facePaintCount() {
  const el = document.getElementById('faceCount2');
  if (!el) return;
  const shown = _faceTab2Data.length.toLocaleString();
  if (_faceTab2Total != null) { el.textContent = _faceTab2Total.toLocaleString(); return; }
  el.textContent = `${shown}${_faceTab2HasMore ? '+' : ''}`
    + (_faceTab2Counting ? ` · ${I18N.t('face.counting', 'กำลังนับ…')}` : '');
}

function _facePaintPager() {
  renderPagination('facePagination2', _faceTab2Page, _faceTab2Total, _FACE_TAB_PER,
    pg => _faceTabGoPage(pg), undefined,
    { hasMore: _faceTab2HasMore, shown: _faceTab2Data.length });
}

// ผลที่มาช้ากว่าการค้นหาครั้งใหม่ต้องทิ้ง ไม่งั้นเลขของการค้นหาเก่าจะเด้งมาทับ
async function _faceFetchCount(params, seq) {
  const p = new URLSearchParams(params);
  p.set('count', 'only');
  p.delete('limit'); p.delete('offset'); p.delete('with_total');
  try {
    const j = await (await fetch(`${API}/api/faces?${p}`)).json();
    if (seq !== _faceTab2Seq) return;
    if (j && j.exact && typeof j.n === 'number') _faceTab2Total = j.n;
  } catch { /* นับไม่ได้ก็แสดง "N+" ตามเดิม */ }
  finally {
    if (seq === _faceTab2Seq) { _faceTab2Counting = false; _facePaintCount(); _facePaintPager(); }
  }
}

// Fresh load (search / reset / tab open) → always back to page 1.
async function _loadFaceTab() { _faceTab2Page = 1; _faceClearNew(); await _fetchFaceTab(); }

// ── "N ภาพใหม่" pill ────────────────────────────────────────────
// The search tab used to reload itself on every new_face broadcast. That is
// right for a live feed and wrong for search results: the operator asked a
// question, and the answer should not renumber itself while they read it.
// Counted instead, and applied only when pressed. The counter is a running
// tally of broadcasts since the last load, not a promise that every one of
// them matches the current filters — that is why the pill offers to reload
// rather than claiming the results are N rows short.
let _faceNewCount = 0;

function _faceClearNew() {
  _faceNewCount = 0;
  document.getElementById('faceNewPill')?.classList.add('hidden');
}

function faceNoteNew() {
  _faceNewCount++;
  const pill = document.getElementById('faceNewPill');
  const text = document.getElementById('faceNewPillText');
  if (!pill || !text) return;
  // Capped so a busy hour reads as "lots" rather than a number nobody parses.
  const shown = _faceNewCount > 99 ? '99+' : String(_faceNewCount);
  text.textContent = `${shown} ${I18N.t('face.newSince', 'ภาพใหม่ — กดเพื่อโหลด')}`;
  pill.classList.remove('hidden');
}

// Pressing it re-runs the current search from page 1, which is what "load the
// new ones" means when the newest rows sort first.
function faceApplyNew() { _loadFaceTab(); }

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
    // with_total=0 — ไม่ให้ request ของตารางไปรอการนับ · วัดจริง 2026-08-27:
    // ช่วงกว้างกว่า 1 ชั่วโมงนับไม่ทันในเพดาน ⇒ ทุกคนจ่าย 500ms ทิ้งฟรี ๆ
    // (0.51 วินาที ทั้งที่ตัวข้อมูลใช้ 0.01) · ยอดรวมยิงแยกตามมาข้างล่าง
    params.set('with_total', '0');
    const seq = ++_faceTab2Seq;
    const res  = await fetch(`${API}/api/faces?${params}`);
    const data = await res.json();
    if (seq !== _faceTab2Seq) return;          // มีการค้นหาใหม่แล้ว ทิ้งผลนี้
    const list = Array.isArray(data) ? data : [];
    _faceTab2Data = list;
    _faceTab2HasMore = res.headers.get('X-Has-More') === '1';
    _faceTab2Total = null;
    _faceTab2Counting = true;
    _facePaintCount();
    _renderFaceGrid2(list);
    _faceRenderScope();   // ให้เห็นเสมอว่าผลชุดนี้มาจากกล้องไหน
    _facePaintPager();
    _faceFetchCount(params, seq);              // ตารางขึ้นแล้ว ค่อยไปนับ
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
      <div class="f-demo">${t} · ${escapeHtml(_faceCamName(f.camera_id))}</div>
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
  // 12, not 24: this is one scrolling row on the overview now, and the rest of
  // the stream is a click away on the Live tab. Fetching a second screenful
  // nobody scrolls to is a page-load cost for nothing.
  const params = new URLSearchParams({ limit: '12', include_recog: '1', group: 'burst_spatial' });
  _faceApplySiteParam(params);
  fetch(`${API}/api/faces?${params}`).then(r => r.json()).then(rows => {
    const list = Array.isArray(rows) ? rows : [];
    _faceOvLatestData = list;
    wall.innerHTML = list.length
      ? list.map(_faceCardHtml).join('')
      : `<div class="face-empty">${escapeHtml(I18N.t('face.empty'))}</div>`;
  }).catch(() => {});
}

// ── Live tab ─────────────────────────────────────────────────────
// The continuous capture stream, and the only tab that refreshes itself. Cards
// are prepended as new_face arrives and the tail is dropped, because the
// platform takes ~47,000 captures a day (2026-08-02) and an append-only feed
// left open would grow the DOM until the tab stutters. The cap is on nodes in
// the page, not on what the operator can reach: older faces are the Search
// tab's job and it can filter by camera and time, which a live wall cannot.
const _FACE_LIVE_MAX = 60;
let _faceLivePaused = false;
let _faceLiveData = [];   // openFaceModal(id) resolves ids from here
// "ไม่พบในระบบ" — a recognition camera looked and matched nobody. It used to be
// a segment of the alert tab, which framed it as something to act on; it is a
// capture with a verdict attached, so it filters this feed instead. Measured
// 2026-08-02: 4,413 of them against 1,051 real hits, from the single camera in
// the fleet that runs recognition at all.
let _faceLiveMissOnly = false;

function _faceLiveCameraIds() {
  const sel = document.getElementById('faceLiveCamera');
  const picked = sel ? [...sel.selectedOptions].map(o => o.value).filter(Boolean) : [];
  if (picked.length) return picked;
  return _faceSiteCameraIds();   // null = every site, else the active site's cameras
}

function _faceLiveSub() {
  const el = document.getElementById('faceLiveSub');
  if (!el) return;
  const n = _faceLiveData.length;
  el.textContent = _faceLivePaused
    ? I18N.t('fmatch.livePaused', 'หยุดชั่วคราว — กดเล่นต่อเพื่อรับภาพใหม่')
    : `${n} ${I18N.t('fmatch.liveShowing', 'ภาพล่าสุด · อัปเดตอัตโนมัติ')}`;
}

async function _loadFaceLive() {
  const grid = document.getElementById('faceLiveGrid');
  if (!grid) return;
  _populateFaceFilter2Cameras('faceLiveCamera');
  // include_recog widens the feed past FaceCapture to the recognition events
  // too, so a face seen by the FDLib camera shows up here like any other.
  // The endpoint forces a 24h window when no range is given, which is what
  // keeps this cheap — the same query without that bound measured 51.6s
  // (routes/faces.js:154). Timed here at 4-7ms over 47k capture + 2.4k recog
  // rows in the window.
  const params = new URLSearchParams({ limit: String(_FACE_LIVE_MAX), include_recog: '1' });
  if (_faceLiveMissOnly) params.set('misses_only', '1');
  const ids = _faceLiveCameraIds();
  if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
  try {
    const rows = await fetch(`${API}/api/faces?${params}`).then(r => r.json());
    _faceLiveData = Array.isArray(rows) ? rows : [];
    grid.innerHTML = _faceLiveData.length
      ? _faceLiveData.map(_faceCardHtml).join('')
      : `<div class="face-empty">${escapeHtml(I18N.t('face.empty'))}</div>`;
    document.getElementById('faceLiveMissChip')?.classList.toggle('on', _faceLiveMissOnly);
    _faceLiveSub();
  } catch (e) { console.error('_loadFaceLive:', e); }
}

function faceLiveReload() { _loadFaceLive(); }

function faceLiveToggleMiss() {
  _faceLiveMissOnly = !_faceLiveMissOnly;
  document.getElementById('faceLiveMissChip')?.classList.toggle('on', _faceLiveMissOnly);
  _loadFaceLive();
}

function faceLiveTogglePause() {
  _faceLivePaused = !_faceLivePaused;
  const btn = document.getElementById('faceLivePauseBtn');
  if (btn) btn.querySelector('span').textContent = _faceLivePaused
    ? I18N.t('fmatch.liveResume', 'เล่นต่อ') : I18N.t('fmatch.livePause', 'หยุดชั่วคราว');
  if (!_faceLivePaused) _loadFaceLive();   // catch up on whatever arrived while paused
  else _faceLiveSub();
}

// Called from the new_face WebSocket handler. Takes the broadcast event rather
// than refetching: one row arrived, and re-running the query for it would cost
// a round trip per capture at ~30 captures a minute.
function faceLivePush(ev) {
  if (!ev || ev.lite) return;   // P5: lite has no snapshot — nothing to put on a card
  const panel = document.getElementById('faceTabPanelLive');
  if (!panel || panel.classList.contains('hidden') || _faceLivePaused) return;
  const ids = _faceLiveCameraIds();
  if (ids && !ids.includes(ev.camera_id)) return;   // outside the current scope
  // The new_face channel only ever carries FaceCapture (api-server.js:975), so
  // nothing arriving here is a recognition miss. While that filter is on, let
  // the feed stay as loaded rather than mixing in rows it excludes.
  if (_faceLiveMissOnly) return;
  const grid = document.getElementById('faceLiveGrid');
  if (!grid) return;
  // The broadcast carries the event row; map it onto the shape _faceCardHtml
  // reads. Anything missing renders as the same "—" a fetched row would.
  const r = ev.raw_json || {};
  const row = {
    id: ev.id, camera_id: ev.camera_id, event_time: ev.event_time,
    snapshot: r._snapshot || ev.snapshot_filename || null,
    gender: r.gender ?? null, age: r.age ?? null, expression: r.faceExpression ?? null,
    glass: r.glass ?? null, mask: r.mask ?? null, hat: r.hat ?? null,
  };
  _faceLiveData.unshift(row);
  grid.insertAdjacentHTML('afterbegin', _faceCardHtml(row));
  // Drop the tail in both the DOM and the lookup cache, or openFaceModal would
  // keep resolving ids whose cards are long gone.
  while (_faceLiveData.length > _FACE_LIVE_MAX) {
    _faceLiveData.pop();
    grid.lastElementChild?.remove();
  }
  const empty = grid.querySelector('.face-empty');
  if (empty) empty.remove();
  _faceLiveSub();
}

// Overview "ดูทั้งหมด →" on the latest strip.
function faceGotoLive() { _switchFaceTab('live'); }

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
  // Watch-list hits only, always. This used to read a segment variable whose
  // other branches (all / miss) became unreachable when the segment bar was
  // removed — see the note above #faceTabPanelMatches in index.html.
  params.set('list_type', 'blackList');
  if (_faceMatchSearch) params.set('person', _faceMatchSearch);
  _faceApplySiteParam(params);
  params.set('limit',  String(_FACE_MATCH_PER));
  params.set('offset', String((_faceMatchPage - 1) * _FACE_MATCH_PER));
  return params;
}

// Quick name search in the recog feed (debounced input wired in page-nav-bindings).
function fmatchSearch(q) { _faceMatchSearch = (q || '').trim(); _faceMatchPage = 1; loadFaceMatches(); }

// id defaults to the search tab's picker; the Live tab passes its own. Memoised
// per select, because both are rebuilt on a site change and a shared flag would
// let whichever ran first suppress the other.
const _faceCamPickerSiteBy = {};
function _populateFaceFilter2Cameras(id = 'faceFilterCamera2') {
  const sel = document.getElementById(id);
  if (!sel) return;
  // Rebuild when the site changes; skip if already built for this site (keeps
  // the user's multi-selection across normal reloads).
  if (sel.options.length && _faceCamPickerSiteBy[id] === _faceActiveSiteId) return;
  _faceCamPickerSiteBy[id] = _faceActiveSiteId;
  // LPR-role cameras never emit face events (probed 2026-07-29 — none has
  // 'face' in capture_categories) — exclude them so the picker only lists
  // cameras that can actually show up in this page's results.
  const base = (typeof getActiveGroupCameras === 'function' ? getActiveGroupCameras() : cameras)
    .filter(c => c.cam_role !== 'lpr');
  fillCameraSelect(id, siteScopedCams(base, _faceActiveSiteId), { multiPicker: true });
}


async function loadFaceMatches() {
  const params = _faceMatchFilterParams();
  try {
    const res = await fetch(`${API}/api/face-matches?${params}`);
    const matches = await res.json();
    _faceMatchesData = Array.isArray(matches) ? matches : [];
    // ไม่มี X-Total-Count = server นับไม่ทันตามเพดานเวลา (ดู routes/faces.js)
    // ⇒ ใช้ pager แบบ ก่อนหน้า/ถัดไป และบอกจำนวนแบบ "60+" แทนยอดจริง
    //   ดีกว่าให้ทั้งหน้ารอการนับที่กินเวลา 99.5% ของ request
    const raw = res.headers.get('X-Total-Count');
    const total = raw == null ? null : (parseInt(raw, 10) || 0);
    const hasMore = res.headers.get('X-Has-More') === '1';
    const countEl = document.getElementById('faceMatchCount');
    const unit = I18N.t('fmatch.items', 'รายการ');
    if (countEl) {
      countEl.textContent = total != null
        ? `${total.toLocaleString()} ${unit}`
        : `${_faceMatchesData.length.toLocaleString()}${hasMore ? '+' : ''} ${unit}`;
    }
    renderFaceMatchGrid(_faceMatchesData);
    // Shared styled pager (window._pgHandlers dispatch) — replaces the old
    // unstyled pg-info/pg-btns markup that rendered broken.
    renderPagination('faceMatchPager', _faceMatchPage, total, _FACE_MATCH_PER,
      pg => faceMatchGoPage(pg), unit,
      { hasMore, shown: _faceMatchesData.length });
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
    const meta = `${m.fd_lib_name ? escapeHtml(m.fd_lib_name) + ' · ' : ''}${escapeHtml(_faceCamName(m.camera_id))} · ${t}`;
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

// ส่งการแจ้งเตือนของ match นี้เข้า LINE ด้วยมือ — เส้นทางเดียวกับที่ระบบส่งเอง
// เซิร์ฟเวอร์เป็นคนตัดสินว่าเป็นช่องทาง AuraFace หรือ HCP Face จากที่มาของการจับคู่
// รายชื่อผู้รับดึงตอนกด ไม่ cache ไว้ — หน้านี้เปิดค้างได้ทั้งวัน ถ้า cache ไว้จะโชว์
// คนที่เพิ่งถูกปิดไปเมื่อเช้าว่ายังส่งได้ · ยิงเฉพาะตอนกดปุ่ม ไม่ใช่ตอนโหลดหน้า
async function _fmRecipients() {
  try {
    const r = await fetch(`${API}/api/line-config`, { credentials: 'include' });
    if (!r.ok) return [];
    return (await r.json())?.recipients || [];
  } catch { return []; }
}
async function _fmTelegramChats() {
  try {
    const r = await fetch(`${API}/api/telegram-config`, { credentials: 'include' });
    if (!r.ok) return [];
    const d = await r.json();
    return (d?.chats || []).map(c => ({ id: String(c.chat_id), name: c.name, type: c.type, enabled: c.enabled }));
  } catch { return []; }
}

// สถานะการเชื่อมต่อ Telegram — cache สั้น ๆ ต่อการเปิดหน้า เหมือน _lprTelegramConfig
// (page-lpr.js) · GET /api/telegram-config เป็น requireAdminOrAuditor เท่านั้น →
// auditor/ผู้ใช้ทั่วไปได้ 403 ⇒ อ่านเป็น "ไม่รู้สถานะ" ปุ่มเปิดไว้ ให้เซิร์ฟเวอร์ตัดสิน
let _fmTgConfig = null;
async function _fmTelegramConfig() {
  if (_fmTgConfig) return _fmTgConfig;
  try {
    const r = await fetch(`${API}/api/telegram-config`, { credentials: 'include' });
    if (!r.ok) return null;
    _fmTgConfig = await r.json();
    return _fmTgConfig;
  } catch { return null; }
}
async function _fmSetTelegramButtonState() {
  const btn = document.querySelector('#faceMatchModal [data-action="notifyFaceMatchTelegram"]');
  if (!btn) return;
  const cfg = await _fmTelegramConfig();
  const notConnected = !!cfg && (!cfg.enabled || !cfg.has_token);
  btn.disabled = notConnected;
  btn.title = notConnected ? I18N.t('lpr.amNotifyTgDisabled', 'ยังไม่ได้เชื่อมต่อ Telegram') : '';
}

async function notifyFaceMatch(el) {
  const id = el?.dataset?.id;
  if (!id) return;

  // เลือกผู้รับเฉพาะครั้งนี้ได้ (2026-08-27) — ใช้กล่องเดียวกับปุ่มทดสอบในหน้าตั้งค่า
  // ค่าเริ่มต้นยังเป็นผู้รับจริงของช่องทาง จึงไม่เปลี่ยนพฤติกรรมของคนที่กดผ่าน ๆ
  const all = await _fmRecipients();
  const pick = await RecipientPicker.open({
    title: I18N.t('fmatch.notifyTitle', 'ส่งเข้า LINE'),
    subtitle: I18N.t('fmatch.notifyConfirm'),
    recipients: all,
    // เซิร์ฟเวอร์เป็นคนตัดสินว่าเป็นช่องทาง AuraFace หรือ HCP Face จากที่มาของการจับคู่
    // หน้านี้จึงไม่รู้ล่วงหน้าว่าผู้รับจริงคือใคร — ปล่อยให้เซิร์ฟเวอร์เลือกเองเมื่อไม่ระบุ
    defaultIds: [],
    defaultLabel: I18N.t('fmatch.notifyDefault', 'ผู้รับจริงของช่องทางนี้'),
  });
  if (pick === null) return;

  el.disabled = true;
  fetch(`${API}/api/face-matches/${id}/notify`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pick.length ? { recipient_ids: pick } : {}),
  })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'ส่งไม่สำเร็จ'); return d; })
    .then(d => alert(I18N.t('fmatch.notifySent') + (d.recipients != null ? ` (${d.recipients})` : '')))
    .catch(e => alert(I18N.t('fmatch.notifyFailed') + e.message))
    .finally(() => { el.disabled = false; });
}

// ส่งเข้า Telegram เอง — คู่ของ notifyFaceMatch() ทุกประการ แค่คนละ endpoint/ผู้รับ
async function notifyFaceMatchTelegram(el) {
  const id = el?.dataset?.id;
  if (!id) return;

  const all = await _fmTelegramChats();
  const pick = await RecipientPicker.open({
    title: I18N.t('fmatch.notifyTgTitle', 'ส่งเข้า Telegram'),
    subtitle: I18N.t('fmatch.notifyTgConfirm'),
    recipients: all,
    // เซิร์ฟเวอร์เป็นคนตัดสินว่าเป็นช่องทาง AuraFace หรือ HCP Face จากที่มาของการจับคู่
    defaultIds: [],
    defaultLabel: I18N.t('fmatch.notifyTgDefault', 'แชทจริงของช่องทางนี้'),
  });
  if (pick === null) return;

  el.disabled = true;
  fetch(`${API}/api/face-matches/${id}/notify-telegram`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pick.length ? { telegram_chat_ids: pick } : {}),
  })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'ส่งไม่สำเร็จ'); return d; })
    .then(d => alert(I18N.t('fmatch.notifyTgSent') + (d.recipients != null ? ` (${d.recipients})` : '')))
    .catch(e => alert(I18N.t('fmatch.notifyTgFailed') + e.message))
    .finally(() => { _fmSetTelegramButtonState(); });
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
  // snapshot_ref (Hikvision FD Library) is served from /snapshots/; HCP blacklist
  // matches instead carry ref_photo (blacklist.source_records.photo_path) served
  // by /api/blacklist/photo/<sourceId>/<file>.
  const _refUrl1 = m.snapshot_ref ? `${API}/snapshots/${encodeURIComponent(m.snapshot_ref)}`
    : m.ref_photo ? `${API}/api/blacklist/photo/${m.ref_photo.split('/').map(encodeURIComponent).join('/')}` : null;
  const refImgHtml = _refUrl1
    ? `<img src="${_refUrl1}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;display:block" alt="" data-err="face-noimg">`
    : `<div style="width:100%;aspect-ratio:1/1;border-radius:8px;background:var(--surface-overlay);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px;padding:12px;text-align:center">${escapeHtml(I18N.t('fmatch.noRef'))}</div>`;

  // Data table
  const tableHtml = `<table class="face-detail">
    <tr><td>${escapeHtml(I18N.t('fmatch.person'))}</td><td><strong>${m.person_name ? escapeHtml(m.person_name) : escapeHtml(I18N.t('fmatch.noMatch'))}</strong></td></tr>
    <tr><td>${escapeHtml(I18N.t('fmatch.listType'))}</td><td>${_listTypeBadge(m.list_type, m.fd_lib_name) || '—'}</td></tr>
    <tr><td>${escapeHtml(I18N.t('fmatch.similarity'))}</td><td>${sim}</td></tr>
    <tr><td>${escapeHtml(I18N.t('evt.colTime'))}</td><td>${escapeHtml(t)}</td></tr>
    <tr><td>${escapeHtml(I18N.t('common.camera'))}</td><td>${escapeHtml(_faceCamName(m.camera_id) || '—')}</td></tr>
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
    ? `<div class="fm-scene"><span class="fm-scene-inner"><img src="${API}/snapshots/${encodeURIComponent(sceneFile)}?w=${SNAP_W.scene}" loading="lazy" decoding="async" alt="" data-err="hide">${dlBtn}</span></div>`
    : '';

  // Data rows (fm-data-grid style)
  const rows = [
    [I18N.t('fmatch.person'), m.person_name ? escapeHtml(m.person_name) : `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('fmatch.noMatch'))}</span>`],
    [I18N.t('fmatch.listType'), _listTypeBadge(m.list_type, m.fd_lib_name) || '—'],
    [I18N.t('fmatch.similarity'), sim],
    [I18N.t('evt.colTime'), escapeHtml(t)],
    [I18N.t('common.camera'), escapeHtml(_faceCamName(m.camera_id) || '—')],
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

  // ส่งเข้า LINE เอง — เฉพาะรายการเฝ้าระวัง เพราะช่องทางแจ้งเตือนผูกกับบัญชีเฝ้าระวัง
  // (การจับใบหน้าธรรมดาไม่มีผู้รับให้ส่งถึง) · ป้าย "ระบุเอง" บอกตั้งแต่ก่อนกด
  const notifyBtnInline = isWatch
    ? `<button class="btn btn-secondary" style="font-size:12px" data-action="notifyFaceMatch" data-id="${m.id}">
         <svg aria-hidden="true" width="13" height="13" style="vertical-align:-2px;margin-right:5px"><use href="#icon-send"/></svg>${escapeHtml(I18N.t('lpr.amNotify','ส่งเข้า LINE'))}
         <span class="am-manual-badge">${escapeHtml(I18N.t('lpr.amManual','ระบุเอง'))}</span>
       </button>`
    : '';
  // ส่งเข้า Telegram เอง — คู่ของปุ่ม LINE ข้างบนทุกประการ (T2 manual send)
  const notifyTgBtnInline = isWatch
    ? `<button class="btn btn-secondary" style="font-size:12px" data-action="notifyFaceMatchTelegram" data-id="${m.id}">
         <svg aria-hidden="true" width="13" height="13" style="vertical-align:-2px;margin-right:5px"><use href="#icon-send"/></svg>${escapeHtml(I18N.t('lpr.amNotifyTg','ส่งเข้า Telegram'))}
         <span class="am-manual-badge">${escapeHtml(I18N.t('lpr.amManual','ระบุเอง'))}</span>
       </button>`
    : '';

  // FP4 — operator note, with ack button folded into the same bottom footer row
  const noteHtml = `<div class="fm-section-label">${escapeHtml(I18N.t('fmatch.opNote','หมายเหตุ (OPERATOR)'))}</div>
    <textarea id="faceNoteInput" data-id="${m.id}" rows="2" placeholder="${escapeHtml(I18N.t('fmatch.opNotePh','เพิ่มหมายเหตุ เช่น การดำเนินการ / รายละเอียดเพิ่มเติม'))}" style="width:100%;box-sizing:border-box;background:var(--surface-base);border:1px solid var(--border-hairline);border-radius:6px;color:var(--text-primary);font-size:13px;padding:8px;resize:vertical;font-family:inherit"></textarea>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:12px" data-action="saveFaceNote" data-id="${m.id}">${escapeHtml(I18N.t('common.save','บันทึก'))}</button>
      <span id="faceNoteSaved" style="font-size:11px;color:var(--text-secondary)"></span>
      ${ackBtnInline}
      ${notifyBtnInline}
      ${notifyTgBtnInline}
    </div>`;

  // Face crop (1:1) + Reference (1:1) pair
  const faceBox = m.snapshot
    ? `<div class="fm-img-box"><img src="${API}/snapshots/${encodeURIComponent(m.snapshot)}" alt="" data-err="hide"><div class="fm-img-label">${escapeHtml(I18N.t('fmatch.cropLabel','ที่ตรวจพบ'))}</div></div>`
    : `<div class="fm-img-box"><div class="fm-img-empty">${escapeHtml(I18N.t('face.noImage'))}</div></div>`;
  const _refUrl2 = m.snapshot_ref ? `${API}/snapshots/${encodeURIComponent(m.snapshot_ref)}`
    : m.ref_photo ? `${API}/api/blacklist/photo/${m.ref_photo.split('/').map(encodeURIComponent).join('/')}` : null;
  const refBox = _refUrl2
    ? `<div class="fm-img-box"><img src="${_refUrl2}" alt="" data-err="face-noimg"><div class="fm-img-label">${escapeHtml(I18N.t('fmatch.refLabel','FD Library'))}</div></div>`
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
        <div id="fmAppearanceSection" data-eid="${m.id}"></div>
      </div>
    </div>
    ${clipHtml}
    ${noteHtml}`;
  document.getElementById('faceMatchModal').classList.remove('hidden');
  _fmSetTelegramButtonState();

  // IVA Pro appearance (from the appearances table, matched via event_id —
  // separate/richer data than the raw_json-derived body chips above, e.g.
  // hair color, bag type, helmet) — lazy, only shown when a record exists.
  // Reuses the same fetch+render pair as the Events modal (page-snapshots.js).
  fetch(`${API}/api/events/${m.id}/appearance`)
    .then(r => r.ok ? r.json() : null)
    .then(ap => {
      if (!ap) return;
      const sec = document.getElementById('fmAppearanceSection');
      if (!sec || sec.dataset.eid !== String(m.id)) return;
      sec.innerHTML = _renderAppearanceSection(ap);
    })
    .catch(() => {});

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
