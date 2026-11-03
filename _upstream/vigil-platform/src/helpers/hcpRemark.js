// ============================================================
// Vigil Platform — แยกฟิลด์จาก Description ของ HikCentral (personInfo.remark)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าหน้าที่กรอก Description บน HCP ตามรูปแบบที่ตกลงกันไว้สี่บรรทัด:
//   <ชื่อคดี>
//   เลขบัตรประชาชน 5838682146901
//   เลขคดี คดีดำ ผบ. 1-2569
//   พบเจอติดต่อ สภอ.วิชั่น พตท.วิชั่น 0919409400
//
// แต่ "ตกลงกันไว้" กับ "พิมพ์จริง" ไม่เคยตรงกัน — จึงอ่านแบบ **นำด้วยคำสำคัญ**
// ไม่ใช่ตามลำดับบรรทัด ลำดับสลับก็ยังได้ครบ · บรรทัดที่ไม่เข้าคำสำคัญใดเลย
// บรรทัดแรก = ชื่อคดี ที่เหลือตกไป `extra` — ไม่มีข้อความไหนหายไปเงียบ ๆ
// ============================================================
'use strict';

// ป้ายสีต้องสั้นพอที่จะเป็นป้าย — ยาวกว่านี้คือประโยค ไม่ใช่ประเภท
const WATCH_LABEL_MAX = 24;

const { checkThaiNationalId } = require('./blacklist-crypto');

// เรียงจาก **ยาวไปสั้น** เสมอ: `เลขบัตรประชาชน` มี `เลขบัตร` อยู่ข้างใน ถ้าจับสั้นก่อน
// จะตัดคำไม่หมดแล้วเหลือ "ประชาชน 583…" มาเป็นเลขบัตร
const ID_KEYS = ['เลขประจำตัวประชาชน', 'เลขบัตรประชาชน', 'บัตรประชาชน', 'เลขบัตร'];
const CASE_KEYS = ['เลขคดี'];
const CONTACT_KEYS = ['พบเจอติดต่อ', 'ติดต่อ'];

// เบอร์ไทย: ขึ้นด้วย 0 แล้วรวมเป็น 9–10 หลัก · ยอมให้มีเว้นวรรค/ขีดคั่น
// (`08x-xxx-xxxx` คือรูปที่เจ้าหน้าที่พิมพ์จริงพอ ๆ กับเลขติดกัน)
const PHONE_RE = /0\d(?:[\s-]?\d){7,8}/;

// เลขบัตรที่ถูก mask แล้ว (`58xxxxxxxxx01` — รูปที่ maskId() คืนมา) โผล่ได้ตอน parse
// ข้อความที่เก็บไว้ซ้ำในรอบที่ไม่ได้ถามต้นทาง (GOTCHAS #195) · ตัวเลขจริงยังอยู่ใน
// id_number_enc ไม่ได้หายไปไหน ⇒ ทิ้งบรรทัดนี้ ไม่ต้องเอาไปต่อท้ายหมายเหตุให้คนอ่านงง
const MASKED_ID_RE = /^\d{2}x{9}\d{2}$/i;

// คืนข้อความหลังคำสำคัญ (ตัด `:` ที่อาจตามมา) หรือ null ถ้าบรรทัดนี้ไม่ใช่พวกนั้น
function _after(line, keys) {
  for (const k of keys) {
    const i = line.indexOf(k);
    if (i >= 0) return line.slice(i + k.length).replace(/^\s*:?\s*/, '').trim();
  }
  return null;
}

