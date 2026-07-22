// ============================================================
// Vigil Platform — Appearance Search Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// ============================================================
// Appearance Search Page (IVA Pro Forensic Search)
// ============================================================

let _appPage = 1, _appTotal = 0;
let _appFromPicker = null, _appToPicker = null;
let _appRange = 'today';

// Site filter — own state (not shared with Events/Snapshot/Media), since
// this page's endpoints (/api/appearances/*) are separate from /api/events.
let _appActiveSiteId = null;

function renderAppSitePills() {
  renderSitePills('appSitePills', _appActiveSiteId, 'setAppActiveSite');
}

function setAppActiveSite(sid) {
  _appActiveSiteId = sid ? Number(sid) : null;
  renderAppSitePills();
  _initAppCamDropdown();     // rescope the camera picker to the new site
  loadAppearanceSearch(1);   // also refreshes the Overview stats (page===1 side effect)
}

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

function _initAppCamDropdown() {
  const sel = document.getElementById('appFilterCam');
  if (!sel) return;
  const cur = sel.value;
  // Scope the dropdown to the active site (a camera from another site must not
  // appear). fillCameraSelect rebuilds; restore the prior value if it survives
  // the new site (a site change drops it → falls back to "ทั้งหมด").
  fillCameraSelect('appFilterCam', siteScopedCams(cameras, _appActiveSiteId), { allOption: true });
  sel.value = cur;
}

// อ่านค่าฟอร์ม filter เป็น URLSearchParams — ใช้ร่วมระหว่าง search กับ
// timeline (AP.5a) ให้เงื่อนไขสองโหมดตรงกันเสมอ
function _appFilterParams() {
  const params = new URLSearchParams();
  const v = id => document.getElementById(id)?.value || '';
  if (v('appFilterCam'))         params.set('camera_id',      v('appFilterCam'));
  else if (_appActiveSiteId) {
    const ids = cameras.filter(c => c.site_id === _appActiveSiteId).map(c => c.camera_id);
    params.set('cameras', ids.length ? ids.join(',') : '__none__');
  }
  if (v('appFilterGender'))      params.set('gender',          v('appFilterGender'));
  if (v('appFilterTop'))         params.set('top',             v('appFilterTop'));
  if (v('appFilterTopColor'))    params.set('upper_color',     v('appFilterTopColor'));
  if (v('appFilterBottom'))      params.set('bottom',          v('appFilterBottom'));
  if (v('appFilterBottomColor')) params.set('lower_color',     v('appFilterBottomColor'));
  if (v('appFilterHair'))        params.set('hair',            v('appFilterHair'));
  if (v('appFilterHairColor'))   params.set('hair_color',      v('appFilterHairColor'));
  if (v('appFilterGlasses'))     params.set('glasses',         v('appFilterGlasses'));
  if (v('appFilterHelmet'))      params.set('helmet',          v('appFilterHelmet'));
  if (v('appFilterMask'))        params.set('mask',            v('appFilterMask'));
  if (v('appFilterHat'))         params.set('hat',              v('appFilterHat'));
  if (v('appFilterExpression'))  params.set('expression',      v('appFilterExpression'));
  if (v('appFilterAgeGroup'))    params.set('age_group',       v('appFilterAgeGroup'));
  if (v('appFilterBag'))         params.set('bag',             v('appFilterBag'));
  if (v('appFilterMinConf'))     params.set('min_confidence',  v('appFilterMinConf'));
  // Read dates from Air Datepicker instances (selectedDates = local Date objects)
  // → .toISOString() converts local→UTC correctly (Advisor: do NOT read el.value)
  const fromDate = _appFromPicker?.selectedDates[0];
  const toDate   = _appToPicker?.selectedDates[0];
  if (fromDate) params.set('from', fromDate.toISOString());
  if (toDate)   params.set('to',   toDate.toISOString());
  return params;
}

async function loadAppearanceSearch(page = 1) {
  _appPage = page;
  const params = _appFilterParams();
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

// ── AP.5a — Forensic Timeline ────────────────────────────────
// filter ชุดเดียวกับ search แต่แสดงเป็นเส้นเวลา: segment ละ "กล้อง X
// ช่วง HH:MM–HH:MM (N ครั้ง)". attribute matching ไม่ใช่ระบุตัวตน —
// disclaimer บังคับแสดง. คลิก segment เปิด snapshot ของแถวแรก (reuse
// _appRows + data-action showSnapshot เดิม)
async function loadAppearanceTimeline() {
  const params = _appFilterParams();
  const container = document.getElementById('appResults');
  if (container) container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${I18N.t('common.loading')}</div>`;
  document.getElementById('appPagination').innerHTML = '';
  try {
    const r = await fetch(`${API}/api/appearances/timeline?${params}`);
    if (r.status === 403) {
      container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--warn)">${escapeHtml(I18N.t('app.tlRoleRequired'))}</div>`;
      return;
    }
    if (!r.ok) throw new Error(r.statusText);
    const body = await r.json();
    _renderAppearanceTimeline(body);
    document.getElementById('appCount').textContent = (body.segments || []).length;
  } catch (e) {
    if (container) container.innerHTML = `<div style="padding:20px;color:var(--status-bad)">${escapeHtml(e.message)}</div>`;
  }
}

