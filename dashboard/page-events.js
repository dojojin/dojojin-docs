// ============================================================
// Vigil Platform — Events Page (Event List & Filters)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================


// ============================================================
// Events Page
// ============================================================
// (Appearance Search Page → dashboard/page-appearance.js)

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
  text.innerHTML = `<svg aria-hidden="true" width="11" height="11" style="vertical-align:-1px;margin-right:4px"><use href="#icon-search"/></svg><strong>Filter from Stats:</strong> ${escapeHtml(_drillFilter.label || '')}`;
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
// เซิร์ฟเวอร์หยุดนับที่เพดาน (X-Total-Capped) เมื่อผลกว้างเกิน — ค่าที่ได้เป็น
// "อย่างน้อยเท่านี้" จึงต้องขึ้น "10,000+" ไม่ใช่เอาค่าพื้นไปโชว์เป็นยอดจริง
let _evtTotalCapped = false;
// ป้ายเดียวกันถูกเขียนสองที่ (โหลดหน้า + live push ใน dashboard.js) — เคยหลุด
// ไม่ตรงกันมาแล้ว จึงรวมไว้ที่ฟังก์ชันเดียว
function evtCountLabel() {
  return `${_evtTotal.toLocaleString()}${_evtTotalCapped ? '+' : ''} events`;
}
let _evtNewSincePage1 = 0;
let _evtPaused = false;                     // when true, WS prepends are queued, not rendered
let _evtCategories = [];                    // cached from /api/categories
const CLASS_HIERARCHY_UI = {
  Person:  ['Person','Face','HumanFace','HumanBody','Pedestrian'],
  Vehicle: ['Vehicle','Car','Truck','Bus','Motorcycle','Motorbike','Van','Bicycle','Bike'],
  Other:   ['Animal','LicensePlate','Object'],
};

