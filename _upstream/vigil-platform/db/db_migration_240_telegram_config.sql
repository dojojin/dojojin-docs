-- ============================================================
-- Vigil Platform — Migration 240: Telegram สำรอง LINE (T1 — ท่อส่ง + หน้าตั้งค่า)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T1) — Telegram เป็นช่องทาง
-- สำรองของ LINE (โควตาเต็ม/ปฏิเสธ) และช่องทางสำหรับกลุ่มที่ไม่ได้ใช้ LINE (เช่น
-- หน่วยงานตำรวจ) T1 นี้แค่ต่อบอทกับระบบ + หน้าตั้งค่า — ยังไม่มีแจ้งเตือนจริงส่งออก
--
-- รูปแบบตารางตาม line_config (แถวเดียว, id=1) + pending_recipients
-- (migration 023) คู่กันเป็น telegram_pending — คนละตารางเพราะ id เป็น bigint
-- (Telegram chat id) ไม่ใช่ text แบบ LINE user/group id
--
--   telegram_config.bot_token_enc : เข้ารหัสด้วย encryptPii (helpers/blacklist-crypto)
--                                    เหมือน PII อื่น — ห้ามเก็บ plaintext
--   telegram_config.chats         : jsonb array [{chat_id, name, type, enabled,
--                                    lpr_enabled, lpr_sites, lpr_groups,
--                                    mirror_of_line_id}] — รูปร่างเดียวกับ
--                                    line_config.recipients (T2 จะใช้ selectRecipients
--                                    ตัวเดียวกันกรองทั้งสองที่) T1 แค่เก็บรูปร่างไว้
--   telegram_config.poll_offset   : offset ของ getUpdates — เก็บ DB กันหาย/ซ้ำตอน restart
--   telegram_pending.status       : pending → approve/ignore/block โดยแอดมิน
--                                    (เพิ่ม 'blocked' ไว้ตั้งแต่ต้น ต่างจาก migration 023
--                                    เดิมที่ไม่มี เพราะ LINE ต้อง migration แยกเพิ่มทีหลัง)
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_config (
  id            INT PRIMARY KEY DEFAULT 1,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  bot_token_enc TEXT,
  bot_username  TEXT,
  poll_offset   BIGINT NOT NULL DEFAULT 0,
  chats         JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO telegram_config (id, enabled, chats)
VALUES (1, false, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS telegram_pending (
  chat_id     BIGINT PRIMARY KEY,
  title       TEXT,
  type        TEXT,
  added_by    TEXT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'ignored', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_pending_status_last
  ON telegram_pending (status, last_seen DESC);
