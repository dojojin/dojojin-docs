// ============================================================
// Vigil Platform — Storage Purge (shared central + edge)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ลบไฟล์ภาพตามอายุ ใช้ร่วมกันทั้ง central และ edge (2026-08-24)
// งานทำลายไม่ควรมีสองสำเนา — ถ้าแยกกันเขียน กติกาความปลอดภัยจะเลื่อนออกจากกัน
// โดยที่ไม่มีใครรู้ตัวจนวันที่ฝั่งหนึ่งลบมากกว่าที่ควร
//
// SAFETY (ท่าเดียวกับ camera-media-delete.js — reject-then-use ไม่ใช่ sanitize-then-use):
//   • ไม่รับ path จากผู้เรียกเลย รับแค่ชื่อหมวดจาก PURGEABLE แล้วประกอบ path เอง
//   • หมวดที่เป็น "รูปอ้างอิง" (lpr-watchlist, blacklist-photos) ไม่อยู่ในรายชื่อ
//     เพราะยังแมปเจ้าของไม่ได้แน่ชัด ลบผิดคือ roster เสียรูปอ้างอิงแล้วจับคู่พลาด
//   • ตรวจว่า path ที่ประกอบแล้วยังอยู่ใต้ base จริง กัน path แปลกจาก env ที่ตั้งเพี้ยน
//   • ไม่เดินตาม symlink
//   • dry-run เป็นค่าเริ่มต้น การลบจริงต้องส่งจำนวนไฟล์ที่เห็นจาก dry-run กลับมาให้ตรง
'use strict';

const fs = require('fs');
const path = require('path');

// ชื่อหมวด → โฟลเดอร์ย่อยใต้ SNAPSHOT_DIR
// เพิ่มหมวดใหม่ที่นี่ที่เดียว ทั้ง central และ edge ได้ตามกันเอง
const PURGEABLE = {
  events: 'events',
  lpr: 'lpr',
};

function isPurgeable(category) {
  return Object.prototype.hasOwnProperty.call(PURGEABLE, category);
}

/**
 * หาไฟล์ที่เก่ากว่า days วัน — ไม่ลบ
 * คืน { files, bytesDisk, sample[], victims[] }
 * bytesDisk = บล็อกที่ถูกจับจอง (st.blocks*512) ซึ่งเป็นพื้นที่ที่จะได้คืนจริง
 * ไม่ใช่ผลรวมขนาดไฟล์ที่ต่ำกว่าความจริงถึง 2 เท่าเมื่อไฟล์เล็กจำนวนมาก
 * skipCamDirs (Set, ไม่บังคับ) — ชื่อโฟลเดอร์กล้อง (<หมวด>/<วันที่>/<กล้อง>/) ของไซต์ปิดปรับปรุง ไม่เดินเข้า
 * ข้ามที่ "แผน" ไม่ใช่ตอนลบ — dry-run กับลบจริงจึงนับตรงกัน · edge ไม่ส่งมา = พฤติกรรมเดิม
 */
async function planPurge(snapshotDir, category, days, skipCamDirs) {
  if (!isPurgeable(category)) return { rejected: 'category not purgeable' };
  const d = parseInt(days, 10);
  if (!Number.isFinite(d) || d < 1 || d > 3650) return { rejected: 'days out of range' };

  const base = path.join(snapshotDir, PURGEABLE[category]);
  if (!base.startsWith(snapshotDir)) return { rejected: 'resolved path escaped base' };
  if (!fs.existsSync(base)) return { files: 0, bytesDisk: 0, sample: [], victims: [] };

  const cutoff = Date.now() - d * 86400 * 1000;
  const victims = [];
  // เดินทรีแบบ async (fs.promises) ไม่ใช่ sync — โค้ดเดิมบล็อก event loop ของทั้ง
  // api-server และ edge-config-agent ตลอดการเดิน ขณะที่คนกำลังรอ POST /api/storage/purge
  // ทีละไฟล์ในโฟลเดอร์เดียวกัน ไม่ยิง stat พร้อมกันทั้งกอง — กันคิว I/O ระเบิดบน edge
  // รูปแบบเดียวกับ scanCategory()/countEventOrphans() ใน helpers/storageScan.js
  await (async function walk(dir, depth) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 1 && skipCamDirs && skipCamDirs.has(e.name)) continue;
        await walk(full, depth + 1); continue;
      }
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(full);
        if (st.mtimeMs < cutoff) victims.push([full, st.blocks * 512]);
      } catch { /* หายไประหว่างเดิน ข้าม */ }
    }
  })(base, 0);

  return {
    files: victims.length,
    bytesDisk: victims.reduce((a, [, b]) => a + b, 0),
    sample: victims.slice(0, 10).map(([f]) => path.relative(snapshotDir, f)),
    victims,
  };
}

/**
 * ลบจริง — ต้องส่ง confirmFiles ที่ตรงกับจำนวนจาก planPurge รอบล่าสุด
 * ไม่ตรง = ปฏิเสธ เพราะดิสก์เปลี่ยนไประหว่างที่คนกำลังอ่านตัวเลข
 */
async function executePurge(snapshotDir, category, days, confirmFiles, skipCamDirs) {
  const plan = await planPurge(snapshotDir, category, days, skipCamDirs);
  if (plan.rejected) return plan;
  if (Number(confirmFiles) !== plan.files) {
    return { rejected: 'confirm mismatch', expected: Number(confirmFiles), actual: plan.files };
  }
  let deleted = 0, freed = 0;
  // ลบทีละไฟล์ตามลำดับ ไม่ Promise.all ทั้งกอง — กองลบหลักแสนไฟล์พร้อมกันทำให้
  // libuv threadpool ตันจนงาน I/O อื่นของ process เดียวกันหยุดรอ
  for (const [f, b] of plan.victims) {
    try { await fs.promises.unlink(f); deleted++; freed += b; }
    catch (e) { console.warn('[storage-purge] ลบไม่สำเร็จ', f, e.message); }
  }
  return { files: plan.files, deleted, bytesDisk: freed };
}

module.exports = { PURGEABLE, isPurgeable, planPurge, executePurge };
