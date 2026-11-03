// ============================================================
// Vigil Platform — Partner API cursor codec
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// อยู่แยกไฟล์เพราะ CP3 ทำให้รูปแบบนี้กลายเป็น "สัญญา" กับ partner —
// ของที่เปลี่ยนไม่ได้โดยไม่ขึ้น /v2 ควรมีไฟล์ของตัวเองและมีเทสต์ติดอยู่
// เทสต์: test/partner-cursor.test.js
// ============================================================
'use strict';

// Declared to the caller on purpose (CP3, 2026-08-08). It encodes (timestamp,
// id) of the last row and always did so in plain base64url JSON; calling that
// "opaque" in the spec while a partner could read it in 30 seconds was a
// document that disagreed with its code — the same class of mistake that kept
// hcpSign.js wrong all day. So it is published, versioned, and covered by the
// /v1 compatibility rules instead.
//
// Not page numbers. license_plates takes ~732,000 inserts a day, so by the
// time a partner asks for page 2 the offset means something different than
// it did for page 1 — rows shift under them and they silently skip or repeat.
// A keyset cursor is stable no matter what arrives in between.
// ts must arrive as the string Postgres printed, NOT a JS Date.
//
// new Date() holds milliseconds. appearances.detected_at stores microseconds
// (2026-08-07 07:13:13.735099+00), so a cursor round-tripped through Date
// lands *before* the row it was built from, and that row is served again on
// the next page. Measured: 22 duplicates over 23 pages, one per page break.
//
// license_plates hid this completely — it stores milliseconds, so there was
// nothing to lose and the same code walked 20,585 rows exactly. Identical
// logic, correct on one table and wrong on the other, with no error either
// way. Hence ::text out of the query and no Date anywhere on this path.
// CP3 — เจ้าของตัดสิน 2026-08-08: **ประกาศรูปแบบ cursor เป็นส่วนหนึ่งของสัญญา**
// แทนที่จะ HMAC ให้ทึบจริง
//
// เหตุผลที่เลือกทางนี้: ของเดิมคือ base64url ของ JSON ธรรมดา ซึ่ง partner แกะ
// อ่านได้ใน 30 วินาที · การเขียนในเอกสารว่า "opaque" ทั้งที่แกะได้ คือเอกสารที่
// พูดไม่ตรงกับโค้ด ซึ่งเป็นความผิดคลาสเดียวกับที่ทำให้ hcpSign.js ผิดมาทั้งวัน
// (คอมเมนต์บอกว่าฟิลด์ว่างต้องมี newline ทั้งที่สเปกบอกตรงข้าม)
//
// ผลของการประกาศ: การเปลี่ยนรูปแบบนี้กลายเป็น breaking change ที่ต้องขึ้น /v2
// จึงใส่ `v` ไว้ตั้งแต่ตอนนี้ที่ยังไม่มี partner สักราย — ทำให้ cursor อธิบายตัวเอง
// ได้ และรุ่นถัดไปตรวจจับได้โดยไม่ต้องเดา · เพิ่มฟิลด์ใหม่ยังทำได้ใน v1 ตามกฎ
// CP1 (client ต้องมองข้ามฟิลด์ที่ไม่รู้จัก) แต่ลบหรือเปลี่ยนความหมายของ v/t/i ไม่ได้
const CURSOR_VERSION = 1;
const encodeCursor = (ts, id) =>
  Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    t: ts === null ? null : String(ts),
    i: String(id),
  })).toString('base64url');

const decodeCursor = (s) => {
  try {
    const o = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    // The id is a string, not a number: event and plate ids are bigints but
    // a camera id looks like 'C30-KAR-SB-15'. Bounded in length because this
    // arrives from outside; it is passed as a bind parameter, so shape is the
    // only thing worth checking.
    if (typeof o.i !== 'string' || !o.i.length || o.i.length > 64) return null;
    // `v` ที่ไม่รู้จัก = cursor จากรุ่นที่ใหม่กว่าเซิร์ฟเวอร์ตัวนี้ (เกิดได้ตอน
    // deploy ไม่พร้อมกัน) · ปฏิเสธดีกว่าตีความผิด และ partner จะได้ 400 ที่บอก
    // ตรง ๆ แทนที่จะได้ผลลัพธ์ที่ข้ามแถวไปเงียบ ๆ · ไม่มี v = ของก่อนประกาศสัญญา
    // ยังรับได้ ไม่ทำให้ cursor ที่ถืออยู่กลายเป็นขยะกลางคัน
    if (o.v !== undefined && o.v !== CURSOR_VERSION) return null;
    let t = null;
    if (o.t !== null && o.t !== undefined) {
      if (typeof o.t !== 'string' || o.t.length > 64) return null;
      // Parsed only to reject garbage. The ORIGINAL string is what gets used
      // — parsing it and printing it back is the precision loss described
      // above.
      if (isNaN(new Date(o.t))) return null;
      t = o.t;
    }
    return { t, i: o.i };
  } catch { return null; }
};

module.exports = { CURSOR_VERSION, encodeCursor, decodeCursor };