function _renderAppearanceTimeline(body, headerHtml = '') {
  const container = document.getElementById('appResults');
  if (!container) return;
  const segs = body.segments || [];
  // showSnapshot เดิมอ่าน window._appRows[idx] — ใช้แถวแรกของแต่ละ segment
  window._appRows = segs.map(s => s.first_row);
  if (!segs.length) {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-secondary)">${I18N.t('app.noResults')}</div>`;
    return;
  }
  const fmtT = iso => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtD = iso => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  let lastDay = '';
  const items = segs.map((s, idx) => {
    const day = fmtD(s.start_time);
    const dayHdr = day !== lastDay
      ? `<div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin:14px 0 6px 26px">${escapeHtml(day)}</div>`
      : '';
    lastDay = day;
    const range = s.start_time === s.end_time
      ? fmtT(s.start_time)
      : `${fmtT(s.start_time)} – ${fmtT(s.end_time)}`;
    const thumb = s.first_row?.snapshot_file
      ? `<img src="${API}/snapshots/${escapeHtml(s.first_row.snapshot_file)}?w=160" style="width:84px;height:56px;object-fit:cover;border-radius:4px;background:var(--surface-base);flex-shrink:0" loading="lazy">`
      : '';
    const chips = s.first_row ? _renderAppearanceChips(s.first_row) : '';
    return `${dayHdr}
      <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0 8px 26px;position:relative;cursor:pointer"
           data-action="showSnapshot" data-source="app" data-idx="${idx}">
        <span style="position:absolute;left:7px;top:14px;width:9px;height:9px;border-radius:50%;background:var(--accent);border:2px solid var(--surface-elevated)"></span>
        ${thumb}
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:600">${escapeHtml(range)}
            <span style="font-weight:400;color:var(--text-secondary)">· ${escapeHtml(I18N.t('app.tlTimes').replace('{n}', s.count))}</span>
            ${s.best_score != null ? `<span style="font-weight:600;color:var(--accent)"> · ~${Math.round(s.best_score * 100)}%</span>` : ''}</div>
          <div style="font-size:12px;margin:2px 0">${escapeHtml(s.camera_name)}${s.location ? ` <span style="color:var(--text-secondary)">· ${escapeHtml(s.location)}</span>` : ''}</div>
          ${chips}
          ${s.first_row?.id ? `<button class="btn btn-secondary" style="font-size:10px;padding:2px 8px;margin-top:4px" data-action="appFollow" data-event-id="${s.first_row.id}">${escapeHtml(I18N.t('app.followBtn'))}</button>` : ''}
        </div>
      </div>`;
  }).join('');
  window._appTlSegments = segs;
  container.innerHTML = `
    ${headerHtml}
    <div style="font-size:11px;color:var(--warn);margin-bottom:8px">${escapeHtml(I18N.t('app.tlDisclaimer'))}</div>
    ${body.truncated ? `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">${escapeHtml(I18N.t('app.tlTruncated'))}</div>` : ''}
    <div style="margin-bottom:10px"><button class="btn btn-secondary" id="appTlRouteBtn" style="font-size:11px">${escapeHtml(I18N.t('app.tlRouteBtn'))}</button></div>
    <div style="position:relative;border-left:2px solid var(--border-hairline);margin-left:11px">${items}</div>`;
  document.getElementById('appTlRouteBtn')?.addEventListener('click', showTimelineRouteOnMap);
}

// ── AP.5b — "ตามคนนี้" (attribute similarity timeline) ──────────
// จาก appearance ของ event หนึ่ง → ดึง segments ที่ลักษณะคล้าย (threshold
// ฝั่ง server) มาแสดงด้วย renderer เดิมของ timeline + header anchor
// เกณฑ์ความคล้ายที่ผู้ใช้เลือก — จำไว้ตลอด session (follow คนถัดไปใช้ค่าเดิม)
let _appFollowThreshold = 0.6;
let _appFollowAnchorId = null;

async function loadSimilarTimeline(eventId, threshold) {
  if (!Number.isFinite(eventId)) return;
  if (Number.isFinite(threshold)) _appFollowThreshold = threshold;
  _appFollowAnchorId = eventId;
  const thr = _appFollowThreshold;
  const container = document.getElementById('appResults');
  if (container) container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${I18N.t('common.loading')}</div>`;
  document.getElementById('appPagination').innerHTML = '';
  try {
    const r = await fetch(`${API}/api/appearances/similar-timeline?event_id=${eventId}&threshold=${thr}`);
    if (r.status === 403) {
      container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--warn)">${escapeHtml(I18N.t('app.tlRoleRequired'))}</div>`;
      return;
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const body = await r.json();
    const a = body.anchor || {};
    const bits = [a.upper_color, a.lower_color, a.overall_color].filter(Boolean).join('/');
    // dropdown ปรับเกณฑ์ — เปลี่ยนแล้ว re-run ด้วย anchor เดิมทันที
    const thrOptions = [
      [0.5, I18N.t('app.thrWide')], [0.6, I18N.t('app.thrDefault')],
      [0.7, ''], [0.8, I18N.t('app.thrStrict')],
    ].map(([v, hint]) =>
      `<option value="${v}" ${Math.abs(v - thr) < 0.001 ? 'selected' : ''}>≥ ${Math.round(v * 100)}%${hint ? ` (${escapeHtml(hint)})` : ''}</option>`
    ).join('');
    const header = `<div style="font-size:12px;margin-bottom:8px;padding:8px 10px;background:var(--surface-overlay);border-radius:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span>${escapeHtml(I18N.t('app.followHdr'))}: <strong>#${escapeHtml(String(a.event_id))}</strong>
      · ${escapeHtml(a.camera_id || '')} ${bits ? '· ' + escapeHtml(bits) : ''}</span>
      <label style="display:flex;align-items:center;gap:4px">${escapeHtml(I18N.t('app.followThrLbl'))}
        <select id="appFollowThr" class="form-input" style="width:auto;font-size:11px;padding:2px 6px">${thrOptions}</select>
      </label></div>`;
    _renderAppearanceTimeline(body, header);
    document.getElementById('appFollowThr')?.addEventListener('change', (e) =>
      loadSimilarTimeline(_appFollowAnchorId, parseFloat(e.target.value)));
    document.getElementById('appCount').textContent = (body.segments || []).length;
  } catch (e) {
    if (container) container.innerHTML = `<div style="padding:20px;color:var(--status-bad)">${escapeHtml(e.message)}</div>`;
  }
}