function parseHcpRemark(raw) {
  const out = {
    watch_type: null, watch_level: null, case_title: null,
    id_number: null, case_no: null, contact: null, phone: null,
    extra: [], raw: raw == null ? null : String(raw),
  };
  const lines = String(raw == null ? '' : raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const unmatched = [];

  for (const line of lines) {
    const id = _after(line, ID_KEYS);
    if (id !== null) {
      const digits = id.replace(/[\s-]/g, '');
      // 13 หลักเป๊ะเท่านั้น — เลขบัตรผิดแย่กว่าไม่มีเลขบัตร เพราะมันไปเป็น id_hash
      // แล้วจับคนคนละคนมารวมเป็นคนเดียว · ที่ไม่ผ่านเก็บข้อความดิบไว้ใน extra
      // และต้องผ่าน mod-11 ของบัตรไทยด้วย — 13 หลักอย่างเดียวไม่พอ:
      // เลขที่พิมพ์ผิดแต่ครบ 13 หลักจะได้ id_hash ที่ใช้ได้ แล้วจับคนคนละคน
      // มารวมเป็น master เดียวถาวร (แก้ทีหลังต้องแยกด้วยมือ) · ตัวตรวจตัวเดียวกับ
      // ที่ blacklist-sources ใช้ flag ให้ "หลัง" import — ที่นี่กันตั้งแต่ก่อนเข้า
      if (/^\d{13}$/.test(digits) && checkThaiNationalId(digits).ok && !out.id_number) out.id_number = digits;
      else if (!MASKED_ID_RE.test(digits)) out.extra.push(line);   // เลขที่ mask แล้ว = ทิ้ง (ดูหมายเหตุด้านล่าง)
      continue;
    }
    // เลขบัตรแบบ "ลอย" ไม่มีคำนำหน้า — รูปแบบที่เจ้าของปรับใช้ 2026-09-08
    // (เดิมเขียน `เลขบัตรประชาชน 583...` ตอนนี้เขียนเลขเปล่าบรรทัดเดียว)
    // เงื่อนไขเข้ม: ทั้งบรรทัดต้องเป็นตัวเลขล้วน 13 หลัก และผ่าน mod-11
    // จึงไม่ชนกับเลขคดีหรือเบอร์โทรที่ปนตัวอักษร/สั้นกว่า
    {
      const bare = line.replace(/[\s-]/g, '');
      if (/^\d{13}$/.test(bare) && checkThaiNationalId(bare).ok) {
        if (!out.id_number) out.id_number = bare; else out.extra.push(line);
        continue;
      }
      if (MASKED_ID_RE.test(bare)) continue;
    }
    const cs = _after(line, CASE_KEYS);
    if (cs !== null) {
      if (cs && !out.case_no) out.case_no = cs; else out.extra.push(line);
      continue;
    }
    const ct = /^แจ้ง/.test(line) ? line.replace(/^แจ้ง\s*:?\s*/, '').trim() : _after(line, CONTACT_KEYS);
    if (ct !== null) {
      if (ct && !out.contact && !out.phone) {
        const m = ct.match(PHONE_RE);
        if (m) out.phone = m[0].replace(/[\s-]/g, '');
        out.contact = ct.replace(PHONE_RE, '').replace(/\s+/g, ' ').trim() || null;
      } else out.extra.push(line);
      continue;
    }
    unmatched.push(line);
  }

  // รูปแบบใหม่แยกเป็นสองบรรทัด: บรรทัดแรกคือ "ประเภท" (หมายจับ / เฝ้าระวัง)
  // บรรทัดที่สองคือชื่อคดี · รูปแบบเดิมมีบรรทัดเดียวจึงได้แค่ title
  // ถ้ามี `เลขคดี` มาด้วย case_no ชนะ case_name ตอนแสดงผล (ดู page-blacklist.js)
  // ความหมายของแต่ละบรรทัด (เจ้าของนิยาม 2026-09-08):
  //   1) ประเภทการเฝ้าระวัง — "มีหมายจับ" / "เฝ้าระวัง" / "เฝ้าติดตาม"
  //      🔴 หมายจับ = ตำรวจจับได้ทันที จึงต้องเด่นที่สุดบนหน้าจอ ไม่ใช่ข้อความธรรมดา
  //   2) หัวข้อเหตุการณ์ + เลขคดี (รวมบรรทัดเดียว)
  //   3) เลขบัตรประชาชน — HCP ไม่ยอมให้ตั้ง ID เองตอนเพิ่มด้วยมือ เจ้าหน้าที่จึงพิมพ์ลงตรงนี้
  //   4) ชุดข้อมูลการติดต่อ
  out.watch_type = unmatched.shift() || null;
  out.case_title = unmatched.length ? unmatched.shift() : null;
  out.extra.push(...unmatched);

  if (out.watch_type) {
    const t = out.watch_type;
    out.watch_level = /หมายจับ/.test(t) ? 'warrant'
      : /เฝ้าระวัง/.test(t) ? 'watch'
        : /ติดตาม/.test(t) ? 'follow' : null;
    // ของเดิมส่วนใหญ่พิมพ์เป็นประโยคยาวบรรทัดเดียว ("หมายจับศาลเยาวชน หากพบเจอ
    // แจ้ง ร.ต.อ. …") ไม่ใช่คำสั้น ๆ แบบรูปแบบใหม่ · ถ้าเอาทั้งประโยคไปใส่ป้ายสี
    // ป้ายจะยาวจนไม่เหลือความหมายของการเป็นป้าย ⇒ เก็บ "ระดับ" ไว้ (ธง/สียังทำงาน)
    // แต่ย้ายข้อความไปเป็นหัวข้อเหตุการณ์ แล้วให้หน้าจอใช้คำมาตรฐานตามระดับแทน
    if (t.length > WATCH_LABEL_MAX) {
      if (!out.case_title) out.case_title = t;
      else out.extra.unshift(t);
      out.watch_type = null;
    }
  }
  // เบอร์ที่ฝังอยู่กลางประโยค (ของเดิมพิมพ์ "แจ้งพ.ต.อ.เอกลักษณ์ 0963615553"
  // ติดกันในบรรทัดเดียว ไม่เข้ารูป "ติดต่อ …") — ดึงมาให้กดโทรได้ แต่ไม่ตัดข้อความทิ้ง
  if (!out.phone) {
    for (const line of [out.case_title, ...out.extra].filter(Boolean)) {
      const m = line.match(PHONE_RE);
      if (m) { out.phone = m[0].replace(/[\s-]/g, ''); break; }
    }
  }
  // เลขคดีที่ฝังอยู่ในบรรทัดหัวข้อ (เช่น "คดีดำ ผบ. 1-2569") — ดึงมาแสดงแยกได้
  // แต่ **ไม่ตัดออกจาก case_title** เพราะบริบทของหัวข้อคือสิ่งที่คนอ่านต้องเห็น
  if (!out.case_no && out.case_title) {
    const m = out.case_title.match(/\d+\s*[-\/]\s*\d{2,4}/);
    if (m) out.case_no = m[0].replace(/\s+/g, '');
  }
  return out;
}

// คำมาตรฐานประจำระดับ — ใช้แทน watch_type เมื่อต้นทางพิมพ์เป็นประโยคยาว
// (ของจริง 203 จาก 364 ระเบียนเป็นประโยคเต็มบรรทัดเดียว ไม่ใช่คำสั้น ๆ)
const WATCH_LABEL = { warrant: 'มีหมายจับ', watch: 'เฝ้าระวัง', follow: 'เฝ้าติดตาม' };
const watchLabel = (level) => WATCH_LABEL[level] || '';

module.exports = { parseHcpRemark, watchLabel };
