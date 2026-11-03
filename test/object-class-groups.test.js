// ============================================================
// Vigil Platform — Tests: object class groups
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// เทสต์นี้มีอยู่เพราะเหตุจริง: รายชื่อ object_class ถูกก๊อบไว้ 3 ที่ แล้ว 2 ที่
// ตกคำว่า 'Pickup' ไปเงียบ ๆ ⇒ n_traffic นับรถขาด ~7% (วัดจริง 2026-08-21
// ชั่วโมงเดียว 4,311 vs 4,625) คอมเมนต์เดิมใน kpi-stats-refresher.js เขียนว่า
// "เทสต์จะจับให้" ทั้งที่ไม่เคยมีเทสต์นั้น — ไฟล์นี้คือเทสต์ตัวนั้น

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLASS_HIERARCHY, classGroup, ruleGroup, categoryGroup, sqlList,
  VEHICLE_CLASSES, PERSON_CLASSES,
} = require('../src/helpers/objectClassGroup');
const kpi = require('../src/kpi-stats-refresher');

describe('แหล่งเดียว — ห้ามมีใครก๊อบรายชื่อไปเก็บเอง', () => {
  it('kpi-stats-refresher ใช้ชุดเดียวกับ helper (ตัวเดียวกันในหน่วยความจำ)', () => {
    assert.equal(kpi.TRAFFIC_CLASSES, VEHICLE_CLASSES);
    assert.equal(kpi.PEOPLE_CLASSES, PERSON_CLASSES);
  });

  it('Pickup ต้องอยู่ในกลุ่มยานพาหนะ (บั๊กเดิมที่ทำให้นับขาด)', () => {
    assert.ok(VEHICLE_CLASSES.includes('Pickup'));
    assert.equal(classGroup('Pickup'), 'Vehicle');
  });

  it('stats-summary-route ไม่เขียนรายชื่อสดใน SQL อีก', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'stats-summary-route.js'), 'utf8');
    assert.ok(!/object_class IN \('Vehicle'/.test(src),
      'พบรายชื่อ class เขียนสดใน SQL — ต้องดึงจาก helpers/objectClassGroup.js');
    assert.ok(/VEHICLE_SQL|PERSON_SQL/.test(src));
  });
});

describe('classGroup', () => {
  it('คน', () => PERSON_CLASSES.forEach(c => assert.equal(classGroup(c), 'Person')));
  it('รถ', () => VEHICLE_CLASSES.forEach(c => assert.equal(classGroup(c), 'Vehicle')));
  it('Other ไม่ใช่ทั้งคนและรถ',
    () => CLASS_HIERARCHY.Other.forEach(c => assert.equal(classGroup(c), null)));
  it('ค่าว่าง / ไม่รู้จัก → null', () => {
    assert.equal(classGroup(null), null);
    assert.equal(classGroup(''), null);
    assert.equal(classGroup('Spaceship'), null);
  });
  it('คนกับรถต้องไม่ทับกัน',
    () => assert.equal(PERSON_CLASSES.filter(c => VEHICLE_CLASSES.includes(c)).length, 0));
});

describe('ruleGroup — กฎหนึ่งข้อ', () => {
  it('ผูก object_class', () => assert.equal(ruleGroup({ object_class: 'Car' }), 'Vehicle'));
  it('ผูกแค่ vehicle_type (แบบที่ hdy ใช้)',
    () => assert.equal(ruleGroup({ object_class: null, vehicle_type: 'pickupTruck' }), 'Vehicle'));
  it('ไม่บอกอะไรเลย → null',
    () => assert.equal(ruleGroup({ object_class: null, vehicle_type: null }), null));
});

describe('categoryGroup — ทั้งหมวด', () => {
  it('kind ที่ตั้งไว้ชนะเสมอ (People Counting ของ vss ไม่ได้ผูก class)',
    () => assert.equal(categoryGroup('people_counter', [{}, {}]), 'Person'));
  it('vehicle_counter', () => assert.equal(categoryGroup('vehicle_counter', []), 'Vehicle'));
  it('ทุกกฎไปทางเดียวกัน',
    () => assert.equal(categoryGroup('event',
      [{ object_class: 'Car' }, { object_class: 'Truck' }]), 'Vehicle'));
  it('กฎชี้คนละทาง = ตอบไม่ได้ ห้ามเดา',
    () => assert.equal(categoryGroup('event',
      [{ object_class: 'Person' }, { object_class: 'Car' }]), null));
  it('ไม่มีกฎเลย → null', () => assert.equal(categoryGroup('event', []), null));
});

describe('sqlList', () => {
  it('ต่อเป็น literal ที่วางใน IN (...) ได้',
    () => assert.equal(sqlList(['Car', 'Van']), "'Car','Van'"));
  it('ค่าที่ไม่ใช่ตัวอักษรล้วนต้องโยน ไม่ใช่ปล่อยผ่านเข้า SQL',
    () => assert.throws(() => sqlList(["x'; DROP TABLE events; --"]), /ไม่ถูกรูปแบบ/));
  it('ทุกค่าที่ใช้จริงผ่านเกณฑ์', () => {
    assert.doesNotThrow(() => sqlList(VEHICLE_CLASSES));
    assert.doesNotThrow(() => sqlList(PERSON_CLASSES));
  });
});
