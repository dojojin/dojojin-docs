// ============================================================
// Vigil Platform — HCP integration picker (MOCKUP demo)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// โครงหน้า ไม่ต่อหลังบ้าน ไม่บันทึกอะไร
//
// THE ONE DESIGN CLAIM
// รายการมาจาก "คู่มือ" ไม่ใช่จาก "สิ่งที่ไซต์นี้ตอบกลับมา" — ถ้าสร้างรายการจาก
// การ probe ไซต์เดียว วันที่ไปต่อไซต์ที่สองซึ่งมีโมดูลมากกว่า จะต้องกลับมาเขียน
// รายการใหม่ทั้งชุด · ที่นี่ 231 ความสามารถคือทุกอย่างที่ HCP V3.0.1 ทำได้ และ
// ผลทดสอบของไซต์เป็นเพียง "ป้าย" ที่แปะทับ เปลี่ยนไซต์ก็เปลี่ยนแค่ป้าย
//
// สถานะที่เป็นไปได้ (จากการทดสอบ HKT 2026-08-08):
//   ok        ยิงแล้วได้ code 0 ทันที
//   proven    ต้องใส่พารามิเตอร์ แต่ทดสอบด้วยมือแล้วว่าได้ข้อมูลจริง
//   needparam มีอยู่จริง แต่ยังไม่ได้ลองใส่พารามิเตอร์ให้ครบ
//   nolicense ไซต์นี้ตอบ code 8 — license/โมดูลไม่รองรับ
//   signfail  ตอบ code 68 เฉพาะบางโมดูล (Canteen/Education/Video Tracing)
//   write     endpoint ฝั่งเขียน/สั่งการ — จงใจไม่ทดสอบกับระบบจริง
//   other     รหัสอื่น ดูรายละเอียดในบรรทัด
//
// CSP: ไม่มี inline handler — ใช้ data-action ทั้งหมด
// ============================================================
'use strict';

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);

  const ST = {
    ok:        { label: 'ใช้ได้',            tone: 'ok'   },
    proven:    { label: 'ใช้ได้ (ทดสอบแล้ว)', tone: 'ok'   },
    needparam: { label: 'ต้องพารามิเตอร์',    tone: 'warn' },
    write:     { label: 'ฝั่งเขียน',          tone: 'info' },
    nolicense: { label: 'ไซต์นี้ไม่รองรับ',    tone: 'bad'  },
    signfail:  { label: 'โมดูลแยก',           tone: 'bad'  },
    other:     { label: 'ต้องตรวจเพิ่ม',      tone: 'warn' },
    untested:  { label: 'ยังไม่ทดสอบ',        tone: 'info' },
  };
  const USABLE = new Set(['ok', 'proven']);

  // ชุดที่แนะนำ — เลือกจากสิ่งที่ระบบเราใช้ประโยชน์ได้จริงวันนี้ ไม่ใช่ทุกอันที่เขียว
  const RECOMMEND = new Set([
    '/artemis/api/aiapplication/v1/face/faceMatchRecord',
    '/artemis/api/frs/v1/application/picture',
    '/artemis/api/frs/v1/face/groupList',
    '/artemis/api/frs/v1/face',
    '/artemis/api/resource/v1/vehicleGroup/vehicleGroupList',
    '/artemis/api/resource/v1/vehicle/vehicleList',
    '/artemis/api/resource/v1/cameras',
    '/artemis/api/resource/v1/regions',
  ]);

  const DATA = window.HCP_DATA || { themes: [] };
  const ALL = DATA.themes.flatMap((t) => t.items);
  const picked = new Set();
  let filterTheme = 'all';

  // ── การเชื่อมต่อ ────────────────────────────────────
  function renderConn() {
    const rows = [
      ['ที่อยู่', 'https://10.0.10.9:8443/artemis/'],
      ['รุ่น', 'HikCentral Professional V3.0.1.DZP20260313043.0'],
      ['ผู้เชื่อมต่อ', 'vigil-platform (Integration Partner)'],
      ['วิธียืนยันตัวตน', 'AK/SK — HMAC-SHA256 ต่อ request'],
      ['เส้นทาง', 'edge ภูเก็ต → HCP · central เข้าไม่ถึงเครือข่ายนี้'],
    ];
    $('hcpConn').innerHTML = rows.map(([k, v]) =>
      `<div class="hcp-conn-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    $('hcpConnNote').innerHTML =
      'ทุกคำขอต้องออกจาก edge ของไซต์นั้น ๆ — central คุยกับ HCP โดยตรงไม่ได้ ' +
      'เป็นข้อจำกัดของเครือข่าย ไม่ใช่ของ HCP';
  }

  // ── สรุปตัวเลข ──────────────────────────────────────
  function renderKpis() {
    const n = (f) => ALL.filter(f).length;
    const k = [
      ['ความสามารถทั้งหมดในคู่มือ', ALL.length, 'จาก HCP OpenAPI V3.0.1'],
      ['ใช้ได้บนไซต์นี้', n((x) => USABLE.has(x.status)), 'ยิงแล้วได้ข้อมูลจริง'],
      ['ต้องใส่พารามิเตอร์เพิ่ม', n((x) => x.status === 'needparam'), 'มีอยู่ แต่ยังไม่ได้ลองครบ'],
      ['ไซต์นี้ไม่รองรับ', n((x) => x.status === 'nolicense' || x.status === 'signfail'), 'ไซต์อื่นอาจรองรับ'],
      ['เลือกไว้', 0, 'จะถูกเรียกจริง'],
    ];
    $('hcpKpis').innerHTML = k.map(([t, v, s], i) =>
      `<div class="hcp-kpi${i === 4 ? ' hcp-kpi-live' : ''}"${i === 4 ? ' id="hcpKpiPicked"' : ''}>
         <div class="hcp-kpi-v">${v}</div>
         <div class="hcp-kpi-t">${esc(t)}</div>
         <div class="hcp-kpi-s">${esc(s)}</div>
       </div>`).join('');
  }

  function renderFilters() {
    const chips = [['all', 'ทั้งหมด', ALL.length]]
      .concat(DATA.themes.map((t) => [t.id, t.name, t.items.length]));
    $('hcpFilters').innerHTML = chips.map(([id, name, n]) =>
      `<button class="hcp-chip${filterTheme === id ? ' active' : ''}" data-action="theme" data-theme="${esc(id)}">
         ${esc(name)} <b>${n}</b></button>`).join('');
  }

  // ── รายการ ──────────────────────────────────────────
  function renderThemes() {
    const onlyUsable = $('hcpOnlyUsable').checked;
    const html = DATA.themes.filter((t) => filterTheme === 'all' || filterTheme === t.id).map((t) => {
      const items = t.items.filter((x) => !onlyUsable || USABLE.has(x.status));
      if (!items.length) return '';
      const on = items.filter((x) => picked.has(x.path)).length;
      return `
      <div class="card hcp-card hcp-theme">
        <div class="hcp-theme-head">
          <div>
            <h3 class="hcp-h3">${esc(t.name)} <span class="hcp-count">${items.length}</span></h3>
            <div class="hcp-theme-sub">${esc(t.sub)}</div>
          </div>
          <button class="btn btn-secondary hcp-allbtn" data-action="all" data-theme="${esc(t.id)}">
            ${on === items.length ? 'ไม่เอาทั้งหมด' : 'เลือกทั้งหมดที่ใช้ได้'}
          </button>
        </div>
        <div class="hcp-items">
          ${items.map((x) => row(x)).join('')}
        </div>
      </div>`;
    }).join('');
    $('hcpThemes').innerHTML = html || '<div class="card hcp-card hcp-empty">ไม่มีรายการตามตัวกรองนี้</div>';
    renderPlan();
  }

  function row(x) {
    const st = ST[x.status] || ST.untested;
    const sel = picked.has(x.path);
    const can = USABLE.has(x.status);
    return `
      <label class="hcp-item${sel ? ' sel' : ''}${can ? '' : ' dim'}">
        <input type="checkbox" data-action="pick" data-path="${esc(x.path)}"${sel ? ' checked' : ''}>
        <div class="hcp-item-main">
          <div class="hcp-item-t">${esc(x.desc || x.group || x.path)}</div>
          <div class="hcp-item-p"><code>${esc(x.path.replace('/artemis/api/', ''))}</code>
            <span class="hcp-sec">§${esc(x.sec || '')} ${esc(x.secName || '')}</span></div>
          ${x.note ? `<div class="hcp-item-n">${esc(x.note)}</div>` : ''}
        </div>
        <span class="hcp-badge ${st.tone}">${esc(st.label)}</span>
      </label>`;
  }

  // ── แผนที่จะเกิดขึ้น ────────────────────────────────
  function renderPlan() {
    const sel = ALL.filter((x) => picked.has(x.path));
    const kp = $('hcpKpiPicked');
    if (kp) kp.querySelector('.hcp-kpi-v').textContent = sel.length;

    if (!sel.length) {
      $('hcpPlan').innerHTML =
        '<div class="hcp-plan-empty">ยังไม่ได้เลือกอะไร — ระบบจะไม่เรียก HCP เลย</div>';
      return;
    }
    const risky = sel.filter((x) => x.status === 'write');
    const notReady = sel.filter((x) => !USABLE.has(x.status) && x.status !== 'write');
    const rows = [
      ['จะเรียก', `${sel.length} ความสามารถ`, 'ok'],
      ['พร้อมใช้ทันที', `${sel.filter((x) => USABLE.has(x.status)).length} รายการ`, 'ok'],
    ];
    if (notReady.length) rows.push(['ยังต้องหาพารามิเตอร์ก่อน', `${notReady.length} รายการ`, 'warn']);
    if (risky.length) rows.push(['เขียนกลับเข้า HCP', `${risky.length} รายการ — ต้องยืนยันแยก`, 'bad']);

    $('hcpPlan').innerHTML = `
      <div class="hcp-plan">
        ${rows.map(([k, v, tone]) =>
          `<div class="hcp-plan-row ${tone}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      </div>
      ${risky.length ? `<div class="hcp-warnbox">
        <b>มีรายการที่เขียนกลับเข้า HCP</b>
        <span>การเขียนกลับแก้ข้อมูลในระบบของหน่วยงานอื่น — ควรแยกขั้นยืนยันต่างหาก
        ไม่ควรอยู่ในสวิตช์เดียวกับการอ่าน</span>
      </div>` : ''}
      ${notReady.length ? `<div class="hcp-notebox">
        <b>ยังไม่พร้อมทันที</b>
        <span>${esc(notReady.slice(0, 4).map((x) => x.path.replace('/artemis/api/', '')).join(' · '))}${notReady.length > 4 ? ' …' : ''}</span>
      </div>` : ''}`;
  }

  // ── การกระทำ ────────────────────────────────────────
  const ACT = {
    pick(el) { el.checked ? picked.add(el.dataset.path) : picked.delete(el.dataset.path); renderThemes(); },
    theme(el) { filterTheme = el.dataset.theme; renderFilters(); renderThemes(); },
    filter() { renderThemes(); },
    all(el) {
      const t = DATA.themes.find((x) => x.id === el.dataset.theme);
      if (!t) return;
      const can = t.items.filter((x) => USABLE.has(x.status));
      const allOn = can.length && can.every((x) => picked.has(x.path));
      can.forEach((x) => allOn ? picked.delete(x.path) : picked.add(x.path));
      renderThemes();
    },
    none() { picked.clear(); renderThemes(); },
    recommend() {
      picked.clear();
      ALL.forEach((x) => { if (RECOMMEND.has(x.path)) picked.add(x.path); });
      renderThemes();
    },
  };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.type === 'checkbox') return;
    (ACT[t.dataset.action] || (() => {}))(t);
  });
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    (ACT[t.dataset.action] || (() => {}))(t);
  });

  renderConn(); renderKpis(); renderFilters(); renderThemes();
})();
