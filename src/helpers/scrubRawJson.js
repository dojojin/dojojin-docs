// ============================================================
// Vigil Platform — Helper: scrub raw_json (PDPA / network-topology)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// Hikvision anprAlarm เก็บ ISAPI XML ดิบไว้ใน `raw_json.rawXml` ซึ่งมี
// <ipAddress> / <ipv6Address> / <macAddress> ของกล้องติดมาด้วย = แผนผังเครือข่าย
// ภายในหลุดถึง "ทุกคนที่ล็อกอินได้" (security backlog 2026-08-12 หัวข้อ S1 —
// เจ้าของสั่งให้ปิดช่องนี้). ลบทั้ง key ไม่ได้: page-lpr.js:1833 อ่านฟิลด์
// เข็มขัดนิรภัย (pilotsafebelt / vicepilotsafebelt) จาก rawXml ก้อนนี้ →
// จึง "ปกปิดค่า" ไม่ใช่ "ตัดทิ้ง". admin ยังเห็นของเต็มไว้ debug.
//
// ชื่อ tag เป็น case-sensitive ตามที่ ISAPI ส่งมาจริง (ยืนยันกับแถวจริง 3 ใบ
// 2026-09-06 — <ipAddress>10.x.x.x</ipAddress>, <macAddress>08:3b:...</macAddress>)
const TAGS = 'ipAddress|ipv6Address|macAddress';
const RE = new RegExp(`<(${TAGS})>[^<]*</\\1>`, 'g');

// pure — คืน shallow copy ไม่แตะ input · ไม่ throw ทุกกรณี
function scrubRawJson(rj) {
  if (!rj || typeof rj !== 'object') return rj;      // null/undefined/สตริง = คืนตามเดิม
  if (typeof rj.rawXml !== 'string') return rj;      // ไม่มี XML = ไม่ต้องทำอะไร
  return { ...rj, rawXml: rj.rawXml.replace(RE, '<$1>***</$1>') };
}

// เทียบเท่าฝั่ง SQL — ใช้เมื่อ SELECT list เขียนคอลัมน์ไว้ชัดอยู่แล้ว (เช่น /api/lpr)
// จะได้ไม่ต้องวนแก้ทีละแถวใน JS · ผลลัพธ์ต้องตรงกับ scrubRawJson() ข้างบน
function scrubRawJsonSql(col) {
  return `CASE WHEN ${col} ? 'rawXml'
               THEN jsonb_set(${col}, '{rawXml}', to_jsonb(regexp_replace(${col}->>'rawXml', '<(${TAGS})>[^<]*</\\1>', '<\\1>***</\\1>', 'g')))
               ELSE ${col} END`;
}

module.exports = { scrubRawJson, scrubRawJsonSql };
