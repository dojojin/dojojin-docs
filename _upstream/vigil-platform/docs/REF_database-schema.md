<!-- ============================================================ -->
<!-- Vigil Platform — Database Schema Reference          -->
<!-- @author Prakasit Rochanavipart (Dojo-mAn)                   -->
<!-- @copyright (c) 2025-2026 All Rights Reserved.               -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Database Schema Reference — PostgreSQL

> **วัตถุประสงค์:** เอกสารอ้างอิงสำหรับ DBA, ทีม integration, หรือ 3rd party ที่ต้องการเชื่อมต่อ / อ่านข้อมูลจากฐานข้อมูลนี้  
> Last updated: 2026-06-08 · Version: v1.5.0  
> Source of truth: `db/init.sql` + migration files `db/db_migration_*.sql`

---

## 1. Connection Details

| Parameter | Value | หมายเหตุ |
|---|---|---|
| Engine | PostgreSQL 16 (Alpine) | Docker image `postgres:16-alpine` |
| Host (internal) | `postgres` (Docker service name) | ใน Docker network `vigil-platform_default` |
| Host (external) | `localhost` หรือ IP ของ host | ถ้า expose port ออกมา |
| Port | `5432` | Standard PostgreSQL port |
| Database | `vigil_platform` | |
| **Username** | `vigil_sql` | DB owner — full read/write access |
| **Password** | ดู `.env` (`DB_PASSWORD`) | Default ใน `docker-compose.yml`: `bosch2025` — **ต้องเปลี่ยนใน production** |
| Timezone | UTC (forced) | `ALTER DATABASE vigil_platform SET timezone = 'UTC'` — ทุก `TIMESTAMPTZ` เก็บ UTC |
| SSL | ไม่ได้ configure (off by default) | ต้องเพิ่มถ้าเปิดรับ remote connection |

> ⚠️ **รหัสผ่านใน docker-compose.yml ไม่ใช่ค่า production จริง** — ค่าจริงอยู่ใน `.env` (gitignored) บน server

---

## 2. Tables Overview

```
Database: vigil_platform (schema: public)

📷 Camera & Events
   camera_groups           — จัดกลุ่มกล้อง
   cameras                 — ข้อมูลกล้องและสถานะ
   events                  — IVA events ทั้งหมด (ตารางหลัก — ใหญ่สุด)
   appearances             — attributes บุคคล/ยานพาหนะต่อ event
   license_plates          — LPR (License Plate Recognition) data

🔔 Alert System
   line_config             — LINE Messaging API config (1 row)
   alert_rules             — กฎการแจ้งเตือน
   alert_logs              — log ทุก attempt การส่งแจ้งเตือน

🔐 Authentication
   users                   — user accounts ของระบบ
   sessions                — active sessions
   audit_log               — audit trail ของทุก action

📊 Analytics & System
   event_categories        — หมวดหมู่ analytics (custom + built-in)
   event_category_rules    — mapping rule → category
   system_settings         — settings และ branding (key/value)
   report_schedules        — ตั้งเวลาส่ง report อัตโนมัติ
   report_history          — log การส่ง report ทุกครั้ง
```

---

## 3. Table Schemas (ละเอียด)

### 3.1 `camera_groups`
จัดกลุ่มกล้อง — ใช้ filter ใน dashboard

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) NOT NULL | ชื่อกลุ่ม |
| `color` | VARCHAR(7) | hex color (UI badge) — default `#5B8DEF` |
| `description` | TEXT | |
| `sort_order` | INT | ลำดับใน UI |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-updated via trigger |

---

