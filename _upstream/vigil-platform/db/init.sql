-- ============================================================
-- Vigil Platform — Database Initialization Script
-- ============================================================
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @contact   prakasit@dojojin.tech | https://dojojin.tech/
-- @version   1.0.0
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ============================================================
-- This script creates all 9 core tables for the system:
--
--   📷 Camera & Events:    cameras, camera_groups, events,
--                          appearances, license_plates
--   🔔 Alert System:       line_config, alert_rules, alert_logs
--   🔐 Authentication:     users, sessions, audit_log
--
-- Run with:
--   docker exec -i vigil-postgres psql -U vigil_sql -d vigil_platform < db/init.sql
--
-- This script is IDEMPOTENT — safe to run multiple times.
-- ============================================================

-- ============================================================
-- SECTION 0: Setup
-- ============================================================

-- Force UTC timezone — สำคัญสำหรับ event_time ที่ส่งจากกล้อง
SET timezone = 'UTC';
ALTER DATABASE vigil_platform SET timezone = 'UTC';

-- Extension สำหรับ JSONB GIN indexes (built-in อยู่แล้ว แต่ไว้กันลืม)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- ถ้าต้องการ fuzzy search


-- ============================================================
-- SECTION 1: Camera Groups & Cameras
-- ============================================================

-- ── Table: camera_groups ────────────────────────────────────
-- จัดกลุ่มกล้อง — ใช้สำหรับ filter ใน Dashboard
CREATE TABLE IF NOT EXISTS camera_groups (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  color       VARCHAR(7) DEFAULT '#5B8DEF',  -- hex color สำหรับ UI
  description TEXT,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Table: cameras ──────────────────────────────────────────
-- ข้อมูลกล้องและสถานะ
CREATE TABLE IF NOT EXISTS cameras (
  id              VARCHAR(100) PRIMARY KEY,    -- เช่น "BoschCam1" (ตรงกับ MQTT topic)
  name            VARCHAR(150) NOT NULL,        -- ชื่อแสดงใน UI
  description     TEXT,

  -- Network
  ip_address      VARCHAR(45),                  -- รองรับ IPv6
  http_port       INT DEFAULT 80,
  http_user       VARCHAR(50),

  -- MQTT
  mqtt_topic_prefix VARCHAR(150),               -- เช่น "BoschCam1/"

  -- Hardware
  model           VARCHAR(100),                 -- เช่น "FlexiDome 8100i"
  firmware        VARCHAR(50),
  serial_number   VARCHAR(100),

  -- Location (สำหรับแผนที่)
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  location_label  VARCHAR(255),                 -- เช่น "ชั้น 2 ทางเข้าหลัก"

  -- Grouping
  group_id        INT REFERENCES camera_groups(id) ON DELETE SET NULL,

  -- Status & heartbeat
  enabled         BOOLEAN DEFAULT true,
  paused          BOOLEAN NOT NULL DEFAULT FALSE, -- maintenance mode: skips ingesters + watchdog
  last_seen_at    TIMESTAMPTZ,                  -- last MQTT heartbeat
  last_event_at   TIMESTAMPTZ,                  -- last event received

  -- Phase 6.1 — per-camera media capture toggles
  enable_snapshot     BOOLEAN DEFAULT true,     -- HTTP snapshot fetch on alarm
  enable_vca_overlay  BOOLEAN DEFAULT true,     -- request snapshot with burned-in IVA bounding box
  enable_clip_capture BOOLEAN DEFAULT false,    -- 24/7 RTSP rolling buffer + dump on alarm
  clip_pre_sec        INT     DEFAULT 10,       -- pre-alarm window (1..60)
  clip_post_sec       INT     DEFAULT 5,        -- post-alarm window (0..30)

  -- Migration 043 — client-side snapshot overlay (SVG from raw_json coords;
  -- ไม่เกี่ยวกับ enable_vca_overlay ซึ่งเผากรอบลงไฟล์รูปฝั่งกล้อง Bosch)
  overlay_show_bbox   BOOLEAN DEFAULT true,     -- กรอบวัตถุ (Dahua BBox / Hik faceRect)
  overlay_show_zone   BOOLEAN DEFAULT true,     -- polygon โซนของ rule (Dahua DetectRegion)

  -- Audit
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cameras_group ON cameras(group_id);
CREATE INDEX IF NOT EXISTS idx_cameras_enabled ON cameras(enabled);
CREATE INDEX IF NOT EXISTS idx_cameras_lastseen ON cameras(last_seen_at DESC);


-- ============================================================
-- SECTION 2: Events & Detected Objects
-- ============================================================

-- ── Table: events ───────────────────────────────────────────
-- Events หลัก — ทุก IVA event จากกล้อง
CREATE TABLE IF NOT EXISTS events (
  id                  BIGSERIAL PRIMARY KEY,
  camera_id           VARCHAR(100) NOT NULL,    -- ไม่ FK เพื่อให้รับ event ก่อน camera ถูก register

  -- เวลา (UTC)
  event_time          TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ DEFAULT NOW(),

  -- Event metadata
  event_type          VARCHAR(50),              -- "Crossing line 1", "Object In Field", "Loitering"
  event_category      VARCHAR(50),              -- "RuleEngine" / "VideoSource" / "Device" / "Behavior"
  event_state         VARCHAR(20),              -- "active", "inactive", "single"
  rule_name           VARCHAR(150),             -- ชื่อ rule ที่ trigger

  -- Object detection
  object_id           VARCHAR(50),              -- track ID ของวัตถุที่ตรวจจับ
  object_class        VARCHAR(30),              -- "Person" / "Vehicle" / "Bicycle" / "Animal"
  likelihood          REAL,                     -- confidence score (0.0-1.0)

  -- Snapshot
  snapshot_filename   VARCHAR(255),             -- ไฟล์ภาพที่บันทึก (relative path)
  has_snapshot        BOOLEAN DEFAULT false,

  -- Phase 6.1 — pre-alarm video clip from media-recorder.js
  clip_file           TEXT,                     -- e.g. "12345.mp4" (under media/ dir)
  clip_status         VARCHAR(16),              -- 'pending' | 'done' | 'failed'
  clip_duration_sec   REAL,                     -- actual capture duration

  -- Raw payload (filtered — ไม่เก็บ base64 image, motion fields, ฯลฯ)
  raw_json            JSONB
);

-- Indexes สำหรับ performance
CREATE INDEX IF NOT EXISTS idx_events_camera ON events(camera_id);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_rule ON events(rule_name);
CREATE INDEX IF NOT EXISTS idx_events_class ON events(object_class);
CREATE INDEX IF NOT EXISTS idx_events_camera_time ON events(camera_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_has_snapshot_time ON events(event_time DESC) WHERE has_snapshot = TRUE;
CREATE INDEX IF NOT EXISTS idx_events_camera_snapshot_time ON events(camera_id, event_time DESC) WHERE has_snapshot = TRUE;
-- ── Table: appearances ──────────────────────────────────────
-- รายละเอียดบุคคล/ยานพาหนะที่ตรวจจับได้ (จาก IVA Pro)
CREATE TABLE IF NOT EXISTS appearances (
  id              BIGSERIAL PRIMARY KEY,
  event_id        BIGINT REFERENCES events(id) ON DELETE CASCADE,
  camera_id       VARCHAR(100),
  object_id       VARCHAR(50),
  object_class    VARCHAR(30),

  -- Person attributes
  gender          VARCHAR(20),                  -- "male" / "female" / null
  age_group       VARCHAR(20),                  -- "child" / "adult" / "senior" / null

  -- Color attributes
  upper_color     VARCHAR(30),                  -- เสื้อ
  lower_color     VARCHAR(30),                  -- กางเกง

  -- Vehicle attributes
  vehicle_type    VARCHAR(30),                  -- "car" / "truck" / "motorcycle"
  vehicle_color   VARCHAR(30),

  -- Confidence
  confidence      REAL,

  -- IVA Pro Appearance attributes (migration 031)
  hair_length       VARCHAR(20),
  hair_color_xyz    VARCHAR(30),
  hair_color        VARCHAR(30),
  top_category      VARCHAR(40),
  top_color_xyz     VARCHAR(30),
  bottom_category   VARCHAR(40),
  bottom_color_xyz  VARCHAR(30),
  glasses           BOOLEAN,
  bag_category      VARCHAR(40),
  helmet_wear       BOOLEAN,
  helmet_subtype    VARCHAR(40),
  vest_style        VARCHAR(40),
  -- Dominant whole-object color จากกล้อง IVA non-Pro (migration 041)
  overall_color     VARCHAR(20),
  overall_color_xyz VARCHAR(30),
  -- ColorCluster ครบชุด [{xyz,name,weight}] เรียงตาม weight (migration 042)
  color_clusters    JSONB,
  -- Raw attribute JSON (สำหรับ attributes อื่นๆ)
  attributes      JSONB DEFAULT '{}'::jsonb,

  detected_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appearances_event ON appearances(event_id);
CREATE INDEX IF NOT EXISTS idx_appearances_camera ON appearances(camera_id);
CREATE INDEX IF NOT EXISTS idx_appearances_class      ON appearances(object_class);
CREATE INDEX IF NOT EXISTS idx_appearances_gender     ON appearances(gender);
CREATE INDEX IF NOT EXISTS idx_appearances_top_category  ON appearances(top_category);
CREATE INDEX IF NOT EXISTS idx_appearances_bot_category  ON appearances(bottom_category);

-- ── Table: license_plates ───────────────────────────────────
-- LPR (License Plate Recognition) data
CREATE TABLE IF NOT EXISTS license_plates (
  id              BIGSERIAL PRIMARY KEY,
  event_id        BIGINT REFERENCES events(id) ON DELETE CASCADE,
  camera_id       VARCHAR(100),

  plate_number    VARCHAR(20),                  -- ทะเบียนรถ
  confidence      REAL,
  country         VARCHAR(10),                  -- "TH", "MY", etc.
  region          VARCHAR(50),                  -- จังหวัด

  -- Vehicle metadata (multi-vendor: Bosch/Hikvision/Dahua/PlateRecognizer)
  vehicle_type    VARCHAR(30),                  -- Car/Truck/Motorcycle/Bus
  vehicle_color   VARCHAR(20),                  -- White/Black/Silver (Hikvision/Dahua/cloud)
  vehicle_brand   VARCHAR(50),                  -- Toyota/Honda (Bosch/cloud)

  -- Bounding box (optional)
  bbox_x          INT,
  bbox_y          INT,
  bbox_width      INT,
  bbox_height     INT,

  detected_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plates_event ON license_plates(event_id);
CREATE INDEX IF NOT EXISTS idx_plates_camera ON license_plates(camera_id);
CREATE INDEX IF NOT EXISTS idx_plates_number ON license_plates(plate_number);


-- ============================================================
-- SECTION 3: Alert System (LINE Notification)
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

-- Insert default empty row
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
  event_id          BIGINT,             -- reference ไป events table

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


-- ============================================================
-- SECTION 4: User Authentication
-- ============================================================

-- ── Table: users ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(50) UNIQUE NOT NULL,
  email           VARCHAR(100) UNIQUE,
  full_name       VARCHAR(150),
  password_hash   TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer' | 'auditor'
  enabled         BOOLEAN DEFAULT true,
  must_change_password BOOLEAN DEFAULT false,

  -- Login tracking
  last_login_at   TIMESTAMPTZ,
  last_login_ip   VARCHAR(45),
  failed_attempts INT DEFAULT 0,
  locked_until    TIMESTAMPTZ,

  -- Audit
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,

  CHECK (role IN ('admin', 'viewer', 'auditor'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_enabled ON users(enabled);

-- ── Table: sessions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              VARCHAR(64) PRIMARY KEY,  -- random session ID (hex)
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_used_at    TIMESTAMPTZ DEFAULT NOW(),
  revoked         BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── Table: audit_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  username        VARCHAR(50),  -- snapshot
  action          VARCHAR(50) NOT NULL,
  -- actions: 'login_success', 'login_failed', 'login_locked', 'logout',
  --          'password_change', 'password_reset',
  --          'user_create', 'user_update', 'user_delete',
  --          'session_revoke'
  target_user_id  INT,          -- ถ้า action เป็นการแก้ user คนอื่น
  target_username VARCHAR(50),
  target_camera_id TEXT,        -- ถ้า action เกี่ยวกับกล้อง
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  details         JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_target_camera ON audit_log(target_camera_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);


-- ============================================================
-- SECTION 5: Functions & Triggers
-- ============================================================

-- ── Generic: auto-update updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at column
DROP TRIGGER IF EXISTS trg_camera_groups_updated ON camera_groups;
CREATE TRIGGER trg_camera_groups_updated
  BEFORE UPDATE ON camera_groups
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_cameras_updated ON cameras;
CREATE TRIGGER trg_cameras_updated
  BEFORE UPDATE ON cameras
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_alert_rules_updated ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_line_config_updated ON line_config;
CREATE TRIGGER trg_line_config_updated
  BEFORE UPDATE ON line_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── Cleanup function: ลบ data เก่า ──────────────────────────
-- เรียกจาก api-server.js setInterval (รายชั่วโมง)
-- หรือใช้ pg_cron extension (production)
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS TABLE(action TEXT, deleted_count BIGINT) AS $$
DECLARE
  sessions_deleted BIGINT;
  audit_deleted BIGINT;
  alert_logs_deleted BIGINT;
BEGIN
  -- Delete expired sessions
  DELETE FROM sessions WHERE expires_at < NOW() OR revoked = true;
  GET DIAGNOSTICS sessions_deleted = ROW_COUNT;

  -- Delete audit logs older than 90 days
  DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;

  -- Delete alert logs older than 90 days
  DELETE FROM alert_logs WHERE sent_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS alert_logs_deleted = ROW_COUNT;

  RETURN QUERY VALUES
    ('expired_sessions', sessions_deleted),
    ('old_audit_logs', audit_deleted),
    ('old_alert_logs', alert_logs_deleted);
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- SECTION 6: Default Data
-- ============================================================

-- Default camera group "Default"
INSERT INTO camera_groups (id, name, color, sort_order)
VALUES (1, 'Default', '#5B8DEF', 0)
ON CONFLICT (id) DO NOTHING;

-- ⚠️ Note: Default admin user (admin/changeme) จะถูกสร้างโดย auth.js
-- ตอน start api-server.js ครั้งแรก — ไม่สร้างใน SQL เพราะต้อง bcrypt hash
-- ดู auth.js → ensureDefaultAdmin()


-- ============================================================
-- SECTION 6.5: Event Categories & System Settings (Stats v2)
-- ============================================================

CREATE TABLE IF NOT EXISTS event_categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  icon        VARCHAR(20)  DEFAULT '🚨',
  color       VARCHAR(20)  DEFAULT '#5b8def',
  kind        VARCHAR(20)  NOT NULL DEFAULT 'event',
  is_builtin  BOOLEAN      NOT NULL DEFAULT false,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT event_categories_kind_chk
    CHECK (kind IN ('event', 'people_counter', 'vehicle_counter'))
);

CREATE INDEX IF NOT EXISTS idx_event_categories_sort
  ON event_categories (sort_order, id);

DROP TRIGGER IF EXISTS trg_event_categories_updated ON event_categories;
CREATE TRIGGER trg_event_categories_updated
  BEFORE UPDATE ON event_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS event_category_rules (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES event_categories(id) ON DELETE CASCADE,
  camera_id     VARCHAR(80),
  rule_name     VARCHAR(200),
  event_type    VARCHAR(80),
  object_class  VARCHAR(40),
  match_state   VARCHAR(10) DEFAULT 'true',
  priority      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecr_category ON event_category_rules (category_id);
CREATE INDEX IF NOT EXISTS idx_ecr_camera   ON event_category_rules (camera_id);

CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(80) PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_system_settings_updated ON system_settings;
CREATE TRIGGER trg_system_settings_updated
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Built-in categories (locked)
INSERT INTO event_categories (name, icon, color, kind, is_builtin, sort_order) VALUES
  ('People Counting',  '🚶', '#22c55e', 'people_counter',  true, 1),
  ('Vehicle Counting', '🚗', '#5b8def', 'vehicle_counter', true, 2)
ON CONFLICT (name) DO NOTHING;

-- Default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('data_retention_days',     '365',           'Days of events to keep (max 730).'),
  ('snapshot_retention_days',    '30',  'Days of snapshot images to keep on disk (max 365).'),
  ('appearances_retention_days', '30',  'Days of appearance attribute data to keep before anonymisation (max 730).'),
  ('display_timezone',        'Asia/Bangkok',  'Timezone for date boundaries / midnight reset.'),
  ('counter_dedup_mode',      'state',         'state | object_window | none'),
  ('comparison_mode',         'rolling',       'rolling | calendar.'),
  ('custom_range_max_days',   '365',           'Max span for custom date range picker.'),
  -- Branding (white-label)
  ('brand_name',              'Vigil Platform', 'Product name shown in sidebar, login, disclaimer and PDF report header.'),
  ('brand_tagline',           'CCTV Analytics Suite',   'Short subtitle under the brand name.'),
  ('brand_logo_path',         '',                       'Path under /branding/ (e.g. logo.png). Empty = fall back to default emoji.'),
  ('brand_primary_color',     '#5b8def',                'Single accent colour applied across the dashboard.')
ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- SECTION 7: Verification (ดูสถานะหลัง init)
-- ============================================================

-- รันคำสั่งต่อไปนี้เพื่อตรวจว่าทุก table สร้างสำเร็จ:
--
--   \dt                         -- list all tables
--   \d events                   -- describe events table
--   SELECT cleanup_old_data();  -- test cleanup function
--
-- Expected tables (10 total):
--   - audit_log
--   - alert_logs
--   - alert_rules
--   - appearances
--   - camera_groups
--   - cameras
--   - events
--   - license_plates
--   - line_config
--   - sessions
--   - users

-- Show table count
SELECT
  schemaname,
  COUNT(*) AS table_count
FROM pg_tables
WHERE schemaname = 'public'
GROUP BY schemaname;

-- Show all tables with size info
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================
-- DONE — Schema initialized successfully
-- Next step: start api-server.js to create default admin user
-- ============================================================
