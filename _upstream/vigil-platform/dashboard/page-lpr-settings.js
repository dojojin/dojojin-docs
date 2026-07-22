// ============================================================
// Vigil Platform — Settings › LPR (RF4 gate config)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Lives in the Settings workspace (#set-lpr) — the single home for all settings.
// Operator defines entry/exit gates: each gate maps the camera's lanes to a
// direction (เข้า/ออก/ไม่นับ). Stored via /api/lpr/gates. Consumption (direction
// stats/chart, gate filter) is a later increment (RF5). CSP-safe: every control
// dispatches through data-action / data-input / data-change (ACTION_MAP).
// ============================================================

const _LPR_LANES = ['1', '2', '3'];        // real laneNo values (HIK-V_LPR01)
const _LPR_DIRS  = ['in', 'out', 'none'];
let _lprGates = [];
let _lprSettingsCams = [];
let _lprSceneCfg = { resolution: '1080p', quality: 80 };
let _lprRetCfg = { image: 7, meta: 30 };

function _lprsT(k, fb) { return (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, fb) : fb; }
function _lprDirLabel(v) {
  return v === 'in'  ? _lprsT('lprset.dirIn', 'เข้า')
       : v === 'out' ? _lprsT('lprset.dirOut', 'ออก')
       :               _lprsT('lprset.dirNone', 'ไม่นับ');
}

async function loadLprSettings() {
  const el = document.getElementById('lprGateList');
  if (!el) return;
  el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:10px 0">${_lprsT('common.loading', 'กำลังโหลด...')}</div>`;
  try {
    const [gRes, cRes, vRes, sRes, stRes] = await Promise.all([
      fetch(`${API}/api/lpr/gates`),
      fetch(`${API}/api/cameras`).catch(() => null),
      fetch(`${API}/api/lpr/vehicle-types`).catch(() => null),
      fetch(`${API}/api/lpr/scene-image`).catch(() => null),
      fetch(`${API}/api/settings`).catch(() => null),
    ]);
    _lprGates = gRes.ok ? await gRes.json() : [];
    _lprSettingsCams = (cRes && cRes.ok) ? await cRes.json() : (window.cameras || []);
    _lprVtCfg = (vRes && vRes.ok) ? (await vRes.json() || {}) : {};
    _lprSceneCfg = (sRes && sRes.ok) ? await sRes.json() : { resolution: '1080p', quality: 80 };
    const st = (stRes && stRes.ok) ? await stRes.json() : {};
    _lprRetCfg = {
      image: parseInt(st.lpr_image_retention_days?.value, 10) || 7,
      meta:  parseInt(st.lpr_retention_days?.value, 10) || 30,
    };
  } catch {
    _lprGates = []; _lprSettingsCams = window.cameras || []; _lprVtCfg = {};
    _lprSceneCfg = { resolution: '1080p', quality: 80 };
    _lprRetCfg = { image: 7, meta: 30 };
  }
  _renderLprGates();
  _renderLprVtypes();
  _renderLprScene();
  _renderLprRetention();
  _renderLprDir();
  // RF2 — watchlist management lives here now (functions in page-lpr.js, global)
  if (typeof _renderWlGroupMgr === 'function') _renderWlGroupMgr();
  if (typeof _renderWatchlist === 'function') _renderWatchlist();  // fills form selects + group bar + editable list
}

function _lprCamOptions(selected) {
  const opts = [`<option value="">${_lprsT('lprset.anyCam', '— เลือกกล้อง —')}</option>`];
  for (const c of _lprSettingsCams) {
    const id = c.camera_id || c.id;
    const nm = c.camera_name || c.name || id;
    opts.push(`<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(nm)}</option>`);
  }
  return opts.join('');
}

function _lprGateCard(g) {
  const rules = g.rules || {};
  const lanes = _LPR_LANES.map(ln => `
    <div class="lpr-gate-lane">
      <span class="lpr-gate-lanelbl">${_lprsT('lprset.lane', 'เลน')} ${ln}</span>
      <div class="lpr-gate-dirs">
        ${_LPR_DIRS.map(v => `<button type="button" class="lpr-dir-btn${(rules[ln] || 'none') === v ? ' active' : ''}" data-action="lprGateRule" data-gid="${g.id}" data-lane="${ln}" data-v="${v}">${_lprDirLabel(v)}</button>`).join('')}
      </div>
    </div>`).join('');
  return `
    <div class="lpr-gate" data-gid="${g.id}">
      <div class="lpr-gate-head">
        <input class="form-input lpr-gate-name" value="${escapeHtml(g.name || '')}" data-input="lprGateName" data-gid="${g.id}" placeholder="${_lprsT('lprset.gateName', 'ชื่อจุด')}">
        <select class="form-input lpr-gate-cam" data-change="lprGateCamera" data-gid="${g.id}">${_lprCamOptions(g.camera_id)}</select>
        <button type="button" class="btn btn-secondary lpr-gate-del" data-action="lprGateDelete" data-gid="${g.id}">${_lprsT('common.delete', 'ลบ')}</button>
      </div>
      <div class="lpr-gate-lanes">${lanes}</div>
    </div>`;
}

