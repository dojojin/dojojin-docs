// ============================================================
// Vigil Platform — Blacklist reservoir pages + import settings
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Spec: docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md
//
// Two pages (ฐานข้อมูลใบหน้า / ฐานข้อมูลป้ายทะเบียน) share this one renderer —
// they differ only by data_type, so every function below takes 'face' | 'lpr'
// rather than being duplicated per page.
//
// READ-ONLY by design. This is a reservoir, not an alert engine (spec §1):
// nothing here arms an alert. LPR alerting still runs entirely off
// lpr_watchlist / the F3 LINE path, untouched by this feature.

// ---------- source-type registry (mirrors the settings live demo) ----------
// types      = every data type this system COULD feed (capability ceiling)
// wiredTypes = the subset that actually calls a real backend probe today
const BL_TYPES = [
  // DSS Pro serves both sides: /acs/person/page (faces) and /ipms/api/v1.1/
  // vehicle/page (vehicles, with High/Medium Risk tiers). The catalogue said
  // face-only for a while — which is exactly why discovery now asks the source
  // instead of trusting this table.
  { id: 'dss_pro', name: 'Dahua DSS Pro', types: ['face', 'lpr'], wiredTypes: ['face', 'lpr'], importable: true,
    fields: [
      { key: 'host', label: 'Host / IP', type: 'text', ph: '172.17.60.121' },
      { key: 'port', label: 'Port', type: 'text', ph: '443' },
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ] },
  // HCP ไม่มีช่องกรอกสักช่อง — AK/SK อยู่ใน env ของ edge hkt เท่านั้น (central ไปไม่ถึง
  // 10.0.10.9 อยู่แล้ว) ตั้ง "ไซต์" ให้ถูกคือจบ · กลุ่ม Whitelist / VIP ถูกข้ามที่ต้นทาง
  { id: 'hcp', name: 'HikCentral Professional', types: ['face', 'lpr'], wiredTypes: ['face', 'lpr'], importable: true,
    fields: [] },
  { id: 'gurusquare', name: 'GuruSquare', types: ['lpr'], wiredTypes: ['lpr'], importable: true,
    fields: [
      { key: 'host', label: 'Host / IP', type: 'text', ph: '172.17.22.101' },
      { key: 'port', label: 'Port', type: 'text', ph: '13000' },
      { key: 'apiKey', label: 'X-API-Key', type: 'password' },
    ] },
  { id: 'openapi', name: 'OpenAPI มาตรฐาน', types: ['face', 'lpr'], wiredTypes: [], importable: false },
  { id: 'csv', name: 'นำเข้าแบบ CSV', types: ['face', 'lpr'], wiredTypes: [], importable: false },
  { id: 'manual', name: 'กรอกเอง (Manual)', types: ['face', 'lpr'], wiredTypes: [], importable: false },
  { id: 'dahua_nvr', name: 'Dahua NVR/กล้อง (โดยตรง)', types: ['face', 'lpr'], wiredTypes: ['face', 'lpr'], importable: false,
    fields: [
      { key: 'host', label: 'Host / IP', type: 'text', ph: '172.17.22.10' },
      { key: 'port', label: 'Port', type: 'text', ph: '80' },
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ] },
  { id: 'hikvision_nvr', name: 'Hikvision NVR (โดยตรง)', types: ['face', 'lpr'], wiredTypes: [], importable: false },
  // Not a real connection — what a deleted-but-kept source becomes. Hidden from
  // the picker; it exists so the retained rows still have a settings page.
  { id: 'archived', name: 'เก็บไว้หลังลบการเชื่อมต่อ', types: [], wiredTypes: [], importable: false, hidden: true },
];
const _blType = (id) => BL_TYPES.find(t => t.id === id);
const BL_TYPE_LABEL = { face: 'Face', lpr: 'LPR' };

// Same guarded helpers page-lpr.js uses — escapeHtml is installed on window
// late in dashboard.js, so never call it unguarded at module scope.
const _blT = (k, fb) => (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, fb) : fb;
const _blEsc = s => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);
const _blDT = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleString('th-TH', { hour12: false, year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ============================================================
// GuruSquare → Vigil vocabulary mapping
// ============================================================
// Built from the ACTUAL distinct values in the imported roster (1,080 rows),
// not from guesswork — counts in comments are what prod really holds so a
// future reader can tell a real category from a long-tail typo.

// cartype → our vehicleType token (drives both the label and the plaque shape:
// two-wheelers get the square stacked plate, everything else the wide one).
const _BL_VTYPE = {
  motorcycle: 'twoWheelVehicle',  // 613
  car:        'vehicle',          // 415
  pickup:     'pickupTruck',      // 31
  truck:      'truck',            // 16
  van:        'van',              // 2
  bus:        'largeBus',         // 1
};

// platetype → { color, ink }. GuruSquare writes "normal-<bg>-<ink>", plus a few
// bare colour words. Thai DLT plates are defined by BOTH background and text
// colour, so ink is carried through rather than collapsed away:
//   normal-white-black (947) = รถยนต์นั่ง/จยย. ส่วนบุคคล
//   normal-white-green (4)   = รถบรรทุกส่วนบุคคล  ← same bg, different meaning
const _BL_PLATE_INK = { black: '#16181d', green: '#1f7a3d', blue: '#1565c0', white: '#ffffff', red: '#e2231a' };
// Kept short to match the LPR modal's own label style ("ป้ายขาว (ส่วนบุคคล)") —
// the attribute grid wraps badly past ~22 chars.
const _BL_PLATE_LABEL = {
  'white-black':  'ป้ายขาว ตัวดำ (ส่วนบุคคล)',
  'white-green':  'ป้ายขาว ตัวเขียว (บรรทุก)',
  'white-blue':   'ป้ายขาว ตัวน้ำเงิน (บรรทุก)',
  'yellow-black': 'ป้ายเหลือง (รับจ้าง)',
  'red-black':    'ป้ายแดง (รถใหม่)',
};

// → { color, ink, label } — color feeds lprPlaque's DLT background token.
// คำมาตรฐานของแต่ละระดับ — ใช้เมื่อต้นทางพิมพ์ประโยคยาวจนไม่เหมาะเป็นป้าย
// (parser ย้ายประโยคไปเป็น "หัวข้อเหตุการณ์" แล้ว แต่ระดับยังอยู่)
function _blWatchLabel(level) {
  return level === 'warrant' ? _blT('bl.watchWarrant', 'มีหมายจับ')
    : level === 'watch' ? _blT('bl.watchWatch', 'เฝ้าระวัง')
      : level === 'follow' ? _blT('bl.watchFollow', 'เฝ้าติดตาม') : '';
}

function _blParsePlateType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === '-') return { color: '', ink: '', label: '' };
  const m = s.match(/^normal-([a-z]+)-([a-z]+)$/);
  if (m) {
    const [, bg, ink] = m;
    return {
      color: bg,
      ink: _BL_PLATE_INK[ink] || '',
      label: _BL_PLATE_LABEL[`${bg}-${ink}`] || `ป้าย${bg} ตัว${ink}`,
    };
  }
  // bare colour word ("White" 119, "Red" 1) — background only, ink unstated
  return { color: s, ink: '', label: (typeof _LPR_PCOLOR !== 'undefined' && _LPR_PCOLOR[s]) || raw };
}

function _blVehicleType(raw) {
  return _BL_VTYPE[String(raw || '').trim().toLowerCase()] || '';
}

// ============================================================
// Provenance badge — where this identity's data came from
// ============================================================
// Short display names, keyed on source_type so a second instance of the same
// system (e.g. DSS Pro at Pattani) reuses the label and only the site differs.
// "Dahua" is dropped from DSS Pro: the product name alone is unambiguous and
// the badge has to fit a ~210px card.
const _BL_SRC_SHORT = {
  dss_pro:       'DSS Pro',
  gurusquare:    'GuruSquare',
  hcp:           'HCP',
  dahua_nvr:     'Dahua NVR',
  hikvision_nvr: 'Hik NVR',
  openapi:       'OpenAPI',
  csv:           'CSV',
  manual:        'Manual',
};
// Fixed per source type so the same system is always the same colour across
// both pages — recognition beats prettiness here.
const _BL_SRC_TONE = {
  dss_pro: 'violet', gurusquare: 'teal', hcp: 'violet',
  dahua_nvr: 'teal', hikvision_nvr: 'violet',
};

// A master fed by >1 source IS the deduplicated record — that is the only case
// where "ถังกลาง (Master)" is true rather than decorative. With one source the
// badge names that source instead, so the operator can always tell provenance
// at a glance. (Today every master has exactly 1 source, so Master never shows;
// it appears the moment two systems agree on one identity.)
// The source's own category, shown as a coloured chip. GuruSquare sends
// blacklist / watchlist / whitelist / test in `blacklisttype`, and until it was
// stored (2026-08-01) every plate looked alike on this screen — an operator had
// no way to tell a warrant from a routine watch entry without opening the case
// text. `whitelist` is not an allow-list here: the owner confirmed the source
// mislabelled it and means watchlist, so it carries the same tone rather than a
// reassuring green one that would read as "let this car pass".
const _BL_CAT = {
  blacklist: { label: 'หมายจับ',      tone: 'bad'  },
  watchlist: { label: 'เฝ้าระวัง',     tone: 'warn' },
  whitelist: { label: 'เฝ้าระวัง',     tone: 'warn' },
  test:      { label: 'ข้อมูลทดสอบ',  tone: 'mute' },
};
function _blCategoryChip(raw) {
  if (!raw) return null;
  const c = _BL_CAT[String(raw).toLowerCase()] || { label: raw, tone: 'mute' };
  return `<span class="bl-cat bl-cat-${c.tone}" title="${_blEsc(raw)}">${_blEsc(c.label)}</span>`;
}

function _blSourceBadge(row) {
  const n = Number(row.source_count || (row.source_labels || []).length || 1);
  if (n > 1) {
    return `<span class="bl-src bl-src-master" title="${_blEsc((row.source_labels || []).join(' + '))}">`
      + `<span class="bl-src-dot"></span>${_blEsc(_blT('bl.srcMaster', 'ถังกลาง'))} <b>${n}</b></span>`;
  }
  const type = (row.source_types || [])[0] || '';
  const site = (row.site_codes || [])[0] || '';
  const name = _BL_SRC_SHORT[type] || (row.source_labels || [])[0] || type || '—';
  const tone = _BL_SRC_TONE[type] || 'neutral';
  const siteTxt = site ? ` · ${site.replace(/^site\s+/i, '').toUpperCase()}` : '';
  return `<span class="bl-src bl-src-${tone}" title="${_blEsc((row.source_labels || [])[0] || name)}">`
    + `<span class="bl-src-dot"></span>${_blEsc(name + siteTxt)}</span>`;
}

// per-page state — keyed by data_type so the two pages never clobber each other
const _blState = {
  face: { page: 1, q: '', sourceId: '', groups: [], orgs: [], masterOnly: false },
  lpr:  { page: 1, q: '', sourceId: '', groups: [], orgs: [], masterOnly: false },
};
let _blSources = [];
let _blFacets = { by_group: [], by_org: [] };
let _blFacetTotals = { all: null, master: null, bySource: {} };

// DSS Pro's own repository names. Mapped to Thai + a severity rank so the UI can
// order and colour them; anything unrecognised falls through as neutral rather
// than being silently dropped.
const _BL_GROUP_META = {
  'High Risk Person':     { th: 'ความเสี่ยงสูง',      rank: 0, tone: 'bad' },
  'Blacklist Person HDY': { th: 'Blacklist หาดใหญ่',  rank: 1, tone: 'warn' },
  'Medium Risk Person':   { th: 'ความเสี่ยงปานกลาง',  rank: 2, tone: 'warn' },
  __none__:               { th: 'ไม่ระบุกลุ่ม',        rank: 9, tone: 'muted' },
};
const _blGroupLabel = (k) => (_BL_GROUP_META[k] && _BL_GROUP_META[k].th) || k;
const _blGroupTone  = (k) => (_BL_GROUP_META[k] && _BL_GROUP_META[k].tone) || 'muted';
const _blGroupRank  = (k) => (_BL_GROUP_META[k] ? _BL_GROUP_META[k].rank : 5);
const _BL_TONE_VAR = { bad: 'var(--status-bad)', warn: 'var(--warn)', muted: 'var(--text-secondary)' };
// a11y (DESIGN.md §7): severity must never be colour-only — every badge carries
// an icon + text label as well.
const _BL_TONE_ICON = {
  bad:   '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  warn:  '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  muted: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
};
function _blGroupBadge(key, extraCls) {
  const tone = _blGroupTone(key);
  return `<span class="bl-badge bl-badge-${tone}${extraCls ? ' ' + extraCls : ''}">`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_BL_TONE_ICON[tone]}</svg>`
    + _blEsc(_blGroupLabel(key)) + '</span>';
}

// ---------- settings (server-held privacy policy) ----------
let _blSettings = { bl_face_blur_default: 'true', bl_id_mask_default: 'true', bl_face_page_size: '50', bl_lpr_page_size: '50' };
let _blSettingsLoaded = false;

async function _blLoadSettings(force) {
  if (_blSettingsLoaded && !force) return _blSettings;
  try {
    const r = await fetch(`${API}/api/blacklist/settings`, { credentials: 'include' });
    if (r.ok) _blSettings = await r.json();
  } catch { /* keep defaults — privacy-on is the safe fallback */ }
  _blSettingsLoaded = true;
  _blFaceHidden = _blSettings.bl_face_blur_default !== 'false';
  _blIdHidden = _blSettings.bl_id_mask_default !== 'false';
  return _blSettings;
}
const _blPageSize = (dataType) =>
  Math.max(10, Math.min(200, Number(_blSettings[dataType === 'face' ? 'bl_face_page_size' : 'bl_lpr_page_size']) || 50));

// ---------- page entry points (called from showPage) ----------
function _blInitPage(dataType) {
  // Settings first: the blur/mask defaults must be known BEFORE the first tiles
  // render, otherwise faces flash unblurred for a moment — which is exactly what
  // the setting exists to prevent.
  _blLoadSettings().then(() => {
    _blLoadSources().then(() => _blPopulateSourceFilter(dataType));
    _blLoadStats(dataType);
    _blLoadList(dataType, 1);
  });
  // BS3 — the bridge button only exists on the LPR tab; start the poller once,
  // it keeps running (10 min) whichever blacklist tab is open afterward.
  if (dataType === 'lpr') _blBridgePendingStart();
}

// ---------- BS3 — auto-sync status badge ----------
// Reuses GET /bridge/rules (already fetched every time the modal opens) rather
// than a dedicated endpoint — the pending count is a side-read off the same
// diff() the modal already needs, not a new cost.
let _blBridgePendingTimer = null;

async function _blBridgePendingCheck() {
  const badge = document.getElementById('blBridgePendingBadge');
  if (!badge) return;
  try {
    const r = await fetch(`${API}/api/blacklist/bridge/rules`, { credentials: 'include' });
    if (!r.ok) return;
    const j = await r.json();
    const n = j.pending?.count || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('show', n > 0);
    badge.title = n
      ? `${n} ${_blT('blbr.pendingTitle', 'ป้ายรอตรวจก่อน sync อัตโนมัติ — เปิด "ส่งเข้าเฝ้าระวัง" เพื่อตรวจ')}`
      : '';
  } catch (e) { /* a missed badge refresh is not worth surfacing */ }
}

function _blBridgePendingStart() {
  if (_blBridgePendingTimer) return;
  _blBridgePendingCheck();
  _blBridgePendingTimer = setInterval(_blBridgePendingCheck, 10 * 60 * 1000);
}

async function _blLoadSources() {
  try {
    const r = await fetch(`${API}/api/blacklist/sources`, { credentials: 'include' });
    _blSources = r.ok ? await r.json() : [];
  } catch { _blSources = []; }
  return _blSources;
}

// Data-quality bar. Deliberately NOT extra KPI tiles: the KPI row answers
// "what's in the roster" and each tile is a filter; these two answer "what's
// wrong with it" and open a triage modal. Mixing them would make the row mean
// two different things. Hidden entirely when both counts are zero.
function _blRenderQualityBar(s) {
  const el = document.getElementById('blFaceQuality');
  if (!el) return;
  const chips = [];
  if (s.dup_name_groups) {
    chips.push({
      action: 'blOpenQualDupName', tone: 'warn',
      label: _blT('bl.qDupName', 'ชื่อซ้ำ แต่เลขบัตรไม่ตรง'),
      n: `${s.dup_name_groups} ${_blT('bl.qNameUnit', 'ชื่อ')} / ${s.dup_name_records} ${_blT('blset.records', 'ระเบียน')}`,
    });
  }
  if (s.invalid_id_count) {
    chips.push({
      action: 'blOpenQualBadId', tone: 'bad',
      label: _blT('bl.qBadId', 'เลขบัตรไม่ถูกต้อง'),
      n: `${s.invalid_id_count} ${_blT('blset.records', 'ระเบียน')}`,
    });
  }
  if (!chips.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML =
    `<span class="bl-qbar-lead">${_blEsc(_blT('bl.qLead', 'ต้องตรวจสอบ'))}</span>` +
    chips.map(c => `
      <button type="button" class="bl-qchip bl-qchip-${c.tone}" data-action="${c.action}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_BL_TONE_ICON[c.tone]}</svg>
        <span>${_blEsc(c.label)}</span><b>${_blEsc(c.n)}</b>
      </button>`).join('');
}

// Facet options come from the live breakdown, so a group the source stops using
// simply disappears instead of lingering as a dead filter entry.
function _blPopulateFaceFacets() {
  const gSel = document.getElementById('blFaceGroup');
  const oSel = document.getElementById('blFaceOrg');
  if (gSel) {
    const sel = new Set(_blState.face.groups);
    gSel.innerHTML = [..._blFacets.by_group]
      .sort((a, b) => _blGroupRank(a.key) - _blGroupRank(b.key))
      .map(g => `<option value="${_blEsc(g.key)}"${sel.has(g.key) ? ' selected' : ''}>${_blEsc(_blGroupLabel(g.key))} (${g.n})</option>`).join('');
  }
  if (oSel) {
    const sel = new Set(_blState.face.orgs);
    oSel.innerHTML = _blFacets.by_org
      .map(o => `<option value="${_blEsc(o.key)}"${sel.has(o.key) ? ' selected' : ''}>${_blEsc(o.key === '__none__' ? _blT('bl.orgNone', 'ไม่ระบุหน่วยงาน') : o.key)} (${o.n})</option>`).join('');
  }
  if (typeof MultiPicker !== 'undefined') {
    MultiPicker.initAll(document.getElementById('page-blacklist-face'));
  }
}

// Source pills — deliberately the SAME markup/classes as renderSitePills() so
// they read as the same control the operator already knows from Person Data /
// Map / LPR, just filtering by data source instead of physical site.
// "รวมหลายแหล่ง" is not a source: it counts identities assembled from MORE than
// one source record. Named that way on purpose — calling it "Master" collided
// with the blacklist.master TABLE (which holds every identity, not just merged
// ones), so the same word meant two different numbers on one screen.
function _blRenderSourcePills(dataType) {
  const el = document.getElementById(dataType === 'face' ? 'blFaceSourcePills' : 'blLprSourcePills');
  if (!el) return;
  const st = _blState[dataType];
  const relevant = _blSources.filter(s => (s.data_types || []).includes(dataType));

  const pill = (key, label, color, active, count) => {
    const dot = color ? `<span class="bl-pill-dot" style="background:${color}"></span>` : '';
    const n = (count === null || count === undefined) ? '' : ` <b>${Number(count).toLocaleString()}</b>`;
    return `<button class="site-pill${active ? ' active' : ''}" data-action="blPickSource"
              data-dt="${dataType}" data-src="${_blEsc(key)}">${dot}${_blEsc(label)}${n}</button>`;
  };

  const all = _blFacetTotals.all;
  let html = pill('', _blT('bl.allSources', 'ทุกแหล่งข้อมูล'), null, !st.sourceId && !st.masterOnly, all);
  html += pill('master', _blT('bl.srcMasterFull', 'รวมแล้ว (ซ้ำ)'), 'var(--accent)',
    st.masterOnly, _blFacetTotals.master);
  for (const s of relevant) {
    const t = _blType(s.source_type);
    const short = (_BL_SRC_SHORT[s.source_type] || (t ? t.name : s.source_type))
      + (s.site_code ? ' · ' + s.site_code.replace(/^site\s+/i, '').toUpperCase() : '');
    const tone = _BL_SRC_TONE[s.source_type];
    const color = tone === 'violet' ? '#a855f7' : tone === 'teal' ? '#0d9488' : 'var(--text-secondary)';
    html += pill(String(s.id), short, color, String(st.sourceId) === String(s.id), _blFacetTotals.bySource[s.id]);
  }
  el.innerHTML = html;
}

function _blPickSource(dataType, key) {
  const st = _blState[dataType];
  if (key === 'master') { st.masterOnly = !st.masterOnly; st.sourceId = ''; }
  else { st.masterOnly = false; st.sourceId = String(st.sourceId) === String(key) ? '' : key; }
  _blRenderSourcePills(dataType);
  _blLoadList(dataType, 1);
}

function _blPopulateSourceFilter(dataType) {
  const sel = document.getElementById(dataType === 'face' ? 'blFaceSource' : 'blLprSource');
  if (!sel) return;
  const relevant = _blSources.filter(s => (s.data_types || []).includes(dataType));
  sel.innerHTML = `<option value="">${_blEsc(_blT('bl.allSources', 'ทุกแหล่งข้อมูล'))}</option>` +
    relevant.map(s => `<option value="${s.id}">${_blEsc(s.label)}</option>`).join('');
  sel.value = _blState[dataType].sourceId || '';
}

async function _blLoadStats(dataType) {
  const el = document.getElementById(dataType === 'face' ? 'blFaceKpi' : 'blLprKpi');
  if (!el) return;
  try {
    const r = await fetch(`${API}/api/blacklist/stats?data_type=${dataType}`, { credentials: 'include' });
    if (!r.ok) throw new Error('stats');
    const s = await r.json();
    _blFacets = { by_group: s.by_group || [], by_org: s.by_org || [] };
    _blFacetTotals = { all: s.pill_all, master: s.pill_master, bySource: s.pill_by_source || {} };
    _blRenderSourcePills(dataType);

    // Face KPIs are built FROM the data, not hardcoded. "identities" and
    // "records" were 957/957 — two tiles saying the same thing. The watch
    // groups are the only real severity dimension the roster has, so they get
    // the space, and each tile doubles as a filter.
    if (dataType === 'face') {
      const active = _blState.face.groups;
      const tiles = [{
        label: _blT('bl.kpiAll', 'ทั้งหมด'), v: s.identities, ka: 'var(--accent)',
        action: 'blFaceGroupAll', on: active.length === 0,
      }];
      for (const g of [..._blFacets.by_group].sort((a, b) => _blGroupRank(a.key) - _blGroupRank(b.key))) {
        tiles.push({
          label: _blGroupLabel(g.key), v: g.n, ka: _BL_TONE_VAR[_blGroupTone(g.key)],
          action: 'blFaceGroupPick', arg: g.key, on: active.includes(g.key),
        });
      }
      el.innerHTML = tiles.map(t =>
        `<div class="kpi kpi-clickable${t.on ? ' bl-kpi-on' : ''}" style="--ka:${t.ka}"
              data-action="${t.action}"${t.arg ? ` data-group="${_blEsc(t.arg)}"` : ''}>
           <div class="kl">${_blEsc(t.label)}</div>
           <div class="kv">${Number(t.v).toLocaleString()}</div>
         </div>`).join('');
      _blPopulateFaceFacets();
      _blRenderQualityBar(s);
      return;
    }

    const cards = [
      { label: _blT('bl.kpiIdentities', 'รายชื่อในถังกลาง'), v: s.identities },
      { label: _blT('bl.kpiRecords', 'ระเบียนจากต้นทาง'), v: s.records },
      { label: _blT('bl.kpiSources', 'แหล่งข้อมูล'), v: s.sources },
    ];
    if (dataType === 'lpr') {
      cards.push({ label: _blT('bl.kpiPlates', 'ทะเบียนที่ไม่ซ้ำ'), v: s.plates, ka: 'var(--status-ok)' });
      // Duplicates are a triage queue, not an error — amber + clickable, never red.
      if (s.dup_plates) cards.push({
        label: _blT('bl.kpiDupPlates', 'ทะเบียนซ้ำ'), v: s.dup_plates, ka: 'var(--warn)',
        action: 'blOpenDups', sub: _blT('bl.kpiDupSub', 'กดเพื่อตรวจสอบ →'),
      });
    }
    el.innerHTML = cards.map(c =>
      // .kl/.kv + --ka is the KPI contract the rest of the dashboard uses (page-lpr.js)
      `<div class="kpi${c.action ? ' kpi-clickable' : ''}" style="--ka:${c.ka || 'var(--accent)'}"${c.action ? ` data-action="${c.action}"` : ''}>
         <div class="kl">${_blEsc(c.label)}</div>
         <div class="kv">${Number(c.v).toLocaleString()}</div>
         ${c.sub ? `<div class="ks" style="color:${c.ka}">${_blEsc(c.sub)}</div>` : ''}
       </div>`
    ).join('');
  } catch {
    el.innerHTML = '';
  }
}

async function _blLoadList(dataType, page) {
  const st = _blState[dataType];
  st.page = page || st.page;
  const listEl = document.getElementById(dataType === 'face' ? 'blFaceList' : 'blLprList');
  const pagerEl = document.getElementById(dataType === 'face' ? 'blFacePager' : 'blLprPager');
  if (!listEl) return;
  listEl.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;

  const params = new URLSearchParams({ data_type: dataType, page: String(st.page), limit: String(_blPageSize(dataType)) });
  if (st.q) params.set('q', st.q);
  if (st.sourceId) params.set('source_id', st.sourceId);
  if (st.masterOnly) params.set('master_only', '1');
  for (const g of st.groups) params.append('group', g);
  for (const o of st.orgs) params.append('org', o);

  try {
    const r = await fetch(`${API}/api/blacklist/master?${params}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!data.rows.length) {
      listEl.innerHTML = `<div class="bl-empty">${_blEsc(_blT('bl.empty', 'ยังไม่มีข้อมูลในถังกลาง — ตั้งค่าการนำเข้าที่ การตั้งค่า › นำเข้าข้อมูล Blacklist'))}</div>`;
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = data.rows.map(row => _blCardHtml(row, dataType)).join('');
    if (pagerEl) {
      // signature: (container, currentPage, totalCount, pageSize, onPage, label)
      renderPagination(pagerEl, st.page, data.total, data.limit,
        (p) => _blLoadList(dataType, p), _blT('bl.items', 'รายชื่อ'));
    }
  } catch (e) {
    listEl.innerHTML = `<div class="bl-empty">${_blEsc(_blT('bl.loadFail', 'โหลดข้อมูลไม่สำเร็จ'))}: ${_blEsc(e.message)}</div>`;
  }
}