### 3.2 `cameras`
ข้อมูลกล้องทุกตัว + สถานะ online/offline

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(100) PK | ตรงกับ MQTT topic prefix เช่น `BoschCam1` |
| `name` | VARCHAR(150) | ชื่อแสดงใน UI |
| `description` | TEXT | |
| `ip_address` | VARCHAR(45) | รองรับ IPv6 |
| `http_port` | INT | default 80 |
| `http_user` | VARCHAR(50) | username HTTP กล้อง |
| `http_password` | TEXT | **⚠️ sensitive** — รหัสผ่าน HTTP กล้อง (plain text บน disk — ควร encrypt) |
| `rtsp_url` | TEXT | **⚠️ sensitive** — อาจมี credentials ใน URL |
| `mqtt_topic_prefix` | VARCHAR(150) | เช่น `BoschCam1/` |
| `model` | VARCHAR(100) | เช่น `FlexiDome 8100i` |
| `firmware` | VARCHAR(50) | |
| `serial_number` | VARCHAR(100) | |
| `latitude` | DOUBLE PRECISION | พิกัด GPS |
| `longitude` | DOUBLE PRECISION | พิกัด GPS |
| `location_label` | VARCHAR(255) | คำอธิบายตำแหน่ง |
| `group_id` | INT FK → `camera_groups` | |
| `enabled` | BOOLEAN | |
| `last_seen_at` | TIMESTAMPTZ | MQTT heartbeat ล่าสุด |
| `last_event_at` | TIMESTAMPTZ | event ล่าสุด |
| `enable_snapshot` | BOOLEAN | เปิดดึง snapshot เมื่อ alarm |
| `enable_vca_overlay` | BOOLEAN | snapshot แบบมี IVA bounding box |
| `enable_clip_capture` | BOOLEAN | บันทึก video clip |
| `clip_pre_sec` | INT | วินาทีก่อน alarm (1..60) |
| `clip_post_sec` | INT | วินาทีหลัง alarm (0..30) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:** `group_id`, `enabled`, `last_seen_at DESC`

---

### 3.3 `events`
**ตารางหลักและใหญ่สุด** — IVA events จากกล้องทุกตัว ผ่าน MQTT ingester

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `camera_id` | VARCHAR(100) | **ไม่มี FK** — ตั้งใจให้รับ event ก่อน camera register ได้ |
| `event_time` | TIMESTAMPTZ NOT NULL | เวลาจากกล้อง (UTC) |
| `received_at` | TIMESTAMPTZ | เวลาที่ระบบรับ |
| `event_type` | VARCHAR(50) | เช่น `Crossing line 1`, `Object In Field` |
| `event_category` | VARCHAR(50) | `RuleEngine` / `VideoSource` / `Device` / `Behavior` |
| `event_state` | VARCHAR(20) | `active` / `inactive` / `single` |
| `rule_name` | VARCHAR(150) | ชื่อ rule ที่ trigger |
| `object_id` | VARCHAR(50) | track ID วัตถุ |
| `object_class` | VARCHAR(30) | `Person` / `Vehicle` / `Bicycle` / `Animal` |
| `likelihood` | REAL | confidence score 0.0–1.0 |
| `snapshot_filename` | VARCHAR(255) | path ไฟล์ภาพ (relative) |
| `has_snapshot` | BOOLEAN | |
| `clip_file` | TEXT | ชื่อไฟล์ video clip |
| `clip_status` | VARCHAR(16) | `pending` / `done` / `failed` |
| `clip_duration_sec` | REAL | |
| `raw_json` | JSONB | raw payload (ไม่มี base64 image) |

**Indexes:** `camera_id`, `event_time DESC`, `event_type`, `rule_name`, `object_class`, `(camera_id, event_time DESC)`, partial indexes on `has_snapshot`, GIN on `raw_json`

> **Data volume:** ที่ 100 กล้อง อาจสะสม 5–50 ล้าน rows/ปี ขึ้นอยู่กับ event frequency.  
> Default retention: **365 วัน** (ตั้งใน `system_settings.data_retention_days`)

---

### 3.4 `appearances`
Person/vehicle attributes ต่อ event (จาก Bosch IVA Pro)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK → `events` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(100) | (denormalized) |
| `object_id` | VARCHAR(50) | |
| `object_class` | VARCHAR(30) | `Person` / `Vehicle` |
| `gender` | VARCHAR(20) | `male` / `female` / null |
| `age_group` | VARCHAR(20) | `child` / `adult` / `senior` / null |
| `upper_color` | VARCHAR(30) | สีเสื้อ |
| `lower_color` | VARCHAR(30) | สีกางเกง |
| `vehicle_type` | VARCHAR(30) | `car` / `truck` / `motorcycle` |
| `vehicle_color` | VARCHAR(30) | |
| `confidence` | REAL | |
| `attributes` | JSONB | attributes เพิ่มเติม |
| `detected_at` | TIMESTAMPTZ | |