// ── AP.5c — เส้นทางบนแผนที่จาก timeline segments ────────────────
// แปลง segment → พิกัดกล้อง (รวมช่วงที่อยู่กล้องเดิมติดกัน) → polyline
// เส้นประ + จุดเรียงหมายเลขพร้อมช่วงเวลา บน layer แยกของหน้า Map
function showTimelineRouteOnMap() {
  const segs = window._appTlSegments || [];
  const pts = [];
  let skipped = 0;
  for (const s of segs) {
    const cam = cameras.find(c => c.camera_id === s.camera_id);
    const lat = parseFloat(cam?.latitude), lon = parseFloat(cam?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { skipped++; continue; }
    const last = pts[pts.length - 1];
    if (last && last.camera_id === s.camera_id) {   // อยู่กล้องเดิมต่อเนื่อง — ยุบเป็นจุดเดียว
      last.end_time = s.end_time;
      last.count += s.count;
      continue;
    }
    pts.push({ camera_id: s.camera_id, name: s.camera_name, lonlat: [lon, lat],
               start_time: s.start_time, end_time: s.end_time, count: s.count });
  }
  if (!pts.length) { alert(I18N.t('app.tlNoCoords')); return; }
  showPage('map', document.querySelector('.nav-item[data-page="map"]'));
  // รอ initMap/updateSize ใน showPage (setTimeout 50) ทำงานก่อนค่อยวาด
  setTimeout(() => _drawTimelineRoute(pts, skipped), 350);
}

function _drawTimelineRoute(pts, skipped) {
  if (!map) return;
  if (!mapLayers.routeSrc) {
    mapLayers.routeSrc = new ol.source.Vector();
    mapLayers.route = new ol.layer.Vector({ source: mapLayers.routeSrc, zIndex: 60 });
    map.addLayer(mapLayers.route);
  }
  const src = mapLayers.routeSrc;
  src.clear();
  const coords = pts.map(p => ol.proj.fromLonLat(p.lonlat));
  if (coords.length >= 2) {
    const line = new ol.Feature(new ol.geom.LineString(coords));
    line.setStyle(new ol.style.Style({
      stroke: new ol.style.Stroke({ color: token('--accent'), width: 3, lineDash: [8, 6] }),
    }));
    src.addFeature(line);
  }
  const fmtT = iso => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  pts.forEach((p, i) => {
    const f = new ol.Feature(new ol.geom.Point(coords[i]));
    const range = p.start_time === p.end_time ? fmtT(p.start_time) : `${fmtT(p.start_time)}–${fmtT(p.end_time)}`;
    f.setStyle([
      new ol.style.Style({
        image: new ol.style.Circle({
          radius: 11,
          fill: new ol.style.Fill({ color: token('--accent') }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
        }),
        text: new ol.style.Text({
          text: String(i + 1),
          fill: new ol.style.Fill({ color: '#fff' }),
          font: 'bold 12px sans-serif',
        }),
      }),
      new ol.style.Style({
        text: new ol.style.Text({
          text: range, offsetY: 24,
          fill: new ol.style.Fill({ color: '#fff' }),
          stroke: new ol.style.Stroke({ color: '#0a0e1a', width: 3 }),
          font: 'bold 11px sans-serif',
        }),
      }),
    ]);
    src.addFeature(f);
  });
  map.getView().fit(src.getExtent(), { padding: [70, 70, 70, 70], maxZoom: 19, duration: 400 });
  const btn = document.getElementById('btnClearRoute');
  if (btn) {
    btn.style.display = '';
    btn.textContent = I18N.t('map.clearRoute').replace('{n}', pts.length)
      + (skipped ? ` (${I18N.t('map.routeSkipped').replace('{n}', skipped)})` : '');
  }
}

function clearTimelineRoute() {
  mapLayers.routeSrc?.clear();
  const btn = document.getElementById('btnClearRoute');
  if (btn) btn.style.display = 'none';
}

function _appCameraName(cameraId) {
  return cameras.find(c => c.camera_id === cameraId)?.camera_name || cameraId || '—';
}

function _appBodyAvatar(o) {
  o = o || {};
  const raw = o.raw_json || {};
  const seed = parseInt(o.id, 10) || 0;
  const female = String(o.gender || '').toLowerCase() === 'female';
  const skins = ['#e8b48c','#d99a6c','#c8845a','#a9683f','#8a5230'];
  const skin = skins[Math.abs(seed) % skins.length];
  const color = name => _colorBgByName(name) || 'var(--text-secondary)';
  const hair = color(o.hair_color || 'Black');
  const top = color(o.upper_color || o.overall_color || 'Gray');
  const bottom = color(o.lower_color || o.overall_color || 'Black');
  const longHair = o.hair_length === 'Long';
  const skirt = o.bottom_category === 'Skirt' || o.bottom_category === 'Dress';
  const glasses = o.glasses === true || raw.glass === 'yes' || raw.glass === 'sunglasses';
  const mask = raw.mask === 'yes';
  const hat = o.helmet_wear === true || raw.hat === 'yes';
  const hairPath = (female || longHair)
    ? `<path d="M27 22 Q40 8 53 22 L54 40 Q55 20 40 18 Q25 20 26 40 Z" fill="${hair}"/>`
    : `<path d="M28 21 Q40 11 52 21 L52 26 Q48 18 40 18 Q32 18 28 26 Z" fill="${hair}"/>`;
  const legs = skirt
    ? `<path d="M31 96 L49 96 L53 134 L27 134 Z" fill="${bottom}"/>`
    : `<rect x="31" y="96" width="8" height="44" rx="2" fill="${bottom}"/><rect x="41" y="96" width="8" height="44" rx="2" fill="${bottom}"/>`;
  return `<svg viewBox="0 0 80 150" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <rect width="80" height="150" fill="var(--surface-base)"/>${legs}
    <path d="M27 50 Q40 43 53 50 L57 98 L23 98 Z" fill="${top}"/>
    <path d="M27 52 L19 86 L24 89 L31 58 Z" fill="${top}"/><path d="M53 52 L61 86 L56 89 L49 58 Z" fill="${top}"/>
    <rect x="36" y="40" width="8" height="11" fill="${skin}"/><ellipse cx="40" cy="30" rx="12" ry="14" fill="${skin}"/>
    ${hairPath}${hat ? '<path d="M27 18 Q40 6 53 18 L53 21 Q40 14 27 21 Z" fill="#3a4254"/>' : ''}
    <circle cx="35.5" cy="30" r="1.3" fill="#1c1c1c"/><circle cx="44.5" cy="30" r="1.3" fill="#1c1c1c"/>
    ${glasses ? '<g stroke="currentColor" stroke-width="1.6" fill="none"><circle cx="35" cy="29" r="3.4"/><circle cx="45" cy="29" r="3.4"/><line x1="38.4" y1="29" x2="41.6" y2="29"/></g>' : ''}
    ${mask ? '<path d="M33 31 Q40 30 47 31 L46 37 Q40 41 34 37 Z" fill="#cfd6e0"/>' : ''}
  </svg>`;
}

function _appSwatchValue(name) {
  const bg = _colorBgByName(name) || 'var(--text-secondary)';
  return `<span class="app-mini-swatch" style="background:${bg}"></span>`;
}

function _appConfidenceText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n <= 1 ? `${Math.round(n * 100)}%` : n.toFixed(2).replace(/\.00$/, '');
}

function _appPersonValueRows(ev) {
  const raw = ev.raw_json || {};
  const lang = (I18N.getLang && I18N.getLang()) || 'th';
  const label = (map, value) => value ? ((map[value] && map[value][lang]) || value) : '—';
  const color = value => value ? `${_appSwatchValue(value)}${escapeHtml(label(_APP_COLOR, value))}` : '—';
  const rows = [
    [I18N.t('common.camera'), escapeHtml(_appCameraName(ev.camera_id))],
    [I18N.t('snap.appGender'), escapeHtml(label(_APP_GENDER, ev.gender))],
    [I18N.t('face.ageGroup'), escapeHtml(label(_APP_AGE_GROUP, ev.age_group || raw.ageGroup))],
    [I18N.t('snap.appTop'), `${escapeHtml(label(_APP_TOP, ev.top_category))} · ${color(ev.upper_color)}`],
    [I18N.t('snap.appBottom'), `${escapeHtml(label(_APP_BOT, ev.bottom_category))} · ${color(ev.lower_color)}`],
    [I18N.t('snap.appHair'), `${escapeHtml(label(_APP_HAIR, ev.hair_length))} · ${color(ev.hair_color)}`],
    [I18N.t('snap.appGlasses'), escapeHtml(ev.glasses === true ? I18N.t('body.yes') : I18N.t('body.no'))],
    [I18N.t('snap.appHelmet'), escapeHtml(ev.helmet_wear === true || raw.hat === 'yes' ? I18N.t('body.yes') : I18N.t('body.no'))],
    [I18N.t('app.filterMask'), escapeHtml((ev.mask || raw.mask) === 'yes' ? I18N.t('body.yes') : I18N.t('body.no'))],
    [I18N.t('app.filterHatGeneric'), escapeHtml((ev.hat || raw.hat) === 'yes' ? I18N.t('body.yes') : I18N.t('body.no'))],
    [I18N.t('snap.appBag'), escapeHtml(label(_APP_BAG, ev.bag_category))],
    [I18N.t('body.direction'), escapeHtml(label(_APP_DIR, ev.direction || ev.attributes?.direction))],
    [I18N.t('app.confidence'), _appConfidenceText(ev.confidence) || '—'],
  ];
  return rows.map(([k, v]) => `<div class="app-detail-row"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`).join('');
}

// Modal media — full HTTP scene as the main image (fills the frame) with the
// MQTT body-crop as a labelled inset, plus a download-full button. Cameras
// with only a crop (IVA) show that crop as the main image. The reconstructed
// avatar sits behind and surfaces if every image fails (PDPA-deleted).
function _appModalMedia(ev) {
  const raw = ev.raw_json || {};
  const full = raw._snapshot_full || ev.snapshot_full;
  const crop = ev.snapshot_file;
  const main = full || crop;
  const url = f => `${API}/snapshots/${f.split('/').map(encodeURIComponent).join('/')}`;
  const fallback = `<div class="app-recon">${_appBodyAvatar(ev)}<span>${escapeHtml(I18N.t('app.reconTag'))}</span></div>`;
  if (!main) return `<div class="app-detail-media">${fallback}</div>`;
  const inset = (full && crop && crop !== full)
    ? `<div class="app-media-inset"><img src="${url(crop)}" alt="" data-err="hide"><span>${escapeHtml(I18N.t('app.cropTag'))}</span></div>`
    : '';
  const dl = `<a class="app-media-dl" href="${url(main)}" download target="_blank" rel="noopener" title="${escapeHtml(I18N.t('app.downloadFull'))}" aria-label="${escapeHtml(I18N.t('app.downloadFull'))}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>`;
  return `<div class="app-detail-media">${fallback}<img src="${url(main)}" alt="" data-err="hide">${inset}${dl}</div>`;
}

function appOpenPerson(idx) {
  const ev = window._appRows?.[idx];
  if (!ev) return;
  _appCurrentPerson = ev;
  const modal = document.getElementById('appPersonModal');
  const body = document.getElementById('appPersonModalBody');
  const time = document.getElementById('appPersonModalTime');
  if (!modal || !body) return;
  if (time) time.textContent = new Date(ev.event_time).toLocaleString('th-TH', { hour12: false });
  // IVA cameras carry no garment attributes — surface the image colour tone
  // instead (the structured rows would all be "—").
  const tone = (!ev.top_category && !ev.bottom_category) ? _renderAppearanceSection(ev) : '';
  const clip = (typeof clipBlock === 'function') ? clipBlock(ev) : '';
  body.innerHTML = `<div class="app-detail-grid">${_appModalMedia(ev)}<div class="app-detail-data">${_appPersonValueRows(ev)}</div></div>${tone}${clip}`;
  modal.style.display = 'flex';
}

function appClosePerson() {
  const modal = document.getElementById('appPersonModal');
  if (modal) modal.style.display = 'none';
}

function appSearchByExample(idxOrEvent) {
  const ev = typeof idxOrEvent === 'number' ? window._appRows?.[idxOrEvent] : idxOrEvent;
  if (!ev) return;
  const values = {
    appFilterGender: ev.gender, appFilterTop: ev.top_category,
    appFilterBottom: ev.bottom_category, appFilterHair: ev.hair_length,
    appFilterAgeGroup: ev.age_group || ev.raw_json?.ageGroup,
    appFilterGlasses: ev.glasses === true ? 'yes' : ev.glasses === false ? 'no' : '',
    appFilterHelmet: ev.helmet_wear === true ? 'true' : ev.helmet_wear === false ? 'false' : '',
    appFilterBag: ev.bag_category || '',
  };
  Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value || ''; });
  _appSetColor('appFilterTopColor', ev.upper_color || '');
  _appSetColor('appFilterBottomColor', ev.lower_color || '');
  _appSetColor('appFilterHairColor', ev.hair_color || '');
  setAppTab('search', document.querySelector('#appTabBar .tab[data-tab="search"]'));
  appClosePerson();
  document.querySelector('#appTabSearch .app-filter-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  loadAppearanceSearch(1);
}

