// ============================================================
// Vigil Platform — HCP Integration gateway page (MOCKUP demo)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// กดได้จริงทุกปุ่ม แต่ทุกอย่างอยู่ในหน่วยความจำ ไม่ยิงเน็ต ไม่บันทึก
//
// ทำไมหน้าตาเหมือน OpenAPI Gateway ของ HikCentral
// คนที่จะมาเชื่อมต่อคือช่างที่ตั้ง HCP เป็นอยู่แล้ว การให้เขาเจอหน้าจอรูปแบบเดียว
// กับที่เขาใช้ทุกวัน (สวิตช์เปิด/ปิด → ตาราง Integration Partner → ปุ่ม + →
// ฟอร์มที่มี Key/Secret/Linked User → ต้นไม้สิทธิ์) แปลว่าไม่ต้องสอนอะไรเลย
// ถ้าเราคิดรูปแบบของเราเองขึ้นมา จะได้หน้าที่ถูกสำหรับเราคนเดียว
//
// ที่ตัดออกตามคำสั่งเจ้าของ: Authenticate API / Dual-Server Deployment —
// เป็นเรื่องภายในของ HCP ไม่ใช่ของเรา
//
// ที่เปลี่ยนจากของเขา: ต้นไม้สิทธิ์ ของเขาเป็น API tree ดิบ ๆ (Physical Resources
// API / Common API / …) ซึ่งช่างเลือกไม่ถูกว่าอันไหนคืออะไร ของเราเป็น
// "ความสามารถ" ที่บอกได้ว่าเอาไปทำอะไร แล้วค่อยแตกว่าแตะ endpoint ไหน
//
// CSP: ไม่มี inline handler — data-action / data-input ทั้งหมด
// ============================================================
'use strict';

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const rnd = (n) => Array.from({ length: n }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 56)]).join('');

  const D = window.HCP_SCOPE || { groups: [] };
  const CAPS = D.groups.flatMap((g) => g.items.map((i) => ({ ...i, groupId: g.id, groupName: g.name, want: g.want })));

  // ── สถานะ (ในหน่วยความจำล้วน) ───────────────────────
  let master = true;
  let partners = [{
    id: 1, name: 'HCP ภูเก็ต (HKT)', key: '38051848', secret: 'gtFtd••••••••••••••',
    user: 'admin', host: '10.0.10.9', port: '8443', period: 'ถาวร', desc: 'เครื่องหลักของภูเก็ต',
    caps: new Set(CAPS.filter((c) => c.want).map((c) => c.id)), added: '2026-08-08',
  }];
  let checked = new Set();
  let editing = null;
  let expanded = false;
  let search = '';
  let nextId = 2;

  // ── หน้ารายการ ──────────────────────────────────────
  function renderTable() {
    const head = ['', 'ชื่อ', 'Key', 'ความสามารถที่อนุญาต', 'ที่อยู่', 'อายุ'];
    $('gwTable').innerHTML = `
      <thead><tr>${head.map((h, i) =>
        `<th${i === 0 ? ' class="gw-cbcol"' : ''}>${i === 0
          ? '<input type="checkbox" data-action="ckall">' : esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${partners.length ? partners.map((p) => `
        <tr${checked.has(p.id) ? ' class="on"' : ''}>
          <td class="gw-cbcol"><input type="checkbox" data-action="ck" data-id="${p.id}"${checked.has(p.id) ? ' checked' : ''}></td>
          <td><button class="gw-link" data-action="edit" data-id="${p.id}">${esc(p.name)}</button></td>
          <td><code>${esc(p.key)}</code></td>
          <td><b>${p.caps.size}</b> / ${CAPS.length}</td>
          <td>${esc(p.host)}:${esc(p.port)}</td>
          <td>${esc(p.period)}</td>
        </tr>`).join('')
        : `<tr><td colspan="6" class="gw-empty">ยังไม่มี — กด “+ เพิ่ม” เพื่อผูก HCP เครื่องแรก</td></tr>`}
      </tbody>`;
    $('gwDel').disabled = checked.size === 0;
  }

  function renderCapsSummary() {
    const rows = CAPS.map((c) => {
      const who = partners.filter((p) => p.caps.has(c.id));
      return `<tr${who.length ? '' : ' class="dim"'}>
        <td><b>${esc(c.rank)}</b> ${esc(c.name)}</td>
        <td>${esc(c.groupName)}</td>
        <td>${who.length ? who.map((p) => `<span class="gw-pill">${esc(p.name)}</span>`).join(' ') : '<span class="gw-off">ไม่มีเครื่องไหนเปิด</span>'}</td>
      </tr>`;
    }).join('');
    $('capsSummary').innerHTML = `
      <p class="hcp-note" style="margin-top:0">ความสามารถไหนถูกเปิดจากเครื่องไหนบ้าง — ไล่ย้อนได้ว่าข้อมูลชิ้นหนึ่งมาจากไหน</p>
      <div class="gw-tablewrap"><table class="gw-table">
        <thead><tr><th>ความสามารถ</th><th>กลุ่ม</th><th>เปิดโดย</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function renderLog() {
    const L = [
      ['2026-08-08 02:50', 'HCP ภูเก็ต (HKT)', 'aiapplication/v1/face/faceMatchRecord', '200', '8 รายการ'],
      ['2026-08-08 02:50', 'HCP ภูเก็ต (HKT)', 'frs/v1/face/groupList', '200', '17 กลุ่ม'],
      ['2026-08-08 02:49', 'HCP ภูเก็ต (HKT)', 'resource/v1/cameras', '200', '756 กล้อง'],
      ['2026-08-08 02:49', 'HCP ภูเก็ต (HKT)', 'eventService/v1/eventRecords/page', '200', '34 เหตุการณ์'],
      ['2026-08-08 02:31', 'HCP ภูเก็ต (HKT)', 'frs/v1/application/captureSearch', '2', 'พารามิเตอร์ไม่ครบ'],
    ];
    $('logBody').innerHTML = `
      <p class="hcp-note" style="margin-top:0">ตัวอย่างจากการทดสอบจริงเมื่อ 2026-08-08 — ของจริงจะเก็บทุกคำขอพร้อมเหตุผลที่ล้ม</p>
      <div class="gw-tablewrap"><table class="gw-table">
        <thead><tr><th>เวลา</th><th>เครื่อง</th><th>เรียกอะไร</th><th>code</th><th>ผล</th></tr></thead>
        <tbody>${L.map(([t, p, e, c, r]) => `<tr>
          <td>${esc(t)}</td><td>${esc(p)}</td><td><code>${esc(e)}</code></td>
          <td><span class="hcp-badge ${c === '200' ? 'ok' : 'warn'}">${esc(c)}</span></td>
          <td>${esc(r)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ── ฟอร์ม ───────────────────────────────────────────
  function field(id, label, val, opt = {}) {
    const req = opt.req ? '<span class="gw-req">*</span>' : '';
    if (opt.type === 'select') {
      return `<div class="gw-field"><label class="gw-flabel">${req}${esc(label)}</label>
        <select class="form-input" id="${id}" data-input="f">${opt.opts.map((o) =>
          `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
        ${opt.hint ? `<div class="gw-fhint">${esc(opt.hint)}</div>` : ''}</div>`;
    }
    if (opt.type === 'gen') {
      return `<div class="gw-field"><label class="gw-flabel">${req}${esc(label)}</label>
        <div class="gw-gen">
          <input class="form-input" id="${id}" value="${esc(val)}" readonly${opt.mask ? ' type="password"' : ''}>
          ${opt.mask ? `<button class="gw-icon" data-action="eye" data-for="${id}" title="แสดง/ซ่อน">👁</button>` : ''}
          <button class="gw-icon" data-action="copy" data-for="${id}" title="คัดลอก">⧉</button>
          <button class="gw-regen" data-action="regen" data-for="${id}">สร้างใหม่</button>
        </div>
        ${opt.hint ? `<div class="gw-fhint">${esc(opt.hint)}</div>` : ''}</div>`;
    }
    if (opt.type === 'area') {
      return `<div class="gw-field"><label class="gw-flabel">${req}${esc(label)}</label>
        <textarea class="form-input" id="${id}" rows="3" data-input="f">${esc(val)}</textarea></div>`;
    }
    return `<div class="gw-field"><label class="gw-flabel">${req}${esc(label)}</label>
      <input class="form-input" id="${id}" value="${esc(val)}" data-input="f"${opt.ph ? ` placeholder="${esc(opt.ph)}"` : ''}>
      ${opt.hint ? `<div class="gw-fhint">${esc(opt.hint)}</div>` : ''}</div>`;
  }

  function renderForm() {
    const p = editing;
    $('formTitle').textContent = p.id ? 'แก้ไข Integration Partner' : 'เพิ่ม Integration Partner';
    $('formBasic').innerHTML = `<div class="gw-fgrid">
      ${field('fName', 'ชื่อ', p.name, { req: true, ph: 'เช่น HCP ภูเก็ต (HKT)' })}
      ${field('fUser', 'ผู้ใช้ที่ผูก', p.user, { req: true, type: 'select', opts: ['admin', 'operator', 'auditor'],
        hint: 'ทุกอย่างที่ดึงเข้ามาจะถูกบันทึกว่าทำในนามผู้ใช้นี้' })}
      ${field('fKey', 'Integration Partner Key', p.key, { req: true, type: 'gen' })}
      ${field('fSecret', 'Integration Partner Secret', p.secretRaw || p.secret, { req: true, type: 'gen', mask: true,
        hint: 'เก็บแบบเข้ารหัส อ่านคืนได้ และทุกครั้งที่กดดูจะถูกบันทึกว่าใครดู' })}
      ${field('fDesc', 'คำอธิบาย', p.desc, { type: 'area' })}
    </div>`;
    $('formMore').innerHTML = `<div class="gw-fgrid">
      ${field('fHost', 'ที่อยู่ HCP', p.host, { req: true, ph: '10.0.10.9' })}
      ${field('fPort', 'พอร์ต', p.port, { req: true, ph: '8443' })}
      ${field('fPeriod', 'อายุ', p.period, { type: 'select', opts: ['ถาวร', '30 วัน', '90 วัน', '180 วัน', '365 วัน'] })}
      ${field('fIp', 'จำกัด IP ต้นทาง', p.ip || '', { ph: 'เว้นว่าง = ไม่จำกัด' })}
    </div>`;
    $('expandBtn').textContent = expanded ? 'ซ่อน ⌃' : 'แสดงเพิ่มเติม ⌄';
    $('formMore').classList.toggle('hidden', !expanded);
    renderTree();
    $('testOut').innerHTML = '';
  }

  function renderTree() {
    const q = search.trim().toLowerCase();
    const hit = (c) => !q || (c.name + ' ' + c.why + ' ' + c.eps.map((e) => e[0]).join(' ')).toLowerCase().includes(q);
    $('capTree').innerHTML = D.groups.map((g) => {
      const items = g.items.filter(hit);
      if (!items.length) return '';
      const allOn = items.every((i) => editing.caps.has(i.id));
      return `
      <div class="gw-node">
        <div class="gw-nodehead">
          <label class="gw-ck"><input type="checkbox" data-action="grp" data-grp="${esc(g.id)}"${allOn ? ' checked' : ''}>
            <b>${esc(g.name)}</b></label>
          <span class="gw-nodesub">${esc(g.sub)}</span>
        </div>
        ${items.map((c) => {
          const on = editing.caps.has(c.id);
          const notReady = c.eps.filter((e) => e[1] !== 'ready').length;
          return `<div class="gw-leaf${on ? ' on' : ''}">
            <label class="gw-ck"><input type="checkbox" data-action="cap" data-id="${esc(c.id)}"${on ? ' checked' : ''}>
              <span class="gw-rank">${esc(c.rank)}</span><span class="gw-leafname">${esc(c.name)}</span></label>
            ${notReady ? `<span class="hcp-badge warn">ยังต้องแกะ ${notReady}</span>` : '<span class="hcp-badge ok">พร้อม</span>'}
            <div class="gw-leafwhy">${esc(c.why)}</div>
            <div class="gw-leafeps">${c.eps.map((e) => `<code>${esc(e[0])}</code>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('') || '<div class="gw-empty">ไม่พบความสามารถที่ตรงกับคำค้น</div>';
  }

  // ── ทดสอบการเชื่อมต่อ (จำลอง) ──────────────────────
  const SAMPLE = {
    facematch: ['ผลเปรียบเทียบใบหน้า', '8 รายการใน 7 วัน · ล่าสุด PT-09-C19 · ความคล้าย 95%'],
    facesearch: ['ค้นด้วยรูป', 'ยังเรียกไม่ได้ — ต้องมี targetModelData'],
    blacklist: ['Blacklist', 'ใบหน้า 17 กลุ่ม (CTL 65 · TCC 51 · KAT 12) · รถ 3 กลุ่ม'],
    devices: ['สถานะอุปกรณ์', 'กล้อง 756 · เครื่องบันทึก 33 · alarm in 1,472 · out 138'],
    events: ['เหตุการณ์', '7 วัน: Parking 46 · Vehicle Matched 34'],
    lprall: ['ป้ายทะเบียนทั้งหมด', 'CHL-05-C19 มี 348,448 แถว'],
    eventsall: ['เหตุการณ์ทั้งหมด', 'endpoint เดียวกับข้อ 5'],
    push: ['ให้ HCP push', 'ยังเรียกไม่ได้ — ต้องมีปลายทางให้ยิงเข้า'],
    video: ['ภาพสด/ย้อนหลัง', 'ยังเรียกไม่ได้ — ต้องระบุ cameraIndexCode'],
    org: ['พื้นที่/บุคคล', 'พื้นที่ 38 · บุคคล 2'],
  };

  function runTest() {
    const btn = $('testBtn');
    btn.disabled = true; btn.textContent = 'กำลังทดสอบ…';
    $('testOut').innerHTML = '<div class="gw-testing">กำลังยืนยันตัวตนและเรียกความสามารถที่ติ๊กไว้…</div>';
    setTimeout(() => {
      const sel = CAPS.filter((c) => editing.caps.has(c.id));
      const ok = sel.filter((c) => c.eps.every((e) => e[1] === 'ready'));
      const bad = sel.filter((c) => c.eps.some((e) => e[1] !== 'ready'));
      $('testOut').innerHTML = `
        <div class="gw-testhead ${bad.length ? 'warn' : 'ok'}">
          <b>${bad.length ? 'เชื่อมต่อได้ แต่บางอย่างยังเรียกไม่ได้' : 'เชื่อมต่อได้ครบ'}</b>
          <span>ยืนยันตัวตนผ่าน · HikCentral Professional V3.0.1 · ตอบใน 0.3 วินาที</span>
        </div>
        ${sel.length ? `<div class="gw-tablewrap"><table class="gw-table">
          <thead><tr><th>ความสามารถ</th><th>ผล</th><th>ตัวอย่างที่ได้</th></tr></thead>
          <tbody>${sel.map((c) => {
            const s = SAMPLE[c.id] || [c.name, '—'];
            const good = c.eps.every((e) => e[1] === 'ready');
            return `<tr><td><b>${esc(c.rank)}</b> ${esc(c.name)}</td>
              <td><span class="hcp-badge ${good ? 'ok' : 'warn'}">${good ? 'ได้ข้อมูล' : 'ยังไม่ได้'}</span></td>
              <td>${esc(s[1])}</td></tr>`;
          }).join('')}</tbody></table></div>`
        : '<div class="gw-empty">ยังไม่ได้ติ๊กความสามารถไหนเลย — ทดสอบได้แค่การยืนยันตัวตน</div>'}
        <div class="hcp-note">ได้ข้อมูล ${ok.length} · ยังไม่ได้ ${bad.length} — mockup ไม่ได้ยิงจริง
          ตัวเลขมาจากการทดสอบกับ HCP ภูเก็ตเมื่อ 2026-08-08</div>`;
      btn.disabled = false; btn.textContent = 'ทดสอบและดึงข้อมูลตัวอย่าง';
    }, 600);
  }

  // ── สลับหน้า ────────────────────────────────────────
  function show(list) {
    $('pgList').classList.toggle('hidden', !list);
    $('pgForm').classList.toggle('hidden', list);
    window.scrollTo(0, 0);
  }

  const ACT = {
    tab(el) {
      document.querySelectorAll('.gw-tab').forEach((t) => t.classList.toggle('active', t === el));
      const t = el.dataset.tab;
      $('paneBasic').classList.toggle('hidden', t !== 'basic');
      $('paneCaps').classList.toggle('hidden', t !== 'caps');
      $('paneLog').classList.toggle('hidden', t !== 'log');
      if (t === 'caps') renderCapsSummary();
      if (t === 'log') renderLog();
    },
    master() {
      master = !master;
      const b = $('gwMaster');
      b.classList.toggle('on', master); b.setAttribute('aria-pressed', String(master));
      $('gwMasterHint').textContent = master
        ? 'เปิดอยู่ — ปิดแล้วทุกการเชื่อมต่อจะหยุดทันทีโดยไม่ต้องลบ'
        : 'ปิดอยู่ — ไม่มีการเรียก HCP เลย แต่การตั้งค่ายังอยู่ครบ';
    },
    ck(el) { el.checked ? checked.add(+el.dataset.id) : checked.delete(+el.dataset.id); renderTable(); },
    ckall(el) { checked = el.checked ? new Set(partners.map((p) => p.id)) : new Set(); renderTable(); },
    del() {
      partners = partners.filter((p) => !checked.has(p.id));
      checked = new Set(); renderTable();
    },
    add() {
      editing = { id: 0, name: '', key: String(10000000 + Math.floor(Math.random() * 89999999)),
        secret: rnd(20), secretRaw: rnd(20), user: 'admin', host: '', port: '8443',
        period: 'ถาวร', desc: '', ip: '', caps: new Set(CAPS.filter((c) => c.want).map((c) => c.id)) };
      expanded = false; search = ''; renderForm(); show(false);
    },
    edit(el) {
      const p = partners.find((x) => x.id === +el.dataset.id);
      editing = { ...p, caps: new Set(p.caps) };
      expanded = false; search = ''; renderForm(); show(false);
    },
    back() { show(true); renderTable(); },
    expand() { expanded = !expanded; renderForm(); },
    eye(el) {
      const i = $(el.dataset.for);
      i.type = i.type === 'password' ? 'text' : 'password';
      el.textContent = i.type === 'password' ? '👁' : '🙈';
    },
    copy(el) {
      const i = $(el.dataset.for);
      try { navigator.clipboard.writeText(i.value); } catch { /* mockup */ }
      const t = el.textContent; el.textContent = '✓';
      setTimeout(() => { el.textContent = t; }, 900);
    },
    regen(el) {
      const i = $(el.dataset.for);
      i.value = el.dataset.for === 'fKey'
        ? String(10000000 + Math.floor(Math.random() * 89999999)) : rnd(20);
    },
    cap(el) {
      el.checked ? editing.caps.add(el.dataset.id) : editing.caps.delete(el.dataset.id);
      renderTree();
    },
    grp(el) {
      const g = D.groups.find((x) => x.id === el.dataset.grp);
      const allOn = g.items.every((i) => editing.caps.has(i.id));
      g.items.forEach((i) => allOn ? editing.caps.delete(i.id) : editing.caps.add(i.id));
      renderTree();
    },
    search(el) { search = el.value; renderTree(); },
    test() { runTest(); },
    save() { commit(); show(true); renderTable(); },
    saveMore() { commit(); ACT.add(); },
  };

  function commit() {
    const v = (id) => ($(id) || {}).value || '';
    const rec = { ...editing, name: v('fName') || 'ไม่ได้ตั้งชื่อ', user: v('fUser'), key: v('fKey'),
      secret: '••••••••••••••••', secretRaw: v('fSecret'), desc: v('fDesc'),
      host: v('fHost') || '—', port: v('fPort') || '8443', period: v('fPeriod'), ip: v('fIp') };
    if (rec.id) partners = partners.map((p) => p.id === rec.id ? rec : p);
    else partners.push({ ...rec, id: nextId++, added: '2026-08-08' });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.type === 'checkbox') return;
    e.preventDefault();
    (ACT[t.dataset.action] || (() => {}))(t);
  });
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-action]');
    if (t) (ACT[t.dataset.action] || (() => {}))(t);
  });
  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-input="search"]');
    if (t) ACT.search(t);
  });

  renderTable();
})();
