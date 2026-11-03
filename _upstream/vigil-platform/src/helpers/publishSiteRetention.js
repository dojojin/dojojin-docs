// ============================================================
// Vigil Platform — Helper: publishSiteRetention (R1)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Sends one site's image-retention policy to its edge over the channel that
// already exists — the same retained `projects/{code}/_config/*` namespace
// edge-bridge subscribes to for camera config. Retained on purpose: an edge
// that boots, or reconnects after the tunnel drops, must get the policy again
// without anybody pressing anything.
//
// The topic is built from `sites.code`, matching publishSiteConfig and the
// edge's own EDGE_SITE_ID (measured on hkt: EDGE_SITE_ID=hkt). Publishing to
// projects/<numeric id>/… would reach a topic nobody subscribes to and raise
// no error at all.
//
// Values are sent verbatim, including nulls. A null means "not configured" and
// the edge keeps its built-in default — the default deliberately does not
// travel over the wire, so a bad row here cannot rewrite an edge's behaviour
// into something nobody chose.
//
// hold (migration 285) — ไซต์ที่ status <> 'active' = แช่แข็ง: edge ข้ามการลบตามอายุทั้งหมด
// (เหลือแค่ลบตาม min_free_gb กันดิสก์เต็ม) · ส่งเป็น boolean ทุกครั้ง ไม่ใช่เฉพาะตอน true —
// bridge เขียนทับเฉพาะ key ที่มากับ payload ถ้าไม่ส่งตอนออกจากโหมด edge จะค้าง hold ตลอด
// ============================================================
'use strict';

const brokerAdmin = require('./brokerAdmin');

module.exports = async function publishSiteRetention(siteId, pool) {
  if (!brokerAdmin.isConfigured({ as: 'publisher' })) return null;
  const { rows } = await pool.query(
    `SELECT code, status, retention_events_days, retention_lpr_days,
            retention_face_days, retention_min_free_gb
       FROM sites WHERE id = $1`, [siteId]);
  if (!rows.length) return null;
  const s = rows[0];

  const payload = {
    version: Date.now(),
    events_days: s.retention_events_days,
    // Sent but not yet acted on — the pruner only walks events/ until R3.
    lpr_days: s.retention_lpr_days,
    face_days: s.retention_face_days,
    min_free_gb: s.retention_min_free_gb,
    hold: s.status !== 'active',
  };
  await brokerAdmin.publish(`projects/${s.code}/_config/retention`, payload, { qos: 1, retain: true });
  console.log(`[edge-config] → projects/${s.code}/_config/retention ${JSON.stringify(payload)}`);
  return { siteCode: s.code, ...payload };
};
