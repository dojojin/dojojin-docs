// ============================================================
// Vigil Platform — Camera Settings
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================


// ============================================================
// Camera Settings Modal (existing)
// ============================================================

// ── Camera form mini-map (OpenLayers) ───────────────────────
let _camFormMap = null;
let _camFormMarker = null;
const _CAM_FORM_DEFAULT_CENTER = [100.5018, 13.7563]; // Bangkok fallback

let _camSites = null;
async function _loadCamSites() {
  if (_camSites) return _camSites;
  try { const r = await fetch(`${API}/api/sites`); _camSites = r.ok ? await r.json() : []; }
  catch { _camSites = []; }
  return _camSites;
}

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
  if (!navigator.geolocation) { if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = I18N.t('cs.locationDenied'); } return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById('frmCamLat').value = lat;
      document.getElementById('frmCamLng').value = lng;
      if (msg) msg.textContent = '';
      onCamCoordInput();
    },
    () => { if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = I18N.t('cs.locationDenied'); } }
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
  span.style.color  = _mqttPassVisible ? 'var(--warn)' : 'var(--text-secondary)';
  btn.textContent   = _mqttPassVisible ? I18N.t('cs.hidePass') : I18N.t('cs.showPass');
}

function _resetMqttPassDisplay() {
  _mqttPassVisible = false;
  const span = document.getElementById('mqttCredsPassVal');
  if (span) { span.textContent = '••••••••••••••••'; span.style.color = 'var(--text-secondary)'; }
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
  if (!val) { if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = '—'; setTimeout(() => { if (msg) msg.textContent = ''; }, 1500); } return; }
  navigator.clipboard.writeText(val).then(() => {
    if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('cs.mqttCopied'); setTimeout(() => { if (msg) msg.textContent = ''; }, 2000); }
  }).catch(() => {
    if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = val; }
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
  result.textContent = ''; result.style.color = 'var(--text-secondary)';
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await fetch(`${API}/api/cameras/test-connection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip_address: ip, http_port: port, vendor, username: user, password: pass }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    // CS5: advisory ingest recommendation (Hikvision Pull/Push). Reachable →
    // recommend Pull, unreachable → recommend Push (cross-site/NAT/ANPR). Text
    // only — never moves the radio: test-connection is a reachability proxy and
    // a transient blip must not flip a working camera's mode (decision #146).
    if (vendor.toLowerCase() === 'hikvision') _setIngestRec(r.reachable);
    if (!r.reachable) {
      result.style.color = 'var(--status-bad)';
      result.textContent = I18N.t('cs.connFail');
    } else if (r.auth_status === 'failed') {
      result.style.color = 'var(--warn)';
      result.textContent = I18N.t('cs.connReachAuthFail').replace('{ms}', r.latency_ms);
    } else {
      result.style.color = 'var(--status-ok)';
      result.textContent = I18N.t('cs.connOk').replace('{ms}', r.latency_ms);
    }
  } catch (e) {
    result.style.color = 'var(--status-bad)'; result.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = I18N.t('cs.testConnBtn');
  }
}

// ── LPR forward endpoint: save + reachability test ───────────
// "บันทึก + ทดสอบ" — persists the camera first (so the forward URL is the real
// config the receiver uses), then probes the endpoint. Reports the RAW HTTP status
// honestly — does NOT diagnose path-vs-IP (a wrong path AND an IP-block can both
// return 403 on CIB). Proves "reachable + answers", not "a real ANPR push will be
// accepted". The save does NOT close the form (unlike the main Save button) so the
// result stays visible next to the button.
async function testForwardConnection() {
  const btn    = document.getElementById('frmFwdTestBtn');
  const result = document.getElementById('frmFwdTestResult');
  const data   = _collectCamData();
  const url    = (data.lpr_forward_url || '').trim();
  if (!data.camera_id || !data.ip_address) { result.style.color = 'var(--status-bad)'; result.textContent = I18N.t('cs.needIdIp'); return; }
  if (!url) { result.style.color = 'var(--text-secondary)'; result.textContent = I18N.t('cs.fwdTestNoUrl', 'ใส่ URL ก่อน'); return; }
  result.textContent = ''; btn.disabled = true; btn.textContent = I18N.t('cs.saving', 'บันทึก...');
  try {
    // 1) Persist (upsert) so the URL becomes the camera's real forward config.
    const sres = await fetch(`${API}/api/cameras`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (sres.status === 409) { result.style.color = 'var(--warn)'; result.textContent = I18N.t('cs.fwdTestSaveWarn', 'กรุณากดปุ่ม Save ก่อน (มีคำเตือนให้ยืนยัน)'); return; }
    const sr = await sres.json();
    if (!sres.ok) { result.style.color = 'var(--status-bad)'; result.textContent = (sr.error === 'lpr_forward_url_invalid' ? I18N.t('cs.fwdUrlInvalid') : (sr.error || `HTTP ${sres.status}`)); return; }
    await loadCameras(); _populateCamLocations(); renderAdminCameras();

    // 2) Probe the now-saved endpoint.
    btn.textContent = I18N.t('cs.fwdTesting', 'ทดสอบ...');
    const tres = await fetch(`${API}/api/cameras/lpr-forward-test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const r = await tres.json();
    const saved = (I18N.t('cs.fwdSaved', 'บันทึกแล้ว')) + ' · ';
    if (!tres.ok) {
      result.style.color = 'var(--status-bad)';
      result.textContent = saved + I18N.t('cs.fwdTestBadUrl', 'URL ไม่ถูกต้อง') + (r.error ? ` (${r.error})` : '');
    } else if (!r.reachable) {
      result.style.color = 'var(--status-bad)';
      result.textContent = saved + I18N.t('cs.fwdTestUnreach', 'เชื่อมต่อไม่ได้ (host/port/เน็ต): {err}').replace('{err}', r.error || '?');
    } else {
      const ok2xx = r.status >= 200 && r.status < 300;
      result.style.color = ok2xx ? 'var(--status-ok)' : 'var(--warn)';
      result.textContent = saved + (ok2xx
        ? I18N.t('cs.fwdTestOk', 'ถึงปลายทาง ✓ — HTTP {status} ({ms}ms)')
        : I18N.t('cs.fwdTestNon2xx', 'ถึงปลายทาง — HTTP {status} (ปลายทางตอบปฏิเสธ/ผิดพลาด, {ms}ms)')
      ).replace('{status}', r.status).replace('{ms}', r.latency_ms);
    }
  } catch (e) {
    result.style.color = 'var(--status-bad)';
    result.textContent = (I18N.t('cs.fwdTestErr', 'ทดสอบไม่สำเร็จ')) + ': ' + (e.message || e);
  } finally {
    btn.disabled = false; btn.textContent = I18N.t('cs.fwdTestBtn', 'บันทึก + ทดสอบ');
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
  msg.textContent = ''; msg.style.color = 'var(--text-secondary)';
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
      msg.style.color = 'var(--status-ok)'; msg.textContent = r.snapshot_path || '';
      // Auto-fill snapshot path field if it was empty
      const spFld = document.getElementById('frmCamSnapPath');
      if (spFld && !snapPath && r.snapshot_path) {
        spFld.value = r.snapshot_path; spFld.disabled = false;
        const pmsg = document.getElementById('frmCamProbeMsg');
        if (pmsg) { pmsg.style.color = 'var(--status-ok)'; pmsg.textContent = I18N.t('cs.probeFound').replace('{path}', r.snapshot_path); }
      }
    } else {
      msg.style.color = 'var(--warn)'; msg.textContent = I18N.t('cs.previewNotFound');
    }
  } catch (e) {
    msg.style.color = 'var(--status-bad)'; msg.textContent = e.message;
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

// ── Camera list: search + filter + pagination (CS3) ──────────
// The admin camera list scales to thousands of cameras (HARDWARE_SIZING
// G5 = 3000). render-all is not practical, so we paginate client-side
// (the whole `cameras` array is already in memory). Filtering + paging
// are PURE helpers (no globals) so they can be node-tested headless.
let _camPage = 1;
const CAM_PAGE_SIZE = 25;
let _camFiltersWired = false;

// Pure: filter `list` by {q, vendor, status, loc} then slice to `page`.
// Returns { rows, total, page } — `page` is clamped to a valid range.
function _filterPaginate(list, f, page, pageSize) {
  const q = (f.q || '').trim().toLowerCase();
  const vendor = (f.vendor || '').toLowerCase();
  const status = f.status || '';
  const loc = f.loc || '';
  const filtered = (list || []).filter(c => {
    if (f.site && c.site_id !== f.site) return false;
    if (vendor && String(c.vendor || 'bosch').toLowerCase() !== vendor) return false;
    if (status && (c.status || '') !== status) return false;
    if (f.type && (c.cam_role || 'standard') !== f.type) return false;
    if (loc && (c.location || '') !== loc) return false;
    if (q) {
      const hay = `${c.camera_name || ''} ${c.camera_id || ''} ${c.ip_address || ''} ${c.location || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page | 0 || 1), pages);
  const start = (p - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), total, page: p };
}

// Pure: distinct non-empty location_label values, sorted.
function _camDistinctLocations(list) {
  const set = new Set();
  (list || []).forEach(c => { const l = (c.location || '').trim(); if (l) set.add(l); });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Read the current filter values from the toolbar (safe if not rendered yet).
function _camFilterValues() {
  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  return { q: val('camSearch'), vendor: val('camFilterVendor'), status: val('camFilterStatus'), type: val('camFilterType'), loc: val('camFilterLoc'), site: _camActiveSiteId };
}

// Site filter pills (admin table) — mirrors the site scoping on the data pages.
let _camActiveSiteId = null;   // null = ทุก Site
function _renderCamSitePills() {
  const el = document.getElementById('camSitePills');
  if (!el) return;
  const sites = _camSites || [];
  if (sites.length <= 1) { el.innerHTML = ''; return; }
  const pill = (sid, label, color, active) => {
    const dot = color ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color}"></span>` : '';
    return `<button class="site-pill${active ? ' active' : ''}" data-action="setCamActiveSite" data-sid="${sid}">${dot}${escapeHtml(label)}</button>`;
  };
  el.innerHTML = pill('', I18N.t('cam.allSites'), null, _camActiveSiteId === null)
    + sites.map(s => pill(s.id, s.name, s.color, _camActiveSiteId === s.id)).join('');
}
function setCamActiveSite(sid) {
  _camActiveSiteId = sid ? Number(sid) : null;
  _camPage = 1;
  _renderCamSitePills();
  renderAdminCameras();
}

// Rebuild the location <select> options, preserving the current selection.
function _populateCamLocations() {
  const sel = document.getElementById('camFilterLoc');
  if (!sel) return;
  const cur = sel.value;
  const locs = _camDistinctLocations(cameras);
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('cs.filterLocAll'))}</option>` +
    locs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  if (locs.includes(cur)) sel.value = cur;
}

// Wire search/filter inputs once. Any change resets to page 1 then re-renders.
function _wireCamFilters() {
  if (_camFiltersWired) return;
  const onFilter = () => { _camPage = 1; renderAdminCameras(); };
  ['camSearch', 'camFilterVendor', 'camFilterStatus', 'camFilterType', 'camFilterLoc'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(id === 'camSearch' ? 'input' : 'change', onFilter);
  });
  _camFiltersWired = true;
}

function renderAdminCameras() {
  const host = document.getElementById('adminCameraRows');
  if (!host) return;
  const { rows, total, page } = _filterPaginate(cameras, _camFilterValues(), _camPage, CAM_PAGE_SIZE);
  _camPage = page; // clamp (data/filter may have shrunk the result set)
  const cnt = document.getElementById('camCount');
  if (cnt) cnt.textContent = I18N.t('cs.camCount').replace('{shown}', rows.length).replace('{total}', total);
  // Site indicator (2026-07-16) — the list mixes cameras from every site
  // (incl. edge sites like hdy), so show which site each belongs to (colored
  // dot + name) in the location cell. Lookup from the sites already loaded for
  // the edit form; absent gracefully if not loaded or the camera has no site.
  const _siteLookup = Object.fromEntries((_camSites || []).map(s => [s.id, s]));
  host.innerHTML = rows.map(c => {
    const v = String(c.vendor || 'bosch').toLowerCase();
    const site = _siteLookup[c.site_id];
    const siteCell = site
      ? `<span class="cam-site"><span class="dot" style="background:${site.color || 'var(--accent)'}"></span><span>${escapeHtml(site.name)}</span></span>`
      : `<span style="color:var(--text-secondary)">—</span>`;
    const paused = c.status === 'paused';
    return `
    <div class="cam-list-row">
      <div>
        <div style="font-weight:600">${escapeHtml(c.camera_name || c.camera_id)}</div>
        <div style="font-size:10px;color:var(--text-secondary)">${escapeHtml(c.camera_id)} · ${escapeHtml(c.ip_address || '—')}</div>
      </div>
      <div><span class="vendor-badge v-${v}">${escapeHtml(VENDOR_LABEL[v] || v)}</span></div>
      <div>${siteCell}</div>
      <div style="font-size:11px">${escapeHtml(c.location || '—')}</div>
      <div>
        ${paused
          ? `<span class="cam-stat paused"><svg width="10" height="10" aria-hidden="true" style="vertical-align:-1px"><use href="#icon-pause"/></svg>${escapeHtml(I18N.t('cam.paused'))}</span>`
          : `<span class="cam-stat ${c.status === 'online' ? 'on' : 'off'}"><span class="dot"></span>${c.status === 'online' ? 'ON' : 'OFF'}</span>`}
      </div>
      <div style="display:flex;gap:5px">
        <button class="cam-act" data-action="editCamera" data-camera-id="${c.camera_id}"><svg width="10" height="10" aria-hidden="true"><use href="#icon-settings"/></svg>${escapeHtml(I18N.t('common.edit'))}</button>
        <button class="cam-act${paused ? '' : ' warn'}" data-action="toggleCamPause" data-camera-id="${c.camera_id}" data-pause-state="${!paused}" title="${paused ? escapeHtml(I18N.t('cam.resumeBtn')) : escapeHtml(I18N.t('cam.pauseBtn'))}"><svg width="10" height="10" aria-hidden="true"><use href="#icon-pause"/></svg>${paused ? escapeHtml(I18N.t('cam.resumeBtn')) : escapeHtml(I18N.t('cam.pauseBtn'))}</button>
        <button class="cam-act del" data-action="deleteCamera" data-camera-id="${c.camera_id}"><svg width="10" height="10" aria-hidden="true"><use href="#icon-trash"/></svg>${escapeHtml(I18N.t('common.delete'))}</button>
      </div>
    </div>`;
  }).join('') || `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('cs.noCameras'))}</div>`;
  renderPagination('adminCameraPager', _camPage, total, CAM_PAGE_SIZE, p => { _camPage = p; renderAdminCameras(); });
}

// ── NVR channel scan-and-add (Phase 3) ─────────────────────────────
// ANPR sub-options — what an LPR-type channel captures (anpr default on).
const _NVR_ANPR_CATS = [
  ['anpr', 'ป้ายทะเบียน'], ['vehicle', 'ยานพาหนะ'],
  ['person', 'บุคคล'], ['nonmotor', 'ไม่ใช่ยานยนต์'], ['rule', 'กฎ (เส้น/โซน)'],
];
let _nvrScanned = [];   // last scanned channels
let _nvrPollTimer = null;

async function openNvrScan() {
  const m = document.getElementById('nvrScanModal'); if (!m) return;
  document.getElementById('nvrChannelList').innerHTML = '';
  document.getElementById('nvrCreateRow').style.display = 'none';
  document.getElementById('nvrScanMsg').textContent = '';
  const sites = await _loadCamSites();
  const sel = document.getElementById('nvrSiteId');
  if (sel) sel.innerHTML = '<option value="">— ไม่ระบุ —</option>' + sites.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  m.classList.remove('hidden');
}
function closeNvrScan() {
  clearTimeout(_nvrPollTimer); _nvrPollTimer = null;
  document.getElementById('nvrScanModal')?.classList.add('hidden');
}
function toggleNvrPass() {
  const inp = document.getElementById('nvrPass');
  const btn = document.getElementById('nvrPassToggle');
  if (!inp || !btn) return;
  const showing = inp.type === 'text';
  inp.type = showing ? 'password' : 'text';
  btn.textContent = showing ? I18N.t('cs.showPass') : I18N.t('cs.hidePass');
}

async function nvrScan() {
  const msg = document.getElementById('nvrScanMsg');
  const body = {
    vendor: 'dahua',
    ip_address: document.getElementById('nvrIp')?.value?.trim(),
    http_port:  document.getElementById('nvrPort')?.value || '',
    username:   document.getElementById('nvrUser')?.value?.trim() || '',
    password:   document.getElementById('nvrPass')?.value || '',
    site_id:    document.getElementById('nvrSiteId')?.value || '',
  };
  if (!body.ip_address) { msg.textContent = 'กรอก IP ก่อน'; return; }
  msg.textContent = I18N.t('cs.nvrScanning', 'กำลังสแกน…');
  document.getElementById('nvrChannelList').innerHTML = '';
  document.getElementById('nvrCreateRow').style.display = 'none';
  try {
    const r = await fetch(`${API}/api/cameras/scan-nvr`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { msg.textContent = d.error || 'สแกนไม่สำเร็จ'; return; }
    if (d.mode === 'direct') { _nvrShowChannels(d.channels); msg.textContent = ''; return; }
    // edge mode → poll
    _nvrPoll(d.scan_id, 0);
  } catch (e) { msg.textContent = 'สแกนไม่สำเร็จ: ' + e.message; }
}

function _nvrPoll(scanId, tries) {
  const msg = document.getElementById('nvrScanMsg');
  if (tries > 20) { msg.textContent = I18N.t('cs.nvrTimeout', 'หมดเวลารอ edge ตอบกลับ'); return; }
  _nvrPollTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/api/cameras/scan-nvr/${encodeURIComponent(scanId)}`);
      const d = await r.json();
      if (d.status === 'ready') { _nvrShowChannels(d.channels); msg.textContent = ''; }
      else if (d.status === 'error') { msg.textContent = d.error || 'edge สแกนผิดพลาด'; }
      else { msg.textContent = I18N.t('cs.nvrScanning', 'กำลังสแกน…') + ` (${tries + 1})`; _nvrPoll(scanId, tries + 1); }
    } catch (e) { msg.textContent = 'poll error: ' + e.message; }
  }, 1500);
}

