// ============================================================
// Vigil Platform — Alerts Page (LINE Notification System)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// ============================================================
// 🔔 ALERTS PAGE — LINE Notification System
// ============================================================

let alertRulesCache = [];
let lineConfigCache = null;
let alertRuleSuggestions = [];
let pendingRecipientsCache = [];
// usersCache (vigil users) ใช้ร่วมกับ Users tab — define ใน Users section
let _pendingPollTimer = null;

// Sub-tabs inside the Settings › LINE/การแจ้งเตือน section.
// Logs/history are consolidated under the History Workspace.
function switchAlertTab(tab) {
  ['rules', 'config'].forEach(t => {
    document.getElementById(`alertTab${t.charAt(0).toUpperCase() + t.slice(1)}`)?.classList.toggle('active', t === tab);
    const sec = document.getElementById(`alertSection-${t}`);
    if (sec) sec.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'config') {
    loadLineConfig();
    _startPendingPoll();
  } else {
    _stopPendingPoll();
  }
  if (tab === 'rules') loadAlertRules();
}

function _startPendingPoll() {
  _stopPendingPoll();
  _pendingPollTimer = setInterval(() => {
    const sec = document.getElementById('alertSection-config');
    if (sec && sec.style.display !== 'none') { loadPendingRecipients(); loadBlockedRecipients(); }
    else _stopPendingPoll();
  }, 30000);
}

function _stopPendingPoll() {
  if (_pendingPollTimer) { clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
}

// ── Alert Rules CRUD ────────────────────────────────────────
async function loadAlertRules() {
  try {
    const [rulesRes, suggestionsRes, usersRes] = await Promise.all([
      fetch(`${API}/api/alert-rules`),
      fetch(`${API}/api/alert-rules-suggestions`),
      fetch(`${API}/api/users`),   // ใช้ใน rule editor (push dispatch)
    ]);
    alertRulesCache = await rulesRes.json();
    alertRuleSuggestions = await suggestionsRes.json();
    if (usersRes.ok) usersCache = await usersRes.json();
    renderAlertRules();
  } catch (e) { console.error('loadAlertRules:', e); }
}

function renderAlertRules() {
  const el = document.getElementById('alertRulesList');
  if (!alertRulesCache.length) {
    el.innerHTML = `<div style="text-align:center;padding:50px;color:var(--text-secondary);background:var(--surface-elevated);border:1px dashed var(--border-hairline);border-radius:8px">
      <div style="margin-bottom:10px;opacity:.35"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#icon-bell"/></svg></div>
      <div style="font-size:13px">${escapeHtml(I18N.t('ar.noRules'))}</div>
    </div>`;
    return;
  }
  el.innerHTML = alertRulesCache.map(r => {
    const camChips = r.camera_ids?.length ? r.camera_ids.map(c => `<span class="chip accent">${c}</span>`).join('') : '<span class="chip">ALL</span>';
    const ruleChips = r.rule_names?.length ? r.rule_names.map(n => `<span class="chip">${n}</span>`).join('') : '<span class="chip">ALL</span>';
    const listTypeChips = r.list_types?.length ? r.list_types.map(t => `<span class="chip" style="color:var(--status-bad)">${escapeHtml(t === 'blackList' ? I18N.t('fmatch.blackList') : I18N.t('fmatch.whiteList'))}</span>`).join('') : null;
    const recipChips = r.recipient_ids?.length
      ? `<span class="chip">${escapeHtml(I18N.t('ar.recipCount').replace('{n}', r.recipient_ids.length))}</span>`
      : `<span class="chip">${escapeHtml(I18N.t('ar.recipAll'))}</span>`;
    const lastTrig = r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleString('th-TH', {hour12:false}) : '—';
    return `
      <div class="alert-rule-card ${r.enabled ? '' : 'disabled'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div class="rule-toggle ${r.enabled ? 'on' : ''}" data-action="toggleRule" data-id="${r.id}"></div>
              <strong style="font-size:14px">${r.name}</strong>
              <span style="font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t('ar.trigCount').replace('{n}', r.trigger_count))}</span>
            </div>
            <div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">CAMS:</span>${camChips}</div>
            <div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">RULES:</span>${ruleChips}</div>
            ${listTypeChips ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">FACE LIST:</span>${listTypeChips}</div>` : ''}
            <div style="margin-bottom:6px"><span style="font-size:10px;color:var(--text-secondary);margin-right:6px">SEND TO:</span>${recipChips}</div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:8px">
              Cooldown: ${r.cooldown_seconds}s${r.dwell_threshold_sec ? ` · <span style="color:var(--warn)">Dwell &gt;${r.dwell_threshold_sec}s</span>` : ''} · Snapshot: ${r.send_snapshot ? '✓' : '✗'} · 📱 ${(r.push_user_ids?.length ?? 0)} · Last: ${lastTrig}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-secondary" style="padding:5px 10px;font-size:11px" data-action="openRuleEditor" data-id="${r.id}">${escapeHtml(I18N.t('common.edit'))}</button>
            <button class="btn btn-danger" style="padding:5px 10px;font-size:11px" data-action="deleteRule" data-id="${r.id}">${escapeHtml(I18N.t('common.delete'))}</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function toggleRule(id) {
  const rule = alertRulesCache.find(r => r.id === id);
  if (!rule) return;
  try {
    await fetch(`${API}/api/alert-rules/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    loadAlertRules();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

async function deleteRule(id) {
  const rule = alertRulesCache.find(r => r.id === id);
  if (!rule || !confirm(I18N.t('ar.confirmDeleteRule').replace('{name}', rule.name))) return;
  try {
    await fetch(`${API}/api/alert-rules/${id}`, { method: 'DELETE' });
    loadAlertRules();
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

// ── Rule Editor Modal ───────────────────────────────────────
async function openRuleEditor(id) {
  // Load needed data
  if (!alertRuleSuggestions.length) {
    try {
      const r = await fetch(`${API}/api/alert-rules-suggestions`);
      alertRuleSuggestions = await r.json();
    } catch {}
  }
  if (!lineConfigCache) {
    try {
      const r = await fetch(`${API}/api/line-config`);
      lineConfigCache = await r.json();
    } catch { lineConfigCache = { recipients: [] }; }
  }
  if (!cameras.length) await loadCameras();

  document.getElementById('ruleEditorModal').classList.remove('hidden');
  document.getElementById('ruleId').value = id || '';
  document.getElementById('ruleEditorTitle').textContent = id ? I18N.t('ar.editorEdit') : I18N.t('ar.editorAdd');

  const rule = id ? alertRulesCache.find(r => r.id === id) : null;
  document.getElementById('ruleName').value = rule?.name || '';
  document.getElementById('ruleCooldown').value = rule?.cooldown_seconds ?? 60;
  document.getElementById('ruleDwellThreshold').value = rule?.dwell_threshold_sec ?? '';
  // min_likelihood เก็บเป็น 0..1 — UI ใช้ %
  document.getElementById('ruleMinLikelihood').value = rule?.min_likelihood ? Math.round(rule.min_likelihood * 100) : '';
  document.getElementById('ruleSendSnapshot').checked = rule?.send_snapshot !== false;
  document.getElementById('ruleEnabled').checked = rule?.enabled !== false;
  // Mobile push dispatch — render checklist + role shortcuts
  _renderPushUsersChecklist(rule?.push_user_ids || []);
  // active_from/active_to come back from pg as "HH:MM:SS" — the <input type=time>
  // wants "HH:MM". Empty string when the rule has no window (24/7).
  document.getElementById('ruleActiveFrom').value = rule?.active_from ? String(rule.active_from).slice(0, 5) : '';
  document.getElementById('ruleActiveTo').value   = rule?.active_to   ? String(rule.active_to).slice(0, 5)   : '';
  document.getElementById('ruleMessageTemplate').value = rule?.message_template ||
    '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}\n👤 {object_class} ({likelihood})';

  // Camera checklist
  const camIds = rule?.camera_ids || [];
  document.getElementById('ruleCameraChecklist').innerHTML = cameras.length ? cameras.map(c => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleCamCheck" value="${escapeHtml(c.camera_id)}" ${camIds.includes(c.camera_id) ? 'checked' : ''}>
      <span>${escapeHtml(c.camera_id)} <span style="color:var(--text-secondary)">(${escapeHtml(c.name || c.location || '')})</span></span>
    </label>`).join('') : `<div style="color:var(--text-secondary);font-size:11px;padding:6px">${escapeHtml(I18N.t('ar.noCamerasInSystem'))}</div>`;

  // Rule names checklist
  const ruleNames = rule?.rule_names || [];
  document.getElementById('ruleNamesChecklist').innerHTML = alertRuleSuggestions.length ? alertRuleSuggestions.map(n => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleNameCheck" value="${escapeHtml(n)}" ${ruleNames.includes(n) ? 'checked' : ''}>
      <span>${escapeHtml(n)}</span>
    </label>`).join('') : `<div style="color:var(--text-secondary);font-size:11px;padding:6px">${escapeHtml(I18N.t('ar.noRuleData'))}</div>`;

  // List types checklist (047) — Face Recognition blackList / whiteList
  const selListTypes = rule?.list_types || [];
  const LIST_TYPE_OPTS = [
    { value: 'blackList', label: I18N.t('fmatch.blackList') },
    { value: 'whiteList', label: I18N.t('fmatch.whiteList') },
  ];
  document.getElementById('ruleListTypesChecklist').innerHTML = LIST_TYPE_OPTS.map(o => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleListTypeCheck" value="${o.value}" ${selListTypes.includes(o.value) ? 'checked' : ''}>
      <span>${escapeHtml(o.label)}</span>
    </label>`).join('');

  // Recipients checklist
  const recipIds = rule?.recipient_ids || [];
  const recipients = lineConfigCache.recipients || [];
  document.getElementById('ruleRecipientsChecklist').innerHTML = recipients.length ? recipients.map(rcp => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
      <input type="checkbox" class="ruleRecipCheck" value="${escapeHtml(rcp.id)}" ${recipIds.includes(rcp.id) ? 'checked' : ''}>
      <span><span class="chip" style="font-size:9px;margin-right:4px">${rcp.type === 'group' ? 'GRP' : rcp.type === 'room' ? 'ROOM' : 'USER'}</span>${escapeHtml(rcp.name || rcp.id)} <span style="color:var(--text-secondary);font-family:monospace">${escapeHtml(rcp.id.slice(0, 12))}…</span></span>
    </label>`).join('') : `<div style="color:var(--text-secondary);font-size:11px;padding:6px">${escapeHtml(I18N.t('ar.noRecipientsHint'))}</div>`;
}

function _renderPushUsersChecklist(selectedIds) {
  const checklistEl = document.getElementById('rulePushUsersChecklist');
  const shortcutEl  = document.getElementById('rulePushRoleShortcuts');
  if (!checklistEl || !shortcutEl) return;
  const sel = new Set((selectedIds || []).map(Number));

  // checklist (user รายคน) — เรียง role เพื่ออ่านง่าย
  if (!usersCache.length) {
    checklistEl.innerHTML = `<div style="color:var(--text-secondary);font-size:11px;padding:6px">${I18N.t('ar.noUsers')}</div>`;
  } else {
    const sorted = [...usersCache].sort((a, b) => (a.role || '').localeCompare(b.role || '') || a.username.localeCompare(b.username));
    checklistEl.innerHTML = sorted.map(u => `
      <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px;${u.enabled === false ? 'opacity:0.5' : ''}">
        <input type="checkbox" class="rulePushUserCheck" value="${u.id}" ${sel.has(u.id) ? 'checked' : ''} ${u.enabled === false ? 'disabled' : ''}>
        <span>${escapeHtml(u.username)} <span style="color:var(--text-secondary)">(${escapeHtml(u.role || '')})</span></span>
      </label>`).join('');
  }

  // role shortcuts — ปุ่มลัด select all per role + all + none
  const roles = [...new Set(usersCache.map(u => u.role).filter(Boolean))].sort();
  const btn = (label, action) =>
    `<button type="button" class="btn btn-secondary" style="font-size:10px;padding:3px 8px" data-action="pushUsersSelect" data-push-action="${escapeHtml(action)}">${label}</button>`;
  shortcutEl.innerHTML =
    btn('ทั้งหมด', 'all')
    + btn('ล้าง', 'none')
    + roles.map(r => btn(r, `role:${r}`)).join('');
}

function _pushUsersSelect(action) {
  const boxes = document.querySelectorAll('.rulePushUserCheck');
  const userById = new Map(usersCache.map(u => [String(u.id), u]));
  boxes.forEach(b => {
    if (b.disabled) return;
    const u = userById.get(b.value);
    if (action === 'all')         b.checked = true;
    else if (action === 'none')   b.checked = false;
    else if (action.startsWith('role:')) {
      const role = action.slice(5);
      if (u && u.role === role) b.checked = true;
    }
  });
}

function closeRuleEditor() {
  document.getElementById('ruleEditorModal').classList.add('hidden');
}

async function saveRule() {
  const id = document.getElementById('ruleId').value;
  const data = {
    name: document.getElementById('ruleName').value.trim(),
    enabled: document.getElementById('ruleEnabled').checked,
    cooldown_seconds: parseInt(document.getElementById('ruleCooldown').value) || 60,
    // 0/ว่าง → server เก็บ NULL = rule ปกติ
    dwell_threshold_sec: parseInt(document.getElementById('ruleDwellThreshold').value) || 0,
    // % → 0..1; ว่าง/0 → server เก็บ NULL = ไม่กรอง
    min_likelihood: (parseInt(document.getElementById('ruleMinLikelihood').value) || 0) / 100,
    send_snapshot: document.getElementById('ruleSendSnapshot').checked,
    push_user_ids: [...document.querySelectorAll('.rulePushUserCheck:checked')].map(c => parseInt(c.value, 10)).filter(Number.isFinite),
    message_template: document.getElementById('ruleMessageTemplate').value,
    camera_ids: [...document.querySelectorAll('.ruleCamCheck:checked')].map(c => c.value),
    rule_names: [...document.querySelectorAll('.ruleNameCheck:checked')].map(c => c.value),
    list_types: [...document.querySelectorAll('.ruleListTypeCheck:checked')].map(c => c.value),
    recipient_ids: [...document.querySelectorAll('.ruleRecipCheck:checked')].map(c => c.value),
    // Quiet hours — empty string → server normalizes to NULL (24/7).
    active_from: document.getElementById('ruleActiveFrom').value || '',
    active_to:   document.getElementById('ruleActiveTo').value   || '',
  };
  if (!data.name) { alert(I18N.t('ar.needName')); return; }

  try {
    const url = id ? `${API}/api/alert-rules/${id}` : `${API}/api/alert-rules`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    closeRuleEditor();
    loadAlertRules();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

// ── Alert Stats Summary ─────────────────────────────────────
let _alertStatsWindow = '24h';

async function loadAlertStats(win) {
  if (win) _alertStatsWindow = win;
  const el = document.getElementById('alertStatsSummary');
  if (!el) return;
  el.innerHTML = `<div style="font-size:11px;color:var(--text-secondary);padding:6px 0">${escapeHtml(I18N.t('al.statLoading'))}</div>`;
  try {
    const res = await fetch(`${API}/api/alert-logs/stats?window=${_alertStatsWindow}`, { cache: 'no-store' });
    const data = await res.json();
    el.innerHTML = renderAlertStats(data);
  } catch {
    el.innerHTML = `<div style="font-size:11px;color:var(--status-bad);padding:6px 0">${escapeHtml(I18N.t('al.statError'))}</div>`;
  }
}

function renderAlertStats(d) {
  const skipped = (d.cooldown_skip || 0) + (d.quiet_hours_skip || 0) + (d.no_recipients || 0) + (d.disabled || 0);
  const rate = d.success_rate != null ? `${d.success_rate}%` : '—';
  const avgMs = d.avg_duration_ms != null ? `${d.avg_duration_ms} ms` : '—';

  const card = (color, num, label, sub = '') => `
    <div style="background:var(--surface-overlay);border:1px solid ${color};border-radius:8px;padding:10px 14px;min-width:0">
      <div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${num.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text-primary);margin-top:3px">${label}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:1px">${sub}</div>` : ''}
    </div>`;

  const winBtn = (w, label) => `
    <button data-action="loadAlertStats" data-window="${escapeHtml(w)}"
      style="padding:3px 10px;font-size:10px;border-radius:12px;border:1px solid var(--border-hairline);cursor:pointer;
             background:${_alertStatsWindow === w ? 'var(--accent)' : 'var(--surface-overlay)'};
             color:${_alertStatsWindow === w ? '#fff' : 'var(--text-secondary)'};white-space:nowrap">
      ${escapeHtml(label)}
    </button>`;

  return `
    <div style="background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:8px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div style="font-size:11px;font-weight:600;color:var(--text-secondary)">Summary</div>
        <div style="display:flex;gap:5px">
          ${winBtn('24h', I18N.t('al.win24h'))}
          ${winBtn('7d',  I18N.t('al.win7d'))}
          ${winBtn('30d', I18N.t('al.win30d'))}
        </div>
      </div>
      <div class="al-stats-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${card('var(--status-ok)', d.success || 0,   escapeHtml(I18N.t('al.statSuccess')),  `${rate} ${escapeHtml(I18N.t('al.statSuccessRate'))}`)}
        ${card('var(--status-bad)',   d.failed  || 0,   escapeHtml(I18N.t('al.statFailed')))}
        ${card('var(--warn)', skipped,           escapeHtml(I18N.t('al.statSkipped')))}
        ${card('var(--accent)',d.line_messages_sent || 0, escapeHtml(I18N.t('al.statLineMsg')), `avg ${avgMs}`)}
      </div>
    </div>`;
}

// ── Alert Logs ──────────────────────────────────────────────
async function loadAlertLogs() {
  loadAlertStats();
  try {
    const status = document.getElementById('logFilterStatus')?.value || '';
    const params = status ? `?status=${status}` : '';
    const res = await fetch(`${API}/api/alert-logs${params}`);
    const logs = await res.json();
    renderAlertLogs(logs);
  } catch (e) { console.error('loadAlertLogs:', e); }
}

function renderAlertLogs(logs) {
  const el = document.getElementById('alertLogsList');
  if (!logs.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary);font-size:12px">${escapeHtml(I18N.t('al.noLogs'))}</div>`;
    return;
  }
  const statusIcons = { success: '✓', failed: '✗', cooldown_skip: '⏭', quiet_hours_skip: '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-history"/></svg>', no_recipients: '—', disabled: '⊘' };
  const statusColors = { success: 'var(--status-ok)', failed: 'var(--status-bad)', cooldown_skip: 'var(--warn)', quiet_hours_skip: 'var(--text-secondary)', no_recipients: 'var(--text-secondary)' };
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:140px 1fr 130px 130px 80px 80px;gap:10px;padding:10px 14px;background:var(--surface-overlay);font-size:10px;color:var(--text-secondary);font-weight:600;border-bottom:1px solid var(--border-hairline)">
      <div>${escapeHtml(I18N.t('evt.colTime'))}</div><div>${escapeHtml(I18N.t('al.colRuleMsg'))}</div><div>${escapeHtml(I18N.t('common.camera'))}</div><div>${escapeHtml(I18N.t('al.colTriggerRule'))}</div><div>${escapeHtml(I18N.t('al.colStatus'))}</div><div>${escapeHtml(I18N.t('al.colTimeMs'))}</div>
    </div>
    ${logs.map(l => `
      <div style="display:grid;grid-template-columns:140px 1fr 130px 130px 80px 80px;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border-hairline);font-size:11px;align-items:center">
        <div style="color:var(--text-secondary);font-size:10px">${new Date(l.sent_at).toLocaleString('th-TH', {hour12:false})}</div>
        <div>
          <div style="font-weight:600">${l.rule_name || '—'}</div>
          ${l.message_text ? `<div style="color:var(--text-secondary);font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.message_text.slice(0, 80)}</div>` : ''}
          ${l.error_message ? `<div style="color:var(--status-bad);font-size:10px;margin-top:2px">${l.error_message}</div>` : ''}
        </div>
        <div style="font-family:monospace;font-size:10px">${l.camera_id || '—'}</div>
        <div style="color:var(--text-secondary);font-size:10px">${l.triggered_rule || '—'}</div>
        <div style="color:${statusColors[l.status] || 'var(--text-primary)'};font-weight:600">
          ${statusIcons[l.status] || ''} ${l.status}
        </div>
        <div style="color:var(--text-secondary);font-size:10px;text-align:right">${l.duration_ms || 0}</div>
      </div>`).join('')}`;
}

async function clearOldLogs() {
  if (!confirm(I18N.t('al.confirmClear'))) return;
  try {
    const res = await fetch(`${API}/api/alert-logs?olderThanDays=30`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    loadAlertLogs();
  } catch (e) {
    alert(I18N.t('common.error') + e.message);
  }
}

// ── LINE Config ─────────────────────────────────────────────
async function loadLineConfig() {
  try {
    const res = await fetch(`${API}/api/line-config`);
    lineConfigCache = await res.json();
    document.getElementById('cfgLineToken').placeholder = lineConfigCache._hasToken ? lineConfigCache.channel_access_token : 'paste token from LINE Developers Console';
    document.getElementById('cfgLineToken').value = lineConfigCache._hasToken ? lineConfigCache.channel_access_token : '';
    document.getElementById('cfgLineSecret').value = lineConfigCache._hasSecret ? lineConfigCache.channel_secret : '';
    document.getElementById('cfgImgbbKey').value = lineConfigCache._hasImgbb ? lineConfigCache.imgbb_api_key : '';
    document.getElementById('cfgEnabled').checked = !!lineConfigCache.enabled;
    const basicIdEl = document.getElementById('cfgLineBasicId');
    if (basicIdEl) basicIdEl.value = lineConfigCache.oa_basic_id || '';
    renderRecipients();
    renderOnboardQr(lineConfigCache.oa_basic_id);
    loadPendingRecipients();
    loadBlockedRecipients();
    loadLineQuota();
  } catch (e) { console.error('loadLineConfig:', e); }
}

async function loadLineQuota() {
  const el = document.getElementById('lineQuotaWidget');
  if (!el) return;
  el.innerHTML = `<div style="font-size:10px;color:var(--text-secondary)">${I18N.t('ar.checkingQuota')}</div>`;
  try {
    const res = await fetch(`${API}/api/line-config/quota`);
    const data = await res.json();
    el.innerHTML = renderLineQuotaWidget(data);
  } catch {
    el.innerHTML = renderLineQuotaWidget({ connected: false });
  }
}

function renderLineQuotaWidget(data) {
  const base = 'border-radius:7px;padding:10px 12px;font-size:11px;border:1px solid';
  if (!data.connected) {
    return `<div style="${base} var(--border-hairline);background:var(--surface-overlay);color:var(--text-secondary)">
      <span style="color:var(--status-bad)">●</span>&ensp;${I18N.t('ar.lineConnError')}
    </div>`;
  }
  if (data.type === 'none') {
    return `<div style="${base} var(--border-hairline);background:var(--surface-overlay)">
      <span style="color:var(--status-ok)">●</span>&ensp;
      <strong>Connected</strong>&ensp;·&ensp;${I18N.t('ar.quotaUnlimitedPlan')}&ensp;·&ensp;${I18N.t('ar.quotaSent').replace('{n}', `<strong>${data.used.toLocaleString()}</strong>`)}
      <button data-action="loadLineQuota" style="float:right;background:none;border:none;color:var(--text-secondary);font-size:10px;cursor:pointer;padding:0">↻</button>
    </div>`;
  }
  const limit = data.limit ?? 0;
  const used = data.used ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const barColor = pct >= 90 ? 'var(--status-bad)' : pct >= 70 ? 'var(--warn)' : 'var(--status-ok)';
  const textColor = pct >= 90 ? 'var(--status-bad)' : pct >= 70 ? 'var(--warn)' : 'var(--text-primary)';
  return `<div style="${base} var(--border-hairline);background:var(--surface-overlay)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
      <span><span style="color:var(--status-ok)">●</span>&ensp;<strong>Connected</strong>&ensp;·&ensp;${I18N.t('ar.quotaMonthTitle')}</span>
      <span style="color:${textColor};font-weight:700">${used.toLocaleString()} / ${limit.toLocaleString()}</span>
      <button data-action="loadLineQuota" style="background:none;border:none;color:var(--text-secondary);font-size:10px;cursor:pointer;padding:0;margin-left:8px">↻</button>
    </div>
    <div style="height:5px;border-radius:3px;background:var(--border-hairline);overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
    </div>
    <div style="margin-top:5px;color:var(--text-secondary);font-size:10px">
      ${pct}% used · ${I18N.t('ar.quotaRemaining').replace('{n}', (limit - used).toLocaleString())} · ${I18N.t('ar.quotaReplyFree')}
    </div>
  </div>`;
}

function toggleOnboardGuide() {
  const body = document.getElementById('onboardGuideBody');
  const chevron = document.getElementById('onboardGuideChevron');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  if (chevron) chevron.textContent = open ? '▲' : '▼';
}

function renderOnboardQr(basicId) {
  const wrap = document.getElementById('onboardQrWrap');
  if (!wrap) return;
  const step2 = document.getElementById('onboardStep2');
  if (!basicId) {
    wrap.innerHTML = `<div style="padding:10px;font-size:11px;color:var(--text-secondary);border:1px dashed var(--border-hairline);border-radius:6px">${escapeHtml(I18N.t('ln.onboardNoId'))}</div>`;
    if (step2) step2.dataset.i18nDynamic = I18N.t('ln.onboardStep2').replace('{id}', '');
    return;
  }
  const id = basicId.startsWith('@') ? basicId : '@' + basicId;
  const friendUrl = `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
  if (step2) step2.innerHTML = I18N.t('ln.onboardStep2').replace('{id}', `<strong>${escapeHtml(id)}</strong>`);
  wrap.innerHTML = `
    <img src="${API}/api/line-config/qr" alt="QR" style="width:160px;height:160px;border-radius:8px;border:1px solid var(--border-hairline)" data-err="hide">
    <div style="margin-top:8px;font-size:10px;color:var(--text-secondary)">
      <a href="${escapeHtml(friendUrl)}" target="_blank" style="color:var(--accent)">${escapeHtml(id)}</a>
    </div>`;
}

async function loadPendingRecipients() {
  const el = document.getElementById('pendingRecipientsList');
  if (!el) return;
  try {
    el.innerHTML = `<div style="padding:12px;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('common.loading'))}</div>`;
    const res = await fetch(`${API}/api/line/pending`);
    if (!res.ok) throw new Error((await res.json()).error || 'load failed');
    pendingRecipientsCache = await res.json();
    renderPendingRecipients();
  } catch (e) {
    el.innerHTML = `<div style="padding:12px;color:var(--status-bad);font-size:11px">${escapeHtml(I18N.t('ln.pendingLoadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function renderPendingRecipients() {
  const el = document.getElementById('pendingRecipientsList');
  if (!el) return;
  const rows = Array.isArray(pendingRecipientsCache) ? pendingRecipientsCache : [];
  const badge = document.getElementById('pendingBadge');
  if (badge) {
    badge.textContent = rows.length || '';
    badge.style.display = rows.length ? '' : 'none';
  }
  if (!rows.length) {
    el.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:11px;border:1px dashed var(--border-hairline);border-radius:7px">${escapeHtml(I18N.t('ln.noPending'))}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const typeChip = r.source_type === 'group' ? '<span class="chip" style="font-size:9px">GRP</span>' : r.source_type === 'room' ? '<span class="chip" style="font-size:9px">ROOM</span>' : '<span class="chip" style="font-size:9px">USER</span>';
    const name = r.display_name || I18N.t('ln.unknownName');
    const avatarFallback = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#icon-user"/></svg>`;
    const avatar = r.avatar_url
      ? `<img src="${escapeHtml(r.avatar_url)}" alt="">`
      : avatarFallback;
    const lastSeen = r.last_message_at ? new Date(r.last_message_at).toLocaleString('th-TH', { hour12:false }) : '—';
    return `
      <div class="line-pending-card">
        <div class="line-pending-avatar">${avatar}</div>
        <div class="line-pending-main">
          <div class="line-pending-name">${typeChip} ${escapeHtml(name)}</div>
          <div class="line-pending-meta">${escapeHtml(r.line_id)} · ${escapeHtml(r.source_type || '')} · ${escapeHtml(I18N.t('ln.msgCount').replace('{n}', r.message_count || 1))}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${escapeHtml(I18N.t('ln.lastSeen').replace('{time}', lastSeen))}</div>
        </div>
        <div class="line-pending-actions">
          <button class="btn btn-primary" style="padding:5px 10px;font-size:10px" data-action="approvePendingRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.approve'))}</button>
          <button class="btn btn-secondary" style="padding:5px 10px;font-size:10px" data-action="ignorePendingRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.ignore'))}</button>
          <button class="btn btn-danger" style="padding:5px 10px;font-size:10px" data-action="blockRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.block'))}</button>
        </div>
      </div>`;
  }).join('');
}

function renderRecipients() {
  const el = document.getElementById('recipientsList');
  const recipients = lineConfigCache?.recipients || [];
  if (!recipients.length) {
    el.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('ar.noRecipients'))}</div>`;
    return;
  }
  el.innerHTML = recipients.map((r, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-overlay);border-radius:5px;margin-bottom:6px">
      <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} data-change="updateRecipient" data-idx="${i}" data-field="enabled">
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:600"><span class="chip" style="font-size:9px;margin-right:4px">${r.type === 'group' ? 'GRP' : r.type === 'room' ? 'ROOM' : 'USER'}</span>${escapeHtml(r.name || I18N.t('ar.unnamed'))}</div>
        <div style="font-size:9px;color:var(--text-secondary);font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.id)}</div>
      </div>
      <button class="btn btn-secondary" style="padding:3px 7px;font-size:9px" data-action="testRecipient" data-id="${escapeHtml(r.id)}">Test</button>
      <button class="btn btn-danger" style="padding:3px 7px;font-size:9px" data-action="removeRecipient" data-idx="${i}">✕</button>
    </div>`).join('');
}

function updateRecipient(idx, field, value) {
  if (!lineConfigCache.recipients[idx]) return;
  lineConfigCache.recipients[idx][field] = value;
}

function addRecipient() {
  const id = prompt(I18N.t('ar.promptId'));
  if (!id || !id.trim()) return;
  const trimmedId = id.trim();
  const type = trimmedId.startsWith('C') ? 'group' : 'user';
  const name = prompt(I18N.t('ar.promptName')) || 'Unnamed';
  if (!lineConfigCache.recipients) lineConfigCache.recipients = [];
  lineConfigCache.recipients.push({ id: trimmedId, type, name, enabled: true });
  renderRecipients();
}

function removeRecipient(idx) {
  if (!confirm(I18N.t('ar.confirmDeleteRecip'))) return;
  lineConfigCache.recipients.splice(idx, 1);
  renderRecipients();
  saveLineConfig({ silent: true });
}

async function testRecipient(id) {
  try {
    const res = await fetch(`${API}/api/line-config/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: id }),
    });
    const data = await res.json();
    alert(data.success ? I18N.t('ar.testOk') : I18N.t('ar.testFail') + data.error);
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function saveLineConfig({ silent = false } = {}) {
  try {
    const tokenVal = document.getElementById('cfgLineToken').value;
    const secretVal = document.getElementById('cfgLineSecret').value;
    const imgbbVal = document.getElementById('cfgImgbbKey').value;
    const basicIdVal = (document.getElementById('cfgLineBasicId')?.value || '').trim();
    const data = {
      enabled: document.getElementById('cfgEnabled').checked,
      recipients: lineConfigCache?.recipients || [],
      oa_basic_id: basicIdVal || null,
    };
    // ส่ง token เฉพาะถ้าผู้ใช้ใส่ใหม่ (ไม่ใช่ masked value)
    if (tokenVal && !tokenVal.startsWith('••')) data.channel_access_token = tokenVal;
    if (secretVal && !secretVal.startsWith('••')) data.channel_secret = secretVal;
    if (imgbbVal && !imgbbVal.startsWith('••')) data.imgbb_api_key = imgbbVal;

    const res = await fetch(`${API}/api/line-config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    if (!silent) alert(I18N.t('ar.configSaved'));
    loadLineConfig();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

async function approvePendingRecipient(lineId) {
  try {
    const row = pendingRecipientsCache.find(r => r.line_id === lineId);
    const defaultName = row?.display_name || lineId;
    const name = prompt(I18N.t('ln.promptApproveName'), defaultName);
    if (name === null) return;
    const res = await fetch(`${API}/api/line/pending/${encodeURIComponent(lineId)}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || defaultName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'approve failed');
    await loadLineConfig();
  } catch (e) { alert(I18N.t('ln.approveFailed') + e.message); }
}

async function ignorePendingRecipient(lineId) {
  if (!confirm(I18N.t('ln.confirmIgnore'))) return;
  try {
    const res = await fetch(`${API}/api/line/pending/${encodeURIComponent(lineId)}/ignore`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ignore failed');
    await loadPendingRecipients();
  } catch (e) { alert(I18N.t('ln.ignoreFailed') + e.message); }
}

async function blockRecipient(lineId) {
  if (!confirm(I18N.t('ln.confirmBlock'))) return;
  try {
    const res = await fetch(`${API}/api/line/pending/${encodeURIComponent(lineId)}/block`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'block failed');
    await Promise.all([loadPendingRecipients(), loadBlockedRecipients()]);
  } catch (e) { alert(I18N.t('ln.blockFailed') + e.message); }
}

async function unblockRecipient(lineId) {
  if (!confirm(I18N.t('ln.confirmUnblock'))) return;
  try {
    const res = await fetch(`${API}/api/line/blocked/${encodeURIComponent(lineId)}/unblock`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'unblock failed');
    await loadBlockedRecipients();
  } catch (e) { alert(I18N.t('ln.unblockFailed') + e.message); }
}

let blockedRecipientsCache = [];

async function loadBlockedRecipients() {
  const el = document.getElementById('blockedList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/line/blocked`);
    if (!res.ok) return;
    blockedRecipientsCache = await res.json();
    renderBlockedRecipients();
  } catch { /* silent */ }
}

function renderBlockedRecipients() {
  const el = document.getElementById('blockedList');
  if (!el) return;
  const rows = Array.isArray(blockedRecipientsCache) ? blockedRecipientsCache : [];
  const badge = document.getElementById('blockedBadge');
  if (badge) { badge.textContent = rows.length || ''; badge.style.display = rows.length ? '' : 'none'; }
  if (!rows.length) {
    el.innerHTML = `<div style="padding:10px;text-align:center;color:var(--text-secondary);font-size:11px;border:1px dashed var(--border-hairline);border-radius:7px">${escapeHtml(I18N.t('ln.noBlocked'))}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const typeChipB = r.source_type === 'group' ? '<span class="chip" style="font-size:9px;margin-right:4px">GRP</span>' : r.source_type === 'room' ? '<span class="chip" style="font-size:9px;margin-right:4px">ROOM</span>' : '<span class="chip" style="font-size:9px;margin-right:4px">USER</span>';
    const name = r.display_name || I18N.t('ln.unknownName');
    const lastSeen = r.last_message_at ? new Date(r.last_message_at).toLocaleString('th-TH', { hour12: false }) : '—';
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-overlay);border-radius:6px;margin-bottom:6px;opacity:0.75">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary)">${typeChipB}${escapeHtml(name)}</div>
          <div style="font-size:9px;color:var(--muted);font-family:monospace">${escapeHtml(r.line_id)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHtml(I18N.t('ln.lastSeen').replace('{time}', lastSeen))}</div>
        </div>
        <button class="btn btn-secondary" style="padding:4px 8px;font-size:10px" data-action="unblockRecipient" data-line-id="${escapeHtml(r.line_id)}">${escapeHtml(I18N.t('ln.unblock'))}</button>
      </div>`;
  }).join('');
}

