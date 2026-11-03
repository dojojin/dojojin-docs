// ============================================================
// Vigil Platform — Settings › LINE › คำสั่งผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// สี่ส่วนในแท็บเดียว เพราะคนตั้งค่าต้องเห็นพร้อมกันเสมอ:
//   ผู้มีสิทธิ์สั่ง → คำสั่ง → ทดลองสั่ง → ปูมการใช้งาน
// ปูมคือที่ที่บอกว่าคำเรียกไหนยังขาด (แถว "จับไม่ได้") ⇒ อยู่หน้าเดียวกับที่แก้คำเรียก
//
// ไม่มี emoji ทุกจุดตามที่เจ้าของสั่ง (2026-09-08) · ทุกสี/ระยะมาจาก token
'use strict';

const _lcT = (k, fb) => (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, fb) : fb;
const _lcEsc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);
const _lcState = { sources: [], commands: [], operators: [], users: [], known: [],
  actions: [], recipients: [], editing: null,
  pendingEditId: null };   // แก้ไขคำสั่งมาจากหน้า Telegram — ดู lctCmdEdit()/_lcRender()

async function loadLineCommands() {
  const box = document.getElementById('lineCmdBody');
  if (!box) return;
  try {
    const [sources, commands, operators, users, known, actionCfg] = await Promise.all([
      fetch(`${API}/api/line/command-sources`).then(r => r.json()),
      fetch(`${API}/api/line/commands`).then(r => r.json()),
      fetch(`${API}/api/line/operators`).then(r => r.json()),
      fetch(`${API}/api/users`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${API}/api/line/known-senders`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${API}/api/line/command-actions`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    _lcState.sources = Array.isArray(sources) ? sources : [];
    _lcState.commands = Array.isArray(commands) ? commands : [];
    _lcState.operators = Array.isArray(operators) ? operators : [];
    _lcState.users = Array.isArray(users) ? users : (users.users || []);
    _lcState.known = Array.isArray(known) ? known : [];
    _lcState.actions = actionCfg.actions || [];
    _lcState.recipients = actionCfg.recipients || [];
    _lcRender();
  } catch (e) {
    box.innerHTML = `<div class="set-card">${_lcEsc(_lcT('lc.loadFail', 'โหลดข้อมูลไม่สำเร็จ'))} ${_lcEsc(e.message)}</div>`;
  }
}

function _lcRender() {
  const box = document.getElementById('lineCmdBody');
  if (!box) return;
  box.innerHTML = _lcOperatorsCard() + _lcCommandsCard() + _lcTestCard() + _lcLogCard();
  loadLineCommandLog();
  // เปิดตัวแก้ไขค้างไว้จากหน้า Telegram (lctCmdEdit) — ต้องทำ "หลัง" innerHTML ข้างบน
  // เสมอ ไม่งั้นรอบโหลดที่มาทีหลัง (switchAlertTab('commands') ยิง loadLineCommands()
  // เองอยู่แล้วแบบไม่ await) จะเขียน DOM ทับตัวแก้ไขที่เพิ่งเปิดไปจนหายเงียบๆ
  if (_lcState.pendingEditId != null) {
    const id = _lcState.pendingEditId;
    _lcState.pendingEditId = null;
    const cmd = _lcState.commands.find((c) => String(c.id) === String(id));
    if (cmd) _lcOpenEditor(cmd);
  }
}

// ── 1. ผู้มีสิทธิ์สั่ง ────────────────────────────────────────
function _lcOperatorsCard() {
  const rows = _lcState.operators.map(o => `
    <tr>
      <td>${_lcEsc(o.display_name || '-')}<div class="lc-dim">${_lcEsc(String(o.line_user_id).slice(0, 10))}…</div></td>
      <td>${o.username ? _lcEsc(o.username) : `<span class="lc-warn">${_lcEsc(_lcT('lc.noAccount', 'ไม่ได้ผูกบัญชี'))}</span>`}
          <div class="lc-dim">${_lcEsc(o.role || '')}</div></td>
      <td>${o.allow_in && o.allow_in.length
            ? _lcEsc(_lcT('lc.someRooms', 'เฉพาะบางห้อง'))
            : _lcEsc(_lcT('lc.anyRoom', 'ทุกห้อง'))}</td>
      <td class="lc-col-opt">${o.last_used_at ? _lcEsc(new Date(o.last_used_at).toLocaleString('th-TH')) : '-'}</td>
      <td style="white-space:nowrap">
        ${o.telegram_user_id
          ? `<span class="lc-ok">${_lcEsc(_lcT('lc.tgLinked', 'ผูกแล้ว'))}</span>
             <button class="btn btn-secondary lc-btn" data-action="lcOpTgUnlink" data-id="${_lcEsc(o.line_user_id)}">${_lcEsc(_lcT('lc.tgUnlink', 'ยกเลิกผูก'))}</button>`
          : `<button class="btn btn-secondary lc-btn" data-action="lcOpTgLink" data-id="${_lcEsc(o.line_user_id)}">${_lcEsc(_lcT('lc.tgLink', 'ผูก Telegram'))}</button>`}
      </td>
      <td style="text-align:end;white-space:nowrap">
        <button class="btn btn-secondary lc-btn" data-action="lcOpToggle" data-id="${_lcEsc(o.line_user_id)}"
          data-on="${o.enabled ? '1' : '0'}">${_lcEsc(o.enabled ? _lcT('lc.disable', 'ปิด') : _lcT('lc.enable', 'เปิด'))}</button>
        <button class="btn btn-danger lc-btn" data-action="lcOpDelete" data-id="${_lcEsc(o.line_user_id)}">${_lcEsc(_lcT('common.delete', 'ลบ'))}</button>
      </td>
    </tr>`).join('');

  const userOpts = _lcState.users.map(u =>
    `<option value="${u.id}">${_lcEsc(u.username)} (${_lcEsc(u.role)})</option>`).join('');

  return `
  <div class="set-card" style="margin-bottom:14px">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lc.opsTitle', 'ผู้มีสิทธิ์สั่ง'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lc.opsNote', 'คนที่ไม่อยู่ในรายการนี้ พิมพ์อะไรมาบอทจะเงียบเสมอ · สั่งได้แค่ไหนขึ้นกับบัญชีที่ผูกไว้'))}</div>
    </div></div>
    <div class="lc-table-wrap">
      <table class="lc-table">
        <thead><tr>
          <th>${_lcEsc(_lcT('lc.colWho', 'ผู้สั่ง'))}</th>
          <th>${_lcEsc(_lcT('lc.colAccount', 'บัญชีที่ยืมสิทธิ์'))}</th>
          <th>${_lcEsc(_lcT('lc.colRooms', 'ห้องที่สั่งได้'))}</th>
          <th class="lc-col-opt">${_lcEsc(_lcT('lc.colLastUsed', 'ใช้ล่าสุด'))}</th>
          <th>${_lcEsc(_lcT('lc.colTelegram', 'Telegram'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="lc-dim">${_lcEsc(_lcT('lc.noOps', 'ยังไม่มีใครสั่งได้ — ระบบยังไม่ตอบคำสั่งจากใครทั้งสิ้น'))}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="lc-form-row" style="margin-top:10px">
      <select class="form-input lc-in" id="lcOpPick" data-change="lcOpPick">
        <option value="">${_lcEsc(_lcT('lc.pickSender', 'เลือกคนที่ระบบรู้จัก'))}</option>
        ${_lcState.known.map(k => `<option value="${_lcEsc(k.line_user_id)}" data-name="${_lcEsc(k.display_name || '')}">`
          + `${_lcEsc(k.display_name || (String(k.line_user_id).slice(0, 10) + '…'))}`
          + `${k.seen_count ? ` — ${_lcEsc(_lcT('lc.seenInGroup', 'เคยพิมพ์ในกลุ่ม'))} ${k.seen_count}` : ''}</option>`).join('')}
        <option value="__manual__">${_lcEsc(_lcT('lc.typeManually', 'พิมพ์รหัสเอง'))}</option>
      </select>
      <input class="form-input lc-in" id="lcOpId" hidden placeholder="${_lcEsc(_lcT('lc.lineIdPh', 'LINE user id (U…)'))}">
      <input class="form-input lc-in" id="lcOpName" placeholder="${_lcEsc(_lcT('lc.namePh', 'ชื่อที่เรียก'))}">
      <select class="form-input lc-in" id="lcOpUser"><option value="">${_lcEsc(_lcT('lc.pickAccount', 'เลือกบัญชีที่ให้ยืมสิทธิ์'))}</option>${userOpts}</select>
      <button class="btn btn-primary lc-btn" data-action="lcOpAdd">${_lcEsc(_lcT('lc.addOp', 'เพิ่มผู้สั่ง'))}</button>
    </div>
    <div class="lc-dim" style="margin-top:6px">${_lcEsc(_lcT('lc.opsHint2', 'รายชื่อมาจากคนที่เคยทักบอท และคนที่เคยพิมพ์ในกลุ่มที่บอทอยู่ · ไม่มีในรายการ = ให้เขาพิมพ์อะไรก็ได้ในกลุ่มหนึ่งครั้งแล้วกลับมาดูใหม่'))}</div>
  </div>`;
}

// ── 2. คำสั่ง ────────────────────────────────────────────────
function _lcCommandsCard() {
  const rows = _lcState.commands.map(c => `
    <tr>
      <td><b>${_lcEsc(c.label)}</b><div class="lc-dim">${_lcEsc(c.key)}</div></td>
      <td>${(c.triggers || []).map(t => `<span class="lc-chip">${_lcEsc(t)}</span>`).join(' ') || '-'}</td>
      <td>${c.action_key
            ? `<span class="lc-chip lc-chip-req">${_lcEsc(_lcT('lc.kindAction', 'ลงมือทำ'))}</span> `
              + _lcEsc((_lcState.actions.find(a => a.key === c.action_key) || {}).label || c.action_key)
              + _lcTargetNames(c)
            : _lcEsc((_lcState.sources.find(s => s.key === c.source_key) || {}).label || c.source_key)}</td>
      <td>${(c.required_slots || []).length
            ? (c.required_slots || []).map(s => `<span class="lc-chip lc-chip-req">${_lcEsc(_lcSlotName(s))}</span>`).join(' ')
            : `<span class="lc-dim">${_lcEsc(_lcT('lc.none', 'ไม่บังคับ'))}</span>`}</td>
      <td class="lc-col-opt">${c.used_30d || 0}</td>
      <td style="text-align:end;white-space:nowrap">
        <button class="btn btn-secondary lc-btn" data-action="lcCmdToggle" data-id="${c.id}"
          data-on="${c.enabled ? '1' : '0'}">${_lcEsc(c.enabled ? _lcT('lc.disable', 'ปิด') : _lcT('lc.enable', 'เปิด'))}</button>
        <button class="btn btn-secondary lc-btn" data-action="lcCmdEdit" data-id="${c.id}">${_lcEsc(_lcT('common.edit', 'แก้ไข'))}</button>
      </td>
    </tr>`).join('');

  return `
  <div class="set-card" style="margin-bottom:14px">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lc.cmdTitle', 'คำสั่ง'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lc.cmdNote', 'พิมพ์เป็นประโยคปกติได้ ไม่ต้องขึ้นต้นด้วยเครื่องหมายอะไร · ช่องที่ "บังคับ" คือช่องที่บอทจะถามกลับเมื่อไม่ได้ระบุมา'))}</div>
    </div><button class="btn btn-primary lc-btn" data-action="lcCmdNew">${_lcEsc(_lcT('lc.addCmd', 'เพิ่มคำสั่ง'))}</button></div>
    <div class="lc-table-wrap">
      <table class="lc-table">
        <thead><tr>
          <th>${_lcEsc(_lcT('lc.colCmd', 'คำสั่ง'))}</th>
          <th>${_lcEsc(_lcT('lc.colTriggers', 'คำเรียก'))}</th>
          <th>${_lcEsc(_lcT('lc.colSource', 'แหล่งข้อมูล'))}</th>
          <th>${_lcEsc(_lcT('lc.colRequired', 'ช่องที่บังคับ'))}</th>
          <th class="lc-col-opt">${_lcEsc(_lcT('lc.col30d', 'ใช้ 30 วัน'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div id="lcCmdEditor"></div>
  </div>`;
}

const _lcSlotName = (s) => ({
  period: _lcT('lc.slotPeriod', 'ช่วงเวลา'), limit: _lcT('lc.slotLimit', 'จำนวน'),
  site: _lcT('lc.slotSite', 'ไซต์'), camera: _lcT('lc.slotCamera', 'กล้อง'),
  plate: _lcT('lc.slotPlate', 'ป้ายทะเบียน'), hours: _lcT('lc.slotHours', 'จำนวนชั่วโมง'),
}[s] || s);

function lcCmdNew() { _lcOpenEditor(null); }
function lcCmdEdit(el) { _lcOpenEditor(_lcState.commands.find(c => String(c.id) === el.dataset.id)); }

function _lcOpenEditor(cmd) {
  const box = document.getElementById('lcCmdEditor');
  if (!box) return;
  const c = cmd || { key: '', label: '', source_key: _lcState.sources[0]?.key || '',
    triggers: [], require_all: [], exclude: [], slots: ['period'], required_slots: [],
    reply_title: '', cooldown_sec: 10, enabled: true };
  _lcState.editing = cmd ? cmd.id : null;
  const srcOpts = _lcState.sources.map(s =>
    `<option value="${_lcEsc(s.key)}" ${s.key === c.source_key ? 'selected' : ''}>${_lcEsc(s.label)}</option>`).join('');
  const actOpts = _lcState.actions.map(a =>
    `<option value="${_lcEsc(a.key)}" ${a.key === c.action_key ? 'selected' : ''}>${_lcEsc(a.label)}</option>`).join('');
  const isAction = !!c.action_key;
  const toIds = (c.fixed_params && Array.isArray(c.fixed_params.to)) ? c.fixed_params.to.map(String) : [];
  const rcpOpts = _lcState.recipients.map(r =>
    `<option value="${_lcEsc(r.id)}" ${toIds.includes(String(r.id)) ? 'selected' : ''}>${_lcEsc(r.name)}</option>`).join('');
  const slotBoxes = ['period', 'limit', 'site', 'camera', 'plate', 'hours'].map(s => `
    <label class="lc-slot"><input type="checkbox" data-slot="${s}" ${(c.slots || []).includes(s) ? 'checked' : ''}>
      <span>${_lcEsc(_lcSlotName(s))}</span></label>
    <label class="lc-slot"><input type="checkbox" data-req="${s}" ${(c.required_slots || []).includes(s) ? 'checked' : ''}>
      <span class="lc-dim">${_lcEsc(_lcT('lc.required', 'บังคับ'))}</span></label>`).join('');

  box.innerHTML = `
    <div class="lc-editor">
      <div class="lc-help">
        <b>${_lcEsc(_lcT('lc.helpTitle', 'กรอกยังไง'))}</b>
        <div>${_lcEsc(_lcT('lc.helpKey', 'ชื่อย่อ = ชื่อภายในระบบ ภาษาอังกฤษตัวเล็ก เช่น helmet_count (ตั้งครั้งเดียว ไม่ต้องแก้อีก)'))}</div>
        <div>${_lcEsc(_lcT('lc.helpTrig', 'คำเรียก = คำที่คนพิมพ์แล้วให้ถือว่าเรียกคำสั่งนี้ คั่นด้วยจุลภาค เช่น  ไม่สวมหมวก, หมวกนิรภัย'))}</div>
        <div>${_lcEsc(_lcT('lc.helpReq', 'คำที่ต้องมีครบ = ต้องเจอทุกคำถึงจะนับ ใช้แยกคำสั่งที่คล้ายกัน เช่นใส่ "ป้าย" ให้คำสั่งอันดับป้าย'))}</div>
        <div>${_lcEsc(_lcT('lc.helpExc', 'คำที่ห้ามมี = เจอคำนี้เมื่อไหร่ไม่ใช่คำสั่งนี้ เช่นใส่ "อันดับ" ให้คำสั่งที่ตอบยอดรวม'))}</div>
        <div>${_lcEsc(_lcT('lc.helpSlot', 'ช่องที่ดึงจากประโยค = ติ๊กไว้แล้วระบบจะอ่านค่าจากที่คนพิมพ์ · ติ๊ก "บังคับ" คู่กัน = ถ้าไม่ระบุมา บอทจะถามกลับ'))}</div>
        <div class="lc-help-ex">${_lcEsc(_lcT('lc.helpEx', 'ตัวอย่างที่ใช้ได้จริง:  "ขอทราบยอดคนไม่สวมหมวกนิรภัย ภูเก็ต ชั่วโมงที่แล้ว"  ·  "ขอป้ายทะเบียนที่ฝ่าฝืน เยอะที่สุดมา 3 ป้าย"  ·  "ส่งให้ตำรวจ 1กอ88"'))}</div>
      </div>
      <div class="lc-form-row">
        <input class="form-input lc-in" id="lcEdKey" value="${_lcEsc(c.key)}"
               placeholder="${_lcEsc(_lcT('lc.phKey', 'ชื่อย่อ เช่น helmet_count'))}" title="${_lcEsc(_lcT('lc.phKey', 'ชื่อย่อ'))}">
        <input class="form-input lc-in" id="lcEdLabel" value="${_lcEsc(c.label)}" placeholder="${_lcEsc(_lcT('lc.cmdNamePh', 'ชื่อคำสั่ง'))}">
        <select class="form-input lc-in" id="lcEdKind" data-change="lcEdKind">
          <option value="query" ${isAction ? '' : 'selected'}>${_lcEsc(_lcT('lc.kindQuery', 'ถามข้อมูล'))}</option>
          <option value="action" ${isAction ? 'selected' : ''}>${_lcEsc(_lcT('lc.kindAction', 'ลงมือทำ'))}</option>
        </select>
        <select class="form-input lc-in" id="lcEdSource" ${isAction ? 'hidden' : ''}>${srcOpts}</select>
        <select class="form-input lc-in" id="lcEdAction" ${isAction ? '' : 'hidden'}>${actOpts}</select>
      </div>
      <div class="lc-form-row" id="lcEdToRow" ${isAction ? '' : 'hidden'}>
        <label class="lc-dim" style="min-width:110px">${_lcEsc(_lcT('lc.sendTo', 'ส่งถึง (เลือกได้หลายราย)'))}</label>
        <select class="form-input lc-in" id="lcEdTo" multiple size="4">${rcpOpts}</select>
      </div>
      <div class="lc-form-row">
        <input class="form-input lc-in" id="lcEdTriggers" value="${_lcEsc((c.triggers || []).join(', '))}"
               placeholder="${_lcEsc(_lcT('lc.triggersPh2', 'คำเรียก เช่น ไม่สวมหมวก, หมวกนิรภัย'))}">
        <input class="form-input lc-in" id="lcEdRequireAll" value="${_lcEsc((c.require_all || []).join(', '))}"
               placeholder="${_lcEsc(_lcT('lc.requireAllPh2', 'คำที่ต้องมีครบ เช่น ป้าย'))}">
        <input class="form-input lc-in" id="lcEdExclude" value="${_lcEsc((c.exclude || []).join(', '))}"
               placeholder="${_lcEsc(_lcT('lc.excludePh2', 'คำที่ห้ามมี เช่น อันดับ'))}">
      </div>
      <div class="lc-slots">${slotBoxes}</div>
      <div class="lc-form-row">
        <input class="form-input lc-in" id="lcEdExample" value="${_lcEsc(c.example || '')}"
               placeholder="${_lcEsc(_lcT('lc.examplePh', 'ตัวอย่างประโยค (โชว์ตอนพิมพ์ "ช่วยเหลือ")'))}">
      </div>
      <div class="lc-form-row">
        <input class="form-input lc-in" id="lcEdTitle" value="${_lcEsc(c.reply_title || '')}"
               placeholder="${_lcEsc(_lcT('lc.titlePh2', 'หัวการ์ดตอบกลับ เช่น ผู้ไม่สวมหมวกนิรภัย'))}">
        <input class="form-input lc-in" id="lcEdCooldown" type="number" min="0" max="3600"
               value="${c.cooldown_sec ?? 10}" placeholder="${_lcEsc(_lcT('lc.cooldownPh2', 'เว้นระยะก่อนสั่งซ้ำ (วินาที)'))}">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap">
        ${cmd ? `<button class="btn btn-danger lc-btn" data-action="lcCmdDelete" data-id="${cmd.id}">${_lcEsc(_lcT('common.delete', 'ลบ'))}</button>` : ''}
        <button class="btn btn-secondary lc-btn" data-action="lcCmdCancel">${_lcEsc(_lcT('common.cancel', 'ยกเลิก'))}</button>
        <button class="btn btn-primary lc-btn" data-action="lcCmdSave">${_lcEsc(_lcT('common.save', 'บันทึก'))}</button>
      </div>
    </div>`;
}

function lcEdKind(el) {
  const action = el.value === 'action';
  document.getElementById('lcEdSource').hidden = action;
  document.getElementById('lcEdAction').hidden = !action;
  document.getElementById('lcEdToRow').hidden = !action;
}

// ชื่อผู้รับปลายทาง — ตารางต้องบอกได้ว่าคำสั่งนี้จะส่งของออกไปที่ไหน ไม่ใช่แค่ว่า "ทำ"
function _lcTargetNames(c) {
  const to = (c.fixed_params && Array.isArray(c.fixed_params.to)) ? c.fixed_params.to.map(String) : [];
  if (!to.length) return '';
  const names = _lcState.recipients.filter(r => to.includes(String(r.id))).map(r => r.name);
  return `<div class="lc-dim">${_lcEsc(_lcT('lc.sendToShort', 'ส่งถึง'))} ${_lcEsc(names.join(', ') || to.length + ' ราย')}</div>`;
}

function lcCmdCancel() { const b = document.getElementById('lcCmdEditor'); if (b) b.innerHTML = ''; _lcState.editing = null; }

const _lcSplit = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

async function lcCmdSave() {
  const box = document.getElementById('lcCmdEditor');
  const body = {
    key: document.getElementById('lcEdKey').value.trim(),
    label: document.getElementById('lcEdLabel').value.trim(),
    ...(document.getElementById('lcEdKind').value === 'action'
      ? { action_key: document.getElementById('lcEdAction').value,
          fixed_params: { to: [...document.getElementById('lcEdTo').selectedOptions].map(o => o.value) } }
      : { source_key: document.getElementById('lcEdSource').value }),
    triggers: _lcSplit(document.getElementById('lcEdTriggers').value),
    require_all: _lcSplit(document.getElementById('lcEdRequireAll').value),
    exclude: _lcSplit(document.getElementById('lcEdExclude').value),
    slots: [...box.querySelectorAll('[data-slot]:checked')].map(i => i.dataset.slot),
    required_slots: [...box.querySelectorAll('[data-req]:checked')].map(i => i.dataset.req),
    reply_title: document.getElementById('lcEdTitle').value.trim(),
    example: document.getElementById('lcEdExample').value.trim(),
    cooldown_sec: parseInt(document.getElementById('lcEdCooldown').value, 10) || 0,
    enabled: true,
  };
  const id = _lcState.editing;
  try {
    const r = await fetch(`${API}/api/line/commands${id ? '/' + id : ''}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    lcCmdCancel();
    await loadLineCommands();
  } catch (e) { alert(e.message); }
}

async function lcCmdToggle(el) {
  await fetch(`${API}/api/line/commands/${el.dataset.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: el.dataset.on !== '1' }),
  });
  await loadLineCommands();
}

async function lcCmdDelete(el) {
  if (!confirm(_lcT('lc.confirmDelCmd', 'ลบคำสั่งนี้'))) return;
  await fetch(`${API}/api/line/commands/${el.dataset.id}`, { method: 'DELETE' });
  lcCmdCancel();
  await loadLineCommands();
}

function lcOpPick(el) {
  const manual = el.value === '__manual__';
  const idIn = document.getElementById('lcOpId');
  idIn.hidden = !manual;
  if (manual) { idIn.value = ''; idIn.focus(); return; }
  // ชื่อจาก LINE เติมให้เลย แต่ยังแก้ได้ — ชื่อโปรไฟล์ LINE บางคนเป็นอิโมจิล้วน
  const name = el.selectedOptions[0]?.dataset.name || '';
  const nameIn = document.getElementById('lcOpName');
  if (nameIn && !nameIn.value.trim()) nameIn.value = name;
}

async function lcOpAdd() {
  const pick = document.getElementById('lcOpPick').value;
  const body = {
    line_user_id: (pick && pick !== '__manual__') ? pick : document.getElementById('lcOpId').value.trim(),
    display_name: document.getElementById('lcOpName').value.trim() || null,
    user_id: parseInt(document.getElementById('lcOpUser').value, 10),
  };
  try {
    const r = await fetch(`${API}/api/line/operators`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    await loadLineCommands();
  } catch (e) { alert(e.message); }
}

async function lcOpToggle(el) {
  await fetch(`${API}/api/line/operators/${encodeURIComponent(el.dataset.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: el.dataset.on !== '1' }) });
  await loadLineCommands();
}

async function lcOpDelete(el) {
  if (!confirm(_lcT('lc.confirmDelOp', 'ถอนสิทธิ์ผู้สั่งคนนี้'))) return;
  await fetch(`${API}/api/line/operators/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
  await loadLineCommands();
}

// ── ผูก/ยกเลิกผูก Telegram (T4) — รหัส 6 หลัก อายุ 10 นาที ผู้สั่งพิมพ์
// "/link <รหัส>" ทักบอทเป็นการส่วนตัวเอง (ไม่ให้กรอก telegram user id ตรง ๆ ในนี้)
// ปุ่มนี้อยู่ทั้งสองหน้า (LINE + Telegram) — ต้องรีโหลด "หน้าที่กำลังเปิดอยู่จริง"
// ไม่ใช่รีโหลดหน้า LINE เสมอ ไม่งั้นกดจากหน้า Telegram แล้วตารางของหน้านั้นไม่อัปเดต
async function _lcRefreshVisiblePage() {
  const tgVisible = document.getElementById('alertSection-tgcommands')?.style.display !== 'none';
  if (tgVisible) await loadTgCommands().catch(() => {});
  else await loadLineCommands().catch(() => {});
}

async function lcOpTgLink(el) {
  try {
    const r = await fetch(`${API}/api/line/operators/${encodeURIComponent(el.dataset.id)}/telegram-link`,
      { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    alert(_lcT('lc.tgLinkCodeMsg', 'รหัสผูก Telegram: ') + d.code + '\n'
      + _lcT('lc.tgLinkCodeHint', 'ให้ผู้สั่งทักบอทเป็นการส่วนตัว (แชทเดี่ยว) แล้วพิมพ์ /link ')
      + d.code + ' ' + _lcT('lc.tgLinkCodeHint2', 'ภายใน 10 นาที'));
    await _lcRefreshVisiblePage();
  } catch (e) { alert(e.message); }
}

async function lcOpTgUnlink(el) {
  if (!confirm(_lcT('lc.tgUnlinkConfirm', 'ยกเลิกการผูก Telegram ของผู้สั่งคนนี้'))) return;
  await fetch(`${API}/api/line/operators/${encodeURIComponent(el.dataset.id)}/telegram-link`, { method: 'DELETE' });
  await _lcRefreshVisiblePage();
}

// ── 3. ทดลองสั่ง ────────────────────────────────────────────
function _lcTestCard() {
  return `
  <div class="set-card" style="margin-bottom:14px">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lc.testTitle', 'ทดลองสั่ง'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lc.testNote', 'เห็นผลเหมือนที่บอทจะตอบ โดยไม่ส่งอะไรเข้า LINE จริง'))}</div>
    </div></div>
    <div class="lc-form-row">
      <input class="form-input lc-in" id="lcTestText" style="flex:3"
             placeholder="${_lcEsc(_lcT('lc.testPh', 'เช่น ขอทราบยอดคนไม่สวมหมวกนิรภัย ชั่วโมงที่แล้ว'))}"
             data-action-enter="lcTest">
      <button class="btn btn-primary lc-btn" data-action="lcTest">${_lcEsc(_lcT('lc.testRun', 'ลองดู'))}</button>
    </div>
    <div id="lcTestOut" style="margin-top:10px"></div>
  </div>`;
}

async function lcTest() {
  const out = document.getElementById('lcTestOut');
  const text = document.getElementById('lcTestText').value.trim();
  if (!text || !out) return;
  out.innerHTML = `<div class="lc-dim">${_lcEsc(_lcT('common.loading', 'กำลังโหลด'))}</div>`;
  try {
    const r = await fetch(`${API}/api/line/commands/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const d = await r.json();
    if (d.card) {
      const c = d.card;
      out.innerHTML = `
        <div class="lc-preview">
          <div class="lc-prev-title">${_lcEsc(c.title || '')}</div>
          ${c.period ? `<div class="lc-dim">${_lcEsc(c.period)}</div>` : ''}
          ${c.big ? `<div class="lc-prev-big">${_lcEsc(c.big)} <span class="lc-dim">${_lcEsc(c.unit || '')}</span></div>` : ''}
          ${(c.rows || []).map(([k, v]) => `<div class="lc-prev-row"><span>${_lcEsc(k)}</span><b>${_lcEsc(v)}</b></div>`).join('')}
          ${c.note ? `<div class="lc-dim" style="margin-top:8px">${_lcEsc(c.note)}</div>` : ''}
        </div>`;
    } else {
      out.innerHTML = `<div class="lc-preview"><div class="lc-dim">${_lcEsc(_lcT('lc.testStatus', 'ผลลัพธ์'))}: ${_lcEsc(d.status || '')}</div>
        <div style="white-space:pre-wrap;margin-top:6px">${_lcEsc(d.text || _lcT('lc.testSilent', 'บอทจะเงียบ ไม่ตอบอะไรกลับไป'))}</div></div>`;
    }
    loadLineCommandLog();
  } catch (e) { out.innerHTML = `<div class="lc-warn">${_lcEsc(e.message)}</div>`; }
}

// ── 4. ปูมการใช้งาน ─────────────────────────────────────────
function _lcLogCard() {
  return `
  <div class="set-card">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lc.logTitle', 'บันทึกการใช้งาน'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lc.logNote', 'แถวที่ "จับไม่ได้" คือประโยคที่ยังไม่มีคำเรียกรองรับ — เอาไปเพิ่มในคำสั่งได้เลย'))}</div>
    </div></div>
    <div class="lc-table-wrap" id="lcLogWrap"></div>
  </div>`;
}

const _LC_STATUS = {
  ok: 'สำเร็จ', no_match: 'จับไม่ได้', ambiguous: 'กำกวม', denied: 'ไม่มีสิทธิ์',
  rate_limited: 'ถี่เกินไป', error: 'ผิดพลาด', ask_site: 'ถามไซต์', ask_period: 'ถามช่วงเวลา',
};

async function loadLineCommandLog() {
  const wrap = document.getElementById('lcLogWrap');
  if (!wrap) return;
  try {
    const rows = await fetch(`${API}/api/line/command-log?limit=60`).then(r => r.json());
    wrap.innerHTML = `
      <table class="lc-table">
        <thead><tr>
          <th>${_lcEsc(_lcT('lc.colTime', 'เวลา'))}</th>
          <th>${_lcEsc(_lcT('lc.colWho', 'ผู้สั่ง'))}</th>
          <th>${_lcEsc(_lcT('lc.colText', 'ข้อความ'))}</th>
          <th>${_lcEsc(_lcT('lc.colMatched', 'จับได้'))}</th>
          <th>${_lcEsc(_lcT('lc.colStatus', 'ผล'))}</th>
          <th>ms</th>
        </tr></thead>
        <tbody>${(rows || []).map(r => `
          <tr>
            <td class="lc-dim">${_lcEsc(new Date(r.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }))}</td>
            <td>${_lcEsc(r.operator_name || '-')}</td>
            <td>${_lcEsc(r.text_in || '')}</td>
            <td>${_lcEsc(r.matched_key || '-')}</td>
            <td><span class="lc-st lc-st-${_lcEsc(r.status)}">${_lcEsc(_LC_STATUS[r.status] || r.status)}</span></td>
            <td class="lc-dim">${r.ms ?? ''}</td>
          </tr>`).join('') || `<tr><td colspan="6" class="lc-dim">${_lcEsc(_lcT('lc.noLog', 'ยังไม่มีการใช้งาน'))}</td></tr>`}
        </tbody>
      </table>`;
  } catch { wrap.innerHTML = ''; }
}

// ============================================================
// Settings › LINE › คำสั่งผ่าน Telegram (แท็บแยก — ทะเบียนร่วมกับ LINE, migration 244)
// ------------------------------------------------------------
// ผู้มีสิทธิ์สั่ง/คำสั่ง เป็นตาราง `line_operators`/`line_commands` ตัวเดียวกับหน้า
// "คำสั่งผ่าน LINE" ทุกประการ — หน้านี้แค่ขอสถิติ/ปูมกรองด้วย ?source_type=telegram
// และแสดงตัวควบคุมที่เป็นของฝั่ง Telegram โดยเฉพาะ (telegram_enabled, telegram_allow_in)
// เพิ่ม/ลบผู้สั่ง หรือแก้คำเรียก/ช่องบังคับของคำสั่ง ยังทำที่หน้า LINE เท่านั้น (ทะเบียนเดียวกัน)
'use strict';

async function loadTgCommands() {
  const box = document.getElementById('tgCmdBody');
  if (!box) return;
  box.innerHTML = `<div class="set-card">${_lcEsc(_lcT('common.loading', 'กำลังโหลด...'))}</div>`;
  try {
    const [operators, tgCommands, tgCfg, sources, actionCfg] = await Promise.all([
      fetch(`${API}/api/line/operators`).then(r => r.json()),
      fetch(`${API}/api/line/commands?source_type=telegram`).then(r => r.json()),
      fetch(`${API}/api/telegram-config`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${API}/api/line/command-sources`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/line/command-actions`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    _lcState.operators = Array.isArray(operators) ? operators : [];
    _lcState.tgCommands = Array.isArray(tgCommands) ? tgCommands : [];
    _lcState.tgChats = Array.isArray(tgCfg.chats) ? tgCfg.chats : [];
    _lcState.sources = Array.isArray(sources) ? sources : [];
    _lcState.actions = actionCfg.actions || [];
    _tgcRender();
  } catch (e) {
    box.innerHTML = `<div class="set-card">${_lcEsc(_lcT('lc.loadFail', 'โหลดข้อมูลไม่สำเร็จ'))} ${_lcEsc(e.message)}</div>`;
  }
}

function _tgcRender() {
  const box = document.getElementById('tgCmdBody');
  if (!box) return;
  box.innerHTML = _tgcOperatorsCard() + _tgcCommandsCard() + _tgcLogCard();
  loadTgCommandLog();
}

// ── 1. ผู้มีสิทธิ์สั่ง (มองจากฝั่ง Telegram) ──────────────────────
function _tgcOperatorsCard() {
  // แชทส่วนตัว (type='private') ในรายการที่อนุมัติแล้ว = DM ของคนอื่น ไม่ใช่ของผู้สั่ง
  // คนนี้ — ไม่เอามาปนกับตัวเลือก "แชทส่วนตัว" ของแถวนั้น (ซึ่งผูกกับ telegram_user_id
  // ของ operator แถวนั้นโดยเฉพาะอยู่แล้ว ด้านล่าง) ไม่งั้นจะเห็นซ้ำ/เลือกผิดคนได้
  const approved = (_lcState.tgChats || []).filter((c) => c && c.enabled !== false && c.type !== 'private');
  const rows = _lcState.operators.map((o) => {
    const ownPriv = o.telegram_user_id ? `tg:${o.telegram_user_id}` : null;
    const opts = [
      ...approved.map((c) => ({ value: `tg:${c.chat_id}`, label: c.name || String(c.chat_id) })),
      ...(ownPriv ? [{ value: ownPriv, label: _lcT('lctab.privateChat', 'แชทส่วนตัว') }] : []),
    ];
    const selected = new Set((o.telegram_allow_in || []).map(String));
    // เคยเลือกไว้แต่หายไปจากตัวเลือกปัจจุบันแล้ว (ห้องถูกถอด/ปิด หรือผูก Telegram ใหม่
    // คนละบัญชี) — ต้องโชว์ให้เห็น ไม่งั้น select จะดูว่างจนเข้าใจผิดว่า "ไม่เลือกเลย =
    // สั่งได้ทุกห้อง" ทั้งที่จริงมี id เก่าค้างอยู่ซึ่งทำให้สั่งไม่ได้เลยสักห้อง (allowedHere
    // เห็นรายการไม่ว่าง แต่ไม่มีห้องไหนตรงเลย) — เก็บ selected ไว้ด้วย กดบันทึกโดยไม่แก้
    // อะไรจะโดน 400 จาก PUT validation ซึ่งบังคับให้แอดมินต้องมาแก้ไขจริง ไม่ใช่ปล่อยผ่าน
    const known = new Set(opts.map((op) => op.value));
    for (const v of selected) {
      if (!known.has(v)) opts.push({ value: v, label: `${_lcT('lctab.orphanedRoom', 'ไม่อยู่ในรายการแล้ว')} (${v})` });
    }
    return `
    <tr>
      <td>${_lcEsc(o.display_name || '-')}</td>
      <td>${o.username ? _lcEsc(o.username) : `<span class="lc-warn">${_lcEsc(_lcT('lc.noAccount', 'ไม่ได้ผูกบัญชี'))}</span>`}</td>
      <td style="white-space:nowrap">
        ${o.telegram_user_id
          ? `<span class="lc-ok">${_lcEsc(_lcT('lc.tgLinked', 'ผูกแล้ว'))}${o.telegram_display_name ? ' ' + _lcEsc(o.telegram_display_name) : ''}</span>
             <button class="btn btn-secondary lc-btn" data-action="lcOpTgUnlink" data-id="${_lcEsc(o.line_user_id)}">${_lcEsc(_lcT('lc.tgUnlink', 'ยกเลิกผูก'))}</button>`
          : `<span class="lc-dim">${_lcEsc(_lcT('lctab.notLinked', 'ยังไม่ผูก'))}</span>
             <button class="btn btn-secondary lc-btn" data-action="lcOpTgLink" data-id="${_lcEsc(o.line_user_id)}">${_lcEsc(_lcT('lc.tgLink', 'ผูก Telegram'))}</button>`}
      </td>
      <td>
        ${opts.length
          ? `<select class="form-input lc-in" multiple size="3" style="min-width:160px" data-tgrooms-id="${_lcEsc(o.line_user_id)}">
               ${opts.map((op) => `<option value="${_lcEsc(op.value)}" ${selected.has(op.value) ? 'selected' : ''}>${_lcEsc(op.label)}</option>`).join('')}
             </select>
             <button class="btn btn-secondary lc-btn" data-action="lctOpRoomsSave" data-id="${_lcEsc(o.line_user_id)}">${_lcEsc(_lcT('common.save', 'บันทึก'))}</button>`
          : `<span class="lc-dim">${_lcEsc(_lcT('lctab.noChats', 'ยังไม่มีห้อง Telegram ที่อนุมัติ'))}</span>`}
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="set-card" style="margin-bottom:14px">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lctab.opsTitle', 'ผู้มีสิทธิ์สั่ง'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lctab.opsNote', 'ทะเบียนผู้สั่งเดียวกับหน้า "คำสั่งผ่าน LINE" · ไม่เลือกห้องเลย = สั่งได้ทุกห้อง Telegram ที่อนุมัติแล้ว รวมแชทส่วนตัว'))}</div>
    </div>
    <button class="btn btn-secondary lc-btn" data-action="lctGoToLineOps">${_lcEsc(_lcT('lctab.goToLineOps', 'เพิ่ม/ลบผู้สั่งที่หน้า "คำสั่งผ่าน LINE"'))}</button>
    </div>
    <div class="lc-table-wrap">
      <table class="lc-table">
        <thead><tr>
          <th>${_lcEsc(_lcT('lc.colWho', 'ผู้สั่ง'))}</th>
          <th>${_lcEsc(_lcT('lc.colAccount', 'บัญชีที่ยืมสิทธิ์'))}</th>
          <th>${_lcEsc(_lcT('lc.colTelegram', 'Telegram'))}</th>
          <th>${_lcEsc(_lcT('lctab.colRooms', 'ห้อง Telegram ที่สั่งได้'))}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="lc-dim">${_lcEsc(_lcT('lc.noOps', 'ยังไม่มีใครสั่งได้ — ระบบยังไม่ตอบคำสั่งจากใครทั้งสิ้น'))}</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

async function lctOpRoomsSave(el) {
  const id = el.dataset.id;
  const sel = document.querySelector(`select[data-tgrooms-id="${CSS.escape(id)}"]`);
  const telegram_allow_in = sel ? [...sel.selectedOptions].map((o) => o.value) : [];
  try {
    const r = await fetch(`${API}/api/line/operators/${encodeURIComponent(id)}/telegram-allow-in`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegram_allow_in }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    await loadTgCommands();
  } catch (e) { alert(e.message); }
}

function lctGoToLineOps() { switchAlertTab('commands'); }

// ── 2. คำสั่ง (มองจากฝั่ง Telegram) ──────────────────────────────
function _tgcCommandsCard() {
  const rows = (_lcState.tgCommands || []).map((c) => `
    <tr>
      <td><b>${_lcEsc(c.label)}</b><div class="lc-dim">${_lcEsc(c.key)}</div></td>
      <td>${(c.triggers || []).map((t) => `<span class="lc-chip">${_lcEsc(t)}</span>`).join(' ') || '-'}</td>
      <td>${c.action_key
            ? `<span class="lc-chip lc-chip-req">${_lcEsc(_lcT('lc.kindAction', 'ลงมือทำ'))}</span> `
              + _lcEsc((_lcState.actions.find((a) => a.key === c.action_key) || {}).label || c.action_key)
            : _lcEsc((_lcState.sources.find((s) => s.key === c.source_key) || {}).label || c.source_key)}</td>
      <td>${(c.required_slots || []).length
            ? (c.required_slots || []).map((s) => `<span class="lc-chip lc-chip-req">${_lcEsc(_lcSlotName(s))}</span>`).join(' ')
            : `<span class="lc-dim">${_lcEsc(_lcT('lc.none', 'ไม่บังคับ'))}</span>`}</td>
      <td class="lc-col-opt">${c.used_30d || 0}</td>
      <td style="text-align:end;white-space:nowrap">
        <label class="lc-slot" style="display:inline-flex;margin-inline-end:6px">
          <input type="checkbox" data-change="lctCmdTgToggle" data-id="${c.id}" ${c.telegram_enabled !== false ? 'checked' : ''}>
          <span>${_lcEsc(_lcT('lctab.enableOnTg', 'เปิดบน Telegram'))}</span>
        </label>
        <button class="btn btn-secondary lc-btn" data-action="lctCmdEdit" data-id="${c.id}">${_lcEsc(_lcT('common.edit', 'แก้ไข'))}</button>
      </td>
    </tr>`).join('');

  return `
  <div class="set-card" style="margin-bottom:14px">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lc.cmdTitle', 'คำสั่ง'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lctab.cmdNote', 'ปิด "เปิดบน Telegram" = คำสั่งนี้ไม่มีตัวตนบน Telegram เลย (ยังทำงานบน LINE ตามเดิม) · แก้คำเรียก/ช่องที่บังคับ ทำที่หน้า "คำสั่งผ่าน LINE"'))}</div>
    </div></div>
    <div class="lc-table-wrap">
      <table class="lc-table">
        <thead><tr>
          <th>${_lcEsc(_lcT('lc.colCmd', 'คำสั่ง'))}</th>
          <th>${_lcEsc(_lcT('lc.colTriggers', 'คำเรียก'))}</th>
          <th>${_lcEsc(_lcT('lc.colSource', 'แหล่งข้อมูล'))}</th>
          <th>${_lcEsc(_lcT('lc.colRequired', 'ช่องที่บังคับ'))}</th>
          <th class="lc-col-opt">${_lcEsc(_lcT('lc.col30d', 'ใช้ 30 วัน'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

async function lctCmdTgToggle(el) {
  await fetch(`${API}/api/line/commands/${el.dataset.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_enabled: el.checked }),
  });
  await loadTgCommands();
}

