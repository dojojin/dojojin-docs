// ============================================================
// Vigil Platform — Manual blacklist entry (MOCKUP demo)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Structure only — no data, no requests, nothing saves. The owner asked for
// "just the headings, what it would be able to do, ready to take real data".
//
// Field names are the real columns so this can be wired without a redesign:
//   blacklist.master          display_name, photo_path, id_type, id_country,
//                             id_number_enc, id_hash, plate_hash, status
//   blacklist.source_records  external_id, case_ref, case_note, plate_numbers,
//                             source_id ('manual')
//   lpr_watchlist             plate_number, region, label, notes, group_id,
//                             ref_image, notify_line   ← written by the bridge
//
// The one design claim: a manual entry goes into the identity reservoir first
// and lets the bridge produce the alerting row, exactly like an imported one.
// Today's manual path writes lpr_watchlist directly, which is why it yields a
// plate with no identity, no case and no photo — and why nobody uses it (482
// watchlist rows in production, every one of them origin='blacklist_bridge').
//
// CSP: no inline handlers — delegated off data-action.
// ============================================================
'use strict';

(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);

  // field kinds: text | select | textarea | photo | toggle | plates | note
  const FORMS = {
    face: {
      title: 'เพิ่มบุคคลเข้าบัญชีเฝ้าระวัง',
      groups: [
        {
          name: 'ตัวตน', hint: 'อย่างน้อยต้องมีชื่อหรือภาพใบหน้า', fields: [
            { k: 'display_name', label: 'ชื่อ-สกุล', kind: 'text', req: true, col: 'master.display_name' },
            { k: 'photo', label: 'ภาพใบหน้าอ้างอิง', kind: 'photo', req: true, col: 'master.photo_path',
              hint: 'ใช้เป็นภาพตั้งต้นสำหรับการจับคู่ในอนาคต' },
            { k: 'id_type', label: 'ชนิดเอกสาร', kind: 'select', col: 'master.id_type',
              opts: ['ไม่ระบุ', 'บัตรประชาชน', 'พาสปอร์ต'] },
            { k: 'id_country', label: 'ประเทศที่ออกเอกสาร', kind: 'select', col: 'master.id_country',
              opts: ['ไทย', 'อื่น ๆ'], hint: 'บังคับกรอกเมื่อเลือกพาสปอร์ต' },
            { k: 'id_number', label: 'เลขเอกสาร', kind: 'text', pii: true, col: 'master.id_number_enc + id_hash',
              hint: 'เก็บแบบเข้ารหัส และแยกทำคีย์จับคู่ที่ย้อนกลับไม่ได้' },
          ],
        },
        {
          name: 'คดี', hint: 'ผูกกับเรื่องที่ทำให้ต้องเฝ้าระวัง', fields: [
            { k: 'case_ref', label: 'เลขคดี / เลขอ้างอิง', kind: 'text', pii: true, col: 'source_records.case_ref' },
            { k: 'case_note', label: 'หมายเหตุคดี', kind: 'textarea', pii: true, col: 'source_records.case_note',
              hint: 'เช่น ข้อควรระวังก่อนเข้าตรวจค้น' },
            { k: 'owner_unit', label: 'หน่วยงานเจ้าของเรื่อง', kind: 'text', col: 'source_records.raw_json' },
          ],
        },
        {
          name: 'ป้ายทะเบียนที่เกี่ยวข้อง', hint: 'ไม่บังคับ — ใส่ได้หลายป้ายต่อหนึ่งคน', fields: [
            { k: 'plates', label: 'เลขทะเบียน', kind: 'plates', col: 'source_records.plate_numbers' },
          ],
        },
        {
          name: 'สถานะ', fields: [
            { k: 'status', label: 'เปิดใช้งานทันที', kind: 'toggle', on: true, col: 'master.status' },
          ],
        },
      ],
    },
    lpr: {
      title: 'เพิ่มป้ายทะเบียนเข้าบัญชีเฝ้าระวัง',
      groups: [
        {
          name: 'ป้ายทะเบียน', fields: [
            { k: 'plate_number', label: 'เลขทะเบียน', kind: 'text', req: true, col: 'lpr_watchlist.plate_number',
              hint: 'ระบบจะแปลงเป็นรูปแบบมาตรฐานก่อนบันทึก และกันซ้ำให้' },
            { k: 'region', label: 'จังหวัด', kind: 'select', col: 'lpr_watchlist.region',
              opts: ['ไม่ระบุ', 'กรุงเทพมหานคร', 'ภูเก็ต', 'สงขลา', '— ครบ 77 จังหวัด —'] },
            { k: 'ref_image', label: 'ภาพอ้างอิง', kind: 'photo', col: 'lpr_watchlist.ref_image' },
          ],
        },
        {
          name: 'ผูกกับตัวตน', hint: 'ทำให้ป้ายนี้ไปอยู่กับคนคนเดียวกับที่เพิ่มไว้ในแท็บใบหน้า', fields: [
            { k: 'link_person', label: 'ค้นหาบุคคลที่มีอยู่แล้ว', kind: 'text', col: 'master_links',
              hint: 'เว้นว่างได้ — จะสร้างเป็นตัวตนใหม่ที่มีแต่ป้ายทะเบียน' },
          ],
        },
        {
          name: 'คดี', fields: [
            { k: 'case_ref', label: 'เลขคดี / เลขอ้างอิง', kind: 'text', pii: true, col: 'source_records.case_ref' },
            { k: 'label', label: 'ป้ายกำกับที่จะขึ้นตอนแจ้งเตือน', kind: 'text', col: 'lpr_watchlist.label',
              hint: 'เช่น “หมายจับ” — ข้อความนี้จะไปโผล่บนการ์ดแจ้งเตือน' },
            { k: 'notes', label: 'หมายเหตุ', kind: 'textarea', pii: true, col: 'lpr_watchlist.notes' },
          ],
        },
        {
          name: 'การแจ้งเตือน', fields: [
            { k: 'group_id', label: 'กลุ่มเฝ้าระวัง', kind: 'select', col: 'lpr_watchlist.group_id',
              opts: ['ไม่ระบุ', '— ดึงจากกลุ่มที่มีอยู่ —'],
              hint: 'กลุ่มเป็นตัวกำหนดรูปแบบการแจ้งเตือน ไม่ได้เลือกทีละป้าย' },
            { k: 'notify_line', label: 'แจ้งเตือนเข้า LINE', kind: 'toggle', on: true, col: 'lpr_watchlist.notify_line' },
            { k: 'status', label: 'เปิดใช้งานทันที', kind: 'toggle', on: true, col: 'lpr_watchlist.active' },
          ],
        },
      ],
    },
  };

  const FLOW = {
    face: [
      { t: 'ฟอร์มนี้', s: 'ผู้ใช้กรอก' },
      { t: 'blacklist.source_records', s: "source_id = 'manual' · external_id ที่ระบบออกให้", tag: 'กระจกของแหล่ง' },
      { t: 'blacklist.master', s: 'ตัวตนกลาง — กันซ้ำด้วย id_hash', tag: 'ตัวตน' },
      { t: '(ยังไม่มีปลายทาง)', s: 'ใบหน้ายังจับคู่กับกล้องไม่ได้', tag: 'ตัน', dead: true },
    ],
    lpr: [
      { t: 'ฟอร์มนี้', s: 'ผู้ใช้กรอก' },
      { t: 'blacklist.source_records', s: "source_id = 'manual' · plate_numbers[]", tag: 'กระจกของแหล่ง' },
      { t: 'blacklist.master', s: 'ตัวตนกลาง — กันซ้ำด้วย plate_hash', tag: 'ตัวตน' },
      { t: 'lpr_watchlist', s: "bridge สร้างให้ · origin = 'blacklist_bridge'", tag: 'ตัวที่แจ้งเตือนจริง' },
    ],
  };

  const CAN = {
    face: [
      'กันซ้ำอัตโนมัติ — คนเดิมที่นำเข้ามาแล้วจากแหล่งอื่น จะไม่กลายเป็นสองรายการ',
      'เก็บเลขเอกสารแบบเข้ารหัส และแยกคีย์จับคู่ที่ย้อนกลับไม่ได้',
      'ผูกป้ายทะเบียนหลายป้ายเข้ากับคนคนเดียว',
      'รู้ว่าใครเป็นคนเพิ่มและเพิ่มเมื่อไหร่ (audit) — ของที่นำเข้ามารู้แค่ว่ามาจากแหล่งไหน',
      'ปิดใช้งานได้โดยไม่ต้องลบ — ประวัติยังอยู่',
    ],
    lpr: [
      'แปลงเลขทะเบียนเป็นรูปแบบมาตรฐานก่อนบันทึก และกันซ้ำให้',
      'ผูกป้ายเข้ากับบุคคลที่มีอยู่แล้ว แทนที่จะเป็นป้ายลอย ๆ',
      'ได้โครงเท่ากับรายการที่นำเข้ามา — มีคดี มีตัวตน มีรูป',
      'กลุ่มเฝ้าระวังเป็นตัวกำหนดรูปแบบแจ้งเตือน ไม่ต้องตั้งทีละป้าย',
      'รู้ว่าใครเป็นคนเพิ่ม (audit) และปิดใช้งานได้โดยไม่ต้องลบ',
    ],
  };

  const CANT = {
    face: [
      { t: 'เพิ่มแล้วยังไม่มีอะไรแจ้งเตือน', s: 'ต้อง enroll ใบหน้าเข้า FDLib ของกล้องก่อน ซึ่งระบบยังทำไม่ได้ (spec §6.2) — เก็บเป็นฐานข้อมูลได้ แต่ยังไม่จับคู่กับภาพสด' },
      { t: 'ยังไม่ได้ออกแบบสิทธิ์ว่าใครเพิ่มได้', s: 'ข้อมูลคดี + เลขบัตร ไม่ควรให้ทุก role เพิ่มได้ ต้องกำหนดก่อนเปิดใช้' },
    ],
    lpr: [
      { t: 'ยังไม่ได้ออกแบบสิทธิ์ว่าใครเพิ่มได้', s: 'เพิ่มป้ายเข้าบัญชีเฝ้าระวัง = ทำให้เกิดการแจ้งเตือนถึงเจ้าหน้าที่ ต้องกำหนด role ก่อนเปิดใช้' },
      { t: 'ยังไม่มีขั้นตรวจทานก่อนมีผล', s: 'ของที่นำเข้ามามี bridge คั่นอยู่ ถ้าเพิ่มเองแล้วมีผลทันที ควรมีคนสองคนหรือ log ที่ย้อนดูได้' },
    ],
  };

  let mode = 'face';

  const ICON_DOWN = '<svg class="bm-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

  function fieldHtml(f) {
    const req = f.req ? '<span class="bm-req">จำเป็น</span>' : '';
    const pii = f.pii ? '<span class="bm-pii">PDPA</span>' : '';
    const hint = f.hint ? `<div class="bm-hint">${esc(f.hint)}</div>` : '';
    const col = `<span class="bm-col">${esc(f.col)}</span>`;
    let input = '';
    switch (f.kind) {
      case 'textarea': input = '<textarea class="bm-in" rows="2" disabled></textarea>'; break;
      case 'select':
        input = `<select class="bm-in" disabled>${(f.opts || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
        break;
      case 'photo':
        input = '<div class="bm-drop">ลากไฟล์มาวาง หรือกดเพื่อเลือก<span>JPG / PNG</span></div>';
        break;
      case 'toggle':
        input = `<label class="bm-toggle"><input type="checkbox" disabled${f.on ? ' checked' : ''}><span></span></label>`;
        break;
      case 'plates':
        input = '<div class="bm-plates"><input class="bm-in" disabled placeholder="เช่น 1กข 1234">'
              + '<button class="btn btn-sm" disabled>+ เพิ่มป้าย</button></div>';
        break;
      default: input = '<input class="bm-in" disabled>';
    }
    return `<div class="bm-field${f.kind === 'toggle' ? ' is-toggle' : ''}">
      <div class="bm-flabel">${esc(f.label)}${req}${pii}${col}</div>
      ${input}${hint}</div>`;
  }

  function render() {
    const F = FORMS[mode];
    $('bmFormTitle').textContent = F.title;
    $('bmForm').innerHTML = F.groups.map((g) => `
      <section class="bm-group">
        <div class="bm-gname">${esc(g.name)}${g.hint ? `<span>${esc(g.hint)}</span>` : ''}</div>
        <div class="bm-fields">${g.fields.map(fieldHtml).join('')}</div>
      </section>`).join('');

    $('bmFlow').innerHTML = FLOW[mode].map((s, i) => `
      ${i ? ICON_DOWN : ''}
      <div class="bm-step${s.dead ? ' dead' : ''}">
        <div class="bm-stept">${esc(s.t)}${s.tag ? `<span class="bm-steptag">${esc(s.tag)}</span>` : ''}</div>
        <div class="bm-steps">${esc(s.s)}</div>
      </div>`).join('');

    $('bmCan').innerHTML = CAN[mode].map((c) => `<li>${esc(c)}</li>`).join('');
    $('bmCant').innerHTML = CANT[mode].map((c) =>
      `<li><b>${esc(c.t)}</b><span>${esc(c.s)}</span></li>`).join('');

    for (const b of $('bmMode').querySelectorAll('button'))
      b.classList.toggle('active', b.dataset.mode === mode);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action="mode"]');
    if (!t) return;
    mode = t.dataset.mode;
    render();
  });

  render();
}());
