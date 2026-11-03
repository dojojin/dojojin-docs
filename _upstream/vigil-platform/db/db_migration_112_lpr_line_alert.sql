-- ============================================================
-- Vigil Platform — migration 112: LINE alerts for LPR watch-list hits
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- lpr_watchlist.notify_line has existed for months and no sender ever read it,
-- which is what the dashboard means by "(แจ้งเตือนอัตโนมัติยังไม่เปิดใช้)". The
-- switch moves up to the group: 482 of the active rows arrive from the blacklist
-- bridge automatically, so a per-plate toggle is not something anyone can keep
-- on top of. The per-plate column stays as an opt-OUT for the one car you know
-- you do not want to hear about.
--
-- Defaults to FALSE. Turning this on sends messages to real people's phones, so
-- it is a decision someone makes per group, not something a migration does.
--
-- Cooldown lives in a table rather than in memory because api-server restarts
-- often (eight times during one working day, 2026-08-03) and an in-memory map
-- would forget every restart — which is exactly when a duplicate alert is least
-- welcome. Keyed on (plate, group) rather than per recipient: two teams watching
-- the same car should see it at the same moment, not staggered.
-- ============================================================

ALTER TABLE lpr_watchlist_groups
  ADD COLUMN IF NOT EXISTS notify_line boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN lpr_watchlist_groups.notify_line IS
  'ส่ง LINE เมื่อพบรถในกลุ่มนี้ — ปิดไว้เป็นค่าเริ่มต้น; lpr_watchlist.notify_line=false ใช้ปิดเฉพาะป้ายได้';

CREATE TABLE IF NOT EXISTS lpr_alert_cooldown (
  plate_number  text        NOT NULL,
  group_id      text        NOT NULL,
  last_sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plate_number, group_id)
);

COMMENT ON TABLE lpr_alert_cooldown IS
  'ครั้งล่าสุดที่ส่ง LINE ต่อ (ป้าย, กลุ่ม) — กันคันเดียวผ่านหลายกล้องแล้วยิงซ้ำ';

-- The hourly cap counts sends per group. Reading it off alert_logs would mean
-- scanning a table that every alert in the platform writes to; a purpose-built
-- counter stays small and is cheap to check on the hot path.
CREATE TABLE IF NOT EXISTS lpr_alert_hourly (
  group_id   text        NOT NULL,
  hour_start timestamptz NOT NULL,
  sent       integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, hour_start)
);

COMMENT ON TABLE lpr_alert_hourly IS
  'นับจำนวนที่ส่งต่อกลุ่มต่อชั่วโมง — กันเคสรายการเฝ้าระวัง import ผิดจนป้ายทั่วไปเข้ามา';

-- Both tables are caps, not history: alert_logs already keeps the record. Old
-- rows have no reader, so drop them rather than growing two tables forever.
DELETE FROM lpr_alert_cooldown WHERE last_sent_at < now() - interval '7 days';
DELETE FROM lpr_alert_hourly   WHERE hour_start   < now() - interval '7 days';
