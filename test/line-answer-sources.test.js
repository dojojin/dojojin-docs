// ============================================================
// Vigil Platform — Tests: ทะเบียนแหล่งข้อมูลของคำสั่งผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// payload ตัวอย่างในไฟล์นี้ตัดมาจากการยิง endpoint จริงเมื่อ 2026-09-08
// (ห้ามแต่งรูป payload ขึ้นเอง — ถ้าของจริงเปลี่ยนรูป เทสต์นี้ต้องพังให้เห็น)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SOURCES, getSource, sourceKeys } = require('../src/line-answer-sources');
const { parseThaiPeriod } = require('../src/helpers/thaiPeriod');

const NOW = new Date('2026-09-08T12:40:00Z');   // 19:40 เวลาไทย

// ── ของจริงจาก GET /api/traffic/helmet-series?date=2026-09-08 ──
const HELMET_SERIES = {
  ok: true, date: '2026-09-08',
  hourly: [
    { hour: 16, moto: 12000, no_helmet: 4000, no_helmet_ok: 3100 },
    { hour: 17, moto: 14000, no_helmet: 5000, no_helmet_ok: 3900 },
    { hour: 18, moto: 15476, no_helmet: 6294, no_helmet_ok: 4834 },
    { hour: 19, moto: 8000,  no_helmet: 2000, no_helmet_ok: 1500 },
  ],
  daily: [
    { date: '2026-09-06', moto: 180000, no_helmet: 60000 },
    { date: '2026-09-07', moto: 185703, no_helmet: 66481 },
    { date: '2026-09-08', moto: 157855, no_helmet: 52077 },
  ],
};

// ── ของจริงจาก GET /api/traffic/helmet-top?period=1d&limit=5 ──
const HELMET_TOP = {
  ok: true,
  rows: [
    { rank: 1, hits: 12, plates: [{ plate: '2กถ1909', cams: 2, region: 'สงขลา' }] },
    { rank: 2, hits: 11, plates: [{ plate: '2กง3915', cams: 4, region: 'ภูเก็ต' }] },
    { rank: 3, hits: 10, plates: [{ plate: '1กก1111', cams: 1, region: null }] },
    { rank: 4, hits: 9,  plates: [{ plate: '9ขข9999', cams: 1, region: 'ตรัง' }] },
  ],
  totals: { hits: 41249, plates: 28880, max_per_plate: 12 },
};

// ── ของจริงจาก GET /api/lpr/stats?period=today ──
const LPR_STATS = { period: 'today', total: 723181, unique: 339047, noread: 31421, vehicles: 754602 };

describe('helmet_count', () => {
  it('"ชั่วโมงที่แล้ว" นับเฉพาะชั่วโมงนั้นชั่วโมงเดียว', () => {
    const period = parseThaiPeriod('ชั่วโมงที่แล้ว', NOW);   // 18:00-18:59
    const out = SOURCES.helmet_count.format(HELMET_SERIES, { period }, NOW);
    assert.equal(out.big, '6,294', 'ต้องเป็นยอดของชั่วโมง 18 เท่านั้น ไม่ใช่ผลรวมทั้งวัน');
    assert.match(out.note, /15,476 คัน/);
    assert.deepEqual(out.rows, [], 'ชั่วโมงเดียวไม่ต้องแจงรายชั่วโมง');
  });

  it('ถามวันนี้ = รวมทุกชั่วโมงถึงตอนนี้ + แจงชั่วโมงที่หนักสุด', () => {
    const period = parseThaiPeriod('วันนี้', NOW);
    const out = SOURCES.helmet_count.format(HELMET_SERIES, { period }, NOW);
    assert.equal(out.big, '17,294');            // 4000+5000+6294+2000
    assert.equal(out.rows[0][0], '18:00', 'แถวแรกต้องเป็นชั่วโมงที่หนักที่สุด');
  });

  it('ช่วงหลายวันเปลี่ยนไปใช้ชุดรายวัน ไม่ใช่รายชั่วโมงของวันเดียว', () => {
    const period = parseThaiPeriod('3 วัน', NOW);
    const out = SOURCES.helmet_count.format(HELMET_SERIES, { period }, NOW);
    assert.equal(out.big, '178,558');           // 60000+66481+52077
    assert.equal(out.rows.length, 3);
  });

  it('query() ขอวันที่ตามปลายช่วง (เวลาไทย) ไม่ใช่ตามเครื่อง', () => {
    const period = parseThaiPeriod('เมื่อวาน', NOW);
    assert.deepEqual(SOURCES.helmet_count.query({ period }, NOW), { date: '2026-09-07' });
  });

  it('ไม่มีข้อมูลตอบว่าไม่มี ไม่ใช่เลข 0 ลอย ๆ', () => {
    const period = parseThaiPeriod('ชั่วโมงที่แล้ว', NOW);
    const out = SOURCES.helmet_count.format({ hourly: [], daily: [] }, { period }, NOW);
    assert.equal(out.empty, true);
  });
});

