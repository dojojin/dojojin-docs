-- ============================================================
-- Migration 027: Third-party read-only views + role
-- ------------------------------------------------------------
-- สร้าง stable views (v_*_public) สำหรับ 3rd party (เช่น BI tool,
-- partner dashboard) ที่ต้องการ raw event/camera data ผ่าน LAN
-- โดยไม่เห็น sensitive column (passwords, RTSP URL, LINE secret,
-- session token, PII)
--
-- Pattern: VIEW + ROLE NOLOGIN
--   - Migration นี้สร้าง role + views + GRANT ให้ role
--   - Ops ใช้ docs/REF_third-party-integration.md §3 ในการ
--     สร้าง login user แล้ว GRANT role นี้ให้ → ไม่มี password
--     หรือ user list อยู่ใน repo
--
-- Setup procedure: docs/REF_third-party-integration.md
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Role (no login; granted to actual login users by ops) ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'third_party_readonly') THEN
    CREATE ROLE third_party_readonly NOLOGIN;
  END IF;
END $$;

COMMENT ON ROLE third_party_readonly IS
  'Read-only access to v_*_public views for 3rd-party integrations. '
  'Granted to login users by ops. See docs/REF_third-party-integration.md.';


-- ── 2. Views — exclude sensitive columns ─────────────────────

CREATE OR REPLACE VIEW v_camera_groups_public AS
SELECT id, name, color, description, sort_order, created_at, updated_at
FROM camera_groups;

-- cameras: ⛔ http_user, http_password, rtsp_url excluded
CREATE OR REPLACE VIEW v_cameras_public AS
SELECT
  id, name, description,
  ip_address, http_port,
  mqtt_topic_prefix,
  model, firmware, serial_number,
  latitude, longitude, location_label,
  group_id,
  enabled, last_seen_at, last_event_at,
  enable_snapshot, enable_vca_overlay, enable_clip_capture,
  clip_pre_sec, clip_post_sec,
  created_at, updated_at
FROM cameras;

-- events: ⛔ raw_json excluded (internal MQTT payload, transient fields)
CREATE OR REPLACE VIEW v_events_public AS
SELECT
  id, camera_id,
  event_time, received_at,
  event_type, event_category, event_state, rule_name,
  object_id, object_class, likelihood,
  snapshot_filename, has_snapshot,
  clip_file, clip_status, clip_duration_sec
FROM events;

CREATE OR REPLACE VIEW v_appearances_public AS
SELECT
  id, event_id, camera_id, object_id, object_class,
  gender, age_group,
  upper_color, lower_color,
  vehicle_type, vehicle_color,
  confidence, attributes, detected_at
FROM appearances;

-- ⚠️ PDPA: ทะเบียนรถเป็นข้อมูลส่วนบุคคล — ต้องมี Data Sharing
-- Agreement ก่อน grant role ให้ user ที่จะอ่าน view นี้
CREATE OR REPLACE VIEW v_license_plates_public AS
SELECT
  id, event_id, camera_id,
  plate_number, confidence, country, region,
  bbox_x, bbox_y, bbox_width, bbox_height,
  detected_at
FROM license_plates;

-- alert_rules: ⛔ recipient_ids, message_template excluded
--              (อาจมี LINE recipient ID + custom internal message)
CREATE OR REPLACE VIEW v_alert_rules_public AS
SELECT
  id, name, enabled,
  camera_ids, rule_names,
  cooldown_seconds, send_snapshot,
  active_from, active_to,
  last_triggered_at, trigger_count,
  created_at, updated_at
FROM alert_rules;

-- alert_logs: ⛔ message_text, error_message excluded (อาจมี internal info)
CREATE OR REPLACE VIEW v_alert_logs_public AS
SELECT
  id, rule_id, rule_name, event_id,
  camera_id, triggered_rule, event_time,
  status, recipient_count, duration_ms,
  sent_at
FROM alert_logs;

CREATE OR REPLACE VIEW v_event_categories_public AS
SELECT id, name, icon, color, kind, is_builtin, sort_order, created_at, updated_at
FROM event_categories;

CREATE OR REPLACE VIEW v_event_category_rules_public AS
SELECT id, category_id, camera_id, rule_name, event_type, object_class,
       match_state, priority, created_at
FROM event_category_rules;

-- system_settings: filter out keys ที่อาจ sensitive ในอนาคต
CREATE OR REPLACE VIEW v_system_settings_public AS
SELECT key, value, description, updated_at
FROM system_settings
WHERE key NOT LIKE 'line_%'
  AND key NOT LIKE 'license_%'
  AND key NOT LIKE 'secret_%'
  AND key NOT LIKE '%_token'
  AND key NOT LIKE '%_password';

-- report_history: ⛔ file_path (internal), recipients_sent (email PII),
--                 error_message (อาจมี stack trace) excluded
CREATE OR REPLACE VIEW v_report_history_public AS
SELECT id, schedule_id, report_type,
       range_from, range_to, image_layout,
       sent_count, total_recipients, status,
       created_at
FROM report_history;


-- ── 3. Grants ────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO third_party_readonly;

GRANT SELECT ON
  v_camera_groups_public,
  v_cameras_public,
  v_events_public,
  v_appearances_public,
  v_license_plates_public,
  v_alert_rules_public,
  v_alert_logs_public,
  v_event_categories_public,
  v_event_category_rules_public,
  v_system_settings_public,
  v_report_history_public
TO third_party_readonly;


-- ── 4. View documentation (visible via \dv+ / \d+ in psql) ───
COMMENT ON VIEW v_events_public IS
  'Public event view (excludes raw_json). ALWAYS filter by event_time '
  '— table holds millions of rows; full scan will lag the ingester.';

COMMENT ON VIEW v_cameras_public IS
  'Public camera view (excludes http_user, http_password, rtsp_url).';

COMMENT ON VIEW v_license_plates_public IS
  'PDPA-gated: license plate data. Requires Data Sharing Agreement '
  'before granting read access — exclude from role grant if not in DPA scope.';

COMMENT ON VIEW v_alert_rules_public IS
  'Public alert rule view (excludes recipient_ids, message_template).';

COMMENT ON VIEW v_alert_logs_public IS
  'Public alert log view (excludes message_text, error_message).';

COMMENT ON VIEW v_report_history_public IS
  'Public report history view (excludes file_path, recipients_sent, error_message).';

COMMENT ON VIEW v_system_settings_public IS
  'Public settings view — filters out keys matching line_*, license_*, '
  'secret_*, *_token, *_password for future-proofing.';