function appOpenFace(idxOrEvent) {
  const ev = typeof idxOrEvent === 'number' ? window._appRows?.[idxOrEvent] : idxOrEvent;
  if (!ev) return;
  appClosePerson();
  showPage('face-matches', document.querySelector('.nav-item[data-page="face-matches"]'));
  _switchFaceTab('search');
  _populateFaceFilter2Cameras();
  const cam = document.getElementById('faceFilterCamera2');
  if (cam) cam.value = ev.camera_id || '';
  const at = new Date(ev.event_time);
  if (!Number.isNaN(at.getTime())) {
    setDtValue('faceFilterFrom2', new Date(at.getTime() - 2 * 60_000));
    setDtValue('faceFilterTo2', new Date(at.getTime() + 2 * 60_000));
  }
  _loadFaceTab();
}

function _renderAppearanceResults(rows) {
  window._appRows = rows;
  const container = document.getElementById('appResults');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-secondary)">${I18N.t('app.noResults')}</div>`;
    return;
  }
  container.innerHTML = `<div class="app-person-wall">
    ${rows.map((ev, idx) => {
      const fallback = _appBodyAvatar(ev);
      const thumb = `<div class="app-person-thumb" data-action="appOpen" data-idx="${idx}">${fallback}${ev.snapshot_file
        ? `<img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=320" alt="" loading="lazy" decoding="async" data-err="hide">`
        : ''}${ev.confidence != null ? `<span class="app-person-conf">${escapeHtml(_appConfidenceText(ev.confidence))}</span>` : ''}</div>`;
      const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
      const chips = _renderAppearanceChips(ev);
      return `<div class="app-person-card">
        ${thumb}
        <div class="app-person-body">
          <div class="app-person-meta">${escapeHtml(time)} · ${escapeHtml(_appCameraName(ev.camera_id))}</div>
          ${chips}
          <div class="app-person-actions">
            <button class="btn btn-secondary" data-action="appFollow" data-event-id="${ev.id}">${escapeHtml(I18N.t('app.followBtn'))}</button>
            <button class="btn btn-secondary" data-action="appExample" data-idx="${idx}">${escapeHtml(I18N.t('app.exampleBtn'))}</button>
            <button class="btn btn-secondary" data-action="appFace" data-idx="${idx}">${escapeHtml(I18N.t('app.faceBtn'))}</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Appearance Stats Panel ────────────────────────────────────
