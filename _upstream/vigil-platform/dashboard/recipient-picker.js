// ============================================================
// Vigil Platform — Component: ตัวเลือกผู้รับสำหรับการส่งทดสอบ / ส่งเอง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เดิมทุกจุดที่ "ส่งทดสอบ / ส่งเอง" ใช้ confirm() ซึ่งบอกรายชื่อผู้รับได้อย่างเดียว
// แก้ไม่ได้ ผลคือทุกครั้งที่อยากดูหน้าตาการ์ด ต้องยิงหาทีมจริงทั้งกลุ่ม
// (เจ้าของขอ 2026-08-27)
//
// ทำไมเป็น component กลาง ไม่ใช่หน้าตั้งค่าแยก: จุดที่กดส่งมี 4 แห่ง (3 แท็บช่องทาง
// + ปุ่มในหน้า Face Matches) หน้าแยกจะต้อง sync สถานะช่องทาง/ผู้รับสองที่ แล้ว
// เพี้ยนกันเองแน่ · และปุ่มในหน้า Face Matches ก็ยังต้องมีตัวเลือกของตัวเองอยู่ดี
//
// โหลดก่อน page-alerts.js และ page-face-matches.js ใน index.html
// ============================================================
'use strict';

(function () {
  const T = (k, d) => (window.I18N && I18N.t ? I18N.t(k, d) : d);
  const esc = (s) => String(s ?? '').replace(/[<&>"]/g, (c) =>
    ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));

  let _el = null;
  // 🔴 ต้องเก็บ resolver ไว้ด้วย — ปิดด้วย Escape แล้วไม่ resolve = ผู้เรียก await
  // ค้างตลอดกาล ปุ่มส่งกดไม่ได้อีกจนกว่าจะรีเฟรชหน้า โดยไม่มี error ให้เห็น
  let _resolve = null;

  function close(value = null) {
    if (_el) { _el.remove(); _el = null; }
    document.removeEventListener('keydown', onKey);
    const fn = _resolve; _resolve = null;
    if (fn) fn(value);
  }
  function onKey(e) { if (e.key === 'Escape') close(null); }

  /**
   * เปิดกล่องเลือกผู้รับ · คืน Promise<string[] | null>
   *   []      = ใช้ผู้รับจริงที่ตั้งไว้ (ไม่ override)
   *   [ids]   = ส่งเฉพาะคนที่เลือก
   *   null    = ยกเลิก
   *
   * @param title      หัวกล่อง เช่น "ทดสอบส่ง · HCP Face"
   * @param subtitle   บรรทัดอธิบายว่าจะส่งอะไร
   * @param recipients [{ id, name, type }] ผู้รับทั้งหมดที่ระบบรู้จักและเปิดอยู่
   * @param defaultIds id ของผู้รับจริงของช่องทางนี้ (ไว้โชว์จำนวน + ติ๊กให้ตอนเลือกเอง)
   * @param defaultLabel ข้อความของตัวเลือกแรก (LPR ใช้คำต่างเพราะคัดตามไซต์/กลุ่มอีกชั้น)
   */
  function open({ title, subtitle, recipients = [], defaultIds = [], defaultLabel = null }) {
    close();
    return new Promise((resolve) => {
      _resolve = resolve;
      const list = recipients.filter((r) => r && r.enabled !== false);
      const defSet = new Set((defaultIds || []).map(String));

      _el = document.createElement('div');
      _el.className = 'rcp-wrap';
      _el.innerHTML = `
        <div class="rcp-overlay" data-rcp="cancel"></div>
        <div class="rcp-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="rcp-head">
            <div class="rcp-title">${esc(title)}</div>
            <button class="rcp-x" data-rcp="cancel" aria-label="${esc(T('common.close', 'ปิด'))}">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
          ${subtitle ? `<div class="rcp-sub">${esc(subtitle)}</div>` : ''}
          <div class="rcp-body">
            <label class="rcp-mode">
              <input type="radio" name="rcpMode" value="default" checked>
              <span>${esc(defaultLabel
                || T('rcp.useConfigured', 'ผู้รับจริงของช่องทางนี้')
                   + ` (${defSet.size} ${T('rcp.people', 'คน')})`)}</span>
            </label>
            <label class="rcp-mode">
              <input type="radio" name="rcpMode" value="custom">
              <span>${esc(T('rcp.pickOwn', 'เลือกเอง'))}</span>
            </label>
            <div class="rcp-list" id="rcpList" hidden>
              ${list.length ? list.map((r) => `
                <label class="rcp-item">
                  <input type="checkbox" class="rcpPick" value="${esc(r.id)}"
                         ${defSet.has(String(r.id)) ? 'checked' : ''}>
                  <span class="rcp-kind">${esc((r.type || 'user').toUpperCase())}</span>
                  <span class="rcp-name">${esc(r.name || r.id)}</span>
                </label>`).join('')
              : `<div class="rcp-empty">${esc(T('rcp.none', 'ยังไม่มีผู้รับในระบบ'))}</div>`}
            </div>
          </div>
          <div class="rcp-foot">
            <button class="btn btn-secondary" data-rcp="cancel">${esc(T('common.cancel', 'ยกเลิก'))}</button>
            <button class="btn btn-primary" data-rcp="send" id="rcpSend">${esc(T('rcp.send', 'ส่ง'))}</button>
          </div>
        </div>`;
      document.body.appendChild(_el);

      const listEl = _el.querySelector('#rcpList');
      const sendEl = _el.querySelector('#rcpSend');
      const picked = () => [..._el.querySelectorAll('.rcpPick:checked')].map((c) => c.value);
      const isCustom = () => _el.querySelector('input[name="rcpMode"][value="custom"]').checked;

      // ปุ่มส่งต้องปิดเมื่อ "เลือกเอง" แล้วไม่ได้ติ๊กใคร — ไม่งั้นจะยิงคำขอไปให้
      // เซิร์ฟเวอร์ตอบ error กลับมา ทั้งที่หน้าจอรู้อยู่แล้วว่าไม่ได้เลือกใคร
      const sync = () => {
        listEl.hidden = !isCustom();
        sendEl.disabled = isCustom() && picked().length === 0;
      };

      _el.addEventListener('change', sync);
      sync();

      _el.addEventListener('click', (e) => {
        const act = e.target.closest('[data-rcp]')?.dataset.rcp;
        if (act === 'cancel') close(null);
        if (act === 'send') close(isCustom() ? picked() : []);
      });
      document.addEventListener('keydown', onKey);
    });
  }

  window.RecipientPicker = { open, close };
})();
