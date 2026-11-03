// ============================================================
// Vigil Platform — Snapshots Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// Snapshots Page
// ============================================================

// Cached so we only hit the facet/category endpoints once per site per session.
// Keyed by site: these lists differ per site, and a single slot handed whichever
// site asked first to every other one. Events/Snapshot/Media all share these two
// loaders, so the key has to live here rather than in any one page.
const _snapFacetsBySite = new Map();       // siteId|'' -> { rule_names, event_types, ... }
const _snapCategoriesBySite = new Map();   // siteId|'' -> [{ id, name, kind, ... }]

// '' = every site the user may see (no pill selected). Passed through to the
// server, which treats it as "RBAC scope only".
function _snapSiteKey() {
  return (typeof _opActiveSiteId !== 'undefined' && _opActiveSiteId) ? String(_opActiveSiteId) : '';
}

async function _loadSnapFacets() {
  const key = _snapSiteKey();
  if (_snapFacetsBySite.has(key)) return _snapFacetsBySite.get(key);
  let out;
  try {
    const r = await fetch(`${API}/api/events/facets${key ? `?site_id=${key}` : ''}`, { cache: 'no-store' });
    out = await r.json();
  } catch { out = { rule_names: [], event_types: [] }; }
  _snapFacetsBySite.set(key, out);
  return out;
}

async function _loadSnapCategories() {
  const key = _snapSiteKey();
  if (_snapCategoriesBySite.has(key)) return _snapCategoriesBySite.get(key);
  let out;
  try {
    const r = await fetch(`${API}/api/categories${key ? `?site_id=${key}` : ''}`, { cache: 'no-store' });
    out = await r.json();
  } catch { out = []; }
  _snapCategoriesBySite.set(key, out);
  return out;
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
    // MultiPicker: ไม่มี option "ทั้งหมด" — ไม่เลือกอะไรเลย = ทั้งหมด (เหมือนหน้า LPR/Face)
    // เก็บสิ่งที่เคยเลือกไว้ข้ามการ populate ถ้าหมวดนั้นยังมีอยู่
    const keep = new Set((typeof MultiPicker !== 'undefined' ? MultiPicker.values('snapFilterCategory') : []).map(String));
    catSel.innerHTML = (cats || []).map(c =>
      `<option value="${c.id}"${keep.has(String(c.id)) ? ' selected' : ''}>` +
      `${escapeHtml((c.icon || '') + ' ' + c.name).trim()}</option>`).join('');
    if (typeof MultiPicker !== 'undefined') MultiPicker.refresh('snapFilterCategory');
  }
}

function resetSnapFilters() {
  document.getElementById('snapFilterCam').value = '';
  document.getElementById('snapFilterType').value = '';
  const catSel = document.getElementById('snapFilterCategory');
  if (catSel) {
    [...catSel.options].forEach(o => { o.selected = false; });
    if (typeof MultiPicker !== 'undefined') MultiPicker.refresh('snapFilterCategory');
  }
  clearDtValue('snapFilterFrom');
  clearDtValue('snapFilterTo');
  _snapPage = 1;
  loadSnapshots();
}

function toggleSnapGroupBurst() {
  const el = document.getElementById('snapGroupBurst');
  if (!el) return;
  localStorage.setItem('snapGroupBurst', el.checked ? '1' : '0');
  loadSnapshots(1);
}

// Phase 6.1.7 — server-side pagination: 20/page, no hard cap
let _snapPage = 1;
let _snapTotal = 0;

