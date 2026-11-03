// ============================================================
// Vigil Platform — Helper: cameraPause
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// หยุด/เปิดกล้อง pause หลายตัวในครั้งเดียว — ใช้ร่วมกันระหว่าง PATCH /api/cameras/:id/pause
// (กล้องเดียว) กับ PUT /api/sites/:id/status (ทั้งไซต์)
// Dual-write: DB cameras.paused + cameras-config.json .paused (ingester อ่านผ่าน fs.watch)
// bySite=true → ระบบเป็นคน pause (paused_by_site) · ตอนออกจาก maintenance คืนเฉพาะที่ระบบ pause
// manual pause ทับกล้องที่ระบบ pause ไว้ = แอดมินยึดเป็นของตัวเอง (bySite=false → เคลียร์ flag)
async function setCamerasPaused(pool, { cameraIds, paused, bySite = false, reason, user, loadCameraConfig, saveCameraConfig }) {
  if (!cameraIds.length) return [];
  paused = !!paused;
  // RETURNING enabled captures the pre-pause state atomically.
  // `enabled` is frozen while paused (watchdog skips paused cameras),
  // so it reliably reflects whether the camera was online at pause time.
  const { rows } = paused
    ? await pool.query(
        `UPDATE cameras SET paused=TRUE, paused_by_site=$2, updated_at=NOW() WHERE id = ANY($1) RETURNING id, enabled`,
        [cameraIds, !!bySite])
    : await pool.query(
        `UPDATE cameras SET paused=FALSE, paused_by_site=FALSE, updated_at=NOW() WHERE id = ANY($1) RETURNING id, enabled`,
        [cameraIds]);
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);

  // On unpause — grace period: only stamp last_seen_at if the camera WAS online
  // when paused (enabled=true). Stamping for an offline camera causes false
  // online→offline churn (watchdog sees grace period then heartbeat timeout).
  // 🔴 จุดนี้ต้องเขียนทุกครั้ง ห้ามเปลี่ยนไปใช้ helpers/touchCamera (ซึ่งเขียน
  // เฉพาะเมื่อค่าเดิมเก่าเกินคาบ) — หน้าที่ของบรรทัดนี้คือ "รีเซ็ตนาฬิกา"
  // ตอนปลด pause เพื่อไม่ให้ watchdog เห็นค่าเก่าแล้วยิงแจ้งเตือนออฟไลน์หลอก
  // ถ้าโดนคาบกรองทิ้ง มันจะไม่ทำงานเลยพอดีในเคสที่ต้องการมันที่สุด
  // ส่วนเส้นทาง ingest ที่ยิงถี่ ๆ ใช้ helper (ดูเหตุผลในไฟล์นั้น)
  if (!paused) {
    const online = rows.filter(r => r.enabled).map(r => r.id);
    if (online.length) await pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id = ANY($1)`, [online]);
  }

  // Dual-write to cameras-config.json so ingesters pick up change via fs.watch (โหลด/เซฟครั้งเดียว)
  const config = loadCameraConfig();
  const idSet = new Set(ids);
  let dirty = false;
  for (const c of (config.cameras || [])) {
    if (idSet.has(c.camera_id)) { c.paused = paused; dirty = true; }
  }
  if (dirty) saveCameraConfig(config);

  for (const id of ids) {
    // Log status transition
    await pool.query(
      `INSERT INTO camera_status_log (camera_id, status, reason) VALUES ($1,$2,$3)`,
      [id, paused ? 'paused' : 'resumed', reason]
    );
    // Audit log
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, target_camera_id, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [user.id, user.username, paused ? 'camera_pause' : 'camera_resume', id,
       JSON.stringify(bySite ? { paused, by_site: true } : { paused })]
    );
  }
  return rows;
}

module.exports = { setCamerasPaused };