// เปิดตัวแก้ไขตัวเดียวกับหน้า LINE (ทะเบียนเดียวกัน) — สลับไปหน้านั้นแล้วเปิดฟอร์มให้เลย
// ⚠️ ห้าม await loadLineCommands() เองที่นี่ซ้ำ — switchAlertTab('commands') ยิง
// loadLineCommands() ของตัวเองอยู่แล้วแบบไม่ await (fire-and-forget); ถ้าเรียกซ้ำสอง
// รอบ รอบไหนที่ resolve "หลัง" จะ render ทับตัวแก้ไขที่เพิ่งเปิดไปจนหายไปเงียบๆ
// (race) ⇒ ฝาก id ไว้ใน _lcState แล้วให้ _lcRender() เป็นคนเปิดเองครั้งเดียวหลัง
// render เสร็จจริง
function lctCmdEdit(el) {
  _lcState.pendingEditId = el.dataset.id;
  switchAlertTab('commands');
}

// ── 3. ปูมการใช้งาน (เฉพาะ Telegram) ─────────────────────────────
function _tgcLogCard() {
  return `
  <div class="set-card">
    <div class="set-card-head"><div>
      <div class="set-card-title">${_lcEsc(_lcT('lc.logTitle', 'บันทึกการใช้งาน'))}</div>
      <div class="set-card-sub">${_lcEsc(_lcT('lctab.logNote', 'เฉพาะการใช้งานผ่าน Telegram เท่านั้น'))}</div>
    </div></div>
    <div class="lc-table-wrap" id="tgLogWrap"></div>
  </div>`;
}

