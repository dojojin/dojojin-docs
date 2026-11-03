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
  ['rules', 'config', 'telegram', 'edge', 'hcpface', 'auraface', 'lpr', 'gsalarm', 'commands', 'tgcommands'].forEach(t => {
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
  if (tab === 'telegram') {
    loadTgConfig();
    _startTgPendingPoll();
  } else {
    _stopTgPendingPoll();
  }
  if (tab === 'rules') loadAlertRules();
  if (tab === 'commands') loadLineCommands().catch(() => {});
  if (tab === 'tgcommands') loadTgCommands().catch(() => {});
  if (tab === 'edge') loadEdgeAlert();
  if (_ACH_TAB_TO_CHANNEL[tab]) loadAlertChannels(tab);
}

let _pendingPollTicks = 0;
function _startPendingPoll() {
  _stopPendingPoll();
  _pendingPollTicks = 0;
  _pendingPollTimer = setInterval(() => {
    const sec = document.getElementById('alertSection-config');
    if (sec && sec.style.display !== 'none') {
      loadPendingRecipients(); loadBlockedRecipients();
      // การ์ดโควตา LINE รีเฟรชช้ากว่า (ทุก 60s = ทุก 2 รอบของ timer 30s นี้)
      // — ไม่เปิด timer ที่สองให้ต้องดูแลอายุคู่กัน
      _pendingPollTicks++;
      if (_pendingPollTicks % 2 === 0) loadLineQuota();
    }
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
    const res = await fetch(`${API}/api/alert-rules/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    loadAlertRules();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

async function deleteRule(id) {
  const rule = alertRulesCache.find(r => r.id === id);
  if (!rule || !confirm(I18N.t('ar.confirmDeleteRule').replace('{name}', rule.name))) return;
  try {
    const res = await fetch(`${API}/api/alert-rules/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
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
  // T2b: ช่องทางส่ง — ต้องรู้ว่า Telegram พร้อมไหม + รายชื่อแชทที่อนุมัติแล้ว
  // เหมือนแท็บช่องทางประจำระบบ (loadAlertChannels) เพียงแต่ฟอร์มนี้เปิดจากแท็บ "Rules"
  // ซึ่งไม่เคยโหลด tgConfigCache มาก่อน
  if (!tgConfigCache) {
    try {
      const rt = await fetch(`${API}/api/telegram-config`);
      if (rt.ok) tgConfigCache = await rt.json();
    } catch {}
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
  // หน้าตาการ์ด LINE (migration 145) · ว่าง = ใช้ของเดิมที่ระบบประกอบให้
  document.getElementById('ruleShowOpenLink').checked = rule?.show_open_link !== false;
  document.getElementById('ruleTitleTpl').value    = rule?.title_template || '';
  document.getElementById('ruleSubtitleTpl').value = rule?.subtitle_template || '';
  document.getElementById('ruleTextPosition').value = rule?.text_position === 'above' ? 'above' : 'below';
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

  // ช่องทางส่ง (T2b) — เหมือนแท็บช่องทางประจำระบบ แต่ id คนละชุด (ruleDeliverVia/
  // ruleTgChat) เพราะฟอร์มนี้อยู่ในโมดัล ไม่ใช่แท็บ achBody-${ch}
  _renderRuleDeliverVia(rule);
}

function _renderRuleDeliverVia(rule) {
  const dvEl = document.getElementById('ruleDeliverVia');
  if (!dvEl) return;
  const tgReady = !!(tgConfigCache?.enabled && tgConfigCache?.has_token);
  const dv = rule?.deliver_via || 'line';
  // ปิดเฉพาะสองตัวเลือกที่ต้องพึ่ง Telegram ไม่ใช่ทั้ง select — เลือกไว้เป็น telegram/both
  // ตั้งแต่ตอนบอทยังพร้อมอยู่ แล้วภายหลังบอทถูกปิด ต้องยังสลับกลับมา LINE เองได้
  // (ปิดทั้ง select = ติดค้างเลือกช่องทางที่ใช้ไม่ได้แล้วตลอดไป) — 'line_then_telegram'
  // (T3) ไม่ต้องพึ่งบอทพร้อม เพราะ LINE ยังเป็นหลักเสมอ จึงไม่ถูกปิด
  for (const v of ['telegram', 'both']) {
    const opt = dvEl.querySelector(`option[value="${v}"]`);
    if (opt) opt.disabled = !tgReady;
  }
  dvEl.value = ['telegram', 'both', 'line_then_telegram'].includes(dv) ? dv : 'line';
  document.getElementById('ruleTgReadyHint').style.display = tgReady ? 'none' : '';

  const chats = tgConfigCache?.chats || [];
  const checklistEl = document.getElementById('ruleTgChatChecklist');
  if (dv === 'line_then_telegram') {
    // T3: ไม่มีให้เลือกแชทเอง — จับคู่อัตโนมัติจาก mirror_of_line_id รายแชทแทน
    const hasMirror = chats.some((c) => c && c.mirror_of_line_id);
    checklistEl.innerHTML = hasMirror ? '' :
      `<div class="ach-locked" style="margin-top:6px">${escapeHtml(I18N.t('ach.deliverViaNoMirror'))}</div>`;
    return;
  }
  const sel = new Set((rule?.telegram_chat_ids || []).map(String));
  checklistEl.innerHTML = !chats.length
    ? `<div class="ach-locked" style="margin-top:6px">${escapeHtml(I18N.t('ach.tgNoApprovedChats'))}</div>`
    : `<div style="margin-top:8px;background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:5px;padding:8px;max-height:140px;overflow-y:auto">
        ${chats.map((c) => `
          <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
            <input type="checkbox" class="ruleTgChat" value="${escapeHtml(c.chat_id)}" ${sel.has(String(c.chat_id)) ? 'checked' : ''}>
            <span><span class="chip" style="font-size:9px;margin-right:4px">${c.type === 'private' ? 'DM' : 'GRP'}</span>${escapeHtml(c.name || c.chat_id)}</span>
          </label>`).join('')}
      </div>`;
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
    show_open_link: document.getElementById('ruleShowOpenLink').checked,
    title_template: document.getElementById('ruleTitleTpl').value.trim() || null,
    subtitle_template: document.getElementById('ruleSubtitleTpl').value.trim() || null,
    text_position: document.getElementById('ruleTextPosition').value,
    push_user_ids: [...document.querySelectorAll('.rulePushUserCheck:checked')].map(c => parseInt(c.value, 10)).filter(Number.isFinite),
    message_template: document.getElementById('ruleMessageTemplate').value,
    camera_ids: [...document.querySelectorAll('.ruleCamCheck:checked')].map(c => c.value),
    rule_names: [...document.querySelectorAll('.ruleNameCheck:checked')].map(c => c.value),
    list_types: [...document.querySelectorAll('.ruleListTypeCheck:checked')].map(c => c.value),
    recipient_ids: [...document.querySelectorAll('.ruleRecipCheck:checked')].map(c => c.value),
    // Quiet hours — empty string → server normalizes to NULL (24/7).
    active_from: document.getElementById('ruleActiveFrom').value || '',
    active_to:   document.getElementById('ruleActiveTo').value   || '',
    // ช่องทางส่ง — line/telegram/both/line_then_telegram (T3: สำรองอัตโนมัติเมื่อ
    // LINE โดนโควตาเต็ม จับคู่แชทผ่าน mirror_of_line_id ไม่ใช่ telegram_chat_ids)
    deliver_via: document.getElementById('ruleDeliverVia').value,
    telegram_chat_ids: [...document.querySelectorAll('.ruleTgChat:checked')].map(c => c.value),
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

  // Status grouping per D-d: color+icon from group, raw status as label
  const getStatusGroup = (status) => {
    if (['sent', 'sent_manual', 'success'].includes(status)) return { group: 'delivered', color: 'var(--status-ok)', icon: '✓' };
    if (['cooldown_skip', 'quiet_hours_skip', 'group_muted', 'plate_muted', 'line_disabled', 'no_recipients'].includes(status)) return { group: 'suppressed', color: 'var(--text-secondary)', icon: '⏭' };
    if (status === 'failed') return { group: 'failed', color: 'var(--status-bad)', icon: '✗' };
    return { group: 'unknown', color: 'var(--text-secondary)', icon: '—' };
  };

  el.innerHTML = `
    <div style="overflow-x:auto">
      <div style="display:grid;grid-template-columns:140px 1fr 130px 130px 100px 70px 70px 60px;gap:10px;padding:10px 14px;background:var(--surface-overlay);font-size:10px;color:var(--text-secondary);font-weight:600;border-bottom:1px solid var(--border-hairline);min-width:900px">
        <div>${escapeHtml(I18N.t('evt.colTime'))}</div><div>${escapeHtml(I18N.t('al.colRuleMsg'))}</div><div>${escapeHtml(I18N.t('common.camera'))}</div><div>${escapeHtml(I18N.t('al.colTriggerRule'))}</div><div>${escapeHtml(I18N.t('al.colRecipients'))}</div><div>${escapeHtml(I18N.t('al.colImgSrc'))}</div><div>${escapeHtml(I18N.t('al.colStatus'))}</div><div>${escapeHtml(I18N.t('al.colTimeMs'))}</div>
      </div>
      ${logs.map((l, idx) => {
        const sg = getStatusGroup(l.status);
        // pg คืน jsonb มาเป็น object แล้ว ไม่ใช่ string — JSON.parse() จะ throw
        // แล้วพัง template ทั้งก้อน (หน้าจะว่างทันทีที่มีแถวแรกที่มีผู้รับ)
        // null = แถวก่อน migration 187 "ไม่ได้บันทึก" · [] = "ไม่มีผู้รับ" คนละเรื่อง
        const recips = Array.isArray(l.recipients_json) ? l.recipients_json : null;
        const recipientsHtml = recips === null
          ? `<span style="color:var(--text-secondary)" title="${escapeHtml(I18N.t('al.recipNotLogged'))}">—</span>`
          : recips.length === 0
            ? `<span style="color:var(--text-secondary)">0</span>`
            : (() => {
                const bad = recips.filter(r => r.ok === false).length;
                const names = recips.map(r =>
                  `${r.name || r.id_tail || '?'}${r.ok === false ? ' ✗' : r.ok === null ? ' (ระงับ)' : ''}`
                ).join(', ');
                const tone = bad > 0 ? 'var(--status-bad)' : 'var(--text-primary)';
                return `<span style="color:${tone};font-weight:600" title="${escapeHtml(names)}">${recips.length}${bad > 0 ? ` (${bad}✗)` : ''}</span>`;
              })();
        const imgSrc = l.image_source || '—';
        // มีรายละเอียดให้กางเฉพาะแถวที่บันทึกผู้รับไว้ · แถวก่อน migration 187 ไม่มี
        // จึงต้องไม่ตั้ง cursor:pointer และไม่ผูก data-action ไม่งั้นเมาส์บอกว่ากดได้
        // แล้วกดไปไม่เกิดอะไรขึ้น
        const hasDetail = !!(recips && recips.length);
        return `
          <div style="display:grid;grid-template-columns:140px 1fr 130px 130px 100px 70px 70px 60px;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border-hairline);font-size:11px;align-items:center;min-width:900px${hasDetail ? ';cursor:pointer' : ''}"${hasDetail ? ` data-action="toggle-detail" data-log-idx="${idx}" title="${escapeHtml(I18N.t('al.clickDetail'))}"` : ''}>
            <div style="color:var(--text-secondary);font-size:10px">${new Date(l.sent_at).toLocaleString('th-TH', {hour12:false})}</div>
            <div>
              <div style="font-weight:600">${escapeHtml(l.rule_name || '—')}</div>
              ${l.message_text ? `<div style="color:var(--text-secondary);font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.message_text.slice(0, 80))}</div>` : ''}
              ${l.error_message ? `<div style="color:var(--status-bad);font-size:10px;margin-top:2px">${escapeHtml(l.error_message)}</div>` : ''}
            </div>
            <div style="font-family:monospace;font-size:10px">${escapeHtml(l.camera_id || '—')}</div>
            <div style="color:var(--text-secondary);font-size:10px">${escapeHtml(l.triggered_rule || '—')}</div>
            <div style="font-size:10px;text-align:center">${recipientsHtml}</div>
            <div style="font-size:10px;text-align:center;color:var(--text-secondary)">${escapeHtml(imgSrc)}</div>
            <div style="color:${sg.color};font-weight:600;text-align:center">${sg.icon} <span style="white-space:nowrap">${escapeHtml(l.status || '')}</span></div>
            <div style="color:var(--text-secondary);font-size:10px;text-align:right">${l.duration_ms || 0}</div>
          </div>
          ${hasDetail ? `<div style="padding:8px 14px;background:var(--surface-base);border-bottom:1px solid var(--border-hairline);font-size:10px;color:var(--text-secondary);display:none" data-detail-idx="${idx}">
            ${recips.map(r => `<div style="padding:2px 0">
              <span style="color:${r.ok === false ? 'var(--status-bad)' : r.ok === null ? 'var(--text-secondary)' : 'var(--status-ok)'};font-weight:600">${escapeHtml(r.name || '?')}</span>
              <span style="color:var(--text-secondary)">${escapeHtml(r.type || '')}${r.id_tail ? ' ···' + escapeHtml(r.id_tail) : ''}</span>
              ${r.error ? `<span style="color:var(--status-bad)"> · ${escapeHtml(r.error)}</span>` : ''}
              ${r.line_request_id ? `<span style="color:var(--text-secondary);font-family:monospace"> · ${escapeHtml(r.line_request_id)}</span>` : ''}
            </div>`).join('')}
          </div>` : ''}`;
      }).join('')}
    </div>`;

  // Attach detail toggle handler
  el.querySelectorAll('[data-action="toggle-detail"]').forEach(row => {
    row.addEventListener('click', (e) => {
      const idx = row.getAttribute('data-log-idx');
      const detail = el.querySelector(`[data-detail-idx="${idx}"]`);
      if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    });
  });
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
    // สองค่านี้อยู่ system_settings ไม่ใช่ line_config (migration 147)
    try {
      const st = await (await fetch(`${API}/api/settings`)).json();
      const ttlEl = document.getElementById('cfgSignedTtl');
      const fbEl  = document.getElementById('cfgImgbbFallback');
      if (ttlEl) ttlEl.value = parseInt(st.signed_image_expire_hours?.value, 10) || 48;
      if (fbEl)  fbEl.checked = st.imgbb_fallback_enabled?.value !== 'false';
    } catch (e) { console.warn('โหลดค่าตั้งรูปไม่สำเร็จ:', e.message); }
    await loadRcpScopeOptions();
    renderRecipients();
    renderOnboardQr(lineConfigCache.oa_basic_id);
    loadPendingRecipients();
    loadBlockedRecipients();
    loadLineQuota();
  } catch (e) { console.error('loadLineConfig:', e); }
}

async function loadLineQuota() {
  const el = document.getElementById('lineQuotaWidget');
  if (el) el.innerHTML = `<div style="font-size:10px;color:var(--text-secondary)">${I18N.t('ar.checkingQuota')}</div>`;
  try {
    const res = await fetch(`${API}/api/line-config/quota`);
    const data = await res.json();
    if (el) el.innerHTML = renderLineQuotaWidget(data);
    renderQuotaAlertBlock(data.alert || {});
  } catch {
    if (el) el.innerHTML = renderLineQuotaWidget({ connected: false });
    renderQuotaAlertBlock({});
  }
}

// บรรทัดเตือนสั้น ๆ เมื่อโดน "monthly limit" จริงในเดือนนี้ — กันอ่านตัวเลข consumption
// ผิดว่า "ยังไม่เต็ม" ทั้งที่ LINE ปฏิเสธไปแล้ว (ตัวเลขนั้นไม่ real-time พอ ดู migration 239)
function _quotaLimitHitLine(data) {
  if (!data.limit_hit_at) return '';
  const t = new Date(data.limit_hit_at);
  // เวลาไทยเสมอ ไม่ขึ้นกับ TZ ของเครื่องที่เปิดหน้า
  const [hh, mm] = t.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false }).split(':');
  const who = escapeHtml(data.limit_hit_recipient || I18N.t('qa.someone'));
  return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-hairline);color:var(--status-bad);font-size:10px">
    ${I18N.t('qa.limitHitLine').replace('{name}', `<strong>${who}</strong>`).replace('{time}', `${hh}:${mm}`)}
  </div>`;
}

// T3: บรรทัดสั้น ๆ บอกว่าเดือนนี้สลับไป Telegram กี่ครั้ง — โผล่เฉพาะตอนมีจริง
// (เข้าเกณฑ์ WA #2-D: ไม่โชว์ช่องที่รู้อยู่แล้วว่าจะว่างเสมอ)
function _quotaFallbackLine(data) {
  const n = data.fallback_count_this_month || 0;
  if (!n) return '';
  return `<div style="margin-top:4px;color:var(--text-secondary);font-size:10px">
    ${escapeHtml(I18N.t('qa.fallbackCountLine').replace('{n}', n.toLocaleString()))}
  </div>`;
}

function renderLineQuotaWidget(data) {
  const base = 'border-radius:7px;padding:10px 12px;font-size:11px;border:1px solid';
  const badState = !!data.limit_hit_at;
  if (!data.connected) {
    return `<div style="${base} var(--border-hairline);background:var(--surface-overlay);color:var(--text-secondary)">
      <span style="color:var(--status-bad)">●</span>&ensp;${I18N.t('ar.lineConnError')}
      ${_quotaLimitHitLine(data)}
      ${_quotaFallbackLine(data)}
    </div>`;
  }
  if (data.type === 'none') {
    return `<div style="${base} var(--border-hairline);background:var(--surface-overlay)">
      <span style="color:${badState ? 'var(--status-bad)' : 'var(--status-ok)'}">●</span>&ensp;
      <strong>Connected</strong>&ensp;·&ensp;${I18N.t('ar.quotaUnlimitedPlan')}&ensp;·&ensp;${I18N.t('ar.quotaSent').replace('{n}', `<strong>${data.used.toLocaleString()}</strong>`)}
      <button data-action="loadLineQuota" style="float:right;background:none;border:none;color:var(--text-secondary);font-size:10px;cursor:pointer;padding:0">↻</button>
      ${_quotaLimitHitLine(data)}
      ${_quotaFallbackLine(data)}
    </div>`;
  }
  const limit = data.limit ?? 0;
  const used = data.used ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const barColor = badState ? 'var(--status-bad)' : pct >= 90 ? 'var(--status-bad)' : pct >= 70 ? 'var(--warn)' : 'var(--status-ok)';
  const textColor = badState ? 'var(--status-bad)' : pct >= 90 ? 'var(--status-bad)' : pct >= 70 ? 'var(--warn)' : 'var(--text-primary)';
  return `<div style="${base} var(--border-hairline);background:var(--surface-overlay)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
      <span><span style="color:${badState ? 'var(--status-bad)' : 'var(--status-ok)'}">●</span>&ensp;<strong>Connected</strong>&ensp;·&ensp;${I18N.t('ar.quotaMonthTitle')}</span>
      <span style="color:${textColor};font-weight:700">${used.toLocaleString()} / ${limit.toLocaleString()}</span>
      <button data-action="loadLineQuota" style="background:none;border:none;color:var(--text-secondary);font-size:10px;cursor:pointer;padding:0;margin-left:8px">↻</button>
    </div>
    <div style="height:5px;border-radius:3px;background:var(--border-hairline);overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
    </div>
    <div style="margin-top:5px;color:var(--text-secondary);font-size:10px">
      ${pct}% used · ${I18N.t('ar.quotaRemaining').replace('{n}', (limit - used).toLocaleString())} · ${I18N.t('ar.quotaReplyFree')}
    </div>
    ${_quotaLimitHitLine(data)}
    ${_quotaFallbackLine(data)}
  </div>`;
}

// ── "แจ้งเตือนเมื่อโควตาใกล้หมด" (migration 239) — ส่วนตั้งค่า, อยู่ในการ์ดเดียวกับ
// LINE Messaging API · ใช้ค่า alert{} ที่ GET /api/line-config/quota แนบมาให้แล้ว
// ไม่ยิง fetch เพิ่ม
function renderQuotaAlertBlock(alert) {
  const el = document.getElementById('quotaAlertBody');
  if (!el) return;
  const a = alert || {};
  const recipients = (lineConfigCache?.recipients || []).filter((r) => r.enabled !== false);
  const selected = new Set((a.recipients || []).map(String));
  const rows = recipients.length ? recipients.map((r) => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">
      <input type="checkbox" class="quotaAlertRcpChk" value="${escapeHtml(String(r.id))}" ${selected.has(String(r.id)) ? 'checked' : ''}>
      <span style="font-size:13px">${escapeHtml(r.name || r.id)}</span>
    </label>`).join('') : `<div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(I18N.t('qa.noRecipients'))}</div>`;

  const state = a.state || {};
  const statusLine = state.month
    ? I18N.t('qa.statusSentThisMonth')
        .replace('{time}', state.sent_at ? new Date(state.sent_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '')
        .replace('{reason}', state.reason === 'limit_hit' ? I18N.t('qa.reasonLimitHit') : I18N.t('qa.reasonBelowThreshold'))
    : I18N.t('qa.statusNotSent');

  el.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px">
      <input type="checkbox" id="quotaAlertEnabled" ${a.enabled !== false ? 'checked' : ''}>
      <span style="font-size:13px;font-weight:600">${escapeHtml(I18N.t('qa.enabled'))}</span>
    </label>
    <div class="form-group" style="margin-bottom:12px;max-width:220px">
      <label class="form-label">${escapeHtml(I18N.t('qa.threshold'))}</label>
      <input type="number" class="form-input" id="quotaAlertThreshold" min="1" max="100000" step="1" value="${a.threshold ?? 200}">
    </div>
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">${escapeHtml(I18N.t('qa.recipients'))}</div>
      ${rows}
    </div>
    <div style="font-size:10px;color:var(--text-secondary)">${escapeHtml(statusLine)}</div>`;
}

async function saveQuotaAlertSettings() {
  try {
    const enabled = document.getElementById('quotaAlertEnabled').checked;
    const threshold = parseInt(document.getElementById('quotaAlertThreshold').value, 10);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100000) {
      alert(I18N.t('qa.badThreshold')); return;
    }
    const recipients = [...document.querySelectorAll('.quotaAlertRcpChk')].filter((c) => c.checked).map((c) => c.value);
    const res = await fetch(`${API}/api/line-config/quota-alert`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, threshold, recipients }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    alert(I18N.t('ar.configSaved'));
    loadLineQuota();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
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

// Sites and groups for the chips. Fetched once when the LINE panel renders —
// both lists are tiny and change rarely, and a failure just leaves the chips
// out rather than blocking the recipient list itself.
let _rcpSites = [], _rcpGroups = [];

// LPR scope for one recipient. Site sits here rather than on the watch-list
// group because a group is a KIND of vehicle and a site is a TEAM's patch — a
// wanted car is wanted everywhere, so scoping the group would mean one group
// per site per kind. Nothing selected means everything, which is what keeps the
// recipients configured before this feature behaving exactly as they did.
function _lprScopeRow(r, i) {
  const sites  = Array.isArray(r.lpr_sites)  ? r.lpr_sites  : [];
  const groups = Array.isArray(r.lpr_groups) ? r.lpr_groups : [];
  if (!_rcpSites.length && !_rcpGroups.length) return '';
  const chip = (on, label, field, val) =>
    `<button class="rcp-chip${on ? ' on' : ''}" data-action="rcpScopeToggle"
       data-idx="${i}" data-field="${field}" data-val="${escapeHtml(val)}">${escapeHtml(label)}</button>`;
  const anySite  = sites.length  === 0;
  const anyGroup = groups.length === 0;
  return `<div class="rcp-scope">
    <span class="rcp-scope-lbl">${escapeHtml(I18N.t('ar.lprSites', 'ไซต์ LPR:'))}</span>
    ${chip(anySite, I18N.t('common.all', 'ทั้งหมด'), 'lpr_sites', '')}
    ${_rcpSites.map(s => chip(sites.includes(s.code), s.name || s.code, 'lpr_sites', s.code)).join('')}
    <span class="rcp-scope-lbl">${escapeHtml(I18N.t('ar.lprGroups', 'กลุ่มเฝ้าระวัง:'))}</span>
    ${chip(anyGroup, I18N.t('common.all', 'ทั้งหมด'), 'lpr_groups', '')}
    ${_rcpGroups.map(g => chip(groups.includes(g.id), g.name || g.id, 'lpr_groups', g.id)).join('')}
    <span class="rcp-scope-lbl" style="flex:0 0 auto;margin-left:8px;opacity:.75">${escapeHtml(I18N.t('ar.scopeHint', 'ไม่เลือก = รับทั้งหมด · ต้องกดบันทึก'))}</span>
  </div>`;
}

// Empty val = the "ทั้งหมด" chip, which clears the list rather than adding a
// magic member — an empty array and a missing key already mean "everything"
// everywhere else, so there is one representation, not two.
function rcpScopeToggle(el) {
  const idx = +el.dataset.idx, field = el.dataset.field, val = el.dataset.val;
  const r = lineConfigCache?.recipients?.[idx];
  if (!r) return;
  if (!val) { r[field] = []; renderRecipients(); return; }
  const cur = Array.isArray(r[field]) ? [...r[field]] : [];
  const at = cur.indexOf(val);
  if (at >= 0) cur.splice(at, 1); else cur.push(val);
  r[field] = cur;
  // chip ชุดนี้โผล่ได้สองที่ (แท็บป้ายทะเบียน คือที่ที่ใช้จริง) — วาดใหม่เฉพาะที่เปิดอยู่
  const lprBox = document.getElementById('achLprRcp');
  if (lprBox) lprBox.innerHTML = _achLprRcpRows();
  else renderRecipients();
}

async function loadRcpScopeOptions() {
  try {
    const [s, g] = await Promise.all([
      fetch(`${API}/api/sites`).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/lpr/watchlist/groups`).then(r => r.ok ? r.json() : []),
    ]);
    _rcpSites  = Array.isArray(s) ? s : (s?.sites  || []);
    _rcpGroups = Array.isArray(g) ? g : (g?.groups || []);
  } catch { /* chips just do not render */ }
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

    // ค่าตั้งรูป — คนละตาราง จึงเป็นคนละ endpoint (ตรวจก่อนยิง ไม่ให้ 400 เงียบ)
    const ttl = parseInt(document.getElementById('cfgSignedTtl')?.value, 10);
    if (Number.isFinite(ttl)) {
      if (ttl < 1 || ttl > 720) { alert(I18N.t('ln.badSignedTtl')); return; }
      for (const [key, value] of [['signed_image_expire_hours', String(ttl)],
                                  ['imgbb_fallback_enabled', document.getElementById('cfgImgbbFallback').checked ? 'true' : 'false']]) {
        const r = await fetch(`${API}/api/settings/${key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `save ${key} failed`);
      }
    }
    if (!silent) alert(I18N.t('ar.configSaved'));
    loadLineConfig();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

// ── Edge Offline Alert ──────────────────────────────────────
// Reuses /api/line-config: settings live in line_config.edge_alert, and the GET
// attaches _edge_sites (sites that actually send heartbeats) for the toggle list.
async function loadEdgeAlert() {
  try {
    const res = await fetch(`${API}/api/line-config`);
    lineConfigCache = await res.json();
    renderEdgeAlert();
    // สถานะของ Edge มาจาก endpoint เดียวกับอีก 3 ช่องทาง (alert_logs) — เจ้าของขอให้
    // ทั้ง 4 แท็บมีบรรทัดสถานะเหมือนกัน
    await loadAlertChannels();
    const est = document.getElementById('edgeAlertStatus');
    const erow = alertChannelsCache.find(c => c.channel === 'edge');
    if (est && erow) {
      est.innerHTML = achStatusLine(erow.status, { enabled: erow.status.enabled, noSnapshot: true });
    }
  } catch (e) { console.error('loadEdgeAlert:', e); }
}

function renderEdgeAlert() {
  const el = document.getElementById('edgeAlertBody');
  if (!el) return;
  const ea = lineConfigCache?.edge_alert || { enabled: true, threshold_sec: 180, cooldown_hours: 4, disabled_sites: [], recipient_ids: null };
  const sites = lineConfigCache?._edge_sites || [];
  const recipients = (lineConfigCache?.recipients || []).filter(r => r.enabled);
  const disabled = new Set(ea.disabled_sites || []);
  const rcpSel = ea.recipient_ids; // null = all enabled
  const minutes = Math.round((ea.threshold_sec ?? 180) / 60 * 10) / 10;

  const siteRows = sites.length ? sites.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">
      <input type="checkbox" class="edgeSiteChk" value="${escapeHtml(s.site_id)}" ${disabled.has(s.site_id) ? '' : 'checked'}>
      <span style="font-size:13px">${escapeHtml(s.name)} <span style="color:var(--text-secondary)">(${escapeHtml(s.site_id)})</span></span>
    </label>`).join('') : `<div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(I18N.t('ea.noSites'))}</div>`;

  const rcpRows = recipients.length ? recipients.map(r => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">
      <input type="checkbox" class="edgeRcpChk" value="${escapeHtml(r.id)}" ${(!rcpSel || rcpSel.includes(r.id)) ? 'checked' : ''}>
      <span style="font-size:13px">${escapeHtml(r.name || r.id)}</span>
    </label>`).join('') : `<div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(I18N.t('ea.noRecipients'))}</div>`;

  el.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
      <input type="checkbox" id="edgeAlertEnabled" ${ea.enabled !== false ? 'checked' : ''}>
      <span style="font-size:13px;font-weight:600">${escapeHtml(I18N.t('ea.enabled'))}</span>
    </label>
    ${/* สวิตช์ตัวเดียวคุมสองการแจ้งเตือน — ถ้าไม่บอกไว้ตรงนี้ คนที่ปิด "edge ขาดการ
         ติดต่อ" จะปิดการเตือน "ข้อมูลหาย" ไปด้วยโดยไม่รู้ตัว (เพิ่ม 2026-08-14
         พร้อมการเตือนข้อมูลหาย) */ ''}
    <div style="margin:0 0 16px 26px;padding:10px 12px;border-left:2px solid var(--border-hairline);
                font-size:11px;color:var(--text-secondary);line-height:1.7">
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px">${escapeHtml(I18N.t('ea.covers'))}</div>
      <div>· ${escapeHtml(I18N.t('ea.covers1'))}</div>
      ${/* สามบรรทัดสั้นดีกว่าประโยคเดียวยาว ๆ — กล่องนี้กว้างราว 340px บนมือถือ
           ที่ 11px ประโยคเดียวจะกลายเป็น 8 บรรทัดติดกันซึ่งไม่มีใครอ่าน */ ''}
      <div style="margin:4px 0 6px 12px">
        <div style="color:var(--text-primary)">${escapeHtml(I18N.t('ea.storyTitle'))}</div>
        <div>· ${escapeHtml(I18N.t('ea.story1'))}</div>
        <div>· ${escapeHtml(I18N.t('ea.story2'))}</div>
        <div>· ${escapeHtml(I18N.t('ea.story3'))}</div>
      </div>
      <div>· ${escapeHtml(I18N.t('ea.covers2'))}</div>
      <div style="margin-top:6px">${escapeHtml(I18N.t('ea.coversNote'))}</div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
      <div class="form-group" style="flex:1;min-width:160px;margin:0">
        <label class="form-label">${escapeHtml(I18N.t('ea.threshold'))}</label>
        <input type="number" class="form-input" id="edgeAlertThreshold" min="1" step="1" value="${minutes}">
      </div>
      <div class="form-group" style="flex:1;min-width:160px;margin:0">
        <label class="form-label">${escapeHtml(I18N.t('ea.cooldown'))}</label>
        <input type="number" class="form-input" id="edgeAlertCooldown" min="0.5" step="0.5" value="${ea.cooldown_hours ?? 4}">
      </div>
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">${escapeHtml(I18N.t('ea.sites'))}</div>
      <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px">${escapeHtml(I18N.t('ea.sitesHint'))}</div>
      ${siteRows}
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">${escapeHtml(I18N.t('ea.recipients'))}</div>
      <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px">${escapeHtml(I18N.t('ea.recipientsHint'))}</div>
      ${rcpRows}
    </div>`;
}

async function saveEdgeAlert() {
  try {
    const minutes = parseFloat(document.getElementById('edgeAlertThreshold').value);
    const hours = parseFloat(document.getElementById('edgeAlertCooldown').value);
    if (!Number.isFinite(minutes) || minutes < 1) { alert(I18N.t('ea.badThreshold')); return; }
    if (!Number.isFinite(hours) || hours <= 0) { alert(I18N.t('ea.badCooldown')); return; }
    const disabled_sites = [...document.querySelectorAll('.edgeSiteChk')].filter(c => !c.checked).map(c => c.value);
    const rcpChks = [...document.querySelectorAll('.edgeRcpChk')];
    const checkedIds = rcpChks.filter(c => c.checked).map(c => c.value);
    // all boxes checked → null (means "all enabled", auto-includes future recipients)
    const recipient_ids = (checkedIds.length === rcpChks.length) ? null : checkedIds;
    const edge_alert = {
      enabled: document.getElementById('edgeAlertEnabled').checked,
      threshold_sec: Math.max(60, Math.round(minutes * 60)),
      cooldown_hours: hours,
      disabled_sites,
      recipient_ids,
    };
    const res = await fetch(`${API}/api/line-config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_alert }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    alert(I18N.t('ar.configSaved'));
    loadEdgeAlert();
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


// ============================================================
// 🔒 ช่องทางแจ้งเตือนประจำระบบ — HCP Face · AuraFace · ป้ายทะเบียน
// ------------------------------------------------------------
// สามอย่างนี้เป็นส่วนหนึ่งของระบบที่ใช้ประจำ ไม่ใช่กฎที่ผู้ใช้สร้างเอง เดิมไปอยู่ปนใน
// Alert Rules ซึ่ง **ลบได้** — เจ้าของลบทดสอบแล้วหายจริง (2026-08-13)
// ⇒ ย้ายมาเป็นแท็บของตัวเองแบบ Edge Offline · ฟอร์มสร้างจาก JS เพราะสามแท็บ
// ใช้ฟิลด์ชุดเดียวกันเป๊ะ ต่างแค่ channel key
// ============================================================

let alertChannelsCache = [];

// คำอธิบายข้าง ๆ ช่องข้อความ — บอกสองอย่างที่ผู้ใช้ต้องรู้ก่อนพิมพ์:
//   1. ปล่อยว่างแล้วได้อะไร (รูปแบบอัตโนมัติตอนนี้หน้าตาเป็นยังไง)
//   2. พิมพ์แล้วจะเปลี่ยนอะไร (ตารางหายไป เหลือข้อความที่พิมพ์)
//
// เจ้าของขอ 2026-08-27 หลังพบว่าช่องนี้เคยแก้ได้แต่ไม่มีผล — คนกรอกจึงไม่มีทาง
// รู้เลยว่ากำลังจะได้อะไร นอกจากกดส่งจริงแล้วดู
function _achTplNote(ch, r) {
  const filled = !!(r.message_template && String(r.message_template).trim());
  const lprCard = _achIsLprCard(ch);
  const auto = lprCard
    ? ['ป้ายกลุ่ม + เลขทะเบียนตัวใหญ่', 'ภาพป้าย · ภาพจากกล้อง · ภาพอ้างอิง',
       'ตาราง: ข้อมูลจากกล้อง (ทะเบียน · ยานพาหนะ · จุดตรวจ · เวลา)',
       'ตาราง: ข้อมูลอ้างอิง (ชนิดป้าย · คดี · แจ้งเหตุที่ · ปรับปรุง)']
    : ['ป้ายกลุ่ม + ชื่อบุคคลตัวใหญ่', 'ภาพที่จับได้ · ภาพอ้างอิง · ภาพเต็มเฟรม',
       'ตาราง: ข้อมูลจากกล้อง (กล้อง · เวลา · ลักษณะ)', 'ตาราง: ข้อมูลอ้างอิง (รายชื่อ · คดี · บันทึก · ปรับปรุง)'];
  const li = auto.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  return `<div class="ach-locked" style="margin-top:6px">
    <div><b>${escapeHtml(I18N.t('ach.tplBlank', 'ปล่อยว่าง'))}</b> ${
      escapeHtml(I18N.t('ach.tplBlankNote', '= ระบบจัดการ์ดให้อัตโนมัติ:'))}</div>
    <ul style="margin:4px 0 6px 16px;padding:0">${li}</ul>
    <div><b>${escapeHtml(I18N.t('ach.tplFilled', 'พิมพ์ข้อความ'))}</b> ${
      escapeHtml(I18N.t('ach.tplFilledNote',
        '= ใช้ข้อความที่พิมพ์แทนตารางทั้งสองบล็อก · รูปและหัวการ์ดยังอยู่ครบ'))}</div>
    <div style="margin-top:6px;opacity:.85">${escapeHtml(I18N.t('ach.tplNowIs', 'ตอนนี้:'))} <b>${
      escapeHtml(filled ? I18N.t('ach.tplNowFilled', 'ใช้ข้อความที่พิมพ์ไว้')
                        : I18N.t('ach.tplNowBlank', 'ใช้รูปแบบอัตโนมัติ'))}</b></div>
    ${lprCard ? `<div style="margin-top:6px;opacity:.85">${I18N.t('ach.lprTextNote')}</div>` : ''}
  </div>`;
}

const _ACH_TAB_TO_CHANNEL = { hcpface: 'hcp_face', auraface: 'auraface', lpr: 'lpr', gsalarm: 'gs_alarm' };

// การ์ดของช่องทางไหนขึ้นเป็น "ป้ายทะเบียนเป็นพระเอก" (buildLprFlexAlert + ตัวแปร
// ref_* ชุดเดียวกับ LPR) — gs_alarm ส่ง lprMeta แบบเดียวกับ LPR เป๊ะ (gsAlarmLine.js)
// ต่างแค่ผู้รับเลือกแบบ checklist เหมือนช่องทางใบหน้า จึงแยกจาก isFace (ซึ่งคุมแค่
// UI ผู้รับ/min-likelihood) เป็นคนละแกนกัน
function _achIsLprCard(ch) { return ch === 'lpr' || ch === 'gs_alarm'; }

// แม่แบบตัวอย่างของแท็บป้ายทะเบียน — เรียงตามข้อความอัตโนมัติของระบบ
// (กลุ่ม → ป้าย → กล้อง·ไซต์ → เวลา → รถ → หมายเหตุ) ไว้ก๊อบไปแก้ต่อ
//
// 🔴 เป็น **placeholder เท่านั้น ห้ามเอาไปใส่เป็น value ของ textarea**
// เจ้าของเจอ 2026-08-26: ล้างช่องนี้แล้วบันทึก ค่าเด้งกลับมาทุกครั้ง
//   ล้าง → บันทึก → DB เป็น NULL ถูกแล้ว
//   → หน้าจอวาดใหม่ด้วย `?? ACH_LPR_DEFAULT_TPL` → ช่องมีข้อความอีก
//   → บันทึกครั้งถัดไปเขียนแม่แบบลง DB จริง ๆ ทั้งที่ไม่มีใครสั่ง
// เท่ากับสร้าง DB default ขึ้นมาใหม่ที่หน้าจอ ซึ่งคือสิ่งที่คอมเมนต์เดิมตั้งใจเลี่ยง
// placeholder ทำให้ "ช่องว่าง = ใช้ข้อความอัตโนมัติ" เป็นจริงตามที่เขียนไว้
// ⚠️ ค่า NULL ใน DB แปลว่า "ใช้ข้อความอัตโนมัติ" — ห้ามตั้ง default ที่คอลัมน์
// (เกือบเกิดจริงมาแล้ว — คอลัมน์ message_template มี DB default ของกฎทั่วไปติดมา)
// แยกสองบล็อกโดยตั้งใจ: "กล้องเห็นอะไร" กับ "ฐานข้อมูลบันทึกอะไรไว้" — สองอย่างนี้
// ไม่ตรงกันเป็นเรื่องที่เจ้าหน้าที่ต้องเห็น (พ่นสีใหม่ / สลับป้าย / อ่านป้ายผิด)
// บรรทัดในบล็อกอ้างอิงที่โรสเตอร์ไม่ได้กรอกจะถูกตัดทิ้งเองทั้งบรรทัด รวมถึงหัวข้อ
// (formatMessage ตัดบรรทัดที่ตัวแปรว่างหมด) จึงไม่มี '-' เรียงกันจนดูเหมือนพัง
const ACH_LPR_DEFAULT_TPL = [
  '🚗 {group}',
  '🔢 {plate} {region}',
  '',
  '━━ จากกล้อง ━━',
  '📍 {camera} · {site}',
  '⏰ {time}',
  '🚙 {vehicle}',
  '',
  '━━ ข้อมูลอ้างอิง · {ref_group} ━━',
  '🏍 {ref_vehicle}',
  '🪪 {ref_plate_type}',
  '📌 จดทะเบียน {ref_province}',
  '⚖️ {ref_case}',
  '📝 {ref_detail}',
  '🏢 {ref_unit}',
  '🕐 ต้นทางแก้ไขล่าสุด {ref_updated}',
].join('\n');

/** บรรทัดสถานะร่วม — ใช้ทั้ง 3 แท็บใหม่และแท็บ Edge Offline */
function achStatusLine(st, opts = {}) {
  if (!st) return `<span class="ach-s ach-off">${escapeHtml(I18N.t('ach.notConfigured'))}</span>`;
  const icon = (id) => `<svg aria-hidden="true" width="11" height="11"><use href="#icon-${id}"/></svg>`;
  const cd = st.cooldown_seconds >= 3600
    ? `${Math.round(st.cooldown_seconds / 360) / 10} ${I18N.t('ach.hr')}`
    : `${st.cooldown_seconds ?? 0}s`;
  const parts = [];
  if (opts.enabled !== undefined) {
    parts.push(`<span class="ach-s ${opts.enabled ? 'ach-on' : 'ach-off'}"><b>${
      escapeHtml(I18N.t(opts.enabled ? 'ach.on' : 'ach.off'))}</b></span>`);
  }
  parts.push(`<span class="ach-s">${I18N.t('ach.cooldown')}: <b>${cd}</b></span>`);
  if (!opts.noSnapshot) {
    parts.push(`<span class="ach-s">${icon('snapshot')} ${I18N.t('ach.snapshot')}: <b>${st.send_snapshot ? '✓' : '✕'}</b></span>`);
  }
  // LPR คัดผู้รับจาก lpr_sites/lpr_groups ไม่ใช่ recipient_ids — โชว์เลขจากช่องที่ไม่ได้ใช้
  // จะขัดกับคำอธิบายที่อยู่ใต้บรรทัดนี้เอง (เห็นจริงตอน reproduce 2026-08-13)
  if (!opts.noRecipientCount) {
    parts.push(`<span class="ach-s">${icon('user')} <b>${st.recipient_count ?? 0}</b></span>`);
    parts.push(`<span class="ach-s">${icon('bell')} <b>${st.push_count ?? 0}</b></span>`);
  }
  // 24 ชม.ล่าสุด บอกได้ว่า "ยังทำงานอยู่จริง" ไม่ใช่แค่ "เปิดสวิตช์ไว้"
  // "ข้าม" ไม่ใช่ "ล้มเหลว" — LPR ข้ามตาม cooldown เป็นพันครั้งต่อวันตามปกติ
  parts.push(`<span class="ach-s">${I18N.t('ach.sent24h')}: <b>${st.sent_24h ?? 0}</b>${
    st.failed_24h ? ` <span class="ach-off">(${I18N.t('ach.failed')} ${st.failed_24h})</span>` : ''}${
    st.skipped_24h ? ` <span style="opacity:.75">(${I18N.t('ach.skipped')} ${st.skipped_24h.toLocaleString()})</span>` : ''}</span>`);
  // โชว์เฉพาะตอนที่ทางสำรองเคยทำงานจริง — ปกติ 0 ไม่ต้องรกตา
  if (st.imgbb_24h || st.noimg_24h) {
    parts.push(`<span class="ach-s" style="color:var(--warn)">${I18N.t('ach.imgFallback')}: <b>${
      st.imgbb_24h || 0}</b>${st.noimg_24h ? ` · ${I18N.t('ach.imgNone')} <b>${st.noimg_24h}</b>` : ''}</span>`);
  }
  parts.push(`<span class="ach-s">${icon('history')} ${I18N.t('ach.last')}: <b>${
    st.last_sent_at ? escapeHtml(new Date(st.last_sent_at).toLocaleString('th-TH', { hour12: false })) : '—'}</b></span>`);
  return parts.join('');
}

/** เปิด/ปิดรับแจ้งเตือนป้ายทะเบียนของคนคนเดียว — ไม่กระทบการแจ้งเตือนชนิดอื่นของเขา */
function achLprRcpToggle(el) {
  const r = lineConfigCache?.recipients?.[+el.dataset.idx];
  if (!r) return;
  r.lpr_enabled = el.checked;
  const box = document.getElementById('achLprRcp');
  if (box) box.innerHTML = _achLprRcpRows();   // ซ่อน/โชว์ chip ตามสถานะทันที
}

// ── ตารางอธิบายตัวแปร (ข้างขวาของฟอร์ม) ─────────────────────────────────
// เดิมยัดเป็นย่อหน้าเดียวใต้กล่องข้อความ พอมีตัวแปร 20 กว่าตัวก็กองกันจนอ่านไม่ออก
// (เจ้าของชี้ 2026-08-13) · คำอธิบายอยู่ใน i18n คีย์ vh.v.<ชื่อตัวแปร>
const _ACH_VARS = {
  lpr: [
    ['vh.grpCamera', ['plate', 'region', 'group', 'site', 'vehicle', 'camera', 'location', 'time', 'note']],
    ['vh.grpRef', ['ref_plate', 'ref_province', 'ref_group', 'ref_type', 'ref_color',
                   'ref_plate_type', 'ref_brand', 'ref_vehicle', 'ref_case', 'ref_detail',
                   'ref_unit', 'ref_updated']],
  ],
  face: [
    ['vh.grpGeneral', ['camera', 'location', 'camera_id', 'rule', 'time',
                       'object_class', 'likelihood', 'event_type', 'duration']],
    ['vh.grpFace', ['person_name', 'watchlist', 'similarity', 'match_confidence']],
  ],
};

function renderAlertVars(ch) {
  const el = document.getElementById(`achVars-${ch}`);
  if (!el) return;
  const groups = _ACH_VARS[_achIsLprCard(ch) ? 'lpr' : 'face'];
  const rows = groups.map(([title, vars]) => `
    <tr class="ach-vgrp"><th colspan="2">${escapeHtml(I18N.t(title))}</th></tr>
    ${vars.map(v => `<tr>
      <td><code>{${v}}</code></td>
      <td>${escapeHtml(I18N.t('vh.v.' + v))}</td>
    </tr>`).join('')}`).join('');
  el.innerHTML = `
    <h4>${escapeHtml(I18N.t('vh.title'))}</h4>
    <div class="ach-vsub">${escapeHtml(I18N.t('vh.sub'))}</div>
    <table>${rows}</table>
    <div class="ach-vnote">${I18N.t('vh.note')}</div>`;
}

/** แถวผู้รับของแท็บป้ายทะเบียน — ชื่อ + chip ไซต์/กลุ่มของคนนั้น */
function _achLprRcpRows() {
  const all = lineConfigCache?.recipients || [];
  const rows = all.map((rcp, i) => {
    if (rcp.enabled === false) return '';
    // ไม่ได้ตั้ง = รับ — ผู้รับที่มีอยู่ก่อนฟีเจอร์นี้ต้องไม่เงียบไปเอง
    const on = rcp.lpr_enabled !== false;
    return `
    <div style="padding:6px 0;border-bottom:1px solid var(--border-hairline)">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
        <input type="checkbox" data-change="achLprRcpToggle" data-idx="${i}" ${on ? 'checked' : ''}>
        <span style="font-size:11px;font-weight:600"><span class="chip" style="font-size:9px;margin-right:4px">${rcp.type === 'group' ? 'GRP' : rcp.type === 'room' ? 'ROOM' : 'USER'}</span>${escapeHtml(rcp.name || rcp.id)}</span>
        ${on ? '' : `<span style="font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t('ach.lprOptedOut'))}</span>`}
      </label>
      ${on ? _lprScopeRow(rcp, i) : ''}
    </div>`;
  }).join('');
  return rows.trim() ? rows
    : `<div style="font-size:11px;color:var(--text-secondary)">${escapeHtml(I18N.t('ea.noRecipients'))}</div>`;
}

async function loadAlertChannels(tab) {
  try {
    // ผู้รับมาจาก line_config เดียวกับ Rules — โหลดถ้ายังไม่มีในหน่วยความจำ
    if (!lineConfigCache) {
      const r = await fetch(`${API}/api/line-config`);
      if (r.ok) lineConfigCache = await r.json();
    }
    if (tab === 'lpr' && !_rcpSites.length && !_rcpGroups.length) await loadRcpScopeOptions();
    // ช่องทางส่ง (deliver_via) ของทั้ง 4 แท็บช่องทางประจำระบบ ต้องรู้ว่า Telegram
    // พร้อมไหม + รายชื่อแชทที่อนุมัติแล้ว (T2b: HCP Face/AuraFace เข้าร่วมด้วยแล้ว
    // เหมือน GuruSquare — LPR เท่านั้นที่เลือกแชทจากไซต์/กลุ่มแทนรายชื่อ) โหลดครั้งเดียวพอ
    if ((tab === 'lpr' || tab === 'gsalarm' || tab === 'hcpface' || tab === 'auraface') && !tgConfigCache) {
      const rt = await fetch(`${API}/api/telegram-config`);
      if (rt.ok) tgConfigCache = await rt.json();
    }
    const res = await fetch(`${API}/api/alert-channels`);
    alertChannelsCache = await res.json();
    if (tab) renderAlertChannel(_ACH_TAB_TO_CHANNEL[tab]);
  } catch (e) { console.error('loadAlertChannels:', e); }
}

// ── ช่องทางส่ง (T2) — ทั้ง 4 แท็บช่องทางประจำระบบ (LPR/GuruSquare/HCP Face/AuraFace)
// LINE ยังเป็นค่าเริ่มต้นเสมอ — เลือก Telegram/ทั้งสองได้ต่อเมื่อ Telegram
// เปิด+เชื่อมต่อบอทแล้วเท่านั้น (เช็คจาก tgConfigCache ที่โหลดคู่กับแท็บนี้)
function _achTgChatChecklist(r) {
  const chats = tgConfigCache?.chats || [];
  if (!chats.length) {
    return `<div class="ach-locked" style="margin-top:6px">${escapeHtml(I18N.t('ach.tgNoApprovedChats'))}</div>`;
  }
  const sel = new Set((r.telegram_chat_ids || []).map(String));
  return `<div style="margin-top:8px;background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:5px;padding:8px;max-height:140px;overflow-y:auto">
    ${chats.map((c) => `
      <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
        <input type="checkbox" class="achTgChat" value="${escapeHtml(c.chat_id)}" ${sel.has(String(c.chat_id)) ? 'checked' : ''}>
        <span><span class="chip" style="font-size:9px;margin-right:4px">${c.type === 'private' ? 'DM' : 'GRP'}</span>${escapeHtml(c.name || c.chat_id)}</span>
      </label>`).join('')}
  </div>`;
}

function _achDeliverViaBlock(ch, r) {
  const tgReady = !!(tgConfigCache?.enabled && tgConfigCache?.has_token);
  const dv = r.deliver_via || 'line';
  // T3: 'line_then_telegram' ไม่ต้องพึ่งบอทพร้อม (LINE ยังเป็นหลักเสมอ) — เลือกได้เสมอ
  // แต่ถ้ายังไม่มีแชทไหนผูก mirror_of_line_id ไว้เลย ก็ไม่มีที่ให้สำรอง ต้องบอกไว้
  const hasMirror = (tgConfigCache?.chats || []).some((c) => c && c.mirror_of_line_id);
  return `
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">${escapeHtml(I18N.t('ach.deliverVia'))}</label>
      <select class="form-input" id="achDeliverVia-${ch}">
        <option value="line" ${dv !== 'telegram' && dv !== 'both' && dv !== 'line_then_telegram' ? 'selected' : ''}>${escapeHtml(I18N.t('ach.deliverViaLine'))}</option>
        <option value="telegram" ${tgReady ? '' : 'disabled'} ${dv === 'telegram' ? 'selected' : ''}>${escapeHtml(I18N.t('ach.deliverViaTelegram'))}</option>
        <option value="both" ${tgReady ? '' : 'disabled'} ${dv === 'both' ? 'selected' : ''}>${escapeHtml(I18N.t('ach.deliverViaBoth'))}</option>
        <option value="line_then_telegram" ${dv === 'line_then_telegram' ? 'selected' : ''}>${escapeHtml(I18N.t('ach.deliverViaLineThenTg'))}</option>
      </select>
      ${tgReady ? '' : `<div class="ach-locked" style="margin-top:4px">${escapeHtml(I18N.t('ach.deliverViaTgOff'))}</div>`}
      ${dv === 'line_then_telegram'
        ? (hasMirror ? '' : `<div class="ach-locked" style="margin-top:6px">${escapeHtml(I18N.t('ach.deliverViaNoMirror'))}</div>`)
        : (ch === 'lpr'
            ? `<div class="ach-locked" style="margin-top:6px">${escapeHtml(I18N.t('ach.tgLprScopeNote'))}</div>`
            : _achTgChatChecklist(r))}
    </div>`;
}

function renderAlertChannel(ch) {
  const el = document.getElementById(`achBody-${ch}`);
  if (!el) return;
  const row = alertChannelsCache.find(c => c.channel === ch);
  const r = row?.rule || {};
  const st = row?.status;
  const recipients = (lineConfigCache?.recipients || []);
  const isFace = ch !== 'lpr';
  // ความน่าจะเป็น/ชนิดรายการ (blackList/whiteList) มีความหมายเฉพาะช่องทางจดจำใบหน้า
  // เท่านั้น — gs_alarm เป็น isFace (เลือกผู้รับแบบ checklist) แต่ไม่มีแนวคิดนี้เลย
  const hasLikelihood = ch === 'hcp_face' || ch === 'auraface';
  const sel = r.recipient_ids || [];
  const selTypes = r.list_types || [];

  // LPR ไม่ได้เลือกผู้รับด้วย checkbox — แต่ละคนกำหนดเองว่ารับไซต์ไหน/กลุ่มไหน
  // (chip ชุดนี้เดิมอยู่แท็บ LINE Config ซึ่งอยู่คนละที่กับค่าตั้ง LPR อื่น ๆ จนสับสน
  //  เจ้าของสั่งย้ายมารวมที่เดียว 2026-08-13)
  const rcpRows = !recipients.length
    ? `<div style="font-size:11px;color:var(--text-secondary)">${escapeHtml(I18N.t('ea.noRecipients'))}</div>`
    : isFace
      ? recipients.map(rcp => `
        <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
          <input type="checkbox" class="achRcp" value="${escapeHtml(rcp.id)}" ${sel.includes(rcp.id) ? 'checked' : ''}>
          <span><span class="chip" style="font-size:9px;margin-right:4px">${rcp.type === 'group' ? 'GRP' : rcp.type === 'room' ? 'ROOM' : 'USER'}</span>${escapeHtml(rcp.name || rcp.id)}</span>
        </label>`).join('')
      : _achLprRcpRows();

  el.innerHTML = `
    <div class="ach-status">${achStatusLine(st, { enabled: r.enabled, noRecipientCount: !isFace })}</div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px">
      <input type="checkbox" id="achEnabled-${ch}" ${r.enabled ? 'checked' : ''}>
      <span style="font-size:13px;font-weight:600">${escapeHtml(I18N.t('ach.enable'))}</span>
    </label>
    ${_achDeliverViaBlock(ch, r)}
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Message Template</label>
      <textarea class="form-input" id="achTemplate-${ch}" placeholder="${
        escapeHtml(_achIsLprCard(ch) ? ACH_LPR_DEFAULT_TPL : I18N.t('ach.tplAuto'))
      }" style="min-height:260px;font-family:monospace;font-size:12px">${
        escapeHtml(r.message_template ?? '')}</textarea>
      <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${escapeHtml(I18N.t('vh.seeTable'))}</div>
      ${_achTplNote(ch, r)}
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px">
      <div class="form-group" style="flex:1;min-width:150px;margin:0">
        <label class="form-label">${escapeHtml(I18N.t('ar.fldCooldown'))}</label>
        <input type="number" class="form-input" id="achCooldown-${ch}" min="0" step="1" value="${r.cooldown_seconds ?? 60}">
      </div>
      ${hasLikelihood ? `<div class="form-group" style="flex:1;min-width:150px;margin:0">
        <label class="form-label">${escapeHtml(I18N.t('ar.fldMinLikelihood'))}</label>
        <input type="number" class="form-input" id="achMinLikelihood-${ch}" min="0" max="100"
               placeholder="${escapeHtml(I18N.t('ar.fldMinLikelihoodHint'))}" value="${r.min_likelihood ?? ''}">
      </div>` : ''}
    </div>
    ${hasLikelihood ? `<div class="form-group" style="margin-bottom:14px">
      <label class="form-label">${escapeHtml(I18N.t('ar.fldListTypes'))}</label>
      <div style="background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:5px;padding:8px">
        ${['blackList', 'whiteList'].map(v => `
          <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">
            <input type="checkbox" class="achListType-${ch}" value="${v}" ${selTypes.includes(v) ? 'checked' : ''}>
            <span>${escapeHtml(I18N.t('fmatch.' + v))}</span>
          </label>`).join('')}
      </div>
    </div>` : ''}
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label">${escapeHtml(I18N.t('ar.fldSendTo'))}</label>
      <div id="${isFace ? '' : 'achLprRcp'}" style="background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:5px;padding:8px;max-height:${isFace ? '140' : '260'}px;overflow-y:auto">${rcpRows}</div>
      ${isFace ? '' : `<div class="ach-locked" style="margin-top:6px">${escapeHtml(I18N.t('ach.lprRecipientNote'))}</div>`}
    </div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;font-size:12px">
      <input type="checkbox" id="achSnapshot-${ch}" ${r.send_snapshot !== false ? 'checked' : ''}>
      <span>${escapeHtml(I18N.t('ar.snapshotLabel'))}</span>
    </label>
    <div class="ar-layout">
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">${escapeHtml(I18N.t('ar.fldTitleTpl'))}</label>
        <input type="text" class="form-input" id="achTitleTpl-${ch}" maxlength="200"
               placeholder="${escapeHtml(I18N.t(_achIsLprCard(ch) ? 'ar.titleTplPhLpr' : 'ar.titleTplPh'))}" value="${escapeHtml(r.title_template || '')}">
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">${escapeHtml(I18N.t('ar.fldSubtitleTpl'))}</label>
        <input type="text" class="form-input" id="achSubtitleTpl-${ch}" maxlength="200"
               placeholder="${escapeHtml(I18N.t(_achIsLprCard(ch) ? 'ar.subtitleTplPhLpr' : 'ar.subtitleTplPh'))}" value="${escapeHtml(r.subtitle_template || '')}">
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">${escapeHtml(I18N.t('ar.fldTextPos'))}</label>
        <select class="form-input" id="achTextPosition-${ch}">
          <option value="below" ${r.text_position !== 'above' ? 'selected' : ''}>${escapeHtml(I18N.t('ar.textPosBelow'))}</option>
          <option value="above" ${r.text_position === 'above' ? 'selected' : ''}>${escapeHtml(I18N.t('ar.textPosAbove'))}</option>
        </select>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
        <input type="checkbox" id="achShowOpenLink-${ch}" ${r.show_open_link !== false ? 'checked' : ''}>
        <span>${escapeHtml(I18N.t('ar.showOpenLink'))}</span>
      </label>
    </div>
    <div class="ach-actions">
      <button class="btn btn-primary" data-action="achSave" data-ch="${ch}"><svg aria-hidden="true" width="13" height="13" style="vertical-align:-2px;margin-right:5px"><use href="#icon-save"/></svg>${escapeHtml(I18N.t('ar.saveConfig'))}</button>
      <button class="btn btn-secondary" data-action="achTest" data-ch="${ch}"><svg aria-hidden="true" width="13" height="13" style="vertical-align:-2px;margin-right:5px"><use href="#icon-send"/></svg>${escapeHtml(I18N.t('ach.test'))}</button>
    </div>
    <div class="ach-locked">${escapeHtml(I18N.t('ach.lockedNote'))}</div>`;
  renderAlertVars(ch);
}

async function saveAlertChannel(ch) {
  try {
    const v = (id) => document.getElementById(`ach${id}-${ch}`);
    const cooldown = parseInt(v('Cooldown').value, 10);
    if (!Number.isFinite(cooldown) || cooldown < 0) { alert(I18N.t('ea.badCooldown')); return; }
    const minEl = v('MinLikelihood');
    const body = {
      enabled: v('Enabled').checked,
      cooldown_seconds: cooldown,
      send_snapshot: v('Snapshot').checked,
      title_template: v('TitleTpl').value.trim(),
      subtitle_template: v('SubtitleTpl').value.trim(),
      text_position: v('TextPosition').value,
      show_open_link: v('ShowOpenLink').checked,
    };
    // T2: ช่องทางส่ง — เฉพาะแท็บป้ายทะเบียน/GuruSquare ที่มีช่องนี้ในฟอร์ม
    const dvEl = document.getElementById(`achDeliverVia-${ch}`);
    if (dvEl) body.deliver_via = dvEl.value;
    if (document.querySelector(`#achBody-${ch} .achTgChat`)) {
      body.telegram_chat_ids = [...document.querySelectorAll(`#achBody-${ch} .achTgChat:checked`)].map(c => c.value);
    }
    // ป้ายทะเบียนไม่มีสองช่องนี้ในฟอร์ม (ผู้รับเลือกจาก lpr_sites/lpr_groups ของ
    // แต่ละคน · ข้อความประกอบจากโครงสร้าง) — อย่าส่งค่าว่างไปทับของเดิม
    body.message_template = v('Template').value;
    // ผู้รับของ LPR มาจาก lpr_sites/lpr_groups รายคน ไม่มี checklist ในฟอร์มนี้ —
    // ส่ง [] ขึ้นไปจะทับค่าเดิมของช่องทางอื่นทิ้ง
    if (document.querySelector(`#achBody-${ch} .achRcp`)) {
      body.recipient_ids = [...document.querySelectorAll(`#achBody-${ch} .achRcp:checked`)].map(c => c.value);
    }
    if (minEl) {
      body.min_likelihood = minEl.value === '' ? null : parseInt(minEl.value, 10);
      body.list_types = [...document.querySelectorAll(`.achListType-${ch}:checked`)].map(c => c.value);
    }
    const res = await fetch(`${API}/api/alert-channels/${ch}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    // ⚠️ ส่งเฉพาะ recipients — ห้ามเรียก saveLineConfig() จากที่นี่ เพราะมันอ่าน
    // cfgEnabled/token จาก DOM ของแท็บ LINE Config ซึ่งอาจยังไม่เคยถูก render
    // แล้วจะ "ปิดระบบแจ้งเตือนทั้งระบบ" โดยไม่มีใครสั่ง
    if (document.getElementById('achLprRcp')) {
      const rr = await fetch(`${API}/api/line-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: lineConfigCache?.recipients || [] }),
      });
      if (!rr.ok) throw new Error((await rr.json()).error || 'save recipients failed');
      lineConfigCache = await (await fetch(`${API}/api/line-config`)).json();
    }
    alert(I18N.t('ar.configSaved'));
    await loadAlertChannels();
    renderAlertChannel(ch);
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