describe('helmet_top / violation_top', () => {
  it('ขอ 3 ป้ายได้ 3 แถว เรียงตามจำนวนครั้ง', () => {
    const out = SOURCES.violation_top.format(HELMET_TOP, { limit: 3 });
    assert.equal(out.rows.length, 3);
    assert.equal(out.rows[0][0], '2กถ1909 (สงขลา)');
    assert.equal(out.rows[0][1], '12 ครั้ง');
  });

  it('บรรทัดท้ายบอกแค่นับจากอะไร ไม่มีตัวเลขรวม (เจ้าของสั่ง 2026-09-08)', () => {
    const out = SOURCES.violation_top.format(HELMET_TOP, { limit: 3 });
    assert.equal(out.note, 'นับเฉพาะป้ายที่รูปพร้อมข้อมูลทะเบียนชัดเจน');
    assert.ok(!/\d/.test(out.note), 'ห้ามมีตัวเลขในบรรทัดนี้');
  });

  it('ป้ายที่ไม่รู้จังหวัดไม่ขึ้นวงเล็บว่าง', () => {
    const out = SOURCES.violation_top.format(HELMET_TOP, { limit: 3 });
    assert.equal(out.rows[2][0], '1กก1111');
  });

  it('แปลงช่วงเวลาเป็น preset ที่ endpoint รู้จักเท่านั้น', () => {
    const q = (s) => SOURCES.helmet_top.query({ period: parseThaiPeriod(s, NOW), limit: 3 }, NOW);
    assert.equal(q('วันนี้').period, 'day');
    assert.equal(q('เมื่อวาน').period, 'yesterday');
    assert.equal(q('3 วัน').period, 'd3');
    assert.equal(q('7 วัน').period, 'd7');
    assert.equal(q('เดือนที่แล้ว').period, 'custom');
    assert.equal(q('ชั่วโมงที่แล้ว').period, 'day', 'endpoint นี้ละเอียดสุดแค่ระดับวัน');
  });

  it('limit ถูกบีบให้อยู่ในช่วงที่ endpoint รับ (5-20)', () => {
    assert.equal(SOURCES.helmet_top.query({ limit: 3 }, NOW).limit, 5);
    assert.equal(SOURCES.helmet_top.query({ limit: 99 }, NOW).limit, 20);
  });

  it('violation_top ใช้แหล่งเดียวกับ helmet_top แต่คนละหัวการ์ด', () => {
    assert.equal(SOURCES.violation_top.path, SOURCES.helmet_top.path);
    assert.notEqual(SOURCES.violation_top.label, SOURCES.helmet_top.label);
  });
});

