// ============================================================
// Vigil Platform — Blacklist Import Settings (LIVE DEMO)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Instance-based CRUD (add/edit connection) — same shape as camera settings
// (dashboard/page-camera-settings.js): a TYPE defines capability ceiling
// (which data types it can ever support + which are actually wired to a real
// backend call); a CONNECTION is one configured instance of a type (so the
// same type — e.g. Dahua DSS Pro — can appear more than once, one per site).
// Connections live in memory only for this demo — nothing persists (the
// blacklist.* schema in the design spec has not been built yet), so a reload
// resets this list back to the seed below.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const ICONS = {
    server: '<path d="M4 4h16v6H4z"/><path d="M4 14h16v6H4z"/><circle cx="7" cy="7" r=".6"/><circle cx="7" cy="17" r=".6"/>',
    cloud:  '<path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5 5 0 0 1 16.9 8.02 4 4 0 0 1 16.5 16H7z"/>',
    plate:  '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h10"/>',
    globe:  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    csv:    '<path d="M6 2h9l5 5v15H6z"/><path d="M9 13h1.5M9 16h1.5M13.5 13H15M13.5 16H15"/>',
    edit:   '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    nvr:    '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  };

  const TYPE_LABEL = { face: 'Face', lpr: 'LPR' };

  // types[] = every data type this system COULD ever handle (badges shown always).
  // wiredTypes[] = subset that actually calls a real backend probe right now —
  // the rest render as "ยังไม่เชื่อมต่อจริง" even if selected on an instance.
  const TYPES = [
    {
      id: 'dss_pro', name: 'Dahua DSS Pro', icon: 'server', types: ['face'], wiredTypes: ['face'],
      desc: 'ระบบ VMS กลางที่ provision ค่าลง NVR หลายจุด — มีเลขบัตร/passport เก็บจริง (ต่างจาก NVR ปลายทางที่มักไม่มี)',
      fields: [
        { key: 'host', label: 'Host / IP', type: 'text', placeholder: '172.17.60.121' },
        { key: 'port', label: 'Port', type: 'text', placeholder: '443', col: 'sm' },
        { key: 'username', label: 'Username', type: 'text', placeholder: '' },
        { key: 'password', label: 'Password', type: 'password', placeholder: '' },
      ],
    },
    {
      id: 'hcp', name: 'HikCentral Professional', icon: 'cloud', types: ['face', 'lpr'], wiredTypes: [],
      desc: 'ดึง crossRecords (LPR) / faceMatchRecord (Face) ผ่าน Artemis OpenAPI (AK/SK HMAC) — ดู sibling spec 2026-06-23',
    },
    {
      id: 'gurusquare', name: 'GuruSquare', icon: 'plate', types: ['lpr'], wiredTypes: ['lpr'],
      desc: 'นำเข้า/ส่งออกเฉพาะ LPR Blacklist — ส่งออก (push-back) ยัง gate ไว้ตาม spec §6.1',
      fields: [
        { key: 'host', label: 'Host / IP', type: 'text', placeholder: '172.17.22.101' },
        { key: 'port', label: 'Port', type: 'text', placeholder: '13000', col: 'sm' },
        { key: 'apiKey', label: 'X-API-Key', type: 'password', placeholder: '' },
      ],
    },
    {
      id: 'openapi', name: 'OpenAPI มาตรฐาน', icon: 'globe', types: ['face', 'lpr'], wiredTypes: [],
      desc: 'สำหรับระบบภายนอกที่มี OpenAPI ของตัวเอง — กำหนด endpoint/auth เองได้',
    },
    {
      id: 'csv', name: 'นำเข้าแบบ CSV', icon: 'csv', types: ['face', 'lpr'], wiredTypes: [],
      desc: 'อัปโหลดไฟล์ CSV (ข้อความล้วน ไม่มีรูป) — เหมาะกับ source ที่ไม่มี API',
    },
    {
      id: 'manual', name: 'กรอกเอง (Manual)', icon: 'edit', types: ['face', 'lpr'], wiredTypes: [],
      desc: 'เพิ่มรายชื่อ blacklist ทีละคนผ่านฟอร์มในระบบ — สำหรับเคสเดี่ยวๆ ที่ไม่ต้องเชื่อมระบบอื่น',
    },
    {
      id: 'dahua_nvr', name: 'Dahua NVR/กล้อง (โดยตรง)', icon: 'nvr', types: ['face', 'lpr'], wiredTypes: ['face', 'lpr'],
      desc: 'ดึงตรงจาก IP อุปกรณ์ Dahua ทีละตัว (CGI protocol เดียวกันทั้ง NVR กล่องจริงและกล้องเดี่ยว) — Face ผ่าน faceRecognitionServer.cgi (ยืนยันกับ NVR จริง 172.17.22.10), LPR ผ่าน recordFinder.cgi/TrafficBlackList (ยืนยันกับกล้อง ANPR หัวเดี่ยว 172.17.22.180 — ไม่มี NVR คั่นกลาง) — ⚠️ Face กับ LPR มักเป็นคนละอุปกรณ์/IP กันจริงในสนาม 1 connection ตอนนี้รองรับแค่ 1 host เดียว',
      fields: [
        { key: 'host', label: 'Host / IP', type: 'text', placeholder: '172.17.22.10' },
        { key: 'port', label: 'Port', type: 'text', placeholder: '80', col: 'sm' },
        { key: 'username', label: 'Username', type: 'text', placeholder: '' },
        { key: 'password', label: 'Password', type: 'password', placeholder: '' },
      ],
    },
    {
      id: 'hikvision_nvr', name: 'Hikvision NVR (โดยตรง)', icon: 'nvr', types: ['face', 'lpr'], wiredTypes: [],
      desc: 'ดึงตรงจากกล้อง/NVR Hikvision ผ่าน ISAPI — ออกแบบ UI ไว้ก่อน รอ endpoint/สิทธิ์เข้าถึงจริงค่อยเชื่อมต่อ',
    },
  ];
  const typeById = (id) => TYPES.find(t => t.id === id);

  // ───────── connection instances (in-memory only — session resets on reload) ─────────
  let CONNECTIONS = [
    { id: 'c1', typeId: 'dss_pro', label: 'DSS Pro — Site HDY', siteCode: 'hdy', enabledTypes: ['face'],
      status: 'configured', config: { host: '172.17.60.121', port: '443', username: 'admin' } },
    { id: 'c2', typeId: 'gurusquare', label: 'GuruSquare — Site HDY', siteCode: 'hdy', enabledTypes: ['lpr'],
      status: 'configured', config: { host: '172.17.22.101', port: '13000' } },
    // Face (HDY-NVR-01, a real multi-channel NVR box) and LPR (hdy-anpr1, a standalone
    // ANPR camera head — no NVR in between) are two DIFFERENT physical devices/IPs in
    // this fleet, so they're seeded as two separate instances, not one mixed one.
    { id: 'c3', typeId: 'dahua_nvr', label: 'Dahua NVR-01 (Face) — Site HDY', siteCode: 'hdy', enabledTypes: ['face'],
      status: 'configured', config: { host: '172.17.22.10', port: '80', username: 'admin' } },
    { id: 'c4', typeId: 'dahua_nvr', label: 'Dahua ANPR กล้อง hdy-anpr1 (LPR) — Site HDY', siteCode: 'hdy', enabledTypes: ['lpr'],
      status: 'configured', config: { host: '172.17.22.180', port: '80', username: 'admin' } },
    // demonstrates the multi-instance case explicitly asked for: same TYPE, second site,
    // not configured yet — proves "DSS Pro @ HDY" and "DSS Pro @ Pattani" can coexist.
    { id: 'c5', typeId: 'dss_pro', label: 'DSS Pro — Site Pattani (PTN)', siteCode: 'ptn', enabledTypes: ['face'],
      status: 'configured', config: {} },
  ];
  let nextConnId = 6;
  let pendingTypeId = null; // set while step-1 type picker is open, for the Add flow

  function iconSvg(name) {
    // width/height attributes (not just CSS) — belt-and-suspenders against
    // compositor/fractional-scale rendering paths that skip the external
    // stylesheet's sizing rule and fall back to the SVG's intrinsic size.
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.server}</svg>`;
  }

  // ───────── list view ─────────
  function statusLabel(c) {
    if (c.status === 'ok') return { cls: 'ok', text: 'ทดสอบล่าสุดสำเร็จ' };
    if (c.status === 'err') return { cls: 'err', text: 'ทดสอบล่าสุดผิดพลาด' };
    return { cls: 'configured', text: 'ยังไม่ทดสอบในเซสชันนี้' };
  }

  function renderConnList() {
    if (!CONNECTIONS.length) {
      $('connList').innerHTML = '<div class="conn-empty">ยังไม่มีการเชื่อมต่อที่ตั้งค่าไว้ — กด "เพิ่มการนำเข้าข้อมูล" เพื่อเริ่ม</div>';
      return;
    }
    $('connList').innerHTML = CONNECTIONS.map(c => {
      const t = typeById(c.typeId);
      const st = statusLabel(c);
      return `
      <div class="conn-row" data-id="${c.id}">
        <div class="conn-row-icon">${iconSvg(t.icon)}</div>
        <div class="conn-row-main">
          <div class="conn-row-name">${c.label}</div>
          <div class="conn-row-sub">${t.name} · Site ${c.siteCode.toUpperCase()} · ${c.enabledTypes.map(dt => TYPE_LABEL[dt]).join(' + ')}</div>
        </div>
        <span class="conn-row-status ${st.cls}">${st.text}</span>
        <div class="conn-row-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${c.id}">แก้ไข</button>
          <button class="btn btn-ghost btn-sm" data-remove="${c.id}">ลบ</button>
        </div>
      </div>`;
    }).join('');
  }

  // ───────── Add modal: step 1 — type picker ─────────
  function openAddModal() {
    pendingTypeId = null;
    $('cfgModalTitle').textContent = 'เพิ่มการนำเข้าข้อมูล — เลือกประเภทแหล่งข้อมูล';
    $('cfgModalBody').innerHTML = `<div class="src2-grid">${TYPES.map(t => `
      <button class="src2-card" data-pick-type="${t.id}" type="button">
        <div class="src2-head">
          <div class="src2-icon">${iconSvg(t.icon)}</div>
          <div>
            <div class="src2-name">${t.name}</div>
            <div class="src2-type-badges">${t.types.map(dt => `<span class="type-badge ${dt}">${TYPE_LABEL[dt]}</span>`).join('')}</div>
          </div>
        </div>
        <div class="src2-desc">${t.desc}</div>
        <span class="src2-status ${t.wiredTypes.length ? 'live' : 'placeholder'}">${t.wiredTypes.length ? 'เชื่อมต่อจริงได้' : 'ออกแบบรอไว้ก่อน'}</span>
      </button>`).join('')}</div>`;
    $('cfgModal').classList.remove('hidden');
  }

  // ───────── Add/Edit modal: step 2 — instance form ─────────
  function fieldHtml(f, prefill) {
    const val = prefill && f.type !== 'password' ? (prefill[f.key] || '') : '';
    return `
      <div class="cfg-row">
        <label>${f.label}</label>
        <input class="form-input" type="${f.type}" id="cfgField_${f.key}" value="${val}" placeholder="${f.type === 'password' && prefill ? 'กรอกใหม่เพื่อทดสอบอีกครั้ง (ไม่ถูกบันทึกไว้)' : (f.placeholder || '')}" autocomplete="off">
      </div>`;
  }

  function openInstanceForm(typeId, existing) {
    const t = typeById(typeId);
    if (!t) return;
    pendingTypeId = typeId;
    $('cfgModalTitle').textContent = (existing ? 'แก้ไข — ' : 'เพิ่ม — ') + t.name;

    const fields = t.fields || [];
    const hostPortFields = fields.filter(f => f.key === 'host' || f.key === 'port');
    const restFields = fields.filter(f => f.key !== 'host' && f.key !== 'port');
    const enabled = existing ? existing.enabledTypes : t.types.slice();

    $('cfgModalBody').innerHTML = `
      <div class="cfg-form">
        ${existing ? '' : '<span class="cfg-back-link" id="cfgBackToTypes">&larr; เปลี่ยนประเภทแหล่งข้อมูล</span>'}
        <div class="cfg-row">
          <label>ชื่อการเชื่อมต่อ</label>
          <input class="form-input" id="cfgField_label" value="${existing ? existing.label : ''}" placeholder="เช่น ${t.name} — Site HDY">
        </div>
        <div class="cfg-row-2col">
          <div class="cfg-row"><label>Site code</label><input class="form-input" id="cfgField_site" value="${existing ? existing.siteCode : ''}" placeholder="hdy"></div>
          <div></div>
        </div>
        <div class="cfg-row">
          <label>ประเภทข้อมูลที่ใช้งานจริงในการเชื่อมต่อนี้</label>
          <div class="cfg-type-toggles">
            ${t.types.map(dt => `<span class="cfg-type-toggle ${enabled.includes(dt) ? 'on' : ''} ${t.wiredTypes.includes(dt) ? '' : 'notwired'}" data-toggle-type="${dt}">${TYPE_LABEL[dt]}${t.wiredTypes.includes(dt) ? '' : ' (รอเชื่อมจริง)'}</span>`).join('')}
          </div>
        </div>
        ${fields.length ? `
          <div class="cfg-row-2col">${hostPortFields.map(f => fieldHtml(f, existing && existing.config)).join('')}</div>
          ${restFields.map(f => fieldHtml(f, existing && existing.config)).join('')}
        ` : `<div class="placeholder-note">แหล่งข้อมูลนี้ยังไม่เชื่อมต่อจริง — บันทึกไว้เป็นรายการที่ตั้งใจจะใช้ รอระบบ/สิทธิ์เข้าถึงจริงก่อน แล้วค่อยกลับมาตั้งค่ารายละเอียดการเชื่อมต่อ</div>`}
        ${t.wiredTypes.length ? '<div><button class="btn btn-secondary" id="cfgTestBtn">ทดสอบการเชื่อมต่อ</button></div><div id="cfgResult"></div>' : ''}
        <div class="cfg-row-2col">
          <button class="btn btn-primary" id="cfgSaveBtn">${existing ? 'บันทึกการแก้ไข' : 'บันทึกการเชื่อมต่อ'}</button>
          <div></div>
        </div>
        <div class="cfg-hint">รายการเชื่อมต่อเก็บไว้ในเบราว์เซอร์เซสชันนี้เท่านั้น (schema ฐานข้อมูล blacklist ยังไม่ถูกสร้าง) — reload หน้าแล้วรายการที่เพิ่ม/แก้ไขจะหายกลับไปเป็นชุดตัวอย่าง</div>
      </div>`;
    $('cfgModal').classList.remove('hidden');

    const backLink = $('cfgBackToTypes');
    if (backLink) backLink.addEventListener('click', openAddModal);

    $('cfgModalBody').querySelectorAll('[data-toggle-type]').forEach(el => {
      el.addEventListener('click', () => {
        const dt = el.dataset.toggleType;
        if (!t.wiredTypes.includes(dt) && !el.classList.contains('on')) { /* still allowed — just stays a placeholder */ }
        el.classList.toggle('on');
      });
    });

    const testBtn = $('cfgTestBtn');
    if (testBtn) testBtn.addEventListener('click', () => runTest(t));

    $('cfgSaveBtn').addEventListener('click', () => saveInstance(t, existing));
  }

  function collectEnabledTypes() {
    return Array.from($('cfgModalBody').querySelectorAll('[data-toggle-type].on')).map(el => el.dataset.toggleType);
  }

  function collectConfig(t) {
    const config = {};
    for (const f of (t.fields || [])) {
      const el = $('cfgField_' + f.key);
      if (el) config[f.key] = el.value.trim();
    }
    return config;
  }

  function saveInstance(t, existing) {
    const label = $('cfgField_label').value.trim() || t.name;
    const siteCode = $('cfgField_site').value.trim() || 'hdy';
    const enabledTypes = collectEnabledTypes();
    const config = collectConfig(t);
    if (existing) {
      Object.assign(existing, { label, siteCode, enabledTypes, config: { ...existing.config, ...config } });
    } else {
      CONNECTIONS.push({ id: 'c' + (nextConnId++), typeId: t.id, label, siteCode, enabledTypes, status: 'configured', config });
    }
    $('cfgModal').classList.add('hidden');
    renderConnList();
  }

  // ───────── test connection (per enabled data type) ─────────
  async function runTest(t) {
    const enabledTypes = collectEnabledTypes();
    const config = collectConfig(t);
    const btn = $('cfgTestBtn');
    btn.disabled = true; btn.textContent = 'กำลังทดสอบ...';
    $('cfgResult').innerHTML = '';
    const siteCode = $('cfgField_site').value.trim() || 'hdy';

    for (const dataType of enabledTypes) {
      if (!t.wiredTypes.includes(dataType)) {
        $('cfgResult').innerHTML += `<div class="cfg-result"><div class="cfg-result-head">${TYPE_LABEL[dataType]}</div><div class="inline-note">ยังไม่เชื่อมต่อจริง — ออกแบบ UI รอไว้ก่อน</div></div>`;
        continue;
      }
      try {
        const r = await fetch('/api/blacklist/sources/test-connection', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: t.id, site_code: siteCode, config, dataType }),
        });
        const j = await r.json();
        renderResult(dataType, j);
      } catch (e) {
        $('cfgResult').innerHTML += `<div class="cfg-result err"><div class="cfg-result-head">${TYPE_LABEL[dataType]} — เชื่อมต่อไม่สำเร็จ</div>${e.message}</div>`;
      }
    }
    btn.disabled = false; btn.textContent = 'ทดสอบการเชื่อมต่อ';
  }

  function renderResult(dataType, j) {
    if (!j.ok) {
      $('cfgResult').innerHTML += `<div class="cfg-result err"><div class="cfg-result-head">${TYPE_LABEL[dataType]} — เชื่อมต่อไม่สำเร็จ</div>${j.error || 'unknown error'}</div>`;
      return;
    }
    let html = `<div class="cfg-result ok"><div class="cfg-result-head">${TYPE_LABEL[j.dataType] || TYPE_LABEL[dataType]} — เชื่อมต่อสำเร็จ</div>`;
    if (j.groups && j.groups.length) {
      html += `<div class="bl-section-label">กลุ่ม/Group ที่พบ <span class="cnt">${j.groups.length}</span></div>`;
      html += j.groups.map(g => `
        <div class="cfg-group-row">
          <span>${g.name}</span>
          <span>${g.personCount.toLocaleString()} คน ${g.isFailed ? '<span class="fail">มีจุด push ไม่สำเร็จ</span>' : ''}</span>
        </div>`).join('');
    }
    if (j.sample && j.sample.length) {
      html += `<div class="bl-section-label" style="margin-top:12px">ตัวอย่างข้อมูล (มาสก์แล้ว) <span class="cnt">${j.sample.length}${j.sampleTotal ? ' / ' + j.sampleTotal.toLocaleString() : ''}</span></div>`;
      html += j.sample.map(rec => `
        <div class="cfg-sample-card">
          ${Object.entries(rec).map(([k, v]) => v ? `<div class="r"><span class="k">${k}</span><span>${v}</span></div>` : '').join('')}
        </div>`).join('');
    } else if (j.sample) {
      html += `<div class="inline-note">ไม่มีตัวอย่างข้อมูลตอนนี้ (0 record — อาจไม่เคย provision blacklist ลงอุปกรณ์นี้)</div>`;
    }
    html += '</div>';
    $('cfgResult').innerHTML += html;
  }

  // ───────── bindings ─────────
  $('btnAddConn').addEventListener('click', openAddModal);
  $('connList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('button[data-edit]');
    if (editBtn) {
      const c = CONNECTIONS.find(x => x.id === editBtn.dataset.edit);
      if (c) openInstanceForm(c.typeId, c);
      return;
    }
    const rmBtn = e.target.closest('button[data-remove]');
    if (rmBtn) {
      if (confirm('ลบการเชื่อมต่อนี้?')) {
        CONNECTIONS = CONNECTIONS.filter(x => x.id !== rmBtn.dataset.remove);
        renderConnList();
      }
    }
  });
  $('cfgModal').addEventListener('click', (e) => {
    const pick = e.target.closest('button[data-pick-type]');
    if (pick) { openInstanceForm(pick.dataset.pickType, null); return; }
    if (e.target.id === 'cfgModal') $('cfgModal').classList.add('hidden');
  });
  $('cfgModalX').addEventListener('click', () => $('cfgModal').classList.add('hidden'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('cfgModal').classList.add('hidden'); });

  renderConnList();
})();