async function populateEventFilters() {
  // Camera dropdown — active group's cameras, scoped to the active op-site
  fillCameraSelect('evtFilterCam', siteScopedCams(getActiveGroupCameras(), _opActiveSiteId), { allOption: true });

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

// ทุกครั้งที่กรอง/เปลี่ยนหน้า/สลับไซต์ จะยิง fetch ใหม่ — ถ้าอันเก่ามาช้ากว่าอันใหม่
// มันจะเขียนทับผลที่ถูกต้องแบบเงียบ ๆ (เหตุจริง 2026-08-30: คลิกไซต์ RMUTR-V แล้ว
// ได้รายการของหาดใหญ่ · เลือก class แล้วได้ผลของ filter ก่อนหน้า — อาการ "บางที
// ค้นหาไม่เจอ" ที่เจ้าของรายงาน) · ทางแก้มาตรฐาน: ให้หมายเลขลำดับกับทุก request
// แล้วทิ้งผลที่ไม่ใช่ลำดับล่าสุด
let _evtSeq = 0;

async function loadEvents(page = 1) {
  _evtPage = page;
  if (page === 1) _evtNewSincePage1 = 0;
  const seq = ++_evtSeq;
  try {
    const offset = (_evtPage - 1) * PAGE_SIZE;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    // Tab → server-side filter (was buggy client-side after pagination)
    if (currentEventTab && currentEventTab !== 'all') params.set('tab', currentEventTab);

    // LPR/Face have their own pages + come in high-frequency bursts that bury
    // other event logs → keep them out of the generic feed (registry-driven),
    // unless the operator has switched them back on to commission a camera.
    if (!evtShowSpecialized() && typeof specializedEventTypes === 'function') {
      params.set('exclude_types', specializedEventTypes().join(','));
    }

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
    if (!cm) {
      const ids = getActiveScopedCameraIds();
      // ids === [] (group/site combo matches nothing) must still filter to
      // zero rows, not fall through to "no filter" — cameras= with a real
      // list is safe either way since the backend does camera_id = ANY(...).
      if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
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
    if (seq !== _evtSeq) return;               // มี request ใหม่กว่าออกไปแล้ว ทิ้งอันนี้
    const total = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    const capped = res.headers.get('X-Total-Capped') === '1';
    const rows = await res.json();
    if (seq !== _evtSeq) return;               // เช็คซ้ำหลัง await ตัวที่สอง
    _evtTotal = total;
    _evtTotalCapped = capped;
    allEvents = rows;
    _renderDrillBanner();
    _evtSyncRangeBanner();
    renderEvents();
    document.getElementById('evtCount').textContent = evtCountLabel();
    renderPagination('eventsPagination', _evtPage, _evtTotal, PAGE_SIZE,
      (p) => loadEvents(p), 'event');
    updateKPIs();
  } catch (e) { console.error(e); }
}

function setEventTab(tab, btn) {
  currentEventTab = tab;
  document.querySelectorAll('#page-events .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _updateEvtColHeader();
  loadEvents(1);                              // server-side filter — fixes pagination undercount
}

// ── 24h default window — tell the operator, don't just do it ───────────────
// The server bounds the feed to 24h when the caller sends no from/to, because
// COUNT(*) OVER () otherwise counts the whole history to render twenty rows.
// The banner exists so a shorter-than-expected list reads as a setting rather
// than as missing data — the failure mode that matters here is arriving from a
// card that counted a wider range and silently seeing fewer rows.
// Shown only when the range fields are empty, i.e. exactly when the server
// applies its default; picking any range hides it because nothing is implied.
// แบนเนอร์บอกช่วงเวลาที่กำลังดูอยู่ — เดิมโชว์เฉพาะตอนไม่ได้ตั้งช่วงเลย ทำให้กด
// "7 วัน / 30 วัน" แล้วเห็นแค่ค่าในช่อง "จาก" ส่วนขอบบนไม่มีอะไรบอก (เจ้าของทัก
// 2026-08-30) · ตอนนี้บอกทั้งสองฝั่งเสมอ และเขียนให้ชัดว่าไม่ได้ตั้ง "ถึง" = ถึงตอนนี้
function _evtSyncRangeBanner() {
  const el = document.getElementById('evtRangeBanner');
  if (!el) return;
  const from = getDtValue('evtFilterFrom'), to = getDtValue('evtFilterTo');
  // ใช้ id ของตัวเอง ไม่ใช่ data-i18n — ป้ายนี้ถูก JS เขียนตามช่วงที่เลือก ถ้าปล่อยให้
  // ระบบ i18n ถือครองอยู่ ข้อความจะถูกเขียนทับกลับเป็นค่า default ทุกครั้งที่ applyI18n
  const txt = document.getElementById('evtRangeText');
  el.classList.remove('hidden');
  if (!txt) return;
  const f = (v) => new Date(v).toLocaleString(I18N.lang === 'en' ? 'en-GB' : 'th-TH',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (!from && !to) { txt.textContent = I18N.t('evt.rangeDefault'); return; }
  txt.textContent = from && to ? `${f(from)} – ${f(to)}`
    : from ? `${f(from)} – ${I18N.t('evt.rangeNow')}`
    : `${I18N.t('evt.rangeStart')} – ${f(to)}`;
}

// Shortcut buttons: fill the real "from" field rather than inventing a second
// notion of range, so the widened window survives paging, search and CSV export
// like any hand-typed date would.
// setDtValue takes a Date and handles both the AirDatepicker instance and the
// native-input fallback, so hand-formatting a string here would only add a
// parse step that could disagree with it.
function evtSetRangeDays(days) {
  setDtValue('evtFilterFrom', new Date(Date.now() - days * 86400000));
  _evtSyncRangeBanner();   // อัปเดตป้ายทันทีที่กด ไม่ต้องรอ fetch จบ
  loadEvents(1);
}

// ── "รวม LPR / ใบหน้า" — one switch, honoured by BOTH paths ────────────────
// Until now the fetch excluded LPR/Face while the live WebSocket push did not,
// so at ~4 anprAlarm/sec the twenty rows the server had carefully filtered were
// pushed off screen within seconds: the exclusion existed but never reached the
// operator's eyes. Both paths now read this one value.
// localStorage, not system_settings: this is "what do I want to look at right
// now", not platform policy. One person commissioning a camera must not flood
// the feed for every other operator, and a forgotten setting must not sit
// switched on system-wide with nobody knowing who set it.
const EVT_SPECIALIZED_KEY = 'vigil.events.includeSpecialized';

function evtShowSpecialized() {
  try { return localStorage.getItem(EVT_SPECIALIZED_KEY) === '1'; } catch { return false; }
}

// Does this event belong in the generic feed right now? Called by the live push
// in dashboard.js so a streamed row obeys exactly the rule the query obeys.
// live push ต้องผ่าน "ตัวกรองชุดเดียวกับที่ fetch ใช้" ไม่ใช่แค่กัน LPR/Face
//
// เหตุจริง 2026-08-30 (เจ้าของรายงาน "เลือก Object Class แล้วค้นหาไม่เจอ" และ
// "เลือก Site แล้วผลไม่เปลี่ยน"): ฟังก์ชันนี้เช็คแค่ LPR/Face ⇒ event ใหม่ทุกตัว
// ที่ไหลเข้ามาถูก unshift ทับผลค้นหา และ _evtTotal ก็ถูกบวกตาม · วัดจริง: เลือก
// Motorcycle แล้ว fetch ได้ 19 แถวถูกต้อง แต่ผ่านไป 9 วินาที Car โผล่มาแทน
// (ที่ ~8 event/วินาที หน้าจอ 20 แถวถูกดันออกหมดในไม่ถึงนาที = อาการ "ค้นหาไม่เจอ")
//
// เช็คเท่าที่ฝั่งเบราว์เซอร์รู้จริง · เงื่อนไขที่ตัดสินจากข้อมูลที่ไม่มีในฝั่งนี้
// (หมวด Event ที่ต้อง match กับ mapping rules ในฐานข้อมูล) ให้ถือว่า "ไม่รับ"
// ไว้ก่อน — ปล่อยของที่อาจไม่ตรงขึ้นจอ เสียหายกว่าเงียบไว้แล้วให้ผู้ใช้กดรีเฟรช
function evtFeedAccepts(ev) {
  if (!ev) return false;
  // P5 — a lite broadcast carries only counter/badge fields, not enough to
  // render a row. Reached only during the subscribe round-trip; once the
  // subscription lands this page receives the full event.
  if (ev.lite) return false;
  if (!evtShowSpecialized() && typeof specializedEventTypes === 'function'
      && specializedEventTypes().includes(ev.event_type)) return false;

  const val = (id) => (document.getElementById(id)?.value || '').trim();

  // หมวด Event — ฝั่งนี้ไม่มี mapping rules จึงตัดสินไม่ได้ ⇒ ไม่ push ระหว่างกรอง
  if (val('evtFilterCategory')) return false;
  // คำค้น — backend ค้นหลายคอลัมน์ด้วยกติกาของตัวเอง ไม่เลียนแบบให้ต่างกันเงียบ ๆ
  if (val('evtSearch')) return false;

  const cls = val('evtFilterClass');
  if (cls) {
    const want = CLASS_HIERARCHY_UI[cls] || [cls];   // Person/Vehicle เป็นกลุ่ม
    if (!want.includes(ev.object_class)) return false;
  }
  const rn = val('evtFilterRule');
  if (rn && ev.rule_name !== rn) return false;

  const cm = val('evtFilterCam');
  if (cm) { if (ev.camera_id !== cm) return false; }
  else if (typeof getActiveScopedCameraIds === 'function') {
    const ids = getActiveScopedCameraIds();          // null = ทุกกล้อง
    if (ids && !ids.includes(ev.camera_id)) return false;
  }

  const t = ev.event_time ? new Date(ev.event_time).getTime() : NaN;
  const from = getDtValue('evtFilterFrom'), to = getDtValue('evtFilterTo');
  if (from && Number.isFinite(t) && t < new Date(from).getTime()) return false;
  if (to   && Number.isFinite(t) && t > new Date(to).getTime())   return false;

  // ตัวกรองจากการ drill มาจากหน้าสถิติ ก็เป็นตัวกรองเหมือนกัน
  if (_drillFilter && (_drillFilter.category_id || _drillFilter.dow != null
      || _drillFilter.hour != null)) return false;
  if (_drillFilter?.cls && !cls && ev.object_class !== _drillFilter.cls) return false;
  if (_drillFilter?.rule_name && !rn && ev.rule_name !== _drillFilter.rule_name) return false;
  if (_drillFilter?.camera && !cm && ev.camera_id !== _drillFilter.camera) return false;
  return true;
}

function toggleEventsSpecialized() {
  const cb = document.getElementById('evtIncludeSpecialized');
  try { localStorage.setItem(EVT_SPECIALIZED_KEY, cb && cb.checked ? '1' : '0'); } catch { /* private mode */ }
  // Including the specialized types means this feed now needs the full LPR/face
  // rows off the WS, not the lite variant.
  if (typeof wsSubscribe === 'function') wsSubscribe();
  loadEvents(1);   // refetch: the exclusion lives server-side
}

// Reflect the stored value into the box — the checkbox is static HTML, so
// without this it renders unchecked while the feed behaves as switched on.
function syncEventsSpecializedBox() {
  const cb = document.getElementById('evtIncludeSpecialized');
  if (cb) cb.checked = evtShowSpecialized();
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


function _updateEvtColHeader() {
  const hdr = document.getElementById('evtColHeader');
  if (!hdr) return;
  hdr.innerHTML = `<span>Snap</span><span></span><span data-i18n="evt.colTime">เวลา</span>`
    + `<span data-i18n="evt.colEvent">เหตุการณ์ / กล้อง</span>`
    + `<span style="text-align:center" data-i18n="evt.colCat">หมวด</span>`;
  if (typeof I18N !== 'undefined' && I18N.apply) I18N.apply(hdr);
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

// ── มุมมองรายการ / ภาพ (เจ้าของขอ 2026-08-27) ────────────────────────────
// จำไว้ใน localStorage ไม่ใช่ตัวแปรในหน่วยความจำ — คนที่เลือกมุมมองภาพไว้
// ไม่ควรต้องกดใหม่ทุกครั้งที่รีเฟรชหน้า
const EVT_VIEW_KEY = 'vigil.events.view';
let _evtView = (() => {
  try { return localStorage.getItem(EVT_VIEW_KEY) === 'grid' ? 'grid' : 'list'; }
  catch { return 'list'; }   // โหมด private ของบางเบราว์เซอร์โยนตรงนี้
})();

function evtSetView(el) {
  const v = el?.dataset?.view === 'grid' ? 'grid' : 'list';
  if (v === _evtView) return;
  _evtView = v;
  try { localStorage.setItem(EVT_VIEW_KEY, v); } catch { /* จำไม่ได้ก็ยังใช้งานได้ */ }
  _evtSyncViewUI();
  renderEvents();
}

// ปุ่มที่ active + ซ่อนหัวคอลัมน์ตอนเป็น grid (หัวคอลัมน์ไม่มีความหมายกับการ์ด)
function _evtSyncViewUI() {
  document.querySelectorAll('.evt-viewbtn').forEach((b) => {
    const on = b.dataset.view === _evtView;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const head = document.getElementById('evtColHeader');
  if (head) head.style.display = _evtView === 'grid' ? 'none' : '';
  const list = document.getElementById('eventsList');
  if (list) list.classList.toggle('events-list--grid', _evtView === 'grid');
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

  _evtSyncViewUI();
  document.getElementById('eventsList').innerHTML = allEvents.map((ev, idx) => {
    const time = new Date(ev.event_time).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});

    const icon = ICONS[ev.event_type] || ICONS[ev.event_type?.split('/').pop()] || '📹';
    const hasSnap = !!ev.snapshot_file;
    const rj = ev.raw_json || {};
    // Single classification source (event-domains.js) — drives thumb + badge.
    const d = (typeof eventDomain === 'function') ? eventDomain(ev) : { domain:'general', render:'image', color:'var(--muted)', i18nKey:null };

    // Thumb: LPR → synthetic plaque (raw_json), face → badge, else camera crop.
    let thumbHtml;
    if (d.render === 'plaque' && typeof lprPlaque === 'function') {
      thumbHtml = lprPlaque(rj.plate, { vehicleType: rj.vehicleType, plateColor: rj.plateColor, region: rj.region, feed: true });
    } else if (d.render === 'faceBadge') {
      thumbHtml = `<span class="face-badge"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg></span>`;
    } else {
      // lazy + async: 20 การ์ดต่อหน้า ถ้ายิงพร้อมกันหมดจะไปกองที่อุโมงค์ของ edge
      // (ภาพย่อถูกย่อที่ edge แล้ว แต่ยังไม่มีเหตุให้โหลดใบที่ยังไม่ได้เลื่อนไปเห็น)
      thumbHtml = hasSnap ? `<img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=${SNAP_W.card}" loading="lazy" decoding="async" data-err="no-img">` : `<div class="no-img">—</div>`;
    }

    // หมวด column: domain badge (LPR/ใบหน้า) → else mapped category → else object_class
    const cat = _eventCategoryFor(ev);
    const domainLabel = d.i18nKey ? I18N.t(d.i18nKey) : '';
    const tintColor = domainLabel ? d.color : (cat?.color || (ev.rule_name ? 'var(--accent)' : 'var(--muted)'));
    let catCell;
    if (domainLabel) {
      catCell = `<span class="evt-cat-badge" style="background:${d.bg};color:${d.color}">${escapeHtml(domainLabel)}</span>`;
    } else if (cat) {
      catCell = `<span class="evt-cat-badge" style="background:${cat.color}33;color:${cat.color}">${cat.icon || ''} ${escapeHtml(cat.name)}</span>`;
    } else {
      const cls = ev.object_class || (ev.count != null ? `#${ev.count}` : ev.state || '—');
      catCell = `<span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(cls)}</span>`;
    }

    // LPR: surface the plate number in the name column (plaque is too small to read)
    const plateTxt = (d.domain === 'lpr' && rj.plate)
      ? ` <span style="color:var(--text-primary);font-weight:700;letter-spacing:.5px">${escapeHtml(typeof lprPlateLabel === 'function' ? lprPlateLabel(rj.plate) : rj.plate)}</span>` : '';
    const clipBadge = ev.clip_file && ev.clip_status === 'done'
      ? `<span style="font-size:9px;color:var(--accent);margin-left:4px" title="${I18N.t('evt.clipTip')}"><svg aria-hidden="true" width="10" height="10" style="vertical-align:-1px"><use href="#icon-media"/></svg></span>` : '';
    // Replay/delayed badge: a camera (Hikvision ANR / store-and-forward) can buffer
    // detections during an uplink gap and flush them later — they arrive now but the
    // shown event_time is the true (old) detection time. Flag when received_at lags
    // event_time by > 5 min so the operator knows it's not realtime. One-directional.
    const delayMs = ev.received_at ? (new Date(ev.received_at) - new Date(ev.event_time)) : 0;
    const replayBadge = delayMs > 5 * 60 * 1000
      ? ` <span style="font-size:9px;padding:1px 5px;border:1px solid var(--warn);border-radius:4px;color:var(--warn);white-space:nowrap" title="${escapeHtml(I18N.t('evt.replayTip'))}">${escapeHtml(I18N.t('evt.replay'))}</span>` : '';
    // SEC-002: fields from MQTT/DB are attacker-controlled — escape before innerHTML
    const nameHtml = `<span style="color:var(--accent);font-weight:600" title="${escapeHtml(ev.event_type || '')}">${escapeHtml(eventDisplayName(ev))}</span>${plateTxt}${clipBadge}`;

    if (_evtView === 'grid') {
      // การ์ด: ภาพเป็นพระเอก (เหตุผลเดียวที่มุมมองนี้มีอยู่) เวลาไปทับมุมภาพ
      // ⚠️ ไม่ใส่ไอคอน emoji เหมือนแถวรายการ — โค้ดใหม่ใช้ SVG เท่านั้น และในการ์ด
      //    ตัวภาพบอกได้ดีกว่าไอคอนอยู่แล้ว (CLAUDE.md ข้อ 16)
      return `
        <div class="event-card" style="border-left-color:${tintColor}"
             data-action="showSnapshot" data-source="events" data-idx="${idx}" data-event-id="${ev.id}">
          <div class="event-card-thumb">${thumbHtml}<span class="event-card-time">${time}</span></div>
          <div class="event-card-body">
            <div class="event-card-name">${replayBadge}${nameHtml}</div>
            <div class="event-card-cam" title="${escapeHtml(ev.camera_id)}">${escapeHtml(ev.camera_id)}</div>
            <div class="event-card-foot">${catCell}</div>
          </div>
        </div>`;
    }

    return `
      <div class="event-row" style="border-left:3px solid ${tintColor}" data-action="showSnapshot" data-source="events" data-idx="${idx}" data-event-id="${ev.id}">
        <div class="event-thumb">${thumbHtml}</div>
        <span style="font-size:14px">${icon}</span>
        <span class="event-time">${time}</span>
        <div style="overflow:hidden">
          ${replayBadge}${nameHtml}
          <span style="color:var(--muted);margin-left:6px;font-size:10px">${escapeHtml(ev.camera_id)}</span>
        </div>
        <span class="event-class" style="text-align:center">${catCell}</span>
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
