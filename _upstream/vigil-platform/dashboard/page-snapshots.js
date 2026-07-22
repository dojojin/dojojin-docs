// ============================================================
// Vigil Platform — Snapshots Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
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
  fillCameraSelect('snapFilterCam', siteScopedCams(getActiveGroupCameras(), _opActiveSiteId), { allOption: true });

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
    // LPR + Face = separate categories (own pages) → keep them out of the
    // generic event-snapshot feed (registry-driven; FaceCapture already excluded globally).
    exclude_types: (typeof specializedEventTypes === 'function' ? specializedEventTypes().join(',') : 'anprAlarm,FaceRecognition'),
    // Burst-grouping (2026-07-15) — collapse consecutive same-camera+type
    // events <=8s apart into one card ("+N" badge, expandBurst()). Opt-in
    // param; Events/alert/dwell queries never send this, so they're unaffected.
    group: 'burst',
  });
  if (cam) params.set('camera', cam);
  if (!cam) {
    const ids = getActiveScopedCameraIds();
    if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
  }
  if (rule) params.set('rule_name', rule);
  if (categoryId) params.set('category_id', categoryId);
  if (from) params.set('from', toIso(from));
  if (to)   params.set('to',   toIso(to));

  const container = document.getElementById('snapsContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
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
    if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--status-bad)">${escapeHtml(I18N.t('common.loadFailedShort'))}</div>`;
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
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${I18N.t('snap.noMatch')}</div>`;
    return;
  }

  if (currentSnapView === 'grid') {
    c.innerHTML = `<div class="snap-grid">${snapshots.map((ev, idx) => {
      const time = new Date(ev.event_time);
      const clipBadge = ev.clip_file && ev.clip_status === 'done'
        ? `<span title="${I18N.t('snap.clipTip')}" data-action="showMediaClip" data-source="snaps" data-idx="${idx}" style="position:absolute;top:6px;right:6px;background:rgba(91,141,239,0.9);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;cursor:pointer;backdrop-filter:blur(4px)"><svg aria-hidden="true" width="10" height="10" style="vertical-align:-1px"><use href="#icon-media"/></svg> ${ev.clip_duration_sec ? parseFloat(ev.clip_duration_sec).toFixed(0) + 's' : 'clip'}</span>`
        : '';
      // Burst-grouping badge (2026-07-15) — ev.burst_count/_first_time/_last_time
      // come from GET /api/events?group=burst. >1 means other snapshots were
      // collapsed into this card; click opens expandBurst() (separate
      // data-action so it doesn't also trigger the tile's showSnapshot).
      const burstBadge = ev.burst_count > 1
        ? `<span data-action="expandBurst" data-source="snaps" data-idx="${idx}" style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;cursor:pointer;backdrop-filter:blur(4px)">${escapeHtml(I18N.t('snap.burstMore').replace('{n}', ev.burst_count - 1))}</span>`
        : '';
      // SEC-002: escape all camera/MQTT-derived fields
      return `
        <div class="snap-item" style="position:relative" data-action="showSnapshot" data-source="snaps" data-idx="${idx}">
          <img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" loading="lazy" data-err="dim">
          ${clipBadge}
          ${burstBadge}
          <div class="snap-item-info">
            <div style="font-weight:600;display:flex;justify-content:space-between;gap:4px">
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.object_class || eventDisplayName(ev))}</span>
              <span title="${escapeHtml(ev.snapshot_source || '')}" style="color:${ev.snapshot_source === 'mqtt' ? 'var(--purple)' : 'var(--warn)'};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;flex:0 0 auto;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.snapshot_source || '')}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:9px">${escapeHtml(ev.camera_id)} · ${time.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false})}</div>
          </div>
        </div>`;
    }).join('')}</div>`;
  } else {
    c.innerHTML = snapshots.map((ev, idx) => {
      const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
      const clipChip = ev.clip_file && ev.clip_status === 'done'
        ? `<span data-action="showMediaClip" data-source="snaps" data-idx="${idx}" style="display:inline-block;margin-left:8px;background:rgba(91,141,239,0.15);color:var(--accent);font-size:10px;padding:2px 7px;border-radius:3px;cursor:pointer;border:1px solid rgba(91,141,239,0.3)" title="${I18N.t('snap.clipTip')}"><svg aria-hidden="true" width="10" height="10" style="vertical-align:-1px"><use href="#icon-media"/></svg> ${ev.clip_duration_sec ? parseFloat(ev.clip_duration_sec).toFixed(0) + 's' : 'clip'}</span>`
        : '';
      // SEC-002: escape all camera/MQTT-derived fields
      return `
        <div style="display:grid;grid-template-columns:100px 1fr;gap:14px;padding:10px;border-bottom:1px solid var(--border-hairline);cursor:pointer" data-action="showSnapshot" data-source="snaps" data-idx="${idx}">
          <img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" style="width:100px;height:60px;object-fit:cover;border-radius:4px">
          <div>
            <div style="font-weight:600;font-size:13px">${escapeHtml(eventDisplayName(ev))} · ${escapeHtml(ev.object_class || '—')}${clipChip}</div>
            <div style="color:var(--text-secondary);font-size:11px;margin-top:2px">${escapeHtml(ev.camera_id)}</div>
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
  const _FIELD_TILE = 'background:var(--surface-base);border:1px solid var(--border-hairline);border-radius:6px;padding:8px 10px';
  const modal = document.getElementById('snapModal');
  const time = new Date(ev.event_time);
  document.getElementById('snapModalTitle').textContent = `${eventDisplayName(ev)} - ${ev.camera_id}`;

  // Phase 2 — the modal shows a medium ?w=640 thumbnail (fast); the
  // full image loads only on the explicit "ดูภาพเต็ม" click.
  // When a BOSCH ObjectDetection event has both MQTT body crop (_snapshot)
  // and HTTP full-scene (_snapshot_full), show them side-by-side.
  // ANPR: plate crop (left, bg #111) + scene (right) when both are present.
  const isAnpr = ev.event_type === 'anprAlarm';
  const isFaceMatch = ev.event_type === 'FaceRecognition';
  const snapFull = ev.raw_json?._snapshot_full;
  const plateFile = isAnpr ? ev.plate_image : null;
  const imgHtml = ev.snapshot_file
    ? (snapFull
        ? `<div style="display:grid;grid-template-columns:1fr 1.5fr;gap:10px">
             <div style="position:relative"><img id="snapModalImg" src="${API}/snapshots/${ev.snapshot_file}?w=320" style="width:100%;max-height:300px;object-fit:contain;background:#000;border-radius:8px;display:block"></div>
             <div><img src="${API}/snapshots/${encodeURIComponent(snapFull)}?w=640" style="width:100%;max-height:300px;object-fit:contain;background:#000;border-radius:8px;display:block"></div>
           </div>`
        : plateFile
          ? `<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;align-items:start">
               <div style="background:#111;border-radius:8px;overflow:hidden">
                 <img src="${API}/snapshots/${plateFile}?w=280" style="width:100%;max-height:160px;object-fit:contain;display:block">
               </div>
               <div style="position:relative"><img id="snapModalImg" src="${API}/snapshots/${ev.snapshot_file}?w=640" style="width:100%;max-height:400px;object-fit:contain;background:#000;border-radius:8px;display:block"></div>
             </div>`
          : `<div style="position:relative"><img id="snapModalImg" src="${API}/snapshots/${ev.snapshot_file}?w=640" style="width:100%;max-height:400px;object-fit:contain;background:#000;border-radius:8px;display:block"></div>`)
    : (plateFile
        ? `<div style="background:#111;border-radius:8px;overflow:hidden;text-align:center;padding:8px"><img src="${API}/snapshots/${plateFile}?w=400" style="max-width:100%;max-height:180px;object-fit:contain;display:inline-block"></div>`
        : `<div style="height:200px;display:flex;align-items:center;justify-content:center;background:var(--surface-overlay);border-radius:8px;color:var(--text-secondary)">${I18N.t('snap.noImage')}</div>`);

  const rj = ev.raw_json || {};

  const LPR_VTYPE = {
    twoWheelVehicle:'มอเตอร์ไซค์', motorcycle:'มอเตอร์ไซค์', motorbike:'มอเตอร์ไซค์',
    SUVMPV:'SUV/MPV', van:'รถตู้', pickupTruck:'กระบะ', truck:'รถบรรทุก',
    vehicle:'รถยนต์', car:'รถยนต์', bus:'รถโดยสาร', buggy:'บั๊กกี้',
  };
  // ANPR color helpers — safe-call _lprColorDot (defined in page-lpr.js, loaded after)
  const _lprDot = typeof _lprColorDot === 'function' ? _lprColorDot : () => '';
  const _lprCLabel = (raw) => {
    if (!raw) return '';
    const key = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const lang = I18N.getLang();
    return (_APP_COLOR[key] && _APP_COLOR[key][lang]) || key;
  };
  const _lprDirLabel = (d) => {
    const key = (d || '').toLowerCase();
    if (key === 'forward')  return I18N.t('lpr.dirForward', 'ขาเข้า');
    if (key === 'reverse')  return I18N.t('lpr.dirReverse', 'ขาออก');
    return escapeHtml(d);
  };

  const fields = isAnpr ? [
    [I18N.t('evt.colTime'), time.toLocaleString('th-TH', {hour12:false})],
    [I18N.t('common.camera'), ev.camera_id],
    (rj.plate || ev.plate_number)   ? ['ทะเบียน',  escapeHtml(rj.plate || ev.plate_number)] : null,
    (ev.lp_region   || rj.region)   ? ['จังหวัด',  escapeHtml(ev.lp_region || rj.region)] : null,
    (ev.lp_vehicle_type  || rj.vehicleType)  ? ['ชนิดรถ',
      escapeHtml(LPR_VTYPE[ev.lp_vehicle_type || rj.vehicleType] || ev.lp_vehicle_type || rj.vehicleType)] : null,
    (ev.lp_vehicle_color || rj.vehicleColor) ? [I18N.t('lpr.vehicleColor','สีรถ'),
      `${_lprDot(ev.lp_vehicle_color || rj.vehicleColor)}${escapeHtml(_lprCLabel(ev.lp_vehicle_color || rj.vehicleColor))}`] : null,
    (ev.lp_vehicle_brand || rj.vehicleBrand) ? ['ยี่ห้อ', escapeHtml((typeof _lprBrandLabel==='function' ? _lprBrandLabel(ev.lp_vehicle_brand || rj.vehicleBrand) : (ev.lp_vehicle_brand || rj.vehicleBrand)))] : null,
    rj.plateColor ? [I18N.t('lpr.plateColor','สีป้าย'),
      `${_lprDot(rj.plateColor)}${escapeHtml(_lprCLabel(rj.plateColor))}`] : null,
    rj.confidence ? ['Confidence', `${rj.confidence}%`] : null,
    rj.direction  ? [I18N.t('snap.direction','ทิศทาง'), _lprDirLabel(rj.direction)] : null,
    rj.laneNo     ? [I18N.t('lpr.lane','Lane'), escapeHtml(rj.laneNo)] : null,
  ].filter(Boolean) : [
    [I18N.t('evt.colTime'), time.toLocaleString('th-TH', {hour12:false})],
    [I18N.t('common.camera'), ev.camera_id],
    ev.rule_name    ? ['Rule', escapeHtml(ev.rule_name)] : null,
    [I18N.t('snap.type'), (typeof eventTypeLabel === 'function' ? eventTypeLabel(ev.event_type) : ev.event_type)],
    ev.object_class ? ['Class', ev.object_class] : null,
    (isFaceMatch || ev.likelihood)  ? ['Confidence', isFaceMatch
      ? (rj.similarity != null ? `${(rj.similarity*100).toFixed(1)}%` : '—')
      : `${(ev.likelihood*100).toFixed(1)}%`] : null,
    isFaceMatch ? [I18N.t('fmatch.person'),
      rj.personName ? escapeHtml(rj.personName) : I18N.t('fmatch.noMatch')] : null,
    isFaceMatch && rj.listType ? [I18N.t('fmatch.listType'),
      rj.listType === 'blackList'
        ? `<span style="color:var(--status-bad)">${escapeHtml(rj.fdLibName || I18N.t('fmatch.blackList'))}</span>`
        : `<span style="color:var(--status-ok)">${escapeHtml(rj.fdLibName || I18N.t('fmatch.whiteList'))}</span>`] : null,
    ev.speed        ? [I18N.t('snap.speed'), `${ev.speed} m/s`] : null,
    rj.direction    ? [I18N.t('snap.direction'),
      ['enter','leave'].includes(String(rj.direction).toLowerCase())
        ? I18N.t('dir.' + String(rj.direction).toLowerCase())
        : escapeHtml(String(rj.direction))] : null,
    ev.snapshot_source ? ['Source', ev.snapshot_source] : null,
  ].filter(Boolean);

  // Phase 2 — "view full" opens the full-resolution image in a new tab
  // (capped per-camera by full_view_width; native original otherwise).
  // When _snapshot_full (HTTP full-scene) exists, open that instead of the body crop.
  let viewFullBtn = '';
  if (ev.snapshot_file) {
    const cap = camFullViewWidth(ev.camera_id);
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
    ${clipBlock(ev)}
    <div id="snapFieldsGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px">
      ${fields.map(([k, v]) => `<div style="${_FIELD_TILE}"><div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em">${k}</div><div style="font-size:13px;margin-top:3px;color:var(--text-primary)">${v}</div></div>`).join('')}
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
        cell.style.cssText = _FIELD_TILE;
        cell.innerHTML = `<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em">${escapeHtml(I18N.t('snap.dwell'))}</div><div style="font-size:13px;margin-top:3px;color:var(--text-primary)">${escapeHtml(val)}</div>`;
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
// Shared color-name → hex map. Defined here (alongside _APP_COLOR) so both
// page-appearance.js and page-face-matches.js can access it without cross-file
// const-scope issues (const at top-level is not a window property).
var _COLOR_HEX = {
  Black:'#444', White:'#eee', Gray:'#888', Silver:'#bbb', Blue:'#3b7fe0',
  Red:'#e03b3b', Green:'#3be06a', Yellow:'#e0d43b', Orange:'#e07a3b',
  Purple:'#7a3be0', Pink:'#e03bba', Brown:'#8b5c2a', Beige:'#d4c49a',
  Magenta:'#e03be0', Blonde:'#b88b50', Auburn:'#b43214',
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
  Mixture: { th: 'หลากสี',        en: 'Mixture' },
  Unknown: { th: 'ไม่ทราบ',       en: 'Unknown' },
};
const _APP_TOP    = {
  ShortSleeve: { th: 'แขนสั้น', en: 'Short Sleeve' }, LongSleeve: { th: 'แขนยาว', en: 'Long Sleeve' },
  Sleeveless:  { th: 'กล้าม', en: 'Sleeveless' },     Jacket:     { th: 'แจ็คเก็ต', en: 'Jacket' },
  Coat:        { th: 'โค้ต', en: 'Coat' },             Vest:       { th: 'เสื้อกั๊ก', en: 'Vest' },
  Unknown:     { th: 'ไม่ทราบ', en: 'Unknown' },
};
const _APP_BOT    = {
  Trousers:     { th: 'กางเกงขายาว', en: 'Trousers' }, Shorts: { th: 'กางเกงขาสั้น', en: 'Shorts' },
  Skirt:        { th: 'กระโปรง', en: 'Skirt' },        Dress:  { th: 'ชุดเดรส', en: 'Dress' },
  LongTrousers: { th: 'กางเกงขายาว', en: 'Trousers' }, // Hikvision alias → merge with Trousers
  Unknown:      { th: 'ไม่ทราบ', en: 'Unknown' },
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

// Render a color dot from a CSS background value (hex or gradient).
// Used by Hikvision paths that have named colors but no XYZ camera data.
function _colorChipBg(bg) {
  if (!bg) return '';
  return `<span style="display:inline-block;width:10px;height:10px;background:${bg};border-radius:2px;border:1px solid var(--border-hairline);vertical-align:middle;margin-right:4px"></span>`;
}

// Resolve a named color to a CSS background: hex from _COLOR_HEX, or rainbow for Mixture.
function _colorBgByName(name) {
  if (!name) return null;
  if (name.toLowerCase() === 'mixture')
    return 'linear-gradient(to right,#e03b3b,#e07a3b,#e0d43b,#3be06a,#3b7fe0,#7a3be0,#e03bba)';
  return _COLOR_HEX[name] || null;
}

// Build appearance chips array — shared by modal section and search cards.
// ap may include upper_color/lower_color (named, from lazy-fetch endpoint).
function _buildAppChips(ap) {
  const chips = [];
  const colorLabel = name => name ? (_appLabel(_APP_COLOR, name) || escapeHtml(name)) : '';
  // Prefer XYZ-based dot (BOSCH); fall back to named-color hex (Hikvision)
  const colorDot = (xyz, name) => _colorChip(xyz) || _colorChipBg(_colorBgByName(name));
  if (ap.gender)          chips.push([I18N.t('snap.appGender'), _appLabel(_APP_GENDER, ap.gender)]);
  if (ap.top_category) {
    const colorPart = ap.upper_color ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(ap.upper_color)}</span>` : '';
    chips.push([I18N.t('snap.appTop'), `${colorDot(ap.top_color_xyz, ap.upper_color)}${_appLabel(_APP_TOP, ap.top_category)}${colorPart}`]);
  }
  if (ap.bottom_category) {
    const colorPart = ap.lower_color ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(ap.lower_color)}</span>` : '';
    chips.push([I18N.t('snap.appBottom'), `${colorDot(ap.bottom_color_xyz, ap.lower_color)}${_appLabel(_APP_BOT, ap.bottom_category)}${colorPart}`]);
  }
  if (ap.hair_length) {
    const hairColorPart = ap.hair_color ? ` <span style="color:var(--text-secondary);font-size:10px">${colorLabel(ap.hair_color)}</span>` : '';
    chips.push([I18N.t('snap.appHair'), `${colorDot(ap.hair_color_xyz, ap.hair_color)}${_appLabel(_APP_HAIR, ap.hair_length)}${hairColorPart}`]);
  }
  if (ap.glasses) {
    const rawG = ap.raw_json?.glass;
    chips.push([rawG === 'sunglasses' ? I18N.t('face.wearSunglasses') : I18N.t('snap.appGlasses'), '']);
  }
  if (ap.bag_category)    chips.push([I18N.t('snap.appBag'),     _appLabel(_APP_BAG, ap.bag_category)]);
  if (ap.helmet_wear)     chips.push([I18N.t('snap.appHelmet'),  ap.helmet_subtype ? escapeHtml(ap.helmet_subtype) : '']);
  if (ap.mask === 'yes')  chips.push([I18N.t('app.filterMask'), '']);
  if (ap.hat === 'yes')   chips.push([I18N.t('app.filterHatGeneric'), '']);
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

// ============================================================
// Synthetic face avatar generator — PDPA-safe reconstruction from metadata
// Used when the snapshot FILE is deleted but raw_json metadata remains.
// Mirrors demo face-demo.js avatar() (FP3 — decision #173, GOTCHAS #95).
// ============================================================
function _faceAvatarParts(o) {
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  const seed = (parseInt(o.id, 10) || 0);
  const female = o.gender === 'female';
  const skins = ['#e8b48c','#d99a6c','#c8845a','#a9683f','#8a5230'];
  const hairs = ['#2b2620','#4a3526','#6b4a2e','#1a1a1a','#5a5550'];
  const skin = skins[seed % skins.length];
  const hairHex = (o.hair_color && typeof _colorBgByName === 'function' && _colorBgByName(cap(o.hair_color)));
  const hair = (typeof hairHex === 'string' && hairHex.charAt(0) === '#') ? hairHex : hairs[(seed * 3) % hairs.length];
  const long = o.hair_length === 'Long' || o.hair_style === 'long', bald = o.hair_length === 'Bald';
  const hairPath = bald ? '' : ((female || long)
    ? `<path d="M22 38 Q22 16 40 16 Q58 16 58 38 L58 52 Q60 30 40 28 Q20 30 22 52 Z" fill="${hair}"/>`
    : `<path d="M24 36 Q24 18 40 18 Q56 18 56 36 L56 40 Q52 28 40 28 Q28 28 24 40 Z" fill="${hair}"/>`);
  const glasses = (o.glass === 'yes' || o.glass === 'sunglasses')
    ? (o.glass === 'sunglasses'
        ? `<g><rect x="27" y="40" width="11" height="8" rx="2" fill="#111"/><rect x="42" y="40" width="11" height="8" rx="2" fill="#111"/><line x1="38" y1="43" x2="42" y2="43" stroke="#111" stroke-width="2"/></g>`
        : `<g fill="none" stroke="#2a2a2a" stroke-width="1.5"><circle cx="32.5" cy="44" r="5.5"/><circle cx="47.5" cy="44" r="5.5"/><line x1="38" y1="44" x2="42" y2="44"/></g>`)
    : '';
  const mask = o.mask === 'yes' ? `<path d="M28 48 Q40 46 52 48 L50 60 Q40 66 30 60 Z" fill="#cfd6e0"/>` : '';
  const hat = o.hat === 'yes' ? `<path d="M22 30 Q40 12 58 30 L58 33 Q40 26 22 33 Z" fill="#3a4254"/>` : '';
  return { skin, female,
    head: `<ellipse cx="40" cy="48" rx="17" ry="20" fill="${skin}"/>${hairPath}${hat}<circle cx="33" cy="48" r="1.6" fill="#1c1c1c"/><circle cx="47" cy="48" r="1.6" fill="#1c1c1c"/>${glasses}${mask}` };
}

function _faceAvatar(o, mode) {
  o = o || {}; mode = mode || 'face';
  const P = _faceAvatarParts(o); const bg = P.female ? '#241a22' : '#161b29';
  if (mode === 'scene') {
    return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
      <rect width="160" height="100" fill="${bg}"/><rect y="72" width="160" height="28" fill="rgba(255,255,255,.03)"/>
      <line x1="0" y1="72" x2="160" y2="72" stroke="rgba(255,255,255,.07)"/>
      <g transform="translate(40,2)"><ellipse cx="40" cy="86" rx="26" ry="16" fill="#2a3142"/>${P.head}</g></svg>`;
  }
  return `<svg viewBox="15 27 50 46" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
    <rect x="-10" y="-10" width="120" height="140" fill="${bg}"/><ellipse cx="40" cy="88" rx="30" ry="20" fill="#2a3142"/>${P.head}</svg>`;
}

// Image box: real img (data-err=face-swap) + hidden avatar sibling that reveals on 404.
// h = box height; mode = 'face'|'scene'. obj carries metadata for avatar generation.
// Optional id param for overlay attach (e.g., faceModalFullImg for attachSnapOverlay).
// mode 'face' (crop) → 1:1 square, cover · mode 'scene' (full frame) → 16:9, contain
// (letterboxed CCTV). aspect-ratio keeps both modal columns visually balanced.
function _faceImgBox(file, mode, obj, id) {
  const av = (typeof _faceAvatar === 'function') ? _faceAvatar(obj, mode) : '';
  const reconTag = `<span style="position:absolute;left:0;right:0;bottom:0;background:rgba(245,158,11,.92);color:#1a1206;font-size:9px;font-weight:700;text-align:center;padding:2px 0">${escapeHtml(I18N.t('fmatch.reconTag','ภาพจริงถูกลบ · สร้างจาก metadata'))}</span>`;
  const idAttr = id ? `id="${id}"` : '';
  const aspect = mode === 'scene' ? '16 / 9' : '1 / 1';
  const fit    = mode === 'scene' ? 'contain' : 'cover';
  // Scene = the big 16:9 full frame → serve a w=960 thumbnail (~120KB vs ~600KB
  // full); aspect ratio is preserved so attachSnapOverlay's bbox stays aligned.
  // Face crop stays full-res (biometric detail; the crop is already small).
  const src = `${API}/snapshots/${encodeURIComponent(file)}${mode === 'scene' ? '?w=960' : ''}`;
  // Scene shows a thumbnail → give a magnifier to open the full-res frame in a
  // new tab (data-action openUrl). Only on scene; the face crop is already full.
  const fullUrl = `${API}/snapshots/${encodeURIComponent(file)}`;
  const zoomBtn = mode === 'scene'
    ? `<button type="button" data-action="openUrl" data-url="${fullUrl}" title="${escapeHtml(I18N.t('snap.viewFull','ดูรูปเต็ม'))}" style="position:absolute;top:8px;right:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);border:none;border-radius:6px;color:#fff;cursor:pointer;z-index:2"><svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg></button>`
    : '';
  return `<div style="position:relative;width:100%;aspect-ratio:${aspect};border-radius:8px;overflow:hidden;background:#000">
    <img ${idAttr} src="${src}" loading="lazy" decoding="async" data-err="face-swap" style="width:100%;height:100%;object-fit:${fit};display:block" alt="">
    <div style="display:none;position:absolute;inset:0;border:1px dashed var(--warn);border-radius:8px">${av}${reconTag}</div>
    ${zoomBtn}
  </div>`;
}

// Embedded pre-alarm clip block — shared across every detail modal (Face Rec,
// FaceCapture, Person Data, Snapshot) so any event with a completed clip shows
// the same inline player. Returns '' when there's no done clip (camera without
// media recording → nothing renders). Styling reuses .fm-section-label/.fm-scene.
function clipBlock(obj) {
  if (!obj || !obj.clip_file || obj.clip_status !== 'done') return '';
  const dur = obj.clip_duration_sec ? ` · ${parseFloat(obj.clip_duration_sec).toFixed(1)}s` : '';
  return `<div class="fm-section-label">${escapeHtml(I18N.t('fmatch.clipLabel','วิดีโอเหตุการณ์ (Pre-alarm)'))}${dur}</div>
    <div class="fm-scene"><span class="fm-scene-inner"><video class="fm-video" src="${API}/media/${encodeURIComponent(obj.clip_file)}" controls preload="metadata"></video></span></div>`;
}

function closeSnapModal() { document.getElementById('snapModal').classList.add('hidden'); }

// Burst-grouping expand (2026-07-15) — ev is the representative (first) row
// of a burst card; ev.burst_first_time/burst_last_time bound the collapsed
// range. Reuses the plain GET /api/events filters (camera+type+from/to) —
// no dedicated burst-members endpoint needed since every member is already
// a normal queryable event row.
let _burstMembers = [];
async function expandBurst(ev) {
  if (!ev || !ev.burst_count || ev.burst_count <= 1) return;
  const modal = document.getElementById('burstModal');
  const body = document.getElementById('burstModalBody');
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  modal.classList.remove('hidden');
  try {
    const params = new URLSearchParams({
      camera: ev.camera_id,
      type: ev.event_type,
      from: ev.burst_first_time,
      to: ev.burst_last_time,
      limit: String(ev.burst_count),
    });
    const res = await fetch(`${API}/api/events?${params.toString()}`, { cache: 'no-store' });
    _burstMembers = await res.json();
  } catch (e) {
    console.error(e);
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--status-bad)">${escapeHtml(I18N.t('common.loadFailedShort'))}</div>`;
    return;
  }
  body.innerHTML = `<div class="snap-grid">${_burstMembers.map((m, idx) => {
    const time = new Date(m.event_time);
    return m.snapshot_file ? `
      <div class="snap-item" style="position:relative" data-action="showBurstMember" data-idx="${idx}">
        <img src="${API}/snapshots/${encodeURIComponent(m.snapshot_file)}?w=400" loading="lazy" data-err="dim">
        <div class="snap-item-info">
          <div style="color:var(--text-secondary);font-size:9px">${time.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
        </div>
      </div>` : '';
  }).join('')}</div>`;
}

function closeBurstModal() { document.getElementById('burstModal').classList.add('hidden'); }
