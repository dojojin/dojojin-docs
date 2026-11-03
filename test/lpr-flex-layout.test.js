// ============================================================
// Vigil Platform — ผังการ์ดแจ้งเตือน LPR / ใบหน้า บน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ตรึงผังที่เจ้าของสั่งหลังลองของจริง (2026-08-26): crop ป้ายเป็นรูปหลัก ·
// ซ้าย = ภาพเต็มเฟรม · ขวา = ภาพอ้างอิง · รายละเอียดเป็นตารางหัวข้อ/ค่า
//
// เหตุผลของผัง: ภาพเต็มเฟรมกับภาพอ้างอิงเป็น "รถทั้งคัน" เหมือนกัน วางคู่กันถึงจะ
// เทียบกันได้ · ป้ายเป็นข้อมูลระบุตัว ต้องอยู่บนสุดของกลุ่มรูปและใหญ่ที่สุด
//
// ข้อที่ต้องกันจริง ๆ:
//   1. aspectMode ของ crop ป้าย — ของจริงกว้าง 1.25:1 ถึง 2.33:1 ถ้าใครเปลี่ยนกลับ
//      เป็น 'cover' ให้เหมือนการ์ดใบหน้า ป้ายจัตุรัสของมอเตอร์ไซค์จะถูกตัดบนล่าง
//      จนเลขหายเงียบ ๆ — การ์ดยังดูสวยอยู่ แต่ข้อมูลที่ต้องอ่านหายไป
//   2. รูปต้องอยู่ใน body ไม่ใช่ `hero` — hero ของ Flex ถูกวางบนสุดเสมอ ย้ายลงมา
//      อยู่ใต้ข้อความไม่ได้ ซึ่งขัดกับผังที่อนุมัติ (อ่านก่อนว่าเรื่องอะไร แล้วค่อยเห็นรูป)
//   3. ตารางต้องตัดแถวที่ไม่มีข้อมูลทิ้ง ไม่ใช่ขึ้นหัวข้อค้างไว้เปล่า ๆ

const test = require('node:test');
const assert = require('node:assert');
const { buildLprFlexAlert, buildFaceFlexAlert } = require('../src/line-sender');
const { buildAlertSections } = require('../src/helpers/lprLineAlert');

const META = { plate: 'ผธ4973', groupName: 'เฝ้าระวัง', cameraName: 'CAM-1' };
const body = (b) => b.contents.body.contents;
// คู่เทียบ = box แนวนอนที่ "มีรูปอยู่ข้างใน" ไม่ใช่ box แนวนอนใบแรกเฉย ๆ
// เดิมใช้ใบแรก แล้วพอหัวการ์ดเพิ่ม box แนวนอนสำหรับจัดป้ายกลุ่มให้อยู่กึ่งกลาง
// (2026-08-27) ตัวระบุตำแหน่งนี้ก็ไปคว้าใบนั้นแทน — เทสต์ล้มทั้งที่การ์ดถูกต้อง
// ระบุจากสิ่งที่มันเป็นจริง จะได้ไม่ล้มอีกเมื่อมี box แนวนอนใบอื่นเพิ่มเข้ามา
const pairOf = (b) => {
  const box = body(b).find((c) => c.layout === 'horizontal' && imgs(c).length > 0);
  if (!box) throw new Error('หากล่องคู่เทียบ (box แนวนอนที่มีรูป) ไม่เจอ');
  return box.contents;
};
// รูปหลัก = กล่องแนวตั้งใบแรกที่มีรูปอยู่ข้างใน (มาก่อนคู่เทียบเสมอ)
const imgs = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'image') out.push(node);
  for (const c of node.contents || []) imgs(c, out);
  return out;
};