// Tile, same shape as the LPR search grid (.lpr-grid/.lpr-card/.lpr-thumb/...).
// Cover is the SYNTHETIC PLAQUE, not the roster photo — identical reasoning to
// the LPR grid: at ~120px the real photo is unreadable, while the plaque gives a
// scannable plate at a glance. The photo stays in the detail modal where it's
// big enough to actually study.
// BS1 — "the source stopped sending this row". One helper for both tiles and the
// record view so the three places can never disagree about what the state looks
// like. Muted rather than red on purpose: the row is no longer watched, which is
// a fact to notice, not a fault to alarm about (DESIGN.md — restraint).
function _blVanishChip(when) {
  return `<span class="bl-vanish-chip" title="${_blEsc(_blT('bl.vanishedHint',
    'ต้นทางไม่ส่งรายการนี้มาแล้ว จึงถูกถอนออกจากรายการเฝ้าระวัง'))}">${
    _blEsc(_blT('bl.vanished', 'ต้นทางลบแล้ว'))}${when ? ` · ${_blDT(when)}` : ''}</span>`;
}

function _blCardHtml(row, dataType) {
  if (dataType === 'face') return _blFaceCardHtml(row);
  const plate = (row.plates && row.plates[0]) || '';
  const pt = _blParsePlateType(row.platetype);
  const vtype = _blVehicleType(row.cartype);
  const province = row.province || '';   // real province (GuruSquare only)
  const org = row.org || '';             // reporting unit — NOT a province

  const thumb = (typeof lprPlaque === 'function' && plate)
    ? lprPlaque(plate, { vehicleType: vtype, plateColor: pt.color, ink: pt.ink, region: province })
    : `<span class="lpr-plaque noread">${_blEsc(_blT('bl.noPlate', 'ไม่มีทะเบียน'))}</span>`;

  const parsed = (typeof _lprParsePlate === 'function') ? _lprParsePlate(plate) : { letters: '', digits: plate };
  const bodyPlate = plate
    ? `<div class="lpr-plate">${parsed.letters ? `<span class="prov">${_blEsc(parsed.letters)}</span> ` : ''}${_blEsc(parsed.digits)}</div>`
    : `<div class="lpr-plate noread">${_blEsc(_blT('bl.noPlate', 'ไม่มีทะเบียน'))}</div>`;

  const vtypeLabel = (vtype && typeof _lprVType === 'function') ? _lprVType(vtype) : '';
  const colorName = row.carcolor || '';
  const colorLabel = (colorName && typeof _lprColorLang === 'function') ? _lprColorLang(colorName) : colorName;
  const dot = (colorName && typeof _lprColorDot === 'function') ? _lprColorDot(colorName) : '';
  const provLabel = (province && typeof provinceLabel === 'function') ? provinceLabel(province) : province;

  // Duplicate plates get an amber "ซ้ำ" badge in the same slot the LPR grid uses
  // for its review hint — consistent meaning: worth a look, not an accusation.
  const dupFlag = row.dup_count > 1
    ? `<span class="lpr-flag lpr-flag-mismatch" style="background:var(--warn);color:#000">${_blEsc(_blT('bl.dupN', 'ซ้ำ'))} ${row.dup_count}</span>`
    : '';

  return `
    <div class="lpr-card${row.dup_count > 1 ? ' flagged' : ''}${row.vanished ? ' bl-vanished' : ''}" data-action="blOpenDetail" data-id="${row.id}">
      <div class="lpr-thumb">${dupFlag}${thumb}</div>
      <div class="lpr-body">
        ${bodyPlate}
        ${row.vanished ? _blVanishChip(row.vanished_at) : ''}
        ${provLabel ? `<div class="lpr-region">${_blEsc(provLabel)}</div>` : ''}
        ${org ? `<div class="bl-card-org">${_blEsc(org)}</div>` : ''}
        <div class="lpr-tags">
          ${vtypeLabel ? `<span class="lpr-tag accent">${_blEsc(vtypeLabel)}</span>` : ''}
          ${colorName ? `<span class="lpr-tag">${dot}${_blEsc(colorLabel)}</span>` : ''}
          ${row.carbrand ? `<span class="lpr-tag">${_blEsc(row.carbrand)}</span>` : ''}
        </div>
        <div class="bl-src-row">${_blSourceBadge(row)}</div>
        <div class="lpr-meta"><span>${_blEsc(row.reported_by || row.display_name || '')}</span></div>
      </div>
    </div>`;
}

// Face tile. Deliberately the OPPOSITE cover choice from the LPR tile: for a
// vehicle the synthetic plaque beats an unreadable 120px photo, but for a person
// the head-shot IS the identifier — an operator recognises a face, not a masked
// ID number. Same .lpr-card frame so the two pages stay visually consistent.
function _blFaceCardHtml(row) {
  const name = row.display_name || _blT('bl.noName', '(ไม่ระบุชื่อ)');
  const cover = row.photo_path
    ? `<img src="${API}/api/blacklist/photo/${_blPhotoUrl(row.photo_path)}" alt="" loading="lazy" decoding="async" data-err="hide">`
    : `<svg class="bl-face-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>`;
  // Severity rides ON the photo (top-left, like the LPR watchlist flag) so it
  // survives a fast visual scan — the group is the only risk signal this roster
  // carries, and burying it in the tag row made every card look identical.
  const gkey = row.group_name || '__none__';
  const tone = _blGroupTone(gkey);
  return `
    <div class="lpr-card bl-face-card bl-tone-${tone}${row.vanished ? ' bl-vanished' : ''}" data-action="blOpenDetail" data-id="${row.id}">
      <div class="lpr-thumb bl-face-thumb${_blFaceHidden ? ' bl-face-blur' : ''}">
        ${_blGroupBadge(gkey, 'bl-badge-onphoto')}
        ${cover}
      </div>
      <div class="lpr-body">
        ${_blFlagTags(row)}
        ${row.vanished ? _blVanishChip(row.vanished_at) : ''}
        <div class="bl-face-name">${_blEsc(name)}</div>
        ${row.id_masked ? `<div class="bl-face-id${row.invalid_id ? ' bl-qbad' : ''}">${_blEsc(row.id_masked)}</div>` : ''}
        ${row.org ? `<div class="bl-face-org">${_blEsc(row.org)}</div>` : ''}
        <div class="bl-src-row">${_blSourceBadge(row)}</div>
      </div>
    </div>`;
}

// Quality tags sit directly under the photo — the first thing read after the
// face itself, before the name. Clicking one opens the matching triage modal
// rather than the person's detail, so the operator lands where the comparison is.
function _blFlagTags(row) {
  const tags = [];
  if (row.dup_name) tags.push({
    action: 'blOpenQualDupName', tone: 'warn',
    text: _blT('bl.tagDupName', 'ชื่อซ้ำ เลขบัตรไม่ตรง'),
  });
  if (row.invalid_id) tags.push({
    action: 'blOpenQualBadId', tone: 'bad',
    text: _blT('bl.tagBadId', 'เลขบัตรไม่ถูกต้อง'),
  });
  if (!tags.length) return '';
  return `<div class="bl-flagtags">${tags.map(t => `
    <span class="bl-flagtag bl-flagtag-${t.tone}" data-action="${t.action}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_BL_TONE_ICON[t.tone]}</svg>
      ${_blEsc(t.text)}
    </span>`).join('')}</div>`;
}

// ---------- filters ----------
const _blMpv = (id) => (typeof MultiPicker !== 'undefined') ? MultiPicker.values(id) : [];

function _blApplyFilter(dataType) {
  const st = _blState[dataType];
  const qEl = document.getElementById(dataType === 'face' ? 'blFaceSearch' : 'blLprSearch');
  st.q = qEl ? qEl.value.trim() : '';
  if (dataType === 'face') {
    st.groups = _blMpv('blFaceGroup');
    st.orgs = _blMpv('blFaceOrg');
    _blLoadStats('face');          // re-render KPI so the active tile matches
  } else {
    const sEl = document.getElementById('blLprSource');
    st.sourceId = sEl ? sEl.value : '';
  }
  _blLoadList(dataType, 1);
}

function _blResetFilter(dataType) {
  const st = _blState[dataType];
  const qEl = document.getElementById(dataType === 'face' ? 'blFaceSearch' : 'blLprSearch');
  if (qEl) qEl.value = '';
  st.q = ''; st.sourceId = ''; st.groups = []; st.orgs = []; st.masterOnly = false;
  _blRenderSourcePills(dataType);
  if (dataType === 'face') _blLoadStats('face');
  else { const s = document.getElementById('blLprSource'); if (s) s.value = ''; }
  _blLoadList(dataType, 1);
}

// KPI tiles double as the group filter — clicking one selects it, clicking the
// active one clears back to "all" (no dead-end state).
function _blFaceGroupPick(key) {
  const st = _blState.face;
  st.groups = st.groups.length === 1 && st.groups[0] === key ? [] : [key];
  _blLoadStats('face');
  _blLoadList('face', 1);
}
function _blFaceGroupAll() {
  _blState.face.groups = [];
  _blLoadStats('face');
  _blLoadList('face', 1);
}

function _blEditSource(id) {
  const s = _blSources.find(x => String(x.id) === String(id));
  if (s) _blOpenSourceForm(s.source_type, s);
}

