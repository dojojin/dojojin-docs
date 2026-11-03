// ============================================================
// Vigil Platform — Tests: ห้ามประกอบ site filter เอง (แกนกล้องจะหาย)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// บั๊กจริง 2026-08-12 (GOTCHAS #166): `/api/traffic/helmet-series` ประกอบ clause
// `t.camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($n))` เอง แทนที่จะเรียก
// `siteWhere()` → แกนที่ 2 (จำกัดรายกล้อง `user_cameras`) หายไปเงียบๆ ผู้ใช้ที่ถูกจำกัด
// ไว้กล้องเดียวเห็นตัวเลขของทั้ง Site (54,729 แทนที่จะเป็น 10,562) โดยไม่มี error ใดๆ
//
// รายการกล้องถูกต้องด้วยซ้ำ เพราะ query นั้นใช้ siteWhere() — มีแต่ตัวเลขที่ผิด
// จึงดูเผินๆ เหมือนทำงานถูก เทสต์นี้กันไม่ให้แพทเทิร์นนั้นกลับมาอีก

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
// สแกน src/ ทุกโฟลเดอร์ที่ถือ logic ของ scope — เดิมดูแค่ src/ กับ src/routes/
// พอ WebSocket ย้ายไป src/ws/ (decision #276) โค้ดกรอง site ของ WS (decision #248,
// GOTCHAS #163) ก็หลุดออกจากสายตาเทสต์นี้เงียบ ๆ ทั้งที่เป็นจุดที่กฎนี้มีไว้คุ้มครองพอดี
const SCAN_DIRS = ['', 'routes', 'ws', 'jobs', 'helpers'];
const files = SCAN_DIRS.flatMap((d) => {
  const dir = d ? path.join(SRC, d) : SRC;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
});

// ที่อนุญาตให้เขียนเองได้ พร้อมเหตุผล — เพิ่มรายการใหม่ต้องอธิบายได้ว่าทำไมไม่ใช่กล้อง
const ALLOWED = [
  // ตัว helper เอง — เป็นที่เดียวที่ควรมี SQL แบบนี้
  { file: 'auth.js', why: 'ต้นทางของ siteWhere()/scopedCameraIds() เอง' },
  // กรอง "หมวดเหตุการณ์" ตาม Site ไม่ใช่กล้อง — แกนกล้องไม่เกี่ยว
  { file: 'categories.js', why: 'กรอง event_categories.site_id ไม่ใช่กล้อง' },
  { file: 'stats.js', why: 'บางจุดกรอง event_categories.site_id (ตรวจแล้ว 2026-08-12)' },
  // ตรวจว่ากล้อง/เหตุการณ์ที่ระบุมาอยู่ใน Site ที่ผู้ใช้มีสิทธิ์ (ownership check รายตัว)
  { file: 'faces.js', why: 'ownership check ของ event เดี่ยวก่อน ack' },
  { file: 'lpr-alerts.js', why: 'ownership check ของ event เดี่ยวก่อน ack' },
  { file: 'users.js', why: 'ตรวจว่ากล้องที่แอดมินติ๊กอยู่ใน Site ของ user คนนั้น' },
  // ไม่ได้ประกอบ filter เอง — regex จำรูปที่ siteWhere() สร้างไว้แล้ว เพื่อแปลง lp.camera_id → r.camera_id (2026-10-21)
  { file: 'lprRollupCount.js', why: 'จดจำผลของ siteWhere() ใน WHERE เดิม ไม่ได้สร้างเงื่อนไขใหม่' },
];

