// ============================================================
// Vigil Platform — Tests: ตัวเฝ้า "กล้องเงียบ" ที่เทียบกับนิสัยของกล้องเอง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา 2026-09-12: กล้องภูเก็ต 4 ตัวหยุดส่งข้อมูล 09:13–18:00 น. โดยไม่มีตัวไหนเตือน
//
// สี่อย่างที่เทสต์นี้ยึดไว้ และพังได้เงียบมากถ้าไม่มีใครยึด:
//   1. ตั้งต้น **ปิด** LINE และ `recipient_ids` ว่าง = ไม่ส่งหาใครเลย (ไม่ใช่ "ทุกคน")
//      — เจ้าของสั่งชัด: ยังไม่ได้กำหนดกลุ่ม ถ้าหลุดเข้ากลุ่มลูกค้า/ตำรวจจะยุ่ง
//   2. **สถานะต้องคำนวณเสมอ แม้ LINE ปิด** — ไม่งั้นป้ายบนหน้าจอไม่มีตัวเลขให้อ่าน
//      (บั๊กที่ผมเขียนเองในรอบแรก แล้วเจอตอนเจ้าของถามเรื่อง popup)
//   3. เกณฑ์มาจาก **p99 ของกล้องเอง** ไม่ใช่ max — max ของกล้องที่เพิ่งเกิดเหตุ
//      คือตัวเหตุการณ์นั้นเอง ⇒ ใช้ max = เหตุการณ์กลายเป็นนิสัยปกติของกล้องทันที
//   4. วัดจาก received_at ไม่ใช่ event_time — ของที่บัฟเฟอร์พกเวลาเดิมติดมาด้วย

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { _quietAlertSettings, _quietThresholdMs } = require('../src/alert-engine');

const CFG = _quietAlertSettings({});   // ค่าตั้งต้น: floor 20 · ×3 · เพดานฐาน 30 · ตัวอย่าง 100

describe('ค่าตั้งต้นต้องปลอดภัยเมื่อยังไม่มีใครตั้งอะไรเลย', () => {
  it('ไม่มีค่าในฐานข้อมูล = LINE ปิด และไม่มีผู้รับ', () => {
    for (const raw of [undefined, null, {}]) {
      const c = _quietAlertSettings(raw);
      assert.equal(c.enabled, false);
      assert.deepEqual(c.recipient_ids, []);
    }
  });

  it('enabled ต้องเป็น true เป๊ะ ๆ เท่านั้น — ค่าที่ "ดูเหมือนจริง" ไม่นับ', () => {
    for (const v of ['true', 1, 'yes', {}, [], 'on']) {
      assert.equal(_quietAlertSettings({ enabled: v }).enabled, false, `ค่า ${JSON.stringify(v)} ต้องไม่เปิด`);
    }
    assert.equal(_quietAlertSettings({ enabled: true }).enabled, true);
  });

  it('recipient_ids = null แปลว่า "ไม่ส่ง" ไม่ใช่ "ทุกคน" (ตรงข้ามกับ edge_alert)', () => {
    assert.deepEqual(_quietAlertSettings({ recipient_ids: null }).recipient_ids, []);
    assert.deepEqual(_quietAlertSettings({ recipient_ids: 'Uxxxx' }).recipient_ids, [],
      'ค่าที่ไม่ใช่อาร์เรย์ต้องกลายเป็นไม่มีผู้รับ ไม่ใช่ตกไปเป็นค่าที่กว้างกว่า');
    assert.deepEqual(_quietAlertSettings({ recipient_ids: ['U1', 'U2'] }).recipient_ids, ['U1', 'U2']);
  });

  it('ค่าตัวเลขที่พังตกไปที่ default และมีพื้นกันค่าที่ทำให้กลายเป็นเครื่องผลิตสแปม', () => {
    assert.equal(CFG.floor_min, 20);
    assert.equal(CFG.multiplier, 3);
    assert.equal(CFG.baseline_ceiling_min, 30);
    assert.equal(CFG.min_samples, 100);
    assert.equal(_quietAlertSettings({ floor_min: 1 }).floor_min, 5, 'พื้นต่ำสุด 5 นาที');
    assert.equal(_quietAlertSettings({ multiplier: 0 }).multiplier, 1, 'ตัวคูณต่ำสุด 1 เท่า');
    assert.equal(_quietAlertSettings({ floor_min: 'มั่ว' }).floor_min, 20);
    assert.equal(_quietAlertSettings({ cooldown_hours: 0 }).cooldown_ms, 0.1 * 3600 * 1000);
  });
});

