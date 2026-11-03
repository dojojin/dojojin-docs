-- ============================================================
-- Vigil Platform — Migration 256: autovacuum ของตารางใหญ่ที่ insert อย่างเดียว (P1) + ยามเฝ้าความเร็ว (P2)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- P1 — เหตุเดียวกับ license_plates (GOTCHAS #221): ตารางที่มีแต่ insert ไม่ถึงเกณฑ์ค่าเริ่มต้น
--   (vacuum ตาม insert 0.2 · analyze 0.1 ของจำนวนแถว) ⇒ visibility map ว่าง + สถิติ planner ค้าง
--   ตรวจ 2026-10-06: face_embeddings (15 GB · 5.3 ล้านแถว) และ face_embed_queue (3.1 GB) ไม่ถูก
--   vacuum/analyze เลยตั้งแต่ Postgres crash 26 ก.ย. · planner ประมาณแถว 1 วันได้ 13,501 จริง 124,387
--   events ไม่ต้องแตะ: ทุก partition ถึง 2027-12 ตั้ง 0.02 ไว้แล้ว และ UPDATE snapshot ทำให้ vacuum ทำงานเอง
-- P2 — perf_daily_queries เก็บ query 50 อันดับต่อวัน ให้ helpers/perfWatch.js เทียบกับ 7 วันก่อน
--   line_config.perf_alert ตั้งต้นปิด ไม่มีผู้รับ (แบบเดียวกับ quiet_alert / metric_alert)
-- รันซ้ำได้ทุกคำสั่ง · ALTER TABLE SET เป็น metadata อย่างเดียว ไม่ rewrite
-- ============================================================

ALTER TABLE face_embeddings  SET (autovacuum_vacuum_insert_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE face_embed_queue SET (autovacuum_vacuum_insert_scale_factor = 0.01, autovacuum_vacuum_scale_factor = 0.02,
                                  autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE appearances      SET (autovacuum_vacuum_insert_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.01);

CREATE TABLE IF NOT EXISTS perf_daily_queries (
  day        date    NOT NULL,
  queryid    bigint  NOT NULL,
  calls      bigint  NOT NULL,
  mean_ms    double precision NOT NULL,
  total_ms   double precision NOT NULL,
  query_head text    NOT NULL,
  PRIMARY KEY (day, queryid)
);

ALTER TABLE line_config ADD COLUMN IF NOT EXISTS perf_alert jsonb
  DEFAULT '{"enabled": false, "recipient_ids": []}'::jsonb;