describe('lpr_count', () => {
  it('ตัวเลขหลักคือป้ายที่อ่านได้ พร้อมยอดอ่านไม่ได้', () => {
    const out = SOURCES.lpr_count.format(LPR_STATS);
    assert.equal(out.big, '723,181');
    assert.equal(out.rows[0][1], '31,421');
    // เดิมท้ายการ์ดเขียนอัตราการอ่านได้เป็น % — ตัดออกตามคำสั่ง "ถามจำนวนไม่ต้องมี %"
    assert.ok(!out.note.includes('%'));
    assert.match(out.note, /อ่านป้ายทะเบียน/);
  });

  it('ช่วงที่ไม่ใช่วันนี้/เมื่อวาน ส่งเป็น custom พร้อมเวลาเต็ม', () => {
    const q = SOURCES.lpr_count.query({ period: parseThaiPeriod('ชั่วโมงที่แล้ว', NOW) }, NOW);
    assert.equal(q.period, 'custom');
    assert.equal(q.from, '2026-09-08T11:00:00.000Z');   // 18:00 เวลาไทย
  });
});

describe('กติกาของทะเบียน', () => {
  it('ทุกแหล่งมี path ที่ขึ้นต้นด้วย /api/ และมี format', () => {
    for (const k of sourceKeys()) {
      const s = getSource(k);
      assert.match(s.path, /^\/api\//, k);
      assert.equal(typeof s.format, 'function', k);
      assert.equal(typeof s.query, 'function', k);
    }
  });

  it('ทุก source_key ที่ migration seed ไว้ มีอยู่จริงในทะเบียน', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'db_migration_201_line_commands.sql'), 'utf8');
    const keys = [...sql.matchAll(/^\s*\('([a-z_]+)', '[^']*', '([a-z_]+)'/gm)].map((m) => m[2]);
    assert.ok(keys.length >= 4, 'อ่าน source_key จาก migration ไม่เจอ');
    for (const k of keys) assert.ok(getSource(k), `migration อ้าง source_key ที่ไม่มีในทะเบียน: ${k}`);
  });
});

// พบจากภาพหน้าจอจริง 2026-09-15: การ์ด "กล้องที่ออฟไลน์ตอนนี้" ปัดเศษเป็นชั่วโมงเต็ม
// (Math.round(sec/3600)) ทำให้กล้องที่เพิ่งดับไม่ถึงชั่วโมงขึ้น "0 ชม." ซึ่งไม่มีความหมาย
describe('กล้องที่ออฟไลน์', () => {
  // ตัวเลขจริงจากภาพหน้าจอ — ปลักปลาดับมา 18 ชม., C56-59 ดับมา 13 นาที, C2 ดับมา 12 นาที
  const HEALTH = { cameras: { total: 169, list: [
    { id: 'c-plakpla', name: 'ปลักปลา', status: 'offline', last_seen_sec: 64800 },
    { id: 'c56', name: 'C56-PKT-SB-17', status: 'offline', last_seen_sec: 780 },
    { id: 'c57', name: 'C57-PKT-SB-17', status: 'offline', last_seen_sec: 790 },
    { id: 'c58', name: 'C58-PKT-SB-17', status: 'offline', last_seen_sec: 800 },
    { id: 'c59', name: 'C59-PKT-SB-17', status: 'offline', last_seen_sec: 810 },
    { id: 'c2', name: 'C2-KML-SB-02', status: 'offline', last_seen_sec: 720 },
    { id: 'c-ok', name: 'C1-ONLINE', status: 'online', last_seen_sec: 5 },
  ] } };

  it('ดับไม่ถึงชั่วโมงต้องขึ้นเป็นนาที ไม่ใช่ "0 ชม." (บั๊กจากภาพหน้าจอ 2026-09-15)', () => {
    const out = SOURCES.camera_offline.format(HEALTH, {});
    const row = out.rows.find(([name]) => name === 'C56-PKT-SB-17');
    assert.equal(row[1], '13 นาที');
    assert.ok(!out.rows.some(([, dur]) => dur === '0 ชม.'), 'ห้ามมี "0 ชม." หลุดออกมาในการ์ด');
  });

  it('เรียงกล้องที่ดับนานสุดขึ้นก่อน', () => {
    const out = SOURCES.camera_offline.format(HEALTH, {});
    assert.equal(out.rows[0][0], 'ปลักปลา');
    assert.equal(out.rows[0][1], '18 ชม.');
  });

  it('นับเฉพาะกล้อง offline ไม่รวม online', () => {
    const out = SOURCES.camera_offline.format(HEALTH, {});
    assert.equal(out.big, '6');
    assert.equal(out.unit, 'จาก 169 ตัว');
    assert.equal(out.rowsTotal, 6);
  });

  it('ไม่มีกล้องออฟไลน์เลยตอบว่าไม่มี', () => {
    const out = SOURCES.camera_offline.format({ cameras: { total: 5, list: [] } }, {});
    assert.equal(out.empty, true);
  });

  it('กล้องที่ pause ไม่ถูกนับเป็นออฟไลน์ (ตรวจ 31 ต.ค.)', () => {
    const data = { cameras: { total: 3, list: [
      { id: 'a', name: 'A', status: 'offline', last_seen_sec: 600 },
      { id: 'b', name: 'B', status: 'paused', last_seen_sec: 99999 },
      { id: 'c', name: 'C', status: 'online', last_seen_sec: 3 },
    ] } };
    const out = SOURCES.camera_offline.format(data, {});
    assert.equal(out.rowsTotal, 1);
    assert.deepEqual(out.rows.map(([n]) => n), ['A']);
  });

  it('กรองตาม _cameras เมื่อระบุขอบเขตกล้อง/ไซต์', () => {
    const out = SOURCES.camera_offline.format(HEALTH, { _cameras: ['c56', 'c57'] });
    assert.equal(out.rowsTotal, 2);
    assert.equal(out.unit, 'จาก 2 ตัว');
  });
});