test('มี crop ป้าย → รูปหลัก = ป้าย (fit), ซ้าย = ภาพเต็มเฟรม, ขวา = อ้างอิง', () => {
  const b = buildLprFlexAlert('x', {
    scene: 'https://h/plate.jpg', face: 'https://h/scene.jpg', ref: 'https://h/ref.jpg',
    plateCrop: true, heroFit: true,
  }, META, null);

  // hero เหลือแค่แถบสี — รูปทุกใบต้องอยู่ใน body
  assert.equal(b.contents.hero.height, '6px', 'hero ต้องเป็นแถบสี ไม่ใช่รูป');
  assert.equal(imgs(b.contents.hero).length, 0, 'ห้ามมีรูปใน hero (สลับลงล่างไม่ได้)');

  const all = imgs(b.contents.body);
  assert.equal(all[0].url, 'https://h/plate.jpg', 'crop ป้ายต้องเป็นรูปแรกใน body');
  assert.equal(all[0].aspectMode, 'fit', 'ป้ายต้อง fit ไม่งั้นโดนตัดบนล่าง');

  const [left, right] = pairOf(b);
  assert.equal(left.contents[0].url, 'https://h/scene.jpg', 'ช่องซ้ายต้องเป็นภาพเต็มเฟรม');
  assert.equal(left.contents[0].aspectMode, 'cover');
  assert.equal(left.contents[1].text, 'ภาพจากกล้อง');
  assert.equal(right.contents[0].url, 'https://h/ref.jpg', 'ช่องขวาต้องเป็นภาพอ้างอิง');
  assert.equal(right.contents[1].text, 'ภาพอ้างอิง');
});

test('ไม่มี crop ป้าย → คืนผังเดิม (ไม่มีรูปหลัก, ซ้ายเป็นภาพเต็มเฟรม) ไม่ใช่การ์ดขาดรูป', () => {
  const b = buildLprFlexAlert('x', {
    scene: null, face: 'https://h/scene.jpg', ref: 'https://h/ref.jpg', plateCrop: false,
  }, META, null);

  const all = imgs(b.contents.body);
  assert.equal(all.length, 2, 'ไม่มี crop ป้าย = เหลือแค่คู่เทียบ');
  const [left] = pairOf(b);
  assert.equal(left.contents[0].url, 'https://h/scene.jpg');
  assert.equal(left.contents[0].aspectMode, 'cover');
  assert.equal(left.contents[1].text, 'ภาพจากกล้อง');
});

test('เลขทะเบียนเป็นพาดหัว ไม่ได้ซ่อนอยู่ในตาราง', () => {
  const b = buildLprFlexAlert('x', { scene: null, face: 'https://h/s.jpg', ref: 'https://h/r.jpg' },
    META, null);
  const head = body(b).find((c) => c.type === 'text' && c.size === 'xxl');
  assert.ok(head && head.text === 'ผธ4973', 'ป้ายต้องเป็นตัวใหญ่สุดของการ์ด');
  assert.equal(head.weight, 'bold');
});

test('ตาราง: แถวที่โรสเตอร์ไม่ได้กรอก ต้องหายไปทั้งแถว ไม่ใช่ขึ้นค่าว่าง', () => {
  const secs = buildAlertSections({
    plate: 'ผธ4973', region: 'ภูเก็ต', cameraName: 'C4', siteName: 'Phuket',
    eventTime: '2026-08-26T12:37:40Z', vehicle: 'รถเล็ก · สีขาว',
    ref: { case: 'ลักทรัพย์', unit: 'สภ.ถลาง' },   // ไม่มี detail/province/updated
  });
  const labels = secs.flatMap((s) => s.rows.map((r) => r[0]));
  assert.ok(labels.includes('คดี') && labels.includes('แจ้งเหตุที่'));
  assert.ok(!labels.includes('รายละเอียด'), 'ช่องที่ว่างต้องไม่กินบรรทัด');
  assert.ok(!labels.includes('จดทะเบียน'));
});

test('ตาราง: เลขป้ายในฐานข้อมูลขึ้นเสมอ — ห้ามเอาค่าที่กล้องอ่านมาเป็นเกณฑ์ซ่อน', () => {
  // พฤติกรรมเดิม ("ตรงกัน = ซ่อน") ถูกหักล้างด้วยเคสจริง 2026-08-31: รถ 1กอ8835
  // ถูกอ่านตัดท้ายเหลือ 1กอ88 แล้วไปตรงกับรายการเฝ้าระวัง 1กอ88 พอดี — การ์ดจึง
  // ไม่แสดงเลขใน DB ในเคสที่ต้องการมันที่สุด · "อ่านตรงกับรายการ" ≠ "ถูกต้อง"
  const same = buildAlertSections({ plate: 'ผธ4973', ref: { plateNumber: 'ผธ4973', case: 'ก' } });
  const diff = buildAlertSections({ plate: 'ผธ4973', ref: { plateNumber: 'ผธ4978', case: 'ก' } });
  const refRows = (s) => s[s.length - 1].rows.filter((r) => r[0] === 'ทะเบียน');
  assert.equal(refRows(same)[0][1], 'ผธ4973', 'ตรงกันก็ต้องเห็น — บล็อกอ้างอิงต้องยืนได้ด้วยตัวเอง');
  assert.equal(refRows(diff)[0][1], 'ผธ4978', 'ไม่ตรงกัน = ต้องเห็น');
});