async function loadSnapshots(page = 1) {
  _snapPage = page;
  // Sync the grouping checkbox from its persisted preference (per-browser, not
  // a server setting) — harmless to re-read every call, only differs after
  // toggleSnapGroupBurst() writes a new value.
  const groupBurstEl = document.getElementById('snapGroupBurst');
  if (groupBurstEl) {
    const saved = localStorage.getItem('snapGroupBurst');
    if (saved !== null) groupBurstEl.checked = saved === '1';
  }
  const cam = document.getElementById('snapFilterCam').value;
  const rule = document.getElementById('snapFilterType').value;
  // ⚠️ อ่านจาก MultiPicker.values() ไม่ใช่ catSel.value — select ที่ถูก upgrade แล้ว
  // เป็น multiple ค่า .value จะคืนแค่ตัวแรกที่เลือก ซึ่งเงียบและผิดโดยไม่มีอะไรฟ้อง
  const categoryIds = (typeof MultiPicker !== 'undefined')
    ? MultiPicker.values('snapFilterCategory') : [];
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
    // A high-frequency rule (e.g. a vehicle counter firing every couple of
    // seconds) collapses into one giant burst with nothing to look at —
    // the checkbox lets an operator turn grouping off for that view (2026-08-18).
    ...(document.getElementById('snapGroupBurst')?.checked !== false ? { group: 'burst' } : {}),
  });
  if (cam) params.set('camera', cam);
  if (!cam) {
    const ids = getActiveScopedCameraIds();
    if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
  }
  if (rule) params.set('rule_name', rule);
  if (categoryIds.length) params.set('category_ids', categoryIds.join(','));
  if (from) params.set('from', toIso(from));
  if (to)   params.set('to',   toIso(to));

  const container = document.getElementById('snapsContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  document.getElementById('snapCount').textContent = '…';

  try {
    const res = await fetch(`${API}/api/events?${params.toString()}`, { cache: 'no-store', supersede: 'snapshots' });
    _snapTotal = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    // ผลกว้างเกินเพดาน เซิร์ฟเวอร์หยุดนับ — ค่าเป็นพื้น ไม่ใช่ยอดจริง จึงต่อ "+"
    const capped = res.headers.get('X-Total-Capped') === '1';
    snapshots = await res.json();
    document.getElementById('snapCount').textContent =
      _snapTotal.toLocaleString() + (capped ? '+' : '');
    renderSnapshots();
    renderPagination('snapPagination', _snapPage, _snapTotal, PAGE_SIZE,
      (p) => loadSnapshots(p), 'snapshot');
  } catch (e) {
    if (e && e.superseded) return;   // มีคำขอใหม่มาแทนแล้ว — อย่าเขียน "โหลดไม่สำเร็จ" ทับหน้าที่กำลังโหลดใหม่
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
          ${_snapThumb(ev, `${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=${SNAP_W.card}`, '', true)}
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
          ${_snapThumb(ev, `${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=${SNAP_W.card}`, 'snap-thumb--list', false)}
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
    // migration 165 — default off, so an unknown camera must not draw one
    trail: c?.overlay_show_trail === true,
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

// Bosch — geometry comes from the camera's ONVIF metadata track (migration 164
// / _bbox, stored as fractions of the frame with y measured downward), not from
// the MQTT event, which carries @ObjectId but no coordinates at all.
//
// A bracket rather than a full rectangle, and the same one LPR uses: at the
// sizes these objects occupy at night, corner marks say "this one" without
// covering the thing they point at. This is also why the camera's own
// VCAOverlay is the wrong tool here — it traces the whole outline at a fixed
// stroke width.
// Speed as the camera reports it. This row existed already but read ev.speed,
// which the API never sends — there is no such column, and mqtt-subscriber
// leaves the value inside raw_json (see its comment at the insert: "topic/
// video_source/speed/geo_* are preserved inside raw_json"). So the row was
// dead code and no event ever showed a speed.
//
// km/h leads because the reader is looking at a road; m/s is kept beside it
// because that is the number the camera actually sent. The conversion is
// exact, but the value's accuracy is not ours to promise — Bosch derives it
// from the camera's own geometric calibration, so an uncalibrated camera
// gives a self-consistent figure that is not metres per second.
// Two sources, and they are not the same measurement. _speed_avg is the mean
// over the object's samples from the ONVIF metadata track, i.e. how fast it was
// moving while it crossed; Behaviour.Speed is one reading taken at the instant
// the rule fired. Prefer the average where it exists and say which one is being
// shown, because "26 km/h" means different things depending on the answer.
function _snapSpeed(ev) {
  const rj = ev?.raw_json;
  const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const avg = num(rj?._speed_avg);
  const inst = num(rj?.Data?.Object?.Object?.Behaviour?.Speed);
  const n = avg ?? inst;
  if (n == null) return null;
  return {
    label: I18N.t(avg != null ? 'snap.speedAvg' : 'snap.speed'),
    text: `${(n * 3.6).toFixed(0)} ${I18N.t('unit.kmh')} (${n.toFixed(1)} m/s)`,
  };
}

// ค่าที่กล้องส่งมาเป็นคำอังกฤษดิบ เช่น "Crossed" — แปลเฉพาะคำที่เป็นศัพท์มาตรฐาน
// ส่วนชื่อ rule ที่ผู้ใช้ตั้งเองบนกล้อง (Crossing_line_2, Detect_moving_objects) ไม่มี
// พจนานุกรมให้แปลและไม่ควรเดา — คืนค่าดิบไปตรง ๆ ดีกว่าแปลผิด
function _snapI18nOr(key, raw) {
  const t = I18N.t(key);
  return (t && t !== key) ? t : String(raw);
}
function _snapEventVerb(ev) {
  const base = (typeof eventTypeLabel === 'function' ? eventTypeLabel(ev.event_type) : ev.event_type) || '';
  return escapeHtml(_snapI18nOr('evk.' + String(base).trim(), base));
}
function _snapClassLabel(cls) {
  if (!cls) return '';
  const k = String(cls).trim();
  return escapeHtml(_snapI18nOr('cls.' + k.charAt(0).toUpperCase() + k.slice(1), k));
}

// ปุ่มแว่นขยายตัวเดียวกับ modal LPR (.lm-zoom-btn) — วางทับมุมภาพ ไม่ใช่ปุ่มแยกใต้ภาพ
function _snapZoomBtn() {
  return `<button type="button" class="lm-zoom-btn" data-action="viewFullSnap" title="${escapeHtml(I18N.t('snap.viewFull'))}" aria-label="${escapeHtml(I18N.t('snap.viewFull'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="15.65" y2="15.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg></button>`;
}

// ไฟล์ภาพถูกลบตามรอบเก็บข้อมูลแล้ว แต่แถวยังอยู่ — วาดรูปจำลองจาก metadata แทน
// ช่องว่างดำ ๆ เหมือนที่ LPR ทำ (lprVehicleSvg มาจาก lpr-plaque.js) ให้ยังบอกได้ว่า
// event นี้เคยเป็นอะไร · ไม่ใช่ภาพจริง จึงต้องเขียนกำกับไว้ว่าไม่มีต้นฉบับแล้ว
// 🔴 ค่าที่ใส่ต้องเป็นคำของ **vehicle_type ฝั่ง LPR** (twoWheelVehicle / largeBus / …)
//    ไม่ใช่ object_class ที่กล้องส่งมา เพราะปลายทางคือ vehKind() ใน lpr-plaque.js
//    ซึ่งรู้จักแค่คำชุดนั้น · ของเดิมแมปเป็น 'motorcycle'/'bus'/'bicycle' ซึ่ง vehKind
//    ไม่รู้จักเลย แล้ว fall through เป็น 'car' ทั้งหมด ⇒ **รูปจำลองเป็นรถเก๋งทุกใบ
//    ไม่ว่าจะจักรยานยนต์ รถบรรทุก หรือรถบัส** (เจอตอนทำภาพย่อ 2026-09-11)
//    จักรยานไม่มีรูปของตัวเอง ใช้รูปสองล้อที่ใกล้ที่สุด
const _SNAP_VEH_CLASS = { motorcycle:'twoWheelVehicle', bicycle:'twoWheelVehicle', car:'vehicle',
  pickup:'pickupTruck', van:'van', truck:'truck', bus:'largeBus', vehicle:'vehicle', vehical:'vehicle' };
function _snapObjArt(ev) {
  const cls = String(ev.object_class || '').toLowerCase();
  const vt = _SNAP_VEH_CLASS[cls];
  return (vt && typeof lprVehicleSvg === 'function') ? lprVehicleSvg(vt)
    : `<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 21v-2.5A4.5 4.5 0 0 1 10 14h4a4.5 4.5 0 0 1 4.5 4.5V21"/></svg>`;
}
function _snapObjFallback(ev) {
  const art = _snapObjArt(ev);
  const name = ev.object_class ? _snapClassLabel(ev.object_class) : '';
  return `<div class="lpr-imggone"><div class="ig-veh">${art}</div><div class="ig-cap">${escapeHtml(I18N.t('snap.imgGone'))}${name ? `<br><small>${name}</small>` : ''}<br><small>${escapeHtml(I18N.t('snap.imgGoneHint'))}</small></div></div>`;
}

// ── ภาพย่อในรายการที่ไฟล์ถูกลบไปแล้ว (เจ้าของสั่ง 2026-09-11) ──────────────
// เดิมเป็น <img> ที่ 404 แล้วหรี่ลงเหลือ 30% ⇒ ได้ไอคอนรูปแตกของเบราว์เซอร์
// ซึ่งหน้าตาต่างกันทุกเบราว์เซอร์และอ่านได้แค่ว่า "พัง" ไม่ใช่ "ภาพหมดอายุแล้ว"
// ใช้รูปจำลองชุดเดียวกับโมดัล (.lpr-imggone) แต่ย่อลงให้พอดีกล่อง 90/60 px
//
// ⚠️ ในภาพย่อไม่ใส่บรรทัด "ถูกลบตามรอบเก็บข้อมูล" — เหตุผลว่าทำไมภาพหาย เป็นของ
//    หน้ารายละเอียด ไม่ใช่ของ tile (WA #2-D) · แถบ list สูง 60 px ตัดคำกำกับออกด้วย
//    เพราะชื่อชนิดวัตถุอยู่ในคอลัมน์ข้าง ๆ อยู่แล้ว
function _snapMiniGone(ev, withCap) {
  const cap = withCap
    ? `<div class="ig-cap">${escapeHtml(I18N.t('snap.imgGoneShort', 'ไม่มีภาพ'))}</div>` : '';
  return `<div class="lpr-imggone ig-mini"><div class="ig-veh">${_snapObjArt(ev)}</div>${cap}</div>`;
}

// รูปจำลองอยู่ล่าง <img> ทับบน — โหลดได้ก็มองไม่เห็นรูปจำลอง โหลดไม่ได้
// data-err="hide" ซ่อน <img> แล้วรูปจำลองโผล่มาเอง (แบบเดียวกับ _snapMediaBox)
function _snapThumb(ev, url, cls, withCap) {
  return `<div class="snap-thumb${cls ? ' ' + cls : ''}">${_snapMiniGone(ev, withCap)}`
    + `<img src="${url}" loading="lazy" decoding="async" alt="" data-err="hide"></div>`;
}
// ── กล้องที่ push ทาง HTTP (edge-http) ─────────────────────────────────────
// วัดจริง 2026-09-09 (กล้อง BOSCH 3100i, 7 วัน): edge-http 612 ใบ มีบล็อกวัตถุ
// (ชนิด + ความมั่นใจ + รหัสวัตถุ + สี) 115 ใบ แต่ **มีพิกัดกรอบ 0 ใบ** ⇒ ตัดภาพ
// วัตถุเองไม่ได้เลย รูป crop ที่เห็นในโมดัลของ edge-meta มาจากสตรีม ONVIF
// metadata คนละทางกัน (ไฟล์ event_meta_<ts>_<objectId>.jpg)
//
// การ์ดนี้จึงเข้าไปยืนแทนช่อง crop ที่ว่าง — ให้จังหวะสองคอลัมน์ยังอยู่ และบอกสิ่งที่
// กล้องส่งมาจริง แทนที่จะเหลือภาพฉากใบเดียวโล่ง ๆ แล้วดูเหมือนโมดัลรุ่นด้อยกว่า
function _snapObjCard(ev) {
  if (!ev.object_class) return '';
  // ทับศัพท์ "Confidence" ตรง ๆ ทั้งสองภาษา (เจ้าของสั่ง 2026-09-09) — ไม่ใช้ snap.confidence
  // เพราะคีย์นั้นใช้ร่วมกับแถวในตารางด้านล่างและของ ANPR/ใบหน้าด้วย
  //
  // > 0 เท่านั้น ไม่ใช่ Number.isFinite: กล้อง Dahua ส่ง likelihood = 0 มาจริง แล้วการ์ด
  // ขึ้น "Confidence 0.0%" ซึ่งไม่ได้แปลว่ามั่นใจ 0% แต่แปลว่ากล้องไม่ได้ส่งค่ามา —
  // ไม่มีค่าก็ซ่อนไปเลย ดีกว่าบอกตัวเลขที่อ่านแล้วเข้าใจผิด (เจ้าของสั่ง 2026-09-09)
  const conf = Number(ev.likelihood) > 0
    ? `Confidence ${(ev.likelihood * 100).toFixed(1)}%` : '';
  return `<div class="snap-objcard">
    <div class="oc-art">${_snapObjArt(ev)}</div>
    <div class="oc-class">${_snapClassLabel(ev.object_class)}</div>
    ${conf ? `<div class="oc-conf">${conf}</div>` : ''}
    <div class="oc-note">${escapeHtml(I18N.t('snap.objNoBox'))}</div>
  </div>`;
}

// อีก 467 ใบไม่มีแม้แต่บล็อกวัตถุ (กฎ Bin deposit 0/256 · Detect moving objects
// 0/191 · คนกินน้ำ 0/6) — เป็นเรื่องของสคริปต์ VCA บนกล้องว่าเปิดส่ง Object data
// ไว้หรือไม่ ไม่ใช่ของที่หน้าเว็บเติมให้ได้ · เดิมแถวเหล่านั้นหายไปเฉย ๆ คนอ่านจึง
// แยกไม่ออกระหว่าง "ระบบไม่มีข้อมูล" กับ "ระบบพัง" — บอกไปตรง ๆ ดีกว่า
function _snapNoObjNote(ev) {
  const src = ev.snapshot_source || ev.raw_json?._snapshot_source || '';
  if (src !== 'edge-http' || ev.object_class || !ev.snapshot_file) return '';
  // เจ้าของสั่ง 2026-09-09: เอา *คำอธิบาย* ออก เหลือ remark บรรทัดเดียว
  // — แต่ **ไอคอนต้องอยู่** (เจ้าของทักตอนผมถอดออกไปเอง) · ไม่มีกรอบ ไม่มี `*`
  return `<div class="snap-why">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1" stroke-linecap="round"/></svg>
    <span>${escapeHtml(I18N.t('snap.noObjData'))}</span></div>`;
}

// ชื่อ pipeline → คำไทย · คีย์ i18n แปลงจากค่าดิบด้วยกฎเดียว (ขีด → ขีดล่าง)
// จะได้ไม่ต้องมีตารางที่สองให้เพี้ยนจากกัน · ไม่มีคำแปล = โชว์ค่าดิบไปตามเดิม
function _snapSourceLabel(raw) {
  const key = 'snapsrc.' + String(raw).replace(/[^a-zA-Z0-9]+/g, '_');
  const th = I18N.t(key);
  const txt = (th && th !== key) ? th : String(raw);
  return `<span title="${escapeHtml(String(raw))}">${escapeHtml(txt)}</span>`;
}

function _snapMediaBox(url, fallbackHtml, extra = '') {
  return `<div class="lpr-media">${fallbackHtml}${url ? `<img class="lpr-media-img" src="${url}" loading="lazy" decoding="async" data-err="hide">` : ''}${extra}</div>`;
}

// heading คือมุมบน "ภาพ" ไม่ใช่ทิศเหนือ — 0 = ขวา, 90 = ขึ้น (ดู headingOf ใน
// src/helpers/onvifMetaTrack.js) · ลูกศรจึงหมุนด้วย -heading เพราะ CSS หมุนตามเข็ม
const _HDG8 = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'];
function _snapHeading(deg) {
  if (!Number.isFinite(deg)) return null;
  const label = I18N.t('hdg.' + _HDG8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]);
  return `<span class="snap-hdg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${-deg}deg)"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13,6 19,12 13,18"/></svg>${escapeHtml(label)}</span>`;
}

// สปาร์กไลน์ความเร็ว — SVG เขียนเอง ไม่ใช้ Chart.js เพราะมีไม่เกิน 40 จุด ไม่มีแกน
// ไม่มี interaction · viewBox 0..100 x 0..30 แล้วให้ CSS ยืดเต็มความกว้าง ส่วนความ
// หนาเส้นกันไม่ให้ยืดตามด้วย vector-effect เพื่อให้เส้นคมเท่ากันทุกความกว้างจอ
function _snapSpeedChart(series) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const v = series.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const span = (max - min) || 1;
  const W = 100, H = 30;
  const pts = v.map((y, i) => [
    +(i * W / (v.length - 1)).toFixed(2),
    +(H - ((y - min) / span) * H).toFixed(2),
  ]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const last = pts[pts.length - 1];
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const kmh = (x) => `${(x * 3.6).toFixed(0)}`;
  const unit = escapeHtml(I18N.t('unit.kmh'));
  // "N จุด" เคย hardcode ภาษาไทยไว้ตรงนี้ หลุด i18n มาตลอด (gotcha #42)
  const pointsTxt = escapeHtml(I18N.t('snap.sPoints').replace('{n}', v.length));
  return `<div class="snap-meta">
    <div class="snap-meta-cap"><span>${escapeHtml(I18N.t('snap.speedChart'))}</span><span>${pointsTxt}</span></div>
    <svg class="snap-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line class="sp-base" x1="0" y1="${H}" x2="${W}" y2="${H}"/>
      <polygon class="sp-fill" points="0,${H} ${line} ${W},${H}"/>
      <polyline class="sp-line" points="${line}"/>
      <circle class="sp-end" cx="${last[0]}" cy="${last[1]}" r="1.6" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="snap-sstats">
      <span>${escapeHtml(I18N.t('snap.sMin'))} <b>${kmh(min)}</b> ${unit}</span>
      <span>${escapeHtml(I18N.t('snap.sAvg'))} <b>${kmh(avg)}</b> ${unit}</span>
      <span>${escapeHtml(I18N.t('snap.sMax'))} <b>${kmh(max)}</b> ${unit}</span>
    </div>
  </div>`;
}

function _boschSnapShapes(raw) {
  const b = raw?._bbox;
  if (!b) return [];
  const ok = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
  if (!ok(b.x) || !ok(b.y) || !(b.w > 0) || !(b.h > 0)) return [];
  if (b.x + b.w > 1.001 || b.y + b.h > 1.001) return [];
  return [{ kind: 'bracket', x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }];
}

// เส้นทางมาจาก ring buffer ของ metadata track (migration 165 / _trail) — กล้อง
// ไม่ได้ส่งเส้นทางมาเลย ไม่มี element ไหนใน ONVIF metadata ที่เป็น trajectory
// เส้นเขียวใน VCA overlay ของ Bosch คือกล้องวาดประวัติตำแหน่งของตัวเอง
function _boschTrailShapes(raw) {
  const t = raw?._trail;
  if (!Array.isArray(t) || t.length < 2) return [];
  const ok = (p) => Array.isArray(p) && p.length === 2
    && Number.isFinite(p[0]) && Number.isFinite(p[1])
    && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;
  const pts = t.filter(ok);
  return pts.length >= 2 ? [{ kind: 'trail', points: pts }] : [];
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

// Target-lock corner brackets (4 short L-shaped strokes instead of a full
// rectangle) — LPR vehicle box (migration 117, owner-picked over a solid
// box: distinctive, doesn't cover as much of the vehicle).
// stroke ส่งเข้ามาได้เพื่อทับสีของ class — ใช้ตอนที่กรอบต้องสื่อความหมายต่างออกไป
// (รถเฝ้าระวัง = แดง ไม่ใช่น้ำเงินเหมือนรถทั่วไป) · ไม่ส่ง = ใช้สีของ class เหมือนเดิม
function _bracketPaths(x1, y1, x2, y2, cls, stroke) {
  const w = x2 - x1, h = y2 - y1;
  const bl = Math.min(w, h) * 0.28;
  const corners = [
    [x1, y1,  bl, 0, 0,  bl],
    [x2, y1, -bl, 0, 0,  bl],
    [x1, y2,  bl, 0, 0, -bl],
    [x2, y2, -bl, 0, 0, -bl],
  ];
  return corners.map(([cx, cy, dx1, dy1, dx2, dy2]) =>
    // ⚠️ ต้องเป็น style ไม่ใช่ attribute `stroke=` — presentation attribute ของ SVG
    // แพ้ CSS ของ class เสมอ · เขียนเป็น attribute แล้วสียังเป็นสีของ .snap-bracket
    // (เจอตอน render จริงในเบราว์เซอร์ 2026-08-14 — อ่านโค้ดไม่มีทางเห็น)
    `<path d="M${cx+dx1},${cy+dy1} L${cx},${cy} L${cx+dx2},${cy+dy2}" fill="none" class="${cls}"${stroke ? ` style="stroke:${stroke}"` : ''} vector-effect="non-scaling-stroke"/>`
  ).join('');
}

// shapes[].color — สีที่ทับค่าเริ่มต้นของรูปทรงนั้น (ไม่ส่ง = สีเดิมทุกประการ)
// ⚠️ ฟังก์ชันนี้ใช้ร่วมกัน 4 หน้า (Snapshots · Face Gallery · AuraFace · LPR)
// การเปลี่ยนค่าเริ่มต้นจะกระทบทั้งหมด — จึงเลือกวิธี "ส่งสีมาทับ" แทน
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
    svg.innerHTML = shapes.map(sh => {
      if (sh.kind === 'poly') return `<polygon points="${sh.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" opacity="0.85"/>`;
      if (sh.kind === 'bracket') return _bracketPaths(sh.x1, sh.y1, sh.x2, sh.y2, 'snap-bracket', sh.color);
      // เส้นทางเดินของวัตถุ — วาดเป็นหลายท่อนแทนเส้นเดียว เพราะ SVG ทำเส้นเรียวใน
      // polyline เดียวไม่ได้ · ท่อนเก่าบางและจาง ท่อนใหม่หนาและเข้ม ทำให้อ่านทิศทาง
      // ได้โดยไม่ต้องมีหัวลูกศร และไม่ไปรบกวนฉากเหมือนเส้นทึบเส้นเดียวตลอดความยาว
      if (sh.kind === 'trail') {
        const p = sh.points;
        if (!Array.isArray(p) || p.length < 2) return '';
        let out = '';
        for (let i = 1; i < p.length; i++) {
          const k = i / (p.length - 1);              // 0 = เก่าสุด, 1 = ใหม่สุด
          out += `<line x1="${p[i - 1][0]}" y1="${p[i - 1][1]}" x2="${p[i][0]}" y2="${p[i][1]}"`
              + ` class="snap-trail" stroke-width="${(1 + k * 2.2).toFixed(2)}"`
              + ` opacity="${(0.14 + k * 0.66).toFixed(2)}" vector-effect="non-scaling-stroke"/>`;
        }
        return out;
      }
      // Red blinking face box — real faceRect coords from the camera (raw_json),
      // not estimated. Own class (not .snap-bracket) so its color/speed don't
      // change under whatever LPR later tunes on the existing bracket style.
      if (sh.kind === 'face-box') return `<rect x="${sh.x1}" y="${sh.y1}" width="${sh.x2 - sh.x1}" height="${sh.y2 - sh.y1}" fill="none" class="snap-face-box" vector-effect="non-scaling-stroke"/>`;
      return `<rect x="${sh.x1}" y="${sh.y1}" width="${sh.x2 - sh.x1}" height="${sh.y2 - sh.y1}" fill="none" style="stroke:${sh.color || 'var(--warn)'}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }).join('');
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

  // Phase 2 — the modal shows a medium ?w=640 (SNAP_W.pair) thumbnail (fast); the
  // full image loads only on the explicit "ดูภาพเต็ม" click.
  // When a BOSCH ObjectDetection event has both MQTT body crop (_snapshot)
  // and HTTP full-scene (_snapshot_full), show them side-by-side.
  // ANPR: plate crop (left, bg #111) + scene (right) when both are present.
  const isAnpr = ev.event_type === 'anprAlarm';
  const isFaceMatch = ev.event_type === 'FaceRecognition';
  const snapFull = ev.raw_json?._snapshot_full;
  const plateFile = isAnpr ? ev.plate_image : null;
  // เค้าโครงเดียวกับ modal LPR: ซ้าย = ภาพ crop ของวัตถุ · ขวา = ภาพเต็มพร้อมแว่นขยาย
  // ทั้งสองกล่องมีคำกำกับ (.lm-cap) เพราะเดิมมีภาพสองใบวางติดกันโดยไม่บอกว่าใบไหนคืออะไร
  // snapshot_file บอกไม่ได้ด้วยตัวเองว่าเป็น crop หรือภาพเต็ม และ cleanEventImages
  // (routes/events.js:75) ตัด _snapshot_full ทิ้งเมื่อชี้ไฟล์เดียวกับ snapshot_file
  // ทำให้ event ที่มีแต่ภาพเต็มเหลือกล่องเดียว — เดิมติดป้าย "ภาพวัตถุ (CROP)" ให้
  // ทั้งที่เป็นภาพถนนทั้งภาพ · แหล่งที่มาเป็นตัวเดียวที่บอกได้ว่ามันคืออะไร
  const _src = ev.snapshot_source || ev.raw_json?._snapshot_source || '';
  const _primaryIsCrop = _src === 'edge-meta' || _src === 'mqtt' || !!plateFile;
  const _cropUrl  = ev.snapshot_file ? `${API}/snapshots/${encodeURI(ev.snapshot_file)}?w=${SNAP_W.crop}` : null;
  const _sceneUrl = snapFull ? `${API}/snapshots/${encodeURI(snapFull)}?w=${SNAP_W.pair}` : null;
  const _fallback = _snapObjFallback(ev);
  const _capCrop  = escapeHtml(I18N.t(plateFile ? 'lpr.mReal' : 'snap.mCrop'));
  const _capScene = escapeHtml(I18N.t('snap.mScene'));
  // crop ของป้ายทะเบียน (ANPR) เตี้ยและกว้าง ใช้ .lm-realcrop ของ LPR ได้ตรง ๆ
  // ส่วน crop ของ Bosch เป็นวัตถุทั้งตัวซึ่งเป็นแนวตั้ง ต้องกล่องสูงกว่า
  const _cropCls = plateFile ? 'lm-realcrop' : 'snap-objcrop';
  const _box = (cap, inner, cls) => `<div class="lm-box${cls === 'scene' ? ' lm-snapbox' : ''}"><span class="lm-cap">${cap}</span><div class="lm-imgwrap ${cls === 'scene' ? 'lm-scenebox' : _cropCls}">${inner}</div></div>`;

  let imgHtml;
  // ANPR มาก่อนทุกกรณี: ภาพป้ายทะเบียนที่กล้องตัดมาให้คือของสำคัญที่สุดของ event
  // ชนิดนี้ ส่วน snapshot_file ของมันคือ "ฉาก" ไม่ใช่ crop — ถ้าปล่อยให้ตกไปสาขา
  // ด้านล่างจะเหลือแต่ฉากแล้วป้ายหายไปทั้งใบ (regression ที่ผมทำไว้ตอนรื้อ layout)
  if (plateFile && (_cropUrl || _sceneUrl)) {
    const scene = _sceneUrl || _cropUrl;
    imgHtml = `<div class="lm-grid">
      <div class="lm-left">${_box(escapeHtml(I18N.t('lpr.mReal')), _snapMediaBox(`${API}/snapshots/${encodeURI(plateFile)}?w=${SNAP_W.crop}`, _fallback), 'crop')}</div>
      <div class="lm-right">${_box(_capScene, _snapMediaBox(scene, _fallback, _snapZoomBtn()).replace('class="lpr-media-img"', 'class="lpr-media-img" id="snapModalImg"'), 'scene')}</div>
    </div>`;
  } else if (_cropUrl && _sceneUrl) {
    // สองใบ — id เดิมคงไว้ทั้งคู่: snapModalImg = ใบที่ overlay ของ Dahua/Hik เกาะ
    // ส่วน snapModalFullImg = ภาพเต็มที่กรอบวัตถุของ Bosch เกาะ (ดู _boschSnapShapes)
    imgHtml = `<div class="lm-grid">
      <div class="lm-left">${_box(_capCrop, _snapMediaBox(_cropUrl, _fallback).replace('class="lpr-media-img"', 'class="lpr-media-img" id="snapModalImg"'), 'crop')}</div>
      <div class="lm-right">${_box(_capScene, _snapMediaBox(_sceneUrl, _fallback, _snapZoomBtn()).replace('class="lpr-media-img"', 'class="lpr-media-img" id="snapModalFullImg"'), 'scene')}</div>
    </div>`;
  } else if (_cropUrl || _sceneUrl) {
    // ใบเดียว = กล่องกินเต็มความกว้างโมดัล จึงขอไฟล์ที่ใหญ่กว่าคู่แฝดสองคอลัมน์
    // และใส่ .lm-solo ให้ CSS เลิกล็อกความสูงไว้ที่ 236px
    //
    // 🔴 เดิมสาขานี้ตกมาใช้ `_cropUrl` ทั้งดุ้นเมื่อไม่มี _sceneUrl ซึ่งพก `?w=320`
    // ติดมาด้วย (SNAP_W.crop ตั้งไว้สำหรับ crop ในเลย์เอาต์สองคอลัมน์) · กรณีของ
    // edge-http คือ cleanEventImages (routes/events.js) ล้าง `_snapshot_full` ทิ้ง
    // เพราะชี้ไฟล์เดียวกับ snapshot_file ⇒ _sceneUrl เป็น null เสมอ ⇒ **ภาพฉาก
    // 1920x1080 ถูกส่งมาที่ 320 px แล้วยืดขึ้นเป็น ~840 px** นี่คือต้นเหตุจริงของ
    // "ภาพไม่ชัด" (เจ้าของทัก 2026-09-09) ไม่ใช่ตัวไฟล์ที่ edge เก็บ
    const isCrop = !_sceneUrl && _primaryIsCrop;
    const onlyFile = _sceneUrl ? snapFull : ev.snapshot_file;
    const only = `${API}/snapshots/${encodeURI(onlyFile)}?w=${SNAP_W.hero}`;
    // ไม่มีภาพวัตถุ แต่กล้องบอกมาว่าเป็นอะไร → เอาการ์ดวัตถุมายืนแทนช่องซ้าย
    const objCard = isCrop ? '' : _snapObjCard(ev);
    imgHtml = objCard
      ? `<div class="lm-grid lm-grid--objcard">
          <div class="lm-left">${_box(escapeHtml(I18N.t('snap.objFound')), objCard, 'crop')}</div>
          <div class="lm-right">${_box(_capScene, _snapMediaBox(only, _fallback, _snapZoomBtn()).replace('class="lpr-media-img"', 'class="lpr-media-img" id="snapModalImg"'), 'scene')}</div>
        </div>`
      : `<div class="lm-grid lm-solo" style="grid-template-columns:1fr">
          ${_box(isCrop ? _capCrop : _capScene, _snapMediaBox(only, _fallback, _snapZoomBtn()).replace('class="lpr-media-img"', 'class="lpr-media-img" id="snapModalImg"'), isCrop ? 'crop' : 'scene')}
        </div>`;
  } else if (plateFile) {
    imgHtml = `<div class="lm-grid" style="grid-template-columns:1fr">
      ${_box(_capCrop, _snapMediaBox(`${API}/snapshots/${encodeURI(plateFile)}?w=${SNAP_W.card}`, _fallback), 'crop')}
    </div>`;
  } else {
    // ไม่มีไฟล์ภาพเลย — ยังวาดรูปจำลองให้ ไม่ปล่อยเป็นกล่องว่างเปล่า
    imgHtml = `<div class="lm-grid" style="grid-template-columns:1fr">${_box(_capScene, _fallback, 'scene')}</div>`;
  }

  const rj = ev.raw_json || {};

  // Vehicle-type label — safe-call _lprVType (defined in page-lpr.js, loaded after)
  const _lprVTypeLabel = typeof _lprVType === 'function' ? _lprVType : (v) => v;
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
    (rj.plate || ev.plate_number)   ? [I18N.t('lpr.fPlate','ป้ายทะเบียน'),  escapeHtml(rj.plate || ev.plate_number)] : null,
    (ev.lp_region   || rj.region)   ? [I18N.t('lpr.region','จังหวัด'),  escapeHtml((typeof provinceLabel==='function' ? provinceLabel(ev.lp_region || rj.region) : (ev.lp_region || rj.region)))] : null,
    (ev.lp_vehicle_type  || rj.vehicleType)  ? [I18N.t('lpr.fType','ประเภทรถ'),
      escapeHtml(_lprVTypeLabel(ev.lp_vehicle_type || rj.vehicleType) || ev.lp_vehicle_type || rj.vehicleType)] : null,
    (ev.lp_vehicle_color || rj.vehicleColor) ? [I18N.t('lpr.vehicleColor','สีรถ'),
      `${_lprDot(ev.lp_vehicle_color || rj.vehicleColor)}${escapeHtml(_lprCLabel(ev.lp_vehicle_color || rj.vehicleColor))}`] : null,
    (ev.lp_vehicle_brand || rj.vehicleBrand) ? [I18N.t('lpr.brand','ยี่ห้อ'), escapeHtml((typeof _lprBrandLabel==='function' ? _lprBrandLabel(ev.lp_vehicle_brand || rj.vehicleBrand) : (ev.lp_vehicle_brand || rj.vehicleBrand)))] : null,
    rj.plateColor ? [I18N.t('lpr.plateColor','สีป้าย'),
      `${_lprDot(rj.plateColor)}${escapeHtml(_lprCLabel(rj.plateColor))}`] : null,
    rj.confidence ? ['Confidence', `${rj.confidence}%`] : null,
    rj.direction  ? [I18N.t('snap.direction','ทิศทาง'), _lprDirLabel(rj.direction)] : null,
    rj.laneNo     ? [I18N.t('lpr.lane','Lane'), escapeHtml(rj.laneNo)] : null,
  ].filter(Boolean) : [
    [I18N.t('evt.colTime'), time.toLocaleString('th-TH', {hour12:false})],
    [I18N.t('common.camera'), ev.camera_id],
    ev.rule_name    ? [I18N.t('snap.rule'), escapeHtml(ev.rule_name)] : null,
    [I18N.t('snap.type'), _snapEventVerb(ev)],
    ev.object_class ? [I18N.t('snap.class'), _snapClassLabel(ev.object_class)] : null,
    (isFaceMatch || ev.likelihood)  ? [I18N.t('snap.confidence'), isFaceMatch
      ? (rj.similarity != null ? `${(rj.similarity*100).toFixed(1)}%` : '—')
      : `${(ev.likelihood*100).toFixed(1)}%`] : null,
    isFaceMatch ? [I18N.t('fmatch.person'),
      rj.personName ? escapeHtml(rj.personName) : I18N.t('fmatch.noMatch')] : null,
    isFaceMatch && rj.listType ? [I18N.t('fmatch.listType'),
      rj.listType === 'blackList'
        ? `<span style="color:var(--status-bad)">${escapeHtml(rj.fdLibName || I18N.t('fmatch.blackList'))}</span>`
        : `<span style="color:var(--status-ok)">${escapeHtml(rj.fdLibName || I18N.t('fmatch.whiteList'))}</span>`] : null,
    (() => { const sp = _snapSpeed(ev); return sp ? [sp.label, sp.text] : null; })(),
    rj.direction    ? [I18N.t('snap.direction'),
      ['enter','leave'].includes(String(rj.direction).toLowerCase())
        ? I18N.t('dir.' + String(rj.direction).toLowerCase())
        : escapeHtml(String(rj.direction))] : null,
    // ObjectId คือกุญแจที่ผูก event กับกรอบ/crop จาก metadata track — เวลาไล่ปัญหา
    // ว่า "ทำไมใบนี้ได้กรอบ ใบนั้นไม่ได้" ต้องมองเลขนี้ ไม่ใช่เวลา
    // ค่า area ของกล้องไม่มีหน่วย เทียบได้เฉพาะกับวัตถุอื่นบนกล้องเดียวกันที่ระยะ
    // ใกล้กัน — เขียนกำกับไว้ในป้าย ไม่งั้นจะถูกอ่านเป็นตารางเมตร
    // คำอธิบายเต็มไปอยู่ใน title — แถว .lm-drow เป็นแถวสั้น ใส่ประโยคยาวแล้วเบียด
    // ตัวเลขจนอ่านไม่ออก ส่วนคำสั้นในวงเล็บกันไม่ให้ถูกอ่านเป็นตารางเมตร
    Number.isFinite(rj._area) ? [I18N.t('snap.objSize'),
      `<span title="${escapeHtml(I18N.t('snap.objSizeHint'))}">${rj._area}<span style="color:var(--text-secondary);font-size:10px;margin-left:5px;font-weight:400">${escapeHtml(I18N.t('snap.objSizeUnit'))}</span></span>`] : null,
    _snapHeading(rj._heading) ? [I18N.t('snap.heading'), _snapHeading(rj._heading)] : null,
    ev.object_id    ? [I18N.t('snap.objectId'), escapeHtml(String(ev.object_id))] : null,
    // แหล่งภาพเป็นชื่อ pipeline ภายในของเรา (edge-http · dahua-cgi-live · …) — ลูกค้าอ่าน
    // ไม่รู้เรื่อง แต่เจ้าของใช้ค่านี้ไล่ปัญหาจริง จึงแปลเป็นไทยให้อ่านออก **แล้วเก็บค่าดิบ
    // ไว้ใน title** (เจ้าของเลือกทางนี้ 2026-09-09) · ค่าที่ยังไม่มีคำแปลตกกลับเป็นค่าดิบ
    // เอง ไม่กลายเป็นช่องว่างเมื่อมี pipeline ใหม่เข้ามา
    ev.snapshot_source ? [I18N.t('snap.source', 'แหล่งภาพ'), _snapSourceLabel(ev.snapshot_source)] : null,
  ].filter(Boolean);

  // ปุ่ม "ดูภาพเต็ม" เดิมถูกแทนด้วยไอคอนแว่นขยายบนมุมภาพ (_snapZoomBtn) ให้ตรงกับ
  // modal LPR — action เดิม viewFullSnap ยังทำงานเหมือนเดิมทุกอย่าง
  // Phase 6.1.5 — link to pre-alarm clip if available
  const clipBtn = ev.clip_file && ev.clip_status === 'done'
    ? `<button class="btn btn-primary" style="font-size:11px" data-action="closeAndShowClip">${I18N.t('snap.viewClip')} (${ev.clip_duration_sec ? parseFloat(ev.clip_duration_sec).toFixed(1) + 's' : ''})</button>`
    : '';
  const btnRow = clipBtn
    ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${clipBtn}</div>`
    : '';

  document.getElementById('snapModalBody').innerHTML = `
    ${imgHtml}
    ${btnRow}
    ${clipBlock(ev)}
    <div class="lm-data" id="snapFieldsGrid">
      ${fields.map(([k, v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('')}
    </div>
    ${_snapNoObjNote(ev)}
    ${_snapSpeedChart(rj._speed_series)}
    <div id="snapAppearanceSection"></div>`;
  modal.classList.remove('hidden');

  // Dahua zone events — draw BoundingBox + rule DetectRegion on the snapshot.
  // หมายเหตุ: snapshot ถูกเลือกจาก RTSP buffer ใกล้เวลา event — กรอบอาจเหลื่อม
  // จากตัวคนเล็กน้อยเพราะคนละเฟรมกับที่ analytic ตัดสิน
  const ovlFlags = _camOverlayFlags(ev.camera_id);
  attachSnapOverlay(document.getElementById('snapModalImg'),
    [..._dahuaSnapShapes(ev.raw_json), ..._hikSnapShapes(ev.raw_json)]
      .filter(s => s.kind === 'box' ? ovlFlags.bbox : ovlFlags.zone));

  // Bosch object bracket. Deliberately a separate attach: _bbox describes a
  // position in the FULL SCENE, so when the modal is showing a crop beside it
  // (snapModalImg is the crop in that layout) the frame belongs on the other
  // image. Putting it on the crop would draw a box around a fraction of a
  // picture that is already only that object.
  if (ovlFlags.bbox || ovlFlags.trail) {
    // กรอบกับเส้นทางเป็นคนละสวิตช์ — เปิดอย่างใดอย่างหนึ่งได้ ทั้งคู่ก็ได้
    const boschShapes = [
      ...(ovlFlags.bbox ? _boschSnapShapes(ev.raw_json) : []),
      ...(ovlFlags.trail ? _boschTrailShapes(ev.raw_json) : []),
    ];
    if (boschShapes.length) {
      attachSnapOverlay(
        document.getElementById('snapModalFullImg') || document.getElementById('snapModalImg'),
        boschShapes);
    }
  }

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
        // ต้องเป็น .lm-drow ให้ตรงกับแถวที่ render ไปแล้ว ไม่งั้นแถวนี้จะหน้าตาคนละแบบ
        const cell = document.createElement('div');
        cell.className = 'lm-drow';
        cell.innerHTML = `<span class="lm-dk">${escapeHtml(I18N.t('snap.dwell'))}</span><span class="lm-dv">${escapeHtml(val)}</span>`;
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
  // Vehicle colours seen in the GuruSquare blacklist roster (migration 093)
  Gold:'#c9a227', Darkorange:'#c25e00',
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
  // Vehicle colours seen in the GuruSquare blacklist roster (migration 093).
  // _lprColorLang() normalizes case first, so 'DarkOrange' and 'Darkorange'
  // both land on the single 'Darkorange' key — no duplicate entry needed.
  Silver:  { th: 'เงิน',          en: 'Silver'  },
  Pink:    { th: 'ชมพู',          en: 'Pink'    },
  Gold:    { th: 'ทอง',           en: 'Gold'    },
  Darkorange: { th: 'ส้มเข้ม',    en: 'Dark Orange' },
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
// หัวข้อของส่วนนี้เดิมเขียนตายว่า "ลักษณะบุคคล" ซึ่งผิดเมื่อวัตถุเป็นรถ — และ
// สำหรับกล้อง Bosch/IVA ที่ไม่ใช่ Pro แถวเดียวที่ได้คือกลุ่มสีรวมทั้งตัว ไม่มี
// attribute ของคนเลย เลือกหัวข้อตามสิ่งที่มีจริงในชิป ดีกว่าหาคำกลางที่กำกวมทั้งสองทาง
const _APP_PERSON_KEYS = ['gender','top_category','bottom_category','hair_length','glasses','bag_category','mask','hat'];
function _appSectionTitle(ap) {
  const isPerson = _APP_PERSON_KEYS.some(k => ap && ap[k] && ap[k] !== 'no');
  return I18N.t(isPerson ? 'snap.appearance' : 'snap.objColor');
}
function _renderAppearanceSection(ap) {
  const chips = _buildAppChips(ap);
  if (!chips.length) return '';
  return `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-hairline)">
      <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;letter-spacing:.06em">${_appSectionTitle(ap)}</div>
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
  const src = `${API}/snapshots/${encodeURIComponent(file)}${mode === 'scene' ? `?w=${SNAP_W.scene}` : ''}`;
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
        ${_snapThumb(m, `${API}/snapshots/${encodeURIComponent(m.snapshot_file)}?w=${SNAP_W.card}`, '', true)}
        <div class="snap-item-info">
          <div style="color:var(--text-secondary);font-size:9px">${time.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
        </div>
      </div>` : '';
  }).join('')}</div>`;
}

function closeBurstModal() { document.getElementById('burstModal').classList.add('hidden'); }
