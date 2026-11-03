// ============================================================
// Vigil Platform — ชนิดวัตถุของกล้องวิเคราะห์ภาพ ↔ คำไทยที่คนพิมพ์
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ฝั่งหน้าเว็บมีคำแปลอยู่แล้วใน `dashboard/i18n.js` (`cls.*`) แต่ไฟล์นั้นเป็นของเบราว์เซอร์
// ฝั่งเซิร์ฟเวอร์จึงต้องมีชุดของตัวเอง — แพตเทิร์นเดียวกับ `HR_LABELS` ของ report-renderer
// (CLAUDE.md ข้อ 4) · ถ้าเพิ่มชนิดใหม่ ต้องเพิ่มทั้งสองที่
//
// ค่าที่ใช้จริงในคอลัมน์ `events.object_class` (นับจากข้อมูลจริง 2026-09-08 ที่ RMUTR-V):
//   Motorcycle · Car · Vehicle · Person · Pickup · Bicycle · Truck · Van · Bus ·
//   Pedestrian · Animal
// ============================================================
'use strict';

// คำเรียกไทยของแต่ละชนิด — คำแรกคือคำที่เอาไว้แสดงผล ที่เหลือเป็นคำพ้องที่คนพิมพ์จริง
const CLASSES = {
  Motorcycle: ['รถจักรยานยนต์', 'จักรยานยนต์', 'มอเตอร์ไซค์', 'มอไซค์', 'จยย'],
  Bicycle:    ['จักรยาน'],
  Car:        ['รถยนต์', 'รถเก๋ง'],
  Pickup:     ['รถกระบะ', 'กระบะ'],
  Van:        ['รถตู้'],
  Truck:      ['รถบรรทุก', 'บรรทุก', 'รถสิบล้อ'],
  Bus:        ['รถบัส', 'รถโดยสาร', 'รถเมล์'],
  Person:     ['คน', 'บุคคล', 'คนเดิน'],
  Vehicle:    ['ยานพาหนะ'],
  // ค่าที่โผล่จริงในผลนับ 2026-09-09 (ภูเก็ต 12 ชม.) นอกเหนือจากด้านบน — ถ้าไม่ใส่
  // การ์ดจะขึ้นคำอังกฤษดิบปนกับคำไทย
  Pedestrian: ['คนเดินเท้า', 'คนเดินถนน'],
  Animal:     ['สัตว์'],
};

/** คำไทยที่เอาไว้แสดงบนการ์ด */
const objLabel = (cls) => (CLASSES[cls] ? CLASSES[cls][0] : (cls || 'วัตถุ'));

/**
 * หาชนิดวัตถุจากประโยค — เอาคำที่ **ยาวที่สุด** ที่อยู่ในประโยค
 * ยาวที่สุดสำคัญ: "จักรยาน" เป็นส่วนหนึ่งของ "จักรยานยนต์" จับสั้นก่อนได้ผิดทุกครั้ง
 * และ "คน" เป็นคำสั้นที่โผล่ในประโยคทั่วไปได้ง่าย จึงต้องแพ้คำที่เจาะจงกว่าเสมอ
 */
function matchObjectClass(text) {
  const t = String(text || '');
  let best = null, bestLen = 0;
  for (const [cls, words] of Object.entries(CLASSES)) {
    for (const w of words) {
      if (t.includes(w) && w.length > bestLen) { best = cls; bestLen = w.length; }
    }
  }
  return best;
}

module.exports = { CLASSES, objLabel, matchObjectClass };