---

### 3.5 `license_plates`
LPR (License Plate Recognition) data

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK → `events` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(100) | |
| `plate_number` | VARCHAR(20) | ทะเบียนรถ |
| `confidence` | REAL | |
| `country` | VARCHAR(10) | `TH`, `MY`, etc. |
| `region` | VARCHAR(50) | จังหวัด |
| `bbox_x/y/width/height` | INT | bounding box |
| `detected_at` | TIMESTAMPTZ | |

---

### 3.6 `line_config`
LINE Messaging API config — **1 row เสมอ** (id = 1, enforced by CHECK)

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK DEFAULT 1 | |
| `channel_access_token` | TEXT | **⚠️ SECRET** — LINE channel token |
| `channel_secret` | TEXT | **⚠️ SECRET** — LINE channel secret |
| `imgbb_api_key` | TEXT | **⚠️ SECRET** — ImgBB upload key |
| `oa_basic_id` | TEXT | LINE OA @basicId สำหรับ QR code |
| `enabled` | BOOLEAN | |
| `recipients` | JSONB | `[{type, id, name, enabled}]` — LINE user/group IDs |
| `updated_at` | TIMESTAMPTZ | |

> ⛔ **3rd party ห้ามอ่านตารางนี้** — มี API credentials สำคัญ

---

### 3.7 `alert_rules`
กฎการแจ้งเตือนผ่าน LINE

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | ชื่อ rule |
| `enabled` | BOOLEAN | |
| `camera_ids` | TEXT[] | array ว่าง = ทุกกล้อง |
| `rule_names` | TEXT[] | array ว่าง = ทุก rule |
| `recipient_ids` | TEXT[] | LINE recipient IDs |
| `cooldown_seconds` | INT | ป้องกัน flood (default 60s) |
| `send_snapshot` | BOOLEAN | แนบภาพ snapshot |
| `message_template` | TEXT | template พร้อม `{camera}`, `{rule}`, `{time}`, `{object_class}` |
| `active_from` | TIME | เริ่มเวลา active (null = 24/7) |
| `active_to` | TIME | สิ้นสุดเวลา active |
| `last_triggered_at` | TIMESTAMPTZ | |
| `trigger_count` | INT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.8 `alert_logs`
Log ทุก attempt การส่ง LINE notification

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `rule_id` | INT FK → `alert_rules` ON DELETE SET NULL | |
| `rule_name` | VARCHAR(150) | snapshot ณ เวลาส่ง |
| `event_id` | BIGINT | ref ไป `events` (ไม่ FK) |
| `camera_id` | VARCHAR(100) | |
| `triggered_rule` | VARCHAR(150) | |
| `event_time` | TIMESTAMPTZ | |
| `status` | VARCHAR(20) | `success` / `failed` / `cooldown_skip` / `no_recipients` / `disabled` / `quiet_hours_skip` |
| `message_text` | TEXT | |
| `recipient_count` | INT | |
| `error_message` | TEXT | |
| `duration_ms` | INT | response time จาก LINE API |
| `sent_at` | TIMESTAMPTZ | |

**Retention:** ลบอัตโนมัติหลัง **90 วัน** (ฟังก์ชัน `cleanup_old_data()`)

---

### 3.9 `users`
User accounts ของระบบ dashboard (ไม่ใช่ PostgreSQL users)

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `username` | VARCHAR(50) UNIQUE | |
| `email` | VARCHAR(100) UNIQUE | |
| `full_name` | VARCHAR(150) | |
| `password_hash` | TEXT | **⚠️ SECRET** — bcrypt hash (cost=10) |
| `role` | VARCHAR(20) | `admin` / `viewer` / `auditor` |
| `enabled` | BOOLEAN | |
| `must_change_password` | BOOLEAN | force reset on next login |
| `last_login_at` | TIMESTAMPTZ | |
| `last_login_ip` | VARCHAR(45) | **⚠️ PII** — IP address |
| `failed_attempts` | INT | นับ login ผิดติดต่อกัน |
| `locked_until` | TIMESTAMPTZ | null = ไม่ได้ lock |
| `created_at` / `updated_at` | TIMESTAMPTZ | |
| `created_by` | INT FK → `users` | |

