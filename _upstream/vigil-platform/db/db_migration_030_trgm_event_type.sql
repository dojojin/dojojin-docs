-- ============================================================
-- Migration 030: pg_trgm GIN index on events.event_type
-- ============================================================
-- WHY: METRIC_EVENT_FILTER / isMetricEventType() ใช้ pattern
--      NOT LIKE '%Aggregation%' ซึ่ง leading-% ทำให้ PostgreSQL
--      ข้าม b-tree idx_events_type แล้วทำ seq scan บน rows
--      ที่ผ่าน time-range filter มาแล้ว — ยิ่ง events table โตยิ่งช้า
--
-- APPROACH: pg_trgm GIN index รองรับ LIKE '%...%' ได้โดยตรง
--           ไม่ต้องแก้ query ใดๆ — PostgreSQL เลือกใช้อัตโนมัติ
--
-- SAFETY: idempotent (CREATE EXTENSION + CREATE INDEX IF NOT EXISTS)
--         ใช้ regular CREATE INDEX (ไม่ใช่ CONCURRENTLY) เพราะ
--         migrate.js รันทุก statement ใน BEGIN...COMMIT เดียว
--         CONCURRENTLY ห้ามอยู่ใน transaction block
--         → lock events สั้นๆ ตอน boot ก่อน serve traffic — ยอมรับได้
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_events_type_trgm
  ON events USING GIN (event_type gin_trgm_ops);