// เจ้าของสั่งเพิ่ม 2026-09-08: จำนวนรถแยกประเภท (ทุกไซต์) และขอรูปรถตามช่วงเวลา
describe('จำนวนรถแยกตามประเภท', () => {
  const VTYPE = { vtype: [
    { type: 'twoWheelVehicle', n: 156316 }, { type: 'SUVMPV', n: 73380 },
    { type: 'vehicle', n: 59805 }, { type: 'pickupTruck', n: 38644 },
  ] };

  it('แปลรหัสประเภทเป็นภาษาไทย · ถามจำนวนต้องไม่มี % (เจ้าของสั่ง 2026-09-09)', () => {
    const out = SOURCES.vehicle_types.format(VTYPE, {}, NOW);
    assert.equal(out.big, '328,145');
    assert.equal(out.rows[0][0], 'จักรยานยนต์');
    assert.equal(out.rows[0][1], '156,316');
    assert.ok(!out.rows.some(([, v]) => String(v).includes('%')), 'ห้ามมี % ในบรรทัดจำนวน');
  });

  it('บอกด้วยว่านับจากกล้องอ่านป้าย — ไซต์เดียวกันมีอีกแหล่งที่นับรถได้เหมือนกัน', () => {
    assert.match(SOURCES.vehicle_types.format(VTYPE, {}, NOW).note, /อ่านป้ายทะเบียน/);
  });

  it('ไซต์ที่ไม่มีรถประเภทนั้น จะไม่มีบรรทัดของมัน ไม่ใช่ขึ้นเลข 0', () => {
    const out = SOURCES.vehicle_types.format({ vtype: [{ type: 'vehicle', n: 5 }] }, {}, NOW);
    assert.equal(out.rows.length, 1);
  });

  it('ไม่มีข้อมูลเลยตอบว่าไม่มี', () => {
    assert.equal(SOURCES.vehicle_types.format({ vtype: [] }, {}, NOW).empty, true);
  });
});