test('ตารางว่างทั้งบล็อก → ไม่ขึ้นหัวข้อค้างไว้', () => {
  const b = buildLprFlexAlert('ข้อความสำรอง', { scene: null, face: 'a', ref: 'b' },
    { ...META, sections: [{ title: 'ว่างเปล่า', rows: [['x', ''], ['y', null]] }] }, null);
  const heads = body(b).filter((c) => c.layout === 'vertical' && c.contents?.[1]?.type === 'separator');
  assert.equal(heads.length, 0, 'บล็อกที่ไม่มีข้อมูลเลย ต้องไม่ขึ้นหัวข้อ');
});

test('ใบหน้า: ชื่อที่ซ้ำกับชื่อกลุ่ม ต้องไม่ขึ้นสองรอบ', () => {
  const b = buildFaceFlexAlert('x',
    { face: 'https://h/f.jpg', ref: 'https://h/r.jpg', scene: null,
      info: { ref_name: 'ผู้ต้องหาตามหมายจับ สมชาย ใจดี', case_ref: 'สมชาย ใจดี',
              case_note: 'เพศชาย สูง 170', gender: 'male', hcp_glasses: '1' } },
    { person_name: 'ผู้ต้องหาตามหมายจับ สมชาย ใจดี', watchlist: 'ผู้ต้องหาตามหมายจับ',
      camera_name: 'CAM-9', event_time: '2026-08-26T01:50:13Z' },
    null);

  const head = body(b).find((c) => c.type === 'text' && c.size === 'xxl');
  assert.equal(head.text, 'สมชาย ใจดี', 'ชื่อกลุ่มขึ้นเป็นป้ายแล้ว ไม่ต้องนำหน้าชื่อคนอีก');

  // นับเฉพาะใน body — altText เป็นข้อความแจ้งเตือนของ LINE คนละที่กับการ์ด
  const flat = JSON.stringify(b.contents.body);
  assert.equal((flat.match(/สมชาย ใจดี/g) || []).length, 1, 'ชื่อเดียวกันต้องขึ้นครั้งเดียว');
  assert.ok(flat.includes('เพศชาย สูง 170'));
  // ลักษณะจาก HCP แทนรหัสอ้างอิง (เจ้าของสั่ง 2026-08-26) — ยืนยันได้เท่านั้น
  assert.ok(flat.includes('ชาย · สวมแว่น'), 'ต้องแปลรหัสคุณลักษณะเป็นคำไทย');
});

test('ใบหน้า: ไม่มีข้อมูลโรสเตอร์เลย → ยังได้ข้อความเดิมจาก template ไม่ใช่การ์ดเปล่า', () => {
  const b = buildFaceFlexAlert('พบบุคคลเฝ้าระวัง',
    { face: 'a', ref: 'b', scene: null, info: {} },
    { person_name: 'สมหญิง', watchlist: '-' }, null);
  assert.ok(JSON.stringify(b).includes('พบบุคคลเฝ้าระวัง'));
});

test('แถวตารางต้องตัดบรรทัดได้ — เบอร์โทรท้ายบรรทัดคือตัวแรกที่หายถ้าใช้ baseline', () => {
  // LINE ไม่ wrap ใน layout 'baseline' แต่ **ตัดทิ้ง** · แถวยาวที่สุดของข้อมูลจริง
  // ลงท้ายด้วยเบอร์โทรที่เจ้าหน้าที่ต้องกด จึงห้ามถอยกลับไป baseline
  const b = buildLprFlexAlert('x', { scene: null, face: 'a', ref: 'b' }, {
    ...META,
    sections: [{ title: 'ข้อมูลอ้างอิง', rows: [
      ['แจ้งเหตุที่', 'สภ.ถลาง ร.ต.อ. เกรียงไกร ดาวกระจาย 0909157747'],
    ] }],
  }, null);
  const row = body(b).find((c) => c.contents?.[0]?.text === 'แจ้งเหตุที่');
  assert.ok(row, 'ต้องมีแถวนี้');
  assert.equal(row.layout, 'horizontal', "baseline ตัดข้อความทิ้ง ไม่ใช่ตัดบรรทัด");
  assert.equal(row.contents[1].wrap, true);
});