> ⛔ **3rd party ห้ามอ่าน `password_hash`** — ถ้าจำเป็นต้องเข้าถึง users ให้ exclude column นี้ใน query

---

### 3.10 `sessions`
Active session tokens ของระบบ

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(64) PK | random hex session ID |
| `user_id` | INT FK → `users` ON DELETE CASCADE | |
| `ip_address` | VARCHAR(45) | **⚠️ PII** |
| `user_agent` | TEXT | |
| `created_at` / `expires_at` / `last_used_at` | TIMESTAMPTZ | |
| `revoked` | BOOLEAN | |

**Retention:** ลบอัตโนมัติเมื่อ `expires_at < NOW()` หรือ `revoked = true`

> ⛔ **3rd party ห้ามอ่านตารางนี้** — มี active session tokens

---

### 3.11 `audit_log`
Audit trail ทุก action ในระบบ

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `user_id` | INT FK → `users` ON DELETE SET NULL | |
| `username` | VARCHAR(50) | snapshot (คงค่าแม้ user ถูกลบ) |
| `action` | VARCHAR(50) | `login_success`, `login_failed`, `login_locked`, `logout`, `password_change`, `user_create`, `user_update`, `user_delete`, `session_revoke` |
| `target_user_id` / `target_username` | INT / VARCHAR | ถ้า action เกี่ยวกับ user อื่น |
| `target_camera_id` | TEXT | ถ้า action เกี่ยวกับกล้อง |
| `ip_address` | VARCHAR(45) | **⚠️ PII** |
| `user_agent` | TEXT | |
| `details` | JSONB | รายละเอียดเพิ่มเติม |
| `created_at` | TIMESTAMPTZ | |

**Retention:** ลบอัตโนมัติหลัง **90 วัน**

---

### 3.12 `event_categories`
หมวดหมู่ analytics (custom + built-in locked)

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(100) UNIQUE | |
| `icon` | VARCHAR(20) | emoji (legacy — ใช้ใน server-rendered text เท่านั้น) |
| `color` | VARCHAR(20) | hex color |
| `kind` | VARCHAR(20) | `event` / `people_counter` / `vehicle_counter` |
| `is_builtin` | BOOLEAN | true = ลบ/แก้ชื่อไม่ได้ |
| `sort_order` | INT | |

**Built-in rows:** `People Counting` (id=1), `Vehicle Counting` (id=2)

---

### 3.13 `event_category_rules`
Mapping: rule/event_type → category (ใช้โดย stats engine)

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `category_id` | INT FK → `event_categories` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(80) | null = ทุกกล้อง |
| `rule_name` | VARCHAR(200) | null = ทุก rule |
| `event_type` | VARCHAR(80) | null = ทุก type |
| `object_class` | VARCHAR(40) | null = ทุก class |
| `match_state` | VARCHAR(10) | default `true` |
| `priority` | INT | |

---

### 3.14 `system_settings`
Key/value store สำหรับ settings และ white-label branding

| Key | Default | คำอธิบาย |
|---|---|---|
| `data_retention_days` | `365` | เก็บ events กี่วัน (max 730) |
| `snapshot_retention_days` | `30` | เก็บ snapshot images กี่วัน (max 365) |
| `display_timezone` | `Asia/Bangkok` | timezone สำหรับ date boundaries |
| `counter_dedup_mode` | `state` | `state` / `object_window` / `none` |
| `comparison_mode` | `rolling` | `rolling` / `calendar` |
| `custom_range_max_days` | `365` | max span ของ date range picker |
| `analytics_event_display` | CSV of camera-auto types | types ที่แสดงใน Events feed |
| `brand_name` | `Vigil Platform` | ชื่อ product (white-label) |
| `brand_tagline` | `CCTV Analytics Suite` | subtitle |
| `brand_logo_path` | `` (empty) | path ไฟล์โลโก้ |
| `brand_primary_color` | `#5b8def` | accent color หลัก |