describe('ห้ามประกอบ site filter ของกล้องเอง — ต้องผ่าน siteWhere()/scopedCameraIds()', () => {
  it('ไม่มีไฟล์ใหม่ที่เขียน `site_id = ANY(...)` เองนอกรายการที่อนุญาต', () => {
    const offenders = [];
    for (const f of files) {
      const base = path.basename(f);
      if (ALLOWED.some(a => a.file === base)) continue;
      const src = fs.readFileSync(f, 'utf8');
      // มองหาการดึง/กรอง "กล้อง" ด้วย site_id ตรงๆ
      const hits = [...src.matchAll(/FROM cameras[^;'"`]*site_id\s*=\s*ANY|site_id\s*=\s*ANY[^;'"`]*FROM cameras/gi)];
      if (hits.length) offenders.push(`${base} (${hits.length} จุด)`);
    }
    assert.deepEqual(offenders, [],
      'ไฟล์เหล่านี้กรองกล้องด้วย site_id เอง → ผู้ใช้ที่ถูกจำกัดรายกล้องจะเห็นข้อมูลเกินสิทธิ์ ' +
      '(ใช้ siteWhere() หรือ auth.scopedCameraIds() แทน — GOTCHAS #166)');
  });

  // ไฟล์ที่แตะ allowedSites แต่ไม่ได้กรอง "กล้อง" ด้วย SQL จึงไม่ต้องใช้ helper
  const NO_HELPER_NEEDED = new Set([
    'auth.js', 'api-server.js',
    'cameras.js',       // กรองในหน่วยความจำ และจัดการ allowedCameras เองอยู่แล้ว (P6)
    'sites.js',         // กรอง "Site" ไม่ใช่กล้อง
    'view-registry.js', // อ้างถึงในคอมเมนต์เท่านั้น
    'categories.js',    // กรอง event_categories.site_id (alias c = categories ไม่ใช่ cameras)
    'viewGuard.js',     // แกน view ไม่เกี่ยวกับกล้อง
    'watchScope.js',
    'report-schedules.js', // กรองตารางรายงานด้วย report_schedules.site_id ของตาราง ไม่ใช่รายการกล้อง    // กรอง "กลุ่มรายการเฝ้าระวัง" ด้วย site_id ของกลุ่ม (Global + Site ตัวเอง) ไม่ใช่รายการกล้อง
    'siteAdminGate.js', // ตรวจ "เป้าหมายรายตัว" (camera id / group / category) ทั้งแกน Site และแกนกล้อง (.cameras) เอง — ไม่ได้กรองรายการด้วย SQL · มีเทสต์ site-admin-gate.test.js ล็อกไว้
    'mediaScope.js',    // ใช้ cameraInScope() ซึ่งอ่าน property cameras เองแล้ว
    'media-files.js',   // ย้ายมาจาก api-server.js — กรองด้วย mediaScope.snapshotInScope() / allowedSites.includes() ไม่ได้ประกอบ SQL กรองกล้องเอง
    'hub.js',           // WebSocket — กรองด้วย mediaScope.cameraInScope() ต่อข้อความ ไม่ได้ประกอบ SQL (decision #248)
    // gs_alarms (migration 237) ไม่มีคอลัมน์ camera_id เลย — scope ด้วย sites.id ตรงๆ
    // ผ่าน site_code (แบบเดียวกับ categories.js) ไม่ใช่กล้อง จึงไม่มี "แกนที่ 2" ให้ครบ
    // ด้วย siteWhere() แบบไฟล์ที่กรองกล้องจริง · allowedSites.cameras (แกนกล้อง) ถูกกัน
    // แบบ fail-closed (`AND FALSE`) ตรงจุดแทน เพราะไม่มีทางตรวจกล้องรายแถวได้จริง
    'lpr-gs-alarms.js',
  ]);

  it('ทุกไฟล์ที่อ้างถึง allowedSites ในเชิง SQL ต้อง import helper มาใช้', () => {
    const missing = [];
    for (const f of files) {
      const base = path.basename(f);
      if (NO_HELPER_NEEDED.has(base)) continue;
      const src = fs.readFileSync(f, 'utf8');
      if (!/allowedSites/.test(src)) continue;
      if (!/siteWhere|scopedCameraIds|resolveSiteScope/.test(src)) missing.push(base);
    }
    assert.deepEqual(missing, [],
      'ไฟล์เหล่านี้ใช้ allowedSites แต่ไม่ได้เรียก helper ตัวไหนเลย — ตรวจว่ากรองครบ 2 แกนหรือยัง');
  });
});