// ---------- detail modal ----------
// focusRecId — the source record the operator actually clicked. All rows of one
// duplicate group share a master (they ARE the same vehicle), so the modal would
// otherwise always open on record 1/5 no matter which line was clicked.
async function _blOpenDetail(id, focusRecId) {
  const modal = document.getElementById('blDetailModal');
  const body = document.getElementById('blDetailBody');
  body.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  modal.classList.remove('hidden');
  try {
    const r = await fetch(`${API}/api/blacklist/master/${id}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const firstPlate = d.records.find(x => x.plate_numbers && x.plate_numbers.length)?.plate_numbers[0];
    const titleEl = document.getElementById('blDetailTitle');
    if (titleEl) {
      titleEl.textContent = firstPlate
        ? `${_blT('bl.detailTitle', 'รายละเอียด')} — ${firstPlate}`
        : (d.display_name || _blT('bl.detailTitle', 'รายละเอียด'));
    }
    body.innerHTML = d.records.map((rec, i) => _blRecordHtml(rec, d, i, d.records.length)).join('')
      || `<div class="bl-empty">${_blEsc(_blT('bl.noRecords', 'ไม่มีระเบียนจากต้นทาง'))}</div>`;
    if (focusRecId) {
      const target = body.querySelector(`.bl-rec[data-rec-id="${focusRecId}"]`);
      if (target) {
        target.classList.add('bl-rec-focus');
        // 'auto', not 'smooth': the modal just opened, so an animated scroll
        // reads as the content jumping on its own.
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    }
  } catch (e) {
    body.innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

// The structured attribute rows for one source record — extracted (2026-07-27)
// so the LPR watch-list alert popup can show the same fields (Vehicle Type,
// Colour, Plate Colour, Brand, Reported by, Source, Imported at) as this
// Details modal, instead of a flat notes string, without a second field-mapping
// living in page-lpr.js that would drift from this one.
function _blLprRecordRows(rec, ctx) {
  const { province, provLabel, vtypeLabel, colorName, colorDot, colorLabel, pt, pcHex } = ctx;
  return [
    [_blT('lpr.watchlistPlate', 'ป้ายทะเบียน'), `<b>${_blEsc(ctx.plate || '–')}</b>`],
    // First row after the plate: what tier this record is. Everything below is
    // description; this is the part that changes what an officer does.
    _blCategoryChip((rec.eff || rec.raw_json || {}).blacklisttype)
      ? [_blT('bl.category', 'กลุ่ม'), _blCategoryChip((rec.eff || rec.raw_json).blacklisttype)] : null,
    province ? [_blT('lpr.region', 'จังหวัด'), _blEsc(provLabel)] : null,
    [_blT('lpr.fType', 'ประเภทรถ'), _blEsc(vtypeLabel) || '–'],
    colorName ? [_blT('lpr.vehicleColor', 'สีรถ'), `${colorDot}${_blEsc(colorLabel)}`] : null,
    pt.label ? [_blT('lpr.plateColor', 'สีป้าย'),
      `<span class="lm-pswatch" style="background:${pcHex}"></span>${_blEsc(pt.label)}`] : null,
    (rec.eff || rec.raw_json || {}).carbrand ? [_blT('lpr.brand', 'ยี่ห้อ'), _blEsc((rec.eff || rec.raw_json).carbrand)] : null,
    // GuruSquare's "owner" column is the reporting unit / case origin
    // (e.g. "2025-03 นราธิวาส ศปจร."), not a person's name — labelled as such
    // rather than mislabelled "เจ้าของ".
    rec.name ? [_blT('bl.reportedBy', 'หน่วยที่แจ้ง'), _blEsc(rec.name)] : null,
    // The unit that owns the case. Lives in case_ref, and used to be rendered in
    // the จังหวัด slot above — a police unit printed where a province belongs.
    rec.case_ref ? [_blT('bl.orgUnit', 'หน่วยงาน'), _blEsc(rec.case_ref)] : null,
    [_blT('bl.source', 'แหล่งข้อมูล'), _blSourceBadge({ source_count: 1, source_types: [rec.source_type], site_codes: [rec.site_code || ''], source_labels: [rec.source_label] })],
    [_blT('bl.importedAt', 'นำเข้าเมื่อ'), _blDT(rec.imported_at)],
  ].filter(Boolean);
}

// One source record, laid out like the LPR-info modal: synthetic plaque on the
// left, the suspect-vehicle photo large on the right, structured attribute rows
// underneath. GuruSquare has no camera plate-crop, so the left column carries
// just the plaque (the LPR modal stacks crop + plaque there).
function _blRecordHtml(rec, master, idx, total) {
  if (rec.data_type === 'face') return _blFaceRecordHtml(rec, master, idx, total);
  const rj = rec.eff || rec.raw_json || {};
  const plate = (rec.plate_numbers && rec.plate_numbers[0]) || '';
  const pt = _blParsePlateType(rj.platetype);
  const vtype = _blVehicleType(rj.cartype);
  const province = rj.province || '';   // case_ref is the unit, never the province

  const plaque = (typeof lprPlaque === 'function' && plate)
    ? lprPlaque(plate, { vehicleType: vtype, plateColor: pt.color, ink: pt.ink, region: province, big: true, showProv: true })
    : `<span class="plate-chip">${_blEsc(plate || '–')}</span>`;

  const photo = rec.photo_path
    ? `<img src="${API}/api/blacklist/photo/${_blPhotoUrl(rec.photo_path)}" alt="" data-err="hide">`
    : (typeof lprVehicleSvg === 'function' ? lprVehicleSvg(vtype) : '');

  const colorName = rj.carcolor || '';
  const dot = (colorName && typeof _lprColorDot === 'function') ? _lprColorDot(colorName) : '';
  const colorLabel = (colorName && typeof _lprColorLang === 'function') ? _lprColorLang(colorName) : colorName;
  const pcHex = (typeof _LPR_PCOLOR_HEX !== 'undefined' && _LPR_PCOLOR_HEX[pt.color]) || 'var(--surface-overlay)';
  const provLabel = (province && typeof provinceLabel === 'function') ? provinceLabel(province) : province;
  const vtypeLabel = (vtype && typeof _lprVType === 'function') ? _lprVType(vtype) : (rj.cartype || '');

  const rows = _blLprRecordRows(rec, { province, provLabel, vtypeLabel, colorName, colorDot: dot, colorLabel, pt, pcHex, plate });

  const head = total > 1
    ? `<div class="bl-rec-head">${_blEsc(_blT('bl.recordN', 'ระเบียนที่'))} ${idx + 1}/${total} · ${_blEsc(rec.source_label)}</div>`
    : '';

  return `
    <div class="bl-rec${rec.vanished_at ? ' bl-vanished' : ''}" data-rec-id="${rec.id}">
      ${head}
      ${rec.vanished_at ? `<div class="bl-vanish-note">${_blVanishChip(rec.vanished_at)}<span>${
        _blEsc(rec.vanish_reason || _blT('bl.vanishedHint',
          'ต้นทางไม่ส่งรายการนี้มาแล้ว จึงถูกถอนออกจากรายการเฝ้าระวัง'))}</span></div>` : ''}
      ${rec.change_count > 0 ? `<div class="bl-change-summary"><span>${_blEsc(_blT('bl.lastSourceChange', 'ต้นทางแก้ล่าสุด'))} <b>${_blDT(rec.last_source_change_at || rec.last_change_at)}</b> · ${_blEsc(_blT('bl.importedOn', 'เข้าระบบครั้งแรก'))} <b>${_blDT(rec.imported_at)}</b> · ${_blEsc(_blT('bl.changedTimes', 'แก้มาแล้ว'))} <b>${rec.change_count} ${_blEsc(_blT('bl.times', 'ครั้ง'))}</b></span><button class="btn btn-secondary btn-sm" data-action="blOpenChangeHistory" data-rid="${rec.id}">${_blEsc(_blT('bl.changeHistory', 'ดูประวัติ'))}</button></div>` : ''}
      <div class="bl-rec-grid">
        <div class="bl-rec-left">
          <div class="lm-box">
            <span class="lm-cap">${_blEsc(_blT('bl.mPlaque', 'ป้ายทะเบียน (จำลองตามสีป้ายจริง)'))}</span>
            <div class="lm-plaque">${plaque}</div>
          </div>
        </div>
        <div class="bl-rec-right">
          <div class="lm-box lm-snapbox">
            <span class="lm-cap">${_blEsc(_blT('bl.mSuspect', 'รถเป้าหมาย (Suspect vehicle)'))}</span>
            <div class="lm-imgwrap lm-scenebox bl-suspect">${photo}</div>
          </div>
        </div>
      </div>
      <div class="lm-data">
        ${rows.map(([k, v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('')}
      </div>
      <div class="bl-rec-editbar">
        ${rec.edited ? `<span class="bl-edited-tag">${_blEsc(_blT('bl.editedByUs','แก้ไขโดยเรา'))}</span>` : ''}
        <button class="btn btn-secondary btn-sm" data-action="blOpenEdit" data-rid="${rec.id}">${_blEsc(_blT('bl.editRecord','แก้ไข / ยกเว้น'))}</button>
        <!-- Junk is found while browsing tiles, not only on the duplicate page.
             Same exclusion, same audit — no second deletion mechanism. -->
        <button class="bl-dup-act" data-action="blDetailRemove" data-id="${rec.id}"
          data-plate="${_blEsc(plate || rec.external_id)}"
          title="${_blEsc(_blT('bl.dupRemove', 'ลบระเบียนนี้'))}"
          aria-label="${_blEsc(_blT('bl.dupRemove', 'ลบระเบียนนี้'))}">${BL_TRASH_SVG}</button>
      </div>
      ${rj.remark ? `<div class="bl-rec-note"><span class="bl-rec-note-k">${_blEsc(_blT('bl.detail', 'รายละเอียด'))}</span>${_blEsc(rj.remark)}</div>` : ''}
      ${rj.owner_detail ? `<div class="bl-rec-note bl-rec-note-sub"><span class="bl-rec-note-k">${_blEsc(_blT('bl.caseKind', 'ประเภทคดี'))}</span>${_blEsc(rj.owner_detail)}</div>` : ''}
      <div class="case-meta bl-srcmeta">
        <span class="bl-srcmeta-id">id=${_blEsc(rec.external_id)}</span>
        ${rj.last_update ? `<span class="bl-srcmeta-upd">${_blEsc(_blT('bl.srcUpdated', 'ต้นทางแก้ล่าสุด'))} <b>${_blDT(rj.last_update)}</b></span>` : ''}
      </div>
    </div>`;
}

// DSS stores gender as Dahua's numeric code. Decoded against the roster's own
// Thai names (856 "1" = male names, 101 "2" = female names) rather than assumed.
const _blGenderLabel = (g) => String(g) === '1' ? _blT('bl.male', 'ชาย')
  : String(g) === '2' ? _blT('bl.female', 'หญิง') : String(g || '');

// DSS timestamps are epoch SECONDS as a string.
function _blEpochDate(v) {
  const n = Number(v);
  if (!n || !isFinite(n)) return '';
  const d = new Date(n * 1000);
  return isNaN(d) ? '' : d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Privacy toggle for the face photo. Session-wide, not per-record: someone who
// hides a face because a screen is being shared or overlooked wants it hidden
// for the next record too. Blur rather than remove, so layout never jumps.
// Initial value comes from the SERVER setting (bl_face_blur_default) — this is
// an org policy, so it must not depend on which browser you happen to open.
let _blFaceHidden = true;
function _blToggleFacePhoto() {
  _blFaceHidden = !_blFaceHidden;
  // Grid thumbs follow the same switch — leaving 50 unblurred faces behind the
  // modal would defeat the point of hiding the one in front of you.
  document.querySelectorAll('#blFaceList .bl-face-thumb')
    .forEach(el => el.classList.toggle('bl-face-blur', _blFaceHidden));
  document.querySelectorAll('#blDetailBody .bl-facepane').forEach(el => {
    el.classList.toggle('bl-face-blur', _blFaceHidden);
    const btn = el.querySelector('.bl-eye-btn');
    if (btn) btn.innerHTML = _blEyeIcon();
  });
}
// National-ID reveal. Unlike the photo blur (a pure client-side effect), the
// browser is never sent the real number — revealing costs a round-trip to an
// admin-only endpoint that writes an audit row. So this flag only controls
// whether we've fetched it, and the fetched value is deliberately not cached
// beyond the open modal.
let _blIdHidden = true;
// `el` may be the button OR the surrounding cell — both carry data-action so an
// edge-miss still reacts. Always resolve the button from the wrap rather than
// assuming `el` is it.
async function _blToggleId(el) {
  const wrap = el.closest('.bl-idcell');
  if (!wrap) return;
  const btn = wrap.querySelector('.bl-idbtn');
  const masked = wrap.dataset.masked || '';
  if (wrap.dataset.revealed === '1') {
    wrap.querySelector('.bl-idval').textContent = masked;
    wrap.dataset.revealed = '0';
    if (btn) btn.innerHTML = _blEyeIconFor(true);
    return;
  }
  if (wrap.dataset.busy === '1') return;   // guard the double-fire while in flight
  wrap.dataset.busy = '1';
  const mid = wrap.dataset.master;
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API}/api/blacklist/master/${mid}/reveal-id`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    wrap.querySelector('.bl-idval').textContent = j.id_number;
    wrap.dataset.revealed = '1';
    if (btn) btn.innerHTML = _blEyeIconFor(false);
  } catch (e) {
    alert(_blT('bl.revealFail', 'ดูเลขบัตรไม่สำเร็จ') + ': ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
    wrap.dataset.busy = '0';
  }
}

const _EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const _EYE_OFF  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
// hidden => offer "show" (open eye); shown => offer "hide" (crossed eye)
const _blEyeIconFor = (hidden) => hidden ? _EYE_OPEN : _EYE_OFF;

const _blEyeIcon = () => _blFaceHidden
  ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

// Face detail. Same two-pane frame as the LPR record, but every attribute is
// person-shaped: no plate/vehicle rows, and rec.name is the PERSON (for a
// GuruSquare LPR record the same column means the reporting unit — labelling
// them identically would be actively misleading).
function _blFaceRecordHtml(rec, master, idx, total) {
  const rj = rec.eff || rec.raw_json || {};
  const photo = rec.photo_path
    ? `<img src="${API}/api/blacklist/photo/${_blPhotoUrl(rec.photo_path)}" alt="" data-err="hide">`
    : `<svg class="bl-face-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>`;

  const gkey = rj.group_name || '__none__';
  // DSS has no per-person "added on". authenticationInfo.startTime is the access
  // VALIDITY start and arrives in ~15 discrete batch dates across the roster, so
  // it reads as "which intake batch" — labelled as that, not as a creation date.
  const validFrom = rj.valid_from ? _blEpochDate(rj.valid_from) : '';
  const rows = [
    [_blT('bl.fullName', 'ชื่อ-สกุล'), `<b>${_blEsc(rec.name || _blT('bl.noName', '(ไม่ระบุชื่อ)'))}</b>`],
    rec.id_masked ? [_blT('bl.nationalId', 'เลขบัตรประชาชน'),
      `<span class="bl-idcell" data-action="blToggleId" data-master="${master.id}" data-masked="${_blEsc(rec.id_masked)}" data-revealed="0">
         <span class="bl-idval bl-mono">${_blEsc(rec.id_masked)}</span>
         <button type="button" class="bl-idbtn" data-action="blToggleId"
                 title="${_blEsc(_blT('bl.toggleId', 'ดู / ซ่อนเลขบัตร'))}"
                 aria-label="${_blEsc(_blT('bl.toggleId', 'ดู / ซ่อนเลขบัตร'))}">${_blEyeIconFor(true)}</button>
       </span>`] : null,
    rj.gender ? [_blT('bl.gender', 'เพศ'), _blEsc(_blGenderLabel(rj.gender))] : null,
    [_blT('bl.watchGroup', 'กลุ่มเฝ้าระวัง'), _blGroupBadge(gkey)],
    rj.org_name ? [_blT('bl.orgUnit', 'หน่วยงาน'), _blEsc(rj.org_name)] : null,
    validFrom ? [_blT('bl.validFrom', 'เข้าระบบต้นทาง (ชุด)'), _blEsc(validFrom)] : null,
    rj.tel ? [_blT('bl.contactTel', 'เบอร์ติดต่อ'), `<span class="bl-mono">${_blEsc(rj.tel)}</span>`] : null,
    // Description ที่เจ้าหน้าที่กรอกบน HCP แยกช่องไว้แล้วตอน import
    // (raw_json.hcp_remark_parsed) — แสดงเฉพาะช่องที่ต้นทางกรอกจริง
    // ⚠️ เลขบัตรไม่อยู่ในนี้โดยตั้งใจ — มันเดินเส้น id_masked + reveal-id ด้านบนแทน
    ...(rj.hcp_remark_parsed ? [
      // ประเภทการเฝ้าระวังมาก่อนทุกช่อง — "มีหมายจับ" แปลว่าตำรวจจับได้ทันที
      // จึงต้องเห็นก่อนรายละเอียดคดี ไม่ใช่แถวข้อความธรรมดาปนกลาง ๆ
      // ข้อความยาวของเดิมไม่ถูกยกมาเป็นป้าย (parser ย้ายไปเป็นหัวข้อแล้ว)
      // แต่ "ระดับ" ยังอยู่ ⇒ ใช้คำมาตรฐานตามระดับ ป้ายจึงสั้นและอ่านออกเสมอ
      (rj.hcp_remark_parsed.watch_type || rj.hcp_remark_parsed.watch_level)
        ? [_blT('bl.watchType', 'ประเภทการเฝ้าระวัง'),
           `<span class="bl-watch bl-watch-${_blEsc(rj.hcp_remark_parsed.watch_level || 'none')}">`
           + `${_blEsc(rj.hcp_remark_parsed.watch_type || _blWatchLabel(rj.hcp_remark_parsed.watch_level))}</span>`] : null,
      rj.hcp_remark_parsed.case_title
        ? [_blT('bl.caseTitle', 'หัวข้อเหตุการณ์'), _blEsc(rj.hcp_remark_parsed.case_title)] : null,
      rj.hcp_remark_parsed.case_no
        ? [_blT('bl.caseNo', 'เลขคดี'), _blEsc(rj.hcp_remark_parsed.case_no)] : null,
      rj.hcp_remark_parsed.contact
        ? [_blT('bl.contactPerson', 'ผู้ติดต่อ'), _blEsc(rj.hcp_remark_parsed.contact)] : null,
      rj.hcp_remark_parsed.phone
        ? [_blT('bl.contactTel', 'เบอร์ติดต่อ'),
           `<a class="bl-mono" href="tel:${_blEsc(rj.hcp_remark_parsed.phone)}">${_blEsc(rj.hcp_remark_parsed.phone)}</a>`] : null,
    ] : []),
    [_blT('bl.source', 'แหล่งข้อมูล'), _blSourceBadge({ source_count: 1, source_types: [rec.source_type], site_codes: [rec.site_code || ''], source_labels: [rec.source_label] })],
    [_blT('bl.importedAt', 'นำเข้าเมื่อ'), _blDT(rec.imported_at)],
  ].filter(Boolean);

  // DSS Pro leaves `remark` empty on every face record (0/957 measured), so the
  // "why is this person listed" question has no answer in the data. Say that
  // explicitly — an empty space reads as a loading bug, and an operator should
  // know the absence is upstream, not ours.
  const noteHtml = rec.case_note
    // case_note ของ HCP อาจหลายบรรทัด (ชื่อคดี + บรรทัดที่แยกช่องไม่ได้) — escape ก่อน
    // แล้วค่อยแปลงขึ้นบรรทัดใหม่ ไม่งั้นทุกบรรทัดจะไหลมาต่อกันเป็นก้อนเดียว
    ? `<div class="bl-rec-note"><span class="bl-rec-note-k">${_blEsc(_blT('bl.caseNote', 'หมายเหตุ / คดี'))}</span>${_blEsc(rec.case_note).replace(/\n/g, '<br>')}</div>`
    : `<div class="bl-rec-note bl-rec-note-empty">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
         <span>${_blEsc(_blT('bl.noCaseNote', 'ต้นทางไม่ได้บันทึกรายละเอียดคดีไว้ — ทราบเพียงกลุ่มเฝ้าระวังและหน่วยงานเจ้าของข้อมูล'))}</span>
       </div>`;

  const head = total > 1
    ? `<div class="bl-rec-head">${_blEsc(_blT('bl.recordN', 'ระเบียนที่'))} ${idx + 1}/${total} · ${_blEsc(rec.source_label)}</div>`
    : '';

  return `
    <div class="bl-rec${rec.vanished_at ? ' bl-vanished' : ''}">
      ${head}
      ${rec.vanished_at ? `<div class="bl-vanish-note">${_blVanishChip(rec.vanished_at)}<span>${
        _blEsc(rec.vanish_reason || _blT('bl.vanishedHint',
          'ต้นทางไม่ส่งรายการนี้มาแล้ว จึงถูกถอนออกจากรายการเฝ้าระวัง'))}</span></div>` : ''}
      ${rec.change_count > 0 ? `<div class="bl-change-summary"><span>${_blEsc(_blT('bl.lastSourceChange', 'ต้นทางแก้ล่าสุด'))} <b>${_blDT(rec.last_source_change_at || rec.last_change_at)}</b> · ${_blEsc(_blT('bl.importedOn', 'เข้าระบบครั้งแรก'))} <b>${_blDT(rec.imported_at)}</b> · ${_blEsc(_blT('bl.changedTimes', 'แก้มาแล้ว'))} <b>${rec.change_count} ${_blEsc(_blT('bl.times', 'ครั้ง'))}</b></span><button class="btn btn-secondary btn-sm" data-action="blOpenChangeHistory" data-rid="${rec.id}">${_blEsc(_blT('bl.changeHistory', 'ดูประวัติ'))}</button></div>` : ''}
      <div class="bl-rec-grid bl-rec-grid-face">
        <div class="bl-rec-left">
          <div class="lm-box">
            <span class="lm-cap">${_blEsc(_blT('bl.mFacePhoto', 'ภาพใบหน้า'))}</span>
            <div class="lm-imgwrap bl-facepane${_blFaceHidden ? ' bl-face-blur' : ''}">
              ${photo}
              <button type="button" class="bl-eye-btn" data-action="blToggleFacePhoto"
                      title="${_blEsc(_blT('bl.togglePhoto', 'ซ่อน / แสดงภาพ'))}"
                      aria-label="${_blEsc(_blT('bl.togglePhoto', 'ซ่อน / แสดงภาพ'))}">${_blEyeIcon()}</button>
            </div>
          </div>
        </div>
        <div class="bl-rec-right">
          <div class="lm-data">
            ${rows.map(([k, v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('')}
          </div>
        </div>
      </div>
      ${noteHtml}
      <div class="bl-rec-editbar">
        ${rec.edited ? `<span class="bl-edited-tag">${_blEsc(_blT('bl.editedByUs','แก้ไขโดยเรา'))}</span>` : ''}
        <button class="btn btn-secondary btn-sm" data-action="blOpenEdit" data-rid="${rec.id}">${_blEsc(_blT('bl.editRecord','แก้ไข / ยกเว้น'))}</button>
      </div>
    </div>`;
}

// ---------- face data-quality triage ----------
let _blQualCache = null;

async function _blQualData() {
  if (_blQualCache) return _blQualCache;
  const r = await fetch(`${API}/api/blacklist/quality?data_type=face`, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  _blQualCache = await r.json();
  return _blQualCache;
}

function _blQualOpen(title, bodyHtml) {
  document.getElementById('blQualTitle').textContent = title;
  document.getElementById('blQualBody').innerHTML = bodyHtml;
  document.getElementById('blQualModal').classList.remove('hidden');
}

async function _blOpenQualDupName() {
  _blQualOpen(_blT('bl.qDupName', 'ชื่อซ้ำ แต่เลขบัตรไม่ตรง'),
    `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`);
  try {
    const d = await _blQualData();
    const g = d.dup_names || [];
    document.getElementById('blQualTitle').textContent =
      `${_blT('bl.qDupName', 'ชื่อซ้ำ แต่เลขบัตรไม่ตรง')} — ${g.length} ${_blT('bl.qNameUnit', 'ชื่อ')}`;
    document.getElementById('blQualBody').innerHTML =
      `<div class="bl-dup-note">${_blEsc(_blT('bl.qDupNameNote', 'ชื่อตรงกันแต่เลขบัตรคนละเลข — เป็นได้ทั้งคนละคนที่ชื่อพ้องกัน หรือคนเดียวกันที่ถูกกรอกซ้ำโดยเลขบัตรผิด · ระบบเปรียบเทียบใบหน้าเองไม่ได้ ต้องให้คนดูรูปตัดสิน'))}</div>`
      + g.map(grp => `
        <div class="bl-dup-group">
          <div class="bl-dup-head">
            <span class="bl-qname">${_blEsc(grp.name)}</span>
            <span class="bl-dup-count">${grp.records.length} ${_blEsc(_blT('blset.records', 'ระเบียน'))}</span>
          </div>
          <div class="bl-qcards">
            ${grp.records.map(r => `
              <div class="bl-qcard" data-action="blOpenDetail" data-id="${r.master_id}">
                <div class="bl-qcard-photo">${r.photo_path
                  ? `<img src="${API}/api/blacklist/photo/${_blEsc(r.photo_path)}" alt="" loading="lazy" data-err="hide">` : ''}</div>
                <div class="bl-qcard-body">
                  <div class="bl-qcard-id bl-mono${r.id_valid ? '' : ' bl-qbad'}">${_blEsc(r.id_masked || '–')}</div>
                  <div class="bl-qcard-meta">${_blEsc(r.org || '')}</div>
                  ${r.group_name ? _blGroupBadge(r.group_name) : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('');
  } catch (e) {
    document.getElementById('blQualBody').innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

async function _blOpenQualBadId() {
  _blQualOpen(_blT('bl.qBadId', 'เลขบัตรไม่ถูกต้อง'),
    `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`);
  try {
    const d = await _blQualData();
    const rows = d.invalid_ids || [];
    const reason = (r) => r.reason === 'length'
      ? `${_blT('bl.qReasonLen', 'จำนวนหลักไม่ครบ')} (${r.length} ${_blT('bl.qDigits', 'หลัก')} — ${_blT('bl.qShouldBe13', 'ต้องเป็น 13')})`
      : r.reason === 'checksum' ? _blT('bl.qReasonSum', 'เลขตรวจสอบ (check digit) ไม่ถูกต้อง')
      : _blT('bl.qReasonEmpty', 'ไม่มีเลขบัตร');
    document.getElementById('blQualTitle').textContent =
      `${_blT('bl.qBadId', 'เลขบัตรไม่ถูกต้อง')} — ${rows.length} ${_blT('blset.records', 'ระเบียน')}`;
    document.getElementById('blQualBody').innerHTML =
      `<div class="bl-dup-note bl-dup-note-bad">${_blEsc(_blT('bl.qBadIdNote', 'เลขบัตรผิดรูปแบบทำให้ dedup ข้ามแหล่งพังเงียบๆ — ถ้าคนเดียวกันถูกนำเข้าจากอีกระบบด้วยเลขที่ถูกต้อง ระบบจะไม่รู้ว่าเป็นคนเดียวกัน · ควรแก้ที่ต้นทาง เพราะนำเข้ารอบหน้าจะทับค่าที่แก้ไว้ปลายทาง'))}</div>`
      + `<div class="bl-qcards">${rows.map(r => `
          <div class="bl-qcard" data-action="blOpenDetail" data-id="${r.master_id}">
            <div class="bl-qcard-photo">${r.photo_path
              ? `<img src="${API}/api/blacklist/photo/${_blEsc(r.photo_path)}" alt="" loading="lazy" data-err="hide">` : ''}</div>
            <div class="bl-qcard-body">
              <div class="bl-qcard-name">${_blEsc(r.name || _blT('bl.noName', '(ไม่ระบุชื่อ)'))}</div>
              <div class="bl-qcard-id bl-mono bl-qbad">${_blEsc(r.id_masked || '–')}</div>
              <div class="bl-qcard-meta">${_blEsc(reason(r))}</div>
              <div class="bl-qcard-meta">${_blEsc(r.org || '')}</div>
            </div>
          </div>`).join('')}</div>`;
  } catch (e) {
    document.getElementById('blQualBody').innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

// ---------- CH3 — change history modal ----------
// ปุ่มปิดเคยเป็น <button> เปล่า ๆ ที่มีแต่ CSS — มองไม่เห็นบนจอจริง กดโดนก็ด้วยความบังเอิญ
// SVG ใช้ currentColor ตามระบบไอคอนของโปรเจกต์ (ห้าม emoji — decision #143/#144)
const BL_CLOSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

const _blChangeFieldLabels = {
  name: () => _blT('bl.fullName', 'ชื่อ'),
  case_note: () => _blT('bl.caseNote', 'หมายเหตุ / คดี'),
  // ⚠️ ห้ามใช้ bl.noPlate ตรงนี้ — คีย์นั้นแปลว่า "ไม่มีทะเบียน" ไม่ใช่ "ทะเบียน"
  // fallback ที่เขียนไว้ถูก แต่ _blT จะคืนค่าจากพจนานุกรมเสมอเมื่อคีย์มีอยู่จริง
  plate_numbers: () => _blT('bl.plateNumber', 'ทะเบียน'),
  case_ref: () => _blT('bl.reportedBy', 'หน่วยที่แจ้ง'),
  carbrand: () => _blT('bl.brand', 'ยี่ห้อ'),
  cartype: () => _blT('bl.vehicleType', 'ประเภทรถ'),
  carcolor: () => _blT('bl.vehicleColor', 'สีรถ'),
  platetype: () => _blT('bl.plateType', 'ชนิดป้าย'),
  owner_detail: () => _blT('bl.caseKind', 'ประเภทคดี'),
  province: () => _blT('bl.province', 'จังหวัด'),
  group_name: () => _blT('bl.watchGroup', 'กลุ่ม'),
  remark: () => _blT('bl.detail', 'รายละเอียด'),
  // bl.source แปลว่า "แหล่งข้อมูล" คนละความหมายกับ "ชนิดบัญชี" ของ GuruSquare
  blacklisttype: () => _blT('bl.listKind', 'ชนิดบัญชี'),
};

async function blOpenChangeHistory(el) {
  const rid = el.dataset.rid;
  if (!rid) return;

  let modal = document.getElementById('blChangeHistoryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'blChangeHistoryModal';
    modal.className = 'bl-modal hidden';
    modal.innerHTML = `
      <div class="bl-modal-overlay" data-action="blCloseChangeHistory"></div>
      <div class="bl-modal-box">
        <div class="bl-modal-head">
          <h2>${_blEsc(_blT('bl.changesTitle', 'ประวัติการแก้ไข'))}</h2>
          <button type="button" class="bl-modal-close" data-action="blCloseChangeHistory"
                  aria-label="${_blEsc(_blT('common.close', 'ปิด'))}">${BL_CLOSE_SVG}</button>
        </div>
        <div id="blChangeHistoryBody" class="bl-modal-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const body = document.getElementById('blChangeHistoryBody');
  body.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  modal.classList.remove('hidden');

  try {
    const r = await fetch(`${API}/api/blacklist/record/${rid}/changes`, { credentials: 'include' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const d = await r.json();

    let alertHtml = '';
    if (d.conflicts && d.conflicts.length > 0) {
      alertHtml = `<div class="bl-warning-box">${_blEsc(_blT('bl.conflictNote', 'มีช่องที่ชนะ/แพ้ระหว่างค่าของเราและค่าใหม่ของต้นทาง'))}</div>`;
    }

    const rows = (d.changes || []).map(ch => {
      const fieldLabel = _blChangeFieldLabels[ch.field] ? _blChangeFieldLabels[ch.field]() : ch.field;
      // ?? ไม่ใช่ || — ค่า "0" เป็น falsy แต่เป็นค่าจริงที่ต้นทางส่งมาได้
      const empty = _blT('bl.emptyValue', '(ว่าง)');
      const oldVal = ch.old_value ?? empty;
      const newVal = ch.new_value ?? empty;
      const isOverridden = ch.overridden;

      return `
        <div class="bl-change-row${isOverridden ? ' bl-change-overridden' : ''}">
          <div class="bl-change-header">
            <span class="bl-change-field"><b>${_blEsc(fieldLabel)}</b></span>
            <span class="bl-change-date">${_blDT(ch.detected_at || ch.source_time)}</span>
            ${isOverridden ? `<span class="bl-change-tag-warn">${_blEsc(_blT('bl.overriddenBySource', 'ต้นทางแก้หลังเราแก้ทับ'))}</span>` : ''}
          </div>
          <div class="bl-change-values">
            <div class="bl-change-old"><span class="bl-change-label">${_blEsc(_blT('bl.oldValue', 'เดิม'))}</span><code>${_blEsc(oldVal)}</code></div>
            <span class="bl-change-arrow">→</span>
            <div class="bl-change-new"><span class="bl-change-label">${_blEsc(_blT('bl.newValue', 'ใหม่'))}</span><code>${_blEsc(newVal)}</code></div>
          </div>
        </div>`;
    }).join('');

    body.innerHTML = alertHtml + (rows ? `<div class="bl-change-list">${rows}</div>` : `<div class="bl-empty">${_blEsc(_blT('common.noData', 'ไม่มีข้อมูล'))}</div>`);
  } catch (e) {
    body.innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

function blCloseChangeHistory() {
  const modal = document.getElementById('blChangeHistoryModal');
  if (modal) modal.classList.add('hidden');
}

// ---------- duplicate-plate triage ----------
// Same plate, more than one record. The platform will not auto-merge these
// (spec §4.3 — name/plate fuzzy merging risks fusing two different vehicles or
// people), so this view lays the conflicting records side by side and lets the
// operator judge. Read-only for now: it answers "which are duplicated and how
// do they differ", not "merge them".
// ============================================================
// Duplicate-plate triage — a full page, not a modal
// ============================================================
// 255 plates over 526 records is a work session: the operator reads a group,
// decides, removes rows, and moves on. A floating dialog gave no pager, no
// room for per-row actions, and loaded every photo at once.
//
// "Remove" here is an EXCLUSION, not a DELETE. The raw row stays as evidence,
// leaves master and every operator view, cannot be resurrected by a re-import,
// and is reversible. A hard delete of a wanted-vehicle record would be
// unrecoverable AND would come straight back on the next import.
let _blDupPage = 1;
let _blDupShowRemoved = false;
let _blDupFilter = 'conflict';   // open on the 32 that need a decision, not all 255
let _blDupData = null;

const BL_TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
const BL_UNDO_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.2-6.4L3 9"/></svg>';
const BL_KEEP_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

// Why is this group on the page? Icon + word, never colour alone.
function _blDupKindBadge(g) {
  const bits = [];
  if (g.kind === 'conflict') {
    const names = (g.conflict_fields || []).map(k => _blT('bl.dupF.' + k, k)).join(', ');
    bits.push(`<span class="bl-dup-kind bad">${_blEsc(_blT('bl.dupKConflict', 'ข้อมูลขัดแย้ง'))}${names ? ': ' + _blEsc(names) : ''}</span>`);
  } else if (g.kind === 'complement') {
    bits.push(`<span class="bl-dup-kind ok">${_blEsc(_blT('bl.dupKComplement', 'เติมเต็มกัน ไม่ขัดแย้ง'))}</span>`);
  }
  if (g.malformed) bits.push(`<span class="bl-dup-kind warn">${_blEsc(_blT('bl.dupKMalformed', 'รูปแบบทะเบียนน่าสงสัย'))}</span>`);
  if (g.single_source) bits.push(`<span class="bl-dup-kind warn">${_blEsc(_blT('bl.dupKSingleSrc', 'ต้นทางซ้ำเอง'))}</span>`);
  return bits.join('');
}

async function _blOpenDups() {
  _blDupPage = 1;
  // Keep the ฐานข้อมูล nav item lit: this is a drill-down of that page, not a
  // separate destination, and a cleared sidebar reads as "lost". Nav item is
  // now the merged "ฐานข้อมูล" entry (data-page="blacklist-face" — decision #245).
  showPage('blacklist-dups', document.querySelector('.nav-item[data-page="blacklist-face"]'));
  _blLoadDups();
}

function blDupBack() {
  showPage('blacklist-lpr', document.querySelector('.nav-item[data-page="blacklist-face"]'));
  _blSyncTabActive('lpr');
}

// สลับแท็บ ใบหน้า/ป้ายทะเบียน ภายในหน้า "ฐานข้อมูล" ที่รวมเป็น nav item เดียว
// (decision #245) — ใช้ showPage() ตรงๆ แบบเดียวกับที่ blacklist-dups/-bin
// ใช้อยู่แล้ว ไม่ได้สร้างกลไก tab switcher ใหม่ — sync ปุ่มแท็บทั้ง 2 ชุด (อยู่ใน
// ทั้ง #page-blacklist-face และ #page-blacklist-lpr) ให้ตรงกันเสมอไม่ว่าจะกดจาก
// ที่ไหน หรือย้อนกลับมาจาก dups/bin
function _blSyncTabActive(which) {
  document.querySelectorAll('.tabs .tab[data-action="_blNavTab"]').forEach(t =>
    t.classList.toggle('active', t.dataset.which === which));
}
function _blNavTab(el) {
  const which = el.dataset.which;
  showPage(`blacklist-${which}`, document.querySelector('.nav-item[data-page="blacklist-face"]'));
  _blSyncTabActive(which);
}

function blDupToggleRemoved(el) {
  _blDupShowRemoved = !!el.checked;
  _blDupPage = 1;
  _blLoadDups();
}

async function _blLoadDups() {
  const list = document.getElementById('blDupList');
  if (!list) return;
  list.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  await _blLoadSettings();
  const per = parseInt(_blSettings.bl_dup_page_size, 10) || 25;
  try {
    const qs = new URLSearchParams({ data_type: 'lpr', page: String(_blDupPage),
                                     limit: String(per), filter: _blDupFilter });
    if (_blDupShowRemoved) qs.set('with_removed', '1');
    const r = await fetch(`${API}/api/blacklist/duplicates?${qs}`, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    _blDupData = d;

    document.getElementById('blDupSum').innerHTML =
      `<strong>${d.total_plates.toLocaleString()}</strong> ${_blEsc(_blT('bl.dupPlatesUnit', 'ทะเบียน'))}` +
      ` · <strong>${d.total_records.toLocaleString()}</strong> ${_blEsc(_blT('blset.records', 'ระเบียน'))}` +
      ` · ${_blEsc(_blT('bl.dupPageOf', 'หน้า'))} ${d.page}/${d.pages}`;
    _blDupRenderFilters(d.counts);

    list.innerHTML = d.groups.length
      ? d.groups.map(g => _blDupGroupHtml(g)).join('')
      : `<div class="bl-empty">${_blEsc(_blT('bl.dupNone', 'ไม่มีทะเบียนซ้ำ'))}</div>`;
    _blDupRenderPager(d);
  } catch (e) {
    list.innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

// Chips, ordered by how much attention each class deserves.
const BL_DUP_FILTERS = [
  { k: 'conflict',      lbl: 'bl.dupFConflict',   def: 'ต้องตัดสินใจ',        tone: 'bad'  },
  { k: 'malformed',     lbl: 'bl.dupFMalformed',  def: 'รูปแบบทะเบียนน่าสงสัย', tone: 'warn' },
  { k: 'single_source', lbl: 'bl.dupFSingleSrc',  def: 'ต้นทางซ้ำเอง',        tone: 'warn' },
  { k: 'complement',    lbl: 'bl.dupFComplement', def: 'เติมเต็มกัน',          tone: 'ok'   },
  { k: 'all',           lbl: 'bl.dupFAll',        def: 'ทั้งหมด',              tone: ''     },
];
function _blDupRenderFilters(counts) {
  const el = document.getElementById('blDupFilters');
  if (!el || !counts) return;
  el.innerHTML = BL_DUP_FILTERS.map(f => `
    <button class="site-pill bl-dup-chip ${f.tone} ${_blDupFilter === f.k ? 'active' : ''}"
            data-action="blDupSetFilter" data-f="${f.k}" ${counts[f.k] ? '' : 'disabled'}>
      ${_blEsc(_blT(f.lbl, f.def))} <b>${(counts[f.k] || 0).toLocaleString()}</b>
    </button>`).join('');
}

function blDupSetFilter(el) {
  _blDupFilter = el.dataset.f;
  _blDupPage = 1;
  _blLoadDups();
}

function _blDupRenderPager(d) {
  const el = document.getElementById('blDupPager');
  if (!el) return;
  if (d.pages <= 1) { el.innerHTML = ''; return; }
  const btn = (p, label, cls) =>
    `<button class="page-btn ${cls || ''}" data-action="blDupGoPage" data-p="${p}"
      ${p < 1 || p > d.pages || p === d.page ? 'disabled' : ''}>${label}</button>`;
  const around = [];
  for (let p = Math.max(1, d.page - 2); p <= Math.min(d.pages, d.page + 2); p++) {
    around.push(btn(p, String(p), p === d.page ? 'active' : ''));
  }
  el.innerHTML = btn(d.page - 1, '‹') +
    (d.page > 3 ? btn(1, '1') + '<span class="page-gap">…</span>' : '') +
    around.join('') +
    (d.page < d.pages - 2 ? '<span class="page-gap">…</span>' + btn(d.pages, String(d.pages)) : '') +
    btn(d.page + 1, '›');
}

function blDupGoPage(el) {
  _blDupPage = parseInt(el.dataset.p, 10) || 1;
  _blLoadDups();
  document.getElementById('page-blacklist-dups')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _blDupGroupHtml(g) {
  const first = g.records[0] || {};
  const rj0 = first.raw_json || {};
  const pt = _blParsePlateType(rj0.platetype);
  const plaque = (typeof lprPlaque === 'function')
    ? lprPlaque(g.plate, { vehicleType: _blVehicleType(rj0.cartype), plateColor: pt.color, ink: pt.ink })
    : `<span class="plate-chip">${_blEsc(g.plate)}</span>`;

  // Highlight only REAL conflicts (both sides carry a value and disagree). The
  // server works this out; highlighting plain "differs" lit up all 255 groups,
  // because a blank on one side counted as a difference.
  const differing = new Set(g.conflict_fields || []);
  const liveIds = g.records.filter(r => !r.excluded).map(r => r.id);

  return `
    <div class="bl-dup-group">
      <div class="bl-dup-head">
        <div class="bl-dup-plaque">${plaque}</div>
        <span class="bl-dup-count">${g.records.length} ${_blEsc(_blT('blset.records', 'ระเบียน'))}</span>
        ${_blDupKindBadge(g)}
        ${liveIds.length ? `<button class="btn-danger-ghost" data-action="blDupRemoveGroup"
            data-ids="${liveIds.join(',')}" data-plate="${_blEsc(g.plate)}"
            title="${_blEsc(_blT('bl.dupRemoveAll', 'ลบทั้งกลุ่ม'))}">
            ${BL_TRASH_SVG}<span>${_blEsc(_blT('bl.dupRemoveAll', 'ลบทั้งกลุ่ม'))}</span></button>` : ''}
      </div>
      <div class="bl-dup-scroll"><table class="bl-dup-table">
        <thead><tr>
          <th></th>
          <th>${_blEsc(_blT('lpr.region', 'จังหวัด'))}</th>
          <th>${_blEsc(_blT('lpr.fType', 'ประเภทรถ'))}</th>
          <th>${_blEsc(_blT('lpr.vehicleColor', 'สีรถ'))}</th>
          <th>${_blEsc(_blT('lpr.brand', 'ยี่ห้อ'))}</th>
          <th>${_blEsc(_blT('bl.reportedBy', 'หน่วยที่แจ้ง'))}</th>
          <th></th>
          <th></th>
        </tr></thead>
        <tbody>
        ${g.records.map(rec => {
          const rj = rec.raw_json || {};
          const cell = (k, v) => `<td class="${differing.has(k) ? 'diff' : ''}">${_blEsc(v || '–')}</td>`;
          const colorName = rj.carcolor || '';
          const colorLabel = (colorName && typeof _lprColorLang === 'function') ? _lprColorLang(colorName) : colorName;
          const rjProv = rj.province || '';
          const provLabel = (rjProv && typeof provinceLabel === 'function') ? provinceLabel(rjProv) : rjProv;
          const vt = _blVehicleType(rj.cartype);
          // The row opens the record; the action button must not also open it.
          // "Keep this one" is the action an operator actually performs on a
          // duplicate — deleting the others one at a time is the same decision
          // spelled out N times. Offered only when there IS something else to
          // drop, and it removes the siblings, never the row you kept.
          const others = liveIds.filter(id => id !== rec.id);
          const action = rec.excluded
            ? `<button class="bl-dup-act restore" data-action="blDupRestoreRow" data-id="${rec.id}"
                 title="${_blEsc(_blT('bl.dupRestore', 'กู้คืน'))}"
                 aria-label="${_blEsc(_blT('bl.dupRestore', 'กู้คืน'))}">${BL_UNDO_SVG}</button>`
            : `${others.length ? `<button class="bl-dup-act keep" data-action="blDupKeepRow"
                   data-ids="${others.join(',')}" data-plate="${_blEsc(g.plate)}"
                   title="${_blEsc(_blT('bl.dupKeep', 'เก็บอันนี้ ลบที่เหลือ'))}"
                   aria-label="${_blEsc(_blT('bl.dupKeep', 'เก็บอันนี้ ลบที่เหลือ'))}">${BL_KEEP_SVG}</button>` : ''}
               <button class="bl-dup-act" data-action="blDupRemoveRow" data-id="${rec.id}"
                 data-plate="${_blEsc(g.plate)}"
                 title="${_blEsc(_blT('bl.dupRemove', 'ลบระเบียนนี้'))}"
                 aria-label="${_blEsc(_blT('bl.dupRemove', 'ลบระเบียนนี้'))}">${BL_TRASH_SVG}</button>`;
          // Whole row opens the record, not just the thumbnail — the photo is a
          // 44px target in a row 1300px wide. The action buttons still win:
          // the dispatcher resolves with closest('[data-action]'), which walks
          // UP from what was clicked, so the inner button matches before the
          // row does. Guarded on master_id: a record with no identity yet has
          // nothing to open, and a dead click is worse than no cursor.
          const rowOpen = rec.master_id
            ? ` data-action="blOpenDetail" data-id="${rec.master_id}" data-rec="${rec.id}"` : '';
          return `<tr class="${rec.excluded ? 'bl-dup-gone' : ''}${rec.master_id ? ' bl-dup-clickable' : ''}"${rowOpen}>
            <td class="bl-dup-thumb">${rec.photo_path ? `<img src="${API}/api/blacklist/photo/${_blPhotoUrl(rec.photo_path)}" alt="" loading="lazy" data-err="hide">` : ''}</td>
            ${cell('province', provLabel)}
            ${cell('cartype', (vt && typeof _lprVType === 'function') ? _lprVType(vt) : rj.cartype)}
            ${cell('carcolor', colorLabel)}
            ${cell('carbrand', rj.carbrand)}
            <td>${_blEsc(rec.name || '–')}</td>
            <td class="bl-dup-id">id=${_blEsc(rec.external_id)}</td>
            <td class="bl-dup-actcell">${action}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>
    </div>`;
}

async function _blDupRemove(ids, restore, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  try {
    const r = await fetch(`${API}/api/blacklist/duplicates/remove`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ record_ids: ids, restore: !!restore }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blLoadDups();
  } catch (e) { alert(_blT('bl.dupRemoveFail', 'ลบไม่สำเร็จ') + ': ' + e.message); }
}

const blDupRemoveRow = (el) => _blDupRemove([Number(el.dataset.id)], false,
  `${_blT('bl.dupRemoveConfirm', 'ลบระเบียนนี้ออกจากฐานข้อมูลกลาง?')}\n\n` +
  `${_blT('lpr.watchlistPlate', 'ป้ายทะเบียน')}: ${el.dataset.plate}\n\n` +
  `${_blT('bl.dupRemoveNote', 'ข้อมูลดิบยังถูกเก็บไว้เป็นหลักฐาน และการนำเข้าครั้งต่อไปจะไม่ดึงกลับมา — กู้คืนได้ภายหลัง')}`);

const blDupRestoreRow = (el) => _blDupRemove([Number(el.dataset.id)], true, null);

// Same endpoint, but the detail modal is not the duplicate page: close it and
// refresh the tile grid rather than reloading a list that isn't on screen.
async function blDetailRemove(el) {
  if (!confirm(`${_blT('bl.dupRemoveConfirm', 'ลบระเบียนนี้ออกจากฐานข้อมูลกลาง?')}\n\n` +
               `${el.dataset.plate}\n\n` +
               `${_blT('bl.dupRemoveNote', 'ข้อมูลดิบยังถูกเก็บไว้เป็นหลักฐาน และการนำเข้าครั้งต่อไปจะไม่ดึงกลับมา — กู้คืนได้ภายหลัง')}`)) return;
  try {
    const r = await fetch(`${API}/api/blacklist/duplicates/remove`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ record_ids: [Number(el.dataset.id)] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    document.getElementById('blDetailModal')?.classList.add('hidden');
    // Refresh whichever page is actually open — the KPI counts change too, so
    // reload stats, not just the grid.
    const dt = document.querySelector('#page-blacklist-face.active') ? 'face' : 'lpr';
    _blLoadStats(dt);
    _blLoadList(dt, _blState[dt]?.page || 1);
  } catch (e) { alert(_blT('bl.dupRemoveFail', 'ลบไม่สำเร็จ') + ': ' + e.message); }
}

const blDupKeepRow = (el) => {
  const ids = String(el.dataset.ids).split(',').map(Number).filter(Boolean);
  _blDupRemove(ids, false,
    `${_blT('bl.dupKeepConfirm', 'เก็บระเบียนนี้ไว้ แล้วลบที่เหลือของทะเบียนนี้?')}\n\n` +
    `${_blT('lpr.watchlistPlate', 'ป้ายทะเบียน')}: ${el.dataset.plate} — ${_blT('bl.dupKeepN', 'จะลบ')} ${ids.length} ${_blT('blset.records', 'ระเบียน')}\n\n` +
    `${_blT('bl.dupRemoveNote', 'ข้อมูลดิบยังถูกเก็บไว้เป็นหลักฐาน และการนำเข้าครั้งต่อไปจะไม่ดึงกลับมา — กู้คืนได้ภายหลัง')}`);
};

const blDupRemoveGroup = (el) => {
  const ids = String(el.dataset.ids).split(',').map(Number).filter(Boolean);
  _blDupRemove(ids, false,
    `${_blT('bl.dupRemoveAllConfirm', 'ลบทุกระเบียนของทะเบียนนี้?')}\n\n` +
    `${_blT('lpr.watchlistPlate', 'ป้ายทะเบียน')}: ${el.dataset.plate} — ${ids.length} ${_blT('blset.records', 'ระเบียน')}\n\n` +
    `${_blT('bl.dupRemoveNote', 'ข้อมูลดิบยังถูกเก็บไว้เป็นหลักฐาน และการนำเข้าครั้งต่อไปจะไม่ดึงกลับมา — กู้คืนได้ภายหลัง')}`);
};

// ============================================================
// Settings › นำเข้าข้อมูล Blacklist — instance-based CRUD
// ============================================================
async function loadBlacklistSources() {
  const el = document.getElementById('blSourceList');
  if (!el) return;
  el.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  await _blLoadSources();
  if (!_blSources.length) {
    el.innerHTML = `<div class="bl-empty">${_blEsc(_blT('blset.empty', 'ยังไม่มีการเชื่อมต่อ — กด "เพิ่มการนำเข้าข้อมูล" เพื่อเริ่ม'))}</div>`;
    return;
  }
  el.innerHTML = _blSources.map(s => {
    const t = _blType(s.source_type);
    const statusCls = s.last_import_status === 'ok' ? 'ok'
      : s.last_import_status === 'error' ? 'err' : 'configured';
    const statusTxt = s.last_import_at
      ? `${_blEsc(s.last_import_status)} · ${_blDT(s.last_import_at)}`
      : _blT('blset.neverImported', 'ยังไม่เคยนำเข้า');
    return `
      <div class="conn-row">
        <div class="conn-row-main">
          <div class="conn-row-name">${_blEsc(s.label)}</div>
          <div class="conn-row-sub">${_blEsc(t ? t.name : s.source_type)}${s.site_code ? ' · Site ' + _blEsc(s.site_code.toUpperCase()) : ''} · ${(s.data_types || []).map(d => BL_TYPE_LABEL[d] || d).join(' + ')} · ${Number(s.record_count).toLocaleString()} ${_blEsc(_blT('blset.records', 'ระเบียน'))}</div>
          ${s.last_import_note ? `<div class="conn-row-note">${_blEsc(s.last_import_note)}</div>` : ''}
        </div>
        <span class="conn-row-status ${statusCls}">${_blEsc(statusTxt)}</span>
        <div class="conn-row-actions">
          ${t && t.importable ? `<button class="btn btn-primary btn-sm" data-action="blRunImport" data-id="${s.id}">${_blEsc(_blT('blset.import', 'นำเข้าเลย'))}</button>` : ''}
          ${t && t.importable ? `<button class="btn btn-secondary btn-sm${s.push_enabled ? ' push-on' : ''}" data-action="blOpenPush" data-id="${s.id}">${_blEsc(_blT('blpush.btn', 'ส่งกลับต้นทาง'))}</button>` : ''}
          <button class="btn btn-secondary btn-sm" data-action="blEditSource" data-id="${s.id}">${_blEsc(_blT('common.edit', 'แก้ไข'))}</button>
          <button class="btn btn-ghost btn-sm" data-action="blDeleteSource" data-id="${s.id}">${_blEsc(_blT('common.delete', 'ลบ'))}</button>
        </div>
      </div>`;
  }).join('');
}

function blAddSource() { _blOpenTypePicker(); }

// ---------- push-back to the source (opt-in, double-gated) ----------
// Reading from a third-party system is safe; writing into one is not. This
// modal is the whole gate chain the operator sees: the warning + acceptance
// that turns it on, then a per-sync confirmation showing the exact diff. The
// checksum travels with the confirm, so approving a stale list is rejected
// server-side rather than silently pushing something nobody read.
let _blPush = null;

async function blOpenPush(id) {
  const body = document.getElementById('blSrcModalBody');
  document.getElementById('blSrcModalTitle').textContent = _blT('blpush.title', 'ส่งข้อมูลที่แก้ไขกลับไปยังต้นทาง');
  body.innerHTML = `<div class="inline-note">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  document.getElementById('blSrcModal').classList.remove('hidden');
  try {
    const r = await fetch(`${API}/api/blacklist/sources/${id}/push-preview`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blPush = { id, ...j };
    _blRenderPush();
  } catch (e) {
    body.innerHTML = `<div class="cfg-result err"><div class="cfg-result-head">${_blEsc(_blT('common.error', 'ผิดพลาด'))}</div>${_blEsc(e.message)}</div>`;
  }
}

function _blRenderPush() {
  const p = _blPush;
  const body = document.getElementById('blSrcModalBody');
  const on = !!p.source.push_enabled;

  const gate = on
    ? `<div class="push-gate on">
         <div class="push-gate-head">${_blEsc(_blT('blpush.enabled', 'เปิดใช้งาน push-back อยู่'))}</div>
         <div class="inline-note">${_blEsc(_blT('blpush.acceptedBy', 'ยอมรับเงื่อนไขโดย'))}
           ${_blEsc(p.source.push_confirmed_by || '—')} · ${p.source.push_confirmed_at ? _blDT(p.source.push_confirmed_at) : '—'}</div>
         <div class="inline-note">${_blEsc(_blT('blpush.curMode', 'โหมด'))}: <b>${_blEsc(p.source.push_mode === 'replace'
            ? _blT('blpush.modeReplace', 'replace — ทำให้ต้นทางเหมือนของเราทุกประการ')
            : _blT('blpush.modeMerge', 'merge — เพิ่ม/แก้ไขที่ต้นทาง ไม่ลบของเดิม'))}</b>
           · ${_blEsc(_blT('blpush.curTypes', 'ชนิดข้อมูล'))}: ${(p.source.push_types || []).map(d => BL_TYPE_LABEL[d] || d).join(' + ') || '—'}
           · ${_blEsc(p.source.push_auto_enabled
              ? _blT('blpush.autoOnEvery', 'ส่งอัตโนมัติทุก') + ' ' + p.source.push_interval_hours + ' ' + _blT('blpush.hours', 'ชั่วโมง')
              : _blT('blpush.autoOff', 'ส่งเมื่อกดเองเท่านั้น'))}</div>
         ${p.source.last_auto_push_note ? `<div class="inline-note">${_blEsc(_blT('blpush.lastAuto', 'อัตโนมัติล่าสุด'))}: ${_blEsc(p.source.last_auto_push_note)}${p.source.last_auto_push_at ? ' · ' + _blDT(p.source.last_auto_push_at) : ''}</div>` : ''}
         <button class="btn btn-ghost btn-sm" data-action="blPushDisable">${_blEsc(_blT('blpush.disable', 'ปิดใช้งาน'))}</button>
       </div>`
    : `<div class="push-gate">
         <div class="push-gate-head">${_blEsc(_blT('blpush.offHead', 'ยังไม่ได้เปิดใช้งาน — ต้องยืนยันก่อน'))}</div>
         <div class="push-warn">${_blEsc(_blT('blpush.warn',
            'การส่งกลับจะไปแก้ไขข้อมูลในระบบของบุคคลที่สาม ซึ่งไม่ใช่ระบบของเรา และอาจกระทบการปฏิบัติงานของหน่วยงานต้นทางโดยตรง ' +
            'ต้องได้รับอนุญาตจากเจ้าของระบบต้นทางก่อนเท่านั้น การเปิดใช้งานนี้จะถูกบันทึกพร้อมชื่อผู้ยอมรับ'))}</div>
         ${_blPushOptions(p)}
         <label class="push-accept"><input type="checkbox" id="blPushAccept"> ${_blEsc(_blT('blpush.accept',
            'ข้าพเจ้าเข้าใจและได้รับอนุญาตจากเจ้าของระบบต้นทางแล้ว'))}</label>
         <button class="btn btn-primary btn-sm" data-action="blPushEnable">${_blEsc(_blT('blpush.enable', 'เปิดใช้งาน push-back'))}</button>
       </div>`;

  const rows = p.changes.length ? p.changes.map(c => `
      <div class="push-row ${c.excluded ? 'excluded' : ''}">
        <div class="push-row-head">
          <span class="push-row-name">${_blEsc(c.label)}</span>
          <span class="type-badge ${c.data_type}">${BL_TYPE_LABEL[c.data_type] || c.data_type}</span>
          ${c.excluded ? `<span class="push-tag">${_blEsc(_blT('blpush.notPushed', 'ไม่ส่ง — เป็นการคัดออกฝั่งเรา'))}</span>` : ''}
        </div>
        ${c.fields.map(f => `
          <div class="push-diff">
            <span class="push-field">${_blEsc(_blT('blpush.f.' + f.field, f.field))}</span>
            <span class="push-from">${_blEsc(_blFmtPushVal(f.from))}</span>
            <span class="push-arrow" aria-hidden="true">→</span>
            <span class="push-to">${_blEsc(_blFmtPushVal(f.to))}</span>
          </div>`).join('')}
        <div class="inline-note">${_blEsc(c.note || '')}${c.updated_by ? ' · ' + _blEsc(c.updated_by) : ''}${c.updated_at ? ' · ' + _blDT(c.updated_at) : ''}</div>
      </div>`).join('')
    : `<div class="bl-empty">${_blEsc(_blT('blpush.noChanges', 'ยังไม่มีการแก้ไขที่ต่างจากต้นทาง — ไม่มีอะไรต้องส่งกลับ'))}</div>`;

  body.innerHTML = `
    ${gate}
    <div class="push-summary">
      <span><strong>${p.pushable_count}</strong> ${_blEsc(_blT('blpush.willPush', 'รายการที่จะส่งกลับ'))}</span>
      ${p.excluded_count ? `<span>${p.excluded_count} ${_blEsc(_blT('blpush.heldBack', 'รายการคัดออก (ไม่ส่ง)'))}</span>` : ''}
      <span class="push-sum">${_blEsc(_blT('blpush.checksum', 'รหัสตรวจสอบ'))} ${_blEsc(p.checksum)}</span>
    </div>
    ${rows}
    ${!p.live_push_available ? `<div class="placeholder-note">${_blEsc(_blT('blpush.dryRun',
        'ขณะนี้อยู่ในโหมดทดสอบ — ระบบจะแสดงรายการให้ตรวจสอบ แต่จะไม่ส่งข้อมูลออกไปยังต้นทางจริง'))}</div>` : ''}
    <div style="margin-top:14px">
      <button class="btn btn-primary" data-action="blPushApply" ${on && p.pushable_count ? '' : 'disabled'}>
        ${_blEsc(_blT('blpush.apply', 'ตรวจสอบแล้ว — ยืนยันส่งกลับ'))}</button>
    </div>`;
}

function _blFmtPushVal(v) {
  if (v == null || v === '') return '—';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

// The options an operator picks BEFORE accepting: what may be sent, how, and
// whether unattended. Rendered inside the gate rather than beside it, because
// the acceptance below is an acceptance OF THESE settings — the server revokes
// consent if the mode later changes, and the form should read the same way.
function _blPushOptions(p) {
  const types = p.source.push_types || [];
  const mode = p.source.push_mode || 'merge';
  const t = (k, fb) => _blEsc(_blT(k, fb));
  return `
    <div class="push-opts">
      <div class="push-opt-row">
        <label>${t('blpush.optTypes', 'ส่งกลับเฉพาะชนิดข้อมูล')}</label>
        <div class="cfg-type-toggles">
          ${['face', 'lpr'].map(d => `<span class="cfg-type-toggle ${types.includes(d) ? 'on' : ''}"
             data-action="blPushToggleType" data-dt="${d}">${BL_TYPE_LABEL[d]}</span>`).join('')}
        </div>
      </div>
      <div class="push-opt-row">
        <label>${t('blpush.optMode', 'วิธีเขียนที่ต้นทาง')}</label>
        <select class="form-input" id="blPushMode">
          <option value="merge"${mode === 'merge' ? ' selected' : ''}>${t('blpush.modeMerge', 'merge — เพิ่ม/แก้ไขที่ต้นทาง ไม่ลบของเดิม')}</option>
          <option value="replace"${mode === 'replace' ? ' selected' : ''}>${t('blpush.modeReplace', 'replace — ทำให้ต้นทางเหมือนของเราทุกประการ')}</option>
        </select>
        <div class="push-warn-inline" id="blPushModeWarn" ${mode === 'replace' ? '' : 'hidden'}>
          ${t('blpush.replaceWarn', 'replace จะลบข้อมูลที่ต้นทางมีแต่เราไม่มี — เป็นการลบข้อมูลในระบบของหน่วยงานอื่น ต้องพิมพ์ CONFIRM ยืนยันอีกครั้ง')}
          ${p.replace_available === false ? `<br><b>${t('blpush.replaceHeld', 'ขณะนี้ระบบยังไม่ส่ง replace จริง — รอทดสอบกับระบบต้นทางตัวจริงก่อน')}</b>` : ''}
        </div>
      </div>
      <div class="push-opt-row">
        <label>${t('blpush.optAuto', 'ส่งอัตโนมัติตามรอบ')}</label>
        <select class="form-input" id="blPushInterval">
          <option value="0">${t('blpush.autoOff', 'ส่งเมื่อกดเองเท่านั้น')}</option>
          ${[6, 12, 24, 48].map(h => `<option value="${h}"${p.source.push_interval_hours === h ? ' selected' : ''}>${t('blpush.everyN', 'ทุก')} ${h} ${t('blpush.hours', 'ชั่วโมง')}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

// Kept on _blPush rather than read from the DOM at submit time: the gate is
// re-rendered on every change, so a toggle that only lived in the markup would
// be lost the moment anything else redrew.
function blPushToggleType(el) {
  const dt = el.dataset.dt;
  const cur = new Set(_blPush.source.push_types || []);
  cur.has(dt) ? cur.delete(dt) : cur.add(dt);
  _blPush.source.push_types = Array.from(cur);
  _blPush.source.push_interval_hours = Number(document.getElementById('blPushInterval')?.value || 0);
  _blPush.source.push_mode = document.getElementById('blPushMode')?.value || 'merge';
  _blRenderPush();
}

async function blPushEnable() {
  if (!document.getElementById('blPushAccept')?.checked) {
    alert(_blT('blpush.mustAccept', 'กรุณาติ๊กยอมรับเงื่อนไขก่อน'));
    return;
  }
  const types = _blPush.source.push_types || [];
  if (!types.length) { alert(_blT('blpush.mustType', 'กรุณาเลือกชนิดข้อมูลที่จะส่งกลับอย่างน้อยหนึ่งชนิด')); return; }
  const mode = document.getElementById('blPushMode')?.value || 'merge';
  const interval = Number(document.getElementById('blPushInterval')?.value || 0);

  // second confirmation after ticking — enabling is itself a decision worth
  // stopping on, separate from any individual sync
  if (!confirm(_blT('blpush.enableConfirm',
    'ยืนยันเปิดใช้งานการส่งข้อมูลกลับไปยังระบบต้นทาง?\n\nระบบจะบันทึกชื่อผู้ยอมรับและเวลาไว้ในบันทึกการตรวจสอบ'))) return;

  // replace deletes rows in somebody else's system — same bar as destroying our
  // own data, and asked for separately from the general acceptance above
  let confirmWord;
  if (mode === 'replace') {
    const typed = prompt(
      `${_blT('blpush.replaceWarn', 'replace จะลบข้อมูลที่ต้นทางมีแต่เราไม่มี — เป็นการลบข้อมูลในระบบของหน่วยงานอื่น ต้องพิมพ์ CONFIRM ยืนยันอีกครั้ง')}\n\n` +
      `"${_blPush.source.label}"\n\n${_blT('blset.typeConfirm', 'พิมพ์ CONFIRM เพื่อยืนยัน')}`);
    if (typed !== 'CONFIRM') return;
    confirmWord = 'CONFIRM';
  }
  await _blPushGate(true, { mode, types, interval_hours: interval, auto: interval > 0, confirm: confirmWord });
}

async function blPushDisable() { await _blPushGate(false); }

async function _blPushGate(enabled, extra = {}) {
  try {
    const r = await fetch(`${API}/api/blacklist/sources/${_blPush.id}/push-enable`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enabled, accepted: enabled, ...extra }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blPush.source = { ..._blPush.source, ...j };
    _blRenderPush();
    loadBlacklistSources();
  } catch (e) { alert(_blT('blset.saveFail', 'บันทึกไม่สำเร็จ') + ': ' + e.message); }
}

async function blPushApply() {
  const p = _blPush;
  // per-sync confirmation, every time — the count and checksum are in the text
  // so the operator confirms a specific diff, not "sync" in the abstract
  if (!confirm(`${_blT('blpush.applyConfirm', 'ยืนยันส่งข้อมูลกลับไปยังต้นทาง')}\n\n` +
               `${p.source.label}\n` +
               `${_blT('blpush.willPush', 'รายการที่จะส่งกลับ')}: ${p.pushable_count}\n` +
               `${_blT('blpush.checksum', 'รหัสตรวจสอบ')}: ${p.checksum}\n\n` +
               `${_blT('blpush.applyWarn', 'การกระทำนี้จะแก้ไขข้อมูลในระบบของหน่วยงานต้นทาง')}`)) return;
  try {
    const r = await fetch(`${API}/api/blacklist/sources/${p.id}/push-apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ checksum: p.checksum }),
    });
    const j = await r.json();
    if (j.code === 'dry_run' || j.code === 'replace_not_live' || j.code === 'no_transmitter') {
      alert(`${_blT('blpush.dryRunDone', 'โหมดทดสอบ — ไม่ได้ส่งข้อมูลออกไปจริง')}\n\n${j.error}`);
      return;
    }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    alert(`${_blT('blpush.done', 'ส่งกลับเรียบร้อย')} — ${j.sent} ${_blT('blset.records', 'ระเบียน')}`);
    blOpenPush(p.id);
  } catch (e) { alert(_blT('blpush.fail', 'ส่งกลับไม่สำเร็จ') + ': ' + e.message); }
}

function _blOpenTypePicker() {
  document.getElementById('blSrcModalTitle').textContent = _blT('blset.pickType', 'เลือกประเภทแหล่งข้อมูล');
  document.getElementById('blSrcModalBody').innerHTML =
    `<div class="src2-grid">${BL_TYPES.filter(t => !t.hidden).map(t => `
      <button class="src2-card" type="button" data-action="blPickType" data-type="${t.id}">
        <div class="src2-name">${_blEsc(t.name)}</div>
        <div class="src2-type-badges">${t.types.map(d => `<span class="type-badge ${d}">${BL_TYPE_LABEL[d]}</span>`).join('')}</div>
        <span class="src2-status ${t.wiredTypes.length ? 'live' : 'placeholder'}">${t.wiredTypes.length ? _blEsc(_blT('blset.live', 'เชื่อมต่อจริงได้')) : _blEsc(_blT('blset.planned', 'ออกแบบรอไว้ก่อน'))}</span>
      </button>`).join('')}</div>`;
  document.getElementById('blSrcModal').classList.remove('hidden');
}

// Data that was imported under a type this connection no longer pulls. It is
// hidden from the rosters and from alerting, but it still exists — so it has to
// be visible and actionable SOMEWHERE, and the connection's own settings is the
// only place an operator would think to look. Without this the rows sit hidden
// forever with nothing to say they are there (which is how 516 LPR records ended
// up invisible inside a face-only connection).
function _blOrphanPanel(existing) {
  if (!existing) return '';
  const counts = existing.type_counts || {};
  const orphans = existing.orphan_types || [];
  const kept = (existing.kept_types || []).filter(t => counts[t]);
  if (!orphans.length && !kept.length) return '';

  const row = (dt, hidden) => `
    <div class="bl-orphan-row">
      <span>
        <b>${BL_TYPE_LABEL[dt] || _blEsc(dt)}</b>
        — ${Number(counts[dt] || 0).toLocaleString()} ${_blEsc(_blT('blset.records', 'ระเบียน'))}
        <span class="bl-orphan-state">${_blEsc(hidden
          ? _blT('blset.orphanHidden', 'เลิกนำเข้าแล้ว · ซ่อนอยู่')
          : _blT('blset.orphanKept', 'เลิกนำเข้าแล้ว · ยังแสดงอยู่'))}</span>
      </span>
      <span class="bl-orphan-actions">
        <button class="csv-btn" data-action="blOrphan" data-act="${hidden ? 'keep' : 'hide'}" data-dt="${dt}">
          ${_blEsc(hidden ? _blT('blset.orphanShow', 'แสดงต่อ') : _blT('blset.orphanHide', 'ซ่อน'))}
        </button>
        <button class="csv-btn danger" data-action="blOrphan" data-act="delete" data-dt="${dt}">
          ${_blEsc(_blT('blset.orphanDelete', 'ลบถาวร'))}
        </button>
      </span>
    </div>`;

  return `
    <div class="cfg-row bl-orphan-box">
      <label>${_blEsc(_blT('blset.orphanTitle', 'ข้อมูลที่เลิกนำเข้าแล้ว'))}</label>
      <div class="bl-orphan-note">${_blEsc(_blT('blset.orphanNote',
        'ข้อมูลชุดนี้ถูกนำเข้ามาก่อนหน้านี้ แต่ประเภทของมันไม่ได้ถูกเลือกใช้แล้ว — ระบบซ่อนไว้ ไม่ได้ลบ · การซ่อน/ลบจะมีผลกับรายการแจ้งเตือนหลังกด sync ที่ Bridge อีกครั้ง'))}</div>
      ${orphans.map(dt => row(dt, true)).join('')}
      ${kept.map(dt => row(dt, false)).join('')}
    </div>`;
}

// Acts on one orphaned type. Destroying data asks for CONFIRM typed out — the
// same bar the API enforces server-side, so a caller that skips the prompt is
// still refused rather than silently obeyed.
async function blOrphanAction(el) {
  const form = document.querySelector('#blSrcModalBody .cfg-form');
  const id = form && form.dataset.srcId;
  if (!id) return;
  const act = el.dataset.act, dt = el.dataset.dt;
  const label = BL_TYPE_LABEL[dt] || dt;
  const body = { action: act, data_type: dt };

  if (act === 'delete') {
    const src = _blSources.find(s => String(s.id) === String(id));
    const n = Number((src && src.type_counts && src.type_counts[dt]) || 0).toLocaleString();
    const typed = prompt(
      `${_blT('blset.orphanDeleteWarn', 'ลบถาวร — กู้คืนไม่ได้')}\n\n` +
      `${label} · ${n} ${_blT('blset.records', 'ระเบียน')}\n` +
      `"${src ? src.label : ''}"\n\n` +
      `${_blT('blset.typeConfirm', 'พิมพ์ CONFIRM เพื่อยืนยัน')}`);
    if (typed !== 'CONFIRM') return;
    body.confirm = 'CONFIRM';
  }

  try {
    const r = await fetch(`${API}/api/blacklist/sources/${id}/orphans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    await loadBlacklistSources();
    const fresh = _blSources.find(s => String(s.id) === String(id));
    if (fresh) _blOpenSourceForm(fresh.source_type, fresh);   // redraw the panel
  } catch (e) {
    alert(_blT('blset.orphanFail', 'ทำรายการไม่สำเร็จ') + ': ' + e.message);
  }
}

function _blOpenSourceForm(typeId, existing) {
  const t = _blType(typeId);
  if (!t) return;
  document.getElementById('blSrcModalTitle').textContent =
    (existing ? _blT('common.edit', 'แก้ไข') : _blT('common.add', 'เพิ่ม')) + ' — ' + t.name;
  const cfg = (existing && existing.config) || {};
  const enabled = existing ? (existing.data_types || []) : t.types.slice();
  const fields = t.fields || [];

  document.getElementById('blSrcModalBody').innerHTML = `
    <div class="cfg-form" data-src-id="${existing ? existing.id : ''}" data-type-id="${t.id}">
      ${existing ? '' : `<span class="cfg-back-link" data-action="blBackToTypes">&larr; ${_blEsc(_blT('blset.changeType', 'เปลี่ยนประเภท'))}</span>`}
      <div class="cfg-row">
        <label>${_blEsc(_blT('blset.label', 'ชื่อการเชื่อมต่อ'))}</label>
        <input class="form-input" id="blSrcLabel" value="${_blEsc(existing ? existing.label : '')}" placeholder="${_blEsc(t.name)} — Site HDY">
      </div>
      <div class="cfg-row">
        <label>Site code</label>
        <input class="form-input" id="blSrcSite" value="${_blEsc(existing ? (existing.site_code || '') : '')}" placeholder="hdy">
      </div>
      <div class="cfg-row"${t.types.length ? '' : ' hidden'}>
        <label>${_blEsc(_blT('blset.dataTypes', 'ประเภทข้อมูลที่ใช้งาน'))}</label>
        <div class="cfg-type-toggles">
          ${t.types.map(d => `<span class="cfg-type-toggle ${enabled.includes(d) ? 'on' : ''} ${t.wiredTypes.includes(d) ? '' : 'notwired'}" data-action="blToggleType" data-dt="${d}">${BL_TYPE_LABEL[d]}${t.wiredTypes.includes(d) ? '' : ' (' + _blEsc(_blT('blset.pending', 'รอเชื่อมจริง')) + ')'}</span>`).join('')}
        </div>
      </div>
      ${t.importable ? `
      <div class="cfg-row">
        <label>${_blEsc(_blT('blset.autoPull', 'นำเข้าอัตโนมัติ'))}</label>
        <select class="form-input" id="blSrcPull">
          <option value="0">${_blEsc(_blT('blset.autoPullOff', 'ปิด — นำเข้าเมื่อกดเองเท่านั้น'))}</option>
          ${[10, 30, 60, 180, 360, 720, 1440, 2880].map((m) => {
            const cur = existing ? (existing.pull_interval_minutes ?? (existing.pull_interval_hours || 0) * 60) : 0;
            const lbl = m < 60
              ? `${m} ${_blT('blset.minutes', 'นาที')}`
              : `${m / 60} ${_blT('blset.hours', 'ชั่วโมง')}`;
            return `<option value="${m}"${cur === m ? ' selected' : ''}>${_blEsc(_blT('blset.every', 'ทุก'))} ${_blEsc(lbl)}</option>`;
          }).join('')}
        </select>
        ${existing && existing.last_auto_pull_at ? `<div class="inline-note">${_blEsc(_blT('blset.lastAutoPull', 'นำเข้าอัตโนมัติล่าสุด'))}: ${_blDT(existing.last_auto_pull_at)}</div>` : ''}
      </div>` : ''}
      ${_blOrphanPanel(existing)}
      ${fields.length ? fields.map(f => `
        <div class="cfg-row">
          <label>${_blEsc(f.label)}</label>
          <input class="form-input" type="${f.type}" id="blSrcF_${f.key}"
                 value="${f.type === 'password' ? '' : _blEsc(cfg[f.key] || '')}"
                 placeholder="${f.type === 'password' && existing ? _blEsc(_blT('blset.keepSecret', 'เว้นว่าง = ใช้ค่าเดิม')) : _blEsc(f.ph || '')}" autocomplete="off">
        </div>`).join('')
      : (t.hidden ? '' : `<div class="placeholder-note">${_blEsc(_blT('blset.notWired', 'แหล่งข้อมูลนี้ยังไม่เชื่อมต่อจริง — บันทึกไว้เป็นรายการที่ตั้งใจจะใช้ก่อนได้'))}</div>`)}
      ${t.wiredTypes.length ? `<div><button class="btn btn-secondary" data-action="blTestSource">${_blEsc(_blT('blset.test', 'ทดสอบการเชื่อมต่อ'))}</button></div><div id="blSrcResult"></div>` : ''}
      <div style="margin-top:12px"><button class="btn btn-primary" data-action="blSaveSource">${_blEsc(_blT('common.save', 'บันทึก'))}</button></div>
    </div>`;
  document.getElementById('blSrcModal').classList.remove('hidden');
}

function _blFormPayload() {
  const form = document.querySelector('#blSrcModalBody .cfg-form');
  const t = _blType(form.dataset.typeId);
  const config = {};
  for (const f of (t.fields || [])) {
    const el = document.getElementById('blSrcF_' + f.key);
    if (el) config[f.key] = el.value.trim();
  }
  return {
    id: form.dataset.srcId || null,
    source_type: t.id,
    label: document.getElementById('blSrcLabel').value.trim() || t.name,
    site_code: document.getElementById('blSrcSite').value.trim() || null,
    data_types: Array.from(form.querySelectorAll('.cfg-type-toggle.on')).map(el => el.dataset.dt),
    pull_interval_minutes: Number(document.getElementById('blSrcPull')?.value || 0),
    config,
  };
}

async function blSaveSource() {
  const p = _blFormPayload();
  try {
    const r = await fetch(`${API}/api/blacklist/sources${p.id ? '/' + p.id : ''}`, {
      method: p.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    document.getElementById('blSrcModal').classList.add('hidden');
    loadBlacklistSources();
  } catch (e) { alert(_blT('blset.saveFail', 'บันทึกไม่สำเร็จ') + ': ' + e.message); }
}

const BL_DISC_TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

// Testing a connection asks the source what it actually holds, rather than
// confirming what the operator already ticked. The DSS Pro catalogue entry
// claimed face-only while the same server served 516 blocklisted vehicles —
// nobody had asked it. The discovered answer now drives the type toggles.
async function blTestSource() {
  const p = _blFormPayload();
  const out = document.getElementById('blSrcResult');
  const t = _blType(p.source_type);
  out.innerHTML = `<div class="inline-note">${_blEsc(_blT('blset.testing', 'กำลังทดสอบ...'))}</div>`;
  try {
    const r = await fetch(`${API}/api/blacklist/sources/discover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ source: p.source_type, site_code: p.site_code || 'hdy', config: p.config, source_id: p.id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (j.error && !j.face?.available && !j.lpr?.available) throw new Error(j.error);
    _blRenderDiscovery(out, t, j);
  } catch (e) {
    out.innerHTML = `<div class="cfg-result err"><div class="cfg-result-head">${_blEsc(_blT('blset.fail', 'เชื่อมต่อไม่สำเร็จ'))}</div>${_blEsc(e.message)}</div>`;
  }
}

function _blRenderDiscovery(out, t, found) {
  // discovery is the truth: tick what exists, untick what doesn't, so step 4
  // (import) can only ever run against data the source really has
  for (const dt of t.types) {
    const tog = document.querySelector(`.cfg-type-toggle[data-dt="${dt}"]`);
    if (tog) tog.classList.toggle('on', !!found[dt]?.available && t.wiredTypes.includes(dt));
  }
  const rows = t.types.map(dt => {
    const f = found[dt] || {};
    const wired = t.wiredTypes.includes(dt);
    const on = !!f.available && wired;
    const note = !f.available ? _blT('blset.discNone', 'ไม่พบข้อมูลที่ต้นทาง')
      : !wired ? _blT('blset.discNotWired', 'พบข้อมูล แต่ตัวนำเข้ายังไม่พร้อม')
      : (f.label || '');
    // a real <button> so Space/Enter toggle it without a bespoke keydown handler
    const pickable = f.available && wired;
    const tag = pickable ? 'button' : 'div';
    return `<${tag} class="disc-row ${on ? 'on' : ''} ${pickable ? '' : 'disabled'}"
                 ${pickable ? `type="button" role="checkbox" aria-checked="${on}" data-action="blPickDiscovered" data-dt="${dt}"` : ''}>
        <span class="disc-box" aria-hidden="true">${on ? BL_DISC_TICK : ''}</span>
        <span class="disc-name">${BL_TYPE_LABEL[dt]}<small>${_blEsc(note)}</small></span>
        <span class="disc-count">${f.available && Number.isFinite(Number(f.count)) ? Number(f.count).toLocaleString() : '—'}</span>
      </${tag}>` +
      (f.groups?.length ? f.groups.map(g =>
        `<div class="cfg-group-row"><span>${_blEsc(g.name)}</span><span>${Number(g.personCount || 0).toLocaleString()}</span></div>`).join('') : '');
  }).join('');
  const any = t.types.some(dt => found[dt]?.available);
  out.innerHTML = `<div class="cfg-result ${any ? 'ok' : 'err'}">
      <div class="cfg-result-head">${_blEsc(any
        ? _blT('blset.discFound', 'ตรวจพบข้อมูลที่ต้นทาง — เลือกประเภทที่ต้องการนำเข้า')
        : _blT('blset.discEmpty', 'เชื่อมต่อได้ แต่ไม่พบข้อมูลที่นำเข้าได้'))}</div>
      ${rows}
      ${found.error ? `<div class="inline-note">${_blEsc(found.error)}</div>` : ''}
      <div class="inline-note">${_blEsc(_blT('blset.discHint', 'ตัวเลขคือจำนวนที่ต้นทางรายงาน ยังไม่ได้นำเข้า — กดบันทึกแล้วจึงสั่งนำเข้าอีกครั้ง'))}</div>
    </div>`;
}

// keeps the discovery checkbox and the type toggle as one piece of state
function blPickDiscovered(el) {
  const dt = el.dataset.dt;
  const tog = document.querySelector(`.cfg-type-toggle[data-dt="${dt}"]`);
  if (!tog) return;
  const on = !tog.classList.contains('on');
  tog.classList.toggle('on', on);
  el.classList.toggle('on', on);
  el.setAttribute('aria-checked', String(on));
  el.querySelector('.disc-box').innerHTML = on ? BL_DISC_TICK : '';
}

async function blRunImport(id) {
  const src = _blSources.find(s => String(s.id) === String(id));
  if (!src) return;
  // One connection can carry both sides (DSS Pro serves faces AND vehicles), and
  // the backend imports exactly one data_type per call — so run each enabled type
  // in turn. Sending no dataType would silently import only the face side.
  const t = _blType(src.source_type);
  const types = (src.data_types || []).filter(d => (t?.wiredTypes || []).includes(d));
  if (!types.length) { alert(_blT('blset.noTypes', 'ยังไม่ได้เลือกประเภทข้อมูลที่นำเข้าได้ — กดทดสอบการเชื่อมต่อก่อน')); return; }
  if (!confirm(_blT('blset.confirmImport', 'เริ่มนำเข้าข้อมูลจาก') + ' "' + src.label + '"?\n\n' +
               types.map(d => '• ' + BL_TYPE_LABEL[d]).join('\n'))) return;
  const btn = document.querySelector(`[data-action="blRunImport"][data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = _blT('blset.importing', 'กำลังนำเข้า...'); }
  try {
    // The server now answers 202 and works in the background, so this fires the
    // requests and then watches last_import_status instead of holding a
    // connection open for minutes — which Cloudflare cuts at ~100s and replaces
    // with an HTML error page, the "Unexpected token '<'" of 2026-07-27.
    for (const dt of types) {
      const r = await fetch(`${API}/api/blacklist/sources/${id}/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ dataType: dt }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) throw new Error(_blT('blset.importBusy', 'มีการนำเข้าของแหล่งนี้ค้างอยู่ รอให้เสร็จก่อน'));
      if (!r.ok && r.status !== 202) throw new Error(`${BL_TYPE_LABEL[dt]}: ${j.error || 'HTTP ' + r.status}`);
    }
    await _blWatchImport(id, btn);
  } catch (e) {
    alert(_blT('blset.importFail', 'นำเข้าไม่สำเร็จ') + ': ' + e.message);
  } finally {
    loadBlacklistSources();
  }
}

async function blDeleteSource(id) {
  const src = _blSources.find(s => String(s.id) === String(id));
  if (!src) return;
  const n = Number(src.record_count).toLocaleString();

  // Two different intents were sharing one yes/no box: "stop importing from
  // here" and "destroy what we imported". They are now asked separately, and
  // only the destructive one costs a typed CONFIRM.
  const keep = confirm(
    `${_blT('blset.delAsk', 'ลบการเชื่อมต่อนี้')} "${src.label}"\n\n` +
    `${_blT('blset.delKeepAsk', 'เก็บข้อมูลที่นำเข้าไว้ในระบบด้วยหรือไม่?')}\n` +
    `${_blT('blset.delRecords', 'ข้อมูลที่นำเข้า')}: ${n} ${_blT('blset.records', 'ระเบียน')}\n\n` +
    `${_blT('blset.delKeepYes', 'ตกลง = เก็บข้อมูลไว้ (ซ่อนไว้ จัดการได้ภายหลัง)')}\n` +
    `${_blT('blset.delKeepNo', 'ยกเลิก = ลบข้อมูลทิ้งถาวรด้วย')}`);

  const body = { keep: true };
  if (!keep) {
    const typed = prompt(
      `${_blT('blset.orphanDeleteWarn', 'ลบถาวร — กู้คืนไม่ได้')}\n\n` +
      `"${src.label}" — ${n} ${_blT('blset.records', 'ระเบียน')}\n\n` +
      `${_blT('blset.typeConfirm', 'พิมพ์ CONFIRM เพื่อยืนยัน')}`);
    if (typed !== 'CONFIRM') return;
    body.keep = false;
    body.confirm = 'CONFIRM';
  }

  try {
    const r = await fetch(`${API}/api/blacklist/sources/${id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    loadBlacklistSources();
  } catch (e) { alert(_blT('blset.deleteFail', 'ลบไม่สำเร็จ') + ': ' + e.message); }
}

// MultiPicker reports selection through a bubbling `mp:change` CustomEvent
// (dashboard/multipicker.js:95) rather than a native change on the hidden
// <select>, so the generic data-change dispatcher never sees it. One delegated
// listener, scoped to this page's two pickers.
document.addEventListener('mp:change', (e) => {
  const id = e.detail && e.detail.id;
  if (id === 'blFaceGroup' || id === 'blFaceOrg') _blApplyFilter('face');
});

// ============================================================
// Settings › ฐานข้อมูลใบหน้า / ฐานข้อมูลป้ายทะเบียน
// ============================================================
// Only settings that map to something the data actually has. No speculative
// knobs: page size and the two privacy defaults are the whole surface, plus a
// read-only summary so an admin can see what the reservoir holds without
// leaving the settings screen.
async function loadBlacklistPageSettings(dataType) {
  const cfgEl = document.getElementById(dataType === 'face' ? 'blFaceCfg' : 'blLprCfg');
  const stEl  = document.getElementById(dataType === 'face' ? 'blFaceCfgStats' : 'blLprCfgStats');
  if (!cfgEl) return;
  cfgEl.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  await _blLoadSettings(true);

  const sizeKey = dataType === 'face' ? 'bl_face_page_size' : 'bl_lpr_page_size';
  const rows = [];
  if (dataType === 'face') {
    rows.push({
      key: 'bl_face_blur_default', type: 'bool',
      label: _blT('blcfg.blurFace', 'เบลอภาพใบหน้าเป็นค่าเริ่มต้น'),
      hint: _blT('blcfg.blurFaceHint', 'เปิดหน้าฐานข้อมูลมาแล้วใบหน้าจะเบลอไว้ก่อน ผู้ใช้กดปุ่มรูปตาเพื่อดูได้'),
    });
    rows.push({
      key: 'bl_id_mask_default', type: 'bool',
      label: _blT('blcfg.maskId', 'ปิดบังเลขบัตรประชาชนเป็นค่าเริ่มต้น'),
      hint: _blT('blcfg.maskIdHint', 'แสดงเป็น 19xxxxxxxxx12 · การกดดูเลขเต็มต้องเป็น admin และถูกบันทึกใน Audit Log ทุกครั้ง'),
    });
  }
  rows.push({
    key: sizeKey, type: 'select', options: ['25', '50', '100', '200'], def: '50',
    label: _blT('blcfg.pageSize', 'จำนวนรายการต่อหน้า'),
    hint: _blT('blcfg.pageSizeHint', 'ยิ่งมากยิ่งโหลดรูปเยอะขึ้นต่อหน้า'),
  });
  if (dataType === 'lpr') {
    // The duplicate page paginates by GROUP, not by record — 25 groups can be
    // 60+ rows, so it needs its own smaller default than the tile grid's.
    rows.push({
      key: 'bl_dup_page_size', type: 'select', options: ['10', '25', '50', '100'], def: '25',
      label: _blT('blcfg.dupPageSize', 'จำนวนชุดทะเบียนซ้ำต่อหน้า'),
      hint: _blT('blcfg.dupPageSizeHint', 'หน้าตรวจสอบทะเบียนซ้ำ — นับเป็น "ชุด" ไม่ใช่ระเบียน (1 ชุด = 1 ทะเบียนที่ซ้ำกันหลายระเบียน)'),
    });
  }

  cfgEl.innerHTML = rows.map(r => {
    const v = _blSettings[r.key];
    // A stored value that matches no option would leave nothing selected, so the
    // browser silently falls back to option[0] (25) — and the next Save would
    // persist that wrong value without anyone touching the control. Resolve to
    // the documented default instead when there's no match.
    const chosen = (r.type === 'select' && !r.options.includes(String(v))) ? r.def : String(v);
    const ctrl = r.type === 'bool'
      ? `<label class="blcfg-switch"><input type="checkbox" data-blcfg="${r.key}" ${v !== 'false' ? 'checked' : ''}><span></span></label>`
      : `<select class="form-input blcfg-select" data-blcfg="${r.key}">${r.options.map(o => `<option value="${o}"${chosen === o ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
    return `<div class="blcfg-row">
      <div class="blcfg-text"><div class="blcfg-label">${_blEsc(r.label)}</div><div class="blcfg-hint">${_blEsc(r.hint)}</div></div>
      <div class="blcfg-ctrl">${ctrl}</div>
    </div>`;
  }).join('')
  + `<div class="blcfg-actions"><button class="btn btn-primary" data-action="blSavePageSettings" data-dt="${dataType}">${_blEsc(_blT('common.save', 'บันทึก'))}</button>
       <span class="blcfg-saved" id="blcfgSaved_${dataType}"></span></div>`;

  // read-only reality check
  if (stEl) {
    stEl.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
    try {
      const r = await fetch(`${API}/api/blacklist/stats?data_type=${dataType}`, { credentials: 'include' });
      const s = await r.json();
      const items = [
        [_blT('bl.kpiIdentities', 'รายชื่อในถังกลาง'), s.identities],
        [_blT('bl.kpiRecords', 'ระเบียนจากต้นทาง'), s.records],
        [_blT('bl.kpiSources', 'แหล่งข้อมูล'), s.sources],
      ];
      if (dataType === 'lpr') {
        items.push([_blT('bl.kpiPlates', 'ทะเบียนที่ไม่ซ้ำ'), s.plates]);
        items.push([_blT('bl.kpiDupPlates', 'ทะเบียนซ้ำ'), s.dup_plates]);
      } else {
        items.push([_blT('bl.qDupName', 'ชื่อซ้ำ แต่เลขบัตรไม่ตรง'), s.dup_name_groups]);
        items.push([_blT('bl.qBadId', 'เลขบัตรไม่ถูกต้อง'), s.invalid_id_count]);
      }
      stEl.innerHTML = items.map(([k, v]) =>
        `<div class="blcfg-stat"><span>${_blEsc(k)}</span><b>${Number(v || 0).toLocaleString()}</b></div>`).join('')
        + (s.by_source || []).map(x =>
          `<div class="blcfg-stat blcfg-stat-sub"><span>${_blEsc(x.label)}</span><b>${Number(x.n).toLocaleString()}</b></div>`).join('');
    } catch { stEl.innerHTML = ''; }
  }
}

async function blSavePageSettings(dataType) {
  const scope = document.getElementById(dataType === 'face' ? 'blFaceCfg' : 'blLprCfg');
  const body = {};
  scope.querySelectorAll('[data-blcfg]').forEach(el => {
    body[el.dataset.blcfg] = el.type === 'checkbox' ? String(el.checked) : el.value;
  });
  try {
    const r = await fetch(`${API}/api/blacklist/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await _blLoadSettings(true);   // re-apply immediately, no reload needed
    const s = document.getElementById('blcfgSaved_' + dataType);
    if (s) { s.textContent = _blT('blcfg.saved', 'บันทึกแล้ว'); setTimeout(() => { s.textContent = ''; }, 2500); }
  } catch (e) {
    alert(_blT('blset.saveFail', 'บันทึกไม่สำเร็จ') + ': ' + e.message);
  }
}

// ============================================================
// Local corrections — edit / exclude one source record
// ============================================================
// We cannot edit DSS Pro or GuruSquare (third-party systems, no authority), so
// corrections are stored on our side as an override layer and the source mirror
// is left untouched. That is why this editor always shows BOTH values: an
// operator must be able to see what the source claims versus what we corrected,
// especially when explaining a discrepancy back to the owning unit.
let _blEditRec = null;

// ---------- ช่องรูปของฟอร์มแก้ไข ----------
// เขียนใหม่ทั้งบล็อกเป็น "render จาก state" หลังเจอบั๊ก 2 ตัวที่มาจากการไล่แก้ DOM เอง
// ทีละชิ้น (2026-08-13 เจ้าของอัปรูปสองรอบแล้วพัง):
//   1. id `blPhotoPreview` ถูกวางไว้บน <img> เท่านั้น ⇒ ระเบียนที่ยังไม่มีรูปจะหา
//      element นี้ไม่เจอ พรีวิวเลยไม่เคยอัปเดตในการอัปโหลดครั้งแรก
//   2. ตัวแปรปุ่ม "ใช้ค่าต้นทาง" ถูกจับไว้ตอนเปิด modal และค้างเป็น null ตลอด
//      ⇒ ทุกครั้งที่อัปสำเร็จจะ "สร้างปุ่มใหม่" ซ้ำ อัปสองรอบได้สองปุ่ม
// ทั้งคู่หายไปเองเมื่อมีทางเดียวที่วาดหน้าจอ และวาดจาก state เสมอ
const _BL_PHOTO_MAX = 8 * 1024 * 1024;

function _blPhotoUploading(on, msg, cls) {
  const st = document.getElementById('blPhotoStatus');
  if (st) { st.textContent = msg || ''; st.className = 'bl-photo-status' + (cls ? ' ' + cls : ''); }
  const zone = document.getElementById('blPhotoZone');
  if (zone) zone.classList.toggle('busy', !!on);
}

function _blRenderPhotoBox() {
  const box = document.getElementById('blPhotoBox');
  if (!box || !_blEditRec) return;
  const src = _blEditRec.source || {}, ov = _blEditRec.override || {};
  const shown = ov.photo_path || src.photo_path;
  const isOverride = !!ov.photo_path;

  box.innerHTML = `
    <div class="bl-photo-zone${shown ? ' has-img' : ''}" id="blPhotoZone" tabindex="0"
         role="button" aria-label="${_blEsc(_blT('bl.photoDrop', 'ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์'))}">
      ${shown
        ? `<img src="${API}/api/blacklist/photo/${_blPhotoUrl(shown)}${_blEditRec._photoV ? `?v=${_blEditRec._photoV}` : ''}" alt="" data-err="hide">`
        : `<div class="bl-photo-ph">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/><path d="M19 17v5M16.5 19.5h5"/></svg>
             <span>${_blEsc(_blT('bl.photoDrop', 'ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์'))}</span>
           </div>`}
      <div class="bl-photo-over">${_blEsc(_blT('bl.photoDropNow', 'วางเพื่ออัปโหลด'))}</div>
    </div>
    <div class="bl-photo-side">
      <input type="file" id="blPhotoInput" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      <button type="button" class="btn btn-secondary btn-sm" id="blPhotoChooseBtn">${
        _blEsc(shown ? _blT('bl.changePhoto', 'เปลี่ยนรูป') : _blT('bl.uploadPhoto', 'เลือกรูป'))}</button>
      ${isOverride ? `<button type="button" class="btn btn-ghost btn-sm" id="blPhotoRevertBtn">${_blEsc(_blT('bl.revert', 'ใช้ค่าต้นทาง'))}</button>` : ''}
      <div class="bl-photo-hint">${_blEsc(_blT('bl.photoHint', 'PNG / JPEG / WebP / GIF · ไม่เกิน 8 MB'))}</div>
      <div class="bl-photo-status" id="blPhotoStatus"></div>
    </div>`;

  const zone = document.getElementById('blPhotoZone');
  const input = document.getElementById('blPhotoInput');
  const pick = () => input.click();
  document.getElementById('blPhotoChooseBtn').addEventListener('click', pick);
  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  input.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) _blUploadPhoto(f); e.target.value = ''; });

  // dragover ต้อง preventDefault ทุกครั้ง ไม่งั้นเบราว์เซอร์จะเปิดไฟล์ทับหน้าจอแทน
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('drag');
  }));
  ['dragleave', 'dragend'].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove('drag')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) _blUploadPhoto(f);
  });

  const rb = document.getElementById('blPhotoRevertBtn');
  if (rb) rb.addEventListener('click', () => {
    _blEditRec.override.photo_path = null;
    _blRenderPhotoBox();
  });
}

async function _blUploadPhoto(file) {
  // ดักที่ฝั่งเราก่อนเพื่อบอกเหตุผลได้ทันทีโดยไม่ต้องรอ round-trip — ด่านจริงยังอยู่
  // ที่ server (magic bytes ใน helpers/imageMagic.js) ตรงนี้ไม่ใช่ตัวกันความปลอดภัย
  if (file.size > _BL_PHOTO_MAX) {
    _blPhotoUploading(false, _blT('bl.photoTooBig', 'ไฟล์ใหญ่เกิน 8 MB'), 'err');
    return;
  }
  _blPhotoUploading(true, _blT('bl.uploading', 'กำลังอัปโหลด...'));
  try {
    const fd = new FormData();
    fd.append('photo', file);
    const r = await fetch(`${API}/api/blacklist/record/${_blEditRec.id}/photo`, {
      method: 'POST', credentials: 'include', body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blEditRec.override.photo_path = j.photo_path;
    // savePhoto() เขียนทับไฟล์เดิมที่ path เดิมโดยตั้งใจ (`<external_id>_ov`) เพื่อไม่ให้
    // รูป override งอกไฟล์ใหม่ทุกครั้งที่แก้ ⇒ **URL ไม่เปลี่ยน** และเบราว์เซอร์จะโชว์
    // รูปเดิมที่ cache ไว้ · นี่คือเหตุผลจริงที่ "อัปรอบสองแล้วเหมือนไม่ผ่าน"
    // ต่อ ?v= เฉพาะตอนแสดงผล — ค่าที่บันทึกลง override ยังเป็น path เปล่าเหมือนเดิม
    _blEditRec._photoV = Date.now();
    _blRenderPhotoBox();
    _blPhotoUploading(false, _blT('bl.photoUploaded', 'อัปโหลดแล้ว — กดบันทึกเพื่อยืนยัน'), 'ok');
  } catch (err) {
    _blPhotoUploading(false, _blT('bl.uploadFail', 'อัปโหลดไม่สำเร็จ') + ': ' + err.message, 'err');
  }
}

async function _blOpenEdit(srecId) {
  const modal = document.getElementById('blEditModal');
  const body = document.getElementById('blEditBody');
  body.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  modal.classList.remove('hidden');
  try {
    const r = await fetch(`${API}/api/blacklist/record/${srecId}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    _blEditRec = d;
    const src = d.source || {}, ov = d.override || {};
    const cur = (k, fallback) => (ov[k] != null ? ov[k] : fallback);

    // บรรทัด "ต้นทางระบุ" เดิมขึ้นใต้ทุกช่องเสมอ — ช่องที่ต้นทางไม่ได้ส่งอะไรมาเลยจะได้
    // "ต้นทางระบุ: —" ซ้ำ ๆ กัน 6 บรรทัด ซึ่งไม่ได้บอกอะไรนอกจากทำให้ฟอร์มยาวขึ้นเท่าตัว
    // ตอนนี้แสดงเฉพาะตอนที่มันมีความหมายจริง: เราแก้ทับไว้ (ต้องเห็นค่าเดิม + ปุ่มคืนค่า)
    // หรือค่าที่แสดงอยู่ไม่ตรงกับต้นทาง
    const row = (key, label, srcVal, ovVal, isArr, opts = {}) => {
      const shown = ovVal != null ? (isArr ? ovVal.join(', ') : ovVal) : (isArr ? (srcVal || []).join(', ') : (srcVal || ''));
      const srcTxt = isArr ? (srcVal || []).join(', ') : (srcVal || '');
      const edited = ovVal != null;
      const showSrc = edited || (srcTxt && srcTxt !== shown);
      return `
        <div class="bl-edit-row${edited ? ' edited' : ''}${opts.full ? ' full' : ''}${opts.wide ? ' wide' : ''}">
          <label class="form-label" for="blEdit_${key}">${_blEsc(label)}${
            edited ? `<span class="bl-edit-tag">${_blEsc(_blT('bl.fieldEdited', 'แก้แล้ว'))}</span>` : ''}</label>
          <input class="form-input" id="blEdit_${key}" value="${_blEsc(shown)}"
                 placeholder="${_blEsc(opts.ph || '')}">
          ${showSrc ? `<div class="bl-edit-src">
            ${_blEsc(_blT('bl.srcSays', 'ต้นทางระบุ'))}: <span>${_blEsc(srcTxt || '—')}</span>
            ${edited ? `<button type="button" class="bl-edit-revert" data-action="blRevertField" data-k="${key}">${_blEsc(_blT('bl.revert', 'ใช้ค่าต้นทาง'))}</button>` : ''}
          </div>` : ''}
        </div>`;
    };
    const sec = (title, inner) => `
      <section class="bl-edit-sec">
        <h3 class="bl-edit-sec-h">${_blEsc(title)}</h3>
        <div class="bl-edit-grid">${inner}</div>
      </section>`;

    const isLpr = d.data_type === 'lpr';
    body.innerHTML = `
      <div class="bl-edit-form">
      <div class="bl-edit-head">
        <span class="bl-src bl-src-neutral"><span class="bl-src-dot"></span>${_blEsc(d.source_label)}</span>
        <span class="bl-edit-extid">id=${_blEsc(d.external_id)}</span>
      </div>
      <div class="bl-edit-warn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>${_blEsc(_blT('bl.editWarn', 'การแก้ไขเก็บไว้ที่ระบบเราเท่านั้น ไม่ถูกส่งกลับไปแก้ที่ต้นทาง — และจะไม่หายเมื่อนำเข้าข้อมูลรอบถัดไป'))}</span>
      </div>
      ${sec(_blT('bl.secIdentity', 'ข้อมูลหลัก'), `
        ${row('name', isLpr ? _blT('bl.ownerName', 'ชื่อ / หน่วยที่แจ้ง') : _blT('bl.fullName', 'ชื่อ-สกุล'), src.name, ov.name, false, isLpr ? { wide: true } : { full: true })}
        ${isLpr ? row('plate_numbers', _blT('lpr.watchlistPlate', 'ป้ายทะเบียน'), src.plate_numbers, ov.plate_numbers, true) : ''}
        ${row('case_note', _blT('bl.caseNote', 'หมายเหตุ / คดี'), src.case_note, ov.case_note, false, { full: true })}
      `)}
      ${isLpr ? sec(_blT('bl.secVehicle', 'รายละเอียดรถ'), `
        ${row('province', _blT('bl.province', 'จังหวัด'), src.province, ov.province, false)}
        ${row('brand', _blT('bl.brand', 'ยี่ห้อ'), src.brand, ov.brand, false)}
        ${row('vehicle_type', _blT('bl.vehicleType', 'ประเภทรถ'), src.vehicle_type, ov.vehicle_type, false)}
        ${row('vehicle_color', _blT('bl.vehicleColor', 'สีรถ'), src.vehicle_color, ov.vehicle_color, false)}
        ${row('plate_type', _blT('bl.plateType', 'สีป้าย'), src.plate_type, ov.plate_type, false)}
        ${row('case_kind', _blT('bl.caseKind', 'ประเภทคดี'), src.case_kind, ov.case_kind, false)}
      `) : ''}

      <section class="bl-edit-sec">
        <h3 class="bl-edit-sec-h">${_blEsc(_blT('bl.photoLabel', 'ภาพ'))}</h3>
        <div class="bl-edit-photo" id="blPhotoBox"></div>
      </section>

      <div class="bl-edit-danger">
        <div class="bl-edit-danger-head">
          <b>${_blEsc(ov.excluded ? _blT('bl.excludedNow', 'รายการนี้ถูกยกเว้นอยู่') : _blT('bl.excludeTitle', 'ยกเว้นรายการนี้'))}</b>
          <span>${_blEsc(_blT('bl.excludeHint', 'ข้อมูลดิบยังเก็บไว้เป็นหลักฐาน แต่จะไม่เข้าถังกลาง และนำเข้ารอบหน้าจะไม่ดึงกลับมา'))}</span>
        </div>
        ${ov.excluded
          ? `<button class="btn btn-secondary" data-action="blRestoreRecord">${_blEsc(_blT('bl.restore', 'เอากลับเข้าถังกลาง'))}</button>
             ${ov.exclude_reason ? `<div class="bl-edit-src">${_blEsc(_blT('bl.reason', 'เหตุผล'))}: ${_blEsc(ov.exclude_reason)}</div>` : ''}`
          : `<input class="form-input" id="blEditExcReason" placeholder="${_blEsc(_blT('bl.reasonPh', 'เหตุผล เช่น ข้อมูลทดสอบ / ซ้ำ / ผิดพลาด'))}">
             <button class="btn btn-ghost" data-action="blExcludeRecord">${_blEsc(_blT('bl.exclude', 'ยกเว้นรายการนี้'))}</button>`}
      </div>

      <div class="bl-edit-actions">
        <button class="btn btn-primary" data-action="blSaveOverride">${_blEsc(_blT('common.save', 'บันทึก'))}</button>
        <div class="bl-edit-actions-meta">
          ${ov.updated_by ? `<span>${_blEsc(_blT('bl.lastEdited', 'แก้ล่าสุดโดย'))} <b>${_blEsc(ov.updated_by)}</b> · ${_blDT(ov.updated_at)}</span>` : ''}
          <span class="bl-edit-audit">${_blEsc(_blT('bl.auditNote', 'ทุกการแก้ไขถูกบันทึกใน Audit Log รวมถึงที่ทำโดย admin'))}</span>
        </div>
      </div>
      </div>`;

    _blRenderPhotoBox();
  } catch (e) {
    body.innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

// photo_path คือ "<source_id>/<file>.jpg" และ route ปลายทางเป็นสอง segment
// (`/api/blacklist/photo/:sourceId/:file`) — encodeURIComponent ทั้งก้อนจะเปลี่ยน
// "/" เป็น %2F แล้วกลายเป็น segment เดียว → 404 (เจอจริงตอน audit 2026-08-13:
// ตอน render ครั้งแรกใช้เส้นทางหนึ่งซึ่งถูก แต่ปุ่ม "ใช้ค่าต้นทาง" ใช้อีกเส้นทางที่พัง)
// เข้ารหัสทีละ segment จึงได้ทั้งตัวคั่นที่ถูกต้องและกันอักขระแปลกไปพร้อมกัน
function _blPhotoUrl(p) {
  return String(p || '').split('/').map(encodeURIComponent).join('/');
}

function _blRevertField(k) {
  const el = document.getElementById('blEdit_' + k);
  if (!el || !_blEditRec) return;
  const src = _blEditRec.source || {};
  el.value = k === 'plate_numbers' ? (src.plate_numbers || []).join(', ') : (src[k] || '');
}

// Only send fields the operator actually changed away from the source value —
// otherwise every save would write an override for every field and the
// "is this edited?" marker would become meaningless.
function _blCollectOverride() {
  const src = _blEditRec.source || {};
  const body = {};
  const get = id => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
  const name = get('blEdit_name');
  if (name !== null) body.name = (name === (src.name || '')) ? '' : name;
  const note = get('blEdit_case_note');
  if (note !== null) body.case_note = (note === (src.case_note || '')) ? '' : note;
  const plates = get('blEdit_plate_numbers');
  if (plates !== null) {
    const arr = plates.split(',').map(x => x.trim()).filter(Boolean);
    body.plate_numbers = (arr.join(', ') === (src.plate_numbers || []).join(', ')) ? '' : arr;
  }
  // Migration 149 — vehicle/plate fields from roster
  const province = get('blEdit_province');
  if (province !== null) body.province = (province === (src.province || '')) ? '' : province;
  const brand = get('blEdit_brand');
  if (brand !== null) body.brand = (brand === (src.brand || '')) ? '' : brand;
  const vehicleType = get('blEdit_vehicle_type');
  if (vehicleType !== null) body.vehicle_type = (vehicleType === (src.vehicle_type || '')) ? '' : vehicleType;
  const vehicleColor = get('blEdit_vehicle_color');
  if (vehicleColor !== null) body.vehicle_color = (vehicleColor === (src.vehicle_color || '')) ? '' : vehicleColor;
  const plateType = get('blEdit_plate_type');
  if (plateType !== null) body.plate_type = (plateType === (src.plate_type || '')) ? '' : plateType;
  const caseKind = get('blEdit_case_kind');
  if (caseKind !== null) body.case_kind = (caseKind === (src.case_kind || '')) ? '' : caseKind;
  // Photo path from override (set during upload)
  const ov = _blEditRec.override || {};
  if (ov.photo_path !== undefined) {
    body.photo_path = (ov.photo_path === (src.photo_path || '')) ? '' : (ov.photo_path || '');
  }
  return body;
}

async function _blPutOverride(patch, okMsg) {
  try {
    const r = await fetch(`${API}/api/blacklist/record/${_blEditRec.id}/override`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    document.getElementById('blEditModal').classList.add('hidden');
    document.getElementById('blDetailModal').classList.add('hidden');
    const dt = _blEditRec.data_type === 'face' ? 'face' : 'lpr';
    _blQualCache = null;
    _blLoadStats(dt);
    _blLoadList(dt, _blState[dt].page);
    if (okMsg) alert(okMsg);
  } catch (e) {
    alert(_blT('blset.saveFail', 'บันทึกไม่สำเร็จ') + ': ' + e.message);
  }
}

const blSaveOverride  = () => _blPutOverride(_blCollectOverride());
const blExcludeRecord = () => {
  const reason = (document.getElementById('blEditExcReason') || {}).value || '';
  if (!confirm(_blT('bl.confirmExclude', 'ยกเว้นรายการนี้ออกจากถังกลาง? ข้อมูลดิบยังเก็บไว้ และเอากลับได้ภายหลัง'))) return;
  _blPutOverride({ excluded: true, exclude_reason: reason.trim() || null });
};
const blRestoreRecord = () => _blPutOverride({ excluded: false });

// ============================================================
// B3 — bridge: roster plates -> lpr_watchlist (the table that alerts)
// ============================================================
// What is stored is a RULE, not a list of plates. The reservoir keeps changing
// under us — a source drops a vehicle when charges are dropped — and only a
// re-evaluated rule can take the alert away again. A one-shot copy would leave
// a cleared vehicle flagged forever.
//
// Three presets, one mechanism: no filter = ทั้งหมด, group filter = ตามความเสี่ยง,
// explicit ids = เลือกเอง. Target groups are always shown by NAME: the ids
// (suspect/warrant/vip) are internal and renameable.
let _blBridge = null;

async function blOpenBridge() {
  const body = document.getElementById('blBridgeBody');
  body.innerHTML = `<div class="inline-note">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  document.getElementById('blBridgeModal').classList.remove('hidden');
  try {
    const r = await fetch(`${API}/api/blacklist/bridge/rules`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blBridge = { ...j, preview: null };
    _blRenderBridge();
  } catch (e) {
    body.innerHTML = `<div class="cfg-result err"><div class="cfg-result-head">${_blEsc(_blT('common.error', 'ผิดพลาด'))}</div>${_blEsc(e.message)}</div>`;
  }
}

function _blRenderBridge() {
  const b = _blBridge;
  const srcs = (_blSources || []).filter(s => (s.data_types || []).includes('lpr'));
  const groupsFor = (sid) => b.facets.filter(f => String(f.source_id) === String(sid) && f.group_name !== '__none__');

  const ruleRows = b.rules.length ? b.rules.map(r => {
    const n = b.facets.filter(f => String(f.source_id) === String(r.source_id) &&
      (!r.group_names?.length || r.group_names.includes(f.group_name)))
      .reduce((s, f) => s + f.n, 0);
    const scope = r.external_ids?.length
      ? `${_blT('blbr.picked', 'เลือกเอง')} ${r.external_ids.length}`
      : (r.group_names?.length ? r.group_names.join(', ') : _blT('blbr.allOf', 'ทั้งหมด'));
    // A rule that names no group takes whatever the source sends, including
    // categories that do not exist yet — so a roster adding one starts raising
    // alerts with nobody having approved it. Say so on the row; the operator
    // can delete and re-add with the categories ticked.
    const wild = !r.external_ids?.length && !r.group_names?.length;
    return `<div class="brg-rule ${r.active ? '' : 'off'}">
        <div class="brg-rule-main">
          <div class="brg-rule-name">${_blEsc(r.source_label)}<span class="brg-scope">${_blEsc(scope)}</span>${
            wild ? `<span class="brg-scope wild">${_blEsc(_blT('blbr.autoNew', 'รับหมวดใหม่อัตโนมัติ'))}</span>` : ''}</div>
          <div class="inline-note">→ ${_blEsc(r.target_group_name || _blT('blbr.noGroup', 'ไม่ระบุกลุ่ม'))}
            ${r.external_ids?.length ? '' : `· ~${n.toLocaleString()} ${_blEsc(_blT('blset.records', 'ระเบียน'))}`}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="blBridgeToggle" data-id="${r.id}" data-on="${r.active}">
          ${_blEsc(r.active ? _blT('blbr.pause', 'พัก') : _blT('blbr.resume', 'ใช้งาน'))}</button>
        <button class="btn btn-ghost btn-sm" data-action="blBridgeDelRule" data-id="${r.id}">${_blEsc(_blT('common.delete', 'ลบ'))}</button>
      </div>`;
  }).join('') : `<div class="bl-empty">${_blEsc(_blT('blbr.noRules', 'ยังไม่มีกติกา — เพิ่มด้านล่างเพื่อเริ่ม'))}</div>`;

  // Categories a source is sending that no active rule selects. Nothing is
  // fetched for this — `facets` is already every group_name x source with a
  // count, for every source, and it arrives on each open of this modal
  // (blacklist-sources.js). Without it a new category is invisible either way:
  // a rule that names its groups drops it silently, a rule that names none
  // alerts on it silently. Rules narrowed to specific records are not counted
  // as covering their category, because they only select those records.
  const unmapped = b.facets.filter(f =>
    f.group_name !== '__none__' &&
    srcs.some(s => String(s.id) === String(f.source_id)) &&
    !b.rules.some(r => r.active && String(r.source_id) === String(f.source_id) &&
      !r.external_ids?.length &&
      (!r.group_names?.length || r.group_names.includes(f.group_name))));
  const srcLabel = (id) => (srcs.find(s => String(s.id) === String(id)) || {}).label || id;

  const unmappedBlock = unmapped.length ? `
    <div class="brg-sec-title">${_blEsc(_blT('blbr.unmapped', 'หมวดที่ยังไม่ได้จับคู่'))}</div>
    <div class="brg-unmapped-list">
      ${unmapped.map(f => `<button class="brg-unmapped" data-action="blBridgeMapFacet"
          data-sid="${_blEsc(String(f.source_id))}" data-g="${_blEsc(f.group_name)}">
          <span class="brg-unmapped-src">${_blEsc(srcLabel(f.source_id))}</span>
          <span class="brg-unmapped-g">${_blEsc(f.group_name)}</span>
          <span class="brg-unmapped-n">${f.n.toLocaleString()}</span></button>`).join('')}
    </div>
    <div class="inline-note">${_blEsc(_blT('blbr.unmappedHint',
      'กดเพื่อกรอกฟอร์มด้านล่างให้ — เลือกกลุ่มปลายทางเองแล้วกดเพิ่มกติกา'))}</div>` : '';

  const first = srcs[0];
  const fg = first ? groupsFor(first.id) : [];
  const p = b.preview;

  // BS3 — sync ล่าสุด + จำนวนที่ auto-sync บล็อกไว้รอตรวจ (ค่าเดียวกับ badge
  // นอก modal — refresh มันจากข้อมูลชุดนี้เลย ไม่ fetch ซ้ำ)
  const pendingBadge = document.getElementById('blBridgePendingBadge');
  if (pendingBadge) {
    const n = b.pending?.count || 0;
    pendingBadge.textContent = n > 99 ? '99+' : String(n);
    pendingBadge.classList.toggle('show', n > 0);
  }
  const syncStatusLine = `
    <div class="brg-status">
      <span>${_blEsc(_blT('blbr.lastSync', 'sync อัตโนมัติล่าสุด'))}: <strong>${
        b.last_sync_at ? _blEsc(_blDT(b.last_sync_at)) : _blEsc(_blT('blbr.neverSynced', 'ยังไม่เคย'))}</strong></span>
      ${b.pending?.count ? `<span class="brg-pending-warn">${b.pending.count} ${
        _blEsc(_blT('blbr.pendingCount', 'ป้ายรอตรวจ (บล็อก sync อัตโนมัติ)'))}</span>` : ''}
    </div>
    <div class="brg-status">
      <span><strong>${b.watchlist.bridged.toLocaleString()}</strong> ${_blEsc(_blT('blbr.fromRoster', 'จากฐานข้อมูล'))}</span>
      <span><strong>${b.watchlist.manual.toLocaleString()}</strong> ${_blEsc(_blT('blbr.manual', 'กรอกเอง'))}</span>
      <span class="inline-note">${_blEsc(_blT('blbr.manualSafe', 'ระบบไม่แตะรายการที่กรอกเองเลย'))}</span>
    </div>`;

  document.getElementById('blBridgeBody').innerHTML = `
    ${syncStatusLine}

    <div class="brg-sec-title">${_blEsc(_blT('blbr.rules', 'กติกาที่ใช้อยู่'))}</div>
    ${ruleRows}
    ${unmappedBlock}

    <div class="brg-sec-title">${_blEsc(_blT('blbr.addRule', 'เพิ่มกติกา'))}</div>
    <div class="brg-form">
      <div class="cfg-row">
        <label>${_blEsc(_blT('bl.source', 'แหล่งข้อมูล'))}</label>
        <select class="form-input" id="brgSource" data-change="blBridgeSrcChange">
          ${srcs.map(s => `<option value="${s.id}">${_blEsc(s.label)}</option>`).join('')}
        </select>
      </div>
      <div class="cfg-row" id="brgGroupRow" ${fg.length ? '' : 'hidden'}>
        <label>${_blEsc(_blT('blbr.riskFilter', 'กรองตามระดับเฝ้าระวัง'))}</label>
        <div class="cfg-type-toggles" id="brgGroups">
          ${fg.map(f => `<span class="cfg-type-toggle" data-action="blToggleType" data-dt="${_blEsc(f.group_name)}">${_blEsc(f.group_name)} (${f.n.toLocaleString()})</span>`).join('')}
        </div>
        <div class="inline-note">${_blEsc(_blT('blbr.riskHint', 'ไม่เลือก = เอาทั้งหมดจากแหล่งนี้'))}</div>
      </div>
      <div class="cfg-row" id="brgNoGroupNote" ${fg.length ? 'hidden' : ''}>
        <div class="placeholder-note">${_blEsc(_blT('blbr.noGroups', 'แหล่งนี้ไม่ได้ส่งระดับเฝ้าระวังมา — เลือกได้เฉพาะ "ทั้งหมด"'))}</div>
      </div>
      <div class="cfg-row">
        <label>${_blEsc(_blT('blbr.target', 'ส่งเข้ากลุ่มเฝ้าระวัง'))}</label>
        <select class="form-input" id="brgTarget">
          ${b.groups.map(g => `<option value="${g.id}">${_blEsc(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="inline-note" style="margin:2px 0 8px">${_blEsc(_blT('blbr.lineMoved',
        'การแจ้งเตือน LINE ตั้งที่กลุ่มเฝ้าระวัง (ตั้งค่า › ระบบ LPR) ไม่ใช่ที่กติกานี้'))}</div>
      <button class="btn btn-secondary btn-sm" data-action="blBridgeAddRule">${_blEsc(_blT('blbr.addRule', 'เพิ่มกติกา'))}</button>
    </div>

    <div class="brg-sec-title">${_blEsc(_blT('blbr.applyTitle', 'ตรวจสอบแล้วนำไปใช้'))}</div>
    ${p ? `
      <div class="brg-diff">
        <span class="brg-cnt add">+${p.counts.add.toLocaleString()} ${_blEsc(_blT('blbr.willAdd', 'เพิ่ม'))}</span>
        <span class="brg-cnt upd">~${p.counts.update.toLocaleString()} ${_blEsc(_blT('blbr.willUpdate', 'แก้ไข'))}</span>
        <span class="brg-cnt del">−${p.counts.remove.toLocaleString()} ${_blEsc(_blT('blbr.willRemove', 'ถอนออก'))}</span>
        ${p.counts.skipped_manual ? `<span class="brg-cnt skip">${p.counts.skipped_manual} ${_blEsc(_blT('blbr.skipManual', 'ข้าม (กรอกเอง)'))}</span>` : ''}
        ${p.counts.takeover ? `<span class="brg-cnt">${p.counts.takeover} ${_blEsc(_blT('blbr.takeover', 'ดึงกลับจากรายการเฉพาะ Site'))}</span>` : ''}
      </div>
      ${p.partial ? `<div class="brg-partial">${_blEsc(_blT('blbr.partialNote', 'รอบนี้ดูเฉพาะบางกติกา จึงจะไม่ถอนทะเบียนใดออกเลย — การถอนต้องดูทุกกติกาพร้อมกัน เพราะทะเบียนหนึ่งอาจมีอีกกติกาถืออยู่'))}</div>` : ''}
      ${p.add.length ? `<div class="brg-list"><div class="brg-list-h">${_blEsc(_blT('blbr.willAdd', 'เพิ่ม'))}</div>${p.add.slice(0, 40).map(r => `<span class="brg-plate">${_blEsc(r.plate_number)}</span>`).join('')}${p.counts.add > 40 ? `<span class="inline-note">… ${_blEsc(_blT('blbr.andMore', 'และอีก'))} ${(p.counts.add - 40).toLocaleString()}</span>` : ''}</div>` : ''}
      ${p.remove.length ? `<div class="brg-list"><div class="brg-list-h">${_blEsc(_blT('blbr.willRemove', 'ถอนออก'))}</div>${p.remove.slice(0, 40).map(r => `<span class="brg-plate del">${_blEsc(r.plate_number)}</span>`).join('')}${p.counts.remove > 40 ? `<span class="inline-note">… ${_blEsc(_blT('blbr.andMore', 'และอีก'))} ${(p.counts.remove - 40).toLocaleString()}</span>` : ''}</div>` : ''}
      <div style="margin-top:12px">
        <button class="btn btn-primary" data-action="blBridgeSync"
          ${(p.counts.add || p.counts.update || p.counts.remove) ? '' : 'disabled'}>
          ${_blEsc(_blT('blbr.apply', 'ยืนยันนำไปใช้'))}</button>
        <button class="btn btn-secondary" data-action="blBridgePreview">${_blEsc(_blT('blbr.recheck', 'ตรวจใหม่'))}</button>
      </div>`
    : `<div class="inline-note">${_blEsc(_blT('blbr.previewFirst', 'กดตรวจสอบเพื่อดูว่าจะเพิ่ม/ถอนอะไรบ้าง — ยังไม่มีการเปลี่ยนแปลงใดๆ จนกว่าจะยืนยัน'))}</div>
       <div style="margin-top:10px"><button class="btn btn-secondary" data-action="blBridgePreview">${_blEsc(_blT('blbr.preview', 'ตรวจสอบ (ยังไม่เขียน)'))}</button></div>`}`;
}

// Group toggles are per-source; switching source must not leave the previous
// source's groups on screen (they would silently filter to nothing).
function blBridgeSrcChange() {
  const sid = document.getElementById('brgSource').value;
  const fg = _blBridge.facets.filter(f => String(f.source_id) === String(sid) && f.group_name !== '__none__');
  const row = document.getElementById('brgGroupRow');
  const note = document.getElementById('brgNoGroupNote');
  document.getElementById('brgGroups').innerHTML = fg.map(f =>
    `<span class="cfg-type-toggle" data-action="blToggleType" data-dt="${_blEsc(f.group_name)}">${_blEsc(f.group_name)} (${f.n.toLocaleString()})</span>`).join('');
  row.hidden = !fg.length;
  note.hidden = !!fg.length;
}

// Fills the add-rule form and stops. Deliberately does not pick a target group
// or submit: the target decides how a plate is matched (รถตามหมายจับ needs the
// province to agree, รถผู้ต้องสงสัย matches the number alone), so guessing it
// would create real alerts on real vehicles that nobody chose.
function blBridgeMapFacet(el) {
  const sel = document.getElementById('brgSource');
  sel.value = el.dataset.sid;
  blBridgeSrcChange();
  const chip = document.querySelector(
    `#brgGroups .cfg-type-toggle[data-dt="${CSS.escape(el.dataset.g)}"]`);
  if (chip) chip.classList.add('on');
  document.getElementById('brgTarget').focus();
  sel.closest('.brg-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function blBridgeAddRule() {
  const groups = Array.from(document.querySelectorAll('#brgGroups .cfg-type-toggle.on')).map(el => el.dataset.dt);
  try {
    const r = await fetch(`${API}/api/blacklist/bridge/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        source_id: document.getElementById('brgSource').value,
        group_names: groups.length ? groups : null,
        target_group_id: document.getElementById('brgTarget').value || null,
      }),
    });
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    blOpenBridge();
  } catch (e) { alert(_blT('blset.saveFail', 'บันทึกไม่สำเร็จ') + ': ' + e.message); }
}

async function blBridgeToggle(el) {
  await fetch(`${API}/api/blacklist/bridge/rules/${el.dataset.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ active: el.dataset.on !== 'true' }),
  }).catch(() => {});
  blOpenBridge();
}

async function blBridgeDelRule(el) {
  // Deleting a rule does not pull its plates. The next preview lists them under
  // "ถอนออก" and the operator confirms — alert removal is as consequential as
  // alert creation and gets the same review.
  if (!confirm(_blT('blbr.delRuleConfirm', 'ลบกติกานี้? ทะเบียนที่กติกานี้ส่งเข้าไปจะยังอยู่จนกว่าคุณจะกดนำไปใช้อีกครั้ง'))) return;
  await fetch(`${API}/api/blacklist/bridge/rules/${el.dataset.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
  blOpenBridge();
}

async function blBridgePreview() {
  try {
    const r = await fetch(`${API}/api/blacklist/bridge/preview`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blBridge.preview = j;
    _blRenderBridge();
  } catch (e) { alert(_blT('common.error', 'ผิดพลาด') + ': ' + e.message); }
}

async function blBridgeSync() {
  const c = _blBridge.preview.counts;
  if (!confirm(`${_blT('blbr.applyConfirm', 'ยืนยันนำไปใช้กับระบบเฝ้าระวัง?')}\n\n` +
               `${_blT('blbr.willAdd', 'เพิ่ม')}: ${c.add}\n${_blT('blbr.willRemove', 'ถอนออก')}: ${c.remove}\n\n` +
               `${_blT('blbr.applyWarn', 'ทะเบียนที่เพิ่มจะเริ่มแจ้งเตือนทันทีเมื่อรถผ่านกล้อง')}`)) return;
  try {
    const r = await fetch(`${API}/api/blacklist/bridge/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ confirm: { add: c.add, remove: c.remove } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    alert(`${_blT('blbr.done', 'นำไปใช้เรียบร้อย')}\n\n` +
          `${_blT('blbr.willAdd', 'เพิ่ม')}: ${j.added} · ${_blT('blbr.willUpdate', 'แก้ไข')}: ${j.updated} · ` +
          `${_blT('blbr.willRemove', 'ถอนออก')}: ${j.removed}` +
          (j.skipped_manual ? `\n${_blT('blbr.skipManual', 'ข้าม (กรอกเอง)')}: ${j.skipped_manual}` : '') +
          (j.taken_over ? `\n${_blT('blbr.takeover', 'ดึงกลับจากรายการเฉพาะ Site')}: ${j.taken_over}` : ''));
    blOpenBridge();
  } catch (e) { alert(_blT('common.error', 'ผิดพลาด') + ': ' + e.message); }
}

// ============================================================
// The bin — every excluded record, wherever it was removed from
// ============================================================
// "Removed" was only reviewable through the duplicate page's toggle, which
// cannot show a record that was never a duplicate. audit_log had every removal
// from the start, but nobody audits by reading a log line by line. This is the
// screen that makes a wrong removal findable.
let _blBin = { dt: 'lpr', page: 1, q: '', by: '' };

function blOpenBin(el) {
  _blBin = { dt: el?.dataset?.dt || 'lpr', page: 1, q: '', by: '' };
  const s = document.getElementById('blBinSearch'); if (s) s.value = '';
  // Nav item เดียวตอนนี้คือ "blacklist-face" เสมอ (decision #245) ไม่ต้องแยกตาม dt แล้ว
  showPage('blacklist-bin', document.querySelector('.nav-item[data-page="blacklist-face"]'));
  _blLoadBin();
}

function blBinBack() {
  showPage(`blacklist-${_blBin.dt}`, document.querySelector('.nav-item[data-page="blacklist-face"]'));
  _blSyncTabActive(_blBin.dt);
}

function blBinSearch() {
  _blBin.q = (document.getElementById('blBinSearch')?.value || '').trim();
  _blBin.by = document.getElementById('blBinBy')?.value || '';
  _blBin.page = 1;
  _blLoadBin();
}

function blBinSetKind(el) { _blBin.dt = el.dataset.dt; _blBin.page = 1; _blLoadBin(); }
function blBinGoPage(el) { _blBin.page = parseInt(el.dataset.p, 10) || 1; _blLoadBin(); }

async function _blLoadBin() {
  const list = document.getElementById('blBinList');
  if (!list) return;
  list.innerHTML = `<div class="bl-empty">${_blEsc(_blT('common.loading', 'กำลังโหลด...'))}</div>`;
  try {
    const qs = new URLSearchParams({ page: String(_blBin.page), limit: '50' });
    if (_blBin.dt) qs.set('data_type', _blBin.dt);
    if (_blBin.q)  qs.set('q', _blBin.q);
    if (_blBin.by) qs.set('by', _blBin.by);
    const r = await fetch(`${API}/api/blacklist/removed?${qs}`, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    _blBin.data = d;

    document.getElementById('blBinSum').innerHTML =
      `<strong>${d.total.toLocaleString()}</strong> ${_blEsc(_blT('bl.binRemoved', 'รายการที่คัดออก'))}` +
      (d.pages > 1 ? ` · ${_blEsc(_blT('bl.dupPageOf', 'หน้า'))} ${d.page}/${d.pages}` : '');
    document.getElementById('blBinRestoreAll').disabled = !d.total;

    const kinds = Object.fromEntries(d.kinds.map(k => [k.k, k.n]));
    document.getElementById('blBinKinds').innerHTML =
      [['lpr', _blT('bl.binLpr', 'ป้ายทะเบียน')], ['face', _blT('bl.binFace', 'ใบหน้า')]]
        .map(([k, lbl]) => `<button class="site-pill bl-dup-chip ${_blBin.dt === k ? 'active' : ''}"
              data-action="blBinSetKind" data-dt="${k}" ${kinds[k] ? '' : 'disabled'}>
              ${_blEsc(lbl)} <b>${(kinds[k] || 0).toLocaleString()}</b></button>`).join('');

    const bySel = document.getElementById('blBinBy');
    if (bySel) {
      bySel.innerHTML = `<option value="">${_blEsc(_blT('bl.binAnyone', 'ลบโดยใครก็ได้'))}</option>` +
        d.actors.map(a => `<option value="${_blEsc(a.k)}"${_blBin.by === a.k ? ' selected' : ''}>${_blEsc(a.k)} (${a.n})</option>`).join('');
    }

    list.innerHTML = d.rows.length ? `
      <div class="bl-dup-scroll"><table class="bl-dup-table bl-bin-table">
        <thead><tr>
          <th></th>
          <th>${_blEsc(_blT('bl.binWhat', 'รายการ'))}</th>
          <th>${_blEsc(_blT('bl.source', 'แหล่งข้อมูล'))}</th>
          <th>${_blEsc(_blT('bl.binReason', 'เหตุผล'))}</th>
          <th>${_blEsc(_blT('bl.binBy', 'ลบโดย'))}</th>
          <th>${_blEsc(_blT('bl.binWhen', 'เมื่อ'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${d.rows.map(r => `
          <tr>
            <td class="bl-dup-thumb">${r.photo_path ? `<img src="${API}/api/blacklist/photo/${_blEsc(r.photo_path)}" alt="" loading="lazy" data-err="hide">` : ''}</td>
            <td><b>${_blEsc(r.plate || r.name || '–')}</b>${r.plate && r.name ? `<div class="inline-note">${_blEsc(r.name)}</div>` : ''}</td>
            <td>${_blEsc(r.source_label)}</td>
            <td>${_blEsc(r.exclude_reason || '–')}</td>
            <td>${_blEsc(r.removed_by || '–')}</td>
            <td class="bl-dup-id">${_blDT(r.removed_at)}</td>
            <td class="bl-dup-actcell">
              <button class="bl-dup-act restore" data-action="blBinRestore" data-id="${r.id}"
                title="${_blEsc(_blT('bl.dupRestore', 'กู้คืน'))}"
                aria-label="${_blEsc(_blT('bl.dupRestore', 'กู้คืน'))}">${BL_UNDO_SVG}</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>`
      : `<div class="bl-empty">${_blEsc(_blT('bl.binEmpty', 'ถังขยะว่าง — ยังไม่มีรายการที่ถูกคัดออก'))}</div>`;

    _blBinPager(d);
  } catch (e) {
    list.innerHTML = `<div class="bl-empty">${_blEsc(e.message)}</div>`;
  }
}

function _blBinPager(d) {
  const el = document.getElementById('blBinPager');
  if (!el) return;
  if (d.pages <= 1) { el.innerHTML = ''; return; }
  const btn = (p, lbl, cls) => `<button class="page-btn ${cls || ''}" data-action="blBinGoPage" data-p="${p}"
    ${p < 1 || p > d.pages || p === d.page ? 'disabled' : ''}>${lbl}</button>`;
  const around = [];
  for (let p = Math.max(1, d.page - 2); p <= Math.min(d.pages, d.page + 2); p++) {
    around.push(btn(p, String(p), p === d.page ? 'active' : ''));
  }
  el.innerHTML = btn(d.page - 1, '‹') + around.join('') + btn(d.page + 1, '›');
}

async function _blBinRestore(ids, msg) {
  if (msg && !confirm(msg)) return;
  try {
    const r = await fetch(`${API}/api/blacklist/duplicates/remove`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ record_ids: ids, restore: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _blLoadBin();
  } catch (e) { alert(_blT('bl.binRestoreFail', 'กู้คืนไม่สำเร็จ') + ': ' + e.message); }
}

const blBinRestore = (el) => _blBinRestore([Number(el.dataset.id)], null);

// Restores what the CURRENT filter shows, not the whole bin — the count in the
// prompt is the one on screen, so there is no gap between what was reviewed and
// what happens. Only the visible page's ids are sent when there are more pages,
// so this can never silently restore rows nobody looked at.
async function blBinRestoreAll() {
  const d = _blBin.data;
  if (!d || !d.rows.length) return;
  const ids = d.rows.map(r => r.id);
  const more = d.total > ids.length;
  await _blBinRestore(ids,
    `${_blT('bl.binRestoreAllConfirm', 'กู้คืนรายการที่แสดงอยู่ทั้งหมด?')}\n\n` +
    `${ids.length} ${_blT('blset.records', 'ระเบียน')}` +
    (more ? `\n\n${_blT('bl.binRestorePageOnly', 'หมายเหตุ: กู้คืนเฉพาะหน้านี้ อีก')} ${d.total - ids.length} ${_blT('bl.binRestoreRest', 'รายการในหน้าถัดไปยังคงถูกคัดออก')}` : ''));
}

// Watches an in-flight import by polling the source row. Ends on any status
// other than 'running' — or after the cap, which is a display timeout only: the
// import keeps running server-side and the row shows its result whenever this
// page is next opened.
async function _blWatchImport(id, btn, maxMs = 15 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise(r => setTimeout(r, 3000));
    let src = null;
    try {
      const r = await fetch(`${API}/api/blacklist/sources`, { credentials: 'include' });
      if (r.ok) src = ((await r.json()).sources || []).find(x => String(x.id) === String(id));
    } catch { /* a blip in polling must not abort the watch */ }
    if (!src) continue;
    if (src.last_import_status === 'running') {
      if (btn) btn.textContent = `${_blT('blset.importing', 'กำลังนำเข้า...')} ${Math.round((Date.now() - started) / 1000)}s`;
      continue;
    }
    await loadBlacklistSources();
    alert(src.last_import_status === 'error'
      ? `${_blT('blset.importFail', 'นำเข้าไม่สำเร็จ')}: ${src.last_import_note || ''}`
      : `${_blT('blset.importDone', 'นำเข้าเสร็จ')}\n\n${src.last_import_note || ''}`);
    return;
  }
  await loadBlacklistSources();
  alert(_blT('blset.importStillRunning', 'ยังนำเข้าไม่เสร็จ — ทำงานต่อเบื้องหลัง เปิดหน้านี้ใหม่เพื่อดูผล'));
}