function _renderLprGates() {
  const el = document.getElementById('lprGateList');
  if (!el) return;
  el.innerHTML = _lprGates.length
    ? _lprGates.map(_lprGateCard).join('')
    : `<div style="color:var(--text-secondary);font-size:13px;padding:14px 0">${_lprsT('lprset.noGates', 'ยังไม่มีจุดเข้า-ออก — กดเพิ่มจุด')}</div>`;
}

async function lprGateAdd() {
  try {
    const r = await fetch(`${API}/api/lpr/gates`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: _lprsT('lprset.newGate', 'จุดใหม่'), rules: { '1': 'none', '2': 'none', '3': 'none' } }),
    });
    if (r.ok) { _lprGates.push(await r.json()); _renderLprGates(); }
  } catch (e) { console.error('[lpr-settings] add gate:', e.message); }
}

async function lprGateDelete(el) {
  const gid = el.dataset.gid;
  if (!confirm(_lprsT('lprset.delConfirm', 'ลบจุดนี้?'))) return;
  try {
    await fetch(`${API}/api/lpr/gates/${gid}`, { method: 'DELETE' });
    _lprGates = _lprGates.filter(g => g.id !== gid);
    _renderLprGates();
  } catch (e) { console.error('[lpr-settings] delete gate:', e.message); }
}

async function lprGateRule(el) {
  const { gid, lane, v } = el.dataset;
  const g = _lprGates.find(x => x.id === gid); if (!g) return;
  g.rules = g.rules || {}; g.rules[lane] = v;
  _renderLprGates();   // optimistic — update active state immediately
  try {
    await fetch(`${API}/api/lpr/gates/${gid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: g.rules }) });
  } catch (e) { console.error('[lpr-settings] rule:', e.message); }
}

// debounced name save (data-input fires per keystroke)
let _lprNameTimers = {};
function lprGateName(el) {
  const gid = el.dataset.gid;
  const g = _lprGates.find(x => x.id === gid); if (!g) return;
  g.name = el.value;
  clearTimeout(_lprNameTimers[gid]);
  _lprNameTimers[gid] = setTimeout(() => {
    fetch(`${API}/api/lpr/gates/${gid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: g.name || _lprsT('lprset.newGate', 'จุดใหม่') }) })
      .catch(e => console.error('[lpr-settings] name:', e.message));
  }, 500);
}

