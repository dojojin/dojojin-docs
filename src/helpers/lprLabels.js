// ============================================================
// Vigil Platform — Helper: LPR detector-code labels
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Detector codes (twoWheelVehicle, SUVMPV, pickupTruck) are the camera's
// vocabulary, not a language an operator reads in either locale. Every place
// that shows a vehicle type to a person has to map them, and the same mistake
// has now been made twice — once in the LPR report (fixed in place) and once in
// the LINE alert. So the map lives here, once, and both read it.
//
// Mirrors dashboard/i18n.js 'lpr.vtype.*'. Kept as its own module rather than
// parsed out of i18n.js: that file is a browser script full of UI strings, and
// reaching into it for ten of them would couple the server to its layout.
//
// Unknown codes fall through unchanged — a raw code beats a blank.
// ============================================================
'use strict';

const LPR_VTYPE_LABEL = {
  th: {
    twoWheelVehicle: 'จักรยานยนต์', threeWheelVehicle: 'รถสามล้อ', SUVMPV: 'รถอเนกประสงค์ (SUV/MPV)',
    van: 'รถตู้', pickupTruck: 'รถกระบะ', truck: 'รถบรรทุก', vehicle: 'รถยนต์',
    // 'buggy' ในศัพท์ ISAPI ของ Hikvision = รถบรรทุกเล็ก ไม่ใช่รถบักกี้ (ตรวจ
    // 2026-08-31: ภาพ 10 คันสุ่มเป็นรถบรรทุกเล็ก/หกล้อทั้งหมด และ OSD ที่กล้อง
    // เขียนบนภาพเองบอก "Light truck" ขณะที่ XML ส่ง buggy) · ค่าที่เก็บใน DB คง
    // เป็น buggy ตามศัพท์กล้อง — ที่ผิดคือป้ายแสดงผล จึงแก้เฉพาะตรงนี้ ไม่ backfill
    buggy: 'รถบรรทุกเล็ก', largeBus: 'รถบัส', pedestrian: 'คนเดินเท้า',
  },
  en: {
    twoWheelVehicle: 'Motorcycle', threeWheelVehicle: 'Tricycle', SUVMPV: 'SUV/MPV',
    van: 'Van', pickupTruck: 'Pickup Truck', truck: 'Truck', vehicle: 'Car',
    buggy: 'Light Truck', largeBus: 'Bus (Large)', pedestrian: 'Pedestrian',
  },
};

// Lowercase index, built once. The version this replaces lowercased the INPUT
// and looked it up in a camelCase map, so 'suvmpv' missed and printed itself —
// the case-insensitivity it appeared to offer only ever worked for the keys
// that were already lowercase. Dahua and Hikvision do not agree on casing, so
// make it real rather than remove it.
const _LOWER = Object.fromEntries(Object.entries(LPR_VTYPE_LABEL).map(([lang, m]) =>
  [lang, Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]))]));

function vtypeLabel(code, lang = 'th', fallback = '—') {
  if (!code) return fallback;
  const m = LPR_VTYPE_LABEL[lang] || LPR_VTYPE_LABEL.th;
  const l = _LOWER[lang] || _LOWER.th;
  return m[code] || l[String(code).toLowerCase()] || code;
}

module.exports = { LPR_VTYPE_LABEL, vtypeLabel };

if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(vtypeLabel('twoWheelVehicle'), 'จักรยานยนต์');
  assert.strictEqual(vtypeLabel('SUVMPV', 'en'), 'SUV/MPV');
  // Case-insensitive second chance: Dahua and Hikvision disagree on casing.
  assert.strictEqual(vtypeLabel('suvmpv'), 'รถอเนกประสงค์ (SUV/MPV)');
  // An unmapped code prints itself rather than vanishing — the operator can
  // still read it, and it shows up as something to add here.
  assert.strictEqual(vtypeLabel('spaceship'), 'spaceship');
  // Absent is the only case that becomes the fallback, and callers pick it:
  // the report wants an em dash in a table cell, the LINE alert wants nothing.
  assert.strictEqual(vtypeLabel(null), '—');
  assert.strictEqual(vtypeLabel(undefined, 'th', ''), '');
  console.log('lprLabels self-check: all assertions passed');
}