let _appGenderChart = null, _appTopCatChart = null, _appVolChart = null;
let _appBotCatChart = null, _appHairLenChart = null;
let _appAgeGroupChart = null, _appExprChart = null, _appDirChart = null;
let _appPeakChart = null, _appCameraChart = null;
let _appCurrentPerson = null;

const _APP_AGE_GROUP = {
  // BOSCH values
  child:  { th: 'เด็ก',         en: 'Child'        },
  adult:  { th: 'ผู้ใหญ่',     en: 'Adult'        },
  senior: { th: 'สูงอายุ',     en: 'Senior'       },
  youth:  { th: 'วัยรุ่น',     en: 'Youth'        },
  // Hikvision values
  teen:       { th: 'วัยรุ่น',     en: 'Teen'         },
  young:      { th: 'วัยหนุ่มสาว', en: 'Young Adult'  },
  middle:     { th: 'วัยกลางคน',   en: 'Middle-aged'  },
  old:        { th: 'สูงอายุ',     en: 'Senior'       },
  prime:      { th: 'วัยทำงาน',    en: 'Prime'        },
  middleAged: { th: 'วัยกลางคน',   en: 'Middle-aged'  }, // Hikvision alias → merge with middle
  Unknown:    { th: 'ไม่ทราบ',     en: 'Unknown'      },
};
const _APP_EXPR = {
  happy:        { th: 'ยิ้มแย้ม',     en: 'Happy'       },
  smile:        { th: 'ยิ้ม',         en: 'Smiling'     },
  sad:          { th: 'เศร้า',        en: 'Sad'         },
  'poker-faced':{ th: 'หน้านิ่ง',    en: 'Poker-faced' },
  angry:        { th: 'โกรธ',         en: 'Angry'       },
  anger:        { th: 'โกรธ',         en: 'Angry'       },
  surprised:    { th: 'ประหลาดใจ',   en: 'Surprised'   },
  neutral:      { th: 'ปกติ',         en: 'Neutral'     },
  disgust:      { th: 'ไม่พอใจ',      en: 'Disgusted'   },
  disgusted:    { th: 'ไม่พอใจ',      en: 'Disgusted'   },
  confused:     { th: 'สับสน',        en: 'Confused'    },
  panic:        { th: 'ตื่นตกใจ',     en: 'Panic'       },
  Unknown:      { th: 'ไม่ทราบ',      en: 'Unknown'     },
};
const _APP_DIR = {
  leftward:  { th: 'ซ้าย',  en: 'Left'    },
  rightward: { th: 'ขวา',   en: 'Right'   },
  forward:   { th: 'หน้า',  en: 'Forward' },
  backward:  { th: 'หลัง',  en: 'Backward'},
};