test('ลักษณะจาก HCP: ยืนยันเฉพาะค่าที่ใช่ ห้ามยืนยันสิ่งที่กล้องไม่ได้ยืนยัน', () => {
  const { faceAppearanceTh } = require('../src/helpers/hcpFaceLabels');
  // 0 = ไม่ทราบ · 2 = ไม่ใช่ — ทั้งคู่ต้องเงียบ ไม่ใช่ขึ้น "ไม่สวมแว่น"
  assert.equal(faceAppearanceTh({ gender: 'female', hcp_glasses: '2', hcp_mask: '0' }), 'หญิง');
  assert.equal(faceAppearanceTh({ hcp_gender: '1', hcp_glasses: '1' }), 'ชาย · สวมแว่น');
  assert.equal(faceAppearanceTh({ hcp_glasses: '0', hcp_mask: '0' }), null, 'ไม่มีอะไรยืนยันได้ = ไม่ขึ้นแถว');
  // อายุยังไม่แปล — ข้อมูลจริง 14/14 ใบให้ค่าที่แปลแล้วผิด (ดูเหตุผลในไฟล์ helper)
  assert.equal(faceAppearanceTh({ hcp_age_group: '5' }), null, 'ห้ามเอาอายุมาแสดงจนกว่าจะยืนยันรหัสได้');
});

test('ลักษณะจากกล้อง Hikvision (ไซต์ vss) — ข้อมูลละเอียดกว่า HCP มาก', () => {
  const { faceAppearanceTh } = require('../src/helpers/hcpFaceLabels');
  // payload จริงของ event 29983948
  assert.equal(
    faceAppearanceTh({ age: 35, gender: 'male', hat: 'no', mask: 'no', glass: 'no',
                       faceExpression: 'happy', ageGroup: 'middle' }),
    'ชาย · อายุประมาณ 35 ปี · ยิ้มแย้ม');
  // ของที่ "ใส่จริง" ต้องขึ้น · ของที่ "ไม่ได้ใส่" ต้องเงียบ
  assert.equal(faceAppearanceTh({ gender: 'male', glass: 'yes', mask: 'no' }), 'ชาย · สวมแว่น');
  // อายุนอกช่วงที่เป็นไปได้ = ค่าเสีย ไม่ใช่ข้อมูล
  assert.equal(faceAppearanceTh({ age: 0 }), null);
  assert.equal(faceAppearanceTh({ age: 999 }), null);
});

test('ว่าง = ตารางอัตโนมัติ · พิมพ์ = ได้ตามที่พิมพ์ (ทั้งสองชนิดการ์ด)', () => {
  // เจ้าของสั่ง 2026-08-27 — กลับด้านจากตอนเช้าที่ให้ตารางชนะเสมอ
  // เหตุผล: ช่องกรอกที่แก้ได้แต่ไม่มีผล คือกับดักแบบเดียวกับที่ระบบนี้เคยเจอ
  // มาแล้วเรื่อง lpr_line_image_expire_hours (ป้ายบอกอย่าง พฤติกรรมอีกอย่าง)
  const SECS = [{ title: 'ข้อมูลจากกล้อง', rows: [['ทะเบียน', 'ผธ4973']] }];
  const hasTable = (b) => JSON.stringify(b).includes('ข้อมูลจากกล้อง');

  // ── ป้ายทะเบียน: ผู้เรียก (lprLineAlert) เป็นคนตัดสินใจ ส่ง sections มาหรือไม่ส่ง
  const blank = buildLprFlexAlert('ข้อความสำรอง', { scene: null, face: 'a', ref: 'b' },
    { ...META, sections: SECS }, null);
  assert.ok(hasTable(blank), 'ว่าง → ต้องได้ตาราง');
  assert.ok(!JSON.stringify(blank).includes('ข้อความสำรอง'), 'มีตารางแล้วไม่ต้องมีข้อความซ้ำ');

  const typed = buildLprFlexAlert('ข้อความที่ผู้ใช้พิมพ์เอง', { scene: null, face: 'a', ref: 'b' },
    { ...META, sections: null }, null);
  assert.ok(!hasTable(typed), 'พิมพ์เอง → ตารางต้องหายไป');
  assert.ok(JSON.stringify(typed).includes('ข้อความที่ผู้ใช้พิมพ์เอง'), 'ต้องได้ข้อความที่พิมพ์');
  // หัวการ์ดและรูปต้องยังอยู่ ไม่ใช่หายไปทั้งใบ
  assert.ok(JSON.stringify(typed).includes('ผธ4973'), 'เลขทะเบียนต้องยังเป็นหัวการ์ด');

  // ── ใบหน้า: ตัดสินจากธง layout.hasCustomText เพราะ messageText ถูกเติม default
  //    ไปแล้ว ผู้สร้างการ์ดจึงแยกเองไม่ได้ว่าคนพิมพ์หรือระบบเติม
  const ev = { person_name: 'สมชาย', watchlist: 'กลุ่ม', camera_name: 'C1',
               event_time: '2026-08-27T01:00:00Z' };
  const imgs = { face: 'a', ref: 'b', scene: null, info: { case_note: 'เพศชาย' } };
  assert.ok(hasTable(buildFaceFlexAlert('x', imgs, ev, null, {})), 'ใบหน้า ว่าง → ต้องได้ตาราง');
  const fTyped = buildFaceFlexAlert('ข้อความใบหน้าที่พิมพ์เอง', imgs, ev, null, { hasCustomText: true });
  assert.ok(!hasTable(fTyped), 'ใบหน้า พิมพ์เอง → ตารางต้องหายไป');
  assert.ok(JSON.stringify(fTyped).includes('ข้อความใบหน้าที่พิมพ์เอง'));
});

