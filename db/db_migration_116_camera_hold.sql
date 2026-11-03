-- ============================================================
-- Vigil Platform — migration 116: how long a camera has held data for us
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- The camera panel used to report ANR from /ISAPI/Traffic/ANR, which configures
-- an SDK arming server we do not use. It said "not usable" while the cameras
-- were, in fact, buffering and replaying every day: C40-THL-SB-18 held 595
-- plates across 46 minutes on 2026-08-04 and delivered all of them once its
-- link came back, in event-time order at 90/min against a 7/min baseline.
--
-- That is the number worth showing, and we can measure it ourselves rather than
-- asking the camera: events already stores event_time (the camera's clock) next
-- to received_at (ours). The gap between them IS the hold.
--
-- Kept as a running maximum on cameras rather than computed on demand. events
-- is partitioned and 26 GB; scanning seven days of it takes ~6.6 s, which is
-- fine once and far too slow for a panel that opens on every click. The hourly
-- job scans only the last seventy minutes (~116 ms) and raises the maximum,
-- which is why no index is added here — an index build across those partitions
-- would block api-server startup, and startup is where migrations run
-- (GOTCHAS #139).
--
-- max_hold_at makes the maximum readable: "46 minutes" alone leaves you
-- wondering whether that was today or in June.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS max_hold_sec integer,
  ADD COLUMN IF NOT EXISTS max_hold_at  timestamptz;

COMMENT ON COLUMN cameras.max_hold_sec IS
  'ช่วงเวลานานสุดที่กล้องเคยเก็บ event ไว้แล้วส่งย้อนหลัง (received_at − event_time, วินาที) — วัดจากข้อมูลจริง ไม่ได้ถามกล้อง';
COMMENT ON COLUMN cameras.max_hold_at IS
  'เวลาที่ event ซึ่งหน่วงนานสุดนั้นถูกส่งมาถึง — ทำให้รู้ว่าสถิตินี้เก่าแค่ไหน';
