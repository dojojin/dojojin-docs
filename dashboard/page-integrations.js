// ============================================================
// Vigil Platform — 3rd Party Integration console
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Everything an operator needs to run a partner, so nobody has to ssh to the
// box: create, edit, narrow the fields, extend, rotate, revoke, and read the
// credentials back.
//
// Two rules the code follows throughout:
//
//   1. What is displayed is read from Postgres catalogues at load, not from a
//      record of what someone intended. If a grant was changed by hand in psql,
//      this page shows the hand-made state.
//   2. Anything that writes asks first. Ticking a field marks it and nothing
//      more until Apply — a checkbox that took effect on click would make a
//      mis-tap a privilege change on a production database.
//
// CSP forbids inline handlers here, so every control carries a data-* attribute
// and listeners are attached after render.
// ============================================================

let _integData = null;
let _integSel = null;      // slug being shown
let _integTab = 'payload';
let _integAgr = null;
let _integDraft = null;    // pending grant changes; absent = matrix shows reality
let _integSaving = false;
let _integSecret = null;   // { slug, appKey, appSecret } — in memory only, never persisted
let _integSecretTimer = null;
let _integUsageCache = null; // cached endpoint usage data; { slug -> { path -> count } }
let _integPendingCol = null; // { slug, view, col } waiting for confirm to toggle

const INTEG_TERMS = [30, 60, 90, 120, 180, 365];

// ── แคตตาล็อกฟิลด์ (หน้าตาแบบ demo /others/demo/OpenAPI/ · 2026-10-21) ─────────
// view จริงจัดเป็นหมวดที่คนอ่านเข้าใจ · คอลัมน์ใหม่ที่ไม่มีในนี้ยังแสดงด้วยชื่อดิบ (หมวด "อื่น ๆ" / ไม่มีชื่อไทย)
// — ห้ามซ่อน เพราะนี่คือสิทธิ์จริงใน Postgres · key i18n เขียนเต็มทุกตัวให้ check-i18n ตรวจได้
const INTEG_DOMAINS = [
  { key: 'lpr',    label: 'integ.dom.lpr',    views: ['v_license_plates_public'] },
  { key: 'person', label: 'integ.dom.person', views: ['v_appearances_public'] },
  { key: 'camera', label: 'integ.dom.camera', views: ['v_cameras_public', 'v_camera_groups_public'] },
  { key: 'event',  label: 'integ.dom.event',  views: ['v_events_public'] },
  { key: 'rules',  label: 'integ.dom.rules',  views: ['v_event_categories_public', 'v_event_category_rules_public', 'v_alert_rules_public'] },
  { key: 'alert',  label: 'integ.dom.alert',  views: ['v_alert_logs_public'] },
  { key: 'system', label: 'integ.dom.system', views: ['v_system_settings_public', 'v_report_history_public'] },
  { key: 'stats',  label: 'integ.dom.stats',  views: ['v_vehicle_stats_hourly_public', 'v_lpr_stats_hourly_public', 'v_lpr_stats_daily_public', 'v_person_stats_daily_public'] },
  { key: 'enforce', label: 'integ.dom.enforce', views: ['v_enforcement_hourly_public', 'v_enforcement_daily_public', 'v_enforcement_cameras_public'] },
];
const INTEG_PII = new Set(['plate_number', 'snapshot_filename', 'clip_file']);
const INTEG_FIELD = {
  active_from: 'integ.f.active_from', active_to: 'integ.f.active_to', age_group: 'integ.f.age_group',
  attributes: 'integ.f.attributes', bbox_height: 'integ.f.bbox_height', bbox_width: 'integ.f.bbox_width',
  bbox_x: 'integ.f.bbox_x', bbox_y: 'integ.f.bbox_y', bottom_category: 'integ.f.bottom_category',
  camera_id: 'integ.f.camera_id', camera_ids: 'integ.f.camera_ids', category_id: 'integ.f.category_id',
  clip_duration_sec: 'integ.f.clip_duration_sec', clip_file: 'integ.f.clip_file', clip_status: 'integ.f.clip_status',
  color: 'integ.f.color', confidence: 'integ.f.confidence', cooldown_seconds: 'integ.f.cooldown_seconds',
  country: 'integ.f.country', created_at: 'integ.f.created_at', description: 'integ.f.description',
  detected_at: 'integ.f.detected_at', duration_ms: 'integ.f.duration_ms', enabled: 'integ.f.enabled',
  event_category: 'integ.f.event_category', event_id: 'integ.f.event_id', event_state: 'integ.f.event_state',
  event_time: 'integ.f.event_time', event_type: 'integ.f.event_type', gender: 'integ.f.gender',
  glasses: 'integ.f.glasses', group_id: 'integ.f.group_id', hair_length: 'integ.f.hair_length',
  has_snapshot: 'integ.f.has_snapshot', helmet_wear: 'integ.f.helmet_wear', icon: 'integ.f.icon', id: 'integ.f.id',
  image_layout: 'integ.f.image_layout', is_locked: 'integ.f.is_locked', key: 'integ.f.key', kind: 'integ.f.kind',
  last_event_at: 'integ.f.last_event_at', last_seen_at: 'integ.f.last_seen_at',
  last_triggered_at: 'integ.f.last_triggered_at', latitude: 'integ.f.latitude', likelihood: 'integ.f.likelihood',
  location_label: 'integ.f.location_label', longitude: 'integ.f.longitude', lower_color: 'integ.f.lower_color',
  match_state: 'integ.f.match_state', model: 'integ.f.model', name: 'integ.f.name',
  object_class: 'integ.f.object_class', object_id: 'integ.f.object_id', plate_number: 'integ.f.plate_number',
  priority: 'integ.f.priority', range_from: 'integ.f.range_from', range_to: 'integ.f.range_to',
  received_at: 'integ.f.received_at', recipient_count: 'integ.f.recipient_count', region: 'integ.f.region',
  report_type: 'integ.f.report_type', rule_id: 'integ.f.rule_id', rule_name: 'integ.f.rule_name',
  rule_names: 'integ.f.rule_names', schedule_id: 'integ.f.schedule_id', send_snapshot: 'integ.f.send_snapshot',
  sent_at: 'integ.f.sent_at', sent_count: 'integ.f.sent_count', site_id: 'integ.f.site_id',
  snapshot_filename: 'integ.f.snapshot_filename', sort_order: 'integ.f.sort_order', status: 'integ.f.status',
  top_category: 'integ.f.top_category', total_recipients: 'integ.f.total_recipients',
  trigger_count: 'integ.f.trigger_count', triggered_rule: 'integ.f.triggered_rule', updated_at: 'integ.f.updated_at',
  upper_color: 'integ.f.upper_color', value: 'integ.f.value', vehicle_color: 'integ.f.vehicle_color',
  vehicle_type: 'integ.f.vehicle_type', hour_start: 'integ.f.hour_start', vehicles: 'integ.f.vehicles',
  by_type: 'integ.f.by_type', detections: 'integ.f.detections', no_plate: 'integ.f.no_plate', day: 'integ.f.day',
  vehicle_brand: 'integ.f.vehicle_brand', plate_color: 'integ.f.plate_color',
  no_helmet: 'integ.f.no_helmet', no_helmet_with_plate: 'integ.f.no_helmet_with_plate', no_seatbelt: 'integ.f.no_seatbelt',
  riders3: 'integ.f.riders3', reports_no_helmet: 'integ.f.reports_no_helmet', reports_no_seatbelt: 'integ.f.reports_no_seatbelt',
  reports_riders3: 'integ.f.reports_riders3', first_hour: 'integ.f.first_hour', last_hour: 'integ.f.last_hour',
  plate_type: 'integ.f.plate_type', rider_count: 'integ.f.rider_count', lane: 'integ.f.lane', mask: 'integ.f.mask', hat: 'integ.f.hat', expression: 'integ.f.expression', bag_category: 'integ.f.bag_category', overall_color: 'integ.f.overall_color', hair_color: 'integ.f.hair_color',
};
const _integFieldLabel = (col) => (INTEG_FIELD[col] ? I18N.t(INTEG_FIELD[col]) : col);

