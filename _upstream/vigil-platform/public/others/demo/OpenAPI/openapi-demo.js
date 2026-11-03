// ============================================================
// Vigil Platform — 3rd Party Integration console (MOCKUP demo)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Nothing here talks to the server. Every partner, event and plate is invented.
//
// Two claims the page exists to make visible:
//
//  1. Ticking a field changes the payload, the OpenAPI document AND the Postgres
//     GRANT at once, because all three render from ONE permission object. A
//     hand-written spec can drift from the grant; a generated one cannot.
//
//  2. OUTBOUND ONLY, deliberately. Inbound was built here first and cut on
//     2026-08-06: deciding what a partner may RECEIVE is a permission problem
//     over columns we own, while accepting what a partner SENDS is a discovery
//     and mapping problem over columns they own and we have never seen — the
//     existing blacklist source system already needs
//     POST /api/blacklist/sources/discover for exactly that reason. One screen
//     cannot be honest about both. Inbound belongs with the source lifecycle it
//     already lives in (the ฐานข้อมูลใบหน้า / ฐานข้อมูลป้ายทะเบียน pages).
//
// CSP: no inline handlers anywhere — the dashboard's policy blocks them
// (LPR Gallery incident). Everything is delegated off data-action.
// ============================================================
'use strict';

(function () {
  // ── field catalogue ───────────────────────────────────────
  // `col` is the real column this field maps to, so the generated GRANT is not
  // decorative — it is what would actually run. `view` overrides the domain's
  // default where a field lives on a different relation.
  //
  // Every domain here flows one way — out. See the note at the top of the file.
  //
  // `fill` is the MEASURED share of production rows that actually carry the
  // field, surveyed 2026-08-06 (LPR: 4,952,925 license_plates rows / 7 days ·
  // face: 703,446 appearances rows / 7 days · 120,440 FaceCapture raw_json /
  // day). It is on the page because "you may have this column" and "this
  // column has data" are different promises, and a partner who plans around
  // vehicle_brand without knowing it is 69% will build something that looks
  // broken. Re-measure before quoting these to anyone.
  const DOMAINS = [
    {
      key: 'lpr', name: 'ป้ายทะเบียน (LPR)', view: 'v_license_plates_public',
      group: 'ข้อมูลเหตุการณ์ (เราตรวจจับได้เอง)',
      fields: [
        { k: 'plate_text',    col: 'plate_number',   fill: 100,  label: 'เลขทะเบียนที่อ่านได้', pii: true },
        { k: 'region',        col: 'region',         fill: 100,  label: 'จังหวัด' },
        { k: 'plate_crop',    col: 'plate_image',    fill: 98.5, label: 'รูปป้าย (crop)' },
        { k: 'plate_color',   col: 'plate_color',    fill: 100,  label: 'สีป้าย' },
        { k: 'plate_type',    col: 'plate_type',     fill: 100,  label: 'ชนิดป้าย' },
        { k: 'confidence',    col: 'confidence',     fill: 100,  label: 'ความมั่นใจในการอ่าน' },
        { k: 'no_helmet',     col: 'no_helmet',      fill: 100,  label: 'ไม่สวมหมวกกันน็อก' },
        { k: 'rider_count',   col: 'rider_count',    fill: 4.8,  label: 'จำนวนผู้ซ้อน' },
        { k: 'vehicle_color', col: 'vehicle_color',  fill: 95.2, label: 'สีรถ' },
        { k: 'vehicle_type',  col: 'vehicle_type',   fill: 90.4, label: 'ประเภทรถ' },
        { k: 'vehicle_brand', col: 'vehicle_brand',  fill: 69.4, label: 'ยี่ห้อรถ' },
        { k: 'no_seatbelt',   col: 'no_seatbelt',    fill: 0,    label: 'ไม่คาดเข็มขัด' },
      ],
    },
    {
      key: 'face', name: 'ใบหน้า (Face)', view: 'v_events_public + v_appearances_public',
      note: 'ฟิลด์ร่างกายมาเฉพาะกล้องที่ส่ง body มาด้วย — 73% ของ FaceCapture (88,136 จาก 120,440 ต่อวัน)',
      group: 'ข้อมูลเหตุการณ์ (เราตรวจจับได้เอง)',
      fields: [
        { k: 'face_crop',   col: 'snapshot_filename', view: 'v_events_public',      fill: 100,  label: 'รูปใบหน้า (crop)', pii: true },
        { k: 'age',         col: 'age',               view: 'v_events_public',      fill: 100,  label: 'อายุ (ประมาณ)' },
        { k: 'expression',  col: 'face_expression',   view: 'v_events_public',      fill: 100,  label: 'สีหน้า' },
        { k: 'hat',         col: 'hat',               view: 'v_events_public',      fill: 100,  label: 'สวมหมวก' },
        { k: 'stay',        col: 'stayDuration',      view: 'v_events_public',      fill: 100,  label: 'เวลาที่อยู่ในเฟรม' },
        { k: 'gender',      col: 'gender',            view: 'v_appearances_public', fill: 99.7, label: 'เพศ' },
        { k: 'glasses',     col: 'glasses',           view: 'v_appearances_public', fill: 99.8, label: 'สวมแว่น' },
        // ── ต่อไปนี้มีเฉพาะกล้องที่ส่ง body มาด้วย (73% ของ FaceCapture) ──
        { k: 'attrs',       col: 'attributes',        view: 'v_appearances_public', fill: 66.1, label: 'ท่าทาง (ทิศทาง/ทรงผม/หน้ากาก/ถือของ)', body: true },
        { k: 'top_cat',     col: 'top_category',      view: 'v_appearances_public', fill: 48.1, label: 'ประเภทเสื้อ', body: true },
        { k: 'upper_color', col: 'upper_color',       view: 'v_appearances_public', fill: 48.0, label: 'สีเสื้อ', body: true },
        { k: 'bottom_cat',  col: 'bottom_category',   view: 'v_appearances_public', fill: 47.4, label: 'ประเภทกางเกง/กระโปรง', body: true },
        { k: 'lower_color', col: 'lower_color',       view: 'v_appearances_public', fill: 39.4, label: 'สีกางเกง/กระโปรง', body: true },
        { k: 'bag',         col: 'bag_category',      view: 'v_appearances_public', fill: 20.1, label: 'สัมภาระที่ถือ', body: true },
      ],
    },
    {
      key: 'ctx', name: 'บริบทของเหตุการณ์', view: 'v_events_public + v_cameras_public',
      group: 'ข้อมูลเหตุการณ์ (เราตรวจจับได้เอง)',
      fields: [
        { k: 'event_time',  col: 'event_time',      view: 'v_events_public',  label: 'เวลาเกิดเหตุ' },
        { k: 'camera_id',   col: 'camera_id',       view: 'v_events_public',  label: 'รหัสกล้อง' },
        { k: 'camera_name', col: 'name',            view: 'v_cameras_public', label: 'ชื่อจุดติดตั้ง' },
        { k: 'site',        col: 'site_id',         view: 'v_cameras_public', label: 'ไซต์' },
        { k: 'geo',         col: 'latitude, longitude', view: 'v_cameras_public', label: 'พิกัด', pii: true },
      ],
    },
    {
      key: 'bl_lpr', name: 'บัญชีเฝ้าระวัง — ป้ายทะเบียน',
      view: 'lpr_watchlist', gated: true,
      group: 'บัญชีเฝ้าระวัง (blacklist / watchlist)',
      fields: [
        { k: 'bl_plate',  col: 'plate_numbers', label: 'เลขทะเบียน', pii: true },
        { k: 'bl_region', col: 'region',        label: 'จังหวัด' },
        { k: 'bl_label',  col: 'label',         label: 'ป้ายกำกับ (เช่น หมายจับ)' },
        { k: 'bl_case',   col: 'case_ref',      label: 'เลขคดี/เลขอ้างอิง', pii: true },
        { k: 'bl_note',   col: 'case_note',     label: 'หมายเหตุคดี', pii: true },
        { k: 'bl_group',  col: 'group_id',      label: 'กลุ่มเฝ้าระวัง' },
        { k: 'bl_active', col: 'active',        label: 'สถานะเปิด/ปิด' },
        { k: 'bl_src',    col: 'source_id',     label: 'มาจากแหล่งใด' },
        { k: 'bl_extid',  col: 'external_id',   label: 'รหัสฝั่งต้นทาง (กันซ้ำ)' },
      ],
    },
    {
      key: 'bl_face', name: 'บัญชีเฝ้าระวัง — ใบหน้า',
      view: 'blacklist.master', gated: true, notBuilt: true,
      group: 'บัญชีเฝ้าระวัง (blacklist / watchlist)',
      fields: [
        { k: 'blf_name',   col: 'name',          label: 'ชื่อ-สกุล', pii: true },
        { k: 'blf_photo',  col: 'photo_path',    label: 'ภาพใบหน้าอ้างอิง', pii: true },
        { k: 'blf_idtype', col: 'id_type',       label: 'ชนิดเอกสาร (บัตร/พาสปอร์ต)' },
        { k: 'blf_idnum',  col: 'id_number_enc', label: 'เลขบัตร/พาสปอร์ต', pii: true },
        { k: 'blf_idhash', col: 'id_hash',       label: 'คีย์จับคู่ (HMAC ย้อนกลับไม่ได้)' },
        { k: 'blf_case',   col: 'case_ref',      label: 'เลขคดี/เลขอ้างอิง', pii: true },
        { k: 'blf_note',   col: 'case_note',     label: 'หมายเหตุคดี', pii: true },
        { k: 'blf_src',    col: 'source_id',     label: 'มาจากแหล่งใด' },
        { k: 'blf_extid',  col: 'external_id',   label: 'รหัสฝั่งต้นทาง (กันซ้ำ)' },
      ],
    },
  ];

  const ALL = () => { const o = {}; for (const d of DOMAINS) for (const f of d.fields) o[f.k] = true; return o; };
  const pick = (...keys) => { const o = {}; for (const d of DOMAINS) for (const f of d.fields) o[f.k] = keys.includes(f.k); return o; };
  const on = (...keys) => new Set(keys);   // which domains this partner receives at all

  // ── mock partners ─────────────────────────────────────────
  const PARTNERS = [
    {
      id: 'cib', name: 'CIB (กองบัญชาการตำรวจสอบสวนกลาง)', dbuser: '—',
      channel: 'push relay', endpoint: 'http://202.124.201.105:10001/v2/<UUID>',
      mode: 'passthrough', perms: ALL(), on: on('lpr', 'face', 'ctx'),
    },
    {
      id: 'partner_a', name: 'Partner A — บริษัทรักษาความปลอดภัย', dbuser: 'partner_a_ro',
      channel: 'Postgres view', endpoint: 'psql · third_party_readonly', mode: 'filtered',
      perms: pick('plate_text', 'province', 'plate_crop', 'full_image', 'event_time', 'camera_name'),
      on: on('lpr', 'ctx'),
    },
    {
      id: 'bi_vendor', name: 'BI Vendor — ผู้รับทำแดชบอร์ด', dbuser: 'bi_vendor_ro',
      channel: 'Postgres view', endpoint: 'psql · third_party_readonly', mode: 'filtered',
      perms: pick('vehicle_type', 'vehicle_color', 'gender', 'age', 'event_time', 'camera_id', 'camera_name', 'site'),
      on: on('lpr', 'face', 'ctx'),
    },
    {
      // A consumer that only RECEIVES watchlist rows — not one of the sources
      // that feeds us. Pushing our master list back to a source that fed it is
      // a different job with its own consent flow, and it already lives on the
      // ฐานข้อมูล pages (blacklist.sources.push_enabled / push_confirmed_by).
      id: 'phuket_pd', name: 'ตำรวจภูธรภูเก็ต — ผู้รับบัญชีเฝ้าระวัง', dbuser: 'phuket_pd_ro',
      channel: 'Postgres view', endpoint: 'psql · third_party_readonly', mode: 'filtered',
      perms: pick('bl_plate', 'bl_region', 'bl_label', 'bl_case', 'plate_text', 'province', 'event_time', 'camera_name'),
      on: on('bl_lpr', 'lpr', 'ctx'),
    },
  ];

  // ── mock records ──────────────────────────────────────────
  const REC_LPR = { plate_text: '1กข 1234', region: 'กรุงเทพมหานคร', plate_color: 'white',
    plate_type: 'ส่วนบุคคล', confidence: '96%', no_helmet: 'ไม่สวม', rider_count: '2 คน',
    vehicle_color: 'ขาว', vehicle_type: 'car', vehicle_brand: 'Toyota', no_seatbelt: '(ไม่มีข้อมูล)' };
  const REC_FACE = { face_crop: 'face_1029384.jpg', age: '30 (ช่วง 25–35)', expression: 'ปกติ',
    hat: 'ไม่สวม', stay: '4.2 วิ', gender: 'ชาย', glasses: 'ไม่สวม',
    attrs: 'เดินเข้า · ผมสั้น · ไม่สวมหน้ากาก · ถือของ', top_cat: 'เสื้อแขนสั้น', upper_color: 'ขาว',
    bottom_cat: 'กางเกงขายาว', lower_color: 'ดำ', bag: 'เป้สะพายหลัง' };
  const REC_CTX = { event_time: '2026-08-06 09:14:27', camera_id: 'C9-TCC-SB-04',
    camera_name: 'แยกทุ่งคา ขาเข้า', site: 'ภูเก็ต (hkt)', geo: '7.8804, 98.3923' };
  const REC_BL_LPR = { bl_plate: '2กก 5678', bl_region: 'ภูเก็ต', bl_label: 'หมายจับ',
    bl_case: 'ภก.1234/2569', bl_note: 'คดีลักทรัพย์ — ติดต่อพนักงานสอบสวนก่อนสกัด',
    bl_group: 'หมายจับ ภ.จว.ภูเก็ต', bl_active: 'เปิดใช้งาน', bl_src: 'gurusquare', bl_extid: 'GS-889201' };
  const REC_BL_FACE = { blf_name: 'สมชาย ใจดี', blf_photo: 'ref/bl/889201.jpg',
    blf_idtype: 'บัตรประชาชน', blf_idnum: '1-2345-xxxxx-xx-x', blf_idhash: 'a3f1…9c2e (HMAC)',
    blf_case: 'ภก.1234/2569', blf_note: 'คดีลักทรัพย์', blf_src: 'gurusquare', blf_extid: 'GS-889201' };

  const ICON_CAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="7" width="20" height="12" rx="2"/><path d="M2 12h20M7 19v2M17 19v2"/></svg>';
  const ICON_FACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  const ICON_OUT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let cur = PARTNERS[1];
  let tab = 'payload';
  const $ = (id) => document.getElementById(id);

  const isOn = (dk) => cur.on.has(dk);
  const domOf = (fk) => DOMAINS.find((d) => d.fields.some((f) => f.k === fk));
  const granted = (fk) => {
    const d = domOf(fk);
    if (!d || !isOn(d.key)) return false;
    return cur.mode === 'passthrough' ? true : !!cur.perms[fk];
  };

  // ── partner rail ──────────────────────────────────────────
  function renderPartners() {
    $('oaCount').textContent = String(PARTNERS.length);
    $('oaPartners').innerHTML = PARTNERS.map((p) => {
      const opened = DOMAINS.filter((d) => p.on.has(d.key));
      const n = Object.entries(p.perms).filter(([k, v]) => v && p.on.has((domOf(k) || {}).key)).length;
      const hasBl = opened.some((d) => d.gated);
      const flow = `<span class="oa-chip out">${ICON_OUT}ส่งออก</span>`
        + (hasBl ? '<span class="oa-chip bl">บัญชีเฝ้าระวัง</span>' : '');
      const mode = p.mode === 'passthrough' ? '<span class="oa-chip raw">ส่งดิบ</span>' : '';
      return `<button class="oa-p${p.id === cur.id ? ' is-on' : ''}" data-action="partner" data-id="${p.id}">
        <span class="oa-p-name">${esc(p.name)}</span>
        <span class="oa-p-row">${flow}${mode}<span class="oa-chip ch">${esc(p.channel)}</span></span>
        <span class="oa-p-sub">${p.mode === 'passthrough' ? 'ได้ทุกอย่างที่กล้องส่ง' : `${n} ฟิลด์ · ${opened.length} หมวด`}</span>
      </button>`;
    }).join('');
  }

  // ── header + mode ─────────────────────────────────────────
  function renderHead() {
    $('oaName').textContent = cur.name;
    $('oaMeta').innerHTML =
      `ช่องทาง <code>${esc(cur.channel)}</code> · ปลายทาง <code>${esc(cur.endpoint)}</code>`
      + (cur.dbuser !== '—' ? ` · ผู้ใช้ฐานข้อมูล <code>${esc(cur.dbuser)}</code>` : '');
    // .seg's active class is `active` (index.css:2182) — not `on`.
    for (const b of $('oaMode').querySelectorAll('button'))
      b.classList.toggle('active', b.dataset.mode === cur.mode);

    const hint = $('oaModeHint');
    if (cur.mode === 'passthrough') {
      hint.className = 'oa-modehint warn';
      hint.innerHTML = '<b>ส่งไบต์ดิบ ไม่แตะเนื้อหา</b> — partner ได้สิ่งที่กล้องส่งทุกไบต์ เลือกฟิลด์ไม่ได้ '
        + 'ใช้กับหน่วยงานที่ต้องการข้อมูลระดับหลักฐาน เพราะถ้าเขาเจอของแปลก คำตอบคือ “กล้องส่งมาแบบนั้น” '
        + 'ไม่ใช่ “ระบบเราประกอบผิด” · <b>การกรองฟิลด์ทำให้เรากลายเป็นผู้ผลิตข้อมูล</b> บั๊กของเราจะกลายเป็นหลักฐานที่ผิด';
    } else {
      hint.className = 'oa-modehint';
      hint.innerHTML = '<b>ประกอบใหม่ตามสิทธิ์</b> — ส่งเฉพาะฟิลด์ที่ติ๊กไว้ เหมาะกับ partner เชิงพาณิชย์ '
        + 'และงานที่ต้องปิดบังตาม PDPA · แลกมาด้วยการที่เราต้องรับผิดชอบความถูกต้องของสิ่งที่ประกอบเอง';
    }
    $('oaMatrixCard').classList.toggle('locked', cur.mode === 'passthrough');
  }

  // Fill rate is shown on the chip, not in a tooltip: a partner picking fields
  // needs it at the moment of choosing. 0% gets its own treatment because
  // "column exists, nothing ever writes to it" is a different answer from "rare".
  function fillTag(f) {
    if (f.fill === undefined) return '';
    if (f.fill === 0) return '<span class="oa-fill zero">ไม่มีข้อมูล</span>';
    const cls = f.fill >= 90 ? 'hi' : f.fill >= 40 ? 'mid' : 'lo';
    return `<span class="oa-fill ${cls}">${f.fill}%</span>`;
  }

  // ── field matrix: grouped, with a direction control per domain ──
  function renderMatrix() {
    let html = '', lastGroup = null;
    for (const d of DOMAINS) {
      if (d.group !== lastGroup) { lastGroup = d.group; html += `<div class="oa-grouphead">${esc(d.group)}</div>`; }
      const open = isOn(d.key);
      const seg = ['off', 'on'].map((o) =>
        `<button data-action="dom" data-dom="${d.key}" data-on="${o}"${(o === 'on') === open ? ' class="active"' : ''}>${o === 'on' ? 'ส่งออก' : 'ปิด'}</button>`).join('');

      let warn = '';
      if (d.gated && open)
        warn += `<div class="oa-gate"><b>นี่คือข้อมูลคดี ไม่ใช่เหตุการณ์ที่กล้องตรวจจับเอง</b> —
          การให้ข้อมูลคดีที่เราถืออยู่ไปอยู่ในระบบของอีกหน่วยงาน เป็นคำถามว่ามีอำนาจตามกฎหมายให้ทำหรือไม่
          ไม่ใช่คำถามทางเทคนิค (spec §6.1/§6.3) · ของจริงบังคับให้<b>มีคนกดยืนยันเป็นราย partner</b>
          และบันทึกไว้ว่าใครอนุญาต (<code>push_confirmed_by</code>)
          <br><b>การส่งกลับไปยัง source ที่ป้อนข้อมูลให้เรา</b> ไม่ได้ตั้งที่นี่ — อยู่ที่หน้า
          <b>ฐานข้อมูลใบหน้า / ฐานข้อมูลป้ายทะเบียน</b> ที่เดียว เพื่อไม่ให้มีสวิตช์เดียวกันสองที่</div>`;
      if (d.notBuilt && open)
        warn += `<div class="oa-gate soft">ฝั่งจับคู่ใบหน้ากับกล้อง<b>ยังทำไม่ได้วันนี้</b> — ต้อง enroll ใบหน้าเข้า FDLib
          ของกล้อง ซึ่งยังไม่มีในระบบ (spec §6.2) · ส่งรายชื่อออกได้ แต่ยังไม่มีอะไรมาจับคู่ให้</div>`;

      html += `<div class="oa-dom${open ? '' : ' is-off'}">
        <div class="oa-dom-head">
          <div class="oa-dom-name">${esc(d.name)}<span class="oa-src">${esc(d.view)}</span></div>
          <div class="seg oa-dirseg">${seg}</div>
        </div>
        ${d.note && open ? `<div class="oa-domnote">${esc(d.note)}</div>` : ''}
        ${warn}
        ${!open
          ? '<div class="oa-domoff">ไม่ได้เปิดหมวดนี้ให้ partner รายนี้</div>'
          : `<div class="oa-fields">${d.fields.map((f) => `
            <label class="oa-f${cur.perms[f.k] ? ' on' : ''}${f.pii ? ' pii' : ''}${f.fill === 0 ? ' nodata' : ''}">
              <input type="checkbox" data-action="field" data-k="${f.k}"${cur.perms[f.k] ? ' checked' : ''}>
              ${esc(f.label)}${fillTag(f)}
            </label>`).join('')}</div>`}
      </div>`;
    }
    $('oaMatrix').innerHTML = html;
  }

  // ── payload preview ───────────────────────────────────────
  // A withheld row stays visible and struck through. Hiding it would make the
  // page look like the partner simply gets less, instead of showing exactly
  // which of our fields we are keeping back — which is the point.
  function rows(data, domKey) {
    const dom = DOMAINS.find((d) => d.key === domKey);
    return dom.fields.filter((f) => data[f.k] !== undefined).map((f) => {
      const on = granted(f.k);
      return `<div class="oa-k${on ? '' : ' oa-row-off'}">${esc(f.label)}</div>
        <div class="oa-v${on ? '' : ' oa-row-off'}">${on ? esc(data[f.k]) : esc(String(data[f.k])) + '<span class="oa-cut">ตัดออก</span>'}</div>`;
    }).join('');
  }

  function renderPayload() {
    const parts = [];
    const shot = (on, kind) => `<div class="oa-shotwrap">
      <div class="oa-shot${kind === 'face' ? ' face' : ''}" style="${on ? '' : 'opacity:.35'}">${kind === 'face' ? ICON_FACE : ICON_CAR}</div>
      <div class="oa-shot-cap">${kind === 'face' ? 'รูปใบหน้า' : 'รูปเต็มฉาก'}${on ? '' : ' — ตัดออก'}</div></div>`;
    const flowBar = () => `<div class="oa-rec-flow out">${ICON_OUT} ส่งออก — สิ่งที่ partner ได้รับจากเรา</div>`;

    if (isOn('lpr') || isOn('ctx')) {
      const plaque = (typeof window.lprPlaque === 'function' && granted('plate_text'))
        ? window.lprPlaque(REC_LPR.plate_text, { vehicleType: REC_LPR.vehicle_type, plateColor: REC_LPR.plate_color,
            region: REC_LPR.province, big: true, showProv: granted('province') })
        : '<span class="lpr-plaque noread big">ไม่ได้รับ</span>';
      parts.push(`<div class="oa-rec">${flowBar()}
        <div class="oa-rec-head">${shot(granted('full_image'), 'lpr')}
          <div><div class="oa-rec-kind">เหตุการณ์ป้ายทะเบียน</div><div style="margin-top:8px">${plaque}</div></div></div>
        <div class="oa-kv">${isOn('lpr') ? rows(REC_LPR, 'lpr') : ''}${isOn('ctx') ? rows(REC_CTX, 'ctx') : ''}</div></div>`);
    }
    if (isOn('face')) {
      parts.push(`<div class="oa-rec">${flowBar()}
        <div class="oa-rec-head">${shot(granted('face_crop'), 'face')}
          <div><div class="oa-rec-kind">เหตุการณ์ใบหน้า</div></div></div>
        <div class="oa-kv">${rows(REC_FACE, 'face')}</div></div>`);
    }
    for (const [dk, rec, kind] of [['bl_lpr', REC_BL_LPR, 'บัญชีเฝ้าระวัง — ป้ายทะเบียน'],
                                   ['bl_face', REC_BL_FACE, 'บัญชีเฝ้าระวัง — ใบหน้า']]) {
      if (!isOn(dk)) continue;
      parts.push(`<div class="oa-rec">${flowBar()}
        <div class="oa-rec-head"><div><div class="oa-rec-kind">${esc(kind)}</div></div></div>
        <div class="oa-kv">${rows(rec, dk)}</div>
        <div class="oa-recnote">อ่านจาก <code>${esc(DOMAINS.find((d) => d.key === dk).view)}</code> —
          เป็น<b>ข้อมูลคดี</b> ไม่ใช่เหตุการณ์ที่กล้องตรวจจับเอง จึงติดเงื่อนไขด้านบน</div></div>`);
    }

    const openDoms = DOMAINS.filter((d) => isOn(d.key));
    const n = Object.keys(cur.perms).filter((k) => granted(k)).length;
    const tot = openDoms.reduce((s, d) => s + d.fields.length, 0);
    parts.push(`<div class="oa-summary"><b>${esc(cur.name)}</b> — เปิด ${openDoms.length} หมวด ·
      ${cur.mode === 'passthrough' ? 'โหมดส่งดิบ ทุกฟิลด์ผ่านหมด'
        : `ผ่าน <b>${n}</b> ฟิลด์ จาก ${tot} ที่หมวดเหล่านั้นมี · ฟิลด์ที่ขีดฆ่าคือของที่ไม่ผ่าน`}</div>`);

    $('oaPayload').innerHTML = openDoms.length ? parts.join('')
      : '<div class="oa-summary">ยังไม่ได้เปิดหมวดไหนให้ partner รายนี้เลย</div>';
  }

  // ── generated OpenAPI ─────────────────────────────────────
  function renderOpenapi() {
    if (cur.mode === 'passthrough') {
      $('oaOpenapi').textContent =
        `# ${cur.name}\n# โหมดส่งดิบ — ไม่มี schema ให้ประกาศ\n#\n`
        + '# partner รายนี้ไม่ได้เรียก API ของเรา เรายิง multipart ของกล้องต่อให้เขา\n'
        + '# ทุกไบต์ตามที่กล้องส่งมา รูปแบบจึงเป็นของผู้ผลิตกล้อง ไม่ใช่ของเรา\n'
        + '# เอกสารที่ควรส่งให้ partner แบบนี้คือ "ตัวอย่างไบต์จริง" ไม่ใช่ OpenAPI\n#\n'
        + `# endpoint: ${cur.endpoint}\n`;
      return;
    }
    const props = (dk, pad) => DOMAINS.find((d) => d.key === dk).fields.filter((f) => cur.perms[f.k])
      .map((f) => `${pad}${f.k}:\n${pad}  type: ${(f.k === 'age' || f.k === 'speed') ? 'integer' : 'string'}`).join('\n');

    let out = 'openapi: 3.1.0\ninfo:\n'
      + `  title: Vision Meta Hub — ${cur.name}\n  version: "1.0"\n`
      + `  x-generated-from: GRANT ของ ${cur.dbuser} (อ่านจาก information_schema ตอน build)\npaths:\n`;

    const outDoms = DOMAINS.filter((d) => isOn(d.key));

    if (outDoms.length) {
      const p = outDoms.map((d) => props(d.key, '                    ')).filter(Boolean).join('\n');
      out += '  /v1/events:\n    get:\n      summary: ดึงข้อมูลที่ได้รับสิทธิ์\n'
        + '      parameters:\n        - { name: since, in: query, required: true, schema: { type: string, format: date-time } }\n'
        + '      responses:\n        "200":\n          content:\n            application/json:\n              schema:\n'
        + '                type: array\n                items:\n                  type: object\n                  properties:\n'
        + (p || '                    {}  # ยังไม่ได้ให้สิทธิ์ฟิลด์ใดเลย') + '\n';
    }
    if (!outDoms.length) out += '  {}  # ยังไม่ได้เปิดหมวดไหนเลย\n';
    $('oaOpenapi').textContent = out;
  }

  // ── the GRANT that actually enforces it ───────────────────
  function renderSql() {
    if (cur.mode === 'passthrough') {
      $('oaSql').textContent =
        `-- ${cur.name}\n-- โหมดส่งดิบ — ไม่มี Postgres user และไม่มี GRANT\n`
        + '-- partner รายนี้ไม่ได้ query ฐานข้อมูลเรา เรายิง HTTP ไปหาเขาฝ่ายเดียว\n'
        + '-- การควบคุมอยู่ที่ "ส่งให้ใคร" ไม่ใช่ "อ่านอะไรได้"\n';
      return;
    }
    const out = [`-- ${cur.name}  (${cur.dbuser})`,
      '-- generate จากฟิลด์ + ทิศทางที่ตั้งไว้ด้านบน — เอกสาร OpenAPI มาจากชุดเดียวกัน', ''];

    // outbound → column-scoped SELECT, grouped by the relation each field lives on
    const byView = new Map();
    for (const d of DOMAINS) {
      if (!isOn(d.key)) continue;
      for (const f of d.fields) {
        const view = f.view || d.outView || d.view;
        if (!byView.has(view)) byView.set(view, []);
        if (cur.perms[f.k]) byView.get(view).push(f.col);
      }
    }
    if (byView.size) out.push('-- ── ส่งออก: อ่านได้เฉพาะคอลัมน์ที่ให้ ──');
    for (const [view, cols] of byView) {
      if (!cols.length) { out.push(`REVOKE SELECT ON ${view} FROM ${cur.dbuser};`); continue; }
      out.push(`GRANT SELECT (${cols.join(', ')})`, `  ON ${view} TO ${cur.dbuser};`);
    }

    out.push('', '-- เพดานการใช้งาน (มีอยู่แล้วใน docs/REF_third-party-integration.md §3.2)',
      `ALTER USER ${cur.dbuser} SET statement_timeout = '60s';`,
      `ALTER USER ${cur.dbuser} CONNECTION LIMIT 5;`);
    $('oaSql').textContent = out.join('\n');
  }

  function renderAll() { renderPartners(); renderHead(); renderMatrix(); renderPayload(); renderOpenapi(); renderSql(); }

  // ── events (delegated — CSP forbids inline handlers) ──────
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    if (a === 'partner') { cur = PARTNERS.find((p) => p.id === t.dataset.id) || cur; renderAll(); }
    else if (a === 'mode') { cur.mode = t.dataset.mode; renderAll(); }
    else if (a === 'dom') { cur.on[t.dataset.on === 'on' ? 'add' : 'delete'](t.dataset.dom); renderAll(); }
    else if (a === 'all' || a === 'none') {
      for (const k of Object.keys(cur.perms)) cur.perms[k] = (a === 'all');
      renderAll();
    } else if (a === 'tab') {
      tab = t.dataset.tab;
      for (const b of document.querySelectorAll('.oa-tab')) b.classList.toggle('is-on', b.dataset.tab === tab);
      for (const p of document.querySelectorAll('.oa-pane')) p.classList.toggle('is-on', p.dataset.pane === tab);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-action="field"]');
    if (!t) return;
    cur.perms[t.dataset.k] = t.checked;
    renderPartners(); renderMatrix(); renderPayload(); renderOpenapi(); renderSql();
  });

  renderAll();
}());