describe('ขอรูปรถของป้ายทะเบียน', () => {
  const ROWS = [
    { snapshot_file: 'lpr/2026-09-08/C4/1800/a.jpg', plate_number: '1กอ88',
      camera_id: 'C4-CHL-SB-01', event_time: '2026-09-08T11:01:54.000Z' },
    { snapshot_file: null, plate_number: '1กอ88', camera_id: 'C9', event_time: '2026-09-08T10:00:00.000Z' },
  ];

  it('เอาเฉพาะแถวที่มีไฟล์ภาพ และใส่ชื่อกล้อง/เวลาไทยเป็นคำบรรยาย', () => {
    const out = SOURCES.plate_photos.format(ROWS,
      { plate: '1กอ88', _camNames: { 'C4-CHL-SB-01': 'ขาออกตำบลฉลอง (C4)' } }, NOW);
    assert.equal(out.photos.length, 1, 'แถวที่ไม่มีภาพต้องไม่ถูกนับ');
    assert.equal(out.photos[0].title, '1กอ88');
    assert.match(out.photos[0].caption, /ขาออกตำบลฉลอง/);
    assert.match(out.photos[0].caption, /18:01/, 'เวลาต้องเป็นเวลาไทย');
  });

  it('มีรถแต่ไม่มีภาพ ต้องบอกให้ตรงว่าอะไรไม่มี', () => {
    const out = SOURCES.plate_photos.format([ROWS[1]], { plate: '1กอ88' }, NOW);
    assert.equal(out.empty, true);
    assert.match(out.emptyText, /ไม่มีภาพ/);
  });

  it('ขอมาเกินที่จะแสดงเสมอ เพื่อรู้ว่ามีมากกว่านั้นไหม', () => {
    // LINE แสดง carousel ได้ 12 ใบ (ใบแรกเป็นสรุป) แต่ถ้าขอมาแค่นั้นจะไม่มีทางรู้ว่า
    // ของจริงมีมากกว่า แล้วคนอ่านจะนึกว่าเห็นครบแล้ว (เจ้าของสั่งให้บอก 2026-09-08)
    assert.ok(SOURCES.plate_photos.query({ plate: 'x' }, NOW).limit > 12);
    assert.equal(SOURCES.plate_photos.query({ plate: 'x' }, NOW).exact, '1',
      'ต้องค้นแบบตรงเป๊ะเสมอ ไม่งั้นได้ป้ายคนอื่นปนมา');
  });

  it('มีมากกว่าที่แสดงได้ ต้องบอกจำนวนจริงบนการ์ด', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      snapshot_file: `f${i}.jpg`, plate_number: '1กอ88', camera_id: 'C9',
      event_time: '2026-09-08T15:24:00.000Z' }));
    const out = SOURCES.plate_photos.format(many, { plate: '1กอ88' }, NOW);
    assert.equal(out.photos.length, 10, 'แสดงได้ 10 ใบ (ที่เหลือของ carousel เป็นใบสรุป)');
    assert.match(out.note, /จากทั้งหมด 25 ภาพ/);
  });
});