Schema: `key VARCHAR(80) PK`, `value TEXT`, `description TEXT`, `updated_at TIMESTAMPTZ`

---

### 3.15 `report_schedules`
ตั้งเวลาส่ง report อัตโนมัติ

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `report_type` | VARCHAR(16) | `daily` / `weekly` / `monthly` |
| `enabled` | BOOLEAN | |
| `send_time` | TIME | เวลาส่ง (ใน `display_timezone`) |
| `recipients` | TEXT | CSV email addresses |
| `last_run_at` | TIMESTAMPTZ | ป้องกัน double-fire |
| `last_status` | VARCHAR(24) | `success` / `failed` / `pending` / null |
| `last_error` | TEXT | |

---

### 3.16 `report_history`
Log การส่ง report ทุกครั้ง

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `schedule_id` | INT FK → `report_schedules` ON DELETE SET NULL | |
| `report_type` | VARCHAR(16) | |
| `range_from` / `range_to` | TIMESTAMPTZ | ช่วงเวลาของ report |
| `image_layout` | VARCHAR(12) | layout ที่ใช้ |
| `file_path` | TEXT | ชื่อไฟล์ (serve ผ่าน `/api/report-history/:id/image`) |
| `recipients_sent` | TEXT | CSV ที่ส่งจริง |
| `sent_count` / `total_recipients` | INT | |
| `status` | VARCHAR(24) | `success` / `failed` |
| `error_message` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

---

## 4. Stored Functions & Triggers

| ชื่อ | ประเภท | คำอธิบาย |
|---|---|---|
| `trigger_set_updated_at()` | FUNCTION | auto-update `updated_at` ก่อน UPDATE |
| `cleanup_old_data()` | FUNCTION | ลบ expired sessions + audit/alert logs > 90 วัน — ถูก call โดย api-server.js ทุก 1 ชั่วโมง |
| `trg_*_updated` | TRIGGER | apply `trigger_set_updated_at()` กับ tables ที่มี `updated_at` |

---

## 5. PostgreSQL User & Permissions

### 5.1 PostgreSQL Users & Roles

| Name | Type | ใช้โดย | Notes |
|---|---|---|---|
| `vigil_sql` | Login user / DB owner | `api-server.js`, `migrate.js` | สร้างโดย `docker-compose.yml` (`POSTGRES_USER=vigil_sql`) — full read/write |
| `third_party_readonly` | **Role** (NOLOGIN) | granted to 3rd-party login users | สร้างโดย migration 027 — มี `SELECT` บน `v_*_public` views เท่านั้น |
| `<partner>_ro` | Login user | 3rd party (e.g. BI tool, partner dashboard) | สร้างโดย ops ตาม [REF_third-party-integration.md §3.2](REF_third-party-integration.md) → granted `third_party_readonly` role |

> **App connections** (ingester, API, migration) ใช้ `vigil_sql` ทั้งหมด  
> **3rd party** ใช้ `<partner>_ro` ที่ map ผ่าน role `third_party_readonly`

### 5.2 App Users (ใน `users` table — ไม่ใช่ PostgreSQL user)

| Username (default) | Role | สร้างโดย | Notes |
|---|---|---|---|
| `admin` | `admin` | `auth.js → ensureDefaultAdmin()` | สร้างอัตโนมัติเฉพาะครั้งแรกที่ start (ถ้า users table ว่าง) — password `changeme` — `must_change_password = true` |

Role ใน application: `admin` (full) · `viewer` (read-only UI) · `auditor` (view-all + Settings, no write)

---

## 6. การเชื่อมต่อสำหรับ 3rd Party

> ⭐ **Canonical guide:** [REF_third-party-integration.md](REF_third-party-integration.md) — มี migration script, ops setup, view catalog, query patterns, PDPA, security checklist, decommissioning ครบ
>
> Section นี้เก็บ summary สั้นๆ — สำหรับรายละเอียดเต็มดูไฟล์ด้านบน

### 6.1 Pattern ที่ใช้ — Read-only Role + Stable Views

