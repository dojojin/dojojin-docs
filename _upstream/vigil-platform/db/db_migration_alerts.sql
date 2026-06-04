-- ============================================================
-- Bosch CCTV Dashboard — LINE Alert System Migration
-- Run AFTER existing tables (cameras, events, appearances, license_plates)
-- ============================================================

-- ── Table: line_config ──────────────────────────────────────
-- เก็บค่า config ของ LINE Messaging API (1 row only)
CREATE TABLE IF NOT EXISTS line_config (
  id                    INT PRIMARY KEY DEFAULT 1,
  channel_access_token  TEXT,
  channel_secret        TEXT,
  imgbb_api_key         TEXT,
  enabled               BOOLEAN DEFAULT false,
  recipients            JSONB DEFAULT '[]'::jsonb,
  -- recipients format: [{type:'user'|'group', id:'Uxxx', name:'แอดมิน', enabled:true}]
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)  -- enforce single row
);

-- Insert default row if not exists
INSERT INTO line_config (id, channel_access_token, recipients, enabled)
VALUES (1, NULL, '[]'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

-- ── Table: alert_rules ──────────────────────────────────────
-- เก็บ rule แต่ละข้อสำหรับการแจ้งเตือน
CREATE TABLE IF NOT EXISTS alert_rules (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(150) NOT NULL,
  enabled             BOOLEAN DEFAULT true,

  -- Filter: ถ้า array ว่าง = match ทุก camera/rule_name
  camera_ids          TEXT[] DEFAULT ARRAY[]::TEXT[],
  rule_names          TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Recipient ที่จะส่งให้ (subset ของ line_config.recipients)
  -- format: ['Uxxx', 'Cyyy']  → recipient.id ที่ตรงกัน
  recipient_ids       TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Behavior
  cooldown_seconds    INT DEFAULT 60,
  send_snapshot       BOOLEAN DEFAULT true,
  message_template    TEXT DEFAULT '🚨 [{camera}] {rule}
⏰ {time}
👤 {object_class} ({likelihood})',

  -- State (last triggered tracking สำหรับ cooldown)
  last_triggered_at   TIMESTAMPTZ,
  trigger_count       INT DEFAULT 0,

  -- Audit
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);

-- ── Table: alert_logs ───────────────────────────────────────
-- Syslog: บันทึกทุก attempt การส่งแจ้งเตือน (text only)
CREATE TABLE IF NOT EXISTS alert_logs (
  id                BIGSERIAL PRIMARY KEY,
  rule_id           INT REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_name         VARCHAR(150),       -- snapshot ตอนส่ง (กันลบ rule แล้ว log หาย)
  event_id          BIGINT,             -- reference ไป events table (อาจถูกลบทีหลัง)

  -- Event context (snapshot ตอนส่ง)
  camera_id         VARCHAR(100),
  triggered_rule    VARCHAR(150),       -- rule_name ของ event ที่ trigger
  event_time        TIMESTAMPTZ,

  -- Send result
  status            VARCHAR(20),        -- 'success' | 'failed' | 'cooldown_skip' | 'no_recipients' | 'disabled'
  message_text      TEXT,
  recipient_count   INT DEFAULT 0,
  error_message     TEXT,
  duration_ms       INT,                -- response time จาก LINE API

  sent_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_logs_sent ON alert_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_logs_rule ON alert_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_camera ON alert_logs(camera_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_status ON alert_logs(status);

-- ── Auto-update updated_at trigger ───────────────────────────
CREATE OR REPLACE FUNCTION update_alert_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_alert_rules_updated_at();