/** ใครจะได้รับข้อความทดสอบของช่องทางนี้ — คิดแบบเดียวกับตัวส่งจริง */
function _achTestAudience(ch) {
  const all = lineConfigCache?.recipients || [];
  if (ch === 'lpr') {
    // LPR ไม่ได้ใช้ recipient_ids — คัดจากสวิตช์รายคน แล้วกรองต่อด้วยไซต์/กลุ่ม
    // ของเหตุการณ์นั้นตอนส่งจริง จึงเป็น "ไม่เกินรายชื่อนี้"
    return all.filter(r => r.enabled !== false && r.lpr_enabled !== false).map(r => r.name || r.id);
  }
  const sel = alertChannelsCache.find(c => c.channel === ch)?.rule?.recipient_ids || [];
  return all.filter(r => sel.includes(r.id)).map(r => r.name || r.id);
}

async function testAlertChannel(ch) {
  // ส่งซ้ำ "การแจ้งเตือนจริงล่าสุด" ของช่องทางนี้ พร้อมคำนำหน้าบอกว่าเป็นการทดสอบ —
  // เดินผ่านเส้นทางเดียวกับของจริงทั้งหมด ข้อความปลอมจะผ่านแค่ครึ่งทางแล้วบอกว่าผ่าน
  //
  // บอกชื่อผู้รับจริงในกล่องยืนยัน — ข้อความเดิมเขียนว่า "ไปยังผู้รับทุกคน" ซึ่งอ่านแล้ว
  // น่ากลัวและไม่ตรง (ตัวส่งเคารพรายชื่อที่เลือกไว้อยู่แล้ว) เจ้าของทักมา 2026-08-13
  //
  // เลือกผู้รับเฉพาะครั้งนี้ได้ (2026-08-27) — เดิมเป็น confirm() ที่บอกรายชื่อได้
  // อย่างเดียว ทุกครั้งที่อยากดูหน้าตาการ์ดจึงต้องยิงหาทีมจริงทั้งกลุ่ม
  const who = _achTestAudience(ch);
  if (!who.length) { alert(I18N.t('ach.testNoAudience')); return; }

  const all = lineConfigCache?.recipients || [];
  const defIds = ch === 'lpr'
    ? all.filter(r => r.enabled !== false && r.lpr_enabled !== false).map(r => r.id)
    : (alertChannelsCache.find(c => c.channel === ch)?.rule?.recipient_ids || []);

  const pick = await RecipientPicker.open({
    title: I18N.t('ach.testTitle', 'ทดสอบส่ง') + ' · '
      + (alertChannelsCache.find(c => c.channel === ch)?.rule?.name || ch),
    subtitle: I18N.t(ch === 'lpr' ? 'ach.testConfirmLpr' : 'ach.testConfirm')
      .replace('{who}', who.join(', ')),
    recipients: all,
    defaultIds: defIds,
    // LPR ต่างจากช่องทางอื่น: รายชื่อนี้เป็นเพดาน ตอนส่งจริงยังถูกกรองด้วยไซต์/กลุ่ม
    // ของเหตุการณ์อีกชั้น จึงเขียนว่า "ไม่เกิน" ไม่ใช่จำนวนที่จะได้รับแน่ ๆ
    defaultLabel: ch === 'lpr'
      ? I18N.t('ach.testDefaultLpr', 'ตามการตั้งค่าจริง (ไม่เกิน {n} คน)')
          .replace('{n}', String(defIds.length))
      : null,
  });
  if (pick === null) return;   // ยกเลิก

  try {
    const res = await fetch(`${API}/api/alert-channels/${ch}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pick.length ? { recipient_ids: pick } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'test failed');
    alert(I18N.t('ach.testSent') + (data.event_id ? ` (event #${data.event_id})` : ''));
    await loadAlertChannels();
    renderAlertChannel(ch);
  } catch (e) { alert(I18N.t('ach.testFailed') + e.message); }
}

// ============================================================
// 📨 Telegram Config (T1 — ท่อส่ง + หน้าตั้งค่า, ยังไม่ส่งแจ้งเตือนจริง)
// ------------------------------------------------------------
// คู่กับ LINE Config ข้างบน แต่คนละตาราง/คนละ endpoint (chat_id เป็นตัวเลข
// ไม่ใช่ text แบบ LINE) — GET ไม่เคยคืน token จริง มีแค่ has_token:boolean
// ============================================================

let tgConfigCache = null;
let tgPendingCache = [];
let _tgPendingPollTimer = null;

function _startTgPendingPoll() {
  _stopTgPendingPoll();
  _tgPendingPollTimer = setInterval(() => {
    const sec = document.getElementById('alertSection-telegram');
    if (sec && sec.style.display !== 'none') loadTgPending();
    else _stopTgPendingPoll();
  }, 30000);
}

function _stopTgPendingPoll() {
  if (_tgPendingPollTimer) { clearInterval(_tgPendingPollTimer); _tgPendingPollTimer = null; }
}

async function loadTgConfig() {
  try {
    // T3: ตัวเลือก "สำรองให้กลุ่ม LINE" ต้องมีรายชื่อผู้รับ LINE — โหลดถ้ายังไม่มี
    // (คนที่เปิดแท็บ Telegram Config ตรง ๆ โดยไม่ผ่านแท็บ LINE Config ก่อน)
    if (!lineConfigCache) {
      try {
        const rl = await fetch(`${API}/api/line-config`);
        if (rl.ok) lineConfigCache = await rl.json();
      } catch { lineConfigCache = { recipients: [] }; }
    }
    const res = await fetch(`${API}/api/telegram-config`);
    tgConfigCache = await res.json();
    document.getElementById('cfgTgToken').placeholder = tgConfigCache.has_token ? I18N.t('tg.tokenSetPh') : '';
    document.getElementById('cfgTgToken').value = '';
    document.getElementById('cfgTgEnabled').checked = !!tgConfigCache.enabled;
    renderTgConnStatus();
    // ไซต์/กลุ่ม LPR ใช้ชุดเดียวกับ Recipients ของ LINE (_rcpSites/_rcpGroups) —
    // โหลดครั้งเดียวก่อน render ไม่ใช่ให้ render เรียกโหลดเองซ้ำ (กันวนไม่รู้จบ
    // ถ้าดึงไม่สำเร็จหรือทั้งสองไซต์/กลุ่มว่างจริง ๆ)
    if (!_rcpSites.length && !_rcpGroups.length) await loadRcpScopeOptions();
    renderTgChats();
    renderTgOnboardQr();
    populateTgTestSelect();
    loadTgPending();
  } catch (e) { console.error('loadTgConfig:', e); }
}

// สถานะเทียบเคียง LINE Config: Connected/ไม่ได้เชื่อมต่อ + สถานะ poller (Telegram
// ไม่มีโควตารายเดือนแบบ LINE จึงไม่มีแถบโควตา) + ความล้มเหลวล่าสุด (เทียบเคียง
// "LINE ปฏิเสธการส่งถึง … 13:26" ของ _quotaLimitHitLine — migration 245)
function renderTgConnStatus() {
  const el = document.getElementById('tgConnStatus');
  if (!el) return;
  const cfg = tgConfigCache || {};
  const p = cfg.poller || {};
  const lines = [];
  if (cfg.bot_username) {
    lines.push(`<div><span style="color:var(--status-ok)">●</span>&ensp;${I18N.t('tg.connectedAs').replace('{username}', escapeHtml(cfg.bot_username))}${cfg.bot_name ? ` <span style="color:var(--text-secondary)">(${escapeHtml(cfg.bot_name)})</span>` : ''}</div>`);
    if (p.conflict) {
      lines.push(`<div style="color:var(--status-bad);font-size:10px;margin-top:4px">${escapeHtml(I18N.t('tg.pollerConflict'))}</div>`);
    } else if (!p.running) {
      lines.push(`<div style="color:var(--warn);font-size:10px;margin-top:4px">${escapeHtml(I18N.t('tg.pollerStopped'))}</div>`);
    } else if (p.last_error) {
      lines.push(`<div style="color:var(--status-bad);font-size:10px;margin-top:4px">${escapeHtml(I18N.t('tg.pollerError').replace('{err}', p.last_error))}</div>`);
    } else if (p.last_ok_at) {
      const t = new Date(p.last_ok_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
      lines.push(`<div style="color:var(--text-secondary);font-size:10px;margin-top:4px">${escapeHtml(I18N.t('tg.pollerOkAt').replace('{time}', t))}</div>`);
    }
  } else {
    lines.push(`<div><span style="color:var(--status-bad)">●</span>&ensp;${escapeHtml(I18N.t('tg.notConnected'))}</div>`);
  }
  if (cfg.last_failure) {
    const t = new Date(cfg.last_failure.at);
    const [hh, mm] = t.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false }).split(':');
    const who = escapeHtml(cfg.last_failure.name || I18N.t('qa.someone'));
    lines.push(`<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-hairline);color:var(--status-bad);font-size:10px">
      ${I18N.t('tg.lastFailureLine').replace('{name}', `<strong>${who}</strong>`).replace('{time}', `${hh}:${mm}`)}
    </div>`);
  }
  el.innerHTML = lines.join('');
}

// วิธีเพิ่มบอท — QR + ลิงก์ t.me (เทียบเคียง renderOnboardQr() ของ LINE Config)
function renderTgOnboardQr() {
  const wrap = document.getElementById('tgOnboardQrWrap');
  if (!wrap) return;
  const step1 = document.getElementById('tgOnboardStep1');
  const username = tgConfigCache?.bot_username;
  if (!username) {
    wrap.innerHTML = `<div style="padding:10px;font-size:11px;color:var(--text-secondary);border:1px dashed var(--border-hairline);border-radius:6px">${escapeHtml(I18N.t('tg.onboardNoBot'))}</div>`;
    if (step1) step1.textContent = I18N.t('tg.onboardStep1');
    return;
  }
  const botUrl = `https://t.me/${encodeURIComponent(username)}`;
  const label = tgConfigCache.bot_name ? `${tgConfigCache.bot_name} (@${username})` : `@${username}`;
  if (step1) step1.innerHTML = I18N.t('tg.onboardStep1Named').replace('{name}', `<strong>${escapeHtml(label)}</strong>`);
  wrap.innerHTML = `
    <img src="${API}/api/telegram-config/qr" alt="QR" style="width:160px;height:160px;border-radius:8px;border:1px solid var(--border-hairline)" data-err="hide">
    <div style="margin-top:8px;font-size:10px;color:var(--text-secondary)">
      <a href="${escapeHtml(botUrl)}" target="_blank" style="color:var(--accent)">${escapeHtml(botUrl)}</a>
    </div>`;
}

function populateTgTestSelect() {
  const el = document.getElementById('tgTestChatSelect');
  if (!el) return;
  const chats = tgConfigCache?.chats || [];
  el.innerHTML = chats.length
    ? chats.map(c => `<option value="${escapeHtml(c.chat_id)}">${escapeHtml(c.name || c.chat_id)}</option>`).join('')
    : `<option value="">${escapeHtml(I18N.t('tg.noApproved'))}</option>`;
}

async function tgTestSend() {
  const chatId = document.getElementById('tgTestChatSelect').value;
  if (!chatId) { alert(I18N.t('tg.noApproved')); return; }
  try {
    const res = await fetch(`${API}/api/telegram-config/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await res.json();
    alert(data.success ? I18N.t('tg.testOk') : I18N.t('ar.testFail') + (data.error || ''));
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

// แถวขอบเขต LPR ของหนึ่งแชท — ใช้ chip ชุดเดียวกับ Recipients ของ LINE
// (_rcpSites/_rcpGroups โหลดไว้แล้วจากแท็บ LINE Config หรือ LPR — ถ้ายังไม่เคย
// โหลดเลย โหลดครั้งแรกตอนเปิดแท็บนี้ก็ได้)
function _tgScopeRow(c, i) {
  const sites  = Array.isArray(c.lpr_sites)  ? c.lpr_sites  : [];
  const groups = Array.isArray(c.lpr_groups) ? c.lpr_groups : [];
  if (!_rcpSites.length && !_rcpGroups.length) return '';
  const chip = (on, label, field, val) =>
    `<button class="rcp-chip${on ? ' on' : ''}" data-action="tgScopeToggle"
       data-idx="${i}" data-field="${field}" data-val="${escapeHtml(val)}">${escapeHtml(label)}</button>`;
  const anySite  = sites.length  === 0;
  const anyGroup = groups.length === 0;
  return `<div class="rcp-scope">
    <span class="rcp-scope-lbl">${escapeHtml(I18N.t('ar.lprSites', 'ไซต์ LPR:'))}</span>
    ${chip(anySite, I18N.t('common.all', 'ทั้งหมด'), 'lpr_sites', '')}
    ${_rcpSites.map(s => chip(sites.includes(s.code), s.name || s.code, 'lpr_sites', s.code)).join('')}
    <span class="rcp-scope-lbl">${escapeHtml(I18N.t('ar.lprGroups', 'กลุ่มเฝ้าระวัง:'))}</span>
    ${chip(anyGroup, I18N.t('common.all', 'ทั้งหมด'), 'lpr_groups', '')}
    ${_rcpGroups.map(g => chip(groups.includes(g.id), g.name || g.id, 'lpr_groups', g.id)).join('')}
    <span class="rcp-scope-lbl" style="flex:0 0 auto;margin-left:8px;opacity:.75">${escapeHtml(I18N.t('ar.scopeHint', 'ไม่เลือก = รับทั้งหมด · ต้องกดบันทึก'))}</span>
  </div>`;
}

function tgScopeToggle(el) {
  const idx = +el.dataset.idx, field = el.dataset.field, val = el.dataset.val;
  const c = tgConfigCache?.chats?.[idx];
  if (!c) return;
  if (!val) { c[field] = []; renderTgChats(); return; }
  const cur = Array.isArray(c[field]) ? [...c[field]] : [];
  const at = cur.indexOf(val);
  if (at >= 0) cur.splice(at, 1); else cur.push(val);
  c[field] = cur;
  renderTgChats();
}

function tgChatFieldToggle(el) {
  const idx = +el.dataset.idx, field = el.dataset.field;
  const c = tgConfigCache?.chats?.[idx];
  if (!c) return;
  // checkbox → boolean · select (เช่น mirror_of_line_id) → ค่า หรือ null เมื่อว่าง
  c[field] = el.type === 'checkbox' ? el.checked : (el.value || null);
  renderTgChats();
}

// T3: เลือกว่าแชทนี้เป็นแชทสำรองของผู้รับ LINE คนไหน (mirror_of_line_id) — "ไม่ผูก"
// = null ไม่ใช่สตริงว่าง กันสับสนกับ recipient id ว่างจริง ๆ (ไม่มีในทางปฏิบัติ แต่กันไว้)
function _tgMirrorSelect(c, i) {
  const recipients = lineConfigCache?.recipients || [];
  const cur = c.mirror_of_line_id != null ? String(c.mirror_of_line_id) : '';
  return `<label style="display:flex;align-items:center;gap:6px;margin:4px 0 4px 24px;font-size:11px">
    <span style="color:var(--text-secondary)">${escapeHtml(I18N.t('tg.mirrorLabel'))}</span>
    <select class="form-input" style="font-size:11px;padding:2px 6px;width:auto" data-change="tgChatFieldToggle" data-idx="${i}" data-field="mirror_of_line_id">
      <option value="" ${cur === '' ? 'selected' : ''}>${escapeHtml(I18N.t('tg.mirrorNone'))}</option>
      ${recipients.map((r) => `<option value="${escapeHtml(r.id)}" ${cur === String(r.id) ? 'selected' : ''}>${escapeHtml(r.name || r.id)}</option>`).join('')}
    </select>
  </label>`;
}

function renderTgChats() {
  const el = document.getElementById('tgChatsList');
  if (!el) return;
  const chats = tgConfigCache?.chats || [];
  if (!chats.length) {
    el.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('tg.noApproved'))}</div>`;
    return;
  }
  el.innerHTML = chats.map((c, i) => {
    const on = c.lpr_enabled !== false;
    return `
    <div style="padding:8px 0;border-bottom:1px solid var(--border-hairline)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <input type="checkbox" ${c.enabled !== false ? 'checked' : ''} data-change="tgChatFieldToggle" data-idx="${i}" data-field="enabled">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600"><span class="chip" style="font-size:9px;margin-right:4px">${c.type === 'private' ? 'DM' : 'GRP'}</span>${escapeHtml(c.name || c.chat_id)}</div>
          <div style="font-size:9px;color:var(--text-secondary);font-family:monospace">${escapeHtml(c.chat_id)}</div>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:4px 0 4px 24px">
        <input type="checkbox" data-change="tgChatFieldToggle" data-idx="${i}" data-field="lpr_enabled" ${on ? 'checked' : ''}>
        <span style="font-size:11px">${escapeHtml(I18N.t('tg.lprEnabledLabel'))}</span>
        ${on ? '' : `<span style="font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t('ach.lprOptedOut'))}</span>`}
      </label>
      ${on ? _tgScopeRow(c, i) : ''}
      ${_tgMirrorSelect(c, i)}
    </div>`;
  }).join('');
}

async function saveTgConfig() {
  try {
    const tokenVal = document.getElementById('cfgTgToken').value.trim();
    const data = {
      enabled: document.getElementById('cfgTgEnabled').checked,
      chats: tgConfigCache?.chats || [],
    };
    if (tokenVal) data.bot_token = tokenVal;
    const res = await fetch(`${API}/api/telegram-config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    alert(I18N.t('ar.configSaved'));
    loadTgConfig();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

async function loadTgPending() {
  const el = document.getElementById('tgPendingList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/telegram/pending`);
    if (!res.ok) throw new Error((await res.json()).error || 'load failed');
    tgPendingCache = await res.json();
    renderTgPending();
  } catch (e) {
    el.innerHTML = `<div style="padding:12px;color:var(--status-bad);font-size:11px">${escapeHtml(I18N.t('tg.pendingLoadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function renderTgPending() {
  const el = document.getElementById('tgPendingList');
  if (!el) return;
  const rows = Array.isArray(tgPendingCache) ? tgPendingCache : [];
  const badge = document.getElementById('tgPendingBadge');
  if (badge) { badge.textContent = rows.length || ''; badge.style.display = rows.length ? '' : 'none'; }
  if (!rows.length) {
    el.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:11px;border:1px dashed var(--border-hairline);border-radius:7px">${escapeHtml(I18N.t('tg.noPending'))}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const typeChip = r.type === 'private' ? '<span class="chip" style="font-size:9px">DM</span>' : '<span class="chip" style="font-size:9px">GRP</span>';
    const name = r.title || I18N.t('ln.unknownName');
    const lastSeen = r.last_seen ? new Date(r.last_seen).toLocaleString('th-TH', { hour12: false }) : '—';
    return `
      <div class="line-pending-card">
        <div class="line-pending-main">
          <div class="line-pending-name">${typeChip} ${escapeHtml(name)}</div>
          <div class="line-pending-meta">${escapeHtml(r.chat_id)}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${escapeHtml(I18N.t('ln.lastSeen').replace('{time}', lastSeen))}</div>
        </div>
        <div class="line-pending-actions">
          <button class="btn btn-primary" style="padding:5px 10px;font-size:10px" data-action="approveTgPending" data-chat-id="${escapeHtml(r.chat_id)}">${escapeHtml(I18N.t('ln.approve'))}</button>
          <button class="btn btn-secondary" style="padding:5px 10px;font-size:10px" data-action="ignoreTgPending" data-chat-id="${escapeHtml(r.chat_id)}">${escapeHtml(I18N.t('ln.ignore'))}</button>
          <button class="btn btn-danger" style="padding:5px 10px;font-size:10px" data-action="blockTgPending" data-chat-id="${escapeHtml(r.chat_id)}">${escapeHtml(I18N.t('ln.block'))}</button>
        </div>
      </div>`;
  }).join('');
}

async function approveTgPending(chatId) {
  try {
    const res = await fetch(`${API}/api/telegram/pending/${encodeURIComponent(chatId)}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error || 'approve failed');
    await loadTgConfig();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function ignoreTgPending(chatId) {
  try {
    const res = await fetch(`${API}/api/telegram/pending/${encodeURIComponent(chatId)}/ignore`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error || 'ignore failed');
    loadTgPending();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function blockTgPending(chatId) {
  try {
    const res = await fetch(`${API}/api/telegram/pending/${encodeURIComponent(chatId)}/block`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error || 'block failed');
    loadTgPending();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}