Migration `db/db_migration_027_third_party_views.sql` สร้าง:
- **Role** `third_party_readonly` (NOLOGIN) — granted ให้ login user โดย ops
- **Views** `v_*_public` 11 ตัว — exclude sensitive columns (passwords, secrets, PII, raw_json)

3rd party query ผ่าน view เท่านั้น ไม่ใช่ base table → schema base table เปลี่ยนได้โดยไม่กระทบ contract

### 6.2 Quick start (Ops)

```sql
-- 1. สร้าง login user
CREATE USER acme_corp_ro WITH PASSWORD '<random>';

-- 2. Grant role
GRANT third_party_readonly TO acme_corp_ro;

-- 3. Quotas
ALTER USER acme_corp_ro SET statement_timeout = '60s';
ALTER USER acme_corp_ro CONNECTION LIMIT 5;
```

ดู REF_third-party-integration.md §3 สำหรับ pg_hba.conf + docker bind + SSL + audit

### 6.3 Connection String ตัวอย่าง

```
postgresql://acme_corp_ro:PASSWORD@<LAN_IP>:5432/vigil_platform?sslmode=require&application_name=acme_dashboard
```

### 6.4 Tables ที่ปลอดภัยสำหรับ 3rd Party อ่าน

| Table | ปลอดภัย? | หมายเหตุ |
|---|---|---|
| `camera_groups` | ✅ ได้ | ข้อมูลทั่วไป |
| `cameras` | ⚠️ ระวัง | **ต้อง exclude `http_password`, `rtsp_url`** — มี credentials กล้อง |
| `events` | ✅ ได้ | ข้อมูลหลัก — ขนาดใหญ่ |
| `appearances` | ✅ ได้ | |
| `license_plates` | ⚠️ ระวัง | **⚠️ PDPA** — ทะเบียนรถเป็นข้อมูลส่วนบุคคล ต้องขออนุญาตก่อน |
| `alert_rules` | ✅ ได้ | |
| `alert_logs` | ✅ ได้ | |
| `event_categories` | ✅ ได้ | |
| `event_category_rules` | ✅ ได้ | |
| `system_settings` | ✅ ได้ | branding + config (ไม่มี secret) |
| `report_history` | ✅ ได้ | ไม่มี sensitive data |
| `report_schedules` | ✅ ได้ | แต่มี email addresses ใน `recipients` |
| `users` | ⛔ ห้าม | มี `password_hash`, PII |
| `sessions` | ⛔ ห้าม | มี active session tokens |
| `line_config` | ⛔ ห้าม | มี LINE API secret + imgbb key |
| `audit_log` | ⛔ ห้าม | มี PII (IP, user actions) |

---

## 7. สิ่งสำคัญที่ 3rd Party ต้องรู้

### 7.1 Timezone
- **ทุก `TIMESTAMPTZ` เก็บ UTC** — query ต้องแปลงเป็น local timezone เอง
- `display_timezone` ในระบบ = `Asia/Bangkok` (UTC+7)
- ตัวอย่าง: `event_time AT TIME ZONE 'Asia/Bangkok'`

### 7.2 `cameras.id` เป็น VARCHAR ไม่ใช่ INT
- `camera_id` ใน `events`, `appearances`, `license_plates`, `alert_logs` เป็น `VARCHAR(100)`
- เช่น `"BoschCam1"`, `"Hik-Front-01"` — ตรงกับ MQTT topic prefix
- **`events.camera_id` ไม่มี FK** ไปหา `cameras` — ตั้งใจให้รับ event ก่อน camera register ได้ → อาจมี `camera_id` ใน `events` ที่ไม่มีใน `cameras`

### 7.3 ขนาดข้อมูล (Estimated)
- `events`: ใหญ่ที่สุด — ควร filter ด้วย `event_time` เสมอ และใช้ index
- `raw_json` ใน `events`: เก็บ MQTT payload — GIN index มีอยู่แล้ว
- `appearances`: proportional กับ `events` (1:0..N per event)
- Default retention: events 365 วัน, snapshots 30 วัน

