// ============================================================
// Vigil Platform — Cameras Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================


// ============================================================
// Cameras Page
// ============================================================

// Multi-site (Phase A) — site filter is a layer ABOVE the group bar. Sites
// come from /api/sites; cameras carry site_id/cam_role from /api/cameras.
// No RBAC scoping yet (Phase B) — every site is shown to every logged-in user.
let _activeSiteId = null;   // null = ทุก Site
let _sites = [];
let _siteById = {};
const _camResCache = {};     // camera_id → "WxH · N MP" (client-side snapshot probe)
let _camGridPage = 1;
const CAM_GRID_PAGE_SIZE = 10;   // demo-parity: 10 cards/page (pager shows at >10)

// ── Manual grid order ───────────────────────────────────────────
// Working copy of camera_ids while the "จัดเรียง" panel is open.
// ⚠️ เดิมเป็น "ทั้งหมดทุก Site ไม่กรอง" ซึ่งตอนมีไซต์เดียวก็ถูก แต่พอมีหลายไซต์แล้ว
//    เลือก Phuket (86 กล้อง) กลับได้รายการ 144 แถวปนกล้องหาดใหญ่ 58 ตัว
//    (เจ้าของเจอจริง 2026-08-21) ⇒ กรองตาม Site ที่เลือกอยู่
let _camReorderOrder = null;
let _camReorderSiteId = null;   // Site ที่กำลังจัดเรียง (null = ทุก Site)

function camReorderEnter() {
  _camReorderSiteId = _activeSiteId;
  _camReorderOrder = _camReorderScope().map(c => c.camera_id);
  document.getElementById('cameraGrid').style.display = 'none';
  document.getElementById('camPager').style.display = 'none';
  document.querySelector('.cam-search-row').style.display = 'none';
  document.getElementById('camReorderPanel').style.display = '';
  _renderCamReorderList();
}

function camReorderCancel() {
  _camReorderOrder = null;
  _camReorderSiteId = null;
  document.getElementById('cameraGrid').style.display = '';
  document.getElementById('camPager').style.display = '';
  document.querySelector('.cam-search-row').style.display = '';
  document.getElementById('camReorderPanel').style.display = 'none';
}

// กล้องที่อยู่ในขอบเขตการจัดเรียงรอบนี้ — เรียงตามลำดับที่ใช้แสดงจริงอยู่แล้ว
// (cameras มาจาก API ซึ่ง sort ด้วย sort_order ?? (1e6 + configIdx) ให้แล้ว)
function _camReorderScope() {
  return _camReorderSiteId ? cameras.filter(c => c.site_id === _camReorderSiteId) : cameras;
}

// ประกอบลำดับเต็มทั้งระบบก่อนส่ง — endpoint renumber 0..N-1 ตามอาร์เรย์ที่ได้รับ
// 🔴 ถ้าส่งเฉพาะกล้องของ Site ที่เลือก (86 ตัว) จะได้ sort_order 0..85 ไปทับของ
//    หาดใหญ่ที่ใช้ 0..57 อยู่ ⇒ ลำดับหน้าสถานะกล้องพังทั้งระบบ
//    จึงเอาลำดับใหม่ไปวางแทนที่ "ช่องเดิม" ที่กล้องของ Site นั้นเคยครองอยู่
//    ตำแหน่งสัมพัทธ์ของ Site อื่นจึงไม่ขยับแม้จะถูก renumber ใหม่ทุกตัว
function _camReorderFullOrder() {
  if (!_camReorderSiteId) return _camReorderOrder;
  const full = cameras.map(c => c.camera_id);
  const inScope = new Set(_camReorderScope().map(c => c.camera_id));
  let k = 0;
  return full.map(id => (inScope.has(id) ? _camReorderOrder[k++] : id));
}

async function camReorderSave() {
  const btn = document.querySelector('#camReorderPanel [data-action="camReorderSave"]');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API}/api/cameras/reorder`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: _camReorderFullOrder() }),
    });
    if (!r.ok) throw new Error('save failed');
    showToast({ icon: '✓', title: I18N.t('cam.reorderSaved') });
    await loadCameras();
    camReorderCancel();
  } catch (e) {
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function camReorderMove(camId, dir) {
  const i = _camReorderOrder.indexOf(camId);
  if (i < 0) return;
  if (dir === 'top') {
    if (i === 0) return;
    _camReorderOrder.splice(i, 1);
    _camReorderOrder.unshift(camId);
  } else {
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= _camReorderOrder.length) return;
    [_camReorderOrder[i], _camReorderOrder[j]] = [_camReorderOrder[j], _camReorderOrder[i]];
  }
  _renderCamReorderList();
}

function _renderCamReorderList() {
  const el = document.getElementById('camReorderList');
  if (!el) return;
  const byId = Object.fromEntries(cameras.map(c => [c.camera_id, c]));
  // บอกให้ชัดว่ากำลังจัดเรียงของ Site ไหน — ไม่งั้นผู้ใช้ที่เลือก Site ไว้จะไม่รู้ว่า
  // รายการนี้สั้นลงเพราะถูกกรอง หรือเพราะกล้องหาย
  const _site = _camReorderSiteId ? (_sites || []).find(x => x.id === _camReorderSiteId) : null;
  const scopeNote = _site
    ? `<p class="cam-status-note" style="margin:0 0 6px">${escapeHtml(I18N.t('cam.reorderScope', 'จัดเรียงเฉพาะ Site'))}: <b>${escapeHtml(_site.name)}</b> · ${_camReorderOrder.length} ${escapeHtml(I18N.t('sys.camerasUnit', 'กล้อง'))}</p>`
    : '';
  el.innerHTML = scopeNote + `<p class="cam-status-note" style="margin:0 0 10px">${escapeHtml(I18N.t('cam.reorderHint'))}</p>` +
    _camReorderOrder.map((id, idx) => {
      const c = byId[id] || { camera_name: id };
      const isFirst = idx === 0, isLast = idx === _camReorderOrder.length - 1;
      return `<div class="cam-reorder-row">
        <span class="cam-reorder-idx">${idx + 1}</span>
        <span class="cam-reorder-name">${escapeHtml(c.camera_name || id)}</span>
        <span class="cam-reorder-id">${escapeHtml(id)}</span>
        <span class="cam-reorder-btns">
          <button type="button" class="csv-btn" title="${escapeHtml(I18N.t('cam.moveTop'))}" ${isFirst ? 'disabled' : ''} data-action="camReorderMoveTop" data-cid="${escapeHtml(id)}"><svg aria-hidden="true" width="14" height="14"><use href="#icon-chevrons-up"/></svg></button>
          <button type="button" class="csv-btn" title="${escapeHtml(I18N.t('cam.moveUp'))}" ${isFirst ? 'disabled' : ''} data-action="camReorderMoveUp" data-cid="${escapeHtml(id)}"><svg aria-hidden="true" width="14" height="14"><use href="#icon-chevron-up"/></svg></button>
          <button type="button" class="csv-btn" title="${escapeHtml(I18N.t('cam.moveDown'))}" ${isLast ? 'disabled' : ''} data-action="camReorderMoveDown" data-cid="${escapeHtml(id)}"><svg aria-hidden="true" width="14" height="14"><use href="#icon-chevron-down"/></svg></button>
        </span>
      </div>`;
    }).join('');
}

async function loadCameras() {
  try {
    const [camRes, siteRes] = await Promise.all([
      fetch(`${API}/api/cameras`),
      fetch(`${API}/api/sites`),
    ]);
    cameras = await camRes.json();
    _sites = await siteRes.json();
    _siteById = Object.fromEntries(_sites.map(s => [s.id, s]));
    document.getElementById('cameraCount').textContent = cameras.length;
    renderGroupBars();
    renderSiteTabs(); renderCamTypeTabs();
    populateCamGroupFilter();
    // การ์ดกล้องมี <img src="/api/snapshot/live/..."> อยู่ในตัว — วาดทีเดียวยิงภาพสด
    // ทุกกล้อง ผู้ใช้ที่ไม่มีสิทธิ์หน้านี้จึงได้ 403 รัวๆ ตั้งแต่ boot ทั้งที่ไม่เคยเปิดหน้า
    // (loadCameras ยังต้องรันอยู่ เพราะ dropdown เลือกกล้องของหน้าอื่นใช้ `cameras`)
    if (typeof ViewsACL === 'undefined' || ViewsACL.allowed('cameras')) {
      renderCameraGrid();
      updateKPIs();
    }
  } catch (e) { console.error(e); }
}

function renderSiteTabs() {
  const el = document.getElementById('siteTabs');
  if (!el) return;
  // Single-site deployments don't need the tab strip.
  if (_sites.length <= 1) { el.innerHTML = ''; return; }
  const tab = (sid, label, color, active) => {
    const dot = color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>` : '';
    return `<button class="gtab${active ? ' active' : ''}" data-action="setActiveSite" data-sid="${sid}">${dot} ${escapeHtml(label)} <span class="tc">${sid === '' ? cameras.length : cameras.filter(c => c.site_id === sid).length}</span></button>`;
  };
  el.innerHTML = tab('', I18N.t('cam.allSites'), null, _activeSiteId === null)
    + _sites.map(s => tab(s.id, s.name, s.color, _activeSiteId === s.id)).join('');
}