// _COLOR_HEX defined in page-snapshots.js (shared, var-scoped for global access)

function _appSetColor(selectId, value) {
  const select = document.getElementById(selectId);
  if (select) select.value = value || '';
  const picker = select?.nextElementSibling;
  picker?.querySelectorAll('[data-color]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.color === (value || '')));
}

function _initAppColorPickers() {
  const configs = [
    ['appFilterTopColor', 'appTopColorPick'],
    ['appFilterBottomColor', 'appBottomColorPick'],
    ['appFilterHairColor', 'appHairColorPick'],
  ];
  configs.forEach(([selectId, pickerId]) => {
    const select = document.getElementById(selectId);
    const picker = document.getElementById(pickerId);
    if (!select || !picker || picker.childElementCount) return;
    picker.innerHTML = [...select.options].map(opt => {
      const name = opt.value;
      const bg = name ? (_colorBgByName(name) || 'var(--text-secondary)') : 'var(--surface-overlay)';
      const label = opt.textContent.trim();
      return `<button type="button" class="app-swatch${name ? '' : ' any'}${select.value === name ? ' active' : ''}"
        data-action="appColorPick" data-select-id="${selectId}" data-color="${escapeHtml(name)}"
        title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" style="background:${bg}">${name ? '' : escapeHtml(I18N.t('common.all'))}</button>`;
    }).join('');
  });
}

function appPickColor(selectId, value) {
  _appSetColor(selectId, value);
}

function toggleAppForensic() {
  const button = document.getElementById('appForensicToggle');
  const body = document.getElementById('appForensicBody');
  if (!button || !body) return;
  const open = !body.classList.contains('open');
  button.classList.toggle('open', open);
  body.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  if (open) {
    [_appTopCatChart, _appBotCatChart, _appHairLenChart, _appExprChart]
      .forEach(c => { try { c?.resize(); } catch {} });
  }
}

// Tab switch — display-toggle only (keeps Air Datepicker instances alive)
function setAppTab(tab, btn) {
  document.querySelectorAll('#page-appearance .tabs .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const ov = document.getElementById('appTabOverview');
  const se = document.getElementById('appTabSearch');
  if (ov) ov.style.display = tab === 'overview' ? '' : 'none';
  if (se) se.style.display = tab === 'search'   ? '' : 'none';
  if (tab === 'search') _initAppColorPickers();
  // Chart.js renders to 0-height inside a display:none container — resize on reveal
  if (tab === 'overview') {
    [_appGenderChart, _appTopCatChart, _appBotCatChart, _appHairLenChart, _appVolChart,
     _appAgeGroupChart, _appExprChart, _appDirChart, _appPeakChart, _appCameraChart]
      .forEach(c => { try { c?.resize(); } catch {} });
  }
}

async function _loadAppStats() {
  const statsCard = document.getElementById('appStatsCard');
  if (!statsCard) return;
  const params = new URLSearchParams();
  const v = id => document.getElementById(id)?.value || '';
  if (v('appFilterCam')) params.set('camera_id', v('appFilterCam'));
  else if (_appActiveSiteId) params.set('site_id', String(_appActiveSiteId));
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
    const swatchBg = _colorBgByName(name) || (_COLOR_HEX[name] || '#888');
    const displayName = (_APP_COLOR[name] && _APP_COLOR[name][lang]) || name;
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
      <span style="width:12px;height:12px;border-radius:2px;background:${swatchBg};flex-shrink:0;border:1px solid rgba(255,255,255,.30)"></span>
      <span style="width:60px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(displayName)}</span>
      <div style="flex:1;background:var(--surface-base);border-radius:3px;height:8px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${swatchBg};border-radius:3px;border:1px solid rgba(255,255,255,.20)"></div>
      </div>
      <span style="color:var(--text-secondary);min-width:28px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');
}

// Re-key a {value:count} object → {localisedLabel:count} via a label map.
// Sums counts when two raw keys translate to the same label (e.g. LongTrousers + Trousers → กางเกงขายาว).
function _appMapLabels(obj, map) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const label = _appLabel(map, k) || k;
    out[label] = (out[label] || 0) + v;
  }
  return out;
}