async function lprGateCamera(el) {
  const gid = el.dataset.gid;
  const g = _lprGates.find(x => x.id === gid); if (!g) return;
  g.camera_id = el.value;
  try {
    await fetch(`${API}/api/lpr/gates/${gid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ camera_id: g.camera_id }) });
  } catch (e) { console.error('[lpr-settings] camera:', e.message); }
}

// ── Vehicle-type display config — toggle visibility + label override ──────────
// Known code set + default Thai labels (mirror page-lpr.js _LPR_VTYPE primaries).
const _LPR_VT_PRIMARY = [
  ['twoWheelVehicle',   'จักรยานยนต์'],
  ['threeWheelVehicle', 'รถสามล้อ'],
  ['SUVMPV',            'รถอเนกประสงค์ (SUV/MPV)'],
  ['van',               'รถตู้'],
  ['pickupTruck',       'รถกระบะ'],
  ['truck',             'รถบรรทุก'],
  ['vehicle',           'รถยนต์'],
  ['buggy',             'รถเล็ก/บักกี้'],
  ['largeBus',          'รถบัส'],
  ['pedestrian',        'คนเดินเท้า'],
];
let _lprVtCfg = {};
let _lprVtSaveTimer = null;

function _renderLprVtypes() {
  const el = document.getElementById('lprVtypeList');
  if (!el) return;
  el.innerHTML = _LPR_VT_PRIMARY.map(([code, def]) => {
    const c = _lprVtCfg[code] || {};
    const on = c.on !== false;   // default on
    return `
      <div class="lpr-vt-row">
        <label class="lpr-vt-toggle"><input type="checkbox"${on ? ' checked' : ''} data-change="lprVtypeToggle" data-code="${code}"><span>${escapeHtml(def)}</span></label>
        <input class="form-input lpr-vt-label" value="${escapeHtml(c.label || '')}" placeholder="${escapeHtml(def)}" data-input="lprVtypeLabel" data-code="${code}">
      </div>`;
  }).join('');
}

function _saveLprVtypes() {
  fetch(`${API}/api/lpr/vehicle-types`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(_lprVtCfg) })
    .catch(e => console.error('[lpr-settings] save vtypes:', e.message));
}

function lprVtypeToggle(el) {
  const code = el.dataset.code;
  _lprVtCfg[code] = _lprVtCfg[code] || {};
  _lprVtCfg[code].on = el.checked;
  _saveLprVtypes();
}

function lprVtypeLabel(el) {
  const code = el.dataset.code;
  _lprVtCfg[code] = _lprVtCfg[code] || {};
  _lprVtCfg[code].label = el.value;
  clearTimeout(_lprVtSaveTimer);
  _lprVtSaveTimer = setTimeout(_saveLprVtypes, 500);
}

// ── RF5: per-camera LPR direction ───────────────────────────────────
// With many LPR cameras the flat list got unreadably long. Section it by site
// (collapsible, with a per-site in/out/unset summary), plus a name search and an
// "unset only" filter, so onboarding a site's cameras stays manageable.
let _lprDirSearch = '';
let _lprDirUnsetOnly = false;
const _lprDirCollapsed = new Set();   // site keys the user has collapsed

function _renderLprDir() {
  const el = document.getElementById('lprDirList');
  if (!el) return;
  const cams = (_lprSettingsCams || []).filter(c => c.cam_role === 'lpr' || (String(c.vendor || '').toLowerCase() === 'hikvision' && c.push_only));
  if (!cams.length) {
    el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:14px 0">${_lprsT('lprset.dirNoCam', 'ยังไม่มีกล้อง LPR')}</div>`;
    return;
  }
  const opts = [['in', _lprsT('lprset.dirIn', 'เข้า')], ['out', _lprsT('lprset.dirOut', 'ออก')], ['', _lprsT('lprset.dirUnset', 'ไม่กำหนด')]];
  const q = _lprDirSearch.trim().toLowerCase();
  const passFilter = (c) => {
    if (_lprDirUnsetOnly && c.lpr_direction) return false;
    if (q && !String(c.camera_name || c.name || c.camera_id || c.id || '').toLowerCase().includes(q)) return false;
    return true;
  };
  const rowHtml = (c) => {
    const id = c.camera_id || c.id;
    const cur = c.lpr_direction || '';
    return `<div class="lpr-dir-row${cur ? '' : ' unset'}">
      <span class="lpr-dir-name">${escapeHtml(c.camera_name || c.name || id)}</span>
      <div class="lpr-dir-btns">
        ${opts.map(([v, lbl]) => `<button type="button" class="lpr-dir-btn${cur === v ? ' active' : ''}" data-action="lprSetDir" data-id="${escapeHtml(id)}" data-v="${v}">${lbl}</button>`).join('')}
      </div></div>`;
  };

  const sites = (typeof _sites !== 'undefined' && Array.isArray(_sites)) ? _sites : [];
  const siteMap = new Map(sites.map(s => [s.id, s]));
  const noMatch = `<div style="color:var(--text-secondary);font-size:13px;padding:14px 0">${_lprsT('lprset.dirNoMatch', 'ไม่พบกล้องที่ตรงกับตัวกรอง')}</div>`;

  // Single-site deploy → plain filtered list (no section headers).
  if (siteMap.size <= 1) {
    const shown = cams.filter(passFilter);
    el.innerHTML = shown.length ? shown.map(rowHtml).join('') : noMatch;
    return;
  }

  // Multi-site → collapsible per-site sections with an in/out/unset summary.
  const bySite = new Map();
  for (const c of cams) { const k = c.site_id != null ? c.site_id : '__none__'; if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(c); }
  const camUnit = _lprsT('lprset.dirCamUnit', 'กล้อง');
  const section = (siteKey, list) => {
    const shown = list.filter(passFilter);
    if (!shown.length) return '';   // nothing under the current filter → hide this site
    const site = siteMap.get(siteKey);
    const label = site ? site.name : _lprsT('lprset.dirNoSite', 'ไม่ระบุ Site');
    const dot = site && site.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${site.color};margin:0 6px 0 2px"></span>` : '';
    const inN = list.filter(c => c.lpr_direction === 'in').length;
    const outN = list.filter(c => c.lpr_direction === 'out').length;
    const unsetN = list.filter(c => !c.lpr_direction).length;
    const collapsed = _lprDirCollapsed.has(String(siteKey));
    const warn = unsetN > 0 ? ' <span style="color:var(--warn)">⚠</span>' : '';
    const summary = _lprsT('lprset.dirSummary', '{in} เข้า · {out} ออก · {unset} ยังไม่ตั้ง')
      .replace('{in}', inN).replace('{out}', outN).replace('{unset}', unsetN);
    return `<div class="lpr-dir-site">
      <div class="lpr-dir-site-hd" data-action="lprDirToggleSite" data-sk="${escapeHtml(String(siteKey))}">
        <span class="lpr-dir-site-name">${collapsed ? '▸' : '▾'} ${dot}${escapeHtml(label)} · ${list.length} ${camUnit}</span>
        <span class="lpr-dir-summary">${summary}${warn}</span>
      </div>
      ${collapsed ? '' : `<div class="lpr-dir-site-body">${shown.map(rowHtml).join('')}</div>`}
    </div>`;
  };
  let html = '';
  for (const s of sites) { const list = bySite.get(s.id); if (list) html += section(s.id, list); }
  const none = bySite.get('__none__'); if (none) html += section('__none__', none);
  el.innerHTML = html || noMatch;
}

function lprDirSearch(el) { _lprDirSearch = el.value || ''; _renderLprDir(); }
function lprDirUnsetToggle(el) { _lprDirUnsetOnly = !!el.checked; _renderLprDir(); }
function lprDirToggleSite(el) {
  const k = el.dataset.sk;
  if (_lprDirCollapsed.has(k)) _lprDirCollapsed.delete(k); else _lprDirCollapsed.add(k);
  _renderLprDir();
}

async function lprSetDir(el) {
  const { id, v } = el.dataset;
  try {
    const r = await fetch(`${API}/api/lpr/camera-direction`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ camera_id: id, direction: v || null }),
    });
    if (!r.ok) throw new Error('save failed');
    const cam = (_lprSettingsCams || []).find(c => (c.camera_id || c.id) === id);
    if (cam) cam.lpr_direction = v || null;
    _renderLprDir();
  } catch (e) { console.error('[lpr-settings] set direction:', e.message); }
}