// Camera-type tabs beside the site tabs. Uses .gtab (this page's button shape) with
// a per-type active colour matching the type badges, and drives the now-hidden
// #camTypeFilter select so the existing filter/refilter wiring is unchanged.
const _CAM_TYPE_TABS = [
  { v: '',         cls: 't-any',      i18n: 'cam.typeAll',      fb: 'ทุกประเภท',  dot: null },
  { v: 'standard', cls: 't-standard', i18n: 'cam.typeStandard', fb: 'IVA / Event', dot: null },
  { v: 'face',     cls: 't-face',     i18n: 'cam.roleFace',     fb: 'ใบหน้า',     dot: 'var(--accent)' },
  { v: 'lpr',      cls: 't-lpr',      i18n: 'cam.roleLpr',      fb: 'LPR',        dot: 'var(--warn)' },
];
function renderCamTypeTabs() {
  const el = document.getElementById('camTypeTabs');
  if (!el) return;
  const cur = document.getElementById('camTypeFilter')?.value || '';
  // Count within the current site scope — the number has to agree with the grid
  // the operator is looking at, not with the whole fleet.
  const scope = _activeSiteId ? cameras.filter(c => c.site_id === _activeSiteId) : cameras;
  el.innerHTML = _CAM_TYPE_TABS.map(t => {
    const n = t.v ? scope.filter(c => (c.cam_role || 'standard') === t.v).length : scope.length;
    const dot = t.dot ? `<span class="type-dot" style="background:${t.dot}"></span>` : '';
    return `<button class="gtab ${t.cls}${t.v === cur ? ' active' : ''}" data-action="setActiveCamType" data-type="${t.v}">${dot}${escapeHtml(I18N.t(t.i18n, t.fb))} <span class="tc">${n}</span></button>`;
  }).join('');
}
function setActiveCamType(v) {
  const sel = document.getElementById('camTypeFilter');
  if (!sel) return;
  sel.value = v || '';
  sel.dispatchEvent(new Event('change', { bubbles: true })); // reuses _camRefilter
  renderCamTypeTabs();
}

function setActiveSite(sid) {
  _activeSiteId = sid ? Number(sid) : null;
  _camGridPage = 1;
  renderSiteTabs(); renderCamTypeTabs();
  // The active group tab may now be hidden (belongs to a different site) —
  // reset to "ALL" so a foreign-site group filter doesn't keep silently
  // ANDing with site_id (same fix as Stats'/Events'/Snapshot's own site switch).
  if (activeGroupId !== 'all' && _activeSiteId) {
    const g = groups.find(gr => gr.id === activeGroupId);
    const siteCamIds = new Set(cameras.filter(c => c.site_id === _activeSiteId).map(c => c.camera_id));
    if (!g || !(g.cameraIds || []).some(id => siteCamIds.has(id))) activeGroupId = 'all';
  }
  // grpBar is now site-scoped (renderGroupBars() in dashboard.js) — re-render
  // so switching site immediately drops group tabs with no camera there.
  renderGroupBars();
  renderCameraGrid();
  updateKPIs();
}

// Apply the full Camera-Status filter chain: group → site → type → status → search.
function _camStatusFiltered() {
  let list = getActiveGroupCameras();
  if (_activeSiteId) list = list.filter(c => c.site_id === _activeSiteId);
  const fVendor = document.getElementById('camVendorFilter')?.value || '';
  if (fVendor) list = list.filter(c => (c.vendor || 'bosch').toLowerCase() === fVendor);
  const fType = document.getElementById('camTypeFilter')?.value || '';
  if (fType) list = list.filter(c => (c.cam_role || 'standard') === fType);
  const fStatus = document.getElementById('camStatusFilter')?.value || '';
  if (fStatus) list = list.filter(c => c.status === fStatus);
  const q = (document.getElementById('camSearch')?.value || '').trim().toLowerCase();
  if (q) list = list.filter(c =>
    (c.camera_name || '').toLowerCase().includes(q) ||
    (c.camera_id   || '').toLowerCase().includes(q) ||
    (c.ip_address  || '').toLowerCase().includes(q) ||
    (c.location    || '').toLowerCase().includes(q));
  return list;
}

// ── Camera card builders (demo-parity redesign) ──────────────
function camRelTime(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '—';
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return I18N.t('cam.justNow');
  if (sec < 3600) return I18N.t('cam.minAgo').replace('{n}', Math.round(sec / 60));
  if (sec < 86400) return I18N.t('cam.hrAgo').replace('{n}', Math.round(sec / 3600));
  return I18N.t('cam.dayAgo').replace('{n}', Math.round(sec / 86400));
}

// Dynamic preview overlays (ts + count chip + offline/paused) — patched in place
// by updateCameraGridStats without reloading the snapshot <img>.
function buildPreviewDynamic(c) {
  const online = c.status === 'online';
  const paused = c.status === 'paused';
  const role = c.cam_role || 'standard';
  const tc = _todayCounts.cameras[c.camera_id];
  const tsStr = c.last_seen ? new Date(c.last_seen).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '';
  let chip = '';
  if (online && tc) {
    if (role === 'lpr') chip = `<div class="preview-count type-lpr"><span class="pc-dot"></span>${(tc.vehicles ?? 0).toLocaleString()} ${escapeHtml(I18N.t('cam.unitCar'))}</div>`;
    else if (role === 'face') chip = `<div class="preview-count type-face"><span class="pc-dot"></span>${((tc.faces ?? 0) + (tc.face_matches ?? 0) + (tc.face_miss ?? 0)).toLocaleString()} ${escapeHtml(I18N.t('cam.unitFace'))}</div>`;
    else chip = `<div class="preview-count type-${role}"><span class="pc-dot"></span>${(tc.persons ?? 0).toLocaleString()} ${escapeHtml(I18N.t('cam.unitPpl'))}</div>`;
  }
  let overlay = '';
  if (paused) overlay = `<div class="preview-overlay paused"><svg width="20" height="20" aria-hidden="true"><use href="#icon-pause"/></svg>${escapeHtml(I18N.t('cam.maintenance'))}</div>`;
  else if (!online) overlay = `<div class="preview-overlay offline">${escapeHtml(I18N.t('cam.noSignal'))}</div>`;
  return `${tsStr ? `<div class="preview-ts">${escapeHtml(tsStr)}</div>` : ''}${chip}${overlay}`;
}

function buildCardPreview(c) {
  const online = c.status === 'online';
  const paused = c.status === 'paused';
  const role = c.cam_role || 'standard';
  const inner = (!paused && (c.push_only || (online && c.ip_address)))
    ? `<img decoding="async" src="${API}/api/snapshot/live/${c.camera_id}?w=${SNAP_W.card}&t=${Date.now()}" alt="" data-err="cam-placeholder"${c.nvr_channel != null ? ' data-nvr="1"' : ''}>`
    : (online ? `<div class="placeholder">${escapeHtml(I18N.t('cam.noIp'))}</div>` : '');
  return `<div class="card-preview type-${role}">${inner}<div class="preview-cam-id">${escapeHtml(c.location || c.camera_id)}</div>${buildPreviewDynamic(c)}</div>`;
}