// ── หัวใจของเรื่อง: ตัวเลขทุกตัวข้างล่างวัดมาจากของจริง 7 วัน (274,359 ช่อง) ──
describe('_quietThresholdMs — กล้องบอกเกณฑ์ของตัวเอง', () => {
  const th = (p99_min, samples = 2000, cfg = CFG) => _quietThresholdMs(cfg, { p99_min, samples });

  it('กล้องที่ยังไม่มีฐาน หรือตัวอย่างน้อยเกินไป = ยังไม่เฝ้า (ไม่ใช่เฝ้าแล้วสแปม)', () => {
    assert.equal(_quietThresholdMs(CFG, null), null, 'กล้องติดใหม่ยังไม่มีฐาน');
    assert.equal(_quietThresholdMs(CFG, undefined), null);
    assert.equal(th(5, 99), null, 'ตัวอย่าง 99 ช่อง — ต่ำกว่า min_samples');
    assert.equal(th(5, 100), 20 * 60000, 'ตัวอย่าง 100 ช่องพอดี = เริ่มเฝ้าได้');
  });

  it('4 กล้องที่ค้างจริงวันที่ 12 ก.ย. ต้องถูกเฝ้า และเหตุการณ์ต้องทะลุเกณฑ์', () => {
    const INCIDENT_MS = 530 * 60000;                 // เงียบจริง 530 นาที
    for (const [cam, p99] of [['C9-KAR', 5], ['C10-KAR', 5], ['C17-KAR', 5], ['C30-KAR', 10]]) {
      const t = th(p99);
      assert.notEqual(t, null, `${cam} ต้องอยู่ในข่ายเฝ้า`);
      assert.ok(INCIDENT_MS > t, `${cam}: เหตุการณ์ 530 นาที ต้องทะลุเกณฑ์ ${t / 60000} นาที`);
    }
  });

  it('11 กล้องที่ความเงียบเป็นสภาพปกติ ต้องถูกยกเว้นเองทั้งหมด', () => {
    // p99 ของจริง: HDY-NVR ประตู 35/65/80/93/225/658/1509 · กล้องโชว์ 514/718/1066/1298
    for (const p99 of [35, 65, 80, 93, 225, 514, 658, 718, 1066, 1298, 1509]) {
      assert.equal(th(p99), null, `p99 ${p99} นาที ต้องถูกยกเว้น (เกินเพดาน 30)`);
    }
  });

  it('เส้นเพดานคือ "น้อยกว่าหรือเท่ากับ" ไม่ใช่ off-by-one', () => {
    assert.notEqual(th(30), null, 'p99 = 30 พอดี ยังเฝ้าได้');
    assert.equal(th(31), null, 'p99 = 31 เกินแล้ว');
  });

  it('กล้องที่จังหวะถี่มากใช้พื้น 20 นาที ไม่ใช่ 3×p99 ที่เล็กกว่านั้น', () => {
    assert.equal(th(1), 20 * 60000, '3×1 = 3 นาที ต่ำกว่าพื้น ⇒ ใช้พื้น');
    assert.equal(th(5), 20 * 60000, '3×5 = 15 นาที ยังต่ำกว่าพื้น');
    assert.equal(th(10), 30 * 60000, '3×10 = 30 นาที สูงกว่าพื้นแล้ว ⇒ ใช้ของตัวเอง');
    assert.equal(th(30), 90 * 60000, 'สูงสุดในกลุ่มที่เฝ้าได้');
  });

  it('ตั้งค่าเองได้ครบทุกปุ่ม', () => {
    assert.equal(th(50, 2000, _quietAlertSettings({ baseline_ceiling_min: 60 })), 150 * 60000,
      'ขยายเพดานแล้วกล้องที่เคยถูกยกเว้นกลับเข้ามาเฝ้าได้');
    assert.equal(th(10, 2000, _quietAlertSettings({ multiplier: 1 })), 20 * 60000);
    assert.equal(th(10, 2000, _quietAlertSettings({ floor_min: 45 })), 45 * 60000);
  });
});