async function loadTgCommandLog() {
  const wrap = document.getElementById('tgLogWrap');
  if (!wrap) return;
  try {
    const rows = await fetch(`${API}/api/line/command-log?limit=60&source_type=telegram`).then((r) => r.json());
    wrap.innerHTML = `
      <table class="lc-table">
        <thead><tr>
          <th>${_lcEsc(_lcT('lc.colTime', 'เวลา'))}</th>
          <th>${_lcEsc(_lcT('lc.colWho', 'ผู้สั่ง'))}</th>
          <th>${_lcEsc(_lcT('lc.colText', 'ข้อความ'))}</th>
          <th>${_lcEsc(_lcT('lc.colMatched', 'จับได้'))}</th>
          <th>${_lcEsc(_lcT('lc.colStatus', 'ผล'))}</th>
          <th>ms</th>
        </tr></thead>
        <tbody>${(rows || []).map((r) => `
          <tr>
            <td class="lc-dim">${_lcEsc(new Date(r.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }))}</td>
            <td>${_lcEsc(r.operator_name || '-')}</td>
            <td>${_lcEsc(r.text_in || '')}</td>
            <td>${_lcEsc(r.matched_key || '-')}</td>
            <td><span class="lc-st lc-st-${_lcEsc(r.status)}">${_lcEsc(_LC_STATUS[r.status] || r.status)}</span></td>
            <td class="lc-dim">${r.ms ?? ''}</td>
          </tr>`).join('') || `<tr><td colspan="6" class="lc-dim">${_lcEsc(_lcT('lc.noLog', 'ยังไม่มีการใช้งาน'))}</td></tr>`}
        </tbody>
      </table>`;
  } catch { wrap.innerHTML = ''; }
}