function buildCardInfo(c) {
  const online = c.status === 'online';
  const paused = c.status === 'paused';
  const role = c.cam_role || 'standard';
  const tc = _todayCounts.cameras[c.camera_id] || {};
  const VENDOR_LABEL = { bosch: 'Bosch', hikvision: 'Hikvision', dahua: 'Dahua', onvif: 'ONVIF' };
  const vendor = (c.vendor || '').toLowerCase();
  const TYPE_LABEL = { lpr: I18N.t('cam.roleLpr'), face: I18N.t('cam.roleFace'), standard: 'IVA' };
  const badges = [];
  if (VENDOR_LABEL[vendor]) badges.push(`<span class="badge vendor-${vendor}">${VENDOR_LABEL[vendor]}</span>`);
  badges.push(`<span class="badge type-${role}">${escapeHtml(TYPE_LABEL[role] || role)}</span>`);
  if (!paused && c.recording) badges.push(`<span class="badge badge-recording">REC</span>`);

  const site = _siteById[c.site_id];
  const grp = (typeof groups !== 'undefined') ? groups.find(g => g.cameraIds && g.cameraIds.includes(c.camera_id)) : null;
  const parts = [];
  if (site) parts.push(`<span class="bc-dot" style="background:${site.color || 'var(--accent)'}"></span>${escapeHtml(site.name)}`);
  if (grp) parts.push(escapeHtml(grp.name));
  const breadcrumb = parts.length ? `<div class="cam-breadcrumb">${parts.join(' › ')}</div>` : '';

  let stats;
  if (role === 'lpr') {
    stats = `<div class="stat-line">${escapeHtml(I18N.t('cd.vehicles'))}&ensp;<span class="sv warn">${(tc.vehicles ?? 0).toLocaleString()}</span></div>`
          + `<div class="stat-line">Events&ensp;<span class="sv dim">${(tc.total ?? 0).toLocaleString()}</span></div>`;
  } else if (role === 'face') {
    const known   = tc.face_matches ?? 0;
    const unknown = (tc.faces ?? 0) + (tc.face_miss ?? 0);
    stats = `<div class="stat-line">${escapeHtml(I18N.t('cd2.faces'))}&ensp;<span class="sv purple">${(unknown + known).toLocaleString()}</span></div>`
          + `<div class="stat-line">${escapeHtml(I18N.t('cd2.known'))}&ensp;<span class="sv ok">${known.toLocaleString()}</span>&ensp;·&ensp;${escapeHtml(I18N.t('cd2.unknown'))}&ensp;<span class="sv dim">${unknown.toLocaleString()}</span></div>`;
  } else {
    stats = `<div class="stat-line">Events&ensp;<span class="sv dim">${(tc.total ?? 0).toLocaleString()}</span>&ensp;·&ensp;${escapeHtml(I18N.t('cam.people'))}&ensp;<span class="sv ok">${(tc.persons ?? 0).toLocaleString()}</span></div>`;
  }
  const lastStr = c.last_seen ? camRelTime(c.last_seen) : '—';
  const lsClass = online ? 'dim' : (paused ? 'warn' : 'bad');

  return `<div class="card-info">
        <div class="card-info-top">
          <div class="card-info-left">
            <div class="cam-toprow">
              <span class="status-dot ${c.status}"></span>
              <span class="cam-id">${escapeHtml(c.camera_id)}</span>
              ${paused ? `<span class="badge maint">${escapeHtml(I18N.t('cam.paused'))}</span>` : ''}
            </div>
            <div class="cam-location-name" title="${escapeHtml(c.camera_name || c.location || '')}">${escapeHtml(c.camera_name || c.location || c.camera_id)}</div>
            ${breadcrumb}
          </div>
          <div class="card-badges">${badges.join('')}</div>
        </div>
        <div class="cam-stats">
          ${stats}
          <div class="last-seen-line">Last seen&ensp;<span class="sv ${lsClass}">${escapeHtml(lastStr)}</span></div>
        </div>
      </div>`;
}

// Group dropdown (replaces the old group-bar on the cameras page).
function populateCamGroupFilter() {
  const sel = document.getElementById('camGroupFilter');
  if (!sel || typeof groups === 'undefined') return;
  const cur = (activeGroupId && activeGroupId !== 'all') ? String(activeGroupId) : '';
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('cam.groupAll'))}</option>`
    + groups.map(g => `<option value="${escapeHtml(String(g.id))}"${String(g.id) === cur ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
}