// ── หัวการ์ดจัดกึ่งกลาง ตารางชิดซ้าย (2026-08-27 ตามที่เจ้าของขอ) ──────────
//
// คนละหน้าที่กัน: หัวคือ "นี่เรื่องอะไร" ที่ต้องอ่านออกในครึ่งวินาทีตอนการ์ดเด้ง
// ส่วนตารางต้องมีขอบซ้ายตรงกันถึงจะกวาดตาลงมาทีละแถวได้ — จัดกึ่งกลางทั้งใบจะ
// ทำให้ตารางอ่านยากลง ไม่ใช่ดีขึ้น
test('หัวการ์ดอยู่กึ่งกลาง แต่แถวในตารางยังชิดซ้าย', () => {
  const b = buildLprFlexAlert('x', { scene: null, face: 'https://h/s.jpg', ref: 'https://h/r.jpg' },
    { plate: '1กอ88', region: 'ภูเก็ต', groupName: 'รถทดสอบระบบ', cameraName: 'C1',
      sections: [{ title: 'ข้อมูลจากกล้อง', rows: [['เวลา', '15:12'], ['กล้อง', 'C1']] }] },
    null);
  const top = body(b);

  // ป้ายกลุ่มเป็น box ที่มีพื้นหลัง จัดกึ่งกลางด้วย align แบบ text ไม่ได้ —
  // ต้องห่อด้วย box แนวนอน + justifyContent และลูกต้อง flex:0 ไม่งั้น LINE
  // จะไม่สนใจ justifyContent แล้วป้ายจะยืดเต็มความกว้างเป็นแถบสีพาดทั้งใบ
  const chipWrap = top.find((c) => c.justifyContent === 'center');
  assert.ok(chipWrap, 'ป้ายกลุ่มต้องถูกห่อด้วยกล่องที่จัดกึ่งกลาง');
  assert.equal(chipWrap.layout, 'horizontal', 'justifyContent ใช้ได้กับกล่องแนวนอน');
  assert.equal(chipWrap.contents[0].flex, 0,
    'ลูกต้อง flex:0 ไม่งั้น LINE จะไม่เคารพ justifyContent และป้ายจะยืดเต็มใบ');
  assert.ok(JSON.stringify(chipWrap).includes('รถทดสอบระบบ'));

  const title = top.find((c) => c.type === 'text' && c.text === '1กอ88');
  const sub   = top.find((c) => c.type === 'text' && c.text === 'ภูเก็ต');
  assert.equal(title?.align, 'center', 'ทะเบียนต้องอยู่กึ่งกลาง');
  assert.equal(sub?.align, 'center', 'จังหวัดต้องอยู่กึ่งกลาง');

  // แถวตาราง = box ที่มี text สองตัว (label/value) — ต้องไม่มีตัวไหนถูกสั่ง center
  const rows = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    const kids = n.contents || [];
    if (n.type === 'box' && kids.length === 2 && kids.every((k) => k.type === 'text')) rows.push(n);
    kids.forEach(walk);
  };
  top.forEach(walk);
  assert.ok(rows.length >= 2, `ควรมีแถวตารางอย่างน้อย 2 แถว เจอ ${rows.length}`);
  for (const r of rows) {
    for (const cell of r.contents) {
      assert.notEqual(cell.align, 'center', `แถวตาราง "${r.contents[0].text}" ต้องชิดซ้าย`);
    }
  }
});