// เจ้าของชี้การ์ด "หมวดกำหนดเอง (แยกนับ)" บนหน้าสถิติแล้วสั่งให้ถามจากใน LINE ได้
// ตัวเลขในแชทกับบนจอต้องตรงกัน — หน้าเว็บรวม (IN)/(OUT) เป็นการ์ดเดียว ที่นี่ต้องรวมเหมือนกัน
describe('หมวดเหตุการณ์', () => {
  const CATS = { categories: [
    { id: 1, name: 'รถจักรยานยนต์ (IN)',  count: 4256, prev_count: 4302 },
    { id: 2, name: 'รถจักรยานยนต์ (OUT)', count: 4322, prev_count: 4298 },
    { id: 3, name: 'รถยนต์ (IN)',  count: 1859, prev_count: 1805 },
    { id: 4, name: 'รถยนต์ (OUT)', count: 1805, prev_count: 1745 },
    { id: 5, name: 'ตรวจจับคนทิ้งขยะ', count: 294, prev_count: 2 },
    { id: 6, name: 'หมวดที่ไม่มีข้อมูล', count: 0, prev_count: 0 },
  ] };

  it('รวม (IN)/(OUT) เป็นแถวเดียว · เข้า/ออก อยู่บรรทัดย่อยใต้ชื่อ ไม่ใช่ต่อท้ายชื่อ', () => {
    const out = SOURCES.category_counts.format(CATS, {}, NOW);
    assert.equal(out.rows[0][0], 'รถจักรยานยนต์');
    assert.equal(out.rows[0][1], '8,578');
    assert.equal(out.rows[0][2], 'เข้า 4,256 · ออก 4,322');
  });

  it('ด้านที่เป็น 0 ไม่ต้องเขียน — "เข้า 0 ออก 1" อ่านแล้วสะดุดโดยไม่ได้ข้อมูลเพิ่ม', () => {
    const out = SOURCES.category_counts.format(
      { categories: [{ id: 1, name: 'รถบัส (IN)', count: 0, prev_count: 0 },
                     { id: 2, name: 'รถบัส (OUT)', count: 1, prev_count: 0 }] }, {}, NOW);
    assert.equal(out.rows[0][2], 'ออก 1');
  });

  it('ถามจำนวนต้องไม่มี % ติดมาเลยสักบรรทัด (เจ้าของสั่ง 2026-09-09)', () => {
    const out = SOURCES.category_counts.format(CATS, {}, NOW);
    assert.ok(!out.rows.some(([, v]) => String(v).includes('%')), 'ห้ามมี % ในบรรทัดจำนวน');
    assert.ok(!out.rows.some(([, v]) => String(v).includes('เท่าเดิม')));
  });

  // 🔴 การ์ดนี้กับ "จำนวนรถแยกตามประเภท" นับรถคนละแหล่งกัน และที่ RMUTR-V มีทั้งคู่
  // (Bosch นับเส้น 12,273 ครั้ง · Dahua ANPR 7,246 คัน วันเดียวกัน) — เจ้าของทักเอง
  it('บอกด้วยว่านับจากกล้องวิเคราะห์ภาพ ไม่ใช่กล้องอ่านป้าย', () => {
    const out = SOURCES.category_counts.format(CATS, {}, NOW);
    assert.match(out.note, /กล้องวิเคราะห์ภาพ/);
    assert.match(out.note, /ไม่ใช่กล้องอ่านป้าย/);
  });

  it('หมวดที่ไม่มีข้อมูลไม่ขึ้นเป็นแถวเลข 0', () => {
    const out = SOURCES.category_counts.format(CATS, {}, NOW);
    assert.ok(!out.rows.some(([k]) => k.includes('ไม่มีข้อมูล')));
  });

  // เจ้าของพิมพ์ "…เฉพาะ รถจักรยานยนต์" แล้วได้ทุกหมวดเหมือนเดิม (2026-09-09)
  it('ระบุหมวดเดียว = ตัวเลขใหญ่เป็นของหมวดนั้น และแจงเข้า/ออก แทนการซ้ำชื่อหมวด', () => {
    const out = SOURCES.category_counts.format(CATS, { category: 'รถจักรยานยนต์' }, NOW);
    assert.equal(out.big, '8,578');
    assert.deepEqual(out.rows, [['เข้า', '4,256'], ['ออก', '4,322']]);
    assert.equal(out.rowsTotal, null, 'มีแถวเดียวไม่ต้องขึ้น "แสดง x จาก y"');
  });

  it('หมวดที่ระบุไม่มีข้อมูลในช่วงนั้น ต้องบอกชื่อหมวดในคำตอบ', () => {
    const out = SOURCES.category_counts.format(
      { categories: [{ id: 1, name: 'รถบัส (IN)', count: 0, prev_count: 0 }] },
      { category: 'รถบัส' }, NOW);
    assert.equal(out.empty, true);
    assert.match(out.emptyText, /รถบัส/);
  });

  it('ไซต์ที่ยังไม่ได้ตั้งหมวด ต้องบอกให้ตรง ไม่ใช่ "ไม่พบข้อมูลในช่วงเวลานี้"', () => {
    const out = SOURCES.category_counts.format({ categories: [] }, {}, NOW);
    assert.equal(out.empty, true);
    assert.match(out.emptyText, /ยังไม่ได้ตั้งหมวด/);
  });
});