### 7.4 Idempotent Migrations
- Migration files (`db/db_migration_*.sql`) ทั้งหมด idempotent — safe to re-run
- Runner: `src/migrate.js` — execute อัตโนมัติตอน api-server start (ตาม `schema_migrations` table)
- **ห้ามแก้ `db/init.sql` เพื่อเพิ่ม column** — ต้องเขียน migration ใหม่เสมอ

### 7.5 Cleanup Automatic
- `cleanup_old_data()` ถูก call ทุก 1 ชั่วโมงโดย api-server.js
- ลบ: expired/revoked sessions, audit_log > 90 วัน, alert_logs > 90 วัน
- events ไม่ได้ลบโดย function นี้ — retention จัดการแยกโดย api-server.js

---

## 8. ผลกระทบ (Impact) — หากเปิดให้ 3rd Party เข้าถึง

### 8.1 Security Risks

| ความเสี่ยง | ระดับ | รายละเอียด |
|---|---|---|
| Credential leakage | 🔴 Critical | `cameras.http_password`, `cameras.rtsp_url`, `line_config.*_token/secret`, `users.password_hash`, `sessions.id` — ถ้า 3rd party อ่านได้ = เข้ากล้อง / LINE OA / ปลอมตัวเป็น user ได้ |
| PDPA violation | 🔴 Critical | `license_plates.plate_number`, `users.*`, `audit_log.ip_address` — เป็นข้อมูลส่วนบุคคลตาม PDPA — ต้องมีนโยบาย DPA ก่อนให้เข้าถึง |
| Unauthorized write | 🟠 High | ถ้าใช้ user `vigil_sql` (DB owner) — 3rd party เขียน/ลบข้อมูลได้ทั้งหมด รวมถึงลบ events, แก้ alert rules, inject records ปลอม |
| DB server exposure | 🟠 High | Port 5432 ถ้า bind ไป `0.0.0.0` จะเข้าถึงได้จาก network ภายนอก Docker — ควร firewall/bind เฉพาะ `127.0.0.1` |
| No SSL | 🟡 Medium | DB connection ไม่มี TLS by default — credentials ส่งผ่าน plain text ถ้า remote — ต้องเพิ่ม `sslmode=require` |

### 8.2 Performance Risks

| ความเสี่ยง | ระดับ | รายละเอียด |
|---|---|---|
| Heavy query บน `events` | 🟠 High | query ไม่ใช้ index (`event_time`) — table scan บน millions rows ทำให้ production DB ช้า |
| Connection pool exhaustion | 🟡 Medium | api-server.js ใช้ `pg.Pool` (no explicit max) — 3rd party เพิ่ม concurrent connections อาจชนกัน |
| Lock contention | 🟡 Medium | 3rd party ทำ heavy analytics query ขณะที่ ingester insert events พร้อมกัน |

### 8.3 แนวทางลดความเสี่ยง (Recommendations)

1. **สร้าง read-only user แยก** — อย่าให้ใช้ `vigil_sql` (ดู Section 6.1)
2. **Grant เฉพาะ tables ที่จำเป็น** — อย่า `GRANT ALL ON ALL TABLES`
3. **Bind port เฉพาะ localhost** — แก้ `docker-compose.yml`: `"127.0.0.1:5432:5432"` ถ้าไม่ต้องการ remote
4. **เปิด SSL ถ้า remote** — เพิ่ม `ssl: true` ใน pg Pool config + `sslmode=require` ใน 3rd party
5. **Set `statement_timeout`** ให้ read-only user เพื่อป้องกัน heavy query:
   ```sql
   ALTER USER analytics_readonly SET statement_timeout = '30s';
   ```
6. **ใช้ replica/read replica** ถ้าโหลดสูง — ปัจจุบันไม่มี replication
7. **ตรวจสอบ PDPA compliance** ก่อนให้ 3rd party เข้าถึง `license_plates`

---

## 9. Quick Reference — Tables ที่ใช้บ่อยสำหรับ Analytics