function renderCameraGrid() {
  const grid = document.getElementById('cameraGrid');
  const camsList = _camStatusFiltered();

  const countEl = document.getElementById('camSearchCount');
  if (countEl) {
    countEl.textContent = camsList.length
      ? I18N.t('cam.countCameras').replace('{n}', camsList.length) : '';
  }

  // Pagination — only when the result set overflows one page.
  const total = camsList.length;
  const totalPages = Math.max(1, Math.ceil(total / CAM_GRID_PAGE_SIZE));
  if (_camGridPage > totalPages) _camGridPage = totalPages;
  const pageSlice = camsList.slice((_camGridPage - 1) * CAM_GRID_PAGE_SIZE, _camGridPage * CAM_GRID_PAGE_SIZE);
  const pager = document.getElementById('camPager');
  if (pager) {
    if (total > CAM_GRID_PAGE_SIZE) {
      renderPagination('camPager', _camGridPage, total, CAM_GRID_PAGE_SIZE, p => { _camGridPage = p; renderCameraGrid(); }, I18N.t('cam.countCameras').replace('{n}', '').trim());
    } else { pager.innerHTML = ''; }
  }

  if (camsList.length === 0) {
    const q = (document.getElementById('camSearch')?.value || '').trim();
    const hasFilter = !!(document.getElementById('camVendorFilter')?.value || document.getElementById('camTypeFilter')?.value || document.getElementById('camStatusFilter')?.value || _activeSiteId);
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
      ${cameras.length === 0 ? I18N.t('cam.noneYet')
        : q ? I18N.t('cam.noMatch').replace('{q}', escapeHtml(q.toLowerCase()))
        : hasFilter ? I18N.t('cam.noFilterMatch') : I18N.t('cam.groupEmpty')}
    </div>`;
    return;
  }
  grid.innerHTML = pageSlice.map(c =>
    `<div class="cam-card" data-camera-id="${escapeHtml(c.camera_id)}">${buildCardPreview(c)}${buildCardInfo(c)}</div>`
  ).join('');
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
    return `<p style="color:var(--status-bad)">${escapeHtml(I18N.t('aux.eulaLoadFailed'))}${escapeHtml(e.message)}</p>`;
  }
}

function openEulaViewer() {
  const m = document.getElementById('eulaViewerModal');
  const body = document.getElementById('eulaViewerBody');
  m.classList.remove('hidden');
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
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
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
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
      err.textContent = (e.error || `HTTP ${r.status}`);
      err.style.display = 'block';
      return;
    }
    closeEulaAcceptModal();
  } catch (e) {
    err.textContent = e.message;
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
    LICENSED:          { color: 'var(--status-ok)', label: 'Activated' },
    TRIAL:             { color: 'var(--warn)', label: 'Trial' },
    TRIAL_NOT_STARTED: { color: '#94a3b8', label: 'Not Started' },
    TRIAL_EXPIRED:     { color: 'var(--status-bad)', label: 'Trial Expired' },
    GRACE:             { color: '#f97316', label: 'Grace Period' },
    EXPIRED:           { color: 'var(--status-bad)', label: 'License Expired' },
    INVALID:           { color: 'var(--status-bad)', label: 'Invalid License' },
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
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--status-bad)">${escapeHtml(I18N.t('lic.loadFailed'))}</div>`;
    return;
  }
  const meta = _licenseStateMeta(status.mode);
  const machineId = status.machine_id || '—';

  // 1) Status banner — colored strip at top
  const banner = `
    <div style="background:${meta.color}1a;border-left:4px solid ${meta.color};padding:12px 14px;border-radius:6px;margin-bottom:14px">
      <div style="font-size:14px;color:${meta.color};font-weight:bold;margin-bottom:4px">${meta.label}</div>
      <div style="font-size:12px;color:var(--text-primary);line-height:1.6">${_licenseStateDetailHtml(status)}</div>
    </div>`;

  // 2) License info table — only when activated
  let licenseInfoBlock = '';
  if (status.license_info && status.mode !== 'INVALID') {
    const li = status.license_info;
    const expDate = li.expires_at ? new Date(li.expires_at).toLocaleDateString('th-TH') : '—';
    const issDate = li.issued_at ? new Date(li.issued_at).toLocaleDateString('th-TH') : '—';
    licenseInfoBlock = `
      <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">License Information</div>
        <table style="font-size:13px;width:100%;border-collapse:collapse">
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0;width:38%">Licensed to</td><td style="padding:4px 0"><strong>${escapeHtml(li.customer || '—')}</strong></td></tr>
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0">Customer ID</td><td style="padding:4px 0;font-family:monospace">${escapeHtml(li.customer_id || '—')}</td></tr>
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0">Tier</td><td style="padding:4px 0"><span style="background:rgba(91,141,239,0.15);color:var(--accent);padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(li.tier || '—')}</span></td></tr>
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0">Max cameras</td><td style="padding:4px 0">${li.max_cameras ?? '—'}</td></tr>
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0">Issued</td><td style="padding:4px 0">${escapeHtml(issDate)}</td></tr>
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0">Valid until</td><td style="padding:4px 0">${escapeHtml(expDate)}</td></tr>
          <tr><td style="color:var(--text-secondary);padding:4px 8px 4px 0">Days left</td><td style="padding:4px 0;font-weight:bold;color:${meta.color}">${li.days_left ?? '—'}</td></tr>
        </table>
      </div>`;
  }

  // 3) Machine ID — always shown
  const machineIdBlock = `
    <div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:6px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">${escapeHtml(I18N.t('lic.machineIdLabel'))}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <code style="flex:1;font-family:monospace;font-size:13px;padding:7px 10px;background:rgba(0,0,0,0.3);border-radius:4px;letter-spacing:1px;min-width:240px">${escapeHtml(machineId)}</code>
        <button class="btn btn-secondary" style="font-size:11px;padding:7px 14px;white-space:nowrap" data-action="copyMachineId" data-machine-id="${escapeHtml(machineId)}"><svg aria-hidden="true" width="13" height="13" style="vertical-align:-2px"><use href="#icon-clipboard"/></svg> Copy</button>
      </div>
      <div style="font-size:10px;color:var(--text-secondary);margin-top:6px">${escapeHtml(I18N.t('lic.machineIdHint'))}</div>
    </div>`;

  // 4) Activate / renew form
  const isRenewing = status.mode === 'LICENSED';
  const activateForm = `
    <div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:6px;padding:14px">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <span>${isRenewing ? I18N.t('lic.renewHeader') : I18N.t('lic.activateHeader')}</span>
        <a href="#" data-action="openEulaViewer" style="color:var(--accent);text-decoration:none;font-size:11px">${escapeHtml(I18N.t('lic.readEula'))}</a>
      </div>
      ${!isRenewing ? `
      <div style="font-size:11px;color:var(--text-primary);line-height:1.8;margin-bottom:10px;padding:8px 12px;background:rgba(91,141,239,0.08);border-radius:5px">
        ${I18N.t('lic.howToGet')}
      </div>` : ''}
      <textarea id="licenseKeyInput" placeholder="${escapeHtml(I18N.t('lic.keyPlaceholder'))}"
                style="width:100%;min-height:90px;padding:10px;background:rgba(0,0,0,0.3);border:1px solid var(--border-hairline);border-radius:5px;color:var(--text-primary);font-family:monospace;font-size:11px;resize:vertical;box-sizing:border-box;line-height:1.4"></textarea>
      <label style="display:flex;align-items:flex-start;gap:8px;margin-top:10px;cursor:pointer;font-size:11px;line-height:1.5">
        <input type="checkbox" id="licenseEulaAccept" data-change="eulaToggle" style="margin-top:2px;flex-shrink:0">
        <span>${escapeHtml(I18N.t('lic.eulaAcceptPre'))} <a href="#" data-action="openEulaViewer" style="color:var(--accent)">${escapeHtml(I18N.t('lic.eulaLinkText'))}</a></span>
      </label>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="licenseActivateBtn" style="flex:1;min-width:140px" data-action="activateLicense" disabled><svg aria-hidden="true" width="13" height="13"><use href="#icon-lock"/></svg> ${isRenewing ? I18N.t('lic.btnRenew') : 'Activate License'}</button>
        ${isRenewing ? `<button class="btn btn-secondary" data-action="deactivateLicense" title="${escapeHtml(I18N.t('lic.deactivateTitle'))}"><svg aria-hidden="true" width="13" height="13"><use href="#icon-trash"/></svg> Deactivate</button>` : ''}
      </div>
      <div id="licenseActivateError" style="margin-top:10px;font-size:12px;display:none;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:var(--status-bad)"></div>
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
      errEl.innerHTML = reasons[err.reason] || ((err.error || `HTTP ${r.status}`));
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
      ok.style.cssText = 'position:sticky;top:0;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.5);color:var(--status-ok);padding:10px;border-radius:5px;margin-bottom:12px;text-align:center;font-weight:bold';
      ok.textContent = I18N.t('lic.activateOk');
      body.insertBefore(ok, body.firstChild);
      setTimeout(() => ok.remove(), 3500);
    });
  } catch (e) {
    errEl.textContent = e.message;
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
  const _cdt = document.getElementById('camDetailTitle');
  (_cdt.querySelector('span') || _cdt).textContent = c.camera_name || c.camera_id;
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

// Deep-link from the camera-detail modal to the matching event view, pre-filtered
// to this camera. standard→Events (drillTo handles showPage+filter cleanly);
// lpr→LPR page, face→Face search tab (set the cam dropdown after the page renders).
function cameraViewEvents(el) {
  const role  = el.dataset.role || 'standard';
  const cam   = el.dataset.cam;
  const label = el.dataset.label || cam;
  closeCameraDetailModal();
  if (role === 'lpr') {
    showPage('lpr');
    setTimeout(() => {
      const sel = document.getElementById('lprFilterCam');
      if (sel) sel.value = cam;
      if (typeof loadLpr === 'function') loadLpr(1);
    }, 90);
  } else if (role === 'face') {
    showPage('face-matches');
    setTimeout(() => {
      if (typeof _switchFaceTab === 'function') _switchFaceTab('search');
      const sel = document.getElementById('faceFilterCamera2');
      if (sel) sel.value = cam;          // dropdown populated synchronously by the tab switch
      if (typeof _loadFaceTab === 'function') _loadFaceTab();
    }, 90);
  } else {
    if (typeof drillTo === 'function') drillTo({ camera: cam, label });
    else showPage('events');
  }
}

const VENDOR_LABEL_CD = { bosch:'Bosch', hikvision:'Hikvision', dahua:'Dahua', onvif:'ONVIF' };

// Camera-detail modal body (redesign A) — read-only summary: type-adaptive
// activity tiles + camera details + SD-recording box + a (deferred) deep-link
// button. Sync: tiles read server-side today-counts; no per-open events fetch.
function renderCameraDetail(c) {
  const body = document.getElementById('camDetailBody');
  if (!body) return;

  const online = c.status === 'online';
  const isPaused = c.status === 'paused';
  const role = c.cam_role || 'standard';
  const tc = (_todayCounts.cameras && _todayCounts.cameras[c.camera_id]) || { total: 0, persons: 0, vehicles: 0 };

  // Site breadcrumb (site only — groups are many-to-many in prod).
  const site = _siteById[c.site_id];
  const breadcrumb = (_sites.length > 1 && site)
    ? `<div class="cm-breadcrumb"><span class="bc-dot" style="background:${site.color || 'var(--accent)'}"></span>${escapeHtml(site.name)}</div>`
    : '';

  // Live snapshot preview (real image; click → full-res). Keeps the existing
  // snapshot path rather than the demo's SVG placeholder.
  const cdCap = camFullViewWidth(c.camera_id);
  const cdLiveFullUrl = `${API}/api/snapshot/live/${encodeURIComponent(c.camera_id)}` + (!c.push_only && cdCap ? `?w=${cdCap}` : '');
  const cdTs = c.last_seen ? new Date(c.last_seen).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '';
  const cdHasImg = !isPaused && (c.push_only || (online && c.ip_address));
  const preview = `<div class="cm-preview">${
    isPaused
      ? `<div class="placeholder">${escapeHtml(I18N.t('cam.maintenance'))}</div>`
      : cdHasImg
        ? `<img src="${API}/api/snapshot/live/${encodeURIComponent(c.camera_id)}?w=${SNAP_W.pair}&t=${Date.now()}" alt="" style="cursor:zoom-in" data-err="cam-span" data-action="openUrl" data-url="${escapeHtml(cdLiveFullUrl)}">`
        : `<div class="placeholder">${online ? escapeHtml(I18N.t('cam.noIp')) : 'Offline'}</div>`
  }${cdHasImg && cdTs ? `<div class="preview-ts">${escapeHtml(cdTs)}</div>` : ''}${cdHasImg ? `<div class="preview-cam-id">${escapeHtml(c.camera_id)}</div>` : ''}</div>`;

  // Activity tiles follow what the camera ACTUALLY produced today (faces vs
  // vehicles), so flipping the device between face/VCA needs no dashboard change.
  // cam_role is only the fallback when the camera is quiet (0 events today).
  const tile = (v, label, cls) => `<div class="cm-tile"><div class="cm-tile-v ${cls}">${v}</div><div class="cm-tile-l">${escapeHtml(label)}</div></div>`;
  const _faces = (tc.faces ?? 0) + (tc.face_matches ?? 0) + (tc.face_miss ?? 0);
  const _veh   = tc.vehicles ?? 0;
  const disp = (_faces > 0 && _faces >= _veh) ? 'face' : (_veh > 0 ? 'lpr' : role);
  let tiles;
  if (disp === 'lpr') {
    tiles = ((tc.persons ?? 0) > 0 ? tile((tc.persons).toLocaleString(), I18N.t('cam.people'), 'ok') : '')
          + tile((tc.vehicles ?? 0).toLocaleString(), I18N.t('cd.vehicles'), 'warn');
  } else if (disp === 'face') {
    // known = FaceRecognition WITH listType (actual match); unknown = FaceCapture + FaceRecognition miss (no listType)
    const known   = tc.face_matches ?? 0;
    const unknown = (tc.faces ?? 0) + (tc.face_miss ?? 0);
    tiles = tile((unknown + known).toLocaleString(), I18N.t('cd2.faces'), 'purple')
          + tile(known.toLocaleString(), I18N.t('cd2.known'), 'ok')
          + tile(unknown.toLocaleString(), I18N.t('cd2.unknown'), 'dim');
  } else {
    tiles = tile((tc.total ?? 0).toLocaleString(), I18N.t('cam.eventsTodayShort'), 'dim')
          + tile((tc.persons ?? 0).toLocaleString(), I18N.t('cam.people'), 'ok');
  }

  // Camera details. Resolution is probed client-side from the snapshot's
  // natural pixel size (cached per camera). Model/firmware come from the
  // auto-model-detect one-time fill (cameras.model/firmware) — 43/58 cameras
  // have it; rows are simply omitted for the rest rather than showing "—".
  const TYPE_LABEL = { standard:'IVA / Event', lpr: I18N.t('cam.roleLpr'), face: I18N.t('cam.roleFace') };
  const statusTxt = isPaused ? I18N.t('cam.paused') : (online ? 'ONLINE' : 'OFFLINE');
  const statusColor = isPaused ? 'var(--text-secondary)' : (online ? 'var(--status-ok)' : 'var(--status-bad)');
  const lastSeen = c.last_seen ? new Date(c.last_seen).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '—';
  const resStr = _camResCache[c.camera_id] || '—';
  const drow = (k, v) => `<div class="cm-drow"><span class="cm-dk">${escapeHtml(k)}</span><span class="cm-dv">${v}</span></div>`;
  const details = `<div class="cm-data">
    ${drow(I18N.t('cd2.camId'), escapeHtml(c.camera_id))}
    ${drow('Vendor', escapeHtml(VENDOR_LABEL_CD[(c.vendor || '').toLowerCase()] || c.vendor || '—'))}
    ${c.model ? drow(I18N.t('cd2.model'), escapeHtml(c.model)) : ''}
    ${c.firmware ? drow(I18N.t('cd2.firmware'), `<span class="cm-dv-fw">${escapeHtml(c.firmware)}</span>`) : ''}
    ${c.serial_number ? drow(I18N.t('cd2.serial'), escapeHtml(c.serial_number)) : ''}
    ${drow(I18N.t('cd2.type'), escapeHtml(TYPE_LABEL[role] || role))}
    ${drow('IP Address', escapeHtml(c.ip_address || '—'))}
    ${drow(I18N.t('cd2.resolution'), `<span id="cmResolution">${escapeHtml(resStr)}</span>`)}
    ${drow(I18N.t('cd2.status'), `<span style="color:${statusColor}">${statusTxt}</span>`)}
    ${drow(I18N.t('cd2.lastSeen'), escapeHtml(lastSeen))}
  </div>`;

  // Deep-link CTA → role-aware: standard=Events (drillTo), lpr=LPR page, face=Face search.
  const VIEW_KEY = { standard: 'cd2.viewEvents', lpr: 'cd2.viewLpr', face: 'cd2.viewFace' };
  const viewBtn = `<div class="cm-foot"><button class="cm-view-btn" data-action="cameraViewEvents" data-role="${escapeHtml(role)}" data-cam="${escapeHtml(c.camera_id)}" data-label="${escapeHtml(c.camera_name || c.camera_id)}">${escapeHtml(I18N.t(VIEW_KEY[role] || 'cd2.viewEvents'))}</button></div>`;

  // LPR cameras: Top-5 vehicle type (bar list, mirrors the LPR overview's
  // hotspot component) + a Blacklist Alert chip. Both come from /api/lpr/stats
  // scoped to this camera+today — fetched lazily below (not part of the hot
  // cached today-counts endpoint) and painted in only if this camera is still
  // the one open (guards the same race as the resolution probe).
  const lprExtra = disp === 'lpr'
    ? `<div id="cmLprBlacklist" class="cm-blacklist"></div>
       <div class="cm-box"><span class="cm-cap">${escapeHtml(I18N.t('cd2.vtypeTop'))}</span><div id="cmLprVtype" class="smb-top-list"><div class="smb-empty">…</div></div></div>`
    : '';

  // Details and storage side by side rather than stacked. Both are label/value
  // Camera details sit beside the snapshot rather than below it: the snapshot is
  // 16:9 and leaves a tall empty column at desktop width, and the details are
  // what identifies the camera you are looking at. The two share a row and the
  // snapshot's aspect ratio sets its height, so the details box is capped to
  // match the frame instead of stretching the row.
  //
  // The storage panel stays full width — it has the longest values in the modal
  // (a codec line, a list of push destinations) and half a row is not enough.
  // At ≤900px the pair stacks and the snapshot goes back on top.
  // Today's counts ride under the snapshot rather than below the pair. A 16:9
  // snapshot is shorter than ten rows of details, so the left column had dead
  // space exactly the height of this box — and "how many today" belongs with
  // the live picture anyway.
  body.innerHTML = breadcrumb
    + `<div class="cm-head">`
    +   `<div class="cm-head-l">`
    +     preview
    +     `<div class="cm-box"><span class="cm-cap">${escapeHtml(I18N.t('cd2.activity'))}</span><div class="cm-tiles">${tiles}</div></div>`
    +   `</div>`
    +   `<div class="cm-box"><span class="cm-cap">${escapeHtml(I18N.t('aux.camDetailTitle'))}</span>${details}</div>`
    + `</div>`
    + lprExtra
    + recBoxProd(c)
    + viewBtn;

  if (disp === 'lpr') _loadCamLprExtra(c.camera_id);

  // Resolution probe — read the snapshot's native pixel size once (cached).
  // Loads the full-res image off-DOM; updates the row if the modal is still
  // showing this camera when it resolves.
  if (cdHasImg && !_camResCache[c.camera_id]) {
    const probe = new Image();
    probe.onload = () => {
      if (!probe.naturalWidth) return;
      const mp = probe.naturalWidth * probe.naturalHeight / 1e6;
      const str = `${probe.naturalWidth}×${probe.naturalHeight} · ${mp >= 1 ? mp.toFixed(1) : mp.toFixed(2)}MP`;
      _camResCache[c.camera_id] = str;
      if (_camDetailCameraId === c.camera_id) {
        const el = document.getElementById('cmResolution');
        if (el) el.textContent = str;
      }
    };
    probe.src = cdLiveFullUrl + (cdLiveFullUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
  }
}

// LPR camera-detail extras — top-5 vehicle type + blacklist (watchlist) hit
// count, scoped to this camera + today via the existing /api/lpr/stats
// endpoint (not a new route). Labels go through page-lpr.js's _lprVType()
// map so a raw vendor code never leaks into the Thai UI untranslated.
async function _loadCamLprExtra(camId) {
  try {
    const res = await fetch(`${API}/api/lpr/stats?period=today&cameras=${encodeURIComponent(camId)}`);
    if (!res.ok) return;
    const d = await res.json();
    if (_camDetailCameraId !== camId) return;   // modal moved on while this was in flight

    const bl = document.getElementById('cmLprBlacklist');
    if (bl) {
      const n = d.watch ?? 0;
      bl.classList.toggle('alert', n > 0);
      bl.innerHTML = `${typeof _LPR_WARN_SVG !== 'undefined' ? _LPR_WARN_SVG : ''}
        <span>${escapeHtml(I18N.t('cd2.blacklist'))}</span><b>${n.toLocaleString()}</b>`;
    }

    const vt = document.getElementById('cmLprVtype');
    if (vt) {
      const list = (d.vtype || []).slice(0, 5);
      if (!list.length) {
        vt.innerHTML = `<div class="smb-empty">${escapeHtml(I18N.t('smb.noDataToday'))}</div>`;
      } else {
        const maxV = Math.max(...list.map(v => v.n), 1);
        vt.innerHTML = list.map((v, i) => {
          const label = typeof _lprVType === 'function' ? _lprVType(v.type) : v.type;
          const pct = Math.round(v.n / maxV * 100);
          return `<div class="smb-top-row">
            <span class="smb-top-rank">${i + 1}</span>
            <span class="smb-top-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <div class="smb-top-bar-wrap"><div class="smb-top-bar" style="width:${pct}%"></div></div>
            <span class="smb-top-val">${v.n.toLocaleString()}</span>
          </div>`;
        }).join('');
      }
    }
  } catch { /* best-effort — tiles/details already rendered without this */ }
}

// SD-recording box. Uses real /api/cameras fields; recording_data_from is not
// in the response yet, so retention shows "recorded until <ts>" (Phase B adds
// the start date). SD telemetry exists for Bosch only (ONVIF).
// Hikvision on-camera storage panel. Reads cameras.sd_detail_json as produced by
// helpers/hikStorage.buildSdDetail — see that file for why the three documents
// have to be read together.
// The camera keeps ten upload slots and an SDK client that reconnects every few
// days burns one per session — C10-KAR-SB-04 had eight dead entries for the same
// 10.5.10.4, which buried the two destinations anyone cares about. Fold a host's
// finished sessions into one line, and put whatever is still running first, so
// the list answers "where does this camera send now" before "where did it".
//
// Live sessions are never merged: two concurrent destinations on one host are
// genuinely two destinations. Only the finished ones collapse.
function groupUploads(uploads) {
  const out = [];
  const deadByIp = new Map();
  for (const u of uploads) {
    const dead = u.status === 'End';
    if (!dead) { out.push({ ...u, dead: false, sessions: 1 }); continue; }
    const g = deadByIp.get(u.ip);
    if (!g) { deadByIp.set(u.ip, { ...u, dead: true, sessions: 1 }); continue; }
    g.sessions++;
    g.total = (g.total || 0) + (u.total || 0);
    g.ok = (g.ok || 0) + (u.ok || 0);
    g.rate = g.total ? Math.round((g.ok / g.total) * 10000) / 100 : null;
    // Worst observed latency across the merged sessions, not an average of
    // averages — the point of keeping dead entries is to show what went badly.
    if (u.avg_ms != null) g.avg_ms = Math.max(g.avg_ms ?? 0, u.avg_ms);
    // One port stops identifying a merged group.
    if (g.port !== u.port) g.port = null;
  }
  const byVolume = (a, b) => (b.total || 0) - (a.total || 0);
  return out.sort(byVolume).concat([...deadByIp.values()].sort(byVolume));
}

function recBoxHik(c, box, drow, lastChk) {
  const d = c.sd_detail || {};
  const card = d.card || null;
  const rec = d.recording || null;
  const con = d.content || null;
  const t = (k, f) => I18N.t(k, f);
  const gb = mb => (mb == null ? null : (mb / 1024).toFixed(1));

  // Card health. 'idle' and 'armed_empty' are green on purpose — the card is
  // fine; whether anyone wants it recording is a separate question, answered two
  // rows down rather than by colouring a healthy card amber.
  // 'unsupported' gets a hollow LED, not warn: the camera refused to discuss its
  // storage, so there is no verdict to colour. Reporting that as a fault would be
  // the same over-claim as the "no card" it replaced.
  const LED = { ok: 'ok', idle: 'ok', armed_empty: 'ok', recording: 'ok',
                unformatted: 'warn', no_card: 'warn', unsupported: 'none' };
  const led = LED[d.state] || 'bad';
  const stateLabel = t('cd2.hikState.' + d.state, d.state || '—');
  const bits = card ? [
    card.property === 'RW' ? t('cd2.hikRw', 'อ่าน-เขียนได้') : (card.property === 'R' ? t('cd2.hikRo', 'อ่านได้อย่างเดียว') : null),
    card.format_type,
    card.encryption === 'unencrypted' ? t('cd2.hikPlain', 'ไม่ได้เข้ารหัส')
      : (card.encryption ? t('cd2.hikEnc', 'เข้ารหัส') : null),
  ].filter(Boolean).join(' · ') : '';

  const rows = [];
  rows.push(drow(t('cd2.sdStatus'),
    `<span class="sd-led ${led}"></span><span>${escapeHtml(stateLabel)}</span>` +
    (bits ? `<span style="color:var(--text-secondary);font-weight:500"> · ${escapeHtml(bits)}</span>` : '')));

  if (card && card.capacity_mb) {
    // "How full" is a separate question from "how big", and some cameras only
    // answer the second. Bosch BOSCH_3100i rejects STORAGE_LOAD (RCP+ 0x40)
    // while BSH-HDY-4038 returns it, so used_mb can legitimately be absent on a
    // healthy card. Printing it anyway rendered the literal string "null / 238.3
    // GB · 0%" with an empty bar — which reads as a blank card rather than an
    // unmeasured one. Show the size alone, and no bar, when that is all we know.
    const known = card.used_mb != null;
    const pct = known ? Math.min(100, Math.round((card.used_mb / card.capacity_mb) * 100)) : null;
    // Amber past 90% only. A card set to loop is SUPPOSED to reach 100% — that
    // is the ring buffer working, not a fault (C56-PKT-SB-17 sits there), so the
    // bar warns about the number without calling it an error.
    rows.push(drow(t('cd2.hikCapacity', 'ความจุ'), known
      ? `<span>${gb(card.used_mb)} / ${gb(card.capacity_mb)} GB</span>` +
        `<span class="sd-bar"><i style="width:${pct}%;background:${pct >= 90 ? 'var(--warn)' : 'var(--accent)'}"></i></span>` +
        `<span style="color:var(--text-secondary);font-weight:500">${pct}%</span>`
      : `<span>${gb(card.capacity_mb)} GB</span>` +
        `<span style="color:var(--text-secondary);font-weight:500"> · ${escapeHtml(t('cd2.hikUsedUnknown', 'ไม่ทราบว่าใช้ไปเท่าไร'))}</span>`));
  }
  if (card && card.installed_at) rows.push(drow(t('cd2.hikInstalled', 'ติดตั้งเมื่อ'), escapeHtml(card.installed_at)));

  // With no card the track rows describe a stream with nowhere to go — a
  // bitrate and a schedule printed under "no card" reads as a contradiction.
  if (rec && d.state !== 'no_card') {
    rows.push(drow(t('cd2.hikSchedule', 'การบันทึก'), rec.schedule_enabled
      ? `<span style="color:var(--status-ok)">${escapeHtml(t('cd2.hikSchedOn', 'เปิดอยู่'))}</span>`
      : `<span class="sd-led warn"></span><span style="color:var(--warn)">${escapeHtml(t('cd2.hikSchedOff', 'ปิดอยู่ — ไม่ได้ตั้งตารางบันทึก'))}</span>`));
    const mode = [rec.mode === 'CMR' ? t('cd2.hikCmr', 'ต่อเนื่อง (CMR)') : rec.mode,
                  rec.loop ? t('cd2.hikLoop', 'เขียนวนทับ') : null].filter(Boolean).join(' · ');
    if (mode) rows.push(drow(t('cd2.hikMode', 'โหมด'), escapeHtml(mode)));
    const q = [rec.codec, rec.resolution, rec.fps ? rec.fps + ' fps' : null,
               rec.bitrate_kbps ? rec.bitrate_kbps.toLocaleString() + ' kbps' : null].filter(Boolean).join(' · ');
    if (q) rows.push(drow(t('cd2.hikQuality', 'คุณภาพ'), `<span class="cm-dv-fw">${escapeHtml(q)}</span>`));
  }

  // What is actually there, kept apart from everything above.
  if (con) {
    // A looping card at 4K fills within hours, so "0 วัน" is the ordinary case
    // and reads like a fault. Below a day, say hours.
    let span = '';
    if (con.days != null && con.from && con.to) {
      span = con.days >= 1
        ? t('cd2.hikSpanD', ' · {d} วัน').replace('{d}', con.days)
        : t('cd2.hikSpanH', ' · {h} ชม.').replace('{h}',
            Math.max(1, Math.round((new Date(con.to) - new Date(con.from)) / 3600000)));
    }
    rows.push(drow(t('cd2.hikContent', 'บันทึกจริง'), con.clips > 0
      ? escapeHtml(t('cd2.hikClipsN', '{n} คลิป').replace('{n}', Number(con.clips).toLocaleString()) + span)
      : `<span style="color:var(--text-secondary)">${escapeHtml(t('cd2.hikNoClips', 'ไม่มีคลิปในการ์ด (ค้น 30 วันย้อนหลัง)'))}</span>`));
  } else if (c.recording_count != null || c.recording_data_until) {
    // Bosch has no on-card clip search, so its detail carries no `content` —
    // what footage exists comes from the ONVIF summary already on the camera
    // row. Without this the two rows the old Bosch panel did show (span and
    // segment count) would vanish the moment it started rendering here.
    const f = c.recording_data_from ? new Date(c.recording_data_from) : null;
    const u = c.recording_data_until ? new Date(c.recording_data_until) : null;
    const tz = { timeZone: 'Asia/Bangkok' };
    // 2000-01-01 is the "nothing recorded" placeholder, not a real start date.
    if (f && u && f.getFullYear() > 2015 && u > f) {
      rows.push(drow(t('cd2.sdRetention', 'ข้อมูลย้อนหลัง'), escapeHtml(
        I18N.t('cd2.sdRange').replace('{n}', Math.max(0, Math.round((u - f) / 86400000)))
          .replace('{from}', f.toLocaleDateString('th-TH', tz))
          .replace('{to}', u.toLocaleDateString('th-TH', tz)))));
    }
    if (c.recording_count != null) {
      rows.push(drow(t('cd2.sdCount', 'จำนวนไฟล์'),
        escapeHtml(I18N.t('cd2.sdSegments').replace('{n}', Number(c.recording_count).toLocaleString()))));
    }
  }
  // Only worth showing while nothing is recorded — once there is footage the
  // real span above answers the same question better than an estimate.
  if (rec && d.state !== 'no_card' && rec.days_if_enabled != null && (!con || con.clips === 0)) {
    const hrs = Math.round(rec.days_if_enabled * 24);
    rows.push(drow(t('cd2.hikIfOn', 'ถ้าเปิดบันทึก'), escapeHtml(
      hrs < 48 ? t('cd2.hikHolds.h', 'จะเก็บได้ ~{n} ชม. ก่อนเขียนทับ').replace('{n}', hrs)
               : t('cd2.hikHolds.d', 'จะเก็บได้ ~{n} วัน ก่อนเขียนทับ').replace('{n}', rec.days_if_enabled))));
  }

  // Rewrite count comes from System/status, and only means something once a card
  // has actually looped — 0 on a card nobody records to says nothing worth a row.
  // …and only when there is a card to have worn out. A rewrite count printed
  // under "no card" is the same contradiction the recording rows had.
  if (card && d.wear && d.wear.video_rewrites > 0) {
    rows.push(drow(t('cd2.hikWear', 'เขียนวนทับแล้ว'),
      escapeHtml(t('cd2.hikWearN', '{n} รอบ').replace('{n}', Number(d.wear.video_rewrites).toLocaleString()))));
  }

  // What the CAMERA says about its own deliveries — the only view of this that
  // neither we nor the receiving system produced. Ordered by volume so the
  // destination that matters is first, and dead entries are kept because "this
  // camera used to push somewhere else" is exactly what an operator wants to see.
  if (d.uploads && d.uploads.length) {
    rows.push(drow(t('cd2.hikUploads', 'การเชื่อมต่อ'),
      `<span class="cm-dv-fw">${groupUploads(d.uploads).map(u => {
        const bad = u.rate != null && u.rate < 99;
        return `<span style="display:block${u.dead ? ';opacity:.55' : ''}">` +
          `<span class="mono">${escapeHtml(u.ip || '?')}${u.port ? ':' + escapeHtml(u.port) : ''}</span> · ` +
          `<b style="color:${bad ? 'var(--warn)' : 'var(--status-ok)'}">${u.rate != null ? u.rate.toFixed(2) + '%' : '—'}</b> · ` +
          `${u.avg_ms != null ? u.avg_ms + ' ms' : '—'} · ${Number(u.total || 0).toLocaleString()} ` +
          escapeHtml(t('cd2.hikTimes', 'ครั้ง')) +
          (u.sessions > 1 ? ` · ${escapeHtml(t('cd2.hikSessN', '{n} ครั้งที่เชื่อมต่อ').replace('{n}', u.sessions))}` : '') +
          (u.dead ? ` · ${escapeHtml(t('cd2.hikEnded', 'หยุดแล้ว'))}` : '') + '</span>';
      }).join('')}</span>`));
  } else if (d.destinations && d.destinations.length) {
    // Face models: the configured list, and only that. No rate and no latency
    // because the camera keeps neither — a row shaped like the measured kind but
    // with the numbers quietly missing would read as a clean 100%. The label
    // says "ตั้งไว้ให้ส่งไป" rather than "ส่งไป" for the same reason.
    rows.push(drow(t('cd2.hikDests', 'การเชื่อมต่อที่ตั้งไว้'),
      `<span class="cm-dv-fw">${d.destinations.map(x =>
        `<span style="display:block"><span class="mono">${escapeHtml(x.host)}${x.port ? ':' + escapeHtml(x.port) : ''}</span>` +
        `${x.path && x.path !== '/' ? `<span style="color:var(--text-secondary)">${escapeHtml(x.path)}</span>` : ''}` +
        `${x.protocol ? ` · ${escapeHtml(x.protocol)}` : ''}</span>`
      ).join('')}</span>`));
  }

  // What the ANR row used to be. /ISAPI/Traffic/ANR configures an SDK arming
  // server we do not use, so it reported "not usable" while these cameras were
  // demonstrably buffering and replaying over the httpHost path every day —
  // C40-THL-SB-18 held 595 plates for 46 minutes on 2026-08-04 and delivered
  // every one of them. A row that says the opposite of the truth is worse than
  // no row, so this reports the behaviour we can actually measure: the longest
  // gap between the camera's own timestamp and ours (migration 116).
  if (c.max_hold_sec != null) {
    const s = c.max_hold_sec;
    const span = s >= 3600 ? t('cd2.holdH', '{n} ชม.').replace('{n}', (s / 3600).toFixed(1))
               : s >= 60   ? t('cd2.holdM', '{n} นาที').replace('{n}', Math.round(s / 60))
                           : t('cd2.holdS', '{n} วิ').replace('{n}', s);
    const when = c.max_hold_at
      ? new Date(c.max_hold_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })
      : null;
    // Not a storage figure despite sitting in the SD panel: it is the largest
    // gap ever seen between a camera's own event_time and our received_at
    // (mqtt-subscriber refreshCameraHold), i.e. how long it once went silent
    // and then replayed. The old label — "เคยเก็บไว้ให้นานสุด / Longest
    // buffered for us" — read like card retention and prompted exactly that
    // question. The date shown is when the backlog ARRIVED, not when the
    // outage began.
    // Hover text, because the label alone cannot say WHOSE outage it was. It is
    // almost never the camera: at vss on 2026-08-05 all seven cameras — three
    // vendors, with and without an SD card — recorded the same gap within
    // seconds of each other, and edge-bridge logged "remote offline
    // queued=50" across it. The link that dropped was edge→central, the
    // camera kept delivering to the edge throughout, and src/edge/bridgeQueue.js
    // held the backlog on disk until central came back. A card-less camera
    // shows a figure here for exactly that reason.
    rows.push(drow(t('cd2.holdCap', 'เคยหลุดนานสุด (ข้อมูลไม่หาย)'),
      `<span title="${escapeHtml(t('cd2.holdCapTip', 'ช่วงที่ข้อมูลมาถึงเราช้าที่สุด — มักเกิดจากเน็ตของไซต์หลุด ไม่ใช่ตัวกล้องเสีย ระหว่างนั้น edge เก็บข้อมูลไว้ในคิวบนดิสก์แล้วส่งตามให้ครบเมื่อกลับมา จึงไม่มีข้อมูลสูญหาย · วันที่ที่แสดงคือวันที่ได้รับของที่ค้าง ไม่ใช่วันที่เริ่มหลุด'))}">${escapeHtml(span)}</span>` +
      (when ? `<span style="color:var(--text-secondary);font-weight:500"> · ${escapeHtml(when)}</span>` : '')));
  }
  rows.push(drow(t('cd2.sdLastCheck'), escapeHtml(lastChk)));

  // Not .cm-data's auto-fit columns. That grid suits the Bosch box's four short
  // rows; this one has up to nine and mixes long values (a codec line, a
  // sentence about overwriting), and at three columns every label wrapped to two
  // lines and the order stopped reading top-to-bottom. The grouping — card,
  // then configuration, then contents — only survives in one column.
  return box(`<div class="cm-data sd-hik">${rows.join('')}</div>`);
}

function recBoxProd(c) {
  const cap = escapeHtml(I18N.t('cd2.sdTitle'));
  const vendor = (c.vendor || '').toLowerCase();
  const box = (inner) => `<div class="cm-box"><span class="cm-cap">${cap}</span>${inner}</div>`;
  const drow = (k, v) => `<div class="cm-drow"><span class="cm-dk">${escapeHtml(k)}</span><span class="cm-dv">${v}</span></div>`;
  const tz = { timeZone: 'Asia/Bangkok', hour12: false };
  const dz = { timeZone: 'Asia/Bangkok' };
  const untilDate = c.recording_data_until ? new Date(c.recording_data_until) : null;
  const fromDate = c.recording_data_from ? new Date(c.recording_data_from) : null;
  const until = untilDate ? untilDate.toLocaleString('th-TH', tz) : null;
  const lastChk = c.sd_last_check_at ? new Date(c.sd_last_check_at).toLocaleString('th-TH', tz) : '—';
  const nvrRef = c.recording_nvr_id ? cameras.find(x => x.camera_id === c.recording_nvr_id) : null;
  const nvrName = nvrRef?.camera_name || c.recording_nvr_id || null;
  // Hikvision reports its own storage over three ISAPI documents (migration 115,
  // collected hourly by the edge). The panel below is deliberately split into
  // "how it is configured" and "what is actually on it": every Phuket card
  // answers the first document like a working camera and has recorded nothing,
  // and a layout that mixed the two would keep hiding exactly that.
  // Bosch joins this path once its RCP+ probe has landed a detail (BS1,
  // 2026-08-06): same renderer, because helpers/boschRcp.js deliberately emits
  // the same shape. A Bosch camera whose probe has not run yet — or whose model
  // refuses the registers — has no sd_detail and falls through to the ONVIF-only
  // panel below, exactly as before.
  if ((vendor === 'hikvision' || vendor === 'bosch') && c.sd_detail) return recBoxHik(c, box, drow, lastChk);
  if (vendor !== 'bosch') {
    // Non-Bosch storage-health pilot (Dahua NVR, 2026-07-19) — these cameras have no
    // ONVIF recording-summary concept (no dataUntil/count), just a health flag from
    // storageDevice.cgi. Cameras never probed (sd_status still null) fall through to
    // the generic "not supported" message below, unchanged.
    if (c.sd_status === 'ok') {
      const nvrMsg = nvrName
        ? escapeHtml(I18N.t('cd2.sdViaNvrNamed').replace('{n}', nvrName))
        : escapeHtml(I18N.t('cd2.sdViaNvr'));
      return box(
        `<div class="cm-data">${drow(I18N.t('cd2.recStatus'), `<span class="sd-led ok"></span><span style="color:var(--status-ok)">${escapeHtml(I18N.t('cd2.sdOk'))}</span>`)}${drow(I18N.t('cd2.sdLastCheck'), escapeHtml(lastChk))}</div>`
        + `<div class="cm-rec-na">${nvrMsg}</div>`
      );
    }
    if (c.sd_status === 'unreachable') {
      return box(
        `<div class="cm-data">${drow(I18N.t('cd2.recStatus'), `<span class="sd-led bad"></span><span style="color:var(--status-bad)">${escapeHtml(I18N.t('cd2.sdFault'))}</span>`)}</div>`
        + `<div class="cm-rec-na warn">${escapeHtml(I18N.t('cd2.sdFaultNote'))}</div>`
      );
    }
    return box(`<div class="cm-rec-na">${escapeHtml(I18N.t('cd2.sdNa').replace('{v}', VENDOR_LABEL_CD[vendor] || c.vendor || '—'))}</div>`);
  }
  if (c.sd_status === 'edge-site') {
    // Edge reports SD status via its own hourly ONVIF probe (piggybacked on the
    // heartbeat MQTT channel) — 'edge-site' is only the placeholder before that
    // first report lands. If we still have a last-known reading from before
    // (or from a still-pending refresh), show it instead of just "can't check".
    const lastKnown = untilDate
      ? `<div class="cm-data">${drow(I18N.t('cd2.sdRetention'), escapeHtml(I18N.t('cd2.sdUntil').replace('{t}', until)))}${drow(I18N.t('cd2.sdLastCheck'), escapeHtml(lastChk))}</div>`
      : '';
    return box(lastKnown + `<div class="cm-rec-na">${escapeHtml(I18N.t('cd2.sdEdge'))}</div>`);
  }
  if (c.sd_status === 'unreachable') {
    return box(
      `<div class="cm-data">${drow(I18N.t('cd2.sdStatus'), `<span class="sd-led bad"></span><span style="color:var(--status-bad)">${escapeHtml(I18N.t('cd2.sdFault'))}</span>`)}</div>`
      + `<div class="cm-rec-na warn">${escapeHtml(I18N.t('cd2.sdFaultNote'))}</div>`
    );
  }

  // sd_status='ok' only means ONVIF GetRecordingSummary returned a DataUntil —
  // NOT that a card is present. A camera with no card (or an empty card) still
  // answers with an epoch placeholder (2000-01-01) and 0 recordings. We can't
  // tell "no card" from "empty card" via ONVIF, so label it "no recordings".
  const hasRecordings = Number(c.recording_count) > 0 && untilDate && untilDate.getFullYear() > 2015;
  if (!hasRecordings) {
    return box(
      `<div class="cm-data">`
      + drow(I18N.t('cd2.sdStatus'), `<span class="sd-led warn"></span><span style="color:var(--warn)">${escapeHtml(I18N.t('cd2.sdEmpty'))}</span>`)
      + drow(I18N.t('cd2.sdLastCheck'), escapeHtml(lastChk))
      + `</div>`
      + `<div class="cm-rec-na">${escapeHtml(I18N.t('cd2.sdEmptyNote'))}</div>`
    );
  }

  // Show the full from→until span only when from is a real date (Bosch reports
  // a 2000-01-01 placeholder when no footage) — otherwise fall back to until.
  let retentionVal;
  if (fromDate && untilDate && fromDate.getFullYear() > 2015 && untilDate > fromDate) {
    const days = Math.max(0, Math.round((untilDate - fromDate) / 86400000));
    retentionVal = escapeHtml(I18N.t('cd2.sdRange')
      .replace('{n}', days)
      .replace('{from}', fromDate.toLocaleDateString('th-TH', dz))
      .replace('{to}', untilDate.toLocaleDateString('th-TH', dz)));
  } else {
    retentionVal = until ? escapeHtml(I18N.t('cd2.sdUntil').replace('{t}', until)) : escapeHtml(I18N.t('cd2.sdNoData'));
  }
  const recNow = c.recording
    ? `<span style="color:var(--status-ok)">${escapeHtml(I18N.t('cd2.sdRecYes'))}</span>`
    : `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('cd2.sdRecNo'))}</span>`;
  return box(`<div class="cm-data">
    ${drow(I18N.t('cd2.sdStatus'), `<span class="sd-led ok"></span><span style="color:var(--status-ok)">${escapeHtml(I18N.t('cd2.sdOk'))}</span>`)}
    ${drow(I18N.t('cd2.sdRec'), recNow)}
    ${drow(I18N.t('cd2.sdRetention'), retentionVal)}
    ${drow(I18N.t('cd2.sdCount'), c.recording_count != null ? escapeHtml(I18N.t('cd2.sdSegments').replace('{n}', Number(c.recording_count).toLocaleString())) : escapeHtml(I18N.t('cd2.sdNoData')))}
    ${drow(I18N.t('cd2.sdLastCheck'), escapeHtml(lastChk))}
  </div>`);
}

// Incremental update of Camera Status cards — patches stats numbers + status
// badge in place without rebuilding the DOM. The full-rebuild path
// (renderCameraGrid) was being called from every WS event and every 60s
// today-counts refresh, which (a) is wasteful at 100+ cards and (b) used
// to silently no-op anyway because the call site referenced a
// `renderCameras` symbol that doesn't exist. Falls through to the full
// render when the visible camera set has changed (add/remove/search/group)
// since structural edits are still cheaper than diffing DOM trees.
// Incremental patch of visible cards on WS events / 60s refresh — updates
// stats + status without reloading snapshots. Mirrors renderCameraGrid's
// filter+pagination via _camStatusFiltered; structural change → full render.
function updateCameraGridStats() {
  const grid = document.getElementById('cameraGrid');
  if (!grid || !grid.querySelector('.cam-card')) { renderCameraGrid(); return; }
  const camsList = _camStatusFiltered();
  const slice = camsList.slice((_camGridPage - 1) * CAM_GRID_PAGE_SIZE, _camGridPage * CAM_GRID_PAGE_SIZE);
  const cardById = {};
  for (const card of grid.querySelectorAll('.cam-card[data-camera-id]')) cardById[card.dataset.cameraId] = card;
  const visibleIds = slice.map(c => c.camera_id);
  if (visibleIds.length !== Object.keys(cardById).length || visibleIds.some(id => !cardById[id])) {
    renderCameraGrid();
    return;
  }
  for (const c of slice) {
    const card = cardById[c.camera_id];
    if (!card) continue;
    const info = card.querySelector('.card-info');
    if (info) info.outerHTML = buildCardInfo(c);
    const prev = card.querySelector('.card-preview');
    if (prev) {
      prev.querySelectorAll('.preview-ts, .preview-count, .preview-overlay').forEach(e => e.remove());
      prev.insertAdjacentHTML('beforeend', buildPreviewDynamic(c));
    }
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

// ยิงเฉพาะตอนหน้า Camera Status เปิดอยู่และแท็บไม่ถูกซ่อน — ข้อมูลนี้ใช้ที่หน้านั้นหน้าเดียว และการเข้าหน้า
// เรียก refreshTodayCounts() เองอยู่แล้ว · เดิมยิงทุก 60 วิทุกแท็บทุกหน้าตลอดเวลา (stop… ไม่มีใครเรียก)
// จน /api/stats/today-counts เป็น route ช้าที่ถูกเรียกบ่อยสุด 244 ครั้ง/สัปดาห์ (audit 2026-10-02 · O1)
function startTodayCountsAutoRefresh() {
  if (_todayCountsTimer) return;
  _todayCountsTimer = setInterval(() => {
    if (document.hidden || !document.getElementById('page-cameras')?.classList.contains('active')) return;
    refreshTodayCounts();
  }, 60_000);
}

function stopTodayCountsAutoRefresh() {
  if (_todayCountsTimer) { clearInterval(_todayCountsTimer); _todayCountsTimer = null; }
}

// Summary chip bar (replaces the old KPI grid) — site-scoped overview.
function updateKPIs() {
  const el = document.getElementById('camSummaryBar');
  if (!el) return;
  const base = _activeSiteId ? cameras.filter(c => c.site_id === _activeSiteId) : cameras;
  const online = base.filter(c => c.status === 'online').length;
  const offline = base.filter(c => c.status === 'offline').length;
  const paused = base.filter(c => c.status === 'paused').length;
  el.innerHTML =
    `<div class="sum-chip total">${escapeHtml(I18N.t('cam.sumTotal').replace('{n}', base.length))}</div>`
    + `<div class="sum-chip online"><span class="sdot"></span>${escapeHtml(I18N.t('cam.sumOnline').replace('{n}', online))}</div>`
    + `<div class="sum-chip offline"><span class="sdot"></span>${escapeHtml(I18N.t('cam.sumOffline').replace('{n}', offline))}</div>`
    + (paused ? `<div class="sum-chip paused"><span class="sdot"></span>${escapeHtml(I18N.t('cam.sumMaint').replace('{n}', paused))}</div>` : '');
}
