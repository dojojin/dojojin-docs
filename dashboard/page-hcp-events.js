// ============================================================
// Vigil Platform — HC5 · เหตุการณ์จาก HCP (ยกเว้น LPR / ใบหน้า)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เหตุการณ์ที่ HikCentral ตรวจได้จากกล้องทั้ง 756 ตัวของภูเก็ต — รวมกล้องที่ระบบเรา
// ไม่ได้ต่อด้วย · หน้านี้จึงเป็นทางเดียวที่จะเห็นของฝั่งนั้น
//
// LPR และใบหน้าถูกตัดออกโดยตั้งใจ (มีทางเดินของตัวเองแล้ว) และ **หน้าจอต้องบอก
// ขอบเขตที่ค้นเสมอ** — ผลว่างเพราะ "ไม่มีเหตุการณ์" กับเพราะ "ไม่ได้ค้นตรงนั้น"
// อ่านเหมือนกันบนจอ แต่คนละเรื่องกันสิ้นเชิงเวลามีคดี
//
// ขอบเขต: HKT เท่านั้น
// ============================================================
'use strict';

const _heT = (k, d) => (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, d) : d;
const _heEsc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);

let _heBusy = false;

function heInit() {
  const el = document.getElementById('heBody');
  if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  const back = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="hfs-grid">
      <div>
        <label class="form-label" for="heFrom">${_heEsc(_heT('hfs.from', 'ตั้งแต่'))}</label>
        <input class="form-input" type="date" id="heFrom" value="${back}">
      </div>
      <div>
        <label class="form-label" for="heTo">${_heEsc(_heT('hfs.to', 'ถึง'))}</label>
        <input class="form-input" type="date" id="heTo" value="${today}">
      </div>
    </div>
    <div class="hfs-hint">${_heEsc(_heT('he.hint',
      'ตัดหมวดป้ายทะเบียน (130/131) และใบหน้า (49697) ออก เพราะสองอย่างนั้นมีทางเดินของตัวเองอยู่แล้ว'))}</div>
    <div class="hfs-actions">
      <button class="btn btn-primary" data-action="heLoad" id="heBtn">${_heEsc(_heT('he.load', 'ดึงเหตุการณ์'))}</button>
    </div>
    <div id="heResult"></div>`;
  heLoad();
}

async function heLoad() {
  const out = document.getElementById('heResult');
  if (!out || _heBusy) return;
  const v = (id) => document.getElementById(id)?.value;
  if (v('heTo') < v('heFrom')) {
    out.innerHTML = `<div class="hfs-warn">${_heEsc(_heT('hfs.errRange', 'วันที่ "ถึง" ต้องไม่อยู่ก่อนวันที่ "ตั้งแต่"'))}</div>`;
    return;
  }
  _heBusy = true;
  const btn = document.getElementById('heBtn');
  if (btn) btn.disabled = true;
  out.innerHTML = `<div class="hfs-hint">${_heEsc(_heT('he.loading', 'กำลังถาม HCP…'))}</div>`;
  try {
    const q = new URLSearchParams({ since: `${v('heFrom')}T00:00:00+07:00`, until: `${v('heTo')}T23:59:59+07:00` });
    const r = await fetch(`${API}/api/hcp/events?${q}`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) { out.innerHTML = `<div class="hfs-warn">${_heEsc(j.error || `HTTP ${r.status}`)}</div>`; return; }
    heRender(j);
  } catch (e) {
    out.innerHTML = `<div class="hfs-warn">${_heEsc(e.message)}</div>`;
  } finally {
    _heBusy = false;
    if (btn) btn.disabled = false;
  }
}

// ชื่อไทยของชนิดที่พบจริงที่ภูเก็ต — ชื่ออังกฤษมาจากคู่มือ HCP (ภาคผนวก A.4) ผ่าน edge
const _HE_TH = { 131591: 'จอดรถ', 131672: 'ความหนาแน่นของผู้คน', 131677: 'การปะทะกันทางกายภาพ' };

const _hePicHtml = (src) => `<a href="${_heEsc(src)}" target="_blank" rel="noopener"><img class="he-thumb" loading="lazy" src="${_heEsc(src)}" alt=""></a>`;
function heShowPic(el) {
  const td = el && el.parentElement;
  if (td && el.dataset.src) td.innerHTML = _hePicHtml(el.dataset.src);
}

function heRender(j) {
  const th = !(typeof I18N !== 'undefined' && I18N.getLang && I18N.getLang() === 'en');
  const typeLabel = (t) => {
    const n = (j.type_names || {})[t];
    if (!n) return t;
    return `${n}${th && _HE_TH[t] ? ' · ' + _HE_TH[t] : ''} (${t})`;
  };
  const s = j.scope || {};
  const scope = `${_heEsc(_heT('hfs.scope', 'ค้นแล้ว'))} ${s.cameras} ${_heEsc(_heT('hfs.cameras', 'กล้อง'))}`
    + ` · ${s.types} ${_heEsc(_heT('he.types', 'ชนิดเหตุการณ์'))}`
    + ` · ${s.calls} ${_heEsc(_heT('hfs.calls', 'คำขอ'))}`
    + (s.failed_calls ? ` · <span class="hfs-bad">${s.failed_calls} ${_heEsc(_heT('hfs.failed', 'ล้มเหลว'))}</span>` : '');

  const rows = j.rows || [];
  if (!rows.length) {
    document.getElementById('heResult').innerHTML =
      `<div class="hfs-hint">${scope}</div>`
      + `<div class="hfs-warn">${_heEsc(_heT('he.none',
          'ไม่พบเหตุการณ์ในขอบเขตที่ค้นด้านบน (หมวดป้ายทะเบียนและใบหน้าถูกตัดออกตามที่ระบุ)'))}</div>`;
    return;
  }
  // คอลัมน์รายละเอียดมีเฉพาะเมื่อมีแถวที่ HCP กรอกจริง — HCP ของภูเก็ตส่งมาว่างทุกแถว
  const hasDesc = rows.some((x) => x.description);
  const pic = (u) => `${API}/api/hcp/picture?u=${encodeURIComponent(u)}`;
  // รูปเป็นภาพเต็ม ~0.9 MB ต่อใบ — โหลดเฉพาะแถวแรก ๆ ที่เห็นบนจอ ที่เหลือกดดูทีละใบ
  const AUTO_PICS = 20;
  const body = rows.map((x, i) => `<tr>
      <td>${_heEsc(x.start_time || '')}</td>
      <td>${_heEsc(typeLabel(x.type))}</td>
      <td>${x.camera_id ? _heEsc(x.src_name || x.camera_id)
        : `${_heEsc(x.src_name || x.src_index)} <span class="hcpdev-table dim">${_heEsc(_heT('hlth.hcpOnlyTag', 'HCP เท่านั้น'))}</span>`}</td>
      <td>${!x.pic_uri ? '' : i < AUTO_PICS ? _hePicHtml(pic(x.pic_uri))
        : `<button class="btn btn-sm" data-action="heShowPic" data-src="${_heEsc(pic(x.pic_uri))}">${_heEsc(_heT('he.showPic', 'ดูรูป'))}</button>`}</td>
      ${hasDesc ? `<td>${_heEsc(x.description || '')}</td>` : ''}
    </tr>`).join('');
  const chips = Object.entries(j.by_type || {}).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="he-chip">${_heEsc(typeLabel(t))} <b>${n}</b></span>`).join('');
  const shown = rows.length < j.total
    ? ` · ${_heEsc(_heT('he.shown', 'แสดง'))} ${rows.length}/${j.total}` : '';
  const cut = j.truncated
    ? `<div class="hfs-warn">${_heEsc(_heT('he.truncated', 'มีมากกว่าที่ดึงมา — เหตุการณ์เก่าสุดบางส่วนไม่ถูกรวม ลองย่นช่วงวันที่'))}</div>` : '';
  document.getElementById('heResult').innerHTML = `
    <div class="hfs-hint">${scope} · ${_heEsc(_heT('he.found', 'พบ'))} ${j.total}${shown}
      · ${_heEsc(_heT('he.ours', 'จากกล้องที่เราดูแล'))} ${j.ours}</div>
    ${cut}<div class="he-chips">${chips}</div>
    <div class="hcpdev-tablewrap"><table class="hcpdev-table">
      <thead><tr>
        <th>${_heEsc(_heT('hfs.time', 'เวลา'))}</th>
        <th>${_heEsc(_heT('he.type', 'ชนิด'))}</th>
        <th>${_heEsc(_heT('hfs.camera', 'กล้อง'))}</th>
        <th>${_heEsc(_heT('he.pic', 'รูป'))}</th>
        ${hasDesc ? `<th>${_heEsc(_heT('he.desc', 'รายละเอียด'))}</th>` : ''}
      </tr></thead><tbody>${body}</tbody>
    </table></div>`;
}
