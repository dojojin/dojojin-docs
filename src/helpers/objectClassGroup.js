// ============================================================
// Vigil Platform — จัดกลุ่ม object_class เป็น "คน / ยานพาหนะ"
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// กล้องแต่ละยี่ห้อเรียกวัตถุเดียวกันคนละชื่อ (Motorcycle / Motorbike, Person /
// Pedestrian) ไฟล์นี้เป็นจุดเดียวที่รู้ว่าชื่อไหนคือคน ชื่อไหนคือรถ
//
// ⚠️ เคยถูกก๊อบไว้ 3 ที่แล้ว drift กัน — kpi-stats-refresher.js กับ
//    stats-summary-route.js เคยไม่มี 'Pickup' ทั้งที่ของจริงมี Pickup
//    เข้ามาจาก anprAlarm หลักแสนต่อ 2 วัน ⇒ n_traffic นับรถขาดไป ~7%
//    (วัดจริง 2026-08-21: ชั่วโมงเดียว 4,311 vs 4,625) · ทั้งสองที่มาใช้
//    ไฟล์นี้แล้ว และมี src/tests/object-class-groups.test.js กันไม่ให้ drift ซ้ำ

const CLASS_HIERARCHY = {
  Person:  ['Person', 'Face', 'HumanFace', 'HumanBody', 'Pedestrian'],
  Vehicle: ['Vehicle', 'Car', 'Truck', 'Pickup', 'Bus', 'Motorcycle', 'Motorbike', 'Van', 'Bicycle', 'Bike'],
  Other:   ['Animal', 'LicensePlate', 'Object'],
};

// สำหรับที่ที่ต้องเอาไปต่อเป็น SQL — คืน "'A','B','C'" ที่พร้อมวางใน IN (...)
// กันไว้ด้วย assert: ค่าทั้งหมดมาจากคงที่ในไฟล์นี้ ไม่มีทางมาจากผู้ใช้ แต่ถ้ามีใคร
// เผลอเติมค่าแปลก ๆ เข้ามาทีหลัง ให้ล้มตั้งแต่ boot ดีกว่าหลุดเป็น SQL injection
function sqlList(classes) {
  for (const c of classes) {
    if (!/^[A-Za-z]+$/.test(c)) throw new Error(`object_class ไม่ถูกรูปแบบ: ${JSON.stringify(c)}`);
  }
  return classes.map((c) => `'${c}'`).join(',');
}

const _PERSON  = new Set(CLASS_HIERARCHY.Person);
const _VEHICLE = new Set(CLASS_HIERARCHY.Vehicle);

// object_class ตัวเดียว → 'Person' | 'Vehicle' | null
function classGroup(objectClass) {
  if (!objectClass) return null;
  if (_PERSON.has(objectClass)) return 'Person';
  if (_VEHICLE.has(objectClass)) return 'Vehicle';
  return null;
}

// กฎหนึ่งข้อ → กลุ่ม · กฎที่ไม่บอกอะไรเลยคืน null (ไม่ใช่ 'Other')
// vehicle_type เป็นของฝั่ง LPR (twoWheelVehicle / pickupTruck / SUVMPV …)
// กฎที่ผูก vehicle_type ไว้ = ยานพาหนะแน่นอน ไม่ต้องรู้ว่าเป็นชนิดไหน
function ruleGroup(rule) {
  return classGroup(rule && rule.object_class)
      || ((rule && rule.vehicle_type) ? 'Vehicle' : null);
}

// หมวดหนึ่งหมวด → กลุ่ม · ใช้สรุปการ์ด "บุคคล / ยานพาหนะ" ในรายงาน
//   1) kind ที่ตั้งไว้ตรง ๆ ชนะเสมอ — หมวด People Counting ของ vss ไม่ได้ผูก
//      object_class ไว้เลย ถ้าไม่เช็ค kind ก่อน ตัวเลขที่เคยมีจะกลายเป็น 0
//   2) ที่เหลือดูจากกฎของหมวดนั้น — ต้องไปทางเดียวกันหมดถึงจะนับ
//      ปนคนปนรถ หรือไม่มีกฎไหนบอกเลย = null (ยังอยู่ในกราฟ แต่ไม่เข้าการ์ด)
function categoryGroup(kind, rules) {
  if (kind === 'people_counter') return 'Person';
  if (kind === 'vehicle_counter') return 'Vehicle';
  const groups = new Set((rules || []).map(ruleGroup).filter(Boolean));
  return groups.size === 1 ? [...groups][0] : null;
}

module.exports = {
  CLASS_HIERARCHY, classGroup, ruleGroup, categoryGroup, sqlList,
  PERSON_CLASSES:  CLASS_HIERARCHY.Person,
  VEHICLE_CLASSES: CLASS_HIERARCHY.Vehicle,
};

// self-check: node src/helpers/objectClassGroup.js
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(classGroup('Pickup'), 'Vehicle', 'Pickup ต้องเป็นยานพาหนะ');
  assert.strictEqual(classGroup('Pedestrian'), 'Person');
  assert.strictEqual(classGroup('LicensePlate'), null, 'Other ไม่ใช่ทั้งคนและรถ');
  assert.strictEqual(classGroup(null), null);
  assert.strictEqual(ruleGroup({ object_class: null, vehicle_type: 'twoWheelVehicle' }), 'Vehicle',
    'กฎแบบ hdy ที่ผูกแค่ vehicle_type');
  assert.strictEqual(ruleGroup({ object_class: null, vehicle_type: null }), null);
  // vss: People Counting ไม่มี object_class เลย ต้องรอดด้วย kind
  assert.strictEqual(categoryGroup('people_counter', [{}, {}]), 'Person');
  // rmutr-v: หมวดละ class เดียว
  assert.strictEqual(categoryGroup('event', [{ object_class: 'Motorcycle' }]), 'Vehicle');
  assert.strictEqual(categoryGroup('event', [{ object_class: 'Person' }]), 'Person');
  // ปนกัน = ตอบไม่ได้ ห้ามเดา
  assert.strictEqual(categoryGroup('event', [{ object_class: 'Person' }, { object_class: 'Car' }]), null);
  // ไม่มีกฎไหนบอกอะไรเลย
  assert.strictEqual(categoryGroup('event', [{ object_class: null, vehicle_type: null }]), null);
  assert.strictEqual(categoryGroup('event', []), null);
  assert.strictEqual(sqlList(['Car', 'Van']), "'Car','Van'");
  assert.throws(() => sqlList(["Car'; DROP TABLE events; --"]), /ไม่ถูกรูปแบบ/);
  console.log('objectClassGroup: ผ่านทุกข้อ');
}