// หมวดทั้งหมด + "อื่น ๆ" สำหรับ view ที่ไม่มีในแคตตาล็อก (view ใหม่จะไม่หายไปจากหน้าจอ)
function _integDomains() {
  const known = new Set(INTEG_DOMAINS.flatMap(d => d.views));
  const rest = _integData.views.filter(v => !known.has(v));
  const all = rest.length ? [...INTEG_DOMAINS, { key: 'other', label: 'integ.dom.other', views: rest }] : INTEG_DOMAINS;
  return all
    .map(d => ({ ...d, views: d.views.filter(v => _integData.columns[v]?.length) }))
    .filter(d => d.views.length);
}

let _integPreview = null;   // { slug, data|error } — "สิ่งที่เขาได้รับ" ของ partner ที่เลือก

async function loadIntegrations() {
  const host = document.getElementById('integBody');
  if (!host) return;
  host.innerHTML = `<div class="integ-empty">${escapeHtml(I18N.t('common.loading'))}</div>`;
  try {
    const r = await fetch(`${API}/api/integrations`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _integData = await r.json();
    _integPreview = null;   // สิทธิ์/ไซต์อาจเปลี่ยนจากการแก้ partner — โหลดตัวอย่างใหม่
    if (!_integSel || !_integData.consumers.some(c => c.slug === _integSel)) {
      // Land on a working partner, not a revoked one — the first row of a list
      // sorted active-first is the right default only if there is an active one.
      _integSel = (_integData.consumers.find(c => c.active) || _integData.consumers[0])?.slug || null;
    }
    renderIntegrations();
  } catch (e) {
    host.innerHTML = `<div class="integ-empty">${escapeHtml(I18N.t('integ.loadFailed'))} ${escapeHtml(e.message)}</div>`;
  }
}

// Every write goes through here so failures surface the server's message rather
// than a generic one — partnerAdmin phrases its errors for an operator.
async function _integReq(method, path, body) {
  const r = await fetch(`${API}/api/integrations${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ── render ────────────────────────────────────────────────────
function renderIntegrations() {
  const host = document.getElementById('integBody');
  if (!host || !_integData) return;
  const { consumers, unknownKeyAttempts } = _integData;
  const c = consumers.find(x => x.slug === _integSel) || consumers[0] || null;

  host.innerHTML = `
    <div class="integ-layout">
      <aside class="integ-side">
        <div class="integ-side-head">
          <span>${escapeHtml(I18N.t('integ.partners'))}</span>
          <span class="integ-count">${consumers.length}</span>
        </div>
        <div class="integ-list">${consumers.map(p => _integCard(p, c && p.slug === c.slug)).join('')}</div>
        <button class="btn btn-sm integ-new" data-integ-new>+ ${escapeHtml(I18N.t('integ.create'))}</button>
      </aside>
      <main class="integ-main">
        ${c ? _integHead(c) + _integTabs() + `<div class="card integ-card">${_integPane(c)}</div>`
            : `<div class="card integ-card integ-empty">
                 <p>${escapeHtml(I18N.t('integ.none'))}</p>
                 <button class="btn" data-integ-new>+ ${escapeHtml(I18N.t('integ.create'))}</button>
               </div>`}
        ${_integProbe(unknownKeyAttempts)}
      </main>
    </div>`;

  _integBind(host, c);
}

function _integBind(host, c) {
  const on = (sel, fn) => host.querySelectorAll(sel).forEach(n => n.addEventListener('click', () => fn(n)));

  on('[data-integ-sel]', n => {
    if (_integDraft && !confirm(I18N.t('integ.discard'))) return;
    _integDraft = null; _integSecret = null; _integSel = n.dataset.integSel; renderIntegrations();
  });
  on('[data-integ-new]', () => _integOpenForm(null));
  host.querySelectorAll('[data-integ-agr-form]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); _integSaveAgr(f); }));
  on('[data-integ-tab]', n => { _integTab = n.dataset.integTab; renderIntegrations(); });
  if (!c) return;

  on('[data-integ-edit]', () => _integOpenForm(c));
  on('[data-integ-col]', n => {
    _integDraft ||= _integEffective(c);
    const view = n.dataset.integView;
    const col = n.dataset.integCol;
    const isCurrentlyOn = _integDraft[view][col];

    if (isCurrentlyOn) {
      // Unchecking — need to warn if this column is used by any endpoint
      _integShowWarning(c, view, col);
    } else {
      // Checking — no warning needed
      _integDraft[view][col] = true;
      renderIntegrations();
    }
  });
  on('[data-integ-dom]', n => {
    const d = _integDomains().find(x => x.key === n.dataset.integDom);
    if (!d) return;
    _integDraft ||= _integEffective(c);
    const want = n.dataset.integDomOn === '1';
    for (const v of d.views) for (const k of Object.keys(_integDraft[v] || {})) _integDraft[v][k] = want;
    renderIntegrations();
  });
  on('[data-integ-save]', () => _integSaveGrants(c.slug));
  on('[data-integ-cancel]', () => { _integDraft = null; renderIntegrations(); });
  on('[data-integ-openapi]', n => _integOpenapi(n.dataset.integOpenapi));
  on('[data-integ-reveal]', () => _integReveal(c.slug));
  on('[data-integ-hide]', () => { _integSecret = null; clearTimeout(_integSecretTimer); renderIntegrations(); });
  on('[data-integ-copy]', n => _integCopy(n.dataset.integCopy, n));
  on('[data-integ-extend]', () => _integExtend(c.slug));
  on('[data-integ-rotate]', () => _integRotate(c.slug));
  on('[data-integ-revoke]', () => _integRevoke(c.slug));
  on('[data-integ-reactivate]', () => _integAction(c.slug, 'reactivate', I18N.t('integ.confirmReactivate')));
  on('[data-integ-delete]', () => _integDelete(c.slug, c.label));
}

function _integCard(p, isOn) {
  const days = p.expires_at ? Math.ceil((new Date(p.expires_at) - Date.now()) / 86400000) : null;
  // Expired outranks active: the row still says active while the credentials no
  // longer work, and that gap is the thing an operator has to see.
  const state = !p.active ? `<span class="integ-badge integ-badge--off">${escapeHtml(I18N.t('integ.revoked'))}</span>`
    : !p.roleExists ? `<span class="integ-badge integ-badge--bad">${escapeHtml(I18N.t('integ.roleMissing'))}</span>`
    : days !== null && days <= 0 ? `<span class="integ-badge integ-badge--bad">${escapeHtml(I18N.t('integ.expired'))}</span>`
    : days !== null && days <= 14 ? `<span class="integ-badge integ-badge--warn">${days}${escapeHtml(I18N.t('integ.dShort'))}</span>`
    : `<span class="integ-badge integ-badge--ok">${escapeHtml(I18N.t('integ.active'))}</span>`;
  return `<button class="integ-item${isOn ? ' is-on' : ''}" data-integ-sel="${escapeHtml(p.slug)}">
    <div class="integ-item-top"><b>${escapeHtml(p.label)}</b>${state}</div>
    <div class="integ-item-sub">${escapeHtml(p.slug)} · ${p.grantedCount} ${escapeHtml(I18N.t('integ.fields'))} · ${
      _integDomains().filter(d => d.views.some(v => Object.values(p.grants?.[v] || {}).some(Boolean))).length} ${escapeHtml(I18N.t('integ.domains'))}</div>
  </button>`;
}

function _integExpiry(c) {
  if (!c.expires_at) return { text: I18N.t('integ.noExpiry'), cls: 'integ-exp-none' };
  const days = Math.ceil((new Date(c.expires_at) - Date.now()) / 86400000);
  const d = new Date(c.expires_at).toISOString().slice(0, 10);
  if (days <= 0) return { text: `${d} · ${I18N.t('integ.expired')}`, cls: 'integ-exp-bad' };
  if (days <= 14) return { text: `${d} · ${days} ${I18N.t('integ.daysLeft')}`, cls: 'integ-exp-soon' };
  return { text: `${d} · ${days} ${I18N.t('integ.daysLeft')}`, cls: '' };
}

function _integHead(c) {
  const scope = c.site_codes
    ? (c.site_codes.length
        ? c.site_codes.map(s => `<span class="integ-chip">${escapeHtml(s)}</span>`).join('')
        : `<span class="integ-chip integ-chip--none">${escapeHtml(I18N.t('integ.noSites'))}</span>`)
    : `<span class="integ-chip integ-chip--all">${escapeHtml(I18N.t('integ.allSites'))}</span>`;
  const u = c.usage;
  const exp = _integExpiry(c);
  const seen = c.last_seen_at ? new Date(c.last_seen_at).toLocaleString() : I18N.t('integ.never');

  return `<div class="card integ-card">
    <div class="integ-head">
      <div class="integ-head-l">
        <h3 class="integ-name">${escapeHtml(c.label)}</h3>
        <div class="integ-meta">${escapeHtml(c.slug)} · ${escapeHtml(c.db_role)}</div>
      </div>
      <div class="integ-actions">
        <button class="btn btn-sm btn-ghost" data-integ-edit>${escapeHtml(I18N.t('integ.edit'))}</button>
        <button class="btn btn-sm btn-ghost" data-integ-extend>${escapeHtml(I18N.t('integ.extend'))}</button>
        <button class="btn btn-sm btn-ghost" data-integ-rotate>${escapeHtml(I18N.t('integ.rotate'))}</button>
        ${c.active
          ? `<button class="btn btn-sm btn-danger-ghost" data-integ-revoke>${escapeHtml(I18N.t('integ.revoke2'))}</button>`
          : `<button class="btn btn-sm" data-integ-reactivate>${escapeHtml(I18N.t('integ.reactivate'))}</button>
             <button class="btn btn-sm btn-danger-ghost" data-integ-delete>${escapeHtml(I18N.t('integ.delete'))}</button>`}
      </div>
    </div>

    ${_integCreds(c)}

    <div class="integ-stats">
      <div><span>${escapeHtml(I18N.t('integ.scope'))}</span><b>${scope}</b></div>
      <div><span>${escapeHtml(I18N.t('integ.rate'))}</span><b>${c.rate_per_min}/min</b></div>
      <div><span>${escapeHtml(I18N.t('integ.lookback'))}</span><b>${c.max_lookback_days ? c.max_lookback_days + ' ' + I18N.t('integ.days') : I18N.t('integ.systemDefault')}</b></div>
      <div><span>${escapeHtml(I18N.t('integ.expires'))}</span><b class="${exp.cls}">${escapeHtml(exp.text)}</b></div>
      <div><span>${escapeHtml(I18N.t('integ.lastSeen'))}</span><b>${escapeHtml(seen)}</b></div>
      <div><span>${escapeHtml(I18N.t('integ.calls7d'))}</span><b>${u ? `${u.ok_count} / <span class="integ-err">${u.err_count}</span>` : '—'}</b></div>
    </div>
    ${c.notes ? `<div class="integ-notes">${escapeHtml(c.notes)}</div>` : ''}
  </div>`;
}

// The key is not a secret and is always shown; the secret is hidden until asked
// for, and asking is audited server-side. "Shown once" would have been a policy
// dressed as a technical limit — the value is stored reversibly because HMAC
// verification needs it, and the same admin already reads camera passwords in
// plaintext. The audit row is what makes this safe, not the pretence.
function _integCreds(c) {
  const shown = _integSecret && _integSecret.slug === c.slug;
  return `<div class="integ-creds">
    <div class="integ-cred">
      <span class="integ-cred-lbl">App Key</span>
      <code>${escapeHtml(c.app_key)}</code>
      <button class="integ-mini" data-integ-copy="${escapeHtml(c.app_key)}">${escapeHtml(I18N.t('integ.copy'))}</button>
    </div>
    <div class="integ-cred">
      <span class="integ-cred-lbl">App Secret</span>
      ${shown
        ? `<code class="integ-secret">${escapeHtml(_integSecret.appSecret)}</code>
           <button class="integ-mini" data-integ-copy="${escapeHtml(_integSecret.appSecret)}">${escapeHtml(I18N.t('integ.copy'))}</button>
           <button class="integ-mini" data-integ-hide>${escapeHtml(I18N.t('integ.hide'))}</button>
           <span class="integ-cred-note">${escapeHtml(I18N.t('integ.autoHide'))}</span>`
        : `<code class="integ-secret integ-secret--masked">••••••••••••••••••••</code>
           <button class="integ-mini" data-integ-reveal>${escapeHtml(I18N.t('integ.reveal'))}</button>
           <span class="integ-cred-note">${escapeHtml(I18N.t('integ.revealNote'))}</span>`}
    </div>
  </div>`;
}

function _integTabs() {
  const t = (k, label) => `<button class="tab${_integTab === k ? ' active' : ''}" data-integ-tab="${k}">${escapeHtml(label)}</button>`;
  return `<div class="tab-bar integ-tabs">
    ${t('payload', I18N.t('integ.tabPayload'))}
    ${t('fields', I18N.t('integ.tabFields'))}
    ${t('spec', I18N.t('integ.tabSpec'))}
    ${t('sql', I18N.t('integ.tabSql'))}
    ${t('agreement', I18N.t('integ.tabAgreement'))}
  </div>`;
}

function _integPane(c) {
  if (_integTab === 'spec') {
    return `<p class="integ-hint">${escapeHtml(I18N.t('integ.specHint'))}</p>
      <button class="btn btn-sm" data-integ-openapi="${escapeHtml(c.slug)}">${escapeHtml(I18N.t('integ.viewSpec'))}</button>
      <pre class="integ-code" id="integSpecOut"></pre>`;
  }
  if (_integTab === 'sql') return _integSql(c);
  if (_integTab === 'payload') return _integPayload(c);
  if (_integTab === 'agreement') return _integAgreement(c);
  return _integMatrix(c);
}

// What is in force now, as an editable object. Built from the catalogue rather
// than the grants map so a column with no grant is present-and-false rather
// than missing — the whole object is sent back as the desired state.
function _integEffective(c) {
  const out = {};
  for (const v of _integData.views) {
    out[v] = {};
    for (const col of (_integData.columns[v] || [])) out[v][col.name] = !!(c.grants[v] || {})[col.name];
  }
  return out;
}

function _integMatrix(c) {
  if (!c.roleExists) {
    return `<div class="integ-empty">
      <p><b>${escapeHtml(I18N.t('integ.roleMissingTitle'))}</b></p>
      <p>${escapeHtml(I18N.t('integ.roleMissingBody'))}</p>
      <code class="integ-cmd">CREATE ROLE ${escapeHtml(c.db_role)} NOLOGIN; GRANT third_party_readonly TO ${escapeHtml(c.db_role)};</code>
    </div>`;
  }
  const eff = _integDraft || _integEffective(c);
  const fill = _integData.fill || {};
  const eps = _integData.endpoints || [];

  return `<p class="integ-hint">${escapeHtml(I18N.t('integ.fieldsHint'))}</p>
    ${_integDraft ? `<div class="integ-dirty">
      <span>${escapeHtml(I18N.t('integ.unsaved'))}</span>
      <span class="integ-dirty-btns">
        <button class="btn btn-sm btn-ghost" data-integ-cancel>${escapeHtml(I18N.t('common.cancel'))}</button>
        <button class="btn btn-sm" data-integ-save ${_integSaving ? 'disabled' : ''}>${escapeHtml(_integSaving ? I18N.t('common.loading') : I18N.t('integ.apply'))}</button>
      </span>
    </div>` : ''}
    <div class="integ-matrix">
      ${_integDomains().map(d => {
        const cells = d.views.flatMap(v => _integData.columns[v].map(col => ({ v, col })));
        const n = cells.filter(x => eff[x.v]?.[x.col.name]).length;
        const paths = [...new Set(eps.filter(e => d.views.includes(e.view)).map(e => e.path))];
        const segBtn = (want, label) => `<button class="${(want ? n === cells.length : n === 0) ? 'active' : ''}"
          data-integ-dom="${escapeHtml(d.key)}" data-integ-dom-on="${want ? 1 : 0}">${escapeHtml(I18N.t(label))}</button>`;
        return `<section class="integ-dom${n ? '' : ' is-off'}">
          <header class="integ-dom-head">
            <div class="integ-dom-name">
              <b>${escapeHtml(I18N.t(d.label))}</b>
              <span class="integ-dom-src">${d.views.map(escapeHtml).join(' · ')}</span>
              <span class="integ-dom-eps">${paths.length
                ? paths.map(pth => `<code>${escapeHtml(pth)}</code>`).join(' ')
                : `<span class="integ-dom-noep">${escapeHtml(I18N.t('integ.noEndpoint'))}</span>`}</span>
            </div>
            <div class="integ-dom-right">
              <span class="integ-frac${n === 0 ? ' integ-frac--none' : n === cells.length ? ' integ-frac--all' : ''}">${n}/${cells.length}</span>
              <div class="seg integ-seg">${segBtn(true, 'integ.domOn')}${segBtn(false, 'integ.domOff')}</div>
            </div>
          </header>
          <div class="integ-cols">
            ${cells.map(({ v, col }) => {
              const isOn = !!eff[v]?.[col.name];
              const was = !!(c.grants[v] || {})[col.name];
              const f = fill[v]?.[col.name];
              const fillTag = f === undefined ? ''
                : f === 0 ? `<span class="integ-fill integ-fill--zero">${escapeHtml(I18N.t('integ.fillNone'))}</span>`
                : `<span class="integ-fill${f >= 90 ? ' integ-fill--hi' : f >= 40 ? '' : ' integ-fill--lo'}">${f}%</span>`;
              return `<button class="integ-col${isOn ? ' is-on' : ''}${isOn !== was ? ' is-changed' : ''}"
                data-integ-col="${escapeHtml(col.name)}" data-integ-view="${escapeHtml(v)}"
                title="${escapeHtml(v)}.${escapeHtml(col.name)} · ${escapeHtml(col.type)}" aria-pressed="${isOn}">
                <span class="integ-col-box" aria-hidden="true"></span>
                <span class="integ-col-l">${escapeHtml(_integFieldLabel(col.name))}</span>
                ${INTEG_FIELD[col.name] ? `<code class="integ-col-c">${escapeHtml(col.name)}</code>` : ''}
                ${INTEG_PII.has(col.name) ? `<span class="integ-pii">${escapeHtml(I18N.t('integ.pii'))}</span>` : ''}
                ${fillTag}
              </button>`;
            }).join('')}
          </div>
        </section>`;
      }).join('')}
    </div>`;
}

// ── "สิ่งที่เขาได้รับ" — ผลจริงต่อ endpoint จาก GET /api/integrations/:slug/preview ───────────
// รันในนามสิทธิ์ของ partner บนเซิร์ฟเวอร์ · ฟิลด์ที่ไม่ได้รับถูกตัดจากแถว · ขาดฟิลด์ที่ขาดไม่ได้ = ทั้ง endpoint ตอบ 403
async function _integLoadPreview(slug) {
  _integPreview = { slug, loading: true };
  try {
    const r = await fetch(`${API}/api/integrations/${encodeURIComponent(slug)}/preview`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _integPreview = { slug, data: j };
  } catch (e) {
    _integPreview = { slug, error: e.message };
  }
  if (_integSel === slug && _integTab === 'payload') renderIntegrations();
}

function _integPayload(c) {
  if (!_integPreview || _integPreview.slug !== c.slug) {
    _integLoadPreview(c.slug);
    return `<div class="integ-empty">${escapeHtml(I18N.t('common.loading'))}</div>`;
  }
  if (_integPreview.loading) return `<div class="integ-empty">${escapeHtml(I18N.t('common.loading'))}</div>`;
  if (_integPreview.error) return `<div class="integ-empty">${escapeHtml(I18N.t('integ.loadFailed'))} ${escapeHtml(_integPreview.error)}</div>`;
  const pill = (cls, k) => `<span class="integ-badge integ-badge--${cls}">${escapeHtml(I18N.t(k))}</span>`;
  const STATUS = {
    ok: () => pill('ok', 'integ.pv.ok'), forbidden: () => pill('bad', 'integ.pv.forbidden'),
    empty: () => pill('off', 'integ.pv.empty'), 'no-scope': () => pill('warn', 'integ.pv.noScope'),
    'no-role': () => pill('bad', 'integ.pv.noRole'), slow: () => pill('warn', 'integ.pv.slow'),
  };
  const fmt = (col, val) => {
    if (val === null || val === undefined) return '<span class="integ-null">null</span>';
    if (col === 'plate_number' && typeof window.lprPlaque === 'function') return window.lprPlaque(String(val));
    if (typeof val === 'object') return `<code>${escapeHtml(JSON.stringify(val))}</code>`;
    // เวลาแสดงเป็นเวลาท้องถิ่น — partner ได้เป็น ISO (UTC) ตามเดิม ชื่อคอลัมน์ใต้ป้ายบอกอยู่แล้วว่าเป็นค่าดิบตัวไหน
    if (typeof val === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(val)) return escapeHtml(new Date(val).toLocaleString());
    return escapeHtml(String(val));
  };
  return `${_integDraft ? `<p class="integ-hint integ-hint--warn">${escapeHtml(I18N.t('integ.pv.draft'))}</p>` : ''}
    ${_integPreview.data.scoped ? `<p class="integ-hint">${escapeHtml(I18N.t('integ.pv.scoped'))}</p>` : ''}
    <div class="integ-pv">
    ${_integPreview.data.endpoints.map(e => `<section class="integ-pv-ep">
      <header class="integ-pv-head"><code>${escapeHtml((e.method || 'get').toUpperCase())} ${escapeHtml(e.path)}</code>${(STATUS[e.status] || STATUS.empty)()}</header>
      ${e.status === 'ok' ? `<dl class="integ-kv">${Object.entries(e.row).map(([k, val]) =>
          `<dt>${escapeHtml(_integFieldLabel(k))}<code>${escapeHtml(k)}</code></dt><dd>${fmt(k, val)}</dd>`).join('')}${(e.dropped || []).map(k =>
          `<dt class="integ-pv-off">${escapeHtml(_integFieldLabel(k))}<code>${escapeHtml(k)}</code></dt><dd class="integ-pv-off">${escapeHtml(I18N.t('integ.pv.notSent'))}</dd>`).join('')}</dl>`
        : e.status === 'forbidden' && e.missing?.length ? `<p class="integ-pv-miss">${escapeHtml(I18N.t('integ.pv.missing'))}: ${
            e.missing.map(m => `<b>${escapeHtml(_integFieldLabel(m))}</b> <code>${escapeHtml(m)}</code>`).join(', ')}</p>` : ''}
    </section>`).join('')}
    </div>`;
}

// ── ทะเบียนข้อตกลงข้อมูล — GET/POST /api/integrations/:slug/agreements ───────────
async function _integLoadAgr(slug) {
  _integAgr = { slug, loading: true };
  try {
    const r = await fetch(`${API}/api/integrations/${encodeURIComponent(slug)}/agreements`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _integAgr = { slug, data: j };
  } catch (e) { _integAgr = { slug, error: e.message }; }
  if (_integSel === slug && _integTab === 'agreement') renderIntegrations();
}

function _integAgreement(c) {
  if (!_integAgr || _integAgr.slug !== c.slug) {
    _integLoadAgr(c.slug);
    return `<div class="integ-empty">${escapeHtml(I18N.t('common.loading'))}</div>`;
  }
  if (_integAgr.loading) return `<div class="integ-empty">${escapeHtml(I18N.t('common.loading'))}</div>`;
  if (_integAgr.error) return `<div class="integ-empty">${escapeHtml(I18N.t('integ.loadFailed'))} ${escapeHtml(_integAgr.error)}</div>`;
  const { agreements, drift, legalBases } = _integAgr.data;
  const cur = agreements[0];
  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = cur && cur.review_due <= today;
  const row = (k, v) => `<dt>${escapeHtml(I18N.t(k))}</dt><dd>${v ? escapeHtml(v) : '<span class="integ-null">-</span>'}</dd>`;
  const f = (id, k, extra = '') => `<label class="integ-fld" for="${id}"><span>${escapeHtml(I18N.t(k))}</span>${extra}</label>`;
  return `${!cur ? `<p class="integ-hint integ-hint--warn">${escapeHtml(I18N.t('integ.agr.none'))}</p>` : ''}
    ${drift ? `<p class="integ-hint integ-hint--warn">${escapeHtml(I18N.t('integ.agr.drift'))}</p>` : ''}
    ${dueSoon ? `<p class="integ-hint integ-hint--warn">${escapeHtml(I18N.t('integ.agr.reviewDue'))}</p>` : ''}
    ${cur ? `<dl class="integ-kv">
      ${row('integ.agr.version', 'v' + cur.version)}${row('integ.agr.purpose', cur.purpose)}
      ${row('integ.agr.basis', I18N.t('integ.agr.b.' + cur.legal_basis))}${row('integ.agr.dpa', cur.dpa_ref)}
      ${row('integ.agr.approvedBy', cur.approved_by)}${row('integ.agr.validUntil', cur.valid_until)}
      ${row('integ.agr.reviewDueAt', cur.review_due)}
      ${row('integ.agr.recorded', new Date(cur.created_at).toLocaleString() + ' · ' + (cur.created_by || ''))}</dl>` : ''}
    <form class="integ-agr-form" data-integ-agr-form="${escapeHtml(c.slug)}">
      <h4>${escapeHtml(I18N.t(cur ? 'integ.agr.newVersion' : 'integ.agr.record'))}</h4>
      ${f('agrPurpose', 'integ.agr.purpose', `<textarea id="agrPurpose" name="purpose" rows="3" maxlength="2000" required></textarea>`)}
      ${f('agrBasis', 'integ.agr.basis', `<select id="agrBasis" name="legalBasis">${legalBases.map(b =>
          `<option value="${b}">${escapeHtml(I18N.t('integ.agr.b.' + b))}</option>`).join('')}</select>`)}
      ${f('agrDpa', 'integ.agr.dpa', `<input id="agrDpa" name="dpaRef" maxlength="200">`)}
      ${f('agrBy', 'integ.agr.approvedBy', `<input id="agrBy" name="approvedBy" maxlength="200" required>`)}
      ${f('agrUntil', 'integ.agr.validUntil', `<input id="agrUntil" name="validUntil" type="date">`)}
      ${f('agrReview', 'integ.agr.reviewDueAt', `<input id="agrReview" name="reviewDue" type="date">`)}
      <button class="btn btn-sm" type="submit">${escapeHtml(I18N.t('integ.agr.save'))}</button>
    </form>
    ${agreements.length > 1 ? `<h4>${escapeHtml(I18N.t('integ.agr.history'))}</h4><ul class="integ-agr-hist">${agreements.slice(1).map(a =>
      `<li><b>v${a.version}</b> ${escapeHtml(new Date(a.created_at).toLocaleDateString())} · ${escapeHtml(a.approved_by)} · ${escapeHtml(a.purpose.slice(0, 120))}</li>`).join('')}</ul>` : ''}`;
}

async function _integSaveAgr(form) {
  const slug = form.dataset.integAgrForm;
  const fd = Object.fromEntries(new FormData(form));
  const body = { purpose: fd.purpose, legalBasis: fd.legalBasis, dpaRef: fd.dpaRef, approvedBy: fd.approvedBy,
    validUntil: fd.validUntil || null, reviewDue: fd.reviewDue || null };
  const r = await fetch(`${API}/api/integrations/${encodeURIComponent(slug)}/agreements`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return alert(j.error || `HTTP ${r.status}`);
  _integLoadAgr(slug);
}

function _integSql(c) {
  const lines = [];
  for (const v of _integData.views) {
    const cols = _integData.columns[v] || [];
    const g = c.grants[v] || {};
    const on = cols.filter(x => g[x.name]).map(x => x.name);
    if (!on.length) lines.push(`-- ${v}: ${I18N.t('integ.noAccess')}`);
    else if (on.length === cols.length) lines.push(`GRANT SELECT ON ${v} TO ${c.db_role};`);
    else lines.push(`GRANT SELECT (${on.join(', ')})\n  ON ${v} TO ${c.db_role};`);
  }
  return `<p class="integ-hint">${escapeHtml(I18N.t('integ.sqlHint'))}</p>
    <pre class="integ-code">${escapeHtml(lines.join('\n'))}</pre>`;
}

function _integProbe(u) {
  if (!u || !Number(u.n)) return '';
  return `<div class="card integ-card integ-probe">
    <b>${escapeHtml(I18N.t('integ.unknownKeys'))}</b>
    <span>${u.n} ${escapeHtml(I18N.t('integ.attempts'))} · ${u.keys} ${escapeHtml(I18N.t('integ.distinctKeys'))} · ${escapeHtml(I18N.t('integ.last'))} ${escapeHtml(new Date(u.last_at).toLocaleString())}</span>
  </div>`;
}

// ── actions ───────────────────────────────────────────────────
async function _integSaveGrants(slug) {
  if (!_integDraft || _integSaving) return;
  _integSaving = true; renderIntegrations();
  try {
    await _integReq('PUT', `/${encodeURIComponent(slug)}/grants`, { grants: _integDraft });
    _integDraft = null; _integSaving = false; _integPreview = null;
    // Reload rather than trusting the draft: the response says what we asked
    // for, the page should show what Postgres holds.
    await loadIntegrations();
  } catch (e) {
    _integSaving = false; renderIntegrations();
    alert(I18N.t('integ.saveFailed') + ' ' + e.message);
  }
}

async function _integAction(slug, path, confirmMsg, body) {
  if (confirmMsg && !confirm(confirmMsg)) return null;
  try {
    const j = await _integReq('POST', `/${encodeURIComponent(slug)}/${path}`, body || {});
    await loadIntegrations();
    return j;
  } catch (e) { alert(e.message); return null; }
}

function _integExtend(slug) {
  const days = prompt(I18N.t('integ.extendPrompt') + ' (' + INTEG_TERMS.join(' / ') + ')', '90');
  if (!days) return;
  _integAction(slug, 'extend', null, { days: Number(days) });
}

async function _integRotate(slug) {
  if (!confirm(I18N.t('integ.confirmRotate'))) return;
  try {
    const j = await _integReq('POST', `/${encodeURIComponent(slug)}/rotate`, {});
    // Show the new credentials immediately — the operator rotated in order to
    // hand something over, and making them hunt for the reveal button after is
    // how a key gets rotated and never delivered.
    _integSecret = { slug, appKey: j.appKey, appSecret: j.appSecret };
    _integArmAutoHide();
    await loadIntegrations();
  } catch (e) { alert(e.message); }
}

function _integRevoke(slug) {
  _integAction(slug, 'revoke', I18N.t('integ.confirmRevoke'));
}

// ลบถาวร — ปุ่มนี้โผล่เฉพาะ partner ที่ถูก revoke ไปแล้ว (ฝั่ง server บังคับซ้ำอีกที)
//
// ใช้ช่องพิมพ์ยืนยันแทน confirm() แบบปุ่มเดียว ด้วยเหตุผลเดียวกับปุ่มรีบูตกล้องใน
// หน้า Health: การกดพลาดหนึ่งครั้งบนปุ่มที่อยู่ติดกับ "เปิดใช้อีกครั้ง" จบด้วยการ
// ทำลาย role + คีย์ที่กู้คืนไม่ได้ · การต้องพิมพ์ทำให้กดผิดโดยไม่ตั้งใจเป็นไปไม่ได้
//
// คำที่ต้องพิมพ์ต้องตรงกับ DELETE_WORD ใน routes/integrations.js — server ตรวจซ้ำ
// เองอยู่แล้ว หน้าจอนี้แค่ทำให้ผู้ใช้รู้ตัวก่อนถึงจะยิงไป
async function _integDelete(slug, label) {
  const typed = prompt(`${I18N.t('integ.deleteWarn')}\n\n${label} (${slug})\n\n${I18N.t('integ.deleteType')}`);
  if (typed == null) return;                       // กด Cancel = เงียบ ๆ ไม่ต้องด่า
  if (typed.trim() !== 'Confirm') { alert(I18N.t('integ.deleteMismatch')); return; }
  try {
    const j = await _integReq('DELETE', `/${encodeURIComponent(slug)}`, { confirm: typed.trim() });
    // บอกให้ครบว่าเกิดอะไรขึ้นกับ role และ log — สองอย่างนี้อยู่นอกแถวที่เพิ่งลบ
    // และเป็นสิ่งที่คนกดจะต้องตอบได้ทีหลังว่า "ของมันหายไปไหน"
    alert(`${I18N.t('integ.deleteDone')}\n\n${slug}\n` +
          `role ${j.dbRole}: ${j.roleDropped ? I18N.t('integ.deleteRoleGone') : I18N.t('integ.deleteRoleAbsent')}\n` +
          `log: ${j.logRows} ${I18N.t('integ.deleteLogKept')}`);
    _integSel = null;
    await loadIntegrations();
  } catch (e) { alert(e.message); }
}

async function _integReveal(slug) {
  try {
    const j = await _integReq('POST', `/${encodeURIComponent(slug)}/reveal`, {});
    _integSecret = { slug, appKey: j.appKey, appSecret: j.appSecret };
    _integArmAutoHide();
    renderIntegrations();
  } catch (e) { alert(e.message); }
}

// Hide again on its own. A secret left on screen outlives the reason it was
// shown — someone starts a screen share, walks away, photographs the dashboard
// for an unrelated ticket.
function _integArmAutoHide() {
  clearTimeout(_integSecretTimer);
  _integSecretTimer = setTimeout(() => { _integSecret = null; renderIntegrations(); }, 30000);
}

async function _integCopy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const was = btn.textContent;
    btn.textContent = I18N.t('integ.copied');
    setTimeout(() => { btn.textContent = was; }, 1200);
  } catch { alert(I18N.t('integ.copyFailed')); }
}

// Show warning modal when unchecking a column that affects endpoints
async function _integShowWarning(c, view, col) {
  if (!_integData?.endpoints) return;

  // เตือนเฉพาะเมื่อเป็นฟิลด์ที่ขาดไม่ได้ของ endpoint (id / เวลา / camera_id ฯลฯ) — ขาด = 403 ทั้งเส้น
  // ฟิลด์อื่นถอนได้เลย เพราะตั้งแต่ระยะ 2 ขั้น 1 มันแค่หายจากแถว ไม่ทำให้ endpoint ล้ม
  const affected = _integData.endpoints.filter(e => e.view === view && (e.required || e.columns).includes(col));
  if (!affected.length) {
    // ไม่ใช่ฟิลด์ที่ขาดไม่ได้ของ endpoint ไหน — ถอนได้ทันที
    _integDraft ||= _integEffective(c);
    _integDraft[view][col] = false;
    renderIntegrations();
    return;
  }

  // Load usage data if not cached for this partner
  _integUsageCache ||= {};
  if (!_integUsageCache[c.slug]) {
    try {
      const r = await fetch(`${API}/api/integrations/${encodeURIComponent(c.slug)}/endpoint-usage`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _integUsageCache[c.slug] = await r.json();
    } catch (e) {
      console.error('[integ warning] usage fetch failed:', e.message);
      // Continue anyway with counts of 0
      _integUsageCache[c.slug] = {};
    }
  }

  const usage = _integUsageCache[c.slug] || {};
  _integPendingCol = { slug: c.slug, view, col, affected, usage };
  _integShowConfirmModal(c, affected, usage);
}

function _integShowConfirmModal(c, endpoints, usage) {
  const modal = document.getElementById('integWarnModal');
  const body = document.getElementById('integWarnBody');
  if (!modal || !body) return;

  const endpointHtml = endpoints.map(ep => {
    const count = usage[ep.path] || 0;
    return `<div class="integ-warn-endpoint">
      <code>${escapeHtml(ep.path)}</code>
      <span class="integ-warn-count">${count} ${escapeHtml(I18N.t('integ.callsIn7d'))}</span>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="integ-warn-msg">
      <p>${escapeHtml(I18N.t('integ.warnBeforeRevoke'))}</p>
      <div class="integ-warn-endpoints">${endpointHtml}</div>
      <p class="integ-warn-note">${escapeHtml(I18N.t('integ.revokeNote'))}</p>
    </div>`;

  // Bind confirm/cancel buttons
  const confirm = modal.querySelector('[data-integ-warn-confirm]');
  const cancel = modal.querySelector('[data-integ-warn-cancel]');
  if (confirm) confirm.onclick = () => _integConfirmWarning();
  if (cancel) cancel.onclick = () => _integCancelWarning();

  modal.classList.remove('hidden');
}

function _integConfirmWarning() {
  if (!_integPendingCol) return;
  const { slug, view, col } = _integPendingCol;
  _integDraft ||= _integEffective({ slug });
  _integDraft[view][col] = false;
  _integPendingCol = null;
  document.getElementById('integWarnModal')?.classList.add('hidden');
  renderIntegrations();
}

function _integCancelWarning() {
  _integPendingCol = null;
  document.getElementById('integWarnModal')?.classList.add('hidden');
  renderIntegrations();
}

async function _integOpenapi(slug) {
  const out = document.getElementById('integSpecOut');
  if (!out) return;
  out.textContent = I18N.t('common.loading');
  try {
    const r = await fetch(`${API}/api/integrations/${encodeURIComponent(slug)}/openapi`);
    out.textContent = JSON.stringify(await r.json(), null, 2);
  } catch (e) { out.textContent = I18N.t('integ.specFailed') + ' ' + e.message; }
}

// ── create / edit form ────────────────────────────────────────
// One form for both. The slug becomes the database role name and is therefore
// fixed at creation — editable while creating, read-only afterwards.
function _integOpenForm(existing) {
  const sites = _integData?.sites?.length ? _integData.sites : ['hkt', 'hdy', 'vss', 'main'];
  const bg = document.getElementById('integFormModal');
  const body = document.getElementById('integFormBody');
  const title = document.getElementById('integFormTitle');
  if (!bg || !body) return;

  const e = existing;
  title.textContent = e ? I18N.t('integ.editTitle') : I18N.t('integ.createTitle');
  const scoped = e ? (e.site_codes || null) : null;

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fSlug'))}</label>
      ${e ? `<input class="form-input" value="${escapeHtml(e.slug)}" disabled>
             <div class="integ-fieldnote">${escapeHtml(I18N.t('integ.slugFixed'))}</div>`
          : `<input class="form-input" id="integFSlug" placeholder="cib" autocomplete="off">
             <div class="integ-fieldnote">${escapeHtml(I18N.t('integ.slugNote'))}</div>`}
    </div>
    <div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fLabel'))}</label>
      <input class="form-input" id="integFLabel" value="${e ? escapeHtml(e.label) : ''}" placeholder="CIB">
    </div>
    <div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fSites'))}</label>
      <div class="integ-sitepick" id="integFSites">
        <label class="integ-siteopt"><input type="checkbox" data-site="__all" ${scoped === null ? 'checked' : ''}> ${escapeHtml(I18N.t('integ.allSites'))}</label>
        ${sites.map(s => `<label class="integ-siteopt"><input type="checkbox" data-site="${escapeHtml(s)}" ${scoped && scoped.includes(s) ? 'checked' : ''}> ${escapeHtml(s)}</label>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fLookback'))}</label>
      <input class="form-input" id="integFLookback" type="number" min="1" max="3650"
             value="${e && e.max_lookback_days ? e.max_lookback_days : ''}" placeholder="${escapeHtml(I18N.t('integ.systemDefault'))}">
    </div>
    <div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fRate'))}</label>
      <input class="form-input" id="integFRate" type="number" min="1" max="6000" value="${e ? e.rate_per_min : 60}">
    </div>
    ${e ? '' : `<div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fDays'))}</label>
      <select class="form-input" id="integFDays">
        <option value="">${escapeHtml(I18N.t('integ.noExpiry'))}</option>
        ${INTEG_TERMS.map(d => `<option value="${d}"${d === 90 ? ' selected' : ''}>${d} ${escapeHtml(I18N.t('integ.days'))}</option>`).join('')}
      </select>
    </div>`}
    <div class="form-group">
      <label class="form-label">${escapeHtml(I18N.t('integ.fNotes'))}</label>
      <input class="form-input" id="integFNotes" value="${e && e.notes ? escapeHtml(e.notes) : ''}" placeholder="${escapeHtml(I18N.t('integ.notesPlaceholder'))}">
    </div>
    <div class="integ-formfoot">
      <button class="btn btn-ghost" id="integFCancel">${escapeHtml(I18N.t('common.cancel'))}</button>
      <button class="btn" id="integFSave">${escapeHtml(e ? I18N.t('common.save') : I18N.t('integ.createBtn'))}</button>
    </div>`;

  // "All sites" and specific sites are mutually exclusive — someone who ticks
  // both has not decided which they mean.
  const boxes = body.querySelectorAll('#integFSites input');
  boxes.forEach(b => b.addEventListener('change', () => {
    if (b.dataset.site === '__all' && b.checked) boxes.forEach(o => { if (o !== b) o.checked = false; });
    else if (b.checked) body.querySelector('[data-site="__all"]').checked = false;
  }));

  const close = () => bg.classList.add('hidden');
  body.querySelector('#integFCancel').addEventListener('click', close);
  document.getElementById('integFormClose').onclick = close;
  body.querySelector('#integFSave').addEventListener('click', () => _integSubmitForm(e, close));
  bg.classList.remove('hidden');
  if (!e) body.querySelector('#integFSlug').focus();
}

async function _integSubmitForm(existing, close) {
  const val = id => (document.getElementById(id)?.value ?? '').trim();
  const allBox = document.querySelector('#integFSites [data-site="__all"]');
  const picked = [...document.querySelectorAll('#integFSites input')]
    .filter(b => b.checked && b.dataset.site !== '__all').map(b => b.dataset.site);
  const siteCodes = allBox && allBox.checked ? null : picked;
  const lookback = val('integFLookback');
  const rate = val('integFRate');

  try {
    if (existing) {
      await _integReq('PATCH', `/${encodeURIComponent(existing.slug)}`, {
        label: val('integFLabel'),
        siteCodes,
        ratePerMin: rate === '' ? undefined : Number(rate),
        maxLookbackDays: lookback === '' ? null : Number(lookback),
        notes: val('integFNotes'),
      });
      close();
      await loadIntegrations();
    } else {
      const days = val('integFDays');
      const j = await _integReq('POST', '', {
        slug: val('integFSlug'), label: val('integFLabel'),
        siteCodes, days: days === '' ? null : Number(days),
        maxLookbackDays: lookback === '' ? null : Number(lookback),
        notes: val('integFNotes'),
      });
      // Rate is not part of create — it has a sensible default and adding it to
      // the create path would mean two ways to set the same column. Applied
      // here only when the operator changed it.
      if (rate !== '' && Number(rate) !== 60) {
        await _integReq('PATCH', `/${encodeURIComponent(j.slug)}`, { ratePerMin: Number(rate) });
      }
      close();
      _integSel = j.slug;
      // Straight into the revealed state: they created this in order to hand it
      // over, and the secret is what they came for.
      _integSecret = { slug: j.slug, appKey: j.appKey, appSecret: j.appSecret };
      _integArmAutoHide();
      await loadIntegrations();
    }
  } catch (e) { alert(e.message); }
}