```sql
-- นับ events ต่อกล้องต่อวัน (Asia/Bangkok)
SELECT
  camera_id,
  DATE(event_time AT TIME ZONE 'Asia/Bangkok') AS event_date,
  COUNT(*) AS event_count
FROM events
WHERE event_time >= NOW() - INTERVAL '7 days'
GROUP BY camera_id, event_date
ORDER BY event_date DESC, event_count DESC;

-- Camera status (online/offline ใน 5 นาทีที่ผ่านมา)
SELECT
  id, name,
  last_seen_at,
  CASE WHEN last_seen_at > NOW() - INTERVAL '5 minutes' THEN 'online' ELSE 'offline' END AS status
FROM cameras
WHERE enabled = true
ORDER BY name;

-- TOP events ล่าสุดพร้อม snapshot
SELECT e.id, e.camera_id, c.name AS camera_name,
       e.event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
       e.event_type, e.rule_name, e.object_class, e.snapshot_filename
FROM events e
LEFT JOIN cameras c ON c.id = e.camera_id
WHERE e.has_snapshot = true
ORDER BY e.event_time DESC
LIMIT 20;

-- Alert stats ล่าสุด 24 ชั่วโมง
SELECT status, COUNT(*) AS count
FROM alert_logs
WHERE sent_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;
```

---

## 10. Changelog (Schema)

| Version / Migration | เปลี่ยนแปลง |
|---|---|
| `init.sql` v1.0 | Core tables: cameras, events, appearances, license_plates, line_config, alert_rules, alert_logs, users, sessions, audit_log, system_settings, event_categories |
| migration_011 | `system_settings`: เพิ่ม `analytics_event_display` |
| migration_012 | `alert_rules`: เพิ่ม `active_from`, `active_to` (quiet hours) |
| migration_013 | เพิ่มตาราง `report_schedules` |
| migration_014 | `report_schedules`: เพิ่ม `image_layout` |
| migration_015 | `report_schedules`: เพิ่ม `send_days` (weekly days) |
| migration_016 | เพิ่ม license tables |
| migration_017 | `users.role`: เพิ่ม `auditor` role |
| migration_018 | เพิ่ม camera offline alert columns |
| migration_019 | เพิ่ม `escalate_once` config |
| migration_021 | เพิ่มตาราง `report_history` |
| migration_022 | `report_history`: เพิ่ม `health` report type |
| migration_023 | `line_config`: เพิ่ม pending recipients |
| migration_024 | `audit_log`: เพิ่ม `target_camera_id` |
| migration_025 | `events`: backfill + index `snapshot_filename`, `has_snapshot` |
| migration_026 | `line_config`: เพิ่ม `oa_basic_id` |
| migration_027 | **Third-party views + role** — `v_*_public` (11 views) + `third_party_readonly` NOLOGIN role |
| migration_028 | `pending_recipients`: เพิ่ม `status = 'blocked'` (permanent soft-block) |
| migration_029 | `system_settings`: เพิ่ม `mapbox_token` row (Map Settings page, decision #171) |
| migration_030 | `pg_trgm` GIN index บน `events.event_type` (NOT LIKE '%Aggregation%' optimization) |
| migration_031 | `appearances`: เพิ่ม IVA Pro columns — `hair_length`, `top_category`, `bottom_category`, `glasses`, `helmet_wear`, `object_class` |
| migration_032 | `v_appearances_public`: อัปเดตให้รวม IVA Pro columns จาก migration_031 |
| migration_033 | `appearances`: เพิ่ม `hair_color` (named string — human-readable จาก XYZ raw) |
| migration_034 | `system_settings`: เพิ่ม `appearances_retention_days` row |
| migration_035 | `appearances`: drop `snapshot_b64` column (never read; wasted disk) |
| migration_036 | `license_plates`: เพิ่ม `vehicle_type`, `vehicle_color`, `vehicle_brand` (multi-vendor ANPR) |
| migration_037 | `cameras`: เพิ่ม `paused` flag (maintenance mode) |
| migration_038 | `cameras`: drop dead columns `http_password` + `rtsp_url` (decision #193, SEC-015) |
| migration_039 | Drop dead GIN index `idx_events_raw_gin` on `events.raw_json` (0 lifetime scans) |
| migration_040 | Drop trgm GIN index `idx_events_type_trgm` on `events.event_type` (1 lifetime scan, decision perf audit 2026-06-06) |

---

<sub>End of REF_database-schema.md · Vigil Platform v1.5.3 · 2026-06-08</sub>
