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

    // LPR/Face have their own pages + come in high-frequency bursts that bury
    // other event logs → keep them out of the generic feed (registry-driven).
    if (typeof specializedEventTypes === 'function') {
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
  _updateEvtColHeader();
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
      thumbHtml = hasSnap ? `<img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" data-err="no-img">` : `<div class="no-img">—</div>`;
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
    return `
      <div class="event-row" style="border-left:3px solid ${tintColor}" data-action="showSnapshot" data-source="events" data-idx="${idx}" data-event-id="${ev.id}">
        <div class="event-thumb">${thumbHtml}</div>
        <span style="font-size:14px">${icon}</span>
        <span class="event-time">${time}</span>
        <div style="overflow:hidden">
          ${replayBadge}<span style="color:var(--accent);font-weight:600" title="${escapeHtml(ev.event_type || '')}">${escapeHtml(eventDisplayName(ev))}</span>${plateTxt}${clipBadge}
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