// เจ้าของถาม 2026-09-09 หลังเปิดหน้ารายละเอียดเหตุการณ์: ขอรูป/ข้อมูลรถคันนี้ในช่วงเวลานี้
describe('รูปเหตุการณ์จากกล้อง', () => {
  const EV = [
    { id: 1, camera_id: 'BH5100i_RMUTR-V_02', object_class: 'Truck',
      event_time: '2026-09-08T11:14:39Z', snapshot_file: 'events/a_crop.jpg',
      raw_json: { _snapshot_full: 'events/a_full.jpg', _speed_avg: 6.56 } },
    { id: 2, camera_id: 'DAHUA-ANPR-CAM01', object_class: 'Truck',
      event_time: '2026-09-08T11:23:00Z', snapshot_file: 'events/b.jpg', raw_json: {} },
    { id: 3, camera_id: 'BH5100i_RMUTR-V_02', object_class: 'Truck',
      event_time: '2026-09-08T11:30:00Z', snapshot_file: null, raw_json: {} },
  ];
  const SLOTS = { object_class: 'Truck', _camNames: { 'BH5100i_RMUTR-V_02': 'BH5100i Check' } };

  it('ใช้ภาพเต็มเฟรมถ้ามี · ตกไปใช้ภาพครอปเมื่อไม่มี · แถวไม่มีภาพไม่ถูกนับ', () => {
    const out = SOURCES.event_photos.format(EV, SLOTS, NOW);
    assert.equal(out.photos.length, 2);
    assert.equal(out.photos[0].file, 'events/a_full.jpg');
    assert.equal(out.photos[1].file, 'events/b.jpg');
  });

  it('คำบรรยายเป็น เวลาไทย · ชื่อกล้อง · ความเร็ว กม./ชม.', () => {
    const out = SOURCES.event_photos.format(EV, SLOTS, NOW);
    assert.equal(out.photos[0].title, 'รถบรรทุก');
    assert.match(out.photos[0].caption, /^18:14/);
    assert.match(out.photos[0].caption, /BH5100i Check/);
    assert.match(out.photos[0].caption, /24 กม\.\/ชม\./, '6.56 m/s = 24 กม./ชม. ตรงกับหน้าจอ');
  });

  it('มีเหตุการณ์แต่ภาพหมดอายุ ≠ ไม่มีเหตุการณ์ — ต้องบอกคนละแบบ', () => {
    const gone = SOURCES.event_photos.format([EV[2]], SLOTS, NOW);
    assert.match(gone.emptyText, /ถูกลบตามอายุ/);
    const none = SOURCES.event_photos.format([], SLOTS, NOW);
    assert.match(none.emptyText, /ไม่พบเหตุการณ์/);
  });

  // วัดจริงบน events 40M แถว: ค้นรหัสวัตถุ 7 วัน = 39.7 วิ · 1 วัน = 2.5-4.4 วิ
  it('ค้นด้วยรหัสวัตถุถูกจำกัดไว้ 1 วัน และต้องเขียนบอกบนการ์ด', () => {
    const wide = { object_id: '121766',
      period: { kind: 'range', from: new Date('2026-09-01T00:00:00Z'),
                to: new Date('2026-09-08T00:00:00Z'), label: '7 วัน' } };
    const q = SOURCES.event_photos.query(wide, NOW);
    assert.equal(q.from, '2026-09-07T00:00:00.000Z', 'ต้องถูกหั่นเหลือ 1 วันสุดท้าย');
    assert.equal(q.object_id, '121766');
    assert.match(SOURCES.event_photos.format([], wide, NOW).note, /ทีละ 1 วัน/);
  });
});