function _renderAppStatsCharts(d) {
  const accent = token('--accent'), warn = token('--warn'), ok = token('--status-ok');
  const textSec = token('--text-secondary'), gridColor = token('--border-hairline');
  const kpi = d.kpi || {};
  const known = kpi.gender_known || 0;
  const malePct = known ? Math.round((kpi.male || 0) / known * 100) : 0;
  const femalePct = known ? 100 - malePct : 0;
  const peakPoints = d.peak?.points || [];
  const peakLabel = bucket => {
    if (d.peak?.mode === 'hour') return `${String(bucket).padStart(2, '0')}:00`;
    if (d.peak?.mode === 'dow') return I18N.t(`app.dow${bucket}`);
    return I18N.t('app.dayOfMonth').replace('{n}', bucket);
  };
  const peakMax = peakPoints.reduce((best, point) => !best || point.n > best.n ? point : best, null);
  const topCamera = kpi.top_camera;
  const kpiEl = document.getElementById('appKpiGrid');
  if (kpiEl) {
    const items = [
      [accent, I18N.t('app.kpiDetected'), Number(kpi.total || 0).toLocaleString(), I18N.t('app.kpiDetectedSub'), '<circle cx="9" cy="7" r="3"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M16 7a3 3 0 0 1 0 6M21 19c0-2.4-1.6-4.2-4-4.8"/>'],
      [warn, I18N.t('app.kpiPeak'), peakMax ? peakLabel(peakMax.bucket) : '—', peakMax ? I18N.t('app.kpiPeakSub').replace('{n}', peakMax.n) : I18N.t('app.noResults'), '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
      [accent, I18N.t('app.kpiTopCamera'), topCamera?.camera_name || '—', topCamera ? I18N.t('app.kpiPeople').replace('{n}', topCamera.n) : I18N.t('app.noResults'), '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'],
      [ok, I18N.t('app.kpiGender'), known ? `${malePct} / ${femalePct}%` : '—', I18N.t('app.kpiGenderSub').replace('{m}', kpi.male || 0).replace('{f}', kpi.female || 0), '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="3"/><path d="M3 19c0-3 2.7-5 6-5"/>'],
    ];
    kpiEl.innerHTML = items.map(([color, label, value, sub, icon]) => `<div class="kpi" style="--ka:${color}">
      <div class="ki" style="color:${color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div>
      <div class="kl">${escapeHtml(label)}</div><div class="kv">${escapeHtml(String(value))}</div><div class="ks">${escapeHtml(sub)}</div>
    </div>`).join('');
  }

  // Gender donut
  const gCtx = document.getElementById('appGenderChart')?.getContext('2d');
  if (gCtx) {
    if (_appGenderChart) _appGenderChart.destroy();
    const gLabels = Object.keys(d.gender).map(k => _appLabel(_APP_GENDER, k) || k);
    _appGenderChart = new Chart(gCtx, {
      type: 'doughnut',
      data: { labels: gLabels, datasets: [{ data: Object.values(d.gender), backgroundColor: [accent, warn, textSec], borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: textSec, font: { size: 11 }, padding: 8 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } } }, cutout: '65%', responsive: true, maintainAspectRatio: false },
    });
  }

  // Category charts (top / bottom / hair length) — labels localised via maps
  _appTopCatChart  = _appCatChart('appTopCatChart',  _appMapLabels(d.top_cat,    _APP_TOP),  _appTopCatChart);
  _appBotCatChart  = _appCatChart('appBotCatChart',  _appMapLabels(d.bottom_cat, _APP_BOT),  _appBotCatChart);
  _appHairLenChart = _appCatChart('appHairLenChart', _appMapLabels(d.hair_length, _APP_HAIR), _appHairLenChart);

  // Age group, expression, direction charts
  if (d.age_group && Object.keys(d.age_group).length) {
    _appAgeGroupChart = _appCatChart('appAgeGroupChart', _appMapLabels(d.age_group, _APP_AGE_GROUP), _appAgeGroupChart);
  }
  if (d.expression && Object.keys(d.expression).length) {
    _appExprChart = _appCatChart('appExprChart', _appMapLabels(d.expression, _APP_EXPR), _appExprChart);
  }
  if (d.direction && Object.keys(d.direction).length) {
    _appDirChart = _appCatChart('appDirChart', _appMapLabels(d.direction, _APP_DIR), _appDirChart);
  }

  const peakCtx = document.getElementById('appPeakChart')?.getContext('2d');
  if (peakCtx) {
    if (_appPeakChart) _appPeakChart.destroy();
    _appPeakChart = new Chart(peakCtx, {
      type: 'bar',
      data: { labels: peakPoints.map(p => peakLabel(p.bucket)), datasets: [{ data: peakPoints.map(p => p.n), backgroundColor: peakPoints.map(p => p === peakMax ? warn : accent), borderRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: textSec, font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textSec, font: { size: 10 } } } }, responsive: true, maintainAspectRatio: false },
    });
  }
  const peakNote = document.getElementById('appPeakNote');
  if (peakNote) peakNote.textContent = peakMax
    ? I18N.t('app.peakNote').replace('{bucket}', peakLabel(peakMax.bucket)).replace('{n}', peakMax.n)
    : I18N.t('app.noResults');

  const cameraCtx = document.getElementById('appCameraChart')?.getContext('2d');
  if (cameraCtx) {
    if (_appCameraChart) _appCameraChart.destroy();
    const cameraRows = d.by_camera || [];
    _appCameraChart = new Chart(cameraCtx, {
      type: 'bar',
      data: { labels: cameraRows.map(r => r.camera_name || r.camera_id), datasets: [{ data: cameraRows.map(r => r.n), backgroundColor: accent, borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textSec, font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: textSec, font: { size: 10 } } } }, responsive: true, maintainAspectRatio: false },
    });
  }

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
      { label: I18N.t('app.statsMask'),     val: acc.mask_count     },
      { label: I18N.t('app.statsHat'),      val: acc.hat_count      },
    ].filter(t => t.val > 0);
    tiles.innerHTML = tileData.map(t => `<div class="app-accessory"><strong>${t.val}</strong><span>${escapeHtml(t.label)}</span></div>`).join('');
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
   'appFilterBottom','appFilterBottomColor','appFilterHair','appFilterHairColor',
   'appFilterGlasses','appFilterHelmet','appFilterMask','appFilterHat','appFilterExpression','appFilterAgeGroup',
   'appFilterBag','appFilterMinConf']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['appFilterTopColor','appFilterBottomColor','appFilterHairColor'].forEach(id => _appSetColor(id, ''));
  // Route through setAppRange('today') so pickers + button highlight + query stay
  // consistent (plain el.value='' left the old button lit while sending no dates)
  const defBtn = document.querySelector('#page-appearance .per-btn[data-range="today"]');
  setAppRange('today', defBtn);
}
