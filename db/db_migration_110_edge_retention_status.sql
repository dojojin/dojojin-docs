-- ============================================================
-- Vigil Platform — migration 110: report the edge's retention state back
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- R1 gave every site its own retention policy and published it over MQTT. The
-- edge started reporting back what it is ACTUALLY running, and when it last
-- pruned — and central threw it away, because recordEdgeHeartbeat() only
-- persists the columns that exist and edge_status had none for this.
--
-- Without it, "policy published" and "policy in effect" are indistinguishable
-- from the dashboard: an edge that is offline, running older code, or never
-- received the retained message looks exactly like one that applied it.
-- ============================================================

ALTER TABLE edge_status
  ADD COLUMN IF NOT EXISTS retention_json jsonb,
  ADD COLUMN IF NOT EXISTS last_prune_json jsonb;

COMMENT ON COLUMN edge_status.retention_json IS
  'ค่า retention ที่ไซต์นั้นใช้อยู่จริง (ตามที่ edge รายงานกลับ) — ต่างจากค่าใน sites ซึ่งคือค่าที่ central "สั่งไป"';
COMMENT ON COLUMN edge_status.last_prune_json IS
  'ผลการลบรูปครั้งล่าสุดที่ edge — by_age / by_space / gave_up / free_gb';