// ── ตรวจที่ซอร์ส เพราะเป็นสมบัติของ "การต่อสาย" ไม่ใช่ของฟังก์ชันเดี่ยว ──
const SRC = fs.readFileSync(path.join(__dirname, '../src/alert-engine.js'), 'utf8');
const fnOf = (name) => {
  const m = SRC.match(new RegExp(`^async function ${name}[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(m, `หา ${name} ไม่เจอ`);
  return m[0];
};
// 🔴 ต้องตัดคอมเมนต์ออกก่อนเสมอ — คอมเมนต์ที่อธิบายว่า "ห้ามใช้ X" มีคำว่า X อยู่ในตัว
// จึงทำให้เทสต์แดงทั้งที่โค้ดถูก (โดนมาแล้วสองรอบ: `return` ใน edge-snap และ LATERAL)
const codeOf = (name) => fnOf(name).replace(/\/\/.*$/gm, '');

describe('สถานะต้องคำนวณเสมอ แม้ LINE ปิด', () => {
  const CHECK = codeOf('checkQuietCameras');

  it('เรียก _computeQuietState ก่อนประตูของ LINE ทุกบาน', () => {
    const compute = CHECK.indexOf('_computeQuietState');
    assert.ok(compute > -1, 'ต้องเรียก _computeQuietState');
    for (const gate of ['cfg.enabled', 'recipient_ids.length', 'channel_access_token']) {
      const at = CHECK.indexOf(gate);
      assert.ok(at > compute, `ประตู "${gate}" ต้องอยู่หลังการคำนวณ ไม่ใช่ก่อน`);
    }
  });

  it('ประตูของ LINE ครบทั้งสามบาน — ไม่มีบานไหนหล่นหาย', () => {
    assert.match(CHECK, /if \(!cfg\.enabled \|\| cfg\.recipient_ids\.length === 0\) return/);
    assert.match(CHECK, /!configCache\.enabled \|\| !configCache\.channel_access_token/);
    assert.match(CHECK, /cfg\.recipient_ids\.includes\(r\.id\)/);
    assert.equal(/recipient_ids\s*\?/.test(CHECK), false,
      'เจอ ternary บน recipient_ids — นั่นคือรูปของ fallback "null = ทุกคน" ที่ห้ามมีที่นี่');
  });

  it('ทุกทางที่ "ไม่ส่ง LINE" ต้องเก็บกวาดแถวของกล้องที่กลับมา — ไม่งั้นป้ายบนจอค้างถาวร', () => {
    // เคสจริงที่กัด: เปิด LINE จนมีแถว notify_count > 0 แล้วปิด LINE ทีหลัง ⇒ ขาลบแถว
    // อยู่ใน _quietAnnounce ซึ่งไม่ถูกเรียกอีกเลย · กล้องกลับมานานแล้วแต่ป้ายยังนับอยู่
    // นับเฉพาะช่วงหลังการคำนวณ — `return` เปล่าก่อนหน้านั้นถูกต้องแล้ว
    // (ยังไม่มี st ให้เก็บกวาด)
    const afterCompute = CHECK.slice(CHECK.indexOf('if (!st) return;') + 'if (!st) return;'.length);
    const returns = afterCompute.match(/return(?: _sweepRecovered\(st\.cameBack\))?;/g) || [];
    const bare = returns.filter(r => r === 'return;');
    assert.equal(bare.length, 0,
      `เจอ return เปล่า ${bare.length} จุดในเส้นทาง "ไม่ส่ง" — ต้องเป็น return _sweepRecovered(st.cameBack)`);
    assert.equal(returns.length, 3, `ควรมีทางออก 3 ทาง ได้ ${returns.length}`);
  });

  it('_computeQuietState เขียนแถวลง camera_quiet_alerts เอง — หน้าจออ่านจากตรงนั้น', () => {
    const C = codeOf('_computeQuietState');
    assert.match(C, /INSERT INTO camera_quiet_alerts/,
      'ถ้าแถวถูกเขียนใน _quietAnnounce อย่างเดียว หน้าจอจะว่างตลอดตราบใดที่ LINE ปิด');
  });
});

describe('_computeQuietState — ประตูและการกรอง', () => {
  const C = codeOf('_computeQuietState');

  it('เฝ้าเฉพาะกล้องที่มีเกณฑ์ของตัวเอง และไม่อยู่ในรายการปิดด้วยมือ', () => {
    assert.match(C, /_quietThresholdMs\(cfg, baseBy\.get\(id\)\)\s*\n\s*\?\? \(stateBy\.has\(id\) \? cfg\.floor_min \* 60000 : null\)/);
    assert.match(C, /!cfg\.excluded_cameras\.includes\(c\.id\) && thrOf\(c\.id\) !== null/);
    assert.match(C, /cfg\.excluded_cameras\.includes/);
    assert.match(C, /paused = FALSE/);
  });

  it('เทียบอายุความเงียบกับเกณฑ์ของกล้องตัวนั้น ไม่ใช่เลขตายตัว', () => {
    assert.match(C, /if \(quietMs < thrOf\(cam\.id\)\) continue;/);
  });

  it('กล้องที่ไม่เคยส่งข้อมูลในหน้าต่างที่ถามต้องถูกข้าม — ไม่ใช่เตือนถาวร', () => {
    assert.match(C, /if \(!rx && !st\?\.quiet_since\) continue;/);
    assert.match(C, /interval '10 days'/);
  });

  it('ค่าที่เอามาตัดสินคือ max(received_at) — ไม่ใช่ max(event_time)', () => {
    // ของที่บัฟเฟอร์ไว้พกเวลาเดิมมาด้วย ถ้าตัดสินด้วย event_time จะดูเหมือนไม่เคยเงียบ
    assert.match(C, /max\(received_at\) AS last_rx/);
    assert.equal(/max\(event_time\)/.test(C), false);
  });

  it('ขอบเวลาของคิวรีใช้ event_time เพื่อเดินบน index — received_at ไม่มี index เลย', () => {
    // วัดจริง 2026-09-12 หลังหลุดขึ้น prod: ชั้น 1 ด้วย received_at = 37,396 ms
    // ด้วย event_time = 686 ms · ชั้น 2 ด้วย received_at = timeout · ด้วย event_time = 1.4 วิ
    assert.match(C, /WHERE event_time > now\(\) - \(\$1 \|\| ' minutes'\)::interval/,
      'ชั้น 1 ต้องกรองด้วย event_time');
    assert.match(C, /AND event_time > now\(\) - interval '10 days'/,
      'ชั้น 2 ต้องมีขอบ event_time ไม่งั้น timeout ทุกครั้งและตัวเฝ้าไม่เคยบันทึกอะไรเลย');
    assert.equal(/received_at > now\(\)/.test(C), false,
      'เจอการกรองด้วย received_at — events ไม่มี index บนคอลัมน์นี้ จะ seq scan ทั้งตาราง');
  });

  it('ไม่ใช้ LATERAL รายกล้อง — group ครั้งเดียวเหมือน routes/devices.js', () => {
    assert.equal(/LATERAL/i.test(C), false, 'LATERAL รายกล้องบน events 40M แถวคือคิวรีที่ฆ่าระบบ');
  });

  it('ชั้นแรกใช้ floor_min เป็นหน้าต่าง — ตัดกล้องที่ไม่เงียบแน่ ๆ ออกก่อนโดยไม่ต้องดูฐาน', () => {
    assert.match(C, /\$1 \|\| ' minutes'/);
    assert.match(C, /\[String\(cfg\.floor_min\)\]/);
  });
});

describe('refreshCameraBaselines — งานคำนวณนิสัยกล้อง', () => {
  const B = codeOf('refreshCameraBaselines');

  it('ใช้ p99 ไม่ใช่ max — max ของกล้องที่เพิ่งเกิดเหตุคือตัวเหตุการณ์เอง', () => {
    assert.match(B, /percentile_cont\(0\.99\)/);
    assert.equal(/\bmax\(gap_min\)/.test(B), false, 'เจอ max(gap_min) — เหตุการณ์จะกลายเป็นนิสัยปกติ');
  });

  it('ใช้ถังเวลา 5 นาที ไม่ใช่ไล่ทุกแถว (8.1M แถว → 274k ถัง)', () => {
    assert.match(B, /date_bin\('5 minutes'/);
  });

  it('ห้ามมีขอบของ event_time — เคยเติมเพื่อตัด partition แล้วช้าลง 3.7 เท่า', () => {
    // วัดจริง 2026-09-12: ไม่มีขอบ (seq scan 20 partition) ทั้งงาน 85.4 วิ ·
    // มีขอบ (index scan 2 partition) แค่ขั้น bins 318 วิ — planner เปลี่ยนไปใช้
    // Index Scan ที่ดึงแถวเกือบทั้ง partition แบบสุ่ม · เทสต์นี้กันคนหวังดีในอนาคต
    assert.equal(/event_time/.test(B), false,
      'เจอ event_time ในคิวรีฐาน — "ตัด partition ได้" ไม่เท่ากับ "เร็วขึ้น" ดูคอมเมนต์เหนือฟังก์ชัน');
    assert.match(B, /received_at > now\(\) - make_interval/, 'คำถามจริงต้องเป็น received_at');
  });

  it('ล้างของเก่าในทรานแซกชันเดียวกัน — ฐานของกล้องที่ถูกถอดไปต้องไม่ค้าง', () => {
    assert.match(B, /DELETE FROM camera_event_baseline/);
    assert.match(B, /BEGIN/);
    assert.match(B, /COMMIT/);
    assert.match(B, /ROLLBACK/);
  });

  it('คงฐานของกล้องที่ไม่มีข้อมูลในหน้าต่าง — ลบเฉพาะกล้องที่ไม่อยู่ในระบบแล้ว (2026-10-06)', () => {
    assert.match(B, /DELETE FROM camera_event_baseline b\s*\n\s*WHERE NOT EXISTS \(SELECT 1 FROM cameras c WHERE c\.id = b\.camera_id\)/);
    assert.match(B, /ON CONFLICT \(camera_id\) DO UPDATE/);
    assert.equal(/DELETE FROM camera_event_baseline'\)/.test(B), false, 'ห้ามกลับไปล้างทั้งตาราง');
  });

  it('มี statement_timeout — คิวรี 14 วันต้องไม่ค้างคาคอนเนกชัน', () => {
    assert.match(B, /SET LOCAL statement_timeout/);
  });

  it('คืนคอนเนกชันเสมอแม้พัง', () => {
    assert.match(B, /finally \{ client\.release\(\); \}/);
  });

  it('ข้ามได้ถ้าฐานยังใหม่ — restart บ่อยต้องไม่ลากคิวรีหนักตามไปทุกครั้ง', () => {
    assert.match(B, /skipIfFresherThanHours/);
  });
});

describe('ลำดับ ส่ง → บันทึก → ขยับสถานะ', () => {
  const ANN = fnOf('_quietAnnounce');

  it('ทุกสาขาขยับสถานะเฉพาะเมื่อส่งสำเร็จ — ใบที่ส่งไม่ถึงห้ามกิน cooldown', () => {
    const pushes = (ANN.match(/_pushToAll\(/g) || []).length;
    const guards = (ANN.match(/if \(r\.sent\)/g) || []).length;
    assert.equal(pushes, 3, 'ควรมี 3 สาขา: เพิ่งเงียบ / ยังเงียบ / กลับมา');
    assert.equal(guards, 3, `ทุกสาขาต้องมี if (r.sent) — เจอ ${guards}/${pushes}`);
  });

  it('ตัดข้อความก่อนลง alert_logs (คอลัมน์มีเพดาน)', () => {
    assert.match(ANN, /text\.slice\(0, 500\)/);
  });
});

describe('migration 225', () => {
  const SQL = fs.readFileSync(
    path.join(__dirname, '../db/db_migration_225_camera_quiet_alerts.sql'), 'utf8');

  it('idempotent ทั้งไฟล์ — migration ที่ล้มทำให้ api-server ไม่บูต', () => {
    assert.match(SQL, /CREATE TABLE IF NOT EXISTS camera_quiet_alerts/);
    assert.match(SQL, /CREATE TABLE IF NOT EXISTS camera_event_baseline/);
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS quiet_alert/);
  });

  it('ค่า default ใน SQL ตรงกับค่า default ในโค้ดทุกตัว', () => {
    const def = JSON.parse(SQL.match(/DEFAULT '(\{[^']*\})'::jsonb/)[1]);
    const cfg = _quietAlertSettings(def);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.floor_min, CFG.floor_min);
    assert.equal(cfg.multiplier, CFG.multiplier);
    assert.equal(cfg.baseline_ceiling_min, CFG.baseline_ceiling_min);
    assert.equal(cfg.min_samples, CFG.min_samples);
    assert.deepEqual(cfg.recipient_ids, [], 'ค่าใน DB ต้องเป็น [] ไม่ใช่ null');
  });

  it('คอลัมน์ที่โค้ดอ่านจริงมีอยู่ในตาราง', () => {
    for (const col of ['p99_min', 'samples', 'days_span', 'computed_at']) {
      assert.match(SQL, new RegExp(`\\b${col}\\b`), `ขาดคอลัมน์ ${col}`);
    }
  });

  it('ไม่มี UPDATE ที่ไม่มีขอบเขต — migration ต้องเร็ว ไม่งั้น api-server ไม่บูต', () => {
    assert.equal(/^\s*UPDATE\s/mi.test(SQL), false);
  });
});

// ── ฝั่งหน้าจอ — ยึดสองจุดที่พังจริงตอนทำ และมองไม่เห็นจากการอ่านโค้ด ──────────
describe('ป้าย "กล้องยังไม่ส่งข้อมูล" บน topbar', () => {
  const D = (f) => fs.readFileSync(path.join(__dirname, '../dashboard/' + f), 'utf8');

  it('มี .quiet-badge[hidden] { display: none } — ขาดไปคือป้ายเลข 0 ค้างตลอด (GOTCHAS #198)', () => {
    // `display:flex` ที่เราตั้งเอง ชนะ display:none ที่เบราว์เซอร์ให้มากับ [hidden]
    // จับได้จาก screenshot 390px เท่านั้น · โค้ดอ่านแล้วดูถูกทุกบรรทัด
    assert.match(D('index.css'), /\.quiet-badge\[hidden\]\s*\{\s*display:\s*none/);
  });

  it('หมวด cameraDown อยู่ใน default ของ _notifyPrefs — ขาดไปคือ toast ถูกปิดเงียบ', () => {
    // queueToast() บรรทัดแรกเช็ค _notifyPrefs[cat] · คีย์ที่ไม่มี = undefined = ปิด
    // โดยไม่มี error ให้เห็นเลย
    const js = D('dashboard.js');
    assert.match(js, /const def = \{[^}]*cameraDown:\s*true/);
    assert.match(js, /cat:\s*'cameraDown'/, 'และต้องมีคนส่ง cat นี้เข้า queueToast จริง');
  });

  it('คีย์ i18n ใหม่มีครบทั้ง th และ en (gotcha #42)', () => {
    const i18n = D('i18n.js');
    for (const k of ['notify.catCameraDown', 'quiet.badgeTitle', 'quiet.toastOne',
                     'quiet.toastMany', 'quiet.durMin', 'quiet.durHour', 'quiet.durDay']) {
      assert.equal((i18n.match(new RegExp(`'${k.replace('.', '\\.')}'`, 'g')) || []).length, 2,
        `คีย์ ${k} ต้องมี 2 ที่ (th + en)`);
    }
  });

  it('ป้ายซ่อนเมื่อไม่มีของ — ไม่ใช่ป้ายที่เขียนศูนย์ (WA #2-D ห้ามสถานะศูนย์ถาวร)', () => {
    assert.match(D('dashboard.js'), /badge\.hidden = !data\.count;/);
    assert.match(D('index.html'), /id="quietCamBadge"[^>]*hidden/, 'ต้องเริ่มจากซ่อนไว้ก่อน');
  });

  it('รอบแรกหลังเปิดเว็บต้องไม่เด้ง toast ย้อนหลัง', () => {
    const js = D('dashboard.js');
    assert.match(js, /let _quietSeen = null;/);
    assert.match(js, /if \(_quietSeen\) \{/, 'ต้องมีรอบเทียบก่อนถึงจะ toast ได้');
  });

  it('endpoint ไม่แตะตาราง events — ป้ายนี้ poll ทุก 2 นาทีจากทุกแท็บ', () => {
    const r = fs.readFileSync(path.join(__dirname, '../src/routes/cameras-status.js'), 'utf8');
    const fn = r.match(/app\.get\('\/api\/cameras\/quiet'[\s\S]*?\n  \}\);/)[0];
    assert.equal(/\bevents\b/.test(fn.replace(/\/\/.*$/gm, '')), false,
      'เจอ events ใน endpoint — camera_quiet_alerts ถูกคำนวณไว้แล้ว ไม่ต้องถามซ้ำ');
    assert.match(fn, /FROM camera_quiet_alerts/);
  });
});

// ── การ์ด "ไม่ส่งข้อมูล" บนหน้าสรุป ต้องอ่านแหล่งเดียวกับป้ายบน topbar ──────────
describe('การ์ดบนหน้าสรุป — เลขบนจอต้องตรงกันทุกที่ (GOTCHAS #199)', () => {
  const SUM  = fs.readFileSync(path.join(__dirname, '../src/stats-summary-route.js'), 'utf8');
  const PAGE = fs.readFileSync(path.join(__dirname, '../dashboard/page-executive-summary.js'), 'utf8');

  it('endpoint ส่ง cameras.quiet มาจาก camera_quiet_alerts', () => {
    assert.match(SUM, /quiet:\s*quietView,/);
    assert.match(SUM, /FROM camera_quiet_alerts q/);
  });

  it('หน้าจอเลิกนับจาก !online แล้ว — นั่นคือ TCP probe ที่กะพริบ 677 ครั้ง/วัน', () => {
    assert.equal(/locations \|\| \[\]\)\.filter\(c => !c\.online\)/.test(PAGE), false,
      'ยังกรองจาก !online อยู่ — การ์ดจะขึ้นราว 20 ตัวเป็นปกติจนไม่มีใครอ่าน');
    assert.match(PAGE, /const quiet = Array\.isArray\(cams\.quiet\)/);
  });

  it('เคารพสิทธิ์รายกล้องเหมือนส่วนอื่นของ endpoint', () => {
    const blk = SUM.match(/let quietView = null;[\s\S]*?catch \{[^}]*\}/)[0];
    assert.match(blk, /allowedCameraIds === null \|\| allowedCameraIds\.has/);
  });

  it('ตารางยังไม่มี (ก่อน migration 225) ต้องไม่ทำทั้งหน้าพัง', () => {
    const blk = SUM.match(/let quietView = null;[\s\S]*?catch \{[^}]*\}/)[0];
    assert.match(blk, /try \{/);
    assert.match(blk, /catch \{/);
  });

  it('คิวรีของการ์ดไม่แตะตาราง events — endpoint นี้หนักอยู่แล้ว', () => {
    const blk = SUM.match(/let quietView = null;[\s\S]*?catch \{[^}]*\}/)[0];
    assert.equal(/\bevents\b/.test(blk.replace(/\/\/.*$/gm, '')), false);
  });

  it('หัวการ์ดเปลี่ยนตามข้อมูลที่มันแสดงจริง และมีครบ th + en', () => {
    const i18n = fs.readFileSync(path.join(__dirname, '../dashboard/i18n.js'), 'utf8');
    // หัวเดิมคือ "ออฟไลน์ขณะนี้ / OFFLINE NOW" ซึ่งไม่ตรงกับสิ่งที่แสดงแล้ว
    assert.equal(/'smb\.offlineTitle':'OFFLINE NOW'/.test(i18n), false,
      'ข้อมูลเปลี่ยนแล้วแต่หัวการ์ดยังบอกว่า offline — คนอ่านจะเข้าใจผิด');
    assert.equal((i18n.match(/'smb\.allSending'/g) || []).length, 2, 'ต้องมีครบ th + en (gotcha #42)');
    assert.match(PAGE, /I18N\.t\('smb\.allSending'\)/);
  });
});

describe('สองเลขบนจอเดียวกันต้องนับจาก scope เดียวกัน', () => {
  const ROUTE = fs.readFileSync(path.join(__dirname, '../src/routes/cameras-status.js'), 'utf8');
  const SUM   = fs.readFileSync(path.join(__dirname, '../src/stats-summary-route.js'), 'utf8');
  const PAGE  = fs.readFileSync(path.join(__dirname, '../dashboard/page-executive-summary.js'), 'utf8');
  const QFN   = ROUTE.match(/app\.get\('\/api\/cameras\/quiet'[\s\S]*?\n  \}\);/)[0];

  it('/api/cameras/quiet กรองตามสิทธิ์รายกล้อง เหมือน executive-summary', () => {
    // ป้ายบน topbar อ่านจาก route นี้ · การ์ดบนหน้าสรุปอ่านจาก summary ที่ scope อยู่แล้ว
    // ทั้งคู่อยู่บนจอเดียวกัน ถ้า scope ต่างกันผู้ใช้ที่ถูกจำกัดสิทธิ์จะเห็นเลขไม่ตรงกัน
    assert.match(QFN, /req\.user\?\.allowedSites/);
    assert.match(QFN, /scopedCameraIds\(allowedSites, pool\)/);
    assert.match(QFN, /allowed\.has\(r\.camera_id\)/);
    assert.match(QFN, /count: cameras\.length/, 'count ต้องนับหลังกรอง ไม่ใช่ก่อน');
  });

  it('"ยังตอบไม่ได้" ต้องแยกจาก "ตรวจแล้วครบ" — null ไม่ใช่ []', () => {
    // ยังไม่มีฐานของกล้อง = ยังไม่ได้ตรวจอะไรเลย · ขึ้นข้อความเขียวตอนนั้น
    // คือคำรับรองเท็จ ไม่ใช่แค่ข้อความว่าง
    assert.match(SUM, /let quietView = null;/);
    assert.match(SUM, /if \(b\[0\]\.n > 0\) quietView = \[\];/);
    assert.match(PAGE, /Array\.isArray\(cams\.quiet\) \? cams\.quiet : null/);
    assert.match(PAGE, /if \(quiet === null\) \{/);
    const green = PAGE.match(/smb\.allSending[\s\S]{0,80}/)[0];
    assert.ok(PAGE.indexOf('if (quiet === null)') < PAGE.indexOf("smb.allSending"),
      'สาขา null ต้องมาก่อนสาขาที่ขึ้นข้อความเขียว');
    assert.ok(green.length > 0);
  });

  it('ตัวนับของการ์ดไม่ระเบิดเมื่อ quiet เป็น null', () => {
    assert.match(PAGE, /quiet && quiet\.length \? String\(quiet\.length\) : ''/);
  });
});

describe('dropdown ที่ป้าย topbar — กดแล้วต้องเห็นรายชื่อ ไม่ใช่แค่พาไปหน้ากล้องเฉย ๆ', () => {
  // ที่มา 2026-09-13: ป้ายเดิมพาไปหน้ากล้องทั้งหมด 169 ตัวโดยไม่กรอง เจ้าของกดแล้ว
  // นึกว่าลิงก์ผิดเพราะไม่เห็นว่า 6 ตัวไหนที่เป็นปัญหา
  const DASH = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(__dirname, '../dashboard/index.html'), 'utf8');
  const NAV  = fs.readFileSync(path.join(__dirname, '../dashboard/page-nav-bindings.js'), 'utf8');

  it('ป้ายเปิด/ปิด dropdown แทนการนำทางตรง ๆ', () => {
    assert.match(HTML, /data-action="quietCamToggle"/);
    assert.equal(/data-action="quietCamOpen"/.test(HTML), false,
      'ของเก่าพาไปหน้ากล้องทั้งหมดโดยไม่กรอง — ต้องไม่เหลือ action นี้แล้ว');
    assert.match(NAV, /quietCamToggle:\s*\(el, e\) => quietCamToggle\(e\)/);
  });

  it('รายการแคชไว้ในตัวแปรเดียวกับที่ pollQuietCameras เติม — ไม่ใช่ fetch ซ้ำทุกครั้งที่เปิด', () => {
    assert.match(DASH, /_quietCameras = data\.cameras \|\| \[\];/);
    assert.match(DASH, /function _quietRenderDropdown/);
  });

  it('ปิด dropdown อัตโนมัติเมื่อของหมด — ไม่งั้นค้างว่างเปล่าลอยอยู่กลางจอ', () => {
    assert.match(DASH, /if \(!data\.count\) document\.getElementById\('quietCamDropdown'\)\?\.classList\.add\('hidden'\)/);
  });

  it('โพลรอบใหม่มาถึงตอน dropdown เปิดอยู่ ต้องวาดใหม่ ไม่ใช่ปล่อยค้างข้อมูลเก่า', () => {
    assert.match(DASH, /if \(!document\.getElementById\('quietCamDropdown'\)\?\.classList\.contains\('hidden'\)\) _quietRenderDropdown\(\);/);
  });

  it('คลิกนอกเมนูต้องปิด dropdown — ตาม pattern เดียวกับ user-dropdown ที่มีอยู่แล้ว', () => {
    assert.match(DASH, /const menu = document\.getElementById\('quietCamMenu'\);/);
    assert.match(DASH, /if \(menu && !menu\.contains\(e\.target\)\)/);
  });

  it('เลือกแถวแล้วกรองหน้ากล้องด้วยชื่อกล้องตัวนั้น — ไม่ใช่ทิ้งให้ไปงมจาก 169 ตัวเอง', () => {
    assert.match(DASH, /function quietCamGo\(el\)/);
    assert.match(DASH, /document\.getElementById\('camSearch'\)/);
    assert.match(DASH, /input\.dispatchEvent\(new Event\('input'\)\)/);
  });

  it('escapeHtml คลุมทั้งชื่อกล้องและ camera_id ก่อนต่อเป็น HTML', () => {
    const fn = DASH.match(/function _quietRenderDropdown[\s\S]*?\n\}/)[0];
    assert.match(fn, /escapeHtml\(c\.camera_name \|\| c\.camera_id\)/);
    assert.match(fn, /escapeHtml\(c\.camera_id\)/);
  });

  it('มี [hidden]/.hidden ครบทั้งสองระดับ (ป้าย + dropdown) กัน display:flex ชนะ (GOTCHAS #198)', () => {
    const css = fs.readFileSync(path.join(__dirname, '../dashboard/index.css'), 'utf8');
    assert.match(css, /\.quiet-dropdown\.hidden\s*\{\s*display:\s*none/);
  });

  it('มือถือ ≤768px: dropdown ดึงเข้าในจอด้วย position:fixed แทนกาง right:0 จากป้าย', () => {
    const css = fs.readFileSync(path.join(__dirname, '../dashboard/index.css'), 'utf8');
    assert.match(css, /\.quiet-dropdown\s*\{\s*position:\s*fixed/);
  });
});

it('quiet_since never predates the last data actually received (stale state rows)', () => {
  const s = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/alert-engine.js'), 'utf8');
  assert.match(s, /const quietSince = new Date\(Math\.max\(st\?\.quiet_since \? new Date\(st\.quiet_since\)\.getTime\(\) : 0,\s*\n\s*rx \? new Date\(rx\)\.getTime\(\) : 0\)\);/);
});

// ── วงจรชีวิตของแถวสถานะ — รันจริงผ่าน _testInit (pool/sender ปลอม · ไม่มี DB/LINE จริง) ── 2026-10-06
describe('quiet state lifecycle (real run, fake pool + fake sender)', () => {
  const engine = require('../src/alert-engine');
  const H = 3600_000, NOW = Date.now();
  function world({ cams, fresh = [], state = {}, bases = {}, lastRx = {}, excluded = [] }) {
    const st = new Map(Object.entries(state));
    const sent = [], logs = [];
    const pool = { query: async (sql, p = []) => {
      if (/FROM cameras WHERE paused = FALSE/.test(sql)) return { rows: cams.map(id => ({ id, name: id, site_id: 1 })) };
      if (/SELECT DISTINCT camera_id FROM events/.test(sql)) return { rows: fresh.map(camera_id => ({ camera_id })) };
      if (/SELECT \* FROM camera_quiet_alerts/.test(sql)) return { rows: [...st.entries()].map(([camera_id, v]) => ({ camera_id, ...v })) };
      if (/FROM camera_event_baseline/.test(sql)) return { rows: Object.entries(bases).map(([camera_id, v]) => ({ camera_id, ...v })) };
      if (/SELECT max\(id\) AS top FROM events/.test(sql)) return { rows: [{ top: null }] };   // ไม่มี mark ⇒ ทางเดิมทุกรอบ
      if (/max\(received_at\) AS last_rx/.test(sql)) return { rows: p[0].filter(id => lastRx[id]).map(id => ({ camera_id: id, last_rx: lastRx[id] })) };
      if (/DELETE FROM camera_quiet_alerts/.test(sql)) { st.delete(p[0]); return { rowCount: 1 }; }
      if (/INSERT INTO camera_quiet_alerts/.test(sql)) {
        const prev = st.get(p[0]) || { notify_count: 0, notified_at: null };
        st.set(p[0], /notify_count, updated_at\)\s*VALUES \(\$1, \$2, NOW\(\), 1/.test(sql)
          ? { quiet_since: p[1], notify_count: 1, notified_at: new Date(NOW) }
          : { ...prev, quiet_since: p[1] });
        return { rowCount: 1 };
      }
      if (/UPDATE camera_quiet_alerts/.test(sql)) { const v = st.get(p[0]); if (v) st.set(p[0], { ...v, notify_count: p[1], notified_at: new Date(NOW) }); return { rowCount: 1 }; }
      if (/INSERT INTO alert_logs/.test(sql)) { logs.push(p); return { rowCount: 1 }; }
      throw new Error('unexpected SQL in test: ' + sql.slice(0, 60));
    } };
    const lineSender = { pushLineMessage: async (_t, to, msgs) => { sent.push({ to, text: msgs[0].text }); return { success: true }; } };
    const config = { enabled: true, channel_access_token: 'test-token', recipients: [{ id: 'U-test-owner', enabled: true }],
      quiet_alert: { enabled: true, recipient_ids: ['U-test-owner'], excluded_cameras: excluded } };
    return { pool, lineSender, config, st, sent, logs };
  }
  const run = async (w) => { await engine._testInit({ pool: w.pool, lineSender: w.lineSender, config: w.config }); await engine.checkQuietCameras(); };
  const ago = (h) => new Date(NOW - h * H).toISOString();

  it('cameras dead longer than the baseline window stay watched and are announced once, batched, no emoji', async () => {
    const w = world({ cams: ['DEAD-1', 'DEAD-2', 'OK-1'], fresh: ['OK-1'],
      state: { 'DEAD-1': { quiet_since: ago(500), notify_count: 0, notified_at: null },
               'DEAD-2': { quiet_since: ago(520), notify_count: 0, notified_at: null } },
      bases: { 'OK-1': { p99_min: 5, samples: 3000 } } });           // ตัวที่ตายไม่มีฐานแล้ว
    await run(w);
    assert.equal(w.sent.length, 1, 'สองกล้องต้องรวมเป็นข้อความเดียว');
    assert.match(w.sent[0].text, /DEAD-1/); assert.match(w.sent[0].text, /DEAD-2/);
    assert.equal(/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(w.sent[0].text), false, 'การ์ดสถานะกล้องห้ามมี emoji');
    assert.equal(w.st.get('DEAD-1').notify_count, 1);
    assert.equal(w.sent[0].to, 'U-test-owner');
  });

  it('a stale row of an unwatched camera that is sending again is cleared (topbar false alarm)', async () => {
    const w = world({ cams: ['NATURE-QUIET'], fresh: ['NATURE-QUIET'],
      state: { 'NATURE-QUIET': { quiet_since: ago(500), notify_count: 0, notified_at: null } },
      bases: { 'NATURE-QUIET': { p99_min: 40, samples: 1200 } } });  // p99 > เพดาน 30
    await run(w);
    assert.equal(w.st.has('NATURE-QUIET'), false);
    assert.equal(w.sent.length, 0);
  });

  it('rows of excluded or paused/removed cameras are deleted, never announced', async () => {
    const w = world({ cams: ['EXCL'], excluded: ['EXCL'],
      state: { EXCL: { quiet_since: ago(50), notify_count: 0, notified_at: null },
               GONE: { quiet_since: ago(50), notify_count: 1, notified_at: ago(30) } } });  // GONE ไม่อยู่ใน cameras ที่ไม่ paused
    await run(w);
    assert.equal(w.st.size, 0);
    assert.equal(w.sent.length, 0);
  });

  it('cameras quiet for days are reminded daily, not every 6 h, and reminders are batched', async () => {
    const w = world({ cams: ['D-7H', 'D-25H-A', 'D-25H-B'],
      state: { 'D-7H':    { quiet_since: ago(400), notify_count: 1, notified_at: ago(7) },
               'D-25H-A': { quiet_since: ago(400), notify_count: 1, notified_at: ago(25) },
               'D-25H-B': { quiet_since: ago(300), notify_count: 2, notified_at: ago(25) } } });
    await run(w);
    assert.equal(w.sent.length, 1);
    assert.match(w.sent[0].text, /D-25H-A/); assert.match(w.sent[0].text, /D-25H-B/);
    assert.doesNotMatch(w.sent[0].text, /D-7H/);
    assert.equal(w.st.get('D-25H-B').notify_count, 3);
  });

  it('a camera quiet under 24 h keeps the normal 6 h reminder cadence', async () => {
    const w = world({ cams: ['H-QUIET'], lastRx: { 'H-QUIET': ago(10) },
      state: { 'H-QUIET': { quiet_since: ago(10), notify_count: 1, notified_at: ago(6.5) } },
      bases: { 'H-QUIET': { p99_min: 5, samples: 3000 } } });
    await run(w);
    assert.equal(w.sent.length, 1);
    assert.match(w.sent[0].text, /H-QUIET/);
  });
});

// ── แคช max(received_at) แบบเพิ่มทีละส่วน (2026-10-07 · perfWatch แจ้งชั้น 2 ช้า 3.3 วิ ทุก 5 นาที) ──
describe('quiet lastRx incremental cache', () => {
  const engine = require('../src/alert-engine');
  const NOW = Date.now(), ago = (m) => new Date(NOW - m * 60_000).toISOString();
  it('scans 10 days once per camera, then only rows above the id mark', async () => {
    const calls = { full: [], inc: [] };
    let top = 1000, incRows = [];
    const st = new Map();
    const pool = { query: async (sql, p = []) => {
      if (/FROM cameras WHERE paused = FALSE/.test(sql)) return { rows: [{ id: 'CAM-A', name: 'A', site_id: 1 }] };
      if (/SELECT DISTINCT camera_id FROM events/.test(sql)) return { rows: [] };
      if (/SELECT \* FROM camera_quiet_alerts/.test(sql)) return { rows: [...st.entries()].map(([camera_id, v]) => ({ camera_id, ...v })) };
      if (/FROM camera_event_baseline/.test(sql)) return { rows: [{ camera_id: 'CAM-A', p99_min: 5, samples: 3000 }] };
      if (/SELECT max\(id\) AS top FROM events/.test(sql)) return { rows: [{ top }] };
      if (/WHERE id > \$1 AND event_time > now\(\) - interval '10 days'/.test(sql)) { calls.inc.push(p[0]); return { rows: incRows }; }
      if (/max\(received_at\) AS last_rx/.test(sql)) { calls.full.push([...p[0]]); return { rows: [{ camera_id: 'CAM-A', last_rx: ago(90) }] }; }
      if (/INSERT INTO camera_quiet_alerts/.test(sql)) { st.set(p[0], { quiet_since: p[1], notify_count: 0, notified_at: null }); return { rowCount: 1 }; }
      if (/DELETE FROM camera_quiet_alerts/.test(sql)) { st.delete(p[0]); return { rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    } };
    const config = { enabled: false, quiet_alert: { enabled: false, recipient_ids: [], excluded_cameras: [] } };
    await engine._testInit({ pool, config });
    await engine.checkQuietCameras();                       // รอบแรก: 10 วันหนึ่งครั้ง
    assert.deepEqual(calls.full, [['CAM-A']]);
    assert.equal(calls.inc.length, 0);
    top = 1200;
    await engine.checkQuietCameras();                       // รอบสอง: อ่านเฉพาะ id > mark · ไม่ยิง 10 วันซ้ำ
    assert.equal(calls.full.length, 1);
    assert.deepEqual(calls.inc, [Math.max(0, 1000 - 5000)]);
    // แถวใหม่ของกล้อง (received เมื่อ 30 นาที · ยังเกินเกณฑ์ 20 นาที) ต้องเข้าแคช — quiet_since ต้องขยับตาม
    incRows = [{ camera_id: 'CAM-A', rx: ago(30) }];
    await engine.checkQuietCameras();
    incRows = [];
    top = 1300;
    await engine.checkQuietCameras();
    assert.equal(calls.full.length, 1, 'กล้องที่อยู่ในแคชแล้วไม่ต้องยิง 10 วันอีก');
    const qs = st.get('CAM-A')?.quiet_since;
    assert.ok(qs && new Date(qs).getTime() >= NOW - 31 * 60_000, 'ค่าที่ได้จากแถวใหม่ต้องถูกใช้ ไม่ใช่ค่าเก่า 90 นาที');
  });
});

