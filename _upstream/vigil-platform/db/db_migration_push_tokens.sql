-- ============================================================
-- Migration: push_tokens — Expo push notification device registry
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- Idempotent: safe to re-run (IF NOT EXISTS).
-- Stores one row per device; mobile app registers its Expo push
-- token after login and the alert-engine sends to all enabled rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_tokens (
  id            BIGSERIAL PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,          -- ExponentPushToken[...]
  user_id       INTEGER,                       -- ผู้ login ตอน register (nullable; ไม่ FK กัน device ค้างหลังลบ user)
  platform      VARCHAR(10),                   -- 'ios' | 'android'
  enabled       BOOLEAN DEFAULT TRUE,          -- ปิดได้โดยไม่ลบ (เช่น logout)
  notify_alert  BOOLEAN DEFAULT TRUE,          -- sub-toggle: alert (event มี rule_name)
  notify_face   BOOLEAN DEFAULT TRUE,          -- sub-toggle: face capture
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()      -- อัปเดตทุกครั้งที่ re-register
);

-- เผื่อ table มีอยู่แล้วก่อน sub-toggle (idempotent)
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS notify_alert BOOLEAN DEFAULT TRUE;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS notify_face  BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_push_tokens_enabled ON push_tokens(enabled) WHERE enabled = TRUE;