function _nvrShowChannels(channels) {
  _nvrScanned = Array.isArray(channels) ? channels : [];
  const host = document.getElementById('nvrChannelList');
  if (!_nvrScanned.length) { host.innerHTML = `<div style="color:var(--text-secondary);font-size:13px">${I18N.t('cs.nvrNoChannels', 'ไม่พบ channel')}</div>`; return; }
  const dev = document.getElementById('nvrDeviceId')?.value?.trim() || 'nvr';
  const t = (k, fb) => I18N.t(k, fb);
  host.innerHTML = _nvrScanned.map(ch => {
    const n = ch.channel;
    return `
    <div class="nvr-ch-row" style="border:1px solid var(--border-hairline);border-radius:8px;padding:10px;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer">
        <input type="checkbox" class="nvr-ch-sel" data-ch="${n}">
        <span>CH${n + 1} · ${escapeHtml(ch.name)}</span>
      </label>
      <div class="lpr-filter-grid" style="margin-top:8px">
        <div class="form-group"><label class="form-label">Camera ID</label><input class="form-input nvr-ch-id" data-ch="${n}" value="${escapeHtml(dev)}-ch${n}"></div>
        <div class="form-group"><label class="form-label">${t('cs.fldName', 'ชื่อกล้อง')}</label><input class="form-input nvr-ch-name" data-ch="${n}" value="${escapeHtml(ch.name)}"></div>
      </div>
      <div style="margin-top:8px;font-size:12px">
        <div style="color:var(--text-secondary);margin-bottom:4px">${t('cs.nvrCamType', 'ประเภทกล้อง')}:</div>
        <label style="display:block;margin-bottom:3px;cursor:pointer"><input type="radio" name="nvr-type-${n}" class="nvr-ch-type" data-ch="${n}" value="face"> ${t('cs.nvrTypeFace', 'กล้องจับภาพใบหน้า')}</label>
        <div class="nvr-sub" data-type="face" data-ch="${n}" style="display:none;margin:2px 0 6px 22px">
          <label style="display:block;cursor:pointer"><input type="radio" name="nvr-face-${n}" value="face-only" checked> ${t('cs.nvrFaceOnly', 'เก็บใบหน้าอย่างเดียว')}</label>
          <label style="display:block;cursor:pointer"><input type="radio" name="nvr-face-${n}" value="face-appearance"> ${t('cs.nvrFaceAppearance', 'เก็บใบหน้า + บุคคล (Appearance)')}</label>
        </div>
        <label style="display:block;margin-bottom:3px;cursor:pointer"><input type="radio" name="nvr-type-${n}" class="nvr-ch-type" data-ch="${n}" value="anpr"> ${t('cs.nvrTypeAnpr', 'กล้องจับภาพป้ายทะเบียน (ANPR)')}</label>
        <div class="nvr-sub" data-type="anpr" data-ch="${n}" style="display:none;margin:2px 0 6px 22px">
          ${_NVR_ANPR_CATS.map(([k, lbl], i) => `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;cursor:pointer"><input type="checkbox" class="nvr-anpr-cat" data-ch="${n}" value="${k}"${i === 0 ? ' checked' : ''}>${escapeHtml(lbl)}</label>`).join('')}
        </div>
        <label style="display:block;cursor:pointer"><input type="radio" name="nvr-type-${n}" class="nvr-ch-type" data-ch="${n}" value="events"> ${t('cs.nvrTypeEvents', 'กล้อง Events')}</label>
      </div>
    </div>`;
  }).join('');
  document.getElementById('nvrCreateRow').style.display = '';
  // Show the sub-options for the picked type; picking a type auto-selects the channel.
  if (!host._nvrTypeWired) {
    host.addEventListener('change', (e) => {
      if (!e.target.classList.contains('nvr-ch-type')) return;
      const n = e.target.dataset.ch;
      host.querySelectorAll(`.nvr-sub[data-ch="${n}"]`).forEach(s => { s.style.display = s.dataset.type === e.target.value ? '' : 'none'; });
      const sel = host.querySelector(`.nvr-ch-sel[data-ch="${n}"]`);
      if (sel) sel.checked = true;
    });
    host._nvrTypeWired = true;
  }
}

async function nvrCreate() {
  const msg = document.getElementById('nvrCreateMsg');
  const channels = [];
  document.querySelectorAll('.nvr-ch-sel:checked').forEach(sel => {
    const ch = sel.dataset.ch;
    const type = document.querySelector(`.nvr-ch-type[data-ch="${ch}"]:checked`)?.value || 'events';
    let cam_role = 'standard', cats = [];
    if (type === 'face') {
      cam_role = 'face';
      const mode = document.querySelector(`input[name="nvr-face-${ch}"]:checked`)?.value || 'face-only';
      cats = mode === 'face-appearance' ? ['face', 'person'] : ['face'];
    } else if (type === 'anpr') {
      cam_role = 'lpr';
      cats = [...document.querySelectorAll(`.nvr-anpr-cat[data-ch="${ch}"]:checked`)].map(c => c.value);
      if (!cats.length) cats = ['anpr'];
    } // else events → standard, no category filter
    channels.push({
      nvr_channel: parseInt(ch, 10),
      camera_id:   document.querySelector(`.nvr-ch-id[data-ch="${ch}"]`)?.value?.trim(),
      camera_name: document.querySelector(`.nvr-ch-name[data-ch="${ch}"]`)?.value?.trim(),
      cam_role,
      capture_categories: cats,
    });
  });
  if (!channels.length) { msg.textContent = 'เลือกอย่างน้อย 1 channel'; return; }
  msg.textContent = I18N.t('cs.nvrCreating', 'กำลังสร้าง…');
  try {
    const r = await fetch(`${API}/api/cameras/bulk-create-channels`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vendor: 'dahua',
        ip_address: document.getElementById('nvrIp')?.value?.trim(),
        http_port:  document.getElementById('nvrPort')?.value || '',
        username:   document.getElementById('nvrUser')?.value?.trim() || '',
        password:   document.getElementById('nvrPass')?.value || '',
        site_id:    document.getElementById('nvrSiteId')?.value || '',
        device_id:  document.getElementById('nvrDeviceId')?.value?.trim() || '',
        channels,
      }),
    });
    const d = await r.json();
    if (!r.ok) { msg.textContent = d.error || 'สร้างไม่สำเร็จ'; return; }
    msg.textContent = I18N.t('cs.nvrCreated', 'สร้างแล้ว {n} กล้อง').replace('{n}', (d.created || []).length)
      + ((d.skipped || []).length ? ` · ข้าม ${d.skipped.length}` : '');
    await loadCameras(); renderAdminCameras();
    setTimeout(closeNvrScan, 1200);
  } catch (e) { msg.textContent = 'สร้างไม่สำเร็จ: ' + e.message; }
}

// ============================================================
// Bulk CSV import (Phase 2) — parse in the browser, POST parsed rows to
// /api/cameras/bulk-import. No server-side file upload. See the plan doc.
// ============================================================
const _CSV_COLS = ['camera_id','vendor','ip_address','site','camera_name','cam_role',
  'username','password','http_port','capture_categories','location','latitude','longitude','nvr_channel','notes'];
const _CSV_VENDORS = ['bosch','hikvision','dahua','onvif'];
const _CSV_ROLES = ['standard','face','lpr'];
const _CSV_IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
let _csvRows = [];   // [{ data:{}, ok:bool, reason:'' }]

// Reset + populate the CSV import sub-tab panel (called from camerasSubTab('csv')).
async function openCsvImport() {
  await _loadCamSites();
  _csvRows = [];
  document.getElementById('csvFileName').textContent = '';
  document.getElementById('csvPreview').innerHTML = '';
  document.getElementById('csvResult').innerHTML = '';
  document.getElementById('csvImportRow').style.display = 'none';
  const f = document.getElementById('csvFile'); if (f) f.value = '';
  const g  = document.getElementById('csvGuide');      if (g)  g.innerHTML  = I18N.t('cs.csvGuideHtml', '');
  const gx = document.getElementById('csvGuideExtra'); if (gx) gx.innerHTML = I18N.t('cs.csvGuideExtra', '');
}

function downloadCsvTemplate() {
  // camera_id prefixed with '#' marks these as EXAMPLE rows — the importer skips
  // them, so a user who forgets to delete them won't create phantom cameras.
  // Delete the '#' (or the whole row) to turn one into a real camera.
  const examples = [
    ['#hdy-lpr-01','dahua','172.17.22.30','hdy','ทางเข้ารถ','lpr','admin','password','80','anpr;vehicle','ด่านหน้า','7.01','100.47','',''],
    ['#hdy-face-01','dahua','172.17.22.31','hdy','ประตูหน้า','face','admin','password','80','face;person','ล็อบบี้','','','',''],
    ['#hdy-evt-01','hikvision','172.17.22.32','hdy','ลานจอด','standard','admin','password','80','','ลานจอด','','','',''],
  ];
  const esc = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = _CSV_COLS.join(',') + '\n' + examples.map(r => r.map(esc).join(',')).join('\n') + '\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'camera-import-template.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Quote-aware CSV parse (RFC-4180-ish): handles quoted fields with commas/newlines.
function _parseCsv(text) {
  const s = String(text).replace(/\r\n?/g, '\n');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

function _csvSiteMap() {
  const m = new Map();
  for (const s of (_camSites || [])) {
    if (s.code) m.set(String(s.code).toLowerCase(), s);
    if (s.name) m.set(String(s.name).toLowerCase(), s);
  }
  return m;
}

function onCsvFile() {
  const inp = document.getElementById('csvFile');
  const file = inp?.files?.[0];
  if (!file) return;
  document.getElementById('csvFileName').textContent = file.name;
  document.getElementById('csvResult').innerHTML = '';
  const reader = new FileReader();
  reader.onload = () => {
    const grid = _parseCsv(reader.result);
    if (grid.length < 2) { document.getElementById('csvPreview').innerHTML = `<div class="set-card-sub" style="color:var(--status-bad)">${escapeHtml(I18N.t('cs.csvEmpty','ไฟล์ว่างหรือไม่มีข้อมูล'))}</div>`; document.getElementById('csvImportRow').style.display = 'none'; return; }
    const header = grid[0].map(h => h.trim().toLowerCase());
    const siteMap = _csvSiteMap();
    const existing = new Set((typeof cameras !== 'undefined' ? cameras : []).map(c => c.camera_id));
    const seen = new Set();
    _csvRows = grid.slice(1).map(cells => {
      const d = {}; header.forEach((h, i) => { d[h] = (cells[i] ?? '').trim(); });
      let reason = '';
      const id = d.camera_id;
      const sample = id.startsWith('#');   // example/comment row — never imported
      if (sample) reason = I18N.t('cs.csvExample','ตัวอย่าง (ไม่นำเข้า)');
      else if (!id) reason = I18N.t('cs.csvErrId','ไม่มี camera_id');
      else if (!_CSV_VENDORS.includes((d.vendor || '').toLowerCase())) reason = I18N.t('cs.csvErrVendor','vendor ไม่ถูกต้อง');
      else if (!_CSV_IPV4.test(d.ip_address || '')) reason = I18N.t('cs.csvErrIp','ip ไม่ถูกต้อง');
      else if (!siteMap.get((d.site || '').toLowerCase())) reason = I18N.t('cs.csvErrSite','ไม่พบ site');
      else if (existing.has(id) || seen.has(id)) reason = I18N.t('cs.csvErrDup','camera_id ซ้ำ');
      if (id && !sample) seen.add(id);
      return { data: d, ok: !reason, reason, sample };
    });
    renderCsvPreview();
  };
  reader.readAsText(file);
}

function renderCsvPreview() {
  const okN = _csvRows.filter(r => r.ok).length;
  const badN = _csvRows.length - okN;
  const rowsHtml = _csvRows.map((r, i) => {
    const d = r.data;
    const status = r.sample
      ? `<span style="color:var(--text-secondary)">${escapeHtml(r.reason)}</span>`
      : r.ok
        ? `<span style="color:var(--status-ok)">✓</span>`
        : `<span style="color:var(--status-bad)">✗ ${escapeHtml(r.reason)}</span>`;
    return `<tr style="${r.ok ? '' : 'opacity:.7'}">
      <td style="padding:4px 8px">${i + 1}</td>
      <td style="padding:4px 8px">${escapeHtml(d.camera_id || '—')}</td>
      <td style="padding:4px 8px">${escapeHtml(d.vendor || '—')}</td>
      <td style="padding:4px 8px">${escapeHtml(d.site || '—')}</td>
      <td style="padding:4px 8px">${escapeHtml(d.cam_role || 'standard')}</td>
      <td style="padding:4px 8px;white-space:nowrap">${status}</td></tr>`;
  }).join('');
  document.getElementById('csvPreview').innerHTML = `
    <div class="set-card-sub" style="margin-bottom:6px">${I18N.t('cs.csvSummary','พร้อมนำเข้า {ok} · ข้าม {bad}').replace('{ok}', okN).replace('{bad}', badN)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="text-align:left;color:var(--text-secondary)">
        <th style="padding:4px 8px">#</th><th style="padding:4px 8px">camera_id</th>
        <th style="padding:4px 8px">vendor</th><th style="padding:4px 8px">site</th>
        <th style="padding:4px 8px">${escapeHtml(I18N.t('cs.csvColType','ประเภท'))}</th><th style="padding:4px 8px">${escapeHtml(I18N.t('cs.csvColStatus','สถานะ'))}</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>`;
  document.getElementById('csvImportRow').style.display = okN > 0 ? '' : 'none';
  const btn = document.getElementById('csvImportBtn');
  if (btn) btn.querySelector('span').textContent = I18N.t('cs.csvImportN','นำเข้า {n} กล้อง').replace('{n}', okN);
}

async function csvDoImport() {
  const payload = _csvRows.filter(r => r.ok).map(r => r.data);
  if (!payload.length) return;
  const msg = document.getElementById('csvImportMsg');
  const btn = document.getElementById('csvImportBtn');
  msg.textContent = I18N.t('cs.csvImporting', 'กำลังนำเข้า…');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/cameras/bulk-import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameras: payload }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'import failed');
    const created = (result.created || []).length;
    const skipped = (result.skipped || []);
    document.getElementById('csvResult').innerHTML = `
      <div class="set-card-sub" style="color:var(--status-ok)">${I18N.t('cs.csvDone','นำเข้าสำเร็จ {n} กล้อง').replace('{n}', created)}</div>
      ${skipped.length ? `<div class="set-card-sub" style="color:var(--warn);margin-top:4px">${I18N.t('cs.csvSkippedN','ข้าม {n}').replace('{n}', skipped.length)}: ${skipped.map(s => `${escapeHtml(s.camera_id || ('row ' + s.row))} (${escapeHtml(s.reason)})`).join(', ')}</div>` : ''}`;
    msg.textContent = '';
    document.getElementById('csvImportRow').style.display = 'none';
    await loadCameras(); renderAdminCameras();
  } catch (e) {
    msg.textContent = (I18N.t('cs.csvFail', 'นำเข้าไม่สำเร็จ') + ': ' + e.message);
  } finally { if (btn) btn.disabled = false; }
}

// ── CS5: Ingest method — Pull/Push radios are a VIEW of the canonical
// #frmCamPushOnly checkbox (the persisted value: push = push_only true).
// One sync helper, called from onVendorChange (which every load path runs)
// + the radio change handler — so push_only can never silently flip.
function _syncIngestRadios() {
  const push = !!document.getElementById('frmCamPushOnly')?.checked;
  const p = document.getElementById('frmIngestPush'), u = document.getElementById('frmIngestPull');
  if (p) p.checked = push;
  if (u) u.checked = !push;
}
function _resetIngestRec() {
  const rec = document.getElementById('frmIngestRec');
  if (rec) { rec.style.color = 'var(--text-secondary)'; rec.textContent = I18N.t('cs.ingestRecIdle'); }
}
// Face/LPR push URL sections only make sense for a Hikvision camera that's
// BOTH tagged with the matching role AND set to Push ingest — otherwise the
// URL would never actually receive anything. Re-run on every field that
// feeds this decision (vendor, role, ingest method), not just vendor change.
function _updatePushUrlVisibility() {
  const v = (document.getElementById('frmCamVendor')?.value || 'bosch').toLowerCase();
  const role = document.getElementById('frmCamRole')?.value || 'standard';
  const isPush = !!document.getElementById('frmCamPushOnly')?.checked;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('frmFacePushSection', v === 'hikvision' && role === 'face' && isPush);
  show('frmLprPushSection',  v === 'hikvision' && role === 'lpr'  && isPush);
}
// Advisory only — sets recommendation text/color, NEVER moves the radio
// (test-connection is a reachability proxy; a transient blip must not flip
// a working camera's mode — decision #146 / IM4 discipline).
function _setIngestRec(reachable) {
  const rec = document.getElementById('frmIngestRec');
  if (!rec) return;
  rec.style.color = reachable ? 'var(--status-ok)' : 'var(--warn)';
  rec.textContent = I18N.t(reachable ? 'cs.ingestRecPull' : 'cs.ingestRecPush');
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
  show('frmPushOnlyGroup',    false); // CS5: checkbox is now the hidden canonical bridge for the Pull/Push radios
  _updatePushUrlVisibility();
  show('frmFwdSection',        v === 'hikvision'); // CS6: Data Forwarding section
  // CS5: ingest method — Hikvision = Pull/Push choice; Bosch/Dahua = static info; ONVIF = hidden (Media's monitor note covers it)
  const ingBlock = document.getElementById('frmIngestBlock');
  if (ingBlock) {
    ingBlock.style.display = (v === 'onvif') ? 'none' : '';
    show('frmIngestChoose', v === 'hikvision');
    const info = document.getElementById('frmIngestInfo');
    if (info) {
      info.style.display = (v === 'hikvision') ? 'none' : '';
      if (v !== 'hikvision') info.textContent = I18N.t(v === 'dahua' ? 'cs.ingestInfoDahua' : 'cs.ingestInfoBosch');
    }
    _syncIngestRadios();
    _resetIngestRec();
  }
  show('frmCamSnapPathGroup', v === 'dahua' || v === 'onvif');
  // CS4: editor vendor badge + conditional nav links (MQTT link is Bosch-only)
  const badge = document.getElementById('camEditBadge');
  if (badge) { badge.textContent = (typeof VENDOR_LABEL !== 'undefined' && VENDOR_LABEL[v]) || v; badge.className = 'vendor-badge v-' + v; }
  _syncCamEditNav();
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
    msg.style.color = 'var(--text-secondary)';
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
  msg.style.color = 'var(--text-secondary)'; msg.textContent = I18N.t('cs.probingCamera');
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
      msg.style.color = 'var(--status-ok)';
      msg.textContent = I18N.t('cs.probeFound').replace('{path}', r.snapshot_path);
    } else {
      fld.disabled = false;
      fld.value = '';
      fld.focus();
      msg.style.color = 'var(--warn)';
      msg.textContent = I18N.t('cs.probeNotFound');
    }
  } catch (e) {
    fld.disabled = false;
    msg.style.color = 'var(--warn)';
    msg.textContent = I18N.t('cs.probeError').replace('{e}', e.message);
  } finally {
    btn.disabled = false; btn.textContent = I18N.t('cs.probeBtn');
  }
}

// ── Face push token / URL (IM3-R v2) ─────────────────────────
// The token is a per-camera capability secret in the push URL. Generated via a
// dedicated endpoint (persists immediately, so the URL is live when shown) — not
// folded into Save (operator could copy a URL that was never persisted).
let _facePushToken = null;

function _showFacePush(cam) {
  const sec = document.getElementById('frmFacePushSection');
  if (!sec) return;
  // '***' = redacted (non-admin); only admins reach this form, so a real value is expected.
  _facePushToken = (cam && cam.face_push_token && cam.face_push_token !== '***') ? cam.face_push_token : null;
  const has = document.getElementById('frmFacePushHas');
  const empty = document.getElementById('frmFacePushEmpty');
  const msg = document.getElementById('frmFacePushMsg');
  const genBtn = document.getElementById('frmFacePushGenBtn');
  if (msg) msg.textContent = '';
  if (_facePushToken) {
    document.getElementById('frmFacePushUrl').textContent = `${window.location.origin}/face-push/${_facePushToken}`;
    if (has) has.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (genBtn) genBtn.textContent = I18N.t('cs.facePushRegen');
  } else {
    if (has) has.style.display = 'none';
    if (empty) empty.style.display = '';
    if (genBtn) genBtn.textContent = I18N.t('cs.facePushGen');
  }
}

async function generateFacePushToken() {
  const id = (document.getElementById('frmCamId')?.value || '').trim();
  const msg = document.getElementById('frmFacePushMsg');
  if (!id) { alert(I18N.t('cs.facePushSaveFirst')); return; }
  if (_facePushToken && !confirm(I18N.t('cs.facePushRegenConfirm'))) return;
  const btn = document.getElementById('frmFacePushGenBtn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API}/api/cameras/${encodeURIComponent(id)}/face-push-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _showFacePush({ face_push_token: j.token });
    const c = cameras.find(x => x.camera_id === id); // keep in-memory list coherent
    if (c) c.face_push_token = j.token;
    if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('cs.facePushDone'); }
  } catch (e) {
    if (msg) { msg.style.color = 'var(--status-bad)'; msg.textContent = e.message; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function copyFacePushUrl() {
  const url = document.getElementById('frmFacePushUrl')?.textContent || '';
  if (!url) return;
  navigator.clipboard?.writeText(url);
  const msg = document.getElementById('frmFacePushMsg');
  if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('cs.facePushCopied'); }
}

// ── LPR push token / URL (auth-gated push route) ──────────────────────
// Per-camera secret token embedded in the push URL path, same pattern as face-push.
let _lprPushToken = null;

function _showLprPush(cam) {
  const sec = document.getElementById('frmLprPushSection');
  if (!sec) return;
  // '***' = redacted (non-admin); only admins reach this form, so a real value is expected.
  _lprPushToken = (cam && cam.lpr_push_token && cam.lpr_push_token !== '***') ? cam.lpr_push_token : null;
  const has = document.getElementById('frmLprPushHas');
  const empty = document.getElementById('frmLprPushEmpty');
  const msg = document.getElementById('frmLprPushMsg');
  const genBtn = document.getElementById('frmLprPushGenBtn');
  if (msg) msg.textContent = '';
  if (_lprPushToken) {
    document.getElementById('frmLprPushUrl').textContent = `${window.location.origin}/lpr/${_lprPushToken}`;
    if (has) has.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (genBtn) genBtn.textContent = I18N.t('cs.lprPushRegen');
  } else {
    if (has) has.style.display = 'none';
    if (empty) empty.style.display = '';
    if (genBtn) genBtn.textContent = I18N.t('cs.lprPushGen');
  }
}

async function generateLprPushToken() {
  const id = (document.getElementById('frmCamId')?.value || '').trim();
  const msg = document.getElementById('frmLprPushMsg');
  if (!id) { alert(I18N.t('cs.lprPushSaveFirst')); return; }
  if (_lprPushToken && !confirm(I18N.t('cs.lprPushRegenConfirm'))) return;
  const btn = document.getElementById('frmLprPushGenBtn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API}/api/cameras/${encodeURIComponent(id)}/lpr-push-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _showLprPush({ lpr_push_token: j.token });
    const c = cameras.find(x => x.camera_id === id); // keep in-memory list coherent
    if (c) c.lpr_push_token = j.token;
    if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('cs.lprPushDone'); }
  } catch (e) {
    if (msg) { msg.style.color = 'var(--status-bad)'; msg.textContent = e.message; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function copyLprPushUrl() {
  const url = document.getElementById('frmLprPushUrl')?.textContent || '';
  if (!url) return;
  navigator.clipboard?.writeText(url);
  const msg = document.getElementById('frmLprPushMsg');
  if (msg) { msg.style.color = 'var(--status-ok)'; msg.textContent = I18N.t('cs.lprPushCopied'); }
}

// ── CS4: full-page editor — view-swap + sticky horizontal section nav ──
// Pure: given each section's viewport-relative top + a sticky offset, return
// the id of the deepest section scrolled past the offset (first if none past).
function _activeSection(tops, offset) {
  if (!tops || !tops.length) return null;
  let cur = tops[0].id;
  for (const s of tops) { if (s.top - offset <= 1) cur = s.id; }
  return cur;
}
function _camEditNavTargets() {
  return [...document.querySelectorAll('#cameraForm .cam-fsec')].filter(s => s.id && s.offsetParent !== null);
}
function _setCamEditActive(id) {
  document.querySelectorAll('#camEditNav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
}
let _camNavClickAt = 0;
// Nav pill click: jump to the section + mark it active. Tail sections (forward/
// alert) sit too low to ever scroll under the offset line, so the click must win
// — suppress scrollspy briefly so it doesn't snap the active pill back.
function camEditNavJump(id) {
  const t = document.getElementById(id);
  if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  _setCamEditActive(id);
  _camNavClickAt = Date.now();
}
function camEditScrollSpy() {
  if (!document.getElementById('set-cameras')?.classList.contains('cam-editing')) return;
  if (Date.now() - _camNavClickAt < 700) return; // a nav click just set the pill — let it settle
  const targets = _camEditNavTargets();
  const c = document.querySelector('.content');
  // At the bottom the last section can't reach the offset line — force it active
  // so tail sections (forward/alert) are reachable by scroll too.
  if (c && c.scrollTop + c.clientHeight >= c.scrollHeight - 2 && targets.length) {
    _setCamEditActive(targets[targets.length - 1].id); return;
  }
  const tops = targets.map(s => ({ id: s.id, top: s.getBoundingClientRect().top }));
  const id = _activeSection(tops, 110); // sticky head+nav height
  if (id) _setCamEditActive(id);
}
// Conditional nav links: alert shows only when editing existing cam, MQTT only Bosch-after-provision.
function _syncCamEditNav() {
  const link = (aId, secId) => {
    const a = document.getElementById(aId), sec = document.getElementById(secId);
    if (a) a.hidden = !sec || sec.offsetParent === null;
  };
  link('camEditNavAlert', 'frmOfflineAlertSection');
  link('camEditNavMqtt', 'frmMqttCredsSection');
  link('camEditNavFwd', 'frmFwdSection'); // CS6
}
function _enterCamEditor() {
  document.getElementById('set-cameras')?.classList.add('cam-editing');
  _setCamEditActive('sec-info');
  _syncCamEditNav();
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  // 2-col→1-col made the map container full-width — force OpenLayers to repaint
  requestAnimationFrame(() => { if (_camFormMap) _camFormMap.updateSize(); });
}

function openCameraForm() {
  document.getElementById('formTitle').textContent = I18N.t('cs.formAddTitle');
  document.getElementById('cameraForm').classList.remove('hidden');
  ['frmCamId','frmCamName','frmCamIp','frmCamLoc','frmCamSite','frmCamUser','frmCamPass','frmCamLat','frmCamLng','frmCamNotes',
   'frmCamHttpPort','frmCamClipStream','frmCamSnapshotStream','frmCamSnapPath','frmCamFullViewWidth','frmCamFwdUrl']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Populate SITE dropdown for the NEW-camera form too (previously only editCamera
  // did this, so adding a camera showed just "— ไม่ระบุ —" and no site was pickable).
  _loadCamSites().then(sites => {
    const sel = document.getElementById('frmCamSiteId');
    if (sel) sel.innerHTML = '<option value="">— ไม่ระบุ —</option>' +
      sites.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  });
  document.getElementById('frmCamVendor').value = 'bosch';
  // Phase 6.1 — sensible defaults for new camera
  document.getElementById('frmCamEnableSnapshot').checked    = true;
  document.getElementById('frmCamEnableVcaOverlay').checked  = true;
  document.getElementById('frmCamEnableClipCapture').checked = false;
  document.getElementById('frmCamPushOnly').checked          = false;
  _showFacePush({});
  _showLprPush({});
  document.getElementById('frmCamOverlayBbox').checked       = true;
  document.getElementById('frmCamOverlayZone').checked       = true;
  document.getElementById('frmCamClipPre').value  = 10;
  document.getElementById('frmCamClipPost').value = 5;
  document.querySelectorAll('input[name="ignoreEv"]').forEach(cb => { cb.checked = false; });
  document.getElementById('frmCamId').disabled = false;
  // Hide offline alert + MQTT creds sections for new cameras; clear extras
  const oas = document.getElementById('frmOfflineAlertSection');
  if (oas) oas.style.display = 'none';
  _offlineAlertCameraId = null;
  _showMqttCreds({ vendor: 'bosch' }, null, false);
  _clearFormExtras();
  onVendorChange();
  initCamFormMap(null, null);
  _enterCamEditor();
}

async function editCamera(id) {
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
  document.getElementById('frmCamPushOnly').checked = !!c.push_only;
  _showFacePush(c);
  _showLprPush(c);
  document.getElementById('frmCamSnapPath').value = c.snapshot_path || '';
  document.getElementById('frmCamFullViewWidth').value = c.full_view_width || '';
  { const fw = document.getElementById('frmCamFwdUrl'); if (fw) fw.value = c.lpr_forward_url || ''; } // CS6
  document.getElementById('frmCamLoc').value = c.location || '';
  document.getElementById('frmCamUser').value = c.username || '';
  document.getElementById('frmCamPass').value = c.password || '';
  document.getElementById('frmCamLat').value = c.latitude || '';
  document.getElementById('frmCamLng').value = c.longitude || '';
  document.getElementById('frmCamNotes').value = c.notes || '';
  { const sites = await _loadCamSites(); const sel = document.getElementById('frmCamSiteId'); if (sel) { sel.innerHTML = '<option value="">— ไม่ระบุ —</option>' + sites.map(s => `<option value="${s.id}"${c.site_id === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join(''); } }
  { const rel = document.getElementById('frmCamRole'); if (rel) rel.value = c.cam_role || 'standard'; }
  // Phase 6.1 — media capture toggles (default-on for snapshot/overlay, default-off for clip)
  document.getElementById('frmCamEnableSnapshot').checked    = c.enable_snapshot    !== false;
  document.getElementById('frmCamEnableVcaOverlay').checked  = c.enable_vca_overlay !== false;
  document.getElementById('frmCamEnableClipCapture').checked = c.enable_clip_capture === true;
  document.getElementById('frmCamOverlayBbox').checked       = c.overlay_show_bbox  !== false;
  document.getElementById('frmCamOverlayZone').checked       = c.overlay_show_zone  !== false;
  document.getElementById('frmCamClipPre').value  = c.clip_pre_sec  ?? 10;
  document.getElementById('frmCamClipPost').value = c.clip_post_sec ?? 5;
  const ignoreSet = new Set(c.ignore_event_types || []);
  document.querySelectorAll('input[name="ignoreEv"]').forEach(cb => {
    cb.checked = ignoreSet.has(cb.value);
  });
  // Ph.1 — load offline alert config for this camera
  loadCameraOfflineAlert(id);
  // MQTT credentials (Bosch only) + clear extra states
  _showMqttCreds(c, null, false);
  _clearFormExtras();
  onVendorChange();
  initCamFormMap(c.latitude, c.longitude);
  _enterCamEditor();
}

function closeCameraForm() {
  document.getElementById('cameraForm').classList.add('hidden');
  document.getElementById('set-cameras')?.classList.remove('cam-editing'); // CS4: back to list view
  const s = document.getElementById('frmOfflineAlertSection');
  if (s) s.style.display = 'none';
  destroyCamFormMap();
}

// ── Camera Settings sub-tabs: Cameras | Groups
function camerasSubTab(key, el) {
  // Deactivate all tabs + hide all panels
  document.querySelectorAll('#camSubTabBar .tab').forEach(t => t.classList.remove('active'));
  const panels = ['camSubPanelCameras', 'camSubPanelGroups', 'camSubPanelCsv'];
  panels.forEach(id => { const p = document.getElementById(id); if (p) p.style.display = 'none'; });

  if (key === 'groups') {
    (el || document.getElementById('camSubTabGroups'))?.classList.add('active');
    const panel = document.getElementById('camSubPanelGroups');
    if (panel) panel.style.display = '';
    renderGroupList(); showEditorPlaceholder();
  } else if (key === 'csv') {
    (el || document.getElementById('camSubTabCsv'))?.classList.add('active');
    const panel = document.getElementById('camSubPanelCsv');
    if (panel) panel.style.display = '';
    openCsvImport();
  } else {
    (el || document.getElementById('camSubTabCameras'))?.classList.add('active');
    const panel = document.getElementById('camSubPanelCameras');
    if (panel) panel.style.display = '';
    closeCameraForm();
    _wireCamFilters(); _populateCamLocations(); renderAdminCameras();
    // Load sites (cached) then re-render so each row's site indicator shows on
    // first open, not only after the edit form has been touched (2026-07-16).
    _loadCamSites().then(() => { _renderCamSitePills(); renderAdminCameras(); });
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
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${rcp.type === 'group' ? '<svg aria-hidden="true" width="11" height="11" style="vertical-align:-1px"><use href="#icon-users"/></svg>' : '<svg aria-hidden="true" width="11" height="11" style="vertical-align:-1px"><use href="#icon-face"/></svg>'} ${escapeHtml(rcp.name || rcp.id)} <span style="color:var(--text-secondary);font-family:monospace">${escapeHtml(String(rcp.id).slice(0, 12))}…</span></span>
          </label>`).join('')
        : `<div style="color:var(--text-secondary);font-size:11px;padding:6px">${escapeHtml(I18N.t('co.noRecipientsConfig'))}</div>`;
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
    if (msg) msg.textContent = r.ok ? I18N.t('co.savedAlert') : ((await r.json()).error || 'Error');
    if (r.ok) setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
  } catch (e) { if (msg) msg.textContent = e.message; }
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
      : `<div style="padding:12px;color:var(--text-secondary);font-size:12px">${escapeHtml(I18N.t('co.noCurrentRows'))}</div>`;
    const currentPageInfo = I18N.t('co.currentPageInfo')
      .replace('{page}', _statusCurrentPage)
      .replace('{pages}', totalPages)
      .replace('{total}', totalRows);
    const currentPager = totalRows > STATUS_CURRENT_LIMIT
      ? `<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-secondary" style="font-size:11px" ${_statusCurrentPage <= 1 ? 'disabled' : ''} data-action="setStatusPage" data-page="${_statusCurrentPage - 1}">${escapeHtml(I18N.t('rh.prev'))}</button>
          <span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(currentPageInfo)}</span>
          <button class="btn btn-secondary" style="font-size:11px" ${_statusCurrentPage >= totalPages ? 'disabled' : ''} data-action="setStatusPage" data-page="${_statusCurrentPage + 1}">${escapeHtml(I18N.t('rh.next'))}</button>
        </div>`
      : `<div style="display:flex;justify-content:flex-end;margin-top:10px;font-size:11px;color:var(--text-secondary)">${escapeHtml(currentPageInfo)}</div>`;

    host.innerHTML = `
      <div class="status-current-top">
        <div>
          <h3 style="font-size:14px;margin:0" data-i18n="co.currentTitle">${escapeHtml(I18N.t('co.currentTitle'))}</h3>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:3px">${escapeHtml(I18N.t('co.currentHint'))}</div>
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
    host.innerHTML = `<div style="padding:18px;color:var(--status-bad);font-size:12px">${escapeHtml(I18N.t('co.currentLoadFailed'))}</div>`;
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
  if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('co.loadingAlert'))}</td></tr>`;

  try {
    loadStatusCurrent();
    const r = await fetch(`${API}/api/cameras/status-log?${qs}`);
    if (!r.ok) throw new Error('API error');
    const rows  = await r.json();
    const total = parseInt(r.headers.get('X-Total-Count') || '0', 10);
    if (!body) return;
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('co.logEmpty'))}</td></tr>`;
    } else {
      body.innerHTML = rows.map(row => {
        const camName = (cameras.find(c => c.camera_id === row.camera_id) || {}).camera_name || row.camera_id;
        const statusLabel = row.status === 'online' ? I18N.t('co.logOnline') : I18N.t('co.logOffline');
        const dt = new Date(row.changed_at).toLocaleString('th-TH', { hour12: false });
        return `<tr style="border-bottom:1px solid var(--border-hairline)">
          <td style="padding:7px 12px">${escapeHtml(camName)}</td>
          <td style="padding:7px 12px">${statusLabel}</td>
          <td style="padding:7px 12px;white-space:nowrap">${escapeHtml(dt)}</td>
          <td style="padding:7px 12px;font-size:11px;color:var(--text-secondary)">${escapeHtml(row.reason || '—')}</td>
        </tr>`;
      }).join('');
    }
    renderPagination('statusLogPager', _statusLogPage, total, limit, (p) => loadStatusLog(p));
  } catch {
    if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--status-bad)">Error loading status log</td></tr>`;
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
  if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('co.loadingAlert'))}</td></tr>`;

  try {
    const r = await fetch(`${API}/api/cameras/image-quality-log?${qs}`);
    if (!r.ok) throw new Error('API error');
    const rows = await r.json();
    const total = parseInt(r.headers.get('X-Total-Count') || '0', 10);
    if (!body) return;
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('co.iqEmpty'))}</td></tr>`;
    } else {
      body.innerHTML = rows.map(row => {
        const camName = (cameras.find(c => c.camera_id === row.camera_id) || {}).camera_name || row.camera_id;
        const active = row.event_state === true || row.event_state === 'true';
        const stateLabel = active ? I18N.t('co.iqStarted') : I18N.t('co.iqEnded');
        const stateColor = active ? 'var(--warn)' : 'var(--status-ok)';
        const dt = new Date(row.event_time).toLocaleString('th-TH', { hour12: false });
        return `<tr style="border-bottom:1px solid var(--border-hairline)">
          <td style="padding:7px 12px">${escapeHtml(camName)}</td>
          <td style="padding:7px 12px">${escapeHtml(imageQualityTypeLabel(row.event_type))}</td>
          <td style="padding:7px 12px;color:${stateColor};font-weight:700">${escapeHtml(stateLabel)}</td>
          <td style="padding:7px 12px;white-space:nowrap">${escapeHtml(dt)}</td>
        </tr>`;
      }).join('');
    }
    renderPagination('iqLogPager', _imageQualityPage, total, limit, (p) => loadImageQualityLog(p));
  } catch {
    if (body) body.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('co.iqLoadFailed'))}</td></tr>`;
  }
}

// Gather the full camera form into a POST /api/cameras payload. Extracted so the
// "บันทึก + ทดสอบ" forward button can persist the same payload before probing.
function _collectCamData() {
  return {
    camera_id: document.getElementById('frmCamId').value.trim(),
    camera_name: document.getElementById('frmCamName').value.trim(),
    vendor: document.getElementById('frmCamVendor').value,
    ip_address: document.getElementById('frmCamIp').value.trim(),
    http_port: document.getElementById('frmCamHttpPort').value || null,
    clip_stream: document.getElementById('frmCamClipStream').value || null,
    snapshot_stream: document.getElementById('frmCamSnapshotStream').value || null,
    push_only: document.getElementById('frmCamPushOnly').checked,
    lpr_forward_url: (document.getElementById('frmCamFwdUrl')?.value || '').trim(), // CS6 (backend gates by vendor=hikvision)
    snapshot_path: document.getElementById('frmCamSnapPath').value.trim(),
    full_view_width: document.getElementById('frmCamFullViewWidth').value || null,
    location: document.getElementById('frmCamLoc').value.trim(),
    site_id: (() => { const v = document.getElementById('frmCamSiteId')?.value; return v ? (parseInt(v, 10) || null) : null; })(),
    cam_role: document.getElementById('frmCamRole')?.value || 'standard',  // manual deployment tag
    site: (() => { const el = document.getElementById('frmCamSiteId'); return el?.value ? (el.selectedOptions[0]?.textContent || '').trim() : ''; })(),
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
    ignore_event_types:  [...document.querySelectorAll('input[name="ignoreEv"]:checked')].map(cb => cb.value),
  };
}

async function saveCamera() {
  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('cs.saving'); }
  const data = _collectCamData();
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
    if (!res.ok) throw new Error(r.error === 'lpr_forward_url_invalid' ? I18N.t('cs.fwdUrlInvalid') : (r.error || `HTTP ${res.status}`)); // CS6
    await loadCameras();
    _populateCamLocations(); renderAdminCameras();

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
    t.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--status-ok);color:white;padding:10px 18px;border-radius:8px;z-index:2000;font-weight:600';
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
    <div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:12px;max-width:560px;width:100%;padding:18px;color:var(--text-primary)">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--warn)">${escapeHtml(I18N.t('cs.warnTitle'))}</h3>
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
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || I18N.t('common.loadFailedShort')); return; }
    await loadCameras();
    renderAdminCameras();
    renderCameraGrid();
  } catch (e) { alert(e.message); }
}

// Replaces a single confirm() with an explicit choice: wipe the camera's
// historical events/appearances/license_plates too, or keep them (orphaned —
// no `cameras` row, but still visible in listings that don't INNER JOIN
// cameras; see DELETE /api/cameras/:cameraId comment, src/routes/cameras.js).
// Added after an accidental hard-delete wiped a camera's face-event history
// with no way back (2026-07-16) — a plain OK/Cancel doesn't surface that
// choice clearly enough.
function deleteCamera(id) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2100;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:12px;max-width:480px;width:100%;padding:18px;color:var(--text-primary)">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--status-bad)">${escapeHtml(I18N.t('cs.deleteTitle').replace('{id}', id))}</h3>
      <p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:var(--text-secondary)">${escapeHtml(I18N.t('cs.deleteBody'))}</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-secondary" id="delKeepBtn" style="font-size:12px">${escapeHtml(I18N.t('cs.deleteKeep'))}</button>
        <button class="btn btn-primary" id="delWipeBtn" style="font-size:12px;background:var(--status-bad);border-color:var(--status-bad)">${escapeHtml(I18N.t('cs.deleteWipe'))}</button>
        <button class="btn btn-secondary" id="delCancelBtn" style="font-size:12px">${escapeHtml(I18N.t('common.cancel'))}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#delCancelBtn').onclick = close;
  overlay.querySelector('#delKeepBtn').onclick = () => { close(); _doDeleteCamera(id, /*keepData=*/true); };
  overlay.querySelector('#delWipeBtn').onclick = () => { close(); _doDeleteCamera(id, /*keepData=*/false); };
}

async function _doDeleteCamera(id, keepData) {
  try {
    const url = `${API}/api/cameras/${id}` + (keepData ? '?keep_data=1' : '');
    await fetch(url, { method: 'DELETE' });
    await loadGroups(); // groups may have changed
    await loadCameras();
    _populateCamLocations(); renderAdminCameras();
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

// Node-test hook for the pure list helpers (browser ignores this — no `module`).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _filterPaginate, _camDistinctLocations, _activeSection };
}