// ── RF-IMG: scene-image downscale settings ──────────────────────────
function _renderLprScene() {
  const sel = document.getElementById('lprSceneRes');
  const q   = document.getElementById('lprSceneQ');
  if (sel) sel.value = _lprSceneCfg.resolution || '1080p';
  if (q)   q.value   = _lprSceneCfg.quality || 80;
}

// ── RF4 follow-up: LPR retention settings (backend validators existed since
// RF4; this UI was the missing piece). PUT /api/settings/:key per key.
function _renderLprRetention() {
  const img = document.getElementById('lprRetImg');
  const meta = document.getElementById('lprRetMeta');
  if (img)  img.value  = _lprRetCfg.image;
  if (meta) meta.value = _lprRetCfg.meta;
}

async function lprRetentionSave() {
  const img  = parseInt(document.getElementById('lprRetImg')?.value, 10);
  const meta = parseInt(document.getElementById('lprRetMeta')?.value, 10);
  const msg  = document.getElementById('lprRetMsg');
  if (!(img >= 1 && img <= 730) || !(meta >= 1 && meta <= 730)) {
    if (msg) msg.textContent = _lprsT('lprset.retRange', 'ค่าต้องอยู่ระหว่าง 1-730 วัน');
    return;
  }
  try {
    for (const [key, value] of [['lpr_image_retention_days', img], ['lpr_retention_days', meta]]) {
      const r = await fetch(`${API}/api/settings/${key}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: String(value) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'save failed');
    }
    _lprRetCfg = { image: img, meta: meta };
    _renderLprRetention();
    if (msg) msg.textContent = img > meta
      ? _lprsT('lprset.retCapped', 'บันทึกแล้ว · อายุรูปจะถูกลดให้ไม่เกินอายุข้อมูลตอนลบจริง')
      : _lprsT('lprset.retSaved', 'บันทึกแล้ว · มีผลรอบลบถัดไป (วันละครั้ง)');
  } catch (e) {
    console.error('[lpr-settings] save retention:', e.message);
    if (msg) msg.textContent = _lprsT('common.saveError', 'บันทึกไม่สำเร็จ');
  }
}

async function lprSceneSave() {
  const resolution = document.getElementById('lprSceneRes')?.value || '1080p';
  let quality = parseInt(document.getElementById('lprSceneQ')?.value, 10);
  if (!(quality >= 60 && quality <= 95)) quality = 80;
  const msg = document.getElementById('lprSceneMsg');
  try {
    const r = await fetch(`${API}/api/lpr/scene-image`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution, quality }),
    });
    if (!r.ok) throw new Error('save failed');
    _lprSceneCfg = await r.json();
    _renderLprScene();
    if (msg) msg.textContent = _lprsT('lprset.sceneSaved', 'บันทึกแล้ว · มีผลกับภาพใหม่ภายใน ~1 นาที');
  } catch (e) {
    console.error('[lpr-settings] save scene-image:', e.message);
    if (msg) msg.textContent = _lprsT('common.saveError', 'บันทึกไม่สำเร็จ');
  }
}
